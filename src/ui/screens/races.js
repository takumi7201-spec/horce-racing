// 番組表。今週のレース、先の週、年間の重賞日程。

import { el, card, table, button, tabs, modal, bar, toast } from '../dom.js';
import * as G from '../../sim/game.js';
import { formatMoney } from '../../core/util.js';
import { weekLabel } from '../../sim/schedule.js';
import { entryModal } from './stable.js';
import { STYLES } from '../../sim/params.js';

const SHORT = {
  tokyo: '東京', nakayama: '中山', hanshin: '阪神', kyoto: '京都', chukyo: '中京',
  niigata: '新潟', sapporo: '札幌', hakodate: '函館', fukushima: '福島', kokura: '小倉',
};

export function racesScreen(app) {
  const g = app.game;
  const mode = app.params.tab ?? 'week';
  const body = el('div');

  const nav = tabs([
    { id: 'week', name: '今週の番組' },
    { id: 'ahead', name: '先の週' },
    { id: 'graded', name: '重賞日程' },
    { id: 'results', name: '先週の結果' },
  ], mode, (id) => app.go('races', { tab: id }));

  if (mode === 'week') {
    app.raceWeek ??= 0;
    body.appendChild(weekPicker(app));
    body.appendChild(weekTable(app, app.raceWeek));
  }
  else if (mode === 'ahead') body.appendChild(ahead(app));
  else if (mode === 'graded') body.appendChild(gradedTable(app));
  else body.appendChild(resultsTable(app));

  return el('div', [nav, body]);
}

function weekTable(app, offset) {
  const g = app.game;
  const t = G.now(g);
  const sch = G.schedule(g, offset + 1)[offset];
  const entries = new Map(G.myEntries(g).map((e) => [e.raceId, e]));
  const horses = G.myHorses(g);

  const rows = sch.races
    .slice()
    .sort((a, b) => (b.graded ? 1 : 0) - (a.graded ? 1 : 0) || a.courseId.localeCompare(b.courseId))
    .map((r) => {
      const ent = entries.get(r.raceId);
      // この馬たちなら出られる、という候補を出す。
      const cands = horses.filter((h) => {
        const list = G.racesFor(g, h.id, offset);
        return list.some((x) => x.raceId === r.raceId);
      });
      return {
        cells: [
          el('span', { text: r.name, class: r.grade ? 'grade' : null }),
          r.grade ?? r.className,
          SHORT[r.courseId] ?? r.courseId,
          `${r.surface}${r.distance}m`,
          `${r.ageLabel}${r.sexLabel}`,
          formatMoney(r.prize),
          ent ? el('b.mine', { text: ent.horse.name }) : (cands.length ? `${cands.length}頭 可` : '—'),
          ent
            ? button('取消', () => { G.cancelEntry(g, r.raceId); app.render(); }, { cls: 'sm ghost' })
            : (cands.length
              ? button('登録', () => pickHorse(app, r, cands, offset), { cls: 'sm primary' })
              : null),
        ],
        cls: r.graded ? 'graded-row' : null,
      };
    });

  return card(`${sch.year}年 ${sch.label} の番組（${sch.races.length} レース）${offset ? `・${offset}週後` : '・今週'}`,
    table(['レース', '条件', '場', '距離', '出走資格', '1着賞金', '登録', ''], rows,
      { align: [, 'c', 'c', 'c', 'c', 'r', 'c'] }));
}

function ahead(app) {
  const g = app.game;
  const sch = G.schedule(g, 5);
  return el('div', sch.slice(1).map((wk) => card(`${wk.year}年 ${wk.label}`,
    table(['レース', '条件', '場', '距離', '出走資格', '1着賞金'],
      wk.races.filter((r) => r.graded).map((r) => [
        el('span', { text: r.name, class: 'grade' }),
        r.grade, SHORT[r.courseId] ?? r.courseId, `${r.surface}${r.distance}m`,
        `${r.ageLabel}${r.sexLabel}`, formatMoney(r.prize),
      ]), { align: [, 'c', 'c', 'c', 'c', 'r'] }),
  )));
}

