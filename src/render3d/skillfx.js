// 固有スキルの発動のエフェクト（イナズマ・燃えるオーラ・氷結・桜吹雪・疾風・金色の光・漆黒のオーラ・星屑・流星）。
// 種類と色は sim/ikusei-skills.js の SKILL_FX。見た目だけで、走行ログ（結果）には触らない。
//
// オーラは粒（パーティクル）で作る。以前は形をぼかした光を明滅させ、炎は多角形の舌を伸び縮みさせていたので、
// 止まった光の塊とぎくしゃくした炎に見えた。粒は形の縁（2D）・馬の体の表面（3D）から連続して湧き、上がる・外へ広がる・
// 後ろへ流れる。粒ごとに寿命と位相をずらし、生まれと消えは滑らかに（smoothstep）、色は芯 → 主の色 → 光の色へ移す。
// 稲妻・花びら・星・氷の棘などは、その上に重ねる飾り。
//
// - 2D（fxPainter）：カードの絵（cardart.js が焼き込む）・カードエディットの生の舞台・観戦のカットインで同じ描き方。
//   形の縁の点と外向きを最初に一度だけ拾い、粒の位置は時刻 t から式で決める（状態を持たない。同じ t は同じ絵）。
// - 3D（createFx3d）：観戦の馬の組に付ける粒（スプライト）と稲妻の帯。深度テストを切って馬群に埋もれない（目印と同じ）。
//
// 乱数は Math.random を使わない（同じ絵を撮り直すと同じ形になるように。カードの絵は鍵で覚えている）。

import * as THREE from '../../vendor/three/three.module.min.js';
import { SKILL_FX } from '../sim/ikusei-skills.js';

export { SKILL_FX };

