// 配合理論。
//
// 配合には、血統の見立てで「成り立つ組み合わせ」がある。成り立った理論は仔の能力や丈夫さを
// 少しだけ後押しし、配合の評価にも名前で出る。どの理論も効果は小さく（乱数の幅 0.1 前後に対して
// 0.01 前後）、後押しの合計にも上限がある。能力だけ上がる都合のいい配合は無い。
//
//   ブラッドアップ理論     名馬の 3×4・4×3 などのクロスを入れる
//   スピード×スタミナ補完   父と母で得意な能力が逆
//   距離補完理論           父母の得意距離が離れていて、どちらも融通が利く
//   気性補完理論           落ち着いた親と激しい親
//   丈夫さ補完理論         丈夫な親と、もろい親
//   アウトクロス理論       4 系統が別々で、近交も入らない
//   実在の相性（ニックス） ノーザンダンサー系 × レイズアネイティヴ系など、実績のある系統の組み合わせ
//
// 数値は独自（ほかのゲームのものではない）。
// 配合の上乗せは平均がゼロになるように入れる（落とし穴 41）。成立しない配合から基準点を引く。

import { sireLineRoot, bmsLineRoot, inbreedings, vigorOf, breedQuality } from './pedigree.js';
import { ABILITIES } from './params.js';

/** 理論の効果の上限。重ねても、能力 1 項目あたりこれ以上は上がらない。 */
export const THEORY_CAP = 0.03;
/** 理論の平均的な上乗せ。全配合から引いて、世界全体の水準が動かないようにする。 */
export const THEORY_BASE = 0.0015;

/** 実在の相性（父系の系祖 × 母父系の系祖）。名前の一部で見る（「サンデーサイレンス」など）。 */
export const REAL_NICKS = [
  { id: 'nd_ran', name: 'ノーザンダンサー系 × レイズアネイティヴ系', sire: ['ノーザンダンサー'], bms: ['レイズアネイティヴ', 'ミスタープロスペクター'],
    text: '米国の名血の組み合わせ。スピードとパワーが出る', pot: { speed: 0.012, power: 0.010 } },
  { id: 'ss_storm', name: 'サンデーサイレンス系 × ストームキャット系', sire: ['サンデーサイレンス'], bms: ['ストームキャット'],
    text: '日本の主流とスピードの米国血統。スピードが出る', pot: { speed: 0.014, guts: 0.006 } },
  { id: 'ss_mp', name: 'サンデーサイレンス系 × ミスタープロスペクター系', sire: ['サンデーサイレンス'], bms: ['ミスタープロスペクター', 'レイズアネイティヴ'],
    text: '大物を何頭も出した組み合わせ。スピードと勝負根性', pot: { speed: 0.010, guts: 0.010 } },
  { id: 'roberto_ss', name: 'ロベルト系 × サンデーサイレンス系', sire: ['ロベルト'], bms: ['サンデーサイレンス'],
    text: 'パワーとスタミナが出る', pot: { power: 0.012, stamina: 0.010 } },
  { id: 'ss_nd', name: 'サンデーサイレンス系 × ノーザンダンサー系', sire: ['サンデーサイレンス'], bms: ['ノーザンダンサー'],
    text: '欧州のスタミナを足す。距離が持つ', pot: { stamina: 0.012, wit: 0.006 } },
  { id: 'htr_nd', name: 'ヘイルトゥリーズン系 × ノーザンダンサー系', sire: ['ヘイルトゥリーズン', 'ヘイロー'], bms: ['ノーザンダンサー'],
    text: '大きな仔が出やすい。パワーとスタミナ', pot: { power: 0.010, stamina: 0.008 } },
  { id: 'nas_nd', name: 'ナスルーラ系 × ノーザンダンサー系', sire: ['ナスルーラ', 'グレイソヴリン', 'ボールドルーラー'], bms: ['ノーザンダンサー'],
    text: '昔からの鉄板。スピードが持続する', pot: { speed: 0.008, stamina: 0.008 } },
];

const lineName = (world, id) => (id != null ? world.horses.get(id)?.name ?? '' : '');
const hits = (name, words) => words.some((w) => name.includes(w));

/**
 * 成立している理論の一覧。
 * @returns {{id:string,name:string,text:string,pot:object,extra:object}[]}
 */
