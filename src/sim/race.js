// レースシミュレーション。
//
// 0.1 秒刻みで全馬の速度・位置・横位置・余力（HP）を進める。
// 画面は一切触らない。代わりに 0.2 秒ごとの位置を Float32Array に記録して返し、
// 3D ビューはそれを再生するだけにしている。こうしておくと
// 「レース結果は決定論的、見せ方は後からいくらでも変えられる」状態が保てる。
//
// モデルの骨格
//   1. 最高速 vMax は能力と適性で決まるが、未勝利馬と GI 馬の差は数パーセント。
//      勝負を分けるのは「どこまで保てるか」＝余力 HP の設計。
//   2. 道中は先頭が決めた速度に全馬が合わせる（馬群は同じ速さで動く）。
//      脚質の違いは「先頭から何メートル後ろに居たいか」だけ。
//   3. 余力が減ると最高速が連続的に落ちる。ここを階段にすると
//      「直線でぴたりと止まる」不自然な絵になる。
//   4. 横位置は内ラチからのメートル。コーナーで外を回れば本当に距離を損する。
//
// 時計の目安（能力 0.62／適性ぴったりの馬 16 頭）：
//   芝 1200m ≒ 1:09 / 芝 1600m ≒ 1:33 / 芝 2400m ≒ 2:25 / 芝 3200m ≒ 3:15
// ここが崩れたら PHYS を疑う。tools/timecheck.mjs が範囲を見ている。

import { TICK, PHYS, GROUND_EFFECT, GROUNDS, PRIZE_SHARE } from './params.js';
import {
  effectiveAbility, distanceAptitude, surfaceAptitude, groundAptitude,
  styleLabel, STYLE_TARGET, horseAge,
} from './horse.js';
import { buildTrack, curvatureAt, gradeAt, SURFACE, posToWorld } from './course.js';
import { clamp, clamp01, lerp, formatMargin } from '../core/util.js';

/** 馬 1 頭が横に必要とする幅（m）。進路の取り合いの判定に使う。 */
const BODY_W = 2.2;
/** 1 頭の体長（m）。前の馬に詰まる距離の基準。 */
const BODY_LEN = 2.4;

/**
 * 出走馬ごとの「レース当日の素」を作る。
 * ここで能力・適性・斤量をすべて速度と HP に畳んでおき、
 * メインループでは物理だけを回す。
 */
