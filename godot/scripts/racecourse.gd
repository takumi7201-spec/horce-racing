extends Node3D
## 競馬場（Godot 版）。
##
## 走路の形は、ゲームのレースが走っているのと同じ course.js の幾何を data/tracks.json から読む
## （tools/export-godot-tracks.mjs が書き出す）。ここでオーバルを作り直すと、レースの走路と画面の走路が二つに割れる。
## 1 周を 5m ごとに刻んだ点が、内ラチの位置・標高・外向きの単位ベクトルを持つ。横位置 off の点は 内ラチ + 外向き × off。
##
## three.js 版（src/render3d/track.js）で踏んだことは、ここでも守る：
## - 内馬場は平面にしない。縁の高さを走路に合わせた扇で作る（中山は 5m 下がる。平面だと走路を上から隠す）
## - 走路の法線は上に固定する（巻き方向で下を向くと暗くなり、どこが走路か分からなくなる）
## - 太陽はカメラの側（スタンドの側）から当てる。向こう側に置くと見えている面が全部陰になる
##
## 馬を走らせるのはゲームのシミュレーション（src/sim/race.js）。ここは走行ログ（data/races/*.json、
## tools/export-godot-races.mjs が書き出す）を再生するだけで、結果を作り直さない（ゲームと違う勝ち馬にしない）。
##
## 起動の引数（`--` の後ろ）：--course=tokyo --surface=turf|dirt --race=japancup --t=秒 --cam=tv|follow|stand|aerial|ride|free --shot=画像の保存先

const TRACKS_PATH := "res://data/tracks.json"
const OrbitCamera := preload("res://scripts/orbit_camera.gd")
const HorseModel := preload("res://scripts/horse_model.gd")
const UIK := preload("res://scripts/ik/ui.gd")   # 育成モードと同じ字体と配色（画面の札・順位表）
const RACES_PATH := "res://data/races.json"
const STRIDE := 7.0      # 襲歩の 1 完歩（m）
const RUN_OUT := 14.0    # 最後の馬がゴールしてから再生を続ける秒数（ゴールの後の流し）
const CANTER := 7.5      # ゴールの後に落ち着く駈歩の速さ（m/s）。止めずに走り抜けさせる
const EASE := 4.5        # 駈歩へ落ちるまでの時定数（秒）
const RAIL_GAP := 1.0    # 横位置の 0 は内ラチの位置。馬の体と騎手の脚が柵に被らないよう、絵では 1m 外へ出す

# 色。走路と内馬場は同系の緑にしない（three.js 版で、どこが走路か分からなくなった）
const C_TURF_A := Color(0.14, 0.40, 0.13)
const C_TURF_B := Color(0.19, 0.48, 0.17)
const C_TURF_WORN := Color(0.30, 0.40, 0.17)   # 内ラチ沿いの荒れ（開催が進むと内が傷む）
const C_DIRT_A := Color(0.40, 0.28, 0.17)
const C_DIRT_B := Color(0.46, 0.33, 0.21)
const C_INFIELD := Color(0.13, 0.30, 0.11)
const C_OUTFIELD := Color(0.15, 0.33, 0.12)
const C_APRON := Color(0.50, 0.48, 0.45)
const C_RAIL := Color(0.96, 0.96, 0.96)
const C_STAND := Color(0.80, 0.81, 0.83)
const C_ROOF := Color(0.30, 0.34, 0.40)
const C_GLASS := Color(0.22, 0.32, 0.42)
const CROWD := [Color(0.95, 0.95, 0.95), Color(0.12, 0.14, 0.2), Color(0.75, 0.2, 0.2), Color(0.2, 0.35, 0.7),
	Color(0.85, 0.75, 0.3), Color(0.35, 0.35, 0.38), Color(0.55, 0.42, 0.3), Color(0.9, 0.55, 0.65)]

var tracks: Array = []
var course_id := "tokyo"
var surface := "turf"
var cam_mode := "stand"

var track: Dictionary
var n := 0
var px := PackedFloat32Array()  # 周回位置
var vx := PackedFloat32Array()  # 内ラチの x
var vz := PackedFloat32Array()  # 内ラチの z
var vy := PackedFloat32Array()  # 標高
var nx := PackedFloat32Array()  # 外向きの単位ベクトル
var nz := PackedFloat32Array()
var kc := PackedFloat32Array()  # 曲率（コーナーで 1/半径）

var course_root: Node3D
var camera   # orbit_camera.gd（set_view・free_look を持つ）
var ui: Control
var ride_p := 0.0
var font: SystemFont

var races: Array = []
var race: Dictionary = {}
var runners: Array = []   # 馬ごと：{node, pos, off, name, gate, order, time, t_fin, v_fin, ph, yaw, s}
var race_t := 0.0
var playing := true
var play_speed := 1.0
var cam_eye := Vector3.ZERO
var cam_look := Vector3.ZERO

## 育成モード（ik/ikusei_app.gd）から呼ぶとき。コースとレースの選択を隠し、「結果へ」で finished を出す。
## レースは load_race_data で渡す（Godot で走らせた走行ログ）。
signal finished
var embedded := false
var cues: Array = []        # スキルの演出：{s（その馬が走った距離）, gate, text, mine, unique, shown}
var cue_box: VBoxContainer


func _ready() -> void:
	font = SystemFont.new()
	# 日本語の字形を持つ字体を順に探す（Windows・mac・Linux）。既定の字体には漢字が無い
	font.font_names = PackedStringArray(["Yu Gothic UI", "Meiryo", "Hiragino Sans", "Noto Sans CJK JP", "Noto Sans JP", "IPAGothic"])
	tracks = JSON.parse_string(FileAccess.get_file_as_string(TRACKS_PATH)).courses
	if FileAccess.file_exists(RACES_PATH) and not embedded:
		races = JSON.parse_string(FileAccess.get_file_as_string(RACES_PATH)).races
	if embedded:
		_build_environment()
		camera = OrbitCamera.new()
		add_child(camera)
		_build_ui()
		return
	var args := _args()
	course_id = args.get("course", course_id)
	surface = args.get("surface", surface)
	cam_mode = args.get("cam", cam_mode)
	_build_environment()
	camera = OrbitCamera.new()
	add_child(camera)
	_build_ui()
	if args.has("race"):
		load_race(args.race)
		if args.has("t"):
			race_t = float(args.t)
			playing = false
		if args.has("cam"):
			set_camera(args.cam)
	else:
		load_course(course_id, surface)
	if args.has("shot"):
		_shoot(args.shot)


func _args() -> Dictionary:
	var d := {}
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--") and a.contains("="):
			var kv := a.substr(2).split("=", true, 1)
			d[kv[0]] = kv[1]
	return d


func _shoot(path: String) -> void:
	# 草の模様（NoiseTexture2D）は裏で作られるので、数コマ待ってから撮る
	for i in 40:
		await get_tree().process_frame
		if not race.is_empty():
			_update_race(0.0, true)   # 止めた時刻の姿でカメラも合わせる
	get_viewport().get_texture().get_image().save_png(path)
	print("saved ", path)
	get_tree().quit()


# ------------------------------------------------------------------ コースを読む

func find_track(id: String, surf: String) -> Dictionary:
	for t in tracks:
		if t.id == id and t.surface == surf:
			return t
	for t in tracks:   # 芝だけの場（ロンシャン）でダートを選んだら芝にする
		if t.id == id:
			return t
	return tracks[0]


