// スマホの下メニュー「ラバードック」。
//
// designbookmark.com の Rubber dock（素の HTML/CSS/JS）をこのゲームへ移したもの。動きは元のとおり：
// 選んだ印（ピル）の左右の縁を別々のばねで動かし、進む側の縁は硬く・遅れる側の縁は柔らかくして、
// タブを移るときにピルがゴムのように伸びる。いま居るタブをもう一度押すと、ドック全体がカードに膨らんで
// 行き先の一覧（落とし穴 133 のメニューと同じ中身）を出す。ばねの硬さと減衰は styles.css の --dock-*（元の tokens.css と同じ値）。
//
// **ドックの要素は一度だけ作って、画面を描き直すたびに同じ要素を付け直す。** render() は前面を丸ごと消して
// 作り直すので、そのたびに作るとばねの途中の状態（伸びたピル・開きかけのカード）が消える（落とし穴 23 と同じ考え）。

import { el } from './dom.js';
import { icon } from './icons.js';

// ---------------------------------------------------------------- 小さなばね（元の shared/motion.js）
const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const S = (x, k = 400, c = 30) => ({ x, v: 0, t: x, k, c });
// 動きを減らす設定では臨界減衰にする（行き過ぎて戻る揺れを消す。元と同じ）
const tune = (s, k, c) => { s.k = k; s.c = reduce ? 2 * Math.sqrt(k) : c; };
const step = (s, dt) => { const a = -s.k * (s.x - s.t) - s.c * s.v; s.v += a * dt; s.x += s.v * dt; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const token = (name, fb) => (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb);
const spring = (name, fb) => token(name, fb).split(/\s+/).map(Number);
const settled = (s) => Math.abs(s.x - s.t) < 0.05 && Math.abs(s.v) < 0.05;

// 形。元は 56px の 4 タブだが、5 タブを右下の NEXT（78px）と並べて 360px 幅の端末に収めるため 48px・間 2px にした。
const TAB = 48, GAP = 2;
// カードの中身の高さの上限。元は 300px 固定だが、所有馬・記録の行き先（6 行）が収まるよう画面の高さに合わせる
const panelMax = () => Math.max(220, Math.min(420, innerHeight - 200));

/**
 * @param {{ nav: {id:string,name:string,icon:string}[],
 *           items: (id:string) => ({name:string, sub?:string, n?:number, on?:boolean, go:()=>void}[]),
 *           head: (id:string) => {title:string, note?:string},
 *           go: (id:string) => void }} o
 */
export function createRubberDock(o) {
  const N = o.nav.length;
  const TW = N * TAB + (N - 1) * GAP;
  const cx = (i) => TAB / 2 + i * (TAB + GAP);
  const COL = { W: TW + 12, H: TAB + 12 };

  const T = {
    lead: spring('--dock-lead', '640 38'), trail: spring('--dock-trail', '150 16'),
    dragLead: spring('--dock-drag-lead', '1100 56'), dragTrail: spring('--dock-drag-trail', '320 26'),
    openW: spring('--dock-open-w', '340 21'), openH: spring('--dock-open-h', '230 21'),
    close: spring('--dock-close', '420 30'), pop: spring('--dock-pop', '520 16'),
    expW: parseFloat(token('--dock-expanded-w', '340')),
  };

  // ---- 要素
  const mk = (n) => [icon(n.icon, { size: 20 }), el('small', { text: n.name })];
  const baseIcons = el('div.rd-icons.base', { role: 'tablist', 'aria-label': 'メニュー' });
  const topIcons = el('div.rd-icons.top', { 'aria-hidden': 'true' });
  const btns = o.nav.map((n) => el('button.rd-tab', { role: 'tab', 'aria-label': n.name }, mk(n)));
  const tops = o.nav.map((n) => el('div.rd-tab', mk(n)));
  btns.forEach((b) => baseIcons.appendChild(b));
  tops.forEach((t) => topIcons.appendChild(t));
  const ind = el('div.rd-ind');
  const tabs = el('div.rd-tabs', { style: `width:${TW}px;height:${TAB}px` }, [baseIcons, ind, topIcons]);
  const panel = el('section.rd-panel');
  const panels = el('div.rd-panels', [panel]);
  const dock = el('div.rdock', [panels, tabs]);

  // ---- ばね
  const L = S(cx(0) - TAB / 2), R = S(cx(0) + TAB / 2);
  const W = S(COL.W, 260, 20), H = S(COL.H, 400, 34);
  const nudge = S(0, 300, 18);
  const pops = btns.map(() => S(1, ...T.pop));
  const all = [L, R, W, H, nudge, ...pops];

  let active = 0, expanded = false, panelH = 0;
  const expW = () => Math.min(T.expW, innerWidth - 16);

  function moveTo(center, dir, drag = false) {
    const lead = drag ? T.dragLead : T.lead;
    const trail = drag ? T.dragTrail : T.trail;
    if (dir === 0) { tune(L, 600, 44); tune(R, 600, 44); }
    else {
      const [l, r] = dir > 0 ? [trail, lead] : [lead, trail];
      tune(L, ...l); tune(R, ...r);
    }
    L.t = center - TAB / 2; R.t = center + TAB / 2;
    kick();
  }

  function setActive(i, dirHint) {
    i = clamp(i, 0, N - 1);
    const dir = dirHint ?? Math.sign(cx(i) - (L.x + R.x) / 2);
    moveTo(cx(i), dir);
    const prev = active;
    active = i;
    pops[i].v -= 3.2;
    btns.forEach((b, j) => { b.setAttribute('aria-selected', j === i); b.tabIndex = j === i ? 0 : -1; });
    if (expanded && prev !== i) fillPanel(i, Math.sign(i - prev));
  }

  // カードの中身。開くたび・タブを移るたびに作り直す（頭数や開催中の印は週で変わる）
  function fillPanel(i, dir, fromClosed = false) {
    const n = o.nav[i];
    const h = o.head(n.id);
    const list = o.items(n.id) ?? [];
    panel.classList.remove('on');
    panel.textContent = '';
    panel.appendChild(el('div.rd-head.it', { style: '--i:0' }, [el('h3', { text: h.title }), h.note ? el('small', { text: h.note }) : null]));
    list.forEach((it, k) => panel.appendChild(el('button.rd-row.it', {
      class: it.on ? 'on' : null, style: `--i:${k + 1}`,
      onclick: (e) => { e.stopPropagation(); setExpanded(false); setTimeout(it.go, 90); },
    }, [
      el('span.tx', [el('b', { text: it.name }), it.sub ? el('span', { text: it.sub }) : null]),
      it.n != null ? el('i', { text: String(it.n) }) : null,
    ])));
    // 出る前の位置を置いてから（遷移を切って）次のコマで on にする。元の prep と同じ
    panel.classList.add('prep');
    panel.style.setProperty('--x', `${dir * 28}px`);
    panel.style.setProperty('--y', `${fromClosed ? 14 : 0}px`);
    panel.style.width = `${expW()}px`;
    panelH = Math.min(panelMax(), panel.offsetHeight);
    panel.classList.remove('prep');
    requestAnimationFrame(() => panel.classList.add('on'));
    if (expanded && !fromClosed) { tune(H, 260, 20); H.t = COL.H + panelH; kick(); }
  }

  function setExpanded(v) {
    if (v === expanded) return;
    expanded = v;
    dock.classList.toggle('open', v);
    if (v) {
      fillPanel(active, 0, true);
      W.t = expW(); H.t = COL.H + panelH;
      tune(W, ...T.openW); tune(H, ...T.openH);   // 幅が先に着き、高さが後から行き過ぎて戻る
      document.addEventListener('click', outside);
      document.addEventListener('keydown', onKey);
    } else {
      W.t = COL.W; H.t = COL.H;
      tune(W, T.close[0] * 0.72, T.close[1] * 0.66); tune(H, ...T.close);
      panel.style.setProperty('--x', '0px'); panel.style.setProperty('--y', '6px');
      panel.classList.remove('on');
      document.removeEventListener('click', outside);
      document.removeEventListener('keydown', onKey);
    }
    pops[active].v -= 2.4;
    kick();
  }
  const outside = (e) => { if (!dock.contains(e.target)) setExpanded(false); };
  const onKey = (e) => { if (e.key === 'Escape') setExpanded(false); };

  // ---- 指で引く（端はゴムのように抵抗する）
  let drag = null, suppressClick = false;
  const rubber = (x, min, max, d = 46) =>
    x < min ? min - (1 - 1 / ((min - x) * 0.55 / d + 1)) * d :
    x > max ? max + (1 - 1 / ((x - max) * 0.55 / d + 1)) * d : x;
  // ドックは nudge だけ横にずれて描かれるので、ずれる前の位置で測る（元と同じ）
  const localX = (e) => e.clientX - tabs.getBoundingClientRect().left + nudge.x;
  tabs.addEventListener('pointerdown', (e) => {
    drag = { id: e.pointerId, x0: e.clientX, last: localX(e), live: false, dir: 0 };
  });
  tabs.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.live && Math.abs(e.clientX - drag.x0) > 4) {
      drag.live = true; tabs.setPointerCapture(e.pointerId); tabs.classList.add('dragging');
    }
    if (!drag.live) return;
    const raw = localX(e);
    const d = raw - drag.last; drag.last = raw;
    if (Math.abs(d) > 0.5) drag.dir = Math.sign(d);
    const c = rubber(raw, cx(0), cx(N - 1));
    moveTo(c, drag.dir, true);
    nudge.t = (c - clamp(c, cx(0), cx(N - 1))) * 0.35;
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.live) {
      const c = (L.t + R.t) / 2;
      nudge.t = 0;
      const i = clamp(Math.round((c - cx(0)) / (TAB + GAP) + drag.dir * 0.18), 0, N - 1);
      const changed = i !== active;
      setActive(i, drag.dir || 0);
      if (changed && !expanded) navigate(i);
      suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
      tabs.classList.remove('dragging');
    }
    drag = null;
  };
  tabs.addEventListener('pointerup', endDrag);
  tabs.addEventListener('pointercancel', endDrag);

  // 画面の切り替えは伸びたピルが見えてから（画面を組む 0.1〜0.3 秒は主スレッドが止まり、ばねも止まる）
  let navTimer = 0;
  function navigate(i) {
    clearTimeout(navTimer);
    navTimer = setTimeout(() => o.go(o.nav[i].id), 140);
  }
  btns.forEach((b, i) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (suppressClick) return;
    if (i === active) setExpanded(!expanded);
    else { setActive(i); if (!expanded) navigate(i); }
  }));
  addEventListener('resize', () => { if (expanded) { W.t = expW(); kick(); } });

  // ---- 描く
  function render() {
    const w = W.x, h = Math.max(H.x, 40);
    const open = clamp((h - COL.H) / 300, 0, 1);
    const give = clamp(-H.v / 9000, -0.04, 0.04);   // 高さが急ぐと幅が少し譲る
    dock.style.width = `${w * (1 + give)}px`;
    dock.style.height = `${h}px`;
    dock.style.borderRadius = `${Math.min(h / 2, 30 - 12 * open)}px`;
    dock.style.transform = `translateX(${nudge.x}px)`;

    let l = L.x, r = R.x; if (r < l) [l, r] = [r, l];
    const iw = Math.max(r - l, 22);
    const ih = TAB * clamp(1 / Math.sqrt(iw / TAB), 0.66, 1.1);   // 面積を保つ（伸びると細る）
    const top = (TAB - ih) / 2;
    ind.style.width = `${iw}px`; ind.style.height = `${ih}px`;
    ind.style.borderRadius = `${ih / 2}px`;
    ind.style.transform = `translate3d(${l}px,${top}px,0)`;
    // 白い字の層をピルの形で切り抜く：ピルの居る所だけ字が反転する
    topIcons.style.clipPath = `inset(${top}px ${TW - l - iw}px ${TAB - top - ih}px ${l}px round ${ih / 2}px)`;
    pops.forEach((p, i) => {
      const t = `scale(${p.x})`;
      btns[i].firstChild.style.transform = t; tops[i].firstChild.style.transform = t;
    });
  }

  // 止まっている間は回さない（元はページ全体で 1 本のループを回し続ける。ここは常に画面に居るので電池を食う）
  let raf = 0, last = 0;
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
    const sub = 4;
    for (let k = 0; k < sub; k++) all.forEach((s) => step(s, dt / sub));
    render();
    if (all.every(settled)) { all.forEach((s) => { s.x = s.t; s.v = 0; }); render(); raf = 0; return; }
    raf = requestAnimationFrame(loop);
  }
  function kick() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }

  // 最初は 1 つのピルからドックへ育つ（元の出だし）
  W.x = TAB + 12; W.t = TAB + 12;
  btns.forEach((b, j) => { b.setAttribute('aria-selected', j === 0); b.tabIndex = j === 0 ? 0 : -1; });
  render();
  setTimeout(() => { W.t = COL.W; tune(W, 220, 15); kick(); }, 350);

  return {
    el: dock,
    /** 画面が変わったら呼ぶ。いまの画面のタブへピルを寄せる（メニューの外から移ったときも） */
    sync(screenId) {
      const i = o.nav.findIndex((n) => n.id === screenId);
      dock.classList.toggle('away', i < 0);
      if (i >= 0 && i !== active && !drag) setActive(i);
    },
    close() { setExpanded(false); },
  };
}
