// 撮影の舞台。ゴールの瞬間の一枚絵（カード）を撮るためだけの、走行ログを使わない場面。
//
// レースの 3D をそのまま止めて撮ると、馬はラチ沿いにいてカメラを寄せられず、
// 背景は暗い内馬場、脚の運びもたまたまの 1 コマになった。ここでは直線の一部・ラチ・
// ゴール板・観客の入ったスタンドだけを置き、馬の位置と脚の位相（完歩のどこか）を選んで撮る。
//
// 背景と馬を別々に描いて返す（background・subject）。画面側で背景だけをぼかす・流すと、
// 被写界深度と流し撮りの感じが出る（three.js に後処理を足さずに済む）。
//
// 馬の右手が内（左回りの直線、ゴール板は内ラチ側）。馬は +z へ走る。スタンドは -x 側。

import * as THREE from '../../vendor/three/three.module.min.js';
import { makeHorse, makeShadowPatch, disposeHorse, STRIDE } from './horse3d.js';
import { makeWind } from './wind.js';

const INNER_X = 3.4;      // 内ラチ（馬の左手）
const OUTER_X = -24;      // 外ラチ
const STAND_X = -32;      // スタンドの手前の縁

/** 決まった乱数（観客の色など。主乱数に触らない）。 */
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** 芝の刈り込みの縞。進行方向に沿った縞だと速さが出る。 */
function turfTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#3f9a45' : '#4daa52';
    g.fillRect(0, i * 32, 256, 32);
  }
  // 芝目のむら
  const rnd = seeded(7);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = rnd() < 0.5 ? '#ffffff10' : '#00000012';
    g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** ダート。砂の地に、ハローを掛けた筋と蹄の跡。 */
function dirtTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#b8a890';
  g.fillRect(0, 0, 256, 256);
  const rnd = seeded(11);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = rnd() < 0.5 ? '#a8987e' : '#c6b8a0';
    g.fillRect(rnd() * 256, 0, 1 + rnd() * 3, 256);
  }
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = rnd() < 0.5 ? '#8f806a' : '#d8ccb6';
    g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 砂煙（ダートで蹴り上げた砂）。柔らかい丸を重ねる。 */
function dustSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(225,212,190,0.85)');
  gr.addColorStop(1, 'rgba(225,212,190,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function dust(rnd) {
  const g = new THREE.Group();
  const mat = new THREE.SpriteMaterial({ map: dustSprite(), depthWrite: false });
  for (let i = 0; i < 9; i++) {
    const sp = new THREE.Sprite(mat);
    const s = 0.3 + rnd() * 0.5;
    sp.scale.set(s * 1.6, s, 1);
    sp.position.set((rnd() - 0.5) * 0.5, 0.1 + rnd() * 0.25, -0.9 - rnd() * 1.6);
    g.add(sp);
  }
  return g;
}

/** 観客席。段ごとに人（頭と服の色）を並べる。奥ほど影で暗い。 */
function crowdTexture() {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#5d6168';
  g.fillRect(0, 0, 2048, 512);
  const rnd = seeded(31);
  const shirts = ['#f2f2ee', '#d8443a', '#2f5fb3', '#f0c419', '#3c3c3c', '#8bb8e8', '#e88aa8', '#5aa05a', '#ffffff', '#20283a'];
  const rows = 16;
  for (let r = 0; r < rows; r++) {
    const y = 512 - (r + 1) * (512 / rows);
    const dark = 0.55 + 0.45 * (1 - r / rows);
    g.fillStyle = `rgba(40,42,46,${1 - dark * 0.6})`;
    g.fillRect(0, y + 22, 2048, 10);
    for (let x = 4; x < 2048; x += 9 + rnd() * 5) {
      if (rnd() < 0.08) continue;
      g.globalAlpha = dark;
      g.fillStyle = shirts[Math.floor(rnd() * shirts.length)];
      g.fillRect(x, y + 10, 7, 14);
      g.fillStyle = rnd() < 0.8 ? '#2a1e18' : '#c9b49a';
      g.beginPath(); g.arc(x + 3.5, y + 7, 3.4, 0, Math.PI * 2); g.fill();
      // 手を挙げている人（旗・タオル）
      if (rnd() < 0.05) { g.fillStyle = shirts[Math.floor(rnd() * shirts.length)]; g.fillRect(x + 6, y - 6, 3, 12); }
    }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 空。上は青、地平は夕日の金色。 */
function skyDome(sunDir) {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { sun: { value: sunDir.clone().normalize() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vDir; uniform vec3 sun;
      void main(){
        float h = clamp(vDir.y, -0.1, 1.0);
        vec3 top = vec3(0.30, 0.52, 0.86), horizon = vec3(1.0, 0.80, 0.52);
        vec3 col = mix(horizon, top, pow(max(h, 0.0), 0.55));
        float s = max(dot(vDir, sun), 0.0);
        col += vec3(1.0, 0.86, 0.55) * pow(s, 18.0) * 0.9 + vec3(1.0, 0.95, 0.8) * pow(s, 400.0) * 3.0;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return new THREE.Mesh(geo, mat);
}

function rail(x, z0, z1, mat, postMat) {
  const g = new THREE.Group();
  const len = z1 - z0;
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, len), mat);
  bar.position.set(x, 1.0, (z0 + z1) / 2);
  g.add(bar);
  for (let z = z0; z <= z1; z += 2.5) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), postMat);
    p.position.set(x, 0.5, z);
    g.add(p);
  }
  return g;
}

