extends Camera3D
## 競馬場を見るカメラ。set_view(目, 見る点) で置き、free_look のときだけマウスとキーで動かせる。
## 右ドラッグで回す・中ドラッグ（または Shift＋右）で平行に動かす・ホイールで寄る・WASD で動かす。

var free_look := false
var target := Vector3.ZERO
var yaw := 0.0
var pitch := -0.4
var dist := 200.0
var _rot := false
var _pan := false


func _ready() -> void:
	fov = 50.0
	near = 0.3
	far = 6000.0
	current = true


## 目の位置と見る点から置く。自由に切り替えたとき、その場所から続けて動かせるよう yaw・pitch・距離も覚える。
func set_view(eye: Vector3, look: Vector3) -> void:
	target = look
	var d := eye - look
	dist = d.length()
	yaw = atan2(d.x, d.z)
	pitch = -asin(clampf(d.y / max(dist, 0.001), -1.0, 1.0))
	look_at_from_position(eye, look, Vector3.UP)


func _apply() -> void:
	var d := Vector3(sin(yaw) * cos(pitch), -sin(pitch), cos(yaw) * cos(pitch)) * dist
	look_at_from_position(target + d, target, Vector3.UP)


func _unhandled_input(e: InputEvent) -> void:
	if not free_look:
		return
	if e is InputEventMouseButton:
		var mb := e as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_RIGHT:
			_rot = mb.pressed and not mb.shift_pressed
			_pan = mb.pressed and mb.shift_pressed
		elif mb.button_index == MOUSE_BUTTON_MIDDLE:
			_pan = mb.pressed
		elif mb.button_index == MOUSE_BUTTON_WHEEL_UP and mb.pressed:
			dist = max(5.0, dist * 0.88)
			_apply()
		elif mb.button_index == MOUSE_BUTTON_WHEEL_DOWN and mb.pressed:
			dist = min(4000.0, dist / 0.88)
			_apply()
	elif e is InputEventMouseMotion:
		var mm := e as InputEventMouseMotion
		if _rot:
			yaw -= mm.relative.x * 0.005
			pitch = clampf(pitch - mm.relative.y * 0.005, -1.5, 0.1)
			_apply()
		elif _pan:
			var s := dist * 0.0015
			target += (-global_basis.x * mm.relative.x + Vector3(global_basis.z.x, 0, global_basis.z.z).normalized() * -mm.relative.y) * s
			_apply()


func _process(delta: float) -> void:
	if not free_look:
		return
	var v := Vector3.ZERO
	if Input.is_key_pressed(KEY_W): v -= global_basis.z
	if Input.is_key_pressed(KEY_S): v += global_basis.z
	if Input.is_key_pressed(KEY_A): v -= global_basis.x
	if Input.is_key_pressed(KEY_D): v += global_basis.x
	if v != Vector3.ZERO:
		v.y = 0
		target += v.normalized() * dist * 0.8 * delta
		_apply()
