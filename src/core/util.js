// 小物。シミュレーション層から DOM を触らないため、整形もここに置く。

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (t) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** 走破時計 92.3 秒 → "1:32.3"。競馬の表記は分:秒.1/10。 */
export function formatTime(sec) {
  if (!Number.isFinite(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  const t = s.toFixed(1).padStart(4, '0');
  return m > 0 ? `${m}:${t}` : t;
}

/** 上がり3F など、分を使わない短い時計。 */
export function formatSec(sec) {
  return Number.isFinite(sec) ? sec.toFixed(1) : '—';
}

/** 賞金は万円単位で持ち、表示で億を切り出す。 */
export function formatMoney(man) {
  const v = Math.round(man);
  if (Math.abs(v) >= 10000) {
    const oku = Math.floor(Math.abs(v) / 10000);
    const rest = Math.abs(v) % 10000;
    const sign = v < 0 ? '-' : '';
    return rest ? `${sign}${oku}億${rest.toLocaleString('ja-JP')}万` : `${sign}${oku}億`;
  }
  return `${v.toLocaleString('ja-JP')}万`;
}

/** 着差。競馬は秒差ではなく馬身で言う（1馬身 ≒ 0.2 秒 ≒ 2.4m）。 */
export function formatMargin(sec) {
  if (sec <= 0.0001) return '同着';
  const baba = sec / 0.2;
  if (baba < 0.06) return 'ハナ';
  if (baba < 0.18) return 'アタマ';
  if (baba < 0.3) return 'クビ';
  if (baba < 0.55) return '1/2';
  if (baba < 0.8) return '3/4';
  if (baba >= 10) return '大差';
  const whole = Math.floor(baba);
  const frac = baba - whole;
  let f = '';
  if (frac >= 0.8) return `${whole + 1}`;
  if (frac >= 0.55) f = '.3/4';
  else if (frac >= 0.3) f = '.1/2';
  else if (frac >= 0.12) f = '.1/4';
  return `${whole}${f}`;
}

/** 0..1 の能力を A〜G の評価に落とす。生の数値を見せないほうが馬を見る目が育つ。 */
// 評価の字は史実馬の一覧（アホヌラゲーム館）と同じ 16 段（S+〜G）。値 ×100 がサイトの数値で、各段の下限で切る
// （S+ 80〜 / S 78〜 / A+ 76〜 / A 74〜 / B+ 72〜 / B 70〜 / C+ 68〜 / C 66〜 / D+ 64〜 / D 62〜 / E+ 60〜 / E 58〜 / F+ 56〜 / F 54〜 / G+ 52〜 / G）。
// 以前は 0〜1 を 9 段に割っていて、サイトの C+〜A+ が全部 A になった（sim/traits.js と同じ物差し）。
const RANKS = ['G', 'G+', 'F', 'F+', 'E', 'E+', 'D', 'D+', 'C', 'C+', 'B', 'B+', 'A', 'A+', 'S', 'S+'];
const RANK_FLOOR = [52, 54, 56, 58, 60, 62, 64, 66, 68, 70, 72, 74, 76, 78, 80];
/** 幼駒の評価。サイトの 16 段は競走馬の盛りの物差しで、育つ途中（2 歳の物差しで 0.2〜0.45）は全部 G になる。
 *  育成の進みが字で分かるよう、当歳（0.2 前後）は G・1 歳の 12 月（0.33〜0.44）は E〜D+ に広げて見せる（以前の 9 段の見え方と同じ）。 */
export const rankYoung = (v) => rankOf(0.40 + clamp01(v) * 0.55);
export function rankOf(v) {
  const x = clamp01(v) * 100 + 1e-9;
  let i = 0;
  while (i < RANK_FLOOR.length && x >= RANK_FLOOR[i]) i++;
  return RANKS[i];
}

/** 配列を key でまとめる。 */
export function groupBy(arr, key) {
  const m = new Map();
  for (const x of arr) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

export function sum(arr, f = (x) => x) {
  let t = 0;
  for (const x of arr) t += f(x);
  return t;
}

/** 降順ソート用の比較子を作る。 */
export const byDesc = (f) => (a, b) => f(b) - f(a);
export const byAsc = (f) => (a, b) => f(a) - f(b);

/** 着順の序数。1 → "1着"。 */
export const chaku = (n) => `${n}着`;
