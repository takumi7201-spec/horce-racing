// 牧場の 3D 背景。ホーム画面の後ろでずっと動いている放牧地。
//
// 結果に関わるものは何も持たない。所有馬の名前と毛色だけを受け取って、
// 柵の中を歩かせ、草を食ませるだけ。画面を切り替えても作り直さずに
// 止める・再開するだけにしている（WebGL のコンテキストを何度も作ると
// ブラウザによっては 16 個で古いものから失われる）。
//
// 座標：カメラは -z 側から +z を向いて立つ。この向きでは画面の右が -x になる。

import * as THREE from '../../vendor/three/three.module.min.js';
import { makeHorse } from './horse3d.js';
import { yawForZForward } from './orient.js';

/** 放牧地（柵の内側で馬が歩ける範囲）。 */
// 画面の右（-x）には情報パネルが、左（+x）にはメニューが乗るので、横幅は絞ってある。
const PADDOCK = { x0: -7, x1: 10, z0: 0, z1: 14 };
const FENCE_Z = 18;
const CAM_POS = new THREE.Vector3(0, 2.2, -9.5);
const CAM_LOOK = new THREE.Vector3(0, 1.0, 9);

/** 木の配置などを毎回同じにするための小さな擬似乱数。 */
function seededRandom(seed) {
  let s = (seed | 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 8) & 0xffffff) / 0x1000000;
  };
}

/** なめらかな値ノイズ。地面のまだら模様と遠くの丘の起伏に使う。 */
function valueNoise(seed) {
  const h = (ix, iz) => {
    let n = (ix * 374761393 + iz * 668265263 + seed * 2147483647) | 0;
    n = (n ^ (n >>> 13)) * 1274126177 | 0;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const s = (t) => t * t * (3 - 2 * t);
  return (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = s(x - ix), fz = s(z - iz);
    const a = h(ix, iz), b = h(ix + 1, iz), c = h(ix, iz + 1), d = h(ix + 1, iz + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };
}

function makeSky() {
  const R = 900;
  const geo = new THREE.SphereGeometry(R, 24, 16);
  const top = new THREE.Color(0x3f8fe0);
  const mid = new THREE.Color(0x8cc4ef);
  const bot = new THREE.Color(0xe3f1f8);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = Math.max(0, pos.getY(i) / R);
    if (y < 0.18) c.copy(bot).lerp(mid, y / 0.18);
    else c.copy(mid).lerp(top, Math.min(1, (y - 0.18) / 0.5));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false,
  }));
  m.renderOrder = -10;
  return m;
}

/** 雲。ぼかした円を重ねた絵をスプライトに貼る（キャンバスに記号は描かない）。 */
function cloudTexture(rand) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 14; i++) {
    const x = 40 + rand() * 176;
    const y = 52 + rand() * 36 - Math.abs(x - 128) * 0.12;
    const r = 22 + rand() * 30;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 地面。手前の放牧地は平ら、奥へ行くほど丘になって地平線を隠す。
 * まだらは頂点色で付ける（テクスチャを持たずに済む）。
 */
function makeGround(noise) {
  const geo = new THREE.PlaneGeometry(900, 900, 180, 180);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const light = new THREE.Color(0x8cc95a);
  const dark = new THREE.Color(0x4f9a3a);
  const dry = new THREE.Color(0xb8c06a);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    // 柵の奥から盛り上げる。手前（カメラの後ろ）は使わないので平らなまま。
    const far = Math.max(0, z - 30);
    const rise = Math.min(1, far / 160);
    const hill = noise(x * 0.012, z * 0.012) * 26 + noise(x * 0.04 + 9, z * 0.04) * 6;
    pos.setY(i, rise * rise * hill);
    const n = noise(x * 0.09, z * 0.09) * 0.65 + noise(x * 0.4 + 3, z * 0.4) * 0.35;
    c.copy(dark).lerp(light, n);
    c.lerp(dry, Math.max(0, noise(x * 0.03 + 21, z * 0.03) - 0.62) * 1.3);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  m.receiveShadow = true;
  return m;
}

/**
 * 草の葉。細い三角形をインスタンスで数千本。
 * 法線は全部上向きにする（巻き方向で暗くなる問題を避ける。落とし穴 3 と同じ理由）。
 * 風の揺れは頂点シェーダで、葉先ほど大きく。
 */
function makeGrass(rand, uniforms) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.03, 0, 0, 0.03, 0, 0, 0, 0.26, 0.02,
  ], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = `uniform float uTime;\n${sh.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 base = instanceMatrix[3].xz;
        float sway = sin(uTime * 1.7 + base.x * 0.35 + base.y * 0.21) * 0.5
                   + sin(uTime * 2.9 + base.x * 0.9) * 0.2;
        transformed.x += sway * 0.06 * position.y / 0.26;
      #endif`,
    );
  };
  const N = 14000;
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    // カメラに近いほど密に（遠くは地面の色で足りる）。
    // カメラの足元には生やさない。手前 2m の草は画面いっぱいの棘になる。
    const z = -5 + Math.pow(rand(), 1.5) * 30;
    const spread = 6 + (z + 9.5) * 0.95;
    p.set((rand() * 2 - 1) * spread, 0, z);
    e.set((rand() - 0.5) * 0.5, rand() * Math.PI, (rand() - 0.5) * 0.5);
    q.setFromEuler(e);
    const k = 0.55 + rand() * 0.75;
    s.set(k, k * (0.7 + rand() * 0.6), k);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    c.setHSL(0.24 + rand() * 0.08, 0.5 + rand() * 0.2, 0.32 + rand() * 0.16);
    mesh.setColorAt(i, c);
  }
  mesh.frustumCulled = false;
  return mesh;
}

