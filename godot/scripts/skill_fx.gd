extends Node3D
## 固有スキルの発動のエフェクト（ゲームの render3d/skillfx.js の createFx3d と同じ筋）。馬の組に付けて一緒に動かす。
## 種類と色は data.json の skillFx（JS の SKILL_FX）。見た目だけで、走行ログ（結果）には触らない。
## 粒は CPUParticles3D（布は最初に一度だけ作って使い回す）、稲妻は帯の形を 0.06 秒ごとに作り直す。
## 深度テストを切って馬群に埋もれない（目印と同じ）。life 秒で消える（最後の 0.6 秒は粒を出さない）。

const LIFE := 3.2

static var _tex := {}

var kind := ""
var age := 0.0
var cols := {}
var parts: Array[CPUParticles3D] = []
var bolts: Array = []
var bolt_frame := -1
var ring: MeshInstance3D
var pillar: MeshInstance3D
var rng := RandomNumberGenerator.new()


## kind（"thunder" など）と色 {color, glow, core}（"#rrggbb"）で組む。
func setup(k: String, fx: Dictionary, seed: int) -> void:
	kind = k
	rng.seed = seed
	cols = {color = Color(fx.color), glow = Color(fx.glow), core = Color(fx.core)}
	_ring_and_pillar()
	match kind:
		"radiance":
			_add(_soft_parts("star", 40, [0.7, 1.4], Vector3(1.4, 1.3, 1.4), 1.6, 1.0, [0.6, 1.3], cols.color, true))
		"flame":
			var a := _soft_parts("flame", 48, [0.35, 0.75], Vector3(0.75, 0.9, 1.25), 3.4, 1.2, [0.6, 1.2], cols.color, false)
			a.color_ramp = _ramp([cols.color, cols.glow])
			_add(a)
			var b := _soft_parts("flame", 32, [0.35, 0.7], Vector3(0.75, 0.9, 1.25), 3.0, 1.2, [0.5, 1.0], cols.core, true)
			b.color_ramp = _ramp([cols.core, cols.color, cols.glow])
			_add(b)
		"frost":
			var f := _soft_parts("shard", 40, [0.8, 1.5], Vector3(0.6, 0.9, 0.9), 2.2, 1.0, [0.3, 0.8], cols.color, true)
			f.direction = Vector3(1, 0, 0)
			f.spread = 180.0
			f.flatness = 0.6
			f.angular_velocity_min = -220.0
			f.angular_velocity_max = 220.0
			_add(f)
		"sakura":
			var s := _soft_parts("petal", 64, [1.2, 2.2], Vector3(1.6, 0.8, 1.9), 0.9, 0.4, [0.26, 0.46], cols.color, false)
			s.tangential_accel_min = 3.0
			s.tangential_accel_max = 5.0
			s.angular_velocity_min = -300.0
			s.angular_velocity_max = 300.0
			s.color_ramp = _ramp([cols.color, cols.glow])
			_add(s)
		"gale":
			var g := _soft_parts("streak", 40, [0.35, 0.7], Vector3(1.3, 1.1, 1.6), 0.6, 0.3, [0.9, 1.5], cols.color, true)
			g.tangential_accel_min = 8.0
			g.tangential_accel_max = 12.0
			_add(g)
		"shadow":
			_add(_soft_parts("soft", 28, [0.5, 1.0], Vector3(0.7, 0.9, 1.2), 2.2, 1.0, [0.6, 1.2], Color("#14041f"), false))
			_add(_soft_parts("soft", 28, [0.5, 1.0], Vector3(0.7, 0.9, 1.2), 2.2, 1.0, [0.6, 1.1], cols.color, true))
		"star":
			var t := _soft_parts("star5", 44, [0.9, 1.6], Vector3(1.6, 1.2, 1.8), 0.8, 0.4, [0.3, 0.7], cols.core, true)
			t.tangential_accel_min = 3.0
			t.tangential_accel_max = 5.0
			t.color_ramp = _ramp([cols.core, cols.color])
			_add(t)
		"thunder":
			_add(_soft_parts("star", 24, [0.15, 0.35], Vector3(0.9, 0.9, 1.3), 3.0, 2.0, [0.6, 1.3], cols.core, true))
			for i in 4:
				bolts.append({glow = _bolt_mesh(cols.glow, 0.75), core = _bolt_mesh(cols.core, 1.0)})


func _add(p: CPUParticles3D) -> void:
	add_child(p)
	parts.append(p)


