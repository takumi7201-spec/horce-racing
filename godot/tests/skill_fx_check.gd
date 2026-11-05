extends SceneTree
## 固有スキルのエフェクト（skill_fx.gd）を 8 種並べて撮る（ゲームの render3d/skillfx.js の 3D と見比べる）。
## xvfb-run -a -s "-screen 0 1600x900x24" godot --path godot --rendering-method gl_compatibility --rendering-driver opengl3 --script tests/skill_fx_check.gd -- --shot=/tmp/fx.png
const HM := preload("res://scripts/horse_model.gd")
const FX := preload("res://scripts/skill_fx.gd")

var shot := "/tmp/skill_fx.png"
var frames := 0
var cams: Array = []
var views: Array = []
var fxs: Array = []


func _init() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shot="):
			shot = a.substr(7)
	var data: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/ikusei/data.json"))
	var kinds: Array = data.skillFx.keys()
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
		cam.look_at_from_position(Vector3(12, 2.2, 4.2), Vector3(0, 1.4, 0))
		var fx := Node3D.new()
		fx.set_script(FX)
		fx.setup(kinds[i], data.skillFx[kinds[i]], 9)
		h.add_child(fx)
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
	# 粒が出そろうまで（エフェクトの経過 1 秒）待ってから撮る。コマが重いので、コマ数ではなく経過で見る
	if frames < 0 or not is_instance_valid(fxs[0]) or fxs[0].age < 1.0:
		return
	frames = -1000
	await RenderingServer.frame_post_draw
	get_root().get_texture().get_image().save_png(shot)
	print("saved ", shot)
	quit()
