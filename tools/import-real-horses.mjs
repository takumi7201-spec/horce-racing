// ja.wikipedia.org から JRA の重賞（1984 年以降の GI・GII・GIII）の勝ち馬と、
// その父母・祖先を取り込む道具。
//
//   node tools/import-real-horses.mjs                       # 取得して年代別のブロックを標準出力へ
//   node tools/import-real-horses.mjs --write                # real-horses.js の目印の間へ直接差し込む
//   node tools/import-real-horses.mjs --from 1984 --to 2025
//   node tools/import-real-horses.mjs --races 桜花賞,優駿牝馬
//   node tools/import-real-horses.mjs --grades GI       # 格を絞る（既定は GI,GII,GIII）
//   node tools/import-real-horses.mjs --offline              # キャッシュだけで回す（取得しない）
//   node tools/import-real-horses.mjs --verify               # 表にある馬を ja.wikipedia と突き合わせる
//   node tools/import-real-horses.mjs --report               # 推測した項目の一覧を出す
//
// 記事は 1 本ずつ引いて --cache（既定 .cache/wiki）に貯める。2026 年の取り込みでは
// レース 25 本＋馬 1,000 本ほど引くので、同じ馬を二度引かないためと、
// 取得が止まった環境でも --offline で貯めた分から組み直せるようにするため。
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
/** 差し込み先の目印（この間を毎回書き直す）。 */
const MARK = ['// === import-real-horses.mjs ここから（自動生成。手で直してもよいが、再実行で消える） ===',
  '// === import-real-horses.mjs ここまで ==='];
// 取り口は index.php の action=raw。api.php（50 本まとめて引ける）ではない理由は wikitext() に書いた。
const RAW = 'https://ja.wikipedia.org/w/index.php';
// ウィキメディアの作法。素性の分かる User-Agent を付けないと 403 で弾かれる。
const UA = 'keiba-sim-import/0.1 (https://github.com/takumi7201-spec/horce-racing; real-horses table builder)';

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
const GRADES = opt('--grades', 'GI,GII,GIII').split(',').map((s) => s.trim());
const DELAY = num('--delay', 200);      // 取得の間隔（ms）

/* ------------------------------------------------------------------ 取得 */

mkdirSync(CACHE, { recursive: true });
const cachePath = (title) => join(CACHE, encodeURIComponent(title).replace(/\*/g, '%2A') + '.txt');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 記事の生のウィキテキストを引く。キャッシュにあればそれを返す。
 *
 * 取り口は /w/index.php?action=raw で、1 本ずつ引く。api.php なら 50 本まとめて引けて速いが、
 * 署名の無い（ログインしない）取得には envoy の上限が掛かっていて、共用の出口 IP からだと
 * 1 本目から 429 Too Many Requests が返る（retry-after は 30 秒前後）。raw はこの上限の外にある。
 * 1 本ずつになるぶん遅いので、取ったものは必ずキャッシュへ落として二度引かない。
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
  for (const t of want) {
    const text = await fetchRaw(t);
    out.set(t, text);
    writeFileSync(cachePath(t), text);   // 空（記事が無い）も残す。毎回引き直さないため
    await sleep(DELAY);
  }
  return out;
}

/**
 * 1 本引く。429 は retry-after に従って待ち直す（向こうの上限は時間帯で動く）。
 * 記事が無ければ空文字（404）。呼び元は空を「取れなかった馬」として黙って飛ばす。
 */
