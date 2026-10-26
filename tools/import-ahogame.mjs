// 「Winning Post 10 2026 攻略」（ahogame.netgamers.jp）の史実馬の一覧から、事実だけを取り込む道具。
//
//   node tools/import-ahogame.mjs            # 取得（無ければ）して src/sim/data/ahogame-facts.js を書く
//   node tools/import-ahogame.mjs --offline  # キャッシュ（.cache/ahogame）だけで組み直す
//   node tools/import-ahogame.mjs --depth 1  # 一覧に載っている親のさらに親を何代たどるか
//
// 取るもの:
//   事実   馬名（カタカナ・英字）・生年・性・毛色・生国・父・母、種牡馬の引退年
//   能力   スピード・パワー・勝負根性・賢さ・健康・精神・スタミナ（距離）・柔軟性・芝ダート・脚質・成長型。サイトの値のまま
//          （÷100 するだけ。水準を合わせる切片は足さない）。競走馬は日本・海外のすべてを本編に足す（ahogame-horses.js）。
// 取らないもの: 因子・特性・ウマソナ・系統の分類・セリ・引退年齢など、こちらの仕組みに対応が無いゲーム固有の値。
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
// 既定は 3。新しく足す馬の父母を結ぶようにしたので、一覧に載っている祖先を 3 世代先までたどる（1 だと 5 代血統の平均 22 枠、3 で 27 枠）。
const DEPTH = Number(opt('--depth', 3));
// 一覧に記録の無い親（名前だけの祖先）は、子がこの頭数以上居るときだけ作る。1 頭しか子の居ない名前だけの親は
// 血統表の枠を一つ埋めるだけで、世界を膨らませる（子 1 頭だけにすると名前だけの祖先が 6,000 頭増えた）。
const STUB_KIDS = Number(opt('--stub-kids', 2));
const DAM_STUB_KIDS = Number(opt('--dam-stub-kids', STUB_KIDS));   // 母だけ子1頭でも作ると +4,000 頭で母系が 7.3→7.8/15 にしか伸びない（親の資料が無い）。既定は同じ
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
const readBr = (r) => ({ n: r[0], alpha: r[1] || null, b: year(r[3]), sex: r[4], coat: COAT[r[5]] ?? null, sire: r[8], dam: r[9], home: r[7], v: r.slice(10) });

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
  if (e._rec) return e._rec;   // 表に居ない一覧の馬（仮の項目）
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
const pendingStubs = new Map();   // 名前だけの親の候補 → { n, bs: 子の生年, role }

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
  // 作るかどうかは、全部の子が分かってから決める（作る馬の数は子の数で決まる）。ここでは名前を返しておく。
  const st = pendingStubs.get(key) ?? { n: pk, bs: [], role };
  if (st.role !== role) st.role = 'both';
  st.bs.push(child.b);
  pendingStubs.set(key, st);
  return pk;
}

