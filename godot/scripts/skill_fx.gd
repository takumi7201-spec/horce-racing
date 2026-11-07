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
var ring: MeshInstance3D
var pillar: MeshInstance3D
var rng := RandomNumberGenerator.new()
## 輪・柱・飾り・稲妻の組（カメラの距離で拡大する）。オーラの粒は拡大しない（出どころの体の頂点がずれる）
var deco := Node3D.new()
## 体の芯の高さ（この組の座標。体の頂点の高さの真ん中）
var core_y := 1.35
## 疾風の竜巻（帯・波紋・土煙・葉・発動の閃光）
var tor_mesh: MeshInstance3D
var tor_line: MeshInstance3D
var tor_ribbons: Array = []
var tor_rings: Array = []
var tor_dust: Array = []
var tor_leaves: Array = []
var tor_burst: MeshInstance3D
## 流星（殻・尾の帯・光の筋・四芒星・鼻先の光・閃光）
var com_shells: Array = []
var com_tail: Array[MeshInstance3D] = []
var com_tails: Array = []
var com_lines_mesh: MeshInstance3D
var com_lines: Array = []
var com_sparks: Array = []
var com_nose: MeshInstance3D
var com_flare: MeshInstance3D
## 流星の組。距離で拡大しない（彗星は馬の体を包む形。拡大すると望遠のカメラで殻が膨らんで画面を覆う）
var com_root := Node3D.new()


## オーラの粒（ゲームの skillfx.js の AURA3 と同じ値。速さは m/秒：rise 上へ・out 体の外へ・trail 後ろ（−z）へ、
## size は半径 m、grow は一生で大きくなる割合、ramp は色の移り、dark は暗い粒の割合、stretch は縦横の伸び）
const AURA := {
	radiance = {n = 110, life = [0.6, 1.1], rise = 1.4, out = 0.35, trail = 1.0, size = [0.165, 0.315], grow = 0.8, ramp = ["core", "color", "glow"]},
	thunder = {n = 90, life = [0.2, 0.45], rise = 0.3, out = 1.3, trail = 2.0, size = [0.12, 0.24], grow = 0.5, ramp = ["core", "color", "glow"]},
	flame = {n = 160, life = [0.4, 0.8], rise = 2.6, out = 0.3, trail = 2.4, size = [0.195, 0.375], grow = -0.5, ramp = ["core", "color", "glow"], stretch = Vector2(0.85, 1.4)},
	frost = {n = 100, life = [0.7, 1.3], rise = -0.15, out = 0.45, trail = 1.4, size = [0.15, 0.285], grow = 0.8, ramp = ["core", "color", "glow"]},
	sakura = {n = 90, life = [0.8, 1.4], rise = 0.5, out = 0.45, trail = 1.6, size = [0.15, 0.27], grow = 0.8, ramp = ["core", "color", "glow"]},
	gale = {n = 60, life = [0.3, 0.6], rise = 0.3, out = 0.3, trail = 7.0, size = [0.12, 0.225], grow = 0.4, ramp = ["core", "color", "glow"], stretch = Vector2(2.8, 0.45)},
	shadow = {n = 150, life = [0.5, 1.0], rise = 1.9, out = 0.3, trail = 1.6, size = [0.225, 0.413], grow = 0.7, ramp = ["color", "glow", "dark"], dark = 0.45},
	star = {n = 100, life = [0.7, 1.2], rise = 0.5, out = 0.4, trail = 1.2, size = [0.15, 0.27], grow = 0.8, ramp = ["core", "color", "glow"]},
	# 流星：体から剥がれて尾へ流れる星屑
	comet = {n = 90, life = [0.3, 0.7], rise = 0.1, out = 0.3, trail = 8.0, size = [0.1, 0.2], grow = 0.3, ramp = ["core", "color", "glow"], stretch = Vector2(2.4, 0.5)},
}
## 漆黒の暗い粒の色（真っ黒だと汚れに見えたので深い紫。ゲームと同じ）
const DARK := Color("#1c0838")


## kind（"thunder" など）と色 {color, glow, core}（"#rrggbb"）で組む。src は馬（horse_model.gd）：オーラの粒をその体の表面から出す。
## 先に馬へ add_child してから呼ぶ（体の頂点をこの組の座標へ写すのに、木の中の位置が要る）。
func setup(k: String, fx: Dictionary, seed: int, src: Node3D = null) -> void:
	kind = k
	rng.seed = seed
	cols = {color = Color(fx.color), glow = Color(fx.glow), core = Color(fx.core), dark = DARK, deep = Color(fx.get("deep", fx.glow)), hit = Color(fx.get("hit", "#a8ff5c"))}
	thu_seed = seed
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
			# アニメ調の竜巻（ゲームの makeTornado3d と同じ形）。光の柱の代わり
			_tornado_setup()
		"comet":
			# 宇宙のエネルギーの彗星（ゲームの makeComet3d と同じ形）。光の柱の代わり
			_comet_setup()
		"star":
			var t := _soft_parts("star5", 40, [0.9, 1.6], Vector3(1.6, 1.2, 1.8), 0.8, 0.4, [0.3, 0.7], cols.core, true)
			t.tangential_accel_min = 3.0
			t.tangential_accel_max = 5.0
			t.color_ramp = _ramp([cols.core, cols.color])
			_add(t)
		"thunder":
			# 頭の矢じりから長い筋が後ろへ流れる稲妻（ゲームの makeThunder3d と同じ形）。光の柱の代わり
			_thunder_setup(src)


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
	# 拡大は画面での見え方（距離 × 画角）で決める。距離だけだと、望遠のカメラで柱と飾りが 4 倍に膨らんで画面を覆った
	var fov := cam.fov if cam else 48.0
	var sc := clampf(d * tan(deg_to_rad(fov) / 2.0) / 13.4, 1.0, 4.0)
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
	if thu_body != null:
		pillar.visible = false
		_thunder_update(minf(1.0, age / 0.05) * (maxf(0.0, 1.0 - (age - end) / 0.6) if age > end else 1.0), cam, sc)
	if tor_mesh != null:
		pillar.visible = false
		_tornado_update(minf(1.0, age / 0.08) * (maxf(0.0, 1.0 - (age - end) / 0.6) if age > end else 1.0), cam)
	if com_shells.size() > 0:
		pillar.visible = false
		_comet_update(minf(1.0, age / 0.08) * (maxf(0.0, 1.0 - (age - end) / 0.6) if age > end else 1.0), cam)


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
				"leaf":
					# 葉：両端の尖った紡錘
					a = 1.0 if absf(py) < 0.42 * (1.0 - px * px) else 0.0
				"line":
					# 白い細い風の弧：長さの向き（x）に頭が明るく尾が消え、幅の向き（y）の真ん中だけ
					var lx := (px + 1.0) / 2.0
					a = (clampf(1.0 - absf(py) * 4.0, 0.0, 1.0)) * smoothstep(0.0, 0.8, lx) * (1.0 - smoothstep(0.85, 1.0, lx))
				"column":
					a = clampf((py + 1.0) / 2.0, 0.0, 1.0)
					a = a * a
			img.set_pixel(x, y, Color(1, 1, 1, a))
	var t := ImageTexture.create_from_image(img)
	_tex[shape] = t
	return t


# ------------------------------------------------------------------ 疾風の竜巻
## 走る向きに寝た漏斗（鼻先の前で細く尾の後ろへ開く）の面を、ちぎれた縁のミントの帯（芯の白・主の色・光の色の縁をくっきり塗り分けた布）が巻いて回る。
## 帯は毎コマ ImmediateMesh で置き直す（回りながら半径と軸の位置がうねる）。
const TOR_N := 30
const TOR_ZF := 1.9    # 竜巻の先（鼻先の前）
const TOR_LZ := 5.4    # 竜巻の長さ（尾の後ろまで）
const TOR_CY := 1.35   # 軸の高さ（胴）
const LEAF_COLS := [Color("#5fbf3f"), Color("#3f8f2a"), Color("#8fd65a"), Color("#2f6b22")]


