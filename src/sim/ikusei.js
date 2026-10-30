// 育成モード：ガチャで集めたカードを 5 枚（育てる馬 1 枚＋サポート 4 枚）組み、2 歳・3 歳の 2 年で
// 練習とレース 10 戦をこなして競走馬を完成させる。完成馬は NPC のランク戦や、自分の完成馬どうしで戦わせる。
//
// 牧場経営（world.js）とは別のモード。世界は作らず、レースの計算（race.js の simulateRace）だけを借りる。
// 乱数は Math.random を使わない（プロフィールのシード＋引いた回数・ターンから導く）。
// 状態はすべてプロフィール（JSON にそのまま書ける素の値）に持ち、画面は ikusei.js の関数だけを通す。

import { CARDS, PACKS } from './data/cards.js';
import { makeRng, hashSeed } from '../core/rng.js';
import { simulateRace } from './race.js';
import { GRADED } from './schedule.js';
import { createHorse, peekHorseId, resetHorseIds } from './horse.js';
import { clamp, clamp01 } from '../core/util.js';
import { skillsOf, skillInfo, applyRaceSkills, RAR_SCALE, AWAKEN, awakenOf } from './ikusei-skills.js';
import { distCatOf } from './ikusei-util.js';

export { skillsOf, skillInfo, AWAKEN };
/** カードの覚醒（持っている枚数から）。 */
export const awakenOfCard = (profile, id) => awakenOf(profile.cards[id]);
export { skillCue } from './ikusei-skills.js';

export { CARDS, PACKS };
export const STATS = ['speed', 'stamina', 'power', 'guts', 'wit'];
export const STAT_LABEL = { speed: 'スピード', stamina: 'スタミナ', power: 'パワー', guts: '根性', wit: '賢さ' };
export const STAT_SHORT = { speed: 'スピ', stamina: 'スタ', power: 'パワ', guts: '根性', wit: '賢さ' };
export const RARITIES = ['LM', 'SSR', 'SR', 'R', 'N'];
const BY_ID = new Map(CARDS.map((c) => [c.id, c]));
export const cardById = (id) => BY_ID.get(id) ?? null;

// ---------------------------------------------------------------- カードの数値

/**
 * 能力の +表示（+5〜+1）。+5 の数はレア度で決まる（LM 3・SSR 3 か 2・SR 2・R と N は 1）。
 * +5 は値の高い順に付け、残りは値で +4〜+1。カードの絵（試作）と同じ規則。
 */
export function plusOf(card) {
  const order = [...STATS].sort((a, b) => card.v[b] - card.v[a]);
  const top5 = { LM: 3, SSR: card.v[order[2]] >= 0.75 ? 3 : 2, SR: 2, R: 1, N: 1 }[card.rar] ?? 1;
  const out = {};
  for (const k of STATS) {
    const v = card.v[k];
    out[k] = order.indexOf(k) < top5 ? 5 : v >= 0.74 ? 4 : v >= 0.70 ? 3 : v >= 0.65 ? 2 : 1;
  }
  return out;
}
export const cardPower = (card) => STATS.reduce((s, k) => s + Math.round(card.v[k] * 100), 0);
export const distCat = distCatOf;
/** サポートとしての得意（+5 の能力のうち値のいちばん高いもの）。この練習で会うと伸びが大きい。 */
export const supportType = (card) => [...STATS].sort((a, b) => card.v[b] - card.v[a])[0];
const RAR_BONUS = { LM: 1.3, SSR: 1.2, SR: 1.1, R: 1.05, N: 1.0 };

// ---------------------------------------------------------------- プロフィール

/** 新しいプロフィール。cards は持っているカード（id → 枚数）。 */
export function newProfile(seed = 1) {
  return { v: 1, seed: typeof seed === 'number' ? seed : hashSeed(String(seed)), pulls: 0, cards: {}, finished: [], run: null, nextId: 1, battles: 0, shards: 0 };
}

// ---------------------------------------------------------------- ガチャ

/** 排出率。試作なので回数の制限は無い。 */
export const RATES = { LM: 0.02, SSR: 0.06, SR: 0.15, R: 0.27, N: 0.50 };

/**
 * ガチャを n 回引く。pack は 'P1'・'P2'・'ALL'。
 * 乱数は (シード, 引いた通算回数) から 1 回ずつ作る。引く前に何を見ても結果は変わらない。
 */
export function pull(profile, n = 1, pack = 'ALL') {
  const got = [];
  for (let i = 0; i < n; i++) {
    const rng = makeRng(hashSeed(`gacha:${profile.seed}:${profile.pulls}`));
    profile.pulls++;
    let r = rng.next(), rar = 'N';
    for (const k of RARITIES) { if (r < RATES[k]) { rar = k; break; } r -= RATES[k]; }
    const pool = CARDS.filter((c) => c.rar === rar && (pack === 'ALL' || c.pack === pack));
    const c = pool[rng.int(pool.length)];
    const isNew = !profile.cards[c.id];
    profile.cards[c.id] = (profile.cards[c.id] ?? 0) + 1;
    // 2〜5 枚目は覚醒が 1 段上がる（6 枚目からは上がらない）
    const n = profile.cards[c.id];
    got.push({ card: c, isNew, awaken: n >= 2 && n <= AWAKEN.max + 1 ? n - 1 : 0 });
  }
  return got;
}

