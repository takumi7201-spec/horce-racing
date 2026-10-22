// 牧場。繁殖牝馬への配合と、セリ市。

import { el, card, table, button, kv, bar, modal, toast, tabs } from '../dom.js';
import * as G from '../../sim/game.js';
import { formatMoney } from '../../core/util.js';
import { horseImg } from '../horse-sprite.js';

export function farmScreen(app) {
  const g = app.game;
  const tab = app.params.tab ?? (app.params.damId ? 'mating' : 'mating');
  const nav = tabs([
    { id: 'mating', name: '配合' },
    { id: 'stallions', name: '種牡馬名鑑' },
    { id: 'mares', name: '繁殖牝馬名鑑' },
    { id: 'auction', name: `セリ市${G.auctionOpen(g) ? '（開催中）' : ''}` },
  ], tab, (id) => app.go('farm', { tab: id, damId: app.params.damId }));

  const body = tab === 'stallions' ? stallionBook(app)
    : tab === 'mares' ? mareBook(app)
    : tab === 'auction' ? auctionView(app)
      : matingView(app);
  return el('div', [nav, body]);
}

// ---------------------------------------------------------------- 配合

function matingView(app) {
  const g = app.game;
  const mares = G.myBroodmares(g);
  const booked = new Map(G.myMatings(g).map((m) => [m.damId, m]));
  const damId = app.params.damId ?? mares[0]?.id ?? null;
  if (!mares.length) {
    return card('配合', el('p.empty', {
      text: '繁殖牝馬が居ない。現役の牝馬を引退させると繁殖に上がる。',
    }));
  }
  const dam = G.getHorse(g, damId);
  const dv = damId ? G.horseView(g, damId) : null;

  // 予算の既定は資金の 4 割。高い種牡馬ばかり見ても仕方がない。
  const budgetInput = el('input.inp', {
    type: 'number', value: String(Math.max(50, Math.round(g.world.player.money * 0.4))), min: '0', step: '50',
  });
  const search = el('input.inp', { type: 'text', placeholder: '種牡馬名で絞る' });
  const list = el('div.stallion-list');
  const evalBox = el('div.mating-eval');
  let sireId = null;

  const renderList = () => {
    list.textContent = '';
    const maxFee = Number(budgetInput.value) || Infinity;
    const ss = G.stallions(g, { maxFee, search: search.value.trim() }).slice(0, 60);
    if (!ss.length) {
      list.appendChild(el('p.empty', { text: 'その条件の種牡馬は居ない。予算を上げてみる。' }));
      return;
    }
    list.appendChild(table(['種牡馬', '年齢', '系統', '種付料', '産駒', '評価', ''],
      ss.map((s) => {
        const ev = damId ? G.evaluateMating(g, damId, s.id) : null;
        return {
          cells: [
            sireName(s), `${s.age}歳`, s.line,
            formatMoney(s.fee), `${s.foals}頭`,
            ev ? el('span.stars', { text: '★'.repeat(ev.stars) + '☆'.repeat(5 - ev.stars) }) : '—',
            button('選ぶ', () => { sireId = s.id; renderEval(); }, { cls: 'sm' }),
          ],
          cls: sireId === s.id ? 'sel' : null,
          onclick: () => { sireId = s.id; renderEval(); renderList(); },
        };
      }), { align: [, 'c', , 'r', 'c', 'c'] }));
  };

  const renderEval = () => {
    evalBox.textContent = '';
    if (!sireId || !damId) {
      evalBox.appendChild(el('p.empty', { text: '種牡馬を選ぶと配合の評価が出る。' }));
      return;
    }
    const ev = G.evaluateMating(g, damId, sireId);
    const sire = G.getHorse(g, sireId);
    evalBox.appendChild(el('div', [
      el('h3', { text: `${sire.name} × ${dam.name}` }),
      el('div.stars.big', { text: '★'.repeat(ev.stars) + '☆'.repeat(5 - ev.stars) }),
      kv([
        ['種付料', formatMoney(ev.fee)],
        ['父の系統', ev.sireLine],
        ['母の父の系統', ev.damSireLine],
        ['ニックス', `${ev.nicks.grade}（産駒 ${ev.nicks.samples} 頭の実績）`],
        ['近交の危うさ', bar(ev.risk, { color: ev.risk > 0.4 ? '#c75' : '#687' })],
      ]),
      ev.inbreed.length
        ? el('div', [
          el('h4', { text: 'インブリード' }),
          el('ul.inb', ev.inbreed.map((x) => el('li', { text: `${x.name}　${x.label}` }))),
        ])
        : el('p.note', { text: 'インブリードは入らない（アウトブリード）。' }),
      el('p.comment', { text: ev.comment }),
      button(`この配合で種付けする（${formatMoney(ev.fee)}）`, () => {
        const r = G.bookMating(g, damId, sireId);
        if (!r.ok) return toast(r.why, { bad: true });
        toast(`${sire.name} との配合を予約した`);
        app.render();
      }, { cls: 'primary big', disabled: g.world.player.money < ev.fee }),
      el('p.note', { text: '種付けは年末に実行され、翌年に仔が生まれる。' }),
    ]));
  };

  budgetInput.addEventListener('input', renderList);
  search.addEventListener('input', renderList);
  renderList();
  renderEval();

  return el('div.cols2', [
    el('div.col', [
      card('繁殖牝馬', table(['馬名', '年齢', '父', '母の父', '戦績', '産駒', '今年の予約'],
        mares.map((m) => {
          const v = G.horseView(g, m.id);
          const b = booked.get(m.id);
          return {
            cells: [
              el('b', { text: m.name }), `${v.age}歳`, v.sire, v.damSire,
              `${m.starts}戦${m.wins}勝`, `${(m.foals ?? []).length}頭`,
              b ? el('span.mine', { text: b.sire.name }) : '—',
            ],
            cls: m.id === damId ? 'sel' : null,
            onclick: () => app.go('farm', { tab: 'mating', damId: m.id }),
          };
        }), { align: [, 'c', , , 'c', 'c'] })),
      booked.size ? card('今年の配合予約', table(['繁殖牝馬', '種牡馬', '種付料', ''],
        [...booked.values()].map((b) => [
          b.dam.name, b.sire.name, formatMoney(b.fee),
          button('取消', () => {
            G.cancelMating(g, b.damId);
            toast('予約を取り消した（種付料は返却）');
            app.render();
          }, { cls: 'sm ghost' }),
        ]), { align: [, , 'r'] })) : null,
      card('種牡馬を探す', [
        el('div.form-row', [
          el('label', ['予算（万円）', budgetInput]),
          el('label', ['名前', search]),
        ]),
        list,
      ]),
    ]),
    el('div.col', [
      dv ? card(`${dv.name} の血統`, pedigreeMini(g, damId)) : null,
      card('配合の評価', evalBox),
      card('配合の考えかた', el('ul.howto', [
        el('li', { text: '3×4 のインブリードがいちばん効く。近すぎる配合は能力より丈夫さを削る。' }),
        el('li', { text: 'ニックス（父系 × 母父系の相性）は産駒 12 頭ぶんの実績が出るまで「？」のまま。' }),
        el('li', { text: '父と母で得意距離が離れていると、中途半端な仔が出やすい。' }),
        el('li', { text: '両親の能力はそのまま伝わらない。平均へ戻る力が働く（名馬の仔が凡馬で終わることもある）。' }),
      ])),
    ]),
  ]);
}

