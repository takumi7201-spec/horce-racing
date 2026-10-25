// ja.wikipedia の記事の「競走馬血統表」から、表の馬の父母を埋める道具。
//
//   node tools/import-jawiki-pedigree.mjs            # .cache/wiki の記事から src/sim/data/jawiki-pedigree.js を書く
//
// パーソロンの記事には 5 代の血統表（{{競走馬血統表}}）が載っていて、父マイリージャンの母オートフレーク、
// 母パレオの父ファリス・母カロニスなど、自分の記事を持たない祖先の父母まで分かる。
// import-real-horses.mjs が取った記事（.cache/wiki）にあるので、ネットワークは要らない。
//
// 規則（静かに間違った血統を入れないため。CLAUDE.md の落とし穴 43・45 と同じ型）:
//   - 記事の馬は「記事名（括弧は除く）と、インフォボックスの生年が表と一致」する馬だけ。再登録された同名の別馬を避ける。
//   - 表に父母が既にある祖先は、名前を照合せずその馬と結ぶ（血統表の構造を信じる）。生年が分かっていて 3 年以上
//     ずれるときは食い違いなので、その枝は採らない。
//   - 表に父母が無い祖先は名前（日本語のリンク先・英語名）で表を引く。親子の年齢差が 2〜30 歳で、一頭に決まるときだけ。
//     見つからなければ新しい祖先（5 代血統表に出る範囲だけ）。英語名はカタカナ化の対応表（katakana-names.js）で直す。
//   - 表に既にある父母は上書きしない。
// 出力は表の末尾に重ねるだけ（real-horses.js の withParents）。

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JW_BASE } from '../src/sim/data/real-horses.js';
import { KATAKANA } from '../src/sim/data/katakana-names.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/sim/data/jawiki-pedigree.js');
const WIKI = join(ROOT, '.cache/wiki');
const MAXD = 5;

const latin = (n) => /^[A-Za-z]/.test(n);
// 名前の照合用。英字は記号と大小を均す。カタカナはそのまま（均すと空文字になり、別の馬が同じ名前になる）。
const normEn = (s) => s.toLowerCase().replace(/\bst\.?\s/g, 'st ').replace(/[^a-z0-9]/g, '');
const alpha = JSON.parse(readFileSync(join(ROOT, 'tools/data/alpha-names.json'), 'utf8'));
const rev = new Map();
for (const [en, k] of KATAKANA) rev.set(k, [...(rev.get(k) ?? []), en]);
const key = (n, b) => `${n}|${b}`;
const nk = (s) => (/^[A-Za-z]/.test(s) ? normEn(s) : s);
const enNamesOf = (h) => [...new Set([...(latin(h.n) ? [h.n] : []), ...(rev.get(h.n) ?? []), ...(alpha[h.n] ? [alpha[h.n]] : [])])];
const byName = new Map();
for (const h of JW_BASE) byName.set(h.n, [...(byName.get(h.n) ?? []), h]);
const enIdx = new Map();
for (const h of JW_BASE) for (const e of enNamesOf(h)) enIdx.set(normEn(e), [...(enIdx.get(normEn(e)) ?? []), h]);
const stubLike = (h) => h.bg && h.lvl == null;

// 競走馬からの世代（新しい祖先を作る範囲）
const depth = new Map();
{
  const byN = new Map(JW_BASE.map((h) => [h.n, h]));
  let fr = JW_BASE.filter((h) => h.lvl != null);
  for (const h of fr) depth.set(h.n, 0);
  for (let d = 0; d < MAXD; d++) {
    const nx = [];
    for (const h of fr) for (const k of ['sire', 'dam']) { const p = byN.get(h[k]); if (p && !depth.has(p.n)) { depth.set(p.n, d + 1); nx.push(p); } }
    fr = nx;
  }
}

