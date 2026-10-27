// 馬の頭。項の組（POLL）の中の座標で作る。horse3d.js が使う。
//
// 頭は首や胴と同じく「軸に沿って並べた断面」で作るが、断面を超楕円 1 つで表すと、
// 額の平らさ・頬（咬筋）のふくらみ・下顎の線・鼻先のふくらみを描き分けられず、
// 犬の鼻面か箱に見えた。ここでは断面の右半分を 5 点（額の中央・額の肩・最大幅・下顎の肩・
// 下顎の中央）を通る曲線で持ち、頭の軸に沿って補う。
//
// その上に、目のくぼみ・眼窩の縁・眼窩上のくぼみ・顔稜・咬筋・鼻の穴・口の線・おとがいを
// 「体表の座標」で置いた凹凸として足す。体表の座標は (s, f)：s は項から鼻先へ向かう頭の軸の位置、
// f は額の中央線（顔の正面）からの弧の長さを、その断面の半周で割ったもの（右が正、0 が正面、±1 が顎の下）。
// 毛色・鼻先の黒み・鼻の穴の中・口の線・白斑も同じ座標で布（テクスチャ）に描くので、
// 形と模様が必ず同じ場所に来る（白斑を別の板で貼ると、額の曲面から浮くか沈んだ）。
//
// 頭の軸は前下がり 45°（T）、顔の正面は U（T と x の外積）。この組の中では y が上、z が前。

import * as THREE from '../../vendor/three/three.module.min.js';

const SQ = Math.SQRT1_2;
/** 頭の軸（項 → 鼻先）。 */
export const HEAD_T = new THREE.Vector3(0, -SQ, SQ);
/** 顔の正面（額・鼻筋の向き）。 */
export const HEAD_U = new THREE.Vector3(0, SQ, SQ);
const S0 = -0.08;
const S1 = 0.636;

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const clamp01 = (x) => clamp(x, 0, 1);
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const cr = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

