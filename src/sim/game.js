// ゲーム層。UI から触る唯一の入口。
//
// 画面はここだけを見る。world.js の中身を直接いじらせないことで、
// 「セーブ可能な状態」と「表示のための導出値」を分けている。

import { createWorld, advanceWeek, weekRaces, weekGround, horsesOf, stallionList, computeLeaders, retireHorse } from './world.js';
import { eligible, weekLabel, gradedCalendar, GRADED_BY_ID } from './schedule.js';
import { horseAge, effectiveAbility, styleLabel, distanceAptitude, canRun, STYLE_TARGET } from './horse.js';
import { readyToRun, MENUS, fitLabel, condLabel } from './training.js';
import { matingEval, pedigreeTree, nicksValue, lineLabel, breedQuality } from './pedigree.js';
import { studFeeOf, canBeBroodmare } from './breeding.js';
import { previewOdds } from './race.js';
import { makeRng, hashSeed } from '../core/rng.js';
import {
  ABILITIES, SEX, WEEKS_PER_YEAR, classOrder, className, standardWeight,
  weekToMonth, STYLES,
} from './params.js';
import { SURFACE, courseName } from './course.js';
import { clamp01, sum, byDesc, formatMoney, formatTime, rankOf } from '../core/util.js';

/** 新規ゲーム。 */
export function newGame({ seed = Date.now() & 0xffffff, playerName = '', farmName = '', startYear = 2026 } = {}) {
  const world = createWorld(seed, { startYear, playerName, farmName });
  return { world, version: 2 };
}

// ---------------------------------------------------------------- 参照

export const player = (g) => g.world.player;
export const now = (g) => ({ year: g.world.year, week: g.world.week, label: weekLabel(g.world.week) });

/** 所有馬（現役）。 */
export function myHorses(g) {
  const w = g.world;
  return w.player.horses
    .map((id) => w.horses.get(id))
    .filter((h) => h && !h.dead && !h.retired)
    .sort(byDesc((h) => h.earnings));
}

/** 所有繁殖牝馬。 */
export function myBroodmares(g) {
  const w = g.world;
  return w.player.broodmares.map((id) => w.horses.get(id)).filter((h) => h && !h.dead);
}

/** 所有種牡馬。 */
export function myStallions(g) {
  const w = g.world;
  return w.player.stallions.map((id) => w.horses.get(id)).filter((h) => h && !h.dead);
}

export const getHorse = (g, id) => g.world.horses.get(id);
export const getJockey = (g, id) => g.world.jockeys.get(id);
export const getTrainer = (g, id) => g.world.trainers.get(id);

/** 表示用の 1 頭ぶんの情報。画面はこれを読むだけで済む。 */
export function horseView(g, id) {
  const w = g.world;
  const h = w.horses.get(id);
  if (!h) return null;
  const eff = effectiveAbility(h, w.year);
  const raw = effectiveAbility(h, w.year, { ignoreCondition: true });
  return {
    horse: h,
    id: h.id, name: h.name, sex: h.sex, coat: h.coat,
    age: horseAge(h, w.year),
    owner: w.owners.get(h.ownerId)?.name ?? '—',
    isMine: h.ownerId === 'player',
    trainer: w.trainers.get(h.trainerId)?.name ?? '—',
    trainerStyle: w.trainers.get(h.trainerId)?.style ?? '',
    jockey: w.jockeys.get(h.jockeyId)?.name ?? '—',
    sire: h.sireId != null ? w.horses.get(h.sireId)?.name ?? '—' : '—',
    dam: h.damId != null ? w.horses.get(h.damId)?.name ?? '—' : '—',
    damSire: damSireName(w, h),
    line: h.sireId != null ? lineLabel(w, h.id) : '—',
    ranks: Object.fromEntries(ABILITIES.map((a) => [a, rankOf(raw[a])])),
    values: Object.fromEntries(ABILITIES.map((a) => [a, raw[a]])),
    todays: Object.fromEntries(ABILITIES.map((a) => [a, eff[a]])),
    growth: h.growth,
    style: styleLabel(h),
    dist: h.dist, distRange: h.distRange,
    turf: h.turf, dirt: h.dirt, firm: h.firm, soft: h.soft,
    temper: h.temper, sound: h.sound, spirit: h.spirit,
    fit: h.fit, fitLabel: fitLabel(h.fit),
    cond: h.cond, condLabel: condLabel(h.cond),
    fatigue: h.fatigue,
    injury: h.injury,
    stable: h.stable,
    classId: h.classId ?? 'maiden', className: className(h.classId ?? 'maiden'),
    starts: h.starts, wins: h.wins, seconds: h.seconds, thirds: h.thirds,
    earnings: h.earnings,
    record: h.record.slice().reverse(),
    titles: h.titles ?? [],
    inbreed: h.inbreedLabels ?? [],
    menu: h.trainingMenu ?? 'normal',
    ready: readyToRun(h),
    stallion: h.stallion, broodmare: h.broodmare, studFee: h.studFee,
    foals: (h.foals ?? []).map((fid) => w.horses.get(fid)).filter(Boolean),
    retired: h.retired,
  };
}

