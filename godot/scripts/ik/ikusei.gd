extends RefCounted
## カード育成モードの中身（src/sim/ikusei.js と ikusei-skills.js を移したもの）。画面（ikusei_ui.gd）はここの関数だけを通す。
##
## 表（カード・番組・コース・物理の定数）は data/ikusei/data.json（tools/export-godot-ikusei.mjs が書く）から読む。
## 乱数はゲームと同じく (プロフィールのシード, 引いた回数・ターン・対戦の回数) から 1 回ずつ作る。
## 鍵の文字列も JS と同じにする（"gacha:%d:%d"）。数は必ず整数で書く：保存した JSON を読み直すと数が小数になり、
## そのまま str() すると "12345.0" になって別の乱数になる。
## プロフィールは user://ikusei.json（素の辞書。ゲームの localStorage の keiba-ikusei-v1 と同じ形）。

const Rng := preload("res://scripts/ik/rng.gd")
const Sim := preload("res://scripts/ik/race_sim.gd")

const STATS := ["speed", "stamina", "power", "guts", "wit"]
const STAT_LABEL := {speed = "スピード", stamina = "スタミナ", power = "パワー", guts = "根性", wit = "賢さ"}
const STAT_SHORT := {speed = "スピ", stamina = "スタ", power = "パワ", guts = "根性", wit = "賢さ"}
const RARITIES := ["LM", "SSR", "SR", "R", "N"]
const RAR_BONUS := {LM = 1.3, SSR = 1.2, SR = 1.1, R = 1.05, N = 1.0}
const RAR_SCALE := {LM = 1.5, SSR = 1.25, SR = 1.0, R = 0.8, N = 0.6}
const MOOD_MUL := [0.8, 0.9, 1.0, 1.1, 1.2]
const TRAININGS_PER_RACE := 3
const CLASSES := ["新馬", "未勝利", "1勝クラス", "2勝クラス", "オープン"]
const RACE_LEVEL := {"新馬": 0.47, "未勝利": 0.49, "1勝クラス": 0.53, "2勝クラス": 0.57, "オープン": 0.60, "GIII": 0.62, "GII": 0.64, "GI": 0.68}
const TRAIN := {
	speed = {main = "speed", sub = {power = 0.5}, cost = 20},
	stamina = {main = "stamina", sub = {guts = 0.5}, cost = 20},
	power = {main = "power", sub = {stamina = 0.5}, cost = 20},
	guts = {main = "guts", sub = {speed = 0.35, power = 0.35}, cost = 20},
	wit = {main = "wit", sub = {speed = 0.4}, cost = 5},
}
const NPC_NAMES := ["ミラクル", "サンダー", "ブレイブ", "グローリー", "スカイ", "ローレル", "ハヤテ", "ムーン", "シャイン", "クラウン", "ストーム", "フェアリー", "ダンサー", "スター", "ルビー", "ヴィクトリー", "ドリーム", "ファイア"]
const NPC_HEAD := ["エイシン", "マイネル", "サクラ", "メイショウ", "タガノ", "ダイワ", "ゴールド", "シルバー", "トウカイ", "ニシノ", "アドマイヤ", "ヤマニン"]
const NPC_COATS := ["鹿毛", "黒鹿毛", "栗毛", "青鹿毛", "芦毛", "栃栗毛"]
const SAVE_PATH := "user://ikusei.json"
## 馬具（src/sim/ikusei.js と同じ）。育成モードの馬は気性を持たないので、効き目は気性 0.35 の馬として測る
const GEAR_TEMPER := 0.35
const GEAR_KEYS := ["menko", "shadowRoll", "blinker", "cheek", "bandage"]
const GEAR_NAMES := {menko = "メンコ", shadowRoll = "シャドーロール", blinker = "ブリンカー", cheek = "チークピーシーズ", bandage = "バンテージ"}
const GEAR_COLORS := ["#f4f2ec", "#1f3f9e", "#c8202a", "#1c1c1c", "#e8b21a", "#2f8f4a", "#e86aa0", "#7a4fc0", "#f07a28", "#5fb6e0"]


static func clean_gear(gear) -> Dictionary:
	var g := {}
	if not (gear is Dictionary):
		return g
	for k in GEAR_KEYS:
		var v = gear.get(k)
		# 色（文字列）か true だけ。String と bool を != で比べると Godot はエラーで止まる
		if (v is String and v != "") or (v is bool and v):
			g[k] = v
	if g.has("blinker") and g.has("cheek"):
		g.erase("cheek")
	return g


static func run_gear(run: Dictionary) -> Dictionary:
	if run.get("gear") is Dictionary:
		return run.gear
	if run.get("sire") != null:
		return {}
	var c = card(run.get("trainee"))
	return clean_gear(c.get("gear") if c != null else null)


static func set_run_gear(run: Dictionary, gear: Dictionary) -> Dictionary:
	run.gear = clean_gear(gear)
	return run.gear


static func horse_gear(h: Dictionary) -> Dictionary:
	if h.get("gear") is Dictionary:
		return h.gear
	var c = card(h.get("cardId")) if h.get("cardId") != null else null
	return clean_gear(c.get("gear") if c != null else null)


static func set_finished_gear(h: Dictionary, gear: Dictionary) -> Dictionary:
	h.gear = clean_gear(gear)
	return h.gear


static func gear_names(gear: Dictionary) -> Array:
	return GEAR_KEYS.filter(func(k): return gear.has(k)).map(func(k): return GEAR_NAMES[k])

static var D: Dictionary = {}
static var BY_ID: Dictionary = {}
static var TOTAL_TURNS := 40


static func data() -> Dictionary:
	if D.is_empty():
		D = JSON.parse_string(FileAccess.get_file_as_string("res://data/ikusei/data.json"))
		for c in D.cards:
			BY_ID[c.id] = c
		TOTAL_TURNS = D.slots.size() * (TRAININGS_PER_RACE + 1)
	return D


static func cards() -> Array:
	return data().cards


static func card(id) -> Variant:
	data()
	return BY_ID.get(id)


## 鍵の数は整数で書く（"%d"）。
static func key(parts: Array) -> String:
	var s := []
	for p in parts:
		s.append("%d" % int(p) if (p is float or p is int) else str(p))
	return ":".join(s)


static func rng_of(parts: Array):
	return Rng.make(Rng.hash_seed(key(parts)))


static func clampf_(v: float, lo: float, hi: float) -> float:
	return lo if v < lo else (hi if v > hi else v)


static func jround(x: float) -> int:
	return int(floor(x + 0.5))


static func in_packs(c: Dictionary) -> bool:
	return data().packs.has(c.pack)


static func is_event_card(c) -> bool:
	return c != null and not in_packs(c)


static func plus_of(c: Dictionary) -> Dictionary:
	return c.plus


# ------------------------------------------------------------------ 配合（育成馬を作る。src/sim/ikusei.js の bredCard と同じ）
## 育成馬は父のカード（牡）× 母のカード（牝）。名前は自分で決め、脚質は両親の脚質のあいだから選ぶ。
## 素の値は両親の平均（小数 3 桁に丸める）、+値は能力ごとに高いほう、レーススキルは交互に受け継ぐ（多いほうの数 +1 まで）。
## 保存するのは親の id・名前・脚質・性・毛色だけで、値は毎回両親から作り直す（Godot の JSON は長い小数を読み違える）。

const STYLE_NAMES := ["逃げ", "先行", "差し", "追込"]
const STYLE_VALUE := [0.12, 0.37, 0.62, 0.87]
const SUPPORT_SLOTS := 4
const NAME_MAX := 12


static func style_idx(x: float) -> int:
	return 0 if x < 0.25 else (1 if x < 0.5 else (2 if x < 0.75 else 3))


## 自分の馬のレースの脚質（ゲームの runRaceStyle・horseRaceStyle）。選んだ脚質は raceStyle に覚える。
static func style_name_of(x: float) -> String:
	return STYLE_NAMES[style_idx(x)]


static func run_race_style(run: Dictionary) -> String:
	return String(run.raceStyle) if STYLE_NAMES.has(run.get("raceStyle")) else style_name_of(float(trainee_card(run).style))


static func horse_race_style(h: Dictionary) -> String:
	return String(h.raceStyle) if STYLE_NAMES.has(h.get("raceStyle")) else style_name_of(float(h.style))


static func set_race_style(o: Dictionary, name) -> void:
	if name is String and STYLE_NAMES.has(name):
		o.raceStyle = name


static func _style_value(o: Dictionary, fallback: float) -> float:
	return float(STYLE_VALUE[STYLE_NAMES.find(o.raceStyle)]) if STYLE_NAMES.has(o.get("raceStyle")) else fallback


## 脚質のスキルが選んだ脚質に合うか（逃げ切りは逃げ、末脚炸裂は差し・追込）。
static func style_fits(skill_style: float, lock: float) -> bool:
	return lock < 0.25 if skill_style < 0.25 else lock >= 0.5


static func _r3(x: float) -> float:
	return floor(x * 1000.0 + 0.5) / 1000.0


