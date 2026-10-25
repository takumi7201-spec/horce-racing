// 血統。
//
// 競馬ゲームの芯は「配合して走る馬を出す」ところなので、
// 血統表・インブリード検出・ニックス（系統の相性）をここに全部置く。
// 世界は架空だが、インブリードの数え方と評価の癖は実際の配合論に寄せている。

import { clamp01, lerp } from '../core/util.js';
import { ABILITIES } from './params.js';

/** 血統をたどる世代の上限。5 代までが実際の血統表の範囲。 */
export const PED_GENS = 5;

/**
 * 父系をさかのぼって創始種牡馬（＝父が居ない最初の馬）の id を返す。
 * 「○○系」の系統名はこの id で引く。
 */
export function sireLineRoot(world, horseId) {
  let id = horseId;
  const seen = new Set();
  while (id != null && !seen.has(id)) {
    seen.add(id);
    const h = world.horses.get(id);
    // 実在の系統は「系祖」で止める（サンデーサイレンス系・キングマンボ系など）。
    // 一番上までたどるとほとんどがノーザンダンサー系かナスルーラ系になってしまう。
    if (!h || h.sireId == null || h.lineHead) return id;
    id = h.sireId;
  }
  return id;
}

/** 母の父（ブルードメアサイアー）の系統。ニックスはこれと父系で見る。 */
export function bmsLineRoot(world, horse) {
  const dam = horse.damId != null ? world.horses.get(horse.damId) : null;
  if (!dam || dam.sireId == null) return null;
  return sireLineRoot(world, dam.sireId);
}

/**
 * 祖先を集める。depth は親を 1 とする世代数。
 * 返り値は Map<id, {gen, count}>。同じ馬が複数回出てくる場合は最小世代を採る。
 */
export function collectAncestors(world, horseId, maxGen = PED_GENS) {
  const out = new Map();
  if (horseId == null) return out;
  const walk = (id, gen) => {
    if (id == null || gen > maxGen) return;
    const h = world.horses.get(id);
    if (!h) return;
    const prev = out.get(id);
    if (prev) {
      prev.count++;
      prev.gen = Math.min(prev.gen, gen);
    } else {
      out.set(id, { gen, count: 1 });
    }
    walk(h.sireId, gen + 1);
    walk(h.damId, gen + 1);
  };
  const h = world.horses.get(horseId);
  if (!h) return out;
  walk(h.sireId, 1);
  walk(h.damId, 1);
  return out;
}

/** 表示用の血統表。gen 段ぶんの入れ子（sire/dam）。 */
export function pedigreeTree(world, horseId, gens = 3) {
  const build = (id, g) => {
    if (id == null || g > gens) return null;
    const h = world.horses.get(id);
    if (!h) return null;
    return {
      id, name: h.name, sex: h.sex,
      line: g === 1 ? lineLabel(world, id) : null,
      sire: build(h.sireId, g + 1),
      dam: build(h.damId, g + 1),
    };
  };
  const h = world.horses.get(horseId);
  if (!h) return null;
  return { sire: build(h.sireId, 1), dam: build(h.damId, 1) };
}

export function lineLabel(world, horseId) {
  const root = sireLineRoot(world, horseId);
  const h = root != null ? world.horses.get(root) : null;
  return h ? `${h.name}系` : '—';
}

/**
 * 父 sire × 母 dam を付けたときに生まれる仔の血統を評価する。
 * 仔を基準に数えるので、sire の祖先の深さ d は仔から見て d+1 世代。
 */
export function inbreedings(world, sireId, damId, maxGen = PED_GENS) {
  // 父自身・母自身も祖先として数える（父が母の祖先に入っていれば 1xN）。
  const sideA = collectAncestors(world, sireId, maxGen - 1);
  sideA.set(sireId, { gen: 0, count: 1 });
  const sideB = collectAncestors(world, damId, maxGen - 1);
  sideB.set(damId, { gen: 0, count: 1 });

  const found = [];
  for (const [id, a] of sideA) {
    const b = sideB.get(id);
    if (!b) continue;
    const h = world.horses.get(id);
    if (!h) continue;
    const gA = a.gen + 1; // 仔から見た世代
    const gB = b.gen + 1;
    found.push({
      id, name: h.name,
      label: `${Math.min(gA, gB)}×${Math.max(gA, gB)}`,
      gens: [Math.min(gA, gB), Math.max(gA, gB)],
      // ライト式の近交係数（単一経路）。(1/2)^(n1+n2+1)
      f: Math.pow(0.5, gA + gB - 1),
      quality: breedQuality(h),
    });
  }
  found.sort((x, y) => y.f - x.f);
  return found;
}

