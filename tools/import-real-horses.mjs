// ja.wikipedia.org から JRA GI（1984 年以降）の勝ち馬と、その父母・祖先を取り込む道具。
//
//   node tools/import-real-horses.mjs                       # 取得して年代別のブロックを標準出力へ
//   node tools/import-real-horses.mjs --write                # real-horses.js の目印の間へ直接差し込む
//   node tools/import-real-horses.mjs --from 1984 --to 2025
//   node tools/import-real-horses.mjs --races 桜花賞,優駿牝馬
//   node tools/import-real-horses.mjs --offline              # キャッシュだけで回す（取得しない）
//   node tools/import-real-horses.mjs --verify               # 表にある馬を ja.wikipedia と突き合わせる
//   node tools/import-real-horses.mjs --report               # 推測した項目の一覧を出す
//
// 取ってきた API の応答は --cache（既定 .cache/wiki）に貯める。
// 同じ馬を何度も引かないためと、ネットワークが塞がれた環境でも --offline で回し直せるため。
//
// 取り込む項目は二つに分かれる。
//   事実（ウィキペディアから取る）  … 生年・性・毛色・父・母・戦績・獲得賞金・GI の勝鞍
//   ゲームの数値（こちらで決める）  … lvl（格）・surf・dist・range・style・growth
// 後者はウィキペディアに無いので勝鞍から導く。導いた値は --report で一覧に出すので、
// 差し込む前に目で見て直すこと（CLAUDE.md の「健全性の目安」を壊しやすいのはこちら）。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRADED } from '../src/sim/schedule.js';
import { SURFACE } from '../src/sim/course.js';
import { REAL_HORSES } from '../src/sim/data/real-horses.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = join(ROOT, 'src/sim/data/real-horses.js');
const API = 'https://ja.wikipedia.org/w/api.php';
// ウィキメディアの作法。素性の分かる User-Agent を付けないと 403 で弾かれる。
const UA = 'keiba-sim-import/0.1 (https://github.com/; real-horses table builder)';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const num = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : d; };

const FROM = num('--from', 1984);
const TO = num('--to', new Date().getFullYear());
const CACHE = resolve(ROOT, opt('--cache', '.cache/wiki'));
const OFFLINE = flag('--offline');
const DEPTH = num('--depth', 4);        // 父母を何代さかのぼるか
const ONLY = opt('--races', null)?.split(',').map((s) => s.trim());
const DELAY = num('--delay', 200);      // 取得の間隔（ms）

/* ------------------------------------------------------------------ 取得 */

mkdirSync(CACHE, { recursive: true });
const cachePath = (title) => join(CACHE, encodeURIComponent(title).replace(/\*/g, '%2A') + '.txt');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 記事の生のウィキテキストを引く。キャッシュにあればそれを返す。
 * MediaWiki は 1 回に 50 本まで引けるので、足りないものだけをまとめて取る。
 */
async function wikitext(titles) {
  const out = new Map();
  const want = [];
  for (const t of titles) {
    const p = cachePath(t);
    if (existsSync(p)) out.set(t, readFileSync(p, 'utf8'));
    else want.push(t);
  }
  if (!want.length) return out;
  if (OFFLINE) {
    for (const t of want) out.set(t, '');
    console.error(`  [offline] キャッシュに無い ${want.length} 本を飛ばした`);
    return out;
  }
  for (let i = 0; i < want.length; i += 20) {
    const batch = want.slice(i, i + 20);
    const url = `${API}?${new URLSearchParams({
      action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main',
      redirects: '1', format: 'json', formatversion: '2', titles: batch.join('|'),
    })}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${API} に届かない（ja.wikipedia.org が許可されているか確かめる）`);
    const json = await res.json();
    // リダイレクトを辿った場合、返ってくる題は別名になる。元の題に書き戻す。
    const alias = new Map((json.query?.redirects ?? []).map((r) => [r.to, r.from]));
    const normal = new Map((json.query?.normalized ?? []).map((r) => [r.to, r.from]));
    for (const page of json.query?.pages ?? []) {
      const text = page.revisions?.[0]?.slots?.main?.content ?? '';
      for (const key of [page.title, alias.get(page.title), normal.get(page.title)]) {
        if (key && batch.includes(key)) { out.set(key, text); writeFileSync(cachePath(key), text); }
      }
      if (!batch.includes(page.title)) continue;
      out.set(page.title, text);
      writeFileSync(cachePath(page.title), text);
    }
    for (const t of batch) if (!out.has(t)) { out.set(t, ''); writeFileSync(cachePath(t), ''); }
    await sleep(DELAY);
  }
  return out;
}

