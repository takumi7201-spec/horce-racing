extends RefCounted
## 育成モードの画面の部品（ゲームの styles.css の「育成モード」の部品を Godot で）。
##
## - Box：角の丸い箱。グラデーション・紺の縁・白い縁・下にずらした影を shaders/ui_box.gdshader で 1 枚に描く。
##   StyleBoxFlat は 1 色しか塗れず、ゲームの見出しの帯（--grad）や下のボタン列のグラデーションが出せなかった。
##   中身は余白（pad）の内側に敷き詰める（PanelContainer と同じ）。press で押せる箱になる（指が乗ると明るく、押すと沈む）。
## - 字：本文・太字・見出し（斜体の極太）。ゲームの見出しは font: italic 900。Godot の SystemFont は斜体の字を持たない
##   日本語の字体が多いので、FontVariation の変形で傾ける。
## - アイコン：ゲームと同じ 24×24 の線の絵（assets/ui/icons、tools/export-godot-ikusei.mjs が書く）。白で描いて modulate で色を付ける。

const SHADER := preload("res://shaders/ui_box.gdshader")
const INK := Color("#113035")
const TEAL2 := Color("#2c5a55")
const LEAF := Color("#a7cb0e")
const LEAF2 := Color("#d3e27f")
const SUN := Color("#f3a332")
const SUN2 := Color("#f8d5a0")
const PAPER := Color("#fbf8ef")
const GRAD := [Color("#113035"), Color("#2f5a45"), Color("#8fae2a"), Color("#dc9f4c")]   # 見出しの帯（--grad）

const NAMES := ["Yu Gothic UI", "Meiryo", "Hiragino Sans", "Noto Sans CJK JP", "Noto Sans JP", "IPAGothic"]
static var _fonts := {}


## 字体。kind：body・bold・black・title（斜体の極太）。
## 字体は同梱の M PLUS 1p（assets/fonts、OFL）。ゲームの見出しは system-ui の 900 だが、Godot の SystemFont は端末で太さがばらつき
## （クラウドの Linux は IPAGothic の 1 本だけで、見出しが細い等幅になった）、持ち主の Windows とも絵が変わる。同梱して揃える。
static func font(kind := "body") -> Font:
	if _fonts.has(kind):
		return _fonts[kind]
	var file: String = {body = "Medium", bold = "Bold", black = "Black", title = "Black"}[kind]
	var path := "res://assets/fonts/MPLUS1p-%s.ttf" % file
	var base: Font
	if ResourceLoader.exists(path):
		base = load(path)
		# M PLUS 1p に無い字（聳）は端末の字体で出す。無いと豆腐になる（落とし穴 16 と同じ型）
		if base.fallbacks.is_empty():
			var sys := SystemFont.new()
			sys.font_names = PackedStringArray(NAMES)
			base.fallbacks = [sys]
	else:
		var f := SystemFont.new()
		f.font_names = PackedStringArray(NAMES)
		f.font_weight = {body = 500, bold = 700, black = 900, title = 900}[kind]
		base = f
	var out: Font = base
	if kind == "title":
		# ゲームの見出しは italic。日本語の字体に斜体は無いので、字の形を傾ける（上ほど右）
		var v := FontVariation.new()
		v.base_font = base
		v.variation_transform = Transform2D(Vector2(1, 0), Vector2(0.22, 1), Vector2.ZERO)
		out = v
	_fonts[kind] = out
	return out


static func label(text: String, size := 16, color := INK, kind := "body") -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", font(kind))
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


## 縁取りした字（空の上・写真の上）
static func outlined(text: String, size := 18, color := Color.WHITE, kind := "title", outline := INK, w := 7) -> Label:
	var l := label(text, size, color, kind)
	l.add_theme_color_override("font_outline_color", outline)
	l.add_theme_constant_override("outline_size", w)
	return l


static func icon(name: String, size := 24.0, color := INK) -> TextureRect:
	var t := TextureRect.new()
	var path := "res://assets/ui/icons/%s.svg" % name
	t.texture = load(path) if ResourceLoader.exists(path) else null
	t.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	t.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	t.custom_minimum_size = Vector2(size, size)
	t.modulate = color
	t.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return t


