// 父母の空いている馬を、英語版 Wikipedia の記事のインフォボックス（sire・dam）で埋める道具。
//
//   node tools/import-enwiki-pedigree.mjs            # 取得して src/sim/data/enwiki-parents.js を書く
//   node tools/import-enwiki-pedigree.mjs --offline  # キャッシュ（.cache/enwiki）だけで組み直す
//   node tools/import-enwiki-pedigree.mjs --limit 200  # 取得する記事の数の上限（試し用）
//
// Wikidata の道具（import-wikidata-parents.mjs）は QID から英語版の記事へ行くので、Wikidata に項目が無い馬や、
// 項目に英語版の記事への結びつきが無い馬（プリンスパラタインの母レディライトフットなど）の親は取れなかった。
// ここでは馬の英語名（対応表のカタカナ名の元の英語名・一覧の英字名・英語のままの名）から記事名を直に当てる。
//
// 規則（静かに間違った血統を入れないため。CLAUDE.md の落とし穴 43・45 と同じ型）:
//   - 記事はインフォボックス（racehorse）を持つものだけ。リダイレクトは 2 回まで追う。曖昧さ回避は採らない。
//   - 生年（foaled）が表の生年と 2 年以内で合うこと。名前だけの祖先（生年が子からの推定）は 12 年以内で、
//     表の子すべてから見た親子の年齢差が 2〜30 歳に収まること。
//   - 親の名は英語版の表記。表に同じ英語名の馬が一頭だけ居て年齢差が合えばその馬、居なければ新しい祖先にする。
//     新しい祖先は、5 代血統表に出る範囲（競走馬から数えて 5 代目まで）だけ作る（世界を膨らませない）。
//   - 表に既にある父母は上書きしない。
// 出力は表の末尾に重ねるだけ（real-horses.js の withEnwiki）。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { EW_BASE } from '../src/sim/data/real-horses.js';
import { KATAKANA } from '../src/sim/data/katakana-names.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/sim/data/enwiki-parents.js');
const UA = 'keiba-sim-import/0.1 (https://github.com/takumi7201-spec/horce-racing; real-horses parents)';
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const OFFLINE = flag('--offline');
const LIMIT = Number(opt('--limit', Infinity));
const MAXD = Number(opt('--depth', 5));
const CACHE = resolve(ROOT, opt('--cache', '.cache/enwiki'));
mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 記事の取得
let fetched = 0;
async function raw(title) {
  const path = join(CACHE, `${createHash('sha1').update(title).digest('hex')}.txt`);
  if (existsSync(path)) return readFileSync(path, 'utf8');
  if (OFFLINE) return '';
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`https://en.wikipedia.org/w/index.php?action=raw&title=${encodeURIComponent(title)}`, { headers: { 'User-Agent': UA } });
    if (res.ok || res.status === 404) {
      const text = res.ok ? await res.text() : '';
      writeFileSync(path, text);
      fetched++;
      await sleep(300);
      return text;
    }
    await sleep(3000 * (attempt + 1));
  }
  return '';
}

/** リダイレクトを追って本文を返す。 */
async function page(title) {
  let t = title;
  for (let i = 0; i < 3; i++) {
    const text = await raw(t);
    const m = /^\s*#REDIRECT\s*\[\[([^\]#|]+)/i.exec(text);
    if (!m) return text;
    t = m[1].trim();
  }
  return '';
}