/* -------------------------------------------------------- GI と勝ち馬の表 */

/**
 * 現在の JRA GI 24 戦。
 *   wiki  … ja.wikipedia の記事名
 *   span  … GI として施行された期間（1984 年より前は切る）
 *   as    … real-horses.js の big に書くレース名。期間で名が変わるものは [年, 名] の並び
 *   sect  … 勝ち馬の表がある節の見出し（天皇賞は春と秋が同じ記事なので要る）
 * レース名を real-horses.js の表記（天皇賞(秋) など）に合わせるのは、
 * 既にある馬の勝鞍と突き合わせて重複を見つけるため。
 */
const GI_RACES = [
  { wiki: 'フェブラリーステークス', span: [1997, null], as: 'フェブラリーS' },
  { wiki: '高松宮記念', span: [1996, null], as: '高松宮記念' },
  { wiki: '大阪杯', span: [2017, null], as: '大阪杯' },
  { wiki: '桜花賞', span: [1984, null], as: '桜花賞' },
  { wiki: '皐月賞', span: [1984, null], as: '皐月賞' },
  { wiki: '天皇賞', span: [1984, null], as: '天皇賞(春)', sect: /春/ },
  { wiki: '天皇賞', span: [1984, null], as: '天皇賞(秋)', sect: /秋/ },
  { wiki: 'NHKマイルカップ', span: [1996, null], as: 'NHKマイルC' },
  { wiki: 'ヴィクトリアマイル', span: [2006, null], as: 'ヴィクトリアマイル' },
  { wiki: '優駿牝馬', span: [1984, null], as: '優駿牝馬' },
  { wiki: '東京優駿', span: [1984, null], as: '東京優駿' },
  { wiki: '安田記念', span: [1984, null], as: '安田記念' },
  { wiki: '宝塚記念', span: [1984, null], as: '宝塚記念' },
  { wiki: 'スプリンターズステークス', span: [1990, null], as: 'スプリンターズS' },
  { wiki: '秋華賞', span: [1996, null], as: '秋華賞' },
  { wiki: '菊花賞', span: [1984, null], as: '菊花賞' },
  { wiki: 'エリザベス女王杯', span: [1984, null], as: 'エリザベス女王杯' },
  { wiki: 'マイルチャンピオンシップ', span: [1984, null], as: 'マイルCS' },
  { wiki: 'ジャパンカップ', span: [1984, null], as: 'ジャパンカップ' },
  { wiki: 'チャンピオンズカップ (競馬)', span: [2014, null], as: 'チャンピオンズC' },
  { wiki: 'ジャパンカップダート', span: [2000, 2013], as: 'ジャパンカップダート' },
  { wiki: '阪神ジュベナイルフィリーズ', span: [1991, null], as: [[2001, '阪神JF'], [1991, '阪神3歳牝馬S']] },
  { wiki: '朝日杯フューチュリティステークス', span: [1984, null], as: [[2001, '朝日杯FS'], [1984, '朝日杯3歳S']] },
  { wiki: '有馬記念', span: [1984, null], as: '有馬記念' },
  { wiki: 'ホープフルステークス', span: [2017, null], as: 'ホープフルS' },
];

/** その年のレース名（名が変わったレースのため）。 */
function raceNameAt(race, year) {
  if (typeof race.as === 'string') return race.as;
  for (const [from, name] of race.as) if (year >= from) return name;
  return race.as[race.as.length - 1][1];
}

/** 記事を見出しで切る。節ごとに勝ち馬の表を探すため。 */
function sections(text) {
  const out = [{ head: '', body: '' }];
  for (const line of text.split('\n')) {
    const m = /^(={2,})\s*(.*?)\s*\1\s*$/.exec(line);
    if (m) out.push({ head: m[2], body: '' });
    else out[out.length - 1].body += line + '\n';
  }
  return out;
}

