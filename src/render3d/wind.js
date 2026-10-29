// 風の筋。馬の周りを後ろへ流れる細い光の帯で、駆け抜けている速さを見せる。
//
// 馬の組の座標（+z が前）に置く。筋は前から後ろへ流れ、体に沿って少し外・上へ逃げる曲線にする
// （まっすぐな線を並べると雨か傷に見えた）。帯は毎回カメラの方へ向け直す（細い帯を横から見ると消える）。
// 体の中を通らないよう、胴と騎手の幅の内側には置かない。
// レースは光らせたいので加算合成。撮影の舞台は透明の地に描く（背景と別の層）ので、加算だと地の α が育たず
// 筋が消える。そちらは普通の合成（`blending: 'normal'`）。どちらも深度は書かない。頭（前）が明るく、尾（後ろ）へ消える布を貼る。

import * as THREE from '../../vendor/three/three.module.min.js';

let streakTex = null;
/** 前が明るく後ろへ消える帯の布。u が長さ（0 が尾、1 が頭）、v が幅（中央が明るい）。 */
function texture() {
  if (streakTex) return streakTex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 16;
  const g = c.getContext('2d');
  const along = g.createLinearGradient(0, 0, 256, 0);
  along.addColorStop(0, 'rgba(255,255,255,0)');
  along.addColorStop(0.7, 'rgba(255,255,255,0.55)');
  along.addColorStop(0.93, 'rgba(255,255,255,1)');
  along.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = along;
  g.fillRect(0, 0, 256, 16);
  // 幅の方向に柔らかく（中央が明るい）
  g.globalCompositeOperation = 'destination-in';
  const across = g.createLinearGradient(0, 0, 0, 16);
  across.addColorStop(0, 'rgba(0,0,0,0)');
  across.addColorStop(0.5, 'rgba(0,0,0,1)');
  across.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = across;
  g.fillRect(0, 0, 256, 16);
  streakTex = new THREE.CanvasTexture(c);
  streakTex.colorSpace = THREE.SRGBColorSpace;
  return streakTex;
}

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const N = 10;   // 1 本の帯の節の数

/**
 * 風の筋を作る。
 * @param {{count?:number, seed?:number, zRange?:number[], color?:number, opacity?:number, width?:number, blending?:'add'|'normal'}} o
 *   zRange は筋が流れる前後の範囲（m、馬の組の座標）。後端を越えたら前から入り直す。width は太さの倍率。
 * @returns {{group:THREE.Group, update:(dt:number, speed:number, camera:THREE.Camera)=>void, dispose:()=>void}}
 */
export function makeWind({ count = 26, seed = 7, zRange = [-7, 3.5], color = 0xffffff, opacity = 0.5, width = 1, blending = 'add' } = {}) {
  const rnd = seeded(seed);
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    map: texture(), color, transparent: true, opacity, depthWrite: false,
    blending: blending === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide,
    toneMapped: false,
  });
  const streaks = [];
  for (let i = 0; i < count; i++) {
    const pos = new Float32Array((N + 1) * 2 * 3);
    const uv = new Float32Array((N + 1) * 2 * 2);
    const idx = [];
    for (let k = 0; k <= N; k++) {
      uv.set([k / N, 0, k / N, 1], k * 4);
      if (k < N) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    group.add(mesh);
    streaks.push({ mesh, geo, pos, ...spawn(rnd, zRange, true, width) });
  }

  const cam = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  const p = new THREE.Vector3(), d = new THREE.Vector3(), w = new THREE.Vector3(), toCam = new THREE.Vector3();

  /** 筋の中心線（t は 0 が尾、1 が頭）。体の脇を後ろへ外・上へ逃げる。 */
  function path(s, t, out) {
    const back = 1 - t;
    out.set(
      s.x + s.side * s.flare * back * back,
      s.y + s.lift * back * back + Math.sin((t + s.phase) * Math.PI * 2) * s.wave,
      s.z + s.len * (t - 1),
    );
    return out;
  }

  function update(dt, speed, camera) {
    // 速さに合わせて筋を後ろへ流す（馬に対する空気の速さ）。止まっていれば見せない。
    const show = speed > 6;
    group.visible = show;
    if (!show) return;
    group.updateWorldMatrix(true, false);
    inv.copy(group.matrixWorld).invert();
    cam.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inv);
    for (const s of streaks) {
      s.z -= dt * speed * s.speed;
      if (s.z < zRange[0]) Object.assign(s, spawn(rnd, zRange, false, width));
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        path(s, t, p);
        path(s, Math.min(1, t + 0.05), d).sub(path(s, Math.max(0, t - 0.05), w)).normalize();
        // 帯の幅はカメラへ向けた面の中に取る（線とカメラ方向の外積）。
        // カメラの 1.2〜3.7m 以内では細めて消す。騎手視点だと頭の脇を通る筋が画面を斜めに覆う白い楔になった。
        toCam.subVectors(cam, p);
        const near = Math.min(1, Math.max(0, (toCam.length() - 1.2) / 2.5));
        w.crossVectors(d, toCam).normalize().multiplyScalar(s.width * near * (0.35 + 0.65 * Math.sin(Math.PI * t)));
        s.pos.set([p.x - w.x, p.y - w.y, p.z - w.z, p.x + w.x, p.y + w.y, p.z + w.z], k * 6);
      }
      s.geo.attributes.position.needsUpdate = true;
    }
  }

  function dispose() {
    for (const s of streaks) s.geo.dispose();
    mat.dispose();
  }

  return { group, update, dispose };
}

/** 筋を 1 本、体の外に置く。first は最初の配置（前後に散らす）、それ以外は前端から入れる。 */
function spawn(rnd, zRange, first, widthMul) {
  // 横は胴（半幅 0.3）と騎手の脚・鐙（0.4）の外。上下は脚元から騎手の頭の上まで。
  const side = rnd() < 0.5 ? -1 : 1;
  // 下寄りに多く置く（脚元と腹の下は芝を背にして筋が読める。上はスタンドや空の明るい地で消える）。
  const high = rnd() < 0.15;
  const x = high ? (rnd() - 0.5) * 1.2 : side * (0.55 + rnd() * 1.6);
  const y = high ? 2.6 + rnd() * 0.7 : 0.2 + Math.pow(rnd(), 1.4) * 2.3;
  const len = 1.2 + rnd() * 3.2;
  return {
    x, y, side: x < 0 ? -1 : 1,
    // z は筋の頭。最初は範囲の中に散らす（頭は前端を少し越えてよい）。
    z: first ? zRange[0] + len * 0.5 + rnd() * (zRange[1] - zRange[0] - len * 0.5 + 0.6) : zRange[1] + rnd() * 2,
    len,
    width: (0.006 + rnd() * 0.016) * widthMul,
    flare: 0.1 + rnd() * 0.35,
    lift: (rnd() - 0.3) * 0.25,
    wave: rnd() * 0.04,
    phase: rnd(),
    speed: 0.8 + rnd() * 0.5,
  };
}
