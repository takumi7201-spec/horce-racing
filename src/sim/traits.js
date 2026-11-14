/**
 * 史実馬の一覧（アホヌラゲーム館「Winning Post 10 2026 攻略」）の物差しと、瞬発・柔軟。
 *
 * サイトの副能力は S+〜G の 16 段（各段は数値の範囲を持つ：S+ 85-80 / S 79-78 / … / G 51-45）。
 * ゲームの評価の字も同じ 16 段にそろえる（util.js の rankOf）。値は「段の数値 ÷ 100」で持つ。
 *
 * 瞬発・柔軟はサイトにだけある能力。ABILITIES（調教で伸びる 5 つ）には入れず、馬の性質として持つ
 * （調教・成長・配合の上乗せの仕組みに入れると、乱数の流れと能力の釣り合いが全部変わる）。
 * - 瞬発（kick）：最後の 400m の伸び。表の馬はサイトの字、ほかの馬は脚質と馬 id から決める。
 * - 柔軟（flex）：距離の幅（distRange）。サイトの柔軟の段から幅を出しているので、幅から段へ戻せる。
 * どちらも乱数を使わない（主乱数の流れを変えない）。
 */

export const SITE_LEVELS = ['G', 'G+', 'F', 'F+', 'E', 'E+', 'D', 'D+', 'C', 'C+', 'B', 'B+', 'A', 'A+', 'S', 'S+'];
/** 各段の中央の数値（取り込みの道具 import-ahogame.mjs と同じ）。 */
export const SITE_MID = [48, 52.5, 54.5, 56.5, 58.5, 60.5, 62.5, 64.5, 66.5, 68.5, 70.5, 72.5, 74.5, 76.5, 78.5, 82.5];
/** 各段の下限（この値以上ならその段）。G は下限なし。 */
const SITE_FLOOR = [-Infinity, 52, 54, 56, 58, 60, 62, 64, 66, 68, 70, 72, 74, 76, 78, 80];

/** 値（0..1）→ サイトの字。 */
export function siteLetter(v) {
  const x = (v ?? 0) * 100 + 1e-9;
  let i = 0;
  while (i + 1 < SITE_FLOOR.length && x >= SITE_FLOOR[i + 1]) i++;
  return SITE_LEVELS[i];
}

/** サイトの字 → 値（段の中央 ÷ 100）。読めない字は null。 */
export function letterValue(l) {
  const i = SITE_LEVELS.indexOf(String(l ?? '').trim());
  return i < 0 ? null : SITE_MID[i] / 100;
}

/** サイトのスタミナ（0〜100 の数値。距離に効く隠し値）→ ゲームのスタミナ能力。
 *  ほかの能力（サイトのスピードは 45〜85）と同じ帯に置く：5 → 0.47、50 → 0.65、100 → 0.85。 */
export const staminaOfSite = (sta) => 0.45 + Math.max(0, Math.min(100, sta)) / 100 * 0.40;

/** 柔軟の段の番号 → 距離の幅（import-ahogame.mjs の convert と同じ式）。 */
export const rangeOfFlexLevel = (lv) => Math.round((400 + 5 * lv + 0.9 * lv * lv) / 10) * 10;

/** 距離の幅 → 柔軟の値（段の中央）。幅の式を段の番号について解く。 */
export function flexOf(h) {
  if (h.flex != null) return h.flex;
  const r = h.distRange ?? 500;
  const lv = Math.max(0, Math.min(15, Math.round((-5 + Math.sqrt(25 + 3.6 * Math.max(0, r - 400))) / 1.8)));
  return SITE_MID[lv] / 100;
}

function hash01(id, salt) {
  let h = (Math.imul((id | 0) ^ 0x2545f491, 0x85ebca6b) ^ Math.imul(salt + 7, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2f) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 瞬発の平均（レースの効き目の中心）。2026 年開始の現役の平均（架空 0.667・表の馬 0.625）。 */
export const KICK_MID = 0.655;

/** 瞬発。表の馬はサイトの字、ほかの馬は脚質（差し・追込ほど高い）と馬 id から。 */
export function kickOf(h) {
  if (h.kick != null) return h.kick;
  const style = h.style ?? 0.45;
  return Math.max(0.45, Math.min(0.85, 0.555 + style * 0.1 + (hash01(h.id, 1) - 0.5) * 0.12));
}

/** 仔の瞬発：両親の平均にばらつき（馬 id から。乱数を使わない）。 */
export function inheritKick(foal, sire, dam) {
  return Math.max(0.45, Math.min(0.85, (kickOf(sire) + kickOf(dam)) / 2 + (hash01(foal.id, 2) - 0.5) * 0.1));
}
