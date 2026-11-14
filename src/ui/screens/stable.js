// 所有馬の一覧と、1 頭の詳細（能力・適性・血統表・戦績・調教）。

import { el, card, table, button, kv, bar, modal, toast, frameChip, tabs, ask, choose } from '../dom.js';
import * as G from '../../sim/game.js';
import { formatMoney, formatTime, formatSec, rankOf, rankYoung } from '../../core/util.js';
import { fitLabel, condLabel, MENUS } from '../../sim/training.js';
import { ABILITY_LABEL, ABILITIES, STYLES } from '../../sim/params.js';
import { horseImg } from '../horse-sprite.js';
import { icon } from '../icons.js';

/** 区分ごとのアイコン。 */
const CAT_ICON = { active: 'horse', mares: 'mare', stallions: 'star', young: 'sprout' };

/**
 * 所有馬。現役・繁殖牝馬・種牡馬・幼駒の 4 区分を切り替え、ミニアイコンの並びから
 * 1 頭を選んで詳細へ入る。区分は詳細へ持ち込み、左右のスワイプもその区分の中で送る。
 */
export function stableScreen(app) {
  const g = app.game;
  if (app.params.real) return previewDetail(app, app.params.real);
  if (app.params.id) return detail(app, app.params.id);

  const st = G.myStable(g);
  const cats = G.STABLE_CATEGORIES;
  // 開いた区分を覚えておく。空の区分を開いたままにしないよう、最初は馬の居る区分へ。
  let cat = app.params.cat ?? app.stableCat;
  if (!cats.some((c) => c.id === cat)) cat = cats.find((c) => st[c.id].length)?.id ?? 'active';
  app.stableCat = cat;
  const list = st[cat];
  const empty = {
    active: '現役の所有馬が居ない。当歳セール（8 月）や庭先取引（12 月）で買うか、配合で産ませる。',
    mares: '繁殖牝馬が居ない。牝馬を引退させると繁殖に上がる。',
    stallions: '種牡馬が居ない。重賞を勝った牡馬を引退させると種牡馬になれる（引退の確認に、引退後どうなるかが出る）。',
    young: '幼駒が居ない。5〜6 月に繁殖牝馬へ種付けすると翌年 4 月に生まれる。当歳セール（8 月）でも買える。',
  };

  return el('div.stbl', [
    el('nav.stbl-cats', cats.map((c) => el('button.stbl-cat', {
      class: c.id === cat ? 'on' : null,
      onclick: () => { app.stableCat = c.id; app.go('stable', { cat: c.id }, { replace: true }); },
    }, [
      el('span.sc-ico', icon(CAT_ICON[c.id], { size: 26 })),
      el('span.sc-name', { text: c.name }),
      el('b.sc-n', { text: String(st[c.id].length) }),
    ]))),
    list.length
      ? el('div.stbl-grid', list.map((h) => stableTile(app, h, cat)))
      : el('p.empty.stbl-empty', { text: empty[cat] }),
  ]);
}

/** 1 頭ぶんのミニアイコン。区分ごとに、選ぶ前に知りたいことだけを添える。 */
function stableTile(app, h, cat) {
  const g = app.game;
  const v = G.horseView(g, h.id);
  const tags = [];
  let sub = '';
  let mareKids = null;
  if (cat === 'active') {
    sub = `${h.sex}${v.age}　${v.className}`;
    tags.push(v.injury ? ['bad', v.injury.name] : v.stable === 'stable' ? ['on', '在厩'] : ['', '放牧']);
    if (v.stable === 'stable' && !v.injury) tags.push(['', fitLabel(v.fit)]);
    if (G.myEntries(g).some((e) => e.horseId === h.id)) tags.push(['go', '出走予定']);
  } else if (cat === 'mares') {
    const o = mareKids = G.offspringOf(g, h.id);
    sub = `${v.age}歳　産駒${o.all.length}頭`;
    const booked = G.myMatings(g).find((m) => m.damId === h.id);
    tags.push(v.pregnancy ? ['go', `受胎 ${v.pregnancy.sire}`]
      : booked ? ['on', `予約 ${booked.sire?.name ?? ''}`] : ['', '空胎']);
    // 産駒の立場（繁殖牝馬の価値は、走る仔と繁殖に上がった仔で決まる）
    if (o.active.length) tags.push(['on', `現役 ${o.active.length}`]);
    if (o.mares.length) tags.push(['', `繁殖 ${o.mares.length}`]);
    if (o.stallions.length) tags.push(['go', `種牡馬 ${o.stallions.length}`]);
  } else if (cat === 'stallions') {
    const o = G.offspringOf(g, h.id);
    sub = `${v.age}歳　産駒${o.all.length}頭`;
    tags.push(['', `種付料 ${formatMoney(v.studFee ?? 0)}`], ['on', `現役 ${o.active.length}`], ['go', `種牡馬 ${o.stallions.length}`]);
  } else {
    sub = `${h.sex}　${v.age === 0 ? '当歳' : '1歳'}`;
    tags.push(['', `父 ${v.sire}`], ['', `母 ${v.dam}`]);
  }
  return el('div.stile', {
    class: cat === 'active' && v.injury ? 'hurt' : null,
    tabIndex: 0,
    role: 'button',
    title: `${h.name}の詳細`,
    // 種牡馬は産駒（現役・種牡馬になった産駒）を見に開くことが多いので、「産駒」のタブから開く
    onclick: () => app.go('stable', { id: h.id, cat, ...(cat === 'stallions' ? { tab: 'foals' } : {}) }),
    onkeydown: (e) => { if (e.key === 'Enter') app.go('stable', { id: h.id, cat, ...(cat === 'stallions' ? { tab: 'foals' } : {}) }); },
  }, [
    el('div.st-pic', horseImg(h.coat, { size: v.age < 2 ? 'xs' : 'sm', age: v.age, title: h.coat })),
    el('div.st-body', [
      el('b.st-name', { text: h.name }),
      el('span.st-sub', { text: sub }),
      el('div.st-tags', tags.map(([c, t]) => el('i', { text: t, class: c || null }))),
    ]),
    // 繁殖牝馬は配合と、産駒の一覧（「繁殖牝馬からも産駒を見れるように」）。押した区分で詳細の「産駒」タブを開く
    cat === 'mares' ? el('div.st-btns', [
      button('配合', (e) => { e.stopPropagation(); app.go('farm', { damId: h.id }); }, { cls: 'sm' }),
      button('現役産駒', (e) => { e.stopPropagation(); app.go('stable', { id: h.id, cat, tab: 'foals', ff: 'active' }); }, { cls: 'sm', disabled: !mareKids?.active.length }),
      button('産駒すべて', (e) => { e.stopPropagation(); app.go('stable', { id: h.id, cat, tab: 'foals', ff: 'all' }); }, { cls: 'sm', disabled: !mareKids?.all.length }),
    ]) : null,
    cat === 'stallions' ? el('div.st-btns', [
      button('現役産駒', (e) => { e.stopPropagation(); app.go('stable', { id: h.id, cat, tab: 'foals', ff: 'active' }); }, { cls: 'sm' }),
      button('種牡馬の産駒', (e) => { e.stopPropagation(); app.go('stable', { id: h.id, cat, tab: 'foals', ff: 'stallions' }); }, { cls: 'sm' }),
    ]) : null,
  ]);
}

/**
 * 詳細の上に出す、同じ区分の馬のミニアイコンの帯。
 * スワイプで 1 頭ずつ送るより、何頭も居るときは直接選べるほうが早い。
 */
