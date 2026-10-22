// 所有馬の一覧と、1 頭の詳細（能力・適性・血統表・戦績・調教）。

import { el, card, table, button, kv, bar, modal, toast, frameChip, tabs, ask } from '../dom.js';
import * as G from '../../sim/game.js';
import { formatMoney, formatTime, formatSec, rankOf } from '../../core/util.js';
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
    stallions: '種牡馬が居ない。重賞を勝った牡馬を引退させると種牡馬になれる。',
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
  if (cat === 'active') {
    sub = `${h.sex}${v.age}　${v.className}`;
    tags.push(v.injury ? ['bad', v.injury.name] : v.stable === 'stable' ? ['on', '在厩'] : ['', '放牧']);
    if (v.stable === 'stable' && !v.injury) tags.push(['', fitLabel(v.fit)]);
    if (G.myEntries(g).some((e) => e.horseId === h.id)) tags.push(['go', '出走予定']);
  } else if (cat === 'mares') {
    sub = `${v.age}歳　産駒${v.foals.length}頭`;
    const booked = G.myMatings(g).find((m) => m.damId === h.id);
    tags.push(v.pregnancy ? ['go', `受胎 ${v.pregnancy.sire}`]
      : booked ? ['on', `予約 ${booked.sire?.name ?? ''}`] : ['', '空胎']);
  } else if (cat === 'stallions') {
    sub = `${v.age}歳　産駒${v.foals.length}頭`;
    tags.push(['', `種付料 ${formatMoney(v.studFee ?? 0)}`]);
  } else {
    sub = `${h.sex}　${v.age === 0 ? '当歳' : '1歳'}`;
    tags.push(['', `父 ${v.sire}`], ['', `母 ${v.dam}`]);
  }
  return el('div.stile', {
    class: cat === 'active' && v.injury ? 'hurt' : null,
    tabIndex: 0,
    role: 'button',
    title: `${h.name}の詳細`,
    onclick: () => app.go('stable', { id: h.id, cat }),
    onkeydown: (e) => { if (e.key === 'Enter') app.go('stable', { id: h.id, cat }); },
  }, [
    el('div.st-pic', horseImg(h.coat, { size: v.age < 2 ? 'xs' : 'sm', age: v.age, title: h.coat })),
    el('div.st-body', [
      el('b.st-name', { text: h.name }),
      el('span.st-sub', { text: sub }),
      el('div.st-tags', tags.map(([c, t]) => el('i', { text: t, class: c || null }))),
    ]),
    cat === 'mares' ? button('配合', (e) => { e.stopPropagation(); app.go('farm', { damId: h.id }); }, { cls: 'sm' }) : null,
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
  const lineup = mine ? G.myLineup(g, cat) : (app.params.list ?? []);
  const at = lineup.indexOf(id);
  const go = (d) => {
    if (lineup.length < 2 || at < 0) return;
    const next = lineup[(at + d + lineup.length) % lineup.length];
    // 送るたびに履歴を積むと「戻る」が馬の数だけ必要になるので、差し替える。
    app.go('stable', { ...app.params, id: next, dir: d, cat }, { replace: true });
  };
  app.onArrow = go;

  const tabs = TABS.filter((x) => (!x.mineOnly || active) && (!x.needFoals || v.foals.length));
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
    statePanel(v),
    lineup.length > 1 && at >= 0 ? el('div.hd-swipe', { text: '左右にスワイプで次の馬' }) : null,
  ]);
  swipe(stage, go);

  return el('div.hd', { class: cat ? 'has-rail' : null }, [
    el('header.hd-top', [
      el('span.hd-silk', horseImg(h.coat, { size: 'xs', age: v.age })),
      el('h1', { text: v.name }),
      el('span.hd-sa', { text: `${h.sex}${v.age}　${h.coat}` }),
      el('div.hd-pills', [
        el('span', { text: standing(v), class: mine ? 'on' : null }),
        active ? el('span', {
          text: v.injury ? `${v.injury.name} 残${v.injury.weeks}週` : v.stable === 'stable' ? '在厩' : '放牧',
          class: v.injury ? 'bad' : null,
        }) : null,
        v.inbreed.length ? el('span', { text: `インブリード ${v.inbreed.length}` }) : null,
        v.real ? el('span.real', { text: '実在' }) : null,
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
        button('所有馬一覧', () => app.go('stable', { cat }), { cls: 'sm' }),
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
        row('クラス', v.age < 2 ? 'デビュー前' : v.className),
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
    ]),
  ]);
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
function statePanel(v) {
  const young = !v.dead && !v.retired && v.age < 2;
  const racing = !v.dead && !v.retired && !v.broodmare && !v.stallion && !young;
  const fit = Math.max(0, Math.min(1, v.fit ?? 0));
  const foals = v.foals ?? [];
  // 幼駒は仕上がりも産駒も無いので、いま見えている素質（能力の平均）を輪にする。
  const avg = ABILITIES.reduce((a, k) => a + v.values[k], 0) / ABILITIES.length;
  const ratio = racing ? fit : young ? avg : Math.min(1, foals.length / 12);
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
    : young ? [el('span', { text: '素質' }), el('b', { text: rankOf(avg) })]
      : [el('span', { text: '産駒' }), el('b', { text: String(foals.length) }), el('small', { text: '頭' })]));
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
  ] : [
    r('年齢', `${v.age}歳`),
    v.pregnancy ? r('受胎', `${v.pregnancy.sire}（${v.pregnancy.year}年4月）`)
      : r('産駒の勝利', `${foals.reduce((a, f) => a + f.wins, 0)}勝`),
    v.stallion && !v.dead ? r('種付料', formatMoney(v.studFee ?? 0)) : r('立場', v.dead ? '故' : v.broodmare ? '繁殖牝馬' : '引退'),
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
        if (!await ask(`${v.name} を引退させる？`, { ok: '引退させる' })) return;
        G.retire(g, id);
        toast(`${v.name} を引退させた`);
        app.go('stable');
      }, { cls: 'ghost' }),
    ];
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
    return el('div.hd-cols', [
      el('div', [
        el('h4', { text: '能力' }),
        el('div.abil', ABILITIES.map((a) => el('div.abil-row', [
          el('span.abil-l', { text: ABILITY_LABEL[a] }),
          el('span.abil-r', { text: v.ranks[a] }),
          bar(v.values[a]),
        ]))),
        el('p.note', { text: '評価は「いま出せる力」。潜在能力は見えない。調教と出走で近づく。' }),
      ]),
      el('div', [
        el('h4', { text: '馬場' }),
        el('div.apt-surf', [
          bar(v.turf, { label: '芝' }), bar(v.dirt, { label: 'ダート' }),
          bar(v.firm, { label: '良' }), bar(v.soft, { label: '重' }),
        ]),
        el('h4', { text: `距離（最適 ${v.dist}m）` }),
        distChart(g, h),
      ]),
    ]);
  }
  if (tid === 'train') {
    return el('div', [
      el('div.menus', MENUS.map((m) => el('button.menu', {
        class: v.menu === m.id ? 'on' : null,
        disabled: v.stable !== 'stable' || !!v.injury,
        onclick: () => { G.setTraining(g, id, m.id); app.render(); },
      }, [el('b', { text: m.name }), el('span', { text: m.desc })]))),
      el('p.note', {
        text: v.stable !== 'stable' ? '放牧中は調教できない。入厩させると選べる。'
          : v.ready.ok ? '出走できる状態。' : `出走不可：${v.ready.why}`,
      }),
    ]);
  }
  if (tid === 'foals') {
    return table(['馬名', '生年', '性', '戦績', '獲得賞金'],
      v.foals.map((f) => ({
        cells: [f.name, f.birthYear, f.sex, `${f.starts}戦${f.wins}勝`, formatMoney(f.earnings)],
        onclick: () => app.go('stable', { id: f.id }),
      })), { align: [, 'c', 'c', 'c', 'r'] });
  }

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
 * 見出しに出す立場。馬の詳細は記録や種牡馬名鑑からも開けるので、
 * どこから来ても「誰の馬で、いま何をしている馬か」が分かるようにする。
 * 引退した種牡馬・繁殖牝馬には馬主が居ないので、そこは馬主を出さない。
 */
