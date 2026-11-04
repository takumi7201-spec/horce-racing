extends RefCounted
## レースの計算（src/sim/race.js の simulateRace と、使っている course.js・horse.js の部分を移したもの）。
##
## 0.1 秒刻みで全馬の速度・位置・横位置・余力（HP）を進め、0.2 秒ごとの位置を走行ログに残す。
## 3D（racecourse.gd）はそのログを再生するだけで、結果を作り直さない。
## 式・乱数を引く順番・比べ方は JS と同じにしてある（変えるとゲームと勝ち馬が変わる）。違いが出るのは log・cos・pow の
## 最後の桁だけ（V8 は fdlibm、Godot は C の数学関数）。tools/verify-godot-ikusei.mjs が着順の一致を見ている。
##
## 速さのため、馬ごとの状態は辞書ではなく並べた配列（PackedFloat64Array）で持つ。16 頭 × 2500 コマ × 16 頭の判定を回す。

const BODY_W := 2.2
const BODY_LEN := 2.4


static func lerpf_(a: float, b: float, t: float) -> float:
	return a + (b - a) * t


static func clamp01_(v: float) -> float:
	return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


static func clampf_(v: float, lo: float, hi: float) -> float:
	return lo if v < lo else (hi if v > hi else v)


## JS の Math.round（.5 は +∞ 側へ）。
static func jround(x: float) -> float:
	return floor(x + 0.5)


## 比べる関数で安定に並べる（JS の sort は安定。Godot の sort_custom は安定でない）。
static func stable_sort(arr: Array, less: Callable) -> Array:
	var out := arr.duplicate()
	for i in range(1, out.size()):
		var x = out[i]
		var j := i - 1
		while j >= 0 and less.call(x, out[j]):
			out[j + 1] = out[j]
			j -= 1
		out[j + 1] = x
	return out


# ------------------------------------------------------------------ コース（course.js の buildTrack・curvatureAt・gradeAt）

static func build_track(course: Dictionary, surface: String, distance: int) -> Dictionary:
	var spec: Dictionary = course.dirt if surface == "ダート" else course.turf
	if surface == "芝" and spec.get("straightOnly") != null and distance == int(spec.straightOnly):
		return {
			courseId = course.id, courseName = course.name, surface = surface, distance = distance,
			straightCourse = true, lap = float(distance), start = 0.0, width = float(spec.width), dir = course.dir,
			segments = [{kind = "straight", len = float(distance)}], slopes = [{from = 1000.0, to = 0.0, grade = 0.0}],
			cornerGrade = null, vAdj = float(spec.get("vAdj", 0.0)),
		}
	var lap := float(spec.lap)
	var straight := float(spec.straight)
	var front := (float(spec.toFirst) + straight + float(spec.back)) / 2.0
	var to_first := maxf(20.0, front - straight)
	var back := to_first + straight
	var arc := (lap - front - back) / 2.0
	var r := arc / PI
	var segs := [
		{kind = "straight", len = to_first}, {kind = "arc", len = arc, r = r},
		{kind = "straight", len = back}, {kind = "arc", len = arc, r = r}, {kind = "straight", len = straight},
	]
	var start := fmod(fmod(lap - fmod(float(distance), lap), lap) + lap, lap)
	return {
		courseId = course.id, courseName = course.name, surface = surface, distance = distance,
		straightCourse = false, lap = lap, start = start, width = float(spec.width), dir = course.dir,
		segments = segs, slopes = spec.slopes, cornerGrade = spec.get("cornerGrade"), vAdj = float(spec.get("vAdj", 0.0)),
		homeStraight = straight,
	}


static func curvature_at(track: Dictionary, p: float) -> float:
	if track.straightCourse:
		return 0.0
	var L: float = track.lap
	var t := fmod(fmod(p, L) + L, L)
	for seg in track.segments:
		if t > seg.len:
			t -= seg.len
			continue
		return 1.0 / seg.r if seg.kind == "arc" else 0.0
	return 0.0


static func grade_at(track: Dictionary, rem: float) -> float:
	var g := 0.0
	for s in track.slopes:
		if rem <= float(s.from) and rem > float(s.to):
			g = float(s.grade)
			break
	var cg = track.cornerGrade
	if cg != null and rem > 0:
		var d := rem - float(cg.atRem)
		var half := float(cg.span) / 2.0
		if absf(d) < half:
			g += float(cg.up) * (1.0 - (d / half)) if d > 0 else float(cg.down) * (1.0 + d / half)
	return g