func load_course(id: String, surf: String, keep_race := false) -> void:
	if not keep_race:
		race = {}
		runners = []
	track = find_track(id, surf)
	course_id = track.id
	surface = track.surface
	var pts: Array = track.points
	n = pts.size()
	# Packed の配列は値として渡るので、for で回して resize しても元が伸びない。一つずつ
	px.resize(n); vx.resize(n); vz.resize(n); vy.resize(n); nx.resize(n); nz.resize(n); kc.resize(n)
	for i in n:
		var q: Array = pts[i]
		px[i] = q[0]; vx[i] = q[1]; vz[i] = q[2]; vy[i] = q[3]; nx[i] = q[4]; nz[i] = q[5]; kc[i] = q[7]
	if course_root:
		course_root.queue_free()
	course_root = Node3D.new()
	course_root.name = "Course"
	add_child(course_root)
	_build_course()
	_sync_ui()
	set_camera(cam_mode)


## 周回の i 番目の点から外へ off m の位置（標高つき）。
func at(i: int, off: float, dy := 0.0) -> Vector3:
	i = posmod(i, n)
	return Vector3(vx[i] + nx[i] * off, vy[i] + dy, vz[i] + nz[i] * off)


## 周回位置 p（m）に最も近い点の番号。
func index_of(p: float) -> int:
	var lap: float = track.lap
	return posmod(int(round(fposmod(p, lap) / (lap / n))), n)


## 周回位置 p（m、周回をまたいでよい）の、外へ off m の位置。5m の刻みの間を線形に補う（馬の位置用）。
func at_p(p: float, off: float, dy := 0.0) -> Vector3:
	var lap: float = track.lap
	var f := fposmod(p, lap) / (lap / n)
	var i := int(floor(f))
	return at(i, off, dy).lerp(at(i + 1, off, dy), f - i)


func curvature_at(p: float) -> float:
	return kc[index_of(p)]


func outward(i: int) -> Vector3:
	i = posmod(i, n)
	return Vector3(nx[i], 0, nz[i])


func forward(i: int) -> Vector3:
	return (at(i + 1, 0) - at(i - 1, 0)).normalized()


# ------------------------------------------------------------------ 環境（空・光）

func _build_environment() -> void:
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color(0.30, 0.52, 0.85)
	sky_mat.sky_horizon_color = Color(0.72, 0.80, 0.88)
	sky_mat.ground_horizon_color = Color(0.55, 0.62, 0.55)
	sky_mat.ground_bottom_color = Color(0.2, 0.25, 0.18)
	sky_mat.sun_angle_max = 20.0
	var sky := Sky.new()
	sky.sky_material = sky_mat
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.6
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 1.05
	env.ssao_enabled = true   # Forward+ だけで効く（互換レンダラでは無視される）
	env.fog_enabled = true
	env.fog_light_color = Color(0.70, 0.78, 0.86)
	env.fog_density = 0.00012
	env.fog_aerial_perspective = 0.4
	env.glow_enabled = true
	env.glow_intensity = 0.4
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

	var sun := DirectionalLight3D.new()
	sun.name = "Sun"
	sun.light_energy = 1.3
	sun.light_color = Color(1.0, 0.97, 0.9)
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 700.0
	add_child(sun)


## 太陽はスタンドの側から内馬場へ向けて当てる（スタンドから見た馬と走路が順光になる）。
func _aim_sun() -> void:
	var sun: DirectionalLight3D = get_node("Sun")
	var i := index_of(-60.0)
	var into_infield := -outward(i)
	var along := forward(i)
	var d := (into_infield * 0.75 + along * 0.35 + Vector3.DOWN * 0.95).normalized()
	sun.global_transform = Transform3D(Basis.looking_at(d, Vector3.UP), Vector3.ZERO)


# ------------------------------------------------------------------ メッシュの道具

