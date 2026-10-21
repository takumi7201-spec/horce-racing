// 走路の 3D ジオメトリ。
//
// レースシミュレーションが使っているのと同じ course.js の幾何から作るので、
// 画面に見えている走路と、馬が走っている走路は必ず一致する。
// 「見た目を合わせるために別の形を描く」ことをしないのが要点。

import * as THREE from '../../vendor/three/three.module.min.js';
import { posToWorld, elevationAt, trackBounds, SURFACE } from '../sim/course.js';
import { yawForXForward } from './orient.js';

/** 走路に沿って頂点を並べる刻み（m）。細かくするとコーナーがなめらかになる。 */
const STEP = 5;

const COLORS = {
  // 走路と内馬場をはっきり分ける。同系の緑にすると、画面上で
  // どこが走路なのか分からなくなる（実際そうなって作り直した）。
  turf: [0x35823c, 0x4aa054],      // 芝。刈り込みの縞を 2 色で出す
  dirt: [0x80603e, 0x9a7a52],      // ダート
  infield: 0x1b3f18,
  outfield: 0x20471c,
  rail: 0xf2f2f2,
  railPost: 0xdddddd,
  stand: 0xb9bec6,
  standRoof: 0x6f7883,
  finish: 0xffffff,
  furlong: 0xf0e8d0,
};

/**
 * 走路（オーバルのリボン）を作る。
 * 芝コースの上にダートコースは作らない。1 レース分だけ描く。
 */
