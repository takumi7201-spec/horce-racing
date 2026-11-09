// npm test。
// 「生成した世界と走らせたレースが現実の競馬の範囲に収まっているか」を機械的に見る。
// 数字をいじったらここを必ず通す。落ちたら PHYS か world.js の母集団設定を疑う。

import { makeRng } from '../src/core/rng.js';
import { createHorse, resetHorseIds, peekHorseId, distanceAptitude, effectiveAbility } from '../src/sim/horse.js';
import { simulateRace, sampleLog, logDuration } from '../src/sim/race.js';
import {
  buildTrack, posToWorld, curvatureAt, gradeAt, allCourses, distancesOf,
  SURFACE, elevationAt, trackBounds,
} from '../src/sim/course.js';
import { REAL_HORSES } from '../src/sim/data/real-horses.js';
import { createWorld, advanceWeek, weekRaces } from '../src/sim/world.js';
import * as WW from '../src/sim/world.js';
import { collectAncestors, inbreedings, sireLineRoot, bloodDominance } from '../src/sim/pedigree.js';
import {
  yawForZForward, yawForXForward, zForwardOfYaw, xForwardOfYaw,
} from '../src/render3d/orient.js';
import { toJSON, fromJSON } from '../src/sim/save.js';
import * as GG from '../src/sim/game.js';
import { newGame, nextWeek, racesFor, enterRace, myHorses, horseView, evaluateMating, stallions, myStable } from '../src/sim/game.js';
import { ABILITIES, SEX, WEEKS_PER_YEAR } from '../src/sim/params.js';
import { healNursery, nurseryReach } from '../src/sim/training.js';
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

/**
 * 検証の途中で別の世界を作るための包み。
 *
 * 馬の id は世界ごとではなくモジュールの通し番号で、createWorld が 1 に戻す。
 * 素のまま別の世界を作ると、そのあとに本編の世界で生まれた仔が既にいる馬と同じ id を取り、
 * world.horses の中身を上書きしてしまう。実在馬を増やして本編の世界が別の世界より
 * 大きくなった途端にこれが起きて、3 歳世代が 376 → 28 頭に消え、番組が年 848 → 577 に減り、
 * クラシックが不成立になった。両方の世界の最大 id より先へ戻しておけば、どちらも壊れない。
 */
function sideGame(opts) {
  const keep = peekHorseId();
  const g = newGame(opts);
  resetHorseIds(Math.max(keep, peekHorseId()));
  return g;
}
const w = game.world;
check(`生成時間 ${Date.now() - t0}ms`, Date.now() - t0 < 4000);
// 上限は世界が膨らみ過ぎないための見張り。記事の無い親を名前だけの祖先として表に入れた
// （--stubs、約 2,200 頭）ので 9,000 から 12,000 に、Wikidata から親を補った（約 1,800 頭の祖先）ので
// 14,000 に、史実馬の一覧から親を補った（約 2,600 頭の祖先）ので 16,000 に上げた。
// 史実馬の一覧の競走馬をすべて足した（約 1 万頭）ので 30,000 に上げた。生成時間とセーブの大きさは別に見ている。
check(`総馬数 ${w.horses.size}`, w.horses.size > 2500 && w.horses.size < 30000);
check(`種牡馬 ${w.stallionPool.length} 頭`, w.stallionPool.length >= 30);
check(`繁殖牝馬 ${w.marePool.length} 頭`, w.marePool.length >= 200);
{
  const live3 = [...w.horses.values()].filter((h) => w.year - h.birthYear === 3);
  const fillRate = sum(live3, (h) => collectAncestors(w, h.id, 5).size) / (live3.length * 62);
  // 取り込んだ実在馬は母や母の父の記録が無いことが多く、血統が途中で切れる。
  // 種牡馬にしたぶん、架空の馬だけの世界（56%）より 3〜6 ポイント下がる。
  check(`5 代血統表の埋まり率 ${(fillRate * 100).toFixed(0)}%`, fillRate > 0.50);
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
  // 受胎は乱数（conceives）なので 5 年で 2〜4 頭に散る（8 シードで平均 3.1）。世界の馬が増えて乱数の流れが
  // ずれると、固定シードのこの 1 本が 3 頭を割る。2 頭未満なら名簿に入っていない・種付けされていないと疑う。
  check('名牝は毎年のように産む（アーモンドアイ 2022〜2026 年に 2 頭以上）', am.foals.length >= 2, `${am.foals.length} 頭`);
  const sz = byName('シーザリオ');
  check('亡くなった名牝は名簿にいない（シーザリオ）', sz.dead && !w.marePool.includes(sz.id) && sz.foals.length >= 5);
  check('最初の繁殖牝馬に実在の名牝は配られない', w.player.broodmares.every((id) => !w.horses.get(id).real));
  const fict = sideGame({ seed: 'verify', realSires: false }).world;
  check('実在の種牡馬を使わない世界も作れる', ![...fict.horses.values()].some((h) => h.real));
}

// ---------------------------------------------------------------- 年間スケジュール
section('年間スケジュール');
{
  // 本体の世界を動かさないよう、別の世界で 1 年回す。
  const g2 = sideGame({ seed: 'verify-calendar' });
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
  // 年末の引退で決めた調教師が辞めていたら、ほかの厩舎へ回る（仕様）。
  check('年明けに決めた調教師の厩舎へ入る', reg.trainerId === tr.id || w2.trainers.get(tr.id)?.retired, `trainer ${reg.trainerId} / ${tr.id} stable ${reg.stable} owner ${reg.ownerId} dead ${reg.dead}`);
}

// ---------------------------------------------------------------- まとめて週送り
section('まとめて週送り');
{
  const g3 = sideGame({ seed: 'verify-skip' });
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
  const g4 = sideGame({ seed: 'verify-bloodline' });
  const w4 = g4.world;
  const byName = (n) => [...w4.horses.values()].find((h) => h.name === n || h.regName === n);
  const deep = byName('ディープインパクト');
  check(`名馬は因子を持つ（ディープインパクト：${GG.horseView(g4, deep.id).factors.join('・')}）`, deep.factors?.includes('burst'));
  const kizuna = byName('キズナ');
  check(`息子が何頭も種牡馬になった馬は系統を確立する（キズナは${GG.horseView(g4, kizuna.id).line}）`,
    deep.lineHead && ['ディープインパクト系', 'キズナ系'].includes(GG.horseView(g4, kizuna.id).line));
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
  // 海外の種牡馬は名声が要る。足りないうちは断られ、届けば付けられる。
  g4.world.player.fame = 0;
  const denied = GG.bookMating(g4, mare.id, frankel.id);
  check('名声が足りないと海外の種牡馬に種付けできない', !denied.ok && /名声/.test(denied.why ?? ''), denied.why);
  g4.world.player.fame = 60;
  const bk = GG.bookMating(g4, mare.id, frankel.id);
  check('海外種付けの予約ができる（種付料を払う）', bk.ok && bk.fee === frankel.fee && w4.player.money === 1e6 - frankel.fee, bk.why);

  // 2009 年に始めると、12 月 3 週の海外トレーニングセールに 1 歳のフランケルが出る。
  const g5 = sideGame({ seed: 'verify-frankel', startYear: 2009 });
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
  const g6 = sideGame({ seed: 'verify-zenyatta', startYear: 2012 });
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

  // 日本へ輸入された海外の名馬。1 歳の年は海外セールに出て、買われなければ史実の年に輸入される。
  const g7 = sideGame({ seed: 'verify-lammtarra', startYear: 1993 });
  g7.world.week = (12 - 1) * 4 + 3;
  check('1993 年の海外セールに 1 歳のラムタラが出る', GG.overseasSale(g7).some((x) => x.realName === 'ラムタラ'));
  const g8 = sideGame({ seed: 'verify-lammtarra', startYear: 1995 });
  g8.world.week = 48;
  nextWeek(g8);
  const lam = [...g8.world.horses.values()].find((h) => h.name === 'ラムタラ');
  check(`1996 年にラムタラが種牡馬として輸入される（${lam?.studFee} 万）`,
    !!lam && g8.world.stallionPool.includes(lam.id) && lam.studFee === 3000);
  // 1975〜1980 年代の海外の名馬。1975 年の海外セールに 1 歳のアレッジドが出て、1980 年にはトロイに種付けできる。
  const g75s = sideGame({ seed: 'verify-1975-overseas', startYear: 1975 });
  g75s.world.week = (12 - 1) * 4 + 3;
  const l75 = GG.overseasSale(g75s).filter((x) => x.realName).map((x) => x.realName);
  check(`1975 年の海外セールに 1 歳の名馬が出る（${l75.join('・')}）`, l75.includes('アレッジド') && l75.includes('ザミンストレル'));
  const g80 = sideGame({ seed: 'verify-1980', startYear: 1980 });
  const ab80 = stallions(g80).filter((s) => s.abroad).map((s) => s.name);
  check(`1980 年の海外種付けに当時の名馬が並ぶ（${ab80.length} 頭）`,
    ['トロイ', 'アレッジド', 'アリダー', 'ザミンストレル'].every((n) => ab80.includes(n)) && !ab80.includes('シャーガー'));
  // 令和の海外の名馬。2026 年の海外種付けにシティオブトロイ・オーギュストロダン、海外セールに名牝ラヴ・スノーフォール。
  const g4os = sideGame({ seed: 'verify-2026-overseas' });
  g4os.world.week = (12 - 1) * 4 + 3;
  const m26 = GG.overseasSale(g4os).filter((x) => x.realMare).map((x) => x.name);
  check(`2026 年の海外セールに令和の名牝が出る（${m26.length} 頭）`, ['ラヴ', 'スノーフォール', 'アルピニスタ'].every((n) => m26.includes(n)));
  const ab26 = stallions(g4).filter((s) => s.abroad).map((s) => s.name);
  check(`2026 年の海外種付けに近年の名馬が並ぶ（${ab26.length} 頭）`,
    ['フライトライン', 'バーイード', 'キングマン', 'シティオブトロイ', 'オーギュストロダン', 'エースインパクト'].every((n) => ab26.includes(n)));
}

