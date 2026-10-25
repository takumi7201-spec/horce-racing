// 記録。リーディング、歴代 GI、コースレコード、年度代表馬、史実馬名鑑。

import { el, card, table, tabs, button, modal, kv } from '../dom.js';
import * as G from '../../sim/game.js';
import { formatMoney, formatTime } from '../../core/util.js';
import { ABILITY_LABEL } from '../../sim/params.js';

const SHORT = {
  tokyo: '東京', nakayama: '中山', hanshin: '阪神', kyoto: '京都', chukyo: '中京',
  niigata: '新潟', sapporo: '札幌', hakodate: '函館', fukushima: '福島', kokura: '小倉',
};

export function recordsScreen(app) {
  const g = app.game;
  const tab = app.params.tab ?? 'leaders';
  const nav = tabs([
    { id: 'leaders', name: 'リーディング' },
    { id: 'g1', name: '歴代 GI' },
    { id: 'awards', name: '年度代表馬' },
    { id: 'records', name: 'コースレコード' },
    { id: 'real', name: '史実馬名鑑' },
  ], tab, (id) => app.go('records', { tab: id }));

  const body = tab === 'g1' ? g1View(app)
    : tab === 'awards' ? awardsView(app)
      : tab === 'records' ? recordsView(app)
      : tab === 'real' ? realBookView(app)
        : leadersView(app);
  return el('div', [nav, body]);
}

function leadersView(app) {
  const g = app.game;
  const L = G.leaders(g);
  return el('div.cols2', [
    el('div.col', [
      card('騎手', table(['順', '騎手', '勝', '出走', '勝率', 'GI', '収入'],
        L.jockeys.map((j, i) => [
          i + 1, j.name, j.wins, j.starts,
          j.starts ? `${((j.wins / j.starts) * 100).toFixed(1)}%` : '—',
          j.g1, formatMoney(j.earnings),
        ]), { align: ['c', , 'c', 'c', 'c', 'c', 'r'] })),
      card('調教師', table(['順', '調教師', '勝', '出走', 'GI', '収入'],
        L.trainers.map((t, i) => [
          i + 1, t.name, t.wins, t.starts, t.g1, formatMoney(t.earnings),
        ]), { align: ['c', , 'c', 'c', 'c', 'r'] })),
    ]),
    el('div.col', [
      card('種牡馬（産駒の獲得賞金）', table(['順', '種牡馬', '産駒の総賞金'],
        L.sires.map((s, i) => ({
          cells: [i + 1, s.name, formatMoney(s.earnings)],
          onclick: () => app.go('stable', { id: s.id, list: L.sires.map((x) => x.id) }),
        })), { align: ['c', , 'r'] })),
      card('馬主', table(['順', '馬主', '獲得賞金'],
        L.owners.map((o, i) => [
          i + 1,
          el('span', { text: o.name, class: o.id === 'player' ? 'mine' : null }),
          formatMoney(o.earnings),
        ]), { align: ['c', , 'r'] })),
    ]),
  ]);
}

function g1View(app) {
  const g = app.game;
  const hist = G.gradedHistory(g).filter((x) => x.grade === 'GI').sort((a, b) => b.year - a.year || b.week - a.week);
  if (!hist.length) return card('歴代 GI', el('p.empty', { text: 'まだ GI が行われていない。' }));
  // 同じ馬が何度も勝つので、送る並びは重複を除く
  const list = [...new Set(hist.map((h) => h.winnerId))];
  return card(`歴代 GI（${hist.length} 戦）`, table(
    ['年', 'レース', '勝ち馬', '騎手', '時計', '頭数'],
    hist.map((h) => ({
      cells: [
        h.year, el('span', { text: h.name, class: 'grade g1' }), h.winner, h.jockey,
        formatTime(h.time), `${h.field}頭`,
      ],
      onclick: () => app.go('stable', { id: h.winnerId, list }),
      cls: g.world.horses.get(h.winnerId)?.ownerId === 'player' ? 'mine' : null,
    })), { align: ['c', , , , 'c', 'c'] }));
}

