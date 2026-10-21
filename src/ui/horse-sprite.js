// 馬のドット絵スプライト。
//
// 元絵は鹿毛が 1 枚だけ（assets/horse.png）。
// ほかの毛色はこれを読み込んでパレットを差し替えて作る。画像を 8 枚持たないのは、
// 毛色が増えたときに絵を描き足さなくて済むようにするため。
//
// 差し替えの考えかた
//   - 輪郭線（ほぼ黒）と白斑（流星・靴下・目）はそのまま残す。
//     ここまで塗り替えると、どの毛色でも同じのっぺりした絵になる
//   - 残りを「毛」と「差し毛（たてがみ・尾・管）」に彩度で分ける。
//     元絵の尾とたてがみは灰色寄り（S<0.15）なので、これで素直に切れる
//   - それぞれ、元の明度の順位を保ったまま毛色ごとの明度の帯へ写す。
//     陰影の構造を壊さずに色だけ変わる

import { el } from './dom.js';

const SRC = new URL('../../assets/horse.png', import.meta.url).href;

/**
 * 毛色ごとの塗り。
 * coat   … 体。h は色相、sMul は元の彩度に掛ける係数、sMax はその上限、
 *          lo/hi は明度の帯
 * points … たてがみ・尾・管。鹿毛系は黒、栗毛は亜麻色、芦毛は灰色
 *
 * sMax が要る理由：元絵のハイライトは彩度 1.0 の肌色（#ffbf9e）で、
 * 鹿毛の中では自然に馴染んでいる。これを暗い毛色の帯へそのまま写すと、
 * 胴体に蛍光オレンジの染みが乗ったように見える。
 *
 * 鹿毛は元絵そのものなので塗り替えない（identity）。
 */
const PALETTE = {
  鹿毛:   { identity: true },
  黒鹿毛: { coat: { h: 18, sMul: 0.72, sMax: 0.42, lo: 0.06, hi: 0.46 }, points: { h: 18, sMul: 0.5, sMax: 0.26, lo: 0.03, hi: 0.20 } },
  青鹿毛: { coat: { h: 16, sMul: 0.50, sMax: 0.30, lo: 0.04, hi: 0.34 }, points: { h: 16, sMul: 0.4, sMax: 0.20, lo: 0.02, hi: 0.16 } },
  青毛:   { coat: { h: 20, sMul: 0.18, sMax: 0.12, lo: 0.03, hi: 0.26 }, points: { h: 20, sMul: 0.15, sMax: 0.10, lo: 0.02, hi: 0.14 } },
  栗毛:   { coat: { h: 30, sMul: 1.00, sMax: 0.72, lo: 0.26, hi: 0.80 }, points: { h: 38, sMul: 0.5, sMax: 0.34, lo: 0.52, hi: 0.90 } },
  栃栗毛: { coat: { h: 20, sMul: 0.95, sMax: 0.58, lo: 0.14, hi: 0.56 }, points: { h: 26, sMul: 0.5, sMax: 0.30, lo: 0.16, hi: 0.44 } },
  芦毛:   { coat: { h: 28, sMul: 0.14, sMax: 0.12, lo: 0.20, hi: 0.70 }, points: { h: 28, sMul: 0.12, sMax: 0.10, lo: 0.14, hi: 0.56 } },
  白毛:   { coat: { h: 28, sMul: 0.06, sMax: 0.06, lo: 0.68, hi: 0.98 }, points: { h: 28, sMul: 0.08, sMax: 0.08, lo: 0.60, hi: 0.94 } },
};

// --- 色空間 ---
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (d < 1e-6) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (mx === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  if (s <= 1e-6) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = ((t % 360) + 360) % 360 / 360;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 120) * 255), Math.round(f(h) * 255), Math.round(f(h - 120) * 255)];
}

// --- 元絵の読み込み ---
let base = null;          // { w, h, px: Uint8ClampedArray, coatRange, pointRange }
let loading = null;
const cache = new Map();  // key -> dataURL
const pending = [];       // 読み込み前に作られた <img>

const isOutline = (l) => l < 0.10;
const isMark = (s, l) => s < 0.14 && l > 0.80;   // 流星・靴下・目の白
const isPoints = (s, l) => s < 0.16 && !isMark(s, l); // たてがみ・尾（灰色寄り）

