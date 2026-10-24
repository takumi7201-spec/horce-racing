// 競馬界。
//
// シードひとつから、血統が 20 年以上さかのぼれる架空の競馬界を作る。
// 創始種牡馬から紙の上で世代を重ね、現役世代だけを「本物」として走らせる。
// こうしないとゲーム開始時の血統表が空っぽになり、配合に意味が生まれない。
//
// 週送りの流れ（advanceWeek）
//   1. 馬場状態と天候を決める
//   2. その週の番組を作る
//   3. NPC の出走申し込み → 枠順 → レース実行
//   4. 結果を戦績・賞金・レコードに反映
//   5. 全馬の調教／放牧／回復
//   6. 年末ならリーディング集計・加齢・引退・配合・出産

import { makeRng, hashSeed } from '../core/rng.js';
import { makeHorseName, makePersonName, makeFarmName, makeOwnerName, KANMEI } from '../core/names.js';
import {
  createHorse, resetHorseIds, peekHorseId, horseAge, canRun, weeklyRecover,
  applyRaceEffect, rollInjury, pastPrime, effectiveAbility, distanceAptitude,
} from './horse.js';
import {
  SEX, ABILITIES, GROWTH, GROWTH_CURVE, GROUNDS, CLASSES, CLASS_BY_ID,
  classForWins, classOrder, standardWeight, WEEKS_PER_YEAR, weekToMonth, COST,
  JOCKEY_CUT, TRAINER_CUT, STYLES, START_MONEY,
} from './params.js';
import { SURFACE, allCourses, distancesOf } from './course.js';
import {
  racesOfWeek, eligible, GRADED, GRADED_BY_ID, TRIPLE_CROWN, TRIPLE_CROWN_F,
  weekLabel, meetingsOf, gradedCalendar,
} from './schedule.js';
import { simulateRace, computeOdds } from './race.js';
import { createJockey, createTrainer, ageJockey, ageTrainer, resetPersonIds, acceptsRide } from './jockey.js';
import { breed, canBeBroodmare, canBeStallion, studFeeOf, conceives, POP_MEAN } from './breeding.js';
import { trainWeek, pastureWeek, autoMenu } from './training.js';
import { sireLineRoot, nicksKey, recordNicksResult, breedQuality, lineLabel, grantFactors, establishLines } from './pedigree.js';
import { clamp, clamp01, lerp, sum, byDesc } from '../core/util.js';
import {
  seedRealHorses, syncRealStud, syncRealMares, settleRealHorses, realNewYear, realCoverings, bornReal,
} from './realsires.js';
import { W } from './schedule.js';

/**
 * 1 世代あたりの産駒数。
 * 現役（2〜7 歳）が 2000 頭前後になるよう決めている。
 * 年間 1000 レース × 14 頭 ＝ 14000 出走を、1 頭 7 走で割った数。
 * ここを削ると条件戦が不成立だらけになり、増やすと週送りが重くなる。
 */
const FOALS_LIVE = 600;
/**
 * 血統をさかのぼる年数。
 * サラブレッドの世代間隔は実際に 8〜10 年あるので（牝馬は 4 歳から 18 歳まで
 * 産む）、5 代血統表を埋めるには 40 年以上の歴史が要る。24 年だと 3 代で
 * 血統表が尽きて、インブリードもニックスも成立しない。
 */
const ANCESTRY_YEARS = 56;

/** 供用される種牡馬の上限。JRA の現役種牡馬はおおむね 200 頭前後。 */
const MAX_STALLIONS = 200;

/** 天候。 */
export const WEATHERS = ['晴', '曇', '小雨', '雨', '雪'];

// ---------------------------------------------------------------- 世界の生成

export function createWorld(seed, { startYear = 2026, playerName = '', farmName = '', realSires = true } = {}) {
  const rng = makeRng(typeof seed === 'string' ? hashSeed(seed) : seed);
  resetHorseIds(1);
  resetPersonIds(1, 1);

  const world = {
    seed, startYear, realSires,
    year: startYear, week: 1,
    rng,
    horses: new Map(),
    jockeys: new Map(),
    trainers: new Map(),
    owners: new Map(),
    farms: [],
    nicks: new Map(),
    nicksStats: new Map(),
    nameSet: new Set(),
    personNames: new Set(),
    stallionPool: [],
    marePool: [],
    records: new Map(),     // コースレコード
    results: [],            // 直近のレース結果（週単位で差し替え）
    history: [],            // 重賞の勝ち馬（年×レース）
    news: [],
    leaders: { jockeys: [], trainers: [], sires: [], owners: [] },
    awards: [],             // 年度代表馬など
    player: null,
    pendingMatings: [],     // 今年の配合予約
    log: [],
  };

  // --- 人と組織 ---
  for (let i = 0; i < 24; i++) {
    world.farms.push({
      id: `farm${i + 1}`,
      name: makeFarmName(rng, world.personNames),
      quality: clamp01(rng.normal(0.5, 0.18)),  // 育成の上手さ
      region: rng.pick(['日高', '胆振', '十勝', '青森']),
    });
  }
  for (let i = 0; i < 70; i++) {
    const o = {
      id: `owner${i + 1}`,
      name: makeOwnerName(rng, world.personNames),
      kanmei: rng.chance(0.55) ? rng.pick(KANMEI) : null,
      money: Math.round(rng.range(5000, 120000)),
      ambition: clamp01(rng.normal(0.5, 0.2)),
      horses: [],
    };
    world.owners.set(o.id, o);
  }
  for (let i = 0; i < 110; i++) {
    const j = createJockey(rng, { year: startYear, used: world.personNames, region: rng.chance(0.5) ? '関東' : '関西' });
    world.jockeys.set(j.id, j);
  }
  for (let i = 0; i < 90; i++) {
    const t = createTrainer(rng, { year: startYear, used: world.personNames, region: rng.chance(0.5) ? '関東' : '関西' });
    world.trainers.set(t.id, t);
  }

  // --- 実在の馬とその祖先 ---
  // 架空の馬より先に作って名前を予約する（同名の架空馬が生まれないように）。
  // 開始年より前に生まれた馬だけを作り、あとの馬は史実の年に生まれる・輸入される。
  const liveReal = realSires ? seedRealHorses(world, rng) : [];

  // --- 創始世代 ---
  const Y0 = startYear;
  const foundYear = Y0 - ANCESTRY_YEARS - 4;
  for (let i = 0; i < 18; i++) {
    const h = foundationHorse(world, rng, { year: foundYear, sex: SEX.MALE, level: 0.66, sd: 0.11 });
    h.earnings = Math.round(rng.range(20000, 90000));
    h.wins = rng.irange(6, 14);
    h.starts = h.wins + rng.irange(3, 12);
    h.stallion = true;
    world.stallionPool.push(h.id);
  }
  for (let i = 0; i < 140; i++) {
    const h = foundationHorse(world, rng, { year: foundYear, sex: SEX.FEMALE, level: 0.46, sd: 0.12 });
    h.earnings = Math.round(rng.range(300, 12000));
    h.broodmare = true;
    world.marePool.push(h.id);
  }

  // --- 紙の上で世代を重ねる ---
  for (let y = foundYear + 4; y <= Y0; y++) {
    const age = Y0 - y;
    const n = age > 20 ? 55 : age > 11 ? 70 : age > 7 ? 110 : FOALS_LIVE;
    // y 年生まれの世代は前の年の種付け。その年に日本で供用されていた実在の種牡馬を並べる。
    syncRealStud(world, y - 1);
    syncRealMares(world, y);
    const pairs = pairMares(world, rng, y, n);
    // 開始年の世代はまだ生まれていない（誕生は 4 月）。受胎させておき、4 月に産ませる。
    if (y === Y0) {
      for (const { dam, sire } of pairs) dam.pregnancy = { sireId: sire.id, year: y };
      promotePools(world, rng, y);
      continue;
    }
    const cohort = breedPairs(world, rng, pairs, y);
    // 2 歳以上は紙の戦績を持たせる。でないとゲーム開始時に全馬が無印になる。
    // 古い世代は血統表に名前と格が載るだけなので、戦績も粗く済ませる。
    if (age >= 2) for (const h of cohort) paperCareer(world, h, rng, Y0);
    promotePools(world, rng, y);
  }

  // 開始年のシーズンに供用中の実在種牡馬を名簿に揃える（種付料は発表額になる）。
  if (realSires) {
    syncRealStud(world, Y0);
    // 繁殖牝馬は来年生まれる産駒の母として並べる（今年の種付けの相手）。
    syncRealMares(world, Y0 + 1);
    settleRealHorses(world, Y0);
    trimStallions(world, Y0);
    // 開始時点で現役の実在馬（1975 年開始ならトウショウボーイやテンポイント）。
    // 2 歳以上は紙の戦績を持たせる。開始年の 4 月に生まれる名馬は、ここで母に受胎させる。
    for (const h of liveReal) if (Y0 - h.birthYear >= 2) paperCareer(world, h, rng, Y0);
    realCoverings(world, rng, Y0);
  }
  // 名簿の種付料を開始年の値にそろえる。供用を始めた年の値のままだと、
  // 産駒が走って上がった分が翌年まで表に出ない。
  for (const id of world.stallionPool) {
    const h = world.horses.get(id);
    if (h) h.studFee = studFeeOf(world, h, Y0);
  }

  // 血統表に出てこない古い馬は捨てる。放っておくと一万頭を超えてセーブが膨らむ。
  pruneAncestry(world);

  // --- 系統の相性（ニックス）を決める ---
  buildNicks(world, rng);
  // 開始時点で確立している系統（2026 年ならディープインパクト系など）。
  establishLines(world, rng);

  // 開始時点の 1 歳馬はまだ馬名登録前（登録は 1 歳の年末）。仮の名で呼ぶ。
  for (const h of world.horses.values()) {
    if ((h.real && h.retired) || h.birthYear !== Y0 - 1 || h.damId == null) continue;
    h.regName = h.name;
    h.name = provisionalName(world.horses.get(h.damId), h.birthYear);
  }

  // --- 現役馬を厩舎と馬主に割り当てる ---
  assignConnections(world, rng);

  // --- プレイヤー ---
  setupPlayer(world, rng, { playerName, farmName });

  world.news.push(`${startYear}年、${world.player.farmName} が競馬界に参入した。`);
  return world;
}

