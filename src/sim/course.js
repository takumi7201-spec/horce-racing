// 競馬場のコース。
//
// レースシミュレーションと 3D 描画で「同じ形」を使うための層。
// 1 周をオーバル（直線＋半円のコーナー）で近似し、ゴール板を周回位置 0 とする。
// 距離 D のレースは start = (L - D % L) % L から始めて、走破距離が D になった
// ところでちょうどゴール板に戻る。この定義にしておくと、東京 2400m が
// 「正面スタンド前スタート」になるなど、実際の発走位置が自動的に出る。
//
// 1 周距離・直線距離・高低差は JRA 各場の公表値の近似。内回り／外回りの別は
// まだ持っていない（外回り相当の数値を使っている）。

import { clamp, lerp } from '../core/util.js';

/** 馬場（芝・ダート）。 */
export const SURFACE = { TURF: '芝', DIRT: 'ダート' };

/** 回り（1 = 右回り、-1 = 左回り）。コーナーで内に張る向きが変わる。 */
export const DIR = { RIGHT: 1, LEFT: -1 };

/**
 * 各場のコース定義。
 * lap      1 周距離（m）
 * straight 4 コーナー出口からゴール板までの直線（m）
 * toFirst  ゴール板から 1 コーナー入口まで（m）
 * back     向正面の直線（m）
 * rise     高低差（m）
 * slopes   直線の起伏。rem（そのラップでの残り距離 m）の区間と勾配（‰ 相当の係数）。
 *          正の grade は上り。坂の有無が差し・追込の成否を分けるので必ず持たせる。
 */
