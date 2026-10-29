// 育成モード（カード）。ガチャ・カード一覧・編成と育成・完成馬・対戦。
// 牧場経営とは別のモードで、世界（game.js）は使わない。入口は sim/ikusei.js だけ。
// プロフィールは localStorage に置く（数 KB。牧場のセーブの IndexedDB とは別）。
// 画面は app.go('ik', { view }) で切り替える。レースの結果（走行ログ）は保存しないので app.ikRace に持つ。

import { el, card, table, button, toast, modal, ask, tabs, frameChip } from '../dom.js';
import * as I from '../../sim/ikusei.js';
import { cardView, epithetOf } from '../cardview.js';
import { createRaceView, CAMERAS } from '../../render3d/raceview.js';
import { formatTime } from '../../core/util.js';
import * as sound from '../sound.js';

const VIEWS = [
  { id: 'home', name: 'ホーム' },
  { id: 'gacha', name: 'ガチャ' },
  { id: 'cards', name: 'カード' },
  { id: 'run', name: '育成' },
  { id: 'stable', name: '完成馬' },
  { id: 'battle', name: '対戦' },
];

const store = () => { try { return window.localStorage; } catch { return null; } };
const save = (app) => I.saveProfile(app.ik, store());
const RCLS = (r) => `rar-${r}`;
/** 一覧のカードの倍率。狭い画面でも 2 枚は並ぶように縮める。 */
const fit = (sc) => Math.min(sc, (window.innerWidth - 74) / 2 / 630);

export function ikuseiScreen(app) {
  app.ik ??= I.loadProfile(store());
  const view = app.params.view ?? 'home';
  const go = (v, extra = {}) => app.go('ik', { view: v, ...extra });
  if (view === 'watch') return watchView(app);
  const body = {
    home: homeView, gacha: gachaView, cards: cardsView, run: runView, stable: stableView, battle: battleView, result: resultView,
  }[view] ?? homeView;
  const navId = view === 'result' ? (app.ikRace?.back ?? 'run') : view;
  return el('div.ik', [
    el('header.ik-top', [
      el('div.ik-logo', [el('b', { text: 'ウイニングロード' }), el('small', { text: 'カード育成' })]),
      tabs(VIEWS, navId, (id) => go(id)),
      button('タイトルへ', () => app.go('title', {}, { replace: true }), { cls: 'sm ghost' }),
    ]),
    el('div.ik-body', body(app, go)),
  ]);
}

// ---------------------------------------------------------------- ホーム

function homeView(app, go) {
  const p = app.ik;
  const have = I.owned(p);
  const run = p.run;
  const best = [...p.finished].sort((a, b) => b.rating - a.rating)[0];
  return [
    el('div.ik-hero', [
      el('h1', { text: 'カード育成' }),
      el('p', { text: 'ガチャで名馬のカードを集め、5 枚（育てる馬 1 枚＋サポート 4 枚）を組んで 2 歳・3 歳の 2 年を育てる。練習と 10 戦のレースで完成した競走馬どうしを戦わせよう。' }),
    ]),
    el('div.ik-tiles', [
      tile('ガチャ', `${p.pulls} 回引いた`, () => go('gacha')),
      tile('カード', `${have.length} / ${I.CARDS.length} 種`, () => go('cards')),
      tile(run ? '育成のつづき' : '育成を始める', run ? `${I.cardById(run.trainee).name}　${I.turnLabel(run)}` : '5 枚を編成する', () => go('run'), 'hot'),
      tile('完成馬', `${p.finished.length} 頭${best ? `　最高 ${best.rank}（${best.name}）` : ''}`, () => go('stable')),
      tile('対戦', 'NPC のランク戦・自分の完成馬どうし', () => go('battle')),
    ]),
    card('遊びかた', [el('ul.howto', [
      el('li', { text: 'ガチャ：第 1 弾【世界の英雄たち】・第 2 弾【異国を制する者たち】。排出率 LM 2%・SSR 6%・SR 15%・R 27%・N 50%。試作なので回数の制限は無い。' }),
      el('li', { text: '育てる馬：カードの能力が出発点、+値が伸びしろ（+5 で上限 1200 点、+1 で 720 点）。距離・馬場の適性もカードのまま。' }),
      el('li', { text: 'サポート：練習場に顔を出すと伸びが増える。得意な練習（カードのいちばん高い能力）で会うと「友情」でさらに伸びる。レア度が高いほど友情が強い。' }),
      el('li', { text: '1 戦ごとに 3 回の練習。体力が 50 を切ると練習に失敗しやすくなる（賢さの練習は失敗しない）。休むと体力が戻る。' }),
      el('li', { text: 'レースは勝ち数でクラスが上がり、1 勝すると重賞、2 勝か重賞勝ちで GI に出られる。勝つと全能力と気分が上がる。' }),
    ])]),
  ];
}

