// 育成モード（カード）。ガチャ・カード一覧・編成と育成・完成馬・対戦。
// 牧場経営とは別のモードで、世界（game.js）は使わない。入口は sim/ikusei.js だけ。
// プロフィールは localStorage に置く（数 KB。牧場のセーブの IndexedDB とは別）。
// 画面は app.go('ik', { view }) で切り替える。レースの結果（走行ログ）は保存しないので app.ikRace に持つ。

import { createRaceHud } from '../racehud.js';
import { el, card, table, button, toast, modal, ask, tabs, frameChip } from '../dom.js';
import { icon } from '../icons.js';
import { cardArt, cardArtIfReady, artRenderer, ART_SIZE } from '../../render3d/cardart.js';
import { createPoseStage, shotCamera, SHOTS } from '../../render3d/photostage.js';
import { fxPainter } from '../../render3d/skillfx.js';
import * as I from '../../sim/ikusei.js';
import { cardView, epithetOf, holoOf, holoName, whenVisible } from '../cardview.js';
import { createRaceView, CAMERAS } from '../../render3d/raceview.js';
import { formatTime } from '../../core/util.js';
import * as sound from '../sound.js';

/** 画面の題（日本語と英語の小見出し）。 */
const TITLES = {
  gacha: ['ガチャ', 'GACHA'], cards: ['所持カード', 'MY CARDS'], book: ['カード図鑑', 'CARD BOOK'], run: ['育成', 'TRAINING'], horse: ['完成馬', 'HORSE'],
  stable: ['完成馬', 'STABLE'], deck: ['編成', 'DECK'], battle: ['対戦', 'BATTLE'], result: ['レース結果', 'RESULT'], event: ['イベント', 'EVENT'],
  cardedit: ['カード編集', 'CARD EDIT'], mission: ['ミッション', 'MISSION'], rival: ['ライバルレース', 'RIVAL RACE'],
  npc: ['ランク戦', 'RANK MATCH'], own: ['完成馬対決', 'STABLE MATCH'], records: ['記録', 'RECORDS'],
};
/** 画面の同一性（戻る履歴の鍵）。画面と、その画面が何を見ているか（馬・イベント）。 */
const histKey = (pr) => [pr.view ?? 'home', pr.id ?? '', pr.ev ?? ''].join(':');
/** 端末の今日（'YYYY-MM-DD'、0:00 で切り替わる）。ライバルレースの 1 日の上限に使う（sim は日付を作らない）。 */
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** 弾の短い名前（タブ用）。イベントの報酬は「イベント」。 */
const packTab = (id) => (id in I.PACKS ? `第${id.slice(1)}弾` : I.PACK_NAMES[id]);

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
  // ウイコイン（W の刻印の硬貨）。icons.js の coin は円の印なので、ガチャのトークンには使わない
  wcoin: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6.3" stroke-width="1.2" opacity=".55"/><path d="M8 9.3l1.6 5.6L12 10.4l2.4 4.5L16 9.3"/>',
  // 王冠（記録と殿堂）
  crown: '<path d="M4 8.5l3.8 3.5L12 5.5l4.2 6.5L20 8.5l-1.6 9.5H5.6z"/><path d="M6 21h12"/>',
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
  // 1 日・週のミッションの始めの数は、日・週が変わってから最初に描くときに写す（sim は日付を作らない）
  I.rollQuests(app.ik, todayKey());
  const view = app.params.view ?? 'home';
  const go = (v, extra = {}) => app.go('ik', { view: v, ...extra });
  // カードエディットの生の舞台は、画面を描き直すたびに捨てる（作ったまま離れると three.js の形と布が残る）
  if (app.ikStage) { app.ikStage.dispose(); app.ikStage = null; }
  if (view !== 'cardedit') app.ikEdit = null;
  // 来た道（戻るボタンの行き先）。ホームで空にし、同じ画面へ戻ってきたらそこまで切り詰める（行き来で積み上がらない）。
  // 以前は戻るボタンがいつもホームへ飛んでいた
  app.ikHist ??= [];
  if (view === 'home') app.ikHist = [];
  else if (view !== 'watch' && view !== 'cardedit') {
    const k = histKey(app.params);
    const i = app.ikHist.findIndex((e) => e.k === k);
    if (i >= 0) { app.ikHist.length = i + 1; app.ikHist[i].params = { ...app.params }; } else app.ikHist.push({ k, params: { ...app.params } });
  }
  const back = () => {
    app.ikHist.pop();
    const prev = app.ikHist.at(-1);
    if (prev) app.go('ik', prev.params); else go('home');
  };
  if (view === 'watch') return watchView(app);
  // カード編集は全画面の別ページ（下のボタン列を出さず、絵を大きく）
  if (view === 'cardedit') return cardEditView(app, go);
  // 背景（空・網点・街）は画面の外に固定して敷く。中身だけが流れる（background-attachment: fixed はスマホで効かない）。
  const sky = el('div.ik-sky', [el('b.ik-water', { text: 'WINNING ROAD' })]);
  if (view === 'home') return el('div.ikh-wrap', [sky, homeView(app, go)]);
  const body = { gacha: gachaView, cards: cardsView, book: bookView, run: runView, stable: stableView, horse: horseView, battle: battleView, result: resultView, event: eventView, deck: deckOnlyView, cardedit: cardEditView, mission: missionView, rival: rivalView, npc: npcView, own: ownView, records: recordsView }[view] ?? gachaView;
  const navId = view === 'result' ? (app.ikRace?.back ?? 'run') : view === 'horse' || view === 'deck' || view === 'cardedit' ? 'stable' : view === 'records' ? 'records' : view === 'book' ? 'cards' : ['event', 'rival', 'npc', 'own'].includes(view) ? 'battle' : view === 'mission' ? 'gacha' : view;
  const [jp, en] = TITLES[view] ?? ['', ''];
  return el('div.ikp-wrap', [
    sky,
    el('div.ikp', [
      el('header.ikp-top', [
        el('button.ikp-back', { onclick: back, title: '戻る' }, icon('back', { size: 26 })),
        el('div.ikp-title', [el('b', { text: jp }), el('small', { text: en })]),
        shardPill(app, go),
        coinPill(app, go),
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
  // 配合で作った完成馬（B<id>）もホームに立たせられる
  const bred = (id) => { const h = typeof id === 'string' && id[0] === 'B' ? p.finished.find((x) => `B${x.id}` === id) : null; return h ? I.horseCard(h) : null; };
  return own(p.fav) ?? bred(p.fav) ?? (p.run?.sire ? I.traineeCard(p.run) : own(p.run?.trainee)) ?? (best ? I.horseCard(best) : null) ?? top ?? I.cardById('P1-40') ?? I.CARDS[0];
}
/** 二つ名（配合の馬は両親）。 */
const epiOf = (c) => (c.bred ? `${c.sire} × ${c.dam}` : epithetOf(c));

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

/** かけらの数（押すと所持カードの交換の欄へ）。 */
function shardPill(app, go) {
  const n = I.shardsOf(app.ik);
  const spare = I.spareValue(app.ik);
  return el('button.ik-shard', { onclick: () => go('cards'), title: spare ? `余りを替えると +${spare}` : 'かけら' }, [
    el('span.gem'), el('b', { text: n.toLocaleString() }), spare ? el('i.dot') : null,
  ]);
}

/** ウイコインの数（ガチャ 1 回 1 枚）。＋はミッションへ（集め方）。 */
function coinPill(app, go) {
  return el('span.ik-coin', [
    el('button.ik-coin-n', { onclick: () => go('gacha'), title: 'ウイコイン（ガチャ 1 回 1 枚）' }, [el('span.cn', ic('wcoin', 20)), el('b', { text: I.coinsOf(app.ik).toLocaleString() })]),
    el('button.plus', { onclick: () => go('mission'), title: 'ウイコインを集める', text: '+' }),
  ]);
}

/** 下のボタン列（参考画像の SHOP・神明・CLUB・宠物・召唤）。 */
function dock(app, go, current) {
  const p = app.ik;
  // 中身は span.ikd-in に包む（ガチャのボタンは菱形に回すので、中身だけ逆に回して立てる）
  // el() の onX は addEventListener で付くので、後から node.onclick を代入しても go() は消えない。押し方は引数で渡す
  const b = (id, jp, en, iconName, cls, badge = null, onclick = () => go(id)) => el(`button.ikd.${cls}${current === id ? '.on' : ''}`, { onclick }, [
    el('span.ikd-in', [
      el('span.ikd-ic', ic(iconName, cls === 'gacha' ? 28 : 24)),
      el('span.ikd-t', [el('b', { text: jp }), el('small', { text: en })]),
    ]),
    badge ? el('i.ik-badge', { text: badge }) : null,
  ]);
  // 「カード」は所有カード・完成馬・編成の 3 つをまとめた札。押すと上に小さな一覧が開く（ボタン列の数を増やさない）
  const cardViews = ['cards', 'book', 'stable', 'horse', 'deck', 'records'];
  const menu = el('div.ikd-menu', [
    ['cards', '所有カード', 'cards'], ['stable', '完成馬', 'trophy'], ['deck', '編成', 'horse'], ['records', '記録と殿堂', 'crown'],
  ].map(([id, jp, icn]) => el(`button.ikd-mi${current === id ? '.on' : ''}`, { onclick: (e) => { e.stopPropagation(); close(); go(id); } }, [ic(icn, 18), el('b', { text: jp })])));
  // 外を押したら閉じる。閉じる係は開いている間だけ付ける（最初から付けると、開いた直後の別のクリックで消える）
  const close = () => { wrap.classList.remove('open'); document.removeEventListener('click', close); };
  const cardsBtn = b('cards', 'カード', 'CARDS', 'cards', 'cards', app.ikNew ? 'NEW' : null, (e) => {
    e.stopPropagation();
    if (wrap.classList.toggle('open')) document.addEventListener('click', close);
    else document.removeEventListener('click', close);
  });
  if (cardViews.includes(current)) cardsBtn.classList.add('on');
  const wrap = el('div.ikd-cardwrap', [menu, cardsBtn]);
  return el('nav.ik-dock', [
    wrap,
    b('run', '育成', 'TRAINING', 'horse', 'run', p.run ? '!' : null),
    b('home', 'ホーム', 'HOME', 'home', 'stable'),
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
    onclick: () => (hc.bred ? (p.run && `B${p.run.id}` === hc.id ? go('run') : go('horse', { id: Number(hc.id.slice(1)) })) : p.cards[hc.id] ? showCard(app, hc) : go('gacha')),
    title: hc.bred ? '馬を見る' : p.cards[hc.id] ? 'カードを見る' : 'ガチャで出る',
  }, [heroImg, el('div.ikh-plate', [
    el(`span.rb.r-${hc.rar}`, { text: hc.rar }),
    el('span.nm', [el('small', { text: epiOf(hc) }), el('b', { text: hc.name })]),
    p.cards[hc.id] || hc.bred ? null : el('em', { text: '未所持' }),
  ])]);

  // 左上：アバター（主役の顔）と戦力。押すとお気に入りを選ぶ
  const ava = el('span.ikh-ava-img');
  stickerInto(ava, hc, { mode: 'face' });
  const top = el('header.ikh-top', [
    el('button.ikh-ava', { onclick: () => pickFavorite(app, go), title: 'ホームの馬を選ぶ' }, [ava]),
    el('div.ikh-power', [svg('fist', 16), el('b', { text: power.toLocaleString() })]),
    el('div.ikh-sp'),
    shardPill(app, go),
    coinPill(app, go),
  ]);

  // 左の列：開催中のパック・遊びかた
  const ev = (cls, label, c, onclick, badge) => {
    const face = el('span.ikh-ev-face');
    if (c) stickerInto(face, c, { mode: 'face' });
    return el(`button.ikh-ev.${cls}`, { onclick }, [face, el('span.ikh-ev-l', { text: label }), badge ? el('i.ik-badge', { text: badge }) : null]);
  };
  const gc = I.CARDS.find((c) => c.name === 'アーモンドアイ') ?? I.CARDS[0];
  // 開催中のイベントは新しいものから（ほかのイベントは対戦の画面のバナーから入れる）
  const evNow = I.EVENTS.at(-1);
  const evCard = I.cardById(evNow.reward);
  const evLeft = 5 - I.eventState(p, evNow.id).cleared.length;
  const left = el('nav.ikh-left', [
    ev('evt', 'イベント 開催中', evCard, () => go('event', { ev: evNow.id }), evLeft ? String(evLeft) : null),
    ev('p2', 'ガチャ NEW', gc, () => go('gacha'), '!'),
    (() => { const x = ev('howto', '遊びかた', null, showHowto); x.querySelector('.ikh-ev-face').append(svg('book', 30)); return x; })(),
  ]);

  // 右の列：丸いボタン
  const muteIc = el('span', ic(sound.isMuted() ? 'mute' : 'sound', 24));
  // ミッションの札：受け取れる 1 日・週のミッションの数（無ければ、いまの育成で達成するカードの数）
  const qReady = I.questState(p, todayKey()).ready;
  const pend = I.missionGain(p).length;
  const right = el('nav.ikh-right', [
    el('button.ikh-rb', { onclick: () => go('mission'), title: 'ミッション（ウイコインを集める）' }, [ic('trophy', 24), el('small', { text: 'ミッション' }),
      qReady ? el('i.ik-badge.ready', { text: String(qReady) }) : pend ? el('i.ik-badge', { text: `+${pend}` }) : null]),
    el('button.ikh-rb', { onclick: () => go('records'), title: '記録と殿堂' }, [ic('crown', 24), el('small', { text: '記録' })]),
    el('button.ikh-rb', { onclick: () => go('book'), title: 'カード図鑑' }, [ic('book', 24), el('small', { text: '図鑑' })]),
    el('button.ikh-rb', {
      onclick: () => { sound.setMuted(!sound.isMuted()); muteIc.replaceChildren(ic(sound.isMuted() ? 'mute' : 'sound', 24)); sound.play('ok'); },
      title: '効果音の入切',
    }, [muteIc, el('small', { text: '音' })]),
    el('button.ikh-rb', { onclick: () => app.go('title', {}, { replace: true }), title: 'タイトルへ' }, [ic('exit', 24), el('small', { text: 'タイトル' })]),
  ]);

  // 左下：育成の進み（参考画像の「当前进度」）
  const tc = run ? I.traineeCard(run) : null;
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
    ticket('t1', 'ランク', '対戦', hc, `段位 ${I.ladderState(p).name}`, () => go('npc')),
    ticket('t2', 'カード', '図鑑', second, `${have.length}/${I.CARDS.length}`, () => go('book')),
  ]);

  // 殿堂の馬はホームの上に飾る（顔の丸い額。押すとその馬）
  const hallIds = I.hallOf(p);
  const hall = hallIds.length ? el('div.ikh-hall', [el('small', { text: '殿堂' }), ...hallIds.map((id) => {
    const h = p.finished.find((x) => x.id === id);
    const f = el('span.ikh-hall-face');
    stickerInto(f, I.horseCard(h), { mode: 'face', zoom: 2.4 });
    return el('button.ikh-hall-b', { onclick: () => go('horse', { id }), title: `${h.name}（${h.rank}・${h.rating}）` }, [f, el(`i.rk-${h.rank.replace('+', 'p')}`, { text: h.rank })]);
  })]) : null;
  return el('div.ikh', [
    top,
    el('div.ikh-stage', [el('div.ikh-city'), hero, left, right, hall, prog, tickets]),
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
    el('li', { text: `ガチャ：1 回にウイコイン 1 枚。排出率 LM 2%・SSR 6%・SR 15%・R 27%・N 50%。` }),
    el('li', { text: `ウイコインの集め方：ミッション（カードを初めて編成して育成を終えると、そのカード 1 枚ごとに 1 枚）と、対戦のライバルレース（☆1〜☆5。勝つと 1〜3 枚、1 日 ${I.RIVAL_DAILY} 枚まで。0:00 に戻る。勝った☆はスキップできる）。` }),
    el('li', { text: '育てる馬：カードの能力が出発点、+値が伸びしろ（+5 で上限 1200 点、+1 で 720 点）。距離・馬場の適性もカードのまま。' }),
    el('li', { text: 'サポート：練習場に顔を出すと伸びが増える。得意な練習（カードのいちばん高い能力）で会うと「友情」でさらに伸びる。レア度が高いほど友情が強い。' }),
    el('li', { text: '1 戦ごとに 3 回の練習。体力が 50 を切ると練習に失敗しやすくなる（賢さの練習は失敗しない）。休むと体力が戻る。' }),
    el('li', { text: 'レースは勝ち数でクラスが上がり、1 勝すると重賞、2 勝か重賞勝ちで GI に出られる。勝つと全能力と気分が上がる。' }),
    el('li', { text: 'ホーム左上の顔を押すと、ホームに立たせる馬を選べる。' }),
  ])]);
}

// ---------------------------------------------------------------- ウイコイン

/** ウイコインの集め方（ガチャで足りないとき・ミッションの画面の頭）。 */
function coinHowto(app, go) {
  const p = app.ik;
  const rs = I.rivalState(p, todayKey());
  const pend = I.missionGain(p).length;
  return el('div.ik-howcoin', [
    el('button.ik-howc', { onclick: () => go('mission') }, [ic('trophy', 22), el('span', [el('b', { text: 'ミッション' }),
      el('small', { text: (() => { const q = I.questState(p, todayKey()); return q.ready ? `受け取れるミッション ${q.ready} 個` : pend ? `いまの育成を終えると +${pend} 枚` : '1 日・週のミッションとカードの初編成'; })() })])]),
    el('button.ik-howc', { onclick: () => go('rival') }, [ic('sword', 22), el('span', [el('b', { text: 'ライバルレース' }),
      el('small', { text: `今日 ${rs.got}/${I.RIVAL_DAILY} 枚（0:00 に戻る）` })])]),
  ]);
}

/**
 * ミッション：1 日（0:00 で戻る）・週（月曜 0:00 で戻る）・カード（初めて編成したカードの育成で 1 枚、カードごとに 1 度だけ）。
 * 1 日と週は、達成したら押して受け取る。タブは app.ikMisTab に覚える。
 */
function missionView(app, go) {
  const p = app.ik;
  const today = todayKey();
  const qs = I.questState(p, today);
  const done = new Set(I.missionsOf(p));
  const pend = new Set(I.missionGain(p));
  const have = I.owned(p);
  const todo = have.filter((c) => !done.has(c.id));
  const total = I.CARDS.filter((c) => c.pack in I.PACKS || p.cards[c.id]).length;
  const icons = (xs) => el('div.ik-icons', xs.map((c) => {
    const n = cardIcon(app, c, p.cards[c.id]);
    if (done.has(c.id)) n.classList.add('ms-done');
    n.append(el(`i.ik-ms${done.has(c.id) ? '.ok' : pend.has(c.id) ? '.now' : ''}`, { text: done.has(c.id) ? '達成' : pend.has(c.id) ? '育成中' : '+1' }));
    return n;
  }));
  const claim = (id) => { const n = I.claimQuest(p, id, today); if (n) { save(app); sound.play('win'); toast(`ウイコイン +${n}`); app.render(); } };
  const row = (q) => el(`div.ik-quest${q.got ? '.got' : q.ready ? '.ready' : ''}`, [
    el('div.ik-quest-t', [el('b', { text: q.label }), el('span.ik-quest-bar', [el('i', { style: `width:${(q.have / q.need) * 100}%` })]), el('small', { text: `${q.have} / ${q.need}` })]),
    el('span.ik-quest-c', [ic('wcoin', 18), el('b', { text: `×${q.coins}` })]),
    q.got ? el('span.ik-quest-ok', { text: '受取済' }) : button('受け取る', () => claim(q.id), { cls: q.ready ? 'primary' : '', disabled: !q.ready }),
  ]);
  const TABS = [['daily', '1日', qs.daily.filter((x) => x.ready).length], ['weekly', '週', qs.weekly.filter((x) => x.ready).length], ['card', 'カード', pend.size]];
  app.ikMisTab = TABS.some((t) => t[0] === app.ikMisTab) ? app.ikMisTab : 'daily';
  const tab = app.ikMisTab;
  const bar = el('nav.tabs.ik-mistabs', TABS.map(([id, nm, n]) => el(`button.tab${tab === id ? '.on' : ''}`, { onclick: () => { app.ikMisTab = id; app.render(); } },
    [nm, n ? el('i.ik-badge.ready', { text: String(n) }) : null])));
  const body = tab === 'card' ? [
    card(`初編成で育成完了（${done.size}/${total}）`, [
      el('p.note', { text: 'カードを父・母・サポートのどれかで初めて編成し、その育成を最後まで終えると、カード 1 枚ごとにウイコイン 1 枚（カードごとに 1 度だけ）。' }),
      p.run ? el('p', { text: pend.size ? `いまの育成（${I.traineeCard(p.run).name}）を終えると +${pend.size} 枚。` : 'いまの育成のカードはどれも達成済み。' }) : null,
      todo.length ? icons(todo) : el('p.note', { text: '持っているカードはすべて達成済み。' }),
      el('div.ik-gbtns', [button(p.run ? '育成へ' : '編成へ', () => go('run'), { cls: 'primary' })]),
    ]),
    done.size ? card(`達成済み（${done.size}）`, [icons(have.filter((c) => done.has(c.id)))]) : null,
  ] : [card(tab === 'daily' ? '1 日のミッション（0:00 に戻る）' : `週のミッション（月曜 0:00 に戻る・あと ${qs.weekLeft} 日）`, [
    el('div.ik-quests', (tab === 'daily' ? qs.daily : qs.weekly).map(row)),
    el('p.note', { text: 'ライバルレースのスキップも勝ちに数える。対戦はランク戦・ライバルレース・イベント・完成馬対決のどれでも。' }),
  ])];
  return [
    coinHowto(app, go),
    bar,
    qs.ready ? el('div.ik-gbtns', [button(`まとめて受け取る（${qs.ready}）`, () => { const n = I.claimAllQuests(p, today); if (n) { save(app); sound.play('win'); toast(`ウイコイン +${n}`); app.render(); } }, { cls: 'primary' })]) : null,
    ...body,
  ];
}

// ---------------------------------------------------------------- ガチャ

function gachaView(app, go) {
  const p = app.ik;
  const last = app.ikLast ?? [];
  // ガチャは一つ（弾を選ばず全カードから引く）。弾はカードの通し番号と図鑑の区分にだけ残す
  const coins = I.coinsOf(p);
  const pull = (n) => {
    let got;
    try { got = I.pull(p, n, 'ALL'); } catch (e) { return toast(e.message, { bad: true }); }
    save(app);
    app.ikLast = got;
    if (got.some((g) => g.isNew)) app.ikNew = true;   // 下のボタン列の「カード」に NEW を付ける（図鑑を開くまで）
    app.ikReveal = true;   // 次の描画で 1 度だけ、伏せて配ってめくる（描き直したら表のまま）
    sound.play('ok');
    go('gacha');
  };
  return [
    gachaBanner(app),
    card('ガチャ', [
      el('div.ik-gbtns', [
        el('button.btn.primary.ik-cost', { onclick: () => pull(1), disabled: coins < 1 }, ['1 回引く', el('small', [ic('wcoin', 14), el('b', { text: '1' })])]),
        el('button.btn.primary.big.ik-cost', { onclick: () => pull(10), disabled: coins < 10 }, ['10 回引く', el('small', [ic('wcoin', 14), el('b', { text: '10' })])]),
      ]),
      el('p.note', { text: `ウイコイン ${coins} 枚（1 回 1 枚）　排出率 ${Object.entries(I.RATES).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join('・')}　通算 ${p.pulls} 回` }),
      coins < 10 ? coinHowto(app, go) : null,
      pityPanel(app, go),
    ]),
    last.length ? card(`引いたカード（${last.length} 枚）`, [pulledGrid(app, last)]) : null,
  ];
}

/**
 * ガチャの天井：1 回引くごとに 1 点、PITY_COST 点で PICK UP のカードを 1 枚選んでもらえる。
 * 点の棒と、届いたら PICK UP の 3 頭の顔（押すと交換の確認）。
 */
function pityPanel(app, go) {
  const p = app.ik;
  const pt = I.pityOf(p);
  const ready = pt >= I.PITY_COST;
  const exchange = async (c) => {
    if (!ready) return toast(`天井まであと ${I.PITY_COST - pt} 回`, { bad: true });
    if (!await ask(`天井の ${I.PITY_COST} 点で${c.name}（${c.rar}）と交換する？`, { ok: '交換する', cancel: 'やめる' })) return;
    let got;
    try { got = I.exchangePity(p, c.id); } catch (e) { return toast(e.message, { bad: true }); }
    save(app);
    if (got.isNew) app.ikNew = true;
    sound.play('bell');
    toast(`${c.name}を手に入れた${got.isNew ? '（NEW）' : got.awaken ? `（覚醒${got.awaken}）` : ''}`);
    go('gacha');
  };
  return el(`div.ik-pity${ready ? '.ready' : ''}`, [
    el('div.ik-pity-h', [
      el('b', { text: '天井' }),
      el('span.bar', [el('i', { style: `width:${Math.min(1, pt / I.PITY_COST) * 100}%` })]),
      el('small', { text: `${Math.min(pt, I.PITY_COST)} / ${I.PITY_COST} 点${pt > I.PITY_COST ? `（+${pt - I.PITY_COST}）` : ''}` }),
    ]),
    el('div.ik-pity-cards', I.PICKUP.map((id) => {
      const c = I.cardById(id);
      const f = el('span.ik-pity-face');
      whenVisible(f, () => stickerInto(f, c, { mode: 'face', zoom: 2.4 }));
      return el('button.ik-pity-c', { onclick: () => exchange(c), disabled: !ready }, [f, el('b', { text: c.name }), el('small', { text: `${c.rar}・所持 ${p.cards[id] ?? 0}` })]);
    })),
    el('p.note', { text: ready ? 'PICK UP から 1 頭を選んで交換できる。' : `1 回引くごとに 1 点。${I.PITY_COST} 点で PICK UP の 1 頭と交換できる（あと ${I.PITY_COST - pt} 回）。` }),
  ]);
}

/**
 * 引いたカードの並び。引いた直後だけ演出する：伏せて配り、順にめくり、いちばん良い 1 枚（SR 以上）は最後に溜めてから
 * 光ってめくれる。stageshow のデモ（.agents/skills/stageshow/examples/gacha-pull）と同じ筋。
 * - 絵（cardArt）は WebGL で 1 枚ずつ撮るので、撮り終わる前にめくると絵の無いカードが表になる。1 枚ずつ自分の絵を待ってからめくる（1.2 秒まで）。
 * - 伏せている間に押すと全部めくる（飛ばす）。めくり終えたカードを押すと今までどおり大きく見る。
 * - めくり終えたら 3D の箱を外す（.done）。カード 1 枚ずつが 3D の合成レイヤーのまま残ると重い（落とし穴 93 の「重くしたもの」）。
 */
function pulledGrid(app, got) {
  // 狭い画面でも 3 列に並べる（2 列だと 10 枚が 5 段になり、めくっている途中のカードが画面の外へ出る）
  const scale = Math.min(fit(0.3), (Math.min(window.innerWidth, 900) - 80) / 3 / 630);
  const face = (g) => cardView(g.card, { scale, eager: true, badge: g.isNew ? 'NEW' : g.awaken ? `覚醒${g.awaken >= I.AWAKEN.max ? 'MAX' : g.awaken}` : null, onClick: (c) => showCard(app, c) });
  const fresh = app.ikReveal;
  app.ikReveal = false;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fresh || reduce) return el('div.ik-grid', got.map(face));
  // いちばん良い 1 枚（同じレア度なら後ろ）。SR 以上のときだけ最後に回して溜める
  const rank = (g) => I.RARITIES.indexOf(g.card.rar);
  let best = 0;
  got.forEach((g, i) => { if (rank(g) <= rank(got[best])) best = i; });
  const hold = got.length > 1 && rank(got[best]) <= I.RARITIES.indexOf('SR') ? best : -1;
  const cells = got.map((g, i) => el(`div.ikr.out.down.r-${g.card.rar}`, { style: `width:${630 * scale}px;height:${880 * scale}px;transition-delay:${i * 50}ms` }, [
    el('div.ikr-in', [face(g), el('div.ikr-back', { style: `border-radius:${26 * scale}px` })]),
  ]));
  let left = cells.length;
  const flip = (i) => {
    const c = cells[i];
    if (!c.classList.contains('down')) return;
    c.classList.remove('down');
    if (--left === 0) setTimeout(() => cells.forEach((x) => x.classList.add('done')), 600);
  };
  let skipped = false;
  const grid = el('div.ik-grid.ikr-grid', cells);
  // 伏せている間の 1 押しは「全部めくる」。カードの onClick（大きく見る）まで届かせない
  grid.addEventListener('click', (e) => {
    if (left === 0) return;
    e.stopPropagation();
    skipped = true;
    cells.forEach((_, i) => flip(i));
  }, true);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // めくるカードへ画面を寄せる（追従）。10 連は狭い画面で 4 段になり、下の段はボタン列の陰か画面の外でめくれていた。
  // 上の帯（72px）と下のボタン列の間に収まっていなければ、真ん中へ滑らかに寄せてからめくる。収まっていれば動かさない（毎回揺らさない）
  const follow = async (c) => {
    const r = c.getBoundingClientRect();
    const dock = document.querySelector('.ikd')?.getBoundingClientRect();
    const bottom = Math.min(window.innerHeight, dock && dock.top > 0 ? dock.top : window.innerHeight);
    if (r.top >= 72 && r.bottom <= bottom) return;
    c.style.scrollMarginTop = '72px';
    c.style.scrollMarginBottom = `${window.innerHeight - bottom}px`;
    c.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    await wait(280);
  };
  (async () => {
    await wait(30);
    cells.forEach((c) => c.classList.remove('out'));
    // 結果の欄の頭（「引いたカード」の題）を画面の上へ。真ん中に合わせると 1 段目が上に切れた
    const sec = grid.closest('.card') ?? grid;
    sec.style.scrollMarginTop = '72px';   // 上の帯（戻る・題・通貨）の下に題が来るように
    sec.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    // 絵は撮った順に届くので、1 枚ずつ自分の絵を待ってからめくる（1 枚 1.2 秒まで。遅い端末で 10 連が 30 秒かからないよう、待ちきれなければ表にして絵は後から付く）
    const arts = got.map((g) => cardArt(g.card).catch(() => null));
    await wait(700 + cells.length * 50);
    for (let i = 0; i < cells.length && !skipped; i++) {
      if (i === hold) continue;
      await Promise.race([arts[i], wait(1200)]);
      if (skipped) break;
      await follow(cells[i]);
      if (skipped) break;
      flip(i);
      sound.play('tick');
      await wait(140);
    }
    if (skipped || hold < 0) return;
    await Promise.race([arts[hold], wait(1200)]);
    await follow(cells[hold]);
    await wait(320);
    cells[hold].classList.add('glow');
    await wait(rank(got[hold]) <= 1 ? 850 : 450);
    if (skipped) return;
    flip(hold);
    sound.play(rank(got[hold]) <= 1 ? 'bell' : 'win');
  })();
  return grid;
}

