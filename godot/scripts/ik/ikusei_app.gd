extends Control
## カード育成モードの画面（Godot 版）。ゲームの src/ui/screens/ikusei.js を Godot の Control で組み直したもの。
##
## 中身はすべて ik/ikusei.gd（ゲームの ikusei.js を移したもの）を通す。画面はプロフィールを読んで描き、
## 押されたら ikusei.gd の関数を呼んで保存し、描き直すだけ。
## レースは ikusei.gd が GDScript で走らせ（ゲームと同じ結果）、走行ログを競馬場（racecourse.gd）に渡して 3D で観る。
##
## 見た目はゲームの育成モードに寄せる：配色は #113035（深い青緑）・#a7cb0e（若草）・#f3a332（橙）、明るい面は生成り。
## 部品は白い縁＋紺の輪郭＋下にずらした影（ステッカー風）。画面の入れ替えは本文だけを 8px 下から浮かせて出す（落とし穴 94）。

const IK := preload("res://scripts/ik/ikusei.gd")
const Skins := preload("res://scripts/ik/skins.gd")
const TILT := preload("res://shaders/card_tilt.gdshader")
const RACECOURSE := preload("res://scenes/racecourse.tscn")

const INK := Color("#113035")
const TEAL := Color("#1d5a60")
const LEAF := Color("#a7cb0e")
const SUN := Color("#f3a332")
const PAPER := Color("#f8f3e6")
const RAR_COL := {LM = Color("#c26bff"), SSR = Color("#e8b33a"), SR = Color("#b9c3d0"), R = Color("#c9884e"), N = Color("#6fbf57")}
const HOLO := {LM = 1.0, SSR = 0.8, SR = 0.65, R = 0.5, N = 0.0}

var p: Dictionary
var screen := "home"
var opts := {}
var font: SystemFont
var font_b: SystemFont
var sky: Control
var top: HBoxContainer
var body: Control
var dock: HBoxContainer
var overlay: Control
var watching: Node = null
var card_menu: PanelContainer


func _ready() -> void:
	p = IK.load_profile()
	IK.data()
	font = SystemFont.new()
	font.font_names = PackedStringArray(["Yu Gothic UI", "Meiryo", "Hiragino Sans", "Noto Sans CJK JP", "Noto Sans JP", "IPAGothic"])
	font_b = SystemFont.new()
	font_b.font_names = font.font_names
	font_b.font_weight = 800
	set_anchors_preset(Control.PRESET_FULL_RECT)
	theme = _theme()
	sky = SkyBg.new()
	sky.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(sky)
	var root := VBoxContainer.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_theme_constant_override("separation", 0)
	add_child(root)
	top = HBoxContainer.new()
	top.custom_minimum_size.y = 64
	top.add_theme_constant_override("separation", 12)
	root.add_child(_margin(top, 18, 10, 18, 4))
	body = Control.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.clip_contents = true
	root.add_child(body)
	dock = HBoxContainer.new()
	dock.alignment = BoxContainer.ALIGNMENT_CENTER
	dock.add_theme_constant_override("separation", 10)
	root.add_child(_margin(dock, 18, 6, 18, 14))
	overlay = Control.new()
	overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(overlay)
	var args := {}
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--") and a.contains("="):
			var kv := a.substr(2).split("=", true, 1)
			args[kv[0]] = kv[1]
	if args.has("demo"):
		_demo(int(args.demo))
	go(args.get("screen", "home"), {id = int(args.id)} if args.has("id") else {})
	if args.has("pull"):
		_do_pull(int(args.pull))
	if args.has("card"):
		_show_card(IK.card(args.card))
	if args.has("event"):
		# 確かめ用：イベント（凱旋門賞 1999）を走って観戦の時刻（--event=秒）で止める
		var h = p.finished[0]
		var r := IK.event_race(p, h.id, "arc1999", 1)
		_watch(r.result, [100], r.fired, func() -> void: pass)
		watching.race_t = float(args.event)
		watching.playing = false
		if args.has("cam"):
			watching.set_camera(args.cam)
	if args.has("race"):
		# 確かめ用：レースの週まで練習を進めてレースを走り、観戦の時刻（--race=秒）で止める。--result で結果の板
		while not IK.is_race_turn(p.run):
			IK.train(p.run, "wit")
		_race(IK.race_options(p.run)[0].id)
		watching.race_t = float(args.race)
		watching.playing = false
		if args.has("cam"):
			watching.set_camera(args.cam)
		if args.has("result"):
			watching.finished.emit()
	if args.has("shot"):
		_shoot(args.shot, float(args.get("wait", "1.5")))


## 撮影（--shot=保存先）。確かめ用
func _shoot(path: String, wait: float) -> void:
	await get_tree().create_timer(wait).timeout
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(path)
	print("saved ", path)
	get_tree().quit()


## 確かめ用：決まった手でカードを集めて 1 頭育てたプロフィール（--demo=シード）。保存はしない
func _demo(seed: int) -> void:
	p = IK.new_profile(seed)
	IK.pull(p, 60)
	var own := IK.owned(p)
	IK.start_run(p, own[0].id, own.slice(1, 5).map(func(c): return c.id))
	while not IK.run_done(p.run):
		if IK.is_race_turn(p.run):
			IK.race_turn(p.run, IK.race_options(p.run)[0].id)
		elif int(p.run.energy) < 45:
			IK.rest(p.run)
		else:
			IK.train(p.run, IK.STATS[int(p.run.turn) % 5])
	IK.finish_run(p)
	IK.start_run(p, own[1].id, [own[0].id, own[2].id, own[3].id, own[4].id])
	for i in 6:
		if IK.is_race_turn(p.run):
			IK.race_turn(p.run, IK.race_options(p.run)[0].id)
		else:
			IK.train(p.run, IK.STATS[i % 5])
	set_meta("nosave", true)


func save() -> void:
	if not has_meta("nosave"):
		IK.save_profile(p)


# ------------------------------------------------------------------ 見た目の部品

func _theme() -> Theme:
	var t := Theme.new()
	t.default_font = font
	t.default_font_size = 17
	t.set_color("font_color", "Label", INK)
	for st in ["normal", "hover", "pressed", "disabled", "focus"]:
		var sb := _sticker(PAPER if st != "pressed" else Color("#efe6cf"), 14)
		if st == "hover":
			sb.bg_color = Color("#fffbef")
		if st == "focus":
			sb.draw_center = false
			sb.shadow_size = 0
			sb.border_color = SUN
		if st == "disabled":
			sb.bg_color = Color("#d9d3c4")
		t.set_stylebox(st, "Button", sb)
	t.set_color("font_color", "Button", INK)
	t.set_color("font_hover_color", "Button", INK)
	t.set_color("font_pressed_color", "Button", INK)
	t.set_color("font_disabled_color", "Button", Color("#7b8a88"))
	t.set_font("font", "Button", font_b)
	var pb_bg := StyleBoxFlat.new()
	pb_bg.bg_color = Color("#e3dccb")
	pb_bg.set_corner_radius_all(6)
	var pb_fg := StyleBoxFlat.new()
	pb_fg.bg_color = LEAF
	pb_fg.set_corner_radius_all(6)
	t.set_stylebox("background", "ProgressBar", pb_bg)
	t.set_stylebox("fill", "ProgressBar", pb_fg)
	t.set_color("font_color", "ProgressBar", INK)
	return t


## 白い縁＋紺の輪郭＋下にずらした影（ステッカー風の部品）
func _sticker(bg: Color, radius := 16, border := 3) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.set_corner_radius_all(radius)
	sb.border_color = INK
	sb.set_border_width_all(border)
	sb.shadow_color = Color(INK, 0.55)
	sb.shadow_offset = Vector2(0, 4)
	sb.shadow_size = 1
	sb.content_margin_left = 14
	sb.content_margin_right = 14
	sb.content_margin_top = 8
	sb.content_margin_bottom = 8
	return sb


