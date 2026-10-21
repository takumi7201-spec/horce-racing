// 年間番組表。
//
// 1 年を 48 週（1 か月 4 週）で刻む。週 = (月-1)*4 + 月内週。
// 重賞は JRA の体系をほぼそのまま置いた。架空の競馬界だがレース名と
// 施行条件は実在のものに合わせてある（馬が架空、番組が実在、という構え）。
// 条件戦は開催ごとに手続き的に生成する。何十年回しても番組が尽きない。

import { CLASSES, classOrder, SEX, WEEKS_PER_YEAR, weekToMonth, weekOfMonth, CLASS_BY_ID } from './params.js';
import { SURFACE, distancesOf, courseName } from './course.js';

export const W = (month, week) => (month - 1) * 4 + week;

/**
 * 開催場。各月に 3 場。実際の JRA のローテーションに寄せている。
 * 夏は北海道と小倉・新潟に散り、暮れと正月は中山・阪神に集まる。
 */
const MEETINGS = {
  1: ['nakayama', 'kyoto', 'chukyo'],
  2: ['tokyo', 'kyoto', 'kokura'],
  3: ['nakayama', 'hanshin', 'chukyo'],
  4: ['nakayama', 'hanshin', 'fukushima'],
  5: ['tokyo', 'kyoto', 'niigata'],
  6: ['tokyo', 'hanshin', 'hakodate'],
  7: ['fukushima', 'chukyo', 'hakodate'],
  8: ['niigata', 'sapporo', 'kokura'],
  9: ['nakayama', 'hanshin', 'sapporo'],
  10: ['tokyo', 'kyoto', 'niigata'],
  11: ['tokyo', 'kyoto', 'fukushima'],
  12: ['nakayama', 'hanshin', 'chukyo'],
};

export function meetingsOf(week) {
  return MEETINGS[weekToMonth(week)] ?? ['tokyo', 'kyoto', 'chukyo'];
}

const T = SURFACE.TURF;
const D = SURFACE.DIRT;

/**
 * 重賞。
 * age: [下限, 上限]（上限 99 は古馬込み）
 * sex: null（混合）/ '牝'（牝馬限定）
 * prize: 1 着本賞金（万円）
 */
