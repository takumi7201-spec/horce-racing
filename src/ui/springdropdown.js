// ホームのお知らせの欄の「ページを選ぶ」ドロップダウン（スプリングドロップダウン）。
//
// designbookmark.com の Spring dropdown（素の HTML/CSS/JS）をこのゲームへ移したもの。動きは元のとおり：
// メニューの高さがばねで、少し行き過ぎて落ちる。行は上から順に落ちてくる。乗せた行の下地は進む側の縁が硬く・反対の縁が柔らかく、
// 行のあいだを伸びて渡る。選ぶとその行のチェックが描かれ、新しい値がボタンへ転がり上がり、メニューが畳まれる。
// ばねの硬さと減衰は元の値のまま（高さ 300/23・矢印 300/18・濃さ 400/34・ボタンの沈み 500/18・値の転がり 340/26・
// 下地の縁 620/36 と 200/20・下地の濃さ 400/32・行 300/24・チェック 260/26）。
// 元のデモの「メニューの高さの半分だけ部品全体を持ち上げて真ん中に保つ」動き（舞台の真ん中に置くため）と、
// 「触っていないと勝手に開いて選ぶ」動きは入れない（お知らせの欄の中では、ほかの部品を押しのけてしまう）。
// 操作：Enter・Space・↓で開く、↑↓で移る、Enter で選ぶ、Esc で閉じる。

import { el } from './dom.js';