func _margin(c: Control, l: int, t: int, r: int, b: int) -> MarginContainer:
	var m := MarginContainer.new()
	m.add_theme_constant_override("margin_left", l)
	m.add_theme_constant_override("margin_top", t)
	m.add_theme_constant_override("margin_right", r)
	m.add_theme_constant_override("margin_bottom", b)
	m.add_child(c)
	return m


## 空の上に直に置く見出し（白い字に紺の縁。紺の字のままだと暗い空に沈んで読めない）
func _head(text: String, size := 18) -> Label:
	var l := _lbl(text, size, Color.WHITE, true)
	l.add_theme_color_override("font_outline_color", INK)
	l.add_theme_constant_override("outline_size", 7)
	return l


func _lbl(text: String, size := 17, color := INK, bold := false) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	if bold:
		l.add_theme_font_override("font", font_b)
	return l


func _btn(text: String, cb: Callable, bg := PAPER, size := 17) -> Button:
	var b := Button.new()
	b.text = text
	b.add_theme_font_size_override("font_size", size)
	if bg != PAPER:
		for st in ["normal", "hover", "pressed"]:
			var sb := _sticker(bg if st != "hover" else bg.lightened(0.12), 14)
			if st == "pressed":
				sb.shadow_offset = Vector2(0, 1)
			b.add_theme_stylebox_override(st, sb)
	b.pressed.connect(cb)
	b.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	return b


func _panel(child: Control, bg := PAPER, radius := 18) -> PanelContainer:
	var pc := PanelContainer.new()
	pc.add_theme_stylebox_override("panel", _sticker(bg, radius))
	pc.add_child(child)
	return pc


func _box(vertical := true, sep := 8) -> BoxContainer:
	var b: BoxContainer = VBoxContainer.new() if vertical else HBoxContainer.new()
	b.add_theme_constant_override("separation", sep)
	return b


func _scroll(child: Control) -> ScrollContainer:
	var s := ScrollContainer.new()
	s.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	s.size_flags_vertical = Control.SIZE_EXPAND_FILL
	s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	child.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.add_child(child)
	return s


func _card_tex(id: String) -> Texture2D:
	var path := "res://assets/cards/%s.webp" % id
	return load(path) if ResourceLoader.exists(path) else null


func _face_tex(id: String) -> Texture2D:
	var path := "res://assets/cards/face/%s.png" % id
	return load(path) if ResourceLoader.exists(path) else null


func _sticker_tex(id: String) -> Texture2D:
	var path := "res://assets/cards/sticker/%s.webp" % id
	return load(path) if ResourceLoader.exists(path) else null


## カードの表（傾けると光沢とホロが流れる）。w は幅（高さは 880/630 倍）
func _card_view(c: Dictionary, w: float, tilt := true) -> Control:
	var tr := TextureRect.new()
	tr.texture = _card_tex(c.id)
	tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	tr.custom_minimum_size = Vector2(w, w * 880.0 / 630.0)
	var mat := ShaderMaterial.new()
	mat.shader = TILT
	mat.set_shader_parameter("holo", HOLO.get(c.rar, 0.0))
	tr.material = mat
	if tilt:
		tr.mouse_filter = Control.MOUSE_FILTER_PASS
		tr.gui_input.connect(func(e: InputEvent) -> void:
			if e is InputEventMouseMotion:
				var t: Vector2 = (e.position / tr.size - Vector2(0.5, 0.5)) * 2.0
				mat.set_shader_parameter("tilt", t)
				tr.pivot_offset = tr.size / 2.0
				tr.rotation = t.x * 0.035)
		tr.mouse_exited.connect(func() -> void:
			var tw := tr.create_tween().set_trans(Tween.TRANS_QUART).set_ease(Tween.EASE_OUT)
			tw.tween_property(tr, "rotation", 0.0, 0.35)
			tw.parallel().tween_method(func(v: Vector2) -> void: mat.set_shader_parameter("tilt", v), mat.get_shader_parameter("tilt"), Vector2.ZERO, 0.35))
	return tr


## 顔の丸いアイコン（枠の色がレア度）
func _icon(c: Dictionary, size := 96.0, badge := "", on_click := Callable(), dim := false) -> Control:
	var ic := CardIcon.new()
	ic.face = _face_tex(c.id)
	ic.ring = RAR_COL.get(c.rar, LEAF)
	ic.rar = c.rar
	ic.badge = badge
	ic.dim = dim
	ic.font = font_b
	ic.custom_minimum_size = Vector2(size, size)
	if on_click.is_valid():
		ic.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		ic.gui_input.connect(func(e: InputEvent) -> void:
			if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
				on_click.call())
	return ic


## アイコン＋名前の札（所持カード・完成馬の一覧の 1 マス）
func _tile(c: Dictionary, line1: String, line2: String, badge: String, on_click: Callable, dim := false, selected := false) -> Control:
	var v := _box(true, 2)
	v.custom_minimum_size.x = 118
	var ic := _icon(c, 96, badge, on_click, dim)
	ic.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	if selected:
		ic.sel = true
	v.add_child(ic)
	var n := _head(line1, 15)
	n.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	n.clip_text = true
	n.custom_minimum_size.x = 118
	v.add_child(n)
	var s := _lbl(line2, 12, Color("#e8f0d0"))
	s.add_theme_color_override("font_outline_color", INK)
	s.add_theme_constant_override("outline_size", 5)
	s.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(s)
	return v


func _grid(cols: int) -> GridContainer:
	var g := GridContainer.new()
	g.columns = cols
	g.add_theme_constant_override("h_separation", 10)
	g.add_theme_constant_override("v_separation", 12)
	return g


func _cols_for(item_w: float) -> int:
	return maxi(3, int((size.x - 60) / item_w))


# ------------------------------------------------------------------ 画面の切り替え

func go(name: String, o := {}) -> void:
	var same := name == screen and o.hash() == opts.hash()
	screen = name
	opts = o
	_close_menu()
	render(not same)


func render(animate := true) -> void:
	for c in body.get_children():
		c.queue_free()
	_render_top()
	_render_dock()
	var page: Control
	match screen:
		"home": page = _home()
		"gacha": page = _gacha()
		"cards": page = _cards()
		"book": page = _book()
		"deck": page = _deck()
		"train": page = _train()
		"finished": page = _finished()
		"horse": page = _horse()
		"battle": page = _battle()
		"event": page = _event()
		_: page = _home()
	page.set_anchors_preset(Control.PRESET_FULL_RECT)
	body.add_child(page)
	if animate:
		# 本文だけを 8px 下から浮かせて出す（枠は動かさない）
		# position を動かすと、まだ大きさの決まっていない（作った直後の）画面で錨の位置が狂い、本文が右へずれた。余白（offset）で動かす
		page.modulate.a = 0.0
		page.offset_top = 8.0
		page.offset_bottom = 8.0
		var tw := page.create_tween().set_trans(Tween.TRANS_QUART).set_ease(Tween.EASE_OUT).set_parallel()
		tw.tween_property(page, "modulate:a", 1.0, 0.2)
		tw.tween_property(page, "offset_top", 0.0, 0.24)
		tw.tween_property(page, "offset_bottom", 0.0, 0.24)


func _render_top() -> void:
	for c in top.get_children():
		c.queue_free()
	if screen != "home":
		top.add_child(_btn("◀ ホーム", go.bind("home")))
	var title := _lbl({home = "WINNING ROAD　カード育成", gacha = "ガチャ", cards = "所持カード", book = "カード図鑑", deck = "編成",
		train = "育成", finished = "完成馬", horse = "完成馬", battle = "対戦", event = "イベント"}.get(screen, ""), 24, Color.WHITE, true)
	title.add_theme_color_override("font_outline_color", INK)
	title.add_theme_constant_override("outline_size", 8)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(title)
	top.add_child(_pill("戦力", str(IK.collection_power(p))))
	top.add_child(_pill("所持", "%d/%d" % [IK.owned(p).size(), IK.cards().size()]))
	var sh := _pill("かけら", str(int(p.get("shards", 0))) + ("・余り" if IK.spare_value(p) > 0 else ""))
	top.add_child(sh)