function standing(v) {
  // 種牡馬リーディングには供用を終えた馬も載る（産駒が走り続けるため）。
  // その馬を開いたときに種付料が出ていては、まだ付けられるように見える。
  if (v.dead) return v.stallion ? '故・種牡馬' : v.broodmare ? '故・繁殖牝馬' : '故';
  if (v.isMine) return v.stallion ? '自分の種牡馬' : v.broodmare ? '自分の繁殖牝馬' : '自分の所有馬';
  if (v.stallion) return `種牡馬（種付料 ${formatMoney(v.studFee ?? 0)}）`;
  if (v.broodmare) return '繁殖牝馬';
  if (v.owner && v.owner !== '—') return `馬主: ${v.owner}`;
  return v.retired ? '引退' : '—';
}


const SHORT = {
  tokyo: '東京', nakayama: '中山', hanshin: '阪神', kyoto: '京都', chukyo: '中京',
  niigata: '新潟', sapporo: '札幌', hakodate: '函館', fukushima: '福島', kokura: '小倉',
};
const courseShort = (g, id) => SHORT[id] ?? id ?? '—';

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
function pedigreeTable(g, id, gens = 4) {
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
  return el('div.ped', cols.map((cells, i) => el('div.ped-col', cells.map((n) => el('div.ped-cell', {
    class: n ? (n.sex === '牡' ? 'male' : 'female') : 'blank',
    title: n ? `${n.name}${n.line ? `（${n.line}）` : ''}` : '',
  }, n ? [el('span', { text: n.name }), n.line ? el('small', { text: n.line }) : null] : el('span', { text: '—' }))))));
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

  const render = () => {
    body.textContent = '';
    const races = G.racesFor(g, id, week);
    body.appendChild(el('div.form-row', [
      el('label', ['騎手', jockeySel]),
      el('label', ['脚質指示', styleSel]),
    ]));
    if (!races.length) {
      body.appendChild(el('p.empty', { text: 'この週に出られるレースは無い。' }));
    } else {
      body.appendChild(table(
        ['レース', '場', '条件', '距離', '賞金', '適性', ''],
        races.map((r) => [
          el('span', { text: r.name, class: r.grade ? 'grade' : null }),
          r.courseName, `${r.className}・${r.ageLabel}${r.sexLabel}`,
          `${r.surface}${r.distance}m`,
          formatMoney(r.prize),
          bar(r.apt),
          button('登録', () => {
            const res = G.enterRace(g, id, r.raceId, {
              jockeyId: Number(jockeySel.value),
              styleOrder: styleSel.value || null,
            });
            if (!res.ok) return toast(res.why, { bad: true });
            toast(`${v.name} を ${r.name} に登録した`);
            m.close();
            app.render();
          }, { cls: 'sm primary', disabled: week !== 0 }),
        ]), { align: [, 'c', 'c', 'c', 'r', 'c'] }));
      if (week !== 0) body.appendChild(el('p.note', { text: '登録できるのは今週のレースだけ。' }));
    }
  };

  const m = modal(`${v.name} の出走登録`, [
    el('nav.tabs', [0, 1, 2, 3].map((k) => el('button.tab', {
      text: k === 0 ? '今週' : `${k}週後`,
      class: k === week ? 'on' : null,
      onclick: () => { week = k; render(); },
    }))),
    body,
  ], { wide: true });
  render();
  return m;
}
