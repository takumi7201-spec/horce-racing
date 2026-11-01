// ゲーム本体の馬と騎手（src/render3d/horse3d.js・horsehead.js・jockey3d.js）を Godot へ書き出す。
//
//   npm run godot-horse      （先に npm run godot-races で godot/data/races/*.json を作っておく）
//
// 形は全頭で同じなので 1 頭ぶんを glTF（godot/assets/horse/horse.glb）にする。関節（股・膝・球節・首・頭・耳・尾）は
// 名前の付いた組のまま書き出すので、Godot の側で three.js 版と同じ襲歩の動き（horse3d.js の update）を当てられる。
// 馬ごとに違うのは布と色だけ：顔（毛色・白斑）・ゼッケン・勝負服・袖・帽子・毛色・脚の白。走るレースの出走馬ぶんを
// godot/assets/horse/skins/<レース>/ に書き、Godot の horse_model.gd が材質の名前で差し替える。
// 布は canvas で描くのでブラウザ（同梱の Chromium）で作る。
//
// 書き出しには three.js の GLTFExporter（r169、tools/vendor/、MIT）を使う。手綱は毎コマ張り直す帯なので書き出さず、
// 両端（銜 bitL・bitR と騎手の手 handL・handR）を空の組として置く。Godot の側で張る。

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import pw from '/opt/node-tools/node_modules/playwright/index.js';

const PORT = 8093;
const server = spawn(process.execPath, ['tools/serve.mjs', '--port', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page:', e.message));
  await page.goto(`http://localhost:${PORT}/sw.js`);

  // ---------------------------------------------------------------- 形（1 頭ぶん）
  const glb = await page.evaluate(async () => {
    const THREE = await import('/vendor/three/three.module.min.js');
    const { makeHorse } = await import('/src/render3d/horse3d.js');
    const { GLTFExporter } = await import('/tools/vendor/GLTFExporter.js');
    // 脚の白なし・鹿毛を形の手本にする（色と布は Godot で馬ごとに差し替える）
    const h = makeHorse({ id: 1, gate: 1, frame: 1, coat: '鹿毛', detail: 'high', marks: { legs: [0, 0, 0, 0] } });
    h.update(0, 0);
    const g = h.group;
    const reins = g.getObjectByName('reins');
    reins.parent.remove(reins);
    const head = g.getObjectByName('head');
    head.userData.bits.forEach((b, i) => { const o = new THREE.Object3D(); o.name = i === 0 ? 'bitL' : 'bitR'; o.position.copy(b); head.add(o); });
    delete head.userData.bits;
    const rider = g.getObjectByName('rider');
    for (const p of rider.userData.reinHands ?? []) { const o = new THREE.Object3D(); o.name = p.x < 0 ? 'handL' : 'handR'; o.position.copy(p); rider.add(o); }
    delete rider.userData.reinHands;
    g.traverse((o) => { if (o.isMesh) o.geometry.userData = {}; });
    g.name = 'horse';
    const buf = await new GLTFExporter().parseAsync(g, { binary: true });
    let s = '';
    const u8 = new Uint8Array(buf);
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  });
  mkdirSync('godot/assets/horse', { recursive: true });
  writeFileSync('godot/assets/horse/horse.glb', Buffer.from(glb, 'base64'));
  console.log(`godot/assets/horse/horse.glb：${(Buffer.from(glb, 'base64').length / 1024).toFixed(0)}KB`);

  // ---------------------------------------------------------------- 馬ごとの布と色
  const index = JSON.parse(readFileSync('godot/data/races.json', 'utf8')).races;
  for (const R of index) {
    const race = JSON.parse(readFileSync(`godot/data/races/${R.id}.json`, 'utf8'));
    const runners = race.horses.map((h) => ({ gate: h.gate, frame: h.frame, coat: h.coat, hid: h.hid, marks: h.marks, silks: h.silks }));
    const skins = await page.evaluate(async (runners) => {
      const { makeHorse } = await import('/src/render3d/horse3d.js');
      const { faceTexture } = await import('/src/render3d/horsehead.js');
      const hex = (c) => `#${c.getHexString()}`;
      // three.js の布は flipY（画像の下端が v=0）、glTF は画像の上端が v=0。GLTFExporter は形の中の布を上下に返して書くが、
      // ここで別に書き出す布はそのままだと上下が逆さまに貼られる（ゼッケンの数字・顔の白斑・勝負服の柄が逆さまになった）。返して書く
      const png = (tex) => {
        const img = tex?.image;
        if (!img?.toDataURL) return null;
        if (tex.flipY === false) return img.toDataURL('image/png');
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const g = c.getContext('2d');
        g.translate(0, c.height);
        g.scale(1, -1);
        g.drawImage(img, 0, 0);
        return c.toDataURL('image/png');
      };
      return runners.map((r) => {
        const h = makeHorse({ id: r.hid, gate: r.gate, frame: r.frame, coat: r.coat, marks: r.marks, silks: r.silks, detail: 'high' });
        const mats = {};
        const tex = {};
        h.group.traverse((o) => {
          if (!o.isMesh) return;
          for (const m of [o.material].flat()) {
            if (!m.name) continue;
            mats[m.name] ??= hex(m.color);
            if (m.map && ['number', 'silks', 'sleeve'].includes(m.name)) tex[m.name] ??= png(m.map);
          }
        });
        // 顔の布は 256px で足りる（レースの距離では 512 との差が見えない。書き出しが 4 分の 1 になる）
        const coatHex = parseInt(mats.hide.slice(1), 16);
        tex.face = png(faceTexture(r.coat, coatHex, r.hid, 256, r.marks?.face ? r.marks : null));
        // 脚：管・繋の材質の名前（legLow・white・legPaint）と蹄
        const legs = {};
        for (const L of ['LF', 'RF', 'LH', 'RH']) {
          const k = h.group.getObjectByName(`${L}_knee`);
          const f = h.group.getObjectByName(`${L}_fetlock`);
          const m = (g) => g.children.filter((c) => c.isMesh).map((c) => c.material.name || 'hide');
          legs[L] = { cannon: m(k)[0], pastern: m(f)[0], hoof: m(f)[1] };
        }
        return { gate: r.gate, mats, tex, legs };
      });
    }, runners);
    const dir = `godot/assets/horse/skins/${R.id}`;
    mkdirSync(dir, { recursive: true });
    const meta = {};
    for (const s of skins) {
      for (const [k, url] of Object.entries(s.tex)) {
        if (url) writeFileSync(`${dir}/${s.gate}_${k}.png`, Buffer.from(url.split(',')[1], 'base64'));
      }
      meta[s.gate] = { mats: s.mats, legs: s.legs };
    }
    writeFileSync(`${dir}/skins.json`, JSON.stringify(meta));
    console.log(`${R.name}：${skins.length} 頭の布`);
  }
} finally {
  await browser.close();
  server.kill();
}