export const GRADED = [
  // --- 1 月 ---
  { id: 'nakayama-kinpai', name: '中山金杯', grade: 'GIII', courseId: 'nakayama', surface: T, distance: 2000, week: W(1, 1), age: [4, 99], prize: 4300 },
  { id: 'kyoto-kinpai', name: '京都金杯', grade: 'GIII', courseId: 'kyoto', surface: T, distance: 1600, week: W(1, 1), age: [4, 99], prize: 4300 },
  { id: 'fairy-s', name: 'フェアリーS', grade: 'GIII', courseId: 'nakayama', surface: T, distance: 1600, week: W(1, 2), age: [3, 3], sex: '牝', prize: 3900 },
  { id: 'shinzan-kinen', name: 'シンザン記念', grade: 'GIII', courseId: 'kyoto', surface: T, distance: 1600, week: W(1, 2), age: [3, 3], prize: 3900 },
  { id: 'keisei-hai', name: '京成杯', grade: 'GIII', courseId: 'nakayama', surface: T, distance: 2000, week: W(1, 3), age: [3, 3], prize: 3900 },
  { id: 'nikkei-shinshun', name: '日経新春杯', grade: 'GII', courseId: 'kyoto', surface: T, distance: 2200, week: W(1, 3), age: [4, 99], prize: 5900 },
  { id: 'ajcc', name: 'アメリカＪＣＣ', grade: 'GII', courseId: 'nakayama', surface: T, distance: 2200, week: W(1, 4), age: [4, 99], prize: 6300 },
  { id: 'tokai-tv', name: '東海S', grade: 'GII', courseId: 'chukyo', surface: D, distance: 1800, week: W(1, 4), age: [4, 99], prize: 5900 },
  { id: 'negishi-s', name: '根岸S', grade: 'GIII', courseId: 'tokyo', surface: D, distance: 1400, week: W(2, 1), age: [4, 99], prize: 4100 },
  // --- 2 月 ---
  { id: 'kyodo-tsushin', name: '共同通信杯', grade: 'GIII', courseId: 'tokyo', surface: T, distance: 1800, week: W(2, 2), age: [3, 3], prize: 4100 },
  { id: 'kisaragi-sho', name: 'きさらぎ賞', grade: 'GIII', courseId: 'kyoto', surface: T, distance: 1800, week: W(2, 1), age: [3, 3], prize: 3900 },
  { id: 'tokyo-shinbun', name: '東京新聞杯', grade: 'GIII', courseId: 'tokyo', surface: T, distance: 1600, week: W(2, 1), age: [4, 99], prize: 4100 },
  { id: 'kyoto-kinen', name: '京都記念', grade: 'GII', courseId: 'kyoto', surface: T, distance: 2200, week: W(2, 2), age: [4, 99], prize: 6300 },
  { id: 'queen-cup', name: 'クイーンC', grade: 'GIII', courseId: 'tokyo', surface: T, distance: 1600, week: W(2, 2), age: [3, 3], sex: '牝', prize: 4100 },
  { id: 'diamond-s', name: 'ダイヤモンドS', grade: 'GIII', courseId: 'tokyo', surface: T, distance: 3400, week: W(2, 3), age: [4, 99], prize: 4100 },
  { id: 'kyoto-fillies', name: '京都牝馬S', grade: 'GIII', courseId: 'kyoto', surface: T, distance: 1400, week: W(2, 3), age: [4, 99], sex: '牝', prize: 3900 },
  { id: 'nakayama-kinen', name: '中山記念', grade: 'GII', courseId: 'nakayama', surface: T, distance: 1800, week: W(3, 1), age: [4, 99], prize: 6300 },
  { id: 'february-s', name: 'フェブラリーS', grade: 'GI', courseId: 'tokyo', surface: D, distance: 1600, week: W(2, 4), age: [4, 99], prize: 12000 },
  { id: 'arlington', name: 'アーリントンC', grade: 'GIII', courseId: 'hanshin', surface: T, distance: 1600, week: W(2, 4), age: [3, 3], prize: 3900 },
  // --- 3 月 ---
  { id: 'tulip-sho', name: 'チューリップ賞', grade: 'GII', courseId: 'hanshin', surface: T, distance: 1600, week: W(3, 1), age: [3, 3], sex: '牝', prize: 5300 },
  { id: 'yayoi-sho', name: '弥生賞', grade: 'GII', courseId: 'nakayama', surface: T, distance: 2000, week: W(3, 1), age: [3, 3], prize: 5700 },
  { id: 'kinko-sho', name: '金鯱賞', grade: 'GII', courseId: 'chukyo', surface: T, distance: 2000, week: W(3, 2), age: [4, 99], prize: 6300 },
  { id: 'fillies-revue', name: 'フィリーズレビュー', grade: 'GII', courseId: 'hanshin', surface: T, distance: 1400, week: W(3, 2), age: [3, 3], sex: '牝', prize: 5300 },
  { id: 'nakayama-himba', name: '中山牝馬S', grade: 'GIII', courseId: 'nakayama', surface: T, distance: 1800, week: W(3, 2), age: [4, 99], sex: '牝', prize: 3900 },
  { id: 'spring-s', name: 'スプリングS', grade: 'GII', courseId: 'nakayama', surface: T, distance: 1800, week: W(3, 3), age: [3, 3], prize: 5700 },
  { id: 'hanshin-daishoten', name: '阪神大賞典', grade: 'GII', courseId: 'hanshin', surface: T, distance: 3000, week: W(3, 3), age: [4, 99], prize: 5900 },
  { id: 'flower-c', name: 'フラワーC', grade: 'GIII', courseId: 'nakayama', surface: T, distance: 1800, week: W(3, 3), age: [3, 3], sex: '牝', prize: 3900 },
  { id: 'nikkei-sho', name: '日経賞', grade: 'GII', courseId: 'nakayama', surface: T, distance: 2500, week: W(3, 4), age: [4, 99], prize: 6300 },
  { id: 'march-s', name: 'マーチS', grade: 'GIII', courseId: 'nakayama', surface: D, distance: 1800, week: W(3, 4), age: [4, 99], prize: 3900 },
  { id: 'takamatsunomiya', name: '高松宮記念', grade: 'GI', courseId: 'chukyo', surface: T, distance: 1200, week: W(3, 4), age: [4, 99], prize: 17000 },
  // --- 4 月 ---
  { id: 'osaka-hai', name: '大阪杯', grade: 'GI', courseId: 'hanshin', surface: T, distance: 2000, week: W(4, 1), age: [4, 99], prize: 20000 },
  { id: 'new-zealand', name: 'ニュージーランドT', grade: 'GII', courseId: 'nakayama', surface: T, distance: 1600, week: W(4, 1), age: [3, 3], prize: 5700 },
  { id: 'oka-sho', name: '桜花賞', grade: 'GI', courseId: 'hanshin', surface: T, distance: 1600, week: W(4, 2), age: [3, 3], sex: '牝', prize: 14000 },
  { id: 'hanshin-himba', name: '阪神牝馬S', grade: 'GII', courseId: 'hanshin', surface: T, distance: 1600, week: W(4, 2), age: [4, 99], sex: '牝', prize: 5300 },
  { id: 'satsuki-sho', name: '皐月賞', grade: 'GI', courseId: 'nakayama', surface: T, distance: 2000, week: W(4, 3), age: [3, 3], prize: 16000 },
  { id: 'antares-s', name: 'アンタレスS', grade: 'GIII', courseId: 'hanshin', surface: D, distance: 1800, week: W(4, 3), age: [4, 99], prize: 3900 },
  { id: 'flora', name: 'フローラS', grade: 'GII', courseId: 'tokyo', surface: T, distance: 2000, week: W(4, 4), age: [3, 3], sex: '牝', prize: 5300 },
  { id: 'aoba-sho', name: '青葉賞', grade: 'GII', courseId: 'tokyo', surface: T, distance: 2400, week: W(4, 4), age: [3, 3], prize: 5700 },
  { id: 'fukushima-himba', name: '福島牝馬S', grade: 'GIII', courseId: 'fukushima', surface: T, distance: 1800, week: W(4, 4), age: [4, 99], sex: '牝', prize: 3900 },
  // --- 5 月 ---
  { id: 'tenno-sho-spring', name: '天皇賞（春）', grade: 'GI', courseId: 'kyoto', surface: T, distance: 3200, week: W(5, 1), age: [4, 99], prize: 22000 },
  { id: 'nhk-mile', name: 'NHKマイルC', grade: 'GI', courseId: 'tokyo', surface: T, distance: 1600, week: W(5, 1), age: [3, 3], prize: 13000 },
  { id: 'kyoto-shinbun', name: '京都新聞杯', grade: 'GII', courseId: 'kyoto', surface: T, distance: 2200, week: W(5, 2), age: [3, 3], prize: 5700 },
  { id: 'victoria-mile', name: 'ヴィクトリアマイル', grade: 'GI', courseId: 'tokyo', surface: T, distance: 1600, week: W(5, 2), age: [4, 99], sex: '牝', prize: 13000 },
  { id: 'oaks', name: 'オークス', grade: 'GI', courseId: 'tokyo', surface: T, distance: 2400, week: W(5, 3), age: [3, 3], sex: '牝', prize: 16500 },
  { id: 'niigata-daishoten', name: '新潟大賞典', grade: 'GIII', courseId: 'niigata', surface: T, distance: 2000, week: W(5, 3), age: [4, 99], prize: 3900 },
  { id: 'derby', name: '日本ダービー', grade: 'GI', courseId: 'tokyo', surface: T, distance: 2400, week: W(5, 4), age: [3, 3], prize: 30000 },
  { id: 'meguro-kinen', name: '目黒記念', grade: 'GII', courseId: 'tokyo', surface: T, distance: 2500, week: W(5, 4), age: [4, 99], prize: 5700 },
  // --- 6 月 ---
  { id: 'yasuda-kinen', name: '安田記念', grade: 'GI', courseId: 'tokyo', surface: T, distance: 1600, week: W(6, 1), age: [3, 99], prize: 18000 },
  { id: 'naruo-kinen', name: '鳴尾記念', grade: 'GIII', courseId: 'hanshin', surface: T, distance: 2000, week: W(6, 1), age: [3, 99], prize: 3900 },
  { id: 'epsom-cup', name: 'エプソムC', grade: 'GIII', courseId: 'tokyo', surface: T, distance: 1800, week: W(6, 2), age: [3, 99], prize: 4100 },
  { id: 'hakodate-sprint', name: '函館スプリントS', grade: 'GIII', courseId: 'hakodate', surface: T, distance: 1200, week: W(6, 3), age: [3, 99], prize: 3900 },
  { id: 'unicorn-s', name: 'ユニコーンS', grade: 'GIII', courseId: 'tokyo', surface: D, distance: 1600, week: W(6, 3), age: [3, 3], prize: 4100 },
  { id: 'takarazuka', name: '宝塚記念', grade: 'GI', courseId: 'hanshin', surface: T, distance: 2200, week: W(6, 4), age: [3, 99], prize: 20000 },
  { id: 'radio-nikkei', name: 'ラジオNIKKEI賞', grade: 'GIII', courseId: 'fukushima', surface: T, distance: 1800, week: W(6, 4), age: [3, 3], prize: 3900 },
  // --- 7 月 ---
  { id: 'tanabata-sho', name: '七夕賞', grade: 'GIII', courseId: 'fukushima', surface: T, distance: 2000, week: W(7, 1), age: [3, 99], prize: 3900 },
  { id: 'procyon-s', name: 'プロキオンS', grade: 'GIII', courseId: 'chukyo', surface: D, distance: 1400, week: W(7, 1), age: [3, 99], prize: 3900 },
  { id: 'hakodate-kinen', name: '函館記念', grade: 'GIII', courseId: 'hakodate', surface: T, distance: 2000, week: W(7, 2), age: [3, 99], prize: 3900 },
  { id: 'chukyo-kinen', name: '中京記念', grade: 'GIII', courseId: 'chukyo', surface: T, distance: 1600, week: W(7, 3), age: [3, 99], prize: 3900 },
  { id: 'queen-s', name: 'クイーンS', grade: 'GIII', courseId: 'sapporo', surface: T, distance: 1800, week: W(8, 1), age: [3, 99], sex: '牝', prize: 3900 },
  // --- 8 月 ---
  { id: 'leopard-s', name: 'レパードS', grade: 'GIII', courseId: 'niigata', surface: D, distance: 1800, week: W(8, 1), age: [3, 3], prize: 3900 },
  { id: 'sekiya-kinen', name: '関屋記念', grade: 'GIII', courseId: 'niigata', surface: T, distance: 1600, week: W(8, 2), age: [3, 99], prize: 3900 },
  { id: 'kokura-kinen', name: '小倉記念', grade: 'GIII', courseId: 'kokura', surface: T, distance: 2000, week: W(8, 2), age: [3, 99], prize: 3900 },
  { id: 'sapporo-kinen', name: '札幌記念', grade: 'GII', courseId: 'sapporo', surface: T, distance: 2000, week: W(8, 3), age: [3, 99], prize: 7000 },
  { id: 'keeneland-cup', name: 'キーンランドC', grade: 'GIII', courseId: 'sapporo', surface: T, distance: 1200, week: W(8, 4), age: [3, 99], prize: 3900 },
  { id: 'niigata-kinen', name: '新潟記念', grade: 'GIII', courseId: 'niigata', surface: T, distance: 2000, week: W(8, 4), age: [3, 99], prize: 4100 },
  // --- 9 月 ---
  { id: 'keisei-ah', name: '京成杯AH', grade: 'GIII', courseId: 'nakayama', surface: T, distance: 1600, week: W(9, 1), age: [3, 99], prize: 3900 },
  { id: 'centaur-s', name: 'セントウルS', grade: 'GII', courseId: 'hanshin', surface: T, distance: 1200, week: W(9, 1), age: [3, 99], prize: 5300 },
  { id: 'rose-s', name: 'ローズS', grade: 'GII', courseId: 'hanshin', surface: T, distance: 1800, week: W(9, 2), age: [3, 3], sex: '牝', prize: 5300 },
  { id: 'st-lite', name: 'セントライト記念', grade: 'GII', courseId: 'nakayama', surface: T, distance: 2200, week: W(9, 2), age: [3, 3], prize: 5700 },
  { id: 'kobe-shinbun', name: '神戸新聞杯', grade: 'GII', courseId: 'hanshin', surface: T, distance: 2400, week: W(9, 3), age: [3, 3], prize: 6300 },
  { id: 'all-comers', name: 'オールカマー', grade: 'GII', courseId: 'nakayama', surface: T, distance: 2200, week: W(9, 3), age: [3, 99], prize: 6300 },
  { id: 'sprinters-s', name: 'スプリンターズS', grade: 'GI', courseId: 'nakayama', surface: T, distance: 1200, week: W(9, 4), age: [3, 99], prize: 17000 },
  { id: 'sirius-s', name: 'シリウスS', grade: 'GIII', courseId: 'hanshin', surface: D, distance: 2000, week: W(9, 4), age: [3, 99], prize: 3900 },
  // --- 10 月 ---
  { id: 'mainichi-okan', name: '毎日王冠', grade: 'GII', courseId: 'tokyo', surface: T, distance: 1800, week: W(10, 1), age: [3, 99], prize: 6300 },
  { id: 'kyoto-daishoten', name: '京都大賞典', grade: 'GII', courseId: 'kyoto', surface: T, distance: 2400, week: W(10, 1), age: [3, 99], prize: 6300 },
  { id: 'shuka-sho', name: '秋華賞', grade: 'GI', courseId: 'kyoto', surface: T, distance: 2000, week: W(10, 2), age: [3, 3], sex: '牝', prize: 13000 },
  { id: 'fuchu-himba', name: '府中牝馬S', grade: 'GII', courseId: 'tokyo', surface: T, distance: 1800, week: W(10, 2), age: [3, 99], sex: '牝', prize: 5300 },
  { id: 'kikka-sho', name: '菊花賞', grade: 'GI', courseId: 'kyoto', surface: T, distance: 3000, week: W(10, 3), age: [3, 3], prize: 15000 },
  { id: 'fuji-s', name: '富士S', grade: 'GII', courseId: 'tokyo', surface: T, distance: 1600, week: W(10, 3), age: [3, 99], prize: 5300 },
  { id: 'tenno-sho-autumn', name: '天皇賞（秋）', grade: 'GI', courseId: 'tokyo', surface: T, distance: 2000, week: W(10, 4), age: [3, 99], prize: 22000 },
  { id: 'swan-s', name: 'スワンS', grade: 'GII', courseId: 'kyoto', surface: T, distance: 1400, week: W(10, 4), age: [3, 99], prize: 5300 },
  // --- 11 月 ---
  { id: 'argentine', name: 'アルゼンチン共和国杯', grade: 'GII', courseId: 'tokyo', surface: T, distance: 2500, week: W(11, 1), age: [3, 99], prize: 5700 },
  { id: 'musashino-s', name: '武蔵野S', grade: 'GIII', courseId: 'tokyo', surface: D, distance: 1600, week: W(11, 1), age: [3, 99], prize: 4100 },
  { id: 'elizabeth', name: 'エリザベス女王杯', grade: 'GI', courseId: 'kyoto', surface: T, distance: 2200, week: W(11, 2), age: [3, 99], sex: '牝', prize: 13000 },
  { id: 'fukushima-kinen', name: '福島記念', grade: 'GIII', courseId: 'fukushima', surface: T, distance: 2000, week: W(11, 2), age: [3, 99], prize: 3900 },
  { id: 'mile-cs', name: 'マイルCS', grade: 'GI', courseId: 'kyoto', surface: T, distance: 1600, week: W(11, 3), age: [3, 99], prize: 18000 },
  { id: 'tokyo-sports', name: '東京スポーツ杯2歳S', grade: 'GII', courseId: 'tokyo', surface: T, distance: 1800, week: W(11, 3), age: [2, 2], prize: 5300 },
  { id: 'japan-cup', name: 'ジャパンC', grade: 'GI', courseId: 'tokyo', surface: T, distance: 2400, week: W(11, 4), age: [3, 99], prize: 40000 },
  { id: 'keihan-hai', name: '京阪杯', grade: 'GIII', courseId: 'kyoto', surface: T, distance: 1200, week: W(11, 4), age: [3, 99], prize: 3900 },
  // --- 12 月 ---
  { id: 'champions-cup', name: 'チャンピオンズC', grade: 'GI', courseId: 'chukyo', surface: D, distance: 1800, week: W(12, 1), age: [3, 99], prize: 12000 },
  { id: 'stayers-s', name: 'ステイヤーズS', grade: 'GII', courseId: 'nakayama', surface: T, distance: 3600, week: W(12, 1), age: [3, 99], prize: 5300 },
  { id: 'hanshin-jf', name: '阪神JF', grade: 'GI', courseId: 'hanshin', surface: T, distance: 1600, week: W(12, 2), age: [2, 2], sex: '牝', prize: 10000 },
  { id: 'chunichi-shinbun', name: '中日新聞杯', grade: 'GIII', courseId: 'chukyo', surface: T, distance: 2000, week: W(12, 2), age: [3, 99], prize: 3900 },
  { id: 'asahi-fs', name: '朝日杯FS', grade: 'GI', courseId: 'hanshin', surface: T, distance: 1600, week: W(12, 3), age: [2, 2], prize: 10000 },
  { id: 'turquoise-s', name: 'ターコイズS', grade: 'GIII', courseId: 'nakayama', surface: T, distance: 1600, week: W(12, 3), age: [3, 99], sex: '牝', prize: 3900 },
  { id: 'arima-kinen', name: '有馬記念', grade: 'GI', courseId: 'nakayama', surface: T, distance: 2500, week: W(12, 4), age: [3, 99], prize: 40000 },
  { id: 'hopeful-s', name: 'ホープフルS', grade: 'GI', courseId: 'nakayama', surface: T, distance: 2000, week: W(12, 4), age: [2, 2], prize: 10000 },
];