export function evaluateTheories(world, sire, dam, { ib: ibIn = null, vg: vgIn = null } = {}) {
  const out = [];
  const add = (id, name, text, effect = {}) => out.push({ id, name, text, pot: effect.pot ?? {}, extra: effect.extra ?? {} });

  // ブラッドアップ：名馬（GI 勝ち・系祖・実在の名馬）の近いクロス。
  const ib = ibIn ?? inbreedings(world, sire.id, dam.id);
  const star = ib.find((x) => ['3×4', '4×3'].includes(x.label) && (() => {
    const h = world.horses.get(x.id);
    return h && ((h.g1Wins ?? 0) >= 1 || h.lineHead || x.quality >= 0.82);
  })());
  if (star) {
    add('bloodup', 'ブラッドアップ理論', `${star.name} の ${star.label} が入る。名馬の血を濃くする`,
      { pot: { speed: 0.008, power: 0.008, guts: 0.008 } });
  }

  // スピード×スタミナ補完：父がスピード寄り・母がスタミナ寄り（またはその逆）。
  const lean = (h) => h.pot.speed - h.pot.stamina;
  if (Math.abs(lean(sire)) >= 0.07 && Math.abs(lean(dam)) >= 0.07 && Math.sign(lean(sire)) !== Math.sign(lean(dam))) {
    add('complement', 'スピード×スタミナ補完', '父と母で得意な能力が逆。互いの弱みを埋める',
      { pot: { speed: 0.008, stamina: 0.008 } });
  }

  // 距離補完：得意距離が離れていて（500〜1000m）、どちらも融通が利く。
  const gap = Math.abs(sire.dist - dam.dist);
  if (gap >= 500 && gap <= 1000 && sire.distRange >= 520 && dam.distRange >= 520) {
    add('bridge', '距離補完理論', '得意距離が離れた父母。どちらも融通が利くので、守備範囲の広い仔が出る',
      { extra: { distRange: 90 } });
  }

  // 気性・丈夫さの補完。
  if ((sire.temper >= 0.65 && dam.temper <= 0.4) || (dam.temper >= 0.65 && sire.temper <= 0.4)) {
    add('calm', '気性補完理論', '落ち着いた親と激しい親。気性が穏やかな側に寄る', { extra: { temper: 0.06 } });
  }
  if ((sire.sound >= 0.7 && dam.sound <= 0.45) || (dam.sound >= 0.7 && sire.sound <= 0.45)) {
    add('sturdy', '丈夫さ補完理論', '丈夫な親がもろい親を支える。故障に強い仔が出やすい', { extra: { sound: 0.06 } });
  }

  // アウトクロス：4 系統が別々で、近交も入らない。
  const vg = vgIn ?? vigorOf(world, sire.id, dam.id);
  if (vg.lines === 4 && vg.label.startsWith('4') && ib.length === 0 && breedQuality(sire) >= 0.55 && breedQuality(dam) >= 0.45) {
    add('outcross', 'アウトクロス理論', '4 系統が別々で近交も入らない。雑種強勢で全体が底上げされる',
      { pot: Object.fromEntries(ABILITIES.map((a) => [a, 0.005])) });
  }

  // 実在の相性。
  const sireRoot = lineName(world, sireLineRoot(world, sire.id));
  const bmsRoot = lineName(world, bmsLineRoot(world, { damId: dam.id }));
  const damSireRoot = lineName(world, dam.sireId != null ? sireLineRoot(world, dam.sireId) : null);
  for (const n of REAL_NICKS) {
    if (hits(sireRoot, n.sire) && (hits(damSireRoot, n.bms) || hits(bmsRoot, n.bms))) {
      add(`nick_${n.id}`, n.name, n.text, { pot: n.pot });
      break;     // 実在の相性は 1 つだけ（重ねない）
    }
  }
  return out;
}

/** 理論の効果をまとめる。能力 1 項目あたり THEORY_CAP までで頭打ち。 */
export function theoryEffect(list) {
  const pot = {};
  const extra = {};
  for (const t of list) {
    for (const [a, v] of Object.entries(t.pot)) pot[a] = Math.min(THEORY_CAP, (pot[a] ?? 0) + v);
    for (const [k, v] of Object.entries(t.extra)) extra[k] = (extra[k] ?? 0) + v;
  }
  return { pot, extra };
}

/** 画面の「配合理論の一覧」用。 */
export const THEORY_GUIDE = [
  { name: 'ブラッドアップ理論', text: '名馬（GI 勝ち馬・系祖）の 3×4・4×3 などのクロスが入る。スピード・パワー・勝負根性が少し上がる' },
  { name: 'スピード×スタミナ補完', text: '父がスピード寄りで母がスタミナ寄り（またはその逆）。スピードとスタミナが少し上がる' },
  { name: '距離補完理論', text: '父母の得意距離が 500〜1000m 離れていて、どちらも融通が利く。仔の守備範囲が広がる' },
  { name: '気性補完理論', text: '落ち着いた親と激しい親。気性が穏やかな側に寄る' },
  { name: '丈夫さ補完理論', text: '丈夫な親ともろい親。丈夫さが持ち上がる' },
  { name: 'アウトクロス理論', text: '4 系統が別々で近交も入らない。能力が全体に少し上がる' },
  ...REAL_NICKS.map((n) => ({ name: n.name, text: `実在の相性。${n.text}` })),
];

/** 理論の id → 名前（馬の詳細に「この仔に成立した理論」を出すため）。 */
const NAMES = new Map([
  ['bloodup', 'ブラッドアップ理論'], ['complement', 'スピード×スタミナ補完'], ['bridge', '距離補完理論'],
  ['calm', '気性補完理論'], ['sturdy', '丈夫さ補完理論'], ['outcross', 'アウトクロス理論'],
  ...REAL_NICKS.map((n) => [`nick_${n.id}`, n.name]),
]);
export const theoryName = (id) => NAMES.get(id) ?? id;
