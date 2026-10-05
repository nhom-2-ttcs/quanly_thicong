/**
 * T19: Duyệt xuôi theo thứ tự tô-pô
 *
 * Sử dụng:
 * - Thứ tự task từ T16 (Kahn)
 * - Công thức quan hệ từ T18
 *
 * Với mỗi task:
 * - Task không có predecessor bắt đầu từ projectStart.
 * - Task có predecessor lấy giá trị ràng buộc lớn nhất.
 * - Early Finish = Early Start + duration.
 */

const {
  calculateFS,
  calculateSS,
  calculateFF,
  calculateSF
} = require('./dependencyConstraints');

/**
 * Tính hai mốc sớm cho danh sách task.
 *
 * @param {Array} tasks
 * @param {Array<string>} topologicalOrder
 * @param {number} projectStart
 * @returns {Array}
 */
function calculateForwardPass(tasks, topologicalOrder, projectStart = 0) {
  const taskMap = new Map();

  for (const task of tasks) {
    taskMap.set(task.id, {
      ...task,
      earlyStart: null,
      earlyFinish: null
    });
  }

  const result = [];

  for (const taskId of topologicalOrder) {
    const task = taskMap.get(taskId);

    if (!task) {
      throw new Error(`Task "${taskId}" không tồn tại`);
    }

    const predecessors = task.predecessors || [];

    // Task đầu tiên / không có predecessor
    if (predecessors.length === 0) {
      task.earlyStart = projectStart;
      task.earlyFinish = projectStart + task.duration;
    } else {
      let earliestStart = projectStart;

      for (const dependency of predecessors) {
        const predecessor = taskMap.get(dependency.id);

        if (!predecessor) {
          throw new Error(
            `Predecessor "${dependency.id}" không tồn tại`
          );
        }

        const lag = dependency.lag || 0;
        let constraint;

        switch (dependency.type) {
          case 'FS':
            constraint = calculateFS(
              predecessor.earlyFinish,
              lag
            );
            earliestStart = Math.max(
              earliestStart,
              constraint
            );
            break;

          case 'SS':
            constraint = calculateSS(
              predecessor.earlyStart,
              lag
            );
            earliestStart = Math.max(
              earliestStart,
              constraint
            );
            break;

          case 'FF':
            constraint = calculateFF(
              predecessor.earlyFinish,
              lag
            );

            earliestStart = Math.max(
              earliestStart,
              constraint - task.duration
            );
            break;

          case 'SF':
            constraint = calculateSF(
              predecessor.earlyStart,
              lag
            );

            earliestStart = Math.max(
              earliestStart,
              constraint - task.duration
            );
            break;

          default:
            throw new Error(
              `Loại quan hệ "${dependency.type}" không hợp lệ`
            );
        }
      }

      task.earlyStart = earliestStart;
      task.earlyFinish = earliestStart + task.duration;
    }

    result.push({
      id: task.id,
      duration: task.duration,
      earlyStart: task.earlyStart,
      earlyFinish: task.earlyFinish
    });
  }

  return result;
}

module.exports = {
  calculateForwardPass
};
