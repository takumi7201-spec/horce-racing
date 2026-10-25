// 調教。
//
// 「仕上がり（fit）を上げる」「能力の現在値を潜在値へ近づける」「疲労を溜める」
// の三つを同時に動かす。強い調教は速く仕上がるが故障を呼ぶ。
// レースに出すのは仕上がり 0.75 以上が目安。

import { ABILITIES } from './params.js';
import { clamp01, lerp } from '../core/util.js';
import { rollInjury, horseAge } from './horse.js';
import { trainerBonus } from './jockey.js';
import { NO_EFFECT } from './facilities.js';

/**
 * 調教メニュー。
 * fit    仕上がりの伸び
 * load   疲労の増え方
 * risk   故障の上乗せ
 * grow   潜在能力に近づく速さ
 * focus  伸びやすい能力（null なら均等）
 */
export const MENUS = [
  { id: 'rest', name: '休養', fit: -0.04, load: -0.14, risk: 0, grow: 0, focus: null,
    desc: '疲れを抜く。仕上がりは落ちる' },
  { id: 'light', name: '軽め', fit: 0.05, load: 0.02, risk: 0, grow: 0.3, focus: null,
    desc: '維持。疲労はほとんど溜まらない' },
  { id: 'normal', name: '普通', fit: 0.11, load: 0.07, risk: 0.002, grow: 0.8, focus: null,
    desc: '標準的な乗り込み' },
  { id: 'hard', name: '強め', fit: 0.17, load: 0.14, risk: 0.006, grow: 1.2, focus: null,
    desc: '一気に仕上がるが疲れる' },
  { id: 'slope', name: '坂路', fit: 0.13, load: 0.11, risk: 0.004, grow: 1.1, focus: 'power',
    desc: 'パワーと勝負根性が伸びる' },
  { id: 'wood', name: 'ウッドチップ', fit: 0.12, load: 0.08, risk: 0.002, grow: 1.0, focus: 'stamina',
    desc: 'スタミナ中心。脚元に優しい' },
  { id: 'track', name: 'コース追い', fit: 0.15, load: 0.12, risk: 0.005, grow: 1.1, focus: 'speed',
    desc: 'スピードを磨く。実戦に近い' },
  { id: 'pool', name: 'プール', fit: 0.06, load: -0.02, risk: -0.004, grow: 0.5, focus: 'stamina',
    desc: '脚に負担をかけずに鍛える' },
  { id: 'gate', name: 'ゲート練習', fit: 0.07, load: 0.04, risk: 0.001, grow: 0.5, focus: 'wit',
    desc: '気性と賢さを落ち着かせる' },
];
export const MENU_BY_ID = new Map(MENUS.map((m) => [m.id, m]));

/**
 * 1 週ぶんの調教を当てる。在厩馬にだけ呼ぶ。
 * @returns {{injury:object|null, grew:boolean}}
 */
export function trainWeek(horse, rng, { year, trainer, menuId = 'normal', fx = NO_EFFECT }) {
  const menu = MENU_BY_ID.get(menuId) ?? MENU_BY_ID.get('normal');
  const tb = trainerBonus(trainer);
  const age = horseAge(horse, year);

  // 疲れているときに追うと伸びない。仕上がりの伸びは疲労で削られる。
  const tired = clamp01(horse.fatigue);
  const eff = 1 - tired * 0.55;

  horse.fit = clamp01(horse.fit + menu.fit * eff * tb.fit * lerp(1.15, 0.85, clamp01((age - 2) / 6)) * (menu.fit > 0 ? fx.fitMul : 1));
  // 施設（プール）で疲れが抜ける。
  horse.fatigue = clamp01(horse.fatigue + menu.load * lerp(1.1, 0.85, horse.sound) - fx.relief);

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
  const injury = rollInjury(horse, rng, { extra: risk > 0 ? risk * (1 - fx.safety) : risk });
  return { injury, grew };
}

/**
 * 放牧中の 1 週。疲労が抜け、仕上がりは落ちる。
 * 若い馬は放牧でも体が出来るので潜在値には少し近づく。
 */
export function pastureWeek(horse, rng, { year, fx = NO_EFFECT }) {
  const age = horseAge(horse, year);
  horse.fatigue = clamp01(horse.fatigue - 0.16 * rng.range(0.8, 1.2) * fx.pastureMul);
  horse.fit = clamp01(horse.fit - 0.05);
  if (age <= 4) {
    const base = 0.0022 * clamp01((8 - age) / 6) * fx.youthMul;
    for (const a of ABILITIES) {
      const room = horse.pot[a] - horse.cur[a];
      if (room > 0) horse.cur[a] = clamp01(horse.cur[a] + Math.min(room, base * rng.range(0.5, 1.5)));
    }
  }
}

/**
 * NPC（他の馬主）の調教方針。
 * レースが近い馬は仕上げ、疲れている馬は休ませる、という程度の判断。
 */
export function autoMenu(horse, rng) {
  if (horse.fatigue > 0.58) return 'rest';
  if (horse.fit > 0.95) return 'light';
  // 疲れ気味なら、脚に優しく仕上がりだけ進むメニューを選ぶ。
  // ここで強めを選ばせると疲労が抜けないまま積み上がり、使えない馬になる。
  if (horse.fatigue > 0.36) return rng.chance(0.5) ? 'pool' : 'light';
  if (horse.fit < 0.45) return rng.chance(0.5) ? 'normal' : 'wood';
  return rng.weighted(['normal', 'hard', 'slope', 'wood', 'track'], [5, 1, 3, 3, 2]);
}

/** 仕上がりの言葉。出馬表に出す。 */
export function fitLabel(fit) {
  if (fit >= 0.95) return '絶好調';
  if (fit >= 0.85) return '仕上がり万全';
  if (fit >= 0.72) return '良好';
  if (fit >= 0.55) return '八分';
  if (fit >= 0.38) return '物足りない';
  return '未完成';
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
  if (horse.fit < 0.45) return { ok: false, why: '仕上がり不足' };
  if (horse.fatigue > 0.72) return { ok: false, why: '疲労が深い' };
  return { ok: true, why: '' };
}