const GRADE_CLASS = { GI: 'g1', GII: 'g2', GIII: 'g3' };

export const GRADED_BY_ID = new Map(GRADED.map((r) => [r.id, r]));

/** クラシック三冠と牝馬三冠。表彰と称号に使う。 */
export const TRIPLE_CROWN = ['satsuki-sho', 'derby', 'kikka-sho'];
export const TRIPLE_CROWN_F = ['oka-sho', 'oaks', 'shuka-sho'];

/**
 * ある週に行われるレース一覧を作る。
 * 重賞は固定、条件戦は開催場ごとに生成する。
 */
export function racesOfWeek(year, week, rng) {
  const courses = meetingsOf(week);
  const out = [];

  // 重賞。開催場に無い重賞は、その場が開いていなくても施行する
  // （実際の JRA も代替開催があるため、ここは割り切っている）。
  for (const g of GRADED) {
    if (g.week !== week) continue;
    out.push({
      raceId: `${year}-${g.id}`,
      defId: g.id,
      name: g.name,
      grade: g.grade,
      classId: GRADE_CLASS[g.grade],
      courseId: g.courseId,
      surface: g.surface,
      distance: g.distance,
      age: g.age,
      sex: g.sex ?? null,
      prize: g.prize,
      week, year,
      graded: true,
      maxField: g.grade === 'GI' ? 18 : 18,
    });
  }

  // 条件戦。1 開催あたり 10 レース前後。
  for (const cid of courses) {
    const list = conditionRaces(year, week, cid, rng);
    for (const r of list) out.push(r);
  }
  return out;
}

