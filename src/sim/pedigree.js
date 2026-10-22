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
