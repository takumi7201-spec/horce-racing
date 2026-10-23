// npm test。
// 「生成した世界と走らせたレースが現実の競馬の範囲に収まっているか」を機械的に見る。
// 数字をいじったらここを必ず通す。落ちたら PHYS か world.js の母集団設定を疑う。

import { makeRng } from '../src/core/rng.js';
import { createHorse, resetHorseIds, distanceAptitude, effectiveAbility } from '../src/sim/horse.js';
import { simulateRace, sampleLog, logDuration } from '../src/sim/race.js';
import {
  buildTrack, posToWorld, curvatureAt, gradeAt, allCourses, distancesOf,
  SURFACE, elevationAt, trackBounds,
} from '../src/sim/course.js';
import { createWorld, advanceWeek, weekRaces } from '../src/sim/world.js';
import { collectAncestors, inbreedings, sireLineRoot } from '../src/sim/pedigree.js';
import {
  yawForZForward, yawForXForward, zForwardOfYaw, xForwardOfYaw,
} from '../src/render3d/orient.js';
import { toJSON, fromJSON } from '../src/sim/save.js';
import * as GG from '../src/sim/game.js';
import { newGame, nextWeek, racesFor, enterRace, myHorses, horseView, evaluateMating, stallions, myStable } from '../src/sim/game.js';
import { ABILITIES, SEX, WEEKS_PER_YEAR } from '../src/sim/params.js';
import { sum, formatTime, byDesc } from '../src/core/util.js';