/**
 * 勝ち馬の表から [年, 馬名] を拾う。
 *
 * レース記事の歴代優勝馬の表は版によって列の並びが違う（回数・施行日・優勝馬・性齢・タイム・騎手・調教師…）。
 * 列の位置で取ると版を跨げないので、行の中身の素性で取る：
 * 日本の競走馬の名はカタカナだけ、騎手と調教師は漢字。だから
 * 「カタカナ（と長音・ローマ数字）だけで 3 文字以上」の最初のセルが勝ち馬。
 * 外国産馬のカタカナ名もこれで拾える。
 */
function winnersOf(text, race) {
  const [from, to] = race.span;
  const lo = Math.max(from, FROM), hi = Math.min(to ?? TO, TO);
  const got = new Map();
  for (const sec of sections(text)) {
    if (race.sect && !race.sect.test(sec.head)) continue;
    if (!race.sect && !/歴代|優勝馬|勝ち馬|結果/.test(sec.head)) continue;
    for (const row of sec.body.split(/\n\s*\|-/)) {
      const cells = row.split(/\n?\s*\|\||\n\s*\|(?!\|)/).map((c) => c.trim()).filter(Boolean);
      const joined = cells.join(' | ');
      const ym = /(19\d\d|20\d\d)年/.exec(joined);
      if (!ym) continue;
      const year = Number(ym[1]);
      if (year < lo || year > hi) continue;
      let horse = null;
      for (const cell of cells) {
        const plain = cell.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/''+/g, '')
          .replace(/\{\{[^}]*\}\}/g, '').replace(/<[^>]*>/g, '').trim();
        if (/^[ァ-ヴー]{3,18}$/.test(plain) || /^[ァ-ヴー]{3,18}(II|III|IV)$/.test(plain)) { horse = plain; break; }
      }
      if (horse && !got.has(year)) got.set(year, horse);
    }
  }
  const missing = [];
  for (let y = lo; y <= hi; y++) if (!got.has(y)) missing.push(y);
  return { got, missing };
}

/* ------------------------------------------------------- 馬の記事を読む */

/** {{競走馬}} の引数を拾う。入れ子のテンプレートがあるので括弧を数えて切る。 */
function infobox(text) {
  const i = text.search(/\{\{\s*(Infobox[ _]?)?競走馬\s*[|}]/i);
  if (i < 0) return null;
  let depth = 0, end = i;
  for (let j = i; j < text.length - 1; j++) {
    if (text[j] === '{' && text[j + 1] === '{') { depth++; j++; }
    else if (text[j] === '}' && text[j + 1] === '}') { depth--; j++; if (!depth) { end = j + 1; break; } }
  }
  const body = text.slice(i + 2, end - 2);
  const params = {};
  let buf = '', d = 0;
  const push = () => {
    const eq = buf.indexOf('=');
    if (eq > 0) params[buf.slice(0, eq).trim()] = buf.slice(eq + 1).trim();
    buf = '';
  };
  for (let j = 0; j < body.length; j++) {
    const two = body.slice(j, j + 2);
    if (two === '{{' || two === '[[') { d++; buf += two; j++; continue; }
    if (two === '}}' || two === ']]') { d--; buf += two; j++; continue; }
    if (body[j] === '|' && d === 0) { push(); continue; }
    buf += body[j];
  }
  push();
  return params;
}

const pick = (p, ...keys) => { for (const k of keys) if (p?.[k]) return p[k]; return null; };
/** リンクと注釈を落として素の文字にする。 */
const plain = (v) => (v ?? '')
  .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
  .replace(/\{\{(?:lang|仮リンク)\|[^|}]*\|([^|}]*)[^}]*\}\}/gi, '$1')
  .replace(/\{\{[^}]*\}\}/g, '').replace(/<ref[^>]*>.*?<\/ref>/gs, '').replace(/<[^>]*>/g, '')
  .replace(/''+/g, '').replace(/&nbsp;/g, ' ').trim();

