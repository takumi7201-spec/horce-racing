// 3D レースビュー。
//
// シミュレーションは終わっていて、ここは記録された走行ログの再生だけを行う。
// だからカメラを変えても早送りしても結果は一切変わらない。
// 逆に言うと、ここで「馬を追い越させる」ようなことはできない（それが正しい）。

import * as THREE from '../../vendor/three/three.module.min.js';
import { buildTrackMesh, trackPoint, buildGate } from './track.js';
import { createDirector, createTvDirector, trackingFrame, trackShot } from './broadcast.js';
import { makeHorse, makeShadowPatch, FRAME_COLORS } from './horse3d.js';
import { makeWind } from './wind.js';
import { makeSpeedLines, makeKickup } from './speedfx.js';
import { createFx3d, SKILL_FX } from './skillfx.js';
import { buildTrack, posToWorld, elevationAt, curvatureAt, trackBounds } from '../sim/course.js';
import { sampleLog, logDuration } from '../sim/race.js';
import { yawForZForward } from './orient.js';
import { clamp, lerp } from '../core/util.js';

export const CAMERAS = [
  { id: 'auto', name: '自動' },
  { id: 'mark', name: 'マーク馬' },
  { id: 'tv', name: '中継' },
  { id: 'side', name: '並走' },
  { id: 'jockey', name: '騎手' },
  { id: 'aerial', name: '俯瞰' },
  { id: 'finish', name: 'ゴール前' },
];

// Godot 版の競馬場（godot/scripts/racecourse.gd）から移した見せ方の定数。
const RAIL_GAP = 1.0;    // 横位置の 0 は内ラチの位置。馬の体と騎手の脚が柵に被らないよう、絵では 1m 外へ出す
const GATE_W = 1.05;     // 発馬機の 1 枠の幅（m）。計算は枠の間を 0.42m で置くので、発走直後だけ絵の横の間隔を広げる
const RUN_OUT = 14;      // 最後の馬がゴールしてから再生を続ける秒数（ゴールの後の流し）
const CANTER = 7.5;      // ゴールの後に落ち着く駈歩の速さ（m/s）。止めずに走り抜けさせる
const EASE = 4.5;        // 駈歩へ落ちるまでの時定数（秒）

/** 冬の午後（有馬記念は 12 月の 15 時台）：空の低いところが橙に焼け、日差しは黄色く低い。 */
const DUSK = { top: 0x42669f, bottom: 0xf5bd85, sun: 0.9, fog: 0xe6b88f, sunColor: 0xffcc94, hemiTop: 0xffe2c4, hemiBottom: 0x5a4a2c };

const SKY = {
  晴: { top: 0x4a8fd8, bottom: 0xbfdcf2, sun: 1.0, fog: 0xc8dcee },
  曇: { top: 0x8e9aa6, bottom: 0xc6ccd2, sun: 0.55, fog: 0xc2c8ce },
  小雨: { top: 0x6e7a86, bottom: 0xa8b0b8, sun: 0.4, fog: 0xa8b0b8 },
  雨: { top: 0x55606c, bottom: 0x8a929c, sun: 0.3, fog: 0x8a929c },
  雪: { top: 0x9aa4ae, bottom: 0xd8dde2, sun: 0.45, fog: 0xd8dde2 },
};

/** 空。板ではなく内向きの球に頂点色のグラデーションを付ける。 */
function makeSky(weather, dusk = false) {
  const s = dusk ? DUSK : SKY[weather] ?? SKY['晴'];
  const geo = new THREE.SphereGeometry(4000, 24, 16);
  const top = new THREE.Color(s.top);
  const bot = new THREE.Color(s.bottom);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 4000;
    const c = bot.clone().lerp(top, clamp((y + 0.1) / 0.7, 0, 1));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, depthWrite: false,
  }));
}

const MARK_OWN = 0xff8a1e;      // 自分の馬
const MARK_FOCUS = 0xffe14a;    // いま追っている馬

/**
 * 馬の頭上の目印。下向きの円錐と、地面の輪。
 * 遠景で馬が豆粒になっても位置が分かるよう、深度テストを切って常に前面に描く。
 * 大きさはカメラ距離で毎フレーム掛け直す（draw）。
 */
function makeMarker() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: MARK_OWN, transparent: true, opacity: 0.92, depthTest: false, depthWrite: false,
    side: THREE.DoubleSide,
  });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.85, 14), mat);
  cone.rotation.x = Math.PI;      // 先を下へ
  cone.position.y = 3.3;
  cone.renderOrder = 20;
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.95, 28), mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  ring.renderOrder = 20;
  g.add(cone, ring);
  g.visible = false;
  return { group: g, mat };
}

/**
 * レースビューを作る。
 * @param {HTMLCanvasElement} canvas
 * @param {object} race simulateRace の返り値（log 付き）
 * @param {{focusId?:number, camera?:string, speed?:number}} opts
 */
