// 馬と騎手の 3D モデル。
//
// 体は「断面を経路に沿って並べた管」（loft）で作る。胴・首・頭・脚・尾のそれぞれに、
// 実際の馬の寸法に合わせた断面（幅・上側の厚み・下側の厚み）を何点か置き、間をなめらかに補う。
// 以前は球とカプセルを並べていたが、牧場や馬の詳細で近くから見ると、つなぎ目のくびれと
// 丸太のような脚で「木馬」にしか見えなかった。キ甲の盛り上がり・背のくぼみ・尻の丸み・
// 腹の巻き上がり、膝と球節のふくらみ、細い管（すね）は、断面の並びでしか出せない。
//
// 形は全頭で同じなので、ジオメトリはモジュールで 1 度だけ作って使い回す（userData.shared）。
// 18 頭のレースでも頂点は 1 頭ぶんしか持たない。毛色・勝負服・白斑は材質と小物で変える。
//
// 脚の動きは走行距離に同期させる。速度ではなく「進んだ距離」で位相を進めるのが肝で、
// こうすると止まりかけた馬の脚もちゃんと止まり、滑って見えない。
// 1 完歩は約 7m。サラブレッドのギャロップは 1 完歩 6〜7.5m、1 秒あたり 2.2〜2.5 完歩なので、
// 17m/s でだいたい合う。
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

/**
 * たてがみ・尾・脚先（ポイント）の色。鹿毛系は黒く、栗毛は地色と同系、芦毛・白毛は灰と白。
 * 脚先は膝・飛節から下を塗る（鹿毛の「黒い長靴下」）。栗毛系は脚も地色のまま。
 */
function pointsOf(coat) {
  switch (coat) {
    case '芦毛': return { mane: 0x8f8b86, leg: 0x9a968f };
    case '白毛': return { mane: 0xdcd8d0, leg: 0xe6e2da };
    case '栗毛': return { mane: 0xb98a52, leg: null };
    case '栃栗毛': return { mane: 0x4a2e18, leg: null };
    default: return { mane: 0x1e140c, leg: 0x1e140c };
  }
}

const numberTextures = new Map();

/** ゼッケン（馬番）のテクスチャ。絵文字は使わず数字だけ描く。 */
function numberTexture(num, frame) {
  const key = `${num}-${frame}`;
  if (numberTextures.has(key)) return numberTextures.get(key);
  const c = document.createElement('canvas');
  c.width = 128; c.height = 96;
  const g = c.getContext('2d');
  const bg = FRAME_COLORS[(frame - 1) % 8] ?? 0xffffff;
  const fg = FRAME_TEXT[(frame - 1) % 8] ?? 0x111111;
  g.fillStyle = `#${bg.toString(16).padStart(6, '0')}`;
  g.fillRect(0, 0, 128, 96);
  g.fillStyle = `#${fg.toString(16).padStart(6, '0')}`;
  g.font = 'bold 64px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(num), 64, 52);
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

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** 馬 id からの決まった乱数（白斑の有無など。乱数の流れに触らない）。 */
function hash01(id, salt) {
  let h = (Math.imul(id + 1, 2654435761) ^ Math.imul(salt + 7, 40503)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- 管（loft）

/** 一様な Catmull-Rom。p0..p3 の間 t∈[0,1]。 */
const cr = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

/**
 * 制御断面を補って細かい断面の列にする。
 * 断面は { p:[x,y,z], w, up, dn, n? }。w は横（ローカル x）の半幅、up / dn は「上」側と「下」側の厚み。
 */
function refine(ctrl, per) {
  const out = [];
  const keys = ['w', 'up', 'dn', 'n'];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const a = ctrl[Math.max(0, i - 1)], b = ctrl[i], c = ctrl[i + 1], d = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const r = { p: [0, 1, 2].map((j) => cr(a.p[j], b.p[j], c.p[j], d.p[j], t)) };
      for (const key of keys) r[key] = cr(a[key] ?? 2, b[key] ?? 2, c[key] ?? 2, d[key] ?? 2, t);
      out.push(r);
    }
  }
  const last = ctrl[ctrl.length - 1];
  out.push({ p: [...last.p], w: last.w, up: last.up, dn: last.dn, n: last.n ?? 2 });
  return out;
}

/**
 * 断面を経路に沿って並べた管を作る。経路はローカル yz 平面の中（x は 0）に置く。
 * 断面の横は常に x 軸。「上」U は進行方向 T と x 軸の外積 T×X（胴なら背、首ならたてがみ側、
 * 頭なら顔の正面、脚なら前側）。断面は超楕円（n が大きいほど四角に寄る）。
 * 両端は中心の 1 点でふさぐ。返す rings は、たてがみ・白斑・馬具を体表に沿わせるのに使う。
 */
function loft(ctrl, { per = 4, seg = 16 } = {}) {
  const rings = refine(ctrl, per);
  const X = new THREE.Vector3(1, 0, 0);
  const pos = [];
  const info = [];
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i];
    const prev = rings[Math.max(0, i - 1)].p, next = rings[Math.min(rings.length - 1, i + 1)].p;
    const T = new THREE.Vector3(next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]).normalize();
    const U = new THREE.Vector3().crossVectors(T, X).normalize();
    const c = new THREE.Vector3(...r.p);
    info.push({ c, T, U, w: r.w, up: r.up, dn: r.dn, n: r.n });
    const e = 2 / r.n;
    for (let k = 0; k < seg; k++) {
      const th = (k / seg) * Math.PI * 2;
      const cs = Math.cos(th), sn = Math.sin(th);
      const sx = Math.sign(cs) * Math.abs(cs) ** e;
      const sy = Math.sign(sn) * Math.abs(sn) ** e;
      const x = r.w * sx;
      const y = (sy >= 0 ? r.up : r.dn) * sy;
      pos.push(c.x + X.x * x + U.x * y, c.y + U.y * y, c.z + U.z * y);
    }
  }
  const idx = [];
  const n = rings.length;
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const a = i * seg + k, b = i * seg + (k + 1) % seg, c = (i + 1) * seg + k, d = (i + 1) * seg + (k + 1) % seg;
      idx.push(a, b, c, b, d, c);
    }
  }
  // 両端のふた。中心を少し外へ出して丸める。
  const s0 = pos.length / 3;
  const f = info[0], l = info[n - 1];
  pos.push(f.c.x - f.T.x * 0.004, f.c.y - f.T.y * 0.004, f.c.z - f.T.z * 0.004);
  const e0 = pos.length / 3;
  pos.push(l.c.x + l.T.x * 0.004, l.c.y + l.T.y * 0.004, l.c.z + l.T.z * 0.004);
  for (let k = 0; k < seg; k++) {
    idx.push(s0, (k + 1) % seg, k);
    idx.push(e0, (n - 1) * seg + k, (n - 1) * seg + (k + 1) % seg);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.userData.shared = true;
  return { geo, rings: info };
}