// 名前だけの母（生年が子からの推定値）は、名前だけでは一覧に結べない。生年が推定値から 12 年以内で、子すべての親として
// 成り立つ一頭に決まるときだけ結ぶ（Wikidata の道具の 1b と同じ規則）。一覧の「繁殖専用」には、こういう母の父母が載っている。
{
  const kidsOf = new Map();
  for (const h of table) for (const p of [h.sire, h.dam]) if (p) kidsOf.set(p, [...(kidsOf.get(p) ?? []), h.b]);
  let matchedStubs = 0;
  for (const e of table) {
    if (!stubLike(e)) continue;
    const cs = kidsOf.get(e.n) ?? [];
    const rs = (recByName.get(norm(e.n)) ?? []).filter((r) => Math.abs(r.b - e.b) <= 12
      && (cs.length ? cs.every((c) => c - r.b >= 2 && c - r.b <= 30) : true));
    const ys = [...new Set(rs.map((r) => r.b))];
    if (ys.length !== 1) continue;
    e._rec = rs.find((r) => r.b === ys[0]);
    e._trueB = ys[0];
    // 生年も一覧の値に直す（AHO_YEAR）。推定値のままだと、子より若い母になって結べない
    // （バラードが 1981 年で、1976 年生のグロリアスソングの母になれず、ラーイの母系が空いた）。
    if (e.b !== ys[0]) { e._b0 = e.b; e.b = ys[0]; }
    matchedStubs++;
  }
  console.error(`名前だけの母のうち、一覧に結べた ${matchedStubs} 頭`);
}
for (const e of table) {
  if ((stubLike(e) && !e._rec) || (e.sire != null && e.dam != null)) continue;
  if (recFor(e)) { queued.add(e); queue.push({ e, depth: 0 }); }
}
// 表に居ない一覧の馬（本編に新しく足す競走馬）も、表の馬と同じ手順で父母を結ぶ。一覧の外の親は名前だけの祖先にする。
// 以前は「表か一覧に居る名前だけ」を父母にしていたので、新しく足した馬の父母の大半が空で、血統表がスカスカだった。
// 仮の項目を nameIdx に入れておくと、ほかの馬の親として再利用される（二頭に割れない）。
const virtuals = [];
for (const r of recs) {
  if (r.list === 'br' || r.b == null) continue;
  const vname = isKana(r.n) ? r.n : kanaOf(r.alpha ?? r.n);
  if (!vname) continue;
  const same = nameIdx.get(norm(vname)) ?? [];
  if (same.length) continue;                                   // 表に居る馬、または同名の別馬（足せない）
  const e = { n: vname, b: r.b, sire: null, dam: null, _virtual: true, _rec: r };
  add(e); virtuals.push(e);
  queued.add(e); queue.push({ e, depth: 0 });
}
console.error(`父母が空で、一覧に載っている馬 ${queue.length} 頭（うち表に居ない馬 ${virtuals.length}）`);
while (queue.length) {
  const { e, depth } = queue.shift();
  const rec = recFor(e);
  if (!rec) continue;
  const f = fills.get(e) ?? {};
  const child = e._trueB ? { ...e, b: e._trueB } : e;     // 推定した生年は一覧の値で親子の年齢差を見る
  for (const role of ['sire', 'dam']) {
    if (e[role] != null || f[role]) continue;
    const n = resolveParent(rec[role], child, role, depth);
    if (n) f[role] = n;
  }
  if (f.sire || f.dam) fills.set(e, f);
}
// 名前だけの祖先を作る。子が STUB_KIDS 頭に満たない名前は作らず、結んだ父母からも外す。
for (const [key, st] of pendingStubs) {
  if (st.bs.length < (st.role === 'dam' ? DAM_STUB_KIDS : STUB_KIDS) || st.role === 'both' || (nameIdx.get(key) ?? []).length) continue;
  const lo = Math.min(...st.bs), hi = Math.max(...st.bs);
  let b = lo - 8;
  if (hi - b > 30) b = hi - 30;
  if (lo - b < 2) continue;
  const e = { n: st.n, b, s: st.role === 'dam' ? '牝' : undefined, sire: null, dam: null, bg: true, _new: true };
  add(e); added.push(e); createdStub++;
}
for (const f of fills.values()) {
  for (const role of ['sire', 'dam']) {
    if (f[role] && !(nameIdx.get(norm(f[role])) ?? []).length) f[role] = null;
  }
}
// 新しい祖先の父母は、その馬自身に書く。
for (const e of added) {
  const f = fills.get(e);
  if (f) { e.sire = f.sire ?? null; e.dam = f.dam ?? null; fills.delete(e); }
}
const dFill = [...fills].filter(([e]) => !e._new && !e._virtual);
const vfill = new Map([...fills].filter(([e]) => e._virtual).map(([e, f]) => [`${norm(e.n)}|${e.b}`, f]));
console.error(`既存の馬に補った父母 ${dFill.length} 頭、新しい祖先 ${added.length} 頭（一覧に記録あり ${createdRec}、名前だけ ${createdStub}）、表の既存馬を再利用 ${reused}`);
console.error(`結ばなかった: 同名で決まらない ${ambiguous}、年齢差が合わない同名 ${skippedGap}`);


// ---------------------------------------------------------------- 能力（サイトの値のまま）