const COURSES = [
  {
    id: 'tokyo', name: '東京', dir: DIR.LEFT, region: '関東',
    turf: {
      lap: 2083, straight: 526, toFirst: 160, back: 520, rise: 2.7, width: 31,
      slopes: [{ from: 460, to: 250, grade: 9 }, { from: 250, to: 0, grade: -1 }],
      distances: [1400, 1600, 1800, 2000, 2300, 2400, 2500, 3400],
    },
    dirt: {
      lap: 1899, straight: 502, toFirst: 150, back: 470, rise: 2.5, width: 25,
      slopes: [{ from: 450, to: 250, grade: 8 }, { from: 250, to: 0, grade: -1 }],
      distances: [1300, 1400, 1600, 2100, 2400],
    },
  },
  {
    id: 'nakayama', name: '中山', dir: DIR.RIGHT, region: '関東',
    turf: {
      lap: 1840, straight: 310, toFirst: 130, back: 430, rise: 5.3, width: 24,
      // 残り 180m からの急坂。中山の芝は「坂で止まる」のが性格。
      slopes: [{ from: 310, to: 180, grade: -6 }, { from: 180, to: 70, grade: 22 }, { from: 70, to: 0, grade: 2 }],
      distances: [1200, 1600, 1800, 2000, 2200, 2500, 3600],
    },
    dirt: {
      lap: 1493, straight: 308, toFirst: 120, back: 350, rise: 4.4, width: 20,
      slopes: [{ from: 308, to: 180, grade: -5 }, { from: 180, to: 70, grade: 20 }, { from: 70, to: 0, grade: 2 }],
      distances: [1200, 1800, 2400, 2500],
    },
  },
  {
    id: 'hanshin', name: '阪神', dir: DIR.RIGHT, region: '関西',
    turf: {
      lap: 2089, straight: 474, toFirst: 150, back: 500, rise: 2.4, width: 28,
      slopes: [{ from: 400, to: 210, grade: 11 }, { from: 210, to: 0, grade: -1 }],
      distances: [1200, 1400, 1600, 1800, 2000, 2200, 2400, 3000],
    },
    dirt: {
      lap: 1518, straight: 353, toFirst: 130, back: 380, rise: 1.6, width: 22,
      slopes: [{ from: 320, to: 180, grade: 9 }, { from: 180, to: 0, grade: 0 }],
      distances: [1200, 1400, 1800, 2000],
    },
  },
  {
    id: 'kyoto', name: '京都', dir: DIR.RIGHT, region: '関西',
    turf: {
      lap: 1894, straight: 404, toFirst: 140, back: 440, rise: 4.3, width: 28,
      // 直線は平坦。坂は 3 コーナーの「淀の坂」なので slopes には入れず、
      // コーナー勾配として cornerGrade に持つ。
      slopes: [{ from: 404, to: 0, grade: 0 }],
      cornerGrade: { atRem: 900, up: 18, down: -16, span: 400 },
      distances: [1200, 1400, 1600, 1800, 2000, 2200, 2400, 3000, 3200],
    },
    dirt: {
      lap: 1608, straight: 329, toFirst: 130, back: 400, rise: 3.0, width: 22,
      slopes: [{ from: 329, to: 0, grade: 0 }],
      cornerGrade: { atRem: 800, up: 15, down: -14, span: 350 },
      distances: [1200, 1400, 1800, 1900],
    },
  },
  {
    id: 'chukyo', name: '中京', dir: DIR.LEFT, region: '関西',
    turf: {
      lap: 1706, straight: 413, toFirst: 130, back: 410, rise: 3.5, width: 25,
      slopes: [{ from: 400, to: 200, grade: 14 }, { from: 200, to: 0, grade: 0 }],
      distances: [1200, 1400, 1600, 2000, 2200, 3000],
    },
    dirt: {
      lap: 1530, straight: 411, toFirst: 120, back: 380, rise: 3.4, width: 21,
      slopes: [{ from: 390, to: 200, grade: 13 }, { from: 200, to: 0, grade: 0 }],
      distances: [1200, 1400, 1800, 1900],
    },
  },
  {
    id: 'niigata', name: '新潟', dir: DIR.LEFT, region: '関東',
    turf: {
      lap: 2223, straight: 659, toFirst: 170, back: 540, rise: 0.8, width: 25,
      slopes: [{ from: 659, to: 0, grade: 0 }], // 完全な平坦。上がりが異常に速くなる
      distances: [1200, 1400, 1600, 1800, 2000, 2200, 2400],
      straightOnly: 1000, // 直線 1000m（日本唯一）。別トラックとして扱う
    },
    dirt: {
      lap: 1472, straight: 354, toFirst: 120, back: 360, rise: 0.6, width: 20,
      slopes: [{ from: 354, to: 0, grade: 0 }],
      distances: [1200, 1800, 2500],
    },
  },
  {
    id: 'sapporo', name: '札幌', dir: DIR.RIGHT, region: '北海道',
    turf: {
      lap: 1641, straight: 266, toFirst: 120, back: 400, rise: 0.7, width: 25,
      slopes: [{ from: 266, to: 0, grade: 0 }],
      distances: [1200, 1500, 1800, 2000, 2600],
    },
    dirt: {
      lap: 1487, straight: 264, toFirst: 110, back: 360, rise: 0.9, width: 20,
      slopes: [{ from: 264, to: 0, grade: 0 }],
      distances: [1000, 1700, 2400],
    },
  },
  {
    id: 'hakodate', name: '函館', dir: DIR.RIGHT, region: '北海道',
    turf: {
      lap: 1627, straight: 262, toFirst: 120, back: 390, rise: 3.5, width: 25,
      slopes: [{ from: 262, to: 150, grade: 10 }, { from: 150, to: 0, grade: -4 }],
      distances: [1000, 1200, 1800, 2000, 2600],
    },
    dirt: {
      lap: 1476, straight: 260, toFirst: 110, back: 350, rise: 3.5, width: 20,
      slopes: [{ from: 260, to: 150, grade: 9 }, { from: 150, to: 0, grade: -4 }],
      distances: [1000, 1700, 2400],
    },
  },
  {
    id: 'fukushima', name: '福島', dir: DIR.RIGHT, region: '関東',
    turf: {
      lap: 1600, straight: 292, toFirst: 120, back: 380, rise: 1.9, width: 25,
      slopes: [{ from: 292, to: 170, grade: 7 }, { from: 170, to: 0, grade: -2 }],
      distances: [1000, 1200, 1700, 1800, 2000, 2600],
    },
    dirt: {
      lap: 1445, straight: 296, toFirst: 110, back: 350, rise: 2.1, width: 20,
      slopes: [{ from: 290, to: 170, grade: 7 }, { from: 170, to: 0, grade: -2 }],
      distances: [1000, 1150, 1700, 2400],
    },
  },
  {
    id: 'kokura', name: '小倉', dir: DIR.RIGHT, region: '関西',
    turf: {
      lap: 1615, straight: 293, toFirst: 120, back: 390, rise: 3.0, width: 25,
      // 4 コーナーから下り。小倉は前に行った馬が止まらない。
      slopes: [{ from: 500, to: 293, grade: -12 }, { from: 293, to: 0, grade: 1 }],
      distances: [1200, 1700, 1800, 2000, 2600],
    },
    dirt: {
      lap: 1445, straight: 291, toFirst: 110, back: 350, rise: 2.9, width: 20,
      slopes: [{ from: 480, to: 291, grade: -11 }, { from: 291, to: 0, grade: 1 }],
      distances: [1000, 1700, 2400],
    },
  },
];

