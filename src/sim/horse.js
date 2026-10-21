// 馬のモデル。
//
// 能力は「潜在能力 pot（生まれた瞬間に決まる上限）」と
// 「現在値 cur（調教と出走で pot に近づく）」の二層。
// 画面に出すのは cur の評価だけで、pot は見えない。これがいちばん
// 「走らせてみないと分からない」感じを作る。

import { SEX, COATS, STYLES, ABILITIES, GROWTH, GROWTH_CURVE, PHYS, distCategory } from './params.js';
import { clamp, clamp01, lerp, rankOf } from '../core/util.js';
import { SURFACE } from './course.js';

let nextId = 1;
export function resetHorseIds(n = 1) {
  nextId = n;
}
export function peekHorseId() {
  return nextId;
}

/**
 * 空の馬を作る。能力は呼び出し側（breeding / world）が入れる。
 */
export function createHorse(rng, {
  name, sex, birthYear, sireId = null, damId = null, farmId = null, ownerId = null,
} = {}) {
  return {
    id: nextId++,
    name,
    sex,
    birthYear,
    coat: rng.weighted(COATS, [40, 18, 16, 3, 10, 7, 3, 1]),
    sireId, damId,
    farmId, ownerId,
    trainerId: null,
    jockeyId: null,       // 主戦騎手
    stable: 'pasture',    // 'stable'（在厩）| 'pasture'（放牧）| 'retired'
    pot: { speed: 0.5, stamina: 0.5, power: 0.5, guts: 0.5, wit: 0.5 },
    cur: { speed: 0.2, stamina: 0.2, power: 0.2, guts: 0.2, wit: 0.2 },
    growth: '普通',
    style: 0.5,           // 0 = 逃げたい、1 = 後ろから。脚質の素
    styleFlex: 0.4,       // 指示への従順さ。低いと折り合いを欠く
    dist: 1800,           // 最適距離（m）
    distRange: 400,       // ここから離れるほど力を出せない幅
    turf: 0.7, dirt: 0.5, // 馬場適性 0..1
    firm: 0.8, soft: 0.5, // 良／重 適性
    temper: 0.5,          // 気性（高いほど素直）
    sound: 0.6,           // 丈夫さ
    spirit: 0.5,          // 底力（大レースで踏ん張る）
    // 状態
    cond: 0.6,            // 調子
    fit: 0.1,             // 仕上がり
    fatigue: 0,           // 疲労
    injury: null,         // { weeks, name }
    weightKg: 460,        // 馬体重
    // 戦績
    starts: 0, wins: 0, seconds: 0, thirds: 0, earnings: 0,
    record: [],           // { year, week, raceId, name, grade, order, field, time, last3f, odds, jockeyId }
    retired: false, dead: false, debutYear: null,
    // 繁殖
    stallion: false, broodmare: false, studFee: 0, coverings: 0, foals: [],
    notes: [],
  };
}

export const horseAge = (horse, year) => year - horse.birthYear;

/** 成長率。age に対する発現率と、仕上がり・調子を掛けた「いま出せる力」。 */
export function growthFactor(horse, year) {
  const age = clamp(horseAge(horse, year), 0, 8);
  const curve = GROWTH_CURVE[horse.growth] || GROWTH_CURVE['普通'];
  return curve[age] ?? 0.6;
}

/**
 * レース当日に発揮される能力。
 * 現在値 × 成長率 × 仕上がり × 調子 − 疲労。
 */
export function effectiveAbility(horse, year, { ignoreCondition = false } = {}) {
  const g = growthFactor(horse, year);
  const fit = ignoreCondition ? 1 : lerp(0.72, 1.06, clamp01(horse.fit));
  const cond = ignoreCondition ? 1 : lerp(0.88, 1.07, clamp01(horse.cond));
  const tired = ignoreCondition ? 1 : 1 - clamp01(horse.fatigue) * 0.18;
  const k = g * fit * cond * tired;
  const out = {};
  for (const a of ABILITIES) out[a] = clamp01(horse.cur[a] * k);
  return out;
}

/** 距離適性（0..1）。最適距離から離れるほど落ちる。 */
export function distanceAptitude(horse, distance) {
  const d = Math.abs(distance - horse.dist);
  const r = Math.max(120, horse.distRange);
  // 二次で落ちると適性外がきつすぎるので、1.6 乗にしている。
  const x = d / r;
  return clamp01(1 - 0.42 * Math.pow(x, 1.6));
}

/** 馬場適性（0..1）。 */
export function surfaceAptitude(horse, surface) {
  return surface === SURFACE.DIRT ? horse.dirt : horse.turf;
}

/** 馬場状態適性（0..1）。良〜不良を firm/soft で補間する。 */
export function groundAptitude(horse, groundIndex) {
  const t = clamp01(groundIndex / 3);
  return lerp(horse.firm, horse.soft, t);
}

/** 脚質ラベル。style の素値から 4 分類に落とす。 */
export function styleLabel(horse) {
  const s = horse.style;
  if (s < 0.22) return '逃げ';
  if (s < 0.5) return '先行';
  if (s < 0.78) return '差し';
  return '追込';
}

/** 脚質ラベル → style の目標値。騎乗指示に使う。 */
export const STYLE_TARGET = { 逃げ: 0.08, 先行: 0.33, 差し: 0.62, 追込: 0.9 };

