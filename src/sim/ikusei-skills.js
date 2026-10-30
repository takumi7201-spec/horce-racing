// 育成モードのスキル。カードごとの差を「数字の大小」だけでなく「効く場面」で出す。
//
// - レーススキル：育てる馬（と完成馬）がレースで使う。条件（芝・距離帯・馬場・GI・脚質…）が合うと能力が上がる。
// - サポートスキル：サポートに入れたカードが練習で効かせる（伸び・友情・体力・失敗率・来やすさ・気分）。
// - 固有スキル：LM だけが持つ、その馬の看板（二つ名）の名前のスキル。得意な馬場と距離で大きく効く。
//
// スキルはカードの値（適性・脚質・勝鞍・レア度）から決める。保存しない（同じカードはいつも同じスキル）。
// 効き目は能力に足す量で 0.01〜0.03（レースの能力は 0.36〜0.92）。大きくすると格下が一方的に勝って
// 着差が開く（落とし穴 8）。レア度で効き目を掛ける（LM 1.5〜N 0.6）。数もレア度で変える。

import { distCatOf, styleOf } from './ikusei-util.js';

const STATS = ['speed', 'stamina', 'power', 'guts', 'wit'];
const LABEL = { speed: 'スピード', stamina: 'スタミナ', power: 'パワー', guts: '根性', wit: '賢さ' };
const RAR_SCALE = { LM: 1.5, SSR: 1.25, SR: 1.0, R: 0.8, N: 0.6 };
const HEAVY = new Set(['重', '不良']);

/**
 * レーススキルの定義。when(race, ctx) が真なら発動し、add を能力に足す（style は脚質を寄せる）。
 * ctx.battle はランク戦・完成馬どうしの対戦。
 */
const RACE = {
  turf: { name: '芝の申し子', desc: '芝のレースでスピード・パワーが上がる', when: (r) => r.surface === '芝', add: { speed: 0.018, power: 0.008 } },
  dirt: { name: '砂の王', desc: 'ダートのレースでパワー・スピードが上がる', when: (r) => r.surface === 'ダート', add: { power: 0.02, speed: 0.008 } },
  sprint: { name: '快速', desc: '1400m 以下でスピードが大きく上がる', when: (r) => r.distance <= 1400, add: { speed: 0.025 } },
  mile: { name: 'マイルの鬼', desc: '1401〜1800m でスピード・賢さが上がる', when: (r) => r.distance > 1400 && r.distance <= 1800, add: { speed: 0.016, wit: 0.012 } },
  middle: { name: '王道', desc: '1801〜2400m でスタミナ・根性が上がる', when: (r) => r.distance > 1800 && r.distance <= 2400, add: { stamina: 0.016, guts: 0.012 } },
  stayer: { name: '長距離砲', desc: '2401m 以上でスタミナが大きく上がる', when: (r) => r.distance > 2400, add: { stamina: 0.03 } },
  front: { name: '逃げ切り', desc: 'いつもハナを切り、スピードが上がる', when: () => true, add: { speed: 0.01 }, style: 0.04 },
  closer: { name: '末脚炸裂', desc: '後方から構え、根性が大きく上がる', when: () => true, add: { guts: 0.022 }, style: 0.86 },
  heavy: { name: '道悪巧者', desc: '重・不良の馬場でパワーが上がり、道悪を苦にしない', when: (r) => HEAVY.has(r.ground), add: { power: 0.022 }, soft: 0.9 },
  big: { name: '大舞台', desc: 'GI ですべての能力が上がる', when: (r) => r.grade === 'GI', add: { speed: 0.01, stamina: 0.01, power: 0.01, guts: 0.01, wit: 0.01 } },
  duel: { name: '勝負師', desc: '対戦（ランク戦・完成馬どうし）ですべての能力が上がる', when: (r, ctx) => !!ctx.battle, add: { speed: 0.008, stamina: 0.008, power: 0.008, guts: 0.008, wit: 0.008 } },
  calm: { name: '冷静沈着', desc: 'いつも賢さが上がる', when: () => true, add: { wit: 0.02 } },
  grit: { name: '叩き合い', desc: 'いつも根性が上がる', when: () => true, add: { guts: 0.02 } },
};

/** サポートスキルの定義（練習で、その馬が来ている練習にだけ効く）。 */
const SUPPORT = {
  ...Object.fromEntries(STATS.map((k) => [`tr_${k}`, { name: `${LABEL[k]}練習上手`, desc: `${LABEL[k]}の練習に来ると伸びが 2 割増える`, kind: k }])),
  friend: { name: '友情の絆', desc: '友情練習の伸びがさらに大きくなる' },
  saver: { name: '疲れ知らず', desc: '一緒の練習の体力の消費が 5 減る' },
  safe: { name: '安全第一', desc: '一緒の練習の失敗率が半分になる' },
  often: { name: '練習の虫', desc: '練習場によく顔を出す' },
  mood: { name: '盛り上げ役', desc: '一緒に練習すると気分が上がりやすい' },
};

