// Godot に移したカード育成（godot/scripts/ik/）が、ゲーム本体（src/sim/ikusei.js）と同じ結果を出すかを見る。
//
//   node tools/verify-godot-ikusei.mjs      （Godot は /tmp/godot/Godot_v4.7.2-stable_linux.x86_64、GODOT で変えられる）
//
// 同じ筋書き（決まった手で 30 回引き、1 頭を育て、ランク戦・イベント・ライバルレースを走り、ウイコインの残高を見る）を両方で回して比べる。
// ガチャ・練習は乱数と整数だけなので一致するはず。レースは log・cos・pow の最後の桁が違う（V8 の fdlibm と C の数学関数）ので、
// まれに着順が入れ替わりうる。着順の一致と時計の差を出す。

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as IK from '../src/sim/ikusei.js';

const GODOT = process.env.GODOT ?? '/tmp/godot/Godot_v4.7.2-stable_linux.x86_64';
const orders = (res) => res.results.map((r) => [r.horseId, Math.round(r.time * 1000) / 1000]);

function scenario(seed) {
  const p = IK.newProfile(seed);
  IK.rollQuests(p, '2026-11-07');
  const pulls = IK.pull(p, 30).map((g) => g.card.id);
  const own = IK.owned(p);
  // 育成馬は配合（最初の牡 × 最初の牝）。脚質は選べるうちのいちばん後ろ（脚質のスキルの受け継ぎも見る）
  const sire = own.find((c) => c.sex === '牡'), dam = own.find((c) => c.sex === '牝');
  const sup = own.filter((c) => c !== sire && c !== dam).slice(0, 4).map((c) => c.id);
  const styles = IK.foalStyles(sire, dam);
  IK.startRun(p, { sire: sire.id, dam: dam.id, name: IK.foalNameIdea(sire, dam), style: styles[styles.length - 1] }, sup);
  // 馬具を付けて走らせる（race.js の馬具の効き目も Godot と比べる）
  IK.setRunGear(p.run, { menko: '#c8202a', blinker: true, shadowRoll: '#f4f2ec' });
  const run = p.run;
  const steps = [];
  while (!IK.runDone(run)) {
    // 育成中の出来事：出たら答える（ターンで答えを変える）。答えた結果の文と体力・能力まで比べる
    const ev = IK.pendingEvent(run);
    if (ev) steps.push(['event', ev.id, ev.support, IK.resolveEvent(run, run.turn % 2), run.energy, run.mood, { ...run.stats }]);
    if (IK.isRaceTurn(run)) {
      const opts = IK.raceOptions(run);
      const r = IK.raceTurn(run, opts[0].id, run.slot % 3 === 2 ? IK.STYLE_NAMES[run.slot % 4] : null);  // 3 戦に 1 戦は脚質を選んで出る
      steps.push(['race', r.race.id, r.race.ground, r.order, orders(r.result)]);
    } else if (run.energy < 45) {
      steps.push(['rest', IK.rest(run)]);
    } else {
      let best = '', bv = -1;
      for (const k of IK.STATS) {
        const pv = IK.trainingPreview(run, k);
        const s = Object.values(pv.gains).reduce((a, b) => a + b, 0);
        if (s > bv) { bv = s; best = k; }
      }
      steps.push(['train', IK.train(run, best)]);
    }
  }
  // 目標レースとライバル（選んだ馬・出会う時期・各戦の着順）
  const goalrival = [run.goal?.id, run.goal?.slot, !!run.goal?.done, run.rival?.cardId, run.rival?.meets, (run.rival?.log ?? []).map((x) => [x.slot, x.me, x.rv])];
  // 因子メモリー：同じところから分けた写しで、完成馬にせずメモリーにして、それを編成した次の育成の初期値とスキルを見る
  const pm = structuredClone(p);
  const mm = IK.finishRunAsMemory(pm);
  IK.startRun(pm, { sire: sire.id, dam: dam.id, name: 'メモリー' }, sup, [mm.id]);
  const memory = [mm.stat, mm.star, mm.val, mm.skill, pm.run.stats, pm.run.learned, IK.runCap(pm.run, mm.stat)];
  const h = IK.finishRun(p);
  const b = IK.battleNpc(p, h.id, 'japan-cup', 'normal');
  const e = IK.eventRace(p, h.id, 'arc1999', 1);
  const e2 = IK.eventRace(p, h.id, 'bc1989', 3);
  // ライバルレース（☆2、勝てば次の日に同じ☆をスキップ）とウイコインの残高
  const rv = IK.rivalRace(p, h.id, 'arima-kinen', 2, '2026-11-07');
  let skip = 0;
  // 1 日・週のミッション、段位、記録、殿堂、組み合わせ、イベント第 3 弾（1990 年の有馬記念）
  const qs = IK.questState(p, '2026-11-07');
  const claimed = IK.claimAllQuests(p, '2026-11-07');
  try { skip = IK.rivalSkip(p, 2, '2026-11-08'); } catch { /* 勝っていない */ }
  IK.rollQuests(p, '2026-11-08');
  const e3 = IK.eventRace(p, h.id, 'arima1990', 2);
  const b2 = IK.battleNpc(p, h.id, 'arima-kinen', 'legend');
  const qs2 = IK.questState(p, '2026-11-08');
  const hall = [IK.setHall(p, h.id, true), IK.hallOf(p)];
  let rel = '';
  try { IK.releaseFinished(p, h.id); } catch (er) { rel = er.message; }
  const rec = IK.recOf(p);
  const qv = (q) => [...q.daily, ...q.weekly].map((x) => [x.id, x.have, x.got, x.ready]);
  const extra = {
    combo: [run.combo ?? null, IK.comboOf(['P1-01', 'P1-02', 'P1-05', 'P1-06', 'P1-07', 'P1-03']), IK.comboOf(['EV-03', 'P1-19', 'P4-36', 'P1-17', 'P2-01', 'P3-01'])],
    ladder: [b.rank, b2.rank, IK.ladderState(p)], quests: [qv(qs), qs.ready, claimed, qv(qs2), qs2.weekLeft, IK.weekNumber('2026-11-08'), IK.dayNumber('2026-11-08')],
    rec: ['runs', 'starts', 'wins', 'giWins', 'goals', 'battles', 'battleWins', 'rank', 'rankw', 'rival', 'rivalw', 'rival3w', 'event', 'eventw'].map((k) => rec[k] ?? 0),
    best: rec.best, fast: Object.keys(rec.fast ?? {}).sort().map((k) => [k, Math.round(rec.fast[k].t * 100), rec.fast[k].horse, rec.fast[k].race, rec.fast[k].mode, rec.fast[k].ground]),
    hall, rel, stage: IK.stageLabel('nakayama|芝|2500'),
  };
  return { pulls, steps, stats: h.stats, rating: h.rating, skills: h.skills, name: h.name, sex: h.sex, coat: h.coat, battle: orders(b.result), event: orders(e.result), event2: orders(e2.result), event3: orders(e3.result), battle2: orders(b2.result), extra,
    rival: orders(rv.result), memory, goalrival, coins: [IK.coinsOf(p), rv.coins, skip, IK.missionGain(p, { sire: sire.id, dam: dam.id, supports: sup }).length, IK.missionsOf(p).length] };
}