const rngOf = (seed) => {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
/** 整数の混ぜ合わせ（粒の生まれ直しごとに出どころの点を選ぶ。配列を作らずに毎コマ引ける）。 */
const h32 = (x) => {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
};
const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
};
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => 1 - (1 - clamp01(x)) ** 3;
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
/** 粒の一生の濃さ：ふわっと現れ、半ばから溶けるように消える（直線で上げ下げすると点滅に見えた）。 */
const lifeEnv = (k) => smooth(0, 0.2, k) * (1 - smooth(0.45, 1, k));
// 漆黒の暗い粒の色。真っ黒だと汚れに見えたので、深い紫に寄せる
const DARK = '#1c0838';
const mixHex = (a, b, t) => {
  const p = parseInt(a.slice(1), 16), q = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(((p >> s) & 255) * (1 - t) + ((q >> s) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
};

// ---------------------------------------------------------------- 2D

/**
 * オーラの粒（2D）。速さ・大きさは形の高さ 300px あたりの px（単位 u を掛ける）。
 * rise 上へ・out 縁の外へ・trail 走る向きの後ろへ（px/秒）、size 半径、grow 一生で大きくなる割合（負は縮む）、
 * ramp 色の移り（core・color・glow・dark）、a 濃さ、front 馬の前に描く割合（体を包んで見せる。前は薄く）、
 * stretch 縦横の伸び（炎は縦、風は横）、dark 暗い粒の割合（普通の合成で地を沈める。漆黒）。
 */
const AURA2 = {
  radiance: { n: 280, life: [0.7, 1.3], rise: 70, out: 26, trail: 30, size: [9, 19], grow: 0.9, ramp: ['core', 'color', 'glow'], a: 0.5, front: 0.18 },
  thunder: { n: 240, life: [0.25, 0.55], rise: 14, out: 60, trail: 70, size: [7, 14], grow: 0.6, ramp: ['core', 'glow', 'glow'], a: 0.55, front: 0.25, flicker: true },
  flame: { n: 460, life: [0.4, 0.85], rise: 190, out: 22, trail: 90, size: [14, 28], grow: -0.6, ramp: ['core', 'color', 'glow'], a: 0.52, front: 0.16, stretch: [0.85, 1.35], up: 0.8 },
  frost: { n: 260, life: [0.8, 1.5], rise: -14, out: 30, trail: 45, size: [8, 15], grow: 0.9, ramp: ['core', 'color', 'glow'], a: 0.42, front: 0.22 },
  sakura: { n: 220, life: [0.9, 1.6], rise: 34, out: 28, trail: 55, size: [9, 17], grow: 0.8, ramp: ['core', 'color', 'glow'], a: 0.4, front: 0.2 },
  gale: { n: 120, life: [0.35, 0.7], rise: 30, out: 20, trail: 300, size: [6, 11], grow: 0.4, ramp: ['core', 'color', 'glow'], a: 0.4, front: 0.25, stretch: [2.6, 0.5] },
  shadow: { n: 380, life: [0.6, 1.2], rise: 125, out: 22, trail: 60, size: [14, 27], grow: 0.7, ramp: ['color', 'glow', 'dark'], a: 0.52, front: 0.12, dark: 0.45, up: 0.6 },
  star: { n: 250, life: [0.8, 1.4], rise: 30, out: 26, trail: 40, size: [8, 15], grow: 0.8, ramp: ['core', 'color', 'glow'], a: 0.45, front: 0.25 },
  // 流星：体から剥がれて尾へ流れる星屑（横に伸ばす）。主役は彗星の頭と尾（cometBack・cometFront）
  comet: { n: 200, life: [0.35, 0.8], rise: 4, out: 16, trail: 280, size: [5, 10], grow: 0.3, ramp: ['core', 'color', 'glow'], a: 0.42, front: 0.22, stretch: [2.4, 0.55] },
};

// 粒の布：色ごとに 8 段（一生の進みで段を進める）。白い丸をぼかした絵を色で染めておく（毎コマ放射グラデーションを作らない）
const spriteCache = new Map();
function rampSprites(kind) {
  if (spriteCache.has(kind)) return spriteCache.get(kind);
  const F = SKILL_FX[kind];
  const cols = AURA2[kind].ramp.map((k) => (k === 'dark' ? DARK : F[k]));
  const S = 48, m = S / 2;
  const make = (hex, core = 1) => {
    const c = canvasOf(S, S);
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(m, m, 0, m, m, m);
    gr.addColorStop(0, rgba(hex, core));
    gr.addColorStop(0.35, rgba(hex, 0.55 * core));
    gr.addColorStop(0.7, rgba(hex, 0.14 * core));
    gr.addColorStop(1, rgba(hex, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
    return c;
  };
  const steps = Array.from({ length: 8 }, (_, i) => {
    const t = (i / 7) * (cols.length - 1);
    const j = Math.min(cols.length - 2, Math.floor(t));
    return make(mixHex(cols[j], cols[j + 1], t - j));
  });
  const out = { steps, dark: make(DARK) };
  spriteCache.set(kind, out);
  return out;
}

/**
 * 形からエフェクトを描く係を作る。mask は透明の地に形のある絵（Image・canvas）。w・h は描く大きさ。
 * draw(back, front, t, { still, alpha }) で、back（形の後ろに描く 2D の文脈）と front（形の前）に時刻 t 秒の絵を描く。
 * still はカードの絵（現れて消える動きを付けず、粒が出そろった姿で止める）。time は止めた絵の時刻のずらし（秒、0 で既定の 1 コマ）。
 * 馬の形が変わると粒の出どころも変わるので、エフェクトだけを動かしたいとき（カードエディットの「時間」）はこちらを動かす。
 * dir は馬の走る向き（−1 で画面の左へ、+1 で右へ、0 は分からない）。粒は逆へ流れる。
 */
export function fxPainter(kind, mask, w, h, seed = 1, { unit = null, dir = -1 } = {}) {
  const F = SKILL_FX[kind];
  const A = AURA2[kind];
  if (!F || !A || !mask) return null;
  const sc = canvasOf(w, h);
  const sg = sc.getContext('2d', { willReadFrequently: true });
  sg.drawImage(mask, 0, 0, w, h);
  const data = sg.getImageData(0, 0, w, h).data;
  const AL = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : data[(y * w + x) * 4 + 3]);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  const step = Math.max(2, Math.round(Math.min(w, h) / 150));
  const edges = [];
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      if (AL(x, y) < 110) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (AL(x - step, y) >= 110 && AL(x + step, y) >= 110 && AL(x, y - step) >= 110 && AL(x, y + step) >= 110) continue;
      // 外向きの向きは、少し離れた所の濃さの差（形の外へ向く）
      const d = step * 3;
      let nx = AL(x - d, y) - AL(x + d, y), ny = AL(x, y - d) - AL(x, y + d);
      const l = Math.hypot(nx, ny);
      if (l < 1) continue;
      nx /= l; ny /= l;
      edges.push({ x, y, nx, ny });
    }
  }
  if (x1 < 0 || !edges.length) return null;
  const box = { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  // 大きさの単位（形の高さ 300px で 1）。字の形（カットインのスキル名）は背が低いので呼ぶ側が決める
  const u = unit ?? Math.max(0.35, box.h / 300);
  const r0 = rngOf(seed);
  // オーラの出どころ：縁の点。上へ立ち上る種類（炎・漆黒）は上を向く縁（背・頭・騎手）を重く選ぶ
  const pool = [];
  for (const [i, e] of edges.entries()) {
    pool.push(i);
    if (A.up && e.ny < -0.25) for (let j = 0; j < 3 * A.up; j++) pool.push(i);
  }
  // 粒ごとの性質（寿命・位相・大きさ・揺れ・前か後ろか）。位置は時刻から式で出す
  const parts = Array.from({ length: A.n }, (_, i) => ({
    L: A.life[0] + r0() * (A.life[1] - A.life[0]),
    ph: r0(),
    s: A.size[0] + r0() * (A.size[1] - A.size[0]),
    wob: 4 + r0() * 10, wf: 3 + r0() * 5, wp: r0() * 6.283,
    jit: r0() - 0.3,
    front: r0() < A.front,
    dark: A.dark ? r0() < A.dark : false,
    sp: 0.75 + r0() * 0.5,
  }));
  // 形のすぐ外の薄い光（粒のあいだを埋めて、オーラが形に沿って見えるように。主役は粒）
  const rim = (() => {
    const c = canvasOf(w, h);
    const g = c.getContext('2d');
    const R = 5 * u;
    if (typeof g.filter === 'string') g.filter = `blur(${(6 * u).toFixed(1)}px)`;
    for (let a = 0; a < 10; a++) {
      const t = (a / 10) * Math.PI * 2;
      g.drawImage(mask, Math.cos(t) * R, Math.sin(t) * R, w, h);
    }
    g.filter = 'none';
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = A.ramp[0] === 'color' ? F.color : F.glow;
    g.fillRect(0, 0, w, h);
    return c;
  })();
  const r1 = rngOf(seed + 17);
  const P = {
    spikes: pickEdges(edges, r1, 30), bolts: pickEdges(edges, r1, 24, 0.6),
    motes: Array.from({ length: 60 }, () => ({ a: r1(), b: r1(), c: r1(), d: r1(), e: r1() })),
  };
  const ctx = { F, A, w, h, box, u, rim, P, edges, pool, parts, seed, trail: -Math.sign(dir || 0), spr: rampSprites(kind) };
  return {
    box,
    draw(back, front, t, { still = false, alpha = 1, time = 0 } = {}) {
      const env = still ? 1 : Math.min(ease(t / 0.22), 1 - ease((t - 2.1) / 0.5));
      const k = Math.max(0, env) * alpha;
      if (k <= 0) return;
      for (const g of [back, front]) { g.save(); g.globalAlpha = 1; }
      SOFT = still;
      // 止めた絵の時刻のずらし。育つ・開く・閃光の動き（grow・open・env）は出そろった姿のまま、流れと回りだけを進める
      ctx.s = still ? Math.max(0, +time || 0) : 0;
      // 形の後ろの土台（流星の頭と尾）はオーラの粒より先に描く（粒が頭の光の上に乗る）
      PRE[kind]?.(back, front, t, k, ctx, still);
      drawAura(back, front, t, k, ctx, still);
      DRAW[kind](back, front, t, k, ctx, still);
      for (const g of [back, front]) g.restore();
    },
  };
}

function pickEdges(edges, r, n, up = 0) {
  const out = [];
  for (let i = 0; i < n * 6 && out.length < n; i++) {
    const e = edges[Math.floor(r() * edges.length)];
    if (up && e.ny > 0.2 && r() < up) continue;
    out.push({ ...e, ph: r() * Math.PI * 2, k: 0.6 + r() * 0.6, r: r() });
  }
  return out;
}

/**
 * オーラの粒を描く。粒 i は寿命 L ごとに生まれ直し、生まれ直すたびに出どころの点を (i, 何度目か) から選ぶ。
 * 発動の瞬間より前に生まれるはずの粒は描かない（オーラが湧き上がって育つ）。終わり際は新しく生まれない（溶けて消える）。
 * カードの絵（still）は出そろった姿の 1 コマ。
 */
function drawAura(b, f, t, k, c, still) {
  const { A, u, edges, pool, parts, spr, trail } = c;
  // 形のすぐ外の薄い光
  b.globalCompositeOperation = 'lighter';
  b.globalAlpha = Math.min(1, k * 0.32);
  b.drawImage(c.rim, 0, 0);
  const T = still ? 2.2 + c.s : t;
  const flick = A.flicker && !still ? 0.6 + 0.4 * ((h32(Math.floor(t / 0.05) + c.seed) % 1000) / 1000) : 1;
  for (let i = 0; i < parts.length; i++) {
    const q = parts[i];
    const tt = T + q.ph * q.L;
    const cyc = Math.floor(tt / q.L);
    const age = tt - cyc * q.L;
    const born = T - age;
    if (!still && (born < 0 || born > 2.0)) continue;
    const kk = age / q.L;
    const e = edges[pool[h32(i * 7919 + cyc * 104729 + c.seed * 31) % pool.length]];
    const v = q.sp;
    const x = e.x + e.nx * (q.jit * 8 * u + A.out * v * u * age) + trail * A.trail * v * u * age
      + Math.sin(age * q.wf + q.wp) * q.wob * u * kk;
    const y = e.y + e.ny * (q.jit * 8 * u + A.out * v * u * age) - A.rise * v * u * age;
    const s = Math.max(0.15, q.s * u * (1 + A.grow * kk));
    const a = A.a * lifeEnv(kk) * k * flick * (q.front ? 0.5 : 1);
    if (a < 0.01) continue;
    const g = q.front ? f : b;
    const [sx, sy] = A.stretch ?? [1, 1];
    if (q.dark) {
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = Math.min(1, a * 0.95);
      g.drawImage(spr.dark, x - s * 1.2, y - s * 1.2, s * 2.4, s * 2.4);
    } else {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = Math.min(1, a);
      const img = spr.steps[Math.min(7, Math.floor(kk * 8))];
      g.drawImage(img, x - s * sx, y - s * sy, s * 2 * sx, s * 2 * sy);
    }
  }
  b.globalAlpha = 1; f.globalAlpha = 1;
}

// 稲妻の折れ線（始点から向きへ長さ L、n 折れ）。r は乱数
function zigzag(r, x, y, dx, dy, L, n, jag) {
  const pts = [[x, y]];
  const px = -dy, py = dx;
  for (let i = 1; i <= n; i++) {
    const s = (i / n) * L;
    const j = i === n ? 0 : (r() - 0.5) * 2 * jag;
    pts.push([x + dx * s + px * j, y + dy * s + py * j]);
  }
  return pts;
}
// 影のぼかし（shadowBlur）は止めた絵（カード）だけ。毎コマ描くカットインで使うと、大きな canvas では 1 コマに
// 数百 ms かかって主スレッドが止まり、2.6 秒のカットインが一度も描かれずに消えた
let SOFT = true;
function strokeBolt(g, pts, F, u, k, wide = 1) {
  g.globalCompositeOperation = 'lighter';
  g.lineJoin = 'round'; g.lineCap = 'round';
  const path = () => { g.beginPath(); g.moveTo(...pts[0]); for (const p of pts.slice(1)) g.lineTo(...p); };
  g.shadowColor = F.glow; g.shadowBlur = SOFT ? 18 * u : 0;
  g.strokeStyle = rgba(F.glow, 0.7 * k); g.lineWidth = 9 * u * wide; path(); g.stroke();
  g.shadowBlur = SOFT ? 8 * u : 0;
  g.strokeStyle = rgba(F.color, 0.95 * k); g.lineWidth = 4 * u * wide; path(); g.stroke();
  g.shadowBlur = 0;
  g.strokeStyle = rgba(F.core, k); g.lineWidth = 1.6 * u * wide; path(); g.stroke();
}
function star(g, x, y, R, n, inner, rot = 0) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? R * inner : R;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
}
function glint(g, x, y, R, col, core, a) {
  g.globalCompositeOperation = 'lighter';
  const gr = g.createRadialGradient(x, y, 0, x, y, R);
  gr.addColorStop(0, rgba(core, a)); gr.addColorStop(0.3, rgba(col, a * 0.6)); gr.addColorStop(1, rgba(col, 0));
  g.fillStyle = gr;
  star(g, x, y, R, 4, 0.16);
  g.fill();
}
function petal(g, x, y, s, rot, F, a) {
  g.save();
  g.translate(x, y); g.rotate(rot);
  g.globalCompositeOperation = 'source-over';
  const gr = g.createLinearGradient(0, -s, 0, s);
  gr.addColorStop(0, rgba(F.core, a)); gr.addColorStop(1, rgba(F.color, a));
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(0, s);
  g.bezierCurveTo(s * 0.9, s * 0.4, s * 0.7, -s * 0.8, s * 0.18, -s);
  g.lineTo(0, -s * 0.72);
  g.lineTo(-s * 0.18, -s);
  g.bezierCurveTo(-s * 0.7, -s * 0.8, -s * 0.9, s * 0.4, 0, s);
  g.fill();
  g.restore();
}

// ---- 疾風の竜巻（2D）
// 帯はセル調：光の色（暗い縁）→ 主の色 → 芯の白を、少しずつ細くして重ね塗りする（半透明の重ねで段を付けない。くっきり塗り分ける）。
// 帯は漏斗の面に沿う縦の壁で、手前の半周（画面の下側）は馬の前、奥の半周は馬の後ろへ描く。帯の尾は細って消え、縁はちぎれて揺れる。
const LEAF_COLS = ['#5fbf3f', '#3f8f2a', '#8fd65a', '#2f6b22'];
function galeTornado2D(b, f, t, k, c, still) {
  const { F, box, u, P, seed } = c;
  // 止めた絵（カード）は帯が馬の胴を隠さない巻き方の時刻で
  const T = still ? 1.3 + c.s : t;
  // 竜巻が育つ（0.35 秒で鼻先から後ろへ伸びる）。終わり際は外へ開きながら薄れる
  const grow = still ? 1 : ease(T / 0.35);
  const open = still ? 0 : smooth(2.0, 2.6, T);
  // 横向きの竜巻：軸は走る向きに沿って馬の胴を通り、鼻先の前で細く尾の後ろへ開く（風を切って突き進む渦）。
  // 軸の位置 an（0＝鼻先の前・1＝尾の後ろ）と軸の周りの角 th から画面の点へ。th の sin が正の側が手前（馬の前に描く）。
  // 真横から見ると軸の周りの円は縦の線に潰れるので、手前ほど少し後ろへずらして楕円に見せる。
  const tr = c.trail || 1;                 // 後ろの向き（画面の x）
  const L = box.w * 1.2 * grow;
  const xF = tr > 0 ? box.x0 - box.w * 0.12 : box.x1 + box.w * 0.12;
  const cy = box.y0 + box.h * 0.56;
  const yb = box.y1 + 6 * u;
  const rf = box.h * 0.2, rr = box.h * (0.6 + open * 0.25);
  const rOf = (an) => rf + (rr - rf) * Math.pow(Math.max(0, an), 1.2);
  const at = (an, th, r) => ({ x: xF + tr * an * L + tr * Math.sin(th) * r * 0.3, y: cy - Math.cos(th) * r });
  const R = 7, N = 34;
  const thick = box.w * 0.24;
  const ribbons = [];
  for (let i = 0; i < R; i++) {
    const m = P.motes[i];
    const phi = i * 2.399 + m.a * 6.283;
    const w = 7.5 + m.b * 2.5;          // 回る速さ（rad/秒）
    const a0 = (i / R) * 0.72 + m.c * 0.06;
    const span = 0.85 * Math.PI + m.d * 0.4;
    const pts = [];
    for (let j = 0; j <= N; j++) {
      const q = j / N;
      const th = phi + w * T + q * span;
      const an = Math.min(1.05, a0 + q * 0.32 + 0.035 * Math.sin(th * 2 + T * 6));
      const r = rOf(an) * (1 + 0.07 * Math.sin(th * 3 + T * 5 + i));
      // 帯の厚み：尾は細って消え、頭は丸く、縁はちぎれて揺れる
      const taper = smooth(0, 0.35, q) * (1 - smooth(0.88, 1, q) * 0.7);
      // ちぎれた縁：細かい波と大きなうねりを重ねる
      const torn = 0.8 + 0.14 * Math.sin(q * 23 + T * 11 + i * 1.7) * Math.sin(q * 9 - T * 4) + 0.06 * Math.sin(q * 61 + i * 3 + T * 17);
      const hw = thick * (0.45 + an * 0.55) * taper * torn * 0.5;
      pts.push({ ...at(an, th, r), hw, front: Math.sin(th) > 0 });
    }
    ribbons.push(pts);
  }
  const alpha = k * (1 - open * 0.9);
  // 帯を手前・奥の連なりに分けて、3 段の色で塗る。帯の幅は軸の向き（画面の横）に取る
  const paint = (g, run, scale, col, a) => {
    if (run.length < 2) return;
    g.beginPath();
    g.moveTo(run[0].x - tr * run[0].hw * scale, run[0].y);
    for (const p of run) g.lineTo(p.x - tr * p.hw * scale, p.y);
    for (let j = run.length - 1; j >= 0; j--) g.lineTo(run[j].x + tr * run[j].hw * scale * 0.8, run[j].y);
    g.closePath();
    g.globalAlpha = a;
    g.fillStyle = col;
    g.fill();
  };
  // 足元：蹴り上げた土煙（灰色のやわらかい丸）が後ろへ流れる
  const dust = (g, front) => {
    g.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 12; i++) {
      const m = P.motes[20 + i];
      if ((m.a > 0.5) !== front) continue;
      const an = (m.b + T * (0.5 + m.c * 0.4)) % 1.1;
      const x = xF + tr * (0.25 + an * 0.9) * L, y = yb - m.d * 12 * u - an * 20 * u;
      const s = (14 + m.e * 22) * u * (0.6 + 0.6 * an) * (0.6 + 0.4 * grow);
      const gr = g.createRadialGradient(x, y, 0, x, y, s);
      gr.addColorStop(0, rgba('#c9d3cf', 0.42 * alpha * (1 - smooth(0.8, 1.1, an)))); gr.addColorStop(1, rgba('#9aa7a2', 0));
      g.globalAlpha = 1;
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
    }
  };
  // 衝撃波の輪：軸を囲む白い輪が鼻先から後ろへ流れながら広がる（手前の半周は馬の前）
  const rings = (g, front) => {
    g.globalCompositeOperation = 'source-over';
    g.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const ph = still ? (0.2 + i * 0.3 + c.s * 1.1) % 1 : (T * 1.1 + i / 3) % 1;
      const r = rOf(ph) * (1.1 + ph * 0.3);
      g.globalAlpha = (1 - ph) * 0.8 * alpha;
      g.strokeStyle = i === 1 ? F.color : '#ffffff';
      g.lineWidth = (1 + 3.5 * (1 - ph)) * u;
      g.beginPath();
      for (let j = 0; j <= 24; j++) {
        const th = (front ? 0 : Math.PI) + (j / 24) * Math.PI;
        const p = at(ph, th, r);
        if (j) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y);
      }
      g.stroke();
    }
  };
  dust(b, false); rings(b, false);
  for (const front of [false, true]) {
    const g = front ? f : b;
    g.globalCompositeOperation = 'source-over';
    for (const pts of ribbons) {
      // 連なり（同じ側の続き）ごとに塗る
      let run = [];
      const flush = () => {
        if (run.length >= 2) {
          // 手前の帯は少し透かす（馬が隠れ切らないように）
          const fa = front ? (still ? 0.5 : 0.72) : 1;
          paint(g, run, 1.1, F.glow, 0.5 * alpha * fa);
          paint(g, run, 1.0, F.color, 0.78 * alpha * fa);
          paint(g, run, 0.55, F.core, 0.88 * alpha * fa);
        }
        run = [];
      };
      for (const p of pts) {
        if (p.front !== front) { if (run.length) { run.push(p); flush(); } continue; }
        run.push(p);
      }
      flush();
    }
  }
  // 白い細い風の弧（帯の外を速く回る）
  for (let i = 0; i < 4; i++) {
    const m = P.motes[8 + i];
    const an = 0.2 + m.b * 0.7;
    const r = rOf(an) * 1.18;
    const a0 = m.a * 6.283 + T * (9 + m.c * 3);
    for (const [g, front] of [[b, false], [f, true]]) {
      g.globalCompositeOperation = 'source-over'; g.lineCap = 'round';
      g.strokeStyle = '#ffffff';
      g.globalAlpha = 0.85 * alpha;
      g.lineWidth = (1.2 + m.d * 1.5) * u;
      g.beginPath();
      let on = false;
      for (let j = 0; j <= 16; j++) {
        const th = a0 + (j / 16) * 1.3;
        const p = at(an + (j / 16) * 0.06, th, r);
        if ((Math.sin(th) > 0) !== front) { on = false; continue; }
        if (!on) { g.moveTo(p.x, p.y); on = true; } else g.lineTo(p.x, p.y);
      }
      g.stroke();
    }
  }
  // 渦に巻かれて後ろへ飛ぶ葉と黒い粒
  for (let i = 0; i < 30; i++) {
    const m = P.motes[30 + (i % 30)];
    const th = m.a * 6.283 + T * (5 + m.b * 3) + i;
    const an = ((m.c + T * (0.3 + m.d * 0.3)) % 1.15);
    const r = rOf(Math.min(1, an)) * (1.05 + m.e * 0.45);
    const p = at(an, th, r);
    const g = Math.sin(th) > 0 ? f : b;
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = alpha * smooth(0, 0.1, an) * (1 - smooth(0.95, 1.15, an));
    g.save();
    g.translate(p.x, p.y);
    g.rotate(th * 2 + m.e * 5);
    if (i % 3 === 2) {
      // 黒い粒（細い欠片）
      g.fillStyle = '#152018';
      g.fillRect(-4 * u, -0.9 * u, 8 * u, 1.8 * u);
    } else {
      g.fillStyle = LEAF_COLS[i % 4];
      const sz = (3.5 + m.e * 3) * u;
      g.beginPath();
      g.moveTo(-sz * 1.4, 0);
      g.quadraticCurveTo(0, -sz, sz * 1.4, 0);
      g.quadraticCurveTo(0, sz * 0.8, -sz * 1.4, 0);
      g.fill();
    }
    g.restore();
  }
  dust(f, true); rings(f, true);
  // 発動の瞬間（0.3 秒）：白い閃光・トゲの星・黒い集中線
  if (!still && T < 0.32) {
    const q = T / 0.32;
    const a = 1 - q;
    const R0 = Math.max(box.w, box.h) * (0.5 + q * 0.6);
    const cx = box.cx, cy = box.cy;
    const r = rngOf(seed * 13 + 5);
    f.globalCompositeOperation = 'source-over';
    // 黒い集中線（外から中心へ細る楔）
    for (let i = 0; i < 16; i++) {
      const ang = r() * 6.283, L = R0 * (0.5 + r() * 0.6), w = (2 + r() * 4) * u;
      const ox = cx + Math.cos(ang) * R0 * 1.25, oy = cy + Math.sin(ang) * R0 * 1.25;
      const ix = cx + Math.cos(ang) * (R0 * 1.25 - L), iy = cy + Math.sin(ang) * (R0 * 1.25 - L);
      f.globalAlpha = a * 0.85;
      f.fillStyle = '#0c1412';
      f.beginPath();
      f.moveTo(ox - Math.sin(ang) * w, oy + Math.cos(ang) * w);
      f.lineTo(ix, iy);
      f.lineTo(ox + Math.sin(ang) * w, oy - Math.cos(ang) * w);
      f.closePath(); f.fill();
    }
    // トゲの星（主の色の長いトゲの中に白いトゲ）
    for (const [col, sc] of [[F.color, 1], [F.core, 0.6]]) {
      f.globalAlpha = a;
      f.fillStyle = col;
      f.beginPath();
      const n = 14;
      for (let i = 0; i < n * 2; i++) {
        const ang = (i / (n * 2)) * 6.283 + 0.2;
        const rr = i % 2 ? R0 * 0.12 * sc : R0 * (0.45 + 0.4 * ((h32(i * 31 + seed) % 100) / 100)) * sc;
        f.lineTo(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
      }
      f.closePath(); f.fill();
    }
    const gr = f.createRadialGradient(cx, cy, 0, cx, cy, R0 * 0.45);
    gr.addColorStop(0, rgba('#ffffff', a)); gr.addColorStop(0.5, rgba(F.core, a * 0.8)); gr.addColorStop(1, rgba(F.color, 0));
    f.globalAlpha = 1;
    f.fillStyle = gr;
    f.beginPath(); f.arc(cx, cy, R0 * 0.45, 0, 6.283); f.fill();
  }
  b.globalAlpha = 1; f.globalAlpha = 1;
}

