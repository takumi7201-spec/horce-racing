// 走路の 3D ジオメトリ。
//
// レースシミュレーションが使っているのと同じ course.js の幾何から作るので、
// 画面に見えている走路と、馬が走っている走路は必ず一致する。
// 「見た目を合わせるために別の形を描く」ことをしないのが要点。

import * as THREE from '../../vendor/three/three.module.min.js';
import { posToWorld, elevationAt, trackBounds, SURFACE } from '../sim/course.js';
import { yawForXForward, yawForZForward } from './orient.js';

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
  geo.setIndex(faceUp(pos, idx));
  // 法線は上向きに固定する。computeVertexNormals に任せると、
  // リボンの巻き方向によっては全面が下向きになり、半球光の「地面色」で
  // 照らされて走路が内馬場と同じ暗さになる（実際そうなって気づけなかった）。
  geo.setAttribute('normal', new THREE.BufferAttribute(upNormals(count * 2), 3));
  return geo;
}

/** すべて上向きの法線。ほぼ水平な面に使う。 */
/**
 * 上を向く面の巻きをそろえる（Godot 版の _face_up と同じ）。法線を上に固定しても、両面描き（DoubleSide）では
 * 裏から見た面の法線を three.js が反転するので、巻きが下を向いた面は半球光の「地面色」で照らされて黒く沈んだ
 * （右回りの場で走路の芝がほぼ黒だった。落とし穴 3 の続き）。三角形ごとに、面の向きが下なら頂点の順を入れ替える。
 */
function faceUp(pos, idx) {
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = pos[b] - pos[a], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vz = pos[c + 2] - pos[a + 2];
    // (u × v).y = uz·vx − ux·vz。three.js の表は反時計回りなので、これが負なら下を向いている
    if (uz * vx - ux * vz < 0) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  }
  return idx;
}

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
  geo.setIndex(faceUp(pos, idx));
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

/**
 * スタンド（Godot 版の競馬場から移したもの）：前庭（舗装）と立ち見、下の段 14 段・張り出したバルコニーの上の段 10 段、
 * ガラス張りの建屋と屋根と柱、段の上に観客（色は服の色。空席も混ぜる）。
 * 走路から 32m 奥から段を始める（近すぎると「ゴール前」カメラがスタンドの中に入る）。
 * 観客は 1 人を小さな箱 1 つにして InstancedMesh でまとめる（数千人を 1 回で描く）。
 */
