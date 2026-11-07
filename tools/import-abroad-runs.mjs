// 史実で米国のレースに出走した日本調教馬を、ja.wikipedia の「日本調教馬の日本国外への遠征」から取る道具。
//
//   node tools/import-abroad-runs.mjs           # 取得（キャッシュに無ければ）して src/sim/data/abroad-runs.js を書く
//   node tools/import-abroad-runs.mjs --offline # キャッシュ（.cache/wiki）だけで書く
//
// 米国のレース（番組表の abroad: 'US'）には日本の NPC は出ない。例外は、史実でその年にそのレースへ遠征した馬だけ
// （ラニの 2016 年ケンタッキーダービーなど）。この道具が [レース, 年, 馬名, 生年] を書き、world.js が出走させる。
//
// 記事の表は「回||施行日||参戦馬名||英語表記||性齢||騎手名||管理調教師||着順」。同じ回に複数頭いる年は
// 2 行目から回と施行日が rowspan で省かれる（先頭のセルが馬名）。着順が「出走取消」の馬は出走していないので採らない。
// 生年は施行年 − 性齢の年齢（記事の表に生年は無い）。表の馬との照合は名前と生年で行う（再登録された同名の別馬を避ける）。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WIKI = join(ROOT, '.cache/wiki');
const OUT = join(ROOT, 'src/sim/data/abroad-runs.js');
const OFFLINE = process.argv.includes('--offline');
const TITLE = '日本調教馬の日本国外への遠征';

/** 記事の節の名前 → 番組表のレース。 */
const SECTIONS = {
  ケンタッキーダービー: 'kentucky-derby',
  プリークネスステークス: 'preakness',
  ベルモントステークス: 'belmont-s',
  ケンタッキーオークス: 'kentucky-oaks',
  トラヴァーズステークス: 'travers',
  ペガサスワールドカップ: 'pegasus-wc',
  'ブリーダーズカップ・クラシック': 'bc-classic',
  'ブリーダーズカップ・ターフ': 'bc-turf',
  'ブリーダーズカップ・スプリント': 'bc-sprint',
  'ブリーダーズカップ・マイル': 'bc-mile',
  'ブリーダーズカップ・フィリー&メアターフ': 'bc-fm-turf',
  'ブリーダーズカップ・ディスタフ': 'bc-distaff',
};

async function article() {
  mkdirSync(WIKI, { recursive: true });
  const path = join(WIKI, `${encodeURIComponent(TITLE)}.txt`);
  if (!existsSync(path)) {
    if (OFFLINE) throw new Error(`${path} が無い（--offline）`);
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`https://ja.wikipedia.org/w/index.php?action=raw&title=${encodeURIComponent(TITLE)}`,
        { headers: { 'User-Agent': 'winning-road-tool/1.0 (horse pedigree research)' } });
      if (res.ok) { writeFileSync(path, await res.text()); break; }
      // 429 と 5xx は待って引き直す（落とし穴 45）。
      await new Promise((r) => setTimeout(r, 4000 * (i + 1)));
    }
  }
  return readFileSync(path, 'utf8');
}

/** セルの中の馬名。[[記事名|表示]] は表示がカタカナならそれ、でなければ記事名（括弧は落とす）。 */
function horseName(cell) {
  const c = cell.replace(/<ref[^>]*>[\s\S]*?<\/ref>|<ref[^>]*\/>/g, '').replace(/^[^|[]*\|(?!\|)/, '').trim();
  const link = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(c);
  const kana = (s) => /^[ァ-ヶー・ヴ]+$/.test(s);
  if (link) {
    if (link[2] && kana(link[2].trim())) return link[2].trim();
    const t = link[1].replace(/\s*\(.*\)$/, '').trim();
    return kana(t) ? t : null;
  }
  const t = c.replace(/'{2,3}/g, '').trim();
  return kana(t) ? t : null;
}

const text = await article();
const out = [];
let def = null;
for (const block of text.split(/\n(?==+)/)) {
  const head = /^(=+)\s*(.*?)\s*\1/.exec(block);
  if (head) {
    const t = head[2].replace(/\[\[|\]\]/g, '').trim();
    // 節の深さ（=== と ====）は記事の中でまちまちなので見ない。表は見出しの直後の節にある。
    def = SECTIONS[t] ?? null;
  }
  if (!def) continue;
  const table = /\{\|[\s\S]*?\n\|\}/.exec(block);
  if (!table) continue;
  let year = null;
  for (const row of table[0].split(/\n\|-/).slice(1)) {
    const line = row.replace(/^\s*\n?\|/, '').replace(/\n\|\}$/, '');
    if (line.startsWith('!')) continue;
    const cells = line.split('||').map((c) => c.replace(/^\s*\|/, '').trim());
    const di = cells.findIndex((c) => /(\d{4})年/.test(c));
    let hi;
    if (di >= 0) { year = Number(/(\d{4})年/.exec(cells[di])[1]); hi = di + 1; }
    else hi = 0;
    if (year == null) continue;
    const name = horseName(cells[hi] ?? '');
    const age = /[牡牝セ騸](\d+)/.exec(cells[hi + 2] ?? '');
    const result = cells.slice(hi + 3).join(' ');
    if (!name || !age || /出走取消|競走除外/.test(result)) continue;
    out.push([def, year, name, year - Number(age[1])]);
  }
}
out.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
const q = (s) => `'${s}'`;
writeFileSync(OUT, `// 史実で米国のレースに出走した日本調教馬。tools/import-abroad-runs.mjs が書く（手で直さない）。
// 出典：ja.wikipedia「${TITLE}」。[レース（番組表の id）, 年, 馬名, 生年]
// 米国のレースに日本の NPC は出ない。例外として、この表の馬だけがその年のそのレースに遠征する（world.js）。

export const ABROAD_RUNS = [
${out.map((r) => `  [${q(r[0])}, ${r[1]}, ${q(r[2])}, ${r[3]}],`).join('\n')}
];
`);
console.error(`${out.length} 件を ${OUT} に書いた`);
for (const r of out) console.error(r.join(' '));