export function createRaceView(canvas, race, opts = {}) {
  const log = race.log;
  if (!log) throw new Error('走行ログの無いレースは再生できない');
  const track = race.track ?? buildTrack(race.courseId, race.surface, race.distance);
  // 有馬記念は冬の午後（低い日・冬枯れの内馬場）。opts.light で決められる
  const dusk = (opts.light ?? (/有馬/.test(race.name ?? '') ? 'dusk' : 'day')) === 'dusk';
  const winter = dusk || (race.week != null && (race.week >= 45 || race.week <= 8));

  // 馬ごとのゴールの時刻と、その直前の速さ。ログはゴールで止まるので、ゴールの後は絵だけ流す（Godot 版と同じ）
  const finishOf = [];
  for (let k = 0; k < log.n; k++) {
    let kf = log.frames - 1;
    for (let f = 0; f < log.frames; f++) if (log.pos[f * log.n + k] >= race.distance - 0.01) { kf = f; break; }
    const back = Math.min(5, Math.max(1, kf));
    const vFin = (log.pos[kf * log.n + k] - log.pos[(kf - back) * log.n + k]) / (log.dt * back);
    finishOf.push({ tFin: kf * log.dt, vFin: Math.max(CANTER, vFin), offFin: log.off[kf * log.n + k] });
  }
  const duration = logDuration(log) + RUN_OUT;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x9ec6e6);

  const scene = new THREE.Scene();
  const sky = dusk ? DUSK : SKY[race.weather] ?? SKY['晴'];
  scene.fog = new THREE.Fog(sky.fog, 320, 2200);
  scene.add(makeSky(race.weather, dusk));

  // three.js r155 以降は光源の強さが物理量になり、拡散反射が 1/π される。
  // 旧来の感覚で 1.0 を入れると全体が 3 分の 1 の明るさになる。
  scene.add(new THREE.HemisphereLight(dusk ? DUSK.hemiTop : 0xdcecff, dusk ? DUSK.hemiBottom : 0x3a5c2c, (0.85 + sky.sun * 0.35) * Math.PI * (dusk ? 1.25 : 1)));
  // 冬の低い日は面に浅く当たるので、昼と同じ強さでは走路の芝が黒く沈んだ。強めに当てる
  const sun = new THREE.DirectionalLight(dusk ? DUSK.sunColor : 0xfff3df, (0.35 + sky.sun * 0.55) * Math.PI * (dusk ? 1.5 : 1));
  sun.position.set(-320, 420, 260);
  if (dusk) {
    // 冬の低い日。スタンドの側から当てるとスタンドの影がホームの直線を覆うので、直線に沿う向き（少しスタンド寄り）から（Godot 版で踏んだ）
    const a = posToWorld(track, track.lap - 60, 0), b = posToWorld(track, track.lap - 60, 1);
    const ox = b.x - a.x, oz = b.z - a.z;
    const fx = Math.cos(a.heading), fz = Math.sin(a.heading);
    const dx = -ox * 0.32 + fx * 0.9, dz = -oz * 0.32 + fz * 0.9, dy = -0.3;
    sun.position.set(-dx * 600, -dy * 600, -dz * 600);
  }
  scene.add(sun);

  scene.add(buildTrackMesh(track, { rng: seededRandom(race.distance + track.lap), winter }));
  // 発馬機（ゲート）を発走位置に置く。前の扉は開いた形（馬は走り抜ける）
  const gate = buildGate(track, track.start, log.n, { gateW: GATE_W, railGap: RAIL_GAP });
  scene.add(gate);
  // 発馬機は発走のあと外ラチの外へ引き出して片付ける（置いたままだと、1 周するレースで馬群が発馬機を素通りし、
  // 中継のどのカットにも映り込んだ）。4 秒から 6 秒かけて外へ引き、外ラチを越えたら消す。走行ログには触らない
  const gateOut = (() => {
    const a = posToWorld(track, track.start, 0), b = posToWorld(track, track.start, 1);
    return { x: b.x - a.x, z: b.z - a.z };
  })();
  function updateGate() {
    const k = smooth01((time - 4) / 6);
    const d = k * (track.width + 8);
    gate.position.set(gateOut.x * d, 0, gateOut.z * d);
    gate.visible = time < 10;
  }

  // --- 馬 ---
  const horses = [];
  for (let i = 0; i < log.n; i++) {
    const meta = race.results.find((r) => r.horseId === log.ids[i]) ?? {};
    // 毛色と白斑は画面から渡す（opts.looks）。結果の行は毛色を持たない。
    const look = opts.looks?.get(log.ids[i]) ?? {};
    const h = makeHorse({
      id: log.ids[i],
      gate: log.gates[i],
      frame: log.frameNos ? log.frameNos[i] : Math.min(8, Math.ceil(log.gates[i] / 2)),
      coat: look.coat ?? meta.coat ?? '鹿毛',
      marks: look.marks ?? null,
      gear: look.gear ?? null,
    });
    const shadow = makeShadowPatch();
    scene.add(h.group, shadow);
    const marker = makeMarker();
    h.group.add(marker.group);
    horses.push({ ...h, shadow, marker, index: i, id: log.ids[i], name: log.names[i], gate: log.gates[i] });
  }
  /** マークする馬（自分の馬）。 */
  let marks = new Set(opts.marks ?? []);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 5000);
  let mode = opts.camera ?? 'auto';
  let focusId = opts.focusId ?? null;
  let speed = opts.speed ?? 1;
  let time = 0;
  let playing = false;
  let raf = 0;
  let last = 0;
  let disposed = false;

  const tmp = new THREE.Vector3();
  let autoSlow = 1;
  const look = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  // 固有スキルのフォーカス（自分の馬が固有を発動したとき）。カメラをその馬に寄せ、少しスローにする。
  // 時間は実時間で進める（一時停止の間は止まる）。age・dur は秒。
  let fshot = null;
  const FS_DUR = 3.4, FS_SLOW = 0.45;
  // 疾走感：集中線（画面の縁）と蹴り上げ（カメラの近くの馬の後脚から）。見た目だけ
  const speedLines = makeSpeedLines();
  const kick = makeKickup(race.surface === 'ダート');
  scene.add(kick.group);
  let lineI = 0, realLast = performance.now(), realT = 0, kickT = 0;

  function resize() {
    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /**
   * 時刻 t の全馬（絵の位置）。ゴールの後は絵だけ流す：ゴールした速さから駈歩へ指数で落ち着き、止まらずに走り抜ける。
   * v(d) = CANTER + (v0 − CANTER)·e^(−d/EASE) を積分した距離。横位置は発走から 120m だけ枠の幅に広げ、内ラチから RAIL_GAP 離す。
   */
  const logEnd = logDuration(log);
  const order = new Map(race.results.map((r) => [r.horseId, r.order]));
  function stateAt(t) {
    const snap = sampleLog(log, Math.min(t, logEnd));
    return snap.map((x, i) => {
      const f = finishOf[i];
      let s = x.s, v = x.v, off = x.off;
      if (t > f.tFin) {
        const d = t - f.tFin;
        const e = Math.exp(-d / EASE);
        s = race.distance + CANTER * d + (f.vFin - CANTER) * EASE * (1 - e);
        v = CANTER + (f.vFin - CANTER) * e;
        off = f.offFin;
      }
      const k = lerp(GATE_W / 0.42, 1, smooth01(s / 120));
      return { ...x, index: i, s, v, off: off * k + RAIL_GAP, done: t >= f.tFin, order: order.get(x.id) ?? 99 };
    });
  }
  /** いまの全馬の状態と順位（ゴールした馬は着順で、走っている馬は前から）。 */
  function sampleState() {
    const snap = stateAt(time);
    const ranked = snap.slice().sort((a, b) => (a.done && b.done ? a.order - b.order : a.done !== b.done ? (a.done ? -1 : 1) : b.s - a.s));
    const lead = snap.reduce((m, x) => (x.s > m.s ? x : m), snap[0]);
    return { snap, ranked, lead };
  }
  const at = (p, off, dy) => {
    const w = posToWorld(track, p, off);
    return { x: w.x, y: elevationAt(track, p) + dy, z: w.z };
  };
  const director = createDirector(track, race, log.ids.map((id, k) => {
    const r = race.results.find((x) => x.horseId === id) ?? {};
    return { id, name: log.names[k], gate: log.gates[k], frame: log.frameNos ? log.frameNos[k] : 1, order: r.order ?? 99, time: r.time ?? 0, tFin: finishOf[k].tFin };
  }), stateAt, at);
  let snapCam = true;
  const tvDir = createTvDirector(track, race);

  function placeHorses(st) {
    // 騎手視点のときは、自分が乗っている騎手を消す。
    // そうしないとヘルメットで画面の 4 分の 1 が埋まる。
    const hideRider = mode === 'jockey' ? (focusId ?? st.lead.id) : null;
    for (const h of horses) {
      if (h.rider) h.rider.visible = h.id !== hideRider;
      const x = st.snap[h.index];
      const s = x.s;
      const p = track.start + s;
      const { point, heading, curvature } = trackPoint(track, p, x.off, tmp);
      h.group.position.copy(point);
      // 馬はローカル +Z が前方。-heading にすると 90 度ずれて真横を向く。
      // 坂では体を前後に傾ける（上りは鼻先を上げる）。向き → 傾きの順に当てる（YXZ）
      const slope = (elevationAt(track, p + 1.2) - elevationAt(track, p - 1.2)) / 2.4;
      h.group.rotation.order = 'YXZ';
      h.group.rotation.y = yawForZForward(heading);
      h.group.rotation.x = -Math.atan(slope);
      // コーナーでは内に傾ける。曲率と速度から遠心力ぶん。
      const bank = curvature * x.v * x.v * 0.0045 * (track.dir > 0 ? 1 : -1);
      h.update(s, x.v, bank);
      h.shadow.position.set(point.x, point.y + 0.02, point.z);
      h.shadow.rotation.y = yawForZForward(heading);  // 影の楕円も体の向きに合わせる
    }
  }

  let tvFov = null;
  const tvLook = new THREE.Vector3();
  let tvT = 0;

  function setFov(f) {
    if (camera.fov === f) return;
    camera.fov = f;
    camera.updateProjectionMatrix();
  }

  function baseCamera(st) {
    if (mode === 'auto') {
      const c = director.camera(time, st.snap, snapCam, camera.aspect);
      snapCam = false;
      camera.position.set(c.eye.x, c.eye.y, c.eye.z);
      // 中継の画角は横長（16:9 前後）の画面で決めてある。縦長のスマホでは横に写る幅が足りず、並走の馬群が画面の外へ出た。
      // 横の写る幅を 16:10 の画面と同じにするよう、縦の画角を広げる（広げすぎない）。追いのカット（fit）は縦横比で決めてあるのでそのまま
      const k = !c.fit && camera.aspect < 1.6 ? 1.6 / camera.aspect : 1;
      setFov(Math.min(80, (2 * Math.atan(Math.tan((c.fov * Math.PI) / 360) * k) * 180) / Math.PI));
      camera.lookAt(c.look.x, c.look.y, c.look.z);
      autoSlow = c.slow;
      return;
    }
    if (mode !== 'photo' && mode !== 'tv') { setFov(48); tvFov = null; }
    const lead = st.lead;
    const packS = (st.ranked[0].s + st.ranked[Math.min(2, st.ranked.length - 1)].s) / 2;
    const packP = track.start + packS;
    const focus = focusId != null ? st.snap.find((x) => x.id === focusId) : null;
    const target = focus ?? lead;
    const targetP = track.start + Math.min(target.s, race.distance);

    if (mode === 'mark') {
      // マーク馬を画面の中心に置く。斜め後ろの外側から、馬の背と前方の馬群が一緒に入る位置。
      // 真横（side）だと前後の馬が見えず、位置取りが分からない。
      const w = posToWorld(track, targetP - 9, target.off + 9);
      camPos.set(w.x, elevationAt(track, targetP) + 3.8, w.z);
      const t = trackPoint(track, targetP + 2, target.off, look);
      t.point.y += 1.4;
      camera.position.lerp(camPos, 0.3);
      camera.lookAt(t.point);
    } else if (mode === 'tv') {
      // 中継：JRA の中継のように先頭の集団を追うカットを場面で割る（broadcast.js の createTvDirector・trackShot）。
      // コーナーは前から正面で迎え、直線は外・斜め前・内・高い所を回す。同じ横からの追いだけでは代わり映えしなかった。
      const fr = trackingFrame(st.ranked, camera.aspect < 0.9);
      const p = tvDir.pick(time, st.ranked);
      const c = trackShot(p.shot, track, at, fr, camera.aspect);
      camPos.set(c.e.x, c.e.y, c.e.z);
      look.set(c.l.x, c.l.y, c.l.z);
      // 寄せる割合はレースの時間の進みで決める（コマ毎の決まった割合だと、コマが遅い端末や速い再生で集団に置いていかれ、画面が空になった）
      const dtc = Math.min(1, Math.abs(time - tvT)); tvT = time;
      const kp = 1 - Math.exp(-dtc * 7), kf = 1 - Math.exp(-dtc * 2.5);
      if (snapCam || p.cut || tvFov == null) { camera.position.copy(camPos); tvLook.copy(look); tvFov = c.fov; }
      else { camera.position.lerp(camPos, kp); tvLook.lerp(look, kp); tvFov += (c.fov - tvFov) * kf; }
      snapCam = false;
      setFov(tvFov);
      camera.lookAt(tvLook);
    } else if (mode === 'side') {
      // 真横から。脚の動きがいちばん見える。
      const w = posToWorld(track, targetP + 3, track.width + 9);
      camPos.set(w.x, elevationAt(track, targetP) + 3.6, w.z);
      const t = trackPoint(track, targetP, target.off, look);
      camera.position.lerp(camPos, 0.35);
      camera.lookAt(t.point);
    } else if (mode === 'jockey') {
      // 騎手の目の高さ（地上 2.5m 前後）に置く。
      // 後ろに引くと自分の乗っている馬の尻と騎手の背中で画面が埋まる。
      const t = trackPoint(track, targetP, target.off, look);
      const hd = posToWorld(track, targetP, target.off).heading;
      camPos.set(
        t.point.x + Math.cos(hd) * 0.1,
        t.point.y + 2.5,
        t.point.z + Math.sin(hd) * 0.1,
      );
      camera.position.lerp(camPos, 0.6);
      const ahead = trackPoint(track, targetP + 45, target.off * 0.85, look);
      ahead.point.y += 1.2;
      camera.lookAt(ahead.point);
    } else if (mode === 'photo') {
      // ゴールの瞬間の一枚絵（カード用）。追う馬の斜め前の内側、低い位置から胸元を見上げる。
      // 内から外を向くと、背景がスタンドと空になる（外から撮ると暗い内馬場が背景に広がった）。
      // ただし内ラチより内には出ない（内馬場は走路より低く、手前が暗い段差で埋まった）。
      // 横の位置は外ラチではなく馬から測る（東京の芝は幅 40m 近くあり、ラチ沿いの馬が豆粒になった）。
      // 寄せずにその場に置く（止めた 1 コマを撮るので、前のコマから滑らせると構図が毎回ずれる）。
      // 高さはどちらも馬の足元の標高から測る。決勝線の先は周回の境目をまたぐので、そこで標高を引くと
      // 1.6m ずれた値が返り、カメラが地面を見下ろした（posToWorld は周回で折り返すが elevationAt は折り返さない）。
      const ground = elevationAt(track, targetP);
      const w = posToWorld(track, targetP + (opts.photoAhead ?? 12), Math.max(0.6, target.off + (opts.photoOut ?? -3)));
      camPos.set(w.x, ground + (opts.photoHeight ?? 1.5), w.z);
      camera.position.copy(camPos);
      // 望遠で寄せる。広角で近づくと内馬場（暗い面）が画面の半分を占め、馬の背後が間延びした。
      setFov(opts.photoFov ?? 26);
      const at = posToWorld(track, targetP + 1.5, target.off);
      look.set(at.x, ground + (opts.photoLookY ?? 1.5), at.z);
      camera.lookAt(look);
    } else if (mode === 'aerial') {
      const t = trackPoint(track, packP, track.width / 2, look);
      camPos.set(t.point.x, t.point.y + 58, t.point.z);
      const hd = posToWorld(track, packP, 0).heading;
      camPos.x -= Math.cos(hd) * 42;
      camPos.z -= Math.sin(hd) * 42;
      camera.position.lerp(camPos, 0.2);
      camera.lookAt(t.point);
    } else {
      // ゴール前の固定カメラ。直線を正面から。
      const w = posToWorld(track, 0.0, track.width + 9);
      camPos.set(w.x, elevationAt(track, 0) + 11, w.z);
      camera.position.copy(camPos);
      const t = trackPoint(track, Math.max(targetP, track.start + race.distance - 420), track.width * 0.5, look);
      camera.lookAt(t.point);
    }
  }

  /**
   * 固有スキルのフォーカス：馬の外の斜め前の低い所から、走るにつれて真横へ回り込みながら寄る（画角 40° → 30°）。
   * 馬に合わせて毎コマ置き直す（馬は動き続けるので、寄せ遅れると画面から外れる）。
   */
  function focusCam(st) {
    const x = st.snap.find((y) => y.id === fshot.id);
    const h = horses.find((y) => y.id === fshot.id);
    if (!x || !h) { fshot = null; snapCam = true; baseCamera(st); return; }
    const u = smooth01(fshot.age / fshot.dur);
    const p = track.start + x.s;
    const gy = h.group.position.y;
    const w = posToWorld(track, p + lerp(6.5, 0.8, u), x.off + fshot.side * lerp(4.6, 6.0, u) * (fshot.lift ? 1.4 : 1));
    camera.position.set(w.x, gy + lerp(1.15, 1.85, u) + fshot.lift, w.z);
    const a = posToWorld(track, p + 0.9, x.off);
    look.set(a.x, gy + 1.3, a.z);
    // 縦長の画面は横に写る幅が狭いので、画角を広げて鼻先から尾まで収める
    setFov(lerp(40, 30, u) * (camera.aspect < 0.9 ? 1.35 : 1));
    camera.lookAt(look);
  }

  /**
   * フォーカスの撮る側。外に並ぶ馬がいるとカメラとの間に入って自分の馬を隠した（Godot で撮って見つけた）。
   * 外が塞がっていて内に余地（内ラチから 5m 以上）があれば内から撮り、どちらも塞がっていれば高く構えて上から越して撮る。
   */
  function focusPlan(id) {
    const st = sampleState();
    const me = st.snap.find((y) => y.id === id);
    if (!me) return { side: 1, lift: 0 };
    let out = 0, inn = 0;
    for (const o of st.snap) {
      if (o === me) continue;
      const ds = o.s - me.s;
      if (ds < -3 || ds > 8) continue;
      const dof = o.off - me.off;
      if (dof > 0.6 && dof < 6.5) out++;
      else if (dof < -0.6 && dof > -6.5) inn++;
    }
    if (out === 0) return { side: 1, lift: 0 };
    return inn === 0 && me.off > 5 ? { side: -1, lift: 0 } : { side: 1, lift: 2.2 };
  }

  /**
   * カメラの揺れ（疾走感）。速さに合わせて小さく、最後の直線とフォーカスでは強く。画角に比例させる（望遠で揺れすぎない）。
   * 揺れはレースの時間で作る（一時停止で止まり、スローで遅くなる）。各カメラは毎コマ lookAt し直すので、揺れは積み上がらない。
   */
  function applyShake(st) {
    if (!fshot && (mode === 'photo' || mode === 'aerial' || mode === 'finish')) return;
    const v = st.lead.v ?? 15;
    const rem = race.distance - st.lead.s;
    let k = clamp((v - 8) / 9, 0, 1) * (rem < 450 && rem > -30 ? 1.7 : 1) * (fshot ? 1.5 : 1);
    if (mode === 'jockey' && !fshot) k *= 2.2;
    const a = (camera.fov * Math.PI / 180) * 0.0035 * k;
    if (a <= 0) return;
    camera.rotateX(a * (Math.sin(time * 11.3) + 0.6 * Math.sin(time * 23.7 + 1.3)));
    camera.rotateY(a * 0.6 * (Math.sin(time * 9.1 + 0.4) + 0.5 * Math.sin(time * 19.9)));
  }

  function updateCamera(st) {
    if (fshot) focusCam(st); else baseCamera(st);
    applyShake(st);
  }

  const api = {
    onFrame: null,          // (state) => void
    onFinish: null,

    get time() { return time; },
    get duration() { return duration; },
    get playing() { return playing; },
    get camera() { return mode; },
    get speed() { return speed; },

    play() {
      if (playing || disposed) return;
      playing = true;
      last = performance.now();
      loop();
    },
    pause() { playing = false; cancelAnimationFrame(raf); },
    toggle() { playing ? api.pause() : api.play(); },
    setSpeed(x) { speed = clamp(x, 0.25, 8); },
    setCamera(m) { mode = m; snapCam = true; director.reset(); tvDir.reset(); },
    /** 中継の字幕の予定・1000m 通過・勝ち馬のゴールの時刻（画面の表示が使う。ui/racehud.js） */
    get broadcast() { return director; },
    setFocus(id) { focusId = id; },
    get focus() { return focusId; },
    /** スキル発動の光を馬に出す（見た目だけ）。 */
    flare: addFlare,
    clearFlares,
    /** 固有スキルのフォーカス（その馬へカメラを寄せ、少しスローに）。dur は実時間の秒 */
    focusShot(id, dur = FS_DUR) { fshot = { id, age: 0, dur, ...focusPlan(id) }; },
    cancelFocusShot() { if (fshot) { fshot = null; snapCam = true; } },
    get focusShotting() { return !!fshot; },
    /** マークを付ける馬の id。 */
    setMarks(ids) { marks = new Set(ids); },
    seek(t) {
      time = clamp(t, 0, duration);
      snapCam = true;
      fshot = null;
      kick.clear();
      director.reset(); tvDir.reset();
      draw();
    },
    resize,
    /** 1 フレームだけ描く（停止中の再描画）。 */
    draw,
    dispose() {
      disposed = true;
      api.pause();
      scene.traverse((o) => {
        // 馬の形は全頭・放牧地と使い回している（horse3d.js）。捨てると放牧地の馬まで作り直しになる。
        if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else if (m) m.dispose();
      });
      speedLines.dispose();
      renderer.dispose();
    },
  };

  function updateMarkers(st) {
    // 騎手視点では追っている馬の目印が目の前に来て邪魔になる
    // フォーカスの間は、その馬の目印も隠す（寄った画面の真ん中に来る）
    const hide = fshot ? fshot.id : mode === 'jockey' ? (focusId ?? st.lead.id) : null;
    for (const h of horses) {
      const isFocus = h.id === focusId;
      // 一枚絵（photo）には目印を写さない。
      const on = mode !== 'photo' && (marks.has(h.id) || isFocus) && h.id !== hide;
      h.marker.group.visible = on;
      if (!on) continue;
      h.marker.mat.color.setHex(isFocus ? MARK_FOCUS : MARK_OWN);
      // 遠いほど大きくして、画面上ではおおよそ一定の大きさに保つ
      // 画角が狭い（望遠の）カメラでは同じ距離でも大きく写るので、画角で割り戻す
      const d = camera.position.distanceTo(h.group.position) * Math.tan((camera.fov * Math.PI) / 360) / Math.tan((24 * Math.PI) / 180);
      h.marker.group.scale.setScalar(clamp(d / 36, 0.5, 5) * (isFocus ? 1.15 : 1));
    }
  }

  // 風の筋：馬が大きく写るカメラで、その馬の周りを後ろへ流す。流れる速さはレースの時間で測る（ゴール前のスローにも合う）。
  // 以前はマーク・騎手・一枚絵のカメラだけだった。中継の追いのカットも寄るようになった（落とし穴 108）ので、カメラごとではなく
  // 写り方（カメラから馬までの距離 × tan(画角/2)＝画面の縦の半分に写る幅）で決める。9m 未満なら馬が画面の 1 割より大きく写る。
  // 馬が小さく写るカメラでは出さない（筋が画面に散らばるだけ）。マークのカメラは 15m ほど離れるので一枚絵より太くする。
  const winds = [makeWind({ count: 30, seed: 11, width: 2.2, opacity: 0.6 }), makeWind({ count: 24, seed: 23, width: 2.2, opacity: 0.5 })];
  for (const w of winds) scene.add(w.group);
  let windT = 0;
  const ndc = new THREE.Vector3();
  const inView = (h) => { ndc.copy(h.group.position).setY(h.group.position.y + 1.3).project(camera); return ndc.z < 1 && Math.abs(ndc.x) < 1.05 && Math.abs(ndc.y) < 1.05; };
  /** 画面に大きく写っている馬（近い順）。span は画面の縦の半分に写る幅（m） */
  function closeHorses(maxSpan, n) {
    const t = Math.tan((camera.fov * Math.PI) / 360);
    const out = [];
    for (const h of horses) {
      const d = camera.position.distanceTo(h.group.position);
      if (d * t < maxSpan && inView(h)) out.push({ h, d });
    }
    return out.sort((a, b) => a.d - b.d).slice(0, n).map((x) => x.h);
  }
  function updateWind(st) {
    camera.updateMatrixWorld();
    let picks;
    if (fshot) picks = horses.filter((x) => x.id === fshot.id);
    else if (mode === 'mark' || mode === 'jockey' || mode === 'photo') { const fid = focusId ?? st.lead.id; picks = horses.filter((x) => x.id === fid); }
    else if (mode === 'aerial') picks = [];
    else picks = closeHorses(9, 2);
    const dt = Math.max(0, Math.min(0.1, time - windT));
    windT = time;
    winds.forEach((w, i) => {
      const h = picks[i];
      if (!h) { w.group.visible = false; return; }
      w.group.position.copy(h.group.position);
      w.group.rotation.y = h.group.rotation.y;
      w.update(dt, st.snap[h.index].v, camera);
    });
    // 蹴り上げ：画面に大きめに写る馬（縦の半分に 16m 未満）から 6 頭まで
    const kdt = Math.max(0, Math.min(0.1, time - kickT));
    kickT = time;
    const kh = mode === 'aerial' || mode === 'photo' ? [] : closeHorses(16, 6);
    kick.update(kdt, kh.map((h) => ({ group: h.group, id: h.id, v: st.snap[h.index].v })));
  }

  /** 集中線の濃さ：フォーカスの間と、最後の直線（先頭が残り 420m から）。実時間でなめらかに寄せる */
  function updateLines(st, rdt) {
    let target = 0;
    if (fshot) target = 0.8 * Math.min(1, fshot.age / 0.25, (fshot.dur - fshot.age) / 0.5);
    else if (mode !== 'aerial' && mode !== 'photo') {
      const rem = race.distance - st.lead.s;
      if (rem < 420 && rem > -20 && st.lead.v > 12) target = 0.45 * smooth01((420 - rem) / 180);
    }
    lineI += (target - lineI) * Math.min(1, rdt * 6);
  }

  // スキルの発動の光（育成モードの観戦）。馬の組に付けて一緒に動かす。見た目だけで、走行ログ（結果）には触らない。
  // 寿命は実時間で測る（×0.5 の再生でも同じ長さで光る）。深度テストを切って、馬群に埋もれても見えるようにする（目印と同じ）。
  const flares = [];
  let columnTex = null;
  function flareTexture() {
    if (columnTex) return columnTex;
    const c = document.createElement('canvas');
    c.width = 4; c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 64, 0, 0);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 4, 64);
    columnTex = new THREE.CanvasTexture(c);
    return columnTex;
  }
  // untilS：固有スキルの効き目が切れる地点（その馬の走った距離）。エフェクトはそこを過ぎるかゴールするまで出し続け、それから消える。
  function addFlare(id, { color = 0x5ec8ff, big = false, fx = null, untilS = null } = {}) {
    const h = horses.find((x) => x.id === id);
    if (!h) return;
    // 固有スキルのエフェクト（skillfx.js）。輪と光の柱もその色にし、粒が舞い終えるまで少し長く光らせる
    const fx3 = fx ? createFx3d(fx, id * 977 + Math.round(performance.now()), { source: h.group, rider: h.rider }) : null;
    if (fx3) color = new THREE.Color(SKILL_FX[fx].color).getHex();
    const mk = (geo, opts = {}) => new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, ...opts,
    }));
    const g = new THREE.Group();
    const rings = [0, 0.22, ...(big ? [0.44] : [])].map((delay) => {
      const m = mk(new THREE.RingGeometry(0.85, 1, 40));
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.08;
      m.renderOrder = 19;
      m.userData.delay = delay;
      g.add(m);
      return m;
    });
    const col = mk(new THREE.CylinderGeometry(1.25, 1.6, 1, 24, 1, true), { map: flareTexture() });
    col.renderOrder = 18;
    // 疾風・流星・イナズマは竜巻・彗星・稲妻が柱の代わり（柱が竜巻の芯を白く塗りつぶした）
    col.visible = !fx3?.noPillar;
    g.add(col);
    if (fx3) g.add(fx3.group);
    h.group.add(g);
    const life = fx3 ? 3.2 : big ? 2.4 : 1.5;
    // 輪と光の柱は決まった長さ（life）で消し、エフェクト（fx3）だけ効き目が切れるまで寿命を延ばし続ける（fxLife）
    flares.push({ g, h, rings, col, fx3, t0: performance.now(), life, fxLife: life, untilS, big });
  }
  function clearFlares() {
    for (const f of flares) {
      f.h.group.remove(f.g);
      if (f.fx3) { f.g.remove(f.fx3.group); f.fx3.dispose(); }
      f.g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }
    flares.length = 0;
  }
  function updateFlares(st) {
    const now = performance.now();
    for (let i = flares.length - 1; i >= 0; i--) {
      const f = flares[i];
      const age = (now - f.t0) / 1000;
      const k = Math.min(1, age / f.life);
      if (f.fx3 && f.untilS != null) {
        // 効き目が続いているあいだは、消え始め（寿命の 0.6 秒前）が来ないよう寿命を先へ送る
        const me = st?.ranked.find((x) => x.id === f.h.id);
        if (me && !me.done && me.s < f.untilS) f.fxLife = Math.max(f.fxLife, age + 1.2);
        else f.untilS = null;   // 切れたら、そこから 0.6 秒で消える（寿命を延ばすのをやめる）
      }
      if (age >= Math.max(f.life, f.fxLife)) {
        f.h.group.remove(f.g);
        if (f.fx3) { f.g.remove(f.fx3.group); f.fx3.dispose(); }
        f.g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        flares.splice(i, 1);
        continue;
      }
      // 遠いカメラでも読める大きさに（目印と同じ考え）。拡大は画面での見え方（距離 × 画角）で決める。距離だけで決めると、
      // 望遠のカメラ（遠くから狭い画角で狙う。馬は大きく写る）で光の柱と飾りが 4 倍に膨らみ、画面を白く覆った（画角 48° で以前と同じ）
      const d = camera.position.distanceTo(f.h.group.position);
      const span = d * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      f.g.scale.setScalar(clamp(span / 13.4, 1, 4));
      for (const r of f.rings) {
        const t = clamp((age - r.userData.delay) / (f.life * 0.6), 0, 1);
        r.scale.setScalar(1 + t * (f.big ? 7 : 5));
        // 寄ったカメラ（固有スキルのフォーカス）では、足元に大きな白い的のように写ったので薄める
        r.material.opacity = t > 0 && t < 1 ? (1 - t) * 0.95 * (0.1 + 0.9 * clamp((d - 10) / 16, 0, 1)) : 0;
      }
      // 光の柱は立ち上がってから細って消える
      const up = clamp(k / 0.25, 0, 1);
      const hgt = (f.big ? 9 : 6) * up;
      f.col.scale.set(1 - k * 0.5, Math.max(0.01, hgt), 1 - k * 0.5);
      f.col.position.y = hgt / 2;
      // カメラが馬のすぐ近く（ゴール前の正面・マーク）だと柱の中から見ることになり、画面が白く覆われたので薄める
      const nearK = clamp((d - 8) / 16, 0, 1);
      f.col.material.opacity = (k < 0.25 ? up : 1 - (k - 0.25) / 0.75) * (f.big ? 0.85 : 0.65) * nearK;
      if (f.fx3) f.fx3.update(age, f.fxLife, camera);
    }
  }

  function draw() {
    const st = sampleState();
    placeHorses(st);
    updateGate();
    updateCamera(st);
    updateMarkers(st);
    updateWind(st);
    updateFlares(st);
    const now = performance.now();
    const rdt = Math.min(0.1, (now - realLast) / 1000);
    realLast = now;
    if (playing) realT += rdt;
    updateLines(st, rdt);
    renderer.render(scene, camera);
    speedLines.render(renderer, realT, lineI, camera.aspect);
    if (api.onFrame) {
      api.onFrame({
        time,
        duration,
        remaining: Math.max(0, race.distance - st.lead.s),
        lead: st.lead,
        ranked: st.ranked.map((x, i) => ({
          order: i + 1, id: x.id, name: x.name, gate: x.gate,
          s: x.s, v: x.v, done: x.done,
          gap: st.lead.s - x.s,
          frame: log.frameNos ? log.frameNos[x.index] : Math.min(8, Math.ceil(x.gate / 2)),
        })),
      });
    }
  }

  function loop() {
    if (!playing || disposed) return;
    const now = performance.now();
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;        // タブを離れたあとに飛ばさない
    // ゴール手前は少しだけスローにする。写真判定が見えるように。
    // 自動のカメラは中継の演出が決める（ゴール前の真横のカットだけ）。ほかのカメラは先頭が残り 60m の間
    let slow = autoSlow;
    if (mode !== 'auto') {
      const near = race.distance - sampleState().lead.s;
      slow = near < 60 && near > 0 ? 0.55 : 1;
    }
    // 固有スキルのフォーカスの間は少しスロー（0.3 秒で落とし、最後の 0.8 秒で戻す）。フォーカスの時間は実時間で進める
    if (fshot) {
      const a = fshot.age, d = fshot.dur;
      slow = Math.min(slow, lerp(1, FS_SLOW, smooth01(Math.min(1, a / 0.3, (d - a) / 0.8))));
      fshot.age += dt;
      if (fshot.age >= fshot.dur) { fshot = null; snapCam = true; }
    }
    time += dt * speed * slow;
    if (time >= duration) {
      time = duration;
      playing = false;
      draw();
      if (api.onFinish) api.onFinish();
      return;
    }
    draw();
    raf = requestAnimationFrame(loop);
  }

  resize();
  draw();
  return api;
}

function smooth01(x) {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

/** 木の配置などを毎回同じにするための小さな擬似乱数。 */
function seededRandom(seed) {
  let s = (seed | 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 8) & 0xffffff) / 0x1000000;
  };
}

export { FRAME_COLORS };
