// 「Winning Post 10 2026 攻略」（ahogame.netgamers.jp）の史実馬の一覧から、事実だけを取り込む道具。
//
//   node tools/import-ahogame.mjs            # 取得（無ければ）して src/sim/data/ahogame-facts.js を書く
//   node tools/import-ahogame.mjs --offline  # キャッシュ（.cache/ahogame）だけで組み直す
//   node tools/import-ahogame.mjs --depth 1  # 一覧に載っている親のさらに親を何代たどるか
//
// 取るもの:
//   事実   馬名（カタカナ・英字）・生年・性・毛色・生国・父・母、種牡馬の引退年
//   能力の土台  スピード・スタミナ・柔軟性・芝ダート・脚質・成長型。こちらの尺度（lvl・dist・range・surf・style・growth）に
//          変換して書く。サイトの数値そのものは出力に残さない。戦績から導いた値より、サイトの値のほうが安定しているので土台にする。
// 取らないもの: 因子・特性・ウマソナ・系統の分類・セリ・引退年齢など、こちらの仕組みに対応が無いゲーム固有の値。
// 一覧に載っている馬を新しい競走馬として足すことはしない（足すと GI の時計が速くなる。落とし穴 46）。
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
const readJp = (r) => ({ n: r[0], b: year(r[2]), sex: r[3], coat: COAT[r[4]] ?? null, sire: r[7], dam: r[8], v: r.slice(9) });
const readOs = (r) => ({ alpha: r[0], n: r[1], b: year(r[3]), sex: r[4], coat: COAT[r[5]] ?? null, sire: r[8], dam: r[9], v: r.slice(10) });
const readBr = (r) => ({ n: r[0], alpha: r[1] || null, b: year(r[3]), sex: r[4], coat: COAT[r[5]] ?? null, sire: r[8], dam: r[9], v: r.slice(10) });

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


// ---------------------------------------------------------------- 能力の土台

// 列（v）: 0 スピード 1 スタミナ 2 瞬発 3 根性 4 パワー 5 柔軟 6 健康 7 精神 8 賢さ 9 計 10 芝 11 ダ 12〜14 適応 15 成長型 16 成長力 17 脚質 18 気性
// 使うのは 0・1・5・10・11・15・17 だけ。残りはこちらの仕組みに対応が無い。
const LEVEL = ['G', 'G+', 'F', 'F+', 'E', 'E+', 'D', 'D+', 'C', 'C+', 'B', 'B+', 'A', 'A+', 'S', 'S+'];
const MARK = { '◎': 3, '○': 2, '〇': 2, '△': 1, '×': 0 };
const STYLE = { 先行: '先', 逃げ: '逃', 大逃: '逃', 差し: '差', 追込: '追', 自先: '先', 自差: '差', 自在: '先' };
const GROWTH = { 早熟: '早熟', 早熟鍋: '早熟', 早め: '普通', 早め鍋: '普通', 遅め: '持続', 晩成: '晩成', 晩成超: '晩成', 覚醒: '晩成' };
// スタミナ → 最適距離。表の馬（手で入れた距離と戦績から導いた距離）の平均に合わせた折れ線。
const DIST_NODES = [[5, 1150], [10, 1250], [30, 1600], [50, 1960], [75, 2420], [100, 3200]];

