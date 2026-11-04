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

/**
 * 先頭の集団（JRA の中継の追いが収める範囲）。先頭からつながっている馬（前の馬との間が 12m 以内、先頭から 30m 以内、5 頭まで）。
 * 大逃げのときは逃げ馬だけになる（後ろの集団まで入れようと引くと、逃げ馬が豆粒になった）。ranked は前から順の { s, off }。
 * 返り値 { mid（集団の真ん中の走った距離）, span（前後の長さ m）, off（横の位置の平均）}。中継（raceview の tv）と自動のカメラで使う。
 */
export function trackingFrame(ranked) {
  const lead = ranked[0];
  let tail = lead, offSum = lead.off, n = 1, lo = lead.off, hi = lead.off;
  for (const x of ranked.slice(1, 5)) {
    if (tail.s - x.s > 12 || lead.s - x.s > 30) break;
    tail = x; offSum += x.off; n++; lo = Math.min(lo, x.off); hi = Math.max(hi, x.off);
  }
  const front = lead.s + 3, back = tail.s - 3.5;
  // width は集団の横の広がり（正面から撮るときに収める幅）
  return { mid: (front + back) / 2, span: Math.max(13, front - back), off: offSum / n, width: Math.max(10, hi - lo + 6) };
}

/**
 * 追いのカットの置き場所（中継と自動のカメラで共用）。返り値 { e, l, fov }（fov は縦）。at は (周回位置, 横位置, 高さ) → 座標。
 *   trackOut   外ラチの外の低い所から真横に近く（JRA の追い）
 *   trackIn    内馬場の側から真横に近く
 *   front3q    集団の 28m 先の外ラチ際の低い所から、斜め前で迎える
 *   curveFront 集団の 55m 先の走路の上から、真正面で迎える（コーナーを回ってくる馬群を正面から。望遠で前後が詰まって見える）
 *   high       外の後ろの高い所から、集団と後続の隊列を見下ろす
 */
export function trackShot(name, track, at, fr, aspect = 1.6) {
  const w = track.width, gm = track.start + fr.mid;
  const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  let e, l, span = fr.span;
  switch (name) {
    case 'trackIn': e = at(gm + TRACK_CAM.ahead, -TRACK_CAM.out, TRACK_CAM.height); l = at(gm, fr.off, 1.3); break;
    case 'front3q': e = at(gm + fr.span / 2 + 28, w + 9, 2.6); l = at(gm + 2, fr.off, 1.3); span = Math.max(fr.width + 4, fr.span * 0.5); break;
    // コーナーでは 55m 先から見る線（弦）が内へ 4m ほど入り、内ラチが手前を横切って馬群を隠したので、外へ 5m 寄せて少し高く構える
    case 'curveFront': e = at(gm + fr.span / 2 + 55, fr.off + 5, 4.5); l = at(gm + 2, fr.off, 1.2); span = fr.width + 4; break;
    case 'high': e = at(gm - 22, w + 30, 16); l = at(gm + 4, fr.off, 1); span = fr.span * 1.5; break;
    default: e = at(gm + TRACK_CAM.ahead, w + TRACK_CAM.out, TRACK_CAM.height); l = at(gm, fr.off, 1.3);
  }
  return { e, l, fov: trackingFov(span, d3(e, l), aspect) };
}

/**
 * 「中継」のカメラ：追いのカットを場面で割る（同じ横からの追いだけでは代わり映えしなかった）。
 * コーナーは正面から迎える → 外の高い所 → 外から追う、直線は外から追う → 斜め前 → 内から → 高い所 を順に回す。
 * 7 秒でカットを替え、場面（コーナー・直線）が変わったらすぐ替える（3.5 秒より短くしない）。ゴール前 150m は外から追う。
 */