function damSireName(w, h) {
  const dam = h.damId != null ? w.horses.get(h.damId) : null;
  if (!dam || dam.sireId == null) return '—';
  return w.horses.get(dam.sireId)?.name ?? '—';
}

/** 血統表（世代数指定）。 */
export const pedigree = (g, id, gens = 4) => pedigreeTree(g.world, id, gens);

// ---------------------------------------------------------------- 番組と登録

/** 今週以降 n 週ぶんの番組。 */
export function schedule(g, weeks = 1) {
  const w = g.world;
  const out = [];
  for (let i = 0; i < weeks; i++) {
    let wk = w.week + i, yr = w.year;
    while (wk > WEEKS_PER_YEAR) { wk -= WEEKS_PER_YEAR; yr++; }
    out.push({
      year: yr, week: wk, label: weekLabel(wk),
      races: weekRaces(w, wk, yr).map((r) => decorate(w, r)),
    });
  }
  return out;
}

function decorate(w, r) {
  return {
    ...r,
    courseName: courseName(r.courseId),
    className: r.grade ?? className(r.classId),
    ageLabel: r.age[1] >= 99 ? `${r.age[0]}歳以上` : `${r.age[0]}歳`,
    sexLabel: r.sex === '牝' ? '牝' : '',
  };
}

/** この馬が出られる今週のレース。 */
export function racesFor(g, horseId, weekOffset = 0) {
  const w = g.world;
  const h = w.horses.get(horseId);
  if (!h) return [];
  let wk = w.week + weekOffset, yr = w.year;
  while (wk > WEEKS_PER_YEAR) { wk -= WEEKS_PER_YEAR; yr++; }
  const ho = classOrder(h.classId ?? 'nowin');
  return weekRaces(w, wk, yr)
    .filter((r) => eligible(r, h, yr))
    .map((r) => {
      const apt = distanceAptitude(h, r.distance)
        * (r.surface === SURFACE.DIRT ? h.dirt : h.turf);
      const d = Math.abs(classOrder(r.classId) - ho);
      return { ...decorate(w, r), apt, classGap: d };
    })
    // 適性が高く、格の合うレースを上に出す。
    // 格の高さで並べると、未勝利馬の画面の一番上に重賞が来てしまう。
    .sort(byDesc((r) => r.apt * (r.classGap === 0 ? 1 : r.classGap === 1 ? 0.75 : 0.4)));
}

/** 出走登録。1 頭 1 週 1 レース。 */
export function enterRace(g, horseId, raceId, { jockeyId = null, styleOrder = null } = {}) {
  const w = g.world;
  const h = w.horses.get(horseId);
  if (!h) return { ok: false, why: '馬が見つからない' };
  const ready = readyToRun(h);
  if (!ready.ok) return { ok: false, why: ready.why };
  const race = weekRaces(w).find((r) => r.raceId === raceId);
  if (!race) return { ok: false, why: 'そのレースは今週ではない' };
  if (!eligible(race, h, w.year)) return { ok: false, why: '出走条件を満たさない' };
  // 同じ馬の二重登録と、同じレースへの複数登録を外す。
  for (const [rid, e] of [...w.player.entries]) {
    if (e.horseId === horseId) w.player.entries.delete(rid);
  }
  w.player.entries.set(raceId, {
    raceId, horseId,
    jockeyId: jockeyId ?? h.jockeyId,
    styleOrder: styleOrder ?? null,
  });
  return { ok: true, race: decorate(w, race) };
}