const CROWD = [0xf2f2f2, 0x1f2433, 0xbf3434, 0x3459b3, 0xd9bf4d, 0x595960, 0x8c6b4d, 0xe68ca6];
function buildStand(track, group, rng = Math.random) {
  const w = track.width;
  const p0 = track.lap - track.homeStraight * 0.8;
  const p1 = track.lap + 70;
  const a = posToWorld(track, p0, w), b = posToWorld(track, p1, w);
  const ax = b.x - a.x, az = b.z - a.z;
  const length = Math.hypot(ax, az);
  const dx = ax / length, dz = az / length;
  // 外向き（直線なので一定）
  const o0 = posToWorld(track, p1, w + 1);
  const ox = o0.x - b.x, oz = o0.z - b.z;
  const baseY = Math.min(elevationAt(track, p0), elevationAt(track, p1));
  const yaw = yawForXForward(Math.atan2(dz, dx));   // 長辺がローカル +X
  const midX = (a.x + b.x) / 2, midZ = (a.z + b.z) / 2;
  const standMat = new THREE.MeshLambertMaterial({ color: 0xccced4 });
  const box = (d0, d1, y0, y1, mat, lenScale = 1) => {
    if (y0 === 0) y0 = -3;   // 地面から立つ箱は下へ伸ばす（外ラチの外は遠景へ下っていくので、足もとに隙間が見える）
    const m = new THREE.Mesh(new THREE.BoxGeometry(length * lenScale, y1 - y0, d1 - d0), mat);
    const c = (d0 + d1) / 2;
    m.position.set(midX + ox * c, baseY + (y0 + y1) / 2, midZ + oz * c);
    m.rotation.y = yaw;
    group.add(m);
    return m;
  };
  // 前庭（舗装）
  {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(length, 26), new THREE.MeshLambertMaterial({ color: 0x807b73 }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -Math.atan2(dz, dx);
    m.position.set(midX + ox * 19, baseY + 0.06, midZ + oz * 19);
    group.add(m);
  }
  const spots = [];
  const d0 = 32, tiers = 14;
  for (let k = 0; k < tiers; k++) {
    const yTop = 1.6 + (k + 1) * 0.42;
    box(d0 + k * 0.9, d0 + (k + 1) * 0.9, 0, yTop, standMat);
    spots.push([d0 + k * 0.9 + 0.45, yTop]);
  }
  const d1 = d0 + tiers * 0.9 + 2;
  box(d0 + tiers * 0.9, d1 + 1, 0, 9.5, standMat);
  box(d1 - 3, d1 - 2.4, 9.5, 11, new THREE.MeshLambertMaterial({ color: 0x40464f }));
  for (let k = 0; k < 10; k++) {
    const yTop = 11 + (k + 1) * 0.5;
    box(d1 - 2.4 + k * 0.95, d1 - 2.4 + (k + 1) * 0.95, 9.5, yTop, standMat);
    spots.push([d1 - 2.4 + k * 0.95 + 0.47, yTop]);
  }
  const back = d1 - 2.4 + 10 * 0.95;
  box(back, back + 22, 0, 27, standMat);
  const glass = new THREE.MeshPhongMaterial({ color: 0x38526b, shininess: 80, specular: 0x9fb6c8 });
  box(back - 0.3, back, 17.5, 26, glass, 0.98);
  box(back - 0.3, back, 2, 8.5, glass, 0.98);
  box(d0 - 4, back + 22, 27, 27.8, new THREE.MeshLambertMaterial({ color: 0x4d5766 }), 1.02);
  const colGeo = new THREE.BoxGeometry(0.6, 27, 0.6);
  for (let k = 0; k < 9; k++) {
    const m = new THREE.Mesh(colGeo, standMat);
    const t = (length * (k + 0.5)) / 9;
    m.position.set(a.x + dx * t + ox * (back - 1), baseY + 13.5, a.z + dz * t + oz * (back - 1));
    group.add(m);
  }
  // 観客：段の上と、前庭の立ち見（大きなレースの日はラチ沿いまで人で埋まる。ラチに近いほど密に）
  const people = [];
  for (const [d, y] of spots) {
    for (let t = 0; t < length - 1;) {
      t += 0.62 + rng() * 0.25;
      if (rng() < 0.9) people.push([t, d, y + 0.42]);
    }
  }
  for (let d = 7; d < 30; d += 0.85) {
    const dens = 0.85 - ((d - 7) / 23) * 0.5;
    for (let t = 0; t < length - 1;) {
      t += 0.55 + rng() * 0.3;
      if (rng() < dens) people.push([t, d + rng() * 0.4, 0.06 + 0.42 + rng() * 0.08]);
    }
  }
  const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 0.85, 0.4), new THREE.MeshLambertMaterial({ color: 0xffffff }), people.length);
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const one = new THREE.Vector3(1, 1, 1);
  const col = new THREE.Color();
  people.forEach(([t, d, y], i) => {
    mtx.compose(new THREE.Vector3(a.x + dx * t + ox * d, baseY + y, a.z + dz * t + oz * d), q, one);
    crowd.setMatrixAt(i, mtx);
    crowd.setColorAt(i, col.setHex(CROWD[Math.floor(rng() * CROWD.length)]));
  });
  group.add(crowd);
}

/**
 * 発馬機（ゲート）：発走位置に、頭数ぶんの枠を走路を横切って並べる。前の扉は開いた形（馬は走り抜ける）。
 * 仕切りの板は下を開けて脚を見せる。色は白と深緑、外側に係員の台と車輪。Godot 版から移したもの。
 * 馬の横の位置は発走の直後だけ枠の幅に広げる（raceview.js の stateAt）。
 */
export function buildGate(track, start, count, { gateW = 1.05, railGap = 1 } = {}) {
  const g = new THREE.Group();
  g.name = 'gate';
  const p0 = start + 0.9;   // 前の扉の線（馬の鼻先より少し前）
  const depth = 3;
  const white = new THREE.MeshLambertMaterial({ color: 0xedefeb });
  const green = new THREE.MeshLambertMaterial({ color: 0x295c42 });
  const pad = new THREE.MeshLambertMaterial({ color: 0x1f334d });
  const hd = posToWorld(track, p0 - depth / 2, 0).heading;
  const yaw = yawForZForward(hd);   // ローカルの +Z が前、+X が横
  const put = (geo, mat, off, along, y) => {
    const w = posToWorld(track, p0 - along, off);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(w.x, elevationAt(track, p0 - along) + y, w.z);
    m.rotation.y = yaw;
    g.add(m);
    return m;
  };
  const board = new THREE.BoxGeometry(0.08, 1.3, depth);
  const post = new THREE.BoxGeometry(0.12, 2.9, 0.12);
  for (let k = 0; k <= count; k++) {
    const off = railGap + (k - 0.5) * gateW;
    put(board, k % 2 === 0 ? pad : green, off, depth / 2, 1.15);
    put(post, white, off, 0, 1.45);
    put(post, white, off, depth, 1.45);
  }
  const span = (count + 1) * gateW;
  const cen = railGap + ((count - 1) * gateW) / 2;
  const beam = new THREE.BoxGeometry(span + 0.4, 0.35, 0.3);
  put(beam, green, cen, 0, 2.85);
  put(beam, green, cen, depth, 2.85);
  put(new THREE.BoxGeometry(span + 0.4, 0.08, depth), white, cen, depth / 2, 3);
  const door = new THREE.BoxGeometry(0.04, 1.1, gateW * 0.48);
  for (let k = 0; k < count; k++) {
    const off = railGap + k * gateW;
    for (const side of [-1, 1]) put(door, white, off + side * gateW * 0.5, -gateW * 0.24, 1.15);
  }
  put(new THREE.BoxGeometry(1.6, 3.6, depth), green, cen + span / 2 + 0.9, depth / 2, 1.8);
  const wheel = new THREE.CylinderGeometry(0.45, 0.45, 0.3, 14);
  for (const off of [railGap - gateW, cen + span / 2 + 0.9]) {
    const m = put(wheel, pad, off, depth / 2, 0.45);
    m.rotation.z = Math.PI / 2;
  }
  // 馬番：前の梁に数字の板（字はキャンバスで描く。数字だけ。落とし穴 16）
  for (let k = 0; k < count; k++) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = '#295c42'; x.fillRect(0, 0, 64, 64);
    x.fillStyle = '#fff'; x.font = 'bold 44px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(String(k + 1), 32, 34);
    const tex = new THREE.CanvasTexture(c);
    const m = put(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: tex }), railGap + k * gateW, -0.16, 2.85);
    // 板は前（走ってくる側から読める）へ向ける
    m.rotation.y = yaw;
  }
  return g;
}

