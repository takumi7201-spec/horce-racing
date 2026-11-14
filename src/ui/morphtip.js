// ホームのお知らせの欄の「ページの札」と、札の上を渡るツールチップ（モーフツールチップ）。
//
// designbookmark.com の Morph tooltip（素の HTML/CSS/JS）をこのゲームへ移したもの。動きは元のとおり：
// ツールチップは札ごとに出し直さず 1 つだけ。隣の札へ移るときは、進む側の縁を硬いばね・反対の縁を柔らかいばねで動かして
// 伸びながら渡り、新しい名前の幅に落ち着く。古い名前は来た方へ抜け、新しい名前は向こう側から入る。しっぽは別のばねで追う。
// 札から外れても少し待ってから消す（札の隙間をまたいでもちらつかない）。
// ばねの硬さと減衰は元の tokens.css と同じ値（--spring-lead 620/36・--spring-trail 190/19・出る 420/24・名前 420/32・弾み 520/16）。
// 元のデモにある「触っていないと勝手に札を渡り歩く」動きは入れない（ゲームの画面が勝手に動くと読みにくい）。

import { el } from './dom.js';
import { icon } from './icons.js';

const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const S = (x, k = 400, c = 30) => ({ x, v: 0, t: x, k, c });
// 動きを減らす設定では臨界減衰（行き過ぎて戻る揺れを消す。元の motion.js と同じ）
const tune = (s, k, c) => { s.k = k; s.c = reduce ? 2 * Math.sqrt(k) : c; };
const step = (s, dt) => { const a = -s.k * (s.x - s.t) - s.c * s.v; s.v += a * dt; s.x += s.v * dt; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const settled = (s) => Math.abs(s.x - s.t) < 0.002 && Math.abs(s.v) < 0.002;

const LEAD = [620, 36], TRAIL = [190, 19];
// 札の大きさ。元は 52×44・間 4・内側の余白 6。お知らせの欄は幅が 340px ほどで 7〜8 枚並ぶので詰めた。
const BW = 36, BH = 34, GAP = 2, PAD = 5;

/**
 * @param {{ items: {icon:string, label:string, note?:string}[], active: number, onSelect: (i:number) => void }} o
 * @returns {HTMLElement & { setActive(i:number, announce?:boolean): void }}
 */
export function morphTabs(o) {
  const n = o.items.length;
  const W = PAD * 2 + n * BW + (n - 1) * GAP;
  const cx = (i) => PAD + i * (BW + GAP) + BW / 2;

  const tail = el('i.mt-tail');
  const labs = o.items.map((it) => ({
    el: el('span.mt-lab', [el('span', { text: it.label }), it.note ? el('kbd', { text: it.note }) : null]),
    o: S(0, 420, 32), dir: 0, w: 96,
  }));
  const tip = el('div.mt-tip', { role: 'tooltip' }, labs.map((l) => l.el));
  const hl = el('i.mt-hl');
  const tools = o.items.map((it, i) => {
    const b = el('button.mt-tool', { 'aria-label': it.label, 'aria-pressed': String(i === o.active) }, icon(it.icon, { size: 18 }));
    return { el: b, ic: b.firstElementChild, p: S(1, 520, 16) };
  });
  const bar = el('div.mt-bar', { role: 'toolbar', 'aria-label': 'お知らせのページ' }, [hl, ...tools.map((t) => t.el)]);
  const root = el('div.mt-tools', { style: `width:${W}px;height:${BH + PAD * 2}px` }, [tail, tip, bar]);

  const TL = S(0, ...LEAD), TR = S(0, ...LEAD), TX = S(0, 300, 22);   // ツールチップの左右の縁・しっぽ
  const HL = S(0, ...LEAD), HR = S(0, ...LEAD);                        // 乗せた札の下地の左右の縁
  const A = S(0, 420, 24);                                             // 出ている度合い
  const all = [TL, TR, TX, HL, HR, A, ...labs.map((l) => l.o), ...tools.map((t) => t.p)];
  let cur = -1, hideT = 0, active = o.active;

  function place(i, snap) {
    const c = cx(i), half = labs[i].w / 2;
    for (const [s, v] of [[TL, c - half], [TR, c + half], [TX, c], [HL, c - BW / 2], [HR, c + BW / 2]]) {
      s.t = v; if (snap) { s.x = v; s.v = 0; }
    }
  }
  // 名前の幅は描かれてから測る（字体の読み込みが後になることもある）
  const measure = () => { labs.forEach((l) => { l.w = l.el.offsetWidth || l.w; }); if (cur > -1) place(cur, false); };

  function point(i) {
    clearTimeout(hideT);
    measure();
    if (i === cur) { A.t = 1; kick(); return; }
    const dir = cur < 0 ? 0 : Math.sign(i - cur);
    if (A.x < 0.3) {
      // まだ何も出ていない：その場に出す
      place(i, true);
      labs.forEach((l, k) => { l.o.x = l.o.t = k === i ? 1 : 0; l.o.v = 0; l.dir = 0; });
    } else {
      const right = dir >= 0;
      [TR, HR].forEach((s) => tune(s, ...(right ? LEAD : TRAIL)));
      [TL, HL].forEach((s) => tune(s, ...(right ? TRAIL : LEAD)));
      place(i, false);
      labs.forEach((l, k) => {
        if (k === i) { l.dir = dir; l.o.t = 1; } else if (l.o.t === 1) { l.dir = -dir; l.o.t = 0; }
      });
    }
    cur = i; A.t = 1;
    kick();
  }
  function leave(wait = 140) {
    clearTimeout(hideT);
    hideT = setTimeout(() => { A.t = 0; cur = -1; kick(); }, wait);
  }
  function mark(i) {
    active = i;
    tools.forEach((t, k) => t.el.setAttribute('aria-pressed', String(k === i)));
  }

  tools.forEach((t, i) => {
    t.el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') point(i); });
    t.el.addEventListener('focus', () => point(i));
    t.el.addEventListener('blur', () => leave());
    t.el.addEventListener('click', () => {
      point(i);
      t.p.x = 0.78; A.x = Math.min(A.x, 0.9);
      mark(i);
      o.onSelect(i);
      // 指で押したとき（乗せる操作が無い）も名前を読めるよう、少し出してから消す
      if (!bar.matches(':hover')) leave(1300);
    });
  });
  bar.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') leave(); });

  function render() {
    const a = clamp(A.x, 0, 1.15), op = clamp(A.x, 0, 1);
    // ツールチップは欄の幅の外へはみ出さない（しっぽは札を指したまま）
    const host = root.parentElement?.clientWidth || W;
    const lim = Math.max(W / 2, host / 2 - 6);
    const l0 = Math.min(TL.x, TR.x - 30), w = TR.x - l0;
    const lo = W / 2 - lim, hi = Math.max(lo, W / 2 + lim - w);
    const left = clamp(l0, lo, hi);
    tip.style.width = `${w.toFixed(2)}px`;
    tip.style.opacity = op.toFixed(3);
    tip.style.transform = `translate(${left.toFixed(2)}px,${((1 - a) * 6).toFixed(2)}px) scale(${(0.72 + 0.28 * a).toFixed(4)})`;
    const tx = clamp(TX.x, left + 12, left + w - 12);
    tail.style.opacity = op.toFixed(3);
    tail.style.transform = `translate(${(tx - 6).toFixed(2)}px,${((1 - a) * 8).toFixed(2)}px) rotate(45deg) scale(${a.toFixed(3)})`;
    hl.style.opacity = op.toFixed(3);
    const hx = clamp(Math.min(HL.x, HR.x - 18), PAD, W - PAD - 18), hr = clamp(HR.x, hx + 18, W - PAD);
    hl.style.width = `${(hr - hx).toFixed(2)}px`;
    hl.style.transform = `translateX(${hx.toFixed(2)}px)`;
    for (const lb of labs) {
      const v = clamp(lb.o.x, 0, 1);
      lb.el.style.opacity = v.toFixed(3);
      lb.el.style.transform = `translateX(calc(-50% + ${(lb.dir * (1 - v) * 14).toFixed(2)}px))`;
      lb.el.style.filter = v > 0.02 && v < 0.98 ? `blur(${((1 - v) * 3).toFixed(2)}px)` : 'none';
    }
    tools.forEach((t) => { t.ic.style.transform = `scale(${t.p.x.toFixed(4)})`; });
  }

  // 止まっている間は回さない。画面から外れたら（ホームを描き直した）止める。
  let raf = 0, last = 0;
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
    for (let k = 0; k < 4; k++) all.forEach((s) => step(s, dt / 4));
    render();
    if (!root.isConnected || all.every(settled)) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
  }
  function kick() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }
  render();

  /** 矢印でページをめくったとき：札の印を移し、announce なら新しいページの名前を少し見せる */
  root.setActive = (i, announce = false) => {
    if (i === active) return;
    mark(i);
    tools[i].p.v -= 3;
    if (announce) { point(i); if (!bar.matches(':hover')) leave(1100); } else kick();
  };
  return root;
}