export function cancelEntry(g, raceId) {
  g.world.player.entries.delete(raceId);
}

export function myEntries(g) {
  const w = g.world;
  const races = weekRaces(w);
  return [...w.player.entries.values()].map((e) => ({
    ...e,
    race: decorate(w, races.find((r) => r.raceId === e.raceId) ?? {}),
    horse: w.horses.get(e.horseId),
    jockeyName: w.jockeys.get(e.jockeyId)?.name ?? '—',
  }));
}

/** 騎乗を頼める騎手の一覧（腕順）。 */
export function availableJockeys(g, limit = 40) {
  return [...g.world.jockeys.values()]
    .filter((j) => !j.retired)
    .sort(byDesc((j) => j.skill))
    .slice(0, limit);
}

export const styleOrders = () => STYLES;

// ---------------------------------------------------------------- 調教と厩舎

export function setTraining(g, horseId, menuId) {
  const h = g.world.horses.get(horseId);
  if (!h) return false;
  h.trainingMenu = menuId;
  return true;
}

export const trainingMenus = () => MENUS;

/** 入厩・放牧。 */
export function setStable(g, horseId, where) {
  const h = g.world.horses.get(horseId);
  if (!h || h.retired) return false;
  if (h.injury && where === 'stable') return false;
  h.stable = where;
  if (where === 'pasture') h.trainingMenu = 'rest';
  return true;
}

/** 主戦騎手の変更。 */
export function setMainJockey(g, horseId, jockeyId) {
  const h = g.world.horses.get(horseId);
  if (!h) return false;
  h.jockeyId = jockeyId;
  return true;
}

/** 引退させる。 */
export function retire(g, horseId) {
  const w = g.world;
  const h = w.horses.get(horseId);
  if (!h || h.retired) return false;
  retireHorse(w, h, w.rng, w.news);
  return true;
}

// ---------------------------------------------------------------- 配合

/** 種牡馬の一覧。予算内で絞れる。 */
export function stallions(g, { maxFee = Infinity, search = '' } = {}) {
  const w = g.world;
  return stallionList(w, { maxFee })
    .filter((s) => !search || s.name.includes(search))
    .map((s) => ({
      horse: s, id: s.id, name: s.name,
      age: horseAge(s, w.year),
      fee: s.studFee ?? studFeeOf(w, s, w.year),
      line: lineLabel(w, s.id),
      earnings: s.earnings,
      foals: (s.foals ?? []).length,
      quality: breedQuality(s),
    }));
}

/** 配合の評価。プレイヤーに見せる期待度と注意点。 */
export function evaluateMating(g, damId, sireId) {
  const w = g.world;
  const ev = matingEval(w, sireId, damId);
  if (!ev) return null;
  const nk = ev.nicks;
  return {
    stars: ev.stars,
    score: ev.score,
    risk: ev.risk,
    fee: ev.sire.studFee ?? studFeeOf(w, ev.sire, w.year),
    inbreed: ev.inbreed.map((x) => ({ name: x.name, label: x.label })),
    inbreedNote: ev.inbreedEffect.notes,
    nicks: nk.known ? { grade: nicksGradeOf(nk.value), samples: nk.samples } : { grade: '？', samples: nk.samples },
    sireLine: lineLabel(w, sireId),
    damSireLine: ev.dam.sireId != null ? lineLabel(w, ev.dam.sireId) : '—',
    comment: matingComment(ev),
  };
}

function nicksGradeOf(v) {
  if (v >= 0.6) return '◎';
  if (v >= 0.3) return '○';
  if (v >= 0.1) return '△';
  if (v > -0.1) return '―';
  if (v > -0.35) return '▲';
  return '×';
}

