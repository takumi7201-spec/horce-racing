// 騎手。horse3d.js が馬の胴の組に載せる。
//
// 以前は球とカプセルを並べた人形で、近くで見ると関節の無い棒人間だった（腕は棒、頭は玉、ヘルメットは半球）。
// ここでは部位ごとに断面を並べた管（太腿のふくらみ・ふくらはぎ・胸の厚い安全ベスト）を作り、
// 骨（2 点の間）に沿わせて置く。肘と膝は手先・足先の位置から 2 本の骨の長さで決める（2 関節の IK）ので、
// 姿勢は「腰・首・頭・手・足の位置」を書くだけで作れる（モンキー乗り・ガッツポーズ）。
//
// 形は全騎手で同じなので 1 度だけ作って共有する（長さ 1 の管を骨の長さに伸ばす）。勝負服の布だけ馬ごと。
// ヘルメットの覆いは枠色（JRA の帽色）。勝負服は胴の色・袖の色・柄（縦縞・輪・たすき・山形・玉）を馬 id で決める。
//
// 騎手の組の座標：馬の胴の組から (0, 1.6, -0.06)。+z が前、+y が上、+x が馬の左。

import * as THREE from '../../vendor/three/three.module.min.js';

const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

const cr = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

/**
 * 長さ 1 の管（+y に伸びる）。断面は [t, rx, rz, oz?, n?]：t は 0..1 の位置、rx は横、rz は前後の半径、
 * oz は前後のずれ（ふくらはぎは後ろにふくらむ）、n は超楕円の指数（大きいほど角張る）。
 * uv は u が周（0 が横 +x、前 +z を通って一周）、v が長さ。両端はふたをする。
 */
