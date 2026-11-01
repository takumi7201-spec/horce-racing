extends Node3D
## レースの馬と騎手。形はゲーム本体（src/render3d/horse3d.js・horsehead.js・jockey3d.js）から書き出した
## assets/horse/horse.glb（tools/export-godot-horse.mjs）。馬ごとの顔の布・ゼッケン・勝負服・毛色・脚の白は
## assets/horse/skins/<レース>/ から材質の名前で差し替える。
##
## 動きは horse3d.js の update() をそのまま移した（股・膝・球節の 3 節、回転襲歩の拍子、走った距離で位相を進める）。
## **このモデルは +Z が前**（three.js 版と同じ）。置く側は +Z を進行方向へ向ける。
##
## Godot で足したもの（少しの磨き）：
## - 毛の艶：縁の光（rim）を毛と顔に少し。真横から見たとき輪郭が背景に溶けなくなる
## - 手綱：銜（bitL・bitR）から騎手の手（handL・handR）へ毎コマ張る（three.js 版の makeReins と同じ考え）
## - 蹴り上げ：後ろ脚の蹄から芝の塊・砂を後ろ上へ飛ばす（前に散らすと足もとのごみに見えた。落とし穴 89）
## - コーナーの内傾：曲率と速さから胴を内へ少し倒す

const HORSE_SCENE := preload("res://assets/horse/horse.glb")
const STRIDE := 7.0
const EAR_TILT := 0.12
const LEGS := [["LF", true, 0.50, 0.25], ["RF", true, 0.62, 0.75], ["LH", false, 0.00, 0.00], ["RH", false, 0.12, 0.50]]

var body: Node3D
var neck: Node3D
var head: Node3D
var tail: Node3D
var tail_flow: Node3D
var rider: Node3D
var ears: Array = []
var legs: Array = []   # {hip, knee, fetlock, front, gallop, walk}
var reins: Array = []  # [帯, 銜, 手]
var kicks: Array = []
var phase := 0.0
var _mats := {}


func _ready() -> void:
	pass


## skin_dir：res://assets/horse/skins/<レース> / gate：馬番 / surface：turf・dirt（蹴り上げの色）
func build(skin_dir: String, gate: int, surface: String) -> void:
	var root: Node3D = HORSE_SCENE.instantiate()
	add_child(root)
	body = root.find_child("body", true, false)
	neck = root.find_child("neck", true, false)
	head = root.find_child("head", true, false)
	tail = root.find_child("tail", true, false)
	tail_flow = root.find_child("tailFlow", true, false)
	rider = root.find_child("rider", true, false)
	for e in ["earL", "earR"]:
		var n: Node3D = root.find_child(e, true, false)
		ears.append([n, n.rotation.z])
	for L in LEGS:
		legs.append({
			hip = root.find_child(L[0] + "_hip", true, false), knee = root.find_child(L[0] + "_knee", true, false),
			fetlock = root.find_child(L[0] + "_fetlock", true, false), front = L[1], gallop = L[2], walk = L[3], name = L[0],
		})
	_apply_skin(root, skin_dir, gate)
	_build_reins(root)
	_build_kicks(surface)


# ------------------------------------------------------------------ 布と色