// ---------------------------------------------------------------- 記事の読み取り
const unParen = (t) => t.replace(/_/g, ' ').replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim();
function parseNode(v) {
  v = v.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/<ref[^>]*\/>/g, '').replace(/'{2,3}/g, '').trim();
  const [head, tail] = v.split(/<br\s*\/?>/i);
  if (!head) return null;
  const link = /\[\[([^\]|#]+)(?:\|([^\]]*))?\]\]/.exec(head);
  let ja = null, en = null;
  if (link) {
    const t = unParen(link[1]);
    if (/^[ァ-ヶー・ヴ]+$/.test(t)) ja = t; else if (/^[A-Za-z]/.test(t)) en = t;
    if (link[2] && /^[A-Za-z][A-Za-z' .\-]*$/.test(link[2].trim())) en = en ?? link[2].trim();
  } else {
    const t = head.replace(/\[\[|\]\]/g, '').trim();
    if (/^[A-Za-z][A-Za-z' .\-]+$/.test(t) && t.length <= 40) en = t;
    else if (/^[ァ-ヶー・ヴ]{2,}$/.test(t)) ja = t;
  }
  if (!ja && !en) return null;
  const y = tail && /(1[6-9]\d\d|20\d\d)/.exec(tail);
  return { ja, en, year: y ? Number(y[1]) : null };
}
function readPedigree(text) {
  const m = /\{\{競走馬血統表([\s\S]*?)\n\}\}/.exec(text);
  if (!m) return null;
  const nodes = new Map();
  for (const line of m[1].split('\n')) {
    const mm = /^\|\s*([fm]{1,5})\s*=\s*(.*)$/.exec(line);
    if (!mm) continue;
    const n = parseNode(mm[2]);
    if (n) nodes.set(mm[1], n);
  }
  return nodes.size ? nodes : null;
}
const birthOf = (text) => {
  const m = /\|\s*生\s*=\s*([^\n]*)/.exec(text);
  const y = m && /(1[6-9]\d\d|20\d\d)/.exec(m[1]);
  return y ? Number(y[1]) : null;
};

// ---------------------------------------------------------------- 本体
const fills = new Map();          // key(n,b) → { sire, dam }
const added = [];
const addedByKey = new Map();     // 正規化した名前 → 新しい祖先
const stats = { articles: 0, noRoot: 0, filled: 0, created: 0, reused: 0, structural: 0, conflict: 0, ambiguous: 0, badAge: 0 };

const articles = [];
for (const f of readdirSync(WIKI)) {
  if (!f.endsWith('.txt')) continue;
  let title;
  try { title = decodeURIComponent(f.slice(0, -4)); } catch { continue; }
  const text = readFileSync(join(WIKI, f), 'utf8');
  if (!text.includes('競走馬血統表')) continue;
  const nodes = readPedigree(text);
  if (!nodes) continue;
  articles.push({ name: unParen(title), year: birthOf(text), nodes });
}
console.error(`血統表のある記事 ${articles.length} 本`);

function findRoot(a) {
  const c = (byName.get(a.name) ?? []);
  if (!c.length) return null;
  if (a.year != null) {
    const m = c.filter((h) => Math.abs(h.b - a.year) <= 1);
    return m.length === 1 ? m[0] : null;
  }
  return c.length === 1 && c[0].lvl != null ? c[0] : null;
}
const roots = articles.map((a) => ({ a, root: findRoot(a) })).filter((x) => x.root);
stats.noRoot = articles.length - roots.length;
roots.sort((x, y) => (depth.get(x.root.n) ?? 9) - (depth.get(y.root.n) ?? 9));

const fillOf = (e) => fills.get(key(e.n, e.b)) ?? {};
const parentOf = (e, role) => e[role] ?? fillOf(e)[role] ?? null;

/** 名前で表の馬を探す。子の生年 cy から見た親子の年齢差で絞り、一頭に決まるときだけ。 */
function lookup(node, cy) {
  let cands = [];
  if (node.ja) cands = byName.get(node.ja) ?? [];
  if (!cands.length && node.en) cands = enIdx.get(normEn(node.en)) ?? [];
  const ok = cands.filter((p) => {
    if (node.year != null && Math.abs(p.b - node.year) > (stubLike(p) ? 12 : 1)) return false;
    const g = cy - (node.year ?? p.b);
    return stubLike(p) ? g >= -4 && g <= 34 : g >= 2 && g <= 30;
  });
  if (ok.length === 1) return { e: ok[0] };
  if (ok.length > 1) return { ambiguous: true };
  if (cands.length) return { badAge: true };
  return {};
}

function newAncestor(node, cy, role, d) {
  const label = node.ja ?? node.en;
  const k = normEn(label) + (node.year ?? '');
  const hit = addedByKey.get(nk(label));
  if (hit && (node.year == null || Math.abs(hit.b - node.year) <= 1)) return hit;
  if (d > MAXD) return null;
  const e = { n: label, b: node.year ?? cy - 8, s: role === 'dam' ? '牝' : '牡', sire: null, dam: null, _new: true, _d: d };
  added.push(e);
  addedByKey.set(nk(label), e);
  stats.created++;
  return e;
}

function processArticle(a, root, rd) {
  const ents = new Map([['', root]]);
  const codes = [...a.nodes.keys()].sort((x, y) => x.length - y.length || (x < y ? -1 : 1));
  stats.articles++;
  for (const code of codes) {
    const parentCode = code.slice(0, -1);
    const child = ents.get(parentCode);
    if (!child) continue;                    // 枝が途切れた
    const role = code.slice(-1) === 'f' ? 'sire' : 'dam';
    const node = a.nodes.get(code);
    const existing = parentOf(child, role);
    let e = null;
    if (existing) {
      // 表に既に居る親。構造を信じる。生年が合わなければ食い違い。
      const cands = [...(byName.get(existing) ?? []), ...(addedByKey.has(nk(existing)) ? [addedByKey.get(nk(existing))] : [])];
      const p = cands.find((c) => node.year == null || Math.abs(c.b - node.year) <= 3);
      if (!p) { stats.conflict++; continue; }
      e = p; stats.structural++;
    } else {
      const cy = (a.nodes.get(parentCode)?.year) ?? child.b;
      const r = lookup(node, cy);
      if (r.e) { e = r.e; stats.reused++; }
      else if (r.ambiguous) { stats.ambiguous++; continue; }
      // 同名の馬が表に居ても年が合わないなら別の馬。記事に生年が書いてあれば、新しい祖先として作る
      // （Scarlet Ribbon 1957 が 1985 年生のスカーレットリボンに当たって、アファームドの母の母が空いていた）。
      // 名前の衝突は real-horses.js の withParents が生年を添えて分ける。
      else if (r.badAge && node.year == null) { stats.badAge++; continue; }
      else {
        e = newAncestor(node, cy, role, rd + code.length);
        if (!e) continue;
      }
      const f = fills.get(key(child.n, child.b)) ?? {};
      f[role] = e.n;
      fills.set(key(child.n, child.b), f);
    }
    ents.set(code, e);
  }
}
for (const { a, root } of roots) processArticle(a, root, depth.get(root.n) ?? 9);
// この道具が足した祖先にも記事がある（ブッシャー：セイアトルスルーの母の母の父の母）。表の馬ではないので最初の照合では
// 根にならない。名前で当てて、記事の生年が推定値（子 − 8）から 12 年以内なら同じ馬とし、生年を記事の値に直して読む。
// 読んだ記事がまた祖先を足すので、増えなくなるまで回す。
{
  const done = new Set();
  for (let round = 0; round < 4; round++) {
    let n = 0;
    for (const a of articles) {
      if (done.has(a) || findRoot(a)) continue;
      const e = addedByKey.get(nk(a.name));
      if (!e || (a.year != null && Math.abs(e.b - a.year) > 12)) continue;
      done.add(a);
      if (a.year != null && e.b !== a.year) {
        const f = fills.get(key(e.n, e.b));
        if (f) { fills.delete(key(e.n, e.b)); fills.set(key(e.n, a.year), f); }
        e.b = a.year;
      }
      processArticle(a, e, e._d ?? 9);
      n++;
    }
    console.error(`足した祖先の記事 ${round + 1} 巡目 ${n} 本`);
    if (!n) break;
  }
}
// ---- 母父の補完：記事のインフォボックスの「母父」。血統表（{{競走馬血統表}}）の無い記事でも、母の父が分かる。
// 母が表に居て父が空なら、母父をその母の父にする。母父が表に居なければ新しい祖先にする（5 代血統表に出る範囲だけ）。
{
  const damSireStats = { articles: 0, filled: 0, created: 0, reused: 0, skipped: 0 };
  const infoParse = (text) => {
    const m = /\|\s*母父\s*=\s*([^\n]*)/.exec(text);
    return m ? parseNode(m[1]) : null;
  };
  const todo = [];
  for (const f of readdirSync(WIKI)) {
    if (!f.endsWith('.txt')) continue;
    let title;
    try { title = decodeURIComponent(f.slice(0, -4)); } catch { continue; }
    if (title.startsWith(':')) continue;
    const text = readFileSync(join(WIKI, f), 'utf8');
    if (!text.includes('母父')) continue;
    const a = { name: unParen(title), year: birthOf(text) };
    const root = findRoot(a);
    if (!root) continue;
    const node = infoParse(text);
    if (node) todo.push({ root, node });
  }
  todo.sort((x, y) => (depth.get(x.root.n) ?? 9) - (depth.get(y.root.n) ?? 9));
  for (const { root, node } of todo) {
    damSireStats.articles++;
    if (process.env.DBG && root.n === process.env.DBG) console.error('DBG', root.n, root.dam, JSON.stringify(node), parentOf(root, 'dam'));
    const dn = parentOf(root, 'dam');
    if (!dn) continue;
    const dam = (byName.get(dn) ?? [])[0] ?? addedByKey.get(nk(dn));
    if (!dam) continue;
    if (parentOf(dam, 'sire')) continue;                   // 既に分かっている
    const rd = depth.get(root.n) ?? 9;
    let r = lookup(node, dam.b);
    // 母の生年が子から推した値のとき（名前だけの母）は、孫（記事の馬）から見た年で当て直す。
    if (r.badAge && stubLike(dam)) r = lookup(node, root.b - 10);
    if (process.env.DBG && root.n === process.env.DBG) console.error('DBG2', dam.n, dam.b, dam.sire, dam.dam, JSON.stringify({a: r.ambiguous, b: r.badAge, e: r.e?.n}));
    let e = r.e ?? null;
    if (e) damSireStats.reused++;
    else if (!r.ambiguous && !r.badAge) {
      e = newAncestor(node, dam.b, 'sire', rd + 2);
      if (e) damSireStats.created++;
    }
    if (!e) { damSireStats.skipped++; continue; }
    const f = fills.get(key(dam.n, dam.b)) ?? {};
    f.sire = e.n;
    fills.set(key(dam.n, dam.b), f);
    damSireStats.filled++;
  }
  console.error('母父の補完', damSireStats);
}
// 血統が循環する・親が子より若い結びは捨てる（名前の取り違えで起きる。循環すると世界の生成がスタックを溢れさせる）。
{
  const all = new Map(JW_BASE.map((h) => [h.n, h]));
  for (const e of added) all.set(e.n, e);
  const par = new Map();
  for (const h of all.values()) par.set(h.n, [h.sire ?? null, h.dam ?? null]);
  for (const e of added) par.set(e.n, [null, null]);
  const reaches = (from, target, seen = new Set()) => {
    if (from == null || seen.has(from)) return false;
    if (from === target) return true;
    seen.add(from);
    return (par.get(from) ?? []).some((p) => reaches(p, target, seen));
  };
  let dropped = 0;
  for (const [k, f] of [...fills]) {
    const [cn] = k.split('|');
    const c = all.get(cn);
    for (const [i, role] of ['sire', 'dam'].entries()) {
      const pn = f[role];
      if (!pn) continue;
      const p = all.get(pn);
      if (!p || p.b >= c.b || reaches(pn, cn)) { f[role] = null; dropped++; continue; }
      par.get(cn)[i] = pn;
    }
    if (!f.sire && !f.dam) fills.delete(k);
  }
  console.error(`循環・年齢の食い違いで捨てた結び ${dropped}`);
}
// 新しい祖先の父母は、その祖先自身に書く。
for (const e of added) {
  const f = fills.get(key(e.n, e.b));
  if (f) { e.sire = f.sire ?? null; e.dam = f.dam ?? null; fills.delete(key(e.n, e.b)); }
}
stats.filled = fills.size;
console.error(stats);
console.error(`既存の馬に補った父母 ${fills.size} 頭、新しい祖先 ${added.length} 頭`);

const q = (s) => (s == null ? 'null' : `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);
const body = `// ja.wikipedia の「競走馬血統表」から補った父母。tools/import-jawiki-pedigree.mjs が書く（手で直さない）。
// real-horses.js の withParents が表の末尾に重ねる。
//   JW_FILL  [馬名, 生年, 父, 母]   表で父母が空だった馬に補う（null は補わない）
//   JW_NEW   [馬名, 生年, 性, 父, 母]  表に無かった祖先（血統をつなぐだけ。英語名は katakana-names.js でカタカナにする）

export const JW_FILL = [
${[...fills].map(([k, f]) => { const [nm, b] = k.split('|'); return `  [${q(nm)}, ${b}, ${q(f.sire)}, ${q(f.dam)}],`; }).join('\n')}
];

export const JW_NEW = [
${added.map((e) => `  [${q(e.n)}, ${e.b}, ${q(e.s)}, ${q(e.sire)}, ${q(e.dam)}],`).join('\n')}
];
`;
writeFileSync(OUT, body);
console.error(`${OUT} に書いた`);
