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
	var run: Dictionary = p.run
	var steps := []
	while not IK.run_done(run):
		if IK.is_race_turn(run):
			var opts := IK.race_options(run)
			var r := IK.race_turn(run, opts[0].id)
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
	var h := IK.finish_run(p)
	var b := IK.battle_npc(p, h.id, "japan-cup", "normal")
	var e := IK.event_race(p, h.id, "arc1999", 1)
	return {pulls = pulls, steps = steps, stats = h.stats, rating = h.rating, skills = h.skills, name = h.name, sex = h.sex, coat = h.coat,
		battle = orders(b.result), event = orders(e.result)}


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