/** 断面の上の点。th は横（+x）から上（U）へ回る角度。off は体表から外への浮かせ。 */
function ringPoint(r, th, off = 0) {
  const e = 2 / r.n;
  const cs = Math.cos(th), sn = Math.sin(th);
  const sx = Math.sign(cs) * Math.abs(cs) ** e;
  const sy = Math.sign(sn) * Math.abs(sn) ** e;
  const x = (r.w + off) * sx;
  const y = ((sy >= 0 ? r.up : r.dn) + off) * sy;
  return new THREE.Vector3(r.c.x + x, r.c.y + r.U.y * y, r.c.z + r.U.z * y);
}

/** 断面の列から、z（または経路の位置）で断面を引く（線形補間）。 */
function ringAtZ(rings, z) {
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i], b = rings[i + 1];
    if ((a.c.z - z) * (b.c.z - z) <= 0) {
      const t = a.c.z === b.c.z ? 0 : (z - a.c.z) / (b.c.z - a.c.z);
      return {
        c: a.c.clone().lerp(b.c, t), T: a.T.clone().lerp(b.T, t).normalize(), U: a.U.clone().lerp(b.U, t).normalize(),
        w: a.w + (b.w - a.w) * t, up: a.up + (b.up - a.up) * t, dn: a.dn + (b.dn - a.dn) * t, n: a.n + (b.n - a.n) * t,
      };
    }
  }
  return rings[rings.length - 1];
}

/**
 * 体表に沿う薄い面（鞍下・鞍・ゼッケン）。zs×ths の格子で、u は z、v は高さ。
 * 平らな箱を載せると、胴の曲面から浮くか沈む（以前の鞍下は円筒で近似して背から浮いていた）。
 */
function surfacePatch(rings, z0, z1, th0, th1, off, { nz = 10, nt = 10, lift = null, flipU = false } = {}) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= nz; i++) {
    const z = z0 + (z1 - z0) * (i / nz);
    const r = ringAtZ(rings, z);
    for (let j = 0; j <= nt; j++) {
      const th = th0 + (th1 - th0) * (j / nt);
      const extra = lift ? lift(i / nz, j / nt) : 0;
      const p = ringPoint(r, th, off + extra);
      pos.push(p.x, p.y, p.z);
      uv.push(flipU ? 1 - i / nz : i / nz, j / nt);
    }
  }
  for (let i = 0; i < nz; i++) {
    for (let j = 0; j < nt; j++) {
      const a = i * (nt + 1) + j, b = a + 1, c = a + nt + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);   // 外向き（体の外から見て表）
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

/** 断面の外周に沿う紐（腹帯・頭絡）。 */
function strapAround(r, off, radius = 0.014) {
  const pts = [];
  for (let k = 0; k < 24; k++) pts.push(ringPoint(r, (k / 24) * Math.PI * 2, off));
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 48, radius, 5, true);
  geo.userData.shared = true;
  return geo;
}

/** 体表から外へ垂れる毛の帯（たてがみ・前髪）。根元の点列と、毛先へのずれ。 */
function hairRibbon(roots, tipOf) {
  const pos = [], idx = [];
  roots.forEach((p, i) => {
    const t = tipOf(p, i);
    pos.push(p.x, p.y, p.z, t.x, t.y, t.z);
  });
  for (let i = 0; i < roots.length - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.userData.shared = true;
  return geo;
}

/**
 * 部品の付け根の法線を、相手（胴・頭）の体表の法線に寄せる。首や脚は胴と別のメッシュなので、
 * 境目で陰が折れて「胴に刺さった部品」に見えた（栗毛の首の付け根に斜めの線が出た）。
 * 相手の体表に近い頂点ほど相手の法線を使い、離れるにつれて自分の法線へ戻す。
 * 部品の組は動く（首を振る・脚を振る）ので、合わせるのは立ち姿。partToTarget は部品 → 相手の座標。
 */
function blendNormalsTo(geo, target, partToTarget, near = 0.04, far = 0.16) {
  const tp = target.getAttribute('position'), tn = target.getAttribute('normal');
  const p = geo.getAttribute('position'), n = geo.getAttribute('normal');
  const back = new THREE.Matrix3().setFromMatrix4(partToTarget).invert();
  const v = new THREE.Vector3(), tv = new THREE.Vector3(), mine = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(partToTarget);
    let bd = Infinity, bj = -1;
    for (let j = 0; j < tp.count; j++) {
      const dx = tp.getX(j) - v.x, dy = tp.getY(j) - v.y, dz = tp.getZ(j) - v.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; bj = j; }
    }
    const d = Math.sqrt(bd);
    if (d >= far) continue;
    const w = clamp01((far - d) / (far - near));
    tv.fromBufferAttribute(tn, bj).applyMatrix3(back).normalize();
    mine.fromBufferAttribute(n, i).lerp(tv, w * w * (3 - 2 * w)).normalize();
    n.setXYZ(i, mine.x, mine.y, mine.z);
  }
}

