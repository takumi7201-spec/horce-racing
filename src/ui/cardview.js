// カード 1 枚の見た目。630×880 で組み、外側の枠で縮める（文字の大きさを保ったまま一覧に並べられる）。
// 絵は render3d/cardart.js が撮って返すまで、暗い地に名前だけで出しておく。
// レア度ごとの枠・差し色・ホロ・箔は CSS の変数で切り替える（styles.css の .tc）。

import { el } from './dom.js';
import { cardArt } from '../render3d/cardart.js';
import { plusOf, cardPower, distCat, STATS, STAT_SHORT, PACKS, CARDS, skillInfo } from '../sim/ikusei.js';

/** 弾の見出し（イベントの報酬は弾ではないので「イベント報酬」）。 */
const packLine = (c) => (c.myCard ? 'マイカード' : c.pack in PACKS ? `第${c.pack.slice(1)}弾【${PACKS[c.pack]}】` : c.pack === 'LT' ? '期間限定' : 'イベント報酬');

const THEME = {
  N: { frame: 'linear-gradient(135deg,#d9f5c8 0%,#5fae4a 20%,#c8eeb0 38%,#3f8a34 56%,#a6dc8a 74%,#2f6e28 90%,#9fd682 100%)', line: '#9fdc84', glow: '#7fd06a33', ink: '#e8ffd8', sparks: 0, rays: 0, sun: 0.25, badge: 'linear-gradient(#e6ffd6,#5cae48)', badgeInk: '#103a10' },
  R: { frame: 'linear-gradient(135deg,#ffe2c4 0%,#b06a32 18%,#f2c08e 34%,#8a4a1e 52%,#e0a066 70%,#6e3814 86%,#d89a62 100%)', line: '#e6a874', glow: '#e0905a44', ink: '#ffe6cc', sparks: 4, rays: 0.2, sun: 0.35, badge: 'linear-gradient(#ffe0c0,#b06a32)', badgeInk: '#3a1a04' },
  SR: { frame: 'linear-gradient(135deg,#ffffff 0%,#a9b0bc 18%,#f4f6fa 34%,#7d8592 52%,#e6e9ef 70%,#666e7a 86%,#d6dae2 100%)', line: '#dfe5ee', glow: '#cfe0ff55', ink: '#eef4ff', sparks: 7, rays: 0.3, sun: 0.4, badge: 'linear-gradient(#ffffff,#9aa2ae)', badgeInk: '#1c222c' },
  SSR: { frame: 'linear-gradient(135deg,#fff6c8 0%,#d6a83a 18%,#fff9d6 34%,#b8862a 52%,#ffeaa0 70%,#a87a22 86%,#f6dc84 100%)', line: '#f2d47a', glow: '#ffd76a77', ink: '#ffe9a8', sparks: 10, rays: 0.4, sun: 0.45, badge: 'linear-gradient(#fffbe0,#ffd04a 55%,#c08a1c)', badgeInk: '#3a2600' },
  LM: { frame: 'conic-gradient(from 30deg,#ff5e7e,#ffb347,#fff35c,#6dff9a,#4fd8ff,#7a7bff,#d36bff,#ff5e7e)', line: '#ffffff', glow: '#b08cff88', ink: '#ffffff', sparks: 12, rays: 0.45, sun: 0.5, badge: 'conic-gradient(from 0deg,#ff5e7e,#ffb347,#fff35c,#6dff9a,#4fd8ff,#7a7bff,#d36bff,#ff5e7e)', badgeInk: '#ffffff' },
};
// ホログラフィック（R 以上）。背景と馬の間に挟む（馬に掛けると縞になった）。色はレア度、模様（HOLO_KINDS）はカードごと。
// 強さ（op）は以前の半分強（R 0.30・SR 0.38・SSR 0.46・LM 0.62 → 0.17〜0.33）。テカリが強く馬が見にくかった（「カードのテカリを弱くして、モデルを見やすく」）
const HOLO = {
  R: { op: 0.17, cols: ['#ff8a3d', '#ffd23d', '#ff5f9e', '#3dc9ff', '#ff8a3d'] },
  SR: { op: 0.21, cols: ['#4fa8ff', '#b07aff', '#4fffd2', '#ffffff', '#7ab8ff'] },
  SSR: { op: 0.25, cols: ['#ffc23d', '#ff5fa8', '#ffe85c', '#3de0ff', '#ff9a3d'] },
  LM: { op: 0.33, cols: ['#ff3d7f', '#ffb23d', '#e8ff3d', '#3dff8a', '#3dc9ff', '#9a5cff'] },
};
/** 色を len（px・deg）で一巡させる止め位置。 */
const band = (cols, len, unit) => [...cols, cols[0]].map((x, i, a) => `${x} ${Math.round((i / (a.length - 1)) * len)}${unit}`).join(',');
const alpha = (hex, a) => `${hex}${a}`;
/**
 * ホロの模様。img と size はどちらも層の並び（CSS の background の複数指定）。
 * 傾けると background-position が動くので、タイルにしない層は 200% にしておく（端の継ぎ目を見せない）。
 */
