// 出走の見込みと、オート出走登録（落とし穴 152）。
//
// 「勝てる見込み」は、その馬のレースでの地力（能力 × 適性）と、そのレースに集まる相手の強さの差で測る。
// 相手の強さは、同じクラスの現役馬の地力の分布（重賞はオープン馬の上位）から取る。走らせて確かめるのではなく
// 統計で見積もる（レースを走らせると乱数が要り、1 頭の候補に数十レースを回すと重い）。
// 乱数を使わない。結果は世界に書かない（見積もりを見ただけで世界が変わらない）。

import { ABILITIES, WEEKS_PER_YEAR, classOrder } from './params.js';
import { effectiveAbility, distanceAptitude, horseAge } from './horse.js';
import { SURFACE } from './course.js';
import { eligible } from './schedule.js';
// world.js もこのモジュールを読む（循環）。使うのは関数の中だけなので読み込みの順に依らない。
import { weekRaces } from './world.js';

// 地力の重み。レースの速さはスピードが主で、ほかは余力と追い比べに効く（race.js の写像の大づかみ）。
const W = { speed: 0.42, stamina: 0.2, power: 0.14, guts: 0.14, wit: 0.1 };

/** 適性の掛け方。得意な条件なら 1（落とし穴 12：一定以上は頭打ち）、外れるほど下がる。 */
function aptMul(h, race) {
  const apt = distanceAptitude(h, race.distance) * (race.surface === SURFACE.DIRT ? h.dirt : h.turf);
  return { apt, mul: 0.86 + 0.14 * Math.min(1, apt / 0.8) };
}

/** その年の地力（能力の重み付き平均）。 */
function baseRating(h, year) {
  const a = effectiveAbility(h, year, { ignoreCondition: true });
  let s = 0;
  for (const k of ABILITIES) s += a[k] * W[k];
  return s;
}

/** レースでの地力（適性込み）。 */
export function raceRating(h, race, year) {
  return baseRating(h, year) * aptMul(h, race).mul;
}

/**
 * クラスごとの相手の強さ（地力の分布）。世界の週ごとに 1 度だけ数える（現役 2,000 頭ほどで数 ms）。
 * 条件戦は同じクラスの上位 2 割（勝ち負けになる相手）、重賞はオープン馬の上位（GIII 3 割・GII 1.5 割・GI 6%）。
 */
function fieldBars(world) {
  const key = `${world.year}:${world.week}`;
  if (world._fieldBars?.key === key) return world._fieldBars;
  const by = new Map();
  for (const h of world.horses.values()) {
    if (h.dead || h.retired || (h.stable !== 'stable' && h.stable !== 'pasture')) continue;
    if (horseAge(h, world.year) < 2 || h.os) continue;
    const c = Math.min(5, classOrder(h.classId ?? 'nowin'));
    const v = baseRating(h, world.year);
    if (!by.has(c)) by.set(c, []);
    by.get(c).push(v);
    // 新馬戦の相手：まだ走っていない 2 歳
    if ((h.starts ?? 0) === 0 && horseAge(h, world.year) === 2) {
      if (!by.has('m')) by.set('m', []);
      by.get('m').push(v);
    }
  }
  const q = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0.55);
  const bars = {};
  for (const arr of by.values()) arr.sort((a, b) => b - a);
  for (let c = 0; c <= 5; c++) {
    const arr = by.get(c) ?? by.get(1) ?? [];
    bars[c] = { bar: q(arr, 0.2), sd: Math.max(0.012, q(arr, 0.1) - q(arr, 0.5)) };
  }
  const op = by.get(5) ?? [];
  bars[6] = { bar: q(op, 0.3 * 0.2), sd: bars[5].sd };
  bars[7] = { bar: q(op, 0.15 * 0.2), sd: bars[5].sd };
  bars[8] = { bar: q(op, 0.06 * 0.2), sd: bars[5].sd };
  const m = by.get('m');
  bars.m = m && m.length >= 30 ? { bar: q(m, 0.2), sd: Math.max(0.012, q(m, 0.1) - q(m, 0.5)) } : bars[1];
  world._fieldBars = { key, bars };
  return world._fieldBars;
}

const MARKS = [[0.6, '◎', '勝ち負け'], [0.15, '○', '上位争い'], [-0.35, '△', '掲示板'], [-Infinity, '×', '厳しい']];

/**
 * 勝てる見込み。z は相手の強さとの差を分布の広さで割った値（0 で相手の上位 2 割と互角）。
 * 新馬戦は全馬が初出走なので、同じ世代の未出走の分布で見る（未勝利の分布だと叩いた馬が混ざる）。
 */
export function prospect(world, h, race, year = world.year) {
  const { bars } = fieldBars(world);
  const b = race.classId === 'maiden' ? bars.m : (bars[Math.min(8, classOrder(race.classId))] ?? bars[1]);
  const { apt } = aptMul(h, race);
  const z = (raceRating(h, race, year) - b.bar) / b.sd;
  const [, mark, label] = MARKS.find(([t]) => z >= t);
  return { z, mark, label, apt };
}

