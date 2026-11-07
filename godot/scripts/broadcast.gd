extends Node
## レースの中継の演出（競馬場 racecourse.gd の「自動」のカメラと、画面の表示）。デザインはこのゲームのオリジナル。
##
## カメラは先頭の馬のいる場面でカットを割る：
##   ゲート（正面から）→ 序盤（外から並走）→ コーナー（上から追う）→ 1 周目のスタンド前（スタンドから振る）→
##   向正面（内馬場から）→ 4 コーナー（直線の入口の外から迎える）→ 直線（ゴールの先から望遠で正面）→
##   ゴール前（決勝線の真横から振る。ここだけ少しスロー）→ ゴールの後（勝ち馬を追う）
## カットは 3.5 秒より短くしない（場面の境目で行ったり来たりしない）。直線とゴール前は待たずに切り替える。
##
## 画面の表示：左上にレースの札、その下に順位、右上に時計と残り距離と 1000m の通過、下に全馬の位置の帯、
## その上に実況の字幕（スタート・1000m 通過とペース・4 コーナー・残り 200m・ゴール）、ゴールの後に確定の札。
## 字幕と通過の時計は走行ログ（先頭が各地点を過ぎた時刻）から最初に作っておく。結果は変えない（ログを読むだけ）。

const UIK := preload("res://scripts/ik/ui.gd")
const MIN_SHOT := 3.5

var rc   # racecourse.gd
var shot := ""
var shot_t := 0.0
var anchor := Vector3.ZERO     # 置いたまま振るカメラの位置
var eye := Vector3.ZERO
var look := Vector3.ZERO
var slow := 1.0                # ゴール前のスロー（再生の速さに掛ける）

var events: Array = []         # {t, text, kind}
var ev_i := 0
var pass_1000 := -1.0
var t_win := 0.0
var arc_end_s := -1.0          # 最後のコーナーの出口（走った距離）

var hud: Control
var plate: Control
var clock_l: Label
var rem_l: Label
var split_l: Label
var strip: FieldMap
var cap_box: Control
var cap_l: Label
var result_box: Control
var built := false
var cap_tw: Tween


func setup() -> void:
	if not built:
		_build_hud()
		built = true
	shot = ""
	shot_t = 0.0
	slow = 1.0
	_plan()
	_fill_plate()
	result_box.visible = false
	cap_box.modulate.a = 0.0
	ev_i = 0


func reset_shot() -> void:
	shot = ""
	shot_t = 0.0
	arc_n = -1
	tv_reset()


# ------------------------------------------------------------------ 走行ログから：先頭の通過時刻・字幕の予定

## 先頭（いちばん前の馬）が走った距離 x を過ぎた時刻。ログは 0.2 秒ごと
func lead_time_at(x: float) -> float:
	var dt: float = rc.race.dt
	var frames: int = rc.race.frames
	var prev := 0.0
	for f in frames:
		var m := 0.0
		for r in rc.runners:
			var arr: PackedFloat32Array = r.pos
			m = maxf(m, arr[mini(f, arr.size() - 1)])
		if m >= x:
			if f == 0:
				return 0.0
			return (f - 1) * dt + dt * (x - prev) / maxf(0.01, m - prev)
		prev = m
	return -1.0


## 時刻 t の並び（走った距離の順）
func order_at(t: float) -> Array:
	var list: Array = rc.runners.duplicate()
	list.sort_custom(func(a, b): return rc._s_at(a, t).x > rc._s_at(b, t).x)
	return list


