// レースの走行ログを Godot へ渡す（godot/data/races/*.json と godot/data/races.json の目録）。
//
// 馬を走らせるのはゲームのシミュレーション（src/sim/race.js の simulateRace）。Godot は走行ログを再生するだけで、
// 結果を作り直さない（three.js の render3d と同じ考え。Godot 側で走らせると、ゲームと違う勝ち馬になる）。
// 出走馬はカード育成のカード（実在馬の表から選んだ値）と、1999 年の凱旋門賞の 14 頭（data/events.js）。
// ログは 0.2 秒ごとの「走った距離 s」と「内ラチからの横位置 off」。周回位置は start + s（course.js と同じ）。
//
//   npm run godot-races

import { writeFileSync, mkdirSync } from 'node:fs';
import { CARDS, runRace } from '../src/sim/ikusei.js';
import { EVENTS } from '../src/sim/data/events.js';
import { buildTrack } from '../src/sim/course.js';

const specOf = (c, id) => ({
  id, name: c.name, sex: c.sex, coat: c.coat, ab: c.v, dist: c.dist, range: c.range,
  turf: c.turf, dirt: c.dirt, firm: c.firm, soft: c.soft, style: c.style,
});
const pool = CARDS.filter((c) => c.pack !== 'EV');
const pick = (filter, n, by) => pool.filter(filter).sort(by).slice(0, n);
const power = (c) => -(c.v.speed + c.v.stamina + c.v.power + c.v.guts + c.v.wit);

const RACES = [
  {
    id: 'japancup', name: 'ジャパンカップ（夢の 18 頭）', courseId: 'tokyo', surface: '芝', distance: 2400, ground: '良',
    field: pick((c) => c.turf >= c.dirt && c.dist >= 1800 && c.dist <= 2800, 18, (a, b) => power(a) - power(b)),
  },
  {
    id: 'arima', name: '有馬記念（夢の 16 頭）', courseId: 'nakayama', surface: '芝', distance: 2500, ground: '良',
    field: pick((c) => c.turf >= c.dirt && c.dist >= 2000 && c.region === 'JP', 16, (a, b) => power(a) - power(b)),
  },
  {
    id: 'february', name: 'フェブラリーS（夢の 16 頭）', courseId: 'tokyo', surface: 'ダート', distance: 1600, ground: '稍重',
    field: pick((c) => c.dirt > c.turf, 16, (a, b) => power(a) - power(b)),
  },
  {
    id: 'bcclassic', name: 'BC クラシック（夢の 14 頭）', courseId: 'santaanita', surface: 'ダート', distance: 2000, ground: '良',
    field: pick((c) => c.dirt > c.turf && c.dist >= 1700, 14, (a, b) => power(a) - power(b)),
  },
  {
    id: 'arc1999', name: '凱旋門賞 1999（史実の 14 頭）', courseId: 'longchamp', surface: '芝', distance: 2400, ground: '不良',
    field: EVENTS[0].field.map((m) => ({ ...m, v: m.ab, turf: 0.9, dirt: 0.4, firm: 0.8 })),
  },
];

const r2 = (v) => Math.round(v * 100) / 100;
mkdirSync('godot/data/races', { recursive: true });
const index = [];
for (const R of RACES) {
  const field = R.field.map((c, i) => specOf(c, 100 + i));
  const res = runRace({ id: R.id, name: R.name, courseId: R.courseId, surface: R.surface, distance: R.distance, ground: R.ground, grade: 'GI' }, field, `godot:${R.id}`);
  const log = res.log;
  const track = buildTrack(R.courseId, R.surface, R.distance);
  const byId = new Map(res.results.map((r) => [r.horseId, r]));
  const cardOf = new Map(field.map((f, i) => [f.id, R.field[i]]));
  const horses = log.ids.map((id, k) => {
    const c = cardOf.get(id);
    const r = byId.get(id);
    const pos = [], off = [];
    for (let f = 0; f < log.frames; f++) { pos.push(r2(log.pos[f * log.n + k])); off.push(r2(log.off[f * log.n + k])); }
    return {
      id, name: log.names[k], gate: log.gates[k], frame: log.frameNos[k], coat: c.coat, sex: c.sex,
      silks: c.silks ?? null, order: r.order, time: r2(r.time), pos, off,
    };
  });
  const out = {
    id: R.id, name: R.name, course: R.courseId, surface: R.surface === 'ダート' ? 'dirt' : 'turf', distance: R.distance,
    ground: R.ground, start: track.start, lap: track.lap, dt: log.dt, frames: log.frames, winnerTime: r2(res.winnerTime), horses,
  };
  writeFileSync(`godot/data/races/${R.id}.json`, JSON.stringify(out));
  const win = horses.find((h) => h.order === 1);
  index.push({ id: R.id, name: R.name, course: R.courseId, surface: out.surface, distance: R.distance, runners: horses.length });
  console.log(`${R.name}：${horses.length} 頭、勝ち ${win.name} ${Math.floor(out.winnerTime / 60)}:${(out.winnerTime % 60).toFixed(1).padStart(4, '0')}`);
}
writeFileSync('godot/data/races.json', JSON.stringify({ races: index }, null, 1));
