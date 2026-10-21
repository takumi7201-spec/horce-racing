// 馬名・人名の生成。
//
// 実在の競走馬は登場させない（架空の競馬界をシードから作る方針）。
// 馬名は JRA の規則にならってカタカナ 2〜9 文字。語の断片を繋げて作るが、
// 「冠名＋語」「語＋語」「語＋接尾」の三型を混ぜないと、どれも同じ形に見える。

// 冠名（馬主ごとに固定で付く接頭語）
const KANMEI = [
  'サクラ', 'メジロ', 'タマモ', 'ヒシ', 'ナリタ', 'テイエム', 'マチカネ', 'コスモ',
  'ダイワ', 'シンボリ', 'ビワ', 'ステイ', 'アドマイヤ', 'キョウエイ', 'ユキノ',
  'トウカイ', 'ヤマニン', 'ニシノ', 'エイシン', 'ロジ', 'シゲル', 'スズカ',
  'ホクト', 'カネツ', 'オース', 'リワード', 'グレイト', 'キタノ', 'ミホノ',
];

// 前半に置く語（意味のある塊）
const HEAD = [
  'ゴールド', 'シルバー', 'ブライト', 'ブレイブ', 'グラン', 'ノーブル', 'ロイヤル',
  'クラウン', 'ダイヤ', 'クリスタル', 'サンデー', 'ムーン', 'スター', 'コメット',
  'サンダー', 'ストーム', 'ブリーズ', 'ウィンド', 'オーシャン', 'リバー', 'マウンテン',
  'フォレスト', 'サバンナ', 'デザート', 'グレイス', 'エンジェル', 'ビーナス', 'アポロ',
  'ユピテル', 'ネプチューン', 'タイタン', 'ドラゴン', 'ファルコン', 'イーグル',
  'タイガー', 'レオ', 'ユニコーン', 'ペガサス', 'フェニックス', 'サムライ', 'ショーグン',
  'ミカド', 'ヤマト', 'アサヒ', 'ユウヒ', 'ハルカ', 'ミドリ', 'シラユキ', 'クレナイ',
  'アオゾラ', 'カゼ', 'ヒカリ', 'ホシ', 'ウミ', 'ヤマ', 'ハナ', 'ツキ',
  'ヴィクトリー', 'トライアンフ', 'グローリー', 'オナー', 'レガシー', 'ヘリテージ',
  'ダンサー', 'シンガー', 'ポエム', 'ソナタ', 'ワルツ', 'マーチ', 'ラプソディ',
  'ミラクル', 'マジック', 'ドリーム', 'ホープ', 'ウィッシュ', 'プロミス', 'デスティニー',
];

// 後半に置く語
const TAIL = [
  'シップ', 'ロード', 'キング', 'クイーン', 'プリンス', 'プリンセス', 'エンペラー',
  'バロン', 'ナイト', 'ソルジャー', 'ハンター', 'チェイサー', 'ランナー', 'フライヤー',
  'アロー', 'ブレード', 'スピア', 'シールド', 'アーマー', 'ヘルム', 'クレスト',
  'ベル', 'リング', 'クロス', 'ゲート', 'タワー', 'ブリッジ', 'ハーバー',
  'ライト', 'フレイム', 'ブレイズ', 'シャイン', 'グロウ', 'スパーク', 'フラッシュ',
  'ウイング', 'ステップ', 'ダッシュ', 'ドライブ', 'スパート', 'ターボ', 'エンジン',
  'ハート', 'ソウル', 'スピリット', 'マインド', 'ウィル', 'フェイス', 'プライド',
  'ローズ', 'リリー', 'サクラ', 'ツバキ', 'スミレ', 'アイリス', 'ジャスミン',
  'テソーロ', 'エスポワール', 'アミーゴ', 'セニョール', 'ドルチェ', 'ヴィータ',
  'ノヴァ', 'コード', 'ゼロ', 'エース', 'ワン', 'セブン',
];

// 単体でも成立する短い語（冠名と組むとき用）
const SHORT = [
  'バイオ', 'テイオー', 'ブライアン', 'ペガサス', 'マックス', 'ジェット', 'ロケット',
  'ガイア', 'ノア', 'イオ', 'エコー', 'ゼウス', 'ヘラ', 'ルナ', 'ソル', 'テラ',
  'ユーリ', 'ノエル', 'ミーティア', 'オルフェ', 'クレスト', 'ロンド', 'カノン',
];

const MAX_NAME = 9; // JRA 規則：カタカナ 9 文字以内

/**
 * 馬名を作る。used に Set を渡すと重複を避ける（競馬界に同名は居ない）。
 * @param {{next:()=>number,pick:(a:any[])=>any,chance:(p:number)=>boolean}} rng
 */