// 列（v）: 0 スピード 1 スタミナ 2 瞬発 3 根性 4 パワー 5 柔軟 6 健康 7 精神 8 賢さ 9 計 10 芝 11 ダ 12〜14 適応 15 成長型 16 成長力 17 脚質 18 気性
// サイトの能力値はそのまま使う（÷100 するだけで、水準を合わせる切片も足さない）:
//   スピード → speed（サイトは 45〜85 の数値で持つ）
//   パワー・勝負根性・賢さ → power・guts・wit、健康 → sound、精神 → spirit
//     （S+〜G の 16 段階は、サイトが示す数値の範囲の中央値。S+ 85-80 / S 79-78 / … / G 51-45）
// スタミナはサイトでは距離適性に効く隠し値で、こちらの「スタミナ」能力とは意味が違うので、距離（dist）にだけ使う。
// 瞬発はこちらに対応する能力が無い（差し・追込の脚質で表している）。
const LEVEL = ['G', 'G+', 'F', 'F+', 'E', 'E+', 'D', 'D+', 'C', 'C+', 'B', 'B+', 'A', 'A+', 'S', 'S+'];
const LETTER = [48, 52.5, 54.5, 56.5, 58.5, 60.5, 62.5, 64.5, 66.5, 68.5, 70.5, 72.5, 74.5, 76.5, 78.5, 82.5];
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

const letter = (s) => { const i = LEVEL.indexOf(s); return i < 0 ? null : LETTER[i] / 100; };
const r2 = (x) => Math.round(x * 100) / 100;

