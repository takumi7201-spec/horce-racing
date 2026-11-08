// 育成中の出来事（カード育成モード）。練習の時期に数ターンに 1 回出て、選んだ答えで体力・気分・能力・サポートとの絆が動く。
//
// 文と効き目はこのゲームのオリジナル。足すときは末尾に足す（出来事は (育成のシード, ターン) から並びの番号で選ぶので、
// 途中に挟むと、それ以降の育成で出る出来事が入れ替わる。保存しているのは解決したターンだけなので、古い育成は壊れない）。
//
// effects（どれも省ける）：
//   energy 体力・mood 気分（段）・fans ファン・stats 能力ごとの点・all 全能力の点・bond 絆（対象のサポート）
// risk：{ p, ...effects, note } 確率 p で、effects に加えてこれも起きる（無理をした代わりの、けが・気分の落ち込み）。
// text の {support} は出来事の対象のサポート（support: true の出来事）、{rival} はライバルの名前（rival: true の出来事は、ライバルが居る育成だけに出る）。

export const TRAIN_EVENTS = [
  {
    id: 'rain', title: '雨の調教', text: '朝から雨が強い。馬場はぬかるんでいる。',
    choices: [
      { label: '無理をして走らせる', effects: { energy: -10, stats: { power: 14, guts: 10 } }, risk: { p: 0.3, mood: -1, note: '泥をかぶって機嫌を損ねた' } },
      { label: '休ませる', effects: { energy: 15 } },
    ],
  },
  {
    id: 'awase', title: '併せ馬', text: '{support}が併せ馬の相手を買って出た。', support: true,
    choices: [
      { label: '併せ馬をする', effects: { energy: -8, stats: { speed: 10, guts: 10 }, bond: 1 } },
      { label: '単走にする', effects: { stats: { wit: 8 } } },
    ],
  },
  {
    id: 'heat', title: '脚元の熱', text: '調教のあと、脚元に少し熱を持っている。',
    choices: [
      { label: '大事を取る', effects: { energy: 20 } },
      { label: '様子を見ながら乗る', effects: { stats: { power: 16 } }, risk: { p: 0.25, energy: -20, mood: -1, note: '熱がぶり返した' } },
    ],
  },
  {
    id: 'fans', title: 'ファンの声援', text: '厩舎の前に、応援の横断幕を持ったファンが来ている。',
    choices: [
      { label: '顔を見せに行く', effects: { mood: 1, fans: 600 } },
      { label: '調教に集中する', effects: { stats: { wit: 12 } } },
    ],
  },
  {
    id: 'pool', title: 'プール調教', text: '今日はプールが空いている。',
    choices: [
      { label: 'しっかり泳がせる', effects: { energy: -5, stats: { stamina: 16 } } },
      { label: '軽く泳がせて上がる', effects: { energy: 10 } },
    ],
  },
  {
    id: 'hill', title: '坂路の追い切り', text: '坂路で時計を出す日。',
    choices: [
      { label: '一杯に追う', effects: { energy: -15, stats: { speed: 14, power: 14 } } },
      { label: '馬なりで上がる', effects: { stats: { power: 6 }, energy: 5 } },
    ],
  },
  {
    id: 'gate', title: 'ゲート練習', text: 'ゲートの出が少し遅い。',
    choices: [
      { label: '何度も繰り返す', effects: { energy: -8, stats: { wit: 10, guts: 8 } } },
      { label: '1 回で切り上げる', effects: { stats: { wit: 5 }, energy: 5 } },
    ],
  },
  {
    id: 'meadow', title: '放牧明け', text: '短い放牧から戻ってきた。体はひと回り大きくなっている。',
    choices: [
      { label: 'じっくり乗り込む', effects: { energy: -10, all: 5 } },
      { label: 'のんびり慣らす', effects: { energy: 20, mood: 1 } },
    ],
  },
  {
    id: 'video', title: 'レース映像', text: '前走の映像を見返す時間がとれた。',
    choices: [
      { label: '走りを研究する', effects: { stats: { wit: 18 } } },
      { label: '早めに休ませる', effects: { energy: 12 } },
    ],
  },
  {
    id: 'rival', title: 'ライバルの噂', text: '{rival}が好時計を出したと聞いた。', rival: true,
    choices: [
      { label: '闘志を燃やす', effects: { mood: 1, stats: { guts: 14 } } },
      { label: '自分の調子を守る', effects: { energy: 10 } },
    ],
  },
  {
    id: 'groom', title: '念入りな手入れ', text: '厩務員がいつもより時間をかけて手入れをしたがっている。',
    choices: [
      { label: '任せる', effects: { mood: 1, energy: 5 } },
      { label: 'いつも通りにする', effects: { stats: { stamina: 6 } } },
    ],
  },
  {
    id: 'lesson', title: '先輩の教え', text: '{support}の陣営が、走りのこつを教えてくれるという。', support: true,
    choices: [
      { label: '教わる', effects: { stats: { wit: 6 }, bond: 1 } },
      { label: '自分で考える', effects: { stats: { guts: 8 } } },
    ],
  },
];