const tile = (t, sub, onclick, cls = '') => el(`button.ik-tile${cls ? `.${cls}` : ''}`, { onclick }, [el('b', { text: t }), el('small', { text: sub })]);

// ---------------------------------------------------------------- ガチャ

function gachaView(app, go) {
  const p = app.ik;
  app.ikPack ??= 'ALL';
  const last = app.ikLast ?? [];
  const pull = (n) => {
    const got = I.pull(p, n, app.ikPack);
    save(app);
    app.ikLast = got;
    const top = got.reduce((m, g) => Math.min(m, I.RARITIES.indexOf(g.card.rar)), 9);
    sound.play(top <= 1 ? 'bell' : top <= 2 ? 'win' : 'ok');
    go('gacha');
  };
  const packs = [{ id: 'ALL', name: '全弾ミックス' }, ...Object.entries(I.PACKS).map(([id, name]) => ({ id, name: `第${id.slice(1)}弾【${name}】` }))];
  return [
    card('ガチャ', [
      tabs(packs, app.ikPack, (id) => { app.ikPack = id; go('gacha'); }),
      el('div.ik-gbtns', [
        button('1 回引く', () => pull(1), { cls: 'primary' }),
        button('10 回引く', () => pull(10), { cls: 'primary big' }),
      ]),
      el('p.note', { text: `排出率 ${Object.entries(I.RATES).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join('・')}　通算 ${p.pulls} 回` }),
    ]),
    last.length ? card(`引いたカード（${last.length} 枚）`, [
      el('div.ik-grid', last.map((g) => cardView(g.card, { scale: fit(0.3), badge: g.isNew ? 'NEW' : null, onClick: (c) => showCard(app, c) }))),
    ]) : null,
  ];
}

/** カードを大きく見る。 */
function showCard(app, c) {
  const p = app.ik;
  modal(`${epithetOf(c)} ${c.name}`, [
    el('div.ik-big', cardView(c, { scale: Math.min(0.7, (window.innerHeight - 160) / 880) })),
    el('p.note', { text: `所持 ${p.cards[c.id] ?? 0} 枚　サポートの得意：${I.STAT_LABEL[I.supportType(c)]}の練習` }),
  ], { wide: true });
}

// ---------------------------------------------------------------- カード一覧

function cardsView(app, go) {
  const p = app.ik;
  app.ikFilter ??= { pack: 'ALL', rar: 'ALL' };
  const f = app.ikFilter;
  const list = I.CARDS.filter((c) => (f.pack === 'ALL' || c.pack === f.pack) && (f.rar === 'ALL' || c.rar === f.rar));
  const set = (k, v) => { f[k] = v; go('cards'); };
  return [
    card(`カード（${I.owned(p).length} / ${I.CARDS.length} 種）`, [
      tabs([{ id: 'ALL', name: '全弾' }, ...Object.keys(I.PACKS).map((id) => ({ id, name: `第${id.slice(1)}弾` }))], f.pack, (v) => set('pack', v)),
      tabs([{ id: 'ALL', name: '全レア' }, ...I.RARITIES.map((r) => ({ id: r, name: r }))], f.rar, (v) => set('rar', v)),
      el('div.ik-grid', list.map((c) => {
        const n = p.cards[c.id] ?? 0;
        return n
          ? cardView(c, { scale: fit(0.26), count: n, onClick: (x) => showCard(app, x) })
          : el('div.ik-missing', { style: `width:${630 * fit(0.26)}px;height:${880 * fit(0.26)}px` }, [el(`b.${RCLS(c.rar)}`, { text: c.rar }), el('span', { text: '？？？' })]);
      })),
    ]),
  ];
}

