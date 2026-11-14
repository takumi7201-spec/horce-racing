shader_type canvas_item;
// 育成モードの部品の箱（ゲームの CSS の「白い縁＋紺の輪郭＋下にずらした影」とグラデーションを 1 つで描く）。
// StyleBoxFlat は 1 色しか塗れず、ゲームの .ikd（下のボタン列）・.card-h（見出しの帯）・.btn.primary のグラデーションが出せなかった。
// ik/ui.gd の Box が、自分の矩形より pad だけ広い四角にこのシェーダを掛けて描く（影と外の輪郭は箱の外にはみ出すため）。

uniform vec2 box_size = vec2(100.0, 40.0);   // 箱の大きさ（px）
uniform float pad = 12.0;                    // 描く四角の外側の余白（影と輪郭の分）
uniform vec4 radii = vec4(14.0);             // 角の丸み（右下・右上・左下・左上）
uniform float border = 3.0;                  // 縁（内側）
uniform vec4 border_color : source_color = vec4(0.067, 0.188, 0.208, 1.0);
uniform float outline = 0.0;                 // 縁の外にもう一重（ホームの舞台：白い縁の外の紺）
uniform vec4 outline_color : source_color = vec4(0.067, 0.188, 0.208, 1.0);
uniform vec4 c0 : source_color = vec4(1.0);  // グラデーション（4 点まで。s1・s2 が中の 2 点の位置）
uniform vec4 c1 : source_color = vec4(1.0);
uniform vec4 c2 : source_color = vec4(1.0);
uniform vec4 c3 : source_color = vec4(1.0);
uniform float s1 = 0.33;
uniform float s2 = 0.66;
uniform float angle = 90.0;                  // CSS の linear-gradient と同じ向き（180 で上から下、90 で左から右）
uniform vec2 shadow = vec2(0.0, 4.0);
uniform vec4 shadow_color : source_color = vec4(0.067, 0.188, 0.208, 0.55);
uniform float bright = 0.0;                  // 押せる箱の、指が乗ったときの明るさ
uniform float dots = 0.0;                    // 網点（舞台の地）

// 位置は UV ではなく頂点の位置（ローカルの px）で測る。draw_rect の UV は 0..1 にならないことがあり、
// 大きな箱（ホームの舞台）が縮んでぼやけた形に描かれた
varying vec2 local;

void vertex() {
	local = VERTEX;
}

float sd_box(vec2 p, vec2 b, vec4 r) {
	// 角の丸みは短い辺の半分まで（丸い札は radius に 999 を渡す）。超えると距離が壊れて何も描かれなかった
	r = min(r, vec4(min(b.x, b.y)));
	r.xy = (p.x > 0.0) ? r.xy : r.zw;
	r.x = (p.y > 0.0) ? r.x : r.y;
	vec2 q = abs(p) - b + r.x;
	return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r.x;
}

vec3 grad(float t) {
	if (t < s1) return mix(c0.rgb, c1.rgb, clamp(t / max(s1, 1e-4), 0.0, 1.0));
	if (t < s2) return mix(c1.rgb, c2.rgb, clamp((t - s1) / max(s2 - s1, 1e-4), 0.0, 1.0));
	return mix(c2.rgb, c3.rgb, clamp((t - s2) / max(1.0 - s2, 1e-4), 0.0, 1.0));
}

void fragment() {
	vec2 px = local;
	vec2 c = px - box_size * 0.5;
	vec2 hb = box_size * 0.5;
	float d = sd_box(c, hb, radii);
	float d_out = d - outline;
	float ds = sd_box(c - shadow, hb, radii) - outline;

	// 向き：CSS の角度（0 で下から上、90 で左から右、180 で上から下）
	float a = radians(angle);
	vec2 dir = vec2(sin(a), -cos(a));
	float len = abs(box_size.x * dir.x) + abs(box_size.y * dir.y);
	float t = clamp(dot(c, dir) / len + 0.5, 0.0, 1.0);
	vec3 fill = grad(t) + bright;
	if (dots > 0.0) {
		vec2 g = mod(px, 9.0) - 4.5;
		fill = mix(fill, vec3(1.0), dots * (1.0 - smoothstep(1.0, 1.7, length(g))));
	}

	float in_shape = clamp(0.5 - d, 0.0, 1.0);
	float in_fill = clamp(0.5 - (d + border), 0.0, 1.0);
	float in_out = clamp(0.5 - d_out, 0.0, 1.0);
	vec3 col = mix(border_color.rgb, fill, in_fill);
	float a_fill = mix(border_color.a, c0.a, in_fill);
	col = mix(outline_color.rgb, col, in_shape);
	float a_main = mix(outline > 0.0 ? outline_color.a : 0.0, a_fill, in_shape) * in_out;
	float sh = clamp(0.5 - ds, 0.0, 1.0) * shadow_color.a;
	float a_all = a_main + sh * (1.0 - a_main);
	vec3 rgb = (col * a_main + shadow_color.rgb * sh * (1.0 - a_main)) / max(a_all, 1e-4);
	COLOR = vec4(rgb, a_all);
}
