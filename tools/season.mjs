// 世界を何年か回して、競馬界が壊れていないかを見る道具。
//   node tools/season.mjs --years 5
//   node tools/season.mjs --years 20 --quiet

import { createWorld, advanceWeek, computeLeaders } from '../src/sim/world.js';
import { horseAge } from '../src/sim/horse.js';
import { ABILITIES, SEX, WEEKS_PER_YEAR } from '../src/sim/params.js';
import { toJSON, fromJSON } from '../src/sim/save.js';
import { sum, byDesc, formatMoney, formatTime } from '../src/core/util.js';

const args = process.argv.slice(2);
const num = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : d; };
const YEARS = num('--years', 5);
const QUIET = args.includes('--quiet');
const SEED = args.includes('--seed') ? args[args.indexOf('--seed') + 1] : 'season';

const t0 = Date.now();
const world = createWorld(SEED, { startYear: 2026, playerName: '検証 太郎', farmName: '検証ファーム' });
console.log(`世界生成 ${Date.now() - t0}ms / ${world.horses.size} 頭`);

const stats = [];
for (let y = 0; y < YEARS; y++) {
  const ty = Date.now();
  let races = 0, starts = 0;
  for (let w = 0; w < WEEKS_PER_YEAR; w++) {
    const { results } = advanceWeek(world);
    races += results.length;
    starts += sum(results, (r) => r.results.length);
  }
  const year = world.year - 1;
  const live = [...world.horses.values()].filter((h) => !h.dead && !h.retired && horseAge(h, year) >= 2);
  const abil = live.length ? sum(live, (h) => sum(ABILITIES, (a) => h.pot[a]) / ABILITIES.length) / live.length : 0;
  const cur = live.length ? sum(live, (h) => sum(ABILITIES, (a) => h.cur[a]) / ABILITIES.length) / live.length : 0;
  const g1 = world.history.filter((x) => x.year === year && x.grade === 'GI');
  stats.push({ year, races, starts, live: live.length, total: world.horses.size, abil, cur, ms: Date.now() - ty });
  if (!QUIET) {
    console.log(
      `${year}  レース${String(races).padStart(5)}  出走${String(starts).padStart(6)}  `
      + `現役${String(live.length).padStart(5)}  総${String(world.horses.size).padStart(6)}  `
      + `潜在平均${abil.toFixed(3)}  現在平均${cur.toFixed(3)}  GI ${g1.length}  ${Date.now() - ty}ms`,
    );
  }
}

// 健全性のチェック。
const problems = [];
const last = stats[stats.length - 1];
const first = stats[0];
if (Math.abs(last.abil - first.abil) > 0.08) {
  problems.push(`潜在能力の平均が ${first.abil.toFixed(3)} → ${last.abil.toFixed(3)} と動いた（平均への回帰が効いていない）`);
}
if (last.live < 1200 || last.live > 4000) problems.push(`現役頭数が ${last.live} 頭（1200〜4000 を想定）`);
if (last.races < 1200) problems.push(`年間レース数が ${last.races}（不成立が多すぎる）`);
const g1PerYear = world.history.filter((x) => x.grade === 'GI').length / YEARS;
if (g1PerYear < 20) problems.push(`GI が年 ${g1PerYear.toFixed(1)} 回しか成立していない`);

const L = computeLeaders(world);
console.log('\n--- 最終年のリーディング ---');
console.log('騎手  :', L.jockeys.slice(0, 5).map((j) => `${j.name} ${j.wins}勝`).join(' / '));
console.log('調教師:', L.trainers.slice(0, 5).map((t) => `${t.name} ${t.wins}勝`).join(' / '));
console.log('種牡馬:', L.sires.slice(0, 5).map((s) => `${s.name} ${formatMoney(s.earnings)}`).join(' / '));

console.log('\n--- 歴代 GI 馬（最後の 8 件）---');
for (const h of world.history.filter((x) => x.grade === 'GI').slice(-8)) {
  console.log(`  ${h.year} ${h.name.padEnd(12, '　')} ${h.winner}（${h.jockey}）${formatTime(h.time)}`);
}

console.log('\n--- 年度代表馬 ---');
for (const a of world.awards) console.log(`  ${a.year} ${a.name}`);

// セーブとロードの往復。
const json = toJSON({ world, version: 2 });
const back = fromJSON(json);
if (back.world.horses.size !== world.horses.size) problems.push('セーブ往復で頭数が変わった');
if (back.world.year !== world.year) problems.push('セーブ往復で年が変わった');
console.log(`\nセーブサイズ ${(json.length / 1024 / 1024).toFixed(2)} MB`);

// 強い馬の例。
const top = [...world.horses.values()].sort(byDesc((h) => h.earnings)).slice(0, 5);
console.log('\n--- 歴代獲得賞金 ---');
for (const h of top) {
  console.log(`  ${h.name.padEnd(10, '　')} ${h.starts}戦${h.wins}勝 ${formatMoney(h.earnings)} ${(h.titles ?? []).join(',')}`);
}

console.log(`\n総時間 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (problems.length) {
  console.log('\n問題:');
  for (const p of problems) console.log(' -', p);
  process.exit(1);
}
console.log('\n世界: OK');
