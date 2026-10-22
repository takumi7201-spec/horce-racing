// 画面の殻。
// ルーティングと、どの画面からでも使う共通の枠（上の帯・左のメニュー・NEXT）を持つ。
//
// 後ろには牧場の 3D をずっと置いておく。画面の切り替えで消すのは前面の UI だけで、
// 3D は止める・ぼかす・再開するだけ（WebGL を作り直すとコンテキストが溢れる）。

import { el, clear, button, toast, modal, card, table } from './dom.js';
import * as G from '../sim/game.js';
import { saveLocal, loadLocal, slotInfo, clearSlot } from '../sim/save.js';
import { loadHorseSprite } from './horse-sprite.js';
import { icon } from './icons.js';
import { createPasture } from '../render3d/pasture.js';
import { formatMoney } from '../core/util.js';
import { weekLabel } from '../sim/schedule.js';
import { titleScreen } from './screens/title.js';
import { homeScreen } from './screens/home.js';
import { stableScreen } from './screens/stable.js';
import { racesScreen } from './screens/races.js';
import { farmScreen } from './screens/farm.js';
import { recordsScreen } from './screens/records.js';
import { raceDayScreen } from './screens/raceday.js';
import { yearEndScreen } from './screens/yearend.js';

const SCREENS = {
  title: titleScreen,
  home: homeScreen,
  stable: stableScreen,
  races: racesScreen,
  farm: farmScreen,
  records: recordsScreen,
  raceday: raceDayScreen,
  yearend: yearEndScreen,
};

const NAV = [
  { id: 'home', name: 'ホーム', icon: 'home' },
  { id: 'stable', name: '所有馬', icon: 'horse' },
  { id: 'races', name: '番組表', icon: 'calendar' },
  { id: 'farm', name: '牧場', icon: 'barn' },
  { id: 'records', name: '記録', icon: 'trophy' },
];

/** タイトルの放牧地に歩かせる飾りの馬。所有馬がまだ居ないので名前は出さない。 */
const TITLE_HORSES = [
  { id: 11, name: '', coat: '鹿毛' }, { id: 12, name: '', coat: '栗毛' },
  { id: 13, name: '', coat: '芦毛' }, { id: 14, name: '', coat: '黒鹿毛' },
  { id: 15, name: '', coat: '鹿毛', age: 1 },
];

/** 来た道を覚えておく深さ。これを超えたら古いほうから捨てる。 */
const NAV_MAX = 24;

/** 同じ画面を同じ引数で開き直したか。連打で履歴が膨らまないようにする。 */
const sameView = (a, screen, params) => a.screen === screen
  && (a.params.id ?? null) === (params.id ?? null)
  && (a.params.tab ?? null) === (params.tab ?? null)
  && (a.params.damId ?? null) === (params.damId ?? null);

