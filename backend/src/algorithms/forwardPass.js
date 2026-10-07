const { normalizeId, calculateRelationWeight } = require('./backwardPass');

function calculateForwardPass(tasks, topologicalOrder, projectStart = 0) {
  if (!Array.isArray(tasks)) throw new Error('tasks phải là một mảng');
  if (!Array.isArray(topologicalOrder)) throw new Error('topologicalOrder phải là một mảng');
  const start = Number(projectStart);
  if (!Number.isFinite(start)) throw new Error('projectStart phải là số hữu hạn');

  const taskMap = new Map();
  for (const task of tasks) {
    const id = normalizeId(task?.id ?? task?.taskId ?? task?.task_id, 'task.id');
    const duration = Number(task?.duration);
    if (!Number.isFinite(duration) || duration < 0) throw new Error(`duration của task ${id} phải là số không âm hữu hạn`);
    if (taskMap.has(id)) throw new Error(`ID task bị trùng: ${id}`);
    taskMap.set(id, { ...task, normalizedId: id, duration, earlyStart: null, earlyFinish: null });
  }

  const order = topologicalOrder.map((item, index) =>
    normalizeId(typeof item === 'object' ? item.id ?? item.taskId ?? item.task_id : item, `topologicalOrder[${index}]`)
  );
  if (order.length !== taskMap.size || new Set(order).size !== taskMap.size || order.some(id => !taskMap.has(id))) {
    throw new Error('topologicalOrder thiếu, thừa hoặc trùng task');
  }

  const result = [];
  for (const id of order) {
    const task = taskMap.get(id);
    let earliestStart = start;
    for (const dependency of task.predecessors || []) {
      const predecessorId = normalizeId(
        typeof dependency === 'object' ? dependency.id ?? dependency.predecessorId : dependency,
        `predecessor của task ${id}`
      );
      const predecessor = taskMap.get(predecessorId);
      if (!predecessor) throw new Error(`Predecessor "${predecessorId}" không tồn tại`);
      if (predecessor.earlyStart === null) throw new Error('topologicalOrder không hợp lệ hoặc đồ thị có chu trình');
      const type = typeof dependency === 'object' ? dependency.type ?? 'FS' : 'FS';
      const lag = typeof dependency === 'object' ? dependency.lag ?? 0 : 0;
      earliestStart = Math.max(
        earliestStart,
        predecessor.earlyStart + calculateRelationWeight(predecessor, task, type, lag)
      );
    }
    task.earlyStart = earliestStart;
    task.earlyFinish = earliestStart + task.duration;
    result.push({ id: task.id ?? id, taskId: task.id ?? id, duration: task.duration, earlyStart: task.earlyStart, earlyFinish: task.earlyFinish });
  }
  return result;
}

module.exports = { calculateForwardPass };