function matingComment(ev) {
  const c = [];
  const best3x4 = ev.inbreed.find((x) => x.label === '3×4');
  if (best3x4) c.push(`${best3x4.name} の 3×4 が入る`);
  if (ev.risk > 0.4) c.push('近交が強く、丈夫さに不安が出る');
  if (ev.coherence < 0.6) c.push('父と母で距離の指向が離れている');
  if (ev.parentPower > 0.7) c.push('両親ともに血統的な裏付けがある');
  if (c.length === 0) c.push('無難な配合');
  return c.join('。');
}

/** 配合を予約する。種付料をその場で払う。 */
export function bookMating(g, damId, sireId) {
  const w = g.world;
  const dam = w.horses.get(damId);
  const sire = w.horses.get(sireId);
  if (!dam || !sire) return { ok: false, why: '馬が見つからない' };
  if (!canBeBroodmare(dam, w.year + 1)) return { ok: false, why: 'この牝馬は繁殖に上がれない' };
  if (dam.ownerId !== 'player') return { ok: false, why: '自分の繁殖牝馬ではない' };
  const fee = sire.studFee ?? studFeeOf(w, sire, w.year);
  if (w.player.money < fee) return { ok: false, why: `資金が足りない（${formatMoney(fee)}必要）` };
  // 同じ牝馬の予約は上書き。
  w.pendingMatings = w.pendingMatings.filter((m) => m.damId !== damId);
  w.pendingMatings.push({ damId, sireId, fee, year: w.year });
  w.player.money -= fee;
  return { ok: true, fee };
}

export function myMatings(g) {
  const w = g.world;
  return w.pendingMatings.map((m) => ({
    ...m,
    dam: w.horses.get(m.damId),
    sire: w.horses.get(m.sireId),
  }));
}

export function cancelMating(g, damId) {
  const w = g.world;
  const m = w.pendingMatings.find((x) => x.damId === damId);
  if (!m) return false;
  w.pendingMatings = w.pendingMatings.filter((x) => x.damId !== damId);
  w.player.money += m.fee; // 全額返る。簡略
  return true;
}

// ---------------------------------------------------------------- 売買

/**
 * セリ市。毎年秋（10 月）に 1 歳馬が上場される。
 * 上場馬と価格は (シード, 年) から決まるので、何度開いても同じ。
 */
export function auction(g) {
  const w = g.world;
  const rng = makeRng(hashSeed(`${w.seed}|auction|${w.year}`));
  const yearlings = [...w.horses.values()]
    .filter((h) => horseAge(h, w.year) === 1 && !h.dead && h.ownerId == null);
  rng.shuffle(yearlings);
  return yearlings.slice(0, 40).map((h) => {
    const sire = h.sireId != null ? w.horses.get(h.sireId) : null;
    // 市場は血統と馬体しか見られない。能力そのものは値段に乗らない。
    const pedigreeValue = (sire ? breedQuality(sire) : 0.3) * 0.6
      + (h.damId != null ? breedQuality(w.horses.get(h.damId) ?? { pot: {}, earnings: 0 }) : 0.3) * 0.4;
    const price = Math.round((300 + Math.pow(pedigreeValue, 2.2) * 14000) * rng.range(0.7, 1.5) / 10) * 10;
    return {
      horse: h, id: h.id, name: h.name, sex: h.sex, coat: h.coat,
      sire: sire?.name ?? '—',
      dam: h.damId != null ? w.horses.get(h.damId)?.name ?? '—' : '—',
      damSire: damSireName(w, h),
      line: h.sireId != null ? lineLabel(w, h.id) : '—',
      inbreed: h.inbreedLabels ?? [],
      price,
      // 見た目の評価。能力とは緩く相関するだけ。
      look: ['小柄', '並', 'バランス良', '幅がある', '雄大'][Math.min(4, Math.floor((h.weightKg - 400) / 40))],
    };
  }).sort(byDesc((x) => x.price));
}

export function auctionOpen(g) {
  return weekToMonth(g.world.week) === 10;
}