/** カタカナの馬名だけを残す（欧字表記や「(父)」のような注が混じる）。 */
function horseName(v) {
  const s = plain(v).replace(/\s*\(.*$/, '').replace(/\s*（.*$/, '').trim();
  const m = /[ァ-ヴー]{2,20}/.exec(s);
  return m ? m[0] : null;
}

/** 獲得賞金を万円に直す。「14億5455万1000円」「4億5000万円」「1億2,345万円」。 */
function earnings(v) {
  const s = plain(v).replace(/[,，\s]/g, '');
  const oku = /(\d+(?:\.\d+)?)億/.exec(s);
  const man = /(?:億)?(\d+(?:\.\d+)?)万/.exec(s);
  if (!oku && !man) { const yen = /(\d{5,})円/.exec(s); return yen ? Math.round(Number(yen[1]) / 1e4) : null; }
  return Math.round((oku ? Number(oku[1]) * 1e4 : 0) + (man ? Number(man[1]) : 0));
}

/** 「29戦9勝」「中央29戦9勝」。着度数 [9-5-2-13] もあれば拾う。 */
function record(v) {
  const s = plain(v).replace(/[,，\s]/g, '');
  const sw = /(\d+)戦(\d+)勝/.exec(s);
  const rec = /\[?(\d+)\s*[-－]\s*(\d+)\s*[-－]\s*(\d+)\s*[-－]\s*(\d+)\]?/.exec(s);
  return {
    starts: sw ? Number(sw[1]) : null,
    wins: sw ? Number(sw[2]) : null,
    rec: rec ? [1, 2, 3, 4].map((i) => Number(rec[i])) : null,
  };
}

const COLORS = ['鹿毛', '黒鹿毛', '青鹿毛', '青毛', '栗毛', '栃栗毛', '芦毛', '白毛'];
/** 毛色。長いものから当てないと「黒鹿毛」が「鹿毛」になる。 */
function coat(v) {
  const s = plain(v);
  return [...COLORS].sort((a, b) => b.length - a.length).find((c) => s.includes(c)) ?? null;
}

/** 馬の記事から事実の項目を取る。 */
function readHorse(title, text) {
  if (!text) return null;
  const p = infobox(text);
  if (!p) return null;
  const birth = plain(pick(p, '生誕', '生年月日', '生', '誕生'));
  const by = /(18\d\d|19\d\d|20\d\d)年?/.exec(birth);
  const died = plain(pick(p, '死没', '没'));
  const dy = /(19\d\d|20\d\d)年?/.exec(died);
  const r = record(pick(p, '競走成績', '通算成績', '生涯成績', '成績') ?? '');
  const sex = plain(pick(p, '性', '性別'));
  return {
    n: horseName(pick(p, '馬名') ?? title) ?? title,
    b: by ? Number(by[1]) : null,
    s: /牝/.test(sex) ? '牝' : /セン/.test(sex) ? 'セン' : '牡',
    c: coat(pick(p, '毛色', '毛')),
    sire: horseName(pick(p, '父')),
    dam: horseName(pick(p, '母')),
    damsire: horseName(pick(p, '母の父', '母父')),
    died: dy ? Number(dy[1]) : null,
    earn: earnings(pick(p, '総賞金', '獲得賞金', '賞金')),
    ...r,
    text,
  };
}

/* --------------------------------------------- ゲームの数値を勝鞍から導く */

const GI_DIST = new Map(GRADED.filter((g) => g.grade === 'GI').map((g) => [g.name, g]));
// 番組表の名と big の名のずれを埋める。
const ALIAS = {
  '東京優駿': '日本ダービー', '優駿牝馬': 'オークス', '天皇賞(春)': '天皇賞（春）',
  '天皇賞(秋)': '天皇賞（秋）', 'ジャパンカップ': 'ジャパンC', 'ジャパンカップダート': 'チャンピオンズC',
  '阪神3歳牝馬S': '阪神JF', '朝日杯3歳S': '朝日杯FS',
};
const giOf = (name) => GI_DIST.get(ALIAS[name] ?? name) ?? null;

/**
 * 距離・馬場・格を勝鞍から決める。
 *
 * ウィキペディアに脚質・適性・能力は無いので勝鞍から導く。
 * CLAUDE.md の落とし穴 8・11・12 のとおり、速度の帯は狭く取るので
 * lvl は 0.82〜0.92 の範囲にしか置かない（GI を勝つ馬はみな同じくらい速い）。
 */
function derive(h, wins) {
  const races = wins.map(([, name]) => giOf(name)).filter(Boolean);
  const dists = races.map((g) => g.distance);
  const dist = dists.length ? Math.round(dists.reduce((a, b) => a + b, 0) / dists.length / 100) * 100 : 2000;
  const spread = dists.length > 1 ? Math.max(...dists) - Math.min(...dists) : 0;
  const range = Math.max(400, Math.min(800, Math.round((300 + spread * 0.7) / 100) * 100));
  const dirt = races.filter((g) => g.surface === SURFACE.DIRT).length;
  const surf = !races.length ? 'T' : dirt === races.length ? 'D' : dirt ? 'TD' : 'T';
  // 格は GI の数と獲得賞金で。中央値を押し上げないように上は 0.92 で止める。
  const g1 = wins.length;
  const money = (h.earn ?? 0) / 10000; // 億円
  let lvl = 0.82 + Math.min(0.06, (g1 - 1) * 0.012) + Math.min(0.04, money * 0.008);
  lvl = Math.min(0.92, Math.round(lvl * 100) / 100);
  return { lvl, surf, dist, range, style: styleOf(h.text), guessed: ['lvl', 'surf', 'dist', 'range', 'style'] };
}

/**
 * 脚質。記事の本文で一番多く使われている語を採る。
 * インフォボックスには無いが、戦績の記述には必ず出てくる。
 */
function styleOf(text) {
  const n = (re) => (text.match(re) ?? []).length;
  const score = { 逃: n(/逃げ/g), 先: n(/先行/g), 差: n(/差し/g), 追: n(/追い込/g) };
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return best[1] ? best[0] : '先';
}

/* ------------------------------------------------------------ 書き出し */

const KNOWN = new Set(REAL_HORSES.map((d) => d.n));
const q = (s) => `'${s}'`;

/** 1 頭を real-horses.js の 1 項目として書く。既にある書き方に合わせる。 */
function emit(h, wins) {
  const f = [`n: ${q(h.n)}`, `b: ${h.b}`];
  if (h.s === '牝') f.push(`s: '牝'`);
  if (h.c && h.c !== '鹿毛') f.push(`c: ${q(h.c)}`);
  if (h.sire) f.push(`sire: ${q(h.sire)}`);
  if (h.dam) f.push(`dam: ${q(h.dam)}`);
  if (h.died) f.push(`died: ${h.died}`);
  const lines = [`  { ${f.join(', ')},`];
  if (wins) {
    const d = derive(h, wins);
    const g = [`lvl: ${d.lvl.toFixed(2)}`, `surf: ${q(d.surf)}`, `dist: ${d.dist}`, `range: ${d.range}`, `style: ${q(d.style)}`];
    if (h.starts) g.push(`starts: ${h.starts}`);
    if (h.wins) g.push(`wins: ${h.wins}`);
    if (h.rec) g.push(`rec: [${h.rec.join(', ')}]`);
    if (h.earn) g.push(`earn: ${h.earn}`);
    lines.push(`    ${g.join(', ')},`);
    const big = wins.map(([y, name]) => `[${y}, ${q(name)}, 'GI']`);
    lines.push(`    big: [${big.join(', ')}] },`);
  } else {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, ' },');
  }
  return lines.join('\n');
}