/** 親の居ない馬。創始世代だけに使う。 */
function foundationHorse(world, rng, { year, sex, level, sd }) {
  const h = createHorse(rng, {
    name: makeHorseName(rng, { used: world.nameSet }),
    sex, birthYear: year,
  });
  for (const a of ABILITIES) {
    h.pot[a] = clamp01(rng.normal(level, sd));
    h.cur[a] = h.pot[a];
  }
  h.growth = rng.pick(GROWTH);
  h.dist = clamp(Math.round(rng.normal(1900, 560) / 100) * 100, 1000, 3400);
  // 長い距離が得意な馬は融通も利く（ステイヤーは 2000m も走れる）。
  // ここを一律にすると、3200m に適性 0.1 の馬が並んで 3 分 50 秒かかる。
  h.distRange = clamp(Math.round(rng.normal(500 + Math.max(0, h.dist - 1800) * 0.16, 150)), 220, 1000);
  // 芝・良馬場が標準なので、そこの適性は高めに寄せる。
  // 「どの馬も馬場が合わない」世界になると、全レースの時計が沈む。
  h.turf = clamp01(rng.normal(0.80, 0.15));
  h.dirt = clamp01(rng.normal(0.62, 0.20));
  h.firm = clamp01(rng.normal(0.84, 0.13));
  h.soft = clamp01(rng.normal(0.56, 0.18));
  h.style = clamp01(rng.normal(0.5, 0.22));
  h.styleFlex = clamp01(rng.normal(0.5, 0.18));
  h.temper = clamp01(rng.normal(0.55, 0.18));
  h.sound = clamp01(rng.normal(0.6, 0.17));
  h.spirit = clamp01(rng.normal(0.5, 0.18));
  h.retired = true;
  h.stable = 'retired';
  world.horses.set(h.id, h);
  return h;
}

/**
 * 種付けできる年齢か。実在の種牡馬は生成中は実際の供用年に従い（20 歳を過ぎて
 * 供用された馬もいる）、始まってからは架空の馬より 3 年長く現役でいられる。
 */
function withinStudAge(world, s, year) {
  if (s.real) return year <= world.startYear || year - s.birthYear <= 27;
  return year - s.birthYear <= 24;
}

/**
 * 実在の繁殖牝馬を種付けの順番の先頭に回す。
 * 1 年に種付けされるのは名簿の一部だけなので、混ぜたままだと名牝が
 * 14 年の繁殖生活で 3 頭しか産まなかった（実際はほぼ毎年産んでいる）。
 * 相手も種付料の 2 乗で選ばせ、一流の種牡馬に偏らせる（名牝に安い種牡馬は付けない）。
 */
function realMaresFirst(world, mares) {
  const real = mares.filter((id) => world.horses.get(id)?.real);
  if (!real.length) return;
  const rest = mares.filter((id) => !world.horses.get(id)?.real);
  mares.length = 0;
  mares.push(...real, ...rest);
}

/**
 * 1 年ぶんの種付けの組み合わせ。繁殖牝馬は年に 1 頭。受胎しなかった牝馬は外れる。
 * year は産駒の生まれ年（種付けはその前の年の 5〜6 月）。
 */
function pairMares(world, rng, year, n, { exclude = null, npcOnly = false } = {}) {
  const mares = world.marePool.filter((id) => {
    const m = world.horses.get(id);
    return m && !m.dead && canBeBroodmare(m, year)
      && !(exclude && exclude.has(id)) && !(npcOnly && m.ownerId === 'player');
  });
  const stallions = world.stallionPool.filter((id) => {
    const s = world.horses.get(id);
    return s && !s.dead && withinStudAge(world, s, year);
  });
  if (mares.length === 0 || stallions.length === 0) return [];

  // 種牡馬は種付料が高いほど多くの牝馬を集める。
  // 供用年を導いた馬（取り込んだ勝ち馬）は無名の種牡馬が多く、実際は集まる牝馬が少ない。
  // 重みを半分にしないと、血統が途中で切れた実在馬が父の半分を占めて血統表の埋まり率が落ちた。
  const fees = stallions.map((id) => {
    const h = world.horses.get(id);
    return Math.max(10, studFeeOf(world, h, year) * (h.studDerived ? 0.5 : 1));
  });
  const eliteFees = fees.map((f) => f * f);
  const pairs = [];
  rng.shuffle(mares);
  realMaresFirst(world, mares);
  for (let i = 0; i < Math.min(n, mares.length); i++) {
    const dam = world.horses.get(mares[i]);
    if (!conceives(rng, dam, year)) continue;
    // 近親交配になりすぎる組み合わせ（父と娘）は牧場が避けて、別の種牡馬を当たる。
    // 見送るだけにすると、名牝は父と同じ一流種牡馬を引きやすいぶん空胎の年が増えた。
    let sire = null;
    for (let k = 0; k < 3 && (!sire || sire.id === dam.sireId); k++) {
      sire = world.horses.get(rng.weighted(stallions, dam.real ? eliteFees : fees));
    }
    if (sire.id === dam.sireId) continue;
    pairs.push({ dam, sire });
  }
  return pairs;
}

/** 組み合わせから仔を産ませる（生成中の世代用。ゲーム中は 4 月の誕生でまとめて産む）。 */
function breedPairs(world, rng, pairs, year) {
  const cohort = [];
  for (const { dam, sire } of pairs) {
    const foal = breed(world, rng, sire, dam, { year });
    world.horses.set(foal.id, foal);
    cohort.push(foal);
  }
  return cohort;
}

/**
 * 紙の上の現役成績。
 * レースを実際に走らせるのは現役世代だけなので、過去の馬は統計で済ませる。
 * 血統表に「GI 3 勝」のような格が並ぶのはここで決まる。
 */
