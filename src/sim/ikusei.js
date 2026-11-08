// 育成モード：ガチャで集めたカードで育成馬を作り（父のカード × 母のカードの配合。名前は自分で決める）、サポート 4 枚と組んで、2 歳・3 歳の 2 年で
// 練習とレース 10 戦をこなして競走馬を完成させる。完成馬は NPC のランク戦や、自分の完成馬どうしで戦わせる。
//
// 牧場経営（world.js）とは別のモード。世界は作らず、レースの計算（race.js の simulateRace）だけを借りる。
// 乱数は Math.random を使わない（プロフィールのシード＋引いた回数・ターンから導く）。
// 状態はすべてプロフィール（JSON にそのまま書ける素の値）に持ち、画面は ikusei.js の関数だけを通す。

import { CARDS, PACKS, EVENT_PACKS } from './data/cards.js';
import { EVENTS, STAR_D } from './data/events.js';
import { TRAIN_EVENTS } from './data/train-events.js';
import { GEAR, GEAR_KEYS, GEAR_COLORS, gearNames } from './gear.js';
import { makeRng, hashSeed } from '../core/rng.js';
import { simulateRace } from './race.js';
import { GRADED } from './schedule.js';
import { createHorse, peekHorseId, resetHorseIds } from './horse.js';
import { clamp, clamp01 } from '../core/util.js';
import { skillsOf, skillInfo, applyRaceSkills, RAR_SCALE, AWAKEN, awakenOf, SKILL_FX, uniqueFxOf } from './ikusei-skills.js';
import { distCatOf } from './ikusei-util.js';
import { courseName } from './course.js';

export { skillsOf, skillInfo, AWAKEN };
/** カードの覚醒（持っている枚数から）。 */
export const awakenOfCard = (profile, id) => awakenOf(profile.cards[id]);
export { skillCue } from './ikusei-skills.js';

export { CARDS, PACKS, EVENTS, STAR_D, GEAR, GEAR_KEYS, GEAR_COLORS, gearNames };

// ---------------------------------------------------------------- 馬具（sim/gear.js）
// 実在馬のカードは、実際に付けていた馬具を `gear` に持つ（ランク戦・イベントの相手もそれで走る）。
// 育成中の馬と完成馬の馬具は自分で決める（run.gear・horse.gear）。カードの馬を育てる古い育成はカードの馬具が既定。
// 育成モードの馬は気性を持たないので、効き目は気性 0.35 の馬として測る（GEAR_TEMPER、race.js）。
export const GEAR_TEMPER = 0.35;
const cleanGear = (gear) => {
  const g = {};
  for (const k of GEAR_KEYS) if (gear?.[k]) g[k] = gear[k];
  if (g.blinker && g.cheek) delete g.cheek;
  return g;
};
/** 育成中の馬の馬具。 */
export const runGear = (run) => run.gear ?? (run.sire ? {} : cleanGear(cardById(run.trainee)?.gear));
/** 育成中の馬の馬具を決める（レースの前ならいつでも）。 */
export function setRunGear(run, gear) { run.gear = cleanGear(gear); return run.gear; }
/** 完成馬の馬具を決める。 */
export function setFinishedGear(profile, horseId, gear) {
  const h = profile.finished.find((x) => x.id === horseId);
  if (!h) throw new Error('完成馬が無い');
  h.gear = cleanGear(gear);
  return h.gear;
}
// ---------------------------------------------------------------- カードエディット（完成馬をカードにする）
// 完成馬の一枚絵の撮り方（構図・向き・脚の運び・脚ごとの角度・騎手の姿勢・背景・ゼッケン・勝負服・カメラ・二つ名）を h.art に持つ。
// 絵を撮るのは画面の側（render3d/photostage.js）。ここは値を整えて持つだけ（レースには効かない。Godot の一致にも関わらない）。
export const ART_SHOTS = ['profile', 'finish', 'charge', 'front', 'face', 'low', 'side', 'duel'];
export const ART_BACKDROPS = { sunset: '夕日', day: '晴れた昼', cloudy: '曇り', paris: '秋の曇天', desert: '砂漠' };
export const ART_POSES = { celebrate: 'ガッツポーズ', race: '追う（前傾）', canter: '返し馬（起こす）' };
export const SILK_PATTERNS = ['無地', '縦縞', '縦縞細', '輪', '一本輪', 'たすき', '十字襷', '山形', '玉', '玉霰', '元禄', '肩章', '吊り', '菱山形'];
export const SILK_SLEEVES = { body: '胴と同じ', plain: '無地', hoops: '輪', stripes: '縦縞', band: '一本輪', cuffs: '袖口', dots: '玉' };
export const LEG_KEYS = ['lf', 'rf', 'lh', 'rh'];
/**
 * リグ（カードエディットで部位を回す・動かす）。馬は部位ごとの回転のずれ（ラジアン、x 縦・y 横・z ひねり。axes が動かせる軸）、
 * 騎手は姿勢の点のずれ（m、騎手の組の座標。肘と膝は IK で付いてくる）。描くのは render3d/photostage.js（rigObject・riderPointPos）。
 */
const LEG_JP = { lf: '左前', rf: '右前', lh: '左後', rh: '右後' };
export const RIG_HORSE = {
  body: { name: '胴', axes: 'xyz' }, neck: { name: '首', axes: 'xyz' }, head: { name: '頭', axes: 'xyz' },
  earL: { name: '耳（左）', axes: 'xy' }, earR: { name: '耳（右）', axes: 'xy' }, tail: { name: '尾', axes: 'xz' }, tailFlow: { name: '尾の先', axes: 'xz' },
  ...Object.fromEntries(LEG_KEYS.flatMap((l) => [
    [`${l}.hip`, { name: `${LEG_JP[l]} 付け根`, axes: 'xz', leg: l }], [`${l}.knee`, { name: `${LEG_JP[l]} ${l[1] === 'f' ? '膝' : '飛節'}`, axes: 'x', leg: l }],
    [`${l}.fetlock`, { name: `${LEG_JP[l]} 球節`, axes: 'x', leg: l }],
  ])),
};
export const RIG_RIDER = { pelvis: '腰', neck: '肩', head: '頭', handL: '左手', handR: '右手', ankleL: '左足', ankleR: '右足' };
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const num = (x, lo, hi, d = null) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d);
/** カードの撮り方の値を整える（範囲の外・知らない値は落とす。保存する JSON を小さく保つ）。 */
export function cleanArt(a) {
  const o = {};
  if (!a || typeof a !== 'object') return o;
  if (ART_SHOTS.includes(a.shot)) o.shot = a.shot;
  if (a.facing === 'right') o.facing = 'right';
  if (num(a.phase, 0, 1) != null) o.phase = r3(num(a.phase, 0, 1));
  if (a.pose in ART_POSES) o.pose = a.pose;
  if (a.backdrop in ART_BACKDROPS) o.backdrop = a.backdrop;
  if (num(a.gate, 1, 18) != null) o.gate = Math.round(num(a.gate, 1, 18));
  if (a.wind === false) o.wind = false;
  if (a.surface === '芝' || a.surface === 'ダート') o.surface = a.surface;
  if (a.legPose && typeof a.legPose === 'object') {
    const lp = {};
    for (const k of LEG_KEYS) {
      const q = a.legPose[k];
      if (!q) continue;
      const j = {};
      for (const n of ['hip', 'knee', 'fetlock']) if (num(q[n], -2, 2) != null) j[n] = r3(num(q[n], -2, 2));
      if (Object.keys(j).length) lp[k] = j;
    }
    if (Object.keys(lp).length) o.legPose = lp;
  }
  const cam = a.camera;
  if (cam && [...(cam.pos ?? []), ...(cam.look ?? [])].length === 6 && [...cam.pos, ...cam.look].every((x) => num(x, -60, 60) != null) && num(cam.fov, 8, 70) != null) {
    o.camera = { pos: cam.pos.map(r3), look: cam.look.map(r3), fov: r3(cam.fov) };
  }
  if (a.silks && COLOR_RE.test(a.silks.body ?? '')) {
    const sk = { body: a.silks.body, accent: COLOR_RE.test(a.silks.accent ?? '') ? a.silks.accent : a.silks.body,
      pattern: SILK_PATTERNS.includes(a.silks.pattern) ? a.silks.pattern : '無地', sleeve: a.silks.sleeve in SILK_SLEEVES ? a.silks.sleeve : 'plain' };
    if (COLOR_RE.test(a.silks.cap ?? '')) sk.cap = parseInt(a.silks.cap.slice(1), 16);
    else if (Number.isInteger(a.silks.cap)) sk.cap = a.silks.cap;
    o.silks = sk;
  }
  if (typeof a.epithet === 'string' && a.epithet.trim()) o.epithet = a.epithet.trim().slice(0, 16);
  // 固有スキルのエフェクト（絵と観戦）。'none' は「付けない」と決めたもの（既定のエフェクトにも戻さない）
  if (a.fx in SKILL_FX || a.fx === 'none') o.fx = a.fx;
  // エフェクトの向き（先頭＝竜巻の細い側が向く方。粒は反対へ流れる）。無ければ馬の向き
  if (a.fxDir === 'left' || a.fxDir === 'right') o.fxDir = a.fxDir;
  // エフェクトの時間（止めた絵の時刻のずらし、0〜FX_TIME_MAX 秒）。馬の脚の運びとは別に、渦や粒の流れだけを進める。0 は持たない
  { const ft = num(a.fxT, 0, FX_TIME_MAX); if (ft) o.fxT = Math.round(ft * 100) / 100; }
  // リグ：動かせる軸だけ、回転は ±2 rad・騎手の点は ±0.6 m。0 だけの部位は持たない
  if (a.rig && typeof a.rig === 'object') {
    const pick = (src, keys, lim, axesOf) => {
      const out = {};
      for (const k of keys) {
        const d = src?.[k];
        if (!Array.isArray(d)) continue;
        const ax = axesOf(k);
        const v = ['x', 'y', 'z'].map((n, i) => (ax.includes(n) ? r3(num(d[i], -lim, lim, 0)) : 0));
        if (v.some((x) => x !== 0)) out[k] = v;
      }
      return Object.keys(out).length ? out : null;
    };
    const horse = pick(a.rig.horse, Object.keys(RIG_HORSE), 2, (k) => RIG_HORSE[k].axes);
    const rider = pick(a.rig.rider, Object.keys(RIG_RIDER), 0.6, () => 'xyz');
    if (horse || rider) o.rig = { ...(horse ? { horse } : {}), ...(rider ? { rider } : {}) };
  }
  return o;
}
/** 完成馬をカードにする（撮り方を決める）。何度でも撮り直せる。 */
export function setFinishedArt(profile, horseId, art) {
  const h = profile.finished.find((x) => x.id === horseId);
  if (!h) throw new Error('完成馬が無い');
  h.art = cleanArt(art);
  return h.art;
}
/** 完成馬の撮り方の既定（カードの馬は元のカードの撮り方、配合の馬は真横のガッツポーズ）。 */
export function defaultArt(h) {
  const c = h.cardId ? cardById(h.cardId) : null;
  return cleanArt({ shot: c?.shot ?? 'profile', facing: c?.facing, phase: c?.phase ?? 0.25, pose: c?.pose ?? 'celebrate', backdrop: c?.backdrop ?? (c?.desert ? 'desert' : 'sunset'),
    gate: c?.gate ?? 1, legPose: c?.legPose, wind: c?.wind, surface: signatureRace(h)?.surface ?? c?.surface ?? (h.turf >= h.dirt ? '芝' : 'ダート') });
}
/** 完成馬の看板のレース（いちばん格の高い勝ち鞍。勝っていなければ最後のレース）。 */
function signatureRace(h) {
  const rk = (g) => ({ GI: 5, GII: 4, GIII: 3, OP: 2 }[g] ?? 1);
  const rs = h.races ?? [];
  const wins = rs.filter((r) => r.order === 1);
  const pool = wins.length ? wins : rs;
  return pool.reduce((b, r) => (!b || rk(r.grade) > rk(b.grade) || (rk(r.grade) === rk(b.grade) && r.slot > b.slot) ? r : b), null);
}
/**
 * 完成馬のカード（カードの表で見せる形）。能力は育てた点、+値は元のカードか両親、看板は勝ち鞍、二つ名は決めたもの。
 * id は horseCard と同じ（絵の鍵が同じになり、ホームの馬・アイコンと 1 度の撮影で済む）。
 */
export function finishedCard(h) {
  const base = horseCard(h);
  const sr = signatureRace(h);
  const won = sr?.order === 1;
  const v = Object.fromEntries(STATS.map((k) => [k, abilityOf(h.stats[k])]));
  return {
    ...base, pack: 'MY', name: h.name, sex: h.sex, coat: h.coat, rar: h.rar, age: 4, v, plus: plusOf(base),
    gi: h.giWins ?? 0, graded: h.gradedWins ?? 0, travel: null, record: `${h.starts}戦${h.wins}勝`,
    race: sr ? { name: sr.name, info: `${sr.grade || '条件'}　${sr.surface}${sr.distance}m　${SLOTS[sr.slot]?.label ?? ''}${won ? '' : `　${sr.order}着`}`, year: SLOTS[sr.slot]?.label ?? '', venue: sr.surface === 'ダート' ? '砂' : '芝', won }
      : { name: h.name, info: '育成馬', year: '', venue: '芝', won: false },
    epithet: h.art?.epithet ?? base.epithet ?? null, myCard: true,
  };
}