function stableRail(app, cat, currentId) {
  const g = app.game;
  const st = G.myStable(g);
  const pick = (id, c) => app.go('stable', { id, cat: c }, { replace: true });
  const rail = el('div.hd-rail', [
    el('div.rail-cats', G.STABLE_CATEGORIES.map((c) => el('button', {
      class: c.id === cat ? 'on' : null,
      disabled: !st[c.id].length,
      title: c.name,
      onclick: () => { if (st[c.id][0] && c.id !== cat) pick(st[c.id][0].id, c.id); },
    }, [icon(CAT_ICON[c.id], { size: 16 }), el('span', { text: c.name }), el('b', { text: String(st[c.id].length) })]))),
    el('div.rail-icons', (st[cat] ?? []).map((h) => el('button.rail-h', {
      class: h.id === currentId ? 'on' : null,
      title: h.name,
      onclick: () => { if (h.id !== currentId) pick(h.id, cat); },
    }, [horseImg(h.coat, { size: 'xs', age: g.world.year - h.birthYear }), el('span', { text: h.name })]))),
  ]);
  // いま見ている馬が帯の外に隠れないよう、横にだけ寄せる。
  requestAnimationFrame(() => {
    const on = rail.querySelector('.rail-h.on');
    const box = rail.querySelector('.rail-icons');
    if (on && box) box.scrollLeft = on.offsetLeft - box.clientWidth / 2 + on.clientWidth / 2;
  });
  return rail;
}

// ---------------------------------------------------------------- 詳細
//
// 馬を主役にした 1 枚。背景の放牧地を「見せ場」に切り替えて、その馬を鞍付きで
// 大きく立たせ（app.js の syncBackdrop）、左に戦績の要約、右に状態、
// 下の帯でタブを切り替える。左右のスワイプ（と ← → キー）で次の馬へ送る。

const TABS = [
  { id: 'info', name: '詳細' },
  { id: 'record', name: '成績' },
  { id: 'ped', name: '血統' },
  { id: 'abil', name: '能力' },
  { id: 'train', name: '調教', mineOnly: true },
  { id: 'foals', name: '産駒', needFoals: true },
];

/**
 * 世界に居ない実在馬（名鑑から開く）。仮の世界の馬を、ふつうの馬の詳細と同じ画面で見せる。
 * 画面の中の G.* の呼び出しが仮の世界を見るよう、game だけを差し替えた app を渡す（書き込みは本物の app へ）。
 */
function previewDetail(app, name) {
  const r = G.realPreview(app.game, name);
  if (!r) return el('p.empty', { text: '馬が見つからない' });
  if (!r.phantom) return detail(app, r.id);
  const papp = new Proxy(app, {
    get: (t, k) => (k === 'game' ? r.game : t[k]),
    set: (t, k, val) => { t[k] = val; return true; },
  });
  return detail(papp, r.id);
}

function detail(app, id) {
  const g = app.game;
  const v = G.horseView(g, id);
  if (!v) return el('p.empty', { text: '馬が見つからない' });
  const h = v.horse;
  const mine = v.isMine;
  // 出走・調教・放牧を持つのは 2 歳以上の現役馬だけ。幼駒はまだ厩舎に入っていない。
  const active = mine && !v.retired && !v.dead && v.age >= 2 && !v.broodmare && !v.stallion;
  const cat = mine ? (app.params.cat ?? G.stableCategoryOf(g, id)) : null;
  const career = G.horseCareer(g, id);
  const t = G.now(g);

  // 左右に送れる並び。自分の馬なら同じ区分の中、他人の馬なら呼び出し元が渡した並び。
  // 呼び出し元が並びを渡したらそれを優先する（着順・名鑑・種牡馬名簿など、どこから開いても送れる）。
  const given = app.params.list;
  const lineup = given?.includes(id) ? given : mine ? G.myLineup(g, cat) : [];
  const at = lineup.indexOf(id);
  const go = (d) => {
    if (lineup.length < 2 || at < 0) return;
    const next = lineup[(at + d + lineup.length) % lineup.length];
    // 送るたびに履歴を積むと「戻る」が馬の数だけ必要になるので、差し替える。
    // 決めて開いたタブ（tab・ff）は持ち越さない（送るたびに「産駒」へ戻されないように。いま見ているタブのまま送る）
    const { tab: _t, ff: _f, ...rest } = app.params;
    app.go('stable', { ...rest, id: next, dir: d, cat }, { replace: true });
  };
  app.onArrow = go;

  // 産駒のタブは種牡馬・繁殖牝馬にも出す（覚えている産駒は直近 80 頭だけなので、0 でも世界には産駒が居ることがある）。
  // 現役やこれから生まれる実在馬も、表に史実の仔が居れば出す（「これから」の区分）
  const tabs = TABS.filter((x) => (!x.mineOnly || active) && (!x.needFoals || v.foals.length || v.stallion || v.broodmare || v.dead || v.retired
    || G.realFutureOffspring(app.game, v.horse.id).length));
  // 呼び出し元がタブを決めて開くことがある（所有馬の種牡馬は「産駒」の現役から開く）
  // 開いたときに 1 度だけ当てる（同じ画面の描き直しでは、あとで押したタブを戻さない）
  if (app.params.tab && !OPENED.has(app.params) && tabs.some((x) => x.id === app.params.tab)) {
    app.detailTab = app.params.tab;
    if (app.params.ff) app.foalsFilter = app.params.ff;
  }
  OPENED.add(app.params);
  if (!tabs.some((x) => x.id === app.detailTab)) app.detailTab = 'info';
  const body = el('div.hd-body');
  const tabBar = el('nav.hd-tabs');
  const showTab = (tid) => {
    app.detailTab = tid;
    tabBar.textContent = '';
    for (const x of tabs) {
      tabBar.appendChild(el('button', { text: x.name, class: x.id === tid ? 'on' : null, onclick: () => showTab(x.id) }));
    }
    body.textContent = '';
    body.appendChild(tabContent(app, tid, v, career));
    body.scrollTop = 0;
  };
  showTab(app.detailTab);

  const stage = el('div.hd-stage', { class: app.params.dir ? (app.params.dir > 0 ? 'in-r' : 'in-l') : null }, [
    infoPanel(v, career),
    // 産駒の数は世界から数える（種牡馬は直近 80 頭しか覚えないので、輪の数が産駒のタブの表と食い違った）
    statePanel(v, v.stallion || v.broodmare || v.dead || v.retired ? G.offspringOf(g, id).all : null),
    lineup.length > 1 && at >= 0 ? el('div.hd-swipe', { text: '左右にスワイプで次の馬' }) : null,
    // 背景の 3D を顔のアップに切り替える（顔の作り・白斑・無口を近くで見られるように）。
    el('button.hd-face', {
      text: app.portraitView === 'face' ? '全身を見る' : '顔を見る',
      onpointerdown: (e) => e.stopPropagation(),
      onclick: (e) => {
        e.stopPropagation();
        app.portraitView = app.portraitView === 'face' ? 'body' : 'face';
        app.pasture?.setPortraitView(app.portraitView);
        e.currentTarget.textContent = app.portraitView === 'face' ? '全身を見る' : '顔を見る';
      },
    }),
  ]);
  swipe(stage, go);

  return el('div.hd', { class: cat ? 'has-rail' : null }, [
    el('header.hd-top', [
      el('span.hd-silk', horseImg(h.coat, { size: 'xs', age: v.age })),
      el('h1', { text: v.name }),
      el('span.hd-sa', { text: v.preview ? `${h.sex}　${h.coat}　${h.birthYear}年生` : `${h.sex}${v.age}　${h.coat}` }),
      el('div.hd-pills', [
        el('span', { text: standing(v), class: mine ? 'on' : null }),
        active ? el('span', {
          text: v.injury ? `${v.injury.name} 残${v.injury.weeks}週` : v.stable === 'stable' ? '在厩' : '放牧',
          class: v.injury ? 'bad' : null,
        }) : null,
        v.inbreed.length ? el('span', { text: `インブリード ${v.inbreed.length}` }) : null,
        v.real ? el('span.real', { text: '実在' }) : null,
        v.preview ? el('span', { text: `この世界：${v.preview}` }) : null,
      ]),
    ]),
    cat ? stableRail(app, cat, id) : null,
    stage,
    el('div.hd-band', [
      el('span.hd-date', { text: `${t.year}年 ${t.label}` }),
      tabBar,
    ]),
    body,
    el('footer.hd-foot', [
      el('div.hd-nav', lineup.length > 1 && at >= 0 ? [
        el('button.hd-arrow', { onclick: () => go(-1), title: '前の馬（←）' }, icon('back', { size: 20 })),
        el('span.hd-count', { text: `${at + 1} / ${lineup.length}` }),
        el('button.hd-arrow.r', { onclick: () => go(1), title: '次の馬（→）' }, icon('back', { size: 20 })),
        mine ? button('所有馬一覧', () => app.go('stable', { cat }), { cls: 'sm' }) : null,
      ] : []),
      el('div.hd-acts', actions(app, v, active)),
      el('button.hd-back', { onclick: () => app.back(), title: '戻る' }, [icon('back', { size: 22 }), el('span', { text: '戻る' })]),
    ]),
  ]);
}