function paperCareer(world, horse, rng, uptoYear) {
  const abil = sum(ABILITIES, (a) => horse.pot[a]) / ABILITIES.length;
  // 今年ぶんは走らせない。ゲームは 1 月 1 週から始まるので、
  // 当年の戦績を先に入れると「まだ行われていないレース」が戦績に並ぶ。
  const lastAge = Math.min(7, uptoYear - horse.birthYear - 1);
  const curve = GROWTH_CURVE[horse.growth];
  for (let age = 2; age <= lastAge; age++) {
    if (horse.dead) break;
    const lvl = abil * (curve[age] ?? 0.8);
    // 2 歳は 6 月以降しか番組が無いので使える回数が少ない。
    const starts = age === 2 ? rng.irange(0, 4) : rng.irange(2, 8);
    for (let i = 0; i < starts; i++) {
      const cls = CLASS_BY_ID.get(horse.classId ?? classForWins(horse.wins));
      const need = 0.30 + classOrder(cls.id) * 0.048;
      const p = clamp01((lvl - need) * 3.4 + 0.07);
      horse.starts++;
      const won = rng.chance(p);
      const field = rng.irange(9, 18);
      // 時計などは残さない。ゲーム開始前のレースは「走った事実」だけを持つ。
      // ここを race と同じ形で持つと、4000 頭ぶんでセーブが 18MB を超える。
      horse.record.push({
        year: horse.birthYear + age, name: cls.name,
        order: won ? 1 : rng.irange(2, field), field, past: 1,
      });
      if (horse.record.length > 8) horse.record.shift();
      if (won) {
        horse.wins++;
        horse.earnings += Math.round(cls.prize * rng.range(0.85, 1.15));
        horse.classId = classForWins(horse.wins);
        // オープンまで上がった馬は重賞も拾う。
        if (classOrder(horse.classId) >= 5 && rng.chance(clamp01((lvl - 0.55) * 2.2))) {
          const g = rng.weighted(['g3', 'g2', 'g1'], [6, 3, 1.2]);
          horse.earnings += CLASS_BY_ID.get(g).prize;
          horse.record.push({
            year: horse.birthYear + age, name: `${g.toUpperCase()} 競走`,
            grade: g.toUpperCase(), order: 1, field: rng.irange(12, 18), past: 1,
          });
          if (g === 'g1') horse.g1Wins = (horse.g1Wins ?? 0) + 1;
        }
      } else if (rng.chance(0.34)) {
        horse.earnings += Math.round(cls.prize * 0.22);
      }
    }
    // 故障と事故。
    if (rng.chance(0.05 * (1.6 - horse.sound))) break;
  }
  horse.classId = classForWins(horse.wins);
  // 現在値は潜在値のほぼ上限まで到達したものとする。
  const reach = clamp01(0.82 + horse.starts * 0.012);
  for (const a of ABILITIES) horse.cur[a] = clamp01(horse.pot[a] * reach);
  horse.fit = 0.2;
  horse.cond = clamp01(rng.normal(0.6, 0.12));
}

/**
 * 種牡馬の名簿を MAX_STALLIONS に整理する。
 * 毎年の登録の後と、世界を作った直後（開始年の供用馬を揃えた後）に呼ぶ。後者を忘れると、
 * 供用年を導いた馬（取り込んだ勝ち馬、開始年に 120 頭ほど）が足されて名簿が 260 頭を超えた。
 */
function trimStallions(world, year) {
  // 種牡馬が多すぎると、大半が 1 頭も種付けしないまま名簿に載り続ける。
  // 牝馬が集まらない馬から用途変更（＝名簿から外す）。
  // 高齢馬は同じ種付料でも先に外す。実際の種牡馬も、産駒が走らなければ
  // 数年で供用をやめるし、走っても歳を取れば退く。
  if (world.stallionPool.length > MAX_STALLIONS) {
    const worth = (id) => {
      const h = world.horses.get(id);
      if (!h) return -1;
      // 実在の種牡馬は 22 歳まで名簿に残す。架空の馬と同じ規則（15 歳から 4 割評価）だと、
      // キズナやロードカナロアがゲーム開始から 4 年で軒並み用途変更になった。
      // 供用年を導いた馬（取り込んだ勝ち馬）は 600 頭を超える。外されない扱いにすると
      // 名簿が実在馬だけで埋まって、架空の種牡馬が居なくなる。
      if (h.real && !h.studDerived) return year - h.birthYear > 22 ? (h.studFee ?? 0) * 0.4 : Infinity;
      return (h.studFee ?? 0) * (year - h.birthYear > 14 ? 0.4 : 1);
    };
    world.stallionPool.sort((a, b) => worth(b) - worth(a));
    for (const id of world.stallionPool.slice(MAX_STALLIONS)) {
      const h = world.horses.get(id);
      if (h) h.stallion = false;
      // 名簿から外れた馬を自分の種牡馬として数え続けると、
      // 種付けもされないのに維持費だけ取られる。
      // 生成中はまだプレイヤーが居ない。
      if (world.player) world.player.stallions = world.player.stallions.filter((x) => x !== id);
    }
    world.stallionPool.length = MAX_STALLIONS;
  }
}

/** 生まれて 4 年経った世代から、次の繁殖・種牡馬を選ぶ。 */
function promotePools(world, rng, year) {
  const born = year - 4;
  const cands = [];
  for (const h of world.horses.values()) {
    if (h.birthYear !== born || h.dead) continue;
    if (h.stallion || h.broodmare) continue; // 創始世代を二重に入れない
    if (h.real) continue;                    // 実在の馬は供用年の表に従う
    cands.push(h);
  }
  // 種牡馬は少数精鋭。実績か素質のある牡馬だけ。
  const males = cands.filter((h) => h.sex === SEX.MALE && canBeStallion(h, year))
    .sort(byDesc((h) => h.earnings + breedQuality(h) * 20000));
  for (const h of males.slice(0, rng.irange(3, 6))) {
    h.stallion = true; h.retired = true; h.stable = 'retired';
    grantFactors(h);
    h.studFee = studFeeOf(world, h, year);
    world.stallionPool.push(h.id);
  }
  // 繁殖牝馬は広く取る。
  const females = cands.filter((h) => h.sex === SEX.FEMALE && !h.dead)
    .sort(byDesc((h) => h.earnings + breedQuality(h) * 8000));
  for (const h of females.slice(0, Math.max(30, Math.floor(females.length * 0.42)))) {
    h.broodmare = true; h.retired = true; h.stable = 'retired';
    grantFactors(h);
    world.marePool.push(h.id);
  }
  // 古い種牡馬・繁殖は外す。
  world.stallionPool = world.stallionPool.filter((id) => {
    const h = world.horses.get(id);
    if (!h) return false;
    // 実在の種牡馬は生成中は供用年の表（syncRealStud）が出し入れする。
    if (h.real && year <= world.startYear) return true;
    if (year - h.birthYear > (h.real ? 26 : 23)) { h.dead = true; return false; }
    return true;
  });
  trimStallions(world, year);
  world.marePool = world.marePool.filter((id) => {
    const h = world.horses.get(id);
    if (!h) return false;
    // 実在の繁殖牝馬は生成中は表に従い、始まってからは 20 歳で繁殖を終えて余生に入る。
    if (h.real && year <= world.startYear) return true;
    if (year - h.birthYear > 20) {
      if (h.real) h.broodmare = false; else h.dead = true;
      return false;
    }
    return true;
  });
}

/**
 * 誰の祖先でもない古い馬を消す。
 * 生成直後に一度だけ呼ぶ。血統表（6 代）と繁殖プールから到達できる馬だけ残す。
 */
function pruneAncestry(world) {
  const keep = new Set();
  const walk = (id, depth) => {
    if (id == null || depth > 6 || keep.has(id)) return;
    const h = world.horses.get(id);
    if (!h) return;
    keep.add(id);
    walk(h.sireId, depth + 1);
    walk(h.damId, depth + 1);
  };
  for (const h of world.horses.values()) {
    if (h.dead) continue;
    if (world.year - h.birthYear <= 11) walk(h.id, 0);
  }
  for (const id of world.stallionPool) walk(id, 0);
  for (const id of world.marePool) walk(id, 0);
  // 実在の馬は数十頭なので全部残す。古い祖先を消すと「○○系」の系統名がたどれなくなる。
  for (const h of world.horses.values()) if (h.real) keep.add(h.id);
  let removed = 0;
  for (const id of [...world.horses.keys()]) {
    if (!keep.has(id)) { world.horses.delete(id); removed++; }
  }
  return removed;
}

/**
 * 古い戦績の細部を落とす。
 * 自分の馬は全部残す（回顧を読むのがこのゲームの楽しみの一つなので）。
 * それ以外は「いつ・何に・何着」だけ残して、時計や回顧文は捨てる。
 */
