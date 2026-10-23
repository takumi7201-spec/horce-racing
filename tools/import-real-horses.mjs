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
import { createHash } from 'node:crypto';
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

// グレード制が始まった年。これより前は格が無いので、span（格の期間）では切らない。
const GRADE_ERA = 1984;
// 既定の下限は第 1 回東京優駿の年。目印の間は毎回まるごと書き直すので、
// 既定を 1984 年にしておくと、引数なしで流しただけで昭和の重賞が消える。
const FROM = num('--from', 1932);
const TO = num('--to', new Date().getFullYear());
const CACHE = resolve(ROOT, opt('--cache', '.cache/wiki'));
const OFFLINE = flag('--offline');
const DEPTH = num('--depth', 4);        // 父母を何代さかのぼるか
const ONLY = opt('--races', null)?.split(',').map((s) => s.trim());
const GRADES = opt('--grades', 'GI,JpnI,GII,JpnII,GIII,JpnIII').split(',').map((s) => s.trim());
// 取り込む系統。jra：中央の重賞 / nar：地方のダートグレード / os：海外の G1
const KINDS = opt('--kinds', 'jra,nar,os').split(',').map((s) => s.trim());
const DELAY = num('--delay', 200);      // 取得の間隔（ms）

/* ------------------------------------------------------------------ 取得 */

mkdirSync(CACHE, { recursive: true });
// ファイル名は 255 バイトまで。「サンシャインミリオンズフィリー&メアスプリントステークス」のような長い題は
// エンコードすると超えるので、頭を残してハッシュを付ける（短い題は今までのまま）。
const cachePath = (title) => {
  const name = encodeURIComponent(title).replace(/\*/g, '%2A');
  const file = name.length <= 180 ? name : `${name.slice(0, 120)}-${createHash('sha1').update(title).digest('hex').slice(0, 16)}`;
  return join(CACHE, `${file}.txt`);
};

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

/**
 * 地方競馬のダートグレード競走（2025 年の格付け。ja.wikipedia「ダートグレード競走」の一覧から）。
 *
 * これらは番組表（schedule.js）に無いので、距離は各記事のインフォボックスから読んで
 * registerRace() で足す（馬場はすべてダート）。格は今の格付けをそのまま書く。
 *
 * 窓は 1995 年から。この年に中央・地方の全国指定交流が始まり、JRA の馬と走るようになった。
 * それ以前の東京大賞典や羽田盃は地方限定の競走なので採らない。ただし羽田盃・東京ダービーの
 * ように 2024 年に JpnI になった競走は、南関東クラシック時代（1995〜2023 年）の勝ち馬も入る。
 * 実在の馬である点は変わらないので、そこは割り切っている。
 */
const NAR_RACES = [
  // 地方・GI（国際格付け）
  ['東京大賞典', 'GI'],
  // 地方・JpnI
  ['川崎記念', 'JpnI'], ['羽田盃', 'JpnI'], ['かしわ記念', 'JpnI'],
  ['東京ダービー (競馬)|東京ダービー', 'JpnI'], ['さきたま杯', 'JpnI'], ['帝王賞', 'JpnI'],
  ['ジャパンダートクラシック', 'JpnI'], ['マイルチャンピオンシップ南部杯', 'JpnI'],
  ['JBCレディスクラシック', 'JpnI'], ['JBCスプリント', 'JpnI'], ['JBCクラシック', 'JpnI'],
  ['全日本2歳優駿', 'JpnI'],
  // 地方・JpnII
  ['ダイオライト記念', 'JpnII'], ['京浜盃', 'JpnII'], ['兵庫チャンピオンシップ', 'JpnII'],
  ['名古屋グランプリ', 'JpnII'], ['エンプレス杯', 'JpnII'], ['関東オークス', 'JpnII'],
  ['不来方賞', 'JpnII'], ['日本テレビ盃', 'JpnII'], ['東京盃', 'JpnII'],
  ['レディスプレリュード', 'JpnII'], ['浦和記念', 'JpnII'], ['兵庫ジュニアグランプリ', 'JpnII'],
  // 地方・JpnIII
  ['ブルーバードカップ', 'JpnIII'], ['佐賀記念', 'JpnIII'], ['クイーン賞', 'JpnIII'],
  ['雲取賞', 'JpnIII'], ['かきつばた記念', 'JpnIII'], ['黒船賞', 'JpnIII'],
  ['兵庫女王盃', 'JpnIII'], ['東京スプリント', 'JpnIII'], ['スパーキングレディーカップ', 'JpnIII'],
  ['マーキュリーカップ', 'JpnIII'], ['クラスターカップ', 'JpnIII'], ['北海道スプリントカップ', 'JpnIII'],
  ['ブリーダーズゴールドカップ', 'JpnIII'], ['サマーチャンピオン', 'JpnIII'], ['オーバルスプリント', 'JpnIII'],
  ['マリーンカップ', 'JpnIII'], ['白山大賞典', 'JpnIII'], ['エーデルワイス賞', 'JpnIII'],
  ['JBC2歳優駿', 'JpnIII'], ['名古屋大賞典', 'JpnIII'], ['兵庫ゴールドトロフィー', 'JpnIII'],
].map(([entry, grade]) => {
  const [wiki, as] = entry.includes('|') ? entry.split('|') : [entry, entry];
  // nar：1984 年より前の窓を使わない（地方限定だった時代を拾わないため）。
  return { wiki, as, grade, span: [1995, null], nar: true };
});

/**
 * 海外の G1（凱旋門賞・英愛仏のクラシック・BC・ケンタッキーダービー・ドバイ・香港・豪州）。
 *
 * [記事名, 勝鞍に書くレース名]。海外馬は英語名で載る表が多いので、勝ち馬の名は
 * 英語名に付いたリンクの先（日本語の記事名）か、「日本語読み」列から取る（abroadHorse）。
 * リンクも読みも無い年（日本語の記事が無い馬）は、取れないものとして飛ばす。
 *
 * 窓は JRA と同じ 1932 年から。格は今の G1 をそのまま書く（古い年の勝ち馬も G1 馬として扱う）。
 * 外してあるもの：フォワ賞（G2）、ドンカスターマイル（優勝馬の表が無い）、
 * ウッドワードS（記事が短く優勝馬の節が無い）。
 */