func _plan() -> void:
	events = []
	var dist := float(rc.race.distance)
	var start: float = rc.race.start
	t_win = 1e9
	for r in rc.runners:
		t_win = minf(t_win, float(r.t_fin))
	# 最後のコーナーの出口：ゴールから戻って最初に曲率のある地点
	arc_end_s = -1.0
	var s := dist - 5.0
	while s > 0.0:
		if rc.curvature_at(start + s) > 0.0:
			arc_end_s = s
			break
		s -= 5.0
	var arc_start_s := arc_end_s
	while arc_start_s > 0.0 and rc.curvature_at(start + arc_start_s - 5.0) > 0.0:
		arc_start_s -= 5.0
	events.append({t = 0.4, text = "スタート！　%d 頭がそろって飛び出した" % rc.runners.size(), kind = "start"})
	var first_arc := -1.0
	s = 100.0
	while s < dist - 600.0:
		if rc.curvature_at(start + s) > 0.0:
			first_arc = s
			break
		s += 5.0
	if first_arc > 0.0 and first_arc < arc_start_s - 300.0:
		var t1 := lead_time_at(first_arc)
		var o1: Array = order_at(t1)
		events.append({t = t1, text = "コーナーへ。ハナを切ったのは %d 番 %s" % [int(o1[0].gate), o1[0].name], kind = "info"})
	pass_1000 = -1.0
	if dist >= 1400.0:
		pass_1000 = lead_time_at(1000.0)
		var even: float = t_win * 1000.0 / dist
		var pace := "平均ペース"
		if pass_1000 < even - 0.9:
			pace = "速いペース"
		elif pass_1000 > even + 0.9:
			pace = "ゆったりしたペース"
		events.append({t = pass_1000, text = "1000m 通過 %s　%s" % [_fmt(pass_1000), pace], kind = "split"})
	if dist >= 1800.0:
		var tm := lead_time_at(dist - 1000.0)
		var om := order_at(tm)
		events.append({t = tm, text = "残り 1000m。先頭 %s、2 番手 %s、3 番手 %s" % [om[0].name, om[1].name, om[2].name], kind = "info"})
	if arc_end_s > 0.0 and arc_start_s > 200.0:
		var t4 := lead_time_at(arc_start_s + 20.0)
		events.append({t = t4, text = "最後のコーナー。後続も外から差を詰めにかかる", kind = "info"})
		var ts := lead_time_at(arc_end_s + 10.0)
		var os := order_at(ts)
		events.append({t = ts, text = "直線に向いた！　先頭は %d 番 %s" % [int(os[0].gate), os[0].name], kind = "hot"})
	var t2 := lead_time_at(dist - 200.0)
	var o2 := order_at(t2)
	var gap: float = rc._s_at(o2[0], t2).x - rc._s_at(o2[1], t2).x
	events.append({t = t2, text = ("残り 200m！　%s と %s の叩き合い！" % [o2[0].name, o2[1].name]) if gap < 2.4 else ("残り 200m！　%s が抜け出した！" % o2[0].name), kind = "hot"})
	var winner = null
	for r in rc.runners:
		if int(r.order) == 1:
			winner = r
	if winner != null:
		events.append({t = t_win, text = "%s、ゴールイン！　勝ち時計 %s" % [winner.name, _fmt(float(winner.time))], kind = "goal"})
	events.sort_custom(func(a, b): return a.t < b.t)


func _fmt(t: float) -> String:
	var m := int(t / 60.0)
	return "%d:%04.1f" % [m, t - m * 60] if m > 0 else "%.1f" % t


# ------------------------------------------------------------------ カメラ

func _leader() -> Dictionary:
	var best = rc.runners[0]
	for r in rc.runners:
		if float(r.s) > float(best.s):
			best = r
	return best


func _pack_s() -> float:
	var list: Array = rc.runners.map(func(r): return float(r.s))
	list.sort()
	list.reverse()
	var k := mini(6, list.size())
	var sum := 0.0
	for i in k:
		sum += list[i]
	return sum / k


## 先頭の集団（ゲームの trackingFrame。JRA の中継の追いが収める範囲）：先頭からつながっている馬（前の馬との間が 12m 以内、
## 先頭から 30m 以内、5 頭まで）。大逃げのときは逃げ馬だけになる（後ろの集団まで入れようと引くと、逃げ馬が豆粒になった）。
var arc_n := -1   # コーナーのカットの通し番号（正面と高い所を交互に）
const TRACK_OUT := 24.0     # 追いのカメラ：外ラチの外 24m・低め 3.6m・集団の 5m 先
const TRACK_AHEAD := 5.0
const TRACK_HEIGHT := 3.6