/** 条件戦の雛形。クラスと本数。季節で 2 歳戦の有無が変わる。 */
function conditionPlan(month) {
  const plan = [];
  // 2 歳の新馬は 6 月から、未勝利は 7 月から。
  if (month >= 6) plan.push({ classId: 'maiden', n: month <= 9 ? 2 : 1, age: [2, 2] });
  if (month >= 7) plan.push({ classId: 'nowin', n: 2, age: [2, 2] });
  // 3 歳の未勝利は 1〜9 月（9 月で終わるのが JRA の体系）。
  if (month <= 9) plan.push({ classId: 'nowin', n: 2, age: [3, 3] });
  plan.push({ classId: 'c1', n: 2, age: month <= 6 ? [3, 3] : [3, 99] });
  plan.push({ classId: 'c1', n: 1, age: [3, 99] });
  plan.push({ classId: 'c2', n: 2, age: [3, 99] });
  plan.push({ classId: 'c3', n: 1, age: [3, 99] });
  plan.push({ classId: 'op', n: 1, age: [3, 99] });
  return plan;
}

const OP_NAMES = ['特別', 'ステークス', '賞'];
const COND_TITLES = [
  '若駒', '若葉', '水仙', '菜の花', '君子蘭', '山吹', '橘', '藤', '早苗',
  '青嵐', '白百合', '紫陽花', '夏木立', '朝顔', '向日葵', '涼風', '秋風',
  '野分', '紅葉', '銀杏', '時雨', '霜月', '寒椿', '新春', '福寿草',
];

