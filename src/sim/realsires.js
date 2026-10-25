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
import { createHorse, resetHorseIds, peekHorseId } from './horse.js';
import { makeRng } from '../core/rng.js';
import { breed } from './breeding.js';
import { SEX, ABILITIES, classForWins } from './params.js';
import { clamp01 } from '../core/util.js';

const STYLE_VALUE = { 逃: 0.1, 先: 0.32, 差: 0.62, 追: 0.86 };
const DEFS = new Map(REAL_HORSES.map((d) => [d.n, d]));
const ABROAD_DEFS = REAL_HORSES.filter((d) => d.abroad);
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
 * 因子を戦績から決める（表に f が無い馬）。GI を勝つような名馬だけが持つ。
 * 短距離ならスピード、長距離ならスタミナ、ダートならパワー、差し・追込なら瞬発。
 */
function deriveFactors(d) {
  const g1 = (d.big ?? []).filter((x) => x[2] === 'GI').length;
  const lvl = d.lvl ?? 0;
  const n = lvl >= 0.88 || g1 >= 5 ? 2 : lvl >= 0.82 || g1 >= 2 ? 1 : 0;
  if (!n) return null;
  const dist = d.dist ?? 2000;
  const starts = d.starts ?? 0;
  const score = {
    speed: dist <= 1600 ? 3 : dist <= 2000 ? 1.5 : 0.5,
    stamina: dist >= 3000 ? 3 : dist >= 2400 ? 2.2 : 0.4,
    power: d.surf === 'D' ? 2.6 : d.surf === 'TD' ? 1.6 : 0.2,
    burst: d.style === '追' ? 2.4 : d.style === '差' ? 1.8 : 0.3,
    guts: d.style === '逃' ? 2 : starts >= 25 ? 1.4 : 0.6,
    health: starts >= 35 ? 1.9 : 0,
    mind: 0.5,
  };
  return Object.entries(score).sort((a, b) => b[1] - a[1]).slice(0, n).map(([f]) => f);
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
  // 史実馬の一覧の能力（d.ab）があれば、スピード・パワー・根性・賢さはその値のまま使う。
  // スタミナは一覧に対応する値が無い（距離適性の隠し値）ので、距離から導いた値のまま。
  if (d.ab) Object.assign(pot, { speed: lvl, power: d.ab.power, guts: d.ab.guts, wit: d.ab.wit });
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
  h.sound = d.sound ?? 0.7;
  h.spirit = d.spirit ?? clamp01(0.6 + (lvl - 0.7) * 1.2);
  h.weightKg = female ? 470 : 500;
  h.real = true;
  if (d.head) h.lineHead = true;
  const f = d.f ?? deriveFactors(d);
  if (f?.length) h.factors = [...f];
  if (d.os || d.abroad) h.foreign = true;
  // 表の供用年を導いた馬（取り込んだ勝ち馬）。名簿の整理では架空の馬と同じ扱いにする。
  if (d.sd) h.studDerived = true;
  if (d.fert != null) h.fert = d.fert;
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
 * 古いセーブで、実在馬の父母がつながっていない馬を、今の表の血統でつなぎ直す。
 * セーブは世界の馬そのものを保存するので、表の血統を足したあとも、昔のセーブのミスタープロスペクターなどは
 * 父母の無いまま読み込まれ、血統表が真っ白に見える。世界を作り直さずに済ませるため、ロードのたびに
 * 「表には父母がいるのに、世界の馬には無い」実在馬だけを結ぶ（結び終えた世界では何もしない）。
 * 世界に居ない親は作る（表の馬を作るのと同じ make。亡くなっているかは年で決める）。
 * 乱数は世界の主乱数に触らない（ロード後の 1 週が保存前と同じ結果になるように、別の乱数を使う）。
 */
export function healRealPedigrees(world) {
  if (!world.real) return 0;
  const year = world.year;
  const rng = makeRng(((year * 53 + world.week) ^ 0x5bd1e995) >>> 0);
  let linked = 0;
  for (const d of REAL_HORSES) {
    const h = madeHorse(world, d.n);
    if (!h) continue;
    for (const role of ['sire', 'dam']) {
      const key = role === 'sire' ? 'sireId' : 'damId';
      if (h[key] != null || !d[role]) continue;
      const pd = DEFS.get(d[role]);
      if (!pd || pd.b > h.birthYear - 2) continue;
      let p = madeHorse(world, d[role]);
      if (!p) {
        const before = new Set(Object.keys(world.real.ids));
        p = make(world, rng, d[role], { year });
        for (const [name, id] of Object.entries(world.real.ids)) {
          if (before.has(name)) continue;
          const nh = world.horses.get(id), nd = DEFS.get(name);
          if (!nh || !nd) continue;
          nh.dead = nd.died != null ? nd.died < year : year - nh.birthYear > (nh.sex === SEX.FEMALE ? 22 : 25);
          nh.stallion = false;
          nh.broodmare = false;
        }
      }
      h[key] = p.id;
      p.foals ??= [];
      if (!p.foals.includes(h.id)) p.foals.push(h.id);
      linked++;
    }
  }
  return linked;
}

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
    // 仮の世界（名鑑から見るだけ）では、まだ生まれていない親も表のとおりに作る。
    if (!world._preview && !madeHorse(world, pn) && originOf(pd) === 'born' && pd.b >= world.startYear) return null;
    return make(world, rng, pn, { year });
  };
  const sire = parent(d.sire);
  const dam = parent(d.dam);
  const h = createHorse(rng, {
    name, sex: d.s === '牝' ? SEX.FEMALE : SEX.MALE, birthYear: d.b,
    sireId: sire?.id ?? null, damId: dam?.id ?? null,
  });
  applyTraits(h, d);
  // 血統をつなぐだけの祖先（競走馬としての能力を持たない）は、血統表から遠くなったら世界から捨てる（pruneAncestry）。
  if (originOf(d) === 'bg' && d.lvl == null && !d.mare) h.pedOnly = true;
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
    // 海外の種牡馬は向こうの相場で種付けする（日本の名簿には入れない）。
    if (d.abroad) h.abroadFee = d.afee;
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
    const racing = (o === 'born' || o === 'appear') && age <= RACING_AGE && (entry == null || entry > S)
      && !(d.died != null && d.died < S);
    // 海外の名馬は、まだ海外で種牡馬になっていない若駒なら作らない（1 歳ならセールに出る）。
    // 親として要るときだけ make が作る。
    // 1 歳以下は海外セールに出る（買うまで世界に作らない。落とし穴 33・42）。2 歳以上の海外馬は世界に居る
    // （海外で走っている馬。日本のレースには出ず、「海外で現役」と名鑑に出る）。名牝（amare）の若い馬は海外セールの繁殖牝馬。
    if (d.os) {
      if (d.abroad) { if (d.abroad[0] > S) continue; }
      else if (age <= 1 || (d.amare && age <= RACING_AGE)) continue;
    }
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
      // 祖先・母。没年が分かればそれで、分からなければ繁殖を終えた年齢で亡くなったものとする。
      h.dead = d.died != null ? d.died < year : year - h.birthYear > (h.sex === SEX.FEMALE ? 22 : 25);
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
  // 海外の種牡馬。供用が始まる年に（海外で）作り、没年を過ぎたら亡くなる。
  for (const d of ABROAD_DEFS) {
    const [from, to] = d.abroad;
    let h = madeHorse(world, d.n);
    const standing = from <= year && (to == null || year <= to) && (d.died == null || year <= d.died);
    if (!h && standing) h = make(world, rng, d.n, { year });
    if (h && !h.dead && h.retired && h.ownerId !== 'player' && d.died != null && year > d.died) h.dead = true;
  }
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
    // 史実の年に生まれた馬と、現役で始まった馬は make() を通らず、種付料の基準が付いていない。
    // 名簿に入る年の相場から始めて、毎年 4 分の 1 ずつこの世界の値へ寄せる（落とし穴 37）。
    if (isStud && h.realFee == null && (d.fee ?? d.peak) != null) {
      h.realFee = d.fee ?? d.peak;
      h.realFeeFrom = Math.max(world.startYear, from);
    }
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

