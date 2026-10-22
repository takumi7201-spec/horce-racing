// 実在の馬を世界に入れる。
//
// 表（data/real-horses.js）の馬を、ゲームの開始年に合わせて少しずつ世界に出す。
//
//   開始年より前に生まれた馬   … 世界を作るときに作る（現役世代なら競走馬として）
//   輸入馬・名簿に入る母       … 供用年（繁殖年）になったら成馬のまま現れる
//   日本で生まれた名馬         … 史実の年の 4 月に、史実の父母から生まれる
//
// 日本で生まれる馬は、母が前の年に史実の父の仔を受胎したことにする（covering の後で
// お腹の仔を差し替える）。母がプレイヤーの繁殖牝馬で別の種牡馬を付けたとき、
// 父母のどちらかがこの世界に居ないときは、その馬は生まれない（歴史が変わった）。
// 生まれた馬は走るまで何者でもない。戦績は表ではなく、この世界のレースで決まる。
//
// 名簿（stallionPool / marePool）への出し入れは、プレイヤーの馬には手を出さない。
// 自分で持った実在の馬をいつ引退させ、何に付けるかはプレイヤーが決める。

import { REAL_HORSES } from './data/real-horses.js';
import { createHorse } from './horse.js';
import { breed } from './breeding.js';
import { SEX, ABILITIES, classForWins } from './params.js';
import { clamp01 } from '../core/util.js';

const STYLE_VALUE = { 逃: 0.1, 先: 0.32, 差: 0.62, 追: 0.86 };
const DEFS = new Map(REAL_HORSES.map((d) => [d.n, d]));
/** 現役で走る年齢の上限。これより上で開始年を迎えた馬は引退済みとして作る。 */
const RACING_AGE = 8;

/** 表の馬の出自。bg：血統をつなぐだけ ／ imp：輸入 ／ born：日本で生まれる ／ appear：成馬で現れる。 */
function originOf(d) {
  if (d.imp) return 'imp';
  if (d.bg) return 'bg';
  if (d.sire && d.dam) return 'born';
  return 'appear';
}

/** 名簿に入る年（種付けのシーズン）。母の mare は産駒の生年なので 1 年前になる。 */
function entryOf(d) {
  if (d.stud) return d.stud[0];
  if (d.mare) return d.mare[0] - 1;
  return null;
}

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

/** 表の素質・適性を馬に写す。戦績には触らない。 */
function applyTraits(h, d) {
  const female = d.s === '牝';
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
  h.real = true;
  if (d.head) h.lineHead = true;
}

/** 表の戦績を写す。big は upto 年より前の勝鞍だけ（まだ行われていないレースを並べない）。 */
function applyCareer(h, d, upto) {
  const female = d.s === '牝';
  // 戦績は表の概数。祖先は数字を持たないので「名の通った馬」として格を付ける
  // （インブリードの効き目は祖先の格で変わる。0 にすると実在の名馬のクロスが効かない）。
  h.starts = d.starts ?? 0;
  h.wins = d.wins ?? 0;
  // 2 着・3 着の数が分からない馬は 0 にしない（0 だと「勝つか着外か」の馬に見える）。
  if (d.rec) [, h.seconds, h.thirds] = d.rec;
  else if (h.starts > h.wins) h.placesUnknown = true;
  h.earnings = d.earn ?? (female ? 3000 : 20000);
  h.record = (d.big ?? []).filter(([year]) => year < upto).map(([year, raceName, grade]) => ({
    year, name: raceName, grade, order: 1, field: 16, past: 1,
  }));
  h.g1Wins = h.record.filter((r) => r.grade === 'GI').length;
  h.classId = classForWins(h.wins);
}

/** 実在の馬の状態（作った馬の id・名簿に入れ終えた馬）。セーブに載る。 */
function state(world) {
  world.real ??= { ids: {}, entered: [] };
  return world.real;
}

const madeHorse = (world, name) => {
  const id = world.real?.ids[name];
  return id != null ? world.horses.get(id) ?? null : null;
};

