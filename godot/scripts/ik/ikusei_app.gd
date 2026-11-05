extends Control
## カード育成モードの画面（Godot 版）。ゲームの src/ui/screens/ikusei.js と styles.css の「育成モード」の見た目を Godot で組み直したもの。
##
## 中身はすべて ik/ikusei.gd（ゲームの ikusei.js を移したもの）を通す。画面はプロフィールを読んで描き、押されたら
## ikusei.gd の関数を呼んで保存し、描き直すだけ。レースは ikusei.gd が GDScript で走らせ（ゲームと同じ結果）、
## 走行ログを競馬場（racecourse.gd）に渡して 3D で観る。
##
## 見た目はゲームに合わせる（最初に組んだ素の Button と 1 色の箱では「しょぼい」と言われた）：
## - 部品は ik/ui.gd の Box（グラデーション・紺の縁・下にずらした影を 1 枚のシェーダで）。見出しは斜体の極太。
## - 背景は空のグラデーション・網点・透かしの「WINNING ROAD」・灯りのともる街並み（SkyBg）。
## - 上の帯：丸い戻る・斜体の題と英語の札・かけらと通貨の札。下のボタン列：傾いた札（アイコン・題・英語）と菱形のガチャ。
## - ホームは縦長の舞台（ゲームの .ikh-stage）：大きな切り抜き・名札・左の丸い札（イベント・ガチャ）・右の丸いボタン・
##   左下の育成の進み・右下のチケット。中の画面は見出しの帯の付いた枠（section）を縦に並べる。
## 画面の入れ替えは本文だけを 8px 下から浮かせて出す（落とし穴 94）。

const IK := preload("res://scripts/ik/ikusei.gd")
const Skins := preload("res://scripts/ik/skins.gd")
const UI := preload("res://scripts/ik/ui.gd")
const TILT := preload("res://shaders/card_tilt.gdshader")
const RACECOURSE := preload("res://scenes/racecourse.tscn")

const INK := UI.INK
const TEAL2 := UI.TEAL2
const LEAF := UI.LEAF
const LEAF2 := UI.LEAF2
const SUN := UI.SUN
const SUN2 := UI.SUN2
const PAPER := UI.PAPER
const RAR_COL := {LM = Color("#b46cff"), SSR = Color("#e8b33a"), SR = Color("#b9c3d0"), R = Color("#c9884e"), N = Color("#6fbf57")}
const RAR_TEXT := {LM = "#8a3fd6", SSR = "#b07a10", SR = "#5d6b7c", R = "#9a5a22", N = "#3d8a2c"}
const HOLO := {LM = 1.0, SSR = 0.8, SR = 0.65, R = 0.5, N = 0.0}
const TITLES := {gacha = ["ガチャ", "GACHA"], cards = ["所持カード", "MY CARDS"], book = ["カード図鑑", "CARD BOOK"], deck = ["編成", "DECK"],
	train = ["育成", "TRAINING"], finished = ["完成馬", "STABLE"], horse = ["完成馬", "HORSE"], battle = ["対戦", "BATTLE"], event = ["イベント", "EVENT"]}

var p: Dictionary
var screen := "home"
var opts := {}
var sky: Control
var top: Control
var body: Control
var dock: Control
var overlay: Control
var watching: Node = null
var card_menu: Control
var book_opt := {pack = "", rar = "", sort = "rar"}
var deck_f := {rar = "", surf = "", dist = "", style = "", skill = ""}
var ev_slide := ""


func _ready() -> void:
	p = IK.load_profile()
	IK.data()
	set_anchors_preset(Control.PRESET_FULL_RECT)
	var th := Theme.new()
	th.default_font = UI.font("body")
	th.default_font_size = 15
	theme = th
	sky = SkyBg.new()
	sky.set_anchors_preset(Control.PRESET_FULL_RECT)
	sky.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(sky)
	body = Control.new()
	body.set_anchors_preset(Control.PRESET_FULL_RECT)
	body.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(body)
	top = Control.new()
	top.set_anchors_preset(Control.PRESET_TOP_WIDE)
	top.custom_minimum_size.y = 70
	top.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(top)
	dock = Control.new()
	dock.set_anchors_preset(Control.PRESET_FULL_RECT)
	dock.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(dock)
	overlay = Control.new()
	overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(overlay)
	resized.connect(func() -> void:
		if watching == null and is_inside_tree():
			render(false))
	var args := {}
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--") and a.contains("="):
			var kv := a.substr(2).split("=", true, 1)
			args[kv[0]] = kv[1]
	if args.has("demo"):
		_demo(int(args.demo))
	if args.has("gear") and p.run != null:
		# 確かめ用：育成中の馬に馬具を着ける（--gear=1。メンコ赤・ブリンカー・シャドーロール白）。--gearpick=1 で馬具を選ぶ板を開く
		IK.set_run_gear(p.run, {menko = "#c8202a", blinker = true, shadowRoll = "#f4f2ec"})
	if args.has("deck"):
		# 確かめ用：育成をやめて、おまかせの編成（父・母・サポート）を開く
		p.run = null
		go("deck")
		_omakase()
	else:
		var o0 := {id = int(args.id)} if args.has("id") else {}
		if args.has("evid"):
			o0.ev = String(args.evid)
		# 確かめ用：対戦のバナーの何枚目（--evslide=arc1999）、編成で父だけ決めた状態（--sire=P1-40）、絞り込み（--df=dist:中距離）
		if args.has("evslide"):
			ev_slide = String(args.evslide)
		if args.has("sire") or args.has("df"):
			p.run = null
		if args.has("sire"):
			o0.f = String(args.sire)
		if args.has("df"):
			var kv := String(args.df).split(":")
			deck_f[kv[0]] = kv[1]
		go(args.get("screen", "home"), o0)
	if args.has("toturn"):
		while int(p.run.turn) < int(args.toturn):
			if IK.is_race_turn(p.run):
				IK.race_turn(p.run, IK.race_options(p.run)[0].id)
			else:
				IK.train(p.run, "wit")
		render(false)
	if args.has("pull"):
		_do_pull(int(args.pull))
	if args.has("card"):
		_show_card(IK.card(args.card))
	if args.has("menu"):
		_toggle_menu()
	if args.has("gearpick") and p.run != null:
		_gear_picker(IK.run_gear(p.run), String(IK.trainee_card(p.run).name), func(g: Dictionary) -> void: IK.set_run_gear(p.run, g))
	if args.has("event"):
		# 確かめ用：イベント（既定は凱旋門賞 1999、--evid=bc1989 で BC クラシック）を走って観戦の時刻（--event=秒）で止める
		var r := IK.event_race(p, p.finished[0].id, String(args.get("evid", "arc1999")), 1)
		_watch(r.result, [100], r.fired, func() -> void: pass)
		watching.race_t = float(args.event)
		watching.playing = false
	if args.has("race"):
		# 確かめ用：レースの週まで練習を進めてレースを走り、観戦の時刻（--race=秒）で止める。--result=1 で結果の板
		while not IK.is_race_turn(p.run):
			IK.train(p.run, "wit")
		_race(IK.race_options(p.run)[0].id)
		watching.race_t = float(args.race)
		watching.playing = false
		if args.has("cam"):
			watching.set_camera(args.cam)
		if args.has("result"):
			watching.finished.emit()
	if args.has("skx"):
		# 確かめ用：育成の画面の「詳しく」を押す（--skx=1。--wait で開く途中・開いた後を撮る）
		await get_tree().process_frame
		await get_tree().process_frame
		for l in find_children("*", "Label", true, false):
			if (l as Label).text == "詳しく":
				l.get_parent().emit_signal("pressed")
				break
	if args.has("shot"):
		_shoot(args.shot, float(args.get("wait", "1.5")), int(args.get("scrolly", "0")))


func _shoot(path: String, wait: float, scrolly := 0) -> void:
	await get_tree().create_timer(wait).timeout
	if scrolly > 0:
		# 確かめ用：本文を下へ送ってから撮る（--scrolly=600）
		for sc in body.find_children("*", "ScrollContainer", true, false):
			sc.scroll_vertical = scrolly
		await get_tree().create_timer(0.3).timeout
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(path)
	print("saved ", path)
	get_tree().quit()


## 確かめ用：決まった手でカードを集めて 1 頭育て、2 頭目を育成中にしたプロフィール（--demo=シード）。保存はしない
func _demo(seed: int) -> void:
	p = IK.new_profile(seed)
	IK.pull(p, 60)
	var own := IK.owned(p)
	var ms := own.filter(func(c): return c.sex == "牡")
	var fs := own.filter(func(c): return c.sex == "牝")
	var rest := own.filter(func(c): return c.id != ms[0].id and c.id != fs[0].id)
	IK.start_run(p, {sire = ms[0].id, dam = fs[0].id, name = IK.foal_name_idea(ms[0], fs[0])}, rest.slice(0, 4).map(func(c): return c.id))
	while not IK.run_done(p.run):
		if IK.is_race_turn(p.run):
			IK.race_turn(p.run, IK.race_options(p.run)[0].id)
		elif int(p.run.energy) < 45:
			IK.rest(p.run)
		else:
			IK.train(p.run, IK.STATS[int(p.run.turn) % 5])
	IK.finish_run(p)
	var m2: Dictionary = ms[1] if ms.size() > 1 else ms[0]
	var f2: Dictionary = fs[1] if fs.size() > 1 else fs[0]
	var rest2 := own.filter(func(c): return c.id != m2.id and c.id != f2.id)
	IK.start_run(p, {sire = m2.id, dam = f2.id, name = IK.foal_name_idea(m2, f2)}, rest2.slice(0, 4).map(func(c): return c.id))
	for i in 6:
		if IK.is_race_turn(p.run):
			IK.race_turn(p.run, IK.race_options(p.run)[0].id)
		else:
			IK.train(p.run, IK.STATS[i % 5])
	set_meta("nosave", true)


func save() -> void:
	if not has_meta("nosave"):
		IK.save_profile(p)


# ------------------------------------------------------------------ 素材

func _tex(path: String) -> Texture2D:
	return load(path) if ResourceLoader.exists(path) else null


## 絵の id（配合の馬は毛色を受け継いだ親のカードの絵）
func _aid(c: Dictionary) -> String:
	return c.get("art", c.id)


func _card_tex(id: String) -> Texture2D:
	return _tex("res://assets/cards/%s.webp" % id)


func _face_tex(id: String) -> Texture2D:
	return _tex("res://assets/cards/face/%s.png" % id)


func _sticker_tex(id: String) -> Texture2D:
	return _tex("res://assets/cards/sticker/%s.webp" % id)


func _bg_tex(id: String) -> Texture2D:
	return _tex("res://assets/cards/bg/%s.webp" % id)


func _img(t: Texture2D, cover := false) -> TextureRect:
	var r := TextureRect.new()
	r.texture = t
	r.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	r.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED if cover else TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return r


## 中の画面の幅（ゲームの .ikp は最大 1010px）
func W() -> float:
	return minf(1010.0, size.x - 40.0)


# ------------------------------------------------------------------ カード・アイコン

## カードの表（傾けると光沢とホロが流れる）。w は幅（高さは 880/630 倍）
func _card_view(c: Dictionary, w: float, tilt := true, on_click := Callable()) -> Control:
	var tr := _img(_card_tex(_aid(c)))
	tr.custom_minimum_size = Vector2(w, w * 880.0 / 630.0)
	var mat := ShaderMaterial.new()
	mat.shader = TILT
	mat.set_shader_parameter("holo", HOLO.get(c.rar, 0.0))
	tr.material = mat
	if tilt or on_click.is_valid():
		tr.mouse_filter = Control.MOUSE_FILTER_STOP
	if on_click.is_valid():
		tr.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		tr.gui_input.connect(func(e: InputEvent) -> void:
			if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
				on_click.call())
	if tilt:
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


## 顔の丸いアイコン（枠の色がレア度。LM は虹）。count で右上に枚数と覚醒
func _icon(c: Dictionary, size := 86.0, badge := "", on_click := Callable(), dim := false, count := 0) -> CardIcon:
	var ic := CardIcon.new()
	ic.face = _face_tex(_aid(c))
	ic.rar = c.rar
	ic.badge = badge
	ic.count = count
	ic.dim = dim
	ic.custom_minimum_size = Vector2(size, size)
	ic.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if on_click.is_valid():
		ic.mouse_filter = Control.MOUSE_FILTER_STOP
		ic.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		ic.gui_input.connect(func(e: InputEvent) -> void:
			if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
				on_click.call())
		ic.mouse_entered.connect(func() -> void:
			ic.pivot_offset = ic.size / 2.0
			ic.create_tween().tween_property(ic, "scale", Vector2(1.05, 1.05), 0.12))
		ic.mouse_exited.connect(func() -> void: ic.create_tween().tween_property(ic, "scale", Vector2.ONE, 0.12))
	return ic


## アイコン＋名前の札（所持カード・完成馬の一覧の 1 マス）
func _tile(c: Dictionary, line1: String, line2: String, on_click: Callable, o := {}) -> Control:
	var v := UI.vbox(3)
	v.custom_minimum_size.x = 112
	var ic := _icon(c, 86, o.get("badge", ""), on_click, o.get("dim", false), o.get("count", 0))
	ic.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	ic.sel = o.get("sel", false)
	v.add_child(ic)
	var n := UI.label(line1, 14, INK, "black")
	n.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	n.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	n.custom_minimum_size.x = 112
	v.add_child(n)
	var s := UI.label(line2, 11, Color("#5f706c"))
	s.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(s)
	return v


func _grid(cols: int, h := 8, vsep := 14) -> GridContainer:
	var g := GridContainer.new()
	g.columns = maxi(1, cols)
	g.add_theme_constant_override("h_separation", h)
	g.add_theme_constant_override("v_separation", vsep)
	g.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return g


func _cols(inner_w: float, item_w: float) -> int:
	return maxi(2, int(inner_w / item_w))


func _rar_badge(rar: String, size := 13) -> Control:
	var cols := {LM = [Color("#ff7ea6"), Color("#ffd36a"), Color("#7fe0ff"), Color("#b98cff")], SSR = [Color("#fff3b0"), Color("#e8b33a")],
		SR = [Color("#ffffff"), Color("#aeb8c6")], R = [Color("#ffd9b0"), Color("#c9884e")], N = [Color("#dff5cc"), Color("#6fbf57")]}
	var b := UI.box({c = cols.get(rar, [PAPER]), angle = 90.0 if rar == "LM" else 180.0, radius = 6.0, border = 2.0, shadow = Vector2(0, 2), pad = Vector4(7, 1, 7, 2)})
	b.add_child(UI.label(rar, size, INK, "title"))
	return b


# ------------------------------------------------------------------ 画面の切り替え

func go(name: String, o := {}) -> void:
	var same := name == screen and o.hash() == opts.hash()
	screen = name
	opts = o
	_close_menu()
	render(not same)


func render(animate := true) -> void:
	for n in [body, top, dock]:
		for c in n.get_children():
			n.remove_child(c)
			c.queue_free()
	var page: Control
	if screen == "home":
		top.visible = false
		page = _home()
	else:
		top.visible = true
		_render_top()
		var content: Control
		match screen:
			"gacha": content = _gacha()
			"cards": content = _cards()
			"book": content = _book()
			"deck": content = _deck()
			"train": content = _train()
			"finished": content = _finished()
			"horse": content = _horse()
			"battle": content = _battle()
			"event": content = _event()
			_: content = _gacha()
		page = _scrolled(content)
	body.add_child(page)
	_render_dock()
	if animate:
		# position を動かすと、大きさの決まる前の画面で錨の位置が狂って本文が右へずれた。余白（offset）で動かす
		page.modulate.a = 0.0
		var t0 := page.offset_top
		var b0 := page.offset_bottom
		page.offset_top = t0 + 8.0
		page.offset_bottom = b0 + 8.0
		var tw := page.create_tween().set_trans(Tween.TRANS_QUART).set_ease(Tween.EASE_OUT).set_parallel()
		tw.tween_property(page, "modulate:a", 1.0, 0.2)
		tw.tween_property(page, "offset_top", t0, 0.24)
		tw.tween_property(page, "offset_bottom", b0, 0.24)


## 中の画面：上の帯の下から流れる（下に 116px 空ける。ボタン列が中身を隠さない）
func _scrolled(content: Control) -> Control:
	var sc := ScrollContainer.new()
	sc.set_anchors_preset(Control.PRESET_FULL_RECT)
	sc.offset_top = 70
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	# スクロールバーの幅をいつも取っておく。中身が伸びてスクロールできるようになった瞬間に、本文が狭くなった（「詳しく」を開くと少し小さくなる）
	sc.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_RESERVE
	var m := MarginContainer.new()
	m.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var side := int((size.x - W()) / 2.0)
	m.add_theme_constant_override("margin_left", side)
	m.add_theme_constant_override("margin_right", side)
	m.add_theme_constant_override("margin_top", 6)
	m.add_theme_constant_override("margin_bottom", 116)
	content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	m.add_child(content)
	sc.add_child(m)
	return sc