function pruneRecords(world) {
  const keepYear = world.year;
  for (const h of world.horses.values()) {
    if (h.ownerId === 'player') continue;
    if (!h.record || h.record.length === 0) continue;
    if (h.record.length > 6) h.record = h.record.slice(-6);
    for (const r of h.record) {
      if (r.past || r.year >= keepYear) continue;
      delete r.comment; delete r.passing; delete r.time; delete r.last3f;
      delete r.jockeyName; delete r.weight; delete r.margin; delete r.odds;
      delete r.popularity; delete r.ground; delete r.raceId; delete r.courseId;
      delete r.surface; delete r.distance; delete r.classId; delete r.jockeyId;
      r.past = 1;
    }
  }
}

/** 系統どうしの相性表。隠し値で、産駒が出るほど判明していく。 */
function buildNicks(world, rng) {
  const roots = new Set();
  for (const id of world.stallionPool) roots.add(sireLineRoot(world, id));
  for (const h of world.horses.values()) {
    if (h.sireId != null) roots.add(sireLineRoot(world, h.id));
  }
  const arr = [...roots];
  for (const a of arr) {
    for (const b of arr) {
      // 大半は「―」。はっきり合う／合わない組み合わせだけを少数作る。
      const v = rng.weighted([0, 0, 0.18, 0.42, 0.72, -0.2, -0.45], [30, 24, 12, 7, 3, 10, 5]);
      world.nicks.set(nicksKey(a, b), Number(v.toFixed(2)));
    }
  }
}

/** 現役馬を馬主・厩舎・主戦騎手に結びつける。 */
function assignConnections(world, rng) {
  const owners = [...world.owners.values()];
  const trainers = [...world.trainers.values()].filter((t) => !t.retired);
  const jockeys = [...world.jockeys.values()].filter((j) => !j.retired);
  for (const h of world.horses.values()) {
    const age = horseAge(h, world.year);
    if (h.retired || h.dead || age < 2 || age > 9) continue;
    const o = rng.pick(owners);
    h.ownerId = o.id;
    o.horses.push(h.id);
    const t = rng.pick(trainers);
    h.trainerId = t.id;
    t.horses.push(h.id);
    h.jockeyId = rng.pick(jockeys).id;
    h.farmId = rng.pick(world.farms).id;
    h.classId = h.classId ?? classForWins(h.wins);
    // 半分くらいが在厩。残りは放牧。
    h.stable = rng.chance(0.52) ? 'stable' : 'pasture';
    if (h.stable === 'stable') h.fit = clamp01(rng.normal(0.7, 0.18));
    h.trainingMenu = 'normal';
  }
}

/** プレイヤーの牧場を用意する。 */
function setupPlayer(world, rng, { playerName, farmName }) {
  const name = playerName || makePersonName(rng, { used: world.personNames });
  const farm = farmName || `${name.split(' ')[0]}ファーム`;
  const owner = {
    id: 'player',
    name,
    kanmei: null,
    money: START_MONEY,
    ambition: 1,
    horses: [],
    isPlayer: true,
  };
  world.owners.set('player', owner);

  world.player = {
    name, farmName: farm,
    money: START_MONEY,
    ownerId: 'player',
    horses: [],        // 現役（所有馬 id）
    broodmares: [],
    stallions: [],
    weeklyIncome: 0, weeklyCost: 0,
    g1: 0, wins: 0, starts: 0, earnings: 0,
    titles: [],
    entries: new Map(), // raceId -> {horseId, jockeyId, styleOrder}
  };

  // 初期所有馬：3 歳 1 頭、2 歳 2 頭、繁殖牝馬 2 頭。
  // 母集団の中央値（潜在 0.60 前後）より少し上に置く。
  // 下に置くと何年使っても 1 勝もできず、預託料だけが出ていく。
  const give = (age, level) => {
    const birth = world.year - age;
    const cands = [...world.horses.values()].filter((h) =>
      h.birthYear === birth && !h.retired && !h.dead && h.ownerId !== 'player');
    if (cands.length === 0) return null;
    const scored = cands.map((h) => ({
      h, d: Math.abs(sum(ABILITIES, (a) => h.pot[a]) / ABILITIES.length - level),
    })).sort((a, b) => a.d - b.d);
    const pickFrom = scored.slice(0, 30);
    const h = rng.pick(pickFrom).h;
    // 元の馬主から外す。
    const prev = world.owners.get(h.ownerId);
    if (prev) prev.horses = prev.horses.filter((x) => x !== h.id);
    h.ownerId = 'player';
    owner.horses.push(h.id);
    world.player.horses.push(h.id);
    h.stable = 'stable';
    h.fit = age >= 3 ? 0.6 : 0.25;
    h.trainingMenu = 'normal';
    return h;
  };
  give(3, 0.64);
  give(2, 0.62);
  give(2, 0.58);

  // 繁殖牝馬 2 頭。
  const mareCands = world.marePool
    .map((id) => world.horses.get(id))
    // 実在の名牝は配らない（アーモンドアイが最初から手元に居ては牧場経営にならない）。
    .filter((m) => m && !m.dead && !m.real && world.year - m.birthYear >= 5 && world.year - m.birthYear <= 12);
  rng.shuffle(mareCands);
  for (const m of mareCands.slice(0, 2)) {
    m.ownerId = 'player';
    world.player.broodmares.push(m.id);
  }
  return world.player;
}

// ---------------------------------------------------------------- 週送り

/**
 * その週の番組表。
 * 主乱数ではなく (シード, 年, 週) から導いた乱数で作る。
 * こうしないと「来週の登録画面を開いた」だけで乱数が進み、
 * 実際に走る番組が変わってしまう。先の週を何度でも覗けるようにするための工夫。
 */
export function weekRaces(world, week = world.week, year = world.year) {
  const key = `${world.seed}|races|${year}|${week}`;
  const cached = world._raceCache?.key === key ? world._raceCache.races : null;
  if (cached) return cached;
  const races = racesOfWeek(year, week, makeRng(hashSeed(key)));
  world._raceCache = { key, races };
  return races;
}

/** その週の馬場状態と天候。これも (シード, 年, 週) から決める。 */
export function weekGround(world, week = world.week, year = world.year) {
  const rng = makeRng(hashSeed(`${world.seed}|ground|${year}|${week}`));
  const month = weekToMonth(week);
  const rainy = month === 6 || month === 7 || month === 9;
  const g = {};
  for (const c of allCourses()) {
    const w = rng.weighted(WEATHERS, rainy
      ? [30, 26, 18, 20, 0]
      : [48, 28, 10, 8, month <= 2 || month >= 12 ? 3 : 0]);
    let gi = 0;
    if (w === '雨') gi = rng.weighted([1, 2, 3], [3, 4, 3]);
    else if (w === '小雨') gi = rng.weighted([0, 1, 2], [3, 4, 2]);
    else if (w === '雪') gi = rng.weighted([1, 2], [1, 1]);
    // ダートは雨で締まって速くなるので、同じ天候でも別に持つ。
    g[c.id] = { weather: w, ground: GROUNDS[gi] };
  }
  return g;
}

/** 出走を希望する NPC 馬を集める。 */
function npcCandidates(world, rng) {
  const out = [];
  for (const h of world.horses.values()) {
    if (h.ownerId === 'player') continue;
    if (!canRun(h, world.year)) continue;
    // 仕上がっていない馬は使わない。ここを緩めると、同じレースの時計が
    // 年によって 10 秒ぶれる（出来の悪い馬が多数走ってペースが落ちる）。
    if (h.fit < 0.68) continue;
    if (h.fatigue > 0.55) continue;
    const since = h.lastStartWeek == null ? 99 : weeksBetween(world, h.lastStartWeek, h.lastStartYear);
    // 条件馬は中 2 週でも使う。重賞級は間隔を取る。
    if (since < (classOrder(h.classId ?? 'nowin') >= 5 ? 4 : 3)) continue;
    // 休み明けの馬は使ってこないこともある。
    if (!rng.chance(clamp01(0.42 + h.fit * 0.4 - h.fatigue * 0.3))) continue;
    out.push(h);
  }
  return out;
}

function weeksBetween(world, week, year) {
  return (world.year - (year ?? world.year)) * WEEKS_PER_YEAR + (world.week - week);
}

