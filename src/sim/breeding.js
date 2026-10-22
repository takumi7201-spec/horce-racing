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
/** 種牡馬が覚えている産駒の数。種付料の算定と詳細画面の表示に使う。 */
const STALLION_FOAL_MEMORY = 80;

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
  // 種牡馬にも産駒を覚えさせる。覚えないと studFeeOf の産駒成績の項が
  // 永遠に働かず（runners が 0 のまま）、種付料が現役成績だけで決まってしまう。
  // 「走る産駒が出た翌年に種付料が跳ね上がる」という種牡馬ビジネスの軸が
  // まるごと死んでいた。馬の詳細に産駒が出ないのも同じ原因。
  // 20 年供用すると 800 頭を超えるので、直近ぶんだけ持つ。
  sire.foals.push(foal.id);
  if (sire.foals.length > STALLION_FOAL_MEMORY) sire.foals.shift();
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

/**
 * 種牡馬になれるか。
 * 実際の競馬で種牡馬入りできる牡馬はごく一握り（1 世代 600 頭から数頭）。
 * ここを緩くすると、10 年で種牡馬が 900 頭を超えて繁殖牝馬の数を上回り、
 * 大半が 1 頭も種付けしないまま名簿に載り続ける。
 */
export function canBeStallion(horse, year) {
  if (horse.sex !== SEX.MALE || horse.dead) return false;
  const age = year - horse.birthYear;
  if (age < 3 || age > 24) return false;
  const ab = ABILITIES.reduce((t, a) => t + horse.pot[a], 0) / ABILITIES.length;
  // GI を複数勝つくらいの実績か、飛び抜けた素質。
  return horse.earnings >= 30000 || ab >= 0.76;
}

/**
 * 種付料の算定（万円）。
 * 現役成績と、産駒が走り出してからは産駒成績で動く。
 * 走る産駒が出ると翌年に跳ね上がるのが種牡馬ビジネスの手触り。
 */
export function studFeeOf(world, stallion, year) {
  const ab = ABILITIES.reduce((t, a) => t + stallion.pot[a], 0) / ABILITIES.length;
  // 供用し始めの値段。ここを高くすると、産駒が走る前の種牡馬が全員高額になり、
  // 資金の乏しい馬主が配合できる相手がいなくなる。
  // 現役成績はあくまで「期待値」なので控えめに乗せ、本番は産駒成績で動かす。
  let base = 30 + Math.pow(clamp01(ab - 0.3) / 0.7, 2) * 520;
  base += Math.min(600, stallion.earnings / 60);
  // 産駒成績。
  let progeny = 0, runners = 0;
  for (const fid of stallion.foals ?? []) {
    const f = world.horses.get(fid);
    if (!f || f.starts === 0) continue;
    runners++;
    progeny += f.earnings;
  }
  if (runners >= 6) {
    const avg = progeny / runners;
    // 対数で効かせる。絶対額で頭打ちにすると、そこそこ走る産駒を出した
    // 種牡馬が全員おなじ種付料に貼り付いて、順位が意味を失う。
    // 尺度は実際の日本の相場に合わせる（2026 年の最高はキタサンブラック・
    // イクイノックスの 2,500万）。以前は最高 7,000万まで上がる尺度で、
    // 実在の種牡馬を入れたら架空の種牡馬の方が 3 倍高い世界になった。
    // この世界の産駒は実際より稼ぐ（上位の種牡馬で産駒平均 2 億前後）ので、
    // 金額ではなく分布の位置で合わせてある。
    //   産駒平均 4,600万 → 約 300万 ／ 1億 → 約 870万 ／ 2.2億 → 約 2,100万
    const score = Math.log10(1 + avg / 1200);
    // 標本の数で効かせ方を変える。4 頭が走っただけで種付料を決めると、
    // たまたま走った数頭で最上位に飛び出す種牡馬が毎年入れ替わる。
    const conf = Math.min(1, runners / 25);
    // 頭打ちは 2,000 万（＋現役成績ぶんで最大 2,400 万前後）。実在の最高額 2,500 万を
    // 架空の種牡馬が開始時点で超えると、名簿の先頭が知らない馬になる。
    base = base * (1 - conf * 0.65) + conf * Math.min(2000, Math.pow(score, 3.0) * 950);
  }
  // 年を取ると下がる。
  const age = year - stallion.birthYear;
  if (age > 16) base *= Math.max(0.3, 1 - (age - 16) * 0.09);
  // 実在の種牡馬は、名簿に入った年（開始年より前からなら開始年）は各スタリオンの発表額
  // （亡くなった馬は全盛期の目安）にする。そこから毎年 4 分の 1 ずつ、
  // 架空の世界での産駒成績による値へ寄せていく。1975 年に始めて 1991 年に輸入される
  // サンデーサイレンスは、1991 年の時点で史実の額から始まる。
  if (stallion.realFee) {
    const since = Math.max(0, year - (stallion.realFeeFrom ?? world.startYear ?? year));
    const k = Math.pow(0.75, since);
    base = base * (1 - k) + stallion.realFee * k;
  }
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