function buildSurface(track, { surface, inner = 0, outer = null, stripe = 20 }) {
  const out = outer ?? track.width;
  const n = Math.ceil(track.lap / STEP);
  const closed = !track.straightCourse;
  const count = closed ? n : n + 1;

  const pos = new Float32Array(count * 2 * 3);
  const col = new Float32Array(count * 2 * 3);
  const uv = new Float32Array(count * 2 * 2);
  const palette = surface === SURFACE.DIRT ? COLORS.dirt : COLORS.turf;
  const c0 = new THREE.Color(palette[0]);
  const c1 = new THREE.Color(palette[1]);

  for (let i = 0; i < count; i++) {
    const p = (i * track.lap) / n;
    const a = posToWorld(track, p, inner);
    const b = posToWorld(track, p, out);
    const y = elevationAt(track, p);
    pos[i * 6 + 0] = a.x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = a.z;
    pos[i * 6 + 3] = b.x; pos[i * 6 + 4] = y; pos[i * 6 + 5] = b.z;
    // 刈り込みの縞。進行方向に一定間隔で色を変える。
    const c = Math.floor(p / stripe) % 2 === 0 ? c0 : c1;
    for (let k = 0; k < 2; k++) {
      col[i * 6 + k * 3 + 0] = c.r;
      col[i * 6 + k * 3 + 1] = c.g;
      col[i * 6 + k * 3 + 2] = c.b;
    }
    uv[i * 4 + 0] = 0; uv[i * 4 + 1] = p / 20;
    uv[i * 4 + 2] = 1; uv[i * 4 + 3] = p / 20;
  }

  const idx = [];
  const segs = closed ? count : count - 1;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % count;
    const a0 = i * 2, a1 = i * 2 + 1, b0 = j * 2, b1 = j * 2 + 1;
    idx.push(a0, b0, a1, a1, b0, b1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  // 法線は上向きに固定する。computeVertexNormals に任せると、
  // リボンの巻き方向によっては全面が下向きになり、半球光の「地面色」で
  // 照らされて走路が内馬場と同じ暗さになる（実際そうなって気づけなかった）。
  geo.setAttribute('normal', new THREE.BufferAttribute(upNormals(count * 2), 3));
  return geo;
}

/** すべて上向きの法線。ほぼ水平な面に使う。 */
function upNormals(n) {
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a[i * 3 + 1] = 1;
  return a;
}

/** ラチ（柵）。内と外に立てる。 */
function buildRail(track, off, { height = 1.1, thickness = 0.12 } = {}) {
  const n = Math.ceil(track.lap / STEP);
  const closed = !track.straightCourse;
  const count = closed ? n : n + 1;
  const pos = new Float32Array(count * 2 * 3);
  for (let i = 0; i < count; i++) {
    const p = (i * track.lap) / n;
    const w = posToWorld(track, p, off);
    const y = elevationAt(track, p);
    pos[i * 6 + 0] = w.x; pos[i * 6 + 1] = y + height - thickness; pos[i * 6 + 2] = w.z;
    pos[i * 6 + 3] = w.x; pos[i * 6 + 4] = y + height; pos[i * 6 + 5] = w.z;
  }
  const idx = [];
  const segs = closed ? count : count - 1;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % count;
    idx.push(i * 2, j * 2, i * 2 + 1, i * 2 + 1, j * 2, j * 2 + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 内馬場（芝の島）。走路の内側を中心からの扇で塗る。
 *
 * ShapeGeometry を水平に倒す作りだと平面になってしまい、
 * 中山のように高低差 5m のコースでは走路（坂で下がっている）を
 * 内馬場が上から覆い隠す。縁の高さを走路に合わせるためにこの形にした。
 */
function buildInfield(track) {
  const n = Math.ceil(track.lap / STEP);
  const pos = new Float32Array((n + 1) * 3);
  let cx = 0, cz = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const p = (i * track.lap) / n;
    const w = posToWorld(track, p, -0.4);
    const y = elevationAt(track, p) - 0.06;
    pos[(i + 1) * 3] = w.x; pos[(i + 1) * 3 + 1] = y; pos[(i + 1) * 3 + 2] = w.z;
    cx += w.x; cz += w.z; cy += y;
  }
  pos[0] = cx / n; pos[1] = cy / n - 0.4; pos[2] = cz / n;
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(0, 1 + i, 1 + ((i + 1) % n));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.setAttribute('normal', new THREE.BufferAttribute(upNormals(n + 1), 3));
  return geo;
}

/** コース全体の標高の範囲。遠景の地面を走路より下に置くために要る。 */
function elevationRange(track) {
  let lo = Infinity, hi = -Infinity;
  for (let p = 0; p < track.lap; p += 10) {
    const e = elevationAt(track, p);
    if (e < lo) lo = e;
    if (e > hi) hi = e;
  }
  return { lo, hi };
}

/** ゴール板・ハロン棒・残り距離の標識。 */
function buildMarkers(track, group) {
  const lineMat = new THREE.MeshBasicMaterial({ color: COLORS.finish });
  // ゴール板のライン（走路を横切る白線）。
  {
    const a = posToWorld(track, 0, 0);
    const b = posToWorld(track, 0, track.width);
    const y = elevationAt(track, 0) + 0.02;
    const geo = new THREE.BufferGeometry();
    const dx = Math.cos(a.heading) * 0.35, dz = Math.sin(a.heading) * 0.35;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      a.x - dx, y, a.z - dz, b.x - dx, y, b.z - dz,
      a.x + dx, y, a.z + dz, b.x + dx, y, b.z + dz,
    ]), 3));
    geo.setIndex([0, 1, 2, 2, 1, 3]);
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, lineMat));
  }
  // ハロン棒（200m ごと）。内ラチの外側に小さな棒を立てる。
  const poleGeo = new THREE.BoxGeometry(0.22, 1.5, 0.22);
  const poleMat = new THREE.MeshLambertMaterial({ color: COLORS.furlong });
  const marks = Math.floor(track.lap / 200);
  for (let i = 1; i <= marks; i++) {
    const rem = i * 200;
    const p = ((track.lap - rem) % track.lap + track.lap) % track.lap;
    const w = posToWorld(track, p, 0.6);
    const m = new THREE.Mesh(poleGeo, poleMat);
    m.position.set(w.x, elevationAt(track, p) + 0.75, w.z);
    group.add(m);
  }
}