/**
 * その馬が狙うべきクラス。
 * 勝ち数で上がれるのはオープンまでで、その先は賞金と能力で自然に分かれる。
 * ここを「勝ち数クラス」だけで決めると、強い馬が永遠にオープン特別に
 * 留まって GI が空になる（実際にそうなって番組が成立しなかった）。
 */
function targetClassOrder(h, ability, age) {
  const o = classOrder(h.classId ?? 'nowin');
  if (o < 2) return o;               // 未勝利は未勝利戦
  if (age <= 3) {
    // 3 歳春はまだ賞金が積み上がらない。素質だけでクラシックを目指させる。
    if (ability >= 0.62) return 8;
    if (ability >= 0.55) return 7;
    if (ability >= 0.48) return 6;
    return Math.min(o, 5);
  }
  if (o < 5) return o;
  if (h.earnings >= 28000 || ability >= 0.70) return 8;
  if (h.earnings >= 13000 || ability >= 0.64) return 7;
  if (h.earnings >= 5000 || ability >= 0.57) return 6;
  return 5;
}

/** 馬にとってのレースの魅力。NPC の使い分けはこれだけで決める。 */
function raceFit(world, h, race) {
  if (!eligible(race, h, world.year)) return -1;
  const dApt = 1 - Math.abs(race.distance - h.dist) / Math.max(200, h.distRange * 1.6);
  const sApt = race.surface === SURFACE.DIRT ? h.dirt : h.turf;
  const ability = sum(ABILITIES, (a) => h.cur[a]) / ABILITIES.length;
  const co = classOrder(race.classId);
  const to = targetClassOrder(h, ability, horseAge(h, world.year));
  const d = Math.abs(co - to);
  const clsFit = d === 0 ? 1 : d === 1 ? 0.6 : d === 2 ? 0.25 : 0.05;
  // 重賞は適性が合っていないと使わない。格だけで突っ込ませると、
  // 天皇賞（春）にマイラーが 18 頭並んで 3200m が 3 分 50 秒になる。
  if (race.graded && distanceAptitude(h, race.distance) < 0.30) return -1;
  const w = race.graded ? 1.6 : 0.9;
  return dApt * w + sApt * 0.7 + clsFit * 1.5;
}

/** NPC の出走申し込み。強い馬から順に、自分に合うレースを取っていく。 */
function assignNpcEntries(world, races, rng) {
  const fields = new Map(races.map((r) => [r.raceId, []]));
  const cands = npcCandidates(world, rng)
    .sort(byDesc((h) => sum(ABILITIES, (a) => h.cur[a])));
  for (const h of cands) {
    let best = null, bestScore = 0;
    for (const r of races) {
      const f = fields.get(r.raceId);
      if (f.length >= r.maxField) continue;
      const s = raceFit(world, h, r) - f.length * 0.02;
      if (s > bestScore) { bestScore = s; best = r; }
    }
    if (!best || bestScore <= 0.55) continue;
    fields.get(best.raceId).push(h);
  }

  // 重賞は必ず成立させる。頭数が足りなければ、条件を満たす馬を強い順に足す。
  // 実際の競馬でも GI が頭数不足で中止になることは無い。
  for (const r of races) {
    if (r.graded) fillField(world, r, races, fields, 12);
  }
  return fields;
}

/**
 * 頭数の足りないレースに、条件を満たす馬を足して成立させる。
 * 適性の下限は段階的に下げる。長距離 GI は適性馬が少ないので、
 * 厳しいままだと頭数が揃わず不成立になってしまう。
 */
export function fillField(world, race, races, fields, want) {
  const f = fields.get(race.raceId);
  if (!f || f.length >= want) return f;
  const taken = new Set();
  for (const list of fields.values()) for (const x of list) taken.add(x.id);
  for (const minApt of [0.62, 0.45, 0.30]) {
    if (f.length >= want) break;
    // 強い順ではなく「このレースに向く順」。距離適性を無視すると、
    // 菊花賞に 1600m 馬が並んで 3000m を 4 分台で走ることになる。
    const extra = [...world.horses.values()]
      .filter((h) => !taken.has(h.id) && h.ownerId !== 'player'
        && !h.retired && !h.dead && !h.injury
        && horseAge(h, world.year) >= 2 && eligible(race, h, world.year)
        && distanceAptitude(h, race.distance) > minApt
        && (race.surface === SURFACE.DIRT ? h.dirt : h.turf) > 0.45)
      .sort(byDesc((h) => sum(ABILITIES, (a) => h.cur[a])
        * distanceAptitude(h, race.distance)
        * (race.surface === SURFACE.DIRT ? h.dirt : h.turf)));
    for (const h of extra) {
      if (f.length >= Math.min(race.maxField, 16)) break;
      // 放牧中の馬も急仕上げで使う。仕上がり不足のまま走るので凡走しやすい。
      if (h.stable !== 'stable') { h.stable = 'stable'; h.fit = Math.max(h.fit, 0.72); }
      f.push(h);
      taken.add(h.id);
    }
  }
  return f;
}

/** 騎手を割り当てる。良い馬に良い騎手が乗る。 */
function assignJockeys(world, race, horses, rng) {
  const taken = new Set();
  const all = [...world.jockeys.values()].filter((j) => !j.retired);
  const strong = horses.slice().sort(byDesc((h) => sum(ABILITIES, (a) => h.cur[a])));
  const map = new Map();
  for (const h of strong) {
    // 主戦騎手が空いていればその人。
    let j = h.jockeyId != null ? world.jockeys.get(h.jockeyId) : null;
    const strength = sum(ABILITIES, (a) => h.cur[a]) / ABILITIES.length;
    if (!j || j.retired || taken.has(j.id)
      || !acceptsRide(j, rng, { classOrder: classOrder(race.classId), horseStrength: strength, offeredBy: h.ownerId === 'player' ? 'player' : 'npc' })) {
      const free = all.filter((x) => !taken.has(x.id));
      if (free.length === 0) break;
      // 強い馬には上位騎手。
      free.sort(byDesc((x) => x.skill));
      const idx = Math.min(free.length - 1, Math.floor(rng.range(0, Math.max(1, free.length * (1 - strength * 0.7)))));
      j = free[idx];
    }
    taken.add(j.id);
    map.set(h.id, j);
  }
  return map;
}

/**
 * 1 週進める。
 * @param {object} world
 * @param {{recordRaceIds?:Set<string>}} opts 走行ログを残すレース（3D 再生したいもの）
 */
export function advanceWeek(world, opts = {}) {
  const rng = world.rng;
  const recordIds = opts.recordRaceIds ?? new Set();
  const ground = weekGround(world);
  const races = weekRaces(world);
  const news = [];
  const results = [];

  // --- 出走馬を決める ---
  const fields = assignNpcEntries(world, races, rng);
  // プレイヤーの登録を差し込む。
  for (const [raceId, ent] of world.player.entries) {
    const race = races.find((r) => r.raceId === raceId);
    if (!race) continue;
    const h = world.horses.get(ent.horseId);
    if (!h || !canRun(h, world.year)) continue;
    const f = fields.get(raceId);
    if (f.length >= race.maxField) f.pop(); // 抽選で弱い馬を外す
    f.push(h);
    ent.accepted = true;
    // 自分が登録したレースは必ず成立させる。番組に載っている以上、
    // 相手が集まらなかったので中止、ではプレイヤーは何もできない。
    fillField(world, race, races, fields, 10);
  }

  // --- レースを走らせる ---
  for (const race of races) {
    const horses = fields.get(race.raceId) ?? [];
    const minField = race.graded ? 3 : 5;
    if (horses.length < minField) continue; // 頭数不足のレースは不成立
    const gw = ground[race.courseId] ?? { ground: '良', weather: '晴' };
    const jk = assignJockeys(world, race, horses, rng);
    const playerEnt = [...world.player.entries.values()].find((e) => e.raceId === race.raceId);

    rng.shuffle(horses);
    const entries = horses.map((h, i) => {
      const isPlayer = h.ownerId === 'player';
      const pe = isPlayer ? world.player.entries.get(race.raceId) : null;
      const j = (isPlayer && pe?.jockeyId != null ? world.jockeys.get(pe.jockeyId) : null) ?? jk.get(h.id);
      return {
        horse: h,
        jockey: j,
        weight: raceWeight(world, race, h),
        gate: i + 1,
        frame: frameOf(i + 1, horses.length),
        styleOrder: isPlayer ? pe?.styleOrder : null,
      };
    });

    const spec = {
      raceId: race.raceId, name: race.name, classId: race.classId, grade: race.grade,
      courseId: race.courseId, surface: race.surface, distance: race.distance,
      ground: gw.ground, weather: gw.weather,
      year: world.year, week: world.week,
      entries, prize: race.prize,
    };
    const wantLog = recordIds.has(race.raceId) || entries.some((e) => e.horse.ownerId === 'player');
    const res = simulateRace(spec, rng, { record: wantLog });
    applyResult(world, race, res, rng, news);
    results.push(res);
  }

  world.results = results;
  world.player.entries = new Map();

  // --- 全馬の 1 週 ---
  weeklyHorseUpkeep(world, rng);

  // --- 経営 ---
  settleWeeklyCost(world);

  // --- 牧場の行事（誕生・種付け） ---
  if (world.week === W(4, 1)) foaling(world, rng, news);
  if (world.week === W(6, 4)) covering(world, rng, news);

  world.news = news;
  world.log.push({ year: world.year, week: world.week, news });
  if (world.log.length > 400) world.log.shift();

  // --- 週を進める ---
  world.week++;
  let yearSummary = null;
  if (world.week > WEEKS_PER_YEAR) {
    world.week = 1;
    yearSummary = yearEnd(world, rng);
    world.year++;
    newYear(world, rng);
  }
  return { results, news, yearSummary };
}