/** 弾の名前（ガチャの弾とイベント）。 */
export const PACK_NAMES = { ...PACKS, ...EVENT_PACKS };
/** イベントの報酬だけで手に入るカード。 */
export const isEventCard = (c) => !!c && c.pack in EVENT_PACKS;
export const STATS = ['speed', 'stamina', 'power', 'guts', 'wit'];
export const STAT_LABEL = { speed: 'スピード', stamina: 'スタミナ', power: 'パワー', guts: '根性', wit: '賢さ' };
export const STAT_SHORT = { speed: 'スピ', stamina: 'スタ', power: 'パワ', guts: '根性', wit: '賢さ' };
export const RARITIES = ['LM', 'SSR', 'SR', 'R', 'N'];
const BY_ID = new Map(CARDS.map((c) => [c.id, c]));
export const cardById = (id) => BY_ID.get(id) ?? null;

// ---------------------------------------------------------------- カードの数値

/**
 * 能力の +表示（+5〜+1）。+5 の数はレア度で決まる（LM 3・SSR 3 か 2・SR 2・R と N は 1）。
 * +5 は値の高い順に付け、残りは値で +4〜+1。カードの絵（試作）と同じ規則。
 */
export function plusOf(card) {
  // 配合で作った育成馬は両親から決めた +値を持つ（bredCard）
  if (card.plus) return card.plus;
  const order = [...STATS].sort((a, b) => card.v[b] - card.v[a]);
  const top5 = { LM: 3, SSR: card.v[order[2]] >= 0.75 ? 3 : 2, SR: 2, R: 1, N: 1 }[card.rar] ?? 1;
  const out = {};
  for (const k of STATS) {
    const v = card.v[k];
    out[k] = order.indexOf(k) < top5 ? 5 : v >= 0.74 ? 4 : v >= 0.70 ? 3 : v >= 0.65 ? 2 : 1;
  }
  return out;
}
export const cardPower = (card) => STATS.reduce((s, k) => s + Math.round(card.v[k] * 100), 0);
export const distCat = distCatOf;
/** サポートとしての得意（+5 の能力のうち値のいちばん高いもの）。この練習で会うと伸びが大きい。 */
export const supportType = (card) => [...STATS].sort((a, b) => card.v[b] - card.v[a])[0];
const RAR_BONUS = { LM: 1.3, SSR: 1.2, SR: 1.1, R: 1.05, N: 1.0 };

// ---------------------------------------------------------------- プロフィール

/** 新しいプロフィール。cards は持っているカード（id → 枚数）。 */
export function newProfile(seed = 1) {
  return { v: 1, seed: typeof seed === 'number' ? seed : hashSeed(String(seed)), pulls: 0, cards: {}, finished: [], run: null, nextId: 1, battles: 0, shards: 0, coins: COIN_START, missions: [], memories: [] };
}

// ---------------------------------------------------------------- ウイコイン
//
// ガチャは 1 回 1 枚のウイコインを使う。得るのは二つだけ：
// - ミッション：カードを初めて編成（父・母・サポート）して育成を終えると、そのカード 1 枚ごとに 1 枚（カードごとに 1 度だけ）。
// - ライバルレース（rivalRace）：勝つと難易度に応じて。1 日（端末の 0:00 で切り替え）に 10 枚まで。
// 日付は sim では作らない（ブラウザと Node で同じ結果にする）。画面が端末の今日（'YYYY-MM-DD'）を渡す。

/** 新しいプロフィールのウイコイン（最初の 30 回で配合に要る牡・牝とサポートがそろう）。 */
export const COIN_START = 30;
export const coinsOf = (profile) => profile.coins ?? COIN_START;

/** 育成に編成したカード（父・母・サポート。カード 1 枚を育てた古い育成は trainee）。 */
const formedOf = (o) => [...new Set([o.sire, o.dam, o.trainee ?? o.cardId, ...(o.supports ?? [])].filter((id) => typeof id === 'string' && cardById(id)))];
/** ミッションを終えたカード。 */
export const missionsOf = (profile) => profile.missions ?? [];
/** この育成を終えたら達成になるカード（まだ達成していないもの）。 */
export const missionGain = (profile, run = profile.run) => (run ? formedOf(run).filter((id) => !missionsOf(profile).includes(id)) : []);

/**
 * ウイコインより前のプロフィールを直す。持っている完成馬の編成はミッションを終えたことにして、その数だけ配る
 * （初めから遊んでいた人が損をしない）。直し終えたら何もしない。
 */
export function migrateProfile(profile) {
  // 以前の因子メモリー（能力の点の 8%）は☆に直す（20 点で☆1 つ、1〜5）
  for (const m of profile.memories ?? []) {
    if (m.star) continue;
    m.star = Math.max(1, Math.min(5, Math.round(m.val / MEM_STEP)));
    m.val = m.star * MEM_STEP;
  }
  // 記録（通算の数・最速・最高の馬）は持っている完成馬と因子メモリーから起こす
  if (!profile.rec) recFromOld(profile);
  if (profile.coins != null && profile.missions) return profile;
  const done = [...new Set(profile.finished.flatMap(formedOf))];
  profile.missions = done;
  profile.coins = COIN_START + done.length;
  return profile;
}

// ---------------------------------------------------------------- ガチャ

/** 排出率。 */
export const RATES = { LM: 0.02, SSR: 0.06, SR: 0.15, R: 0.27, N: 0.50 };

/**
 * ガチャを n 回引く。pack は 'P1'・'P2'・'ALL'。
 * 乱数は (シード, 引いた通算回数) から 1 回ずつ作る。引く前に何を見ても結果は変わらない。
 * 1 回 1 枚のウイコインを使う（足りなければ引かない）。
 */
export function pull(profile, n = 1, pack = 'ALL') {
  if (coinsOf(profile) < n) throw new Error(`ウイコインが足りない（あと ${n - coinsOf(profile)} 枚）`);
  profile.coins = coinsOf(profile) - n;
  const got = [];
  for (let i = 0; i < n; i++) {
    const rng = makeRng(hashSeed(`gacha:${profile.seed}:${profile.pulls}`));
    profile.pulls++;
    let r = rng.next(), rar = 'N';
    for (const k of RARITIES) { if (r < RATES[k]) { rar = k; break; } r -= RATES[k]; }
    // イベントのカードはガチャに出さない（足したときに母集団が変わって、引く順番がずれないように弾の中だけで引く）
    const pool = CARDS.filter((c) => c.rar === rar && c.pack in PACKS && (pack === 'ALL' || c.pack === pack));
    const c = pool[rng.int(pool.length)];
    const isNew = !profile.cards[c.id];
    profile.cards[c.id] = (profile.cards[c.id] ?? 0) + 1;
    // 2〜5 枚目は覚醒が 1 段上がる（6 枚目からは上がらない）
    const n = profile.cards[c.id];
    got.push({ card: c, isNew, awaken: n >= 2 && n <= AWAKEN.max + 1 ? n - 1 : 0 });
  }
  return got;
}