/**
 * ガチャのバナー。ガチャは一つなので、新しく入ったカード（PICK UP：第 4 弾【女傑たちの凱歌】の LM 3 頭）の一枚絵を背景に、切り抜きを並べ、
 * 収録の LM の顔・収録数と所持数・排出率を載せる。絵はカードの一枚絵を使い回す（cardArt。WebGL を増やさない：落とし穴 23）。
 */
function gachaBanner(app) {
  const inPool = (c) => c.pack in I.PACKS;
  const picks = I.PICKUP.map((id) => I.cardById(id)).filter(Boolean);
  // 顔の列は新しい弾の LM だけ（全弾の LM 30 種を並べると 2 段にあふれて馬の絵に重なった）
  const newPack = picks[0]?.pack ?? 'P4';
  const lms = I.CARDS.filter((c) => c.pack === newPack && c.rar === 'LM');
  const total = I.CARDS.filter(inPool).length;
  const have = I.CARDS.filter((c) => inPool(c) && app.ik.cards[c.id]).length;
  const bg = el('span.ikev-bg');
  bgInto(bg, picks[0]);
  const heroes = picks.map((c, i) => {
    const im = el(`img.ikev-hero.ikgb-h${i}`, { alt: c.name, draggable: false });
    stickerInto(im, c, { mode: 'img' });
    return im;
  });
  const faces = lms.map((c) => {
    const f = el('span.ikgb-face', { title: c.name });
    whenVisible(f, () => stickerInto(f, c, { mode: 'face', zoom: 2.4 }));
    return f;
  });
  return el('div.ikev-banner.ikgb.trio', [
    bg, el('span.ikev-shade'), ...heroes,
    el('div.ikev-tx', [
      el('span.ikev-tag.gacha', { text: 'GACHA' }),
      el('small.ikev-en', { text: 'WINNING ROAD' }),
      el('b.ikev-ttl', { text: '名馬ガチャ' }),
      el('span.ikev-sub', { text: `NEW 第4弾【${I.PACKS.P4}】牡馬を破った名牝 40 頭` }),
      el('span.ikev-rw', [el('i', { text: 'PICK UP' }), el('span', { text: picks.map((c) => c.name).join('・') })]),
      el('span.ikgb-faces', [el('small', { text: `第${newPack.slice(1)}弾 LM ${lms.length} 種` }), ...faces]),
      el('span.ikgb-foot', { text: `全 ${total} 種・所持 ${have} 種　LM ${Math.round(I.RATES.LM * 100)}%・SSR ${Math.round(I.RATES.SSR * 100)}%` }),
    ]),
  ]);
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
    c.record ? el('p.ik-record', { text: `戦績　${c.record}` }) : null,
    I.GEAR_KEYS.some((k) => c.gear?.[k]) ? el('p.ik-record', ['実際の馬具　', el('span.gearline', gearChips(c.gear))]) : null,
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
  const mine = p.finished.filter((h) => h.art);
  return [
    shardPanel(app, go),
    mine.length ? card(`マイカード（${mine.length} 枚）`, [
      el('div.ik-mycards', mine.map((h) => cardView(I.finishedCard(h), { scale: 0.26, onClick: () => showMyCard(app, h) }))),
      el('p.note', { text: '完成馬の詳細の「カードにする」で作る。構図・ポーズ・馬具・勝負服を自分で決められる。' }),
    ]) : null,
    card(`所持カード（${all.length} 種・${total} 枚）`, [
      tabs([{ id: 'ALL', name: '全弾' }, ...Object.keys(I.PACK_NAMES).map((id) => ({ id, name: packTab(id) }))], f.pack, (v) => set('pack', v)),
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
        ...Object.entries(I.PACK_NAMES).map(([id, name]) => meter(id in I.PACKS ? `第${id.slice(1)}弾【${name}】` : name, I.CARDS.filter((c) => c.pack === id))),
        ...I.RARITIES.map((r) => meter(r, I.CARDS.filter((c) => c.rar === r))),
      ]),
    ]),
    card('一覧', [
      tabs([{ id: 'ALL', name: '全弾' }, ...Object.keys(I.PACK_NAMES).map((id) => ({ id, name: packTab(id) }))], f.pack, (v) => set('pack', v)),
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

/** カードの「編成」から開く編成。育成の途中は組み直せないので、そのことと育成への道を出す。 */
function deckOnlyView(app, go) {
  if (app.ik.run) return [card('編成', [el('p', { text: '育成の途中は編成を組み直せない（いまの育成を終えるか、やめると組める）。' }), button('育成へ', () => go('run'), { cls: 'primary' })])];
  return deckView(app, go);
}

/**
 * 編成：父（牡のカード）× 母（牝のカード）で育成馬を作り（名前は自分で決め、脚質は両親のあいだから選ぶ）、サポート 4 枚と組む。
 * カードを押すと、空いている枠へ入る（牡は父、牝は母、埋まっていればサポート）。もう一度押すと外れる。
 */
function deckView(app, go) {
  const p = app.ik;
  const have = I.owned(p);
  app.ikDeck ??= { sire: null, dam: null, supports: [], name: '', style: null, memories: [] };
  const d = app.ikDeck;
  d.memories = (d.memories ?? []).filter((id) => I.memoriesOf(p).some((m) => m.id === id));
  if (d.sire && !p.cards[d.sire]) d.sire = null;
  if (d.dam && !p.cards[d.dam]) d.dam = null;
  d.supports = d.supports.filter((id) => p.cards[id] && id !== d.sire && id !== d.dam);
  const males = have.filter((c) => c.sex === '牡'), females = have.filter((c) => c.sex === '牝');
  if (have.length < 2 + I.SUPPORT_SLOTS || !males.length || !females.length) {
    return [card('編成', [
      el('p', { text: `育成には父（牡のカード）・母（牝のカード）と、サポート ${I.SUPPORT_SLOTS} 枚の、あわせて ${2 + I.SUPPORT_SLOTS} 種のカードが要る（いま ${have.length} 種・牡 ${males.length}・牝 ${females.length}）。` }),
      button('ガチャへ', () => go('gacha'), { cls: 'primary' }),
    ])];
  }
  // カードの「編成」から開いたときは、選び直しても編成の画面に留まる（育成の画面へ飛ばない）
  const self = app.params.view === 'deck' ? 'deck' : 'run';
  // 選び直しは画面ごと描き直すので、スクロールの位置を覚えて戻す（戻さないと押すたびに頭へ飛んだ）
  const redraw = () => {
    const y = document.querySelector('.ikm')?.scrollTop ?? 0;
    go(self);
    const sc = document.querySelector('.ikm');
    if (sc) sc.scrollTop = y;
  };
  const parentsChanged = () => { d.name = ''; d.style = null; };
  const pick = (c) => {
    if (d.sire === c.id) { d.sire = null; parentsChanged(); } else if (d.dam === c.id) { d.dam = null; parentsChanged(); } else if (d.supports.includes(c.id)) d.supports = d.supports.filter((x) => x !== c.id);
    else if (c.sex === '牡' && !d.sire) { d.sire = c.id; parentsChanged(); } else if (c.sex === '牝' && !d.dam) { d.dam = c.id; parentsChanged(); } else if (d.supports.length < I.SUPPORT_SLOTS) d.supports.push(c.id);
    else return toast(`サポートは ${I.SUPPORT_SLOTS} 枚まで（外すにはもう一度押す）`, { bad: true });
    go(self);
  };
  // 因子メモリー枠：押すと外れる。下の一覧のメモリーを押すと空いた枠へ入る
  const memById = (id) => I.memoriesOf(p).find((m) => m.id === id);
  const memSlot = (id, i) => el('div.ik-slot.ik-memslot', [
    el('small', { text: `因子メモリー ${i + 1}` }),
    id && memById(id) ? memoryIcon(memById(id), () => { d.memories = d.memories.filter((x) => x !== id); redraw(); }) : el('div.ik-empty', { text: '空き' }),
  ]);
  const mems = I.memoriesOf(p);
  // 持っているメモリーの欄は開け閉めを高さのイージングで（落とし穴 103 の「詳しく」と同じ：grid の行を 0fr ↔ 1fr）。
  // details の開閉は一瞬で伸び縮みした。開いているかは app.ikMemOpen に覚え、描き直しの後は開いた形で組む（動きは押したときだけ）
  const memPanel = mems.length ? (() => {
    const wrap = el(`div.ik-memsel${app.ikMemOpen ? '.open' : ''}`);
    const head = el('button.ik-memsel-h', {
      onclick: () => { app.ikMemOpen = wrap.classList.toggle('open'); head.setAttribute('aria-expanded', String(app.ikMemOpen)); },
      'aria-expanded': String(!!app.ikMemOpen),
    }, [el('i.ik-memsel-ar'), el('b', { text: `因子メモリーを選ぶ（${d.memories.length}/${I.MEMORY_SLOTS}）` }),
      d.memories.length ? el('span', { text: `　${d.memories.map((id) => memById(id)).filter(Boolean).map(memLine).join('　')}` }) : el('span', { text: `　持っている ${mems.length} 個から` })]);
    wrap.append(head, el('div.ik-skwrap', [el('div.ik-skclip', [el('div.ik-icons.ik-memsel-list', [...mems].reverse().map((m) => memoryIcon(m, () => {
      if (d.memories.includes(m.id)) d.memories = d.memories.filter((x) => x !== m.id);
      else if (d.memories.length < I.MEMORY_SLOTS) d.memories.push(m.id);
      else return toast(`因子メモリーは ${I.MEMORY_SLOTS} つまで（外すにはもう一度押す）`, { bad: true });
      redraw();
    }, { sel: d.memories.includes(m.id), eager: true })))])]));
    return wrap;
  })() : el('p.note', { text: '因子メモリーはまだ無い（育成を終えたときに「因子メモリーにする」を選ぶと手に入る）。' });
  const slot = (id, label) => el('div.ik-slot', [
    el('small', { text: label }),
    id ? cardView(I.cardById(id), { scale: 0.22, onClick: () => pick(I.cardById(id)) }) : el('div.ik-empty', { text: '空き' }),
  ]);
  const sire = d.sire ? I.cardById(d.sire) : null, dam = d.dam ? I.cardById(d.dam) : null;
  const pv = sire && dam ? I.breedPreview(p, sire.id, dam.id, d.style) : null;
  if (pv) { d.style = pv.style; if (!d.name) d.name = I.foalNameIdea(sire, dam); }
  const ready = pv && d.supports.length === I.SUPPORT_SLOTS && d.name.trim();
  const start = button('育成を始める', () => {
    try { I.startRun(p, { sire: d.sire, dam: d.dam, name: d.name, style: d.style }, d.supports, d.memories); } catch (e) { return toast(e.message, { bad: true }); }
    app.ikDeck = null;
    save(app);
    sound.play('ok');
    go('run');
  }, { cls: 'primary big', disabled: !ready });
  return [
    card(`編成（父 × 母の配合で育成馬を作る＋サポート ${I.SUPPORT_SLOTS} 枚）`, [
      el('div.ik-deck', [slot(d.sire, '父（牡）'), el('b.ik-cross', { text: '×' }), slot(d.dam, '母（牝）'), ...[0, 1, 2, 3].map((i) => slot(d.supports[i], `サポート ${i + 1}`)),
        ...Array.from({ length: I.MEMORY_SLOTS }, (_, i) => memSlot(d.memories[i], i))]),
      memPanel,
      pv ? breedPanel(p, pv, sire, dam, d, () => { start.disabled = !(d.supports.length === I.SUPPORT_SLOTS && d.name.trim()); }, () => go(self))
        : el('p.note', { text: '牡のカードを押すと父、牝のカードを押すと母に入る。両親が決まると、生まれる仔の名前と脚質を決められる。続けてサポートを 4 枚選ぶ。選んだカードをもう一度押すと外れる。' }),
      d.supports.length ? el('div.ik-deckskills', d.supports.map((id) => el('div', [el('small', { text: `${I.cardById(id).name}（サポート${awkLabel(p, id)}）` }), skillTags(I.skillsOf(I.cardById(id), I.awakenOfCard(p, id)).support, null, { small: true })]))) : null,
      el('p.note', { text: 'サポートと友情練習を 2 回すると（覚醒 3 なら 1 回）、そのサポートのレーススキルを覚える（完成馬に残る）。同じカードを重ねて持つと覚醒して強くなる（育成馬の覚醒は両親の平均）。' }),
      comboPanel([d.sire, d.dam, ...d.supports].filter(Boolean)),
      (() => { const g = I.missionGain(p, { sire: d.sire, dam: d.dam, supports: d.supports }).length; return g ? el('p.ik-msgain', [ic('wcoin', 16), `初めて編成するカード ${g} 枚：育成を終えるとウイコイン +${g}`]) : null; })(),
      el('div.ik-gbtns', [
        start,
        button('おまかせ', () => {
          // 覚醒したカードを優先する（1 段でカードパワー 8 ぶん）
          const sc = (c) => I.cardPower(c) + 8 * I.awakenOfCard(p, c.id);
          const s = [...have].sort((a, b) => sc(b) - sc(a));
          if (!d.sire) { d.sire = s.find((c) => c.sex === '牡').id; parentsChanged(); }
          if (!d.dam) { d.dam = s.find((c) => c.sex === '牝').id; parentsChanged(); }
          d.supports = s.filter((c) => c.id !== d.sire && c.id !== d.dam).slice(0, I.SUPPORT_SLOTS).map((c) => c.id);
          go(self);
        }, { cls: 'ghost' }),
      ]),
    ]),
    (() => {
      // 片親だけ決まっているあいだは相方の性のカードだけを出す（父を決めたら牝、母を決めたら牡）
      const want = d.sire && !d.dam ? '牝' : d.dam && !d.sire ? '牡' : null;
      const grid = el('div.ik-grid');
      const draw = () => {
        const xs = deckFilter(app, have, want);
        grid.replaceChildren(...(xs.length ? xs.map((c) => cardView(c, {
          scale: fit(0.24), count: p.cards[c.id], onClick: pick,
          badge: c.id === d.sire ? '父' : c.id === d.dam ? '母' : d.supports.includes(c.id) ? `サポ${d.supports.indexOf(c.id) + 1}` : null,
        })) : [el('p.note', { text: 'この条件のカードは持っていない。' })]));
        count.textContent = `${xs.length} / ${have.filter((c) => !want || c.sex === want).length} 種`;
      };
      const count = el('span.ik-fcount');
      const head = want ? `持っているカード（${want === '牝' ? '母にする牝' : '父にする牡'}のカードだけ）` : '持っているカード';
      const body = [filterBar(app, have, () => draw(), count), grid];
      draw();
      return card(head, body);
    })(),
  ];
}

/**
 * 組み合わせ（同じ弾・父系・年代が 3 枚以上で練習の伸び +2〜5%）。そろっている組と、あと 1 枚でそろう組を見せる。
 */
function comboPanel(ids) {
  const on = I.comboOf(ids);
  const tot = Math.round(on.reduce((a, x) => a + x.bonus, 0) * 100);
  return el('div.ik-combo', [
    el('b.ik-combo-h', { text: on.length ? `組み合わせ　練習 +${tot}%` : '組み合わせ' }),
    on.length ? el('div.ik-combo-l', on.map((x) => el(`span.ik-combo-c.k-${x.kind}`, [el('small', { text: I.COMBO_KINDS[x.kind] }), el('b', { text: `${x.label} ×${x.n}` }), el('em', { text: `+${Math.round(x.bonus * 100)}%` })])))
      : el('small', { text: '編成（父・母・サポート）に同じ弾・同じ父系・同じ年代のカードが 3 枚以上そろうと、練習の伸びが +2%〜+5%（3 種で最大 +15%）。' }),
  ]);
}

/**
 * レースの脚質を選ぶ札（逃げ・先行・差し・追込）。base は育てた脚質（印を付ける）。押すと描き直さずに札だけ切り替える。
 * 合わない脚質のスキル（逃げ切り・末脚炸裂）はそのレースでは使わない。
 */
function styleSeg(cur, base, onPick) {
  const SKILL = { 逃げ: '逃げ切り', 差し: '末脚炸裂', 追込: '末脚炸裂' };
  const btns = I.STYLE_NAMES.map((x) => el(`button.ik-stseg-b${x === cur ? '.on' : ''}`, {
    onclick: () => { for (const b of btns) b.classList.toggle('on', b === btns[I.STYLE_NAMES.indexOf(x)]); onPick(x); },
  }, [el('b', { text: x }), x === base ? el('small', { text: '育成' }) : null]));
  return el('div.ik-stseg', [el('span.ik-stseg-l', { text: '脚質' }), el('div.ik-stseg-bs', btns),
    el('small.ik-stseg-n', { text: `合わない脚質のスキル（${[...new Set(Object.values(SKILL))].join('・')}）は使わない` })]);
}

// 編成の絞り込み（レア度・馬場・距離・脚質・スキル）。条件は app.ikDeckOpt に覚え、一覧だけを描き直す
// （画面ごと描き直すとスクロールが先頭へ戻る。落とし穴 77 と同じ）。
const DECK_OPT0 = { rar: 'ALL', surf: 'ALL', dist: 'ALL', style: 'ALL', skill: 'ALL' };
const surfOf = (c) => (c.turf >= c.dirt ? '芝' : 'ダート');
const cardSkillIds = (p, c) => {
  const sk = I.skillsOf(c, I.awakenOfCard(p, c.id));
  return [...sk.race, ...sk.support, ...(sk.unique ? ['uniq'] : [])];
};
function deckFilter(app, have, want) {
  const f = app.ikDeckOpt ??= { ...DECK_OPT0 };
  const p = app.ik;
  return have.filter((c) => (!want || c.sex === want)
    && (f.rar === 'ALL' || c.rar === f.rar) && (f.surf === 'ALL' || surfOf(c) === f.surf)
    && (f.dist === 'ALL' || I.distCat(c.dist) === f.dist) && (f.style === 'ALL' || I.STYLE_NAMES[Math.min(3, Math.floor(c.style / 0.25))] === f.style)
    && (f.skill === 'ALL' || cardSkillIds(p, c).includes(f.skill)));
}
function filterBar(app, have, redraw, count) {
  const f = app.ikDeckOpt ??= { ...DECK_OPT0 };
  const p = app.ik;
  // スキルは持っているカードに付いているものだけを、レース・サポートに分けて並べる
  const ids = new Set(have.flatMap((c) => cardSkillIds(p, c)));
  const infos = [...ids].filter((id) => id !== 'uniq').map((id) => I.skillInfo(id)).filter(Boolean);
  const sel = (key, label, opts) => el('label.ik-fsel', [el('small', { text: label }), el('select.inp', {
    onchange: (e) => { f[key] = e.target.value; redraw(); reset.hidden = Object.keys(DECK_OPT0).every((k) => f[k] === 'ALL'); },
  }, [['ALL', 'すべて'], ...opts].map(([v, t]) => (Array.isArray(t) ? el('optgroup', { label: v }, t.map(([v2, t2]) => el('option', { value: v2, text: t2, selected: f[key] === v2 })))
    : el('option', { value: v, text: t, selected: f[key] === v }))))]);
  const reset = button('条件を外す', () => { Object.assign(f, DECK_OPT0); bar.replaceWith(filterBar(app, have, redraw, count)); redraw(); }, { cls: 'ghost small' });
  reset.hidden = Object.keys(DECK_OPT0).every((k) => f[k] === 'ALL');
  const bar = el('div.ik-filter', [
    sel('rar', 'レア度', I.RARITIES.map((r) => [r, r])),
    sel('surf', '馬場', [['芝', '芝'], ['ダート', 'ダート']]),
    sel('dist', '距離', ['短距離', 'マイル', '中距離', '長距離'].map((x) => [x, x])),
    sel('style', '脚質', I.STYLE_NAMES.map((x) => [x, x])),
    sel('skill', 'スキル', [
      ['uniq', '固有スキル（LM）'],
      ['レーススキル', infos.filter((x) => x.type === 'race').map((x) => [x.id, x.name])],
      ['サポートスキル', infos.filter((x) => x.type === 'support').map((x) => [x.id, x.name])],
    ]),
    reset, count,
  ]);
  return bar;
}

/** 生まれる仔：名前（自分で決める）・脚質（両親のあいだから選ぶ）・伸びしろ・適性・受け継ぐスキル。 */
function breedPanel(p, pv, sire, dam, d, onName, redraw) {
  const c = pv.card;
  const name = el('input.inp.ik-name', {
    type: 'text', value: d.name, maxLength: I.NAME_MAX, placeholder: '馬名', spellcheck: false,
    // 1 文字ごとに画面を描き直すと入力欄の焦点が外れる（落とし穴 77 と同じ）。値だけ覚える
    oninput: (e) => { d.name = e.target.value; onName(); },
  });
  const styleOfCard = (x) => I.STYLE_NAMES[x < 0.25 ? 0 : x < 0.5 ? 1 : x < 0.75 ? 2 : 3];
  return el('div.ik-breed', [
    el('div.ik-breed-h', [el('b', { text: '生まれる仔' }), el('small', { text: `${sire.name} × ${dam.name}　${c.rar}${pv.awaken ? `・覚醒${pv.awaken}` : ''}` })]),
    el('label.ik-breed-row', [el('small', { text: '名前' }), name,
      button('案', () => { d.name = I.foalNameIdea(sire, dam); name.value = d.name; onName(); }, { cls: 'sm ghost' })]),
    el('div.ik-breed-row', [el('small', { text: '脚質' }),
      el('div.ik-styles', I.STYLE_NAMES.map((s) => el(`button.ik-style${s === pv.style ? '.on' : ''}`, {
        disabled: !pv.styles.includes(s), title: pv.styles.includes(s) ? '' : '両親の脚質のあいだにない',
        onclick: () => { d.style = s; redraw(); },
      }, s))),
      el('small.ik-breed-par', { text: `父 ${styleOfCard(sire.style)} × 母 ${styleOfCard(dam.style)}` })]),
    el('div.ik-breed-row', [el('small', { text: '伸びしろ' }), el('span.ik-plus', I.STATS.map((k) => el(`span.p${c.plus[k]}`, { text: `${I.STAT_SHORT[k]}+${c.plus[k]}` })))]),
    el('div.ik-breed-row', [el('small', { text: '初期値' }), el('span.ik-plus', I.STATS.map((k) => el('span', { text: `${I.STAT_SHORT[k]} ${pv.init[k]}` })))]),
    el('div.ik-breed-row', [el('small', { text: '適性' }), el('span', { text: `${c.turf >= c.dirt ? '芝' : 'ダート'}・${I.distCat(c.dist)}（${Math.max(1000, c.dist - c.range)}〜${Math.min(3600, c.dist + c.range)}m）` })]),
    el('div.ik-breed-row', [el('small', { text: '受け継ぐ' }), skillTags(c.raceSkills, I.uniqueOf(c))]),
    el('p.note', { text: '伸びしろは能力ごとに両親の高いほう、初期値は両親の平均。性と毛色は生まれてのお楽しみ。逃げ切り・末脚炸裂は選んだ脚質に合うときだけ受け継ぐ。' }),
  ]);
}

/** 覚醒の段（見出しに添える）。 */
const awkLabel = (p, id) => { const a = I.awakenOfCard(p, id); return a ? `・覚醒${a >= I.AWAKEN.max ? 'MAX' : a}` : ''; };

function traineeNote(c) {
  const plus = I.plusOf(c);
  return el('p.note', { text: `${c.name}：${I.distCat(c.dist)}・${c.turf >= c.dirt ? '芝' : 'ダート'}　伸びしろ ${I.STATS.map((k) => `${I.STAT_SHORT[k]}+${plus[k]}`).join(' ')}` });
}

/** 育成の 1 ターン。 */
/** 付けている馬具の札（メンコとシャドーロールは色の点つき）。無ければ「なし」。 */
function gearChips(gear) {
  const ks = I.GEAR_KEYS.filter((k) => gear?.[k]);
  if (!ks.length) return [el('i.gearchip.none', { text: 'なし' })];
  return ks.map((k) => el('i.gearchip', { title: I.GEAR[k].desc }, [
    typeof gear[k] === 'string' ? el('span.gdot', { style: `background:${gear[k]}` }) : null, I.GEAR[k].name,
  ]));
}

/**
 * 馬具を決める（育成中の馬・完成馬）。育成モードの馬は気性を持たないので、効き目は気性 0.35 の馬として小さく効く
 * （sim/gear.js・ikusei.js の GEAR_TEMPER）。onSave(gear) が保存する。
 */
function gearPicker(name, gear, onSave, note = '') {
  const cur = { ...(gear ?? {}) };
  let m = null;
  const body = el('div.gearm');
  const draw = () => {
    body.replaceChildren(
      el('p.note', { text: note || '効き目は小さい（出遅れ・掛かり・追ってからの集中）。付けた馬具はレースの 3D にも出る。' }),
      ...I.GEAR_KEYS.map((k) => {
        const on = !!cur[k];
        const colored = k === 'menko' || k === 'shadowRoll';
        return el(`div.gear-row${on ? '.on' : ''}`, [
          el('button.gear-tog', {
            onclick: () => {
              if (on) delete cur[k];
              else {
                cur[k] = colored ? I.GEAR_COLORS[0] : true;
                if (k === 'blinker') delete cur.cheek;
                if (k === 'cheek') delete cur.blinker;
              }
              draw();
            },
          }, [el('b', { text: I.GEAR[k].name }), el('small', { text: I.GEAR[k].desc })]),
          colored && on ? el('div.gear-colors', I.GEAR_COLORS.map((c) => el(`button.gear-c${cur[k] === c ? '.on' : ''}`, {
            style: `background:${c}`, title: c, onclick: () => { cur[k] = c; draw(); },
          }))) : null,
        ]);
      }),
      el('div.gear-acts', [
        button('決める', () => {
          const g = onSave(cur);
          toast(`${name}の馬具：${I.gearNames(g).join('・') || 'なし'}`);
          m?.close();
        }, { cls: 'primary' }),
        button('やめる', () => m?.close()),
      ]),
    );
  };
  draw();
  m = modal(`${name}の馬具`, [body]);
}

/**
 * 育成の画面。練習（またはレース）を 1 画面に収める（「スクロールしないと練習できない」）。
 * 上から：進み → 馬（小さな切り抜きと体力・気分・戦績・馬具）と能力（5 つを 1 段）→ スキル（1 行。「詳しく」で開く）→ 練習 →
 * これまでのレース（畳んである）。カードの絵は切り抜きを押すと大きく見られる。
 */
/**
 * 目標レースとライバルの帯（育成の画面の頭、1 段）。練習の札を下へ押し出さないよう高さを抑える（落とし穴 103）。
 * 目標：レース名・時期・今の状態。ライバル：顔・名前・対戦成績・次の対決の時期。押すと詳しい説明。
 */
function goalStrip(app, run) {
  if (!run.goal && !run.rival) return null;
  const g = run.goal, st = I.goalState(run);
  const stTxt = { done: '達成！', missed: '届かず', out: '出られず', now: I.goalEligible(run) ? '今回！' : '1 勝が要る', open: I.goalEligible(run) ? '出走できる' : 'まず 1 勝' }[st];
  const goalBox = g ? el(`div.ik-goal.${st}`, [
    el('span.ik-goal-ic', ic('trophy', 18)),
    el('div', [el('small', { text: `目標レース　${I.SLOTS[g.slot].label}` }), el('b', { text: g.name })]),
    el('i.ik-goal-st', { text: stTxt }),
  ]) : null;
  let rvBox = null;
  if (run.rival) {
    const rc = I.cardById(run.rival.cardId);
    const rec = I.rivalRecord(run);
    const next = run.rival.meets.find((x) => x >= run.slot);
    const face = el('span.ik-rv-face');
    stickerInto(face, rc, { mode: 'face', zoom: 2.4 });
    rvBox = el('div.ik-rvbox', [
      face,
      el('div', [el('small', { text: 'ライバル' }), el('b', { text: rc.name })]),
      el('span.ik-rv-rec', [el('b', { text: `${rec.won}勝${rec.lost}敗` }),
        el('small', { text: next == null ? '対決は終わった' : next === run.slot && I.isRaceTurn(run) ? '今回対決！' : `次は ${I.SLOTS[next].label}` })]),
    ]);
  }
  const strip = el('button.ik-goalstrip', { onclick: () => showGoalRival(app, run) }, [goalBox, rvBox]);
  return strip;
}

function showGoalRival(app, run) {
  const g = run.goal;
  const rc = run.rival ? I.cardById(run.rival.cardId) : null;
  const rec = I.rivalRecord(run);
  modal('目標とライバル', [
    g ? card(`目標レース：${g.name}（${I.SLOTS[g.slot].label}）`, [
      el('p', { text: `${g.surface}${g.distance}m。1 勝していれば優先して出られる（ほかの GI は 2 勝か重賞勝ち）。勝てば評価点 +${I.GOAL_BONUS}・ウイコイン +${I.GOAL_COINS}。` }),
    ]) : null,
    rc ? card(`ライバル：${rc.name}`, [
      el('div.ik-rv-detail', [cardView(rc, { scale: 0.22, tilt: false }), el('div', [
        el('p', { text: `${I.SLOTS.filter((_, i) => run.rival.meets.includes(i)).map((x) => x.label).join('・')} の ${run.rival.meets.length} 戦で、どのレースを選んでも出てくる。そのレースの相手より一段強く、時期を追って強くなる。` }),
        rec.log.length ? table(['時期', 'レース', '自分', 'ライバル'], rec.log.map((x) => [I.SLOTS[x.slot].label, x.race, `${x.me}着`, `${x.rv}着`]), { cls: 'ik-tbl' }) : el('p.note', { text: 'まだ対決していない。' }),
      ])]),
    ]) : null,
  ], { wide: true });
}

function trainView(app, go) {
  const p = app.ik;
  const run = p.run;
  const c = I.traineeCard(run);
  const plus = I.plusOf(c);
  const cap = (k) => I.runCap(run, k, plus[k]);
  const done = I.runDone(run);

  // 馬：切り抜き（押すとカード）と状態
  const thumb = el('img.ik-who-img', { alt: c.name, draggable: false });
  stickerInto(thumb, c);
  const who = el('div.ik-who', [
    el('button.ik-who-art', { title: c.bred ? c.name : 'カードを見る', onclick: () => (c.bred ? null : showCard(app, c)) }, thumb),
    el('div.ik-who-meta', [
      el('div.ik-who-n', [el(`span.rb.r-${c.rar}`, { text: c.rar }), el('b', { text: c.name }),
        el('small', { text: `${c.sex}・${c.coat}・${I.STYLE_NAMES[c.style < 0.25 ? 0 : c.style < 0.5 ? 1 : c.style < 0.75 ? 2 : 3]}` })]),
      el('div.ik-who-st', [
        el('small', { text: '体力' }), el('span.bar.en', [el('i', { style: `width:${run.energy}%` })]), el('b', { text: String(run.energy) }),
        el(`b.mood.m${run.mood}`, { text: I.MOODS[run.mood] }),
        run.awaken?.t ? el('b.ik-awk', { text: `${'◆'.repeat(run.awaken.t)}` }) : null,
      ]),
      el('div.ik-who-rec', { text: `${run.starts}戦${run.wins}勝（重賞 ${run.gradedWins}・GI ${run.giWins}）　ファン ${run.fans.toLocaleString()}人` }),
      el('div.ik-gear', [el('small', { text: '馬具' }), el('span.gearline', gearChips(I.runGear(run))),
        done ? null : el('button.gchange', { text: '変更', onclick: () => gearPicker(c.name, I.runGear(run), (g) => { const r = I.setRunGear(run, g); save(app); go('run'); return r; }) })]),
    ]),
  ]);
  // 能力：5 つを 1 段（評価・点・伸びしろの上限の線）
  const stats = el('div.ik-st5', { title: `黄色の線は伸びしろの上限（${c.bred ? '両親の +値の高いほう' : 'カードの +値'}）` }, I.STATS.map((k) => {
    const g = I.gradeOfPts(run.stats[k]);
    return el('div.ik-st', [
      el('small', { text: I.STAT_SHORT[k] }),
      el(`b.g.g-${g.replace('+', 'p')}`, { text: g }),
      el('span.n', { text: String(run.stats[k]) }),
      el('span.bar', [el('i', { style: `width:${(run.stats[k] / I.PTS_MAX) * 100}%` }), el('em', { style: `left:${(cap(k) / I.PTS_MAX) * 100}%`, title: `上限 ${cap(k)}` })]),
    ]);
  }));

  // スキル：1 行（レースで使うスキルと、サポートとの絆の進み）。「詳しく」で説明つきに開く（開いたかは覚えておく）
  const bonds = run.supports.map((id, i) => {
    const sc = I.cardById(id);
    const b = (run.bonds ?? [])[i] ?? 0;
    const need = I.bondNeed(run, i);
    return { sc, b, need, done: b >= need, st: I.storyStep(run, i) };
  });
  const open = !!app.ikSkillOpen;
  const skillBar = el('div.ik-skbar', [
    el('small.ik-skl', { text: 'スキル' }),
    el('div.ik-skline', [
      skillTags(I.runSkills(run), I.uniqueOf(c), { small: true }),
      el('span.ik-bonds.sm', bonds.map((x) => el(`span.ik-bond.sm${x.done ? '.done' : ''}`, { title: `${x.sc.name}：友情練習 ${x.b}/${x.need}` }, [
        el(`b.${RCLS(x.sc.rar)}`, { text: x.sc.name.length > 5 ? `${x.sc.name.slice(0, 4)}…` : x.sc.name }), el('i', { text: x.done ? '習得' : `${x.b}/${x.need}` }),
      ]))),
    ]),
    el('button.ik-skx', { text: open ? '閉じる' : '詳しく', onclick: (e) => {
      // 画面を描き直さずに開け閉めする（描き直すと一瞬で伸び縮みした）。高さは grid の 0fr → 1fr で滑らかに
      app.ikSkillOpen = !app.ikSkillOpen;
      skillGroup.classList.toggle('open', app.ikSkillOpen);
      e.currentTarget.textContent = app.ikSkillOpen ? '閉じる' : '詳しく';
    } }),
  ]);
  const skillMore = el('div.ik-skwrap', el('div.ik-skclip', el('div.ik-skmore', [
    ...[...(I.uniqueOf(c) ? [{ ...I.uniqueOf(c), type: 'uniq' }] : []), ...I.runSkills(run).map((id) => I.skillInfo(id)).filter(Boolean)]
      .map((x) => el('div', [el(`span.ik-sk.sm.${x.type}`, { text: x.name }), el('small', { text: x.desc })])),
    el('div', [el('small', { text: 'サポートと友情練習を重ねると、そのサポートのレーススキルを覚える（完成馬に残る）。絆が 1・2・3 に届くと、そのサポートの話が 1 話ずつ出て、最終話でスキルをすべて覚える。' })]),
    el('div.ik-bonds', bonds.map((x) => el(`span.ik-bond${x.done ? '.done' : ''}`, [el(`b.${RCLS(x.sc.rar)}`, { text: x.sc.name }), el('i', { text: x.done ? '習得' : `${x.b}/${x.need}` }), el('i.st', { text: x.st >= I.STORY_EPISODES ? '話 完結' : `話 ${x.st}/${I.STORY_EPISODES}` })]))),
    run.combo?.length ? el('div', [el('small', { text: `組み合わせ：${run.combo.map((x) => `${I.COMBO_KINDS[x.kind]}${x.label}×${x.n}`).join('・')}（練習 +${Math.round((I.comboMul(run) - 1) * 100)}%）` })]) : null,
  ])));
  const skillGroup = el(`div.ik-skgroup${open ? '.open' : ''}`, [skillBar, skillMore]);

  const progress = el('div.ik-prog', [
    el('b', { text: done ? '育成完了' : I.turnLabel(run) }),
    el('span.bar', [el('i', { style: `width:${(run.turn / I.TOTAL_TURNS) * 100}%` })]),
    el('small', { text: `${run.turn} / ${I.TOTAL_TURNS} ターン` }),
  ]);
  let action;
  if (done) {
    action = card('育成完了', [
      el('p', { text: `${c.name}の 2 年が終わった。${run.starts}戦${run.wins}勝（GI ${run.giWins}勝）。` }),
      run.goal ? el(`p.ik-goalsum.${I.goalState(run)}`, [ic('trophy', 16), run.goal.done ? `目標の${run.goal.name}を達成：評価点 +${I.GOAL_BONUS}・ウイコイン +${I.GOAL_COINS}` : `目標の${run.goal.name}は届かなかった`]) : null,
      run.rival ? el('p.ik-goalsum', [ic('sword', 16), `ライバル${I.cardById(run.rival.cardId).name}と ${I.rivalRecord(run).won}勝${I.rivalRecord(run).lost}敗`]) : null,
      I.missionGain(p).length ? el('p.ik-msgain', [ic('wcoin', 16), `ミッション：初めて編成したカード ${I.missionGain(p).length} 枚 → ウイコイン +${I.missionGain(p).length}`]) : null,
      el('p.note', { text: `完成馬として登録するか、因子メモリーにするかを選ぶ。因子メモリーは能力から 1 つ（☆1〜☆5 のランダム）とレーススキルから 1 つを抜き出し、編成の因子メモリー枠（${I.MEMORY_SLOTS} つ）に入れると次の育成馬のその能力が ☆×${I.MEM_STEP} 伸び、上限も同じだけ突破する（1200 を超えてよい。能力ごとに ${I.MEM_BREAK} まで）。スキルは最初から覚えている（何度でも使える）。因子メモリーにした馬は完成馬にならない。` }),
      el('div.ik-gbtns', [
        button('完成馬として登録する', () => {
          const gain = I.missionGain(p).length;
          const h = I.finishRun(p);
          save(app);
          sound.play('bell');
          modal('完成！', [finishedCard(h),
            gain ? el('p.ik-msgain', [ic('wcoin', 16), `ミッション達成：ウイコイン +${gain}（いま ${I.coinsOf(p)} 枚）`]) : null,
            el('p.note', { text: '完成馬は「対戦」で戦わせられる。' })]);
          go('stable');
        }, { cls: 'primary big' }),
        button('因子メモリーにする', async () => {
          if (I.memoriesOf(p).length >= I.MEMORY_MAX) return toast(`因子メモリーは ${I.MEMORY_MAX} 個まで（完成馬の画面で手放してから）`, { bad: true });
          if (!await ask(`${c.name}を因子メモリーにする？（完成馬にはならない。抜き出す能力とスキルはランダム）`, { ok: '因子メモリーにする', cancel: 'やめる' })) return;
          const gain = I.missionGain(p).length;
          const m = I.finishRunAsMemory(p);
          save(app);
          sound.play('bell');
          modal('因子メモリーを獲得！', [memoryCard(m),
            gain ? el('p.ik-msgain', [ic('wcoin', 16), `ミッション達成：ウイコイン +${gain}（いま ${I.coinsOf(p)} 枚）`]) : null,
            el('p.note', { text: '編成の「因子メモリー」枠に入れて使う。' })]);
          go('stable');
        }, { cls: 'big mem' }),
      ]),
    ]);
  } else if (I.isRaceTurn(run)) {
    const opts = I.raceOptions(run);
    let style = I.runRaceStyle(run);
    action = card(`${I.SLOTS[run.slot].label}のレース`, [
      styleSeg(style, I.styleNameOf(I.traineeCard(run).style), (x) => { style = x; run.raceStyle = x; save(app); }),
      el('div.ik-races', opts.map((o) => el('button.ik-race', {
        onclick: () => {
          const out = I.raceTurn(run, o.id, style);
          save(app);
          app.ikRace = { race: out.result, looks: looksOf(out.field), mine: [1], order: out.order, back: 'run', title: o.name,
            fired: { 1: out.fired, ...(out.rival ? { [out.rival.id]: out.rival.fired } : {}) }, rivalRun: out.rival, goal: out.goal };
          sound.play(out.order === 1 ? 'bell' : out.order <= 3 ? 'win' : 'ok');
          go('result');
        },
      }, [
        o.grade ? el(`span.gr.${o.grade}`, { text: o.grade }) : el('span.gr', { text: '条件' }),
        o.goal ? el('i.ik-goaltag', { text: '目標' }) : null,
        el('b', { text: o.name }),
        el('small', { text: `${o.surface}${o.distance}m・${o.ground}　相手の強さ ${lvlLabel(o.level)}` }),
      ]))),
      I.rivalMeetsNow(run) ? el('p.ik-rvnote', [ic('sword', 16), `ライバル${I.cardById(run.rival.cardId).name}が、どのレースを選んでも出てくる`]) : null,
      el('p.note', { text: '重賞は 1 勝から、GI は 2 勝か重賞勝ちで出られる（目標レースは 1 勝で出られる）。' }),
    ]);
  } else if (I.pendingEvent(run)) {
    // 育成中の出来事：答えるまで練習の札を出さない（ターンは進まない。答えたら同じターンの練習へ）
    const ev = I.pendingEvent(run);
    const sc = ev.support != null ? I.cardById(run.supports[ev.support]) : null;
    const face = el('span.ik-ev-face');
    if (sc) stickerInto(face, sc, { mode: 'face', zoom: 2.4 });
    else face.append(ic('spark', 30));
    action = el(`section.ik-tevent${ev.story != null ? '.story' : ''}`, [
      el('div.ik-tev-head', [face, el('div', [el('small', { text: ev.story != null ? `サポートの話 ${ev.story + 1} / ${I.STORY_EPISODES}${ev.story + 1 === I.STORY_EPISODES ? '（最終話）' : ''}` : '出来事' }), el('b', { text: ev.title })])]),
      el('p.ik-tev-text', { text: ev.text }),
      el('div.ik-tev-choices', ev.choices.map((c, i) => el('button.ik-tev-ch', {
        onclick: () => {
          const m = I.resolveEvent(run, i);
          save(app);
          sound.play('ok');
          toast(m, { bad: /機嫌を損ね|ぶり返/.test(m) });
          go('run');
        },
      }, [el('b', { text: c.label }), el('small', { text: c.hint }), c.risk ? el('i', { text: c.risk }) : null]))),
    ]);
  } else {
    const board = I.trainingBoard(run);
    const camp = I.isCamp(run);
    // 夏合宿の説明は題に入れる（札を 1 段足すと練習の札が下のボタン列に押し出される。落とし穴 103）
    action = card(camp ? `夏合宿　伸び ×${I.CAMP_MUL}・サポート全員集合` : '練習', [
      el(`div.ik-trains${camp ? '.camp' : ''}`, I.STATS.map((k) => {
        const pv = I.trainingPreview(run, k);
        return el(`button.ik-train${pv.friendship ? '.friend' : ''}`, {
          onclick: () => { const m = I.train(run, k); save(app); toast(m, { bad: m.includes('失敗') }); go('run'); },
        }, [
          el('b', { text: I.STAT_LABEL[k] }),
          el('div.gains', Object.entries(pv.gains).map(([s, g]) => el('span', { text: `${I.STAT_SHORT[s]}+${g}` }))),
          el('div.sup', board[k].map((i) => el(`span.${RCLS(I.cardById(run.supports[i]).rar)}`, { text: I.cardById(run.supports[i]).name }))),
          pv.friendship ? el('em.fr', { text: '友情' }) : null,
          pv.skills.length ? el('div.sks', pv.skills.map((n) => el('i', { text: n }))) : null,
          el('small', { text: `${k === 'wit' ? '体力+5' : `体力−${pv.cost}`}${pv.fail ? `　失敗${Math.round(pv.fail * 100)}%` : ''}` }),
        ]);
      })),
      el('div.ik-gbtns.ik-rest', [button('休む（体力を戻す）', () => { toast(I.rest(run)); save(app); go('run'); }, { cls: run.energy < 50 ? 'primary' : '' })]),
    ]);
  }
  // これまでのレースと記録は畳んでおく（練習を押すのに下までスクロールしなくて済むように）
  const history = run.races.length || run.log.length ? el('details.ik-hist', [
    el('summary', { text: `これまでのレース（${run.races.length} 戦）と記録` }),
    run.races.length ? table(['時期', 'レース', '', '着順', '発動スキル'], run.races.map((r) => [
      I.SLOTS[r.slot].label, r.name, `${r.surface}${r.distance}m${r.ground ? `・${r.ground}` : ''}`, el(`b${r.order === 1 ? '.win' : ''}`, { text: `${r.order}着/${r.field}` }),
      el('small', { text: (r.skills ?? []).join('・') || '—' }),
    ])) : null,
    el('div.ik-log', run.log.slice(-5).reverse().map((l) => el('div', { text: l }))),
  ]) : null;
  return [
    progress,
    goalStrip(app, run),
    el('div.ik-run2', [
      el('div.ik-top', [who, stats]),
      skillGroup,
      action,
      history,
      el('div.ik-gbtns', [button('育成をやめる', async () => {
        if (!await ask('この育成をやめる？（育てた馬は残らない）', { ok: 'やめる', cancel: '続ける' })) return;
        p.run = null; save(app); go('run');
      }, { cls: 'sm ghost' })]),
    ]),
  ];
}

const lvlLabel = (l) => (l >= 0.66 ? '★★★★★' : l >= 0.62 ? '★★★★' : l >= 0.58 ? '★★★' : l >= 0.52 ? '★★' : '★');

/** 3D に渡す毛色と白斑（カードの馬は実在馬の白斑）。field は runRace に渡した馬。 */
function looksOf(field, p = null) {
  const m = new Map();
  for (const f of field) {
    const c = f.cardId ? I.cardById(f.cardId) : null;
    // 完成馬はカードにした姿（撮った絵）を固有のカットインの切り抜きに使う
    const fh = f.fid != null ? p?.finished.find((x) => x.id === f.fid) : null;
    m.set(f.id, { coat: f.coat ?? c?.coat ?? '鹿毛', marks: f.marks ?? c?.marks ?? null, cardId: c?.id ?? null, gear: f.gear ?? null,
      // 固有スキルのエフェクト（自分の馬は spec が持つ。相手のカードの馬はカードの既定）
      fx: 'fx' in f ? f.fx : I.fxOfCard(c), artCard: fh ? I.horseCard(fh) : c });
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
      R.reward ? el('div.ikev-got', [
        cardView(R.reward.card, { scale: 0.2, onClick: (x) => showCard(app, x) }),
        el('div', [
          el('small', { text: `イベント報酬（${'☆'.repeat(R.reward.star)} 初勝利）` }),
          el('b', { text: `${R.reward.card.name}を${R.reward.isNew ? '手に入れた！' : `重ねた（${R.reward.awaken >= 4 ? '覚醒 MAX' : `覚醒 ${R.reward.awaken}`}）`}` }),
        ]),
      ]) : null,
      R.goal ? el(`div.ik-goalres.${R.goal}`, [ic('trophy', 22), el('div', [el('small', { text: '目標レース' }),
        el('b', { text: R.goal === 'done' ? `達成！ 評価点 +${I.GOAL_BONUS}・ウイコイン +${I.GOAL_COINS}（育成を終えると入る）` : '届かなかった' })])]) : null,
      R.rivalRun ? el('div.ik-rvres', [(() => { const f = el('span.ik-rv-face'); stickerInto(f, I.cardById(R.rivalRun.cardId), { mode: 'face', zoom: 2.4 }); return f; })(),
        el('div', [el('small', { text: 'ライバル' }), el('b', { text: `${R.rivalRun.name} ${R.rivalRun.order}着　${R.order < R.rivalRun.order ? '先着！' : '後れを取った'}` })])]) : null,
      R.rival ? el('div.ik-rvgot', [ic('wcoin', 22), el('div', [
        el('small', { text: `ライバルレース ${'☆'.repeat(R.rival.star)}${R.rival.first ? '　初勝利（次からスキップできる）' : ''}` }),
        el('b', { text: R.rival.coins ? `ウイコイン +${R.rival.coins}（今日 ${R.rival.got}/${I.RIVAL_DAILY}）` : R.order === 1 ? `今日のウイコインは受け取り済み（${I.RIVAL_DAILY}/${I.RIVAL_DAILY}）` : '勝てばウイコイン' }),
      ])]) : null,
      R.rank ? el(`div.ik-rankres${R.rank.promoted ? '.up' : R.rank.demoted ? '.down' : ''}`, [el(`b.ik-tier.t${R.rank.to}`, { text: I.RANK_TIERS[R.rank.to].name }), el('div', [
        el('small', { text: R.rank.promoted ? '昇格！' : R.rank.demoted ? '降格' : '段位' }),
        el('b', { text: `${R.rank.delta >= 0 ? '+' : ''}${R.rank.delta} 点（${R.rank.pts} 点）${R.rank.coins ? `　ウイコイン +${R.rank.coins}` : ''}` }),
      ])]) : null,
      R.fast ? el('div.ik-fastres', [ic('crown', 20), el('b', { text: `${I.stageLabel(I.stageKey(res))} の最速記録を更新！` })]) : null,
      R.fired ? el('div.ik-fired', res.results.filter((r) => mine.has(r.horseId) && R.fired[r.horseId]?.length).map((r) =>
        el('div', [el('b', { text: `${r.name}　発動` }), ...R.fired[r.horseId].map((n) => el('span.ik-sk.race', n))]))) : null,
      table(['着', '', '馬名', 'タイム', '着差', '上がり', '脚質'], res.results.map((r) => [
        r.order, frameChip(r.frame, r.gate), el(mine.has(r.horseId) ? 'b.mine' : r.horseId === R.rivalRun?.id ? 'b.ik-rvname' : 'span', { text: r.name }),
        formatTime(r.time), r.margin, r.last3f.toFixed(1), r.styleLabel,
      ]), { cls: 'ik-tbl' }),
      el('div.ik-gbtns', [
        button('3D で観る', () => go('watch'), { cls: 'primary big' }),
        button('次へ', () => go(R.back ?? 'run', R.backParams ?? {}), { cls: 'big' }),
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
  const camBar = el('div.cambar');
  const ctrl = el('div.ctrl-right');
  const fx = el('div.ik-fx');
  const wrap = el('div.watch.ik-watch', [
    el('div.view.bc', [canvas, fx, el('div.rankbox', [el('h3', { text: '順位' }), rankList])]),
    el('div.controls', [camBar, ctrl]),
  ]);
  let view = null;
  requestAnimationFrame(() => {
    try {
      view = createRaceView(canvas, race, { focusId: myIds[0] ?? null, marks: myIds, camera: 'auto', looks: R.looks });
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
    const hud = createRaceHud(view, race, { mine: myIds, title: R.title ?? race.name });
    wrap.querySelector('.view').appendChild(hud.node);
    view.onFrame = (st) => {
      skillFx.frame(st);
      hud.frame(st);
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
    // 固有は型ごとにレースの中で発動した地点（結果の uqAt）で見せる（好スタートはゲート、鬼脚は残り 400m、二の脚は抜かれた瞬間）
    const uqAt = race.results.find((r) => r.horseId === id)?.uqAt;
    for (const n of list ?? []) { const q = I.skillCue(n, race.distance); cues.push({ id, name: n, mine: mine.has(id), unique: q.unique, at: q.unique && uqAt != null ? Math.max(40, uqAt) : q.at, done: false }); }
  }
  cues.sort((a, b) => a.at - b.at);
  // 固有スキルのカットインに馬の切り抜きを出す（撮ってある絵だけ）。エフェクトの形はここで読んでおく（prepHorseFx）
  for (const c of cues.filter((x) => x.unique)) {
    c.kind = R.looks?.get(c.id)?.fx ?? null;
    if (!c.mine) continue;
    const card = R.looks?.get(c.id)?.artCard ?? null;
    // カードエディットで向きを決めた馬は、カットインもその向き（決めていなければ切り抜きの頭の向き・字は左へ流す）
    const fd = card?.fxDir ? I.fxDirOf(card) : 0;
    if (c.kind) c.nameFx = prepNameFx(c.name, c.kind, fd || 1);
    if (card) cardArtIfReady(card).then((a) => {
      c.img = a?.sticker?.url ?? null;
      // 馬の走る向きは切り抜きの頭の位置から（頭が左なら左へ走る。粒は後ろへ流す）
      if (c.img && c.kind) prepHorseFx(c.img, c.kind, fd || ((a.sticker.focus?.x ?? 0.3) < 0.5 ? -1 : 1)).then((v) => { c.horseFx = v; });
    });
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
    const kind = c.unique ? c.kind : null;
    if (c.unique && c.mine) {
      const F = kind ? I.SKILL_FX[kind] : null;
      const node = el(`div.ik-ult${kind ? `.fx-${kind}` : ''}`, { style: F ? `--fxc:${F.color};--fxg:${F.glow};--fxk:${F.core}` : null }, [
        el('div.lines'),
        c.horseFx ? ultHorse(c.horseFx) : c.img ? el('img', { src: c.img, alt: '' }) : null,
        el('div.t', [el('small', { text: F ? `固有スキル発動　${F.name}` : '固有スキル発動' }), !c.img && c.nameFx ? ultName(c.nameFx) : el('b', { text: c.name }), el('span', { text: names.get(c.id) })]),
      ]);
      fx.appendChild(node);
      later(() => node.remove(), 2600);
      sound.play('bell');
      view.flare(c.id, { color: 0xffc83a, big: true, fx: kind });
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
    view.flare(c.id, { color: c.unique ? 0xffc83a : c.mine ? 0x5ec8ff : 0xff6a6a, big: c.unique, fx: kind });
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

/**
 * 固有スキルのカットインのエフェクト（skillfx.js）。形の読み出し（getImageData）はレースが始まる前に済ませる：
 * 発動の瞬間に読むと、レースの 3D の描画が終わるまで待たされ、主スレッドが止まってカットインが描かれないまま消えた。
 * 読み出す canvas は willReadFrequently（CPU 側）に置く（GPU の canvas から読むと描画の待ち行列ごと待つ）。
 */
const cpuCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d', { willReadFrequently: true }); return c; };
/** 馬の切り抜き（ステッカー）の形から。余白を付けた大きさで読む（エフェクトが切り抜きの外へはみ出す）。 */
function prepHorseFx(src, kind, dir = -1) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const PAD = 0.55;
      // 表示は高さ 175px（×2.1 の余白）。毎コマ描くので画素を増やし過ぎない（画素密度の 1.5 倍まで）
      const H = Math.round(175 * Math.min(1.5, window.devicePixelRatio || 1)), s = H / img.naturalHeight;
      const iw = img.naturalWidth * s, ih = H;
      const W = Math.round(iw * (1 + PAD * 2)), HH = Math.round(ih * (1 + PAD * 2));
      const m = cpuCanvas(W, HH);
      m.getContext('2d').drawImage(img, iw * PAD, ih * PAD, iw, ih);
      const pt = fxPainter(kind, m, W, HH, 7, { dir });
      resolve(pt ? { pt, W, H: HH, src } : null);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
/** 切り抜きが無い馬（配合の育成馬は撮った絵を持たない）は、スキル名の字の形から。 */
function prepNameFx(name, kind, dir = 1) {
  const W = 760, H = 260;
  const m = cpuCanvas(W, H);
  const mg = m.getContext('2d');
  const size = Math.min(76, (W * 0.86) / Math.max(4, name.length));
  mg.font = `italic 900 ${size}px ${getComputedStyle(document.body).getPropertyValue('--font') || 'sans-serif'}`;
  mg.textAlign = 'center'; mg.textBaseline = 'middle';
  mg.fillStyle = '#fff';
  mg.fillText(name, W / 2, H / 2);
  // 字の帯は右へ滑り込むので、既定は粒を左へ流す（dir +1）
  const pt = fxPainter(kind, m, W, H, 11, { unit: 0.7, dir });
  if (!pt) return null;
  // 字は CSS の見出しと同じ白 → 主の色のグラデーション
  const F = I.SKILL_FX[kind];
  const txt = document.createElement('canvas');
  txt.width = W; txt.height = H;
  const tg = txt.getContext('2d');
  tg.font = mg.font; tg.textAlign = 'center'; tg.textBaseline = 'middle';
  const gr = tg.createLinearGradient(0, H / 2 - size / 2, 0, H / 2 + size / 2);
  gr.addColorStop(0.3, '#ffffff'); gr.addColorStop(0.8, F.color);
  tg.fillStyle = 'rgba(30,10,0,.55)'; tg.fillText(name, W / 2, H / 2 + 4);
  tg.fillStyle = gr; tg.fillText(name, W / 2, H / 2);
  return { pt, W, H, txt };
}
/** 切り抜きを後ろ（オーラ）と前（稲妻・粒）の 2 枚の canvas で挟む。 */
function ultHorse(v) {
  const bk = el('canvas.bk', { width: v.W, height: v.H }), fr = el('canvas.fr', { width: v.W, height: v.H });
  const box = el('div.ik-ultfx', [bk, el('img', { src: v.src, alt: '' }), fr]);
  animateFx(box, v.pt, bk, fr);
  return box;
}
function ultName(v) {
  const cv = el('canvas.ik-ultname', { width: v.W, height: v.H });
  const bk = document.createElement('canvas'), fr = document.createElement('canvas');
  bk.width = fr.width = v.W; bk.height = fr.height = v.H;
  const g = cv.getContext('2d');
  animateFx(cv, v.pt, bk, fr, () => { g.clearRect(0, 0, v.W, v.H); g.drawImage(bk, 0, 0); g.drawImage(v.txt, 0, 0); g.drawImage(fr, 0, 0); });
  return cv;
}
/** 2.6 秒のあいだ毎コマ描く（画面から外れたら止める）。 */
function animateFx(node, pt, bk, fr, compose = null) {
  const gb = bk.getContext('2d'), gf = fr.getContext('2d');
  const t0 = performance.now();
  const tick = () => {
    const t = (performance.now() - t0) / 1000;
    if (t > 2.7 || (t > 0.1 && !node.isConnected)) return;
    gb.clearRect(0, 0, bk.width, bk.height);
    gf.clearRect(0, 0, fr.width, fr.height);
    pt.draw(gb, gf, t);
    compose?.();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- 完成馬

/** 配合で作った育成馬の札（カードの代わり。切り抜き・名前・両親）。 */
function foalPlate(c) {
  const img = el('img.ik-foal-img', { alt: c.name, draggable: false });
  stickerInto(img, c);
  return el(`div.ik-foal.r-${c.rar}`, [
    img,
    el('div.ik-foal-n', [el(`span.rb.r-${c.rar}`, { text: c.rar }), el('b', { text: c.name }), el('small', { text: `${c.sex}・${c.coat}・${I.STYLE_NAMES[c.style < 0.25 ? 0 : c.style < 0.5 ? 1 : c.style < 0.75 ? 2 : 3]}` })]),
    el('div.ik-foal-p', [el('span', ['父 ', el('b', { text: c.sire })]), el('span', ['母 ', el('b', { text: c.dam })])]),
  ]);
}

function finishedCard(h) {
  const c = I.horseCard(h);
  return el(`div.ik-fin.${RCLS(h.rar)}`, [
    el('div.fh', [el(`span.rk.rk-${h.rank.replace('+', 'p')}`, { text: h.rank }), el('b', { text: h.name }), el('small', { text: `評価点 ${h.rating}` })]),
    el('div.fs', I.STATS.map((k) => el('span', [el('small', { text: I.STAT_SHORT[k] }), el('b', { text: I.gradeOfPts(h.stats[k]) }), el('i', { text: String(h.stats[k]) })]))),
    el('div.fm', { text: `${h.starts}戦${h.wins}勝（重賞 ${h.gradedWins}・GI ${h.giWins}）　${c ? `${I.distCat(c.dist)}・${c.turf >= c.dirt ? '芝' : 'ダート'}` : ''}　対戦 ${h.battles}戦${h.battleWins}勝` }),
  ]);
}

// ---------------------------------------------------------------- 因子メモリー

/** 因子メモリーの効き目の一行（スピード +80・王道）。 */
const memStars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
const memLine = (m) => `${I.STAT_LABEL[m.stat]} ${memStars(m.star)}${m.skill ? `・${I.skillInfo(m.skill).name}` : ''}`;

/** 因子メモリーのアイコン（元の馬の顔、右上に抜き出した能力、下にスキル）。 */
function memoryIcon(m, onClick, { sel = false, eager = false } = {}) {
  const h = m.horse;
  const c = I.horseCard(h);
  const face = el('span.ik-ico-face');
  const node = el(`button.ik-ico.ik-mem.r-${h.rar}${sel ? '.sel' : ''}`, { onclick: () => onClick(m, node), title: `${h.name}の因子メモリー　${memLine(m)}` }, [
    el('span.ik-ico-ring', [face, el('span.ik-ico-rar', { text: h.rar })]),
    el('span.ik-mem-st', [el('small', { text: `${I.STAT_SHORT[m.stat]} +${m.val}` }), el('b', { text: '★'.repeat(m.star) })]),
    el('b.ik-ico-name', { text: h.name }),
    el('small', { text: m.skill ? I.skillInfo(m.skill).name : 'スキルなし' }),
    el('small', { text: `${h.rank}　${h.rating}` }),
  ]);
  // eager：畳んだ欄の中のアイコンは、開いた瞬間に見えて顔を撮り始めると開く動きが止まるので、先に撮っておく
  if (c) { if (eager) stickerInto(face, c, { mode: 'face', zoom: 2.4 }); else whenVisible(node, () => stickerInto(face, c, { mode: 'face', zoom: 2.4 })); }
  return node;
}

/** 因子メモリーの札（獲得の知らせ・詳細）。抜き出した能力とスキルを大きく、元の馬の能力は小さく。 */
function memoryCard(m) {
  const h = m.horse;
  return el(`div.ik-fin.ik-memcard.${RCLS(h.rar)}`, [
    el('div.fh', [el('span.ik-mem-tag', { text: '因子メモリー' }), el('b', { text: h.name }), el('small', { text: `${h.rank}　評価点 ${h.rating}` })]),
    el('div.ik-mem-big', [
      el('div', [el('small', { text: '能力' }), el('b', [`${I.STAT_LABEL[m.stat]} `, el('span.ik-mem-stars', { text: memStars(m.star) })]),
        el('i', { text: `初期値 +${m.val}・上限を ${m.val} 突破（1200 を超えてよい。同じ能力は合わせて ${I.MEM_BREAK} まで）` })]),
      el('div', [el('small', { text: 'レーススキル' }), el('b', { text: m.skill ? I.skillInfo(m.skill).name : 'なし' }), el('i', { text: m.skill ? I.skillInfo(m.skill).desc ?? '育成のはじめから覚えている' : '元の馬がレーススキルを持っていなかった' })]),
    ]),
    el('div.fs', I.STATS.map((k) => el(`span${k === m.stat ? '.on' : ''}`, [el('small', { text: I.STAT_SHORT[k] }), el('b', { text: I.gradeOfPts(h.stats[k]) }), el('i', { text: String(h.stats[k]) })]))),
    el('div.fm', { text: `${h.starts}戦${h.wins}勝（重賞 ${h.gradedWins}・GI ${h.giWins}）` }),
  ]);
}

function showMemory(app, m) {
  const p = app.ik;
  const box = modal('因子メモリー', [
    memoryCard(m),
    el('div.ik-gbtns', [button('手放す', async () => {
      if (!await ask(`${m.horse.name}の因子メモリーを手放す？（元に戻せない。進行中の育成の効き目は変わらない）`, { ok: '手放す', cancel: 'やめる' })) return;
      I.dropMemory(p, m.id);
      if (app.ikDeck) app.ikDeck.memories = (app.ikDeck.memories ?? []).filter((x) => x !== m.id);
      save(app);
      box.close();
      app.go('ik', { ...app.params });
    }, { cls: 'ghost' })]),
  ]);
}

function stableView(app, go) {
  const p = app.ik;
  const mems = I.memoriesOf(p);
  const memCard = mems.length ? card(`因子メモリー（${mems.length}/${I.MEMORY_MAX}）`, [
    el('div.ik-icons', [...mems].reverse().map((m) => memoryIcon(m, (x) => showMemory(app, x)))),
    el('p.note', { text: `編成の因子メモリー枠（${I.MEMORY_SLOTS} つ）に入れて使う。何度でも使える。押すと詳細（手放す）。` }),
  ]) : null;
  if (!p.finished.length) return [card('完成馬', [el('p', { text: 'まだ完成馬がいない。育成で 2 年を走り切ると、ここに並ぶ。' }), button('育成へ', () => go('run'), { cls: 'primary' })]), memCard];
  const list = [...p.finished].sort((a, b) => b.rating - a.rating);
  return [card(`完成馬（${list.length} 頭）`, [
    el('div.ik-icons', list.map((h) => finishedIcon(h, go))),
    el('p.note', { text: '押すと詳細（対戦・ホームに立たせる・手放す）。評価点の高い順。' }),
  ]), memCard];
}

/**
 * 完成馬の一覧の 1 マス（所持カードの cardIcon と同じ顔のアイコン）。右上は評価、下は戦績と評価点。
 * 以前の横長の札（finishedCard）は 1 頭に 1 行を使い、頭数が増えると探しにくかった。
 */
function finishedIcon(h, go) {
  const c = I.horseCard(h);
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
  const c = I.horseCard(h);
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
    el('button.ikx-hero', { onclick: () => (h.art ? showMyCard(app, h) : c && !c.bred && showCard(app, c)), title: h.art ? 'カードを見る' : c?.bred ? h.name : 'カードを見る' }, img),
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
          el('span.bar', [el('i', { style: `width:${(Math.min(h.stats[k], I.PTS_MAX) / I.PTS_MAX) * 100}%` }), plus ? el('em', { style: `left:${(I.capOf(plus[k], h.awaken ?? 0) / I.PTS_MAX) * 100}%` }) : null]),
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
        skillTags(I.finishedSkills(h), I.uniqueOf(c)),
        el('h4', { text: '馬具' }),
        el('div.ik-gear', [el('span.gearline', gearChips(I.finishedSpec(h).gear)),
          el('button.gchange', { text: '変更', onclick: () => gearPicker(h.name, I.finishedSpec(h).gear, (g) => { const r = I.setFinishedGear(p, h.id, g); save(app); app.render(); return r; }) })]),
        el('h4', { text: '育てたカード' }),
        el('div.ikx-sups', [
          ...(c?.bred ? [I.cardById(h.sire), I.cardById(h.dam)].filter(Boolean).map((x, i) => el(`span.${RCLS(x.rar)}`, { text: `${i ? '母' : '父'} ${x.rar} ${x.name}` }))
            : c ? [el(`span.${RCLS(c.rar)}`, { text: `育成 ${c.rar} ${c.name}` })] : []),
          ...(h.supports ?? []).map((id) => I.cardById(id)).filter(Boolean).map((s) => el(`span.${RCLS(s.rar)}`, { text: `${s.rar} ${s.name}` }))]),
      ]),
    ]);
  };
  show(app.ikHorseTab);

  return [
    el('header.ikx-top', [
      el(`span.rb.r-${h.rar}`, { text: h.rar }),
      el('div.ikx-name', [el('small', { text: c ? epiOf(c) : '' }), el('b', { text: h.name })]),
      I.hallOf(p).includes(h.id) ? el('span.ikx-hall', [ic('crown', 14), '殿堂']) : null,
      el('span.ikx-sa', { text: `${h.sex}　${h.coat}` }),
      lineup.length > 1 ? el('span.ikx-count', { text: `${at + 1} / ${lineup.length}` }) : null,
    ]),
    stage,
    el('div.card.ikx-panel', [el('div.card-b', [bar, body])]),
    el('div.ik-gbtns', [
      button('この馬で対戦', () => { app.ikBattle = { ...(app.ikBattle ?? {}), horse: h.id }; go('battle'); }, { cls: 'primary' }),
      button(h.art ? 'カードを編集' : 'カードにする', () => go('cardedit', { id: h.id }), { cls: h.art ? '' : 'primary' }),
      h.art ? button('カードを見る', () => showMyCard(app, h)) : null,
      c ? button('ホームに立たせる', () => { p.fav = c.id; save(app); toast(`${h.name}をホームに立たせた`); }) : null,
      I.hallOf(p).includes(h.id)
        ? button('殿堂から外す', () => { I.setHall(p, h.id, false); save(app); toast(`${h.name}を殿堂から外した`); app.render(); })
        : button('殿堂入り', () => { try { I.setHall(p, h.id, true); } catch (e) { return toast(e.message, { bad: true }); } save(app); sound.play('bell'); toast(`${h.name}が殿堂入り！ ホームに飾られる`); app.render(); }, { cls: 'ik-hallbtn' }),
      button('一覧へ', () => go('stable')),
      button('手放す', async () => {
        if (I.hallOf(p).includes(h.id)) return toast('殿堂の馬は手放せない（殿堂から外してから）', { bad: true });
        if (!await ask(`${h.name}を手放す？`, { ok: '手放す' })) return;
        I.releaseFinished(p, h.id); save(app); go('stable');
      }, { cls: 'ghost' }),
    ]),
  ];
}

// ---------------------------------------------------------------- 記録と殿堂

/**
 * 記録と殿堂：殿堂の馬（ホームに飾る）→ 段位と最高の馬 → 通算の数 → 舞台ごとの最速の時計。
 * 数は profile.rec（育成と対戦のたびに積む）。最速は自分の馬だけ、育成のレースも対戦も同じ舞台なら同じ欄。
 */
function recordsView(app, go) {
  const p = app.ik;
  const R = I.recOf(p);
  const L = I.ladderState(p);
  const hall = I.hallOf(p).map((id) => p.finished.find((h) => h.id === id));
  const bestH = R.best ? p.finished.find((h) => h.id === R.best.id) : null;
  const n = (k) => (R[k] ?? 0).toLocaleString();
  const stat = (label, v, sub = '') => el('div.ik-recn', [el('small', { text: label }), el('b', { text: v }), sub ? el('em', { text: sub }) : null]);
  const fast = Object.entries(R.fast ?? {}).sort((a, b) => Number(a[0].split('|')[2]) - Number(b[0].split('|')[2]) || (a[0] < b[0] ? -1 : 1));
  return [
    card(`殿堂（${hall.length}/${I.HALL_MAX}）`, [
      hall.length ? el('div.ik-icons.ik-hallrow', hall.map((h) => finishedIcon(h, go)))
        : el('p.note', { text: '殿堂の馬はまだいない。完成馬の詳細で「殿堂入り」を押すと、こことホームに飾られる（殿堂の馬は手放せない）。' }),
      hall.length ? el('p.note', { text: '殿堂の馬はホームの上に飾られる。外すときは完成馬の詳細から。' }) : null,
    ]),
    card('段位と最高の馬', [
      el('div.ik-recrow', [
        el('button.ik-rectier', { onclick: () => go('npc') }, [el('small', { text: 'ランク戦の段位' }), el(`b.ik-tier.big.t${L.tier}`, { text: L.name }), el('em', { text: `${L.pts} 点・最高 ${I.RANK_TIERS[L.best].name}` })]),
        R.best ? el(`${bestH ? 'button' : 'div'}.ik-recbest`, { onclick: bestH ? () => go('horse', { id: bestH.id }) : null }, [
          el('small', { text: '育てた馬の最高評価点' }),
          el('b', [el(`span.rk-${R.best.rank.replace('+', 'p')}`, { text: R.best.rank }), ` ${R.best.rating.toLocaleString()}`]),
          el('em', { text: `${R.best.name}${bestH ? '' : '（手放した・因子メモリー）'}` }),
        ]) : el('div.ik-recbest', [el('small', { text: '育てた馬の最高評価点' }), el('b', { text: '—' })]),
      ]),
    ]),
    card('通算', [
      el('div.ik-recgrid', [
        stat('育成', `${n('runs')} 回`, `目標達成 ${n('goals')}`),
        stat('育成のレース', `${n('wins')} 勝`, `${n('starts')} 戦・GI ${n('giWins')} 勝`),
        stat('対戦', `${n('battleWins')} 勝`, `${n('battles')} 戦`),
        stat('ランク戦', `${n('rankw')} 勝`, `${n('rank')} 戦`),
        stat('ライバルレース', `${n('rivalw')} 勝`, `${n('rival')} 戦（スキップを含む）`),
        stat('イベント', `${n('eventw')} 勝`, `${n('event')} 戦`),
        stat('完成馬対決', `${n('own')} 回`),
        stat('ガチャ', `${p.pulls.toLocaleString()} 回`, `カード ${I.owned(p).length}/${I.CARDS.length} 種`),
      ]),
    ]),
    card(`舞台ごとの最速（${fast.length} 舞台）`, [
      fast.length ? table(['舞台', '時計', '馬', 'レース', ''], fast.map(([k, f]) => [
        I.stageLabel(k), el('b', { text: formatTime(f.t) }), f.horse, `${f.race}（${f.ground}）`, el('small', { text: f.mode }),
      ]), { cls: 'ik-tbl ik-rectbl' }) : el('p.note', { text: '記録はまだ無い。育成のレースか対戦を走ると、自分の馬の最速の時計がここに残る。' }),
    ]),
  ];
}

// ---------------------------------------------------------------- カードエディット（完成馬をカードにする）

/** 自分のカード（完成馬をカードにしたもの）を大きく見る。 */
function showMyCard(app, h) {
  const c = I.finishedCard(h);
  let m = null;
  m = modal(`${epithetOf(c)} ${c.name}`, [
    el('div.ik-big', cardView(c, { scale: Math.min(0.7, (window.innerHeight - 170) / 880, (window.innerWidth - 60) / 630), tilt: 'full', eager: true })),
    el('p.ik-record', { text: `戦績　${h.starts}戦${h.wins}勝（重賞 ${h.gradedWins}・GI ${h.giWins}）　評価 ${h.rank}` }),
    el('div.ik-gbtns', [
      button('カードを編集', () => { m.close(); app.go('ik', { view: 'cardedit', id: h.id }); }, { cls: 'primary' }),
      button('完成馬を見る', () => { m.close(); app.go('ik', { view: 'horse', id: h.id }); }),
    ]),
  ], { wide: true });
}

/** 色の札（押すと選ぶ）。 */
function swatches(list, cur, pick) {
  return el('div.gear-colors', list.map((c) => el(`button.gear-c${cur === c ? '.on' : ''}`, { style: `background:${c}`, title: c, onclick: () => pick(c) })));
}
const SILK_COLORS = ['#f4f2ec', '#1c1c1c', '#c8202a', '#1f3f9e', '#e8b21a', '#2f8f4a', '#e86aa0', '#7a4fc0', '#f07a28', '#5fb6e0', '#7a3b1e', '#8d949c'];
const deg = (r) => `${Math.round((r * 180) / Math.PI)}°`;
const AXIS_NAMES = { x: '縦', y: '横', z: 'ひねり' };
const RIDER_AXES = { x: '左右', y: '上下', z: '前後' };
// 画面の上の骨の線（リグの点を結ぶ）。騎手の点は 'rider.' を付けた名前
// （馬の部位の骨は、支点から先端へ stage.handles が返す piv → pts で引く）
const RIG_BONES = [
  ['rider.pelvis', 'rider.neck'], ['rider.neck', 'rider.head'], ['rider.neck', 'rider.handL'], ['rider.neck', 'rider.handR'],
  ['rider.pelvis', 'rider.ankleL'], ['rider.pelvis', 'rider.ankleR'],
];

/**
 * カードエディット（全画面の別ページ）。完成馬の一枚絵の撮り方を、生の 3D（撮影の舞台をそのまま動かす）を見ながら決める：
 * 構図（構え・向き・背景・馬場・カメラをドラッグで回す）、ポーズ（脚の運び・騎手の姿勢・リグ）、馬具、勝負服とゼッケン、二つ名。
 * リグは絵の上の点（関節）を掴んで動かす：馬の部位は支点の周りに回し（縦・横・ひねりの軸を選ぶ）、騎手の点（腰・肩・頭・手・足）は
 * 画面の面の中で動かす（肘と膝は IK で付いてくる）。点の無い所をドラッグするとカメラが回る。
 * 決めると h.art に残り、カードの絵（cardArt）はその撮り方で撮る。描画器はカードの絵と同じ 1 つ（artRenderer。落とし穴 23）。
 * スライダーやドラッグは舞台を組み直さずに馬とカメラだけ動かす。形の変わる値（馬具・騎手の姿勢・服・構え・背景）は組み直す。
 */
function cardEditView(app, go) {
  const p = app.ik;
  const h = p.finished.find((x) => x.id === app.params.id);
  if (!h) { queueMicrotask(() => go('stable')); return el('div'); }
  if (app.ikEdit?.id !== h.id) {
    const art = JSON.parse(JSON.stringify(h.art ?? I.defaultArt(h)));
    art.rig ??= {};
    art.rig.horse ??= {};
    art.rig.rider ??= {};
    app.ikEdit = { id: h.id, art, gear: { ...I.finishedSpec(h).gear }, tab: 'pose', part: 'neck', axis: 'x', handles: true, customSilks: !!art.silks };
  }
  const E = app.ikEdit;
  const A = E.art;
  const base = I.horseCard(h);
  const isRider = (k) => k.startsWith('rider.');

  // ---- 生の舞台
  const canvas = el('canvas.ikce-cv', { width: ART_SIZE.w, height: ART_SIZE.h });
  let stage = null;
  let queued = false;
  let rigDirty = false;
  let hs = null;   // 最後に描いた点（画素）
  const showHandles = () => E.handles && E.tab === 'pose';
  const draw = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (!stage || !canvas.isConnected) return;
      // 騎手の点のドラッグは騎手を作り直すので、動かした分をまとめて 1 コマに 1 回だけ当てる
      if (rigDirty) { rigDirty = false; stage.setRig(A.rig); }
      stage.render(artRenderer(), canvas, 3, A.fx in I.SKILL_FX ? { kind: A.fx, time: A.fxT ?? 0, seed: base.hid ?? 1 } : null);
      hs = null;
      if (showHandles()) drawHandles();
    });
  };
  const drawHandles = () => {
    const g = canvas.getContext('2d');
    const hd = stage.handles(Object.keys(I.RIG_HORSE), Object.keys(I.RIG_RIDER), canvas.width, canvas.height);
    hs = hd.pts;
    canvas.rigPoints = hs;   // 確かめ用（Playwright で点の位置を拾う）
    g.save();
    g.lineWidth = 2;
    for (const [k, a] of Object.entries(hd.piv)) {
      if (k === 'body') continue;   // 胴の支点は地面の高さ（線を引くと鞍から地面へ棒が出る）
      const b = hs[k];
      g.strokeStyle = k === E.part ? '#ff5a3cdd' : '#7fe8ffaa';
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    for (const [a, b] of RIG_BONES) {
      const pa = hs[a], pb = hs[b];
      if (!pa || !pb) continue;
      g.strokeStyle = isRider(a) ? '#ffd54acc' : '#7fe8ffcc';
      g.beginPath(); g.moveTo(pa.x, pa.y); g.lineTo(pb.x, pb.y); g.stroke();
    }
    for (const [k, q] of Object.entries(hs)) {
      const sel = k === E.part;
      const moved = isRider(k) ? A.rig.rider[k.slice(6)]?.some((x) => x) : A.rig.horse[k]?.some((x) => x);
      g.beginPath();
      g.arc(q.x, q.y, sel ? 8 : 5.5, 0, Math.PI * 2);
      g.fillStyle = sel ? '#ff5a3c' : moved ? '#f3a332' : isRider(k) ? '#ffd54a' : '#7fe8ff';
      g.fill();
      g.lineWidth = 2; g.strokeStyle = '#102326'; g.stroke();
    }
    g.restore();
  };
  const cam = () => A.camera ?? shotCamera({ shot: A.shot ?? 'profile' });
  const build = () => {
    stage?.dispose();
    stage = createPoseStage({
      hero: { id: base.hid ?? 1, coat: base.artCoat ?? base.coat, gate: A.gate ?? 1, frame: 1, marks: base.marks ?? null,
        silks: (E.customSilks ? A.silks : null) ?? base.silks ?? null, legPose: A.legPose ?? null, gear: E.gear, rig: A.rig },
      surface: A.surface ?? '芝', shot: A.shot ?? 'profile', phase: A.phase ?? 0.25, facing: A.facing ?? 'left', riderPose: A.pose ?? 'celebrate',
      wind: A.wind !== false, backdrop: A.backdrop ?? 'sunset', camera: A.camera ?? null,
    });
    // 画面を離れる・描き直すときに捨てる係（捨てたあとに待っていた描画が走らないよう、ここで null にする）
    app.ikStage = { dispose: () => { stage?.dispose(); stage = null; } };
    draw();
  };
  // カメラを見る点の周りに回す（ドラッグ・ホイール・スライダー）
  const orbit = (dAz, dEl, zoom = 1) => {
    const c = cam();
    const off = c.pos.map((x, i) => x - c.look[i]);
    const r = Math.hypot(...off);
    const az = Math.atan2(off[0], off[2]) + dAz;
    let elv = Math.asin(Math.max(-1, Math.min(1, off[1] / r))) + dEl;
    elv = Math.max(-0.12, Math.min(1.25, elv));
    const pos = [c.look[0] + r * Math.cos(elv) * Math.sin(az), c.look[1] + r * Math.sin(elv), c.look[2] + r * Math.cos(elv) * Math.cos(az)];
    pos[1] = Math.max(0.12, pos[1]);
    A.camera = { pos, look: [...c.look], fov: Math.max(8, Math.min(70, c.fov * zoom)) };
    stage?.setCamera(A.camera);
    draw();
    syncCamSliders();
  };

  // ---- 絵の上のドラッグ：点を掴めばリグ、点の無い所はカメラ
  const at = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height, s: canvas.width / r.width };
  };
  const pickHandle = (q) => {
    if (!hs) return null;
    let best = null, bd = 18 * q.s;
    for (const [k, v] of Object.entries(hs)) {
      const d = Math.hypot(v.x - q.x, v.y - q.y) - (k === E.part ? 4 * q.s : 0);   // 選んでいる点を優先
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  };
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    const q = at(e);
    const k = showHandles() ? pickHandle(q) : null;
    if (k && k !== E.part) selectPart(k);
    drag = { q, k };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || !stage) return;
    const q = at(e);
    if (drag.k) {
      if (isRider(drag.k)) {
        const key = drag.k.slice(6);
        const d = stage.dragRider(key, drag.q, q, canvas.width, canvas.height);
        const cur = A.rig.rider[key] ?? [0, 0, 0];
        A.rig.rider[key] = cur.map((x, i) => Math.max(-0.6, Math.min(0.6, x + d[i])));
        rigDirty = true;
      } else {
        const info = I.RIG_HORSE[drag.k];
        const axis = info.axes.includes(E.axis) ? E.axis : info.axes[0];
        const da = stage.dragAngle(drag.k, axis, drag.q, q, canvas.width, canvas.height);
        const cur = A.rig.horse[drag.k] ?? [0, 0, 0];
        const i = 'xyz'.indexOf(axis);
        cur[i] = Math.max(-2, Math.min(2, cur[i] + da));
        A.rig.horse[drag.k] = cur;
        stage.setRig(A.rig);
      }
      draw();
      syncPartSliders();
    } else {
      orbit(-(q.x - drag.q.x) / q.s * 0.008, (q.y - drag.q.y) / q.s * 0.006);
    }
    drag.q = q;
  });
  const end = () => { drag = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); orbit(0, 0, e.deltaY > 0 ? 1.08 : 1 / 1.08); }, { passive: false });

  // ---- 操作の部品
  const slider = (min, max, step, val, onInput, fmt = (v) => v.toFixed(2)) => {
    const out = el('em', { text: fmt(val) });
    const inp = el('input', { type: 'range', min, max, step, value: val });
    inp.addEventListener('input', () => { const v = Number(inp.value); out.textContent = fmt(v); onInput(v); });
    const node = el('span.ikce-sl', [inp, out]);
    node.set = (v) => { inp.value = v; out.textContent = fmt(v); };
    return node;
  };
  const row = (label, ctl) => el('div.ikce-row', [el('small', { text: label }), ctl]);
  const chips = (opts, cur, pick, mark = () => false) => el('div.ikce-chips', Object.entries(opts).map(([k, v]) => el(`button.ikce-chip${cur === k ? '.on' : ''}${mark(k) ? '.set' : ''}`, { text: v, onclick: () => pick(k) })));
  const panel = el('div.ikce-panel');
  const tabsBar = el('nav.tabs.ikce-tabs');
  const TABS = { pose: 'ポーズ', shot: '構図', fx: 'エフェクト', gear: '馬具', silks: '勝負服', name: '二つ名' };
  const showTab = (t) => {
    E.tab = t;
    tabsBar.replaceChildren(...Object.entries(TABS).map(([id, n]) => el('button.tab', { text: n, class: id === t ? 'on' : null, onclick: () => showTab(id) })));
    panel.replaceChildren(...tabBody(t));
    hint.textContent = showHandles() ? '点を掴んで動かす・点の無い所はカメラ' : 'ドラッグでカメラを回す';
    draw();
  };
  const hint = el('span.ikce-hint');
  let camSl = null;
  const syncCamSliders = () => {
    if (!camSl) return;
    const c = cam();
    const off = c.pos.map((x, i) => x - c.look[i]);
    camSl.az.set(Math.atan2(off[0], off[2]));
    camSl.el.set(Math.asin(off[1] / Math.hypot(...off)));
    camSl.fov.set(c.fov);
  };
  let partSl = null;
  const syncPartSliders = () => {
    if (!partSl) return;
    const k = E.part;
    const v = isRider(k) ? A.rig.rider[k.slice(6)] ?? [0, 0, 0] : A.rig.horse[k] ?? [0, 0, 0];
    for (const [i, s] of Object.entries(partSl)) s.set(v[i]);
  };
  const selectPart = (k) => {
    E.part = k;
    if (!isRider(k) && !I.RIG_HORSE[k].axes.includes(E.axis)) E.axis = I.RIG_HORSE[k].axes[0];
    if (E.tab === 'pose') showTab('pose');
  };
  const partLabel = (k) => (isRider(k) ? `騎手の${I.RIG_RIDER[k.slice(6)]}` : I.RIG_HORSE[k].name);
  const tabBody = (t) => {
    camSl = null; partSl = null;
    if (t === 'pose') {
      const k = E.part;
      const hk = Object.fromEntries(Object.entries(I.RIG_HORSE).filter(([, v]) => !v.leg).map(([key, v]) => [key, v.name]));
      const legs = Object.fromEntries(Object.entries(I.RIG_HORSE).filter(([, v]) => v.leg).map(([key, v]) => [key, v.name]));
      const rk = Object.fromEntries(Object.entries(I.RIG_RIDER).map(([key, v]) => [`rider.${key}`, v]));
      const movedH = (key) => A.rig.horse[key]?.some((x) => x);
      const movedR = (key) => A.rig.rider[key.slice(6)]?.some((x) => x);
      let ctl;
      if (isRider(k)) {
        const v = A.rig.rider[k.slice(6)] ?? [0, 0, 0];
        partSl = Object.fromEntries([0, 1, 2].map((i) => [i, slider(-0.6, 0.6, 0.005, v[i], (x) => {
          const cur = A.rig.rider[k.slice(6)] ?? [0, 0, 0];
          cur[i] = x; A.rig.rider[k.slice(6)] = cur; rigDirty = true; draw();
        }, (x) => `${Math.round(x * 100)}cm`)]));
        ctl = [row('左右', partSl[0]), row('上下', partSl[1]), row('前後', partSl[2])];
      } else {
        const info = I.RIG_HORSE[k];
        const v = A.rig.horse[k] ?? [0, 0, 0];
        partSl = Object.fromEntries([...info.axes].map((a) => {
          const i = 'xyz'.indexOf(a);
          return [i, slider(-2, 2, 0.01, v[i], (x) => {
            const cur = A.rig.horse[k] ?? [0, 0, 0];
            cur[i] = x; A.rig.horse[k] = cur; stage?.setRig(A.rig); draw();
          }, deg)];
        }));
        ctl = [
          row('ドラッグの軸', chips(Object.fromEntries([...info.axes].map((a) => [a, AXIS_NAMES[a]])), E.axis, (a) => { E.axis = a; showTab('pose'); })),
          ...[...info.axes].map((a) => row(AXIS_NAMES[a], partSl['xyz'.indexOf(a)])),
        ];
      }
      return [
        row('脚の運び', slider(0, 1, 0.005, A.phase ?? 0.25, (v) => { A.phase = v; stage?.pose(v, A.legPose ?? null); draw(); })),
        row('騎手の姿勢', chips(I.ART_POSES, A.pose ?? 'celebrate', (key) => { A.pose = key; build(); showTab('pose'); })),
        row('点', chips({ on: '表示', off: '隠す' }, E.handles ? 'on' : 'off', (v) => { E.handles = v === 'on'; showTab('pose'); })),
        el('h4', { text: '部位（絵の点を押しても選べる）' }),
        row('馬', chips(hk, k, selectPart, movedH)),
        row('脚', chips(legs, k, selectPart, movedH)),
        row('騎手', chips(rk, k, selectPart, movedR)),
        el('div.ikce-part', [el('b', { text: partLabel(k) }), ...ctl]),
        el('div.ik-gbtns', [
          button('この部位を戻す', () => { if (isRider(k)) { delete A.rig.rider[k.slice(6)]; rigDirty = true; } else { delete A.rig.horse[k]; stage?.setRig(A.rig); } draw(); showTab('pose'); }, { cls: 'sm' }),
          button('全部戻す', () => { A.rig = { horse: {}, rider: {} }; A.legPose = undefined; stage?.pose(A.phase ?? 0.25, null); rigDirty = true; draw(); showTab('pose'); }, { cls: 'sm ghost' }),
        ]),
        el('p.note', { text: '馬の部位は支点の周りに回す（縦・横・ひねりはドラッグの軸で選ぶ）。騎手の点は画面に沿って動かす（肘と膝は付いてくる）。橙の点は動かした部位。' }),
      ];
    }
    if (t === 'shot') {
      const shots = Object.fromEntries(I.ART_SHOTS.map((key) => [key, SHOTS[key]?.name ?? key]));
      const c = cam();
      const off = c.pos.map((x, i) => x - c.look[i]);
      const r = Math.hypot(...off);
      const aim = () => { const c2 = cam(); return c2.pos.map((x, i) => x - c2.look[i]); };
      camSl = {
        az: slider(-Math.PI, Math.PI, 0.01, Math.atan2(off[0], off[2]), (v) => { const o2 = aim(); orbit(v - Math.atan2(o2[0], o2[2]), 0); }, deg),
        el: slider(-0.12, 1.25, 0.01, Math.asin(off[1] / r), (v) => { const o2 = aim(); orbit(0, v - Math.asin(o2[1] / Math.hypot(...o2))); }, deg),
        fov: slider(8, 70, 0.5, c.fov, (v) => orbit(0, 0, v / cam().fov), (v) => `${v.toFixed(0)}°`),
      };
      return [
        row('構え', chips(shots, A.shot ?? 'profile', (key) => { A.shot = key; A.camera = null; build(); showTab('shot'); })),
        row('向き', chips({ left: '左へ走る', right: '右へ走る' }, A.facing ?? 'left', (key) => { A.facing = key; build(); showTab('shot'); })),
        row('背景', chips(I.ART_BACKDROPS, A.backdrop ?? 'sunset', (key) => { A.backdrop = key; build(); showTab('shot'); })),
        row('馬場', chips({ 芝: '芝', ダート: 'ダート' }, A.surface ?? '芝', (key) => { A.surface = key; build(); showTab('shot'); })),
        row('風の筋', chips({ on: 'あり', off: 'なし' }, A.wind === false ? 'off' : 'on', (key) => { A.wind = key === 'on' ? undefined : false; build(); showTab('shot'); })),
        el('p.note', { text: 'カメラは絵をドラッグで回し、ホイールで寄る。' }),
        row('回り込み', camSl.az), row('高さ', camSl.el), row('画角', camSl.fov),
        el('div.ik-gbtns', [button('カメラを構えに戻す', () => { A.camera = null; stage?.setCamera(cam()); draw(); syncCamSliders(); }, { cls: 'sm' })]),
      ];
    }
    if (t === 'fx') {
      // 固有スキルのエフェクト。絵に描くのは選んだときだけ（おまかせは絵に付けず、観戦は固有のカードの既定）
      const uc = h.cardId ? I.uniqueCardOf(I.cardById(h.cardId)) : h.unique ? I.cardById(h.unique) : null;
      const uq = uc ? I.uniqueOf(uc) : null;
      const auto = uc ? I.uniqueFxOf(uc) : null;
      const cur = A.fx ?? 'auto';
      const pick = (k) => { A.fx = k === 'auto' ? undefined : k; showTab('fx'); };
      // 向き：先頭（竜巻の細い側・稲妻の走る先）が向く方。粒は反対へ流れる。自動は馬の向き
      const dirChip = (k, name) => el(`button.ikce-chip${(A.fxDir ?? 'auto') === k ? '.on' : ''}`, { onclick: () => { A.fxDir = k === 'auto' ? undefined : k; draw(); showTab('fx'); } }, [name]);
      const chip = (k, name, color = null) => el(`button.ikce-chip.ikce-fx${cur === k ? '.on' : ''}`, { style: color ? `--c:${color}` : null, onclick: () => pick(k) }, [color ? el('i') : null, name]);
      return [
        row('エフェクト', el('div.ikce-chips', [
          chip('auto', 'おまかせ'), chip('none', 'なし'),
          ...Object.entries(I.SKILL_FX).map(([k, f]) => chip(k, f.name, f.color)),
        ])),
        row('カットインの向き', el('div.ikce-chips', [dirChip('auto', `自動（${A.facing === 'right' ? '右' : '左'}）`), dirChip('left', '← 左向き'), dirChip('right', '右向き →')])),
        // 時間：止めた絵の時刻だけを進める（脚の運びを変えると馬の形が変わって粒の出どころも変わるので、エフェクトだけ動かすのはこちら）
        A.fx in I.SKILL_FX ? row('時間', slider(0, I.FX_TIME_MAX, 0.02, A.fxT ?? 0, (v) => { A.fxT = v || undefined; draw(); }, (v) => `+${v.toFixed(2)} 秒`)) : null,
        el('p.note', { text: uq
          ? `固有スキル「${uq.name}」の発動（観戦の 3D とカットイン）にも、このエフェクトが出る。おまかせは絵に描かず、発動は${I.SKILL_FX[auto].name}。なしは発動の演出もエフェクトなし。`
          : 'この馬は固有スキルを持たないので、エフェクトはカードの絵だけに付く（LM の親から固有を受け継いだ馬は発動にも出る）。' }),
      ];
    }
    if (t === 'gear') {
      return [
        el('p.note', { text: '馬具はカードの絵とレース（対戦）の両方に効く。' }),
        ...I.GEAR_KEYS.map((key) => {
          const on = !!E.gear[key];
          const colored = key === 'menko' || key === 'shadowRoll';
          return el(`div.gear-row${on ? '.on' : ''}`, [
            el('button.gear-tog', {
              onclick: () => {
                if (on) delete E.gear[key];
                else {
                  E.gear[key] = colored ? I.GEAR_COLORS[0] : true;
                  if (key === 'blinker') delete E.gear.cheek;
                  if (key === 'cheek') delete E.gear.blinker;
                }
                build(); showTab('gear');
              },
            }, [el('b', { text: I.GEAR[key].name }), el('small', { text: I.GEAR[key].desc })]),
            colored && on ? swatches(I.GEAR_COLORS, E.gear[key], (c) => { E.gear[key] = c; build(); showTab('gear'); }) : null,
          ]);
        }),
      ];
    }
    if (t === 'silks') {
      const S = (A.silks ??= { body: '#c8202a', accent: '#f4f2ec', pattern: '輪', sleeve: 'plain' });
      const set = (key, v) => { S[key] = v; E.customSilks = true; build(); showTab('silks'); };
      return [
        row('勝負服', chips({ orig: base.silks ? '元の服' : 'おまかせ', custom: '自分で決める' }, E.customSilks ? 'custom' : 'orig', (key) => { E.customSilks = key === 'custom'; build(); showTab('silks'); })),
        ...(E.customSilks ? [
          row('胴の色', swatches(SILK_COLORS, S.body, (c) => set('body', c))),
          row('柄の色', swatches(SILK_COLORS, S.accent, (c) => set('accent', c))),
          row('柄', chips(Object.fromEntries(I.SILK_PATTERNS.map((x) => [x, x])), S.pattern, (key) => set('pattern', key))),
          row('袖', chips(I.SILK_SLEEVES, S.sleeve, (key) => set('sleeve', key))),
          row('帽子', swatches(SILK_COLORS, typeof S.cap === 'number' ? `#${S.cap.toString(16).padStart(6, '0')}` : null, (c) => set('cap', parseInt(c.slice(1), 16)))),
        ] : []),
        row('ゼッケン', slider(1, 18, 1, A.gate ?? 1, (v) => { A.gate = v; clearTimeout(E.gt); E.gt = setTimeout(build, 200); }, (v) => String(v))),
      ];
    }
    // 二つ名
    const inp = el('input.ikce-name', { type: 'text', maxLength: 16, value: A.epithet ?? '', placeholder: epithetOf({ ...I.finishedCard(h), epithet: null }) });
    inp.addEventListener('input', () => { A.epithet = inp.value; });
    return [row('二つ名（16 字まで）', inp), el('p.note', { text: '空なら自動で付く（得意な能力と看板のレースから）。' })];
  };

  const save1 = () => {
    if (!E.customSilks) A.silks = undefined;
    I.setFinishedArt(p, h.id, A);
    I.setFinishedGear(p, h.id, E.gear);
    save(app);
    app.ikEdit = null;
    sound.play('bell');
    toast(`${h.name}をカードにした`);
    go('horse', { id: h.id });
    showMyCard(app, h);
  };
  const leave = async () => {
    if (!await ask('編集をやめて完成馬の画面へ戻る？（決めた撮り方は残らない）', { ok: 'やめる', cancel: '続ける' })) return;
    app.ikEdit = null;
    go('horse', { id: h.id });
  };
  build();
  showTab(E.tab);
  // 別のページ（全画面）。下のボタン列や上の帯を出さず、絵と操作だけにする
  return el('div.ikce-full', [
    el('header.ikce-top', [
      el('button.ikp-back', { onclick: leave, title: '戻る' }, icon('back', { size: 24 })),
      el('div.ikce-ttl', [el('b', { text: 'カード編集' }), el('small', { text: `${h.rar}　${h.name}` })]),
      button(h.art ? '作り直す' : 'カードにする', save1, { cls: 'primary' }),
    ]),
    el('div.ikce-main', [
      el('div.ikce-stagebox', [el('div.ikce-frame', [canvas, hint])]),
      el('div.ikce-side', [tabsBar, panel]),
    ]),
  ]);
}