let fail = 0;
let pass = 0;
const section = (s) => console.log(`\n== ${s} ==`);
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  NG   ${name}  ${detail}`); }
}

// ---------------------------------------------------------------- コース幾何
section('コース幾何');
for (const c of allCourses()) {
  for (const surface of [SURFACE.TURF, SURFACE.DIRT]) {
    const dists = distancesOf(c.id, surface);
    for (const d of dists) {
      const tr = buildTrack(c.id, surface, d);
      if (tr.straightCourse) continue;
      // 周回の閉じ：セグメント長の合計が 1 周距離と一致する。
      const total = tr.segments.reduce((t, s) => t + s.len, 0);
      if (Math.abs(total - tr.lap) > 1) {
        check(`${c.name}${surface}${d} セグメント長の合計`, false, `${total.toFixed(1)} ≠ ${tr.lap}`);
      }
      // 発走位置：そこから distance 進むとゴール板（周回位置 0）に戻る。
      const endPos = (tr.start + d) % tr.lap;
      if (Math.min(endPos, tr.lap - endPos) > 1) {
        check(`${c.name}${surface}${d} 発走位置`, false, `ゴール位置 ${endPos.toFixed(1)}`);
      }
    }
  }
}
check('全コースの周回が閉じている', true);

// 走路の連続性：1m 刻みで座標が飛ばない。
{
  const tr = buildTrack('tokyo', SURFACE.TURF, 2400);
  let maxJump = 0;
  let prev = posToWorld(tr, 0);
  for (let p = 1; p < tr.lap; p += 1) {
    const w = posToWorld(tr, p);
    maxJump = Math.max(maxJump, Math.hypot(w.x - prev.x, w.z - prev.z));
    prev = w;
  }
  check('走路の座標が連続している（東京芝）', maxJump < 1.4, `最大 ${maxJump.toFixed(3)}m`);
  // ゴール板の前後でもつながる（周回のつなぎ目）。
  const a = posToWorld(tr, tr.lap - 0.5);
  const b = posToWorld(tr, 0.5);
  check('ゴール板のつなぎ目', Math.hypot(a.x - b.x, a.z - b.z) < 1.4);
  // 外を回ると内より長い。
  const inner = posToWorld(tr, 500, 0);
  const outer = posToWorld(tr, 500, 10);
  check('内ラチからの横位置が効いている', Math.hypot(inner.x - outer.x, inner.z - outer.z) > 9.5);
  // 高低差が公表値と大きく外れない。
  let lo = Infinity, hi = -Infinity;
  for (let p = 0; p < tr.lap; p += 10) {
    const e = elevationAt(tr, p);
    lo = Math.min(lo, e); hi = Math.max(hi, e);
  }
  check('東京芝の高低差', hi - lo > 1.0 && hi - lo < 6, `${(hi - lo).toFixed(2)}m（公表 2.7m）`);
  const nk = buildTrack('nakayama', SURFACE.TURF, 2000);
  let lo2 = Infinity, hi2 = -Infinity;
  for (let p = 0; p < nk.lap; p += 10) {
    const e = elevationAt(nk, p);
    lo2 = Math.min(lo2, e); hi2 = Math.max(hi2, e);
  }
  check('中山芝の高低差が東京より大きい', hi2 - lo2 > hi - lo, `${(hi2 - lo2).toFixed(2)}m（公表 5.3m）`);
  const bb = trackBounds(tr);
  check('走路の外周が妥当な広さ', bb.maxX - bb.minX > 400 && bb.maxX - bb.minX < 1400,
    `${(bb.maxX - bb.minX).toFixed(0)}m × ${(bb.maxZ - bb.minZ).toFixed(0)}m`);
}

// 3D の向き。馬が進行方向を向いているか（真横を向いたまま走ったことがある）。
{
  let worstHorse = 0, worstStand = 0;
  for (let i = 0; i <= 24; i++) {
    const h = (i / 24) * Math.PI * 2 - Math.PI;
    const want = { x: Math.cos(h), z: Math.sin(h) };
    // 馬はローカル +Z が前方。
    const f = zForwardOfYaw(yawForZForward(h));
    worstHorse = Math.max(worstHorse, Math.hypot(f.x - want.x, f.z - want.z));
    // スタンドの箱は長辺がローカル +X。
    const g = xForwardOfYaw(yawForXForward(h));
    worstStand = Math.max(worstStand, Math.hypot(g.x - want.x, g.z - want.z));
  }
  check('馬の正面が進行方向を向く（+Z 前方）', worstHorse < 1e-9, `ずれ ${worstHorse.toFixed(3)}`);
  check('スタンドの長辺が走路に沿う（+X 前方）', worstStand < 1e-9, `ずれ ${worstStand.toFixed(3)}`);
  // 走路の向きと一致しているか、実際のコースで確かめる。
  const tr = buildTrack('tokyo', SURFACE.TURF, 2400);
  let worst = 0;
  for (let p = 0; p < tr.lap; p += 37) {
    const a = posToWorld(tr, p, 5);
    const b = posToWorld(tr, p + 1, 5);
    const travel = Math.atan2(b.z - a.z, b.x - a.x);
    const f = zForwardOfYaw(yawForZForward(a.heading));
    const dot = Math.cos(travel) * f.x + Math.sin(travel) * f.z;
    worst = Math.max(worst, 1 - dot);   // 1 - cos(角度差)
  }
  check('コース一周のどこでも馬が前を向く（東京芝）', worst < 1e-3,
    `最大のずれ ${(Math.acos(1 - worst) * 180 / Math.PI).toFixed(1)} 度`);
}

// ---------------------------------------------------------------- レースの時計
section('レースの時計（適性・仕上がりの揃った 16 頭）');
function testField(rng, n, distance, surface, year, ability) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const h = createHorse(rng, { name: `T${i}`, sex: SEX.MALE, birthYear: year - 4 });
    for (const a of ABILITIES) {
      h.pot[a] = Math.min(1, Math.max(0.05, ability + rng.normal(0, 0.05)));
      h.cur[a] = h.pot[a];
    }
    h.growth = '普通'; h.dist = distance; h.distRange = 500;
    h.turf = surface === SURFACE.TURF ? 0.9 : 0.5;
    h.dirt = surface === SURFACE.DIRT ? 0.9 : 0.5;
    h.firm = 0.9; h.soft = 0.6; h.temper = 0.6; h.sound = 0.7; h.spirit = 0.6;
    h.cond = 0.7; h.fit = 0.85; h.fatigue = 0;
    h.style = [0.08, 0.2, 0.35, 0.45, 0.55, 0.62, 0.7, 0.8, 0.9][i % 9];
    h.styleFlex = 0.6;
    out.push(h);
  }
  return out;
}

const CASES = [
  ['nakayama', SURFACE.TURF, 1200, 65.5, 69.5],
  ['tokyo', SURFACE.TURF, 1600, 89.0, 93.5],
  ['tokyo', SURFACE.TURF, 2000, 114.0, 120.0],
  ['tokyo', SURFACE.TURF, 2400, 138.0, 147.0],
  ['kyoto', SURFACE.TURF, 3200, 186.0, 200.0],
  ['nakayama', SURFACE.TURF, 2500, 144.0, 156.0],
  ['niigata', SURFACE.TURF, 1000, 52.0, 57.0],
  ['tokyo', SURFACE.DIRT, 1600, 92.0, 100.0],
  ['chukyo', SURFACE.DIRT, 1800, 103.0, 113.0],
];
{
  const rng = makeRng(12345);
  resetHorseIds(1);
  for (const [course, surface, distance, lo, hi] of CASES) {
    const horses = testField(rng, 16, distance, surface, 2026, 0.62);
    const entries = horses.map((h, i) => ({
      horse: h, jockey: { id: i, name: `J${i}`, skill: 0.6, aggression: 0.5 },
      weight: 57, gate: i + 1, frame: Math.min(8, Math.floor(i / 2) + 1),
    }));
    const r = simulateRace({
      raceId: 'v', name: 'v', classId: 'g1', grade: 'GI', courseId: course,
      surface, distance, ground: '良', weather: '晴', year: 2026, week: 20, entries, prize: 1000,
    }, makeRng(777));
    check(`${r.courseName}${surface}${distance}m ${formatTime(r.winnerTime)}`,
      r.winnerTime >= lo && r.winnerTime <= hi, `期待 ${formatTime(lo)}〜${formatTime(hi)}`);
    // 上がり 3F が実際の範囲（32〜38 秒）に入る。
    check(`  上がり3F ${r.results[0].last3f.toFixed(1)}`,
      r.results[0].last3f > 31 && r.results[0].last3f < 38.5);
    // 全馬がゴールし、着順が時計順になっている。
    const times = r.results.map((x) => x.time);
    check('  着順が走破時計の順', times.every((t, i) => i === 0 || t >= times[i - 1] - 1e-6));
    check('  全馬完走', r.results.every((x) => !x.dnf));
  }
}

// 能力が高いほど速い。
{
  const times = [];
  for (const ab of [0.35, 0.5, 0.65, 0.8]) {
    const rng = makeRng(999);
    const horses = testField(rng, 14, 2000, SURFACE.TURF, 2026, ab);
    const entries = horses.map((h, i) => ({
      horse: h, jockey: { id: i, name: 'J', skill: 0.5, aggression: 0.5 },
      weight: 57, gate: i + 1, frame: 1,
    }));
    const r = simulateRace({
      raceId: 'v', name: 'v', classId: 'c1', courseId: 'tokyo', surface: SURFACE.TURF,
      distance: 2000, ground: '良', weather: '晴', year: 2026, week: 1, entries, prize: 0,
    }, makeRng(3), { record: false });
    times.push(r.winnerTime);
  }
  check(`能力順に速くなる（${times.map((t) => formatTime(t)).join(' > ')}）`,
    times.every((t, i) => i === 0 || t < times[i - 1]));
  check('未勝利級と GI 級の時計差が 3〜12%',
    (times[0] - times[3]) / times[3] > 0.03 && (times[0] - times[3]) / times[3] < 0.12,
    `${(((times[0] - times[3]) / times[3]) * 100).toFixed(1)}%`);
}

// 馬場が悪化すると時計が落ちる（芝）。
{
  const t = [];
  for (const ground of ['良', '稍重', '重', '不良']) {
    const rng = makeRng(555);
    const horses = testField(rng, 14, 2000, SURFACE.TURF, 2026, 0.6);
    const entries = horses.map((h, i) => ({
      horse: h, jockey: { id: i, name: 'J', skill: 0.5, aggression: 0.5 },
      weight: 57, gate: i + 1, frame: 1,
    }));
    t.push(simulateRace({
      raceId: 'v', name: 'v', classId: 'op', courseId: 'tokyo', surface: SURFACE.TURF,
      distance: 2000, ground, weather: '雨', year: 2026, week: 1, entries, prize: 0,
    }, makeRng(4), { record: false }).winnerTime);
  }
  check(`芝は馬場が悪いほど時計が掛かる（${t.map((x) => formatTime(x)).join(' < ')}）`,
    t[3] > t[0], `良 ${formatTime(t[0])} / 不良 ${formatTime(t[3])}`);
}

// 走行ログが 3D 再生に使える形で返る。
{
  const rng = makeRng(77);
  const horses = testField(rng, 12, 1600, SURFACE.TURF, 2026, 0.6);
  const entries = horses.map((h, i) => ({
    horse: h, jockey: { id: i, name: 'J', skill: 0.5, aggression: 0.5 },
    weight: 56, gate: i + 1, frame: 1,
  }));
  const r = simulateRace({
    raceId: 'v', name: 'v', classId: 'g2', courseId: 'tokyo', surface: SURFACE.TURF,
    distance: 1600, ground: '良', weather: '晴', year: 2026, week: 1, entries, prize: 0,
  }, makeRng(5));
  const log = r.log;
  check('走行ログが返る', !!log && log.frames > 50, `${log?.frames} フレーム`);
  check('ログの長さが走破時計以上', logDuration(log) >= r.winnerTime - 0.3,
    `${logDuration(log).toFixed(1)}s / ${r.winnerTime.toFixed(1)}s`);
  const s0 = sampleLog(log, 0);
  const s1 = sampleLog(log, 10);
  check('ログから全馬の位置が取れる', s0.length === 12 && s1.length === 12);
  check('10 秒で 100m 以上進んでいる', Math.max(...s1.map((x) => x.s)) > 100);
  check('横位置が走路幅の内側', s1.every((x) => x.off >= 0 && x.off <= log.width));
  const mono = [];
  for (let t = 0; t < logDuration(log); t += 1) mono.push(Math.max(...sampleLog(log, t).map((x) => x.s)));
  check('先頭の位置が単調増加', mono.every((v, i) => i === 0 || v >= mono[i - 1] - 0.01));
}

// ---------------------------------------------------------------- 世界
section('世界の生成');
const t0 = Date.now();
const game = newGame({ seed: 'verify', playerName: '検証 太郎', farmName: '検証ファーム' });
const w = game.world;
check(`生成時間 ${Date.now() - t0}ms`, Date.now() - t0 < 4000);
check(`総馬数 ${w.horses.size}`, w.horses.size > 2500 && w.horses.size < 9000);
check(`種牡馬 ${w.stallionPool.length} 頭`, w.stallionPool.length >= 30);
check(`繁殖牝馬 ${w.marePool.length} 頭`, w.marePool.length >= 200);
{
  const live3 = [...w.horses.values()].filter((h) => w.year - h.birthYear === 3);
  const fillRate = sum(live3, (h) => collectAncestors(w, h.id, 5).size) / (live3.length * 62);
  check(`5 代血統表の埋まり率 ${(fillRate * 100).toFixed(0)}%`, fillRate > 0.55);
  const ibAvg = sum(live3, (h) => (h.sireId && h.damId ? inbreedings(w, h.sireId, h.damId).length : 0)) / live3.length;
  check(`平均インブリード数 ${ibAvg.toFixed(2)}`, ibAvg > 1.0 && ibAvg < 8);
  const lines = new Set(live3.map((h) => sireLineRoot(w, h.id)));
  check(`父系の系統数 ${lines.size}`, lines.size >= 5);
}
{
  const live = [...w.horses.values()].filter((h) => !h.dead && !h.retired && w.year - h.birthYear >= 2);
  const pots = live.map((h) => sum(ABILITIES, (a) => h.pot[a]) / 5).sort((a, b) => b - a);
  check(`潜在能力 最大 ${pots[0].toFixed(3)} / 中央 ${pots[Math.floor(pots.length / 2)].toFixed(3)}`,
    pots[0] > 0.76 && pots[Math.floor(pots.length / 2)] > 0.45 && pots[Math.floor(pots.length / 2)] < 0.70);
  check(`現役 ${live.length} 頭`, live.length > 1000 && live.length < 4000);
}
check('プレイヤーに所有馬がいる', w.player.horses.length >= 3);
check('プレイヤーに繁殖牝馬がいる', w.player.broodmares.length >= 2);
check('番組表が週ごとに安定', weekRaces(w, 20)[0].raceId === weekRaces(w, 20)[0].raceId);

// ---------------------------------------------------------------- 実在の種牡馬
section('実在の種牡馬');
{
  const byName = (n) => [...w.horses.values()].find((h) => h.name === n);
  const kita = byName('キタサンブラック');
  const eq = byName('イクイノックス');
  const ss = byName('サンデーサイレンス');
  const st = stallions(game);
  check('2026 年の最高額はキタサンブラックとイクイノックスの 2,500 万',
    kita?.studFee === 2500 && eq?.studFee === 2500 && st[0].fee === 2500, `${kita?.studFee} / ${eq?.studFee} / 先頭 ${st[0]?.name}`);
  check('実在の種牡馬が名簿に並ぶ', st.filter((s) => s.real).length >= 30, `${st.filter((s) => s.real).length} 頭`);
  check('父系は系祖で止まる（キタサンブラックはサンデーサイレンス系）', sireLineRoot(w, kita.id) === ss.id);
  check('サンデーサイレンスは開始時点で故馬・名簿外', ss.dead && !w.stallionPool.includes(ss.id));
  // イクイノックスは父方・母方の 4 代目にヘイローを持つ（キタサンブラック × キングヘイロー牝馬）。
  const ib = inbreedings(w, kita.id, eq.damId).map((x) => `${x.name} ${x.label}`);
  check('実在の血統でインブリードが成立する（ヘイロー 4×4）', ib.includes('ヘイロー 4×4'), ib.join(', '));
  const live = [...w.horses.values()].filter((h) => !h.dead && !h.retired && w.year - h.birthYear >= 2 && !h.real);
  const realSired = live.filter((h) => w.horses.get(h.sireId)?.real).length / live.length;
  check(`現役の架空馬にも実在の父が入っている（${(realSired * 100).toFixed(0)}%）`, realSired > 0.08 && realSired < 0.6);
  const am = byName('アーモンドアイ');
  check('実在の繁殖牝馬が繁殖の名簿に入っている（アーモンドアイ）', w.marePool.includes(am.id) && !am.dead && am.ownerId !== 'player');
  check('名牝は毎年のように産む（アーモンドアイ 2022〜2026 年に 3 頭以上）', am.foals.length >= 3, `${am.foals.length} 頭`);
  const sz = byName('シーザリオ');
  check('亡くなった名牝は名簿にいない（シーザリオ）', sz.dead && !w.marePool.includes(sz.id) && sz.foals.length >= 5);
  check('最初の繁殖牝馬に実在の名牝は配られない', w.player.broodmares.every((id) => !w.horses.get(id).real));
  const fict = newGame({ seed: 'verify', realSires: false }).world;
  check('実在の種牡馬を使わない世界も作れる', ![...fict.horses.values()].some((h) => h.real));
}

// ---------------------------------------------------------------- 年間スケジュール
section('年間スケジュール');
{
  // 本体の世界を動かさないよう、別の世界で 1 年回す。
  const g2 = newGame({ seed: 'verify-calendar' });
  const w2 = g2.world;
  const W = (m, wk) => (m - 1) * 4 + wk;
  const until = (week) => { while (w2.week < week) nextWeek(g2); };
  const born = (y) => [...w2.horses.values()].filter((h) => h.birthYear === y).length;
  const pregnant = [...w2.horses.values()].filter((h) => h.pregnancy?.year === w2.year).length;
  check(`開始時は今年の仔がまだ生まれていない（受胎 ${pregnant} 頭）`, born(w2.year) === 0 && pregnant > 300);
  const mare = GG.myBroodmares(g2)[0];
  const sire = stallions(g2, { maxFee: 500 })[0];
  w2.player.money = 1e6;
  check('種付けは 5〜6 月以外は予約できない', !GG.bookMating(g2, mare.id, sire.id).ok);
  check('セールは時期の外では買えない', !GG.buyLot(g2, 'mare', GG.mareSale(g2)[0].id).ok);
  until(W(5, 1));
  check(`4 月に幼駒が生まれる（${born(w2.year)} 頭）`, born(w2.year) > 300 && born(w2.year) >= pregnant * 0.95);
  const foal = [...w2.horses.values()].find((h) => h.birthYear === w2.year);
  check(`生まれた仔は「母名の年」で呼ぶ（${foal.name}）`, foal.name.endsWith(`の${w2.year}`) && !!foal.regName);
  const book = GG.bookMating(g2, mare.id, sire.id);
  check('5 月は種付けを予約できる', book.ok, book.why);
  until(W(7, 1));
  const m2 = w2.horses.get(mare.id);
  check('6 月末に受胎が決まる（受胎か、不受胎なら返金）', !!m2.pregnancy || w2.news.some((n) => n.includes('不受胎')));
  until(W(8, 1));
  const lots = GG.foalSale(g2);
  check(`8 月の当歳セールに 0 歳馬が並ぶ（${lots.length} 頭）`, lots.length > 10 && lots.every((x) => x.age === 0));
  const bf = GG.buyLot(g2, 'foal', lots[lots.length - 1].id);
  check('当歳セールで買える', bf.ok && myStable(g2).young.some((h) => h.id === lots[lots.length - 1].id), bf.why);
  until(W(10, 1));
  const ms = GG.mareSale(g2);
  const top = ms.find((x) => x.real);
  const bm = GG.buyLot(g2, 'mare', top.id);
  check(`10 月の繁殖牝馬セールで実在の名牝を買える（${top.name} ${bm.price} 万）`, bm.ok && myStable(g2).mares.some((h) => h.id === top.id), bm.why);
  until(W(12, 3));
  const os = GG.overseasSale(g2);
  const bo = GG.buyOverseas(g2, os[0].key);
  check('12 月 3 週の海外トレーニングセールで外国の 1 歳馬を買える', bo.ok && bo.horse.foreign && GG.overseasSale(g2)[0].sold, bo.why);
  const os2 = GG.overseasSale(g2);
  const same = (a, b) => a.name === b.name && a.coat === b.coat && a.price === b.price && a.sireName === b.sireName;
  check(`買った後も一覧の馬が入れ替わらない（${os2[0].name}）`,
    same(os[0], os2[0]) && os.every((x, i) => x.coat === os2[i].coat && x.price === os2[i].price));
  check('庭先取引に 1 歳馬が並ぶ', GG.privateSale(g2).length > 0 && GG.privateSale(g2).every((x) => x.age === 1));
  const pv = GG.privateSale(g2);
  const pick = pv[pv.length - 1];
  const bp = GG.buyLot(g2, 'private', pick.id);
  const pv2 = GG.privateSale(g2);
  check('庭先取引で買った 1 歳馬が幼駒に入る', bp.ok && myStable(g2).young.some((h) => h.id === pick.id), bp.why);
  check('買っても一覧が入れ替わらず、買った馬は落札済みで残る',
    pv.map((x) => x.id).join() === pv2.map((x) => x.id).join() && pv2.find((x) => x.id === pick.id).sold
    && pv.every((x, i) => x.id === pick.id || x.price === pv2[i].price));
  until(W(12, 4));
  const cand = GG.entryCandidates(g2);
  check(`12 月 4 週に入厩・馬名登録の対象がいる（${cand.length} 頭）`, cand.length >= 1);
  const tr = GG.trainerChoices(g2)[0];
  GG.planTrainer(g2, cand[0].id, tr.id);
  check('カタカナ以外の馬名は登録できない', !GG.planName(g2, cand[0].id, 'abc').ok);
  const pn = GG.planName(g2, cand[0].id, 'ケンショウイチバン');
  const out = nextWeek(g2);
  const reg = w2.horses.get(cand[0].id);
  check('年末処理の要約が出る（表彰・引退・登録）', !!out.yearSummary && out.yearSummary.awards.length >= 1 && out.yearSummary.farm.money > 0);
  check(`年末に馬名が登録される（${reg.name}）`, pn.ok && reg.name === 'ケンショウイチバン' && reg.regName == null);
  check('年明けに決めた調教師の厩舎へ入る', reg.trainerId === tr.id);
}

// ---------------------------------------------------------------- まとめて週送り
section('まとめて週送り');
{
  const g3 = newGame({ seed: 'verify-skip' });
  const ts = GG.skipTargets(g3);
  const feb = ts.find((t) => t.label === '2月1週まで');
  const dec3 = ts.find((t) => t.label === '12月3週まで');
  const last = ts[ts.length - 1];
  check('行き先は各月の 1 週と行事の週（1 月 1 週から 2 月 1 週は 4 週）', feb?.weeks === 4 && dec3?.events.includes('海外トレーニングセール'));
  check('最後は年末処理まで（1 年ぶん 48 週）', last.label === '年末処理まで' && last.weeks === 48);
  check('行き先は週の順に並び、年をまたがない', ts.every((t, i) => i === 0 || t.weeks > ts[i - 1].weeks) && ts.every((t) => t.weeks <= 48));
}

// ---------------------------------------------------------------- 因子・系統・海外の名馬
section('因子・系統・海外の名馬');
{
  const g4 = newGame({ seed: 'verify-bloodline' });
  const w4 = g4.world;
  const byName = (n) => [...w4.horses.values()].find((h) => h.name === n || h.regName === n);
  const deep = byName('ディープインパクト');
  check(`名馬は因子を持つ（ディープインパクト：${GG.horseView(g4, deep.id).factors.join('・')}）`, deep.factors?.includes('burst'));
  const kizuna = byName('キズナ');
  check(`息子が何頭も種牡馬になった馬は系統を確立する（キズナは${GG.horseView(g4, kizuna.id).line}）`,
    deep.lineHead && GG.horseView(g4, kizuna.id).line === 'ディープインパクト系');
  const mare = GG.myBroodmares(g4)[0];
  const ev = GG.evaluateMating(g4, mare.id, kizuna.id);
  check(`配合の評価に因子と血の活力が出る（${ev.factors.list.map((x) => x.factor).join('・')} / ${ev.vigor.label}）`,
    ev.factors.list.some((x) => x.who.some((n) => n.startsWith('ディープインパクト'))) && !!ev.vigor.label);
  const abroad = stallions(g4).filter((s) => s.abroad);
  const frankel = abroad.find((s) => s.name === 'フランケル');
  check(`海外の種牡馬に種付けできる（${abroad.length} 頭、フランケル ${frankel?.fee} 万）`,
    !!frankel && frankel.fee >= 3000 && !abroad.some((s) => s.name === 'ガリレオ') && !w4.stallionPool.includes(frankel.id));
  w4.week = (5 - 1) * 4 + 1;
  w4.player.money = 1e6;
  const bk = GG.bookMating(g4, mare.id, frankel.id);
  check('海外種付けの予約ができる（種付料を払う）', bk.ok && bk.fee === frankel.fee && w4.player.money === 1e6 - frankel.fee, bk.why);

  // 2009 年に始めると、12 月 3 週の海外トレーニングセールに 1 歳のフランケルが出る。
  const g5 = newGame({ seed: 'verify-frankel', startYear: 2009 });
  const w5 = g5.world;
  w5.week = (12 - 1) * 4 + 3;
  w5.player.money = 1e6;
  const lot = GG.overseasSale(g5).find((x) => x.realName === 'フランケル');
  check(`海外セールに史実の 1 歳馬が出る（${lot?.name}、${lot?.price} 万）`, !!lot && lot.name === 'カインドの2008');
  const bf = GG.buyOverseas(g5, lot.key);
  const fr = bf.horse;
  check('買ったフランケルは日本で走る自分の馬になる',
    bf.ok && fr.ownerId === 'player' && !fr.retired && fr.regName === 'フランケル'
    && w5.horses.get(fr.sireId)?.name === 'ガリレオ' && myStable(g5).young.some((h) => h.id === fr.id), bf.why);
  check('落札後も一覧に落札済みで残る', GG.overseasSale(g5).some((x) => x.realName === 'フランケル' && x.sold));

  // 海外の名牝。2012 年の海外セールにゼニヤッタが繁殖牝馬として出る。
  const g6 = newGame({ seed: 'verify-zenyatta', startYear: 2012 });
  const w6 = g6.world;
  w6.week = (12 - 1) * 4 + 3;
  w6.player.money = 1e6;
  const ms = GG.overseasSale(g6).filter((x) => x.realMare);
  const zen = ms.find((x) => x.name === 'ゼニヤッタ');
  check(`海外セールに海外の名牝が出る（${ms.map((x) => x.name).join('・')}）`,
    !!zen && !zen.yearling && ms.some((x) => x.name === 'カインド' && x.produce === 'フランケル'));
  check('史実の仔がまだ生まれていない名牝は出ない（2012 年のアーバンシーは没後、エネイブルは未出生）',
    !ms.some((x) => ['アーバンシー', 'エネイブル', 'ミエスク'].includes(x.name)));
  const bz = GG.buyOverseas(g6, zen.key);
  check('買った名牝は自分の繁殖牝馬になる',
    bz.ok && GG.myBroodmares(g6).some((m) => m.id === bz.horse.id) && w6.marePool.includes(bz.horse.id)
    && GG.overseasSale(g6).some((x) => x.key === zen.key && x.sold), bz.why);
}

// ---------------------------------------------------------------- 開始年
section('開始年（史実の名馬）');
{
  const g75 = newGame({ seed: 'verify-1975', startYear: 1975 });
  const w75 = g75.world;
  const byName = (w, n) => [...w.horses.values()].find((h) => h.name === n || h.regName === n);
  const reals = [...w75.horses.values()].filter((h) => h.real);
  check('1975 年開始：開始年以降に生まれる実在馬はまだ居ない', reals.every((h) => h.birthYear < 1975));
  check('まだ行われていないレースが戦績に無い', reals.every((h) => h.record.every((r) => r.year < 1975)));
  const pool = new Set(w75.stallionPool);
  const tesco = byName(w75, 'テスコボーイ');
  check(`テスコボーイが名簿に居て種付料は史実の額（${tesco?.studFee} 万）`, pool.has(tesco?.id) && tesco.studFee === 2000);
  check('サンデーサイレンスはまだ輸入されていない', !byName(w75, 'サンデーサイレンス'));
  const tb = byName(w75, 'トウショウボーイ');
  check('トウショウボーイが 2 歳の競走馬として居る', !!tb && !tb.retired && tb.birthYear === 1973 && !!tb.ownerId);
  check('後の名馬の名前は予約されている', w75.nameSet.has('ディープインパクト'));
  check('昭和の種牡馬が名簿に並ぶ（パーソロン・ハイセイコー）',
    pool.has(byName(w75, 'パーソロン')?.id) && pool.has(byName(w75, 'ハイセイコー')?.id));

  // 1990 年に始めて 1991 年の夏まで進める。サンデーサイレンスが輸入され、ナリタブライアンが生まれる。
  const g90 = newGame({ seed: 'verify-1990', startYear: 1990 });
  const w90 = g90.world;
  check('1990 年開始：ブライアンズタイムが供用中', w90.stallionPool.includes(byName(w90, 'ブライアンズタイム')?.id));
  while (w90.year < 1991 || w90.week < (8 - 1) * 4 + 1) nextWeek(g90);
  const ss = byName(w90, 'サンデーサイレンス');
  check(`1991 年にサンデーサイレンスが輸入される（種付料 ${ss?.studFee} 万）`,
    !!ss && w90.stallionPool.includes(ss.id) && ss.studFee === 2500);
  const nb = byName(w90, 'ナリタブライアン');
  const nbSire = nb && w90.horses.get(nb.sireId)?.name;
  const nbDam = nb && w90.horses.get(nb.damId)?.name;
  check(`1991 年 4 月にナリタブライアンが生まれる（${nb?.name}、父 ${nbSire}・母 ${nbDam}）`,
    !!nb && nb.birthYear === 1991 && nbSire === 'ブライアンズタイム' && nbDam === 'パシフィカス' && nb.name === 'パシフィカスの1991');
  const lot = GG.foalSale(g90).find((x) => x.realName === 'ナリタブライアン');
  check('当歳セールに史実の名馬が上場される', !!lot);
  const back = fromJSON(toJSON(g90));
  check('セーブ往復で実在馬の状態が保たれる',
    back.world.real?.ids['ナリタブライアン'] === nb?.id && back.world.real.entered.includes('サンデーサイレンス'));
}

// ---------------------------------------------------------------- ゲーム操作
section('ゲーム操作');
{
  const hs = myHorses(game);
  const v = horseView(game, hs[0].id);
  check('馬の詳細が取れる', !!v && !!v.ranks.speed && v.age >= 2);
  const races = racesFor(game, hs[0].id);
  check(`出走できるレースがある（${races.length} 件）`, races.length > 0);
  if (races.length) {
    hs[0].stable = 'stable'; hs[0].fit = 0.8; hs[0].fatigue = 0.1;
    const r = enterRace(game, hs[0].id, races[0].raceId);
    check('出走登録ができる', r.ok, r.why);
  }
  const mares = w.player.broodmares;
  const st = stallions(game, { maxFee: 100000 });
  check(`種牡馬一覧が取れる（${st.length} 頭）`, st.length > 10);
  const ev = evaluateMating(game, mares[0], st[0].id);
  check('配合評価が出る', !!ev && ev.stars >= 1 && ev.stars <= 5,
    `★${ev?.stars} ${ev?.comment}`);
}

// ---------------------------------------------------------------- 2 年回す
section('2 年の経過');
{
  let races = 0, starts = 0, g1 = 0;
  const giTimes = [];
  const allGaps = [];
  const top3Gaps = [];
  for (let y = 0; y < 2; y++) {
    for (let i = 0; i < WEEKS_PER_YEAR; i++) {
      const { results } = advanceWeek(w);
      races += results.length;
      starts += sum(results, (r) => r.results.length);
      for (const r of results) {
        allGaps.push(r.results[r.results.length - 1].marginTotal);
        if (r.results.length >= 3) top3Gaps.push(r.results[2].marginTotal);
        if (r.grade !== 'GI') continue;
        g1++;
        giTimes.push({ name: r.name, d: r.distance, t: r.winnerTime, field: r.results.length, ground: r.ground });
      }
    }
  }
  check(`年間レース数 ${Math.round(races / 2)}`, races / 2 > 500);
  check(`年間出走数 ${Math.round(starts / 2)}`, starts / 2 > 6000);
  check(`GI ${g1 / 2} 回／年`, g1 / 2 >= 22, '24 戦すべて成立すべき');
  const smallField = giTimes.filter((x) => x.field < 8);
  check(`GI の頭数不足 ${smallField.length} 件`, smallField.length <= 4,
    smallField.map((x) => `${x.name}:${x.field}`).join(' '));
  // GI の時計が現実の範囲に収まっているか（良馬場のみ）。
  const band = { 1200: [64, 76], 1600: [88, 106], 1800: [104, 118], 2000: [112, 130], 2200: [124, 145], 2400: [136, 160], 2500: [142, 166], 3000: [175, 205], 3200: [188, 225] };
  const bad = giTimes.filter((x) => x.ground === '良' && band[x.d] && (x.t < band[x.d][0] || x.t > band[x.d][1]));
  check(`GI の勝ち時計が範囲内（外れ ${bad.length}/${giTimes.length}）`, bad.length <= 3,
    bad.map((x) => `${x.name} ${x.d}m ${formatTime(x.t)}`).join(' / '));
  // 着差。実際の競馬では、最下位でも勝ち馬から 3〜10 秒しか離れない。
  // ここが 20 秒を超えるときは、たいてい馬群の進路判定か能力→速度の写像が壊れている
  // （ゲート直後の詰まりが連鎖して最後方が 25 秒置き去りにされたことがある）。
  const avgGap = sum(allGaps) / allGaps.length;
  check(`最下位との着差 平均 ${avgGap.toFixed(1)} 秒`, avgGap < 13, '20 秒を超えたら進路判定を疑う');
  const wide = allGaps.filter((g) => g > 25).length;
  check(`着差 25 秒超のレース ${wide} / ${allGaps.length}`, wide / allGaps.length < 0.02);
  const avg3 = sum(top3Gaps) / top3Gaps.length;
  check(`3 着までの着差 平均 ${avg3.toFixed(2)} 秒`, avg3 > 0.3 && avg3 < 3.0);

  const live = [...w.horses.values()].filter((h) => !h.dead && !h.retired && w.year - h.birthYear >= 2);
  check(`2 年後の現役 ${live.length} 頭`, live.length > 1000 && live.length < 4500);
  const pots = live.map((h) => sum(ABILITIES, (a) => h.pot[a]) / 5).sort((a, b) => b - a);
  check(`2 年後の潜在 中央 ${pots[Math.floor(pots.length / 2)].toFixed(3)}（インフレしていない）`,
    pots[Math.floor(pots.length / 2)] > 0.42 && pots[Math.floor(pots.length / 2)] < 0.72);
  check(`年度代表馬が選ばれている（${w.awards.map((a) => a.name).join(', ')}）`, w.awards.length >= 2);

  // 種牡馬の経済。産駒を覚えていないと種付料が現役成績だけで決まり、
  // 「走る産駒を出した翌年に跳ね上がる」という軸がまるごと死ぬ
  // （実際に死んでいて、馬の詳細に産駒が出ないことで気づいた）。
  const sires = w.stallionPool.map((id) => w.horses.get(id)).filter(Boolean);
  const withFoals = sires.filter((s2) => (s2.foals ?? []).length > 0).length;
  check(`種牡馬が産駒を覚えている（${withFoals}/${sires.length} 頭）`, withFoals > sires.length * 0.3);
  const fees = sires.map((s2) => s2.studFee ?? 0).sort((a, b) => b - a);
  check(`種付料 最高 ${fees[0]} 万 / 中央 ${fees[fees.length >> 1]} 万`,
    fees[0] > fees[fees.length >> 1] * 1.8, '産駒成績で差が付いていない');
  check(`手の届く種牡馬がいる（1000 万以下 ${fees.filter((f) => f <= 1000).length} 頭）`,
    fees.filter((f) => f <= 1000).length >= 10, '新規の馬主が配合できる相手がいない');
  check(`種牡馬が ${sires.length} 頭（繁殖牝馬 ${w.marePool.length} 頭）`,
    sires.length <= 220 && sires.length < w.marePool.length,
    '種牡馬が多すぎると大半が一度も種付けしない');
  check(`重賞の記録が残っている（${w.history.length} 件）`, w.history.length > 100);
}

// ---------------------------------------------------------------- セーブ
section('セーブとロード');
{
  const json = toJSON(game);
  const back = fromJSON(json);
  check(`セーブサイズ ${(json.length / 1024 / 1024).toFixed(2)} MB`, json.length < 40 * 1024 * 1024);
  check('頭数が保たれる', back.world.horses.size === w.horses.size);
  check('年週が保たれる', back.world.year === w.year && back.world.week === w.week);
  check('プレイヤーの資金が保たれる', back.world.player.money === w.player.money);
  check('血統がつながっている', (() => {
    const h = [...back.world.horses.values()].find((x) => x.sireId != null);
    return back.world.horses.has(h.sireId);
  })());
  // 乱数の状態も復元されるので、以後の 1 週は同じ結果になる。
  const a = advanceWeek(w).results.map((r) => r.results[0]?.horseId).join(',');
  const b = advanceWeek(back.world).results.map((r) => r.results[0]?.horseId).join(',');
  check('ロード後の 1 週が同じ結果になる', a === b);
}

console.log(`\n合計 ${pass} ok / ${fail} NG`);
process.exit(fail === 0 ? 0 : 1);