/** 馬 id からの決まった乱数（白斑の形など。乱数の流れに触らない）。horse3d.js と同じ式。 */
export function hash01(id, salt) {
  let h = (Math.imul(id + 1, 2654435761) ^ Math.imul(salt + 7, 40503)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- 断面

/*
 * 断面の右半分を通る 5 点（m。y は顔の正面 U 側が正）：
 *   額の中央 (0, top)・額の肩 (tw, ty)・最大幅 (w, wy)・下顎の肩 (bw, by)・下顎の中央 (0, bot)
 * [s, top, tw, ty, w, wy, bw, by, bot]
 *
 * サラブレッドの実寸：頭の長さ 0.63m、頬（下顎の角）の深さ 0.29m（長さの 47%）、
 * 目の幅 0.21m、頬の幅 0.24m、鼻筋の中ほどの幅 0.17m、鼻先の幅 0.17m。
 * 額は平らで広く（肩が高い）、鼻筋の中ほどは台形（上が狭く、顔稜の高さで広い）、
 * 頬は下へ深く丸く張り出し、顎の線は口角まで鼻筋に向かってまっすぐ狭まる。
 */
const ROWS = [
  [-0.08, 0.055, 0.042, 0.046, 0.07, 0.0, 0.05, -0.07, -0.1],      // 項の後ろ（首の先を覆う）
  [0.0, 0.075, 0.058, 0.066, 0.098, -0.025, 0.08, -0.125, -0.172],  // 項・耳の付け根・喉（頬の後ろの縁は深く立ち上がる）
  [0.07, 0.083, 0.08, 0.068, 0.117, -0.06, 0.084, -0.19, -0.236], // 頬の後ろの縁
  [0.12, 0.084, 0.086, 0.067, 0.121, -0.07, 0.08, -0.205, -0.248],  // 目の高さ。額がいちばん広く、頬がいちばん深い
  [0.19, 0.083, 0.084, 0.065, 0.117, -0.06, 0.072, -0.195, -0.228],
  [0.26, 0.081, 0.062, 0.066, 0.098, -0.035, 0.058, -0.145, -0.172], // 頬の前の縁。ここから顎の線
  [0.34, 0.077, 0.048, 0.064, 0.08, -0.025, 0.05, -0.117, -0.142],  // 鼻筋の中ほど（台形：上が狭い）
  [0.42, 0.074, 0.042, 0.061, 0.068, -0.025, 0.045, -0.1, -0.124],
  [0.49, 0.073, 0.044, 0.059, 0.066, -0.02, 0.046, -0.094, -0.12],
  [0.545, 0.07, 0.054, 0.056, 0.076, -0.012, 0.052, -0.095, -0.126], // 鼻の穴の張り・おとがい
  [0.585, 0.065, 0.056, 0.05, 0.079, -0.014, 0.05, -0.084, -0.106], // 鼻の穴の高さがいちばん広い
  [0.612, 0.054, 0.05, 0.04, 0.068, -0.016, 0.044, -0.064, -0.083], // 上唇（鼻先は細らせず丸く大きい）
  [0.627, 0.034, 0.032, 0.024, 0.046, -0.014, 0.03, -0.04, -0.052],
  [0.636, 0.006, 0.006, 0.004, 0.01, -0.004, 0.006, -0.008, -0.012],
];

/** 軸の位置 s の断面の 5 点（制御断面を Catmull-Rom で補う）。 */
function rowAt(s) {
  s = clamp(s, S0, S1);
  let i = 0;
  while (i < ROWS.length - 2 && ROWS[i + 1][0] < s) i++;
  const a = ROWS[Math.max(0, i - 1)], b = ROWS[i], c = ROWS[i + 1], d = ROWS[Math.min(ROWS.length - 1, i + 2)];
  const t = (s - b[0]) / (c[0] - b[0]);
  const out = [s];
  for (let k = 1; k < 9; k++) out.push(cr(a[k], b[k], c[k], d[k], t));
  // 補間の行き過ぎで幅が負にならないように（鼻先）。
  for (const k of [2, 4, 6]) out[k] = Math.max(0.0015, out[k]);
  return out;
}

const HALF_N = 64;
const halfCache = new Map();

/**
 * 断面の右半分の曲線（額の中央から顎の下の中央まで）。弧の長さで引けるように累積長を持つ。
 * 中央線をまたぐ向きの接線が水平になるよう、両端に左右対称の点を足して Catmull-Rom でつなぐ。
 */
function halfCurve(s) {
  const key = Math.round(s * 1e6);
  const hit = halfCache.get(key);
  if (hit) return hit;
  const [, top, tw, ty, w, wy, bw, by, bot] = rowAt(s);
  const P = [[-tw, ty], [0, top], [tw, ty], [w, wy], [bw, by], [0, bot], [-bw, by]];
  const n = HALF_N / 4;
  const xs = [], ys = [];
  for (let i = 1; i <= 4; i++) {
    for (let k = 0; k < n; k++) {
      const t = k / n;
      xs.push(Math.max(0, cr(P[i - 1][0], P[i][0], P[i + 1][0], P[i + 2][0], t)));
      ys.push(cr(P[i - 1][1], P[i][1], P[i + 1][1], P[i + 2][1], t));
    }
  }
  xs.push(0); ys.push(bot);
  const as = [0];
  for (let i = 1; i < xs.length; i++) as.push(as[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
  const h = { xs, ys, as, L: as[as.length - 1] };
  if (halfCache.size > 4000) halfCache.clear();
  halfCache.set(key, h);
  return h;
}

/** 半周の曲線の上で、額の中央から弧の長さ a の点と外向きの法線（断面の中の 2 次元）。 */
function onHalf(h, a) {
  a = clamp(a, 0, h.L);
  let lo = 0, hi = h.as.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (h.as[mid] <= a) lo = mid; else hi = mid;
  }
  const t = (a - h.as[lo]) / Math.max(1e-9, h.as[hi] - h.as[lo]);
  const x = h.xs[lo] + (h.xs[hi] - h.xs[lo]) * t;
  const y = h.ys[lo] + (h.ys[hi] - h.ys[lo]) * t;
  const dx = h.xs[hi] - h.xs[lo], dy = h.ys[hi] - h.ys[lo];
  const len = Math.hypot(dx, dy) || 1;
  // 上から下へ回る向きの接線 (dx, dy) に対して、外向きは (-dy, dx)。
  return { x, y, nx: -dy / len, ny: dx / len };
}

/** 断面 s で、高さ y（顔の正面 U 側が正）にある体表の点の弧の長さ。目や鼻の穴を「高さ」で置くのに使う。 */
function aOfY(s, y) {
  const h = halfCurve(s);
  for (let i = 0; i < h.ys.length - 1; i++) {
    if ((h.ys[i] - y) * (h.ys[i + 1] - y) <= 0) {
      const t = (y - h.ys[i]) / ((h.ys[i + 1] - h.ys[i]) || 1);
      return h.as[i] + (h.as[i + 1] - h.as[i]) * t;
    }
  }
  return y > h.ys[0] ? 0 : h.L;
}

// ---------------------------------------------------------------- 凹凸（体表の座標で置く）

let FEAT = null;

/** 顔の部品の位置。弧の長さ a（m）で持つ。 */
function features() {
  if (FEAT) return FEAT;
  const eye = { s: 0.168, a: aOfY(0.168, 0.036) };
  // 鼻の穴：下前の丸い穴から、上後ろ（鼻筋の側）へ細く反る切れ込み（コンマの形）。
  // 鼻先の真正面ではなく、上唇の上・鼻先から 5〜8cm 後ろの横にある。
  const nostril = [
    { s: 0.58, a: aOfY(0.58, 0.026), r: 0.0138 },
    { s: 0.566, a: aOfY(0.566, 0.044), r: 0.0095 },
    { s: 0.55, a: aOfY(0.55, 0.055), r: 0.0055 },
    { s: 0.53, a: aOfY(0.53, 0.06), r: 0.002 },
  ];
  FEAT = {
    eye,
    // 顔稜：目の下から前へ走る骨の稜。
    crest: [{ s: eye.s + 0.04, a: eye.a + 0.045 }, { s: eye.s + 0.17, a: aOfY(eye.s + 0.17, -0.012) }],
    // 咬筋：頬の大きな筋肉。目の後ろ下。
    masseter: { s: eye.s - 0.015, a: aOfY(eye.s - 0.015, -0.1) },
    nostril,
    // 口の線：鼻先から口角まで。
    mouth: [{ s: 0.632, a: aOfY(0.632, -0.022) }, { s: 0.6, a: aOfY(0.6, -0.036) }, { s: 0.535, a: aOfY(0.535, -0.05) }],
    // 上唇のふくらみ（鼻の穴の前下）。
    lip: { s: 0.612, a: aOfY(0.612, 0.0) },
  };
  return FEAT;
}

const g2 = (ds, da, ss, sa) => Math.exp(-(ds * ds) / (2 * ss * ss) - (da * da) / (2 * sa * sa));

/** 点 (s, a) から折れ線 pts までの距離と、線に沿った位置（0..1）。 */
function toPolyline(s, a, pts) {
  let best = Infinity, at = 0, acc = 0, total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1].s - pts[i].s, pts[i + 1].a - pts[i].a);
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    const vx = q.s - p.s, vy = q.a - p.a;
    const len2 = vx * vx + vy * vy || 1e-12;
    const t = clamp01(((s - p.s) * vx + (a - p.a) * vy) / len2);
    const d = Math.hypot(s - (p.s + vx * t), a - (p.a + vy * t));
    const seg = Math.sqrt(len2);
    if (d < best) { best = d; at = (acc + seg * t) / (total || 1); }
    acc += seg;
  }
  return { d: best, t: at };
}

/** 鼻の穴の符号付き距離（内側が負）。丸い穴から細い切れ込みへ半径をつなぐ。 */
function nostrilSdf(s, a) {
  const N = features().nostril;
  let best = Infinity;
  for (let i = 0; i < N.length - 1; i++) {
    const p = N[i], q = N[i + 1];
    const vx = q.s - p.s, vy = q.a - p.a;
    const len2 = vx * vx + vy * vy;
    const t = clamp01(((s - p.s) * vx + (a - p.a) * vy) / len2);
    const d = Math.hypot(s - (p.s + vx * t), a - (p.a + vy * t)) - (p.r + (q.r - p.r) * t);
    if (d < best) best = d;
  }
  return best;
}

/**
 * 体表の凹凸（外向きが正、m）。a は額の中央からの弧の長さ、L はその断面の半周。
 * 大きさは実物の骨格・筋肉の張りに合わせた控えめな値（数 mm）。強くすると粘土細工に見える。
 */
