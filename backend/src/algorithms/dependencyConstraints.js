/**
 * T-18: Công thức duyệt xuôi cho từng loại quan hệ
 *
 * FS: Finish -> Start
 * SS: Start -> Start
 * FF: Finish -> Finish
 * SF: Start -> Finish
 */

/**
 * Finish-to-Start (FS)
 * Công việc sau chỉ được bắt đầu sau khi
 * công việc trước hoàn thành + độ trễ.
 */
function calculateFS(previousFinish, lag = 0) {
  return previousFinish + lag;
}

/**
 * Start-to-Start (SS)
 * Công việc sau chỉ được bắt đầu sau khi
 * công việc trước bắt đầu + độ trễ.
 */
function calculateSS(previousStart, lag = 0) {
  return previousStart + lag;
}

/**
 * Finish-to-Finish (FF)
 * Công việc sau chỉ được hoàn thành sau khi
 * công việc trước hoàn thành + độ trễ.
 */
function calculateFF(previousFinish, lag = 0) {
  return previousFinish + lag;
}

/**
 * Start-to-Finish (SF)
 * Công việc sau chỉ được hoàn thành sau khi
 * công việc trước bắt đầu + độ trễ.
 */
function calculateSF(previousStart, lag = 0) {
  return previousStart + lag;
}

module.exports = {
  calculateFS,
  calculateSS,
  calculateFF,
  calculateSF
};