func _pill(k: String, v: String) -> Control:
	var h := _box(false, 6)
	h.add_child(_lbl(k, 13, TEAL, true))
	h.add_child(_lbl(v, 18, INK, true))
	var pc := _panel(h, PAPER, 20)
	return pc


func _render_dock() -> void:
	for c in dock.get_children():
		c.queue_free()
	var items := [["home", "ホーム", LEAF], ["cards", "カード", PAPER], ["train", "育成", SUN], ["battle", "対戦", PAPER], ["gacha", "◆ ガチャ", Color("#ffd95a")]]
	for it in items:
		var b := _btn(it[1], func() -> void:
			if it[0] == "cards":
				_toggle_menu()
			else:
				go(it[0] if it[0] != "train" or p.run != null else "deck"), it[2], 20)
		b.custom_minimum_size = Vector2(150, 54)
		if it[0] == screen or (it[0] == "cards" and screen in ["cards", "book", "deck", "finished", "horse"]):
			b.add_theme_color_override("font_color", SUN.darkened(0.3))
		dock.add_child(b)


## 下の「カード」：所持カード・完成馬・編成・図鑑の小さな一覧（ゲームの .ikd-menu）
func _toggle_menu() -> void:
	if card_menu != null:
		_close_menu()
		return
	var v := _box(true, 6)
	for it in [["cards", "所持カード"], ["finished", "完成馬"], ["deck", "編成"], ["book", "カード図鑑"]]:
		var b := _btn(it[1], go.bind(it[0]))
		b.custom_minimum_size = Vector2(180, 44)
		v.add_child(b)
	card_menu = _panel(v, Color("#fffaf0"))
	overlay.add_child(card_menu)
	await get_tree().process_frame
	var cb: Control = dock.get_child(1)
	card_menu.position = Vector2(cb.global_position.x - 8, cb.global_position.y - card_menu.size.y - 12)
	card_menu.modulate.a = 0.0
	card_menu.create_tween().tween_property(card_menu, "modulate:a", 1.0, 0.15)


func _close_menu() -> void:
	if card_menu != null:
		card_menu.queue_free()
		card_menu = null


func toast(text: String) -> void:
	var pc := _panel(_lbl(text, 18, INK, true), Color("#fffaf0"))
	overlay.add_child(pc)
	await get_tree().process_frame
	pc.position = Vector2((size.x - pc.size.x) / 2.0, 80)
	pc.modulate.a = 0.0
	var tw := pc.create_tween()
	tw.tween_property(pc, "modulate:a", 1.0, 0.18)
	tw.tween_interval(1.8)
	tw.tween_property(pc, "modulate:a", 0.0, 0.3)
	tw.tween_callback(pc.queue_free)


## 前に出す板（カードの詳細・結果）。外を押すか ✕ で閉じる
func modal(content: Control, w := 860.0) -> Control:
	_close_menu()
	var wrap := Control.new()
	wrap.set_anchors_preset(Control.PRESET_FULL_RECT)
	wrap.mouse_filter = Control.MOUSE_FILTER_STOP
	var dim := ColorRect.new()
	dim.color = Color(INK, 0.55)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	wrap.add_child(dim)
	var pc := _panel(content, Color("#fffaf0"), 22)
	pc.custom_minimum_size.x = w
	wrap.add_child(pc)
	overlay.add_child(wrap)
	var close := func() -> void:
		var tw := wrap.create_tween()
		tw.tween_property(wrap, "modulate:a", 0.0, 0.16)
		tw.tween_callback(wrap.queue_free)
	dim.gui_input.connect(func(e: InputEvent) -> void:
		if e is InputEventMouseButton and e.pressed:
			close.call())
	wrap.set_meta("close", close)
	_place_modal.call_deferred(wrap, pc, w)
	return wrap


func _place_modal(wrap: Control, pc: Control, w: float) -> void:
	await get_tree().process_frame
	if not is_instance_valid(pc):
		return
	pc.size.x = minf(w, size.x - 40)
	pc.position = Vector2((size.x - pc.size.x) / 2.0, maxf(20.0, (size.y - pc.size.y) / 2.0))
	pc.position.y += 10
	wrap.modulate.a = 0.0
	var tw2 := wrap.create_tween().set_trans(Tween.TRANS_QUART).set_ease(Tween.EASE_OUT).set_parallel()
	tw2.tween_property(wrap, "modulate:a", 1.0, 0.2)
	tw2.tween_property(pc, "position:y", pc.position.y - 10, 0.24)


func close_modal(w: Control) -> void:
	if is_instance_valid(w):
		w.get_meta("close").call()


# ------------------------------------------------------------------ ホーム

func _home_card():
	var fav = p.get("fav")
	if fav != null and IK.count_of(p, fav) > 0:
		return IK.card(fav)
	if p.run != null:
		return IK.card(p.run.trainee)
	if p.finished.size() > 0:
		var best = p.finished[0]
		for h in p.finished:
			if int(h.rating) > int(best.rating):
				best = h
		return IK.card(best.cardId)
	var own := IK.owned(p)
	return own[0] if own.size() > 0 else null


func _home() -> Control:
	var page := Control.new()
	var c = _home_card()
	# 中央にホームの馬（切り抜き）
	var st := TextureRect.new()
	st.texture = _sticker_tex(c.id if c != null else "P1-02")
	st.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	st.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	st.set_anchors_preset(Control.PRESET_FULL_RECT)
	st.offset_left = 300
	st.offset_right = -260
	st.offset_top = 10
	st.offset_bottom = -10
	if c == null:
		st.modulate = Color(1, 1, 1, 0.35)
	page.add_child(st)
	# 馬の名前の札
	if c != null:
		var nm := _box(true, 0)
		nm.add_child(_lbl(c.epithetText, 15, TEAL, true))
		nm.add_child(_lbl(c.name, 30, INK, true))
		var np := _panel(nm, PAPER)
		np.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
		np.position = Vector2(-120, -96)
		np.grow_horizontal = Control.GROW_DIRECTION_BOTH
		page.add_child(np)
	# 左の列：イベントとガチャ
	var left := _box(true, 14)
	left.position = Vector2(22, 12)
	left.custom_minimum_size.x = 280
	left.add_child(_banner("イベント", "凱旋門賞 1999", "聳え立つ巨城", "EV-01", go.bind("event"), SUN))
	left.add_child(_banner("ガチャ", "PICK UP 揺るがぬ者たち", "全 %d 種から" % IK.cards().filter(func(x): return IK.in_packs(x)).size(), "P3-02", go.bind("gacha"), Color("#ffd95a")))
	if p.run != null:
		var run: Dictionary = p.run
		var rv := _box(true, 4)
		rv.add_child(_lbl("育成中：%s" % IK.card(run.trainee).name, 16, INK, true))
		rv.add_child(_lbl(IK.turn_label(run), 14, TEAL))
		var pb := ProgressBar.new()
		pb.max_value = IK.TOTAL_TURNS
		pb.value = int(run.turn)
		pb.show_percentage = false
		pb.custom_minimum_size = Vector2(240, 12)
		rv.add_child(pb)
		rv.add_child(_btn("続ける ▶", go.bind("train"), LEAF))
		left.add_child(_panel(rv))
	page.add_child(left)
	# 右の列：丸いボタン
	var right := _box(true, 12)
	right.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	right.position = Vector2(-230, 12)
	right.custom_minimum_size.x = 210
	for it in [["所持カード", "cards"], ["カード図鑑", "book"], ["完成馬 %d" % p.finished.size(), "finished"], ["編成", "deck"], ["対戦", "battle"]]:
		var b := _btn(it[0], go.bind(it[1]))
		b.custom_minimum_size.y = 50
		right.add_child(b)
	var rc := _btn("競馬場を見る", func() -> void: get_tree().change_scene_to_file("res://scenes/racecourse.tscn"))
	rc.custom_minimum_size.y = 50
	right.add_child(rc)
	if c == null:
		var hint := _panel(_lbl("まずはガチャでカードを集めよう。\n育てる馬 1 枚とサポート 4 枚で育成が始められる。", 16, INK, true), Color("#fffaf0"))
		hint.set_anchors_preset(Control.PRESET_CENTER)
		hint.position = Vector2(-220, -40)
		page.add_child(hint)
	page.add_child(right)
	return page