func _render_top() -> void:
	var h := UI.hbox(12)
	h.position = Vector2((size.x - W()) / 2.0, 12)
	h.size = Vector2(W(), 46)
	var back := UI.box({c = [Color.WHITE], radius = 999.0, border = 0.0, shadow = Vector2(0, 3), shadow_color = Color(0, 0, 0, 0.25), pad = Vector4(8, 8, 8, 8)})
	back.custom_minimum_size = Vector2(44, 44)
	back.add_child(UI.icon("back", 26, INK))
	back.press(go.bind("home"))
	h.add_child(back)
	var tt: Array = TITLES.get(screen, ["", ""])
	h.add_child(UI.outlined(tt[0], 30, Color.WHITE, "title", Color("#0d2a2e"), 5))
	var chip := UI.box({c = [LEAF2], radius = 6.0, border = 2.5, shadow = Vector2(0, 3), pad = Vector4(8, 1, 8, 2)})
	chip.add_child(UI.label(tt[1], 12, INK, "title"))
	chip.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	chip.rotation = -0.06
	h.add_child(chip)
	var sp := Control.new()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sp.mouse_filter = Control.MOUSE_FILTER_IGNORE
	h.add_child(sp)
	h.add_child(_shard_pill())
	h.add_child(_coin_pill())
	top.add_child(h)


## かけらの札（緑の宝石・数）。余りがあれば橙の点
func _shard_pill() -> Control:
	var b := UI.box({c = [INK], radius = 999.0, border = 2.5, border_color = Color.WHITE, shadow = Vector2(0, 3), shadow_color = Color(0, 0, 0, 0.3), pad = Vector4(10, 4, 14, 5)})
	b.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var h := UI.hbox(7)
	var gem := Gem.new()
	gem.custom_minimum_size = Vector2(20, 20)
	gem.mouse_filter = Control.MOUSE_FILTER_IGNORE
	h.add_child(gem)
	h.add_child(UI.label(str(int(p.get("shards", 0))), 18, Color.WHITE, "black"))
	if IK.spare_value(p) > 0:
		var dot := Dot.new()
		dot.custom_minimum_size = Vector2(8, 20)
		h.add_child(dot)
	b.add_child(h)
	b.press(go.bind("cards"))
	return b


## 通貨の札（試作なので何度でも引ける：∞）
func _coin_pill() -> Control:
	var b := UI.box({c = [INK], radius = 999.0, border = 2.5, border_color = Color.WHITE, shadow = Vector2(0, 3), shadow_color = Color(0, 0, 0, 0.3), pad = Vector4(6, 4, 6, 5)})
	b.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var h := UI.hbox(6)
	h.add_child(UI.icon("coin", 20, Color("#f6cf86")))
	h.add_child(UI.label("∞", 20, SUN, "black"))
	var plus := UI.box({c = [SUN], radius = 999.0, border = 0.0, shadow = Vector2.ZERO, pad = Vector4(5, 0, 5, 1)})
	plus.add_child(UI.label("+", 16, INK, "black"))
	h.add_child(plus)
	b.add_child(h)
	b.press(go.bind("gacha"))
	return b


## 下のボタン列（ゲームの .ik-dock）：傾いた札 4 枚と菱形のガチャ
func _render_dock() -> void:
	var row := UI.hbox(4, BoxContainer.ALIGNMENT_CENTER)
	var on: String = {home = "home", gacha = "gacha", battle = "battle", event = "battle", train = "train", deck = "cards", cards = "cards", book = "cards", finished = "cards", horse = "cards"}.get(screen, "")
	row.add_child(_dock_item("cards", "カード", "CARDS", "cards", [PAPER, SUN2], Color("#c97f22"), Vector2(92, 64), 0.05, on == "cards", "", _toggle_menu))
	row.add_child(_dock_item("train", "育成", "TRAINING", "horse", [Color("#dbe89a"), LEAF], INK, Vector2(126, 74), 0.035, on == "train", "!" if p.run != null else "",
		func() -> void: go("train" if p.run != null else "deck")))
	row.add_child(_dock_item("home", "ホーム", "HOME", "home", [Color("#f8cf8f"), SUN], INK, Vector2(100, 64), -0.03, on == "home", "", go.bind("home")))
	row.add_child(_dock_item("battle", "対戦", "BATTLE", "sword", [PAPER, Color("#d7e3cf")], TEAL2, Vector2(100, 64), 0.03, on == "battle", "", go.bind("battle")))
	# 菱形のガチャ（箱を 45° 回し、中身だけは回さずに重ねる）
	var gw := Control.new()
	gw.custom_minimum_size = Vector2(86, 80)
	gw.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var g := UI.box({c = [Color("#4f7a3c"), TEAL2, INK], s1 = 0.55, s2 = 0.551, angle = 135.0, radius = 10.0, border = 3.0, border_color = Color.WHITE,
		outline = 2.5, shadow = Vector2(4, 4), pad = Vector4.ZERO})
	g.size = Vector2(56, 56)
	g.position = Vector2(15, 12)
	g.pivot_offset = Vector2(28, 28)
	g.rotation = PI / 4
	g.press(go.bind("gacha"))
	gw.add_child(g)
	var gv := UI.vbox(0, BoxContainer.ALIGNMENT_CENTER)
	gv.position = Vector2(15, 14)
	gv.size = Vector2(56, 52)
	gv.add_child(_centered(UI.icon("spark", 24, Color.WHITE)))
	var gl := UI.outlined("ガチャ", 13, Color.WHITE, "black", INK, 4)
	gl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	gv.add_child(gl)
	gw.add_child(gv)
	row.add_child(gw)
	row.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	row.grow_horizontal = Control.GROW_DIRECTION_BOTH
	row.grow_vertical = Control.GROW_DIRECTION_BEGIN
	row.offset_bottom = -4
	dock.add_child(row)


func _dock_item(id: String, jp: String, en: String, icon_name: String, cols: Array, icol: Color, sz: Vector2, rot: float, on: bool, badge: String, cb: Callable) -> Control:
	var wrap := Control.new()
	wrap.custom_minimum_size = sz + Vector2(6, 14)
	wrap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var b := UI.box({c = cols, angle = 180.0, radius = 12.0, border = 3.0, shadow = Vector2(0, 5), pad = Vector4(4, 4, 4, 4)})
	b.size = sz
	b.position = Vector2(3, 14 - (8 if on else 0) - (sz.y - 64))
	b.pivot_offset = sz / 2.0
	b.rotation = rot
	var v := UI.vbox(0, BoxContainer.ALIGNMENT_CENTER)
	v.add_child(_centered(UI.icon(icon_name, 22, icol)))
	var j := UI.label(jp, 16 if id != "train" else 18, INK, "black")
	j.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(j)
	var e := UI.label(en, 8, Color("#33504f"), "title")
	e.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(e)
	b.add_child(v)
	b.press(cb)
	wrap.add_child(b)
	if badge != "":
		wrap.add_child(_badge(badge, Vector2(sz.x - 14, b.position.y - 8)))
	if id == "cards":
		wrap.name = "CardsBtn"
	return wrap


func _centered(c: Control) -> CenterContainer:
	var cc := CenterContainer.new()
	cc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cc.add_child(c)
	return cc


func _badge(text: String, pos: Vector2) -> Control:
	var b := UI.box({c = [Color("#d9792a")], radius = 999.0, border = 2.0, border_color = Color.WHITE, outline = 1.5, shadow = Vector2.ZERO, pad = Vector4(6, 0, 6, 1)})
	b.add_child(UI.label(text, 12, Color.WHITE, "black"))
	b.position = pos
	b.size = b.get_combined_minimum_size()
	return b


## 下の「カード」：所持カード・完成馬・編成・図鑑の小さな一覧（ゲームの .ikd-menu）
func _toggle_menu() -> void:
	if card_menu != null:
		_close_menu()
		return
	var v := UI.vbox(6)
	for it in [["cards", "所持カード", "cards"], ["finished", "完成馬", "trophy"], ["deck", "編成", "horse"], ["book", "カード図鑑", "book"]]:
		var b := UI.box({c = [LEAF2 if screen == it[0] else PAPER], radius = 10.0, border = 2.5, shadow = Vector2(0, 3), pad = Vector4(12, 6, 16, 7)})
		var h := UI.hbox(8)
		h.add_child(UI.icon(it[2], 20, INK))
		h.add_child(UI.label(it[1], 16, INK, "black"))
		b.add_child(h)
		b.custom_minimum_size.x = 170
		b.press(go.bind(it[0]))
		v.add_child(b)
	var m := UI.box({c = [Color("#fffaf0")], radius = 14.0, border = 3.0, shadow = Vector2(0, 6), pad = Vector4(10, 10, 10, 10)})
	m.add_child(v)
	card_menu = m
	overlay.add_child(m)
	m.size = m.get_combined_minimum_size()
	var cb: Control = dock.find_child("CardsBtn", true, false)
	var at := cb.global_position if cb else Vector2(size.x / 2.0 - 200, size.y - 80)
	m.position = Vector2(at.x - 30, at.y - m.size.y - 2)
	m.modulate.a = 0.0
	var y1 := m.position.y
	m.position.y += 8
	var tw := m.create_tween().set_parallel()
	tw.tween_property(m, "modulate:a", 1.0, 0.15)
	tw.tween_property(m, "position:y", y1, 0.18)


func _close_menu() -> void:
	if card_menu != null:
		card_menu.queue_free()
		card_menu = null


func toast(text: String) -> void:
	var b := UI.box({c = [INK], radius = 12.0, border = 2.5, border_color = Color.WHITE, shadow = Vector2(0, 4), pad = Vector4(16, 8, 16, 9)})
	b.add_child(UI.label(text, 16, Color("#f6e7b8"), "black"))
	overlay.add_child(b)
	b.size = b.get_combined_minimum_size()
	b.position = Vector2((size.x - b.size.x) / 2.0, 84)
	b.modulate.a = 0.0
	var tw := b.create_tween()
	tw.tween_property(b, "modulate:a", 1.0, 0.18)
	tw.tween_interval(1.8)
	tw.tween_property(b, "modulate:a", 0.0, 0.3)
	tw.tween_callback(b.queue_free)


## 前に出す板。外を押すか閉じるで閉じる（閉じるときも薄めてから消す）
func modal(content: Control, w := 860.0) -> Control:
	_close_menu()
	var wrap := Control.new()
	wrap.set_anchors_preset(Control.PRESET_FULL_RECT)
	wrap.mouse_filter = Control.MOUSE_FILTER_STOP
	var dim := ColorRect.new()
	dim.color = Color(INK, 0.6)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	wrap.add_child(dim)
	var pc := UI.box({c = [Color("#fffaf0")], radius = 20.0, border = 3.0, shadow = Vector2(0, 8), pad = Vector4(20, 18, 20, 18)})
	pc.add_child(content)
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
	var ms := pc.get_combined_minimum_size()
	pc.size = Vector2(minf(maxf(w, ms.x), size.x - 30), minf(ms.y, size.y - 30))
	var y1 := maxf(15.0, (size.y - pc.size.y) / 2.0)
	pc.position = Vector2((size.x - pc.size.x) / 2.0, y1 + 10)
	wrap.modulate.a = 0.0
	var tw2 := wrap.create_tween().set_trans(Tween.TRANS_QUART).set_ease(Tween.EASE_OUT).set_parallel()
	tw2.tween_property(wrap, "modulate:a", 1.0, 0.2)
	tw2.tween_property(pc, "position:y", y1, 0.24)
	return wrap


func close_modal(w: Control) -> void:
	if is_instance_valid(w):
		w.get_meta("close").call()


# ------------------------------------------------------------------ ホーム（ゲームの .ikh：縦長の舞台）

func _home_card() -> Dictionary:
	var fav = p.get("fav")
	if fav != null and IK.count_of(p, fav) > 0:
		return IK.card(fav)
	if fav is String and fav.begins_with("B"):
		var fh = IK.find_finished(p, int(fav.substr(1)))
		if fh != null:
			return IK.horse_card(fh)
	if p.run != null:
		return IK.trainee_card(p.run)
	if p.finished.size() > 0:
		var best = p.finished[0]
		for h in p.finished:
			if int(h.rating) > int(best.rating):
				best = h
		return IK.horse_card(best)
	var own := IK.owned(p)
	if own.size() > 0:
		var best: Dictionary = own[0]
		for c in own:
			if int(c.power) > int(best.power):
				best = c
		return best
	return IK.card("P1-01")


func _home() -> Control:
	var page := Control.new()
	page.set_anchors_preset(Control.PRESET_FULL_RECT)
	page.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var cw := minf(560.0, size.x - 32.0)
	var x0 := (size.x - cw) / 2.0
	var hc := _home_card()
	var owned := IK.count_of(p, hc.id) > 0

	# 上：顔（押すとホームの馬を選ぶ）と戦力・かけら・通貨
	var ava := UI.box({c = [LEAF2, SUN2], angle = 135.0, radius = 12.0, border = 3.0, border_color = Color.WHITE, outline = 2.5, shadow = Vector2(0, 4), pad = Vector4(3, 3, 3, 3)})
	ava.position = Vector2(x0, 8)
	ava.size = Vector2(58, 58)
	ava.add_child(UI.mask(_img(_face_tex(_aid(hc)), true), 9.0))
	ava.press(_pick_favorite)
	page.add_child(ava)
	var pw := UI.box({c = [INK], radius = 999.0, border = 0.0, shadow = Vector2.ZERO, pad = Vector4(10, 3, 14, 4)})
	var ph := UI.hbox(6)
	ph.add_child(UI.icon("fist", 15, Color.WHITE))
	ph.add_child(UI.label(_comma(IK.collection_power(p)), 17, Color.WHITE, "black"))
	pw.add_child(ph)
	pw.position = Vector2(x0 + 70, 38)
	pw.size = pw.get_combined_minimum_size()
	page.add_child(pw)
	var pills := UI.hbox(10)
	pills.add_child(_shard_pill())
	pills.add_child(_coin_pill())
	pills.size = pills.get_combined_minimum_size()
	pills.position = Vector2(x0 + cw - pills.size.x, 18)
	page.add_child(pills)

	# 舞台：白い縁の外に紺の輪郭、中は夕方の空と網点
	var stage := UI.box({c = [Color("#1d4440"), Color("#3e6a3c"), Color("#93ad3a"), Color("#eab066")], s1 = 0.4, s2 = 0.74, angle = 180.0,
		radius = 24.0, border = 5.0, border_color = Color.WHITE, outline = 3.0, shadow = Vector2(0, 6), dots = 0.07, pad = Vector4(5, 5, 5, 5)})
	stage.position = Vector2(x0, 76)
	stage.size = Vector2(cw, size.y - 76 - 20)
	var layer := Control.new()
	layer.clip_contents = true
	layer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	stage.add_child(layer)
	page.add_child(stage)
	var sw := cw - 10
	var shh := stage.size.y - 10
	var city := City.new()
	city.position = Vector2(0, shh * 0.42)
	city.size = Vector2(sw, shh * 0.58)
	city.modulate.a = 0.35
	city.mouse_filter = Control.MOUSE_FILTER_IGNORE
	UI.mask(city, 19.0)
	layer.add_child(city)

	# 主役：白縁の切り抜きをふわっと浮かせる
	var hero := _img(_sticker_tex(_aid(hc)))
	hero.position = Vector2(sw * 0.06, shh * 0.02)
	hero.size = Vector2(sw * 0.94, shh * 0.66)
	hero.mouse_filter = Control.MOUSE_FILTER_STOP
	hero.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	hero.gui_input.connect(func(e: InputEvent) -> void:
		if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
			if hc.get("bred", false):
				go("train") if p.run != null and "B%d" % int(p.run.id) == hc.id else go("horse", {id = int(hc.id.substr(1))})
			elif owned:
				_show_card(hc)
			else:
				go("gacha"))
	layer.add_child(hero)
	var y0 := hero.position.y
	var bob := hero.create_tween().set_loops().set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	bob.tween_property(hero, "position:y", y0 - 6, 1.6)
	bob.tween_property(hero, "position:y", y0, 1.6)

	# 名札
	var plate := UI.box({c = [PAPER], radius = 10.0, border = 3.0, shadow = Vector2(0, 4), pad = Vector4(8, 5, 14, 6)})
	var plh := UI.hbox(8)
	var rb := _rar_badge(hc.rar, 15)
	rb.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	plh.add_child(rb)
	var pv := UI.vbox(-2)
	pv.add_child(UI.label(hc.epithetText, 11, Color("#5d7a10"), "black"))
	pv.add_child(UI.label(hc.name, 22, INK, "title"))
	plh.add_child(pv)
	if not owned:
		var em := UI.box({c = [TEAL2], radius = 6.0, border = 0.0, shadow = Vector2.ZERO, pad = Vector4(6, 1, 6, 2)})
		em.add_child(UI.label("未所持", 11, Color.WHITE, "black"))
		em.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		plh.add_child(em)
	plate.add_child(plh)
	plate.size = plate.get_combined_minimum_size()
	plate.position = Vector2(maxf(150.0, sw * 0.62 - plate.size.x - 20), shh * 0.655)
	plate.pivot_offset = plate.size / 2.0
	plate.rotation = -0.05
	layer.add_child(plate)

	# 左の列：イベント・ガチャ・遊びかた（丸い顔と帯）
	# 開催中のイベントは新しいものから（ほかのイベントは対戦の画面のバナーから入れる）
	var ev: Dictionary = IK.data().events.back()
	var left := UI.vbox(6)
	left.position = Vector2(4, 12)
	var ev_left: int = 5 - IK.event_state(p, ev.id).cleared.size()
	left.add_child(_round_entry(_face_tex(ev.reward), LEAF2, "イベント 開催中", TEAL2, str(ev_left) if ev_left > 0 else "", go.bind("event", {ev = ev.id})))
	left.add_child(_round_entry(_face_tex("P4-01"), SUN2, "ガチャ NEW", Color("#c97f22"), "!", go.bind("gacha")))
	left.add_child(_round_entry(null, Color("#eee6c8"), "遊びかた", LEAF, "", _howto, "book"))
	layer.add_child(left)

	# 右の列：丸いボタン（図鑑・競馬場・完成馬）
	var right := UI.vbox(10)
	for it in [["book", "図鑑", go.bind("book")], ["flag", "競馬場", func() -> void: get_tree().change_scene_to_file("res://scenes/racecourse.tscn")], ["trophy", "完成馬", go.bind("finished")]]:
		var rbt := UI.box({c = [INK], radius = 999.0, border = 2.5, border_color = Color.WHITE, shadow = Vector2(0, 3), shadow_color = Color(0, 0, 0, 0.3), pad = Vector4(4, 7, 4, 5)})
		rbt.custom_minimum_size = Vector2(54, 54)
		var rv := UI.vbox(0, BoxContainer.ALIGNMENT_CENTER)
		rv.add_child(_centered(UI.icon(it[0], 22, Color.WHITE)))
		var rl := UI.label(it[1], 9, Color.WHITE, "black")
		rl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		rv.add_child(rl)
		rbt.add_child(rv)
		rbt.press(it[2])
		right.add_child(rbt)
	right.position = Vector2(sw - 66, 14)
	layer.add_child(right)

	# 左下：育成の進み（輪・吹き出し・札）
	var run = p.run
	var prog := Control.new()
	prog.position = Vector2(14, shh - 222)
	prog.size = Vector2(130, 160)
	prog.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var ring := Ring.new()
	ring.face = _face_tex(_aid(IK.trainee_card(run))) if run != null else null
	ring.p = float(int(run.turn)) / IK.TOTAL_TURNS if run != null else 0.0
	ring.big = str(int(run.starts)) if run != null else "0"
	ring.position = Vector2(14, 34)
	ring.size = Vector2(96, 96)
	ring.mouse_filter = Control.MOUSE_FILTER_STOP
	ring.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	ring.gui_input.connect(func(e: InputEvent) -> void:
		if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
			go("train" if p.run != null else "deck"))
	prog.add_child(ring)
	var bubble := UI.box({c = [LEAF2], radius = 10.0, border = 2.5, shadow = Vector2(0, 3), pad = Vector4(10, 3, 10, 4)})
	bubble.add_child(UI.label(("レースだ!" if IK.is_race_turn(run) else "育成へ!") if run != null else "育成しよう!", 15, INK, "title"))
	bubble.size = bubble.get_combined_minimum_size()
	bubble.rotation = -0.06
	prog.add_child(bubble)
	var pl := UI.box({c = [TEAL2], radius = 8.0, border = 2.0, border_color = Color.WHITE, shadow = Vector2(0, 3), pad = Vector4(10, 2, 10, 3)})
	pl.add_child(UI.label("育成 進行中" if run != null else "育成を始める", 13, Color.WHITE, "black"))
	pl.size = pl.get_combined_minimum_size()
	pl.position = Vector2(62 - pl.size.x / 2.0, 126)
	prog.add_child(pl)
	if run != null:
		prog.add_child(_badge("!", Vector2(98, 34)))
	layer.add_child(prog)

	# 右下：チケット（ランク対戦・カード図鑑）
	var t1 := _ticket("ランク", "対戦", _bg_tex(_aid(hc)), "完成馬 %d頭" % p.finished.size(), go.bind("battle"))
	t1.position = Vector2(sw - t1.size.x - 6, shh - 250)
	t1.rotation = -0.07
	layer.add_child(t1)
	var second := hc
	for c in IK.owned(p):
		if c.id != hc.id:
			second = c
			break
	var t2 := _ticket("カード", "図鑑", _bg_tex(second.id), "%d/%d" % [IK.owned(p).size(), IK.cards().size()], go.bind("book"))
	t2.position = Vector2(sw - t2.size.x + 4, shh - 158)
	t2.rotation = -0.03
	layer.add_child(t2)
	return page


