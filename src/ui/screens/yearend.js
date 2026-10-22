// 年末処理。表彰式・引退馬・種牡馬と繁殖牝馬の登録・馬名登録・牧場の確認。
// 12 月 4 週を進めたときに sim が作る要約（nextWeek().yearSummary）を並べるだけ。

import { el, card, table, button, kv } from '../dom.js';
import { icon } from '../icons.js';
import { formatMoney } from '../../core/util.js';

export function yearEndScreen(app) {
  const s = app.pendingYearEnd ?? app.lastYearEnd;
  if (!s) {
    app.go('home', {}, { replace: true });
    return el('div');
  }
  // 一度見たら「済み」にするが、ホームから見返せるよう残しておく。
  app.lastYearEnd = s;
  const done = () => {
    app.pendingYearEnd = null;
    app.go('home', {}, { replace: true });
  };
  const horseLink = (id, text, cls = null) => el('a.hlink', {
    text, class: cls, href: '#', onclick: (e) => { e.preventDefault(); app.go('stable', { id }); },
  });

  return el('div.yearend', [
    el('div.ye-head', [
      el('span.ye-ico', icon('trophy', { size: 30 })),
      el('div', [el('h1', { text: `${s.year}年 年末処理` }), el('p', { text: '表彰式・引退馬の決定・種牡馬と繁殖牝馬の登録・馬名登録・牧場の確認' })]),
      button(`${s.year + 1}年へ`, done, { cls: 'primary big' }),
    ]),
    el('div.cols2', [
      el('div.col', [
        card('表彰式', [
          s.awards.length
            ? el('ul.ye-awards', s.awards.map((a) => el('li', [
              el('span.ye-award', { text: a.kind }), horseLink(a.horseId, a.name),
            ])))
            : el('p.empty', { text: '受賞馬なし' }),
          el('h4', { text: 'リーディング' }),
          kv([
            ['騎手', s.leaders.jockey], ['調教師', s.leaders.trainer],
            ['種牡馬', s.leaders.sire], ['馬主', s.leaders.owner],
          ]),
        ]),
        card(`引退馬（重賞馬と所有馬 ${s.retiredTotal ?? s.retired.length} 頭のうち主な馬）`, s.retired.length
          ? table(['馬名', 'その後'], s.retired.map((r) => ({
            cells: [horseLink(r.id, r.name, r.mine ? 'mine' : null), r.to],
            cls: r.mine ? 'mine' : null,
          })))
          : el('p.empty', { text: '重賞馬と所有馬の引退はなかった。' })),
      ]),
      el('div.col', [
        card('種牡馬・繁殖牝馬の登録', [
          kv([
            ['新しい種牡馬', `${s.newSiresTotal ?? s.newSires.length} 頭（主な馬）`],
            ['新しい繁殖牝馬', `${s.newMares} 頭`],
          ]),
          s.newSires.length ? el('div.badges', s.newSires.map((x) => el('span.badge', {
            text: x.fee ? `${x.name} ${formatMoney(x.fee)}` : x.name, class: x.mine ? 'mine' : null,
          }))) : null,
          s.newLines?.length ? el('p.note', { text: `系統の確立：${s.newLines.map((x) => `${x.name}系`).join('・')}` }) : null,
        ]),
        card(`馬名登録（${s.named.length} 頭）`, s.named.length
          ? table(['これまでの呼び名', '登録した馬名'], s.named.map((n) => [n.from, horseLink(n.id, n.name, 'mine')]))
          : el('p.empty', { text: '今年は馬名を登録する所有馬がいなかった。' })),
        card('牧場の確認', kv([
          ['資金', el('b', { text: formatMoney(s.farm.money), class: s.farm.money < 0 ? 'bad' : null })],
          ['現役馬', `${s.farm.horses} 頭`],
          ['繁殖牝馬', `${s.farm.broodmares} 頭`],
          ['種牡馬', `${s.farm.stallions} 頭`],
          ['幼駒', `${s.farm.young} 頭`],
        ])),
      ]),
    ]),
  ]);
}