func tracking_frame() -> Dictionary:
	var list: Array = rc.runners.duplicate()
	list.sort_custom(func(a, b): return float(a.s) > float(b.s))
	var w: float = rc.track.width
	var lead: Dictionary = list[0]
	var tail: Dictionary = lead
	var off_sum: float = lead.get("off_now", w * 0.3)
	var lo := off_sum
	var hi := off_sum
	var n := 1
	for i in range(1, mini(5, list.size())):
		var x: Dictionary = list[i]
		if float(tail.s) - float(x.s) > 12.0 or float(lead.s) - float(x.s) > 30.0:
			break
		tail = x
		var xo := float(x.get("off_now", w * 0.3))
		off_sum += xo
		lo = minf(lo, xo)
		hi = maxf(hi, xo)
		n += 1
	var front := float(lead.s) + 3.0
	var back := float(tail.s) - 3.5
	# width は集団の横の広がり（正面から撮るときに収める幅）
	return {mid = (front + back) / 2.0, span = maxf(13.0, front - back), off = off_sum / n, width = maxf(10.0, hi - lo + 6.0)}


## 追いのカットの置き場所（ゲームの trackShot）。[目, 見る点, 縦の画角]
##   trackOut 外ラチの外の低い所から真横に近く・trackIn 内馬場の側から・front3q 集団の 28m 先の外ラチ際から斜め前で迎える・
##   curveFront 集団の 55m 先の走路の上から真正面で迎える（コーナーを回ってくる馬群を正面から）・high 外の後ろの高い所から隊列を見下ろす
func track_shot(name: String, fr: Dictionary) -> Array:
	var w: float = rc.track.width
	var gm: float = float(rc.race.start) + float(fr.mid)
	var off := float(fr.off)
	var span := float(fr.span)
	var e: Vector3
	var l: Vector3
	match name:
		"trackIn":
			e = rc.at_p(gm + TRACK_AHEAD, -TRACK_OUT, TRACK_HEIGHT)
			l = rc.at_p(gm, off, 1.3)
		"front3q":
			e = rc.at_p(gm + float(fr.span) / 2.0 + 28.0, w + 9.0, 2.6)
			l = rc.at_p(gm + 2.0, off, 1.3)
			span = maxf(float(fr.width) + 4.0, float(fr.span) * 0.5)
		"curveFront":
			e = rc.at_p(gm + float(fr.span) / 2.0 + 55.0, off + 5.0, 4.5)   # 弦が内へ入るぶん外へ寄せる（内ラチが手前を横切った）
			l = rc.at_p(gm + 2.0, off, 1.2)
			span = float(fr.width) + 4.0
		"high":
			e = rc.at_p(gm - 22.0, w + 30.0, 16.0)
			l = rc.at_p(gm + 4.0, off, 1.0)
			span = float(fr.span) * 1.5
		_:
			e = rc.at_p(gm + TRACK_AHEAD, w + TRACK_OUT, TRACK_HEIGHT)
			l = rc.at_p(gm, off, 1.3)
	return [e, l, tracking_fov(span, e.distance_to(l))]


## 「中継」のカメラ（ゲームの createTvDirector）：追いのカットを場面で割る。コーナーは正面 → 高い所 → 外から、
## 直線は外から → 斜め前 → 内から → 高い所 を順に回す。7 秒で替え、場面が変わったらすぐ替える（3.5 秒より短くしない）。ゴール前 150m は外から。
const TV_ROT := {curve = ["curveFront", "high", "trackOut"], straight = ["trackOut", "front3q", "trackIn", "high"]}
var tv_shot := ""
var tv_t := 0.0
var tv_kind := ""
var tv_n := 0


func tv_reset() -> void:
	tv_shot = ""
	tv_t = 0.0
	tv_kind = ""
	tv_n = 0


