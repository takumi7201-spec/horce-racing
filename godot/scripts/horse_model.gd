extends Node3D
## レースの馬と騎手（簡易の立体）。build() で毛色・勝負服・ゼッケンを決め、pose() で襲歩の脚を動かす。
##
## 前は -Z（Godot の look_at と同じ向き）。寸法は実寸（m）：体高 1.6m、胸から尻まで 1.7m 前後
## （three.js 版で、胴を長くすると近くで腸詰めに見えた。落とし穴 25）。
## 脚は付け根（肩・股）と膝（飛節）の 2 関節。前脚の膝は蹄を後ろへ、後脚の飛節は蹄を前へ畳む
## （同じ向きに曲げると逆関節に見えた。落とし穴 82）。

const COATS := {
	"鹿毛": [Color(0.42, 0.22, 0.10), Color(0.08, 0.06, 0.05)],
	"黒鹿毛": [Color(0.24, 0.13, 0.07), Color(0.06, 0.05, 0.04)],
	"青鹿毛": [Color(0.13, 0.08, 0.06), Color(0.05, 0.04, 0.04)],
	"青毛": [Color(0.07, 0.07, 0.08), Color(0.04, 0.04, 0.05)],
	"栗毛": [Color(0.58, 0.30, 0.12), Color(0.62, 0.38, 0.18)],
	"栃栗毛": [Color(0.40, 0.20, 0.09), Color(0.45, 0.30, 0.18)],
	"芦毛": [Color(0.70, 0.70, 0.68), Color(0.55, 0.55, 0.55)],
	"白毛": [Color(0.93, 0.93, 0.91), Color(0.90, 0.90, 0.88)],
}
## JRA の枠の帽色（1 白・2 黒・3 赤・4 青・5 黄・6 緑・7 橙・8 桃）
const FRAME_CAP := [Color.WHITE, Color(0.1, 0.1, 0.1), Color(0.85, 0.15, 0.15), Color(0.15, 0.35, 0.8),
	Color(0.95, 0.85, 0.15), Color(0.15, 0.6, 0.3), Color(0.95, 0.55, 0.15), Color(0.95, 0.6, 0.75)]
const SILK_COLORS := [Color(0.85, 0.12, 0.15), Color(0.1, 0.25, 0.7), Color(0.95, 0.8, 0.1), Color(0.1, 0.55, 0.3),
	Color(0.55, 0.15, 0.6), Color(0.95, 0.95, 0.95), Color(0.1, 0.1, 0.12), Color(0.95, 0.45, 0.1), Color(0.3, 0.7, 0.85)]

var body: Node3D      # 胴より上（上下に弾む）
var legs: Array = []  # [付け根, 膝, 位相のずれ, 前脚か]
var neck: Node3D
var tail: Node3D
var phase := 0.0


func _m(c: Color, rough := 0.7) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	return m