// ---------------------------------------------------------------- 開始年
section('開始年（史実の名馬）');
{
  const g75 = sideGame({ seed: 'verify-1975', startYear: 1975 });
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
  check('昭和の種牡馬が名簿に並ぶ（パーソロン・ハイセイコー・シンザン）',
    pool.has(byName(w75, 'パーソロン')?.id) && pool.has(byName(w75, 'ハイセイコー')?.id) && pool.has(byName(w75, 'シンザン')?.id));
  const gabby = byName(w75, 'テスコガビー');
  check('1975 年の 3 歳世代に史実の名馬が居る（テスコガビー・カブラヤオー）',
    !!gabby && !gabby.retired && !!byName(w75, 'カブラヤオー') && !byName(w75, 'カブラヤオー').retired);
  // 1990 年代の名馬。1994 年に始めると、その年 4 月に生まれる 4 頭の母が受胎している。
  const g94 = sideGame({ seed: 'verify-1994', startYear: 1994 });
  const due94 = [...g94.world.horses.values()].map((h) => h.pregnancy?.real).filter(Boolean);
  check(`1994 年開始で、その年に生まれる名馬の母が受胎している（${due94.join('・')}）`,
    ['シーキングザパール', 'サニーブライアン', 'メジロブライト', 'シルクジャスティス'].every((n) => due94.includes(n)));
  const hishi = [...g94.world.horses.values()].find((h) => h.name === 'ヒシアマゾン');
  check('1994 年開始でヒシアマゾンが 3 歳の現役', !!hishi && !hishi.retired && hishi.birthYear === 1991);
  // 2000 年代の名馬。2005 年に始めると、カネヒキリ・アドマイヤムーンが現役で、
  // その年 4 月に生まれるディープスカイ・エスポワールシチーの母が受胎している。
  const g05 = sideGame({ seed: 'verify-2005', startYear: 2005 });
  const live05 = (n) => [...g05.world.horses.values()].find((h) => h.name === n && !h.retired);
  const due05 = [...g05.world.horses.values()].map((h) => h.pregnancy?.real).filter(Boolean);
  check(`2005 年開始で 2000 年代の名馬が現役・受胎中（${due05.join('・')}）`,
    !!live05('カネヒキリ') && !!live05('アドマイヤムーン') && ['ディープスカイ', 'エスポワールシチー'].every((n) => due05.includes(n)));
  // 令和の名馬。2020 年に始めると、リオンディーズ・アドマイヤマーズが種牡馬で、
  // その年に生まれるタスティエーラ・ソールオリエンス・ドゥレッツァの母が受胎している。
  const g20 = sideGame({ seed: 'verify-2020', startYear: 2020 });
  const pool20 = new Set(g20.world.stallionPool.map((id) => g20.world.horses.get(id)?.name));
  const due20 = [...g20.world.horses.values()].map((h) => h.pregnancy?.real).filter(Boolean);
  check(`2020 年開始で令和の名馬が種牡馬・受胎中（${due20.join('・')}）`,
    ['リオンディーズ', 'アドマイヤマーズ', 'ハービンジャー'].every((n) => pool20.has(n))
    && ['タスティエーラ', 'ソールオリエンス', 'ドゥレッツァ'].every((n) => due20.includes(n)));
  // 取り込んだ勝ち馬の種牡馬入り。1994 年に始めて 1996 年の年明けまで進めると、
  // 1990 年生まれの GI 馬サクラチトセオーが名簿に入っている（供用年を導いた馬）。
  while (g94.world.year < 1996) nextWeek(g94);
  const chitose = [...g94.world.horses.values()].find((h) => h.name === 'サクラチトセオー');
  check(`取り込んだ GI 馬が種牡馬入りする（サクラチトセオー：${chitose?.studFee} 万）`,
    !!chitose && chitose.studDerived === true && g94.world.real.entered.includes('サクラチトセオー')
    && (chitose.stallion || g94.world.stallionPool.every((id) => id !== chitose.id)));
  const derived26 = [...game.world.horses.values()].filter((h) => h.studDerived && h.stallion && !h.dead);
  check(`2026 年の名簿に導いた種牡馬が並ぶ（${derived26.length} 頭、名簿 ${game.world.stallionPool.length} 頭）`,
    derived26.length >= 25 && game.world.stallionPool.length <= 220);
  const hoyo = [...w75.horses.values()].find((h) => h.pregnancy?.real === 'ホウヨウボーイ');
  check('1975 年 4 月に生まれる名馬は、開始時に母が受胎している（ホウヨウボーイ）', !!hoyo);

  // 1990 年に始めて 1991 年の夏まで進める。サンデーサイレンスが輸入され、ナリタブライアンが生まれる。
  const g90 = sideGame({ seed: 'verify-1990', startYear: 1990 });
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
  const book = GG.realBook(g90);
  const nbBook = book.find((x) => x.name === 'ナリタブライアン');
  const ssBook = book.find((x) => x.name === 'サンデーサイレンス');
  const deep = book.find((x) => x.name === 'ディープインパクト');
  // 血統をつなぐだけの母（能力を持たない祖先）は名鑑に載らない。史実馬の一覧に載っている馬は能力を持つので、
  // パシフィカス（海外の競走馬として一覧に載っている）は載る。
  const pureDam = REAL_HORSES.find((d) => d.bg && d.lvl == null && d.s === '牝' && d.b < 1985 && d.b > 1960);
  check(`史実馬名鑑が年代ごとに今の姿を出す（ナリタブライアン：${nbBook?.status.text}、ディープ：${deep?.status.text}）`,
    nbBook?.decade === 1990 && nbBook.status.key === 'here' && nbBook.id === nb?.id
    && ssBook?.status.text.startsWith('種牡馬') && deep?.status.text === '2002年に誕生'
    && !book.some((x) => x.name === pureDam?.n));
  check('当歳セールに史実の名馬が上場される', !!lot);
  // 世界に居ない馬（ディープインパクト：2002 年に誕生）も、名鑑から馬の詳細で見られる。世界は変わらない。
  {
    const n0 = g90.world.horses.size, id0 = peekHorseId();
    const pv = GG.realPreview(g90, 'ディープインパクト');
    const v = pv && GG.horseView(pv.game, pv.id);
    const ped = pv && GG.pedigree(pv.game, pv.id, 4);
    check(`世界に居ない実在馬を馬の詳細で見られる（${v?.name}：${v?.preview}、父 ${v?.sire}・母 ${v?.dam}）`,
      !!v && v.preview === '2002年に誕生' && v.sire === 'サンデーサイレンス' && v.horse.damId === g90.world.real.ids['ウインドインハーヘア']   // 1991 年に生まれていれば、まだ仮の名
      && !!ped?.dam?.sire && v.record.length > 0 && g90.world.horses.size === n0 && peekHorseId() === id0
      && !g90.world.horses.has(pv.id));
  }
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
  const usRaces = [];
  const allGaps = [];
  const top3Gaps = [];
  // 育成（落とし穴 88）：いまの 1 歳が 1 年で育ち、来年の新馬で潜在の 8 割以上でデビューする。
  // 以前は 2 歳になるまで生まれたときの 2 割のままで、新馬のデビューが潜在の 5 割弱だった。
  const devRatio = (h) => sum(ABILITIES, (a) => h.cur[a]) / sum(ABILITIES, (a) => h.pot[a]);
  const yearlings = [...w.horses.values()].filter((h) => !h.dead && w.year - h.birthYear === 1);
  const yearling0 = sum(yearlings, devRatio) / yearlings.length;
  let yearling1 = 0, yearlingRanks = null;
  const debutRatios = [];
  for (let y = 0; y < 2; y++) {
    for (let i = 0; i < WEEKS_PER_YEAR; i++) {
      if (y === 0 && i === WEEKS_PER_YEAR - 1) {
        const yv = horseView(game, yearlings.find((h) => !h.dead && w.horses.has(h.id))?.id);
        yearlingRanks = yv ? Object.values(yv.ranks) : null;
      }
      if (y === 1 && i === 0) yearling1 = sum(yearlings, devRatio) / yearlings.length;
      // 来年の 6〜7 月の新馬：走る前の現在値を覚えておく。
      const unraced = y === 1 && i >= 20 && i < 28
        ? new Map([...w.horses.values()].filter((h) => !h.dead && !h.starts && w.year - h.birthYear === 2).map((h) => [h.id, devRatio(h)]))
        : null;
      const { results } = advanceWeek(w);
      if (unraced) {
        for (const r of results) {
          if (r.classId !== 'maiden') continue;
          for (const x of r.results) if (unraced.has(x.horseId)) debutRatios.push(unraced.get(x.horseId));
        }
      }
      races += results.length;
      starts += sum(results, (r) => r.results.length);
      for (const r of results) {
        allGaps.push(r.results[r.results.length - 1].marginTotal);
        if (r.results.length >= 3) top3Gaps.push(r.results[2].marginTotal);
        if (r.abroad) usRaces.push({ name: r.name, year: w.year, field: r.results.map((x) => w.horses.get(x.horseId)) });
        if (r.grade !== 'GI') continue;
        g1++;
        giTimes.push({ name: r.name, d: r.distance, t: r.winnerTime, field: r.results.length, ground: r.ground });
      }
    }
  }
  // 米国のレース：海外の実在馬が走り、日本の NPC は史実でその年に遠征した馬だけ。
  {
    const { ABROAD_RUNS } = await import('../src/sim/data/abroad-runs.js');
    const hist = new Set(ABROAD_RUNS.map(([, y, n]) => `${y}|${n}`));
    const jpNpc = usRaces.flatMap((r) => r.field.filter((h) => h && !h.foreign && h.ownerId !== 'player' && !hist.has(`${r.year}|${h.name}`)).map((h) => `${r.name}:${h.name}`));
    check(`米国のレースが走る（${usRaces.length} 回／2 年、${[...new Set(usRaces.map((r) => r.name))].length} 競走）`,
      usRaces.length >= 18 && usRaces.every((r) => r.field.length >= 3));
    check('米国のレースに史実に無い日本の NPC が出ない', jpNpc.length === 0, jpNpc.slice(0, 5).join(' '));
  }
  check(`1 歳が育成で育つ（潜在に対する現在値 ${yearling0.toFixed(2)} → 2 歳の年明け ${yearling1.toFixed(2)}）`,
    yearling1 > 0.6 && yearling1 < 0.75);
  check(`1 歳の 12 月の能力が G のままでない（${yearlingRanks?.join(' ')}）`, !!yearlingRanks && yearlingRanks.some((r) => r !== 'G'));
  const debut = sum(debutRatios) / Math.max(1, debutRatios.length);
  check(`新馬のデビュー戦で潜在の 8 割以上（${debut.toFixed(2)}、${debutRatios.length} 頭）`, debutRatios.length > 100 && debut > 0.8);
  check(`年間レース数 ${Math.round(races / 2)}`, races / 2 > 500);
  check(`年間出走数 ${Math.round(starts / 2)}`, starts / 2 > 6000);
  check(`GI ${g1 / 2} 回／年`, g1 / 2 >= 22, '24 戦すべて成立すべき');
  const smallField = giTimes.filter((x) => x.field < 8);
  check(`GI の頭数不足 ${smallField.length} 件`, smallField.length <= 4,
    smallField.map((x) => `${x.name}:${x.field}`).join(' '));
  // GI の時計が現実の範囲に収まっているか（良馬場のみ）。
  const band = { 1200: [64, 76], 1600: [88, 106], 1800: [104, 118], 2000: [112, 130], 2200: [124, 145], 2400: [136, 160], 2500: [142, 166], 3000: [175, 205], 3200: [188, 225] };
  const bad = giTimes.filter((x) => x.ground === '良' && band[x.d] && (x.t < band[x.d][0] || x.t > band[x.d][1]));
  // 外れは世界の乱数の流れで種ごとに 0〜5 件と揺れる（CLAUDE.md の落とし穴 46）。固定シードの 1 本なので
  // 上限は 5 件。帯を疑うのは 8 種ほどの平均が 2.5 件を超えたとき（2018 年以降生まれの馬を足した後は平均 1.63 件）。
  check(`GI の勝ち時計が範囲内（外れ ${bad.length}/${giTimes.length}）`, bad.length <= 5,
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
  // 史実馬の一覧から 2018 年以降生まれの馬を足した（ahogame-horses.js）ので、産駒の居ない名前だけの種牡馬の割合が
  // 少し増えた（8 シードの平均で 0.34 → 0.31）。0.3 では固定シードの 1 本が割るので 0.25 にした。
  check(`種牡馬が産駒を覚えている（${withFoals}/${sires.length} 頭）`, withFoals > sires.length * 0.25);
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
  // 古いセーブ（実在馬に父母が無い）を読み込むと、表の血統がつながる。祖先の馬ごと無いセーブも直る
  // （昔のセーブのミスタープロスペクターは血統表が真っ白だった）。
  const old = sideGame({ seed: 'verify-heal', startYear: 2026 });
  const ow = old.world;
  const ancestors = (world, n) => {
    const h = world.horses.get(world.real.ids[n]);
    let c = 0;
    (function walk(x, d) { if (!x || d > 5) return; c++; walk(world.horses.get(x.sireId), d + 1); walk(world.horses.get(x.damId), d + 1); })(h, 1);
    return c - 1;
  };
  const full = ancestors(ow, 'ミスタープロスペクター');
  const prospector = ow.horses.get(ow.real.ids['ミスタープロスペクター']);
  const sireOfProspector = prospector.sireId;
  prospector.sireId = null; prospector.damId = null;                       // 父母のリンクが無い古いセーブ
  ow.horses.delete(sireOfProspector); delete ow.real.ids['レイズアネイティヴ'];   // 親の馬そのものが無い
  const healed = ancestors(fromJSON(toJSON(old)).world, 'ミスタープロスペクター');
  // 血統をつなぐだけの祖先は、血統表から遠くなると世界から捨てる（pedOnly）ので、世界に居る祖先は 11 頭ほど。
  check(`古いセーブの実在馬に表の血統がつながる（ミスタープロスペクターの祖先 ${full} → 欠けた状態 0 → ロード後 ${healed}）`,
    full >= 10 && healed >= full - 4);
}
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
  // 古いセーブ（育成の無かった世界）は、読み込みで 1 歳と 2 歳に育成を足す。足すのは一度だけ（落とし穴 88）。
  // 世界をもう一度読み込むとメモリが 2GB を超えるので、印がセーブに載ることと、足し方を小さな世界で見る。
  check('育成のある世界の印がセーブに載る', json.includes('"nursery":1') && back.world.nursery === 1);
  const pot = Object.fromEntries(ABILITIES.map((a) => [a, 0.6]));
  const colt = (id, birthYear, r) => ({ id, birthYear, pot: { ...pot }, cur: Object.fromEntries(ABILITIES.map((a) => [a, 0.6 * r])) });
  const later = { year: 2028, week: 20, startYear: 2026, horses: new Map([[1, colt(1, 2027, 0.21)], [2, colt(2, 2026, 0.3)]]) };
  // 開始年の 2 歳は紙の戦績で 8 割から始まった世代なので足さない。
  const first = { year: 2026, week: 20, startYear: 2026, horses: new Map([[3, colt(3, 2024, 0.3)]]) };
  healNursery(later);
  healNursery(first);
  const r = (world, id) => world.horses.get(id).cur.speed / 0.6;
  const once = [r(later, 1), r(later, 2), r(first, 3)];
  healNursery(later);
  check(`古いセーブの 1 歳・2 歳に育成が足される（1 歳 0.21 → ${once[0].toFixed(2)}・2 歳 0.30 → ${once[1].toFixed(2)}・開始年の 2 歳は ${once[2].toFixed(2)} のまま）`,
    Math.abs(once[0] - nurseryReach(20)) < 1e-9 && once[1] > 0.7 && once[2] === 0.3
    && r(later, 1) === once[0] && r(later, 2) === once[1]);
}


