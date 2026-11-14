// 実在馬の白斑（顔と脚）。表（data/markings.js）は tools/import-markings.mjs が記事の本文から書く。
// 見た目だけのデータなので世界（セーブ）には持たせず、見せるときに名前と生年で引く
// （表を取り直しても古いセーブに効く。落とし穴 60 の手当てが要らない）。
// 表に無い馬は null を返し、3D は今までどおり馬 id から白斑を決める。

import { MARKINGS } from './data/markings.js';
import { REAL_ALIAS } from './data/real-horses.js';

let index = null;

/** 'starStripe/s' と '0033' → { face, size, legs }。 */
function decode(face, legs) {
  const [f, size = 'm'] = face.split('/');
  return { face: f, size, legs: [...legs].map(Number) };
}

/** 実在馬の白斑。{ face, size, legs:[左前, 右前, 左後, 右後] } か null。 */
export function marksOf(h) {
  if (!h?.real) return null;
  if (!index) {
    // 表記違いでまとめた馬（REAL_ALIAS）は残した名前で引く。同じ馬の行が両方の名前であれば、残した名前の行を採る
    index = new Map();
    for (const [n, b, f, l] of MARKINGS) {
      const key = `${REAL_ALIAS.get(n) ?? n}|${b}`;
      if (!REAL_ALIAS.has(n) || !index.has(key)) index.set(key, decode(f, l));
    }
  }
  return index.get(`${h.regName ?? h.name}|${h.birthYear}`) ?? null;
}
