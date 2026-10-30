// 育成モード（カード）。ガチャ・カード一覧・編成と育成・完成馬・対戦。
// 牧場経営とは別のモードで、世界（game.js）は使わない。入口は sim/ikusei.js だけ。
// プロフィールは localStorage に置く（数 KB。牧場のセーブの IndexedDB とは別）。
// 画面は app.go('ik', { view }) で切り替える。レースの結果（走行ログ）は保存しないので app.ikRace に持つ。

import { el, card, table, button, toast, modal, ask, tabs, frameChip } from '../dom.js';
import { icon } from '../icons.js';
import { cardArt } from '../../render3d/cardart.js';
import * as I from '../../sim/ikusei.js';
import { cardView, epithetOf, holoOf, holoName } from '../cardview.js';
import { createRaceView, CAMERAS } from '../../render3d/raceview.js';
import { formatTime } from '../../core/util.js';
import * as sound from '../sound.js';

/** 画面の題（日本語と英語の小見出し）。 */
const TITLES = {
  gacha: ['ガチャ', 'GACHA'], cards: ['カード図鑑', 'CARDS'], run: ['育成', 'TRAINING'],
  stable: ['完成馬', 'STABLE'], battle: ['対戦', 'BATTLE'], result: ['レース結果', 'RESULT'],
};

const store = () => { try { return window.localStorage; } catch { return null; } };
const save = (app) => I.saveProfile(app.ik, store());
const RCLS = (r) => `rar-${r}`;
/** 一覧のカードの倍率。狭い画面でも 2 枚は並ぶように縮める。 */
const fit = (sc) => Math.min(sc, (window.innerWidth - 74) / 2 / 630);