function raceCheck(r) {
  const cs = IK.CARDS;
  const field = [];
  for (let i = 0; i < 16; i++) {
    const c = cs[(i * 5 + r.distance / 100) % cs.length];
    field.push({ id: 100 + i, name: c.name, sex: c.sex, coat: c.coat, ab: c.v, dist: c.dist, range: c.range, turf: c.turf, dirt: c.dirt, firm: c.firm, soft: c.soft, style: c.style });
  }
  return orders(IK.runRace({ ...r, ground: '稍重' }, field, `check:${r.id}`));
}

const js = { scenarios: [11, 2026, 777].map(scenario), races: IK.BATTLE_RACES.map(raceCheck) };
execFileSync(GODOT, ['--headless', '--path', 'godot', '--script', 'res://tests/ik_verify.gd', '--', '--out=/tmp/ik_gd.json'], { stdio: 'inherit', timeout: 600000 });
const gd = JSON.parse(readFileSync('/tmp/ik_gd.json', 'utf8'));

let bad = 0;
// Godot の JSON.stringify は辞書の鍵を並べ替えて書くので、鍵の順を揃えて比べる
const norm = (v) => (Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])])) : v);
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const cmpOrder = (label, a, b) => {
  const ia = a.map((x) => x[0]), ib = b.map((x) => x[0]);
  const dt = Math.max(...a.map((x, i) => Math.abs(x[1] - (b[i]?.[1] ?? 0))));
  if (!same(ia, ib)) { bad++; console.log(`✗ ${label}：着順が違う JS ${ia.join(',')} / Godot ${ib.join(',')}`); }
  return dt;
};
let maxDt = 0, nRace = 0;
js.scenarios.forEach((s, k) => {
  const g = gd.scenarios[k];
  if (!same(s.pulls, g.pulls)) { bad++; console.log(`✗ 種 ${k}：ガチャが違う`); }
  s.steps.forEach((st, i) => {
    const gs = g.steps[i];
    if (!gs) { bad++; console.log(`✗ 種 ${k}：手順 ${i} が無い`); return; }
    if (st[0] === 'race') {
      nRace++;
      if (st[1] !== gs[1] || st[2] !== gs[2]) { bad++; console.log(`✗ 種 ${k} 手順 ${i}：番組が違う ${st[1]}/${gs[1]}`); }
      maxDt = Math.max(maxDt, cmpOrder(`種 ${k} 手順 ${i} ${st[1]}`, st[4], gs[4]));
    } else if (!same(st, gs)) { bad++; console.log(`✗ 種 ${k} 手順 ${i}：${st[1]} / ${gs[1]}`); }
  });
  if (!same(s.stats, g.stats)) { bad++; console.log(`✗ 種 ${k}：完成の能力 ${JSON.stringify(s.stats)} / ${JSON.stringify(g.stats)}`); }
  if (s.name !== g.name || s.sex !== g.sex || s.coat !== g.coat) { bad++; console.log(`✗ 種 ${k}：育成馬 ${s.name}・${s.sex}・${s.coat} / ${g.name}・${g.sex}・${g.coat}`); }
  if (!same(s.skills, g.skills)) { bad++; console.log(`✗ 種 ${k}：スキル ${s.skills} / ${g.skills}`); }
  maxDt = Math.max(maxDt, cmpOrder(`種 ${k} ランク戦`, s.battle, g.battle), cmpOrder(`種 ${k} イベント`, s.event, g.event), cmpOrder(`種 ${k} イベント（BC）`, s.event2, g.event2),
    cmpOrder(`種 ${k} イベント（有馬）`, s.event3, g.event3), cmpOrder(`種 ${k} ランク戦（伝説）`, s.battle2, g.battle2),
    cmpOrder(`種 ${k} ライバルレース`, s.rival, g.rival));
  if (!same(s.goalrival, g.goalrival)) { bad++; console.log(`✗ 種 ${k}：目標とライバル ${JSON.stringify(s.goalrival)} / ${JSON.stringify(g.goalrival)}`); }
  if (!same(s.memory, g.memory)) { bad++; console.log(`✗ 種 ${k}：因子メモリー ${JSON.stringify(s.memory)} / ${JSON.stringify(g.memory)}`); }
  if (!same(s.coins, g.coins)) { bad++; console.log(`✗ 種 ${k}：ウイコイン ${s.coins} / ${g.coins}`); }
  for (const x of Object.keys(s.extra)) if (!same(s.extra[x], g.extra[x])) { bad++; console.log(`✗ 種 ${k}：${x} ${JSON.stringify(s.extra[x])} / ${JSON.stringify(g.extra[x])}`); }
  nRace += 6;
});
js.races.forEach((r, i) => { nRace++; maxDt = Math.max(maxDt, cmpOrder(`舞台 ${IK.BATTLE_RACES[i].id}`, r, gd.races[i])); });
console.log(`${bad ? '✗' : '✓'} 不一致 ${bad} 件（レース ${nRace} 戦、時計の差の最大 ${maxDt.toFixed(3)} 秒）　Godot ${gd.ms}ms`);
process.exit(bad ? 1 : 0);