/** 左右のスワイプ。縦の動き（本文の巻き取り）と取り違えないよう、横に大きく動いたときだけ。 */
function swipe(node, go) {
  let x0 = null, y0 = 0;
  node.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    x0 = e.clientX; y0 = e.clientY;
  });
  const end = (e) => {
    if (x0 == null) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    x0 = null;
    // 左へ払ったら次の馬（右から次が来る）。
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  };
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', () => { x0 = null; });
}

const MARK = (x) => (x > 0.82 ? '◎' : x > 0.66 ? '○' : x > 0.5 ? '△' : '×');
const markCls = (x) => (x > 0.82 ? 'm-a' : x > 0.66 ? 'm-b' : x > 0.5 ? 'm-c' : 'm-d');
const round100 = (m) => Math.round(m / 100) * 100;

/** 左：称号と戦績の要約、路線、適性。 */
function infoPanel(v, career) {
  const lo = Math.max(1000, round100(v.dist - v.distRange));
  const hi = Math.min(3600, round100(v.dist + v.distRange));
  const g1 = career.counts.GI[0];
  const ribbon = v.real ? (g1 ? `GI ${g1}勝の${v.sex === '牝' ? '名牝' : '名馬'}` : v.stallion ? '実在の種牡馬' : '実在の名血')
    : v.titles.length ? v.titles[v.titles.length - 1]
    : v.wins > 0 ? `${v.className}の${v.style}馬` : v.age < 2 ? '期待の若駒' : 'デビューを待つ素質馬';
  const avg = ABILITIES.reduce((a, k) => a + v.values[k], 0) / ABILITIES.length;
  const row = (k, val) => el('div.hi-r', [el('span', { text: k }), el('b', val)]);
  return el('section.hd-info', [
    el('div.hi-crest', [
      laurel('l'),
      el('div.hi-crest-b', [
        el('div.hi-ribbon', { text: ribbon }),
        row('クラス', v.preview ? '史実の成績' : v.age < 2 ? 'デビュー前' : v.className),
        row('戦績', `${v.starts}戦${v.wins}勝`),
        row('獲得賞金', formatMoney(v.earnings)),
      ]),
      laurel('r'),
    ]),
    el('div.hi-rows', [
      row('路線', career.route),
      row('次走', career.next ? [career.next.grade ? el('span.gchip', { text: career.next.grade, class: career.next.grade === 'GI' ? 'g1' : null }) : null, ` ${career.next.label} ${career.next.name}`] : '未定'),
    ]),
    el('div.hi-rows', [
      el('div.hi-r.big', [el('span', { text: '距離適性' }), el('b', [el('em', { text: `${lo}m` }), ' 〜 ', el('em', { text: `${hi}m` })])]),
      el('div.hi-r', [el('span', { text: '馬場適性' }), el('div.hi-chips', [
        el('i', { text: `芝${MARK(v.turf)}`, class: `turf ${markCls(v.turf)}` }),
        el('i', { text: `ダ${MARK(v.dirt)}`, class: `dirt ${markCls(v.dirt)}` }),
        el('i', { text: `良${MARK(v.firm)}`, class: `firm ${markCls(v.firm)}` }),
        el('i', { text: `重${MARK(v.soft)}`, class: `soft ${markCls(v.soft)}` }),
      ])]),
      el('div.hi-r', [el('span', { text: '脚質' }), el('div.hi-style', STYLES.map((s) => el('i', {
        text: s[0], class: s === v.style ? 'on' : null,
      })))]),
      el('div.hi-r', [el('span', { text: '成長型' }), el('b', v.growth),
        el('div.hi-grade', [el('span', { text: '総合' }), el('b', { text: rankOf(avg) })])]),
      v.factors.length || v.lineHead || v.abroadStud
        ? el('div.hi-r', [el('span', { text: '因子' }), el('div.hi-chips', [
          ...v.factors.map((f) => el('i.fchip', { text: f })),
          v.lineHead ? el('i.fchip.line', { text: v.lineEstablished ? `${v.lineEstablished}年 系統確立` : '系祖' }) : null,
          v.abroadStud ? el('i.fchip.abroad', { text: '海外で供用中' }) : null,
        ])])
        : null,
      v.theories?.length
        ? el('div.hi-r', [el('span', { text: '配合理論' }), el('div.hi-chips', v.theories.map((t) => el('i.tchip', { text: t })))])
        : null,
    ]),
  ]);
}

/** 付けている馬具の札（メンコとシャドーロールは色の点つき）。 */
function gearChips(gear) {
  return G.GEAR_KEYS.filter((k) => gear?.[k]).map((k) => el('i.gearchip', { title: G.GEAR[k].desc }, [
    typeof gear[k] === 'string' ? el('span.gdot', { style: `background:${gear[k]}` }) : null, G.GEAR[k].name,
  ]));
}

/**
 * 馬具を付け替える（自分の現役馬）。効き目は気性の悪い馬ほど大きい（sim/gear.js）。
 * メンコとシャドーロールは色を選べる。決めると、その馬は次のレースからこの馬具で走る。
 */
