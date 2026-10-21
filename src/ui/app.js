// 画面の殻。
// ルーティングと、どの画面からでも使う共通のヘッダ（年週・資金・週送り）を持つ。

import { el, clear, button, toast, modal, card, table } from './dom.js';
import * as G from '../sim/game.js';
import { saveLocal, loadLocal, slotInfo, clearSlot } from '../sim/save.js';
import { formatMoney } from '../core/util.js';
import { weekLabel } from '../sim/schedule.js';
import { titleScreen } from './screens/title.js';
import { homeScreen } from './screens/home.js';
import { stableScreen } from './screens/stable.js';
import { racesScreen } from './screens/races.js';
import { farmScreen } from './screens/farm.js';
import { recordsScreen } from './screens/records.js';
import { raceDayScreen } from './screens/raceday.js';

const SCREENS = {
  title: titleScreen,
  home: homeScreen,
  stable: stableScreen,
  races: racesScreen,
  farm: farmScreen,
  records: recordsScreen,
  raceday: raceDayScreen,
};

const NAV = [
  { id: 'home', name: 'ホーム' },
  { id: 'stable', name: '所有馬' },
  { id: 'races', name: '番組表' },
  { id: 'farm', name: '牧場' },
  { id: 'records', name: '記録' },
];

export function start(root) {
  const app = {
    game: null,
    screen: 'title',
    params: {},
    root,

    go(screen, params = {}) {
      // 3D を開いていたら WebGL を片付ける。放っておくとコンテキストが溢れる。
      if (app.cleanup) { app.cleanup(); app.cleanup = null; }
      app.screen = screen;
      app.params = params;
      app.render();
      // 画面を切り替えたら先頭へ。長い一覧のあとに詳細を開くときに効く。
      document.querySelector('.main')?.scrollTo?.(0, 0);
    },

    /** 週送り。自分の馬が走るレースがあれば観戦画面へ寄る。 */
    next() {
      if (!app.game) return;
      const hadEntries = G.myEntries(app.game).length > 0;
      const out = G.nextWeek(app.game);
      app.lastWeek = out;
      if (out.myRaces.length > 0) {
        app.go('raceday', { races: out.myRaces, week: out });
      } else {
        if (hadEntries) toast('登録した馬は出走できなかった');
        app.go('home');
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
        app.go('home');
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
      clear(root);
      const screen = SCREENS[app.screen] ?? homeScreen;
      if (app.screen === 'title' || !app.game) {
        root.appendChild(el('div.app.plain', titleScreen(app)));
        return;
      }
      root.appendChild(el('div.app', [
        header(app),
        el('div.main', screen(app)),
      ]));
    },
  };

  app.render();
  window.addEventListener('resize', () => {
    if (app.onResize) app.onResize();
  });
  // キーボード：N で週送り、S でセーブ。
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (!app.game) return;
    if (e.key === 'n' || e.key === 'N') app.next();
    if (e.key === 's' || e.key === 'S') app.openSaveMenu();
  });
  return app;
}

function header(app) {
  const g = app.game;
  const t = G.now(g);
  const f = G.finance(g);
  const entries = G.myEntries(g).length;
  return el('header.topbar', [
    el('div.tb-left', [
      el('div.tb-farm', { text: g.world.player.farmName }),
      el('div.tb-date', { text: `${t.year}年 ${t.label}` }),
    ]),
    el('div.tb-mid', NAV.map((n) => el('button.navb', {
      text: n.name,
      class: app.screen === n.id ? 'on' : null,
      onclick: () => app.go(n.id),
    }))),
    el('div.tb-right', [
      el('div.tb-money', [
        el('span.lbl', { text: '資金' }),
        el('span.val', { text: formatMoney(f.money), class: f.money < 0 ? 'minus' : null }),
      ]),
      button('セーブ', () => app.openSaveMenu(), { cls: 'ghost sm' }),
      button(entries ? `次の週へ（登録${entries}）` : '次の週へ', () => app.next(), { cls: 'primary' }),
    ]),
  ]);
}