func _tor_mat(tex: Texture2D, order: int, depth := true) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.albedo_texture = tex
	m.vertex_color_use_as_albedo = true
	m.no_depth_test = not depth
	m.render_priority = order
	return m


func _tor_quad(tex: Texture2D, col: Color, order: int, depth := true, parent: Node3D = null) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var qm := QuadMesh.new()
	var m := _tor_mat(tex, order, depth)
	m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	m.billboard_keep_scale = true
	m.albedo_color = col
	qm.material = m
	mi.mesh = qm
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	(parent if parent != null else deco).add_child(mi)
	return mi


func _tornado_setup() -> void:
	tor_mesh = MeshInstance3D.new()
	tor_mesh.mesh = ImmediateMesh.new()
	tor_mesh.material_override = _tor_mat(_ribbon_texture(), 1)
	tor_mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	deco.add_child(tor_mesh)
	tor_line = MeshInstance3D.new()
	tor_line.mesh = ImmediateMesh.new()
	tor_line.material_override = _tor_mat(_texture("line"), 2)
	tor_line.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	deco.add_child(tor_line)
	for i in 8:
		tor_ribbons.append({phi = i * 2.399 + rng.randf() * TAU, w = 7.5 + rng.randf() * 2.5, y0 = (i / 8.0) * 0.72 + rng.randf() * 0.06, span = 0.85 * PI + rng.randf() * 0.4, thick = 1.7, i = i, line = false})
	for i in 4:
		tor_ribbons.append({phi = rng.randf() * TAU, w = 10.0 + rng.randf() * 3.0, y0 = 0.2 + rng.randf() * 0.6, span = 1.3, thick = 0.07, i = 10 + i, line = true})
	for i in 3:
		# 輪は毎コマ置き直す帯（平たい円盤だと横から見て線になった。帯の幅の向きは _width_dir で見る角度に合わせる）
		var mi := MeshInstance3D.new()
		mi.mesh = ImmediateMesh.new()
		var m := _tor_mat(null, 0, false)
		m.vertex_color_use_as_albedo = false
		m.albedo_color = cols.color if i == 1 else Color.WHITE
		mi.material_override = m
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		deco.add_child(mi)
		tor_rings.append(mi)
	for i in 10:
		tor_dust.append({q = _tor_quad(_texture("soft"), Color("#c9d3cf"), 0), a = rng.randf() * TAU, b = rng.randf(), c = rng.randf(), d = rng.randf()})
	for i in 36:
		var speck := i % 3 == 2
		var q := _tor_quad(_texture("streak") if speck else _texture("leaf"), Color("#152018") if speck else LEAF_COLS[i % 4], 2)
		tor_leaves.append({q = q, speck = speck, a = rng.randf() * TAU, b = rng.randf(), c = rng.randf(), d = rng.randf(), e = rng.randf()})
	tor_burst = _tor_quad(_burst_texture(), Color.WHITE, 5, false)
	tor_burst.position = Vector3(0, 1.5, 0)


func _ease(x: float) -> float:
	return 1.0 - pow(1.0 - clampf(x, 0.0, 1.0), 3.0)


## 帯の幅の向き：面が見えている角度では axial（漏斗の壁なら軸の向き、輪なら外向き）、真横向き（面がカメラに沿う）に近づくほど
## カメラへ面を向けた向きへ移す（ゲームの makeTornado3d の widthDir と同じ）。軸の向きだけだと、正面のカメラで帯が細い輪の線になった
func _width_dir(p: Vector3, tangent: Vector3, normal: Vector3, axial: Vector3, cl: Vector3, prev: Vector3) -> Vector3:
	var vw := (cl - p).normalized()
	var k := smoothstep(0.12, 0.55, absf(normal.dot(vw)))
	var c := tangent.cross(vw)
	if c.length_squared() < 1e-8:
		c = prev
	c = c.normalized()
	# 向きの符号は前の点にそろえる（そろえないと帯がねじれて途中で細る）
	if c.dot(prev) < 0.0:
		c = -c
	return c.lerp(axial, k).normalized()