func _banner(kind: String, title: String, sub: String, card_id: String, cb: Callable, col: Color) -> Control:
	var b := Button.new()
	b.custom_minimum_size = Vector2(280, 128)
	b.clip_contents = true
	b.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	for st in ["normal", "hover", "pressed"]:
		var sb := _sticker(col if st != "hover" else col.lightened(0.15), 16)
		sb.content_margin_left = 0
		sb.content_margin_right = 0
		sb.content_margin_top = 0
		sb.content_margin_bottom = 0
		b.add_theme_stylebox_override(st, sb)
	b.pressed.connect(cb)
	var art := TextureRect.new()
	art.texture = _sticker_tex(card_id)
	art.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	art.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	art.set_anchors_preset(Control.PRESET_FULL_RECT)
	art.offset_left = 120
	art.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_child(art)
	var v := _box(true, 0)
	v.position = Vector2(14, 10)
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var k := _lbl(kind, 13, Color.WHITE, true)
	k.add_theme_color_override("font_outline_color", INK)
	k.add_theme_constant_override("outline_size", 6)
	v.add_child(k)
	var t := _lbl(title, 21, INK, true)
	t.add_theme_color_override("font_outline_color", Color.WHITE)
	t.add_theme_constant_override("outline_size", 6)
	v.add_child(t)
	v.add_child(_lbl(sub, 13, INK))
	b.add_child(v)
	return b


# ------------------------------------------------------------------ ガチャ

func _gacha() -> Control:
	var page := _box(true, 14)
	var head := _box(false, 14)
	head.alignment = BoxContainer.ALIGNMENT_CENTER
	var info := _box(true, 6)
	info.add_child(_lbl("全カードから引く（試作なので何度でも引ける）", 18, INK, true))
	var rates: Dictionary = IK.data().rates
	info.add_child(_lbl("排出率　" + "・".join(IK.RARITIES.map(func(r): return "%s %d%%" % [r, roundi(float(rates[r]) * 100)])), 15, TEAL))
	info.add_child(_lbl("同じカードの 2〜5 枚目は覚醒が上がる。6 枚目からは余り（かけらに替えられる）。", 14, TEAL))
	head.add_child(_panel(info))
	var b1 := _btn("1 回引く", func() -> void: _do_pull(1), PAPER, 22)
	b1.custom_minimum_size = Vector2(170, 64)
	head.add_child(b1)
	var b10 := _btn("10 回引く", func() -> void: _do_pull(10), Color("#ffd95a"), 22)
	b10.custom_minimum_size = Vector2(190, 64)
	head.add_child(b10)
	page.add_child(head)
	var area := CenterContainer.new()
	area.size_flags_vertical = Control.SIZE_EXPAND_FILL
	area.name = "Area"
	var got: Array = opts.get("got", [])
	if got.is_empty():
		var pick := _box(false, 18)
		for id in ["P3-01", "P3-02", "P3-03"]:
			var c = IK.card(id)
			if c != null:
				pick.add_child(_card_view(c, 200))
		area.add_child(pick)
	else:
		area.add_child(_reveal(got, opts.get("reveal", false)))
	page.add_child(area)
	return _margin(page, 22, 6, 22, 6)


func _do_pull(n: int) -> void:
	var got := IK.pull(p, n)
	save()
	go("gacha", {got = got, reveal = true, k = p.pulls})


## 伏せて配り、順にめくる。いちばん良い 1 枚（SR 以上）は最後に溜めて光らせてからめくる（ゲームの pulledGrid と同じ筋）。
## 押すと全部めくる。めくりは表裏の 1 枚を scale.x で回す（すり替えない）。
func _reveal(got: Array, animate: bool) -> Control:
	var n := got.size()
	var cols := 5 if n > 1 else 1
	var w := 140.0 if n > 1 else 240.0
	var g := _grid(cols)
	g.add_theme_constant_override("h_separation", 16)
	var best := -1
	for i in n:
		var r: int = IK.RARITIES.find(got[i].card.rar)
		if r <= 2 and (best < 0 or r < IK.RARITIES.find(got[best].card.rar)):
			best = i
	var cells := []
	for i in n:
		var c: Dictionary = got[i].card
		var cell := Control.new()
		cell.custom_minimum_size = Vector2(w, w * 880.0 / 630.0 + 26)
		var front := _card_view(c, w)
		front.position = Vector2.ZERO
		cell.add_child(front)
		var back := CardBack.new()
		back.custom_minimum_size = front.custom_minimum_size
		back.size = front.custom_minimum_size
		back.font = font_b
		cell.add_child(back)
		var tag := _head(("NEW" if got[i].isNew else ("覚醒%d" % int(got[i].awaken) if int(got[i].awaken) > 0 else "")), 15)
		tag.position = Vector2(4, w * 880.0 / 630.0 + 2)
		cell.add_child(tag)
		front.gui_input.connect(func(e: InputEvent) -> void:
			if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT and not back.visible:
				_show_card(c))
		g.add_child(cell)
		cells.append({cell = cell, front = front, back = back, tag = tag, c = c})
		if not animate:
			back.visible = false
	if animate:
		_play_reveal(cells, best, w)
	return g


func _play_reveal(cells: Array, best: int, w: float) -> void:
	var skip := [false]
	var on_click := func(e: InputEvent) -> void:
		if e is InputEventMouseButton and e.pressed:
			skip[0] = true
	for x in cells:
		x.front.visible = false
		x.tag.visible = false
		x.back.pivot_offset = Vector2(w / 2.0, 0)
		x.front.pivot_offset = Vector2(w / 2.0, 0)
		x.back.gui_input.connect(on_click)
		x.back.modulate.a = 0.0
	# 配る
	for i in cells.size():
		var b: Control = cells[i].back
		b.position.y = -24
		var tw := b.create_tween().set_trans(Tween.TRANS_QUART).set_ease(Tween.EASE_OUT).set_parallel()
		tw.tween_interval(0.05 * i)
		tw.chain().tween_property(b, "modulate:a", 1.0, 0.2)
		tw.parallel().tween_property(b, "position:y", 0.0, 0.26)
	await get_tree().create_timer(0.05 * cells.size() + 0.3).timeout
	var order := range(cells.size()).filter(func(i): return i != best)
	if best >= 0:
		order.append(best)
	for i in order:
		if not is_instance_valid(cells[i].back):
			return
		var x: Dictionary = cells[i]
		if i == best and not skip[0]:
			x.back.charge = RAR_COL[x.c.rar]
			var tw0: Tween = x.back.create_tween()
			tw0.tween_property(x.back, "glow", 1.0, 0.7)
			await tw0.finished
		await _flip(x, 0.0 if skip[0] else 0.12)
		if not skip[0]:
			await get_tree().create_timer(0.08 if i != best else 0.0).timeout


func _flip(x: Dictionary, half: float) -> void:
	if not is_instance_valid(x.back):
		return
	if half <= 0.0:
		x.back.visible = false
		x.front.visible = true
		x.tag.visible = true
		return
	var tw: Tween = x.back.create_tween().set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN)
	tw.tween_property(x.back, "scale:x", 0.0, half)
	await tw.finished
	if not is_instance_valid(x.back):
		return
	x.back.visible = false
	x.front.visible = true
	x.tag.visible = true
	x.front.scale.x = 0.0
	var tw2: Tween = x.front.create_tween().set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
	tw2.tween_property(x.front, "scale:x", 1.0, half)
	await tw2.finished


# ------------------------------------------------------------------ カード