const HOLO_KINDS = {
  rainbow: { name: '虹の縞', make: (c) => [`repeating-linear-gradient(115deg,${band(c, 120, 'px')})`, '200% 200%'] },
  wave: { name: '波紋', make: (c) => [`repeating-radial-gradient(circle at 50% 45%,${band(c, 90, 'px')})`, '200% 200%'] },
  sunburst: { name: '放射', make: (c) => [`repeating-conic-gradient(from 0deg at 50% 45%,${band(c, 24, 'deg')})`, '200% 200%'] },
  glitter: {
    name: 'ラメ',
    make: (c) => [[
      'radial-gradient(circle,#fff 0 1.4px,transparent 2.4px)', `radial-gradient(circle,${c[1]} 0 2px,transparent 3.2px)`,
      `radial-gradient(circle,${c[3]} 0 1.6px,transparent 2.8px)`, 'radial-gradient(circle,#fffbe0 0 2.6px,transparent 4.5px)',
    ].join(','), '13px 13px,19px 23px,29px 25px,61px 53px'],
  },
  prism: {
    name: 'プリズム',
    make: (c) => [[
      'repeating-linear-gradient(60deg,#fffa 0 2px,transparent 2px 38px)', 'repeating-linear-gradient(-60deg,#fffa 0 2px,transparent 2px 38px)',
      `repeating-linear-gradient(90deg,${band(c, 180, 'px')})`,
    ].join(','), '200% 200%,200% 200%,200% 200%'],
  },
  cracked: {
    name: 'クラックドアイス',
    make: (c) => [[
      `repeating-conic-gradient(from 71deg at 60% 55%,${alpha(c[3], 'cc')} 0 29deg,transparent 29deg 47deg,#fff 47deg 49deg,${alpha(c[1], 'cc')} 49deg 76deg,transparent 76deg 101deg)`,
      `repeating-conic-gradient(from 13deg at 30% 40%,${c[0]} 0 17deg,#fff 17deg 18deg,${c[2]} 18deg 41deg,${c[4]} 41deg 58deg,#fff 58deg 59deg,${c[1]} 59deg 90deg,${c[3]} 90deg 113deg)`,
    ].join(','), '170px 110px,120px 140px'],
  },
  galaxy: {
    name: '銀河',
    make: (c) => [[
      'radial-gradient(circle,#fff 0 1px,transparent 1.8px)', 'radial-gradient(circle,#fff 0 1.6px,transparent 2.6px)', 'radial-gradient(circle,#fffbe0 0 2.4px,transparent 4.5px)',
      `radial-gradient(ellipse at 30% 30%,${c[1]},transparent 45%)`, `radial-gradient(ellipse at 70% 60%,${c[4]},transparent 45%)`,
      `radial-gradient(ellipse at 45% 85%,${c[2]},transparent 50%)`,
    ].join(','), '7px 9px,19px 23px,53px 47px,200% 200%,200% 200%,200% 200%'],
  },
  aurora: {
    name: 'オーロラ',
    make: (c) => [[
      'repeating-linear-gradient(100deg,#fff6 0 3px,transparent 3px 22px)',
      `linear-gradient(170deg,transparent 4%,${c[0]} 18%,transparent 30%,${c[2]} 42%,transparent 54%,${c[4]} 66%,transparent 78%,${c[5] ?? c[1]} 90%)`, `radial-gradient(ellipse 60% 30% at 50% 35%,${alpha(c[3], '99')},transparent 70%)`,
    ].join(','), '200% 200%,200% 200%,200% 200%'],
  },
};
/** レア度ごとに出る模様。上のレア度ほど凝った模様が出る（LM だけのオーロラ）。 */
const HOLO_POOL = {
  R: ['rainbow', 'wave', 'sunburst'],
  SR: ['rainbow', 'wave', 'sunburst', 'glitter', 'prism'],
  SSR: ['glitter', 'prism', 'cracked', 'galaxy', 'sunburst'],
  LM: ['galaxy', 'cracked', 'aurora', 'prism'],
};
/** カードのホロの模様（id で決める。引き直しても同じカードは同じ模様）。N は無し。 */
export function holoOf(c) {
  const pool = HOLO_POOL[c.rar];
  if (!pool) return null;
  let h = 0;
  for (const ch of c.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[h % pool.length];
}
export const holoName = (kind) => HOLO_KINDS[kind]?.name ?? null;
// 箔押し（SSR 以上）。LM は虹の箔。
const FOIL = {
  SSR: 'linear-gradient(100deg,#6e4a0c 0%,#c99a2e 10%,#f7e08a 20%,#fffbe6 27%,#d9ad45 36%,#8a6216 48%,#e8c56a 60%,#fff6d0 70%,#c39532 82%,#7a5410 100%)',
  LM: 'linear-gradient(100deg,#7a5cff 0%,#ffb0e0 12%,#ffffff 20%,#7ae0ff 30%,#b8ffd8 42%,#fff2a0 52%,#ffa8c8 63%,#ffffff 71%,#a88cff 84%,#5ac8ff 100%)',
};
const EPI = { speed: '疾風', stamina: '無尽', power: '剛脚', guts: '不屈', wit: '叡智' };
const NOUN = { LM: ['帝王', '女帝'], SSR: ['覇者', '女王'], SR: ['強豪', '女傑'], R: ['刺客', '才媛'], N: ['挑戦者', '新星'] };
const GROUNDS = ['良', '稍重', '重', '不良'];
/** 弾ごとの枚数（カードの下の「No.xx/枚数」）。 */
const PACK_SIZE = CARDS.reduce((m, c) => ({ ...m, [c.pack]: (m[c.pack] ?? 0) + 1 }), {});
const mark = (a) => (a >= 0.8 ? '◎' : a >= 0.7 ? '○' : a >= 0.6 ? '△' : '×');

export const epithetOf = (c) => {
  // カードに二つ名が書いてあればそれ（ファンタスティックライト「その煌めきは幻想が如く」）。
  if (c.epithet) return c.epithet;
  const best = Object.keys(EPI).sort((a, b) => c.v[b] - c.v[a])[0];
  return `${EPI[best]}の${c.race.venue}${NOUN[c.rar][c.sex === '牝' ? 1 : 0]}`;
};

/**
 * カード 1 枚。scale は 630×880 に対する倍率。opts.onClick を渡すと押せる。
 * opts.count があれば右上に枚数、opts.dim で暗く（持っていないカード）。
 */
/**
 * back：裏面に出すスキル { unique: {name, desc} | null, race: [id], support: [id], plus: {race: Set, support: Set}（覚醒で増えた印）, note }。
 * 渡すと、左へスワイプで裏・右へスワイプで表に返る（大きく見る画面だけ）。wrap.flip(true/false) でも返せる。
 * awaken：持っているカードの覚醒の段（0〜4）。渡すと下の欄の獲得方法（弾・期間限定・イベント報酬）の代わりに覚醒を出す。
 */
export function cardView(c, { scale = 0.4, onClick = null, count = 0, dim = false, badge = null, holo = null, tilt = 'hover', eager = false, back = null, awaken = null } = {}) {
  const T = THEME[c.rar];
  const H = HOLO[c.rar];
  const foil = FOIL[c.rar] ?? null;
  const kind = H ? holo ?? holoOf(c) : null;
  const [holoBg, holoSize] = kind ? HOLO_KINDS[kind].make(H.cols) : ['none', 'auto'];
  const plus = plusOf(c);
  const surf = c.turf >= c.dirt ? '芝' : 'ダート';
  const fe = (t) => (foil ? `${t} foil` : t);
  const vars = {
    '--frame': T.frame, '--line': T.line, '--glow': T.glow, '--ink': T.ink, '--badge': T.badge, '--badge-ink': T.badgeInk,
    '--holo': holoBg, '--holo-size': holoSize, '--hop': H?.op ?? 0, '--foil': foil ?? 'none', '--sun': T.sun,
  };
  const art = el('div.tc-art', [el('div.b'), el('div.hb'), el('div.hbg'), el('div.hb2'), el('div.xb'), el('div.f'), el('div.vg'), el('div.xf'), el('div.olr')]);
  const sparks = el('div.tc-sparks', Array.from({ length: T.sparks }, (_, i) => {
    const x = (i * 37 + 11) % 100, y = (i * 53 + 7) % 62, s = 6 + ((i * 7) % 14), o = 0.5 + ((i * 13) % 5) / 10;
    return el('i.sp', { style: `left:${x}%;top:${y}%;width:${s}px;height:${s}px;opacity:${o}` });
  }));
  const grounds = GROUNDS.map((g, i) => {
    const a = c.firm + (c.soft - c.firm) * (i / 3);
    const m = mark(a);
    return el(`span.gd.g${m === '◎' ? 'best' : m === '○' ? 'good' : m === '△' ? 'mid' : 'bad'}`, [el('i', { text: m }), g]);
  });
  // 自分のカード（完成馬、sim/ikusei.js の finishedCard）は育成の戦績を出す。id は 'B12' や元のカードの id なので番号は持たない
  const tot = c.myCard ? `${c.record}（重賞 ${c.graded}・GI ${c.gi}）` : c.rar === 'N' && !c.travel ? 'オープン級' : c.rar === 'R' || c.rar === 'N' ? `重賞 ${c.graded}勝` : `通算 GI ${c.gi}勝`;
  const no = Number(c.id.split('-')[1]);
  const foot = c.myCard
    ? [el('span', { text: `${packLine(c)}　${c.race.year} ${c.race.name}${c.race.won ? ' 優勝' : ''}` }), el('span', { text: 'ORIGINAL' })]
    : [awaken != null
      ? el('span.awk', [el('b', { text: awaken >= 4 ? '覚醒 MAX' : `覚醒 ${awaken}` }), el('i', { text: '◆'.repeat(awaken) + '◇'.repeat(4 - awaken) }), `　${c.race.year} ${c.race.name} 優勝`])
      : el('span', { text: `${packLine(c)}　${c.race.year} ${c.race.name} 優勝` }), el('span', { text: `No.${String(no).padStart(2, '0')}/${PACK_SIZE[c.pack]}` })];
  const card = el(`div.tc.r-${c.rar}${foil ? '.foiled' : ''}`, { style: Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';') }, [
    el('div.tc-in', [
      // 絵の上に光（日の光芒・暖色の照り）は重ねない。明るく照らすと馬が白っぽく沈み、模様と溶けて見にくかった（「カードは照らさなくていい」）
      art, sparks,
      el('div.tc-race', [
        el(`b${foil ? '.foil' : ''}`, { text: c.race.name, style: `font-size:${c.race.name.length > 16 ? 19 : c.race.name.length > 12 ? 24 : 30}px` }),
        el('small', { text: c.race.info }),
        c.travel ? el('em.trv', { text: c.travel }) : null,
      ]),
      el('div.tc-rar', { text: c.rar }),
      el('div.tc-band', [
        el('div.who', [el(`span.${fe('epi').replace(' ', '.')}`, { text: epithetOf(c) }), el(`span.${fe('nm').replace(' ', '.')}`, { text: c.name })]),
        el('span.meta', { text: `${c.sex}${c.age}　${c.coat}` }),
      ]),
      el('div.tc-lowholo'),
      el('div.tc-glare'),
      foil ? el('div.tc-foilline') : null, foil ? el('div.tc-foilline2') : null,
      el('div.tc-low', [
        el('div.stats', STATS.map((k) => el('div.st', [el('small', { text: STAT_SHORT[k] }), el(`b.p${plus[k]}`, { text: `+${plus[k]}` })]))),
        el('div.apt', [el(`span.sf${surf === '芝' ? '' : '.dirt'}`, { text: surf }), el('span.dc', { text: distCat(c.dist) }), el('span.lb', { text: '適性馬場' }), ...grounds]),
        el('div.row2', [
          el('div.tc-ped', [el('span', ['父 ', el('b', { text: c.sire }), '　母 ', el('b', { text: c.dam })]), el('br'), `母父 ${c.damSire}　${c.line}`, el('br'), el('span.tot', { text: tot })]),
          el('div.cp', [el('small', { text: 'カードパワー' }), el(`b${foil ? '.foil' : ''}`, { text: String(cardPower(c)) })]),
        ]),
        el('div.foot', foot),
      ]),
    ]),
  ]);
  if (kind) card.dataset.holo = kind;
  const rear = back ? backFace(c, vars, foil, back) : null;
  const wrap = el(`div.tcw${dim ? '.dim' : ''}${onClick ? '.click' : ''}`, { style: `width:${630 * scale}px;height:${880 * scale}px` }, [
    el('div.tcs', { style: `transform:scale(${scale})` }, rear ? [card, rear] : card),
    // 重ねた枚数と覚醒（2 枚目から 1 段、5 枚で完凸）
    count > 1 ? el(`span.tc-count${count >= 5 ? '.max' : ''}`, [el('b', { text: `×${count}` }), el('i', { text: '◆'.repeat(Math.min(4, count - 1)) + '◇'.repeat(Math.max(0, 4 - (count - 1))) })]) : null,
    badge ? el('span.tc-badge', { text: badge }) : null,
  ]);
  if (onClick) wrap.onclick = () => onClick(c);
  if (!dim && tilt) attachTilt(wrap, card, { touch: tilt === 'full' });
  if (rear) {
    if (tilt) attachTilt(wrap, rear, { touch: tilt === 'full' });
    attachFlip(wrap, card, rear);
  }
  // eager：画面に入るのを待たずに絵を付ける。ガチャの伏せたカード（3D で裏返した箱の中）は IntersectionObserver に
  // 見えている扱いにならず、表になっても絵が付かなかった。10 枚だけなので待たずに撮る
  const load = (fn) => (eager ? fn() : whenVisible(wrap, fn));
  if (!dim) load(() => cardArt(c).then((a) => {
      const bEl = art.querySelector('.b');
      bEl.style.backgroundImage = `url(${a.bg})`;
      if (a.bgBaked) bEl.classList.add('baked');
      art.querySelector('.f').style.backgroundImage = `url(${a.fg})`;
      // 裏面は同じ絵をモノクロで（CSS の filter。絵を撮り直さない）
      if (rear) {
        rear.querySelector('.b').style.backgroundImage = `url(${a.bg})`;
        if (a.bgBaked) rear.querySelector('.b').classList.add('baked');
        rear.querySelector('.f').style.backgroundImage = `url(${a.fg})`;
        rear.classList.add('ready');
      }
      // 固有スキルのエフェクト（カードエディットで選んだ完成馬のカード）：形の後ろのオーラと前の稲妻・粒
      if (a.fx) {
        // 後ろの層は 3D のエフェクトでは使わない（null）
        if (a.fx.back) art.querySelector('.xb').style.backgroundImage = `url(${a.fx.back})`;
        art.querySelector('.xf').style.backgroundImage = `url(${a.fx.front})`;
        card.dataset.fx = c.fxArt;
      }
      if (foil && a.ring) {
        const o = art.querySelector('.olr');
        o.style.webkitMaskImage = `url(${a.ring})`;
        o.style.maskImage = `url(${a.ring})`;
        o.style.opacity = '1';
      }
      card.classList.add('ready');
    }).catch(() => {}));
  return wrap;
}