export function start(root) {
  const app = {
    game: null,
    screen: 'title',
    params: {},
    // 来た道。馬の詳細は 12 か所から開けるので、「戻る」は
    // 行き先を決め打ちにできない（所有馬一覧へ固定していたら、
    // 記録や種牡馬名鑑から開いた他人の馬からも所有馬へ飛んでいた）。
    stack: [],
    root,

    go(screen, params = {}, { replace = false } = {}) {
      // 3D を開いていたら WebGL を片付ける。放っておくとコンテキストが溢れる。
      if (app.cleanup) { app.cleanup(); app.cleanup = null; }
      if (!replace && app.screen !== 'title' && !sameView(app, screen, params)) {
        // レース観戦の途中に戻されると 3D が走り直してしまうので、
        // 履歴には着順の画面として積む。
        const p = app.screen === 'raceday' ? { ...app.params, phase: 'result' } : app.params;
        app.stack.push({ screen: app.screen, params: p });
        if (app.stack.length > NAV_MAX) app.stack.shift();
      }
      app.screen = screen;
      app.params = params;
      app.render();
      // 画面を切り替えたら先頭へ。長い一覧のあとに詳細を開くときに効く。
      document.querySelector('.main')?.scrollTo?.(0, 0);
    },

    /** 直前の画面へ戻る。履歴が空ならホーム。 */
    back() {
      const prev = app.stack.pop();
      if (!prev) return app.go('home', {}, { replace: true });
      if (app.cleanup) { app.cleanup(); app.cleanup = null; }
      app.screen = prev.screen;
      app.params = prev.params;
      app.render();
      document.querySelector('.main')?.scrollTo?.(0, 0);
      return undefined;
    },

    /** 週送り。自分の馬が走るレースがあれば観戦画面へ寄る。 */
    next() {
      if (!app.game) return;
      const hadEntries = G.myEntries(app.game).length > 0;
      const out = G.nextWeek(app.game);
      app.lastWeek = out;
      // 12 月 4 週を進めると年末処理。レースを観たあとでも見られるよう取っておく。
      if (out.yearSummary) app.pendingYearEnd = out.yearSummary;
      if (out.myRaces.length > 0) {
        app.go('raceday', { races: out.myRaces, week: out });
      } else if (out.yearSummary) {
        app.go('yearend');
      } else {
        if (hadEntries) toast('登録した馬は出走できなかった');
        app.go('home');
        // 行事が始まった週は知らせる（セールは開催週を逃すと 1 年待つことになる）。
        const ev = G.eventsNow(app.game).filter((e) => e.from === app.game.world.week);
        if (ev.length) toast(`${ev.map((e) => e.name).join('・')}が始まった`);
      }
    },

    async save(slot = 1) {
      toast(`スロット${slot} に保存中…`);
      try {
        const n = await saveLocal(app.game, slot);
        toast(`スロット${slot} に保存した（${(n / 1024 / 1024).toFixed(1)}MB）`);
      } catch (e) {
        toast(`保存できなかった：${e.message}`, { bad: true });
      }
    },

    async load(slot = 1) {
      toast(`スロット${slot} を読み込み中…`);
      try {
        const g = await loadLocal(slot);
        if (!g) return toast('そのスロットは空', { bad: true });
        app.game = g;
        app.stack.length = 0;
        app.go('home', {}, { replace: true });
        toast(`スロット${slot} を読み込んだ`);
      } catch (e) {
        toast(`読み込めなかった：${e.message}`, { bad: true });
      }
    },

    openSaveMenu() {
      const rows = [1, 2, 3].map((slot) => {
        const info = slotInfo(slot);
        return [
          `スロット${slot}`,
          info ? `${info.year}年 ${weekLabel(info.week)}` : '—',
          info ? info.farm : '空',
          info ? formatMoney(info.money) : '—',
          el('div.row-btns', [
            button('保存', async () => {
              m.close();
              await app.save(slot);
              app.openSaveMenu();
            }, { cls: 'sm' }),
            button('読込', () => { m.close(); app.load(slot); }, { cls: 'sm', disabled: !info }),
            button('消去', async () => {
              if (!confirm(`スロット${slot} を消す？`)) return;
              m.close();
              await clearSlot(slot);
              app.openSaveMenu();
            }, { cls: 'sm ghost', disabled: !info }),
          ]),
        ];
      });
      const m = modal('セーブ / ロード', [
        table(['', '時期', '牧場', '資金', ''], rows),
        el('p.note', 'セーブはこの端末のブラウザに保存される。'),
      ]);
    },

    render() {
      clear(ui);
      app.onArrow = null;
      const screen = SCREENS[app.screen] ?? homeScreen;
      if (app.screen === 'title' || !app.game) {
        syncBackdrop(app, 'title');
        ui.appendChild(el('div.app.plain', titleScreen(app)));
        return;
      }
      syncBackdrop(app, app.screen);
      ui.appendChild(el('div.app.shell', { 'data-screen': app.screen }, [
        header(app),
        sideNav(app),
        el('main.main', screen(app)),
        dock(app),
      ]));
    },
  };

  // 背景（3D の放牧地）と前面（画面）を分けて持つ。render() が消すのは前面だけ。
  const bg = el('div.bg', [
    el('canvas.pasture'),
    el('div.plabels'),
    el('div.bg-shade'),
  ]);
  const ui = el('div.ui');
  root.append(bg, ui);
  app.bg = bg;

  // スプライトは先に読み込んでおく。描画は同期なので、
  // 間に合わなければ読み終わった時点で <img> に差し込まれる。
  loadHorseSprite();

  app.render();
  window.addEventListener('resize', () => {
    app.pasture?.resize();
    if (app.pasture && app.game) syncBackdrop(app, app.screen);
    if (app.onResize) app.onResize();
  });
  // タブを離れている間は放牧地を止める（電池を食わないように）。
  document.addEventListener('visibilitychange', () => {
    if (!app.pasture) return;
    if (document.hidden) app.pasture.stop();
    else if (app.bgLive) app.pasture.start();
  });
  // キーボード：N で週送り、S でセーブ。
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (!app.game) return;
    if (e.key === 'n' || e.key === 'N') app.next();
    if (e.key === 's' || e.key === 'S') app.openSaveMenu();
    // 馬の詳細では ← → で前後の馬へ。
    if (app.onArrow && document.querySelector('.modal-wrap') == null) {
      if (e.key === 'ArrowLeft') app.onArrow(-1);
      if (e.key === 'ArrowRight') app.onArrow(1);
    }
  });
  return app;
}

/**
 * 背景の放牧地を画面に合わせる。
 * ホームとタイトルでは動かし、ほかの画面では止めてぼかす（表を読む邪魔をしない）。
 * レース観戦は自前の 3D を持つので、こちらは止めて隠す。
 */
