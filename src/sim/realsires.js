// 実在の種牡馬を世界に入れる。
//
// 表（data/real-horses.js）の馬を、祖先から順に馬として作る。
// 種牡馬は日本で供用された年だけ名簿（stallionPool）に載せるので、
// 紙の上で世代を重ねる間に架空の繁殖牝馬へ実在の血が自然に入っていく。
// ゲームが始まってからは、ほかの種牡馬と同じ規則で年を取り、種付料が動く。

import { REAL_HORSES } from './data/real-horses.js';
import { createHorse } from './horse.js';
import { SEX, ABILITIES, classForWins } from './params.js';
import { clamp01 } from '../core/util.js';

const STYLE_VALUE = { 逃: 0.1, 先: 0.32, 差: 0.62, 追: 0.86 };

/**
 * 能力の配分。格（lvl）を中心に、距離と馬場で得意を振り分ける。
 * 短距離馬はスピード、長距離馬はスタミナ、ダート馬はパワーに寄る。
 */
function potentials(lvl, dist, surf) {
  const sprint = dist <= 1400;
  const stay = dist >= 2400;
  return {
    speed: lvl + (sprint ? 0.05 : stay ? -0.03 : 0.01),
    stamina: lvl + (sprint ? -0.12 : stay ? 0.05 : dist <= 1800 ? -0.04 : 0),
    power: lvl + (surf === 'D' ? 0.05 : 0),
    guts: lvl + 0.02,
    wit: lvl - 0.02,
  };
}

/**
 * 表の馬をすべて作り、世界に登録する。名前は架空の馬に使われないよう予約する。
 * 供用年の名簿は world.realStud に持ち、syncRealStud が毎年の出し入れをする。
 */
export function seedRealHorses(world, rng) {
  const defs = new Map(REAL_HORSES.map((d) => [d.n, d]));
  const made = new Map();
  // 表は祖先が先に並んでいるとは限らないので、親を名前で引きながら作る。
  const make = (name) => {
    if (!name) return null;
    if (made.has(name)) return made.get(name);
    const d = defs.get(name);
    if (!d) throw new Error(`実在馬の表に ${name} が無い`);
    const sire = make(d.sire);
    const dam = make(d.dam);
    const female = d.s === '牝';
    const h = createHorse(rng, {
      name, sex: female ? SEX.FEMALE : SEX.MALE, birthYear: d.b,
      sireId: sire?.id ?? null, damId: dam?.id ?? null,
    });
    const sireData = d.stud != null;
    const lvl = d.lvl ?? (female ? 0.62 : 0.8);
    const dist = d.dist ?? 2000;
    const surf = d.surf ?? 'T';
    const pot = potentials(lvl, dist, surf);
    for (const a of ABILITIES) {
      h.pot[a] = clamp01(pot[a]);
      h.cur[a] = h.pot[a];
    }
    h.coat = d.c ?? '鹿毛';
    h.growth = d.growth ?? '普通';
    h.dist = dist;
    h.distRange = d.range ?? 500;
    h.turf = surf === 'D' ? 0.45 : surf === 'TD' ? 0.78 : 0.9;
    h.dirt = surf === 'T' ? 0.45 : surf === 'TD' ? 0.78 : 0.9;
    h.firm = 0.86;
    h.soft = d.soft ?? 0.6;
    h.style = STYLE_VALUE[d.style] ?? 0.45;
    h.styleFlex = 0.55;
    h.temper = d.temper ?? 0.6;
    h.sound = 0.7;
    h.spirit = clamp01(0.6 + (lvl - 0.7) * 1.2);
    h.weightKg = female ? 470 : 500;
    // 戦績は表の概数。祖先は数字を持たないので「名の通った馬」として格を付ける
    // （インブリードの効き目は祖先の格で変わる。0 にすると実在の名馬のクロスが効かない）。
    h.starts = d.starts ?? 0;
    h.wins = d.wins ?? 0;
    // 2 着・3 着の数が分からない馬は 0 にしない（0 だと「勝つか着外か」の馬に見える）。
    if (d.rec) [, h.seconds, h.thirds] = d.rec;
    else if (h.starts > h.wins) h.placesUnknown = true;
    h.earnings = d.earn ?? (female ? 3000 : 20000);
    h.record = (d.big ?? []).map(([year, raceName, grade]) => ({
      year, name: raceName, grade, order: 1, field: 16, past: 1,
    }));
    h.g1Wins = h.record.filter((r) => r.grade === 'GI').length;
    h.classId = classForWins(h.wins);
    h.retired = true;
    h.stable = 'retired';
    h.real = true;
    if (d.head) h.lineHead = true;
    if (sireData) h.realFee = d.fee ?? d.peak ?? null;
    world.horses.set(h.id, h);
    world.nameSet.add(name);
    made.set(name, h);
    return h;
  };
  for (const d of REAL_HORSES) make(d.n);

  world.realStud = REAL_HORSES.filter((d) => d.stud).map((d) => ({
    id: made.get(d.n).id, from: d.stud[0], to: d.stud[1], died: d.died ?? null,
  }));
  world.realMares = REAL_HORSES.filter((d) => d.mare).map((d) => ({
    id: made.get(d.n).id, from: d.mare[0], to: d.mare[1], died: d.died ?? null,
  }));
  return made;
}