const BY_ID = new Map(COURSES.map((c) => [c.id, c]));

export function allCourses() {
  return COURSES;
}
export function getCourse(id) {
  const c = BY_ID.get(id);
  if (!c) throw new Error(`未知の競馬場: ${id}`);
  return c;
}
export function courseName(id) {
  return BY_ID.get(id)?.name ?? id;
}

/**
 * コース＋馬場＋距離 → 走路の幾何。
 * 直線 1000m のような周回しないコースは straight:true を返す。
 */
export function buildTrack(courseId, surface, distance) {
  const course = getCourse(courseId);
  const spec = surface === SURFACE.DIRT ? course.dirt : course.turf;

  // 新潟芝 1000m は直線だけ。オーバルに乗せると幾何が壊れるので別扱い。
  if (surface === SURFACE.TURF && spec.straightOnly && distance === spec.straightOnly) {
    return {
      courseId, courseName: course.name, surface, distance,
      straightCourse: true, lap: distance, start: 0, laps: 0,
      homeStraight: distance, width: spec.width, dir: course.dir,
      segments: [{ kind: 'straight', len: distance, x0: 0, z0: 0, dx: 1, dz: 0 }],
      slopes: [{ from: 1000, to: 0, grade: 0 }],
      rise: 0.3,
    };
  }

  const { lap, straight, toFirst, back, width } = spec;
  // 両端の半円の弧長。直線 3 本（ゴール後・向正面・ゴール前）の残りを二等分する。
  const arc = (lap - straight - toFirst - back) / 2;
  if (arc <= 40) throw new Error(`${course.name}${surface}: コーナーが短すぎる（定義値を確認）`);
  const r = arc / Math.PI;

  // ゴール板を原点、ホームストレッチを +x 方向に取る。
  // 右回りならコーナーで -z 側へ、左回りなら +z 側へ曲がる。
  const s = course.dir === DIR.RIGHT ? -1 : 1;
  const segments = [];
  let x = 0, z = 0, head = 0; // head: 進行方向の角度（rad, +x = 0）

  const pushStraight = (len) => {
    segments.push({ kind: 'straight', len, x0: x, z0: z, dx: Math.cos(head), dz: Math.sin(head) });
    x += Math.cos(head) * len;
    z += Math.sin(head) * len;
  };
  const pushArc = (len) => {
    // 中心は進行方向の左右 r の位置。曲がる側は s。
    const cx = x + Math.cos(head + (s * Math.PI) / 2) * r;
    const cz = z + Math.sin(head + (s * Math.PI) / 2) * r;
    const a0 = Math.atan2(z - cz, x - cx);
    const sweep = (len / r) * s;
    segments.push({ kind: 'arc', len, cx, cz, r, a0, sweep, sign: s });
    const a1 = a0 + sweep;
    x = cx + Math.cos(a1) * r;
    z = cz + Math.sin(a1) * r;
    head += sweep;
  };

  pushStraight(toFirst);   // ゴール板 → 1 コーナー
  pushArc(arc);            // 1・2 コーナー
  pushStraight(back);      // 向正面
  pushArc(arc);            // 3・4 コーナー
  pushStraight(straight);  // 直線 → ゴール板

  const start = ((lap - (distance % lap)) % lap + lap) % lap;
  return {
    courseId, courseName: course.name, surface, distance,
    straightCourse: false,
    lap, start, laps: Math.floor(distance / lap),
    homeStraight: straight, toFirst, back, arc, radius: r,
    width, dir: course.dir, segments,
    slopes: spec.slopes, cornerGrade: spec.cornerGrade, rise: spec.rise,
  };
}

/**
 * 周回位置 p（m）→ 走路上の座標・進行方向・曲率。
 * off は内ラチからの横方向オフセット（m）。割合ではなく実距離で持つ。
 * コーナーで外を回る損がそのまま半径差になるので、割合だと直感とずれる。
 */
