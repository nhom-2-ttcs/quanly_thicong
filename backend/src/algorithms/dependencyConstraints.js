/**
 * T-18 & T-20: Công thức duyệt xuôi và duyệt ngược cho từng loại quan hệ
 * 
 * FS: Finish -> Start
 * SS: Start -> Start
 * FF: Finish -> Finish
 * SF: Start -> Finish
 */

/**
 * Finish-to-Start (FS) - Xuôi
 * Công việc sau chỉ được bắt đầu sau khi công việc trước hoàn thành + độ trễ.
 */
function calculateFS(previousFinish, lag = 0) {
  return previousFinish + lag;
}

/**
 * Finish-to-Start (FS) - Ngược (T-20)
 * Ràng buộc: LF(u) <= LS(v) - lag
 */
function calculateReverseFS(successorLateStart, lag = 0) {
  return successorLateStart - lag;
}

/**
 * Start-to-Start (SS) - Xuôi
 * Công việc sau chỉ được bắt đầu sau khi công việc trước bắt đầu + độ trễ.
 */
function calculateSS(previousStart, lag = 0) {
  return previousStart + lag;
}

/**
 * Start-to-Start (SS) - Ngược (T-20)
 * Ràng buộc: LS(u) <= LS(v) - lag => LF(u) <= (LS(v) - lag) + duration(u)
 */
function calculateReverseSS(successorLateStart, lag = 0, currentDuration = 0) {
  return successorLateStart - lag + currentDuration;
}

/**
 * Finish-to-Finish (FF) - Xuôi
 * Công việc sau chỉ được hoàn thành sau khi công việc trước hoàn thành + độ trễ.
 */
function calculateFF(previousFinish, lag = 0) {
  return previousFinish + lag;
}

/**
 * Finish-to-Finish (FF) - Ngược (T-20)
 * Ràng buộc: LF(u) <= LF(v) - lag
 */
function calculateReverseFF(successorLateFinish, lag = 0) {
  return successorLateFinish - lag;
}

/**
 * Start-to-Finish (SF) - Xuôi
 * Công việc sau chỉ được hoàn thành sau khi công việc trước bắt đầu + độ trễ.
 */
function calculateSF(previousStart, lag = 0) {
  return previousStart + lag;
}

/**
 * Start-to-Finish (SF) - Ngược (T-20)
 * Ràng buộc: LS(u) <= LF(v) - lag => LF(u) <= (LF(v) - lag) + duration(u)
 */
function calculateReverseSF(successorLateFinish, lag = 0, currentDuration = 0) {
  return successorLateFinish - lag + currentDuration;
}

module.exports = {
  calculateFS,
  calculateReverseFS,
  calculateSS,
  calculateReverseSS,
  calculateFF,
  calculateReverseFF,
  calculateSF,
  calculateReverseSF
};