/** 距離適性を「短 マ 中 長」の記号で見せる。 */
export function distanceChart(horse) {
  const marks = [1200, 1400, 1600, 1800, 2000, 2400, 3000];
  return marks.map((m) => ({ m, apt: distanceAptitude(horse, m) }));
}

/** 画面表示用。能力の評価と総合。 */
export function horseSummary(horse, year) {
  const eff = effectiveAbility(horse, year);
  const ranks = {};
  for (const a of ABILITIES) ranks[a] = rankOf(eff[a]);
  return {
    age: horseAge(horse, year),
    ranks,
    total: ABILITIES.reduce((t, a) => t + eff[a], 0) / ABILITIES.length,
    style: styleLabel(horse),
    distCategory: distCategory(horse.dist),
  };
}

/**
 * 出走による疲労と成長。
 * 出走は調教よりも大きく伸ばすが、疲労も溜まる。若いほど伸びる。
 */
export function applyRaceEffect(horse, rng, { year, distance, order, field, hard }) {
  const age = horseAge(horse, year);
  const room = {}; // pot までの伸びしろ
  let grew = false;
  const youth = clamp01((7 - age) / 5);
  const gain = (0.012 + 0.020 * youth) * (hard ? 1.25 : 1);
  for (const a of ABILITIES) {
    room[a] = horse.pot[a] - horse.cur[a];
    if (room[a] > 0.001) {
      // 伸びしろの大きい項目から埋まる。レース経験は賢さを特に伸ばす。
      const w = a === 'wit' ? 1.5 : 1;
      horse.cur[a] = clamp01(horse.cur[a] + Math.min(room[a], gain * w * rng.range(0.4, 1.4)));
      grew = true;
    }
  }
  // 長距離・激戦は疲労が大きい。
  const load = 0.26 + (distance - 1200) / 1200 * 0.14 + (hard ? 0.10 : 0);
  horse.fatigue = clamp01(horse.fatigue + load * rng.range(0.85, 1.15));
  horse.fit = clamp01(horse.fit - 0.1);
  // 掲示板内に入れると気分が上がる（調子に乗る）。
  horse.cond = clamp01(horse.cond + (order <= Math.max(3, field * 0.2) ? 0.05 : -0.06));
  return grew;
}

/** 怪我の抽選。疲労と丈夫さで決まる。 */
const INJURIES = [
  { name: '軽度の屈腱炎', weeks: 24, severity: 0.5 },
  { name: '屈腱炎', weeks: 48, severity: 0.9 },
  { name: 'ソエ', weeks: 6, severity: 0.15 },
  { name: '骨折（剥離）', weeks: 20, severity: 0.45 },
  { name: '繋ぎの炎症', weeks: 8, severity: 0.2 },
  { name: '脚部不安', weeks: 4, severity: 0.1 },
];
export function rollInjury(horse, rng, { extra = 0 } = {}) {
  const risk = (0.004 + horse.fatigue * 0.055 + extra) * (1.7 - horse.sound);
  if (!rng.chance(risk)) return null;
  const inj = rng.weighted(INJURIES, [14, 4, 26, 8, 20, 28]);
  horse.injury = { name: inj.name, weeks: Math.round(inj.weeks * rng.range(0.6, 1.2)) };
  horse.stable = 'pasture';
  horse.fit = 0;
  // 重い故障は能力そのものを削る。治っても元には戻らない。
  if (inj.severity > 0.4) {
    for (const a of ABILITIES) {
      horse.pot[a] = clamp01(horse.pot[a] - inj.severity * 0.06 * rng.range(0.5, 1.5));
      horse.cur[a] = Math.min(horse.cur[a], horse.pot[a]);
    }
    horse.sound = clamp01(horse.sound - inj.severity * 0.12);
  }
  horse.notes.push(`${horse.injury.name}（${horse.injury.weeks}週）`);
  return horse.injury;
}

/** 週ごとの回復。 */
export function weeklyRecover(horse, rng) {
  if (horse.injury) {
    horse.injury.weeks--;
    if (horse.injury.weeks <= 0) horse.injury = null;
    horse.fatigue = clamp01(horse.fatigue - 0.07);
    return;
  }
  const rest = horse.stable === 'pasture' ? 0.16 : 0.08;
  horse.fatigue = clamp01(horse.fatigue - rest * rng.range(0.8, 1.2));
  // 調子は 0.5 を中心にゆらぐ。放牧中は上がりやすい。
  const pull = horse.stable === 'pasture' ? 0.62 : 0.55;
  horse.cond = clamp01(horse.cond + (pull - horse.cond) * 0.22 + rng.normal(0, 0.035));
  if (horse.stable === 'pasture') horse.fit = clamp01(horse.fit - 0.05);
}

/** 出走可能か。 */
export function canRun(horse, year) {
  if (horse.retired || horse.dead || horse.injury) return false;
  if (horse.stable !== 'stable') return false;
  const age = horseAge(horse, year);
  return age >= 2 && age <= 10;
}

/** 引退の判断に使う「もう上は望めない」度合い。 */
export function pastPrime(horse, year) {
  const age = horseAge(horse, year);
  const curve = GROWTH_CURVE[horse.growth];
  const now = curve[clamp(age, 0, 8)] ?? 0.6;
  const best = Math.max(...curve);
  return age >= 5 && now < best * 0.96;
}

export { SEX, STYLES, GROWTH, ABILITIES, PHYS };