// ---------------------------------------------------------------- 編成と育成

function runView(app, go) {
  const p = app.ik;
  if (!p.run) return deckView(app, go);
  return trainView(app, go);
}

/** 編成：育てる馬 1 枚、サポート 4 枚。 */
function deckView(app, go) {
  const p = app.ik;
  const have = I.owned(p);
  app.ikDeck ??= { trainee: null, supports: [] };
  const d = app.ikDeck;
  d.supports = d.supports.filter((id) => p.cards[id] && id !== d.trainee);
  if (have.length < 5) {
    return [card('編成', [
      el('p', { text: `育成には 5 種類のカードが要る（いま ${have.length} 種）。` }),
      button('ガチャへ', () => go('gacha'), { cls: 'primary' }),
    ])];
  }
  const pick = (c) => {
    if (!d.trainee || d.trainee === c.id) d.trainee = d.trainee === c.id ? null : c.id;
    else if (d.supports.includes(c.id)) d.supports = d.supports.filter((x) => x !== c.id);
    else if (d.supports.length < 4) d.supports.push(c.id);
    else return toast('サポートは 4 枚まで（外すにはもう一度押す）', { bad: true });
    go('run');
  };
  const slot = (id, label) => el('div.ik-slot', [
    el('small', { text: label }),
    id ? cardView(I.cardById(id), { scale: 0.22, onClick: () => pick(I.cardById(id)) }) : el('div.ik-empty', { text: '空き' }),
  ]);
  const ready = d.trainee && d.supports.length === 4;
  return [
    card('編成（育てる馬 1 枚＋サポート 4 枚）', [
      el('div.ik-deck', [slot(d.trainee, '育てる馬'), ...[0, 1, 2, 3].map((i) => slot(d.supports[i], `サポート ${i + 1}`))]),
      d.trainee ? traineeNote(I.cardById(d.trainee)) : el('p.note', { text: 'まず育てる馬を選び、続けてサポートを 4 枚選ぶ。選んだカードをもう一度押すと外れる。' }),
      el('div.ik-gbtns', [
        button('育成を始める', () => {
          I.startRun(p, d.trainee, d.supports);
          app.ikDeck = null;
          save(app);
          sound.play('ok');
          go('run');
        }, { cls: 'primary big', disabled: !ready }),
        button('おまかせ', () => {
          const s = [...have].sort((a, b) => I.cardPower(b) - I.cardPower(a));
          d.trainee ??= s[0].id;
          d.supports = s.filter((c) => c.id !== d.trainee).slice(0, 4).map((c) => c.id);
          go('run');
        }, { cls: 'ghost' }),
      ]),
    ]),
    card('持っているカード', [
      el('div.ik-grid', have.map((c) => cardView(c, {
        scale: fit(0.24), count: p.cards[c.id], onClick: pick,
        badge: c.id === d.trainee ? '育成' : d.supports.includes(c.id) ? `サポ${d.supports.indexOf(c.id) + 1}` : null,
      }))),
    ]),
  ];
}

function traineeNote(c) {
  const plus = I.plusOf(c);
  return el('p.note', { text: `${c.name}：${I.distCat(c.dist)}・${c.turf >= c.dirt ? '芝' : 'ダート'}　伸びしろ ${I.STATS.map((k) => `${I.STAT_SHORT[k]}+${plus[k]}`).join(' ')}` });
}

