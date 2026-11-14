// 配合理論。
//
// 配合には、血統の見立てで「成り立つ組み合わせ」がある。成り立った理論は 爆発力（仔のスピードを
// 底上げする大きさ）と、サブパラ（スタミナ・パワー・勝負根性・賢さ・精神力・健康・柔軟性）の上昇、
// それに危険度（体質や気性が悪くなる確率）を持つ。配合の評価画面に理論の名前で出る。
//
// 成立条件と数値の骨格は「ウイニングポスト 10 2026 攻略」（ahogame.netgamers.jp/wp102026/haigou.html）の
// 配合理論のページに合わせた。ただしこのゲームに無い仕組み（ウマソナ・関係性・ドラマ因子・活力・イベント・
// 牝系・ライバル・繋養地域）に依るものは持たない。また能力の尺度が違うので、爆発力の 1 点の大きさ
// （BURST_STEP）は独自に決めた。
//
// 持っている理論：
//   インブリード／奇跡の血量（3×4）・母系インブリード・全きょうだいインブリード・アウトブリード
//   ラインブリード（親系統・子系統・SP 型・爆発型 3 本／4 本）・1/4 異系配合・血脈活性化配合（6〜8 本）
//   ニックス（シングル〜フォース・2〜4 次）・母父○／◎・活力源化因子・隔世遺伝
//   メールライン活性配合・ボトムライン活性配合・系統特性昇華（SP／ST／なし）・系統特性融合
//   お笑い・お似合い・サヨナラ・Ｗサヨナラ・稲妻（真）・疾風（真）・3 冠配合・お披露目・そっくりさん
//   基準交配・始祖血脈融合配合
//
// 乱数は使わない（評価画面を開くだけで乱数が進まないように）。爆発力の目の抽選は breed() が行う。
// 配合の上乗せは平均がゼロになるように入れる（落とし穴 41）。

import { sireLineRoot, inbreedings, collectAncestors, breedQuality, nicksKey, FACTORS } from './pedigree.js';
import { ABILITIES } from './params.js';

/** 爆発力 1 点あたりのスピード潜在値の上げ幅。仔の抽選は 0〜(爆発力−1)。 */
export const BURST_STEP = 0.0035;
/** 爆発力に応じて、ほかの能力へ配る割合（スピードを 1 として）。 */
export const BURST_SPREAD = { speed: 1, stamina: 0.5, power: 0.5, guts: 0.5, wit: 0.3 };
/**
 * 理論の平均的な上乗せ（能力ごと）。全配合から引いて、世界全体の水準を動かさない（落とし穴 41）。
 * 旧来の近交・ニックスの後押し（平均 0.01 前後）を理論に置き換えたので、同じ平均になるように合わせた。
 */
const BASE_LEVEL = -0.0056;
export const THEORY_BASE = Object.fromEntries(ABILITIES.map((a) => [a, BASE_LEVEL * (BURST_SPREAD[a] ?? 0.4)]));
/** 爆発力の上限。重ねても、これ以上は効かない。 */
export const BURST_CAP = 45;
/** 危険度の上限（サイトの表記と同じ 0〜7）。 */
export const RISK_CAP = 7;
/** サブパラ上昇の 1 段（小）の大きさ。 */
const SUB = 0.008;

const FACTOR_ABILITY = ['speed', 'stamina', 'power', 'burst', 'guts'];
const GOOD_NICK = 0.3;      // ○ 以上でニックス成立

const ABILITY_LABEL_JA = { speed: 'スピード', stamina: 'スタミナ', power: 'パワー', guts: '勝負根性', wit: '賢さ' };

// ---------------------------------------------------------------- 血統表の位置

/** 仔から見た祖先。path は 'f'（父）・'m'（母）を世代ぶん並べた文字列（'fmf' ＝ 父の母の父）。 */
function ancestorAt(world, sire, dam, path) {
  let h = path[0] === 'f' ? sire : dam;
  for (let i = 1; i < path.length && h; i++) {
    const id = path[i] === 'f' ? h.sireId : h.damId;
    h = id != null ? world.horses.get(id) : null;
  }
  return h ?? null;
}

const PATHS = (gen) => {
  let out = [''];
  for (let i = 0; i < gen; i++) out = out.flatMap((p) => [`${p}f`, `${p}m`]);
  return out;
};
const GEN3 = PATHS(3);
const GEN4 = PATHS(4);

// ---------------------------------------------------------------- 系統

/** 系統の情報。子系統（系祖で止める）・親系統（その上の系祖）・始祖系統（一番上）・特性。 */
function makeLines(world) {
  // 系統は系祖（lineHead）が増えない限り変わらないので、世界ごとに使い回す。
  // 系祖が増えるのは establishLines（pedigree.js）だけで、そこが _lineEpoch を進める。
  const epoch = world._lineEpoch ?? 0;
  if (world._lineMemo?.epoch !== epoch) world._lineMemo = { epoch, map: new Map() };
  const memo = world._lineMemo.map;
  // 始祖系統：系祖をさらに上へたどって、いちばん上の系祖。
  const ultimate = (child) => {
    let c = child;
    for (let i = 0; i < 8; i++) {
      const head = world.horses.get(c);
      if (head?.sireId == null) return c;
      const up = sireLineRoot(world, head.sireId);
      if (up === c) return c;
      c = up;
    }
    return c;
  };
  const traitOf = (head) => {
    const h = world.horses.get(head);
    if (!h?.pot) return null;
    const d = h.pot.speed - h.pot.stamina;
    return d >= 0.06 ? 'SP' : d <= -0.06 ? 'ST' : '無';
  };
  const lines = (horse) => {
    if (!horse) return null;
    let v = memo.get(horse.id);
    if (v) return v;
    const child = sireLineRoot(world, horse.id);
    const head = world.horses.get(child);
    const parent = head?.sireId != null ? sireLineRoot(world, head.sireId) : child;
    v = { child, parent, root: ultimate(child), trait: traitOf(child) };
    memo.set(horse.id, v);
    return v;
  };
  return lines;
}