// ---------------------------------------------------------------- 対戦

// ---------------------------------------------------------------- イベント

/**
 * イベントのバナー。報酬のカードの一枚絵（背景）と切り抜き（モンジューとエルコンドルパサー）を重ね、題と進みを載せる。
 * 絵は撮影の舞台で撮ったものを使い回す（cardArt。WebGL を増やさない）。
 */
function eventBanner(app, ev, onclick = null) {
  const c = I.cardById(ev.reward);
  const st = I.eventState(app.ik, ev.id);
  const bg = el('span.ikev-bg');
  const hero = el('img.ikev-hero', { alt: c.name, draggable: false });
  bgInto(bg, c);
  stickerInto(hero, c, { mode: 'img' });
  return el(`${onclick ? 'button' : 'div'}.ikev-banner`, { onclick }, [
    bg, el('span.ikev-shade'), hero,
    el('div.ikev-tx', [
      el('span.ikev-tag', { text: 'EVENT' }),
      el('small.ikev-en', { text: ev.en ?? String(ev.year) }),
      el('b.ikev-ttl', { text: ev.race.name }),
      el('span.ikev-sub', { text: `― ${c.epithet} ―` }),
      el('span.ikev-rw', [el('i', { text: c.rar }), el('span', { text: `${c.name} を手に入れよう` })]),
      el('span.ikev-stars', [1, 2, 3, 4, 5].map((n) => el(`i${st.cleared.includes(n) ? '.on' : ''}`, { text: '★' }))),
    ]),
  ]);
}