function tube(sections, { seg = 14, per = 3 } = {}) {
  const rings = [];
  for (let i = 0; i < sections.length - 1; i++) {
    const a = sections[Math.max(0, i - 1)], b = sections[i], c = sections[i + 1], d = sections[Math.min(sections.length - 1, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per;
      rings.push([0, 1, 2, 3, 4].map((j) => cr(a[j] ?? (j === 3 ? 0 : 2.2), b[j] ?? (j === 3 ? 0 : 2.2), c[j] ?? (j === 3 ? 0 : 2.2), d[j] ?? (j === 3 ? 0 : 2.2), t)));
    }
  }
  const last = sections[sections.length - 1];
  rings.push([last[0], last[1], last[2], last[3] ?? 0, last[4] ?? 2.2]);
  const pos = [], uv = [], idx = [];
  for (let i = 0; i < rings.length; i++) {
    const [y, rx, rz, oz, n] = rings[i];
    const e = 2 / n;
    for (let k = 0; k <= seg; k++) {
      const th = (k / seg) * Math.PI * 2;
      const cs = Math.cos(th), sn = Math.sin(th);
      pos.push(rx * Math.sign(cs) * Math.abs(cs) ** e, y, oz + rz * Math.sign(sn) * Math.abs(sn) ** e);
      uv.push(k / seg, y);
    }
  }
  const W = seg + 1;
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const a = i * W + k, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // ふた（中心を少し外へ出して丸める）
  for (const end of [0, rings.length - 1]) {
    const [y, , , oz] = rings[end];
    const ci = pos.length / 3;
    pos.push(0, y + (end ? 0.004 : -0.004), oz);
    uv.push(0.5, y);
    for (let k = 0; k < seg; k++) {
      const a = end * W + k, b = a + 1;
      if (end) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.userData.shared = true;
  return geo;
}

const sh = (g) => { g.userData.shared = true; return g; };

let SHAPES = null;
/** 形（全騎手で共有）。detail 'low' はレース（18 騎）用に断面を粗くする。 */
function shapes(detail) {
  SHAPES ??= {};
  if (SHAPES[detail]) return SHAPES[detail];
  const seg = detail === 'low' ? 9 : 16;
  const per = detail === 'low' ? 2 : 3;
  const o = { seg, per };
  const s = {
    // 胴：腰（ズボンの中へ入る）→ 腹 → 安全ベストで厚い胸 → 肩 → 首の付け根。少し角張った断面。
    torso: tube([[0, 0.13, 0.095, 0, 2.2], [0.16, 0.122, 0.088, 0.004, 2.3], [0.42, 0.145, 0.102, 0.01, 2.5],
      [0.68, 0.168, 0.108, 0.01, 2.7], [0.86, 0.178, 0.095, 0, 2.8], [0.97, 0.11, 0.07, 0, 2.2], [1, 0.06, 0.05, 0, 2]], o),
    // 腰の後ろ（尻）。モンキー乗りで鞍から浮かせた腰が見える。
    seat: sh(new THREE.SphereGeometry(1, seg, Math.max(6, seg >> 1))),
    neck: tube([[0, 0.058, 0.058], [1, 0.05, 0.052]], { seg: Math.max(8, seg >> 1), per: 1 }),
    upperArm: tube([[0, 0.054, 0.056], [0.25, 0.052, 0.054], [0.75, 0.045, 0.046], [1, 0.04, 0.04]], o),
    foreArm: tube([[0, 0.04, 0.042], [0.3, 0.042, 0.043], [0.85, 0.032, 0.03], [1, 0.03, 0.028]], o),
    // 腿：白いズボン。付け根が太く、膝へ細る。
    thigh: tube([[0, 0.072, 0.078], [0.35, 0.066, 0.07, -0.004], [0.8, 0.05, 0.052], [1, 0.046, 0.048]], o),
    // 脛：長靴。ふくらはぎは後ろへふくらむ（oz が負）。上端に茶の折り返し（布で塗る）。
    shin: tube([[0, 0.048, 0.052], [0.08, 0.054, 0.058], [0.3, 0.05, 0.058, -0.01], [0.75, 0.037, 0.04], [1, 0.035, 0.038]], o),
    // 足：踵から爪先へ。鐙に乗る拇指球のあたりが太い。
    foot: tube([[0, 0.042, 0.04], [0.25, 0.038, 0.045, 0.004], [0.75, 0.034, 0.038, 0.006], [1, 0.022, 0.026, 0.004]], { seg: Math.max(8, seg >> 1), per: 2 }),
    joint: sh(new THREE.SphereGeometry(1, Math.max(8, seg >> 1), Math.max(6, seg >> 2))),
    // 手袋：指を握り込んだ拳。
    fist: sh(new THREE.BoxGeometry(0.07, 0.085, 0.055, 2, 2, 2)),
    // 頭：顔（楕円体）・鼻・顎。顔は +z 向き。
    head: sh(new THREE.SphereGeometry(1, seg, Math.max(8, seg >> 1))),
    nose: sh(new THREE.ConeGeometry(0.014, 0.03, 6)),
    // ヘルメット：頭より一回り大きく、眉の上で切る。覆い（帽色）の上に、前に庇。
    helmet: sh(new THREE.SphereGeometry(1, seg, Math.max(8, seg >> 1), 0, Math.PI * 2, 0, Math.PI * 0.56)),
    peak: sh(new THREE.CylinderGeometry(1, 1, 1, Math.max(10, seg), 1, false, -0.85, 1.7)),
    // ゴーグル：顔を巻く帯と 2 枚のレンズ。
    goggleBand: sh(new THREE.TorusGeometry(1, 0.06, 4, Math.max(16, seg * 2), Math.PI * 1.25)),
    lens: sh(new THREE.SphereGeometry(1, Math.max(8, seg >> 1), 6)),
    whip: sh(new THREE.CylinderGeometry(0.006, 0.011, 1, 6)),
    iron: sh(new THREE.TorusGeometry(0.045, 0.007, 5, 14)),
    leather: sh(new THREE.BoxGeometry(0.022, 1, 0.006)),
  };
  s.whip.translate(0, 0.5, 0); s.leather.translate(0, 0.5, 0);
  SHAPES[detail] = s;
  return s;
}

// ---------------------------------------------------------------- 布

const hash01 = (id, salt) => {
  let h = (id * 2654435761 + salt * 40503) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  return (h % 100000) / 100000;
};

/** 勝負服の 2 色（胴と袖・柄）。馬 id から決めるので、同じ馬はいつも同じ服。 */
export function silksColors(id) {
  const h1 = (id * 2654435761) % 360;
  let h2 = (id * 40503 + 97) % 360;
  if (Math.abs(h1 - h2) < 40) h2 = (h2 + 150) % 360;
  // 白・黒の服もある（実際の勝負服に多い）
  const a = hash01(id, 3) < 0.12 ? new THREE.Color(0xf4f4f0) : new THREE.Color().setHSL(h1 / 360, 0.72, 0.5);
  const b = hash01(id, 4) < 0.15 ? new THREE.Color(0x1c1c22) : new THREE.Color().setHSL(h2 / 360, 0.7, 0.45);
  return [a, b];
}

const PATTERNS = ['無地', '縦縞', '輪', 'たすき', '山形', '玉', '肩章'];

const silksCache = new Map();
/** 勝負服の布（胴・袖）。u は周（0 が横、0.25 が前、0.75 が背）、v は長さ（胴は腰 0 → 首 1）。 */
function silksTextures(id) {
  if (silksCache.has(id)) return silksCache.get(id);
  const [ca, cb] = silksColors(id);
  const A = `#${ca.getHexString()}`, B = `#${cb.getHexString()}`;
  const pat = PATTERNS[Math.floor(hash01(id, 5) * PATTERNS.length)];
  const body = document.createElement('canvas');
  body.width = 256; body.height = 128;
  const g = body.getContext('2d');
  g.fillStyle = A; g.fillRect(0, 0, 256, 128);
  g.fillStyle = B;
  // キャンバスの y は v を下から上へ（tube の v=0 が腰）。flipY の既定で、キャンバスの上が v=1。
  if (pat === '縦縞') for (let x = 0; x < 256; x += 32) g.fillRect(x, 0, 14, 128);
  else if (pat === '輪') for (let y = 8; y < 120; y += 26) g.fillRect(0, y, 256, 12);
  else if (pat === 'たすき') {
    // 右肩から左腰へ、前と背に 1 本ずつ。
    for (const cx of [64, 192]) { g.save(); g.translate(cx, 64); g.rotate(-0.85); g.fillRect(-80, -11, 160, 22); g.restore(); }
  } else if (pat === '山形') {
    g.beginPath();
    for (let x = 0; x <= 256; x += 32) g.lineTo(x, (x / 32) % 2 ? 46 : 76);
    for (let x = 256; x >= 0; x -= 32) g.lineTo(x, ((x / 32) % 2 ? 46 : 76) + 18);
    g.fill();
  } else if (pat === '玉') {
    for (let y = 18; y < 128; y += 34) for (let x = (y / 34) % 2 ? 16 : 0; x < 256; x += 32) { g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.fill(); }
  } else if (pat === '肩章') g.fillRect(0, 0, 256, 30);
  // 腰の下はズボン（白）。
  g.fillStyle = '#f2f0ea'; g.fillRect(0, 116, 256, 12);
  // 縫い目と布のしわ（ごく弱く）。
  g.fillStyle = 'rgba(0,0,0,0.06)';
  for (const x of [0, 128]) g.fillRect(x, 0, 2, 128);
  const sleeve = document.createElement('canvas');
  sleeve.width = 64; sleeve.height = 64;
  const s = sleeve.getContext('2d');
  const sleevePat = hash01(id, 6);
  s.fillStyle = sleevePat < 0.5 ? B : A;
  s.fillRect(0, 0, 64, 64);
  if (sleevePat >= 0.5) { s.fillStyle = B; for (let y = 6; y < 64; y += 18) s.fillRect(0, y, 64, 7); }
  s.fillStyle = '#f2f0ea'; s.fillRect(0, 60, 64, 4);   // 袖口のゴム
  const tex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const out = { body: tex(body), sleeve: tex(sleeve), pattern: pat };
  silksCache.set(id, out);
  if (silksCache.size > 40) {
    const [k, v] = silksCache.entries().next().value;
    v.body.dispose(); v.sleeve.dispose();
    silksCache.delete(k);
  }
  return out;
}

let bootTex = null;
/** 長靴：上端に茶の折り返し、ほかは艶のある黒。 */
function bootTexture() {
  if (bootTex) return bootTex;
  const c = document.createElement('canvas');
  c.width = 8; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#151210'; g.fillRect(0, 0, 8, 64);
  g.fillStyle = '#8a5a32'; g.fillRect(0, 0, 8, 9);     // 膝の下の折り返し
  bootTex = new THREE.CanvasTexture(c);
  bootTex.colorSpace = THREE.SRGBColorSpace;
  bootTex.flipY = false;   // キャンバスの上端を v=0（膝）にする
  return bootTex;
}

// ---------------------------------------------------------------- 骨と姿勢

const v3 = (a) => new THREE.Vector3(...a);

/** 長さ 1 の管を a → b に置く。横（管の x）は side に寄せる（腕や脚がねじれない）。 */
function bone(mesh, a, b, side = X) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length() || 1e-4;
  const y = d.divideScalar(len);
  const x = side.clone().addScaledVector(y, -side.dot(y));
  if (x.lengthSq() < 1e-6) x.set(0, 0, 1).addScaledVector(y, -y.z);
  x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  mesh.position.copy(a);
  mesh.scale.set(1, len, 1);
  return mesh;
}

/** 2 関節の IK：付け根 a・先 c・骨の長さ l1・l2・曲がる向き pole から、中の関節を返す。 */
function ik(a, c, l1, l2, pole) {
  const ac = new THREE.Vector3().subVectors(c, a);
  const d = Math.min(ac.length(), (l1 + l2) * 0.999);
  const dir = ac.normalize();
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const p = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  return a.clone().addScaledVector(dir, along).addScaledVector(p, h);
}

const L = { upper: 0.29, fore: 0.27, thigh: 0.42, shin: 0.41 };

/**
 * 姿勢。腰（骨盤の中心）・首の付け根・頭の中心と傾き・手（左右）・足首（左右）。左は +x。
 * race：モンキー乗り。腰を鞍から浮かせ、背中はほぼ水平、頭を上げて前を見る。鐙は短く膝が高い。
 *   手は手綱を持って首の上（手綱の付け根 makeReins の HANDS と同じ点）。
 * celebrate：ゴール後のガッツポーズ。上体を起こし、左手で鞭を突き上げる。右手は手綱。
 */
const POSES = {
  race: {
    pelvis: [0, 0.2, -0.05], neck: [0, 0.43, 0.43], head: [0, 0.535, 0.535], headTilt: 0.22,
    hands: [[0.09, 0.2, 0.74], [-0.09, 0.2, 0.74]], ankles: [[0.3, -0.2, 0.17], [-0.3, -0.2, 0.17]],
    whip: [-0.03, 0.42, -0.36],
  },
  celebrate: {
    pelvis: [0, 0.19, -0.06], neck: [0, 0.69, 0.13], head: [0, 0.82, 0.16], headTilt: -0.05,
    hands: [[0.38, 1.0, -0.04], [-0.09, 0.32, 0.5]], ankles: [[0.3, -0.2, 0.17], [-0.3, -0.2, 0.17]],
    whipHand: 0, whip: [0.18, 0.52, -0.3],
  },
};

/**
 * 騎手を作る。
 * @param {{id:number, frame:number, capColor:number, pose?:string, detail?:'high'|'low'}} o
 * @returns {{group:THREE.Group, reinHands:THREE.Vector3[]}} 手綱を持つ手（騎手の組の座標。左 +x・右 -x の順）。
 *   ガッツポーズでは両方の手綱を右手でまとめて持つ。
 */
export function makeJockey({ id = 1, capColor = 0xffffff, pose = 'race', detail = 'low' }) {
  const S = shapes(detail);
  const P = POSES[pose] ?? POSES.race;
  const high = detail !== 'low';
  const tex = silksTextures(id);
  const silks = new THREE.MeshStandardMaterial({ map: tex.body, roughness: 0.36, metalness: 0.02 });
  const sleeve = new THREE.MeshStandardMaterial({ map: tex.sleeve, roughness: 0.36, metalness: 0.02 });
  const breeches = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.6 });
  const boot = new THREE.MeshStandardMaterial({ map: bootTexture(), roughness: 0.28, metalness: 0.05 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a782, roughness: 0.62 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.6 });
  const cap = new THREE.MeshStandardMaterial({ color: capColor, roughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.08, metalness: 0.6 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xc7cbd0, roughness: 0.25, metalness: 0.8 });

  const g = new THREE.Group();
  const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); g.add(m); return m; };

  // 胴：腰から首の付け根へ。胴の組の向き（横 x・背骨 y・胸 z）で肩と股の位置を出す。
  const pelvis = v3(P.pelvis), neck = v3(P.neck);
  const torso = bone(add(S.torso, silks), pelvis, neck);
  const tx = new THREE.Vector3(1, 0, 0).applyQuaternion(torso.quaternion);
  const ty = new THREE.Vector3().subVectors(neck, pelvis);
  const tlen = ty.length(); ty.normalize();
  const tz = new THREE.Vector3(0, 0, 1).applyQuaternion(torso.quaternion);   // 胸の向き
  const onTorso = (lx, t, lz) => pelvis.clone().addScaledVector(tx, lx).addScaledVector(ty, t * tlen).addScaledVector(tz, lz);
  // 尻：骨盤の後ろ。
  const seat = add(S.seat, breeches);
  seat.position.copy(onTorso(0, 0.02, -0.03));
  seat.quaternion.copy(torso.quaternion);
  seat.scale.set(0.125, 0.08, 0.1);

  // 首と頭。頭は前を見る（race は背中が水平なので、首を反らして顔を上げる）。
  const headC = v3(P.head);
  bone(add(S.neck, skin), neck, headC.clone().add(new THREE.Vector3(0, -0.07, -0.01)));
  const head = new THREE.Group();
  head.position.copy(headC);
  head.rotation.x = P.headTilt;
  g.add(head);
  const hm = (geo, mat) => { const m = new THREE.Mesh(geo, mat); head.add(m); return m; };
  const face = hm(S.head, skin);
  face.scale.set(0.078, 0.1, 0.09);
  if (high) {
    const nose = hm(S.nose, skin);
    nose.position.set(0, -0.012, 0.09);
    nose.rotation.x = Math.PI / 2 + 0.25;
  }
  // ヘルメット（帽色の覆い）と庇。頭の上半分を覆い、後ろは少し深い。
  const helmet = hm(S.helmet, cap);
  helmet.scale.set(0.1, 0.1, 0.116);
  helmet.position.set(0, 0.012, -0.008);
  const peak = hm(S.peak, cap);
  peak.scale.set(0.1, 0.008, 0.124);
  peak.position.set(0, 0.02, 0.01);
  peak.rotation.x = -0.12;
  // ゴーグル：目の高さに帯と 2 枚のレンズ。
  const band = hm(S.goggleBand, dark);
  band.scale.set(0.088, 0.088, 0.098);
  band.rotation.set(-Math.PI / 2, 0, -Math.PI * 0.125 + Math.PI);
  band.position.set(0, -0.004, 0);
  for (const sx of [-1, 1]) {
    const lens = hm(S.lens, glass);
    lens.scale.set(0.026, 0.018, 0.012);
    lens.position.set(sx * 0.031, -0.004, 0.088);
  }
  // 顎紐
  if (high) {
    const strap = hm(S.goggleBand, dark);
    strap.scale.set(0.075, 0.075, 0.08);
    strap.rotation.set(0, Math.PI / 2, Math.PI);
    strap.position.set(0, -0.02, -0.005);
  }

  // 腕：肩 → 肘（IK）→ 手。肘は外・下へ張る。
  const hands = [];
  for (let i = 0; i < 2; i++) {
    const sx = i === 0 ? 1 : -1;
    const shoulder = onTorso(sx * 0.165, 0.9, -0.01);
    const hand = v3(P.hands[i]);
    // 肘は少しだけ外へ、主に下・後ろへ畳む（外へ張ると羽を広げたように見えた）。
    const elbow = ik(shoulder, hand, L.upper, L.fore, new THREE.Vector3(sx * 0.35, -0.6, -0.45));
    bone(add(S.upperArm, sleeve), shoulder, elbow);
    bone(add(S.foreArm, sleeve), elbow, hand);
    if (high) { const j = add(S.joint, sleeve); j.position.copy(elbow); j.scale.setScalar(0.042); const sj = add(S.joint, silks); sj.position.copy(shoulder); sj.scale.setScalar(0.058); }
    // 拳は前腕の延長に置く。
    const fist = add(S.fist, glove);
    const fd = new THREE.Vector3().subVectors(hand, elbow).normalize();
    fist.position.copy(hand).addScaledVector(fd, 0.035);
    fist.quaternion.setFromUnitVectors(UP, fd);
    hands.push(hand.clone().addScaledVector(fd, 0.035));
  }
  // 鞭：race は右手（-x）に持って後ろ上へ、celebrate は左手で突き上げる。
  const wh = hands[P.whipHand ?? 1];
  bone(add(S.whip, dark), wh, wh.clone().add(v3(P.whip)), X);

  // 脚：股 → 膝（IK、前へ）→ 足首 → 爪先。鐙は爪先の下、鐙革は鞍から鐙へ。
  for (let i = 0; i < 2; i++) {
    const sx = i === 0 ? 1 : -1;
    const hip = onTorso(sx * 0.09, 0.04, 0.02);
    const ankle = v3(P.ankles[i]);
    const knee = ik(hip, ankle, L.thigh, L.shin, new THREE.Vector3(sx * 0.35, 0.2, 1));
    bone(add(S.thigh, breeches), hip, knee);
    bone(add(S.shin, boot), knee, ankle);
    if (high) { const j = add(S.joint, breeches); j.position.copy(knee); j.scale.setScalar(0.056); }
    const toe = ankle.clone().add(new THREE.Vector3(sx * 0.01, -0.035, 0.21));
    bone(add(S.foot, boot), ankle.clone().add(new THREE.Vector3(0, -0.01, -0.03)), toe);
    // 鐙（拇指球の下）と鐙革。
    const ball = ankle.clone().lerp(toe, 0.62).add(new THREE.Vector3(0, -0.04, 0));
    const iron = add(S.iron, steel);
    iron.position.copy(ball);
    iron.rotation.set(0, Math.PI / 2, 0);
    if (high) bone(add(S.leather, dark), ball.clone().add(new THREE.Vector3(0, 0.04, 0)), new THREE.Vector3(sx * 0.16, -0.02, 0.05), new THREE.Vector3(0, 0, 1));
  }
  const reinHands = pose === 'celebrate' ? [hands[1], hands[1]] : hands;
  return { group: g, reinHands };
}