## 返り値 [目, 見る点, 縦の画角, カット頭か]
func tv_camera(delta: float) -> Array:
	tv_t += delta
	var L := _leader()
	var k := "post" if float(rc.race.distance) - float(L.s) <= 150.0 else ("curve" if rc.curvature_at(float(rc.race.start) + float(L.s)) > 0.0 else "straight")
	var cut := false
	if k != tv_kind and (tv_shot == "" or tv_t > MIN_SHOT or k == "post"):
		tv_kind = k
		tv_n = 0
		cut = true
	elif k != "post" and tv_t > 7.0:
		tv_n += 1
		cut = true
	if cut:
		tv_shot = "trackOut" if k == "post" else String(TV_ROT[tv_kind][tv_n % TV_ROT[tv_kind].size()])
		tv_t = 0.0
	var r := track_shot(tv_shot, tracking_frame())
	r.append(cut)
	return r


## 集団の前後の長さ span を横に収める縦の画角（Godot の fov は縦）。馬の高さが切れない狭さで頭打ち
func tracking_fov(span: float, d: float) -> float:
	var vp: Vector2 = rc.get_viewport().get_visible_rect().size
	var aspect: float = vp.x / maxf(1.0, vp.y)
	var h := atan(span * 0.5 * 1.3 / maxf(1.0, d))
	var v := maxf(2.0 * atan(tan(h) / aspect), 2.0 * atan(3.2 / maxf(1.0, d)))
	return clampf(rad_to_deg(v), 4.0, 34.0)


func _pick() -> String:
	var t: float = rc.race_t
	var L := _leader()
	var dist := float(rc.race.distance)
	var rem := dist - float(L.s)
	if t < 3.2:
		return "gate"
	if t > t_win + 2.0:
		return "after"
	if rem <= 130.0:
		return "post"
	var start: float = rc.race.start
	var on_arc: bool = rc.curvature_at(start + float(L.s)) > 0.0
	if not on_arc and arc_end_s > 0.0 and float(L.s) >= arc_end_s - 5.0:
		return "head"
	if on_arc and arc_end_s > 0.0 and float(L.s) > arc_end_s - 200.0:
		return "turn4"
	if on_arc:
		return "aerial"
	var lap: float = rc.track.lap
	var pm: float = fposmod(start + float(L.s), lap)
	var home: float = rc.track.homeStraight
	if pm > lap - home or pm < float(rc.track.toFirst):
		return "stand"
	if float(L.s) < 320.0:
		return "side"
	return "infield"