function prepareRunner(entry, spec, rng) {
  const { horse, jockey, weight } = entry;
  const eff = effectiveAbility(horse, spec.year);
  const gi = Math.max(0, GROUNDS.indexOf(spec.ground));
  const ge = (GROUND_EFFECT[spec.surface] ?? GROUND_EFFECT['芝'])[gi];

  const dApt = distanceAptitude(horse, spec.distance);
  const sApt = surfaceAptitude(horse, spec.surface);
  const gApt = groundAptitude(horse, gi);

  // 適性は「能力をどれだけ出せるか」の係数。素の掛け算だと適性外が壊滅するので、
  // それぞれを 0.6〜1.0 の帯に写してから掛ける。
  const apt = lerp(0.74, 1.0, dApt) * lerp(0.80, 1.0, sApt) * lerp(0.88, 1.0, gApt);

  const jk = jockey ?? { id: null, name: '—', skill: 0.45, aggression: 0.5 };
  // 騎手は最高速をわずかに、位置取りの精度を大きく左右する。
  const jkSpeed = 1 + (jk.skill - 0.5) * 0.030;
  const wPen = 1 - (weight - PHYS.WEIGHT_BASE) * PHYS.WEIGHT_K / 100;

  let vMax = (PHYS.V_BASE + PHYS.V_SPEED_GAIN * eff.speed) * apt * ge.speed * jkSpeed * wPen;
  if (spec.surface === SURFACE.DIRT) vMax -= PHYS.V_DIRT_PENALTY;

  // 距離適性は HP にも効く。マイラーが 3200m を持たないのはこの項。
  const hp = (PHYS.HP_BASE + PHYS.HP_STAM_GAIN * eff.stamina)
    * lerp(0.62, 1.08, dApt) / ge.stam;

  // 指示脚質。無指示なら馬の持ち味。素直さと騎手の腕で指示に寄る。
  const wantStyle = entry.styleOrder && STYLE_TARGET[entry.styleOrder] != null
    ? lerp(horse.style, STYLE_TARGET[entry.styleOrder],
      clamp01(horse.styleFlex * 0.6 + jk.skill * 0.5))
    : horse.style;

  // 仕掛けどころ。後ろの馬は直線まで待つ。賢い馬ほどぶれない。
  const wisdom = eff.wit * 0.6 + jk.skill * 0.4;
  const spurtRem = clamp(
    lerp(430, 700, wantStyle) + rng.normal(0, lerp(100, 25, wisdom)),
    240, Math.min(1000, spec.distance - 180),
  );

  // ゲート。気性と騎手で出遅れる。
  const gateDelay = Math.max(0, PHYS.GATE_BASE
    + rng.normal(0, 0.17) * (1.6 - horse.temper)
    - (jk.skill - 0.5) * 0.12);

  return {
    id: horse.id, horse, jockey: jk, weight,
    name: horse.name, gate: entry.gate, frame: entry.frame,
    eff, apt, dApt, sApt, gApt,
    vMax, hp, hp0: hp,
    wantStyle, spurtRem, gateDelay,
    // 掛かりやすさ。気性が悪いと道中で引っ張り合いになり余力を使う。
    pull: clamp01((1 - horse.temper) * 1.1 - jk.skill * 0.35),
    guts: eff.guts, spirit: horse.spirit,
    accMax: PHYS.ACC_MAX_BASE + PHYS.ACC_MAX_GAIN * eff.power,
    // 状態
    p: 0, v: 0, s: 0, off: 0, hpLeft: hp, busted: false, bustT: 0,
    finishT: Infinity, order: 0, dnf: false,
    blockT: 0, wideT: 0, pulledT: 0, offSum: 0, offN: 0,
    last3fStart: -1, last3fTime: 0,
    styleLabel: entry.styleOrder || styleLabel(horse),
  };
}

/**
 * 公開情報からのオッズ。
 * 実力そのままではなく、見える情報（戦績・騎手・クラス）に寄せた推定値を使う。
 * 「人気薄が走る」余地をここで作る。
 */
export function computeOdds(runners, spec, rng) {
  const est = runners.map((r) => {
    const h = r.horse;
    const form = Math.log10(1 + h.earnings / 300) / 2.4;
    const winRate = h.starts > 0 ? h.wins / h.starts : 0.12;
    const visible = (r.eff.speed + r.eff.stamina + r.eff.power) / 3;
    const base = visible * 0.52 + form * 0.26 + winRate * 0.12 + r.jockey.skill * 0.10;
    // 市場の読み違い。±18% 程度ぶれる。
    return Math.max(0.02, base * (1 + rng.normal(0, 0.18)));
  });
  const pow = est.map((e) => Math.pow(e, 7)); // 強い馬に票が集まる形
  const total = pow.reduce((a, b) => a + b, 0);
  const takeout = 0.80; // 控除率 20%
  const out = runners.map((r, i) => {
    const p = pow[i] / total;
    return { id: r.id, support: p, odds: Math.max(1.1, Math.round((takeout / p) * 10) / 10) };
  });
  out.slice().sort((a, b) => a.odds - b.odds).forEach((o, i) => { o.popularity = i + 1; });
  return new Map(out.map((o) => [o.id, o]));
}

/**
 * レース本体。
 * @param {object} spec {raceId,name,classId,grade,courseId,surface,distance,ground,weather,year,week,entries,prize}
 * @param {object} rng
 * @param {{record?:boolean}} opts record:false で走行ログを省く（NPC 戦の大量処理用）
 */