const hash = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h; };

/**
 * カードのスキル。{ race: [id], support: [id], unique: {name, desc} | null }。
 * 数はレア度で決まる（LM 固有＋レース 3＋サポート 3、SSR 2＋2、SR 1＋2、R・N 1＋1）。
 */
export function skillsOf(card) {
  const race = [];
  const push = (id) => { if (id && !race.includes(id)) race.push(id); };
  // 得意から順に候補を並べ、レア度の数だけ取る
  const cands = [];
  if (card.turf >= 0.85 && card.turf > card.dirt) cands.push('turf');
  if (card.dirt >= 0.85 && card.dirt > card.turf) cands.push('dirt');
  cands.push({ 短距離: 'sprint', マイル: 'mile', 中距離: 'middle', 長距離: 'stayer' }[distCatOf(card.dist)]);
  const st = styleOf(card.style);
  if (st === '逃げ') cands.push('front');
  if (st === '追込' || st === '差し') cands.push('closer');
  if (card.soft >= 0.7) cands.push('heavy');
  if ((card.gi ?? 0) >= 3) cands.push('big');
  // 残りは得意な能力から
  const best = [...STATS].sort((a, b) => card.v[b] - card.v[a])[0];
  cands.push(best === 'wit' ? 'calm' : best === 'guts' ? 'grit' : 'duel', 'grit', 'calm');
  const nRace = { LM: 3, SSR: 2, SR: 1, R: 1, N: 1 }[card.rar] ?? 1;
  for (const id of cands) { if (race.length >= nRace) break; push(id); }

  const support = [`tr_${best}`];
  const extra = ['friend', 'saver', 'safe', 'often', 'mood'];
  const nSup = { LM: 3, SSR: 2, SR: 2, R: 1, N: 1 }[card.rar] ?? 1;
  // 2 つめはカードの id から（同じレア度でも顔ぶれが違うように）
  for (let i = 1; i < nSup; i++) support.push(extra.filter((x) => !support.includes(x))[hash(`${card.id}:${i}`) % (extra.length - i + 1)]);
  // R と N は 1 つだけなので、得意の練習でなく id から決めるカードも混ぜる（同じ能力のカードばかりにならないように）
  if (nSup === 1 && hash(card.id) % 3 === 0) support[0] = extra[hash(`${card.id}:s`) % extra.length];

  const unique = card.rar === 'LM' ? {
    name: card.epithet ?? `${card.name}の真髄`,
    desc: `${card.turf >= card.dirt ? '芝' : 'ダート'}の${distCatOf(card.dist)}（±400m）ですべての能力が大きく上がる`,
  } : null;
  return { race, support, unique };
}

/** スキルの名前と説明（画面用）。'u:<カードid>' は固有。 */
export function skillInfo(id) {
  if (RACE[id]) return { id, type: 'race', name: RACE[id].name, desc: RACE[id].desc };
  if (SUPPORT[id]) return { id, type: 'support', name: SUPPORT[id].name, desc: SUPPORT[id].desc };
  return null;
}
export const raceSkillDefs = RACE;
export const supportSkillDefs = SUPPORT;

/**
 * レーススキルを馬（runRace に渡す形）に効かせる。発動したスキルの名前を返す。
 * skills はレーススキルの id の並び。uniqueOf は固有を持つカード（LM）か null。
 */
export function applyRaceSkills(spec, skills, race, { battle = false, rar = 'N', uniqueOf = null } = {}) {
  const s = { ...spec, ab: { ...spec.ab } };
  const fired = [];
  const k = RAR_SCALE[rar] ?? 1;
  for (const id of skills) {
    const d = RACE[id];
    if (!d || !d.when(race, { battle })) continue;
    for (const [a, v] of Object.entries(d.add)) s.ab[a] = Math.min(0.95, s.ab[a] + v * k);
    if (d.style != null) s.style = d.style;
    if (d.soft != null) s.soft = Math.max(s.soft ?? 0.5, d.soft);
    fired.push(d.name);
  }
  if (uniqueOf) {
    const surf = uniqueOf.turf >= uniqueOf.dirt ? '芝' : 'ダート';
    if (race.surface === surf && Math.abs(race.distance - uniqueOf.dist) <= 400) {
      for (const a of STATS) s.ab[a] = Math.min(0.95, s.ab[a] + 0.022);
      fired.push(uniqueOf.epithet ?? `${uniqueOf.name}の真髄`);
    }
  }
  return { spec: s, fired };
}

export { RAR_SCALE };
