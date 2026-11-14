// 調教。
//
// 「能力の現在値を潜在値へ近づける」「疲労を溜める」の二つを同時に動かす。強い調教は速く伸びるが故障を呼ぶ。
// 仕上がり（fit）の仕組みは外した（落とし穴 145）。レースの日の出来は調子と疲れで決まる。

import { ABILITIES, WEEKS_PER_YEAR } from './params.js';
import { clamp01, lerp } from '../core/util.js';
import { rollInjury, horseAge } from './horse.js';
import { trainerBonus } from './jockey.js';
import { NO_EFFECT } from './facilities.js';
import { gearOf, gearEffect } from './gear.js';

/**
 * 調教メニュー。
 * load   疲労の増え方
 * risk   故障の上乗せ
 * grow   潜在能力に近づく速さ
 * focus  伸びやすい能力（null なら均等）
 */
export const MENUS = [
  { id: 'rest', name: '休養', load: -0.14, risk: 0, grow: 0, focus: null,
    desc: '疲れを抜く。能力は伸びない' },
  { id: 'light', name: '軽め', load: 0.02, risk: 0, grow: 0.3, focus: null,
    desc: '維持。疲労はほとんど溜まらない' },
  { id: 'normal', name: '普通', load: 0.07, risk: 0.002, grow: 0.8, focus: null,
    desc: '標準的な乗り込み' },
  { id: 'hard', name: '強め', load: 0.14, risk: 0.006, grow: 1.2, focus: null,
    desc: '大きく伸びるが疲れる' },
  { id: 'slope', name: '坂路', load: 0.11, risk: 0.004, grow: 1.1, focus: 'power',
    desc: 'パワーと勝負根性が伸びる' },
  { id: 'wood', name: 'ウッドチップ', load: 0.08, risk: 0.002, grow: 1.0, focus: 'stamina',
    desc: 'スタミナ中心。脚元に優しい' },
  { id: 'track', name: 'コース追い', load: 0.12, risk: 0.005, grow: 1.1, focus: 'speed',
    desc: 'スピードを磨く。実戦に近い' },
  { id: 'pool', name: 'プール', load: -0.02, risk: -0.004, grow: 0.5, focus: 'stamina',
    desc: '脚に負担をかけずに鍛える' },
  { id: 'gate', name: 'ゲート練習', load: 0.04, risk: 0.001, grow: 0.5, focus: 'wit',
    desc: '気性と賢さを落ち着かせる' },
];
export const MENU_BY_ID = new Map(MENUS.map((m) => [m.id, m]));

/**
 * オート調教（落とし穴 145）。自分の馬の調教を、傾向（伸ばしたい能力 × 強さ）に沿って毎週決める。
 * 傾向の能力ごとの主なメニュー。バランスは週ごとに回す。
 */
export const AUTO_FOCUS = [
  { id: 'balance', name: 'バランス', menus: ['track', 'wood', 'slope', 'normal'] },
  { id: 'speed', name: 'スピード重視', menus: ['track'] },
  { id: 'stamina', name: 'スタミナ重視', menus: ['wood'] },
  { id: 'power', name: 'パワー重視', menus: ['slope'] },
  { id: 'wit', name: '賢さ・気性', menus: ['gate', 'normal'] },
];
/**
 * 強さ。疲れがどこまで溜まったら脚に優しいメニュー（プール）・休養へ切り替えるか。
 * ハードは疲れを溜めてでも追い、強めも混ぜる。軽めは 2 週に 1 度を軽めにして疲れを残さない。
 */
export const AUTO_INTENSITY = [
  { id: 'hard', name: 'ハード', soft: 0.45, rest: 0.62, desc: '疲れを溜めてでも追う。伸びは速いが故障に注意' },
  { id: 'normal', name: '普通', soft: 0.32, rest: 0.5, desc: '疲れを見ながら追う' },
  { id: 'light', name: '軽め', soft: 0.22, rest: 0.4, desc: '疲れを残さない。伸びはゆっくり' },
];
export const AUTO_DEFAULT = { focus: 'balance', intensity: 'normal' };

/** 傾向を範囲に収める（セーブは素の JSON。知らない値は既定へ）。 */
export function cleanAutoPlan(p) {
  const focus = AUTO_FOCUS.some((f) => f.id === p?.focus) ? p.focus : AUTO_DEFAULT.focus;
  const intensity = AUTO_INTENSITY.some((f) => f.id === p?.intensity) ? p.intensity : AUTO_DEFAULT.intensity;
  return { focus, intensity };
}

