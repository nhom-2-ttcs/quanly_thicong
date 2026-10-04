const EPSILON = 1e-9;

function normalizeNumber(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  if (Math.abs(numeric) <= EPSILON) {
    return 0;
  }

  return Number(numeric.toFixed(12));
}

function getTaskId(task) {
  if (!task || typeof task !== 'object') {
    return null;
  }

  return task.id ?? task.taskId ?? task.task_id ?? task.code ?? null;
}

function getDuration(task) {
  if (!task || typeof task !== 'object') {
    return 0;
  }

  const duration = Number(task.duration ?? 0);
  return Number.isFinite(duration) ? Math.max(0, duration) : 0;
}

function getDependencySource(dependency) {
  if (!dependency) {
    return null;
  }

  if (typeof dependency === 'string') {
    return dependency;
  }

  if (typeof dependency === 'object') {
    return dependency.id ?? dependency.predecessorId ?? dependency.predecessor_id ?? dependency.predecessorTaskId ?? dependency.predecessor_task_id ?? dependency.predecessor ?? dependency.from ?? null;
  }

  return null;
}

function getTaskDependencyList(task) {
  if (!task || typeof task !== 'object') {
    return [];
  }

  if (Array.isArray(task.predecessors)) {
    return task.predecessors;
  }

  if (Array.isArray(task.dependencies)) {
    return task.dependencies;
  }

  return [];
}

function getDependencyType(dependency) {
  if (!dependency || typeof dependency !== 'object') {
    return 'FS';
  }

  return String(dependency.type ?? dependency.relationship ?? dependency.relation ?? 'FS').toUpperCase();
}

function getDependencyLag(dependency) {
  if (!dependency || typeof dependency !== 'object') {
    return 0;
  }

  const lag = Number(dependency.lag ?? dependency.delay ?? 0);
  return Number.isFinite(lag) ? lag : 0;
}

function calculateRelationWeight(predecessorTask, successorTask, type, lag = 0) {
  const durationP = getDuration(predecessorTask);
  const durationS = getDuration(successorTask);
  const normalizedLag = normalizeNumber(lag);

  switch (type) {
    case 'FS':
      return normalizeNumber(durationP + normalizedLag);
    case 'SS':
      return normalizeNumber(normalizedLag);
    case 'FF':
      return normalizeNumber(durationP + normalizedLag - durationS);
    case 'SF':
      return normalizeNumber(normalizedLag - durationS);
    default:
      throw new Error(`Loại quan hệ "${type}" không hợp lệ`);
  }
}

function calculateProjectDuration(tasks, earlyScheduleMap = new Map()) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return 0;
  }

  let maxFinish = 0;

  for (const task of tasks) {
    const taskId = getTaskId(task);
    const earlyFinish = earlyScheduleMap.has(taskId)
      ? Number(earlyScheduleMap.get(taskId).earlyFinish ?? 0)
      : Number(task.earlyFinish ?? getDuration(task) + Number(task.earlyStart ?? 0));

    if (Number.isFinite(earlyFinish)) {
      maxFinish = Math.max(maxFinish, earlyFinish);
    }
  }

  return normalizeNumber(maxFinish);
}

