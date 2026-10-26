// 牧場。配合と各セール、入厩・馬名登録。
// 行事は年間スケジュール（sim/calendar.js）の時期だけ開く。時期の外は下見だけできる。

import { el, card, table, button, kv, bar, modal, toast, tabs, ask } from '../dom.js';
import * as G from '../../sim/game.js';
import { formatMoney } from '../../core/util.js';
import { horseImg } from '../horse-sprite.js';
import { icon } from '../icons.js';
import { pedMarks, pedWithToggle } from './stable.js';

export function farmScreen(app) {
  const g = app.game;
  const tab = app.params.tab ?? 'mating';
  // 開催中の行事にはタブに印を付ける（どこへ行けばいいかが一目で分かるように）。
  const mark = (open) => (open ? '（開催中）' : '');
  const nav = tabs([
    { id: 'mating', name: `配合${G.matingOpen(g) ? '（種付け期）' : ''}` },
    { id: 'stallions', name: '種牡馬名鑑' },
    { id: 'mares', name: `繁殖牝馬セール${mark(G.saleOpen(g, 'mare'))}` },
    { id: 'foal', name: `当歳セール${mark(G.saleOpen(g, 'foal'))}` },
    { id: 'overseas', name: `海外・庭先${mark(G.saleOpen(g, 'overseas') || G.saleOpen(g, 'private'))}` },
    { id: 'direct', name: '牧場取引（通年）' },
    { id: 'facilities', name: `施設${G.facilities(g).some((f) => f.build) ? '（建設中）' : ''}` },
    { id: 'entry', name: `入厩・馬名登録${mark(G.entryOpen(g))}` },
  ], tab, (id) => app.go('farm', { tab: id, damId: app.params.damId }, { replace: true }));

  const body = tab === 'stallions' ? stallionBook(app)
    : tab === 'mares' ? mareSaleView(app)
      : tab === 'foal' ? horseSaleView(app, 'foal')
        : tab === 'overseas' ? el('div', [overseasView(app), horseSaleView(app, 'private'), mareSaleView(app, 'pMare')])
          : tab === 'facilities' ? facilitiesView(app)
          : tab === 'direct' ? el('div', [
            el('p.note', { text: `セールの外でも、牧場から直接買える。相対取引なので割高（セール価格のおよそ ${G.DIRECT_PREMIUM} 倍）。顔ぶれは 12 週ごとに入れ替わる。史実の名馬になる幼駒と実在の名牝は出ない。` }),
            horseSaleView(app, 'dFoal'), horseSaleView(app, 'dYearling'), mareSaleView(app, 'dMare'),
          ])
          : tab === 'entry' ? entryView(app)
            : matingView(app);
  return el('div', [nav, body]);
}

