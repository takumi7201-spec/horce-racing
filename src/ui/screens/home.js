// ホーム。牧場の 3D を主役にして、情報は右のパネルと下の帯に寄せる。
//
// 表を並べたダッシュボードだった頃は「管理画面」にしか見えなかったので、
// 放牧地の馬を眺めながら、今週の要点だけを 1 枚ずつめくって読む形にした。
// 細かい表は各画面（所有馬・番組表・記録）に任せる。

import { el, button } from '../dom.js';
import { icon } from '../icons.js';
import { horseImg } from '../horse-sprite.js';
import * as G from '../../sim/game.js';
import { formatMoney, formatTime } from '../../core/util.js';
import { fitLabel, condLabel } from '../../sim/training.js';

const GRADE_ORDER = { GI: 0, GII: 1, GIII: 2 };

export function homeScreen(app) {
  const g = app.game;
  const rank = G.ownerRank(g);
  const week = G.schedule(g, 1)[0];
  const graded = week.races.filter((r) => /^G/.test(r.grade ?? ''))
    .sort((a, b) => (GRADE_ORDER[a.grade] ?? 9) - (GRADE_ORDER[b.grade] ?? 9));
  const pages = [
    entriesPage(app),
    gradedPage(app, graded),
    horsesPage(app),
    resultsPage(app),
    topPage(app),
    financePage(app),
  ];
  const n = pages.length;
  app.homePage = ((app.homePage ?? 0) % n + n) % n;

  const stack = el('div.pstack');
  const dots = el('div.pdots');
  const flip = (d) => {
    app.homePage = (app.homePage + d + n) % n;
    show();
  };
  function show() {
    stack.textContent = '';
    stack.appendChild(pages[app.homePage]);
    dots.textContent = '';
    pages.forEach((_, i) => dots.appendChild(el('i', {
      class: i === app.homePage ? 'on' : null,
      onclick: () => { app.homePage = i; show(); },
    })));
  }
  show();

  return el('div.home', [
    el('aside.hpanel', [
      el('div.rankplate', [
        el('span.rp-ico', icon('medal', { size: 30 })),
        el('div.rp-t', [
          el('span', { text: '馬主ランキング' }),
          el('div.rp-v', [el('b', { text: String(rank.rank) }), '位', el('small', { text: ` / ${rank.total}人` })]),
        ]),
        el('span.rp-grade', { text: rank.grade, class: `g-${rank.grade}` }),
      ]),
      featureStrip(app, graded[0]),
      el('div.pcards', [
        el('button.parrow', { onclick: () => flip(-1), title: '前へ' }, icon('up', { size: 20 })),
        stack,
        el('button.parrow', { onclick: () => flip(1), title: '次へ' }, icon('down', { size: 20 })),
        dots,
      ]),
    ]),
    newsBar(app),
  ]);
}

/** 今週いちばん格の高いレース。 */
function featureStrip(app, r) {
  if (!r) {
    return el('div.feature.none', [
      el('span.ft-l', { text: '今週の目玉' }),
      el('span.ft-n', { text: '重賞なし' }),
    ]);
  }
  return el('button.feature', { onclick: () => app.go('races') }, [
    el('span.ft-l', { text: '今週の目玉' }),
    el('span.ft-g', { text: r.grade, class: r.grade === 'GI' ? 'g1' : null }),
    el('span.ft-n', { text: r.name }),
    el('span.ft-c', { text: `${r.courseName} ${r.surface}${r.distance}m` }),
  ]);
}

/** 1 枚のカード。上に札と見出し、下に中身。 */
function page(tag, ic, title, body, action = null) {
  return el('section.pcard', [
    el('header', [
      el('span.pc-tag', { text: tag }),
      el('span.pc-ico', icon(ic, { size: 18 })),
      el('h3', { text: title }),
    ]),
    el('div.pc-b', body),
    action ? el('footer', action) : null,
  ]);
}