function calculateBackwardPass(tasks, topologicalOrder, earlySchedule = []) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return [];
  }

  const taskMap = new Map();
  const earlyMap = new Map();

  for (const task of tasks) {
    const taskId = getTaskId(task);

    if (taskId === null) {
      continue;
    }

    taskMap.set(taskId, task);
  }

  const scheduleEntries = Array.isArray(earlySchedule) ? earlySchedule : [];

  for (const entry of scheduleEntries) {
    const id = entry && (entry.id ?? entry.taskId ?? entry.task_id);

    if (id !== undefined && id !== null) {
      earlyMap.set(String(id), entry);
    }
  }

  for (const task of tasks) {
    const taskId = getTaskId(task);

    if (taskId === null || earlyMap.has(String(taskId))) {
      continue;
    }

    const earlyStart = Number(task.earlyStart ?? 0);
    const earlyFinish = Number(task.earlyFinish ?? earlyStart + getDuration(task));

    earlyMap.set(String(taskId), {
      id: taskId,
      earlyStart,
      earlyFinish
    });
  }

  const normalizedOrder = Array.isArray(topologicalOrder) && topologicalOrder.length > 0
    ? [...topologicalOrder]
    : tasks.map(getTaskId).filter(Boolean);

  const successorMap = new Map();

  for (const task of tasks) {
    const taskId = getTaskId(task);
    if (taskId === null) {
      continue;
    }

    successorMap.set(String(taskId), []);
  }

  for (const task of tasks) {
    const taskId = getTaskId(task);
    if (taskId === null) {
      continue;
    }

    const dependencies = getTaskDependencyList(task);

    for (const dependency of dependencies) {
      const predecessorId = getDependencySource(dependency);
      if (predecessorId === null || predecessorId === undefined) {
        continue;
      }

      const sourceId = String(predecessorId);
      const successorId = String(taskId);
      const type = getDependencyType(dependency);
      const lag = getDependencyLag(dependency);

      if (!successorMap.has(sourceId)) {
        successorMap.set(sourceId, []);
      }

      successorMap.get(sourceId).push({
        successorId,
        type,
        lag
      });
    }
  }

  const projectDuration = calculateProjectDuration(tasks, earlyMap);
  const lateStartMap = new Map();
  const lateFinishMap = new Map();

  for (const task of tasks) {
    const taskId = getTaskId(task);
    if (taskId === null) {
      continue;
    }

    const duration = getDuration(task);
    const taskLateStart = normalizeNumber(projectDuration - duration);
    lateStartMap.set(String(taskId), taskLateStart);
    lateFinishMap.set(String(taskId), normalizeNumber(taskLateStart + duration));
  }

  for (let index = normalizedOrder.length - 1; index >= 0; index -= 1) {
    const taskId = normalizedOrder[index];
    const task = taskMap.get(taskId);

    if (!task) {
      continue;
    }

    const successors = successorMap.get(String(taskId)) || [];

    for (const successor of successors) {
      const successorTask = taskMap.get(String(successor.successorId));
      if (!successorTask) {
        continue;
      }

      const successorLateStart = lateStartMap.get(String(successor.successorId)) ?? 0;
      const weight = calculateRelationWeight(task, successorTask, successor.type, successor.lag);
      const candidateLateStart = successorLateStart - weight;
      const currentLateStart = lateStartMap.get(String(taskId)) ?? Number.MAX_SAFE_INTEGER;
      const nextLateStart = Math.min(currentLateStart, candidateLateStart);

      lateStartMap.set(String(taskId), normalizeNumber(nextLateStart));
      lateFinishMap.set(String(taskId), normalizeNumber(lateStartMap.get(String(taskId)) + getDuration(task)));
    }
  }

  const results = [];

  for (const taskId of normalizedOrder) {
    const task = taskMap.get(taskId);
    if (!task) {
      continue;
    }

    const duration = getDuration(task);
    const earlyEntry = earlyMap.get(String(taskId)) || {};
    const earlyStart = normalizeNumber(earlyEntry.earlyStart ?? task.earlyStart ?? 0);
    const earlyFinish = normalizeNumber(earlyEntry.earlyFinish ?? task.earlyFinish ?? earlyStart + duration);

    let lateStart = lateStartMap.get(String(taskId));
    let lateFinish = lateFinishMap.get(String(taskId));

    if (lateStart === undefined) {
      lateStart = normalizeNumber(projectDuration - duration);
    }

    if (lateFinish === undefined) {
      lateFinish = normalizeNumber(lateStart + duration);
    }

    lateStart = normalizeNumber(lateStart);
    lateFinish = normalizeNumber(lateFinish);

    const totalFloat = normalizeNumber(lateStart - earlyStart);
    const finishDelta = normalizeNumber(lateFinish - earlyFinish);
    const finalFloat = Math.abs(totalFloat - finishDelta) <= EPSILON ? totalFloat : totalFloat;
    const isCritical = Math.abs(finalFloat) <= EPSILON;

    results.push({
      id: taskId,
      duration,
      earlyStart,
      earlyFinish,
      lateStart,
      lateFinish,
      totalFloat: finalFloat,
      isCritical
    });
  }

  return results;
}

module.exports = {
  calculateBackwardPass,
  calculateProjectDuration,
  calculateRelationWeight
};