/** その年に海外で供用されている種牡馬（プレイヤーだけが種付けできる）。 */
export function abroadSires(world, year = world.year) {
  if (!world.real) return [];
  const out = [];
  for (const d of ABROAD_DEFS) {
    const h = madeHorse(world, d.n);
    if (!h || h.dead || !h.retired || h.ownerId === 'player') continue;
    const [from, to] = d.abroad;
    if (from <= year && (to == null || year <= to)) out.push(h);
  }
  return out;
}

/**
 * 海外トレーニングセールに出る史実の 1 歳馬（のちのフランケルなど）。
 * 海外の名馬と輸入される前の種牡馬（サンデーサイレンスなど）で、去年生まれてまだ世界に居ない馬。
 * 母が表に無い馬は出さない（「不明の 2008」のような上場名になる）。
 */
export function realYearlings(world) {
  if (!world.real) return [];
  return REAL_HORSES
    .filter((d) => (d.os || d.imp) && d.lvl != null && d.sire && d.dam && d.b === world.year - 1 && !madeHorse(world, d.n))
    .map((d) => ({ def: d, damSire: d.dam ? DEFS.get(d.dam)?.sire ?? null : null }));
}

/** 史実の 1 歳馬を買う。日本で走る競走馬として作り、名前は年末に史実の名で登録する。 */
export function buyRealYearling(world, rng, name, key) {
  const h = make(world, rng, name, { year: world.year, live: true });
  h.ownerId = 'player';
  h.lotKey = key;
  h.regName = name;
  h.name = `${world.horses.get(h.damId)?.name ?? '不明'}の${h.birthYear}`;
  h.stable = 'pasture';
  h.trainingMenu = 'light';
  world.owners.get('player')?.horses.push(h.id);
  return h;
}