static func foal_styles(sire: Dictionary, dam: Dictionary) -> Array:
	var a := style_idx(float(sire.style))
	var b := style_idx(float(dam.style))
	return STYLE_NAMES.slice(mini(a, b), maxi(a, b) + 1)


static func foal_default_style(sire: Dictionary, dam: Dictionary) -> String:
	return STYLE_NAMES[jround((style_idx(float(sire.style)) + style_idx(float(dam.style))) / 2.0)]


static func foal_name_idea(sire: Dictionary, dam: Dictionary) -> String:
	var a: String = sire.name
	var b: String = dam.name
	return (a.substr(0, int(ceil(a.length() / 2.0))) + b.substr(int(floor(b.length() / 2.0)))).substr(0, NAME_MAX)


static func _inherit_skills(fs: Array, ds: Array, si: int) -> Array:
	var out := []
	var n := maxi(fs.size(), ds.size())
	for i in n:
		for id in [fs[i] if i < fs.size() else null, ds[i] if i < ds.size() else null]:
			if id == null or out.has(id):
				continue
			if (id == "front" and si != 0) or (id == "closer" and si < 2):
				continue
			out.append(id)
	return out.slice(0, n + 1)


## f = {id, sire, dam, name, style, sex, coat, aw = [父の覚醒, 母の覚醒]}
static func bred_card(f: Dictionary) -> Dictionary:
	var s: Dictionary = card(f.sire)
	var d: Dictionary = card(f.dam)
	var si := maxi(0, STYLE_NAMES.find(f.style))
	var aw: Array = f.get("aw", [0, 0])
	var v := {}
	var plus := {}
	for k in STATS:
		v[k] = _r3((float(s.v[k]) + float(d.v[k])) / 2.0)
		plus[k] = maxi(int(s.plus[k]), int(d.plus[k]))
	var turf := _r3((float(s.turf) + float(d.turf)) / 2.0)
	var dirt := _r3((float(s.dirt) + float(d.dirt)) / 2.0)
	var uniq = s.id if s.rar == "LM" else (d.id if d.rar == "LM" else null)
	return {
		id = "B%d" % int(f.id), pack = "BRED", bred = true, rar = RARITIES[mini(RARITIES.find(s.rar), RARITIES.find(d.rar))],
		name = f.name, sex = f.sex, coat = f.coat, marks = null, sireId = s.id, damId = d.id, sire = s.name, dam = d.name,
		damSire = d.get("sire", ""), line = s.get("line", ""), v = v, plus = plus, turf = turf, dirt = dirt,
		firm = _r3((float(s.firm) + float(d.firm)) / 2.0), soft = _r3((float(s.soft) + float(d.soft)) / 2.0),
		dist = jround((float(s.dist) + float(d.dist)) / 20.0) * 10,
		range = jround((float(s.range) + float(d.range)) / 2.0 + absf(float(s.dist) - float(d.dist)) / 4.0),
		style = STYLE_VALUE[si], unique = uniq, epithetText = "%s × %s" % [s.name, d.name],
		art = s.id if f.coat == s.coat else d.id,
		raceSkills = _inherit_skills(skills_of(s, int(aw[0])).race, skills_of(d, int(aw[1])).race, si),
	}


static func unique_card_of(c) -> Variant:
	if c == null:
		return null
	if c.get("bred", false):
		return card(c.unique) if c.get("unique") != null else null
	return c if c.rar == "LM" else null


## 固有スキルの発動のエフェクト（観戦の見た目。JS の fxOfCard・fxOfFinished）。カードの既定は data.json の fx（JS の uniqueFxOf）。
## 固有を持たない馬は ""。
static func fx_of_card(c) -> String:
	var u = unique_card_of(c)
	return String(u.fx) if u != null and u.get("fx") != null else ""


static func fx_of_finished(h: Dictionary) -> String:
	var u = null
	if h.get("cardId") != null:
		u = unique_card_of(card(h.cardId))
	elif h.get("unique") != null:
		u = card(h.unique)
	if u == null:
		return ""
	var art = h.get("art")
	var f = art.get("fx") if art is Dictionary else null
	if f is String and f == "none":
		return ""
	if f is String and D.skillFx.has(f):
		return f
	return String(u.fx) if u.get("fx") != null else ""


static func trainee_card(run: Dictionary) -> Dictionary:
	if run.get("sire") == null:
		return card(run.trainee)
	return bred_card({id = int(run.id), sire = run.sire, dam = run.dam, name = run.name, style = run.style, sex = run.sex, coat = run.coat,
		aw = run.get("awaken", {}).get("ps", [0, 0])})


## 完成馬の姿（カードの形）。配合の馬は保存した値から。
static func horse_card(h: Dictionary) -> Variant:
	if h.get("cardId") != null:
		return card(h.cardId)
	var s = card(h.get("sire"))
	var d = card(h.get("dam"))
	var plus := {}
	for k in STATS:
		plus[k] = maxi(int(s.plus[k]), int(d.plus[k])) if s != null and d != null else 3
	return {id = "B%d" % int(h.id), pack = "BRED", bred = true, rar = h.rar, name = h.name, sex = h.sex, coat = h.coat, marks = null,
		sireId = h.get("sire"), damId = h.get("dam"), sire = s.name if s != null else "", dam = d.name if d != null else "",
		damSire = d.get("sire", "") if d != null else "", line = s.get("line", "") if s != null else "", plus = plus,
		turf = h.turf, dirt = h.dirt, firm = h.firm, soft = h.soft, dist = h.dist, range = h.range, style = h.style, unique = h.get("unique"),
		epithetText = "%s × %s" % [s.name if s != null else "", d.name if d != null else ""],
		## Godot は撮った絵を持たないので、毛色を受け継いだ親のカードの絵を使う
		art = (s.id if (s != null and h.coat == s.coat) or d == null else d.id) if s != null or d != null else "P1-01"}


static func _init_stats(c: Dictionary, awt: int) -> Dictionary:
	var stats := {}
	for k in STATS:
		stats[k] = jround(200 + (float(c.v[k]) - 0.55) * 1200 + awt * int(data().awaken.init))
	return stats


static func breed_preview(p: Dictionary, sire_id: String, dam_id: String, style = null) -> Dictionary:
	var s: Dictionary = card(sire_id)
	var d: Dictionary = card(dam_id)
	var styles := foal_styles(s, d)
	var st: String = style if styles.has(style) else foal_default_style(s, d)
	var aw := [awaken_of(count_of(p, sire_id)), awaken_of(count_of(p, dam_id))]
	var c := bred_card({id = int(p.nextId), sire = sire_id, dam = dam_id, name = "", style = st, sex = "牡", coat = s.coat, aw = aw})
	var awt := int(floor((aw[0] + aw[1]) / 2.0))
	return {card = c, styles = styles, style = st, awaken = awt, init = _init_stats(c, awt)}


static func surf_of(c: Dictionary) -> String:
	return "芝" if c.turf >= c.dirt else "ダート"


static func dist_cat(d: float) -> String:
	return "短距離" if d <= 1400 else ("マイル" if d <= 1800 else ("中距離" if d <= 2400 else "長距離"))


static func style_name(x: float) -> String:
	return "逃げ" if x < 0.25 else ("先行" if x < 0.5 else ("差し" if x < 0.75 else "追込"))


# ------------------------------------------------------------------ プロフィール

static func new_profile(seed: int) -> Dictionary:
	return {v = 1, seed = seed, pulls = 0, cards = {}, finished = [], run = null, nextId = 1, battles = 0, shards = 0, coins = int(data().coinStart), missions = [], memories = []}


static func load_profile() -> Dictionary:
	if FileAccess.file_exists(SAVE_PATH):
		var p = JSON.parse_string(FileAccess.get_file_as_string(SAVE_PATH))
		if p is Dictionary:
			return migrate_profile(p)
	return new_profile(int(Time.get_unix_time_from_system() * 1000.0) & 0xffffff)


static func save_profile(p: Dictionary) -> void:
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(p))


static func count_of(p: Dictionary, id: String) -> int:
	return int(p.cards.get(id, 0))


# ------------------------------------------------------------------ 覚醒・かけら

static func awaken_of(count) -> int:
	return maxi(0, mini(int(data().awaken.max), int(count if count != null else 0) - 1))


static func keep() -> int:
	return int(data().awaken.max) + 1


static func spare_of(p: Dictionary, id: String) -> int:
	return maxi(0, count_of(p, id) - keep())


static func spare_value(p: Dictionary) -> int:
	var n := 0
	for c in cards():
		n += spare_of(p, c.id) * int(data().shardValue[c.rar])
	return n


static func shard_spare(p: Dictionary, id = null) -> int:
	var got := 0
	for c in ([card(id)] if id != null else cards()):
		var n := spare_of(p, c.id)
		if n == 0:
			continue
		p.cards[c.id] = count_of(p, c.id) - n
		got += n * int(data().shardValue[c.rar])
	p.shards = int(p.get("shards", 0)) + got
	return got


