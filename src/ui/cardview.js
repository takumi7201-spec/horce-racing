// カード 1 枚の見た目。630×880 で組み、外側の枠で縮める（文字の大きさを保ったまま一覧に並べられる）。
// 絵は render3d/cardart.js が撮って返すまで、暗い地に名前だけで出しておく。
// レア度ごとの枠・差し色・ホロ・箔は CSS の変数で切り替える（styles.css の .tc）。

import { el } from './dom.js';
import { cardArt } from '../render3d/cardart.js';
import { plusOf, cardPower, distCat, STATS, STAT_SHORT, PACKS } from '../sim/ikusei.js';

const THEME = {
  N: { frame: 'linear-gradient(135deg,#d9f5c8 0%,#5fae4a 20%,#c8eeb0 38%,#3f8a34 56%,#a6dc8a 74%,#2f6e28 90%,#9fd682 100%)', line: '#9fdc84', glow: '#7fd06a33', ink: '#e8ffd8', sparks: 0, rays: 0, sun: 0.25, badge: 'linear-gradient(#e6ffd6,#5cae48)', badgeInk: '#103a10' },
  R: { frame: 'linear-gradient(135deg,#ffe2c4 0%,#b06a32 18%,#f2c08e 34%,#8a4a1e 52%,#e0a066 70%,#6e3814 86%,#d89a62 100%)', line: '#e6a874', glow: '#e0905a44', ink: '#ffe6cc', sparks: 4, rays: 0.2, sun: 0.35, badge: 'linear-gradient(#ffe0c0,#b06a32)', badgeInk: '#3a1a04' },
  SR: { frame: 'linear-gradient(135deg,#ffffff 0%,#a9b0bc 18%,#f4f6fa 34%,#7d8592 52%,#e6e9ef 70%,#666e7a 86%,#d6dae2 100%)', line: '#dfe5ee', glow: '#cfe0ff55', ink: '#eef4ff', sparks: 7, rays: 0.3, sun: 0.4, badge: 'linear-gradient(#ffffff,#9aa2ae)', badgeInk: '#1c222c' },
  SSR: { frame: 'linear-gradient(135deg,#fff6c8 0%,#d6a83a 18%,#fff9d6 34%,#b8862a 52%,#ffeaa0 70%,#a87a22 86%,#f6dc84 100%)', line: '#f2d47a', glow: '#ffd76a77', ink: '#ffe9a8', sparks: 10, rays: 0.4, sun: 0.45, badge: 'linear-gradient(#fffbe0,#ffd04a 55%,#c08a1c)', badgeInk: '#3a2600' },
  LM: { frame: 'conic-gradient(from 30deg,#ff5e7e,#ffb347,#fff35c,#6dff9a,#4fd8ff,#7a7bff,#d36bff,#ff5e7e)', line: '#ffffff', glow: '#b08cff88', ink: '#ffffff', sparks: 12, rays: 0.45, sun: 0.5, badge: 'conic-gradient(from 0deg,#ff5e7e,#ffb347,#fff35c,#6dff9a,#4fd8ff,#7a7bff,#d36bff,#ff5e7e)', badgeInk: '#ffffff' },
};
// ホログラフィック（R 以上）。背景と馬の間に挟む（馬に掛けると縞になった）。
const HOLO = {
  R: { op: 0.30, cols: ['#ff8a3d', '#ffd23d', '#ff5f9e', '#3dc9ff', '#ff8a3d'] },
  SR: { op: 0.38, cols: ['#4fa8ff', '#b07aff', '#4fffd2', '#ffffff', '#7ab8ff'] },
  SSR: { op: 0.46, cols: ['#ffc23d', '#ff5fa8', '#ffe85c', '#3de0ff', '#ff9a3d'] },
  LM: { op: 0.62, cols: ['#ff3d7f', '#ffb23d', '#e8ff3d', '#3dff8a', '#3dc9ff', '#9a5cff'] },
};
// 箔押し（SSR 以上）。LM は虹の箔。
const FOIL = {
  SSR: 'linear-gradient(100deg,#6e4a0c 0%,#c99a2e 10%,#f7e08a 20%,#fffbe6 27%,#d9ad45 36%,#8a6216 48%,#e8c56a 60%,#fff6d0 70%,#c39532 82%,#7a5410 100%)',
  LM: 'linear-gradient(100deg,#7a5cff 0%,#ffb0e0 12%,#ffffff 20%,#7ae0ff 30%,#b8ffd8 42%,#fff2a0 52%,#ffa8c8 63%,#ffffff 71%,#a88cff 84%,#5ac8ff 100%)',
};
const EPI = { speed: '疾風', stamina: '無尽', power: '剛脚', guts: '不屈', wit: '叡智' };
const NOUN = { LM: ['帝王', '女帝'], SSR: ['覇者', '女王'], SR: ['強豪', '女傑'], R: ['刺客', '才媛'], N: ['挑戦者', '新星'] };
const GROUNDS = ['良', '稍重', '重', '不良'];
const mark = (a) => (a >= 0.8 ? '◎' : a >= 0.7 ? '○' : a >= 0.6 ? '△' : '×');

export const epithetOf = (c) => {
  const best = Object.keys(EPI).sort((a, b) => c.v[b] - c.v[a])[0];
  return `${EPI[best]}の${c.race.venue}${NOUN[c.rar][c.sex === '牝' ? 1 : 0]}`;
};

/**
 * カード 1 枚。scale は 630×880 に対する倍率。opts.onClick を渡すと押せる。
 * opts.count があれば右上に枚数、opts.dim で暗く（持っていないカード）。
 */