export function makeHorseName(rng, { used = null, kanmei = null } = {}) {
  for (let attempt = 0; attempt < 40; attempt++) {
    let name;
    const r = rng.next();
    if (kanmei && r < 0.72) {
      // 馬主の冠名が決まっているなら優先的に冠名型。
      name = kanmei + rng.pick(r < 0.4 ? SHORT : TAIL);
    } else if (r < 0.3) {
      name = rng.pick(KANMEI) + rng.pick(SHORT);
    } else if (r < 0.75) {
      name = rng.pick(HEAD) + rng.pick(TAIL);
    } else if (r < 0.9) {
      name = rng.pick(HEAD);
    } else {
      name = rng.pick(KANMEI) + rng.pick(TAIL);
    }
    if (name.length > MAX_NAME) continue;
    if (name.length < 3) continue;
    if (used && used.has(name)) continue;
    if (used) used.add(name);
    return name;
  }
  // 40 回当たらなければ連番で逃がす（世界が何十年も続くと語の組合せは枯れる）。
  let n = 2;
  let base = rng.pick(HEAD);
  while (used && used.has(base + toKana(n))) n++;
  const name = (base + toKana(n)).slice(0, MAX_NAME);
  if (used) used.add(name);
  return name;
}

// 2 → "ツー"。ザ・セカンド 的な逃げ道。
const NUM_KANA = ['', '', 'ツー', 'スリー', 'フォー', 'ファイブ', 'シックス', 'セブン', 'エイト', 'ナイン'];
function toKana(n) {
  return NUM_KANA[n] || `ナンバー${n}`;
}

const SURNAME = [
  '武', '横山', '福永', '岩田', '川田', '松山', '戸崎', '北村', '池添', '浜中',
  '藤岡', '幸', '和田', '小牧', '四位', '吉田', '安藤', '佐藤', '田辺', '三浦',
  '大野', '内田', '柴田', '津村', '丸山', '石橋', '木幡', '菅原', '原', '斎藤',
  '高倉', '森', '国分', '鮫島', '坂井', '西村', '団野', '今村', '永野', '角田',
];
const GIVEN_M = [
  '豊', '健太', '祐一', '将雅', '隆行', '直人', '勝彦', '哲三', '洋一', '俊介',
  '雄大', '一真', '友一', '光', '涼介', '翔太', '龍一', '聡', '貴史', '裕也',
];
const GIVEN_F = ['彩花', '美穂', '沙織', '真央', '結衣', '優花', '菜々', '千尋'];

export function makePersonName(rng, { female = false, used = null } = {}) {
  for (let i = 0; i < 30; i++) {
    const g = female ? rng.pick(GIVEN_F) : rng.pick(GIVEN_M);
    const name = `${rng.pick(SURNAME)} ${g}`;
    if (used && used.has(name)) continue;
    if (used) used.add(name);
    return name;
  }
  return `${rng.pick(SURNAME)} ${rng.irange(2, 9)}郎`;
}

const FARM_HEAD = ['社台', 'ノーザン', '追分', '白老', '千代田', '谷川', '下河辺',
  'ビッグレッド', 'レイクヴィラ', '岡田', '三嶋', '荻伏', '新冠', '静内', '門別'];
const FARM_TAIL = ['ファーム', '牧場', 'スタッド', 'F', 'ホースパーク'];

export function makeFarmName(rng, used = null) {
  for (let i = 0; i < 30; i++) {
    const name = rng.pick(FARM_HEAD) + rng.pick(FARM_TAIL);
    if (used && used.has(name)) continue;
    if (used) used.add(name);
    return name;
  }
  return `${rng.pick(FARM_HEAD)}${rng.irange(2, 9)}牧場`;
}

const OWNER_HEAD = ['', '株式会社', '有限会社'];
const OWNER_BODY = ['サンライズ', 'オーシャン', 'キャロット', 'シルク', 'ロード',
  'ウイン', 'ゴドルフィン', 'タニグチ', 'カネコ', 'コウエイ', 'ミツイ', 'ヤスダ',
  'ハシモト', 'オカベ', 'マルゼン', 'トウショウ', 'ニットウ', 'セイウン'];

export function makeOwnerName(rng, used = null) {
  for (let i = 0; i < 30; i++) {
    const h = rng.chance(0.3) ? rng.pick(OWNER_HEAD) : '';
    const name = h + rng.pick(OWNER_BODY) + (rng.chance(0.4) ? 'レーシング' : '');
    if (used && used.has(name)) continue;
    if (used) used.add(name);
    return name;
  }
  return `${rng.pick(OWNER_BODY)}${rng.irange(2, 9)}`;
}

/** 系統名（○○系）。創始種牡馬の名前から作る。 */
export function lineNameOf(horseName) {
  return `${horseName}系`;
}

export { KANMEI };
