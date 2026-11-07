// 海外遠征（米国のレース）。
//
// 番組表の abroad: 'US' のレースには、日本の NPC は出ない。出走馬は
//   1. プレイヤーが登録した馬（遠征費 ABROAD_COST を払う）
//   2. 史実でその年にそのレースへ遠征した日本馬（data/abroad-runs.js。ラニの 2016 年三冠など）
//   3. 海外の実在馬（表の os。その年に走れる年齢で、馬場と距離の合う馬）
// 海外の馬は世界に「海外で現役」の引退馬として居る（落とし穴 56）。日本の育成の週次処理を受けないので、
// 走る週に仕上がり・調子・疲れを整えてから出す。
// 選び方は主乱数を使わない（(シード, レース) から導く。番組を覗いただけで世界がずれないように）。

import { REAL_HORSES } from './data/real-horses.js';
import { ABROAD_RUNS } from './data/abroad-runs.js';
import { makeRng, hashSeed } from '../core/rng.js';
import { distanceAptitude, horseAge, createHorse, resetHorseIds, peekHorseId } from './horse.js';
import { applyTraits } from './realsires.js';
import { SURFACE } from './course.js';
import { SEX } from './params.js';

/** 米国の騎手。海外の馬に乗る（日本の騎手の成績には数えない）。 */
export const FOREIGN_JOCKEYS = [
  ['I.オルティスJr.', 0.86, 0.55], ['J.ロザリオ', 0.85, 0.5], ['F.プラ', 0.84, 0.5], ['J.ヴェラスケス', 0.83, 0.55],
  ['J.カステジャーノ', 0.83, 0.5], ['F.ジェルー', 0.82, 0.5], ['T.ガファリオン', 0.82, 0.5], ['L.サエス', 0.8, 0.6],
  ['J.オルティス', 0.82, 0.55], ['M.スミス', 0.8, 0.45], ['J.ルパルー', 0.8, 0.5], ['J.アルバラード', 0.78, 0.5],
  ['L.デットーリ', 0.84, 0.5], ['R.ムーア', 0.85, 0.45], ['W.ビュイック', 0.83, 0.5], ['T.マーカンド', 0.78, 0.5],
].map(([name, skill, aggression], i) => ({ id: `us${i}`, name, skill, aggression, foreign: true }));

const madeHorse = (world, name) => {
  const id = world.real?.ids?.[name];
  return id != null ? world.horses.get(id) ?? null : null;
};

/** 史実でこの年にこのレースへ遠征した日本馬（世界に居て、走れる状態の NPC だけ）。 */
export function historicalRunners(world, race) {
  const out = [];
  for (const [def, year, name, b] of ABROAD_RUNS) {
    if (def !== race.defId || year !== race.year) continue;
    const h = madeHorse(world, name);
    // 史実の馬そのものか（同名の別馬・この世界で生まれなかった馬は出さない）。プレイヤーの馬はプレイヤーが決める。
    // 海外の一覧に載っている遠征馬（米国産のラニなど）は表で os になり、世界では「海外で現役」の引退馬として居る。
    // その馬は引退の印を見ない。日本の馬は現役でなければ出さない。
    if (!h || h.birthYear !== b || h.dead || (h.retired && !h.foreign) || h.injury || h.ownerId === 'player') continue;
    const age = horseAge(h, race.year);
    if (age < race.age[0] || age > race.age[1]) continue;
    if (race.sex === '牝' && h.sex !== SEX.FEMALE) continue;
    out.push(h);
  }
  return out;
}

/** 史実の遠征馬の騎手は日本の騎手（海外の一覧の馬でも、日本で走っていた馬）。 */
export const isAbroadRunnerOf = (race, h) => ABROAD_RUNS.some(([def, year, name]) => def === race.defId && year === race.year && name === h.name);

/** 馬場の向き（表の surf）。米国のダートは芝馬には走れない。 */
function surfaceFit(d, surface) {
  const s = d.surf ?? 'T';
  if (s === 'TD') return 0.85;
  return (surface === SURFACE.DIRT) === (s === 'D') ? 1 : 0.3;
}