/** 現役種牡馬の系統の勢力。流行（10% 以上）と零細（1% 以下か 1 頭だけ）。世界の状態が変わるまで使い回す。 */
function lineShare(world) {
  const key = `${world.year}|${world.stallionPool.length}`;
  if (world._lineShare?.key === key) return world._lineShare;
  const count = new Map();
  let total = 0;
  for (const id of world.stallionPool) {
    const h = world.horses.get(id);
    if (!h || h.dead) continue;
    const c = sireLineRoot(world, id);
    count.set(c, (count.get(c) ?? 0) + 1);
    total++;
  }
  world._lineShare = { key, count, total };
  return world._lineShare;
}

// ---------------------------------------------------------------- インブリード

const BLOOD_BURST = [   // 血量の段 → [因子 0, 1, 2]
  [0.12, [1, 4, 7]], [0.19, [3, 6, 9]], [0.26, [4, 7, 10]], [0.32, [5, 8, 11]], [0.38, [5, 8, 11]],
];
const BLOOD_BURST_MATERNAL = [
  [0.12, [1, 5, 9]], [0.19, [3, 7, 11]], [0.26, [4, 8, 12]], [0.32, [5, 9, 13]], [0.38, [5, 9, 13]],
];
const BLOOD_RISK = [[0.12, 1], [0.19, 2], [0.26, 3], [0.32, 4], [0.38, 5]];
const BLOOD_RISK_MATERNAL = [[0.12, 0], [0.19, 1], [0.26, 2], [0.32, 3], [0.38, 4]];

const pick = (table, share) => {
  for (const [lim, v] of table) if (share <= lim + 1e-9) return v;
  return table[table.length - 1][1];
};
const bloodShare = (gens) => Math.pow(0.5, gens[0]) + Math.pow(0.5, gens[1]);

/** 健康（丈夫さ）の高い両親は危険度を減らす。両親ともに S 以上なら 2、A+ 以上なら 1。 */
function healthRelief(sire, dam) {
  const m = Math.min(sire.sound, dam.sound);
  return m >= 0.889 ? 2 : m >= 0.778 ? 1 : 0;
}

// ---------------------------------------------------------------- 本体

/**
 * 成立している理論をすべて評価する。
 * @returns {{list:object[], burst:number, risk:number, pot:object, extra:object, subRoll:object, blocked:string|null}}
 */
