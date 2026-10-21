// 進行方向（heading）と three.js の Y 回転の変換。
//
// この一行を間違えると馬が真横を向いたまま走る。実際に一度やった。
// three.js を import しないので Node からも検証できる（tools/verify.mjs）。
//
// 約束ごと
//   - course.js の heading は xz 平面の角度。進行方向は (cos h, sin h)
//   - 馬のモデルは **ローカル +Z が前方**（頭が +z、尾が -z、前脚が +z）
//   - rotation.y = θ は ローカル +Z を (sin θ, cos θ) に写す
//
// よって sin θ = cos h, cos θ = sin h すなわち θ = π/2 - h。
// ここを -h にすると「ローカル +X が前方」のモデル用の式になり、
// 90 度ずれて進行方向に対して右を向く。
// スタンドの箱は長辺がローカル +X なので、あちらは -h で正しい。

/** 進行方向 → ローカル +Z を前方とするモデルの Y 回転。 */
export const yawForZForward = (heading) => Math.PI / 2 - heading;

/** 進行方向 → 長辺がローカル +X の板（スタンドなど）の Y 回転。 */
export const yawForXForward = (heading) => -heading;

/** Y 回転 → そのモデルのローカル +Z が指す向き（検証用）。 */
export const zForwardOfYaw = (yaw) => ({ x: Math.sin(yaw), z: Math.cos(yaw) });

/** Y 回転 → そのモデルのローカル +X が指す向き（検証用）。 */
export const xForwardOfYaw = (yaw) => ({ x: Math.cos(yaw), z: -Math.sin(yaw) });
