// 騎手と調教師。
//
// 騎手は「最高速をわずかに、位置取りの精度を大きく」左右する。
// 強い騎手に乗せ替えると 0.5 秒くらい変わる、という感触を狙っている。

import { makePersonName } from '../core/names.js';
import { clamp01, lerp } from '../core/util.js';

let nextJockeyId = 1;
let nextTrainerId = 1;

export function createJockey(rng, { year, used, region = '関東' }) {
  const age = rng.irange(18, 46);
  // 若手は伸びしろ、ベテランは完成。トップは全体の数パーセントだけ。
  const pot = clamp01(rng.weighted([0.42, 0.56, 0.70, 0.84, 0.94], [34, 32, 20, 10, 4])
    + rng.normal(0, 0.05));
  const maturity = clamp01((age - 17) / 12);
  return {
    id: nextJockeyId++,
    kind: 'jockey',
    name: makePersonName(rng, { used, female: rng.chance(0.05) }),
    age, region,
    pot,
    skill: clamp01(lerp(pot * 0.45, pot, maturity)),
    aggression: clamp01(rng.normal(0.5, 0.17)),  // 積極性（ペースに出る）
    weightSkill: clamp01(rng.normal(0.5, 0.2)),  // 減量のうまさ（軽斤量に乗れる）
    loyalty: clamp01(rng.normal(0.5, 0.2)),      // 専属にできるか
    wins: 0, starts: 0, g1: 0, earnings: 0,
    retired: false,
    debutYear: year - (age - 18),
    fee: 0,
  };
}

export function createTrainer(rng, { year, used, region = '関東' }) {
  const age = rng.irange(32, 66);
  const pot = clamp01(rng.weighted([0.40, 0.55, 0.70, 0.85, 0.94], [32, 33, 21, 10, 4])
    + rng.normal(0, 0.05));
  return {
    id: nextTrainerId++,
    kind: 'trainer',
    name: makePersonName(rng, { used }),
    age, region,
    skill: pot,
    // 得意分野。これで「この厩舎に預けると仕上がる」が変わる。
    style: rng.pick(['仕上げ上手', '素材重視', '持久型', '短距離型', 'ダート巧者', '堅実']),
    capacity: rng.irange(14, 30),
    wins: 0, starts: 0, g1: 0, earnings: 0,
    retired: false,
    horses: [],
  };
}

/** 調教師の得意分野による補正。training.js と world.js から引く。 */
export function trainerBonus(trainer, { surface, distance } = {}) {
  const b = { fit: 1, growth: 1, injury: 1 };
  if (!trainer) return b;
  switch (trainer.style) {
    case '仕上げ上手': b.fit = 1.18; break;
    case '素材重視': b.growth = 1.16; b.fit = 0.94; break;
    case '持久型': if (distance >= 2200) b.fit = 1.12; break;
    case '短距離型': if (distance && distance <= 1600) b.fit = 1.12; break;
    case 'ダート巧者': if (surface === 'ダート') b.fit = 1.14; break;
    case '堅実': b.injury = 0.8; break;
  }
  return b;
}

/** 騎手の成長・引退。毎年 1 回呼ぶ。 */
export function ageJockey(jockey, rng, year) {
  jockey.age++;
  const maturity = clamp01((jockey.age - 17) / 12);
  const target = lerp(jockey.pot * 0.45, jockey.pot, maturity);
  // 実戦の積み上げで伸びる。勝てないと伸びない。
  const momentum = jockey.starts > 0 ? clamp01(jockey.wins / jockey.starts * 6) : 0.2;
  jockey.skill = clamp01(jockey.skill + (target - jockey.skill) * (0.3 + momentum * 0.4));
  if (jockey.age > 44) jockey.skill = clamp01(jockey.skill - (jockey.age - 44) * 0.012);
  if (jockey.age >= 48 && rng.chance(0.18 + (jockey.age - 48) * 0.1)) jockey.retired = true;
  if (jockey.age >= 60) jockey.retired = true;
}

export function ageTrainer(trainer, rng) {
  trainer.age++;
  if (trainer.age >= 70) trainer.retired = true;
  else if (trainer.age >= 64 && rng.chance(0.2)) trainer.retired = true;
}

/** 騎乗依頼を受けてくれるか。格の高いレースは人気騎手の取り合いになる。 */
export function acceptsRide(jockey, rng, { classOrder, horseStrength, offeredBy }) {
  // 自分の格より下のレースで弱い馬だと断る。
  const demand = jockey.skill;
  const appeal = clamp01(classOrder / 8 * 0.6 + horseStrength * 0.4);
  const p = clamp01(1.15 - demand + appeal * 0.9 + (offeredBy === 'player' ? 0.05 : 0));
  return rng.chance(p);
}

export function resetPersonIds(j = 1, t = 1) {
  nextJockeyId = j;
  nextTrainerId = t;
}
