extends RefCounted
## 育成モードのレースの馬の布（顔・ゼッケン・勝負服）と色を、手持ち（assets/horse/lib、tools/export-godot-ikusei.mjs --art）から組む。
##
## カードの馬はそのカードの顔（毛色・白斑）と勝負服（実在の馬主の服を持つカードはその服）。NPC は毛色ごとの顔 3 通りと
## 勝負服 24 通りから馬の id で選ぶ（乱数は使わない。同じレースはいつも同じ見た目）。ゼッケンと帽子の色は馬番と枠で決まる。

const LIB := "res://assets/horse/lib/"
static var M: Dictionary = {}
static var _tex: Dictionary = {}


static func meta() -> Dictionary:
	if M.is_empty() and FileAccess.file_exists(LIB + "lib.json"):
		M = JSON.parse_string(FileAccess.get_file_as_string(LIB + "lib.json"))
	return M


static func tex(name) -> Texture2D:
	if name == null:
		return null
	if not _tex.has(name):
		_tex[name] = load(LIB + String(name)) if ResourceLoader.exists(LIB + String(name)) else null
	return _tex[name]


## runner：{id, cardId?, coat, gate, frame}。返り値は horse_model.gd の build_with に渡す {meta, tex}。
static func for_runner(r: Dictionary) -> Dictionary:
	var L := meta()
	if L.is_empty():
		return {meta = {}, tex = {}}
	var mats := {}
	var legs := {}
	var t := {}
	var cid = r.get("cardId")
	var own_silks := false
	if cid != null and L.cards.has(cid):
		var c: Dictionary = L.cards[cid]
		mats = (c.mats as Dictionary).duplicate()
		legs = c.legs
		t.face = tex(c.face)
		if c.silks != null:
			t.silks = tex(c.silks)
			t.sleeve = tex(c.sleeve)
		own_silks = _has_own_silks(cid)
	else:
		var list: Array = L.coats.get(String(r.get("coat", "鹿毛")), L.coats.get("鹿毛"))
		var v: Dictionary = list[absi(int(r.id)) % list.size()]
		mats = (v.mats as Dictionary).duplicate()
		legs = v.legs
		t.face = tex(v.face)
		var s: Dictionary = L.silks[absi(int(r.id) * 7 + 3) % L.silks.size()]
		for k in s.mats:
			mats[k] = s.mats[k]
		t.silks = tex(s.silks)
		t.sleeve = tex(s.sleeve)
	var num: Dictionary = L.numbers.get("%d_%d" % [int(r.gate), clampi(int(r.frame), 1, 8)], {})
	t.number = tex(num.get("tex"))
	# 帽子は枠の色（実在の馬主の服を着るカードは服の帽子のまま）
	if not own_silks and num.has("cap"):
		mats.cap = num.cap
	return {meta = {mats = mats, legs = legs}, tex = t}


static func _has_own_silks(cid) -> bool:
	var IK = load("res://scripts/ik/ikusei.gd")
	var c = IK.card(cid)
	return c != null and c.get("silks") != null