/** 持っているカード（レア度の高い順）。 */
export function owned(profile) {
  return CARDS.filter((c) => profile.cards[c.id]).sort((a, b) => RARITIES.indexOf(a.rar) - RARITIES.indexOf(b.rar) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- かけら（余ったカードの交換）
//
// 覚醒は 5 枚（覚醒 4）で頭打ちなので、6 枚目からは持っていても何も起きない。その余りをかけらに替え、
// かけらで好きなカードを 1 枚ずつ交換できる（持っていないカード・覚醒途中のカードを狙って埋める）。
// 余りは 5 枚を超えた分だけ（覚醒を下げない）。交換で 5 枚を超えることはさせない（余りが生まれてまたかけらに戻るだけ）。
// 交換の値は引いて得る値の 10 倍前後：余りが出るほど引いた人への上乗せで、ガチャの代わりにはならない。

/** 余り 1 枚で得るかけら。 */
export const SHARD_VALUE = { LM: 60, SSR: 20, SR: 6, R: 2, N: 1 };
/** 1 枚と交換するのに要るかけら。 */
export const SHARD_COST = { LM: 600, SSR: 200, SR: 60, R: 20, N: 10 };
/** 覚醒の上限に要る枚数（これを超えた分が余り）。 */
export const KEEP = AWAKEN.max + 1;

export const shardsOf = (profile) => profile.shards ?? 0;
export const spareOf = (profile, id) => Math.max(0, (profile.cards[id] ?? 0) - KEEP);
/** 余りをまとめて替えたら得るかけら。 */
export const spareValue = (profile) => CARDS.reduce((n, c) => n + spareOf(profile, c.id) * SHARD_VALUE[c.rar], 0);

/** 余りをかけらに替える。id を省くと全部。得たかけらを返す。 */
export function shardSpare(profile, id = null) {
  let got = 0;
  for (const c of id ? [cardById(id)] : CARDS) {
    const n = spareOf(profile, c.id);
    if (!n) continue;
    profile.cards[c.id] -= n;
    got += n * SHARD_VALUE[c.rar];
  }
  profile.shards = shardsOf(profile) + got;
  return got;
}

/** かけらで 1 枚と交換できるか（できないなら理由）。 */
export function canBuyWithShards(profile, id) {
  const c = cardById(id);
  if (!c) return 'そのカードは無い';
  if (isEventCard(c)) return 'イベントの報酬でだけ手に入る';
  if ((profile.cards[id] ?? 0) >= KEEP) return 'もう覚醒 MAX';
  if (shardsOf(profile) < SHARD_COST[c.rar]) return `かけらが足りない（あと ${SHARD_COST[c.rar] - shardsOf(profile)}）`;
  return null;
}

/** かけらで 1 枚と交換する。 */
export function buyWithShards(profile, id) {
  const why = canBuyWithShards(profile, id);
  if (why) throw new Error(why);
  const c = cardById(id);
  profile.shards = shardsOf(profile) - SHARD_COST[c.rar];
  const isNew = !profile.cards[id];
  profile.cards[id] = (profile.cards[id] ?? 0) + 1;
  return { card: c, isNew, awaken: profile.cards[id] >= 2 ? profile.cards[id] - 1 : 0 };
}

// ---------------------------------------------------------------- 能力の尺度

/**
 * 練習の点（0〜1200）→ レースの能力（0..1）。1200 点で 0.92。
 * 番組の相手の強さ（RACE_LEVEL）と同じ尺度で、2 年の育成で 600〜900 点に届くと GI で戦える。
 */
// 因子メモリーの上限突破で 1200 を超えられる（PTS_MAX まで。1300 点で 0.967）
export const abilityOf = (pts) => clamp01(0.36 + (clamp(pts, 0, PTS_MAX) / 1200) * 0.56);
/** 能力の上限（点）。育てる馬のカードの +値で決まる（+5 で 1200、+1 で 720）。 */
const capOf = (plus, awaken = 0) => Math.min(1200, 600 + plus * 120 + awaken * AWAKEN.cap);
export { capOf };
/** 育成中の馬の上限（カードの +値と覚醒に、編成した因子メモリーの上乗せを足す）。 */
export const runCap = (run, k, plus = plusOf(traineeCard(run))[k]) => capOf(plus, run.awaken?.t ?? 0) + memBreak(run.mem, k);
/** 因子メモリーの上乗せ（その能力の☆×MEM_STEP の合計、MEM_BREAK まで）。上限はこのぶん突破する（1200 を超えてよい）。 */
export const memBreak = (mems, k) => Math.min(MEM_BREAK, (mems ?? []).reduce((a, m) => a + (m.stat === k ? m.val : 0), 0));
/** 点の評価（育成画面の文字）。 */
export function gradeOfPts(p) {
  const T = [[1200, 'SS+'], [1100, 'SS'], [1000, 'S+'], [900, 'S'], [800, 'A+'], [700, 'A'], [600, 'B+'], [500, 'B'], [400, 'C+'], [300, 'C'], [200, 'D'], [100, 'E'], [0, 'G']];
  return T.find(([t]) => p >= t)[1];
}

// ---------------------------------------------------------------- 育成の日程

/** 10 戦それぞれの時期。各戦の前に 3 回の練習がある（合計 40 ターン）。 */
export const SLOTS = [
  { age: 2, label: '2歳 7月', from: [6, 3], to: [8, 4], kind: 'debut' },
  { age: 2, label: '2歳 10月', from: [9, 1], to: [11, 4] },
  { age: 2, label: '2歳 12月', from: [12, 1], to: [12, 4] },
  { age: 3, label: '3歳 3月', from: [1, 1], to: [3, 4] },
  { age: 3, label: '3歳 4月', from: [4, 1], to: [4, 4] },
  { age: 3, label: '3歳 5月', from: [5, 1], to: [6, 4] },
  { age: 3, label: '3歳 8月', from: [7, 1], to: [8, 4] },
  { age: 3, label: '3歳 9月', from: [9, 1], to: [10, 2] },
  { age: 3, label: '3歳 11月', from: [10, 3], to: [11, 4] },
  { age: 3, label: '3歳 12月', from: [12, 1], to: [12, 4] },
];
export const TRAININGS_PER_RACE = 3;
export const TOTAL_TURNS = SLOTS.length * (TRAININGS_PER_RACE + 1);
const W = (m, w) => (m - 1) * 4 + w;

/** クラス（勝ち数と重賞勝ち）。条件戦は自分のクラスのものだけ、重賞は勝ち数で出られる。 */
const CLASSES = ['新馬', '未勝利', '1勝クラス', '2勝クラス', 'オープン'];
function classOf(run) {
  if (run.starts === 0) return '新馬';
  if (run.wins === 0) return '未勝利';
  return CLASSES[Math.min(4, run.wins + 1)];
}
/** 相手の能力の平均（番組の格ごと）。 */
const RACE_LEVEL = { 新馬: 0.47, 未勝利: 0.49, '1勝クラス': 0.53, '2勝クラス': 0.57, オープン: 0.60, GIII: 0.62, GII: 0.64, GI: 0.68 };

/** 条件戦を開ける場と距離（番組表にある組み合わせだけ。コースの幾何が組める）。 */
const COMBOS = [...new Map(GRADED.filter((r) => !r.abroad).map((r) => [`${r.courseId}|${r.surface}|${r.distance}`, r])).values()];

// ---------------------------------------------------------------- 目標レースとライバル
//
// 10 戦がどれも同じ重みだと育成に山場が無いので、始めるときに 2 つ決める：
// - 目標レース：3 歳で出られる GI から、育成馬の馬場と距離にいちばん合うもの（クラシックを少し優先）。勝てば評価点 GOAL_BONUS とウイコイン GOAL_COINS。
//   目標レースは 1 勝していれば出られる（ほかの GI は 2 勝か重賞勝ち）。その時期までに 1 勝できていないと出られない（目標は「届かず」で終わる）。
// - ライバル：名馬のカード（LM・SSR・SR）から 1 頭。2 歳 12 月・3 歳 5 月・目標レース・3 歳 12 月の 4 戦（重なれば 3 歳 8 月を足す）で同じレースに出てくる。
//   強さはそのレースの相手の水準＋RIVAL_EDGE に、時期ごとに伸びる（育成馬と一緒に強くなる）。最後の対決は目標レース（か 3 歳 12 月）。
// どちらも (育成のシード) だけで決め、乱数の流れに触らない（ライバルは出馬表を作った後で最後の 1 頭と入れ替える。ほかの馬の乱数は同じ）。
// 古い育成（goal・rival を持たない）はどちらも無しで動く。

export const GOAL_BONUS = 150;
export const GOAL_COINS = 3;
export const RIVAL_EDGE = 0.05;
export const RIVAL_GROW = 0.004;

/** その週が入る時期（SLOTS の番号）。 */
const slotOfWeek = (age, week) => SLOTS.findIndex((sl) => sl.age === age && week >= W(...sl.from) && week <= W(...sl.to));

/** 目標レース（3 歳で出られる GI のうち、馬場と距離がいちばん合うもの）。 */
export function goalFor(card) {
  // 3 歳 4 月までの GI（桜花賞・皐月賞）は出る条件（2 勝か重賞勝ち）を満たす前に来やすいので後回し。自動で育てた 24 頭で皐月賞が半分を占め、4 割が出られずに終わった
  const fit = (r) => Math.abs(r.distance - card.dist) / 400 + ((r.surface === 'ダート') !== (card.dirt > card.turf) ? 1.2 : 0) - (r.age[1] === 3 ? 0.15 : 0)
    + (slotOfWeek(3, r.week) <= 4 ? 0.5 : 0);
  const cand = GRADED.filter((r) => !r.abroad && r.grade === 'GI' && r.age[0] <= 3 && r.age[1] >= 3 && (!r.sex || r.sex === card.sex) && slotOfWeek(3, r.week) >= 0)
    .sort((a, b) => fit(a) - fit(b) || a.week - b.week);
  const r = cand[0];
  return r ? { id: r.id, name: r.name, slot: slotOfWeek(3, r.week), surface: r.surface, distance: r.distance, courseId: r.courseId, done: false, tried: false } : null;
}

/** ライバルと出会う時期（2 歳 12 月・3 歳 5 月・目標レース・3 歳 12 月）。 */
export function rivalMeets(goal) {
  const set = new Set([2, 5, goal?.slot ?? 7, SLOTS.length - 1]);
  if (set.size < 4) set.add(6);
  return [...set].sort((a, b) => a - b);
}

/** ライバルのカード（名馬の LM・SSR・SR から、育成馬と同じ馬場が得意な馬。両親とサポートは除く）。 */
function pickRival(card, exclude, seed) {
  const dirt = card.dirt > card.turf;
  // 距離も近い馬から（短距離のライバルが 2400m の目標レースで最下位では張り合いが無い）。近い 8 頭から選ぶ
  const pool = CARDS.filter((c) => c.pack in PACKS && ['LM', 'SSR', 'SR'].includes(c.rar) && !exclude.includes(c.id) && (c.dirt > c.turf) === dirt)
    .sort((a, b) => Math.abs(a.dist - card.dist) - Math.abs(b.dist - card.dist) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, 8);
  return pool.length ? pool[makeRng(hashSeed(`trival:${seed}`)).int(pool.length)].id : null;
}

/** この時期にライバルと走るか。 */
export const rivalMeetsNow = (run) => !!run.rival && run.rival.meets.includes(run.slot);
/** ライバルとの対戦成績（先着した数・後れを取った数）。 */
export function rivalRecord(run) {
  const log = run.rival?.log ?? [];
  return { won: log.filter((x) => x.me < x.rv).length, lost: log.filter((x) => x.me > x.rv).length, log };
}
/** 目標レースの今（'done' 勝った・'missed' 負けた・'out' 出られずに過ぎた・'now' この時期・'open' まだ先）。 */
export function goalState(run) {
  const g = run.goal;
  if (!g) return null;
  if (g.done) return 'done';
  if (g.tried) return 'missed';
  if (run.slot > g.slot) return 'out';
  return run.slot === g.slot ? 'now' : 'open';
}
/** 目標レースに出られる条件を満たしているか（1 勝していれば優先して出られる）。 */
export const goalEligible = (run) => run.wins >= 1;

/** ライバルをレースの馬の形に（強さはそのレースの水準＋RIVAL_EDGE＋時期の伸び。カードの得手不得手は残す）。 */
function rivalHorse(run, race) {
  const c = cardById(run.rival.cardId);
  const lvl = race.level + RIVAL_EDGE + RIVAL_GROW * run.slot;
  const avg = STATS.reduce((a, k) => a + c.v[k], 0) / 5;
  const ab = Object.fromEntries(STATS.map((k) => [k, clamp(lvl + (c.v[k] - avg), 0.4, 0.95)]));
  return withSkills({ id: RIVAL_HORSE_ID, name: c.name, sex: c.sex, coat: c.coat, marks: c.marks, ab, dist: c.dist, range: c.range, turf: c.turf, dirt: c.dirt,
    firm: c.firm, soft: c.soft, style: c.style, cardId: c.id, gear: cleanGear(c.gear) }, skillsOf(c).race, c.id, race, false);
}
export const RIVAL_HORSE_ID = 2e9 + 999;

/** この時期に出られるレース（重賞は勝ち数と性で、条件戦は自分のクラス）。最大 4 つ。 */
export function raceOptions(run) {
  const slot = SLOTS[run.slot];
  const card = traineeCard(run);
  const cls = classOf(run);
  const opts = [];
  if (slot.kind !== 'debut' && run.wins >= 1) {
    const lo = W(...slot.from), hi = W(...slot.to);
    const graded = GRADED.filter((r) => !r.abroad && r.week >= lo && r.week <= hi
      && slot.age >= r.age[0] && slot.age <= r.age[1] && (!r.sex || r.sex === card.sex)
      && (r.grade !== 'GI' || run.wins >= 2 || run.gradedWins >= 1));
    // 距離と馬場の合うものから
    const fit = (r) => Math.abs(r.distance - card.dist) / 400 + ((r.surface === 'ダート') !== (card.dirt > card.turf) ? 1.2 : 0)
      - ({ GI: 0.6, GII: 0.3, GIII: 0.1 }[r.grade] ?? 0);
    const top = graded.sort((a, b) => fit(a) - fit(b)).slice(0, 3);
    // 目標レースは 1 勝していれば出られる（優先出走。GI の条件の 2 勝か重賞勝ちを求めると、自動で育てた 24 頭の 4 割が出られずに終わった）。
    // 合う順の 3 つから漏れても必ず候補に入れる
    const g = run.goal && run.goal.slot === run.slot ? GRADED.find((r) => r.id === run.goal.id) : null;
    if (g && !top.includes(g)) top.unshift(g);
    for (const r of top) {
      opts.push({ id: r.id, name: r.name, grade: r.grade, courseId: r.courseId, surface: r.surface, distance: r.distance, level: RACE_LEVEL[r.grade] + (r.age[1] > 3 ? 0.02 : 0) - (slot.age === 2 ? 0.05 : 0),
        ...(run.goal?.id === r.id ? { goal: true } : {}) });
    }
  }
  // 条件戦（クラスに合わせる。オープンなら OP 特別）。距離と馬場は得意に寄せる。
  const surf = card.dirt > card.turf ? 'ダート' : '芝';
  // 2 歳は 2000m まで（長距離のカードでも 2 歳の新馬が 3200m を走らないように）。
  const maxD = slot.age === 2 ? 2000 : 9999;
  const want = Math.min(card.dist, maxD);
  const cand = COMBOS.filter((c) => c.surface === surf && c.distance <= maxD).sort((a, b) => Math.abs(a.distance - want) - Math.abs(b.distance - want));
  const rng = makeRng(hashSeed(`opts:${run.seed}:${run.slot}`));
  const pick = cand[Math.min(cand.length - 1, rng.int(Math.min(3, cand.length)))];
  const name = cls === 'オープン' ? 'オープン特別' : `${slot.age}歳${cls}`;
  opts.push({ id: `cond-${run.slot}`, name, grade: cls === 'オープン' ? 'OP' : '', courseId: pick.courseId, surface: pick.surface, distance: pick.distance, level: RACE_LEVEL[cls] - (slot.age === 2 ? 0.03 : 0) });
  // 馬場状態はこの時期のレースで共通（選ぶ前に見える。道悪のスキルを持つ馬は重い馬場の週を狙える）
  const ground = groundOf(`ground:${run.seed}:${run.slot}`);
  for (const o of opts) o.ground = ground;
  return opts;
}

/** 馬場状態（良 6 割・稍重 2 割・重 1 割強・不良 1 割弱）。主乱数ではなく鍵から決める。 */
export function groundOf(key) {
  const r = makeRng(hashSeed(key)).next();
  return r < 0.6 ? '良' : r < 0.8 ? '稍重' : r < 0.93 ? '重' : '不良';
}

// ---------------------------------------------------------------- 育成の進行

// ---------------------------------------------------------------- 配合（育成馬を作る）
//
// 育成馬は父のカード（牡）と母のカード（牝）から作る。名前は自分で決め、脚質は両親の脚質のあいだから選ぶ
// （逃げの父 × 差しの母なら 逃げ・先行・差し のどれか）。
// - 素の値（初期値）は両親の平均、伸びしろの上限（+値）は能力ごとに高いほう。得意の違う両親を組むと上限がそろう。
// - 距離・馬場の適性は平均。距離の幅は、両親の距離が離れているほど広がる。
// - レーススキルは両親のスキルを交互に受け継ぐ（多いほうの数 +1 まで）。脚質を決めるスキル（逃げ切り・末脚炸裂）は
//   選んだ脚質に合うときだけ。LM の親が居れば固有スキル（二つ名）も受け継ぐ（両親とも LM なら父の）。
// - 性と毛色は (育成のシード) から決める。覚醒は両親の覚醒の平均（切り捨て）。
// 育成馬はカードと同じ形（bredCard）で、保存するのは親の id と名前・脚質・性・毛色だけ（小数を保存しない。Godot の JSON は
// 長い小数を読み違える）。値は毎回両親から作り直す。

export const STYLE_NAMES = ['逃げ', '先行', '差し', '追込'];
const STYLE_VALUE = [0.12, 0.37, 0.62, 0.87];
const styleIdx = (x) => (x < 0.25 ? 0 : x < 0.5 ? 1 : x < 0.75 ? 2 : 3);
const r3 = (x) => Math.round(x * 1000) / 1000;
const avg3 = (a, b) => r3((a + b) / 2);
/** 編成のサポートの枚数（父・母とは別）。 */
export const SUPPORT_SLOTS = 4;
/** 名前の長さの上限。 */
export const NAME_MAX = 12;

/** 両親から選べる脚質（両親の脚質のあいだ）。 */
export function foalStyles(sire, dam) {
  const a = styleIdx(sire.style), b = styleIdx(dam.style);
  return STYLE_NAMES.slice(Math.min(a, b), Math.max(a, b) + 1);
}
/** 既定の脚質（両親のまんなか）。 */
export const foalDefaultStyle = (sire, dam) => STYLE_NAMES[Math.round((styleIdx(sire.style) + styleIdx(dam.style)) / 2)];
/** 名前の案（父の名の前半＋母の名の後半）。 */
export function foalNameIdea(sire, dam) {
  const a = [...sire.name], b = [...dam.name];
  return (a.slice(0, Math.ceil(a.length / 2)).join('') + b.slice(Math.floor(b.length / 2)).join('')).slice(0, NAME_MAX);
}

/** 両親のレーススキルを交互に受け継ぐ。脚質を決めるスキルは選んだ脚質に合うときだけ。 */
function inheritSkills(fs, ds, si) {
  const ok = (id) => (id === 'front' ? si === 0 : id === 'closer' ? si >= 2 : true);
  const out = [];
  for (let i = 0; i < Math.max(fs.length, ds.length); i++) {
    for (const id of [fs[i], ds[i]]) if (id && ok(id) && !out.includes(id)) out.push(id);
  }
  return out.slice(0, Math.max(fs.length, ds.length) + 1);
}

/**
 * 配合で作る育成馬（カードと同じ形）。f = { id, sire, dam, name, style, sex, coat, aw: [父の覚醒, 母の覚醒] }。
 */
export function bredCard(f) {
  const s = cardById(f.sire), d = cardById(f.dam);
  const ps = plusOf(s), pd = plusOf(d);
  const si = Math.max(0, STYLE_NAMES.indexOf(f.style));
  const turf = avg3(s.turf, d.turf), dirt = avg3(s.dirt, d.dirt);
  const aw = f.aw ?? [0, 0];
  return {
    id: `B${f.id}`, pack: 'BRED', bred: true, rar: RARITIES[Math.min(RARITIES.indexOf(s.rar), RARITIES.indexOf(d.rar))],
    region: s.region, name: f.name, sex: f.sex, age: 3, coat: f.coat, marks: null, hid: 900000 + f.id,
    sireId: s.id, damId: d.id, sire: s.name, dam: d.name, damSire: d.sire, line: s.line,
    v: Object.fromEntries(STATS.map((k) => [k, avg3(s.v[k], d.v[k])])),
    plus: Object.fromEntries(STATS.map((k) => [k, Math.max(ps[k], pd[k])])),
    turf, dirt, firm: avg3(s.firm, d.firm), soft: avg3(s.soft, d.soft),
    dist: Math.round((s.dist + d.dist) / 20) * 10, range: Math.round((s.range + d.range) / 2 + Math.abs(s.dist - d.dist) / 4),
    style: STYLE_VALUE[si], gi: 0, graded: 0,
    race: { name: '自家生産', info: `${s.name} × ${d.name}`, year: '', venue: '' }, travel: null,
    surface: turf >= dirt ? '芝' : 'ダート', shot: 'profile', desert: false,
    unique: [s, d].find((c) => c.rar === 'LM')?.id ?? null,
    raceSkills: inheritSkills(skillsOf(s, aw[0]).race, skillsOf(d, aw[1]).race, si),
  };
}

/** 固有スキルを持つカード（LM のカード、育成馬なら LM の親）。 */
export const uniqueCardOf = (c) => (!c ? null : c.bred ? (c.unique ? cardById(c.unique) : null) : c.rar === 'LM' ? c : null);
/** 固有スキルの名前と説明（画面用）。 */
export const uniqueOf = (c) => { const u = uniqueCardOf(c); return u ? skillsOf(u).unique : null; };
/**
 * 固有スキルの発動のエフェクト（観戦）。完成馬はカードエディットで決めたもの（h.art.fx。'none' は出さない）、
 * 無ければ固有を持つカード（LM か、配合で固有を受け継いだ LM の親）の既定。固有を持たない馬は null。
 */
export function fxOfFinished(h) {
  const u = h.cardId ? uniqueCardOf(cardById(h.cardId)) : h.unique ? cardById(h.unique) : null;
  if (!u) return null;
  const f = h.art?.fx;
  return f === 'none' ? null : f in SKILL_FX ? f : uniqueFxOf(u);
}
export const fxOfCard = (c) => uniqueFxOf(uniqueCardOf(c));
/** カードの絵のエフェクトの時間（秒）の上限。粒の寿命（1.6 秒まで）と竜巻の 1 回りより長くとる。 */
export const FX_TIME_MAX = 3;
/**
 * 2D のエフェクト（カードの絵・カットイン）の向き。−1 で左向き、+1 で右向き（先頭がその向き、粒は反対へ流れる）。
 * カードエディットで決めた向き（fxDir）、無ければ馬の向き（facing。既定の馬は左を向いて走る）。
 */
export const fxDirOf = (c) => (c?.fxDir === 'left' ? -1 : c?.fxDir === 'right' ? 1 : c?.facing === 'right' ? 1 : -1);
export { SKILL_FX, uniqueFxOf };

/** 育成中の馬（カードの形）。配合で作った馬は両親から作り直す。古い育成（カード 1 枚を育てる）はそのカード。 */
export function traineeCard(run) {
  if (!run.sire) return cardById(run.trainee);
  return bredCard({ id: run.id, sire: run.sire, dam: run.dam, name: run.name, style: run.style, sex: run.sex, coat: run.coat, aw: run.awaken?.ps });
}

/** 撮り方（h.art）をカードの絵の値に。silks は値があるときだけ（無ければ元のカードの服か、馬 id の服）。 */
const artFields = (a) => (a ? Object.fromEntries(Object.entries({ shot: a.shot, facing: a.facing, phase: a.phase, pose: a.pose, backdrop: a.backdrop, gate: a.gate,
  legPose: a.legPose, wind: a.wind, camera: a.camera, silks: a.silks, surface: a.surface, rig: a.rig, desert: a.backdrop ? a.backdrop === 'desert' : undefined,
  // エフェクトは絵に描くときだけ（fxArt）。カードの fx（固有の既定）とは別に持つ（LM の元の絵にはエフェクトを描かない）
  fxArt: a.fx in SKILL_FX ? a.fx : undefined, fxDir: a.fxDir, fxT: a.fxT,
  // 自分のカードは主役 1 頭だけ（元のカードに写っていた相手の馬は連れてこない）
  rivals: [] }).filter(([, v]) => v !== undefined)) : {});

/** 完成馬の姿（カードの形。絵を撮るのに使う）。配合の馬は保存した値から。 */
export function horseCard(h) {
  // 馬具を付け替えた完成馬は、絵もその馬具で撮る（絵の鍵に gear が入るので撮り直しになる）
  // カードにした完成馬（h.art）は、その撮り方で撮る（ホームの馬・アイコンも同じ姿になる）
  if (h.cardId) { const c = cardById(h.cardId); return c && (h.gear || h.art) ? { ...c, ...(h.gear ? { gear: h.gear } : {}), ...artFields(h.art) } : c; }
  const s = cardById(h.sire), d = cardById(h.dam);
  return {
    id: `B${h.id}`, pack: 'BRED', bred: true, rar: h.rar, name: h.name, sex: h.sex, coat: h.coat, marks: null, hid: 900000 + h.id,
    sireId: h.sire, damId: h.dam, sire: s?.name ?? '', dam: d?.name ?? '', damSire: d?.sire ?? '', line: s?.line ?? '',
    plus: s && d ? Object.fromEntries(STATS.map((k) => [k, Math.max(plusOf(s)[k], plusOf(d)[k])])) : undefined,
    v: Object.fromEntries(STATS.map((k) => [k, abilityOf(h.stats[k])])), turf: h.turf, dirt: h.dirt, firm: h.firm, soft: h.soft,
    dist: h.dist, range: h.range, style: h.style, surface: h.turf >= h.dirt ? '芝' : 'ダート', shot: 'profile', desert: false, unique: h.unique ?? null,
    gear: h.gear ?? {}, ...artFields(h.art),
  };
}

/** 配合の見込み（編成の画面で、名前と脚質を決める前に見せる）。 */
export function breedPreview(profile, sireId, damId, style = null) {
  const s = cardById(sireId), d = cardById(damId);
  const styles = foalStyles(s, d);
  const st = styles.includes(style) ? style : foalDefaultStyle(s, d);
  const aw = [awakenOf(profile.cards[sireId]), awakenOf(profile.cards[damId])];
  const c = bredCard({ id: profile.nextId, sire: sireId, dam: damId, name: '', style: st, sex: '牡', coat: s.coat, aw });
  return { card: c, styles, style: st, awaken: Math.floor((aw[0] + aw[1]) / 2), init: initStats(c, Math.floor((aw[0] + aw[1]) / 2)) };
}

const initStats = (c, awT) => Object.fromEntries(STATS.map((k) => [k, Math.round(200 + (c.v[k] - 0.55) * 1200 + awT * AWAKEN.init)]));

/**
 * 育成を始める。breed = { sire, dam, name, style }（父は牡・母は牝のカード）、supports はサポート 4 枚（父母と同じカードは不可）。
 * 初期値は両親の値の平均から（2 歳の夏の素の力）。
 */
export function startRun(profile, breed, supportIds, memoryIds = []) {
  const s = cardById(breed?.sire), d = cardById(breed?.dam);
  if (!s || !profile.cards[s.id] || !d || !profile.cards[d.id]) throw new Error('そのカードを持っていない');
  if (s.sex !== '牡' || d.sex !== '牝') throw new Error('父は牡、母は牝のカード');
  const name = String(breed.name ?? '').trim();
  if (!name || [...name].length > NAME_MAX) throw new Error(`名前は 1〜${NAME_MAX} 文字`);
  const styles = foalStyles(s, d);
  const style = styles.includes(breed.style) ? breed.style : foalDefaultStyle(s, d);
  if (supportIds.length !== SUPPORT_SLOTS) throw new Error(`サポートは ${SUPPORT_SLOTS} 枚`);
  for (const id of supportIds) if (!profile.cards[id] || id === s.id || id === d.id) throw new Error('サポートに使えないカード');
  if (memoryIds.length > MEMORY_SLOTS || new Set(memoryIds).size !== memoryIds.length) throw new Error(`因子メモリーは ${MEMORY_SLOTS} 個まで（同じものは 1 つ）`);
  const mems = memoryIds.map((id) => memoriesOf(profile).find((m) => m.id === id));
  if (mems.some((m) => !m)) throw new Error('その因子メモリーは無い');
  const seed = hashSeed(`run:${profile.seed}:${profile.nextId}`);
  const rng = makeRng(hashSeed(`foal:${seed}`));
  const sex = rng.next() < 0.5 ? '牡' : '牝';
  const coat = rng.next() < 0.5 ? s.coat : d.coat;
  // 覚醒は始めた時点の枚数で決める（育成の途中で引いても、その育成は変わらない）
  const ps = [awakenOf(profile.cards[s.id]), awakenOf(profile.cards[d.id])];
  const awaken = { t: Math.floor((ps[0] + ps[1]) / 2), s: supportIds.map((id) => awakenOf(profile.cards[id])), ps };
  const id = profile.nextId++;
  const c = bredCard({ id, sire: s.id, dam: d.id, name, style, sex, coat, aw: ps });
  // カードの値の差を出発点の差にする（重みが小さいと LM と SR の完成時の能力が 8% しか違わなかった）
  const stats = initStats(c, awaken.t);
  // 因子メモリー：抜き出した能力を初期値と上限に足し、レーススキルを最初から覚えている（効き目は始めた時点の写し。後で手放しても変わらない）
  const mem = mems.map((m) => ({ id: m.id, name: m.horse.name, stat: m.stat, val: m.val, skill: m.skill }));
  for (const k of STATS) stats[k] += memBreak(mem, k);
  profile.run = {
    id, seed, trainee: null, sire: s.id, dam: d.id, name, style, sex, coat, supports: [...supportIds],
    turn: 0, slot: 0, stats, energy: 100, mood: 2, fans: 0, starts: 0, wins: 0, gradedWins: 0, giWins: 0,
    levels: Object.fromEntries(STATS.map((k) => [k, 1])), races: [], log: [`${s.name} × ${d.name}の仔「${name}」（${sex}・${coat}・${style}）の育成を始めた`],
    bonds: [0, 0, 0, 0], learned: [], awaken, mem,
  };
  const run = profile.run;
  const goal = goalFor(c);
  const rv = pickRival(c, [s.id, d.id, ...supportIds], seed);
  const combo = comboOf([s.id, d.id, ...supportIds]);
  if (combo.length) { run.combo = combo; run.log.push(`組み合わせ：${combo.map((x) => `${COMBO_KINDS[x.kind]}${x.label} ${x.n}枚`).join('・')}（練習 +${Math.round((comboMul(run) - 1) * 100)}%）`); }
  if (goal) { run.goal = goal; run.log.push(`目標レース：${goal.name}（${SLOTS[goal.slot].label}）`); }
  if (rv) { run.rival = { cardId: rv, meets: rivalMeets(goal), log: [] }; run.log.push(`ライバル：${cardById(rv).name}`); }
  for (const m of mem) {
    if (m.skill && !runSkills(run).includes(m.skill)) run.learned.push(m.skill);
    run.log.push(`因子メモリー「${m.name}」：${STAT_LABEL[m.stat]} +${m.val}${m.skill ? `・${skillInfo(m.skill).name}` : ''}`);
  }
  return run;
}

export const MOODS = ['絶不調', '不調', '普通', '好調', '絶好調'];
const MOOD_MUL = [0.8, 0.9, 1.0, 1.1, 1.2];

const awT = (run) => run.awaken?.t ?? 0;
const awS = (run, i) => run.awaken?.s?.[i] ?? 0;
/** 友情練習を何回すればスキルを覚えるか（覚醒 3 で 1 回）。 */
export const bondNeed = (run, i) => (awS(run, i) >= AWAKEN.bondAt ? 1 : 2);

/** このターンが練習かレースか。 */
export const isRaceTurn = (run) => run.turn % (TRAININGS_PER_RACE + 1) === TRAININGS_PER_RACE;
export const turnLabel = (run) => {
  const slot = SLOTS[Math.min(SLOTS.length - 1, Math.floor(run.turn / (TRAININGS_PER_RACE + 1)))];
  return `${slot.label}${isRaceTurn(run) ? '（レース）' : `（練習 ${run.turn % (TRAININGS_PER_RACE + 1) + 1}/${TRAININGS_PER_RACE}）`}`;
};

/** 練習で伸びる能力（主・副）。 */
const TRAIN = {
  speed: { main: 'speed', sub: { power: 0.5 }, cost: 20 },
  stamina: { main: 'stamina', sub: { guts: 0.5 }, cost: 20 },
  power: { main: 'power', sub: { stamina: 0.5 }, cost: 20 },
  guts: { main: 'guts', sub: { speed: 0.35, power: 0.35 }, cost: 20 },
  wit: { main: 'wit', sub: { speed: 0.4 }, cost: 5, heal: 0 },
};

/**
 * このターンの練習場に誰が来ているか（サポートは 5 つの練習のどれかに出るか、来ない）。
 * (シード, ターン) から決めるので、画面を開き直しても変わらない。
 */
export function trainingBoard(run) {
  const rng = makeRng(hashSeed(`board:${run.seed}:${run.turn}`));
  const at = Object.fromEntries(STATS.map((k) => [k, []]));
  run.supports.forEach((id, i) => {
    const c = cardById(id);
    // 来ない（「練習の虫」は来やすい。乱数は同じだけ引く：スキルの有無で他のサポートの行き先を変えない）
    if (rng.next() < Math.max(0.01, (skillsOf(c, awS(run, i)).support.includes('often') ? 0.04 : 0.18) - AWAKEN.show * awS(run, i))) return;
    // 得意の練習に来やすい（半分は得意、残りはばらばら）
    const k = rng.next() < 0.5 ? supportType(c) : STATS[rng.int(STATS.length)];
    at[k].push(i);
  });
  return at;
}

/** 練習の見込み（伸びる点と失敗率）。画面で練習を選ぶ前に見せる。 */
export function trainingPreview(run, kind) {
  const t = traineeCard(run);
  const plus = plusOf(t);
  const tr = TRAIN[kind];
  const idx = trainingBoard(run)[kind];
  const here = idx.map((i) => cardById(run.supports[i]));
  // 組み合わせのボーナス（同じ弾・父系・年代）は練習の伸びに掛ける
  let mul = MOOD_MUL[run.mood] * (1 + 0.12 * here.length) * (1 + 0.08 * (run.levels[kind] - 1)) * comboMul(run);
  let cost = tr.cost, failMul = 1;
  const fired = [];
  here.forEach((c, j) => {
    const aw = awS(run, idx[j]);
    const sk = skillsOf(c, aw).support;
    const friend = supportType(c) === kind;
    if (friend) mul *= 1.15 + 0.25 * (RAR_BONUS[c.rar] - 1) * 2 + (sk.includes('friend') ? 0.15 : 0) + AWAKEN.friend * aw;   // 友情（友情の絆で強まる）
    if (sk.includes(`tr_${kind}`)) { mul *= 1 + 0.2 * RAR_SCALE[c.rar]; fired.push(skillInfo(`tr_${kind}`).name); }
    if (friend && sk.includes('friend')) fired.push(skillInfo('friend').name);
    if (sk.includes('saver') && kind !== 'wit') { cost = Math.max(5, cost - 5); fired.push(skillInfo('saver').name); }
    if (sk.includes('safe')) { failMul *= 0.5; fired.push(skillInfo('safe').name); }
    if (sk.includes('mood')) fired.push(skillInfo('mood').name);
  });
  const gains = {};
  const base = 30;
  gains[tr.main] = Math.round(base * mul * (0.85 + plus[tr.main] * 0.1));
  for (const [k, f] of Object.entries(tr.sub)) gains[k] = Math.round(base * f * mul * (0.85 + plus[k] * 0.1));
  const fail = run.energy >= 50 || kind === 'wit' ? 0 : Math.min(0.6, ((50 - run.energy) / 50) * 0.6) * failMul;
  return {
    gains, fail, cost, supports: here.map((c) => c.id), friendship: here.filter((c) => supportType(c) === kind).length,
    friends: here.filter((c) => supportType(c) === kind).map((c) => c.id), skills: [...new Set(fired)],
    mood: here.some((c, j) => skillsOf(c, awS(run, idx[j])).support.includes('mood')),
  };
}

const addStats = (run, gains) => {
  const plus = plusOf(traineeCard(run));
  for (const [k, g] of Object.entries(gains)) run.stats[k] = Math.max(0, Math.min(runCap(run, k, plus[k]), run.stats[k] + g));
};

/** 練習する。kind は STATS のどれか。 */
export function train(run, kind) {
  if (isRaceTurn(run) || run.turn >= TOTAL_TURNS) throw new Error('いまは練習できない');
  const p = trainingPreview(run, kind);
  const rng = makeRng(hashSeed(`train:${run.seed}:${run.turn}`));
  let msg;
  if (rng.next() < p.fail) {
    // 失敗：伸びず、気分が落ち、少しけがをしたように能力が下がる
    run.mood = Math.max(0, run.mood - 1);
    addStats(run, { [kind]: -10 });
    run.energy = Math.max(0, run.energy - 5);
    msg = `${STAT_LABEL[kind]}の練習に失敗した（体力が足りない）`;
  } else {
    addStats(run, p.gains);
    run.levels[kind] = Math.min(5, run.levels[kind] + 0.25);
    run.energy = kind === 'wit' ? Math.min(100, run.energy + 5) : Math.max(0, run.energy - p.cost);
    msg = `${STAT_LABEL[kind]}の練習 ${Object.entries(p.gains).map(([k, g]) => `${STAT_SHORT[k]}+${g}`).join(' ')}${p.friendship ? '（友情）' : ''}`;
    // サポートと練習すると、ときどき気分が上がる（盛り上げ役が居ると上がりやすい）
    if (p.supports.length && rng.next() < (p.mood ? 0.35 : 0.12)) { run.mood = Math.min(4, run.mood + 1); msg += '・気分が上がった'; }
    // 友情練習を 2 回するとそのサポートのレーススキルを覚える（完成馬に残る）
    for (const id of p.friends) {
      const i = run.supports.indexOf(id);
      if (i < 0) continue;
      msg += bondUp(run, i);
    }
  }
  run.log.push(msg);
  run.turn++;
  return msg;
}

// ---------------------------------------------------------------- 育成中の出来事
//
// 練習の時期に EVENT_RATE の確率で出来事が出る（続けては出さない）。出来事と、その中の対象のサポートは (育成のシード, ターン) から決め、
// 答えたときの成り行き（risk）も (育成のシード, ターン) から引く。保存するのは解決したターン（run.evDone）だけ。
// ターンは進めない（出来事は練習の前に挟まる、おまけの選択）。sim は答えを強いない：練習を先に選ぶと、そのターンの出来事は流れる
// （画面は答えるまで練習を出さない）。古い育成は evDone を持たないが、そのまま動く。

export { TRAIN_EVENTS };
export const EVENT_RATE = 0.25;

/** 効き目の短い説明（「スピ+10 根性+10 体力-8 絆+1」）。答えの札に出す。 */
export function effectText(e) {
  const out = [];
  for (const [k, v] of Object.entries(e.stats ?? {})) out.push(`${STAT_SHORT[k]}+${v}`);
  if (e.all) out.push(`全能力+${e.all}`);
  if (e.energy) out.push(`体力${e.energy > 0 ? '+' : ''}${e.energy}`);
  if (e.mood) out.push(e.mood > 0 ? '気分↑' : '気分↓');
  if (e.fans) out.push(`ファン+${e.fans}`);
  if (e.bond) out.push(`絆+${e.bond}`);
  return out.join(' ');
}

/** いまのターンの出来事（無ければ null）。答えの札の説明（hint）と、成り行きの注意（risk）も付ける。 */
export function pendingEvent(run) {
  if (!run || runDone(run) || isRaceTurn(run) || run.turn === 0) return null;
  const done = run.evDone ?? [];
  if (done.includes(run.turn) || done.includes(run.turn - 1)) return null;
  const rng = makeRng(hashSeed(`tevent:${run.seed}:${run.turn}`));
  if (rng.next() >= EVENT_RATE) return null;
  const pool = TRAIN_EVENTS.filter((e) => !e.rival || run.rival);
  const def = pool[rng.int(pool.length)];
  const support = def.support ? rng.int(run.supports.length) : null;
  const name = support != null ? cardById(run.supports[support]).name : '';
  const rv = run.rival ? cardById(run.rival.cardId).name : '';
  return {
    id: def.id, title: def.title, text: def.text.replace('{support}', name).replace('{rival}', rv), support,
    choices: def.choices.map((c) => ({ label: c.label, hint: effectText(c.effects), risk: c.risk ? `${Math.round(c.risk.p * 100)}%で${effectText(c.risk)}` : null })),
  };
}

/** 絆を 1 つ進める。2 回（覚醒 3 なら 1 回）でそのサポートのレーススキルを覚える。覚えたら知らせの文を返す。 */
function bondUp(run, i) {
  run.bonds ??= [0, 0, 0, 0];
  run.learned ??= [];
  const id = run.supports[i];
  run.bonds[i]++;
  const sk = skillsOf(cardById(id), awS(run, i)).race.find((x) => !run.learned.includes(x) && !runSkills(run).includes(x));
  if (run.bonds[i] === bondNeed(run, i) && sk) { run.learned.push(sk); return `・${cardById(id).name}から「${skillInfo(sk).name}」を覚えた`; }
  return '';
}

function applyEffects(run, e, support) {
  if (e.stats) addStats(run, e.stats);
  if (e.all) addStats(run, Object.fromEntries(STATS.map((k) => [k, e.all])));
  if (e.energy) run.energy = Math.max(0, Math.min(100, run.energy + e.energy));
  if (e.mood) run.mood = Math.max(0, Math.min(4, run.mood + e.mood));
  if (e.fans) run.fans += e.fans;
  let more = '';
  if (e.bond && support != null) for (let b = 0; b < e.bond; b++) more += bondUp(run, support);
  return more;
}

/** 出来事に答える（choice は答えの番号）。結果の文を返す。 */
export function resolveEvent(run, choice) {
  const ev = pendingEvent(run);
  if (!ev) throw new Error('いまは出来事が無い');
  const def = TRAIN_EVENTS.find((e) => e.id === ev.id);
  const ch = def.choices[Math.max(0, Math.min(def.choices.length - 1, choice | 0))];
  const rng = makeRng(hashSeed(`tevres:${run.seed}:${run.turn}`));
  let msg = `${ev.title}：${ch.label}（${effectText(ch.effects)}`;
  let more = applyEffects(run, ch.effects, ev.support);
  if (ch.risk && rng.next() < ch.risk.p) { more += applyEffects(run, ch.risk, ev.support); msg += `・${ch.risk.note}`; }
  msg += `）${more}`;
  run.evDone = [...(run.evDone ?? []), run.turn];
  run.log.push(msg);
  return msg;
}

/** 休む（体力を戻す）。 */
export function rest(run) {
  if (isRaceTurn(run) || run.turn >= TOTAL_TURNS) throw new Error('いまは休めない');
  const rng = makeRng(hashSeed(`rest:${run.seed}:${run.turn}`));
  const gain = rng.next() < 0.25 ? 70 : 50;
  run.energy = Math.min(100, run.energy + gain);
  if (rng.next() < 0.2) run.mood = Math.min(4, run.mood + 1);
  const msg = `休んだ（体力 +${gain}）`;
  run.log.push(msg);
  run.turn++;
  return msg;
}

// ---------------------------------------------------------------- レース

/** 育成中・完成馬・NPC をレースの計算に渡す馬にする。birthYear はレースの年で 4 歳にそろえる（成長曲線を 1 に近づける）。 */
function runnerHorse({ id, name, sex, coat, ab, dist, range, turf, dirt, firm, soft, style, gear }, year, rng) {
  const h = createHorse(rng, { name, sex, birthYear: year - 4 });
  h.id = id;
  h.coat = coat ?? h.coat;
  h.pot = { ...ab };
  h.cur = { ...ab };
  h.growth = '持続';
  h.dist = dist; h.distRange = range ?? 400;
  h.turf = turf; h.dirt = dirt; h.firm = firm ?? 0.8; h.soft = soft ?? 0.5;
  h.style = style ?? 0.5; h.styleFlex = 0.5; h.temper = 0.6; h.spirit = 0.6;
  h.fit = 1; h.cond = 0.7; h.fatigue = 0;
  // 馬具（gear.js）。育成モードの馬は気性を持たないので、馬具の効き目は気性 0.35 の馬として測る（race.js）
  if (gear && Object.keys(gear).length) { h.raceGear = gear; h.gearTemper = GEAR_TEMPER; }
  return h;
}

const NPC_NAMES = ['ミラクル', 'サンダー', 'ブレイブ', 'グローリー', 'スカイ', 'ローレル', 'ハヤテ', 'ムーン', 'シャイン', 'クラウン', 'ストーム', 'フェアリー', 'ダンサー', 'スター', 'ルビー', 'ヴィクトリー', 'ドリーム', 'ファイア'];
const NPC_HEAD = ['エイシン', 'マイネル', 'サクラ', 'メイショウ', 'タガノ', 'ダイワ', 'ゴールド', 'シルバー', 'トウカイ', 'ニシノ', 'アドマイヤ', 'ヤマニン'];
const COATS = ['鹿毛', '黒鹿毛', '栗毛', '青鹿毛', '芦毛', '栃栗毛'];

/** 条件に合う NPC（level は能力の平均）。 */
function npcHorse(rng, i, level, race) {
  const ab = {};
  for (const k of STATS) ab[k] = clamp(rng.normal(level, 0.035), 0.3, 0.95);
  return {
    id: 2e9 + 1000 + i, name: `${rng.pick(NPC_HEAD)}${rng.pick(NPC_NAMES)}`, sex: rng.chance(0.3) ? '牝' : '牡', coat: rng.pick(COATS), ab,
    dist: clamp(race.distance + rng.normal(0, 250), 1000, 3600), range: 450, turf: race.surface === 'ダート' ? 0.5 : 0.85, dirt: race.surface === 'ダート' ? 0.85 : 0.45,
    firm: 0.8, soft: rng.range(0.45, 0.8), style: rng.next(),
  };
}

/** 育成中の馬をレースの馬の形に。 */
export function traineeSpec(run) {
  const c = traineeCard(run);
  return {
    id: 1, name: c.name, sex: c.sex, coat: c.coat, ab: Object.fromEntries(STATS.map((k) => [k, abilityOf(run.stats[k])])),
    dist: c.dist, range: c.range, turf: c.turf, dirt: c.dirt, firm: c.firm, soft: c.soft,
    style: STYLE_NAMES.includes(run.raceStyle) ? styleValueOf(run.raceStyle) : c.style, cardId: c.bred ? null : c.id,
    gear: runGear(run), fx: fxOfCard(c),
  };
}

/** 育成中の馬のレーススキル（カードの分と、サポートから覚えた分）。 */
export function runSkills(run) {
  const c = traineeCard(run);
  return [...(c.raceSkills ?? skillsOf(c, awT(run)).race), ...(run.learned ?? [])];
}

/**
 * レーススキルを効かせた馬の形と、発動したスキル。src はカード id か、{ rar, unique }（配合の馬：レア度と固有を受け継いだ LM の親）。
 */
function withSkills(spec, skills, src, race, battle, awaken = 0, lock = null) {
  const c = typeof src === 'object' && src ? null : cardById(src);
  const rar = c?.rar ?? src?.rar ?? 'N';
  const u = c ? (c.rar === 'LM' ? c : null) : src?.unique ? cardById(src.unique) : null;
  return applyRaceSkills(spec, skills, race, { battle, rar, uniqueOf: u, awaken, lock });
}

/**
 * 自分の馬のレースの脚質（逃げ・先行・差し・追込）。レースの前に選べる。選んでいなければ育てた馬の脚質。
 * 選んだ脚質は育成中の馬なら run.raceStyle、完成馬なら h.raceStyle に覚える（次のレースも同じ脚質で出る）。
 */
export const styleNameOf = (x) => STYLE_NAMES[styleIdx(x)];
/** 育成中の馬のいまの脚質の名前。 */
export const runRaceStyle = (run) => (STYLE_NAMES.includes(run.raceStyle) ? run.raceStyle : styleNameOf(traineeCard(run).style));
/** 完成馬のいまの脚質の名前。 */
export const horseRaceStyle = (h) => (STYLE_NAMES.includes(h.raceStyle) ? h.raceStyle : styleNameOf(h.style));
const styleValueOf = (name) => STYLE_VALUE[Math.max(0, STYLE_NAMES.indexOf(name))];
const setRaceStyle = (o, name) => { if (STYLE_NAMES.includes(name)) o.raceStyle = name; };
/** 完成馬の脚質を決める（対戦・イベントで使う。育てた脚質から変えてよい）。 */
export const setHorseRaceStyle = (h, name) => setRaceStyle(h, name);
/** 育成中の馬のスキルの出どころ。 */
const runSrc = (run) => { const c = traineeCard(run); return c.bred ? { rar: c.rar, unique: c.unique } : c.id; };
/** 完成馬のスキルの出どころ。 */
const horseSrc = (h) => (h.cardId ? h.cardId : { rar: h.rar, unique: h.unique ?? null });

/**
 * レースを 1 つ走らせる。field は出走馬の形（runnerHorse に渡すもの）。
 * 走行ログ付きの結果を返す（3D で観られる）。乱数は seedKey から。
 */
export function runRace(race, field, seedKey, year = 2026) {
  const rng = makeRng(hashSeed(seedKey));
  // createHorse は馬の id をモジュールの通し番号で採る。牧場の世界と同じ番号を進めないよう戻す（落とし穴 47）。
  const idMark = peekHorseId();
  const horses = field.map((f) => runnerHorse(f, year, rng));
  resetHorseIds(idMark);
  const entries = horses.map((h, i) => ({
    horse: h, jockey: { id: null, name: '—', skill: 0.55, aggression: 0.5 },
    weight: h.sex === '牝' ? 55 : 57, gate: i + 1, frame: Math.min(8, Math.ceil(((i + 1) / horses.length) * 8)),
  }));
  // 枠は乱数で入れ替える（いつも 1 番が内にならないように）
  for (let i = entries.length - 1; i > 0; i--) { const j = rng.int(i + 1); [entries[i].horse, entries[j].horse] = [entries[j].horse, entries[i].horse]; }
  const res = simulateRace({
    raceId: race.id, name: race.name, classId: race.grade || 'cond', grade: race.grade, courseId: race.courseId, surface: race.surface,
    distance: race.distance, ground: race.ground ?? '良', weather: '晴', year, week: 20, entries, prize: 0,
  }, rng, { record: true });
  return res;
}

/**
 * 今のターンのレースに出る。choice は raceOptions の 1 つ。
 * 結果（着順・走行ログ）を返し、育成を次のターンへ進める。
 */
export function raceTurn(run, choice, style = null) {
  if (!isRaceTurn(run)) throw new Error('いまはレースの時期ではない');
  setRaceStyle(run, style);
  const opts = raceOptions(run);
  const race = opts.find((o) => o.id === choice) ?? opts[opts.length - 1];
  const rng = makeRng(hashSeed(`field:${run.seed}:${run.slot}`));
  const n = race.grade === 'GI' ? 16 : 12;
  const sp = traineeSpec(run);
  const me0 = withSkills(sp, runSkills(run), runSrc(run), race, false, awT(run), sp.style);
  const field = [me0.spec];
  for (let i = 1; i < n; i++) field.push(npcHorse(rng, i, race.level, race));
  // ライバルは出馬表を作り終えてから最後の 1 頭と入れ替える（ほかの馬の乱数は変えない）
  const meet = rivalMeetsNow(run);
  const rv = meet ? rivalHorse(run, race) : null;
  if (rv) field[field.length - 1] = rv.spec;
  const res = runRace(race, field, `race:${run.seed}:${run.slot}`);
  const me = res.results.find((r) => r.horseId === 1);
  const order = me.order;
  const rvRow = rv ? res.results.find((r) => r.horseId === RIVAL_HORSE_ID) : null;
  if (rvRow) run.rival.log.push({ slot: run.slot, me: order, rv: rvRow.order, race: race.name });
  const isGoal = run.goal && race.id === run.goal.id;
  if (isGoal) { run.goal.tried = true; run.goal.done = order === 1; }
  run.starts++;
  // 報酬：着順で全能力に点、ファン、勝てばクラスが上がる
  const bonus = order === 1 ? 20 : order <= 3 ? 12 : order <= 5 ? 6 : 3;
  const gradeMul = { GI: 1.6, GII: 1.3, GIII: 1.15, OP: 1.05 }[race.grade] ?? 1;
  addStats(run, Object.fromEntries(STATS.map((k) => [k, Math.round(bonus * gradeMul)])));
  run.fans += Math.round((order === 1 ? 3000 : order <= 3 ? 1200 : 300) * gradeMul);
  if (order === 1) {
    run.wins++;
    if (/^G/.test(race.grade)) run.gradedWins++;
    if (race.grade === 'GI') run.giWins++;
    run.mood = Math.min(4, run.mood + 1);
  } else if (order > 5) run.mood = Math.max(0, run.mood - 1);
  run.energy = Math.max(0, run.energy - 15);
  run.races.push({ slot: run.slot, name: race.name, grade: race.grade, courseId: race.courseId, surface: race.surface, distance: race.distance, ground: race.ground, order, field: res.results.length, time: me.time, skills: me0.fired });
  run.log.push(`${race.name} ${order}着（${res.results.length}頭）${me0.fired.length ? `　発動：${me0.fired.join('・')}` : ''}`);
  if (rvRow) run.log.push(`ライバル${rvRow.name}は ${rvRow.order}着（${order < rvRow.order ? '先着' : '後れを取った'}）`);
  if (isGoal) run.log.push(order === 1 ? `目標の${race.name}を勝った！` : `目標の${race.name}は ${order}着`);
  run.turn++;
  run.slot++;
  return { race, result: res, field, order, fired: me0.fired, rival: rvRow ? { name: rvRow.name, order: rvRow.order, cardId: run.rival.cardId, id: RIVAL_HORSE_ID, fired: rv.fired } : null,
    goal: isGoal ? (order === 1 ? 'done' : 'missed') : null };
}

export const runDone = (run) => run.turn >= TOTAL_TURNS;

// ---------------------------------------------------------------- 完成

/** 完成馬の評価点（能力の点の合計＋勝ち星）。 */
export const ratingOf = (h) => STATS.reduce((s, k) => s + h.stats[k], 0) + h.wins * 20 + h.giWins * 60 + (h.goal?.done ? GOAL_BONUS : 0);
export function rankOf(rating) {
  const T = [[5200, 'SS'], [4600, 'S'], [4000, 'A+'], [3500, 'A'], [3000, 'B+'], [2500, 'B'], [2000, 'C+'], [1500, 'C'], [0, 'D']];
  return T.find(([t]) => rating >= t)[1];
}

/** 育成を終えて完成馬にする。 */
export function finishRun(profile) {
  const horse = closeRun(profile);
  profile.finished.push(horse);
  return horse;
}

// ---------------------------------------------------------------- 因子メモリー
//
// 育成を終えた馬は、完成馬にする代わりに因子メモリーにできる。メモリーはその馬の能力から 1 つ（☆1〜☆5 のランダム）とレーススキルから 1 つを
// ランダムに抜き出したもの。編成の因子メモリー枠（MEMORY_SLOTS）に入れると、その能力の初期値と上限に ☆×MEM_STEP を足し（上限は 1200 を超えて突破する。
// 能力ごとに MEM_BREAK まで）、スキルを最初から覚えている。
// 編成しても減らない（何度でも使える）。乱数は (シード, 育成の id) から（同じ育成はいつも同じメモリーになる）。

export const MEMORY_SLOTS = 2;
export const MEMORY_MAX = 60;
/** ☆1 つの上乗せ（点）と、能力ごとの上乗せの上限（☆5 で届く）。 */
export const MEM_STEP = 20;
export const MEM_BREAK = 100;
/** 能力の点の上限（1200 ＋ 上限突破）。 */
export const PTS_MAX = 1200 + MEM_BREAK;
export const memoriesOf = (profile) => profile.memories ?? [];

/** 育成を終えて因子メモリーにする（完成馬にはならない）。 */
export function finishRunAsMemory(profile) {
  if (memoriesOf(profile).length >= MEMORY_MAX) throw new Error(`因子メモリーは ${MEMORY_MAX} 個まで（手放してから）`);
  const run = profile.run;
  const skills = run && runDone(run) ? runSkills(run) : [];
  const horse = closeRun(profile);
  const rng = makeRng(hashSeed(`memory:${profile.seed}:${horse.id}`));
  const stat = STATS[rng.int(STATS.length)];
  const skill = skills.length ? skills[rng.int(skills.length)] : null;
  const star = 1 + rng.int(5);
  const m = { id: horse.id, stat, star, val: star * MEM_STEP, skill, horse };
  profile.memories = [...memoriesOf(profile), m];
  return m;
}

/** 因子メモリーを手放す。 */
export function dropMemory(profile, id) {
  profile.memories = memoriesOf(profile).filter((m) => m.id !== id);
}

/** 育成を閉じて完成馬の形にする（完成馬にもメモリーにも共通。ミッションのウイコインもここで）。 */
function closeRun(profile) {
  const run = profile.run;
  if (!run || !runDone(run)) throw new Error('まだ育成の途中');
  const c = traineeCard(run);
  const horse = {
    id: run.id, cardId: c.bred ? null : c.id, name: c.name, sex: c.sex, coat: c.coat, rar: c.rar, stats: { ...run.stats },
    ...(c.bred ? { sire: c.sireId, dam: c.damId, unique: c.unique } : {}),
    dist: c.dist, range: c.range, turf: c.turf, dirt: c.dirt, firm: c.firm, soft: c.soft, style: c.style,
    starts: run.starts, wins: run.wins, gradedWins: run.gradedWins, giWins: run.giWins, fans: run.fans,
    races: run.races, supports: run.supports, battles: 0, battleWins: 0,
    skills: runSkills(run), awaken: awT(run), gear: runGear(run),
    ...(run.goal ? { goal: { id: run.goal.id, name: run.goal.name, done: !!run.goal.done } } : {}),
    ...(run.rival ? { rival: { cardId: run.rival.cardId, ...(({ won, lost }) => ({ won, lost }))(rivalRecord(run)) } } : {}),
  };
  horse.rating = ratingOf(horse);
  horse.rank = rankOf(horse.rating);
  noteRun(profile, run, horse);
  // ミッション：初めて編成したカードは 1 枚ごとにウイコイン 1 枚
  const gain = missionGain(profile, run);
  profile.missions = [...missionsOf(profile), ...gain];
  profile.coins = coinsOf(profile) + gain.length + (run.goal?.done ? GOAL_COINS : 0);
  profile.run = null;
  return horse;
}

/** 完成馬のレーススキル（古い完成馬は持たないので、カードから起こす）。 */
export const finishedSkills = (h) => h.skills ?? skillsOf(cardById(h.cardId) ?? { v: {}, rar: 'N', id: '' }).race;

/** 完成馬をレースの馬の形に。 */
export function finishedSpec(h, i = 0) {
  return {
    id: 100 + i, name: h.name, sex: h.sex, coat: h.coat, ab: Object.fromEntries(STATS.map((k) => [k, abilityOf(h.stats[k])])),
    dist: h.dist, range: h.range, turf: h.turf, dirt: h.dirt, firm: h.firm, soft: h.soft,
    style: STYLE_NAMES.includes(h.raceStyle) ? styleValueOf(h.raceStyle) : h.style, fid: h.id, cardId: h.cardId,
    gear: h.gear ?? (h.cardId ? cleanGear(cardById(h.cardId)?.gear) : {}), fx: fxOfFinished(h),
  };
}

// ---------------------------------------------------------------- 対戦

/** 対戦の舞台（番組表の GI から）。 */
export const BATTLE_RACES = ['japan-cup', 'arima-kinen', 'tenno-sho-spring', 'yasuda-kinen', 'sprinters-s', 'takarazuka', 'champions-cup', 'february-s', 'tenno-sho-autumn', 'derby']
  .map((id) => GRADED.find((r) => r.id === id)).filter(Boolean)
  .map((r) => ({ id: r.id, name: r.name, grade: 'GI', courseId: r.courseId, surface: r.surface, distance: r.distance }));

export const DIFFICULTY = { normal: { name: '普通', d: -0.10 }, hard: { name: '強い', d: -0.02 }, legend: { name: '伝説', d: 0.03 } };

/**
 * NPC のランク戦。相手は全カードの名馬を「育て上げた姿」にした完成馬で、強さは自分の馬の能力の平均に難しさを足した帯。
 */
export function battleNpc(profile, horseId, raceId, diff = 'normal', style = null) {
  const me = profile.finished.find((h) => h.id === horseId);
  if (me) setRaceStyle(me, style);
  const race0x = BATTLE_RACES.find((r) => r.id === raceId) ?? BATTLE_RACES[0];
  const n = 12;
  const race0 = race0x;
  const race = { ...race0, ground: groundOf(`bground:${profile.seed}:${profile.battles}`) };
  const rng = makeRng(hashSeed(`battle:${profile.seed}:${profile.battles}`));
  const myAvg = STATS.reduce((s, k) => s + abilityOf(me.stats[k]), 0) / 5;
  const level = clamp(myAvg + DIFFICULTY[diff].d, 0.55, 0.92);
  const pool = CARDS.filter((c) => c.name !== me.name && ((race.surface === 'ダート') === (c.dirt > c.turf)));
  const ms = finishedSpec(me, 0);
  const mine0 = withSkills(ms, finishedSkills(me), horseSrc(me), race, true, me.awaken ?? 0, ms.style);
  const field = [mine0.spec];
  const fired = { 100: mine0.fired };
  const used = new Set();
  for (let i = 1; i < n; i++) {
    let c = pool[rng.int(pool.length)];
    for (let t = 0; t < 5 && used.has(c.id); t++) c = pool[rng.int(pool.length)];
    used.add(c.id);
    // カードの得手不得手を残したまま、平均を帯に合わせる
    const avg = STATS.reduce((s, k) => s + c.v[k], 0) / 5;
    const ab = Object.fromEntries(STATS.map((k) => [k, clamp(level + (c.v[k] - avg) + rng.normal(0, 0.015), 0.4, 0.95)]));
    // 相手もカードのレーススキルを使う（自分だけ使えると難しさの帯が崩れる）
    const npc = withSkills({ id: 200 + i, name: c.name, sex: c.sex, coat: c.coat, marks: c.marks, ab, dist: c.dist, range: c.range, turf: c.turf, dirt: c.dirt, firm: c.firm, soft: c.soft, style: c.style, cardId: c.id, gear: cleanGear(c.gear) },
      skillsOf(c).race, c.id, race, true);
    field.push(npc.spec);
    fired[200 + i] = npc.fired;
  }
  const res = runRace(race, field, `battle:${profile.seed}:${profile.battles}`);
  profile.battles++;
  const mine = res.results.find((r) => r.horseId === 100);
  me.battles++;
  if (mine.order === 1) me.battleWins++;
  const fast = noteBattle(profile, 'rank', race, mine, me.name);
  const rank = ladderMove(profile, mine.order, diff);
  return { race, result: res, field, order: mine.order, fired, rank, fast };
}

// ---------------------------------------------------------------- イベント

/** イベントの進み（勝った難易度）。 */
export function eventState(profile, id) {
  return profile.events?.[id] ?? { cleared: [], tries: 0 };
}

/**
 * イベントレースを走る。相手は史実の出走馬（data/events.js）に難易度の差（STAR_D）を足した強さで、馬場もその日のまま。
 * 各難易度で初めて勝つと報酬のカードを 1 枚（☆1〜☆5 の 5 つで 5 枚＝完凸）。乱数は (シード, イベント, 挑んだ回数) から。
 */
export function eventRace(profile, horseId, eventId, star, style = null) {
  const ev = EVENTS.find((e) => e.id === eventId);
  const me = profile.finished.find((h) => h.id === horseId);
  if (!ev || !me) throw new Error('イベントか完成馬が無い');
  setRaceStyle(me, style);
  star = Math.max(1, Math.min(5, star | 0));
  profile.events ??= {};
  const st = profile.events[eventId] ??= { cleared: [], tries: 0 };
  const race = { ...ev.race };
  const key = `event:${profile.seed}:${eventId}:${st.tries}`;
  const rng = makeRng(hashSeed(key));
  const ms = finishedSpec(me, 0);
  const mine0 = withSkills(ms, finishedSkills(me), horseSrc(me), race, true, me.awaken ?? 0, ms.style);
  const field = [mine0.spec];
  const fired = { 100: mine0.fired };
  ev.field.forEach((m, i) => {
    const ab = Object.fromEntries(STATS.map((k) => [k, clamp(m.ab[k] + STAR_D[star] + rng.normal(0, 0.008), 0.4, 0.95)]));
    const c = m.cardId ? cardById(m.cardId) : null;
    const spec = { id: 200 + i, name: m.name, sex: m.sex, coat: m.coat, marks: c?.marks ?? null, ab, dist: m.dist, range: m.range,
      turf: m.turf ?? 0.9, dirt: m.dirt ?? 0.4, firm: 0.8, soft: m.soft, style: m.style, cardId: c?.id ?? null, gear: cleanGear(c?.gear) };
    // カードのある馬（モンジュー・ファンタスティックライト）はカードのスキルを使う。モンジューの固有「聳え立つ巨城」はこの舞台で発動する
    const x = c ? withSkills(spec, skillsOf(c).race, c.id, race, true) : { spec, fired: [] };
    field.push(x.spec);
    fired[200 + i] = x.fired;
  });
  const res = runRace(race, field, key, ev.year);
  st.tries++;
  const mine = res.results.find((r) => r.horseId === 100);
  me.battles++;
  let reward = null;
  if (mine.order === 1) {
    me.battleWins++;
    if (!st.cleared.includes(star)) {
      st.cleared.push(star);
      st.cleared.sort();
      const c = cardById(ev.reward);
      const isNew = !profile.cards[c.id];
      profile.cards[c.id] = (profile.cards[c.id] ?? 0) + 1;
      reward = { card: c, isNew, awaken: profile.cards[c.id] - 1, star };
    }
  }
  const fast = noteBattle(profile, 'event', race, mine, me.name);
  return { race, result: res, field, order: mine.order, fired, reward, star, fast };
}

// ---------------------------------------------------------------- ライバルレース

/** 1 日に得られるウイコイン。 */
export const RIVAL_DAILY = 10;
/** 勝ったときのウイコイン（難易度ごと）。 */
export const RIVAL_COINS = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 3 };
/** 相手の能力の平均（難易度ごと）。自分の馬に合わせない（ランク戦と違って、強くなるほど上の難易度が勝てるようになる）。 */
export const RIVAL_LEVEL = { 1: 0.58, 2: 0.64, 3: 0.70, 4: 0.76, 5: 0.82 };
export const RIVAL_FIELD = 10;

/** ライバルレースの今日の進み（today は 'YYYY-MM-DD'。日が変わっていれば今日の分は 0 から）。 */
export function rivalState(profile, today) {
  const st = profile.rival ?? { day: null, got: 0, cleared: [], tries: 0 };
  const got = st.day === today ? st.got : 0;
  return { cleared: st.cleared, tries: st.tries, got, left: Math.max(0, RIVAL_DAILY - got) };
}
/** 勝つかスキップしたら今日のウイコインを足す（上限まで）。足した枚数を返す。 */
function rivalPay(profile, today, star) {
  const st = profile.rival ??= { day: null, got: 0, cleared: [], tries: 0 };
  if (st.day !== today) { st.day = today; st.got = 0; }
  const n = Math.min(RIVAL_COINS[star], RIVAL_DAILY - st.got);
  st.got += n;
  profile.coins = coinsOf(profile) + n;
  return n;
}

/**
 * ライバルレース。相手は名馬のカード（LM・SSR・SR から、舞台の馬場に向いた馬）を難易度の強さ（RIVAL_LEVEL）にした 9 頭。
 * 勝つと難易度に応じたウイコイン（1 日 RIVAL_DAILY 枚まで）。勝った難易度は次からスキップできる（rivalSkip）。
 * 乱数は (シード, 挑んだ回数) から。
 */
export function rivalRace(profile, horseId, raceId, star, today, style = null) {
  const me = profile.finished.find((h) => h.id === horseId);
  if (!me) throw new Error('完成馬が無い');
  setRaceStyle(me, style);
  star = Math.max(1, Math.min(5, star | 0));
  const st = profile.rival ??= { day: null, got: 0, cleared: [], tries: 0 };
  const race0 = BATTLE_RACES.find((r) => r.id === raceId) ?? BATTLE_RACES[0];
  const key = `rival:${profile.seed}:${st.tries}`;
  const race = { ...race0, ground: groundOf(`rground:${profile.seed}:${st.tries}`) };
  const rng = makeRng(hashSeed(key));
  const dirt = race.surface === 'ダート';
  const pool = CARDS.filter((c) => c.pack in PACKS && ['LM', 'SSR', 'SR'].includes(c.rar) && c.name !== me.name && (dirt === (c.dirt > c.turf)));
  const ms = finishedSpec(me, 0);
  const mine0 = withSkills(ms, finishedSkills(me), horseSrc(me), race, true, me.awaken ?? 0, ms.style);
  const field = [mine0.spec];
  const fired = { 100: mine0.fired };
  const used = new Set();
  for (let i = 1; i < RIVAL_FIELD; i++) {
    let c = pool[rng.int(pool.length)];
    for (let t = 0; t < 8 && used.has(c.id); t++) c = pool[rng.int(pool.length)];
    used.add(c.id);
    const avg = STATS.reduce((s, k) => s + c.v[k], 0) / 5;
    const ab = Object.fromEntries(STATS.map((k) => [k, clamp(RIVAL_LEVEL[star] + (c.v[k] - avg) + rng.normal(0, 0.012), 0.4, 0.95)]));
    const npc = withSkills({ id: 200 + i, name: c.name, sex: c.sex, coat: c.coat, marks: c.marks, ab, dist: c.dist, range: c.range, turf: c.turf, dirt: c.dirt, firm: c.firm, soft: c.soft, style: c.style, cardId: c.id, gear: cleanGear(c.gear) },
      skillsOf(c).race, c.id, race, true);
    field.push(npc.spec);
    fired[200 + i] = npc.fired;
  }
  const res = runRace(race, field, key);
  st.tries++;
  const mine = res.results.find((r) => r.horseId === 100);
  me.battles++;
  let coins = 0, first = false;
  if (mine.order === 1) {
    me.battleWins++;
    if (!st.cleared.includes(star)) { st.cleared.push(star); st.cleared.sort(); first = true; }
    coins = rivalPay(profile, today, star);
    if (star >= 3) bump(profile, 'rival3w');
  }
  const fast = noteBattle(profile, 'rival', race, mine, me.name);
  return { race, result: res, field, order: mine.order, fired, star, coins, first, fast };
}

/** 勝ったことのある難易度は走らずに勝ったことにする（今日の上限まで）。できないなら理由。 */
export function canRivalSkip(profile, star, today) {
  const s = rivalState(profile, today);
  if (!s.cleared.includes(star)) return 'まだ勝っていない難易度';
  if (!s.left) return '今日のウイコインは受け取り済み';
  return null;
}
export function rivalSkip(profile, star, today) {
  const why = canRivalSkip(profile, star, today);
  if (why) throw new Error(why);
  // スキップも勝ちに数える（ミッションの「ライバルレースで n 勝」）
  bump(profile, 'rivalw');
  if (star >= 3) bump(profile, 'rival3w');
  return rivalPay(profile, today, star);
}

/** 自分の完成馬どうしの対戦（2〜16 頭）。 */
export function battleOwn(profile, horseIds, raceId) {
  const race = { ...(BATTLE_RACES.find((r) => r.id === raceId) ?? BATTLE_RACES[0]), ground: groundOf(`bground:${profile.seed}:${profile.battles}`) };
  const list = horseIds.map((id) => profile.finished.find((h) => h.id === id)).filter(Boolean).slice(0, 16);
  if (list.length < 2) throw new Error('2 頭以上を選ぶ');
  const fired = {};
  const field = list.map((h, i) => {
    const hs = finishedSpec(h, i);
    const x = withSkills(hs, finishedSkills(h), horseSrc(h), race, true, h.awaken ?? 0, hs.style);
    fired[100 + i] = x.fired;
    return x.spec;
  });
  const res = runRace(race, field, `own:${profile.seed}:${profile.battles}`);
  profile.battles++;
  for (const r of res.results) {
    const h = list[r.horseId - 100];
    if (!h) continue;
    h.battles++;
    if (r.order === 1) h.battleWins++;
  }
  const top = res.results.find((r) => r.order === 1);
  const fast = noteBattle(profile, 'own', race, top, list[top.horseId - 100]?.name ?? top.name);
  return { race, result: res, field, fired, fast };
}

// ---------------------------------------------------------------- 記録（通算の数・最速の時計・最高の馬）
//
// 育成と対戦の数を profile.rec に積む。1 日・週のミッション（下）はこの数の差で進みを見る。
// 最速の時計は舞台（場・馬場・距離）ごとに自分の馬だけ（育成のレースも対戦も同じ舞台なら同じ欄）。
// 古いプロフィールは読み込みで完成馬から起こす（migrateProfile）。

export const recOf = (profile) => profile.rec ?? {};
const bump = (profile, k, n = 1) => { profile.rec ??= {}; profile.rec[k] = (profile.rec[k] ?? 0) + n; };
/** 舞台の鍵と名前（「中山 芝2500m」）。 */
export const stageKey = (r) => `${r.courseId}|${r.surface}|${r.distance}`;
export const stageLabel = (key) => {
  const [c, s, d] = key.split('|');
  return `${courseName(c) ?? c} ${s === 'ダート' ? 'ダ' : '芝'}${d}m`;
};
/** 自分の馬の時計を舞台の最速に照らす（速ければ書き換えて true）。 */
function noteTime(profile, race, t, horse, mode) {
  if (!(t > 0)) return false;
  profile.rec ??= {};
  const fast = profile.rec.fast ??= {};
  const k = stageKey(race);
  if (fast[k] && fast[k].t <= t) return false;
  fast[k] = { t: Math.round(t * 100) / 100, horse, race: race.name, ground: race.ground ?? '良', mode };
  return true;
}
/** 育成を閉じたときの記録（数・最高の評価点・育成のレースの時計）。 */
function noteRun(profile, run, horse) {
  bump(profile, 'runs');
  bump(profile, 'starts', run.starts);
  bump(profile, 'wins', run.wins);
  bump(profile, 'giWins', run.giWins);
  if (run.goal?.done) bump(profile, 'goals');
  const best = profile.rec.best;
  if (!best || horse.rating > best.rating) profile.rec.best = { rating: horse.rating, rank: horse.rank, name: horse.name, id: horse.id };
  for (const r of run.races) if (r.time) noteTime(profile, r, r.time, horse.name, '育成');
}
/** 対戦の記録（mode：rank・rival・event・own）。 */
function noteBattle(profile, mode, race, row, name) {
  bump(profile, 'battles');
  bump(profile, mode);
  if (row?.order === 1 && mode !== 'own') { bump(profile, 'battleWins'); bump(profile, `${mode}w`); }
  return row ? noteTime(profile, race, row.time, name, { rank: 'ランク戦', rival: 'ライバル', event: 'イベント', own: '完成馬対決' }[mode]) : false;
}
/** 古いプロフィールの記録を、持っている完成馬と因子メモリーから起こす。 */
function recFromOld(profile) {
  const hs = [...profile.finished, ...memoriesOf(profile).map((m) => m.horse)];
  const rec = { runs: hs.length, starts: 0, wins: 0, giWins: 0, goals: 0, battles: 0, battleWins: 0, fast: {} };
  profile.rec = rec;
  for (const h of hs) {
    rec.starts += h.starts ?? 0; rec.wins += h.wins ?? 0; rec.giWins += h.giWins ?? 0; if (h.goal?.done) rec.goals++;
    rec.battles += h.battles ?? 0; rec.battleWins += h.battleWins ?? 0;
    if (!rec.best || h.rating > rec.best.rating) rec.best = { rating: h.rating, rank: h.rank, name: h.name, id: h.id };
    for (const r of h.races ?? []) if (r.time && r.courseId) noteTime(profile, r, r.time, h.name, '育成');
  }
}

// ---------------------------------------------------------------- 1 日のミッション・週のミッション
//
// 「初めて編成したカードの育成で 1 枚」はカードの種類で上限が来るので、毎日遊ぶ理由として 1 日（端末の 0:00）と週（月曜の 0:00）で
// 切り替わるミッションを置く。進みは記録の数（profile.rec）の、その日・その週の始めからの差。始めの数は rollQuests が写す
// （画面が描くたびに呼ぶ。日付は sim で作らない）。達成したら押して受け取る（claimQuest）。ライバルレースのスキップも勝ちに数える。

export const QUESTS = {
  daily: [
    { id: 'd_run', label: '育成を 1 回終える', key: 'runs', need: 1, coins: 2 },
    { id: 'd_rival3', label: 'ライバルレース☆3 以上で 1 勝', key: 'rival3w', need: 1, coins: 2 },
    { id: 'd_rank', label: 'ランク戦を 2 回走る', key: 'rank', need: 2, coins: 1 },
    { id: 'd_battle', label: '対戦（どれでも）を 3 回走る', key: 'battles', need: 3, coins: 1 },
  ],
  weekly: [
    { id: 'w_run', label: '育成を 5 回終える', key: 'runs', need: 5, coins: 6 },
    { id: 'w_goal', label: '目標レースを 2 回勝つ', key: 'goals', need: 2, coins: 4 },
    { id: 'w_rival', label: 'ライバルレースで 10 勝', key: 'rivalw', need: 10, coins: 5 },
    { id: 'w_rankw', label: 'ランク戦で 5 勝', key: 'rankw', need: 5, coins: 4 },
    { id: 'w_event', label: 'イベントレースを 3 回走る', key: 'event', need: 3, coins: 3 },
  ],
};
const QUEST_KEYS = [...new Set([...QUESTS.daily, ...QUESTS.weekly].map((q) => q.key))];
/** 日付（'YYYY-MM-DD'）の通し日数（1970-01-01 が 0）。 */
export function dayNumber(today) {
  let [y, m, d] = String(today).split('-').map(Number);
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400), yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468;
}
/** 週の鍵（月曜始まりの通し番号）と、次の月曜までの日数。1970-01-01 は木曜。 */
export const weekNumber = (today) => Math.floor((dayNumber(today) + 3) / 7);
export const daysToWeekEnd = (today) => 7 - ((dayNumber(today) + 3) % 7);
const snapRec = (profile) => Object.fromEntries(QUEST_KEYS.map((k) => [k, recOf(profile)[k] ?? 0]));