static func can_buy_with_shards(p: Dictionary, id: String) -> String:
	var c = card(id)
	if c == null:
		return "そのカードは無い"
	if is_event_card(c):
		return "イベントの報酬でだけ手に入る"
	if count_of(p, id) >= keep():
		return "もう覚醒 MAX"
	var cost := int(data().shardCost[c.rar])
	if int(p.get("shards", 0)) < cost:
		return "かけらが足りない（あと %d）" % (cost - int(p.get("shards", 0)))
	return ""


static func buy_with_shards(p: Dictionary, id: String) -> Dictionary:
	var c = card(id)
	p.shards = int(p.get("shards", 0)) - int(data().shardCost[c.rar])
	var is_new := count_of(p, id) == 0
	p.cards[id] = count_of(p, id) + 1
	return {card = c, isNew = is_new, awaken = count_of(p, id) - 1 if count_of(p, id) >= 2 else 0}


# ------------------------------------------------------------------ ウイコイン
# ガチャは 1 回 1 枚。得るのはミッション（初めて編成したカードの育成を終える、1 枚ごとに 1 枚）と
# ライバルレース（1 日 10 枚まで。日付は画面が渡す 'YYYY-MM-DD'）。JS の ikusei.js と同じ。

static func coins_of(p: Dictionary) -> int:
	return int(p.get("coins", data().coinStart)) if p.get("coins") != null else int(data().coinStart)


static func missions_of(p: Dictionary) -> Array:
	return p.get("missions", []) if p.get("missions") != null else []


## 育成に編成したカード（父・母・サポート、カード 1 枚の古い育成は trainee）。重なりは 1 つ。
static func _formed_of(o: Dictionary) -> Array:
	var out := []
	for id in [o.get("sire"), o.get("dam"), o.get("trainee") if o.get("trainee") != null else o.get("cardId")] + Array(o.get("supports", [])):
		if id is String and card(id) != null and not out.has(id):
			out.append(id)
	return out


## この育成を終えたら達成になるカード。
static func mission_gain(p: Dictionary, run = null) -> Array:
	if run == null:
		run = p.get("run")
	if run == null:
		return []
	var done := missions_of(p)
	return _formed_of(run).filter(func(id): return not done.has(id))


## ウイコインより前のプロフィール：完成馬の編成をミッション済みにして、その数だけ配る。
static func migrate_profile(p: Dictionary) -> Dictionary:
	# 以前の因子メモリー（能力の点の 8%）は☆に直す
	for m in p.get("memories", []) if p.get("memories") != null else []:
		if m.get("star") != null:
			continue
		m.star = clampi(int(floor(float(m.val) / MEM_STEP + 0.5)), 1, 5)
		m.val = int(m.star) * MEM_STEP
	if p.get("coins") != null and p.get("missions") != null:
		return p
	var done := []
	for h in p.get("finished", []):
		for id in _formed_of(h):
			if not done.has(id):
				done.append(id)
	p.missions = done
	p.coins = int(data().coinStart) + done.size()
	return p


# ------------------------------------------------------------------ ガチャ

## n 回引く。乱数は (シード, 引いた通算回数) から 1 回ずつ（引く前に何を見ても結果は変わらない）。
static func pull(p: Dictionary, n := 1) -> Array:
	# 1 回 1 枚のウイコイン（足りなければ引かない）
	if coins_of(p) < n:
		return []
	p.coins = coins_of(p) - n
	var got := []
	for i in n:
		var rng = rng_of(["gacha", p.seed, p.pulls])
		p.pulls = int(p.pulls) + 1
		var r: float = rng.next()
		var rar := "N"
		for k in RARITIES:
			var rate: float = data().rates[k]
			if r < rate:
				rar = k
				break
			r -= rate
		# イベントのカードはガチャに出さない（母集団が変わると引く順番が全部ずれる）
		var pool := cards().filter(func(c): return c.rar == rar and in_packs(c))
		var c: Dictionary = pool[rng.int_n(pool.size())]
		var is_new := count_of(p, c.id) == 0
		p.cards[c.id] = count_of(p, c.id) + 1
		var cnt := count_of(p, c.id)
		got.append({card = c, isNew = is_new, awaken = cnt - 1 if cnt >= 2 and cnt <= int(data().awaken.max) + 1 else 0})
	return got


static func owned(p: Dictionary) -> Array:
	var list := cards().filter(func(c): return count_of(p, c.id) > 0)
	return Sim.stable_sort(list, func(a, b):
		var ra := RARITIES.find(a.rar)
		var rb := RARITIES.find(b.rar)
		return ra < rb or (ra == rb and String(a.id) < String(b.id)))


static func card_power(c: Dictionary) -> int:
	return int(c.power)


static func collection_power(p: Dictionary) -> int:
	var s := 0
	for c in owned(p):
		s += int(c.power)
	return s


# ------------------------------------------------------------------ スキル（ikusei-skills.js）

static func skills_of(c: Dictionary, aw := 0) -> Dictionary:
	return c.skills[clampi(aw, 0, 4)]


static func skill_info(id: String) -> Dictionary:
	if data().raceSkills.has(id):
		var d: Dictionary = data().raceSkills[id]
		return {id = id, type = "race", name = d.name, desc = d.desc}
	if data().supportSkills.has(id):
		var d: Dictionary = data().supportSkills[id]
		return {id = id, type = "support", name = d.name, desc = d.desc}
	return {}


static func _skill_when(id: String, race: Dictionary, battle: bool) -> bool:
	var dist := float(race.distance)
	match id:
		"turf": return race.surface == "芝"
		"dirt": return race.surface == "ダート"
		"sprint": return dist <= 1400
		"mile": return dist > 1400 and dist <= 1800
		"middle": return dist > 1800 and dist <= 2400
		"stayer": return dist > 2400
		"heavy": return race.get("ground") == "重" or race.get("ground") == "不良"
		"big": return race.get("grade") == "GI"
		"duel": return battle
		"front", "closer", "calm", "grit": return true
	return false


## レーススキルを馬の形に効かせる。発動したスキルの名前を返す。
static func apply_race_skills(spec: Dictionary, skills: Array, race: Dictionary, battle: bool, rar: String, unique_of, aw: int, lock = null) -> Dictionary:
	var s := spec.duplicate()
	s.ab = (spec.ab as Dictionary).duplicate()
	var fired := []
	var k: float = float(RAR_SCALE.get(rar, 1.0)) * (1.0 + float(data().awaken.skill) * aw)
	for id in skills:
		var d = data().raceSkills.get(id)
		if d == null or not _skill_when(id, race, battle):
			continue
		# 脚質を決めた自分の馬は、合わない脚質のスキルを使わず、脚質も書き換えない
		if lock != null and d.get("style") != null and not style_fits(float(d.style), float(lock)):
			continue
		for a in d.add:
			s.ab[a] = minf(0.95, float(s.ab[a]) + float(d.add[a]) * k)
		if d.get("style") != null and lock == null:
			s.style = float(d.style)
		if d.get("soft") != null:
			s.soft = maxf(float(s.get("soft", 0.5) if s.get("soft") != null else 0.5), float(d.soft))
		fired.append(d.name)
	if unique_of != null:
		var surf := "芝" if unique_of.turf >= unique_of.dirt else "ダート"
		if race.surface == surf and absf(float(race.distance) - float(unique_of.dist)) <= 400:
			for a in STATS:
				s.ab[a] = minf(0.95, float(s.ab[a]) + 0.022 * (1.0 + float(data().awaken.skill) * aw))
			fired.append(unique_of.epithetText)
	return {spec = s, fired = fired}


## 観戦の演出で、発動したスキルを見せる地点（その馬が走った距離）。
static func skill_cue(name: String, distance: float) -> Dictionary:
	var id := ""
	for k in data().raceSkills:
		if data().raceSkills[k].name == name:
			id = k
	if id == "":
		return {id = "unique", unique = true, at = maxf(distance * 0.5, distance - 380)}
	var at := distance * 0.3
	match id:
		"front": at = 60
		"turf", "dirt": at = distance * 0.15
		"heavy": at = distance * 0.2
		"big", "duel": at = distance * 0.25
		"calm": at = distance * 0.3
		"sprint", "mile": at = distance * 0.45
		"middle": at = distance * 0.5
		"stayer": at = distance * 0.55
		"closer": at = distance - 550
		"grit": at = distance - 250
	return {id = id, unique = false, at = maxf(40, at)}


# ------------------------------------------------------------------ 能力の尺度

static func ability_of(pts: float) -> float:
	return clampf_(0.36 + (clampf_(pts, 0, PTS_MAX) / 1200.0) * 0.56, 0.0, 1.0)


static func cap_of(plus: int, aw := 0) -> int:
	return mini(1200, 600 + plus * 120 + aw * int(data().awaken.cap))


static func grade_of_pts(p: float) -> String:
	for t in [[1200, "SS+"], [1100, "SS"], [1000, "S+"], [900, "S"], [800, "A+"], [700, "A"], [600, "B+"], [500, "B"], [400, "C+"], [300, "C"], [200, "D"], [100, "E"], [0, "G"]]:
		if p >= t[0]:
			return t[1]
	return "G"


# ------------------------------------------------------------------ 育成の日程

static func _w(md: Array) -> int:
	return (int(md[0]) - 1) * 4 + int(md[1])


