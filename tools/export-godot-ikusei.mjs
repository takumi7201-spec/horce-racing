// カード育成モードを Godot へ渡す（godot/data/ikusei/data.json）。
//
//   npm run godot-ikusei            データだけ
//   npm run godot-ikusei -- --art   カードの絵・顔・切り抜き・馬の布も（ブラウザで撮る。数分かかる）
//
// Godot の育成モード（godot/scripts/ik/）は、ゲームの src/sim/ikusei.js・ikusei-skills.js・race.js を GDScript に
// 移したもの。数値の表（カード・番組・コース・物理の定数）はここで書き出して、Godot は読むだけにする（二重に持たない）。
// 関数から導く値（カードの +値・カードパワー・スキル・条件戦の場の並び）もゲームの関数で書く：移した側が書き間違えても、
// 表は正しいまま。移したレースの計算が JS と合うかは tools/verify-godot-ikusei.mjs が見る。
//
// 浮動小数は短い小数のまま渡す。Godot の JSON は長い桁（17 桁）の小数を最後の桁で読み違える（2000 個中 234 個）。
// だからコースの幾何（半径・中心）は渡さず、公表値（周回・直線・向正面）から Godot の側で組む（buildTrack と同じ式）。
//
// 絵（--art）：カードの表（cardView をそのまま撮る。ホロ・箔の止まった姿）・顔のアイコン・ホームの切り抜き（sticker）、
// 馬の布（カードの馬ごとの顔・勝負服、NPC 用の毛色ごとの顔と勝負服、ゼッケン 18 番 × 8 枠）。

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import * as IK from '../src/sim/ikusei.js';
import { GRADED } from '../src/sim/schedule.js';
import { allCourses } from '../src/sim/course.js';
import { PHYS, TICK, GROUNDS, GROUND_EFFECT, GROWTH_CURVE, COATS, PRIZE_SHARE } from '../src/sim/params.js';
import { raceSkillDefs, supportSkillDefs } from '../src/sim/ikusei-skills.js';

const ART = process.argv.includes('--art');
// --bg だけ：カードの背景（馬の居ない一枚絵。バナーとチケットに敷く）だけを撮る
const BG_ONLY = process.argv.includes('--bg');
const OUT = 'godot/data/ikusei';
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- 表
// 二つ名（src/ui/cardview.js の epithetOf と同じ。画面の部品なので Node から読まずに写す）
const EPI = { speed: '疾風', stamina: '無尽', power: '剛脚', guts: '不屈', wit: '叡智' };
const NOUN = { LM: ['帝王', '女帝'], SSR: ['覇者', '女王'], SR: ['強豪', '女傑'], R: ['刺客', '才媛'], N: ['挑戦者', '新星'] };
const epithetOf = (c) => c.epithet ?? `${EPI[Object.keys(EPI).sort((a, b) => c.v[b] - c.v[a])[0]]}の${c.race.venue}${NOUN[c.rar][c.sex === '牝' ? 1 : 0]}`;
const packSize = IK.CARDS.reduce((m, c) => ({ ...m, [c.pack]: (m[c.pack] ?? 0) + 1 }), {});
const cards = IK.CARDS.map((c) => ({
  ...c, epithetText: epithetOf(c), no: Number(c.id.split('-')[1]), packSize: packSize[c.pack],
  plus: IK.plusOf(c), power: IK.cardPower(c), supportType: IK.supportType(c), distCat: IK.distCat(c.dist),
  // スキルは覚醒の段（0〜4）で数が変わる
  skills: [0, 1, 2, 3, 4].map((a) => IK.skillsOf(c, a)),
}));
const combos = [...new Map(GRADED.filter((r) => !r.abroad).map((r) => [`${r.courseId}|${r.surface}|${r.distance}`, r])).values()]
  .map((r) => ({ courseId: r.courseId, surface: r.surface, distance: r.distance }));
const graded = GRADED.filter((r) => !r.abroad).map((r) => ({
  id: r.id, name: r.name, grade: r.grade, courseId: r.courseId, surface: r.surface, distance: r.distance, week: r.week, age: r.age, sex: r.sex ?? null,
}));
const courses = {};
for (const c of allCourses()) {
  const pick = (s) => s && { lap: s.lap, straight: s.straight, toFirst: s.toFirst, back: s.back, width: s.width, slopes: s.slopes,
    cornerGrade: s.cornerGrade ?? null, straightOnly: s.straightOnly ?? null, vAdj: s.vAdj ?? 0 };
  courses[c.id] = { id: c.id, name: c.name, short: c.short ?? c.name, dir: c.dir, abroad: c.abroad ?? null, turf: pick(c.turf), dirt: pick(c.dirt) };
}
const strip = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x !== 'function'))]));