## 粒の組。box は生まれる箱の半径、up は上への速さ、spread_v は速さの揺れ、size は大きさ、add は加算合成
func _soft_parts(shape: String, n: int, life: Array, box: Vector3, up: float, spread_v: float, size: Array, col: Color, add: bool) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.amount = n
	p.lifetime = life[1]
	p.lifetime_randomness = 1.0 - float(life[0]) / float(life[1])
	p.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	p.emission_box_extents = box
	p.position = Vector3(0, 1.2, 0)
	p.direction = Vector3(0, 1, 0)
	p.spread = 25.0
	p.gravity = Vector3.ZERO
	p.initial_velocity_min = maxf(0.0, up - spread_v)
	p.initial_velocity_max = up + spread_v
	p.scale_amount_min = size[0]
	p.scale_amount_max = size[1]
	# 回すのは花びら・結晶・星だけ（炎と風の筋を回すと、四方へ散った棘に見えた）
	if shape in ["petal", "shard", "star5"]:
		p.angle_min = -180.0
		p.angle_max = 180.0
	p.color = col
	# 現れて消える（粒の寿命の中で）
	var c := Curve.new()
	c.add_point(Vector2(0, 0.2))
	c.add_point(Vector2(0.15, 1.0))
	c.add_point(Vector2(1, 0.0))
	p.scale_amount_curve = c
	var qm := QuadMesh.new()
	qm.size = Vector2(1.6, 0.25) if shape == "streak" else (Vector2(0.8, 1.2) if shape == "flame" else Vector2(1, 1))
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD if add else BaseMaterial3D.BLEND_MODE_MIX
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	# 粒の大きさを効かせる（既定ではビルボードが大きさを捨て、全部 1m で描かれ、出る前の大きさ 0 の粒まで黒く写った）
	m.billboard_keep_scale = true
	m.no_depth_test = true
	m.vertex_color_use_as_albedo = true
	m.albedo_texture = _texture(shape)
	m.render_priority = 2
	qm.material = m
	p.mesh = qm
	p.emitting = true
	return p


func _ramp(cs: Array) -> Gradient:
	# 既定の点（黒 → 白）を残すと黒い粒が混じる。点は丸ごと差し替える
	var g := Gradient.new()
	var off := PackedFloat32Array()
	var cc := PackedColorArray()
	for i in cs.size():
		off.append(float(i) / maxf(1.0, cs.size() - 1.0))
		cc.append(cs[i])
	g.offsets = off
	g.colors = cc
	return g


## 地面の輪と光の柱（ゲームの観戦の flare と同じ）
func _ring_and_pillar() -> void:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.no_depth_test = true
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.albedo_color = cols.color
	var tm := TorusMesh.new()
	tm.inner_radius = 0.85
	tm.outer_radius = 1.0
	tm.rings = 40
	ring = MeshInstance3D.new()
	ring.mesh = tm
	ring.scale = Vector3(1, 0.02, 1)
	ring.position.y = 0.08
	ring.material_override = m
	add_child(ring)
	var pm := StandardMaterial3D.new()
	pm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	pm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	pm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	pm.no_depth_test = true
	pm.cull_mode = BaseMaterial3D.CULL_DISABLED
	pm.albedo_color = cols.color
	pm.albedo_texture = _texture("column")
	var cm := CylinderMesh.new()
	cm.top_radius = 1.25
	cm.bottom_radius = 1.6
	cm.height = 1.0
	cm.cap_top = false
	cm.cap_bottom = false
	pillar = MeshInstance3D.new()
	pillar.mesh = cm
	pillar.material_override = pm
	add_child(pillar)


func _bolt_mesh(col: Color, op: float) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.no_depth_test = true
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.albedo_color = Color(col, op)
	m.render_priority = 3
	mi.material_override = m
	mi.mesh = ArrayMesh.new()
	add_child(mi)
	return mi


func _process(delta: float) -> void:
	# 寿命は実時間で測る（固有スキルのスローでも同じ長さで光る）。1 コマの重さ（読み込み・カットの切り替え）で
	# 一度に寿命を使い切らないよう、1 コマぶんは 0.1 秒で頭打ち
	age += minf(delta, 0.1)
	var end := LIFE - 0.6
	if age > end:
		for p in parts:
			p.emitting = false
	if age > LIFE + 0.8:
		queue_free()
		return
	var cam := get_viewport().get_camera_3d()
	var d := cam.global_position.distance_to(global_position) if cam else 30.0
	# 遠いカメラでも読める大きさに（目印と同じ）。近いときは輪と柱を薄める（柱の中から見ると画面が覆われる）
	var sc := clampf(d / 30.0, 1.0, 4.0)
	scale = Vector3.ONE * sc
	var near := clampf((d - 8.0) / 16.0, 0.0, 1.0)
	var k := age / LIFE
	var rt := clampf(age / (LIFE * 0.6), 0.0, 1.0)
	ring.scale = Vector3(1 + rt * 7, 0.02, 1 + rt * 7)
	(ring.material_override as StandardMaterial3D).albedo_color.a = ((1.0 - rt) * 0.95 if rt < 1.0 else 0.0) * maxf(near, 0.3)
	var up := clampf(k / 0.25, 0.0, 1.0)
	var hgt := maxf(0.01, 9.0 * up)
	pillar.scale = Vector3(1 - k * 0.5, hgt, 1 - k * 0.5)
	pillar.position.y = hgt / 2.0
	(pillar.material_override as StandardMaterial3D).albedo_color.a = clampf((up if k < 0.25 else 1.0 - (k - 0.25) / 0.75) * 0.85 * near, 0.0, 1.0)
	if not bolts.is_empty():
		_update_bolts(cam, end)