/**
 * オート調教の 1 週のメニュー。疲れ・傾向・週・出走の近さだけで決める（乱数は使わない。
 * 自分の馬を自動にしても、ほかの馬の乱数の流れは変わらない）。
 * raceSoon（今週か来週に走る）は軽めにして、疲れを残さずに出す（疲れはレースの力を削る）。
 */
export function autoTrainMenu(horse, plan, { week = 1, raceSoon = false } = {}) {
  const p = cleanAutoPlan(plan);
  const it = AUTO_INTENSITY.find((x) => x.id === p.intensity);
  const fat = horse.fatigue ?? 0;
  if (fat > it.rest) return 'rest';
  if (raceSoon) return fat > 0.2 ? 'rest' : 'light';
  if (fat > it.soft) return 'pool';
  if (p.intensity === 'light' && week % 2 === 0) return 'light';
  const menus = AUTO_FOCUS.find((f) => f.id === p.focus).menus;
  const m = menus[week % menus.length];
  // ハードは疲れの浅い週に「強め」を挟む（バランスの「普通」の週を強めにする）
  if (p.intensity === 'hard' && m === 'normal' && fat < 0.25) return 'hard';
  return m;
}

/**
 * 1 週ぶんの調教を当てる。在厩馬にだけ呼ぶ。
 * @returns {{injury:object|null, grew:boolean}}
 */
export function trainWeek(horse, rng, { year, trainer, menuId = 'normal', fx = NO_EFFECT }) {
  const menu = MENU_BY_ID.get(menuId) ?? MENU_BY_ID.get('normal');
  const tb = trainerBonus(trainer);
  const age = horseAge(horse, year);

  // 疲れているときに追うと伸びない。
  const tired = clamp01(horse.fatigue);
  const eff = 1 - tired * 0.55;

  // 施設（プール）で疲れが抜ける。仕上げ上手の厩舎は疲れを溜めずに乗り込める（増えるときだけ）。
  horse.fatigue = clamp01(horse.fatigue + menu.load * lerp(1.1, 0.85, horse.sound) * (menu.load > 0 ? tb.load : 1) - fx.relief);

  // 現在値を潜在値へ寄せる。若いほど速い。
  let grew = false;
  if (menu.grow > 0) {
    const youth = clamp01((8 - age) / 6);
    const base = 0.0090 * menu.grow * tb.growth * (0.5 + youth) * eff * fx.growMul;
    for (const a of ABILITIES) {
      const room = horse.pot[a] - horse.cur[a];
      if (room <= 0.0005) continue;
      const w = menu.focus === a ? 2.0 : menu.focus ? 0.7 : 1.0;
      horse.cur[a] = clamp01(horse.cur[a] + Math.min(room, base * w * rng.range(0.6, 1.5)));
      grew = true;
    }
  }

  // 気性はゲート練習で少しだけ良くなる。
  if (menu.id === 'gate') horse.temper = clamp01(horse.temper + 0.006);

  const risk = menu.risk * tb.injury;
  const injury = rollInjury(horse, rng, { extra: risk > 0 ? risk * (1 - fx.safety) : risk, mul: gearEffect(gearOf(horse), horse.temper).injury });
  return { injury, grew };
}

/**
 * 育成。1 歳の 1 年を牧場で過ごし（馴致・騎乗・乗り込み）、2 歳の年明けに厩舎へ入る。
 * 生まれたときの現在値は潜在値の 2 割ほどで、以前は 2 歳になるまで何も育たなかった。
 * 2 歳の 1 月に 2 割のまま調教を始めるので、6 月の新馬では潜在の半分（開始年の 2 歳は
 * 紙の戦績で 8 割から始まるので 9 割台）にしか届かず、未勝利に回ると叩いた馬にまず勝てなかった。
 * 施設の無い牧場で 2 歳の年明けに潜在の 6〜7 割、育成牧場があればそれより先まで育つ。
 * 育成で届くのは 9 割まで（残りは厩舎の調教と実戦）。2 歳の放牧も育成として同じ速さで育つ。
 * 乱数は使わない（毎週千頭を超える幼駒の数だけ主乱数が進み、世界の以降がすべてずれる）。
 */