static func _class_of(run: Dictionary) -> String:
	if int(run.starts) == 0:
		return "新馬"
	if int(run.wins) == 0:
		return "未勝利"
	return CLASSES[mini(4, int(run.wins) + 1)]


static func ground_of(k: String) -> String:
	var r: float = Rng.make(Rng.hash_seed(k)).next()
	return "良" if r < 0.6 else ("稍重" if r < 0.8 else ("重" if r < 0.93 else "不良"))


# ------------------------------------------------------------------ 目標レースとライバル（JS の ikusei.js と同じ）

const GOAL_BONUS := 150
const GOAL_COINS := 3
const RIVAL_EDGE := 0.05
const RIVAL_GROW := 0.004
const RIVAL_HORSE_ID := 2000000999


static func _slot_of_week(age: int, week: int) -> int:
	var sl: Array = data().slots
	for i in sl.size():
		if int(sl[i].age) == age and week >= _w(sl[i].from) and week <= _w(sl[i].to):
			return i
	return -1


## 目標レース（3 歳で出られる GI のうち、馬場と距離がいちばん合うもの。3 歳 4 月までは後回し）
static func goal_for(c: Dictionary) -> Variant:
	var fit := func(r) -> float:
		return absf(float(r.distance) - float(c.dist)) / 400.0 + (1.2 if (r.surface == "ダート") != (c.dirt > c.turf) else 0.0) \
			- (0.15 if int(r.age[1]) == 3 else 0.0) + (0.5 if _slot_of_week(3, int(r.week)) <= 4 else 0.0)
	var cand := (data().graded as Array).filter(func(r):
		return r.grade == "GI" and int(r.age[0]) <= 3 and int(r.age[1]) >= 3 and (r.sex == null or r.sex == c.sex) and _slot_of_week(3, int(r.week)) >= 0)
	cand = Sim.stable_sort(cand, func(a, b):
		var fa: float = fit.call(a)
		var fb: float = fit.call(b)
		return fa < fb if fa != fb else int(a.week) < int(b.week))
	if cand.is_empty():
		return null
	var r: Dictionary = cand[0]
	return {id = r.id, name = r.name, slot = _slot_of_week(3, int(r.week)), surface = r.surface, distance = int(r.distance), courseId = r.courseId, done = false, tried = false}


static func rival_meets(goal) -> Array:
	var out := [2, 5, int(goal.slot) if goal != null else 7, (data().slots as Array).size() - 1]
	var uniq := []
	for x in out:
		if not uniq.has(x):
			uniq.append(x)
	if uniq.size() < 4:
		uniq.append(6)
	uniq.sort()
	return uniq


static func _pick_rival(c: Dictionary, exclude: Array, seed: int) -> Variant:
	var dirt: bool = c.dirt > c.turf
	var pool := cards().filter(func(x): return in_packs(x) and ["LM", "SSR", "SR"].has(x.rar) and not exclude.has(x.id) and (x.dirt > x.turf) == dirt)
	pool = Sim.stable_sort(pool, func(a, b):
		var da := absf(float(a.dist) - float(c.dist))
		var db := absf(float(b.dist) - float(c.dist))
		return da < db if da != db else String(a.id) < String(b.id))
	pool = pool.slice(0, 8)
	if pool.is_empty():
		return null
	return pool[rng_of(["trival", seed]).int_n(pool.size())].id


static func rival_meets_now(run: Dictionary) -> bool:
	if run.get("rival") == null:
		return false
	for x in run.rival.meets:
		if int(x) == int(run.slot):
			return true
	return false


static func rival_record(run: Dictionary) -> Dictionary:
	var log: Array = run.rival.log if run.get("rival") != null else []
	var won := 0
	var lost := 0
	for x in log:
		if int(x.me) < int(x.rv):
			won += 1
		elif int(x.me) > int(x.rv):
			lost += 1
	return {won = won, lost = lost, log = log}


## 目標レースの今（"done"・"missed"・"out"・"now"・"open"、無ければ ""）
static func goal_state(run: Dictionary) -> String:
	var g = run.get("goal")
	if g == null:
		return ""
	if g.done:
		return "done"
	if g.tried:
		return "missed"
	if int(run.slot) > int(g.slot):
		return "out"
	return "now" if int(run.slot) == int(g.slot) else "open"


static func goal_eligible(run: Dictionary) -> bool:
	return int(run.wins) >= 1


static func _rival_horse(run: Dictionary, race: Dictionary) -> Dictionary:
	var c = card(run.rival.cardId)
	var lvl: float = float(race.level) + RIVAL_EDGE + RIVAL_GROW * int(run.slot)
	var avg := 0.0
	for k in STATS:
		avg += float(c.v[k])
	avg /= 5.0
	var ab := {}
	for k in STATS:
		ab[k] = clampf_(lvl + (float(c.v[k]) - avg), 0.4, 0.95)
	return _with_skills({id = RIVAL_HORSE_ID, name = c.name, sex = c.sex, coat = c.coat, marks = c.marks, ab = ab, dist = c.dist, range = c.range,
		turf = c.turf, dirt = c.dirt, firm = c.firm, soft = c.soft, style = c.style, cardId = c.id, gear = clean_gear(c.get("gear"))}, skills_of(c).race, c.id, race, false)


## この時期に出られるレース（重賞は勝ち数と性で、条件戦は自分のクラス）。最大 4 つ。
static func race_options(run: Dictionary) -> Array:
	var slot: Dictionary = data().slots[int(run.slot)]
	var c = trainee_card(run)
	var cls := _class_of(run)
	var opts := []
	var age := int(slot.age)
	if slot.get("kind") != "debut" and int(run.wins) >= 1:
		var lo := _w(slot.from)
		var hi := _w(slot.to)
		var graded := (data().graded as Array).filter(func(r):
			return int(r.week) >= lo and int(r.week) <= hi and age >= int(r.age[0]) and age <= int(r.age[1]) \
				and (r.sex == null or r.sex == c.sex) and (r.grade != "GI" or int(run.wins) >= 2 or int(run.gradedWins) >= 1))
		var fit := func(r) -> float:
			return absf(float(r.distance) - float(c.dist)) / 400.0 + (1.2 if (r.surface == "ダート") != (c.dirt > c.turf) else 0.0) \
				- float({GI = 0.6, GII = 0.3, GIII = 0.1}.get(r.grade, 0.0))
		graded = Sim.stable_sort(graded, func(a, b): return fit.call(a) < fit.call(b))
		var top := graded.slice(0, 3)
		# 目標レースは 1 勝していれば出られる（優先出走）。合う順の 3 つから漏れても必ず候補に入れる
		var gid = run.goal.id if run.get("goal") != null and int(run.goal.slot) == int(run.slot) else null
		if gid != null and not top.any(func(r): return r.id == gid):
			for r in data().graded:
				if r.id == gid:
					top.push_front(r)
		for r in top:
			var o := {id = r.id, name = r.name, grade = r.grade, courseId = r.courseId, surface = r.surface, distance = int(r.distance),
				level = float(RACE_LEVEL[r.grade]) + (0.02 if int(r.age[1]) > 3 else 0.0) - (0.05 if age == 2 else 0.0)}
			if gid != null and r.id == gid:
				o.goal = true
			opts.append(o)
	var surf := "ダート" if c.dirt > c.turf else "芝"
	var max_d := 2000 if age == 2 else 9999
	var want := minf(float(c.dist), max_d)
	var cand := (data().combos as Array).filter(func(x): return x.surface == surf and int(x.distance) <= max_d)
	cand = Sim.stable_sort(cand, func(a, b): return absf(float(a.distance) - want) < absf(float(b.distance) - want))
	var rng = rng_of(["opts", run.seed, run.slot])
	var pick: Dictionary = cand[mini(cand.size() - 1, rng.int_n(mini(3, cand.size())))]
	var name := "オープン特別" if cls == "オープン" else "%d歳%s" % [age, cls]
	opts.append({id = "cond-%d" % int(run.slot), name = name, grade = "OP" if cls == "オープン" else "", courseId = pick.courseId, surface = pick.surface,
		distance = int(pick.distance), level = float(RACE_LEVEL[cls]) - (0.03 if age == 2 else 0.0)})
	var ground := ground_of(key(["ground", run.seed, run.slot]))
	for o in opts:
		o.ground = ground
	return opts


# ------------------------------------------------------------------ 育成の進行

