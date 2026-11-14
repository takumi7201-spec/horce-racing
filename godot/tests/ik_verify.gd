extends SceneTree
## tools/verify-godot-ikusei.mjs から呼ぶ。JS（src/sim/ikusei.js）と同じ筋書きを GDScript の移植で回し、結果を JSON で書く。
## 筋書きは verify-godot-ikusei.mjs の scenario() と同じ（決まった手で 30 回引き、1 頭育て、対戦とイベントを走る）。

const IK := preload("res://scripts/ik/ikusei.gd")


func _init() -> void:
	var out_path := "/tmp/ik_gd.json"
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--out="):
			out_path = a.substr(6)
	var seeds := [11, 2026, 777]
	var outs := []
	var t0 := Time.get_ticks_msec()
	for sd in seeds:
		outs.append(scenario(sd))
	var races := []
	for r in IK.battle_races():
		races.append(race_check(r))
	var f := FileAccess.open(out_path, FileAccess.WRITE)
	f.store_string(JSON.stringify({scenarios = outs, races = races, ms = Time.get_ticks_msec() - t0}))
	f.close()
	print("ok ", Time.get_ticks_msec() - t0, "ms")
	quit()


func orders(res: Dictionary) -> Array:
	return res.results.map(func(r): return [int(r.horseId), snappedf(r.time, 0.001)])


func scenario(seed: int) -> Dictionary:
	var p := IK.new_profile(seed)
	IK.roll_quests(p, "2026-11-07")
	var pulls := IK.pull(p, 30).map(func(g): return g.card.id)
	var own := IK.owned(p)
	# 育成馬は配合（最初の牡 × 最初の牝）。脚質は選べるうちのいちばん後ろ（脚質のスキルの受け継ぎも見る）
	var sire: Dictionary = own.filter(func(c): return c.sex == "牡")[0]
	var dam: Dictionary = own.filter(func(c): return c.sex == "牝")[0]
	var sup := []
	for c in own:
		if sup.size() < 4 and c.id != sire.id and c.id != dam.id:
			sup.append(c.id)
	var styles := IK.foal_styles(sire, dam)
	var err := IK.start_run(p, {sire = sire.id, dam = dam.id, name = IK.foal_name_idea(sire, dam), style = styles[styles.size() - 1]}, sup)
	assert(err == "", err)
	IK.set_run_gear(p.run, {menko = "#c8202a", blinker = true, shadowRoll = "#f4f2ec"})
	var run: Dictionary = p.run
	var steps := []
	while not IK.run_done(run):
		var ev = IK.pending_event(run)
		if ev != null:
			var m := IK.resolve_event(run, int(run.turn) % 2)
			steps.append(["event", ev.id, ev.support, m, int(run.energy), int(run.mood), (run.stats as Dictionary).duplicate()])
		if IK.is_race_turn(run):
			var opts := IK.race_options(run)
			var r := IK.race_turn(run, opts[0].id, IK.STYLE_NAMES[int(run.slot) % 4] if int(run.slot) % 3 == 2 else null)
			steps.append(["race", r.race.id, r.race.ground, r.order, orders(r.result)])
		elif int(run.energy) < 45:
			steps.append(["rest", IK.rest(run)])
		else:
			var best := ""
			var bv := -1
			for k in IK.STATS:
				var pv := IK.training_preview(run, k)
				var s := 0
				for g in pv.gains:
					s += int(pv.gains[g])
				if s > bv:
					bv = s
					best = k
			steps.append(["train", IK.train(run, best)])
	var rlog := []
	for x in (run.rival.log if run.get("rival") != null else []):
		rlog.append([int(x.slot), int(x.me), int(x.rv)])
	var goalrival := [run.goal.id if run.get("goal") != null else null, int(run.goal.slot) if run.get("goal") != null else null, bool(run.goal.done) if run.get("goal") != null else false,
		run.rival.cardId if run.get("rival") != null else null, run.rival.meets if run.get("rival") != null else null, rlog]
	var pm: Dictionary = p.duplicate(true)
	var mm := IK.finish_run_as_memory(pm)
	IK.start_run(pm, {sire = sire.id, dam = dam.id, name = "メモリー"}, sup, [mm.id])
	var memory := [mm.stat, mm.star, mm.val, mm.skill, pm.run.stats, pm.run.learned, IK.run_cap(pm.run, mm.stat)]
	var h := IK.finish_run(p)
	var b := IK.battle_npc(p, h.id, "japan-cup", "normal")
	var e := IK.event_race(p, h.id, "arc1999", 1)
	var e2 := IK.event_race(p, h.id, "bc1989", 3)
	# ライバルレース（☆2、勝てば次の日に同じ☆をスキップ）とウイコインの残高
	var rv := IK.rival_race(p, h.id, "arima-kinen", 2, "2026-11-07")
	var qs := IK.quest_state(p, "2026-11-07")
	var claimed := IK.claim_all_quests(p, "2026-11-07")
	var skip := IK.rival_skip(p, 2, "2026-11-08")
	IK.roll_quests(p, "2026-11-08")
	var e3 := IK.event_race(p, h.id, "arima1990", 2)
	var b2 := IK.battle_npc(p, h.id, "arima-kinen", "legend")
	var qs2 := IK.quest_state(p, "2026-11-08")
	var hall := [IK.set_hall(p, h.id, true) == "", IK.hall_of(p)]
	var rel := IK.release_finished(p, h.id)
	var rec := IK.rec_of(p)
	var qv := func(q: Dictionary) -> Array:
		var out := []
		for x in q.daily + q.weekly:
			out.append([x.id, int(x.have), x.got, x.ready])
		return out
	var rk := []
	for k in ["runs", "starts", "wins", "giWins", "goals", "battles", "battleWins", "rank", "rankw", "rival", "rivalw", "rival3w", "event", "eventw"]:
		rk.append(int(rec.get(k, 0)))
	var fast := []
	var fk: Array = rec.get("fast", {}).keys()
	fk.sort()
	for k in fk:
		var f: Dictionary = rec.fast[k]
		fast.append([k, IK.jround(float(f.t) * 100), f.horse, f.race, f.mode, f.ground])
	var extra := {
		combo = [run.get("combo"), IK.combo_of(["P1-01", "P1-02", "P1-05", "P1-06", "P1-07", "P1-03"]), IK.combo_of(["EV-03", "P1-19", "P4-36", "P1-17", "P2-01", "P3-01"])],
		ladder = [b.rank, b2.rank, IK.ladder_state(p)], quests = [qv.call(qs), qs.ready, claimed, qv.call(qs2), qs2.weekLeft, IK.week_number("2026-11-08"), IK.day_number("2026-11-08")],
		rec = rk, best = rec.get("best"), fast = fast, hall = hall, rel = rel, stage = IK.stage_label("nakayama|芝|2500"),
		uniq = _uniq(),
		limited = _limited(seed), cardStory = _card_story(seed), cardStory2 = _card_story2(seed), password = _password(seed),
		pity = _pity(p), story = [steps.filter(func(x): return x[0] == "event" and String(x[1]).begins_with("story:")).size(), run.get("chain")],
	}
	return {pulls = pulls, steps = steps, stats = h.stats, rating = h.rating, skills = h.skills, name = h.name, sex = h.sex, coat = h.coat,
		battle = orders(b.result), event = orders(e.result), event2 = orders(e2.result), event3 = orders(e3.result), battle2 = orders(b2.result), extra = extra,
		rival = orders(rv.result), memory = memory, goalrival = goalrival,
		coins = [IK.coins_of(p), int(rv.coins), skip, IK.mission_gain(p, {sire = sire.id, dam = dam.id, supports = sup}).size(), IK.missions_of(p).size()]}