/**
 * カードの裏面。表と同じ枠に、絵はモノクロ、下の欄はスキルの一覧（レース・育成）、右下に二つ名と名前。
 * ホロ・箔・光沢は付けない（裏は読むための面。テカリで字が読みにくくなる）。
 */
function backFace(c, vars, foil, back) {
  const row = (cls, name, desc, awk) => el(`div.bk-row.${cls}`, [el('b', { text: name }), awk ? el('em', { text: `覚醒${awk}` }) : null, el('span', { text: desc })]);
  const race = back.race.map((id) => skillInfo(id)).filter(Boolean);
  const sup = back.support.map((id) => skillInfo(id)).filter(Boolean);
  const list = (items, cls, plus) => el('div.bk-rows', items.map((x) => row(cls, x.name, x.desc, plus?.has(x.id) ? (cls === 'race' ? 2 : 4) : 0)));
  const ev = back.events;
  // 欄に収まらない分は欄の中だけスクロールする（以前は行が多いと説明を外して名前だけに詰めた。「無理やり入れ込まなくても」）。
  // 大きく見る画面は指で傾ける（.tcw が touch-action: none）ので、欄は pan-y を持って指の縦の動きをスクロールに回す。
  const scroll = el('div.bk-scroll', [
    el('div.bk-h', [el('i', { text: 'レーススキル' }), el('small', { text: `${(back.unique ? 1 : 0) + race.length}` })]),
    back.unique ? el('div.bk-uniq', [el('b', { text: back.unique.name }), el('span', { text: back.unique.desc })]) : null,
    race.length ? list(race, 'race', back.plus?.race) : back.unique ? null : el('p.bk-none', { text: 'なし' }),
    el('div.bk-h', [el('i', { text: '育成スキル' }), el('small', { text: `${sup.length}` })]),
    sup.length ? list(sup, 'support', back.plus?.support) : el('p.bk-none', { text: back.note ?? 'なし' }),
    // サポートに編成したときの話（カードだけの話か、得意ごとの共通の話）
    ev ? el('div.bk-h', [el('i', { text: ev.card ? 'カードイベント' : 'サポートイベント' }), el('b.bk-evt', { text: ev.title })]) : null,
    ev ? el(`ol.bk-eps${ev.card ? '.own' : ''}`, ev.eps.map((t, i) => el('li', [el('em', { text: `第${i + 1}話` }), t]))) : null,
  ]);
  scroll.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  return el(`div.tc.tc-back.r-${c.rar}`, { style: Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';') }, [
    el('div.tc-in', [
      el('div.tc-art', [el('div.b'), el('div.f'), el('div.vg')]),
      el('div.tc-rar', { text: c.rar }),
      // 名前と二つ名は右下に小さく（裏は読むための面。大きな帯をやめて絵とスキルの欄に回した）
      el('div.tc-low.bk-low', [
        scroll,
        el('div.foot.bk-foot', [el('span', { text: '右へスワイプで表へ' }), el('span.bk-who', [el('small', { text: epithetOf(c) }), el('b', { text: c.name })])]),
      ]),
    ]),
  ]);
}