function gearModal(app, v) {
  const g = app.game;
  const cur = { ...(v.gear ?? {}) };
  let m = null;
  const body = el('div.gearm');
  const draw = () => {
    const adv = G.gearAdvice(g, v.id);
    body.replaceChildren(
      el('p.note', { text: `気性 ${Math.round((adv?.temper ?? 0.5) * 100)}（低いほど馬具が効く）。付けた馬具はレースの 3D にも出る。` }),
      ...G.GEAR_KEYS.map((k) => {
        const on = !!cur[k];
        const colored = k === 'menko' || k === 'shadowRoll';
        return el(`div.gear-row${on ? '.on' : ''}`, [
          el('button.gear-tog', {
            onclick: () => {
              if (on) delete cur[k];
              else {
                cur[k] = colored ? (k === 'shadowRoll' ? G.GEAR_COLORS[0] : G.GEAR_COLORS[1]) : true;
                if (k === 'blinker') delete cur.cheek;
                if (k === 'cheek') delete cur.blinker;
              }
              draw();
            },
          }, [el('b', { text: G.GEAR[k].name }), el('small', { text: G.GEAR[k].desc })]),
          colored && on ? el('div.gear-colors', G.GEAR_COLORS.map((c) => el(`button.gear-c${cur[k] === c ? '.on' : ''}`, {
            style: `background:${c}`, title: c, onclick: () => { cur[k] = c; draw(); },
          }))) : null,
        ]);
      }),
      el('div.gear-acts', [
        button('決める', () => {
          const r = G.setHorseGear(g, v.id, cur);
          if (!r.ok) return toast(r.msg, { bad: true });
          toast(`${v.name}の馬具：${G.gearNames(r.gear).join('・') || 'なし'}`);
          m?.close();
          app.render();
        }, { cls: 'primary' }),
        button('やめる', () => m?.close()),
      ]),
    );
  };
  draw();
  m = modal(`${v.name}の馬具`, [body]);
}