/** 左右を写した形（左の脚）。法線を寄せた後は左右で中身が違うので、共有の形を使い回せない。 */
function mirrorX(geo) {
  const g = geo.clone();
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  for (let i = 0; i < p.count; i++) { p.setX(i, -p.getX(i)); n.setX(i, -n.getX(i)); }
  const idx = g.getIndex();
  for (let i = 0; i < idx.count; i += 3) {   // 写すと面の巻きが裏返るので戻す
    const b = idx.getX(i + 1);
    idx.setX(i + 1, idx.getX(i + 2));
    idx.setX(i + 2, b);
  }
  g.userData.shared = true;
  return g;
}

// ---------------------------------------------------------------- 形（全頭で共有）

/*
 * 寸法（m）。体高（キ甲）1.60、胸の前から尻の端まで 1.75、腹の下 0.78。
 * 胸から尻までは体高とほぼ同じにする（落とし穴 25。2.2m の胴は腸詰めにしか見えなかった）。
 * 蹄の裏が y = 0。
 */
const NECK_PIVOT = [0, 1.38, 0.58];    // キ甲の前。首はここを支点にうつむく・伸ばす
const POLL = [0, 0.64, 0.68];          // 項（首の組の中）。頭はここを支点に振る
const TAIL_ROOT = [0, 1.47, -0.9];
const FRONT_HIP = { x: 0.165, y: 1.1, z: 0.56 };
const HIND_HIP = { x: 0.185, y: 1.12, z: -0.62 };

let SHAPES = null;