func _apply_skin(root: Node, dir: String, gate: int) -> void:
	var meta := {}
	var path := dir + "/skins.json"
	if FileAccess.file_exists(path):
		meta = JSON.parse_string(FileAccess.get_file_as_string(path)).get(str(gate), {})
	var cols: Dictionary = meta.get("mats", {})
	var tex := {}
	for k in ["face", "number", "silks", "sleeve"]:
		var p := "%s/%d_%s.png" % [dir, gate, k]
		if ResourceLoader.exists(p):
			tex[k] = load(p)
	# 材質は名前ごとに 1 つ作って、同じ名前の面で使い回す（ゼッケンは左右 2 枚）
	var make := func(base: Material, nm: String) -> Material:
		if _mats.has(nm):
			return _mats[nm]
		var m: StandardMaterial3D = base.duplicate() if base is StandardMaterial3D else StandardMaterial3D.new()
		if cols.has(nm) and not tex.has(nm):
			m.albedo_color = Color(String(cols[nm]))
		if tex.has(nm):
			m.albedo_texture = tex[nm]
			m.albedo_color = Color.WHITE
		if nm == "hide" or nm == "face" or nm == "legLow":
			m.rim_enabled = true
			m.rim = 0.22
			m.rim_tint = 0.6
		_mats[nm] = m
		return m
	for mi in root.find_children("*", "MeshInstance3D", true, false):
		var mesh: Mesh = mi.mesh
		for i in mesh.get_surface_count():
			var base := mesh.surface_get_material(i)
			if base == null or base.resource_name == "":
				continue
			mi.set_surface_override_material(i, make.call(base, base.resource_name))

	# 脚の白。管・繋の材質の名前を書き出してある（legLow・white・hide、途中で終わる白は legPaint）。
	# 途中で終わる白は頂点色で塗り分けた形が要るので、Godot では繋を白、管を地の色にしておく
	var legs_meta: Dictionary = meta.get("legs", {})
	var low_name := "legLow" if cols.has("legLow") else "hide"
	for L in legs:
		var lm: Dictionary = legs_meta.get(L.name, {})
		var cannon: MeshInstance3D = _first_mesh(L.knee as Node)
		var pastern_hoof: Array = L.fetlock.get_children().filter(func(c): return c is MeshInstance3D)
		var pick := func(role: String, part: String) -> Material:
			var nm := String(lm.get(part, low_name))
			if nm == "legPaint":
				nm = "white" if part == "pastern" else low_name
			if nm == "hide" or nm == "legLow":
				nm = low_name
			return _mats.get(nm, _mats.get("hide"))
		if cannon:
			cannon.set_surface_override_material(0, pick.call("cannon", "cannon"))
		if pastern_hoof.size() > 0:
			pastern_hoof[0].set_surface_override_material(0, pick.call("pastern", "pastern"))
		if pastern_hoof.size() > 1 and String(lm.get("hoof", "hoof")) == "hoofPale" and _mats.has("hoof"):
			var pale: StandardMaterial3D = _mats["hoof"].duplicate()
			pale.albedo_color = Color(String(cols.get("hoofPale", "#8a7860")))
			pastern_hoof[1].set_surface_override_material(0, pale)


func _first_mesh(n: Node) -> MeshInstance3D:
	for c in n.get_children():
		if c is MeshInstance3D:
			return c
	return null


# ------------------------------------------------------------------ 手綱
# 銜（bitL・bitR）から騎手の手（handL・handR）へ。まっすぐ張ると首の中を通って見える（首を貫いた）ので、
# 首の脇を回る 3 次のベジエにする。首の太さは首の形の幅（AABB）から取り、その外へ少し離す。
# 帯は短い円柱を 10 本つないで毎コマ置き直す（頭と首は完歩に合わせて揺れるので、形を固定できない）。

const REIN_SEG := 10
var neck_half := 0.16


func _build_reins(root: Node) -> void:
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.11, 0.08, 0.07)
	mat.roughness = 0.5
	# 首の太さ：首の組の直下の毛の形の幅
	for c in neck.get_children():
		if c is MeshInstance3D:
			neck_half = maxf(0.08, c.mesh.get_aabb().size.x / 2.0)
			break
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.009
	cyl.bottom_radius = 0.009
	cyl.height = 1.0
	cyl.radial_segments = 5
	cyl.rings = 1
	for side in ["L", "R"]:
		var bit: Node3D = root.find_child("bit" + side, true, false)
		var hand: Node3D = root.find_child("hand" + side, true, false)
		if bit == null or hand == null:
			continue
		var segs: Array = []
		for k in REIN_SEG:
			var strap := MeshInstance3D.new()
			strap.mesh = cyl
			strap.material_override = mat
			strap.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			add_child(strap)
			segs.append(strap)
		reins.append([segs, bit, hand])


func _bez(a: Vector3, b: Vector3, c: Vector3, d: Vector3, t: float) -> Vector3:
	var u := 1.0 - t
	return a * (u * u * u) + b * (3.0 * u * u * t) + c * (3.0 * u * t * t) + d * (t * t * t)


func _update_reins() -> void:
	for r in reins:
		var a: Vector3 = to_local(r[1].global_position)
		var b: Vector3 = to_local(r[2].global_position)
		var side := signf(a.x) if absf(a.x) > 0.001 else signf(b.x)
		# 制御点：銜から 3 割のところで首の幅の 8 割、7 割のところで首の幅の外へ。少し持ち上げて垂れを抑える
		var c1 := a.lerp(b, 0.3) + Vector3(side * neck_half * 0.8, 0.04, 0)
		var c2 := a.lerp(b, 0.7) + Vector3(side * (neck_half + 0.04), 0.06, 0)
		var prev := a
		for k in REIN_SEG:
			var q := _bez(a, c1, c2, b, float(k + 1) / REIN_SEG)
			var d := q - prev
			var len := d.length()
			var seg: MeshInstance3D = r[0][k]
			if len < 0.001:
				seg.visible = false
				prev = q
				continue
			seg.visible = true
			var y := d / len
			var x := y.cross(Vector3.FORWARD)
			if x.length() < 0.1:
				x = y.cross(Vector3.UP)
			x = x.normalized()
			seg.transform = Transform3D(Basis(x, y * len, x.cross(y)), (prev + q) / 2.0)
			prev = q