/** 育成の 1 ターン。 */
function trainView(app, go) {
  const p = app.ik;
  const run = p.run;
  const c = I.cardById(run.trainee);
  const plus = I.plusOf(c);
  const cap = (k) => 600 + plus[k] * 120;
  const statRows = I.STATS.map((k) => el('div.ik-stat', [
    el('span.l', { text: I.STAT_LABEL[k] }),
    el(`b.g.g-${I.gradeOfPts(run.stats[k]).replace('+', 'p')}`, { text: I.gradeOfPts(run.stats[k]) }),
    el('span.n', { text: String(run.stats[k]) }),
    el('span.bar', [el('i', { style: `width:${(run.stats[k] / 1200) * 100}%` }), el('em', { style: `left:${(cap(k) / 1200) * 100}%`, title: `上限 ${cap(k)}` })]),
  ]));
  const side = el('div.ik-side', [
    cardView(c, { scale: 0.32, onClick: (x) => showCard(app, x) }),
    el('div.ik-meta', [
      el('div', [el('small', { text: '体力' }), el('span.bar.en', [el('i', { style: `width:${run.energy}%` })]), el('b', { text: String(run.energy) })]),
      el('div', [el('small', { text: '気分' }), el(`b.mood.m${run.mood}`, { text: I.MOODS[run.mood] })]),
      el('div', [el('small', { text: '戦績' }), el('b', { text: `${run.starts}戦${run.wins}勝（重賞 ${run.gradedWins}・GI ${run.giWins}）` })]),
      el('div', [el('small', { text: 'ファン' }), el('b', { text: `${run.fans.toLocaleString()}人` })]),
    ]),
  ]);
  const progress = el('div.ik-prog', [
    el('b', { text: I.runDone(run) ? '育成完了' : I.turnLabel(run) }),
    el('span.bar', [el('i', { style: `width:${(run.turn / I.TOTAL_TURNS) * 100}%` })]),
    el('small', { text: `${run.turn} / ${I.TOTAL_TURNS} ターン` }),
  ]);
  let action;
  if (I.runDone(run)) {
    action = card('育成完了', [
      el('p', { text: `${c.name}の 2 年が終わった。${run.starts}戦${run.wins}勝（GI ${run.giWins}勝）。` }),
      button('完成馬として登録する', () => {
        const h = I.finishRun(p);
        save(app);
        sound.play('bell');
        modal('完成！', [finishedCard(h), el('p.note', { text: '完成馬は「対戦」で戦わせられる。' })]);
        go('stable');
      }, { cls: 'primary big' }),
    ]);
  } else if (I.isRaceTurn(run)) {
    const opts = I.raceOptions(run);
    action = card(`${I.SLOTS[run.slot].label}のレース`, [
      el('div.ik-races', opts.map((o) => el('button.ik-race', {
        onclick: () => {
          const out = I.raceTurn(run, o.id);
          save(app);
          app.ikRace = { race: out.result, looks: looksOf([I.traineeSpec(run)]), mine: [1], order: out.order, back: 'run', title: o.name };
          sound.play(out.order === 1 ? 'bell' : out.order <= 3 ? 'win' : 'ok');
          go('result');
        },
      }, [
        o.grade ? el(`span.gr.${o.grade}`, { text: o.grade }) : el('span.gr', { text: '条件' }),
        el('b', { text: o.name }),
        el('small', { text: `${o.surface}${o.distance}m　相手の強さ ${lvlLabel(o.level)}` }),
      ]))),
      el('p.note', { text: '重賞は 1 勝から、GI は 2 勝か重賞勝ちで出られる。' }),
    ]);
  } else {
    const board = I.trainingBoard(run);
    action = card('練習', [
      el('div.ik-trains', I.STATS.map((k) => {
        const pv = I.trainingPreview(run, k);
        return el(`button.ik-train${pv.friendship ? '.friend' : ''}`, {
          onclick: () => { const m = I.train(run, k); save(app); toast(m, { bad: m.includes('失敗') }); go('run'); },
        }, [
          el('b', { text: I.STAT_LABEL[k] }),
          el('div.gains', Object.entries(pv.gains).map(([s, g]) => el('span', { text: `${I.STAT_SHORT[s]}+${g}` }))),
          el('div.sup', board[k].map((i) => el(`span.${RCLS(I.cardById(run.supports[i]).rar)}`, { text: I.cardById(run.supports[i]).name }))),
          pv.friendship ? el('em.fr', { text: '友情' }) : null,
          el('small', { text: `${k === 'wit' ? '体力+5' : `体力−${pv.cost}`}${pv.fail ? `　失敗 ${Math.round(pv.fail * 100)}%` : ''}` }),
        ]);
      })),
      el('div.ik-gbtns', [button('休む（体力を戻す）', () => { toast(I.rest(run)); save(app); go('run'); }, { cls: run.energy < 50 ? 'primary' : '' })]),
    ]);
  }
  return [
    progress,
    el('div.ik-run', [
      side,
      el('div.ik-main', [
        card('能力', [el('div.ik-stats', statRows), el('p.note', { text: '黄色の線は伸びしろの上限（カードの +値）' })]),
        action,
        run.races.length ? card('レース', [table(['時期', 'レース', '', '着順'], run.races.map((r) => [
          I.SLOTS[r.slot].label, r.name, `${r.surface}${r.distance}m`, el(`b${r.order === 1 ? '.win' : ''}`, { text: `${r.order}着/${r.field}` }),
        ]))]) : null,
        el('div.ik-log', run.log.slice(-5).reverse().map((l) => el('div', { text: l }))),
        el('div.ik-gbtns', [button('育成をやめる', async () => {
          if (!await ask('この育成をやめる？（育てた馬は残らない）', { ok: 'やめる', cancel: '続ける' })) return;
          p.run = null; save(app); go('run');
        }, { cls: 'sm ghost' })]),
      ]),
    ]),
  ];
}