function disp(s, a, L) {
  const F = features();
  let d = 0;
  // 目の玉が入るくぼみと、眼窩の縁（額側ほど張る）。
  const de = Math.hypot(s - F.eye.s, a - F.eye.a);
  if (de < 0.07) {
    d -= 0.009 * Math.exp(-(de * de) / (2 * 0.012 * 0.012));
    const above = clamp01(0.5 + (F.eye.a - a) / 0.05);
    d += (0.003 + 0.0045 * above) * Math.exp(-((de - 0.03) ** 2) / (2 * 0.007 * 0.007));
  }
  // 眼窩上のくぼみ（目の後ろ上。年を取ると深くなる窪み）。
  d -= 0.005 * g2(s - (F.eye.s - 0.05), a - (F.eye.a - 0.032), 0.015, 0.014);
  // 顔稜。
  const c = toPolyline(s, a, F.crest);
  if (c.d < 0.03) d += 0.0042 * Math.exp(-(c.d * c.d) / (2 * 0.0065 * 0.0065)) * smooth(0, 0.15, c.t) * smooth(1, 0.7, c.t);
  // 咬筋。
  d += 0.009 * g2(s - F.masseter.s, a - F.masseter.a, 0.05, 0.05);
  // 鼻の穴：穴は深く沈め、外側の縁（鼻翼）を盛る。
  if (s > 0.53) {
    const n = nostrilSdf(s, a);
    if (n < 0.02) {
      d -= 0.011 * smooth(0.003, -0.005, n);
      d += 0.0032 * Math.exp(-((n - 0.0045) ** 2) / (2 * 0.003 * 0.003));
    }
  }
  // 口の線（上唇と下唇の合わせ目）と、上唇のふくらみ。
  if (s > 0.5) {
    const m = toPolyline(s, a, F.mouth);
    if (m.d < 0.02) d -= 0.0018 * Math.exp(-(m.d * m.d) / (2 * 0.003 * 0.003)) * smooth(0, 0.2, m.t);
    d += 0.003 * g2(s - F.lip.s, a - F.lip.a, 0.012, 0.03);
  }
  // おとがい（下唇の下のふくらみ）。
  d += 0.005 * g2(s - 0.55, a - L, 0.016, 0.028);
  return d;
}

// ---------------------------------------------------------------- 体表の点

const X = new THREE.Vector3(1, 0, 0);

/**
 * 体表の点。f は額の中央からの弧の長さを半周で割ったもの（右が正）。lift は外への浮かせ（m）。
 * 凹凸を含めた面の上の点を返す（目のまわりや鼻の穴の上を通す帯もそれに沿う）。
 */
export function headPoint(s, f, { lift = 0, bumps = true } = {}) {
  const h = halfCurve(s);
  const a = Math.abs(f) * h.L;
  const q = onHalf(h, a);
  const D = (bumps ? disp(s, a, h.L) : 0) + lift;
  const x = (q.x + q.nx * D) * (f < 0 ? -1 : 1);
  const y = q.y + q.ny * D;
  return new THREE.Vector3(x, 0, 0).addScaledVector(HEAD_T, s).addScaledVector(HEAD_U, y);
}

/** 体表の点と、外向きの法線・軸方向・周方向の接線。 */
export function headFrame(s, f, opts = {}) {
  const e = 0.002;
  const p = headPoint(s, f, opts);
  const ts = headPoint(s + e, f, opts).sub(headPoint(s - e, f, opts)).normalize();
  const tf = headPoint(s, f + e, opts).sub(headPoint(s, f - e, opts)).normalize();
  const n = new THREE.Vector3().crossVectors(ts, tf).normalize();
  // 外向きにそろえる（断面の中心から外へ）。
  const h = halfCurve(s);
  const q = onHalf(h, Math.abs(f) * h.L);
  const out = new THREE.Vector3(q.nx * (f < 0 ? -1 : 1), 0, 0).addScaledVector(HEAD_U, q.ny);
  if (n.dot(out) < 0) n.negate();
  return { p, n, ts, tf };
}

/** 弧の長さ a（m）を、その断面の半周に対する割合 f に直す。 */
export const fOfA = (s, a) => a / halfCurve(s).L;

// ---------------------------------------------------------------- 頭の形

/**
 * 頭のジオメトリ。detail が 'high' なら牧場と馬の詳細（近くで見る）、'low' ならレース（遠景）。
 * u は断面を一周する位置（0 と 1 が顎の下の中央、0.5 が額の中央）、v は軸に沿った位置。
 * 断面は軸の方向に、目と鼻先のあたりで細かく並べる（凹凸が小さいので、粗いと潰れる）。
 */