// ---------------------------------------------------------------- v1.0.2
section('v1.0.2：登録・史実馬の初期値');
{
  // 先の週（1 年先まで）に登録でき、その週に走る。今週の分だけが消える。
  const g5 = sideGame({ seed: 'verify-entry' });
  const mine = myHorses(g5).filter((h) => h.stable === 'stable');
  const placed = [];
  for (const off of [0, 5, 12, 30, 47]) {
    for (const h of mine) {
      const rs = racesFor(g5, h.id, off);
      if (!rs.length) continue;
      const r = enterRace(g5, h.id, rs[0].raceId);
      if (r.ok) { placed.push({ off, horse: h.id, raceId: rs[0].raceId }); break; }
    }
  }
  check(`先の週にも登録できる（${placed.map((x) => `${x.off}週後`).join('・')}）`, placed.length >= 4 && new Set(placed.map((x) => x.off)).size === placed.length);
  check('1 年を超える先は登録できない', !enterRace(g5, mine[0].id, 'no-such-race').ok);
  const before = GG.myEntries(g5).length;
  nextWeek(g5);
  const afterOne = GG.myEntries(g5).length;
  check(`1 週進めても先の週の登録は残る（${before} → ${afterOne}）`, afterOne >= before - 1 && afterOne >= 3);
  for (let i = 0; i < 12; i++) nextWeek(g5);
  const left = GG.myEntries(g5);
  check(`過ぎた週の登録は消え、先のものだけ残る（${left.length} 件）`, left.every((e) => e.year > g5.world.year || e.week > g5.world.week));
  check('登録した馬は走った（記録がある）', mine.some((h) => (g5.world.horses.get(h.id).starts ?? 0) > 0));
  // セーブ往復で先の登録が保たれる。
  const back = fromJSON(toJSON(g5));
  check('先の登録がセーブで保たれる', GG.myEntries(back).length === left.length);
}
{
  // 表に能力のある現役の史実馬は、名馬が全部 E 評価で始まらない。
  const g6 = sideGame({ seed: 'verify-real-ability', startYear: 2020 });
  const names = ['コントレイル', 'デアリングタクト', 'アーモンドアイ', 'グランアレグリア'];
  const rows = [];
  for (const h of g6.world.horses.values()) {
    if (!names.includes(h.name)) continue;
    const t = horseView(g6, h.id);
    rows.push(`${h.name} 総合${t.summary?.total?.toFixed?.(2) ?? '—'}`);
    check(`${h.name} は表の能力から下げずに始まる`, ABILITIES.every((a) => h.cur[a] >= h.pot[a] * 0.94), JSON.stringify(h.cur));
  }
  check('現役の史実馬が見つかる', rows.length >= 3, rows.join(' '));
}


section('自分の重賞馬の種牡馬入り');
{
  // 重賞を勝った自分の牡馬は、獲得賞金が 3 億に届かなくても引退で種牡馬になれる（画面の案内どおり）。
  const gs = sideGame({ seed: 'verify-stud' });
  const raw = gs.world.horses.get(myHorses(gs)[0].id);
  Object.assign(raw, { sex: '牡', earnings: 9000, g1Wins: 0, gradedWins: 0, record: [], real: false });
  check('重賞未勝利の自分の牡馬は種牡馬にならない', GG.retireOutcome(gs, raw.id) === 'none');
  raw.gradedWins = 1;
  check('重賞を勝った自分の牡馬は「種牡馬になる」と出る', GG.retireOutcome(gs, raw.id) === 'stallion');
  GG.retire(gs, raw.id);
  check('引退すると種牡馬の名簿と自分の種牡馬に入る',
    raw.stallion && gs.world.stallionPool.includes(raw.id) && gs.world.player.stallions.includes(raw.id) && raw.studFee > 0);
  // 自分の実在馬は重賞を勝っていなくても種牡馬・繁殖に上がる。「上げない」も選べる。
  const [a2, b2] = [...gs.world.horses.values()].filter((h) => !h.dead && !h.retired && gs.world.year - h.birthYear >= 3 && h.ownerId !== 'player').slice(0, 2);
  for (const h of [a2, b2]) if (h) h.ownerId = 'player';
  if (a2 && b2) {
    Object.assign(a2, { sex: '牡', earnings: 500, g1Wins: 0, gradedWins: 0, record: [], real: true });
    Object.assign(b2, { sex: '牡', earnings: 500, g1Wins: 0, gradedWins: 0, record: [], real: true });
    check('自分の実在馬は引退で種牡馬になると出る', GG.retireOutcome(gs, a2.id) === 'stallion');
    GG.retire(gs, a2.id);
    GG.retire(gs, b2.id, { breed: false });
    check('実在馬は種牡馬になり、「上げない」を選べば上がらない', a2.stallion && !b2.stallion && !gs.world.stallionPool.includes(b2.id));
  }
  // 自分の種牡馬は種付料が無料で、配合の候補の「自分の種牡馬だけ」に出る。
  const mare = gs.world.player.broodmares[0];
  const ownList = GG.stallions(gs, { mine: true });
  check('自分の種牡馬が「自分の種牡馬だけ」に出て、種付料は無料', ownList.some((s) => s.id === raw.id) && ownList.every((s) => s.fee === 0 && s.mine));
  const evOwn = GG.evaluateMating(gs, mare, raw.id);
  check(`自分の種牡馬との配合は無料でランクが付く（${evOwn?.rank}）`, evOwn && evOwn.fee === 0 && /^[SABCDE]$/.test(evOwn.rank));
  const byBurst = GG.matingCandidates(gs, mare, { sort: 'burst' }).filter((r) => !r.ev?.blocked);
  const byRisk = GG.matingCandidates(gs, mare, { sort: 'risk' }).filter((r) => !r.ev?.blocked);
  check('配合の候補を爆発力の高い順・危険度の低い順に並べられる',
    byBurst.every((r, i) => i === 0 || byBurst[i - 1].ev.burst >= r.ev.burst)
    && byRisk.every((r, i) => i === 0 || byRisk[i - 1].ev.riskPoints <= r.ev.riskPoints));
  // 名声は勝つと上がる（GI 15・重賞 5〜8・オープン 3・条件 1）。
  check('名声の配点（GI 15・GII 8・GIII 5・海外 GI 25）',
    WW.famePoints({ grade: 'GI' }) === 15 && WW.famePoints({ grade: 'GII' }) === 8 && WW.famePoints({ grade: 'GIII' }) === 5
    && WW.famePoints({ grade: 'GI', abroad: 'US' }) === 25 && WW.famePoints({ classId: '1win' }) === 1);
}

section('幼駒の売却');
{
  // 幼駒はセールを待たずに売れる。値段は血統だけで決まり、乱数を使わない。
  const gy = sideGame({ seed: 'verify-young' });
  const w = gy.world;
  let foal = [...w.horses.values()].find((h) => h.ownerId === 'player' && w.year - h.birthYear < 2 && !h.dead);
  for (let i = 0; i < 16 && !foal; i++) { nextWeek(gy); foal = [...w.horses.values()].find((h) => h.ownerId === 'player' && w.year - h.birthYear < 2 && !h.dead); }
  check('自分の幼駒が居る（4 月に生まれる）', !!foal);
  if (foal) {
    const q1 = GG.youngsterQuote(gy, foal.id), q2 = GG.youngsterQuote(gy, foal.id);
    const money = w.player.money;
    const r = GG.sellYoungster(gy, foal.id);
    check(`幼駒を売れる（${q1} 万円・見積もりは何度見ても同じ）`, r.ok && q1 === q2 && r.price === q1 && w.player.money === money + q1 && foal.ownerId !== 'player');
    check('売った幼駒は自分の幼駒に出ない', !GG.myYoungsters(gy).some((x) => x.id === foal.id));
  }
}

section('v1.0.2：庭先の追加・牧場取引（通年）');
{
  const g7 = sideGame({ seed: 'verify-direct' });
  const w7 = g7.world;
  w7.player.money = 5e6;
  // 4 月（当歳が生まれる）まで進めて、セールの外でも当歳・1 歳・繁殖牝馬を買える。
  while (w7.week < 14) nextWeek(g7);
  check('セールの時期ではない', !GG.saleOpen(g7, 'foal') && !GG.saleOpen(g7, 'mare') && !GG.saleOpen(g7, 'private'));
  const bought = {};
  for (const k of ['dFoal', 'dYearling', 'dMare']) {
    const lots = GG.directSale(g7, k);
    const r = lots.length ? GG.buyLot(g7, k, lots[0].id) : { ok: false, why: '上場なし' };
    bought[k] = r;
    check(`牧場取引で買える（${k}：${lots.length} 頭、${r.ok ? lots[0].name : r.why}）`, lots.length >= 5 && r.ok);
    if (r.ok) check(`  買った馬は落札済みで出て、持ち主になる（${k}）`, GG.directSale(g7, k).some((x) => x.id === lots[0].id && x.sold) && g7.world.horses.get(lots[0].id).ownerId === 'player');
  }
  check('牧場取引は割高（セール価格より高い）', (() => {
    const l = GG.directSale(g7, 'dYearling')[0];
    return l.price > 0 && GG.DIRECT_PREMIUM > 1.2;
  })());
  check('買った繁殖牝馬が自分の繁殖牝馬に入る', g7.world.player.broodmares.includes(GG.directSale(g7, 'dMare').find((x) => x.sold)?.id));
  // 庭先の開催（春 3 月・夏 7 月・冬 12 月）。
  const wins = new Set();
  const g8 = sideGame({ seed: 'verify-private' });
  for (let i = 0; i < WEEKS_PER_YEAR; i++) { if (GG.saleOpen(g8, 'private')) wins.add(GG.privateWindow(g8).label); nextWeek(g8); }
  check(`庭先取引が年に 3 回開く（${[...wins].join('・')}）`, wins.size === 3);
}


section('v1.0.2：牧場施設');
{
  const g9 = sideGame({ seed: 'verify-facility' });
  const w9 = g9.world;
  check('施設の一覧が取れる（6 種・最初は全部レベル 0）', GG.facilities(g9).length === 6 && GG.facilities(g9).every((f) => f.level === 0));
  // 資金が足りなければ建てられない。
  w9.player.money = 100;
  check('資金が足りなければ建てられない', !GG.buildFacility(g9, 'slope').ok);
  w9.player.money = 100000;
  const money0 = w9.player.money;
  const r1 = GG.buildFacility(g9, 'slope');
  check(`建設を始められる（${r1.cost}万・${r1.weeks}週）`, r1.ok && w9.player.money === money0 - r1.cost);
  check('同じ施設を二重に建てられない', !GG.buildFacility(g9, 'slope').ok);
  check('同時に建てられるのは 2 つまで', GG.buildFacility(g9, 'pool').ok && !GG.buildFacility(g9, 'clinic').ok);
  // 工期のあいだは効かず、完成すると効く。
  check('建設中は効果が無い', GG.facilitySummary(g9).effects.growMul === 1);
  for (let i = 0; i < r1.weeks; i++) nextWeek(g9);
  const slope = GG.facilities(g9).find((f) => f.id === 'slope');
  check(`工期が過ぎると完成する（Lv ${slope.level}）`, slope.level === 1 && !slope.build);
  check('完成後は効果が出て、維持費がかかる', GG.facilitySummary(g9).effects.growMul > 1 && GG.facilitySummary(g9).upkeep > 0);
  check('完成の知らせが流れる', w9.log.some((l) => l.news.some((n) => n.includes('坂路コース が完成'))));
  // セーブ往復
  const back9 = fromJSON(toJSON(g9));
  check('施設がセーブで保たれる', GG.facilities(back9).find((f) => f.id === 'slope').level === 1);
  // 効果の向き：自分の馬だけに効く。調教の伸びが施設ありのほうが大きい。
  const gA = sideGame({ seed: 'verify-facility-fx' });
  const gB = sideGame({ seed: 'verify-facility-fx' });
  gB.world.player.money = 1e6;
  for (const id of ['slope', 'pool', 'clinic', 'paddock']) gB.world.player.facilities = { ...(gB.world.player.facilities ?? {}), [id]: { level: 3, build: null } };
  for (let i = 0; i < 8; i++) { nextWeek(gA); nextWeek(gB); }
  // 馬の id は世界ごとに違う（sideGame が番号を離す）ので、自分の馬を世界ごとに数える。
  const grow = (g) => sum(myHorses(g), (h) => sum(ABILITIES, (a) => h.cur[a]));
  check(`施設（坂路・プール）で自分の馬の能力が伸びる（${grow(gA).toFixed(2)} → ${grow(gB).toFixed(2)}）`, grow(gB) > grow(gA));
}