function gradedTable(app) {
  const g = app.game;
  const cal = G.calendar();
  const hist = G.gradedHistory(g);
  const byDef = new Map();
  for (const h of hist) {
    if (!byDef.has(h.defId)) byDef.set(h.defId, []);
    byDef.get(h.defId).push(h);
  }
  const rows = cal.map((r) => {
    const past = (byDef.get(r.id) ?? []).sort((a, b) => b.year - a.year);
    return {
      cells: [
        weekLabel(r.week),
        el('span', { text: r.name, class: r.grade === 'GI' ? 'grade g1' : 'grade' }),
        r.grade,
        SHORT[r.courseId] ?? r.courseId,
        `${r.surface}${r.distance}m`,
        r.age[1] >= 99 ? `${r.age[0]}歳以上` : `${r.age[0]}歳`,
        r.sex === '牝' ? '牝' : '',
        formatMoney(r.prize),
        past.length ? `${past[0].year} ${past[0].winner}` : '—',
      ],
      onclick: past.length ? () => showHistory(r, past) : null,
    };
  });
  return card('年間の重賞日程', [
    table(['時期', 'レース名', '格', '場', '距離', '年齢', '性', '1着賞金', '前回の勝ち馬'], rows,
      { align: ['c', , 'c', 'c', 'c', 'c', 'c', 'r'] }),
    el('p.note', { text: '行をクリックすると歴代の勝ち馬が見られる。' }),
  ]);
}

function showHistory(def, past) {
  modal(`${def.name} 歴代勝ち馬`, table(['年', '勝ち馬', '騎手', '時計', '頭数'],
    past.map((h) => [h.year, h.winner, h.jockey, h.time.toFixed(1), `${h.field}頭`]),
    { align: ['c', , , 'c', 'c'] }));
}

function resultsTable(app) {
  const g = app.game;
  const res = G.recentResults(g);
  if (!res.length) return card('先週の結果', el('p.empty', { text: 'まだ結果が無い。週を進めると出る。' }));
  return card('先週の結果', table(
    ['レース', '格', '場', '距離', '馬場', '1着', '騎手', '時計', 'ペース', ''],
    res.map((r) => ({
      cells: [
        el('span', { text: r.name, class: r.grade ? 'grade' : null }),
        r.grade ?? '', SHORT[r.courseId] ?? r.courseId, `${r.surface}${r.distance}`,
        r.ground, r.results[0].name, r.results[0].jockeyName,
        r.winnerTime.toFixed(1), r.pace?.label ?? '—',
        el('div.row-btns', [
          button('着順', () => showResult(r), { cls: 'sm' }),
          r.log ? button('観戦', () => app.go('raceday', { races: [r] }), { cls: 'sm primary' }) : null,
        ]),
      ],
      cls: r.results.some((x) => g.world.horses.get(x.horseId)?.ownerId === 'player') ? 'mine' : null,
    })), { align: [, 'c', 'c', 'c', 'c', , , 'c', 'c'] }));
}

export function showResult(r) {
  return modal(`${r.name}（${r.courseName}${r.surface}${r.distance}m・${r.ground}）`, [
    el('p.note', {
      text: `勝ち時計 ${r.winnerTime.toFixed(1)}　ペース ${r.pace?.label ?? '—'}`
        + (Number.isFinite(r.pace?.first) ? `（前半 ${r.pace.first.toFixed(1)} / 後半 ${r.pace.last.toFixed(1)}）` : ''),
    }),
    table(['着', '馬番', '馬名', '性齢', '斤量', '騎手', 'タイム', '着差', '上3F', '通過', '人気', 'オッズ', '脚質', '備考'],
      r.results.map((x) => [
        el('b', { text: String(x.order), class: x.order === 1 ? 'win' : null }),
        String(x.gate), x.name, `${x.sex}${x.age}`, x.weight, x.jockeyName,
        x.time.toFixed(1), x.margin, x.last3f.toFixed(1),
        (x.passing ?? []).join('-'), x.popularity ? `${x.popularity}` : '—',
        x.odds ? x.odds.toFixed(1) : '—', x.styleLabel, x.comment,
      ]), { align: ['c', 'c', , 'c', 'c', , 'c', 'c', 'c', 'c', 'c', 'c', 'c'] }),
  ], { wide: true });
}

