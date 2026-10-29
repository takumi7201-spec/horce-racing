// カードの一枚絵。撮影の舞台（photostage.js）で背景と馬を撮り、箔押しの輪郭（馬と騎手の縁）も作る。
//
// 描画器は 1 つだけ作って使い回す（画面ごと・カードごとに WebGL を作ると、ブラウザが古いコンテキストから捨てて
// レース観戦の 3D が真っ黒になる。落とし穴 23）。撮るのは 1 枚ずつ順番に（待ち行列）。
// 撮った絵はカードの id で覚えておく（一覧を開き直すたびに撮らない）。

import * as THREE from '../../vendor/three/three.module.min.js';
import { shootFinish } from './photostage.js';

let renderer = null;
const cache = new Map();
let chain = Promise.resolve();

const W = 606, H = 626;

/** 馬と騎手の形（mask）を膨らませた縁だけの絵（箔押しの輪郭）。 */
function ringOf(maskUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d');
      // 少しずつずらして重ねると膨らんだ形になる。そこから元の形を抜くと縁が残る。
      const R = 3;
      for (let a = 0; a < 16; a++) {
        const t = (a / 16) * Math.PI * 2;
        g.drawImage(img, Math.cos(t) * R, Math.sin(t) * R, W, H);
      }
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(img, 0, 0, W, H);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = maskUrl;
  });
}

/**
 * カードの絵を撮る。card は sim/data/cards.js の 1 枚。
 * @returns {Promise<{bg:string, fg:string, ring:string|null, sun:{x:number,y:number,visible:boolean}}>}
 */
export function cardArt(card) {
  if (cache.has(card.id)) return cache.get(card.id);
  const p = chain.then(async () => {
    renderer ??= new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: true, alpha: true, preserveDrawingBuffer: false });
    renderer.setPixelRatio(1);
    const shot = card.shot ?? 'profile';
    const v = shootFinish(renderer, {
      width: W, height: H,
      hero: { id: card.hid ?? 1, coat: card.coat, gate: 1, frame: 1, marks: card.marks },
      surface: card.surface ?? '芝', shot, phase: shot === 'charge' ? 0.3 : 0.25,
      riderPose: shot === 'charge' ? 'race' : 'celebrate', backdrop: card.desert ? 'desert' : 'sunset', mask: true,
    });
    const ring = v.mask ? await ringOf(v.mask) : null;
    return { bg: v.background, fg: v.subject, ring, sun: v.sun };
  });
  chain = p.catch(() => {});
  cache.set(card.id, p);
  return p;
}
