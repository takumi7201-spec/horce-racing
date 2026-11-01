// レースの中継の演出（「自動」のカメラと実況の字幕の予定）。Godot 版（godot/scripts/broadcast.gd）から移したもの。
// デザインはこのゲームのオリジナル（参考に挙がった市販ゲームの画面の構成や表示は写さない）。
//
// カメラは先頭の馬のいる場面でカットを割る：
//   ゲート（正面）→ 序盤（外から並走）→ コーナー（上から追う）→ 1 周目のスタンド前（スタンドから振る）→
//   向正面（内馬場から）→ 最後のコーナー（直線の入口の外から迎える）→ 直線（ゴールの 60m 先から望遠で正面）→
//   ゴール前（決勝線の真横から振る。ここだけスロー）→ ゴールの後（勝ち馬を追う）
// カットは 3.5 秒より短くしない（場面の境目で行ったり来たりしない）。直線・ゴール前・ゲート・ゴールの後は待たない。
// 字幕と 1000m の通過の時計は、走行ログ（先頭が各地点を過ぎた時刻と、そのときの並び）から最初に作る。結果は変えない。
//
// three.js の画角（fov）も縦なので、収めたい大きさは画面の高さの半分で測る（横の幅で測ると 2.5 倍広く写った。Godot 版で踏んだ）。

import { curvatureAt } from '../sim/course.js';
import { clamp, lerp } from '../core/util.js';

const MIN_SHOT = 3.5;
const deg = (r) => (r * 180) / Math.PI;

export function fmtRaceTime(t) {
  const m = Math.floor(t / 60);
  return m > 0 ? `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}` : t.toFixed(1);
}

/**
 * @param {object} track buildTrack の返り値
 * @param {object} race  { distance, log }
 * @param {Array} runners [{ id, name, gate, frame, order, time, tFin, pos(Float32Array, log の列) }]
 * @param {(t:number)=>Array} stateAt 時刻 t の全馬 { id, s, off, v }（off は絵の横位置）
 * @param {(p:number, off:number, dy:number)=>{x,y,z}} at 周回位置 p・横位置 off の座標（標高つき）
 */