const data = {
  version: 1,
  cards, packs: IK.PACKS, packNames: IK.PACK_NAMES,
  events: IK.EVENTS, starD: IK.STAR_D,
  graded, combos, battleRaces: IK.BATTLE_RACES, difficulty: IK.DIFFICULTY,
  rates: IK.RATES, shardValue: IK.SHARD_VALUE, shardCost: IK.SHARD_COST, awaken: IK.AWAKEN,
  slots: IK.SLOTS, moods: IK.MOODS,
  raceSkills: strip(raceSkillDefs), supportSkills: strip(supportSkillDefs),
  courses,
  params: { TICK, PHYS, GROUNDS, GROUND_EFFECT, GROWTH: GROWTH_CURVE['持続'], COATS, PRIZE_SHARE },
};
writeFileSync(`${OUT}/data.json`, JSON.stringify(data));
console.log(`${OUT}/data.json：カード ${cards.length} 枚、番組 ${graded.length}、条件戦の場 ${combos.length}、コース ${Object.keys(courses).length}`);

// ---------------------------------------------------------------- アイコン（ゲームと同じ 24×24 の線の絵。Godot は白で読み、色は modulate で付ける）
// src/ui/icons.js の P と src/ui/screens/ikusei.js の SVG から、定義の行をそのまま拾う（画面の部品なので Node から読まずに文字で取る）
{
  const { readFileSync } = await import('node:fs');
  const pick = (file, from) => {
    const t = readFileSync(file, 'utf8');
    const body = t.slice(t.indexOf(from));
    const out = {};
    for (const m of body.slice(0, body.indexOf('};')).matchAll(/^\s*(\w+):\s*'(.*)',\s*$/gm)) out[m[1]] = m[2];
    return out;
  };
  const icons = { ...pick('src/ui/icons.js', 'const P = {'), ...pick('src/ui/screens/ikusei.js', 'const SVG = {') };
  mkdirSync('godot/assets/ui/icons', { recursive: true });
  for (const [k, v] of Object.entries(icons)) {
    // 96px で書く（Godot は SVG を書かれた大きさで絵にする。24px のままだと大きく貼ったときにぼける）
    writeFileSync(`godot/assets/ui/icons/${k}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96" fill="none" stroke="#ffffff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${v.replaceAll('currentColor', '#ffffff')}</svg>\n`);
  }
  console.log(`godot/assets/ui/icons：${Object.keys(icons).length} 個`);
}

if (!ART && !BG_ONLY) process.exit(0);