/** 枠番 → 枠（1〜8）。 */
function frameOf(gate, field) {
  if (field <= 8) return gate;
  const perFrame = Math.ceil(field / 8);
  // 実際は外枠から詰めるが、見た目が合えばよい。
  return Math.min(8, Math.ceil(gate / perFrame));
}

/** 斤量。重賞は別定・ハンデの簡略版。 */
function raceWeight(world, race, h) {
  const month = weekToMonth(race.week);
  let w = standardWeight(horseAge(h, world.year), h.sex, month);
  if (race.grade === 'GI' && race.age[0] >= 4) w = h.sex === SEX.FEMALE ? 56 : 58;
  // 条件戦は収得賞金で少し重くなる。
  if (!race.graded) w += Math.min(3, Math.floor(h.earnings / 4000));
  return w;
}

/** 結果を世界に反映する。 */
function applyResult(world, race, res, rng, news) {
  const field = res.results.length;
  const hard = classOrder(race.classId) >= 6 || field >= 16;
  for (const r of res.results) {
    const h = world.horses.get(r.horseId);
    if (!h) continue;
    h.starts++;
    if (r.order === 1) {
      h.wins++;
      // 戦績は 30 走（他人の馬は 6 走）しか残さないので、GI の勝ち数は別に数える。
      if (race.grade === 'GI') h.g1Wins = (h.g1Wins ?? 0) + 1;
    } else if (r.order === 2) h.seconds++;
    else if (r.order === 3) h.thirds++;
    h.earnings += r.prize;
    h.lastStartWeek = world.week;
    h.lastStartYear = world.year;
    h.record.push({
      year: world.year, week: world.week, raceId: race.raceId, name: race.name,
      grade: race.grade, classId: race.classId,
      courseId: race.courseId, surface: race.surface, distance: race.distance,
      ground: res.ground, order: r.order, field,
      time: r.time, last3f: r.last3f, odds: r.odds, popularity: r.popularity,
      jockeyId: r.jockeyId, jockeyName: r.jockeyName, weight: r.weight,
      margin: r.margin, passing: r.passing, comment: r.comment, prize: r.prize,
    });
    if (h.record.length > 30) h.record.shift();
    h.classId = classForWins(h.wins);
    applyRaceEffect(h, rng, { year: world.year, distance: race.distance, order: r.order, field, hard });
    rollInjury(h, rng, { extra: hard ? 0.012 : 0.004 });

    // 騎手・調教師の成績。
    const j = r.jockeyId != null ? world.jockeys.get(r.jockeyId) : null;
    if (j) {
      j.starts++; j.earnings += r.prize * JOCKEY_CUT;
      if (r.order === 1) { j.wins++; if (race.grade === 'GI') j.g1++; }
    }
    const t = h.trainerId != null ? world.trainers.get(h.trainerId) : null;
    if (t) {
      t.starts++; t.earnings += r.prize * TRAINER_CUT;
      if (r.order === 1) { t.wins++; if (race.grade === 'GI') t.g1++; }
    }
    // 馬主の賞金。
    const o = world.owners.get(h.ownerId);
    if (o) {
      const net = r.prize * (1 - JOCKEY_CUT - TRAINER_CUT);
      o.money += net;
      if (h.ownerId === 'player') {
        world.player.money += net;
        world.player.earnings += r.prize;
        world.player.starts++;
        if (r.order === 1) {
          world.player.wins++;
          if (race.grade === 'GI') world.player.g1++;
        }
      }
    }
    // ニックスの実績。産駒が走れば配合の評価が固まっていく。
    if (h.nicksKey) {
      recordNicksResult(world, h, clamp01((field - r.order) / field) * (race.graded ? 1.6 : 1));
    }
  }

  // コースレコード。
  const key = `${race.courseId}|${race.surface}|${race.distance}`;
  const prev = world.records.get(key);
  if (res.ground === '良' && (!prev || res.winnerTime < prev.time)) {
    const w = res.results[0];
    world.records.set(key, { time: res.winnerTime, horseId: w.horseId, name: w.name, year: world.year });
    if (prev) news.push(`${res.courseName}${race.surface}${race.distance}m のレコードが更新された（${w.name} ${res.winnerTime.toFixed(1)}）`);
  }

  // 重賞の記録。
  if (race.graded) {
    const w = res.results[0];
    world.history.push({
      year: world.year, week: world.week, defId: race.defId, name: race.name,
      grade: race.grade, winner: w.name, winnerId: w.horseId,
      jockey: w.jockeyName, time: w.time, field,
    });
    const owner = world.horses.get(w.horseId)?.ownerId;
    const tag = owner === 'player' ? '★' : '';
    news.push(`${tag}${race.name}（${race.grade}）は ${w.name} が優勝。`);
    checkTripleCrown(world, w.horseId, news);
  }
}

/** 三冠の判定。 */
function checkTripleCrown(world, horseId, news) {
  const h = world.horses.get(horseId);
  if (!h) return;
  const won = new Set(world.history
    .filter((x) => x.winnerId === horseId && x.year === world.year)
    .map((x) => x.defId));
  const sets = [['クラシック三冠', TRIPLE_CROWN], ['牝馬三冠', TRIPLE_CROWN_F]];
  for (const [label, ids] of sets) {
    if (ids.every((id) => won.has(id))) {
      if (!h.titles) h.titles = [];
      if (!h.titles.includes(label)) {
        h.titles.push(label);
        news.push(`${h.name} が${label}を達成した。`);
      }
    }
  }
}

/** 全馬の調教・回復。世界でいちばん重い処理なので、素直なループに留めている。 */
function weeklyHorseUpkeep(world, rng) {
  for (const h of world.horses.values()) {
    if (h.dead || h.retired) continue;
    const age = horseAge(h, world.year);
    if (age < 2) continue;
    if (h.injury) { weeklyRecover(h, rng); continue; }
    if (h.stable === 'stable') {
      const menu = h.ownerId === 'player'
        ? (h.trainingMenu ?? 'normal')
        : autoMenu(h, rng);
      trainWeek(h, rng, { year: world.year, trainer: world.trainers.get(h.trainerId), menuId: menu });
      // NPC は疲れたら放牧に出す。
      // 放牧に出すとその間に仕上がりが抜け、戻しても 5 週は使えない。
      // 軽い疲れは在厩のまま「休養」メニューで抜く（実際の調整もそうしている）。
      if (h.ownerId !== 'player' && h.fatigue > 0.88) h.stable = 'pasture';
    } else {
      pastureWeek(h, rng, { year: world.year });
      // NPC は疲れが抜けたら入厩させる。
      if (h.ownerId !== 'player' && h.fatigue < 0.30 && rng.chance(0.6)) {
        h.stable = 'stable';
      }
    }
    weeklyRecover(h, rng);
  }
}