export function posToWorld(track, p, off = 0) {
  const L = track.lap;
  let t = track.straightCourse ? clamp(p, 0, L) : ((p % L) + L) % L;
  for (const seg of track.segments) {
    if (t > seg.len) {
      t -= seg.len;
      continue;
    }
    if (seg.kind === 'straight') {
      // 法線は進行方向を 90 度回した向き。曲がる側の外が +off。
      const nx = -seg.dz, nz = seg.dx;
      const s = track.dir === DIR.RIGHT ? -1 : 1;
      return {
        x: seg.x0 + seg.dx * t - nx * off * s,
        z: seg.z0 + seg.dz * t - nz * off * s,
        heading: Math.atan2(seg.dz, seg.dx),
        curvature: 0,
      };
    }
    const a = seg.a0 + (t / seg.len) * seg.sweep;
    const rr = seg.r + off; // 外を回れば半径が大きい＝距離を損する
    return {
      x: seg.cx + Math.cos(a) * rr,
      z: seg.cz + Math.sin(a) * rr,
      heading: a + (seg.sign > 0 ? Math.PI / 2 : -Math.PI / 2),
      curvature: 1 / rr,
    };
  }
  // 丸め誤差で最終セグメントを溢れた場合はゴール板に落とす。
  return { x: 0, z: 0, heading: 0, curvature: 0 };
}

/** 周回位置 p での曲率（1/m）。コーナーでの減速と外を回る損に使う。 */
export function curvatureAt(track, p) {
  if (track.straightCourse) return 0;
  const L = track.lap;
  let t = ((p % L) + L) % L;
  for (const seg of track.segments) {
    if (t > seg.len) {
      t -= seg.len;
      continue;
    }
    return seg.kind === 'arc' ? 1 / seg.r : 0;
  }
  return 0;
}

/**
 * 外を回ることによる余分な距離（進行 1m あたり）。
 * コーナーでしか発生しない。内ラチから off メートル外を回れば半径が off 増え、
 * 同じ角度を回るのに off × 曲率 だけ余計に走る。
 */
export function laneCostAt(track, p, off) {
  const k = curvatureAt(track, p);
  return k > 0 ? off * k : 0;
}

/** 残り距離 rem（m）での勾配。上りが正。 */
export function gradeAt(track, rem, posInLap) {
  let g = 0;
  for (const s of track.slopes) {
    if (rem <= s.from && rem > s.to) {
      g = s.grade;
      break;
    }
  }
  // 京都の 3 コーナーのように、直線ではない場所に坂がある場合。
  const cg = track.cornerGrade;
  if (cg && rem > 0) {
    const d = rem - cg.atRem;
    if (Math.abs(d) < cg.span / 2) {
      g += d > 0 ? cg.up * (1 - (d / (cg.span / 2))) : cg.down * (1 + d / (cg.span / 2));
    }
  }
  return g;
}

/** この距離は直線だけで決まるか（ホームストレッチ内に収まるか）。 */
export function isSprintStraight(track) {
  return track.straightCourse || track.distance <= track.homeStraight;
}

/** コースごとの有効な距離一覧。番組表の整合性チェックに使う。 */
export function distancesOf(courseId, surface) {
  const c = getCourse(courseId);
  const spec = surface === SURFACE.DIRT ? c.dirt : c.turf;
  const list = spec.distances.slice();
  if (spec.straightOnly) list.unshift(spec.straightOnly);
  return list;
}

/** 走路の外周の広がり（3D のカメラ初期位置とスタンド配置用）。 */
export function trackBounds(track) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const step = 10;
  for (let p = 0; p < track.lap; p += step) {
    const w = posToWorld(track, p, 1);
    minX = Math.min(minX, w.x); maxX = Math.max(maxX, w.x);
    minZ = Math.min(minZ, w.z); maxZ = Math.max(maxZ, w.z);
  }
  return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
}

/**
 * 標高（m）。ゴール板を 0 とし、勾配表を 1 周ぶん積分して持つ。
 * 3D では頂点ごとに引くので、毎回積分しないようトラックに表を貼る。
 */
const ELEV_STEP = 5;
export function elevationAt(track, p) {
  if (!track._elev) {
    const n = Math.ceil(track.lap / ELEV_STEP) + 1;
    const tbl = new Float32Array(n);
    let h = 0;
    for (let i = 1; i < n; i++) {
      // i は「ゴールまでの残り距離 / ELEV_STEP」。上り勾配なら手前が低い。
      h -= (gradeAt(track, (i - 0.5) * ELEV_STEP, 0) / 1000) * ELEV_STEP;
      tbl[i] = h;
    }
    track._elev = tbl;
  }
  const L = track.lap;
  const rem = track.straightCourse
    ? Math.max(0, L - clamp(p, 0, L))
    : (L - (((p % L) + L) % L)) % L;
  const f = rem / ELEV_STEP;
  const i = Math.min(track._elev.length - 2, Math.floor(f));
  return lerp(track._elev[i], track._elev[i + 1], f - i);
}

export { COURSES };