// ---- 流星（2D）。宇宙のエネルギーの彗星：馬が彗星の頭になり、桃色の殻が体を包み、紫から青紫へ消える尾を後ろへ引く。
// 頭はアニメのセル調（光の色の外殻 → 主の色 → 芯の桃白を段で塗り、殻の中を濃い紫の流れと白い筋が後ろへ流れる）。
// 周りは宇宙：暗い星雲の地・星の粒・走る光の筋・四芒星のきらめき・尾に乗る星座。発動の瞬間は鼻先の閃光と十字の光芒と輪。
// 軸は走る向きに沿い、後ろほど少し上がる（COMET_TILT）。s は鼻先からの後ろへの距離、n は軸から上への距離（px）。
const COMET_TILT = 0.09;
const COMET_DARK = '#5a1fc8';   // 殻の中の濃い紫の流れ
function cometGeo(c, T, still) {
  const { box } = c;
  const tr = c.trail || 1;
  const grow = still ? 1 : ease(T / 0.32);
  const tail = still ? 1 : ease(T / 0.7);
  const bx = tr * Math.cos(COMET_TILT), by = -Math.sin(COMET_TILT);
  const nx = -tr * Math.sin(COMET_TILT), ny = -Math.cos(COMET_TILT);
  const x0 = (tr > 0 ? box.x0 : box.x1) - tr * box.w * 0.1, y0 = box.y0 + box.h * 0.56;
  const at = (s, n) => [x0 + bx * s + nx * n, y0 + by * s + ny * n];
  // 殻の長さと太さ（頭から尾の付け根まで）。発動で鼻先から後ろへ伸びる
  const L = box.w * 1.22 * (0.3 + 0.7 * grow);
  const H = box.h * 0.62 * (0.25 + 0.75 * grow);
  return { tr, grow, tail, at, L, H, bx, by, nx, ny, x0, y0 };
}
// 殻の形（q＝0 鼻先 〜 1 尾の付け根）：丸い鼻先（平方根）→ 胴の太さ → 尾へ細る。縁は後ろへ流れるうねりでちぎれる
const shellH = (q) => Math.sqrt(clamp01(q / 0.2)) * (1 - 0.12 * smooth(0.2, 0.55, q)) * Math.pow(1 - smooth(0.45, 1, q), 0.9);
function shellPath(g, G, T, u, { len = 1, hs = 1, s0 = 0, wob = 1, side = 0 } = {}) {
  const n = 44;
  const pt = (q, up) => {
    const s = s0 + q * G.L * len;
    // 縁のうねり：大きくゆっくり（液体のように）。細かい波を強くすると炎のギザギザに見えた
    const w = 1 + wob * (0.035 * Math.sin(s / (34 * u) - T * 7 + (up ? 0 : 2.1) + side) + 0.012 * Math.sin(s / (12 * u) - T * 12 + (up ? 1 : 3) + side));
    return G.at(s, (up ? 1 : -1) * G.H * hs * shellH(q) * w * (up ? 1 : 0.92));
  };
  g.beginPath();
  for (let i = 0; i <= n; i++) { const p = pt(i / n, true); if (i) g.lineTo(...p); else g.moveTo(...p); }
  for (let i = n; i >= 0; i--) g.lineTo(...pt(i / n, false));
  g.closePath();
}
// 宇宙の飾り（星の粒・光の筋・きらめき・星座）の置き場所は最初に一度だけ決める
function cometBits(c) {
  if (c.comet) return c.comet;
  const r = rngOf(c.seed * 7 + 3);
  c.comet = {
    stars: Array.from({ length: 130 }, () => ({ x: r(), y: r(), s: r(), c: r(), tw: r() * 6.283, v: 0.2 + r() * 0.8 })),
    lines: Array.from({ length: 34 }, () => ({ x: r(), y: r(), L: r(), w: r(), c: r(), v: 0.6 + r() * 0.8, front: r() < 0.3 })),
    sparks: Array.from({ length: 16 }, () => ({ q: r(), n: r() * 2 - 1, s: r(), tw: r() * 6.283, v: r() })),
    bands: Array.from({ length: 6 }, (_, i) => ({ n: (r() * 2 - 1) * 0.5, A: 0.12 + r() * 0.2, lam: 0.25 + r() * 0.3, ph: r() * 6.283, w: 0.1 + r() * 0.16, q0: r() * 0.2, len: 0.45 + r() * 0.45, dark: i % 2 === 0 })),
    cons: Array.from({ length: 3 }, (_, i) => {
      const n = 4 + Math.floor(r() * 2);
      const q0 = 0.75 + i * 0.32 + r() * 0.1, n0 = (r() * 2 - 1) * 0.6;
      return Array.from({ length: n }, (_, j) => ({ q: q0 + j * (0.07 + r() * 0.06), n: n0 + (r() * 2 - 1) * 0.28, s: r() }));
    }),
  };
  return c.comet;
}

/** 流星の土台（形の後ろ）：星雲の地・星の粒・尾・殻と中の流れ。 */
function cometBack(b, f, t, k, c, still) {
  const { F, u, w, h } = c;
  const T = still ? 1.2 + c.s : t;
  const G = cometGeo(c, T, still);
  const B = cometBits(c);
  const deep = F.deep ?? F.glow;
  // 暗い星雲の地：頭のまわりを沈めて、桃色と紫の光を立たせる（明るい競馬場の前でも宇宙に見える）
  {
    const [cx, cy] = G.at(G.L * 0.42, 0);
    b.save();
    b.translate(cx, cy);
    b.rotate(Math.atan2(G.by, G.bx));
    const RX = G.L * 1.35;
    b.scale(1, (G.H * 3) / RX);
    // 消えるときは暗い地を先に引く（明るい光と一緒に薄めると灰色に濁った）
    const kd = k * k;
    const gr = b.createRadialGradient(0, 0, 0, 0, 0, RX);
    gr.addColorStop(0, rgba('#0e0424', 0.78 * kd)); gr.addColorStop(0.45, rgba('#170842', 0.62 * kd)); gr.addColorStop(0.75, rgba('#1d0b4a', 0.3 * kd)); gr.addColorStop(1, rgba('#1d0b4a', 0));
    b.globalCompositeOperation = 'source-over';
    b.globalAlpha = 1;
    b.fillStyle = gr;
    b.beginPath(); b.arc(0, 0, RX, 0, 6.283); b.fill();
    b.restore();
  }
  // 星の粒（後ろへゆっくり流れ、瞬く。少しだけ走る向きに伸ばす）
  b.globalCompositeOperation = 'lighter';
  b.lineCap = 'round';
  for (const s of B.stars) {
    const drift = ((s.x - (still ? 0 : T) * 0.05 * s.v * G.tr) % 1 + 1) % 1;
    const x = drift * w, y = s.y * h;
    const tw = still ? 0.55 + 0.45 * Math.sin(s.tw + c.s * 7) : 0.5 + 0.5 * Math.sin(T * (4 + s.v * 6) + s.tw);
    const col = s.c < 0.45 ? '#ffffff' : s.c < 0.75 ? deep : F.color;
    const sz = (1 + s.s * 2.6) * u;
    b.globalAlpha = k * (0.4 + 0.6 * tw) * (0.55 + s.s * 0.45);
    b.strokeStyle = col; b.lineWidth = sz;
    b.beginPath(); b.moveTo(x, y); b.lineTo(x + G.bx * sz * (1 + s.v * 2.5), y + G.by * sz * (1 + s.v * 2.5)); b.stroke();
    // 大きな星はきらめきの十字を付ける
    if (s.s > 0.86) glint(b, x, y, sz * 5, col, '#ffffff', b.globalAlpha);
  }
  b.globalAlpha = 1;
  // 外の光（頭のまわりのにじみ）
  for (let i = 0; i < 6; i++) {
    const q = i / 5;
    const [x, y] = G.at(G.L * (0.08 + q * 0.75), 0);
    const R = G.H * (1.45 - q * 0.7);
    const gr = b.createRadialGradient(x, y, 0, x, y, R);
    gr.addColorStop(0, rgba(i < 2 ? F.color : F.glow, 0.3 * k)); gr.addColorStop(0.6, rgba(F.glow, 0.12 * k)); gr.addColorStop(1, rgba(F.glow, 0));
    b.fillStyle = gr;
    b.beginPath(); b.arc(x, y, R, 0, 6.283); b.fill();
  }
  // 尾：殻の中ほどから後ろへ伸びる光の帯（くっきりした縁、後ろほど紫から青紫へ消える）。後ろへ流れて揺れる
  const TL = G.L * 2.2 * G.tail;
  for (let i = 0; i < 13; i++) {
    const m = P0(c, i);
    const n0 = (m.a * 2 - 1) * 0.7;                // 付け根の高さ（殻の太さに対する割合）
    const s0 = G.L * (0.3 + m.b * 0.35);
    const len = TL * (0.45 + m.c * 0.65);
    const wd = G.H * (0.06 + m.d * 0.15);
    const N = 18;
    const top = [], bot = [];
    for (let j = 0; j <= N; j++) {
      const q = j / N;
      const s = s0 + q * len;
      const n = G.H * (n0 * (1 - q * 0.45) + 0.06 * Math.sin(q * 5 - T * 3 + i)) ;
      const ww = wd * (1 - q) ** 0.7 * (0.85 + 0.15 * Math.sin(q * 13 - T * 9 + i * 2));
      top.push(G.at(s, n + ww)); bot.push(G.at(s, n - ww));
    }
    const [ax, ay] = G.at(s0, 0), [ex, ey] = G.at(s0 + len, 0);
    const gr = b.createLinearGradient(ax, ay, ex, ey);
    gr.addColorStop(0, rgba(F.color, 0.75 * k)); gr.addColorStop(0.3, rgba(F.glow, 0.6 * k)); gr.addColorStop(0.75, rgba(deep, 0.32 * k)); gr.addColorStop(1, rgba(deep, 0));
    b.globalCompositeOperation = 'lighter';
    b.fillStyle = gr;
    b.beginPath(); b.moveTo(...top[0]);
    for (const p of top) b.lineTo(...p);
    for (let j = bot.length - 1; j >= 0; j--) b.lineTo(...bot[j]);
    b.closePath(); b.fill();
    // 帯の芯（細い明るい線）
    if (i % 2 === 0) {
      const g2 = b.createLinearGradient(ax, ay, ex, ey);
      g2.addColorStop(0, rgba(F.core, 0.7 * k)); g2.addColorStop(0.5, rgba(F.color, 0.3 * k)); g2.addColorStop(1, rgba(F.color, 0));
      b.strokeStyle = g2; b.lineWidth = Math.max(1, wd * 0.25);
      b.beginPath(); top.forEach((p, j) => { const q = bot[j]; const m2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; if (j) b.lineTo(...m2); else b.moveTo(...m2); }); b.stroke();
    }
  }
  // 殻：鼻先の丸みに沿って入れ子になった三日月の段（セル調）。外から 光の色 → 主の色 → 濃い紫の隙間 → 桃 → 芯の桃白。
  // 中ほどは透かして縁を光らせる（エネルギーの膜。地が少し見える）。普通の合成で色を残す（明るい地でも白く飛ばない）
  const [nx0, ny0] = G.at(0, 0), [nx1, ny1] = G.at(G.L, 0);
  const lin = (stops, l = 1) => { const [ex, ey] = G.at(G.L * l, 0); const gr = b.createLinearGradient(nx0, ny0, ex, ey); for (const [o, col, a] of stops) gr.addColorStop(o, rgba(col, a * k)); return gr; };
  b.globalCompositeOperation = 'source-over';
  // 普通の合成の殻は k² で薄める（消え際に光と同じ速さで薄めると、緑の地と混ざって灰色の膜が残った）
  b.globalAlpha = k;
  shellPath(b, G, T, u, { hs: 1.1, len: 1.05, s0: -G.L * 0.035 });
  b.fillStyle = lin([[0, F.glow, 0.7], [0.45, F.glow, 0.5], [1, deep, 0]]);
  b.fill();
  shellPath(b, G, T, u);
  b.fillStyle = lin([[0, F.color, 0.95], [0.3, F.color, 0.62], [0.7, F.glow, 0.4], [1, F.glow, 0]]);
  b.fill();
  b.globalAlpha = 1;
  // 縁の内側の光（殻で切り抜いて縁を太くなぞる＝縁ほど明るい膜）と、殻の中の流れ（濃い紫のうねりと白い筋が後ろへ流れる）
  b.save();
  shellPath(b, G, T, u);
  b.clip();
  b.globalCompositeOperation = 'lighter';
  b.lineJoin = 'round';
  shellPath(b, G, T, u);
  b.strokeStyle = lin([[0, F.core, 0.55], [0.4, F.color, 0.4], [1, F.color, 0]]);
  b.lineWidth = G.H * 0.22;
  b.stroke();
  for (const bd of B.bands) {
    const N = 22;
    const top = [], bot = [];
    for (let j = 0; j <= N; j++) {
      const q = bd.q0 + (j / N) * bd.len;
      const s = q * G.L;
      const n = G.H * shellH(q) * (bd.n + bd.A * Math.sin(q / bd.lam * 6.283 - T * 5 + bd.ph));
      const ww = G.H * bd.w * Math.sin(Math.PI * (j / N)) ** 0.8 * shellH(q);
      top.push(G.at(s, n + ww)); bot.push(G.at(s, n - ww * 0.6));
    }
    b.globalCompositeOperation = bd.dark ? 'source-over' : 'lighter';
    b.globalAlpha = (bd.dark ? 0.32 * k : 0.4) * k;
    b.fillStyle = bd.dark ? COMET_DARK : F.core;
    b.beginPath(); b.moveTo(...top[0]);
    for (const p of top) b.lineTo(...p);
    for (let j = bot.length - 1; j >= 0; j--) b.lineTo(...bot[j]);
    b.closePath(); b.fill();
  }
  b.restore();
  b.globalAlpha = 1;
  // 鼻先の三日月の段（同じ鼻先の形を少し後ろへずらして縮めた入れ子。濃い紫の隙間を挟んで桃 → 桃白）
  b.globalCompositeOperation = 'source-over';
  shellPath(b, G, T, u, { hs: 0.8, len: 0.6, s0: G.L * 0.045, wob: 1.4, side: 2 });
  b.fillStyle = lin([[0, COMET_DARK, 0.5 * k], [0.3, COMET_DARK, 0.28 * k], [0.6, COMET_DARK, 0]]);
  b.fill();
  b.globalCompositeOperation = 'lighter';
  shellPath(b, G, T, u, { hs: 0.66, len: 0.5, s0: G.L * 0.075, wob: 1.8, side: 4 });
  b.fillStyle = lin([[0, F.color, 0.7], [0.25, F.color, 0.45], [0.5, F.color, 0]]);
  b.fill();
  // 芯（鼻先の桃白の塊）
  b.globalCompositeOperation = 'lighter';
  shellPath(b, G, T, u, { hs: 0.44, len: 0.34, s0: G.L * 0.11, wob: 2.2, side: 1 });
  b.fillStyle = lin([[0, F.core, 0.9], [0.14, F.core, 0.7], [0.3, F.color, 0.25], [0.4, F.color, 0]]);
  b.fill();
  b.globalCompositeOperation = 'source-over';
  b.globalAlpha = 1;
}
// 飾り用の決まった乱数（P.motes を流用。cometBits と別に、尾の帯ごとの値）
const P0 = (c, i) => c.P.motes[40 + (i % 20)];