export function loadHorseSprite() {
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height);
      // 毛と差し毛それぞれの明度の幅を測っておく。
      // 元絵の陰影の順位を保ったまま、毛色ごとの帯へ写すために要る。
      let cLo = 1, cHi = 0, pLo = 1, pHi = 0;
      for (let i = 0; i < d.data.length; i += 4) {
        if (d.data[i + 3] < 8) continue;
        const [, s, l] = rgbToHsl(d.data[i], d.data[i + 1], d.data[i + 2]);
        if (isOutline(l) || isMark(s, l)) continue;
        if (isPoints(s, l)) { pLo = Math.min(pLo, l); pHi = Math.max(pHi, l); }
        else { cLo = Math.min(cLo, l); cHi = Math.max(cHi, l); }
      }
      base = {
        w: c.width, h: c.height, px: d.data,
        coatRange: [cLo, Math.max(cHi, cLo + 0.01)],
        pointRange: [pLo, Math.max(pHi, pLo + 0.01)],
      };
      // 読み込み前に置かれた <img> を埋める。
      for (const { node, key } of pending.splice(0)) node.src = render(key);
      resolve(base);
    };
    img.onerror = () => { base = null; resolve(null); };
    img.src = SRC;
  });
  return loading;
}

/**
 * 芦毛は年を取るほど白くなる（生まれたときは鹿毛に近い栗色で、
 * 歳を重ねるごとに白く抜けていく）。段階をキャッシュの鍵に混ぜる。
 * ほかの毛色では常に 0。
 */
function greyStage(coat, age) {
  if (coat !== '芦毛' || age == null) return 0;
  return Math.max(0, Math.min(4, Math.floor((age - 1) / 2)));
}

function render(key) {
  if (cache.has(key)) return cache.get(key);
  const [coat, stageStr] = key.split('|');
  const stage = Number(stageStr) || 0;
  const pal = PALETTE[coat] ?? PALETTE['鹿毛'];
  const c = document.createElement('canvas');
  c.width = base.w; c.height = base.h;
  const g = c.getContext('2d');
  const out = g.createImageData(base.w, base.h);
  const [cLo, cHi] = base.coatRange;
  const [pLo, pHi] = base.pointRange;
  // 芦毛だけ、段階に応じて明度の帯を白へ寄せる。
  const shift = stage * 0.08;

  for (let i = 0; i < base.px.length; i += 4) {
    const a = base.px[i + 3];
    out.data[i + 3] = a;
    if (a < 8) continue;
    const r = base.px[i], gg = base.px[i + 1], b = base.px[i + 2];
    const [, s, l] = rgbToHsl(r, gg, b);
    if (isOutline(l) || isMark(s, l)) {
      out.data[i] = r; out.data[i + 1] = gg; out.data[i + 2] = b;
      continue;
    }
    if (pal.identity) {
      out.data[i] = r; out.data[i + 1] = gg; out.data[i + 2] = b;
      continue;
    }
    const pts = isPoints(s, l);
    const spec = pts ? pal.points : pal.coat;
    const [lo, hi] = pts ? [pLo, pHi] : [cLo, cHi];
    const t = (l - lo) / (hi - lo);
    const nl = Math.max(0, Math.min(1, spec.lo + (spec.hi - spec.lo) * t + shift));
    const ns = Math.max(0, Math.min(spec.sMax, s * spec.sMul));
    const [nr, ng, nb] = hslToRgb(spec.h, ns, nl);
    out.data[i] = nr; out.data[i + 1] = ng; out.data[i + 2] = nb;
  }
  g.putImageData(out, 0, 0);
  const url = c.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

/**
 * 毛色に合わせたスプライトの <img> を返す。
 * 読み込み前に呼ばれても、読み終わったときに差し込まれる。
 * @param {string} coat 毛色
 * @param {{size?:'xs'|'sm'|'md'|'lg', age?:number, flip?:boolean, title?:string}} opts
 */
export function horseImg(coat, { size = 'sm', age = null, flip = false, title = '' } = {}) {
  const key = `${coat}|${greyStage(coat, age)}`;
  const node = el(`img.hsprite.hs-${size}`, {
    alt: coat, title: title || coat, decoding: 'async',
    class: flip ? 'flip' : null,
  });
  if (base) node.src = render(key);
  else {
    pending.push({ node, key });
    loadHorseSprite();
  }
  return node;
}

export { PALETTE as COAT_PALETTE };
