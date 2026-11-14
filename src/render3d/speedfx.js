// 観戦の疾走感（見た目だけ。走行ログと結果には触らない）。
// - 集中線（画面の縁から外へ流れる白い線）：最後の直線・固有スキルのフォーカスで出す
// - 蹴り上げ：カメラの近くを走る馬の後脚から芝の塊・砂を後ろ上へ飛ばす
// 走路が 1 色の面だと、寄ったカメラで地面が流れて見えず、馬が止まって脚だけ動いているように見えた。
import * as THREE from '../../vendor/three/three.module.min.js';

/** 集中線。画面全体に貼る四角を別の場面で描く（後処理を足さない）。intensity が 0 なら描かない。 */
export function makeSpeedLines() {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uT: { value: 0 }, uI: { value: 0 }, uAsp: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      varying vec2 vUv;
      uniform float uT, uI, uAsp;
      float h(float n){ return fract(sin(n * 127.1) * 43758.5453); }
      void main(){
        vec2 p = (vUv - 0.5) * vec2(uAsp, 1.0);
        float r = length(p);
        float a = atan(p.y, p.x) / 6.2831853 + 0.5;
        float N = 120.0;
        float id = floor(a * N);
        float rnd = h(id);
        // 細い線だけを間引いて出す（全部の帯に出すと画面がざらつく）
        float on = step(0.62, rnd);
        float band = abs(fract(a * N) - 0.5) * 2.0;
        float thin = 1.0 - smoothstep(0.0, 0.25 + 0.35 * h(id + 3.1), band);
        // 外へ流れる破線（速さは線ごとに変える）
        float seg = fract(r * 1.3 - uT * (1.1 + rnd * 1.6) + rnd * 9.0);
        float dash = smoothstep(0.0, 0.12, seg) * (1.0 - smoothstep(0.45, 0.8, seg));
        // 画面の真ん中（馬の居る所）には出さない。縁ほど濃い
        vec2 q = (vUv - 0.5) * 2.0;
        float e = length(q * vec2(1.0, 1.15));
        float mask = smoothstep(0.62, 1.25, e);
        float al = thin * on * dash * mask * uI;
        gl_FragColor = vec4(vec3(1.0), al * 0.85);
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);
  return {
    /** renderer で今のフレームの上に重ねる（t は実時間の秒、aspect は画面の縦横比） */
    render(renderer, t, intensity, aspect) {
      if (intensity < 0.01) return;
      mat.uniforms.uT.value = t;
      mat.uniforms.uI.value = Math.min(1, intensity);
      mat.uniforms.uAsp.value = aspect;
      const ac = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(scene, cam);
      renderer.autoClear = ac;
    },
    dispose() { quad.geometry.dispose(); mat.dispose(); },
  };
}

let clodTex = null;
function clodTexture() {
  if (clodTex) return clodTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 15);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.55, 'rgba(255,255,255,0.85)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 32);
  clodTex = new THREE.CanvasTexture(c);
  return clodTex;
}

/**
 * 蹴り上げ。粒は使い回しの 1 つの組（スプライト 220 個）。粒の時間はレースの時間で進める（スローで一緒に遅くなる）。
 * dirt なら砂（明るい茶）と砂煙（大きく淡い）、芝なら濃い緑と土の塊。
 */