/** 流星の前（形の前）：鼻先の縁の光・薄い膜・四芒星・星座・光の筋・発動の閃光。 */
function cometFront(b, f, t, k, c, still) {
  const { F, u, w, h } = c;
  const T = still ? 1.2 + c.s : t;
  const G = cometGeo(c, T, still);
  const B = cometBits(c);
  const deep = F.deep ?? F.glow;
  // 走る光の筋（画面いっぱいに、軸の向きに後ろへ飛ぶ。頭が白く尾が消える）
  for (const ln of B.lines) {
    const g = ln.front ? f : b;
    const span = w + 600 * u;
    const along = ((ln.x * span + (still ? 0 : T) * 900 * u * ln.v) % span) - 300 * u;
    const x = G.tr > 0 ? along : w - along;
    const y = ln.y * h;
    const L = (40 + ln.L * 220) * u;
    const ex = x + G.bx * L, ey = y + G.by * L;
    const col = ln.c < 0.4 ? F.color : ln.c < 0.7 ? deep : F.core;
    const gr = g.createLinearGradient(x, y, ex, ey);
    gr.addColorStop(0, rgba('#ffffff', 0.85 * k)); gr.addColorStop(0.15, rgba(col, 0.6 * k)); gr.addColorStop(1, rgba(col, 0));
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = gr; g.lineCap = 'round';
    g.lineWidth = (0.8 + ln.w * 1.8) * u;
    g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.stroke();
  }
  // 薄い膜（馬が光の殻の中に居るように見せる。芯の周りだけ、馬が読める薄さ）
  f.globalCompositeOperation = 'lighter';
  f.globalAlpha = (still ? 0.13 : 0.18) * k;
  shellPath(f, G, T, u, { hs: 0.95, len: 0.75 });
  const [nx0, ny0] = G.at(0, 0), [nx1, ny1] = G.at(G.L * 0.75, 0);
  const gv = f.createLinearGradient(nx0, ny0, nx1, ny1);
  gv.addColorStop(0, F.core); gv.addColorStop(0.4, F.color); gv.addColorStop(1, 'rgba(0,0,0,0)');
  f.fillStyle = gv; f.fill();
  f.globalAlpha = 1;
  // 鼻先の縁の光（殻の前の縁をなぞる桃白の線）
  f.save();
  f.globalCompositeOperation = 'lighter';
  f.lineJoin = 'round'; f.lineCap = 'round';
  const rimPts = [];
  for (let i = 0; i <= 30; i++) {
    const q = 0.34 * (1 - i / 15) * (i < 15 ? 1 : -1);
    const qq = Math.abs(q), up = i <= 15;
    const s = qq * G.L;
    const wv = 1 + 0.05 * Math.sin(s / (26 * u) - T * 8 + (up ? 0 : 2.1));
    rimPts.push(G.at(s, (up ? 1 : -1) * G.H * shellH(qq) * wv * (up ? 1 : 0.92)));
  }
  for (const [col, lw, a, blur] of [[F.color, 7, 0.45, 14], [F.core, 2.6, 0.95, 6]]) {
    f.shadowColor = F.color; f.shadowBlur = SOFT ? blur * u : 0;
    f.strokeStyle = rgba(col, a * k); f.lineWidth = lw * u;
    f.beginPath(); rimPts.forEach((p, i) => (i ? f.lineTo(...p) : f.moveTo(...p))); f.stroke();
  }
  f.shadowBlur = 0;
  f.restore();
  // 鼻先の光の玉
  {
    const [x, y] = G.at(G.L * 0.02, 0);
    const R = G.H * 0.5;
    const gr = f.createRadialGradient(x, y, 0, x, y, R);
    gr.addColorStop(0, rgba('#ffffff', 0.75 * k)); gr.addColorStop(0.25, rgba(F.core, 0.45 * k)); gr.addColorStop(1, rgba(F.color, 0));
    f.globalCompositeOperation = 'lighter';
    f.fillStyle = gr; f.beginPath(); f.arc(x, y, R, 0, 6.283); f.fill();
  }
  // 四芒星のきらめき（殻と尾に散らして、後ろへゆっくり流れながら瞬く）
  for (const sp of B.sparks) {
    const q = (sp.q + (still ? 0 : T) * 0.25 * (0.5 + sp.v)) % 1.6;
    const s = q * G.L;
    const n = sp.n * G.H * (q < 1 ? shellH(Math.min(1, q)) + 0.25 : 0.7);
    const [x, y] = G.at(s, n);
    const tw = still ? 0.6 + 0.4 * Math.sin(sp.tw + c.s * 6) : 0.5 + 0.5 * Math.sin(T * 9 + sp.tw);
    const R = (6 + sp.s * 14) * u * (0.6 + 0.4 * tw);
    glint(q < 0.55 ? f : b, x, y, R, F.color, F.core, k * (0.55 + 0.45 * tw) * (1 - smooth(1.2, 1.6, q)));
  }
  // 星座（尾に乗る点と細い線。後ろへ流れる）
  f.globalCompositeOperation = 'lighter';
  for (const con of B.cons) {
    const pts = con.map((p) => {
      const q = p.q + (still ? 0 : T) * 0.12;
      return [...G.at(q * G.L, p.n * G.H), p.s, q];
    });
    const a = k * G.tail * (1 - smooth(1.6, 2.1, pts[0][3]));
    if (a <= 0.01) continue;
    f.strokeStyle = rgba(F.core, 0.55 * a); f.lineWidth = 1.1 * u;
    f.beginPath(); pts.forEach((p, i) => (i ? f.lineTo(p[0], p[1]) : f.moveTo(p[0], p[1]))); f.stroke();
    for (const p of pts) {
      f.fillStyle = rgba('#ffffff', 0.9 * a);
      f.beginPath(); f.arc(p[0], p[1], (1.4 + p[2] * 1.6) * u, 0, 6.283); f.fill();
      if (p[2] > 0.55) glint(f, p[0], p[1], (5 + p[2] * 6) * u, deep, F.core, a * 0.8);
    }
  }
  // 発動の瞬間（0.35 秒）：鼻先の白い閃光・十字の光芒・広がる輪
  if (!still && T < 0.38) {
    const q = T / 0.38, a = 1 - q;
    const [x, y] = G.at(G.L * 0.05, 0);
    const R0 = Math.max(c.box.w, c.box.h);
    f.globalCompositeOperation = 'lighter';
    const gr = f.createRadialGradient(x, y, 0, x, y, R0 * (0.25 + q * 0.35));
    gr.addColorStop(0, rgba('#ffffff', a)); gr.addColorStop(0.3, rgba(F.core, 0.8 * a)); gr.addColorStop(1, rgba(F.color, 0));
    f.fillStyle = gr; f.beginPath(); f.arc(x, y, R0 * (0.25 + q * 0.35), 0, 6.283); f.fill();
    for (const [dx, dy, L] of [[1, 0, 1.4], [0, 1, 0.7], [0.7, 0.7, 0.35], [0.7, -0.7, 0.35]]) {
      const LL = R0 * L * (0.5 + q * 0.7);
      const g2 = f.createLinearGradient(x - dx * LL, y - dy * LL, x + dx * LL, y + dy * LL);
      g2.addColorStop(0, rgba(F.color, 0)); g2.addColorStop(0.5, rgba('#ffffff', 0.95 * a)); g2.addColorStop(1, rgba(F.color, 0));
      f.strokeStyle = g2; f.lineWidth = (dy && dx ? 2 : 4) * u * (1 - q * 0.5);
      f.beginPath(); f.moveTo(x - dx * LL, y - dy * LL); f.lineTo(x + dx * LL, y + dy * LL); f.stroke();
    }
    f.strokeStyle = rgba(F.color, 0.9 * a); f.lineWidth = 3 * u * a + 0.5;
    f.beginPath(); f.ellipse(x, y, R0 * 0.7 * q, R0 * 0.42 * q, -COMET_TILT * G.tr, 0, 6.283); f.stroke();
  }
  f.globalCompositeOperation = 'source-over'; b.globalCompositeOperation = 'source-over';
  f.globalAlpha = 1; b.globalAlpha = 1;
}