func _tornado_update(fade: float, cam: Camera3D = null) -> void:
	var cl := deco.to_local(cam.global_position) if cam else Vector3(30, 2, 0)
	# 横向きの竜巻：軸は馬の前後（z、前が +z）に胴の高さで通し、鼻先の前（an＝0）で細く、尾の後ろ（an＝1）へ開く（ゲームの makeTornado3d と同じ）
	var T := age
	var grow := _ease(T / 0.35)
	var open := smoothstep(LIFE - 0.8, LIFE, T)
	var alpha := fade * (1.0 - open * 0.9)
	var r_of := func(an: float) -> float:
		return 0.6 + (1.65 * (1.0 + open * 0.3) - 0.6) * pow(maxf(0.0, an), 1.2)
	var at := func(an: float, th: float, r: float) -> Vector3:
		# 下側は地面の下へ潜らないよう高さを抑える
		return Vector3(sin(th) * r, maxf(0.05, TOR_CY + cos(th) * r * 0.85), TOR_ZF - an * TOR_LZ * grow)
	for which in [tor_mesh, tor_line]:
		var im: ImmediateMesh = which.mesh
		im.clear_surfaces()
		im.surface_begin(Mesh.PRIMITIVE_TRIANGLES)
		for rb in tor_ribbons:
			if rb.line != (which == tor_line):
				continue
			var prev := []
			var ps: Array[Vector3] = []
			var hws: Array[float] = []
			var ths: Array[float] = []
			for j in TOR_N + 1:
				var q := float(j) / TOR_N
				var th: float = rb.phi + rb.w * T + q * rb.span
				var an := minf(1.05, rb.y0 + q * (0.05 if rb.line else 0.32) + 0.035 * sin(th * 2.0 + T * 6.0))
				var rr: float = r_of.call(an) * (1.2 if rb.line else 1.0 + 0.07 * sin(th * 3.0 + T * 5.0 + rb.i))
				var taper := 1.0 if rb.line else smoothstep(0.0, 0.35, q) * (1.0 - smoothstep(0.88, 1.0, q) * 0.7)
				var torn := 1.0 if rb.line else 0.8 + 0.14 * sin(q * 23.0 + T * 11.0 + rb.i * 1.7) * sin(q * 9.0 - T * 4.0) + 0.06 * sin(q * 61.0 + rb.i * 3.0 + T * 17.0)
				hws.append(rb.thick * (1.0 if rb.line else 0.45 + an * 0.55) * taper * torn * 0.5)
				ths.append(th)
				ps.append(at.call(an, th, rr))
			var wprev := Vector3(0, 0, 1)
			for j in TOR_N + 1:
				var q := float(j) / TOR_N
				var p: Vector3 = ps[j]
				var hw: float = hws[j]
				# 帯の幅：面が見えていれば軸の向き（z）、真横向きに近いほどカメラへ面を向ける
				var tg: Vector3 = ps[mini(TOR_N, j + 1)] - ps[maxi(0, j - 1)]
				var nrm := Vector3(sin(ths[j]), cos(ths[j]) / 0.85, 0).normalized()
				var w := _width_dir(p, tg, nrm, Vector3(0, 0, 1), cl, wprev)
				wprev = w
				var cur := [p + w * hw, p - w * hw * 0.8, q]
				if not prev.is_empty():
					var c := Color(1, 1, 1, alpha * (0.85 if rb.line else 0.92))
					for v in [[prev[0], prev[2], 1.0], [prev[1], prev[2], 0.0], [cur[0], q, 1.0], [prev[1], prev[2], 0.0], [cur[1], q, 0.0], [cur[0], q, 1.0]]:
						im.surface_set_color(c)
						im.surface_set_uv(Vector2(v[1], 1.0 - v[2]))
						im.surface_add_vertex(v[0])
				prev = cur
		im.surface_end()
	# 衝撃波の輪：軸を囲む輪が鼻先から後ろへ流れながら広がる
	for i in tor_rings.size():
		var ph := fmod(T * 1.1 + i / 3.0, 1.0)
		var rad: float = r_of.call(ph) * (1.1 + ph * 0.3)
		var mi: MeshInstance3D = tor_rings[i]
		var zc := TOR_ZF - ph * TOR_LZ * grow
		var rim: ImmediateMesh = mi.mesh
		rim.clear_surfaces()
		rim.surface_begin(Mesh.PRIMITIVE_TRIANGLES)
		# 輪の面（軸を向く）が見えていれば外向きの幅（円盤の輪）、横から見るほどカメラへ面を向けた幅へ
		var wprev := Vector3(0, 1, 0)
		var prv := []
		for j in 49:
			var a := float(j) / 48.0 * TAU
			var p := Vector3(sin(a) * rad, TOR_CY + cos(a) * rad * 0.85, zc)
			var w := _width_dir(p, Vector3(cos(a), -sin(a) * 0.85, 0), Vector3(0, 0, 1), Vector3(sin(a), cos(a), 0), cl, wprev)
			wprev = w
			var cur := [p + w * rad * 0.04, p - w * rad * 0.04, float(j) / 48.0]
			if not prv.is_empty():
				_quad(rim, prv, cur, Color.WHITE)
			prv = cur
		rim.surface_end()
		(mi.material_override as StandardMaterial3D).albedo_color.a = (1.0 - ph) * 0.8 * alpha * grow
	# 蹴り上げた土煙が後ろへ流れる
	for d in tor_dust:
		var an: float = fmod(d.b + T * (0.5 + d.c * 0.4), 1.1)
		var q: MeshInstance3D = d.q
		q.position = Vector3(cos(d.a) * 0.6, 0.3 + d.d * 0.3 + an * 0.4, TOR_ZF - (0.25 + an * 0.9) * TOR_LZ * grow)
		var s: float = (0.7 + d.c * 0.9) * (0.6 + 0.6 * an) * (0.6 + 0.4 * grow) * 2.0
		q.scale = Vector3(s, s, 1)
		((q.mesh as QuadMesh).material as StandardMaterial3D).albedo_color.a = 0.4 * alpha * (1.0 - smoothstep(0.8, 1.1, an))
	# 渦に巻かれて後ろへ飛ぶ葉と黒い粒
	for l in tor_leaves:
		var th: float = l.a + T * (5.0 + l.b * 3.0)
		var an: float = fmod(l.c + T * (0.3 + l.d * 0.3), 1.15)
		var rr: float = r_of.call(minf(1.0, an)) * (1.05 + l.e * 0.45)
		var q: MeshInstance3D = l.q
		q.position = at.call(an, th, rr)
		var s: float = 0.22 if l.speck else 0.14 + l.e * 0.1
		q.scale = Vector3(s * (1.0 if l.speck else 1.4), s * (0.2 if l.speck else 1.0), 1)
		((q.mesh as QuadMesh).material as StandardMaterial3D).albedo_color.a = alpha * smoothstep(0.0, 0.1, an) * (1.0 - smoothstep(0.95, 1.15, an))
	# 発動の瞬間（0.3 秒）：白い閃光・トゲの星・黒い集中線
	var qb := T / 0.3
	tor_burst.scale = Vector3.ONE * (2.0 + _ease(qb) * 4.5)
	((tor_burst.mesh as QuadMesh).material as StandardMaterial3D).albedo_color.a = (1.0 - qb) if qb < 1.0 else 0.0


## 竜巻の帯の布（ゲームの ribbonTex と同じ）：長さの向き（u）に尾が消え、幅の向き（v）に 光の色の縁 → 主の色 → 芯の白、縁はちぎれて揺れる
func _ribbon_texture() -> Texture2D:
	var key: String = "ribbon" + (cols.color as Color).to_html()
	if _tex.has(key):
		return _tex[key]
	var W := 256
	var Hh := 64
	var img := Image.create(W, Hh, false, Image.FORMAT_RGBA8)
	for x in W:
		var uu := float(x) / (W - 1)
		var et := 0.1 + 0.07 * (0.5 + 0.5 * sin(uu * 37.0) * sin(uu * 11.0 + 1.0))
		var eb := 0.9 - 0.07 * (0.5 + 0.5 * sin(uu * 29.0 + 2.0) * sin(uu * 13.0))
		var taper := smoothstep(0.0, 0.3, uu) * (1.0 - 0.6 * smoothstep(0.9, 1.0, uu))
		for y in Hh:
			var v := float(y) / (Hh - 1)
			var edge := minf(v - et, eb - v) * Hh
			if edge <= -1.0:
				img.set_pixel(x, y, Color(0, 0, 0, 0))
				continue
			var d := absf(v - (et + eb) / 2.0) / ((eb - et) / 2.0)
			var col: Color = cols.core if d < 0.5 else (cols.color if d < 0.86 else cols.glow)
			var a := 0.95 if d < 0.5 else (0.85 if d < 0.86 else 0.72)
			img.set_pixel(x, y, Color(col, a * taper * clampf(edge + 1.0, 0.0, 1.0)))
	var t := ImageTexture.create_from_image(img)
	_tex[key] = t
	return t


## 発動の閃光の布：黒い集中線・主の色と白のトゲの星・白い芯
func _burst_texture() -> Texture2D:
	var key: String = "burst" + (cols.color as Color).to_html()
	if _tex.has(key):
		return _tex[key]
	var S := 128
	var m := S / 2.0
	var img := Image.create(S, S, false, Image.FORMAT_RGBA8)
	var br := RandomNumberGenerator.new()
	br.seed = 77
	var lines := []
	for i in 18:
		lines.append([br.randf() * TAU, 0.35 + br.randf() * 0.4, (1.5 + br.randf() * 3.0) / 128.0])
	var spikes := []
	for i in 14:
		spikes.append(0.45 + 0.35 * br.randf())
	for y in S:
		for x in S:
			var px := (x + 0.5 - m) / m
			var py := (y + 0.5 - m) / m
			var r := sqrt(px * px + py * py)
			var ang := fposmod(atan2(py, px) - 0.2, TAU)
			var c := Color(0, 0, 0, 0)
			for l in lines:
				var da := absf(wrapf(ang + 0.2 - l[0], -PI, PI))
				if r > 0.98 - l[1] and r < 0.98 and da * r < l[2] * 2.0 * (r - (0.98 - l[1])) / l[1]:
					c = Color(0.05, 0.08, 0.07, 0.9)
			# トゲの星：14 本。トゲの間は細く
			var seg := ang / TAU * 14.0
			var k := absf(fposmod(seg, 1.0) - 0.5) * 2.0
			var tip: float = spikes[int(seg) % 14]
			if r < lerpf(tip, 0.1, k):
				c = Color(cols.color, 1.0)
			if r < lerpf(tip * 0.6, 0.06, k):
				c = Color(cols.core, 1.0)
			if r < 0.42:
				var g := 1.0 - r / 0.42
				c = c.lerp(Color(1, 1, 1, 1), g)
				c.a = maxf(c.a, g)
			img.set_pixel(x, y, c)
	var t := ImageTexture.create_from_image(img)
	_tex[key] = t
	return t