export function headGeometry(detail = 'high') {
  const K = detail === 'high' ? 44 : 18;          // 半周の分割
  const RINGS = detail === 'high' ? 132 : 44;     // 軸方向の断面の数
  // 断面の並び：目のまわりと鼻先を密にする。
  const dens = (s) => 1 + 1.4 * smooth(0.06, 0.12, s) * smooth(0.27, 0.21, s) + 2.2 * smooth(0.48, 0.55, s);
  const grid = [];
  let acc = 0;
  const NS = 2000;
  for (let i = 0; i <= NS; i++) {
    const s = S0 + (S1 - S0) * (i / NS);
    if (i > 0) acc += dens(s);
    grid.push(acc);
  }
  const sAt = (t) => {
    const target = t * acc;
    let lo = 0, hi = NS;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (grid[mid] <= target) lo = mid; else hi = mid;
    }
    const k = (target - grid[lo]) / Math.max(1e-9, grid[hi] - grid[lo]);
    return S0 + (S1 - S0) * ((lo + k) / NS);
  };

  const per = 2 * K + 1;           // 顎の下の中央を 2 度持つ（u の継ぎ目）
  const pos = new Float32Array((RINGS + 1) * per * 3 + 6);
  const uv = new Float32Array((RINGS + 1) * per * 2 + 4);
  let pi = 0, ui = 0;
  for (let i = 0; i <= RINGS; i++) {
    const s = sAt(i / RINGS);
    const h = halfCurve(s);
    for (let k = 0; k <= 2 * K; k++) {
      // 右半分は顎の下（k=0）から額の中央（k=K）へ、左半分は額から顎の下（k=2K）へ。
      const right = k <= K;
      const a = right ? h.L * (1 - k / K) : h.L * ((k - K) / K);
      const q = onHalf(h, a);
      const D = disp(s, a, h.L);
      const x = (q.x + q.nx * D) * (right ? 1 : -1);
      const y = q.y + q.ny * D;
      pos[pi++] = x;
      pos[pi++] = HEAD_T.y * s + HEAD_U.y * y;
      pos[pi++] = HEAD_T.z * s + HEAD_U.z * y;
      uv[ui++] = k / (2 * K);
      uv[ui++] = (s - S0) / (S1 - S0);
    }
  }
  // 両端のふた（項の後ろは首の中、鼻先は点に縮む）。
  const capBack = (RINGS + 1) * per, capFront = capBack + 1;
  const hb = halfCurve(S0);
  const yb = (hb.ys[0] + hb.ys[hb.ys.length - 1]) / 2;
  pos.set([0, HEAD_T.y * S0 + HEAD_U.y * yb, HEAD_T.z * S0 + HEAD_U.z * yb], pi); pi += 3;
  pos.set([0, HEAD_T.y * (S1 + 0.001), HEAD_T.z * (S1 + 0.001)], pi); pi += 3;
  uv.set([0.5, 0, 0.5, 1], ui);

  const idx = [];
  for (let i = 0; i < RINGS; i++) {
    for (let k = 0; k < 2 * K; k++) {
      const a = i * per + k, b = a + 1, c = a + per, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  for (let k = 0; k < 2 * K; k++) {
    idx.push(capBack, k + 1, k);
    const l = RINGS * per;
    idx.push(capFront, l + k, l + k + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // 顎の下の継ぎ目（同じ位置の 2 点）は法線をそろえる。そろえないと顎の下に折れ目が出る。
  const nrm = geo.getAttribute('normal');
  for (let i = 0; i <= RINGS; i++) {
    const a = i * per, b = i * per + 2 * K;
    const nx = nrm.getX(a) + nrm.getX(b), ny = nrm.getY(a) + nrm.getY(b), nz = nrm.getZ(a) + nrm.getZ(b);
    const l = Math.hypot(nx, ny, nz) || 1;
    nrm.setXYZ(a, nx / l, ny / l, nz / l);
    nrm.setXYZ(b, nx / l, ny / l, nz / l);
  }
  geo.userData.shared = true;
  return geo;
}

// ---------------------------------------------------------------- 目

/**
 * 目。黒褐色の目の玉（角膜の艶）と、そのまわりのまぶた。右目を作る（左は写す）。
 * 目の玉だけを丸く出すと、ぬいぐるみのボタンの目に見える。まぶたの縁でアーモンド形に切り、
 * 上まぶたは厚く、目尻（後ろ）の側を高くする。目は真横より少し前を向く。
 */
export function eyeGeometries() {
  const E = features().eye;
  const f = fOfA(E.s, E.a);
  const fr = headFrame(E.s, f, { bumps: false });
  // 少し前を向かせる。
  const N = fr.n.clone().addScaledVector(HEAD_T, 0.28).normalize();
  const Lax = HEAD_T.clone().addScaledVector(N, -HEAD_T.dot(N)).normalize();   // 目の長い軸（頭の軸に沿う）
  const Sax = new THREE.Vector3().crossVectors(N, Lax).normalize();
  if (Sax.dot(HEAD_U) < 0) Sax.negate();                                           // 上（額側）へ向ける
  const R = 0.023;
  const C = fr.p.clone().addScaledVector(N, 0.009 - R);

  const ball = new THREE.SphereGeometry(R, 32, 22);
  ball.translate(C.x, C.y, C.z);
  ball.userData.shared = true;

  // まぶたの縁（アーモンド形）。目の玉の面の少し外。
  const A = 0.0225, BU = 0.0135, BD = 0.0098;
  const rim = [];
  const M = 48;
  for (let j = 0; j < M; j++) {
    const ph = (j / M) * Math.PI * 2;
    const c = Math.cos(ph), sn = Math.sin(ph);
    const along = A * Math.sign(c) * Math.abs(c) ** 0.85;
    // 上まぶたは目尻（後ろ、c < 0）の側を高く、目頭（前）を低く。
    const across = (sn >= 0 ? BU * (1 - 0.18 * c) : BD * (1 + 0.1 * c)) * sn;
    const q = Lax.clone().multiplyScalar(along).addScaledVector(Sax, across);
    const Rl = R + 0.0011;
    const lift = Math.sqrt(Math.max(0, Rl * Rl - q.lengthSq()));
    rim.push(C.clone().add(q).addScaledVector(N, lift));
  }
  const lidEdge = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rim, true), 96, 0.0026, 6, true);
  lidEdge.userData.shared = true;

  // まぶたの皮膚：縁から外へ、頭の面の下へもぐり込む帯。目の玉のうち縁の外側を覆う。
  // 上まぶたはふくらみを大きく（瞼の厚み）、少し上にひだを付ける。
  const rings = 7;
  const pos = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    for (let j = 0; j < M; j++) {
      const ph = (j / M) * Math.PI * 2;
      const sn = Math.sin(ph);
      const p0 = rim[j];
      // 外の縁：目の中心から縁の向きへ 1.45 倍の位置を、頭の面（凹凸込み）の少し内側へ。
      const dir = p0.clone().sub(C).addScaledVector(N, -p0.clone().sub(C).dot(N));
      const outer = C.clone().addScaledVector(N, R - 0.009).addScaledVector(dir, 1.5);
      const sink = outer.clone().addScaledVector(N, -0.0035);
      const p = p0.clone().lerp(sink, t);
      const bulge = (sn > 0 ? 0.0034 + 0.0016 * sn : 0.0018) * Math.sin(Math.PI * Math.min(1, t * 1.25));
      // 上まぶたのひだ：縁から 4 割ほどのところで一段へこむ。
      const fold = sn > 0.25 ? -0.0011 * Math.exp(-((t - 0.45) ** 2) / 0.006) * sn : 0;
      p.addScaledVector(N, bulge + fold);
      pos.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < M; j++) {
      const a = i * M + j, b = i * M + (j + 1) % M, c = (i + 1) * M + j, d = (i + 1) * M + (j + 1) % M;
      idx.push(a, c, b, b, c, d);
    }
  }
  const lid = new THREE.BufferGeometry();
  lid.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  lid.setIndex(idx);
  lid.computeVertexNormals();
  // 外へ向いていなければ巻きを返す。
  const nn = lid.getAttribute('normal');
  const probe = new THREE.Vector3(nn.getX(M * 3), nn.getY(M * 3), nn.getZ(M * 3));
  if (probe.dot(N) < 0) {
    const ia = lid.getIndex();
    for (let i = 0; i < ia.count; i += 3) { const b = ia.getX(i + 1); ia.setX(i + 1, ia.getX(i + 2)); ia.setX(i + 2, b); }
    lid.computeVertexNormals();
  }
  lid.userData.shared = true;
  return { ball, lidEdge, lid };
}