/**
 * 左へスワイプで裏、右で表。返す動きは枠（.tcw）を Y 軸で 90° 回して面を入れ替え、戻す。
 * 3D の変形は返す間だけ（Web Animations で掛け、終われば残らない。落とし穴 93 の「3D を常時掛けない」）。
 */
function attachFlip(wrap, front, rear) {
  let side = false, busy = false, sx = 0, sy = 0, down = false;
  rear.hidden = true;
  const P = 'perspective(1600px)';
  const flip = (toBack) => {
    toBack = !!toBack;
    if (busy || toBack === side) return;
    busy = true;
    const dir = toBack ? -1 : 1;
    const half = (from, to, easing) => wrap.animate([{ transform: `${P} rotateY(${from}deg)` }, { transform: `${P} rotateY(${to}deg)` }], { duration: 190, easing, fill: 'forwards' });
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const swap = () => { side = toBack; front.hidden = toBack; rear.hidden = !toBack; wrap.classList.toggle('back', toBack); };
    if (reduce || typeof wrap.animate !== 'function') { swap(); busy = false; return; }
    const a = half(0, 90 * dir, 'cubic-bezier(.5,0,.75,0)');
    a.finished.then(() => {
      swap();
      const b = half(-90 * dir, 0, 'cubic-bezier(.25,1,.5,1)');
      a.cancel();
      b.finished.then(() => { b.cancel(); busy = false; });
    }).catch(() => { busy = false; });
  };
  wrap.addEventListener('pointerdown', (e) => { down = true; sx = e.clientX; sy = e.clientY; });
  const up = (e) => {
    if (!down) return;
    down = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    flip(dx < 0);
  };
  wrap.addEventListener('pointerup', up);
  wrap.addEventListener('pointercancel', () => { down = false; });
  wrap.flip = flip;
  wrap.isBack = () => side;
}