# ------------------------------------------------------------------ 流星
## 宇宙のエネルギーの彗星（ゲームの makeComet3d と同じ）：馬を包む光の殻（鼻先の前で丸く、尾へ細る）と、後ろへ伸びる光の帯の尾、
## 走る光の筋、四芒星、鼻先の光、発動の閃光。殻はシェーダで縁ほど明るい膜（フレネル）にし、縁の光と中の流れを段で塗る（セル調）。
## 殻は深度を見る（馬の向こう側の殻は馬に隠れ、手前の殻は透けて馬が見える）。
const COM_ZN := 2.05   # 殻の鼻先
const COM_L := 5.4     # 殻の長さ
const COM_CY := 1.35   # 軸の高さ
const COM_RX := 1.05   # 殻の幅（半径）
const COM_RY := 1.5    # 殻の高さ（半径）
const COM_DARK := Color("#5a1fc8")
const COM_TN := 20
static var _com_mesh: ArrayMesh
static var _com_shader := {}


## 殻の断面の半径（q＝0 鼻先 〜 1 尾の付け根。ゲームの shellH と同じ）
static func _shell_h(q: float) -> float:
	return sqrt(clampf(q / 0.2, 0.0, 1.0)) * (1.0 - 0.12 * smoothstep(0.2, 0.55, q)) * pow(1.0 - smoothstep(0.45, 1.0, q), 0.9)


## 長さ 1（z＝0 が鼻先、−z へ尾）・半径 1 の殻。uv.x＝鼻先からの割合、uv.y＝周の割合。法線は回転面の外向き
static func _comet_mesh() -> ArrayMesh:
	if _com_mesh != null:
		return _com_mesh
	var NQ := 48
	var NA := 40
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var uv := PackedVector2Array()
	var idx := PackedInt32Array()
	for i in NQ + 1:
		var q := pow(float(i) / NQ, 1.35)
		var r := maxf(0.002, _shell_h(q))
		var dr := (_shell_h(minf(1.0, q + 0.002)) - _shell_h(maxf(0.0, q - 0.002))) / 0.004
		for j in NA + 1:
			var a := float(j) / NA * TAU
			v.append(Vector3(cos(a) * r, sin(a) * r, -q))
			n.append(Vector3(cos(a), sin(a), dr).normalized())
			uv.append(Vector2(q, float(j) / NA))
	for i in NQ:
		for j in NA:
			var a := i * (NA + 1) + j
			var b := a + NA + 1
			idx.append_array([a, a + 1, b, a + 1, b + 1, b])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = v
	arr[Mesh.ARRAY_NORMAL] = n
	arr[Mesh.ARRAY_TEX_UV] = uv
	arr[Mesh.ARRAY_INDEX] = idx
	_com_mesh = ArrayMesh.new()
	_com_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return _com_mesh


static func _comet_shader(add: bool) -> Shader:
	if _com_shader.has(add):
		return _com_shader[add]
	var sh := Shader.new()
	sh.code = """
shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, %s;
uniform vec4 c_core : source_color;
uniform vec4 c_color : source_color;
uniform vec4 c_glow : source_color;
uniform vec4 c_deep : source_color;
uniform vec4 c_dark : source_color;
uniform float u_time;
uniform float u_fade;
uniform float u_layer;
uniform float u_wob;
varying vec2 vuv;
void vertex() {
	vuv = UV;
	float q = UV.x;
	float a = UV.y * 6.2831853;
	// 縁のうねり（後ろへ流れる。大きくゆっくり）
	VERTEX.xy *= 1.0 + u_wob * (0.045 * sin(q * 9.0 - u_time * 6.0 + a * 2.0) + 0.015 * sin(q * 23.0 - u_time * 11.0 + a * 3.0));
}
void fragment() {
	float q = vuv.x;
	float a = vuv.y * 6.2831853;
	float fr = 1.0 - abs(dot(normalize(NORMAL), normalize(VIEW)));
	// 縁の光を段で（セル調）：外の縁ほど明るい 3 段
	float rim = 0.35 * smoothstep(0.42, 0.46, fr) + 0.35 * smoothstep(0.66, 0.7, fr) + 0.3 * smoothstep(0.86, 0.9, fr);
	vec3 col = mix(c_color.rgb, c_glow.rgb, smoothstep(0.22, 0.7, q));
	col = mix(col, c_deep.rgb, smoothstep(0.7, 1.0, q));
	col = mix(c_core.rgb, col, smoothstep(0.0, 0.16, q));
	// 殻の中の流れ：うねる縞が後ろへ流れる（明るい筋と濃い紫の溝）
	float f = sin(q * 15.0 - u_time * 5.0 + sin(a * 2.0 + u_time * 1.3) * 1.4 + a);
	col = mix(col, c_core.rgb, step(0.62, f) * 0.5 * (1.0 - q));
	col = mix(col, c_dark.rgb, step(f, -0.7) * 0.6);
	col = mix(col, c_core.rgb, smoothstep(0.86, 0.9, fr) * smoothstep(0.8, 0.1, q) * 0.7);
	float body = (1.0 - smoothstep(0.5, 1.0, q)) * smoothstep(0.0, 0.015, q);
	float tip = (1.0 - smoothstep(0.0, 0.1, q)) * (0.2 + 0.8 * smoothstep(0.2, 0.7, fr));
	float flow = step(0.62, f) * 0.35 * (1.0 - q);
	float al = u_layer < 0.5 ? (0.11 + 0.8 * rim + flow) * body + 0.6 * tip : (0.08 + 0.55 * rim + flow) * body + 0.3 * tip;
	ALBEDO = col;
	ALPHA = clamp(al, 0.0, 1.0) * u_fade;
}
""" % ("blend_add" if add else "blend_mix")
	_com_shader[add] = sh
	return sh


