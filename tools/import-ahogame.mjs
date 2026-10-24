// 「Winning Post 10 2026 攻略」（ahogame.netgamers.jp）の史実馬の一覧から、事実だけを取り込む道具。
//
//   node tools/import-ahogame.mjs            # 取得（無ければ）して src/sim/data/ahogame-facts.js を書く
//   node tools/import-ahogame.mjs --offline  # キャッシュ（.cache/ahogame）だけで組み直す
//   node tools/import-ahogame.mjs --depth 1  # 一覧に載っている親のさらに親を何代たどるか
//
// 取るのは史実の事実だけ。ゲームの数値は取らない（CLAUDE.md の方針「数値はウイポのものではなく独自」）。
//   取る   馬名（カタカナ・英字）・生年・性・毛色・生国・父・母、種牡馬の引退年
//   取らない  能力・適性・成長型・因子・特性・系統の分類・セリ・競走馬/繁殖の引退年齢など、ゲームが決めた値
// 表をそのまま写すのでもない。表にある馬の空いた父母と、親の名前（海外馬のカタカナ名）を引くのに使う。
// 一覧に載っている馬を新しい競走馬として足すことはしない（能力はこちらで導く。落とし穴 43・46）。
//
// 取り込みの規則（静かに間違った血統を入れないため。落とし穴 43・45・53 と同じ型）:
//   - 表の馬との照合は「名前（小書きのカナ・長音を均す）と生年」が一致するものだけ。
//     日本の馬名は年代をまたいで再登録されるので、名前だけでは別の馬に結ばれる。
//   - 親は一覧の名前しか持たない。同じ名の馬が複数いるときは、親子の年齢差が 2〜30 歳のものだけを候補にし、
//     一つに決まらなければ結ばない。
//   - 父母が空の馬にだけ補う。既にある父母は上書きしない。
//   - 一覧の親の親も --depth 代までたどる。一覧に載っていない親は、表に同名の馬が無いときだけ
//     名前だけの祖先として残す（生年は子の 8 年前。--stubs と同じ）。
//   - 出力は表の末尾に重ねるだけ（real-horses.js の withAhogame）。順番を変えると世界の乱数がずれる。
// 一覧のページは 2〜5MB あるので、1 回だけ取ってキャッシュする。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_TABLE } from '../src/sim/data/real-horses.js';
import { WD_FILL, WD_NEW } from '../src/sim/data/wikidata-parents.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/sim/data/ahogame-facts.js');
const BASE_URL = 'https://ahogame.netgamers.jp/wp102026/';
const UA = 'keiba-sim-import/0.1 (https://github.com/takumi7201-spec/horce-racing; historical horse facts)';
const PAGES = { jp: 'shijitsuhorse', os: 'shijitsuhorse2', br: 'shijitsuhansyoku', retire: 'sireretire' };

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const OFFLINE = flag('--offline');
// 既定は 1。2 にすると祖先が約 700 頭増えて埋まり率は 2 ポイントしか上がらない（74% → 76%）。
const DEPTH = Number(opt('--depth', 1));
const CACHE = resolve(ROOT, opt('--cache', '.cache/ahogame'));
mkdirSync(CACHE, { recursive: true });

// ---------------------------------------------------------------- 取得と表の読み取り

async function page(name) {
  const path = join(CACHE, `${name}.html`);
  if (!existsSync(path)) {
    if (OFFLINE) throw new Error(`${path} が無い（--offline）`);
    const res = await fetch(`${BASE_URL}${name}.html`, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));   // Shift_JIS のまま貯める
  }
  return new TextDecoder('shift_jis').decode(readFileSync(path));
}

/** 表の行。<td> を閉じない書き方なので、<tr> と <td> の開きで切る。 */
function rows(html) {
  const strip = (s) => s.replace(/<br\s*\/?>/gi, ' / ').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
  const out = [];
  for (const part of html.split(/<tr[\s>]/i).slice(1)) {
    const body = part.split(/<\/tr>/i)[0];
    out.push(body.split(/<t[dh][\s>]/i).slice(1).map((c) => strip(c.replace(/^[^>]*>/, ''))));
  }
  return out;
}