/** スタンド。ホームストレッチの外側に長く置く。 */
function buildStand(track, group) {
  // 直線の中ほど（ゴール板の手前）に沿わせる。
  const from = track.lap - track.homeStraight;
  const len = track.homeStraight + 60;
  const n = 14;
  const standMat = new THREE.MeshLambertMaterial({ color: COLORS.stand });
  const roofMat = new THREE.MeshLambertMaterial({ color: COLORS.standRoof });
  const segLen = len / n;
  // 走路から 34m 離す。近すぎると「ゴール前」カメラがスタンドの中に入る。
  const off = track.width + 34;
  for (let i = 0; i < n; i++) {
    const p = from + i * segLen + segLen / 2;
    const w = posToWorld(track, p, off);
    const y = elevationAt(track, p);
    const h = 22;
    const box = new THREE.Mesh(new THREE.BoxGeometry(segLen * 1.02, h, 40), standMat);
    box.position.set(w.x, y + h / 2, w.z);
    box.rotation.y = yawForXForward(w.heading);  // 長辺がローカル +X
    group.add(box);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(segLen * 1.02, 1.2, 48), roofMat);
    roof.position.set(w.x, y + h + 0.6, w.z);
    roof.rotation.y = yawForXForward(w.heading);
    group.add(roof);
  }
}

/** 遠景。走路の外に地面と木を置く。何も無いと浮いて見える。 */
function buildSurrounds(track, group, rng = Math.random) {
  const b = trackBounds(track);
  const { lo } = elevationRange(track);
  const base = lo - 1.5;   // 走路より必ず下。でないと外周が走路を隠す
  const w = (b.maxX - b.minX) * 2.4;
  const d = (b.maxZ - b.minZ) * 2.4;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshLambertMaterial({ color: COLORS.outfield }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(b.cx, base, b.cz);
  group.add(ground);

  // 木。インスタンス描画でまとめる。
  const trunkGeo = new THREE.CylinderGeometry(0.4, 0.5, 3, 5);
  const crownGeo = new THREE.ConeGeometry(2.6, 6, 7);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a3a28 });
  const crownMat = new THREE.MeshLambertMaterial({ color: 0x1f4a1c });
  const N = 160;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, N);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, N);
  const m = new THREE.Matrix4();
  let k = 0;
  for (let i = 0; i < N * 4 && k < N; i++) {
    const x = b.cx + (rng() - 0.5) * w * 0.85;
    const z = b.cz + (rng() - 0.5) * d * 0.85;
    // 走路の内側と外周のすぐ外は空けておく。
    const dx = Math.abs(x - b.cx) / ((b.maxX - b.minX) / 2);
    const dz = Math.abs(z - b.cz) / ((b.maxZ - b.minZ) / 2);
    const r = Math.hypot(dx, dz);
    if (r < 1.25) continue;
    const s = 0.7 + rng() * 0.9;
    m.makeScale(s, s, s);
    m.setPosition(x, base + 1.5 * s, z);
    trunks.setMatrixAt(k, m);
    m.setPosition(x, base + 6 * s, z);
    crowns.setMatrixAt(k, m);
    k++;
  }
  trunks.count = k; crowns.count = k;
  group.add(trunks, crowns);
}

/**
 * コース一式を作って Group で返す。
 * @param {object} track buildTrack の返り値
 */
export function buildTrackMesh(track, { stand = true, surrounds = true, rng = Math.random } = {}) {
  const group = new THREE.Group();
  group.name = 'track';

  const surfMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const surf = new THREE.Mesh(buildSurface(track, { surface: track.surface }), surfMat);
  surf.receiveShadow = true;
  group.add(surf);

  if (!track.straightCourse) {
    group.add(new THREE.Mesh(
      buildInfield(track),
      new THREE.MeshLambertMaterial({ color: COLORS.infield, side: THREE.DoubleSide }),
    ));
  }

  // ラチは細い板なので、光の当たり方より「白い線」として見えることが大事。
  const railMat = new THREE.MeshBasicMaterial({ color: COLORS.rail, side: THREE.DoubleSide });
  group.add(new THREE.Mesh(buildRail(track, 0.1), railMat));
  group.add(new THREE.Mesh(buildRail(track, track.width - 0.1, { height: 1.3 }), railMat));

  buildMarkers(track, group);
  if (stand && !track.straightCourse) buildStand(track, group);
  if (surrounds) buildSurrounds(track, group, rng);

  return group;
}

/** 周回位置と横位置から 3D の座標を引く。馬の配置に使う。 */
export function trackPoint(track, p, off, out = new THREE.Vector3()) {
  const w = posToWorld(track, p, off);
  out.set(w.x, elevationAt(track, p), w.z);
  return { point: out, heading: w.heading, curvature: w.curvature };
}

export { COLORS as TRACK_COLORS };