/**
 * 対戦の画面のイベント：バナーを横に並べ、スワイプ（指・トラックパッド・マウスのドラッグ）か矢印・点で切り替える。
 * 新しいイベントを先頭に。並びは CSS の scroll-snap（指の慣性に任せる）。見ていた 1 枚は app.ikEvSlide に覚える。
 */
function eventCarousel(app, go) {
  const evs = [...I.EVENTS].reverse();
  const track = el('div.ikev-track', evs.map((ev) => el('div.ikev-slide', [eventBanner(app, ev, () => { if (!dragged) go('event', { ev: ev.id }); })])));
  const dots = el('div.ikev-dots', evs.map((ev, i) => el('button', { 'aria-label': ev.name, onclick: () => to(i) })));
  const idx = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
  const mark = () => {
    const i = idx();
    app.ikEvSlide = evs[i]?.id;
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
    prev.disabled = i <= 0; next.disabled = i >= evs.length - 1;
  };
  const to = (i) => track.scrollTo({ left: Math.max(0, Math.min(evs.length - 1, i)) * track.clientWidth, behavior: 'smooth' });
  const prev = el('button.ikev-arrow.prev', { 'aria-label': '前のイベント', onclick: () => to(idx() - 1), text: '‹' });
  const next = el('button.ikev-arrow.next', { 'aria-label': '次のイベント', onclick: () => to(idx() + 1), text: '›' });
  let raf = 0;
  track.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(mark); }, { passive: true });
  // マウスのドラッグでも送る（指とトラックパッドは scroll-snap がそのまま効く）。動かしたらバナーの押下にしない
  let dragged = false, sx = 0, sl = 0, down = false, ddx = 0;
  // 押さえた要素に捕まえておく（window に付けると画面を描き直すたびに係が増える）
  // 押した瞬間の既定の動き（絵の掴み・文字の選択）を止める。止めないと 1 歩目で掴みが始まり、以降の pointermove が来なかった
  track.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse' || evs.length < 2) return; e.preventDefault(); down = true; dragged = false; sx = e.clientX; sl = track.scrollLeft; });
  track.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = ddx = e.clientX - sx;
    if (!dragged && Math.abs(dx) > 6) { dragged = true; track.setPointerCapture(e.pointerId); track.classList.add('drag'); }
    if (dragged) track.scrollLeft = sl - dx;
  });
  const up = () => { if (!down) return; down = false; if (dragged) {
    // 少し動かしただけでも向きのほうへ 1 枚送る（半分まで引かないと戻るのは重い）
    track.classList.remove('drag');
    to(Math.round(sl / Math.max(1, track.clientWidth)) + (ddx < -40 ? 1 : ddx > 40 ? -1 : 0));
  } setTimeout(() => { dragged = false; }, 0); };
  track.addEventListener('pointerup', up);
  track.addEventListener('pointercancel', up);
  const wrap = el('div.ikev-car', [track, evs.length > 1 ? prev : null, evs.length > 1 ? next : null, evs.length > 1 ? dots : null]);
  // 覚えていた 1 枚から（描いた後に幅が決まるので次のフレームで）
  const start = Math.max(0, evs.findIndex((e) => e.id === app.ikEvSlide));
  requestAnimationFrame(() => { track.scrollLeft = start * track.clientWidth; mark(); });
  return wrap;
}