func _mesh(v: PackedVector3Array, nrm: PackedVector3Array, col: PackedColorArray, uv: PackedVector2Array, idx: PackedInt32Array) -> ArrayMesh:
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = v
	if nrm.size() > 0:
		arr[Mesh.ARRAY_NORMAL] = nrm
	if col.size() > 0:
		arr[Mesh.ARRAY_COLOR] = col
	if uv.size() > 0:
		arr[Mesh.ARRAY_TEX_UV] = uv
	arr[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return m


## 上を向く面の三角形を、上から見て表になる巻きにそろえる。Godot の表は時計回りで、外積が下（-Y）を向く。
## 両面描きにしても、裏から見た面は法線が返って暗く写る（走路が黒くなった）。巻きは右回り・左回りの場で逆になるので、
## 決め打ちにせず三角形ごとに直す。
func _face_up(v: PackedVector3Array, idx: PackedInt32Array) -> PackedInt32Array:
	for t in range(0, idx.size(), 3):
		var a := v[idx[t]]
		var b := v[idx[t + 1]]
		var c := v[idx[t + 2]]
		if (b - a).cross(c - a).y > 0.0:
			var k := idx[t + 1]
			idx[t + 1] = idx[t + 2]
			idx[t + 2] = k
	return idx


func _mat(c: Color, rough := 0.9, vertex_color := false) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	m.vertex_color_use_as_albedo = vertex_color
	m.vertex_color_is_srgb = true   # 色は sRGB で書いている。線形のまま渡すと白っぽく抜ける（芝が薄緑になった）
	m.cull_mode = BaseMaterial3D.CULL_DISABLED   # 巻き方向に左右されない（裏から見ても法線は向きが返る）
	return m


func _add(mesh: Mesh, mat: Material, nm := "") -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	if nm != "":
		mi.name = nm
	course_root.add_child(mi)
	return mi


## 草・砂のむら。色に掛けるので、暗くし過ぎないよう 0.82〜1.05 に収める。
func _grain(freq: float, lo := 0.82) -> NoiseTexture2D:
	var noise := FastNoiseLite.new()
	noise.frequency = freq
	noise.fractal_octaves = 4
	var g := Gradient.new()
	g.set_color(0, Color(lo, lo, lo))
	g.set_color(1, Color(1.05, 1.05, 1.05))
	var t := NoiseTexture2D.new()
	t.width = 256
	t.height = 256
	t.seamless = true
	t.noise = noise
	t.color_ramp = g
	return t


## 走路の帯。lanes は内から外への横位置（m）。縦は 1 周の点、横は lanes。色は (横位置, 周回位置) から決める。
func _band(lanes: PackedFloat32Array, color_at: Callable, uv_scale := 0.25, dy := 0.0) -> ArrayMesh:
	var v := PackedVector3Array()
	var nrm := PackedVector3Array()
	var col := PackedColorArray()
	var uv := PackedVector2Array()
	var idx := PackedInt32Array()
	var w := lanes.size()
	for i in n:
		for k in w:
			v.append(at(i, lanes[k], dy))
			nrm.append(Vector3.UP)   # 上に固定（落とし穴 3）
			col.append(color_at.call(lanes[k], px[i]))
			uv.append(Vector2(lanes[k] * uv_scale, px[i] * uv_scale))
	for i in n:
		var j := (i + 1) % n
		for k in w - 1:
			var a := i * w + k
			var b := j * w + k
			idx.append_array([a, b, a + 1, a + 1, b, b + 1])
	return _mesh(v, nrm, col, uv, _face_up(v, idx))


# ------------------------------------------------------------------ 組み立て

func _build_course() -> void:
	var w: float = track.width
	var turf: bool = track.surface == "turf"

	# 走路。芝は刈り込みの縞（20m ごと）と内ラチ沿いの荒れ、ダートは濃淡の縞（ハロー掛けの跡）
	var lanes := PackedFloat32Array([0.0, 1.5, 4.0, w * 0.5, w - 2.0, w])
	var surf_color := func(off: float, p: float) -> Color:
		var stripe := int(floor(p / 20.0)) % 2 == 0
		if turf:
			var c := C_TURF_A if stripe else C_TURF_B
			return c.lerp(C_TURF_WORN, clampf(1.0 - off / 4.0, 0.0, 1.0) * 0.6)
		return (C_DIRT_A if stripe else C_DIRT_B).lerp(C_DIRT_A, clampf(off / w, 0.0, 1.0) * 0.4)
	var surf_mat := _mat(Color.WHITE, 0.95, true)
	surf_mat.albedo_texture = _grain(0.08 if turf else 0.18)
	_add(_band(lanes, surf_color), surf_mat, "Surface")

	# 米国の競馬場は芝がダートの内側（日本と逆）。ダートのレースでは内ラチの内に芝の帯と内ラチを描く
	if track.abroad == "US" and not turf:
		var inner_turf := func(off: float, p: float) -> Color:
			return C_TURF_A if int(floor(p / 20.0)) % 2 == 0 else C_TURF_B
		var tm := _mat(Color.WHITE, 0.95, true)
		tm.albedo_texture = _grain(0.08)
		_add(_band(PackedFloat32Array([-26.0, -5.0]), inner_turf, 0.25, -0.03), tm, "InnerTurf")
		_build_rail(-5.0, 1.0)

	_build_infield(-0.4 if not (track.abroad == "US" and not turf) else -26.4)
	_build_verge()
	_build_rail(0.1, 1.1)
	_build_rail(w - 0.1, 1.3)
	_build_finish()
	_build_furlongs()
	_build_stand()
	_build_screen()
	_build_trees()
	_aim_sun()


## 内馬場：中心から走路の内縁へ扇を張る。縁の高さは走路に合わせる（平面にしない）。
func _build_infield(edge: float) -> void:
	var v := PackedVector3Array()
	var nrm := PackedVector3Array()
	var uv := PackedVector2Array()
	var idx := PackedInt32Array()
	var c := Vector3.ZERO
	for i in n:
		c += at(i, edge, -0.06)
	c /= n
	c.y -= 0.4
	v.append(c); nrm.append(Vector3.UP); uv.append(Vector2(c.x, c.z) * 0.05)
	for i in n:
		var q := at(i, edge, -0.06)
		v.append(q); nrm.append(Vector3.UP); uv.append(Vector2(q.x, q.z) * 0.05)
	for i in n:
		idx.append_array([0, 1 + i, 1 + (i + 1) % n])
	var m := _mat(C_INFIELD, 1.0)
	m.albedo_texture = _grain(0.05, 0.75)
	_add(_mesh(v, nrm, PackedColorArray(), uv, _face_up(v, idx)), m, "Infield")


## 外ラチの外：走路の高さのまま少し張り出し、その先で遠景の地面まで下ろす（走路が宙に浮いて見えないように）。
func _build_verge() -> void:
	var w: float = track.width
	var ground_y: float = track.elevation.lo - 1.2
	var v := PackedVector3Array()
	var nrm := PackedVector3Array()
	var uv := PackedVector2Array()
	var idx := PackedInt32Array()
	var offs := [w, w + 42.0, w + 120.0]   # スタンドの前庭までは走路の高さ、その先で下ろす
	for i in n:
		for k in 3:
			var q := at(i, offs[k])
			if k == 2:
				q.y = ground_y
			v.append(q); nrm.append(Vector3.UP); uv.append(Vector2(q.x, q.z) * 0.05)
	for i in n:
		var j := (i + 1) % n
		for k in 2:
			var a := i * 3 + k
			var b := j * 3 + k
			idx.append_array([a, b, a + 1, a + 1, b, b + 1])
	var m := _mat(C_OUTFIELD, 1.0)
	m.albedo_texture = _grain(0.05, 0.75)
	_add(_mesh(v, nrm, PackedColorArray(), uv, _face_up(v, idx)), m, "Verge")

	# 遠景の地面。走路より必ず下に置く（上にあると走路を隠す）
	var b: Dictionary = track.bounds
	var size := Vector2(float(b.maxX) - float(b.minX), float(b.maxZ) - float(b.minZ)) * 3.0
	var plane := PlaneMesh.new()
	plane.size = size
	var gm := _mat(C_OUTFIELD.darkened(0.08), 1.0)
	gm.albedo_texture = _grain(0.02, 0.7)
	gm.uv1_scale = Vector3(size.x / 40.0, size.y / 40.0, 1)
	var g := _add(plane, gm, "Ground")
	g.position = Vector3((float(b.minX) + float(b.maxX)) / 2.0, ground_y - 0.05, (float(b.minZ) + float(b.maxZ)) / 2.0)


## ラチ：上の横木（断面の箱）と、5m ごとの支柱。白い線として読めることが大事。
func _build_rail(off: float, height: float) -> void:
	var v := PackedVector3Array()
	var nrm := PackedVector3Array()
	var idx := PackedInt32Array()
	var t := 0.09   # 横木の厚み
	var hh := 0.16  # 横木の高さ
	for i in n:
		var o := outward(i)
		var base := at(i, off)
		var corners := [
			[base + o * (-t) + Vector3.UP * (height - hh), -o],
			[base + o * (-t) + Vector3.UP * height, Vector3.UP],
			[base + o * t + Vector3.UP * height, Vector3.UP],
			[base + o * t + Vector3.UP * (height - hh), o],
		]
		for c in corners:
			v.append(c[0]); nrm.append(c[1])
	for i in n:
		var j := (i + 1) % n
		for k in 3:
			var a := i * 4 + k
			var b := j * 4 + k
			idx.append_array([a, b, a + 1, a + 1, b, b + 1])
	# ラチは光の当たり方より「白い線」として読めることが大事（three.js 版と同じく陰を付けない）
	var rail_mat := _mat(C_RAIL, 0.5)
	rail_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_add(_mesh(v, nrm, PackedColorArray(), PackedVector2Array(), idx), rail_mat, "Rail")

	var post := BoxMesh.new()
	post.size = Vector3(0.08, height, 0.08)
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = post
	mm.instance_count = n
	for i in n:
		mm.set_instance_transform(i, Transform3D(Basis(), at(i, off, height / 2.0)))
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.material_override = rail_mat
	course_root.add_child(mmi)


## 決勝線とゴール板。ゴール板は内ラチの内に立つ円い標識（赤い縁に白）。スタンドの側へ向ける。
func _build_finish() -> void:
	var w: float = track.width
	var f := forward(0)
	var a := at(0, 0, 0.03)
	var b := at(0, w, 0.03)
	var v := PackedVector3Array([a - f * 0.3, b - f * 0.3, a + f * 0.3, b + f * 0.3])
	var nrm := PackedVector3Array([Vector3.UP, Vector3.UP, Vector3.UP, Vector3.UP])
	var line := _mat(Color.WHITE, 0.6)
	_add(_mesh(v, nrm, PackedColorArray(), PackedVector2Array(), _face_up(v, PackedInt32Array([0, 1, 2, 2, 1, 3]))), line, "FinishLine")

	var o := outward(0)
	var pole := CylinderMesh.new()
	pole.top_radius = 0.08
	pole.bottom_radius = 0.1
	pole.height = 4.2
	var pm := _add(pole, _mat(Color.WHITE, 0.5), "GoalPole")
	pm.position = at(0, -1.2, 2.1)
	# 円い標識：外向き（スタンドの側）に面を向ける
	var face := Basis.looking_at(-o, Vector3.UP) * Basis(Vector3.RIGHT, PI / 2.0)
	for ring in [[0.95, Color(0.85, 0.12, 0.12), 0.0], [0.7, Color.WHITE, 0.03]]:
		var disc := CylinderMesh.new()
		disc.top_radius = ring[0]
		disc.bottom_radius = ring[0]
		disc.height = 0.06
		var dm := _add(disc, _mat(ring[1], 0.4), "GoalDisc")
		dm.transform = Transform3D(face, at(0, -1.2, 4.4) + o * ring[2])


## 残り距離の標識（ハロン棒）。200m ごとに内ラチの内へ。数字は残り距離の百の位（JRA の標識と同じ読み方）。
func _build_furlongs() -> void:
	var lap: float = track.lap
	var m := int(floor(lap / 200.0))
	for k in range(1, m + 1):
		var rem := k * 200
		var i := index_of(lap - rem)
		var o := outward(i)
		var pole := BoxMesh.new()
		pole.size = Vector3(0.18, 2.4, 0.18)
		var red := rem % 400 == 0
		var mi := _add(pole, _mat(Color(0.85, 0.15, 0.15) if red else Color(0.95, 0.95, 0.9), 0.6), "Furlong")
		mi.position = at(i, -0.7, 1.2)
		var lab := Label3D.new()
		lab.text = str(rem / 100)
		lab.font = font
		lab.font_size = 96
		lab.pixel_size = 0.006
		lab.outline_size = 12
		lab.modulate = Color.WHITE if red else Color(0.15, 0.15, 0.15)
		lab.outline_modulate = Color(0.85, 0.15, 0.15) if red else Color.WHITE
		lab.double_sided = true
		lab.transform = Transform3D(Basis.looking_at(-o, Vector3.UP), at(i, -0.7, 2.75))
		course_root.add_child(lab)


## スタンド：ゴール前の直線の外。下の段と上の段の客席、観客、屋根、ガラス張りの建屋。
## ゴール板の少し先から直線の 8 割ほど手前まで。走路から 32m 離す（近いとゴール前のカメラが建物に入る）。
func _build_stand() -> void:
	var lap: float = track.lap
	var w: float = track.width
	var i0 := index_of(lap - float(track.homeStraight) * 0.8)
	var i1 := index_of(70.0)
	var a := at(i0, w)
	var b := at(i1, w)
	var dir := (b - a)
	var length := dir.length()
	dir /= length
	var o := outward(i1)   # 直線なので一定
	var mid := (a + b) / 2.0
	var base_y: float = min(a.y, b.y)
	var basis := Basis(dir, Vector3.UP, dir.cross(Vector3.UP))   # 右手系を保つ（左回りの場で裏返らない）

	var box := func(depth_from: float, depth_to: float, y0: float, y1: float, mat: Material, len_scale := 1.0) -> MeshInstance3D:
		# 地面から立つ箱は下へ 3m 伸ばす（外ラチの外は遠景へ下っていくので、足もとに隙間が見える）
		if y0 == 0.0:
			y0 = -3.0
		var bm := BoxMesh.new()
		bm.size = Vector3(length * len_scale, y1 - y0, depth_to - depth_from)
		var mi := _add(bm, mat, "Stand")
		var c := mid + o * (w * 0.0 + (depth_from + depth_to) / 2.0)
		c.y = base_y + (y0 + y1) / 2.0
		mi.transform = Transform3D(basis, c)
		return mi

	var stand_mat := _mat(C_STAND, 0.8)
	# 前庭（スタンドと外ラチの間の舗装）
	var apron := PlaneMesh.new()
	apron.size = Vector2(length, 26.0)
	var am := _add(apron, _mat(C_APRON, 0.9), "Apron")
	var ac := mid + o * 19.0
	ac.y = base_y + 0.06   # 外ラチの外の帯と同じ高さだと重なって見えない
	am.transform = Transform3D(basis, ac)

	# 下の段：14 段、奥へ 0.9m・上へ 0.42m ずつ
	var d0 := 32.0
	var tiers := 14
	var crowd_pos: Array = []
	for k in tiers:
		var y_top := 1.6 + (k + 1) * 0.42
		box.call(d0 + k * 0.9, d0 + (k + 1) * 0.9, 0.0, y_top, stand_mat)
		crowd_pos.append([d0 + k * 0.9 + 0.45, y_top])
	# 上の段：張り出したバルコニーの上に 10 段
	var d1 := d0 + tiers * 0.9 + 2.0
	box.call(d0 + tiers * 0.9, d1 + 1.0, 0.0, 9.5, stand_mat)
	var balcony_mat := _mat(Color(0.25, 0.28, 0.32), 0.6)
	box.call(d1 - 3.0, d1 - 2.4, 9.5, 11.0, balcony_mat)
	for k in 10:
		var y_top := 11.0 + (k + 1) * 0.5
		box.call(d1 - 2.4 + k * 0.95, d1 - 2.4 + (k + 1) * 0.95, 9.5, y_top, stand_mat)
		crowd_pos.append([d1 - 2.4 + k * 0.95 + 0.47, y_top])
	# 建屋（ガラス張り）と屋根
	var back := d1 - 2.4 + 10 * 0.95
	box.call(back, back + 22.0, 0.0, 27.0, stand_mat)
	var glass := _mat(C_GLASS, 0.1)
	glass.metallic = 0.6
	box.call(back - 0.3, back, 17.5, 26.0, glass, 0.98)
	box.call(back - 0.3, back, 2.0, 8.5, glass, 0.98)
	var roof := _mat(C_ROOF, 0.6)
	var rm: MeshInstance3D = box.call(d0 - 4.0, back + 22.0, 27.0, 27.8, roof, 1.02)
	rm.name = "Roof"
	# 屋根を支える柱（客席の奥の列）
	for k in 9:
		var col := BoxMesh.new()
		col.size = Vector3(0.6, 27.0, 0.6)
		var cm := _add(col, stand_mat, "Column")
		var cp := a + dir * (length * (k + 0.5) / 9.0) + o * (back - 1.0)
		cp.y = base_y + 13.5
		cm.position = cp

	# 観客：段の上に小さな人影を並べる（MultiMesh、色は服の色）。空席も混ぜる
	var person := BoxMesh.new()
	person.size = Vector3(0.45, 0.85, 0.4)
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(course_id)
	var spots: Array = []
	for row in crowd_pos:
		var s := 0.0
		while s < length - 1.0:
			s += 0.62 + rng.randf() * 0.25
			if rng.randf() < 0.72:
				spots.append(a + dir * s + o * float(row[0]) + Vector3.UP * (base_y - a.y + float(row[1]) + 0.42))
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = person
	mm.instance_count = spots.size()
	for k in spots.size():
		mm.set_instance_transform(k, Transform3D(basis, spots[k]))
		mm.set_instance_color(k, CROWD[rng.randi() % CROWD.size()])
	var mmi := MultiMeshInstance3D.new()
	mmi.name = "Crowd"
	mmi.multimesh = mm
	mmi.material_override = _mat(Color.WHITE, 0.9, true)
	course_root.add_child(mmi)

	# 屋根の正面に場の名前
	var lab := Label3D.new()
	lab.text = "%s競馬場" % track.name if track.abroad == null else String(track.name)
	lab.font = font
	lab.font_size = 160
	lab.pixel_size = 0.05
	lab.outline_size = 0
	lab.double_sided = false   # 屋根の後ろから鏡文字で透けて見えた
	lab.modulate = Color(0.95, 0.95, 0.95)
	var lp := mid + o * (d0 - 4.2)
	lp.y = base_y + 26.2
	# Label3D は +Z へ面を向ける。looking_at(o) で +Z が内馬場の側（向こう正面から読める向き）
	lab.transform = Transform3D(Basis.looking_at(o, Vector3.UP), lp)
	course_root.add_child(lab)


## 大型ビジョン：内馬場の直線寄りに、スタンドへ向けて立てる。
func _build_screen() -> void:
	var lap: float = track.lap
	var i := index_of(lap - float(track.homeStraight) * 0.45)
	var o := outward(i)
	var p := at(i, -45.0)
	var face := Basis.looking_at(-o, Vector3.UP)
	var frame := BoxMesh.new()
	frame.size = Vector3(56.0, 13.0, 1.2)
	var fm := _add(frame, _mat(Color(0.12, 0.13, 0.15), 0.7), "ScreenFrame")
	fm.transform = Transform3D(face, p + Vector3.UP * 13.0)
	var panel := QuadMesh.new()
	panel.size = Vector2(53.0, 11.0)
	var pm := StandardMaterial3D.new()
	pm.albedo_color = Color(0.05, 0.12, 0.2)
	pm.emission_enabled = true
	pm.emission = Color(0.1, 0.35, 0.55)
	pm.emission_energy_multiplier = 0.8
	var pi := _add(panel, pm, "ScreenPanel")
	# QuadMesh と Label3D は +Z へ面を向ける。looking_at(-o) の +Z は外向き＝スタンドの側
	pi.transform = Transform3D(face, p + Vector3.UP * 13.0 + o * 0.65)
	for s in [-20.0, 20.0]:
		var leg := BoxMesh.new()
		leg.size = Vector3(1.2, 7.0, 1.2)
		var lm := _add(leg, _mat(Color(0.3, 0.32, 0.35), 0.7), "ScreenLeg")
		lm.position = p + face.x * s + Vector3.UP * 3.5
	var lab := Label3D.new()
	lab.text = "%s　%s %dm" % [track.name, "芝" if track.surface == "turf" else "ダート", int(track.lap)]
	lab.font = font
	lab.font_size = 128
	lab.pixel_size = 0.03
	lab.modulate = Color(1, 1, 1)
	lab.transform = Transform3D(face, p + Vector3.UP * 13.0 + o * 0.8)
	course_root.add_child(lab)


## 木：走路のまわり（外ラチの外の帯）と内馬場の奥にまばらに。乱数は場の名前で決める（開くたびに変わらない）。
func _build_trees() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(course_id + "trees")
	var w: float = track.width
	var ground_y: float = track.elevation.lo - 1.2
	var spots: Array = []
	var stand_from := float(track.lap) - float(track.homeStraight) * 0.85
	for k in 420:
		var i := rng.randi() % n
		var p := px[i]
		var inside := rng.randf() < 0.3
		var off := -rng.randf_range(60.0, 90.0) if inside else rng.randf_range(w + 18.0, w + 110.0)
		if not inside and (p > stand_from or p < 120.0):
			continue   # スタンドの前と後ろは空ける
		var q := at(i, off)
		q.y = at(i, 0).y - 0.4 if inside else ground_y
		spots.append([q, rng.randf_range(0.7, 1.5)])
	var trunk := CylinderMesh.new()
	trunk.top_radius = 0.35
	trunk.bottom_radius = 0.5
	trunk.height = 3.0
	var crown := SphereMesh.new()
	crown.radius = 3.2
	crown.height = 5.6
	for part in [[trunk, Color(0.30, 0.22, 0.15), 1.5], [crown, Color(0.14, 0.32, 0.13), 5.2]]:
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = true
		mm.mesh = part[0]
		mm.instance_count = spots.size()
		for k in spots.size():
			var s: float = spots[k][1]
			mm.set_instance_transform(k, Transform3D(Basis().scaled(Vector3(s, s, s)), spots[k][0] + Vector3.UP * part[2] * s))
			var c: Color = part[1]
			mm.set_instance_color(k, c.lightened(rng.randf() * 0.15))
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.material_override = _mat(Color.WHITE, 0.95, true)
		course_root.add_child(mmi)


# ------------------------------------------------------------------ カメラ

## stand：スタンドの上の段からゴール前を見下ろす / aerial：上空から全体 / ride：走路を馬の目の高さで回る / free：自由（マウス）
func set_camera(mode: String) -> void:
	cam_mode = mode
	var lap: float = track.lap
	var w: float = track.width
	var b: Dictionary = track.bounds
	var center := Vector3((float(b.minX) + float(b.maxX)) / 2.0, 0, (float(b.minZ) + float(b.maxZ)) / 2.0)
	match mode:
		"stand":
			# スタンドの前の縁の高さ（上の段の客の目）。建物の中に入らないよう前庭の上に置く
			var i := index_of(-30.0)
			var eye := at(i, w + 14.0, 19.0)   # 屋根の前の縁より手前（奥に置くと屋根の裏が画面の上を覆う）
			var look := at(index_of(lap - float(track.homeStraight) * 0.55), w * 0.5, 0.0)
			camera.set_view(eye, look)
		"aerial":
			var span := maxf(float(b.maxX) - float(b.minX), float(b.maxZ) - float(b.minZ))
			var i := index_of(-float(track.homeStraight) * 0.4)
			var eye := center + outward(i) * span * 0.75 + Vector3.UP * span * 0.42
			camera.set_view(eye, center)
		"ride":
			ride_p = lap - float(track.homeStraight) - 200.0
		"tv", "follow", "side", "front":
			if race.is_empty():
				set_camera("stand")
				return
			cam_eye = Vector3.ZERO   # 次のコマで寄せずに置く
		_:
			pass
	camera.free_look = mode == "free"
	camera.fov = 30.0 if mode == "tv" else 50.0
	if ui:
		for c in ui.get_node("Bar/Cams").get_children():
			c.button_pressed = c.name == mode


func _process(delta: float) -> void:
	if not race.is_empty():
		_update_race(delta, false)
	if cam_mode != "ride" or n == 0:
		return
	# 馬の目の高さ（2.4m）で内から 1/3 の位置を 16m/s で回る。進行方向の 25m 先を見る
	ride_p = fposmod(ride_p + 16.0 * delta, float(track.lap))
	var i := index_of(ride_p)
	var off: float = float(track.width) * 0.33
	var eye := at(i, off, 2.4)
	var look := at(i + 5, off, 2.0)
	camera.set_view(eye, look)


# ------------------------------------------------------------------ レース（走行ログの再生）

func load_race(id: String) -> void:
	var path := "res://data/races/%s.json" % id
	if not FileAccess.file_exists(path):
		push_warning("レースが無い: " + id)
		return
	var r: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(path))
	var dir := "res://assets/horse/skins/%s" % String(r.id)
	_start_race(r, func(node, h) -> void: node.build(dir, int(h.gate), String(r.surface)))


