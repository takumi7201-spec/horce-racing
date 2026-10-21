// 交配と仔の生成。
//
// 設計上いちばん気をつけたのは「平均への回帰」。
// 両親の平均をそのまま渡すと、数十年で全馬が上限に張り付いて世界が壊れる。
// 回帰項を入れておくと、名馬の仔がそこそこで終わることもあり、
// 無名の牝馬から大物が出ることもある、という当たり前の揺らぎが出る。

import { createHorse, resetHorseIds } from './horse.js';
import { SEX, ABILITIES, GROWTH, COATS } from './params.js';
import { clamp01, clamp, lerp } from '../core/util.js';
import { inbreedings, inbreedEffect, nicksValue, nicksKey, sireLineRoot } from './pedigree.js';
import { makeHorseName } from '../core/names.js';

/** 競走馬全体の能力の中心。回帰の行き先。 */
export const POP_MEAN = 0.42;
/** 回帰の強さ。0.30 なら両親の平均から 30% だけ全体平均に引き戻される。 */
export const REGRESSION = 0.26;

/**
 * 仔を作る。
 * @param {object} world  nicks / horses / nameSet を持つ世界
 * @param {object} rng
 * @param {object} sire 種牡馬
 * @param {object} dam  繁殖牝馬
 * @param {{year:number, farmId?:string, ownerId?:string}} opts
 */
export function breed(world, rng, sire, dam, { year, farmId = null, ownerId = null } = {}) {
  const ib = inbreedings(world, sire.id, dam.id);
  const ibe = inbreedEffect(ib);
  const nk = nicksValue(world, sire.id, dam.id);

  const foal = createHorse(rng, {
    name: makeHorseName(rng, { used: world.nameSet, kanmei: world.owners.get(ownerId)?.kanmei }),
    sex: rng.chance(0.5) ? SEX.MALE : SEX.FEMALE,
    birthYear: year,
    sireId: sire.id, damId: dam.id,
    farmId, ownerId,
  });

  // --- 能力 ---
  // 項目ごとに父母から別々に抽選する。父のスピードと母のスタミナ、という
  // 組み合わせが出るようにしたいので、一括平均にはしない。
  const bonus = ibe.gain * 0.085 + (nk.value ?? 0) * 0.055;
  for (const a of ABILITIES) {
    const mid = sire.pot[a] * 0.5 + dam.pot[a] * 0.5;
    const regressed = lerp(mid, POP_MEAN, REGRESSION);
    // 分散は親の能力が高いほど大きい（大物も駄馬も出る）。
    const sd = 0.095 + mid * 0.075;
    foal.pot[a] = clamp01(regressed + rng.normal(0, sd) + bonus);
    // 初期の現在値は潜在の 2 割程度。ここから調教と出走で埋めていく。
    foal.cur[a] = clamp01(foal.pot[a] * rng.range(0.16, 0.26));
  }

  // --- 距離適性 ---
  // 両親の最適距離の中間に寄るが、たまに大きく外れる（突然変異的な短距離馬）。
  const midDist = sire.dist * 0.5 + dam.dist * 0.5;
  foal.dist = clamp(Math.round((midDist + rng.normal(0, 260)) / 100) * 100, 1000, 3400);
  if (rng.chance(0.06)) foal.dist = clamp(foal.dist + rng.pick([-600, 600]), 1000, 3400);
  foal.distRange = clamp(Math.round((sire.distRange + dam.distRange) / 2 + rng.normal(0, 90)), 160, 900);

  // --- 馬場適性 ---
  foal.turf = clamp01((sire.turf + dam.turf) / 2 + rng.normal(0, 0.12));
  foal.dirt = clamp01((sire.dirt + dam.dirt) / 2 + rng.normal(0, 0.12));
  // どちらも低いと走る場所が無いので、高い側を底上げする。
  const best = Math.max(foal.turf, foal.dirt);
  if (best < 0.55) {
    if (foal.turf >= foal.dirt) foal.turf = clamp01(foal.turf + (0.6 - best));
    else foal.dirt = clamp01(foal.dirt + (0.6 - best));
  }
  foal.firm = clamp01((sire.firm + dam.firm) / 2 + rng.normal(0, 0.12));
  foal.soft = clamp01((sire.soft + dam.soft) / 2 + rng.normal(0, 0.14));

  // --- 脚質・気性 ---
  foal.style = clamp01((sire.style + dam.style) / 2 + rng.normal(0, 0.17));
  foal.styleFlex = clamp01((sire.styleFlex + dam.styleFlex) / 2 + rng.normal(0, 0.14));
  foal.temper = clamp01((sire.temper + dam.temper) / 2 + rng.normal(0, 0.15));
  // インブリードのリスクは丈夫さと気性に出る。能力だけ上がる都合のいい配合は無い。
  foal.sound = clamp01((sire.sound + dam.sound) / 2 + rng.normal(0, 0.12) - ibe.risk * 0.22);
  foal.temper = clamp01(foal.temper - ibe.risk * 0.10);
  foal.spirit = clamp01((sire.spirit + dam.spirit) / 2 + rng.normal(0, 0.13) + ibe.gain * 0.06);

  // --- 成長型 ---
  // 親と同じ型が出やすいが固定ではない。
  const growthPool = [sire.growth, dam.growth, ...GROWTH];
  foal.growth = rng.weighted(growthPool, [3, 3, 1, 1.4, 1, 0.9]);

  // --- 毛色 ---
  // 芦毛は優性。片親が芦毛なら半分の確率で芦毛になる。
  if (sire.coat === '芦毛' || dam.coat === '芦毛') {
    foal.coat = rng.chance(0.5) ? '芦毛' : rng.pick([sire.coat, dam.coat].filter((c) => c !== '芦毛').concat(['鹿毛']));
  } else if (sire.coat === '白毛' || dam.coat === '白毛') {
    foal.coat = rng.chance(0.5) ? '白毛' : rng.pick([sire.coat, dam.coat]);
  } else {
    foal.coat = rng.chance(0.78) ? rng.pick([sire.coat, dam.coat]) : rng.pick(COATS.slice(0, 6));
  }

  foal.weightKg = Math.round(clamp((sire.weightKg + dam.weightKg) / 2 + rng.normal(0, 18), 390, 560));
  foal.nicksKey = nk.key;
  foal.inbreedLabels = ib.map((x) => `${x.name} ${x.label}`);
  foal.matingBonus = bonus;

  dam.foals.push(foal.id);
  sire.coverings = (sire.coverings ?? 0) + 1;
  return foal;
}