func update_camera(delta: float, snap: bool) -> void:
	if rc.race.is_empty():
		return
	shot_t += delta
	var want := _pick()
	var urgent := want in ["post", "head", "after", "gate"]
	var cut := false
	if want != shot and (shot == "" or shot_t > MIN_SHOT or urgent):
		shot = want
		shot_t = 0.0
		cut = true
		if shot == "aerial":
			arc_n += 1
		_place_anchor()
	var w: float = rc.track.width
	var start: float = rc.race.start
	var L := _leader()
	var pl: float = start + float(L.s)
	var pm: float = start + _pack_s()
	var offL: float = L.get("off_now", w * 0.3)
	# 直線の追い（並走・向正面）・コーナー・スタンド・4 角は先頭の集団を収める（6 頭の平均を見ると大逃げで逃げ馬が豆粒になった）
	var fr := tracking_frame()
	var gm: float = start + float(fr.mid)
	var fov := 32.0
	var e: Vector3
	var l: Vector3
	var n: int = rc.runners.size()
	match shot:
		"gate":
			var mid: float = rc.RAIL_GAP + (n - 1) * rc.GATE_W / 2.0
			e = rc.at_p(start + 30.0, mid + 7.0, 3.2)
			l = rc.at_p(start + 1.0, mid, 1.3)
			fov = 38.0
		"side", "infield", "aerial":
			# 直線は JRA の中継の追い（外から・向正面は内馬場から）。コーナーは前から正面で迎えるカットと外の高い所を交互に
			var r := track_shot("trackOut" if shot == "side" else ("trackIn" if shot == "infield" else ("high" if arc_n % 2 == 1 else "curveFront")), fr)
			e = r[0]
			l = r[1]
			fov = r[2]
		"stand", "turn4", "post":
			e = anchor
			l = rc.at_p((pl if shot == "post" else gm) + 2.0, offL if shot == "post" else float(fr.off), 1.2)
			# Godot の画角は縦（KEEP_HEIGHT）。span は画面の高さの半分に入れる大きさ（m）
			var span: float = maxf(5.0, float(fr.span) * 0.65 / 1.6) if shot != "post" else 4.5
			fov = clampf(rad_to_deg(2.0 * atan(span / maxf(1.0, e.distance_to(l)))), 2.0, 40.0)
		"head":
			# ゴールの先から望遠で迎える（馬群が手前へ来るほど画角を広げて、横の並びを収める）
			e = anchor
			l = rc.at_p(pl - 6.0, offL, 1.5)
			fov = clampf(rad_to_deg(2.0 * atan(5.0 / maxf(1.0, e.distance_to(l)))), 1.5, 30.0)
		"after":
			var wr = L
			for r in rc.runners:
				if int(r.order) == 1:
					wr = r
			var pw: float = start + float(wr.s)
			var ow: float = wr.get("off_now", w * 0.3)
			e = rc.at_p(pw - 9.0, ow + 11.0, 3.8)
			l = rc.at_p(pw + 3.0, ow, 1.3)
			fov = 34.0
		_:
			e = rc.at_p(pm - 6.0, w + 16.0, 6.0)
			l = rc.at_p(pm + 4.0, w * 0.3, 1.2)
	if snap or cut or eye == Vector3.ZERO:
		eye = e
		look = l
	else:
		var k := clampf(delta * 4.0, 0.0, 1.0)
		eye = eye.lerp(e, k)
		look = look.lerp(l, clampf(delta * 6.0, 0.0, 1.0))
	rc.camera.fov = fov if (cut or snap) else lerpf(rc.camera.fov, fov, clampf(delta * 3.0, 0.0, 1.0))
	rc.camera.set_view(eye, look)
	# ゴール前だけ少しスロー（先頭が決勝線を過ぎて 1 秒で戻す）。スローは再生の速さに掛ける
	var want_slow := 0.55 if (shot == "post" and rc.race_t < t_win + 1.0 and rc.race_t > t_win - 2.2) else 1.0
	slow = lerpf(slow, want_slow, clampf(delta * 5.0, 0.0, 1.0))


## 置いたまま振るカメラの位置（カットの頭で決める）
func _place_anchor() -> void:
	var w: float = rc.track.width
	var start: float = rc.race.start
	var dist := float(rc.race.distance)
	var lap: float = rc.track.lap
	var L := _leader()
	match shot:
		"stand":
			# スタンドの前の高い所（直線の中ほど）
			anchor = rc.at_p(lap - float(rc.track.homeStraight) * 0.45, w + 24.0, 15.0)
		"turn4":
			# 直線の入口の外：コーナーを回ってくる馬群を迎える
			anchor = rc.at_p(start + arc_end_s - 20.0, w + 30.0, 12.0)
		"head":
			anchor = rc.at_p(start + dist + 60.0, w * 0.35, 4.5)
		"post":
			anchor = rc.at_p(start + dist + 0.5, w + 13.0, 5.5)


# ------------------------------------------------------------------ 画面の表示

