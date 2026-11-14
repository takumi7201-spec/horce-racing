// 表の馬で父母が空のものを、Wikidata から埋める道具。
//
//   node tools/import-wikidata-parents.mjs            # 取得して src/sim/data/wikidata-parents.js を書く
//   node tools/import-wikidata-parents.mjs --offline  # キャッシュ（.cache/wikidata）だけで組み直す
//   node tools/import-wikidata-parents.mjs --rounds 3 # 見つけた親のさらに親を何代たどるか
//   node tools/import-wikidata-parents.mjs --en-rounds 2 # 英語版の記事で補う世代の数（祖先が増え過ぎないよう絞る）
//
// ja.wikipedia の記事から取る import-real-horses.mjs は、親の記事が無い・インフォボックスに
// 書いてない馬の父母を null にする（海外馬の母なしが 1,155 頭）。Wikidata は記事が無くても
// 父（P22）・母（P25）を持っていることが多いので、ここで補う。
//
// 取り込みの規則（どれも静かに間違った血統を入れないため。CLAUDE.md の落とし穴 43・45 と同じ型）:
//   - 馬の同定は「日本語の名前と生年が表と一致」する Wikidata の馬（P31 = 馬）だけ。
//     日本の馬名は年代をまたいで再登録されるので、名前だけでは別の馬に結ばれる。
//   - 表に父がある馬は、Wikidata の父が表の父と同じ QID のときだけ採る（食い違えば同名の別馬）。
//   - 親の名は日本語ラベル、無ければ英語ラベル。表に同じ QID の馬がいればその名を使う（二頭に割れない）。
//   - 親子の年齢差が 2〜30 歳に収まらない親は結ばない。親の生年が無ければ子の 8 年前で推す。
//   - 名前だけの祖先（生年が子からの推定）は、日本語ラベルと生年では結べない。英語のラベル（対応表のカタカナ名の元の英語名、
//     史実馬の一覧の英字名）で探し、生年が推定値から 12 年以内で、子すべての親として成り立つ一頭に決まるときだけ結ぶ。
//     結べた馬の生年は Wikidata の値で親子の年齢差を見る（セクレタリアトの母の母など、有名馬の血統表の穴を埋める）。
//   - 見つけた親の親も --rounds の分だけたどる（QID で引くので同定の曖昧さは無い）。
//   - Wikidata に父母が無い馬は、同じ項目の英語版の記事のインフォボックス（sire・dam）で補う。
//     海外馬は Wikidata に母が無いことが多いが、英語版の記事にはほぼ書いてある。
// 出力は表の末尾に重ねるだけ（real-horses.js の withWikidata）。順番を変えると世界の乱数がずれる。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { WD_BASE } from '../src/sim/data/real-horses.js';
import { KATAKANA } from '../src/sim/data/katakana-names.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/sim/data/wikidata-parents.js');
const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'keiba-sim-import/0.1 (https://github.com/takumi7201-spec/horce-racing; real-horses parents)';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const OFFLINE = flag('--offline');
const ROUNDS = Number(opt('--rounds', 3));
const EN_ROUNDS = Number(opt('--en-rounds', 2));
const CACHE = resolve(ROOT, opt('--cache', '.cache/wikidata'));
const BATCH = 50;
const DELAY = 1200;
mkdirSync(CACHE, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** SPARQL を 1 本投げる。結果はクエリの中身をキーにキャッシュする。429・5xx は待って引き直す。 */
async function sparql(query) {
  const key = createHash('sha1').update(query).digest('hex');
  const path = join(CACHE, `${key}.json`);
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  if (OFFLINE) return [];
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`${ENDPOINT}?format=json&query=${encodeURIComponent(query)}`, { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' } });
    if (res.ok) {
      const rows = (await res.json()).results.bindings;
      writeFileSync(path, JSON.stringify(rows));
      await sleep(DELAY);
      return rows;
    }
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 5000 * (attempt + 1);
      console.error(`  ${res.status}。${wait / 1000} 秒待つ`);
      await sleep(wait);
      continue;
    }
    throw new Error(`Wikidata ${res.status}`);
  }
  throw new Error('Wikidata が答えない');
}