/** イベントの画面：バナー・難易度（☆1〜☆5）・出る馬・出走馬（史実の 14 頭）・報酬。 */
function eventView(app, go) {
  const p = app.ik;
  const ev = I.EVENTS.find((e) => e.id === app.params.ev) ?? I.EVENTS.at(-1);
  const st = I.eventState(p, ev.id);
  const c = I.cardById(ev.reward);
  // 難易度と出る馬はイベントごとに覚える（凱旋門賞で選んだ☆を BC クラシックへ持ち越さない）
  app.ikEvent ??= {};
  const E = app.ikEvent[ev.id] ??= {};
  E.star ??= Math.min(5, (st.cleared.length ? Math.max(...st.cleared) : 0) + 1);
  const turfs = [...p.finished].sort((a, b) => b.rating - a.rating);
  if (turfs.length) E.horse = p.finished.some((h) => h.id === E.horse) ? E.horse : turfs[0].id;
  const starBtns = el('div.ikev-diff', [1, 2, 3, 4, 5].map((n) => el(`button.ikev-star${E.star === n ? '.on' : ''}${st.cleared.includes(n) ? '.done' : ''}`, {
    onclick: () => { E.star = n; go('event', { ev: ev.id }); },
  }, [el('b', { text: '☆'.repeat(n) }), el('small', { text: st.cleared.includes(n) ? '勝利済み' : '報酬あり' })])));
  const R = ev.race;
  const D = R.distance;
  const fitTxt = (me) => [
    R.surface === '芝' ? `芝 ${MARK(me.turf)}` : `ダート ${MARK(me.dirt)}`,
    R.ground !== '良' ? `重い馬場 ${MARK(me.soft)}` : null,
    `${D}m ${Math.abs(me.dist - D) <= (me.range ?? 400) ? '○' : Math.abs(me.dist - D) <= 800 ? '△' : '×'}`,
  ].filter(Boolean).join('　');
  // 出る馬を選び直したら、脚質の札と向きだけを描き直す（画面ごと描き直すとスクロールが先頭へ戻る）
  const meBox = el('div.ik-rv-me');
  const drawMe = () => {
    const me = p.finished.find((h) => h.id === E.horse);
    meBox.replaceChildren(
      me ? styleSeg(I.horseRaceStyle(me), I.styleNameOf(me.style), (x) => { I.setHorseRaceStyle(me, x); save(app); }) : '',
      el('p.note', { text: `${ev.stage}。${me ? `${me.name}：${fitTxt(me)}` : ''}` }),
    );
  };
  drawMe();
  const horseSel = turfs.length ? horsePicker(app, E.horse, (h) => { E.horse = h.id; drawMe(); }, { race: R }) : null;
  const run = () => {
    const out = I.eventRace(p, E.horse, ev.id, E.star);
    save(app);
    if (out.reward?.isNew) app.ikNew = true;
    app.ikRace = { race: out.result, looks: looksOf(out.field, p), mine: [100], order: out.order, back: 'event', backParams: { ev: ev.id },
      title: `${ev.name}（${'☆'.repeat(E.star)}）`, fired: out.fired, reward: out.reward, fast: out.fast };
    sound.play(out.order === 1 ? 'bell' : out.order <= 3 ? 'win' : 'ok');
    go('result');
  };
  const lvl = (m) => {
    const a = I.STATS.reduce((t, k) => t + m.ab[k], 0) / 5 + I.STAR_D[E.star];
    return '★'.repeat(Math.max(1, Math.min(5, Math.round((a - 0.5) / 0.05))));
  };
  return [
    eventBanner(app, ev),
    el('p.ikev-blurb', { text: ev.blurb }),
    card('難易度', [
      starBtns,
      el('p.note', { text: `各難易度で初めて勝つと ${c.name}（${c.rar}）を 1 枚。☆1〜☆5 の 5 つで 5 枚＝覚醒 MAX。いま ${st.cleared.length}/5（挑戦 ${st.tries} 回）。☆4 でほぼ史実の強さ。` }),
    ]),
    card('出る馬', turfs.length ? [
      horseSel,
      meBox,
      el('div.ik-gbtns', [button(`${'☆'.repeat(E.star)} で出走する`, run, { cls: 'primary big' })]),
    ] : [el('p', { text: 'イベントには完成馬が要る。' }), button('育成へ', () => go('run'), { cls: 'primary' })]),
    card(`出走馬（${ev.year} 年 ${ev.date}・${ev.field.length} 頭）`, [
      table(['史実', '馬名', '', '脚質', `強さ（${'☆'.repeat(E.star)}）`], ev.field.map((m) => [
        `${m.pos}着`, el(m.cardId === c.id ? 'b.mine' : 'span', { text: m.name }), `${m.sex}${m.age}`,
        { 0.05: '逃げ', 0.3: '先行', 0.62: '差し', 0.88: '追込' }[m.style] ?? '', el('span.ikev-lv', { text: lvl(m) }),
      ]), { cls: 'ik-tbl' }),
    ]),
    card('報酬', [
      el('div.ikev-reward', [
        cardView(c, { scale: fit(0.3), count: p.cards[c.id] ?? 0, dim: !p.cards[c.id], onClick: p.cards[c.id] ? (x) => showCard(app, x) : null }),
        el('div', [
          el('b', { text: `${c.rar} ${c.epithet} ${c.name}` }),
          el('p.note', { text: `イベントの報酬でだけ手に入る（ガチャに出ない・かけらで交換できない）。${c.name}も出走馬として走り、最後の直線で固有スキル「${c.epithet}」を使う。` }),
          el('p', { text: `所持 ${p.cards[c.id] ?? 0} 枚　${(p.cards[c.id] ?? 0) >= 5 ? '覚醒 MAX' : `覚醒 ${Math.max(0, (p.cards[c.id] ?? 0) - 1)}`}` }),
        ]),
      ]),
    ]),
  ];
}
// ---------------------------------------------------------------- 出る馬を選ぶ（アイコン）

