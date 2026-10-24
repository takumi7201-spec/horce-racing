// 3D レースビュー。
//
// シミュレーションは終わっていて、ここは記録された走行ログの再生だけを行う。
// だからカメラを変えても早送りしても結果は一切変わらない。
// 逆に言うと、ここで「馬を追い越させる」ようなことはできない（それが正しい）。

import * as THREE from '../../vendor/three/three.module.min.js';
import { buildTrackMesh, trackPoint } from './track.js';
import { makeHorse, makeShadowPatch, FRAME_COLORS } from './horse3d.js';
import { buildTrack, posToWorld, elevationAt, curvatureAt, trackBounds } from '../sim/course.js';
import { sampleLog, logDuration } from '../sim/race.js';
import { yawForZForward } from './orient.js';
import { clamp, lerp } from '../core/util.js';

export const CAMERAS = [
  { id: 'mark', name: 'マーク馬' },
  { id: 'tv', name: '中継' },
  { id: 'side', name: '並走' },
  { id: 'jockey', name: '騎手' },
  { id: 'aerial', name: '俯瞰' },
  { id: 'finish', name: 'ゴール前' },
];

const SKY = {
  晴: { top: 0x4a8fd8, bottom: 0xbfdcf2, sun: 1.0, fog: 0xc8dcee },
  曇: { top: 0x8e9aa6, bottom: 0xc6ccd2, sun: 0.55, fog: 0xc2c8ce },
  小雨: { top: 0x6e7a86, bottom: 0xa8b0b8, sun: 0.4, fog: 0xa8b0b8 },
  雨: { top: 0x55606c, bottom: 0x8a929c, sun: 0.3, fog: 0x8a929c },
  雪: { top: 0x9aa4ae, bottom: 0xd8dde2, sun: 0.45, fog: 0xd8dde2 },
};