/** 草むらの小さな花。白・黄・薄紫。 */
function makeFlowers(rand) {
  // 上を向いた小さな円。立体にすると陰が付いて小石に見えたので、光を受けない色で塗る。
  const N = 700;
  const geo = new THREE.CircleGeometry(0.045, 6);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial(), N);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  const cols = [0xffffff, 0xfff4a8, 0xf6e05a, 0xe8d4f4, 0xffffff];
  for (let i = 0; i < N; i++) {
    const z = -5 + Math.pow(rand(), 1.3) * 28;
    const spread = 6 + (z + 9.5) * 0.95;
    m.makeTranslation((rand() * 2 - 1) * spread, 0.14 + rand() * 0.08, z);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.set(cols[Math.floor(rand() * cols.length)]));
  }
  return mesh;
}

/** 横木 2 本の柵。杭はインスタンス、横木は区間ごとの長い箱。 */
function makeFence(lines) {
  const group = new THREE.Group();
  const postMat = new THREE.MeshLambertMaterial({ color: 0x7a5636 });
  const railMat = new THREE.MeshLambertMaterial({ color: 0x9a7048 });
  const posts = [];
  for (const [ax, az, bx, bz] of lines) {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 2.8));
    for (let i = 0; i <= n; i++) posts.push([ax + (bx - ax) * i / n, az + (bz - az) * i / n]);
    for (const y of [0.62, 1.08]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.11, 0.06), railMat);
      rail.position.set((ax + bx) / 2, y, (az + bz) / 2);
      rail.rotation.y = -Math.atan2(bz - az, bx - ax);
      rail.castShadow = true;
      group.add(rail);
    }
  }
  const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 1.32, 0.14), postMat, posts.length);
  const m = new THREE.Matrix4();
  posts.forEach(([x, z], i) => { pm.setMatrixAt(i, m.makeTranslation(x, 0.66, z)); });
  pm.castShadow = true;
  group.add(pm);
  return group;
}

/**
 * 秋の広葉樹。幹 1 本に葉の塊を 4〜6 個。黄・橙・緑を混ぜる。
 * 全部インスタンスなので数十本でも描画呼び出しは 2 回。
 */