/** 並べ替え（評価値・脚質・距離・芝ダート）。同じ札をもう一度押すと向きが逆になる。 */
const PICK_SORTS = [['rating', '評価値'], ['style', '脚質'], ['dist', '距離'], ['surface', '芝・ダート']];
const PICK_KEY = {
  rating: (h) => -h.rating,
  style: (h) => I.STYLE_NAMES.indexOf(I.horseRaceStyle(h)),   // 逃げ → 追込
  dist: (h) => h.dist,                                        // 短 → 長
  surface: (h) => h.dirt - h.turf,                            // 芝 → ダート
};
/** 舞台への向き（馬場の◎○△×と距離の○△×）。 */
const fitOf = (h, race) => {
  const surf = race.surface === '芝' ? `芝${MARK(h.turf)}` : `ダ${MARK(h.dirt)}`;
  const d = Math.abs(h.dist - race.distance);
  return `${surf} ${race.distance}m${d <= (h.range ?? 400) ? '○' : d <= 800 ? '△' : '×'}`;
};

/**
 * 出る馬を顔のアイコンで並べて選ぶ（対戦・イベント・ライバルレース）。
 * 選び直しても画面ごと描き直さない（描き直すとスクロールが先頭へ戻る。落とし穴 77）：印を付け替えて onPick を呼ぶだけ。
 * 並べ替えは app.ikPickSort に覚える（画面をまたいで同じ）。
 */
