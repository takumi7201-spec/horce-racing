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

/**
 * 覚醒（同じカードを重ねて持つ利点）。覚醒＝min(4, 枚数−1)。カードを消費しない（持っている枚数で決まる）。
 * 育てる馬：初期値 +12/段、伸びしろの上限 +30/段（1200 で頭打ちなので、+値の低いカード＝N・R ほど効く）、
 *   レーススキルの効き目 +8%/段、覚醒 2 でレーススキル +1。
 * サポート：友情練習の伸び +6%/段、練習場に来ない確率 −3%/段、覚醒 3 で友情 1 回でスキルを覚える、覚醒 4 でサポートスキル +1。
 */
export const AWAKEN = { max: 4, init: 12, cap: 30, skill: 0.08, friend: 0.06, show: 0.03, bondAt: 3 };
export const awakenOf = (count) => Math.max(0, Math.min(AWAKEN.max, (count ?? 0) - 1));

const hash = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h; };

/**
 * カードのスキル。{ race: [id], support: [id], unique: {name, desc} | null }。
 * 数はレア度で決まる（LM 固有＋レース 3＋サポート 3、SSR 2＋2、SR 1＋2、R・N 1＋1）。
 */
export function skillsOf(card, awaken = 0) {
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
  // 覚醒 2 からレーススキルが 1 つ増える（同じカードを重ねて持つ利点）
  const nRace = ({ LM: 3, SSR: 2, SR: 1, R: 1, N: 1 }[card.rar] ?? 1) + (awaken >= 2 ? 1 : 0);
  for (const id of cands) { if (race.length >= nRace) break; push(id); }

  const support = [`tr_${best}`];
  const extra = ['friend', 'saver', 'safe', 'often', 'mood'];
  // 覚醒 4（完凸）でサポートスキルが 1 つ増える
  const nSup = ({ LM: 3, SSR: 2, SR: 2, R: 1, N: 1 }[card.rar] ?? 1) + (awaken >= 4 ? 1 : 0);
  // 2 つめはカードの id から（同じレア度でも顔ぶれが違うように）
  for (let i = 1; i < nSup; i++) support.push(extra.filter((x) => !support.includes(x))[hash(`${card.id}:${i}`) % (extra.length - i + 1)]);
  // R と N は 1 つだけなので、得意の練習でなく id から決めるカードも混ぜる（同じ能力のカードばかりにならないように）
  if ((card.rar === 'R' || card.rar === 'N') && hash(card.id) % 3 === 0) support[0] = extra[hash(`${card.id}:s`) % extra.length];

  const unique = card.rar === 'LM' ? {
    name: card.epithet ?? `${card.name}の真髄`,
    desc: `${card.turf >= card.dirt ? '芝' : 'ダート'}の${distCatOf(card.dist)}（±400m）ですべての能力が大きく上がる`,
  } : null;
  return { race, support, unique };
}

/**
 * 固有スキルの発動のエフェクト（観戦の 3D とカットイン、カードエディットの絵）。見た目だけでレースには効かない。
 * color は主の色、glow は光の色、core は芯の白。描き方は render3d/skillfx.js。並びを変えるとカードの既定が変わる（末尾に足す）。
 */
export const SKILL_FX = {
  radiance: { name: '金色の光', color: '#ffd54a', glow: '#ffa318', core: '#fff7d0' },
  // イナズマ：アニメ調の稲妻（アクアの縁・暗い青緑の中抜き）。deep は帯の中、hit は着弾点の黄緑
  thunder: { name: 'イナズマ', color: '#5ff6ee', glow: '#16b4c8', core: '#ecfffd', deep: '#0b4652', hit: '#a8ff5c' },
  flame: { name: '燃えるオーラ', color: '#ff8a1e', glow: '#ff3a12', core: '#fff0a0' },
  frost: { name: '氷結', color: '#a8f2ff', glow: '#3aa8ff', core: '#ffffff' },
  sakura: { name: '桜吹雪', color: '#ffb6d2', glow: '#ff5f9e', core: '#fff2f8' },
  gale: { name: '疾風', color: '#6ff0bf', glow: '#14a978', core: '#f4fffb' },
  shadow: { name: '漆黒のオーラ', color: '#b45cff', glow: '#5b10b8', core: '#f0d8ff' },
  star: { name: '星屑', color: '#d2c6ff', glow: '#5868ff', core: '#ffffff' },
  // 流星：宇宙のエネルギーの彗星（桃色の頭・紫から青紫へ消える尾）。deep は尾の先と星の青
  comet: { name: '流星', color: '#f45cff', glow: '#8a4bff', core: '#fff0ff', deep: '#4f5bff' },
};
export const SKILL_FX_KEYS = Object.keys(SKILL_FX);
// id のハッシュで選ぶ既定は、はじめの 8 種の中から（種類を足すたびに割る数が変わると、手で決めていないカードの既定が全部入れ替わる）
const HASH_FX = SKILL_FX_KEYS.slice(0, 8);
// 二つ名や毛色に合うものは手で決める（閃光はイナズマ、真夜中・南十字は星屑、黄金は金色の光…）。ほかは id から
const FX_OF = {
  'P4-03': 'thunder', 'P2-17': 'thunder', 'P4-06': 'star', 'P4-10': 'star', 'P4-09': 'radiance', 'P2-40': 'radiance',
  'EV-02': 'shadow', 'P1-40': 'flame', 'P1-17': 'flame', 'P4-02': 'gale', 'P2-10': 'gale', 'P4-01': 'sakura', 'P1-15': 'sakura',
  'EV-01': 'frost', 'P4-08': 'frost', 'EV-03': 'radiance',
  // 一度も背を見せず＝誰も追いつけない流れ星
  'P4-07': 'comet',
};
/** カード（LM）の固有スキルのエフェクト。カードの fx、手で決めた表、id のハッシュの順。LM でなければ null。 */
export function uniqueFxOf(card) {
  if (!card || card.rar !== 'LM') return null;
  if (card.fx in SKILL_FX) return card.fx;
  return FX_OF[card.id] ?? HASH_FX[hash(`${card.id}:fx`) % HASH_FX.length];
}

