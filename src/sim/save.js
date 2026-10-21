// セーブとロード。
//
// world は Map と Set を多用しているので、そのままでは JSON にならない。
// 「配列に落として戻す」だけの素直な変換にしてある。
// 乱数は状態を 4 つの整数で持っているので、セーブの途中で止めても続きが変わらない。

import { makeRng, attach } from '../core/rng.js';
import { resetHorseIds, peekHorseId } from './horse.js';

export const SAVE_VERSION = 2;

const mapToArr = (m) => [...m.entries()];
const arrToMap = (a) => new Map(a ?? []);

export function serialize(g) {
  const w = g.world;
  return {
    v: SAVE_VERSION,
    seed: w.seed,
    startYear: w.startYear,
    year: w.year,
    week: w.week,
    rngState: w.rng.save(),
    nextHorseId: peekHorseId(),
    horses: [...w.horses.values()],
    jockeys: [...w.jockeys.values()],
    trainers: [...w.trainers.values()],
    owners: [...w.owners.values()],
    farms: w.farms,
    nicks: mapToArr(w.nicks),
    nicksStats: mapToArr(w.nicksStats),
    nameSet: [...w.nameSet],
    personNames: [...w.personNames],
    stallionPool: w.stallionPool,
    marePool: w.marePool,
    records: mapToArr(w.records),
    history: w.history,
    awards: w.awards,
    news: w.news,
    log: w.log.slice(-80),
    pendingMatings: w.pendingMatings,
    player: {
      ...w.player,
      entries: mapToArr(w.player.entries),
    },
  };
}

export function deserialize(data) {
  if (!data || data.v > SAVE_VERSION) throw new Error('対応していないセーブデータ');
  const rng = makeRng(1);
  rng.load(data.rngState);
  const world = {
    seed: data.seed,
    startYear: data.startYear,
    year: data.year,
    week: data.week,
    rng,
    horses: new Map(data.horses.map((h) => [h.id, h])),
    jockeys: new Map(data.jockeys.map((j) => [j.id, j])),
    trainers: new Map(data.trainers.map((t) => [t.id, t])),
    owners: new Map(data.owners.map((o) => [o.id, o])),
    farms: data.farms,
    nicks: arrToMap(data.nicks),
    nicksStats: arrToMap(data.nicksStats),
    nameSet: new Set(data.nameSet),
    personNames: new Set(data.personNames),
    stallionPool: data.stallionPool,
    marePool: data.marePool,
    records: arrToMap(data.records),
    results: [],          // レース結果は保存しない（走行ログが巨大になる）
    history: data.history ?? [],
    awards: data.awards ?? [],
    news: data.news ?? [],
    leaders: { jockeys: [], trainers: [], sires: [], owners: [] },
    log: data.log ?? [],
    pendingMatings: data.pendingMatings ?? [],
    player: {
      ...data.player,
      entries: arrToMap(data.player.entries),
    },
  };
  // 馬 id の採番を続きから。
  resetHorseIds(data.nextHorseId ?? 1);
  return { world, version: data.v };
}

export function toJSON(g) {
  return JSON.stringify(serialize(g));
}

export function fromJSON(text) {
  return deserialize(JSON.parse(text));
}

const KEY = 'keiba-sim-save';

/** ブラウザのローカルストレージへ。スロットは 3 つ。 */
export function saveLocal(g, slot = 1) {
  const text = toJSON(g);
  localStorage.setItem(`${KEY}-${slot}`, text);
  localStorage.setItem(`${KEY}-${slot}-meta`, JSON.stringify({
    year: g.world.year, week: g.world.week,
    farm: g.world.player.farmName,
    money: g.world.player.money,
    g1: g.world.player.g1,
    at: Date.now(),
    bytes: text.length,
  }));
  return text.length;
}

export function loadLocal(slot = 1) {
  const text = localStorage.getItem(`${KEY}-${slot}`);
  if (!text) return null;
  return fromJSON(text);
}

export function slotInfo(slot = 1) {
  const m = localStorage.getItem(`${KEY}-${slot}-meta`);
  return m ? JSON.parse(m) : null;
}

export function clearSlot(slot = 1) {
  localStorage.removeItem(`${KEY}-${slot}`);
  localStorage.removeItem(`${KEY}-${slot}-meta`);
}