function horsePicker(app, selId, onPick, { race = null, multi = false } = {}) {
  const p = app.ik;
  app.ikPickSort ??= { by: 'rating', rev: false };
  const S = app.ikPickSort;
  const grid = el('div.ik-hpick');
  // multi は何頭でも選べる（完成馬対決）。selId は id の配列で、押すたびに足し引きする
  const sel = new Set(multi ? selId : [selId]);
  const icon1 = (h) => {
    const c = I.horseCard(h);
    const face = el('span.ik-ico-face');
    const node = el(`button.ik-ico.ik-hp.r-${h.rar}${sel.has(h.id) ? '.sel' : ''}${multi ? '.multi' : ''}`, {
      onclick: () => {
        if (multi) { if (sel.has(h.id)) sel.delete(h.id); else sel.add(h.id); node.classList.toggle('sel', sel.has(h.id)); onPick(h, [...sel]); return; }
        sel.clear(); sel.add(h.id);
        for (const n of grid.children) n.classList.toggle('sel', n === node);
        onPick(h);
      },
      title: `${h.name}　評価点 ${h.rating}`,
    }, [
      el('span.ik-ico-ring', [face, el('span.ik-ico-rar', { text: h.rar })]),
      el(`span.ik-ico-rk.rk-${h.rank.replace('+', 'p')}`, { text: h.rank }),
      el('b.ik-ico-name', { text: h.name }),
      el('small', { text: `${I.horseRaceStyle(h)}・${I.distCat(h.dist)} ${r100(h.dist)}m` }),
      el('small', { text: `芝${MARK(h.turf)} ダ${MARK(h.dirt)}　${h.rating}` }),
      race ? el('i.ik-hp-fit', { text: fitOf(h, race) }) : null,
    ]);
    if (c) whenVisible(node, () => stickerInto(face, c, { mode: 'face', zoom: 2.4 }));
    return node;
  };
  const draw = () => {
    const k = PICK_KEY[S.by] ?? PICK_KEY.rating;
    const list = [...p.finished].sort((a, b) => (k(a) - k(b)) * (S.rev ? -1 : 1) || b.rating - a.rating);
    grid.replaceChildren(...list.map(icon1));
  };
  const bar = el('div.ik-hsort', [el('small', { text: '並べ替え' }), ...PICK_SORTS.map(([id, name]) => el(`button.ik-hs${S.by === id ? '.on' : ''}`, {
    onclick: (e) => {
      if (S.by === id) S.rev = !S.rev; else { S.by = id; S.rev = false; }
      for (const b of bar.querySelectorAll('.ik-hs')) { b.classList.toggle('on', b === e.currentTarget); b.dataset.rev = b === e.currentTarget && S.rev ? '1' : ''; }
      draw();
    },
    'data-rev': S.by === id && S.rev ? '1' : '',
  }, name))]);
  draw();
  return el('div.ik-hpicker', [bar, grid]);
}