function entriesPage(app) {
  const g = app.game;
  const entries = G.myEntries(g);
  if (!entries.length) {
    return page('出走', 'gate', '今週の出走予定', [
      el('p.pc-empty', { text: '今週の登録は無い。番組表から選ぶか、所有馬の画面から登録する。' }),
    ], button('番組表を開く', () => app.go('races'), { cls: 'sm primary' }));
  }
  return page('出走', 'gate', `今週の出走予定（${entries.length}頭）`, el('ul.plist', entries.map((e) => el('li', [
    el('div.pl-main', [
      el('b.mine', { text: e.horse.name }),
      el('span', { text: e.race.name, class: e.race.grade ? 'grade' : null }),
    ]),
    el('div.pl-sub', { text: `${e.race.courseName}${e.race.surface}${e.race.distance}m ／ ${e.jockeyName}` }),
    button('取消', () => { G.cancelEntry(g, e.raceId); app.render(); }, { cls: 'sm ghost' }),
  ]))), el('span.pc-note', { text: 'NEXT で発走する' }));
}

function gradedPage(app, graded) {
  if (!graded.length) {
    return page('重賞', 'trophy', '今週の重賞', el('p.pc-empty', { text: '今週は重賞が無い。' }),
      button('番組表', () => app.go('races'), { cls: 'sm' }));
  }
  return page('重賞', 'trophy', '今週の重賞', el('ul.plist', graded.slice(0, 5).map((r) => el('li', {
    onclick: () => app.go('races'),
    class: 'click',
  }, [
    el('div.pl-main', [
      el('span.gchip', { text: r.grade, class: r.grade === 'GI' ? 'g1' : null }),
      el('b', { text: r.name }),
    ]),
    el('div.pl-sub', { text: `${r.courseName} ${r.surface}${r.distance}m ／ ${r.ageLabel}${r.sexLabel ? ' 牝' : ''}` }),
  ]))), button('番組表', () => app.go('races'), { cls: 'sm' }));
}

function horsesPage(app) {
  const g = app.game;
  const horses = G.myHorses(g);
  if (!horses.length) {
    return page('所有馬', 'horse', '所有馬の様子', el('p.pc-empty', {
      text: '所有馬が居ない。セリ市（10 月）で買うか、配合で産ませる。',
    }));
  }
  return page('所有馬', 'horse', `所有馬の様子（${horses.length}頭）`, el('ul.plist.horses', horses.slice(0, 6).map((h) => {
    const v = G.horseView(g, h.id);
    const state = v.injury ? v.injury.name : v.stable === 'stable' ? `在厩 ${fitLabel(v.fit)}` : '放牧';
    return el('li', { class: 'click', onclick: () => app.go('stable', { id: h.id }) }, [
      horseImg(h.coat, { size: 'xs', age: v.age }),
      el('div.pl-body', [
        el('div.pl-main', [el('b', { text: h.name }), el('span.pl-cls', { text: `${v.age}歳 ${v.className}` })]),
        el('div.pl-sub', [
          el('span', { text: state, class: v.injury ? 'bad' : null }),
          ` ／ 調子 ${condLabel(v.cond)} ／ ${h.starts}戦${h.wins}勝`,
        ]),
      ]),
    ]);
  })), button('所有馬一覧', () => app.go('stable'), { cls: 'sm' }));
}

function resultsPage(app) {
  const g = app.game;
  const w = g.world;
  const last = app.lastWeek;
  const res = G.recentResults(g);
  if (!last || !res.length) {
    return page('結果', 'flag', '先週の結果', el('p.pc-empty', { text: '週を進めると、ここに先週の結果が出る。' }));
  }
  const mineFirst = res.slice().sort((a, b) => mineIn(w, b) - mineIn(w, a));
  return page('結果', 'flag', `先週の結果（${last.label}）`, el('ul.plist', mineFirst.slice(0, 5).map((r) => {
    const my = r.results.find((x) => w.horses.get(x.horseId)?.ownerId === 'player');
    return el('li', { class: r.log ? 'click' : null, onclick: r.log ? () => app.go('raceday', { races: [r] }) : null }, [
      el('div.pl-main', [
        r.grade ? el('span.gchip', { text: r.grade, class: r.grade === 'GI' ? 'g1' : null }) : null,
        el('b', { text: r.name }),
        el('span.pl-time', { text: formatTime(r.winnerTime) }),
      ]),
      el('div.pl-sub', [
        `1着 ${r.results[0].name}`,
        my ? el('span.mine', { text: ` ／ ${my.name} ${r.results.indexOf(my) + 1}着` }) : null,
      ]),
    ]);
  })));
}