// ---------------------------------------------------------------- 絵（ブラウザで撮る）
const { default: pw } = await import('/opt/node-tools/node_modules/playwright/index.js');
const PORT = 8094;
const server = spawn(process.execPath, ['tools/serve.mjs', '--port', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const b64 = (url) => Buffer.from(url.split(',')[1], 'base64');
try {
  const page = await browser.newPage({ viewport: { width: 700, height: 960 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('page:', e.message));
  await page.goto(`http://localhost:${PORT}/sw.js`);
  await page.evaluate(() => {
    document.documentElement.innerHTML = '<head><link rel="stylesheet" href="/styles.css"></head><body style="margin:0;background:#113035"><div id="st" style="padding:20px"></div></body>';
  });
  await page.waitForTimeout(500);

  const cdir = 'godot/assets/cards';
  mkdirSync(`${cdir}/bg`, { recursive: true });
  for (const c of IK.CARDS) {
    // 背景（ぼかしを焼き込んだ絵）。横 420px の webp
    const url = await page.evaluate(async (id) => {
      const { cardArt } = await import('/src/render3d/cardart.js');
      const { cardById } = await import('/src/sim/ikusei.js');
      const a = await cardArt(cardById(id));
      const im = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = a.bg; });
      const cv = document.createElement('canvas');
      cv.width = 420; cv.height = Math.round((im.height / im.width) * 420);
      cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
      return cv.toDataURL('image/webp', 0.8);
    }, c.id);
    writeFileSync(`${cdir}/bg/${c.id}.webp`, b64(url));
    process.stdout.write(`\rbg ${c.id} `);
  }
  console.log(`\n${cdir}/bg：${IK.CARDS.length} 枚`);
  if (BG_ONLY) { await browser.close(); server.kill(); process.exit(0); }
  mkdirSync(`${cdir}/face`, { recursive: true });
  mkdirSync(`${cdir}/sticker`, { recursive: true });
  for (const c of IK.CARDS) {
    // カードの表：ホロと箔が止まった姿。傾けるのと光沢は Godot の側で掛ける
    const r = await page.evaluate(async (id) => {
      const { cardView } = await import('/src/ui/cardview.js');
      const { cardArt } = await import('/src/render3d/cardart.js');
      const { cardById } = await import('/src/sim/ikusei.js');
      const c = cardById(id);
      const a = await cardArt(c);
      const st = document.getElementById('st');
      st.textContent = '';
      st.append(cardView(c, { scale: 1, tilt: null, eager: true }));
      for (let i = 0; i < 40 && !st.querySelector('.tc-art .f')?.style.backgroundImage; i++) await new Promise((res) => setTimeout(res, 50));
      // 顔のアイコン：切り抜き（sticker）の頭（focus）を中心に 2.4 倍で丸く切る（ikusei.js の cardIcon と同じ）
      const st0 = a.sticker;
      const img = await new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = st0?.url ?? a.fg; });
      const S = 192, cv = document.createElement('canvas');
      cv.width = cv.height = S;
      const g = cv.getContext('2d');
      // CSS の background-position と同じく、切る窓は絵の内側に収める（頭が絵の端にあっても窓は外へ出さない）
      const span = img.width / 2.4;
      const inside = (v, len) => (len > span ? Math.min(len - span / 2, Math.max(span / 2, v)) : len / 2);
      const fx = inside((st0?.focus?.x ?? 0.5) * img.width, img.width), fy = inside((st0?.focus?.y ?? 0.35) * img.height, img.height);
      g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); g.clip();
      g.drawImage(img, fx - span / 2, fy - span / 2, span, span, 0, 0, S, S);
      return { face: cv.toDataURL('image/png'), sticker: a.sticker?.url ?? null, focus: a.sticker?.focus ?? null };
    }, c.id);
    await page.waitForTimeout(150);
    await page.locator('#st .tc').screenshot({ path: `/tmp/card-${c.id}.png` });
    writeFileSync(`${cdir}/face/${c.id}.png`, b64(r.face));
    if (r.sticker) {
      const webp = await page.evaluate(async (u) => {
        const im = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = u; });
        const cv = document.createElement('canvas');
        cv.width = im.width; cv.height = im.height;
        cv.getContext('2d').drawImage(im, 0, 0);
        return cv.toDataURL('image/webp', 0.86);
      }, r.sticker);
      writeFileSync(`${cdir}/sticker/${c.id}.webp`, b64(webp));
    }
    // 表は webp で（png のままだと 1 枚 700KB）
    const front = await page.evaluate(async (u) => {
      const im = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = u; });
      const cv = document.createElement('canvas');
      cv.width = im.width; cv.height = im.height;
      cv.getContext('2d').drawImage(im, 0, 0);
      return cv.toDataURL('image/webp', 0.86);
    }, `data:image/png;base64,${(await import('node:fs')).readFileSync(`/tmp/card-${c.id}.png`).toString('base64')}`);
    writeFileSync(`${cdir}/${c.id}.webp`, b64(front));
    process.stdout.write(`\r${c.id} `);
  }
  console.log(`\n${cdir}：${IK.CARDS.length} 枚の表・顔・切り抜き`);

  // ---------------------------------------------------------------- 馬の布の手持ち
  // 育成のレースは Godot で走らせるので、どの馬が出るかは前もって決まらない。カードの馬は馬ごと、
  // NPC は毛色ごとの顔と、勝負服の柄の手持ち（SILKS 通り）から選ぶ。ゼッケンは馬番 × 枠の色。
  const SILKS = 24;
  const lib = await page.evaluate(async ({ cards, coats, SILKS }) => {
    const { makeHorse } = await import('/src/render3d/horse3d.js');
    const { faceTexture } = await import('/src/render3d/horsehead.js');
    const hex = (c) => `#${c.getHexString()}`;
    const png = (tex) => {
      const img = tex?.image;
      if (!img?.toDataURL) return null;
      if (tex.flipY === false) return img.toDataURL('image/png');
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.translate(0, c.height); g.scale(1, -1); g.drawImage(img, 0, 0);
      return c.toDataURL('image/png');
    };
    const skin = (o, faceOf = true) => {
      const h = makeHorse({ ...o, detail: 'high' });
      const mats = {}, tex = {};
      h.group.traverse((m) => {
        if (!m.isMesh) return;
        for (const x of [m.material].flat()) {
          if (!x.name) continue;
          mats[x.name] ??= hex(x.color);
          if (x.map && ['number', 'silks', 'sleeve'].includes(x.name)) tex[x.name] ??= png(x.map);
        }
      });
      if (faceOf) tex.face = png(faceTexture(o.coat, parseInt(mats.hide.slice(1), 16), o.id, 256, o.marks?.face ? o.marks : null));
      const legs = {};
      for (const L of ['LF', 'RF', 'LH', 'RH']) {
        const k = h.group.getObjectByName(`${L}_knee`), f = h.group.getObjectByName(`${L}_fetlock`);
        const m = (g) => g.children.filter((c) => c.isMesh).map((c) => c.material.name || 'hide');
        legs[L] = { cannon: m(k)[0], pastern: m(f)[0], hoof: m(f)[1] };
      }
      return { mats, tex, legs };
    };
    const out = { cards: {}, coats: {}, silks: [], numbers: {} };
    for (const c of cards) out.cards[c.id] = skin({ id: c.hid, gate: c.gate ?? 1, frame: 1, coat: c.artCoat ?? c.coat, marks: c.marks, silks: c.silks });
    for (const coat of coats) out.coats[coat] = [0, 1, 2].map((v) => skin({ id: 7000 + v * 13 + coats.indexOf(coat), gate: 1, frame: 1, coat }));
    for (let k = 0; k < SILKS; k++) {
      const s = skin({ id: 9100 + k * 7, gate: 1, frame: 1, coat: '鹿毛' }, false);
      out.silks.push({ silks: s.tex.silks, sleeve: s.tex.sleeve, mats: { silks: s.mats.silks, sleeve: s.mats.sleeve, boot: s.mats.boot } });
    }
    for (let frame = 1; frame <= 8; frame++) for (let gate = 1; gate <= 18; gate++) {
      const s = skin({ id: 1, gate, frame, coat: '鹿毛' }, false);
      out.numbers[`${gate}_${frame}`] = { tex: s.tex.number, cap: s.mats.cap };
    }
    return out;
  }, { cards: IK.CARDS.map((c) => ({ id: c.id, hid: c.hid, gate: c.gate, coat: c.coat, artCoat: c.artCoat, marks: c.marks, silks: c.silks })), coats: [...new Set([...COATS.slice(0, 7), ...IK.CARDS.map((c) => c.coat), ...IK.EVENTS.flatMap((e) => e.field.map((m) => m.coat))])], SILKS });

  const hdir = 'godot/assets/horse/lib';
  mkdirSync(hdir, { recursive: true });
  const meta = { cards: {}, coats: {}, silks: [], numbers: {} };
  const put = (name, url) => { if (url) writeFileSync(`${hdir}/${name}.png`, b64(url)); return url ? `${name}.png` : null; };
  for (const [id, s] of Object.entries(lib.cards)) {
    meta.cards[id] = { mats: s.mats, legs: s.legs, face: put(`c_${id}_face`, s.tex.face), silks: put(`c_${id}_silks`, s.tex.silks), sleeve: put(`c_${id}_sleeve`, s.tex.sleeve) };
  }
  for (const [coat, list] of Object.entries(lib.coats)) {
    meta.coats[coat] = list.map((s, v) => ({ mats: s.mats, legs: s.legs, face: put(`k_${Object.keys(lib.coats).indexOf(coat)}_${v}_face`, s.tex.face) }));
  }
  lib.silks.forEach((s, k) => meta.silks.push({ mats: s.mats, silks: put(`s_${k}_silks`, s.silks), sleeve: put(`s_${k}_sleeve`, s.sleeve) }));
  for (const [k, s] of Object.entries(lib.numbers)) meta.numbers[k] = { cap: s.cap, tex: put(`n_${k}`, s.tex) };
  writeFileSync(`${hdir}/lib.json`, JSON.stringify(meta));
  console.log(`${hdir}：カードの馬 ${Object.keys(meta.cards).length}、毛色 ${Object.keys(meta.coats).length}、勝負服 ${meta.silks.length}、ゼッケン ${Object.keys(meta.numbers).length}`);
} finally {
  await browser.close();
  server.kill();
}