function awardsView(app) {
  const g = app.game;
  const aw = g.world.awards.slice().reverse();
  const list = [...new Set(aw.map((a) => a.horseId))];
  if (!aw.length) return card('年度代表馬', el('p.empty', { text: 'まだ選出されていない（年末に決まる）。' }));
  return card('年度代表馬', table(['年', '馬名', '戦績', '獲得賞金'],
    aw.map((a) => {
      const h = G.getHorse(g, a.horseId);
      return {
        cells: [a.year, el('b', { text: a.name }),
          h ? `${h.starts}戦${h.wins}勝` : '—', h ? formatMoney(h.earnings) : '—'],
        onclick: h ? () => app.go('stable', { id: h.id, list }) : null,
        cls: h?.ownerId === 'player' ? 'mine' : null,
      };
    }), { align: ['c', , 'c', 'r'] }));
}

function recordsView(app) {
  const g = app.game;
  const rec = G.courseRecords(g);
  if (!rec.length) return card('コースレコード', el('p.empty', { text: 'まだ記録が無い。' }));
  return card('コースレコード（良馬場のみ）', table(
    ['場', '馬場', '距離', '記録', '馬名', '年'],
    rec.map((r) => [
      SHORT[r.courseId] ?? r.courseName, r.surface, `${r.distance}m`,
      el('b', { text: formatTime(r.time) }), r.name, r.year,
    ]), { align: ['c', 'c', 'c', 'c', , 'c'] }));
}

// ---------------------------------------------------------------- 史実馬名鑑

const decadeName = (d) => (d <= 1960 ? '〜1960年代' : `${d}年代`);
const WHERE_FILTERS = [
  { id: 'all', name: 'すべて' }, { id: '日本', name: '日本' }, { id: '海外', name: '海外' }, { id: '輸入', name: '輸入' },
];

/**
 * 実在の馬を生まれた年代ごとに一覧する。この世界での今の姿（現役・種牡馬・これから生まれる・
 * 生まれなかった…）を並べるので、昔から始めたときに「次に誰が来るか」を見る表にもなる。
 * 年代の既定は、いま現役の世代（4 年前に生まれた馬）の年代。
 */