/** 行事の時期の案内。開いていなければ次の時期を出す。 */
function seasonNote(g, open, when, what) {
  return el('p', {
    class: open ? 'season open' : 'season',
    text: open ? `${what}の時期（${when}）。` : `${what}は ${when}。いまは下見だけできる。`,
  });
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

  const fm = G.fame(g);
  const renderList = () => {
    list.textContent = '';
    const maxFee = Number(budgetInput.value) || Infinity;
    const ss = G.stallions(g, { maxFee, search: search.value.trim() }).slice(0, 60);
    if (!ss.length) {
      list.appendChild(el('p.empty', { text: 'その条件の種牡馬は居ない。予算を上げてみる。' }));
      return;
    }
    list.appendChild(table(['種牡馬', '年齢', '系統', '因子', '種付料', '産駒', '評価', ''],
      ss.map((s) => {
        const ev = damId ? G.evaluateMating(g, damId, s.id) : null;
        return {
          cells: [
            sireName(s), `${s.age}歳`, s.line, factorChips(s.factors),
            formatMoney(s.fee), `${s.foals}頭`,
            ev ? el('span.stars', { text: '★'.repeat(ev.stars) + '☆'.repeat(5 - ev.stars) }) : '—',
            s.locked
              ? el('small.locked', { text: `名声${fm.need}〜`, title: `海外の種牡馬は名声 ${fm.need} から（いま ${fm.fame}）` })
              : button('選ぶ', () => { sireId = s.id; renderEval(); }, { cls: 'sm' }),
          ],
          cls: sireId === s.id ? 'sel' : null,
          onclick: s.locked ? null : () => { sireId = s.id; renderEval(); renderList(); },
        };
      }), { align: [, 'c', , , 'r', 'c', 'c'] }));
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
        ['血の活力', ev.vigor.label],
        ['爆発力', el('span', [el('b', { text: `${ev.burst}` }), el('small', { text: `　${ev.burstComment}` })])],
        ['危険度', el('span', [bar(ev.risk, { color: ev.riskPoints >= 4 ? '#c75' : '#687' }), el('small', { text: ` ${ev.riskComment}` })])],
      ]),
      ev.blocked ? el('p.warn', { text: ev.blocked }) : null,
      ev.theories.length
        ? el('div', [
          el('h4', { text: `成立する配合理論（${ev.theories.length}）` }),
          el('ul.inb.theories', ev.theories.map((t) => el('li', [
            el('i.tchip', { text: t.name }),
            el('b.tb', { text: t.burst ? ` 爆発力 +${t.burst}` : '' }),
            t.risk ? el('b.tr', { text: ` 危険度 +${t.risk}` }) : null,
            el('br'), el('small', { text: t.text }),
          ]))),
        ])
        : el('p.note', { text: '成立する配合理論は無い。' }),
      ev.factors.list.length
        ? el('div', [
          el('h4', { text: '受け継ぐ因子（3 代まで）' }),
          el('ul.inb.factors', ev.factors.list.map((x) => el('li', [
            el('i.fchip', { text: x.factor }), ` ${x.who.join('・')}`,
          ]))),
        ])
        : el('p.note', { text: '3 代までに因子を持つ名馬が居ない。' }),
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
        return undefined;
      }, { cls: 'primary big', disabled: g.world.player.money < ev.fee || !G.matingOpen(g) || !!dam.pregnancy || !!ev.blocked }),
      el('p.note', {
        text: dam.pregnancy ? `${dam.name} は受胎している（${dv.pregnancy.year}年 4 月に出産）。`
          : '種付けは 5〜6 月。6 月末に受胎が分かり、翌年 4 月に生まれる。不受胎なら種付料は返る。',
      }),
    ]));
  };

  budgetInput.addEventListener('input', renderList);
  search.addEventListener('input', renderList);
  renderList();
  renderEval();

  return el('div.cols2', [
    el('div.col', [
      seasonNote(g, G.matingOpen(g), '5〜6 月', '種付け'),
      card('繁殖牝馬', table(['馬名', '年齢', '父', '母の父', '戦績', '産駒', '予約・受胎'],
        mares.map((m) => {
          const v = G.horseView(g, m.id);
          const b = booked.get(m.id);
          return {
            cells: [
              el('b', { text: m.name }), `${v.age}歳`, v.sire, v.damSire,
              `${m.starts}戦${m.wins}勝`, `${(m.foals ?? []).length}頭`,
              b ? el('span.mine', { text: `予約 ${b.sire.name}` })
                : v.pregnancy ? el('span.win', { text: `受胎 ${v.pregnancy.sire}` }) : '—',
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
        el('p.note', { text: fm.abroadOk
          ? `名声 ${fm.fame}。海外の種牡馬にも種付けできる。`
          : `名声 ${fm.fame}。海外の種牡馬は名声 ${fm.need} から（レースに勝つと上がる。GI は +15、重賞は +5〜8）。` }),
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
      card('配合理論', [
        el('p.note', { text: '「ウイニングポスト 10 2026 攻略」の配合理論に合わせた。成り立った理論は爆発力（スピードの底上げ）とサブパラを上げ、近親やラインブリードは危険度が上がる。ウマソナ・ライバル・牝系・ドラマ因子・繋養地域に関わる理論はこのゲームには無い。' }),
        el('ul.howto', G.theoryGuide().map((t) => el('li', [el('b', { text: t.name }), el('br'), el('small', { text: t.text })]))),
      ]),
      card('配合の考えかた', el('ul.howto', [
        el('li', { text: '3×4 のインブリード（奇跡の血量）が効く。近すぎる配合は爆発力が大きいぶん、丈夫さと気性を削る（危険度）。' }),
        el('li', { text: '爆発力は、仔のスピードの底上げの上限。0〜(爆発力−1) の抽選で決まり、サブパラは理論ごとに上がる。' }),
        el('li', { text: 'ニックス（父系 × 母方の系統の相性）は産駒 12 頭ぶんの実績が出るまで「？」のまま。成立すると爆発力が上がる。' }),
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
  const ped = el('div.ped.mini', cols.map((cells) => el('div.ped-col', cells.map((n) =>
    el('div.ped-cell', { class: n ? (n.sex === '牡' ? 'male' : 'female') : 'blank' },
      n ? [el('span', { text: n.name }), pedMarks(n)] : el('span', { text: '—' }))))));
  return pedWithToggle(ped);
}

// ---------------------------------------------------------------- 種牡馬名鑑

function stallionBook(app) {
  const g = app.game;
  const ss = G.stallions(g);
  const list = ss.map((s) => s.id);
  return card(`種牡馬名鑑（${ss.length} 頭）`, table(
    ['種牡馬', '年齢', '系統', '因子', '種付料', '現役成績', '代表勝鞍', '獲得賞金', '産駒数'],
    ss.map((s) => ({
      cells: [
        sireName(s), `${s.age}歳`, s.line, factorChips(s.factors), formatMoney(s.fee),
        `${s.horse.starts}戦${s.horse.wins}勝`, s.bestWin ?? '—', formatMoney(s.earnings), `${s.foals}頭`,
      ],
      onclick: () => app.go('stable', { id: s.id, list }),
    })), { align: [, 'c', , , 'r', 'c', , 'r', 'c'] }));
}

/** 種牡馬名。実在の馬には小さな札を付ける（架空の馬と見分けられるように）。 */
function sireName(s) {
  return el('span.sire-n', [
    el('b', { text: s.name }),
    s.abroad ? el('i.foreigntag', { text: '海外', title: '海外で供用中（海外種付け）' }) : s.real ? el('i.realtag', { text: '実在' }) : null,
  ]);
}

/** 因子のしるし（スピード・スタミナ…）。 */
const factorChips = (list) => (list?.length
  ? el('span.fchips', list.map((f) => el('i.fchip', { text: f })))
  : '—');

// ---------------------------------------------------------------- 繁殖牝馬セール（10 月）

/**
 * 実在の名牝と、ほかの牧場の繁殖牝馬。代表産駒は実在の仔
 * （イクイノックスの母ならイクイノックス）を先に出す。受胎中の馬はお腹の仔ごと買う。
 */
function mareSaleView(app, kind = 'mare') {
  const g = app.game;
  const direct = kind === 'dMare';
  const lots = kind === 'mare' ? G.mareSale(g) : G.directSale(g, kind);
  const open = direct ? true : kind === 'pMare' ? G.saleOpen(g, 'private') : G.saleOpen(g, 'mare');
  const money = g.world.player.money;
  const list = lots.map((m) => m.id);
  const title = direct ? '繁殖牝馬（牧場取引）' : kind === 'pMare' ? '繁殖牝馬（庭先取引）' : '繁殖牝馬セール';
  return card(`${title}（${lots.length} 頭）`, [
    direct ? null : seasonNote(g, open, kind === 'pMare' ? '3 月・7 月・12 月' : '10 月', kind === 'pMare' ? '庭先取引' : '繁殖牝馬セール'),
    el('p.note', { text: kind === 'mare'
      ? '値段は格と年齢、母としての実績（GI 馬の母）、受胎していれば父の種付料で決まる。'
      : direct ? '値段は格と年齢、母としての実績で決まる（相対取引なのでセールより高い）。'
        : '庭先取引の開催中だけ、ほかの牧場が手放す繁殖牝馬を直接買える。' }),
    table(['繁殖牝馬', '年齢', '父', '母の父', '代表勝鞍', '代表産駒', '産駒', '受胎', '価格', ''],
      lots.map((m) => ({
        cells: [
          sireName(m), `${m.age}歳`, m.sire, m.damSire, m.bestWin ?? '—', m.bestFoal ?? '—', `${m.foals}頭`,
          m.inFoal ?? '空胎', formatMoney(m.price),
          m.sold ? el('span.mine', { text: '落札済み' }) : buyButton(app, kind, m, open && money >= m.price),
        ],
        onclick: () => app.go('stable', { id: m.id, list }),
      })), { align: [, 'c', , , , , 'c', , 'r'] }),
  ]);
}

/** 購入ボタン。確かめてから買い、結果を通知する。 */
function buyButton(app, kind, lot, enabled) {
  return button('購入', async (e) => {
    e.stopPropagation();
    if (!await ask(`${lot.name} を ${formatMoney(lot.price)} で購入する？`, { ok: '購入する' })) return;
    const r = G.buyLot(app.game, kind, lot.id);
    if (!r.ok) { toast(r.why, { bad: true }); return; }
    // 庭先の 1 歳馬は年明けに 2 歳で入厩し、幼駒から現役馬へ移る（名前もそのとき正式になる）。
    toast(kind === 'private' || kind === 'dYearling'
      ? `${lot.name} を購入した。年明けに 2 歳で入厩し、現役馬に移る`
      : `${lot.name} を ${formatMoney(r.price)} で購入した`);
    app.render();
  }, { cls: 'sm primary', disabled: !enabled });
}

// ---------------------------------------------------------------- 当歳セール（8 月）・庭先取引（12 月）

const SALE_TEXT = {
  foal: { title: '当歳セール（0 歳）', when: '8 月', what: '当歳セール',
    note: '今年 4 月に生まれた幼駒。見られるのは血統と馬体だけで、能力は走らせるまで分からない。' },
  private: { title: '庭先取引（1 歳）', when: '3 月・7 月・12 月', what: '庭先取引',
    note: 'セールで売れ残った 1 歳馬を牧場から直接買う。春（3 月）・夏（7 月）・冬（12 月）に開く。冬の 4 週が最終チャンス（年明けには入厩する）。' },
  dFoal: { title: '牧場取引：当歳（0 歳）', note: '4 月に生まれた幼駒を、いつでも直接買える。見られるのは血統と馬体だけ。' },
  dYearling: { title: '牧場取引：1 歳', note: '1 歳馬をいつでも直接買える。年明けに 2 歳で入厩し、現役馬に移る。' },
};

function horseSaleView(app, kind) {
  const g = app.game;
  const t = SALE_TEXT[kind];
  const direct = kind === 'dFoal' || kind === 'dYearling';
  const open = direct ? true : G.saleOpen(g, kind);
  const lots = direct ? G.directSale(g, kind) : kind === 'foal' ? G.foalSale(g) : G.privateSale(g);
  const money = g.world.player.money;
  return card(t.title, [
    direct ? null : seasonNote(g, open, t.when, t.what),
    el('p.note', { text: t.note }),
    lots.length ? table(['', '馬名', '性', '毛色', '父', '母', '母の父', '馬体', 'インブリード', '価格', ''],
      lots.map((x) => [
        horseImg(x.coat, { size: 'sm', age: x.age, title: `${x.name}（${x.coat}）` }),
        x.realName
          ? el('span.sire-n', [el('b', { text: x.name }), el('i.realtag', { text: `のちの${x.realName}`, title: '史実の名馬になる幼駒' })])
          : el('b', { text: x.name }),
        x.sex, x.coat,
        x.sireReal ? el('span.sire-n', [x.sire, el('i.realtag', { text: '実在' })]) : x.sire,
        x.damReal ? el('span.sire-n', [x.dam, el('i.realtag', { text: '実在' })]) : x.dam,
        x.damSire, x.look,
        (x.inbreed ?? []).slice(0, 2).join(' / ') || '—',
        formatMoney(x.price),
        x.sold ? el('span.mine', { text: '落札済み' }) : buyButton(app, kind, x, open && money >= x.price),
      ]), { align: ['c', , 'c', 'c', , , , 'c', , 'r'] })
      : el('p.empty', { text: kind === 'foal' || kind === 'dFoal' ? '上場馬が居ない（幼駒は 4 月に生まれる）。' : '上場馬が居ない。' }),
  ]);
}

// ---------------------------------------------------------------- 海外トレーニングセール（12 月 3 週）

function overseasView(app) {
  const g = app.game;
  const open = G.saleOpen(g, 'overseas');
  const lots = G.overseasSale(g);
  const money = g.world.player.money;
  return card('海外トレーニングセール', [
    seasonNote(g, open, '12 月 3 週', '海外トレーニングセール'),
    el('p.note', { text: '外国の 1 歳馬と繁殖牝馬。日本の血統と離れているので、配合の幅が広がる。海外の名牝（実在）も繁殖に上がっている年だけ上場される。' }),
    table(['', '区分', '馬名', '性齢', '毛色', '父', '母', '母の父', '価格', ''],
      lots.map((x) => [
        horseImg(x.coat, { size: 'sm', age: x.age, title: x.coat }),
        x.yearling ? '1歳馬' : '繁殖牝馬',
        el('span.sire-n', [
          el('b', { text: x.name }), el('i.foreigntag', { text: '外' }),
          x.realName ? el('i.realtag', { text: `のちの${x.realName}`, title: '史実の名馬になる 1 歳馬' }) : null,
          x.realMare ? el('i.realtag', { text: x.produce ? `${x.produce}の母` : '実在', title: '海外の名牝' }) : null,
        ]),
        `${x.sex}${x.age}`, x.coat, x.sireName, x.damName, x.damSireName, formatMoney(x.price),
        x.sold ? el('span.mine', { text: '落札済み' }) : button('購入', async () => {
          if (!await ask(`${x.name} を ${formatMoney(x.price)} で購入する？`, { ok: '購入する' })) return;
          const r = G.buyOverseas(g, x.key);
          if (!r.ok) { toast(r.why, { bad: true }); return; }
          toast(`${x.name} を ${formatMoney(r.price)} で購入した`);
          app.render();
        }, { cls: 'sm primary', disabled: !open || money < x.price }),
      ]), { align: ['c', 'c', , 'c', 'c', , , , 'r'] }),
  ]);
}

// ---------------------------------------------------------------- 入厩・馬名登録（12 月 4 週）

/**
 * 来年 2 歳になる自分の 1 歳馬の、入厩先（調教師）と馬名を決める。
 * 決めなければ年明けに調教師はくじで、馬名は生まれたときの候補で登録される。
 */
function entryView(app) {
  const g = app.game;
  const open = G.entryOpen(g);
  const cands = G.entryCandidates(g);
  const trainers = G.trainerChoices(g);
  return card('入厩・馬名登録（来年 2 歳）', [
    seasonNote(g, open, '12 月 4 週', '入厩先と馬名の決定'),
    el('p.note', { text: '決めなかった馬は、年明けに調教師をくじで決め、生まれたときの候補の名前で登録する。馬名はカタカナ 2〜9 文字。' }),
    cands.length ? table(['', 'いまの呼び名', '父', '母', '馬名', '入厩先'],
      cands.map((c) => {
        const input = el('input.inp', {
          type: 'text', value: c.plannedName ?? '', placeholder: c.suggested, maxLength: 9, disabled: !open,
        });
        input.addEventListener('change', () => {
          const r = G.planName(g, c.id, input.value);
          if (!r.ok) { toast(r.why, { bad: true }); input.value = c.plannedName ?? ''; return; }
          toast(`馬名を「${r.name}」にする`);
        });
        const sel = el('select.inp', { disabled: !open }, [
          el('option', { value: '', text: 'おまかせ（くじ）' }),
          ...trainers.map((t) => el('option', { value: String(t.id), text: `${t.name}（${t.region}・${t.wins}勝）` })),
        ]);
        sel.value = c.plannedTrainerId != null ? String(c.plannedTrainerId) : '';
        sel.addEventListener('change', () => {
          G.planTrainer(g, c.id, sel.value ? Number(sel.value) : null);
          toast(sel.value ? '入厩先を決めた' : '入厩先はくじで決める');
        });
        return [horseImg(c.coat, { size: 'xs', age: 1 }), el('b', { text: c.name }), c.sire, c.dam, input, sel];
      }))
      : el('p.empty', { text: '来年 2 歳になる馬が居ない。' }),
  ]);
}

// ---------------------------------------------------------------- 牧場施設

/**
 * 牧場施設。建てると自分の馬だけに効く。完成まで工期がかかり、完成後は毎週の維持費が要る。
 * 効果は小さいので、資金が少ないうちは先に馬を買うほうが得になる。
 */
function facilitiesView(app) {
  const g = app.game;
  const list = G.facilities(g);
  const sum = G.facilitySummary(g);
  const money = g.world.player.money;
  const building = list.filter((f) => f.build).length;
  const cardOf = (f) => {
    const pct = f.build ? Math.round((1 - f.build.weeksLeft / f.build.total) * 100) : 0;
    return el('div.fac', { class: f.level > 0 ? 'built' : null }, [
      el('div.fac-h', [
        el('span.fac-i', icon(f.icon, { size: 22 })),
        el('div', [el('b', { text: f.name }), el('small', { text: f.desc })]),
        el('span.fac-lv', { text: f.level ? `Lv ${f.level} / ${f.maxLevel}` : `未建設（最大 Lv ${f.maxLevel}）` }),
      ]),
      el('div.fac-pips', Array.from({ length: f.maxLevel }, (_, i) => el('i', { class: i < f.level ? 'on' : (f.build && i === f.level ? 'wip' : null) }))),
      f.current ? el('p.fac-now', { text: `いまの効果：${f.current.text}　維持費 ${f.upkeep}万/週` }) : null,
      f.build
        ? el('div.fac-wip', [
          el('span', { text: `Lv ${f.build.to} を建設中（あと ${f.build.weeksLeft} 週）` }),
          el('span.fac-bar', el('i', { style: `width:${pct}%` })),
        ])
        : f.next
          ? el('div.fac-next', [
            el('div', [
              el('b', { text: `次：Lv ${f.level + 1}` }),
              el('small', { text: `${f.next.text}` }),
              el('small', { text: `費用 ${formatMoney(f.next.cost)}・工期 ${f.next.weeks} 週・維持費 ${f.next.upkeep}万/週` }),
            ]),
            button('建設する', async () => {
              if (!await ask(`${f.name} Lv ${f.level + 1} を ${formatMoney(f.next.cost)} で建設する？（工期 ${f.next.weeks} 週）`, { ok: '建設する' })) return;
              const r = G.buildFacility(g, f.id);
              if (!r.ok) return toast(r.why, { bad: true });
              toast(`${r.name} Lv ${r.level} の建設を始めた（${r.weeks} 週）`);
              app.render();
            }, { cls: 'sm primary', disabled: !f.canBuild }),
          ])
          : el('p.fac-now', { text: '最大まで建てた' }),
      !f.canBuild && f.next && !f.build ? el('small.fac-why', { text: f.why }) : null,
    ]);
  };
  return card('牧場施設', [
    el('p.note', { text: `建てると自分の馬だけに効く（ほかの馬主の馬には効かない）。同時に建設できるのは ${G.facilityLimit} つまで。完成後は毎週の維持費が要る。` }),
    el('p.note', { text: `維持費の合計 ${sum.upkeep}万/週・建設中 ${building} つ・資金 ${formatMoney(money)}` }),
    el('div.fac-list', list.map(cardOf)),
  ]);
}