## 育成を始める。breed = {sire, dam, name, style}。始められないときは理由の文字列を返す（空なら始めた）。
static func start_run(p: Dictionary, breed: Dictionary, support_ids: Array, memory_ids := []) -> String:
	var s = card(breed.get("sire"))
	var d = card(breed.get("dam"))
	if s == null or d == null or count_of(p, s.id) == 0 or count_of(p, d.id) == 0:
		return "そのカードを持っていない"
	if s.sex != "牡" or d.sex != "牝":
		return "父は牡、母は牝のカード"
	var nm := String(breed.get("name", "")).strip_edges()
	if nm.is_empty() or nm.length() > NAME_MAX:
		return "名前は 1〜%d 文字" % NAME_MAX
	var styles := foal_styles(s, d)
	var style: String = breed.get("style") if styles.has(breed.get("style")) else foal_default_style(s, d)
	if support_ids.size() != SUPPORT_SLOTS:
		return "サポートは %d 枚" % SUPPORT_SLOTS
	for id in support_ids:
		if count_of(p, id) == 0 or id == s.id or id == d.id:
			return "サポートに使えないカード"
	if memory_ids.size() > MEMORY_SLOTS:
		return "因子メモリーは %d 個まで（同じものは 1 つ）" % MEMORY_SLOTS
	var mems := []
	for mid in memory_ids:
		var m = find_memory(p, mid)
		if m == null:
			return "その因子メモリーは無い"
		for x in mems:
			if int(x.id) == int(mid):
				return "因子メモリーは %d 個まで（同じものは 1 つ）" % MEMORY_SLOTS
		mems.append({id = int(m.id), name = m.horse.name, stat = m.stat, val = int(m.val), skill = m.skill})
	var seed := Rng.hash_seed(key(["run", p.seed, p.nextId]))
	var frng = rng_of(["foal", seed])
	var sex := "牡" if frng.next() < 0.5 else "牝"
	var coat: String = s.coat if frng.next() < 0.5 else d.coat
	var ps := [awaken_of(count_of(p, s.id)), awaken_of(count_of(p, d.id))]
	var aw := {t = int(floor((ps[0] + ps[1]) / 2.0)), s = support_ids.map(func(id): return awaken_of(count_of(p, id))), ps = ps}
	var id := int(p.nextId)
	var c := bred_card({id = id, sire = s.id, dam = d.id, name = nm, style = style, sex = sex, coat = coat, aw = ps})
	var levels := {}
	for k in STATS:
		levels[k] = 1.0
	p.run = {
		id = id, seed = seed, trainee = null, sire = s.id, dam = d.id, name = nm, style = style, sex = sex, coat = coat,
		supports = support_ids.duplicate(),
		turn = 0, slot = 0, stats = _mem_stats(_init_stats(c, aw.t), mems), energy = 100, mood = 2, fans = 0, starts = 0, wins = 0, gradedWins = 0, giWins = 0,
		levels = levels, races = [], log = ["%s × %sの仔「%s」（%s・%s・%s）の育成を始めた" % [s.name, d.name, nm, sex, coat, style]],
		bonds = [0, 0, 0, 0], learned = [], awaken = aw, mem = mems,
	}
	p.nextId = id + 1
	var goal = goal_for(c)
	var rv = _pick_rival(c, [s.id, d.id] + support_ids, seed)
	if goal != null:
		p.run.goal = goal
		p.run.log.append("目標レース：%s（%s）" % [goal.name, data().slots[int(goal.slot)].label])
	if rv != null:
		p.run.rival = {cardId = rv, meets = rival_meets(goal), log = []}
		p.run.log.append("ライバル：%s" % card(rv).name)
	# 因子メモリー：レーススキルを最初から覚えている
	for m in mems:
		if m.skill != null and not run_skills(p.run).has(m.skill):
			p.run.learned.append(m.skill)
		p.run.log.append("因子メモリー「%s」：%s +%d%s" % [m.name, STAT_LABEL[m.stat], int(m.val), ("・" + String(skill_info(m.skill).name)) if m.skill != null else ""])
	return ""


static func _mem_stats(stats: Dictionary, mems: Array) -> Dictionary:
	for k in STATS:
		stats[k] = int(stats[k]) + mem_break(mems, k)
	return stats


static func aw_t(run: Dictionary) -> int:
	return int(run.get("awaken", {}).get("t", 0))


static func aw_s(run: Dictionary, i: int) -> int:
	var s: Array = run.get("awaken", {}).get("s", [])
	return int(s[i]) if i < s.size() else 0


static func bond_need(run: Dictionary, i: int) -> int:
	return 1 if aw_s(run, i) >= int(data().awaken.bondAt) else 2


static func is_race_turn(run: Dictionary) -> bool:
	return int(run.turn) % (TRAININGS_PER_RACE + 1) == TRAININGS_PER_RACE


static func run_done(run: Dictionary) -> bool:
	data()
	return int(run.turn) >= TOTAL_TURNS


static func turn_label(run: Dictionary) -> String:
	var slot: Dictionary = data().slots[mini(data().slots.size() - 1, int(run.turn) / (TRAININGS_PER_RACE + 1))]
	if is_race_turn(run):
		return "%s（レース）" % slot.label
	return "%s（練習 %d/%d）" % [slot.label, int(run.turn) % (TRAININGS_PER_RACE + 1) + 1, TRAININGS_PER_RACE]


## このターンの練習場に誰が来ているか（(シード, ターン) から決まる）。
static func training_board(run: Dictionary) -> Dictionary:
	var rng = rng_of(["board", run.seed, run.turn])
	var at := {}
	for k in STATS:
		at[k] = []
	for i in run.supports.size():
		var c = card(run.supports[i])
		var often: bool = skills_of(c, aw_s(run, i)).support.has("often")
		if rng.next() < maxf(0.01, (0.04 if often else 0.18) - float(data().awaken.show) * aw_s(run, i)):
			continue
		var k: String = c.supportType if rng.next() < 0.5 else STATS[rng.int_n(STATS.size())]
		at[k].append(i)
	return at


static func training_preview(run: Dictionary, kind: String) -> Dictionary:
	var t = trainee_card(run)
	var plus: Dictionary = t.plus
	var tr: Dictionary = TRAIN[kind]
	var idx: Array = training_board(run)[kind]
	var here := idx.map(func(i): return card(run.supports[i]))
	var mul: float = MOOD_MUL[int(run.mood)] * (1 + 0.12 * here.size()) * (1 + 0.08 * (float(run.levels[kind]) - 1))
	var cost: int = tr.cost
	var fail_mul := 1.0
	var fired := []
	for j in here.size():
		var c: Dictionary = here[j]
		var aw := aw_s(run, idx[j])
		var sk: Array = skills_of(c, aw).support
		var friend: bool = c.supportType == kind
		if friend:
			mul *= 1.15 + 0.25 * (float(RAR_BONUS[c.rar]) - 1) * 2 + (0.15 if sk.has("friend") else 0.0) + float(data().awaken.friend) * aw
		if sk.has("tr_" + kind):
			mul *= 1 + 0.2 * float(RAR_SCALE[c.rar])
			fired.append(skill_info("tr_" + kind).name)
		if friend and sk.has("friend"):
			fired.append(skill_info("friend").name)
		if sk.has("saver") and kind != "wit":
			cost = maxi(5, cost - 5)
			fired.append(skill_info("saver").name)
		if sk.has("safe"):
			fail_mul *= 0.5
			fired.append(skill_info("safe").name)
		if sk.has("mood"):
			fired.append(skill_info("mood").name)
	var gains := {}
	var base := 30.0
	gains[tr.main] = jround(base * mul * (0.85 + float(plus[tr.main]) * 0.1))
	for k in tr.sub:
		gains[k] = jround(base * float(tr.sub[k]) * mul * (0.85 + float(plus[k]) * 0.1))
	var energy := float(run.energy)
	var fail := 0.0 if (energy >= 50 or kind == "wit") else minf(0.6, ((50 - energy) / 50.0) * 0.6) * fail_mul
	var friends := here.filter(func(c): return c.supportType == kind)
	var uniq := []
	for f in fired:
		if not uniq.has(f):
			uniq.append(f)
	var mood_up := false
	for j in here.size():
		if skills_of(here[j], aw_s(run, idx[j])).support.has("mood"):
			mood_up = true
	return {gains = gains, fail = fail, cost = cost, supports = here.map(func(c): return c.id), friendship = friends.size(),
		friends = friends.map(func(c): return c.id), skills = uniq, mood = mood_up}


static func _add_stats(run: Dictionary, gains: Dictionary) -> void:
	var plus: Dictionary = trainee_card(run).plus
	for k in gains:
		run.stats[k] = maxi(0, mini(run_cap(run, k, int(plus[k])), int(run.stats[k]) + int(gains[k])))


## 育成中の馬の上限（カードの +値と覚醒に、編成した因子メモリーの上乗せを足す）
static func run_cap(run: Dictionary, k: String, plus := -1) -> int:
	if plus < 0:
		plus = int(trainee_card(run).plus[k])
	return cap_of(plus, aw_t(run)) + mem_break(run.get("mem", []), k)


## 因子メモリーの上乗せ（☆×MEM_STEP の合計、MEM_BREAK まで）。上限はこのぶん 1200 を超えて突破する
static func mem_break(mems: Array, k: String) -> int:
	var add := 0
	for m in mems:
		if m.stat == k:
			add += int(m.val)
	return mini(MEM_BREAK, add)


static func run_skills(run: Dictionary) -> Array:
	var tc := trainee_card(run)
	var out: Array = (tc.raceSkills if tc.get("bred", false) else skills_of(tc, aw_t(run)).race as Array).duplicate()
	out.append_array(run.get("learned", []))
	return out