/** 持っているカード（レア度の高い順）。 */
export function owned(profile) {
  return CARDS.filter((c) => profile.cards[c.id]).sort((a, b) => RARITIES.indexOf(a.rar) - RARITIES.indexOf(b.rar) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- かけら（余ったカードの交換）
//
// 覚醒は 5 枚（覚醒 4）で頭打ちなので、6 枚目からは持っていても何も起きない。その余りをかけらに替え、
// かけらで好きなカードを 1 枚ずつ交換できる（持っていないカード・覚醒途中のカードを狙って埋める）。
// 余りは 5 枚を超えた分だけ（覚醒を下げない）。交換で 5 枚を超えることはさせない（余りが生まれてまたかけらに戻るだけ）。
// 交換の値は引いて得る値の 10 倍前後：余りが出るほど引いた人への上乗せで、ガチャの代わりにはならない。

/** 余り 1 枚で得るかけら。 */
export const SHARD_VALUE = { LM: 60, SSR: 20, SR: 6, R: 2, N: 1 };
/** 1 枚と交換するのに要るかけら。 */
export const SHARD_COST = { LM: 600, SSR: 200, SR: 60, R: 20, N: 10 };
/** 覚醒の上限に要る枚数（これを超えた分が余り）。 */
export const KEEP = AWAKEN.max + 1;

export const shardsOf = (profile) => profile.shards ?? 0;
export const spareOf = (profile, id) => Math.max(0, (profile.cards[id] ?? 0) - KEEP);
/** 余りをまとめて替えたら得るかけら。 */
export const spareValue = (profile) => CARDS.reduce((n, c) => n + spareOf(profile, c.id) * SHARD_VALUE[c.rar], 0);

/** 余りをかけらに替える。id を省くと全部。得たかけらを返す。 */
export function shardSpare(profile, id = null) {
  let got = 0;
  for (const c of id ? [cardById(id)] : CARDS) {
    const n = spareOf(profile, c.id);
    if (!n) continue;
    profile.cards[c.id] -= n;
    got += n * SHARD_VALUE[c.rar];
  }
  profile.shards = shardsOf(profile) + got;
  return got;
}

/** かけらで 1 枚と交換できるか（できないなら理由）。 */
export function canBuyWithShards(profile, id) {
  const c = cardById(id);
  if (!c) return 'そのカードは無い';
  if ((profile.cards[id] ?? 0) >= KEEP) return 'もう覚醒 MAX';
  if (shardsOf(profile) < SHARD_COST[c.rar]) return `かけらが足りない（あと ${SHARD_COST[c.rar] - shardsOf(profile)}）`;
  return null;
}

/** かけらで 1 枚と交換する。 */
export function buyWithShards(profile, id) {
  const why = canBuyWithShards(profile, id);
  if (why) throw new Error(why);
  const c = cardById(id);
  profile.shards = shardsOf(profile) - SHARD_COST[c.rar];
  const isNew = !profile.cards[id];
  profile.cards[id] = (profile.cards[id] ?? 0) + 1;
  return { card: c, isNew, awaken: profile.cards[id] >= 2 ? profile.cards[id] - 1 : 0 };
}

// ---------------------------------------------------------------- 能力の尺度

/**
 * 練習の点（0〜1200）→ レースの能力（0..1）。1200 点で 0.92。
 * 番組の相手の強さ（RACE_LEVEL）と同じ尺度で、2 年の育成で 600〜900 点に届くと GI で戦える。
 */
export const abilityOf = (pts) => clamp01(0.36 + (clamp(pts, 0, 1200) / 1200) * 0.56);
/** 能力の上限（点）。育てる馬のカードの +値で決まる（+5 で 1200、+1 で 720）。 */
const capOf = (plus, awaken = 0) => Math.min(1200, 600 + plus * 120 + awaken * AWAKEN.cap);
export { capOf };
/** 点の評価（育成画面の文字）。 */
export function gradeOfPts(p) {
  const T = [[1100, 'SS'], [1000, 'S+'], [900, 'S'], [800, 'A+'], [700, 'A'], [600, 'B+'], [500, 'B'], [400, 'C+'], [300, 'C'], [200, 'D'], [100, 'E'], [0, 'G']];
  return T.find(([t]) => p >= t)[1];
}

// ---------------------------------------------------------------- 育成の日程

/** 10 戦それぞれの時期。各戦の前に 3 回の練習がある（合計 40 ターン）。 */
export const SLOTS = [
  { age: 2, label: '2歳 7月', from: [6, 3], to: [8, 4], kind: 'debut' },
  { age: 2, label: '2歳 10月', from: [9, 1], to: [11, 4] },
  { age: 2, label: '2歳 12月', from: [12, 1], to: [12, 4] },
  { age: 3, label: '3歳 3月', from: [1, 1], to: [3, 4] },
  { age: 3, label: '3歳 4月', from: [4, 1], to: [4, 4] },
  { age: 3, label: '3歳 5月', from: [5, 1], to: [6, 4] },
  { age: 3, label: '3歳 8月', from: [7, 1], to: [8, 4] },
  { age: 3, label: '3歳 9月', from: [9, 1], to: [10, 2] },
  { age: 3, label: '3歳 11月', from: [10, 3], to: [11, 4] },
  { age: 3, label: '3歳 12月', from: [12, 1], to: [12, 4] },
];
export const TRAININGS_PER_RACE = 3;
export const TOTAL_TURNS = SLOTS.length * (TRAININGS_PER_RACE + 1);
const W = (m, w) => (m - 1) * 4 + w;

/** クラス（勝ち数と重賞勝ち）。条件戦は自分のクラスのものだけ、重賞は勝ち数で出られる。 */
const CLASSES = ['新馬', '未勝利', '1勝クラス', '2勝クラス', 'オープン'];
function classOf(run) {
  if (run.starts === 0) return '新馬';
  if (run.wins === 0) return '未勝利';
  return CLASSES[Math.min(4, run.wins + 1)];
}
/** 相手の能力の平均（番組の格ごと）。 */
const RACE_LEVEL = { 新馬: 0.47, 未勝利: 0.49, '1勝クラス': 0.53, '2勝クラス': 0.57, オープン: 0.60, GIII: 0.62, GII: 0.64, GI: 0.68 };

/** 条件戦を開ける場と距離（番組表にある組み合わせだけ。コースの幾何が組める）。 */
const COMBOS = [...new Map(GRADED.filter((r) => !r.abroad).map((r) => [`${r.courseId}|${r.surface}|${r.distance}`, r])).values()];

/** この時期に出られるレース（重賞は勝ち数と性で、条件戦は自分のクラス）。最大 4 つ。 */
export function raceOptions(run) {
  const slot = SLOTS[run.slot];
  const card = cardById(run.trainee);
  const cls = classOf(run);
  const opts = [];
  if (slot.kind !== 'debut' && run.wins >= 1) {
    const lo = W(...slot.from), hi = W(...slot.to);
    const graded = GRADED.filter((r) => !r.abroad && r.week >= lo && r.week <= hi
      && slot.age >= r.age[0] && slot.age <= r.age[1] && (!r.sex || r.sex === card.sex)
      && (r.grade !== 'GI' || run.wins >= 2 || run.gradedWins >= 1));
    // 距離と馬場の合うものから
    const fit = (r) => Math.abs(r.distance - card.dist) / 400 + ((r.surface === 'ダート') !== (card.dirt > card.turf) ? 1.2 : 0)
      - ({ GI: 0.6, GII: 0.3, GIII: 0.1 }[r.grade] ?? 0);
    for (const r of graded.sort((a, b) => fit(a) - fit(b)).slice(0, 3)) {
      opts.push({ id: r.id, name: r.name, grade: r.grade, courseId: r.courseId, surface: r.surface, distance: r.distance, level: RACE_LEVEL[r.grade] + (r.age[1] > 3 ? 0.02 : 0) - (slot.age === 2 ? 0.05 : 0) });
    }
  }
  // 条件戦（クラスに合わせる。オープンなら OP 特別）。距離と馬場は得意に寄せる。
  const surf = card.dirt > card.turf ? 'ダート' : '芝';
  // 2 歳は 2000m まで（長距離のカードでも 2 歳の新馬が 3200m を走らないように）。
  const maxD = slot.age === 2 ? 2000 : 9999;
  const want = Math.min(card.dist, maxD);
  const cand = COMBOS.filter((c) => c.surface === surf && c.distance <= maxD).sort((a, b) => Math.abs(a.distance - want) - Math.abs(b.distance - want));
  const rng = makeRng(hashSeed(`opts:${run.seed}:${run.slot}`));
  const pick = cand[Math.min(cand.length - 1, rng.int(Math.min(3, cand.length)))];
  const name = cls === 'オープン' ? 'オープン特別' : `${slot.age}歳${cls}`;
  opts.push({ id: `cond-${run.slot}`, name, grade: cls === 'オープン' ? 'OP' : '', courseId: pick.courseId, surface: pick.surface, distance: pick.distance, level: RACE_LEVEL[cls] - (slot.age === 2 ? 0.03 : 0) });
  // 馬場状態はこの時期のレースで共通（選ぶ前に見える。道悪のスキルを持つ馬は重い馬場の週を狙える）
  const ground = groundOf(`ground:${run.seed}:${run.slot}`);
  for (const o of opts) o.ground = ground;
  return opts;
}

/** 馬場状態（良 6 割・稍重 2 割・重 1 割強・不良 1 割弱）。主乱数ではなく鍵から決める。 */
export function groundOf(key) {
  const r = makeRng(hashSeed(key)).next();
  return r < 0.6 ? '良' : r < 0.8 ? '稍重' : r < 0.93 ? '重' : '不良';
}

// ---------------------------------------------------------------- 育成の進行

/**
 * 育成を始める。trainee は育てる馬のカード、supports はサポート 4 枚（重複可、育てる馬と同じカードは不可）。
 * 初期値はカードの値から（2 歳の夏の素の力）。
 */
export function startRun(profile, traineeId, supportIds) {
  const t = cardById(traineeId);
  if (!t || !profile.cards[traineeId]) throw new Error('そのカードを持っていない');
  if (supportIds.length !== 4) throw new Error('サポートは 4 枚');
  for (const s of supportIds) if (!profile.cards[s] || s === traineeId) throw new Error('サポートに使えないカード');
  const seed = hashSeed(`run:${profile.seed}:${profile.nextId}`);
  const stats = {};
  // カードの値の差を出発点の差にする（重みが小さいと LM と SR の完成時の能力が 8% しか違わなかった）
  // 覚醒は始めた時点の枚数で決める（育成の途中で引いても、その育成は変わらない）
  const awaken = { t: awakenOf(profile.cards[traineeId]), s: supportIds.map((id) => awakenOf(profile.cards[id])) };
  for (const k of STATS) stats[k] = Math.round(200 + (t.v[k] - 0.55) * 1200 + awaken.t * AWAKEN.init);
  profile.run = {
    id: profile.nextId++, seed, trainee: traineeId, supports: [...supportIds],
    turn: 0, slot: 0, stats, energy: 100, mood: 2, fans: 0, starts: 0, wins: 0, gradedWins: 0, giWins: 0,
    levels: Object.fromEntries(STATS.map((k) => [k, 1])), races: [], log: [`${t.name}の育成を始めた`],
    bonds: [0, 0, 0, 0], learned: [], awaken,
  };
  return profile.run;
}

export const MOODS = ['絶不調', '不調', '普通', '好調', '絶好調'];
const MOOD_MUL = [0.8, 0.9, 1.0, 1.1, 1.2];

const awT = (run) => run.awaken?.t ?? 0;
const awS = (run, i) => run.awaken?.s?.[i] ?? 0;
/** 友情練習を何回すればスキルを覚えるか（覚醒 3 で 1 回）。 */
export const bondNeed = (run, i) => (awS(run, i) >= AWAKEN.bondAt ? 1 : 2);

/** このターンが練習かレースか。 */
export const isRaceTurn = (run) => run.turn % (TRAININGS_PER_RACE + 1) === TRAININGS_PER_RACE;
export const turnLabel = (run) => {
  const slot = SLOTS[Math.min(SLOTS.length - 1, Math.floor(run.turn / (TRAININGS_PER_RACE + 1)))];
  return `${slot.label}${isRaceTurn(run) ? '（レース）' : `（練習 ${run.turn % (TRAININGS_PER_RACE + 1) + 1}/${TRAININGS_PER_RACE}）`}`;
};

/** 練習で伸びる能力（主・副）。 */
const TRAIN = {
  speed: { main: 'speed', sub: { power: 0.5 }, cost: 20 },
  stamina: { main: 'stamina', sub: { guts: 0.5 }, cost: 20 },
  power: { main: 'power', sub: { stamina: 0.5 }, cost: 20 },
  guts: { main: 'guts', sub: { speed: 0.35, power: 0.35 }, cost: 20 },
  wit: { main: 'wit', sub: { speed: 0.4 }, cost: 5, heal: 0 },
};

/**
 * このターンの練習場に誰が来ているか（サポートは 5 つの練習のどれかに出るか、来ない）。
 * (シード, ターン) から決めるので、画面を開き直しても変わらない。
 */
export function trainingBoard(run) {
  const rng = makeRng(hashSeed(`board:${run.seed}:${run.turn}`));
  const at = Object.fromEntries(STATS.map((k) => [k, []]));
  run.supports.forEach((id, i) => {
    const c = cardById(id);
    // 来ない（「練習の虫」は来やすい。乱数は同じだけ引く：スキルの有無で他のサポートの行き先を変えない）
    if (rng.next() < Math.max(0.01, (skillsOf(c, awS(run, i)).support.includes('often') ? 0.04 : 0.18) - AWAKEN.show * awS(run, i))) return;
    // 得意の練習に来やすい（半分は得意、残りはばらばら）
    const k = rng.next() < 0.5 ? supportType(c) : STATS[rng.int(STATS.length)];
    at[k].push(i);
  });
  return at;
}

/** 練習の見込み（伸びる点と失敗率）。画面で練習を選ぶ前に見せる。 */
export function trainingPreview(run, kind) {
  const t = cardById(run.trainee);
  const plus = plusOf(t);
  const tr = TRAIN[kind];
  const idx = trainingBoard(run)[kind];
  const here = idx.map((i) => cardById(run.supports[i]));
  let mul = MOOD_MUL[run.mood] * (1 + 0.12 * here.length) * (1 + 0.08 * (run.levels[kind] - 1));
  let cost = tr.cost, failMul = 1;
  const fired = [];
  here.forEach((c, j) => {
    const aw = awS(run, idx[j]);
    const sk = skillsOf(c, aw).support;
    const friend = supportType(c) === kind;
    if (friend) mul *= 1.15 + 0.25 * (RAR_BONUS[c.rar] - 1) * 2 + (sk.includes('friend') ? 0.15 : 0) + AWAKEN.friend * aw;   // 友情（友情の絆で強まる）
    if (sk.includes(`tr_${kind}`)) { mul *= 1 + 0.2 * RAR_SCALE[c.rar]; fired.push(skillInfo(`tr_${kind}`).name); }
    if (friend && sk.includes('friend')) fired.push(skillInfo('friend').name);
    if (sk.includes('saver') && kind !== 'wit') { cost = Math.max(5, cost - 5); fired.push(skillInfo('saver').name); }
    if (sk.includes('safe')) { failMul *= 0.5; fired.push(skillInfo('safe').name); }
    if (sk.includes('mood')) fired.push(skillInfo('mood').name);
  });
  const gains = {};
  const base = 30;
  gains[tr.main] = Math.round(base * mul * (0.85 + plus[tr.main] * 0.1));
  for (const [k, f] of Object.entries(tr.sub)) gains[k] = Math.round(base * f * mul * (0.85 + plus[k] * 0.1));
  const fail = run.energy >= 50 || kind === 'wit' ? 0 : Math.min(0.6, ((50 - run.energy) / 50) * 0.6) * failMul;
  return {
    gains, fail, cost, supports: here.map((c) => c.id), friendship: here.filter((c) => supportType(c) === kind).length,
    friends: here.filter((c) => supportType(c) === kind).map((c) => c.id), skills: [...new Set(fired)],
    mood: here.some((c, j) => skillsOf(c, awS(run, idx[j])).support.includes('mood')),
  };
}

const addStats = (run, gains) => {
  const plus = plusOf(cardById(run.trainee));
  for (const [k, g] of Object.entries(gains)) run.stats[k] = Math.max(0, Math.min(capOf(plus[k], awT(run)), run.stats[k] + g));
};

/** 練習する。kind は STATS のどれか。 */
export function train(run, kind) {
  if (isRaceTurn(run) || run.turn >= TOTAL_TURNS) throw new Error('いまは練習できない');
  const p = trainingPreview(run, kind);
  const rng = makeRng(hashSeed(`train:${run.seed}:${run.turn}`));
  let msg;
  if (rng.next() < p.fail) {
    // 失敗：伸びず、気分が落ち、少しけがをしたように能力が下がる
    run.mood = Math.max(0, run.mood - 1);
    addStats(run, { [kind]: -10 });
    run.energy = Math.max(0, run.energy - 5);
    msg = `${STAT_LABEL[kind]}の練習に失敗した（体力が足りない）`;
  } else {
    addStats(run, p.gains);
    run.levels[kind] = Math.min(5, run.levels[kind] + 0.25);
    run.energy = kind === 'wit' ? Math.min(100, run.energy + 5) : Math.max(0, run.energy - p.cost);
    msg = `${STAT_LABEL[kind]}の練習 ${Object.entries(p.gains).map(([k, g]) => `${STAT_SHORT[k]}+${g}`).join(' ')}${p.friendship ? '（友情）' : ''}`;
    // サポートと練習すると、ときどき気分が上がる（盛り上げ役が居ると上がりやすい）
    if (p.supports.length && rng.next() < (p.mood ? 0.35 : 0.12)) { run.mood = Math.min(4, run.mood + 1); msg += '・気分が上がった'; }
    // 友情練習を 2 回するとそのサポートのレーススキルを覚える（完成馬に残る）
    run.bonds ??= [0, 0, 0, 0];
    run.learned ??= [];
    for (const id of p.friends) {
      const i = run.supports.indexOf(id);
      if (i < 0) continue;
      run.bonds[i]++;
      const sk = skillsOf(cardById(id), awS(run, i)).race.find((x) => !run.learned.includes(x) && !runSkills(run).includes(x));
      if (run.bonds[i] === bondNeed(run, i) && sk) { run.learned.push(sk); msg += `・${cardById(id).name}から「${skillInfo(sk).name}」を覚えた`; }
    }
  }
  run.log.push(msg);
  run.turn++;
  return msg;
}

/** 休む（体力を戻す）。 */
export function rest(run) {
  if (isRaceTurn(run) || run.turn >= TOTAL_TURNS) throw new Error('いまは休めない');
  const rng = makeRng(hashSeed(`rest:${run.seed}:${run.turn}`));
  const gain = rng.next() < 0.25 ? 70 : 50;
  run.energy = Math.min(100, run.energy + gain);
  if (rng.next() < 0.2) run.mood = Math.min(4, run.mood + 1);
  const msg = `休んだ（体力 +${gain}）`;
  run.log.push(msg);
  run.turn++;
  return msg;
}

// ---------------------------------------------------------------- レース

/** 育成中・完成馬・NPC をレースの計算に渡す馬にする。birthYear はレースの年で 4 歳にそろえる（成長曲線を 1 に近づける）。 */
function runnerHorse({ id, name, sex, coat, ab, dist, range, turf, dirt, firm, soft, style }, year, rng) {
  const h = createHorse(rng, { name, sex, birthYear: year - 4 });
  h.id = id;
  h.coat = coat ?? h.coat;
  h.pot = { ...ab };
  h.cur = { ...ab };
  h.growth = '持続';
  h.dist = dist; h.distRange = range ?? 400;
  h.turf = turf; h.dirt = dirt; h.firm = firm ?? 0.8; h.soft = soft ?? 0.5;
  h.style = style ?? 0.5; h.styleFlex = 0.5; h.temper = 0.6; h.spirit = 0.6;
  h.fit = 1; h.cond = 0.7; h.fatigue = 0;
  return h;
}

const NPC_NAMES = ['ミラクル', 'サンダー', 'ブレイブ', 'グローリー', 'スカイ', 'ローレル', 'ハヤテ', 'ムーン', 'シャイン', 'クラウン', 'ストーム', 'フェアリー', 'ダンサー', 'スター', 'ルビー', 'ヴィクトリー', 'ドリーム', 'ファイア'];
const NPC_HEAD = ['エイシン', 'マイネル', 'サクラ', 'メイショウ', 'タガノ', 'ダイワ', 'ゴールド', 'シルバー', 'トウカイ', 'ニシノ', 'アドマイヤ', 'ヤマニン'];
const COATS = ['鹿毛', '黒鹿毛', '栗毛', '青鹿毛', '芦毛', '栃栗毛'];

/** 条件に合う NPC（level は能力の平均）。 */
function npcHorse(rng, i, level, race) {
  const ab = {};
  for (const k of STATS) ab[k] = clamp(rng.normal(level, 0.035), 0.3, 0.95);
  return {
    id: 2e9 + 1000 + i, name: `${rng.pick(NPC_HEAD)}${rng.pick(NPC_NAMES)}`, sex: rng.chance(0.3) ? '牝' : '牡', coat: rng.pick(COATS), ab,
    dist: clamp(race.distance + rng.normal(0, 250), 1000, 3600), range: 450, turf: race.surface === 'ダート' ? 0.5 : 0.85, dirt: race.surface === 'ダート' ? 0.85 : 0.45,
    firm: 0.8, soft: rng.range(0.45, 0.8), style: rng.next(),
  };
}

/** 育成中の馬をレースの馬の形に。 */
export function traineeSpec(run) {
  const c = cardById(run.trainee);
  return {
    id: 1, name: c.name, sex: c.sex, coat: c.coat, ab: Object.fromEntries(STATS.map((k) => [k, abilityOf(run.stats[k])])),
    dist: c.dist, range: c.range, turf: c.turf, dirt: c.dirt, firm: c.firm, soft: c.soft, style: c.style, cardId: c.id,
  };
}

/** 育成中の馬のレーススキル（カードの分と、サポートから覚えた分）。 */
export function runSkills(run) {
  return [...skillsOf(cardById(run.trainee), awT(run)).race, ...(run.learned ?? [])];
}

/** レーススキルを効かせた馬の形と、発動したスキル。 */
function withSkills(spec, skills, cardId, race, battle, awaken = 0) {
  const c = cardById(cardId);
  return applyRaceSkills(spec, skills, race, { battle, rar: c?.rar ?? 'N', uniqueOf: c?.rar === 'LM' ? c : null, awaken });
}

/**
 * レースを 1 つ走らせる。field は出走馬の形（runnerHorse に渡すもの）。
 * 走行ログ付きの結果を返す（3D で観られる）。乱数は seedKey から。
 */
export function runRace(race, field, seedKey, year = 2026) {
  const rng = makeRng(hashSeed(seedKey));
  // createHorse は馬の id をモジュールの通し番号で採る。牧場の世界と同じ番号を進めないよう戻す（落とし穴 47）。
  const idMark = peekHorseId();
  const horses = field.map((f) => runnerHorse(f, year, rng));
  resetHorseIds(idMark);
  const entries = horses.map((h, i) => ({
    horse: h, jockey: { id: null, name: '—', skill: 0.55, aggression: 0.5 },
    weight: h.sex === '牝' ? 55 : 57, gate: i + 1, frame: Math.min(8, Math.ceil(((i + 1) / horses.length) * 8)),
  }));
  // 枠は乱数で入れ替える（いつも 1 番が内にならないように）
  for (let i = entries.length - 1; i > 0; i--) { const j = rng.int(i + 1); [entries[i].horse, entries[j].horse] = [entries[j].horse, entries[i].horse]; }
  const res = simulateRace({
    raceId: race.id, name: race.name, classId: race.grade || 'cond', grade: race.grade, courseId: race.courseId, surface: race.surface,
    distance: race.distance, ground: race.ground ?? '良', weather: '晴', year, week: 20, entries, prize: 0,
  }, rng, { record: true });
  return res;
}

/**
 * 今のターンのレースに出る。choice は raceOptions の 1 つ。
 * 結果（着順・走行ログ）を返し、育成を次のターンへ進める。
 */
export function raceTurn(run, choice) {
  if (!isRaceTurn(run)) throw new Error('いまはレースの時期ではない');
  const opts = raceOptions(run);
  const race = opts.find((o) => o.id === choice) ?? opts[opts.length - 1];
  const rng = makeRng(hashSeed(`field:${run.seed}:${run.slot}`));
  const n = race.grade === 'GI' ? 16 : 12;
  const me0 = withSkills(traineeSpec(run), runSkills(run), run.trainee, race, false, awT(run));
  const field = [me0.spec];
  for (let i = 1; i < n; i++) field.push(npcHorse(rng, i, race.level, race));
  // 体力と気分を能力に効かせる（体力が少ないと仕上がりが落ちる）
  const res = runRace(race, field, `race:${run.seed}:${run.slot}`);
  const me = res.results.find((r) => r.horseId === 1);
  const order = me.order;
  run.starts++;
  // 報酬：着順で全能力に点、ファン、勝てばクラスが上がる
  const bonus = order === 1 ? 20 : order <= 3 ? 12 : order <= 5 ? 6 : 3;
  const gradeMul = { GI: 1.6, GII: 1.3, GIII: 1.15, OP: 1.05 }[race.grade] ?? 1;
  addStats(run, Object.fromEntries(STATS.map((k) => [k, Math.round(bonus * gradeMul)])));
  run.fans += Math.round((order === 1 ? 3000 : order <= 3 ? 1200 : 300) * gradeMul);
  if (order === 1) {
    run.wins++;
    if (/^G/.test(race.grade)) run.gradedWins++;
    if (race.grade === 'GI') run.giWins++;
    run.mood = Math.min(4, run.mood + 1);
  } else if (order > 5) run.mood = Math.max(0, run.mood - 1);
  run.energy = Math.max(0, run.energy - 15);
  run.races.push({ slot: run.slot, name: race.name, grade: race.grade, courseId: race.courseId, surface: race.surface, distance: race.distance, ground: race.ground, order, field: res.results.length, time: me.time, skills: me0.fired });
  run.log.push(`${race.name} ${order}着（${res.results.length}頭）${me0.fired.length ? `　発動：${me0.fired.join('・')}` : ''}`);
  run.turn++;
  run.slot++;
  return { race, result: res, order, fired: me0.fired };
}

export const runDone = (run) => run.turn >= TOTAL_TURNS;

// ---------------------------------------------------------------- 完成

/** 完成馬の評価点（能力の点の合計＋勝ち星）。 */
export const ratingOf = (h) => STATS.reduce((s, k) => s + h.stats[k], 0) + h.wins * 20 + h.giWins * 60;
export function rankOf(rating) {
  const T = [[5200, 'SS'], [4600, 'S'], [4000, 'A+'], [3500, 'A'], [3000, 'B+'], [2500, 'B'], [2000, 'C+'], [1500, 'C'], [0, 'D']];
  return T.find(([t]) => rating >= t)[1];
}

/** 育成を終えて完成馬にする。 */
export function finishRun(profile) {
  const run = profile.run;
  if (!run || !runDone(run)) throw new Error('まだ育成の途中');
  const c = cardById(run.trainee);
  const horse = {
    id: run.id, cardId: c.id, name: c.name, sex: c.sex, coat: c.coat, rar: c.rar, stats: { ...run.stats },
    dist: c.dist, range: c.range, turf: c.turf, dirt: c.dirt, firm: c.firm, soft: c.soft, style: c.style,
    starts: run.starts, wins: run.wins, gradedWins: run.gradedWins, giWins: run.giWins, fans: run.fans,
    races: run.races, supports: run.supports, battles: 0, battleWins: 0,
    skills: runSkills(run), awaken: awT(run),
  };
  horse.rating = ratingOf(horse);
  horse.rank = rankOf(horse.rating);
  profile.finished.push(horse);
  profile.run = null;
  return horse;
}

/** 完成馬のレーススキル（古い完成馬は持たないので、カードから起こす）。 */
export const finishedSkills = (h) => h.skills ?? skillsOf(cardById(h.cardId) ?? { v: {}, rar: 'N', id: '' }).race;

/** 完成馬をレースの馬の形に。 */
export function finishedSpec(h, i = 0) {
  return {
    id: 100 + i, name: h.name, sex: h.sex, coat: h.coat, ab: Object.fromEntries(STATS.map((k) => [k, abilityOf(h.stats[k])])),
    dist: h.dist, range: h.range, turf: h.turf, dirt: h.dirt, firm: h.firm, soft: h.soft, style: h.style, fid: h.id, cardId: h.cardId,
  };
}

// ---------------------------------------------------------------- 対戦

/** 対戦の舞台（番組表の GI から）。 */
export const BATTLE_RACES = ['japan-cup', 'arima-kinen', 'tenno-sho-spring', 'yasuda-kinen', 'sprinters-s', 'takarazuka', 'champions-cup', 'february-s', 'tenno-sho-autumn', 'derby']
  .map((id) => GRADED.find((r) => r.id === id)).filter(Boolean)
  .map((r) => ({ id: r.id, name: r.name, grade: 'GI', courseId: r.courseId, surface: r.surface, distance: r.distance }));

export const DIFFICULTY = { normal: { name: '普通', d: -0.10 }, hard: { name: '強い', d: -0.02 }, legend: { name: '伝説', d: 0.03 } };

/**
 * NPC のランク戦。相手は全カードの名馬を「育て上げた姿」にした完成馬で、強さは自分の馬の能力の平均に難しさを足した帯。
 */
export function battleNpc(profile, horseId, raceId, diff = 'normal') {
  const me = profile.finished.find((h) => h.id === horseId);
  const race0x = BATTLE_RACES.find((r) => r.id === raceId) ?? BATTLE_RACES[0];
  const n = 12;
  const race0 = race0x;
  const race = { ...race0, ground: groundOf(`bground:${profile.seed}:${profile.battles}`) };
  const rng = makeRng(hashSeed(`battle:${profile.seed}:${profile.battles}`));
  const myAvg = STATS.reduce((s, k) => s + abilityOf(me.stats[k]), 0) / 5;
  const level = clamp(myAvg + DIFFICULTY[diff].d, 0.55, 0.92);
  const pool = CARDS.filter((c) => c.name !== me.name && ((race.surface === 'ダート') === (c.dirt > c.turf)));
  const mine0 = withSkills(finishedSpec(me, 0), finishedSkills(me), me.cardId, race, true, me.awaken ?? 0);
  const field = [mine0.spec];
  const fired = { 100: mine0.fired };
  const used = new Set();
  for (let i = 1; i < n; i++) {
    let c = pool[rng.int(pool.length)];
    for (let t = 0; t < 5 && used.has(c.id); t++) c = pool[rng.int(pool.length)];
    used.add(c.id);
    // カードの得手不得手を残したまま、平均を帯に合わせる
    const avg = STATS.reduce((s, k) => s + c.v[k], 0) / 5;
    const ab = Object.fromEntries(STATS.map((k) => [k, clamp(level + (c.v[k] - avg) + rng.normal(0, 0.015), 0.4, 0.95)]));
    // 相手もカードのレーススキルを使う（自分だけ使えると難しさの帯が崩れる）
    const npc = withSkills({ id: 200 + i, name: c.name, sex: c.sex, coat: c.coat, marks: c.marks, ab, dist: c.dist, range: c.range, turf: c.turf, dirt: c.dirt, firm: c.firm, soft: c.soft, style: c.style, cardId: c.id },
      skillsOf(c).race, c.id, race, true);
    field.push(npc.spec);
    fired[200 + i] = npc.fired;
  }
  const res = runRace(race, field, `battle:${profile.seed}:${profile.battles}`);
  profile.battles++;
  const mine = res.results.find((r) => r.horseId === 100);
  me.battles++;
  if (mine.order === 1) me.battleWins++;
  return { race, result: res, field, order: mine.order, fired };
}

/** 自分の完成馬どうしの対戦（2〜16 頭）。 */
export function battleOwn(profile, horseIds, raceId) {
  const race = { ...(BATTLE_RACES.find((r) => r.id === raceId) ?? BATTLE_RACES[0]), ground: groundOf(`bground:${profile.seed}:${profile.battles}`) };
  const list = horseIds.map((id) => profile.finished.find((h) => h.id === id)).filter(Boolean).slice(0, 16);
  if (list.length < 2) throw new Error('2 頭以上を選ぶ');
  const fired = {};
  const field = list.map((h, i) => {
    const x = withSkills(finishedSpec(h, i), finishedSkills(h), h.cardId, race, true, h.awaken ?? 0);
    fired[100 + i] = x.fired;
    return x.spec;
  });
  const res = runRace(race, field, `own:${profile.seed}:${profile.battles}`);
  profile.battles++;
  for (const r of res.results) {
    const h = list[r.horseId - 100];
    if (!h) continue;
    h.battles++;
    if (r.order === 1) h.battleWins++;
  }
  return { race, result: res, field, fired };
}

// ---------------------------------------------------------------- 保存

const KEY = 'keiba-ikusei-v1';
/** プロフィールを読む（無ければ作る）。localStorage が使えない環境ではメモリだけ。 */
export function loadProfile(storage) {
  try {
    const s = storage?.getItem(KEY);
    if (s) return JSON.parse(s);
  } catch { /* 読めなければ新しく */ }
  return newProfile(Date.now() & 0xffffff);
}
export function saveProfile(profile, storage) {
  try { storage?.setItem(KEY, JSON.stringify(profile)); } catch { /* 保存できなくても遊べる */ }
}
