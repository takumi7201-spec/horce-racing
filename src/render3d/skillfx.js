// 固有スキルの発動のエフェクト（イナズマ・燃えるオーラ・氷結・桜吹雪・疾風・金色の光・漆黒のオーラ・星屑）。
// 種類と色は sim/ikusei-skills.js の SKILL_FX。見た目だけで、走行ログ（結果）には触らない。
//
// - 2D（fxPainter）：馬と騎手の形（撮影の舞台の mask・切り抜きのステッカー）を受け取り、形の後ろ（オーラ）と前（稲妻・粒）を描く。
//   カードの絵（cardart.js が焼き込む）・カードエディットの生の舞台・観戦のカットインで同じ描き方を使う。
//   形の縁の点と外向きの向きを最初に一度だけ拾い、コマごとに時刻 t で描く（毎コマ形を読み直さない）。
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
const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
};
const ease = (x) => 1 - (1 - Math.max(0, Math.min(1, x))) ** 3;

// ---------------------------------------------------------------- 2D

/**
 * 形からエフェクトを描く係を作る。mask は透明の地に形のある絵（Image・canvas）。w・h は描く大きさ。
 * draw(back, front, t, { still, alpha }) で、back（形の後ろに描く 2D の文脈）と front（形の前）に時刻 t 秒の絵を描く。
 * still はカードの絵（現れて消える動きを付けず、いちばん見栄えのする姿で止める）。
 */
export function fxPainter(kind, mask, w, h, seed = 1, { unit = null } = {}) {
  const F = SKILL_FX[kind];
  if (!F || !mask) return null;
  const sc = canvasOf(w, h);
  const sg = sc.getContext('2d', { willReadFrequently: true });
  sg.drawImage(mask, 0, 0, w, h);
  const data = sg.getImageData(0, 0, w, h).data;
  const A = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : data[(y * w + x) * 4 + 3]);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  const step = Math.max(2, Math.round(Math.min(w, h) / 150));
  const edges = [];
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      if (A(x, y) < 110) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (A(x - step, y) >= 110 && A(x + step, y) >= 110 && A(x, y - step) >= 110 && A(x, y + step) >= 110) continue;
      // 外向きの向きは、少し離れた所の濃さの差（形の外へ向く）
      const d = step * 3;
      let nx = A(x - d, y) - A(x + d, y), ny = A(x, y - d) - A(x, y + d);
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
  // 縁の点を種で選ぶ（コマが変わっても同じ点から出す）。上を向く縁（背・頭・騎手）を多めに
  const r0 = rngOf(seed);
  const pick = (n, up = 0) => {
    const out = [];
    for (let i = 0; i < n * 6 && out.length < n; i++) {
      const e = edges[Math.floor(r0() * edges.length)];
      if (up && e.ny > 0.2 && r0() < up) continue;
      out.push({ ...e, ph: r0() * Math.PI * 2, k: 0.6 + r0() * 0.6, r: r0() });
    }
    return out;
  };
  // 形の光（膨らませてぼかした形）。filter の無い環境はずらして重ねるだけ
  const glow = (() => {
    const c = canvasOf(w, h);
    const g = c.getContext('2d');
    const R = 10 * u;
    if (typeof g.filter === 'string') g.filter = `blur(${(9 * u).toFixed(1)}px)`;
    for (let a = 0; a < 12; a++) {
      const t = (a / 12) * Math.PI * 2;
      g.drawImage(mask, Math.cos(t) * R, Math.sin(t) * R, w, h);
    }
    g.filter = 'none';
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = F.glow;
    g.fillRect(0, 0, w, h);
    return c;
  })();
  const P = {
    flames: pick(70, 0.85), spikes: pick(46), bolts: pick(24, 0.6), motes: Array.from({ length: 60 }, () => ({ a: r0(), b: r0(), c: r0(), d: r0(), e: r0() })),
  };
  const ctx = { F, w, h, box, u, glow, P, edges, seed };
  return {
    box,
    draw(back, front, t, { still = false, alpha = 1 } = {}) {
      const env = still ? 1 : Math.min(ease(t / 0.22), 1 - ease((t - 2.1) / 0.5)) ;
      const k = Math.max(0, env) * alpha;
      if (k <= 0) return;
      for (const g of [back, front]) { g.save(); g.globalAlpha = 1; }
      SOFT = still;
      DRAW[kind](back, front, t, k, ctx, still);
      for (const g of [back, front]) g.restore();
    },
  };
}