## Godot で走らせたレース（育成モード）。r は load_race と同じ形（horses に pos・off）、skins は馬ごとの {meta, tex}
## （ik/skins.gd）、mine は自分の馬の id の並び（目印を付ける）、cue は発動したスキルの演出の並び。
func load_race_data(r: Dictionary, skins: Array, mine: Array = [], cue: Array = []) -> void:
	_start_race(r, func(node, h) -> void:
		var k: int = r.horses.find(h)
		node.build_with(skins[k].meta, skins[k].tex, String(r.surface)))
	for rr in runners:
		if mine.has(rr.id):
			rr.mine = true
			_add_mark(rr.node, rr.name)
	cues = cue.duplicate(true)
	for c in cues:
		c.shown = false


func _start_race(r: Dictionary, build: Callable) -> void:
	load_course(r.course, r.surface, true)
	race = r
	# 発走位置は描く周回で決め直す（ゴール板から距離だけ手前）。直線だけのコース（新潟 1000m）も周回の上で見せる
	race.start = fposmod(float(track.lap) - fmod(float(r.distance), float(track.lap)), float(track.lap))
	race_t = 0.0
	playing = true
	runners = []
	var dist: float = r.distance
	var dt: float = r.dt
	for h in r.horses:
		var node := HorseModel.new()
		course_root.add_child(node)
		build.call(node, h)
		node.phase = randf()   # 位相をばらす（全頭が同じ脚で走ると行進に見える）
		var pos := PackedFloat32Array(h.pos)
		var off := PackedFloat32Array(h.off)
		# ログはゴールで止まる。ゴールした時刻とその直前の速さを覚えて、絵だけ流して止める
		var k_fin := pos.size() - 1
		for k in pos.size():
			if pos[k] >= dist - 0.01:
				k_fin = k
				break
		var v_fin := (pos[k_fin] - pos[maxi(0, k_fin - 5)]) / (dt * mini(5, maxi(1, k_fin)))
		runners.append({ node = node, id = h.get("id", 0), frame = int(h.get("frame", 1)), mine = false, pos = pos, off = off, name = String(h.name), gate = int(h.gate), order = int(h.order),
			time = float(h.time), t_fin = k_fin * dt, v_fin = v_fin, ph = randf(), yaw = 0.0, s = 0.0, v = 0.0 })
	_sync_ui()
	set_camera("tv")
	_update_race(0.0, true)