func race_check(r: Dictionary) -> Array:
	# 同じ 16 頭（カードの値）を対戦の舞台で走らせる
	var field := []
	var cs := IK.cards()
	for i in 16:
		var c: Dictionary = cs[(i * 5 + int(r.distance) / 100) % cs.size()]
		field.append({id = 100 + i, name = c.name, sex = c.sex, coat = c.coat, ab = c.v, dist = c.dist, range = c.range,
			turf = c.turf, dirt = c.dirt, firm = c.firm, soft = c.soft, style = c.style})
	var race: Dictionary = r.duplicate()
	race.ground = "稍重"
	return orders(IK.run_race(race, field, "check:" + r.id))


func _pity(p: Dictionary) -> Array:
	var p0 := IK.pity_of(p)
	var no := 1 if IK.exchange_pity(p, IK.data().pickup[0]) is String else 0
	p.pity = 107
	var x: Dictionary = IK.exchange_pity(p, IK.data().pickup[2])
	return [p0, no, IK.pity_of(p), x.card.id, x.isNew, x.awaken, p.cards[IK.data().pickup[2]]]


# 固有スキルの型ごとの舞台（verify-godot-ikusei.mjs の UQ と同じ）
const UQ := [["king", {grade = "GI"}, {}], ["mud", {ground = "不良"}, {}], ["stayer", {distance = 2400}, {}], ["flash", {distance = 1400}, {}],
	["abroad", {courseId = "longchamp", distance = 2400}, {}], ["stage", {}, {battle = true}], ["queen", {}, {sex = "牝"}], ["crowd", {}, {n = 16}],
	["start", {}, {style = 0.15}], ["shadow", {}, {style = 0.1}], ["kick", {}, {style = 0.65}], ["again", {}, {style = 0.4}],
	["grit", {distance = 2400}, {}], ["long", {distance = 2400}, {style = 0.6}], ["hill", {courseId = "nakayama"}, {}], ["inside", {}, {style = 0.65}],
	["burst", {surface = "ダート", distance = 2000}, {style = 0.1}]]


