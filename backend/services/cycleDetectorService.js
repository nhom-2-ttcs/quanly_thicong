function getTaskIds(dependency) {
  return {
    predecessorId: String(dependency.predecessor_task_id),
    successorId: String(dependency.successor_task_id)
  };
}

function detectCycle(existingDeps, newDep) {
  // TODO [T-17 Integration]: Thay thế ruột hàm này bằng core algorithm của T-17 khi T-17 ready
  const { predecessorId, successorId } = getTaskIds(newDep);
  const graph = new Map();

  for (const dependency of existingDeps) {
    const { predecessorId: from, successorId: to } = getTaskIds(dependency);
    if (!graph.has(from)) graph.set(from, []);
    graph.get(from).push(to);
  }

  if (predecessorId === successorId) {
    return [predecessorId, successorId];
  }

  const queue = [successorId];
  const parent = new Map([[successorId, null]]);

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];

    for (const next of graph.get(current) || []) {
      if (parent.has(next)) continue;
      parent.set(next, current);

      if (next === predecessorId) {
        const path = [];
        let node = predecessorId;

        while (node !== null) {
          path.push(node);
          node = parent.get(node);
        }

        path.reverse();
        return [predecessorId, ...path];
      }

      queue.push(next);
    }
  }

  return null;
}

module.exports = { detectCycle };