func _build_hud() -> void:
	hud = Control.new()
	hud.set_anchors_preset(Control.PRESET_FULL_RECT)
	hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	rc.ui.add_child(hud)
	rc.ui.move_child(hud, 0)

	# 左上：レースの札（格・名・条件）
	plate = UIK.box({c = [Color(0.067, 0.188, 0.208, 0.9), Color(0.17, 0.35, 0.33, 0.9)], angle = 90.0, radius = 12.0, border = 2.5,
		border_color = Color(1, 1, 1, 0.9), shadow = Vector2(0, 4), shadow_color = Color(0, 0, 0, 0.35), pad = Vector4(14, 7, 18, 9)})
	plate.position = Vector2(14, 12)
	hud.add_child(plate)

	# 右上：時計・残り距離・通過
	var cb := UIK.box({c = [Color(0.067, 0.188, 0.208, 0.9)], radius = 12.0, border = 2.5, border_color = Color(1, 1, 1, 0.9),
		shadow = Vector2(0, 4), shadow_color = Color(0, 0, 0, 0.35), pad = Vector4(16, 6, 16, 8)})
	var cv := UIK.vbox(0)
	clock_l = UIK.label("0.0", 34, Color.WHITE, "title")
	clock_l.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	cv.add_child(clock_l)
	rem_l = UIK.label("", 16, UIK.LEAF2, "black")
	rem_l.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	cv.add_child(rem_l)
	split_l = UIK.label("", 13, Color("#f6cf86"), "black")
	split_l.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	cv.add_child(split_l)
	cb.add_child(cv)
	cb.custom_minimum_size = Vector2(190, 0)
	cb.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	cb.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	cb.offset_right = -14
	cb.offset_top = 12
	hud.add_child(cb)

	# 下：全馬の位置の帯
	strip = FieldMap.new()
	strip.rc = rc
	strip.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	strip.offset_left = 14
	strip.offset_right = -14
	strip.offset_top = -100
	strip.offset_bottom = -48
	strip.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.add_child(strip)

	# 字幕（下の帯の上、中央）
	cap_box = UIK.box({c = [Color(0.067, 0.188, 0.208, 0.92)], radius = 10.0, border = 2.5, border_color = UIK.LEAF, shadow = Vector2(0, 4),
		shadow_color = Color(0, 0, 0, 0.35), pad = Vector4(18, 8, 22, 9)})
	cap_l = UIK.label("", 20, Color.WHITE, "black")
	cap_box.add_child(cap_l)
	cap_box.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	cap_box.grow_horizontal = Control.GROW_DIRECTION_BOTH
	cap_box.grow_vertical = Control.GROW_DIRECTION_BEGIN
	cap_box.offset_bottom = -112
	hud.add_child(cap_box)

	# 確定の札（ゴールの後）
	result_box = UIK.box({c = [Color(0.99, 0.97, 0.92, 0.96)], radius = 14.0, border = 3.0, shadow = Vector2(0, 6), pad = Vector4(18, 10, 18, 12)})
	result_box.set_anchors_preset(Control.PRESET_CENTER_TOP)
	result_box.grow_horizontal = Control.GROW_DIRECTION_BOTH
	result_box.offset_top = 70
	result_box.visible = false
	hud.add_child(result_box)


func _fill_plate() -> void:
	for c in plate.get_children():
		c.queue_free()
	var h := UIK.hbox(10)
	var g := String(rc.race.get("grade", ""))
	if g == "" and (String(rc.race.name).contains("有馬") or String(rc.race.name).contains("ジャパン") or String(rc.race.name).contains("凱旋") or String(rc.race.name).contains("クラシック") or String(rc.race.name).contains("フェブラリー")):
		g = "GI"
	if g != "":
		var chip := UIK.box({c = [Color("#ffe27a"), UIK.SUN], radius = 6.0, border = 2.0, shadow = Vector2.ZERO, pad = Vector4(7, 0, 7, 2)})
		chip.add_child(UIK.label(g, 15, UIK.INK, "title"))
		chip.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		h.add_child(chip)
	var v := UIK.vbox(-2)
	v.add_child(UIK.label(String(rc.race.name), 22, Color("#fff4dc"), "title"))
	var tr: Dictionary = rc.track
	v.add_child(UIK.label("%s　%s %dm（%s回り）　馬場 %s　%d 頭" % [String(tr.short), "芝" if rc.surface == "turf" else "ダート", int(rc.race.distance),
		"右" if tr.dir == "right" else "左", String(rc.race.get("ground", "良")), rc.runners.size()], 13, UIK.LEAF2, "black"))
	h.add_child(v)
	plate.add_child(h)
	plate.reset_size()