static func train(run: Dictionary, kind: String) -> String:
	var p := training_preview(run, kind)
	var rng = rng_of(["train", run.seed, run.turn])
	var msg := ""
	if rng.next() < p.fail:
		run.mood = maxi(0, int(run.mood) - 1)
		_add_stats(run, {kind: -10})
		run.energy = maxi(0, int(run.energy) - 5)
		msg = "%sの練習に失敗した（体力が足りない）" % STAT_LABEL[kind]
	else:
		_add_stats(run, p.gains)
		run.levels[kind] = minf(5.0, float(run.levels[kind]) + 0.25)
		run.energy = mini(100, int(run.energy) + 5) if kind == "wit" else maxi(0, int(run.energy) - int(p.cost))
		var parts := []
		for k in p.gains:
			parts.append("%s+%d" % [STAT_SHORT[k], int(p.gains[k])])
		msg = "%sの練習 %s%s" % [STAT_LABEL[kind], " ".join(parts), "（友情）" if p.friendship > 0 else ""]
		if p.supports.size() > 0 and rng.next() < (0.35 if p.mood else 0.12):
			run.mood = mini(4, int(run.mood) + 1)
			msg += "・気分が上がった"
		for id in p.friends:
			var i: int = run.supports.find(id)
			if i < 0:
				continue
			run.bonds[i] = int(run.bonds[i]) + 1
			var learned: Array = run.learned
			var mine := run_skills(run)
			var sk = null
			for x in skills_of(card(id), aw_s(run, i)).race:
				if not learned.has(x) and not mine.has(x):
					sk = x
					break
			if int(run.bonds[i]) == bond_need(run, i) and sk != null:
				learned.append(sk)
				msg += "・%sから「%s」を覚えた" % [card(id).name, skill_info(sk).name]
	run.log.append(msg)
	run.turn = int(run.turn) + 1
	return msg


static func rest(run: Dictionary) -> String:
	var rng = rng_of(["rest", run.seed, run.turn])
	var gain := 70 if rng.next() < 0.25 else 50
	run.energy = mini(100, int(run.energy) + gain)
	if rng.next() < 0.2:
		run.mood = mini(4, int(run.mood) + 1)
	var msg := "休んだ（体力 +%d）" % gain
	run.log.append(msg)
	run.turn = int(run.turn) + 1
	return msg


# ------------------------------------------------------------------ レース

## 出走馬の形 → レースの計算に渡す馬（runnerHorse）。createHorse が毛色を 1 回引くので、ここでも 1 回引く。
static func _runner_horse(f: Dictionary, year: int, rng) -> Dictionary:
	var coat0 = rng.weighted(data().params.COATS, [40, 18, 16, 3, 10, 7, 3, 0])
	var r = f.get("range")
	return {
		id = f.id, name = f.name, sex = f.sex, birthYear = year - 4, coat = f.get("coat", coat0) if f.get("coat") != null else coat0,
		cur = (f.ab as Dictionary).duplicate(), dist = float(f.dist), distRange = float(r) if r != null else 400.0,
		turf = float(f.turf), dirt = float(f.dirt), firm = float(f.get("firm", 0.8)) if f.get("firm") != null else 0.8,
		soft = float(f.get("soft")) if f.get("soft") != null else 0.5, style = float(f.get("style")) if f.get("style") != null else 0.5,
		temper = 0.6, spirit = 0.6, fit = 1.0, cond = 0.7, fatigue = 0.0,
	}.merged({raceGear = f.gear, gearTemper = GEAR_TEMPER} if (f.get("gear") is Dictionary and not (f.gear as Dictionary).is_empty()) else {})


static func _npc_horse(rng, i: int, level: float, race: Dictionary) -> Dictionary:
	var ab := {}
	for k in STATS:
		ab[k] = clampf_(rng.normal(level, 0.035), 0.3, 0.95)
	var head: String = rng.pick(NPC_HEAD)
	var nm: String = rng.pick(NPC_NAMES)
	var sex := "牝" if rng.chance(0.3) else "牡"
	var coat: String = rng.pick(NPC_COATS)
	var dirt: bool = race.surface == "ダート"
	var dist := clampf_(float(race.distance) + rng.normal(0, 250), 1000, 3600)
	var soft: float = rng.range_f(0.45, 0.8)
	var style: float = rng.next()
	return {id = 2000001000 + i, name = head + nm, sex = sex, coat = coat, ab = ab, dist = dist, range = 450,
		turf = 0.5 if dirt else 0.85, dirt = 0.85 if dirt else 0.45, firm = 0.8, soft = soft, style = style}


## レースを 1 つ走らせる。走行ログ付きの結果（3D で観られる）。
static func run_race(race: Dictionary, field: Array, seed_key: String, year := 2026) -> Dictionary:
	var rng = Rng.make(Rng.hash_seed(seed_key))
	var horses := field.map(func(f): return _runner_horse(f, year, rng))
	var n := horses.size()
	var entries := []
	for i in n:
		entries.append({horse = horses[i], weight = 55 if horses[i].sex == "牝" else 57, gate = i + 1, frame = mini(8, int(ceil((float(i + 1) / n) * 8)))})
	for i in range(n - 1, 0, -1):
		var j: int = rng.int_n(i + 1)
		var tmp = entries[i].horse
		entries[i].horse = entries[j].horse
		entries[j].horse = tmp
	var course: Dictionary = data().courses[race.courseId]
	var res := Sim.simulate({name = race.name, courseId = race.courseId, surface = race.surface, distance = int(race.distance),
		ground = race.get("ground", "良"), year = year, entries = entries}, rng, data().params, course, true)
	res.field = field
	res.race = race
	return res


static func trainee_spec(run: Dictionary) -> Dictionary:
	var c = trainee_card(run)
	var ab := {}
	for k in STATS:
		ab[k] = ability_of(float(run.stats[k]))
	return {id = 1, name = c.name, sex = c.sex, coat = c.coat, ab = ab, dist = c.dist, range = c.range, turf = c.turf, dirt = c.dirt,
		firm = c.firm, soft = c.soft, style = _style_value(run, float(c.style)), cardId = null if c.get("bred", false) else c.id, gear = run_gear(run)}


## src はカード id か、{rar, unique}（配合の馬：レア度と固有を受け継いだ LM の親）。
static func _with_skills(spec: Dictionary, skills: Array, src, race: Dictionary, battle: bool, aw := 0, lock = null) -> Dictionary:
	if src is Dictionary:
		var u = card(src.unique) if src.get("unique") != null else null
		return apply_race_skills(spec, skills, race, battle, src.rar, u, aw, lock)
	var c = card(src) if src != null else null
	return apply_race_skills(spec, skills, race, battle, c.rar if c != null else "N", c if (c != null and c.rar == "LM") else null, aw, lock)


static func _run_src(run: Dictionary) -> Variant:
	var c := trainee_card(run)
	return {rar = c.rar, unique = c.unique} if c.get("bred", false) else c.id


static func _horse_src(h: Dictionary) -> Variant:
	return h.cardId if h.get("cardId") != null else {rar = h.rar, unique = h.get("unique")}


## 今のターンのレースに出る。結果を返し、育成を次のターンへ進める。
static func race_turn(run: Dictionary, choice: String, style = null) -> Dictionary:
	set_race_style(run, style)
	var opts := race_options(run)
	var race: Dictionary = opts[opts.size() - 1]
	for o in opts:
		if o.id == choice:
			race = o
	var rng = rng_of(["field", run.seed, run.slot])
	var n := 16 if race.grade == "GI" else 12
	var sp := trainee_spec(run)
	var me0 := _with_skills(sp, run_skills(run), _run_src(run), race, false, aw_t(run), sp.style)
	var field := [me0.spec]
	for i in range(1, n):
		field.append(_npc_horse(rng, i, race.level, race))
	# ライバルは出馬表を作り終えてから最後の 1 頭と入れ替える（ほかの馬の乱数は変えない）
	var rv = _rival_horse(run, race) if rival_meets_now(run) else null
	if rv != null:
		field[field.size() - 1] = rv.spec
	var res := run_race(race, field, key(["race", run.seed, run.slot]))
	var me: Dictionary = res.results.filter(func(r): return int(r.horseId) == 1)[0]
	var order: int = me.order
	var rv_row = null
	if rv != null:
		rv_row = res.results.filter(func(r): return int(r.horseId) == RIVAL_HORSE_ID)[0]
		run.rival.log.append({slot = int(run.slot), me = order, rv = int(rv_row.order), race = race.name})
	var is_goal: bool = run.get("goal") != null and race.id == run.goal.id
	if is_goal:
		run.goal.tried = true
		run.goal.done = order == 1
	run.starts = int(run.starts) + 1
	var bonus := 20 if order == 1 else (12 if order <= 3 else (6 if order <= 5 else 3))
	var grade_mul: float = {GI = 1.6, GII = 1.3, GIII = 1.15, OP = 1.05}.get(race.grade, 1.0)
	var g := {}
	for k in STATS:
		g[k] = jround(bonus * grade_mul)
	_add_stats(run, g)
	run.fans = int(run.fans) + jround((3000 if order == 1 else (1200 if order <= 3 else 300)) * grade_mul)
	if order == 1:
		run.wins = int(run.wins) + 1
		if String(race.grade).begins_with("G"):
			run.gradedWins = int(run.gradedWins) + 1
		if race.grade == "GI":
			run.giWins = int(run.giWins) + 1
		run.mood = mini(4, int(run.mood) + 1)
	elif order > 5:
		run.mood = maxi(0, int(run.mood) - 1)
	run.energy = maxi(0, int(run.energy) - 15)
	run.races.append({slot = int(run.slot), name = race.name, grade = race.grade, courseId = race.courseId, surface = race.surface,
		distance = race.distance, ground = race.ground, order = order, field = res.results.size(), time = me.time, skills = me0.fired})
	run.log.append("%s %d着（%d頭）%s" % [race.name, order, res.results.size(), ("　発動：" + "・".join(me0.fired)) if me0.fired.size() > 0 else ""])
	if rv_row != null:
		run.log.append("ライバル%sは %d着（%s）" % [rv_row.name, int(rv_row.order), "先着" if order < int(rv_row.order) else "後れを取った"])
	if is_goal:
		run.log.append(("目標の%sを勝った！" % race.name) if order == 1 else ("目標の%sは %d着" % [race.name, order]))
	run.turn = int(run.turn) + 1
	run.slot = int(run.slot) + 1
	var fired := {1: me0.fired}
	if rv != null:
		fired[RIVAL_HORSE_ID] = rv.fired
	return {race = race, result = res, order = order, fired = fired, field = field,
		rival = {name = rv_row.name, order = int(rv_row.order), cardId = run.rival.cardId} if rv_row != null else null,
		goal = ("done" if order == 1 else "missed") if is_goal else ""}