func _cards() -> Control:
	var page := _box(true, 12)
	var head := _box(false, 12)
	var spare := IK.spare_value(p)
	head.add_child(_head("持っているカード %d 種　カードを押すと詳細" % IK.owned(p).size()))
	var sp := Control.new()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(sp)
	head.add_child(_btn("余りをまとめて替える（+%d）" % spare if spare > 0 else "余りなし", func() -> void:
		if spare <= 0:
			return
		var got := IK.shard_spare(p)
		save()
		toast("かけら +%d" % got)
		render(false)))
	head.add_child(_btn("カード図鑑", go.bind("book")))
	page.add_child(head)
	var g := _grid(_cols_for(128))
	for c in IK.owned(p):
		var n := IK.count_of(p, c.id)
		var badge := ("×%d" % n) if n > 1 else ""
		g.add_child(_tile(c, c.name, "%s・%s　%d" % ["芝" if c.turf >= c.dirt else "ダ", c.distCat, int(c.power)], badge, _show_card.bind(c)))
	if IK.owned(p).is_empty():
		page.add_child(_head("まだカードが無い。ガチャで集めよう。"))
	page.add_child(_scroll(g))
	return _margin(page, 22, 6, 22, 6)


func _book() -> Control:
	var page := _box(true, 12)
	var packs: Dictionary = IK.data().packNames
	var g := _grid(_cols_for(128))
	var have := 0
	for c in IK.cards():
		var n := IK.count_of(p, c.id)
		if n > 0:
			have += 1
		g.add_child(_tile(c, c.name if n > 0 else "？？？", "No.%02d %s" % [int(c.no), c.rar], ("×%d" % n) if n > 1 else "", _show_card.bind(c), n == 0))
	page.add_child(_head("収集 %d/%d　（%s）" % [have, IK.cards().size(), "・".join(packs.values())]))
	page.add_child(_scroll(g))
	return _margin(page, 22, 6, 22, 6)


func _show_card(c: Dictionary) -> void:
	var n := IK.count_of(p, c.id)
	var row := _box(false, 22)
	if n > 0 or true:
		row.add_child(_card_view(c, 330))
	var info := _box(true, 8)
	info.custom_minimum_size.x = 440
	info.add_child(_lbl("%s　%s" % [c.rar, c.epithetText], 16, TEAL, true))
	info.add_child(_lbl(c.name if n > 0 else "？？？（未所持）", 30, INK, true))
	var aw := IK.awaken_of(n)
	info.add_child(_lbl("所持 %d 枚　覚醒 %s" % [n, "◆".repeat(aw) + "◇".repeat(4 - aw)], 16, INK))
	var sk := IK.skills_of(c, aw)
	if sk.unique != null:
		info.add_child(_lbl("固有　%s" % sk.unique.name, 16, SUN.darkened(0.25), true))
		info.add_child(_wrap(sk.unique.desc, 13))
	for id in sk.race:
		var si := IK.skill_info(id)
		info.add_child(_lbl("レース　%s" % si.name, 15, INK, true))
		info.add_child(_wrap(si.desc, 13))
	for id in sk.support:
		var si := IK.skill_info(id)
		info.add_child(_lbl("サポート　%s" % si.name, 15, TEAL, true))
		info.add_child(_wrap(si.desc, 13))
	var acts := _box(false, 8)
	var w: Control
	if IK.spare_of(p, c.id) > 0:
		acts.add_child(_btn("余り %d 枚をかけらに" % IK.spare_of(p, c.id), func() -> void:
			IK.shard_spare(p, c.id)
			save()
			close_modal(w)
			render(false)))
	var why := IK.can_buy_with_shards(p, c.id)
	acts.add_child(_btn("かけら %d で交換" % int(IK.data().shardCost[c.rar]) if why == "" else why, func() -> void:
		if IK.can_buy_with_shards(p, c.id) != "":
			return
		IK.buy_with_shards(p, c.id)
		save()
		close_modal(w)
		toast("%s を交換した" % c.name)
		render(false)))
	if n > 0:
		acts.add_child(_btn("ホームに飾る", func() -> void:
			p.fav = c.id
			save()
			close_modal(w)
			toast("ホームの馬を %s にした" % c.name)))
	info.add_child(acts)
	row.add_child(info)
	w = modal(row, 860)


func _wrap(text: String, size := 14) -> Label:
	var l := _lbl(text, size, Color("#33504f"))
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.custom_minimum_size.x = 420
	return l


# ------------------------------------------------------------------ 編成

func _deck() -> Control:
	var page := _box(true, 10)
	if p.run != null:
		page.add_child(_lbl("育成の途中は組み直せない（%s を育成中）。" % IK.card(p.run.trainee).name, 18, INK, true))
		page.add_child(_btn("育成へ ▶", go.bind("train"), LEAF))
		return _margin(page, 22, 6, 22, 6)
	var trainee = opts.get("t")
	var sup: Array = opts.get("s", [])
	var head := _box(false, 12)
	head.add_child(_head("① 育てる馬を 1 枚　② サポートを 4 枚（育てる馬と同じカードは不可）"))
	var sp := Control.new()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(sp)
	var start := _btn("育成を始める ▶", func() -> void:
		IK.start_run(p, trainee, sup)
		save()
		go("train"), LEAF, 20)
	start.disabled = trainee == null or sup.size() != 4
	head.add_child(start)
	page.add_child(head)
	var sel := _box(false, 10)
	sel.add_child(_lbl("育てる馬", 15, TEAL, true))
	if trainee != null:
		sel.add_child(_icon(IK.card(trainee), 64))
	sel.add_child(_lbl("　サポート", 15, TEAL, true))
	for id in sup:
		sel.add_child(_icon(IK.card(id), 64))
	page.add_child(_panel(sel))
	var g := _grid(_cols_for(128))
	for c in IK.owned(p):
		var is_t: bool = trainee == c.id
		var is_s: bool = sup.has(c.id)
		var badge := "育" if is_t else ("サ" if is_s else "")
		g.add_child(_tile(c, c.name, "%s %d　%s・%s" % [c.rar, int(c.power), "芝" if c.turf >= c.dirt else "ダ", c.distCat], badge, func() -> void:
			var t2 = trainee
			var s2 := sup.duplicate()
			if trainee == null or is_t:
				t2 = null if is_t else c.id
				s2.erase(c.id)
			elif is_s:
				s2.erase(c.id)
			elif s2.size() < 4:
				s2.append(c.id)
			go("deck", {t = t2, s = s2}), false, is_t or is_s))
	page.add_child(_scroll(g))
	return _margin(page, 22, 6, 22, 6)


# ------------------------------------------------------------------ 育成