/** 血統をつなぐだけの牝馬は ['名', 生年, '父'] の一行で書く（既にある DAMS の書き方）。 */
const emitDam = (h) => `  [${q(h.n)}, ${h.b ?? '0'}, ${h.sire ? q(h.sire) : 'null'}],`;
/** 血統をつなぐだけの牡馬。 */
function emitAncestor(h) {
  const f = [`n: ${q(h.n)}`, `b: ${h.b ?? 0}`];
  if (h.sire) f.push(`sire: ${q(h.sire)}`);
  if (h.c && h.c !== '鹿毛') f.push(`c: ${q(h.c)}`);
  return `  { ${f.join(', ')} },`;
}

const DECADES = [[1960, 1979, '70S'], [1980, 1989, '80S'], [1990, 1999, '90S'],
  [2000, 2009, '00S'], [2010, 2019, '10S'], [2020, 2099, '20S']];
const decadeOf = (b) => DECADES.find(([lo, hi]) => b >= lo && b <= hi) ?? DECADES[0];

/* ----------------------------------------------------------------- 本体 */

async function main() {
  if (flag('--verify')) return verify();

  // 1. GI の記事から (年 → 勝ち馬) を拾う。
  const races = GI_RACES.filter((r) => !ONLY || ONLY.includes(r.as) || ONLY.includes(r.wiki)
    || (Array.isArray(r.as) && r.as.some(([, n]) => ONLY.includes(n))));
  console.error(`GI ${races.length} 戦の記事を読む（${FROM}〜${TO} 年）`);
  const texts = await wikitext([...new Set(races.map((r) => r.wiki))]);
  /** 馬名 → [[年, レース名], …] */
  const winsOf = new Map();
  for (const race of races) {
    const { got, missing } = winnersOf(texts.get(race.wiki) ?? '', race);
    for (const [year, name] of got) {
      if (!winsOf.has(name)) winsOf.set(name, []);
      winsOf.get(name).push([year, raceNameAt(race, year)]);
    }
    const label = typeof race.as === 'string' ? race.as : race.as[0][1];
    console.error(`  ${label.padEnd(16)} ${got.size} 勝ち馬${missing.length ? `（取れなかった年 ${missing.join(',')}）` : ''}`);
  }
  for (const w of winsOf.values()) w.sort((a, b) => a[0] - b[0]);

  // 2. 勝ち馬の記事を読む。表にもう居る馬は引かない。
  const want = [...winsOf.keys()].filter((n) => !KNOWN.has(n));
  console.error(`\n勝ち馬 ${winsOf.size} 頭のうち ${want.length} 頭が表に無い。記事を読む`);
  const horses = new Map();
  const read = async (names) => {
    const fresh = names.filter((n) => n && !horses.has(n) && !KNOWN.has(n));
    if (!fresh.length) return [];
    const t = await wikitext(fresh);
    const next = [];
    for (const n of fresh) {
      const h = readHorse(n, t.get(n) ?? '');
      if (!h || !h.b) { horses.set(n, null); continue; }
      horses.set(n, h);
      next.push(h.sire, h.dam);
    }
    return next.filter(Boolean);
  };
  let frontier = await read(want);
  // 3. 父母をさかのぼる。表にもう居る馬で止まる（落とし穴 31 の系統名のため、祖先はつないでおく）。
  for (let d = 1; d < DEPTH && frontier.length; d++) {
    console.error(`  ${d} 代さかのぼる（${frontier.length} 頭）`);
    frontier = await read(frontier);
  }

  // 4. 年代別に組む。
  const groups = new Map();
  for (const [name, h] of horses) {
    if (!h) continue;
    const [, , tag] = decadeOf(h.b);
    if (!groups.has(tag)) groups.set(tag, { sires: [], dams: [], runners: [] });
    const g = groups.get(tag);
    const wins = winsOf.get(name);
    if (wins) g.runners.push([h, wins]);
    else if (h.s === '牝') g.dams.push(h);
    else g.sires.push(h);
  }

  // 5. 書き出す。
  const out = [];
  for (const [, , tag] of DECADES) {
    const g = groups.get(tag);
    if (!g || !g.runners.length + g.dams.length + g.sires.length) continue;
    const label = tag === '70S' ? '1970 年代まで' : `${tag.slice(0, 2) < '30' ? '20' : '19'}${tag.slice(0, 2)} 年代`;
    out.push(`/** ${label}の JRA GI 勝ち馬（ja.wikipedia から取り込み）。 */`);
    if (g.sires.length) out.push(`const WIKI_${tag}_ANCESTORS = [\n${g.sires.map(emitAncestor).join('\n')}\n];\n`);
    if (g.dams.length) out.push(`const WIKI_${tag}_DAMS = [\n${g.dams.map(emitDam).join('\n')}\n].map(([n, b, sire]) => ({ n, b, s: '牝', sire }));\n`);
    out.push(`const WIKI_${tag} = [\n${g.runners.map(([h, w]) => emit(h, w)).join('\n')}\n];\n`);
  }
  const spread = [...groups.keys()].map((tag) => {
    const g = groups.get(tag);
    const parts = [];
    if (g.sires.length) parts.push(`...WIKI_${tag}_ANCESTORS.map(bg)`);
    if (g.dams.length) parts.push(`...WIKI_${tag}_DAMS.map(bg)`);
    parts.push(`...WIKI_${tag}`);
    return `  ${parts.join(', ')},`;
  }).join('\n');

  const n = [...groups.values()].reduce((a, g) => a + g.runners.length + g.dams.length + g.sires.length, 0);
  console.error(`\n${n} 頭を書き出す（勝ち馬 ${[...groups.values()].reduce((a, g) => a + g.runners.length, 0)} 頭＋祖先）`);
  if (flag('--report')) report(groups, winsOf);

  if (flag('--write')) {
    inject(out.join('\n'), spread);
    console.error(`${DATA_FILE} に差し込んだ。npm test を通すこと`);
  } else {
    console.log(out.join('\n'));
    console.log('\n// REAL_HORSES の末尾に足す行:\n' + spread);
  }
}

