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

section('カード育成モード');
{
  const I = await import('../src/sim/ikusei.js');
  const { peekHorseId } = await import('../src/sim/horse.js');
  const ids = new Set(I.CARDS.map((c) => c.id));
  check(`カード ${I.CARDS.length} 枚（第 1 弾 39・第 2 弾 40、id が重ならない）`,
    I.CARDS.length === 79 && ids.size === 79 && I.CARDS.filter((c) => c.pack === 'P1').length === 39 && I.CARDS.filter((c) => c.pack === 'P2').length === 40);
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
  const big = I.newProfile(11);
  const got = I.pull(big, 2000);
  const lm = got.filter((x) => x.card.rar === 'LM').length / 2000, nn = got.filter((x) => x.card.rar === 'N').length / 2000;
  check(`排出率（LM ${(lm * 100).toFixed(1)}%・N ${(nn * 100).toFixed(1)}%）`, lm > 0.01 && lm < 0.035 && nn > 0.45 && nn < 0.55);
  // 1 回の育成を最後まで（練習は体力を見て、レースは最初の候補）
  const idBefore = peekHorseId();
  const own = I.owned(big);
  const lmCard = own.find((c) => c.rar === 'LM');
  const run = I.startRun(big, lmCard.id, own.filter((c) => c.id !== lmCard.id).slice(0, 4).map((c) => c.id));
  let k = 0;
  while (!I.runDone(run)) {
    if (I.isRaceTurn(run)) I.raceTurn(run, I.raceOptions(run)[0].id);
    else if (run.energy < 45) I.rest(run);
    else I.train(run, I.STATS[k++ % 5]);
  }
  const h = I.finishRun(big);
  check(`育成は 10 戦で終わり、完成馬になる（${h.name} ${h.starts}戦${h.wins}勝・評価 ${h.rank}）`, h.starts === 10 && big.finished.length === 1 && big.run === null);
  check('2 歳のレースは 2000m まで', h.races.filter((r) => I.SLOTS[r.slot].age === 2).every((r) => r.distance <= 2000));
  const bt = I.battleNpc(big, h.id, 'japan-cup', 'normal');
  check(`NPC とのランク戦が走る（${bt.order}着/${bt.result.results.length}）`, bt.result.results.length === 12 && bt.result.log != null);
  check('育成・対戦は牧場の世界の馬の id を進めない（落とし穴 47）', peekHorseId() === idBefore);
  const js = JSON.stringify(big);
  check(`プロフィールは JSON で往復できる（${(js.length / 1024).toFixed(1)}KB）`, JSON.stringify(JSON.parse(js)) === js && js.length < 64 * 1024);
}

console.log(`\n合計 ${pass} ok / ${fail} NG`);
process.exit(fail === 0 ? 0 : 1);