func _train() -> Control:
	if p.run == null:
		return _deck()
	var run: Dictionary = p.run
	var c = IK.card(run.trainee)
	var page := _box(false, 18)
	# 左：馬の状態
	var left := _box(true, 6)
	left.custom_minimum_size.x = 350
	var who := _box(false, 10)
	who.add_child(_icon(c, 84))
	var wv := _box(true, 0)
	wv.add_child(_lbl(c.epithetText, 13, TEAL, true))
	wv.add_child(_lbl(c.name, 24, INK, true))
	wv.add_child(_lbl(IK.turn_label(run), 15, SUN.darkened(0.3), true))
	who.add_child(wv)
	left.add_child(who)
	left.add_child(_lbl("体力 %d　気分 %s　ファン %d 人　%d 戦 %d 勝" % [int(run.energy), IK.data().moods[int(run.mood)], int(run.fans), int(run.starts), int(run.wins)], 15, INK, true))
	var eb := ProgressBar.new()
	eb.max_value = 100
	eb.value = int(run.energy)
	eb.show_percentage = false
	eb.custom_minimum_size = Vector2(330, 14)
	left.add_child(eb)
	for k in IK.STATS:
		var row := _box(false, 8)
		var nm := _lbl(IK.STAT_LABEL[k], 15, INK, true)
		nm.custom_minimum_size.x = 76
		row.add_child(nm)
		var pb := ProgressBar.new()
		pb.max_value = 1200
		pb.value = int(run.stats[k])
		pb.show_percentage = false
		pb.custom_minimum_size = Vector2(150, 16)
		pb.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(pb)
		row.add_child(_lbl("%d %s" % [int(run.stats[k]), IK.grade_of_pts(int(run.stats[k]))], 16, INK, true))
		row.add_child(_lbl("/%d" % IK.cap_of(int(c.plus[k]), IK.aw_t(run)), 12, TEAL))
		left.add_child(row)
	var skl := IK.run_skills(run).map(func(id): return IK.skill_info(id).name)
	left.add_child(_wrap("スキル：" + ("・".join(skl) if skl.size() > 0 else "なし"), 13))
	page.add_child(_panel(left))
	# 右：練習・レース
	var right := _box(true, 10)
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if IK.run_done(run):
		right.add_child(_head("育成が終わった（%d 戦 %d 勝、うち重賞 %d 勝）" % [int(run.starts), int(run.wins), int(run.gradedWins)], 20))
		right.add_child(_btn("完成馬にする ▶", func() -> void:
			var h := IK.finish_run(p)
			save()
			go("horse", {id = h.id}), LEAF, 22))
	elif IK.is_race_turn(run):
		right.add_child(_head("レースを選ぶ", 20))
		for o in IK.race_options(run):
			var cname: String = IK.data().courses[o.courseId].name
			var b := _btn("%s%s　%s %s%dm　%s　相手の強さ %s" % [o.name, ("（%s）" % o.grade) if o.grade != "" else "", cname, "芝" if o.surface == "芝" else "ダ", int(o.distance), o.ground,
				"★".repeat(clampi(int((float(o.level) - 0.4) / 0.06), 1, 5))], _race.bind(o.id), PAPER, 18)
			b.alignment = HORIZONTAL_ALIGNMENT_LEFT
			b.custom_minimum_size.y = 58
			right.add_child(b)
	else:
		right.add_child(_head("練習を選ぶ（サポートが来ている練習は伸びが大きい。友情は得意の練習）"))
		var row := _box(false, 10)
		for k in IK.STATS:
			row.add_child(_train_button(run, k))
		right.add_child(row)
		var rb := _btn("休む（体力を戻す）", func() -> void:
			toast(IK.rest(run))
			save()
			render(false))
		rb.custom_minimum_size = Vector2(240, 50)
		right.add_child(rb)
	var logv := _box(true, 2)
	var lg: Array = run.log
	for i in range(maxi(0, lg.size() - 7), lg.size()):
		logv.add_child(_lbl("・" + String(lg[i]), 14, Color("#33504f")))
	right.add_child(_panel(logv, Color("#fffaf0")))
	page.add_child(right)
	return _margin(page, 22, 6, 22, 6)


func _train_button(run: Dictionary, k: String) -> Control:
	var pv := IK.training_preview(run, k)
	var b := Button.new()
	b.custom_minimum_size = Vector2(146, 200)
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	b.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var hot: bool = pv.friendship > 0
	for st in ["normal", "hover", "pressed"]:
		var sb := _sticker(LEAF.lightened(0.35) if hot else PAPER, 16)
		if st == "hover":
			sb.bg_color = sb.bg_color.lightened(0.25)
		b.add_theme_stylebox_override(st, sb)
	b.pressed.connect(func() -> void:
		toast(IK.train(run, k))
		save()
		render(false))
	var v := _box(true, 3)
	v.position = Vector2(12, 10)
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_child(_lbl(IK.STAT_LABEL[k], 19, INK, true))
	for g in pv.gains:
		v.add_child(_lbl("%s +%d" % [IK.STAT_SHORT[g], int(pv.gains[g])], 15, INK, true))
	v.add_child(_lbl("失敗 %d%%" % roundi(float(pv.fail) * 100) if float(pv.fail) > 0 else "体力 −%d" % int(pv.cost) if k != "wit" else "体力 +5", 13, Color("#b4472f") if float(pv.fail) > 0 else TEAL))
	var faces := _box(false, 2)
	for id in pv.supports:
		var ic := _icon(IK.card(id), 36)
		ic.mouse_filter = Control.MOUSE_FILTER_IGNORE
		faces.add_child(ic)
	v.add_child(faces)
	if hot:
		v.add_child(_lbl("友情！", 15, SUN.darkened(0.25), true))
	for s in pv.skills:
		v.add_child(_lbl(s, 11, TEAL))
	for ch in v.get_children():
		ch.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_child(v)
	return b


func _race(choice: String) -> void:
	var run: Dictionary = p.run
	var r := IK.race_turn(run, choice)
	save()
	_watch(r.result, [1], r.fired, func() -> void:
		_result(r.result, [1], r.fired, "%s　%d 着" % [r.race.name, int(r.order)]))


# ------------------------------------------------------------------ 観戦（Godot の競馬場で走行ログを再生）

func _watch(res: Dictionary, mine: Array, fired: Dictionary, after: Callable) -> void:
	var lg: Dictionary = res.log
	var n: int = lg.n
	var field_by_id := {}
	for f in res.field:
		field_by_id[int(f.id)] = f
	var by_id := {}
	for r in res.results:
		by_id[int(r.horseId)] = r
	var horses := []
	var skins := []
	var cues := []
	for k in n:
		var id := int(lg.ids[k])
		var pos := PackedFloat32Array()
		var off := PackedFloat32Array()
		pos.resize(int(lg.frames))
		off.resize(int(lg.frames))
		for f in int(lg.frames):
			pos[f] = lg.pos[f * n + k]
			off[f] = lg.off[f * n + k]
		var rr: Dictionary = by_id[id]
		var fs: Dictionary = field_by_id.get(id, {})
		horses.append({id = id, name = lg.names[k], gate = int(lg.gates[k]), frame = int(lg.frameNos[k]), order = int(rr.order), time = rr.time, pos = pos, off = off})
		skins.append(Skins.for_runner({id = id, cardId = fs.get("cardId"), coat = fs.get("coat", "鹿毛"), gate = int(lg.gates[k]), frame = int(lg.frameNos[k])}))
		var names: Array = fired.get(id, fired.get(float(id), []))
		for nm in names:
			var cue := IK.skill_cue(nm, float(res.distance))
			var is_mine := mine.has(id)
			# 相手の札は固有だけ（全部出すと読めない）
			if is_mine or cue.unique:
				cues.append({at = cue.at, gate = int(lg.gates[k]), name = lg.names[k], text = nm, mine = is_mine, unique = cue.unique})
	var race := {id = "ik", name = res.name, course = res.courseId, surface = "dirt" if res.surface == "ダート" else "turf", distance = res.distance,
		dt = lg.dt, frames = lg.frames, winnerTime = res.winnerTime, horses = horses}
	var rc = RACECOURSE.instantiate()
	rc.embedded = true
	watching = rc
	for c in [sky, top.get_parent().get_parent(), overlay]:
		c.visible = false
	add_child(rc)
	rc.load_race_data(race, skins, mine, cues)
	rc.finished.connect(func() -> void:
		rc.queue_free()
		watching = null
		for c in [sky, top.get_parent().get_parent(), overlay]:
			c.visible = true
		render(false)
		after.call())