/** 月桂冠。弧に沿って葉を並べた SVG（記号の文字は使わない）。右側は左右反転で作る。 */
function laurel(side) {
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const th = (118 + i * 21) * Math.PI / 180;
    pts.push([30 + 22 * Math.cos(th), 42 + 34 * Math.sin(th), th]);
  }
  const stem = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const leaves = pts.slice(0, 6).map(([x, y, th]) => {
    // 葉は弧の接線から少し外へ開く。
    const deg = (th * 180 / Math.PI + 90 + 35).toFixed(0);
    return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="6.5" ry="2.8" transform="rotate(${deg} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  }).join('');
  const span = document.createElement('span');
  span.className = `hi-laurel ${side}`;
  span.innerHTML = `<svg viewBox="0 0 34 84" width="24" height="72" aria-hidden="true"><path d="${stem}" fill="none" stroke="currentColor" stroke-width="1.8"/><g fill="currentColor">${leaves}</g></svg>`;
  return span;
}

/**
 * 右：輪のゲージと状態、個性。
 * 現役の馬は仕上がり、繁殖に上がった馬は産駒の数を輪にする
 * （引退した馬に仕上がり 20% と出しても意味が無い）。
 */
function statePanel(v, offspring = null) {
  const young = !v.dead && !v.retired && v.age < 2;
  const racing = !v.dead && !v.retired && !v.broodmare && !v.stallion && !young;
  const fit = Math.max(0, Math.min(1, v.fit ?? 0));
  const foals = offspring ?? v.foals ?? [];
  const nf = foals.length;
  // 幼駒は仕上がりも産駒も無いので、育成の進み具合（2 歳の物差しで見た能力の平均）を輪にする。
  // 潜在値は見せない（生まれたては潜在の 2 割ほどなので低く出る。1 歳の 1 年で育つ）。
  const avg = ABILITIES.reduce((a, k) => a + v.values[k], 0) / ABILITIES.length;
  const ratio = racing ? fit : young ? avg : Math.min(1, nf / 12);
  const R = 40, C = 2 * Math.PI * R;
  const ring = document.createElement('div');
  ring.className = 'hs-ring';
  ring.innerHTML = `<svg viewBox="0 0 100 100" width="104" height="104" aria-hidden="true">
    <circle cx="50" cy="50" r="${R}" fill="#ffffffd8" stroke="#00000014" stroke-width="9"/>
    <circle cx="50" cy="50" r="${R}" fill="none" stroke="url(#hsg)" stroke-width="9" stroke-linecap="round"
      stroke-dasharray="${(C * ratio).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 50 50)"/>
    <defs><linearGradient id="hsg" x1="0" x2="1"><stop offset="0" stop-color="#8fd86a"/><stop offset="1" stop-color="#2f8a35"/></linearGradient></defs>
  </svg>`;
  ring.appendChild(el('div.hs-ring-t', racing
    ? [el('span', { text: '仕上がり' }), el('b', { text: `${Math.round(fit * 100)}` }), el('small', { text: '%' })]
    : young ? [el('span', { text: '育成' }), el('b', { text: rankYoung(avg) })]
      : [el('span', { text: '産駒' }), el('b', { text: String(nf) }), el('small', { text: '頭' })]));
  const fat = v.fatigue ?? 0;
  const fatMark = fat < 0.2 ? '◎' : fat < 0.4 ? '○' : fat < 0.6 ? '△' : '▲';
  const r = (k, val, cls = null) => el('div.hs-r', [el('span', { text: k }), el('b', { text: val, class: cls })]);
  const rows = young ? [
    r('年齢', v.age === 0 ? '当歳' : '1歳'),
    r('デビュー', v.age === 0 ? '再来年' : '来年'),
    r('成長型', v.growth),
  ] : racing ? [
    r('調子', v.condLabel),
    r('疲労', fatMark, fat >= 0.6 ? 'bad' : null),
    r('状態', v.injury ? v.injury.name : v.stable === 'stable' ? '在厩' : '放牧', v.injury ? 'bad' : null),
  ] : v.preview ? [
    r('いま', v.preview),
    r('史実', `${v.starts}戦${v.wins}勝`),
    r('区分', v.stallion ? '種牡馬' : v.broodmare ? '繁殖牝馬' : '競走馬'),
  ] : [
    r('年齢', `${v.age}歳`),
    v.pregnancy ? r('受胎', `${v.pregnancy.sire}（${v.pregnancy.year}年4月）`)
      : r('産駒の勝利', `${foals.reduce((a, f) => a + f.wins, 0)}勝`),
    v.stallion && !v.dead ? r('種付料', formatMoney(v.studFee ?? 0)) : r('立場', v.dead ? '故' : v.broodmare ? '繁殖牝馬' : abroadRacing(v) ? '海外で現役' : '引退'),
  ];
  return el('section.hd-state', [
    ring,
    el('div.hs-rows', rows),
    el('div.hs-traits', [
      el('h4', { text: '個性' }),
      el('div', personality(v).map(([txt, cls]) => el('i', { text: txt, class: cls }))),
    ]),
  ]);
}

/** 能力の裏にある性格を、短い札にする。良いものは青、気をつけるものは赤。 */
function personality(v) {
  const out = [];
  if (v.temper > 0.78) out.push(['素直', 'good']);
  else if (v.temper < 0.38) out.push(['気難しい', 'bad']);
  else if (v.temper < 0.58) out.push(['ムラっ気', 'bad']);
  if (v.sound > 0.78) out.push(['丈夫', 'good']);
  else if (v.sound < 0.42) out.push(['脚元に不安', 'bad']);
  if (v.spirit > 0.78) out.push(['勝負根性', 'good']);
  else if (v.spirit < 0.42) out.push(['詰め甘い', 'bad']);
  if (v.growth && v.growth !== '普通') out.push([v.growth, 'neutral']);
  if (out.length === 0) out.push(['堅実', 'neutral']);
  return out.slice(0, 4);
}

/** 下の帯の操作。自分の現役馬だけが出走・調教・放牧を持つ。 */
function actions(app, v, active) {
  const g = app.game;
  const id = v.id;
  if (active) {
    return [
      button('出走登録', () => entryModal(app, id), { cls: 'primary', disabled: !v.ready.ok, title: v.ready.ok ? '' : v.ready.why }),
      button('調教', () => { app.detailTab = 'train'; app.render(); }),
      button('騎手', () => pickJockey(app, id)),
      v.stable === 'stable'
        ? button('放牧に出す', () => { G.setStable(g, id, 'pasture'); app.render(); })
        : button('入厩させる', () => {
          if (!G.setStable(g, id, 'stable')) return toast('いま入厩できない', { bad: true });
          app.render();
          return undefined;
        }, { disabled: !!v.injury }),
      button('引退', async () => {
        // 引退した後どうなるかを先に見せる（種牡馬になれない馬を、なれると思って引退させないように）。
        // 種牡馬・繁殖に上がる馬（実在馬は必ず上がる）は、上げない選択もできる。
        const out = G.retireOutcome(g, id);
        if (out === 'none') {
          if (!await ask(`${v.name} を引退させる？\n引退後は繁殖には上がらない（乗馬・用途変更）。`, { ok: '引退させる' })) return;
          G.retire(g, id);
          toast(`${v.name} を引退させた`);
        } else {
          const up = out === 'stallion' ? '種牡馬' : '繁殖牝馬';
          const pick = await choose(`${v.name} を引退させる？\n引退後は${up}になる${v.real ? '（実在の馬は史実どおり繁殖に上がる）' : ''}。`, [
            { label: `${up}にしない`, value: 'no', cls: 'ghost' },
            { label: `${up}にする`, value: 'yes' },
          ]);
          if (!pick) return;
          G.retire(g, id, { breed: pick === 'yes' });
          toast(pick === 'yes' ? `${v.name} は引退して${up}になった` : `${v.name} を引退させた（${up}にはしない）`);
        }
        app.go('stable');
      }, { cls: 'ghost' }),
    ];
  }
  // 幼駒はいつでも売れる（セールを待たない）。値段は血統だけで決まる。
  const quote = v.isMine ? G.youngsterQuote(g, id) : null;
  if (quote != null) {
    return [button(`売却する（${formatMoney(quote)}）`, async () => {
      if (!await ask(`${v.name} を ${formatMoney(quote)} で売る？\n売った馬はほかの牧場の馬になる。`, { ok: '売る' })) return;
      const r = G.sellYoungster(g, id);
      if (!r.ok) { toast(r.why, { bad: true }); return; }
      toast(`${v.name} を ${formatMoney(r.price)} で売った`);
      app.go('stable', { cat: 'young' });
    }, { cls: 'ghost' })];
  }
  if (v.isMine && v.broodmare && !v.dead) {
    return [button('配合する', () => app.go('farm', { damId: id }), { cls: 'primary' })];
  }
  return [];
}

/** タブの中身。 */
function tabContent(app, tid, v, career) {
  const g = app.game;
  const id = v.id;
  const h = v.horse;
  if (tid === 'record') {
    return el('div', [
      v.record.length ? table(
        ['年', 'レース', '場', '距離', '馬場', '人気', '着', '騎手', '斤量', '時計', '上3F', '通過', '賞金'],
        v.record.map((r) => [
          r.year, el('span', { text: r.name, class: r.grade ? 'grade' : null }),
          courseShort(g, r.courseId),
          // ゲーム開始前の戦績は「走った事実」しか持っていない（world.js の paperCareer）
          r.past ? '—' : `${r.surface}${r.distance}`,
          r.ground ?? '—', r.popularity ? `${r.popularity}人` : '—',
          el('b', { text: `${r.order}/${r.field}`, class: r.order === 1 ? 'win' : null }),
          r.jockeyName ?? '—', r.weight ?? '—',
          formatTime(r.time), formatSec(r.last3f),
          (r.passing ?? []).join('-'),
          r.prize ? formatMoney(r.prize) : '—',
        ]),
        { align: ['c', , 'c', 'c', 'c', 'c', 'c', , 'c', 'c', 'c', 'c', 'r'] },
      ) : el('p.empty', { text: 'まだ出走していない。' }),
      v.record.some((r) => r.comment) ? el('div.hd-sub', [
        el('h4', { text: 'レース回顧' }),
        el('ul.comments', v.record.filter((r) => r.comment).slice(0, 8).map((r) =>
          el('li', [el('b', { text: `${r.name} ${r.order}着　` }), r.comment]))),
      ]) : null,
    ]);
  }
  if (tid === 'ped') {
    return el('div', [
      pedigreeTable(g, id),
      v.inbreed.length ? el('div.hd-sub', [el('h4', { text: 'インブリード' }),
        el('ul.inb', v.inbreed.map((x) => el('li', { text: x })))]) : null,
    ]);
  }
  if (tid === 'abil') {
    // 実在馬は「この世界のいま」と「史実の表（盛りの姿）」を切り替えて見られる（自分の馬でも表の値を見たい）。
    // 名鑑から開いた世界に居ない馬（preview）は、もともと表の値なので切り替えは出さない。
    const tv = v.real && !v.preview && app.abilView === 'table' ? G.realTableView(g, v.horse.id) : null;
    const sv = tv ?? v;
    const abilSwitch = v.real && !v.preview ? el('div.offf.abil-sw', [
      ['now', 'この世界のいま'], ['table', '史実の表（盛り）'],
    ].map(([k, label]) => el('button', {
      class: (tv ? 'table' : 'now') === k ? 'on' : null,
      // 画面ごと描き直すとタブの欄（.hd-body）が頭へ戻る。このタブの中身だけ差し替えて、スクロールの位置を残す。
      onclick: (e) => {
        app.abilView = k;
        const box = e.currentTarget.closest('.hd-body');
        if (!box) { app.render(); return; }
        // スクロールする箱は画面の幅で違う（PC はタブの欄、スマホは本文の .main）。祖先をすべて覚えて戻す。
        // 中身の高さも前のまま保つ（史実の表は短いので、縮むとスクロールが詰まって上へ跳んだ）。
        const boxes = [];
        for (let n = box; n; n = n.parentElement) if (n.scrollTop) boxes.push([n, n.scrollTop]);
        const wy = window.scrollY;
        const minH = Math.max(box.firstElementChild?.offsetHeight ?? 0, parseFloat(box.firstElementChild?.style.minHeight) || 0);
        box.textContent = '';
        const next = tabContent(app, 'abil', v, career);
        if (minH) next.style.minHeight = `${minH}px`;
        box.appendChild(next);
        for (const [n, t] of boxes) n.scrollTop = t;
        window.scrollTo(0, wy);
      },
    }, el('span', { text: label })))) : null;
    // 史実の表：サイト（アホヌラゲーム館）の表示そのまま。字はサイトの 16 段（S+〜G）で、ゲームの評価の字（9 段）とは物差しが違う。
    if (tv?.site) {
      const st = tv.site;
      const cols = ['スピ', 'スタ', '瞬発', '根性', 'パワ', '柔軟', '健康', '精神', '賢さ', '計', '芝', 'ダ', '成長型', '成長力', '脚質'];
      return el('div', [abilSwitch,
        el('div.site-wrap', el('table.site-tbl', [
          el('thead', el('tr', cols.map((k) => el('th', { text: k })))),
          el('tbody', el('tr', cols.map((k) => el('td', { text: st[k] || '—', class: /^[SABCDEFG]\+?$/.test(st[k]) ? `g-${st[k][0]}` : null })))),
        ])),
        el('div.hd-cols', [
          el('div', [
            el('h4', { text: '馬場' }),
            el('div.apt-surf', [bar(sv.turf, { label: '芝' }), bar(sv.dirt, { label: 'ダート' }), bar(sv.firm, { label: '良' }), bar(sv.soft, { label: '重' })]),
          ]),
          el('div', [el('h4', { text: `距離（最適 ${sv.dist}m）` }), distChart(tv.game, tv.horse)]),
        ]),
      ]);
    }
    return el('div', [abilSwitch, el('div.hd-cols', [
      el('div', [
        el('h4', { text: '能力' }),
        el('div.abil', [
          ...ABILITIES.map((a) => el('div.abil-row', [
            el('span.abil-l', { text: ABILITY_LABEL[a] }),
            el('span.abil-r', { text: sv.ranks[a] }),
            bar(sv.values[a]),
            // 表の値は史実馬の一覧（アホヌラゲーム館）の数値（÷100 で持っている）。スタミナは一覧に無く距離から導く。
            tv ? el('span.abil-n', { text: a === 'stamina' ? '—' : String(Math.round(sv.values[a] * 100)) }) : null,
          ])),
          // サイトにある残りの能力（瞬発・柔軟・健康・精神）。調教で伸びない馬の性質なので、いまの評価も同じ値。
          ...[['瞬発', sv.extra?.kick], ['柔軟', sv.extra?.flex], ['健康', sv.extra?.sound], ['精神', sv.extra?.spirit]]
            .filter(([, x]) => x != null).map(([l, x]) => el('div.abil-row.sub', [
              el('span.abil-l', { text: l }), el('span.abil-r', { text: rankOf(x) }), bar(x),
              tv ? el('span.abil-n', { text: String(Math.round(x * 100)) }) : null,
            ])),
        ]),
        tv ? null : el('p.note', {
          text: v.age != null && v.age < 2
            ? '評価は 2 歳の物差しで見た、いまの育ち具合。潜在能力は見えない。当歳は生まれたてで低く、1 歳の 1 年の育成で育つ（育成牧場で速まる）。2 歳からは調教と出走で近づく。'
            : '評価は「いま出せる力」。潜在能力は見えない。調教と出走で近づく。',
        }),
      ]),
      el('div', [
        el('h4', { text: '馬場' }),
        el('div.apt-surf', [
          bar(sv.turf, { label: '芝' }), bar(sv.dirt, { label: 'ダート' }),
          bar(sv.firm, { label: '良' }), bar(sv.soft, { label: '重' }),
        ]),
        el('h4', { text: `距離（最適 ${sv.dist}m）` }),
        tv ? distChart(tv.game, tv.horse) : distChart(g, h),
      ]),
    ])]);
  }
  if (tid === 'train') {
    // 2 歳の未出走馬は、入厩から新馬戦までを任せられる（落とし穴 135）。走った後は自動が終わり、手で選ぶ。
    const auto = !!v.autoDebut;
    const canAuto = v.isMine && v.age === 2 && (v.starts ?? 0) === 0;
    const autoBar = canAuto ? el('div.autodebut', [
      el('div', [
        el('b', { text: '自動調教（新馬戦まで）' }),
        el('span', { text: auto
          ? '入厩させ、仕上がりと疲れを見て調教し、新馬戦に登録する。走ると自動は終わる。'
          : '入厩から新馬戦の登録まで、調教を任せる。手で選ぶのは走った後から。' }),
      ]),
      button(auto ? '自動をやめる' : '自動にする', () => { G.setAutoDebut(g, id, !auto); app.render(); },
        { cls: auto ? 'ghost sm' : 'primary sm' }),
    ]) : null;
    return el('div', [
      autoBar,
      el('div.menus', MENUS.map((m) => el('button.menu', {
        class: !auto && v.menu === m.id ? 'on' : null,
        disabled: auto || v.stable !== 'stable' || !!v.injury,
        onclick: () => { G.setTraining(g, id, m.id); app.render(); },
      }, [el('b', { text: m.name }), el('span', { text: m.desc })]))),
      el('p.note', {
        text: auto ? '自動調教の間は、メニューは仕上がりと疲れで決まる。'
          : v.stable !== 'stable' ? '放牧中は調教できない。入厩させると選べる。'
          : v.ready.ok ? '出走できる状態。' : `出走不可：${v.ready.why}`,
      }),
    ]);
  }
  if (tid === 'foals') return foalsTab(app, v);

  // 詳細：プロフィール ｜ 成績の内訳 ｜ 回り・主な勝鞍
  const c = career.counts;
  // 着度数の分からない実在馬は 2 着以下を「—」で出す。
  const line = (label, arr) => el('div.cr', [el('span', { text: label }), ...arr.map((n) => el('b', { text: n == null ? '—' : String(n) }))]);
  const menu = MENUS.find((m) => m.id === v.menu)?.name ?? '—';
  return el('div.hd-cols3', [
    kv([
      ['獲得賞金', formatMoney(v.earnings)],
      ['馬主', v.owner],
      ['厩舎', `${v.trainer}${v.trainerStyle ? `（${v.trainerStyle}）` : ''}`],
      ['主戦騎手', v.jockey],
      ['調教', v.isMine && !v.retired && v.age >= 2 ? menu : '—'],
      // 馬具（現役の競走馬だけ。自分の馬は押して付け替える。上の枠に置くと高さが足りず見切れた）
      ...(!v.retired && !v.dead && !v.broodmare && !v.stallion && v.age >= 2 ? [['馬具', el('span.gearline', [
        ...gearChips(v.gear),
        G.gearNames(v.gear).length ? null : el('i', { text: 'なし' }),
        v.isMine ? el('button.gchange', { text: '変更', onclick: () => gearModal(app, v) }) : null,
      ])]] : []),
      ['父', v.sire], ['母', v.dam], ['母の父', v.damSire],
    ]),
    el('div.crs', [
      line('全成績', c.all), line('芝成績', c.turf), line('ダ成績', c.dirt),
      line('GⅠ成績', c.GI), line('GⅡ成績', c.GII), line('GⅢ成績', c.GIII),
    ]),
    el('div', [
      el('div.crs', [line('右回り', c.right), line('左回り', c.left)]),
      el('div.wins', [
        el('h4', { text: '主な勝鞍' }),
        career.bigWins.length
          ? el('ul', career.bigWins.map((w) => el('li', [
            w.grade ? el('span.gchip', { text: w.grade, class: w.grade === 'GI' ? 'g1' : null }) : null,
            ` ${w.name}`, el('small', { text: ` ${w.year}` }),
          ])))
          : el('p.note', { text: 'まだ勝ち鞍が無い。' }),
      ]),
      v.titles.length ? el('div.badges', v.titles.map((x) => el('span.badge', { text: x }))) : null,
    ]),
  ]);
}

/**
 * 名鑑の表の「現役」「種牡馬」の頭数。押すとその馬の詳細を「産駒」のタブの、その区分で開く（行の押下＝詳細とは別に止める）。
 * 0 頭は押せない。list は左右に送る並び（名鑑の並び）。
 */
export function offspringLink(app, id, list, ff, n) {
  if (!n) return el('span.offl.zero', { text: '0' });
  return el('button.offl', {
    text: `${n}頭`,
    title: { stallions: '種牡馬になった産駒を見る', mares: '繁殖牝馬になった産駒を見る', all: '産駒をすべて見る' }[ff] ?? '現役の産駒を見る',
    onclick: (e) => { e.stopPropagation(); app.go('stable', { id, list, tab: 'foals', ff }); },
  });
}

/** 呼び出し元が決めたタブを当て終えた画面の引数（描き直しのたびに当て直さない） */
const OPENED = new WeakSet();

/** 産駒の区分（馬の詳細の「産駒」タブの絞り込み）。 */
const FOAL_FILTERS = [
  { id: 'active', name: '現役' }, { id: 'stallions', name: '種牡馬' }, { id: 'mares', name: '繁殖牝馬' },
  { id: 'young', name: '幼駒' }, { id: 'retired', name: '引退' }, { id: 'future', name: 'これから' }, { id: 'all', name: 'すべて' },
];

/**
 * 産駒のタブ。現役・種牡馬になった産駒・繁殖牝馬…で絞って見る（「種牡馬を押すと現役馬、産駒の種牡馬を見れるように」）。
 * 押した区分は app.foalsFilter に覚える。区分を替えても画面ごと描き直さず、表だけ描き直す（タブとスクロールが戻らない）。
 */
function foalsTab(app, v) {
  const o = G.offspringOf(app.game, v.horse.id);
  // 表にあって世界にまだ居ない史実の仔（これから生まれる・海外の若駒）。現役の名馬や生まれる前の馬でも出る
  o.future = G.realFutureOffspring(app.game, v.horse.id);
  let cur = app.foalsFilter;
  if (!o[cur]?.length) cur = FOAL_FILTERS.find((f) => o[f.id].length)?.id ?? 'all';
  const isSire = v.horse.sex !== '牝';
  const box = el('div');
  const fbar = el('div.offf');
  const draw = () => {
    fbar.textContent = '';
    for (const f of FOAL_FILTERS) {
      fbar.appendChild(el('button', {
        class: f.id === cur ? 'on' : null,
        disabled: !o[f.id].length,
        onclick: () => { cur = f.id; app.foalsFilter = f.id; draw(); },
      }, [el('span', { text: f.name }), el('b', { text: String(o[f.id].length) })]));
    }
    box.textContent = '';
    const rows = o[cur];
    if (!rows.length) { box.appendChild(el('p.empty', { text: 'まだ産駒が居ない。' })); return; }
    const list = rows.map((x) => x.id);
    const open = (x) => () => app.go('stable', { id: x.id, list });
    const name = (x) => el('span.sire-n', [el('b', { text: x.name }), x.mine ? el('i.realtag', { text: '所有' }) : null]);
    // 相手の親（種牡馬なら母、繁殖牝馬なら父）
    const mate = (x) => (isSire ? x.dam : x.sire);
    const mateH = isSire ? '母' : '父';
    let t;
    if (cur === 'future') {
      // 世界に居ない馬なので、押すと表の値で馬の詳細を開く（史実馬名鑑と同じ。落とし穴 76）
      t = table(['馬名', '生年', '性', mateH, 'いま'],
        rows.map((x) => ({
          cells: [el('span.sire-n', [el('b', { text: x.name }), el('i.realtag', { text: '史実' })]), x.birthYear, x.sex, mate(x), el('small', { text: x.status })],
          onclick: () => { if (G.realPreview(app.game, x.name)) app.go('stable', { real: x.name }); },
        })), { align: [, 'c', 'c', , ] });
      box.appendChild(el('p.note', { text: '表（史実）にある、この世界にまだ居ない仔。歴史が変わると生まれないこともある。押すと史実の値で詳細を見る。' }));
    } else if (cur === 'stallions') {
      t = table(['馬名', '生年', mateH, '戦績', '獲得賞金', '種付料', '産駒', 'いま'],
        rows.map((x) => ({
          cells: [name(x), x.birthYear, mate(x), `${x.starts}戦${x.wins}勝`, formatMoney(x.earnings),
            x.dead ? '—' : formatMoney(x.studFee), `${x.runners}頭`, x.dead ? '死亡' : '供用中'],
          onclick: open(x), cls: x.mine ? 'mine' : null,
        })), { align: [, 'c', , 'c', 'r', 'r', 'c', 'c'] });
    } else if (cur === 'active') {
      t = table(['馬名', '性齢', mateH, 'クラス', '戦績', '獲得賞金'],
        rows.map((x) => ({
          cells: [name(x), `${x.sex}${x.age}`, mate(x), x.className, `${x.starts}戦${x.wins}勝`, formatMoney(x.earnings)],
          onclick: open(x), cls: x.mine ? 'mine' : null,
        })), { align: [, 'c', , 'c', 'c', 'r'] });
    } else {
      t = table(['馬名', '生年', '性', mateH, '戦績', '獲得賞金'],
        rows.map((x) => ({
          cells: [name(x), x.birthYear, x.sex, mate(x), `${x.starts}戦${x.wins}勝`, formatMoney(x.earnings)],
          onclick: open(x), cls: x.mine ? 'mine' : null,
        })), { align: [, 'c', 'c', , 'c', 'r'] });
    }
    box.appendChild(t);
  };
  draw();
  return el('div', [fbar, box]);
}

/**
 * 見出しに出す立場。馬の詳細は記録や種牡馬名鑑からも開けるので、
 * どこから来ても「誰の馬で、いま何をしている馬か」が分かるようにする。
 * 引退した種牡馬・繁殖牝馬には馬主が居ないので、そこは馬主を出さない。
 */
function standing(v) {
  if (v.preview) return '史実馬（この世界に居ない）';
  // 種牡馬リーディングには供用を終えた馬も載る（産駒が走り続けるため）。
  // その馬を開いたときに種付料が出ていては、まだ付けられるように見える。
  if (v.dead) return v.stallion ? '故・種牡馬' : v.broodmare ? '故・繁殖牝馬' : '故';
  if (v.isMine) return v.stallion ? '自分の種牡馬' : v.broodmare ? '自分の繁殖牝馬' : '自分の所有馬';
  if (v.stallion) return `種牡馬（種付料 ${formatMoney(v.studFee ?? 0)}）`;
  if (v.broodmare) return '繁殖牝馬';
  if (v.owner && v.owner !== '—') return `馬主: ${v.owner}`;
  if (abroadRacing(v)) return '海外で現役';
  return v.retired ? '引退' : '—';
}

/** 海外で走っている馬（世界には居るが、日本のレースには出ない）。名鑑の「海外で現役」と同じ。 */
const abroadRacing = (v) => !!v.foreign && v.retired && !v.stallion && !v.broodmare && v.age <= 8;


const SHORT = {
  tokyo: '東京', nakayama: '中山', hanshin: '阪神', kyoto: '京都', chukyo: '中京',
  niigata: '新潟', sapporo: '札幌', hakodate: '函館', fukushima: '福島', kokura: '小倉',
};
const courseShort = (g, id) => SHORT[id] ?? (id ? G.courseShort(id) : '—');

/** 距離適性の折れ線。棒を並べるだけで十分読める。 */
function distChart(g, h) {
  const marks = [1200, 1400, 1600, 1800, 2000, 2200, 2400, 3000, 3200];
  return el('div.distchart', marks.map((m) => {
    const apt = Math.abs(m - h.dist) / Math.max(200, h.distRange);
    const v = Math.max(0, 1 - 0.34 * Math.pow(apt, 1.5));
    return el('div.dc-col', [
      el('div.dc-bar', el('div.dc-fill', { style: { height: `${v * 100}%` } })),
      el('div.dc-l', { text: m >= 3000 ? `${m / 1000}k` : String(m) }),
    ]);
  }));
}

/**
 * 血統表。父・母を 1 代目として、世代ごとに列を並べる。
 * 実際の血統表と同じ「右に行くほど古い」形にしている。
 */
export function pedigreeTable(g, id, gens = 4) {
  const tree = G.pedigree(g, id, gens);
  if (!tree) return el('p.empty', { text: '血統が登録されていない' });
  const cols = [];
  for (let gen = 1; gen <= gens; gen++) cols.push([]);
  const walk = (node, gen) => {
    if (gen > gens) return;
    cols[gen - 1].push(node);
    walk(node?.sire ?? null, gen + 1);
    walk(node?.dam ?? null, gen + 1);
  };
  walk(tree.sire, 1);
  walk(tree.dam, 1);
  const ped = el('div.ped', cols.map((cells, i) => el('div.ped-col', cells.map((n) => el('div.ped-cell', {
    class: n ? (n.sex === '牡' ? 'male' : 'female') : 'blank',
    title: n ? `${n.name}${n.line ? `（${n.line}）` : ''}${pedFactorText(n)}` : '',
  }, n ? [el('span', { text: n.name }), pedMarks(n), n.line ? el('small', { text: n.line }) : null] : el('span', { text: '—' }))))));
  return pedWithToggle(ped);
}

/** 血統図の因子の印の 1 文字（スピード＝速…）。 */
const FACTOR_MARK = { speed: '速', stamina: '持', power: '力', burst: '瞬', guts: '根', mind: '精', health: '健' };

/** 血統図の 1 マスの因子の印（因子ごとの色付きの 1 文字と、系祖の「祖」）。 */
export function pedMarks(n) {
  const fs = n?.factors ?? [];
  if (!fs.length && !n?.head) return null;
  const labels = G.factorLabels();
  return el('span.pmarks', [
    ...fs.map((f) => el(`i.pm.pm-${f}`, { text: FACTOR_MARK[f] ?? '?', title: labels[f] ?? f })),
    n.head ? el('i.pm.pm-head', { text: '祖', title: '系統の祖' }) : null,
  ]);
}

function pedFactorText(n) {
  const labels = G.factorLabels();
  const fs = (n.factors ?? []).map((f) => labels[f] ?? f);
  return fs.length ? ` 因子：${fs.join('・')}` : '';
}

/** 血統図の因子の表示・非表示（見る人の好みなので、この端末だけに覚える）。 */
export function pedWithToggle(ped) {
  const KEY = 'keiba-ped-factors';
  const read = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };
  let on = read();
  const btn = el('button.ped-toggle', { type: 'button' });
  const sync = () => {
    ped.classList.toggle('nofactors', !on);
    btn.textContent = on ? '因子：表示中' : '因子：非表示';
    btn.classList.toggle('off', !on);
  };
  btn.addEventListener('click', () => {
    on = !on;
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* 保存できなくても動く */ }
    sync();
  });
  sync();
  return el('div.ped-wrap', [el('div.ped-bar', [btn, el('small', { text: '速=スピード 持=スタミナ 力=パワー 瞬=瞬発 根=根性 精=精神 健=健康 祖=系統の祖' })]), ped]);
}

