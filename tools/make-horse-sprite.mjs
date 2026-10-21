// 馬のドット絵から、背景を抜いたスプライトを作る。
//   node tools/make-horse-sprite.mjs <元画像.png> [--keep x,y]... [--debug]
//   npm run sprite          （この絵に必要な --keep を入れたもの）
//
// 元絵は 1 ドット 10px のドット絵で、空・雲・草・柵が一緒に描かれている。
//   1. ドットの升目に落とす（10px の中央を拾う）
//   2. 色相で背景（草・空・雲）を落とす
//   3. 残った「塗り」の連結成分のうち最大を胴体とし、輪郭線を 1 ドット分足す
//   4. 余白を詰めて書き出す
//
// 3 で --keep が要る理由：
// ドット絵は黒い輪郭線で描き分けられているので、**尾・向こう側の脚・耳先は
// 胴体と塗りが繋がっていない**（あいだに輪郭線が入る）。一方で柵は馬と
// まったく同じ茶色（#a95a34）で、位置も首の後ろに重なっている。
// つまり「色」でも「位置」でも「輪郭を何ドット渡るか」でも区別できない。
// 自動で分けようとして何度も失敗したので、残す部品を種点で明示している。
// 種点はこのドット絵に固有の値。別の絵に差し替えるときは、
// --debug を付けて成分の一覧を見ながら取り直すこと。
//
// 出力は assets/horse.png（鹿毛）。ほかの毛色は実行時にパレットを
// 差し替えて作る（src/ui/horse-sprite.js）。ここでその材料として、
// 毛色として塗り替えるべき色の一覧も表示する。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const SRC = args.find((a) => !a.startsWith('--'));
const DEBUG = args.includes('--debug');
const KEEP = args.reduce((acc, a, i) => {
  if (a !== '--keep') return acc;
  const [x, y] = (args[i + 1] ?? '').split(',').map(Number);
  if (Number.isFinite(x) && Number.isFinite(y)) acc.push([x, y]);
  return acc;
}, []);
if (!SRC) {
  console.error('使い方: node tools/make-horse-sprite.mjs <元画像.png> [--keep x,y]... [--debug]');
  process.exit(1);
}

const img = decodePng(fs.readFileSync(SRC));
const at = (x, y) => {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};

// --- 1. ドットの升目を推定して落とす ---
const dot = detectDotSize(img);
const W = Math.round(img.width / dot);
const H = Math.round(img.height / dot);
const px = new Int32Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const sx = Math.min(img.width - 1, Math.floor((x + 0.5) * dot));
    const sy = Math.min(img.height - 1, Math.floor((y + 0.5) * dot));
    const [r, g, b] = at(sx, sy);
    px[y * W + x] = (r << 16) | (g << 8) | b;
  }
}
console.log(`元画像 ${img.width}x${img.height} / 1 ドット ${dot}px → ${W}x${H}`);

/** 横一列・縦一列で色が変わる位置の最大公約数をドットの大きさとみなす。 */
function detectDotSize(im) {
  const key = (x, y) => {
    const i = (y * im.width + x) * 4;
    return (im.data[i] << 16) | (im.data[i + 1] << 8) | im.data[i + 2];
  };
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  let g = 0;
  for (const y of [Math.floor(im.height * 0.3), Math.floor(im.height * 0.6)]) {
    let prev = key(0, y);
    for (let x = 1; x < im.width; x++) {
      const c = key(x, y);
      if (c !== prev) { g = gcd(g, x); prev = c; }
    }
  }
  for (const x of [Math.floor(im.width * 0.3), Math.floor(im.width * 0.6)]) {
    let prev = key(x, 0);
    for (let y = 1; y < im.height; y++) {
      const c = key(x, y);
      if (c !== prev) { g = gcd(g, y); prev = c; }
    }
  }
  return Math.max(1, g);
}