func _result(res: Dictionary, mine: Array, fired: Dictionary, title: String, extra: Control = null) -> void:
	var v := _box(true, 6)
	v.add_child(_lbl(title, 26, INK, true))
	v.add_child(_lbl("%s　%s %s%dm　馬場 %s　勝ち時計 %s" % [res.name, res.courseName, "芝" if res.surface == "芝" else "ダ", int(res.distance), res.ground, IK.Sim.format_time(res.winnerTime)], 15, TEAL))
	if extra != null:
		v.add_child(extra)
	var g := _grid(6)
	g.add_theme_constant_override("h_separation", 16)
	g.add_theme_constant_override("v_separation", 3)
	for h in ["着", "番", "馬名", "タイム", "着差", "発動したスキル"]:
		g.add_child(_lbl(h, 13, TEAL, true))
	for r in res.results.slice(0, 18):
		var is_mine: bool = mine.has(int(r.horseId))
		var col := SUN.darkened(0.3) if is_mine else INK
		g.add_child(_lbl(str(int(r.order)), 15, col, true))
		g.add_child(_lbl(str(int(r.gate)), 14, col))
		g.add_child(_lbl(r.name, 15, col, is_mine))
		g.add_child(_lbl(IK.Sim.format_time(r.time), 14, col))
		g.add_child(_lbl(r.margin, 14, col))
		var names: Array = fired.get(int(r.horseId), fired.get(float(r.horseId), []))
		g.add_child(_lbl("・".join(names), 12, TEAL))
	var sc := _scroll(g)
	sc.custom_minimum_size.y = minf(420.0, size.y - 260)
	v.add_child(sc)
	var w: Control
	var acts := _box(false, 10)
	acts.add_child(_btn("もう一度観る", func() -> void:
		close_modal(w)
		_watch(res, mine, fired, _result.bind(res, mine, fired, title, null))))
	acts.add_child(_btn("閉じる", func() -> void: close_modal(w), LEAF))
	v.add_child(acts)
	w = modal(v, 900)


# ------------------------------------------------------------------ 完成馬

func _finished() -> Control:
	var page := _box(true, 12)
	page.add_child(_head("完成馬 %d 頭　押すと詳細（ランク戦・イベントはここから）" % p.finished.size()))
	var g := _grid(_cols_for(128))
	var list: Array = p.finished.duplicate()
	list.sort_custom(func(a, b): return int(a.rating) > int(b.rating))
	for h in list:
		var c = IK.card(h.cardId)
		g.add_child(_tile(c, h.name, "%d 戦 %d 勝　%d" % [int(h.starts), int(h.wins), int(h.rating)], h.rank, go.bind("horse", {id = h.id})))
	if list.is_empty():
		page.add_child(_head("まだ完成馬が居ない。編成から育成を始めよう。"))
	page.add_child(_scroll(g))
	return _margin(page, 22, 6, 22, 6)


func _horse() -> Control:
	var h = IK.find_finished(p, opts.get("id", -1))
	if h == null:
		return _finished()
	var c = IK.card(h.cardId)
	var page := _box(false, 18)
	var left := _box(true, 8)
	left.custom_minimum_size.x = 400
	var who := _box(false, 10)
	who.add_child(_icon(c, 96, h.rank))
	var wv := _box(true, 0)
	wv.add_child(_lbl("%s　%s" % [h.rar, c.epithetText], 13, TEAL, true))
	wv.add_child(_lbl(h.name, 28, INK, true))
	wv.add_child(_lbl("評価 %s（%d）　%d 戦 %d 勝・重賞 %d 勝・GI %d 勝" % [h.rank, int(h.rating), int(h.starts), int(h.wins), int(h.gradedWins), int(h.giWins)], 14, INK))
	wv.add_child(_lbl("対戦 %d 戦 %d 勝　ファン %d 人" % [int(h.battles), int(h.battleWins), int(h.fans)], 14, TEAL))
	who.add_child(wv)
	left.add_child(who)
	for k in IK.STATS:
		var row := _box(false, 8)
		var nm := _lbl(IK.STAT_LABEL[k], 15, INK, true)
		nm.custom_minimum_size.x = 76
		row.add_child(nm)
		var pb := ProgressBar.new()
		pb.max_value = 1200
		pb.value = int(h.stats[k])
		pb.show_percentage = false
		pb.custom_minimum_size = Vector2(200, 16)
		pb.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(pb)
		row.add_child(_lbl("%d %s" % [int(h.stats[k]), IK.grade_of_pts(int(h.stats[k]))], 16, INK, true))
		left.add_child(row)
	left.add_child(_wrap("%s・%s（%dm）・%s　スキル：%s" % ["芝" if h.turf >= h.dirt else "ダート", IK.dist_cat(float(h.dist)), int(h.dist), IK.style_name(float(h.style)),
		"・".join(IK.finished_skills(h).map(func(id): return IK.skill_info(id).get("name", id)))], 13))
	var acts := _box(false, 8)
	acts.add_child(_btn("ランク戦へ", go.bind("battle", {id = h.id}), LEAF))
	acts.add_child(_btn("イベントへ", go.bind("event", {id = h.id}), SUN))
	left.add_child(acts)
	page.add_child(_panel(left))
	var right := _box(true, 4)
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	right.add_child(_lbl("育成の成績", 18, INK, true))
	for r in h.races:
		right.add_child(_lbl("%s %s　%s%s%dm %s　%d 着／%d 頭　%s" % [IK.data().slots[int(r.slot)].label, r.name, IK.data().courses[r.courseId].short,
			"芝" if r.surface == "芝" else "ダ", int(r.distance), r.ground, int(r.order), int(r.field), "・".join(r.get("skills", []))], 14, SUN.darkened(0.3) if int(r.order) == 1 else INK))
	page.add_child(_panel(_scroll(right)))
	return _margin(page, 22, 6, 22, 6)


# ------------------------------------------------------------------ 対戦

func _battle() -> Control:
	var page := _box(true, 12)
	if p.finished.is_empty():
		page.add_child(_head("完成馬が居ない。育成で 1 頭仕上げると対戦できる。"))
		return _margin(page, 22, 6, 22, 6)
	var hid = opts.get("id", p.finished[p.finished.size() - 1].id)
	var race_id: String = opts.get("race", IK.battle_races()[0].id)
	var diff: String = opts.get("diff", "normal")
	var row := _box(false, 12)
	var hp := OptionButton.new()
	for i in p.finished.size():
		var h: Dictionary = p.finished[i]
		hp.add_item("%s（%s %d）" % [h.name, h.rank, int(h.rating)])
		hp.set_item_metadata(i, h.id)
		if int(h.id) == int(hid):
			hp.select(i)
	hp.item_selected.connect(func(k: int) -> void: go("battle", {id = hp.get_item_metadata(k), race = race_id, diff = diff}))
	row.add_child(_lbl("出す馬", 16, TEAL, true))
	row.add_child(hp)
	page.add_child(_panel(row))
	page.add_child(_head("舞台（GI）"))
	var rg := _grid(5)
	for r in IK.battle_races():
		var b := _btn("%s\n%s %s%dm" % [r.name, IK.data().courses[r.courseId].short, "芝" if r.surface == "芝" else "ダ", int(r.distance)],
			go.bind("battle", {id = hid, race = r.id, diff = diff}), LEAF.lightened(0.3) if r.id == race_id else PAPER, 15)
		b.custom_minimum_size = Vector2(200, 62)
		rg.add_child(b)
	page.add_child(rg)
	var dr := _box(false, 10)
	dr.add_child(_head("相手の強さ"))
	var diffs: Dictionary = IK.data().difficulty
	for k in diffs:
		dr.add_child(_btn(diffs[k].name, go.bind("battle", {id = hid, race = race_id, diff = k}), SUN if k == diff else PAPER))
	page.add_child(dr)
	var go_row := _box(false, 12)
	go_row.add_child(_btn("ランク戦を走る ▶", func() -> void:
		var r := IK.battle_npc(p, hid, race_id, diff)
		save()
		var h = IK.find_finished(p, hid)
		_watch(r.result, [100], r.fired, _result.bind(r.result, [100], r.fired, "ランク戦　%s %d 着" % [h.name, int(r.order)], null)), LEAF, 20))
	if p.finished.size() >= 2:
		go_row.add_child(_btn("完成馬どうしで走らせる（%d 頭）" % mini(16, p.finished.size()), func() -> void:
			var ids: Array = p.finished.map(func(h): return h.id).slice(0, 16)
			var r := IK.battle_own(p, ids, race_id)
			save()
			var mine := range(ids.size()).map(func(i): return 100 + i)
			_watch(r.result, mine, r.fired, _result.bind(r.result, mine, r.fired, "完成馬どうし　%s" % r.race.name, null)), PAPER, 18))
	page.add_child(go_row)
	return _margin(page, 22, 6, 22, 6)