# ------------------------------------------------------------------ 完成

static func rating_of(h: Dictionary) -> int:
	var s := 0
	for k in STATS:
		s += int(h.stats[k])
	var g = h.get("goal")
	return s + int(h.wins) * 20 + int(h.giWins) * 60 + (GOAL_BONUS if g != null and g.get("done", false) else 0)


static func rank_of(rating: float) -> String:
	for t in [[5200, "SS"], [4600, "S"], [4000, "A+"], [3500, "A"], [3000, "B+"], [2500, "B"], [2000, "C+"], [1500, "C"], [0, "D"]]:
		if rating >= t[0]:
			return t[1]
	return "D"


static func finish_run(p: Dictionary) -> Dictionary:
	var h := _close_run(p)
	p.finished.append(h)
	return h


# ------------------------------------------------------------------ 因子メモリー
# 育成を終えた馬を完成馬にせず、能力 1 つ（点の 8%）とレーススキル 1 つを抜き出したメモリーにする。JS の finishRunAsMemory と同じ。

const MEMORY_SLOTS := 2
const MEMORY_MAX := 60


const MEM_STEP := 20
const MEM_BREAK := 100
const PTS_MAX := 1200 + MEM_BREAK


static func memories_of(p: Dictionary) -> Array:
	return p.get("memories", []) if p.get("memories") != null else []


static func find_memory(p: Dictionary, id) -> Variant:
	for m in memories_of(p):
		if int(m.id) == int(id):
			return m
	return null


static func finish_run_as_memory(p: Dictionary) -> Dictionary:
	if memories_of(p).size() >= MEMORY_MAX:
		return {}
	var skills := run_skills(p.run)
	var h := _close_run(p)
	var rng = rng_of(["memory", p.seed, int(h.id)])
	var stat: String = STATS[rng.int_n(STATS.size())]
	var skill = skills[rng.int_n(skills.size())] if not skills.is_empty() else null
	var star: int = 1 + rng.int_n(5)
	var m := {id = int(h.id), stat = stat, star = star, val = star * MEM_STEP, skill = skill, horse = h}
	p.memories = memories_of(p) + [m]
	return m


static func drop_memory(p: Dictionary, id) -> void:
	p.memories = memories_of(p).filter(func(m): return int(m.id) != int(id))


static func _close_run(p: Dictionary) -> Dictionary:
	var run: Dictionary = p.run
	var c = trainee_card(run)
	var bred: bool = c.get("bred", false)
	var h := {
		id = int(run.id), cardId = null if bred else c.id, name = c.name, sex = c.sex, coat = c.coat, rar = c.rar, stats = (run.stats as Dictionary).duplicate(),
		dist = c.dist, range = c.range, turf = c.turf, dirt = c.dirt, firm = c.firm, soft = c.soft, style = c.style,
		starts = run.starts, wins = run.wins, gradedWins = run.gradedWins, giWins = run.giWins, fans = run.fans,
		races = run.races, supports = run.supports, battles = 0, battleWins = 0, skills = run_skills(run), awaken = aw_t(run), gear = run_gear(run),
	}
	if bred:
		h.sire = c.sireId
		h.dam = c.damId
		h.unique = c.unique
	if run.get("goal") != null:
		h.goal = {id = run.goal.id, name = run.goal.name, done = bool(run.goal.done)}
	if run.get("rival") != null:
		var rr := rival_record(run)
		h.rival = {cardId = run.rival.cardId, won = rr.won, lost = rr.lost}
	h.rating = rating_of(h)
	h.rank = rank_of(h.rating)
	# ミッション：初めて編成したカードは 1 枚ごとにウイコイン 1 枚
	var gain := mission_gain(p, run)
	p.missions = missions_of(p) + gain
	p.coins = coins_of(p) + gain.size() + (GOAL_COINS if run.get("goal") != null and run.goal.done else 0)
	p.run = null
	return h


static func finished_skills(h: Dictionary) -> Array:
	if h.has("skills"):
		return h.skills
	var c = card(h.cardId)
	return skills_of(c).race if c != null else []


static func finished_spec(h: Dictionary, i := 0) -> Dictionary:
	var ab := {}
	for k in STATS:
		ab[k] = ability_of(float(h.stats[k]))
	return {id = 100 + i, name = h.name, sex = h.sex, coat = h.coat, ab = ab, dist = h.dist, range = h.range, turf = h.turf, dirt = h.dirt,
		firm = h.firm, soft = h.soft, style = _style_value(h, float(h.style)), fid = h.id, cardId = h.cardId, gear = horse_gear(h)}


static func find_finished(p: Dictionary, id) -> Variant:
	for h in p.finished:
		if int(h.id) == int(id):
			return h
	return null


# ------------------------------------------------------------------ 対戦

static func battle_races() -> Array:
	return data().battleRaces


## NPC のランク戦。相手は全カードの名馬を、自分の馬の能力の平均に難しさを足した帯へ合わせた完成馬。
static func battle_npc(p: Dictionary, horse_id, race_id: String, diff := "normal", style = null) -> Dictionary:
	var me: Dictionary = find_finished(p, horse_id)
	set_race_style(me, style)
	var race0: Dictionary = battle_races()[0]
	for r in battle_races():
		if r.id == race_id:
			race0 = r
	var race := race0.duplicate()
	race.ground = ground_of(key(["bground", p.seed, p.battles]))
	var rng = rng_of(["battle", p.seed, p.battles])
	var my_avg := 0.0
	for k in STATS:
		my_avg += ability_of(float(me.stats[k]))
	my_avg /= 5.0
	var level := clampf_(my_avg + float(data().difficulty[diff].d), 0.55, 0.92)
	var pool := cards().filter(func(c): return c.name != me.name and ((race.surface == "ダート") == (c.dirt > c.turf)))
	var ms := finished_spec(me, 0)
	var mine0 := _with_skills(ms, finished_skills(me), _horse_src(me), race, true, int(me.get("awaken", 0)), ms.style)
	var field := [mine0.spec]
	var fired := {100: mine0.fired}
	var used := {}
	for i in range(1, 12):
		var c: Dictionary = pool[rng.int_n(pool.size())]
		var t := 0
		while t < 5 and used.has(c.id):
			c = pool[rng.int_n(pool.size())]
			t += 1
		used[c.id] = true
		var avg := 0.0
		for k in STATS:
			avg += float(c.v[k])
		avg /= 5.0
		var ab := {}
		for k in STATS:
			ab[k] = clampf_(level + (float(c.v[k]) - avg) + rng.normal(0, 0.015), 0.4, 0.95)
		var npc := _with_skills({id = 200 + i, name = c.name, sex = c.sex, coat = c.coat, marks = c.marks, ab = ab, dist = c.dist, range = c.range,
			turf = c.turf, dirt = c.dirt, firm = c.firm, soft = c.soft, style = c.style, cardId = c.id, gear = clean_gear(c.get("gear"))}, skills_of(c).race, c.id, race, true)
		field.append(npc.spec)
		fired[200 + i] = npc.fired
	var res := run_race(race, field, key(["battle", p.seed, p.battles]))
	p.battles = int(p.battles) + 1
	var mine: Dictionary = res.results.filter(func(r): return int(r.horseId) == 100)[0]
	me.battles = int(me.battles) + 1
	if int(mine.order) == 1:
		me.battleWins = int(me.battleWins) + 1
	return {race = race, result = res, field = field, order = mine.order, fired = fired}