/** 形の光を後ろに重ねる（どの種類も下地にする）。 */
function aura(g, c, k, pulse = 1, comp = 'lighter') {
  g.globalCompositeOperation = comp;
  g.globalAlpha = Math.min(1, k * pulse);
  g.drawImage(c.glow, 0, 0);
  g.globalAlpha = 1;
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
// 炎の舌（根元 x,y から向き dx,dy へ長さ L、幅 W）
function tongue(g, x, y, dx, dy, L, W, c0, c1, a) {
  const px = -dy, py = dx;
  const tx = x + dx * L, ty = y + dy * L;
  const gr = g.createLinearGradient(x, y, tx, ty);
  gr.addColorStop(0, rgba(c0, a));
  gr.addColorStop(0.45, rgba(c1, a * 0.85));
  gr.addColorStop(1, rgba(c1, 0));
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(x + px * W, y + py * W);
  g.quadraticCurveTo(x + dx * L * 0.45 + px * W * 1.1, y + dy * L * 0.45 + py * W * 1.1, tx, ty);
  g.quadraticCurveTo(x + dx * L * 0.45 - px * W * 1.1, y + dy * L * 0.45 - py * W * 1.1, x - px * W, y - py * W);
  g.closePath();
  g.fill();
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

const DRAW = {
  // 金色の光：後ろから射す光の筋と金の粒
  radiance(b, f, t, k, c, still) {
    const { F, box, u, P, w, h } = c;
    b.globalCompositeOperation = 'lighter';
    // 横長の絵（カットインの字）では筋が絵の上下の縁で四角く切れるので、短い辺の中で消す
    const R = Math.max(w, h) / Math.min(w, h) > 1.6 ? Math.min(w, h) * 0.5 : Math.max(w, h) * 0.85;
    const rot = still ? 0.2 : t * 0.35;
    for (let i = 0; i < 18; i++) {
      const a = rot + (i / 18) * Math.PI * 2;
      const wd = (i % 2 ? 0.05 : 0.09);
      const gr = b.createRadialGradient(box.cx, box.cy, 0, box.cx, box.cy, R);
      gr.addColorStop(0, rgba(F.core, 0.5 * k)); gr.addColorStop(0.35, rgba(F.color, 0.28 * k)); gr.addColorStop(1, rgba(F.glow, 0));
      b.fillStyle = gr;
      b.beginPath(); b.moveTo(box.cx, box.cy);
      b.lineTo(box.cx + Math.cos(a - wd) * R, box.cy + Math.sin(a - wd) * R);
      b.lineTo(box.cx + Math.cos(a + wd) * R, box.cy + Math.sin(a + wd) * R);
      b.closePath(); b.fill();
    }
    aura(b, c, k, 0.9);
    for (const m of P.motes.slice(0, 34)) {
      const x = box.x0 - 40 * u + m.a * (box.w + 80 * u);
      const y = box.y1 - ((m.b * (box.h + 120 * u) + (still ? 0 : t * (40 + m.c * 60) * u)) % (box.h + 120 * u));
      const tw = still ? 0.6 + m.d * 0.4 : 0.5 + 0.5 * Math.sin(t * 9 + m.e * 9);
      glint(f, x, y, (5 + m.c * 10) * u, F.color, F.core, k * tw);
    }
  },
  // イナズマ：青白い光の縁と、形から外へ走る稲妻・空から落ちる一本
  thunder(b, f, t, k, c, still) {
    const { F, box, u, P, w } = c;
    const fi = still ? 3 : Math.floor(t / 0.07);
    const r = rngOf(c.seed * 31 + fi * 977);
    const flick = still ? 1 : 0.65 + 0.35 * r();
    aura(b, c, k, 1.15 * flick);
    aura(b, c, k * 0.5, flick);
    // 空から落ちる稲妻（形の上の縁の点へ）
    const top = P.bolts.filter((e) => e.ny < -0.3);
    const hit = top[Math.floor(r() * top.length)] ?? P.bolts[0];
    const sx = hit.x + (r() - 0.5) * 140 * u, sy = Math.max(0, box.y0 - 260 * u);
    const L = Math.hypot(hit.x - sx, hit.y - sy);
    strokeBolt(b, zigzag(r, sx, sy, (hit.x - sx) / L, (hit.y - sy) / L, L, 9, 22 * u), F, u, k, 1.3);
    // 縁から外へ走る稲妻（折れて枝分かれする）
    const n = still ? 6 : 4 + Math.floor(r() * 3);
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
    for (let i = 0; i < 10; i++) {
      const e = P.bolts[Math.floor(r() * P.bolts.length)];
      glint(f, e.x + e.nx * r() * 30 * u, e.y + e.ny * r() * 30 * u, (4 + r() * 7) * u, F.glow, F.core, k);
    }
    if (!still && fi % 9 === 0) { f.globalCompositeOperation = 'lighter'; f.fillStyle = rgba(F.core, 0.18 * k); f.fillRect(0, 0, w, c.h); }
  },
  // 燃えるオーラ：縁から立ち上る炎の舌と、舞い上がる火の粉
  flame(b, f, t, k, c, still) {
    const { F, box, u, P } = c;
    aura(b, c, k, 1.2);
    b.globalCompositeOperation = 'lighter';
    for (const e of P.flames) {
      const fl = still ? 0.85 + e.r * 0.3 : 0.7 + 0.45 * Math.sin(t * (8 + e.k * 5) + e.ph) * Math.sin(t * 3.1 + e.ph * 2);
      // 炎は上へ立ち上る（縁の外向きを少し混ぜる）
      let dx = e.nx * 0.45, dy = e.ny * 0.45 - 1;
      const l = Math.hypot(dx, dy); dx /= l; dy /= l;
      const L = (40 + e.k * 60) * u * fl;
      tongue(b, e.x, e.y, dx, dy, L, (9 + e.k * 7) * u, F.core, F.color, 0.8 * k);
      tongue(b, e.x, e.y, dx, dy, L * 1.3, (13 + e.k * 8) * u, F.color, F.glow, 0.32 * k);
    }
    // 前にも小さい炎を少し（脚と胴の下の縁）
    for (const e of P.flames.slice(0, 18)) {
      if (e.ny < 0.2) continue;
      const fl = still ? 0.8 : 0.6 + 0.4 * Math.sin(t * 11 + e.ph);
      tongue(f, e.x, e.y, 0, -1, (22 + e.k * 20) * u * fl, 6 * u, F.core, F.color, 0.55 * k);
    }
    for (const m of P.motes.slice(0, 40)) {
      const H = box.h + 160 * u;
      const y = box.y1 + 20 * u - ((m.b * H + (still ? 0 : t * (90 + m.c * 120) * u)) % H);
      const x = box.x0 + m.a * box.w + Math.sin((still ? 0 : t) * 3 + m.d * 9) * 18 * u;
      const s = (2 + m.c * 4) * u;
      f.globalCompositeOperation = 'lighter';
      f.fillStyle = rgba(F.core, k * (0.6 + m.e * 0.4));
      f.shadowColor = F.glow; f.shadowBlur = SOFT ? 8 * u : 0;
      f.beginPath(); f.arc(x, y, s, 0, Math.PI * 2); f.fill();
    }
    f.shadowBlur = 0;
  },
  // 氷結：縁から外へ伸びる氷の棘と、舞う結晶
  frost(b, f, t, k, c, still) {
    const { F, box, u, P } = c;
    aura(b, c, k, 1.1);
    const grow = still ? 1 : ease(t / 0.5);
    for (const e of P.spikes) {
      const L = (18 + e.k * 46) * u * grow;
      const W = (4 + e.k * 4) * u;
      const px = -e.ny, py = e.nx;
      const tx = e.x + e.nx * L, ty = e.y + e.ny * L;
      const g = e.r < 0.75 ? b : f;
      g.globalCompositeOperation = 'lighter';
      const gr = g.createLinearGradient(e.x, e.y, tx, ty);
      gr.addColorStop(0, rgba(F.glow, 0.55 * k)); gr.addColorStop(0.6, rgba(F.color, 0.75 * k)); gr.addColorStop(1, rgba(F.core, 0.95 * k));
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(e.x + px * W, e.y + py * W); g.lineTo(tx, ty); g.lineTo(e.x - px * W, e.y - py * W); g.closePath(); g.fill();
      g.strokeStyle = rgba(F.core, 0.8 * k); g.lineWidth = 1.2 * u;
      g.beginPath(); g.moveTo(e.x, e.y); g.lineTo(tx, ty); g.stroke();
    }
    for (const m of P.motes.slice(0, 30)) {
      const x = box.x0 - 60 * u + m.a * (box.w + 120 * u);
      const H = box.h + 160 * u;
      const y = box.y0 - 60 * u + ((m.b * H + (still ? 0 : t * (20 + m.c * 30) * u)) % H);
      const R = (5 + m.c * 9) * u;
      f.globalCompositeOperation = 'lighter';
      f.strokeStyle = rgba(F.core, k * (0.55 + m.d * 0.45)); f.lineWidth = 1.4 * u;
      const rot = m.e * 3 + (still ? 0 : t * 1.5);
      f.beginPath();
      for (let i = 0; i < 3; i++) { const a = rot + (i / 3) * Math.PI; f.moveTo(x - Math.cos(a) * R, y - Math.sin(a) * R); f.lineTo(x + Math.cos(a) * R, y + Math.sin(a) * R); }
      f.stroke();
      if (m.d > 0.7) glint(f, x, y, R * 1.4, F.glow, F.core, k * 0.8);
    }
  },
  // 桜吹雪：やわらかな桃色の光と、馬を巻いて舞う花びら（半分は後ろ、半分は前）
  sakura(b, f, t, k, c, still) {
    const { F, box, u, P } = c;
    aura(b, c, k * 0.85, 1);
    const tt = still ? 0.9 : t;
    for (const [i, m] of P.motes.entries()) {
      const ang = m.a * Math.PI * 2 + tt * (0.9 + m.c * 0.8);
      const rx = box.w * (0.55 + m.b * 0.35), ry = box.h * (0.28 + m.d * 0.3);
      const x = box.cx + Math.cos(ang) * rx;
      const y = box.cy + Math.sin(ang) * ry * 0.6 - (m.e - 0.5) * box.h * 0.9 + (still ? 0 : tt * 25 * u);
      const front = Math.sin(ang) > 0;
      petal(front ? f : b, x, y, (7 + m.c * 7) * u, m.e * 6 + tt * (2 + m.b * 3), F, k * (0.75 + m.d * 0.25));
      if (i % 6 === 0) glint(f, x, y, 10 * u, F.color, F.core, k * 0.5);
    }
  },
  // 疾風：馬を巻く風の弧（後ろの半周と前の半周）と、流れる葉
  gale(b, f, t, k, c, still) {
    const { F, box, u, P } = c;
    aura(b, c, k * 0.9, 1);
    const tt = still ? 0.7 : t;
    for (let i = 0; i < 9; i++) {
      const m = P.motes[i];
      const rx = box.w * (0.5 + m.b * 0.25), ry = box.h * (0.18 + m.c * 0.12);
      const cy = box.cy + (m.d - 0.5) * box.h * 0.8;
      const a0 = m.a * Math.PI * 2 + tt * (5 + m.e * 3);
      const sweep = 1.6 + m.c;
      for (const [g, lo] of [[b, Math.PI], [f, 0]]) {
        // 弧を細かく分け、頭（進む先）ほど明るく太く
        const N = 22;
        g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
        for (let j = 0; j < N; j++) {
          const s0 = a0 + (j / N) * sweep, s1 = a0 + ((j + 1) / N) * sweep;
          const mid = ((s0 + s1) / 2) % (Math.PI * 2);
          const inHalf = lo === 0 ? Math.sin(mid) > 0 : Math.sin(mid) <= 0;
          if (!inHalf) continue;
          const q = j / N;
          g.strokeStyle = rgba(q > 0.8 ? F.core : F.color, k * q * 0.9);
          g.lineWidth = (1.5 + q * 4.5) * u;
          g.beginPath();
          g.moveTo(box.cx + Math.cos(s0) * rx, cy + Math.sin(s0) * ry);
          g.lineTo(box.cx + Math.cos(s1) * rx, cy + Math.sin(s1) * ry);
          g.stroke();
        }
      }
    }
    // 後ろへ流れる筋
    for (const m of P.motes.slice(10, 34)) {
      const y = box.y0 + m.b * box.h;
      const span = box.w + 300 * u;
      const x = box.x1 + 100 * u - ((m.a * span + (still ? 0 : t * (500 + m.c * 400) * u)) % span);
      const L = (30 + m.d * 70) * u;
      const g = m.e < 0.5 ? b : f;
      const gr = g.createLinearGradient(x, y, x + L, y);
      gr.addColorStop(0, rgba(F.core, 0.8 * k)); gr.addColorStop(1, rgba(F.color, 0));
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = gr; g.lineWidth = 2 * u;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + L, y); g.stroke();
    }
  },
  // 漆黒のオーラ：暗い紫の炎（地を暗く沈める）と紫の縁、立ち上る黒い靄
  shadow(b, f, t, k, c, still) {
    const { F, box, u, P } = c;
    // 暗さは加算では出せないので、まず普通の合成で地を沈める
    b.globalCompositeOperation = 'source-over';
    b.globalAlpha = 0.75 * k;
    b.drawImage(c.glow, 0, 0);
    b.globalAlpha = 1;
    for (const e of P.flames) {
      const fl = still ? 0.85 + e.r * 0.3 : 0.7 + 0.4 * Math.sin(t * (6 + e.k * 4) + e.ph);
      let dx = e.nx * 0.5, dy = e.ny * 0.5 - 1;
      const l = Math.hypot(dx, dy); dx /= l; dy /= l;
      b.globalCompositeOperation = 'source-over';
      tongue(b, e.x, e.y, dx, dy, (50 + e.k * 70) * u * fl, (12 + e.k * 9) * u, '#1a0630', '#3a0c6e', 0.55 * k);
      b.globalCompositeOperation = 'lighter';
      tongue(b, e.x, e.y, dx, dy, (30 + e.k * 45) * u * fl, (6 + e.k * 5) * u, F.core, F.color, 0.5 * k);
    }
    aura(b, c, k * 0.55, 1);
    for (const m of P.motes.slice(0, 26)) {
      const H = box.h + 140 * u;
      const y = box.y1 - ((m.b * H + (still ? 0 : t * (50 + m.c * 60) * u)) % H);
      const x = box.x0 + m.a * box.w + Math.sin((still ? 0 : t) * 2 + m.d * 9) * 20 * u;
      const R = (10 + m.c * 16) * u;
      const gr = f.createRadialGradient(x, y, 0, x, y, R);
      gr.addColorStop(0, rgba(F.color, 0.55 * k)); gr.addColorStop(1, rgba(F.glow, 0));
      f.globalCompositeOperation = 'lighter';
      f.fillStyle = gr;
      f.beginPath(); f.arc(x, y, R, 0, Math.PI * 2); f.fill();
    }
  },
  // 星屑：青紫の光と、馬を巡る星の帯
  star(b, f, t, k, c, still) {
    const { F, box, u, P } = c;
    aura(b, c, k, 1.05);
    const tt = still ? 1.1 : t;
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
};

// ---------------------------------------------------------------- 3D

const texCache = new Map();
function tex(shape) {
  if (texCache.has(shape)) return texCache.get(shape);
  const S = 64;
  const c = canvasOf(S, S);
  const g = c.getContext('2d');
  const m = S / 2;
  if (shape === 'soft') {
    const gr = g.createRadialGradient(m, m, 0, m, m, m);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  } else if (shape === 'flame') {
    tongue(g, m, S * 0.9, 0, -1, S * 0.85, S * 0.2, '#ffffff', '#ffffff', 1);
    const gr = g.createRadialGradient(m, S * 0.72, 0, m, S * 0.72, m * 0.6);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
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

// 種類ごとの粒：shape（布）・数・色・合成、born（生まれる所と速さ）、寿命
const KIND3 = {
  radiance: { shape: 'star', n: 40, blend: 'add', life: [0.7, 1.4], born: (r) => ({ p: [(r() - 0.5) * 3, 0.2 + r() * 2.6, (r() - 0.5) * 3], v: [0, 1.2 + r() * 1.6, 0], s: 0.35 + r() * 0.45 }) },
  flame: { shape: 'flame', n: 64, blend: 'split', life: [0.35, 0.75], colorRamp: true, op: 0.6, born: (r) => { const a = r() * Math.PI * 2; return { p: [Math.cos(a) * 0.75, 0.3 + r() * 1.7, Math.sin(a) * 1.25], v: [Math.cos(a) * 0.4, 2.4 + r() * 2.2, Math.sin(a) * 0.4], s: 0.6 + r() * 0.6, grow: -0.6 }; } },
  frost: { shape: 'shard', n: 40, blend: 'add', life: [0.8, 1.5], born: (r) => { const a = r() * Math.PI * 2; return { p: [Math.cos(a) * 0.6, 0.4 + r() * 1.8, Math.sin(a) * 0.9], v: [Math.cos(a) * 2.2, (r() - 0.3) * 1.2, Math.sin(a) * 2.2], s: 0.3 + r() * 0.5, spin: (r() - 0.5) * 4 }; } },
  sakura: { shape: 'petal', n: 64, blend: 'normal', life: [1.2, 2.2], swirl: 2.4, vivid: true, born: (r) => ({ a: r() * Math.PI * 2, rad: 1.2 + r() * 1.6, p: [0, 0.2 + r() * 1.6, 0], v: [0, 0.6 + r() * 0.9, 0], s: 0.26 + r() * 0.2, spin: (r() - 0.5) * 6 }) },
  // 疾風の筋は画面の横（走る向き）に寝かせる。スプライトは画面の中で回るので、世界の向きで回すと筋が交差して見えた
  gale: { shape: 'streak', n: 40, blend: 'add', life: [0.35, 0.7], swirl: 6, born: (r) => ({ a: r() * Math.PI * 2, rad: 1.2 + r() * 0.8, p: [0, 0.2 + r() * 2.2, 0], v: [0, 0.3 + r() * 0.5, 0], s: 0.7 + r() * 0.6, tilt: (r() - 0.5) * 0.3 }) },
  shadow: { shape: 'soft', n: 56, blend: 'mix', life: [0.5, 1.0], born: (r) => { const a = r() * Math.PI * 2; return { p: [Math.cos(a) * 0.7, 0.2 + r() * 1.8, Math.sin(a) * 1.2], v: [Math.cos(a) * 0.3, 1.8 + r() * 1.6, Math.sin(a) * 0.3], s: 0.35 + r() * 0.45, grow: 0.6 }; } },
  star: { shape: 'star5', n: 44, blend: 'add', life: [0.9, 1.6], swirl: 3.2, born: (r) => ({ a: r() * Math.PI * 2, rad: 1.4 + r() * 1.0, p: [0, 0.4 + r() * 2.4, 0], v: [0, 0.5 + r() * 0.8, 0], s: 0.2 + r() * 0.3, spin: (r() - 0.5) * 3 }) },
  thunder: { shape: 'star', n: 24, blend: 'add', life: [0.15, 0.35], born: (r) => { const a = r() * Math.PI * 2; return { p: [Math.cos(a) * 0.9, 0.5 + r() * 1.8, Math.sin(a) * 1.3], v: [Math.cos(a) * 3, (r() - 0.5) * 2, Math.sin(a) * 3], s: 0.4 + r() * 0.5 }; } },
};

const col3 = (hex) => new THREE.Color(hex);

/**
 * 観戦の馬の組に付けるエフェクト。update(age, life, camera) を毎コマ呼ぶ（age は実時間の経過秒）。
 * 粒は寿命が来たら生まれ直し、最後の 0.6 秒は生まれ直さず消えていく。
 */
export function createFx3d(kind, seed = 1) {
  const F = SKILL_FX[kind];
  const K = KIND3[kind];
  if (!F || !K) return null;
  const r = rngOf(seed);
  const group = new THREE.Group();
  const cA = col3(F.color), cG = col3(F.glow), cC = col3(F.core);
  const parts = [];
  for (let i = 0; i < K.n; i++) {
    const dark = K.blend === 'mix' && i % 2 === 0;
    // split：半分は普通の合成（明るい空の前でも炎の色が残る。加算だけだと白く飛んだ）
    const normal = K.blend === 'normal' || (K.blend === 'split' && i % 2 === 0) || dark;
    const mat = new THREE.SpriteMaterial({
      map: tex(K.shape), color: dark ? new THREE.Color('#14041f') : (K.vivid ? (i % 2 ? cA : cG) : i % 3 === 0 ? cC : cA).clone(), transparent: true, opacity: 0,
      depthTest: false, depthWrite: false, blending: normal ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    const sp = new THREE.Sprite(mat);
    sp.renderOrder = dark ? 20 : 21;
    group.add(sp);
    // 最初の生まれは寿命の中で散らす（一斉に生まれて一斉に消えない）
    parts.push({ sp, dark, normal, t0: -r() * K.life[1] * 0.8, q: null });
  }
  const spawn = (pt, now) => {
    pt.q = K.born(r);
    pt.t0 = now;
    pt.life = K.life[0] + r() * (K.life[1] - K.life[0]);
  };
  // 稲妻：帯を 2 本（光と芯）ずつ、0.06 秒ごとに形を作り直す
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
  return {
    group,
    update(age, life, camera) {
      const end = life - 0.6;
      group.updateMatrixWorld();
      camL.copy(camera.position);
      group.worldToLocal(camL);
      const ws = group.matrixWorld.getMaxScaleOnAxis();
      const fade = Math.min(1, age / 0.2) * (age > end ? Math.max(0, 1 - (age - end) / 0.6) : 1);
      for (const pt of parts) {
        let a = age - pt.t0;
        if (pt.q == null || a > pt.life) {
          if (age < end && age >= 0) { spawn(pt, age); a = 0; } else { pt.sp.material.opacity = 0; continue; }
        }
        const q = pt.q, k = a / pt.life;
        let x = q.p[0] + q.v[0] * a, y = q.p[1] + q.v[1] * a, z = q.p[2] + q.v[2] * a;
        if (K.swirl) { const ang = q.a + a * K.swirl; x += Math.cos(ang) * q.rad; z += Math.sin(ang) * q.rad * 1.2; }
        pt.sp.position.set(x, y, z);
        const s = q.s * (1 + (q.grow ?? 0) * k) * (kind === 'gale' ? 1 : 1);
        pt.sp.scale.set(kind === 'gale' ? s * 1.6 : s, kind === 'flame' ? s * 1.5 : kind === 'gale' ? s * 0.2 : s, 1);
        if (q.spin) pt.sp.material.rotation = q.spin * a;
        if (kind === 'gale') pt.sp.material.rotation = q.tilt;
        const env = Math.min(1, k / 0.15) * (1 - k);
        // カメラのすぐ近くの粒は消す（馬に寄ったカメラの前で、粒が画面を覆う大きさに写った）
        const near = pt.sp.position.distanceTo(camL) * ws;
        pt.sp.material.opacity = Math.max(0, env * fade * (pt.dark ? 0.7 : pt.normal && K.blend === 'split' ? 0.9 : K.op ?? 0.95) * Math.min(1, Math.max(0, (near - 2.5) / 5)));
        // 炎は芯の色から光の色へ（上へ行くほど赤く）
        if (K.colorRamp && !pt.dark) {
          if (pt.normal) pt.sp.material.color.copy(cA).lerp(cG, Math.min(1, k * 1.4));
          else pt.sp.material.color.copy(cC).lerp(cA, Math.min(1, k * 2)).lerp(cG, Math.max(0, k * 2 - 1));
        }
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
