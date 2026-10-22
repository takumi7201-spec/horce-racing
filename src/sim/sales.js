// 牧場の売り買い。年間スケジュールの各セールの上場馬と値段、購入。
//
//   8 月      当歳セール        今年生まれた幼駒（0 歳）
//   10 月     繁殖牝馬セール    実在の名牝と、ほかの牧場の繁殖牝馬
//   12 月 3 週 海外トレーニングセール  外国の 1 歳馬と繁殖牝馬
//   12 月 3〜4 週 庭先取引      売れ残った 1 歳馬（4 週が最終チャンス）
//
// 上場馬は (シード, 年) から決める。画面を開いただけで乱数が進むと、
// 開くたびに上場馬が入れ替わってしまう（番組表と同じ理由）。

import { eventOpen } from './calendar.js';
import { createHorse, horseAge } from './horse.js';
import { breedQuality, lineLabel } from './pedigree.js';
import { ABILITIES, SEX, COATS, GROWTH } from './params.js';
import { makeRng, hashSeed } from '../core/rng.js';
import { makeForeignName } from '../core/names.js';
import { clamp, clamp01, sum, byDesc } from '../core/util.js';

export const SALE_EVENT = { foal: 'foalSale', mare: 'mareSale', overseas: 'overseas', private: 'private' };

export const saleOpen = (w, kind) => eventOpen(SALE_EVENT[kind], w.week);

const nameOf = (w, id) => (id != null ? w.horses.get(id)?.name ?? '—' : '—');

function damSireOf(w, h) {
  const dam = h.damId != null ? w.horses.get(h.damId) : null;
  return dam ? nameOf(w, dam.sireId) : '—';
}

/** 市場は血統と馬体しか見られない。能力そのものは値段に乗らない。 */
function pedigreePrice(w, h, rng, scale = 1) {
  const sire = h.sireId != null ? w.horses.get(h.sireId) : null;
  const dam = h.damId != null ? w.horses.get(h.damId) : null;
  const v = (sire ? breedQuality(sire) : 0.3) * 0.6 + (dam ? breedQuality(dam) : 0.3) * 0.4;
  return Math.round((300 + Math.pow(v, 2.2) * 14000) * rng.range(0.7, 1.5) * scale / 10) * 10;
}

const LOOKS = ['小柄', '並', 'バランス良', '幅がある', '雄大'];
const lookOf = (kg) => LOOKS[clamp(Math.floor((kg - 400) / 40), 0, 4)];

function horseLot(w, h, price) {
  return {
    horse: h, id: h.id, key: String(h.id), name: h.name, sex: h.sex, coat: h.coat, age: horseAge(h, w.year),
    sire: nameOf(w, h.sireId), dam: nameOf(w, h.damId), damSire: damSireOf(w, h),
    damReal: !!w.horses.get(h.damId)?.real, sireReal: !!w.horses.get(h.sireId)?.real,
    realName: h.real ? h.regName ?? h.name : null,
    line: h.sireId != null ? lineLabel(w, h.id) : '—',
    inbreed: h.inbreedLabels ?? [],
    look: lookOf(h.weightKg),
    price,
  };
}

/** 生まれ年 age の、持ち主の居ない馬からセールの上場馬を選ぶ。 */
function ownerlessLots(w, age, tag, count, scale) {
  const rng = makeRng(hashSeed(`${w.seed}|${tag}|${w.year}`));
  const pool = [...w.horses.values()]
    .filter((h) => !h.dead && h.ownerId == null && horseAge(h, w.year) === age)
    .sort((a, b) => a.id - b.id);
  // 史実の名馬になる幼駒は必ず上場する（昔から始めたとき、ディープインパクトを買える機会）。
  const real = pool.filter((h) => h.real);
  const rest = pool.filter((h) => !h.real);
  rng.shuffle(rest);
  return [...real, ...rest].slice(0, count)
    .map((h) => horseLot(w, h, pedigreePrice(w, h, rng, scale)))
    .sort(byDesc((x) => (x.realName ? 1e9 : 0) + x.price));
}

