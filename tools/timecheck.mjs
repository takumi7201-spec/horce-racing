// レースの時計が実際の競馬の範囲に入っているかを見る道具。
// PHYS をいじったら必ずこれを通す。
//   node tools/timecheck.mjs
//   node tools/timecheck.mjs --ability 0.8

import { makeRng } from '../src/core/rng.js';
import { createHorse, resetHorseIds } from '../src/sim/horse.js';
import { createJockey } from '../src/sim/jockey.js';
import { simulateRace } from '../src/sim/race.js';
import { SURFACE } from '../src/sim/course.js';
import { ABILITIES, SEX } from '../src/sim/params.js';
import { formatTime } from '../src/core/util.js';

const args = process.argv.slice(2);
const abIdx = args.indexOf('--ability');
const AB = abIdx >= 0 ? Number(args[abIdx + 1]) : 0.62;

const rng = makeRng(12345);
resetHorseIds(1);

function makeField(n, distance, surface, year) {
  const horses = [];
  for (let i = 0; i < n; i++) {
    const h = createHorse(rng, {
      name: `テスト${i + 1}`, sex: SEX.MALE, birthYear: year - 4,
    });
    const lv = AB + rng.normal(0, 0.05);
    for (const a of ABILITIES) {
      h.pot[a] = Math.max(0.05, Math.min(1, lv + rng.normal(0, 0.05)));
      h.cur[a] = h.pot[a];
    }
    h.growth = '普通';
    h.dist = distance;
    h.distRange = 500;
    h.turf = surface === SURFACE.TURF ? 0.9 : 0.5;
    h.dirt = surface === SURFACE.DIRT ? 0.9 : 0.5;
    h.firm = 0.9; h.soft = 0.6;
    h.temper = 0.6; h.sound = 0.7; h.spirit = 0.6;
    h.cond = 0.7; h.fit = 0.85; h.fatigue = 0;
    h.style = [0.08, 0.2, 0.35, 0.45, 0.55, 0.62, 0.7, 0.8, 0.9][i % 9];
    h.styleFlex = 0.6;
    horses.push(h);
  }
  return horses;
}

const CASES = [
  // 実際の JRA の決着時計（GI クラス）を目安に置いた期待レンジ。
  // 適性・仕上がりが揃った 16 頭なので、期待値はコースレコード前後に置く。
  ['nakayama', SURFACE.TURF, 1200, 65.5, 69.0],
  ['tokyo', SURFACE.TURF, 1600, 89.0, 93.0],
  ['tokyo', SURFACE.TURF, 2000, 114.0, 119.5],
  ['tokyo', SURFACE.TURF, 2400, 138.0, 146.0],
  ['kyoto', SURFACE.TURF, 3200, 186.0, 199.0],
  ['nakayama', SURFACE.TURF, 2500, 145.0, 155.0],
  ['hanshin', SURFACE.TURF, 1600, 89.0, 94.0],
  ['niigata', SURFACE.TURF, 1000, 52.5, 56.5],
  ['tokyo', SURFACE.DIRT, 1600, 92.0, 99.0],
  ['chukyo', SURFACE.DIRT, 1800, 104.0, 112.0],
];

let bad = 0;
console.log(`能力 ${AB.toFixed(2)} の馬 16 頭で検証\n`);
console.log('場  馬場 距離   勝ち時計  期待          上がり  ペース      1着脚質');
for (const [course, surface, distance, lo, hi] of CASES) {
  const year = 2026;
  const horses = makeField(16, distance, surface, year);
  const entries = horses.map((h, i) => ({
    horse: h,
    jockey: { id: i, name: `J${i}`, skill: 0.6, aggression: 0.5 },
    weight: 57,
    gate: i + 1,
    frame: Math.min(8, Math.floor(i / 2) + 1),
  }));
  const r = simulateRace({
    raceId: 'test', name: 'テスト', classId: 'g1', grade: 'GI',
    courseId: course, surface, distance, ground: '良', weather: '晴',
    year, week: 20, entries, prize: 10000,
  }, makeRng(777));
  const t = r.winnerTime;
  const ok = t >= lo && t <= hi;
  if (!ok) bad++;
  const w = r.results[0];
  console.log(
    `${r.courseName.padEnd(3, '　')} ${surface.padEnd(4, '　')} ${String(distance).padStart(4)} `
    + `${formatTime(t).padStart(8)}  ${formatTime(lo)}〜${formatTime(hi)}  `
    + `${w.last3f.toFixed(1)}  ${r.pace.label.padEnd(6, '　')}  ${w.styleLabel}  ${ok ? '' : '← 範囲外'}`,
  );
}

// 脚質ごとの勝率。どれかに偏っていたらモデルが壊れている。
const styleWins = {};
for (let i = 0; i < 60; i++) {
  const year = 2026;
  const horses = makeField(16, 2000, SURFACE.TURF, year);
  const entries = horses.map((h, k) => ({
    horse: h, jockey: { id: k, name: `J${k}`, skill: 0.6, aggression: 0.5 },
    weight: 57, gate: k + 1, frame: Math.min(8, Math.floor(k / 2) + 1),
  }));
  const r = simulateRace({
    raceId: 't', name: 't', classId: 'op', courseId: 'tokyo', surface: SURFACE.TURF,
    distance: 2000, ground: '良', weather: '晴', year, week: 20, entries, prize: 0,
  }, makeRng(1000 + i), { record: false });
  const s = r.results[0].styleLabel;
  styleWins[s] = (styleWins[s] ?? 0) + 1;
}
console.log('\n東京芝 2000m を 60 回（同能力 16 頭）：脚質別の勝利数');
console.log(' ', Object.entries(styleWins).map(([k, v]) => `${k} ${v}`).join(' / '));

console.log(bad === 0 ? '\n時計: OK' : `\n時計: ${bad} 件が範囲外`);
process.exit(bad === 0 ? 0 : 1);
