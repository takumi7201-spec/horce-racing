// 馬具（メンコ・シャドーロール・ブリンカー・チークピーシーズ・バンテージ）。
//
// 実際の競馬では、気性や癖を補うために付ける。効き目はどれも小さく、気性（temper）の悪い馬ほど効く：
// - メンコ（耳覆い）：音に驚かない。ゲートの出遅れが減る。
// - シャドーロール（鼻革のボア）：足元の影や物を見て驚かない。頭が下がって走りに集中する。出遅れと掛かりが少し減る。
// - ブリンカー（目の横を覆う覆面）：後ろや横が見えず前だけを見る。掛かりが減り、追ってからの集中が増す。
// - チークピーシーズ（頬革のボア）：ブリンカーの弱いもの。
// - バンテージ（脚に巻く包帯）：脚を守る。故障の起きやすさが少し下がる。
//
// 世界の乱数を使わない：NPC の馬具は馬 id のハッシュと気性から決める（`gearOf`）。保存するのはプレイヤーが決めた馬具だけ
// （`horse.gear`。無い馬は毎回 id から導く）。効き目は気性に足す量で表し、レースの計算（race.js）が `gearEffect` を読む。
// カード育成モードの馬は馬具を持たない（race.js は gear の無い馬では何も変えない。Godot の race_sim.gd と結果が一致したまま）。

import { clamp01 } from '../core/util.js';

/** 馬具の定義。color は既定の色（メンコとシャドーロールは色を選べる）。 */
export const GEAR = {
  menko: { name: 'メンコ', short: 'メ', desc: '耳を覆って音に驚かないようにする。ゲートの出遅れが減る' },
  shadowRoll: { name: 'シャドーロール', short: 'シ', desc: '鼻革のボアで足元が見えず、驚かない。出遅れと掛かりが少し減る' },
  blinker: { name: 'ブリンカー', short: 'ブ', desc: '目の横を覆って前だけを見せる。掛かりが減り、追ってから集中する' },
  cheek: { name: 'チークピーシーズ', short: 'チ', desc: '頬革のボア。ブリンカーの弱いもの' },
  bandage: { name: 'バンテージ', short: 'バ', desc: '脚に巻いて守る。故障が少し起きにくくなる' },
};
export const GEAR_KEYS = Object.keys(GEAR);

/** メンコ・シャドーロールの色の候補（厩舎の色）。 */
export const GEAR_COLORS = ['#f4f2ec', '#1f3f9e', '#c8202a', '#1c1c1c', '#e8b21a', '#2f8f4a', '#e86aa0', '#7a4fc0', '#f07a28', '#5fb6e0'];

function hash01(id, salt) {
  let h = (Math.imul((id | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2f) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * NPC の馬具（馬 id と気性から）。日本の競走馬はメンコを付ける馬が多く（3〜4 割）、
 * 気性の悪い馬はブリンカー・シャドーロールを付けやすい。
 */
export function npcGear(h) {
  const t = h.temper ?? 0.5;
  const bad = clamp01((0.55 - t) * 2.5);          // 0（素直）〜1（気性難）
  const g = {};
  if (hash01(h.id, 1) < 0.32 + 0.25 * bad) g.menko = GEAR_COLORS[Math.floor(hash01(h.id, 2) * GEAR_COLORS.length)];
  if (hash01(h.id, 3) < 0.06 + 0.3 * bad) g.shadowRoll = hash01(h.id, 4) < 0.8 ? GEAR_COLORS[0] : GEAR_COLORS[Math.floor(hash01(h.id, 5) * GEAR_COLORS.length)];
  if (hash01(h.id, 6) < 0.03 + 0.35 * bad) g.blinker = true;
  else if (hash01(h.id, 7) < 0.02 + 0.12 * bad) g.cheek = true;
  if (hash01(h.id, 8) < 0.35) g.bandage = true;
  return g;
}

/** その馬の馬具。プレイヤーが決めた馬具があればそれ、無ければ id から導く。 */
export const gearOf = (h) => (h ? h.gear ?? npcGear(h) : {});

/**
 * 馬具の効き目。気性に足す量（start＝ゲート、pull＝道中の掛かり）、追ってからの集中（focus）、故障の起きやすさの掛け算（injury）。
 * 気性の良い馬にはほとんど効かない（直す癖が無い）。
 */
export function gearEffect(gear, temper = 0.5) {
  const need = clamp01((0.6 - temper) * 2);       // 気性が悪いほど効く
  let start = 0, pull = 0, focus = 0, injury = 1;
  if (!gear) return { start, pull, focus, injury };
  if (gear.menko) start += 0.08 * need + 0.02;
  if (gear.shadowRoll) { start += 0.03 * need; pull += 0.05 * need; }
  if (gear.blinker) { pull += 0.10 * need; focus += 0.012 * need; }
  else if (gear.cheek) { pull += 0.05 * need; focus += 0.005 * need; }
  if (gear.bandage) injury = 0.85;
  return { start, pull, focus, injury };
}

/** 馬具を決める（プレイヤーの馬だけ）。空の馬具も「付けない」と決めたものとして持つ。 */
export function setGear(h, gear) {
  const g = {};
  for (const k of GEAR_KEYS) if (gear?.[k]) g[k] = gear[k];
  if (g.blinker && g.cheek) delete g.cheek;      // ブリンカーとチークピーシーズは重ねない
  h.gear = g;
  return g;
}

/** 画面用：付けている馬具の名前。 */
export const gearNames = (gear) => GEAR_KEYS.filter((k) => gear?.[k]).map((k) => GEAR[k].name);