const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const S = (x, k = 400, c = 30) => ({ x, v: 0, t: x, k, c });
const tune = (s, k, c) => { s.k = k; s.c = reduce ? 2 * Math.sqrt(k) : c; };
const S2 = (x, k, c) => { const s = S(x, k, c); tune(s, k, c); return s; };
const step = (s, dt) => { const a = -s.k * (s.x - s.t) - s.c * s.v; s.v += a * dt; s.x += s.v * dt; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const settled = (s) => Math.abs(s.x - s.t) < 0.002 && Math.abs(s.v) < 0.002;

// 行の高さ。元は 44px。お知らせの欄は縦が詰まっているので 38px。
const ROW = 38, PAD = 6;
const TICK = '<svg class="sd-tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const CHEV = '<svg class="sd-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

/**
 * @param {{ items: {label:string, color:string, note?:string}[], value: number, label?: string, onSelect: (i:number) => void }} o
 * @returns {HTMLElement & { setValue(i:number): void }}
 */
export function springDropdown(o) {
  const n = o.items.length;
  const MH = PAD * 2 + ROW * n;
  const slot = () => el('span.sd-slot', [el('i.sd-dot'), el('b')]);
  const slots = [slot(), slot()];
  const trig = el('button.sd-trig', { 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': o.label ?? '選ぶ' }, [
    el('span.sd-val', slots),
  ]);
  trig.insertAdjacentHTML('beforeend', CHEV);
  const chev = trig.lastElementChild;
  const hl = el('i.sd-hl');
  const opts = o.items.map((it, i) => {
    const row = el('div.sd-opt', { role: 'option', 'aria-selected': String(i === o.value), style: `--c:${it.color}` },
      [el('i.sd-dot'), el('b', { text: it.label }), it.note ? el('small', { text: it.note }) : null]);
    row.insertAdjacentHTML('beforeend', TICK);
    return { el: row, i, it, tick: row.lastElementChild.firstElementChild, s: S2(0, 300, 24), k: S2(0, 260, 26) };
  });
  const menu = el('div.sd-menu', { role: 'listbox' }, [hl, ...opts.map((p) => p.el)]);
  const root = el('div.sd', [trig, menu]);

  const H = S2(0, 300, 23), C = S2(0, 300, 18), O = S2(0, 400, 34);
  const TS = S2(1, 500, 18), R = S2(1, 340, 26);
  const HT = S2(PAD, 620, 36), HB = S2(PAD + ROW, 620, 36), HO = S2(0, 400, 32);
  const all = [H, C, O, TS, R, HT, HB, HO, ...opts.flatMap((p) => [p.s, p.k])];
  let open = false, sel = o.value, hov = -1, front = 0;
  const timers = [];

  const fill = (s, i) => {
    s.style.setProperty('--c', o.items[i].color);
    s.lastElementChild.textContent = o.items[i].label;
  };
  fill(slots[0], sel);
  opts[sel].k.x = opts[sel].k.t = 1;

  function hover(i, snap) {
    if (i === hov || i < 0 || i >= n) return;
    const top = PAD + i * ROW;
    if (snap || hov < 0) { HT.x = HT.t = top; HB.x = HB.t = top + ROW; HT.v = HB.v = 0; }
    else {
      const down = i > hov;
      tune(down ? HB : HT, 620, 36); tune(down ? HT : HB, 200, 20);
      HT.t = top; HB.t = top + ROW;
    }
    hov = i; HO.t = 1;
    kick();
  }
  function setOpen(v) {
    if (open === v) return;
    open = v;
    trig.setAttribute('aria-expanded', String(v));
    root.classList.toggle('open', v);
    H.t = v ? MH : 0; C.t = v ? 1 : 0; O.t = v ? 1 : 0;
    timers.splice(0).forEach(clearTimeout);
    // 行は開くとき上から順に落ち、閉じるとき下から畳まれる（元のずらし方）
    opts.forEach((p, i) => timers.push(setTimeout(() => { p.s.t = open ? 1 : 0; kick(); }, (v ? 0.05 + i * 0.045 : (n - 1 - i) * 0.02) * 1000)));
    if (v) {
      hover(sel, true);
      document.addEventListener('pointerdown', outside, true);
    } else {
      hov = -1; HO.t = 0;
      document.removeEventListener('pointerdown', outside, true);
    }
    kick();
  }
  const outside = (e) => { if (!e.composedPath().includes(root)) setOpen(false); };

  /** 値を替える（転がり上がる）。fromUser のときだけ呼び出し元へ知らせる */
  function choose(i, fromUser) {
    if (i !== sel) {
      sel = i; front ^= 1;
      fill(slots[front], i);
      R.x = 0; R.v = 0; R.t = 1;
    }
    opts.forEach((p) => { p.k.t = p.i === sel ? 1 : 0; p.el.setAttribute('aria-selected', String(p.i === sel)); });
    kick();
    if (fromUser) {
      TS.x = 0.955;
      o.onSelect(i);
      setTimeout(() => setOpen(false), 240);
    }
  }

  trig.addEventListener('click', () => { TS.x = 0.965; setOpen(!open); });
  opts.forEach((p) => {
    p.el.addEventListener('pointermove', () => { if (open) hover(p.i); });
    p.el.addEventListener('click', () => { if (open) choose(p.i, true); });
  });
  trig.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setOpen(true); else hover(hov + (e.key === 'ArrowDown' ? 1 : -1));
    } else if ((e.key === 'Enter' || e.key === ' ') && open && hov > -1) { e.preventDefault(); choose(hov, true); }
    else if (e.key === 'Escape' && open) setOpen(false);
  });

  function render() {
    trig.style.transform = `scale(${TS.x.toFixed(4)})`;
    chev.style.transform = `rotate(${(180 * C.x).toFixed(2)}deg)`;
    const h = Math.max(0, H.x), op = clamp(O.x, 0, 1);
    menu.style.height = `${h.toFixed(2)}px`;
    menu.style.opacity = op.toFixed(3);
    menu.style.visibility = h < 1 ? 'hidden' : 'visible';
    menu.style.pointerEvents = open ? 'auto' : 'none';
    menu.style.transform = `scaleX(${(0.9 + 0.1 * clamp(H.x / MH, 0, 1.06)).toFixed(4)})`;
    for (const p of opts) {
      const s = clamp(p.s.x, 0, 1);
      p.el.style.opacity = s.toFixed(3);
      p.el.style.transform = `translateY(${((p.s.x - 1) * 14).toFixed(2)}px)`;
      p.tick.style.strokeDashoffset = (22 * (1 - clamp(p.k.x, 0, 1))).toFixed(2);
    }
    hl.style.opacity = (clamp(HO.x, 0, 1) * op).toFixed(3);
    const ht = clamp(Math.min(HT.x, HB.x - 16), PAD, MH - PAD - 16), hb = clamp(HB.x, ht + 16, MH - PAD);
    hl.style.height = `${(hb - ht).toFixed(2)}px`;
    hl.style.transform = `translateY(${ht.toFixed(2)}px)`;
    const r = R.x, a = slots[front], b = slots[front ^ 1];
    a.style.opacity = clamp(r, 0, 1).toFixed(3);
    a.style.transform = `translateY(${((1 - r) * 18).toFixed(2)}px)`;
    b.style.opacity = clamp(1 - r, 0, 1).toFixed(3);
    b.style.transform = `translateY(${(-r * 18).toFixed(2)}px)`;
  }

  // 止まっている間は回さない。画面から外れたら止める。
  let raf = 0, last = 0;
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
    for (let k = 0; k < 4; k++) all.forEach((s) => step(s, dt / 4));
    render();
    if (!root.isConnected) { document.removeEventListener('pointerdown', outside, true); raf = 0; return; }
    if (all.every(settled)) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
  }
  function kick() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }
  render();

  /** 札の列・矢印でページを替えたとき：値だけ転がして合わせる（呼び出し元へは知らせない） */
  root.setValue = (i) => choose(i, false);
  return root;
}
