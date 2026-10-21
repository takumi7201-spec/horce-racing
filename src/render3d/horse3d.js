// 馬と騎手の 3D モデル。
//
// 形は単純な箱と円柱の組み合わせだが、脚の動きだけは走行距離に同期させている。
// 速度ではなく「進んだ距離」で位相を進めるのが肝で、こうすると
// 止まりかけた馬の脚もちゃんと止まり、滑って見えない。
//
// 1 完歩は約 7m。サラブレッドのギャロップは 1 完歩 6〜7.5m、
// 1 秒あたり 2.2〜2.5 完歩なので、17m/s でだいたい合う。
//
// **このモデルはローカル +Z が前方**（頭が +z、尾が -z、前脚が +z）。
// 置く側は orient.js の yawForZForward() で Y 回転を作ること。

import * as THREE from '../../vendor/three/three.module.min.js';

/** 1 完歩の距離（m）。 */
const STRIDE = 7.0;

/** JRA の枠色。1 枠から 8 枠。 */
export const FRAME_COLORS = [
  0xffffff, 0x1c1c1c, 0xd42b2b, 0x2a62c8, 0xf2d024,
  0x1e9c4a, 0xee7d26, 0xf2a0c0,
];
export const FRAME_TEXT = [
  0x111111, 0xffffff, 0xffffff, 0xffffff, 0x111111,
  0xffffff, 0x111111, 0x111111,
];

/** 毛色。 */
const COAT = {
  鹿毛: 0x5a3a22, 黒鹿毛: 0x3a2616, 栗毛: 0x8a5a2a, 栃栗毛: 0x6b4420,
  芦毛: 0xc9c6c0, 青鹿毛: 0x2a1c12, 青毛: 0x1a1512, 白毛: 0xece9e3,
};

const numberTextures = new Map();

/** ゼッケン（馬番）のテクスチャ。絵文字は使わず数字だけ描く。 */
function numberTexture(num, frame) {
  const key = `${num}-${frame}`;
  if (numberTextures.has(key)) return numberTextures.get(key);
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const bg = FRAME_COLORS[(frame - 1) % 8] ?? 0xffffff;
  const fg = FRAME_TEXT[(frame - 1) % 8] ?? 0x111111;
  g.fillStyle = `#${bg.toString(16).padStart(6, '0')}`;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = `#${fg.toString(16).padStart(6, '0')}`;
  g.font = 'bold 44px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(num), 32, 35);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  numberTextures.set(key, tex);
  return tex;
}