/** サイトの行 → 能力。読めない行は null。 */
function convert(v) {
  const sp = Number(v[0]), sta = Number(v[1]);
  if (!Number.isFinite(sp) || !Number.isFinite(sta)) return null;
  const lv = LEVEL.indexOf(v[5]);
  const t = MARK[v[10]], d = MARK[v[11]];
  const pw = letter(v[4]), gt = letter(v[3]), wt = letter(v[8]), hp = letter(v[6]), sd = letter(v[7]);
  if (lv < 0 || t == null || d == null || [pw, gt, wt, hp, sd].some((x) => x == null)) return null;
  return {
    lvl: r2(sp / 100),
    pw: r2(pw), gt: r2(gt), wt: r2(wt), hp: r2(hp), sd: r2(sd),
    dist: Math.min(3600, Math.max(1000, Math.round(interp(DIST_NODES, sta) / 100) * 100)),
    range: Math.round((400 + 5 * lv + 0.9 * lv * lv) / 10) * 10,
    surf: t >= 3 && d >= 3 ? 'TD' : t > d ? 'T' : d > t ? 'D' : 'TD',
    style: STYLE[v[17]] ?? null,
    growth: GROWTH[v[15]] ?? null,
  };
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

// ---------------------------------------------------------------- 英字名（Wikidata の道具が使う）

// カタカナ名 → 英字名。名前だけの祖先（生年が推定）は日本語ラベルでは Wikidata に結べないので、英語のラベルで探す。
mkdirSync(join(ROOT, 'tools/data'), { recursive: true });
{
  const alpha = {};
  for (const r of recs) if (r.alpha && isKana(r.n)) alpha[r.n] = r.alpha;
  writeFileSync(join(ROOT, 'tools/data/alpha-names.json'), JSON.stringify(alpha));
  console.error(`英字名 ${Object.keys(alpha).length} 件を tools/data/alpha-names.json に書いた`);
}

// ---------------------------------------------------------------- 書き出し

const q = (s) => (s == null ? 'null' : `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);
// 繁殖専用史実馬の牝馬のうち、日本（中央・地方）で繁殖に上がる馬だけ。海外で繁殖する馬は日本の名簿に入れない（落とし穴 42）。
// [馬名, 生年, 競走馬引退年齢, 繁殖引退年齢, 仔出]。末尾の三列が 仔出・競引退齢・繁引退齢。
const brood = recs.filter((r) => r.list === 'br' && r.sex === '牝' && r.b != null && /^(中央|地方)$/.test(r.home)).map((r) => {
  const [fert, raceAge, breedAge] = r.v.slice(-3).map(Number);
  return [r.n, r.b, raceAge, breedAge, fert];
}).filter((x) => x.slice(2).every(Number.isFinite));
const body = `// 「Winning Post 10 2026 攻略」の史実馬の一覧から取った、史実の事実だけ。
// tools/import-ahogame.mjs が書く（手で直さない）。real-horses.js の withAhogame が表の末尾に重ねる。
//   AHO_FILL    [馬名, 生年, 父, 母]               表で父母が空だった馬に補う（null は補わない）
//   AHO_YEAR    [馬名, 表の生年, 一覧の生年]       名前だけの母の推定した生年を、一覧の生年に直す
//   AHO_NEW     [馬名, 生年, 性, 毛色, 父, 母]     表に無かった祖先（血統をつなぐだけ）
//   AHO_RETIRE  [馬名, 生年, 引退年]               日本で供用された種牡馬の引退年
//   AHO_BROOD   [馬名, 生年, 競走馬引退年齢, 繁殖引退年齢, 仔出]  繁殖専用の牝馬（繁殖に上がる年と終える年）
//   AHO_ALIAS   [英語名, カタカナ名]               Wikidata から補った英語名の馬のカタカナ名

export const AHO_FILL = [
${dFill.map(([e, f]) => `  [${q(e.n)}, ${e._b0 ?? e.b}, ${q(f.sire)}, ${q(f.dam)}],`).join('\n')}
];

export const AHO_YEAR = [
${table.filter((e) => e._b0 != null).map((e) => `  [${q(e.n)}, ${e._b0}, ${e.b}],`).join('\n')}
];

export const AHO_NEW = [
${added.map((e) => `  [${q(e.n)}, ${e.b}, ${q(e.s ?? '牡')}, ${q(e.c ?? null)}, ${q(e.sire)}, ${q(e.dam)}],`).join('\n')}
];

export const AHO_RETIRE = [
${retYears.map(([n, b, y]) => `  [${q(n)}, ${b}, ${y}],`).join('\n')}
];

export const AHO_BROOD = [
${brood.map((x) => `  [${q(x[0])}, ${x.slice(1).join(', ')}],`).join('\n')}
];

export const AHO_ALIAS = [
${alias.map(([a, k]) => `  [${q(a)}, ${q(k)}],`).join('\n')}
];
`;
writeFileSync(OUT, body);
console.error(`${OUT} に書いた`);

// ---------------------------------------------------------------- 競走馬（サイトの日本・海外の競走馬すべて）

// サイトの競走馬を、表と同じ項目で ahogame-horses.js に書く。real-horses.js の withAhogame が表へ重ねる:
//   表に同じ馬（名前と生年）が居る  → 能力を上書きする。血統用の祖先だった日本の馬は競走馬にする（bg を外す）。
//   居ない                          → 新しい競走馬として足す（日本は競走馬、海外は os）。
// 戦績（出走・勝鞍）はサイトに無いので持たない。父母は、表かこの一覧に居る名前だけ書く
// （居ない名前を書くと、realsires.js が名前で表を引いて世界の生成が落ちる。落とし穴 43）。
// 同名で年の違う馬が表に居るものは足さない（表は馬名で引くので、後の方が前の方を潰す。落とし穴 54）。
const { TABLE_WITHOUT_AHO_HORSES: FINAL } = await import('../src/sim/data/real-horses.js');   // 自分の前回の出力を含めない
const finalByKey = new Map(FINAL.map((h) => [`${norm(h.n)}|${h.b}`, h]));
const idx2 = new Map();       // norm(名) → [{ n, b }]（表の全馬と、これから足す馬）
const addIdx2 = (n, b) => idx2.set(norm(n), [...(idx2.get(norm(n)) ?? []), { n, b }]);
for (const h of FINAL) addIdx2(h.n, h.b);

const horseRows = [];
let clash = 0, dupe = 0, unreadable = 0, matched = 0;
const seenKey = new Set();
for (const r of recs) {
  if (r.list === 'br' || !r.v || r.b == null) continue;
  const c = convert(r.v);
  if (!c) { unreadable++; continue; }
  const name = isKana(r.n) ? r.n : kanaOf(r.alpha ?? r.n);
  if (!name) continue;
  const ex = finalByKey.get(`${norm(name)}|${r.b}`) ?? (r.alpha ? finalByKey.get(`${norm(r.alpha)}|${r.b}`) : null);
  const key = `${norm(ex?.n ?? name)}|${r.b}`;
  if (seenKey.has(key)) { dupe++; continue; }
  seenKey.add(key);
  if (ex) { matched++; horseRows.push({ r, c, n: ex.n, isNew: false }); continue; }
  if ((idx2.get(norm(name)) ?? []).some((o) => o.b !== r.b)) { clash++; continue; }
  horseRows.push({ r, c, n: name, isNew: true });
}
for (const x of horseRows) if (x.isNew) addIdx2(x.n, x.r.b);
// 父母。表か新しい馬の中に、親子の年齢差 2〜30 歳で一つに決まる名前があるときだけ書く（新しい馬だけ）。
const parent2 = (pstr, child) => {
  if (!pstr || pstr === '-' || pstr === '不明') return null;
  const hits = (idx2.get(norm(kanaOf(pstr))) ?? []).filter((o) => child.b - o.b >= 2 && child.b - o.b <= 30);
  const ys = new Set(hits.map((o) => o.b));
  return ys.size === 1 ? hits[0].n : null;
};
for (const x of horseRows) {
  const vf = vfill.get(`${norm(x.n)}|${x.r.b}`);
  x.sire = x.isNew ? (vf?.sire ?? parent2(x.r.sire, x.r)) : null;
  x.dam = x.isNew ? (vf?.dam ?? parent2(x.r.dam, x.r)) : null;
}
horseRows.sort((a, b) => a.r.b - b.r.b || a.n.localeCompare(b.n, 'ja'));
const nNew = horseRows.filter((x) => x.isNew).length;
console.error(`\nサイトの競走馬 ${horseRows.length} 頭（表に居る ${matched}、新しく足す ${nNew}［日本 ${horseRows.filter((x) => x.isNew && x.r.list === 'jp').length} / 海外 ${horseRows.filter((x) => x.isNew && x.r.list === 'os').length}］）。` +
  `同名の別馬で足さない ${clash}、重複 ${dupe}、読めない行 ${unreadable}`);

const HOUT = join(ROOT, 'src/sim/data/ahogame-horses.js');
const num = (x) => x.toFixed(2);
const rowStr = ({ r, c, n, sire, dam, isNew }) => `  [${q(n)}, ${r.b}, ${q(isNew ? (r.sex === '牝' ? '牝' : r.sex === 'セ' ? 'セン' : '牡') : null)}, ${q(isNew ? r.coat : null)}, ${q(sire)}, ${q(dam)}, ${r.list === 'os' ? 1 : 0}, ` +
  `${num(c.lvl)}, ${num(c.pw)}, ${num(c.gt)}, ${num(c.wt)}, ${num(c.hp)}, ${num(c.sd)}, ${q(c.surf)}, ${c.dist}, ${c.range}, ${q(c.style)}, ${q(c.growth)}],`;
writeFileSync(HOUT, `// 史実馬の一覧（Winning Post 10 2026 攻略）の競走馬。tools/import-ahogame.mjs が書く（手で直さない）。
// real-horses.js の withAhogame が表へ重ねる。表に同じ馬（名前と生年）が居れば能力を上書きし、居なければ新しい競走馬として足す。
// [馬名, 生年, 性, 毛色, 父, 母, 日本(0)/海外(1), speed, power, guts, wit, 健康, 精神, 馬場, 距離, 幅, 脚質, 成長型]
// 能力値はサイトの値のまま（speed は 45〜85 の数値を ÷100、副能力は段階の中央値）。戦績は持たない。
// 性・毛色・父母は新しく足す馬だけ（表に居る馬は null）。父母は表かこの一覧に居る名前だけ。
export const AHO_HORSES = [
${horseRows.map(rowStr).join('\n')}
];
`);
console.error(`${HOUT} に書いた`);
const csvPath = opt('--csv', null);
if (csvPath) {
  const cq = (v) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const cols = ['馬名', '生年', '本編', '区分', '生国', '所属', 'speed', 'power', 'guts', 'wit', '健康', '精神', '馬場', '距離', '幅', '脚質', '成長型'];
  writeFileSync(csvPath, '﻿' + [cols, ...horseRows.map(({ r, c, n, isNew }) => [n, r.b, isNew ? '新規' : '既存', r.list === 'os' ? '海外' : '日本', r.country, r.org,
    c.lvl, c.pw, c.gt, c.wt, c.hp, c.sd, c.surf, c.dist, c.range, c.style ?? '', c.growth ?? ''])].map((row) => row.map(cq).join(',')).join('\n') + '\n');
  console.error(`${csvPath} に書いた`);
}
