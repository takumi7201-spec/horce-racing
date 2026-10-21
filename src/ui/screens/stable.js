// 所有馬の一覧と、1 頭の詳細（能力・適性・血統表・戦績・調教）。

import { el, card, table, button, kv, bar, modal, toast, frameChip, tabs } from '../dom.js';
import * as G from '../../sim/game.js';
import { formatMoney, formatTime, formatSec } from '../../core/util.js';
import { fitLabel, condLabel, MENUS } from '../../sim/training.js';
import { ABILITY_LABEL, ABILITIES, STYLES } from '../../sim/params.js';
import { horseImg } from '../horse-sprite.js';

export function stableScreen(app) {
  const g = app.game;
  if (app.params.id) return detail(app, app.params.id);

  const horses = G.myHorses(g);
  const mares = G.myBroodmares(g);
  const stallions = G.myStallions(g);

  return el('div', [
    card('現役（所有馬）', horses.length ? table(
      ['', '馬名', '性齢', '毛色', 'クラス', '脚質', '適距離', '状態', '仕上がり', '調子', '疲労', '戦績', '獲得賞金'],
      horses.map((h) => {
        const v = G.horseView(g, h.id);
        return {
          cells: [
            horseImg(h.coat, { size: 'xs', age: v.age, title: `${h.name}（${h.coat}）` }),
            el('b', { text: h.name }),
            `${h.sex}${v.age}`,
            h.coat,
            v.className,
            v.style,
            `${h.dist}m`,
            v.injury ? el('span.bad', { text: `${v.injury.name} 残${v.injury.weeks}週` })
              : v.stable === 'stable' ? '在厩' : '放牧',
            fitLabel(v.fit),
            condLabel(v.cond),
            bar(v.fatigue, { color: v.fatigue > 0.6 ? '#c75' : '#687' }),
            `${h.starts}戦${h.wins}勝`,
            formatMoney(h.earnings),
          ],
          onclick: () => app.go('stable', { id: h.id }),
        };
      }),
      { align: ['c', , 'c', 'c', 'c', 'c', 'c', 'c', 'c', 'c', 'c', 'c', 'r'] },
    ) : el('p.empty', { text: '現役の所有馬が居ない。' })),

    card('繁殖牝馬', mares.length ? table(
      ['馬名', '年齢', '父', '母', '戦績', '産駒', ''],
      mares.map((m) => {
        const v = G.horseView(g, m.id);
        return {
          cells: [
            el('b', { text: m.name }),
            `${v.age}歳`,
            v.sire, v.dam,
            `${m.starts}戦${m.wins}勝`,
            `${(m.foals ?? []).length}頭`,
            button('配合', (e) => { e.stopPropagation(); app.go('farm', { damId: m.id }); }, { cls: 'sm' }),
          ],
          onclick: () => app.go('stable', { id: m.id }),
        };
      }), { align: [, 'c', , , 'c', 'c'] },
    ) : el('p.empty', { text: '繁殖牝馬が居ない。' })),

    stallions.length ? card('種牡馬', table(
      ['馬名', '年齢', '種付料', '産駒', '戦績'],
      stallions.map((s) => {
        const v = G.horseView(g, s.id);
        return {
          cells: [el('b', { text: s.name }), `${v.age}歳`, formatMoney(s.studFee ?? 0),
            `${(s.foals ?? []).length}頭`, `${s.starts}戦${s.wins}勝`],
          onclick: () => app.go('stable', { id: s.id }),
        };
      }), { align: [, 'c', 'r', 'c', 'c'] },
    )) : null,
  ]);
}

// ---------------------------------------------------------------- 詳細

