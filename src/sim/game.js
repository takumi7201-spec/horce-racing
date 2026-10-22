// ゲーム層。UI から触る唯一の入口。
//
// 画面はここだけを見る。world.js の中身を直接いじらせないことで、
// 「セーブ可能な状態」と「表示のための導出値」を分けている。

import { createWorld, advanceWeek, weekRaces, weekGround, horsesOf, stallionList, computeLeaders, retireHorse } from './world.js';
import { eligible, weekLabel, gradedCalendar, GRADED_BY_ID, meetingsOf } from './schedule.js';
import { horseAge, effectiveAbility, styleLabel, distanceAptitude, canRun, STYLE_TARGET } from './horse.js';
import { readyToRun, MENUS, fitLabel, condLabel } from './training.js';
import { matingEval, pedigreeTree, nicksValue, lineLabel, breedQuality } from './pedigree.js';
import { studFeeOf, canBeBroodmare } from './breeding.js';
import { previewOdds } from './race.js';
import { makeRng, hashSeed } from '../core/rng.js';
import { EVENTS, eventsAt, eventOpen } from './calendar.js';
import * as S from './sales.js';
import {
  ABILITIES, SEX, WEEKS_PER_YEAR, classOrder, className, standardWeight,
  weekToMonth, STYLES,
} from './params.js';
import { SURFACE, courseName, getCourse, DIR } from './course.js';
import { clamp01, sum, byDesc, formatMoney, formatTime, rankOf } from '../core/util.js';