/**
 * 表の馬を 1 頭作る。親が居なければ親から作る。
 * 日本で生まれるはずの親（born）がこの世界でまだ生まれていなければ、その親は空欄にする。
 * live なら現役の競走馬として、そうでなければ引退した馬として作る。
 */
function make(world, rng, name, { year, live = false }) {
  const st = state(world);
  const have = madeHorse(world, name);
  if (have) return have;
  const d = DEFS.get(name);
  if (!d) throw new Error(`実在馬の表に ${name} が無い`);
  const parent = (pn) => {
    if (!pn) return null;
    const pd = DEFS.get(pn);
    if (!madeHorse(world, pn) && originOf(pd) === 'born' && pd.b >= world.startYear) return null;
    return make(world, rng, pn, { year });
  };
  const sire = parent(d.sire);
  const dam = parent(d.dam);
  const h = createHorse(rng, {
    name, sex: d.s === '牝' ? SEX.FEMALE : SEX.MALE, birthYear: d.b,
    sireId: sire?.id ?? null, damId: dam?.id ?? null,
  });
  applyTraits(h, d);
  if (live) {
    // 現役の馬は表の戦績を持ち込まない（この世界のレースで勝ち負けを決める）。
    // 開始年より前の勝鞍だけは事実として残す。
    h.record = (d.big ?? []).filter(([y]) => y < year).map(([y, raceName, grade]) => ({
      year: y, name: raceName, grade, order: 1, field: 16, past: 1,
    }));
    h.g1Wins = h.record.filter((r) => r.grade === 'GI').length;
    for (const a of ABILITIES) h.cur[a] = clamp01(h.pot[a] * 0.22);
    h.classId = 'maiden';
  } else {
    applyCareer(h, d, year);
    h.retired = true;
    h.stable = 'retired';
    // 種付料は史実の額から始める（2026 年は発表額、昔の馬は全盛期の目安）。
    // 名簿に入った年から毎年 4 分の 1 ずつ、この世界の産駒成績による値へ寄せる。
    if (d.stud) {
      h.realFee = d.fee ?? d.peak ?? null;
      h.realFeeFrom = Math.max(world.startYear, d.stud[0]);
    }
  }
  world.horses.set(h.id, h);
  world.nameSet.add(name);
  st.ids[name] = h.id;
  return h;
}

/**
 * 世界を作るときに、開始年より前に生まれた表の馬を作る。
 * 現役の年齢でまだ名簿に入っていない日本の馬は競走馬として作り、その一覧を返す
 * （紙の上の戦績は world.js の paperCareer で付ける）。
 * 輸入馬と成馬で現れる母は、名簿に入る年が来るまで作らない（作るのは親として要るときだけ）。
 * 表の名前はすべて予約する。でないと後で生まれる名馬の名前を架空の馬が先に使ってしまう。
 */
export function seedRealHorses(world, rng) {
  const S = world.startYear;
  state(world);
  for (const d of REAL_HORSES) world.nameSet.add(d.n);
  const live = [];
  for (const d of REAL_HORSES) {
    if (d.b >= S || madeHorse(world, d.n)) continue;
    const o = originOf(d);
    const entry = entryOf(d);
    const age = S - d.b;
    const racing = (o === 'born' || o === 'appear') && age <= RACING_AGE && (entry == null || entry > S);
    if (racing) {
      live.push(make(world, rng, d.n, { year: S, live: true }));
      continue;
    }
    if ((o === 'imp' || o === 'appear') && entry != null && entry > S) continue;
    make(world, rng, d.n, { year: S });
  }
  // 開始年までに名簿に入った馬は「入れ終えた」ことにする（ゲーム中の出し入れの対象外）。
  const st = state(world);
  for (const d of REAL_HORSES) {
    const e = entryOf(d);
    if (e != null && e <= S && madeHorse(world, d.n)) st.entered.push(d.n);
  }
  return live;
}