func _comma(n: int) -> String:
	var s := str(n)
	var out := ""
	for i in s.length():
		if i > 0 and (s.length() - i) % 3 == 0:
			out += ","
		out += s[i]
	return out


## 左の列の 1 つ：丸い顔（白い縁と紺の輪郭）・傾いた帯・数の札
func _round_entry(face: Texture2D, bg: Color, label: String, band: Color, badge: String, cb: Callable, icon_name := "") -> Control:
	var w := Control.new()
	w.custom_minimum_size = Vector2(124, 94)
	w.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var c := UI.box({c = [bg], radius = 999.0, border = 4.0, border_color = Color.WHITE, outline = 2.5, shadow = Vector2(0, 4), pad = Vector4(4, 4, 4, 4)})
	c.position = Vector2(27, 2)
	c.size = Vector2(70, 70)
	if face:
		c.add_child(UI.mask(_img(face, true), 999.0))
	elif icon_name != "":
		c.add_child(_centered(UI.icon(icon_name, 32, INK)))
	c.press(cb)
	w.add_child(c)
	var b := UI.box({c = [band], radius = 6.0, border = 2.0, border_color = Color.WHITE, outline = 1.5, shadow = Vector2(0, 2), pad = Vector4(7, 1, 7, 2)})
	b.add_child(UI.label(label, 12, Color.WHITE if band != LEAF else INK, "title"))
	b.size = b.get_combined_minimum_size()
	b.position = Vector2(62 - b.size.x / 2.0, 64)
	b.pivot_offset = b.size / 2.0
	b.rotation = -0.06
	w.add_child(b)
	if badge != "":
		w.add_child(_badge(badge, Vector2(82, -2)))
	return w


## チケット（ゲームの .ikh-ticket）：左に題とバーコード、点線、右に絵と札
func _ticket(a: String, bb: String, img: Texture2D, caption: String, cb: Callable) -> Control:
	var t := UI.box({c = [PAPER], radius = 8.0, border = 3.0, shadow = Vector2(0, 5), pad = Vector4(10, 7, 7, 7)})
	var h := UI.hbox(8)
	var lv := UI.vbox(-3)
	lv.custom_minimum_size.x = 70
	lv.add_child(UI.label(a, 19, INK, "title"))
	lv.add_child(UI.label(bb, 14, INK, "title"))
	var bar := Barcode.new()
	bar.custom_minimum_size = Vector2(62, 12)
	lv.add_child(bar)
	h.add_child(lv)
	var dash := Dashes.new()
	dash.custom_minimum_size = Vector2(4, 60)
	h.add_child(dash)
	var r := Control.new()
	r.custom_minimum_size = Vector2(108, 62)
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var ib := UI.box({c = [Color("#a9c49a")], radius = 6.0, border = 0.0, shadow = Vector2.ZERO, pad = Vector4.ZERO})
	ib.size = Vector2(108, 62)
	ib.add_child(UI.mask(_img(img, true), 6.0))
	r.add_child(ib)
	var cap := UI.box({c = [PAPER], radius = 6.0, border = 2.0, shadow = Vector2.ZERO, pad = Vector4(6, 0, 6, 1)})
	cap.add_child(UI.label(caption, 11, INK, "black"))
	cap.size = cap.get_combined_minimum_size()
	cap.position = Vector2(104 - cap.size.x, 62 - cap.size.y + 2)
	r.add_child(cap)
	h.add_child(r)
	t.add_child(h)
	t.size = t.get_combined_minimum_size()
	t.pivot_offset = t.size / 2.0
	t.press(cb)
	return t


func _howto() -> void:
	var v := UI.vbox(8)
	v.add_child(UI.label("遊びかた", 24, INK, "title"))
	for line in ["① ガチャでカードを集める（何度でも引ける）。同じカードの 2〜5 枚目は覚醒が上がる。",
			"② 編成で、育てる馬 1 枚とサポート 4 枚を選ぶ。",
			"③ 育成は 2 歳 7 月〜3 歳 12 月。練習 3 回とレース 1 戦を 10 回くり返す。サポートが来ている練習は伸びが大きく、得意の練習なら友情。",
			"④ 育て上げた完成馬で、ランク戦・完成馬どうしの対戦・イベント（凱旋門賞 1999）に挑む。",
			"レースはゲーム本体と同じ計算で走り、Godot の競馬場で観戦できる。"]:
		v.add_child(_wrap(line, 15, 640))
	var w: Control
	var cb := UI.button("閉じる", func() -> void: close_modal(w), "primary")
	cb.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	v.add_child(cb)
	w = modal(v, 700)


func _pick_favorite() -> void:
	var own := IK.owned(p)
	if own.is_empty():
		toast("まだカードが無い。ガチャで引こう")
		return
	var v := UI.vbox(10)
	v.add_child(UI.label("ホームに立たせる馬", 22, INK, "title"))
	var g := _grid(7)
	var w: Control
	for c in own:
		g.add_child(_tile(c, c.name, c.rar, func() -> void:
			p.fav = c.id
			save()
			close_modal(w)
			render(false)))
	var sc := ScrollContainer.new()
	sc.custom_minimum_size = Vector2(820, minf(460.0, size.y - 160))
	sc.add_child(g)
	v.add_child(sc)
	w = modal(v, 860)


# ------------------------------------------------------------------ ガチャ

func _gacha() -> Control:
	var page := UI.vbox(18)
	var got: Array = opts.get("got", [])
	if got.is_empty():
		page.add_child(_gacha_banner())
	var v := UI.vbox(12)
	if not got.is_empty():
		var cc := CenterContainer.new()
		cc.add_child(_reveal(got, opts.get("reveal", false)))
		v.add_child(cc)
	var btns := UI.hbox(16, BoxContainer.ALIGNMENT_CENTER)
	var b1 := UI.button("1回引く", func() -> void: _do_pull(1), "primary", 15)
	b1.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	btns.add_child(b1)
	var b10 := UI.button("10 回引く", func() -> void: _do_pull(10), "primary", 21)
	b10.pad = Vector4(28, 11, 28, 13)
	btns.add_child(b10)
	v.add_child(btns)
	var rates: Dictionary = IK.data().rates
	v.add_child(UI.label("排出率 " + "・".join(IK.RARITIES.map(func(r): return "%s %d%%" % [r, roundi(float(rates[r]) * 100)])) + "　通算 %d 回" % int(p.pulls), 12, Color("#4a5b58")))
	page.add_child(UI.section("ガチャ" if got.is_empty() else "ガチャの結果（カードを押すと大きく見る）", v))
	if not got.is_empty():
		page.add_child(_gacha_banner())
	return page


## ガチャのバナー（ゲームの gachaBanner）：PICK UP の背景と切り抜き、題、LM の顔の列、収録数
func _gacha_banner() -> Control:
	var pick := ["P4-01", "P4-07", "P4-04"]
	var lay := Control.new()
	lay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	lay.custom_minimum_size.y = 380
	var bg := _img(_bg_tex(pick[0]), true)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	lay.add_child(bg)
	lay.add_child(_shade(0.92, 0.0))
	# 切り抜きを右に重ねる（奥から手前へ）
	var w0 := W()
	var places := [[0.43, 18.0, 0.92, "P4-07"], [0.67, 60.0, 0.86, "P4-04"], [0.53, 96.0, 1.0, "P4-01"]]
	for pl in places:
		var st := _img(_sticker_tex(pl[3]))
		var hh: float = 380.0 * pl[2]
		st.size = Vector2(hh * 1.25, hh)
		st.position = Vector2(w0 * pl[0], pl[1])
		lay.add_child(st)
	var v := UI.vbox(5)
	v.position = Vector2(20, 14)
	var chip := UI.box({c = [LEAF], radius = 6.0, border = 0.0, shadow = Vector2.ZERO, pad = Vector4(8, 1, 8, 2)})
	chip.add_child(UI.label("GACHA", 13, INK, "title"))
	chip.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	chip.rotation = -0.04
	v.add_child(chip)
	v.add_child(UI.label("WINNING ROAD", 10, LEAF2, "black"))
	v.add_child(UI.outlined("名馬ガチャ", 50, Color("#fff4dc"), "title", Color("#0d2a2e"), 6))
	v.add_child(UI.outlined("NEW 第4弾【女傑たちの凱歌】牡馬を破った名牝 40 頭", 15, Color.WHITE, "black", Color("#0d2a2e"), 4))
	var pu := UI.box({c = [Color(1, 1, 1, 0.14)], radius = 999.0, border = 1.5, border_color = Color(1, 1, 1, 0.5), shadow = Vector2.ZERO, pad = Vector4(4, 3, 12, 3)})
	var puh := UI.hbox(6)
	var tag := UI.box({c = [Color("#ff7ea6"), Color("#ffd36a"), Color("#7fe0ff")], angle = 90.0, radius = 999.0, border = 0.0, shadow = Vector2.ZERO, pad = Vector4(6, 0, 6, 1)})
	tag.add_child(UI.label("PICK UP", 10, INK, "title"))
	puh.add_child(tag)
	puh.add_child(UI.label("・".join(pick.map(func(id): return IK.card(id).name)), 13, Color.WHITE, "black"))
	pu.add_child(puh)
	pu.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	v.add_child(pu)
	# 顔の列は新しい弾の LM だけ（全弾の LM 30 種は 3 段にあふれて馬の絵に重なった）
	var new_pack: String = IK.card(pick[0]).pack
	var lms := IK.cards().filter(func(c): return c.rar == "LM" and c.pack == new_pack)
	var faces := HFlowContainer.new()
	faces.add_theme_constant_override("h_separation", 4)
	faces.add_theme_constant_override("v_separation", 4)
	faces.custom_minimum_size.x = minf(540.0, w0 * 0.52)
	faces.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var lml := UI.label("第%s弾 LM %d 種" % [new_pack.substr(1), lms.size()], 11, LEAF2, "black")
	lml.custom_minimum_size.y = 30
	lml.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	faces.add_child(lml)
	for c in lms:
		var have := IK.count_of(p, c.id) > 0
		var f := UI.box({c = [Color("#3e6a3c")], radius = 999.0, border = 2.0, border_color = Color(1, 1, 1, 0.85), shadow = Vector2.ZERO, pad = Vector4(2, 2, 2, 2)})
		f.custom_minimum_size = Vector2(30, 30)
		if have:
			f.add_child(UI.mask(_img(_face_tex(c.id), true), 999.0))
		faces.add_child(f)
	v.add_child(faces)
	v.add_child(UI.label("全 %d 種・所持 %d 種　LM 2%%・SSR 6%%" % [IK.cards().filter(func(c): return IK.in_packs(c)).size(), IK.owned(p).size()], 11, Color("#e8f0d0"), "black"))
	lay.add_child(v)
	return _framed(lay)


## 写真の左を紺で沈める（文字を読ませる）
func _shade(a0: float, a1: float) -> TextureRect:
	var shade := TextureRect.new()
	var gt := GradientTexture2D.new()
	var gr := Gradient.new()
	gr.set_color(0, Color(INK, a0))
	gr.set_color(1, Color(INK, a1))
	gr.add_point(0.42, Color(INK, lerpf(a0, a1, 0.35)))
	gt.gradient = gr
	gt.fill_to = Vector2(1, 0)
	shade.texture = gt
	shade.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	shade.set_anchors_preset(Control.PRESET_FULL_RECT)
	shade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return shade


## 絵を敷く枠：角の丸い紺の箱で中身を切り抜き、縁を上に重ねる
func _framed(lay: Control) -> Control:
	var wrap := Control.new()
	wrap.custom_minimum_size = lay.custom_minimum_size
	wrap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	# clip_children で切ると親の箱が黒く潰れた。写真と影は窓のシェーダで丸く切り、ほかは矩形で切る
	var outer := UI.box({c = [INK], radius = 18.0, border = 0.0, shadow = Vector2(0, 7), pad = Vector4.ZERO})
	outer.set_anchors_preset(Control.PRESET_FULL_RECT)
	lay.clip_contents = true
	for ch in lay.get_children():
		if ch is TextureRect and ch.get_anchor(SIDE_RIGHT) == 1.0:
			UI.mask(ch, 18.0)
	outer.add_child(lay)
	wrap.add_child(outer)
	var rim := UI.box({c = [Color(0, 0, 0, 0)], radius = 18.0, border = 3.0, shadow = Vector2.ZERO, pad = Vector4.ZERO})
	rim.set_anchors_preset(Control.PRESET_FULL_RECT)
	wrap.add_child(rim)
	return wrap


func _do_pull(n: int) -> void:
	var got := IK.pull(p, n)
	save()
	go("gacha", {got = got, reveal = true, k = p.pulls})


