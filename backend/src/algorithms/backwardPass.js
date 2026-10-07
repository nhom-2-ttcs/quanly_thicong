const EPSILON = 1e-9;
const DEPENDENCY_TYPES = new Set(['FS', 'SS', 'FF', 'SF']);

function normalizeId(value, fieldName = 'ID') {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${fieldName} không hợp lệ`);
  }
  return String(value);
}

function normalizeNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('Giá trị lịch phải là số hữu hạn');
  if (Math.abs(number) <= EPSILON) return 0;
  return Number(number.toFixed(12));
}

function getTaskId(task) {
  return normalizeId(task?.id ?? task?.taskId ?? task?.task_id, 'task.id');
}

function getDuration(task) {
  const duration = Number(task?.duration);
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error(`duration của task ${task?.id ?? ''} phải là số không âm hữu hạn`);
  }
  return duration;
}

function normalizeDependencies(tasks, dependencies) {
  if (dependencies !== undefined && !Array.isArray(dependencies)) {
    throw new Error('dependencies phải là một mảng');
  }
  if (Array.isArray(dependencies)) {
    return dependencies.map((dependency, index) => {
      if (!dependency || typeof dependency !== 'object') throw new Error(`dependency[${index}] không hợp lệ`);
      const predecessorId = normalizeId(dependency.predecessorId, `dependency[${index}].predecessorId`);
      const successorId = normalizeId(dependency.successorId, `dependency[${index}].successorId`);
      const type = String(dependency.type ?? '').toUpperCase();
      const lag = Number(dependency.lag ?? 0);
      if (!DEPENDENCY_TYPES.has(type)) throw new Error(`Loại quan hệ "${type}" không hợp lệ`);
      if (!Number.isFinite(lag)) throw new Error(`lag của dependency[${index}] phải là số hữu hạn`);
      return { predecessorId, successorId, type, lag };
    });
  }

  const result = [];
  for (const task of tasks) {
    const successorId = getTaskId(task);
    for (const dependency of task.predecessors || []) {
      const rawPredecessorId = typeof dependency === 'object' ? dependency.id : dependency;
      const predecessorId = normalizeId(rawPredecessorId, 'predecessor.id');
      const type = String(typeof dependency === 'object' ? dependency.type ?? 'FS' : 'FS').toUpperCase();
      const lag = Number(typeof dependency === 'object' ? dependency.lag ?? 0 : 0);
      if (!DEPENDENCY_TYPES.has(type)) throw new Error(`Loại quan hệ "${type}" không hợp lệ`);
      if (!Number.isFinite(lag)) throw new Error('lag phải là số hữu hạn');
      result.push({ predecessorId, successorId, type, lag });
    }
  }
  return result;
}

function calculateRelationWeight(predecessorTask, successorTask, type, lag = 0) {
  const durationP = getDuration(predecessorTask);
  const durationS = getDuration(successorTask);
  const normalizedType = String(type).toUpperCase();
  const normalizedLag = Number(lag);
  if (!DEPENDENCY_TYPES.has(normalizedType)) throw new Error(`Loại quan hệ "${type}" không hợp lệ`);
  if (!Number.isFinite(normalizedLag)) throw new Error('lag phải là số hữu hạn');
  const weights = {
    FS: durationP + normalizedLag,
    SS: normalizedLag,
    FF: durationP + normalizedLag - durationS,
    SF: normalizedLag - durationS
  };
  return normalizeNumber(weights[normalizedType]);
}

function calculateProjectDuration(tasks, earlyScheduleMap) {
  if (!Array.isArray(tasks)) throw new Error('tasks phải là một mảng');
  if (tasks.length === 0) return 0;
  if (!(earlyScheduleMap instanceof Map)) throw new Error('earlyScheduleMap không hợp lệ');
  let projectDuration = -Infinity;
  for (const task of tasks) {
    const id = getTaskId(task);
    const entry = earlyScheduleMap.get(id);
    if (!entry || entry.earlyStart === undefined || entry.earlyFinish === undefined) {
      throw new Error(`Thiếu ES/EF của task ${id}`);
    }
    const earlyStart = Number(entry.earlyStart);
    const earlyFinish = Number(entry.earlyFinish);
    const duration = getDuration(task);
    if (!Number.isFinite(earlyStart) || !Number.isFinite(earlyFinish)) {
      throw new Error(`ES/EF của task ${id} phải là số hữu hạn`);
    }
    if (Math.abs(earlyFinish - earlyStart - duration) > EPSILON) {
      throw new Error(`EF của task ${id} không nhất quán với ES + duration`);
    }
    projectDuration = Math.max(projectDuration, earlyFinish);
  }
  return normalizeNumber(projectDuration);
}

function calculateBackwardPass(tasks, topologicalOrder, earlySchedule, dependencies) {
  if (!Array.isArray(tasks)) throw new Error('tasks phải là một mảng');
  if (tasks.length === 0) return [];
  if (!Array.isArray(topologicalOrder)) throw new Error('topologicalOrder phải là một mảng');
  if (!Array.isArray(earlySchedule)) throw new Error('earlySchedule phải là một mảng');

  const taskMap = new Map();
  for (const task of tasks) {
    const id = getTaskId(task);
    if (taskMap.has(id)) throw new Error(`ID task bị trùng: ${id}`);
    getDuration(task);
    taskMap.set(id, task);
  }
  const order = topologicalOrder.map((item, index) =>
    normalizeId(typeof item === 'object' ? item.id ?? item.taskId ?? item.task_id : item, `topologicalOrder[${index}]`)
  );
  if (order.length !== taskMap.size || new Set(order).size !== taskMap.size || order.some(id => !taskMap.has(id))) {
    throw new Error('topologicalOrder thiếu, thừa hoặc trùng task');
  }

  const earlyMap = new Map();
  for (const entry of earlySchedule) {
    const id = normalizeId(entry?.id ?? entry?.taskId ?? entry?.task_id, 'earlySchedule.taskId');
    if (earlyMap.has(id)) throw new Error(`Early schedule bị trùng task ${id}`);
    earlyMap.set(id, entry);
  }
  const projectDuration = calculateProjectDuration(tasks, earlyMap);
  const normalizedDependencies = normalizeDependencies(tasks, dependencies);
  const successorMap = new Map([...taskMap.keys()].map(id => [id, []]));
  const orderIndex = new Map(order.map((id, index) => [id, index]));
  for (const dependency of normalizedDependencies) {
    if (!taskMap.has(dependency.predecessorId) || !taskMap.has(dependency.successorId)) {
      throw new Error(`Dependency tham chiếu task không tồn tại: ${dependency.predecessorId} -> ${dependency.successorId}`);
    }
    if (orderIndex.get(dependency.predecessorId) >= orderIndex.get(dependency.successorId)) {
      throw new Error('Đồ thị có chu trình hoặc topologicalOrder không hợp lệ');
    }
    successorMap.get(dependency.predecessorId).push(dependency);
  }

  const lateStartMap = new Map();
  const lateFinishMap = new Map();
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const id = order[index];
    const task = taskMap.get(id);
    const successors = successorMap.get(id);
    let lateStart;
    if (successors.length === 0) {
      lateStart = projectDuration - getDuration(task);
    } else {
      lateStart = Math.min(...successors.map(dependency => {
        const successorTask = taskMap.get(dependency.successorId);
        const successorLateStart = lateStartMap.get(dependency.successorId);
        if (successorLateStart === undefined) throw new Error('topologicalOrder không hợp lệ');
        return successorLateStart - calculateRelationWeight(task, successorTask, dependency.type, dependency.lag);
      }));
    }
    lateStart = normalizeNumber(lateStart);
    lateStartMap.set(id, lateStart);
    lateFinishMap.set(id, normalizeNumber(lateStart + getDuration(task)));
  }

  return order.map(id => {
    const task = taskMap.get(id);
    const early = earlyMap.get(id);
    const earlyStart = normalizeNumber(early.earlyStart);
    const earlyFinish = normalizeNumber(early.earlyFinish);
    const lateStart = lateStartMap.get(id);
    const lateFinish = lateFinishMap.get(id);
    const startFloat = normalizeNumber(lateStart - earlyStart);
    const finishFloat = normalizeNumber(lateFinish - earlyFinish);
    if (Math.abs(startFloat - finishFloat) > EPSILON) {
      throw new Error(`Float của task ${id} không nhất quán giữa LS-ES và LF-EF`);
    }
    const totalFloat = Math.abs(startFloat) <= EPSILON ? 0 : startFloat;
    return {
      id: task.id ?? id,
      taskId: task.id ?? id,
      duration: getDuration(task),
      earlyStart,
      earlyFinish,
      lateStart,
      lateFinish,
      totalFloat,
      isCritical: totalFloat === 0
    };
  });
}

module.exports = {
  EPSILON,
  normalizeId,
  calculateBackwardPass,
  calculateProjectDuration,
  calculateRelationWeight
};