# ------------------------------------------------------------------ 蹴り上げ

func _build_kicks(surface: String) -> void:
	var dirt := surface == "dirt"
	for side in [-1.0, 1.0]:
		var p := CPUParticles3D.new()
		p.amount = 24
		p.lifetime = 0.55
		p.local_coords = false
		p.emitting = false
		p.position = Vector3(0.18 * side, 0.08, -0.85)
		p.direction = Vector3(0, 0.9, -1.0)   # 後ろ上（+Z が前）
		p.spread = 22.0
		p.initial_velocity_min = 2.5
		p.initial_velocity_max = 4.5
		p.gravity = Vector3(0, -9.8, 0)
		p.scale_amount_min = 0.5
		p.scale_amount_max = 1.0
		var q := BoxMesh.new()
		q.size = Vector3(0.07, 0.04, 0.07) if not dirt else Vector3(0.05, 0.05, 0.05)
		var m := StandardMaterial3D.new()
		m.albedo_color = Color(0.36, 0.27, 0.17) if dirt else Color(0.22, 0.38, 0.16)
		m.roughness = 1.0
		q.material = m
		p.mesh = q
		add_child(p)
		kicks.append(p)


# ------------------------------------------------------------------ 動き（horse3d.js の update）

## ds：このコマで走った距離（m）/ v：速さ（m/s）/ bank：コーナーの内傾（rad。+X が馬の左なので、正で右へ倒れる）
func pose(ds: float, v: float, bank := 0.0) -> void:
	var gait := clampf((v - 2.0) / 8.0, 0.0, 1.0)
	var stride := 1.7 + (STRIDE - 1.7) * gait
	phase = fposmod(phase + maxf(0.0, ds) / stride, 1.0)
	var moving := clampf(v / 0.8, 0.0, 1.0)
	var hip_amp := 0.9 * (0.38 + 0.62 * gait) * moving
	var knee_amp := 1.35 * (0.45 + 0.55 * gait) * moving
	for L in legs:
		var lp: float = float(L.walk) + (float(L.gallop) - float(L.walk)) * gait
		var a := fposmod(phase + lp, 1.0) * TAU
		# 股は前後に振る（正で脚が後ろへ）。前へ振り出す間に膝・飛節を畳む。前脚の膝は蹄を後ろへ、後脚の飛節は蹄を前へ
		var hip_rot := sin(a) * hip_amp + (0.0 if L.front else 0.04)
		var swing := maxf(0.0, -cos(a))
		var stance := maxf(0.0, cos(a))
		L.hip.rotation.x = hip_rot
		L.knee.rotation.x = swing * knee_amp if L.front else -swing * knee_amp * 0.75 - 0.03 * moving
		L.fetlock.rotation.x = swing * 0.9 * moving * (0.5 + 0.5 * gait) - stance * maxf(0.0, hip_rot) * 0.6 - stance * 0.18 * gait
	var bob := (0.015 + 0.06 * gait) * moving
	body.position.y = sin(phase * TAU) * bob
	body.rotation.x = cos(phase * TAU) * 0.045 * gait
	body.rotation.z = bank
	var run := minf(1.0, v / 18.0)
	neck.rotation.x = 0.1 + run * 0.34 + sin(phase * TAU + 1.2) * 0.07 * gait
	head.rotation.x = run * 0.18
	for e in ears:
		e[0].rotation.x = EAR_TILT - run * 0.55
	tail.rotation.x = 0.3 + run * 0.78
	tail_flow.rotation.x = run * 0.2 + sin(phase * TAU * 2.0) * 0.08 * gait
	if rider:
		rider.rotation.x = -run * 0.08 - cos(phase * TAU) * 0.03 * gait
	_update_reins()
	for k in kicks:
		k.emitting = v > 9.0   # 止まりかけ（ゴールの後）は飛ばさない