## 伏せて配り、順にめくる。いちばん良い 1 枚（SR 以上）は最後に溜めて光らせてからめくる（ゲームの pulledGrid と同じ筋）。
## 押すと全部めくる。めくりは表裏の 1 枚を scale.x で回す（すり替えない）。
func _reveal(got: Array, animate: bool) -> Control:
	var n := got.size()
	var cols := 5 if n > 1 else 1
	var w := minf(150.0, (W() - 140.0) / 5.0) if n > 1 else 230.0
	var g := _grid(cols, 18, 18)
	var best := -1
	for i in n:
		var r: int = IK.RARITIES.find(got[i].card.rar)
		if r <= 2 and (best < 0 or r < IK.RARITIES.find(got[best].card.rar)):
			best = i
	var cells := []
	for i in n:
		var c: Dictionary = got[i].card
		var cell := Control.new()
		cell.custom_minimum_size = Vector2(w, w * 880.0 / 630.0 + 4)
		cell.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var front := _card_view(c, w, true, _show_card.bind(c))
		cell.add_child(front)
		var back := CardBack.new()
		back.custom_minimum_size = front.custom_minimum_size
		back.size = front.custom_minimum_size
		cell.add_child(back)
		var tagtext := "NEW" if got[i].isNew else ("覚醒%d" % int(got[i].awaken) if int(got[i].awaken) > 0 else "")
		var tag: Control = Control.new()
		if tagtext != "":
			tag = _badge(tagtext, Vector2(w - 40, -8))
		cell.add_child(tag)
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
		if not skip[0]:
			await _follow(x.cell)
		if i == best and not skip[0]:
			x.back.charge = RAR_COL[x.c.rar]
			var tw0: Tween = x.back.create_tween()
			tw0.tween_property(x.back, "glow", 1.0, 0.7)
			await tw0.finished
		await _flip(x, 0.0 if skip[0] else 0.12)
		if not skip[0]:
			await get_tree().create_timer(0.08 if i != best else 0.0).timeout


## めくるカードへ本文を寄せる（ゲームの follow）。スクロールの窓に収まっていなければ、真ん中へ Tween で寄せてからめくる。収まっていれば動かさない
func _follow(cell: Control) -> void:
	var sc: ScrollContainer = null
	var n: Node = cell.get_parent()
	while n != null:
		if n is ScrollContainer:
			sc = n
			break
		n = n.get_parent()
	if sc == null or not is_instance_valid(cell):
		return
	var top := cell.global_position.y - sc.global_position.y
	var bottom := top + cell.size.y
	var view := sc.size.y - 116.0   # 下のボタン列の高さぶんは見えない
	if top >= 0.0 and bottom <= view:
		return
	var target := int(sc.scroll_vertical + top + cell.size.y / 2.0 - view / 2.0)
	var tw := sc.create_tween().set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tw.tween_property(sc, "scroll_vertical", maxi(0, target), 0.26)
	await tw.finished


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
	var page := UI.vbox(18)
	# かけら
	var spare := IK.spare_value(p)
	var nspare := 0
	for c in IK.cards():
		nspare += IK.spare_of(p, c.id)
	var sh := UI.hbox(16)
	var gemrow := UI.hbox(8)
	var gem := Gem.new()
	gem.custom_minimum_size = Vector2(22, 22)
	gem.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	gemrow.add_child(gem)
	gemrow.add_child(UI.label(str(int(p.get("shards", 0))), 28, INK, "title"))
	var gl := UI.label("かけら", 12, Color("#5f706c"))
	gl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	gemrow.add_child(gl)
	sh.add_child(gemrow)
	var tx := UI.vbox(2)
	tx.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tx.add_child(UI.label("覚醒 MAX を超えた余りが %d 枚ある（替えると +%d）。" % [nspare, spare] if nspare > 0 else "余りのカードは無い（6 枚目から余りになる）。", 14, INK))
	tx.add_child(_wrap("余り 1 枚 → LM 60・SSR 20・SR 6・R 2・N 1　／　交換 1 枚 → LM 600・SSR 200・SR 60・R 20・N 10。カードを押すと交換できる（図鑑の持っていないカードも）。", 11, 480, Color("#5f706c")))
	sh.add_child(tx)
	var sb := UI.button("余りをまとめて替える（+%d）" % spare if spare > 0 else "余りなし", func() -> void:
		var got := IK.shard_spare(p)
		save()
		toast("かけら +%d" % got)
		render(false), "primary" if spare > 0 else "off", 15)
	sb.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	sh.add_child(sb)
	page.add_child(UI.section("かけら", sh))
	# 所持カード（絞り込み・並べ替え）
	var own := IK.owned(p)
	var total := 0
	for c in own:
		total += IK.count_of(p, c.id)
	var v := UI.vbox(10)
	v.add_child(_filters())
	var g := _grid(_cols(W() - 30, 120), 6, 14)
	for c in _filtered(own):
		g.add_child(_tile(c, c.name, "%s・%s　%d" % ["芝" if c.turf >= c.dirt else "ダ", c.distCat, int(c.power)], _show_card.bind(c), {count = IK.count_of(p, c.id)}))
	if own.is_empty():
		v.add_child(UI.label("まだカードが無い。ガチャで集めよう。", 16, INK, "black"))
	v.add_child(g)
	page.add_child(UI.section("所持カード（%d 種・%d 枚）" % [own.size(), total], v))
	return page


func _filters() -> Control:
	var v := UI.vbox(8)
	var packs: Dictionary = IK.data().packNames
	var r1 := UI.hbox(8)
	r1.add_child(UI.chip("全弾", book_opt.pack == "", func() -> void: _set_opt("pack", "")))
	for k in packs:
		r1.add_child(UI.chip("第%s弾" % k.substr(1) if k != "EV" else "イベント", book_opt.pack == k, func() -> void: _set_opt("pack", k)))
	v.add_child(r1)
	var r2 := UI.hbox(8)
	r2.add_child(UI.chip("全レア", book_opt.rar == "", func() -> void: _set_opt("rar", "")))
	for r in IK.RARITIES:
		r2.add_child(UI.chip(r, book_opt.rar == r, func() -> void: _set_opt("rar", r)))
	v.add_child(r2)
	var r3 := UI.hbox(8)
	for it in [["rar", "レア度順"], ["power", "カードパワー順"], ["count", "枚数順"], ["no", "番号順"]]:
		r3.add_child(UI.chip(it[1], book_opt.sort == it[0], func() -> void: _set_opt("sort", it[0])))
	v.add_child(r3)
	return v


func _set_opt(k: String, v: String) -> void:
	book_opt[k] = v
	render(false)


func _filtered(list: Array) -> Array:
	var out := list.filter(func(c): return (book_opt.pack == "" or c.pack == book_opt.pack) and (book_opt.rar == "" or c.rar == book_opt.rar))
	match book_opt.sort:
		"power": out.sort_custom(func(a, b): return int(a.power) > int(b.power))
		"count": out.sort_custom(func(a, b): return IK.count_of(p, a.id) > IK.count_of(p, b.id))
		"no": out.sort_custom(func(a, b): return String(a.id) < String(b.id))
	return out


func _book() -> Control:
	var page := UI.vbox(18)
	var v := UI.vbox(10)
	v.add_child(_filters())
	var have := 0
	for c in IK.cards():
		if IK.count_of(p, c.id) > 0:
			have += 1
	var g := _grid(_cols(W() - 30, 120), 6, 14)
	for c in _filtered(IK.cards()):
		var n := IK.count_of(p, c.id)
		g.add_child(_tile(c, c.name if n > 0 else "？？？", "No.%02d　%s" % [int(c.no), c.rar], _show_card.bind(c), {dim = n == 0, count = n}))
	v.add_child(g)
	page.add_child(UI.section("カード図鑑（収集 %d/%d）" % [have, IK.cards().size()], v))
	return page


func _show_card(c: Dictionary) -> void:
	var n := IK.count_of(p, c.id)
	var row := UI.hbox(24)
	row.add_child(_card_view(c, 320))
	var info := UI.vbox(7)
	info.custom_minimum_size.x = 460
	var hd := UI.hbox(8)
	hd.add_child(_rar_badge(c.rar, 14))
	hd.add_child(UI.label(c.epithetText, 14, Color("#5d7a10"), "black"))
	info.add_child(hd)
	info.add_child(UI.label(c.name if n > 0 else "？？？（未所持）", 32, INK, "title"))
	var aw := IK.awaken_of(n)
	info.add_child(UI.label("所持 %d 枚　覚醒 %s　%s・%s（%dm）・%s　カードパワー %d" % [n, "◆".repeat(aw) + "◇".repeat(4 - aw), IK.surf_of(c), c.distCat, int(c.dist), IK.style_name(float(c.style)), int(c.power)], 13, Color("#4a5b58")))
	var sk := IK.skills_of(c, aw)
	var sv := UI.vbox(6)
	if sk.unique != null:
		sv.add_child(_skill_row("固有", sk.unique.name, sk.unique.desc, SUN))
	for id in sk.race:
		var si := IK.skill_info(id)
		sv.add_child(_skill_row("レース", si.name, si.desc, Color("#9cc8f0")))
	for id in sk.support:
		var si := IK.skill_info(id)
		sv.add_child(_skill_row("サポート", si.name, si.desc, LEAF2))
	info.add_child(sv)
	var cg := IK.clean_gear(c.get("gear"))
	if not cg.is_empty():
		info.add_child(UI.label("実際の馬具　" + "・".join(IK.gear_names(cg)), 13, INK, "black"))
	var acts := UI.hbox(8)
	var w: Control
	if IK.spare_of(p, c.id) > 0:
		acts.add_child(UI.button("余り %d 枚をかけらに" % IK.spare_of(p, c.id), func() -> void:
			IK.shard_spare(p, c.id)
			save()
			close_modal(w)
			render(false), "paper", 14))
	var why := IK.can_buy_with_shards(p, c.id)
	acts.add_child(UI.button("かけら %d で交換" % int(IK.data().shardCost[c.rar]) if why == "" else why, func() -> void:
		IK.buy_with_shards(p, c.id)
		save()
		close_modal(w)
		toast("%s を交換した" % c.name)
		render(false), "primary" if why == "" else "off", 14))
	if n > 0:
		acts.add_child(UI.button("ホームに飾る", func() -> void:
			p.fav = c.id
			save()
			close_modal(w)
			toast("ホームの馬を %s にした" % c.name)
			render(false), "sun", 14))
	info.add_child(acts)
	row.add_child(info)
	w = modal(row, 840)


func _skill_row(kind: String, name: String, desc: String, col: Color) -> Control:
	var h := UI.hbox(8)
	var k := UI.box({c = [col], radius = 6.0, border = 2.0, shadow = Vector2.ZERO, pad = Vector4(6, 0, 6, 1)})
	var kl := UI.label(kind, 11, INK, "black")
	kl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	k.add_child(kl)
	k.custom_minimum_size.x = 62
	k.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	h.add_child(k)
	var v := UI.vbox(0)
	v.add_child(UI.label(name, 15, INK, "black"))
	v.add_child(_wrap(desc, 12, 360, Color("#4a5b58")))
	h.add_child(v)
	return h


func _wrap(text: String, size := 14, w := 420.0, col := Color("#33504f")) -> Label:
	var l := UI.label(text, size, col)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.custom_minimum_size.x = w
	return l


# ------------------------------------------------------------------ 編成

func _deck() -> Control:
	var page := UI.vbox(18)
	if p.run != null:
		var v0 := UI.vbox(10)
		v0.add_child(UI.label("育成の途中は組み直せない（%s を育成中）。" % IK.trainee_card(p.run).name, 15, INK, "black"))
		var b := UI.button("育成へ", go.bind("train"), "primary")
		b.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		v0.add_child(b)
		page.add_child(UI.section("編成", v0))
		return page
	var own := IK.owned(p)
	var males := own.filter(func(c): return c.sex == "牡").size()
	var females := own.filter(func(c): return c.sex == "牝").size()
	if own.size() < 2 + IK.SUPPORT_SLOTS or males == 0 or females == 0:
		var v1 := UI.vbox(10)
		v1.add_child(UI.label("育成には父（牡のカード）・母（牝のカード）とサポート %d 枚の、あわせて %d 種のカードが要る（いま %d 種・牡 %d・牝 %d）。" % [IK.SUPPORT_SLOTS, 2 + IK.SUPPORT_SLOTS, own.size(), males, females], 15, INK, "black"))
		var gb := UI.button("ガチャへ", go.bind("gacha"), "primary")
		gb.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		v1.add_child(gb)
		page.add_child(UI.section("編成", v1))
		return page
	var sire = opts.get("f")
	var dam = opts.get("m")
	var sup: Array = opts.get("s", [])
	var v := UI.vbox(10)
	var slots := UI.hbox(12, BoxContainer.ALIGNMENT_CENTER)
	var names := ["父（牡）", "母（牝）", "サポート 1", "サポート 2", "サポート 3", "サポート 4"]
	var ids := [sire, dam] + sup
	for i in 6:
		if i == 1:
			var x := UI.label("×", 28, Color("#4a5b58"), "title")
			x.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			slots.add_child(x)
		var sv := UI.vbox(4)
		var l := UI.label(names[i], 12, Color("#3d6fb0") if i == 0 else (Color("#c0517a") if i == 1 else Color("#4a5b58")), "black")
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		sv.add_child(l)
		var id = ids[i] if i < ids.size() else null
		if id != null:
			sv.add_child(_card_view(IK.card(id), 118, false, func() -> void: _deck_toggle(id)))
		else:
			var e := Dashed.new()
			e.custom_minimum_size = Vector2(118, 165)
			sv.add_child(e)
		slots.add_child(sv)
	v.add_child(slots)
	var pv = IK.breed_preview(p, sire, dam, opts.get("st")) if sire != null and dam != null else null
	if pv != null:
		opts.st = pv.style
		if String(opts.get("n", "")).is_empty():
			opts.n = IK.foal_name_idea(IK.card(sire), IK.card(dam))
		v.add_child(_breed_panel(pv))
	else:
		v.add_child(UI.label("牡のカードを押すと父、牝のカードを押すと母に入る。両親が決まると、生まれる仔の名前と脚質を決められる。続けてサポートを 4 枚選ぶ。選んだカードをもう一度押すと外れる。", 12, Color("#4a5b58")))
	v.add_child(UI.label("サポートと友情練習を 2 回すると（覚醒 3 なら 1 回）、そのサポートのレーススキルを覚える（完成馬に残る）。同じカードを重ねて持つと覚醒して強くなる（育成馬の覚醒は両親の平均）。", 12, Color("#4a5b58")))
	var bh := UI.hbox(14, BoxContainer.ALIGNMENT_CENTER)
	var ok: bool = pv != null and sup.size() == IK.SUPPORT_SLOTS
	var sb := UI.button("育成を始める", func() -> void:
		if not ok:
			return
		var err := IK.start_run(p, {sire = sire, dam = dam, name = opts.get("n", ""), style = opts.get("st")}, sup)
		if err != "":
			toast(err)
			return
		save()
		go("train"), "primary" if ok else "off", 20)
	sb.pad = Vector4(30, 10, 30, 12)
	bh.add_child(sb)
	var om := UI.button("おまかせ", _omakase, "paper", 15)
	om.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	bh.add_child(om)
	v.add_child(bh)
	page.add_child(UI.section("編成（父 × 母の配合で育成馬を作る＋サポート %d 枚）" % IK.SUPPORT_SLOTS, v))
	# 片親だけ決まっているあいだは相方の性のカードだけ（父を決めたら牝、母を決めたら牡）。絞り込みはレア度・馬場・距離・脚質・スキル
	var want := "牝" if sire != null and dam == null else ("牡" if dam != null and sire == null else "")
	var pool := own.filter(func(c): return want == "" or c.sex == want)
	var shown := pool.filter(_deck_pass)
	var gv := UI.vbox(10)
	gv.add_child(_deck_filter(own, "%d / %d 種" % [shown.size(), pool.size()]))
	var g := _grid(_cols(W() - 30, 120), 6, 14)
	for c in shown:
		var badge := "父" if sire == c.id else ("母" if dam == c.id else ("サ" if sup.has(c.id) else ""))
		g.add_child(_tile(c, c.name, "%s %d　%s・%s・%s" % [c.rar, int(c.power), c.sex, "芝" if c.turf >= c.dirt else "ダ", c.distCat], _deck_toggle.bind(c.id),
			{badge = badge, sel = badge != ""}))
	gv.add_child(g if not shown.is_empty() else UI.label("この条件のカードは持っていない。", 13, Color("#4a5b58"), "black"))
	page.add_child(UI.section("持っているカード" + ("（%sのカードだけ）" % ("母にする牝" if want == "牝" else "父にする牡") if want != "" else ""), gv))
	return page


## 編成の絞り込み（ゲームの filterBar と同じ条件）。条件は deck_f に覚え、編成（opts）はそのまま描き直す
func _card_skill_ids(c: Dictionary) -> Array:
	var sk: Dictionary = IK.skills_of(c, IK.awaken_of(IK.count_of(p, c.id)))
	var out: Array = sk.race + sk.support
	if sk.get("unique") != null:
		out.append("uniq")
	return out


func _deck_pass(c: Dictionary) -> bool:
	var f := deck_f
	var st: String = IK.STYLE_NAMES[mini(3, int(floor(float(c.style) / 0.25)))]
	return (f.rar == "" or c.rar == f.rar) and (f.surf == "" or ("芝" if c.turf >= c.dirt else "ダート") == f.surf) \
		and (f.dist == "" or c.distCat == f.dist) and (f.style == "" or st == f.style) and (f.skill == "" or _card_skill_ids(c).has(f.skill))


