extends SceneTree
## 固有スキルのエフェクト（skill_fx.gd）を 8 種並べて撮る（ゲームの render3d/skillfx.js の 3D と見比べる）。
## xvfb-run -a -s "-screen 0 1600x900x24" godot --path godot --rendering-method gl_compatibility --rendering-driver opengl3 --script tests/skill_fx_check.gd -- --shot=/tmp/fx.png
## （--only=gale で 1 種を時間の順に 4 枚、--campos=0.3,1.8,14 でカメラの位置）
const HM := preload("res://scripts/horse_model.gd")
const FX := preload("res://scripts/skill_fx.gd")

var shot := "/tmp/skill_fx.png"
var frames := 0
var cams: Array = []
var views: Array = []
var fxs: Array = []
var pending: Array = []


func _init() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shot="):
			shot = a.substr(7)
	var data: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/ikusei/data.json"))
	var kinds: Array = data.skillFx.keys()
	# --only=gale：その種類だけを 4 枚、経過 0.12・0.5・1.0・1.8 秒で並べる（発動の閃光から竜巻まで）
	var only := ""
	# --campos=x,y,z：カメラの位置（既定は斜め前の横。正面 0.3,1.8,14・真上 0.4,22,0.6 で、帯が線にならないかを見る）
	var campos := Vector3(12, 2.2, 4.2)
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--only="):
			only = a.substr(7)
		if a.begins_with("--campos="):
			var c := a.substr(9).split(",")
			campos = Vector3(float(c[0]), float(c[1]), float(c[2]))
	if only != "":
		kinds = [only, only, only, only]
	var grid := GridContainer.new()
	grid.columns = 4
	grid.add_theme_constant_override("h_separation", 0)
	grid.add_theme_constant_override("v_separation", 0)
	get_root().add_child(grid)
	for i in kinds.size():
		var svc := SubViewportContainer.new()
		var sv := SubViewport.new()
		sv.size = Vector2i(400, 400)
		sv.own_world_3d = true
		svc.add_child(sv)
		grid.add_child(svc)
		var env := WorldEnvironment.new()
		env.environment = Environment.new()
		env.environment.background_mode = Environment.BG_COLOR
		env.environment.background_color = Color("#9fc8e8")
		env.environment.ambient_light_color = Color.WHITE
		env.environment.ambient_light_energy = 0.8
		sv.add_child(env)
		var sun := DirectionalLight3D.new()
		sun.rotation = Vector3(-0.9, 0.6, 0)
		sv.add_child(sun)
		var ground := MeshInstance3D.new()
		var pm := PlaneMesh.new()
		pm.size = Vector2(200, 200)
		ground.mesh = pm
		var gm := StandardMaterial3D.new()
		gm.albedo_color = Color("#4c9a3c")
		ground.material_override = gm
		sv.add_child(ground)
		var h = HM.new()
		sv.add_child(h)
		h.build("res://assets/horse/skins/arima", 3, "turf")
		var cam := Camera3D.new()
		cam.fov = 30
		sv.add_child(cam)
		cam.look_at_from_position(campos, Vector3(0, 1.4, 0))
		var fx := Node3D.new()
		fx.set_script(FX)
		h.add_child(fx)
		# 組むのは木に入ってから（オーラの粒の出どころ＝馬の体の頂点を、木の中の位置で写す）
		pending.append([fx, kinds[i], data.skillFx[kinds[i]], h])
		fxs.append(fx)
		var lb := Label.new()
		lb.text = data.skillFx[kinds[i]].name
		lb.add_theme_font_size_override("font_size", 22)
		lb.position = Vector2(8, 4)
		svc.add_child(lb)
		views.append(sv)
	process_frame.connect(_tick)


func _tick() -> void:
	frames += 1
	if frames == 1:
		var offs := [-0.88, -0.5, 0.0, 0.8]
		for i in pending.size():
			var q = pending[i]
			q[0].setup(q[1], q[2], 9, q[3])
			if pending.size() == 4 and q[1] == pending[0][1]:
				q[0].age = offs[i]
		return
	# 粒が出そろうまで（エフェクトの経過 1 秒）待ってから撮る。コマが重いので、コマ数ではなく経過で見る
	var watch = fxs[2] if fxs.size() == 4 else fxs[0]
	if frames < 0 or not is_instance_valid(watch) or watch.age < 1.0:
		return
	frames = -1000
	await RenderingServer.frame_post_draw
	get_root().get_texture().get_image().save_png(shot)
	print("saved ", shot)
	quit()