const mineIn = (w, r) => (r.results.some((x) => w.horses.get(x.horseId)?.ownerId === 'player') ? 1 : 0);

function topPage(app) {
  const g = app.game;
  return page('強豪', 'star', '現役の強豪', el('ul.plist', G.topHorses(g, 6).map((h, i) => el('li', {
    class: 'click',
    onclick: () => app.go('stable', { id: h.id, foreign: true }),
  }, [
    el('div.pl-main', [
      el('span.pl-rank', { text: String(i + 1) }),
      el('b', { text: h.name, class: h.ownerId === 'player' ? 'mine' : null }),
      el('span.pl-time', { text: formatMoney(h.earnings) }),
    ]),
    el('div.pl-sub', { text: `${g.world.year - h.birthYear}歳${h.sex} ／ ${h.starts}戦${h.wins}勝` }),
  ]))), button('記録を見る', () => app.go('records'), { cls: 'sm' }));
}

function financePage(app) {
  const f = G.finance(app.game);
  const row = (k, v, cls = null) => el('div.pk', [el('span', { text: k }), el('b', { text: v, class: cls })]);
  return page('経営', 'coin', '牧場の経営', [
    el('div.pkv', [
      row('資金', formatMoney(f.money), f.money < 0 ? 'bad' : null),
      row('週の経費', formatMoney(f.weeklyCost)),
      row('所有馬', `${f.horses}頭（在厩 ${f.stabled}）`),
      row('繁殖牝馬', `${f.broodmares}頭`),
      row('種牡馬', `${f.stallions}頭`),
      row('通算', `${f.starts}戦 ${f.wins}勝（GI ${f.g1}勝）`),
      row('獲得賞金', formatMoney(f.earnings)),
    ]),
    f.titles.length ? el('ul.ptitles', f.titles.slice(-4).map((t) => el('li', [icon('medal', { size: 14 }), t]))) : null,
  ], button('牧場へ', () => app.go('farm'), { cls: 'sm' }));
}

/**
 * 下の帯。今週のニュースを 1 本ずつ流す。
 * 自分の馬の名前は橙で目立たせる（名前で探すと読み飛ばさない）。
 */
function newsBar(app) {
  const g = app.game;
  const w = g.world;
  const items = (w.news ?? []).slice(0, 30);
  const names = G.myHorses(g).map((h) => h.name)
    .concat(G.myBroodmares(g).map((h) => h.name))
    .sort((a, b) => b.length - a.length);
  const text = el('p.nb-text');
  const count = el('span.nb-count');
  let i = 0;

  const render = () => {
    text.textContent = '';
    count.textContent = items.length ? `${i + 1} / ${items.length}` : '';
    const s = items[i] ?? 'まだニュースは無い。NEXT で週を進めよう。';
    text.classList.toggle('mine', s.startsWith('★'));
    // 自分の馬の名前を探して橙で包む。長い名前から当てる（短い名前が部分一致しないように）。
    let rest = s;
    while (rest) {
      let hit = -1;
      let name = '';
      for (const nm of names) {
        const k = rest.indexOf(nm);
        if (k >= 0 && (hit < 0 || k < hit)) { hit = k; name = nm; }
      }
      if (hit < 0) { text.append(rest); break; }
      text.append(rest.slice(0, hit), el('em', { text: name }));
      rest = rest.slice(hit + name.length);
    }
  };
  const step = (d) => {
    if (!items.length) return;
    i = (i + d + items.length) % items.length;
    render();
  };
  render();

  // 7 秒ごとに次へ。画面が入れ替わったら止める（要素が外れたかで判定する）。
  const bar = el('div.newsbar', [
    el('span.nb-ico', icon('news', { size: 20 })),
    text,
    el('div.nb-nav', [
      count,
      el('button', { onclick: () => step(-1), title: '前のニュース' }, icon('up', { size: 16 })),
      el('button', { onclick: () => step(1), title: '次のニュース' }, icon('down', { size: 16 })),
    ]),
  ]);
  const timer = setInterval(() => {
    if (!bar.isConnected) { clearInterval(timer); return; }
    step(1);
  }, 7000);
  return bar;
}
