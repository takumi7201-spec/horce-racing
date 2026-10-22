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
    realSires: w.realSires,
    real: w.real,
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
    realSires: data.realSires,
    // 実在の馬の id と、名簿に入れ終えた馬。無いと史実の誕生や輸入がロード後に止まる。
    real: data.real ? { ids: data.real.ids ?? {}, entered: data.real.entered ?? [] } : undefined,
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

/**
 * 書き出しを小さくするための置換器。空配列・null・NaN は書かない。
 *
 * 能力値の小数を丸めることも試したが、やめた。
 * 4 桁に丸めると 15% 縮む代わりに、ロードした世界が元の世界とわずかにずれ、
 * 同じ週を進めたときに 2 割ほどのレースで勝ち馬が変わってしまう。
 * セーブは「同じ世界の続き」であるべきなので、精度を優先している。
 */
function shrink(key, value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number' && !Number.isFinite(value)) return undefined;
  if (Array.isArray(value) && value.length === 0) return undefined;
  return value;
}

export function toJSON(g) {
  return JSON.stringify(serialize(g), shrink);
}

export function fromJSON(text) {
  const data = JSON.parse(text);
  // 書き出しで省いた配列を戻す。無いと horse.foals.push で落ちる。
  for (const h of data.horses ?? []) {
    h.record ??= [];
    h.foals ??= [];
    h.notes ??= [];
  }
  data.nameSet ??= [];
  data.personNames ??= [];
  data.history ??= [];
  data.awards ??= [];
  data.pendingMatings ??= [];
  data.player.horses ??= [];
  data.player.broodmares ??= [];
  data.player.stallions ??= [];
  data.player.titles ??= [];
  data.player.entries ??= [];
  return deserialize(data);
}

const KEY = 'keiba-sim-save';
const DB = 'keiba-sim';
const STORE = 'saves';

/**
 * 保存先は IndexedDB。
 * localStorage は 5MB 前後で上限に当たるが、この世界のセーブは
 * 数年回すと 10MB を超える（4000 頭ぶんの血統と戦績があるため）。
 * メタ情報だけは localStorage に置いて、一覧を同期的に出せるようにしている。
 */
function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('IndexedDB が使えない'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB を開けない'));
  });
}

function idbPut(key, value) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

function idbGet(key) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => { resolve(r.result ?? null); };
    r.onerror = () => reject(r.error);
    tx.oncomplete = () => db.close();
  }));
}

function idbDel(key) {
  return openDb().then((db) => new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); resolve(); };
  }));
}

/** スロットへ保存する。戻り値はバイト数。 */
export async function saveLocal(g, slot = 1) {
  const text = toJSON(g);
  await idbPut(`${KEY}-${slot}`, text);
  const meta = {
    year: g.world.year, week: g.world.week,
    farm: g.world.player.farmName,
    money: g.world.player.money,
    g1: g.world.player.g1,
    at: Date.now(),
    bytes: text.length,
  };
  try {
    localStorage.setItem(`${KEY}-${slot}-meta`, JSON.stringify(meta));
  } catch { /* メタが入らなくても本体は保存できている */ }
  return text.length;
}

export async function loadLocal(slot = 1) {
  const text = await idbGet(`${KEY}-${slot}`);
  if (!text) return null;
  return fromJSON(text);
}

/** スロットの概要。一覧表示のため同期で返す。 */
export function slotInfo(slot = 1) {
  try {
    const m = localStorage.getItem(`${KEY}-${slot}-meta`);
    return m ? JSON.parse(m) : null;
  } catch {
    return null;
  }
}

export async function clearSlot(slot = 1) {
  await idbDel(`${KEY}-${slot}`);
  try { localStorage.removeItem(`${KEY}-${slot}-meta`); } catch { /* 無ければそれでよい */ }
}