func _deck_filter(own: Array, count: String) -> Control:
	var v := UI.vbox(6)
	var setf := func(k: String, val: String) -> void:
		deck_f[k] = val
		render(false)
	var row := func(label: String, key: String, items: Array) -> void:
		var r := HFlowContainer.new()
		r.add_theme_constant_override("h_separation", 6)
		r.add_theme_constant_override("v_separation", 6)
		var l := UI.label(label, 12, Color("#4a5b58"), "black")
		l.custom_minimum_size.x = 52
		l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		r.add_child(l)
		r.add_child(UI.chip("すべて", deck_f[key] == "", setf.bind(key, "")))
		for it in items:
			r.add_child(UI.chip(it[1], deck_f[key] == it[0], setf.bind(key, it[0])))
		v.add_child(r)
	row.call("レア度", "rar", ["LM", "SSR", "SR", "R", "N"].map(func(x): return [x, x]))
	row.call("馬場", "surf", [["芝", "芝"], ["ダート", "ダート"]])
	row.call("距離", "dist", ["短距離", "マイル", "中距離", "長距離"].map(func(x): return [x, x]))
	row.call("脚質", "style", IK.STYLE_NAMES.map(func(x): return [x, x]))
	# スキルは持っているカードに付いているものだけ（固有・レース・サポートの順）
	var ids := {}
	for c in own:
		for id in _card_skill_ids(c):
			ids[id] = true
	var sk := []
	if ids.has("uniq"):
		sk.append(["uniq", "固有（LM）"])
	for t in ["race", "support"]:
		for id in ids:
			if id != "uniq":
				var info := IK.skill_info(id)
				if info.get("type") == t:
					sk.append([id, info.name])
	row.call("スキル", "skill", sk)
	var foot := UI.hbox(10)
	foot.add_child(UI.label(count, 12, Color("#4a5b58"), "black"))
	if deck_f.values().any(func(x): return x != ""):
		foot.add_child(UI.chip("条件を外す", false, func() -> void:
			for k in deck_f:
				deck_f[k] = ""
			render(false)))
	v.add_child(foot)
	return v


## 生まれる仔：名前（自分で決める）・脚質（両親のあいだから選ぶ）・伸びしろ・初期値・適性・受け継ぐスキル
func _breed_panel(pv: Dictionary) -> Control:
	var c: Dictionary = pv.card
	var bx := UI.box({c = [Color("#fffdf4")], radius = 12.0, border = 2.0, shadow = Vector2.ZERO, pad = Vector4(14, 10, 14, 10)})
	var v := UI.vbox(8)
	var hh := UI.hbox(10)
	hh.add_child(UI.label("生まれる仔", 17, INK, "title"))
	hh.add_child(UI.label("%s　%s%s" % [c.epithetText, c.rar, "・覚醒%d" % int(pv.awaken) if int(pv.awaken) > 0 else ""], 12, Color("#4a5b58"), "black"))
	v.add_child(hh)
	var row := func(k: String) -> HBoxContainer:
		var r := UI.hbox(8)
		var l := UI.label(k, 12, Color("#4a5b58"), "black")
		l.custom_minimum_size.x = 64
		l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		r.add_child(l)
		v.add_child(r)
		return r
	# 名前：打つたびに画面を作り直すと焦点が外れるので、値だけ覚える
	var r0: HBoxContainer = row.call("名前")
	var le := LineEdit.new()
	le.text = opts.get("n", "")
	le.max_length = IK.NAME_MAX
	le.custom_minimum_size = Vector2(260, 38)
	le.add_theme_font_override("font", UI.font("black"))
	le.add_theme_font_size_override("font_size", 18)
	le.add_theme_color_override("font_color", INK)
	var sbx := StyleBoxFlat.new()
	sbx.bg_color = Color.WHITE
	sbx.border_color = Color("#d6cda9")
	sbx.set_border_width_all(2)
	sbx.set_corner_radius_all(9)
	sbx.content_margin_left = 10
	le.add_theme_stylebox_override("normal", sbx)
	le.add_theme_stylebox_override("focus", sbx)
	le.text_changed.connect(func(t: String) -> void: opts.n = t)
	r0.add_child(le)
	r0.add_child(UI.button("案", func() -> void:
		opts.n = IK.foal_name_idea(IK.card(c.sireId), IK.card(c.damId))
		le.text = opts.n, "paper", 13))
	var r1: HBoxContainer = row.call("脚質")
	for st in IK.STYLE_NAMES:
		var on: bool = st == pv.style
		var can: bool = (pv.styles as Array).has(st)
		var b := UI.button(st, func() -> void:
			if can:
				var o := opts.duplicate()
				o.st = st
				go("deck", o), "primary" if on else ("paper" if can else "off"), 14)
		r1.add_child(b)
	var sire_c = IK.card(c.sireId)
	var dam_c = IK.card(c.damId)
	r1.add_child(UI.label("父 %s × 母 %s" % [IK.style_name(float(sire_c.style)), IK.style_name(float(dam_c.style))], 12, Color("#4a5b58"), "black"))
	var r2: HBoxContainer = row.call("伸びしろ")
	for k in IK.STATS:
		var n := int(c.plus[k])
		r2.add_child(_pill("%s+%d" % [IK.STAT_SHORT[k], n], Color("#ffe08a") if n >= 5 else (Color("#fff0c2") if n == 4 else Color("#f1ecd8"))))
	var r3: HBoxContainer = row.call("初期値")
	for k in IK.STATS:
		r3.add_child(_pill("%s %d" % [IK.STAT_SHORT[k], int(pv.init[k])], Color("#f1ecd8")))
	var r4: HBoxContainer = row.call("適性")
	r4.add_child(UI.label("%s・%s（%d〜%dm）" % [IK.surf_of(c), IK.dist_cat(float(c.dist)), maxi(1000, int(c.dist) - int(c.range)), mini(3600, int(c.dist) + int(c.range))], 14, INK, "black"))
	var r5: HBoxContainer = row.call("受け継ぐ")
	var uc = IK.unique_card_of(c)
	if uc != null:
		r5.add_child(_pill(IK.skills_of(uc).unique.name, Color("#ffe9a8")))
	for id in c.raceSkills:
		r5.add_child(_pill(IK.skill_info(id).name, Color("#dcecff")))
	v.add_child(UI.label("伸びしろは能力ごとに両親の高いほう、初期値は両親の平均。性と毛色は生まれてのお楽しみ。逃げ切り・末脚炸裂は選んだ脚質に合うときだけ受け継ぐ。", 11, Color("#4a5b58")))
	bx.add_child(v)
	return bx


func _deck_toggle(id: String) -> void:
	var o := opts.duplicate()
	var sup: Array = o.get("s", []).duplicate()
	var c = IK.card(id)
	var parents := func() -> void:
		o.erase("n")
		o.erase("st")
	if o.get("f") == id:
		o.erase("f")
		parents.call()
	elif o.get("m") == id:
		o.erase("m")
		parents.call()
	elif sup.has(id):
		sup.erase(id)
	elif c.sex == "牡" and o.get("f") == null:
		o.f = id
		parents.call()
	elif c.sex == "牝" and o.get("m") == null:
		o.m = id
		parents.call()
	elif sup.size() < IK.SUPPORT_SLOTS:
		sup.append(id)
	else:
		toast("サポートは %d 枚まで（外すにはもう一度押す）" % IK.SUPPORT_SLOTS)
		return
	o.s = sup
	go("deck", o)


## おまかせ：カードパワーのいちばん高い牡を父・牝を母に、残りの上から 4 枚をサポートに
func _omakase() -> void:
	var own := IK.owned(p)
	own.sort_custom(func(a, b): return int(a.power) > int(b.power))
	var ms := own.filter(func(c): return c.sex == "牡")
	var fs := own.filter(func(c): return c.sex == "牝")
	if own.size() < 2 + IK.SUPPORT_SLOTS or ms.is_empty() or fs.is_empty():
		toast("牡と牝を含む %d 種のカードがそろっていない。ガチャで引こう" % (2 + IK.SUPPORT_SLOTS))
		return
	var f: String = opts.get("f", ms[0].id)
	var m: String = opts.get("m", fs[0].id)
	var o := opts.duplicate()
	o.f = f
	o.m = m
	o.s = own.filter(func(c): return c.id != f and c.id != m).slice(0, IK.SUPPORT_SLOTS).map(func(c): return c.id)
	go("deck", o)


## 配合で作った育成馬の札（カードの代わり。切り抜き・名前・両親）
func _foal_plate(c: Dictionary) -> Control:
	var bx := UI.box({c = [Color("#fffdf4"), Color("#f4ecd0")], radius = 14.0, border = 3.0, shadow = Vector2(0, 5), pad = Vector4(10, 8, 10, 10)})
	bx.custom_minimum_size.x = 200
	var v := UI.vbox(4)
	var st := _img(_sticker_tex(_aid(c)))
	st.custom_minimum_size = Vector2(180, 150)
	v.add_child(st)
	var nh := UI.hbox(6)
	nh.add_child(_rar_badge(c.rar, 12))
	nh.add_child(UI.label(c.name, 18, INK, "title"))
	v.add_child(nh)
	v.add_child(UI.label("%s・%s・%s" % [c.sex, c.coat, IK.style_name(float(c.style))], 12, Color("#4a5b58"), "black"))
	v.add_child(UI.label("父 %s" % c.sire, 12, Color("#4a5b58"), "black"))
	v.add_child(UI.label("母 %s" % c.dam, 12, Color("#4a5b58"), "black"))
	bx.add_child(v)
	return bx


# ------------------------------------------------------------------ 育成

## 育成の画面。練習（またはレース）を 1 画面に収める（ゲームの trainView と同じ並び）：
## 進み → 馬（小さな切り抜きと体力・気分・戦績・馬具）と能力（5 つを 1 段）→ スキル（1 行。「詳しく」で開く）→ 練習 → 記録（畳む）
func _train() -> Control:
	if p.run == null:
		return _deck()
	var run: Dictionary = p.run
	var c = IK.trainee_card(run)
	var page := UI.vbox(10)
	# 上：時期と進み
	var tb := UI.box({c = [PAPER], radius = 14.0, border = 3.0, shadow = Vector2(0, 5), pad = Vector4(16, 6, 16, 7)})
	var th := UI.hbox(16)
	th.add_child(UI.label(IK.turn_label(run), 19, INK, "title"))
	var pb := Bar.new()
	pb.value = float(int(run.turn)) / IK.TOTAL_TURNS
	pb.cols = [TEAL2, LEAF]
	pb.custom_minimum_size = Vector2(200, 12)
	pb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	pb.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	th.add_child(pb)
	th.add_child(UI.label("%d / %d ターン" % [int(run.turn), IK.TOTAL_TURNS], 12, Color("#4a5b58")))
	tb.add_child(th)
	page.add_child(tb)

	# 馬と能力を 1 段に
	var topr := UI.hbox(10)
	var wb := UI.box({c = [PAPER], radius = 16.0, border = 3.0, shadow = Vector2(0, 5), pad = Vector4(6, 6, 12, 6)})
	wb.custom_minimum_size.x = 470
	var wh := UI.hbox(10)
	var st := _img(_sticker_tex(_aid(c)))
	st.custom_minimum_size = Vector2(120, 92)
	st.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	wh.add_child(st)
	var wm := UI.vbox(3)
	wm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var nh := UI.hbox(6)
	nh.add_child(_rar_badge(c.rar, 11))
	nh.add_child(UI.label(c.name, 17, INK, "title"))
	nh.add_child(UI.label("%s・%s・%s" % [c.sex, c.coat, IK.style_name(float(c.style))], 11, Color("#4a5b58"), "black"))
	wm.add_child(nh)
	var er := UI.hbox(8)
	er.add_child(UI.label("体力", 11, Color("#4a5b58"), "black"))
	var ebar := Bar.new()
	ebar.value = float(int(run.energy)) / 100.0
	ebar.cols = [Color("#f6b25a"), SUN]
	ebar.custom_minimum_size = Vector2(120, 10)
	ebar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	er.add_child(ebar)
	er.add_child(UI.label(str(int(run.energy)), 14, INK, "black"))
	er.add_child(UI.label(IK.data().moods[int(run.mood)], 14, Color("#d6336c"), "black"))
	if IK.aw_t(run) > 0:
		er.add_child(UI.label("◆".repeat(IK.aw_t(run)), 12, Color("#7a4fc0"), "black"))
	wm.add_child(er)
	wm.add_child(UI.label("%d戦%d勝（重賞 %d・GI %d）　ファン %s人" % [int(run.starts), int(run.wins), int(run.gradedWins), int(run.giWins), _comma(int(run.fans))], 11, Color("#3c5552"), "black"))
	wm.add_child(_gear_row(IK.run_gear(run), c.name, (func(g: Dictionary) -> void: IK.set_run_gear(run, g)) if not IK.run_done(run) else Callable()))
	wh.add_child(wm)
	wb.add_child(wh)
	topr.add_child(wb)
	var sb := UI.box({c = [PAPER], radius = 16.0, border = 3.0, shadow = Vector2(0, 5), pad = Vector4(12, 8, 12, 8)})
	sb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var sh := UI.hbox(10)
	sh.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	for k in IK.STATS:
		sh.add_child(_stat_cell(IK.STAT_SHORT[k], int(run.stats[k]), IK.cap_of(int(c.plus[k]), IK.aw_t(run))))
	sb.add_child(sh)
	topr.add_child(sb)
	page.add_child(topr)

	# スキル：1 行（レースで使うスキルと、サポートとの絆）。「詳しく」で説明つきに開く
	var kb := UI.box({c = [PAPER], radius = 12.0, border = 2.5, shadow = Vector2.ZERO, pad = Vector4(10, 4, 6, 4)})
	var kh := UI.hbox(6)
	kh.add_child(UI.label("スキル", 12, Color("#3c5552"), "black"))
	var uc = IK.unique_card_of(c)
	if uc != null:
		kh.add_child(_pill(IK.skills_of(uc).unique.name, Color("#ffe9a8")))
	for id in IK.run_skills(run):
		kh.add_child(_pill(IK.skill_info(id).name, Color("#dcecff")))
	for i in run.supports.size():
		var sc = IK.card(run.supports[i])
		var need := IK.bond_need(run, i)
		var bdone := int(run.bonds[i]) >= need
		var bb := UI.box({c = [Color("#fff2b0") if bdone else Color.WHITE], radius = 7.0, border = 2.0, shadow = Vector2.ZERO, pad = Vector4(6, 0, 6, 1)})
		var bh := UI.hbox(4)
		var nm: String = sc.name
		bh.add_child(UI.label(nm if nm.length() <= 6 else nm.substr(0, 5) + "…", 11, Color(RAR_TEXT[sc.rar]), "black"))
		bh.add_child(UI.label("習得" if bdone else "%d/%d" % [int(run.bonds[i]), need], 11, Color("#d6336c"), "black"))
		bb.add_child(bh)
		kh.add_child(bb)
	var gap := Control.new()
	gap.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	kh.add_child(gap)
	# 「詳しく」は描き直さずに開け閉めする（描き直すと一瞬で伸び縮みした）。切り抜く箱の高さを Tween で 0 ↔ 中身の高さへ
	var mb := UI.box({c = [PAPER], radius = 12.0, border = 2.5, shadow = Vector2.ZERO, pad = Vector4(12, 8, 12, 8)})
	var mv := UI.vbox(5)
	if uc != null:
		mv.add_child(_skill_row("固有", IK.skills_of(uc).unique.name, IK.skills_of(uc).unique.desc, SUN))
	for id in IK.run_skills(run):
		var si := IK.skill_info(id)
		mv.add_child(_skill_row("レース", si.name, si.desc, Color("#9cc8f0")))
	mv.add_child(UI.label("サポートと友情練習を重ねると、そのサポートのレーススキルを覚える（完成馬に残る）。", 12, Color("#4a5b58")))
	mb.add_child(mv)
	var clip := Control.new()
	clip.clip_contents = true
	clip.mouse_filter = Control.MOUSE_FILTER_IGNORE
	clip.add_child(mb)
	var full := mb.get_combined_minimum_size().y + 8.0   # 上の 8 は帯との間（開いたときだけ空ける）
	mb.position = Vector2(0, 8)
	clip.resized.connect(func() -> void: mb.size = Vector2(clip.size.x, full - 8.0))
	var open: bool = opts.get("sk", false)
	clip.custom_minimum_size.y = full if open else 0.0
	mb.modulate.a = 1.0 if open else 0.0
	var skx := UI.chip("閉じる" if open else "詳しく", false, func() -> void: pass, 12)
	skx.pressed.connect(func() -> void:
		opts.sk = not opts.get("sk", false)
		var lb: Label = skx.find_children("*", "Label", true, false)[0]
		lb.text = "閉じる" if opts.sk else "詳しく"
		var tw := clip.create_tween().set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN_OUT).set_parallel()
		tw.tween_property(clip, "custom_minimum_size:y", full if opts.sk else 0.0, 0.34)
		tw.tween_property(mb, "modulate:a", 1.0 if opts.sk else 0.0, 0.26))
	kh.add_child(skx)
	kb.add_child(kh)
	# 帯と開く箱を 1 つの組に（ページの段の間隔が、閉じた箱のぶんまで空かないように）
	var skg := UI.vbox(0)
	skg.add_child(kb)
	skg.add_child(clip)
	page.add_child(skg)

	if IK.run_done(run):
		var dv := UI.vbox(10)
		dv.add_child(UI.label("育成が終わった（%d 戦 %d 勝、うち重賞 %d 勝）" % [int(run.starts), int(run.wins), int(run.gradedWins)], 17, INK, "black"))
		var fb := UI.button("完成馬にする", func() -> void:
			var h := IK.finish_run(p)
			save()
			go("horse", {id = h.id}), "primary", 20)
		fb.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		dv.add_child(fb)
		page.add_child(UI.section("完成", dv))
	elif IK.is_race_turn(run):
		var rv := UI.vbox(8)
		rv.add_child(_style_row(IK.run_race_style(run), IK.style_name_of(float(IK.trainee_card(run).style)), func(x: String) -> void: IK.set_race_style(run, x)))
		for o in IK.race_options(run):
			rv.add_child(_race_tile(o))
		page.add_child(UI.section("レース（%s）" % IK.data().slots[int(run.slot)].label, rv))
	else:
		var tv := UI.vbox(8)
		var row := UI.hbox(8)
		for k in IK.STATS:
			row.add_child(_train_tile(run, k))
		tv.add_child(row)
		var rb := UI.button("休む（体力を戻す）", func() -> void:
			toast(IK.rest(run))
			save()
			render(false), "paper", 15)
		rb.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		tv.add_child(rb)
		page.add_child(UI.section("練習", tv))
	# 最近の出来事（畳んでおく。開くと紺の帯）
	var lg: Array = run.log
	if lg.size() > 0:
		var hc := UI.chip(("記録を閉じる" if opts.get("hist", false) else "これまでの記録（%d 戦）" % int(run.starts)), false, func() -> void:
			opts.hist = not opts.get("hist", false)
			render(false), 12)
		hc.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		page.add_child(hc)
		if opts.get("hist", false):
			var logb := UI.box({c = [INK], radius = 10.0, border = 0.0, shadow = Vector2.ZERO, pad = Vector4(12, 6, 12, 7)})
			var lv := UI.vbox(2)
			for i in range(maxi(0, lg.size() - 6), lg.size()):
				lv.add_child(UI.label(String(lg[i]), 12 if i < lg.size() - 1 else 13, Color("#f6e7b8") if i == lg.size() - 1 else Color("#9fb5ad"), "black"))
			logb.add_child(lv)
			page.add_child(logb)
	return page


