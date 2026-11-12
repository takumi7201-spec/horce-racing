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
export function trackingFrame(ranked, tall = false) {
  // 縦長の画面（スマホ）は横に写る幅が狭く、前後 30m の集団を収めると馬が豆粒になった。逃げ馬と先行馬の 2〜3 頭（間 8m・先頭から 14m）に絞る
  const [gap, len, max] = tall ? [8, 14, 3] : [12, 30, 5];
  const lead = ranked[0];
  let tail = lead, offSum = lead.off, n = 1, lo = lead.off, hi = lead.off;
  for (const x of ranked.slice(1, max)) {
    if (tail.s - x.s > gap || lead.s - x.s > len) break;
    tail = x; offSum += x.off; n++; lo = Math.min(lo, x.off); hi = Math.max(hi, x.off);
  }
  const front = lead.s + 3, back = tail.s - 3.5;
  // width は集団の横の広がり（正面から撮るときに収める幅）。lo・hi は画角を決めるときに角の 4 点を画面へ投影するのに使う
  // fs・bs は先頭の鼻先と最後尾の位置（縦長の画面は余白を削ってこの間だけを収める）
  return { mid: (front + back) / 2, span: Math.max(13, front - back), off: offSum / n, width: Math.max(10, hi - lo + 6), lo: lo - 1.5, hi: hi + 1.5, fs: lead.s, bs: tail.s };
}

/**
 * 集団（前後 span・横 lo〜hi）を画面の横に収める縦の画角（度）。角の 4 点をカメラの向きへ投影して、いちばん外の角度で決める。
 * 前後の長さだけで測ると、斜めから撮るカットや縦長の画面で、逃げ馬と後ろの馬の両方が入らなかった（スマホの中継で逃げと先行が見にくい）。
 * 縦長の画面は縦の画角を 34° より広げてよい（横が狭いぶん縦に余る）。馬の高さ（3.2m）が切れない狭さで頭打ち。
 */