# ------------------------------------------------------------------ 馬（horse.js の effectiveAbility・適性）

static func effective_ability(h: Dictionary, growth: float) -> Dictionary:
	var fit := lerpf_(0.72, 1.06, clamp01_(h.fit))
	var cond := lerpf_(0.88, 1.07, clamp01_(h.cond))
	var tired := 1.0 - clamp01_(h.fatigue) * 0.18
	var k := growth * fit * cond * tired
	var out := {}
	for a in ["speed", "stamina", "power", "guts", "wit"]:
		out[a] = clamp01_(float(h.cur[a]) * k)
	return out


static func distance_aptitude(h: Dictionary, distance: float) -> float:
	var d := absf(distance - float(h.dist))
	var r := maxf(200.0, float(h.distRange))
	return clamp01_(1.0 - 0.34 * pow(d / r, 1.5))


static func style_label(s: float) -> String:
	if s < 0.22:
		return "逃げ"
	if s < 0.5:
		return "先行"
	if s < 0.78:
		return "差し"
	return "追込"


static func format_margin(sec: float) -> String:
	if sec <= 0.0001:
		return "同着"
	var baba := sec / 0.2
	if baba < 0.06:
		return "ハナ"
	if baba < 0.18:
		return "アタマ"
	if baba < 0.3:
		return "クビ"
	if baba < 0.55:
		return "1/2"
	if baba < 0.8:
		return "3/4"
	if baba >= 10:
		return "大差"
	var whole := int(floor(baba))
	var frac := baba - whole
	var f := ""
	if frac >= 0.8:
		return str(whole + 1)
	if frac >= 0.55:
		f = ".3/4"
	elif frac >= 0.3:
		f = ".1/2"
	elif frac >= 0.12:
		f = ".1/4"
	return "%d%s" % [whole, f]


static func format_time(sec: float) -> String:
	var m := int(floor(sec / 60.0))
	var s := sec - m * 60
	var t := ("%.1f" % s).lpad(4, "0")
	return "%d:%s" % [m, t] if m > 0 else t


# ------------------------------------------------------------------ レース本体