function makeTrees(rand, spots) {
  const trunks = [];
  const blobs = [];
  const palette = [0xf2c230, 0xe8a51c, 0xf7d64a, 0xd9831b, 0x9cbf3c, 0xc9b82e, 0x6fa83a];
  for (const [x, z, size] of spots) {
    const h = (2.2 + rand() * 1.4) * size;
    trunks.push([x, z, h, size]);
    const col = palette[Math.floor(rand() * palette.length)];
    const nb = 4 + Math.floor(rand() * 3);
    for (let i = 0; i < nb; i++) {
      const a = rand() * Math.PI * 2;
      const r = (0.4 + rand() * 1.1) * size;
      blobs.push([
        x + Math.cos(a) * r, h + (0.6 + rand() * 1.8) * size, z + Math.sin(a) * r,
        (1.3 + rand() * 0.9) * size, col, rand(),
      ]);
    }
  }
  const group = new THREE.Group();
  const tm = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.16, 0.26, 1, 6),
    new THREE.MeshLambertMaterial({ color: 0x5a4030 }),
    trunks.length,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  trunks.forEach(([x, z, h, size], i) => {
    m.compose(p.set(x, h / 2, z), q.identity(), s.set(size, h + 0.6, size));
    tm.setMatrixAt(i, m);
  });
  tm.castShadow = true;
  const bm = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshLambertMaterial({ flatShading: true }),
    blobs.length,
  );
  const c = new THREE.Color();
  blobs.forEach(([x, y, z, r, col, t], i) => {
    m.compose(p.set(x, y, z), q.identity(), s.set(r, r * 0.85, r));
    bm.setMatrixAt(i, m);
    c.set(col).offsetHSL((t - 0.5) * 0.02, 0, (t - 0.5) * 0.12);
    bm.setColorAt(i, c);
  });
  bm.castShadow = true;
  group.add(tm, bm);
  return group;
}

/** 遠くの針葉樹の帯。霧に溶けて青みがかる。 */
function makeTreeline(rand, noise) {
  const N = 260;
  const mesh = new THREE.InstancedMesh(
    new THREE.ConeGeometry(1, 1, 6),
    new THREE.MeshLambertMaterial({ color: 0x2f6a34 }),
    N,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const x = -220 + rand() * 440;
    const z = 75 + rand() * 50;
    const far = Math.max(0, z - 30);
    const rise = Math.min(1, far / 160);
    const y = rise * rise * (noise(x * 0.012, z * 0.012) * 26 + noise(x * 0.04 + 9, z * 0.04) * 6);
    const h = 7 + rand() * 7;
    m.compose(p.set(x, y + h / 2 - 0.5, z), q.identity(), s.set(h * 0.28, h, h * 0.28));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.setHSL(0.3 + rand() * 0.06, 0.4, 0.2 + rand() * 0.1));
  }
  return mesh;
}

/** 厩舎と母屋。赤い屋根の木造。 */
function makeBuildings() {
  const group = new THREE.Group();
  const wall = new THREE.MeshLambertMaterial({ color: 0xf2ead8 });
  const wood = new THREE.MeshLambertMaterial({ color: 0xa04a32 });
  const roof = new THREE.MeshLambertMaterial({ color: 0x5a3a30 });
  const barn = (x, z, w, d, h, wallMat, rot) => {
    const b = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    body.position.y = h / 2;
    body.castShadow = true;
    b.add(body);
    // 切妻屋根：妻側の三角形を奥行きぶん押し出す。軒は壁から少し出す。
    const tri = new THREE.Shape();
    tri.moveTo(-w / 2 - 0.5, 0);
    tri.lineTo(w / 2 + 0.5, 0);
    tri.lineTo(0, w * 0.36);
    tri.closePath();
    const rg = new THREE.ExtrudeGeometry(tri, { depth: d + 1, bevelEnabled: false });
    rg.translate(0, 0, -(d + 1) / 2);
    const r = new THREE.Mesh(rg, roof);
    r.position.y = h;
    r.castShadow = true;
    b.add(r);
    b.position.set(x, 0, z);
    b.rotation.y = rot;
    group.add(b);
  };
  barn(14, 50, 12, 22, 6, wood, 0.25);
  barn(-4, 58, 9, 12, 5, wall, -0.1);
  barn(30, 62, 8, 8, 9, wood, 0.4);    // サイロ代わりの塔
  return group;
}

/**
 * 放牧地を作る。
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} labelLayer 馬名の札を置く要素
 */