/** 条件戦を手続き的に生成する。 */
function conditionRaces(year, week, courseId, rng) {
  const month = weekToMonth(week);
  const out = [];
  const turfD = distancesOf(courseId, SURFACE.TURF);
  const dirtD = distancesOf(courseId, SURFACE.DIRT);
  let no = 1;
  for (const p of conditionPlan(month)) {
    for (let i = 0; i < p.n; i++) {
      // 芝とダートはおおむね半々。ダートの条件戦のほうが数は多い。
      const surface = rng.chance(0.46) ? SURFACE.TURF : SURFACE.DIRT;
      const pool = surface === SURFACE.TURF ? turfD : dirtD;
      // 条件戦は 1200〜2000m が主戦場。長距離の未勝利戦は実際にもほぼ無い。
      const distance = rng.weighted(pool, pool.map((d) => (d <= 1400 ? 3 : d <= 2000 ? 4 : 1)));
      const cls = CLASS_BY_ID.get(p.classId);
      const isOp = p.classId === 'op';
      const sex = rng.chance(0.12) ? '牝' : null;
      const name = isOp
        ? `${rng.pick(COND_TITLES)}${rng.pick(OP_NAMES)}`
        : `${courseName(courseId)}${cls.name}`;
      out.push({
        raceId: `${year}-w${week}-${courseId}-${no}`,
        defId: null,
        name,
        grade: isOp ? 'OP' : null,
        classId: p.classId,
        courseId, surface, distance,
        age: p.age, sex,
        prize: Math.round(cls.prize * (isOp ? 1 : 1) * (surface === SURFACE.TURF ? 1.0 : 0.96)),
        week, year,
        graded: false,
        maxField: surface === SURFACE.TURF ? 18 : 16,
      });
      no++;
    }
  }
  return out;
}

/** その馬がこのレースに出られるか。 */
export function eligible(race, horse, year) {
  const age = year - horse.birthYear;
  if (age < race.age[0] || age > race.age[1]) return false;
  if (race.sex === '牝' && horse.sex !== SEX.FEMALE) return false;
  const co = classOrder(race.classId);
  const ho = classOrder(horse.classId ?? 'nowin');
  // 新馬は未出走馬だけ。
  if (race.classId === 'maiden') return horse.starts === 0;
  if (race.classId === 'nowin') return horse.wins === 0;
  // 条件戦は自分のクラスか、その一つ下まで（格上挑戦）。
  if (co <= 4) return ho === co || ho === co - 1;
  // オープン以上は格上の馬も出られる。
  return ho >= 4 || horse.earnings >= 1500;
}

/** 重賞だけを年間で並べる（番組表画面用）。 */
export function gradedCalendar() {
  return GRADED.slice().sort((a, b) => a.week - b.week);
}

/** 週の表示。「3 月 2 週」。 */
export function weekLabel(week) {
  return `${weekToMonth(week)}月${weekOfMonth(week)}週`;
}

export { WEEKS_PER_YEAR, weekToMonth, weekOfMonth };