/** 海外の実在馬から、このレースの相手を n 頭選ぶ。 */
export function foreignRunners(world, race, n, exclude = new Set()) {
  const rng = makeRng(hashSeed(`${world.seed}|abroad|${race.raceId}`));
  const cands = [];
  for (const d of REAL_HORSES) {
    if (!d.os || d.lvl == null || d.abroad) continue;
    const age = race.year - d.b;
    // 海外の馬は 8 歳までを現役とみなす（realsires.js の RACING_AGE と同じ）。
    if (age < race.age[0] || age > Math.min(race.age[1], 8)) continue;
    if (race.sex === '牝' && d.s !== '牝') continue;
    const h = madeHorse(world, d.n);
    if (!h || h.dead || exclude.has(h.id) || h.ownerId === 'player' || h.stallion || h.broodmare) continue;
    const sFit = surfaceFit(d, race.surface);
    const dFit = distanceAptitude(h, race.distance);
    if (sFit < 0.5 || dFit < 0.45) continue;
    // 牡馬混合のレースに牝馬はまず出てこない（ケンタッキーダービーに牝馬が出るのは数年に一度）。
    // 能力の順で選ぶと、牝馬の名馬が三冠とトラヴァーズを総なめにした（1985 年開始のマムズコマンド）。
    const filly = !race.sex && d.s === '牝' ? 0.55 : 1;
    cands.push({ h, score: d.lvl * sFit * dFit * filly * (0.92 + rng.next() * 0.16) });
  }
  return cands.sort((a, b) => b.score - a.score).slice(0, n).map((x) => x.h);
}

/** 走る週に整える。海外の馬は日本の週次の調教を受けないので、出走のたびに仕上げる。 */
export function readyAbroad(h, foreign) {
  h.fit = Math.max(h.fit ?? 0, foreign ? 0.9 : 0.8);
  h.cond = Math.max(h.cond ?? 0, 0.7);
  if (foreign) h.fatigue = 0;
  h.stable = foreign ? h.stable : 'stable';
}

/**
 * 架空の海外馬。表の海外馬は取り込んだ年までしか居ない（2027 年からは 3 歳の海外馬が居ず、三冠が不成立になった。
 * 2031 年には BC も頭数が欠けた）。足りない頭数は、そのレースのためだけに作った馬で埋める。
 * 世界には足さない（world.horses に入れない。結果の反映は居ない馬を飛ばす）。id は別の帯で採って採番を戻す
 * （落とし穴 14・47。セーブとロード後の 1 週を変えない）。乱数も主乱数と別。
 */
export const GHOST_ID_BASE = 2e9;
const GHOST_M = [['ゴールデン', 'ワイルド', 'ロイヤル', 'ブライト', 'グランド', 'ノーザン', 'サザン', 'ラッキー', 'ファスト', 'ミスター',
  'キャプテン', 'ナイト', 'ハイ', 'ビッグ', 'トゥルー', 'フリー', 'ダンシング', 'アイアン', 'ブラック', 'ケンタッキー'],
['ストライク', 'ランナー', 'キャット', 'ダンサー', 'チーフ', 'サンダー', 'ホーク', 'ウインド', 'フレーム', 'ロード', 'クエスト',
  'ヒーロー', 'ジャーニー', 'ブレイズ', 'ストーム', 'フォース', 'パレード', 'レンジャー', 'アロー', 'マーシャル']];
const GHOST_F = [['ミス', 'レディ', 'クイーン', 'プリンセス', 'スウィート', 'ラヴリー', 'ブルー', 'シルヴァー', 'ゴールデン', 'ワイルド'],
['ベル', 'ローズ', 'ダンス', 'ミスト', 'ハート', 'ジュエル', 'メロディ', 'グレース', 'リリー', 'スター', 'ドリーム', 'ソング']];
const STYLES_US = ['逃', '先', '先', '差', '差', '追'];

export function ghostRunners(world, race, n, takenNames = new Set()) {
  if (n <= 0) return [];
  const rng = makeRng(hashSeed(`${world.seed}|ghost|${race.raceId}`));
  const female = race.sex === '牝';
  const parts = female ? GHOST_F : GHOST_M;
  const saved = peekHorseId();
  resetHorseIds(GHOST_ID_BASE + (hashSeed(race.raceId) % 1e6) * 20);
  const out = [];
  try {
    for (let i = 0, tries = 0; out.length < n && tries < n * 20; tries++) {
      const name = rng.pick(parts[0]) + rng.pick(parts[1]);
      if (takenNames.has(name) || world.nameSet?.has(name)) continue;
      takenNames.add(name);
      const age = race.age[1] <= race.age[0] ? race.age[0] : race.age[0] + rng.int(Math.min(4, race.age[1] - race.age[0] + 1));
      // 能力は表の海外の GI 級（史実馬の一覧のスピード 66〜80）に合わせる。
      const d = {
        n: name, b: race.year - age, s: female ? '牝' : '牡',
        lvl: 0.66 + rng.next() * 0.12, dist: Math.round((race.distance + (rng.next() - 0.5) * 500) / 100) * 100,
        range: 400 + rng.int(400), surf: race.surface === SURFACE.DIRT ? 'D' : 'T', style: rng.pick(STYLES_US),
      };
      const h = createHorse(rng, { name, sex: female ? SEX.FEMALE : SEX.MALE, birthYear: d.b });
      applyTraits(h, d);
      h.real = false;
      h.ghost = true;
      h.foreign = true;
      h.retired = true;
      readyAbroad(h, true);
      out.push(h);
      i++;
    }
  } finally {
    resetHorseIds(saved);
  }
  return out;
}
