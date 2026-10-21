// 乱数。
// Math.random を使わないのは、同じシードから同じ競馬界を再生成できないと
// セーブデータが成立しないため（世界は「生成結果」ではなく「シード＋経過」で持つ）。

/** xoshiro128** — 周期が長く、下位ビットも素直に散る。 */
export function makeRng(seed = 1) {
  let a = (seed ^ 0x9e3779b9) >>> 0;
  let b = (seed * 0x85ebca6b + 0x165667b1) >>> 0;
  let c = (seed * 0xc2b2ae35 + 0x27d4eb2f) >>> 0;
  let d = (seed ^ 0x61c88647) >>> 0;
  // 初期状態が全ゼロだと以後ずっとゼロになるので潰しておく。
  if ((a | b | c | d) === 0) a = 1;
  for (let i = 0; i < 12; i++) step(); // 立ち上がりの偏りを捨てる

  function step() {
    const t = (b << 9) >>> 0;
    let r = Math.imul(b, 5) >>> 0;
    r = (((r << 7) | (r >>> 25)) >>> 0);
    r = Math.imul(r, 9) >>> 0;
    c = (c ^ a) >>> 0;
    d = (d ^ b) >>> 0;
    b = (b ^ c) >>> 0;
    a = (a ^ d) >>> 0;
    c = (c ^ t) >>> 0;
    d = (((d << 11) | (d >>> 21)) >>> 0);
    return r;
  }

  const rng = {
    /** [0,1) */
    next() {
      return step() / 4294967296;
    },
    /** 状態の読み書き。週送りの途中でセーブしても続きが変わらないように。 */
    save() {
      return [a, b, c, d];
    },
    load(s) {
      [a, b, c, d] = s;
    },
  };
  return attach(rng);
}

/** 便利メソッドを生やす。next() だけ持つ任意のオブジェクトに使える。 */
export function attach(rng) {
  rng.int = (n) => Math.floor(rng.next() * n);
  rng.range = (lo, hi) => lo + rng.next() * (hi - lo);
  rng.irange = (lo, hi) => lo + Math.floor(rng.next() * (hi - lo + 1));
  rng.chance = (p) => rng.next() < p;
  rng.pick = (arr) => arr[Math.floor(rng.next() * arr.length)];

  /** 正規分布（Box-Muller）。能力値の分布は正規に近いほうが自然。 */
  rng.normal = (mean = 0, sd = 1) => {
    let u = 0;
    while (u === 0) u = rng.next(); // log(0) 回避
    const v = rng.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  /** 平均 mean、[lo,hi] に収めた正規分布。能力値はほぼこれで作る。 */
  rng.clampNormal = (mean, sd, lo = 0, hi = 1) => {
    return Math.max(lo, Math.min(hi, rng.normal(mean, sd)));
  };

  /** 重み付き抽選。weights は同じ長さの数値配列。 */
  rng.weighted = (arr, weights) => {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) return arr[0];
    let r = rng.next() * total;
    for (let i = 0; i < arr.length; i++) {
      r -= weights[i];
      if (r <= 0) return arr[i];
    }
    return arr[arr.length - 1];
  };

  /** Fisher-Yates。配列を破壊的に混ぜる。 */
  rng.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  /** 子シード。系統ごとに独立した乱数列を切り出したいとき。 */
  rng.fork = () => makeRng(Math.floor(rng.next() * 0xffffffff) >>> 0);

  return rng;
}

/** 文字列 → 32bit シード（FNV-1a）。「好きな言葉でニューゲーム」用。 */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