/** 週ごとの経費。 */
function settleWeeklyCost(world) {
  let cost = 0;
  for (const id of world.player.horses) {
    const h = world.horses.get(id);
    if (!h || h.dead) continue;
    cost += h.stable === 'stable' ? COST.stableWeekly : COST.pastureWeekly;
  }
  cost += world.player.broodmares.length * COST.broodmareWeekly;
  cost += world.player.stallions.length * COST.stallionWeekly;
  world.player.weeklyCost = cost;
  world.player.money -= cost;
}

// ---------------------------------------------------------------- 年の切り替え

function yearEnd(world, rng) {
  const news = [];
  computeLeaders(world);
  pickAwards(world, news);
  // 誰の祖先でもなくなった馬と、古い戦績の細部を捨てる。
  // 放っておくと 10 年でセーブが数十 MB になり、ブラウザに収まらなくなる。
  pruneAncestry(world);
  pruneRecords(world);

  // 引退の判定。年末処理の画面には重賞馬と自分の馬だけを載せる。
  const retiredThisYear = [];
  // 引退した名馬はその場で種牡馬・繁殖牝馬の名簿に入るので、登録数は引退の前から数える。
  const poolBefore = new Set([...world.stallionPool, ...world.marePool]);
  for (const h of [...world.horses.values()]) {
    if (h.dead || h.retired) continue;
    const age = horseAge(h, world.year);
    if (age < 2) continue;
    const isPlayer = h.ownerId === 'player';
    let retire = false;
    if (age >= 9) retire = true;
    else if (h.injury && h.injury.weeks > 40) retire = true;
    else if (age >= 7 && pastPrime(h, world.year)) retire = true;
    else if (!isPlayer && age >= 5 && h.wins === 0) retire = true;
    else if (!isPlayer && age >= 4 && h.earnings < 400 && rng.chance(0.6)) retire = true;
    if (!retire) continue;
    retireHorse(world, h, rng, news);
    if (isPlayer || (h.g1Wins ?? 0) > 0 || h.earnings > 30000) retiredThisYear.push(h);
  }

  // 種牡馬・繁殖牝馬の登録（4 歳世代から次の種牡馬と繁殖牝馬を選ぶ）。
  promotePools(world, rng, world.year + 1);
  const newSires = world.stallionPool.filter((id) => !poolBefore.has(id));
  // 系統の確立（息子が何頭も種牡馬になった馬は「○○系」として独立する）。
  const newLines = establishLines(world, rng, news).map((h) => ({ id: h.id, name: h.name }));
  const newMares = world.marePool.filter((id) => !poolBefore.has(id));

  // 翌年の馬名登録。
  const named = registerNames(world);

  // 人の加齢。
  for (const j of world.jockeys.values()) if (!j.retired) ageJockey(j, rng, world.year);
  for (const t of world.trainers.values()) if (!t.retired) ageTrainer(t, rng);
  // 引退した分を補充する。
  let add = [...world.jockeys.values()].filter((j) => j.retired).length;
  for (const j of world.jockeys.values()) if (j.retired) j.retiredYear = j.retiredYear ?? world.year;
  const activeJ = [...world.jockeys.values()].filter((j) => !j.retired).length;
  for (let i = activeJ; i < 110; i++) {
    const j = createJockey(rng, { year: world.year + 1, used: world.personNames });
    j.age = 18 + rng.irange(0, 3);
    world.jockeys.set(j.id, j);
  }
  const activeT = [...world.trainers.values()].filter((t) => !t.retired).length;
  for (let i = activeT; i < 90; i++) {
    const t = createTrainer(rng, { year: world.year + 1, used: world.personNames });
    t.age = 33 + rng.irange(0, 6);
    world.trainers.set(t.id, t);
  }

  world.news = news.concat(world.news).slice(0, 30);
  world.log.push({ year: world.year, week: 'end', news });

  // 年末処理の画面に出す要約。
  const name = (id) => world.horses.get(id)?.name ?? '—';
  const leaders = world.leaders;
  const p = world.player;
  return {
    year: world.year,
    awards: world.awards.filter((a) => a.year === world.year),
    leaders: {
      jockey: leaders.jockeys[0] ? `${leaders.jockeys[0].name}（${leaders.jockeys[0].wins}勝）` : '—',
      trainer: leaders.trainers[0] ? `${leaders.trainers[0].name}（${leaders.trainers[0].wins}勝）` : '—',
      sire: leaders.sires[0]?.name ?? '—',
      owner: leaders.owners[0]?.name ?? '—',
    },
    // 自分の馬は全部、ほかは獲得賞金の上位 15 頭だけ（毎年 100 頭近い重賞馬が引退する）。
    retiredTotal: retiredThisYear.length,
    retired: [
      ...retiredThisYear.filter((h) => h.ownerId === 'player'),
      ...retiredThisYear.filter((h) => h.ownerId !== 'player').sort(byDesc((h) => h.earnings)).slice(0, 15),
    ].map((h) => ({ id: h.id, name: h.name, mine: h.ownerId === 'player',
      to: h.stallion ? '種牡馬' : h.broodmare ? '繁殖牝馬' : '引退' })),
    // 新しい種牡馬は毎年数十頭いるので、種付料の上位 12 頭と自分の馬だけを名前で出す。
    newSiresTotal: newSires.length,
    newSires: newSires
      .map((id) => world.horses.get(id)).filter(Boolean)
      .sort(byDesc((h) => (p.stallions.includes(h.id) ? 1e9 : 0) + (h.studFee ?? 0)))
      .slice(0, 12)
      .map((h) => ({ id: h.id, name: h.name, fee: h.studFee ?? 0, mine: p.stallions.includes(h.id) })),
    newMares: newMares.length,
    newLines,
    named,
    farm: {
      money: p.money, horses: p.horses.length, broodmares: p.broodmares.length,
      stallions: p.stallions.length,
      young: [...world.horses.values()].filter((h) => h.ownerId === 'player' && !h.dead && horseAge(h, world.year) < 2).length,
    },
  };
}

/** 引退させ、繁殖・種牡馬・用途変更に振り分ける。 */
export function retireHorse(world, h, rng, news = []) {
  h.retired = true;
  h.stable = 'retired';
  h.retiredYear = world.year;
  const year = world.year;
  // 名馬は因子を持って繁殖に上がる（血統に残す「得意」）。
  grantFactors(h);
  if (h.sex === SEX.MALE && canBeStallion(h, year)) {
    h.stallion = true;
    h.studFee = studFeeOf(world, h, year);
    world.stallionPool.push(h.id);
    // 毎年 20 頭が種牡馬入りするので、よほどの実績馬だけを報じる。
    if (h.earnings > 60000) news.push(`${h.name} が引退し、種牡馬となった（種付料 ${h.studFee} 万円）。`);
    if (h.ownerId === 'player') world.player.stallions.push(h.id);
  } else if (h.sex === SEX.FEMALE && canBeBroodmare(h, year)) {
    h.broodmare = true;
    world.marePool.push(h.id);
    if (h.ownerId === 'player') world.player.broodmares.push(h.id);
  }
  if (h.ownerId === 'player') {
    world.player.horses = world.player.horses.filter((x) => x !== h.id);
    if (h.earnings > 5000) news.push(`${h.name} が引退した（通算 ${h.starts}戦${h.wins}勝）。`);
  }
  const o = world.owners.get(h.ownerId);
  if (o) o.horses = o.horses.filter((x) => x !== h.id);
}

/** 配合を解決して翌年の産駒を作る。 */
/**
 * 種付けシーズンの締め（6 月 4 週）。プレイヤーの予約と、ほかの牧場の種付けを
 * まとめて行い、受胎した繁殖牝馬に「お腹の仔」を持たせる。生まれるのは翌年 4 月。
 * 受胎しなかったときは種付料を返す（実際も多くは受胎確認後の支払い）。
 */