/**
 * 海外トレーニングセールに出る海外の名牝（ゼニヤッタ・エネイブルなど）。
 * 海外で繁殖に上がっている年（amare）で、21 歳以上と亡くなった馬は出さない。
 * 表にある史実の仔がまだ生まれていない名牝も出さない。買うと、ガリレオやフランケルが
 * 「日本にいるプレイヤーの牝馬の仔」として海外で生まれることになり、歴史が二重になる。
 */
export function realMareLots(world) {
  if (!world.real) return [];
  const y = world.year;
  return REAL_HORSES.filter((d) => {
    if (!d.amare || d.lvl == null) return false;
    const [from, to] = d.amare;
    if (from > y + 1 || (to != null && y + 1 > to)) return false;
    if ((d.died != null && d.died <= y) || y - d.b > 20) return false;
    if (REAL_HORSES.some((c) => c.dam === d.n && c.b > y)) return false;
    const h = madeHorse(world, d.n);
    return !(h && (h.dead || h.ownerId != null));
  }).map((d) => ({
    def: d,
    damSire: d.dam ? DEFS.get(d.dam)?.sire ?? null : null,
    // 表にある史実の仔（値段と「○○の母」の表示に使う）。
    kids: REAL_HORSES.filter((c) => c.dam === d.n),
  }));
}

/** 海外の名牝を買う。日本の繁殖牝馬の名簿に入り、プレイヤーの牝馬として配合できる。 */
export function buyRealMare(world, rng, name, key) {
  const h = madeHorse(world, name) ?? make(world, rng, name, { year: world.year });
  h.ownerId = 'player';
  h.lotKey = key;
  h.retired = true;
  h.stable = 'retired';
  h.broodmare = true;
  if (!world.marePool.includes(h.id)) world.marePool.push(h.id);
  world.player.broodmares.push(h.id);
  world.owners.get('player')?.horses.push(h.id);
  return h;
}

/** 名鑑に載せる年代の区切り。1960 年代より前は一つにまとめる（祖先ばかりで数が少ない）。 */
export const decadeOf = (b) => (b < 1970 ? 1960 : Math.floor(b / 10) * 10);

/**
 * 史実馬名鑑。表の馬のうち名の通った馬（戦績・供用年・格のある馬）を、この世界での今の姿と並べる。
 * 血統をつなぐためだけの母や祖先は載せない。
 * status.key は future（これから生まれる・来る）/ here（この世界に居る）/ dead / lost（生まれなかった）/ none。
 */
/** 名鑑の「いま」。 */
function statusOf(world, d, h, o = originOf(d)) {
  const y = world.year;
  let status;
  if (!h) {
    const e = entryOf(d);
    if (d.b >= y) status = { key: 'future', text: `${d.b}年に誕生` };
    else if (d.abroad && d.abroad[0] > y) status = { key: 'future', text: `${d.abroad[0]}年から海外で供用` };
    else if ((o === 'imp' || o === 'appear') && e != null && e > y) {
      status = { key: 'future', text: `${e}年に${d.stud ? '種牡馬入り' : '繁殖入り'}` };
    } else if (o === 'born' && d.b >= world.startYear) status = { key: 'lost', text: 'この世界では生まれなかった' };
    else if (d.amare && d.amare[0] <= y + 1 && (d.amare[1] == null || y + 1 <= d.amare[1])
      && (d.died == null || d.died > y)) status = { key: 'abroad', text: '海外で繁殖牝馬' };
    else if (d.os && y - d.b <= 5) status = { key: 'abroad', text: y - d.b < 2 ? '海外の幼駒' : '海外で現役' };
    else status = { key: 'none', text: '—' };
  } else if (h.dead) status = { key: 'dead', text: '故馬' };
  else if (h.abroadFee && h.retired && h.ownerId !== 'player') status = { key: 'here', text: '海外で供用中' };
  else if (h.stallion) status = { key: 'here', text: `種牡馬 ${h.studFee ?? 0}万` };
  else if (h.broodmare) status = { key: 'here', text: '繁殖牝馬' };
  else if (d.os && h.retired && !d.abroad && !d.imp && y - h.birthYear <= RACING_AGE) {
    status = { key: 'here', text: y - h.birthYear < 2 ? '海外の幼駒' : '海外で現役' };
  }
  else if (!h.retired) {
    const age = y - h.birthYear;
    status = { key: 'here', text: age < 2 ? `幼駒（${age}歳）` : `現役 ${age}歳` };
  } else status = { key: 'here', text: '引退' };
  return status;
}