section('v1.0.2：配合理論');
{
  const g10 = sideGame({ seed: 'verify-theory' });
  const w10 = g10.world;
  const hs = [...w10.horses.values()];
  // 全種牡馬 × 繁殖牝馬の組み合わせで、理論の爆発力と危険度の分布を見る。
  const sires = w10.stallionPool.map((id) => w10.horses.get(id)).filter(Boolean).slice(0, 40);
  const mares = w10.marePool.map((id) => w10.horses.get(id)).filter(Boolean).slice(0, 40);
  const seen = new Map();
  const bursts = [];
  let combos = 0, risky = 0;
  for (const s of sires) for (const m of mares) {
    if (s.id === m.sireId) continue;
    const ev = GG.evaluateMating(g10, m.id, s.id);
    combos++;
    bursts.push(ev.burst);
    if (ev.riskPoints >= 4) risky++;
    for (const t of ev.theories) seen.set(t.name, (seen.get(t.name) ?? 0) + 1);
  }
  bursts.sort((a, b) => a - b);
  const med = bursts[bursts.length >> 1], p90 = bursts[Math.floor(bursts.length * 0.9)], max = bursts[bursts.length - 1];
  check(`爆発力の分布（中央 ${med}・上位 1 割 ${p90}・最大 ${max}）`, med >= 3 && med <= 15 && p90 >= 8 && p90 <= 30 && max <= 45);
  check(`危険度が大きい配合は少数（${risky}/${combos}）`, risky / combos < 0.25);
  check(`配合理論が多様に成立する（${seen.size} 種）`, seen.size >= 15);
  for (const need of ['インブリード', 'アウトブリード', 'シングルニックス']) {
    check(`  ${need} が成立する組み合わせがある`, [...seen.keys()].some((k) => k.includes(need)));
  }
  check('理論の一覧が説明に出る', GG.theoryGuide().length >= 20);
  // 種付けできない配合：母の父を父にはできない。
  {
    const m = mares.find((x) => x.sireId != null && w10.horses.get(x.sireId));
    const bad = GG.evaluateMating(g10, m.id, m.sireId);
    check('母の父を父にする配合は種付不可になる', !!bad.blocked);
  }
  // 世界全体の水準が動かない（落とし穴 41）：生まれた仔の潜在能力の中央値。
  const young = hs.filter((h) => !h.real && w10.year - h.birthYear <= 8 && h.sireId != null);
  const mid = young.map((h) => sum(ABILITIES, (a) => h.pot[a]) / ABILITIES.length).sort((a, b) => a - b)[Math.floor(young.length / 2)];
  check(`潜在能力の中央値が動かない（${mid.toFixed(3)}）`, mid > 0.42 && mid < 0.7);
  check('成立した理論が仔に残る', young.some((h) => h.theories?.length));
  // 爆発力の大きい配合ほど、仔のスピードが高い傾向（理論が効いている）。
  const ev0 = GG.evaluateMating(g10, mares[0].id, sires[0].id);
  check('評価に爆発力・危険度・星が出る', ev0.burst >= 0 && ev0.riskPoints >= 0 && ev0.stars >= 1 && typeof ev0.burstComment === 'string');
}


section('血統支配率の高い種牡馬の因子');
{
  const gd = sideGame({ seed: 'verify-dominance' });
  const wd = gd.world;
  const dom = bloodDominance(wd);
  const top = [...dom.entries()].map(([id, d]) => ({ h: wd.horses.get(id), d })).filter((x) => x.h && x.h.sex === SEX.MALE)
    .sort((a, b) => b.d - a.d);
  const high = top.filter((x) => x.d >= 0.01);
  check(`支配率 1% 以上の種牡馬 ${high.length} 頭はすべて因子を持つ（亡くなった馬を含む：${high.filter((x) => x.h.dead).length} 頭）`,
    high.length >= 10 && high.every((x) => (x.h.factors ?? []).length >= 1) && high.some((x) => x.h.dead));
  const higher = top.filter((x) => x.d >= 0.015);
  check(`支配率 1.5% 以上（${higher.length} 頭）は因子を 2 つ持つ`, higher.length >= 3 && higher.every((x) => (x.h.factors ?? []).length >= 2));
  check('支配率の低い種牡馬には付けない（0.5% 未満の因子持ちが全体の半分以下）',
    (() => {
      const low = top.filter((x) => x.d < 0.005);
      return low.length > 50 && low.filter((x) => (x.h.factors ?? []).length > 0).length < low.length * 0.5;
    })());
  // セーブから読み込んでも、付け終えた世界は変わらない。
  const back = fromJSON(toJSON(gd));
  const same = high.every((x) => JSON.stringify(back.world.horses.get(x.h.id).factors) === JSON.stringify(x.h.factors));
  check('セーブ往復で因子が保たれる', same);
  // 一覧の因子のとおり 2 つ（レイズアネイティヴ・トムフール：スピ パワ、ニアークティック：スピ 根性）。
  const fx = (n) => (gd.world.horses.get(gd.world.real.ids[n])?.factors ?? []).join(',');
  check(`名種牡馬が一覧どおりの因子を持つ（レイズアネイティヴ ${fx('レイズアネイティヴ')}・ニアークティック ${fx('ニアークティック')}）`,
    fx('レイズアネイティヴ') === 'speed,power' && fx('トムフール') === 'speed,power' && fx('ニアークティック') === 'speed,guts');
  // 世界が捨てた名前だけの祖先も、実在馬の血統表には表から出る（アファームドの母の側）。
  const cnt = (t) => (!t ? 0 : 1 + cnt(t.sire) + cnt(t.dam));
  const af = GG.pedigree(gd, gd.world.real.ids['アファームド'], 5);
  const afN = cnt(af?.sire) + cnt(af?.dam);
  check(`アファームドの 5 代血統表が埋まる（${afN}/62）`, afN >= 50);
}

section('実在馬の白斑');
{
  const { MARKINGS } = await import('../src/sim/data/markings.js');
  const { marksOf } = await import('../src/sim/markings.js');
  const ok = MARKINGS.every(([n, b, f, l, src]) => typeof n === 'string' && Number.isInteger(b)
    && /^(none|star|starStripe|stripe|blaze|bald|snip|starSnip)(\/[sl])?$/.test(f) && /^[0-5]{4}$/.test(l) && /^(en|ja)$/.test(src));
  check(`記事から取った白斑 ${MARKINGS.length} 頭（書式が正しい）`, MARKINGS.length >= 300 && ok);
  // 英語版の記事のとおり：ノーザンダンサーは曲がった大流星と 3 本の白い脚、ニジンスキーは額のハート形の星と 3 本の白い脚。
  const mk = (n) => marksOf(w.horses.get(w.real.ids[n]));
  const white = (m) => (m?.legs ?? []).filter((x) => x > 0).length;
  const nd = mk('ノーザンダンサー'), nj = mk('ニジンスキー');
  check(`世界の実在馬に白斑が引ける（ノーザンダンサー ${nd?.face}・白い脚 ${white(nd)} 本、ニジンスキー ${nj?.face}・${white(nj)} 本）`,
    nd?.face === 'blaze' && white(nd) === 3 && nj?.face === 'star' && white(nj) === 3);
  const fict = [...w.horses.values()].find((h) => !h.real);
  check('架空の馬は表を引かない（3D が馬 id から決める）', marksOf(fict) === null);
  // レースの 3D に毛色が渡る（結果の行は毛色を持たないので、以前は全頭が鹿毛で描かれていた）。
  const runners = [...w.horses.values()].filter((h) => !h.dead && h.coat !== '鹿毛').slice(0, 5);
  const looks = GG.raceLooks(game, { results: runners.map((h) => ({ horseId: h.id })) });
  check('レースの 3D に世界の毛色が渡る', runners.length === 5 && runners.every((h) => looks.get(h.id)?.coat === h.coat));
}

section('馬具');
{
  const Gr = await import('../src/sim/gear.js');
  const live = [...w.horses.values()].filter((h) => !h.dead && !h.retired && h.ownerId !== 'player').slice(0, 2000);
  const rate = (k) => live.filter((h) => Gr.gearOf(h)[k]).length / live.length;
  const same = live.slice(0, 50).every((h) => JSON.stringify(Gr.gearOf(h)) === JSON.stringify(Gr.npcGear(h)));
  check(`NPC の馬具は id と気性から決まる（メンコ ${(rate('menko') * 100).toFixed(0)}%・ブリンカー ${(rate('blinker') * 100).toFixed(0)}%・シャドーロール ${(rate('shadowRoll') * 100).toFixed(0)}%）`,
    same && rate('menko') > 0.25 && rate('menko') < 0.6 && rate('blinker') > 0.02 && rate('blinker') < 0.3);
  const bad = live.filter((h) => h.temper < 0.4), good = live.filter((h) => h.temper > 0.65);
  const br = (L) => L.filter((h) => Gr.gearOf(h).blinker).length / Math.max(1, L.length);
  check(`気性の悪い馬ほどブリンカーを付ける（気性難 ${(br(bad) * 100).toFixed(0)}%・素直 ${(br(good) * 100).toFixed(0)}%）`, br(bad) > br(good));
  const e0 = Gr.gearEffect(undefined, 0.3), eb = Gr.gearEffect({ blinker: true, menko: '#fff' }, 0.3), eg = Gr.gearEffect({ blinker: true }, 0.8);
  check('馬具の無い馬は何も変わらず、気性の悪い馬ほど効く', e0.start === 0 && e0.pull === 0 && e0.focus === 0 && e0.injury === 1
    && eb.pull > 0.05 && eb.start > 0.05 && eg.pull === 0);
  const mine = w.player.horses.map((x) => w.horses.get(x.id ?? x)).find((h) => h && !h.retired);
  const other = live[0];
  const r1 = GG.setHorseGear(game, mine.id, { menko: '#c8202a', blinker: true, cheek: true, bandage: true });
  const r2 = GG.setHorseGear(game, other.id, { blinker: true });
  check(`自分の馬だけ馬具を決められ、ブリンカーとチークピーシーズは重ねない（${GG.gearNames(r1.gear).join('・')}）`,
    r1.ok && !r2.ok && r1.gear.blinker && !r1.gear.cheek && GG.horseView(game, mine.id).gear.menko === '#c8202a');
  GG.setHorseGear(game, mine.id, {});
  check('馬具を外すと「付けない」と決めたまま（id から導く馬具に戻らない）', JSON.stringify(Gr.gearOf(mine)) === '{}');
}