function buildShapes() {
  // 胴。経路は y = 1.2 の z 軸に沿わせ、背の線（上）と腹の線（下）を断面の厚みで描く。
  const torsoDef = [
    // 胸の深さ（キ甲から腹）は 0.75m、胴の幅は 0.6m。深く太くすると脚が短く見えて樽になった。
    [-0.95, 1.32, 1.1, 0.06],
    [-0.9, 1.44, 0.98, 0.17],
    [-0.8, 1.53, 0.9, 0.265],
    [-0.6, 1.565, 0.88, 0.3],      // 尻（腰角のあたりがいちばん高い）
    [-0.36, 1.545, 0.93, 0.29],    // 腰・ひばら（腹が巻き上がる）
    [-0.1, 1.51, 0.88, 0.305],     // 背のくぼみ・胴のいちばん太いところ
    [0.16, 1.525, 0.85, 0.305],
    [0.4, 1.6, 0.86, 0.285],       // キ甲（体高）・帯径
    [0.6, 1.56, 0.92, 0.27],       // 肩
    [0.76, 1.46, 0.98, 0.235],     // 胸前は丸く厚い（細く尖らせると胸が砲弾に見えた）
    [0.85, 1.38, 1.03, 0.19],
    [0.9, 1.3, 1.08, 0.1],
    [0.92, 1.24, 1.12, 0.03],
  ].map(([z, top, bot, w]) => ({ p: [0, 1.2, z], w, up: top - 1.2, dn: 1.2 - bot, n: 2.35 }));
  const torso = loft(torsoDef, { per: 4, seg: 28 });

  // 首（首の組の中）。付け根は胴に埋めて、うつむいても隙間が開かないようにする。
  // 上側（U）がたてがみの側、下側が喉。付け根は上下に深く、項へ向かって細くなる。
  // 喉元（項の下）も 0.24m の深さを残す。細くすると頭が棒の先に付いて、犬か駱駝に見えた。
  const neck = loft([
    { p: [0, -0.1, -0.12], w: 0.235, up: 0.2, dn: 0.36 },
    { p: [0, 0.06, 0.06], w: 0.215, up: 0.2, dn: 0.34 },
    { p: [0, 0.24, 0.26], w: 0.175, up: 0.17, dn: 0.27 },    // 首の付け根は上下に深い（細いと胴から棒が生えて見えた）
    { p: [0, 0.4, 0.44], w: 0.135, up: 0.14, dn: 0.2 },
    { p: [0, 0.53, 0.58], w: 0.11, up: 0.12, dn: 0.17 },
    { p: [0, 0.62, 0.67], w: 0.085, up: 0.07, dn: 0.15 },   // 先は頭の中に収める（項に段ができた）
    // 横は平らに（n を大きく）。丸い管だと胴の脇との境で陰が折れ、首が別の部品に見えた。
  ].map((r) => ({ ...r, n: 2.4 })), { per: 4, seg: 18 });

  // 頭（項の組の中）。項から前下がり 45° に伸ばす。上側（U）が顔の正面、下側が顎。
  // 馬の頭は「長い箱」：額は広く平ら、頬（下顎の後ろ）は大きく丸い板、鼻筋はまっすぐで、
  // 鼻先は細らずに四角く終わる。頬を小さくして鼻先へ細く尖らせると、犬（ボルゾイ）の顔に見えた。
  // 長さ 0.6m、頬の深さ 0.27m、鼻先の幅 0.17m（サラブレッドの実寸）。
  const head = loft([
    [-0.07, 0.085, 0.07, 0.1],     // 項の後ろ（首の先を覆う）
    [0.0, 0.105, 0.078, 0.15],
    [0.09, 0.122, 0.082, 0.185],   // 目の高さ。額がいちばん広い
    [0.18, 0.118, 0.08, 0.19],     // 頬（下顎の角は丸く深い）
    // 顎の線は頬から鼻先まで、鼻筋に向かってまっすぐ狭まる。頬の後ろでえぐると垂れた喉袋と
    // 細い鼻面になり、犬（ボルゾイ）の顔に見えた。
    [0.27, 0.104, 0.077, 0.166],
    [0.36, 0.094, 0.074, 0.143],   // 鼻筋
    [0.45, 0.092, 0.073, 0.125],
    [0.5, 0.094, 0.071, 0.12],     // 鼻先とおとがい（細らせない）
    [0.56, 0.088, 0.068, 0.096],   // 下唇はおとがいより引っ込む
    [0.6, 0.074, 0.062, 0.07],
    // 鼻先は丸めずに切り立たせる（長く丸めると先が垂れて、犬の鼻に見えた）
    [0.622, 0.05, 0.044, 0.042],
    [0.632, 0.014, 0.012, 0.012],
  ].map(([s, w, up, dn]) => ({ p: [0, -s * Math.SQRT1_2, s * Math.SQRT1_2], w, up, dn, n: 2.4 })), { per: 4, seg: 20 });
  // 頭の制御断面 ci 番目（小数可）の断面。
  const hr = (ci) => head.rings[Math.round(ci * 4)];

  // 耳。付け根から上へ、先がわずかに前へ反る。長いと驢馬に見える。
  const ear = loft([
    { p: [0, 0, 0], w: 0.036, up: 0.028, dn: 0.022 },
    { p: [0, 0.06, 0.006], w: 0.032, up: 0.024, dn: 0.018 },
    { p: [0, 0.11, 0.016], w: 0.016, up: 0.012, dn: 0.009 },
    { p: [0, 0.135, 0.024], w: 0.003, up: 0.003, dn: 0.003 },
  ], { per: 3, seg: 8 });

  // 前脚。前腕（筋肉で太い）→ 膝 → 管（すね。細く、後ろに腱が張る）→ 球節 → 繋 → 蹄。
  // 前腕は胸に埋めて付け根の段差を消す。上（U）は脚の前側。
  const foreArm = loft([
    { p: [0, 0.2, 0.03], w: 0.105, up: 0.12, dn: 0.11 },
    { p: [0, 0.0, 0.0], w: 0.088, up: 0.09, dn: 0.095 },
    { p: [0, -0.24, 0.0], w: 0.066, up: 0.062, dn: 0.062 },
    { p: [0, -0.46, 0.0], w: 0.052, up: 0.05, dn: 0.05 },
    { p: [0, -0.54, 0.0], w: 0.05, up: 0.05, dn: 0.05 },
  ], { per: 3, seg: 12 });
  const foreCannon = loft([
    { p: [0, 0.05, 0], w: 0.05, up: 0.05, dn: 0.05 },
    { p: [0, 0.0, 0.004], w: 0.06, up: 0.064, dn: 0.056 },    // 膝のふくらみ
    { p: [0, -0.07, 0], w: 0.05, up: 0.048, dn: 0.05 },
    { p: [0, -0.13, 0], w: 0.04, up: 0.034, dn: 0.05 },      // 管。後ろに屈腱
    { p: [0, -0.29, 0], w: 0.038, up: 0.032, dn: 0.047 },
    { p: [0, -0.345, 0], w: 0.044, up: 0.042, dn: 0.05 },
  ], { per: 3, seg: 12 });
  // 後脚。股（太腿）から脛へ後ろ下がりに伸び、飛節は後ろへ尖る。管は前脚より少し長い。
  const thigh = loft([
    // 付け根は胴の中に収める（胴の脇から突き出すと尻の上に鰭のような段ができた）。
    { p: [0, 0.2, 0.04], w: 0.11, up: 0.17, dn: 0.2 },        // 尻から太腿へ（胴に埋める）
    { p: [0, 0.0, 0.04], w: 0.125, up: 0.21, dn: 0.18 },      // 太腿。前は膝（後膝）へ張り出し、後ろは尻の線へつながる
    { p: [0, -0.2, -0.06], w: 0.088, up: 0.1, dn: 0.13 },     // 脛（下腿）。棒にすると後脚が鹿の脚に見えた
    { p: [0, -0.42, -0.12], w: 0.056, up: 0.055, dn: 0.075 },
    { p: [0, -0.53, -0.14], w: 0.05, up: 0.046, dn: 0.058 },
  ], { per: 3, seg: 12 });
  const hindCannon = loft([
    { p: [0, 0.05, 0.01], w: 0.05, up: 0.048, dn: 0.058 },
    { p: [0, -0.01, 0], w: 0.052, up: 0.05, dn: 0.085 },     // 飛節（後ろへ尖る）
    { p: [0, -0.1, 0], w: 0.042, up: 0.036, dn: 0.05 },
    { p: [0, -0.33, 0], w: 0.039, up: 0.033, dn: 0.048 },
    { p: [0, -0.385, 0], w: 0.044, up: 0.042, dn: 0.05 },
  ], { per: 3, seg: 12 });
  // 球節から下（前後共通）。繋は前へ傾き、蹄は前が斜めに寝る。
  const pastern = loft([
    { p: [0, 0.03, 0], w: 0.046, up: 0.045, dn: 0.052 },
    { p: [0, -0.03, -0.004], w: 0.05, up: 0.047, dn: 0.062 }, // 球節（後ろに距毛のふくらみ）
    { p: [0, -0.09, 0.025], w: 0.037, up: 0.033, dn: 0.036 },
    { p: [0, -0.145, 0.05], w: 0.043, up: 0.04, dn: 0.04 },  // 蹄冠
  ], { per: 3, seg: 12 });
  const hoof = loft([
    { p: [0, -0.14, 0.05], w: 0.046, up: 0.044, dn: 0.044, n: 2 },
    { p: [0, -0.215, 0.066], w: 0.062, up: 0.066, dn: 0.05, n: 2.2 },
    { p: [0, -0.222, 0.066], w: 0.03, up: 0.03, dn: 0.025, n: 2 },
  ], { per: 2, seg: 12 });

  // 尾。尾根（骨のある短い部分）と、そこから垂れる毛。毛は横に広く前後に薄い。
  const dock = loft([
    { p: [0, 0.03, 0.06], w: 0.06, up: 0.06, dn: 0.06 },
    { p: [0, -0.06, -0.03], w: 0.055, up: 0.05, dn: 0.05 },
    { p: [0, -0.17, -0.08], w: 0.045, up: 0.04, dn: 0.04 },
  ], { per: 3, seg: 10 });
  const tailHair = loft([
    { p: [0, 0.02, 0], w: 0.05, up: 0.04, dn: 0.04 },
    { p: [0, -0.18, -0.03], w: 0.085, up: 0.05, dn: 0.05 },
    { p: [0, -0.42, -0.035], w: 0.095, up: 0.046, dn: 0.046 },
    { p: [0, -0.6, -0.01], w: 0.075, up: 0.036, dn: 0.036 },
    { p: [0, -0.72, 0.01], w: 0.04, up: 0.022, dn: 0.022 },
    { p: [0, -0.77, 0.015], w: 0.01, up: 0.008, dn: 0.008 },
  ].map((r) => ({ ...r, n: 2.6 })), { per: 4, seg: 12 });

  // たてがみ：首の上の線から右へ垂らす（日本の競走馬はたてがみを右に落とすのが普通）。
  // 毛先はぎざぎざにする（一枚の板に見えないように）。
  const maneRoots = [];
  const crest = neck.rings.slice(2, neck.rings.length - 1);
  crest.forEach((r) => maneRoots.push(ringPoint(r, Math.PI / 2 - 0.15, -0.004)));
  const mane = hairRibbon(maneRoots, (p, i) => {
    const r = crest[i];
    const len = 0.1 + 0.05 * Math.sin(i * 2.7) ** 2 + (i < 3 ? -0.03 : 0);
    return p.clone().add(new THREE.Vector3(0.05, 0, 0)).addScaledVector(r.U, -len);
  });
  // たてがみの根元の帯。首の上の線に沿わせて、左から見ても鬣の線が見えるようにする。
  const crestHair = surfacePatch(neck.rings, 0.0, 0.66, Math.PI / 2 - 0.42, Math.PI / 2 + 0.42, 0.012, { nz: 14, nt: 6 });
  // 前髪：両耳の間から額へ。
  const flRoots = [0.5, 0.7, 0.9].map((t) => ringPoint(hr(0.7), Math.PI / 2 + (t - 0.7) * 0.9, -0.002));
  const forelock = hairRibbon(flRoots, (p) => p.clone().add(new THREE.Vector3(0, -0.105, 0.125)));

  // 白斑。顔の正面に沿わせた帯（星・流星・大流星）。体表から少しだけ浮かせる。
  const faceStrip = (from, to, half) => {
    const rs = head.rings.slice(from, to);
    const pos = [], idx = [];
    rs.forEach((r, i) => {
      const t = i / (rs.length - 1);
      const hw = half(t) / Math.max(0.03, r.w);   // 角度に直す
      const a = ringPoint(r, Math.PI / 2 - hw, 0.003), b = ringPoint(r, Math.PI / 2 + hw, 0.003);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    });
    for (let i = 0; i < rs.length - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.userData.shared = true;
    return geo;
  };
  const nh = head.rings.length;
  const star = faceStrip(8, 15, (t) => 0.032 * Math.sin(Math.PI * t));
  const blaze = faceStrip(9, nh - 4, (t) => 0.014 + 0.012 * t);
  const wideBlaze = faceStrip(7, nh - 2, (t) => 0.032 + 0.026 * t);

  // 目は額と頬の境（顔の横）に、項から頭の長さの 3 分の 1 ほど下。顔の前に寄せると犬に見える。
  // 目の上には眼窩の骨の張り出し（眉）を付ける。
  const eyes = [-1, 1].map((sx) => ringPoint(hr(3.0), sx > 0 ? 0.3 : Math.PI - 0.3, -0.014));
  const brows = [-1, 1].map((sx) => ringPoint(hr(2.85), sx > 0 ? 0.54 : Math.PI - 0.54, -0.024));
  // 鼻の穴は鼻先の前寄りの横に、頭の向きに沿った細長い切れ込み。
  const nostrils = [-1, 1].map((sx) => ringPoint(hr(8.3), sx > 0 ? 0.6 : Math.PI - 0.6, -0.01));
  // 口の線：鼻先の横、上唇と下唇の合わせ目。
  const mouth = [-1, 1].map((sx) => {
    const pts = [7.7, 8.4, 9.1, 9.8, 10.3].map((c) => ringPoint(hr(c), sx > 0 ? -0.3 : Math.PI + 0.3, -0.001));
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.0045, 5, false);
    geo.userData.shared = true;
    return geo;
  });
  const earBase = [-1, 1].map((sx) => ringPoint(hr(1.2), sx > 0 ? 1.15 : Math.PI - 1.15, -0.02));

  // 馬具（詳細画面の 1 頭だけ）。鞍下・鞍は胴の背に沿わせる。
  const pad = surfacePatch(torso.rings, -0.16, 0.38, Math.PI / 2 - 1.22, Math.PI / 2 + 1.22, 0.012, { nz: 12, nt: 16 });
  const saddle = surfacePatch(torso.rings, -0.06, 0.28, Math.PI / 2 - 0.62, Math.PI / 2 + 0.62, 0.03,
    { nz: 12, nt: 10, lift: (u) => 0.05 * Math.max(0, (Math.abs(u - 0.45) - 0.3) / 0.25) ** 2 });
  // 腹帯は幅のある帯（細い紐にすると針金に見えた）。鞍下の縁から腹の下を回る。
  const girth = surfacePatch(torso.rings, 0.21, 0.29, Math.PI / 2 + 1.12, Math.PI / 2 - 1.12 + Math.PI * 2, 0.016, { nz: 2, nt: 28 });
  const noseband = strapAround(hr(5.2), 0.006, 0.011);
  const crownStrap = strapAround(hr(0.7), 0.008, 0.011);
  // ゼッケン（鞍下に付く番号布）。左右で文字が裏返らないよう u を反転する。
  const clothR = surfacePatch(torso.rings, -0.14, 0.32, -0.62, 0.12, 0.016, { nz: 10, nt: 8, flipU: true });
  const clothL = surfacePatch(torso.rings, -0.14, 0.32, Math.PI - 0.12, Math.PI + 0.62, 0.016, { nz: 10, nt: 8 });
  // 左側は角度が上から下へ進むので、v を上下に返す。
  const vL = clothL.getAttribute('uv');
  for (let i = 0; i < vL.count; i++) vL.setY(i, 1 - vL.getY(i));

  // 首・前腕・太腿の付け根の陰を胴（と頭）に合わせる。立ち姿の組の位置と回転で重ねる。
  const at = (pos, rotX = 0) => new THREE.Matrix4().makeRotationX(rotX).setPosition(...pos);
  blendNormalsTo(neck.geo, torso.geo, at(NECK_PIVOT, 0.1));
  blendNormalsTo(neck.geo, head.geo, at(POLL.map((v) => -v)), 0.02, 0.08);
  blendNormalsTo(foreArm.geo, torso.geo, at([FRONT_HIP.x, FRONT_HIP.y, FRONT_HIP.z]));
  blendNormalsTo(thigh.geo, torso.geo, at([HIND_HIP.x, HIND_HIP.y, HIND_HIP.z], 0.04));
  const foreArmL = mirrorX(foreArm.geo), thighL = mirrorX(thigh.geo);

  const sphere = (r, w = 12, h = 9) => {
    const g = new THREE.SphereGeometry(r, w, h);
    g.userData.shared = true;
    return g;
  };

  return {
    torso, neck, head, ear, foreArm, foreArmL, foreCannon, thigh, thighL, hindCannon, pastern, hoof, dock, tailHair,
    mane, crestHair, forelock, star, blaze, wideBlaze, eyes, brows, nostrils, earBase, pad, saddle, girth, noseband, crownStrap,
    clothR, clothL, eyeGeo: sphere(0.027, 12, 10), browGeo: sphere(0.034, 10, 8), nostrilGeo: sphere(0.024, 10, 8), mouth,
    rider: buildRiderShapes(),
  };
}