// ---------------------------------------------------------------- 耳

/**
 * 耳。前が窪んだ椀（断面は三日月形）で、付け根が太く、先は尖って少し内へ反る。
 * 付け根では窪みが横を向き、先へ行くほど前を向く（ねじれ）。外は毛色、内は暗い色（材質の 2 組）。
 * 組の中の座標：付け根が原点、+y が上、+z が前、+x が外（右耳）。
 */
export function earGeometry() {
  const TS = [0, 0.12, 0.3, 0.5, 0.7, 0.85, 0.95, 1];
  const WS = [0.026, 0.033, 0.036, 0.033, 0.025, 0.015, 0.007, 0.0006];   // 半幅
  const DS = [0.015, 0.019, 0.019, 0.016, 0.011, 0.006, 0.003, 0.0004];  // 窪みの深さ
  const TH = [0.008, 0.005, 0.004, 0.0035, 0.003, 0.0025, 0.002, 0.0005]; // 殻の厚み
  const lerpTab = (tab, t) => {
    for (let i = 0; i < TS.length - 1; i++) {
      if (t <= TS[i + 1]) return tab[i] + (tab[i + 1] - tab[i]) * ((t - TS[i]) / (TS[i + 1] - TS[i]));
    }
    return tab[tab.length - 1];
  };
  const H = 0.148, RINGS = 18, K = 10;
  const M = 2 * (K + 1);
  const pos = [];
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    const w = lerpTab(WS, t), dc = lerpTab(DS, t), th = lerpTab(TH, t);
    const cx = -0.012 * t * t, cz = 0.004 * t + 0.01 * t * t, y = H * t;
    const tw = 0.55 * (1 - t) + 0.12 * t;
    const put = (px, pz) => {
      const x = px * Math.cos(tw) + pz * Math.sin(tw);
      const z = -px * Math.sin(tw) + pz * Math.cos(tw);
      pos.push(cx + x, y, cz + z);
    };
    // 外の殻：右の縁 → 後ろ → 左の縁。
    for (let j = 0; j <= K; j++) {
      const ph = (Math.PI * j) / K;
      put(w * Math.cos(ph), -(dc + th) * Math.sin(ph));
    }
    // 内の窪み：左の縁 → 奥 → 右の縁。
    for (let j = 0; j <= K; j++) {
      const ph = (Math.PI * j) / K;
      put(-(w - th * 0.6) * Math.cos(ph), -dc * Math.sin(ph));
    }
  }
  const outer = [], inner = [];
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < M; j++) {
      const a = i * M + j, b = i * M + (j + 1) % M, c = (i + 1) * M + j, d = (i + 1) * M + (j + 1) % M;
      const list = j >= K + 1 && j < M - 1 ? inner : outer;
      list.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex([...outer, ...inner]);
  geo.addGroup(0, outer.length, 0);
  geo.addGroup(outer.length, inner.length, 1);
  geo.computeVertexNormals();
  // 外の殻の背は後ろ（-z）を向くはず。逆なら巻きを返す。
  const nrm = geo.getAttribute('normal');
  const back = Math.floor(K / 2) + 4 * M;
  if (nrm.getZ(back) > 0) {
    const ia = geo.getIndex();
    for (let i = 0; i < ia.count; i += 3) { const b = ia.getX(i + 1); ia.setX(i + 1, ia.getX(i + 2)); ia.setX(i + 2, b); }
    geo.computeVertexNormals();
  }
  geo.userData.shared = true;
  return geo;
}

/** 右耳の付け根（頭の面の少し内側）と、その面の法線。 */
export function earBase() {
  const s = 0.006;
  const f = fOfA(s, 0.05);
  const fr = headFrame(s, f);
  return fr.p.clone().addScaledVector(fr.n, -0.011);
}

// ---------------------------------------------------------------- 前髪

/**
 * 前髪。両耳の間から額へ垂れる毛の束（細い帯を数本）。面に沿わせ、根元は少し浮かせる。
 * 一枚の板にすると額に貼った紙に見えた。競走馬の前髪は短く刈ってあるので長くしない。
 */