func _comet_setup() -> void:
	add_child(com_root)
	# 殻：外の膜（普通の合成で色を残す）と、鼻先の入れ子の桃・芯（加算で光らせる）
	for d in [[0, false, 1.0, 1.0, 0.0, 1.0], [1, true, 0.72, 0.55, 0.22, 0.75], [1, true, 0.45, 0.32, 0.42, 0.6]]:
		var mi := MeshInstance3D.new()
		mi.mesh = _comet_mesh()
		var m := ShaderMaterial.new()
		m.shader = _comet_shader(d[1])
		m.set_shader_parameter("c_core", cols.core)
		m.set_shader_parameter("c_color", cols.color)
		m.set_shader_parameter("c_glow", cols.glow)
		m.set_shader_parameter("c_deep", cols.deep)
		m.set_shader_parameter("c_dark", COM_DARK)
		m.set_shader_parameter("u_layer", float(d[0]))
		m.set_shader_parameter("u_wob", 1.6 if d[0] == 1 else 1.0)
		m.render_priority = 1 + com_shells.size()
		mi.material_override = m
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		com_root.add_child(mi)
		com_shells.append({mi = mi, hs = d[2], len = d[3], s0 = d[4], op = d[5]})
	# 尾：カメラへ向く光の帯（普通の合成と加算の 2 組）。付け根は殻の後ろ半分、後ろほど軸へ寄って少し上がる
	for add in [false, true]:
		var tm := MeshInstance3D.new()
		tm.mesh = ImmediateMesh.new()
		var m := _tor_mat(_comet_tail_texture(), 0)
		if add:
			m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		tm.material_override = m
		tm.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		com_root.add_child(tm)
		com_tail.append(tm)
	for i in 12:
		var a := rng.randf() * TAU
		var rr := sqrt(rng.randf()) * 0.75
		com_tails.append({ox = cos(a) * rr, oy = sin(a) * rr, q0 = 0.32 + rng.randf() * 0.3, len = 5.0 + rng.randf() * 6.0, w = 0.16 + rng.randf() * 0.3, ph = rng.randf() * TAU, add = i % 3 == 0})
	# 走る光の筋（馬のまわりを後ろへ飛ぶ。カメラへ向けた帯なので、どこから見ても走る向きに寝る）
	com_lines_mesh = MeshInstance3D.new()
	com_lines_mesh.mesh = ImmediateMesh.new()
	var lm := _tor_mat(_texture("line"), 4, false)
	lm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	com_lines_mesh.material_override = lm
	com_lines_mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	com_root.add_child(com_lines_mesh)
	for i in 26:
		var a := rng.randf() * TAU
		var rad := 1.6 + rng.randf() * 4.5
		com_lines.append({x = cos(a) * rad, y = maxf(0.2, COM_CY + sin(a) * rad * 0.6), z0 = rng.randf(), v = 18.0 + rng.randf() * 16.0, len = 2.0 + rng.randf() * 4.0, col = [cols.core, cols.color, cols.deep][i % 3]})
	# 四芒星（殻と尾に散らして、後ろへ流れながら瞬く）
	for i in 30:
		var q := _tor_quad(_texture("star"), cols.color if i % 3 else cols.core, 3, false, com_root)
		(q.mesh as QuadMesh).material.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		com_sparks.append({q = q, a = rng.randf() * TAU, rr = 0.4 + rng.randf() * 0.9, ph = rng.randf(), v = 0.15 + rng.randf() * 0.35, sz = 0.2 + rng.randf() * 0.35, tw = rng.randf() * TAU})
	# 鼻先の光の玉（普通の合成で桃色に。加算だと明るい芝の前で白に飛ぶ）と、発動の閃光
	com_nose = _tor_quad(_texture("soft"), cols.color, 3, false, com_root)
	com_flare = _tor_quad(_comet_flare_texture(), Color.WHITE, 5, false, com_root)
	(com_flare.mesh as QuadMesh).material.blend_mode = BaseMaterial3D.BLEND_MODE_ADD


func _comet_update(fade: float, cam: Camera3D) -> void:
	var T := age
	var grow := _ease(T / 0.32)
	var tail := _ease(T / 0.7)
	var cl := com_root.to_local(cam.global_position) if cam else Vector3(30, 2, 0)
	# カメラが殻の中（騎手視点）か殻のすぐ前（ゴール前の正面）なら殻を薄める（画面いっぱいの桃色の膜になった）
	var zq := (COM_ZN - cl.z) / COM_L
	var inside := 9.0
	if zq > -0.1 and zq < 1.0:
		inside = (pow(cl.x / COM_RX, 2.0) + pow((cl.y - COM_CY) / COM_RY, 2.0)) / maxf(0.05, pow(_shell_h(clampf(zq, 0.0, 1.0)), 2.0))
	var dc := Vector3(cl.x, cl.y - COM_CY, cl.z - (COM_ZN - COM_L * 0.35)).length()
	var shell_k := smoothstep(1.2, 2.2, inside) * smoothstep(4.5, 8.0, dc)
	for s in com_shells:
		var g := 0.25 + 0.75 * grow
		var mi: MeshInstance3D = s.mi
		mi.position = Vector3(0, COM_CY, COM_ZN - s.s0)
		mi.scale = Vector3(COM_RX * s.hs * g, COM_RY * s.hs * g, COM_L * s.len * (0.3 + 0.7 * grow))
		var m: ShaderMaterial = mi.material_override
		m.set_shader_parameter("u_time", T)
		m.set_shader_parameter("u_fade", fade * s.op * shell_k)
	# 尾の帯（後ろへ流れながら揺れる。カメラへ面を向ける）
	for k in 2:
		var im: ImmediateMesh = com_tail[k].mesh
		im.clear_surfaces()
		im.surface_begin(Mesh.PRIMITIVE_TRIANGLES)
		for t in com_tails:
			if t.add != (k == 1):
				continue
			var zs: float = COM_ZN - t.q0 * COM_L
			var ln: float = t.len * tail
			var prev := []
			for j in COM_TN + 1:
				var q := float(j) / COM_TN
				var k1 := 1.0 - q * 0.5
				var p := Vector3(t.ox * COM_RX * k1 + 0.08 * sin(q * 5.0 - T * 3.0 + t.ph), COM_CY + t.oy * COM_RY * k1 + q * ln * 0.09 + 0.08 * sin(q * 4.0 - T * 2.5 + t.ph), zs - q * ln)
				var d := Vector3(0, 0.09, -1).normalized()
				var tw: float = t.w
				var side: Vector3 = (cl - p).cross(d).normalized() * tw * pow(1.0 - q, 0.6) * (0.85 + 0.15 * sin(q * 13.0 - T * 9.0 + t.ph))
				var cur := [p + side, p - side, q]
				if not prev.is_empty():
					_quad(im, prev, cur, Color(1, 1, 1, fade * (0.7 if t.add else 0.85)))
				prev = cur
		im.surface_end()
	# 走る光の筋（後ろへ飛ぶ。頭が前）
	var lim: ImmediateMesh = com_lines_mesh.mesh
	lim.clear_surfaces()
	# 描く筋が 1 本も無いコマは面を作らない（頂点の無い面は Godot がエラーを出す）
	var any_line := false
	for l in com_lines:
		var z: float = 9.0 - fmod(l.z0 * 22.0 + T * l.v, 22.0)
		var a := Vector3(l.x, l.y, z - l.len)
		var b := Vector3(l.x, l.y, z)
		var near := clampf((b.distance_to(cl) - 2.5) / 5.0, 0.0, 1.0)
		var op := fade * 0.85 * smoothstep(9.0, 6.0, z) * smoothstep(-13.0, -8.0, z) * near
		if op <= 0.01:
			continue
		if not any_line:
			lim.surface_begin(Mesh.PRIMITIVE_TRIANGLES)
			any_line = true
		var ll: float = l.len
		var sd: Vector3 = (cl - b).cross(Vector3(0, 0, 1)).normalized() * ll * 0.06
		_quad(lim, [a + sd, a - sd, 0.0], [b + sd, b - sd, 1.0], Color(l.col, op))
	if any_line:
		lim.surface_end()
	for s in com_sparks:
		var q: float = fmod(s.ph + T * s.v, 1.5)
		var rr: float = s.rr * (_shell_h(minf(1.0, q)) if q < 1.0 else 0.6)
		var qd: MeshInstance3D = s.q
		qd.position = Vector3(cos(s.a) * rr * COM_RX, COM_CY + sin(s.a) * rr * COM_RY, COM_ZN - q * COM_L)
		var tw := 0.5 + 0.5 * sin(T * 9.0 + s.tw)
		qd.scale = Vector3.ONE * s.sz * (0.6 + 0.4 * tw)
		((qd.mesh as QuadMesh).material as StandardMaterial3D).albedo_color.a = fade * (0.5 + 0.5 * tw) * (1.0 - smoothstep(1.1, 1.5, q)) * clampf((qd.position.distance_to(cl) - 2.0) / 4.0, 0.0, 1.0)
	com_nose.position = Vector3(0, COM_CY, COM_ZN - 0.25)
	com_nose.scale = Vector3.ONE * 2.6 * (0.4 + 0.6 * grow)
	((com_nose.mesh as QuadMesh).material as StandardMaterial3D).albedo_color.a = 0.6 * fade * shell_k
	# 発動の瞬間（0.35 秒）：鼻先の閃光と十字の光芒
	var fq := T / 0.35
	com_flare.position = Vector3(0, COM_CY, COM_ZN)
	com_flare.scale = Vector3((3.0 + _ease(fq) * 6.0) * 1.6, 3.0 + _ease(fq) * 6.0, 1)
	((com_flare.mesh as QuadMesh).material as StandardMaterial3D).albedo_color.a = (1.0 - fq) * smoothstep(3.0, 7.0, dc) if fq < 1.0 else 0.0