export const NURSERY_RATE = 0.0094;
export const NURSERY_CAP = 0.9;

export function nurseryWeek(horse, { fx = NO_EFFECT } = {}) {
  const step = NURSERY_RATE * fx.youthMul;
  for (const a of ABILITIES) {
    const room = horse.pot[a] * NURSERY_CAP - horse.cur[a];
    if (room > 0) horse.cur[a] = clamp01(horse.cur[a] + Math.min(room, horse.pot[a] * step));
  }
}

/**
 * 1 歳の week 週に世界の外から来た馬（海外セールで買ったときに作る 1 歳）が、向こうの育成で届いている割合。
 * 生まれたときの割合（0.16〜0.26）の真ん中から、施設の無い牧場の速さで育ったものとする。
 */
export const nurseryReach = (week) => Math.min(NURSERY_CAP, 0.21 + Math.max(0, week - 1) * NURSERY_RATE);

/**
 * 古いセーブ（育成の無かった世界）の 1 歳と、ゲームの中で育った 2 歳に、受けていなかった育成を足す。
 * セーブは馬そのものを持つので、育成を足しても昔の幼駒は 2 割のまま 2 歳になる（落とし穴 60 と同じ型）。
 * 1 歳はその週までの育成に揃え、2 歳は 1 歳の 1 年ぶんを足す（調教で伸びたぶんはそのまま上に乗る）。
 * 開始年の 2 歳（紙の戦績で 8 割から始まった世代）より後に生まれた馬だけ。足すのは一度だけ（world.nursery）。
 */
export function healNursery(world) {
  if (world.nursery) return;
  world.nursery = 1;
  const year1 = NURSERY_RATE * WEEKS_PER_YEAR;
  for (const h of world.horses.values()) {
    if (h.dead || h.retired) continue;
    const age = world.year - h.birthYear;
    if (age === 1) {
      const reach = nurseryReach(world.week);
      for (const a of ABILITIES) h.cur[a] = Math.max(h.cur[a], clamp01(h.pot[a] * reach));
    } else if (age === 2 && h.birthYear >= world.startYear - 1) {
      for (const a of ABILITIES) h.cur[a] = Math.min(h.pot[a], h.cur[a] + h.pot[a] * year1);
    }
  }
}

/**
 * 放牧中の 1 週。疲労が抜ける。
 * 2 歳までは放牧も育成（乗り込み）なので育成の速さで育つ。3〜4 歳は体が出来るぶん少しだけ近づく。
 */
export function pastureWeek(horse, rng, { year, fx = NO_EFFECT }) {
  const age = horseAge(horse, year);
  horse.fatigue = clamp01(horse.fatigue - 0.16 * rng.range(0.8, 1.2) * fx.pastureMul);
  if (age <= 2) nurseryWeek(horse, { fx });
  else if (age <= 4) {
    const base = 0.0022 * clamp01((8 - age) / 6) * fx.youthMul;
    for (const a of ABILITIES) {
      const room = horse.pot[a] - horse.cur[a];
      if (room > 0) horse.cur[a] = clamp01(horse.cur[a] + Math.min(room, base * rng.range(0.5, 1.5)));
    }
  }
}

/**
 * NPC（他の馬主）の調教方針。疲れている馬は休ませ、ほかは乗り込む、という程度の判断。
 */
export function autoMenu(horse, rng) {
  if (horse.fatigue > 0.58) return 'rest';
  // 疲れ気味なら脚に優しいメニュー。強めを選ばせると疲労が抜けないまま積み上がり、使えない馬になる。
  if (horse.fatigue > 0.36) return rng.chance(0.5) ? 'pool' : 'light';
  return rng.weighted(['normal', 'hard', 'slope', 'wood', 'track', 'light'], [5, 1, 3, 3, 2, 1]);
}

export function condLabel(cond) {
  if (cond >= 0.8) return '◎';
  if (cond >= 0.65) return '○';
  if (cond >= 0.45) return '△';
  return '▲';
}

/** 出走に適した状態か（UI の注意表示用）。 */
export function readyToRun(horse) {
  if (horse.injury) return { ok: false, why: `${horse.injury.name}（残り${horse.injury.weeks}週）` };
  if (horse.stable !== 'stable') return { ok: false, why: '放牧中（入厩が必要）' };
  if (horse.fatigue > 0.72) return { ok: false, why: '疲労が深い' };
  return { ok: true, why: '' };
}