export function forelockGeometry() {
  // [根元の横位置 a, 長さ, 先の横ずれ, 根元の幅]。中央ほど長く、外の房は短く外へ流れる。
  const strands = [
    [-0.036, 0.11, -0.012, 0.016], [-0.026, 0.14, -0.006, 0.02], [-0.014, 0.165, -0.002, 0.022],
    [-0.003, 0.18, 0.0, 0.022], [0.008, 0.172, 0.003, 0.022], [0.02, 0.15, 0.007, 0.02],
    [0.031, 0.12, 0.012, 0.016], [0.0, 0.135, -0.008, 0.018], [0.012, 0.125, 0.01, 0.016],
  ];
  const pos = [], idx = [];
  strands.forEach(([a0, len, drift, w0], si) => {
    const base = pos.length / 3;
    const STEPS = 12;
    for (let k = 0; k <= STEPS; k++) {
      const t = k / STEPS;
      const s = -0.012 + len * t;
      const a = a0 * (1 - 0.3 * t) + drift * t * t;
      const f = fOfA(s, Math.abs(a)) * Math.sign(a || 1);
      // 根元は耳の間で立ち上がり、額の上では面に沿って少し浮く。房ごとに浮かせ方を変えて重ねる。
      const fr = headFrame(s, f, { lift: 0.004 + 0.009 * (1 - t) ** 2 + 0.0015 * (si % 3) });
      const w = (w0 * (1 - t) ** 0.7 + 0.002) / 2;
      const p1 = fr.p.clone().addScaledVector(fr.tf, -w), p2 = fr.p.clone().addScaledVector(fr.tf, w);
      pos.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      if (k < STEPS) {
        const i = base + k * 2;
        idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
      }
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.userData.shared = true;
  return geo;
}

// ---------------------------------------------------------------- 頭絡（革帯と金具）

/** いくつかの形を 1 つにまとめる（位置と法線と面だけ）。描く回数を減らす。 */
function merge(geos) {
  let nv = 0;
  for (const g of geos) nv += g.getAttribute('position').count;
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
  const idx = [];
  let vo = 0;
  for (const g of geos) {
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos[(vo + i) * 3] = p.getX(i); pos[(vo + i) * 3 + 1] = p.getY(i); pos[(vo + i) * 3 + 2] = p.getZ(i);
      nrm[(vo + i) * 3] = n.getX(i); nrm[(vo + i) * 3 + 1] = n.getY(i); nrm[(vo + i) * 3 + 2] = n.getZ(i);
    }
    const ix = g.getIndex();
    if (ix) for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + vo);
    else for (let i = 0; i < p.count; i++) idx.push(i + vo);
    vo += p.count;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  geo.userData.shared = true;
  return geo;
}

/**
 * 頭の面に沿う革帯。path は体表の座標 [s, f] の列。幅と厚みを持つ平たい帯で、上面と両側面を作る
 * （以前は細い管で、紐か針金に見えた。実物の頭絡は幅 2.5cm ほどの平たい革）。
 * 凹凸（顔稜・頬）の上をそのまま通る。
 */
function strap(path, { width = 0.024, thick = 0.0042, lift = 0.0042 } = {}) {
  // 体表の座標で細かく刻む（3 次元で 6mm 刻みほど）。
  const fine = [];
  for (let i = 0; i < path.length - 1; i++) {
    const [s0, f0] = path[i], [s1, f1] = path[i + 1];
    const L = halfCurve((s0 + s1) / 2).L;
    const n = Math.max(1, Math.ceil((Math.abs(s1 - s0) + Math.abs(f1 - f0) * L) / 0.006));
    for (let k = 0; k < n; k++) fine.push([s0 + (s1 - s0) * (k / n), f0 + (f1 - f0) * (k / n)]);
  }
  fine.push(path[path.length - 1]);
  const fr = fine.map(([s, f]) => headFrame(s, f, { lift }));
  const pos = [], idx = [];
  const n = fr.length;
  for (let i = 0; i < n; i++) {
    const { p, n: nn } = fr[i];
    const dir = fr[Math.min(n - 1, i + 1)].p.clone().sub(fr[Math.max(0, i - 1)].p).normalize();
    const side = new THREE.Vector3().crossVectors(nn, dir).normalize().multiplyScalar(width / 2);
    const tl = p.clone().add(side), tr = p.clone().sub(side);
    const bl = tl.clone().addScaledVector(nn, -thick), br = tr.clone().addScaledVector(nn, -thick);
    // 上面 2 点、左の側面 2 点、右の側面 2 点（角で法線を分けて、帯の縁を立てる）。
    pos.push(...tl.toArray(), ...tr.toArray(), ...tl.toArray(), ...bl.toArray(), ...tr.toArray(), ...br.toArray());
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 6, b = (i + 1) * 6;
    idx.push(a, b, a + 1, a + 1, b, b + 1);              // 上面
    idx.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);  // 左の側面
    idx.push(a + 4, b + 4, a + 5, a + 5, b + 4, b + 5);  // 右の側面
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // 上面が外を向いていなければ巻きを返す。
  const nr = geo.getAttribute('normal');
  const mid = Math.floor(n / 2) * 6;
  if (nr.getX(mid) * fr[Math.floor(n / 2)].n.x + nr.getY(mid) * fr[Math.floor(n / 2)].n.y + nr.getZ(mid) * fr[Math.floor(n / 2)].n.z < 0) {
    const ia = geo.getIndex();
    for (let i = 0; i < ia.count; i += 3) { const b = ia.getX(i + 1); ia.setX(i + 1, ia.getX(i + 2)); ia.setX(i + 2, b); }
    geo.computeVertexNormals();
  }
  return geo;
}

/** 金具を体表に置く。リングの面を体表に沿わせ、x を帯の向きにそろえる。 */
function placeOn(geo, s, f, { lift = 0.006, along = HEAD_T, spin = 0 } = {}) {
  const fr = headFrame(s, f, { lift });
  const z = fr.n.clone();
  const x = along.clone().addScaledVector(z, -along.dot(z)).normalize();
  if (spin) x.applyAxisAngle(z, spin);
  const y = new THREE.Vector3().crossVectors(z, x);
  geo.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, z).setPosition(fr.p));
  return geo;
}

const mirrorPath = (path) => path.map(([s, f]) => [s, -f]);
/** 鼻革：上（額側）から下へ、頬の下ほど後ろへずらす（実物の鼻革は顎の下で口角から離れる）。 */
const nosePath = (sTop, tilt) => {
  const out = [];
  for (let k = 0; k <= 40; k++) {
    const f = -1 + (2 * k) / 40;
    out.push([sTop + tilt * f * f, f]);
  }
  return out;
};

/**
 * 無口（牧場と馬の詳細で付ける頭絡）。資料の写真の、茶の革に真鍮の金具の無口。
 * 鼻革・頬革（目の下を通って耳の後ろへ）・項革・喉革・顎の下の革、鼻革の脇の角環、顎の下の丸環、
 * 項の尾錠、左の頬革の名札。
 */
export function halterGeometries() {
  const sN = 0.392, tilt = 0.032;
  const fC = 0.6;                         // 鼻革と頬革の分かれ目
  const sC = sN + tilt * fC * fC;
  const cheekR = [[sC, fC], [0.25, 0.555], [0.12, 0.47], [0.03, 0.39], [-0.034, 0.33]];
  const crown = [];
  for (let k = 0; k <= 16; k++) crown.push([-0.036, 0.33 - (0.66 * k) / 16]);
  const throatR = [[-0.034, 0.34], [-0.022, 0.55], [-0.006, 0.78], [0.006, 1.0]];
  const chin = [[sN + tilt, 1.0], [0.3, 1.0], [0.18, 1.0], [0.08, 1.0], [0.006, 1.0]];
  const leather = merge([
    strap(nosePath(sN, tilt)),
    strap(cheekR), strap(mirrorPath(cheekR)),
    strap(crown),
    strap(throatR, { width: 0.02 }), strap(mirrorPath(throatR), { width: 0.02 }),
    strap(chin, { width: 0.022 }),
  ]);
  const sq = () => new THREE.TorusGeometry(0.0165, 0.0029, 6, 4).rotateZ(Math.PI / 4);
  const ring = (r) => new THREE.TorusGeometry(r, 0.0032, 8, 28);
  const plate = new THREE.BoxGeometry(0.064, 0.017, 0.0024);
  const buckle = new THREE.TorusGeometry(0.014, 0.0026, 6, 4).rotateZ(Math.PI / 4).scale(1, 0.8, 1);
  const brass = merge([
    placeOn(sq(), sC, fC, { lift: 0.0085 }),
    placeOn(sq(), sC, -fC, { lift: 0.0085 }),
    placeOn(ring(0.019), sN + tilt - 0.004, 0.97, { lift: 0.01 }),     // 顎の下の丸環（引き手を付ける）
    placeOn(ring(0.016), 0.004, 0.97, { lift: 0.01 }),                 // 喉の環
    placeOn(buckle, -0.035, -0.36, { lift: 0.008, along: new THREE.Vector3(1, 0, 0) }),
    placeOn(plate, 0.15, -0.485, { lift: 0.0085, along: headPoint(0.12, -0.47).sub(headPoint(0.25, -0.555)) }), // 名札（左の頬革に沿わせる）
  ]);
  return { leather, brass };
}

