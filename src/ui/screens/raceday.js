// レース当日。出馬表 →（3D 観戦）→ 着順。
//
// 3D は走行ログの再生なので、観戦をとばしても結果は同じ。
// カメラも早送りも結果に影響しない。

import { el, card, table, button, frameChip, toast, tabs } from '../dom.js';
import * as G from '../../sim/game.js';
import { formatMoney, formatTime, formatSec } from '../../core/util.js';
import { createRaceView, CAMERAS } from '../../render3d/raceview.js';
import { showResult } from './races.js';

export function raceDayScreen(app) {
  const races = app.params.races ?? [];
  if (!races.length) {
    return card('レース', el('p.empty', { text: '観戦できるレースが無い。' }));
  }
  const idx = app.params.index ?? 0;
  const race = races[idx];
  const phase = app.params.phase ?? 'card';

  const next = () => {
    if (idx + 1 < races.length) app.go('raceday', { races, index: idx + 1, phase: 'card' });
    else app.go('home');
  };

  if (phase === 'card') return raceCard(app, race, races, idx, next);
  if (phase === 'watch') return watchView(app, race, races, idx, next);
  return resultView(app, race, races, idx, next);
}

// ---------------------------------------------------------------- 出馬表

function raceCard(app, race, races, idx, next) {
  const g = app.game;
  const mineIds = new Set(race.results
    .filter((r) => g.world.horses.get(r.horseId)?.ownerId === 'player')
    .map((r) => r.horseId));

  // 出馬表は「結果の並び」ではなく馬番順で見せる。
  const byGate = race.results.slice().sort((a, b) => a.gate - b.gate);

  return el('div.raceday', [
    el('header.race-h', [
      el('div.race-title', [
        race.grade ? el('span.grade-badge', { text: race.grade }) : null,
        el('h1', { text: race.name }),
      ]),
      el('div.race-sub', {
        text: `${race.courseName}　${race.surface}${race.distance}m　${race.ground}　${race.weather}`
          + `　${race.results.length}頭立て`,
      }),
    ]),
    card('出馬表', table(
      ['枠', '馬番', '馬名', '性齢', '斤量', '騎手', '脚質', '人気', 'オッズ'],
      byGate.map((r) => ({
        cells: [
          frameChip(r.frame, r.frame), String(r.gate),
          el('b', { text: r.name }), `${r.sex}${r.age}`, r.weight,
          r.jockeyName, r.styleLabel,
          r.popularity ? `${r.popularity}人気` : '—',
          r.odds ? r.odds.toFixed(1) : '—',
        ],
        cls: mineIds.has(r.horseId) ? 'mine' : null,
      })), { align: ['c', 'c', , 'c', 'c', , 'c', 'c', 'c'] })),
    el('div.race-actions', [
      button('3D で観戦する', () => app.go('raceday', { races, index: idx, phase: 'watch' }), { cls: 'primary big' }),
      button('結果だけ見る', () => app.go('raceday', { races, index: idx, phase: 'result' }), { cls: 'big' }),
    ]),
    races.length > 1 ? el('p.note', { text: `この週の自分のレース ${idx + 1} / ${races.length}` }) : null,
  ]);
}

// ---------------------------------------------------------------- 3D 観戦