const realBook1 = (world, d) => statusOf(world, d, madeHorse(world, d.n));

export function realBook(world) {
  if (!world.real) return [];
  const y = world.year;
  const out = [];
  for (const d of REAL_HORSES) {
    if (d.lvl == null && !d.big?.length && !d.stud && !d.mare && !d.abroad && !d.amare) continue;
    const o = originOf(d);
    const h = madeHorse(world, d.n);
    const female = d.s === '牝';
    const role = d.stud || d.abroad ? '種牡馬' : d.mare || d.amare ? '繁殖牝馬' : '競走馬';
    const where = d.imp ? '輸入' : d.os || d.abroad || d.amare ? '海外' : '日本';
    const status = statusOf(world, d, h, o);
    const big = d.big ?? [];
    out.push({
      name: d.n, birthYear: d.b, sex: female ? '牝' : '牡', coat: d.c ?? '鹿毛',
      sire: d.sire ?? '—', dam: d.dam ?? '—', role, where,
      decade: decadeOf(d.b),
      bigWins: big.map(([yr, race]) => `${yr} ${race}`),
      g1: big.filter((x) => x[2] === 'GI').length,
      id: h?.id ?? null,
      // 世界に居ない馬（海外の若駒・これから生まれる馬など）の詳細は、表の値をそのまま見せる。
      traits: d.lvl == null ? null : {
        lvl: d.lvl, ab: d.ab ?? null, sound: d.sound ?? null, spirit: d.spirit ?? null,
        surf: d.surf ?? null, dist: d.dist ?? null, range: d.range ?? null, style: d.style ?? null, growth: d.growth ?? null,
      },
      mine: h?.ownerId === 'player',
      // この世界で走った成績（史実の数字ではなく、ゲームの中で積み上げたもの）。
      world: h && h.birthYear >= world.startYear - 1 && h.starts > 0
        ? { starts: h.starts, wins: h.wins, g1: h.g1Wins ?? 0 } : null,
      status,
    });
  }
  return out;
}

/** 名鑑から開く「世界に居ない馬」の仮の id。世界の馬の id と重ならない帯に置く。 */
export const PREVIEW_ID_BASE = 1e9;

/**
 * 世界に居ない実在馬（これから生まれる・この世界では生まれなかった・海外の若駒）を、馬の詳細で見せるための仮の世界。
 * 名鑑の行を押しても表の値のモーダルしか出なかったので、世界の馬と同じ詳細画面（血統表・能力・成績）で見せたい。
 * 世界そのものには何も足さない：馬の索引は世界の上に重ねた別の Map、実在馬の状態も写し、
 * 馬の id は別の帯（PREVIEW_ID_BASE〜）で採ってから採番を元に戻す（セーブとロード後の 1 週を変えない。落とし穴 14・47）。
 * 乱数も世界の主乱数に触らない。
 */
export function realPreview(world, name) {
  const d = DEFS.get(name);
  if (!d || !world.real) return null;
  const have = madeHorse(world, name);
  if (have) return { world, id: have.id };
  const base = world.horses;
  const own = new Map();
  const horses = new Map();
  horses.get = (id) => own.get(id) ?? base.get(id);
  horses.has = (id) => own.has(id) || base.has(id);
  horses.set = (id, h) => own.set(id, h);
  const shadow = Object.create(world);
  Object.assign(shadow, {
    horses, nameSet: new Set(),
    real: { ids: { ...world.real.ids }, entered: [] },
    _lineMemo: null, _strongMemo: null, _lineShare: null, _raceCache: null, _preview: true,
  });
  let seed = 7;
  for (const c of name) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  const saved = peekHorseId();
  resetHorseIds(PREVIEW_ID_BASE);
  let h;
  try {
    // 戦績は史実のすべてを見せる（世界の年で切ると、これから生まれる馬は勝鞍が空になる）。
    h = make(shadow, makeRng(seed), name, { year: 9999 });
  } finally {
    resetHorseIds(saved);
  }
  const st = realBook1(world, d);
  h.preview = st.text;
  if (d.died != null) h.dead = d.died < world.year;
  if (d.b >= world.year) h.dead = false;
  return { world: shadow, id: h.id };
}

/** 史実の名で登録される予定の馬か（セールで「史実」と分かるように）。 */
export const realNameOf = (h) => (h.real ? h.regName ?? h.name : null);