/**
 * その年に産駒を出す実在の繁殖牝馬を名簿（marePool）に載せ、繁殖を終えた馬を外す。
 * birthYear は産駒の生まれ年。表の mare も産駒の生年で持っている。
 */
export function syncRealMares(world, birthYear) {
  if (!world.realMares) return;
  const pool = new Set(world.marePool);
  for (const r of world.realMares) {
    const h = world.horses.get(r.id);
    if (!h) continue;
    const breeding = r.from <= birthYear && (r.to == null || birthYear <= r.to)
      && (r.died == null || birthYear <= r.died);
    h.broodmare = breeding;
    if (breeding && !pool.has(h.id)) {
      world.marePool.push(h.id);
      pool.add(h.id);
    } else if (!breeding && pool.has(h.id)) {
      world.marePool = world.marePool.filter((id) => id !== h.id);
      pool.delete(h.id);
    }
  }
}

/**
 * その年の種付けシーズンに供用されている実在の種牡馬を名簿に載せ、
 * 供用を終えた馬を外す。season は種付けの年（産駒が生まれるのは翌年）。
 */
export function syncRealStud(world, season) {
  if (!world.realStud) return;
  const pool = new Set(world.stallionPool);
  for (const r of world.realStud) {
    const h = world.horses.get(r.id);
    if (!h) continue;
    const standing = r.from <= season && (r.to == null || season <= r.to);
    // 名簿の整理（MAX_STALLIONS）で外されても、実際に供用されていた年は戻す。
    h.stallion = standing;
    if (standing && !pool.has(h.id)) {
      world.stallionPool.push(h.id);
      pool.add(h.id);
    } else if (!standing && pool.has(h.id)) {
      world.stallionPool = world.stallionPool.filter((id) => id !== h.id);
      pool.delete(h.id);
    }
  }
}

/**
 * 生成の最後に、実在の馬の生死を開始年に合わせる。
 * 没年の分かっている馬はその年で、祖先と母は年齢で区切る。
 * 引退して存命の種牡馬（ダイワメジャーなど）は名簿から外れたまま生かしておく。
 */
export function settleRealHorses(world, year) {
  const stud = new Map((world.realStud ?? []).map((r) => [r.id, r]));
  const mares = new Map((world.realMares ?? []).map((r) => [r.id, r]));
  for (const h of world.horses.values()) {
    if (!h.real) continue;
    const r = stud.get(h.id);
    const m = mares.get(h.id);
    if (m) {
      // 繁殖牝馬は没年が分かっていればそれで、分からなければ繁殖を終えて数年で区切る。
      h.dead = m.died != null ? m.died < year : year - h.birthYear > 26;
      h.broodmare = !h.dead && world.marePool.includes(h.id);
      continue;
    }
    if (r) {
      h.dead = r.died != null && r.died < year;
      if (r.to != null) h.stallion = false;
    } else {
      // 祖先・母。表にあるのは昔の馬ばかりなので、繁殖を終えた年齢なら亡くなったものとする。
      h.dead = year - h.birthYear > (h.sex === SEX.FEMALE ? 22 : 25);
      h.stallion = false;
    }
    // 名簿に入らない母（海外の牝馬など）は、名前を血統表に載せるためだけの馬。
    if (h.sex === SEX.FEMALE) h.broodmare = false;
  }
}