export function makeKickup(dirt) {
  const group = new THREE.Group();
  const N = 220;
  const cols = dirt ? [0x9a7650, 0xb08d63, 0x7d5c3c] : [0x3d5e2a, 0x4f7434, 0x5a4630];
  const parts = [];
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) | 0; return ((seed >>> 8) & 0xffffff) / 0x1000000; };
  for (let i = 0; i < N; i++) {
    const puff = dirt && i % 4 === 0;   // 砂煙
    const mat = new THREE.SpriteMaterial({ map: clodTexture(), color: puff ? 0xc9b08a : cols[i % cols.length], transparent: true, opacity: 0, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    sp.visible = false;
    group.add(sp);
    parts.push({ sp, puff, life: 0, age: 1, v: new THREE.Vector3(), s: 0.1 });
  }
  let next = 0;
  const fwd = new THREE.Vector3(), side = new THREE.Vector3(), pos = new THREE.Vector3();
  const acc = new Map();
  return {
    group,
    /**
     * horses：{ group, id, v }。カメラの近くの馬だけ渡す。dt はレースの時間の進み。
     */
    update(dt, horses) {
      if (dt > 0) {
        for (const h of horses) {
          // 1 秒に 28 個（速いほど多い）。端数は持ち越す
          const want = (acc.get(h.id) ?? 0) + dt * 36 * Math.min(1, Math.max(0, (h.v - 6) / 10));
          let k = Math.floor(want);
          acc.set(h.id, want - k);
          const yaw = h.group.rotation.y;
          fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
          side.set(fwd.z, 0, -fwd.x);
          while (k-- > 0) {
            const p = parts[next];
            next = (next + 1) % N;
            const lr = rnd() < 0.5 ? -1 : 1;
            // 後脚の蹄のあたり（馬の組の原点は胴の真下の地面）
            pos.copy(h.group.position).addScaledVector(fwd, -0.7 - rnd() * 0.3).addScaledVector(side, lr * 0.18);
            p.sp.position.copy(pos).setY(pos.y + 0.08);
            const back = 1.5 + rnd() * 2.5;
            p.v.copy(fwd).multiplyScalar(-back + h.v * 0.15).addScaledVector(side, (rnd() - 0.5) * 1.6);
            p.v.y = p.puff ? 0.5 + rnd() * 0.6 : 1.8 + rnd() * 2.6;
            p.life = p.puff ? 0.9 + rnd() * 0.5 : 0.45 + rnd() * 0.3;
            p.s = p.puff ? 0.5 + rnd() * 0.4 : 0.1 + rnd() * 0.12;
            p.age = 0;
            p.sp.visible = true;
          }
        }
      }
      for (const p of parts) {
        if (!p.sp.visible) continue;
        p.age += dt;
        if (p.age >= p.life) { p.sp.visible = false; p.sp.material.opacity = 0; continue; }
        if (!p.puff) p.v.y -= 9.8 * dt;
        p.sp.position.addScaledVector(p.v, dt);
        const k = p.age / p.life;
        const s = p.puff ? p.s * (1 + k * 1.8) : p.s;
        p.sp.scale.set(s, s, 1);
        p.sp.material.opacity = p.puff ? 0.32 * (1 - k) : (k < 0.8 ? 1 : (1 - k) * 5);
      }
    },
    clear() { for (const p of parts) { p.sp.visible = false; p.age = p.life; } },
    dispose() { for (const p of parts) p.sp.material.dispose(); },
  };
}

let detailTex = null;
/**
 * 走路の細かな質感（芝の葉・砂の粒）。頂点色の刈り込みの縞に掛ける（明るさ 0.8〜1.0、平均 0.95 にして全体を暗く沈めない。
 * 色空間は付けない：sRGB として読むと 242 が線形の 0.89 になり、走路が 1 割暗く沈んだ）。
 * 1 色の面だと、寄ったカメラで地面の流れが見えず疾走感が出なかった。
 */
export function trackDetailTexture(dirt) {
  const key = dirt ? 'd' : 't';
  detailTex ??= {};
  if (detailTex[key]) return detailTex[key];
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(242,242,242)';
  g.fillRect(0, 0, S, S);
  let seed = dirt ? 991 : 337;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) | 0; return ((seed >>> 8) & 0xffffff) / 0x1000000; };
  // 大きなむら（踏まれて色の変わった所）。細かい粒だけだと遠くでミップマップに均されて 1 色に戻った
  for (let i = 0; i < 26; i++) {
    const x = rnd() * S, y = rnd() * S, r = 18 + rnd() * 34;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const v = rnd() < 0.5 ? 200 : 255;
    gr.addColorStop(0, `rgba(${v},${v},${v},0.55)`);
    gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = gr;
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { g.save(); g.translate(dx, dy); g.fillRect(x - r, y - r, r * 2, r * 2); g.restore(); }
  }
  if (dirt) {
    // 砂の粒と、蹄の跡のくぼみ
    for (let i = 0; i < 2600; i++) {
      const v = 185 + Math.floor(rnd() * 70);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
    }
    for (let i = 0; i < 70; i++) {
      const x = rnd() * S, y = rnd() * S;
      g.fillStyle = 'rgba(150,150,150,0.55)';
      g.beginPath(); g.ellipse(x, y, 3 + rnd() * 3, 5 + rnd() * 3, 0, 0, Math.PI * 2); g.fill();
    }
  } else {
    // 芝の葉：進行方向（v）に沿った線。速く流れると筋に見えて、走っている向きが読める
    for (let i = 0; i < 2600; i++) {
      const v = 175 + Math.floor(rnd() * 80);
      g.strokeStyle = `rgb(${v},${v},${v})`;
      g.lineWidth = 1 + rnd() * 1.5;
      const x = rnd() * S, y = rnd() * S, l = 6 + rnd() * 12;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 3, y + l); g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  detailTex[key] = t;
  return t;
}