section('カード育成モード');
{
  const I = await import('../src/sim/ikusei.js');
  const { peekHorseId } = await import('../src/sim/horse.js');
  const ids = new Set(I.CARDS.map((c) => c.id));
  check(`カード ${I.CARDS.length} 枚（第 1 弾 40・第 2 弾 40・第 3 弾 3・第 4 弾 40・イベント 3、id が重ならない）`,
    I.CARDS.length === 126 && ids.size === 126 && I.CARDS.filter((c) => c.pack === 'P4').length === 40 && I.CARDS.filter((c) => c.pack === 'P1').length === 40 && I.CARDS.filter((c) => c.pack === 'P2').length === 40
    && I.CARDS.filter((c) => c.pack === 'P3').length === 3 && I.CARDS.filter((c) => c.pack === 'EV').length === 3);
  // 第 4 弾は牝馬だけ。配分は過去の弾と同じ（LM 10・SSR 6・SR 6・R 8・N 10）、全カードに二つ名、LM と SSR の看板は牡馬混合の GI
  const p4 = I.CARDS.filter((c) => c.pack === 'P4');
  const nr = (r) => p4.filter((c) => c.rar === r).length;
  check(`第 4 弾【${I.PACKS.P4}】は牝馬 40 頭（LM ${nr('LM')}・SSR ${nr('SSR')}・SR ${nr('SR')}・R ${nr('R')}・N ${nr('N')}）、二つ名つき、同じ馬が他の弾に居ない`,
    p4.every((c) => c.sex === '牝' && c.epithet) && nr('LM') === 10 && nr('SSR') === 6 && nr('SR') === 6 && nr('R') === 8 && nr('N') === 10
    && new Set(I.CARDS.map((c) => c.name)).size === I.CARDS.length
    && p4.filter((c) => c.rar === 'LM' || c.rar === 'SSR').every((c) => c.race.info.startsWith('GI') && !/オークス|牝|女王|ヴィクトリア|ディスタフ|フィリー/.test(c.race.name)));
  const p3 = I.CARDS.filter((c) => c.pack === 'P3');
  check(`第 3 弾は生涯連対の SSR 3 頭（${p3.map((c) => c.name).join('・')}）、二つ名つき、カードパワーは LM を超えない`,
    p3.every((c) => c.rar === 'SSR' && c.epithet && /生涯連対/.test(c.record) && I.cardPower(c) <= 380)
    && ['ダイワスカーレット', 'エルコンドルパサー', 'シンザン'].every((n) => p3.some((c) => c.name === n)));
  const eg = I.CARDS.find((c) => c.name === 'イージーゴア');
  check('第 1 弾の LM にイージーゴア（二つ名「最強の再来」、右向き）', eg?.pack === 'P1' && eg.rar === 'LM' && eg.epithet === '最強の再来' && eg.facing === 'right');
  const fl = I.CARDS.find((c) => c.name === 'ファンタスティックライト');
  check('第 2 弾の LM にファンタスティックライト（二つ名「その煌めきは幻想が如く」）', fl?.pack === 'P2' && fl.rar === 'LM' && fl.epithet === 'その煌めきは幻想が如く');
  // +5 の数はレア度で決まる（LM 3・SSR 2〜3・SR 2・R と N は 1）
  const n5 = (c) => Object.values(I.plusOf(c)).filter((x) => x === 5).length;
  const want = { LM: [3, 3], SSR: [2, 3], SR: [2, 2], R: [1, 1], N: [1, 1] };
  check('+5 の数がレア度の決まりどおり', I.CARDS.every((c) => n5(c) >= want[c.rar][0] && n5(c) <= want[c.rar][1]));
  // ガチャは (シード, 引いた回数) だけで決まる
  const a = I.newProfile(7), b = I.newProfile(7);
  const ga = I.pull(a, 30).map((x) => x.card.id).join();
  const gb = [...I.pull(b, 10), ...I.pull(b, 20)].map((x) => x.card.id).join();
  check('ガチャは引き方（10 回＋20 回）によらず同じ順に出る', ga === gb);
  // ガチャはウイコインを 1 回 1 枚使う。検証では多く引くので持たせる（rich）
  const rich = (pp) => { pp.coins = 1e7; return pp; };
  const big = rich(I.newProfile(11));
  const got = I.pull(big, 2000);
  const lm = got.filter((x) => x.card.rar === 'LM').length / 2000, nn = got.filter((x) => x.card.rar === 'N').length / 2000;
  check(`排出率（LM ${(lm * 100).toFixed(1)}%・N ${(nn * 100).toFixed(1)}%）`, lm > 0.01 && lm < 0.035 && nn > 0.45 && nn < 0.55);
  // 1 回の育成を最後まで（練習は体力を見て、レースは最初の候補）
  const idBefore = peekHorseId();
  const own = I.owned(big);
  // 育成馬は配合で作る（父は牡・母は牝のカード）。LM の父の固有スキルを受け継ぐ
  const lmCard = own.find((c) => c.rar === 'LM' && c.sex === '牡');
  const damCard = own.find((c) => c.sex === '牝');
  const pv = I.breedPreview(big, lmCard.id, damCard.id);
  const sup0 = own.filter((c) => c.id !== lmCard.id && c.id !== damCard.id).slice(0, 4).map((c) => c.id);
  const bad = (f) => { try { f(); return false; } catch { return true; } };
  check('配合：父は牡・母は牝、名前は 1〜12 文字、サポートに父母は使えない',
    bad(() => I.startRun(I.newProfile(1), { sire: damCard.id, dam: lmCard.id, name: 'テスト' }, sup0))
    && bad(() => I.startRun(big, { sire: lmCard.id, dam: damCard.id, name: ' ' }, sup0))
    && bad(() => I.startRun(big, { sire: lmCard.id, dam: damCard.id, name: 'テスト' }, [damCard.id, ...sup0.slice(1)])) && big.run == null);
  const ps = I.plusOf(lmCard), pd = I.plusOf(damCard);
  const st = I.foalStyles(lmCard, damCard);
  check(`配合：伸びしろは両親の高いほう、初期値は平均、脚質は両親のあいだ（${st.join('・')}）、固有を受け継ぐ`,
    I.STATS.every((k) => pv.card.plus[k] === Math.max(ps[k], pd[k]) && Math.abs(pv.card.v[k] - (lmCard.v[k] + damCard.v[k]) / 2) < 0.001)
    && st.includes(pv.style) && pv.card.unique === lmCard.id && I.uniqueOf(pv.card)?.name === I.skillsOf(lmCard).unique.name
    && I.foalStyles({ style: 0.1 }, { style: 0.8 }).join() === '逃げ,先行,差し,追込');
  const run = I.startRun(big, { sire: lmCard.id, dam: damCard.id, name: '  テストホース ', style: st[st.length - 1] }, sup0);
  const tc0 = I.traineeCard(run);
  // 馬具：実際に着けていた馬のカードは馬具を持つ。育成中の馬は自分で決め、レースの結果が変わり、完成馬に残る
  {
    const gc = I.CARDS.filter((c) => c.gear && Object.keys(c.gear).length);
    const dsc = I.CARDS.find((c) => c.name === 'ダイワスカーレット'), mky = I.CARDS.find((c) => c.name === 'メイケイエール');
    const g0 = JSON.stringify(I.runGear(run));
    const spec = I.traineeSpec(run);
    const race = { id: 'gt', name: '馬具', grade: 'GI', courseId: 'nakayama', surface: '芝', distance: 2000, ground: '不良' };
    const field = (gear) => [{ ...spec, gear }, ...Array.from({ length: 11 }, (_, i) => ({ ...spec, id: 10 + i, name: `相手${i}` }))];
    let diff = 0;
    for (let i = 0; i < 12; i++) {
      const a0 = I.runRace(race, field({}), `gear:${i}`).results.find((r) => r.horseId === 1);
      const a1 = I.runRace(race, field({ menko: '#c8202a', blinker: true, shadowRoll: '#f4f2ec' }), `gear:${i}`).results.find((r) => r.horseId === 1);
      if (Math.abs(a0.time - a1.time) > 1e-9) diff++;
    }
    const set = I.setRunGear(run, { blinker: true, cheek: true, menko: '#1f3f9e' });
    check(`カード育成の馬具：実際に着けていた ${gc.length} 頭（${gc.map((c) => c.name).join('・')}）、育成中に決められ、レースが変わる（12 戦中 ${diff} 戦）`,
      gc.length >= 5 && dsc.gear.menko && mky.gear.menko && mky.gear.blinker && g0 === '{}' && set.blinker && !set.cheek
      && I.traineeSpec(run).gear.menko === '#1f3f9e' && diff >= 3);
    I.setRunGear(run, {});
  }
  check(`配合：名前・脚質が決めたとおりで、脚質に合わないスキルは受け継がない（${run.name}・${run.style}・${tc0.raceSkills.join(',')}）`,
    run.name === 'テストホース' && run.style === st[st.length - 1] && tc0.name === 'テストホース'
    && !(run.style !== '逃げ' && tc0.raceSkills.includes('front')) && !(['逃げ', '先行'].includes(run.style) && tc0.raceSkills.includes('closer')));
  let k = 0;
  while (!I.runDone(run)) {
    if (I.isRaceTurn(run)) I.raceTurn(run, I.raceOptions(run)[0].id);
    else if (run.energy < 45) I.rest(run);
    else I.train(run, I.STATS[k++ % 5]);
  }
  const formed = [run.sire, run.dam, ...run.supports];
  const gain0 = I.missionGain(big), coin0 = I.coinsOf(big), goalCoin0 = run.goal?.done ? I.GOAL_COINS : 0;
  const h = I.finishRun(big);
  check(`ミッション：初めて編成した 6 枚の育成を終えるとウイコイン 6 枚（${coin0} → ${I.coinsOf(big)}）、同じカードは 2 度目に数えない`,
    gain0.length === 6 && formed.every((id) => I.missionsOf(big).includes(id)) && I.coinsOf(big) === coin0 + 6 + goalCoin0
    && I.missionGain(big, { sire: run.sire, dam: run.dam, supports: run.supports }).length === 0);
  check(`育成は 10 戦で終わり、完成馬になる（${h.name} ${h.starts}戦${h.wins}勝・評価 ${h.rank}）`, h.starts === 10 && big.finished.length === 1 && big.run === null);
  I.setFinishedGear(big, h.id, { bandage: true, menko: '#e8b21a' });
  check('完成馬の馬具を決められ、対戦と絵（horseCard）に残る', I.finishedSpec(h).gear.bandage === true && I.horseCard(h).gear.menko === '#e8b21a');
  I.setFinishedGear(big, h.id, {});
  // カードエディット：完成馬をカードにする。撮り方は範囲に収めて持ち、カードの形（finishedCard）とホームの馬の絵（horseCard）に効く
  {
    const art = I.setFinishedArt(big, h.id, { shot: 'finish', facing: 'right', phase: 1.7, pose: 'race', backdrop: 'day', gate: 30, surface: 'ダート',
      legPose: { lf: { hip: 0.4, knee: 9 }, zz: { hip: 1 } }, camera: { pos: [5, 1.2, 6], look: [0, 1.3, 0], fov: 22 },
      silks: { body: '#c8202a', accent: 'red', pattern: '玉', sleeve: 'stripes' }, epithet: '  夕陽を裂く翼  ', junk: 1,
      rig: { horse: { neck: [0.3, 5, 0], 'lf.knee': [0.5, 0.4, 0], tail: [0, 0, 0], bogus: [1, 1, 1] }, rider: { handL: [0, 0.9, -0.1], elbow: [1, 1, 1] } } });
    const mc = I.finishedCard(h);
    const hc = I.horseCard(h);
    check(`カードエディット：撮り方とリグを範囲に収めて持ち（${JSON.stringify(art.legPose)}）、完成馬のカードとホームの絵が同じ撮り方になる`,
      art.phase === 1 && art.gate === 18 && art.legPose.lf.knee === 2 && !art.legPose.zz && art.silks.accent === '#c8202a' && art.epithet === '夕陽を裂く翼' && !('junk' in art)
      && mc.myCard && mc.name === h.name && mc.epithet === '夕陽を裂く翼' && mc.shot === 'finish' && mc.camera.fov === 22 && mc.surface === 'ダート' && mc.race?.name
      && I.STATS.every((k) => Math.abs(mc.v[k] - I.abilityOf(h.stats[k])) < 1e-9) && hc.shot === 'finish' && hc.id === mc.id && hc.rivals.length === 0
      // リグ：動かせる軸だけ・範囲に収め、0 の部位と知らない部位は落とす。カードの絵の値に渡る
      && JSON.stringify(art.rig) === JSON.stringify({ horse: { neck: [0.3, 2, 0], 'lf.knee': [0.5, 0, 0] }, rider: { handL: [0, 0.6, -0.1] } }) && hc.rig === art.rig);
    big.finished.find((x) => x.id === h.id).art = undefined;
  }
  // 固有スキルのエフェクト：LM は既定を持ち、完成馬はカードエディットで選べる（絵に描くのは選んだときだけ、なしは発動の演出も消す）
  {
    const lms = I.CARDS.filter((c) => c.rar === 'LM');
    const kinds = new Set(lms.map((c) => I.uniqueFxOf(c)));
    const def = I.fxOfFinished(h);
    const a1 = I.setFinishedArt(big, h.id, { fx: 'thunder' });
    const on = [I.fxOfFinished(h), I.finishedSpec(h).fx, I.horseCard(h).fxArt];
    I.setFinishedArt(big, h.id, { fx: 'bogus' });
    const bogus = big.finished.find((x) => x.id === h.id).art.fx;
    I.setFinishedArt(big, h.id, { fx: 'none' });
    const none = [I.fxOfFinished(h), I.horseCard(h).fxArt];
    // 向き：決めた向き（左・右）が絵の値に乗り、知らない値は落として馬の向きに戻る
    I.setFinishedArt(big, h.id, { fx: 'gale', fxDir: 'right', fxT: 1.234 });
    const dr = [I.horseCard(h).fxDir, I.fxDirOf(I.horseCard(h)), I.horseCard(h).fxT];
    I.setFinishedArt(big, h.id, { fx: 'gale', fxDir: 'up', facing: 'right' });
    const du = [I.horseCard(h).fxDir, I.fxDirOf(I.horseCard(h)), I.fxDirOf({ fxDir: 'left', facing: 'right' }), I.fxDirOf({}), I.horseCard(h).fxT];
    I.setFinishedArt(big, h.id, { fx: 'gale', fxT: 99 });
    const dt = I.horseCard(h).fxT;
    big.finished.find((x) => x.id === h.id).art = undefined;
    check(`固有スキルのエフェクト：LM ${lms.length} 枚が ${kinds.size} 種を持ち（流星を含む）、完成馬（固有 ${def}）は選んだエフェクト・向き（左・右）・時間が発動と絵に効き、なしで消える`,
      lms.every((c) => I.SKILL_FX[I.uniqueFxOf(c)]) && kinds.size >= 6 && I.uniqueFxOf(I.CARDS.find((c) => c.rar === 'SR')) === null
      && I.uniqueFxOf(I.cardById('P4-03')) === 'thunder' && I.uniqueFxOf(I.cardById('EV-02')) === 'shadow'
      // 流星（9 種目）を足しても、id のハッシュで決まる既定は変わらない（はじめの 8 種から選ぶ）
      && I.SKILL_FX.comet?.name === '流星' && I.uniqueFxOf(I.cardById('P4-07')) === 'comet'
      && I.uniqueFxOf(I.cardById('P1-01')) === 'shadow' && I.uniqueFxOf(I.cardById('P2-01')) === 'star' && I.uniqueFxOf(I.cardById('P1-08')) === 'frost'
      && def === I.uniqueFxOf(I.cardById(h.unique)) && a1.fx === 'thunder' && on.every((x) => x === 'thunder') && bogus === undefined
      && none[0] === null && none[1] === undefined && I.horseCard(h).fxArt === undefined
      && dr[0] === 'right' && dr[1] === 1 && dr[2] === 1.23 && du[0] === undefined && du[1] === 1 && du[2] === -1 && du[3] === -1
      && du[4] === undefined && dt === I.FX_TIME_MAX);
  }
  check('2 歳のレースは 2000m まで', h.races.filter((r) => I.SLOTS[r.slot].age === 2).every((r) => r.distance <= 2000));
  const bt = I.battleNpc(big, h.id, 'japan-cup', 'normal');
  check(`NPC とのランク戦が走る（${bt.order}着/${bt.result.results.length}）`, bt.result.results.length === 12 && bt.result.log != null);
  check('育成・対戦は牧場の世界の馬の id を進めない（落とし穴 47）', peekHorseId() === idBefore);
  // スキル：全カードが持ち、LM だけ固有。条件が合うときだけ能力が上がる。覚えたスキルは完成馬に残る
  const S = await import('../src/sim/ikusei-skills.js');
  const sk = I.CARDS.map((c) => [c, I.skillsOf(c)]);
  check('全カードがレーススキルとサポートスキルを持ち、固有は LM だけ',
    sk.every(([c, s]) => s.race.length >= 1 && s.support.length >= 1 && !!s.unique === (c.rar === 'LM') && [...s.race, ...s.support].every((id) => I.skillInfo(id))));
  const spec = { ab: { speed: 0.6, stamina: 0.6, power: 0.6, guts: 0.6, wit: 0.6 }, style: 0.5 };
  const on = S.applyRaceSkills(spec, ['turf'], { surface: '芝', distance: 2000 }, { rar: 'SR' });
  const off = S.applyRaceSkills(spec, ['turf'], { surface: 'ダート', distance: 2000 }, { rar: 'SR' });
  check('レーススキルは条件が合うときだけ発動する', on.spec.ab.speed > 0.6 && on.fired.length === 1 && off.spec.ab.speed === 0.6 && off.fired.length === 0 && spec.ab.speed === 0.6);
  const cue = (n) => I.skillCue(n, 2000).at;
  check('観戦の演出は場面に合わせて出る（逃げ切り → 王道 → 末脚炸裂 → 固有は最後の 400m）',
    cue('逃げ切り') < cue('王道') && cue('王道') < cue('末脚炸裂') && I.skillCue('最強の再来', 2000).unique && cue('最強の再来') >= 1600);
  check(`覚えたスキルが完成馬に残る（${h.skills.length} 個）`, tc0.raceSkills.every((id) => h.skills.includes(id)) && I.finishedSkills(h).length >= tc0.raceSkills.length
    && h.name === 'テストホース' && h.sire === lmCard.id && h.dam === damCard.id && h.unique === lmCard.id && I.horseCard(h).name === h.name);
  // 覚醒：同じカードを重ねて持つと、育てる馬もサポートも強くなる。1 枚なら何も変わらない
  const awRun = (n) => {
    const q = I.newProfile(21);
    const t = I.CARDS.find((c) => c.rar === 'N' && c.sex === '牡'), m = I.CARDS.find((c) => c.rar === 'N' && c.sex === '牝');
    const sup = I.CARDS.filter((c) => c.rar === 'SR').slice(0, 4);
    q.cards[t.id] = n; q.cards[m.id] = n;
    for (const c of sup) q.cards[c.id] = n;
    const r = I.startRun(q, { sire: t.id, dam: m.id, name: 'カクセイ' }, sup.map((c) => c.id));
    let j = 0;
    while (!I.runDone(r)) {
      if (I.isRaceTurn(r)) I.raceTurn(r, I.raceOptions(r)[0].id);
      else if (r.energy < 45) I.rest(r);
      else I.train(r, I.STATS.find((s) => I.trainingPreview(r, s).friendship) ?? I.STATS[j++ % 5]);
    }
    return { sum: I.STATS.reduce((a, k) => a + r.stats[k], 0), skills: I.runSkills(r).length, aw: r.awaken.t };
  };
  const a1 = awRun(1), a5 = awRun(5);
  const gg = I.pull(rich(I.newProfile(3)), 300);
  check(`覚醒：5 枚（覚醒 4）は 1 枚より育つ（能力の合計 ${a1.sum} → ${a5.sum}、スキル ${a1.skills} → ${a5.skills}）`,
    a1.aw === 0 && a5.aw === 4 && a5.sum > a1.sum + 150 && a5.skills > a1.skills && gg.some((g) => g.awaken === 4) && gg.every((g) => g.awaken <= 4));
  // かけら：覚醒 MAX（5 枚）を超えた余りだけを替え、かけらで好きなカードを 1 枚もらえる
  const sp = I.newProfile(4);
  const nc = I.CARDS.find((c) => c.rar === 'N'), rc = I.CARDS.find((c) => c.rar === 'R');
  sp.cards[nc.id] = 9; sp.cards[rc.id] = 3;
  const gotS = I.shardSpare(sp);
  const lack = I.canBuyWithShards(sp, rc.id);
  sp.shards = 30;
  const bought = I.buyWithShards(sp, rc.id);
  check(`かけら：余り 4 枚 → +${gotS}、5 枚は残り、かけら ${I.SHARD_COST.R} で R を 1 枚（覚醒 ${bought.awaken}）`,
    gotS === 4 * I.SHARD_VALUE.N && sp.cards[nc.id] === 5 && !!lack && sp.cards[rc.id] === 4 && sp.shards === 30 - I.SHARD_COST.R
    && !!I.canBuyWithShards({ ...sp, shards: 999 }, nc.id));
  // イベント：1999 年の凱旋門賞。報酬のモンジューはガチャにもかけらにも出ず、☆1〜☆5 の初勝利で 5 枚（完凸）
  const mj = I.CARDS.find((c) => c.name === 'モンジュー');
  const ev = I.EVENTS.find((e) => e.id === 'arc1999');
  const gp = rich(I.newProfile(5));
  const noEv = I.pull(gp, 3000).every((g) => !I.isEventCard(g.card));
  check(`イベント：モンジュー（LM・二つ名「聳え立つ巨城、地に落ちず」）は報酬だけ（ガチャ 3000 回に出ない・かけらで交換できない）`,
    mj?.rar === 'LM' && mj.epithet === '聳え立つ巨城、地に落ちず' && ev.reward === mj.id && noEv && !!I.canBuyWithShards({ ...gp, shards: 9999 }, mj.id));
  const ep = I.newProfile(6);
  ep.finished.push({ ...h, id: 999, battles: 0, battleWins: 0, turf: 0.9, dirt: 0.4, soft: 0.9, dist: 2400, stats: Object.fromEntries(I.STATS.map((k) => [k, 1200])) });
  const tried = [];
  for (let star = 1; star <= 5; star++) for (let t = 0; t < 12 && !I.eventState(ep, 'arc1999').cleared.includes(star); t++) tried.push(I.eventRace(ep, 999, 'arc1999', star));
  const last = tried.at(-1);
  check(`イベント：史実の 14 頭とロンシャン芝 2400m・不良を走り、☆1〜☆5 の初勝利でモンジュー 5 枚（${ep.cards[mj.id] ?? 0} 枚・挑戦 ${tried.length} 回）`,
    ev.field.length === 14 && last.result.results.length === 15 && last.race.courseId === 'longchamp' && last.race.ground === '不良'
    && ep.cards[mj.id] === 5 && I.eventState(ep, 'arc1999').cleared.join() === '1,2,3,4,5'
    && tried.filter((x) => x.reward).length === 5 && peekHorseId() === idBefore);
  // イベント第 2 弾：1989 年の BC クラシック。報酬のサンデーサイレンス（LM）、出走馬は史実の 8 頭（イージーゴアはカードのスキルで走る）
  const ss = I.cardById('EV-02');
  const bc = I.EVENTS.find((e) => e.id === 'bc1989');
  const bp = I.newProfile(8);
  bp.finished.push({ ...h, id: 998, battles: 0, battleWins: 0, turf: 0.5, dirt: 0.9, soft: 0.7, dist: 2000, stats: Object.fromEntries(I.STATS.map((k) => [k, 1200])) });
  const bcTried = [];
  for (let star = 1; star <= 5; star++) for (let t = 0; t < 12 && !I.eventState(bp, 'bc1989').cleared.includes(star); t++) bcTried.push(I.eventRace(bp, 998, 'bc1989', star));
  const bl = bcTried.at(-1);
  const egRow = bl.field.find((f) => f.name === 'イージーゴア');
  check(`イベント：1989 年の BC クラシック（ガルフストリーム ダ2000m・良、史実の 8 頭）。☆1〜☆5 の初勝利でサンデーサイレンス（LM「後世まで届け、至極の遺伝子」）5 枚（挑戦 ${bcTried.length} 回）`,
    ss?.rar === 'LM' && ss.name === 'サンデーサイレンス' && ss.epithet === '後世まで届け、至極の遺伝子' && I.isEventCard(ss) && bc.reward === ss.id
    && noEv && !I.pull(rich(I.newProfile(9)), 3000).some((g) => g.card.id === ss.id)
    && bc.field.length === 8 && bl.result.results.length === 9 && bl.race.courseId === 'gulfstream' && bl.race.surface === 'ダート' && bl.race.distance === 2000
    && egRow?.cardId === 'P1-40' && egRow.dirt === 0.9 && bp.cards[ss.id] === 5 && I.eventState(bp, 'bc1989').cleared.join() === '1,2,3,4,5'
    && I.eventState(bp, 'arc1999').tries === 0 && peekHorseId() === idBefore);
  // イベント第 3 弾：1990 年の有馬記念（オグリキャップの引退レース）。報酬のオグリキャップ（LM）、出走馬は史実の 16 頭
  {
    const og = I.cardById('EV-03');
    const am = I.EVENTS.find((e) => e.id === 'arima1990');
    const ap = I.newProfile(10);
    ap.finished.push({ ...h, id: 996, battles: 0, battleWins: 0, turf: 0.9, dirt: 0.4, soft: 0.7, dist: 2400, stats: Object.fromEntries(I.STATS.map((k) => [k, 1200])) });
    const at = [];
    for (let star = 1; star <= 5; star++) for (let t = 0; t < 12 && !I.eventState(ap, 'arima1990').cleared.includes(star); t++) at.push(I.eventRace(ap, 996, 'arima1990', star));
    const al = at.at(-1);
    check(`イベント：1990 年の有馬記念（中山 芝2500m・良、史実の 16 頭）。☆1〜☆5 の初勝利でオグリキャップ（LM「${og?.epithet}」）5 枚（挑戦 ${at.length} 回）`,
      og?.rar === 'LM' && og.name === 'オグリキャップ' && I.isEventCard(og) && am.reward === og.id && !I.pull(rich(I.newProfile(11)), 3000).some((g) => g.card.id === og.id)
      && am.field.length === 16 && al.result.results.length === 17 && al.race.courseId === 'nakayama' && al.race.distance === 2500
      && al.field.find((f) => f.name === 'オグリキャップ')?.cardId === 'EV-03' && ap.cards[og.id] === 5 && I.eventState(ap, 'arima1990').cleared.join() === '1,2,3,4,5'
      && I.uniqueFxOf(og) === 'radiance' && peekHorseId() === idBefore);
  }
  // カードの組み合わせ：編成に同じ弾・同じ父系・同じ年代が 3 枚以上そろうと練習の伸びが上がる（種類ごとにいちばん多い組だけ）
  {
    const six = I.CARDS.filter((c) => c.pack === 'P1' && c.sex === '牡').slice(0, 5);
    const dam = I.CARDS.find((c) => c.pack === 'P1' && c.sex === '牝');
    const ids = [six[0].id, dam.id, ...six.slice(1, 5).map((c) => c.id)];
    const combo = I.comboOf(ids);
    const cp = I.newProfile(71);
    for (const id of ids) cp.cards[id] = 1;
    const r = I.startRun(cp, { sire: ids[0], dam: ids[1], name: 'ソロイ' }, ids.slice(2));
    const g1 = I.trainingPreview(r, 'speed').gains.speed;
    const r0 = { ...r, combo: undefined };
    const g0 = I.trainingPreview(r0, 'speed').gains.speed;
    const mix = I.comboOf(['P1-01', 'P2-01', 'P3-01', 'P4-01', 'EV-01', 'P2-10']);
    check(`組み合わせ：${combo.map((x) => `${I.COMBO_KINDS[x.kind]}${x.label} ${x.n}枚 +${Math.round(x.bonus * 100)}%`).join('・')}、練習の伸び ${g0} → ${g1}、ばらばらの編成は ${mix.length} 組`,
      combo.find((x) => x.kind === 'pack')?.n === 6 && combo.find((x) => x.kind === 'pack').bonus === 0.05 && r.combo?.length === combo.length
      && g1 > g0 && I.comboMul(r0) === 1 && mix.every((x) => x.kind !== 'pack'));
  }
  // 1 日・週のミッション：記録の数の差で進み、達成したら受け取る。日が変わると 1 日の分、月曜で週の分が 0 から
  {
    const qp = I.newProfile(81);
    qp.finished.push({ ...h, id: 995, battles: 0, battleWins: 0, stats: Object.fromEntries(I.STATS.map((k) => [k, 1200])) });
    const sat = '2026-11-07', sun = '2026-11-08', mon = '2026-11-09';
    I.rollQuests(qp, sat);
    const s0 = I.questState(qp, sat);
    for (let t = 0; t < 2; t++) I.battleNpc(qp, 995, 'japan-cup', 'normal');
    I.rivalRace(qp, 995, 'japan-cup', 1, sat);
    const s1 = I.questState(qp, sat);
    const c0 = I.coinsOf(qp);
    const got = I.claimQuest(qp, 'd_rank', sat);
    const again = I.claimQuest(qp, 'd_rank', sat);
    const notYet = I.claimQuest(qp, 'd_run', sat);
    const s2 = I.questState(qp, sun);
    I.rollQuests(qp, sun);
    const wk = I.questState(qp, sun).weekly.find((x) => x.id === 'w_rankw').have;
    I.rollQuests(qp, mon);
    const s3 = I.questState(qp, mon);
    const d = (st, id) => [...st.daily, ...st.weekly].find((x) => x.id === id);
    check(`1 日のミッション ${I.QUESTS.daily.length} 個・週のミッション ${I.QUESTS.weekly.length} 個：ランク戦 2 回で「${d(s1, 'd_rank').label}」達成・受け取り +${got}（2 度目は 0）、翌日は 1 日の分が 0、週の分は続き（ランク戦の勝ち ${wk}）、月曜に 0`,
      d(s0, 'd_rank').have === 0 && d(s1, 'd_rank').ready && d(s1, 'd_battle').have === 3 && got === 1 && again === 0 && notYet === 0 && I.coinsOf(qp) === c0 + 1
      && d(s2, 'd_rank').have === 0 && !d(s2, 'd_rank').got && wk === (I.recOf(qp).rankw ?? 0) && d(s3, 'w_rankw').have === 0
      && I.weekNumber(sun) !== I.weekNumber(mon) && I.weekNumber(sat) === I.weekNumber(sun) && I.daysToWeekEnd(sun) === 1);
  }
  // ランク戦の段位：着順で点が上下し、初めて届いた段位でウイコイン（落ちてまた上がっても出ない）
  {
    const lp = I.newProfile(91);
    lp.finished.push({ ...h, id: 994, battles: 0, battleWins: 0, turf: 0.9, dirt: 0.4, dist: 2400, range: 500, stats: Object.fromEntries(I.STATS.map((k) => [k, 1000])) });
    let ok = true, coins = 0, promos = 0, n = 0;
    while (I.ladderState(lp).tier < 2 && n < 120) {
      const before = I.ladderState(lp).pts, c0 = I.coinsOf(lp);
      const o = I.battleNpc(lp, 994, 'japan-cup', 'normal');
      const g = I.RANK_GAIN(o.order);
      ok &&= o.rank.pts === Math.max(0, before + Math.round(g * (g > 0 ? I.RANK_DIFF.normal.up : I.RANK_DIFF.normal.down))) && I.coinsOf(lp) === c0 + o.rank.coins;
      coins += o.rank.coins; promos += o.rank.promoted ? 1 : 0; n++;
    }
    const best = lp.ladder.best;
    lp.ladder.pts = I.RANK_TIERS[best].at;
    let o2 = null;
    // 芝の馬をダートの舞台で走らせて負けさせる
    for (let t = 0; t < 60 && !(o2?.rank.demoted); t++) o2 = I.battleNpc(lp, 994, 'february-s', 'normal');
    const c1 = I.coinsOf(lp);
    let up = null;
    for (let t = 0; t < 60 && I.ladderState(lp).tier < best; t++) up = I.battleNpc(lp, 994, 'japan-cup', 'normal');
    check(`ランク戦の段位：${n} 戦で${I.RANK_TIERS[best].name}まで、昇格 ${promos} 回で +${coins} 枚、不向きな舞台で負けて降格し、戻っても出ない（${I.RANK_TIERS.length} 段・最上位は${I.RANK_TIERS.at(-1).name}）`,
      ok && best === 2 && coins === I.RANK_TIERS[1].coins + I.RANK_TIERS[2].coins && promos === 2 && o2?.rank.demoted && up?.rank.promoted
      && I.coinsOf(lp) === c1 && lp.ladder.best === 2 && peekHorseId() === idBefore);
  }
  // 記録と殿堂：舞台ごとの最速の時計・通算の数・最高の評価点。殿堂は HALL_MAX 頭までで、殿堂の馬は手放せない
  {
    const rp = I.newProfile(101);
    const hs = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ ...h, id: 900 + i, battles: 0, battleWins: 0 }));
    rp.finished.push(...hs);
    const o = I.battleNpc(rp, 901, 'arima-kinen', 'normal');
    const mine = o.result.results.find((x) => x.horseId === 100);
    const f = I.recOf(rp).fast[I.stageKey(o.race)];
    const ow = I.battleOwn(rp, [901, 902, 903], 'arima-kinen');
    const f2 = I.recOf(rp).fast[I.stageKey(o.race)];
    for (const x of hs.slice(0, 6)) I.setHall(rp, x.id, true);
    let full = false, kept = false;
    try { I.setHall(rp, 907, true); } catch { full = true; }
    try { I.releaseFinished(rp, 901); } catch { kept = true; }
    I.setHall(rp, 901, false); I.releaseFinished(rp, 901);
    const old = { ...I.newProfile(102), finished: [{ ...h, id: 5 }], rec: undefined };
    I.migrateProfile(old);
    check(`記録：${I.stageLabel(I.stageKey(o.race))} の最速 ${f2?.t} 秒（${f2?.horse}）、通算 対戦 ${I.recOf(rp).battles} 回、殿堂は ${I.HALL_MAX} 頭まで・殿堂の馬は手放せない、古いプロフィールは完成馬から起こす（最高 ${old.rec.best?.rating}）`,
      f?.t === Math.round(mine.time * 100) / 100 && f2.t <= f.t && I.recOf(rp).battles === 2 && I.recOf(rp).rank === 1 && I.recOf(rp).own === 1
      && full && kept && I.hallOf(rp).length === 5 && !rp.finished.some((x) => x.id === 901)
      && old.rec.runs === 1 && old.rec.best?.rating === h.rating && old.rec.wins === h.wins && I.stageLabel('nakayama|芝|2500') === '中山 芝2500m');
  }
  // 因子メモリー：育成を終えた馬を完成馬にせずメモリーにする。能力 1 つ（点の 8%）とレーススキル 1 つを抜き出し、編成すると初期値・上限とスキルに効く
  {
    const mp = rich(I.newProfile(41));
    I.pull(mp, 60);
    const own = I.owned(mp);
    const ms = own.find((c) => c.sex === '牡'), md = own.find((c) => c.sex === '牝');
    const sup = own.filter((c) => c !== ms && c !== md).slice(0, 4).map((c) => c.id);
    const grow = (mems = []) => {
      const r = I.startRun(mp, { sire: ms.id, dam: md.id, name: 'メモリー' }, sup, mems);
      const init = { ...r.stats };
      let j = 0;
      while (!I.runDone(r)) { if (I.isRaceTurn(r)) I.raceTurn(r, I.raceOptions(r)[0].id); else if (r.energy < 45) I.rest(r); else I.train(r, I.STATS[j++ % 5]); }
      return init;
    };
    const base = grow();
    const coin0 = I.coinsOf(mp) + (mp.run.goal?.done ? I.GOAL_COINS : 0);
    const m = I.finishRunAsMemory(mp);
    const withM = grow([m.id]);
    const run = mp.run;
    const tooMany = (() => { try { I.startRun(rich(I.newProfile(1)), {}, [], [1, 2, 3]); return false; } catch { return true; } })();
    check(`因子メモリー：完成馬にせず ${I.STAT_LABEL[m.stat]} ☆${m.star}（+${m.val}）・${m.skill ? I.skillInfo(m.skill).name : 'スキルなし'} を抜き出し、編成すると初期値とスキルに効く`,
      mp.finished.length === 0 && I.memoriesOf(mp).length === 1 && m.star >= 1 && m.star <= 5 && m.val === m.star * I.MEM_STEP && I.coinsOf(mp) === coin0 + 6
      && withM[m.stat] === base[m.stat] + m.val && I.STATS.every((k) => k === m.stat || withM[k] === base[k])
      && I.runCap(run, m.stat) === I.capOf(I.plusOf(I.traineeCard(run))[m.stat], run.awaken.t) + m.val
      && (!m.skill || I.runSkills(run).includes(m.skill)) && tooMany && peekHorseId() === idBefore);
    I.finishRun(mp);
    I.dropMemory(mp, m.id);
    check('因子メモリーは編成しても減らず、手放すと消える', I.memoriesOf(mp).length === 0 && mp.finished.length === 1);
    // ☆は 1〜5 のランダム（いろいろな育成で全部出る）。上限は 1200 を超えて突破し、能力ごとに 100 まで（☆5 を 2 つ編成しても +100）
    const fakeRun = { mem: [{ stat: 'speed', val: 100 }, { stat: 'speed', val: 100 }, { stat: 'wit', val: 40 }] };
    const old = { ...I.newProfile(42), memories: [{ id: 1, stat: 'speed', val: 92, skill: null, horse: {} }] };
    I.migrateProfile(old);
    check(`因子メモリーの上限突破：同じ能力は合わせて ${I.MEM_BREAK} まで（☆5×2 で +${I.memBreak(fakeRun.mem, 'speed')}）、1200 を超えた点もレースの能力に効く、以前のメモリーは☆に直す（92 → ☆${old.memories[0].star}）`,
      I.memBreak(fakeRun.mem, 'speed') === 100 && I.memBreak(fakeRun.mem, 'wit') === 40 && I.abilityOf(1300) > I.abilityOf(1200) && I.abilityOf(1400) === I.abilityOf(1300)
      && old.memories[0].star === 5 && old.memories[0].val === 100 && I.gradeOfPts(1250) === 'SS+');
  }
  // 目標レースとライバル：始めるときに 3 歳の GI から目標を 1 つ、名馬のカードからライバルを 1 頭決める。ライバルは 4 戦で同じレースに出て、目標は 1 勝で出られる
  {
    const gp = rich(I.newProfile(51));
    I.pull(gp, 60);
    const own = I.owned(gp);
    const gs = own.find((c) => c.sex === '牡'), gd = own.find((c) => c.sex === '牝');
    const sup = own.filter((c) => c !== gs && c !== gd).slice(0, 4).map((c) => c.id);
    const r = I.startRun(gp, { sire: gs.id, dam: gd.id, name: 'モクヒョウ' }, sup);
    const goal = { ...r.goal }, meets = [...r.rival.meets];
    let seen = 0, offered = null, j = 0;
    while (!I.runDone(r)) {
      if (I.isRaceTurn(r)) {
        const o = I.raceOptions(r);
        if (r.slot === goal.slot) offered = o.some((x) => x.goal) === I.goalEligible(r);
        const out = I.raceTurn(r, (o.find((x) => x.goal) ?? o[0]).id);
        if (out.rival) seen++;
        if (out.rival && !out.result.results.some((x) => x.horseId === I.RIVAL_HORSE_ID)) seen = -99;
      } else if (r.energy < 45) I.rest(r); else I.train(r, I.STATS[j++ % 5]);
    }
    const rec = I.rivalRecord(r);
    r.goal.done = true;   // 勝った場合の報酬を確かめる
    const c0 = I.coinsOf(gp);
    const h = I.finishRun(gp);
    const rv = I.cardById(r.rival.cardId);
    check(`目標レース「${goal.name}」（${I.SLOTS[goal.slot].label}）、ライバル${rv.name}と ${seen} 戦（${rec.won} 勝 ${rec.lost} 敗）、目標を勝つと評価点 +${I.GOAL_BONUS}・ウイコイン +${I.GOAL_COINS}`,
      !!goal.id && goal.slot >= 3 && meets.length === 4 && meets.includes(goal.slot) && seen === 4 && offered === true
      && rec.won + rec.lost === 4 && ['LM', 'SSR', 'SR'].includes(rv.rar) && ![gs.id, gd.id, ...sup].includes(rv.id)
      && h.goal?.done === true && h.rival?.won === rec.won && h.rating === I.ratingOf({ ...h, goal: null }) + I.GOAL_BONUS
      && I.coinsOf(gp) === c0 + 6 + I.GOAL_COINS && peekHorseId() === idBefore);
  }
  // 育成中の出来事：練習の時期に数ターンに 1 回出て（続けては出ない）、答えで体力・気分・能力・絆が動く。同じ育成はいつも同じ出来事
  {
    const ep = rich(I.newProfile(61));
    I.pull(ep, 60);
    const own = I.owned(ep);
    const es = own.find((c) => c.sex === '牡'), ed = own.find((c) => c.sex === '牝');
    const sup = own.filter((c) => c !== es && c !== ed).slice(0, 4).map((c) => c.id);
    const r = I.startRun(ep, { sire: es.id, dam: ed.id, name: 'デキゴト' }, sup);
    let n = 0, consec = false, stable = true, moved = true, lastTurn = -9, j = 0;
    while (!I.runDone(r)) {
      const ev = I.pendingEvent(r);
      if (ev) {
        stable &&= JSON.stringify(ev) === JSON.stringify(I.pendingEvent(r)) && ev.choices.length >= 2 && !/[{}]/.test(ev.text);
        if (r.turn === lastTurn + 1) consec = true;
        const before = JSON.stringify([r.energy, r.mood, r.stats, r.bonds, r.fans]);
        I.resolveEvent(r, n % 2);
        moved &&= JSON.stringify([r.energy, r.mood, r.stats, r.bonds, r.fans]) !== before || r.energy === 100;
        stable &&= I.pendingEvent(r) === null;
        lastTurn = r.turn; n++;
      }
      if (I.isRaceTurn(r)) I.raceTurn(r, I.raceOptions(r)[0].id); else if (r.energy < 45) I.rest(r); else I.train(r, I.STATS[j++ % 5]);
    }
    const shape = I.TRAIN_EVENTS.every((e) => e.choices.length >= 2 && (!e.text.includes('{support}') || e.support) && (!e.text.includes('{rival}') || e.rival));
    check(`育成中の出来事：1 回の育成で ${n} 回（続けては出ない）、同じターンはいつも同じ出来事、答えると体力・気分・能力・絆が動き、表 ${I.TRAIN_EVENTS.length} 種の形が正しい`,
      n >= 2 && n <= 14 && !consec && stable && moved && shape && r.evDone.length === n && peekHorseId() === idBefore);
  }
  // LM の固有スキルは型（16 種）で効き目が違う。条件の型は条件が合うときだけ、場面の型は走っている間に発動し、発動した地点（uqAt）を返す
  {
    const lms = I.CARDS.filter((c) => c.rar === 'LM');
    const kinds = new Set(lms.map((c) => I.uniqueKindOf(c)));
    const base = (id, sex, style) => ({ id, name: `U${id}`, sex, coat: '鹿毛', ab: Object.fromEntries(I.STATS.map((k) => [k, 0.75])), dist: 2000, range: 600, turf: 0.9, dirt: 0.9, firm: 0.8, soft: 0.6, style });
    const go = (kind, race, { sex = '牡', style = 0.5, n = 12, battle = false, region = 'JP' } = {}) => {
      const fired = [];
      const me = { ...base(1, sex, style), uniq: { kind, k: 1, region, battle, name: '固有', fired } };
      const field = [me];
      for (let i = 2; i <= n; i++) field.push(base(i, '牡', ((i * 37) % 100) / 100));
      const res = I.runRace({ id: 'u', name: 'u', grade: '', ground: '良', courseId: 'tokyo', surface: '芝', distance: 2000, ...race }, field, `uq:${kind}:${JSON.stringify(race)}`);
      return { fired: fired.length === 1, at: res.results.find((r) => r.horseId === 1).uqAt, plain: res.results.filter((r) => r.horseId !== 1).every((r) => !('uqAt' in r)) };
    };
    const cond = [
      go('king', { grade: 'GI' }).fired && !go('king', {}).fired,
      go('mud', { ground: '不良' }).fired && !go('mud', {}).fired,
      go('stayer', { distance: 2400 }).fired && !go('stayer', {}).fired,
      go('flash', { distance: 1400 }).fired && !go('flash', {}).fired,
      go('abroad', { courseId: 'longchamp', distance: 2400 }).fired && !go('abroad', {}).fired && !go('abroad', { courseId: 'longchamp', distance: 2400 }, { region: 'EU' }).fired,
      go('stage', {}, { battle: true }).fired && !go('stage', {}).fired,
      go('queen', {}, { sex: '牝' }).fired && !go('queen', {}).fired,
      go('crowd', {}, { n: 16 }).fired && !go('crowd', {}).fired,
    ];
    const s0 = go('start', {}), k0 = go('kick', {}), l0 = go('long', { distance: 2400 }), h0 = go('hill', { courseId: 'nakayama' }), i0 = go('inside', {});
    const scenes = s0.fired && s0.at === 40 && k0.fired && k0.at >= 1600 && l0.fired && l0.at >= 1600 && h0.fired && i0.fired && i0.at >= 1500 && s0.plain;
    check(`LM の固有スキル：${lms.length} 枚が ${kinds.size} 種の型（条件の型 8 種は条件が合うときだけ発動、場面の型は好スタート ${s0.at}m・鬼脚 ${Math.round(k0.at)}m・ロングスパート ${Math.round(l0.at)}m で発動）`,
      kinds.size === 16 && Object.keys(I.UNIQUE_KINDS).length === 16 && cond.every(Boolean) && scenes
      && I.uniqueOf(I.cardById('P4-01')).desc.startsWith('【王者の風格】') && peekHorseId() === idBefore);
  }
  // 夏合宿・サポートの連続イベント・ガチャの天井
  {
    const ep = rich(I.newProfile(61));
    I.pull(ep, 60);
    const own = I.owned(ep);
    const es = own.find((c) => c.sex === '牡'), ed = own.find((c) => c.sex === '牝');
    const sup = own.filter((c) => c !== es && c !== ed).slice(0, 4).map((c) => c.id);
    const r = I.startRun(ep, { sire: es.id, dam: ed.id, name: 'ガッシュク' }, sup);
    // 夏合宿：3 歳 8 月の練習 3 回だけ。サポートは全員来て、伸びは 1.5 倍
    let camps = 0, allCome = true, boost = true, stories = 0, ordered = true, taught = true, j = 0;
    const seen = {};
    while (!I.runDone(r)) {
      const ev = I.pendingEvent(r);
      if (ev) {
        if (ev.story != null) {
          stories++;
          ordered &&= (seen[ev.support] ?? 0) === ev.story && (r.bonds[ev.support] ?? 0) >= ev.story + 1;
          seen[ev.support] = ev.story + 1;
          const before = I.runSkills(r).length;
          I.resolveEvent(r, 1);
          if (ev.story === 2) {
            const all = I.skillsOf(I.cardById(r.supports[ev.support]), 0).race;
            taught &&= all.every((x) => I.runSkills(r).includes(x)) && I.runSkills(r).length >= before;
          }
        } else I.resolveEvent(r, 0);
      }
      if (I.isCamp(r)) {
        camps++;
        allCome &&= Object.values(I.trainingBoard(r)).flat().length === r.supports.length;
        const p = I.trainingPreview(r, 'speed');
        const off = { ...r, turn: r.turn + 4 };   // 同じ並び（練習 n 回目）の翌月と比べる代わりに、倍率だけ見る
        boost &&= I.CAMP_MUL === 1.5 && !I.isCamp(off) && p.gains && Object.values(p.gains).some((v) => v > 0);
      }
      if (I.isRaceTurn(r)) I.raceTurn(r, I.raceOptions(r)[0].id); else if (r.energy < 45) I.rest(r); else I.train(r, I.STATS[j++ % 5]);
    }
    const shape = Object.values(I.SUPPORT_STORIES).every((a) => a.length === 3 && a.every((e) => e.choices.length === 2) && a[2].choices.every((c) => c.effects.teach));
    check(`夏合宿：3 歳 8 月の練習 ${camps} 回はサポートが全員来て伸びが ${I.CAMP_MUL} 倍。サポートの連続イベント：${stories} 話（絆の順に第 1〜3 話、最終話でスキルをすべて覚える）`,
      camps === 3 && allCome && boost && stories >= 3 && ordered && taught && shape && peekHorseId() === idBefore);
    // 天井：1 回 1 点、100 点で PICK UP のカードと交換。足りなければ交換できない
    const gp = rich(I.newProfile(62));
    I.pull(gp, 99);
    let early = false;
    try { I.exchangePity(gp, I.PICKUP[0]); } catch { early = true; }
    I.pull(gp, 1);
    const n0 = gp.cards[I.PICKUP[1]] ?? 0;
    const got = I.exchangePity(gp, I.PICKUP[1]);
    let other = false;
    try { gp.pity = 200; I.exchangePity(gp, 'P1-01'); } catch { other = true; }
    check(`ガチャの天井：1 回 1 点、${I.PITY_COST} 点で PICK UP（${I.PICKUP.map((id) => I.cardById(id).name).join('・')}）と交換、足りなければ交換できない`,
      early && got.card.id === I.PICKUP[1] && gp.cards[I.PICKUP[1]] === n0 + 1 && other && I.PICKUP.length === 3);
  }
  // ウイコイン：ガチャは 1 回 1 枚。新しいプロフィールは 30 枚、足りなければ引けない。古いプロフィールは完成馬の編成をミッション済みにして配る
  {
    const cp = I.newProfile(31);
    const ok30 = I.pull(cp, 30).length === 30 && I.coinsOf(cp) === 0;
    let refused = false;
    try { I.pull(cp, 1); } catch { refused = true; }
    const old = { ...I.newProfile(32), coins: undefined, missions: undefined, finished: [{ sire: 'P1-01', dam: 'P4-01', supports: ['P1-02', 'P1-03', 'P1-04', 'P1-01'] }] };
    I.migrateProfile(old);
    check(`ウイコイン：新しいプロフィールは ${I.COIN_START} 枚で 30 回引けて 31 回目は引けない、古いプロフィールは完成馬の編成ぶん（${old.coins - I.COIN_START} 枚）を配る`,
      ok30 && refused && cp.pulls === 30 && old.coins === I.COIN_START + 5 && old.missions.length === 5 && I.migrateProfile(old).coins === I.COIN_START + 5);
    // ライバルレース：☆1〜☆5、勝つと難易度に応じたウイコイン（1 日 10 枚まで、日が変わると 0 から）、勝った難易度はスキップできる
    const rp = I.newProfile(33);
    rp.finished.push({ ...h, id: 997, battles: 0, battleWins: 0, stats: Object.fromEntries(I.STATS.map((k) => [k, 1200])) });
    const day = '2026-11-07', next = '2026-11-08';
    const noSkip = I.canRivalSkip(rp, 1, day);
    let w = null;
    for (let t = 0; t < 10 && !w; t++) { const o = I.rivalRace(rp, 997, 'japan-cup', 1, day); if (o.order === 1) w = o; }
    const c1 = I.coinsOf(rp);
    let skips = 0;
    while (!I.canRivalSkip(rp, 1, day)) { I.rivalSkip(rp, 1, day); skips++; }
    const capped = I.rivalState(rp, day);
    const c2 = I.coinsOf(rp);
    const nd = I.rivalState(rp, next);
    I.rivalSkip(rp, 1, next);
    check(`ライバルレース：${w?.result.results.length} 頭立て、☆1 で勝つと ${w?.coins} 枚、スキップで今日の上限 ${I.RIVAL_DAILY} 枚まで（${skips} 回）、翌日はまた 0 から`,
      !!noSkip && w?.coins === I.RIVAL_COINS[1] && w.first && w.result.results.length === I.RIVAL_FIELD && c1 === 30 + 1
      && capped.got === I.RIVAL_DAILY && capped.left === 0 && c2 === 30 + I.RIVAL_DAILY
      && nd.got === 0 && nd.left === I.RIVAL_DAILY && I.coinsOf(rp) === 30 + I.RIVAL_DAILY + 1 && !!I.canRivalSkip(rp, 5, next) && peekHorseId() === idBefore);
  }
  // 脚質はレースごとに選べる。先行で出した馬が、サポートから覚えた「逃げ切り」で逃げにならない（自分の馬だけ。相手のカードは今までどおり）
  {
    const { applyRaceSkills } = await import('../src/sim/ikusei-skills.js');
    const rc = { surface: '芝', distance: 2000 };
    const base = { ab: Object.fromEntries(I.STATS.map((k) => [k, 0.7])), style: 0.37, soft: 0.5 };
    const sen = applyRaceSkills(base, ['front', 'closer'], rc, { lock: 0.37 });
    const nige = applyRaceSkills({ ...base, style: 0.12 }, ['front', 'closer'], rc, { lock: 0.12 });
    const npc = applyRaceSkills(base, ['front'], rc, {});
    const rp = rich(I.newProfile(21));
    I.pull(rp, 60);
    const own = I.owned(rp);
    const sire = own.find((c) => c.sex === '牡'), dam = own.find((c) => c.sex === '牝');
    let raced = null;
    if (sire && dam) {
      I.startRun(rp, { sire: sire.id, dam: dam.id, name: 'センコウ', style: null }, own.filter((c) => c !== sire && c !== dam).slice(0, 4).map((c) => c.id));
      rp.run.learned = ['front'];
      while (!I.isRaceTurn(rp.run)) I.train(rp.run, 'speed');
      const r = I.raceTurn(rp.run, I.raceOptions(rp.run)[0].id, '差し');
      raced = { style: rp.run.raceStyle, fired: r.fired, row: r.result.results.find((x) => x.horseId === 1) };
    }
    check(`脚質：選んだ脚質で走り、合わない脚質のスキルは使わない（先行で逃げ切り・末脚炸裂とも不発・脚質 ${sen.spec.style}、逃げなら逃げ切りだけ、相手のカードは逃げ切りで逃げる）`,
      sen.spec.style === 0.37 && sen.fired.length === 0 && nige.fired.join() === '逃げ切り' && nige.spec.style === 0.12 && npc.spec.style < 0.25
      && raced?.style === '差し' && !raced.fired.includes('逃げ切り') && I.runRaceStyle(rp.run) === '差し');
  }
  const js = JSON.stringify(big);
  check(`プロフィールは JSON で往復できる（${(js.length / 1024).toFixed(1)}KB）`, JSON.stringify(JSON.parse(js)) === js && js.length < 64 * 1024);
}

console.log(`\n合計 ${pass} ok / ${fail} NG`);
process.exit(fail === 0 ? 0 : 1);