/** 当歳セール（8 月）。今年 4 月に生まれた幼駒。 */
export const foalSaleLots = (w) => ownerlessLots(w, 0, 'foalsale', 40, 0.8);

/** 庭先取引（12 月 3〜4 週）。どこにも売れなかった 1 歳馬を、牧場から直接少し安く買う。 */
export const privateLots = (w) => ownerlessLots(w, 1, 'private', 30, 0.75);

// ---------------------------------------------------------------- 繁殖牝馬

/** 実在の母 → その実在の仔。GI 馬の母は値が上がる。 */
export function realOffspring(w) {
  const m = new Map();
  for (const h of w.horses.values()) {
    if (!h.real || h.damId == null) continue;
    if (!m.has(h.damId)) m.set(h.damId, []);
    m.get(h.damId).push(h);
  }
  return m;
}

/**
 * 繁殖牝馬の値段（万円）。格は能力と現役成績から、若いほど残りの繁殖年数ぶん高い。
 * GI 馬の母は仔の GI 1 勝につき 1,500 万を上乗せする。受胎していれば父の種付料の半分を乗せる。
 */
export function marePrice(w, h, kids = []) {
  const q = breedQuality(h);
  const age = horseAge(h, w.year);
  const ageF = age <= 12 ? 1 : Math.max(0.25, 1 - (age - 12) * 0.12);
  const produce = sum(kids, (k) => k.g1Wins ?? 0) * 1500;
  const inFoal = h.pregnancy ? (w.horses.get(h.pregnancy.sireId)?.studFee ?? 0) * 0.5 : 0;
  return Math.round((800 + Math.pow(q, 3) * 40000 + produce + inFoal) * ageF / 10) * 10;
}

/** 繁殖牝馬セール（10 月）。実在の名牝ぜんぶと、ほかの牧場の繁殖牝馬 20 頭。 */
export function mareSaleLots(w) {
  const kids = realOffspring(w);
  const rng = makeRng(hashSeed(`${w.seed}|maresale|${w.year}`));
  const pool = w.marePool.map((id) => w.horses.get(id))
    .filter((h) => h && !h.dead && h.ownerId !== 'player');
  const real = pool.filter((h) => h.real);
  const others = pool.filter((h) => !h.real && horseAge(h, w.year) >= 4 && horseAge(h, w.year) <= 14)
    .sort((a, b) => a.id - b.id);
  rng.shuffle(others);
  // ほかの牧場は良い牝馬ほど手放さないので、上場されるのは上から下まで満遍なく。
  return [...real, ...others.slice(0, 20)].map((h) => {
    const foals = (h.foals ?? []).map((id) => w.horses.get(id)).filter(Boolean);
    const best = foals.slice().sort(byDesc((f) => f.earnings))[0] ?? null;
    const realKids = (kids.get(h.id) ?? []).sort(byDesc((k) => k.g1Wins ?? 0));
    return {
      horse: h, id: h.id, key: String(h.id), name: h.name, coat: h.coat, real: !!h.real,
      age: horseAge(h, w.year),
      sire: nameOf(w, h.sireId), damSire: damSireOf(w, h),
      bestWin: bestWin(h),
      foals: foals.length,
      bestFoal: realKids[0]?.name ?? (best && best.earnings > 0 ? best.name : null),
      inFoal: h.pregnancy ? nameOf(w, h.pregnancy.sireId) : null,
      price: marePrice(w, h, kids.get(h.id)),
    };
  }).sort(byDesc((x) => x.price));
}

/** いちばん格の高い勝ち鞍の名前。 */
export function bestWin(h) {
  const order = { GI: 0, G1: 0, GII: 1, G2: 1, GIII: 2, G3: 2 };
  const wins = (h.record ?? []).filter((r) => r.order === 1 && r.grade);
  wins.sort((a, b) => (order[a.grade] ?? 9) - (order[b.grade] ?? 9));
  return wins[0]?.name ?? null;
}