/** 新規ゲーム。 */
export function newGame({ seed = Date.now() & 0xffffff, playerName = '', farmName = '', startYear = 2026, realSires = true } = {}) {
  const world = createWorld(seed, { startYear, playerName, farmName, realSires });
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
    dead: !!h.dead,
    real: !!h.real,
    foreign: !!h.foreign,
    // お腹の仔（受胎していれば父と生まれる年）。
    pregnancy: h.pregnancy ? { sire: w.horses.get(h.pregnancy.sireId)?.name ?? '—', year: h.pregnancy.year } : null,
    // 馬名登録前の 1 歳以下（「母名の年」で呼ばれている）。
    provisional: h.regName != null,
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
      real: !!s.real,
      bestWin: S.bestWin(s),
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
  if (!matingOpen(g)) return { ok: false, why: '種付けは 5〜6 月（種付けシーズン）だけ' };
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
  const { results, news, yearSummary } = advanceWeek(w);
  const mine = results.filter((r) =>
    r.log && r.results.some((x) => w.horses.get(x.horseId)?.ownerId === 'player'));
  return {
    at: before,
    label: weekLabel(before.week),
    results,
    myRaces: mine,
    news,
    money: w.player.money,
    // 12 月 4 週を進めたときだけ入る。年末処理の画面に出す。
    yearSummary,
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

/**
 * 馬の詳細の「成績」欄。全成績・芝・ダート・重賞別・回り別を 1-2-3-着外で数え、
 * 主な勝鞍と路線、今週の次走も返す。
 * 開始前の戦績（past）は着順しか持たないので、全成績と重賞にだけ数える。
 */
export function horseCareer(g, id) {
  const w = g.world;
  const h = w.horses.get(id);
  if (!h) return null;
  const blank = () => [0, 0, 0, 0];
  const c = { all: blank(), turf: blank(), dirt: blank(), GI: blank(), GII: blank(), GIII: blank(), right: blank(), left: blank() };
  const put = (k, order) => { c[k][Math.min(3, order - 1)]++; };
  const wins = [];
  // 開始前の戦績は格付けを 'G1' の形で持っている。
  const GR = { G1: 'GI', G2: 'GII', G3: 'GIII' };
  for (const r of h.record) {
    const grade = GR[r.grade] ?? r.grade;
    if (c[grade]) put(grade, r.order);
    if (!r.past) {
      put(r.surface === SURFACE.DIRT ? 'dirt' : 'turf', r.order);
      const dir = getCourse(r.courseId)?.dir;
      if (dir) put(dir === DIR.LEFT ? 'left' : 'right', r.order);
    }
    if (r.order === 1) wins.push({ ...r, grade });
  }
  // 記録は直近 30 走しか持たないので、全成績は通算の数字で上書きする。
  c.all = h.placesUnknown ? [h.wins, null, null, null]
    : [h.wins, h.seconds ?? 0, h.thirds ?? 0, Math.max(0, h.starts - h.wins - (h.seconds ?? 0) - (h.thirds ?? 0))];
  const rank = { GI: 0, GII: 1, GIII: 2 };
  const bigWins = wins.slice().sort((a, b) => (rank[a.grade] ?? 9) - (rank[b.grade] ?? 9) || b.year - a.year)
    .slice(0, 4).map((r) => ({ name: r.name, grade: r.grade ?? null, year: r.year }));
  const surface = (h.dirt ?? 0) > (h.turf ?? 0) + 0.05 ? 'ダート' : '芝';
  const band = h.dist <= 1400 ? '短距離' : h.dist <= 1800 ? 'マイル' : h.dist <= 2400 ? '中距離' : '長距離';
  const entry = [...w.player.entries.values()].find((e) => e.horseId === id);
  const next = entry ? decorate(w, weekRaces(w).find((r) => r.raceId === entry.raceId) ?? {}) : null;
  return {
    counts: c, bigWins,
    route: `${surface}${band}`,
    next: next && next.name ? { name: next.name, grade: next.grade ?? null, label: weekLabel(w.week) } : null,
  };
}

/**
 * 自分の幼駒（当歳・1 歳）。
 * 自家生産の仔は 2 歳の年明けに厩舎へ入るまで player.horses に載らない
 * （world.js の newYear）ので、所有者で全頭から拾う。セリで買った 1 歳馬もここに入る。
 */
export function myYoungsters(g) {
  const w = g.world;
  const out = [];
  for (const h of w.horses.values()) {
    if (h.ownerId === 'player' && !h.dead && !h.retired && horseAge(h, w.year) < 2) out.push(h);
  }
  return out.sort((a, b) => b.birthYear - a.birthYear || a.id - b.id);
}

/** 所有馬を 4 つに分ける。現役（2 歳以上）・繁殖牝馬・種牡馬・幼駒。 */
export function myStable(g) {
  const young = myYoungsters(g);
  const ys = new Set(young.map((h) => h.id));
  return {
    active: myHorses(g).filter((h) => !ys.has(h.id)),
    mares: myBroodmares(g),
    stallions: myStallions(g),
    young,
  };
}

export const STABLE_CATEGORIES = [
  { id: 'active', name: '現役馬' },
  { id: 'mares', name: '繁殖牝馬' },
  { id: 'stallions', name: '種牡馬' },
  { id: 'young', name: '幼駒' },
];

/** その馬が所有馬のどの区分に入るか。自分の馬でなければ null。 */
export function stableCategoryOf(g, id) {
  const st = myStable(g);
  for (const c of STABLE_CATEGORIES) if (st[c.id].some((h) => h.id === id)) return c.id;
  return null;
}

/**
 * 左右に送って見られる馬の並び。区分を指定すればその区分の中だけ、
 * 無ければ所有馬一覧と同じ順（現役 → 繁殖牝馬 → 種牡馬 → 幼駒）。
 */
export function myLineup(g, category = null) {
  const st = myStable(g);
  const cats = category ? [category] : STABLE_CATEGORIES.map((c) => c.id);
  return cats.flatMap((c) => (st[c] ?? []).map((h) => h.id));
}





// ---------------------------------------------------------------- 年間スケジュール

/** 種付けシーズン（5〜6 月）か。予約は 6 月 4 週の締めでまとめて受胎判定する。 */
export const matingOpen = (g) => eventOpen('covering', g.world.week);

/**
 * 牧場の行事の一覧と、今年の進み具合（済 / 今週 / これから）。
 * ホームの「年間スケジュール」と、行事の週の案内に使う。
 */
export function farmEvents(g) {
  const wk = g.world.week;
  return EVENTS.map((e) => ({
    ...e,
    status: wk > e.to ? 'done' : wk >= e.from ? 'now' : 'next',
  }));
}

/** 今週開かれている行事。 */
export const eventsNow = (g) => eventsAt(g.world.week);

// ---------------------------------------------------------------- セール

export const saleOpen = (g, kind) => S.saleOpen(g.world, kind);
export const foalSale = (g) => S.foalSaleLots(g.world);
export const privateSale = (g) => S.privateLots(g.world);
export const mareSale = (g) => S.mareSaleLots(g.world);
export const overseasSale = (g) => S.overseasLots(g.world);
export const buyLot = (g, kind, id) => S.buyLot(g.world, kind, id);
export const buyOverseas = (g, key) => S.buyOverseas(g.world, key, g.world.rng);

// ---------------------------------------------------------------- 入厩・馬名登録

/** 来年 2 歳になる自分の 1 歳馬。12 月 4 週に入厩先と馬名を決める。 */
export function entryCandidates(g) {
  const w = g.world;
  return myYoungsters(g).filter((h) => horseAge(h, w.year) === 1).map((h) => ({
    id: h.id, name: h.name, coat: h.coat, sex: h.sex,
    suggested: h.regName ?? h.name,
    plannedName: h.plannedName ?? null,
    plannedTrainerId: h.plannedTrainerId ?? null,
    sire: w.horses.get(h.sireId)?.name ?? '—',
    dam: w.horses.get(h.damId)?.name ?? '—',
  }));
}

export const entryOpen = (g) => eventOpen('entry', g.world.week);

/** 入厩先に選べる調教師。勝ち星の多い順。 */
export function trainerChoices(g, limit = 30) {
  return [...g.world.trainers.values()].filter((t) => !t.retired)
    .sort(byDesc((t) => t.wins * 3 + (t.skill ?? 0.5) * 10))
    .slice(0, limit)
    .map((t) => ({ id: t.id, name: t.name, region: t.region, style: t.style, wins: t.wins }));
}

/** 入厩先を決める。年明けの入厩でこの調教師に預ける。 */
export function planTrainer(g, horseId, trainerId) {
  const h = g.world.horses.get(horseId);
  if (!h || h.ownerId !== 'player') return { ok: false, why: '自分の馬ではない' };
  h.plannedTrainerId = trainerId;
  return { ok: true };
}

/**
 * 馬名を決める。カタカナ 2〜9 文字（JRA の規則）で、使われていない名前。
 * 空にすると候補（生まれたときに決めた名前）に戻る。
 */
export function planName(g, horseId, name) {
  const w = g.world;
  const h = w.horses.get(horseId);
  if (!h || h.ownerId !== 'player' || h.regName == null) return { ok: false, why: '馬名登録の対象ではない' };
  const n = (name ?? '').trim();
  if (!n) { delete h.plannedName; return { ok: true, name: h.regName }; }
  if (!/^[ァ-ヶー・]{2,9}$/.test(n)) return { ok: false, why: '馬名はカタカナ 2〜9 文字' };
  if (n !== h.regName && w.nameSet.has(n)) return { ok: false, why: 'その名前は使われている' };
  h.plannedName = n;
  return { ok: true, name: n };
}

/** 今週の開催場の名前。 */
export const meetings = (g) => meetingsOf(g.world.week).map(courseName);

/**
 * 牧場の放牧地に出す馬。ホーム画面の 3D に歩かせる。
 * 放牧中の馬・繁殖牝馬・デビュー前の若駒を優先し、それでも少なければ
 * 在厩の馬で埋める（在厩の馬しか居ないと、放牧地が空っぽに見えてしまう）。
 */
export function ranchHorses(g, limit = 7) {
  const w = g.world;
  const out = [];
  const seen = new Set();
  const push = (h, kind) => {
    if (!h || h.dead || seen.has(h.id) || out.length >= limit) return;
    seen.add(h.id);
    out.push({ id: h.id, name: h.name, coat: h.coat, sex: h.sex, age: horseAge(h, w.year), kind });
  };
  const mine = w.player.horses.map((id) => w.horses.get(id)).filter((h) => h && !h.dead && !h.retired);
  for (const h of myYoungsters(g)) push(h, '幼駒');
  for (const h of mine) if (h.stable !== 'stable') push(h, '放牧');
  for (const id of w.player.broodmares) push(w.horses.get(id), '繁殖');
  if (out.length < 3) for (const h of mine) push(h, '在厩');
  return out;
}

/**
 * 馬主ランキングでの順位。現役の所有馬の獲得賞金で並べる。
 * computeLeaders は上位 30 人しか持たないので、圏外でも順位が出るよう全員を数える。
 */
export function ownerRank(g) {
  const w = g.world;
  const score = (ids) => sum(ids, (id) => {
    const h = w.horses.get(id);
    return h && !h.dead && !h.retired ? h.earnings : 0;
  });
  const mine = score(w.player.horses);
  let rank = 1;
  let total = 0;
  for (const o of w.owners.values()) {
    total++;
    if (o.id !== 'player' && score(o.horses) > mine) rank++;
  }
  const grade = rank <= 3 ? 'SS' : rank <= 10 ? 'S' : rank <= 25 ? 'A' : rank <= 50 ? 'B' : 'C';
  return { rank, total, grade, earnings: mine };
}

export { formatMoney, formatTime, weekLabel, SURFACE, SEX, ABILITIES, STYLES };