// --- 2. 背景の色を見分ける ---
function hsl(c) {
  const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (d < 1e-6) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (mx === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

/**
 * 背景か。草（緑）・空（水色）・雲（青みがかった白）を落とす。
 * 馬は茶〜橙・黒・純白なので、色相で分けられる。
 * 柵も茶色なのでここでは残り、連結成分の段階で落ちる。
 */
function isBackground(c) {
  const { h, s, l } = hsl(c);
  if (s > 0.12 && h >= 70 && h <= 175) return true;   // 草
  if (s > 0.10 && h >= 175 && h <= 260) return true;  // 空
  if (l > 0.88 && s > 0.05 && h >= 160 && h <= 260) return true; // 雲（青みのある白）
  return false;
}

// --- 3. 馬だけを取り出す ---
//
// 柵も雲も、馬とは「黒い輪郭線どうしが接している」だけで繋がっている。
// そこで、塗り（輪郭線でも背景でもない画素）だけで連結成分を取って
// いちばん大きい塊を馬の胴体とし、そこから輪郭線を 1 ドットまで渡って広げる。
// 輪郭線が 2 ドット続いたら「別の絵との境目」なので越えない。
// これで柵・雲・脚のあいだに覗く草がまとめて落ちる。
const isOutline = (c) => hsl(c).l < 0.08;
const solid = new Uint8Array(W * H);
const fill = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  solid[i] = isBackground(px[i]) ? 0 : 1;
  fill[i] = solid[i] && !isOutline(px[i]) ? 1 : 0;
}

const label = new Int32Array(W * H).fill(-1);
const sizes = [];
for (let i = 0; i < W * H; i++) {
  if (!fill[i] || label[i] >= 0) continue;
  const id = sizes.length;
  let n = 0;
  const q = [i];
  label[i] = id;
  while (q.length) {
    const j = q.pop();
    n++;
    const x = j % W, y = (j / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const k = ny * W + nx;
      if (!fill[k] || label[k] >= 0) continue;
      label[k] = id;
      q.push(k);
    }
  }
  sizes.push(n);
}
// 成分の一覧。別の絵に差し替えるときはこれを見て --keep を決める。
const info = sizes.map((n, id) => {
  let minX = W, maxX = -1, minY = H, maxY = -1, sr = 0, sg = 0, sb = 0;
  for (let i = 0; i < W * H; i++) {
    if (label[i] !== id) continue;
    const x = i % W, y = (i / W) | 0;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    sr += (px[i] >> 16) & 255; sg += (px[i] >> 8) & 255; sb += px[i] & 255;
  }
  const col = `#${(((sr / n) | 0) << 16 | ((sg / n) | 0) << 8 | ((sb / n) | 0)).toString(16).padStart(6, '0')}`;
  return { id, n, minX, maxX, minY, maxY, col };
});

const bodyId = sizes.indexOf(Math.max(...sizes));
const keepIds = new Set([bodyId]);
for (const [x, y] of KEEP) {
  if (x < 0 || y < 0 || x >= W || y >= H) { console.warn(`--keep ${x},${y} は画像の外`); continue; }
  const id = label[y * W + x];
  if (id < 0) { console.warn(`--keep ${x},${y} は塗りではない（背景か輪郭線）`); continue; }
  keepIds.add(id);
}

if (DEBUG) {
  console.log('\n--- 塗りの連結成分（--keep を決めるための一覧）---');
  for (const c of info.slice().sort((a, b) => b.n - a.n)) {
    const mark = keepIds.has(c.id) ? '残す' : '捨てる';
    console.log(`  ${String(c.n).padStart(4)}px  x${String(c.minX).padStart(2)}..${String(c.maxX).padStart(2)}`
      + `  y${String(c.minY).padStart(2)}..${String(c.maxY).padStart(2)}  ${c.col}  ${mark}`);
  }
  console.log('');
}

// 残す塗りから、隣接する輪郭線を 1 ドットだけ足す（8 近傍）。
// ここを 2 ドットにすると、接している柵の輪郭まで拾ってしまう。
const horse = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) if (keepIds.has(label[i])) horse[i] = 1;
{
  const ring = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (horse[i] || !solid[i] || !isOutline(px[i])) continue;
      for (let dy = -1; dy <= 1 && !horse[i]; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (keepIds.has(label[ny * W + nx])) { ring.push(i); dy = 2; break; }
        }
      }
    }
  }
  for (const i of ring) horse[i] = 1;
}
const kept = horse.reduce((a, b) => a + b, 0);
console.log(`塗りの塊 ${sizes.length} 個 → ${keepIds.size} 個を採用`
  + `（胴体 ${sizes[bodyId]} ドット）、輪郭を足して ${kept} ドット`);

// --- 4. 余白を詰めて書き出す ---
let minX = W, maxX = -1, minY = H, maxY = -1;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (!horse[y * W + x]) continue;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
}
const ow = maxX - minX + 1, oh = maxY - minY + 1;
const out = Buffer.alloc(ow * oh * 4);
const used = new Map();
for (let y = 0; y < oh; y++) {
  for (let x = 0; x < ow; x++) {
    const src = (y + minY) * W + (x + minX);
    const d = (y * ow + x) * 4;
    if (!horse[src]) continue;
    const c = px[src];
    out[d] = (c >> 16) & 255;
    out[d + 1] = (c >> 8) & 255;
    out[d + 2] = c & 255;
    out[d + 3] = 255;
    used.set(c, (used.get(c) ?? 0) + 1);
  }
}
fs.mkdirSync(path.join(ROOT, 'assets'), { recursive: true });
const dest = path.join(ROOT, 'assets', 'horse.png');
fs.writeFileSync(dest, encodePng(ow, oh, out));
console.log(`書き出した ${path.relative(ROOT, dest)}  ${ow}x${oh}  ${used.size} 色`);

// 毛色の塗り替えに使う色の一覧。明度順。
console.log('\n--- スプライトの色（明度順）---');
const list = [...used.entries()]
  .map(([c, n]) => ({ c, n, ...hsl(c) }))
  .sort((a, b) => a.l - b.l);
for (const x of list) {
  const role = x.l < 0.08 ? '輪郭' : (x.s < 0.12 && x.l > 0.8) ? '白斑' : '毛';
  console.log(`  #${x.c.toString(16).padStart(6, '0')}  ${String(x.n).padStart(4)}px  `
    + `H${x.h.toFixed(0).padStart(3)} S${x.s.toFixed(2)} L${x.l.toFixed(2)}  ${role}`);
}

// --- デバッグ用：何を残したかを色分けして書き出す ---
if (DEBUG) {
  const dbg = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const d = i * 4;
    dbg[d + 3] = 255;
    if (horse[i]) {                                                         // 残した馬
      const c = px[i];
      dbg[d] = (c >> 16) & 255; dbg[d + 1] = (c >> 8) & 255; dbg[d + 2] = c & 255;
    } else if (!solid[i]) { dbg[d] = 30; dbg[d + 1] = 30; dbg[d + 2] = 40; } // 背景
    else { dbg[d] = 255; dbg[d + 1] = 0; dbg[d + 2] = 255; }                 // 捨てた塊
  }
  const dp = path.join(ROOT, 'assets', 'horse-debug.png');
  fs.writeFileSync(dp, encodePng(W, H, dbg));
  console.log(`\nデバッグ出力 ${path.relative(ROOT, dp)}（紫＝捨てた塊）`);
}