/**
 * その年に産駒を出す実在の繁殖牝馬を名簿（marePool）に載せ、繁殖を終えた馬を外す。
 * birthYear は産駒の生まれ年。表の mare も産駒の生年で持っている。世界を作る間だけ使う。
 */
export function syncRealMares(world, birthYear) {
  if (!world.real) return;
  const pool = new Set(world.marePool);
  for (const d of REAL_HORSES) {
    if (!d.mare) continue;
    const h = madeHorse(world, d.n);
    if (!h || !h.retired) continue;
    const [from, to] = d.mare;
    const breeding = from <= birthYear && (to == null || birthYear <= to)
      && (d.died == null || birthYear <= d.died);
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
 * 供用を終えた馬を外す。season は種付けの年（産駒が生まれるのは翌年）。世界を作る間だけ使う。
 */
export function syncRealStud(world, season) {
  if (!world.real) return;
  const pool = new Set(world.stallionPool);
  for (const d of REAL_HORSES) {
    if (!d.stud) continue;
    const h = madeHorse(world, d.n);
    if (!h || !h.retired) continue;
    const [from, to] = d.stud;
    const standing = from <= season && (to == null || season <= to);
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
  for (const d of REAL_HORSES) {
    const h = madeHorse(world, d.n);
    if (!h || !h.retired) continue;           // 現役の馬はこれから走る
    if (d.mare) {
      // 繁殖牝馬は没年が分かっていればそれで、分からなければ繁殖を終えて数年で区切る。
      h.dead = d.died != null ? d.died < year : year - h.birthYear > 26;
      h.broodmare = !h.dead && world.marePool.includes(h.id);
      continue;
    }
    if (d.stud) {
      // 没年の分からない種牡馬は 30 歳で区切る（グラスワンダーは 2026 年に 31 歳で存命）。
      h.dead = d.died != null ? d.died < year : year - h.birthYear > 31;
      if (h.dead) h.stallion = false;
    } else {
      // 祖先・母。表にあるのは昔の馬ばかりなので、繁殖を終えた年齢なら亡くなったものとする。
      h.dead = year - h.birthYear > (h.sex === SEX.FEMALE ? 22 : 25);
      h.stallion = false;
    }
    // 名簿に入らない母（海外の牝馬など）は、名前を血統表に載せるためだけの馬。
    if (h.sex === SEX.FEMALE) h.broodmare = false;
  }
  world.stallionPool = world.stallionPool.filter((id) => !world.horses.get(id)?.dead);
  world.marePool = world.marePool.filter((id) => !world.horses.get(id)?.dead);
}

// ---------------------------------------------------------------- ゲーム中の史実

/** 現役の実在馬を引退させる（名簿に入れるため）。持ち主の一覧からも外す。 */
function retireForStud(world, h) {
  h.retired = true;
  h.stable = 'retired';
  h.retiredYear = world.year;
  const o = world.owners.get(h.ownerId);
  if (o) o.horses = o.horses.filter((x) => x !== h.id);
}

const removeFrom = (arr, id) => {
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1);
};

/**
 * 年明けの史実。輸入馬の到着、実在の馬の種牡馬入り・繁殖入り、供用の終わりと死。
 * year はその年（種付けのシーズン）。news に出来事を積む。
 */
export function realNewYear(world, rng, year, news = []) {
  if (!world.real) return news;
  const st = state(world);
  const entered = new Set(st.entered);
  for (const d of REAL_HORSES) {
    const isStud = !!d.stud;
    if (!isStud && !d.mare) continue;
    // 繁殖牝馬の年は産駒の生年で持っているので、今年の種付けは year + 1 の年で見る。
    const [from, to] = isStud ? d.stud : d.mare;
    const t = isStud ? year : year + 1;
    let h = madeHorse(world, d.n);
    const o = originOf(d);
    const over = (to != null && t > to) || (d.died != null && year > d.died);
    // 輸入馬と成馬で現れる母は、名簿に入る年に作る。
    if (!h && o !== 'born' && from <= t && !over && !entered.has(d.n)) {
      h = make(world, rng, d.n, { year });
      if (o === 'imp') news.push(`${d.n} が${isStud ? '種牡馬' : '繁殖牝馬'}として輸入された。`);
    }
    if (!h || h.dead || h.ownerId === 'player') continue;
    if (t < from) continue;
    const pool = isStud ? world.stallionPool : world.marePool;
    if (over) {
      if (isStud ? h.stallion : h.broodmare) {
        if (isStud) h.stallion = false; else h.broodmare = false;
        removeFrom(pool, h.id);
      }
      // 没年を過ぎた引退馬は亡くなる。走っている馬は史実より長生きしてよい。
      if (d.died != null && year > d.died && h.retired) h.dead = true;
      continue;
    }
    if (entered.has(d.n)) continue;
    entered.add(d.n);
    st.entered.push(d.n);
    const racing = !h.retired;
    if (racing) retireForStud(world, h);
    if (isStud) h.stallion = true; else h.broodmare = true;
    if (!pool.includes(h.id)) {
      pool.push(h.id);
      if (racing) news.push(`${h.name} が引退し、${isStud ? '種牡馬' : '繁殖牝馬'}になった。`);
    }
  }
  return news;
}

/**
 * 種付けシーズンの締めの後、来年生まれる史実の名馬のお腹の仔を決める。
 * birthYear は産駒の生まれ年。父母がこの世界に居て、母がほかの牧場の馬なら
 * 史実どおりに受胎させる。母がプレイヤーの馬なら、プレイヤーが同じ父を付けたときだけ。
 */
export function realCoverings(world, rng, birthYear) {
  if (!world.real) return [];
  const out = [];
  for (const d of REAL_HORSES) {
    if (d.b !== birthYear || originOf(d) !== 'born' || madeHorse(world, d.n)) continue;
    const get = (pn) => {
      const have = madeHorse(world, pn);
      if (have) return have;
      // 日本で生まれるはずの親がまだ居ない＝この世界ではその親が生まれなかった。
      if (originOf(DEFS.get(pn)) === 'born') return null;
      return make(world, rng, pn, { year: world.year });
    };
    const sire = get(d.sire);
    const dam = get(d.dam);
    if (!sire || !dam || sire.dead || dam.dead) continue;
    if (dam.ownerId === 'player') {
      if (dam.pregnancy?.sireId === sire.id && dam.pregnancy.year === birthYear) dam.pregnancy.real = d.n;
      continue;
    }
    // まだ走っている母は繁殖に上げる（史実ではもう引退している）。
    if (!dam.retired) {
      retireForStud(world, dam);
      dam.broodmare = true;
      if (!world.marePool.includes(dam.id)) world.marePool.push(dam.id);
    }
    dam.pregnancy = { sireId: sire.id, year: birthYear, real: d.n };
    out.push(d.n);
  }
  return out;
}

/**
 * 史実の名馬の誕生。交配そのもの（インブリード・ニックス・産駒の記録）は breed に任せ、
 * 素質と適性だけを表の値にする。名前は 1 歳の年末に史実の名で登録する。
 */
export function bornReal(world, rng, name, sire, dam, opts) {
  const d = DEFS.get(name);
  const foal = breed(world, rng, sire, dam, opts);
  world.nameSet.delete(foal.name);
  foal.sex = d.s === '牝' ? SEX.FEMALE : SEX.MALE;
  applyTraits(foal, d);
  for (const a of ABILITIES) foal.cur[a] = clamp01(foal.pot[a] * rng.range(0.16, 0.26));
  foal.name = name;
  world.nameSet.add(name);
  state(world).ids[name] = foal.id;
  return foal;
}

/** 史実の名で登録される予定の馬か（セールで「史実」と分かるように）。 */
export const realNameOf = (h) => (h.real ? h.regName ?? h.name : null);