/** 2 点を結ぶ肢（カプセル）。 */
function limbGeo(r, len) {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 4, 10);
  g.userData.shared = true;
  return g;
}

function buildRiderShapes() {
  const sh = (g) => { g.userData.shared = true; return g; };
  return {
    torso: limbGeo(0.15, 0.62),
    hips: sh(new THREE.SphereGeometry(0.15, 12, 9)),
    head: sh(new THREE.SphereGeometry(0.095, 12, 10)),
    helmet: sh(new THREE.SphereGeometry(0.118, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.58)),
    peak: sh(new THREE.CylinderGeometry(0.11, 0.11, 0.012, 14, 1, false, -0.9, 1.8)),
    upperArm: limbGeo(0.048, 0.3),
    foreArm: limbGeo(0.042, 0.28),
    thigh: limbGeo(0.075, 0.42),
    shin: limbGeo(0.056, 0.38),
    boot: limbGeo(0.06, 0.22),
  };
}

const shapes = () => (SHAPES ??= buildShapes());

/** 肢を from → to に向けて置く（カプセルはローカル +y に伸びる）。 */
const Y_AXIS = new THREE.Vector3(0, 1, 0);
function placeLimb(mesh, from, to) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(Y_AXIS, b.sub(a).normalize());
  return mesh;
}