/**
 * レースの頭絡（勒）。頬革・項革・額革・鼻革・喉革、口角の銜（はみ）と輪。輪の位置は手綱の付け根になる。
 */
export function bridleGeometries() {
  const F = features();
  // 口角（口の線の後ろの端）。
  const corner = F.mouth[F.mouth.length - 1];
  const sB = corner.s - 0.004, fB = fOfA(sB, corner.a);
  const cheekR = [[sB - 0.01, fB - 0.04], [0.42, 0.56], [0.26, 0.52], [0.12, 0.45], [0.03, 0.385], [-0.034, 0.33]];
  const crown = [];
  for (let k = 0; k <= 16; k++) crown.push([-0.036, 0.33 - (0.66 * k) / 16]);
  const brow = [];
  for (let k = 0; k <= 16; k++) brow.push([0.032, 0.36 - (0.72 * k) / 16]);
  const throatR = [[-0.034, 0.34], [-0.022, 0.55], [-0.006, 0.78], [0.006, 1.0]];
  const leather = merge([
    strap(cheekR, { width: 0.018 }), strap(mirrorPath(cheekR), { width: 0.018 }),
    strap(crown, { width: 0.02 }),
    strap(brow, { width: 0.016, lift: 0.0048 }),
    strap(nosePath(0.335, 0.035), { width: 0.022 }),
    strap(throatR, { width: 0.016 }), strap(mirrorPath(throatR), { width: 0.016 }),
  ]);
  // 銜：口の中を左右に通る棒と、口角の外の輪（環銜）。輪の面は頬に沿う。
  const fr = headFrame(sB, fB, { lift: 0.006 });
  const ringR = fr.p.clone().addScaledVector(fr.n, 0.004);
  const ringL = ringR.clone(); ringL.x = -ringL.x;
  const bar = new THREE.CylinderGeometry(0.0055, 0.0055, Math.abs(ringR.x) * 2 + 0.01, 8)
    .rotateZ(Math.PI / 2).translate(0, ringR.y, ringR.z);
  const ringGeo = (p) => {
    const g = new THREE.TorusGeometry(0.024, 0.0028, 8, 28);
    // 面を頬（横）に向け、少し前へ傾ける。
    g.rotateY(Math.PI / 2).rotateX(-0.5);
    g.translate(p.x + Math.sign(p.x) * 0.002, p.y - 0.004, p.z + 0.004);
    return g;
  };
  const metal = merge([bar, ringGeo(ringR), ringGeo(ringL)]);
  return { leather, metal, bitR: ringR, bitL: ringL };
}

// ---------------------------------------------------------------- 顔の布（テクスチャ）

const hex = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

/**
 * 毛色ごとの顔の色。鼻先は皮膚が透けて黒っぽい（鹿毛は黒、栗毛は灰色がかる、芦毛は黒い皮膚、白毛は桃色）。
 * muzzle は鼻先の色、amt はその混ぜ具合。
 */
const FACE_TONE = {
  鹿毛: { muzzle: 0x231710, amt: 0.78 },
  黒鹿毛: { muzzle: 0x1a120c, amt: 0.6 },
  青鹿毛: { muzzle: 0x140e0a, amt: 0.45 },
  青毛: { muzzle: 0x100b08, amt: 0.3 },
  栗毛: { muzzle: 0x5e4334, amt: 0.4 },
  栃栗毛: { muzzle: 0x35241a, amt: 0.5 },
  芦毛: { muzzle: 0x403c39, amt: 0.72 },
  白毛: { muzzle: 0xd9b6ad, amt: 0.55 },
};

/** 白斑の形（馬 id から決まる。同じ馬はいつも同じ顔）。芦毛・白毛は付けない。 */
export function markingOf(id, coat) {
  if (coat === '芦毛' || coat === '白毛') return null;
  const r = (k) => hash01(id, 100 + k);
  const p = hash01(id, 1);
  // 無地 4 割、星・星と流星・流星・大流星・鼻白。
  const type = p < 0.4 ? null : p < 0.58 ? 'star' : p < 0.72 ? 'starStripe' : p < 0.8 ? 'stripe'
    : p < 0.92 ? 'blaze' : p < 0.96 ? 'snip' : 'starSnip';
  if (!type) return null;
  return {
    type,
    star: { s: 0.128 + 0.04 * r(1), R: 0.015 + 0.017 * r(2), c: (r(3) - 0.5) * 0.012, ph: r(4) * 6.28, ph2: r(14) * 6.28 },
    stripe: { s1: 0.36 + 0.2 * r(5), w: 0.0055 + 0.0075 * r(6), drift: (r(7) - 0.5) * 0.05, ph: r(15) * 6.28 },
    blaze: { s0: 0.1 + 0.04 * r(10), w0: 0.02 + 0.014 * r(8), w1: 0.034 + 0.02 * r(9), c: (r(16) - 0.5) * 0.012 },
    snip: { s: 0.6 + 0.012 * r(11), c: (r(12) - 0.5) * 0.024, R: 0.01 + 0.009 * r(13) },
  };
}