export function simulateRace(spec, rng, opts = {}) {
  const record = opts.record !== false;
  const track = buildTrack(spec.courseId, spec.surface, spec.distance);
  const runners = spec.entries.map((e) => prepareRunner(e, spec, rng));
  const n = runners.length;
  if (n === 0) throw new Error('出走馬が居ない');

  const oddsMap = spec.oddsMap ?? computeOdds(runners, spec, rng);
  const maxOff = Math.max(4, track.width - 3);

  // 枠順から初期の横位置（内ラチからの m）。内枠はそのまま内を取れる。
  for (let i = 0; i < n; i++) {
    const r = runners[i];
    r.off = Math.min(maxOff, (r.gate - 1) * 0.42);
    r.p = track.start;
  }

  // 逃げたい馬の数。ハナ争いが起きるとペースが上がる。
  const frontRunners = runners.filter((r) => r.wantStyle < 0.26).length;

  const dist = spec.distance;
  const maxTicks = Math.ceil((dist / 8) / TICK) + 600;
  const frames = record ? Math.ceil(maxTicks / 2) + 2 : 0;
  const logPos = record ? new Float32Array(frames * n) : null;
  const logOff = record ? new Float32Array(frames * n) : null;
  const logV = record ? new Float32Array(frames * n) : null;
  let frameCount = 0;

  const checkpoints = cornerCheckpoints(track, dist);
  const passing = runners.map(() => []);
  const LAST3F = 600;

  let t = 0;
  let finished = 0;
  const order = [];

  while (finished < n && t < maxTicks * TICK) {
    // 先頭の位置と速度。追走の基準になる。
    let leadS = -1, leadV = 0;
    for (const r of runners) {
      if (r.s > leadS) { leadS = r.s; leadV = r.v; }
    }

    for (let i = 0; i < n; i++) {
      const r = runners[i];
      if (r.finishT < Infinity) continue;
      if (t < r.gateDelay) continue; // まだゲートの中

      const rem = dist - r.s;
      const posInLap = ((r.p % track.lap) + track.lap) % track.lap;
      const k = curvatureAt(track, r.p);
      const grade = gradeAt(track, (track.lap - posInLap) % track.lap);

      // --- いま出せる最高速 ---
      // 余力が減るほど連続的に落ちる。空になってからはさらに落ち続ける。
      const hpRatio = clamp01(r.hpLeft / r.hp0);
      let fade = 1 - PHYS.FADE_K * Math.pow(1 - hpRatio, 2.2);
      if (r.busted) fade -= PHYS.BUST_RATE * (t - r.bustT);
      fade = Math.max(PHYS.BUST_FLOOR, fade);

      let vCap = r.vMax * fade
        * (1 - k * PHYS.CORNER_SLOW)
        * (1 - grade * PHYS.GRADE_SLOW);

      // 残り 400m は根性と底力で粘る。
      if (rem < 400) {
        vCap *= 1 + PHYS.GUTS_GAIN * (r.guts * 0.7 + r.spirit * 0.3) * (1 - rem / 400);
      }

      // --- 目標速度 ---
      let vDes;
      if (rem <= r.spurtRem) {
        vDes = vCap; // 勝負所。出せるだけ出す
      } else if (r.s < 180) {
        // スタート直後の位置取り争い。前を取りたい馬は踏む。
        vDes = vCap * lerp(1.0, 0.87, r.wantStyle);
      } else {
        const want = targetGap(r.wantStyle, dist, n);
        const gap = leadS - r.s;
        const cruise = cruiseRatio(r, dist, frontRunners);
        if (leadS <= r.s) {
          vDes = vCap * cruise; // 自分が先頭。ペースは自分で決める
        } else {
          vDes = clamp(leadV + (gap - want) * 0.55, vCap * 0.70, vCap * cruise);
        }
        // 掛かる馬は抑えが効かず、道中で余計に踏んでしまう。
        if (r.pull > 0.25 && rem > dist * 0.45) {
          vDes = Math.min(vCap, vDes * (1 + r.pull * 0.05));
          r.pulledT += TICK * r.pull;
        }
      }

      // --- 進路 ---
      let blocker = null;
      let minGap = Infinity;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const o = runners[j];
        if (o.finishT < Infinity) continue;
        const d = o.s - r.s;
        if (d <= 0 || d > PHYS.BLOCK_GAP + BODY_LEN) continue;
        if (Math.abs(o.off - r.off) > BODY_W * 0.8) continue;
        if (d < minGap) { minGap = d; blocker = o; }
      }
      if (blocker && vDes > blocker.v) {
        const squeeze = clamp01((PHYS.BLOCK_GAP + BODY_LEN - minGap) / (PHYS.BLOCK_GAP + BODY_LEN));
        vDes = Math.min(vDes, blocker.v * (1 - 0.05 * squeeze));
        r.blockT += TICK;
        // 外へ持ち出す。賢い馬・上手い騎手は早めに動く。
        const skill = r.eff.wit * 0.5 + r.jockey.skill * 0.5;
        r.off = Math.min(maxOff, r.off + PHYS.LANE_SHIFT * TICK * (0.6 + skill));
        if (k > 0) r.wideT += TICK;
      } else if (r.off > 0) {
        // 内が空いていれば寄せる。前後に馬が居る間は寄せられない。
        let innerFree = true;
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const o = runners[j];
          if (o.finishT < Infinity) continue;
          if (Math.abs(o.s - r.s) > BODY_LEN * 1.5) continue;
          if (o.off < r.off && r.off - o.off < BODY_W) { innerFree = false; break; }
        }
        if (innerFree) r.off = Math.max(0, r.off - PHYS.LANE_SHIFT * TICK * 0.9);
      }

      // --- 加速 ---
      const a = clamp((vDes - r.v) * PHYS.ACC_APPROACH, -PHYS.DEC_MAX, r.accMax);
      r.v = Math.max(0.5, r.v + a * TICK);
      if (r.v > vCap) r.v = vCap;

      // --- 余力の消費 ---
      const vEco = r.vMax * PHYS.HP_ECO_RATIO;
      let drain = PHYS.HP_BASE_DRAIN;
      if (r.v > vEco) drain += PHYS.HP_DRAIN_K * (r.v - vEco) * (r.v - vEco);
      if (k > 0) drain += PHYS.HP_CORNER_K * k * (r.v / r.vMax);
      if (grade > 0) drain += PHYS.HP_GRADE_K * grade;
      // 隊列のどこに居るか。先頭は損、後方で我慢した馬は脚が溜まる。
      drain *= lerp(PHYS.LEAD_DRAIN, PHYS.BACK_DRAIN,
        clamp01((leadS - r.s) / PHYS.DRAIN_POS_SPAN));
      r.hpLeft -= drain * TICK;
      if (r.hpLeft <= 0 && !r.busted) {
        r.busted = true;
        r.bustT = t;
      }

      // --- 前進。外を回った分は余計に走る ---
      const extra = k > 0 ? r.off * k : 0;
      const ds = r.v * TICK;
      r.s += ds / (1 + extra);
      r.p += ds;
      r.offSum += r.off; r.offN++;

      // 上がり 3F の計測開始。
      if (r.last3fStart < 0 && r.s >= dist - LAST3F) {
        r.last3fStart = t + TICK - (r.s - (dist - LAST3F)) / Math.max(1, r.v);
      }

      // --- ゴール ---
      if (r.s >= dist) {
        r.finishT = t + TICK - (r.s - dist) / Math.max(1, r.v);
        r.last3fTime = r.finishT - r.last3fStart;
        order.push(r);
        finished++;
      }
    }

    // 通過順位。先頭がチェックポイントを過ぎた瞬間の並びを記録する。
    for (const cp of checkpoints) {
      if (cp.done) continue;
      let lead = 0;
      for (const r of runners) if (r.s > lead) lead = r.s;
      if (dist - lead <= cp.rem) {
        runners.slice().sort((a, b) => b.s - a.s)
          .forEach((r, idx) => passing[runners.indexOf(r)].push(idx + 1));
        cp.done = true;
      }
    }

    // 走行ログ。0.2 秒ごと。
    if (record && frameCount < frames && Math.round(t / TICK) % 2 === 0) {
      const base = frameCount * n;
      for (let i = 0; i < n; i++) {
        logPos[base + i] = runners[i].s;
        logOff[base + i] = runners[i].off;
        logV[base + i] = runners[i].v;
      }
      frameCount++;
    }

    t += TICK;
  }

  // 走り切れなかった馬（競走中止相当）。
  for (const r of runners) {
    if (r.finishT === Infinity) {
      r.finishT = t + 10 + (dist - r.s) * 0.01;
      r.dnf = true;
      order.push(r);
    }
  }

  order.sort((a, b) => a.finishT - b.finishT);
  order.forEach((r, i) => { r.order = i + 1; });

  const winTime = order[0].finishT;
  const prize1 = spec.prize ?? 0;
  const results = order.map((r, i) => {
    const od = oddsMap.get(r.id) ?? { odds: 0, popularity: 0 };
    const idx = runners.indexOf(r);
    return {
      order: r.order,
      horseId: r.id,
      name: r.name,
      gate: r.gate,
      frame: r.frame,
      sex: r.horse.sex,
      age: horseAge(r.horse, spec.year),
      weight: r.weight,
      jockeyId: r.jockey.id,
      jockeyName: r.jockey.name,
      time: r.finishT,
      last3f: r.last3fTime,
      margin: i === 0 ? '—' : formatMargin(r.finishT - order[i - 1].finishT),
      marginTotal: r.finishT - winTime,
      passing: passing[idx].slice(),
      odds: od.odds,
      popularity: od.popularity,
      styleLabel: r.styleLabel,
      prize: Math.round(prize1 * (PRIZE_SHARE[i] ?? 0)),
      comment: raceComment(r, i, order.length),
      dnf: r.dnf,
      hpLeftRatio: clamp01(r.hpLeft / r.hp0),
      avgOff: r.offN ? r.offSum / r.offN : 0,
      blockT: r.blockT, wideT: r.wideT, pulledT: r.pulledT,
      gateDelay: r.gateDelay,
    };
  });

  return {
    raceId: spec.raceId, name: spec.name, classId: spec.classId, grade: spec.grade,
    courseId: spec.courseId, courseName: track.courseName,
    surface: spec.surface, distance: dist, ground: spec.ground, weather: spec.weather,
    year: spec.year, week: spec.week,
    track,
    results,
    winnerTime: winTime,
    pace: paceOf(logPos, runners, dist, frameCount, n, winTime),
    checkpoints: checkpoints.map((c) => c.label),
    log: record ? {
      dt: TICK * 2, frames: frameCount, n,
      ids: runners.map((r) => r.id),
      names: runners.map((r) => r.name),
      gates: runners.map((r) => r.gate),
      frameNos: runners.map((r) => r.frame),
      pos: logPos.subarray(0, frameCount * n),
      off: logOff.subarray(0, frameCount * n),
      vel: logV.subarray(0, frameCount * n),
      distance: dist, start: track.start, width: track.width,
      courseId: spec.courseId, surface: spec.surface,
      finishOrder: order.map((r) => r.id),
    } : null,
  };
}