const lvlLabel = (l) => (l >= 0.66 ? '★★★★★' : l >= 0.62 ? '★★★★' : l >= 0.58 ? '★★★' : l >= 0.52 ? '★★' : '★');

/** 3D に渡す毛色と白斑（カードの馬は実在馬の白斑）。field は runRace に渡した馬。 */
function looksOf(field) {
  const m = new Map();
  for (const f of field) {
    const c = f.cardId ? I.cardById(f.cardId) : null;
    m.set(f.id, { coat: f.coat ?? c?.coat ?? '鹿毛', marks: f.marks ?? c?.marks ?? null });
  }
  return m;
}

// ---------------------------------------------------------------- レースの結果と観戦

function resultView(app, go) {
  const R = app.ikRace;
  if (!R) return homeView(app, go);
  const res = R.race;
  const mine = new Set(R.mine);
  const myBest = res.results.find((r) => mine.has(r.horseId));
  return [
    el('div.ik-result', [
      el('div.ik-rh', [
        res.grade ? el(`span.gr.${res.grade}`, { text: res.grade }) : null,
        el('h2', { text: R.title ?? res.name }),
        el('small', { text: `${res.courseName ?? ''} ${res.surface}${res.distance}m　${res.ground}` }),
      ]),
      myBest ? el(`div.ik-place.p${Math.min(4, myBest.order)}`, { text: `${myBest.name} ${myBest.order}着` }) : null,
      table(['着', '', '馬名', 'タイム', '着差', '上がり', '脚質'], res.results.map((r) => [
        r.order, frameChip(r.frame, r.gate), el(mine.has(r.horseId) ? 'b.mine' : 'span', { text: r.name }),
        formatTime(r.time), r.margin, r.last3f.toFixed(1), r.styleLabel,
      ]), { cls: 'ik-tbl' }),
      el('div.ik-gbtns', [
        button('3D で観る', () => go('watch'), { cls: 'primary big' }),
        button('次へ', () => go(R.back ?? 'run'), { cls: 'big' }),
      ]),
    ]),
  ];
}