// ---------------------------------------------------------------- ライバルレース

/** ライバルレースのバナーの絵（イクイノックス）。 */
const RIVAL_ART = 'P2-17';

/**
 * 対戦の各ページのバナー（イベントのバナーと同じ組み立て）：カードの一枚絵を背景に、切り抜きと題を載せる。
 * onclick があれば押せる（対戦の画面の一覧）、無ければページの頭の飾り。
 */
function modeBanner({ art, tag, en, title, sub, line = null, stars = null, cls = '' }, onclick = null) {
  const c = I.cardById(art);
  const bg = el('span.ikev-bg');
  const hero = el('img.ikev-hero', { alt: c.name, draggable: false });
  bgInto(bg, c);
  stickerInto(hero, c, { mode: 'img' });
  return el(`${onclick ? 'button' : 'div'}.ikev-banner.ik-mode${cls}`, { onclick }, [
    bg, el('span.ikev-shade'), hero,
    el('div.ikev-tx', [
      el('span.ikev-tag', { text: tag }),
      el('small.ikev-en', { text: en }),
      el('b.ikev-ttl', { text: title }),
      el('span.ikev-sub', { text: `― ${sub} ―` }),
      line,
      stars ? el('span.ikev-stars', [1, 2, 3, 4, 5].map((n) => el(`i${stars.includes(n) ? '.on' : ''}`, { text: '★' }))) : null,
    ]),
  ]);
}

/** ライバルレースのバナー。今日のウイコインと勝った☆を載せる。 */
function rivalBanner(app, onclick = null) {
  const rs = I.rivalState(app.ik, todayKey());
  return modeBanner({ art: RIVAL_ART, tag: 'DAILY', en: 'RIVAL RACE', title: 'ライバルレース', sub: '名馬に挑み、ウイコインを掴め', cls: '.ik-rvb', stars: rs.cleared,
    line: el('span.ikev-rw.ik-rvb-coin', [ic('wcoin', 16), el('span', { text: `今日 ${rs.got}/${I.RIVAL_DAILY} 枚（0:00 に戻る）` })]) }, onclick);
}

/** ランク戦・完成馬対決のバナーの絵（オルフェーヴル・ウオッカ）。 */
const NPC_ART = 'P1-17', OWN_ART = 'P4-02';
const winsOf = (p) => p.finished.reduce((a, h) => [a[0] + (h.battles ?? 0), a[1] + (h.battleWins ?? 0)], [0, 0]);
function npcBanner(app, onclick = null) {
  const L = I.ladderState(app.ik);
  return modeBanner({ art: NPC_ART, tag: 'RANK', en: 'RANK MATCH', title: 'ランク戦', sub: '勝って段位を上げ、殿堂を目指す',
    line: el('span.ikev-rw', [el(`i.ik-tier.t${L.tier}`, { text: L.name }), el('span', { text: L.next ? `${L.pts} 点　${L.next}まで あと ${L.toNext}` : `${L.pts} 点　最上位` })]) }, onclick);
}

/** 段位の札（段位・点・次の段位までの棒・昇格のウイコイン）。 */
function ladderCard(app) {
  const L = I.ladderState(app.ik);
  return card('段位', [
    el('div.ik-ladder', [
      el(`b.ik-tier.big.t${L.tier}`, { text: L.name }),
      el('div.ik-ladder-m', [
        el('span.ik-quest-bar', [el('i', { style: `width:${Math.round(L.frac * 100)}%` })]),
        el('small', { text: L.next ? `${L.pts} 点　次の「${L.next}」まで あと ${L.toNext} 点（初めて届くとウイコイン +${I.RANK_TIERS[L.tier + 1].coins}）` : `${L.pts} 点　最上位の段位` }),
      ]),
    ]),
    el('div.ik-tiers', I.RANK_TIERS.map((t, i) => el(`span.ik-tier.t${i}${i <= L.best ? '.reached' : ''}${i === L.tier ? '.now' : ''}`, { text: t.name }))),
    el('p.note', { text: `1 着 +${I.RANK_GAIN(1)}・2 着 +${I.RANK_GAIN(2)}・3 着 +${I.RANK_GAIN(3)}・6 着以下 ${I.RANK_GAIN(6)}（普通は勝ち ×${I.RANK_DIFF.normal.up}・負け ×${I.RANK_DIFF.normal.down}、強いは ×${I.RANK_DIFF.hard.up}・×${I.RANK_DIFF.hard.down}、伝説は ×${I.RANK_DIFF.legend.up}・×${I.RANK_DIFF.legend.down}）。点が下がると段位も下がる。昇格のウイコインは初めて届いたときだけ。` }),
  ]);
}
function ownBanner(app, onclick = null) {
  return modeBanner({ art: OWN_ART, tag: 'STABLE', en: 'STABLE MATCH', title: '完成馬対決', sub: '自分の完成馬どうしで最強を決める',
    line: el('span.ikev-rw', [el('i', { text: '2〜16頭' }), el('span', { text: `完成馬 ${app.ik.finished.length} 頭から選んで走らせる` })]) }, onclick);
}

/**
 * ライバルレースの特設ページ（イベントの画面と同じ並び）：バナー → 難易度（☆1〜☆5 と枚数）→ 舞台 → 出る馬（アイコン・並べ替え）→ 出走・スキップ。
 * 相手は名馬のカードを難易度の強さにした 9 頭（自分の馬に合わせない）。勝つとウイコイン（1 日 I.RIVAL_DAILY 枚まで、端末の 0:00 で戻る）。
 */
function rivalView(app, go) {
  const p = app.ik;
  const today = todayKey();
  const rs = I.rivalState(p, today);
  app.ikRival ??= {};
  const B = app.ikRival;
  B.star ??= Math.min(5, (rs.cleared.length ? Math.max(...rs.cleared) : 0) + 1);
  B.race ??= I.BATTLE_RACES[0].id;
  const best = [...p.finished].sort((a, b) => b.rating - a.rating)[0];
  if (best) B.horse = p.finished.some((h) => h.id === B.horse) ? B.horse : (app.ikBattle?.horse ?? best.id);
  if (!p.finished.some((h) => h.id === B.horse)) B.horse = best?.id;
  const race = () => I.BATTLE_RACES.find((r) => r.id === B.race) ?? I.BATTLE_RACES[0];
  const stars = el('div.ikev-diff', [1, 2, 3, 4, 5].map((n) => el(`button.ikev-star${B.star === n ? '.on' : ''}${rs.cleared.includes(n) ? '.done' : ''}`, {
    onclick: () => { B.star = n; go('rival'); },
  }, [el('b', { text: '☆'.repeat(n) }), el('small', { text: `${rs.cleared.includes(n) ? '勝利済み・' : ''}${I.RIVAL_COINS[n]} 枚` })])));
  const run = () => {
    const out = I.rivalRace(p, B.horse, B.race, B.star, today);
    save(app);
    const st = I.rivalState(p, today);
    app.ikRace = { race: out.result, looks: looksOf(out.field, p), mine: [100], order: out.order, back: 'rival',
      title: `ライバルレース ${out.race.name}（${'☆'.repeat(B.star)}）`, fired: out.fired, rival: { star: B.star, coins: out.coins, first: out.first, got: st.got }, fast: out.fast };
    sound.play(out.order === 1 ? 'bell' : out.order <= 3 ? 'win' : 'ok');
    go('result');
  };
  const why = I.canRivalSkip(p, B.star, today);
  const skip = () => {
    const n = I.rivalSkip(p, B.star, today);
    save(app);
    sound.play('win');
    toast(`スキップ：ウイコイン +${n}（今日 ${I.rivalState(p, today).got}/${I.RIVAL_DAILY}）`);
    go('rival');
  };
  // 出る馬を選び直したら、脚質の札と舞台への向きだけを描き直す
  const meBox = el('div.ik-rv-me');
  const drawMe = () => {
    const me = p.finished.find((h) => h.id === B.horse);
    if (!me) return meBox.replaceChildren();
    meBox.replaceChildren(
      styleSeg(I.horseRaceStyle(me), I.styleNameOf(me.style), (x) => { I.setHorseRaceStyle(me, x); save(app); }),
      el('p.note', { text: `${me.name}：${fitOf(me, race())}` }),
    );
  };
  drawMe();
  const raceSel = el('div.ik-rv-races', I.BATTLE_RACES.map((r) => el(`button.ik-hs${r.id === B.race ? '.on' : ''}`, {
    onclick: (e) => { B.race = r.id; for (const b of raceSel.children) b.classList.toggle('on', b === e.currentTarget); picker.replaceWith(picker = mkPicker()); drawMe(); },
  }, `${r.name} ${r.surface === '芝' ? '芝' : 'ダ'}${r.distance}`)));
  const mkPicker = () => horsePicker(app, B.horse, (h) => { B.horse = h.id; drawMe(); }, { race: race() });
  let picker = p.finished.length ? mkPicker() : null;
  const lv = (n) => '★'.repeat(Math.max(1, Math.min(5, Math.round((I.RIVAL_LEVEL[n] - 0.5) / 0.05))));
  return [
    rivalBanner(app),
    el('p.ikev-blurb', { text: `名馬のカードから選ばれた ${I.RIVAL_FIELD - 1} 頭のライバルが、難易度の強さで待ち構える（自分の馬には合わせない）。勝てばウイコイン。1 日 ${I.RIVAL_DAILY} 枚まで、端末の 0:00 に戻る。一度勝った☆はスキップで受け取れる。` }),
    card('難易度', [
      stars,
      el('div.ik-rv-head', [
        el('span.ik-rv-coin', [ic('wcoin', 18), el('b', { text: `今日 ${rs.got}/${I.RIVAL_DAILY}` }), el('small', { text: '0:00 に戻る' })]),
        el('span.ik-rv-bar', [el('i', { style: `width:${(rs.got / I.RIVAL_DAILY) * 100}%` })]),
      ]),
      table(['難易度', 'ライバルの強さ', 'ウイコイン', ''], [1, 2, 3, 4, 5].map((n) => [
        el(n === B.star ? 'b.mine' : 'span', { text: '☆'.repeat(n) }), el('span.ikev-lv', { text: lv(n) }), `${I.RIVAL_COINS[n]} 枚`, rs.cleared.includes(n) ? '勝利済み（スキップ可）' : '',
      ]), { cls: 'ik-tbl' }),
    ]),
    card('出る馬', p.finished.length ? [
      el('div.form', [el('label', ['舞台（GI）', raceSel])]),
      picker,
      meBox,
      el('div.ik-gbtns', [
        button(`${'☆'.repeat(B.star)} で出走する`, run, { cls: 'primary big' }),
        button(why && rs.cleared.includes(B.star) ? 'スキップ（受け取り済み）' : `スキップ（+${Math.min(I.RIVAL_COINS[B.star], rs.left)}）`, skip, { disabled: !!why, title: why ?? '' }),
      ]),
      !rs.left ? el('p.note', { text: '今日のウイコインは受け取り済み。走ることはできる（ウイコインは出ない）。' }) : null,
    ] : [el('p', { text: 'ライバルレースには完成馬が要る。' }), button('育成へ', () => go('run'), { cls: 'primary' })]),
  ];
}

/** 対戦の画面：イベント（横に送る）・ライバルレース・ランク戦・完成馬対決のバナーを並べ、押すとそれぞれの特設ページへ。 */
function battleView(app, go) {
  const p = app.ik;
  return [
    eventCarousel(app, go),
    rivalBanner(app, () => go('rival')),
    el('div.ik-modes', [npcBanner(app, () => go('npc')), ownBanner(app, () => go('own'))]),
    p.finished.length ? null : card('対戦', [el('p', { text: '対戦には完成馬が要る。' }), button('育成へ', () => go('run'), { cls: 'primary' })]),
  ];
}

/** 舞台（GI 10 戦）を札で選ぶ。選び直したら onPick（画面ごとは描き直さない）。 */
function raceChips(cur, onPick) {
  const box = el('div.ik-rv-races', I.BATTLE_RACES.map((r) => el(`button.ik-hs${r.id === cur ? '.on' : ''}`, {
    onclick: (e) => { for (const b of box.children) b.classList.toggle('on', b === e.currentTarget); onPick(r); },
  }, `${r.name} ${r.surface === '芝' ? '芝' : 'ダ'}${r.distance}`)));
  return box;
}

/** 対戦の状態（出る馬・舞台・難しさ・完成馬対決の顔ぶれ）。ページをまたいで覚える。 */
function battleState(app) {
  const p = app.ik;
  app.ikBattle ??= {};
  const B = app.ikBattle;
  const best = [...p.finished].sort((a, b) => b.rating - a.rating)[0];
  B.horse = p.finished.some((h) => h.id === B.horse) ? B.horse : best?.id;
  B.race ??= I.BATTLE_RACES[0].id;
  B.diff ??= 'normal';
  B.own = (B.own ?? []).filter((id) => p.finished.some((h) => h.id === id));
  return B;
}

/** 難しさの説明（ランク戦）。 */
const DIFF_NOTE = { normal: '自分の馬より一回り弱い相手。勝ちやすい', hard: '自分の馬とほぼ同じ強さ', legend: '自分の馬より強い相手。勝てたら本物' };

/** ランク戦の特設ページ：バナー → 相手の強さ → 出る馬（舞台・アイコン・脚質）→ 出走。 */
function npcView(app, go) {
  const p = app.ik;
  const B = battleState(app);
  if (!p.finished.length) return [npcBanner(app), card('ランク戦', [el('p', { text: 'ランク戦には完成馬が要る。' }), button('育成へ', () => go('run'), { cls: 'primary' })])];
  const race = () => I.BATTLE_RACES.find((r) => r.id === B.race) ?? I.BATTLE_RACES[0];
  const diffs = el('div.ikev-diff.ik-npc-diff', Object.entries(I.DIFFICULTY).map(([id, d]) => el(`button.ikev-star${B.diff === id ? '.on' : ''}`, {
    onclick: (e) => { B.diff = id; for (const b of diffs.children) b.classList.toggle('on', b === e.currentTarget); },
  }, [el('b', { text: d.name }), el('small', { text: DIFF_NOTE[id] ?? '' })])));
  const meBox = el('div.ik-rv-me');
  const drawMe = () => {
    const me = p.finished.find((h) => h.id === B.horse);
    meBox.replaceChildren(
      styleSeg(I.horseRaceStyle(me), I.styleNameOf(me.style), (x) => { I.setHorseRaceStyle(me, x); save(app); }),
      el('p.note', { text: `${me.name}：${fitOf(me, race())}　対戦 ${me.battles ?? 0} 戦 ${me.battleWins ?? 0} 勝` }),
    );
  };
  drawMe();
  const mkPicker = () => horsePicker(app, B.horse, (h) => { B.horse = h.id; drawMe(); }, { race: race() });
  let picker = mkPicker();
  const run = () => {
    const out = I.battleNpc(p, B.horse, B.race, B.diff);
    save(app);
    app.ikRace = { race: out.result, looks: looksOf(out.field, p), mine: [100], order: out.order, back: 'npc', title: `ランク戦 ${out.race.name}（${I.DIFFICULTY[B.diff].name}）`, fired: out.fired,
      rank: out.rank, fast: out.fast };
    sound.play(out.order === 1 ? 'bell' : out.order <= 3 ? 'win' : 'ok');
    go('result');
  };
  return [
    npcBanner(app),
    el('p.ikev-blurb', { text: '相手は全カードの名馬を「育て上げた姿」にした 11 頭（12 頭立て）。強さは自分の馬の能力に合わせ、難しさで上下する。舞台の馬場に向いた名馬が集まる。着順で段位の点が動く。' }),
    ladderCard(app),
    card('相手の強さ', [diffs]),
    card('出る馬', [
      el('div.form', [el('label', ['舞台（GI）', raceChips(B.race, (r) => { B.race = r.id; picker.replaceWith(picker = mkPicker()); drawMe(); })])]),
      picker,
      meBox,
      el('div.ik-gbtns', [button('出走する', run, { cls: 'primary big' })]),
    ]),
  ];
}

/** 完成馬対決の特設ページ：バナー → 舞台 → 出る馬（アイコンで何頭でも選ぶ）→ 走らせる。 */
function ownView(app, go) {
  const p = app.ik;
  const B = battleState(app);
  if (p.finished.length < 2) return [ownBanner(app), card('完成馬対決', [el('p', { text: `完成馬対決には完成馬が 2 頭以上要る（いま ${p.finished.length} 頭）。` }), button('育成へ', () => go('run'), { cls: 'primary' })])];
  const race = () => I.BATTLE_RACES.find((r) => r.id === B.race) ?? I.BATTLE_RACES[0];
  const count = el('p.ik-own-n');
  const runBtn = button('走らせる', () => {
    if (B.own.length < 2) return toast('2 頭以上を選ぶ', { bad: true });
    const out = I.battleOwn(p, B.own, B.race);
    save(app);
    app.ikRace = { race: out.result, looks: looksOf(out.field, p), mine: out.field.map((f) => f.id), back: 'own', title: `完成馬対決 ${out.race.name}`, fired: out.fired, fast: out.fast };
    sound.play('bell');
    go('result');
  }, { cls: 'primary big' });
  const drawCount = () => {
    count.textContent = `${B.own.length} 頭を選んだ（2〜16 頭）`;
    runBtn.disabled = B.own.length < 2 || B.own.length > 16;
  };
  drawCount();
  const mkPicker = () => horsePicker(app, B.own, (h, ids) => { B.own = ids; drawCount(); }, { race: race(), multi: true });
  let picker = mkPicker();
  const top = [...p.finished].sort((a, b) => b.rating - a.rating);
  return [
    ownBanner(app),
    el('p.ikev-blurb', { text: '自分の完成馬どうしを同じ舞台で走らせる。スキルは発動し、結果は対戦の成績に残る。' }),
    card('出る馬', [
      el('div.form', [el('label', ['舞台（GI）', raceChips(B.race, (r) => { B.race = r.id; picker.replaceWith(picker = mkPicker()); })])]),
      el('div.ik-gbtns.left', [
        button('上位 16 頭', () => { B.own = top.slice(0, 16).map((h) => h.id); picker.replaceWith(picker = mkPicker()); drawCount(); }),
        button('全部外す', () => { B.own = []; picker.replaceWith(picker = mkPicker()); drawCount(); }, { cls: 'ghost' }),
      ]),
      picker,
      count,
      el('div.ik-gbtns', [runBtn]),
    ]),
  ];
}