function syncBackdrop(app, screen) {
  const bg = app.bg;
  if (!app.pasture && !app.noGL) {
    try {
      app.pasture = createPasture(bg.querySelector('canvas'), bg.querySelector('.plabels'));
    } catch (e) {
      // WebGL が使えない端末では、絵の代わりに空と草原のグラデーションを敷く。
      app.noGL = true;
      bg.classList.add('nogl');
    }
  }
  // 馬の詳細では放牧地を「見せ場」にして、その馬を 1 頭だけ大きく立たせる。
  const portraitId = screen === 'stable' && app.params.id != null && app.game ? app.params.id : null;
  const live = screen === 'home' || screen === 'title' || portraitId != null;
  bg.classList.toggle('dim', !live);
  bg.classList.toggle('portrait', portraitId != null);
  bg.classList.toggle('off', screen === 'raceday');
  app.bgLive = live;
  const p = app.pasture;
  if (!p) return;
  if (screen === 'title') {
    p.setHorses(TITLE_HORSES, { labels: false });
    p.setShift(0);
  } else if (app.game) {
    p.setHorses(G.ranchHorses(app.game), { labels: true });
    // 右の情報パネル（約 380px）と左のメニュー（約 110px）の間を見せたい中心にする。
    // 縦長の画面ではパネルが下半分に来るので、絵を上へ寄せて馬を出す。
    const wide = window.innerWidth > 900;
    if (portraitId != null) {
      // 左に戦績の板が乗るので、馬は中央よりやや右へ。縦長の画面では上へ。
      if (wide) p.setShift(-Math.round(window.innerWidth * 0.08), Math.round(window.innerHeight * 0.15));
      else p.setShift(-Math.round(window.innerWidth * 0.14), Math.round(window.innerHeight * 0.08));
    } else if (screen !== 'home') p.setShift(0, 0);
    else if (wide) p.setShift(135, 0);
    else p.setShift(0, Math.round(window.innerHeight * 0.16));
  }
  if (portraitId != null) {
    const v = G.horseView(app.game, portraitId);
    const racing = v && !v.dead && !v.retired && !v.broodmare && !v.stallion;
    p.setPortrait(v ? { id: v.id, coat: v.coat, age: v.age, tack: racing } : null);
  } else {
    p.setPortrait(null);
  }
  p.setLabels(screen === 'home');
  if (live && !document.hidden) p.start();
  else p.stop();
}

/** 上の帯。資金・年週と開催・数字のチップ。 */
function header(app) {
  const g = app.game;
  const t = G.now(g);
  const f = G.finance(g);
  const [month, wk] = t.label.match(/\d+/g) ?? ['', ''];
  const chip = (ic, label, value) => el('div.hb-chip', [
    icon(ic, { size: 18 }),
    el('span.hc-l', { text: label }),
    el('b.hc-v', { text: String(value) }),
  ]);
  return el('header.hudbar', [
    el('div.hb-money', [
      el('span.hb-coin', icon('coin', { size: 22 })),
      el('div.hb-mv', [
        el('span.hb-ml', { text: '所持金' }),
        el('b', { text: formatMoney(f.money).replace(/円$/, ''), class: f.money < 0 ? 'minus' : null }),
        el('small', { text: '円' }),
      ]),
    ]),
    el('div.hb-date', [
      el('div.hb-year', { text: `${t.year}年` }),
      el('div.hb-week', [el('b', { text: month }), '月', el('b', { text: wk }), '週']),
      el('div.hb-meet', G.meetings(g).map((n) => el('span', { text: n }))),
    ]),
    el('div.hb-chips', [
      chip('trophy', 'GI', f.g1),
      chip('star', '勝利', f.wins),
      chip('horse', '所有馬', f.horses),
      chip('mare', '繁殖', f.broodmares),
    ]),
    el('div.hb-farm', [
      el('b', { text: g.world.player.farmName }),
      el('span', { text: g.world.player.name ? `馬主 ${g.world.player.name}` : '' }),
    ]),
  ]);
}

/** 左の縦メニュー。 */
function sideNav(app) {
  return el('nav.side', NAV.map((n) => el('button.sideb', {
    class: app.screen === n.id ? 'on' : null,
    title: n.name,
    onclick: () => app.go(n.id),
  }, [
    el('span.sb-tile', icon(n.icon, { size: 30 })),
    el('span.sb-label', { text: n.name }),
  ])));
}

/** 左下の NEXT と小さなセーブ。 */
function dock(app) {
  const entries = G.myEntries(app.game).length;
  return el('div.dock', [
    el('button.nextb', { onclick: () => app.next(), title: '次の週へ（N）' }, [
      el('span.nb-ring', [
        icon('next', { size: 34 }),
        el('b', { text: 'NEXT' }),
        el('small', { text: '次の週へ' }),
      ]),
      entries ? el('span.nb-badge', { text: `出走 ${entries}` }) : null,
    ]),
    el('button.saveb', { onclick: () => app.openSaveMenu(), title: 'セーブ / ロード（S）' }, [
      icon('save', { size: 16 }), el('span', { text: 'セーブ' }),
    ]),
  ]);
}