function interp(nodes, x) {
  if (x <= nodes[0][0]) return nodes[0][1];
  for (let i = 1; i < nodes.length; i++) {
    if (x <= nodes[i][0]) { const [x0, y0] = nodes[i - 1], [x1, y1] = nodes[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  }
  return nodes.at(-1)[1];
}

/** サイトの値 → こちらの尺度。lvl は切片を後で合わせるので、ここでは傾きだけ決める。 */
function convert(v) {
  const sp = Number(v[0]), sta = Number(v[1]);
  if (!Number.isFinite(sp) || !Number.isFinite(sta)) return null;
  const lv = LEVEL.indexOf(v[5]);
  const t = MARK[v[10]], d = MARK[v[11]];
  if (lv < 0 || t == null || d == null) return null;
  return {
    lvl0: sp >= 60 ? 0.66 + 0.0125 * (sp - 60) : 0.66 - 0.01 * (60 - sp),
    dist: Math.min(3600, Math.max(1000, Math.round(interp(DIST_NODES, sta) / 100) * 100)),
    range: Math.round((400 + 5 * lv + 0.9 * lv * lv) / 10) * 10,
    surf: t >= 3 && d >= 3 ? 'TD' : t > d ? 'T' : d > t ? 'D' : 'TD',
    style: STYLE[v[17]] ?? null,
    growth: GROWTH[v[15]] ?? null,
  };
}

const statRows = [];
{
  const old = [];
  for (const e of table) {
    if (e.lvl == null) continue;
    const rec = recFor(e);
    if (!rec || rec.list === 'br' || !rec.v) continue;
    const c = convert(rec.v);
    if (c) statRows.push({ e, c });
  }
  // 平均を元に合わせる。スピードの傾きだけがサイトの値で、水準は GI の時計に直結する（落とし穴 8・46）ので動かさない。
  const meanOld = statRows.reduce((a, { e }) => a + e.lvl, 0) / statRows.length;
  const meanNew = statRows.reduce((a, { c }) => a + c.lvl0, 0) / statRows.length;
  const off = meanOld - meanNew;
  for (const r of statRows) r.c.lvl = Math.min(0.97, Math.max(0.4, Math.round((r.c.lvl0 + off) * 100) / 100));
  console.error(`能力の土台を結べた馬 ${statRows.length} 頭（lvl の平均 ${meanOld.toFixed(3)} に合わせる切片 ${off >= 0 ? '+' : ''}${off.toFixed(3)}）`);
  const diff = (k) => statRows.filter(({ e, c }) => e[k] != null && c[k] != null && e[k] !== c[k]).length;
  console.error(`  置き換わる: surf ${diff('surf')} / style ${diff('style')} / growth ${diff('growth')} / dist ${statRows.filter(({ e, c }) => e.dist != null && Math.abs(e.dist - c.dist) >= 200).length}（200m 以上）`);
}

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
// 能力の土台（AHO_STATS）は、サイトの値をこちらの尺度に変換したもの。サイトの数値そのものは含まない。
//   AHO_FILL    [馬名, 生年, 父, 母]               表で父母が空だった馬に補う（null は補わない）
//   AHO_NEW     [馬名, 生年, 性, 毛色, 父, 母]     表に無かった祖先（血統をつなぐだけ）
//   AHO_RETIRE  [馬名, 生年, 引退年]               日本で供用された種牡馬の引退年
//   AHO_ALIAS   [英語名, カタカナ名]               Wikidata から補った英語名の馬のカタカナ名
//   AHO_STATS   [馬名, 生年, lvl, 馬場, 距離, 幅, 脚質, 成長型]  能力の土台（こちらの尺度に変換済み）

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

export const AHO_STATS = [
${statRows.map(({ e, c }) => `  [${q(e.n)}, ${e.b}, ${c.lvl.toFixed(2)}, ${q(c.surf)}, ${c.dist}, ${c.range}, ${q(c.style)}, ${q(c.growth)}],`).join('\n')}
];
`;
writeFileSync(OUT, body);
console.error(`${OUT} に書いた`);

// ---------------------------------------------------------------- --horses：本編に居ない競走馬のデータ

// サイトの競走馬（日本・海外）のうち、表に競走馬として居ない馬を、表と同じ項目で作る。
// 本編には組み込まない（src/sim/data/ahogame-horses.js は real-horses.js から読まれない）。組み込むと
// 世界の馬が 1.3 万頭増え、GI の時計・セーブの大きさ・生成時間が変わる（落とし穴 46・54）。
// 戦績（出走・勝鞍）はサイトに無いので持たない。父母は表か新しい馬の中に居る名前だけ書く（組み込んだとき
// realsires.js が名前で表を引くので、居ない親を書くと世界の生成が落ちる。落とし穴 43）。
if (flag('--horses')) {
  const { REAL_HORSES } = await import('../src/sim/data/real-horses.js');
  const appear = (h) => !h.bg || h.os || h.abroad || h.amare || h.mare || h.lvl != null;
  const appearing = new Set(REAL_HORSES.filter(appear).map((h) => `${norm(h.n)}|${h.b}`));
  const idx = new Map();       // norm(名) → [{ n, b }]（表の全馬と、これから足す馬）
  const addIdx = (n, b) => idx.set(norm(n), [...(idx.get(norm(n)) ?? []), { n, b }]);
  for (const h of REAL_HORSES) addIdx(h.n, h.b);
  const offset = statRows.length ? statRows[0].c.lvl - statRows[0].c.lvl0 : 0;   // lvl の切片は表の馬と同じ

  const cand = [];
  for (const r of recs) {
    if (r.list === 'br' || !r.v || r.b == null) continue;
    const name = isKana(r.n) ? r.n : kanaOf(r.alpha ?? r.n);
    if (!name || appearing.has(`${norm(name)}|${r.b}`) || (r.alpha && appearing.has(`${norm(r.alpha)}|${r.b}`))) continue;
    const c = convert(r.v);
    if (!c) continue;
    cand.push({ r, name, c });
  }
  // 同名で年の違う馬が表に居ると、表は馬名で引くので後の方が前の方を潰す（落とし穴 54）。足さない。
  const horses = [];
  let clash = 0, dupe = 0;
  const seen = new Set();
  for (const x of cand) {
    const k = `${norm(x.name)}|${x.r.b}`;
    if (seen.has(k)) { dupe++; continue; }
    seen.add(k);
    const others = (idx.get(norm(x.name)) ?? []).filter((o) => o.b !== x.r.b);
    if (others.length) { clash++; continue; }
    horses.push(x);
  }
  for (const x of horses) addIdx(x.name, x.r.b);
  // 父母。表か新しい馬の中に、親子の年齢差 2〜30 歳で一つに決まる名前があるときだけ書く。
  const parent = (pstr, child) => {
    if (!pstr || pstr === '-' || pstr === '不明') return null;
    const hits = (idx.get(norm(kanaOf(pstr))) ?? []).filter((o) => child.b - o.b >= 2 && child.b - o.b <= 30);
    const ys = new Set(hits.map((o) => o.b));
    return ys.size === 1 ? hits[0].n : null;
  };
  const rows2 = horses.map(({ r, name, c }) => ({
    n: name, b: r.b, s: r.sex === '牝' ? '牝' : r.sex === 'セ' ? 'セン' : '牡', c: r.coat,
    sire: parent(r.sire, r), dam: parent(r.dam, r), os: r.list === 'os',
    lvl: Math.min(0.97, Math.max(0.4, Math.round((c.lvl0 + offset) * 100) / 100)),
    surf: c.surf, dist: c.dist, range: c.range, style: c.style, growth: c.growth,
    country: r.country, org: r.org,
  }));
  rows2.sort((a, b) => a.b - b.b || a.n.localeCompare(b.n, 'ja'));
  const withSire = rows2.filter((x) => x.sire).length, withDam = rows2.filter((x) => x.dam).length;
  console.error(`\n本編に居ない競走馬 ${rows2.length} 頭（日本 ${rows2.filter((x) => !x.os).length} / 海外 ${rows2.filter((x) => x.os).length}）。` +
    `同名の別馬で外した ${clash}、重複 ${dupe}。父が表に居る ${withSire}、母が表に居る ${withDam}`);

  const HOUT = join(ROOT, 'src/sim/data/ahogame-horses.js');
  const rowStr = (x) => `  [${q(x.n)}, ${x.b}, ${q(x.s)}, ${q(x.c)}, ${q(x.sire)}, ${q(x.dam)}, ${x.os ? 1 : 0}, ${x.lvl.toFixed(2)}, ${q(x.surf)}, ${x.dist}, ${x.range}, ${q(x.style)}, ${q(x.growth)}],`;
  writeFileSync(HOUT, `// 史実馬の一覧にあって、本編（real-horses.js の表）に競走馬として居ない馬。
// tools/import-ahogame.mjs --horses が書く（手で直さない）。まだどこからも読まれない（組み込むと世界が 1.3 万頭増える）。
// [馬名, 生年, 性, 毛色, 父, 母, 海外(1)/日本(0), lvl, 馬場, 距離, 幅, 脚質, 成長型]
// 能力は史実馬の一覧の値をこちらの尺度に変換したもの（表の馬と同じ変換、同じ切片）。戦績は持たない。
// 父母は表かこの一覧の中に居る名前だけ（null は居ない）。使うときは性 '牝' 以外は牡、'セン' は騸馬。
export const AHO_HORSES = [
${rows2.map(rowStr).join('\n')}
];
`);
  // 見るための CSV（スクラッチパッド等へ）。
  const csvPath = opt('--csv', null);
  if (csvPath) {
    const cq = (v) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const cols = ['馬名', '生年', '性', '毛色', '父', '母', '区分', '生国', '所属', 'lvl', '馬場', '距離', '幅', '脚質', '成長型'];
    writeFileSync(csvPath, '﻿' + [cols, ...rows2.map((x) => [x.n, x.b, x.s === '牝' ? '牝' : x.s === 'セン' ? 'セ' : '牡', x.c ?? '', x.sire ?? '', x.dam ?? '',
      x.os ? '海外' : '日本', x.country, x.org, x.lvl, x.surf, x.dist, x.range, x.style ?? '', x.growth ?? ''])].map((r) => r.map(cq).join(',')).join('\n') + '\n');
    console.error(`${csvPath} に書いた`);
  }
  console.error(`${HOUT} に書いた`);
}
