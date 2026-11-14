// レース観戦の画面の表示（中継の札）。Godot 版（godot/scripts/broadcast.gd の HUD）から移したもの。デザインはこのゲームのオリジナル。
//
// 左上：レースの札（格・名・条件）。その下に順位（画面ごとの .rankbox をそのまま使う）。
// 右上：時計・残り距離・1000m の通過。下：全馬の位置の帯（スタートからゴールまでの線に馬番の丸）。
// その上に実況の字幕（中継の演出 render3d/broadcast.js が走行ログから作った予定を、時刻が来たら出す）。
// ゴールの 3 秒後に確定の札（1〜3 着）。
// 字幕は前の字幕の消える動きを止めてから出す（続けて出すと前の字幕の消える動きが次を消した）。一時停止の間は消さない。

import { el } from './dom.js';
import { FRAME_COLORS } from '../render3d/horse3d.js';
import { fmtRaceTime } from '../render3d/broadcast.js';

// 枠の色に乗せる字の色（白・黄・桃の枠は黒い字）
const FRAME_INK = ['#111', '#fff', '#fff', '#fff', '#111', '#fff', '#111', '#111'];
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

/**
 * @param {object} view createRaceView の返り値
 * @param {object} race simulateRace の結果
 * @param {{mine?:Iterable<number>, title?:string}} opts
 */