## spec：{courseId, surface, distance, ground, year, entries:[{horse, weight, gate, frame}], course（コースの表）}
## P：data.json の params。返り値は race.js と同じ形の results と、再生用の log。
static func simulate(spec: Dictionary, rng, P: Dictionary, course: Dictionary, record := true) -> Dictionary:
	var PH: Dictionary = P.PHYS
	var TICK: float = P.TICK
	var track := build_track(course, spec.surface, int(spec.distance))
	var entries: Array = spec.entries
	var n := entries.size()
	var dist := float(spec.distance)
	var gi := maxi(0, (P.GROUNDS as Array).find(spec.ground))
	var ge: Dictionary = (P.GROUND_EFFECT.get(spec.surface, P.GROUND_EFFECT["芝"]) as Array)[gi]

	# 馬ごとの素（prepareRunner）。乱数は 1 頭ずつ「仕掛けどころ → 出遅れ」の順に引く
	var R := []
	for e in entries:
		var h: Dictionary = e.horse
		var g: float = P.GROWTH[clampi(int(spec.year) - int(h.birthYear), 0, 8)]
		var eff := effective_ability(h, g)
		var d_apt := distance_aptitude(h, dist)
		var s_apt: float = h.dirt if spec.surface == "ダート" else h.turf
		var g_apt := lerpf_(h.firm, h.soft, clamp01_(gi / 3.0))
		var apt := lerpf_(0.94, 1.0, d_apt) * (0.95 + 0.05 * minf(1.0, s_apt / 0.85)) * (0.97 + 0.03 * minf(1.0, g_apt / 0.85))
		var jk_skill := 0.55
		var jk_speed := 1.0 + (jk_skill - 0.5) * 0.030
		var w_pen := 1.0 - (float(e.weight) - float(PH.WEIGHT_BASE)) * float(PH.WEIGHT_K) / 100.0
		var vmax: float = (float(PH.V_BASE) + float(PH.V_SPEED_GAIN) * eff.speed) * apt * float(ge.speed) * jk_speed * w_pen
		if spec.surface == "ダート":
			vmax -= float(PH.V_DIRT_PENALTY)
		vmax += track.vAdj
		var hp: float = (float(PH.HP_BASE) + float(PH.HP_STAM_GAIN) * eff.stamina) * lerpf_(0.48, 1.08, d_apt) \
			* lerpf_(0.62, 1.04, minf(1.0, s_apt / 0.85)) * lerpf_(0.80, 1.02, minf(1.0, g_apt / 0.85)) / float(ge.stam)
		var want: float = h.style
		var wisdom: float = eff.wit * 0.6 + jk_skill * 0.4
		var spurt := clampf_(lerpf_(430.0, 700.0, want) + rng.normal(0, lerpf_(100.0, 25.0, wisdom)), 240.0, minf(1000.0, dist - 180.0))
		# 馬具（src/sim/gear.js の gearEffect と同じ式・同じ足し算の順）。馬具の無い馬は何も変わらない
		var gx := gear_effect(h.get("raceGear", {}), float(h.get("gearTemper", h.temper)))
		var gate_delay := maxf(0.0, float(PH.GATE_BASE) + rng.normal(0, 0.17) * (1.6 - (float(h.temper) + gx.start)) - (jk_skill - 0.5) * 0.12)
		R.append({
			id = h.id, horse = h, name = h.name, gate = e.gate, frame = e.frame, weight = e.weight, eff = eff,
			vMax = vmax, hp0 = hp, want = want, spurt = spurt, gateDelay = gate_delay,
			pull = clamp01_((0.52 - (float(h.temper) + gx.pull)) * 2.4 - jk_skill * 0.4), guts = eff.guts, spirit = float(h.spirit), focus = gx.focus,
			accMax = float(PH.ACC_MAX_BASE) + float(PH.ACC_MAX_GAIN) * eff.power, jkSkill = jk_skill, jkAgg = 0.5,
			styleLabel = style_label(want),
		})

	# オッズ（computeOdds）。見せるだけだが乱数を 1 頭 1 回引くので、JS と同じ順で引く
	var est := []
	for r in R:
		var e2: Dictionary = r.eff
		var visible: float = (e2.speed + e2.stamina + e2.power) / 3.0
		var base: float = visible * 0.52 + 0.0 * 0.26 + 0.12 * 0.12 + r.jkSkill * 0.10
		est.append(maxf(0.02, base * (1.0 + rng.normal(0, 0.18))))
	var pw := []
	var tot := 0.0
	for x in est:
		pw.append(pow(x, 7))
	for x in pw:
		tot += x
	var odds := []
	for i in n:
		odds.append(maxf(1.1, jround((0.80 / (pw[i] / tot)) * 10.0) / 10.0))
	var pop_order := stable_sort(range(n), func(a, b): return odds[a] < odds[b])
	var popularity := []
	popularity.resize(n)
	for i in n:
		popularity[pop_order[i]] = i + 1

	var max_off := maxf(4.0, track.width - 3.0)
	var S := PackedFloat64Array(); S.resize(n)
	var Pp := PackedFloat64Array(); Pp.resize(n)
	var OFF := PackedFloat64Array(); OFF.resize(n)
	var V := PackedFloat64Array(); V.resize(n)
	var FIN := PackedFloat64Array(); FIN.resize(n)
	var HP := PackedFloat64Array(); HP.resize(n)
	var BUST := PackedFloat64Array(); BUST.resize(n)     # 枯れた時刻（-1 はまだ）
	var L3 := PackedFloat64Array(); L3.resize(n)
	var BLOCK := PackedFloat64Array(); BLOCK.resize(n)
	var WIDE := PackedFloat64Array(); WIDE.resize(n)
	var PULLED := PackedFloat64Array(); PULLED.resize(n)
	var OFFSUM := PackedFloat64Array(); OFFSUM.resize(n)
	var OFFN := PackedInt32Array(); OFFN.resize(n)
	for i in n:
		OFF[i] = minf(max_off, (float(R[i].gate) - 1.0) * 0.42)
		Pp[i] = track.start
		FIN[i] = INF
		HP[i] = R[i].hp0
		BUST[i] = -1.0
		L3[i] = -1.0

	var front_runners := 0
	for r in R:
		if r.want < 0.26:
			front_runners += 1

	var max_ticks := int(ceil((dist / 8.0) / TICK)) + 600
	var frames := int(ceil(max_ticks / 2.0)) + 2 if record else 0
	var log_pos := PackedFloat32Array()
	var log_off := PackedFloat32Array()
	var log_v := PackedFloat32Array()
	if record:
		log_pos.resize(frames * n)
		log_off.resize(frames * n)
		log_v.resize(frames * n)
	var frame_count := 0

	var checkpoints := _corner_checkpoints(track, dist)
	var passing := []
	for i in n:
		passing.append([])
	var LAST3F := 600.0
	var lap: float = track.lap

	var shift: float = float(PH.LANE_SHIFT) * TICK
	var block_gap: float = float(PH.BLOCK_GAP)
	var t := 0.0
	var finished := 0
	var order := []   # 着いた順の馬の番号

	while finished < n and t < max_ticks * TICK:
		var lead_s := -1.0
		var lead_v := 0.0
		for i in n:
			if S[i] > lead_s:
				lead_s = S[i]
				lead_v = V[i]

		for i in n:
			if FIN[i] < INF:
				continue
			var r: Dictionary = R[i]
			if t < r.gateDelay:
				continue
			var rem := dist - S[i]
			var pos_in_lap := fmod(fmod(Pp[i], lap) + lap, lap)
			var k := curvature_at(track, Pp[i])
			var grade := grade_at(track, fmod(lap - pos_in_lap, lap))

			var hp_ratio := clamp01_(HP[i] / r.hp0)
			var fade := 1.0 - float(PH.FADE_K) * pow(1.0 - hp_ratio, float(PH.FADE_POW))
			if BUST[i] >= 0.0:
				fade -= float(PH.BUST_RATE) * (t - BUST[i])
			fade = maxf(float(PH.BUST_FLOOR), fade)
			var vcap: float = r.vMax * fade * (1.0 - k * float(PH.CORNER_SLOW)) * (1.0 - grade * float(PH.GRADE_SLOW))
			if rem < 400:
				vcap *= 1.0 + float(PH.GUTS_GAIN) * (r.guts * 0.7 + r.spirit * 0.3) * (1.0 - rem / 400.0)
				if r.focus != 0.0:
					vcap *= 1.0 + r.focus * (1.0 - rem / 400.0)

			var vdes: float
			if rem <= r.spurt:
				vdes = vcap
			elif S[i] < 180:
				vdes = vcap * lerpf_(1.0, 0.87, r.want)
			else:
				var want_gap := _target_gap(r.want, dist, n)
				var gap := lead_s - S[i]
				var cruise := _cruise_ratio(r, dist, front_runners)
				if lead_s <= S[i]:
					vdes = vcap * cruise
				else:
					vdes = clampf_(lead_v + (gap - want_gap) * 0.55, vcap * 0.70, vcap * cruise)
				if r.pull > 0.25 and rem > dist * 0.45:
					vdes = minf(vcap, vdes * (1.0 + r.pull * 0.05))
					PULLED[i] += TICK * r.pull

			# 進路
			var in_break := S[i] < 80
			var blocker := -1
			var min_gap := INF
			if not in_break:
				for j in n:
					if j == i or FIN[j] < INF:
						continue
					var d := S[j] - S[i]
					if d < BODY_LEN * 0.8 or d > block_gap + BODY_LEN:
						continue
					if absf(OFF[j] - OFF[i]) > BODY_W * 0.8:
						continue
					if d < min_gap:
						min_gap = d
						blocker = j
			if blocker >= 0 and vdes > V[blocker]:
				var skill: float = 0.6 + r.eff.wit * 0.5 + r.jkSkill * 0.5
				if not _occupied(i, OFF[i] + BODY_W, n, S, OFF, FIN) and OFF[i] + BODY_W <= max_off:
					OFF[i] = minf(max_off, OFF[i] + shift * skill)
					if k > 0:
						WIDE[i] += TICK
				elif OFF[i] > BODY_W * 0.6 and not _occupied(i, OFF[i] - BODY_W, n, S, OFF, FIN):
					OFF[i] = maxf(0.0, OFF[i] - shift * skill)
				vdes = minf(vdes, V[blocker])
				BLOCK[i] += TICK
			elif OFF[i] > 0 and not _occupied(i, maxf(0.0, OFF[i] - BODY_W), n, S, OFF, FIN):
				OFF[i] = maxf(0.0, OFF[i] - shift * 0.9)

			# 加速
			var acc := clampf_((vdes - V[i]) * float(PH.ACC_APPROACH), -float(PH.DEC_MAX), r.accMax)
			V[i] = maxf(0.5, V[i] + acc * TICK)
			if V[i] > vcap:
				V[i] = vcap

			# 余力の消費
			var veco: float = r.vMax * float(PH.HP_ECO_RATIO)
			var drain: float = float(PH.HP_BASE_DRAIN)
			if V[i] > veco:
				drain += float(PH.HP_DRAIN_K) * (V[i] - veco) * (V[i] - veco)
			if k > 0:
				drain += float(PH.HP_CORNER_K) * k * (V[i] / r.vMax)
			if grade > 0:
				drain += float(PH.HP_GRADE_K) * grade
			drain *= lerpf_(float(PH.LEAD_DRAIN), float(PH.BACK_DRAIN), clamp01_((lead_s - S[i]) / float(PH.DRAIN_POS_SPAN)))
			HP[i] -= drain * TICK
			if HP[i] <= 0 and BUST[i] < 0.0:
				BUST[i] = t

			# 前進。外を回った分は余計に走る
			var extra := OFF[i] * k if k > 0 else 0.0
			var ds := V[i] * TICK
			S[i] += ds / (1.0 + extra)
			Pp[i] += ds
			OFFSUM[i] += OFF[i]
			OFFN[i] += 1

			if L3[i] < 0 and S[i] >= dist - LAST3F:
				L3[i] = t + TICK - (S[i] - (dist - LAST3F)) / maxf(1.0, V[i])
			if S[i] >= dist:
				FIN[i] = t + TICK - (S[i] - dist) / maxf(1.0, V[i])
				order.append(i)
				finished += 1

		# 通過順位
		for cp in checkpoints:
			if cp.done:
				continue
			var lead := 0.0
			for i in n:
				if S[i] > lead:
					lead = S[i]
			if dist - lead <= cp.rem:
				var srt := stable_sort(range(n), func(a, b): return S[a] > S[b])
				for idx in n:
					passing[srt[idx]].append(idx + 1)
				cp.done = true

		if record and frame_count < frames and int(jround(t / TICK)) % 2 == 0:
			var base := frame_count * n
			for i in n:
				log_pos[base + i] = S[i]
				log_off[base + i] = OFF[i]
				log_v[base + i] = V[i]
			frame_count += 1

		t += TICK

	var dnf := []
	dnf.resize(n)
	dnf.fill(false)
	for i in n:
		if FIN[i] == INF:
			FIN[i] = t + 10.0 + (dist - S[i]) * 0.01
			dnf[i] = true
			order.append(i)
	order = stable_sort(order, func(a, b): return FIN[a] < FIN[b])

	var win_time: float = FIN[order[0]]
	var results := []
	for oi in order.size():
		var i: int = order[oi]
		var r: Dictionary = R[i]
		var left: float = HP[i] / r.hp0 if r.hp0 > 0 else 0.0
		results.append({
			order = oi + 1, horseId = r.id, name = r.name, gate = r.gate, frame = r.frame, sex = r.horse.sex, weight = r.weight,
			time = FIN[i], last3f = FIN[i] - L3[i],
			margin = "—" if oi == 0 else format_margin(FIN[i] - FIN[order[oi - 1]]),
			marginTotal = FIN[i] - win_time, passing = passing[i].duplicate(),
			odds = odds[i], popularity = popularity[i], styleLabel = r.styleLabel,
			comment = _comment(r, BUST[i] >= 0.0, left, PULLED[i], BLOCK[i], WIDE[i], dnf[i], oi, n),
			dnf = dnf[i], avgOff = OFFSUM[i] / OFFN[i] if OFFN[i] > 0 else 0.0,
		})

	var out := {
		name = spec.get("name", ""), courseId = spec.courseId, courseName = track.courseName, surface = spec.surface,
		distance = int(dist), ground = spec.ground, results = results, winnerTime = win_time,
		checkpoints = checkpoints.map(func(c): return c.label),
		log = null,
	}
	if record:
		out.log = {
			dt = TICK * 2.0, frames = frame_count, n = n,
			ids = R.map(func(r): return r.id), names = R.map(func(r): return r.name),
			gates = R.map(func(r): return r.gate), frameNos = R.map(func(r): return r.frame),
			pos = log_pos.slice(0, frame_count * n), off = log_off.slice(0, frame_count * n), vel = log_v.slice(0, frame_count * n),
			distance = int(dist), start = track.start, lap = track.lap, width = track.width,
			finishOrder = order.map(func(i): return R[i].id),
		}
	return out