function watchView(app) {
  const R = app.ikRace;
  const go = (v) => app.go('ik', { view: v });
  if (!R) return el('div');
  const race = R.race;
  const myIds = race.results.filter((r) => R.mine.includes(r.horseId)).sort((a, b) => a.gate - b.gate).map((r) => r.horseId);
  const canvas = el('canvas.race3d');
  const rankList = el('ol.rank');
  const hud = el('div.hud', [el('div.hud-dist'), el('div.hud-time')]);
  const camBar = el('div.cambar');
  const ctrl = el('div.ctrl-right');
  const wrap = el('div.watch.ik-watch', [
    el('div.view', [canvas, hud, el('div.rankbox', [el('h3', { text: R.title ?? race.name }), rankList])]),
    el('div.controls', [camBar, ctrl]),
  ]);
  let view = null;
  requestAnimationFrame(() => {
    try {
      view = createRaceView(canvas, race, { focusId: myIds[0] ?? null, marks: myIds, camera: 'mark', looks: R.looks });
    } catch (e) {
      wrap.appendChild(el('p.bad', { text: `3D を初期化できなかった：${e.message}` }));
      return;
    }
    app.onResize = () => view && view.resize();
    const rows = new Map();
    for (const r of race.results) {
      const row = el('li', { class: myIds.includes(r.horseId) ? 'mine' : null, onclick: () => { view.setFocus(r.horseId); view.draw(); } },
        [frameChip(r.frame, r.gate), el('span.rn', { text: r.name }), el('span.rg')]);
      rows.set(r.horseId, row);
      rankList.appendChild(row);
    }
    const shown = window.innerWidth < 700 ? 5 : 10;
    view.onFrame = (st) => {
      hud.firstChild.textContent = st.remaining > 0.5 ? `残り ${Math.round(st.remaining)}m` : 'ゴール';
      hud.lastChild.textContent = `${st.time.toFixed(1)} 秒`;
      for (const r of st.ranked) {
        const row = rows.get(r.id);
        if (!row) continue;
        row.style.order = r.order;
        row.dataset.n = r.order;
        row.hidden = !(r.order <= shown || myIds.includes(r.id));
        row.lastChild.textContent = r.gap < 0.1 ? '先頭' : `${r.gap.toFixed(1)}m`;
      }
    };
    view.onFinish = () => {
      sound.play('goal');
      setTimeout(() => { if (app.screen === 'ik' && app.params.view === 'watch') go('result'); }, 1500);
    };
    for (const c of CAMERAS) {
      camBar.appendChild(el('button.tab', {
        text: c.name, class: c.id === view.camera ? 'on' : null,
        onclick: (e) => { view.setCamera(c.id); [...camBar.children].forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); view.draw(); },
      }));
    }
    const sp = el('div.speedbar', [0.5, 1, 2, 4].map((s) => el('button.tab', {
      text: `×${s}`, class: s === 1 ? 'on' : null,
      onclick: (e) => { view.setSpeed(s); [...sp.children].forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); },
    })));
    ctrl.append(sp, button('最初から', () => { view.seek(0); view.play(); }, { cls: 'sm ghost' }), button('結果へ', () => go('result'), { cls: 'sm primary' }));
    sound.play('gate');
    view.play();
  });
  app.cleanup = () => { if (view) view.dispose(); view = null; app.onResize = null; };
  return el('div.ik-w', wrap);
}

// ---------------------------------------------------------------- 完成馬

function finishedCard(h) {
  const c = I.cardById(h.cardId);
  return el(`div.ik-fin.${RCLS(h.rar)}`, [
    el('div.fh', [el(`span.rk.rk-${h.rank.replace('+', 'p')}`, { text: h.rank }), el('b', { text: h.name }), el('small', { text: `評価点 ${h.rating}` })]),
    el('div.fs', I.STATS.map((k) => el('span', [el('small', { text: I.STAT_SHORT[k] }), el('b', { text: I.gradeOfPts(h.stats[k]) }), el('i', { text: String(h.stats[k]) })]))),
    el('div.fm', { text: `${h.starts}戦${h.wins}勝（重賞 ${h.gradedWins}・GI ${h.giWins}）　${c ? `${I.distCat(c.dist)}・${c.turf >= c.dirt ? '芝' : 'ダート'}` : ''}　対戦 ${h.battles}戦${h.battleWins}勝` }),
  ]);
}

