// 育成モード（カード）。ガチャ・カード一覧・編成と育成・完成馬・対戦。
// 牧場経営とは別のモードで、世界（game.js）は使わない。入口は sim/ikusei.js だけ。
// プロフィールは localStorage に置く（数 KB。牧場のセーブの IndexedDB とは別）。
// 画面は app.go('ik', { view }) で切り替える。レースの結果（走行ログ）は保存しないので app.ikRace に持つ。

import { el, card, table, button, toast, modal, ask, tabs, frameChip } from '../dom.js';
import { icon } from '../icons.js';
import { cardArt, cardArtIfReady } from '../../render3d/cardart.js';
import * as I from '../../sim/ikusei.js';
import { cardView, epithetOf, holoOf, holoName, whenVisible } from '../cardview.js';
import { createRaceView, CAMERAS } from '../../render3d/raceview.js';
import { formatTime } from '../../core/util.js';
import * as sound from '../sound.js';

/** 画面の題（日本語と英語の小見出し）。 */
const TITLES = {
  gacha: ['ガチャ', 'GACHA'], cards: ['所持カード', 'MY CARDS'], book: ['カード図鑑', 'CARD BOOK'], run: ['育成', 'TRAINING'], horse: ['完成馬', 'HORSE'],
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
  const body = { gacha: gachaView, cards: cardsView, book: bookView, run: runView, stable: stableView, horse: horseView, battle: battleView, result: resultView }[view] ?? gachaView;
  const navId = view === 'result' ? (app.ikRace?.back ?? 'run') : view === 'horse' ? 'stable' : view === 'book' ? 'cards' : view;
  const [jp, en] = TITLES[view] ?? ['', ''];
  return el('div.ikp-wrap', [
    sky,
    el('div.ikp', [
      el('header.ikp-top', [
        el('button.ikp-back', { onclick: () => go('home'), title: 'ホームへ' }, icon('back', { size: 26 })),
        el('div.ikp-title', [el('b', { text: jp }), el('small', { text: en })]),
        shardPill(app, go),
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
/** かけらの数（押すと所持カードの交換の欄へ）。 */
function shardPill(app, go) {
  const n = I.shardsOf(app.ik);
  const spare = I.spareValue(app.ik);
  return el('button.ik-shard', { onclick: () => go('cards'), title: spare ? `余りを替えると +${spare}` : 'かけら' }, [
    el('span.gem'), el('b', { text: n.toLocaleString() }), spare ? el('i.dot') : null,
  ]);
}

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
    shardPill(app, go),
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
    el('button.ikh-rb', { onclick: () => go('book'), title: 'カード図鑑' }, [ic('book', 24), el('small', { text: '図鑑' })]),
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
    ticket('t2', 'カード', '図鑑', second, `${have.length}/${I.CARDS.length}`, () => go('book')),
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
      el('div.ik-grid', last.map((g) => cardView(g.card, { scale: fit(0.3), badge: g.isNew ? 'NEW' : g.awaken ? `覚醒${g.awaken >= I.AWAKEN.max ? 'MAX' : g.awaken}` : null, onClick: (c) => showCard(app, c) }))),
    ]) : null,
  ];
}

/** カードを大きく見る。 */
/** スキルの札（種類で色分け。押すと説明）。ids はスキル id、uniq は固有スキル { name, desc }。 */
function skillTags(ids, uniq = null, { small = false } = {}) {
  const tag = (cls, name, desc) => el(`span.ik-sk.${cls}${small ? '.sm' : ''}`, { title: desc, onclick: (e) => { e.stopPropagation(); toast(`${name}：${desc}`); } }, name);
  return el('span.ik-sks', [
    uniq ? tag('uniq', uniq.name, uniq.desc) : null,
    ...ids.map((id) => I.skillInfo(id)).filter(Boolean).map((x) => tag(x.type, x.name, x.desc)),
  ]);
}

/** カードのスキルの一覧（説明つき）。 */
function skillList(c, aw = 0) {
  const sk = I.skillsOf(c, aw);
  const base = I.skillsOf(c);
  // 覚醒で増えたスキルには印を付ける
  const row = (cls, head, name, desc, extra) => el('div.ik-skrow', [el(`span.ik-sk.${cls}`, name), extra ? el('em.ik-awk', { text: `覚醒${extra}` }) : null, el('small', { text: `${head}　${desc}` })]);
  return el('div.ik-sklist', [
    sk.unique ? row('uniq', '固有', sk.unique.name, sk.unique.desc) : null,
    ...sk.race.map((id) => [I.skillInfo(id), base.race.includes(id) ? 0 : 2]).map(([x, e]) => row('race', 'レース', x.name, x.desc, e)),
    ...sk.support.map((id) => [I.skillInfo(id), base.support.includes(id) ? 0 : 4]).map(([x, e]) => row('support', 'サポート', x.name, x.desc, e)),
  ]);
}

/** 覚醒（同じカードを重ねて持つ利点）の段と効き目。 */
function awakenPanel(c, count) {
  const A = I.AWAKEN;
  const aw = Math.max(0, Math.min(A.max, count - 1));
  const lv = (n, text) => el(`div.ik-awrow${aw >= n ? '.on' : ''}`, [el('b', { text: `覚醒${n}` }), el('span', { text })]);
  return el('div.ik-awaken', [
    el('div.ik-awhead', [
      el('b', { text: aw >= A.max ? '覚醒 MAX' : `覚醒 ${aw}` }),
      el('i', { text: '◆'.repeat(aw) + '◇'.repeat(A.max - aw) }),
      el('small', { text: aw >= A.max ? `所持 ${count} 枚（5 枚で完凸）` : `所持 ${count} 枚・あと ${aw + 2 - count} 枚で覚醒 ${aw + 1}` }),
    ]),
    el('p.note', { text: `同じカードを 2 枚目から重ねると 1 段ずつ覚醒する（カードは減らない）。いまの効き目　育てる馬：初期値 +${A.init * aw}・伸びしろの上限 +${A.cap * aw}・レーススキル +${Math.round(A.skill * aw * 100)}%　サポート：友情練習 +${Math.round(A.friend * aw * 100)}%・来ない確率 −${Math.round(A.show * aw * 100)}%` }),
    lv(1, '育てる馬の初期値・伸びしろの上限・レーススキルの効き目、サポートの友情練習・来やすさが上がる（以降も段ごとに）'),
    lv(2, 'レーススキルが 1 つ増える'),
    lv(3, 'サポートのとき、友情練習 1 回でスキルを教える'),
    lv(4, 'サポートスキルが 1 つ増える（完凸）'),
  ]);
}

function showCard(app, c) {
  const p = app.ik;
  let m = null;
  m = modal(`${epithetOf(c)} ${c.name}`, [
    el('div.ik-big', cardView(c, { scale: Math.min(0.7, (window.innerHeight - 170) / 880, (window.innerWidth - 60) / 630), tilt: 'full' })),
    p.cards[c.id] ? awakenPanel(c, p.cards[c.id]) : null,
    p.cards[c.id] ? shardActions(app, c, () => m.close()) : null,
    el('h4.ik-skh', { text: 'スキル' }),
    skillList(c, I.awakenOfCard(p, c.id)),
    el('p.note', { text: `所持 ${p.cards[c.id] ?? 0} 枚　サポートの得意：${I.STAT_LABEL[I.supportType(c)]}の練習${holoOf(c) ? `　ホロ：${holoName(holoOf(c))}` : ''}　（ドラッグで傾けられる）` }),
  ], { wide: true });
}

// ---------------------------------------------------------------- カード一覧

/** 所持カード：持っているカードだけ。並べ替えと絞り込み、重ねた枚数。 */
function cardsView(app, go) {
  const p = app.ik;
  app.ikNew = false;
  app.ikOwnOpt ??= { pack: 'ALL', rar: 'ALL', sort: 'rar' };
  const f = app.ikOwnOpt;
  const set = (k, v) => { f[k] = v; go('cards'); };
  const all = I.owned(p);
  const SORTS = { rar: (a, b) => I.RARITIES.indexOf(a.rar) - I.RARITIES.indexOf(b.rar) || I.cardPower(b) - I.cardPower(a),
    power: (a, b) => I.cardPower(b) - I.cardPower(a), count: (a, b) => (p.cards[b.id] - p.cards[a.id]) || I.cardPower(b) - I.cardPower(a),
    no: (a, b) => a.id.localeCompare(b.id) };
  const list = all.filter((c) => (f.pack === 'ALL' || c.pack === f.pack) && (f.rar === 'ALL' || c.rar === f.rar)).sort(SORTS[f.sort]);
  const total = all.reduce((n, c) => n + p.cards[c.id], 0);
  if (!all.length) return [card('所持カード', [el('p', { text: 'まだカードが無い。ガチャで引こう。' }), button('ガチャへ', () => go('gacha'), { cls: 'primary' })])];
  return [
    shardPanel(app, go),
    card(`所持カード（${all.length} 種・${total} 枚）`, [
      tabs([{ id: 'ALL', name: '全弾' }, ...Object.keys(I.PACKS).map((id) => ({ id, name: `第${id.slice(1)}弾` }))], f.pack, (v) => set('pack', v)),
      tabs([{ id: 'ALL', name: '全レア' }, ...I.RARITIES.map((r) => ({ id: r, name: r }))], f.rar, (v) => set('rar', v)),
      tabs([{ id: 'rar', name: 'レア度順' }, { id: 'power', name: 'カードパワー順' }, { id: 'count', name: '枚数順' }, { id: 'no', name: '番号順' }], f.sort, (v) => set('sort', v)),
      list.length ? el('div.ik-icons', list.map((c) => cardIcon(app, c, p.cards[c.id])))
        : el('p.note', { text: 'この条件のカードは持っていない。' }),
      el('div.ik-gbtns', [button('カード図鑑を見る', () => go('book'))]),
    ]),
  ];
}

/**
 * 所持カードの一覧の 1 マス：馬の顔の丸いアイコン（枠の色がレア度）と名前・枚数・覚醒。
 * カード 1 枚まるごと並べると、50 種で縦に長く、顔も名前も小さくて見分けにくかった。押すとカードの詳細（カード全体）を開く。
 * 顔は画面に入ってから撮る（whenVisible。開いた瞬間に 50 枚を撮らない）。
 */
function cardIcon(app, c, count) {
  const face = el('span.ik-ico-face');
  const node = el(`button.ik-ico.r-${c.rar}`, { onclick: () => showCard(app, c), title: `${epithetOf(c)} ${c.name}` }, [
    el('span.ik-ico-ring', [face, el('span.ik-ico-rar', { text: c.rar })]),
    count > 1 ? el(`span.ik-ico-n${count >= I.KEEP ? '.max' : ''}`, [el('b', { text: `×${count}` }), el('i', { text: '◆'.repeat(Math.min(4, count - 1)) + '◇'.repeat(Math.max(0, 4 - (count - 1))) })]) : null,
    el('b.ik-ico-name', { text: c.name }),
    el('small', { text: `${c.turf >= c.dirt ? '芝' : 'ダ'}・${I.distCat(c.dist)}　${I.cardPower(c)}` }),
  ]);
  whenVisible(node, () => stickerInto(face, c, { mode: 'face', zoom: 2.4 }));
  return node;
}

/** かけら：余り（覚醒 MAX を超えた分）をまとめて替える欄。 */
function shardPanel(app, go) {
  const p = app.ik;
  const spare = I.spareValue(p);
  const n = I.CARDS.reduce((a, c) => a + I.spareOf(p, c.id), 0);
  return card('かけら', [
    el('div.ik-shardbox', [
      el('div.ik-shardn', [el('span.gem'), el('b', { text: I.shardsOf(p).toLocaleString() }), el('small', { text: 'かけら' })]),
      el('div.ik-shardtx', [
        el('p', { text: n ? `覚醒 MAX を超えた余りが ${n} 枚ある（替えると +${spare}）。` : '余りのカードは無い（6 枚目から余りになる）。' }),
        el('small', { text: `余り 1 枚 → ${I.RARITIES.map((r) => `${r} ${I.SHARD_VALUE[r]}`).join('・')}　／　交換 1 枚 → ${I.RARITIES.map((r) => `${r} ${I.SHARD_COST[r]}`).join('・')}。カードを押すと交換できる（図鑑の持っていないカードも）。` }),
      ]),
      button(n ? `余りをまとめて替える（+${spare}）` : '余りなし', async () => {
        if (!await ask(`余りのカード ${n} 枚をかけら ${spare} に替える？（覚醒 MAX の 5 枚は残る）`, { ok: '替える', cancel: 'やめる' })) return;
        const got = I.shardSpare(p);
        save(app);
        sound.play('win');
        toast(`かけら +${got}`);
        go('cards');
      }, { cls: 'primary', disabled: !n }),
    ]),
  ]);
}

/** カードのかけらの操作（余りを替える・かけらで 1 枚もらう）。 */
function shardActions(app, c, close) {
  const p = app.ik;
  const spare = I.spareOf(p, c.id);
  const cost = I.SHARD_COST[c.rar];
  const why = I.canBuyWithShards(p, c.id);
  const redo = () => { close(); app.go('ik', { view: app.params.view }); };
  return el('div.ik-shardact', [
    el('span.ik-shardn.sm', [el('span.gem'), el('b', { text: I.shardsOf(p).toLocaleString() })]),
    spare ? button(`余り ${spare} 枚をかけらに（+${spare * I.SHARD_VALUE[c.rar]}）`, () => {
      const got = I.shardSpare(p, c.id);
      save(app); sound.play('win'); toast(`かけら +${got}`); redo();
    }) : null,
    (p.cards[c.id] ?? 0) >= I.KEEP ? el('small', { text: '覚醒 MAX（これ以上は交換できない）' }) : button(`かけら ${cost} で 1 枚交換`, () => {
      const g = I.buyWithShards(p, c.id);
      save(app); sound.play('bell');
      toast(g.isNew ? `${c.name}を手に入れた！` : `${c.name}が覚醒${g.awaken >= I.AWAKEN.max ? 'MAX' : g.awaken}になった`);
      if (g.isNew) app.ikNew = true;
      redo();
    }, { cls: 'primary', disabled: !!why, title: why ?? '' }),
    why && (p.cards[c.id] ?? 0) < I.KEEP ? el('small', { text: why }) : null,
  ]);
}

/** 図鑑の持っていないカード：中身は見せず、レア度と番号だけでかけらと交換できる。 */
function showMissing(app, c) {
  let m = null;
  m = modal(`No.${c.id.split('-')[1]}（${c.rar}）`, [
    el('div.ik-missbig', [el(`b.${RCLS(c.rar)}`, { text: c.rar }), el('span', { text: '？？？' }), el('small', { text: `第${c.pack.slice(1)}弾 No.${c.id.split('-')[1]}` })]),
    el('p.note', { text: 'まだ持っていないカード。かけらで交換すると中身が分かる。' }),
    shardActions(app, c, () => m.close()),
  ]);
}

/** カード図鑑：全カード。持っていないカードは「？？？」で、集めた割合を弾とレア度ごとに出す。 */
function bookView(app, go) {
  const p = app.ik;
  app.ikBookOpt ??= { pack: 'ALL', rar: 'ALL' };
  const f = app.ikBookOpt;
  const set = (k, v) => { f[k] = v; go('book'); };
  const list = I.CARDS.filter((c) => (f.pack === 'ALL' || c.pack === f.pack) && (f.rar === 'ALL' || c.rar === f.rar));
  const got = (cs) => cs.filter((c) => p.cards[c.id]).length;
  const meter = (label, cs) => el('div.ik-meter', [
    el('span', { text: label }), el('span.bar', [el('i', { style: `width:${(got(cs) / cs.length) * 100}%` })]), el('b', { text: `${got(cs)}/${cs.length}` }),
  ]);
  return [
    card(`カード図鑑（${got(I.CARDS)} / ${I.CARDS.length} 種）`, [
      el('div.ik-meters', [
        ...Object.entries(I.PACKS).map(([id, name]) => meter(`第${id.slice(1)}弾【${name}】`, I.CARDS.filter((c) => c.pack === id))),
        ...I.RARITIES.map((r) => meter(r, I.CARDS.filter((c) => c.rar === r))),
      ]),
    ]),
    card('一覧', [
      tabs([{ id: 'ALL', name: '全弾' }, ...Object.keys(I.PACKS).map((id) => ({ id, name: `第${id.slice(1)}弾` }))], f.pack, (v) => set('pack', v)),
      tabs([{ id: 'ALL', name: '全レア' }, ...I.RARITIES.map((r) => ({ id: r, name: r }))], f.rar, (v) => set('rar', v)),
      el('div.ik-grid', list.map((c) => (p.cards[c.id]
        ? cardView(c, { scale: fit(0.26), count: p.cards[c.id], onClick: (x) => showCard(app, x) })
        : el('div.ik-missing.click', { style: `width:${630 * fit(0.26)}px;height:${880 * fit(0.26)}px`, onclick: () => showMissing(app, c) }, [
          el(`b.${RCLS(c.rar)}`, { text: c.rar }), el('span', { text: '？？？' }), el('small', { text: `No.${c.id.split('-')[1]}` }),
        ])))),
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
      d.trainee ? el('div.ik-deckskills', [
        el('div', [el('small', { text: `育てる馬のレーススキル${awkLabel(p, d.trainee)}` }), skillTags(I.skillsOf(I.cardById(d.trainee), I.awakenOfCard(p, d.trainee)).race, I.skillsOf(I.cardById(d.trainee)).unique)]),
        ...d.supports.map((id) => el('div', [el('small', { text: `${I.cardById(id).name}（サポート${awkLabel(p, id)}）` }), skillTags(I.skillsOf(I.cardById(id), I.awakenOfCard(p, id)).support, null, { small: true })])),
      ]) : null,
      el('p.note', { text: 'サポートと友情練習を 2 回すると（覚醒 3 なら 1 回）、そのサポートのレーススキルを覚える（完成馬に残る）。同じカードを重ねて持つと覚醒して強くなる。' }),
      el('div.ik-gbtns', [
        button('育成を始める', () => {
          I.startRun(p, d.trainee, d.supports);
          app.ikDeck = null;
          save(app);
          sound.play('ok');
          go('run');
        }, { cls: 'primary big', disabled: !ready }),
        button('おまかせ', () => {
          // 覚醒したカードを優先する（1 段でカードパワー 8 ぶん）
          const sc = (c) => I.cardPower(c) + 8 * I.awakenOfCard(p, c.id);
          const s = [...have].sort((a, b) => sc(b) - sc(a));
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

/** 覚醒の段（見出しに添える）。 */
const awkLabel = (p, id) => { const a = I.awakenOfCard(p, id); return a ? `・覚醒${a >= I.AWAKEN.max ? 'MAX' : a}` : ''; };

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
  const cap = (k) => I.capOf(plus[k], run.awaken?.t ?? 0);
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
      run.awaken?.t ? el('div', [el('small', { text: '覚醒' }), el('b.ik-awk', { text: `${'◆'.repeat(run.awaken.t)} ${run.awaken.t >= I.AWAKEN.max ? 'MAX' : run.awaken.t}` })]) : null,
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
          app.ikRace = { race: out.result, looks: looksOf([I.traineeSpec(run)]), mine: [1], order: out.order, back: 'run', title: o.name, fired: { 1: out.fired } };
          sound.play(out.order === 1 ? 'bell' : out.order <= 3 ? 'win' : 'ok');
          go('result');
        },
      }, [
        o.grade ? el(`span.gr.${o.grade}`, { text: o.grade }) : el('span.gr', { text: '条件' }),
        el('b', { text: o.name }),
        el('small', { text: `${o.surface}${o.distance}m・${o.ground}　相手の強さ ${lvlLabel(o.level)}` }),
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
          pv.skills.length ? el('div.sks', pv.skills.map((n) => el('i', { text: n }))) : null,
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
        card('スキル', [
          el('div.ik-deckskills', [
            el('div', [el('small', { text: 'レースで使う' }), skillTags(I.runSkills(run), I.skillsOf(c).unique)]),
            el('div', [el('small', { text: 'サポートとの絆（友情練習でスキルを覚える）' }), el('span.ik-bonds', run.supports.map((id, i) => {
              const sc = I.cardById(id);
              const b = (run.bonds ?? [])[i] ?? 0;
              const need = I.bondNeed(run, i);
              return el(`span.ik-bond${b >= need ? '.done' : ''}`, [el(`b.${RCLS(sc.rar)}`, { text: sc.name }), el('i', { text: b >= need ? '習得' : `${b}/${need}` })]);
            }))]),
          ]),
        ]),
        action,
        run.races.length ? card('レース', [table(['時期', 'レース', '', '着順', '発動スキル'], run.races.map((r) => [
          I.SLOTS[r.slot].label, r.name, `${r.surface}${r.distance}m${r.ground ? `・${r.ground}` : ''}`, el(`b${r.order === 1 ? '.win' : ''}`, { text: `${r.order}着/${r.field}` }),
          el('small', { text: (r.skills ?? []).join('・') || '—' }),
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
    m.set(f.id, { coat: f.coat ?? c?.coat ?? '鹿毛', marks: f.marks ?? c?.marks ?? null, cardId: c?.id ?? null });
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
      R.fired ? el('div.ik-fired', res.results.filter((r) => mine.has(r.horseId) && R.fired[r.horseId]?.length).map((r) =>
        el('div', [el('b', { text: `${r.name}　発動` }), ...R.fired[r.horseId].map((n) => el('span.ik-sk.race', n))]))) : null,
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
  const fx = el('div.ik-fx');
  const wrap = el('div.watch.ik-watch', [
    el('div.view', [canvas, hud, fx, el('div.rankbox', [el('h3', { text: R.title ?? race.name }), rankList])]),
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
    const skillFx = skillEffects(R, race, fx, view);
    view.onFrame = (st) => {
      skillFx.frame(st);
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
      onclick: (e) => { skillFx.setSpeed(s); [...sp.children].forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); },
    })));
    ctrl.append(sp, button('最初から', () => { view.seek(0); view.play(); }, { cls: 'sm ghost' }), button('結果へ', () => go('result'), { cls: 'sm primary' }));
    sound.play('gate');
    view.play();
  });
  app.cleanup = () => { if (view) view.dispose(); view = null; app.onResize = null; };
  return el('div.ik-w', wrap);
}

/**
 * スキル発動の演出。スキルの効き目はレース全体に掛かっている（結果は走る前に決まっている）ので、
 * 観戦では「その馬がスキルの場面に来たとき」に見せる（I.skillCue）。自分の馬は帯のカットイン、
 * 相手の馬は小さな札。LM の固有スキルは画面を横切る大きなカットインと 3D の金の光、再生を少しだけ遅くする。
 * 「最初から」で時間が戻ったら出し直す。
 */
function skillEffects(R, race, fx, view) {
  const mine = new Set(R.mine);
  const names = new Map(race.results.map((r) => [r.horseId, r.name]));
  const cues = [];
  for (const [hid, list] of Object.entries(R.fired ?? {})) {
    const id = Number(hid);
    if (!names.has(id)) continue;
    for (const n of list ?? []) { const q = I.skillCue(n, race.distance); cues.push({ id, name: n, mine: mine.has(id), unique: q.unique, at: q.at, done: false }); }
  }
  cues.sort((a, b) => a.at - b.at);
  // 固有スキルのカットインに馬の切り抜きを出す（撮ってある絵だけ）
  for (const c of cues.filter((x) => x.unique)) {
    const cid = R.looks?.get(c.id)?.cardId;
    const card = cid ? I.cardById(cid) : null;
    if (card) cardArtIfReady(card).then((a) => { c.img = a?.sticker?.url ?? null; });
  }
  let speed = 1, slowUntil = 0, slowTimer = 0, lastT = 0, lane = 0;
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
  const clear = () => {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    fx.textContent = '';
    clearTimeout(slowTimer);
    slowUntil = 0;
    view.setSpeed(speed);
  };
  const show = (c) => {
    if (c.unique && c.mine) {
      const node = el('div.ik-ult', [
        el('div.lines'),
        c.img ? el('img', { src: c.img, alt: '' }) : null,
        el('div.t', [el('small', { text: '固有スキル発動' }), el('b', { text: c.name }), el('span', { text: names.get(c.id) })]),
      ]);
      fx.appendChild(node);
      later(() => node.remove(), 2600);
      sound.play('bell');
      view.flare(c.id, { color: 0xffc83a, big: true });
      // 一瞬だけ遅くして見せ場にする（利用者の再生速度は覚えて戻す）
      view.setSpeed(speed * 0.35);
      slowUntil = performance.now() + 1500;
      clearTimeout(slowTimer);
      slowTimer = setTimeout(() => { slowUntil = 0; view.setSpeed(speed); }, 1500);
      return;
    }
    const cls = c.mine ? (c.unique ? 'uniq' : 'race') : 'npc';
    const node = el(`div.ik-cut.${cls}`, { style: `--lane:${lane}` }, [
      el('i', { text: c.mine ? 'SKILL' : '相手' }),
      el('b', { text: c.name }),
      el('small', { text: names.get(c.id) }),
    ]);
    lane = (lane + 1) % 3;
    fx.appendChild(node);
    later(() => node.remove(), c.mine ? 1900 : 1500);
    if (c.mine) sound.play('win');
    view.flare(c.id, { color: c.unique ? 0xffc83a : c.mine ? 0x5ec8ff : 0xff6a6a, big: c.unique });
  };
  return {
    frame(st) {
      if (st.time < lastT - 0.05) { clear(); for (const c of cues) c.done = false; }
      lastT = st.time;
      const s = new Map(st.ranked.map((r) => [r.id, r.s]));
      for (const c of cues) {
        if (c.done || (s.get(c.id) ?? 0) < c.at) continue;
        c.done = true;
        show(c);
      }
    },
    setSpeed(x) { speed = x; if (!slowUntil) view.setSpeed(x); },
  };
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
    el('div.ik-icons', list.map((h) => finishedIcon(h, go))),
    el('p.note', { text: '押すと詳細（対戦・ホームに立たせる・手放す）。評価点の高い順。' }),
  ])];
}

/**
 * 完成馬の一覧の 1 マス（所持カードの cardIcon と同じ顔のアイコン）。右上は評価、下は戦績と評価点。
 * 以前の横長の札（finishedCard）は 1 頭に 1 行を使い、頭数が増えると探しにくかった。
 */
function finishedIcon(h, go) {
  const c = I.cardById(h.cardId);
  const face = el('span.ik-ico-face');
  const node = el(`button.ik-ico.r-${h.rar}`, { onclick: () => go('horse', { id: h.id }), title: `${h.name}　評価点 ${h.rating}` }, [
    el('span.ik-ico-ring', [face, el('span.ik-ico-rar', { text: h.rar })]),
    el(`span.ik-ico-rk.rk-${h.rank.replace('+', 'p')}`, { text: h.rank }),
    el('b.ik-ico-name', { text: h.name }),
    el('small', { text: `${h.starts}戦${h.wins}勝${h.giWins ? `・GI${h.giWins}` : ''}　${h.rating}` }),
  ]);
  if (c) whenVisible(node, () => stickerInto(face, c, { mode: 'face', zoom: 2.4 }));
  return node;
}

/** 脚質の名前（カードの style は 0 逃げ〜1 追込）。 */
const styleName = (x) => (x < 0.25 ? '逃げ' : x < 0.5 ? '先行' : x < 0.75 ? '差し' : '追込');
const MARK = (a) => (a >= 0.8 ? '◎' : a >= 0.7 ? '○' : a >= 0.6 ? '△' : '×');
const r100 = (x) => Math.round(x / 100) * 100;

/**
 * 完成馬の詳細（牧場の馬の詳細 stable.js の detail と同じ組み立てを、育成モードの見た目で）。
 * 見出し → 舞台（主役の切り抜き・情報の板・前後の馬へ送る） → タブ（詳細・成績・能力・血統） → 操作。
 */
function horseView(app, go) {
  const p = app.ik;
  const lineup = [...p.finished].sort((a, b) => b.rating - a.rating);
  const h = lineup.find((x) => x.id === app.params.id) ?? lineup[0];
  if (!h) return stableView(app, go);
  const c = I.cardById(h.cardId);
  const at = lineup.indexOf(h);
  const step = (d) => app.go('ik', { view: 'horse', id: lineup[(at + d + lineup.length) % lineup.length].id }, { replace: true });

  // 成績の内訳（育成のレースの記録から）
  const races = h.races ?? [];
  const tally = (rs) => [1, 2, 3].map((n) => rs.filter((r) => r.order === n).length).concat(rs.filter((r) => r.order > 3).length);
  const lines = [
    ['全成績', races], ['芝', races.filter((r) => r.surface === '芝')], ['ダート', races.filter((r) => r.surface === 'ダート')],
    ['GⅠ', races.filter((r) => r.grade === 'GI')], ['GⅡ', races.filter((r) => r.grade === 'GII')], ['GⅢ', races.filter((r) => r.grade === 'GIII')],
  ];
  const big = races.filter((r) => r.order === 1 && /^G/.test(r.grade ?? ''));
  const lo = Math.max(1000, r100(h.dist - (h.range ?? 400))), hi = Math.min(3600, r100(h.dist + (h.range ?? 400)));
  const ribbon = h.giWins ? `GI ${h.giWins}勝の${h.sex === '牝' ? '名牝' : '名馬'}` : h.gradedWins ? '重賞馬' : h.wins ? `${h.wins}勝の${styleName(h.style)}馬` : '未勝利';

  const img = el('img.ikx-sticker', { alt: h.name, draggable: false });
  if (c) stickerInto(img, c);
  const info = el('section.ikx-info', [
    el('div.ikx-ribbon', { text: ribbon }),
    el('div.ikx-rank', [el(`b.rk-${h.rank.replace('+', 'p')}`, { text: h.rank }), el('small', { text: `評価点 ${h.rating}` })]),
    el('dl.ikx-rows', [
      el('dt', { text: '戦績' }), el('dd', { text: `${h.starts}戦${h.wins}勝` }),
      el('dt', { text: 'ファン' }), el('dd', { text: `${(h.fans ?? 0).toLocaleString()}人` }),
      el('dt', { text: '対戦' }), el('dd', { text: `${h.battles}戦${h.battleWins}勝` }),
      el('dt', { text: '距離' }), el('dd', [el('em', { text: `${lo}m` }), ' 〜 ', el('em', { text: `${hi}m` })]),
      el('dt', { text: '馬場' }), el('dd.ikx-chips', [
        el('i', { text: `芝${MARK(h.turf)}` }), el('i', { text: `ダ${MARK(h.dirt)}` }), el('i', { text: `良${MARK(h.firm)}` }), el('i', { text: `重${MARK(h.soft)}` }),
      ]),
      el('dt', { text: '脚質' }), el('dd.ikx-style', ['逃げ', '先行', '差し', '追込'].map((s) => el('i', { text: s[0], class: s === styleName(h.style) ? 'on' : null }))),
    ]),
  ]);
  const stage = el('div.ikx-stage', [
    el('div.ikh-city'),
    el('button.ikx-hero', { onclick: () => c && showCard(app, c), title: 'カードを見る' }, img),
    info,
    lineup.length > 1 ? el('button.ikx-arrow.l', { onclick: () => step(-1), title: '前の馬' }, icon('back', { size: 24 })) : null,
    lineup.length > 1 ? el('button.ikx-arrow.r', { onclick: () => step(1), title: '次の馬' }, icon('back', { size: 24 })) : null,
  ]);

  const TABS = [{ id: 'info', name: '詳細' }, { id: 'record', name: '成績' }, { id: 'abil', name: '能力' }, { id: 'ped', name: '血統' }];
  app.ikHorseTab = TABS.some((t) => t.id === app.ikHorseTab) ? app.ikHorseTab : 'info';
  const body = el('div.ikx-body');
  const bar = el('nav.tabs');
  const show = (tid) => {
    app.ikHorseTab = tid;
    bar.replaceChildren(...TABS.map((t) => el('button.tab', { text: t.name, class: t.id === tid ? 'on' : null, onclick: () => show(t.id) })));
    body.replaceChildren(tabBody(tid));
  };
  const tabBody = (tid) => {
    if (tid === 'record') {
      return races.length ? table(['時期', 'レース', '距離', '着', '時計'], races.map((r) => [
        I.SLOTS[r.slot]?.label ?? '', el('span', [r.grade ? el(`span.gr.${r.grade}`, { text: r.grade }) : null, ` ${r.name}`]),
        `${r.surface}${r.distance}m`, el(`b${r.order === 1 ? '.win' : ''}`, { text: `${r.order}/${r.field}` }), r.time ? formatTime(r.time) : '—',
      ]), { cls: 'ik-tbl' }) : el('p.note', { text: '記録が無い。' });
    }
    if (tid === 'abil') {
      const plus = c ? I.plusOf(c) : null;
      return el('div', [
        el('div.ik-stats', I.STATS.map((k) => el('div.ik-stat', [
          el('span.l', { text: I.STAT_LABEL[k] }),
          el(`b.g.g-${I.gradeOfPts(h.stats[k]).replace('+', 'p')}`, { text: I.gradeOfPts(h.stats[k]) }),
          el('span.n', { text: String(h.stats[k]) }),
          el('span.bar', [el('i', { style: `width:${(h.stats[k] / 1200) * 100}%` }), plus ? el('em', { style: `left:${(I.capOf(plus[k], h.awaken ?? 0) / 1200) * 100}%` }) : null]),
        ]))),
        el('p.note', { text: '数字は育成で鍛えた点（1200 点が上限）。黄色の線はカードの +値で決まる伸びしろの上限。' }),
      ]);
    }
    if (tid === 'ped') {
      return el('div.ikx-ped', c ? [
        el('div.pp.s', [el('small', { text: '父' }), el('b', { text: c.sire })]),
        el('div.pp.d', [el('small', { text: '母' }), el('b', { text: c.dam })]),
        el('div.pp.ds', [el('small', { text: '母の父' }), el('b', { text: c.damSire })]),
        el('div.pp.ln', [el('small', { text: '系統' }), el('b', { text: c.line })]),
      ] : [el('p.note', { text: 'カードが見つからない。' })]);
    }
    return el('div.ikx-cols', [
      el('div', [
        el('h4', { text: '成績の内訳（1着-2着-3着-着外）' }),
        el('div.ikx-crs', lines.map(([l, rs]) => el('div', [el('span', { text: l }), el('b', { text: tally(rs).join('-') })]))),
      ]),
      el('div', [
        el('h4', { text: '主な勝鞍' }),
        big.length ? el('ul.ikx-wins', big.map((r) => el('li', [el(`span.gr.${r.grade}`, { text: r.grade }), ` ${r.name}`, el('small', { text: ` ${I.SLOTS[r.slot]?.label ?? ''}` })])))
          : el('p.note', { text: '重賞の勝ち鞍はまだ無い。' }),
        el('h4', { text: 'スキル' }),
        skillTags(I.finishedSkills(h), c ? I.skillsOf(c).unique : null),
        el('h4', { text: '育てたカード' }),
        el('div.ikx-sups', [c ? el(`span.${RCLS(c.rar)}`, { text: `育成 ${c.rar} ${c.name}` }) : null,
          ...(h.supports ?? []).map((id) => I.cardById(id)).filter(Boolean).map((s) => el(`span.${RCLS(s.rar)}`, { text: `${s.rar} ${s.name}` }))]),
      ]),
    ]);
  };
  show(app.ikHorseTab);

  return [
    el('header.ikx-top', [
      el(`span.rb.r-${h.rar}`, { text: h.rar }),
      el('div.ikx-name', [el('small', { text: c ? epithetOf(c) : '' }), el('b', { text: h.name })]),
      el('span.ikx-sa', { text: `${h.sex}　${h.coat}` }),
      lineup.length > 1 ? el('span.ikx-count', { text: `${at + 1} / ${lineup.length}` }) : null,
    ]),
    stage,
    el('div.card.ikx-panel', [el('div.card-b', [bar, body])]),
    el('div.ik-gbtns', [
      button('この馬で対戦', () => { app.ikBattle = { ...(app.ikBattle ?? {}), horse: h.id }; go('battle'); }, { cls: 'primary' }),
      c ? button('ホームに立たせる', () => { p.fav = c.id; save(app); toast(`${h.name}をホームに立たせた`); }) : null,
      button('一覧へ', () => go('stable')),
      button('手放す', async () => {
        if (!await ask(`${h.name}を手放す？`, { ok: '手放す' })) return;
        p.finished = p.finished.filter((x) => x !== h); save(app); go('stable');
      }, { cls: 'ghost' }),
    ]),
  ];
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
    app.ikRace = { race: out.result, looks: looksOf(out.field), mine: [100], order: out.order, back: 'battle', title: `ランク戦 ${out.race.name}（${I.DIFFICULTY[B.diff].name}）`, fired: out.fired };
    sound.play(out.order === 1 ? 'bell' : out.order <= 3 ? 'win' : 'ok');
    go('result');
  };
  const runOwn = () => {
    if (B.own.length < 2) return toast('2 頭以上を選ぶ', { bad: true });
    const out = I.battleOwn(p, B.own, B.race);
    save(app);
    app.ikRace = { race: out.result, looks: looksOf(out.field), mine: out.field.map((f) => f.id), back: 'battle', title: `完成馬対決 ${out.race.name}`, fired: out.fired };
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