const year = (s) => { const m = /^(\d{4})/.exec(s ?? ''); return m ? Number(m[1]) : null; };
const COAT = { 栗毛: '栗毛', 鹿毛: '鹿毛', 黒鹿: '黒鹿毛', 黒鹿毛: '黒鹿毛', 青鹿: '青鹿毛', 青鹿毛: '青鹿毛', 青毛: '青毛', 芦毛: '芦毛', 栃栗: '栃栗毛', 栃栗毛: '栃栗毛', 白毛: '白毛' };

/** 事実の列だけを取る（能力・因子などの列は読まない）。 */
const readJp = (r) => ({ n: r[0], b: year(r[2]), sex: r[3], coat: COAT[r[4]] ?? null, sire: r[7], dam: r[8] });
const readOs = (r) => ({ alpha: r[0], n: r[1], b: year(r[3]), sex: r[4], coat: COAT[r[5]] ?? null, sire: r[8], dam: r[9] });
const readBr = (r) => ({ n: r[0], alpha: r[1] || null, b: year(r[3]), sex: r[4], coat: COAT[r[5]] ?? null, sire: r[8], dam: r[9] });

const recs = [];
for (const [key, reader, col] of [['jp', readJp, 2], ['os', readOs, 3], ['br', readBr, 3]]) {
  for (const r of rows(await page(PAGES[key]))) {
    if (r.length >= 30 && /^\d{4}$/.test(r[col])) recs.push({ ...reader(r), list: key });
  }
}
// 種牡馬の引退年: [種牡馬名, 引退年, 年齢, 地域, 父馬名, 系統, 28 歳到達年]。系統はゲームの分類なので読まない。
const retire = [];
for (const r of rows(await page(PAGES.retire))) {
  if (r.length === 7 && /^\d{4}年$/.test(r[1]) && /^\d+歳$/.test(r[2])) retire.push({ n: r[0], y: year(r[1]), age: Number(r[2].replace('歳', '')), region: r[3] });
}
console.error(`一覧 ${recs.length} 頭（日本 ${recs.filter((x) => x.list === 'jp').length} / 海外 ${recs.filter((x) => x.list === 'os').length} / 繁殖専用 ${recs.filter((x) => x.list === 'br').length}）、引退年 ${retire.length} 頭`);

// ---------------------------------------------------------------- 照合の下ごしらえ