/** 日・週が変わっていたら、その始めの数を写して受け取りを空にする。 */
export function rollQuests(profile, today) {
  const q = profile.quest ??= { day: null, dBase: {}, dGot: [], week: null, wBase: {}, wGot: [] };
  const wk = weekNumber(today);
  if (q.day !== today) { q.day = today; q.dBase = snapRec(profile); q.dGot = []; }
  if (q.week !== wk) { q.week = wk; q.wBase = snapRec(profile); q.wGot = []; }
  return q;
}
/** ミッションの進み（書き換えない。日・週が変わっていれば 0 から）。 */
export function questState(profile, today) {
  const q = profile.quest ?? {};
  const cur = snapRec(profile);
  const list = (defs, base, got) => defs.map((d) => {
    const have = Math.min(d.need, Math.max(0, cur[d.key] - (base ? base[d.key] ?? 0 : cur[d.key])));
    const gotIt = (got ?? []).includes(d.id);
    return { ...d, have, done: have >= d.need, got: gotIt, ready: have >= d.need && !gotIt };
  });
  const sameDay = q.day === today, sameWeek = q.week === weekNumber(today);
  const daily = list(QUESTS.daily, sameDay ? q.dBase : null, sameDay ? q.dGot : []);
  const weekly = list(QUESTS.weekly, sameWeek ? q.wBase : null, sameWeek ? q.wGot : []);
  return { daily, weekly, ready: [...daily, ...weekly].filter((x) => x.ready).length, weekLeft: daysToWeekEnd(today) };
}
/** 達成したミッションのウイコインを受け取る。受け取った枚数（受け取れなければ 0）。 */
export function claimQuest(profile, id, today) {
  const q = rollQuests(profile, today);
  const st = questState(profile, today);
  const x = [...st.daily, ...st.weekly].find((d) => d.id === id);
  if (!x || !x.ready) return 0;
  (x.id.startsWith('d_') ? q.dGot : q.wGot).push(x.id);
  profile.coins = coinsOf(profile) + x.coins;
  return x.coins;
}
/** 受け取れるものをまとめて。 */
export function claimAllQuests(profile, today) {
  const st = questState(profile, today);
  return [...st.daily, ...st.weekly].filter((x) => x.ready).reduce((a, x) => a + claimQuest(profile, x.id, today), 0);
}