function covering(world, rng, news) {
  const birth = world.year + 1;
  const booked = new Set();
  for (const m of world.pendingMatings) {
    const dam = world.horses.get(m.damId);
    const sire = world.horses.get(m.sireId);
    if (!dam || !sire || dam.dead || sire.dead) continue;
    booked.add(dam.id);
    if (!conceives(rng, dam, birth)) {
      world.player.money += m.fee;
      news.push(`★${dam.name} は不受胎だった（種付料 ${m.fee} 万円は返金）。`);
      continue;
    }
    dam.pregnancy = { sireId: sire.id, year: birth };
    news.push(`★${dam.name} が ${sire.name} の仔を受胎した。来年 4 月に生まれる。`);
  }
  world.pendingMatings = [];
  // ほかの牧場のぶん。プレイヤーの繁殖牝馬は勝手に付けない（予約しなければ空胎）。
  const pairs = pairMares(world, rng, birth, FOALS_LIVE, { exclude: booked, npcOnly: true });
  for (const { dam, sire } of pairs) dam.pregnancy = { sireId: sire.id, year: birth };
  news.push(`種付けシーズンが終わった。ほかの牧場で ${pairs.length} 頭が受胎した。`);
  // 来年生まれる史実の名馬は、史実の父母で受胎し直させる。
  realCoverings(world, rng, birth);
}

/** 仮の馬名（「母名の生年」）。馬名は 1 歳の年末に登録する。 */
const provisionalName = (dam, year) => `${dam?.name ?? '不明'}の${year}`;

/**
 * 幼駒の誕生（4 月 1 週）。前年に受胎した繁殖牝馬が産む。
 * 生まれた仔は「母名の年」の仮の名で呼び、正式な馬名は 1 歳の年末に登録する。
 * 名前の候補（regName）は生まれたときに決めておき、プレイヤーが付けなければそれを使う。
 */
function foaling(world, rng, news) {
  let n = 0;
  for (const dam of [...world.horses.values()]) {
    const p = dam.pregnancy;
    if (!p || p.year !== world.year) continue;
    delete dam.pregnancy;
    const sire = world.horses.get(p.sireId);
    if (dam.dead || !sire) continue;
    const mine = dam.ownerId === 'player';
    const opts = { year: world.year, farmId: dam.farmId, ownerId: mine ? 'player' : null };
    const real = p.real && world.real && world.real.ids[p.real] == null;
    const foal = real ? bornReal(world, rng, p.real, sire, dam, opts) : breed(world, rng, sire, dam, opts);
    foal.regName = foal.name;
    foal.name = provisionalName(dam, world.year);
    world.horses.set(foal.id, foal);
    n++;
    if (mine) news.push(`★${dam.name} が ${sire.name} の仔（${foal.sex}・${foal.coat}）を産んだ。`);
    if (real) news.push(`${foal.name}（父 ${sire.name}）が誕生した。のちの${foal.regName}である。`);
  }
  news.push(`${world.year}年産の幼駒 ${n} 頭が誕生した。`);
}

/**
 * 翌年の馬名登録。1 歳馬（来年 2 歳）に正式な名前を付ける。
 * プレイヤーが決めた名前（plannedName）があればそれを、無ければ生まれたときの候補を使う。
 */
function registerNames(world) {
  const done = [];
  for (const h of world.horses.values()) {
    if (h.regName == null || horseAge(h, world.year) !== 1) continue;
    const name = h.plannedName ?? h.regName;
    if (h.plannedName) {
      world.nameSet.delete(h.regName);
      world.nameSet.add(h.plannedName);
    }
    if (h.ownerId === 'player') done.push({ id: h.id, from: h.name, name });
    h.name = name;
    delete h.regName;
    delete h.plannedName;
  }
  return done;
}


/** 年明けの処理。産駒を馬主と厩舎に配り、2 歳馬をデビューさせる。 */
function newYear(world, rng) {
  const owners = [...world.owners.values()].filter((o) => !o.isPlayer);
  const trainers = [...world.trainers.values()].filter((t) => !t.retired);
  const jockeys = [...world.jockeys.values()].filter((j) => !j.retired);
  for (const h of world.horses.values()) {
    if (h.dead || h.retired) continue;
    const age = horseAge(h, world.year);
    // 2 歳になった馬は厩舎に入る。
    if (age === 2 && h.trainerId == null) {
      if (h.ownerId == null) {
        const o = rng.pick(owners);
        h.ownerId = o.id;
        o.horses.push(h.id);
      }
      // 12 月 4 週にプレイヤーが入厩先を決めていればそこへ。
      const planned = h.plannedTrainerId != null ? world.trainers.get(h.plannedTrainerId) : null;
      const t = planned && !planned.retired ? planned : rng.pick(trainers);
      delete h.plannedTrainerId;
      h.trainerId = t.id;
      t.horses.push(h.id);
      h.jockeyId = rng.pick(jockeys).id;
      h.classId = 'maiden';
      h.trainingMenu = 'normal';
      h.stable = h.ownerId === 'player' ? 'pasture' : (rng.chance(0.4) ? 'stable' : 'pasture');
      if (h.ownerId === 'player' && !world.player.horses.includes(h.id)) {
        world.player.horses.push(h.id);
      }
    }
  }
  // 史実の出来事（輸入馬の到着、実在の馬の種牡馬入り・繁殖入り、死）。
  const realNews = realNewYear(world, rng, world.year);
  if (realNews.length) world.news = realNews.concat(world.news).slice(0, 30);
  // 種付料の改定。走る産駒を出した種牡馬は跳ね上がる。
  for (const id of world.stallionPool) {
    const s = world.horses.get(id);
    if (s) s.studFee = studFeeOf(world, s, world.year);
  }
}

/** リーディング集計。 */
export function computeLeaders(world) {
  const jockeys = [...world.jockeys.values()].filter((j) => j.starts > 0)
    .sort(byDesc((j) => j.wins)).slice(0, 30);
  const trainers = [...world.trainers.values()].filter((t) => t.starts > 0)
    .sort(byDesc((t) => t.wins)).slice(0, 30);
  // 種牡馬リーディングは産駒の獲得賞金。
  const sireEarn = new Map();
  for (const h of world.horses.values()) {
    if (h.sireId == null || h.earnings <= 0) continue;
    sireEarn.set(h.sireId, (sireEarn.get(h.sireId) ?? 0) + h.earnings);
  }
  const sires = [...sireEarn.entries()]
    .map(([id, e]) => ({ id, name: world.horses.get(id)?.name ?? '—', earnings: e }))
    .sort(byDesc((x) => x.earnings)).slice(0, 30);
  const owners = [...world.owners.values()]
    .map((o) => ({
      id: o.id, name: o.name,
      earnings: sum(o.horses, (hid) => world.horses.get(hid)?.earnings ?? 0),
    }))
    .sort(byDesc((x) => x.earnings)).slice(0, 30);
  world.leaders = { jockeys, trainers, sires, owners };
  return world.leaders;
}

/** 年度表彰。 */
function pickAwards(world, news) {
  const year = world.year;
  const season = world.history.filter((x) => x.year === year);
  const score = new Map();
  for (const x of season) {
    const w = x.grade === 'GI' ? 10 : x.grade === 'GII' ? 4 : 2;
    score.set(x.winnerId, (score.get(x.winnerId) ?? 0) + w);
  }
  const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best) return;
  const h = world.horses.get(best[0]);
  if (!h) return;
  world.awards.push({ year, kind: '年度代表馬', horseId: h.id, name: h.name });
  if (!h.titles) h.titles = [];
  h.titles.push(`${year}年度代表馬`);
  news.push(`${year}年の年度代表馬は ${h.name} に決まった。`);
  if (h.ownerId === 'player') world.player.titles.push(`${year}年度代表馬 ${h.name}`);
}

// ---------------------------------------------------------------- 参照用

export function horsesOf(world, ownerId) {
  return [...world.horses.values()].filter((h) => h.ownerId === ownerId && !h.retired && !h.dead);
}

export function stallionList(world, { maxFee = Infinity } = {}) {
  return world.stallionPool
    .map((id) => world.horses.get(id))
    .filter((h) => h && !h.dead && (h.studFee ?? 0) <= maxFee)
    .sort(byDesc((h) => h.studFee ?? 0));
}

export function broodmareList(world, ownerId = 'player') {
  return (ownerId === 'player' ? world.player.broodmares : [])
    .map((id) => world.horses.get(id))
    .filter((h) => h && !h.dead);
}

export { WEEKS_PER_YEAR, weekLabel, meetingsOf, eligible, GRADED, gradedCalendar };