/** 祖先としての格。能力と現役成績から出す。配合効果の重みに使う。 */
export function breedQuality(h) {
  const ab = ABILITIES.reduce((t, a) => t + h.pot[a], 0) / ABILITIES.length;
  const career = clamp01(Math.log10(1 + h.earnings / 1000) / 2.2);
  return clamp01(ab * 0.65 + career * 0.35);
}

/**
 * インブリードの効能とリスク。
 * 3×4・4×3 がいちばん効き、2×3 のような極端な近交は能力より
 * 丈夫さを削る。これが「攻めた配合はもろい」感触になる。
 */
const INBREED_WEIGHT = {
  '2×2': { gain: 0.55, risk: 1.00 },
  '2×3': { gain: 0.72, risk: 0.72 },
  '2×4': { gain: 0.62, risk: 0.40 },
  '3×3': { gain: 0.92, risk: 0.46 },
  '3×4': { gain: 1.00, risk: 0.22 },
  '3×5': { gain: 0.66, risk: 0.10 },
  '4×4': { gain: 0.80, risk: 0.14 },
  '4×5': { gain: 0.50, risk: 0.06 },
  '5×5': { gain: 0.30, risk: 0.02 },
  '1×2': { gain: 0.20, risk: 1.40 },
  '1×3': { gain: 0.30, risk: 1.10 },
  '1×4': { gain: 0.35, risk: 0.70 },
};

export function inbreedEffect(list) {
  let gain = 0, risk = 0;
  const notes = [];
  for (const ib of list) {
    const w = INBREED_WEIGHT[ib.label];
    if (!w) continue;
    const g = w.gain * lerp(0.35, 1.0, ib.quality);
    gain += g;
    risk += w.risk * 0.5;
    notes.push(`${ib.name} の ${ib.label}`);
  }
  // 重ねすぎは効かない（頭打ち）。
  return { gain: 1 - Math.exp(-gain * 0.7), risk: clamp01(risk * 0.45), notes };
}

/**
 * ニックス（父系 × 母父系の相性）。
 * 世界生成時に系統ペアごとの隠し値を決めておき、産駒の成績が溜まるほど
 * プレイヤー側に見えてくる。「流行の配合」が自然に生まれる仕掛け。
 */
export function nicksKey(sireLine, bmsLine) {
  return `${sireLine}|${bmsLine}`;
}

export function nicksValue(world, sireId, damId) {
  const sl = sireLineRoot(world, sireId);
  const dam = world.horses.get(damId);
  const bl = dam && dam.sireId != null ? sireLineRoot(world, dam.sireId) : null;
  if (sl == null || bl == null) return { value: 0, key: null, samples: 0, known: false };
  const key = nicksKey(sl, bl);
  const rec = world.nicks.get(key);
  const samples = world.nicksStats.get(key)?.n ?? 0;
  return {
    value: rec ?? 0,
    key, samples,
    // 産駒 12 頭ぶんの実績が出れば「確立された配合」として開示する。
    known: samples >= 12,
    sireLine: sl, bmsLine: bl,
  };
}

/** ニックスの等級表示。 */
export function nicksGrade(v) {
  if (v >= 0.6) return '◎';
  if (v >= 0.3) return '○';
  if (v >= 0.1) return '△';
  if (v > -0.1) return '―';
  if (v > -0.35) return '▲';
  return '×';
}

/**
 * 配合の総合評価。プレイヤーに見せる「期待度」。
 * 隠し要素（未確立のニックス）は見せず、代わりに幅を広く取る。
 */
export function matingEval(world, sireId, damId) {
  const sire = world.horses.get(sireId);
  const dam = world.horses.get(damId);
  if (!sire || !dam) return null;
  const ib = inbreedings(world, sireId, damId);
  const ibe = inbreedEffect(ib);
  const nk = nicksValue(world, sireId, damId);

  const parentPower = (breedQuality(sire) * 0.58 + breedQuality(dam) * 0.42);
  // 距離・馬場の指向が噛み合っているか。ばらばらだと中途半端な仔が出る。
  const distGap = Math.abs(sire.dist - dam.dist) / 1200;
  const coherence = clamp01(1 - distGap * 0.5);

  const raw = parentPower * 0.52
    + ibe.gain * 0.18
    + (nk.known ? nk.value : 0) * 0.14
    + coherence * 0.16;

  return {
    sire, dam,
    inbreed: ib, inbreedEffect: ibe, nicks: nk,
    parentPower, coherence,
    score: clamp01(raw),
    // 期待度の星。見せるのはこっち。
    stars: Math.max(1, Math.min(5, 1 + Math.round(clamp01(raw) * 4.4))),
    risk: ibe.risk,
  };
}