function stableView(app, go) {
  const p = app.ik;
  if (!p.finished.length) return [card('完成馬', [el('p', { text: 'まだ完成馬がいない。育成で 2 年を走り切ると、ここに並ぶ。' }), button('育成へ', () => go('run'), { cls: 'primary' })])];
  const list = [...p.finished].sort((a, b) => b.rating - a.rating);
  return [card(`完成馬（${list.length} 頭）`, [
    el('div.ik-fins', list.map((h) => el('div.ik-finrow', [
      finishedCard(h),
      el('div.row-btns', [
        button('対戦へ', () => { app.ikBattle = { ...(app.ikBattle ?? {}), horse: h.id }; go('battle'); }, { cls: 'sm primary' }),
        button('手放す', async () => {
          if (!await ask(`${h.name}を手放す？`, { ok: '手放す' })) return;
          p.finished = p.finished.filter((x) => x !== h); save(app); go('stable');
        }, { cls: 'sm ghost' }),
      ]),
    ]))),
  ])];
}

// ---------------------------------------------------------------- 対戦

function battleView(app, go) {
  const p = app.ik;
  if (!p.finished.length) return [card('対戦', [el('p', { text: '対戦には完成馬が要る。' }), button('育成へ', () => go('run'), { cls: 'primary' })])];
  app.ikBattle ??= {};
  const B = app.ikBattle;
  B.horse = p.finished.some((h) => h.id === B.horse) ? B.horse : [...p.finished].sort((a, b) => b.rating - a.rating)[0].id;
  B.race ??= I.BATTLE_RACES[0].id;
  B.diff ??= 'normal';
  B.own ??= [];
  B.own = B.own.filter((id) => p.finished.some((h) => h.id === id));
  const raceSel = el('select.inp', { onchange: (e) => { B.race = e.target.value; } },
    I.BATTLE_RACES.map((r) => el('option', { value: r.id, text: `${r.name}（${r.surface}${r.distance}m）`, selected: r.id === B.race })));
  const horseSel = el('select.inp', { onchange: (e) => { B.horse = Number(e.target.value); } },
    [...p.finished].sort((a, b) => b.rating - a.rating).map((h) => el('option', { value: String(h.id), text: `${h.rank} ${h.name}（${h.rating}）`, selected: h.id === B.horse })));
  const diffTabs = tabs(Object.entries(I.DIFFICULTY).map(([id, d]) => ({ id, name: d.name })), B.diff, (id) => { B.diff = id; go('battle'); });
  const runNpc = () => {
    const out = I.battleNpc(p, B.horse, B.race, B.diff);
    save(app);
    app.ikRace = { race: out.result, looks: looksOf(out.field), mine: [100], order: out.order, back: 'battle', title: `ランク戦 ${out.race.name}（${I.DIFFICULTY[B.diff].name}）` };
    sound.play(out.order === 1 ? 'bell' : out.order <= 3 ? 'win' : 'ok');
    go('result');
  };
  const runOwn = () => {
    if (B.own.length < 2) return toast('2 頭以上を選ぶ', { bad: true });
    const out = I.battleOwn(p, B.own, B.race);
    save(app);
    app.ikRace = { race: out.result, looks: looksOf(out.field), mine: out.field.map((f) => f.id), back: 'battle', title: `完成馬対決 ${out.race.name}` };
    sound.play('bell');
    go('result');
  };
  return [
    card('舞台', [el('div.form', [el('label', ['レース', raceSel])])]),
    el('div.ik-cols', [
      card('NPC とのランク戦', [
        el('p.note', { text: '相手は全カードの名馬を育て上げた姿（12 頭立て）。強さは自分の馬に合わせて難しさで変わる。' }),
        el('div.form', [el('label', ['出る馬', horseSel])]),
        diffTabs,
        button('出走する', runNpc, { cls: 'primary big' }),
      ]),
      card('自分の完成馬どうし', [
        el('p.note', { text: '2〜16 頭を選んで走らせる。' }),
        el('div.ik-pick', p.finished.map((h) => el('label.check', [
          el('input', { type: 'checkbox', checked: B.own.includes(h.id), onchange: (e) => { B.own = e.target.checked ? [...B.own, h.id] : B.own.filter((x) => x !== h.id); } }),
          el('span', { text: `${h.rank} ${h.name}` }),
        ]))),
        button('走らせる', runOwn, { cls: 'primary' }),
      ]),
    ]),
  ];
}