func _part(parent: Node3D, mesh: Mesh, mat: Material, pos: Vector3, rot := Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = pos
	mi.rotation = rot
	parent.add_child(mi)
	return mi


func _capsule(r: float, h: float) -> CapsuleMesh:
	var c := CapsuleMesh.new()
	c.radius = r
	c.height = h
	c.radial_segments = 12
	c.rings = 4
	return c


func _cyl(r0: float, r1: float, h: float) -> CylinderMesh:
	var c := CylinderMesh.new()
	c.top_radius = r0
	c.bottom_radius = r1
	c.height = h
	c.radial_segments = 10
	return c


## coat：毛色の名前 / frame：枠（1〜8）/ gate：馬番 / silks：{body, accent, cap} か null / seed：勝負服を決める数
func build(coat: String, frame: int, gate: int, silks, seed: int, font: Font) -> void:
	var cc: Array = COATS.get(coat, COATS["鹿毛"])
	var hide := _m(cc[0], 0.55)
	var mane := _m(cc[1], 0.8)
	var hoof := _m(Color(0.12, 0.11, 0.1), 0.6)

	body = Node3D.new()
	add_child(body)
	# 胴：胸と尻を球でふくらませ、間を横たえたカプセルでつなぐ
	_part(body, _capsule(0.34, 1.75), hide, Vector3(0, 1.32, 0), Vector3(PI / 2, 0, 0))
	var chest := SphereMesh.new(); chest.radius = 0.37; chest.height = 0.8
	_part(body, chest, hide, Vector3(0, 1.30, -0.55))
	var rump := SphereMesh.new(); rump.radius = 0.38; rump.height = 0.78
	_part(body, rump, hide, Vector3(0, 1.36, 0.58))
	# 首と頭。首は付け根を胸に埋め、前上へ 40° 起こす
	neck = Node3D.new()
	neck.position = Vector3(0, 1.48, -0.72)
	body.add_child(neck)
	_part(neck, _capsule(0.17, 0.95), hide, Vector3(0, 0.29, -0.37), Vector3(-0.9, 0, 0))
	_part(neck, _capsule(0.05, 0.75), mane, Vector3(0, 0.38, -0.3), Vector3(-0.9, 0, 0))   # たてがみ
	_part(neck, _capsule(0.12, 0.62), hide, Vector3(0, 0.42, -0.95), Vector3(-2.3, 0, 0))   # 頭（項から鼻先を前下へ）
	for s in [-1.0, 1.0]:
		var ear := _part(neck, _cyl(0.0, 0.035, 0.13), hide, Vector3(0.05 * s, 0.68, -0.76), Vector3(-0.3, 0, 0.2 * s))
		ear.name = "Ear"
	# 尾
	tail = Node3D.new()
	tail.position = Vector3(0, 1.52, 0.92)
	body.add_child(tail)
	_part(tail, _capsule(0.07, 0.8), mane, Vector3(0, -0.2, 0.3), Vector3(2.14, 0, 0))   # 後ろ下へ（上げると棒に見える）

	# 脚。位相のずれは回転襲歩（左後 → 右後 → 左前 → 右前）
	var spots := [[Vector3(-0.17, 1.12, -0.6), 0.55, true], [Vector3(0.17, 1.12, -0.6), 0.65, true],
		[Vector3(-0.17, 1.18, 0.62), 0.0, false], [Vector3(0.17, 1.18, 0.62), 0.1, false]]
	for sp in spots:
		var root := Node3D.new()
		root.position = sp[0]
		add_child(root)   # 脚は弾ませない（蹄が地面から浮かないように）
		var front: bool = sp[2]
		var up_len := 0.5 if front else 0.55
		_part(root, _cyl(0.085, 0.065, up_len), hide, Vector3(0, -up_len / 2.0, 0))
		var knee := Node3D.new()
		knee.position = Vector3(0, -up_len, 0)
		root.add_child(knee)
		var lo_len := 0.58 if front else 0.55
		_part(knee, _cyl(0.05, 0.045, lo_len), hide, Vector3(0, -lo_len / 2.0, 0))
		_part(knee, _cyl(0.055, 0.065, 0.08), hoof, Vector3(0, -lo_len - 0.02, 0))
		legs.append([root, knee, sp[1], front])

	# 鞍下のゼッケン（白地に黒の数字）
	var cloth := BoxMesh.new(); cloth.size = Vector3(0.74, 0.42, 0.62)
	_part(body, cloth, _m(Color(0.96, 0.96, 0.94), 0.9), Vector3(0, 1.5, -0.08))
	for s in [-1.0, 1.0]:
		var lab := Label3D.new()
		lab.text = str(gate)
		lab.font = font
		lab.font_size = 64
		lab.pixel_size = 0.004
		lab.modulate = Color(0.05, 0.05, 0.05)
		lab.outline_size = 0
		lab.position = Vector3(0.375 * s, 1.47, -0.08)
		lab.rotation = Vector3(0, PI / 2.0 * s, 0)
		body.add_child(lab)

	# 騎手：モンキー乗り（上体を前へ倒して鞍の上に浮く）
	var silk_body: Color
	var silk_acc: Color
	var cap: Color = FRAME_CAP[clampi(frame - 1, 0, 7)]
	if silks is Dictionary:
		silk_body = Color(String(silks.get("body", "#c02020")))
		silk_acc = Color(String(silks.get("accent", "#ffffff")))
		if silks.has("cap"):
			cap = Color.hex((int(silks.cap) << 8) | 0xff)
	else:
		silk_body = SILK_COLORS[seed % SILK_COLORS.size()]
		silk_acc = SILK_COLORS[(seed / 7) % SILK_COLORS.size()]
		if silk_acc == silk_body:
			silk_acc = Color.WHITE
	var jk := Node3D.new()
	jk.position = Vector3(0, 1.78, -0.05)
	body.add_child(jk)
	var torso := BoxMesh.new(); torso.size = Vector3(0.36, 0.55, 0.26)
	_part(jk, torso, _m(silk_body, 0.6), Vector3(0, 0.22, -0.12), Vector3(-1.15, 0, 0))
	var band := BoxMesh.new(); band.size = Vector3(0.37, 0.12, 0.27)
	_part(jk, band, _m(silk_acc, 0.6), Vector3(0, 0.26, -0.2), Vector3(-1.15, 0, 0))
	var head := SphereMesh.new(); head.radius = 0.13; head.height = 0.24
	_part(jk, head, _m(cap, 0.4), Vector3(0, 0.42, -0.42))
	for s in [-1.0, 1.0]:
		_part(jk, _capsule(0.05, 0.5), _m(silk_acc, 0.6), Vector3(0.2 * s, 0.16, -0.42), Vector3(-1.3, 0, 0))   # 腕（手綱へ）
		_part(jk, _capsule(0.07, 0.45), _m(Color(0.95, 0.95, 0.95), 0.8), Vector3(0.22 * s, 0.0, 0.05), Vector3(-0.6, 0, 0))   # 腿
		_part(jk, _capsule(0.055, 0.42), _m(Color(0.08, 0.08, 0.08), 0.5), Vector3(0.25 * s, -0.22, -0.08), Vector3(0.5, 0, 0))   # 長靴


## 襲歩。phase は 1 完歩で 0→1、speed は m/s（止まっていれば脚を下ろして立つ）。
func pose(ph: float, speed: float) -> void:
	phase = ph
	var amp := clampf(speed / 16.0, 0.0, 1.0)
	var t := TAU * phase
	body.position.y = 0.05 * amp * sin(2.0 * t)
	body.rotation.x = 0.04 * amp * sin(t + 0.6)
	neck.rotation.x = 0.12 * amp * sin(t + 1.2)
	tail.rotation.x = 0.15 * amp * sin(t)
	for L in legs:
		var a: float = t + TAU * float(L[2])
		var swing := sin(a)
		var lift := maxf(0.0, cos(a))   # 前へ振り出している間だけ畳む
		var root: Node3D = L[0]
		var knee: Node3D = L[1]
		if L[3]:
			root.rotation.x = amp * (0.55 * swing + 0.1)
			knee.rotation.x = -amp * 1.2 * lift   # 前脚の膝：蹄を後ろへ
		else:
			root.rotation.x = amp * (0.5 * swing - 0.15)
			knee.rotation.x = amp * 1.0 * lift    # 後脚の飛節：蹄を前へ