/** 産駒の成績をニックス統計に反映する。世代が進むと相性が「判明」していく。 */
export function recordNicksResult(world, foal, successScore) {
  const key = foal.nicksKey;
  if (!key) return;
  let st = world.nicksStats.get(key);
  if (!st) {
    st = { n: 0, sum: 0 };
    world.nicksStats.set(key, st);
  }
  st.n++;
  st.sum += successScore;
}

/** 系統ごとの勢力（種牡馬リーディングの分母）。 */
export function lineStrength(world) {
  const m = new Map();
  for (const h of world.horses.values()) {
    if (h.earnings <= 0) continue;
    const root = sireLineRoot(world, h.id);
    m.set(root, (m.get(root) ?? 0) + h.earnings);
  }
  return m;
}

// ---------------------------------------------------------------- 因子

/**
 * 因子。名馬が血統に残す「得意」の印。3 代までの祖先に因子があると、
 * 仔の対応する能力の潜在値が少しだけ上がる。
 * 1 頭が持つのは 0〜2 個。戦績で決まり、一度付いたら消えない。
 */
export const FACTORS = {
  speed: 'スピード', stamina: 'スタミナ', power: 'パワー', burst: '瞬発',
  guts: '根性', mind: '精神', health: '健康',
};

/** 因子が効く能力（重み 1 あたり）。瞬発はスピードと賢さに半分ずつ。 */
const FACTOR_GAIN = {
  speed: { speed: 1 }, stamina: { stamina: 1 }, power: { power: 1 },
  burst: { speed: 0.5, wit: 0.5 }, guts: { guts: 1 }, mind: { wit: 1 }, health: {},
};
/** 仔から見た世代ごとの重み。父母 1、祖父母 0.5、曽祖父母 0.25。 */
const FACTOR_GEN_WEIGHT = [0, 1, 0.5, 0.25];
/**
 * 重み 1 あたりの潜在値の上げ幅と、1 能力あたりの上限。
 * 世界を作るときの 60 年ぶんの配合にも効くので、大きくすると世代ごとに積み上がって
 * 能力の中央値が上がる（0.009 で中央値が 0.666 → 0.692 になり、GI の時計が速くなりすぎた）。
 */
const FACTOR_STEP = 0.005;
const FACTOR_CAP = 0.02;
/**
 * 因子の効きの基準点。因子の無い血統はこれだけ不利、因子のある血統は差し引きで有利になる。
 * 足すだけにすると世界全体が毎世代押し上げられ、回帰の釣り合いが 0.02 ほど上にずれた。
 */
const FACTOR_BASE = 0.003;

/**
 * 父 sire × 母 dam の仔が受け継ぐ因子。
 * sources は「どの祖先の何の因子が何代目に居るか」（配合画面に出す）。
 */
export function factorsOf(world, sireId, damId) {
  const counts = {};
  const sources = [];
  const walk = (id, gen) => {
    if (id == null || gen > 3) return;
    const h = world.horses.get(id);
    if (!h) return;
    for (const f of h.factors ?? []) {
      counts[f] = (counts[f] ?? 0) + FACTOR_GEN_WEIGHT[gen];
      sources.push({ id, name: h.name, factor: f, label: FACTORS[f], gen });
    }
    walk(h.sireId, gen + 1);
    walk(h.damId, gen + 1);
  };
  walk(sireId, 1);
  walk(damId, 1);
  return { counts, sources };
}

/** 因子の重みを能力の上げ幅に直す。健康は丈夫さ、精神は気性にも効く。 */
export function factorBonus(counts) {
  const pot = {};
  for (const [f, w] of Object.entries(counts)) {
    for (const [a, k] of Object.entries(FACTOR_GAIN[f] ?? {})) pot[a] = (pot[a] ?? 0) + w * k * FACTOR_STEP;
  }
  for (const a of ABILITIES) pot[a] = Math.min(FACTOR_CAP, pot[a] ?? 0) - FACTOR_BASE;
  return {
    pot,
    sound: Math.min(0.08, (counts.health ?? 0) * 0.03),
    temper: Math.min(0.08, (counts.mind ?? 0) * 0.03),
  };
}

/**
 * 引退して繁殖に上がる馬に因子を付ける（架空の馬）。
 * GI 3 勝か獲得賞金 10 億で 1 個、GI 6 勝で 2 個。いちばん秀でた能力の因子にする。
 * 誰にでも付けると、20 年で全馬が因子持ちになって効き目が均される（GI 2 勝で付けたら
 * 開始時点で 450 頭が因子持ちになった）。
 */