// ---------------------------------------------------------------- ランク戦の段位
//
// ランク戦（battleNpc）の着順で段位の点が上下する。点は 0 より下がらない。初めてその段位に届いたときだけウイコイン
// （落ちてまた上がっても出さない。行き来で稼げないように）。強い・伝説は勝ちの点が多く、負けの点が少ない。
// 相手は自分の馬からの相対の強さなので、段位は「その馬に合った舞台と難しさを選べるか」で上がる。

// 普通は向いた舞台で 6 割勝てるので、点を少なく・負けを重くした（同じ点だと 20 戦で殿堂に届いた）。
// 普通・強い・伝説で 1 戦あたり 12・15・17 点ほど（殿堂まで 60〜85 戦）。
export const RANK_TIERS = [
  { name: '新馬級', at: 0, coins: 0 },
  { name: '条件級', at: 100, coins: 2 },
  { name: 'オープン級', at: 250, coins: 3 },
  { name: '重賞級', at: 450, coins: 4 },
  { name: 'GI級', at: 700, coins: 6 },
  { name: '殿堂', at: 1000, coins: 10 },
];
export const RANK_GAIN = (order) => (order === 1 ? 30 : order === 2 ? 12 : order === 3 ? 6 : order <= 5 ? 0 : -12);
export const RANK_DIFF = { normal: { up: 0.6, down: 1.2 }, hard: { up: 1.2, down: 0.8 }, legend: { up: 2, down: 0.5 } };
export const tierOf = (pts) => RANK_TIERS.reduce((t, x, i) => (pts >= x.at ? i : t), 0);
/** 段位の今（点・段位・次の段位まで）。 */
export function ladderState(profile) {
  const l = profile.ladder ?? { pts: 0, best: 0 };
  const tier = tierOf(l.pts);
  const next = RANK_TIERS[tier + 1] ?? null;
  const lo = RANK_TIERS[tier].at;
  return { pts: l.pts, best: l.best, tier, name: RANK_TIERS[tier].name, next: next?.name ?? null, toNext: next ? next.at - l.pts : 0,
    frac: next ? (l.pts - lo) / (next.at - lo) : 1 };
}
/** 着順で段位を動かす（battleNpc から）。 */
function ladderMove(profile, order, diff) {
  const l = profile.ladder ??= { pts: 0, best: 0 };
  const from = tierOf(l.pts), fromPts = l.pts;
  const g = RANK_GAIN(order);
  const m = RANK_DIFF[diff] ?? RANK_DIFF.normal;
  const delta = Math.round(g * (g > 0 ? m.up : m.down));
  l.pts = Math.max(0, l.pts + delta);
  const to = tierOf(l.pts);
  let coins = 0;
  for (let i = l.best + 1; i <= to; i++) coins += RANK_TIERS[i].coins;
  if (to > l.best) l.best = to;
  profile.coins = coinsOf(profile) + coins;
  return { from, to, fromPts, pts: l.pts, delta: l.pts - fromPts, coins, promoted: to > from, demoted: to < from };
}

