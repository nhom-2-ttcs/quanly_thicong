/**
 * T-20 & T-21: Duyệt ngược theo thứ tự đảo tô-pô, tính hai mốc muộn, độ trễ và việc găng.
 */

const {
  calculateReverseFS,
  calculateReverseSS,
  calculateReverseFF,
  calculateReverseSF
} = require('./dependencyConstraints');

/**
 * Tính hai mốc muộn, độ trễ toàn phần và đánh dấu việc găng.
 * 
 * @param {Array} forwardResults Kết quả từ forwardPass (chứa earlyStart, earlyFinish, id, duration)
 * @param {Array} tasks Danh sách tasks gốc kèm predecessors
 * @param {Array<string>} topologicalOrder Thứ tự topo từ T-16
 * @param {number|null} projectFinish Mốc kết thúc dự án (mặc định lấy max(earlyFinish))
 * @returns {Array} Kết quả đầy đủ gồm 4 mốc, totalFloat và isCritical
 */
function calculateBackwardPass(forwardResults, tasks, topologicalOrder, projectFinish = null) {
  const taskMap = new Map();

  for (const item of forwardResults) {
    taskMap.set(item.id, {
      ...item,
      lateStart: null,
      lateFinish: null,
      totalFloat: null,
      isCritical: false
    });
  }

  const successorsMap = new Map();
  for (const taskId of topologicalOrder) {
    successorsMap.set(taskId, []);
  }

  for (const task of tasks) {
    const preds = task.predecessors || [];
    for (const dep of preds) {
      if (successorsMap.has(dep.id)) {
        successorsMap.get(dep.id).push({
          successorId: task.id,
          type: dep.type,
          lag: dep.lag || 0
        });
      }
    }
  }

  const calculatedProjectFinish = projectFinish !== null 
    ? projectFinish 
    : Math.max(...forwardResults.map(t => t.earlyFinish));

  const reverseOrder = [...topologicalOrder].reverse();

  for (const taskId of reverseOrder) {
    const task = taskMap.get(taskId);
    if (!task) {
      throw new Error(`Task "${taskId}" không tồn tại`);
    }

    const succs = successorsMap.get(taskId) || [];

    if (succs.length === 0) {
      task.lateFinish = calculatedProjectFinish;
    } else {
      let minLateFinish = Infinity;

      for (const dep of succs) {
        const successor = taskMap.get(dep.successorId);
        if (!successor) {
          throw new Error(`Successor "${dep.successorId}" không tồn tại`);
        }

        let constraint;
        switch (dep.type) {
          case 'FS':
            constraint = calculateReverseFS(successor.lateStart, dep.lag);
            break;
          case 'SS':
            constraint = calculateReverseSS(successor.lateStart, dep.lag, task.duration);
            break;
          case 'FF':
            constraint = calculateReverseFF(successor.lateFinish, dep.lag);
            break;
          case 'SF':
            constraint = calculateReverseSF(successor.lateFinish, dep.lag, task.duration);
            break;
          default:
            throw new Error(`Loại quan hệ "${dep.type}" không hợp lệ`);
        }

        minLateFinish = Math.min(minLateFinish, constraint);
      }

      task.lateFinish = minLateFinish;
    }

    task.lateStart = task.lateFinish - task.duration;
    task.totalFloat = task.lateStart - task.earlyStart;
    task.isCritical = (task.totalFloat === 0);
  }

  return topologicalOrder.map(id => taskMap.get(id));
}

module.exports = {
  calculateBackwardPass
};