## 自分の馬の目印（頭の上の名札）。深度を見ずに前へ描く（馬群に埋もれない。three.js 版の makeMarker と同じ考え）
func _add_mark(node: Node3D, nm: String) -> void:
	var lb := Label3D.new()
	lb.text = "▼ " + nm
	lb.font = UIK.font("black")
	lb.font_size = 30
	lb.outline_size = 8
	lb.modulate = Color("#f3a332")
	lb.outline_modulate = Color("#113035")
	lb.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	lb.no_depth_test = true
	lb.fixed_size = true
	lb.pixel_size = 0.0006
	lb.position = Vector3(0, 3.3, 0)
	node.add_child(lb)


func race_duration() -> float:
	return (int(race.frames) - 1) * float(race.dt) + RUN_OUT


func _sample(arr: PackedFloat32Array, t: float) -> float:
	var f := t / float(race.dt)
	var i := clampi(int(floor(f)), 0, arr.size() - 1)
	var j := mini(i + 1, arr.size() - 1)
	return lerpf(arr[i], arr[j], clampf(f - i, 0.0, 1.0))


## 時刻 t の走った距離と速さ。ログはゴールで止まるので、ゴールの後は絵だけ流す：
## ゴールした速さから駈歩（CANTER）へ指数で落ち着き、止まらずに決勝線を走り抜けていく（余韻）。
## v(d) = CANTER + (v0 − CANTER)·e^(−d/EASE) を積分した距離。
func _s_at(r: Dictionary, t: float) -> Vector2:
	if t <= r.t_fin:
		var s := _sample(r.pos, t)
		return Vector2(s, (_sample(r.pos, t + 0.2) - s) / 0.2)
	var d := t - float(r.t_fin)
	var v0: float = r.v_fin
	var e := exp(-d / EASE)
	return Vector2(float(race.distance) + CANTER * d + (v0 - CANTER) * EASE * (1.0 - e), CANTER + (v0 - CANTER) * e)