function fitFov(track, at, e, l, fr, aspect, extra = 1) {
  const dx = l.x - e.x, dy = l.y - e.y, dz = l.z - e.z;
  const dl = Math.hypot(dx, dy, dz) || 1;
  const fx = dx / dl, fy = dy / dl, fz = dz / dl;
  let rx = -fz, rz = fx;   // 右向き（水平）
  const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
  // 横長は前後を最低 13m 取る（1 頭だけでも周りの芝と前後の間合いが見える）。縦長は横に写る幅が狭いので、鼻先から最後尾の尾までだけ
  const tall = aspect < 0.9;
  const ends = tall && fr.fs != null ? [track.start + fr.fs + 1.5, track.start + fr.bs - 3] : [track.start + fr.mid - fr.span / 2, track.start + fr.mid + fr.span / 2];
  let h = 0;
  for (const ps of ends) {
    for (const off of [fr.lo ?? fr.off - 3, fr.hi ?? fr.off + 3]) {
      const p = at(ps, off, 1.2);
      const vx = p.x - e.x, vy = p.y - e.y, vz = p.z - e.z;
      const z = vx * fx + vy * fy + vz * fz;
      if (z < 1) continue;
      h = Math.max(h, Math.atan(Math.abs(vx * rx + vz * rz) / z));
    }
  }
  h = Math.min(1.3, h * 1.12 * extra);
  const v = Math.max(2 * Math.atan(Math.tan(h) / aspect), 2 * Math.atan(3.2 / dl));
  return Math.min(aspect < 1 ? 62 : 34, Math.max(4, (v * 180) / Math.PI));
}
/** スタンドの前（前庭の立ち見がラチの外 7〜30m に居る）。外の低いカメラは観客の中に入るので高く構える。 */
const atStand = (track, p) => {
  const pm = ((p % track.lap) + track.lap) % track.lap;
  return pm > track.lap - track.homeStraight * 0.85 || pm < 75;
};

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
  // 縦長の画面（スマホ）は横に写る幅が狭いので、真横の追いを斜め前からにして、逃げ馬と後ろの馬の前後の間を奥行きに畳む
  // （外ラチの外 14m・集団の 38m 先で、走る向きから約 32° の線になる。前後の長さは画面の横に半分ほどに縮む）
  const tall = aspect < 0.9;
  const side = tall ? fr.span / 2 + 38 : TRACK_CAM.ahead;
  const out = tall ? 14 : TRACK_CAM.out;
  let e, l;
  switch (name) {
    case 'trackIn': e = at(gm + side, -out, TRACK_CAM.height); l = at(gm, fr.off, 1.3); break;
    case 'front3q': e = at(gm + fr.span / 2 + 28, w + 9, 2.6); l = at(gm + 2, fr.off, 1.3); break;
    // コーナーでは 55m 先から見る線（弦）が内へ 4m ほど入り、内ラチが手前を横切って馬群を隠したので、外へ 5m 寄せて少し高く構える
    case 'curveFront': e = at(gm + fr.span / 2 + 55, fr.off + 5, 4.5); l = at(gm + 2, fr.off, 1.2); break;
    // 縦長は横が狭いので、後ろ寄りの高い所からでも引きすぎない（外 16m・10m の高さ）
    case 'high': e = tall ? at(gm - 12, w + 16, 10) : at(gm - 22, w + 30, 16); l = at(gm + 4, fr.off, 1); break;
    default: {
      const stand = atStand(track, gm + side);
      e = at(gm + side, w + out, stand ? 8 : TRACK_CAM.height); l = at(gm, fr.off, 1.3);
    }
  }
  return { e, l, fov: fitFov(track, at, e, l, fr, aspect, name === 'high' ? 1.25 : 1) };
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
    else if (shot === 'post') anchor = at(start + dist + 22, w + 4, 4.5);
    void lead;
  }

  const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  /** 2 点（馬とゴール板）を間に見て、両方が入る画角（縦）。馬が遠くても縦の半分 4.5m より寄せない */
  const frameTwo = (e, a, b, aspect) => {
    const l = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
    const ang = (p) => Math.acos(clamp(((p.x - e.x) * (l.x - e.x) + (p.y - e.y) * (l.y - e.y) + (p.z - e.z) * (l.z - e.z)) / (dist3(p, e) * dist3(l, e)), -1, 1));
    const h = Math.max(ang(a), ang(b)) * 1.25 + 0.02;
    const v = Math.max(2 * Math.atan(Math.tan(h) / Math.max(0.5, aspect)), 2 * Math.atan(4.5 / Math.max(1, dist3(e, a))));
    return { l, fov: clamp(deg(v), 4, 50) };
  };
  const fovFor = (e, l, half, lo, hi) => clamp(deg(2 * Math.atan(half / Math.max(1, dist3(e, l)))), lo, hi);

  /**
   * いまのカメラ。st は時刻 t の全馬の状態。返り値 { eye, look, fov, slow }（slow は再生の速さに掛ける）。
   * snap は寄せずに置く（止めた時刻へ飛んだとき）。
   */
  function camera(t, st, snap = false, aspect = 1.6) {
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
    const fr = trackingFrame(ranked, aspect < 0.9);
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
        ({ e, l, fov } = trackShot(shot === 'side' ? 'trackOut' : 'trackIn', track, at, fr, aspect));
        break;
      }
      // コーナーは前から馬群を正面で迎えるカットと、外の高い所から隊列を見るカットを交互に（上空 30m・40° の引きは馬が豆粒になった）
      case 'aerial': ({ e, l, fov } = trackShot(arcN % 2 ? 'high' : 'curveFront', track, at, fr, aspect)); break;
      case 'stand': case 'turn4': case 'post': {
        e = anchor;
        if (shot === 'post') {
          // ゴール前：決勝線の 22m 先、外ラチの外 4m（前庭の立ち見より内）から振り返り、先頭の馬と内のゴール板（高さ 4.4m）を一緒に収める。
          // 以前は決勝線の真横に置いて馬だけを見ていたので、板は画面の外（真横か上）で、ゴールの絵なのに板が写らなかった
          ({ l, fov } = frameTwo(e, at(pl, lead.off, 1.3), at(start + race.distance, -1.2, 4.4), aspect));
        } else {
          l = at(gm + 2, fr.off, 1.2);
          // スタンド前・4 角も先頭の集団を画面に投影して収める（縦長の画面で 16:10 の画角を広げると、遠い置きカメラの馬が豆粒になった）
          fov = fitFov(track, at, e, l, fr, aspect);
        }
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
    // ゴール前のスローはやめた（「ゴール前のスローはいらない」）。slow は 1 のまま返す（呼び出し側の形は変えない）
    slow = 1;
    // 追いのカットの画角は画面の縦横比で決めてある（fit）。ほかのカットは 16:10 の値で、画面側が縦長に合わせて広げる
    return { eye, look, fov: fovNow, slow, shot, fit: shot === 'side' || shot === 'infield' || shot === 'aerial' || shot === 'stand' || shot === 'turn4' || shot === 'post' };
  }

  return {
    events, pass1000, tWin, camera,
    reset() { shot = ''; shotT = 0; eye.set = false; arcN = -1; },
  };
}