export function evaluateTheories(world, sire, dam, { ib: ibIn = null } = {}) {
  const list = [];
  const L = makeLines(world);
  const add = (id, name, text, e = {}) => {
    list.push({
      id, name, text, burst: e.burst ?? 0, risk: e.risk ?? 0,
      pot: e.pot ?? {}, extra: e.extra ?? {}, subRoll: e.subRoll ?? null, kind: e.kind ?? null,
    });
  };
  const ancMap = new Map();
  const anc = (p) => {
    if (ancMap.has(p)) return ancMap.get(p);
    const h = ancestorAt(world, sire, dam, p);
    ancMap.set(p, h);
    return h;
  };
  const hasFactor = (h) => (h?.factors ?? []).length > 0;
  const abilFactors = (h) => (h?.factors ?? []).filter((f) => FACTOR_ABILITY.includes(f));
  const speedFactors = (h) => (h?.factors ?? []).filter((f) => f === 'speed').length;
  const ib = ibIn ?? inbreedings(world, sire.id, dam.id);
  const relief = healthRelief(sire, dam);

  // ---- 近親：インブリード・奇跡の血量・母系インブリード・全きょうだいインブリード
  const maternal = (() => {
    const a = collectAncestors(world, sire.damId, 3);
    const b = collectAncestors(world, dam.damId, 3);
    if (sire.damId != null) a.set(sire.damId, { gen: 0, count: 1 });
    if (dam.damId != null) b.set(dam.damId, { gen: 0, count: 1 });
    return { a, b };
  })();
  let inbreedShareMax = 0;
  let inbreedCount = 0;
  const inbreedRisks = [];
  for (const x of ib) {
    const share = bloodShare(x.gens);
    if (x.gens[0] > 4 || x.gens[1] > 4) continue;       // 4 代より先は理論にならない
    const h = world.horses.get(x.id);
    const sf = Math.min(2, speedFactors(h));
    inbreedShareMax = Math.max(inbreedShareMax, share);
    inbreedCount++;
    const mat = maternal.a.has(x.id) && maternal.b.has(x.id);
    const burst = pick(mat ? BLOOD_BURST_MATERNAL : BLOOD_BURST, share)[sf];
    const risk = pick(mat ? BLOOD_RISK_MATERNAL : BLOOD_RISK, share) + (share > 0.45 ? 2 : share > 0.38 ? 1 : 0);
    const miracle = Math.abs(share - 0.1875) < 0.001 && !mat;
    inbreedRisks.push({ risk, share });
    // 対象馬の因子に対応した能力が上がる。
    const pot = {};
    for (const f of abilFactors(h)) {
      const a = f === 'burst' ? 'wit' : f;
      pot[a] = (pot[a] ?? 0) + SUB * (share >= 0.25 ? 1.5 : 1);
    }
    add(mat ? 'inb_m' : miracle ? 'miracle' : 'inb',
      mat ? '母系インブリード' : miracle ? '奇跡の血量' : 'インブリード',
      `${h?.name ?? x.name} の ${x.label}（血量 ${(share * 100).toFixed(1)}%）${sf ? `。スピード因子 ${sf}` : ''}`,
      { burst, risk, pot, kind: 'inbreed' });
  }
  // 全きょうだいインブリード：父の側と母の側に、同じ父と母を持つ別々の馬が居る。
  {
    const sideA = [], sideB = [];
    for (const p of GEN3.filter((q) => q[0] === 'f')) { const h = anc(p); if (h?.sireId != null && h.damId != null) sideA.push({ h, g: p.length }); }
    for (const p of GEN3.filter((q) => q[0] === 'm')) { const h = anc(p); if (h?.sireId != null && h.damId != null) sideB.push({ h, g: p.length }); }
    const seen = new Set();
    for (const a of sideA) for (const b of sideB) {
      if (a.h.id === b.h.id || a.h.sireId !== b.h.sireId || a.h.damId !== b.h.damId) continue;
      const key = `${a.h.sireId}|${a.h.damId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const share = bloodShare([a.g, b.g]);
      const sf = Math.min(2, speedFactors(a.h) + speedFactors(b.h));
      inbreedShareMax = Math.max(inbreedShareMax, share);
      inbreedCount++;
      inbreedRisks.push({ risk: pick(BLOOD_RISK, share), share });
      add('fullsib', '全きょうだいインブリード', `${a.h.name} と ${b.h.name} は全きょうだい（血量 ${(share * 100).toFixed(1)}%）`,
        { burst: pick(BLOOD_BURST, share)[sf], risk: pick(BLOOD_RISK, share), kind: 'inbreed' });
    }
  }

  // ---- ラインブリード
  const ls = L(sire), ld = L(dam);
  const lineBreed = [];
  if (ls && ld) {
    const sp = ls.trait === 'SP' && ld.trait === 'SP';
    if (ls.child === ld.child) {
      add('lb_child', sp ? '子系統ラインブリード（SP 型）' : '子系統ラインブリード',
        `父と母が同じ ${world.horses.get(ls.child)?.name}系`, { burst: sp ? 5 : 3, risk: 2, kind: 'line' });
      lineBreed.push('child');
    } else if (ls.parent === ld.parent) {
      add('lb_parent', sp ? '親系統ラインブリード（SP 型）' : '親系統ラインブリード',
        `父と母の親系統が同じ（${world.horses.get(ls.parent)?.name}系）`, { burst: sp ? 3 : 2, risk: 1, kind: 'line' });
      lineBreed.push('parent');
    }
  }
  // 爆発型：3 代前の種牡馬 4 頭（父父父・父母父・母父父・母母父）の親系統。
  {
    const hs = ['fff', 'fmf', 'mff', 'mmf'].map((p) => anc(p));
    const ls4 = hs.map((h) => (h ? L(h) : null));
    if (ls4.every(Boolean)) {
      const parents = new Map();
      for (const l of ls4) parents.set(l.parent, (parents.get(l.parent) ?? 0) + 1);
      const [topParent, n] = [...parents.entries()].sort((a, b) => b[1] - a[1])[0];
      const children = new Set(ls4.filter((l) => l.parent === topParent).map((l) => l.child));
      const allDistinctChildren = children.size === ls4.filter((l) => l.parent === topParent).length;
      if (n >= 3 && allDistinctChildren) {
        const spf = ls.trait === 'SP';
        const burst = n === 4 ? (spf ? 13 : 11) : (spf ? 9 : 7);
        add(`lb_burst${n}`, `親系統ラインブリード${n}本爆発${spf ? 'SP' : ''}型`,
          `3 代前の種牡馬 4 頭のうち ${n} 頭が ${world.horses.get(topParent)?.name}系`, { burst, risk: 1, kind: 'line' });
        lineBreed.push('burst');
      }
    }
  }

  // ---- アウトブリード
  if (inbreedCount === 0 && lineBreed.length === 0) {
    add('outbreed', 'アウトブリード', '近親も同じ系統も入らない。丈夫で賢く、競走寿命も延びる',
      { burst: 1, extra: { sound: 0.02, spirit: 0.02, distRange: 40 }, pot: { wit: SUB * 0.7 }, kind: 'out' });
  }

  // ---- 血脈活性化配合（3 代前の先祖 8 頭の親系統の種類）
  let activation = 0;
  {
    const ps = new Set();
    let known = 0;
    for (const p of GEN3) {
      const h = anc(p);
      if (!h) continue;
      known++;
      ps.add(L(h).parent);
    }
    if (known === 8 && ps.size >= 6) {
      activation = ps.size;
      add(`vigor${ps.size}`, `血脈活性化配合（${ps.size}本型）`,
        `3 代前の先祖 8 頭の親系統が ${ps.size} 種類。近親の危険度を和らげる`, { burst: ps.size === 6 ? 4 : ps.size === 7 ? 6 : 8, kind: 'vigor' });
    }
  }

  // ---- 1/4 異系配合
  {
    const g4 = GEN4.map((p) => anc(p));
    if (g4.every(Boolean)) {
      const sets = [0, 1, 2, 3].map((i) => g4.slice(i * 4, i * 4 + 4));
      const parentsOf = sets.map((s) => new Set(s.map((h) => L(h).parent)));
      const cnt = new Map();
      for (const ps of parentsOf) for (const p of ps) cnt.set(p, (cnt.get(p) ?? 0) + 1);
      const common = [...cnt.entries()].filter(([, n]) => n === 3).map(([p]) => p);
      let ok = false;
      for (const c of common) {
        const odd = parentsOf.findIndex((ps) => !ps.has(c));
        if (odd < 0) continue;
        const others = new Set(parentsOf.flatMap((ps, i) => (i === odd ? [] : [...ps])));
        if ([...parentsOf[odd]].some((p) => others.has(p))) continue;                // ③
        // ② 残りの 1 セットとその子孫（3〜1 代前の祖先）がインブリードの対象に居ない。
        const chain = new Set(sets[odd].map((h) => h.id));
        const path = GEN3[odd * 2], path2 = GEN3[odd * 2 + 1];
        for (const p of [path, path2, path.slice(0, 2), path.slice(0, 1)]) { const h = anc(p); if (h) chain.add(h.id); }
        if (ib.some((x) => chain.has(x.id))) continue;
        ok = true;
        break;
      }
      if (ok) add('quarter', '1/4異系配合', '4 代前の祖先のうち 1 組だけが別の系統。血が新鮮になる', { burst: 2, kind: 'quarter' });
    }
  }

  // ---- ニックス（父の系統 × 母父・母母父・母母母父・母母母母の系統）
  {
    let direct = 0;
    const chain = [dam.sireId, dam.damId != null ? world.horses.get(dam.damId)?.sireId : null,
      anc('mmm')?.sireId ?? null, anc('mmmm')?.id ?? null];
    // 母母母母の系統は、その馬自身（牝馬）の系統＝その父の系統で見る。
    const good = chain.map((id) => {
      if (id == null || !ls) return false;
      const h = world.horses.get(id);
      if (!h) return false;
      const bl = sireLineRoot(world, h.id);
      if (bl == null || L(h).parent === ls.parent) return false;      // 親系統が同じなら成立しない
      return (world.nicks.get(nicksKey(ls.child, bl)) ?? 0) >= GOOD_NICK;
    });
    for (let i = 0; i < 4 && good[i]; i++) direct++;
    if (direct > 0) {
      const names = ['シングル', 'ダブル', 'トリプル', 'フォース'];
      add(`nicks${direct}`, `${names[direct - 1]}ニックス`, '父の系統と母方の系統の相性がよい', { burst: direct * 2, kind: 'nicks' });
    } else {
      // 間接型：直接型が成立しないとき、父と母母父・母母母父・母母母母の間（1 つだけ）。
      const k = good.findIndex((x, i) => i >= 1 && x);
      if (k >= 1) add(`nicks_i${k + 1}`, `${k + 1}次ニックス`, '父の系統と遠い母方の系統の相性がよい', { burst: 1, kind: 'nicks' });
    }
  }

  // ---- 母父○／◎（母父が系統を確立した種牡馬で、能力系の因子を持つ）
  {
    const bms = dam.sireId != null ? world.horses.get(dam.sireId) : null;
    if (bms?.lineHead) {
      const n = abilFactors(bms).length;
      if (n >= 1) add(n >= 2 ? 'bms2' : 'bms1', n >= 2 ? '母父◎' : '母父○', `母の父 ${bms.name} は系統の祖で、能力の因子を持つ`,
        { burst: n >= 2 ? 4 : 2, kind: 'bms' });
    }
  }

  // ---- 活力源化因子（父の側にも母の側にも、系統を確立した種牡馬が居る）
  {
    let a = 0, b = 0;
    for (const p of [...PATHS(1), ...PATHS(2), ...GEN3, ...GEN4]) {
      const h = anc(p);
      if (!h?.lineHead || !hasFactor(h)) continue;
      if (p[0] === 'f') a++; else b++;
    }
    if (a >= 1 && b >= 1) {
      let burst = Math.min(8, a + b);
      if (inbreedCount > 0) burst = inbreedShareMax <= 0.25 ? Math.floor(burst * 2 / 3) : Math.floor(burst / 2);
      if (burst > 0) add('vitality', '活力源化因子', '父の側にも母の側にも、系統を確立して因子を持つ種牡馬が居る', { burst, kind: 'vitality' });
    }
  }

  // ---- 隔世遺伝（両親は因子なし、父父か母父が能力系の因子を持つ）
  if (!abilFactors(sire).length && !abilFactors(dam).length) {
    const g = abilFactors(anc('ff')).length ? anc('ff') : abilFactors(anc('mf')).length ? anc('mf') : null;
    if (g) {
      const pot = {};
      for (const f of abilFactors(g)) { const a = f === 'burst' ? 'wit' : f; pot[a] = SUB; }
      add('atavism', '隔世遺伝', `${g.name} の因子（${(g.factors ?? []).map((f) => FACTORS[f] ?? f).join('・')}）が出る`,
        { burst: speedFactors(g) * 3, pot, kind: 'atavism' });
    }
  }

  // ---- メールライン活性配合・ボトムライン活性配合
  {
    const share = lineShare(world);
    const frac = (h) => (share.total ? (share.count.get(L(h).child) ?? 0) / share.total : 0);
    const trend = (h) => frac(h) >= 0.1;
    const tiny = (h) => (share.count.get(L(h).child) ?? 0) <= 1 || frac(h) <= 0.01;
    const A = (p) => anc(p);
    if (A('f') && A('m') && A('mm') && A('mmm')) {
      if (trend(sire) && tiny(A('m')) && tiny(A('mm')) && tiny(A('mmm'))) {
        let lv = 1;
        if (['mf', 'mff', 'mfm', 'mmf'].every((p) => A(p) && tiny(A(p)))) {
          lv = 2;
          const rest = GEN3.filter((p) => !['fff', 'mmm', 'mmf', 'mff', 'mfm'].includes(p));
          if (rest.every((p) => A(p) && tiny(A(p)))) lv = 3;
        }
        add(`mail${lv}`, `メールライン活性配合Lv.${lv}`, '父系は流行の系統で、母方は零細の系統ばかり', { burst: [3, 6, 10][lv - 1], kind: 'mail' });
      }
      if (tiny(sire) && (trend(A('m')) || hasFactor(A('m'))) && (trend(A('mm')) || hasFactor(A('mm'))) && (trend(A('mmm')) || hasFactor(A('mmm')))) {
        let lv = 1;
        const sireSide = ['ff', 'fm', 'fff', 'ffm', 'fmf', 'fmm'];
        if (sireSide.every((p) => A(p) && tiny(A(p)))) {
          lv = 2;
          const damSide = ['mf', 'mm', 'mff', 'mfm', 'mmf', 'mmm'];
          if (damSide.every((p) => A(p) && (trend(A(p)) || (p === 'mmm' && hasFactor(A(p)))))) lv = 3;
        }
        add(`bottom${lv}`, `ボトムライン活性配合Lv.${lv}`, '父系は零細の系統で、母方は流行の系統か因子持ち', { burst: [3, 6, 10][lv - 1], kind: 'bottom' });
      }
    }
  }

  // ---- 系統特性昇華（SP／ST／なし）・融合
  {
    const tr = (p) => { const h = anc(p); return h ? L(h).trait : undefined; };
    const near = ['f', 'm'];
    const gen2 = ['f', 'm', 'ff', 'fm', 'mf', 'mm'];
    const gen3 = [...gen2, ...GEN3];
    const sup = (t) => {
      const okMare = (p) => { const h = anc(p); return h && (tr(p) === t || (t !== '無' && abilFactors(h).length > 0)); };
      if (!near.every(okMare)) return 0;
      let lv = 1;
      if (gen2.every(okMare)) {
        lv = 2;
        if (gen3.every(okMare)) lv = 3;
      }
      return lv;
    };
    const SUP = {
      SP: { b: [1, 3, 5], name: 'SP', pot: [{}, {}, { wit: SUB }] },
      ST: { b: [1, 2, 3], name: 'ST', pot: [{ power: SUB * 0.6, guts: SUB * 0.6 }, { power: SUB, guts: SUB }, { power: SUB * 1.4, guts: SUB * 1.4 }] },
      無: { b: [1, 2, 3], name: 'なし', pot: [{}, {}, {}] },
    };
    for (const t of ['SP', 'ST', '無']) {
      const lv = sup(t);
      if (!lv) continue;
      const s = SUP[t];
      add(`sup_${t}${lv}`, `系統特性昇華配合（${s.name}）Lv.${lv}`, `両親の系統が${t === '無' ? 'どれも無系統' : `すべて ${t} 系統`}`,
        { burst: s.b[lv - 1], pot: s.pot[lv - 1], extra: t === '無' ? { spirit: 0.01 * lv, sound: 0.01 * lv } : {}, kind: 'sup' });
      break;
    }
    // 融合：片方の 3 代がすべて A 系統、もう片方がすべて B 系統。
    const sideTraits = (first) => {
      const ps = ['', 'f', 'm', 'ff', 'fm', 'mf', 'mm', 'fff', 'ffm', 'fmf', 'fmm', 'mff', 'mfm', 'mmf', 'mmm']
        .filter((p) => p && p[0] === first && p.length <= 3);
      const set = new Set(ps.map((p) => tr(p)));
      return set.size === 1 && !set.has(undefined) ? [...set][0] : null;
    };
    const tf = sideTraits('f'), tm = sideTraits('m');
    if (tf && tm && tf !== tm) {
      const pair = new Set([tf, tm]);
      if (pair.has('SP') && pair.has('ST')) add('fusion_spst', '系統特性融合配合（SP・ST）', '片方の系統がすべてスピード型、もう片方がすべてスタミナ型', { burst: 5, pot: { power: SUB }, kind: 'fusion' });
      else if (pair.has('SP') && pair.has('無')) add('fusion_spn', '系統特性融合配合（SP・なし）', '片方の系統がすべてスピード型、もう片方がすべて無系統', { burst: 5, extra: { spirit: 0.012 }, kind: 'fusion' });
      else if (pair.has('ST') && pair.has('無')) add('fusion_stn', '系統特性融合配合（ST・なし）', '片方の系統がすべてスタミナ型、もう片方がすべて無系統', { burst: 3, pot: { power: SUB }, extra: { spirit: 0.012 }, kind: 'fusion' });
    }
  }

  // ---- 値段・年齢・性格の理論
  {
    const fee = sire.studFee ?? 0;
    const price = 800 + Math.pow(breedQuality(dam), 3) * 40000;
    const witOf = (h) => h.pot.wit;
    if (fee > 0 && fee <= 100 && price >= 10000 && witOf(dam) >= 0.667) {
      add('owarai', 'お笑い配合', '種付料が安い種牡馬と、評価額の高い賢い牝馬', { burst: 5, pot: { guts: SUB, wit: SUB }, extra: { spirit: 0.012 }, kind: 'price' });
    } else if (fee > 0 && fee <= 200 && witOf(sire) >= 0.889 && price <= 1000 && witOf(dam) >= 0.889) {
      add('oniai', 'お似合い配合', '安い種牡馬と評価額の低い牝馬が、どちらも賢い', { burst: 5, pot: { guts: SUB, wit: SUB }, extra: { spirit: 0.012 }, kind: 'price' });
    }
    // サヨナラ配合
    const age = world.year - sire.birthYear;
    if (age >= 24 && ls) {
      const others = world.stallionPool.some((id) => {
        const h = world.horses.get(id);
        return h && !h.dead && h.id !== sire.id && sireLineRoot(world, id) === ls.child;
      });
      if (!others) {
        const w = world.year - dam.birthYear >= 18 && (lineShare(world).count.get(ld?.child) ?? 0) <= 1;
        if (w) add('sayonara_w', 'Ｗサヨナラ配合', '最後の種付けとなる老いた種牡馬と、零細の系統の古い牝馬', { burst: 8, pot: { guts: SUB, power: SUB, wit: SUB }, extra: { spirit: 0.012, sound: 0.012 }, kind: 'sayonara' });
        else add('sayonara', 'サヨナラ配合', '同じ系統の種牡馬が他に居ない老いた種牡馬の最後の仔', { burst: 5, pot: { guts: SUB }, extra: { spirit: 0.012, sound: 0.012 }, kind: 'sayonara' });
      }
    }
  }

  // ---- 稲妻・疾風
  {
    const A = 0.667, D = 0.40;
    const lightning = sire.pot.speed >= A && dam.pot.speed >= A && sire.pot.guts < D && dam.pot.guts < D;
    const gale = sire.pot.guts >= A && dam.pot.guts >= A && sire.pot.speed < D && dam.pot.speed < D;
    if (lightning) {
      const grey = ['芦毛', '白毛'].includes(sire.coat) && ['芦毛', '白毛'].includes(dam.coat);
      add(grey ? 'lightning2' : 'lightning', grey ? '真稲妻配合' : '稲妻配合', '瞬発力に優れ、勝負根性の乏しい両親。両親の特徴を色濃く受け継ぐ',
        { burst: grey ? 12 : 6, pot: { guts: -SUB }, kind: 'bolt' });
    }
    if (gale) {
      const dark = ['黒鹿毛', '青鹿毛', '青毛'];
      const dk = dark.includes(sire.coat) && dark.includes(dam.coat);
      add(dk ? 'gale2' : 'gale', dk ? '真疾風配合' : '疾風配合', '勝負根性に優れ、瞬発力の乏しい両親。両親の特徴を色濃く受け継ぐ',
        { burst: dk ? 12 : 6, pot: { guts: SUB }, extra: { spirit: 0.012 }, kind: 'bolt' });
    }
  }

  // ---- 3 冠配合・お披露目・そっくりさん
  {
    const crown = (h) => (h.titles ?? []).some((t) => t.includes('三冠'));
    if (crown(sire) && crown(dam)) add('triple', '3冠配合', '父も母も三冠馬', { burst: 4, kind: 'crown' });
    if ((sire.foals ?? []).length === 0 && (dam.foals ?? []).length === 0 && (sire.g1Wins ?? 0) >= 1 && (dam.g1Wins ?? 0) >= 1) {
      add('debut', 'お披露目配合', '繁殖入りしたばかりの GI 馬どうし', { burst: 2, kind: 'debut' });
    }
    const face = (h) => (h.id * 2654435761) >>> 30;      // 顔の白徴の代わり（4 種類）
    if (sire.coat === dam.coat && face(sire) === face(dam)) {
      add('lookalike', 'そっくりさん配合', '父と母の毛色と顔つきが同じ', { burst: 2, kind: 'look' });
    }
  }

  // ---- 基準交配（日本の牝馬、片方だけが 3×3 以上のインブリードを持つ）
  if (!dam.foreign) {
    // 馬ごとの答えは血統が変わらない限り変わらない（置き換え・つなぎ直しのあとは world._strongMemo を捨てる）。
    const memo = (world._strongMemo ??= new Map());
    const strong = (h) => {
      if (h.sireId == null || h.damId == null) return false;
      let v = memo.get(h.id);
      if (v === undefined) {
        v = inbreedings(world, h.sireId, h.damId).some((x) => bloodShare(x.gens) >= 0.25 - 1e-9);
        memo.set(h.id, v);
      }
      return v;
    };
    if (strong(sire) !== strong(dam)) {
      add('standard', '基準交配', '片方だけが濃い近交を持つ日本の配合。成長の上限が高くなりやすい',
        { burst: 2, pot: Object.fromEntries(ABILITIES.map((a) => [a, 0.006])), kind: 'standard' });
    }
  }

  // ---- 始祖血脈融合配合（2 代前までの始祖系統の種類）
  {
    const side = (first) => new Set(['f', 'm', 'ff', 'fm', 'mf', 'mm'].filter((p) => p[0] === first)
      .map((p) => anc(p)).filter(Boolean).map((h) => L(h).root));
    const a = side('f'), b = side('m');
    const all = new Set([...a, ...b]);
    const bothContribute = [...a].some((x) => !b.has(x)) && [...b].some((x) => !a.has(x));
    if (all.size >= 2 && bothContribute) {
      if (all.size >= 4) add('roots4', '始祖血脈融合配合（4種類）', '2 代前までに 4 つの始祖系統が混ざる', { burst: 0, pot: { speed: SUB }, kind: 'roots' });
      else if (all.size === 3) add('roots3', '始祖血脈融合配合（3種類）', '2 代前までに 3 つの始祖系統が混ざる', { pot: Object.fromEntries(ABILITIES.map((x) => [x, SUB * 0.7])), extra: { spirit: 0.008, sound: 0.008 }, kind: 'roots' });
      else add('roots2', '始祖血脈融合配合（2種類）', '2 代前までに 2 つの始祖系統が混ざる', { subRoll: { amount: SUB * 1.4 }, kind: 'roots' });
    }
  }

  // ---- 危険度：インブリードの危険度に、血脈活性化と健康の補正を掛ける。ラインブリードの分を足す。
  let risk = 0;
  for (const r of inbreedRisks) {
    let v = r.risk;
    if (r.share <= 0.1875 + 1e-9) {
      if (activation >= 7) v = 0; else if (activation === 6) v = Math.floor(v / 2);
    }
    risk += v;
  }
  for (const t of list) if (t.kind === 'line') risk += activation >= 7 ? 0 : t.id === 'lb_parent' && activation === 6 ? 0 : t.risk;
  if (risk > 0) risk = Math.max(0, risk - relief);
  risk = Math.min(RISK_CAP, risk);

  // 種付けできない配合：父が母の父、または父の父が母の父、あるいは血量が 50% を超える。
  let blocked = null;
  if (dam.sireId != null && (sire.id === dam.sireId || (sire.sireId != null && sire.sireId === dam.sireId))) {
    blocked = '極度の近親（母の父、または母の父の子）です。別の配合相手を選んでください';
  }
  if (inbreedShareMax > 0.5) blocked = '血が濃すぎます（血量 50% 超）。別の配合相手を選んでください';

  const burst = Math.min(BURST_CAP, list.reduce((t, x) => t + x.burst, 0));
  const eff = theoryEffect(list);
  return { list, burst, risk, pot: eff.pot, extra: eff.extra, subRoll: eff.subRoll, blocked };
}

/** 理論の効果のうちサブパラの上がり方。能力 1 項目あたり ±0.03 で頭打ち。 */
export function theoryEffect(list) {
  const pot = {};
  const extra = {};
  let subRoll = null;
  for (const t of list) {
    for (const [a, v] of Object.entries(t.pot)) pot[a] = (pot[a] ?? 0) + v;
    for (const [k, v] of Object.entries(t.extra)) extra[k] = (extra[k] ?? 0) + v;
    if (t.subRoll) subRoll = { amount: (subRoll?.amount ?? 0) + t.subRoll.amount };
  }
  for (const a of Object.keys(pot)) pot[a] = Math.max(-0.03, Math.min(0.03, pot[a]));
  return { pot, extra, subRoll };
}

/** 爆発力の言葉（サイトの配合時のコメントに合わせる）。 */
export function burstComment(b) {
  if (b >= 30) return 'とてつもない爆発力を秘めていそうです';
  if (b >= 21) return '大きな爆発力を秘めていそうです';
  if (b >= 15) return 'なかなかの爆発力を秘めていそうです';
  if (b >= 8) return 'ちょっとした爆発力を秘めていそうです';
  return '少し爆発力に欠ける部分があります';
}

/** 危険度の言葉。 */
export function riskComment(r, blocked) {
  if (blocked) return '種付不可：極度の近親です';
  if (r >= 6) return '危険度・大：血が濃くなりすぎて、かなり危険です';
  if (r >= 4) return '危険度・中：産駒の健康面が気になります';
  return '危険度・小';
}

/** 画面の「配合理論の一覧」用。 */
export const THEORY_GUIDE = [
  { name: 'インブリード／奇跡の血量', text: '4 代以内に同じ祖先が入る。血量が濃いほど爆発力が大きく、危険度も上がる。3×4（血量 18.75%）は「奇跡の血量」。対象馬のスピード因子は爆発力をさらに押し上げる' },
  { name: '母系インブリード', text: '父の母系と母の母系が同じ祖先を持つ。インブリードの上位互換（爆発力が大きく、危険度が 1 低い）' },
  { name: '全きょうだいインブリード', text: '父と母の祖先に、同じ父母を持つ兄弟姉妹が一頭ずつ居る' },
  { name: 'アウトブリード', text: '近親も同じ系統も入らない。丈夫さ・賢さ・精神力が少し上がり、競走寿命が延びる。爆発力 +1、危険度なし' },
  { name: 'ラインブリード', text: '父と母が同じ系統（子系統 +3／親系統 +2）。3 代前の種牡馬 4 頭のうち 3〜4 頭が同じ親系統なら爆発型（+7／+11）。スピード型の系統（SP）はさらに +2' },
  { name: '血脈活性化配合', text: '3 代前の先祖 8 頭の親系統が 6〜8 種類（爆発力 +4／+6／+8）。近親・ラインブリードの危険度を和らげる' },
  { name: '1/4異系配合', text: '4 代前の祖先 16 頭のうち、4 頭だけが別の系統（爆発力 +2）' },
  { name: 'ニックス', text: '父の系統と、母父・母母父・母母母父・母母母母の系統の相性。シングル +2・ダブル +4・トリプル +6・フォース +8。直接型が無ければ 2〜4 次ニックス +1' },
  { name: '母父○／◎', text: '母の父が系統の祖で、能力の因子を 1 つ（+2）／2 つ（+4）持つ' },
  { name: '活力源化因子', text: '父の側にも母の側にも、系統を確立した種牡馬が居る。居る数だけ爆発力が上がる（近親が入ると減る）' },
  { name: '隔世遺伝', text: '両親は因子を持たず、父父か母父が能力の因子を持つ。対応する能力が上がり、スピード因子は 1 つにつき爆発力 +3' },
  { name: 'メールライン活性配合', text: '父系が流行の系統で、母・母母・母母母が零細の系統（Lv.1 +3 → Lv.3 +10）' },
  { name: 'ボトムライン活性配合', text: '父系が零細の系統で、母・母母・母母母が流行の系統か因子持ち（Lv.1 +3 → Lv.3 +10）' },
  { name: '系統特性昇華配合', text: '両親の系統の特性（スピード型・スタミナ型・無系統）が揃う（Lv.1〜3）' },
  { name: '系統特性融合配合', text: '片方の系統がすべてスピード型、もう片方がスタミナ型や無系統（+3〜+5）' },
  { name: 'お笑い／お似合い配合', text: '種付料が安い種牡馬と、賢い牝馬の組み合わせ（+5）。早めに引退させた馬を安い料金で種牡馬にすると成立しやすい' },
  { name: 'サヨナラ／Ｗサヨナラ配合', text: '24 歳以上で、同じ系統の種牡馬が他に居ない種牡馬の最後の仔（+5）。牝馬が 18 歳以上で零細の系統なら +8' },
  { name: '稲妻／疾風配合', text: '父も母も瞬発型（スピード高く根性低い）／根性型（根性高くスピード低い）。爆発力 +6、毛色が揃うと真の稲妻・疾風 +12' },
  { name: '3冠配合', text: '父も母も三冠馬（+4）' },
  { name: 'お披露目配合', text: '繁殖入りしたばかりで、どちらも GI 馬（+2）' },
  { name: 'そっくりさん配合', text: '父と母の毛色と顔つきが同じ（+2）' },
  { name: '基準交配', text: '日本の牝馬で、片方だけが 3×3 以上のインブリードを持つ。爆発力 +2、成長の上限が高くなりやすい' },
  { name: '始祖血脈融合配合', text: '2 代前までに 2 種類以上の始祖系統が混ざる。2 種類で一部のサブパラ、3 種類で全サブパラ、4 種類でスピードが上がる' },
];

const NAMES = new Map([
  ['inb', 'インブリード'], ['miracle', '奇跡の血量'], ['inb_m', '母系インブリード'], ['fullsib', '全きょうだいインブリード'],
  ['lb_child', '子系統ラインブリード'], ['lb_parent', '親系統ラインブリード'], ['lb_burst3', '親系統ラインブリード3本爆発型'],
  ['lb_burst4', '親系統ラインブリード4本爆発型'], ['outbreed', 'アウトブリード'], ['quarter', '1/4異系配合'],
  ['nicks1', 'シングルニックス'], ['nicks2', 'ダブルニックス'], ['nicks3', 'トリプルニックス'], ['nicks4', 'フォースニックス'],
  ['bms1', '母父○'], ['bms2', '母父◎'], ['vitality', '活力源化因子'], ['atavism', '隔世遺伝'],
  ['owarai', 'お笑い配合'], ['oniai', 'お似合い配合'], ['sayonara', 'サヨナラ配合'], ['sayonara_w', 'Ｗサヨナラ配合'],
  ['lightning', '稲妻配合'], ['lightning2', '真稲妻配合'], ['gale', '疾風配合'], ['gale2', '真疾風配合'],
  ['triple', '3冠配合'], ['debut', 'お披露目配合'], ['lookalike', 'そっくりさん配合'], ['standard', '基準交配'],
  ['roots2', '始祖血脈融合配合'], ['roots3', '始祖血脈融合配合'], ['roots4', '始祖血脈融合配合'],
]);
const NAME_PREFIX = [['vigor', '血脈活性化配合'], ['mail', 'メールライン活性配合'], ['bottom', 'ボトムライン活性配合'],
  ['sup_', '系統特性昇華配合'], ['fusion_', '系統特性融合配合'], ['nicks_i', '間接ニックス']];
/** 理論の id → 名前（馬の詳細に「この仔に成立した理論」を出す）。古い id は null。 */
export function theoryName(id) {
  if (NAMES.has(id)) return NAMES.get(id);
  for (const [p, n] of NAME_PREFIX) if (id.startsWith(p)) return n;
  return null;
}

export const SUB_LABEL = ABILITY_LABEL_JA;