// 種類ごとの飾り（オーラの粒の上に重ねる）
const DRAW = {
  // 金色の光：後ろから射す光の筋と、きらめき
  radiance(b, f, t, k, c, still) {
    const { F, box, u, P, w, h } = c;
    b.globalCompositeOperation = 'lighter';
    // 横長の絵（カットインの字）では筋が絵の上下の縁で四角く切れるので、短い辺の中で消す
    const R = Math.max(w, h) / Math.min(w, h) > 1.6 ? Math.min(w, h) * 0.5 : Math.max(w, h) * 0.85;
    const rot = still ? 0.2 + c.s * 0.35 : t * 0.35;
    for (let i = 0; i < 18; i++) {
      const a = rot + (i / 18) * Math.PI * 2;
      const wd = (i % 2 ? 0.05 : 0.09);
      const gr = b.createRadialGradient(box.cx, box.cy, 0, box.cx, box.cy, R);
      gr.addColorStop(0, rgba(F.core, 0.42 * k)); gr.addColorStop(0.35, rgba(F.color, 0.22 * k)); gr.addColorStop(1, rgba(F.glow, 0));
      b.fillStyle = gr;
      b.beginPath(); b.moveTo(box.cx, box.cy);
      b.lineTo(box.cx + Math.cos(a - wd) * R, box.cy + Math.sin(a - wd) * R);
      b.lineTo(box.cx + Math.cos(a + wd) * R, box.cy + Math.sin(a + wd) * R);
      b.closePath(); b.fill();
    }
    for (const m of P.motes.slice(0, 26)) {
      const x = box.x0 - 40 * u + m.a * (box.w + 80 * u);
      const y = box.y1 - ((m.b * (box.h + 120 * u) + ((still ? c.s : t) * (40 + m.c * 60) * u)) % (box.h + 120 * u));
      const tw = still ? 0.6 + m.d * 0.4 : 0.5 + 0.5 * Math.sin(t * 9 + m.e * 9);
      glint(f, x, y, (5 + m.c * 10) * u, F.color, F.core, k * tw);
    }
  },
  // イナズマ：空から落ちる一本と、形から外へ走る稲妻（0.07 秒ごとに形を変えて瞬く）
  thunder(b, f, t, k, c, still) {
    const { F, box, u, P, w } = c;
    const fi = still ? 3 + Math.floor(c.s / 0.07) : Math.floor(t / 0.07);
    const r = rngOf(c.seed * 31 + fi * 977);
    const top = P.bolts.filter((e) => e.ny < -0.3);
    const hit = top[Math.floor(r() * top.length)] ?? P.bolts[0];
    const sx = hit.x + (r() - 0.5) * 140 * u, sy = Math.max(0, box.y0 - 260 * u);
    const L = Math.hypot(hit.x - sx, hit.y - sy);
    strokeBolt(b, zigzag(r, sx, sy, (hit.x - sx) / L, (hit.y - sy) / L, L, 9, 22 * u), F, u, k, 1.3);
    const n = still ? 6 : 3 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const e = P.bolts[Math.floor(r() * P.bolts.length)];
      const L2 = (45 + r() * 110) * u;
      const pts = zigzag(r, e.x, e.y, e.nx, e.ny, L2, 6, 13 * u);
      strokeBolt(f, pts, F, u, k * (0.75 + r() * 0.25), 0.8);
      if (r() < 0.6) {
        const m = pts[2 + Math.floor(r() * 2)];
        const a = Math.atan2(e.ny, e.nx) + (r() < 0.5 ? -0.8 : 0.8);
        strokeBolt(f, zigzag(r, m[0], m[1], Math.cos(a), Math.sin(a), L2 * 0.5, 4, 9 * u), F, u, k * 0.7, 0.5);
      }
    }
    if (!still && fi % 9 === 0) { f.globalCompositeOperation = 'lighter'; f.fillStyle = rgba(F.core, 0.16 * k); f.fillRect(0, 0, w, c.h); }
  },
  // 燃えるオーラ：炎はオーラの粒そのもの。舞い上がる火の粉だけ足す
  flame(b, f, t, k, c, still) {
    const { box, u, P } = c;
    const spr = c.spr.steps;
    for (const m of P.motes.slice(0, 44)) {
      const H = box.h + 160 * u;
      const y = box.y1 + 20 * u - ((m.b * H + ((still ? c.s : t) * (110 + m.c * 140) * u)) % H);
      const x = box.x0 + m.a * box.w + Math.sin((still ? c.s : t) * 3 + m.d * 9) * 18 * u + c.trail * (still ? c.s : t) * 30 * u * m.e;
      const s = (2.5 + m.c * 4) * u;
      f.globalCompositeOperation = 'lighter';
      f.globalAlpha = k * (0.55 + m.e * 0.45);
      f.drawImage(spr[1 + Math.floor(m.d * 3)], x - s * 1.6, y - s * 1.6, s * 3.2, s * 3.2);
    }
    f.globalAlpha = 1;
  },
  // 氷結：縁から外へ伸びる氷の棘と、舞う結晶
  frost(b, f, t, k, c, still) {
    const { F, box, u, P } = c;
    const grow = still ? 1 : ease(t / 0.5);
    for (const e of P.spikes) {
      const L = (16 + e.k * 40) * u * grow;
      const W = (3.5 + e.k * 3.5) * u;
      const px = -e.ny, py = e.nx;
      const tx = e.x + e.nx * L, ty = e.y + e.ny * L;
      const g = e.r < 0.75 ? b : f;
      g.globalCompositeOperation = 'lighter';
      const gr = g.createLinearGradient(e.x, e.y, tx, ty);
      gr.addColorStop(0, rgba(F.glow, 0.45 * k)); gr.addColorStop(0.6, rgba(F.color, 0.7 * k)); gr.addColorStop(1, rgba(F.core, 0.9 * k));
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(e.x + px * W, e.y + py * W); g.lineTo(tx, ty); g.lineTo(e.x - px * W, e.y - py * W); g.closePath(); g.fill();
      g.strokeStyle = rgba(F.core, 0.75 * k); g.lineWidth = 1.2 * u;
      g.beginPath(); g.moveTo(e.x, e.y); g.lineTo(tx, ty); g.stroke();
    }
    for (const m of P.motes.slice(0, 26)) {
      const x = box.x0 - 60 * u + m.a * (box.w + 120 * u);
      const H = box.h + 160 * u;
      const y = box.y0 - 60 * u + ((m.b * H + ((still ? c.s : t) * (20 + m.c * 30) * u)) % H);
      const R = (5 + m.c * 9) * u;
      f.globalCompositeOperation = 'lighter';
      f.strokeStyle = rgba(F.core, k * (0.55 + m.d * 0.45)); f.lineWidth = 1.4 * u;
      const rot = m.e * 3 + ((still ? c.s : t) * 1.5);
      f.beginPath();
      for (let i = 0; i < 3; i++) { const a = rot + (i / 3) * Math.PI; f.moveTo(x - Math.cos(a) * R, y - Math.sin(a) * R); f.lineTo(x + Math.cos(a) * R, y + Math.sin(a) * R); }
      f.stroke();
      if (m.d > 0.7) glint(f, x, y, R * 1.4, F.glow, F.core, k * 0.8);
    }
  },
  // 桜吹雪：馬を巻いて舞う花びら（半分は後ろ、半分は前）
  sakura(b, f, t, k, c, still) {
    const { F, box, u, P } = c;
    const tt = still ? 0.9 + c.s : t;
    for (const [i, m] of P.motes.entries()) {
      const ang = m.a * Math.PI * 2 + tt * (0.9 + m.c * 0.8);
      const rx = box.w * (0.55 + m.b * 0.35), ry = box.h * (0.28 + m.d * 0.3);
      const x = box.cx + Math.cos(ang) * rx;
      const y = box.cy + Math.sin(ang) * ry * 0.6 - (m.e - 0.5) * box.h * 0.9 + (still ? c.s * 25 * u : tt * 25 * u);
      const front = Math.sin(ang) > 0;
      petal(front ? f : b, x, y, (7 + m.c * 7) * u, m.e * 6 + tt * (2 + m.b * 3), F, k * (0.75 + m.d * 0.25));
      if (i % 6 === 0) glint(f, x, y, 10 * u, F.color, F.core, k * 0.5);
    }
  },
  // 疾風：アニメ調の竜巻（参考はアニメの必殺技の風の竜巻）。下が細く上へ開く漏斗を、芯の白いミントの帯が巻いて回る。
  // 足元は白い波紋と土煙、葉と黒い粒が巻き上がり、発動の瞬間は白い閃光・トゲの星・黒い集中線（galeTornado2D）
  gale(b, f, t, k, c, still) {
    galeTornado2D(b, f, t, k, c, still);
  },
  // 漆黒のオーラ：暗い粒と紫の粒が立ち上る（オーラの粒）。飾りは紫の火の粉だけ
  shadow(b, f, t, k, c, still) {
    const { box, u, P } = c;
    const spr = c.spr.steps;
    for (const m of P.motes.slice(0, 24)) {
      const H = box.h + 140 * u;
      const y = box.y1 - ((m.b * H + ((still ? c.s : t) * (60 + m.c * 70) * u)) % H);
      const x = box.x0 + m.a * box.w + Math.sin((still ? c.s : t) * 2 + m.d * 9) * 20 * u;
      const s = (2.5 + m.c * 3.5) * u;
      f.globalCompositeOperation = 'lighter';
      f.globalAlpha = k * (0.5 + m.e * 0.5);
      f.drawImage(spr[0], x - s * 1.6, y - s * 1.6, s * 3.2, s * 3.2);
    }
    f.globalAlpha = 1;
  },
  // 星屑：馬を巡る星の帯
  star(b, f, t, k, c, still) {
    const { F, box, u, P } = c;
    const tt = still ? 1.1 + c.s : t;
    for (const [i, m] of P.motes.entries()) {
      const ang = m.a * Math.PI * 2 + tt * (1.4 + m.c * 0.6);
      const rx = box.w * (0.55 + m.b * 0.2), ry = box.h * 0.22;
      const x = box.cx + Math.cos(ang) * rx;
      const y = box.cy - box.h * 0.05 + Math.sin(ang) * ry + Math.sin(ang * 2 + m.d * 6) * 18 * u - (m.e - 0.5) * 80 * u;
      const g = Math.sin(ang) > 0 ? f : b;
      const tw = still ? 0.55 + m.d * 0.45 : 0.5 + 0.5 * Math.sin(tt * 10 + m.e * 12);
      if (i % 3 === 0) {
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = rgba(F.core, k * tw);
        g.shadowColor = F.color; g.shadowBlur = SOFT ? 10 * u : 0;
        star(g, x, y, (5 + m.c * 8) * u, 5, 0.45, m.e * 3);
        g.fill();
        g.shadowBlur = 0;
      } else {
        glint(g, x, y, (4 + m.c * 8) * u, F.color, F.core, k * tw);
      }
    }
  },
  comet: cometFront,
};
// 形の後ろの土台（オーラの粒より先に描く）
const PRE = { comet: cometBack };

// ---------------------------------------------------------------- 3D

const texCache = new Map();
function tex(shape) {
  if (texCache.has(shape)) return texCache.get(shape);
  const S = 64;
  const c = canvasOf(S, S);
  const g = c.getContext('2d');
  const m = S / 2;
  if (shape === 'soft') {
    // オーラの粒：芯から縁へなだらかに（縁の硬い丸は粒が粒に見えて、オーラにならない）
    const gr = g.createRadialGradient(m, m, 0, m, m, m);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.6)');
    gr.addColorStop(0.65, 'rgba(255,255,255,0.16)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  } else if (shape === 'petal') {
    petal(g, m, m, m * 0.8, 0, { core: '#ffffff', color: '#ffffff' }, 1);
  } else if (shape === 'star') {
    glint(g, m, m, m, '#ffffff', '#ffffff', 1);
  } else if (shape === 'star5') {
    g.fillStyle = '#fff'; star(g, m, m, m * 0.85, 5, 0.45); g.fill();
  } else if (shape === 'shard') {
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(m, 2); g.lineTo(m + S * 0.16, m); g.lineTo(m, S - 2); g.lineTo(m - S * 0.16, m); g.closePath(); g.fill();
  } else if (shape === 'streak') {
    const gr = g.createLinearGradient(0, 0, S, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.75, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, m - 3, S, 6);
  }
  const t = new THREE.CanvasTexture(c);
  texCache.set(shape, t);
  return t;
}

/**
 * オーラの粒（3D、馬の組の座標。前が +z）。速さは m/秒：rise 上へ・out 体の外へ・trail 後ろ（−z）へ。
 * size は半径 m、grow は一生で大きくなる割合、ramp は色の移り、dark は暗い粒の割合（漆黒）、stretch は縦横の伸び。
 */
const AURA3 = {
  radiance: { n: 110, life: [0.6, 1.1], rise: 1.4, out: 0.35, trail: 1.0, size: [0.165, 0.315], grow: 0.8, ramp: ['core', 'color', 'glow'] },
  thunder: { n: 100, life: [0.2, 0.45], rise: 0.3, out: 1.3, trail: 2.0, size: [0.12, 0.24], grow: 0.5, ramp: ['core', 'glow', 'glow'], flicker: true },
  flame: { n: 160, life: [0.4, 0.8], rise: 2.6, out: 0.3, trail: 2.4, size: [0.195, 0.375], grow: -0.5, ramp: ['core', 'color', 'glow'], stretch: [0.85, 1.4] },
  frost: { n: 100, life: [0.7, 1.3], rise: -0.15, out: 0.45, trail: 1.4, size: [0.15, 0.285], grow: 0.8, ramp: ['core', 'color', 'glow'] },
  sakura: { n: 90, life: [0.8, 1.4], rise: 0.5, out: 0.45, trail: 1.6, size: [0.15, 0.27], grow: 0.8, ramp: ['core', 'color', 'glow'] },
  gale: { n: 60, life: [0.3, 0.6], rise: 0.3, out: 0.3, trail: 7, size: [0.12, 0.225], grow: 0.4, ramp: ['core', 'color', 'glow'], stretch: [2.8, 0.45] },
  shadow: { n: 150, life: [0.5, 1.0], rise: 1.9, out: 0.3, trail: 1.6, size: [0.225, 0.413], grow: 0.7, ramp: ['color', 'glow', 'dark'], dark: 0.45 },
  star: { n: 100, life: [0.7, 1.2], rise: 0.5, out: 0.4, trail: 1.2, size: [0.15, 0.27], grow: 0.8, ramp: ['core', 'color', 'glow'] },
  // 流星：体から剥がれて尾へ流れる星屑
  comet: { n: 90, life: [0.3, 0.7], rise: 0.1, out: 0.3, trail: 8, size: [0.1, 0.2], grow: 0.3, ramp: ['core', 'color', 'glow'], stretch: [2.4, 0.5] },
};

// 飾りの粒（オーラの上に重ねる）：shape（布）・数・合成、born（生まれる所と速さ）、寿命
const KIND3 = {
  radiance: { shape: 'star', n: 30, blend: 'add', life: [0.7, 1.4], born: (r) => ({ p: [(r() - 0.5) * 3, 0.2 + r() * 2.6, (r() - 0.5) * 3], v: [0, 1.2 + r() * 1.6, 0], s: 0.35 + r() * 0.45 }) },
  flame: { shape: 'star', n: 28, blend: 'add', life: [0.5, 1.0], born: (r) => { const a = r() * Math.PI * 2; return { p: [Math.cos(a) * 0.7, 0.6 + r() * 1.6, Math.sin(a) * 1.1], v: [Math.cos(a) * 0.4, 3 + r() * 2, -1.5 - r()], s: 0.14 + r() * 0.12 }; } },
  frost: { shape: 'shard', n: 30, blend: 'add', life: [0.8, 1.5], born: (r) => { const a = r() * Math.PI * 2; return { p: [Math.cos(a) * 0.6, 0.4 + r() * 1.8, Math.sin(a) * 0.9], v: [Math.cos(a) * 2.2, (r() - 0.3) * 1.2, Math.sin(a) * 2.2], s: 0.3 + r() * 0.5, spin: (r() - 0.5) * 4 }; } },
  sakura: { shape: 'petal', n: 56, blend: 'normal', life: [1.2, 2.2], swirl: 2.4, vivid: true, born: (r) => ({ a: r() * Math.PI * 2, rad: 1.2 + r() * 1.6, p: [0, 0.2 + r() * 1.6, 0], v: [0, 0.6 + r() * 0.9, 0], s: 0.26 + r() * 0.2, spin: (r() - 0.5) * 6 }) },
  // 疾風の飾り（葉・波紋・土煙）は竜巻が受け持つ
  gale: { shape: 'streak', n: 0, blend: 'add', life: [0.35, 0.7], born: () => ({}) },
  shadow: { shape: 'star', n: 20, blend: 'add', life: [0.6, 1.1], born: (r) => { const a = r() * Math.PI * 2; return { p: [Math.cos(a) * 0.6, 0.4 + r() * 1.6, Math.sin(a) * 1.0], v: [0, 1.6 + r() * 1.4, -1 - r()], s: 0.14 + r() * 0.14 }; } },
  star: { shape: 'star5', n: 40, blend: 'add', life: [0.9, 1.6], swirl: 3.2, born: (r) => ({ a: r() * Math.PI * 2, rad: 1.4 + r() * 1.0, p: [0, 0.4 + r() * 2.4, 0], v: [0, 0.5 + r() * 0.8, 0], s: 0.2 + r() * 0.3, spin: (r() - 0.5) * 3 }) },
  // 流星の飾り（四芒星・光の筋・閃光）は彗星が受け持つ
  comet: { shape: 'star', n: 0, blend: 'add', life: [0.5, 1], born: () => ({}) },
  thunder: { shape: 'star', n: 20, blend: 'add', life: [0.15, 0.35], born: (r) => { const a = r() * Math.PI * 2; return { p: [Math.cos(a) * 0.9, 0.5 + r() * 1.8, Math.sin(a) * 1.3], v: [Math.cos(a) * 3, (r() - 0.5) * 2, Math.sin(a) * 3], s: 0.4 + r() * 0.5 }; } },
};