## 角の丸い窓で切り抜く（shaders/ui_mask.gdshader）。radius に 999 で丸
static func mask(c: Control, radius := 12.0) -> Control:
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/ui_mask.gdshader")
	m.set_shader_parameter("radius", radius)
	c.material = m
	var upd := func() -> void: m.set_shader_parameter("size", c.size)
	c.resized.connect(upd)
	c.item_rect_changed.connect(upd)
	c.draw.connect(upd)
	upd.call()
	return c


static func hbox(sep := 8, align := BoxContainer.ALIGNMENT_BEGIN) -> HBoxContainer:
	var b := HBoxContainer.new()
	b.add_theme_constant_override("separation", sep)
	b.alignment = align
	b.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return b


static func vbox(sep := 8, align := BoxContainer.ALIGNMENT_BEGIN) -> VBoxContainer:
	var b := VBoxContainer.new()
	b.add_theme_constant_override("separation", sep)
	b.alignment = align
	b.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return b


static func box(o := {}) -> Box:
	var b := Box.new()
	b.setup(o)
	return b


## 押せる箱（ボタン）。kind：primary（若草のグラデーション）・paper・sun・teal・ghost
static func button(text: String, cb: Callable, kind := "paper", size := 16, icon_name := "") -> Box:
	var cols: Array = {primary = [Color("#cfe06a"), LEAF], paper = [PAPER, PAPER], sun = [Color("#f8cf8f"), SUN], teal = [TEAL2, INK],
		leaf2 = [LEAF2, LEAF2], off = [Color("#e9e3d2"), Color("#e9e3d2")]}.get(kind, [PAPER, PAPER])
	var b := box({c = cols, angle = 180.0, radius = 12.0, border = 3.0, shadow = Vector2(0, 4), pad = Vector4(16, 7, 16, 9)})
	var h := hbox(6, BoxContainer.ALIGNMENT_CENTER)
	var fg := Color.WHITE if kind == "teal" else INK
	if icon_name != "":
		h.add_child(icon(icon_name, size + 2, fg))
	h.add_child(label(text, size, fg if kind != "off" else Color("#7b8a88"), "black"))
	b.add_child(h)
	if kind != "off":
		b.press(cb)
	return b


## 丸い札（絞り込み）
static func chip(text: String, on: bool, cb: Callable, size := 13) -> Box:
	var b := box({c = [LEAF2 if on else PAPER], radius = 999.0, border = 2.5, shadow = Vector2(0, 3), pad = Vector4(14, 5, 14, 6)})
	b.add_child(label(text, size, INK, "black"))
	b.press(cb)
	return b


## 見出しの帯の付いた枠（ゲームの .card・.card-h）。title の右に right（任意）
static func section(title: String, content: Control, right: Control = null) -> Box:
	var outer := box({c = [PAPER], radius = 16.0, border = 3.0, shadow = Vector2(0, 6), pad = Vector4(3, 3, 3, 3)})
	var v := vbox(0)
	var head := box({c = GRAD, s1 = 0.48, s2 = 0.8, angle = 90.0, radii = Vector4(0, 13, 0, 13), border = 0.0, shadow = Vector2.ZERO, pad = Vector4(14, 6, 14, 7)})
	var hh := hbox(8)
	var t := outlined(title, 17, Color.WHITE, "title", Color("#0d2a2e"), 4)
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hh.add_child(t)
	if right:
		hh.add_child(right)
	head.add_child(hh)
	v.add_child(head)
	var line := ColorRect.new()
	line.color = INK
	line.custom_minimum_size.y = 3
	v.add_child(line)
	var m := MarginContainer.new()
	for k in ["left", "right"]:
		m.add_theme_constant_override("margin_" + k, 12)
	m.add_theme_constant_override("margin_top", 10)
	m.add_theme_constant_override("margin_bottom", 12)
	m.add_child(content)
	v.add_child(m)
	outer.add_child(v)
	return outer