## 能力の 1 枡（略称・評価・点・伸びしろの線）。5 つを 1 段に並べる
func _stat_cell(name: String, pts: int, cap: int) -> Control:
	var v := UI.vbox(2)
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	v.add_child(UI.label(name, 11, Color("#3c5552"), "black"))
	var h := UI.hbox(4)
	var g := IK.grade_of_pts(pts)
	var gc := Color("#e0a020") if (g.begins_with("S") or g.begins_with("A") or g.begins_with("B")) else Color("#5d9a22")
	var gl := UI.label(g, 20, gc, "title")
	gl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(gl)
	h.add_child(UI.label(str(pts), 12, Color("#4a5b58")))
	v.add_child(h)
	var bar := Bar.new()
	bar.value = pts / 1200.0
	bar.cap = cap / 1200.0
	bar.cols = [TEAL2, LEAF]
	bar.custom_minimum_size = Vector2(60, 10)
	v.add_child(bar)
	return v


func _kv(k: String, v: String) -> Control:
	var h := UI.hbox(8)
	var l := UI.label(k, 12, Color("#4a5b58"), "black")
	l.custom_minimum_size.x = 38
	h.add_child(l)
	h.add_child(UI.label(v, 14, INK, "black"))
	return h


## 馬具の行（育成中の馬・完成馬）。on_save が空なら変えられない（育成の終わった後）
func _gear_row(gear: Dictionary, name: String, on_save: Callable) -> Control:
	var h := UI.hbox(8)
	var l := UI.label("馬具", 12, Color("#4a5b58"), "black")
	l.custom_minimum_size.x = 38
	h.add_child(l)
	var f := HFlowContainer.new()
	f.add_theme_constant_override("h_separation", 4)
	f.add_theme_constant_override("v_separation", 4)
	f.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var names := IK.gear_names(gear)
	for k in IK.GEAR_KEYS.filter(func(x): return gear.has(x)):
		# 色の付く馬具（メンコ・シャドーロール）は色の点を添える（地を馬具の色にすると黒いメンコで字が読めない）
		var b := UI.box({c = [Color("#eef3e6")], radius = 999.0, border = 2.0, shadow = Vector2.ZERO, pad = Vector4(8, 1, 10, 2)})
		var bh := UI.hbox(4)
		if gear[k] is String:
			var dot := UI.box({c = [Color(String(gear[k]))], radius = 999.0, border = 1.5, shadow = Vector2.ZERO, pad = Vector4(5, 5, 5, 5)})
			dot.custom_minimum_size = Vector2(11, 11)
			dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			bh.add_child(dot)
		bh.add_child(UI.label(IK.GEAR_NAMES[k], 13, INK, "black"))
		b.add_child(bh)
		f.add_child(b)
	if names.is_empty():
		f.add_child(UI.label("なし", 13, Color("#7b8a88"), "black"))
	h.add_child(f)
	if on_save.is_valid():
		var ch := UI.chip("変更", false, _gear_picker.bind(gear, name, on_save), 12)
		ch.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		h.add_child(ch)
	return h


## 馬具を決める。育成モードの馬は気性を持たないので、効き目は気性 0.35 の馬として小さく効く（ikusei.gd の GEAR_TEMPER）
func _gear_picker(gear: Dictionary, name: String, on_save: Callable) -> void:
	var cur := gear.duplicate()
	var v := UI.vbox(8)
	v.custom_minimum_size.x = 520
	v.add_child(UI.label("%sの馬具" % name, 22, INK, "title"))
	v.add_child(UI.label("効き目は小さい（出遅れ・掛かり・追ってからの集中）。付けた馬具はレースの 3D にも出る。", 12, Color("#4a5b58")))
	var wh := [null]  # 閉じる板は modal() が返してから決まる（ラムダは作った時の値を写すので、配列で受け渡す）
	var rows := UI.vbox(8)
	v.add_child(rows)
	var draw := func(self_ref: Callable) -> void:
		for ch in rows.get_children():
			ch.queue_free()
		for k in IK.GEAR_KEYS:
			var on := cur.has(k)
			var colored: bool = k == "menko" or k == "shadowRoll"
			var r := UI.hbox(8)
			r.custom_minimum_size.y = 36
			r.add_child(UI.chip(IK.GEAR_NAMES[k], on, func() -> void:
				if on:
					cur.erase(k)
				else:
					cur[k] = IK.GEAR_COLORS[0] if colored else true
					if k == "blinker":
						cur.erase("cheek")
					if k == "cheek":
						cur.erase("blinker")
				self_ref.call(self_ref), 14))
			if colored and on:
				for col in IK.GEAR_COLORS:
					var sw := UI.box({c = [Color(col)], radius = 999.0, border = 4.0 if cur[k] == col else 2.0, shadow = Vector2.ZERO, pad = Vector4(0, 0, 0, 0)})
					sw.custom_minimum_size = Vector2(28, 28)
					sw.size_flags_vertical = Control.SIZE_SHRINK_CENTER
					sw.press(func() -> void:
						cur[k] = col
						self_ref.call(self_ref))
					r.add_child(sw)
			rows.add_child(r)
	draw.call(draw)
	var acts := UI.hbox(8)
	acts.add_child(UI.button("決める", func() -> void:
		on_save.call(cur)
		save()
		close_modal(wh[0])
		toast("%sの馬具：%s" % [name, "・".join(IK.gear_names(IK.clean_gear(cur))) if not IK.clean_gear(cur).is_empty() else "なし"])
		render(false), "primary", 15))
	acts.add_child(UI.button("やめる", func() -> void: close_modal(wh[0]), "paper", 15))
	v.add_child(acts)
	wh[0] = modal(v, 600)


func _pill(text: String, bg: Color) -> Control:
	var b := UI.box({c = [bg], radius = 999.0, border = 2.0, shadow = Vector2.ZERO, pad = Vector4(10, 1, 10, 2)})
	b.add_child(UI.label(text, 13, INK, "black"))
	return b


func _stat_row(name: String, pts: int, cap: int) -> Control:
	var h := UI.hbox(10)
	var n := UI.label(name, 14, INK, "black")
	n.custom_minimum_size.x = 70
	h.add_child(n)
	var g := IK.grade_of_pts(pts)
	var gc := Color("#e0a020") if (g.begins_with("S") or g.begins_with("A") or g.begins_with("B")) else Color("#5d9a22")
	var gl := UI.label(g, 16, gc, "title")
	gl.custom_minimum_size.x = 34
	h.add_child(gl)
	var pl := UI.label(str(pts), 13, Color("#4a5b58"))
	pl.custom_minimum_size.x = 40
	pl.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	h.add_child(pl)
	var bar := Bar.new()
	bar.value = pts / 1200.0
	bar.cap = cap / 1200.0
	bar.cols = [TEAL2, LEAF]
	bar.custom_minimum_size = Vector2(200, 12)
	bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	h.add_child(bar)
	return h


## 練習の札（ゲームの練習の枠）：伸びる量・来ているサポート・発動するスキル・体力。友情は橙の縁
func _train_tile(run: Dictionary, k: String) -> Control:
	var pv := IK.training_preview(run, k)
	var hot: bool = pv.friendship > 0
	var b := UI.box({c = [Color("#fff6e6"), SUN2] if hot else [Color.WHITE], angle = 180.0, radius = 12.0, border = 3.0, border_color = Color("#e08a2a") if hot else INK,
		shadow = Vector2(0, 4), pad = Vector4(8, 6, 8, 8)})
	b.custom_minimum_size = Vector2(120, 150)
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var v := UI.vbox(3)
	var hh := UI.hbox(4)
	var t := UI.label(IK.STAT_LABEL[k], 17, INK, "black")
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hh.add_child(t)
	if hot:
		var fr := UI.box({c = [Color("#e08a2a")], radius = 6.0, border = 0.0, shadow = Vector2.ZERO, pad = Vector4(5, 0, 5, 1)})
		fr.add_child(UI.label("友情", 11, Color.WHITE, "black"))
		hh.add_child(fr)
	v.add_child(hh)
	var gf := HFlowContainer.new()
	gf.add_theme_constant_override("h_separation", 4)
	gf.add_theme_constant_override("v_separation", 3)
	gf.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for g in pv.gains:
		var gb := UI.box({c = [Color("#eaf3c6")], radius = 4.0, border = 0.0, shadow = Vector2.ZERO, pad = Vector4(4, 0, 4, 1)})
		gb.add_child(UI.label("%s+%d" % [IK.STAT_SHORT[g], int(pv.gains[g])], 12, Color("#3d6a10"), "black"))
		gf.add_child(gb)
	v.add_child(gf)
	for id in pv.supports:
		var sc = IK.card(id)
		v.add_child(UI.label(sc.name, 12, Color(RAR_TEXT[sc.rar]), "black"))
	var sf := HFlowContainer.new()
	sf.add_theme_constant_override("h_separation", 3)
	sf.add_theme_constant_override("v_separation", 3)
	sf.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for s in pv.skills:
		var sb := UI.box({c = [Color("#eefbe6")], radius = 4.0, border = 1.5, border_color = Color("#6fbf57"), shadow = Vector2.ZERO, pad = Vector4(4, 0, 4, 1)})
		sb.add_child(UI.label(s, 10, Color("#2f6a20"), "black"))
		sf.add_child(sb)
	v.add_child(sf)
	var sp := Control.new()
	sp.size_flags_vertical = Control.SIZE_EXPAND_FILL
	sp.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_child(sp)
	if float(pv.fail) > 0:
		v.add_child(UI.label("失敗 %d%%" % roundi(float(pv.fail) * 100), 12, Color("#c0392b"), "black"))
	v.add_child(UI.label("体力+5" if k == "wit" else "体力−%d" % int(pv.cost), 11, Color("#4a5b58")))
	b.add_child(v)
	b.press(func() -> void:
		toast(IK.train(run, k))
		save()
		render(false))
	return b


## レースの脚質の札（ゲームの styleSeg）。base は育てた脚質（「育成」の印）。押すと覚えて描き直す。
func _style_row(cur: String, base: String, pick: Callable) -> Control:
	var v := UI.vbox(4)
	var r := UI.hbox(8)
	var l := UI.label("脚質", 13, INK, "black")
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	r.add_child(l)
	for x in IK.STYLE_NAMES:
		r.add_child(UI.chip(x + ("（育成）" if x == base else ""), x == cur, func() -> void:
			pick.call(x)
			save()
			render(false), 14))
	v.add_child(r)
	v.add_child(UI.label("合わない脚質のスキル（逃げ切り・末脚炸裂）は使わない", 11, Color("#4a5b58")))
	return v


func _race_tile(o: Dictionary) -> Control:
	var gi: bool = o.grade == "GI"
	var b := UI.box({c = [Color("#fff6e6"), SUN2] if gi else [Color.WHITE], angle = 90.0, radius = 12.0, border = 3.0, shadow = Vector2(0, 4), pad = Vector4(14, 8, 14, 9)})
	var h := UI.hbox(12)
	if o.grade != "":
		var g := UI.box({c = [{GI = Color("#2f62c9"), GII = Color("#c0392b"), GIII = Color("#2f8a3a"), OP = TEAL2}.get(o.grade, TEAL2)], radius = 6.0, border = 0.0, shadow = Vector2.ZERO, pad = Vector4(7, 1, 7, 2)})
		g.add_child(UI.label(o.grade, 13, Color.WHITE, "title"))
		g.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		h.add_child(g)
	var nm := UI.label(o.name, 19, INK, "title")
	nm.custom_minimum_size.x = 210
	h.add_child(nm)
	h.add_child(UI.label("%s %s%dm" % [IK.data().courses[o.courseId].name, "芝" if o.surface == "芝" else "ダ", int(o.distance)], 15, INK, "black"))
	h.add_child(_pill("馬場 " + String(o.ground), Color("#e3efd0") if o.ground == "良" else Color("#f6dcc0")))
	var sp := Control.new()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sp.mouse_filter = Control.MOUSE_FILTER_IGNORE
	h.add_child(sp)
	h.add_child(UI.label("相手 " + "★".repeat(clampi(int((float(o.level) - 0.4) / 0.06), 1, 5)), 14, Color("#d9792a"), "black"))
	h.add_child(UI.icon("next", 20, INK))
	b.add_child(h)
	b.press(_race.bind(o.id))
	return b


func _race(choice: String) -> void:
	var r := IK.race_turn(p.run, choice)
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
		skins.append(Skins.for_runner({id = id, cardId = fs.get("cardId"), coat = fs.get("coat", "鹿毛"), gate = int(lg.gates[k]), frame = int(lg.frameNos[k]), gear = fs.get("gear")}))
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
	for c in [sky, body, top, dock, overlay]:
		c.visible = false
	add_child(rc)
	rc.load_race_data(race, skins, mine, cues)
	rc.finished.connect(func() -> void:
		rc.queue_free()
		watching = null
		for c in [sky, body, top, dock, overlay]:
			c.visible = true
		render(false)
		after.call())


func _result(res: Dictionary, mine: Array, fired: Dictionary, title: String, extra: Control = null) -> void:
	var v := UI.vbox(8)
	v.add_child(UI.label(title, 28, INK, "title"))
	v.add_child(UI.label("%s　%s %s%dm　馬場 %s　勝ち時計 %s" % [res.name, res.courseName, "芝" if res.surface == "芝" else "ダ", int(res.distance), res.ground, IK.Sim.format_time(res.winnerTime)], 14, Color("#4a5b58")))
	if extra != null:
		v.add_child(extra)
	var g := _grid(6, 14, 3)
	for h in ["着", "番", "馬名", "タイム", "着差", "発動したスキル"]:
		g.add_child(UI.label(h, 12, Color("#5f706c"), "black"))
	for r in res.results.slice(0, 18):
		var is_mine: bool = mine.has(int(r.horseId))
		var col := Color("#c0641a") if is_mine else INK
		g.add_child(UI.label(str(int(r.order)), 15, col, "title"))
		g.add_child(UI.label(str(int(r.gate)), 13, col))
		g.add_child(UI.label(r.name, 14, col, "black" if is_mine else "body"))
		g.add_child(UI.label(IK.Sim.format_time(r.time), 13, col))
		g.add_child(UI.label(r.margin, 13, col))
		var names: Array = fired.get(int(r.horseId), fired.get(float(r.horseId), []))
		g.add_child(UI.label("・".join(names), 11, Color("#2f6a20")))
	var sc := ScrollContainer.new()
	sc.custom_minimum_size = Vector2(820, minf(g.get_combined_minimum_size().y, size.y - 260))
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	sc.add_child(g)
	v.add_child(sc)
	var w: Control
	var acts := UI.hbox(10)
	acts.add_child(UI.button("もう一度観る", func() -> void:
		close_modal(w)
		_watch(res, mine, fired, _result.bind(res, mine, fired, title, null)), "paper", 15))
	acts.add_child(UI.button("閉じる", func() -> void: close_modal(w), "primary", 15))
	v.add_child(acts)
	w = modal(v, 880)