static func _occupied(i: int, off: float, n: int, S: PackedFloat64Array, OFF: PackedFloat64Array, FIN: PackedFloat64Array) -> bool:
	for j in n:
		if j == i or FIN[j] < INF:
			continue
		if absf(S[j] - S[i]) > BODY_LEN * 1.6:
			continue
		if absf(OFF[j] - off) < BODY_W * 0.9:
			return true
	return false


static func _target_gap(style: float, distance: float, field: int) -> float:
	var spread := lerpf_(26.0, 48.0, clamp01_((distance - 1200.0) / 1800.0)) * lerpf_(0.78, 1.12, field / 18.0)
	return pow(style, 1.25) * spread


static func _cruise_ratio(r: Dictionary, distance: float, front_runners: int) -> float:
	var c := 0.962 - clamp01_((distance - 1000.0) / 1400.0) * 0.082
	c -= (1.0 - r.eff.stamina) * 0.012
	c += (front_runners - 1) * 0.019
	c += (r.jkAgg - 0.5) * 0.012
	c += r.pull * 0.014
	return clampf_(c, 0.84, 1.0)


static func _corner_checkpoints(track: Dictionary, distance: float) -> Array:
	if track.straightCourse:
		return []
	var L: float = track.lap
	var marks := []
	var acc := 0.0
	for seg in track.segments:
		if seg.kind == "arc":
			marks.append(acc)
			marks.append(acc + seg.len / 2.0)
		acc += seg.len
	var out := []
	for lap in range(0, int(ceil(distance / L)) + 1):
		for m in marks:
			var s: float = m - track.start + lap * L
			if s > 60 and s < distance - 110:
				out.append(distance - s)
	out.sort()
	out.reverse()
	var picked: Array = out.slice(maxi(0, out.size() - 4))
	var labels := ["1角", "2角", "3角", "4角"]
	var res := []
	for i in picked.size():
		var li := labels.size() - picked.size() + i
		res.append({rem = picked[i], done = false, label = labels[li] if li >= 0 else "通過%d" % (i + 1)})
	return res


