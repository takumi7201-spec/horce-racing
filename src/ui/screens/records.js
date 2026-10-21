// 記録。リーディング、歴代 GI、コースレコード、年度代表馬。

import { el, card, table, tabs, button } from '../dom.js';
import * as G from '../../sim/game.js';
import { formatMoney, formatTime } from '../../core/util.js';

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
  ], tab, (id) => app.go('records', { tab: id }));

  const body = tab === 'g1' ? g1View(app)
    : tab === 'awards' ? awardsView(app)
      : tab === 'records' ? recordsView(app)
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
          onclick: () => app.go('stable', { id: s.id }),
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
  return card(`歴代 GI（${hist.length} 戦）`, table(
    ['年', 'レース', '勝ち馬', '騎手', '時計', '頭数'],
    hist.map((h) => ({
      cells: [
        h.year, el('span', { text: h.name, class: 'grade g1' }), h.winner, h.jockey,
        formatTime(h.time), `${h.field}頭`,
      ],
      onclick: () => app.go('stable', { id: h.winnerId }),
      cls: g.world.horses.get(h.winnerId)?.ownerId === 'player' ? 'mine' : null,
    })), { align: ['c', , , , 'c', 'c'] }));
}

function awardsView(app) {
  const g = app.game;
  const aw = g.world.awards.slice().reverse();
  if (!aw.length) return card('年度代表馬', el('p.empty', { text: 'まだ選出されていない（年末に決まる）。' }));
  return card('年度代表馬', table(['年', '馬名', '戦績', '獲得賞金'],
    aw.map((a) => {
      const h = G.getHorse(g, a.horseId);
      return {
        cells: [a.year, el('b', { text: a.name }),
          h ? `${h.starts}戦${h.wins}勝` : '—', h ? formatMoney(h.earnings) : '—'],
        onclick: h ? () => app.go('stable', { id: h.id }) : null,
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