## 帯の 1 区間（prev・cur は [左, 右, u]）を 2 つの三角形で
func _quad(im: ImmediateMesh, prev: Array, cur: Array, c: Color) -> void:
	for v in [[prev[0], prev[2], 1.0], [prev[1], prev[2], 0.0], [cur[0], cur[2], 1.0], [prev[1], prev[2], 0.0], [cur[1], cur[2], 0.0], [cur[0], cur[2], 1.0]]:
		im.surface_set_color(c)
		im.surface_set_uv(Vector2(v[1], v[2]))
		im.surface_add_vertex(v[0])


## 尾の帯の布（ゲームの cometTailTex と同じ）：長さの向き（u）に 芯 → 主の色 → 光の色 → 青紫 と移って消え、幅の向き（v）は
## くっきりした縁（ちぎれてうねる）と明るい芯の線
func _comet_tail_texture() -> Texture2D:
	var key: String = "ctail" + (cols.color as Color).to_html()
	if _tex.has(key):
		return _tex[key]
	var W := 256
	var Hh := 32
	var img := Image.create(W, Hh, false, Image.FORMAT_RGBA8)
	var stops := [[0.0, cols.core], [0.12, cols.color], [0.45, cols.glow], [1.0, cols.deep]]
	for x in W:
		var uu := float(x) / (W - 1)
		var j := 0
		while j < stops.size() - 2 and uu > stops[j + 1][0]:
			j += 1
		var tt := clampf((uu - stops[j][0]) / (stops[j + 1][0] - stops[j][0]), 0.0, 1.0)
		var col: Color = (stops[j][1] as Color).lerp(stops[j + 1][1], tt)
		var along := smoothstep(0.0, 0.06, uu) * pow(1.0 - uu, 1.1)
		var half := 0.42 + 0.06 * sin(uu * 31.0) * sin(uu * 7.0 + 1.0)
		for y in Hh:
			var v := absf(float(y) / (Hh - 1) - 0.5)
			var inside := clampf((half - v) * Hh * 0.7, 0.0, 1.0)
			var core := 1.0 if v < 0.09 else 0.0
			var c := Color(minf(1.0, col.r + core * 0.35), minf(1.0, col.g + core * 0.35), minf(1.0, col.b + core * 0.24), along * inside * (0.6 + 0.4 * core))
			img.set_pixel(x, y, c)
	var t := ImageTexture.create_from_image(img)
	_tex[key] = t
	return t


## 発動の閃光の布：白い芯・十字の光芒（横に長く）・斜めの短い光・主の色の輪
func _comet_flare_texture() -> Texture2D:
	var key: String = "cflare" + (cols.color as Color).to_html()
	if _tex.has(key):
		return _tex[key]
	var S := 128
	var m := S / 2.0
	var img := Image.create(S, S, false, Image.FORMAT_RGBA8)
	for y in S:
		for x in S:
			var px := (x + 0.5 - m) / m
			var py := (y + 0.5 - m) / m
			var r := sqrt(px * px + py * py)
			var a := pow(clampf(1.0 - r / 0.5, 0.0, 1.0), 1.5)
			var col: Color = Color.WHITE.lerp(cols.color, clampf(r / 0.5, 0.0, 1.0))
			# 十字と斜め（細い線、端で消える）
			for ln in [[1.0, 0.0, 1.0, 0.045], [0.0, 1.0, 0.55, 0.035], [0.7071, 0.7071, 0.28, 0.02], [0.7071, -0.7071, 0.28, 0.02]]:
				var along: float = absf(px * ln[0] + py * ln[1])
				var across: float = absf(-px * ln[1] + py * ln[0])
				var la: float = clampf(1.0 - across / ln[3], 0.0, 1.0) * clampf(1.0 - along / ln[2], 0.0, 1.0)
				a = maxf(a, la)
			# 主の色の輪（横長の楕円）
			var e := sqrt(px * px / 0.72 + py * py / 0.25)
			var ring := clampf(1.0 - absf(e - 1.0) * 30.0, 0.0, 1.0) * 0.9
			if ring > a:
				col = cols.color
			a = maxf(a, ring)
			img.set_pixel(x, y, Color(col, a))
	var t := ImageTexture.create_from_image(img)
	_tex[key] = t
	return t


# ------------------------------------------------------------------ イナズマ
## ゲームの makeThunder3d と同じ形（参考の絵：緑に光る矢じりの頭から、長い筋が不規則に曲がりながら後ろへ流れ、先は針に細る）。
## 頭（毎コマ頭の組から求める）に矢じり（上下左右へ開いて後ろへ曲がる 4 本の弧）と緑の光、そこから胴と騎手を包む筋が尾の後ろへ流れ、
## いちばん太い 1 本は遠く後ろまで伸びる。筋はカメラへ面を向ける帯で、縁を一定の太さ（m）で塗る：細い所は明るい線、
## 幅の広い所だけ暗い青緑の中抜き（縁を帯の幅の割合で塗ると、細い所まで暗い芯が出て茨に見えた）。
## 拡大しない組（thu_root）に置き、太さだけ √ 倍にする（拡大すると望遠のカメラで太い筋が白い柱になり、隣の馬まで呑み込んだ）。
const THU_HEAD := Vector3(0, 2.0, 1.55)   # 頭の組が無いときの頭の位置
const THU_RE := 0.09     # 形を作り直す間隔（秒）
const THU_RIM := 0.032   # 縁の太さ（m）
var thu_root := Node3D.new()
var thu_seed := 1
var thu_body: MeshInstance3D
var thu_glow: MeshInstance3D
var thu_bolts: Array = []
var thu_ends: Array = []
var thu_head: Node3D
var thu_headc := Vector3.ZERO
var thu_o := THU_HEAD
var thu_orb: MeshInstance3D
var thu_core: MeshInstance3D
var thu_flash: MeshInstance3D
static var _thu_shader := {}


## 帯のシェーダ。UV.x は帯の半分の幅（m。縁を一定の太さで塗る）、UV.y は幅の向き、UV2.x は頭の近さ（緑がかる）、UV2.y は濃さ。
## 頂点色で渡さないのは、色空間の変換を受けると値がずれるため
static func _thunder_shader(glow: bool) -> Shader:
	if _thu_shader.has(glow):
		return _thu_shader[glow]
	var sh := Shader.new()
	sh.code = """
shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, %s;
uniform vec4 c_rim : source_color;
uniform vec4 c_deep : source_color;
uniform vec4 c_core : source_color;
uniform vec4 c_hit : source_color;
uniform vec4 c_glow : source_color;
uniform float u_fade;
uniform float u_glow;
uniform float u_rim;
void fragment() {
	float d = abs(UV.y - 0.5) * 2.0;
	float tint = UV2.x;
	vec3 col;
	float a;
	if (u_glow > 0.5) {
		col = mix(c_glow.rgb, c_hit.rgb, tint);
		a = pow(max(0.0, 1.0 - d), 2.2) * 0.45;
	} else {
		float edge = (1.0 - d) * UV.x;
		float rim = 1.0 - smoothstep(u_rim * 0.7, u_rim, edge);
		vec3 inner = mix(c_deep.rgb, mix(c_deep.rgb, c_hit.rgb, 0.55), tint);
		col = mix(inner, mix(c_rim.rgb, c_hit.rgb, tint * 0.6), rim);
		col = mix(col, c_core.rgb, (1.0 - smoothstep(u_rim * 0.25, u_rim * 0.6, edge)) * 0.35);
		a = smoothstep(0.0, u_rim * 0.25, edge) * mix(0.86, 1.0, rim);
	}
	ALBEDO = col;
	ALPHA = a * u_fade * UV2.y;
}
""" % ("blend_add" if glow else "blend_mix")
	_thu_shader[glow] = sh
	return sh