/** 狙いの位置（先頭との差 m）。短距離は隊列が詰まる。 */
function targetGap(style, distance, field) {
  // 実際の 1000m 通過時点で、16 頭立ての隊列は 25〜45m ほどに伸びる。
  const spread = lerp(26, 48, clamp01((distance - 1200) / 1800))
    * lerp(0.78, 1.12, field / 18);
  return Math.pow(style, 1.25) * spread;
}

/**
 * 先頭が選ぶ巡航速度の比率。
 *
 * 実際の競馬の通過時計を見ると、この比率は距離が伸びてもあまり下がらない
 * （3200m の 1000m 通過 62 秒 ≒ 2400m とほぼ同じ）。
 * 長距離が楽にならないのは速度ではなく余力の側で決まっている。
 */
function cruiseRatio(r, distance, frontRunners) {
  let c = 0.985 - clamp01((distance - 1000) / 1400) * 0.105;
  c -= (1 - r.eff.stamina) * 0.012;
  c += (frontRunners - 1) * 0.019;          // ハナ争い。これが展開のほぼ全て
  c += (r.jockey.aggression - 0.5) * 0.012;
  c += r.pull * 0.014;
  return clamp(c, 0.84, 1.0);
}

/** コーナー入口の残り距離。通過順位の表示に使う。 */
function cornerCheckpoints(track, distance) {
  if (track.straightCourse) return [];
  const L = track.lap;
  const marks = [];
  let acc = 0;
  for (const seg of track.segments) {
    if (seg.kind === 'arc') {
      marks.push(acc);                 // コーナー入口
      marks.push(acc + seg.len / 2);   // 半円の中間（2 角・4 角に相当）
    }
    acc += seg.len;
  }
  const out = [];
  for (let lap = 0; lap <= Math.ceil(distance / L); lap++) {
    for (const m of marks) {
      const s = m - track.start + lap * L;
      if (s > 60 && s < distance - 110) out.push(distance - s);
    }
  }
  out.sort((a, b) => b - a);
  const picked = out.slice(-4);
  const labels = ['1角', '2角', '3角', '4角'];
  return picked.map((rem, i) => ({
    rem, done: false,
    label: labels[labels.length - picked.length + i] ?? `通過${i + 1}`,
  }));
}