/** 白斑の濃さ（0..1）。as は額の中央からの弧の長さ（右が正、m）。縁は毛が混ざるので柔らかく。 */
function markingAlpha(m, s, as) {
  if (!m) return 0;
  const edge = 0.0028;
  let al = 0;
  const star = () => {
    const S = m.star;
    const ds = (s - S.s) / 1.35, da = as - S.c;
    const rho = Math.hypot(ds, da);
    if (rho > S.R * 1.6) return 0;
    const phi = Math.atan2(ds, da);
    const rad = S.R * (1 + 0.2 * Math.sin(3 * phi + S.ph) + 0.12 * Math.sin(5 * phi + S.ph2) + 0.1 * Math.sin(2 * phi + S.ph * 0.7));
    return smooth(rad + edge, rad - edge, rho);
  };
  const stripe = (s0) => {
    const T = m.stripe;
    if (s < s0 - 0.01 || s > T.s1 + 0.01) return 0;
    const t = clamp01((s - s0) / (T.s1 - s0));
    const c = m.star.c + T.drift * t * t + 0.0012 * Math.sin(s * 55 + T.ph);
    // 上（星の側）はつながるよう太く、下は細って切れる。
    const hw = T.w * (1.15 - 0.45 * t) * smooth(T.s1 + 0.004, T.s1 - 0.03, s) * smooth(s0 - 0.01, s0 + 0.01, s);
    return smooth(hw + edge, hw - edge, Math.abs(as - c));
  };
  const blaze = () => {
    const B = m.blaze;
    if (s < B.s0 - 0.02) return 0;
    const t = clamp01((s - B.s0) / (0.6 - B.s0));
    let hw = B.w0 + (B.w1 - B.w0) * t * t;
    // 上の端は丸く、鼻先では鼻の穴の間を覆って上唇まで。
    hw *= smooth(B.s0 - 0.012, B.s0 + 0.025, s);
    if (s > 0.6) hw *= 1 - smooth(0.615, 0.632, s) * 0.3;
    return smooth(hw + edge, hw - edge, Math.abs(as - B.c - 0.004 * Math.sin(s * 60)));
  };
  const snip = () => {
    const P = m.snip;
    const rho = Math.hypot((s - P.s) / 1.4, as - P.c);
    return smooth(P.R + edge, P.R - edge, rho);
  };
  switch (m.type) {
    case 'star': al = star(); break;
    case 'starStripe': al = Math.max(star(), stripe(m.star.s)); break;
    case 'stripe': al = stripe(0.17); break;
    case 'blaze': al = blaze(); break;
    case 'snip': al = snip(); break;
    case 'starSnip': al = Math.max(star(), snip()); break;
    default: break;
  }
  return al;
}

const faceCache = new Map();

/**
 * 顔の布。毛色の地に、鼻先の黒み・目のまわりの陰・鼻の穴の中・口の線・白斑・毛並みのごく弱いすじを描く。
 * 座標は頭のジオメトリの uv と同じ（u：顎の下 0 → 額 0.5 → 顎の下 1、v：項の後ろ → 鼻先）。
 * 乱数は使わない（馬 id から決める）。同じ馬・毛色・大きさは使い回す（牧場で詳細を開くたびに描かない）。
 */
export function faceTexture(coat, coatHex, id, size = 512) {
  const key = `${coat}|${id}|${size}`;
  const hit = faceCache.get(key);
  if (hit) {
    faceCache.delete(key);
    faceCache.set(key, hit);
    return hit;
  }
  const W = size, H = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  const img = g.createImageData(W, H);
  const data = img.data;
  const base = hex(coatHex);
  const tone = FACE_TONE[coat] ?? FACE_TONE['鹿毛'];
  const mz = hex(tone.muzzle);
  const skin = [16, 11, 9];
  const whiteC = [243, 240, 233];
  const mark = markingOf(id, coat);
  const F = features();
  for (let row = 0; row < H; row++) {
    const v = (row + 0.5) / H;
    const s = S0 + (S1 - S0) * v;
    const L = halfCurve(s).L;
    // 鼻先へ向かって皮膚の色を混ぜる。唇とおとがいはさらに濃く。
    const muzzleT = smooth(0.46, 0.6, s) * tone.amt;
    for (let col = 0; col < W; col++) {
      const u = (col + 0.5) / W;
      const fr = (0.5 - u) * 2;                // 右が正
      const a = Math.abs(fr) * L;
      const as = fr * L;
      let r = base[0], gg = base[1], b = base[2];
      // 下側（顎の下・喉）は少し暗く、額と頬は少し明るい（毛の艶の向き）。
      // 毛並みのすじを描いたら木目に見えたので描かない。
      const shade = 1.03 - 0.06 * smooth(0.55, 1, a / L);
      r *= shade; gg *= shade; b *= shade;
      // 鼻先。
      let m = muzzleT;
      if (s > 0.5) m = Math.min(1, m + 0.25 * tone.amt * smooth(0.55, 0.95, a / L) * smooth(0.5, 0.58, s));
      if (m > 0) { r += (mz[0] - r) * m; gg += (mz[1] - gg) * m; b += (mz[2] - b) * m; }
      // 目のまわりの陰（皮膚が薄く毛が短い）。
      const de = Math.hypot(s - F.eye.s, a - F.eye.a);
      if (de < 0.05) {
        const k = 0.22 * smooth(0.042, 0.016, de);
        r *= 1 - k; gg *= 1 - k; b *= 1 - k;
      }
      // 鼻の穴の中と、口の線。
      if (s > 0.52) {
        const n = nostrilSdf(s, a);
        if (n < 0.006) {
          const k = smooth(0.0045, -0.0015, n);
          r += (skin[0] - r) * k; gg += (skin[1] - gg) * k; b += (skin[2] - b) * k;
        }
        const mo = toPolyline(s, a, F.mouth);
        if (mo.d < 0.006) {
          // 唇の合わせ目は柔らかい皺。濃い線にすると描いた口に見えた。
          const k = smooth(0.0045, 0.0005, mo.d) * 0.55 * smooth(0.0, 0.25, mo.t);
          r += (skin[0] - r) * k; gg += (skin[1] - gg) * k; b += (skin[2] - b) * k;
        }
      }
      // 白斑。
      if (mark && Math.abs(as) < 0.09) {
        const al = markingAlpha(mark, s, as);
        if (al > 0) {
          // 鼻先の白斑の下は桃色の皮膚が透ける。
          const pinkMix = smooth(0.56, 0.62, s) * 0.35;
          const wr = whiteC[0] * (1 - pinkMix) + 222 * pinkMix, wg = whiteC[1] * (1 - pinkMix) + 178 * pinkMix, wb = whiteC[2] * (1 - pinkMix) + 170 * pinkMix;
          r += (wr - r) * al; gg += (wg - gg) * al; b += (wb - b) * al;
        }
      }
      const o = (row * W + col) * 4;
      data[o] = clamp(r, 0, 255);
      data[o + 1] = clamp(gg, 0, 255);
      data[o + 2] = clamp(b, 0, 255);
      data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = 4;
  faceCache.set(key, tex);
  // 使っていない古い布は捨てる（牧場で多くの馬を見て回っても溜まり続けないように）。
  while (faceCache.size > 48) {
    const oldest = faceCache.keys().next().value;
    faceCache.get(oldest).dispose();
    faceCache.delete(oldest);
  }
  return tex;
}
