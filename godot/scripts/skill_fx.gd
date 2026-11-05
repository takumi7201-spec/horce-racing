extends Node3D
## 固有スキルの発動のエフェクト（ゲームの render3d/skillfx.js の createFx3d と同じ筋）。馬の組に付けて一緒に動かす。
## 種類と色は data.json の skillFx（JS の SKILL_FX）。見た目だけで、走行ログ（結果）には触らない。
## オーラは馬の体の頂点から湧く粒（CPUParticles3D の DIRECTED_POINTS、ゲームの AURA3 と同じ値）。飾りの粒と稲妻をその上に重ねる。
## 粒の布は最初に一度だけ作って使い回す。稲妻は帯の形を 0.06 秒ごとに作り直す。
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
## 輪・柱・飾り・稲妻の組（カメラの距離で拡大する）。オーラの粒は拡大しない（出どころの体の頂点がずれる）
var deco := Node3D.new()
## 体の芯の高さ（この組の座標。体の頂点の高さの真ん中）
var core_y := 1.35


## オーラの粒（ゲームの skillfx.js の AURA3 と同じ値。速さは m/秒：rise 上へ・out 体の外へ・trail 後ろ（−z）へ、
## size は半径 m、grow は一生で大きくなる割合、ramp は色の移り、dark は暗い粒の割合、stretch は縦横の伸び）
const AURA := {
	radiance = {n = 110, life = [0.6, 1.1], rise = 1.4, out = 0.35, trail = 1.0, size = [0.165, 0.315], grow = 0.8, ramp = ["core", "color", "glow"]},
	thunder = {n = 100, life = [0.2, 0.45], rise = 0.3, out = 1.3, trail = 2.0, size = [0.12, 0.24], grow = 0.5, ramp = ["core", "glow", "glow"]},
	flame = {n = 160, life = [0.4, 0.8], rise = 2.6, out = 0.3, trail = 2.4, size = [0.195, 0.375], grow = -0.5, ramp = ["core", "color", "glow"], stretch = Vector2(0.85, 1.4)},
	frost = {n = 100, life = [0.7, 1.3], rise = -0.15, out = 0.45, trail = 1.4, size = [0.15, 0.285], grow = 0.8, ramp = ["core", "color", "glow"]},
	sakura = {n = 90, life = [0.8, 1.4], rise = 0.5, out = 0.45, trail = 1.6, size = [0.15, 0.27], grow = 0.8, ramp = ["core", "color", "glow"]},
	gale = {n = 120, life = [0.3, 0.6], rise = 0.1, out = 0.2, trail = 8.0, size = [0.12, 0.225], grow = 0.4, ramp = ["core", "color", "glow"], stretch = Vector2(2.8, 0.45)},
	shadow = {n = 150, life = [0.5, 1.0], rise = 1.9, out = 0.3, trail = 1.6, size = [0.225, 0.413], grow = 0.7, ramp = ["color", "glow", "dark"], dark = 0.45},
	star = {n = 100, life = [0.7, 1.2], rise = 0.5, out = 0.4, trail = 1.2, size = [0.15, 0.27], grow = 0.8, ramp = ["core", "color", "glow"]},
}
## 漆黒の暗い粒の色（真っ黒だと汚れに見えたので深い紫。ゲームと同じ）
const DARK := Color("#1c0838")