const OS_RACES = [
  ['凱旋門賞'], ['ダービーステークス', '英ダービー'], ['2000ギニー', '英2000ギニー'],
  ['1000ギニー', '英1000ギニー'], ['オークスステークス', '英オークス'], ['セントレジャーステークス', 'セントレジャー'],
  ['キングジョージ6世&クイーンエリザベスステークス', 'キングジョージ'], ['エクリプスステークス', 'エクリプスS'],
  ['チャンピオンステークス', '英チャンピオンS'], ['クイーンエリザベス2世ステークス', 'QE2世S'],
  ['サセックスステークス', 'サセックスS'], ['コロネーションカップ', 'コロネーションC'],
  ['アイリッシュダービー', '愛ダービー'], ['ジョッケクルブ賞', '仏ダービー'], ['ディアヌ賞', '仏オークス'],
  ['ジャック・ル・マロワ賞', 'ジャックルマロワ賞'], ['ムーラン・ド・ロンシャン賞', 'ムーランドロンシャン賞'],
  ['サンクルー大賞'], ['ロワイヤルオーク賞'],
  ['ケンタッキーダービー'], ['プリークネスステークス', 'プリークネスS'], ['ベルモントステークス', 'ベルモントS'],
  ['ブリーダーズカップ・クラシック', 'BCクラシック'], ['ブリーダーズカップ・ターフ', 'BCターフ'],
  ['ブリーダーズカップ・マイル', 'BCマイル'], ['ブリーダーズカップ・スプリント', 'BCスプリント'],
  ['ブリーダーズカップ・ジュベナイル', 'BCジュベナイル'], ['ブリーダーズカップ・ディスタフ', 'BCディスタフ'],
  ['ブリーダーズカップ・フィリー&メアターフ', 'BCフィリー&メアターフ'],
  ['ブリーダーズカップ・ジュベナイルフィリーズ', 'BCジュベナイルフィリーズ'],
  ['ペガサスワールドカップ'], ['トラヴァーズステークス', 'トラヴァーズS'], ['ハスケルステークス', 'ハスケル招待S'],
  ['ドバイワールドカップ'], ['ドバイシーマクラシック'], ['ドバイターフ'], ['ドバイゴールデンシャヒーン'],
  ['サウジカップ'],
  ['香港カップ'], ['香港ヴァーズ'], ['香港マイル'], ['香港スプリント'],
  ['クイーンエリザベス2世カップ (香港)', 'QE2世C(香港)'],
  ['コックスプレート'], ['メルボルンカップ'], ['ジ・エベレスト'], ['オーストラリアンダービー', '豪ダービー'],
  ['シンガポール航空国際カップ'],
].map(([wiki, as = wiki]) => ({ wiki, as, grade: 'GI', span: [1932, null], abroad: true }));

/**
 * 海外の重賞（カテゴリ「○○の競馬の競走」にある記事のうち、格付けが G1〜G3 で優勝馬の表があるもの）。
 * [記事名, 格]。上の OS_RACES（G1 の主要競走）と同じ記事になるものは含めない。
 */
