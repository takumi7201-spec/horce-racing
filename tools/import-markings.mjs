// 実在馬の白斑（顔の星・流星と、脚の白）を、英語版・日本語版 Wikipedia の本文から取る道具。
//
//   node tools/import-markings.mjs            # 取得して src/sim/data/markings.js を書く
//   node tools/import-markings.mjs --offline  # キャッシュ（.cache/enwiki・.cache/wiki）だけで組み直す
//   node tools/import-markings.mjs --report   # 取った文と読んだ結果を一覧に出す（差し込む前に目で見る）
//   node tools/import-markings.mjs --limit 200  # 取得する記事の数の上限（試し用）
//
// 白斑はインフォボックスに欄が無い。英語版の競走馬の記事は「背景」の最初の文が定型で
// （"X is a bay horse with a white star and a white sock on his left hind leg bred in Ireland by …"）、
// 日本語版は本文に「流星と 3 本の所謂靴下が特徴の鹿毛」のように書かれることがある。その文だけを読む。
//
// 規則（静かに間違った白斑を入れないため。CLAUDE.md の落とし穴 43・45 と同じ型）:
//   - 記事の馬は「Wikidata の日本語ラベルか英語名」と「生年（1 年以内）」が表と一致するものだけ。
//     記事の foaled が表の生年と 1 年以内でなければ捨てる（再登録された同名の別馬）。
//   - 読むのは主語がその馬の文だけ（馬名・He・She・The colt… で始まる）。母や父の白斑の文を拾わない。
//     白斑の語より前に dam・sire・mother… が出る文も捨てる。
//   - 脚がどれか書いていない（"two white socks"）ときは後脚から（白い脚は後脚に多い）。
//     本数だけ分かって位置が分からない残りは、馬名から決まる値で選ぶ（乱数を使わない）。
//   - 手書きで足さない（記憶で書くと間違った白斑が入る。落とし穴 73 と同じ）。
// 出力は src/sim/data/markings.js。game.js が実在馬の見た目に使い、無い馬は今までどおり馬 id から決める。

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { REAL_HORSES } from '../src/sim/data/real-horses.js';
import { KATAKANA } from '../src/sim/data/katakana-names.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/sim/data/markings.js');
const UA = 'keiba-sim-import/0.1 (https://github.com/takumi7201-spec/horce-racing; horse markings)';
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const OFFLINE = flag('--offline');
const REPORT = flag('--report');
const LIMIT = Number(opt('--limit', Infinity));
const EN_CACHE = resolve(ROOT, '.cache/enwiki');
const WD_CACHE = resolve(ROOT, '.cache/wikidata-ja');
const JA_CACHE = resolve(ROOT, '.cache/wiki');
mkdirSync(EN_CACHE, { recursive: true });
mkdirSync(WD_CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 取得（import-enwiki-pedigree.mjs と同じキャッシュ）
let fetched = 0;
async function raw(title) {
  const path = join(EN_CACHE, `${createHash('sha1').update(title).digest('hex')}.txt`);
  if (existsSync(path)) return readFileSync(path, 'utf8');
  if (OFFLINE || fetched >= LIMIT) return '';
  for (let attempt = 0; attempt < 6; attempt++) {
    let res;
    try {
      res = await fetch(`https://en.wikipedia.org/w/index.php?action=raw&title=${encodeURIComponent(title)}`, { headers: { 'User-Agent': UA } });
    } catch { await sleep(3000 * (attempt + 1)); continue; }
    if (res.ok || res.status === 404) {
      const text = res.ok ? await res.text() : '';
      writeFileSync(path, text);
      fetched++;
      await sleep(250);
      return text;
    }
    await sleep(3000 * (attempt + 1));
  }
  return '';
}
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
async function sparql(query) {
  const path = join(WD_CACHE, `${createHash('sha1').update(query).digest('hex')}.json`);
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  if (OFFLINE) return [];
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' } });
      if (res.ok) { const rows = (await res.json()).results.bindings; writeFileSync(path, JSON.stringify(rows)); return rows; }
    } catch { /* 待って引き直す */ }
    await sleep(5000 * (attempt + 1));
  }
  return [];
}