func _uq_base(id: int, sex: String, style: float) -> Dictionary:
	return {id = id, name = "U%d" % id, sex = sex, coat = "鹿毛", ab = {speed = 0.75, stamina = 0.75, power = 0.75, guts = 0.75, wit = 0.75},
		dist = 2000, range = 600, turf = 0.9, dirt = 0.9, firm = 0.8, soft = 0.6, style = style}


func _uniq() -> Array:
	var out := []
	for u in UQ:
		var o: Dictionary = u[2]
		var fired := []
		var me := _uq_base(1, String(o.get("sex", "牡")), float(o.get("style", 0.5)))
		me.uniq = {kind = u[0], k = 1.16, region = "JP", battle = bool(o.get("battle", false)), name = "固有", fired = fired}
		var field := [me]
		for i in range(2, int(o.get("n", 12)) + 1):
			field.append(_uq_base(i, "牡", float((i * 37) % 100) / 100.0))
		var race := {id = "u", name = "u", grade = "", ground = "良", courseId = "tokyo", surface = "芝", distance = 2000}
		race.merge(u[1], true)
		var res := IK.run_race(race, field, "uq:%s" % u[0])
		var ats := []
		for r in res.results:
			ats.append(null if r.get("uqAt") == null else IK.jround(float(r.uqAt) * 1000.0) / 1000.0)
		out.append([u[0], orders(res), ats, fired.size()])
	return out


func _limited(seed: int) -> Array:
	var q := IK.new_profile(seed + 100)
	q.coins = 999
	return IK.pull(q, 200, "2026-11-20").map(func(g): return g.card.id)


func _card_story2(seed: int) -> Array:
	var cp := IK.new_profile(seed + 300)
	cp.coins = 999
	for id in ["P1-17", "P4-01", "LT-02", "P1-02", "P1-03", "P1-04"]:
		cp.cards[id] = 1
	IK.start_run(cp, {sire = "P1-17", dam = "P4-01", name = "ビッグレッド"}, ["LT-02", "P1-02", "P1-03", "P1-04"])
	var r: Dictionary = cp.run
	var out := []
	var pv := []
	var j := 0
	while not IK.run_done(r):
		var e = IK.pending_event(r)
		if e != null:
			var t := int(r.turn)
			var m := IK.resolve_event(r, t % 2)
			out.append([e.id, t, m, int(r.energy), (r.stats as Dictionary).duplicate()])
		if IK.is_race_turn(r):
			IK.race_turn(r, IK.race_options(r)[0].id)
		elif int(r.energy) < 45:
			IK.rest(r)
		else:
			var k := "power" if j % 2 == 1 else "speed"
			j += 1
			var v := IK.training_preview(r, k)
			pv.append([k, v.gains, v.cost, v.skills])
			IK.train(r, k)
	var sk := IK.apply_race_skills({ab = {speed = 0.7, stamina = 0.7, power = 0.7, guts = 0.7, wit = 0.7}, style = 0.3}, IK.skills_of(IK.card("LT-02"), 2).race,
		{surface = "ダート", distance = 2000, grade = "GI"}, false, "LM", null, 2)
	var abs := []
	for k in ["speed", "stamina", "power", "guts", "wit"]:
		abs.append(IK.jround(float(sk.spec.ab[k]) * 1e6))
	return [out, r.get("chain"), pv, sk.fired, abs]


func _password(seed: int) -> Array:
	var q := IK.new_profile(seed + 400)
	q.coins = 0
	var a := IK.apply_password(q, "1234")
	var b := IK.apply_password(q, "0000")
	var n := []
	for g in IK.pull(q, 40):
		n.append(g.card.id)
	var c1 := IK.coins_of(q)
	var raw: int = int(q.coins)
	var d := IK.apply_password(q, "0000")
	return [a, b, n, c1, raw, d, IK.coins_of(q)]


func _card_story(seed: int) -> Array:
	var cp := IK.new_profile(seed + 200)
	cp.coins = 999
	for id in ["P1-17", "P4-01", "LT-01", "P1-02", "P1-03", "P1-04"]:
		cp.cards[id] = 1
	IK.start_run(cp, {sire = "P1-17", dam = "P4-01", name = "オペラノコ"}, ["LT-01", "P1-02", "P1-03", "P1-04"])
	var r: Dictionary = cp.run
	var out := []
	var j := 0
	while not IK.run_done(r):
		var e = IK.pending_event(r)
		if e != null:
			var t := int(r.turn)
			var m := IK.resolve_event(r, t % 2)
			out.append([e.id, t, m, int(r.energy), (r.stats as Dictionary).duplicate()])
		if IK.is_race_turn(r):
			IK.race_turn(r, IK.race_options(r)[0].id)
		elif int(r.energy) < 45:
			IK.rest(r)
		else:
			IK.train(r, "stamina" if j % 2 == 1 else "guts")
			j += 1
	return [out, r.get("chain")]