function watchView(app, race, races, idx, next) {
  const g = app.game;
  const myId = race.results.find((r) => g.world.horses.get(r.horseId)?.ownerId === 'player')?.horseId ?? null;

  const canvas = el('canvas.race3d');
  const rankList = el('ol.rank');
  const hud = el('div.hud', [
    el('div.hud-dist'),
    el('div.hud-time'),
  ]);
  const camBar = el('div.cambar');
  const speedBar = el('div.speedbar');
  const wrap = el('div.watch', [
    el('div.view', [canvas, hud, el('div.rankbox', [el('h3', { text: '順位' }), rankList])]),
    el('div.controls', [camBar, speedBar, el('div.ctrl-right')]),
  ]);

  // 画面に入ってから three.js を初期化する（canvas のサイズが決まってから）。
  let view = null;
  requestAnimationFrame(() => {
    try {
      view = createRaceView(canvas, race, { focusId: myId, camera: 'tv' });
    } catch (e) {
      wrap.appendChild(el('p.bad', { text: `3D を初期化できなかった：${e.message}` }));
      return;
    }
    app.onResize = () => view && view.resize();

    const names = new Map(race.results.map((r) => [r.horseId, r]));
    view.onFrame = (st) => {
      hud.firstChild.textContent = st.remaining > 0.5 ? `残り ${Math.round(st.remaining)}m` : 'ゴール';
      hud.lastChild.textContent = `${st.time.toFixed(1)} 秒`;
      rankList.textContent = '';
      for (const r of st.ranked.slice(0, 10)) {
        const meta = names.get(r.id);
        rankList.appendChild(el('li', {
          class: r.id === myId ? 'mine' : null,
        }, [
          frameChip(r.frame, r.gate),
          el('span.rn', { text: r.name }),
          el('span.rg', { text: r.gap < 0.1 ? '先頭' : `${r.gap.toFixed(1)}m` }),
        ]));
      }
    };
    view.onFinish = () => {
      setTimeout(() => {
        if (app.screen === 'raceday') app.go('raceday', { races, index: idx, phase: 'result' });
      }, 1200);
    };

    for (const c of CAMERAS) {
      camBar.appendChild(el('button.tab', {
        text: c.name,
        class: c.id === 'tv' ? 'on' : null,
        onclick: (e) => {
          view.setCamera(c.id);
          [...camBar.children].forEach((b) => b.classList.remove('on'));
          e.currentTarget.classList.add('on');
          view.draw();
        },
      }));
    }
    for (const s of [0.5, 1, 2, 4]) {
      speedBar.appendChild(el('button.tab', {
        text: `×${s}`,
        class: s === 1 ? 'on' : null,
        onclick: (e) => {
          view.setSpeed(s);
          [...speedBar.children].forEach((b) => b.classList.remove('on'));
          e.currentTarget.classList.add('on');
        },
      }));
    }
    const right = wrap.querySelector('.ctrl-right');
    const pauseBtn = button('一時停止', () => {
      view.toggle();
      pauseBtn.textContent = view.playing ? '一時停止' : '再開';
    }, { cls: 'sm' });
    right.appendChild(pauseBtn);
    right.appendChild(button('最初から', () => { view.seek(0); view.play(); }, { cls: 'sm ghost' }));
    right.appendChild(button('結果へ', () => {
      view.dispose();
      app.go('raceday', { races, index: idx, phase: 'result' });
    }, { cls: 'sm primary' }));

    view.play();
  });

  // 画面を離れるときに WebGL を片付ける。
  app.cleanup = () => { if (view) view.dispose(); view = null; app.onResize = null; };
  return wrap;
}

// ---------------------------------------------------------------- 結果

function resultView(app, race, races, idx, next) {
  const g = app.game;
  if (app.cleanup) { app.cleanup(); app.cleanup = null; }
  const mine = race.results.filter((r) => g.world.horses.get(r.horseId)?.ownerId === 'player');
  const win = race.results[0];

  return el('div.raceday', [
    el('header.race-h', [
      el('div.race-title', [
        race.grade ? el('span.grade-badge', { text: race.grade }) : null,
        el('h1', { text: `${race.name} 　着順` }),
      ]),
      el('div.race-sub', {
        text: `${race.courseName}　${race.surface}${race.distance}m　${race.ground}　`
          + `勝ち時計 ${formatTime(race.winnerTime)}　${race.pace?.label ?? ''}`
          + (Number.isFinite(race.pace?.first) ? `（前半 ${race.pace.first.toFixed(1)} / 後半 ${race.pace.last.toFixed(1)}）` : ''),
      }),
    ]),

    mine.length ? card('自分の馬', table(
      ['着', '馬名', '騎手', 'タイム', '着差', '上3F', '通過', '賞金', '回顧'],
      mine.map((r) => [
        el('b', { text: `${r.order}着`, class: r.order === 1 ? 'win' : null }),
        r.name, r.jockeyName, formatTime(r.time), r.margin, formatSec(r.last3f),
        (r.passing ?? []).join('-'), formatMoney(r.prize), r.comment,
      ]), { align: ['c', , , 'c', 'c', 'c', 'c', 'r'] })) : null,

    card('全着順', table(
      ['着', '枠', '馬番', '馬名', '性齢', '斤量', '騎手', 'タイム', '着差', '上3F', '通過', '人気', 'オッズ', '脚質', '回顧'],
      race.results.map((r) => ({
        cells: [
          el('b', { text: String(r.order), class: r.order === 1 ? 'win' : null }),
          frameChip(r.frame, r.frame), String(r.gate),
          r.name, `${r.sex}${r.age}`, r.weight, r.jockeyName,
          formatTime(r.time), r.margin, formatSec(r.last3f),
          (r.passing ?? []).join('-'),
          r.popularity ? String(r.popularity) : '—',
          r.odds ? r.odds.toFixed(1) : '—',
          r.styleLabel, r.comment,
        ],
        cls: g.world.horses.get(r.horseId)?.ownerId === 'player' ? 'mine' : null,
        onclick: () => app.go('stable', { id: r.horseId }),
      })), { align: ['c', 'c', 'c', , 'c', 'c', , 'c', 'c', 'c', 'c', 'c', 'c', 'c'] })),

    el('div.race-actions', [
      race.log ? button('もう一度見る', () => app.go('raceday', { races, index: idx, phase: 'watch' }), { cls: '' }) : null,
      button(idx + 1 < races.length ? '次のレースへ' : 'ホームへ戻る', next, { cls: 'primary big' }),
    ]),
  ]);
}