## 内ラチからの横位置（絵の位置）。ログの値に RAIL_GAP を足す（横の並びと間隔はそのまま）
func _off(arr: PackedFloat32Array, t: float) -> float:
	return _sample(arr, t) + RAIL_GAP


func _update_race(delta: float, snap: bool) -> void:
	if playing:
		race_t = minf(race_t + delta * play_speed, race_duration())
	var start: float = race.start
	for r in runners:
		var sv := _s_at(r, race_t)
		var off := _off(r.off, race_t)
		var p := start + sv.x
		var node: Node3D = r.node
		node.position = at_p(p, off)
		# 向きは少し先の位置へ。横へ寄る動きも向きに出る（真横へ滑って見えないように）
		var ahead := at_p(p + maxf(2.0, sv.y * 0.3), _off(r.off, race_t + 0.3))
		var d := ahead - node.position
		var yaw := atan2(d.x, d.z)   # 馬のモデルは +Z が前（three.js 版と同じ）
		r.yaw = yaw if snap else lerp_angle(float(r.yaw), yaw, clampf(delta * 8.0, 0.0, 1.0))
		node.rotation = Vector3(0, float(r.yaw), 0)
		# コーナーでは内へ少し倒す（遠心の釣り合い v²κ/g の 3 割、最大 0.12rad）。左回りは左（-Z 回り）へ
		var lean := clampf(sv.y * sv.y * curvature_at(p) / 9.8 * 0.3, 0.0, 0.12)
		var bank := -lean if track.dir == "left" else lean
		node.pose(sv.y * delta * play_speed if playing else 0.0, sv.y, bank)
		r.s = sv.x
		r.v = sv.y
	_update_race_camera(delta, snap)
	_update_board()
	_update_cues()


## スキルの演出：その馬が発動地点を過ぎたら札を出す（自分の馬は大きく、固有は帯）。最初からに戻したら出し直す
func _update_cues() -> void:
	if cues.is_empty() or cue_box == null:
		return
	for c in cues:
		var rr = null
		for x in runners:
			if int(x.gate) == int(c.gate):
				rr = x
		if rr == null:
			continue
		var past: bool = float(rr.s) >= float(c.at)
		if past and not c.shown and race_t < float(rr.t_fin) + 0.5:
			c.shown = true
			_show_cue(c)
		elif not past and c.shown:
			c.shown = false


func _show_cue(c: Dictionary) -> void:
	var pc := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color("#f3a332") if c.get("unique", false) else (Color("#a7cb0e") if c.mine else Color(0.07, 0.19, 0.21, 0.85))
	sb.set_corner_radius_all(10)
	sb.content_margin_left = 14
	sb.content_margin_right = 14
	sb.content_margin_top = 6
	sb.content_margin_bottom = 6
	sb.border_color = UIK.INK if (c.mine or c.get("unique", false)) else Color(1, 1, 1, 0.7)
	sb.set_border_width_all(3 if c.mine else 2)
	sb.shadow_color = Color(0, 0, 0, 0.35)
	sb.shadow_offset = Vector2(0, 4)
	sb.shadow_size = 1
	pc.add_theme_stylebox_override("panel", sb)
	var lb := UIK.label("", 16, Color.WHITE, "title")
	lb.text = ("%d %s　「%s」" % [int(c.gate), c.name, c.text]) if not c.get("unique", false) else ("★ %s「%s」" % [c.name, c.text])
	lb.add_theme_font_size_override("font_size", 26 if c.get("unique", false) else (22 if c.mine else 16))
	lb.add_theme_color_override("font_color", Color("#113035") if (c.mine or c.get("unique", false)) else Color.WHITE)
	pc.add_child(lb)
	cue_box.add_child(pc)
	pc.modulate.a = 0.0
	pc.position.x = 40.0
	var tw := pc.create_tween()
	tw.tween_property(pc, "modulate:a", 1.0, 0.18)
	tw.tween_interval(2.6 if c.mine else 1.6)
	tw.tween_property(pc, "modulate:a", 0.0, 0.3)
	tw.tween_callback(pc.queue_free)
	# 固有スキルは 1.5 秒だけゆっくり見せる（ゲームの観戦と同じ）
	if c.get("unique", false) and c.mine:
		var keep := play_speed
		play_speed = 0.35
		get_tree().create_timer(1.5).timeout.connect(func() -> void: play_speed = keep)