// ---------------------------------------------------------------- 海外トレーニングセール

/**
 * 海外の上場馬。1 歳馬 8 頭と繁殖牝馬 4 頭。
 * 買われるまでは世界に馬を作らない（作ると見ただけで馬の id と名前が減っていく）。
 * 中身は (シード, 年, 番号) から決まるので、買ったときに同じ馬が作られる。
 */
export function overseasLots(w) {
  const sold = new Set();
  for (const h of w.horses.values()) if (h.lotKey) sold.add(h.lotKey);
  const out = [];
  for (let i = 0; i < 12; i++) {
    const key = `os-${w.year}-${i}`;
    const d = overseasSpec(w, key, i < 8 ? 'yearling' : 'mare');
    out.push({ ...d, key, sold: sold.has(key) });
  }
  return out;
}

function overseasSpec(w, key, kind) {
  const rng = makeRng(hashSeed(`${w.seed}|${key}`));
  // 似た文字列の種は最初の数個の乱数が揃いやすいので、読み捨ててから使う。
  for (let i = 0; i < 4; i++) rng.next();
  // 名前は世界の名簿を汚さないよう写しで引く。
  const used = new Set(w.nameSet);
  const yearling = kind === 'yearling';
  const level = clamp01(rng.normal(yearling ? 0.66 : 0.6, 0.07));
  const age = yearling ? 1 : rng.irange(5, 10);
  const sex = yearling ? (rng.chance(0.5) ? SEX.MALE : SEX.FEMALE) : SEX.FEMALE;
  const pot = {};
  for (const a of ABILITIES) pot[a] = clamp01(level + rng.normal(0, 0.06));
  const dist = clamp(Math.round(rng.normal(1800, 400) / 100) * 100, 1000, 3200);
  const turf = clamp01(rng.normal(0.78, 0.15));
  const dirt = clamp01(rng.normal(0.62, 0.2));
  const sireLevel = clamp01(level + 0.14 + rng.normal(0, 0.04));
  const damLevel = clamp01(level - 0.02 + rng.normal(0, 0.05));
  const q = sum(ABILITIES, (a) => pot[a]) / ABILITIES.length;
  // 当歳セールの上位（2,000〜5,000万）と同じくらいの帯。輸入の手間ぶんだけ高い。
  const price = yearling
    ? Math.round((1200 + Math.pow(sireLevel, 2) * 3500 + Math.pow(damLevel, 2) * 1500) * rng.range(0.85, 1.25) / 10) * 10
    : Math.round((1500 + Math.pow(q, 3) * 9000) * rng.range(0.85, 1.2) / 10) * 10;
  return {
    kind, yearling, foreign: true,
    name: makeForeignName(rng, { used }),
    sireName: makeForeignName(rng, { used }),
    damName: makeForeignName(rng, { used }),
    damSireName: makeForeignName(rng, { used }),
    sex, age, coat: rng.weighted(COATS, [40, 18, 16, 3, 10, 7, 3, 0]),
    birthYear: w.year - age,
    pot, dist, distRange: clamp(Math.round(rng.normal(460, 120)), 220, 900),
    turf, dirt, firm: clamp01(rng.normal(0.84, 0.1)), soft: clamp01(rng.normal(0.58, 0.16)),
    style: clamp01(rng.normal(0.5, 0.2)), temper: clamp01(rng.normal(0.55, 0.16)),
    sound: clamp01(rng.normal(0.62, 0.14)), spirit: clamp01(rng.normal(0.52, 0.16)),
    growth: rng.pick(GROWTH), weightKg: Math.round(clamp(rng.normal(470, 25), 400, 540)),
    sireLevel, damLevel,
    look: lookOf(470), price,
  };
}