/** 勝負服の色。馬 id から決めるので、同じ馬はいつも同じ服。 */
function silksColors(seed) {
  const h1 = (seed * 2654435761) % 360;
  const h2 = (seed * 40503 + 97) % 360;
  return [
    new THREE.Color().setHSL(h1 / 360, 0.72, 0.52),
    new THREE.Color().setHSL(h2 / 360, 0.68, 0.42),
  ];
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
/** 縦長のカプセル（ローカル +y 方向に伸びる）。 */
const capsule = (r, len, seg = 8) => new THREE.CapsuleGeometry(r, len, 4, seg);
const sphere = (r, w = 12, h = 9) => new THREE.SphereGeometry(r, w, h);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * 1 頭ぶんのモデルを作る。
 *
 * 形は球とカプセルの組み合わせ。もとは箱だったが、牧場の画面で近くから
 * 見せると角ばった木馬にしか見えなかったので丸くした。
 * 首はキ甲（肩の頂点）から前上へ、頭は項（うなじ）から鼻先へ前下がりに伸ばす。
 * 箱の時代は首の傾きが逆向き（上端が胴の側へ倒れていた）で、遠目で
 * 誤魔化せていただけだった。
 *
 * @param {{bare?:boolean, tack?:boolean}} opts
 *   bare=true で騎手とゼッケンを付けない（牧場用）。
 *   tack=true で鞍と頭絡を付ける（馬の詳細で 1 頭だけ大きく見せるとき）
 * @returns {{group:THREE.Group, update:Function, legs:Array, body:THREE.Group, rider:THREE.Group|null}}
 */
export function makeHorse({ id = 1, gate = 1, frame = 1, coat = '鹿毛', scale = 1, bare = false, tack = false, padColor = 0xe8c33a } = {}) {
  const group = new THREE.Group();
  const body = new THREE.Group();   // 胴体まわり（上下に揺れる）
  group.add(body);

  const coatColor = COAT[coat] ?? COAT['鹿毛'];
  const hide = new THREE.MeshLambertMaterial({ color: coatColor });
  // 鹿毛系はたてがみ・尾・脚先が黒い。芦毛と白毛は灰色、栗毛は同系の明るい色。
  const pointsColor = coat === '芦毛' ? 0x8f8b86 : coat === '白毛' ? 0xd8d4cc
    : coat === '栗毛' ? 0xb98a52 : coat === '栃栗毛' ? 0x4a2e18 : 0x1e140c;
  const mane = new THREE.MeshLambertMaterial({ color: pointsColor });
  const hoofMat = new THREE.MeshLambertMaterial({ color: 0x2a2420 });
  const [silkA, silkB] = silksColors(id);
  const silksMat = new THREE.MeshLambertMaterial({ color: silkA });
  const capMat = new THREE.MeshLambertMaterial({ color: silkB });
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xe0b48c });

  const add = (parent, geo, mat, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    parent.add(m);
    return m;
  };

  // --- 胴 ---
  // 胴はカプセルを寝かせて置く（rotation.x = π/2 で +y が +z を向く）。
  // 胸から尻までは 1.7m 前後（体高とほぼ同じ）。これより長いと腸詰めに見える。
  const torso = add(body, capsule(0.38, 0.8, 12), hide, 0, 1.2, 0, Math.PI / 2);
  torso.scale.set(0.9, 1, 1.0);
  // 胸は深く、キ甲（肩の頂点）は尻より少し高い。
  const chest = add(body, sphere(0.42), hide, 0, 1.22, 0.5);
  chest.scale.set(0.86, 1.08, 0.95);
  const rump = add(body, sphere(0.43), hide, 0, 1.24, -0.5);
  rump.scale.set(0.95, 1, 1.0);

  // --- 首と頭 ---
  // 首と頭はキ甲を支点にした組にして、うつむき（草を食む）も表せるようにする。
  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 1.42, 0.62);
  body.add(neckPivot);
  // 首の付け根を太くして胸につなぐ（細い首が胴から生えて見えないように）。
  const neckBase = add(neckPivot, sphere(0.27), hide, 0, 0.0, 0.02);
  neckBase.scale.set(0.85, 1.05, 1.1);
  // rotation.x = θ はローカル +y を (cosθ, sinθ) へ倒す（前上がり）。
  const neck = add(neckPivot, capsule(0.18, 0.6, 10), hide, 0, 0.3, 0.3, 0.80);
  neck.scale.set(0.85, 1, 1.35);
  const maneMesh = add(neckPivot, box(0.07, 0.82, 0.12), mane, 0, 0.42, 0.18, 0.80);
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.58, 0.62);          // 項
  neckPivot.add(headPivot);
  const head = add(headPivot, capsule(0.13, 0.42, 10), hide, 0, -0.14, 0.26, 2.15);
  head.scale.set(0.95, 1, 1.15);
  add(headPivot, sphere(0.16), hide, 0, -0.02, 0.07);           // 頬
  add(headPivot, sphere(0.11), mane, 0, -0.34, 0.5);             // 鼻先
  for (const sx of [-1, 1]) {
    const ear = add(headPivot, new THREE.ConeGeometry(0.045, 0.17, 5), hide, sx * 0.07, 0.15, 0.0);
    ear.rotation.z = -sx * 0.18;
  }
  const forelock = add(headPivot, box(0.1, 0.12, 0.06), mane, 0, 0.1, 0.1, 0.4);
  forelock.visible = true;

  // --- 尾（付け根を支点に、走ると後ろへ流れる） ---
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 1.42, -0.88);
  body.add(tailPivot);
  const tail = add(tailPivot, capsule(0.075, 0.62, 8), mane, 0, -0.38, 0);
  tail.scale.set(1.2, 1, 0.8);

  // --- 脚 ---
  // 上肢（肩/股→膝）と下肢（膝→蹄）の 2 節。ピボットは各節の上端。
  // phase は襲歩（ギャロップ）と常歩（なみあし）でそれぞれ違う拍子。
  const legs = [];
  const legDef = [
    { x: -0.2, z: 0.52, gallop: 0.50, walk: 0.25 },   // 左前
    { x: 0.2, z: 0.52, gallop: 0.62, walk: 0.75 },    // 右前
    { x: -0.22, z: -0.55, gallop: 0.00, walk: 0.00 }, // 左後
    { x: 0.22, z: -0.55, gallop: 0.12, walk: 0.50 },  // 右後
  ];
  for (const d of legDef) {
    const hip = new THREE.Group();
    hip.position.set(d.x, 1.05, d.z);
    const upper = add(hip, capsule(0.085, 0.42, 8), hide, 0, -0.28, 0);
    upper.scale.set(1, 1, 1.25);
    const knee = new THREE.Group();
    knee.position.y = -0.56;
    add(knee, capsule(0.058, 0.36, 8), mane, 0, -0.22, 0);
    add(knee, new THREE.CylinderGeometry(0.075, 0.09, 0.1, 8), hoofMat, 0, -0.46, 0.01);
    hip.add(knee);
    body.add(hip);
    legs.push({ hip, knee, gallop: d.gallop, walk: d.walk });
  }

  // --- 騎手（牧場では付けない） ---
  let rider = null;
  if (!bare) {
    rider = new THREE.Group();
    rider.position.set(0, 1.62, -0.1);
    const seat = new THREE.Mesh(box(0.46, 0.42, 0.5), silksMat);
    seat.position.set(0, 0.16, -0.04);
    rider.add(seat);
    const back = new THREE.Mesh(box(0.42, 0.46, 0.34), silksMat);
    back.position.set(0, 0.42, 0.18);
    back.rotation.x = -0.95;  // 前傾（モンキー乗り）
    rider.add(back);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), capMat);
    helmet.position.set(0, 0.62, 0.46);
    rider.add(helmet);
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(box(0.1, 0.1, 0.52), silksMat);
      arm.position.set(sx * 0.19, 0.46, 0.5);
      arm.rotation.x = 0.25;
      rider.add(arm);
      const thigh = new THREE.Mesh(box(0.13, 0.34, 0.14), skinMat);
      thigh.position.set(sx * 0.22, 0.0, 0.08);
      thigh.rotation.x = 0.55;
      rider.add(thigh);
      const boot = new THREE.Mesh(box(0.12, 0.28, 0.12), capMat);
      boot.position.set(sx * 0.24, -0.22, 0.26);
      rider.add(boot);
    }
    body.add(rider);

    // --- ゼッケン（馬番） ---
    const clothGeo = box(0.02, 0.34, 0.42);
    const side = new THREE.MeshLambertMaterial({ color: FRAME_COLORS[(frame - 1) % 8] });
    const face = new THREE.MeshLambertMaterial({ map: numberTexture(gate, frame) });
    const clothMat = [face, face, side, side, side, side];
    for (const sx of [-1, 1]) {
      const cloth = new THREE.Mesh(clothGeo, clothMat);
      cloth.position.set(sx * 0.37, 1.24, 0.1);
      body.add(cloth);
    }
  }

  // --- 馬具（詳細画面の 1 頭だけ） ---
  // 鞍下は胴のカプセルに沿う円筒の一部。平らな箱を載せると背中から浮いて見えた。
  if (tack) {
    const strap = new THREE.MeshLambertMaterial({ color: 0x2a1d16 });
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.4, 0.62, 18, 1, true, -1.15, 2.3),
      new THREE.MeshLambertMaterial({ color: padColor, side: THREE.DoubleSide }),
    );
    // 円筒の軸を前後（z）に寝かせ、開いた側を下へ向ける。
    pad.rotation.x = Math.PI / 2;
    pad.rotation.y = Math.PI;
    pad.scale.set(0.93, 1, 1.02);
    pad.position.set(0, 1.21, 0.02);
    body.add(pad);
    const saddle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.415, 0.415, 0.34, 18, 1, true, -0.8, 1.6),
      new THREE.MeshLambertMaterial({ color: 0x3a2a20, side: THREE.DoubleSide }),
    );
    saddle.rotation.copy(pad.rotation);
    saddle.scale.copy(pad.scale);
    saddle.position.set(0, 1.215, 0.06);
    body.add(saddle);
    // 腹帯
    const girth = new THREE.Mesh(new THREE.TorusGeometry(0.39, 0.025, 6, 24), strap);
    girth.rotation.y = Math.PI / 2;
    girth.scale.set(1, 1.02, 0.9);
    girth.position.set(0, 1.2, 0.18);
    body.add(girth);
    // 頭絡：鼻革と項革の 2 本の輪。頭の組に付けるので、首を振ってもずれない。
    const nose = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.02, 6, 18), strap);
    nose.position.set(0, -0.24, 0.36);
    nose.rotation.x = 2.15 - Math.PI / 2;
    headPivot.add(nose);
    const crown = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.02, 6, 18), strap);
    crown.position.set(0, 0.0, 0.05);
    crown.rotation.x = 0.35;
    headPivot.add(crown);
  }

  if (scale !== 1) group.scale.setScalar(scale);

  let prevS = 0;
  let phase = 0;

  /**
   * @param {number} s    走った距離（m）。位相はこれで進める
   * @param {number} v    速度（m/s）。歩様・前傾・尾のなびきに使う
   * @param {number} bank コーナーの内傾（rad）
   * @param {{t?:number, graze?:number}} idle 牧場用。t は経過秒、graze は 0..1 のうつむき
   */
  function update(s, v, bank = 0, idle = null) {
    const ds = Math.max(0, s - prevS);
    prevS = s;
    // 常歩と襲歩では 1 完歩の長さも脚の振り幅も違う。レースの速度（10m/s 以上）
    // では gait = 1 になり、以前の襲歩の動きと同じになる。
    const gait = clamp01((v - 2) / 8);
    const stride = 1.7 + (STRIDE - 1.7) * gait;
    phase = (phase + ds / stride) % 1;
    const moving = clamp01(v / 0.8);           // 止まっていれば脚はまっすぐ
    const tau = Math.PI * 2;
    const hipAmp = 0.95 * (0.38 + 0.62 * gait) * moving;
    const kneeAmp = 1.25 * (0.45 + 0.55 * gait) * moving;

    for (const leg of legs) {
      const lp = leg.walk + (leg.gallop - leg.walk) * gait;
      const a = ((phase + lp) % 1) * tau;
      // 股は前後に振る。膝は後方に送るときだけ深く曲がる。
      leg.hip.rotation.x = Math.sin(a) * hipAmp;
      leg.knee.rotation.x = -Math.max(0, -Math.cos(a)) * kneeAmp - 0.06;
    }
    // 胴の上下動は 1 完歩に 1 回。沈み込みで前肢が着く。常歩ではほとんど揺れない。
    const bobAmp = (0.015 + 0.06 * gait) * moving;
    body.position.y = Math.sin(phase * tau) * bobAmp;
    body.rotation.x = Math.cos(phase * tau) * 0.045 * gait;
    body.rotation.z = bank;
    // 速いほど首を前に伸ばす。尾は後ろへ流れる。
    const run = Math.min(1, v / 18);
    const t = idle?.t ?? 0;
    const graze = idle?.graze ?? 0;
    // 首はキ甲を支点に前へ倒す。うつむくと鼻先が地面に届く。
    neckPivot.rotation.x = 0.12 + run * 0.32 + graze * 1.35
      + (idle ? Math.sin(t * 0.9 + id) * 0.03 * (1 - moving) : 0);
    headPivot.rotation.x = run * 0.15 + graze * 0.35;
    tailPivot.rotation.x = 0.28 + run * 1.0;
    // 止まっているときは尾をゆっくり振る（牧場の画面だけ）。
    tailPivot.rotation.z = idle ? Math.sin(t * 1.6 + id * 1.7) * 0.22 * (1 - moving) : 0;
    if (rider) rider.rotation.x = -run * 0.12;
  }

  return { group, update, legs, body, rider };
}

/** 影の代わりの楕円。地面に貼って足元を締める（影より軽い）。 */
export function makeShadowPatch() {
  const geo = new THREE.CircleGeometry(1.0, 14);
  geo.rotateX(-Math.PI / 2);
  geo.scale(0.6, 1, 1.4);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 1;
  return m;
}

export { COAT as COAT_COLORS, STRIDE };