## kind（"thunder" など）と色 {color, glow, core}（"#rrggbb"）で組む。src は馬（horse_model.gd）：オーラの粒をその体の表面から出す。
## 先に馬へ add_child してから呼ぶ（体の頂点をこの組の座標へ写すのに、木の中の位置が要る）。
func setup(k: String, fx: Dictionary, seed: int, src: Node3D = null) -> void:
	kind = k
	rng.seed = seed
	cols = {color = Color(fx.color), glow = Color(fx.glow), core = Color(fx.core), dark = DARK}
	add_child(deco)
	_ring_and_pillar()
	_aura(src)
	# 飾りの粒（オーラの上に重ねる）
	match kind:
		"radiance":
			_add(_soft_parts("star", 30, [0.7, 1.4], Vector3(1.4, 1.3, 1.4), 1.6, 1.0, [0.6, 1.3], cols.color, true))
		"flame", "shadow":
			# 火の粉（漆黒は紫の火の粉）。炎そのものはオーラの粒
			var e := _soft_parts("star", 26, [0.5, 1.0], Vector3(0.7, 0.8, 1.1), 3.0, 1.0, [0.14, 0.26], cols.core if kind == "flame" else cols.color, true)
			e.direction = Vector3(0, 1, -0.5).normalized()
			_add(e)
		"frost":
			var f := _soft_parts("shard", 30, [0.8, 1.5], Vector3(0.6, 0.9, 0.9), 2.2, 1.0, [0.3, 0.8], cols.color, true)
			f.direction = Vector3(1, 0, 0)
			f.spread = 180.0
			f.flatness = 0.6
			f.angular_velocity_min = -220.0
			f.angular_velocity_max = 220.0
			_add(f)
		"sakura":
			var s := _soft_parts("petal", 56, [1.2, 2.2], Vector3(1.6, 0.8, 1.9), 0.9, 0.4, [0.26, 0.46], cols.color, false)
			s.tangential_accel_min = 3.0
			s.tangential_accel_max = 5.0
			s.angular_velocity_min = -300.0
			s.angular_velocity_max = 300.0
			s.color_ramp = _ramp([cols.color, cols.glow])
			_add(s)
		"gale":
			var g := _soft_parts("streak", 24, [0.35, 0.7], Vector3(1.3, 1.1, 1.6), 0.6, 0.3, [0.9, 1.5], cols.color, true)
			g.tangential_accel_min = 8.0
			g.tangential_accel_max = 12.0
			_add(g)
		"star":
			var t := _soft_parts("star5", 40, [0.9, 1.6], Vector3(1.6, 1.2, 1.8), 0.8, 0.4, [0.3, 0.7], cols.core, true)
			t.tangential_accel_min = 3.0
			t.tangential_accel_max = 5.0
			t.color_ramp = _ramp([cols.core, cols.color])
			_add(t)
		"thunder":
			_add(_soft_parts("star", 20, [0.15, 0.35], Vector3(0.9, 0.9, 1.3), 3.0, 2.0, [0.6, 1.3], cols.core, true))
			for i in 4:
				bolts.append({glow = _bolt_mesh(cols.glow, 0.75), core = _bolt_mesh(cols.core, 1.0)})


## オーラ：馬の体の表面から湧き、上がる・外へ広がる・後ろへ流れる粒。粒は馬と一緒に動く（local_coords）。
## 生まれと消えは色の段の不透明度で滑らかに（現れて、半ばから溶けて消える）、色は芯 → 主の色 → 光の色。
## 半分は普通の合成（明るい空の前でも色が残る）、半分は加算（重なった所が光る）。漆黒は暗い粒の組を足す。
func _aura(src: Node3D) -> void:
	var A: Dictionary = AURA.get(kind, {})
	if A.is_empty():
		return
	var pts := _surface_points(src)
	var dark: float = A.get("dark", 0.0)
	var n: int = A.n
	var groups := [[int(n * (1.0 - dark) * 0.5), false, false], [int(n * (1.0 - dark) * 0.5), true, false]]
	if dark > 0.0:
		groups.append([int(n * dark), false, true])
	var c0: Color = cols[A.ramp[0]]
	var c1: Color = cols[A.ramp[1]]
	var c2: Color = cols[A.ramp[2]]
	for gdef in groups:
		var p := CPUParticles3D.new()
		p.amount = maxi(1, gdef[0])
		p.lifetime = A.life[1]
		p.lifetime_randomness = 1.0 - float(A.life[0]) / float(A.life[1])
		p.local_coords = true
		var life_avg := (float(A.life[0]) + float(A.life[1])) / 2.0
		if pts.is_empty():
			p.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
			p.emission_box_extents = Vector3(0.45, 0.7, 1.1)
			p.position = Vector3(0, 1.35, 0)
			p.direction = Vector3.UP
			p.spread = 60.0
		else:
			# 出どころは体の頂点、向きは体の芯（胴の高さの前後の線）から外へ（ゲームの spawnAura と同じ）
			p.emission_shape = CPUParticles3D.EMISSION_SHAPE_DIRECTED_POINTS
			p.emission_points = pts
			var nrm := PackedVector3Array()
			for q in pts:
				var o := Vector3(q.x, (q.y - core_y) * 0.6, 0.0)
				nrm.append(o.normalized() if o.length() > 0.01 else Vector3.UP)
			p.emission_normals = nrm
			p.spread = 15.0
		# 体の外へは初めの速さ、上と後ろへは加速で（寿命の間に、ゲームの「速さ × 時間」と同じくらい進む）
		p.initial_velocity_min = float(A.out) * 0.7
		p.initial_velocity_max = float(A.out) * 1.3
		p.gravity = Vector3(0, float(A.rise), -float(A.trail)) * (2.0 / life_avg)
		p.scale_amount_min = A.size[0] * 2.0
		p.scale_amount_max = A.size[1] * 2.0
		var grow: float = A.grow
		var sc := Curve.new()
		if grow >= 0.0:
			sc.add_point(Vector2(0, 1.0 / (1.0 + grow)))
			sc.add_point(Vector2(1, 1.0))
		else:
			sc.add_point(Vector2(0, 1.0))
			sc.add_point(Vector2(1, 1.0 + grow))
		p.scale_amount_curve = sc
		# 色と濃さの段：ふわっと現れ（0〜0.2）、半ばから溶けて消える（0.45〜1）。直線で上げ下げすると点滅に見えた
		var is_dark: bool = gdef[2]
		var op := 0.6 if is_dark else (0.6 if not gdef[1] else 0.7)
		var g := Gradient.new()
		var cs := [DARK, DARK, DARK, DARK] if is_dark else [c0, c0.lerp(c1, 0.4), c1, c2]
		g.offsets = PackedFloat32Array([0.0, 0.2, 0.45, 1.0])
		g.colors = PackedColorArray([Color(cs[0], 0.0), Color(cs[1], op), Color(cs[2], op * 0.85), Color(cs[3], 0.0)])
		p.color_ramp = g
		var qm := QuadMesh.new()
		qm.size = A.get("stretch", Vector2.ONE)
		var m := StandardMaterial3D.new()
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD if gdef[1] else BaseMaterial3D.BLEND_MODE_MIX
		m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
		m.billboard_keep_scale = true
		m.no_depth_test = true
		m.vertex_color_use_as_albedo = true
		m.albedo_texture = _texture("soft")
		m.render_priority = 1 if is_dark else 2
		qm.material = m
		p.mesh = qm
		p.emitting = true
		_add(p, false)