/**
 * 画面に入ってから絵を撮る。一覧の 79 枚を開いた瞬間に全部撮ると、撮り終わるまで（1 枚ずつ WebGL で描く）
 * 画面が固まった。見えていないカードは、スクロールして近づいたときに撮る。
 */
let observer = null;
const waiting = new WeakMap();
export function whenVisible(node, fn) {
  if (typeof IntersectionObserver !== 'function') { fn(); return; }
  observer ??= new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      observer.unobserve(e.target);
      const go = waiting.get(e.target);
      waiting.delete(e.target);
      go?.();
    }
  }, { rootMargin: '300px' });
  waiting.set(node, fn);
  observer.observe(node);
}

/** 傾きの最大（度）。大きいと文字が読めない。 */
const MAX_TILT = 13;
/**
 * カードを傾ける。ポインタの位置（カードの中の 0..1）から角度・ホロの動き・光沢の位置を CSS の変数で渡す。
 * 一覧（tilt: 'hover'）はマウスだけ（指で触るとスクロールできなくなる）。大きく見る画面（'full'）は指でも傾ける。
 *
 * 3D の変形（.tc.tilt）は傾けている間だけ掛ける。全カードに常時掛けると、一覧のカードがすべて合成レイヤーになって重く、
 * Safari では 3D 変形の中の mix-blend-mode が効かずにホロが絵を覆った。更新は 1 フレームに 1 回にまとめる
 * （pointermove はフレームより多く来る）。触っていない間に揺らすのもやめた（毎フレーム全層を描き直して重かった）。
 */