const OS_GRADED = [
  // === OS_GRADED ここから（race discovery で生成。カテゴリの格付けと優勝馬の表から） ===
  // アイルランド（17 戦）
  ['アイリッシュ1000ギニー', 'GI'],
  ['アイリッシュ2000ギニー', 'GI'],
  ['アイリッシュオークス', 'GI'],
  ['アイリッシュセントレジャー', 'GI'],
  ['アイリッシュチャンピオンステークス', 'GI'],
  ['タタソールズゴールドカップ', 'GI'],
  ['チャンピオンズジュベナイルステークス', 'GI'],
  ['フェニックスステークス', 'GI'],
  ['フライングファイブステークス', 'GI'],
  ['プリティーポリーステークス', 'GI'],
  ['メイトロンステークス (アイルランド)', 'GI'],
  ['モイグレアスタッドステークス', 'GI'],
  ['ヴィンセントオブライエンステークス', 'GI'],
  ['デビュタントステークス (アイルランド)', 'GII'],
  ['ムーアズブリッジステークス', 'GII'],
  ['アイリッシュダービートライアルステークス', 'GIII'],
  ['レパーズタウン1000ギニートライアルステークス', 'GIII'],
  // アメリカ（117 戦）
  ['H・アレン・ジャーケンスメモリアルステークス', 'GI'],
  ['アッシュランドステークス', 'GI'],
  ['アップルブロッサムハンデキャップ', 'GI'],
  ['アメリカンオークスステークス', 'GI'],
  ['アメリカンターフステークス', 'GI'],
  ['アメリカンファラオステークス', 'GI'],
  ['アラバマステークス', 'GI'],
  ['アルシバイアディーズステークス', 'GI'],
  ['アーカンソーダービー', 'GI'],
  ['アーリントンミリオンステークス', 'GI'],
  ['エイコーンステークス', 'GI'],
  ['オグデンフィップスステークス', 'GI'],
  ['オールドフォレスター・ターフクラシックステークス', 'GI'],
  ['キーンランドターフマイルステークス', 'GI'],
  ['クイーンエリザベス2世チャレンジカップステークス', 'GI'],
  ['クレメント・L・ハーシュステークス', 'GI'],
  ['グッドウッドステークス', 'GI'],
  ['ケンタッキーオークス', 'GI'],
  ['ゲイムリーステークス', 'GI'],
  ['コティリオンステークス', 'GI'],
  ['コーチングクラブアメリカンオークス', 'GI'],
  ['サンタアニタダービー', 'GI'],
  ['サンタアニタハンデキャップ', 'GI'],
  ['シャンペンステークス (アメリカ合衆国)', 'GI'],
  ['ジョッキークラブゴールドカップ', 'GI'],
  ['ジョーハーシュ・ターフクラシックステークス', 'GI'],
  ['スティーブンフォスターハンデキャップ', 'GI'],
  ['スピナウェイステークス', 'GI'],
  ['スピンスターステークス', 'GI'],
  ['ソードダンサーステークス', 'GI'],
  ['ダービーシティディスタフステークス', 'GI'],
  ['チャーチルダウンズステークス', 'GI'],
  ['テストステークス', 'GI'],
  ['デルマーオークス', 'GI'],
  ['デルマーデビュータントステークス', 'GI'],
  ['デルマーフューチュリティステークス', 'GI'],
  ['ドンハンデキャップ', 'GI'],
  ['ニューヨークステークス', 'GI'],
  ['ハリウッドダービー', 'GI'],
  ['バレリーナハンデキャップ', 'GI'],
  ['パシフィッククラシックステークス', 'GI'],
  ['パーソナルエンスンステークス', 'GI'],
  ['ビホルダーマイルステークス', 'GI'],
  ['ビングクロスビーステークス', 'GI'],
  ['ファーストレディステークス', 'GI'],
  ['フォアゴーステークス', 'GI'],
  ['フリゼットステークス', 'GI'],
  ['フロリダダービー', 'GI'],
  ['ブリーダーズカップ・ジュヴェナイルターフ', 'GI'],
  ['ブリーダーズカップ・ジュヴェナイルターフスプリント', 'GI'],
  ['ブリーダーズカップ・ジュヴェナイルフィリーズターフ', 'GI'],
  ['ブリーダーズカップ・ターフスプリント', 'GI'],
  ['ブリーダーズカップ・ダートマイル', 'GI'],
  ['ブリーダーズカップ・フィリー&メアスプリント', 'GI'],
  ['ブリーダーズフューチュリティステークス', 'GI'],
  ['ブルーグラスステークス', 'GI'],
  ['ベルモントダービーインビテーショナルステークス', 'GI'],
  ['ペガサスワールドカップターフ', 'GI'],
  ['ペンシルベニアダービー', 'GI'],
  ['ホイットニーステークス', 'GI'],
  ['マディソンステークス', 'GI'],
  ['マリブステークス', 'GI'],
  ['メトロポリタンハンデキャップ (アメリカ合衆国)', 'GI'],
  ['メーカーズマークマイルステークス', 'GI'],
  ['メートリアークステークス', 'GI'],
  ['ラブレアステークス', 'GI'],
  ['レディースターフスプリントステークス', 'GI'],
  ['ワシントンDCインターナショナル', 'GI'],
  ['アメリカ競馬名誉の殿堂博物館ステークス', 'GII'],
  ['ウッドメモリアルステークス', 'GII'],
  ['ウッドワードステークス', 'GII'],
  ['エディーリードステークス', 'GII'],
  ['オークローンハンデキャップ', 'GII'],
  ['クラークステークス', 'GII'],
  ['サバーバンハンデキャップ', 'GII'],
  ['サラトガブリーダーズカップハンデキャップ', 'GII'],
  ['サンタアニタオークス', 'GII'],
  ['サンタアニタスプリントチャンピオンシップステークス', 'GII'],
  ['サンタマリアハンデキャップ', 'GII'],
  ['サンタモニカステークス', 'GII'],
  ['サンフェリペステークス', 'GII'],
  ['シガーマイルハンデキャップ', 'GII'],
  ['シャンデリアステークス', 'GII'],
  ['シュヴィーハンデキャップ', 'GII'],
  ['ジムダンディステークス', 'GII'],
  ['スターレットステークス', 'GII'],
  ['ストラブステークス', 'GII'],
  ['ゼニヤッタステークス', 'GII'],
  ['ディキシーステークス', 'GII'],
  ['ニューオリンズハンデキャップ', 'GII'],
  ['ハリウッドゴールドカップステークス', 'GII'],
  ['ハリウッドターフカップステークス', 'GII'],
  ['パットオブライエンハンデキャップ', 'GII'],
  ['ビヴァリーD・ステークス', 'GII'],
  ['フラワーボウルステークス', 'GII'],
  ['フランク・E・キルローマイルハンデキャップ', 'GII'],
  ['ブラックアイドスーザンステークス', 'GII'],
  ['ブルックリンハンデキャップ', 'GII'],
  ['ベルデイムステークス', 'GII'],
  ['マンノウォーステークス', 'GII'],
  ['ユナイテッドネイションズステークス', 'GII'],
  ['ラフィアンステークス', 'GII'],
  ['ロスアラミトスフューチュリティ', 'GII'],
  ['ロデオドライブステークス', 'GII'],
  ['カリフォルニアンステークス', 'GIII'],
  ['ガゼルステークス', 'GIII'],
  ['サンフアンカピストラーノインビテーショナルハンデキャップ', 'GIII'],
  ['スーパーダービー', 'GIII'],
  ['ヒルプリンスステークス', 'GIII'],
  ['ピムリコスペシャル', 'GIII'],
  ['ピーターパンステークス', 'GIII'],
  ['フランク・J・ドフランシス記念ダッシュステークス', 'GIII'],
  ['マットウィンステークス', 'GIII'],
  ['メイトロンステークス (アメリカ合衆国)', 'GIII'],
  ['ロイヤルヒロインマイルステークス', 'GIII'],
  ['ローレンスリアライゼーションハンデキャップ', 'GIII'],
  ['ヴォスバーグステークス', 'GIII'],
  // UAE（16 戦）
  ['アルクオーツスプリント', 'GI'],
  ['ジェベルハッタ', 'GI'],
  ['マクトゥームチャレンジ (競馬のレース)', 'GI'],
  ['UAEダービー', 'GII'],
  ['アルファヒディフォート', 'GII'],
  ['ケープヴェルディステークス', 'GII'],
  ['ゴドルフィンマイル', 'GII'],
  ['ザビールマイル', 'GII'],
  ['ドバイゴールドカップ', 'GII'],
  ['ドバイシティーオブゴールド', 'GII'],
  ['バランシーンステークス (アラブ首長国連邦)', 'GII'],
  ['UAE2000ギニー', 'GIII'],
  ['UAEオークス', 'GIII'],
  ['ドバイミレニアムステークス', 'GIII'],
  ['バージナハール', 'GIII'],
  ['マハーブアルシマール', 'GIII'],
  // イギリス（61 戦）
  ['インターナショナルステークス', 'GI'],
  ['キングチャールズ3世ステークス (イギリス)', 'GI'],
  ['クイーンアンステークス', 'GI'],
  ['クイーンエリザベス2世ジュビリーステークス', 'GI'],
  ['グッドウッドカップ', 'GI'],
  ['コモンウェルスカップ (競馬)', 'GI'],
  ['コロネーションステークス', 'GI'],
  ['ゴールドカップ', 'GI'],
  ['シティオブヨークステークス', 'GI'],
  ['ジュライカップ', 'GI'],
  ['スプリントカップ', 'GI'],
  ['セントジェームズパレスステークス', 'GI'],
  ['チェルトナムゴールドカップ', 'GI'],
  ['チャンピオンハードル', 'GI'],
  ['デューハーストステークス', 'GI'],
  ['ナンソープステークス', 'GI'],
  ['フィリーズマイル', 'GI'],
  ['フューチュリティトロフィー', 'GI'],
  ['プリンスオブウェールズステークス (イギリス)', 'GI'],
  ['ミドルパークステークス', 'GI'],
  ['ヨークシャーオークス', 'GI'],
  ['ロッキンジステークス', 'GI'],
  ['キングエドワード7世ステークス', 'GII'],
  ['キングジョージステークス', 'GII'],
  ['クイーンズヴェース', 'GII'],
  ['グレートヴォルティジュールステークス', 'GII'],
  ['コヴェントリーステークス', 'GII'],
  ['サンディレーンステークス', 'GII'],
  ['シャンペンステークス (イギリス)', 'GII'],
  ['ジムクラックステークス', 'GII'],
  ['ジュライステークス', 'GII'],
  ['ジョッキークラブステークス', 'GII'],
  ['ダンテステークス', 'GII'],
  ['チャレンジステークス', 'GII'],
  ['ドンカスターカップ', 'GII'],
  ['ハンガーフォードステークス', 'GII'],
  ['ハードウィックステークス', 'GII'],
  ['フライングチルダーズステークス', 'GII'],
  ['ヨークシャーカップ', 'GII'],
  ['リッチモンドステークス', 'GII'],
  ['リブルスデールステークス', 'GII'],
  ['ロンズデールカップ', 'GII'],
  ['2000ギニートライアルステークス', 'GIII'],
  ['アールオブセフトンステークス', 'GIII'],
  ['クレイヴンステークス', 'GIII'],
  ['グリーナムステークス', 'GIII'],
  ['コーンウォリスステークス', 'GIII'],
  ['ゴードンステークス', 'GIII'],
  ['ゴードンリチャーズステークス', 'GIII'],
  ['ジェフリーフリアステークス', 'GIII'],
  ['ジョンポーターステークス', 'GIII'],
  ['スコティッシュグランドナショナル', 'GIII'],
  ['セレクトステークス', 'GIII'],
  ['チェスターヴェース', 'GIII'],
  ['ネルグウィンステークス', 'GIII'],
  ['ハンプトンコートステークス', 'GIII'],
  ['バーレーントロフィー', 'GIII'],
  ['パレスハウスステークス', 'GIII'],
  ['フレッドダーリンステークス', 'GIII'],
  ['ブルーリバンドトライアルステークス', 'GIII'],
  ['プリンセスエリザベスステークス (イギリス)', 'GIII'],
  // イタリア（2 戦）
  ['デルビーイタリアーノ', 'GII'],
  ['グランクリテリウム (イタリア)', 'GIII'],
  // オーストラリア（22 戦）
  ['TJスミスステークス', 'GI'],
  ['ウィリアム・レイドステークス', 'GI'],
  ['オールエイジドステークス', 'GI'],
  ['クイーンエリザベスステークス (ATC)', 'GI'],
  ['クラウンオークス', 'GI'],
  ['コーフィールドカップ', 'GI'],
  ['コーフィールドギニー', 'GI'],
  ['ゴールデンイーグル (競馬の競走)', 'GI'],
  ['ゴールデンスリッパーステークス', 'GI'],
  ['ジ・オールスターマイル', 'GI'],
  ['タンクレッドステークス', 'GI'],
  ['ターンブルステークス', 'GI'],
  ['チャンピオンズステークス', 'GI'],
  ['チャンピオンズスプリント', 'GI'],
  ['ドンカスターハンデキャップ', 'GI'],
  ['ニューマーケットハンデキャップ', 'GI'],
  ['フューチュリティステークス (オーストラリア)', 'GI'],
  ['フライトステークス', 'GI'],
  ['ブラックキャビアライトニング', 'GI'],
  ['ヴィクトリアダービー', 'GI'],
  ['アポロステークス', 'GII'],
  ['トッドマンステークス', 'GII'],
  // カナダ（4 戦）
  ['E.P.テイラーステークス', 'GI'],
  ['ウッドバインマイル', 'GI'],
  ['カナディアンインターナショナルステークス', 'GI'],
  ['ノーザンダンサーターフステークス', 'GI'],
  // シンガポール（17 戦）
  ['クリスフライヤーインターナショナルスプリント', 'GI'],
  ['シンガポールダービー', 'GI'],
  ['パトロンズボウル', 'GI'],
  ['ライオンシティカップ', 'GI'],
  ['ラッフルズカップ', 'GI'],
  ['シンガポールダービートライアル', 'GII'],
  ['ウッドランズハンディキャップ', 'GIII'],
  ['エルドラドクラシック', 'GIII'],
  ['ガーデンシティトロフィー', 'GIII'],
  ['クランジスプリント', 'GIII'],
  ['コロニアルチーフステークス', 'GIII'],
  ['シンガポール3歳スプリント', 'GIII'],
  ['フォーチュンボウル', 'GIII'],
  ['ポリトラックマイルチャンピオンシップ', 'GIII'],
  ['マーシリングクラシックステークス', 'GIII'],
  ['マーライオントロフィー', 'GIII'],
  ['ムーンビームヴァーズ', 'GIII'],
  // ドイツ（9 戦）
  ['オイロパ賞', 'GI'],
  ['ディアナ賞', 'GI'],
  ['ドイチェスダービー', 'GI'],
  ['バイエルンツフトレネン', 'GI'],
  ['バイエルン大賞', 'GI'],
  ['バーデン大賞', 'GI'],
  ['ベルリン大賞', 'GI'],
  ['ウニオンレネン', 'GII'],
  ['ハンザ賞', 'GII'],
  // ニュージーランド（4 戦）
  ['ニュージーランドオークス', 'GI'],
  ['ニュージーランドダービー', 'GI'],
  ['オークランドカップ', 'GII'],
  ['ウェリントンカップ', 'GIII'],
  // フランス（40 戦）
  ['アガ・カーン4世賞', 'GI'],
  ['アベイ・ド・ロンシャン賞', 'GI'],
  ['オペラ賞', 'GI'],
  ['カドラン賞', 'GI'],
  ['ガネー賞', 'GI'],
  ['クリテリウムドサンクルー', 'GI'],
  ['クリテリウム・アンテルナシオナル (競馬のレース)', 'GI'],
  ['サラマンドル賞', 'GI'],
  ['ジャンプラ賞', 'GI'],
  ['ジャンロマネ賞', 'GI'],
  ['ジャン・リュック・ラガルデール賞', 'GI'],
  ['パリ大賞典', 'GI'],
  ['パリ大障害', 'GI'],
  ['フォレ賞', 'GI'],
  ['プール・デッセ・デ・プーラン', 'GI'],
  ['プール・デッセ・デ・プーリッシュ', 'GI'],
  ['マルセルブサック賞', 'GI'],
  ['モルニ賞', 'GI'],
  ['モーリス・ド・ゲスト賞', 'GI'],
  ['ラエ・ジュスラン賞', 'GI'],
  ['リュパン賞', 'GI'],
  ['ロートシルト賞', 'GI'],
  ['ヴェルメイユ賞', 'GI'],
  ['アルクール賞', 'GII'],
  ['ウジェーヌアダム賞', 'GII'],
  ['ギヨームドルナノ賞', 'GII'],
  ['サンタラリ賞', 'GII'],
  ['シャンティイ大賞', 'GII'],
  ['ショードネイ賞', 'GII'],
  ['ダニエルウィルデンシュタイン賞', 'GII'],
  ['ダリュー賞', 'GII'],
  ['ドラール賞', 'GII'],
  ['ドーヴィル大賞典', 'GII'],
  ['ニエル賞', 'GII'],
  ['フォワ賞', 'GII'],
  ['ロベールパパン賞', 'GII'],
  ['オカール賞', 'GIII'],
  ['グラディアトゥール賞', 'GIII'],
  ['グレフュール賞', 'GIII'],
  ['ノアイユ賞', 'GIII'],
  // 韓国（5 戦）
  ['グランプリ (韓国競馬)', 'GI'],
  ['コリアンダービー', 'GI'],
  ['コリアカップ (競馬)', 'GII'],
  ['コリアンオークス', 'GII'],
  ['コリアスプリント', 'GIII'],
  // 香港（12 戦）
  ['クイーンズシルヴァージュビリーカップ', 'GI'],
  ['センテナリースプリントカップ', 'GI'],
  ['チェアマンズスプリントプライズ', 'GI'],
  ['チャンピオンズ&チャターカップ', 'GI'],
  ['チャンピオンズマイル', 'GI'],
  ['香港ゴールドカップ', 'GI'],
  ['香港スチュワーズカップ', 'GI'],
  ['シャティントロフィー', 'GII'],
  ['ジョッキークラブカップ', 'GII'],
  ['ジョッキークラブスプリント', 'GII'],
  ['ジョッキークラブマイル', 'GII'],
  ['プレミアボウル', 'GII'],
  // === OS_GRADED ここまで ===
].map(([wiki, grade]) => ({
  wiki, as: wiki.replace(/\s+\(/, '('), grade, span: [1932, null], abroad: true,
}));

/** 距離を記事から読めない競走の手当て。[距離, 'T' 芝 | 'D' ダート]。 */
const DIST_FIX = { 'ハスケル招待S': [1800, 'D'] };   // 距離の欄が {{frac}} で壊れている

/** 取り込む対象のレース。--grades・--kinds で絞れる。 */
const RACES = [...GI_RACES.map((r) => ({ ...r, grade: 'GI' })), ...G23_RACES, ...NAR_RACES, ...OS_RACES, ...OS_GRADED];
const OS_NAMES = new Set([...OS_RACES, ...OS_GRADED].map((r) => r.as));
const kindOf = (r) => (r.abroad ? 'os' : r.nar ? 'nar' : 'jra');

/** その年のレース名（名が変わったレースのため）。 */
function raceNameAt(race, year) {
  if (typeof race.as === 'string') return race.as;
  for (const [from, name] of race.as) if (year >= from) return name;
  return race.as[race.as.length - 1][1];
}

/**
 * 表のセルから中身だけを取る。wikitext のセルは「| 属性 | 中身」と書けるので、
 * `|style="white-space:nowrap"|[[トーホウエンペラー]]` のような行があり、
 * 属性を剥がさないと馬名の判定に引っかからない（2001 年の東京大賞典が落ちていた）。
 */
function cellBody(cell) {
  // 「2000m|||[[ワコーチカコ]]」のように区切りが一本多い行があるので、頭の | も落とす。
  const c = cell.trim().replace(/^\|+/, '').trim();
  const i = c.indexOf('|');
  if (i < 0) return c;
  const head = c.slice(0, i);
  // 属性の側は「name=value」の形で、リンクやテンプレートを含まない。
  if (/=/.test(head) && !/[[{]/.test(head)) return c.slice(i + 1).trim();
  return c;
}

/**
 * 海外のレースの表から馬名を取る。馬は英語名で載る表と片仮名で載る表があり、
 *   - 英語名にリンクが付いている（`[[セクレタリアト|Secretariat]]`）… リンク先が日本語の記事名
 *   - 片仮名の名前（`[[スタディオブマン]]`、凱旋門賞・BC・香港の「日本語読み」列）… そのまま
 * 日本語の記事が無い馬（英語名のままでリンクも無い）は取れない。
 *
 * 見るのは日付のセルの直後の 2 セルだけ（呼び出し側）。それより後ろの列は騎手・調教師・馬主で、
 * 片仮名のものが多く（ゴドルフィン、クールモア）、馬が英語名のままの年にそれを馬にしてしまう。
 * 英語名のリンクは、ラベルが英字だけで頭文字形（`L.Dettori`）でないものに絞る（騎手を除く）。
 */
const STOP = new Set(['アメリカ', 'イギリス', 'アイルランド', 'フランス', 'ドイツ', 'イタリア', 'オーストラリア',
  'ニュージーランド', 'シンガポール', 'ロンシャン', 'シャンティイ', 'エプソム', 'アスコット', 'ニューマーケット']);
const KANA = /^[ァ-ヴー]{2,20}$/;
function abroadHorse(cells) {
  for (const cell of cells) {
    for (const m of cell.matchAll(/\[\[([^\]|#]+)\|([^\]]+)\]\]/g)) {
      const label = m[2].trim();
      if (!/^[A-Za-z][A-Za-z'’.\-\s&]*$/.test(label) || /^[A-Z]\.\s?[A-Za-z]/.test(label)) continue;
      const target = m[1].trim();
      const base = target.replace(/\s*[(（].*$/, '');
      if (KANA.test(base) && !STOP.has(base)) return { name: base, title: target };
    }
    // 片仮名の馬名。リンクが付いていても、赤リンク（{{仮リンク|ラファ (競走馬)|…}}）でもよい。
    // 外国産馬の印（＊）と、題の括弧（競走馬）は馬名の一部ではない。
    // 「Megahertz<br />メガヘルツ」のように英語名と片仮名が改行で並ぶセルは、部分ごとに見る。
    for (const part of cell.split(/<br\s*\/?>/i)) {
      const t = plain(part).replace(/^[＊*]\s*/, '').replace(/\s*[(（][^)）]*[)）]\s*$/, '');
      if (KANA.test(t) && !STOP.has(t)) {
        const link = /\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/.exec(part);
        return { name: t, title: link ? link[1].trim() : null };
      }
    }
  }
  return null;
}
/**
 * 海外の表の日付のセル。先頭 3 セルのうち 4 桁の年を含むもの。米国の記事は「2026」とだけ書き、
 * 「年」を付けない（ブルーグラスS・フロリダダービー）。タイム（1:49.58）や賞金（2,000,000）の
 * 数字を年と取り違えないよう、前後が数字・コロン・カンマ・小数点のものは除く。
 * 無ければ「○○年」の形を全セルから探す（日本の表と同じ）。
 */
function dateCellOf(cells) {
  for (let i = 0; i < Math.min(3, cells.length); i++) {
    const m = /(?<![\d.,:])(19\d\d|20\d\d)(?![\d,:]|\.\d)/.exec(plain(cells[i]));
    if (m) return { index: i, year: Number(m[1]) };
  }
  const i = cells.findIndex((c) => /(19\d\d|20\d\d)年/.test(c));
  return i < 0 ? null : { index: i, year: Number(/(19\d\d|20\d\d)年/.exec(cells[i])[1]) };
}

/** 勝ち馬の名 → 記事の題（リンク先）。同名の別の記事や曖昧さ回避ページを引かないため。 */
const HINT = new Map();

/** 記事を見出しで切る。節ごとに勝ち馬の表を探すため。 */
function sections(text) {
  const out = [{ head: '', body: '', level: 0 }];
  for (const line of text.split('\n')) {
    const m = /^(={2,})\s*(.*?)\s*\1\s*$/.exec(line);
    if (m) out.push({ head: m[2], body: '', level: m[1].length });
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
  const hi = Math.min(to ?? TO, TO);
  // 年の窓は二つ。
  //   1984 年より前 … グレード制が無く、番組に載っていれば重賞だった。記事の表にある年をそのまま採る
  //   1984 年以降   … span（そのレースがその格だった期間）のとおり
  // 一つの窓で済ませようとすると、フェブラリーSの GIII 時代（1984〜96）が GI になる。
  const lo = race.nar ? from : Math.max(from, GRADE_ERA);
  // 地方のダートグレードは span（交流が始まった年から）だけで切る。
  const wanted = (y) => (race.nar ? y >= lo && y <= hi
    : y < GRADE_ERA ? y >= FROM : y >= lo && y <= hi);
  const got = new Map();
  let parentLevel = null;   // 優勝馬の節の見出しの深さ（海外の下位の節を読むため）
  for (const sec of sections(text)) {
    let ok = race.sect ? race.sect.test(sec.head) : /歴代|優勝馬|勝ち馬|結果/.test(sec.head);
    if (ok) parentLevel = sec.level;
    // フランスの記事は「歴代優勝馬」の下に「ジョッケクルブ賞（1836年-2004年）」のような期間ごとの
    // 節があり、表はそちらにある。日本馬の成績の節は除く（同じ形の表で、勝ち馬ではなく着順が並ぶ）。
    else if (race.abroad && parentLevel != null && sec.level > parentLevel && !/日本|出走|成績/.test(sec.head)) ok = true;
    else parentLevel = null;
    if (!ok) continue;
    // 「2005年までの優勝馬」「オープン特別時代の歴代優勝馬」は重賞になる前の表。
    // 拾うと、オープン特別を勝っただけの馬が GIII 勝ち馬として表に入る
    // （キーンランドCは 2006 年から、富士Sは 1998 年から、青葉賞は 1994 年から重賞）。
    // 海外のレースでは「2011年までの優勝馬」は期間で割っただけの表なので除かない。
    if (!race.abroad && /年までの優勝馬|オープン特別|格付け前/.test(sec.head)) continue;
    for (const row of sec.body.split(/\n\s*\|-/)) {
      const cells = row.split(/\n?\s*\|\||\n\s*\|(?!\|)/).map((c) => cellBody(c)).filter(Boolean);
      const joined = cells.join(' | ');
      const dated = race.abroad ? dateCellOf(cells) : null;
      const ym = race.abroad ? (dated ? [null, String(dated.year)] : null) : /(19\d\d|20\d\d)年/.exec(joined);
      if (!ym) continue;
      // 条件の列に「オープン」「1000万下」が入っている行は重賞ではない
      // （見出しで切り分けられなかった表のため。上の見出しの判定と二重の網）。
      if (cells.some((c) => /^(オープン|OP|\d+万下|\d+万円以下)$/.test(plain(c)))) continue;
      const year = Number(ym[1]);
      if (!wanted(year)) continue;
      let horse = null;
      if (race.abroad) {
        // 日付のセルの直後 2 セル（馬と、あれば日本語読み）だけを見る。後ろの列まで見ると、
        // 馬が英語名でリンクも無い年に、馬主のリンク（ゴドルフィン）を馬にしてしまう。
        // 日本馬の出走表（「11着」「9頭」の行）は勝ち馬の表ではない。
        if (cells.some((c) => /\d+着|着外|\d+頭/.test(plain(c)))) continue;
        const h = abroadHorse(cells.slice(dated.index + 1, dated.index + 3));
        if (h) { horse = h.name; if (h.title) HINT.set(h.name, h.title); }
      } else for (const cell of cells) {
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
    // 箇条書きの優勝馬。海外の短い記事は表ではなく「近年の勝ち馬」を
    // `*2015 [[アメリカンファラオ|American Pharoah]]` と並べるだけのものが多い（表より多い）。
    if (race.abroad) {
      for (const line of sec.body.split('\n')) {
        const lm = /^[*#]+\s*(?:\[\[)?(19\d\d|20\d\d)(?:年)?(?:\]\])?\s*[-–—:：、.]?\s*(.*)$/.exec(line);
        if (!lm) continue;
        const year = Number(lm[1]);
        if (!wanted(year) || got.has(year) || /\d+着|着外|\d+頭/.test(plain(lm[2]))) continue;
        const h = abroadHorse([lm[2]]);
        if (h) { got.set(year, h.name); if (h.title) HINT.set(h.name, h.title); }
      }
    }
  }
  // 取れなかった年は「最初に取れた年から最後の年まで」の抜けだけ報告する。
  // 窓を 1932 年まで広げたので、創設前の年を並べると 50 行の雑音になる。
  const years = [...got.keys()].sort((a, b) => a - b);
  const missing = [];
  // 海外は日本語の記事が無い年が多いので、抜けの報告はしない。
  if (years.length && !race.abroad) {
    for (let y = years[0]; y <= Math.min(hi, TO); y++) if (!got.has(y) && wanted(y)) missing.push(y);
  }
  return { got, missing, first: years[0] ?? null, last: years[years.length - 1] ?? null };
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
  // {{lang|en|text}} は 2 番目が本文、{{仮リンク|日本語名|en|Name}} は 1 番目が日本語名。
  // 一緒くたに扱うと、仮リンクが言語コードの "en" になる（凱旋門賞の表の「カムラッド」が読めない）。
  .replace(/\{\{仮リンク\|([^|}]*)\|[^}]*\}\}/g, '$1')
  .replace(/\{\{lang\|[^|}]*\|([^|}]*)[^}]*\}\}/gi, '$1')
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
    // 生産国。{{JPN}} なら日本の馬。海外のレースを勝った日本の馬を海外馬（os）にしないため。
    japan: /JPN|日本/.test(pick(p, '国', '生産国') ?? ''),
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
  // 勝ち馬の表のリンク先（「キャメロット (競走馬)」）が分かっていれば、それを先に引く。
  // 素の題は曖昧さ回避ページや別の記事のことがあり、引き直す一手間が省ける。
  const hint = HINT.get(name);
  if (hint && hint !== name) {
    const ht = await wikitext([hint]);
    const h = sane(readHorse(name, ht.get(hint) ?? ''));
    if (h?.b) return h;
  }
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
 * 距離（m）を記事の「距離」の欄から読む。書き方がレースごとに違う：
 * 「2400メートル」「12ハロン」「9.5ハロン」「1マイル1/2（約2414m）」「2,100 メートル」。
 * 欄は `|` で区切られるので、リンクの途中（`12[[ハロン (単位)`）で切れた形を読む。
 * メートルが書いてあればそれを優先し、なければハロン、マイルの順。100m 単位に丸める。
 */
function parseDistance(raw) {
  const s = raw ?? '';
  let m = /(\d[\d,]*)\s*(?:\[\[)?(?:メートル|m)(?![a-z])/.exec(s);
  if (m) return Math.round(Number(m[1].replace(/,/g, '')) / 100) * 100;
  m = /(\d+(?:\.\d+)?)\s*(?:\[\[)?(?:ハロン|f\b)/.exec(s);
  if (m) return Math.round(Number(m[1]) * 201.168 / 100) * 100;
  m = /(?:(\d+)\s*)?(?:\[\[)?マイル(?:\s*(\d)\/(\d))?/.exec(s);
  if (m) {
    const miles = (m[1] ? Number(m[1]) : 1) + (m[2] ? Number(m[2]) / Number(m[3]) : 0);
    return Math.round(miles * 1609.34 / 100) * 100;
  }
  return null;
}

/** 馬場。芝以外（ダート・オールウェザー・ポリトラック）はダートとして扱う。 */
function surfaceOf(text) {
  const m = /\|\s*馬場\s*=\s*([^\n|]*)/.exec(text ?? '');
  return /ダート|オールウェザー|ポリトラック|AW/.test(m?.[1] ?? '') ? SURFACE.DIRT : SURFACE.TURF;
}

/**
 * 番組表（schedule.js）に無いレースの距離と馬場を足す。地方のダートグレードと海外の G1 は
 * 番組表に無いので、距離が分からないと derive() が既定の 2000m 芝にしてしまう。
 * 距離と馬場は記事のインフォボックス（{{競馬の競走}}）から読む。馬場を渡せばそれを使う。
 */
function registerRace(name, text, surface = null) {
  const m = /\|\s*距離\s*=\s*([^\n|]*)/.exec(text ?? '');
  let dist = m ? parseDistance(m[1]) : null;
  let surf = surface ?? surfaceOf(text);
  const fix = DIST_FIX[name];
  if (fix) { dist = fix[0]; surf = fix[1] === 'D' ? SURFACE.DIRT : SURFACE.TURF; }
  RACE_DIST.set(name, { name, distance: dist ?? 1800, surface: surf });
  return dist;
}

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
  const money = (h.earn ?? 0) / 10000; // 億円
  // 一番上の格から [基準, 1 勝ごとの上乗せ, 上限]。地方のダートグレードは、
  // 同じ格の JRA の重賞より相手が軽いので一段低く取る（JpnI は GI と GII の間）。
  const BANDS = {
    GI: [0.74, 0.015, 0.86], JpnI: [0.72, 0.013, 0.82],
    GII: [0.68, 0.012, 0.78], JpnII: [0.68, 0.012, 0.76],
    GIII: [0.66, 0.012, 0.76], JpnIII: [0.66, 0.012, 0.74],
  };
  const RANK = ['GI', 'JpnI', 'GII', 'JpnII', 'GIII', 'JpnIII'];
  const topGrade = RANK.find((g) => n(g)) ?? 'GIII';
  const [base, step, cap] = BANDS[topGrade];
  const top = n(topGrade);                          // 一番上の格での勝ち数
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

const DECADES = [[1900, 1949, '40S', '1940 年代まで'], [1950, 1959, '50S', '1950 年代'],
  [1960, 1979, '70S', '1960〜70 年代'], [1980, 1989, '80S', '1980 年代'], [1990, 1999, '90S', '1990 年代'],
  [2000, 2009, '00S', '2000 年代'], [2010, 2019, '10S', '2010 年代'], [2020, 2099, '20S', '2020 年代']];
const decadeOf = (b) => DECADES.find(([lo, hi]) => b >= lo && b <= hi) ?? DECADES[0];

/* ----------------------------------------------------------------- 本体 */

async function main() {
  if (flag('--verify')) return verify();

  // 1. 重賞の記事から (年 → 勝ち馬) を拾う。
  const races = RACES.filter((r) => GRADES.includes(r.grade) && KINDS.includes(kindOf(r)))
    .filter((r) => !ONLY || ONLY.includes(r.as) || ONLY.includes(r.wiki)
      || (Array.isArray(r.as) && r.as.some(([, n]) => ONLY.includes(n))));
  const byGrade = GRADES.map((g) => `${g} ${races.filter((r) => r.grade === g).length}`).join(' / ');
  console.error(`重賞 ${races.length} 戦の記事を読む（${byGrade}、${FROM}〜${TO} 年）`);
  const texts = await wikitext([...new Set(races.map((r) => r.wiki))]);
  // 地方のダートグレードを番組表の代わりに登録する（距離は記事から、馬場はダート）。
  let noDist = [];
  for (const race of races.filter((r) => r.nar || r.abroad)) {
    // 地方はすべてダート。海外は記事の馬場の欄から。
    if (!registerRace(race.as, texts.get(race.wiki), race.nar ? SURFACE.DIRT : null)) noDist.push(race.as);
  }
  if (noDist.length) console.error(`  距離が読めなかった競走 ${noDist.length} 戦（1800m として扱う）: ${noDist.join(' ')}`);
  if (flag('--distances')) {
    for (const race of races.filter((r) => r.nar || r.abroad)) {
      const d = RACE_DIST.get(race.as);
      console.error(`  ${race.as.padEnd(18)} ${String(d.distance).padStart(4)}m ${d.surface === SURFACE.DIRT ? 'ダート' : '芝'}`);
    }
  }
  /** 馬名 → [[年, レース名, 格], …] */
  const winsOf = new Map();
  for (const race of races) {
    const { got, missing, first, last } = winnersOf(texts.get(race.wiki) ?? '', race);
    for (const [year, name] of got) {
      if (!winsOf.has(name)) winsOf.set(name, []);
      winsOf.get(name).push([year, raceNameAt(race, year), race.grade]);
    }
    const label = typeof race.as === 'string' ? race.as : race.as[0][1];
    const span = first ? `${first}〜${last}` : '—';
    console.error(`  ${race.grade.padEnd(4)} ${label.padEnd(16)} ${String(got.size).padStart(3)} 勝ち馬 ${span}`
      + (missing.length ? `（抜け ${missing.length} 年: ${missing.slice(0, 8).join(',')}${missing.length > 8 ? '…' : ''}）` : ''));
  }
  for (const w of winsOf.values()) w.sort((a, b) => a[0] - b[0]);

  // 勝ち馬の表の読み取りだけを確かめる（馬の記事は引かない）。海外の表は書き方がばらばらなので、
  // 全部を引く前に、各レースで拾った名前が馬になっているかを目で見る。
  if (flag('--dry-races')) {
    for (const race of races) {
      const mine = [...winsOf].flatMap(([n, w]) => w.filter((x) => x[1] === race.as).map((x) => [x[0], n])).sort((a, b) => a[0] - b[0]);
      const pick3 = (l) => l.map(([y, n]) => `${y}${n}`).join(' ');
      console.error(`  ${race.as.padEnd(16)} ${String(mine.length).padStart(3)}  ${pick3(mine.slice(0, 3))} … ${pick3(mine.slice(-3))}`);
    }
    return;
  }

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
  /** 海外のレースだけを勝った海外生まれの馬。日本の現役馬として生成されないよう os で出す。 */
  const osGroups = new Map();
  for (const [name, h] of horses) {
    if (!h) continue;
    const [, , tag] = decadeOf(h.b);
    const wins = winsByName.get(name);
    // 日本で重賞を勝った馬は海外でも勝っていても日本の馬のまま（外国産馬のカフェファラオなど）。
    // 日本生まれの馬が海外で勝っただけの場合も同じ。os にすると 2026 年の世界から消えてしまう。
    if (wins && !h.japan && wins.every((w) => OS_NAMES.has(w[1]))) {
      if (!osGroups.has(tag)) osGroups.set(tag, []);
      osGroups.get(tag).push([h, wins]);
      continue;
    }
    if (!groups.has(tag)) groups.set(tag, { sires: [], dams: [], runners: [] });
    const g = groups.get(tag);
    if (wins) g.runners.push([h, wins]);
    else if (h.s === '牝') g.dams.push(h);
    else g.sires.push(h);
  }

  // 5. 書き出す。
  const out = [];
  for (const [, , tag] of DECADES) {
    const g = groups.get(tag);
    if (!g || !(g.runners.length + g.dams.length + g.sires.length)) continue;
    const label = DECADES.find((d) => d[2] === tag)[3];
    out.push(`/** ${label}の JRA GI 勝ち馬（ja.wikipedia から取り込み）。 */`);
    if (g.sires.length) out.push(`const WIKI_${tag}_ANCESTORS = [\n${g.sires.map(emitAncestor).join('\n')}\n];\n`);
    if (g.dams.length) out.push(`const WIKI_${tag}_DAMS = [\n${g.dams.map(emitDam).join('\n')}\n].map(([n, b, sire]) => ({ n, b, s: '牝', sire }));\n`);
    out.push(`const WIKI_${tag} = [\n${g.runners.map(([h, w]) => emit(h, w)).join('\n')}\n];\n`);
  }
  // 海外の勝ち馬。祖先と母は日本の馬と同じ置き場（bg）に入っているので、勝ち馬だけを別に置く。
  for (const [, , tag] of DECADES) {
    const list = osGroups.get(tag);
    if (!list?.length) continue;
    const label = DECADES.find((d) => d[2] === tag)[3];
    out.push(`/** ${label}に生まれた海外の G1 勝ち馬（ja.wikipedia から取り込み）。os：海外の馬。 */`);
    out.push(`const WIKI_OS_${tag} = [\n${list.map(([h, w]) => emit(h, w)).join('\n')}\n];\n`);
  }
  const spreadLines = DECADES.map(([, , tag]) => {
    const g = groups.get(tag);
    if (!g || !(g.runners.length + g.dams.length + g.sires.length)) return null;
    const parts = [];
    if (g.sires.length) parts.push(`...WIKI_${tag}_ANCESTORS.map(bg)`);
    if (g.dams.length) parts.push(`...WIKI_${tag}_DAMS.map(bg)`);
    if (g.runners.length) parts.push(`...WIKI_${tag}`);
    return `  ${parts.join(', ')},`;
  }).filter(Boolean);
  // 海外の行は日本の馬の行の後ろに足す（順番を変えると世界の乱数がずれる）。
  for (const [, , tag] of DECADES) if (osGroups.get(tag)?.length) spreadLines.push(`  ...WIKI_OS_${tag}.map(os),`);
  const spread = spreadLines.join('\n');

  const nOs = [...osGroups.values()].reduce((a, l) => a + l.length, 0);
  const nJp = [...groups.values()].reduce((a, g) => a + g.runners.length + g.dams.length + g.sires.length, 0);
  const winners = [...groups.values()].reduce((a, g) => a + g.runners.length, 0);
  console.error(`\n${nJp + nOs} 頭を書き出す（日本の勝ち馬 ${winners} 頭＋祖先 ${nJp - winners} 頭、海外の勝ち馬 ${nOs} 頭）`);
  if (flag('--report')) report(groups, osGroups);

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
function report(groups, osGroups = new Map()) {
  console.error('\n--- 導いた値（ウィキペディアに無い項目） ---');
  const lists = [...[...groups.values()].map((g) => g.runners), ...[...osGroups.values()]];
  for (const runners of lists) {
    for (const [h, wins] of runners) {
      const d = derive(h, wins);
      const cnt = ['GI', 'JpnI', 'GII', 'JpnII', 'GIII', 'JpnIII']
        .filter((g) => wins.some((w) => w[2] === g))
        .map((g) => `${g}${wins.filter((w) => w[2] === g).length}`).join('/');
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