## 馬の体の表面の点（この組の座標）。重みは部品の大きさ（AABB の対角の 2 乗）。頂点の数で選ぶと細かく作った頭に偏り、
## 騎手は細かい部品が多くて重みの合計が馬の体を上回ったので、騎手の部品は 0.2 倍（ゲームの surfaceOf と同じ）。
func _surface_points(src: Node3D) -> PackedVector3Array:
	var out := PackedVector3Array()
	if src == null or not is_inside_tree():
		return out
	var rider: Node3D = src.get("rider") if "rider" in src else null
	# 手綱の円柱は毎コマ置き直す細い部品で、置く前は原点に重なっている（そこから下へ粒が湧いた）。出どころから外す
	var skip := {}
	if "reins" in src:
		for rr in src.get("reins"):
			for seg in rr[0]:
				skip[seg] = true
	var inv := global_transform.affine_inverse()
	var items := []
	var total := 0.0
	for mi in src.find_children("*", "MeshInstance3D", true, false):
		if skip.has(mi) or not mi.is_visible_in_tree() or mi.mesh == null or mi.mesh.get_surface_count() == 0 or self.is_ancestor_of(mi):
			continue
		var verts: PackedVector3Array = mi.mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
		if verts.is_empty():
			continue
		var w: float = (mi.global_transform.basis * mi.mesh.get_aabb().size).length_squared()
		if rider != null and (rider == mi or rider.is_ancestor_of(mi)):
			w *= 0.2
		items.append([mi, verts, w])
		total += w
	if total <= 0.0:
		return out
	for i in 400:
		var x := rng.randf() * total
		for it in items:
			if x < it[2]:
				var vv: PackedVector3Array = it[1]
				out.append(inv * ((it[0] as MeshInstance3D).global_transform * vv[rng.randi() % vv.size()]))
				break
			x -= it[2]
	# 体の芯の高さは点の高さの平均（馬の組の原点の高さはモデルの作りで違う）
	var sy := 0.0
	for q in out:
		sy += q.y
	core_y = sy / maxf(1.0, out.size())
	return out


func _add(p: CPUParticles3D, to_deco := true) -> void:
	(deco if to_deco else self).add_child(p)
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
	deco.add_child(ring)
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
	deco.add_child(pillar)


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
	deco.add_child(mi)
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
	deco.scale = Vector3.ONE * sc
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
	var cl := deco.to_local(cam.global_position) if cam else Vector3(30, 2, 0)
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
					# オーラの粒：芯から縁へなだらかに（縁の硬い丸は粒が粒に見えて、オーラにならない）
					# ゲームの布と同じ段（芯 1・0.3 で 0.6・0.65 で 0.16・縁 0）
					var rs := sqrt(px * px + py * py)
					a = lerpf(1.0, 0.6, rs / 0.3) if rs < 0.3 else (lerpf(0.6, 0.16, (rs - 0.3) / 0.35) if rs < 0.65 else clampf(lerpf(0.16, 0.0, (rs - 0.65) / 0.35), 0.0, 1.0))
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