/** 小書きのカナ・長音・中黒・空白・記号を均す。 */
const norm = (s) => (s ?? '').normalize('NFKC').replace(/[ァィゥェォャュョッ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 1))
  .replace(/[ー・\s'.\-]/g, '').toLowerCase();
const isKana = (s) => /[ァ-ヶぁ-ん]/.test(s);

const recByName = new Map();    // norm(カタカナ名) → 記録
const recByAlpha = new Map();   // norm(英字名) → 記録
for (const r of recs) {
  if (isKana(r.n)) recByName.set(norm(r.n), [...(recByName.get(norm(r.n)) ?? []), r]);
  if (r.alpha) recByAlpha.set(norm(r.alpha), [...(recByAlpha.get(norm(r.alpha)) ?? []), r]);
}
// 英字名 → カタカナ名（親は海外馬だと英字で書かれている）。同じ英字名が別の年の馬なら決められないので載せない。
const alphaToKana = new Map();
for (const [k, list] of recByAlpha) {
  const kanas = new Set(list.map((x) => x.n).filter(isKana));
  if (kanas.size === 1) alphaToKana.set(k, [...kanas][0]);
}
const kanaOf = (s) => (isKana(s) ? s : alphaToKana.get(norm(s)) ?? s);

const table = BASE_TABLE.map((h) => ({ ...h }));
const nameIdx = new Map();
const add = (e) => nameIdx.set(norm(e.n), [...(nameIdx.get(norm(e.n)) ?? []), e]);
for (const e of table) add(e);

const gapOk = (child, b) => child.b - b >= 2 && child.b - b <= 30;
const stubLike = (h) => h.bg && h.s === '牝' && !h.sire && !h.dam && h.lvl == null && !h.mare;

/** 表の馬に対応する一覧の記録（名前と生年が一致）。 */
function recFor(e) {
  const hit = (list) => (list ?? []).filter((r) => r.b === e.b);
  const a = hit(recByName.get(norm(e.n)));
  if (a.length === 1) return a[0];
  if (a.length > 1) return null;
  const b = hit(recByAlpha.get(norm(e.n)));
  return b.length === 1 ? b[0] : null;
}

// ---------------------------------------------------------------- 父母を補う

const fills = new Map();     // 表の馬 → { sire, dam }
const added = [];            // 新しい祖先
let reused = 0, createdRec = 0, createdStub = 0, ambiguous = 0, skippedGap = 0;
const queue = [];            // 父母を調べる馬 { e, depth }
const queued = new Set();

/** 親の名前（一覧の文字列）を表の名に直す。結べないときは null。 */
function resolveParent(pstr, child, role, depth) {
  if (!pstr || pstr === '-' || pstr === '不明') return null;
  const pk = kanaOf(pstr);
  const key = norm(pk);
  if (!key) return null;
  const ents = (nameIdx.get(key) ?? []).filter((e) => gapOk(child, e.b));
  let rs = (recByName.get(key) ?? []).filter((r) => gapOk(child, r.b));
  if (!rs.length) rs = (recByAlpha.get(norm(pstr)) ?? []).filter((r) => gapOk(child, r.b));
  // 一覧に記録があるときは、その生年で表の馬と合わせる。
  if (rs.length) {
    const years = [...new Set(rs.map((r) => r.b))];
    let b = null;
    if (years.length === 1) b = years[0];
    else { const inTable = years.filter((y) => ents.some((e) => e.b === y)); if (inTable.length === 1) b = inTable[0]; }
    if (b == null) { ambiguous++; return null; }
    const rec = rs.find((r) => r.b === b);
    const ent = ents.find((e) => e.b === b) ?? (nameIdx.get(key) ?? []).find((e) => Math.abs(e.b - b) <= 1);
    if (ent) { reused++; return ent.n; }
    const n = isKana(rec.n) ? rec.n : pk;
    if ((nameIdx.get(norm(n)) ?? []).length) { ambiguous++; return null; }   // 同名の別馬が表に居る
    const e = { n, b, s: rec.sex === '牝' ? '牝' : undefined, c: rec.coat && rec.coat !== '鹿毛' ? rec.coat : undefined, sire: null, dam: null, bg: true, _new: true };
    add(e); added.push(e); createdRec++;
    if (depth < DEPTH && !queued.has(e)) { queued.add(e); queue.push({ e, depth: depth + 1 }); }
    return n;
  }
  // 一覧に無い親。表に同名の馬が一頭だけ居ればそれ、居なければ名前だけの祖先にする。
  if (ents.length === 1) { reused++; return ents[0].n; }
  if (ents.length > 1) { ambiguous++; return null; }
  if ((nameIdx.get(key) ?? []).length) { skippedGap++; return null; }   // 同名の別馬（年齢差が合わない）
  if (!/^[ァ-ヶー・ヴ]{2,}$|^[A-Za-z][A-Za-z' .\-]+$/.test(pk)) return null;
  const e = { n: pk, b: child.b - 8, s: role === 'dam' ? '牝' : undefined, sire: null, dam: null, bg: true, _new: true };
  add(e); added.push(e); createdStub++;
  return pk;
}

for (const e of table) {
  if (stubLike(e) || (e.sire != null && e.dam != null)) continue;
  if (recFor(e)) { queued.add(e); queue.push({ e, depth: 0 }); }
}
console.error(`父母が空で、一覧に載っている表の馬 ${queue.length} 頭`);
while (queue.length) {
  const { e, depth } = queue.shift();
  const rec = recFor(e);
  if (!rec) continue;
  const f = fills.get(e) ?? {};
  for (const role of ['sire', 'dam']) {
    if (e[role] != null || f[role]) continue;
    const n = resolveParent(rec[role], e, role, depth);
    if (n) f[role] = n;
  }
  if (f.sire || f.dam) fills.set(e, f);
}
// 新しい祖先の父母は、その馬自身に書く。
for (const e of added) {
  const f = fills.get(e);
  if (f) { e.sire = f.sire ?? null; e.dam = f.dam ?? null; fills.delete(e); }
}
const dFill = [...fills].filter(([e]) => !e._new);
console.error(`既存の馬に補った父母 ${dFill.length} 頭、新しい祖先 ${added.length} 頭（一覧に記録あり ${createdRec}、名前だけ ${createdStub}）、表の既存馬を再利用 ${reused}`);
console.error(`結ばなかった: 同名で決まらない ${ambiguous}、年齢差が合わない同名 ${skippedGap}`);

// ---------------------------------------------------------------- 種牡馬の引退年

// 引退年と年齢から生年が決まる。日本で供用された馬だけ（海外の引退年は日本の名簿に関係しない）。
const retYears = [];
{
  const byKey = new Map(table.map((e) => [`${norm(e.n)}|${e.b}`, e]));
  for (const r of retire) {
    if (r.region !== '日本') continue;
    const e = byKey.get(`${norm(r.n)}|${r.y - r.age}`);
    if (e) retYears.push([e.n, e.b, r.y]);
  }
}
console.error(`引退年を表の馬に結べた ${retYears.length} 頭（日本で供用された ${retire.filter((r) => r.region === '日本').length} 頭のうち）`);

// ---------------------------------------------------------------- 海外馬のカタカナ名

// Wikidata から補った英語名の馬を、一覧のカタカナ名に直すための対応表。
const usedAlpha = new Set();
for (const [, , sire, dam] of WD_FILL) { if (sire) usedAlpha.add(sire); if (dam) usedAlpha.add(dam); }
for (const [n, , , sire, dam] of WD_NEW) { usedAlpha.add(n); if (sire) usedAlpha.add(sire); if (dam) usedAlpha.add(dam); }
const alias = [];
for (const a of usedAlpha) {
  if (isKana(a)) continue;
  const k = alphaToKana.get(norm(a));
  if (k) alias.push([a, k]);
}
console.error(`Wikidata の英語名 ${[...usedAlpha].filter((a) => !isKana(a)).length} のうち、カタカナ名に直せる ${alias.length}`);

// ---------------------------------------------------------------- 書き出し

const q = (s) => (s == null ? 'null' : `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);
const body = `// 「Winning Post 10 2026 攻略」の史実馬の一覧から取った、史実の事実だけ。
// tools/import-ahogame.mjs が書く（手で直さない）。real-horses.js の withAhogame が表の末尾に重ねる。
// ゲームの数値（能力・因子・成長型など）は含まない。
//   AHO_FILL    [馬名, 生年, 父, 母]               表で父母が空だった馬に補う（null は補わない）
//   AHO_NEW     [馬名, 生年, 性, 毛色, 父, 母]     表に無かった祖先（血統をつなぐだけ）
//   AHO_RETIRE  [馬名, 生年, 引退年]               日本で供用された種牡馬の引退年
//   AHO_ALIAS   [英語名, カタカナ名]               Wikidata から補った英語名の馬のカタカナ名

export const AHO_FILL = [
${dFill.map(([e, f]) => `  [${q(e.n)}, ${e.b}, ${q(f.sire)}, ${q(f.dam)}],`).join('\n')}
];

export const AHO_NEW = [
${added.map((e) => `  [${q(e.n)}, ${e.b}, ${q(e.s ?? '牡')}, ${q(e.c ?? null)}, ${q(e.sire)}, ${q(e.dam)}],`).join('\n')}
];

export const AHO_RETIRE = [
${retYears.map(([n, b, y]) => `  [${q(n)}, ${b}, ${y}],`).join('\n')}
];

export const AHO_ALIAS = [
${alias.map(([a, k]) => `  [${q(a)}, ${q(k)}],`).join('\n')}
];
`;
writeFileSync(OUT, body);
console.error(`${OUT} に書いた`);