/** 週のずれから (年, 週)。 */
function weekAt(world, k) {
  let wk = world.week + k, yr = world.year;
  while (wk > WEEKS_PER_YEAR) { wk -= WEEKS_PER_YEAR; yr++; }
  return { year: yr, week: wk };
}

/** 前に走った週からの間隔（週）。走っていなければ大きな数。 */
function weeksSinceStart(world, h) {
  if (h.lastStartYear == null) return 99;
  return (world.year - h.lastStartYear) * WEEKS_PER_YEAR + (world.week - h.lastStartWeek);
}

/** オート出走登録の既定（間隔は前走から何週あけるか、見込みはどの印から登録するか）。 */
export const AUTO_ENTRY_DEFAULT = { gap: 5, min: '○' };
export const AUTO_ENTRY_GAPS = [3, 4, 5, 6, 8];
export const AUTO_ENTRY_MINS = ['◎', '○', '△'];
// '×' は年間プランの下書きで条件を緩めきったとき（見込みを問わない）
const MIN_Z = { '◎': 0.6, '○': 0.15, '△': -0.35, '×': -Infinity };

export function cleanAutoEntry(o) {
  if (!o) return null;
  const gap = AUTO_ENTRY_GAPS.includes(o.gap) ? o.gap : AUTO_ENTRY_DEFAULT.gap;
  const min = AUTO_ENTRY_MINS.includes(o.min) ? o.min : AUTO_ENTRY_DEFAULT.min;
  return { gap, min };
}

/**
 * 次に走るレースを選ぶ。前走から gap 週あけた週から 12 週先までで、見込みが min 以上のもの。
 * 点は 見込み z ＋ 賞金（対数）の少し ＋ 早いほど少し。海外（遠征費が掛かる）と、ほかの自分の馬が取ったレースは除く。
 * 見込みのあるレースが無いまま前走から 14 週たったら、いちばん見込みのあるレースに出す（ずっと休ませない）。
 * taken：登録済みのレース id（同じレースに自分の馬は 1 頭）。
 */
export function pickAutoRace(world, h, plan, taken, { from = 1, to = 12 } = {}) {
  const p = cleanAutoEntry(plan) ?? AUTO_ENTRY_DEFAULT;
  const since = weeksSinceStart(world, h);
  const tired = (h.fatigue ?? 0) > 0.5 ? 3 : 0;
  const start = Math.max(from, p.gap - since, tired);
  let best = null, fallback = null;
  for (let k = start; k <= to; k++) {
    const at = weekAt(world, k);
    for (const r of weekRaces(world, at.week, at.year)) {
      if (r.abroad || taken.has(r.raceId) || !eligible(r, h, at.year)) continue;
      const pr = prospect(world, h, r, at.year);
      if (pr.apt < 0.5) continue;
      const score = pr.z + Math.log10(1 + r.prize / 500) * 0.15 - k * 0.01;
      const pick = { race: r, ...at, k, prospect: pr, score };
      if (pr.z >= MIN_Z[p.min] && (!best || score > best.score)) best = pick;
      if (!fallback || score > fallback.score) fallback = pick;
    }
  }
  if (best) return best;
  return since + start >= 14 ? fallback : null;
}

/**
 * 1 年の出走プランを組む（年単位の登録）。gap 週ずつあけて、見込みのあるレースを先から順に選ぶ。
 * いまのクラスで出られるレースだけを並べる（勝ってクラスが上がると、その週に見直して外れる：落とし穴 65）。
 */
export function yearPlan(world, h, plan, taken = new Set()) {
  const p = { ...(cleanAutoEntry(plan) ?? AUTO_ENTRY_DEFAULT), ...(plan?.min === '×' ? { min: '×' } : {}) };
  const out = [];
  const used = new Set(taken);
  // 前走からの間隔は、最初の 1 走だけ見る（あとはプランの中の間隔）。
  let cursor = Math.max(1, p.gap - weeksSinceStart(world, h));
  while (cursor < WEEKS_PER_YEAR) {
    let best = null;
    for (let j = cursor; j < Math.min(WEEKS_PER_YEAR, cursor + 8); j++) {
      const at = weekAt(world, j);
      for (const r of weekRaces(world, at.week, at.year)) {
        if (r.abroad || used.has(r.raceId) || !eligible(r, h, at.year)) continue;
        const pr = prospect(world, h, r, at.year);
        if (pr.apt < 0.5 || pr.z < MIN_Z[p.min]) continue;
        const score = pr.z + Math.log10(1 + r.prize / 500) * 0.15 - (j - cursor) * 0.01;
        if (!best || score > best.score) best = { race: r, ...at, k: j, prospect: pr, score };
      }
    }
    if (!best) { cursor += 8; continue; }
    out.push(best);
    used.add(best.race.raceId);
    cursor = best.k + p.gap;
  }
  return out;
}