static func _comment(r: Dictionary, busted: bool, left: float, pulled: float, block: float, wide: float, dnf: bool, idx: int, field: int) -> String:
	var c := []
	if r.gateDelay > 0.55:
		c.append("出遅れ")
	if pulled > 10:
		c.append("掛かり気味")
	if block > 14:
		c.append("前が壁")
	if wide > 20:
		c.append("終始外々")
	if busted:
		c.append("最後は一杯" if idx < field * 0.3 else "ばてて後退")
	elif idx == 0:
		c.append("余力十分" if left > 0.25 else "辛勝")
	elif idx < 4:
		c.append("よく伸びた")
	if dnf:
		c.append("競走中止")
	if c.is_empty():
		c.append("力は出した" if idx < field / 2.0 else "見せ場なし")
	return "・".join(c)


## 馬具の効き目（src/sim/gear.js の gearEffect）。気性が悪いほど効く
static func gear_effect(gear: Dictionary, temper: float) -> Dictionary:
	var need := clamp01_((0.6 - temper) * 2.0)
	var start := 0.0
	var pull := 0.0
	var focus := 0.0
	if gear.get("menko"):
		start += 0.08 * need + 0.02
	if gear.get("shadowRoll"):
		start += 0.03 * need
		pull += 0.05 * need
	if gear.get("blinker"):
		pull += 0.10 * need
		focus += 0.012 * need
	elif gear.get("cheek"):
		pull += 0.05 * need
		focus += 0.005 * need
	return {start = start, pull = pull, focus = focus}