async function fetchRaw(title, tries = 5) {
  const url = `${RAW}?${new URLSearchParams({ title, action: 'raw' })}`;
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status === 404) return '';
    // 429（上限）だけでなく 5xx も待って引き直す。数千本引く途中で 1 本が 500 を返すことがあり、
    // そこで投げると長い取り込みが丸ごと無駄になる。待ち時間は回を追うごとに伸ばす。
    if (res.status === 429 || res.status >= 500) {
      const hint = Number(res.headers.get('retry-after'));
      const wait = Math.min(120, Math.max(5, hint || 10 * (i + 1))) * 1000;
      console.error(`  [${res.status}] ${title} — ${wait / 1000} 秒待って引き直す`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${RAW} に届かない（ja.wikipedia.org が許可されているか確かめる）`);
    const text = await res.text();
    // raw は転送の記事を転送のまま返す（api.php の redirects=1 に当たるものが無い）。1 度だけ辿る。
    const red = /^\s*#\s*(?:REDIRECT|転送|リダイレクト)\s*\[\[\s*([^\]|#]+)/i.exec(text);
    if (red && red[1].trim() !== title) return fetchRaw(red[1].trim(), tries);
    return text;
  }
  throw new Error(`429 が続く — ${title}。しばらく置いてから引き直す（貯めた分だけで組むなら --offline）`);
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
  // 「高松宮記念」は競輪・競艇との曖昧さ回避ページ。競馬の記事は括弧付き。
  { wiki: '高松宮記念 (競馬)', span: [1996, null], as: '高松宮記念' },
  { wiki: '大阪杯', span: [2017, null], as: '大阪杯' },
  { wiki: '桜花賞', span: [1984, null], as: '桜花賞' },
  { wiki: '皐月賞', span: [1984, null], as: '皐月賞' },
  // 「天皇賞」の記事は帝室御賞典からの歴史で、勝ち馬の表は春・秋それぞれの記事にある（括弧は全角）。
  { wiki: '天皇賞（春）', span: [1984, null], as: '天皇賞(春)' },
  { wiki: '天皇賞（秋）', span: [1984, null], as: '天皇賞(秋)' },
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
  // こちらも曖昧さ回避ページ（米英豪にも同名の競走がある）。
  { wiki: 'ホープフルステークス (中央競馬)', span: [2017, null], as: 'ホープフルS' },
];

/**
 * 番組表の重賞名 → ja.wikipedia の記事名。
 * ほとんどは末尾の略字を伸ばすだけ（S→ステークス・C→カップ・T→トロフィー）なので、
 * そうならないものだけ並べる。改称した 2 戦は、記事が今の名で立っていて、
 * 古い年の勝ち馬もその記事の表に載っている。
 */
const RACE_WIKI = {
  'アメリカＪＣＣ': 'アメリカジョッキークラブカップ',
  '京成杯AH': '京成杯オータムハンデキャップ',
  'アーリントンC': 'チャーチルダウンズカップ',        // 2025 年に改称
  '弥生賞': '弥生賞ディープインパクト記念',            // 2020 年に改称
};
const wikiTitleOf = (name) => RACE_WIKI[name]
  ?? name.replace(/S$/, 'ステークス').replace(/C$/, 'カップ').replace(/T$/, 'トロフィー');

/**
 * GI 以外の重賞（番組表の GII 32 戦・GIII 41 戦）。
 *
 * 格は今の番組表の格で書く。「番組表は開始年によらず現在の体系」という既定に合わせるため、
 * 1984 年当時の格（GII だった GIII 戦など）を年ごとに追うことはしない。
 * 1984 年より後に創設されたレース（キーンランドC・レパードSなど）は、
 * 記事の表にそれ以前の年が無いので span を切らなくても勝手に揃う。
 * 今 GI の戦が GII だった年（2016 年までの大阪杯など）は拾わない。
 * その年だけ格を遡って調べる手間に対して、取れる馬がほとんど GI 馬と重なるため。
 */
const G23_RACES = GRADED.filter((g) => g.grade !== 'GI').map((g) => ({
  wiki: wikiTitleOf(g.name), span: [1984, null], as: g.name, grade: g.grade,
}));

/** 取り込む対象のレース。--grades で絞れる。 */
const RACES = [...GI_RACES.map((r) => ({ ...r, grade: 'GI' })), ...G23_RACES];

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
    // 「2005年までの優勝馬」「オープン特別時代の歴代優勝馬」は重賞になる前の表。
    // 拾うと、オープン特別を勝っただけの馬が GIII 勝ち馬として表に入る
    // （キーンランドCは 2006 年から、富士Sは 1998 年から、青葉賞は 1994 年から重賞）。
    if (/年までの優勝馬|オープン特別|格付け前/.test(sec.head)) continue;
    for (const row of sec.body.split(/\n\s*\|-/)) {
      const cells = row.split(/\n?\s*\|\||\n\s*\|(?!\|)/).map((c) => c.trim()).filter(Boolean);
      const joined = cells.join(' | ');
      const ym = /(19\d\d|20\d\d)年/.exec(joined);
      if (!ym) continue;
      // 条件の列に「オープン」「1000万下」が入っている行は重賞ではない
      // （見出しで切り分けられなかった表のため。上の見出しの判定と二重の網）。
      if (cells.some((c) => /^(オープン|OP|\d+万下|\d+万円以下)$/.test(plain(c)))) continue;
      const year = Number(ym[1]);
      if (year < lo || year > hi) continue;
      let horse = null;
      for (const cell of cells) {
        // plain() を通すのは、降着で繰り上がった年のセルに <ref> の長い注記が付いていて
        // （2006 エリザベス女王杯・2010 ジャパンカップ）、タグだけ落としても本文が残るため。
        const name = plain(cell);
        // 2 文字の馬名（ベガ）もあるので、リンクになっているセルは 2 文字から採る。
        const min = cell.includes('[[') ? 2 : 3;
        const re = new RegExp(`^[ァ-ヴー]{${min},18}(II|III|IV)?$`);
        if (re.test(name)) { horse = name; break; }
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
function infobox(src) {
  // 編集者向けの HTML コメントを先に落とす。{{競走馬<!--…-->| と書かれている記事があり、
  // テンプレート名の直後を見ているだけでは見つけられない（ラキシス）。
  const text = src.replace(/<!--[\s\S]*?-->/g, '');
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

/**
 * 表記の違いを均した馬名。小書きのカナ・長音・中黒を落として比べるため。
 * 「ゴーンウエスト」と「ゴーンウェスト」は同じ馬、という判定に使う。
 */
const SMALL = 'ァィゥェォャュョヮヴ', LARGE = 'アイウエオヤユヨワウ';
const normName = (s) => (s ?? '').normalize('NFKC')
  .replace(/[ァィゥェォャュョヮヴ]/g, (c) => LARGE[SMALL.indexOf(c)])
  .replace(/[ー・\s]/g, '');

/** カタカナの馬名だけを残す（欧字表記や「(父)」のような注が混じる）。 */
function horseName(v) {
  const s = plain(v).replace(/\s*\(.*$/, '').replace(/\s*（.*$/, '').trim();
  const m = /[ァ-ヴー]{2,20}/.exec(s);
  return m ? m[0] : null;
}

/**
 * 父・母の名。見える字ではなくリンクの先を採る。
 * 外国産馬の記事は父母を欧字で見せていることがあり（カフェファラオの父は
 * 「[[アメリカンファラオ|American Pharoah]]」）、見える字だけ見ると父が取れない。
 * リンクの先は日本語の記事名なので、ここからカタカナ名が取れる。
 */
function parentName(v) {
  const s = (v ?? '').replace(/<ref[^>]*>.*?<\/ref>/gs, '').replace(/<ref[^>]*\/>/g, '');
  const link = /\[\[\s*([^\]|#]+)/.exec(s);
  return horseName(link ? link[1] : s);
}

/** 獲得賞金を万円に直す。「14億5455万1000円」「4億5000万円」「1億2,345万円」。 */
function earnings(v) {
  const s = plain(v).replace(/[,，\s]/g, '');
  const oku = /(\d+(?:\.\d+)?)億/.exec(s);
  const man = /(?:億)?(\d+(?:\.\d+)?)万/.exec(s);
  if (!oku && !man) { const yen = /(\d{5,})円/.exec(s); return yen ? Math.round(Number(yen[1]) / 1e4) : null; }
  // 「1億61866186万8000円」のように数字が崩れている記事がある。万の位は 1 万未満
  // （それ以上なら億の側に入る）なので、はみ出していたら読めなかったことにする。
  if (man && Number(man[1]) >= 1e4) return null;
  const total = Math.round((oku ? Number(oku[1]) * 1e4 : 0) + (man ? Number(man[1]) : 0));
  return total > 5e5 ? null : total;   // 50 億を超える馬は居ない
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

/**
 * 馬の記事から事実の項目を取る。
 *
 * {{競走馬}} の引数名は記事によって二通りある（馬名・毛色・生誕・競走成績・総賞金 と、
 * 名・色・生・績・金）。新しい記事はほとんど短い方なので、どちらも見る。
 */
function readHorse(title, text) {
  if (!text) return null;
  const p = infobox(text);
  if (!p) return null;
  // 生年は {{生年月日と馬齢|p=0|2011|4|24}} の形で入っていることが多い。
  // plain() はテンプレートを中身ごと落とすので、生の値から 4 桁の年を拾う。
  // 没年の {{死亡年月日と馬齢|1994|4|23|2019|1|5}} は生年月日が先に入っているので、
  // 最初の年を採ると没年が生年になる（マチカネフクキタルが生まれた年に死ぬ）。last で最後を採る。
  // 出典の名前（<ref name="nikkan120731"/>）の中にも 4 桁の並びがあるので、
  // 閉じていない出典ごと先に落とす（バンブービギンの没年が 2073 年になった）。
  const years = (v) => [...(v ?? '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/<ref[^>]*\/?>/g, '').replace(/<[^>]*>/g, '')
    .matchAll(/18\d\d|19\d\d|20\d\d/g)].map((m) => Number(m[0]));
  const year = (v) => years(v)[0] ?? null;
  const last = (v) => years(v).at(-1) ?? null;
  const r = record(pick(p, '競走成績', '通算成績', '生涯成績', '成績', '績') ?? '');
  const sex = plain(pick(p, '性', '性別'));
  return {
    n: horseName(pick(p, '馬名', '名') ?? title) ?? title,
    b: year(pick(p, '生誕', '生年月日', '生', '誕生')),
    s: /牝/.test(sex) ? '牝' : /セン/.test(sex) ? 'セン' : '牡',
    c: coat(pick(p, '毛色', '毛', '色')),
    sire: parentName(pick(p, '父')),
    dam: parentName(pick(p, '母')),
    damsire: parentName(pick(p, '母の父', '母父')),
    died: last(pick(p, '死没', '没', '死')),
    earn: earnings(pick(p, '総賞金', '獲得賞金', '賞金', '金')),
    ...r,
    text,
  };
}

/** 生年より後・今年まで、に収まらない没年は読み違い。null にして捨てる。 */
const sane = (h) => (h && h.died != null && !(h.died > h.b && h.died <= new Date().getFullYear())
  ? { ...h, died: null } : h);

/**
 * 曖昧さ回避ページから競走馬の記事の題を拾う。同名の馬が複数並ぶこともある
 * （「ランド (1990年生の競走馬)」と「ランド (1994年生の競走馬)」）。
 */
function candidateTitles(name, text) {
  const links = [...text.matchAll(/\[\[\s*([^\]|#]+\([^)]*競走馬[^)]*\))\s*(?:\||\]\])/g)]
    .map((m) => m[1].trim()).filter((t) => t.startsWith(`${name} (`));
  return links.length ? links.slice(0, 3) : [`${name} (競走馬)`];
}

/**
 * 1 頭の事実を読む。素の題で競走馬のインフォボックスが無ければ、曖昧さ回避の先を辿る
 * （馬名が別の題目と重なっている馬は「○○ (競走馬)」の側に記事がある）。
 * 記事が無いときは辿らない。父母をさかのぼって出てくる海外の祖先のほとんどが
 * ja.wikipedia に記事を持たず、倍の回数を引くだけになるため。
 * winYear を渡すと、同名の馬が複数あるときに「その年に走れる馬齢だった馬」を選ぶ。
 */
async function readFacts(name, winYear = null) {
  const t = await wikitext([name]);
  const text = t.get(name) ?? '';
  const direct = sane(readHorse(name, text));
  if (direct?.b) return direct;
  if (!text) return null;
  const titles = candidateTitles(name, text);
  const t2 = await wikitext(titles);
  const got = titles.map((x) => sane(readHorse(name, t2.get(x) ?? '')));
  const fits = (h) => h?.b && (winYear == null || (winYear - h.b >= 2 && winYear - h.b <= 12));
  return got.find(fits) ?? got.find((h) => h?.b) ?? null;
}

/* --------------------------------------------- ゲームの数値を勝鞍から導く */

const RACE_DIST = new Map(GRADED.map((g) => [g.name, g]));
// 番組表の名と big の名のずれを埋める。
const ALIAS = {
  '東京優駿': '日本ダービー', '優駿牝馬': 'オークス', '天皇賞(春)': '天皇賞（春）',
  '天皇賞(秋)': '天皇賞（秋）', 'ジャパンカップ': 'ジャパンC', 'ジャパンカップダート': 'チャンピオンズC',
  '阪神3歳牝馬S': '阪神JF', '朝日杯3歳S': '朝日杯FS',
};
const raceOf = (name) => RACE_DIST.get(ALIAS[name] ?? name) ?? null;

/**
 * 距離・馬場・格を勝鞍から決める。
 *
 * ウィキペディアに脚質・適性・能力は無いので勝鞍から導く。
 * CLAUDE.md の落とし穴 8・11・12 のとおり、速度の帯は狭く取る。
 */
function derive(h, wins) {
  const races = wins.map(([, name]) => raceOf(name)).filter(Boolean);
  const dists = races.map((g) => g.distance);
  const dist = dists.length ? Math.round(dists.reduce((a, b) => a + b, 0) / dists.length / 100) * 100 : 2000;
  const spread = dists.length > 1 ? Math.max(...dists) - Math.min(...dists) : 0;
  const range = Math.max(400, Math.min(800, Math.round((300 + spread * 0.7) / 100) * 100));
  const dirt = races.filter((g) => g.surface === SURFACE.DIRT).length;
  const surf = !races.length ? 'T' : dirt === races.length ? 'D' : dirt ? 'TD' : 'T';
  // 格は「一番上の勝鞍の格」と「その格での勝ち数」と獲得賞金で。
  //
  // 走破時計は勝ち馬＝その年の最上位で決まるので、上位の層が厚くなるほど速くなる
  // （落とし穴 46）。手で入れてある馬は GI 1 勝で平均 0.822、勝鞍を持たない祖先が
  // 平均 0.660 なので、取り込みはその間に収める。
  //   GI 勝ち  0.74〜0.86 … 上げると実測レンジの下限を割る（0.78 で天皇賞(春)、0.76 でダービー）
  //   GII 勝ち 0.68〜0.78 … 重賞止まりの馬は GI 馬より確実に弱い
  //   GIII     0.66〜0.76
  // 重賞まで取り込むと「GI を勝てる格の馬」の数自体が増えるので、GI 馬の帯だけ下げても
  // 足りない。GII・GIII の帯も下げて、GI の勝ち馬を押し上げないようにする。
  const n = (g) => wins.filter((w) => w[2] === g).length;
  const g1 = n('GI'), g2 = n('GII'), g3 = n('GIII');
  const money = (h.earn ?? 0) / 10000; // 億円
  const [base, step, cap] = g1 ? [0.74, 0.015, 0.86] : g2 ? [0.68, 0.012, 0.78] : [0.66, 0.012, 0.76];
  const top = g1 || g2 || g3;                       // 一番上の格での勝ち数
  // 下の格の勝鞍は足さない。重賞まで取り込むと GI 馬の多くが GII・GIII も勝っているので、
  // 少しの加点でも上位の層が厚くなり、ダービーと菊花賞が下限を割った。
  let lvl = base + Math.min(0.06, (top - 1) * step) + Math.min(0.03, money * 0.006);
  lvl = Math.min(cap, Math.round(lvl * 100) / 100);
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

/**
 * もう表にある馬（＝引き直さない馬）。
 * ただし前回この道具が差し込んだぶんは外す。目印の間は毎回書き直すので、
 * ここに入れたままだと二度目の --write で「全部もう居る」となって領域が空になる。
 */
const KNOWN = (() => {
  const src = readFileSync(DATA_FILE, 'utf8');
  const i = src.indexOf(MARK[0]), j = src.indexOf(MARK[1]);
  const mine = new Set();
  if (i >= 0 && j > i) {
    const block = src.slice(i, j);
    for (const m of block.matchAll(/n: '([^']+)'|\['([^']+)'/g)) mine.add(m[1] ?? m[2]);
  }
  return new Set(REAL_HORSES.map((d) => d.n).filter((n) => !mine.has(n)));
})();
/**
 * 表記の読み替え。同じ馬が記事によって違うカタカナで書かれていることがある
 * （Danzig は「ダンチヒ」と「ダンジグ」の両方で出てくる）。表にある表記へ寄せる。
 * 寄せないと同じ馬が二頭に分かれ、系統の大きさとインブリードの数が狂う。
 */
const RENAME = { ダンジグ: 'ダンチヒ' };
/** 表にある馬の生年（同名の別馬を親に結ばないため）。 */
const KNOWN_B = new Map(REAL_HORSES.map((d) => [d.n, d.b]));
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
    const big = wins.map(([y, name, grade]) => `[${y}, ${q(name)}, ${q(grade ?? 'GI')}]`);
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

  // 1. 重賞の記事から (年 → 勝ち馬) を拾う。
  const races = RACES.filter((r) => GRADES.includes(r.grade))
    .filter((r) => !ONLY || ONLY.includes(r.as) || ONLY.includes(r.wiki)
      || (Array.isArray(r.as) && r.as.some(([, n]) => ONLY.includes(n))));
  const byGrade = GRADES.map((g) => `${g} ${races.filter((r) => r.grade === g).length}`).join(' / ');
  console.error(`重賞 ${races.length} 戦の記事を読む（${byGrade}、${FROM}〜${TO} 年）`);
  const texts = await wikitext([...new Set(races.map((r) => r.wiki))]);
  /** 馬名 → [[年, レース名, 格], …] */
  const winsOf = new Map();
  for (const race of races) {
    const { got, missing } = winnersOf(texts.get(race.wiki) ?? '', race);
    for (const [year, name] of got) {
      if (!winsOf.has(name)) winsOf.set(name, []);
      winsOf.get(name).push([year, raceNameAt(race, year), race.grade]);
    }
    const label = typeof race.as === 'string' ? race.as : race.as[0][1];
    console.error(`  ${race.grade.padEnd(4)} ${label.padEnd(16)} ${got.size} 勝ち馬${missing.length ? `（取れなかった年 ${missing.join(',')}）` : ''}`);
  }
  for (const w of winsOf.values()) w.sort((a, b) => a[0] - b[0]);

  // 2. 勝ち馬の記事を読む。表にもう居る馬は引かない。
  const want = [...winsOf.keys()].filter((n) => !KNOWN.has(n));
  console.error(`\n勝ち馬 ${winsOf.size} 頭のうち ${want.length} 頭が表に無い。記事を読む`);
  /** 正式な馬名 → 事実。読めなかった名は null を入れて二度引かない。 */
  const horses = new Map();
  /**
   * 引いた名 → 正式な馬名。記事の題と馬名の表記が違う馬がいる
   * （子の父は「ゴーンウエスト」、記事の馬名は「ゴーンウェスト」）。
   * 寄せずに書くと、親の名の馬が表に居なくなり、同じ馬が二度並ぶ。
   */
  const alias = new Map();
  const canonOf = (n) => {
    const a = alias.get(n) ?? n;   // 記事の馬名へ寄せる
    return RENAME[a] ?? a;         // さらに表の表記へ寄せる
  };
  const read = async (names) => {
    const fresh = [...new Set(names.map(canonOf))].filter((n) => n && !horses.has(n) && !KNOWN.has(n));
    const next = [];
    for (const n of fresh) {
      const h = await readFacts(n, winsOf.get(n)?.[0]?.[0] ?? null);
      if (!h?.b) { horses.set(n, null); continue; }
      const canon = h.n || n;
      // 記事の馬名が引いた名とまるで違うときは、別の馬の記事に転送された。
      // 自分の記事を持たない母は息子の記事へ転送されるので（ローズオブスズカ →
      // スズカフェニックス）、そのまま採ると母＝自分になり、血統が輪になって
      // 世界の生成が無限に親をたどる。読めなかったことにして、父母の側で null にする。
      if (normName(canon) !== normName(n)) { horses.set(n, null); continue; }
      if (canon !== n) alias.set(n, canon);
      // 寄せた先が表にもう居る／もう読んだ馬なら、それ以上は要らない。
      if (KNOWN.has(canon) || horses.has(canon)) continue;
      horses.set(canon, { ...h, n: canon });
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

  // 勝鞍を正式な名にまとめ直す（別名で勝った年が別の馬として残らないように）。
  const winsByName = new Map();
  for (const [name, w] of winsOf) {
    const c = canonOf(name);
    winsByName.set(c, [...(winsByName.get(c) ?? []), ...w]);
  }
  for (const w of winsByName.values()) w.sort((a, b) => a[0] - b[0]);

  // 表に無い父母を null に落とす。realsires.js は父母の名で表を引く（DEFS.get）ので、
  // たどり切れなかった親の名を残すと、その馬を作った瞬間に世界の生成が落ちる。
  // 血統表の埋まり率は落ちるが、間違った親を書くより良い（落とし穴 43）。
  const have = new Set([...KNOWN, ...[...horses].filter(([, h]) => h).map(([n]) => n)]);
  const bOf = (n) => horses.get(n)?.b ?? KNOWN_B.get(n) ?? null;
  let cut = 0, wrong = 0;
  for (const h of horses.values()) {
    if (!h) continue;
    for (const k of ['sire', 'dam']) {
      if (!h[k]) continue;
      h[k] = canonOf(h[k]);
      if (!have.has(h[k])) { h[k] = null; cut++; continue; }
      // 日本の馬名は年代をまたいで再登録される。表で同じ名を持つのが別の馬なら
      // 生年が噛み合わない（1993 年生の馬の母が「2004 年生のローブデコルテ」になる）。
      // 親子の年齢差が 2〜30 歳に収まらなければ、その親は別の馬なので結ばない。
      const gap = h.b - (bOf(h[k]) ?? -9999);
      if (!(gap >= 2 && gap <= 30)) { h[k] = null; wrong++; }
    }
  }
  if (cut) console.error(`\n表に無い父母 ${cut} 件を null にした（${DEPTH} 代で止めた先と、記事の無い海外の祖先）`);
  if (wrong) console.error(`同名の別馬だった父母 ${wrong} 件を null にした（生年が噛み合わない）`);

  // 読めなかった勝ち馬を黙って捨てない。記事の題が違う・インフォボックスが別の形、など
  // 原因は一頭ずつ違うので、名前を出して目で見るしかない（落とし穴 43）。
  const lost = [...winsOf.keys()].filter((n) => !KNOWN.has(canonOf(n)) && !horses.get(canonOf(n)));
  if (lost.length) console.error(`\n記事から読めなかった勝ち馬 ${lost.length} 頭（表に入らない）:\n  ${lost.join(' ')}`);

  // 4. 年代別に組む。
  const groups = new Map();
  for (const [name, h] of horses) {
    if (!h) continue;
    const [, , tag] = decadeOf(h.b);
    if (!groups.has(tag)) groups.set(tag, { sires: [], dams: [], runners: [] });
    const g = groups.get(tag);
    const wins = winsByName.get(name);
    if (wins) g.runners.push([h, wins]);
    else if (h.s === '牝') g.dams.push(h);
    else g.sires.push(h);
  }

  // 5. 書き出す。
  const out = [];
  for (const [, , tag] of DECADES) {
    const g = groups.get(tag);
    if (!g || !(g.runners.length + g.dams.length + g.sires.length)) continue;
    const label = tag === '70S' ? '1970 年代まで' : `${tag.slice(0, 2) < '30' ? '20' : '19'}${tag.slice(0, 2)} 年代`;
    out.push(`/** ${label}の JRA GI 勝ち馬（ja.wikipedia から取り込み）。 */`);
    if (g.sires.length) out.push(`const WIKI_${tag}_ANCESTORS = [\n${g.sires.map(emitAncestor).join('\n')}\n];\n`);
    if (g.dams.length) out.push(`const WIKI_${tag}_DAMS = [\n${g.dams.map(emitDam).join('\n')}\n].map(([n, b, sire]) => ({ n, b, s: '牝', sire }));\n`);
    out.push(`const WIKI_${tag} = [\n${g.runners.map(([h, w]) => emit(h, w)).join('\n')}\n];\n`);
  }
  const spread = DECADES.map(([, , tag]) => {
    const g = groups.get(tag);
    if (!g || !(g.runners.length + g.dams.length + g.sires.length)) return null;
    const parts = [];
    if (g.sires.length) parts.push(`...WIKI_${tag}_ANCESTORS.map(bg)`);
    if (g.dams.length) parts.push(`...WIKI_${tag}_DAMS.map(bg)`);
    if (g.runners.length) parts.push(`...WIKI_${tag}`);
    return `  ${parts.join(', ')},`;
  }).filter(Boolean).join('\n');

  const n = [...groups.values()].reduce((a, g) => a + g.runners.length + g.dams.length + g.sires.length, 0);
  console.error(`\n${n} 頭を書き出す（勝ち馬 ${[...groups.values()].reduce((a, g) => a + g.runners.length, 0)} 頭＋祖先）`);
  if (flag('--report')) report(groups);

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
  const B = MARK;
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
function report(groups) {
  console.error('\n--- 導いた値（ウィキペディアに無い項目） ---');
  for (const g of groups.values()) {
    for (const [h, wins] of g.runners) {
      const d = derive(h, wins);
      const cnt = ['GI', 'GII', 'GIII'].map((g) => `${g}${wins.filter((w) => w[2] === g).length}`).join('/');
      console.error(`${h.n.padEnd(14)} lvl ${d.lvl.toFixed(2)}  ${d.surf.padEnd(2)} ${String(d.dist).padStart(4)}m ±${d.range}  ${d.style}  ${cnt.padEnd(12)} ${wins.map(([y, r]) => `${y}${r}`).join(' ')}`);
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
    for (const d of batch) {
      const h = await readFacts(d.n, (d.big ?? [])[0]?.[0] ?? null);
      if (!h) { console.error(`? ${d.n} — 記事が無い`); bad++; continue; }
      const diff = [];
      const parent = (n) => RENAME[n] ?? n;   // 表の表記に寄せてから比べる
      if (h.b && h.b !== d.b) diff.push(`生年 ${d.b} → ${h.b}`);
      if (h.sire && d.sire && parent(h.sire) !== d.sire) diff.push(`父 ${d.sire} → ${h.sire}`);
      if (h.dam && d.dam && parent(h.dam) !== d.dam) diff.push(`母 ${d.dam} → ${h.dam}`);
      // セン馬は表に区分が無く、牡として持つ（世界も牡として作る）ので食い違いにしない。
      if (h.s !== (d.s ?? '牡') && !(h.s === 'セン' && (d.s ?? '牡') === '牡')) diff.push(`性 ${d.s ?? '牡'} → ${h.s}`);
      if (h.c && h.c !== (d.c ?? '鹿毛')) diff.push(`毛 ${d.c ?? '鹿毛'} → ${h.c}`);
      if (diff.length) { console.error(`! ${d.n} — ${diff.join(' / ')}`); bad++; }
    }
  }
  console.error(bad ? `\n${bad} 頭に食い違い` : '\n食い違い無し');
}

main().catch((e) => { console.error(`\n失敗: ${e.message}`); process.exit(1); });