# ------------------------------------------------------------------ 完成馬

func _finished() -> Control:
	var page := UI.vbox(18)
	var list: Array = p.finished.duplicate()
	list.sort_custom(func(a, b): return int(a.rating) > int(b.rating))
	var g := _grid(_cols(W() - 30, 120), 6, 14)
	for h in list:
		var c = IK.horse_card(h)
		g.add_child(_tile(c, h.name, "%d戦%d勝　%d" % [int(h.starts), int(h.wins), int(h.rating)], go.bind("horse", {id = h.id}), {badge = h.rank}))
	var v := UI.vbox(10)
	if list.is_empty():
		v.add_child(UI.label("まだ完成馬が居ない。編成から育成を始めよう。", 15, INK, "black"))
		var b := UI.button("編成へ", go.bind("deck"), "primary")
		b.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		v.add_child(b)
	v.add_child(g)
	page.add_child(UI.section("完成馬（%d 頭）" % list.size(), v))
	return page


func _horse() -> Control:
	var h = IK.find_finished(p, opts.get("id", -1))
	if h == null:
		return _finished()
	var c = IK.horse_card(h)
	var page := UI.vbox(18)
	page.add_child(_horse_head(h, c))
	var cols := UI.hbox(16)
	var ab := UI.vbox(8)
	for k in IK.STATS:
		ab.add_child(_stat_row(IK.STAT_LABEL[k], int(h.stats[k]), -1))
	ab.add_child(UI.label("%s・%s（%dm）・%s" % ["芝" if h.turf >= h.dirt else "ダート", IK.dist_cat(float(h.dist)), int(h.dist), IK.style_name(float(h.style))], 13, Color("#4a5b58"), "black"))
	var skf := HFlowContainer.new()
	skf.add_theme_constant_override("h_separation", 6)
	skf.add_theme_constant_override("v_separation", 6)
	for id in IK.finished_skills(h):
		skf.add_child(_pill(IK.skill_info(id).get("name", id), Color("#dcecff")))
	ab.add_child(skf)
	ab.add_child(_gear_row(IK.horse_gear(h), String(h.name), func(g: Dictionary) -> void: IK.set_finished_gear(h, g)))
	var acts := UI.hbox(10)
	acts.add_child(UI.button("ランク戦へ", go.bind("battle", {id = h.id}), "primary", 15, "sword"))
	acts.add_child(UI.button("イベントへ", go.bind("event", {id = h.id, ev = IK.data().events.back().id}), "sun", 15, "trophy"))
	ab.add_child(acts)
	var s1 := UI.section("能力", ab)
	s1.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cols.add_child(s1)
	var rv := UI.vbox(5)
	for r in h.races:
		var rh := UI.hbox(8)
		var ord := UI.label("%d着" % int(r.order), 15, Color("#c0641a") if int(r.order) == 1 else INK, "title")
		ord.custom_minimum_size.x = 40
		rh.add_child(ord)
		rh.add_child(UI.label("%s %s　%s%s%dm %s" % [IK.data().slots[int(r.slot)].label, r.name, IK.data().courses[r.courseId].short, "芝" if r.surface == "芝" else "ダ", int(r.distance), r.ground], 13, INK, "black" if int(r.order) == 1 else "body"))
		rv.add_child(rh)
	var s2 := UI.section("育成の成績", rv)
	s2.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cols.add_child(s2)
	page.add_child(cols)
	return page


## 完成馬の見出し：一枚絵の背景に切り抜き、左に名と評価
func _horse_head(h: Dictionary, c: Dictionary) -> Control:
	var lay := Control.new()
	lay.custom_minimum_size.y = 220
	lay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var bg := _img(_bg_tex(_aid(c)), true)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	lay.add_child(bg)
	lay.add_child(_shade(0.9, 0.0))
	var st := _img(_sticker_tex(_aid(c)))
	st.size = Vector2(380, 260)
	st.position = Vector2(W() - 420, -14)
	lay.add_child(st)
	var v := UI.vbox(4)
	v.position = Vector2(22, 18)
	var hh := UI.hbox(8)
	hh.add_child(_rar_badge(h.rar, 14))
	hh.add_child(UI.outlined(c.epithetText, 14, LEAF2, "black", Color("#0d2a2e"), 4))
	v.add_child(hh)
	v.add_child(UI.outlined(h.name, 44, Color("#fff4dc"), "title", Color("#0d2a2e"), 6))
	var rk := UI.hbox(10)
	var rb := UI.box({c = [Color("#ffe27a"), SUN], radius = 10.0, border = 3.0, shadow = Vector2(0, 3), pad = Vector4(12, 2, 12, 4)})
	rb.add_child(UI.label(h.rank, 26, INK, "title"))
	rk.add_child(rb)
	var info := UI.vbox(0)
	info.add_child(UI.outlined("評価点 %d" % int(h.rating), 15, Color.WHITE, "black", Color("#0d2a2e"), 4))
	info.add_child(UI.outlined("%d戦%d勝・重賞 %d 勝・GI %d 勝　対戦 %d戦%d勝" % [int(h.starts), int(h.wins), int(h.gradedWins), int(h.giWins), int(h.battles), int(h.battleWins)], 13, Color("#e8f0d0"), "black", Color("#0d2a2e"), 4))
	rk.add_child(info)
	v.add_child(rk)
	lay.add_child(v)
	return _framed(lay)


# ------------------------------------------------------------------ 対戦

func _battle() -> Control:
	var page := UI.vbox(18)
	page.add_child(_event_carousel())
	if p.finished.is_empty():
		var v0 := UI.vbox(10)
		v0.add_child(UI.label("対戦には完成馬が要る。", 14, INK))
		var b := UI.button("育成へ", func() -> void: go("train" if p.run != null else "deck"), "primary")
		b.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		v0.add_child(b)
		page.add_child(UI.section("対戦", v0))
		return page
	var hid = opts.get("id", p.finished[p.finished.size() - 1].id)
	var race_id: String = opts.get("race", IK.battle_races()[0].id)
	var diff: String = opts.get("diff", "normal")
	var v := UI.vbox(12)
	v.add_child(UI.label("出す馬", 12, Color("#4a5b58"), "black"))
	var hf := HFlowContainer.new()
	hf.add_theme_constant_override("h_separation", 6)
	hf.add_theme_constant_override("v_separation", 10)
	for h in p.finished:
		hf.add_child(_tile(IK.horse_card(h), h.name, "%s %d" % [h.rank, int(h.rating)], go.bind("battle", {id = h.id, race = race_id, diff = diff}), {sel = int(h.id) == int(hid), badge = h.rank}))
	v.add_child(hf)
	v.add_child(UI.label("舞台（GI）", 12, Color("#4a5b58"), "black"))
	var rf := HFlowContainer.new()
	rf.add_theme_constant_override("h_separation", 8)
	rf.add_theme_constant_override("v_separation", 8)
	for r in IK.battle_races():
		rf.add_child(UI.chip("%s　%s%s%dm" % [r.name, IK.data().courses[r.courseId].short, "芝" if r.surface == "芝" else "ダ", int(r.distance)], r.id == race_id,
			go.bind("battle", {id = hid, race = r.id, diff = diff}), 13))
	v.add_child(rf)
	v.add_child(UI.label("相手の強さ", 12, Color("#4a5b58"), "black"))
	var dr := UI.hbox(8)
	var diffs: Dictionary = IK.data().difficulty
	for k in diffs:
		dr.add_child(UI.chip(diffs[k].name, k == diff, go.bind("battle", {id = hid, race = race_id, diff = k}), 14))
	v.add_child(dr)
	var hb = IK.find_finished(p, hid)
	if hb != null:
		v.add_child(_style_row(IK.horse_race_style(hb), IK.style_name_of(float(hb.style)), func(x: String) -> void: IK.set_race_style(hb, x)))
	var row := UI.hbox(12)
	row.add_child(UI.button("ランク戦を走る", func() -> void:
		var r := IK.battle_npc(p, hid, race_id, diff)
		save()
		var h = IK.find_finished(p, hid)
		_watch(r.result, [100], r.fired, _result.bind(r.result, [100], r.fired, "ランク戦　%s %d 着" % [h.name, int(r.order)], null)), "primary", 20, "sword"))
	if p.finished.size() >= 2:
		row.add_child(UI.button("完成馬どうしで走らせる（%d 頭）" % mini(16, p.finished.size()), func() -> void:
			var ids: Array = p.finished.map(func(h): return h.id).slice(0, 16)
			var r := IK.battle_own(p, ids, race_id)
			save()
			var mine := range(ids.size()).map(func(i): return 100 + i)
			_watch(r.result, mine, r.fired, _result.bind(r.result, mine, r.fired, "完成馬どうし　%s" % r.race.name, null)), "paper", 15))
	v.add_child(row)
	page.add_child(UI.section("ランク戦", v))
	return page


# ------------------------------------------------------------------ イベント

## イベントのバナー（ゲームの eventBanner）：報酬のカードの一枚絵と切り抜きに題と進み（★）
## 対戦の画面のイベント（ゲームの eventCarousel）：バナーを横に並べ、ドラッグ・スワイプか矢印・点で 1 枚ずつ送る。新しいイベントが先頭。
## 入力はバナーの上に重ねた透明の板で受ける（バナーの中の箱が押下を止めて、ドラッグが親まで届かない）。動かさずに離したらそのイベントを開く。
func _event_carousel() -> Control:
	var evs: Array = IK.data().events.duplicate()
	evs.reverse()
	# GDScript のラムダは外のローカル変数を値で写すので、書き換える状態は辞書に持つ
	var cur := {i = maxi(0, evs.map(func(e): return e.id).find(ev_slide))}
	var root := Control.new()
	var clip := Control.new()
	clip.clip_contents = true
	clip.set_anchors_preset(Control.PRESET_FULL_RECT)
	clip.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(clip)
	var strip := HBoxContainer.new()
	strip.add_theme_constant_override("separation", 0)
	strip.mouse_filter = Control.MOUSE_FILTER_IGNORE
	clip.add_child(strip)
	var slides := []
	for ev in evs:
		var b := _event_banner(ev, false)
		b.mouse_filter = Control.MOUSE_FILTER_IGNORE
		strip.add_child(b)
		slides.append(b)
	var h: float = slides[0].get_combined_minimum_size().y + 8.0   # 下にずらした影のぶん
	root.custom_minimum_size.y = h
	var dots := UI.hbox(7)
	var arrows := []
	var mark := func(i: int) -> void:
		ev_slide = evs[i].id
		for k in dots.get_child_count():
			var d: Control = dots.get_child(k)
			d.custom_minimum_size = Vector2(22 if k == i else 9, 9)
			d.modulate = Color.WHITE if k == i else Color(1, 1, 1, 0.55)
		if arrows.size() == 2:
			arrows[0].visible = i > 0
			arrows[1].visible = i < evs.size() - 1
	var goto := func(i: int, anim := true) -> void:
		cur.i = clampi(i, 0, evs.size() - 1)
		var x: float = -int(cur.i) * root.size.x
		if anim:
			var tw := strip.create_tween().set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
			tw.tween_property(strip, "position:x", x, 0.32)
		else:
			strip.position.x = x
		mark.call(int(cur.i))
	# 幅は木に入ってから決まる。1 枚を板の幅にそろえ、覚えていた 1 枚の位置へ
	root.resized.connect(func() -> void:
		for b in slides:
			b.custom_minimum_size.x = root.size.x
		strip.size = Vector2(root.size.x * slides.size(), h)
		goto.call(int(cur.i), false))
	var pad := Control.new()
	pad.set_anchors_preset(Control.PRESET_FULL_RECT)
	pad.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	root.add_child(pad)
	var drag := {on = false, x0 = 0.0, s0 = 0.0, moved = false}
	pad.gui_input.connect(func(e: InputEvent) -> void:
		if e is InputEventMouseButton and e.button_index == MOUSE_BUTTON_LEFT:
			if e.pressed:
				drag.on = true
				drag.moved = false
				drag.x0 = e.position.x
				drag.s0 = strip.position.x
			elif drag.on:
				drag.on = false
				var dx: float = e.position.x - drag.x0
				if not drag.moved:
					go("event", {ev = evs[int(cur.i)].id})
				else:
					# 少し引いただけでも向きのほうへ 1 枚（半分まで引かないと戻るのは重い）
					goto.call(int(cur.i) + (1 if dx < -40.0 else (-1 if dx > 40.0 else 0)))
		elif e is InputEventMouseMotion and drag.on:
			var dx2: float = e.position.x - drag.x0
			if absf(dx2) > 8.0:
				drag.moved = true
			if drag.moved:
				# 端では引いた量の 3 分の 1 だけ動かす（それ以上は無いと分かるように）
				var x: float = drag.s0 + dx2
				var lo := -(evs.size() - 1) * root.size.x
				if x > 0.0:
					x /= 3.0
				elif x < lo:
					x = lo + (x - lo) / 3.0
				strip.position.x = x)
	if evs.size() > 1:
		for k in evs.size():
			var d := UI.box({c = [SUN], radius = 5.0, border = 1.5, border_color = Color.WHITE, shadow = Vector2.ZERO, pad = Vector4.ZERO})
			d.custom_minimum_size = Vector2(9, 9)
			d.press(func() -> void: goto.call(k))
			dots.add_child(d)
		dots.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM)
		dots.offset_top = -30
		dots.offset_bottom = -20
		dots.grow_horizontal = Control.GROW_DIRECTION_BOTH
		root.add_child(dots)
		for side in [-1, 1]:
			var ab := UI.box({c = [Color("#fbf7ea")], radius = 999.0, border = 2.5, shadow = Vector2(0, 3), pad = Vector4(0, 0, 0, 3)})
			ab.custom_minimum_size = Vector2(40, 40)
			var al := UI.label("‹" if side < 0 else "›", 26, INK, "title")
			al.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			al.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
			al.set_anchors_preset(Control.PRESET_FULL_RECT)
			ab.add_child(al)
			ab.press(func() -> void: goto.call(int(cur.i) + side))
			ab.set_anchors_preset(Control.PRESET_CENTER_LEFT if side < 0 else Control.PRESET_CENTER_RIGHT)
			ab.offset_top = -24
			ab.offset_bottom = 16
			ab.offset_left = -22 if side < 0 else -18
			ab.offset_right = 18 if side < 0 else 22
			root.add_child(ab)
			arrows.append(ab)
	mark.call(int(cur.i))
	return root


## 開いているイベント（opts.ev。無ければいちばん新しいもの）
func _ev_of(id) -> Dictionary:
	for e in IK.data().events:
		if e.id == id:
			return e
	return IK.data().events.back()


func _event_banner(ev: Dictionary, nav := true) -> Control:
	var st := IK.event_state(p, ev.id)
	var cleared: Array = st.cleared.map(func(x): return int(x))
	var lay := Control.new()
	lay.custom_minimum_size.y = 190
	lay.mouse_filter = Control.MOUSE_FILTER_STOP if nav else Control.MOUSE_FILTER_IGNORE
	if screen != "event" and nav:
		lay.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		lay.gui_input.connect(func(e: InputEvent) -> void:
			if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
				go("event", {ev = ev.id}))
	var bg := _img(_bg_tex(ev.reward), true)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	lay.add_child(bg)
	lay.add_child(_shade(0.92, 0.05))
	var s := _img(_sticker_tex(ev.reward))
	s.size = Vector2(340, 230)
	s.position = Vector2(W() - 380, -16)
	lay.add_child(s)
	var v := UI.vbox(3)
	v.position = Vector2(20, 14)
	var chip := UI.box({c = [SUN], radius = 6.0, border = 0.0, shadow = Vector2.ZERO, pad = Vector4(8, 1, 8, 2)})
	chip.add_child(UI.label("EVENT 開催中", 12, INK, "title"))
	chip.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	chip.rotation = -0.04
	v.add_child(chip)
	v.add_child(UI.outlined(ev.name, 36, Color("#fff4dc"), "title", Color("#0d2a2e"), 6))
	v.add_child(UI.outlined("「%s」　%s" % [ev.title, String(ev.stage).get_slice("（", 0)], 14, Color.WHITE, "black", Color("#0d2a2e"), 4))
	v.add_child(UI.outlined(" ".join(range(1, 6).map(func(x): return ("★" if cleared.has(x) else "☆") + str(x))) + "　報酬 %s（LM）" % IK.card(ev.reward).name, 15, Color("#ffd36a"), "black", Color("#0d2a2e"), 4))
	lay.add_child(v)
	return _framed(lay)