function realBookView(app) {
  const g = app.game;
  const all = G.realBook(g);
  if (!all.length) return card('史実馬名鑑', el('p.empty', { text: 'この世界は実在の馬を使っていない。' }));
  const decades = [...new Set(all.map((x) => x.decade))].sort((a, b) => a - b);
  const nowDec = Math.max(decades[0], Math.min(decades[decades.length - 1], Math.floor((g.world.year - 4) / 10) * 10));
  const dec = app.params.dec ?? nowDec;
  const where = app.params.where ?? 'all';
  const go = (p) => app.go('records', { tab: 'real', dec, where, ...p }, { replace: true });

  const inDec = all.filter((x) => x.decade === dec);
  const rows = inDec.filter((x) => where === 'all' || x.where === where)
    .sort((a, b) => a.birthYear - b.birthYear || b.g1 - a.g1);
  const count = (k) => inDec.filter((x) => x.status.key === k).length;

  const decTabs = tabs(decades.map((d) => ({
    id: d, name: `${decadeName(d)}（${all.filter((x) => x.decade === d).length}）`,
  })), dec, (d) => go({ dec: d }));
  decTabs.classList.add('book-decades');
  const whereTabs = el('div.book-where', WHERE_FILTERS.map((f) => button(f.name, () => go({ where: f.id }), {
    cls: `sm ${f.id === where ? 'primary' : 'ghost'}`,
  })));

  // 世界に居る馬だけを左右に送れる（生まれなかった馬などは id が無い）
  const ids = rows.filter((x) => x.id != null).map((x) => x.id);

  return el('div', [
    decTabs,
    card(`${decadeName(dec)}生まれの実在馬（${rows.length} 頭）`, [
      el('div.book-head', [
        whereTabs,
        el('p.note', { text: `この世界に居る ${count('here')} 頭 ・ これから ${count('future')} 頭 ・ 故馬 ${count('dead')} 頭`
          + (count('lost') ? ` ・ 生まれなかった ${count('lost')} 頭` : '') }),
      ]),
      rows.length ? table(['馬名', '生年', '性', '父', '母', '区分', '史実の主な勝鞍', 'この世界の成績', 'いま'],
        rows.map((x) => ({
          cells: [
            el('span.sire-n', [
              el('b', { text: x.name }),
              x.where !== '日本' ? el('i.foreigntag', { text: x.where }) : null,
              x.mine ? el('i.realtag', { text: '所有' }) : null,
            ]),
            x.birthYear, x.sex, x.sire, x.dam, x.role,
            x.bigWins.length
              ? el('span.book-wins', { text: x.bigWins.slice(-2).join('・') + (x.bigWins.length > 2 ? ` ほか${x.bigWins.length - 2}` : ''),
                title: x.bigWins.join('\n') })
              : '—',
            x.world ? `${x.world.starts}戦${x.world.wins}勝${x.world.g1 ? `（GI ${x.world.g1}勝）` : ''}` : '—',
            el('span.book-st', { text: x.status.text, class: `st-${x.status.key}` }),
          ],
          cls: x.mine ? 'mine' : null,
          // 世界に居る馬は馬の詳細へ。居ない馬（これから生まれる馬・海外の若駒など）も、同じ馬の詳細で表の値を見せる
          // （仮の世界に作る。世界そのものには足さない）。作れない馬だけ表の値のモーダル。
          onclick: x.id != null ? () => app.go('stable', { id: x.id, list: ids })
            : () => (G.realPreview(g, x.name) ? app.go('stable', { real: x.name }) : showRealProfile(x)),
        })), { align: [, 'c', 'c', , , 'c'] })
        : el('p.empty', { text: 'この年代・区分の実在馬は居ない。' }),
    ]),
  ]);
}

/** 世界に居ない実在馬の詳細。表の値（能力は史実馬の一覧のまま）を見せる。 */
function showRealProfile(x) {
  const pct = (v) => (v == null ? '—' : String(Math.round(v * 100)));
  const t = x.traits;
  const STYLE = { 逃: '逃げ', 先: '先行', 差: '差し', 追: '追込' };
  const SURF = { T: '芝', D: 'ダート', TD: '芝・ダート' };
  const pairs = [
    ['生年・性', `${x.birthYear}年生 ${x.sex}　${x.coat}`],
    ['父 / 母', `${x.sire} / ${x.dam}`],
    ['区分', `${x.role}（${x.where}）`],
    ['いま', x.status.text],
  ];
  if (t) {
    pairs.push(
      [ABILITY_LABEL.speed, pct(t.lvl)],
      ...(t.ab ? [[ABILITY_LABEL.power, pct(t.ab.power)], [ABILITY_LABEL.guts, pct(t.ab.guts)], [ABILITY_LABEL.wit, pct(t.ab.wit)]] : []),
      ...(t.sound != null ? [['健康', pct(t.sound)], ['精神力', pct(t.spirit)]] : []),
      ['適性', `${SURF[t.surf] ?? '—'}　${t.dist ?? '—'}m ±${t.range ?? '—'}　${STYLE[t.style] ?? '—'}　${t.growth ?? '—'}`],
    );
  }
  pairs.push(['史実の主な勝鞍', x.bigWins.length ? x.bigWins.join('、') : '—']);
  modal(x.name, [
    el('p.note', { text: 'この世界には（まだ）居ない馬。表にある値を見せている。' }),
    kv(pairs),
  ]);
}