/** ゴール板。内ラチの外に立つ円い標識（赤い縁の白）。 */
function finishPost() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 10), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }));
  pole.position.y = 1.6;
  g.add(pole);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 32), new THREE.MeshStandardMaterial({ color: 0xd8262c, roughness: 0.45 }));
  disc.rotation.z = Math.PI / 2;
  disc.position.y = 3.3;
  g.add(disc);
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.08, 32), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 }));
  inner.rotation.z = Math.PI / 2;
  inner.position.y = 3.3;
  g.add(inner);
  return g;
}

/** 蹴り上げた芝の塊。走っている感じは脚より、足元から飛ぶものの方が伝わる。 */
function clods(rnd, n) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x4a3a22, roughness: 0.9 });
  const grass = new THREE.MeshStandardMaterial({ color: 0x3f8f3a, roughness: 0.9 });
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.025 + rnd() * 0.035, 0), rnd() < 0.75 ? mat : grass);
    // 後ろ脚の蹄から後ろ上へ飛ぶ（前に散らすと足元のごみに見えた）。
    m.position.set((rnd() - 0.5) * 0.7, 0.15 + rnd() * 0.8, -1.2 - rnd() * 2.4);
    m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    g.add(m);
  }
  return g;
}

/**
 * カメラの構え。主役の馬の足元を原点に、馬は +z へ走る。
 * pos はカメラ、look は見る点、fov は画角。
 */
export const SHOTS = {
  // 参考：ゴール後の流し撮り。真横の望遠、馬の高さ。内ラチは写さず、すぐ後ろにラチ、背景は大きくぼけたスタンド。
  profile: { name: '真横', pos: [12, 1.3, 0.0], look: [0, 1.38, 0.0], fov: 18.5, inner: false, rails: [-3.0], sun: [0.7, 0.2, 0.7] },
  // 参考：ガッツポーズの斜め前。内ラチ越し（手前にラチが横切る）、少し見上げる。
  finish: { name: '斜め前', pos: [8.5, 1.05, 8.5], look: [0, 1.45, 0.4], fov: 15, inner: true, rails: [-3.0], sun: [0.75, 0.22, 0.6] },
  front: { name: '正面', pos: [0.7, 1.5, 6.0], look: [-0.2, 1.4, 0.2], fov: 30, inner: true, rails: [] },
  face: { name: '顔のアップ', pos: [1.6, 1.85, 3.6], look: [0, 1.75, 1.2], fov: 32, inner: true, rails: [] },
  low: { name: '見上げ', pos: [2.6, 0.28, 3.8], look: [0, 1.65, 0.4], fov: 54, inner: true, rails: [] },
  side: { name: '真横（近く）', pos: [3.1, 1.35, 0.9], look: [0, 1.3, 0.7], fov: 58, inner: true, rails: [] },
  duel: { name: '競り合い', pos: [2.2, 1.25, 7.0], look: [-1.1, 1.4, -0.3], fov: 32, inner: true, rails: [] },
};

/**
 * ゴールの瞬間を撮る。
 * @param {THREE.WebGLRenderer} renderer alpha 付きの描画器（使い回す。WebGL を増やさない：落とし穴 23）
 * @param {{width:number,height:number,hero:{id,coat,gate,frame},rivals?:Array,shot?:string,phase?:number,sun?:number[]}} o
 *   rivals は [{ id, coat, gate, frame, dx, dz, phase }]（dx は横、dz は前後のずれ m）。phase は完歩の位相 0..1。
 * @returns {{background:string, subject:string, mask:string|null, sun:{x:number,y:number,visible:boolean}}} 画像（dataURL。mask は o.mask のときだけ、馬と騎手だけの形）と太陽の画面位置（0..1）
 */