/** 目印の間を書き換える。順番を変えると世界の乱数がずれるので、必ず末尾に足す（落とし穴の注記）。 */
function inject(blocks, spread) {
  const B = ['// === import-real-horses.mjs ここから（自動生成。手で直してもよいが、再実行で消える） ===',
    '// === import-real-horses.mjs ここまで ==='];
  const S = ['  // === import-real-horses.mjs の spread ここから ===', '  // === ここまで ==='];
  let src = readFileSync(DATA_FILE, 'utf8');
  for (const [a, b] of [B, S]) {
    if (!src.includes(a) || !src.includes(b)) throw new Error(`${DATA_FILE} に目印 ${a.trim()} が無い`);
  }
  const cut = (src, [a, b], body) => {
    const i = src.indexOf(a) + a.length, j = src.indexOf(b);
    return src.slice(0, i) + '\n' + body + '\n' + src.slice(j);
  };
  src = cut(src, B, blocks);
  src = cut(src, S, spread);
  writeFileSync(DATA_FILE, src);
}

/** 導いた項目（lvl・脚質など）の一覧。差し込む前に目で見るため。 */
function report(groups, winsOf) {
  console.error('\n--- 導いた値（ウィキペディアに無い項目） ---');
  for (const g of groups.values()) {
    for (const [h, wins] of g.runners) {
      const d = derive(h, wins);
      console.error(`${h.n.padEnd(14)} lvl ${d.lvl.toFixed(2)}  ${d.surf.padEnd(2)} ${String(d.dist).padStart(4)}m ±${d.range}  ${d.style}  GI${wins.length}  ${wins.map(([y, r]) => `${y}${r}`).join(' ')}`);
    }
  }
}