// ---------------------------------------------------------------- 殿堂
//
// 良かった完成馬を殿堂入りさせると、ホームに飾られる（HALL_MAX 頭まで）。殿堂の馬は手放せない（外してから）。

export const HALL_MAX = 6;
export const hallOf = (profile) => (profile.hall ?? []).filter((id) => profile.finished.some((h) => h.id === id));
export function setHall(profile, id, on) {
  const cur = hallOf(profile);
  if (!on) { profile.hall = cur.filter((x) => x !== id); return true; }
  if (cur.includes(id)) return true;
  if (cur.length >= HALL_MAX) throw new Error(`殿堂は ${HALL_MAX} 頭まで（外してから）`);
  if (!profile.finished.some((h) => h.id === id)) throw new Error('完成馬が無い');
  profile.hall = [...cur, id];
  return true;
}
/** 完成馬を手放す（殿堂の馬は手放せない）。 */
export function releaseFinished(profile, id) {
  if (hallOf(profile).includes(id)) throw new Error('殿堂の馬は手放せない（殿堂から外してから）');
  profile.finished = profile.finished.filter((h) => h.id !== id);
  if (profile.fav === `B${id}`) profile.fav = null;
}

// ---------------------------------------------------------------- カードの組み合わせ
//
// 編成（父・母・サポート 4 枚）に同じ弾・同じ父系・同じ年代（看板のレースの年）のカードが 3 枚以上そろうと、練習の伸びがわずかに上がる。
// 種類ごとにいちばん多い組だけ数える（3 枚 +2%・4 枚 +3%・5 枚 +4%・6 枚 +5%、3 種で最大 +15%）。持っているカードの集め方に目標を作る。
// 始めた時点で決めて run.combo に写す（古い育成は持たないので効かない）。同じ数の組が並んだら、編成の並びで先に出たほう。