// ---------------------------------------------------------------- 操作

function pickJockey(app, id) {
  const g = app.game;
  const js = G.availableJockeys(g, 60);
  const m = modal('主戦騎手を決める', table(
    ['騎手', '年齢', '所属', '腕', '今年の成績', ''],
    js.map((j) => [
      j.name, j.age, j.region,
      '★'.repeat(Math.max(1, Math.round(j.skill * 5))),
      `${j.starts}戦${j.wins}勝（GI ${j.g1}）`,
      button('依頼', () => {
        G.setMainJockey(g, id, j.id);
        m.close();
        app.render();
        toast(`${j.name} に主戦を依頼した`);
      }, { cls: 'sm' }),
    ]), { align: [, 'c', 'c', 'c', 'c'] }), { wide: true });
}

export function entryModal(app, id) {
  const g = app.game;
  const v = G.horseView(g, id);
  let week = 0;
  const body = el('div');
  const jockeySel = el('select.inp');
  for (const j of G.availableJockeys(g, 40)) {
    jockeySel.appendChild(el('option', { value: String(j.id), text: `${j.name}（★${'★'.repeat(Math.max(1, Math.round(j.skill * 5))).length}）` }));
  }
  if (v.horse.jockeyId != null) jockeySel.value = String(v.horse.jockeyId);
  const styleSel = el('select.inp', [
    el('option', { value: '', text: '指示なし（馬の持ち味）' }),
    ...STYLES.map((s) => el('option', { value: s, text: s })),
  ]);
  const horizon = G.ENTRY_HORIZON;
  const sch = G.schedule(g, horizon);
  const mine = new Map(G.myEntries(g).filter((e) => e.horseId === id).map((e) => [e.raceId, e]));

  const render = () => {
    body.textContent = '';
    const races = G.racesFor(g, id, week);
    const at = sch[week];
    const sel = el('select.inp', {
      onchange: (e) => { week = Number(e.target.value); render(); },
    }, sch.map((w, i) => {
      const n = G.racesFor(g, id, i).length;
      return el('option', {
        value: String(i), selected: i === week,
        text: `${i === 0 ? '今週' : `${i}週後`}　${w.year}年 ${w.label}（${n}レース）`,
      });
    }));
    body.appendChild(el('div.week-picker', [
      button('◀', () => { week = Math.max(0, week - 1); render(); }, { cls: 'sm', disabled: week === 0 }),
      sel,
      button('▶', () => { week = Math.min(horizon - 1, week + 1); render(); }, { cls: 'sm', disabled: week >= horizon - 1 }),
      button('今週', () => { week = 0; render(); }, { cls: 'sm ghost' }),
    ]));
    body.appendChild(el('div.form-row', [
      el('label', ['騎手', jockeySel]),
      el('label', ['脚質指示', styleSel]),
    ]));
    if (!races.length) {
      body.appendChild(el('p.empty', { text: `${at.year}年 ${at.label} に出られるレースは無い。` }));
    } else {
      body.appendChild(table(
        ['レース', '場', '条件', '距離', '賞金', '適性', ''],
        races.map((r) => {
          const ent = mine.get(r.raceId);
          return [
            el('span', { text: r.name, class: r.grade ? 'grade' : null,
              title: r.abroadCost ? `海外遠征（遠征費 ${formatMoney(r.abroadCost)}）` : null }),
            r.abroadCost ? `${r.courseShort}・遠征費${formatMoney(r.abroadCost)}` : r.courseName, `${r.className}・${r.ageLabel}${r.sexLabel}`,
            `${r.surface}${r.distance}m`,
            formatMoney(r.prize),
            bar(r.apt),
            ent
              ? button('取消', () => { G.cancelEntry(g, r.raceId); mine.delete(r.raceId); render(); app.render(); }, { cls: 'sm ghost' })
              : button('登録', () => {
                const res = G.enterRace(g, id, r.raceId, {
                  jockeyId: Number(jockeySel.value),
                  styleOrder: styleSel.value || null,
                });
                if (!res.ok) return toast(res.why, { bad: true });
                toast(`${v.name} を ${r.name} に登録した（${at.year}年 ${at.label}）`);
                m.close();
                app.render();
              }, { cls: 'sm primary' }),
          ];
        }), { align: [, 'c', 'c', 'c', 'r', 'c'] }));
      if (week !== 0) body.appendChild(el('p.note', { text: '先の週の登録は、その週に出走資格と体調を見直す（外れたら取り消される）。' }));
    }
  };

  const m = modal(`${v.name} の出走登録`, [body], { wide: true });
  render();
  return m;
}