/**
 * 繁殖牝馬として供用できるか。
 * 現役を引退した牝馬で、年齢が上がり過ぎていないもの。
 */
export function canBeBroodmare(horse, year) {
  return horse.sex === SEX.FEMALE && !horse.dead
    && (year - horse.birthYear) >= 3 && (year - horse.birthYear) <= 20;
}

/** 種牡馬になれるか。牡で、ある程度の実績か能力がある馬。 */
export function canBeStallion(horse, year) {
  if (horse.sex !== SEX.MALE || horse.dead) return false;
  const age = year - horse.birthYear;
  if (age < 3 || age > 24) return false;
  const ab = ABILITIES.reduce((t, a) => t + horse.pot[a], 0) / ABILITIES.length;
  // 重賞勝ちか、相当の素質。条件馬が種牡馬になれては世界が薄まる。
  return horse.earnings >= 8000 || ab >= 0.66;
}

/**
 * 種付料の算定（万円）。
 * 現役成績と、産駒が走り出してからは産駒成績で動く。
 * 走る産駒が出ると翌年に跳ね上がるのが種牡馬ビジネスの手触り。
 */
export function studFeeOf(world, stallion, year) {
  const ab = ABILITIES.reduce((t, a) => t + stallion.pot[a], 0) / ABILITIES.length;
  let base = 30 + Math.pow(clamp01(ab - 0.3) / 0.7, 2) * 900;
  base += Math.min(1200, stallion.earnings / 24);
  // 産駒成績。
  let progeny = 0, runners = 0;
  for (const fid of stallion.foals ?? []) {
    const f = world.horses.get(fid);
    if (!f || f.starts === 0) continue;
    runners++;
    progeny += f.earnings;
  }
  if (runners >= 4) {
    const avg = progeny / runners;
    base = base * 0.45 + Math.min(6000, avg * 1.6) * 0.75;
  }
  // 年を取ると下がる。
  const age = year - stallion.birthYear;
  if (age > 16) base *= Math.max(0.3, 1 - (age - 16) * 0.09);
  return Math.max(10, Math.round(base / 10) * 10);
}

/** 受胎するか。高齢の繁殖牝馬は空胎が増える。 */
export function conceives(rng, dam, year) {
  const age = year - dam.birthYear;
  let p = 0.88;
  if (age >= 14) p -= (age - 13) * 0.055;
  if (age <= 4) p -= 0.05;
  return rng.chance(clamp01(p));
}

export { resetHorseIds, nicksKey, sireLineRoot };