export const COMBO_STEP = { 3: 0.02, 4: 0.03, 5: 0.04, 6: 0.05 };
export const COMBO_KINDS = { pack: '同じ弾', line: '同じ父系', era: '同じ年代' };
const comboKey = {
  pack: (c) => c.pack,
  line: (c) => c.line || null,
  era: (c) => (c.race?.year ? String(Math.floor(c.race.year / 10) * 10) : null),
};
const comboLabel = { pack: (k) => `【${PACK_NAMES[k] ?? k}】`, line: (k) => k, era: (k) => `${k}年代` };
/** 編成（カードの id の並び）でそろう組み合わせ。 */
export function comboOf(ids) {
  const cs = ids.map(cardById).filter(Boolean);
  const out = [];
  for (const kind of Object.keys(COMBO_KINDS)) {
    const n = new Map();
    for (const c of cs) { const k = comboKey[kind](c); if (k != null) n.set(k, (n.get(k) ?? 0) + 1); }
    let bk = null, bn = 0;
    for (const [k, v] of n) if (v > bn) { bk = k; bn = v; }
    if (bn >= 3) out.push({ kind, key: bk, label: comboLabel[kind](bk), n: bn, bonus: COMBO_STEP[Math.min(6, bn)] });
  }
  return out;
}
/** 練習の伸びに掛ける値。 */
export const comboMul = (run) => 1 + (run.combo ?? []).reduce((a, c) => a + c.bonus, 0);

// ---------------------------------------------------------------- 保存

const KEY = 'keiba-ikusei-v1';
/** プロフィールを読む（無ければ作る）。localStorage が使えない環境ではメモリだけ。 */
export function loadProfile(storage) {
  try {
    const s = storage?.getItem(KEY);
    if (s) return migrateProfile(JSON.parse(s));
  } catch { /* 読めなければ新しく */ }
  return newProfile(Date.now() & 0xffffff);
}
export function saveProfile(profile, storage) {
  try { storage?.setItem(KEY, JSON.stringify(profile)); } catch { /* 保存できなくても遊べる */ }
}