func update_hud(_delta: float) -> void:
	if not built or rc.race.is_empty():
		return
	var t: float = rc.race_t
	var L := _leader()
	var dist := float(rc.race.distance)
	var shown := minf(t, t_win)
	clock_l.text = _fmt(shown)
	var rem := maxf(0.0, dist - float(L.s))
	rem_l.text = ("残り %dm" % int(ceil(rem / 10.0) * 10)) if rem > 0.0 else "ゴール"
	split_l.text = ("1000m 通過 %s" % _fmt(pass_1000)) if pass_1000 > 0.0 and t >= pass_1000 else ""
	strip.queue_redraw()
	# 字幕：時刻を過ぎた出来事を順に出す（巻き戻したら最初から）
	if ev_i > 0 and t < float(events[ev_i - 1].t) - 0.05:
		ev_i = 0
		while ev_i < events.size() and float(events[ev_i].t) <= t:
			ev_i += 1
	while ev_i < events.size() and float(events[ev_i].t) <= t:
		_caption(events[ev_i])
		ev_i += 1
	# 一時停止の間は字幕を消さない（止めた場面で、直前の実況が読める）
	if not rc.playing and ev_i > 0 and t - float(events[ev_i - 1].t) < 4.0:
		if cap_tw and cap_tw.is_valid():
			cap_tw.kill()
		cap_box.modulate.a = 1.0
	var show_res := t > t_win + 3.0
	if show_res and not result_box.visible:
		_fill_result()
		result_box.visible = true
		result_box.reset_size()
		result_box.modulate.a = 0.0
		result_box.create_tween().tween_property(result_box, "modulate:a", 1.0, 0.3)
	elif not show_res and result_box.visible:
		result_box.visible = false


func _caption(ev: Dictionary) -> void:
	cap_l.text = String(ev.text)
	# 錨で置いた箱は中身が伸びても大きさが変わらない（字幕が 41px の幅のまま切れた）。測り直して真ん中へ
	cap_box.reset_size()
	cap_box.offset_left = -cap_box.size.x / 2.0
	cap_box.offset_right = cap_box.size.x / 2.0
	var col: Color = {hot = UIK.SUN, goal = Color("#ffe27a"), split = UIK.LEAF}.get(ev.kind, UIK.LEAF)
	cap_box.mat.set_shader_parameter("border_color", col)
	# 前の字幕の消える動きは止める（続けて出すと、前の字幕の消える動きが次の字幕を消した）
	if cap_tw and cap_tw.is_valid():
		cap_tw.kill()
	cap_box.modulate.a = 0.0
	cap_tw = cap_box.create_tween()
	cap_tw.tween_property(cap_box, "modulate:a", 1.0, 0.18)
	cap_tw.tween_interval(3.6 if ev.kind != "goal" else 6.0)
	cap_tw.tween_property(cap_box, "modulate:a", 0.0, 0.4)