export function cardView(c, { scale = 0.4, onClick = null, count = 0, dim = false, badge = null } = {}) {
  const T = THEME[c.rar];
  const H = HOLO[c.rar];
  const foil = FOIL[c.rar] ?? null;
  const holoBg = H ? `repeating-linear-gradient(115deg,${[...H.cols, H.cols[0]].map((x, i, a) => `${x} ${Math.round((i / (a.length - 1)) * 120)}px`).join(',')})` : 'none';
  const plus = plusOf(c);
  const surf = c.turf >= c.dirt ? '芝' : 'ダート';
  const fe = (t) => (foil ? `${t} foil` : t);
  const vars = {
    '--frame': T.frame, '--line': T.line, '--glow': T.glow, '--ink': T.ink, '--badge': T.badge, '--badge-ink': T.badgeInk,
    '--holo': holoBg, '--hop': H?.op ?? 0, '--foil': foil ?? 'none', '--sun': T.sun,
  };
  const art = el('div.tc-art', [el('div.b'), el('div.hb'), el('div.hbg'), el('div.hb2'), el('div.f'), el('div.olr')]);
  const glow = el('div.tc-glow');
  const sparks = el('div.tc-sparks', Array.from({ length: T.sparks }, (_, i) => {
    const x = (i * 37 + 11) % 100, y = (i * 53 + 7) % 62, s = 6 + ((i * 7) % 14), o = 0.5 + ((i * 13) % 5) / 10;
    return el('i.sp', { style: `left:${x}%;top:${y}%;width:${s}px;height:${s}px;opacity:${o}` });
  }));
  const grounds = GROUNDS.map((g, i) => {
    const a = c.firm + (c.soft - c.firm) * (i / 3);
    const m = mark(a);
    return el(`span.gd.g${m === '◎' ? 'best' : m === '○' ? 'good' : m === '△' ? 'mid' : 'bad'}`, [el('i', { text: m }), g]);
  });
  const tot = c.rar === 'N' && !c.travel ? 'オープン級' : c.rar === 'R' || c.rar === 'N' ? `重賞 ${c.graded}勝` : `通算 GI ${c.gi}勝`;
  const no = Number(c.id.split('-')[1]);
  const card = el(`div.tc.r-${c.rar}${foil ? '.foiled' : ''}`, { style: Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';') }, [
    el('div.tc-in', [
      art, el('div.tc-warm'), el('div.tc-vig'), glow, sparks,
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
      foil ? el('div.tc-foilline') : null, foil ? el('div.tc-foilline2') : null,
      el('div.tc-low', [
        el('div.stats', STATS.map((k) => el('div.st', [el('small', { text: STAT_SHORT[k] }), el(`b.p${plus[k]}`, { text: `+${plus[k]}` })]))),
        el('div.apt', [el(`span.sf${surf === '芝' ? '' : '.dirt'}`, { text: surf }), el('span.dc', { text: distCat(c.dist) }), el('span.lb', { text: '適性馬場' }), ...grounds]),
        el('div.row2', [
          el('div.ped', [el('span', ['父 ', el('b', { text: c.sire }), '　母 ', el('b', { text: c.dam })]), el('br'), `母父 ${c.damSire}　${c.line}`, el('br'), el('span.tot', { text: tot })]),
          el('div.cp', [el('small', { text: 'カードパワー' }), el(`b${foil ? '.foil' : ''}`, { text: String(cardPower(c)) })]),
        ]),
        el('div.foot', [el('span', { text: `第${c.pack.slice(1)}弾【${PACKS[c.pack]}】　${c.race.year} ${c.race.name} 優勝` }), el('span', { text: `No.${String(no).padStart(2, '0')}/39` })]),
      ]),
    ]),
  ]);
  const wrap = el(`div.tcw${dim ? '.dim' : ''}${onClick ? '.click' : ''}`, { style: `width:${630 * scale}px;height:${880 * scale}px` }, [
    el('div.tcs', { style: `transform:scale(${scale})` }, card),
    count > 1 ? el('span.tc-count', { text: `×${count}` }) : null,
    badge ? el('span.tc-badge', { text: badge }) : null,
  ]);
  if (onClick) wrap.onclick = () => onClick(c);
  if (!dim) {
    cardArt(c).then((a) => {
      art.querySelector('.b').style.backgroundImage = `url(${a.bg})`;
      art.querySelector('.f').style.backgroundImage = `url(${a.fg})`;
      if (foil && a.ring) {
        const o = art.querySelector('.olr');
        o.style.webkitMaskImage = `url(${a.ring})`;
        o.style.maskImage = `url(${a.ring})`;
        o.style.opacity = '1';
      }
      const sx = a.sun?.visible ? Math.min(0.9, Math.max(0.1, a.sun.x)) : 0.55;
      const sy = a.sun?.visible ? Math.min(0.4, Math.max(0.05, a.sun.y)) : 0.12;
      const at = `${(sx * 100).toFixed(1)}% ${(sy * 100).toFixed(1)}%`;
      glow.style.background = `radial-gradient(circle at ${at},#fff8d8 0%,#ffe08acc 7%,#ffc84a44 20%,transparent 42%),${T.rays ? `repeating-conic-gradient(from 0deg at ${at},#fff3b8${Math.round(T.rays * 34).toString(16).padStart(2, '0')} 0deg 3deg,transparent 3deg 9deg),` : ''}linear-gradient(180deg,#ffd36a33,transparent 40%,transparent 70%,#0d1a10 100%)`;
      card.classList.add('ready');
    }).catch(() => {});
  }
  return wrap;
}