func _ranked() -> Array:
	var list := runners.duplicate()
	list.sort_custom(func(a, b) -> bool:
		var fa := race_t >= float(a.t_fin)
		var fb := race_t >= float(b.t_fin)
		if fa and fb:
			return int(a.order) < int(b.order)
		if fa != fb:
			return fa
		return float(a.s) > float(b.s))
	return list


func _update_race_camera(delta: float, snap: bool) -> void:
	if not cam_mode in ["tv", "follow", "side", "front"]:
		return
	var list := _ranked()
	var lead: Dictionary = list[0]
	var start: float = race.start
	var w: float = track.width
	var eye: Vector3
	var look: Vector3
	if cam_mode == "tv":
		# 中継：外ラチの外の高い所から、先頭から 3 番手あたりを横から追う（ホームではスタンドの側になる）
		var k := mini(2, list.size() - 1)
		var mid := (float(lead.s) + float(list[k].s)) / 2.0
		look = at_p(start + mid - 4.0, w * 0.3, 1.0)
		eye = at_p(start + mid - 20.0, w + 22.0, 9.0)   # 望遠（画角 30°）で寄る。遠いと馬が点になった
	elif cam_mode == "front":
		# 正面：先頭の馬の少し前の斜めから、向かってくる顔を撮る（手綱と首まわりが見える）
		var off := _off(lead.off, race_t)
		look = at_p(start + float(lead.s) + 0.5, off, 1.6)
		eye = at_p(start + float(lead.s) + 7.0, off + 2.5, 2.3)
	elif cam_mode == "side":
		# 並走：先頭の馬の外を同じ速さで並んで走り、馬を真横から見る（馬と騎手の作りが見える距離）
		var off := _off(lead.off, race_t)
		look = at_p(start + float(lead.s) + 0.3, off, 1.3)
		eye = at_p(start + float(lead.s) + 1.5, off + 7.5, 2.1)
	else:
		# 追走：先頭の馬の斜め後ろ
		var off := _off(lead.off, race_t)
		look = at_p(start + float(lead.s) + 10.0, off, 1.6)
		eye = at_p(start + float(lead.s) - 14.0, off + 4.0, 4.5)
	if snap or cam_eye == Vector3.ZERO:
		cam_eye = eye
		cam_look = look
	else:
		var k2 := clampf(delta * 3.0, 0.0, 1.0)
		cam_eye = cam_eye.lerp(eye, k2)
		cam_look = cam_look.lerp(look, k2)
	camera.set_view(cam_eye, cam_look)


## 枠の色（JRA）：1 白・2 黒・3 赤・4 青・5 黄・6 緑・7 橙・8 桃
const FRAME_BG := [Color("#ffffff"), Color("#222222"), Color("#e23b3b"), Color("#2f62c9"), Color("#f5d230"), Color("#2f9a4a"), Color("#f39a2a"), Color("#f39ac0")]
const FRAME_FG := [Color("#111111"), Color("#ffffff"), Color("#ffffff"), Color("#ffffff"), Color("#111111"), Color("#ffffff"), Color("#111111"), Color("#111111")]


func _update_board() -> void:
	var board: Control = ui.get_node("Board")
	var list := _ranked()
	var lead_s := float(list[0].s)
	var t := minf(race_t, float(race.winnerTime))
	(board.get_node("V/Title") as Label).text = String(race.name)
	var rem := maxf(0.0, float(race.distance) - lead_s)
	(board.get_node("V/Sub") as Label).text = "%d:%04.1f　%s" % [int(t / 60.0), fmod(t, 60.0),
		("残り %dm" % int(ceil(rem))) if rem > 0.0 else ("確定" if race_t >= float(race.winnerTime) + 3.0 else "ゴール")]
	for k in 8:
		var row: Control = board.get_node("V/R%d" % k)
		row.visible = k < list.size()
		if not row.visible:
			continue
		var r: Dictionary = list[k]
		var gap := "" if k == 0 else ("%.1f馬身" % ((lead_s - float(r.s)) / 2.4))
		if race_t >= float(r.t_fin):
			gap = "%d:%04.1f" % [int(float(r.time) / 60.0), fmod(float(r.time), 60.0)]
		var fi := clampi(int(r.get("frame", 1)) - 1, 0, 7)
		var gp: PanelContainer = row.get_node("Gate")
		if gp.get_meta("fi", -1) != fi:
			var sb := StyleBoxFlat.new()
			sb.bg_color = FRAME_BG[fi]
			sb.set_corner_radius_all(5)
			sb.border_color = Color(1, 1, 1, 0.6)
			sb.set_border_width_all(1)
			gp.add_theme_stylebox_override("panel", sb)
			(gp.get_node("L") as Label).add_theme_color_override("font_color", FRAME_FG[fi])
			gp.set_meta("fi", fi)
		(gp.get_node("L") as Label).text = str(int(r.gate))
		var nm: Label = row.get_node("Name")
		nm.text = String(r.name)
		nm.add_theme_color_override("font_color", Color("#ffd36a") if r.get("mine", false) else Color.WHITE)
		(row.get_node("Gap") as Label).text = gap


# ------------------------------------------------------------------ 画面（コースの切り替え）

