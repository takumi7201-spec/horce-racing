extends SceneTree
## 馬具の出し分けを確かめる（ゲームの馬具を付けた馬だけに馬具の面が出る）。
const HM := preload("res://scripts/horse_model.gd")

func _init() -> void:
	for gate in [11, 4, 9]:
		var h = HM.new()
		get_root().add_child(h)
		h.build("res://assets/horse/skins/arima", gate, "turf")
		var shown := {}
		for mi in h.find_children("*", "MeshInstance3D", true, false):
			if not mi.visible or mi.mesh.get_surface_count() == 0:
				continue
			var m: Material = mi.mesh.surface_get_material(0)
			if m != null and m.resource_name in ["menko", "menkoTrim", "blinker", "shadowRoll", "cheek", "bandage"]:
				shown[m.resource_name] = shown.get(m.resource_name, 0) + 1
		print("gate ", gate, " ", shown)
	quit()