export function buyYearling(g, horseId) {
  const w = g.world;
  const lot = auction(g).find((x) => x.id === horseId);
  if (!lot) return { ok: false, why: '上場されていない' };
  if (!auctionOpen(g)) return { ok: false, why: 'セリは 10 月のみ' };
  if (w.player.money < lot.price) return { ok: false, why: '資金が足りない' };
  const h = w.horses.get(horseId);
  h.ownerId = 'player';
  w.owners.get('player').horses.push(h.id);
  w.player.horses.push(h.id);
  w.player.money -= lot.price;
  h.stable = 'pasture';
  h.trainingMenu = 'light';
  return { ok: true, price: lot.price, horse: h };
}

/** 所有馬の売却。言い値の 7 割くらいで売れる。 */
export function sellHorse(g, horseId) {
  const w = g.world;
  const h = w.horses.get(horseId);
  if (!h || h.ownerId !== 'player') return { ok: false, why: '自分の馬ではない' };
  const ab = sum(ABILITIES, (a) => h.cur[a]) / ABILITIES.length;
  const price = Math.round((200 + h.earnings * 0.5 + Math.pow(ab, 2.4) * 9000) * 0.7 / 10) * 10;
  w.player.money += price;
  w.player.horses = w.player.horses.filter((x) => x !== horseId);
  w.player.broodmares = w.player.broodmares.filter((x) => x !== horseId);
  const o = w.owners.get('player');
  o.horses = o.horses.filter((x) => x !== horseId);
  // 他の馬主に渡る。
  const others = [...w.owners.values()].filter((x) => !x.isPlayer);
  const nw = others[Math.floor(w.rng.next() * others.length)];
  h.ownerId = nw.id;
  nw.horses.push(h.id);
  return { ok: true, price };
}

// ---------------------------------------------------------------- 週送り

/**
 * 1 週進める。
 * 自分の馬が走るレースは走行ログ付きで返すので、そのまま 3D に渡せる。
 */
export function nextWeek(g) {
  const w = g.world;
  const before = { year: w.year, week: w.week };
  const { results, news } = advanceWeek(w);
  const mine = results.filter((r) =>
    r.log && r.results.some((x) => w.horses.get(x.horseId)?.ownerId === 'player'));
  return {
    at: before,
    label: weekLabel(before.week),
    results,
    myRaces: mine,
    news,
    money: w.player.money,
  };
}

/** 直近の結果一覧（重賞優先）。 */
export function recentResults(g) {
  return g.world.results
    .slice()
    .sort(byDesc((r) => (r.grade === 'GI' ? 3 : r.grade === 'GII' ? 2 : r.grade ? 1 : 0)));
}

// ---------------------------------------------------------------- 記録・ランキング

export function leaders(g) {
  return computeLeaders(g.world);
}

export function gradedHistory(g, { year = null, defId = null } = {}) {
  return g.world.history.filter((x) =>
    (year == null || x.year === year) && (defId == null || x.defId === defId));
}

export const calendar = () => gradedCalendar();

export function courseRecords(g) {
  const out = [];
  for (const [key, v] of g.world.records) {
    const [cid, surface, dist] = key.split('|');
    out.push({ courseId: cid, courseName: courseName(cid), surface, distance: Number(dist), ...v });
  }
  return out.sort((a, b) => a.courseName.localeCompare(b.courseName) || a.distance - b.distance);
}

/** 現役の強い馬（ランキング）。獲得賞金順。 */
export function topHorses(g, limit = 30) {
  const w = g.world;
  return [...w.horses.values()]
    .filter((h) => !h.dead && !h.retired && horseAge(h, w.year) >= 2)
    .sort(byDesc((h) => h.earnings))
    .slice(0, limit);
}

/** 経営の状況。 */
export function finance(g) {
  const w = g.world;
  const p = w.player;
  return {
    money: p.money,
    weeklyCost: p.weeklyCost,
    horses: p.horses.length,
    stabled: p.horses.filter((id) => w.horses.get(id)?.stable === 'stable').length,
    broodmares: p.broodmares.length,
    stallions: p.stallions.length,
    earnings: p.earnings,
    starts: p.starts, wins: p.wins, g1: p.g1,
    titles: p.titles,
  };
}

export { formatMoney, formatTime, weekLabel, SURFACE, SEX, ABILITIES, STYLES };