// ---------------------------------------------------------------- 表の索引
const norm = (s) => (s ?? '').normalize('NFKC').replace(/[ァィゥェォャュョッ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 1))
  .replace(/[ー・\s'.\-]/g, '').toLowerCase();
const normEn = (s) => s.toLowerCase().replace(/\bst\.?\s/g, 'st ').replace(/[^a-z0-9]/g, '');
const latin = (n) => /^[A-Za-z]/.test(n);
const alpha = JSON.parse(readFileSync(join(ROOT, 'tools/data/alpha-names.json'), 'utf8'));
const rev = new Map();
for (const [en, k] of KATAKANA) rev.set(k, [...(rev.get(k) ?? []), en]);
const enNamesOf = (h) => [...new Set([...(latin(h.n) ? [h.n] : []), ...(rev.get(h.n) ?? []), ...(alpha[h.n] ? [alpha[h.n]] : [])])];
const stripParen = (t) => t.replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim();

// 白斑が見た目に出るのは世界に居る馬だけ。名前だけの祖先（能力も繁殖年も持たない）は除く。
const TARGETS = REAL_HORSES.filter((h) => h.b != null && (h.lvl != null || h.stud || h.mare || h.amare || h.abroad));
const byJa = new Map();
const byEn = new Map();
for (const h of TARGETS) {
  byJa.set(norm(h.n), [...(byJa.get(norm(h.n)) ?? []), h]);
  for (const e of enNamesOf(h)) byEn.set(normEn(e), [...(byEn.get(normEn(e)) ?? []), h]);
}
const near = (h, y, tol = 1) => y == null || Math.abs(h.b - y) <= tol;

// ---------------------------------------------------------------- 白斑の読み方
// 顔：none・star・starStripe・stripe・blaze・bald・snip・starSnip。星の大きさ s / m / l。
// 脚：左前・右前・左後・右後の順に 0（無し）〜5。1 蹄冠（微白）・2 繋の半ば（小白）・3 球節まで（白）・
//     4 管の半ば（半白）・5 膝・飛節まで（長白）。
const LEG = { LF: 0, RF: 1, LH: 2, RH: 3 };
const pick = (name, salt, n) => {
  const h = createHash('sha1').update(`${name}|${salt}`).digest();
  return h[0] % n;
};

/** wiki 記法を素の文にする（参照・注釈・テンプレートを落とし、リンクはラベルにする）。 */
function plain(text) {
  let t = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '');
  for (let i = 0; i < 6; i++) {
    const before = t;
    t = t.replace(/\{\{(?:lang|仮リンク|Lang|nowrap|Nowrap)\|[^{}|]*\|([^{}|]*)(?:\|[^{}]*)?\}\}/g, '$1');
    t = t.replace(/\{\{[^{}]*\}\}/g, '');
    if (t === before) break;
  }
  t = t.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/'{2,3}/g, '').replace(/<[^>]+>/g, '');
  return t;
}

const EN_MARK = /\b(stars?|stripe|blaze|snip|bald|white (?:face|socks?|stockings?|foot|feet|heels?|coronets?|pasterns?|legs?|markings?|hind|fore|near|off)|socks|stockings|no (?:white )?markings)\b/i;
const EN_KIN = /\b(dam|sire|mother|father|brother|sister|son|daughter|offspring|progeny|foals?|rival|stable ?mate|grand(?:dam|sire)|jockey|trainer)\b/i;
const EN_SUBJ = (names) => new RegExp(`^\\s*(?:${[...names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'he', 'she', 'it', 'the (?:colt|filly|horse|mare|gelding|stallion)'].join('|')})\\b`, 'i');
const NUM = { a: 1, an: 1, one: 1, single: 1, two: 2, both: 2, three: 3, four: 4, all: 4 };

/** 英語の記述 → { face, size, legs } */
export function parseEn(s, name) {
  const t = s.toLowerCase().replace(/-/g, ' ');
  if (/\bno (?:white )?markings\b|without (?:any )?(?:white )?markings|\bno white\b/.test(t)) return { face: 'none', size: 'm', legs: [0, 0, 0, 0] };
  // 顔。星は描写の形（white star・small star・star and snip…）だけ。"the first TV star" を拾わない。
  // 星の形の言い換え（heart・diamond・crescent on his forehead）も星にする。
  let face = 'none', size = 'm';
  const star = /\b(?:white|small|large|big|faint|tiny|little|irregular|diamond shaped|thin|prominent|broad|bold|distinctive|slight) star\b|\bwith a star\b|\bstar (?:and|on|in|marking)\b|\bwhite (?:heart|diamond|crescent|mark)\b[^.]{0,20}forehead/.test(t);
  const stripe = /\bstripe\b|\bstrip\b/.test(t), snip = /\bsnip\b/.test(t);
  const blazeM = /\b(\w+)?\s*(?:white )?blaze\b/.exec(t);
  if (/\b(bald|white) face\b/.test(t)) face = 'bald';
  else if (blazeM) face = /narrow|thin|small|faint|slim/.test(blazeM[1] ?? '') ? (star ? 'starStripe' : 'stripe') : 'blaze';
  else if (stripe) face = star ? 'starStripe' : 'stripe';
  else if (star) face = snip ? 'starSnip' : 'star';
  else if (snip) face = 'snip';
  // 大きさは星の前の 3 語まで（"a small white irregular star"）。
  const starM = /((?:[\w,]+\s+){1,4})star\b/.exec(t);
  if (starM && /small|faint|tiny|little|slight/.test(starM[1])) size = 's';
  if (starM && /large|big|prominent|broad|bold|wide/.test(starM[1])) size = 'l';
  // 脚。"white" の後ろの脚の語ごとに、本数・位置・長さを読む。
  // white を省いた書き方（"three socks" "two rear half stockings" "one coronet band"）は white を補ってから読む。
  const legs = [0, 0, 0, 0];
  const u = t.replace(/\brear\b/g, 'hind').replace(
    /\b(a|an|one|two|three|four|all four)\s+((?:(?:short|long|half|left|right|near|off|fore|front|hind|back)\s+)*)(socks?|stockings?|coronets?)\b/g,
    (m0, c, adj, k) => `${c} white ${adj}${k}`);
  const re = /\b(?:(a|an|one|single|two|both|three|four|all four|all)\s+)?(?:(left|right|near|off)\s+)?(?:(fore|front|hind|back)\s+)?(?:(?:small|large|long|short|tall|high|low|partial)\s+)?white\s+(?:(left|right|near|off)\s+)?(?:(fore|front|hind|back)\s*)?(?:(half|short|long|partial)\s+)?(socks?|stockings?|foot|feet|heels?|coronets?|pasterns?|legs?|fetlocks?|hooves|hind legs?|forelegs?)?/g;
  let m;
  while ((m = re.exec(u))) {
    let [all, cnt, side1, pos1, side2, pos2, adj, kind] = m;
    if (!kind && !pos2) continue;
    if (!kind) kind = 'sock';
    // 位置は後ろの "on his left hind leg" "on her hind legs" "behind" からも読む
    const after = u.slice(m.index + all.length, m.index + all.length + 55);
    const am = /^\s*(?:(?:bands?|marks?|markings?)\s+)?(?:on|to)\s+(?:his|her|its|the|both)?\s*(?:(left|right|near|off)\s+)?(fore|front|hind|back)?\s*(legs?|feet|foot|hooves|forelegs?|hindlegs?)?/.exec(after);
    let side = side1 || side2 || am?.[1] || null;
    let pos = pos1 || pos2 || am?.[2] || (/foreleg/.test(am?.[3] ?? '') ? 'fore' : /hindleg/.test(am?.[3] ?? '') ? 'hind' : null)
      || (/^hind/.test(kind) ? 'hind' : /^foreleg/.test(kind) ? 'fore' : null);
    if (side === 'near') side = 'left';
    if (side === 'off') side = 'right';
    if (pos === 'front') pos = 'fore';
    if (pos === 'back') pos = 'hind';
    const plural = /s$|feet|hooves/.test(kind) || /legs|feet|hooves/.test(am?.[3] ?? '');
    // "a white socks on his hind feet" のように冠詞と複数が食い違うときは複数を信じる。
    let n = cnt ? (NUM[cnt.split(' ')[0]] ?? 1) : plural ? (side ? 1 : 2) : 1;
    if (plural && n === 1 && !side) n = 2;
    if (cnt === 'all four' || cnt === 'all') n = 4;
    const len = /stocking/.test(kind) ? (adj === 'half' ? 4 : 5) : /leg/.test(kind) ? 4 : /sock|fetlock/.test(kind) ? 3 : /foot|feet|pastern|hoove/.test(kind) ? 2 : 1;
    const put = (k) => { legs[k] = Math.max(legs[k], len); };
    if (n >= 4) { for (let k = 0; k < 4; k++) put(k); continue; }
    if (side && pos) { put(LEG[(side === 'left' ? 'L' : 'R') + (pos === 'fore' ? 'F' : 'H')]); continue; }
    if (pos) {
      const pair = pos === 'fore' ? [0, 1] : [2, 3];
      if (n >= 2) { put(pair[0]); put(pair[1]); } else put(pair[pick(name, `leg${pos}`, 2)]);
      continue;
    }
    // "on his left feet" は左の前後。
    if (side) { if (plural) put(side === 'left' ? 0 : 1); put(side === 'left' ? 2 : 3); continue; }
    // 位置が無い：後脚から埋め、3 本目は前脚のどちらか（馬名で決める）。
    if (n >= 1) put(n >= 2 ? 2 : 2 + pick(name, 'leg1', 2));
    if (n >= 2) put(3);
    if (n >= 3) put(pick(name, 'leg3', 2));
  }
  // 何も読めなかった文は白斑の記述ではない（無地と決めつけない）。
  if (face === 'none' && legs.every((x) => !x)) return null;
  return { face, size, legs };
}

/** 英語版の記事から、その馬の白斑の文を探す。{ s, m } か null。 */
function enSentence(text, names) {
  const body = plain(text.replace(/\{\{\s*Infobox[\s\S]*?\n\}\}/i, ''));
  const subj = EN_SUBJ(names);
  // 段落の最初の 2 節（導入と背景）だけ。成績や種牡馬の節の "his son … with a blaze" を拾わない。
  const head = body.split(/\n==[^=]/).slice(0, 3).join('\n');
  const sentences = head.replace(/\b(St|Mr|Mrs|Dr|Jr|Sr|No)\.\s/g, '$1 ').split(/(?<=[.!?])\s+|\n+/);
  for (const s of sentences) {
    const mk = EN_MARK.exec(s);
    if (!mk) continue;
    if (!subj.test(s)) continue;
    if (EN_KIN.test(s.slice(0, mk.index))) continue;
    // "Star" という名の馬・レース名（Morning Star Stakes）を白斑と取り違えない：白斑の語の前後に描写の語があること。
    if (!/\b(with|has|had|bearing|carrying|sporting|marked|markings?|white)\b/i.test(s)) continue;
    // 色と馬の語が無い文（"he became a star"）は描写ではない。
    if (!/\b(bay|chestnut|grey|gray|brown|black|roan|white|sorrel|dun|palomino|horse|colt|filly|mare|stallion|gelding|markings?)\b/i.test(s)) continue;
    const m = parseEn(s, names.name);
    if (m) return { s: s.trim(), m };
  }
  return null;
}

// 日本語版：主語がその馬の文。白斑の語は [[馬のマーキング|…]] のリンクか、ほかの意味に取りにくい語だけ。
const JA_MARK = /流星|白面|鼻梁白|鼻白|四白|三白|二白|一白|靴下|白斑|白徴|ソックス|(?:額|顔)[^。]{0,6}星|(?:小さ[ない]|大き[ない]|細い)星/;
const JA_NOT = /横浜流星|流星社|流星群|流星号|流星の(?:如|ごと)/;
const JA_KIN = /[父母兄姉弟妹仔駒]|産駒|全兄|半兄/;
export function parseJa(s0, name) {
  if (/白斑(?:の|が)?(?:ない|無い|なく|を持たな|のひとつもない)|一切の白斑|白徴(?:の|が)?(?:ない|無い)/.test(s0)) return { face: 'none', size: 'm', legs: [0, 0, 0, 0] };
  // 「流星の無い」「流星がなかった」は流星なし（ほかの馬の話のこともあるので、無地とは決めない）。
  const s = s0.replace(/(?:流星|星)(?:の|が|は)?(?:無|な)(?:い|く|かった)/g, '');
  let face = 'none', size = 'm';
  const star = /(?:額|顔)[^。、]{0,6}星|(?:小さ[ない]|大き[ない]|細い)星|星と|星から/.test(s.replace(/流星/g, ''));
  if (/白面/.test(s)) face = 'bald';
  else if (/(?:大|幅広[のい]?|大き[なのい]+|太い|派手な|巨大な)流星/.test(s)) face = 'blaze';
  else if (/流星/.test(s)) face = star ? 'starStripe' : 'stripe';
  else if (star) face = /鼻梁白|鼻白/.test(s) ? 'starSnip' : 'star';
  else if (/鼻梁白|鼻白/.test(s)) face = 'snip';
  if (/小さ[ない]星/.test(s)) size = 's';
  if (/大き[ない]星/.test(s)) size = 'l';
  const legs = [0, 0, 0, 0];
  const put = (k, len = 3) => { legs[k] = Math.max(legs[k], len); };
  const nW = /四白|四肢(?:が|の)?(?:白|所謂靴下)/.test(s) ? 4 : /三白/.test(s) ? 3 : /二白/.test(s) ? 2 : /一白/.test(s) ? 1 : 0;
  // 「3本の所謂靴下」「3本の脚に所謂靴下」「3本の白い脚」
  const nS = (() => {
    const m = /([1-4１-４一二三四])本の(?:(?:所謂)?(?:靴下|ソックス)|脚に[^。、]{0,10}(?:靴下|ソックス|白)|白い脚)/.exec(s);
    return m ? ('1１一'.includes(m[1]) ? 1 : '2２二'.includes(m[1]) ? 2 : '3３三'.includes(m[1]) ? 3 : 4) : 0;
  })();
  let pos = 0;
  for (const [re, k] of [[/左前(?:脚|肢|足)/, 0], [/右前(?:脚|肢|足)/, 1], [/左後(?:脚|肢|足)/, 2], [/右後(?:脚|肢|足)/, 3]]) if (re.test(s)) { put(k); pos++; }
  if (!pos && /(?:両)?後(?:脚|肢|足)/.test(s) && /靴下|ソックス|白/.test(s)) { put(2); put(3); pos = 2; }
  if (!pos && /(?:両)?前(?:脚|肢|足)/.test(s) && /靴下|ソックス|白/.test(s)) { put(0); put(1); pos = 2; }
  const n = Math.max(nW, nS, !pos && /靴下|ソックス/.test(s) ? 1 : 0);
  if (n > pos) {
    if (n >= 4) for (let k = 0; k < 4; k++) put(k);
    else {
      put(n >= 2 ? 2 : 2 + pick(name, 'leg1', 2));
      if (n >= 2) put(3);
      if (n >= 3) put(pick(name, 'leg3', 2));
    }
  }
  if (face === 'none' && legs.every((x) => !x)) return null;
  return { face, size, legs };
}
function jaSentence(text, name) {
  const body = plain(text.replace(/\{\{\s*競走馬[\s\S]*?\n\}\}/, ''));
  for (const s of body.split(/[。\n]/)) {
    if (!JA_MARK.test(s) || JA_NOT.test(s.replace(/流星[^。]{0,3}(?:群|社)/g, '流星群'))) continue;
    const mk = JA_MARK.exec(s);
    const head = s.slice(0, mk.index);
    // 主語がその馬：文頭が馬名か、白斑の語より前に親兄弟の語が無いこと。
    const starts = s.trimStart().startsWith(name) || /^(?:本馬|同馬)/.test(s.trimStart());
    if (!starts && JA_KIN.test(head)) continue;
    if (!starts && !s.includes(name) && !/馬のマーキング|白斑|白徴/.test(text.slice(text.indexOf(s.slice(0, 8)) - 40, text.indexOf(s.slice(0, 8)) + s.length))) continue;
    const m = parseJa(s, name);
    if (m) return { s: s.trim(), m };
  }
  return null;
}

// ---------------------------------------------------------------- 英語版：Wikidata で記事を当てる
const results = new Map();     // `${n}|${b}` → { face, size, legs, src, text }
const stats = { wdRows: 0, matched: 0, pages: 0, badPage: 0, badYear: 0, enFound: 0, jaFound: 0, both: 0, conflict: 0 };
const rows = [];
for (const [lo, hi] of [[1600, 1900], [1900, 1950], [1950, 1975], [1975, 1990], [1990, 2005], [2005, 2030]]) {
  rows.push(...await sparql(`SELECT ?h ?t ?ja ?en ?d WHERE {
    ?h wdt:P31 wd:Q726 ; wdt:P569 ?d .
    FILTER(YEAR(?d) >= ${lo} && YEAR(?d) < ${hi})
    ?a schema:about ?h ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?t .
    OPTIONAL { ?h rdfs:label ?ja FILTER(lang(?ja) = 'ja') }
    OPTIONAL { ?h rdfs:label ?en FILTER(lang(?en) = 'en') }
  }`));
}
rows.push(...await sparql(`SELECT ?h ?t ?ja ?en WHERE {
  ?h wdt:P31 wd:Q726 . FILTER NOT EXISTS { ?h wdt:P569 ?d }
  ?a schema:about ?h ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?t .
  OPTIONAL { ?h rdfs:label ?ja FILTER(lang(?ja) = 'ja') }
  OPTIONAL { ?h rdfs:label ?en FILTER(lang(?en) = 'en') }
}`));
stats.wdRows = rows.length;
const pairs = new Map();     // 表の馬のキー → { h, title }
for (const r of rows) {
  const y = r.d ? Number(r.d.value.slice(0, 4)) : null;
  const title = r.t.value;
  let c = r.ja ? (byJa.get(norm(r.ja.value)) ?? []).filter((h) => near(h, y)) : [];
  if (!c.length) {
    const ens = [...new Set([r.en?.value, stripParen(title)].filter(Boolean).map(normEn))];
    c = [...new Set(ens.flatMap((e) => byEn.get(e) ?? []))].filter((h) => near(h, y));
  }
  if (c.length !== 1) continue;
  pairs.set(`${c[0].n}|${c[0].b}`, { h: c[0], title });
}
stats.matched = pairs.size;
console.error(`Wikidata の馬 ${rows.length} 件、表の馬と結べた ${pairs.size} 頭`);

const foaledOf = (text) => {
  const m = /\|\s*(?:foaled|birth_date|foaled_date)\s*=\s*([^\n]*)/i.exec(text);
  const y = m && /(1[6-9]\d\d|20\d\d)/.exec(m[1]);
  return y ? Number(y[1]) : null;
};
const report = [];
let i = 0;
for (const [k, { h, title }] of pairs) {
  if (++i % 300 === 0) console.error(`  ${i}/${pairs.size} 取得 ${fetched}、白斑 ${stats.enFound}`);
  const text = await page(title);
  if (!text || !/\{\{\s*Infobox\s+(racehorse|horse)/i.test(text)) { stats.badPage++; continue; }
  stats.pages++;
  const fy = foaledOf(text);
  if (fy != null && Math.abs(fy - h.b) > 1) { stats.badYear++; continue; }
  const names = [...new Set([stripParen(title), ...enNamesOf(h)])];
  names.name = h.n;
  const found = enSentence(text, names);
  if (!found) continue;
  results.set(k, { ...found.m, src: 'en', text: found.s });
  stats.enFound++;
}

// ---------------------------------------------------------------- 日本語版：取り込みが貯めた記事
const birthJa = (text) => {
  const m = /\|\s*(?:生|生誕)\s*=\s*([^\n]*)/.exec(text);
  const y = m && /(1[6-9]\d\d|20\d\d)/.exec(m[1]);
  return y ? Number(y[1]) : null;
};
for (const f of readdirSync(JA_CACHE)) {
  if (!f.endsWith('.txt') || f.startsWith('%3Aen')) continue;
  let title;
  try { title = decodeURIComponent(f.slice(0, -4)); } catch { continue; }
  const text = readFileSync(join(JA_CACHE, f), 'utf8');
  if (!/\{\{\s*競走馬/.test(text)) continue;
  const name = stripParen(title.replace(/_/g, ' '));
  const y = birthJa(text);
  const c = (byJa.get(norm(name)) ?? []).filter((h) => near(h, y, 0));
  if (c.length !== 1) continue;
  const found = jaSentence(text, name);
  if (!found) continue;
  const k = `${c[0].n}|${c[0].b}`;
  const { s, m } = found;
  stats.jaFound++;
  const prev = results.get(k);
  if (prev) {
    stats.both++;
    // 両方あるときは英語版（定型の描写）を採る。顔の型が食い違ったら一覧に出す。
    if (prev.face !== m.face) { stats.conflict++; report.push(`食い違い ${c[0].n}(${c[0].b}) en:${prev.face} ja:${m.face}\n    ${s}`); }
    continue;
  }
  results.set(k, { ...m, src: 'ja', text: s });
}
console.error(stats);

if (REPORT) {
  for (const [k, r] of [...results].sort((a, b) => a[0].localeCompare(b[0], 'ja'))) {
    console.log(`${k}\t${r.face}${r.size !== 'm' ? `/${r.size}` : ''}\t${r.legs.join('')}\t[${r.src}] ${r.text.slice(0, 160)}`);
  }
  for (const l of report) console.log(l);
}

const faceCount = {};
for (const r of results.values()) faceCount[r.face] = (faceCount[r.face] ?? 0) + 1;
console.error('顔の型', faceCount, '脚に白', [...results.values()].filter((r) => r.legs.some((x) => x)).length);

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const lines = [...results].sort((a, b) => a[0].localeCompare(b[0], 'ja')).map(([k, r]) => {
  const [n, b] = k.split('|');
  return `  [${q(n)}, ${b}, '${r.face}${r.size !== 'm' ? `/${r.size}` : ''}', '${r.legs.join('')}', '${r.src}'],`;
});
writeFileSync(OUT, `// 実在馬の白斑。tools/import-markings.mjs が英語版・日本語版 Wikipedia の本文から書く（手で直さない）。
//   [馬名, 生年, 顔, 脚, 出典]
//   顔  none・star・starStripe・stripe・blaze・bald・snip・starSnip（/s・/l は星の大きさ）
//   脚  左前・右前・左後・右後の 4 桁。0 無し・1 蹄冠（微白）・2 繋の半ば（小白）・3 球節まで（白）・4 管の半ば・5 膝・飛節まで（長白）
//   出典 en（英語版の背景の文）・ja（日本語版の本文）

export const MARKINGS = [
${lines.join('\n')}
];
`);
console.error(`${OUT} に ${results.size} 頭を書いた`);