func _event() -> Control:
	var ev := _ev_of(opts.get("ev", ""))
	var st := IK.event_state(p, ev.id)
	var page := UI.vbox(18)
	page.add_child(_event_banner(ev))
	var cols := UI.hbox(16)
	var rw = IK.card(ev.reward)
	cols.add_child(_card_view(rw, 230))
	var v := UI.vbox(10)
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	v.add_child(_wrap(ev.blurb, 14, 560))
	v.add_child(UI.label("各難易度で初めて勝つと %s を 1 枚（☆1〜☆5 の 5 つで完凸）。挑戦 %d 回" % [rw.name, int(st.tries)], 13, Color("#4a5b58"), "black"))
	var cleared: Array = st.cleared.map(func(x): return int(x))
	if p.finished.is_empty():
		v.add_child(UI.label("完成馬が居ない。育成で 1 頭仕上げると挑める。", 15, INK, "black"))
	else:
		var hid = opts.get("id", p.finished[p.finished.size() - 1].id)
		v.add_child(UI.label("挑む馬", 12, Color("#4a5b58"), "black"))
		var hf := HFlowContainer.new()
		hf.add_theme_constant_override("h_separation", 6)
		for h in p.finished:
			hf.add_child(_tile(IK.horse_card(h), h.name, "%s %d" % [h.rank, int(h.rating)], go.bind("event", {id = h.id, ev = ev.id}), {sel = int(h.id) == int(hid), badge = h.rank}))
		v.add_child(hf)
		var he = IK.find_finished(p, hid)
		if he != null:
			v.add_child(_style_row(IK.horse_race_style(he), IK.style_name_of(float(he.style)), func(x: String) -> void: IK.set_race_style(he, x)))
		var stars := HFlowContainer.new()
		stars.add_theme_constant_override("h_separation", 10)
		stars.add_theme_constant_override("v_separation", 10)
		for s in range(1, 6):
			stars.add_child(UI.button(("★" if cleared.has(s) else "☆") + "%d に挑む" % s, func() -> void:
				var r := IK.event_race(p, hid, ev.id, s)
				save()
				var extra: Control = null
				if r.reward != null:
					extra = UI.label("報酬：%s を手に入れた（覚醒 %d）" % [r.reward.card.name, int(r.reward.awaken)], 18, Color("#c0641a"), "title")
				_watch(r.result, [100], r.fired, _result.bind(r.result, [100], r.fired, "%s ☆%d　%d 着" % [ev.name, s, int(r.order)], extra)),
				"paper" if cleared.has(s) else "sun", 15))
		v.add_child(stars)
	cols.add_child(v)
	page.add_child(UI.section("%s　「%s」" % [ev.name, ev.title], cols))
	return page


# ------------------------------------------------------------------ 描く部品

## 空（ゲームの .ik-sky）：172° のグラデーション・網点・透かしの「WINNING ROAD」・灯りのともる街並み
class SkyBg extends Control:
	func _draw() -> void:
		var stops := [[0.0, Color("#113035")], [0.28, Color("#1d4440")], [0.58, Color("#4f7a3c")], [0.80, Color("#a7b84a")], [1.0, Color("#e9b468")]]
		var h := size.y
		var tilt := size.x * 0.07   # 172° は少しだけ斜め：右端を左端より下げる
		draw_rect(Rect2(Vector2.ZERO, size), stops[0][1])
		for i in stops.size() - 1:
			var y0: float = stops[i][0] * (h + tilt) - tilt * 0.5
			var y1: float = stops[i + 1][0] * (h + tilt) - tilt * 0.5
			var a: Color = stops[i][1]
			var b: Color = stops[i + 1][1]
			draw_polygon(PackedVector2Array([Vector2(0, y0 - tilt * 0.5), Vector2(size.x, y0 + tilt * 0.5), Vector2(size.x, y1 + tilt * 0.5), Vector2(0, y1 - tilt * 0.5)]),
				PackedColorArray([a, a, b, b]))
		draw_rect(Rect2(0, h - tilt, size.x, tilt + 2), Color(0, 0, 0, 0))
		var dot := Color(1, 1, 1, 0.07)
		var y := 0.0
		while y < h:
			var x := 0.0
			while x < size.x:
				draw_circle(Vector2(x, y), 1.2, dot)
				x += 10.0
			y += 10.0
		# 遠くの街（下の 45%、薄く）
		var sx := size.x / 1280.0
		var base := h
		var k := 0
		var bx := -20.0
		while bx < size.x:
			var bw := (90.0 + float((k * 53) % 80)) * sx
			var bh := (160.0 + float((k * 97) % 170)) * minf(1.0, h / 720.0)
			draw_rect(Rect2(bx, base - bh, bw - 10 * sx, bh), Color(0.05, 0.16, 0.18, 0.28))
			var wy := base - bh + 14
			while wy < base - 8:
				var wx := bx + 10
				while wx < bx + bw - 22 * sx:
					draw_rect(Rect2(wx, wy, 6, 9), Color(0.95, 0.77, 0.42, 0.22))
					wx += 18
				wy += 22
			bx += bw
			k += 1
		var f: Font = load("res://scripts/ik/ui.gd").font("title")
		var fs := int(clampf(size.x * 0.085, 60.0, 120.0))
		var tw := f.get_string_size("WINNING ROAD", HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
		draw_string(f, Vector2((size.x - tw) / 2.0, fs * 0.82), "WINNING ROAD", HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(1, 1, 1, 0.08))

	func _notification(what: int) -> void:
		if what == NOTIFICATION_RESIZED:
			queue_redraw()


## 街並み（ゲームの SVG と同じ並び）。ビルは紺、窓は灯り
class City extends Control:
	func _draw() -> void:
		var sx := size.x / 400.0
		var sy := size.y / 220.0
		for b in [[0, 100, 38], [34, 44, 44], [82, 122, 30], [110, 76, 36], [150, 132, 46], [196, 34, 34], [234, 104, 40], [276, 64, 48], [326, 118, 30], [356, 54, 44]]:
			draw_rect(Rect2(b[0] * sx, b[1] * sy, b[2] * sx, (220 - b[1]) * sy), Color("#0d2a2e"))
		draw_polygon(PackedVector2Array([Vector2(196 * sx, 34 * sy), Vector2(213 * sx, 10 * sy), Vector2(230 * sx, 34 * sy)]), PackedColorArray([Color("#0d2a2e")]))
		for b in [[34, 50, 44], [110, 82, 36], [196, 40, 34], [276, 70, 48], [356, 60, 44]]:
			var y: float = b[1]
			while y < 214:
				var x: float = b[0]
				while x < b[0] + b[2] - 4:
					draw_rect(Rect2((x + 2) * sx, (y + 3) * sy, 4 * sx, 5 * sy), Color(0.95, 0.77, 0.42, 0.55))
					x += 10
				y += 12

	func _notification(what: int) -> void:
		if what == NOTIFICATION_RESIZED:
			queue_redraw()


## かけらの宝石（緑の菱形）
class Gem extends Control:
	func _draw() -> void:
		var c := size / 2.0
		var r := minf(size.x, size.y) * 0.46
		var pts := PackedVector2Array([c + Vector2(0, -r), c + Vector2(r, 0), c + Vector2(0, r), c + Vector2(-r, 0)])
		draw_polygon(pts, PackedColorArray([Color("#d6f06a"), Color("#a7cb0e"), Color("#6f9a08"), Color("#c3e044")]))
		draw_polyline(PackedVector2Array([pts[0], pts[1], pts[2], pts[3], pts[0]]), Color.WHITE, 1.6, true)


class Dot extends Control:
	func _draw() -> void:
		draw_circle(Vector2(4, 3), 4.5, Color("#f3a332"))


class Barcode extends Control:
	func _draw() -> void:
		var x := 0.0
		var k := 0
		while x < size.x:
			var w := 1.0 + float((k * 7) % 3)
			draw_rect(Rect2(x, 0, w, size.y), Color("#113035"))
			x += w + 1.0 + float((k * 5) % 2)
			k += 1


class Dashes extends Control:
	func _draw() -> void:
		var y := 0.0
		while y < size.y:
			draw_line(Vector2(size.x / 2.0, y), Vector2(size.x / 2.0, minf(size.y, y + 4)), Color("#113035"), 2.0)
			y += 8.0


## 編成の空き枠（点線）
class Dashed extends Control:
	func _draw() -> void:
		var r := Rect2(Vector2(2, 2), size - Vector2(4, 4))
		draw_rect(r, Color(1, 1, 1, 0.9))
		var col := Color("#d8c9a3")
		var pts := [r.position, Vector2(r.end.x, r.position.y), r.end, Vector2(r.position.x, r.end.y), r.position]
		for i in 4:
			var a: Vector2 = pts[i]
			var b: Vector2 = pts[i + 1]
			var L := a.distance_to(b)
			var t := 0.0
			while t < L:
				draw_line(a.lerp(b, t / L), a.lerp(b, minf(L, t + 7) / L), col, 2.0)
				t += 12.0
		var f: Font = load("res://scripts/ik/ui.gd").font("body")
		draw_string(f, Vector2(0, size.y / 2.0 + 6), "空き", HORIZONTAL_ALIGNMENT_CENTER, size.x, 15, Color("#5f706c"))


## 細い棒（能力・体力・進み）。cap は伸びしろの上限の黄色の線
class Bar extends Control:
	var value := 0.0
	var cap := -1.0
	var cols: Array = [Color("#2c5a55"), Color("#a7cb0e")]

	func _draw() -> void:
		var r := size.y / 2.0
		draw_style_box(_sb(Color("#e3dccb"), r), Rect2(Vector2.ZERO, size))
		var w := size.x * clampf(value, 0.0, 1.0)
		if w > 1.0:
			# 左から右へ色を変える（ゲームの能力の棒は青緑から若草へ）。端だけ丸く
			var n := 16
			for i in n:
				var x0 := w * i / n
				var x1 := w * (i + 1) / n
				var col: Color = cols[0].lerp(cols[1], (x0 + x1) / 2.0 / maxf(w, 1.0))
				var rr := Rect2(x0, 0, x1 - x0 + 0.6, size.y)
				if i == 0 or i == n - 1:
					var sb := _sb(col, 0)
					if i == 0:
						sb.corner_radius_top_left = int(r)
						sb.corner_radius_bottom_left = int(r)
					if i == n - 1:
						sb.corner_radius_top_right = int(r)
						sb.corner_radius_bottom_right = int(r)
					draw_style_box(sb, rr)
				else:
					draw_rect(rr, col)
		if cap >= 0.0:
			draw_rect(Rect2(size.x * clampf(cap, 0.0, 1.0) - 1.5, -3, 3, size.y + 6), Color("#f3a332"))

	func _sb(c: Color, r: float) -> StyleBoxFlat:
		var sb := StyleBoxFlat.new()
		sb.bg_color = c
		sb.set_corner_radius_all(int(r))
		return sb


## 育成の進みの輪（ゲームの .ikh-ring）：橙の進み・中に顔と戦数
class Ring extends Control:
	var face: Texture2D
	var p := 0.0
	var big := "0"

	func _draw() -> void:
		var c := size / 2.0
		var r := minf(size.x, size.y) / 2.0
		draw_circle(c + Vector2(0, 4), r, Color(0.067, 0.188, 0.208, 0.5))
		draw_circle(c, r, Color("#113035"))
		draw_circle(c, r - 3, Color(1, 1, 1, 0.45))
		if p > 0.0:
			draw_arc(c, r - 8, -PI / 2, -PI / 2 + TAU * p, 48, Color("#f3a332"), 10.0, true)
		draw_circle(c, r - 14, Color("#a9c49a"))
		if face:
			draw_texture_rect(face, Rect2(c - Vector2(r - 14, r - 14), Vector2(r - 14, r - 14) * 2), false, Color(1, 1, 1, 0.55))
		var f: Font = load("res://scripts/ik/ui.gd").font("title")
		draw_string_outline(f, Vector2(0, c.y + 8), big, HORIZONTAL_ALIGNMENT_CENTER, size.x, 30, 6, Color("#113035"))
		draw_string(f, Vector2(0, c.y + 8), big, HORIZONTAL_ALIGNMENT_CENTER, size.x, 30, Color.WHITE)
		var fb: Font = load("res://scripts/ik/ui.gd").font("black")
		draw_string_outline(fb, Vector2(0, c.y + 24), "/10戦", HORIZONTAL_ALIGNMENT_CENTER, size.x, 11, 4, Color("#113035"))
		draw_string(fb, Vector2(0, c.y + 24), "/10戦", HORIZONTAL_ALIGNMENT_CENTER, size.x, 11, Color.WHITE)


## 顔の丸いアイコン：淡い地に顔、レア度の色の輪（LM は虹）、下にレア度の札、右上に枚数と覚醒か評価の札
class CardIcon extends Control:
	var face: Texture2D
	var rar := ""
	var badge := ""
	var count := 0
	var dim := false
	var sel := false

	func _draw() -> void:
		var r := minf(size.x, size.y) / 2.0 - 2
		var c := Vector2(size.x / 2.0, r + 2)
		draw_circle(c + Vector2(0, 4), r, Color(0.067, 0.188, 0.208, 0.45))
		draw_circle(c, r, Color("#113035"))
		var ring: Color = {LM = Color("#b46cff"), SSR = Color("#e8b33a"), SR = Color("#c8d0dc"), R = Color("#c9884e"), N = Color("#6fbf57")}.get(rar, Color.WHITE)
		if rar == "LM":
			var n := 36
			for i in n:
				draw_arc(c, r - 4.5, TAU * i / n, TAU * (i + 1) / n + 0.02, 4, Color.from_hsv(float(i) / n, 0.55, 1.0), 6.0, true)
		else:
			draw_arc(c, r - 4.5, 0, TAU, 48, ring, 6.0, true)
		draw_circle(c, r - 8, Color("#eef3dc") if not dim else Color("#8e9a96"))
		if face:
			var inner := r - 8
			draw_texture_rect(face, Rect2(c - Vector2(inner, inner), Vector2(inner, inner) * 2), false, Color.WHITE if not dim else Color(0.12, 0.15, 0.16, 0.9))
		if sel:
			draw_arc(c, r + 1.5, 0, TAU, 48, Color("#f3a332"), 4.5, true)
		var f: Font = load("res://scripts/ik/ui.gd").font("title")
		var fs := int(maxf(10.0, r * 0.26))
		var tag := Rect2(c.x - r * 0.42, c.y + r * 0.6, r * 0.84, fs + 5)
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color("#fffaf0") if rar != "LM" else Color("#f3e6ff")
		sb.set_corner_radius_all(5)
		sb.border_color = ring.darkened(0.2)
		sb.set_border_width_all(2)
		draw_style_box(sb, tag)
		draw_string(f, Vector2(tag.position.x, tag.position.y + fs + 0.5), rar, HORIZONTAL_ALIGNMENT_CENTER, tag.size.x, fs, Color("#113035"))
		var fb: Font = load("res://scripts/ik/ui.gd").font("black")
		if count > 1:
			var bw := 38.0
			var br := Rect2(size.x - bw - 2, 0, bw, 26)
			var bs := StyleBoxFlat.new()
			bs.bg_color = Color("#113035") if count < 5 else Color("#d9792a")
			bs.set_corner_radius_all(7)
			bs.border_color = Color.WHITE
			bs.set_border_width_all(2)
			draw_style_box(bs, br)
			draw_string(fb, Vector2(br.position.x, br.position.y + 12), "×%d" % count, HORIZONTAL_ALIGNMENT_CENTER, bw, 11, Color.WHITE)
			var aw := mini(4, count - 1)
			draw_string(fb, Vector2(br.position.x, br.position.y + 23), "◆".repeat(aw) + "◇".repeat(4 - aw), HORIZONTAL_ALIGNMENT_CENTER, bw, 8, Color("#f6cf86"))
		elif badge != "":
			var bw2 := maxf(26.0, fb.get_string_size(badge, HORIZONTAL_ALIGNMENT_LEFT, -1, 13).x + 12)
			var br2 := Rect2(size.x - bw2 - 2, 0, bw2, 22)
			var bs2 := StyleBoxFlat.new()
			bs2.bg_color = Color("#f3a332")
			bs2.set_corner_radius_all(8)
			bs2.border_color = Color("#113035")
			bs2.set_border_width_all(2)
			draw_style_box(bs2, br2)
			draw_string(fb, Vector2(br2.position.x, br2.position.y + 16), badge, HORIZONTAL_ALIGNMENT_CENTER, bw2, 13, Color("#113035"))


## 伏せたカードの裏。charge（色）と glow（0..1）で最後の 1 枚を溜めて光らせる
class CardBack extends Control:
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
		draw_style_box(_box(Color("#2c5a55"), 10, Color("#f3a332")), inner)
		var f: Font = load("res://scripts/ik/ui.gd").font("title")
		var fs := int(size.x * 0.12)
		draw_string(f, Vector2(inner.position.x, inner.get_center().y - fs * 0.2), "WINNING", HORIZONTAL_ALIGNMENT_CENTER, inner.size.x, fs, Color("#fbf8ef"))
		draw_string(f, Vector2(inner.position.x, inner.get_center().y + fs * 1.0), "ROAD", HORIZONTAL_ALIGNMENT_CENTER, inner.size.x, fs, Color("#a7cb0e"))

	func _box(bg: Color, radius: float, border := Color(0, 0, 0, 0)) -> StyleBoxFlat:
		var sb := StyleBoxFlat.new()
		sb.bg_color = bg
		sb.set_corner_radius_all(int(radius))
		if border.a > 0:
			sb.border_color = border
			sb.set_border_width_all(4)
		return sb