function pedigreeMini(g, id) {
  const tree = G.pedigree(g, id, 3);
  if (!tree) return el('p.empty', { text: '—' });
  const cols = [[], [], []];
  const walk = (n, gen) => {
    if (gen > 3) return;
    cols[gen - 1].push(n);
    walk(n?.sire ?? null, gen + 1);
    walk(n?.dam ?? null, gen + 1);
  };
  walk(tree.sire, 1);
  walk(tree.dam, 1);
  return el('div.ped.mini', cols.map((cells) => el('div.ped-col', cells.map((n) =>
    el('div.ped-cell', { class: n ? (n.sex === '牡' ? 'male' : 'female') : 'blank' },
      el('span', { text: n ? n.name : '—' }))))));
}

// ---------------------------------------------------------------- 種牡馬名鑑

function stallionBook(app) {
  const g = app.game;
  const ss = G.stallions(g);
  return card(`種牡馬名鑑（${ss.length} 頭）`, table(
    ['種牡馬', '年齢', '系統', '種付料', '現役成績', '代表勝鞍', '獲得賞金', '産駒数'],
    ss.map((s) => ({
      cells: [
        sireName(s), `${s.age}歳`, s.line, formatMoney(s.fee),
        `${s.horse.starts}戦${s.horse.wins}勝`, s.bestWin ?? '—', formatMoney(s.earnings), `${s.foals}頭`,
      ],
      onclick: () => app.go('stable', { id: s.id }),
    })), { align: [, 'c', , 'r', 'c', , 'r', 'c'] }));
}