const TV_ROT = { curve: ['curveFront', 'high', 'trackOut'], straight: ['trackOut', 'front3q', 'trackIn', 'high'] };
export function createTvDirector(track, race) {
  let shot = '', shotT = 0, lastT = 0, kind = '', n = 0;
  return {
    /** t は時刻、ranked は前から順の馬。返り値 { shot, cut }（cut は寄せずに置くカット頭） */
    pick(t, ranked) {
      const dt = Math.min(0.25, Math.abs(t - lastT));
      lastT = t; shotT += dt;
      const lead = ranked[0];
      const k = race.distance - lead.s <= 150 ? 'post' : curvatureAt(track, track.start + lead.s) > 0 ? 'curve' : 'straight';
      let cut = false;
      if (k !== kind && (shot === '' || shotT > MIN_SHOT || k === 'post')) {
        kind = k; n = 0; cut = true;
      } else if (k !== 'post' && shotT > 7) { n++; cut = true; }
      if (cut) { shot = k === 'post' ? 'trackOut' : TV_ROT[kind][n % TV_ROT[kind].length]; shotT = 0; }
      return { shot, cut };
    },
    reset() { shot = ''; shotT = 0; kind = ''; n = 0; },
  };
}
/** 追いのカメラの置き場所：外ラチの外 24m・低め 3.6m・集団の 5m 先（真横より少し前から）。低く構えないと望遠で見下ろして背景が地面だけになる。 */
export const TRACK_CAM = { out: 24, ahead: 5, height: 3.6 };
/**
 * 集団の前後の長さ span を横に収める縦の画角（度）。three.js も Godot も画角は縦なので、横の幅は画面の縦横比 aspect で割って直す。
 * 馬の高さ（3.2m の半分）が切れない狭さで頭打ち。
 */
export function trackingFov(span, d, aspect = 1.6) {
  const h = Math.atan((span * 0.5 * 1.3) / Math.max(1, d));
  const v = Math.max(2 * Math.atan(Math.tan(h) / aspect), 2 * Math.atan(3.2 / Math.max(1, d)));
  return Math.min(34, Math.max(4, (v * 180) / Math.PI));
}

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
  let arcN = -1;   // コーナーのカットの通し番号（正面と高い所を交互に）

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
      if (shot === 'aerial') arcN++;
      placeAnchor(lead);
    }
    const w = track.width;
    const k6 = Math.min(6, ranked.length);
    const pm = start + ranked.slice(0, k6).reduce((a, x) => a + x.s, 0) / k6;
    const pl = start + lead.s;
    // 直線の追い（並走・向正面）とスタンド・4 角は、先頭の集団を収める（6 頭の平均の位置を見ると、大逃げで逃げ馬が画面の外か豆粒になった）
    const fr = trackingFrame(ranked);
    const gm = start + fr.mid;
    let e, l, fov = 32;
    switch (shot) {
      case 'gate': {
        const mid = (ranked.length - 1) * 1.05 / 2 + 1;
        e = at(start + 30, mid + 7, 3.2); l = at(start + 1, mid, 1.3); fov = 38;
        break;
      }
      case 'side': case 'infield': {
        // JRA の中継の追い：低い所から先頭の集団を望遠で真横に近く追う（向正面は内馬場の側から）
        ({ e, l, fov } = trackShot(shot === 'side' ? 'trackOut' : 'trackIn', track, at, fr));
        break;
      }
      // コーナーは前から馬群を正面で迎えるカットと、外の高い所から隊列を見るカットを交互に（上空 30m・40° の引きは馬が豆粒になった）
      case 'aerial': ({ e, l, fov } = trackShot(arcN % 2 ? 'high' : 'curveFront', track, at, fr)); break;
      case 'stand': case 'turn4': case 'post': {
        e = anchor;
        l = shot === 'post' ? at(pl + 2, lead.off, 1.2) : at(gm + 2, fr.off, 1.2);
        fov = fovFor(e, l, shot === 'post' ? 4.5 : Math.max(5, (fr.span * 0.65) / 1.6), 2, 40);
        break;
      }
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
    reset() { shot = ''; shotT = 0; eye.set = false; arcN = -1; },
  };
}