func _build_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	ui = Control.new()
	ui.set_anchors_preset(Control.PRESET_FULL_RECT)
	ui.mouse_filter = Control.MOUSE_FILTER_IGNORE
	# 画面の札は育成モードと同じ見た目にする（素の灰色のボタンでは「しょぼい」と言われた）：生成りの札に紺の縁、選んでいるものは若草
	var theme := Theme.new()
	theme.default_font = UIK.font("black")
	theme.default_font_size = 14
	for cls in ["Button", "OptionButton"]:
		for st in ["normal", "hover", "pressed", "hover_pressed", "focus", "disabled"]:
			var sb := StyleBoxFlat.new()
			sb.bg_color = {normal = UIK.PAPER, hover = Color("#ffffff"), pressed = UIK.LEAF2, hover_pressed = UIK.LEAF2, disabled = Color("#d9d3c4")}.get(st, UIK.PAPER)
			sb.set_corner_radius_all(10)
			sb.border_color = UIK.INK
			sb.set_border_width_all(2)
			sb.shadow_color = Color(0, 0, 0, 0.3)
			sb.shadow_offset = Vector2(0, 3)
			sb.shadow_size = 1
			sb.content_margin_left = 10
			sb.content_margin_right = 10
			sb.content_margin_top = 4
			sb.content_margin_bottom = 5
			if st == "focus":
				sb.draw_center = false
				sb.shadow_size = 0
				sb.border_color = UIK.SUN
			theme.set_stylebox(st, cls, sb)
		for c in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
			theme.set_color(c, cls, UIK.INK)
	ui.theme = theme
	layer.add_child(ui)

	var bar := HBoxContainer.new()
	bar.name = "Bar"
	bar.position = Vector2(12, 12)
	bar.add_theme_constant_override("separation", 8)
	ui.add_child(bar)

	var rp := OptionButton.new()
	rp.name = "Race"
	rp.add_item("コースを見る")
	rp.set_item_metadata(0, "")
	for r in races:
		rp.add_item(String(r.name))
		rp.set_item_metadata(rp.item_count - 1, r.id)
	rp.item_selected.connect(func(k: int) -> void:
		var id: String = rp.get_item_metadata(k)
		if id == "":
			load_course(course_id, surface)
		else:
			load_race(id))
	bar.add_child(rp)

	var play := Button.new()
	play.name = "Play"
	play.text = "一時停止"
	play.pressed.connect(func() -> void:
		if race.is_empty():
			return
		if race_t >= race_duration():
			race_t = 0.0
			playing = true
		else:
			playing = not playing
		_sync_ui())
	bar.add_child(play)
	var again := Button.new()
	again.name = "Again"
	again.text = "最初から"
	again.pressed.connect(func() -> void:
		if race.is_empty():
			return
		race_t = 0.0
		playing = true
		cam_eye = Vector3.ZERO
		_sync_ui())
	bar.add_child(again)
	var spd := Button.new()
	spd.name = "Speed"
	spd.text = "×1"
	spd.pressed.connect(func() -> void:
		play_speed = {1.0: 2.0, 2.0: 4.0, 4.0: 0.5, 0.5: 1.0}.get(play_speed, 1.0)
		spd.text = "×%s" % ("0.5" if play_speed == 0.5 else str(int(play_speed))))
	bar.add_child(spd)

	var pick := OptionButton.new()
	pick.name = "Course"
	var seen := {}
	for t in tracks:
		if seen.has(t.id):
			continue
		seen[t.id] = true
		pick.add_item(String(t.short))
		pick.set_item_metadata(pick.item_count - 1, t.id)
	pick.item_selected.connect(func(k: int) -> void: load_course(pick.get_item_metadata(k), surface))
	bar.add_child(pick)

	var surf := OptionButton.new()
	surf.name = "Surface"
	surf.add_item("芝")
	surf.add_item("ダート")
	surf.item_selected.connect(func(k: int) -> void: load_course(course_id, "turf" if k == 0 else "dirt"))
	bar.add_child(surf)

	var cams := HBoxContainer.new()
	cams.name = "Cams"
	var group := ButtonGroup.new()
	for c in [["tv", "中継"], ["follow", "追走"], ["side", "並走"], ["front", "正面"], ["stand", "スタンド"], ["aerial", "上空"], ["ride", "走路を回る"], ["free", "自由"]]:
		var bt := Button.new()
		bt.name = c[0]
		bt.text = c[1]
		bt.toggle_mode = true
		bt.button_group = group
		bt.pressed.connect(set_camera.bind(c[0]))
		cams.add_child(bt)
	bar.add_child(cams)

	var info := Label.new()
	info.name = "Info"
	info.position = Vector2(14, 52)
	info.add_theme_color_override("font_color", Color.WHITE)
	info.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.7))
	info.add_theme_constant_override("outline_size", 4)
	ui.add_child(info)

	# 着順の板（左上）。レースのときだけ出す。題・時計と残り・上位 8 頭（順位・枠の色の馬番・馬名・差）
	# 行は最初に作って中身だけ書き換える（毎コマ作り直すと重く、押したときに行が入れ替わる。落とし穴 50）
	var board := PanelContainer.new()
	board.name = "Board"
	board.position = Vector2(14, 58 if embedded else 84)   # 競馬場単体ではコースの説明の行の下
	board.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var bsb := StyleBoxFlat.new()
	bsb.bg_color = Color(0.067, 0.188, 0.208, 0.84)
	bsb.set_corner_radius_all(12)
	bsb.border_color = Color(1, 1, 1, 0.85)
	bsb.set_border_width_all(2)
	bsb.content_margin_left = 12
	bsb.content_margin_right = 14
	bsb.content_margin_top = 8
	bsb.content_margin_bottom = 10
	board.add_theme_stylebox_override("panel", bsb)
	var bv := VBoxContainer.new()
	bv.name = "V"
	bv.add_theme_constant_override("separation", 3)
	var title := UIK.label("", 18, Color("#fff4dc"), "title")
	title.name = "Title"
	bv.add_child(title)
	var sub := UIK.label("", 13, UIK.LEAF2, "black")
	sub.name = "Sub"
	bv.add_child(sub)
	for k in 8:
		var row := HBoxContainer.new()
		row.name = "R%d" % k
		row.add_theme_constant_override("separation", 7)
		var rk := UIK.label(str(k + 1), 16, Color("#ffd36a") if k < 3 else Color.WHITE, "title")
		rk.custom_minimum_size.x = 18
		rk.name = "Rank"
		row.add_child(rk)
		var gp := PanelContainer.new()
		gp.name = "Gate"
		gp.custom_minimum_size = Vector2(24, 20)
		var gl := UIK.label("", 12, UIK.INK, "black")
		gl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		gl.name = "L"
		gp.add_child(gl)
		row.add_child(gp)
		var nm := UIK.label("", 14, Color.WHITE, "black")
		nm.name = "Name"
		nm.custom_minimum_size.x = 150
		row.add_child(nm)
		var gap := UIK.label("", 12, Color("#cfe0d6"), "body")
		gap.name = "Gap"
		row.add_child(gap)
		bv.add_child(row)
	board.add_child(bv)
	ui.add_child(board)

	# スキルの演出の札（右上から下へ積む）
	cue_box = VBoxContainer.new()
	cue_box.name = "Cues"
	cue_box.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	cue_box.position = Vector2(-20, 70)
	cue_box.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	cue_box.alignment = BoxContainer.ALIGNMENT_BEGIN
	cue_box.add_theme_constant_override("separation", 6)
	cue_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.add_child(cue_box)

	if not embedded:
		var back := Button.new()
		back.text = "◀ カード育成"
		back.pressed.connect(func() -> void: get_tree().change_scene_to_file("res://scenes/ikusei.tscn"))
		bar.add_child(back)
		bar.move_child(back, 0)
	if embedded:
		for nm in ["Race", "Course", "Surface"]:
			bar.get_node(nm).visible = false
		info.visible = false
		var skip := Button.new()
		skip.text = "ゴールまで飛ばす"
		skip.pressed.connect(func() -> void:
			var last := 0.0
			for r in runners:
				last = maxf(last, float(r.t_fin))
			race_t = maxf(race_t, last)
			_update_race(0.0, true))
		bar.add_child(skip)
		var done := Button.new()
		done.text = "結果へ ▶"
		done.add_theme_color_override("font_color", Color("#f3a332"))
		done.pressed.connect(func() -> void: finished.emit())
		bar.add_child(done)


func _sync_ui() -> void:
	var pick: OptionButton = ui.get_node("Bar/Course")
	for k in pick.item_count:
		if pick.get_item_metadata(k) == course_id:
			pick.select(k)
	var surf: OptionButton = ui.get_node("Bar/Surface")
	surf.select(0 if surface == "turf" else 1)
	var rp: OptionButton = ui.get_node("Bar/Race")
	for k in rp.item_count:
		if rp.get_item_metadata(k) == String(race.get("id", "")):
			rp.select(k)
	for nm in ["Play", "Again", "Speed"]:
		ui.get_node("Bar/" + nm).visible = not race.is_empty()
	var play: Button = ui.get_node("Bar/Play")
	play.text = "一時停止" if playing else "再生"
	var board: Control = ui.get_node("Board")
	board.visible = not race.is_empty()
	var info: Label = ui.get_node("Info")
	if embedded:
		return
	info.text = "%s %s　1 周 %dm・直線 %dm・幅 %dm・高低差 %.1fm（%s回り）　自由：右ドラッグで回す・ホイールで寄る・中ドラッグで動かす" % [
		track.name, "芝" if surface == "turf" else "ダート", int(track.lap), int(track.homeStraight), int(track.width),
		float(track.rise), "右" if track.dir == "right" else "左"]