// ---------------------------------------------------------------- 1 頭

/**
 * 1 頭ぶんのモデルを作る。
 *
 * @param {{bare?:boolean, tack?:boolean}} opts
 *   bare=true で騎手とゼッケンを付けない（牧場用）。
 *   tack=true で鞍と頭絡を付ける（馬の詳細で 1 頭だけ大きく見せるとき）
 * @returns {{group:THREE.Group, update:Function, legs:Array, body:THREE.Group, rider:THREE.Group|null}}
 */
export function makeHorse({ id = 1, gate = 1, frame = 1, coat = '鹿毛', scale = 1, bare = false, tack = false, padColor = 0xe8c33a } = {}) {
  const S = shapes();
  const group = new THREE.Group();
  const body = new THREE.Group();   // 胴体まわり（上下に揺れる）
  group.add(body);

  // 毛の艶。Lambert（艶なし）だと近くで見たとき粘土に見えた。毛は少し光る。
  const coatColor = COAT[coat] ?? COAT['鹿毛'];
  const hide = new THREE.MeshStandardMaterial({ color: coatColor, roughness: 0.52, metalness: 0 });
  const pts = pointsOf(coat);
  const hairMat = new THREE.MeshStandardMaterial({ color: pts.mane, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  const legLow = pts.leg == null ? hide : new THREE.MeshStandardMaterial({ color: pts.leg, roughness: 0.6, metalness: 0 });
  const hoofMat = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.45, metalness: 0 });
  const paleHoof = new THREE.MeshStandardMaterial({ color: 0x8a7860, roughness: 0.45, metalness: 0 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.6, metalness: 0, side: THREE.DoubleSide });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x120a06, roughness: 0.15, metalness: 0 });
  const nostrilMat = new THREE.MeshStandardMaterial({ color: 0x140c08, roughness: 0.7, metalness: 0 });

  const mesh = (parent, geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  // --- 胴 ---
  mesh(body, S.torso.geo, hide);

  // --- 首と頭 ---
  // 首と頭はキ甲を支点にした組にして、うつむき（草を食む）も表せるようにする。
  const neckPivot = new THREE.Group();
  neckPivot.position.set(...NECK_PIVOT);
  body.add(neckPivot);
  mesh(neckPivot, S.neck.geo, hide);
  mesh(neckPivot, S.mane, hairMat);
  mesh(neckPivot, S.crestHair, hairMat);
  const headPivot = new THREE.Group();
  headPivot.position.set(...POLL);
  neckPivot.add(headPivot);
  mesh(headPivot, S.head.geo, hide);
  mesh(headPivot, S.forelock, hairMat);
  // 目・眉・鼻の穴は頭の向き（前下がり 45°）に沿わせた楕円。ローカル y が頭の軸になる。
  const alongHead = (m, sx, sy, sz) => { m.rotation.x = -Math.PI / 4; m.scale.set(sx, sy, sz); return m; };
  for (const p of S.eyes) alongHead(mesh(headPivot, S.eyeGeo, eyeMat, p.x, p.y, p.z), 0.6, 1.25, 1);
  for (const p of S.brows) alongHead(mesh(headPivot, S.browGeo, hide, p.x, p.y, p.z), 0.5, 1.4, 0.75);
  for (const p of S.nostrils) alongHead(mesh(headPivot, S.nostrilGeo, nostrilMat, p.x, p.y, p.z), 0.5, 1.7, 0.9);
  for (const g of S.mouth) mesh(headPivot, g, nostrilMat);
  const ears = S.earBase.map((p, i) => {
    const pivot = new THREE.Group();
    pivot.position.copy(p);
    pivot.rotation.z = (i === 0 ? 1 : -1) * 0.22;   // 少し外へ開く
    pivot.rotation.x = 0.25;
    headPivot.add(pivot);
    mesh(pivot, S.ear.geo, hide);
    return pivot;
  });

  // 白斑。芦毛・白毛は地色が白いので付けない。決まり方は馬 id から（同じ馬はいつも同じ顔）。
  const markable = coat !== '芦毛' && coat !== '白毛';
  if (markable) {
    const f = hash01(id, 1);
    const face = f < 0.42 ? null : f < 0.66 ? S.star : f < 0.86 ? S.blaze : S.wideBlaze;
    if (face) mesh(headPivot, face, white);
  }

  // --- 尾（付け根を支点に、走ると後ろへ流れる。毛は付け根の先でもう一段しなる） ---
  const tailPivot = new THREE.Group();
  tailPivot.position.set(...TAIL_ROOT);
  body.add(tailPivot);
  mesh(tailPivot, S.dock.geo, hide);
  const tailFlow = new THREE.Group();
  tailFlow.position.set(0, -0.15, -0.075);
  tailPivot.add(tailFlow);
  mesh(tailFlow, S.tailHair.geo, hairMat);

  // --- 脚 ---
  // 3 節：股（肩・腰）→ 膝（前）／飛節（後）→ 球節。ピボットは各節の上端。
  // phase は襲歩（ギャロップ）と常歩（なみあし）でそれぞれ違う拍子。
  const legs = [];
  const legDef = [
    { side: -1, front: true, gallop: 0.50, walk: 0.25 },   // 左前
    { side: 1, front: true, gallop: 0.62, walk: 0.75 },    // 右前
    { side: -1, front: false, gallop: 0.00, walk: 0.00 },  // 左後
    { side: 1, front: false, gallop: 0.12, walk: 0.50 },   // 右後
  ];
  legDef.forEach((d, li) => {
    const base = d.front ? FRONT_HIP : HIND_HIP;
    const hip = new THREE.Group();
    hip.position.set(d.side * base.x, base.y, base.z);
    body.add(hip);
    // 付け根の陰を胴に合わせてあるので、左の脚は左右を写した形を使う。
    mesh(hip, d.front ? (d.side < 0 ? S.foreArmL : S.foreArm.geo) : (d.side < 0 ? S.thighL : S.thigh.geo), hide);
    const knee = new THREE.Group();
    // 前は膝が股の真下、後ろは飛節が股より後ろ（脛が後ろ下がり）。
    if (d.front) knee.position.set(0, -0.535, 0);
    else knee.position.set(0, -0.525, -0.14);
    hip.add(knee);
    mesh(knee, d.front ? S.foreCannon.geo : S.hindCannon.geo, legLow);
    const fetlock = new THREE.Group();
    fetlock.position.set(0, d.front ? -0.345 : -0.385, 0);
    knee.add(fetlock);
    // 白い靴下：その脚の球節から下を白く、蹄も明るくする（id から決まる）。
    const sock = markable && hash01(id, 10 + li) < 0.22;
    mesh(fetlock, S.pastern.geo, sock ? white : legLow);
    mesh(fetlock, S.hoof.geo, sock ? paleHoof : hoofMat);
    legs.push({ hip, knee, fetlock, front: d.front, gallop: d.gallop, walk: d.walk });
  });

  // --- 騎手（牧場では付けない） ---
  let rider = null;
  if (!bare) {
    const [silkA, silkB] = silksColors(id);
    const silksMat = new THREE.MeshStandardMaterial({ color: silkA, roughness: 0.45, metalness: 0 });
    const capMat = new THREE.MeshStandardMaterial({ color: silkB, roughness: 0.4, metalness: 0 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xe0b48c, roughness: 0.7, metalness: 0 });
    const breeches = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.7, metalness: 0 });
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x15110e, roughness: 0.35, metalness: 0 });
    const R = S.rider;
    rider = new THREE.Group();
    rider.position.set(0, 1.6, -0.06);
    // モンキー乗り：腰を鞍から浮かせ、背中はほぼ水平、頭は前を見る。鐙は短く、膝が高い。
    const hips = mesh(rider, R.hips, breeches, 0, 0.2, -0.04);
    hips.scale.set(1, 0.85, 1.05);
    placeLimb(mesh(rider, R.torso, silksMat), [0, 0.24, -0.02], [0, 0.42, 0.5]);
    mesh(rider, R.head, skinMat, 0, 0.53, 0.6);
    const helmet = mesh(rider, R.helmet, capMat, 0, 0.55, 0.59);
    helmet.rotation.x = 0.35;
    const peak = mesh(rider, R.peak, capMat, 0, 0.56, 0.62);
    peak.rotation.x = 0.35;
    for (const sx of [-1, 1]) {
      const sh = [sx * 0.16, 0.44, 0.4], el = [sx * 0.2, 0.26, 0.5], hand = [sx * 0.09, 0.2, 0.74];
      placeLimb(mesh(rider, R.upperArm, silksMat), sh, el);
      placeLimb(mesh(rider, R.foreArm, capMat), el, hand);
      // 鐙は馬の脇。足首を胴の幅より内に置くと、背の上に立っているように見えた。
      const hp = [sx * 0.13, 0.18, -0.02], kn = [sx * 0.25, 0.13, 0.34], an = [sx * 0.31, -0.2, 0.2];
      placeLimb(mesh(rider, R.thigh, breeches), hp, kn);
      placeLimb(mesh(rider, R.shin, bootMat), kn, an);
      placeLimb(mesh(rider, R.boot, bootMat), an, [an[0], an[1] - 0.04, an[2] + 0.12]);
    }
    body.add(rider);

    // --- ゼッケン（馬番）。胴の脇に沿わせる ---
    const side = new THREE.MeshStandardMaterial({ map: numberTexture(gate, frame), roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
    mesh(body, S.clothR, side);
    mesh(body, S.clothL, side);
  }

  // --- 馬具（詳細画面の 1 頭だけ） ---
  if (tack) {
    const strap = new THREE.MeshStandardMaterial({ color: 0x2a1d16, roughness: 0.55, metalness: 0 });
    mesh(body, S.pad, new THREE.MeshStandardMaterial({ color: padColor, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }));
    mesh(body, S.saddle, new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.35, metalness: 0, side: THREE.DoubleSide }));
    mesh(body, S.girth, strap);
    // 頭絡は頭の組に付けるので、首を振ってもずれない。
    mesh(headPivot, S.noseband, strap);
    mesh(headPivot, S.crownStrap, strap);
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
    // 常歩と襲歩では 1 完歩の長さも脚の振り幅も違う。レースの速度（10m/s 以上）では gait = 1。
    const gait = clamp01((v - 2) / 8);
    const stride = 1.7 + (STRIDE - 1.7) * gait;
    phase = (phase + ds / stride) % 1;
    const moving = clamp01(v / 0.8);           // 止まっていれば脚はまっすぐ
    const tau = Math.PI * 2;
    const hipAmp = 0.9 * (0.38 + 0.62 * gait) * moving;
    const kneeAmp = 1.35 * (0.45 + 0.55 * gait) * moving;

    for (const leg of legs) {
      const lp = leg.walk + (leg.gallop - leg.walk) * gait;
      const a = ((phase + lp) % 1) * tau;
      // 股は前後に振る（正で脚が後ろへ）。後ろへ送る間（踏ん張る間）は脚が伸び、
      // 前へ振り出す間に膝・飛節を畳む。前脚の膝は蹄を後ろへ、後脚の飛節は蹄を前へ畳む
      // （以前は前後とも同じ向きに曲げていて、前脚が逆関節に見えた）。
      const hipRot = Math.sin(a) * hipAmp + (leg.front ? 0 : 0.04);
      const swing = Math.max(0, -Math.cos(a));
      const stance = Math.max(0, Math.cos(a));
      leg.hip.rotation.x = hipRot;
      leg.knee.rotation.x = leg.front ? swing * kneeAmp : -swing * kneeAmp * 0.75 - 0.03 * moving;
      // 球節：振り出しで蹄を返し、踏ん張りでは沈んで蹄を地面に平らに保つ。
      leg.fetlock.rotation.x = swing * 0.9 * moving * (0.5 + 0.5 * gait)
        - stance * Math.max(0, hipRot) * 0.6 - stance * 0.18 * gait;
    }
    // 胴の上下動は 1 完歩に 1 回。沈み込みで前肢が着く。常歩ではほとんど揺れない。
    const bobAmp = (0.015 + 0.06 * gait) * moving;
    body.position.y = Math.sin(phase * tau) * bobAmp;
    body.rotation.x = Math.cos(phase * tau) * 0.045 * gait;
    body.rotation.z = bank;
    const run = Math.min(1, v / 18);
    const t = idle?.t ?? 0;
    const graze = idle?.graze ?? 0;
    // 首はキ甲を支点に前へ倒す。速いほど首を前に伸ばし、完歩に合わせて頭を振る。うつむくと鼻先が地面に届く。
    neckPivot.rotation.x = 0.1 + run * 0.34 + graze * 1.32
      + Math.sin(phase * tau + 1.2) * 0.07 * gait
      + (idle ? Math.sin(t * 0.9 + id) * 0.03 * (1 - moving) : 0);
    headPivot.rotation.x = run * 0.18 + graze * 0.3;
    // 耳：走るときは前へ伏せ、牧場では時々向きを変える。
    for (let i = 0; i < ears.length; i++) {
      ears[i].rotation.x = 0.25 - run * 0.55 + (idle ? Math.sin(t * 0.7 + id * 3 + i * 2.1) * 0.25 * (1 - moving) : 0);
    }
    // 尾は後ろへ流れ、毛先は付け根より遅れてしなる。
    // 襲歩でも尾は水平より少し下に流れる（上げ過ぎると棒に見えた）。
    tailPivot.rotation.x = 0.3 + run * 0.78;
    tailFlow.rotation.x = run * 0.2 + Math.sin(phase * tau * 2) * 0.08 * gait;
    // 止まっているときは尾をゆっくり振る（牧場の画面だけ）。
    const sway = idle ? Math.sin(t * 1.6 + id * 1.7) * 0.22 * (1 - moving) : 0;
    tailPivot.rotation.z = sway;
    tailFlow.rotation.z = sway * 0.8;
    if (rider) rider.rotation.x = -run * 0.08 - Math.cos(phase * tau) * 0.03 * gait;
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

/**
 * モデルを捨てる。形（ジオメトリ）は全頭で使い回しているので捨てない（userData.shared）。
 * 捨てると次に描くときに作り直しになる。材質だけ捨てる。
 */
export function disposeHorse(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.geometry?.userData?.shared) o.geometry?.dispose();
    o.material?.dispose?.();
  });
}

export { COAT as COAT_COLORS, STRIDE };
