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
 * 馬と騎手だけを切り抜いて、白い縁取り（その外に紺の細い縁）を付けた絵。育成モードのホームの主役やアイコンに使う。
 * 縁取りは形を少しずつずらして重ねて塗りつぶす（ringOf と同じ）。毎回 CSS の drop-shadow を何重にも掛けると重いので焼き込む。
 * 形の外接矩形で切り詰める（撮った絵は馬の周りが空いていて、そのまま貼ると馬が小さい）。
 */
function stickerOf(maskUrl, head = null) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c0 = document.createElement('canvas');
      c0.width = W; c0.height = H;
      const g0 = c0.getContext('2d');
      g0.drawImage(img, 0, 0);
      const d = g0.getImageData(0, 0, W, H).data;
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (d[(y * W + x) * 4 + 3] < 24) continue;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      if (x1 < 0) { resolve(null); return; }
      const P = 16;
      const w = x1 - x0 + 1 + P * 2, h = y1 - y0 + 1 + P * 2;
      const sil = (r, color) => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d');
        for (const rr of [r, r * 0.55]) {
          for (let a = 0; a < 24; a++) {
            const t = (a / 24) * Math.PI * 2;
            g.drawImage(img, -x0 + P + Math.cos(t) * rr, -y0 + P + Math.sin(t) * rr);
          }
        }
        g.globalCompositeOperation = 'source-in';
        g.fillStyle = color;
        g.fillRect(0, 0, w, h);
        return c;
      };
      const out = document.createElement('canvas');
      out.width = w; out.height = h;
      const g = out.getContext('2d');
      g.drawImage(sil(11, '#232046'), 0, 0);
      g.drawImage(sil(8, '#ffffff'), 0, 0);
      g.drawImage(img, -x0 + P, -y0 + P);
      // 頭の位置をステッカーの中の割合で（アイコンの切り取りの中心）
      const focus = head ? { x: (head.x * W - x0 + P) / w, y: (head.y * H - y0 + P) / h } : { x: 0.2, y: 0.4 };
      resolve({ url: out.toDataURL('image/png'), w, h, focus });
    };
    img.onerror = () => resolve(null);
    img.src = maskUrl;
  });
}

/**
 * 背景のぼかし（被写界深度）を絵に焼き込む。CSS の filter: blur を一覧のカードすべてに掛けると、
 * 傾けたりホロが動いたりするたびにぼかし直しになって重かった。canvas の filter が無い環境（古い Safari）では null を返し、
 * 画面側が今までどおり CSS でぼかす。
 */
function bakeBlur(url) {
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe || typeof probe.filter !== 'string') return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d');
      g.filter = 'blur(6px) saturate(1.1) brightness(1.06)';
      // 端がぼけて透けないよう、少し大きく描く（以前の CSS の scale(1.03) と同じ）
      g.drawImage(img, -W * 0.015 - 8, -H * 0.015 - 8, W * 1.03 + 16, H * 1.03 + 16);
      resolve(c.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * カードの絵を撮る。card は sim/data/cards.js の 1 枚。
 * @returns {Promise<{bg:string, fg:string, ring:string|null, sun:{x:number,y:number,visible:boolean}, sticker:{url:string,w:number,h:number,focus:{x:number,y:number}}|null}>}
 */
export function cardArt(card) {
  if (cache.has(card.id)) return cache.get(card.id);
  const key = artKey(card);
  const p = loadSaved(key).then((saved) => saved ?? shoot(card).then((v) => { save(key, v); return v; }));
  cache.set(card.id, p);
  return p;
}

/** 撮ってある絵だけを返す（無ければ null）。レース観戦の途中で撮ると、観戦の WebGL の横にもう 1 つ作ることになる（落とし穴 23）。 */
export function cardArtIfReady(card) {
  if (cache.has(card.id)) return cache.get(card.id).catch(() => null);
  return loadSaved(artKey(card)).catch(() => null);
}

// ---------------------------------------------------------------- 撮った絵を残す
// 1 枚撮るのに WebGL で舞台を組んで描くので、79 枚の一覧を開くたびに撮り直すと重い。ブラウザの IndexedDB に残す。
// 鍵は絵に効くカードの値（構え・毛色・白斑・勝負服など）と ART_VER。撮影の舞台（photostage.js）を変えたら ART_VER を上げる。
const ART_VER = 2;   // 2: ステッカー（sticker）を足した
const artKey = (c) => `${ART_VER}:${c.id}:${JSON.stringify([c.hid, c.coat, c.marks, c.surface, c.shot, c.desert, c.silks ?? null, c.facing ?? null, c.pose ?? null, c.gate ?? null, c.phase ?? null, c.legPose ?? null])}`;
let dbp = null;
function db() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbp ??= new Promise((resolve) => {
    try {
      const rq = indexedDB.open('keiba-cardart', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('art');
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}
async function loadSaved(key) {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const rq = d.transaction('art').objectStore('art').get(key);
      rq.onsuccess = () => resolve(rq.result ?? null);
      rq.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
async function save(key, v) {
  const d = await db();
  try { d?.transaction('art', 'readwrite').objectStore('art').put(v, key); } catch { /* 残せなくても次に撮り直すだけ */ }
}

/** 撮影（待ち行列に並べて 1 枚ずつ）。 */
function shoot(card) {
  const p = chain.then(async () => {
    // 1 枚ごとに手を離す（続けて撮ると、その間クリックもスクロールも効かない）
    await new Promise((r) => setTimeout(r, 0));
    renderer ??= new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: true, alpha: true, preserveDrawingBuffer: false });
    renderer.setPixelRatio(1);
    const shot = card.shot ?? 'profile';
    const v = shootFinish(renderer, {
      width: W, height: H,
      hero: { id: card.hid ?? 1, coat: card.coat, gate: card.gate ?? 1, frame: 1, marks: card.marks, silks: card.silks ?? null, legPose: card.legPose ?? null },
      surface: card.surface ?? '芝', shot, phase: card.phase ?? (shot === 'charge' ? 0.3 : 0.25), facing: card.facing ?? 'left',
      riderPose: card.pose ?? (shot === 'charge' ? 'race' : 'celebrate'), backdrop: card.desert ? 'desert' : 'sunset', mask: true,
    });
    const ring = v.mask ? await ringOf(v.mask) : null;
    const baked = await bakeBlur(v.background);
    const sticker = v.mask ? await stickerOf(v.mask, v.head) : null;
    return { bg: baked ?? v.background, bgBaked: !!baked, fg: v.subject, ring, sun: v.sun, sticker };
  });
  chain = p.catch(() => {});
  return p;
}