export function createDirector(track, race, runners, stateAt, at) {
  const dist = race.distance;
  const start = track.start;
  const log = race.log;
  const tWin = Math.min(...runners.map((r) => r.tFin));

  // 最後のコーナーの出口と入口（走った距離）
  let arcEnd = -1;
  for (let s = dist - 5; s > 0; s -= 5) if (curvatureAt(track, start + s) > 0) { arcEnd = s; break; }
  let arcStart = arcEnd;
  while (arcStart > 0 && curvatureAt(track, start + arcStart - 5) > 0) arcStart -= 5;

  /** 先頭が走った距離 x を過ぎた時刻（ログは 0.2 秒ごと） */
  function leadTimeAt(x) {
    let prev = 0;
    for (let f = 0; f < log.frames; f++) {
      let m = 0;
      for (let k = 0; k < log.n; k++) m = Math.max(m, log.pos[f * log.n + k]);
      if (m >= x) return f === 0 ? 0 : (f - 1) * log.dt + (log.dt * (x - prev)) / Math.max(0.01, m - prev);
      prev = m;
    }
    return -1;
  }
  const orderAt = (t) => {
    const st = stateAt(t);
    return st.slice().sort((a, b) => b.s - a.s).map((x) => runners.find((r) => r.id === x.id));
  };

  // ---------------------------------------------------------------- 字幕の予定
  const events = [{ t: 0.4, text: `スタート！　${runners.length} 頭がそろって飛び出した`, kind: 'start' }];
  let firstArc = -1;
  for (let s = 100; s < dist - 600; s += 5) if (curvatureAt(track, start + s) > 0) { firstArc = s; break; }
  if (firstArc > 0 && firstArc < arcStart - 300) {
    const o = orderAt(leadTimeAt(firstArc));
    events.push({ t: leadTimeAt(firstArc), text: `コーナーへ。ハナを切ったのは ${o[0].gate} 番 ${o[0].name}`, kind: 'info' });
  }
  const pass1000 = dist >= 1400 ? leadTimeAt(1000) : -1;
  if (pass1000 > 0) {
    const even = (tWin * 1000) / dist;
    const pace = pass1000 < even - 0.9 ? '速いペース' : pass1000 > even + 0.9 ? 'ゆったりしたペース' : '平均ペース';
    events.push({ t: pass1000, text: `1000m 通過 ${fmtRaceTime(pass1000)}　${pace}`, kind: 'split' });
  }
  if (dist >= 1800) {
    const t = leadTimeAt(dist - 1000);
    const o = orderAt(t);
    events.push({ t, text: `残り 1000m。先頭 ${o[0].name}、2 番手 ${o[1]?.name ?? ''}、3 番手 ${o[2]?.name ?? ''}`, kind: 'info' });
  }
  if (arcEnd > 0 && arcStart > 200) {
    events.push({ t: leadTimeAt(arcStart + 20), text: '最後のコーナー。後続も外から差を詰めにかかる', kind: 'info' });
    const ts = leadTimeAt(arcEnd + 10);
    const o = orderAt(ts);
    events.push({ t: ts, text: `直線に向いた！　先頭は ${o[0].gate} 番 ${o[0].name}`, kind: 'hot' });
  }
  {
    const t = leadTimeAt(dist - 200);
    const st = stateAt(t).slice().sort((a, b) => b.s - a.s);
    const o = st.map((x) => runners.find((r) => r.id === x.id));
    const close = st.length > 1 && st[0].s - st[1].s < 2.4;
    events.push({ t, text: close ? `残り 200m！　${o[0].name} と ${o[1].name} の叩き合い！` : `残り 200m！　${o[0].name} が抜け出した！`, kind: 'hot' });
  }
  const winner = runners.find((r) => r.order === 1);
  if (winner) events.push({ t: tWin, text: `${winner.name}、ゴールイン！　勝ち時計 ${fmtRaceTime(winner.time)}`, kind: 'goal' });
  events.sort((a, b) => a.t - b.t);

  // ---------------------------------------------------------------- カメラ
  let shot = '';
  let shotT = 0;
  let anchor = null;
  let lastT = 0;
  const eye = { x: 0, y: 0, z: 0, set: false };
  const look = { x: 0, y: 0, z: 0 };
  let fovNow = 32;
  let slow = 1;

  function pick(t, lead) {
    const rem = dist - lead.s;
    if (t < 3.2) return 'gate';
    if (t > tWin + 2) return 'after';
    if (rem <= 130) return 'post';
    const onArc = curvatureAt(track, start + lead.s) > 0;
    if (!onArc && arcEnd > 0 && lead.s >= arcEnd - 5) return 'head';
    if (onArc && arcEnd > 0 && lead.s > arcEnd - 200) return 'turn4';
    if (onArc) return 'aerial';
    const pm = (((start + lead.s) % track.lap) + track.lap) % track.lap;
    if (pm > track.lap - track.homeStraight || pm < (track.toFirst ?? 0)) return 'stand';
    if (lead.s < 320) return 'side';
    return 'infield';
  }

  function placeAnchor(lead) {
    const w = track.width;
    if (shot === 'stand') anchor = at(track.lap - track.homeStraight * 0.45, w + 24, 15);
    else if (shot === 'turn4') anchor = at(start + arcEnd - 20, w + 30, 12);
    else if (shot === 'head') anchor = at(start + dist + 60, w * 0.35, 4.5);
    else if (shot === 'post') anchor = at(start + dist + 0.5, w + 13, 5.5);
    void lead;
  }

  const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const fovFor = (e, l, half, lo, hi) => clamp(deg(2 * Math.atan(half / Math.max(1, dist3(e, l)))), lo, hi);

  /**
   * いまのカメラ。st は時刻 t の全馬の状態。返り値 { eye, look, fov, slow }（slow は再生の速さに掛ける）。
   * snap は寄せずに置く（止めた時刻へ飛んだとき）。
   */
  function camera(t, st, snap = false) {
    const dt = clamp(Math.abs(t - lastT), 0, 0.25);
    lastT = t;
    shotT += dt;
    const ranked = st.slice().sort((a, b) => b.s - a.s);
    const lead = ranked[0];
    const want = pick(t, lead);
    const urgent = want === 'post' || want === 'head' || want === 'after' || want === 'gate';
    let cut = false;
    if (want !== shot && (shot === '' || shotT > MIN_SHOT || urgent)) {
      shot = want; shotT = 0; cut = true;
      placeAnchor(lead);
    }
    const w = track.width;
    const k6 = Math.min(6, ranked.length);
    const pm = start + ranked.slice(0, k6).reduce((a, x) => a + x.s, 0) / k6;
    const pl = start + lead.s;
    let e, l, fov = 32;
    switch (shot) {
      case 'gate': {
        const mid = (ranked.length - 1) * 1.05 / 2 + 1;
        e = at(start + 30, mid + 7, 3.2); l = at(start + 1, mid, 1.3); fov = 38;
        break;
      }
      case 'side': e = at(pm - 6, w + 16, 6); l = at(pm + 4, w * 0.3, 1.2); fov = 30; break;
      case 'aerial': e = at(pm - 28, w + 46, 30); l = at(pm + 10, w * 0.3, 0); fov = 40; break;
      case 'stand': case 'turn4': case 'post': {
        e = anchor;
        l = shot === 'post' ? at(pl + 2, lead.off, 1.2) : at(pm + 2, w * 0.35, 1.2);
        fov = fovFor(e, l, shot === 'post' ? 4.5 : 9, 2, 40);
        break;
      }
      case 'infield': e = at(pm + 12, -28, 5); l = at(pm, w * 0.35, 1.3); fov = 28; break;
      case 'head': e = anchor; l = at(pl - 6, lead.off, 1.5); fov = fovFor(e, l, 5, 1.5, 30); break;
      case 'after': {
        const wr = st.find((x) => x.id === winner?.id) ?? lead;
        e = at(start + wr.s - 9, wr.off + 11, 3.8); l = at(start + wr.s + 3, wr.off, 1.3); fov = 34;
        break;
      }
      default: e = at(pm - 6, w + 16, 6); l = at(pm + 4, w * 0.3, 1.2);
    }
    if (snap || cut || !eye.set) {
      Object.assign(eye, e, { set: true });
      Object.assign(look, l);
      fovNow = fov;
    } else {
      const k = clamp(dt * 4, 0, 1), kl = clamp(dt * 6, 0, 1);
      eye.x = lerp(eye.x, e.x, k); eye.y = lerp(eye.y, e.y, k); eye.z = lerp(eye.z, e.z, k);
      look.x = lerp(look.x, l.x, kl); look.y = lerp(look.y, l.y, kl); look.z = lerp(look.z, l.z, kl);
      fovNow = lerp(fovNow, fov, clamp(dt * 3, 0, 1));
    }
    // ゴール前だけ少しスロー（先頭が決勝線を過ぎて 1 秒で戻す）
    const wantSlow = shot === 'post' && t < tWin + 1 && t > tWin - 2.2 ? 0.55 : 1;
    slow = snap ? wantSlow : lerp(slow, wantSlow, clamp(dt * 5, 0, 1));
    return { eye, look, fov: fovNow, slow, shot };
  }

  return {
    events, pass1000, tWin, camera,
    reset() { shot = ''; shotT = 0; eye.set = false; },
  };
}