func _thunder_setup(src: Node3D) -> void:
	add_child(thu_root)
	# 頭の組（項が原点）と、その中の頭の形の中心。毎コマ頭の位置を求める（首と一緒に揺れる）
	if src != null and "head" in src and src.get("head") != null:
		thu_head = src.get("head")
		for mi in thu_head.find_children("*", "MeshInstance3D", true, false):
			if mi.mesh != null:
				thu_headc = thu_head.to_local(mi.to_global(mi.mesh.get_aabb().get_center()))
				break
	for glow in [true, false]:
		var mi := MeshInstance3D.new()
		mi.mesh = ImmediateMesh.new()
		var m := ShaderMaterial.new()
		m.shader = _thunder_shader(glow)
		m.set_shader_parameter("c_rim", cols.color)
		m.set_shader_parameter("c_deep", cols.deep)
		m.set_shader_parameter("c_core", cols.core)
		m.set_shader_parameter("c_hit", cols.hit)
		m.set_shader_parameter("c_glow", cols.glow)
		m.set_shader_parameter("u_glow", 1.0 if glow else 0.0)
		m.set_shader_parameter("u_rim", THU_RIM)
		m.render_priority = 2 if glow else 3
		mi.material_override = m
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		thu_root.add_child(mi)
		if glow:
			thu_glow = mi
		else:
			thu_body = mi
	# 筋の行き先（シードで決めて動かさない）：上（騎手の上）・左右（胴の脇）・下（腹の下）・太い 1 本（遠く後ろ）
	var rs := RandomNumberGenerator.new()
	rs.seed = hash(thu_seed * 131 + 7)
	thu_ends = [
		{to = Vector3((rs.randf() - 0.5) * 0.6, 2.8 + rs.randf() * 0.3, -2.2 - rs.randf() * 0.8), w = 0.15, at = 0.04, main = false},
		{to = Vector3(0.6 + rs.randf() * 0.2, 1.4 + rs.randf() * 0.3, -2.6 - rs.randf() * 0.6), w = 0.13, at = 0.06, main = false},
		{to = Vector3(-0.6 - rs.randf() * 0.2, 1.3 + rs.randf() * 0.3, -2.6 - rs.randf() * 0.6), w = 0.13, at = 0.07, main = false},
		{to = Vector3((rs.randf() - 0.5) * 0.5, 0.35 + rs.randf() * 0.2, -2.0 - rs.randf() * 0.6), w = 0.14, at = 0.05, main = false},
		{to = Vector3((rs.randf() - 0.5) * 1.0, 1.0 + rs.randf() * 0.4, -8.0 - rs.randf() * 3.0), w = 0.26, at = 0.04, main = true},
	]
	thu_orb = _tor_quad(_texture("soft"), cols.hit, 4, false, thu_root)
	thu_core = _tor_quad(_texture("soft"), Color.WHITE, 5, false, thu_root)
	thu_flash = _tor_quad(_thunder_disc_texture(), Color.WHITE, 6, false, thu_root)
	for q in [thu_orb, thu_core, thu_flash]:
		((q as MeshInstance3D).mesh as QuadMesh).material.blend_mode = BaseMaterial3D.BLEND_MODE_ADD


## 筋：from から dir0 の向きに出て to へ向かう。向きは毎歩少し揺れ、ときどき鋭く折れ、行き先へ引き戻される。
## 3 つずつ割って点ごとの太さ（低い周波数でうねり、ときどき幅の広い刃、先は 0 へ細る）
func _thu_strand(r: RandomNumberGenerator, from: Vector3, dir0: Vector3, to: Vector3, W: float, w0: float, blade: float, kink: float) -> Dictionary:
	var L := from.distance_to(to) * 1.05
	var n := 7 + int(r.randf() * 5.0)
	var steps: Array[float] = []
	var sum := 0.0
	for i in n:
		var st := 0.5 + r.randf()
		steps.append(st)
		sum += st
	var pts: Array[Vector3] = [from]
	var p := from
	var dir := dir0.normalized()
	for i in n:
		var tg := (to - p).normalized()
		dir += (tg - dir) * 0.45 + _thu_perp(r, dir, 0.24)
		if r.randf() < kink:
			dir += _thu_perp(r, dir, 0.25 + r.randf() * 0.35)
		dir = dir.normalized()
		p += dir * (steps[i] / sum) * L
		pts.append(p)
	var P: Array[Vector3] = []
	for i in pts.size() - 1:
		for j in 3:
			P.append(pts[i].lerp(pts[i + 1], j / 3.0))
	P.append(pts[pts.size() - 1])
	var ph := r.randf() * TAU
	var fq := 5.0 + r.randf() * 6.0
	var sb := 0.3 + r.randf() * 0.4 if r.randf() < blade else -9.0
	var bw := 1.6 + r.randf() * 1.4
	var ws: Array[float] = []
	for i in P.size():
		var sq := float(i) / (P.size() - 1)
		ws.append(W * (0.62 + 0.38 * sin(sq * fq + ph)) * (1.0 + bw * exp(-pow((sq - sb) / 0.09, 2.0))) * (w0 + (1.0 - w0) * smoothstep(0.0, 0.12, sq)) * pow(1.0 - sq, 0.75))
	return {pts = P, ws = ws}


func _thu_perp(r: RandomNumberGenerator, dir: Vector3, mag: float) -> Vector3:
	var v := Vector3(r.randf() - 0.5, r.randf() - 0.5, r.randf() - 0.5)
	v -= dir * v.dot(dir)
	return v.normalized() * mag if v.length_squared() > 1e-8 else Vector3.ZERO


## 形は THU_RE 秒ごとに同じ乱数で作るが、頭が首と一緒に動くので毎コマ今の頭の位置で組み直す
func _thu_rebuild(fi: int) -> void:
	var r := RandomNumberGenerator.new()
	r.seed = hash(thu_seed * 31 + fi * 977)
	thu_bolts.clear()
	var O := thu_o
	var BACK := Vector3(0, 0, -1)
	# 矢じり：頭から上下左右へ開いて後ろへ曲がる弧（上下を長く、左右は短く）
	for arm in [[0.0, 1.0, 2.2], [0.0, -1.0, 1.7], [1.0, 0.0, 1.2], [-1.0, 0.0, 1.2]]:
		var out := Vector3(arm[0], arm[1], 0)
		var ln: float = arm[2]
		var dir0 := BACK * cos(1.1) + out * sin(1.1)
		var to := O + BACK * ln + out * ln * 0.65
		to.y = maxf(0.2, to.y)
		thu_bolts.append({b = _thu_strand(r, O, dir0, to, 0.22, 0.8, 0.8, 0.1), at = 0.0, dur = 0.08, off = Vector3.ZERO})
	# 筋（と枝）：頭のすぐ後ろから胴を包んで後ろへ
	for e in thu_ends:
		var from := O + BACK * 0.2
		var to: Vector3 = e.to
		var st := _thu_strand(r, from, Vector3(to.x - from.x, (to.y - from.y) * 1.5, -1.0), to, e.w, 0.5, 0.85 if e.main else 0.55, 0.25)
		var off := Vector3(to.x, to.y - 1.45, 0)
		var dur := 0.22 if e.main else 0.16
		thu_bolts.append({b = st, at = e.at, dur = dur, off = off})
		var nb := 2 if e.main else (1 if r.randf() < 0.7 else 0)
		for j in nb:
			var sq := 0.3 + r.randf() * 0.45
			var pts: Array[Vector3] = st.pts
			var ws: Array[float] = st.ws
			var k := maxi(1, int(round(sq * (pts.size() - 1))))
			var p0 := pts[k]
			var d0 := (p0 - pts[k - 1]).normalized()
			var side := Vector3(r.randf() - 0.5, r.randf() - 0.5, r.randf() - 0.5)
			side = (side - d0 * side.dot(d0)).normalized()
			var dir := d0 * cos(0.6) + side * sin(0.6)
			var to2 := p0 + dir * (0.6 + r.randf() * 0.8)
			to2.y = maxf(0.15, to2.y)
			thu_bolts.append({b = _thu_strand(r, p0, dir, to2, minf(0.08, ws[k] * 0.8), 0.9, 0.25, 0.25), at = e.at + dur * sq, dur = 0.08, off = off})