/** インフォボックスの欄から { title, text } を取る。 */
function field(text, name) {
  const m = new RegExp(`\\|\\s*${name}\\s*=\\s*([^\\n]*)`, 'i').exec(text);
  if (!m) return null;
  const v = m[1].replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/<ref[^>]*\/>/g, '').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>.*$/i, '').trim();
  return v;
}
function enParent(text, name) {
  const v = field(text, name);
  if (!v) return null;
  const link = /\[\[([^\]|#]+)(?:\|([^\]]*))?\]\]/.exec(v);
  const title = link ? link[1].trim() : null;
  let n = (link ? (link[2] || link[1]) : v).replace(/\[\[|\]\]|'{2,3}/g, '').trim();
  n = n.replace(/\s*\((?:[A-Z]{2,3}|horse|racehorse|[A-Za-z]+ horse)\)\s*$/i, '').trim();
  if (!n || /^(unknown|\?|n\/a)$/i.test(n) || n.length > 40 || !/^[A-Za-z][A-Za-z' .\-]+$/.test(n)) return null;
  return { title, text: n };
}
const foaledOf = (text) => {
  const v = field(text, 'foaled') ?? field(text, 'birth_date') ?? field(text, 'foaled_date');
  const m = v && /(1[6-9]\d\d|20\d\d)/.exec(v);
  return m ? Number(m[1]) : null;
};
const isHorsePage = (text) => /\{\{\s*Infobox\s+(racehorse|horse)/i.test(text);

// ---------------------------------------------------------------- 表の索引
const latin = (n) => /^[A-Za-z]/.test(n);
const normEn = (s) => s.toLowerCase().replace(/\bst\.?\s/g, 'st ').replace(/[^a-z0-9]/g, '');
const alpha = JSON.parse(readFileSync(join(ROOT, 'tools/data/alpha-names.json'), 'utf8'));
const rev = new Map();
for (const [en, k] of KATAKANA) rev.set(k, [...(rev.get(k) ?? []), en]);
const key = (n, b) => `${n}|${b}`;
const byName = new Map(EW_BASE.map((h) => [h.n, h]));
const enNamesOf = (h) => [...new Set([...(latin(h.n) ? [h.n] : []), ...(rev.get(h.n) ?? []), ...(alpha[h.n] ? [alpha[h.n]] : [])])];
const enIdx = new Map();     // 正規化した英語名 → 表の馬
for (const h of EW_BASE) for (const e of enNamesOf(h)) enIdx.set(normEn(e), [...(enIdx.get(normEn(e)) ?? []), h]);
const kids = new Map();
for (const h of EW_BASE) for (const p of [h.sire, h.dam]) if (p) kids.set(p, [...(kids.get(p) ?? []), h.b]);
const stubLike = (h) => h.bg && h.lvl == null;

// 競走馬からの世代（5 代血統表に出る範囲だけ扱う）
const depth = new Map();
{
  let fr = EW_BASE.filter((h) => h.lvl != null);
  for (const h of fr) depth.set(h.n, 0);
  for (let d = 0; d < MAXD; d++) {
    const nx = [];
    for (const h of fr) for (const k of ['sire', 'dam']) { const p = byName.get(h[k]); if (p && !depth.has(p.n)) { depth.set(p.n, d + 1); nx.push(p); } }
    fr = nx;
  }
}

// ---------------------------------------------------------------- 本体
const fills = new Map();          // key(n,b) → { sire, dam }
const added = [];                 // { n, b, s, sire, dam }
const addedByEn = new Map();      // 正規化した英語名 → 新しい祖先
const stats = { pages: 0, noPage: 0, badYear: 0, filled: 0, created: 0, reused: 0, ambiguous: 0, badAge: 0 };

/** 英語名から記事を探す。{ text, year } か null。 */
async function find(ens) {
  for (const e of ens) {
    // 「(horse)」付きの記事は、素の題が別の記事に使われているときだけ在る。素の題が無ければ（404）試さない。
    const base = await page(e);
    if (base && isHorsePage(base)) return { text: base, year: foaledOf(base) };
    if (!base) continue;
    for (const t of [`${e} (horse)`, `${e} (racehorse)`]) {
      const text = await page(t);
      if (text && isHorsePage(text)) return { text, year: foaledOf(text) };
    }
  }
  return null;
}

const queue = [];
const seen = new Set();
const push = (node, d, ens) => { const k = key(node.n, node.b); if (seen.has(k)) return; seen.add(k); queue.push({ node, d, ens }); };
for (const h of EW_BASE) {
  if (h.sire && h.dam) continue;
  const d = depth.get(h.n);
  if (d == null || d >= MAXD) continue;
  const ens = enNamesOf(h);
  if (ens.length) push(h, d, ens);
}
queue.sort((a, b) => a.d - b.d);
console.error(`対象 ${queue.length} 頭（父母のどちらかが空で、英語名がある）`);

/** 親の英語名 → 表の名前（新しく作ったら名前）。年は子の生年 cy から見る。 */
function resolve1(ep, cy, d, role) {
  const k = normEn(ep.text);
  const cands = (enIdx.get(k) ?? []).filter((p) => {
    const g = cy - p.b;
    return stubLike(p) ? g >= -4 && g <= 34 : g >= 2 && g <= 30;
  });
  if (cands.length === 1) { stats.reused++; return cands[0].n; }
  if (cands.length > 1) { stats.ambiguous++; return null; }
  if ((enIdx.get(k) ?? []).length) { stats.badAge++; return null; }   // 同名の別馬
  if (addedByEn.has(k)) return addedByEn.get(k).n;
  if (d + 1 > MAXD) return null;
  const e = { n: ep.text, b: cy - 8, s: role === 'dam' ? '牝' : '牡', sire: null, dam: null, _d: d + 1, _title: ep.title };
  added.push(e); addedByEn.set(k, e); stats.created++;
  push(e, d + 1, [ep.text, ...(ep.title ? [ep.title] : [])]);
  return e.n;
}

let n = 0;
for (let i = 0; i < queue.length; i++) {
  const { node, d, ens } = queue[i];
  if (n >= LIMIT) break;
  const before = fetched;
  const found = await find(ens);
  if (fetched > before) n++;
  if (!found) { stats.noPage++; continue; }
  stats.pages++;
  const cs = kids.get(node.n) ?? [];
  const tol = node._d ? 99 : stubLike(node) ? 12 : 2;
  if (found.year != null) {
    if (Math.abs(found.year - node.b) > tol || !cs.every((c) => c - found.year >= 2 && c - found.year <= 30)) { stats.badYear++; continue; }
  } else if (!stubLike(node) && !node._d) { stats.badYear++; continue; }
  const y = found.year ?? node.b;
  if (node._d) node.b = y;       // 新しい祖先は記事の生年へ直す
  const f = fills.get(key(node.n, node.b)) ?? {};
  for (const role of ['sire', 'dam']) {
    if (node[role] != null || f[role]) continue;
    const ep = enParent(found.text, role);
    if (!ep) continue;
    const r = resolve1(ep, y, d, role);
    if (r) { f[role] = r; }
  }
  if (f.sire || f.dam) { fills.set(key(node.n, node.b), f); stats.filled++; }
  if (i % 200 === 0) console.error(`  ${i}/${queue.length} 記事 ${stats.pages}、補った ${stats.filled}、新しい祖先 ${added.length}`);
}
// 新しい祖先の父母は、その祖先自身に書く。
for (const e of added) {
  const f = fills.get(key(e.n, e.b));
  if (f) { e.sire = f.sire ?? null; e.dam = f.dam ?? null; fills.delete(key(e.n, e.b)); }
}
console.error(stats);
console.error(`既存の馬に補った父母 ${fills.size} 頭、新しい祖先 ${added.length} 頭`);

const q = (s) => (s == null ? 'null' : `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);
const body = `// 英語版 Wikipedia から補った父母。tools/import-enwiki-pedigree.mjs が書く（手で直さない）。
// real-horses.js の withEnwiki が表の末尾に重ねる。
//   EW_FILL  [馬名, 生年, 父, 母]   表で父母が空だった馬に補う（null は補わない）
//   EW_NEW   [馬名, 生年, 性, 父, 母]  表に無かった祖先（血統をつなぐだけ。英語名は katakana-names.js でカタカナにする）

export const EW_FILL = [
${[...fills].map(([k, f]) => { const [nm, b] = k.split('|'); return `  [${q(nm)}, ${b}, ${q(f.sire)}, ${q(f.dam)}],`; }).join('\n')}
];

export const EW_NEW = [
${added.map((e) => `  [${q(e.n)}, ${e.b}, ${q(e.s)}, ${q(e.sire)}, ${q(e.dam)}],`).join('\n')}
];
`;
writeFileSync(OUT, body);
console.error(`${OUT} に書いた`);