func _fill_result() -> void:
	for c in result_box.get_children():
		c.queue_free()
	var v := UIK.vbox(4)
	var hd := UIK.hbox(8)
	var chip := UIK.box({c = [Color("#c0392b")], radius = 6.0, border = 0.0, shadow = Vector2.ZERO, pad = Vector4(8, 0, 8, 2)})
	chip.add_child(UIK.label("確定", 15, Color.WHITE, "title"))
	hd.add_child(chip)
	hd.add_child(UIK.label(String(rc.race.name), 18, UIK.INK, "title"))
	v.add_child(hd)
	var list: Array = rc.runners.duplicate()
	list.sort_custom(func(a, b): return int(a.order) < int(b.order))
	for k in mini(3, list.size()):
		var r: Dictionary = list[k]
		var row := UIK.hbox(10)
		row.add_child(UIK.label("%d着" % (k + 1), 18, Color("#c0641a") if k == 0 else UIK.INK, "title"))
		var gp := UIK.box({c = [rc.FRAME_BG[clampi(int(r.frame) - 1, 0, 7)]], radius = 5.0, border = 1.5, shadow = Vector2.ZERO, pad = Vector4(5, 0, 5, 1)})
		gp.add_child(UIK.label(str(int(r.gate)), 13, rc.FRAME_FG[clampi(int(r.frame) - 1, 0, 7)], "black"))
		gp.custom_minimum_size.x = 24
		gp.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(gp)
		var nm := UIK.label(String(r.name), 17, UIK.INK, "black")
		nm.custom_minimum_size.x = 190
		row.add_child(nm)
		var tt := _fmt(float(r.time)) if k == 0 else ("+%.1f" % (float(r.time) - float(list[0].time)))
		row.add_child(UIK.label(tt, 15, Color("#4a5b58"), "black"))
		v.add_child(row)
	result_box.add_child(v)


## 全馬の位置の帯：スタートからゴールまでの線に、馬番の丸を走った距離の位置に置く（枠の色）。
## 重なる馬は上下の段に振り分ける。自分の馬（mine）は橙の輪。200m ごとの目盛りと「残り」の数
class FieldMap extends Control:
	var rc

	func _draw() -> void:
		if rc == null or rc.race.is_empty():
			return
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color(0.067, 0.188, 0.208, 0.78)
		sb.set_corner_radius_all(12)
		sb.border_color = Color(1, 1, 1, 0.7)
		sb.set_border_width_all(2)
		draw_style_box(sb, Rect2(Vector2.ZERO, size))
		var dist := float(rc.race.distance)
		var x0 := 70.0
		var x1 := size.x - 40.0
		var y := size.y * 0.5
		var f: Font = load("res://scripts/ik/ui.gd").font("black")
		draw_string(f, Vector2(12, y + 5), "START", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color("#d3e27f"))
		draw_line(Vector2(x0, y), Vector2(x1, y), Color(1, 1, 1, 0.35), 3.0)
		var m := 200.0
		while m < dist:
			var x := x0 + (x1 - x0) * (dist - m) / dist
			var big := int(m) % 1000 == 0 or m == 200.0 or m == 600.0
			draw_line(Vector2(x, y - (7 if big else 4)), Vector2(x, y + (7 if big else 4)), Color(1, 1, 1, 0.55), 2.0)
			if big:
				draw_string(f, Vector2(x - 20, size.y - 4), "%d" % int(m), HORIZONTAL_ALIGNMENT_CENTER, 40, 10, Color(1, 1, 1, 0.6))
			m += 200.0
		# ゴール
		draw_line(Vector2(x1, 6), Vector2(x1, size.y - 6), Color("#f3a332"), 3.0)
		draw_string(f, Vector2(x1 + 4, y + 5), "G", HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color("#f3a332"))
		var list: Array = rc.runners.duplicate()
		list.sort_custom(func(a, b): return float(a.s) < float(b.s))
		var last_x := -99.0
		var lane := 0
		for r in list:
			var x: float = x0 + (x1 - x0) * clampf(float(r.s) / dist, 0.0, 1.03)
			lane = (lane + 1) % 2 if x - last_x < 16.0 else 0
			last_x = x
			var fi: int = clampi(int(r.frame) - 1, 0, 7)
			var c := Vector2(x, y + (lane * 2 - 1) * 9.0 if list.size() > 1 else y)
			if r.get("mine", false):
				draw_circle(c, 11.0, Color("#f3a332"))
			draw_circle(c, 9.0, Color("#113035"))
			draw_circle(c, 7.8, rc.FRAME_BG[fi])
			draw_string(f, Vector2(c.x - 10, c.y + 4), str(int(r.gate)), HORIZONTAL_ALIGNMENT_CENTER, 20, 10, rc.FRAME_FG[fi])
