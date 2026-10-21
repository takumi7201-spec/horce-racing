// ホーム。今週の状況、登録、ニュース、直近の結果。

import { el, card, table, button, kv, frameChip, toast } from '../dom.js';
import * as G from '../../sim/game.js';
import { formatMoney, formatTime } from '../../core/util.js';
import { fitLabel, condLabel } from '../../sim/training.js';

export function homeScreen(app) {
  const g = app.game;
  const w = g.world;
  const f = G.finance(g);
  const horses = G.myHorses(g);
  const entries = G.myEntries(g);
  const last = app.lastWeek;

  return el('div.cols2', [
    el('div.col', [
      card('今週の登録', entries.length ? [
        table(['馬', 'レース', '場・条件', '騎手', ''], entries.map((e) => [
          e.horse.name,
          el('span', { text: e.race.name, class: e.race.grade ? 'grade' : null }),
          `${e.race.courseName}${e.race.surface}${e.race.distance}m`,
          e.jockeyName,
          button('取消', () => { G.cancelEntry(g, e.raceId); app.render(); }, { cls: 'sm ghost' }),
        ])),
        el('p.note', '「次の週へ」で発走する。'),
      ] : [
        el('p.empty', { text: '今週の登録は無い。番組表から選ぶか、所有馬の画面から登録する。' }),
        button('番組表を開く', () => app.go('races'), { cls: 'sm' }),
      ]),

      card('所有馬', horses.length ? table(
        ['馬名', '年齢', 'クラス', '状態', '仕上がり', '調子', '戦績', ''],
        horses.map((h) => {
          const v = G.horseView(g, h.id);
          return {
            cells: [
              el('b', { text: h.name }),
              `${v.age}歳${h.sex}`,
              v.className,
              v.injury ? el('span.bad', { text: v.injury.name })
                : v.stable === 'stable' ? '在厩' : '放牧',
              fitLabel(v.fit),
              condLabel(v.cond),
              `${h.starts}戦${h.wins}勝`,
              button('詳細', (ev) => { ev.stopPropagation(); app.go('stable', { id: h.id }); }, { cls: 'sm' }),
            ],
            onclick: () => app.go('stable', { id: h.id }),
          };
        }),
        { align: [, 'c', 'c', 'c', 'c', 'c', 'c'] },
      ) : el('p.empty', { text: '所有馬が居ない。セリ市（10 月）で買うか、配合で産ませる。' })),

      last && last.results.length ? card(`先週の結果（${last.at.year}年 ${last.label}）`, [
        table(['レース', '場', '1着', '騎手', '時計'], G.recentResults(g).slice(0, 12).map((r) => ({
          cells: [
            el('span', { text: r.name, class: r.grade ? 'grade' : null }),
            `${r.courseName}${r.surface}${r.distance}`,
            r.results[0].name,
            r.results[0].jockeyName,
            formatTime(r.winnerTime),
          ],
          onclick: r.log ? () => app.go('raceday', { races: [r] }) : null,
          cls: r.results.some((x) => w.horses.get(x.horseId)?.ownerId === 'player') ? 'mine' : null,
        }))),
      ]) : null,
    ]),

    el('div.col', [
      card('経営', kv([
        ['資金', el('b', { text: formatMoney(f.money), class: f.money < 0 ? 'minus' : null })],
        ['週の経費', formatMoney(f.weeklyCost)],
        ['所有馬', `${f.horses}頭（在厩 ${f.stabled}）`],
        ['繁殖牝馬', `${f.broodmares}頭`],
        ['種牡馬', `${f.stallions}頭`],
        ['通算', `${f.starts}戦 ${f.wins}勝（GI ${f.g1}勝）`],
        ['獲得賞金', formatMoney(f.earnings)],
      ])),

      f.titles.length ? card('称号', el('ul.titles', f.titles.map((t) => el('li', { text: t })))) : null,

      card('ニュース', w.news && w.news.length
        ? el('ul.news', w.news.slice(0, 24).map((n) => el('li', {
          text: n, class: n.startsWith('★') ? 'mine' : null,
        })))
        : el('p.empty', { text: 'まだニュースは無い。' })),

      card('現役の強豪', table(['馬名', '年齢', '戦績', '獲得賞金'],
        G.topHorses(g, 10).map((h) => ({
          cells: [
            el('span', { text: h.name, class: h.ownerId === 'player' ? 'mine' : null }),
            `${g.world.year - h.birthYear}歳${h.sex}`,
            `${h.starts}戦${h.wins}勝`,
            formatMoney(h.earnings),
          ],
          onclick: () => app.go('stable', { id: h.id, foreign: true }),
        })), { align: [, 'c', 'c', 'r'] })),
    ]),
  ]);
}
