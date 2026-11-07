// 牧場施設。お金をかけて建てると、自分の馬だけに効く（ほかの馬主の馬には効かない）。
//
// どれも段階（レベル）を上げる形で、建設には工期がかかる。完成するまで効かず、
// 施設は完成後の維持費を毎週払う。効果はどれも小さく（1 段階で 5〜10% ほど）、
// 資金の少ないうちは先に馬を買うほうが得になるように値段を付けている。
//
//   坂路コース     調教で能力が伸びる速さと仕上がり
//   プール         疲労の抜けと、調教での故障の減り方
//   診療所         けがの治りが早い
//   育成牧場       放牧中の回復と、若駒の成長
//   種付け施設     繁殖牝馬の受胎率
//   牧場事務所     在厩・放牧の経費が下がる
//
// 乱数は使わない（施設が無い世界の乱数の流れを変えないため）。

export const MAX_BUILDS = 2;      // 同時に建てられる数

export const FACILITIES = [
  { id: 'slope', name: '坂路コース', icon: 'mountain',
    desc: '調教で能力が伸びる速さと、仕上がりの伸びが増す。',
    levels: [
      { cost: 3000, weeks: 8, upkeep: 6, text: '調教の伸び +8%・仕上がり +5%' },
      { cost: 6500, weeks: 12, upkeep: 12, text: '調教の伸び +16%・仕上がり +10%' },
      { cost: 12000, weeks: 16, upkeep: 20, text: '調教の伸び +25%・仕上がり +15%' },
    ] },
  { id: 'pool', name: 'プール', icon: 'water',
    desc: '疲れが抜けやすく、調教での故障が減る。',
    levels: [
      { cost: 2500, weeks: 6, upkeep: 5, text: '毎週の疲労 -0.02・故障 -10%' },
      { cost: 5500, weeks: 10, upkeep: 10, text: '毎週の疲労 -0.04・故障 -20%' },
      { cost: 10000, weeks: 14, upkeep: 16, text: '毎週の疲労 -0.06・故障 -30%' },
    ] },
  { id: 'clinic', name: '診療所', icon: 'cross',
    desc: 'けがの治りが早い。',
    levels: [
      { cost: 2000, weeks: 6, upkeep: 4, text: 'けがが治るまで -20%' },
      { cost: 4500, weeks: 10, upkeep: 8, text: 'けがが治るまで -35%' },
      { cost: 9000, weeks: 14, upkeep: 14, text: 'けがが治るまで -50%' },
    ] },
  { id: 'paddock', name: '育成牧場', icon: 'sprout',
    desc: '放牧中の回復が早く、若駒が育つ。',
    levels: [
      { cost: 2800, weeks: 8, upkeep: 5, text: '放牧の回復 +15%・若駒の成長 +25%' },
      { cost: 6000, weeks: 12, upkeep: 10, text: '放牧の回復 +30%・若駒の成長 +50%' },
      { cost: 11000, weeks: 16, upkeep: 17, text: '放牧の回復 +45%・若駒の成長 +80%' },
    ] },
  { id: 'breeding', name: '種付け施設', icon: 'mare',
    desc: '繁殖牝馬の受胎率が上がる。',
    levels: [
      { cost: 2200, weeks: 6, upkeep: 4, text: '受胎率 +2.5%' },
      { cost: 5000, weeks: 10, upkeep: 8, text: '受胎率 +5%' },
      { cost: 9500, weeks: 14, upkeep: 14, text: '受胎率 +7.5%' },
    ] },
  { id: 'office', name: '牧場事務所', icon: 'bank',
    desc: '在厩・放牧・繁殖の経費が下がる。',
    levels: [
      { cost: 1800, weeks: 5, upkeep: 3, text: '週の経費 -5%' },
      { cost: 4000, weeks: 8, upkeep: 6, text: '週の経費 -9%' },
      { cost: 8000, weeks: 12, upkeep: 10, text: '週の経費 -12%' },
    ] },
];

export const FACILITY_BY_ID = new Map(FACILITIES.map((f) => [f.id, f]));

/** 状態は player.facilities = { [id]: { level, build: { to, weeksLeft } | null } }。 */
function stateOf(world, id) {
  const p = world.player;
  p.facilities ??= {};
  return (p.facilities[id] ??= { level: 0, build: null });
}

