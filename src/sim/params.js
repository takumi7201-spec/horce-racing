// ゲーム全体の定数。
// レースの「物理」もここに集めている。ここをいじると世界の時計が全部動くので、
// 変えたら tools/verify.mjs の時計チェックを必ず通すこと。

/** 1 ティックの秒数。0.1 秒だと 2400m で 2500 ステップ程度。 */
export const TICK = 0.1;

/** 性別。 */
export const SEX = { MALE: '牡', FEMALE: '牝', GELDING: 'セ' };

/** 毛色。 */
export const COATS = ['鹿毛', '黒鹿毛', '栗毛', '栃栗毛', '芦毛', '青鹿毛', '青毛', '白毛'];

/** 脚質。前に行くほど index が小さい。 */
export const STYLES = ['逃げ', '先行', '差し', '追込'];

/** 能力 5 項目。 */
export const ABILITIES = ['speed', 'stamina', 'power', 'guts', 'wit'];
export const ABILITY_LABEL = {
  speed: 'スピード', stamina: 'スタミナ', power: 'パワー', guts: '勝負根性', wit: '賢さ',
};

/** 成長型。 */
export const GROWTH = ['早熟', '普通', '持続', '晩成'];

/**
 * 成長曲線。age（2〜8）→ 能力の発現率。
 * 早熟は 3 歳で頭打ちになり 5 歳以降は落ちる。晩成は 5 歳で最大。
 * 「3 歳クラシックは早熟型、古馬 GI は晩成型」という住み分けを作るための表。
 */
export const GROWTH_CURVE = {
  早熟: [0, 0, 0.88, 1.00, 0.97, 0.90, 0.82, 0.74, 0.66],
  普通: [0, 0, 0.74, 0.92, 1.00, 0.98, 0.93, 0.86, 0.78],
  持続: [0, 0, 0.78, 0.90, 0.97, 1.00, 1.00, 0.97, 0.91],
  晩成: [0, 0, 0.62, 0.82, 0.95, 1.00, 0.99, 0.95, 0.88],
};

/** 馬場状態。index が大きいほど悪化。 */
export const GROUNDS = ['良', '稍重', '重', '不良'];

/** 馬場状態による時計の目減り（秒/1000m 相当の係数）と、脚への負担。 */
export const GROUND_EFFECT = {
  芝: [{ speed: 1.000, stam: 1.00 }, { speed: 0.992, stam: 1.05 },
       { speed: 0.981, stam: 1.13 }, { speed: 0.968, stam: 1.24 }],
  ダート: [{ speed: 1.000, stam: 1.00 }, { speed: 1.004, stam: 0.98 },
       { speed: 1.008, stam: 0.96 }, { speed: 1.006, stam: 0.97 }],
};

/** クラス（条件）。order が大きいほど上。 */
export const CLASSES = [
  { id: 'maiden', name: '新馬', order: 0, prize: 510 },
  { id: 'nowin', name: '未勝利', order: 1, prize: 510 },
  { id: 'c1', name: '1勝クラス', order: 2, prize: 740 },
  { id: 'c2', name: '2勝クラス', order: 3, prize: 1050 },
  { id: 'c3', name: '3勝クラス', order: 4, prize: 1500 },
  { id: 'op', name: 'オープン', order: 5, prize: 2200 },
  { id: 'g3', name: 'GIII', order: 6, prize: 3900 },
  { id: 'g2', name: 'GII', order: 7, prize: 6200 },
  { id: 'g1', name: 'GI', order: 8, prize: 16000 },
];
export const CLASS_BY_ID = new Map(CLASSES.map((c) => [c.id, c]));
export const classOrder = (id) => CLASS_BY_ID.get(id)?.order ?? 0;
export const className = (id) => CLASS_BY_ID.get(id)?.name ?? id;

/** 着順ごとの賞金配分（1 着の賞金に対する比率）。 */
export const PRIZE_SHARE = [1, 0.40, 0.25, 0.15, 0.10];

/** クラス昇級に必要な勝利数（1 勝クラスは 1 勝、2 勝クラスは 2 勝…）。 */
export function classForWins(wins) {
  if (wins <= 0) return 'nowin';
  if (wins === 1) return 'c1';
  if (wins === 2) return 'c2';
  if (wins === 3) return 'c3';
  return 'op';
}

/** 距離区分。番組表と適性表示で使う。 */
export function distCategory(m) {
  if (m <= 1300) return '短距離';
  if (m <= 1600) return 'マイル';
  if (m <= 2000) return '中距離';
  if (m <= 2400) return '中長距離';
  return '長距離';
}

/**
 * レースの物理。
 *
 * V_BASE は「能力 0.5 の馬が平坦の良馬場を淡々と走るときの速度」。
 * 日本の芝中距離は平均 60 秒/1000m 前後（16.7 m/s）、
 * 上がり 3F 34 秒台で 17.6 m/s くらい出る。その幅に収まるよう調整している。
 */