## 帯を書く（カメラへ面を向ける。折れ目は角の二等分の向き）
func _thu_write(im: ImmediateMesh, wmul: float, T: float, cl: Vector3) -> void:
	im.clear_surfaces()
	var begun := false
	for B in thu_bolts:
		var g := clampf((T - B.at) / B.dur, 0.0, 1.0)
		if g <= 0.0:
			continue
		# カメラの側を通る筋は薄く（馬の前を横切って、馬が帯の膜の向こうに隠れる）
		var off: Vector3 = B.off
		var front := 0.0
		if off.length_squared() > 0.0:
			front = clampf((off.x * cl.x + off.y * (cl.y - 1.45)) / maxf(1e-4, off.length() * Vector2(cl.x, cl.y - 1.45).length()) * 1.6, 0.0, 1.0)
		var ba := 1.0 - 0.45 * front
		var pts: Array[Vector3] = B.b.pts
		var ws: Array[float] = B.b.ws
		var n := pts.size()
		var tot := 0.0
		for i in range(1, n):
			tot += pts[i].distance_to(pts[i - 1])
		var lim := tot * g
		var P: Array[Vector3] = []
		var Wd: Array[float] = []
		var acc := 0.0
		for i in n:
			var l := pts[i].distance_to(pts[i - 1]) if i > 0 else 0.0
			if i > 0 and acc + l > lim + 1e-6:
				P.append(pts[i - 1].lerp(pts[i], (lim - acc) / maxf(l, 1e-6)))
				Wd.append(0.0)
				break
			acc += l
			P.append(pts[i])
			Wd.append(ws[i])
		var m := P.size()
		if m < 2:
			continue
		var Ls: Array[Vector3] = []
		var Rs: Array[Vector3] = []
		var Fl: Array[float] = []
		var Wm: Array[float] = []
		for i in m:
			var p := P[i]
			var s1 := p - P[maxi(0, i - 1)]
			var s2 := P[mini(m - 1, i + 1)] - p
			if i == 0:
				s1 = s2
			if i == m - 1:
				s2 = s1
			var v := cl - p
			var t1 := v.cross(s1).normalized()
			var t2 := v.cross(s2).normalized()
			var nrm := t1 + t2
			nrm = t1 if nrm.length_squared() < 1e-6 else nrm.normalized()
			var w := Wd[i] * wmul
			var mm := w / maxf(0.5, nrm.dot(t1))
			Ls.append(p + nrm * mm)
			Rs.append(p - nrm * mm)
			Fl.append(clampf(1.0 - p.distance_to(thu_o) / 1.6, 0.0, 1.0))
			Wm.append(w)
		if not begun:
			im.surface_begin(Mesh.PRIMITIVE_TRIANGLES)
			begun = true
		for i in m - 1:
			for vv in [[Ls[i], i, 1.0], [Rs[i], i, 0.0], [Ls[i + 1], i + 1, 1.0], [Rs[i], i, 0.0], [Rs[i + 1], i + 1, 0.0], [Ls[i + 1], i + 1, 1.0]]:
				var j: int = vv[1]
				im.surface_set_uv(Vector2(Wm[j], vv[2]))
				im.surface_set_uv2(Vector2(Fl[j], ba))
				im.surface_add_vertex(vv[0])
	if begun:
		im.surface_end()


func _thunder_update(fade: float, cam: Camera3D, sc: float) -> void:
	var T := age
	var cl := thu_root.to_local(cam.global_position) if cam else Vector3(30, 2, 0)
	var wW := minf(2.0, sqrt(sc))
	# 頭の位置（頭の形の中心から鼻先寄り。項が頭の組の原点）
	if thu_head != null:
		thu_o = thu_root.to_local(thu_head.to_global(thu_headc * 1.45))
	var fi := int(floor(T / THU_RE))
	_thu_rebuild(fi)
	_thu_write(thu_body.mesh, wW, T, cl)
	_thu_write(thu_glow.mesh, 3.0 * wW, T, cl)
	# カメラがごく近い（騎手視点）と帯が画面を覆うので薄める
	var dc := Vector3(cl.x, cl.y - 1.6, cl.z).length()
	var near_k := 0.3 + 0.7 * smoothstep(2.2, 5.5, dc)
	var fl := 0.85 + 0.15 * float(hash(fi + thu_seed) % 1000) / 1000.0
	for mi in [thu_body, thu_glow]:
		var sm: ShaderMaterial = (mi as MeshInstance3D).material_override
		sm.set_shader_parameter("u_fade", fade * fl * near_k)
		sm.set_shader_parameter("u_rim", THU_RIM * wW)
	var pulse := 0.9 + 0.1 * sin(T * 31.0)
	var a_of := func(q: MeshInstance3D, a: float) -> void:
		((q.mesh as QuadMesh).material as StandardMaterial3D).albedo_color.a = clampf(a, 0.0, 1.0)
	thu_orb.position = thu_o
	thu_orb.scale = Vector3.ONE * 1.1 * pulse * wW
	a_of.call(thu_orb, 0.85 * fade * near_k)
	thu_core.position = thu_o
	thu_core.scale = Vector3.ONE * 0.4 * pulse * wW
	a_of.call(thu_core, 0.9 * fade * near_k)
	# 発動の閃光（頭から。0.25 秒で消える）
	var fq := T / 0.25
	thu_flash.position = thu_o
	thu_flash.scale = Vector3.ONE * (2.0 + _ease(fq) * 5.0) * wW
	a_of.call(thu_flash, (1.0 - fq) * 0.85 * near_k if fq < 1.0 else 0.0)


## 着弾点の光の布：白い芯から黄緑へ、外で消える
func _thunder_disc_texture() -> Texture2D:
	var key: String = "tdisc" + (cols.hit as Color).to_html()
	if _tex.has(key):
		return _tex[key]
	var S := 128
	var m := S / 2.0
	var img := Image.create(S, S, false, Image.FORMAT_RGBA8)
	var hit: Color = cols.hit
	for y in S:
		for x in S:
			var r := Vector2((x + 0.5 - m) / m, (y + 0.5 - m) / m).length()
			var c: Color
			if r < 0.18:
				c = Color.WHITE.lerp(Color(hit, 0.9), r / 0.18)
			elif r < 0.55:
				c = Color(hit, lerpf(0.9, 0.3, (r - 0.18) / 0.37))
			else:
				c = Color(hit, lerpf(0.3, 0.0, clampf((r - 0.55) / 0.45, 0.0, 1.0)))
			img.set_pixel(x, y, c)
	var t := ImageTexture.create_from_image(img)
	_tex[key] = t
	return t