/** 遠景。走路の外に地面と木を置く。何も無いと浮いて見える。 */
function buildSurrounds(track, group, rng = Math.random, winter = false) {
  const b = trackBounds(track);
  const { lo } = elevationRange(track);
  const base = lo - 1.5;   // 走路より必ず下。でないと外周が走路を隠す
  const w = (b.maxX - b.minX) * 2.4;
  const d = (b.maxZ - b.minZ) * 2.4;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshLambertMaterial({ color: winter ? 0x5f5833 : COLORS.outfield }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(b.cx, base, b.cz);
  group.add(ground);

  // 木。インスタンス描画でまとめる。
  const trunkGeo = new THREE.CylinderGeometry(0.4, 0.5, 3, 5);
  // 丸い樹冠（Godot 版と同じ。円錐は針葉樹の植林に見えた）
  const crownGeo = new THREE.SphereGeometry(3.4, 10, 8);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a3a28 });
  const crownMat = new THREE.MeshLambertMaterial({ color: 0x3f6e33 });
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
    m.setPosition(x, base + 5.4 * s, z);
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
export function buildTrackMesh(track, { stand = true, surrounds = true, rng = Math.random, winter = false } = {}) {
  const group = new THREE.Group();
  group.name = 'track';

  const surfMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const surf = new THREE.Mesh(buildSurface(track, { surface: track.surface }), surfMat);
  surf.receiveShadow = true;
  group.add(surf);

  if (!track.straightCourse) {
    group.add(new THREE.Mesh(
      buildInfield(track),
      // 冬は内馬場の野芝が茶色く休む（走路は洋芝を播いて緑のまま）
      new THREE.MeshLambertMaterial({ color: winter ? 0x5e5530 : COLORS.infield, side: THREE.DoubleSide }),
    ));
  }

  // 米国の競馬場は芝コースがダートの内側にある（日本と逆）。ダートのレースでは内ラチの内に芝の帯を敷く。
  // 敷かないと内馬場が日本と同じ暗い緑一色になり、米国の競馬場に見えない。
  if (track.abroad && track.surface === SURFACE.DIRT && !track.straightCourse) {
    const inner = new THREE.Mesh(buildSurface(track, { surface: SURFACE.TURF, inner: -26, outer: -5 }), surfMat);
    inner.position.y = -0.03;
    group.add(inner);
  }

  // ラチは細い板なので、光の当たり方より「白い線」として見えることが大事。
  const railMat = new THREE.MeshBasicMaterial({ color: COLORS.rail, side: THREE.DoubleSide });
  if (track.abroad && track.surface === SURFACE.DIRT && !track.straightCourse) group.add(new THREE.Mesh(buildRail(track, -5), railMat));
  group.add(new THREE.Mesh(buildRail(track, 0.1), railMat));
  group.add(new THREE.Mesh(buildRail(track, track.width - 0.1, { height: 1.3 }), railMat));

  buildMarkers(track, group);
  if (stand && !track.straightCourse) buildStand(track, group, rng);
  if (surrounds) buildSurrounds(track, group, rng, winter);

  return group;
}

/** 周回位置と横位置から 3D の座標を引く。馬の配置に使う。 */
export function trackPoint(track, p, off, out = new THREE.Vector3()) {
  const w = posToWorld(track, p, off);
  out.set(w.x, elevationAt(track, p), w.z);
  return { point: out, heading: w.heading, curvature: w.curvature };
}

export { COLORS as TRACK_COLORS };