// ---- 疾風の竜巻（3D）。2D の galeTornado2D と同じ形：走る向きに寝た漏斗（鼻先の前で細く尾の後ろへ開く）の面を、
// ちぎれた縁のミントの帯が巻いて回る。帯は毎コマ頂点を置き直す（回りながら半径と軸の位置がうねる）。
// 布は帯の幅の向きに 光の色の縁 → 主の色 → 芯の白（セル調にくっきり）、長さの向きに尾が消える。
const ribbonTexCache = new Map();
function ribbonTex(F) {
  const key = F.color + F.glow + F.core;
  if (ribbonTexCache.has(key)) return ribbonTexCache.get(key);
  const W = 256, Hh = 64;
  const c = canvasOf(W, Hh);
  const g = c.getContext('2d');
  const img = g.createImageData(W, Hh);
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const [cg, cc, ck] = [rgb(F.glow), rgb(F.color), rgb(F.core)];
  for (let x = 0; x < W; x++) {
    const uu = x / (W - 1);
    // ちぎれた縁（上下の縁を別々のうねりで）
    const et = 0.1 + 0.07 * (0.5 + 0.5 * Math.sin(uu * 37) * Math.sin(uu * 11 + 1));
    const eb = 0.9 - 0.07 * (0.5 + 0.5 * Math.sin(uu * 29 + 2) * Math.sin(uu * 13));
    const taper = smooth(0, 0.3, uu) * (1 - 0.6 * smooth(0.9, 1, uu));
    for (let y = 0; y < Hh; y++) {
      const v = y / (Hh - 1);
      const i = (y * W + x) * 4;
      const edge = Math.min(v - et, eb - v) * Hh;
      if (edge <= -1) { img.data[i + 3] = 0; continue; }
      const d = Math.abs(v - (et + eb) / 2) / ((eb - et) / 2);
      const [col, a] = d < 0.5 ? [ck, 0.95] : d < 0.86 ? [cc, 0.85] : [cg, 0.72];
      img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2];
      img.data[i + 3] = Math.round(255 * a * taper * clamp01(edge + 1));
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  ribbonTexCache.set(key, t);
  return t;
}
function burstTex(F) {
  const key = 'burst' + F.color;
  if (ribbonTexCache.has(key)) return ribbonTexCache.get(key);
  const S = 256, m = S / 2;
  const c = canvasOf(S, S);
  const g = c.getContext('2d');
  const r = rngOf(77);
  // 黒い集中線
  for (let i = 0; i < 18; i++) {
    const ang = r() * 6.283, L = m * (0.35 + r() * 0.4), w = 1.5 + r() * 3;
    const ox = m + Math.cos(ang) * m * 0.98, oy = m + Math.sin(ang) * m * 0.98;
    const ix = m + Math.cos(ang) * (m * 0.98 - L), iy = m + Math.sin(ang) * (m * 0.98 - L);
    g.fillStyle = 'rgba(12,20,18,0.9)';
    g.beginPath(); g.moveTo(ox - Math.sin(ang) * w, oy + Math.cos(ang) * w); g.lineTo(ix, iy); g.lineTo(ox + Math.sin(ang) * w, oy - Math.cos(ang) * w); g.closePath(); g.fill();
  }
  for (const [col, sc] of [[F.color, 1], [F.core, 0.6]]) {
    g.fillStyle = col;
    g.beginPath();
    for (let i = 0; i < 28; i++) {
      const ang = (i / 28) * 6.283 + 0.2;
      const rr = i % 2 ? m * 0.1 * sc : m * (0.45 + 0.35 * r()) * sc;
      g.lineTo(m + Math.cos(ang) * rr, m + Math.sin(ang) * rr);
    }
    g.closePath(); g.fill();
  }
  const gr = g.createRadialGradient(m, m, 0, m, m, m * 0.42);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, rgba(F.core, 0.8)); gr.addColorStop(1, rgba(F.color, 0));
  g.fillStyle = gr; g.beginPath(); g.arc(m, m, m * 0.42, 0, 6.283); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  ribbonTexCache.set(key, t);
  return t;
}
function leafTex() {
  if (ribbonTexCache.has('leaf')) return ribbonTexCache.get('leaf');
  const S = 32, c = canvasOf(S, S), g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(2, 16); g.quadraticCurveTo(16, 4, 30, 16); g.quadraticCurveTo(16, 26, 2, 16); g.fill();
  const t = new THREE.CanvasTexture(c);
  ribbonTexCache.set('leaf', t);
  return t;
}

function makeTornado3d(F, r) {
  const group = new THREE.Group();
  const R = 8, N = 30;
  const mats = [];
  const ribbons = [];
  const mkStrip = (map, order) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N + 1) * 2 * 3), 3));
    const uv = new Float32Array((N + 1) * 2 * 2);
    const idx = [];
    for (let j = 0; j <= N; j++) {
      uv.set([j / N, 1, j / N, 0], j * 4);
      if (j < N) { const a = j * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    mats.push(mat);
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = order;
    group.add(m);
    return m;
  };
  for (let i = 0; i < R; i++) {
    ribbons.push({ mesh: mkStrip(ribbonTex(F), 17), phi: i * 2.399 + r() * 6.283, w: 7.5 + r() * 2.5, y0: (i / R) * 0.72 + r() * 0.06, span: 0.85 * Math.PI + r() * 0.4, thick: 1.7, i });
  }
  // 白い細い風の弧（帯の外を速く回る）
  const lineMap = (() => {
    const c = canvasOf(128, 8), g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 128, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.8, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 2, 128, 4);
    return new THREE.CanvasTexture(c);
  })();
  for (let i = 0; i < 4; i++) {
    ribbons.push({ mesh: mkStrip(lineMap, 18), phi: r() * 6.283, w: 10 + r() * 3, y0: 0.2 + r() * 0.6, span: 1.3, thick: 0.07, line: true, i: 10 + i });
  }
  // 衝撃波の輪（白と主の色の輪が軸を囲んで後ろへ流れる）
  const rings = [0, 1, 2].map((i) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 56), new THREE.MeshBasicMaterial({ color: i === 1 ? F.color : '#ffffff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    mats.push(m.material);
    m.renderOrder = 16;
    group.add(m);
    return m;
  });
  // 土煙・葉・黒い粒・発動の閃光（スプライト）
  const sprites = [];
  const sp = (map, color, normal = true, order = 19) => {
    const mat = new THREE.SpriteMaterial({ map, color, transparent: true, opacity: 0, depthWrite: false, blending: normal ? THREE.NormalBlending : THREE.AdditiveBlending });
    mats.push(mat);
    const s = new THREE.Sprite(mat);
    s.renderOrder = order;
    group.add(s);
    return s;
  };
  const dust = Array.from({ length: 10 }, () => ({ s: sp(tex('soft'), '#c9d3cf'), a: r() * 6.283, b: r(), c: r(), d: r() }));
  const leaves = Array.from({ length: 36 }, (_, i) => ({
    s: i % 3 === 2 ? sp(tex('streak'), '#152018') : sp(leafTex(), LEAF_COLS[i % 4]),
    speck: i % 3 === 2, a: r() * 6.283, b: r(), c: r(), d: r(), e: r(),
  }));
  const burst = sp(burstTex(F), '#ffffff', true, 25);
  burst.material.depthTest = false;
  // 下の半径は馬の体（前後 2.4m）を包む大きさ。細くすると漏斗の下側が体の中に埋もれた
  // 横向きの竜巻：軸は馬の前後（z、前が +z）に胴の高さで通し、鼻先の前（an＝0）で細く、尾の後ろ（an＝1）へ開く。
  // 帯の幅は軸の向き（z）に取る。下側は地面の下へ潜らないよう高さを抑える
  const ZF = 1.9, LZ = 5.4, CY = 1.35;
  const rOf = (an, open) => 0.6 + (1.65 * (1 + open * 0.3) - 0.6) * Math.pow(Math.max(0, an), 1.2);
  const at = (an, th, r, grow, out) => out.set(Math.sin(th) * r, Math.max(0.05, CY + Math.cos(th) * r * 0.85), ZF - an * LZ * grow);
  const v = new THREE.Vector3();
  return {
    group,
    update(T, life, fade) {
      const grow = ease(T / 0.35);
      const open = smooth(life - 0.8, life, T);
      const alpha = fade * (1 - open * 0.9);
      for (const rb of ribbons) {
        const pos = rb.mesh.geometry.attributes.position.array;
        for (let j = 0; j <= N; j++) {
          const q = j / N;
          const th = rb.phi + rb.w * T + q * rb.span;
          const an = Math.min(1.05, rb.y0 + q * (rb.line ? 0.05 : 0.32) + 0.035 * Math.sin(th * 2 + T * 6));
          const rr = rOf(an, open) * (rb.line ? 1.2 : 1 + 0.07 * Math.sin(th * 3 + T * 5 + rb.i));
          const taper = rb.line ? 1 : smooth(0, 0.35, q) * (1 - smooth(0.88, 1, q) * 0.7);
          const torn = rb.line ? 1 : 0.8 + 0.14 * Math.sin(q * 23 + T * 11 + rb.i * 1.7) * Math.sin(q * 9 - T * 4) + 0.06 * Math.sin(q * 61 + rb.i * 3 + T * 17);
          const hw = rb.thick * (rb.line ? 1 : 0.45 + an * 0.55) * taper * torn * 0.5;
          at(an, th, rr, grow, v);
          pos.set([v.x, v.y, v.z + hw, v.x, v.y, v.z - hw * 0.8], j * 6);
        }
        rb.mesh.geometry.attributes.position.needsUpdate = true;
        rb.mesh.material.opacity = alpha * (rb.line ? 0.85 : 0.92);
      }
      // 衝撃波の輪：軸を囲む輪が鼻先から後ろへ流れながら広がる
      for (const [i, m] of rings.entries()) {
        const ph = (T * 1.1 + i / 3) % 1;
        const rad = rOf(ph, open) * (1.1 + ph * 0.3);
        m.position.set(0, CY, ZF - ph * LZ * grow);
        m.scale.set(rad, rad * 0.85, 1);
        m.material.opacity = (1 - ph) * 0.8 * alpha * grow;
      }
      // 蹴り上げた土煙が後ろへ流れる
      for (const d of dust) {
        const an = (d.b + T * (0.5 + d.c * 0.4)) % 1.1;
        d.s.position.set(Math.cos(d.a) * 0.6, 0.3 + d.d * 0.3 + an * 0.4, ZF - (0.25 + an * 0.9) * LZ * grow);
        const s = (0.7 + d.c * 0.9) * (0.6 + 0.6 * an) * (0.6 + 0.4 * grow);
        d.s.scale.set(s, s, 1);
        d.s.material.opacity = 0.4 * alpha * (1 - smooth(0.8, 1.1, an));
      }
      // 渦に巻かれて後ろへ飛ぶ葉と黒い粒
      for (const l of leaves) {
        const th = l.a + T * (5 + l.b * 3);
        const an = (l.c + T * (0.3 + l.d * 0.3)) % 1.15;
        const rr = rOf(Math.min(1, an), open) * (1.05 + l.e * 0.45);
        at(an, th, rr, grow, l.s.position);
        const s = l.speck ? 0.22 : 0.14 + l.e * 0.1;
        l.s.scale.set(s * (l.speck ? 1 : 1.4), s * (l.speck ? 0.2 : 1), 1);
        l.s.material.rotation = th * 2 + l.e * 5;
        l.s.material.opacity = alpha * smooth(0, 0.1, an) * (1 - smooth(0.95, 1.15, an));
      }
      // 発動の瞬間（0.3 秒）：白い閃光・トゲの星・黒い集中線
      const q = T / 0.3;
      burst.position.set(0, 1.5, 0);
      burst.scale.setScalar(2 + ease(q) * 4.5);
      burst.material.opacity = q < 1 ? (1 - q) : 0;
    },
  };
}