/** ペース判定。先頭の前半・後半の時計差から。 */
function paceOf(logPos, runners, dist, frameCount, n, winTime) {
  if (!logPos || frameCount < 4) return { first: NaN, last: NaN, label: '—' };
  const half = dist / 2;
  const dt = TICK * 2;
  let tHalf = NaN;
  for (let f = 1; f < frameCount; f++) {
    let lead = 0, prev = 0;
    for (let i = 0; i < n; i++) {
      if (logPos[f * n + i] > lead) lead = logPos[f * n + i];
      if (logPos[(f - 1) * n + i] > prev) prev = logPos[(f - 1) * n + i];
    }
    if (lead >= half && prev < half) {
      tHalf = (f - 1) * dt + dt * (half - prev) / Math.max(0.01, lead - prev);
      break;
    }
  }
  const last = winTime - tHalf;
  let label = '平均';
  if (Number.isFinite(tHalf)) {
    const d = tHalf - last;
    if (d < -2.5) label = 'ハイペース';
    else if (d < -0.8) label = 'やや速い';
    else if (d > 2.5) label = 'スローペース';
    else if (d > 0.8) label = 'やや遅い';
  }
  return { first: tHalf, last, label };
}

/** 一言コメント。騎手の回顧のつもり。 */
function raceComment(r, idx, field) {
  const c = [];
  const left = r.hp0 > 0 ? r.hpLeft / r.hp0 : 0;
  if (r.gateDelay > 0.55) c.push('出遅れ');
  if (r.pulledT > 6) c.push('終始掛かり気味');
  if (r.blockT > 4) c.push('前が壁');
  if (r.wideT > 12) c.push('終始外々');
  if (r.busted) c.push(idx < field * 0.3 ? '最後は一杯' : 'ばてて後退');
  else if (idx === 0) c.push(left > 0.25 ? '余力十分' : '辛勝');
  else if (idx < 4) c.push('よく伸びた');
  if (r.dnf) c.push('競走中止');
  if (c.length === 0) c.push(idx < field / 2 ? '力は出した' : '見せ場なし');
  return c.join('・');
}

/** 予想オッズだけを出す（出馬表の表示用）。 */
export function previewOdds(spec, rng) {
  const runners = spec.entries.map((e) => prepareRunner(e, spec, rng));
  return computeOdds(runners, spec, rng);
}

/** 走行ログのある時刻での全馬の状態（3D 再生用）。 */
export function sampleLog(log, time) {
  const f = time / log.dt;
  const i0 = clamp(Math.floor(f), 0, log.frames - 1);
  const i1 = Math.min(log.frames - 1, i0 + 1);
  const a = f - i0;
  const out = [];
  for (let k = 0; k < log.n; k++) {
    out.push({
      id: log.ids[k],
      name: log.names[k],
      gate: log.gates[k],
      s: lerp(log.pos[i0 * log.n + k], log.pos[i1 * log.n + k], a),
      off: lerp(log.off[i0 * log.n + k], log.off[i1 * log.n + k], a),
      v: lerp(log.vel[i0 * log.n + k], log.vel[i1 * log.n + k], a),
    });
  }
  return out;
}

/** ログの総再生時間（秒）。 */
export const logDuration = (log) => (log.frames - 1) * log.dt;

export { SURFACE, posToWorld };