/** 線の絵（24×24、currentColor）。icons.js に無いものだけここに持つ。 */
const SVG = {
  cards: '<rect x="7.5" y="3.5" width="11" height="15" rx="2" transform="rotate(12 13 11)"/><rect x="4.5" y="5.5" width="11" height="15" rx="2"/><path d="M7.5 10h5M7.5 13h3"/>',
  spark: '<path d="M12 2.5c.6 4.8 2.7 6.9 7.5 7.5-4.8.6-6.9 2.7-7.5 7.5-.6-4.8-2.7-6.9-7.5-7.5 4.8-.6 6.9-2.7 7.5-7.5z"/><path d="M19 16.5c.2 1.7 1 2.5 2.5 2.7-1.6.2-2.3 1-2.5 2.6-.2-1.6-1-2.4-2.5-2.6 1.6-.2 2.3-1 2.5-2.7z"/>',
  book: '<path d="M4 5.5c2.7-1 5.3-1 8 .8 2.7-1.8 5.3-1.8 8-.8V19c-2.7-1-5.3-1-8 .8-2.7-1.8-5.3-1.8-8-.8z"/><path d="M12 6.3v13.5"/>',
  sound: '<path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z"/><path d="m15.5 9.5 5 5M20.5 9.5l-5 5"/>',
  exit: '<path d="M10 4.5H5.5v15H10"/><path d="M14 8l4 4-4 4M18 12H9"/>',
  sword: '<path d="M14.5 4.5h5v5L10 19l-2-2-2 2-1-1 2-2-2-2z"/><path d="m13 8 3 3"/>',
  fist: '<path d="M7 11V7.5a1.5 1.5 0 0 1 3 0V10m0-2.5V6.5a1.5 1.5 0 0 1 3 0V10m0-2.5a1.5 1.5 0 0 1 3 0V10m0-1a1.5 1.5 0 0 1 3 0v4.5c0 4-2.7 6.5-6.5 6.5S7 17.5 7 14.5V11a1.5 1.5 0 0 1-2 0"/>',
};
const svg = (name, size = 24) => {
  const span = document.createElement('span');
  span.className = 'ico';
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG[name] ?? ''}</svg>`;
  return span;
};
const ic = (name, size = 24) => (SVG[name] ? svg(name, size) : icon(name, { size }));

export function ikuseiScreen(app) {
  app.ik ??= I.loadProfile(store());
  const view = app.params.view ?? 'home';
  const go = (v, extra = {}) => app.go('ik', { view: v, ...extra });
  if (view === 'watch') return watchView(app);
  // 背景（空・網点・街）は画面の外に固定して敷く。中身だけが流れる（background-attachment: fixed はスマホで効かない）。
  const sky = el('div.ik-sky', [el('b.ik-water', { text: 'WINNING ROAD' })]);
  if (view === 'home') return el('div.ikh-wrap', [sky, homeView(app, go)]);
  const body = { gacha: gachaView, cards: cardsView, run: runView, stable: stableView, battle: battleView, result: resultView }[view] ?? gachaView;
  const navId = view === 'result' ? (app.ikRace?.back ?? 'run') : view;
  const [jp, en] = TITLES[view] ?? ['', ''];
  return el('div.ikp-wrap', [
    sky,
    el('div.ikp', [
      el('header.ikp-top', [
        el('button.ikp-back', { onclick: () => go('home'), title: 'ホームへ' }, icon('back', { size: 26 })),
        el('div.ikp-title', [el('b', { text: jp }), el('small', { text: en })]),
        coinPill(go),
      ]),
      el('div.ik.ikp-body', body(app, go)),
    ]),
    dock(app, go, navId),
  ]);
}

// ---------------------------------------------------------------- ホーム（参考：縦長のスマホゲームのホーム画面）

/** ホームの主役のカード。お気に入り → 育成中の馬 → いちばん強い完成馬 → 持っているいちばん強いカード → 見本。 */
function heroCard(p) {
  const own = (id) => (id && p.cards[id] ? I.cardById(id) : null);
  const best = [...p.finished].sort((a, b) => b.rating - a.rating)[0];
  const top = [...I.owned(p)].sort((a, b) => I.RARITIES.indexOf(a.rar) - I.RARITIES.indexOf(b.rar) || I.cardPower(b) - I.cardPower(a))[0];
  return own(p.fav) ?? own(p.run?.trainee) ?? own(best?.cardId) ?? top ?? I.cardById('P1-40') ?? I.CARDS[0];
}

/**
 * ステッカー（白縁の切り抜き）を入れる。絵は撮るまで時間が掛かるので、届いたら差し込む。
 * mode 'face' は頭のあたり（撮影の舞台が返す頭の位置）を中心に、zoom 倍に拡大して丸い枠に収める。
 */
function stickerInto(node, c, { mode = 'img', zoom = 2.6 } = {}) {
  cardArt(c).then((a) => {
    const st = a.sticker;
    const url = st?.url ?? a.fg;
    if (mode === 'img') { node.src = url; node.classList.add('ready'); return; }
    node.style.backgroundImage = `url(${url})`;
    node.style.backgroundSize = `${zoom * 100}% auto`;
    if (st?.focus) {
      // background-position の p% は「絵の p% を枠の p% に合わせる」。絵の f の点を枠の中央に置く p を解く。
      const zy = zoom * (st.h / st.w);
      const px = Math.min(1, Math.max(0, (st.focus.x * zoom - 0.5) / (zoom - 1)));
      const py = zy > 1 ? Math.min(1, Math.max(0, (st.focus.y * zy - 0.5) / (zy - 1))) : 0.5;
      node.style.backgroundPosition = `${(px * 100).toFixed(1)}% ${(py * 100).toFixed(1)}%`;
    }
    node.classList.add('ready');
  }).catch(() => {});
}
function bgInto(node, c) {
  cardArt(c).then((a) => { node.style.backgroundImage = `url(${a.bg})`; node.classList.add('ready'); }).catch(() => {});
}

/** 右上の通貨（試作なのでガチャは何度でも引ける）。 */
function coinPill(go) {
  return el('button.ik-coin', { onclick: () => go('gacha'), title: 'ガチャへ' }, [
    el('span.cn', icon('coin', { size: 20 })), el('b', { text: '∞' }), el('i.plus', { text: '+' }),
  ]);
}

/** 下のボタン列（参考画像の SHOP・神明・CLUB・宠物・召唤）。 */
function dock(app, go, current) {
  const p = app.ik;
  // 中身は span.ikd-in に包む（ガチャのボタンは菱形に回すので、中身だけ逆に回して立てる）
  const b = (id, jp, en, iconName, cls, badge = null) => el(`button.ikd.${cls}${current === id ? '.on' : ''}`, { onclick: () => go(id) }, [
    el('span.ikd-in', [
      el('span.ikd-ic', ic(iconName, cls === 'gacha' ? 28 : 24)),
      el('span.ikd-t', [el('b', { text: jp }), el('small', { text: en })]),
    ]),
    badge ? el('i.ik-badge', { text: badge }) : null,
  ]);
  return el('nav.ik-dock', [
    b('cards', 'カード', 'CARDS', 'cards', 'cards', app.ikNew ? 'NEW' : null),
    b('run', '育成', 'TRAINING', 'horse', 'run', p.run ? '!' : null),
    b('stable', '完成馬', 'STABLE', 'trophy', 'stable'),
    b('battle', '対戦', 'BATTLE', 'sword', 'battle'),
    b('gacha', 'ガチャ', 'GACHA', 'spark', 'gacha'),
  ]);
}

function homeView(app, go) {
  const p = app.ik;
  const have = I.owned(p);
  const hc = heroCard(p);
  const power = have.reduce((s, c) => s + I.cardPower(c), 0);
  const run = p.run;

  // 主役：白縁の切り抜きを大きく、ふわっと浮かせる
  const heroImg = el('img.ikh-sticker', { alt: hc.name, draggable: false });
  stickerInto(heroImg, hc);
  const hero = el('button.ikh-hero', {
    onclick: () => (p.cards[hc.id] ? showCard(app, hc) : go('gacha')),
    title: p.cards[hc.id] ? 'カードを見る' : 'ガチャで出る',
  }, [heroImg, el('div.ikh-plate', [
    el(`span.rb.r-${hc.rar}`, { text: hc.rar }),
    el('span.nm', [el('small', { text: epithetOf(hc) }), el('b', { text: hc.name })]),
    p.cards[hc.id] ? null : el('em', { text: '未所持' }),
  ])]);

  // 左上：アバター（主役の顔）と戦力。押すとお気に入りを選ぶ
  const ava = el('span.ikh-ava-img');
  stickerInto(ava, hc, { mode: 'face' });
  const top = el('header.ikh-top', [
    el('button.ikh-ava', { onclick: () => pickFavorite(app, go), title: 'ホームの馬を選ぶ' }, [ava]),
    el('div.ikh-power', [svg('fist', 16), el('b', { text: power.toLocaleString() })]),
    el('div.ikh-sp'),
    coinPill(go),
  ]);

  // 左の列：開催中のパック・遊びかた
  const ev = (cls, label, c, onclick, badge) => {
    const face = el('span.ikh-ev-face');
    if (c) stickerInto(face, c, { mode: 'face' });
    return el(`button.ikh-ev.${cls}`, { onclick }, [face, el('span.ikh-ev-l', { text: label }), badge ? el('i.ik-badge', { text: badge }) : null]);
  };
  const p1 = I.CARDS.find((c) => c.pack === 'P1' && c.rar === 'LM' && c.name === 'イージーゴア') ?? I.CARDS[0];
  const p2 = I.CARDS.find((c) => c.pack === 'P2' && c.name === 'ファンタスティックライト') ?? I.CARDS[40];
  const left = el('nav.ikh-left', [
    ev('p1', '第1弾 開催中', p1, () => { app.ikPack = 'P1'; go('gacha'); }, '!'),
    ev('p2', '第2弾 開催中', p2, () => { app.ikPack = 'P2'; go('gacha'); }, '!'),
    (() => { const x = ev('howto', '遊びかた', null, showHowto); x.querySelector('.ikh-ev-face').append(svg('book', 30)); return x; })(),
  ]);

  // 右の列：丸いボタン
  const muteIc = el('span', ic(sound.isMuted() ? 'mute' : 'sound', 24));
  const right = el('nav.ikh-right', [
    el('button.ikh-rb', { onclick: () => go('cards'), title: 'カード図鑑' }, [ic('cards', 24), el('small', { text: '図鑑' })]),
    el('button.ikh-rb', {
      onclick: () => { sound.setMuted(!sound.isMuted()); muteIc.replaceChildren(ic(sound.isMuted() ? 'mute' : 'sound', 24)); sound.play('ok'); },
      title: '効果音の入切',
    }, [muteIc, el('small', { text: '音' })]),
    el('button.ikh-rb', { onclick: () => app.go('title', {}, { replace: true }), title: 'タイトルへ' }, [ic('exit', 24), el('small', { text: 'タイトル' })]),
  ]);

  // 左下：育成の進み（参考画像の「当前进度」）
  const tc = run ? I.cardById(run.trainee) : null;
  const pf = el('span.ikh-prog-face');
  if (tc) stickerInto(pf, tc, { mode: 'face', zoom: 2.2 });
  const pct = run ? Math.round((run.turn / I.TOTAL_TURNS) * 100) : 0;
  const prog = el('button.ikh-prog', { onclick: () => go('run') }, [
    el('span.ikh-bubble', { text: run ? (I.isRaceTurn(run) ? 'レースだ!' : '育成へ!') : '育成しよう!' }),
    el('span.ikh-ring', { style: `--p:${pct}` }, [pf, el('b', { text: run ? String(run.starts) : '0' }), el('small', { text: '/10戦' })]),
    el('span.ikh-prog-l', { text: run ? '育成 進行中' : '育成を始める' }),
    run ? el('i.ik-badge', { text: '!' }) : null,
  ]);

  // 右下：チケット（参考画像の「玩法目录」「世界染色 15/26」）
  const ticket = (cls, a, bb, c, caption, onclick) => {
    const img = el('span.tk-img');
    bgInto(img, c);
    return el(`button.ikh-ticket.${cls}`, { onclick }, [
      el('span.tk-l', [el('b', { text: a }), el('b', { text: bb }), el('i.tk-bar')]),
      el('span.tk-r', [img, el('small', { text: caption })]),
    ]);
  };
  const second = have.find((c) => c.id !== hc.id) ?? I.CARDS.find((c) => c.id !== hc.id);
  const tickets = el('div.ikh-tickets', [
    ticket('t1', 'ランク', '対戦', hc, `完成馬 ${p.finished.length}頭`, () => go('battle')),
    ticket('t2', 'カード', '図鑑', second, `${have.length}/${I.CARDS.length}`, () => go('cards')),
  ]);

  return el('div.ikh', [
    top,
    el('div.ikh-stage', [el('div.ikh-city'), hero, left, right, prog, tickets]),
    dock(app, go, 'home'),
  ]);
}

/** ホームの馬を選ぶ（持っているカードから）。 */
function pickFavorite(app, go) {
  const p = app.ik;
  const have = I.owned(p);
  if (!have.length) { toast('まだカードが無い。ガチャで引こう'); go('gacha'); return; }
  const m = modal('ホームに立たせる馬', [
    el('div.ik-grid', have.map((c) => cardView(c, { scale: fit(0.22), tilt: false, onClick: () => { p.fav = c.id; save(app); m.close(); go('home'); } }))),
  ], { wide: true });
}

function showHowto() {
  modal('遊びかた', [el('ul.howto', [
    el('li', { text: 'ガチャ：第 1 弾【世界の英雄たち】・第 2 弾【異国を制する者たち】。排出率 LM 2%・SSR 6%・SR 15%・R 27%・N 50%。試作なので回数の制限は無い。' }),
    el('li', { text: '育てる馬：カードの能力が出発点、+値が伸びしろ（+5 で上限 1200 点、+1 で 720 点）。距離・馬場の適性もカードのまま。' }),
    el('li', { text: 'サポート：練習場に顔を出すと伸びが増える。得意な練習（カードのいちばん高い能力）で会うと「友情」でさらに伸びる。レア度が高いほど友情が強い。' }),
    el('li', { text: '1 戦ごとに 3 回の練習。体力が 50 を切ると練習に失敗しやすくなる（賢さの練習は失敗しない）。休むと体力が戻る。' }),
    el('li', { text: 'レースは勝ち数でクラスが上がり、1 勝すると重賞、2 勝か重賞勝ちで GI に出られる。勝つと全能力と気分が上がる。' }),
    el('li', { text: 'ホーム左上の顔を押すと、ホームに立たせる馬を選べる。' }),
  ])]);
}

// ---------------------------------------------------------------- ガチャ

function gachaView(app, go) {
  const p = app.ik;
  app.ikPack ??= 'ALL';
  const last = app.ikLast ?? [];
  const pull = (n) => {
    const got = I.pull(p, n, app.ikPack);
    save(app);
    app.ikLast = got;
    if (got.some((g) => g.isNew)) app.ikNew = true;   // 下のボタン列の「カード」に NEW を付ける（図鑑を開くまで）
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
    el('div.ik-big', cardView(c, { scale: Math.min(0.7, (window.innerHeight - 170) / 880, (window.innerWidth - 60) / 630), tilt: 'full' })),
    el('p.note', { text: `所持 ${p.cards[c.id] ?? 0} 枚　サポートの得意：${I.STAT_LABEL[I.supportType(c)]}の練習${holoOf(c) ? `　ホロ：${holoName(holoOf(c))}` : ''}　（ドラッグで傾けられる）` }),
  ], { wide: true });
}

// ---------------------------------------------------------------- カード一覧

function cardsView(app, go) {
  const p = app.ik;
  app.ikNew = false;
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
