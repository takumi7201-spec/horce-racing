shader_type canvas_item;
// 角の丸い窓で切り抜く（顔のアイコン・バナーの写真・ホームの街並み）。
// clip_children で切ると、ui_box.gdshader で描いた親の箱が黒く潰れた（親を別の板に描き直すときに、シェーダの UV が変わる）。
// だから切り抜く側に掛ける。窓は自分の矩形（size）で、頂点の位置（ローカルの px）から距離を測る。

uniform vec2 size = vec2(100.0);
uniform float radius = 12.0;

varying vec2 local;

void vertex() {
	local = VERTEX;
}

void fragment() {
	vec2 hb = size * 0.5;
	float r = min(radius, min(hb.x, hb.y));
	vec2 q = abs(local - hb) - hb + r;
	float d = min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
	COLOR.a *= clamp(0.5 - d, 0.0, 1.0);
}