// ---- 流星（3D）。2D の cometBack・cometFront と同じ筋：馬を包む光の殻（鼻先の前で丸く、尾へ細る）と、後ろへ伸びる光の帯の尾、
// 体から剥がれる星屑、四芒星、走る光の筋、発動の閃光。殻はシェーダで縁ほど明るい膜（フレネル）にし、縁の光と中の流れを段で塗る（セル調）。
// 殻は深度を見る（馬の向こう側の殻は馬に隠れ、手前の殻は透けて馬が見える。ほかの粒と違って馬群に埋もれてよい）。
const COMET3 = { ZN: 2.05, L: 5.4, CY: 1.35, RX: 1.05, RY: 1.5 };
let cometGeoCache = null;
function cometShellGeo() {
  if (cometGeoCache) return cometGeoCache;
  // 長さ 1（z＝0 が鼻先、−z へ尾）・半径 1 の殻。断面の半径は 2D の shellH と同じ形。uv.x＝鼻先からの割合、uv.y＝周の割合
  const NQ = 48, NA = 40;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= NQ; i++) {
    const q = (i / NQ) ** 1.35;   // 鼻先を細かく（丸みが角張らない）
    const r = Math.max(0.002, shellH(q));
    for (let j = 0; j <= NA; j++) {
      const a = (j / NA) * Math.PI * 2;
      pos.push(Math.cos(a) * r, Math.sin(a) * r, -q);
      uv.push(q, j / NA);
    }
  }
  for (let i = 0; i < NQ; i++) for (let j = 0; j < NA; j++) {
    const a = i * (NA + 1) + j, b2 = a + NA + 1;
    idx.push(a, b2, a + 1, a + 1, b2, b2 + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  cometGeoCache = g;
  return g;
}
const COMET_VS = `
uniform float uTime; uniform float uWob;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main() {
  vUv = uv;
  vec3 p = position;
  float q = uv.x, a = uv.y * 6.2831853;
  // 縁のうねり（後ろへ流れる。2D と同じく大きくゆっくり）
  p.xy *= 1.0 + uWob * (0.045 * sin(q * 9.0 - uTime * 6.0 + a * 2.0) + 0.015 * sin(q * 23.0 - uTime * 11.0 + a * 3.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const COMET_FS = `
uniform vec3 cCore; uniform vec3 cColor; uniform vec3 cGlow; uniform vec3 cDeep; uniform vec3 cDark;
uniform float uTime; uniform float uFade; uniform float uLayer;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main() {
  float q = vUv.x, a = vUv.y * 6.2831853;
  float fr = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  // 縁の光を段で（セル調）：外の縁ほど明るい 3 段
  float rim = 0.35 * smoothstep(0.42, 0.46, fr) + 0.35 * smoothstep(0.66, 0.7, fr) + 0.3 * smoothstep(0.86, 0.9, fr);
  vec3 col = mix(cColor, cGlow, smoothstep(0.22, 0.7, q));
  col = mix(col, cDeep, smoothstep(0.7, 1.0, q));
  col = mix(cCore, col, smoothstep(0.0, 0.16, q));
  // 殻の中の流れ：うねる縞が後ろへ流れる（明るい筋と濃い紫の溝）
  float f = sin(q * 15.0 - uTime * 5.0 + sin(a * 2.0 + uTime * 1.3) * 1.4 + a);
  col = mix(col, cCore, step(0.62, f) * 0.5 * (1.0 - q));
  col = mix(col, cDark, step(f, -0.7) * 0.6);
  // 縁は外の段だけ桃白に（全部を白へ寄せるとシャボン玉に見えた）。内側の段は主の色のまま濃く
  col = mix(col, cCore, smoothstep(0.86, 0.9, fr) * smoothstep(0.8, 0.1, q) * 0.7);
  float body = (1.0 - smoothstep(0.5, 1.0, q)) * smoothstep(0.0, 0.015, q);
  // 鼻先の塊は縁で見たときだけ濃く（正面から見ると馬の前に丸い板が立って、馬が隠れた）
  float tip = (1.0 - smoothstep(0.0, 0.1, q)) * (0.2 + 0.8 * smoothstep(0.2, 0.7, fr));
  // 正面（縁から遠い所）は薄く：馬が桃色に染まって見えないように。光るのは縁と流れの筋
  float flow = step(0.62, f) * 0.35 * (1.0 - q);
  float alpha = uLayer < 0.5 ? (0.11 + 0.8 * rim + flow) * body + 0.6 * tip : (0.08 + 0.55 * rim + flow) * body + 0.3 * tip;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0) * uFade);
  #include <colorspace_fragment>
}`;
function cometTailTex(F) {
  const key = 'tail' + F.color + F.glow;
  if (ribbonTexCache.has(key)) return ribbonTexCache.get(key);
  const W = 256, Hh = 32;
  const c = canvasOf(W, Hh), g = c.getContext('2d');
  const img = g.createImageData(W, Hh);
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const stops = [[0, rgb(F.core)], [0.12, rgb(F.color)], [0.45, rgb(F.glow)], [1, rgb(F.deep ?? F.glow)]];
  for (let x = 0; x < W; x++) {
    const uu = x / (W - 1);
    let j = 0; while (j < stops.length - 2 && uu > stops[j + 1][0]) j++;
    const tt = clamp01((uu - stops[j][0]) / (stops[j + 1][0] - stops[j][0]));
    const col = stops[j][1].map((v, i) => v + (stops[j + 1][1][i] - v) * tt);
    const along = smooth(0, 0.06, uu) * (1 - uu) ** 1.1;
    // ちぎれた縁（帯ごとに長さ方向へうねる）
    const half = 0.42 + 0.06 * Math.sin(uu * 31) * Math.sin(uu * 7 + 1);
    for (let y = 0; y < Hh; y++) {
      const v = Math.abs(y / (Hh - 1) - 0.5);
      const i = (y * W + x) * 4;
      const inside = clamp01((half - v) * Hh * 0.7);
      const core = v < 0.09 ? 1 : 0;
      img.data[i] = Math.min(255, col[0] + core * 90); img.data[i + 1] = Math.min(255, col[1] + core * 90); img.data[i + 2] = Math.min(255, col[2] + core * 60);
      img.data[i + 3] = Math.round(255 * along * inside * (0.6 + 0.4 * core));
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  ribbonTexCache.set(key, t);
  return t;
}
function cometFlareTex(F) {
  const key = 'cflare' + F.color;
  if (ribbonTexCache.has(key)) return ribbonTexCache.get(key);
  const S = 256, m = S / 2;
  const c = canvasOf(S, S), g = c.getContext('2d');
  const gr = g.createRadialGradient(m, m, 0, m, m, m * 0.5);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, rgba(F.core, 0.85)); gr.addColorStop(1, rgba(F.color, 0));
  g.fillStyle = gr; g.beginPath(); g.arc(m, m, m * 0.5, 0, 6.283); g.fill();
  // 十字の光芒（横に長く）と斜めの短い光
  for (const [dx, dy, L, w] of [[1, 0, 1, 5], [0, 1, 0.55, 4], [0.7, 0.7, 0.28, 2], [0.7, -0.7, 0.28, 2]]) {
    const g2 = g.createLinearGradient(m - dx * m * L, m - dy * m * L, m + dx * m * L, m + dy * m * L);
    g2.addColorStop(0, rgba(F.color, 0)); g2.addColorStop(0.5, 'rgba(255,255,255,1)'); g2.addColorStop(1, rgba(F.color, 0));
    g.strokeStyle = g2; g.lineWidth = w;
    g.beginPath(); g.moveTo(m - dx * m * L, m - dy * m * L); g.lineTo(m + dx * m * L, m + dy * m * L); g.stroke();
  }
  g.strokeStyle = rgba(F.color, 0.9); g.lineWidth = 3;
  g.beginPath(); g.ellipse(m, m, m * 0.85, m * 0.5, 0, 0, 6.283); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  ribbonTexCache.set(key, t);
  return t;
}

function makeComet3d(F, r) {
  const { ZN, L, CY, RX, RY } = COMET3;
  const group = new THREE.Group();
  const mats = [];
  const deep = F.deep ?? F.glow;
  // 殻：外の膜（普通の合成で色を残す）と、鼻先の入れ子の桃・芯（加算で光らせる）
  const shellMat = (layer, additive) => {
    const m = new THREE.ShaderMaterial({
      uniforms: {
        cCore: { value: new THREE.Color(F.core) }, cColor: { value: new THREE.Color(F.color) }, cGlow: { value: new THREE.Color(F.glow) },
        cDeep: { value: new THREE.Color(deep) }, cDark: { value: new THREE.Color(COMET_DARK) },
        uTime: { value: 0 }, uFade: { value: 0 }, uLayer: { value: layer }, uWob: { value: layer ? 1.6 : 1 },
      },
      vertexShader: COMET_VS, fragmentShader: COMET_FS,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    mats.push(m);
    return m;
  };
  const shells = [
    { m: new THREE.Mesh(cometShellGeo(), shellMat(0, false)), hs: 1, len: 1, s0: 0, op: 1 },
    { m: new THREE.Mesh(cometShellGeo(), shellMat(1, true)), hs: 0.72, len: 0.55, s0: 0.22, op: 0.75 },
    { m: new THREE.Mesh(cometShellGeo(), shellMat(1, true)), hs: 0.45, len: 0.32, s0: 0.42, op: 0.6 },
  ];
  for (const [i, s] of shells.entries()) { s.m.renderOrder = 15 + i; s.m.frustumCulled = false; group.add(s.m); }
  // 尾：カメラへ向く光の帯。付け根は殻の後ろ半分、後ろほど軸へ寄って少し上がる
  const N = 20;
  const tails = [];
  for (let i = 0; i < 12; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N + 1) * 6), 3));
    const uv = new Float32Array((N + 1) * 4), idx = [];
    for (let j = 0; j <= N; j++) { uv.set([j / N, 1, j / N, 0], j * 4); if (j < N) { const a = j * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const additive = i % 3 === 0;
    const mat = new THREE.MeshBasicMaterial({ map: cometTailTex(F), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    mats.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 14;
    group.add(mesh);
    const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 0.75;
    tails.push({ mesh, ox: Math.cos(a) * rr, oy: Math.sin(a) * rr, q0: 0.32 + r() * 0.3, len: 5 + r() * 6, w: 0.16 + r() * 0.3, ph: r() * 6.283, additive });
  }
  // 走る光の筋（馬のまわりを後ろへ飛ぶ。画面の上の走る向きに寝かせる）と四芒星
  const sp = (map, color, add = true, order = 22) => {
    const mat = new THREE.SpriteMaterial({ map, color, transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending });
    mats.push(mat);
    const s = new THREE.Sprite(mat);
    s.renderOrder = order;
    group.add(s);
    return s;
  };
  const lines = Array.from({ length: 26 }, (_, i) => {
    const a = r() * Math.PI * 2, rad = 1.6 + r() * 4.5;
    return { s: sp(tex('streak'), [F.core, F.color, deep][i % 3]), x: Math.cos(a) * rad, y: Math.max(0.2, CY + Math.sin(a) * rad * 0.6), z0: r(), v: 18 + r() * 16, len: 2 + r() * 4 };
  });
  const sparks = Array.from({ length: 30 }, (_, i) => ({ s: sp(tex('star'), i % 3 ? F.color : F.core), a: r() * 6.283, rr: 0.4 + r() * 0.9, q: r(), v: 0.15 + r() * 0.35, sz: 0.2 + r() * 0.35, tw: r() * 6.283 }));
  const flare = sp(cometFlareTex(F), '#ffffff', true, 26);
  // 鼻先の光の玉（2D と同じ。殻の先が光って見える）
  // 普通の合成で桃色に（加算だと明るい芝の前で緑がかった白に飛んだ）
  const nose = sp(tex('soft'), F.color, false, 23);
  const v = new THREE.Vector3(), d = new THREE.Vector3(), side = new THREE.Vector3(), cam = new THREE.Vector3();
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), pR = new THREE.Vector3(), camRight = new THREE.Vector3();
  const camC = new THREE.Vector3();
  return {
    group,
    update(T, life, fade, camera, camF) {
      // 観戦は遠いカメラでも読めるようにエフェクトの組を距離で拡大する（最大 4 倍）が、彗星は馬の体を包む形なので打ち消す。
      // 拡大したままだと、望遠のカメラ（遠くから狭い画角で狙う）で殻が 4 倍に膨らんで画面を覆った
      group.parent?.updateMatrixWorld();
      const wsP = group.parent ? group.parent.matrixWorld.getMaxScaleOnAxis() : 1;
      group.scale.setScalar(1 / wsP);
      const camL = camC.copy(camF).multiplyScalar(wsP);
      const grow = ease(T / 0.32), tail = ease(T / 0.7);
      // カメラが殻の中（騎手視点・ごく近いマーク）に入ったら殻を消す（中から見ると画面じゅうが桃色の膜になる）
      const zq = (ZN - camL.z) / L;
      const inside = zq > -0.1 && zq < 1 ? ((camL.x / RX) ** 2 + ((camL.y - CY) / RY) ** 2) / Math.max(0.05, shellH(clamp01(zq)) ** 2) : 9;
      // 殻のすぐ前のカメラ（ゴール前の正面・マーク）でも、鼻先が画面いっぱいの白い膜になった。殻の中心から 8m より近いと薄める
      const dc = Math.hypot(camL.x, camL.y - CY, camL.z - (ZN - L * 0.35));
      const shellK = smooth(1.2, 2.2, inside) * smooth(4.5, 8, dc);
      for (const s of shells) {
        const Ls = L * s.len * (0.3 + 0.7 * grow);
        s.m.position.set(0, CY, ZN - s.s0);
        s.m.scale.set(RX * s.hs * (0.25 + 0.75 * grow), RY * s.hs * (0.25 + 0.75 * grow), Ls);
        s.m.material.uniforms.uTime.value = T;
        s.m.material.uniforms.uFade.value = fade * s.op * shellK;
      }
      // 尾の帯（後ろへ流れながら揺れる。カメラへ面を向ける）
      cam.copy(camL);
      for (const t of tails) {
        const pos = t.mesh.geometry.attributes.position.array;
        const zs = ZN - t.q0 * L;
        const len = t.len * tail;
        for (let j = 0; j <= N; j++) {
          const q = j / N;
          const k1 = 1 - q * 0.5;
          v.set(t.ox * RX * k1 + 0.08 * Math.sin(q * 5 - T * 3 + t.ph), CY + t.oy * RY * k1 + q * len * 0.09 + 0.08 * Math.sin(q * 4 - T * 2.5 + t.ph), zs - q * len);
          d.set(0, 0.09, -1).normalize();
          side.subVectors(cam, v).cross(d).normalize().multiplyScalar(t.w * (1 - q) ** 0.6 * (0.85 + 0.15 * Math.sin(q * 13 - T * 9 + t.ph)));
          pos.set([v.x + side.x, v.y + side.y, v.z + side.z, v.x - side.x, v.y - side.y, v.z - side.z], j * 6);
        }
        t.mesh.geometry.attributes.position.needsUpdate = true;
        t.mesh.material.opacity = fade * (t.additive ? 0.7 : 0.85);
      }
      // 画面の上の走る向き（筋の布は +x が頭なので、前へ向く角に回す）
      group.updateMatrixWorld();
      const ws0 = group.matrixWorld.getMaxScaleOnAxis();
      p0.set(0, CY, 0).applyMatrix4(group.matrixWorld).project(camera);
      p1.set(0, CY, 1).applyMatrix4(group.matrixWorld).project(camera);
      const rot = Math.atan2(p1.y - p0.y, (p1.x - p0.x) * (camera.aspect || 1));
      // 筋は 1 本ずつ画面の上の向きと長さを求める（正面から見ると消失点から放射状に、奥行きで縮む。全部を同じ角に
      // 寝かせたら、正面のカメラで筋が画面を斜めに横切った）
      camRight.setFromMatrixColumn(camera.matrixWorld, 0);
      for (const ln of lines) {
        const z = 9 - ((ln.z0 * 22 + T * ln.v) % 22);
        ln.s.position.set(ln.x, ln.y, z);
        p0.copy(ln.s.position).applyMatrix4(group.matrixWorld);
        pR.copy(camRight).multiplyScalar(ln.len * ws0).add(p0).project(camera);
        p1.set(ln.x, ln.y, z + ln.len).applyMatrix4(group.matrixWorld).project(camera);
        p0.project(camera);
        const asp = camera.aspect || 1;
        const sx = Math.hypot((p1.x - p0.x) * asp, p1.y - p0.y), sr = Math.hypot((pR.x - p0.x) * asp, pR.y - p0.y) || 1;
        const lenS = ln.len * Math.min(1.2, sx / sr);
        ln.s.scale.set(Math.max(0.05, lenS), ln.len * 0.12, 1);
        ln.s.material.rotation = Math.atan2(p1.y - p0.y, (p1.x - p0.x) * asp);
        const near = clamp01((ln.s.position.distanceTo(camL) - 2.5) / 5);
        ln.s.material.opacity = fade * 0.85 * smooth(9, 6, z) * smooth(-13, -8, z) * near;
      }
      for (const s of sparks) {
        const q = (s.q + T * s.v) % 1.5;
        const rr = s.rr * (q < 1 ? shellH(Math.min(1, q)) : 0.6);
        s.s.position.set(Math.cos(s.a) * rr * RX, CY + Math.sin(s.a) * rr * RY, ZN - q * L);
        const tw = 0.5 + 0.5 * Math.sin(T * 9 + s.tw);
        s.s.scale.setScalar(s.sz * (0.6 + 0.4 * tw));
        s.s.material.opacity = fade * (0.5 + 0.5 * tw) * (1 - smooth(1.1, 1.5, q)) * clamp01((s.s.position.distanceTo(camL) - 2) / 4);
      }
      // 発動の瞬間（0.35 秒）：鼻先の閃光と十字の光芒
      const fq = T / 0.35;
      flare.position.set(0, CY, ZN);
      flare.scale.set((3 + ease(fq) * 6) * 1.6, 3 + ease(fq) * 6, 1);
      flare.material.opacity = fq < 1 ? (1 - fq) * smooth(3, 7, dc) : 0;
      flare.material.rotation = rot;
      nose.position.set(0, CY, ZN - 0.25);
      nose.scale.setScalar(2.6 * (0.4 + 0.6 * grow));
      nose.material.opacity = 0.6 * fade * shellK;
    },
  };
}

const col3 = (hex) => new THREE.Color(hex);

/**
 * 馬の体の表面の点を拾う係。source（馬の組）のメッシュの頂点を (メッシュ, 番号) で覚え、粒が生まれるたびに今の位置へ写す
 * （脚や首は毎コマ動くので、最初に位置で覚えると体から離れたところに湧く）。影・目印など透明や前面に描く部品は除く。
 */
function surfaceOf(source, r, rider = null) {
  if (!source) return null;
  const meshes = [];
  let total = 0;
  source.updateMatrixWorld(true);
  const sc = new THREE.Vector3();
  source.traverse((o) => {
    const m = [o.material].flat()[0];
    if (!o.isMesh || !o.visible || !o.geometry?.attributes?.position || m?.transparent || m?.depthTest === false) return;
    // 重みは部品の大きさ（外接球の半径の 2 乗＝表面積の目安）。頂点の数で選ぶと、細かく作った頭に粒が偏った
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    o.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), sc);
    const rr = o.geometry.boundingSphere.radius * Math.max(sc.x, sc.y, sc.z);
    // 騎手は細かい部品が多く、重みの合計が馬の体を上回って粒が騎手に偏った。オーラは馬の体を主に包む
    let onRider = false;
    for (let p = o; p && p !== source; p = p.parent) if (p === rider) { onRider = true; break; }
    const wgt = rr * rr * (onRider ? 0.2 : 1);
    if (!(wgt > 0)) return;
    meshes.push([o, wgt]);
    total += wgt;
  });
  if (!total) return null;
  const pick = [];
  for (let i = 0; i < 400; i++) {
    let x = r() * total;
    for (const [o, wgt] of meshes) {
      if (x < wgt) { pick.push([o, Math.floor(r() * o.geometry.attributes.position.count)]); break; }
      x -= wgt;
    }
  }
  return pick;
}

/**
 * 観戦の馬の組に付けるエフェクト。update(age, life, camera) を毎コマ呼ぶ（age は実時間の経過秒）。
 * opts.source に馬の組を渡すと、オーラの粒が馬の体の表面から湧く（無ければ体の大きさの楕円体から）。rider は騎手の組（重みを下げる）。
 * 粒は寿命が来たら生まれ直し、最後の 0.6 秒は生まれ直さず消えていく。
 */
export function createFx3d(kind, seed = 1, { source = null, rider = null } = {}) {
  const F = SKILL_FX[kind];
  const K = KIND3[kind];
  const AU = AURA3[kind];
  if (!F || !K || !AU) return null;
  const r = rngOf(seed);
  const group = new THREE.Group();
  const cA = col3(F.color), cG = col3(F.glow), cC = col3(F.core), cD = col3(DARK);
  const surf = surfaceOf(source, r, rider);
  // 疾風はアニメ調の竜巻（光の柱の代わり。観戦の柱は出さない）
  const tornado = kind === 'gale' ? makeTornado3d(F, r) : null;
  if (tornado) group.add(tornado.group);
  // 流星は光の殻と尾の彗星（光の柱も出さない）
  const comet = kind === 'comet' ? makeComet3d(F, r) : null;
  if (comet) group.add(comet.group);
  const tmp = new THREE.Vector3();
  const ctr = new THREE.Vector3();

  // ---- オーラの粒
  const rampCols = AU.ramp.map((k) => (k === 'dark' ? cD : col3(F[k])));
  const rampAt = (k, out) => {
    const t = clamp01(k) * (rampCols.length - 1);
    const j = Math.min(rampCols.length - 2, Math.floor(t));
    return out.copy(rampCols[j]).lerp(rampCols[j + 1], t - j);
  };
  const aura = [];
  for (let i = 0; i < AU.n; i++) {
    const dark = AU.dark ? r() < AU.dark : false;
    // 半分は普通の合成（明るい空の前でも色が残る。加算だけだと白く飛んだ）、半分は加算（重なった所が光る）
    const normal = dark || i % 2 === 0;
    const mat = new THREE.SpriteMaterial({
      map: tex('soft'), color: dark ? cD.clone() : cA.clone(), transparent: true, opacity: 0,
      depthTest: false, depthWrite: false, blending: normal ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    const sp = new THREE.Sprite(mat);
    sp.renderOrder = dark ? 19 : 20;
    group.add(sp);
    aura.push({ sp, dark, normal, t0: -r() * AU.life[1], life: AU.life[1], p: new THREE.Vector3(), v: new THREE.Vector3(), s: 0, born: false });
  }
  const spawnAura = (pt, now) => {
    // 出どころ：体の表面の点（今の位置）。外向きは体の芯（胴の中心の高さの前後の線）から離れる向き
    if (surf) {
      const [m, idx] = surf[Math.floor(r() * surf.length)];
      tmp.fromBufferAttribute(m.geometry.attributes.position, idx);
      m.localToWorld(tmp);
      group.worldToLocal(tmp);
    } else {
      const a = r() * Math.PI * 2, b = Math.acos(2 * r() - 1);
      tmp.set(Math.sin(b) * Math.cos(a) * 0.45, 1.35 + Math.cos(b) * 0.7, Math.sin(b) * Math.sin(a) * 1.1);
    }
    pt.p.copy(tmp);
    const ox = tmp.x - ctr.x, oy = (tmp.y - ctr.y) * 0.6;
    const ol = Math.hypot(ox, oy) || 1;
    const sp = 0.7 + r() * 0.6;
    pt.v.set((ox / ol) * AU.out * sp, (oy / ol) * AU.out * sp + AU.rise * sp, -AU.trail * sp);
    pt.s = AU.size[0] + r() * (AU.size[1] - AU.size[0]);
    pt.wob = r() * 6.283;
    pt.t0 = now;
    pt.life = AU.life[0] + r() * (AU.life[1] - AU.life[0]);
    pt.born = true;
  };

  // ---- 飾りの粒
  const parts = [];
  for (let i = 0; i < K.n; i++) {
    const normal = K.blend === 'normal';
    const mat = new THREE.SpriteMaterial({
      map: tex(K.shape), color: (K.vivid ? (i % 2 ? cA : cG) : i % 3 === 0 ? cC : cA).clone(), transparent: true, opacity: 0,
      depthTest: false, depthWrite: false, blending: normal ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    const sp = new THREE.Sprite(mat);
    sp.renderOrder = 21;
    group.add(sp);
    // 最初の生まれは寿命の中で散らす（一斉に生まれて一斉に消えない）
    parts.push({ sp, t0: -r() * K.life[1] * 0.8, q: null });
  }
  const spawn = (pt, now) => {
    pt.q = K.born(r);
    pt.t0 = now;
    pt.life = K.life[0] + r() * (K.life[1] - K.life[0]);
  };

  // ---- 稲妻：帯を 2 本（光と芯）ずつ、0.06 秒ごとに形を作り直す
  const bolts = [];
  if (kind === 'thunder') {
    for (let i = 0; i < 4; i++) {
      const mk = (c, op) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 2 * 3), 3));
        const idx = [];
        for (let j = 0; j < 11; j++) { const a = j * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        geo.setIndex(idx);
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: op, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
        m.renderOrder = 22;
        m.frustumCulled = false;
        group.add(m);
        return m;
      };
      bolts.push({ glow: mk(cG, 0), core: mk(cC, 0), op: [0.75, 1] });
    }
  }
  let boltFrame = -1;
  const camL = new THREE.Vector3();
  const writeBolt = (b, pts, w) => {
    for (const [m, ww] of [[b.glow, w * 3.2], [b.core, w]]) {
      const pos = m.geometry.attributes.position.array;
      for (let j = 0; j < pts.length; j++) {
        const p = pts[j];
        const nx = pts[Math.min(pts.length - 1, j + 1)], pv = pts[Math.max(0, j - 1)];
        const d = new THREE.Vector3().subVectors(nx, pv).normalize();
        const side = new THREE.Vector3().subVectors(camL, p).cross(d).normalize().multiplyScalar(ww * (1 - j / (pts.length * 1.4)));
        pos.set([p.x + side.x, p.y + side.y, p.z + side.z, p.x - side.x, p.y - side.y, p.z - side.z], j * 6);
      }
      m.geometry.attributes.position.needsUpdate = true;
    }
  };
  // カメラのすぐ近くの粒は消す（馬に寄ったカメラの前で、粒が画面を覆う大きさに写った）
  const nearK = (p, ws) => clamp01((p.distanceTo(camL) * ws - 2.5) / 5);
  return {
    group,
    noPillar: !!(tornado || comet),
    update(age, life, camera) {
      const end = life - 0.6;
      group.updateMatrixWorld();
      camL.copy(camera.position);
      group.worldToLocal(camL);
      const ws = group.matrixWorld.getMaxScaleOnAxis();
      // 体の芯（馬の組の原点の 1.35m 上）を粒の座標で
      if (source) { ctr.set(0, 1.35, 0); source.localToWorld(ctr); group.worldToLocal(ctr); } else ctr.set(0, 1.35, 0);
      const fade = Math.min(1, age / 0.2) * (age > end ? Math.max(0, 1 - (age - end) / 0.6) : 1);
      tornado?.update(age, life, Math.min(1, age / 0.08) * (age > end ? Math.max(0, 1 - (age - end) / 0.6) : 1));
      comet?.update(age, life, Math.min(1, age / 0.08) * (age > end ? Math.max(0, 1 - (age - end) / 0.6) : 1), camera, camL);
      const flick = AU.flicker ? 0.6 + 0.4 * ((h32(Math.floor(age / 0.05) + seed) % 1000) / 1000) : 1;
      const [sx, sy] = AU.stretch ?? [1, 1];
      for (const pt of aura) {
        let a = age - pt.t0;
        if (!pt.born || a > pt.life) {
          // 最初の生まれは 0〜寿命のあいだに散らす（発動の瞬間から湧き上がって育つ）
          if (age < end && age >= Math.max(0, pt.t0 + (pt.born ? 0 : pt.life))) { spawnAura(pt, age); a = 0; } else { pt.sp.material.opacity = 0; continue; }
        }
        const k = a / pt.life;
        const p = pt.sp.position;
        p.copy(pt.p).addScaledVector(pt.v, a);
        p.x += Math.sin(a * 5 + pt.wob) * 0.08 * k;
        const s = Math.max(0.03, pt.s * (1 + AU.grow * k));
        pt.sp.scale.set(s * 2 * sx, s * 2 * sy, 1);
        if (!pt.dark) rampAt(k, pt.sp.material.color);
        pt.sp.material.opacity = lifeEnv(k) * fade * flick * (pt.dark ? 0.6 : pt.normal ? 0.5 : 0.55) * nearK(p, ws);
      }
      for (const pt of parts) {
        let a = age - pt.t0;
        if (pt.q == null || a > pt.life) {
          if (age < end && age >= 0) { spawn(pt, age); a = 0; } else { pt.sp.material.opacity = 0; continue; }
        }
        const q = pt.q, k = a / pt.life;
        let x = q.p[0] + q.v[0] * a, y = q.p[1] + q.v[1] * a, z = q.p[2] + q.v[2] * a;
        if (K.swirl) { const ang = q.a + a * K.swirl; x += Math.cos(ang) * q.rad; z += Math.sin(ang) * q.rad * 1.2; }
        pt.sp.position.set(x, y, z);
        const s = q.s;
        pt.sp.scale.set(kind === 'gale' ? s * 1.6 : s, kind === 'gale' ? s * 0.2 : s, 1);
        if (q.spin) pt.sp.material.rotation = q.spin * a;
        if (kind === 'gale') pt.sp.material.rotation = q.tilt;
        pt.sp.material.opacity = lifeEnv(k) * fade * (K.blend === 'normal' ? 0.9 : 0.95) * nearK(pt.sp.position, ws);
      }
      if (bolts.length) {
        const fi = Math.floor(age / 0.06);
        if (fi !== boltFrame) {
          boltFrame = fi;
          const br = rngOf(seed * 7 + fi * 131);
          for (const [i, b] of bolts.entries()) {
            const on = age < end && br() < (i === 0 ? 0.9 : 0.55);
            for (const [m, op] of [[b.glow, b.op[0]], [b.core, b.op[1]]]) m.material.opacity = on ? op * fade : 0;
            if (!on) continue;
            // 1 本目は空から馬へ、ほかは馬の周りから外へ走る
            const pts = [];
            const from = i === 0 ? new THREE.Vector3((br() - 0.5) * 4, 14, (br() - 0.5) * 4) : new THREE.Vector3((br() - 0.5) * 1.2, 1 + br() * 1.4, (br() - 0.5) * 2);
            const a = br() * Math.PI * 2;
            const to = i === 0 ? new THREE.Vector3(0, 2.2, 0) : new THREE.Vector3(Math.cos(a) * 3.5, from.y + (br() - 0.3) * 2.5, Math.sin(a) * 3.5);
            for (let j = 0; j < 12; j++) {
              const q = j / 11;
              const p = new THREE.Vector3().lerpVectors(from, to, q);
              if (j && j < 11) p.add(new THREE.Vector3((br() - 0.5), (br() - 0.5), (br() - 0.5)).multiplyScalar(i === 0 ? 1.6 : 0.7));
              pts.push(p);
            }
            writeBolt(b, pts, i === 0 ? 0.11 : 0.06);
          }
        } else if (age >= end) for (const b of bolts) { b.glow.material.opacity = 0; b.core.material.opacity = 0; }
      }
    },
    dispose() {
      // スプライトの形は three.js の中で全スプライトが共有しているので捨てない
      group.traverse((o) => { if (o.geometry && !o.isSprite) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    },
  };
}
