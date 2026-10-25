// タイトル画面。ニューゲームとロード。

import { el, button, card, table, toast } from '../dom.js';
import { newGame } from '../../sim/game.js';
import { slotInfo } from '../../sim/save.js';
import { formatMoney } from '../../core/util.js';
import { weekLabel } from '../../sim/schedule.js';

export function titleScreen(app) {
  const name = el('input.inp', { type: 'text', placeholder: '馬主名（例：高橋 健太）', maxLength: 12 });
  const farm = el('input.inp', { type: 'text', placeholder: '牧場名（例：みどりヶ丘ファーム）', maxLength: 16 });
  const seed = el('input.inp', { type: 'text', placeholder: 'シード（空欄ならランダム）', maxLength: 24 });
  const realSires = el('input', { type: 'checkbox', checked: true });
  // 開始年。昔から始めると、実在の名馬が史実の年に生まれ、輸入馬が史実の年にやって来る。
  const START_YEARS = [
    [2026, '2026年（イクイノックス・キタサンブラックの時代）'],
    [2005, '2005年（ディープインパクトが 3 歳）'],
    [1995, '1995年（サンデーサイレンスの初年度産駒がクラシックへ）'],
    [1985, '1985年（シンボリルドルフが 4 歳）'],
    [1975, '1975年（トウショウボーイ・テンポイントが 2 歳）'],
  ];
  const startYear = el('select.inp', START_YEARS.map(([y, label]) => el('option', { value: String(y), text: label })));
  const status = el('p.note');

  const begin = () => {
    status.textContent = '競馬界を生成中…（血統を 56 年ぶんさかのぼっています）';
    // 生成に 0.2 秒ほどかかるので、描画を 1 フレーム待ってから走らせる。
    requestAnimationFrame(() => setTimeout(() => {
      try {
        app.game = newGame({
          seed: seed.value.trim() || (Date.now() & 0xffffff),
          playerName: name.value.trim(),
          farmName: farm.value.trim(),
          realSires: realSires.checked,
          startYear: Number(startYear.value),
        });
        app.stack.length = 0;
        app.go('home', {}, { replace: true });
      } catch (e) {
        // 生成の後の最初の描画で落ちても、ここに来る。原因を追えるよう console にも残す。
        console.error(e);
        status.textContent = `生成に失敗：${e.message}`;
      }
    }, 20));
  };

  const slots = [1, 2, 3].map((s) => {
    const info = slotInfo(s);
    return [
      `スロット${s}`,
      info ? `${info.year}年 ${weekLabel(info.week)}` : '—',
      info ? info.farm : '空',
      info ? formatMoney(info.money) : '—',
      info ? `GI ${info.g1}勝` : '',
      button('続ける', () => app.load(s), { cls: 'sm primary', disabled: !info }),
    ];
  });

  return el('div.title', [
    el('div.title-hero', [
      el('h1', { text: 'ウイニングロード' }),
      el('small.ver', { text: 'ver 1.0.2' }),
      el('p.sub', { text: '牧場経営・配合・3D レース観戦までを一本で回す競馬シミュレーション' }),
    ]),
    el('div.title-cols', [
      card('ニューゲーム', [
        el('div.form', [
          el('label', ['馬主名', name]),
          el('label', ['牧場名', farm]),
          el('label', ['シード', seed]),
          el('label', ['開始年', startYear]),
          el('label.check', [realSires, el('span', { text: '実在の馬を使う（昔から始めると、名馬が史実の年に生まれてくる）' })]),
        ]),
        el('p.note', 'シードを同じにすると、同じ競馬界（同じ血統・同じ馬）が生成される。'),
        button('はじめる', begin, { cls: 'primary big' }),
        status,
      ]),
      card('つづきから', [
        table(['', '時期', '牧場', '資金', '', ''], slots),
        el('p.note', 'セーブデータはこの端末のブラウザに保存される。'),
      ]),
    ]),
    card('遊びかた', [
      el('ul.howto', [
        el('li', { text: '所有馬を厩舎に入れ、調教メニューを当てて仕上げる。仕上がり 7 割を超えたら使える。' }),
        el('li', { text: '番組表から出走レースを選び、騎手と脚質を決めて登録する。登録は 1 年先の番組まで先取りできる。' }),
        el('li', { text: '「次の週へ」で 1 週進む。長押しすると各月の 1 週や行事の週まで、または 1 週〜1 年の好きな週数をまとめて進める。自分の馬が走る週は 3D で観戦できる。' }),
        el('li', { text: '牧場の一年：4 月に幼駒が生まれ、5〜6 月に種付け。8 月は当歳セール、10 月は繁殖牝馬セール、12 月 3 週は海外トレーニングセール、12 月 4 週に入厩先と馬名を決めて年末処理。庭先取引は 3・7・12 月、セールの外でも牧場取引で幼駒と繁殖牝馬を買える。資金に余裕があれば牧場に施設を建てられる。' }),
        el('li', { text: '配合ではインブリード・ニックスと、成り立った配合理論が効く。' }),
        el('li', { text: 'キー操作：N で週送り、S でセーブ。' }),
      ]),
    ]),
  ]);
}