export const PHYS = {
  V_BASE: 17.4,        // m/s（スピード 0 の馬の最高速。約 63km/h）
  V_SPEED_GAIN: 2.8,   // スピード 0→1 で加算される最高速度
  // 最高速の差は意外に小さく、勝負を分けるのは「それをどこまで保てるか」。
  // ここを広げると未勝利馬と GI 馬の時計差が現実の 3% を大きく超える。
  V_DIRT_PENALTY: 0.4, // ダートは砂を掻くぶん絶対速度が落ちる

  // 加速は「目標速度への指数的な接近」。定加速だとゲートから 6 秒かけて
  // 巡航速度に達してしまい、最初の 200m が 16 秒もかかる。
  ACC_APPROACH: 2.0,   // 1/s。目標との差 × これ が加速度
  ACC_MAX_BASE: 4.4,   // m/s^2（パワー 0）
  ACC_MAX_GAIN: 3.0,   // パワーによる上積み
  DEC_MAX: 3.2,        // 減速の上限

  // スタミナ。HP は「余力」。
  // 巡航速度 v_eco を超えた分が二次で、加えて走っているだけで一定量が減る。
  // 二次項だけだとスローペースの長距離がまったく減らず、3200m が楽になる。
  HP_BASE: 110,
  HP_STAM_GAIN: 395,
  HP_DRAIN_K: 1.2,     // (v - v_eco)^2 に掛ける係数
  HP_BASE_DRAIN: 0.6,  // 走っている間つねに減る量（/秒）
  HP_ECO_RATIO: 0.86,  // 最高速に対する「ほぼ無消費で巡航できる」速度の比
  HP_CORNER_K: 150,    // コーナーでの余分な消費（曲率 × 速度）
  HP_GRADE_K: 0.055,   // 上り勾配での余分な消費（/‰ /秒）

  // バテ。段差ではなく連続的に落とす。階段にすると直線でぴたりと止まる絵になる。
  FADE_K: 0.11,        // 余力ゼロで最高速が 11% 落ちる
  BUST_RATE: 0.013,    // 枯れてから 1 秒ごとにさらに落ちる割合
  BUST_FLOOR: 0.62,    // これ以上は落ちない（歩いて帰る馬は居ない）

  // 速度に効く地形。
  CORNER_SLOW: 7.0,    // 曲率 × これ だけ最高速が落ちる
  GRADE_SLOW: 0.0016,  // 勾配 ‰ あたりの最高速の落ち

  // 追い比べ。残り 400m からは勝負根性が効く。
  GUTS_GAIN: 0.025,

  // 進路。前が壁だと速度を出せず、外に持ち出すと距離を損する。
  BLOCK_GAP: 2.6,      // この距離より前に馬が居ると詰まる（m）
  LANE_SHIFT: 1.25,    // 1 秒で動ける横位置（m/s）。17m/s で走りながら 4 度ほど
  LANE_MAX: 1.0,

  // 隊列の中の位置による余力の出入り。
  // 先頭は自分でペースを作るぶん損をし、後方で我慢した馬は脚を溜められる。
  // この非対称が無いと、先に行った馬がそのまま残って逃げ馬だけが勝ち続ける。
  LEAD_DRAIN: 1.15,    // 先頭の消費倍率
  BACK_DRAIN: 0.87,    // 30m 後方の消費倍率
  DRAIN_POS_SPAN: 30,  // 上の二つを補間する距離（m）

  // 斤量。1kg あたりの速度低下（JRA の目安は 1kg = 1 馬身強／2000m）。
  WEIGHT_K: 0.042,
  WEIGHT_BASE: 55,

  // ゲート。
  GATE_BASE: 0.26,     // 平均的な反応遅れ（秒）
};

/** 標準斤量。年齢・性別・季節で動く（JRA の別定の簡略版）。 */
export function standardWeight(age, sex, month) {
  let w = 57;
  if (age === 2) w = 55;
  else if (age === 3) w = month <= 9 ? 56 : 57;
  if (sex === SEX.FEMALE) w -= 2;
  return w;
}

/** 1 年は 48 週（4 週 × 12 か月）。月初＝第 1 週。 */
export const WEEKS_PER_YEAR = 48;
export const weekToMonth = (w) => Math.floor((w - 1) / 4) + 1;
export const weekOfMonth = (w) => ((w - 1) % 4) + 1;

/** 牧場・厩舎の運営費（週あたり、万円）。 */
export const COST = {
  stableWeekly: 70,    // 在厩 1 頭あたり
  pastureWeekly: 22,   // 放牧 1 頭あたり
  broodmareWeekly: 18, // 繁殖牝馬 1 頭あたり
  stallionWeekly: 30,  // 種牡馬 1 頭あたり
  entryFee: 0.3,       // 出走手当の見合い（ごく小額）
};

/** 騎手の歩合（賞金に対する割合）。 */
export const JOCKEY_CUT = 0.05;
/** 調教師の歩合。 */
export const TRAINER_CUT = 0.10;