func _update_bolts(cam: Camera3D, end: float) -> void:
	var fi := int(floor(age / 0.06))
	if fi == bolt_frame:
		return
	bolt_frame = fi
	var cl := to_local(cam.global_position) if cam else Vector3(30, 2, 0)
	for i in bolts.size():
		var b: Dictionary = bolts[i]
		var on := age < end and rng.randf() < (0.9 if i == 0 else 0.55)
		for key in ["glow", "core"]:
			(b[key] as MeshInstance3D).visible = on
		if not on:
			continue
		# 1 本目は空から馬へ、ほかは馬の周りから外へ走る
		var from := Vector3((rng.randf() - 0.5) * 4, 14, (rng.randf() - 0.5) * 4) if i == 0 else Vector3((rng.randf() - 0.5) * 1.2, 1 + rng.randf() * 1.4, (rng.randf() - 0.5) * 2)
		var a := rng.randf() * TAU
		var to := Vector3(0, 2.2, 0) if i == 0 else Vector3(cos(a) * 3.5, from.y + (rng.randf() - 0.3) * 2.5, sin(a) * 3.5)
		var pts: Array[Vector3] = []
		for j in 12:
			var q := j / 11.0
			var p := from.lerp(to, q)
			if j > 0 and j < 11:
				p += Vector3(rng.randf() - 0.5, rng.randf() - 0.5, rng.randf() - 0.5) * (1.6 if i == 0 else 0.7)
			pts.append(p)
		var w := 0.11 if i == 0 else 0.06
		_write_bolt(b.glow, pts, w * 3.2, cl)
		_write_bolt(b.core, pts, w, cl)


## 折れ線をカメラへ向けた帯にする（細い線は Godot でも 1 画素にしかならない）
func _write_bolt(mi: MeshInstance3D, pts: Array[Vector3], w: float, cl: Vector3) -> void:
	var v := PackedVector3Array()
	var n := pts.size()
	var side := []
	for j in n:
		var d := (pts[mini(n - 1, j + 1)] - pts[maxi(0, j - 1)]).normalized()
		side.append((cl - pts[j]).cross(d).normalized() * w * (1.0 - j / (n * 1.4)))
	for j in n - 1:
		var a0: Vector3 = pts[j] + side[j]
		var a1: Vector3 = pts[j] - side[j]
		var b0: Vector3 = pts[j + 1] + side[j + 1]
		var b1: Vector3 = pts[j + 1] - side[j + 1]
		v.append_array([a0, a1, b0, a1, b1, b0])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = v
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	mi.mesh = am


## 粒の布（白。色は粒の色で付ける）。種類ごとに一度だけ作る
static func _texture(shape: String) -> Texture2D:
	if _tex.has(shape):
		return _tex[shape]
	var S := 64
	var img := Image.create(S, S, false, Image.FORMAT_RGBA8)
	var m := S / 2.0
	for y in S:
		for x in S:
			var px := (x + 0.5 - m) / m
			var py := (y + 0.5 - m) / m
			var a := 0.0
			match shape:
				"soft":
					a = clampf(1.0 - sqrt(px * px + py * py), 0.0, 1.0)
					a = a * a
				"star":
					# 4 本の細い光の筋と、ぼけた芯（ゲームの glint と同じ形）
					var r := sqrt(px * px + py * py)
					a = clampf(maxf(0.0, 1.0 - absf(px) * 14.0) * pow(1.0 - absf(py), 2.0) + maxf(0.0, 1.0 - absf(py) * 14.0) * pow(1.0 - absf(px), 2.0), 0.0, 1.0)
					a = maxf(a, pow(clampf(1.0 - r * 2.6, 0.0, 1.0), 2.0))
				"star5":
					var ang := atan2(py, px) + PI / 2.0
					var r5 := sqrt(px * px + py * py)
					var k5 := absf(fposmod(ang * 5.0 / TAU, 1.0) - 0.5) * 2.0
					a = 1.0 if r5 < lerpf(0.4, 0.88, k5) else 0.0
				"shard":
					a = 1.0 if absf(px) * 3.2 + absf(py) < 0.95 else 0.0
				"petal":
					var e := (px * px) / 0.32 + (py * py) / 0.75
					a = 1.0 if e < 1.0 and not (py < -0.6 and absf(px) < 0.12) else 0.0
				"flame":
					# 下が丸く太く、上へ細って消える舌（yy は上が 0）
					var yy := (py + 1.0) / 2.0
					var wd := 0.6 * pow(clampf(yy, 0.0, 1.0), 0.8)
					a = clampf(1.0 - absf(px) / maxf(0.01, wd), 0.0, 1.0) * smoothstep(0.0, 0.5, yy) * (1.0 - smoothstep(0.85, 1.0, yy))
				"streak":
					a = clampf(1.0 - absf(py) * 3.0, 0.0, 1.0) * clampf((px + 1.0) / 1.5, 0.0, 1.0) * clampf((1.0 - px) * 6.0, 0.0, 1.0)
				"column":
					a = clampf((py + 1.0) / 2.0, 0.0, 1.0)
					a = a * a
			img.set_pixel(x, y, Color(1, 1, 1, a))
	var t := ImageTexture.create_from_image(img)
	_tex[shape] = t
	return t