/** スキルの名前と説明（画面用）。'u:<カードid>' は固有。 */
export function skillInfo(id) {
  if (RACE[id]) return { id, type: 'race', name: RACE[id].name, desc: RACE[id].desc };
  if (SUPPORT[id]) return { id, type: 'support', name: SUPPORT[id].name, desc: SUPPORT[id].desc };
  return null;
}
export const raceSkillDefs = RACE;

// 観戦の演出で、発動したスキルを見せる地点（その馬が走った距離 m）。効き目はレース全体に掛かっているが、
// 全部をゲートで一度に出すと読めないので、スキルの意味に合う場面へ散らす（逃げはスタート直後、末脚は直線、固有は最後の直線）。
const CUE = {
  front: (d) => 60,
  turf: (d) => d * 0.15, dirt: (d) => d * 0.15, heavy: (d) => d * 0.2, big: (d) => d * 0.25, duel: (d) => d * 0.25, calm: (d) => d * 0.3,
  sprint: (d) => d * 0.45, mile: (d) => d * 0.45, middle: (d) => d * 0.5, stayer: (d) => d * 0.55,
  closer: (d) => d - 550, grit: (d) => d - 250,
};
const BY_NAME = new Map(Object.entries(RACE).map(([id, v]) => [v.name, id]));
/** 発動したスキルの名前から、観戦で見せる地点と種類。名前が定義に無いもの（二つ名）は LM の固有。 */
export function skillCue(name, distance) {
  const id = BY_NAME.get(name);
  if (!id) return { id: 'unique', unique: true, at: Math.max(distance * 0.5, distance - 380) };
  return { id, unique: false, at: Math.max(40, CUE[id]?.(distance) ?? distance * 0.3) };
}
export const supportSkillDefs = SUPPORT;

/** 脚質のスキルが選んだ脚質に合うか（逃げ切りは逃げ、末脚炸裂は差し・追込）。 */
export const styleFits = (skillStyle, lock) => (skillStyle < 0.25 ? lock < 0.25 : lock >= 0.5);

/**
 * レーススキルを馬（runRace に渡す形）に効かせる。発動したスキルの名前を返す。
 * skills はレーススキルの id の並び。uniqueOf は固有を持つカード（LM）か null。
 */
export function applyRaceSkills(spec, skills, race, { battle = false, rar = 'N', uniqueOf = null, awaken = 0, lock = null } = {}) {
  const s = { ...spec, ab: { ...spec.ab } };
  const fired = [];
  // 覚醒 1 段ごとに効き目 8% 増し
  const k = (RAR_SCALE[rar] ?? 1) * (1 + AWAKEN.skill * awaken);
  for (const id of skills) {
    const d = RACE[id];
    if (!d || !d.when(race, { battle })) continue;
    // 脚質を決めた馬（自分の馬。lock は選んだ脚質の値）は、合わない脚質のスキル（逃げ切り・末脚炸裂）を使わず、脚質も書き換えない。
    // 書き換えると、先行で出したのに覚えた「逃げ切り」で逃げになった。
    if (lock != null && d.style != null && !styleFits(d.style, lock)) continue;
    for (const [a, v] of Object.entries(d.add)) s.ab[a] = Math.min(0.95, s.ab[a] + v * k);
    if (d.style != null && lock == null) s.style = d.style;
    if (d.soft != null) s.soft = Math.max(s.soft ?? 0.5, d.soft);
    fired.push(d.name);
  }
  if (uniqueOf) {
    const surf = uniqueOf.turf >= uniqueOf.dirt ? '芝' : 'ダート';
    if (race.surface === surf && Math.abs(race.distance - uniqueOf.dist) <= 400) {
      for (const a of STATS) s.ab[a] = Math.min(0.95, s.ab[a] + 0.022 * (1 + AWAKEN.skill * awaken));
      fired.push(uniqueOf.epithet ?? `${uniqueOf.name}の真髄`);
    }
  }
  return { spec: s, fired };
}

export { RAR_SCALE };