function detail(app, id) {
  const g = app.game;
  const v = G.horseView(g, id);
  if (!v) return el('p.empty', { text: '馬が見つからない' });
  const h = v.horse;
  const mine = v.isMine;

  return el('div', [
    el('div.detail-h', [
      button('← 戻る', () => app.back(), { cls: 'ghost sm' }),
      horseImg(h.coat, { size: 'lg', age: v.age, title: h.coat }),
      el('h1', [
        v.name,
        el('span.sub', { text: ` ${h.sex}${v.age}　${h.coat}　${standing(v)}` }),
      ]),
      v.titles.length ? el('div.badges', v.titles.map((t) => el('span.badge', { text: t }))) : null,
    ]),

    el('div.cols2', [
      el('div.col', [
        card('能力', [
          el('div.abil', ABILITIES.map((a) => el('div.abil-row', [
            el('span.abil-l', { text: ABILITY_LABEL[a] }),
            el('span.abil-r', { text: v.ranks[a] }),
            bar(v.values[a]),
          ]))),
          el('p.note', { text: '評価は「いま出せる力」。潜在能力は見えない。調教と出走で近づく。' }),
          kv([
            ['成長型', v.growth],
            ['脚質', v.style],
            ['気性', tempLabel(v.temper)],
            ['丈夫さ', soundLabel(v.sound)],
            ['底力', soundLabel(v.spirit)],
          ], { cls: 'tight' }),
        ]),

        card('適性', [
          el('div.apt-surf', [
            bar(v.turf, { label: '芝' }),
            bar(v.dirt, { label: 'ダート' }),
            bar(v.firm, { label: '良' }),
            bar(v.soft, { label: '重' }),
          ]),
          el('h3', { text: `距離（最適 ${v.dist}m）` }),
          distChart(g, h),
        ]),

        card('血統', pedigreeTable(g, id)),
      ]),

      el('div.col', [
        mine && !v.retired ? card('調教と厩舎', [
          kv([
            ['所属', `${v.trainer}（${v.trainerStyle}）`],
            ['主戦騎手', v.jockey],
            ['状態', v.injury ? el('span.bad', { text: `${v.injury.name} 残り${v.injury.weeks}週` })
              : v.stable === 'stable' ? '在厩' : '放牧'],
            ['仕上がり', `${fitLabel(v.fit)}（${(v.fit * 100).toFixed(0)}%）`],
            ['調子', v.condLabel],
            ['疲労', bar(v.fatigue, { color: v.fatigue > 0.6 ? '#c75' : '#687' })],
          ]),
          el('div.row-btns', [
            v.stable === 'stable'
              ? button('放牧に出す', () => { G.setStable(g, id, 'pasture'); app.render(); }, { cls: 'sm' })
              : button('入厩させる', () => {
                if (!G.setStable(g, id, 'stable')) return toast('いま入厩できない', { bad: true });
                app.render();
              }, { cls: 'sm primary', disabled: !!v.injury }),
            button('騎手を変える', () => pickJockey(app, id), { cls: 'sm' }),
            button('引退させる', () => {
              if (!confirm(`${v.name} を引退させる？`)) return;
              G.retire(g, id);
              toast(`${v.name} を引退させた`);
              app.go('stable');
            }, { cls: 'sm ghost' }),
          ]),
          el('h3', { text: '調教メニュー' }),
          el('div.menus', MENUS.map((m) => el('button.menu', {
            class: v.menu === m.id ? 'on' : null,
            disabled: v.stable !== 'stable' || !!v.injury,
            onclick: () => { G.setTraining(g, id, m.id); app.render(); },
          }, [
            el('b', { text: m.name }),
            el('span', { text: m.desc }),
          ]))),
          el('p.note', { text: v.ready.ok ? '出走できる状態。' : `出走不可：${v.ready.why}` }),
          button('出走登録', () => entryModal(app, id), {
            cls: 'primary', disabled: !v.ready.ok,
          }),
        ]) : null,

        card('戦績', v.record.length ? table(
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
        ) : el('p.empty', { text: 'まだ出走していない。' })),

        v.record.length ? card('レース回顧', el('ul.comments', v.record.slice(0, 8).map((r) =>
          el('li', [el('b', { text: `${r.name} ${r.order}着　` }), r.comment ?? '']),
        ))) : null,

        (v.foals ?? []).length ? card('産駒', table(['馬名', '生年', '性', '戦績', '獲得賞金'],
          v.foals.map((f) => ({
            cells: [f.name, f.birthYear, f.sex, `${f.starts}戦${f.wins}勝`, formatMoney(f.earnings)],
            onclick: () => app.go('stable', { id: f.id }),
          })), { align: [, 'c', 'c', 'c', 'r'] })) : null,

        v.inbreed.length ? card('インブリード', el('ul.inb', v.inbreed.map((x) => el('li', { text: x })))) : null,
      ]),
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

const tempLabel = (t) => (t > 0.78 ? '素直' : t > 0.58 ? '普通' : t > 0.38 ? 'やや難' : '気難しい');
const soundLabel = (s) => (s > 0.78 ? '◎' : s > 0.6 ? '○' : s > 0.42 ? '△' : '▲');

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
