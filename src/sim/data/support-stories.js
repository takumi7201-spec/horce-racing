// サポートとの連続イベント（育成中の出来事の続き物）。サポートとの絆が 1・2・3 に届くたびに、そのサポートの話が 1 話ずつ出る。
// 話はサポートの得意（supportType：いちばん高い能力）ごとに 3 話。文と効き目はこのゲームのオリジナル。{support} はサポートのカードの名前。
//
// effects は育成中の出来事（train-events.js）と同じ形。teach: true はそのサポートのレーススキルをまだ覚えていない分すべて覚える（最終話のご褒美）。
// 話は絆を進めない（進めると、絆 1 に届いた途端に第 1 話から第 3 話まで続けて出た）。
// 最終話は 2 つの答えのどちらでもスキルを覚える（どちらを選んでも報われる。違いは伸びる能力と体力）。

const ep = (title, text, a, b) => ({ title, text, choices: [a, b] });

export const SUPPORT_STORIES = {
  speed: [
    ep('風を切る背中', '{support}が併せ馬のあと「もう一本、全力で」と言い出した。', { label: '受けて立つ', effects: { energy: -10, stats: { speed: 18 } } }, { label: '息を整えてから', effects: { energy: 5, stats: { speed: 8 } } }),
    ep('速さの理由', '{support}の陣営が、スタートからの加速を一緒に見直そうと持ちかけてきた。', { label: '映像で研究する', effects: { stats: { speed: 14, wit: 10 } } }, { label: '実際に走って覚える', effects: { energy: -12, stats: { speed: 22 } } }),
    ep('並んだ先の景色', '{support}と最後の併せ馬。ゴール板の先で、{support}がこちらを振り返った。', { label: '先頭を譲らない', effects: { energy: -8, stats: { speed: 40 }, teach: true } }, { label: '並んで駆け抜ける', effects: { stats: { speed: 25, guts: 15 }, mood: 1, teach: true } }),
  ],
  stamina: [
    ep('長い坂の向こう', '{support}は坂路を何本でも上がる。今日は一緒に来いと言う。', { label: 'ついて行く', effects: { energy: -12, stats: { stamina: 18 } } }, { label: '自分の本数を守る', effects: { energy: 5, stats: { stamina: 8 } } }),
    ep('息の使い方', '{support}の厩務員が、長丁場での息の入れ方を教えてくれるという。', { label: '教わる', effects: { stats: { stamina: 14, wit: 10 } } }, { label: '走りながら試す', effects: { energy: -10, stats: { stamina: 20 } } }),
    ep('終わらない並走', '{support}との最後の並走。どこまで行っても{support}は離れない。', { label: '最後まで付き合う', effects: { energy: -10, stats: { stamina: 40 }, teach: true } }, { label: '途中で前に出る', effects: { stats: { stamina: 25, speed: 15 }, mood: 1, teach: true } }),
  ],
  power: [
    ep('重い馬場の日', '{support}は雨の日ほど機嫌がいい。泥の中の調教に誘われた。', { label: '泥に飛び込む', effects: { energy: -12, stats: { power: 18 } } }, { label: '乾いた所で付き合う', effects: { energy: 5, stats: { power: 8 } } }),
    ep('踏み込みの強さ', '{support}の陣営が、蹄跡を見比べてみようと言ってきた。', { label: '並べて見比べる', effects: { stats: { power: 14, wit: 10 } } }, { label: '坂路で確かめる', effects: { energy: -10, stats: { power: 20 } } }),
    ep('ぶつかり合い', '{support}と最後の追い比べ。馬体を併せたまま坂を上がる。', { label: '押し返す', effects: { energy: -8, stats: { power: 40 }, teach: true } }, { label: '肩を並べて上がりきる', effects: { stats: { power: 25, guts: 15 }, mood: 1, teach: true } }),
  ],
  guts: [
    ep('負けん気', '{support}が、追い抜かれるたびに抜き返してくる。', { label: 'とことん張り合う', effects: { energy: -12, stats: { guts: 18 } } }, { label: '引いて様子を見る', effects: { energy: 5, stats: { guts: 8 } } }),
    ep('苦しいときの顔', '{support}の騎手が、苦しい場面ほど頭を低くしろと教えてくれた。', { label: '頭を低く保つ', effects: { stats: { guts: 14, power: 10 } } }, { label: '限界まで追ってみる', effects: { energy: -10, stats: { guts: 20 } } }),
    ep('最後の一完歩', '{support}と最後の叩き合い。どちらも一歩も引かない。', { label: '首差でも前に出る', effects: { energy: -8, stats: { guts: 40 }, teach: true } }, { label: '同時にゴールする', effects: { stats: { guts: 25, stamina: 15 }, mood: 1, teach: true } }),
  ],
  wit: [
    ep('間合いを読む', '{support}は併せ馬で、いつもこちらの半馬身前を取る。', { label: '位置取りを真似る', effects: { stats: { wit: 18 } } }, { label: '自分の間合いを試す', effects: { energy: 5, stats: { wit: 8 } } }),
    ep('レースの組み立て', '{support}の陣営が、次のレースの展開を一緒に読もうと誘ってきた。', { label: '展開を読む', effects: { stats: { wit: 14, speed: 10 } } }, { label: '実戦形式で確かめる', effects: { energy: -10, stats: { wit: 20 } } }),
    ep('二人だけの合図', '{support}と最後の併せ馬。声を掛けなくても動きが揃う。', { label: '先に仕掛ける', effects: { energy: -5, stats: { wit: 40 }, teach: true } }, { label: '合図を待つ', effects: { stats: { wit: 25, speed: 15 }, mood: 1, teach: true } }),
  ],
};

// カードのイベント：そのカードだけの 3 話（得意ごとの話の代わりに出る）。文はこのゲームのオリジナル（史実の出来事を下敷きにした）。
// 期間限定のテイエムオペラオー（LT-01）は 2000 年の年間全勝と、有馬記念のハナ差（包まれた馬群をこじ開けた）を下敷きにした。
export const CARD_STORIES = {
  'LT-01': [
    ep('一つも落とさない年', '{support}の陣営が、年明けの調教で言い切った。「今年は一つも負けない」。{support}は黙って坂路へ向かう。',
      { label: '同じ本数を上がる', effects: { energy: -12, stats: { stamina: 16, guts: 6 } } }, { label: '自分の調子を整える', effects: { energy: 6, stats: { stamina: 8 }, mood: 1 } }),
    ep('包囲網', '秋の大一番が近づき、どの陣営も{support}を徹底的にマークしてくる。{support}と、馬群に包まれたまま我慢する練習をすることになった。',
      { label: '内で耐えて脚を溜める', effects: { energy: -8, stats: { guts: 16, wit: 8 } } }, { label: '外へ持ち出す道を探す', effects: { stats: { wit: 14, speed: 8 } } }),
    ep('ハナ差の有馬記念', '有馬記念の直線。前の 2 頭のあいだに、わずかな隙間が開いた。{support}との最後の併せ馬で、その一瞬を再現する。',
      { label: '隙間をこじ開ける', effects: { energy: -8, stats: { guts: 30, power: 12 }, teach: true } }, { label: '外を回って届かせる', effects: { stats: { stamina: 24, speed: 16 }, mood: 1, teach: true } }),
  ],
};