export function grantFactors(h) {
  if (h.factors) return;
  const g1 = h.g1Wins ?? 0;
  const n = g1 >= 6 ? 2 : g1 >= 3 || h.earnings >= 100000 ? 1 : 0;
  if (!n) return;
  const score = {
    speed: h.pot.speed, stamina: h.pot.stamina, power: h.pot.power, guts: h.pot.guts, mind: h.pot.wit,
    burst: (h.pot.speed + h.pot.wit) / 2 + (h.style >= 0.6 ? 0.03 : -0.05),
    health: h.starts >= 35 && h.sound >= 0.7 ? h.sound : 0,
  };
  h.factors = Object.entries(score).sort((a, b) => b[1] - a[1]).slice(0, n).map(([f]) => f);
}

// ---------------------------------------------------------------- 血の活力

/**
 * 血の活力。父系・母父系・父の母父系・母の母父系の 4 つが別々の系統なら、
 * どの系統にも寄らない雑種強勢として仔の能力が少し上がる。
 * インブリード（同じ血を重ねる）と反対向きの、もう一つの配合の軸。
 */
export function vigorOf(world, sireId, damId) {
  const sire = world.horses.get(sireId);
  const dam = world.horses.get(damId);
  if (!sire || !dam) return { lines: 0, gain: 0, label: '—' };
  const damSireOf = (h) => {
    const d = h?.damId != null ? world.horses.get(h.damId) : null;
    return d?.sireId ?? null;
  };
  const ids = [sireId, dam.sireId, damSireOf(sire), damSireOf(dam)].filter((x) => x != null);
  const lines = new Set(ids.map((id) => sireLineRoot(world, id))).size;
  const known = ids.length;
  // 4 つとも分かっていて全部違えば「完全な異系」。同じ系統が 3 つ以上重なると少し損をする
  // （足し算だけにすると世代を重ねるほど全体が底上げされる）。
  const gain = known === 4 && lines === 4 ? 0.006 : known === 4 && lines <= 2 ? -0.006 : 0;
  const label = known < 4 ? `${lines} 系統（一部不明）`
    : lines === 4 ? '4 系統（完全な異系）' : `${lines} 系統`;
  return { lines, gain, label };
}

// ---------------------------------------------------------------- 系統の確立

/** 系統が確立する条件。種牡馬になった息子の数と、元の系統の大きさ。 */
const ESTABLISH_SONS = 5;
const ESTABLISH_LINE_SIZE = 12;

/**
 * 系統の確立。名簿に 5 頭以上の息子を送り込んだ種牡馬は、大きな系統（12 頭以上）の
 * 中にいれば独立した「○○系」になる。サンデーサイレンス系からディープインパクト系が
 * 分かれるような動き。ニックスは元の系統の値を引き継ぎ、実績（標本）はゼロから数え直す。
 */
export function establishLines(world, rng, news = []) {
  const sons = new Map();
  const lineSize = new Map();
  for (const id of world.stallionPool) {
    const h = world.horses.get(id);
    if (!h || h.dead) continue;
    if (h.sireId != null) sons.set(h.sireId, (sons.get(h.sireId) ?? 0) + 1);
    const root = sireLineRoot(world, id);
    lineSize.set(root, (lineSize.get(root) ?? 0) + 1);
  }
  const made = [];
  for (const [sid, n] of sons) {
    if (n < ESTABLISH_SONS) continue;
    const s = world.horses.get(sid);
    if (!s || s.lineHead) continue;
    const root = sireLineRoot(world, sid);
    if (root === sid || (lineSize.get(root) ?? 0) < ESTABLISH_LINE_SIZE) continue;
    made.push({ s, root, n });
  }
  for (const { s, root, n } of made) {
    s.lineHead = true;
    world._lineEpoch = (world._lineEpoch ?? 0) + 1;     // 系統の判定の使い回し（theories.js）を捨てる
    s.lineFrom = root;
    s.lineEstablished = world.year;
    // 元の系統のニックスを写す。新しい系統だけ相性が空になると、配合の評価がいきなり「―」になる。
    const r = String(root);
    const add = [];
    for (const [key, v] of world.nicks) {
      const [a, b] = key.split('|');
      const jitter = () => Number((v + rng.normal(0, 0.08)).toFixed(2));
      if (a === r) add.push([nicksKey(s.id, b), jitter()]);
      if (b === r) add.push([nicksKey(a, s.id), jitter()]);
    }
    for (const [k, v] of add) if (!world.nicks.has(k)) world.nicks.set(k, v);
    news.push(`${s.name}系が確立した（${n} 頭の息子が種牡馬として供用中）。`);
  }
  return made.map((x) => x.s);
}
