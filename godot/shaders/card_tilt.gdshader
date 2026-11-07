shader_type canvas_item;
// カードを傾けたときの光沢とホロ（src/ui/cardview.js の .tc-glare・ホロの層を Godot で）。
// カードの表（assets/cards/*.webp）はホロと箔が止まった姿で撮ってあるので、ここでは傾きに合わせて流れる光だけ足す。
// tilt は -1..1（ポインタの位置）。holo はレア度の強さ（N は 0）。art は絵の範囲（上・下の割合）：ホロは絵の上だけに掛ける。

uniform vec2 tilt = vec2(0.0);
uniform float holo = 0.0;
uniform vec2 art = vec2(0.03, 0.64);
uniform float lit = 1.0;

void fragment() {
	vec4 col = COLOR;
	vec2 m = vec2(0.5) + tilt * vec2(0.55, 0.45);
	float g = smoothstep(0.62, 0.0, distance(UV, m));
	col.rgb += g * g * 0.32 * lit;
	if (holo > 0.0 && UV.y > art.x && UV.y < art.y) {
		float band = fract((UV.x * 0.8 + UV.y) * 1.6 + tilt.x * 0.7 + tilt.y * 0.45);
		vec3 rainbow = 0.5 + 0.5 * cos(6.28318 * (band + vec3(0.0, 0.33, 0.67)));
		vec3 screen = 1.0 - (1.0 - col.rgb) * (1.0 - rainbow);
		col.rgb = mix(col.rgb, screen, holo * (0.18 + 0.22 * length(tilt)));
	}
	COLOR = col;
}