export function shootFinish(renderer, o) {
  const { width, height, hero, rivals = [], shot = 'profile', phase = 0.25, surface = '芝', riderPose = 'celebrate' } = o;
  const S = SHOTS[shot] ?? SHOTS.profile;
  const scene = new THREE.Scene();
  const sunDir = new THREE.Vector3(...(o.sun ?? S.sun ?? [-0.35, 0.16, -1])).normalize();
  const bg = new THREE.Group();
  const subject = new THREE.Group();
  scene.add(bg, subject);

  bg.add(skyDome(sunDir));
  // 光：馬の毛色が読めるよう主光はカメラ側から（落とし穴 24）。夕日は後ろから縁を光らせる。
  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x4a6a30, 0.62 * Math.PI));
  const key = new THREE.DirectionalLight(0xfff0dc, 0.45 * Math.PI);
  key.position.set(...S.pos).add(new THREE.Vector3(0, 6, 0));
  scene.add(key);
  // 低い日差し。前から当てれば毛艶が金色に光り、後ろからなら縁が光る。
  const rim = new THREE.DirectionalLight(0xffcf8a, 1.9 * Math.PI);
  rim.position.copy(sunDir).multiplyScalar(50);
  scene.add(rim);

  // 地面：走路の芝（縞）、内馬場、外の芝。
  const dirtCourse = surface === 'ダート';
  const tex = dirtCourse ? dirtTexture() : turfTexture();
  tex.repeat.set(dirtCourse ? 6 : 1, dirtCourse ? 60 : 40);
  const turf = new THREE.Mesh(new THREE.PlaneGeometry(INNER_X - OUTER_X, 320), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  turf.rotation.x = -Math.PI / 2;
  turf.position.set((INNER_X + OUTER_X) / 2, 0, 0);
  bg.add(turf);
  const infield = new THREE.Mesh(new THREE.PlaneGeometry(400, 320), new THREE.MeshStandardMaterial({ color: 0x3f8a3a, roughness: 1 }));
  infield.rotation.x = -Math.PI / 2;
  infield.position.set(INNER_X + 200, -0.01, 0);
  bg.add(infield);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(10, 320), new THREE.MeshStandardMaterial({ color: 0x8e8a80, roughness: 1 }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.set((OUTER_X + STAND_X) / 2, -0.005, 0);
  bg.add(apron);
  // 決勝線（白い線）
  const line = new THREE.Mesh(new THREE.PlaneGeometry(INNER_X - OUTER_X, 0.12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  line.rotation.x = -Math.PI / 2;
  line.position.set((INNER_X + OUTER_X) / 2, 0.01, -9);   // ゴール板と同じく、もう過ぎた線
  bg.add(line);

  const railMat = new THREE.MeshStandardMaterial({ color: 0xf6f6f2, roughness: 0.4 });
  // 内ラチはカメラと馬の間に来る構えがある（手前を横切るラチ）。写したくない構えでは置かない。
  if (S.inner !== false) bg.add(rail(INNER_X, -160, 160, railMat, railMat));
  bg.add(rail(OUTER_X, -160, 160, railMat, railMat));
  for (const x of S.rails ?? []) bg.add(rail(x, -160, 160, railMat, railMat));
  const post = finishPost();
  // ゴール板は内ラチ側でカメラと馬の間に立つので、決勝線を過ぎたあと（馬の後ろ）に置く。手前に白い柱が立って馬を割った。
  post.position.set(INNER_X + 0.9, 0, -9);
  bg.add(post);

  // スタンド：段になった観客席と屋根。
  const crowd = new THREE.Mesh(new THREE.PlaneGeometry(320, 26), new THREE.MeshStandardMaterial({ map: crowdTexture(), roughness: 0.9 }));
  crowd.rotation.y = Math.PI / 2;
  crowd.rotation.x = 0;
  crowd.position.set(STAND_X - 9, 9, 0);
  crowd.rotation.order = 'YXZ';
  crowd.rotation.x = -0.62;      // 客席は奥へ上がる
  crowd.material.map.repeat.set(4, 1);
  crowd.material.map.wrapS = THREE.RepeatWrapping;
  bg.add(crowd);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(14, 0.8, 320), new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.6 }));
  roof.position.set(STAND_X - 12, 22, 0);
  roof.rotation.z = -0.12;
  bg.add(roof);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 320), new THREE.MeshStandardMaterial({ color: 0x2f5a3a, roughness: 0.8 }));
  wall.position.set(STAND_X, 1.5, 0);
  bg.add(wall);
  // 内馬場の向こうの木立（低い円錐）
  const rnd = seeded(hero.id ?? 1);
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x2e6a32, roughness: 1 });
  for (let i = 0; i < 60; i++) {
    const t = new THREE.Mesh(new THREE.ConeGeometry(2 + rnd() * 2, 7 + rnd() * 6, 7), treeMat);
    t.position.set(INNER_X + 70 + rnd() * 60, 4, -200 + i * 7 + rnd() * 4);
    bg.add(t);
  }

  // 馬：主役と相手。脚の位相は update に「進んだ距離」で渡す（1 完歩 = STRIDE m）。
  const models = [];
  const place = (h, dx, dz, ph, detail) => {
    const m = makeHorse({ id: h.id, gate: h.gate ?? 1, frame: h.frame ?? 1, coat: h.coat, marks: h.marks ?? null, detail, riderPose: h === hero ? riderPose : 'race' });
    m.update(((ph % 1) + 1) % 1 * STRIDE, 17, 0);
    m.group.position.set(dx, 0, dz);
    // 脚を伸ばした位相では 4 本とも宙に浮き、影から離れて飛んでいるように見えた。いちばん低い蹄を地面に着ける。
    m.group.updateMatrixWorld(true);
    const low = new THREE.Box3().setFromObject(m.group).min.y;
    if (low > 0) m.group.position.y -= low;
    subject.add(m.group);
    const sh = makeShadowPatch();
    sh.position.set(dx, 0.02, dz);
    subject.add(sh);
    const cl = dirtCourse ? dust(rnd) : clods(rnd, 14);
    cl.position.set(dx, 0, dz);
    subject.add(cl);
    models.push(m);
  };
  place(hero, 0, 0, phase, 'high');
  for (const r of rivals) place(r, r.dx ?? -2.2, r.dz ?? -1.2, r.phase ?? phase + 0.37, 'high');

  const camera = new THREE.PerspectiveCamera(S.fov, width / height, 0.1, 2000);
  camera.position.set(...S.pos);
  camera.lookAt(new THREE.Vector3(...S.look));
  camera.updateMatrixWorld();
  // 風の筋（駆け抜ける速さ）。主役の馬の周りに、カメラへ向けて置く。止めた 1 コマなので流さない（dt 0）。
  // 画角に入る前後 6m に寄せる（レースの 10m のままだと大半が画面の外）。透明の地に描くので普通の合成。
  if (o.wind !== false) {
    const wind = makeWind({
      count: 40, seed: (hero.id ?? 1) * 7 + 3, zRange: [-3.8, 2.2], width: 2,
      opacity: o.windOpacity ?? 0.85, blending: 'normal', color: 0xfff6e2,
    });
    subject.add(wind.group);
    wind.update(0, 17, camera);
  }

  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;

  // 背景だけ → 馬だけ（透明の地）の順に描いて、その場で読み出す（描いた直後なら preserveDrawingBuffer は要らない）。
  subject.visible = false;
  renderer.setClearColor(0x000000, 1);
  renderer.render(scene, camera);
  const background = renderer.domElement.toDataURL('image/png');
  subject.visible = true;
  bg.visible = false;
  renderer.setClearColor(0x000000, 0);
  // 馬だけでも地面の影は要るので、影の板は subject に入れてある。空は bg なので透明になる。
  renderer.render(scene, camera);
  const subjectUrl = renderer.domElement.toDataURL('image/png');
  // 馬と騎手だけの形（カードの箔押しの輪郭に使う）。影・芝の塊・風の筋まで含めると、輪郭がそれらも縁取ってしまう。
  let maskUrl = null;
  if (o.mask) {
    const keep = new Set(models.map((m) => m.group));
    const hidden = subject.children.filter((c) => !keep.has(c) && c.visible);
    for (const c of hidden) c.visible = false;
    renderer.render(scene, camera);
    maskUrl = renderer.domElement.toDataURL('image/png');
    for (const c of hidden) c.visible = true;
  }

  const sp = sunDir.clone().multiplyScalar(800).project(camera);
  const sun = { x: (sp.x + 1) / 2, y: (1 - sp.y) / 2, visible: sp.z < 1 && Math.abs(sp.x) < 1.4 && Math.abs(sp.y) < 1.4 };

  // 馬は disposeHorse で（顔の布は使い回すので捨てない）。舞台は全部捨てる。
  for (const m of models) disposeHorse(m.group);
  const horseGroups = new Set(models.map((m) => m.group));
  for (const c of subject.children) {
    if (horseGroups.has(c)) continue;
    c.traverse((x) => { x.geometry?.dispose(); x.material?.dispose?.(); });
  }
  bg.traverse((x) => {
    if (x.geometry && !x.geometry.userData?.shared) x.geometry.dispose();
    for (const mt of [x.material].flat()) { if (!mt) continue; mt.map?.dispose(); mt.dispose(); }
  });
  return { background, subject: subjectUrl, mask: maskUrl, sun };
}
