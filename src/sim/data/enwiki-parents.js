// 英語版 Wikipedia から補った父母。tools/import-enwiki-pedigree.mjs が書く（手で直さない）。
// real-horses.js の withEnwiki が表の末尾に重ねる。
//   EW_FILL  [馬名, 生年, 父, 母]   表で父母が空だった馬に補う（null は補わない）
//   EW_NEW   [馬名, 生年, 性, 父, 母]  表に無かった祖先（血統をつなぐだけ。英語名は katakana-names.js でカタカナにする）

export const EW_FILL = [
  ['アークティックプリンス', 1948, 'プリンスシュヴァリエ', null],
];

export const EW_NEW = [

];