export function createPasture(canvas, labelLayer) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const rand = seededRandom(20260);
  const noise = valueNoise(7);
  const uniforms = { uTime: { value: 0 } };

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xd6eaf4, 70, 460);
  scene.add(makeSky());

  // 光源の強さは物理量（r155 以降）。× π して旧来の明るさに合わせる。
  scene.add(new THREE.HemisphereLight(0xe4f2ff, 0x6a8a4a, 1.1 * Math.PI));
  const sun = new THREE.DirectionalLight(0xfff0d6, 1.05 * Math.PI);
  // 太陽はカメラの背後の右上。奥に置くと見えている面が全部陰になり、
  // 鹿毛や黒鹿毛の馬が黒い影絵になった。
  sun.position.set(-16, 30, -22);
  sun.target.position.set(0, 0, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 120 });
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  scene.add(makeGround(noise));
  scene.add(makeGrass(rand, uniforms));
  scene.add(makeFlowers(rand));
  scene.add(makeFence([
    [-60, FENCE_Z, 60, FENCE_Z],
    [15, -14, 15, FENCE_Z],
    [-15, -14, -15, FENCE_Z],
  ]));
  // 柵の外の秋の木立。柵のすぐ奥に並べ、間を少し空けて遠くの厩舎を覗かせる。
  const spots = [];
  for (let x = -70; x <= 70; x += 5 + rand() * 5) {
    if (x > 2 && x < 12) continue;
    spots.push([x, FENCE_Z + 7 + rand() * 12, 0.9 + rand() * 0.5]);
  }
  for (let i = 0; i < 10; i++) {
    const side = i % 2 ? 1 : -1;
    spots.push([side * (22 + rand() * 18), -6 + rand() * 24, 0.9 + rand() * 0.6]);
  }
  scene.add(makeTrees(rand, spots));
  scene.add(makeTreeline(rand, noise));
  scene.add(makeBuildings());

  // 雲
  const clouds = [];
  for (let i = 0; i < 9; i++) {
    const mat = new THREE.SpriteMaterial({
      map: cloudTexture(rand), transparent: true, depthWrite: false, fog: false, opacity: 0.92,
    });
    const sp = new THREE.Sprite(mat);
    const w = 90 + rand() * 90;
    sp.scale.set(w, w * 0.42, 1);
    sp.position.set(-320 + rand() * 640, 70 + rand() * 90, 330 + rand() * 160);
    sp.userData.speed = 1.2 + rand() * 1.6;
    scene.add(sp);
    clouds.push(sp);
  }

  const camera = new THREE.PerspectiveCamera(42, 1, 0.3, 2000);
  camera.position.copy(CAM_POS);
  camera.lookAt(CAM_LOOK);

  // ---------------------------------------------------------------- 馬
  let horses = [];
  let showLabels = true;

  function pickTarget(h) {
    // 他の馬から離れた場所を選ぶ。全頭が同じ隅に集まると絵にならない。
    let best = null;
    let bestD = -1;
    for (let k = 0; k < 6; k++) {
      const x = PADDOCK.x0 + h.rand() * (PADDOCK.x1 - PADDOCK.x0);
      const z = PADDOCK.z0 + h.rand() * (PADDOCK.z1 - PADDOCK.z0);
      let dmin = 1e9;
      for (const o of horses) {
        if (o === h) continue;
        dmin = Math.min(dmin, Math.hypot(o.tx - x, o.tz - z), Math.hypot(o.x - x, o.z - z));
      }
      if (dmin > bestD) { bestD = dmin; best = [x, z]; }
    }
    [h.tx, h.tz] = best;
  }

  function clearHorses() {
    for (const h of horses) {
      scene.remove(h.model.group);
      h.model.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose?.(); } });
      h.label?.remove();
    }
    horses = [];
  }

  /**
   * 歩かせる馬を差し替える。同じ顔ぶれなら作り直さない。
   * @param {Array<{id:number,name:string,coat:string,age?:number,kind?:string}>} list
   */
  function setHorses(list, { labels = true } = {}) {
    showLabels = labels;
    const key = list.map((x) => `${x.id}:${x.coat}`).join(',') + (labels ? '' : '!');
    if (key === setHorses.key) return;
    setHorses.key = key;
    clearHorses();
    list.forEach((info, i) => {
      const model = makeHorse({ id: info.id, coat: info.coat, bare: true, scale: (info.age ?? 3) < 2 ? 0.74 : 1 });
      model.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      scene.add(model.group);
      const hr = seededRandom(info.id * 7919 + 13);
      // 最初は画面に散らばるように、横一列を少し崩して置く。
      const t = list.length > 1 ? i / (list.length - 1) : 0.5;
      const h = {
        info, model, rand: hr,
        x: PADDOCK.x0 + 2 + t * (PADDOCK.x1 - PADDOCK.x0 - 4) + (hr() - 0.5) * 2,
        z: PADDOCK.z0 + 2 + hr() * (PADDOCK.z1 - PADDOCK.z0 - 4),
        heading: hr() * Math.PI * 2,
        v: 0, s: 0, graze: 0, tx: 0, tz: 0,
        mode: hr() < 0.5 ? 'graze' : 'walk',
        timer: 2 + hr() * 6,
        label: null,
      };
      h.tx = h.x; h.tz = h.z;
      horses.push(h);
      if (labels && labelLayer) {
        const tag = document.createElement('div');
        tag.className = 'plabel';
        const nm = document.createElement('b');
        nm.textContent = info.name;
        tag.appendChild(nm);
        if (info.kind) {
          const k = document.createElement('span');
          k.textContent = info.kind;
          tag.appendChild(k);
        }
        labelLayer.appendChild(tag);
        h.label = tag;
      }
    });
    for (const h of horses) pickTarget(h);
  }
  setHorses.key = '';

  function stepHorse(h, dt, t) {
    h.timer -= dt;
    let want = 0;
    if (h.mode === 'walk') {
      const dx = h.tx - h.x, dz = h.tz - h.z;
      const d = Math.hypot(dx, dz);
      // 進路に他の馬が居たら止まって待つ（ぶつかって重ならないように）。
      let blocked = false;
      for (const o of horses) {
        if (o === h) continue;
        const ox = o.x - h.x, oz = o.z - h.z;
        const ahead = ox * Math.cos(h.heading) + oz * Math.sin(h.heading);
        if (ahead > 0 && ahead < 3.4 && Math.abs(-ox * Math.sin(h.heading) + oz * Math.cos(h.heading)) < 1.3) blocked = true;
      }
      if (d < 0.8 || h.timer < 0 || blocked) {
        h.mode = h.rand() < 0.7 ? 'graze' : 'stand';
        h.timer = h.mode === 'graze' ? 5 + h.rand() * 9 : 2 + h.rand() * 4;
        if (blocked) pickTarget(h);
      } else {
        const want_h = Math.atan2(dz, dx);
        let dh = want_h - h.heading;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        h.heading += Math.max(-0.9 * dt, Math.min(0.9 * dt, dh));
        // 大きく向きを変える間はゆっくり歩く。
        want = (1.15 + h.rand() * 0.02) * (Math.abs(dh) > 1.2 ? 0.45 : 1);
      }
    } else if (h.timer < 0) {
      h.mode = 'walk';
      h.timer = 14 + h.rand() * 8;
      pickTarget(h);
    }
    h.v += (want - h.v) * Math.min(1, dt * 1.8);
    h.x += Math.cos(h.heading) * h.v * dt;
    h.z += Math.sin(h.heading) * h.v * dt;
    h.x = Math.max(PADDOCK.x0 - 1, Math.min(PADDOCK.x1 + 1, h.x));
    h.z = Math.max(PADDOCK.z0 - 1, Math.min(PADDOCK.z1 + 1, h.z));
    h.s += h.v * dt;
    const g = h.mode === 'graze' && h.v < 0.3 ? 1 : 0;
    h.graze += (g - h.graze) * Math.min(1, dt * 1.4);
    const grp = h.model.group;
    grp.position.set(h.x, 0, h.z);
    grp.rotation.y = yawForZForward(h.heading);
    h.model.update(h.s, h.v, 0, { t, graze: h.graze });
  }

  // ---------------------------------------------------------------- 名札
  const tmp = new THREE.Vector3();
  let width = 1;
  let height = 1;
  function placeLabels() {
    if (!labelLayer) return;
    const shown = [];
    for (const h of horses) {
      if (!h.label) continue;
      // 頭の少し上。うつむいていても札が地面に潜らないよう、胴の上を基準にする。
      tmp.set(h.x, 2.35 * h.model.group.scale.y, h.z).project(camera);
      const vis = showLabels && tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
      h.label.style.display = vis ? '' : 'none';
      if (vis) shown.push({ h, sx: (tmp.x * 0.5 + 0.5) * width, sy: (-tmp.y * 0.5 + 0.5) * height });
    }
    // 札どうしが重なったら、奥の馬の札を上へ逃がす（手前の馬から順に置く）。
    // 逃がした分だけ引き出し線を伸ばして、どの馬の札かを分かるようにする。
    shown.sort((a, b) => a.h.z - b.h.z);
    const placed = [];
    for (const { h, sx, sy: y0 } of shown) {
      if (!h.labelW) h.labelW = h.label.offsetWidth;
      const w = h.labelW || 120;
      let sy = y0;
      for (let tries = 0; tries < 6; tries++) {
        const hit = placed.find((p) => Math.abs(p.sx - sx) < (p.w + w) / 2 + 4 && Math.abs(p.sy - sy) < 30);
        if (!hit) break;
        sy = hit.sy - 32;
      }
      placed.push({ sx, sy, w });
      const lead = 22 + (y0 - sy);
      h.label.style.setProperty('--lead', `${lead.toFixed(0)}px`);
      h.label.style.transform = `translate(${sx.toFixed(1)}px, ${y0.toFixed(1)}px) translate(-50%, calc(-100% - ${lead.toFixed(0)}px))`;
      // 奥の馬の札ほど後ろへ回す。
      h.label.style.zIndex = String(1000 - Math.round(h.z * 10));
    }
  }


  // ---------------------------------------------------------------- 描画
  let raf = 0;
  let running = false;
  let last = 0;
  let time = 0;
  let shiftPx = 0;
  let shiftPy = 0;
  let disposed = false;

  function resize() {
    width = canvas.clientWidth || window.innerWidth;
    height = canvas.clientHeight || window.innerHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // 縦長の画面では画角を広げて、柵と木立が切れないようにする。
    camera.fov = width / height < 1 ? 58 : 42;
    applyShift();
  }

  /**
   * 右に情報パネルが乗る画面では、見せたい中心を左へずらす。
   * カメラを振るのではなく投影の中心をずらすので、遠近感はそのまま。
   */
  function applyShift() {
    if (shiftPx || shiftPy) camera.setViewOffset(width, height, shiftPx, shiftPy, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  function frame() {
    if (!running || disposed) return;
    const nowMs = performance.now();
    let dt = (nowMs - last) / 1000;
    last = nowMs;
    if (dt > 0.1) dt = 0.1;
    time += dt;
    uniforms.uTime.value = time;
    // カメラはゆっくり左右に漂わせる（止まった絵に見えないように）。
    camera.position.set(
      CAM_POS.x + Math.sin(time * 0.045) * 1.6,
      CAM_POS.y + Math.sin(time * 0.07) * 0.12,
      CAM_POS.z,
    );
    camera.lookAt(CAM_LOOK);
    for (const h of horses) stepHorse(h, dt, time);
    for (const c of clouds) {
      c.position.x -= c.userData.speed * dt;
      if (c.position.x < -380) c.position.x = 380;
    }
    renderer.render(scene, camera);
    placeLabels();
    raf = requestAnimationFrame(frame);
  }

  resize();
  // 最初の 1 枚は止まった状態でも描いておく（start 前に見えても黒くならないように）。
  renderer.render(scene, camera);

  return {
    setHorses,
    resize,
    /** 見せたい中心を (px, py) だけずらす。正の py で絵が上へ寄る。 */
    setShift(px, py = 0) {
      if (px === shiftPx && py === shiftPy) return;
      shiftPx = px;
      shiftPy = py;
      applyShift();
    },
    setLabels(on) {
      showLabels = on;
      if (!on) for (const h of horses) if (h.label) h.label.style.display = 'none';
    },
    start() {
      if (running || disposed) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    get running() { return running; },
    dispose() {
      disposed = true;
      running = false;
      cancelAnimationFrame(raf);
      clearHorses();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
      renderer.dispose();
    },
  };
}