export const facilityLevel = (world, id) => world.player?.facilities?.[id]?.level ?? 0;

const levelOf = (world, id) => facilityLevel(world, id);

/** 効果の一覧。施設が無ければ全部「効かない値」を返す。 */
export function facilityEffects(world) {
  const L = (id) => levelOf(world, id);
  const slope = L('slope'), pool = L('pool'), clinic = L('clinic'), paddock = L('paddock');
  return {
    growMul: [1, 1.08, 1.16, 1.25][slope],
    fitMul: [1, 1.05, 1.10, 1.15][slope],
    relief: [0, 0.02, 0.04, 0.06][pool],          // 毎週の疲労の軽減
    safety: [0, 0.10, 0.20, 0.30][pool],          // 調教での故障の減り
    healShare: [0, 0.20, 0.35, 0.50][clinic],     // けがの治りに足す割合
    pastureMul: [1, 1.15, 1.30, 1.45][paddock],
    youthMul: [1, 1.25, 1.50, 1.80][paddock],
    conceiveBonus: [0, 0.025, 0.05, 0.075][L('breeding')],
    costMul: [1, 0.95, 0.91, 0.88][L('office')],
  };
}

/** 自分の馬に効く施設の効果。ほかの馬には効かない。 */
export const NO_EFFECT = Object.freeze({
  growMul: 1, fitMul: 1, relief: 0, safety: 0, healShare: 0, pastureMul: 1, youthMul: 1, conceiveBonus: 0, costMul: 1,
});

/** 一覧（画面用）。建設中・次のレベルの値段・建てられるかも付ける。 */
export function facilityList(world) {
  const building = FACILITIES.filter((f) => stateOf(world, f.id).build).length;
  return FACILITIES.map((f) => {
    const st = stateOf(world, f.id);
    const next = f.levels[st.level] ?? null;
    let why = '';
    if (!next) why = '最大まで建てた';
    else if (st.build) why = '建設中';
    else if (building >= MAX_BUILDS) why = `同時に建てられるのは ${MAX_BUILDS} つまで`;
    else if (world.player.money < next.cost) why = '資金が足りない';
    return {
      id: f.id, name: f.name, icon: f.icon, desc: f.desc,
      level: st.level, maxLevel: f.levels.length,
      current: st.level > 0 ? f.levels[st.level - 1] : null,
      next, build: st.build ? { ...st.build, total: f.levels[st.build.to - 1].weeks } : null,
      canBuild: !why, why,
      upkeep: st.level > 0 ? f.levels[st.level - 1].upkeep : 0,
    };
  });
}

/** 建設を始める。代金は先払い。 */
export function startBuild(world, id) {
  const f = FACILITY_BY_ID.get(id);
  if (!f) return { ok: false, why: 'そんな施設は無い' };
  const st = stateOf(world, id);
  const next = f.levels[st.level];
  if (!next) return { ok: false, why: 'もう最大まで建てた' };
  if (st.build) return { ok: false, why: 'いま建設中' };
  const busy = FACILITIES.filter((x) => stateOf(world, x.id).build).length;
  if (busy >= MAX_BUILDS) return { ok: false, why: `同時に建てられるのは ${MAX_BUILDS} つまで` };
  if (world.player.money < next.cost) return { ok: false, why: '資金が足りない' };
  world.player.money -= next.cost;
  st.build = { to: st.level + 1, weeksLeft: next.weeks };
  return { ok: true, cost: next.cost, weeks: next.weeks, name: f.name, level: st.level + 1 };
}

/** 建設中の工事を 1 週進める。完成した施設の名前を news に流す。 */
export function advanceFacilities(world, news) {
  for (const f of FACILITIES) {
    const st = world.player?.facilities?.[f.id];
    if (!st?.build) continue;
    st.build.weeksLeft--;
    if (st.build.weeksLeft <= 0) {
      st.level = st.build.to;
      st.build = null;
      news.push(`★${f.name} が完成した（レベル ${st.level}）。`);
    }
  }
}

/** 完成した施設の維持費（週あたり、万円）。建設中は払わない。 */
export function facilityUpkeep(world) {
  let t = 0;
  for (const f of FACILITIES) {
    const lv = levelOf(world, f.id);
    if (lv > 0) t += f.levels[lv - 1].upkeep;
  }
  return t;
}
