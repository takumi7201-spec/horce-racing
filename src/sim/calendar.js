// 牧場の年間スケジュール。
//
// レースの番組（schedule.js）とは別に、牧場側の行事を週で持つ。
// 誕生は 4 月、種付けは 5〜6 月、セールは 8 月（当歳）・10 月（繁殖牝馬）・
// 12 月 3 週（海外トレーニングセール・庭先取引）、12 月 4 週で入厩先と馬名を決め、
// 年末処理（表彰・引退・登録）で年が替わる。

import { W } from './schedule.js';

export const EVENTS = [
  { id: 'foaling', from: W(4, 1), to: W(4, 1), when: '4月',
    name: '幼駒の誕生', desc: '前年の 5〜6 月に種付けした繁殖牝馬が出産する' },
  { id: 'covering', from: W(5, 1), to: W(6, 4), when: '5〜6月',
    name: '種付け', desc: '繁殖牝馬に種牡馬を配合する。6 月末に受胎が分かる' },
  { id: 'foalSale', from: W(8, 1), to: W(8, 4), when: '8月',
    name: '当歳セール', desc: '今年生まれた幼駒（0 歳）のセール' },
  { id: 'mareSale', from: W(10, 1), to: W(10, 4), when: '10月',
    name: '繁殖牝馬セール', desc: '実在の名牝と、ほかの牧場の繁殖牝馬を買える' },
  { id: 'overseas', from: W(12, 3), to: W(12, 3), when: '12月3週',
    name: '海外トレーニングセール', desc: '外国の 1 歳馬・繁殖牝馬の購入' },
  { id: 'private', from: W(12, 3), to: W(12, 4), when: '12月3〜4週',
    name: '庭先取引', desc: '売れ残った 1 歳馬を牧場から直接買う。12 月 4 週が最終チャンス' },
  { id: 'entry', from: W(12, 4), to: W(12, 4), when: '12月4週',
    name: '入厩・馬名登録', desc: '来年 2 歳になる馬の入厩先（調教師）と馬名を決める' },
  { id: 'yearEnd', from: W(12, 4), to: W(12, 4), when: '年末',
    name: '年末処理', desc: '表彰式・引退馬の決定・種牡馬と繁殖牝馬の登録・馬名登録・牧場の確認' },
];

const BY_ID = new Map(EVENTS.map((e) => [e.id, e]));

/** その週に行事が開かれているか。 */
export function eventOpen(id, week) {
  const e = BY_ID.get(id);
  return !!e && week >= e.from && week <= e.to;
}

/** その週の行事。 */
export const eventsAt = (week) => EVENTS.filter((e) => week >= e.from && week <= e.to);

/** 次に開かれる行事（今週を含む）。年をまたぐときは来年の最初の行事。 */
export function nextEvent(week) {
  return EVENTS.find((e) => e.to >= week) ?? EVENTS[0];
}

export const eventById = (id) => BY_ID.get(id);