function pickHorse(app, race, cands, offset = 0) {
  const g = app.game;
  const jockeySel = el('select.inp');
  for (const j of G.availableJockeys(g, 40)) {
    jockeySel.appendChild(el('option', {
      value: String(j.id),
      text: `${j.name}（${'★'.repeat(Math.max(1, Math.round(j.skill * 5)))}）`,
    }));
  }
  const styleSel = el('select.inp', [
    el('option', { value: '', text: '指示なし（馬の持ち味）' }),
    ...STYLES.map((s) => el('option', { value: s, text: s })),
  ]);
  const m = modal(`${race.name}（${SHORT[race.courseId]}${race.surface}${race.distance}m）に登録`, [
    el('div.form-row', [
      el('label', ['騎手', jockeySel]),
      el('label', ['脚質指示', styleSel]),
    ]),
    table(['馬名', '性齢', 'クラス', '仕上がり', '調子', '適性', ''],
      cands.map((h) => {
        const v = G.horseView(g, h.id);
        const r = G.racesFor(g, h.id, offset).find((x) => x.raceId === race.raceId);
        return [
          el('b', { text: h.name }), `${h.sex}${v.age}`, v.className,
          v.fitLabel, v.condLabel, bar(r?.apt ?? 0),
          button('登録', () => {
            const res = G.enterRace(g, h.id, race.raceId, {
              jockeyId: Number(jockeySel.value),
              styleOrder: styleSel.value || null,
            });
            if (!res.ok) return toast(res.why, { bad: true });
            toast(`${h.name} を ${race.name} に登録した`);
            m.close();
            app.render();
          }, { cls: 'sm primary' }),
        ];
      }), { align: [, 'c', 'c', 'c', 'c', 'c'] }),
    el('p.note', { text: '主戦騎手が決まっている馬でも、ここで別の騎手を指名できる。' }),
  ], { wide: true });
  // 先頭の馬の主戦騎手を初期値にする。
  if (cands[0]?.jockeyId != null) jockeySel.value = String(cands[0].jockeyId);
}

/**
 * 番組表の週の選択。今週から 1 年先まで、前後の送りと「重賞のある週」へのジャンプ。
 * 先の週のレースにも登録できる（その週に出走資格と体調を見直す）。
 */
function weekPicker(app) {
  const g = app.game;
  const horizon = G.ENTRY_HORIZON;
  const set = (n) => { app.raceWeek = Math.max(0, Math.min(horizon - 1, n)); app.render(); };
  const weeks = G.schedule(g, horizon);
  const sel = el('select.inp', {
    onchange: (e) => set(Number(e.target.value)),
  }, weeks.map((w, i) => {
    const gr = w.races.filter((r) => r.graded).length;
    return el('option', {
      value: String(i), selected: i === app.raceWeek,
      text: `${i === 0 ? '今週' : `${i}週後`}　${w.year}年 ${w.label}${gr ? `（重賞${gr}）` : ''}`,
    });
  }));
  const jump = (dir) => {
    for (let i = app.raceWeek + dir; i >= 0 && i < horizon; i += dir) {
      if (weeks[i].races.some((r) => r.graded)) return set(i);
    }
    return null;
  };
  return el('div.week-picker', [
    button('◀', () => set(app.raceWeek - 1), { cls: 'sm', disabled: app.raceWeek === 0 }),
    sel,
    button('▶', () => set(app.raceWeek + 1), { cls: 'sm', disabled: app.raceWeek >= horizon - 1 }),
    button('前の重賞', () => jump(-1), { cls: 'sm ghost' }),
    button('次の重賞', () => jump(1), { cls: 'sm ghost' }),
    button('今週', () => set(0), { cls: 'sm ghost' }),
  ]);
}