static func event_state(p: Dictionary, id: String) -> Dictionary:
	return p.get("events", {}).get(id, {cleared = [], tries = 0})


## イベントレース。相手は史実の出走馬に難易度の差を足した強さ。各難易度の初勝利で報酬のカードを 1 枚。
static func event_race(p: Dictionary, horse_id, event_id: String, star: int, style = null) -> Dictionary:
	var ev: Dictionary = data().events.filter(func(e): return e.id == event_id)[0]
	var me: Dictionary = find_finished(p, horse_id)
	set_race_style(me, style)
	star = clampi(star, 1, 5)
	if not p.has("events"):
		p.events = {}
	if not p.events.has(event_id):
		p.events[event_id] = {cleared = [], tries = 0}
	var st: Dictionary = p.events[event_id]
	var race: Dictionary = (ev.race as Dictionary).duplicate()
	var k := key(["event", p.seed, event_id, st.tries])
	var rng = Rng.make(Rng.hash_seed(k))
	var ms := finished_spec(me, 0)
	var mine0 := _with_skills(ms, finished_skills(me), _horse_src(me), race, true, int(me.get("awaken", 0)), ms.style)
	var field := [mine0.spec]
	var fired := {100: mine0.fired}
	var sd: float = data().starD[str(star)]
	for i in ev.field.size():
		var m: Dictionary = ev.field[i]
		var ab := {}
		for s in STATS:
			ab[s] = clampf_(float(m.ab[s]) + sd + rng.normal(0, 0.008), 0.4, 0.95)
		var c = card(m.cardId) if m.get("cardId") != null else null
		var spec := {id = 200 + i, name = m.name, sex = m.sex, coat = m.coat, marks = c.marks if c != null else null, ab = ab, dist = m.dist, range = m.range,
			turf = float(m.get("turf", 0.9)), dirt = float(m.get("dirt", 0.4)), firm = 0.8, soft = m.soft, style = m.style, cardId = c.id if c != null else null, gear = clean_gear(c.get("gear") if c != null else null)}
		var x := _with_skills(spec, skills_of(c).race, c.id, race, true) if c != null else {spec = spec, fired = []}
		field.append(x.spec)
		fired[200 + i] = x.fired
	var res := run_race(race, field, k, int(ev.year))
	st.tries = int(st.tries) + 1
	var mine: Dictionary = res.results.filter(func(r): return int(r.horseId) == 100)[0]
	me.battles = int(me.battles) + 1
	var reward = null
	if int(mine.order) == 1:
		me.battleWins = int(me.battleWins) + 1
		var cleared: Array = st.cleared
		if not cleared.has(star) and not cleared.has(float(star)):
			cleared.append(star)
			cleared.sort()
			var c = card(ev.reward)
			var is_new := count_of(p, c.id) == 0
			p.cards[c.id] = count_of(p, c.id) + 1
			reward = {card = c, isNew = is_new, awaken = count_of(p, c.id) - 1, star = star}
	return {race = race, result = res, field = field, order = mine.order, fired = fired, reward = reward, star = star}


# ------------------------------------------------------------------ ライバルレース

static func _rival_st(p: Dictionary) -> Dictionary:
	if p.get("rival") == null:
		p.rival = {day = null, got = 0, cleared = [], tries = 0}
	return p.rival


## 今日の進み（today は 'YYYY-MM-DD'。日が変わっていれば今日の分は 0 から）。
static func rival_state(p: Dictionary, today: String) -> Dictionary:
	var st: Dictionary = p.get("rival") if p.get("rival") != null else {day = null, got = 0, cleared = [], tries = 0}
	var got := int(st.got) if st.day == today else 0
	return {cleared = st.cleared, tries = int(st.tries), got = got, left = maxi(0, int(data().rival.daily) - got)}


static func _rival_cleared(st: Dictionary, star: int) -> bool:
	return (st.cleared as Array).has(star) or (st.cleared as Array).has(float(star))


static func _rival_pay(p: Dictionary, today: String, star: int) -> int:
	var st := _rival_st(p)
	if st.day != today:
		st.day = today
		st.got = 0
	var n := mini(int(data().rival.coins[str(star)]), int(data().rival.daily) - int(st.got))
	st.got = int(st.got) + n
	p.coins = coins_of(p) + n
	return n


## ライバルレース。相手は名馬のカード（LM・SSR・SR、舞台の馬場に向いた馬）を難易度の強さにした 9 頭。勝つとウイコイン（1 日の上限まで）。
static func rival_race(p: Dictionary, horse_id, race_id: String, star: int, today: String, style = null) -> Dictionary:
	var me: Dictionary = find_finished(p, horse_id)
	set_race_style(me, style)
	star = clampi(star, 1, 5)
	var st := _rival_st(p)
	var race0: Dictionary = battle_races()[0]
	for r in battle_races():
		if r.id == race_id:
			race0 = r
	var k := key(["rival", p.seed, st.tries])
	var race := race0.duplicate()
	race.ground = ground_of(key(["rground", p.seed, st.tries]))
	var rng = Rng.make(Rng.hash_seed(k))
	var dirt: bool = race.surface == "ダート"
	var pool := cards().filter(func(c): return in_packs(c) and ["LM", "SSR", "SR"].has(c.rar) and c.name != me.name and (dirt == (c.dirt > c.turf)))
	var level: float = data().rival.level[str(star)]
	var ms := finished_spec(me, 0)
	var mine0 := _with_skills(ms, finished_skills(me), _horse_src(me), race, true, int(me.get("awaken", 0)), ms.style)
	var field := [mine0.spec]
	var fired := {100: mine0.fired}
	var used := {}
	for i in range(1, int(data().rival.field)):
		var c: Dictionary = pool[rng.int_n(pool.size())]
		var t := 0
		while t < 8 and used.has(c.id):
			c = pool[rng.int_n(pool.size())]
			t += 1
		used[c.id] = true
		var avg := 0.0
		for s in STATS:
			avg += float(c.v[s])
		avg /= 5.0
		var ab := {}
		for s in STATS:
			ab[s] = clampf_(level + (float(c.v[s]) - avg) + rng.normal(0, 0.012), 0.4, 0.95)
		var npc := _with_skills({id = 200 + i, name = c.name, sex = c.sex, coat = c.coat, marks = c.marks, ab = ab, dist = c.dist, range = c.range,
			turf = c.turf, dirt = c.dirt, firm = c.firm, soft = c.soft, style = c.style, cardId = c.id, gear = clean_gear(c.get("gear"))}, skills_of(c).race, c.id, race, true)
		field.append(npc.spec)
		fired[200 + i] = npc.fired
	var res := run_race(race, field, k)
	st.tries = int(st.tries) + 1
	var mine: Dictionary = res.results.filter(func(r): return int(r.horseId) == 100)[0]
	me.battles = int(me.battles) + 1
	var coins := 0
	var first := false
	if int(mine.order) == 1:
		me.battleWins = int(me.battleWins) + 1
		if not _rival_cleared(st, star):
			st.cleared.append(star)
			st.cleared.sort()
			first = true
		coins = _rival_pay(p, today, star)
	return {race = race, result = res, field = field, order = mine.order, fired = fired, star = star, coins = coins, first = first}


## 勝った難易度は走らずに勝ったことにする（今日の上限まで）。できないなら理由。
static func can_rival_skip(p: Dictionary, star: int, today: String) -> String:
	var s := rival_state(p, today)
	if not ((s.cleared as Array).has(star) or (s.cleared as Array).has(float(star))):
		return "まだ勝っていない難易度"
	if int(s.left) <= 0:
		return "今日のウイコインは受け取り済み"
	return ""


static func rival_skip(p: Dictionary, star: int, today: String) -> int:
	if can_rival_skip(p, star, today) != "":
		return 0
	return _rival_pay(p, today, star)


## 自分の完成馬どうしの対戦（2〜16 頭）。
static func battle_own(p: Dictionary, horse_ids: Array, race_id: String) -> Dictionary:
	var race0: Dictionary = battle_races()[0]
	for r in battle_races():
		if r.id == race_id:
			race0 = r
	var race := race0.duplicate()
	race.ground = ground_of(key(["bground", p.seed, p.battles]))
	var list := []
	for id in horse_ids:
		var h = find_finished(p, id)
		if h != null and list.size() < 16:
			list.append(h)
	var fired := {}
	var field := []
	for i in list.size():
		var hs := finished_spec(list[i], i)
		var x := _with_skills(hs, finished_skills(list[i]), _horse_src(list[i]), race, true, int(list[i].get("awaken", 0)), hs.style)
		fired[100 + i] = x.fired
		field.append(x.spec)
	var res := run_race(race, field, key(["own", p.seed, p.battles]))
	p.battles = int(p.battles) + 1
	for r in res.results:
		var i := int(r.horseId) - 100
		if i < 0 or i >= list.size():
			continue
		list[i].battles = int(list[i].battles) + 1
		if int(r.order) == 1:
			list[i].battleWins = int(list[i].battleWins) + 1
	return {race = race, result = res, field = field, fired = fired}
