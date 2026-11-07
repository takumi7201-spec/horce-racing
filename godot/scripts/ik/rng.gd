extends RefCounted
## 乱数（src/core/rng.js の xoshiro128** と FNV-1a をそのまま移したもの）。
##
## 育成モードは「シード＋引いた回数・ターン」から毎回乱数を作り直すので、JS と同じ列を出さないと
## ガチャの中身も練習場の顔ぶれもゲームと変わる。GDScript の int は 64 bit なので、32 bit の演算は
## 毎回 0xffffffff で切る。Math.imul は 64 bit で溢れないよう 16 bit ずつ掛ける。

const M32 := 0xffffffff

var a := 0
var b := 0
var c := 0
var d := 0


static func imul(x: int, y: int) -> int:
	x &= M32
	y &= M32
	var lo := x * (y & 0xffff)
	var hi := ((x * (y >> 16)) & 0xffff) << 16
	return (lo + hi) & M32


## 文字列 → 32bit シード（FNV-1a）。JS は UTF-16 の符号単位で回すので、BMP の外の字は 2 つに割る。
static func hash_seed(s: String) -> int:
	var h := 2166136261
	for i in s.length():
		var cp := s.unicode_at(i)
		if cp > 0xffff:
			cp -= 0x10000
			h = imul(h ^ (0xd800 + (cp >> 10)), 16777619)
			h = imul(h ^ (0xdc00 + (cp & 0x3ff)), 16777619)
		else:
			h = imul(h ^ cp, 16777619)
	return h & M32


static func make(seed: int) -> RefCounted:
	var r = load("res://scripts/ik/rng.gd").new()
	r._seed(seed)
	return r


func _seed(seed: int) -> void:
	# JS の seed * 0x85ebca6b は倍精度の掛け算（2^53 を超えると丸まる）を >>> 0 で切る。
	# シードは 32 bit なので積は 2^64 に届き、倍精度の丸めを通してから下位 32 bit を取る
	a = (seed ^ 0x9e3779b9) & M32
	b = _js_mul_add(seed, 0x85ebca6b, 0x165667b1)
	c = _js_mul_add(seed, 0xc2b2ae35, 0x27d4eb2f)
	d = (seed ^ 0x61c88647) & M32
	if (a | b | c | d) == 0:
		a = 1
	for i in 12:
		_step()


## (x * m + k) >>> 0 を JS の倍精度のとおりに。
static func _js_mul_add(x: int, m: int, k: int) -> int:
	var f: float = float(x) * float(m) + float(k)
	# 2^64 未満の非負の整数なので、上と下に分けて 32 bit を取る
	var hi := floorf(f / 4294967296.0)
	var lo := f - hi * 4294967296.0
	return int(lo) & M32


func _step() -> int:
	var t := (b << 9) & M32
	var r := imul(b, 5)
	r = ((r << 7) | (r >> 25)) & M32
	r = imul(r, 9)
	c = (c ^ a) & M32
	d = (d ^ b) & M32
	b = (b ^ c) & M32
	a = (a ^ d) & M32
	c = (c ^ t) & M32
	d = ((d << 11) | (d >> 21)) & M32
	return r


func next() -> float:
	return float(_step()) / 4294967296.0


func int_n(n: int) -> int:
	return int(floor(next() * n))


func range_f(lo: float, hi: float) -> float:
	return lo + next() * (hi - lo)


func chance(p: float) -> bool:
	return next() < p


func pick(arr: Array):
	return arr[int(floor(next() * arr.size()))]


## 正規分布（Box-Muller）。log・cos は JS（V8 の fdlibm）と最後の桁がずれることがある（1 割ほど）。
func normal(mean := 0.0, sd := 1.0) -> float:
	var u := 0.0
	while u == 0.0:
		u = next()
	var v := next()
	return mean + sd * sqrt(-2.0 * log(u)) * cos(2.0 * PI * v)


func weighted(arr: Array, weights: Array):
	var total := 0.0
	for w in weights:
		total += w
	if total <= 0:
		return arr[0]
	var r := next() * total
	for i in arr.size():
		r -= weights[i]
		if r <= 0:
			return arr[i]
	return arr[arr.size() - 1]