const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const val = (x) => x?.value ?? null;
const qid = (x) => val(x)?.replace(/^.*\//, '') ?? null;
const year = (x) => { const m = /^(-?\d{4})/.exec(val(x) ?? ''); return m ? Number(m[1]) : null; };
/** 照合用に小書きのカナ・長音・中黒・空白を均す。 */
const norm = (s) => s.normalize('NFKC').replace(/[ァィゥェォャュョッ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 1))
  .replace(/[ー・\s'.\-]/g, '').toLowerCase();

// ---------------------------------------------------------------- 1. 表の馬を Wikidata の馬に結ぶ

const stubLike = (h) => h.bg && h.s === '牝' && !h.sire && !h.dam && h.lvl == null && !h.mare;
const table = WD_BASE.filter((h) => !stubLike(h));   // 名前だけの母は生年が推定なので同定できない
const nameOf = new Map();     // 表の名 → 項目（同名は複数）
for (const h of WD_BASE) nameOf.set(h.n, [...(nameOf.get(h.n) ?? []), h]);
const key = (n, b) => `${n}|${b}`;

console.error(`表 ${WD_BASE.length} 頭のうち ${table.length} 頭を Wikidata に問い合わせる`);
const matchedQ = new Map();   // key(n,b) → QID
const ambiguous = new Set();
{
  const byName = new Map();
  for (const h of table) byName.set(h.n, [...(byName.get(h.n) ?? []), h]);
  const names = [...byName.keys()];
  let done = 0;
  for (const part of chunks(names, BATCH)) {
    const vals = part.map((n) => `"${n.replace(/"/g, '')}"@ja`).join(' ');
    const rows = await sparql(`SELECT ?name ?h ?b WHERE { VALUES ?name { ${vals} } ?h rdfs:label ?name . ?h wdt:P31 wd:Q726 . OPTIONAL { ?h wdt:P569 ?b } }`);
    for (const r of rows) {
      const n = val(r.name), y = year(r.b);
      for (const h of byName.get(n) ?? []) {
        if (y !== h.b) continue;
        const k = key(n, h.b), q = qid(r.h);
        if (matchedQ.has(k) && matchedQ.get(k) !== q) ambiguous.add(k);
        matchedQ.set(k, q);
      }
    }
    done += part.length;
    if (!OFFLINE && done % 500 < BATCH) console.error(`  ${done}/${names.length}`);
  }
  for (const k of ambiguous) matchedQ.delete(k);   // 同名・同年の馬が二頭いるときは採らない
}
console.error(`生年まで一致した馬 ${matchedQ.size} 頭（同定が曖昧で外した ${ambiguous.size} 頭）`);

// 1b. 名前だけの祖先など、日本語ラベルと生年で結べなかった馬を、英語のラベルで結ぶ。
const trueB = new Map();      // key(n,b) → Wikidata の生年（推定した生年を直す）
const effB = (e) => trueB.get(key(e.n, e.b)) ?? e.b;
{
  const alpha = JSON.parse(readFileSync(join(ROOT, 'tools/data/alpha-names.json'), 'utf8'));
  const rev = new Map();
  for (const [en, k] of KATAKANA) rev.set(k, [...(rev.get(k) ?? []), en]);
  const kids = new Map();     // 親の名 → 子の生年
  for (const h of WD_BASE) for (const p of [h.sire, h.dam]) if (p) kids.set(p, [...(kids.get(p) ?? []), h.b]);
  const latin = (n) => /^[A-Za-z]/.test(n);
  const targets = WD_BASE.filter((h) => (h.sire == null || h.dam == null) && !matchedQ.has(key(h.n, h.b)));
  const byEn = new Map();     // 英語名 → 対象
  for (const h of targets) {
    const ens = new Set([...(latin(h.n) ? [h.n] : []), ...(rev.get(h.n) ?? []), ...(alpha[h.n] ? [alpha[h.n]] : [])]);
    for (const e of ens) byEn.set(e, [...(byEn.get(e) ?? []), h]);
  }
  const cands = new Map();    // key → [{ q, y }]
  const names = [...byEn.keys()];
  console.error(`英語名で探す ${targets.length} 頭（英語名 ${names.length}）`);
  let done = 0;
  for (const part of chunks(names, BATCH)) {
    const vals = part.map((n) => `"${n.replace(/"/g, '')}"@en`).join(' ');
    const rows = await sparql(`SELECT ?name ?h ?b WHERE { VALUES ?name { ${vals} } ?h rdfs:label ?name . ?h wdt:P31 wd:Q726 . OPTIONAL { ?h wdt:P569 ?b } }`);
    for (const r of rows) {
      const y = year(r.b);
      if (y == null) continue;
      for (const h of byEn.get(val(r.name)) ?? []) {
        const k = key(h.n, h.b);
        cands.set(k, [...(cands.get(k) ?? []), { q: qid(r.h), y }]);
      }
    }
    done += part.length;
    if (!OFFLINE && done % 1000 < BATCH) console.error(`  ${done}/${names.length}`);
  }
  let acc = 0, amb = 0;
  for (const h of targets) {
    const k = key(h.n, h.b);
    const approx = h.bg && h.lvl == null;                     // 名前だけの祖先は生年が推定値
    const cs = kids.get(h.n) ?? [];
    const ok = (cands.get(k) ?? []).filter((c) => (approx ? Math.abs(c.y - h.b) <= 12 : c.y === h.b)
      && (cs.length ? cs.every((b) => b - c.y >= 2 && b - c.y <= 30) : true));
    const uniq = [...new Map(ok.map((c) => [c.q, c])).values()];
    if (!uniq.length) continue;
    uniq.sort((a, b) => Math.abs(a.y - h.b) - Math.abs(b.y - h.b));
    if (uniq.length > 1 && Math.abs(uniq[0].y - h.b) === Math.abs(uniq[1].y - h.b)) { amb++; continue; }
    matchedQ.set(k, uniq[0].q);
    trueB.set(k, uniq[0].y);
    acc++;
  }
  console.error(`英語名で結べた馬 ${acc} 頭（決まらなかった ${amb} 頭）`);
}

// ---------------------------------------------------------------- 2. 父母を引く

const parentsOf = new Map();   // QID → { sire: {q, ja, en, b}, dam: {...} }
async function fetchParents(qs) {
  const todo = [...new Set(qs.filter(isQ))].filter((q) => !parentsOf.has(q));
  for (const part of chunks(todo, 80)) {
    const vals = part.map((q) => `wd:${q}`).join(' ');
    const rows = await sparql(`SELECT ?h ?f ?fja ?fen ?fb ?m ?mja ?men ?mb WHERE { VALUES ?h { ${vals} }
      OPTIONAL { ?h wdt:P22 ?f . OPTIONAL { ?f rdfs:label ?fja FILTER(lang(?fja)="ja") } OPTIONAL { ?f rdfs:label ?fen FILTER(lang(?fen)="en") } OPTIONAL { ?f wdt:P569 ?fb } }
      OPTIONAL { ?h wdt:P25 ?m . OPTIONAL { ?m rdfs:label ?mja FILTER(lang(?mja)="ja") } OPTIONAL { ?m rdfs:label ?men FILTER(lang(?men)="en") } OPTIONAL { ?m wdt:P569 ?mb } } }`);
    for (const q of part) parentsOf.set(q, { sire: null, dam: null });
    for (const r of rows) {
      const p = parentsOf.get(qid(r.h));
      // 親が複数書かれている項目（P22 が二つ）は決められないので最初の一つにせず、触れない
      const set = (k, qq, ja, en, b) => {
        if (!qq) return;
        if (p[k] && p[k].q !== qq) { p[k] = { q: null }; return; }
        p[k] = { q: qq, ja: val(ja), en: val(en), b: year(b) };
      };
      set('sire', qid(r.f), r.fja, r.fen, r.fb);
      set('dam', qid(r.m), r.mja, r.men, r.mb);
    }
  }
}


// ---------------------------------------------------------------- 2b. 英語版の記事で補う

const isQ = (q) => /^Q\d+$/.test(q ?? '');

/** QID → 英語版の記事名。 */
async function enTitles(qs) {
  const out = new Map();
  for (const part of chunks([...new Set(qs.filter(isQ))], 80)) {
    const rows = await sparql(`SELECT ?h ?t WHERE { VALUES ?h { ${part.map((q) => `wd:${q}`).join(' ')} } ?a schema:about ?h ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?t }`);
    for (const r of rows) out.set(qid(r.h), val(r.t));
  }
  return out;
}

/** 英語版の記事名 → QID。 */
async function titleToQ(titles) {
  const out = new Map();
  for (const part of chunks([...new Set(titles)], 60)) {
    const rows = await sparql(`SELECT ?t ?h WHERE { VALUES ?t { ${part.map((t) => `"${t.replace(/"/g, '')}"@en`).join(' ')} } ?a schema:name ?t ; schema:isPartOf <https://en.wikipedia.org/> ; schema:about ?h }`);
    for (const r of rows) out.set(val(r.t), qid(r.h));
  }
  return out;
}

/** QID → { ja, en, b }。親の名前と生年を引く。 */
const infoOf = new Map();
async function fetchInfo(qs) {
  const todo = [...new Set(qs.filter(isQ))].filter((q) => !infoOf.has(q));
  for (const part of chunks(todo, 80)) {
    const rows = await sparql(`SELECT ?h ?ja ?en ?b WHERE { VALUES ?h { ${part.map((q) => `wd:${q}`).join(' ')} }
      OPTIONAL { ?h rdfs:label ?ja FILTER(lang(?ja)="ja") } OPTIONAL { ?h rdfs:label ?en FILTER(lang(?en)="en") } OPTIONAL { ?h wdt:P569 ?b } }`);
    for (const q of part) infoOf.set(q, { ja: null, en: null, b: null });
    for (const r of rows) Object.assign(infoOf.get(qid(r.h)), { ja: val(r.ja), en: val(r.en), b: year(r.b) });
  }
}

/** 英語版の記事の本文（キャッシュ）。無い・取れないときは ''。 */
async function enRaw(title) {
  const path = join(CACHE, `en-${createHash('sha1').update(title).digest('hex')}.txt`);
  if (existsSync(path)) return readFileSync(path, 'utf8');
  if (OFFLINE) return '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://en.wikipedia.org/w/index.php?action=raw&title=${encodeURIComponent(title)}`, { headers: { 'User-Agent': UA } });
    if (res.ok || res.status === 404) {
      const text = res.ok ? await res.text() : '';
      writeFileSync(path, text);
      await sleep(400);
      return text;
    }
    await sleep(3000 * (attempt + 1));
  }
  return '';
}

/** インフォボックスの欄の値から馬を取る。{ title: リンク先の記事名, text: 表示名 }。 */
function enParent(text, field) {
  const m = new RegExp(`\\|\\s*${field}\\s*=\\s*([^\\n]*)`, 'i').exec(text);
  if (!m) return null;
  const v = m[1].replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/<ref[^>]*\/>/g, '').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>.*$/i, '').trim();
  const link = /\[\[([^\]|#]+)(?:\|([^\]]*))?\]\]/.exec(v);
  const title = link ? link[1].trim() : null;
  let name = (link ? (link[2] || link[1]) : v).replace(/\[\[|\]\]|'{2,3}/g, '').trim();
  // 「Lady Vettori (GB)」の国名、「Omaha (horse)」の曖昧さ回避は馬名ではない。
  name = name.replace(/\s*\((?:[A-Z]{2,3}|horse|racehorse|[A-Za-z]+ horse)\)\s*$/i, '').trim();
  if (!name || /^(unknown|\?|n\/a)$/i.test(name) || name.length > 40) return null;
  return { title, text: name };
}

// ---------------------------------------------------------------- 3. 表へ重ねる

const qToName = new Map();      // QID → 表の名（既にある馬）
for (const [k, q] of matchedQ) qToName.set(q, k.split('|')[0]);
const taken = new Map();        // 正規化した名 → [{ n, b, q }]
for (const h of WD_BASE) taken.set(norm(h.n), [...(taken.get(norm(h.n)) ?? []), { n: h.n, b: h.b, q: matchedQ.get(key(h.n, h.b)) ?? null }]);

const fills = new Map();        // key(n,b) → { sire?, dam? }
const added = [];               // 新しい祖先
const addedKey = new Set();
let reused = 0, created = 0, skippedYear = 0, skippedName = 0, skippedSire = 0;

/** 親の QID から表の名を決める。無ければ新しい祖先として作る。結べないときは null。 */
function resolve1(p, child, role) {
  if (!p?.q) return null;
  const gap = (b) => child.b - b;
  if (qToName.has(p.q)) {
    const n = qToName.get(p.q);
    const e = (nameOf.get(n) ?? []).find((x) => matchedQ.get(key(x.n, x.b)) === p.q) ?? added.find((x) => x.n === n);
    if (e && gap(effB(e)) >= 2 && gap(effB(e)) <= 30) { reused++; return n; }
    skippedYear++;
    return null;
  }
  const label = p.ja ?? p.en;
  if (!label || !/^[ァ-ヶー・ヴ]{2,}$|^[A-Za-z][A-Za-z' .\-]+$/.test(label)) { skippedName++; return null; }
  const b = p.b ?? child.b - 8;
  if (gap(b) < 2 || gap(b) > 30) { skippedYear++; return null; }
  // 同じ名の別の馬が表に居るときは、生年が合うほうだけを同じ馬とみなす。
  const same = taken.get(norm(label)) ?? [];
  const hit = same.find((x) => Math.abs(x.b - b) <= 1 && (!x.q || x.q === p.q));
  if (hit) { qToName.set(p.q, hit.n); reused++; return hit.n; }
  if (same.length) { skippedName++; return null; }   // 同名の別馬。結ぶと別の血統につながる
  const n = label;
  qToName.set(p.q, n);
  taken.set(norm(n), [{ n, b, q: p.q }]);
  const e = { n, b, s: role === 'dam' ? '牝' : '牡', sire: null, dam: null, q: p.q, approx: p.b == null };
  added.push(e);
  created++;
  return n;
}

// 同じ馬を親に持つ別の馬が、先に作られた同じ名前を使えるように、世代ごとに回す。
let frontier = [...matchedQ].map(([k, q]) => {
  const [n, b] = k.split('|');
  return { ref: WD_BASE.find((h) => h.n === n && h.b === Number(b)), q };
}).filter((x) => x.ref && (x.ref.sire == null || x.ref.dam == null));
let round = 0;
while (frontier.length && round <= ROUNDS) {
  await fetchParents(frontier.map((x) => x.q));
  const next = [];
  for (const { ref, q } of frontier) {
    const par = parentsOf.get(q) ?? { sire: null, dam: null };
    // 表に父があるなら、Wikidata の父が同じ馬のときだけ採る。食い違えば同名の別馬を引いている。
    if (ref.sire != null) {
      const sq = par.sire?.q;
      const known = (nameOf.get(ref.sire) ?? []).map((x) => matchedQ.get(key(x.n, x.b))).filter(Boolean);
      if (sq && known.length && !known.includes(sq)) { skippedSire++; continue; }
    }
    const f = fills.get(key(ref.n, ref.b)) ?? {};
    const child = trueB.has(key(ref.n, ref.b)) ? { ...ref, b: trueB.get(key(ref.n, ref.b)) } : ref;   // 推定した生年は Wikidata の値で見る
    for (const role of ['sire', 'dam']) {
      if (ref[role] != null || f[role]) continue;
      const n = resolve1(par[role], child, role);
      if (n) f[role] = n;
    }
    // Wikidata に父母が無い馬は、英語版の記事のインフォボックスで補う。
    if (round < EN_ROUNDS && isQ(q) && ['sire', 'dam'].some((r) => ref[r] == null && !f[r])) {
      const title = (await enTitles([q])).get(q);
      if (title) {
        const text = await enRaw(title);
        for (const role of ['sire', 'dam']) {
          if (ref[role] != null || f[role]) continue;
          const ep = enParent(text, role);
          if (!ep) continue;
          const pq = ep.title ? (await titleToQ([ep.title])).get(ep.title) : null;
          if (pq) await fetchInfo([pq]);
          const inf = pq ? infoOf.get(pq) : null;
          const n = resolve1({ q: pq ?? `en:${ep.title ?? ep.text}`, ja: inf?.ja ?? null, en: inf?.en ?? ep.text, b: inf?.b ?? null }, child, role);
          if (n) f[role] = n;
        }
      }
    }
    if (f.sire || f.dam) fills.set(key(ref.n, ref.b), f);
  }
  // 新しく作った祖先の親を次の世代で埋める。
  const fresh = added.filter((e) => !addedKey.has(e.n));
  for (const e of fresh) { addedKey.add(e.n); next.push({ ref: e, q: e.q }); }
  frontier = next;
  round++;
  console.error(`  ${round} 世代目: 埋めた ${fills.size} 頭、新しい祖先 ${added.length} 頭`);
}
// 新しい祖先の fill は ref 自身に書く。
for (const e of added) {
  const f = fills.get(key(e.n, e.b));
  if (f) { e.sire = f.sire ?? null; e.dam = f.dam ?? null; fills.delete(key(e.n, e.b)); }
}

const dFill = [...fills].filter(([k]) => !addedKey.has(k.split('|')[0]));
console.error(`\n既存の馬に補った父母 ${dFill.length} 頭、新しい祖先 ${added.length} 頭（表の既存馬を再利用 ${reused}、新規 ${created}）`);
console.error(`結ばなかった: 年齢差 ${skippedYear}、名前（同名の別馬・読めない名）${skippedName}、父が食い違う ${skippedSire}`);

const q = (s) => (s == null ? 'null' : `'${s.replace(/'/g, "\\'")}'`);
const body = `// Wikidata から補った父母。tools/import-wikidata-parents.mjs が書く（手で直さない）。
// real-horses.js の withWikidata が表の末尾に重ねる。
//   WD_FILL  [馬名, 生年, 父, 母]   表で父母が空だった馬に補う（null は補わない）
//   WD_NEW   [馬名, 生年, 性, 父, 母]  表に無かった祖先（血統をつなぐだけ。英語名は日本語ラベルが無かったもの）

export const WD_FILL = [
${dFill.map(([k, f]) => { const [n, b] = k.split('|'); return `  [${q(n)}, ${b}, ${q(f.sire)}, ${q(f.dam)}],`; }).join('\n')}
];

export const WD_NEW = [
${added.map((e) => `  [${q(e.n)}, ${e.b}, ${q(e.s)}, ${q(e.sire)}, ${q(e.dam)}],`).join('\n')}
];
`;
writeFileSync(OUT, body);
console.error(`${OUT} に書いた`);