## 角の丸い箱。o：c（色の並び 1〜4）・s1・s2・angle・radius か radii（右下・右上・左下・左上）・border・border_color・
## outline・outline_color・shadow・shadow_color・pad（中身の余白：左・上・右・下）・dots
class Box extends Container:
	signal pressed
	const DRAW_PAD := 16.0
	var pad := Vector4(12, 8, 12, 8)
	var mat: ShaderMaterial
	var _press := false
	var _down := false

	func setup(o: Dictionary) -> void:
		mat = ShaderMaterial.new()
		mat.shader = load("res://shaders/ui_box.gdshader")
		material = mat
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		set_style(o)

	func set_style(o: Dictionary) -> void:
		var cs: Array = o.get("c", [Color("#fbf8ef")])
		var c4 := [cs[0], cs[mini(1, cs.size() - 1)], cs[mini(2, cs.size() - 1)], cs[cs.size() - 1]]
		if cs.size() == 2:
			c4 = [cs[0], cs[0].lerp(cs[1], 0.33), cs[0].lerp(cs[1], 0.66), cs[1]]
		elif cs.size() == 3:
			c4 = [cs[0], cs[1], cs[1], cs[2]]
		for i in 4:
			mat.set_shader_parameter("c%d" % i, c4[i])
		var s1: float = o.get("s1", 0.33 if cs.size() != 3 else 0.5)
		var s2: float = o.get("s2", 0.66 if cs.size() != 3 else 0.5001)
		mat.set_shader_parameter("s1", s1)
		mat.set_shader_parameter("s2", s2)
		mat.set_shader_parameter("angle", o.get("angle", 180.0))
		var r = o.get("radii", null)
		if r == null:
			var rr: float = o.get("radius", 14.0)
			r = Vector4(rr, rr, rr, rr)
		mat.set_shader_parameter("radii", r)
		mat.set_shader_parameter("border", o.get("border", 3.0))
		mat.set_shader_parameter("border_color", o.get("border_color", Color("#113035")))
		mat.set_shader_parameter("outline", o.get("outline", 0.0))
		mat.set_shader_parameter("outline_color", o.get("outline_color", Color("#113035")))
		mat.set_shader_parameter("shadow", o.get("shadow", Vector2(0, 4)))
		# 影を置かない箱（shadow が 0）は影の色も消す。透明な箱（絵の上の縁）の下に同じ形の影が出て、絵全体が暗く沈んだ
		var shc: Color = o.get("shadow_color", Color(0.067, 0.188, 0.208, 0.55))
		if o.get("shadow", Vector2(0, 4)) == Vector2.ZERO:
			shc.a = 0.0
		mat.set_shader_parameter("shadow_color", shc)
		mat.set_shader_parameter("dots", o.get("dots", 0.0))
		mat.set_shader_parameter("pad", DRAW_PAD)
		pad = o.get("pad", pad)
		queue_sort()
		queue_redraw()

	func press(cb: Callable) -> void:
		_press = true
		mouse_filter = Control.MOUSE_FILTER_STOP
		mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		pressed.connect(cb)
		mouse_entered.connect(func() -> void: mat.set_shader_parameter("bright", 0.05))
		mouse_exited.connect(func() -> void:
			mat.set_shader_parameter("bright", 0.0)
			_down = false
			position.y -= 0.0)

	func _gui_input(e: InputEvent) -> void:
		if not _press:
			return
		if e is InputEventMouseButton and e.button_index == MOUSE_BUTTON_LEFT:
			if e.pressed:
				_down = true
				mat.set_shader_parameter("bright", -0.04)
			elif _down:
				_down = false
				mat.set_shader_parameter("bright", 0.05)
				accept_event()
				pressed.emit()

	func _draw() -> void:
		# 大きさは描くたびに渡す（木に入る前に size を決めた箱は RESIZED が来ず、既定の 100×40 で描かれた）
		mat.set_shader_parameter("box_size", size)
		draw_rect(Rect2(Vector2(-DRAW_PAD, -DRAW_PAD), size + Vector2(DRAW_PAD, DRAW_PAD) * 2.0), Color.WHITE)

	func _notification(what: int) -> void:
		if what == NOTIFICATION_RESIZED and mat:
			mat.set_shader_parameter("box_size", size)
			queue_redraw()
		elif what == NOTIFICATION_SORT_CHILDREN:
			var r := Rect2(pad.x, pad.y, size.x - pad.x - pad.z, size.y - pad.y - pad.w)
			for c in get_children():
				if c is Control and not c.top_level and c.visible:
					fit_child_in_rect(c, r)

	func _get_minimum_size() -> Vector2:
		var m := Vector2.ZERO
		for c in get_children():
			if c is Control and c.visible:
				m = m.max(c.get_combined_minimum_size())
		return m + Vector2(pad.x + pad.z, pad.y + pad.w)