function attachTilt(wrap, card, { touch }) {
  let raf = 0, nx = 0.5, ny = 0.5, on = false, off = 0;
  const apply = () => {
    raf = 0;
    const st = card.style;
    st.setProperty('--rx', `${((0.5 - ny) * 2 * MAX_TILT).toFixed(2)}deg`);
    st.setProperty('--ry', `${((nx - 0.5) * 2 * MAX_TILT).toFixed(2)}deg`);
    st.setProperty('--mx', `${(nx * 100).toFixed(1)}%`);
    st.setProperty('--my', `${(ny * 100).toFixed(1)}%`);
    // ホロは傾きと逆へ流す（光の当たる帯が表面を滑って見える）。
    st.setProperty('--px', `${((0.5 - nx) * 220).toFixed(1)}px`);
    st.setProperty('--py', `${((0.5 - ny) * 220).toFixed(1)}px`);
    st.setProperty('--tilt', Math.min(1, Math.hypot(nx - 0.5, ny - 0.5) * 2.4).toFixed(3));
    st.setProperty('--ga', on ? '1' : '0');
  };
  const queue = () => { if (!raf) raf = requestAnimationFrame(apply); };
  const move = (e) => {
    if (e.pointerType !== 'mouse' && !touch) return;
    const r = wrap.getBoundingClientRect();
    clearTimeout(off);
    card.classList.add('tilt');
    card.classList.remove('settle');
    nx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    ny = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    on = true;
    queue();
  };
  const leave = () => {
    if (!card.classList.contains('tilt')) return;
    card.classList.add('settle');
    nx = 0.5; ny = 0.5; on = false;
    queue();
    // 正面へ戻りきったら 3D の変形を外す（合成レイヤーを残さない）
    off = setTimeout(() => card.classList.remove('tilt', 'settle'), 650);
  };
  wrap.addEventListener('pointermove', move);
  wrap.addEventListener('pointerdown', move);
  wrap.addEventListener('pointerleave', leave);
  wrap.addEventListener('pointercancel', leave);
  if (touch) { wrap.style.touchAction = 'none'; wrap.addEventListener('pointerup', leave); }
}