/** 表にある馬の父母と生年を ja.wikipedia と突き合わせる。取り込んだ後の検算用。 */
async function verify() {
  const targets = REAL_HORSES.filter((d) => d.b >= 1980 && (d.sire || d.dam) && !d.bg);
  console.error(`${targets.length} 頭を突き合わせる`);
  let bad = 0;
  for (let i = 0; i < targets.length; i += 20) {
    const batch = targets.slice(i, i + 20);
    const t = await wikitext(batch.map((d) => d.n));
    for (const d of batch) {
      const h = readHorse(d.n, t.get(d.n) ?? '');
      if (!h) { console.error(`? ${d.n} — 記事が無い`); bad++; continue; }
      const diff = [];
      if (h.b && h.b !== d.b) diff.push(`生年 ${d.b} → ${h.b}`);
      if (h.sire && d.sire && h.sire !== d.sire) diff.push(`父 ${d.sire} → ${h.sire}`);
      if (h.dam && d.dam && h.dam !== d.dam) diff.push(`母 ${d.dam} → ${h.dam}`);
      if (h.s !== (d.s ?? '牡')) diff.push(`性 ${d.s ?? '牡'} → ${h.s}`);
      if (h.c && h.c !== (d.c ?? '鹿毛')) diff.push(`毛 ${d.c ?? '鹿毛'} → ${h.c}`);
      if (diff.length) { console.error(`! ${d.n} — ${diff.join(' / ')}`); bad++; }
    }
  }
  console.error(bad ? `\n${bad} 頭に食い違い` : '\n食い違い無し');
}

main().catch((e) => { console.error(`\n失敗: ${e.message}`); process.exit(1); });