/** 空。板ではなく内向きの球に頂点色のグラデーションを付ける。 */
function makeSky(weather) {
  const s = SKY[weather] ?? SKY['晴'];
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
  const duration = logDuration(log);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x9ec6e6);

  const scene = new THREE.Scene();
  const sky = SKY[race.weather] ?? SKY['晴'];
  scene.fog = new THREE.Fog(sky.fog, 320, 2200);
  scene.add(makeSky(race.weather));

  // three.js r155 以降は光源の強さが物理量になり、拡散反射が 1/π される。
  // 旧来の感覚で 1.0 を入れると全体が 3 分の 1 の明るさになる。
  scene.add(new THREE.HemisphereLight(0xdcecff, 0x3a5c2c, (0.85 + sky.sun * 0.35) * Math.PI));
  const sun = new THREE.DirectionalLight(0xfff3df, (0.35 + sky.sun * 0.55) * Math.PI);
  sun.position.set(-320, 420, 260);
  scene.add(sun);

  scene.add(buildTrackMesh(track, { rng: seededRandom(race.distance + track.lap) }));

  // --- 馬 ---
  const horses = [];
  for (let i = 0; i < log.n; i++) {
    const meta = race.results.find((r) => r.horseId === log.ids[i]) ?? {};
    const h = makeHorse({
      id: log.ids[i],
      gate: log.gates[i],
      frame: log.frameNos ? log.frameNos[i] : Math.min(8, Math.ceil(log.gates[i] / 2)),
      coat: meta.coat ?? '鹿毛',
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
  let mode = opts.camera ?? (opts.marks?.length ? 'mark' : 'tv');
  let focusId = opts.focusId ?? null;
  let speed = opts.speed ?? 1;
  let time = 0;
  let playing = false;
  let raf = 0;
  let last = 0;
  let disposed = false;

  const tmp = new THREE.Vector3();
  const look = new THREE.Vector3();
  const camPos = new THREE.Vector3();

  function resize() {
    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /** いまの全馬の状態と順位。 */
  function sampleState() {
    const snap = sampleLog(log, Math.min(time, duration));
    const ranked = snap.map((x, i) => ({ ...x, index: i }))
      .sort((a, b) => b.s - a.s);
    const lead = ranked[0];
    return { snap, ranked, lead };
  }

  function placeHorses(st) {
    // 騎手視点のときは、自分が乗っている騎手を消す。
    // そうしないとヘルメットで画面の 4 分の 1 が埋まる。
    const hideRider = mode === 'jockey' ? (focusId ?? st.lead.id) : null;
    for (const h of horses) {
      if (h.rider) h.rider.visible = h.id !== hideRider;
      const x = st.snap[h.index];
      const s = Math.min(x.s, race.distance);
      const p = track.start + s;
      const { point, heading, curvature } = trackPoint(track, p, x.off, tmp);
      h.group.position.copy(point);
      // 馬はローカル +Z が前方。-heading にすると 90 度ずれて真横を向く。
      h.group.rotation.y = yawForZForward(heading);
      // コーナーでは内に傾ける。曲率と速度から遠心力ぶん。
      const bank = curvature * x.v * x.v * 0.0045 * (track.dir > 0 ? 1 : -1);
      h.update(s, x.v, bank);
      h.shadow.position.set(point.x, point.y + 0.02, point.z);
      h.shadow.rotation.y = yawForZForward(heading);  // 影の楕円も体の向きに合わせる
    }
  }

  function updateCamera(st) {
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
      // 内馬場を走るカメラ車。馬群の少し前を、内側から見下ろす。
      // 離しすぎると馬が豆粒になるので、走路幅ぶんの外に置く程度に留める。
      const camP = packP + 26;
      const w = posToWorld(track, camP, -26);
      camPos.set(w.x, elevationAt(track, camP) + 13, w.z);
      const t = trackPoint(track, packP, track.width * 0.35, look);
      camera.position.lerp(camPos, 0.25);
      camera.lookAt(t.point);
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
    setCamera(m) { mode = m; },
    setFocus(id) { focusId = id; },
    get focus() { return focusId; },
    /** マークを付ける馬の id。 */
    setMarks(ids) { marks = new Set(ids); },
    seek(t) {
      time = clamp(t, 0, duration);
      draw();
    },
    resize,
    /** 1 フレームだけ描く（停止中の再描画）。 */
    draw,
    dispose() {
      disposed = true;
      api.pause();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else if (m) m.dispose();
      });
      renderer.dispose();
    },
  };

  function updateMarkers(st) {
    // 騎手視点では追っている馬の目印が目の前に来て邪魔になる
    const hide = mode === 'jockey' ? (focusId ?? st.lead.id) : null;
    for (const h of horses) {
      const isFocus = h.id === focusId;
      const on = (marks.has(h.id) || isFocus) && h.id !== hide;
      h.marker.group.visible = on;
      if (!on) continue;
      h.marker.mat.color.setHex(isFocus ? MARK_FOCUS : MARK_OWN);
      // 遠いほど大きくして、画面上ではおおよそ一定の大きさに保つ
      const d = camera.position.distanceTo(h.group.position);
      h.marker.group.scale.setScalar(clamp(d / 36, 0.9, 5) * (isFocus ? 1.15 : 1));
    }
  }

  function draw() {
    const st = sampleState();
    placeHorses(st);
    updateCamera(st);
    updateMarkers(st);
    renderer.render(scene, camera);
    if (api.onFrame) {
      api.onFrame({
        time,
        duration,
        remaining: Math.max(0, race.distance - st.lead.s),
        ranked: st.ranked.map((x, i) => ({
          order: i + 1, id: x.id, name: x.name, gate: x.gate,
          s: x.s, v: x.v,
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
    const st0 = sampleState();
    const near = race.distance - st0.lead.s;
    const slow = near < 60 && near > 0 ? 0.55 : 1;
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

/** 木の配置などを毎回同じにするための小さな擬似乱数。 */
function seededRandom(seed) {
  let s = (seed | 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 8) & 0xffffff) / 0x1000000;
  };
}

export { FRAME_COLORS };
