// 効果音。assets/sfx/*.mp3 を Web Audio で鳴らす（earshot の forge バンクから書き出したもの）。
// 画面を作る層だけが使う。sim と render3d は音を知らない（結果を変えないので）。
//
// AudioContext はユーザー操作の後でないと動かない（自動再生の規制）。最初のクリックで
// 作って読み込む。それまでの play() は黙って捨てる。

const NAMES = ['click', 'tick', 'next', 'ok', 'err', 'gate', 'win', 'goal', 'bell'];
const KEY = 'keiba-sound';

let ctx = null;
let master = null;
const buffers = new Map();
let muted = false;
try { muted = localStorage.getItem(KEY) === 'off'; } catch { /* 保存できない環境では毎回オン */ }

async function load(name) {
  try {
    const res = await fetch(new URL(`../../assets/sfx/${name}.mp3`, import.meta.url));
    buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
  } catch { /* 音が無くても遊べる */ }
}

function init() {
  if (ctx || typeof AudioContext === 'undefined') return;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.6;
  master.connect(ctx.destination);
  NAMES.forEach(load);
}

/** 最初の操作で AudioContext を起こす。 */
export function unlock() {
  init();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

/** 鳴らす。volume は 0..1、rate は音程（再生速度）。 */
export function play(name, { volume = 1, rate = 1 } = {}) {
  const buf = buffers.get(name);
  if (!ctx || !buf || muted || ctx.state !== 'running') return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = volume;
  src.connect(g).connect(master);
  src.start();
}

export function isMuted() { return muted; }

export function setMuted(v) {
  muted = v;
  if (master) master.gain.value = v ? 0 : 0.6;
  try { localStorage.setItem(KEY, v ? 'off' : 'on'); } catch { /* 同上 */ }
}

/** どのボタンにも個別に書かなくて済むよう、クリックを一か所で拾う。 */
export function installGlobalClicks() {
  document.addEventListener('pointerdown', unlock, { capture: true });
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('button, .btn, .tab, .sideb, tr[onclick], .card.click');
    if (!b || b.disabled) return;
    // NEXT・ミュートは専用の音を鳴らす
    if (b.classList.contains('nextb') || b.classList.contains('muteb')) return;
    play('click');
  }, true);
}