/** 種牡馬名。実在の馬には小さな札を付ける（架空の馬と見分けられるように）。 */
function sireName(s) {
  return el('span.sire-n', [el('b', { text: s.name }), s.real ? el('i.realtag', { text: '実在' }) : null]);
}

// ---------------------------------------------------------------- 繁殖牝馬名鑑

/**
 * 実在の名牝。繁殖中の馬は買える。買えば自分の繁殖牝馬として配合できる。
 * 代表産駒は実在の仔（イクイノックスの母ならイクイノックス）を先に出す。
 */
function mareBook(app) {
  const g = app.game;
  const ms = G.realMares(g);
  const money = g.world.player.money;
  return card(`繁殖牝馬名鑑（実在 ${ms.length} 頭）`, [
    el('p.note', { text: '実在の名牝は繁殖中なら購入できる。値段は格と年齢、母としての実績（GI 馬の母）で決まる。' }),
    table(['繁殖牝馬', '年齢', '父', '母の父', '代表勝鞍', '代表産駒', '産駒', '価格', ''],
      ms.map((m) => ({
        cells: [
          sireName(m), `${m.age}歳`, m.sire, m.damSire, m.bestWin ?? '—', m.bestFoal ?? '—', `${m.foals}頭`,
          m.mine ? el('span.mine', { text: '自分の繁殖牝馬' }) : formatMoney(m.price),
          m.mine ? button('配合', (e) => { e.stopPropagation(); app.go('farm', { tab: 'mating', damId: m.id }); }, { cls: 'sm' })
            : button('購入', (e) => {
              e.stopPropagation();
              if (!confirm(`${m.name} を ${formatMoney(m.price)} で購入する？`)) return;
              const r = G.buyMare(g, m.id);
              if (!r.ok) return toast(r.why, { bad: true });
              toast(`${m.name} を ${formatMoney(r.price)} で購入した`);
              app.render();
              return undefined;
            }, { cls: 'sm primary', disabled: money < m.price }),
        ],
        cls: m.mine ? 'mine' : null,
        onclick: () => app.go('stable', { id: m.id }),
      })), { align: [, 'c', , , , , 'c', 'r'] }),
  ]);
}

// ---------------------------------------------------------------- セリ市

function auctionView(app) {
  const g = app.game;
  const open = G.auctionOpen(g);
  const lots = G.auction(g);
  return card(open ? 'セリ市（1 歳馬）' : 'セリ市（10 月に開催）', [
    el('p.note', {
      text: open
        ? '買えるのは血統と馬体だけを見て。能力は走らせるまで分からない。'
        : 'セリは毎年 10 月に開かれる。いまは下見だけ。',
    }),
    lots.length ? table(['', '馬名', '性', '毛色', '父', '母', '母の父', '馬体', 'インブリード', '価格', ''],
      lots.map((x) => [
        horseImg(x.coat, { size: 'sm', age: 1, title: `${x.name}（${x.coat}）` }),
        el('b', { text: x.name }), x.sex, x.coat, x.sire,
        x.damReal ? el('span.sire-n', [x.dam, el('i.realtag', { text: '実在' })]) : x.dam,
        x.damSire, x.look,
        (x.inbreed ?? []).slice(0, 2).join(' / ') || '—',
        formatMoney(x.price),
        button('購入', () => {
          const r = G.buyYearling(g, x.id);
          if (!r.ok) return toast(r.why, { bad: true });
          toast(`${x.name} を ${formatMoney(r.price)} で購入した`);
          app.render();
        }, { cls: 'sm primary', disabled: !open || g.world.player.money < x.price }),
      ]), { align: ['c', , 'c', 'c', , , , 'c', , 'r'] })
      : el('p.empty', { text: '上場馬が居ない。' }),
  ]);
}
