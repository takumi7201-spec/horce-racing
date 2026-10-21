// PWA のアイコンを作る。外部ライブラリを使わず、PNG を自力で書き出す。
//   node tools/make-icons.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** RGBA の配列から PNG を組む。 */
function writePng(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // フィルタなし
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const chunks = [];
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  chunks.push(sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)));
  fs.writeFileSync(file, Buffer.concat(chunks));
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/**
 * アイコンの絵。
 * 緑の芝に白いラチと、ゴール板を思わせる縦線。
 * 文字や絵文字は描かない（環境によって豆腐になる）。
 */
function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const cx = size / 2, cy = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 角丸の外は透明。
      const r = size * 0.18;
      const dx = Math.max(r - x, 0, x - (size - 1 - r));
      const dy = Math.max(r - y, 0, y - (size - 1 - r));
      if (Math.hypot(dx, dy) > r) { set(x, y, 0, 0, 0, 0); continue; }
      // 背景は上が暗く下が明るい。
      const t = y / size;
      set(x, y, 14 + t * 10, 20 + t * 26, 18 + t * 14);
      // 走路（楕円のリング）。
      const ex = (x - cx) / (size * 0.38);
      const ey = (y - cy) / (size * 0.27);
      const d = Math.hypot(ex, ey);
      if (d < 1.0 && d > 0.58) {
        const stripe = Math.floor((Math.atan2(ey, ex) + Math.PI) / (Math.PI / 9)) % 2;
        set(x, y, stripe ? 52 : 62, stripe ? 124 : 140, stripe ? 60 : 70);
      }
      // 内外のラチ。
      if (Math.abs(d - 1.0) < 0.022 || Math.abs(d - 0.58) < 0.022) set(x, y, 232, 238, 234);
      // ゴール板（下側の縦線）。
      if (d < 1.02 && d > 0.56 && Math.abs(x - cx) < size * 0.012 && y > cy) set(x, y, 245, 230, 170);
    }
  }
  return px;
}

fs.mkdirSync(path.join(ROOT, 'icons'), { recursive: true });
for (const size of [192, 512]) {
  const file = path.join(ROOT, 'icons', `icon-${size}.png`);
  writePng(file, size, size, draw(size));
  console.log('書き出した', path.relative(ROOT, file));
}
