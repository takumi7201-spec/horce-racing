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

// カードのイベント：そのカードだけの 3 話（得意ごとの話の代わりに出る）。答えの reply は選んだ後に見せる反応（展開）。
// テイエムオペラオー（LT-01）は利用者のシナリオ「2000年有馬記念 テイエムオペラオー イベントシナリオ」のとおり（状況・エピソード・選択肢・展開）。
// 効き目（effects）は話の中身に合わせてこちらで決めた（落ち着く → 賢さ、地力 → パワー・根性、突き抜ける → スピード…）。
// カードのイベントの題（カードの裏面に出す）。話の題は各話の title。
export const CARD_STORY_TITLE = { 'LT-01': '2000年有馬記念' };

export const CARD_STORIES = {
  'LT-01': [
    {
      title: '包囲網の罠',
      text: '2000年、年間無敗の偉業がかかった有馬記念。道中、オペラオーは他陣営の徹底的なマークにあい、完全に馬群の中に閉じ込められてしまう。進路はどこにもない絶体絶命の展開。\n'
        + '周囲が「オペラオーを封じ込めた」と確信する中、彼は慌てる素振りすら見せず、包囲網の中で静かに脚を溜めていた。\n'
        + '「……まるで世界中がボクを止めようとしているかのようだね」\n'
        + 'オペラオーは心の中でクスリと笑う。絶望的な状況であるほど、王者の輝きは増すのだから。',
      choices: [
        { label: '「落ち着いて進路を探すんだ！」', effects: { stats: { wit: 16, guts: 6 } },
          reply: 'オペラオーは「フッ、言われずともね」と心の中で頷き、冷静に他馬の動きを観察。一瞬のスキマを見逃さない集中力を研ぎ澄ます。' },
        { label: '「オペラオー、地力でねじ伏せろ！」', effects: { energy: -10, stats: { power: 14, guts: 12 } },
          reply: '「ハハハ！そうこなくっちゃ！」と闘志を爆発させ、包囲網のプレッシャーを跳ね返すほどの圧倒的な覇気を放ち始める。' },
      ],
    },
    {
      title: '一瞬の抜け道',
      text: '最終コーナーを回り、ラストの直線へ。前方は依然として壁のように他馬が塞ぎ、見守る観客からも悲鳴に近い声が上がる。残り200メートル、絶望の淵。\n'
        + 'その時、前方の馬群がほんのわずか、一頭分だけ開いた。騎手の手綱に応え、オペラオーはその一筋の光めがけて弾丸のように飛び込む！無理と思われた狭いスキマを強引にこじ開け、劇的に抜け出した。\n'
        + '「王者の道は、自ら切り開くものさ！」',
      choices: [
        { label: '「行けぇぇぇ！そのまま突き抜けろ！」', effects: { energy: -8, stats: { speed: 16, power: 8 } },
          reply: '声援に応えるようにオペラオーのギアがさらに一段上がり、ライバルたちを置き去りにする圧巻のスパートを見せる。' },
        { label: '「信じてたぞ、オペラオー！」', effects: { stats: { guts: 10, wit: 8 }, mood: 1 },
          reply: '「ふふん、ボクを誰だと思っているんだい？」と言わんばかりに胸を張り、満面の自信を漂わせながらゴールへと突き進む。' },
      ],
    },
    {
      title: '世紀末の覇王',
      text: '抜け出した直後、外からメイショウドトウらが猛烈な勢いで迫り、ゴール前は数センチ刻みの壮絶な叩き合いに。そして——ハナ差でゴール板を駆け抜けた。\n'
        + '年間8戦全勝、古馬中長距離G1全勝という空前絶後の偉業達成。ウイナーズサークルへ戻る道中、オペラオーは誇らしげに首を上げ、観客の歓声を全身で受け止めていた。'
        + '完璧な包囲網すら跳ね返した、完璧な王者の姿がそこにあった。',
      choices: [
        { label: '「最高のレースだったよ、世紀末覇王！」', effects: { stats: { speed: 20, stamina: 18 }, mood: 1, teach: true },
          reply: '「当然さ。ボクのオペラは、いつだって最高のクライマックスを迎えるのだからね！」と、完璧なポーズを決めて歓声に応える。' },
        { label: '「ヒヤヒヤさせないでくれよ…（ホッとする）」', effects: { energy: -6, stats: { guts: 30, power: 14 }, teach: true },
          reply: '「やれやれ、観客を退屈させないための演出だよ」と悪戯っぽく笑い、そっと疲れを滲ませながらも誇り高く勝利を噛み締める。' },
      ],
    },
  ],
};