# ------------------------------------------------------------------ イベント

func _event() -> Control:
	var ev: Dictionary = IK.data().events[0]
	var st := IK.event_state(p, ev.id)
	var page := _box(false, 22)
	var rw = IK.card(ev.reward)
	page.add_child(_card_view(rw, 280))
	var v := _box(true, 10)
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	v.add_child(_lbl("%s　「%s」" % [ev.name, ev.title], 28, INK, true))
	v.add_child(_wrap(ev.blurb, 15))
	v.add_child(_lbl("ロンシャン 芝 2400m・不良・%d 頭　報酬：各難易度の初勝利で %s 1 枚（5 つで完凸）" % [ev.field.size() + 1, rw.name], 15, TEAL, true))
	var cleared: Array = st.cleared.map(func(x): return int(x))
	v.add_child(_lbl("勝った難易度　" + " ".join(range(1, 6).map(func(s): return ("★" if cleared.has(s) else "☆") + str(s))) + "　挑戦 %d 回" % int(st.tries), 17, SUN.darkened(0.3), true))
	if p.finished.is_empty():
		v.add_child(_lbl("完成馬が居ない。育成で 1 頭仕上げると挑める。", 17, INK, true))
	else:
		var hid = opts.get("id", p.finished[p.finished.size() - 1].id)
		var hp := OptionButton.new()
		for i in p.finished.size():
			var h: Dictionary = p.finished[i]
			hp.add_item("%s（%s %d）" % [h.name, h.rank, int(h.rating)])
			hp.set_item_metadata(i, h.id)
			if int(h.id) == int(hid):
				hp.select(i)
		hp.item_selected.connect(func(k: int) -> void: go("event", {id = hp.get_item_metadata(k)}))
		var row := _box(false, 10)
		row.add_child(_lbl("挑む馬", 16, TEAL, true))
		row.add_child(hp)
		v.add_child(row)
		var stars := _box(false, 10)
		for s in range(1, 6):
			stars.add_child(_btn("☆%d に挑む" % s, func() -> void:
				var r := IK.event_race(p, hid, ev.id, s)
				save()
				var extra: Control = null
				if r.reward != null:
					extra = _lbl("報酬：%s を手に入れた（覚醒 %d）" % [r.reward.card.name, int(r.reward.awaken)], 18, SUN.darkened(0.3), true)
				_watch(r.result, [100], r.fired, _result.bind(r.result, [100], r.fired, "%s ☆%d　%d 着" % [ev.name, s, int(r.order)], extra)),
				SUN if not cleared.has(s) else PAPER))
		v.add_child(stars)
	v.custom_minimum_size.x = 820
	page.add_child(_panel(v))
	return _margin(page, 22, 6, 22, 6)


# ------------------------------------------------------------------ 小さな部品（描画）

## 空（青緑から橙へ）と網点。ゲームの育成モードの背景（CSS）を描く
class SkyBg extends Control:
	func _draw() -> void:
		var top := Color("#113035")
		var mid := Color("#2c6a63")
		var low := Color("#f3a332")
		var h := size.y
		draw_polygon(PackedVector2Array([Vector2(0, 0), Vector2(size.x, 0), Vector2(size.x, h * 0.62), Vector2(0, h * 0.62)]),
			PackedColorArray([top, top, mid, mid]))
		draw_polygon(PackedVector2Array([Vector2(0, h * 0.62), Vector2(size.x, h * 0.62), Vector2(size.x, h), Vector2(0, h)]),
			PackedColorArray([mid, mid, low.lerp(mid, 0.25), low.lerp(mid, 0.25)]))
		# 網点（ステッカーの台紙の雰囲気）
		var dot := Color(1, 1, 1, 0.05)
		var step := 22.0
		var y := 0.0
		while y < h:
			var x := fmod(y / step, 2.0) * step * 0.5
			while x < size.x:
				draw_circle(Vector2(x, y), 2.0, dot)
				x += step
			y += step
		# 遠くの街並み（下の縁）
		var city := Color("#113035", 0.35)
		var bx := 0.0
		var k := 0
		while bx < size.x:
			var bw := 40.0 + float((k * 37) % 50)
			var bh := 30.0 + float((k * 53) % 70)
			draw_rect(Rect2(bx, h - bh, bw - 6, bh), city)
			bx += bw
			k += 1

	func _notification(what: int) -> void:
		if what == NOTIFICATION_RESIZED:
			queue_redraw()


class CardIcon extends Control:
	var face: Texture2D
	var ring := Color.WHITE
	var rar := ""
	var badge := ""
	var dim := false
	var sel := false
	var font: Font

	func _draw() -> void:
		var r := minf(size.x, size.y) / 2.0
		var c := Vector2(size.x / 2.0, r)
		draw_circle(c + Vector2(0, 3), r, Color("#113035", 0.5))
		draw_circle(c, r, Color("#113035"))
		draw_circle(c, r - 3, ring)
		draw_circle(c, r - 8, Color("#f8f3e6") if not dim else Color("#9aa3a0"))
		if face:
			var inner := r - 8
			draw_texture_rect(face, Rect2(c - Vector2(inner, inner), Vector2(inner, inner) * 2), false, Color(1, 1, 1, 1) if not dim else Color(0.1, 0.12, 0.13, 0.85))
		if sel:
			draw_arc(c, r + 2, 0, TAU, 48, Color("#f3a332"), 5, true)
		if font:
			var fs := int(maxf(10.0, r * 0.3))
			var tag := Rect2(c.x - r * 0.5, c.y + r * 0.62, r, fs + 4)
			draw_rect(tag, Color("#113035"))
			draw_string(font, Vector2(tag.position.x, tag.position.y + fs), rar, HORIZONTAL_ALIGNMENT_CENTER, tag.size.x, fs, ring.lightened(0.3))
			if badge != "":
				var bw := maxf(fs * 1.6, font.get_string_size(badge, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x + 10)
				var br := Rect2(size.x - bw, 0, bw, fs + 6)
				draw_style_box(_pill(), br)
				draw_string(font, Vector2(br.position.x, br.position.y + fs + 1), badge, HORIZONTAL_ALIGNMENT_CENTER, bw, fs, Color("#113035"))

	func _pill() -> StyleBoxFlat:
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color("#f3a332")
		sb.set_corner_radius_all(8)
		sb.border_color = Color("#113035")
		sb.set_border_width_all(2)
		return sb


## 伏せたカードの裏。charge（色）と glow（0..1）で最後の 1 枚を溜めて光らせる
class CardBack extends Control:
	var font: Font
	var charge := Color(0, 0, 0, 0)
	var glow := 0.0:
		set(v):
			glow = v
			queue_redraw()

	func _draw() -> void:
		var r := Rect2(Vector2.ZERO, size)
		if glow > 0.0:
			for i in 6:
				var g := float(6 - i) * 4.0 * glow
				var col := charge
				col.a = 0.12 * glow
				draw_style_box(_box(col, 18 + g), r.grow(g))
		draw_style_box(_box(Color("#113035"), 14, Color("#a7cb0e")), r)
		var inner := r.grow(-14)
		draw_style_box(_box(Color("#1d5a60"), 10, Color("#f3a332")), inner)
		if font:
			var fs := int(size.x * 0.11)
			draw_string(font, Vector2(inner.position.x, inner.get_center().y - fs * 0.2), "WINNING", HORIZONTAL_ALIGNMENT_CENTER, inner.size.x, fs, Color("#f8f3e6"))
			draw_string(font, Vector2(inner.position.x, inner.get_center().y + fs * 1.0), "ROAD", HORIZONTAL_ALIGNMENT_CENTER, inner.size.x, fs, Color("#a7cb0e"))

	func _box(bg: Color, radius: float, border := Color(0, 0, 0, 0)) -> StyleBoxFlat:
		var sb := StyleBoxFlat.new()
		sb.bg_color = bg
		sb.set_corner_radius_all(int(radius))
		if border.a > 0:
			sb.border_color = border
			sb.set_border_width_all(4)
		return sb