export function createRaceHud(view, race, opts = {}) {
  const mine = new Set(opts.mine ?? []);
  const bc = view.broadcast;
  const byId = new Map(race.results.map((r) => [r.horseId, r]));
  const grade = race.grade && /^(G|J|OP|L)/.test(race.grade) ? race.grade.replace('Jpn', 'Jpn') : null;

  const plate = el('div.rh-plate', [
    grade ? el('span.rh-grade', { text: grade }) : null,
    el('div.rh-pt', [
      el('b', { text: opts.title ?? race.name }),
      el('small', { text: `${race.courseName ?? ''}　${race.surface}${race.distance}m　馬場 ${race.ground ?? '良'}　${race.results.length} 頭` }),
    ]),
  ]);
  const clock = el('b.rh-time', { text: '0.0' });
  const rem = el('span.rh-rem');
  const split = el('span.rh-split');
  const clockBox = el('div.rh-clock', [clock, rem, split]);
  const cap = el('div.rh-cap');
  const strip = el('canvas.rh-strip');
  const result = el('div.rh-result');
  const node = el('div.rhud', [plate, clockBox, cap, strip, result]);

  let evI = 0;
  let capTimer = 0;
  let resultShown = false;

  function caption(ev) {
    cap.textContent = ev.text;
    cap.className = `rh-cap on k-${ev.kind}`;
    clearTimeout(capTimer);
    capTimer = setTimeout(() => { if (view.playing) cap.classList.remove('on'); }, ev.kind === 'goal' ? 6000 : 3800);
  }

  function showResult() {
    const top = race.results.slice(0, 3);
    result.replaceChildren(
      el('div.rh-rh', [el('span.rh-fix', { text: '確定' }), el('b', { text: opts.title ?? race.name })]),
      ...top.map((r, k) => el('div.rh-rr', [
        el('b.rh-ord', { text: `${k + 1}着` }),
        el('span.rh-gate', { text: String(r.gate), style: `background:${hex(FRAME_COLORS[(r.frame - 1) % 8])};color:${FRAME_INK[(r.frame - 1) % 8]}` }),
        el('span.rh-nm', { text: r.name, class: mine.has(r.horseId) ? 'mine' : null }),
        el('span.rh-tt', { text: k === 0 ? fmtRaceTime(r.time) : `+${(r.time - top[0].time).toFixed(1)}` }),
      ])),
    );
    result.classList.add('on');
  }

  function drawStrip(st) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = strip.clientWidth, H = strip.clientHeight;
    if (!W || !H) return;
    if (strip.width !== Math.round(W * dpr)) { strip.width = Math.round(W * dpr); strip.height = Math.round(H * dpr); }
    const g = strip.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const dist = race.distance;
    const x0 = 62, x1 = W - 26, y = H / 2;
    // 揃え（textAlign）は前のコマの値が残る（START が中央揃えで左へはみ出して切れた）。毎回決める
    g.textAlign = 'left';
    g.font = '900 11px "Corporate Logo", system-ui, sans-serif';
    g.fillStyle = '#d3e27f';
    g.textBaseline = 'middle';
    g.fillText('START', 10, y);
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
    g.lineWidth = 2; g.font = '800 9px "Corporate Logo", system-ui, sans-serif'; g.textAlign = 'center';
    for (let m = 200; m < dist; m += 200) {
      const x = x0 + ((x1 - x0) * (dist - m)) / dist;
      const big = m % 1000 === 0 || m === 200 || m === 600;
      g.strokeStyle = 'rgba(255,255,255,.55)';
      g.beginPath(); g.moveTo(x, y - (big ? 7 : 4)); g.lineTo(x, y + (big ? 7 : 4)); g.stroke();
      if (big) { g.fillStyle = 'rgba(255,255,255,.6)'; g.fillText(String(m), x, H - 6); }
    }
    g.strokeStyle = '#f3a332'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(x1, 5); g.lineTo(x1, H - 5); g.stroke();
    g.fillStyle = '#f3a332'; g.textAlign = 'left'; g.font = '900 12px "Corporate Logo", system-ui, sans-serif'; g.fillText('G', x1 + 5, y);
    // 後ろから描く（前の馬が上に重なる）。近い馬は上下の段に振り分ける
    const list = st.ranked.slice().sort((a, b) => a.s - b.s);
    let lastX = -99, lane = 0;
    g.textAlign = 'center'; g.font = '900 9px "Corporate Logo", system-ui, sans-serif';
    for (const r of list) {
      const x = x0 + (x1 - x0) * Math.min(1, Math.max(0, r.s / dist));   // ゴールの後に走り抜けた馬も G で止める
      lane = x - lastX < 15 ? (lane + 1) % 2 : 0;
      lastX = x;
      const cy = y + (lane * 2 - 1) * 8;
      const fi = (r.frame - 1) % 8;
      if (mine.has(r.id)) { g.fillStyle = '#f3a332'; g.beginPath(); g.arc(x, cy, 10, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#113035'; g.beginPath(); g.arc(x, cy, 8, 0, Math.PI * 2); g.fill();
      g.fillStyle = hex(FRAME_COLORS[fi]); g.beginPath(); g.arc(x, cy, 6.8, 0, Math.PI * 2); g.fill();
      g.fillStyle = FRAME_INK[fi]; g.fillText(String(r.gate), x, cy + 0.5);
    }
  }

  function frame(st) {
    const t = st.time;
    clock.textContent = fmtRaceTime(Math.min(t, bc.tWin));
    rem.textContent = st.remaining > 0.5 ? `残り ${Math.ceil(st.remaining / 10) * 10}m` : 'ゴール';
    split.textContent = bc.pass1000 > 0 && t >= bc.pass1000 ? `1000m 通過 ${fmtRaceTime(bc.pass1000)}` : '';
    // 巻き戻したら最初から数え直す
    if (evI > 0 && t < bc.events[evI - 1].t - 0.05) {
      evI = 0;
      while (evI < bc.events.length && bc.events[evI].t <= t) evI++;
      cap.classList.remove('on');
    }
    let last = null;
    while (evI < bc.events.length && bc.events[evI].t <= t) last = bc.events[evI++];
    if (last) caption(last);
    if (!view.playing && evI > 0 && t - bc.events[evI - 1].t < 4) cap.classList.add('on');
    const show = t > bc.tWin + 3;
    if (show && !resultShown) { resultShown = true; showResult(); } else if (!show && resultShown) { resultShown = false; result.classList.remove('on'); }
    drawStrip(st);
    void byId;
  }

  return { node, frame, dispose() { clearTimeout(capTimer); } };
}