/** 海外の上場馬を買う。父母（海外の馬）と本馬を世界に作る。 */
export function buyOverseas(w, key, rngForIds) {
  if (!saleOpen(w, 'overseas')) return { ok: false, why: '海外トレーニングセールは 12 月 3 週のみ' };
  const lot = overseasLots(w).find((x) => x.key === key);
  if (!lot) return { ok: false, why: '上場されていない' };
  if (lot.sold) return { ok: false, why: 'すでに落札済み' };
  if (w.player.money < lot.price) return { ok: false, why: '資金が足りない' };
  const mk = (name, sex, birthYear, level) => {
    const h = createHorse(rngForIds, { name, sex, birthYear });
    for (const a of ABILITIES) { h.pot[a] = clamp01(level); h.cur[a] = h.pot[a]; }
    h.dist = lot.dist; h.distRange = lot.distRange; h.turf = lot.turf; h.dirt = lot.dirt;
    h.retired = true; h.stable = 'retired'; h.foreign = true;
    h.earnings = Math.round(level * level * 30000);
    w.horses.set(h.id, h);
    w.nameSet.add(name);
    return h;
  };
  const damSire = mk(lot.damSireName, SEX.MALE, lot.birthYear - 14, lot.damLevel + 0.1);
  const sire = mk(lot.sireName, SEX.MALE, lot.birthYear - 8, lot.sireLevel);
  const dam = mk(lot.damName, SEX.FEMALE, lot.birthYear - 7, lot.damLevel);
  dam.sireId = damSire.id;
  const h = createHorse(rngForIds, { name: lot.name, sex: lot.sex, birthYear: lot.birthYear, sireId: sire.id, damId: dam.id });
  for (const k of ['coat', 'growth', 'dist', 'distRange', 'turf', 'dirt', 'firm', 'soft', 'style', 'temper', 'sound', 'spirit', 'weightKg']) {
    h[k] = lot[k];
  }
  for (const a of ABILITIES) {
    h.pot[a] = lot.pot[a];
    h.cur[a] = clamp01(lot.pot[a] * (lot.yearling ? 0.24 : 0.92));
  }
  h.foreign = true;
  h.lotKey = key;
  h.ownerId = 'player';
  w.horses.set(h.id, h);
  w.nameSet.add(lot.name);
  sire.foals.push(h.id);
  dam.foals.push(h.id);
  if (lot.yearling) {
    // 1 歳馬は年末に馬名登録する（それまでは「母名の年」で呼ぶ）。
    h.regName = lot.name;
    h.name = `${lot.damName}の${lot.birthYear}`;
  } else {
    // 繁殖牝馬は向こうで走った実績を持って来る（血統の格に効く）。
    h.earnings = Math.round(Math.pow(sum(ABILITIES, (x) => lot.pot[x]) / ABILITIES.length, 2) * 20000);
    h.retired = true; h.stable = 'retired'; h.broodmare = true;
    w.marePool.push(h.id);
    w.player.broodmares.push(h.id);
  }
  w.owners.get('player')?.horses.push(h.id);
  w.player.money -= lot.price;
  return { ok: true, price: lot.price, horse: h };
}

// ---------------------------------------------------------------- 購入

/** 当歳・庭先・繁殖牝馬セールの購入。 */
export function buyLot(w, kind, id) {
  if (!saleOpen(w, kind)) return { ok: false, why: 'いまはそのセールの時期ではない' };
  const lots = kind === 'foal' ? foalSaleLots(w) : kind === 'private' ? privateLots(w) : mareSaleLots(w);
  const lot = lots.find((x) => x.id === id);
  if (!lot) return { ok: false, why: '上場されていない' };
  if (w.player.money < lot.price) return { ok: false, why: '資金が足りない' };
  const h = w.horses.get(id);
  h.ownerId = 'player';
  w.player.money -= lot.price;
  if (kind === 'mare') {
    h.broodmare = true;
    w.player.broodmares.push(id);
  } else {
    // 幼駒と 1 歳馬は 2 歳の年明けに厩舎へ入る（player.horses にはそのとき載る）。
    h.stable = 'pasture';
    h.trainingMenu = 'light';
    w.owners.get('player')?.horses.push(id);
  }
  return { ok: true, price: lot.price, horse: h };
}
