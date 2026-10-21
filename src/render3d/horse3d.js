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

/**
 * 1 頭ぶんのモデルを作る。
 * @returns {{group:THREE.Group, update:(s:number,v:number,bank:number)=>void}}
 */
export function makeHorse({ id = 1, gate = 1, frame = 1, coat = '鹿毛', scale = 1 } = {}) {
  const group = new THREE.Group();
  const body = new THREE.Group();   // 胴体まわり（上下に揺れる）
  group.add(body);

  const coatColor = COAT[coat] ?? COAT['鹿毛'];
  const hide = new THREE.MeshLambertMaterial({ color: coatColor });
  const mane = new THREE.MeshLambertMaterial({ color: coatColor === COAT['芦毛'] ? 0x9a9690 : 0x241709 });
  const [silkA, silkB] = silksColors(id);
  const silksMat = new THREE.MeshLambertMaterial({ color: silkA });
  const capMat = new THREE.MeshLambertMaterial({ color: silkB });
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xe0b48c });

  // --- 胴 ---
  const torso = new THREE.Mesh(box(0.72, 0.82, 2.05), hide);
  torso.position.set(0, 1.18, 0);
  body.add(torso);
  // 肩と腰を少し膨らませる。
  const chest = new THREE.Mesh(box(0.78, 0.86, 0.6), hide);
  chest.position.set(0, 1.20, 0.72);
  body.add(chest);
  const rump = new THREE.Mesh(box(0.80, 0.84, 0.62), hide);
  rump.position.set(0, 1.22, -0.72);
  body.add(rump);

  // --- 首と頭 ---
  const neck = new THREE.Mesh(box(0.42, 0.95, 0.42), hide);
  neck.position.set(0, 1.52, 1.02);
  neck.rotation.x = -0.72;
  body.add(neck);
  const head = new THREE.Mesh(box(0.3, 0.3, 0.74), hide);
  head.position.set(0, 1.76, 1.52);
  head.rotation.x = -0.25;
  body.add(head);
  const nose = new THREE.Mesh(box(0.26, 0.24, 0.2), mane);
  nose.position.set(0, 1.70, 1.86);
  body.add(nose);
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(box(0.08, 0.2, 0.08), hide);
    ear.position.set(sx * 0.1, 1.95, 1.3);
    body.add(ear);
  }
  // たてがみ
  const maneMesh = new THREE.Mesh(box(0.12, 0.16, 1.0), mane);
  maneMesh.position.set(0, 1.78, 1.06);
  maneMesh.rotation.x = -0.72;
  body.add(maneMesh);

  // --- 尾（走ると流れる） ---
  const tail = new THREE.Mesh(box(0.16, 0.16, 0.9), mane);
  tail.position.set(0, 1.3, -1.25);
  tail.rotation.x = 0.5;
  body.add(tail);

  // --- 脚 ---
  // 上肢（肩/股→膝）と下肢（膝→蹄）の 2 節。ピボットは各節の上端。
  const legs = [];
  const legDef = [
    { x: -0.26, z: 0.75, phase: 0.50 },  // 左前
    { x: 0.26, z: 0.75, phase: 0.62 },   // 右前
    { x: -0.28, z: -0.75, phase: 0.00 }, // 左後
    { x: 0.28, z: -0.75, phase: 0.12 },  // 右後
  ];
  for (const d of legDef) {
    const hip = new THREE.Group();
    hip.position.set(d.x, 1.02, d.z);
    const upper = new THREE.Mesh(box(0.18, 0.56, 0.18), hide);
    upper.position.y = -0.28;
    hip.add(upper);
    const knee = new THREE.Group();
    knee.position.y = -0.56;
    const lower = new THREE.Mesh(box(0.13, 0.46, 0.13), hide);
    lower.position.y = -0.23;
    knee.add(lower);
    const hoof = new THREE.Mesh(box(0.17, 0.1, 0.2), mane);
    hoof.position.y = -0.48;
    knee.add(hoof);
    hip.add(knee);
    body.add(hip);
    legs.push({ hip, knee, phase: d.phase });
  }

  // --- 騎手 ---
  const rider = new THREE.Group();
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
  const clothMat = [
    new THREE.MeshLambertMaterial({ map: numberTexture(gate, frame) }),
    new THREE.MeshLambertMaterial({ map: numberTexture(gate, frame) }),
    new THREE.MeshLambertMaterial({ color: FRAME_COLORS[(frame - 1) % 8] }),
    new THREE.MeshLambertMaterial({ color: FRAME_COLORS[(frame - 1) % 8] }),
    new THREE.MeshLambertMaterial({ color: FRAME_COLORS[(frame - 1) % 8] }),
    new THREE.MeshLambertMaterial({ color: FRAME_COLORS[(frame - 1) % 8] }),
  ];
  for (const sx of [-1, 1]) {
    const cloth = new THREE.Mesh(clothGeo, clothMat);
    cloth.position.set(sx * 0.37, 1.22, 0.1);
    body.add(cloth);
  }

  if (scale !== 1) group.scale.setScalar(scale);

  let prevS = 0;
  let phase = 0;

  /**
   * @param {number} s   走った距離（m）。位相はこれで進める
   * @param {number} v   速度（m/s）。前傾と尾のなびきに使う
   * @param {number} bank コーナーの内傾（rad）
   */
  function update(s, v, bank = 0) {
    const ds = Math.max(0, s - prevS);
    prevS = s;
    phase = (phase + ds / STRIDE) % 1;
    const tau = Math.PI * 2;

    for (const leg of legs) {
      const t = (phase + leg.phase) % 1;
      const a = t * tau;
      // 股は前後に振る。膝は後方に送るときだけ深く曲がる。
      leg.hip.rotation.x = Math.sin(a) * 0.95;
      leg.knee.rotation.x = -Math.max(0, -Math.cos(a)) * 1.25 - 0.08;
    }
    // 胴の上下動は 1 完歩に 1 回。沈み込みで前肢が着く。
    const bob = Math.sin(phase * tau) * 0.075;
    body.position.y = bob;
    body.rotation.x = Math.cos(phase * tau) * 0.045;
    body.rotation.z = bank;
    // 速いほど前に伸びる。尾は後ろへ流れる。
    const run = Math.min(1, v / 18);
    neck.rotation.x = -0.72 - run * 0.16;
    head.rotation.x = -0.25 - run * 0.1;
    tail.rotation.x = 0.5 + run * 0.6;
    rider.rotation.x = -run * 0.12;
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
