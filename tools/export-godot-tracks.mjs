// 競馬場の形を Godot へ渡す（godot/data/tracks.json）。
//
// Godot の競馬場（godot/scripts/racecourse.gd）は、ゲームのレースが走っているのと同じ course.js の幾何を
// この JSON から読んで組み立てる。Godot の側でオーバルを作り直すと、レースの走路と画面の走路が二つに割れる
// （src/render3d/track.js の冒頭と同じ考え）。course.js を変えたら `npm run godot-tracks` で書き出し直すこと。
//
// 1 周を STEP m ごとに刻み、各点で 内ラチの位置（x, z）・標高 y・外向きの単位ベクトル（nx, nz）・進行方向・曲率を持つ。
// 横位置 off の点は (x + nx·off, z + nz·off)。直線でもコーナーでも posToWorld(p, off) と一致する（コーナーは半径が off だけ伸びる）。

import { writeFileSync, mkdirSync } from 'node:fs';
import { allCourses, buildTrack, posToWorld, elevationAt, trackBounds, SURFACE } from '../src/sim/course.js';

const STEP = 5;
const r3 = (v) => Math.round(v * 1000) / 1000;

const out = { version: 1, step: STEP, courses: [] };
for (const c of allCourses()) {
  for (const [key, surface] of [['turf', SURFACE.TURF], ['dirt', SURFACE.DIRT]]) {
    const spec = c[key];
    if (!spec) continue;   // 芝だけの場（ロンシャン）
    // 距離はオーバルの幾何に効かない（発走位置だけ）。直線 1000m（新潟）は別の形なので、周回の距離で作る
    const t = buildTrack(c.id, surface, spec.distances.find((d) => d !== spec.straightOnly) ?? spec.distances[0]);
    const n = Math.ceil(t.lap / STEP);
    const pts = [];
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = (i * t.lap) / n;
      const a = posToWorld(t, p, 0);
      const b = posToWorld(t, p, 1);
      const y = elevationAt(t, p);
      lo = Math.min(lo, y); hi = Math.max(hi, y);
      const nx = b.x - a.x, nz = b.z - a.z;
      const len = Math.hypot(nx, nz) || 1;
      pts.push([r3(p), r3(a.x), r3(a.z), r3(y), r3(nx / len), r3(nz / len), r3(a.heading), r3(a.curvature)]);
    }
    const b = trackBounds(t);
    out.courses.push({
      id: c.id, name: c.name, short: c.short ?? c.name, region: c.region, abroad: c.abroad ?? null,
      surface: key, dir: c.dir > 0 ? 'right' : 'left',
      lap: t.lap, width: t.width, homeStraight: t.homeStraight, toFirst: t.toFirst, back: t.back, radius: r3(t.radius), rise: t.rise,
      distances: spec.distances,
      elevation: { lo: r3(lo), hi: r3(hi) },
      bounds: { minX: r3(b.minX), maxX: r3(b.maxX), minZ: r3(b.minZ), maxZ: r3(b.maxZ) },
      // [周回位置 p, 内ラチ x, z, 標高 y, 外向き nx, nz, 進行方向, 曲率]
      points: pts,
    });
  }
}

mkdirSync('godot/data', { recursive: true });
writeFileSync('godot/data/tracks.json', JSON.stringify(out));
console.log(`godot/data/tracks.json：${out.courses.length} コース（${out.courses.map((c) => `${c.name}${c.surface === 'turf' ? '芝' : 'ダ'}`).join('・')}）`);
