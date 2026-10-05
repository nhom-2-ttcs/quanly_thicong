const { TaskDependencyGraph } = require('./graph');
const { topologicalSort } = require('./topologicalSort');
const { validateDependencyContract } = require('./contracts');
const { calculateForwardPass } = require('../../algorithms/forwardPass');
const { calculateBackwardPass, normalizeId } = require('../../algorithms/backwardPass');

class SchedulerService {
  constructor(db) {
    this.pool = db?.pool || db;
  }

  computeSchedule(tasks = [], dependencies = []) {
    if (!Array.isArray(tasks) || !Array.isArray(dependencies)) {
      throw new Error('tasks và dependencies phải là mảng');
    }

    const normalizedTasks = tasks.map(task => {
      const id = normalizeId(task?.id, 'task.id');
      const duration = Number(task?.duration);
      if (!Number.isFinite(duration) || duration < 0) {
        throw new Error(`duration của task ${id} phải là số không âm hữu hạn`);
      }
      return { ...task, normalizedId: id, duration, predecessors: [] };
    });

    const normalizedDependencies = dependencies.map((dependency, index) => {
      const candidate = {
        predecessorId: dependency?.predecessorId,
        successorId: dependency?.successorId,
        type: dependency?.type,
        lag: dependency?.lag
      };
      const validation = validateDependencyContract(candidate);
      if (!validation.valid && !validation.error?.includes('Self-loop')) {
        throw new Error(`Dependency ${index + 1}: ${validation.error}`);
      }
      return {
        predecessorId: normalizeId(candidate.predecessorId, `dependency[${index}].predecessorId`),
        successorId: normalizeId(candidate.successorId, `dependency[${index}].successorId`),
        type: String(candidate.type ?? 'FS').toUpperCase(),
        lag: Number(candidate.lag ?? 0)
      };
    });

    const taskById = new Map(normalizedTasks.map(task => [task.normalizedId, task]));
    for (const dependency of normalizedDependencies) {
      if (!taskById.has(dependency.predecessorId) || !taskById.has(dependency.successorId)) {
        throw new Error(`Dependency tham chiếu task không tồn tại: ${dependency.predecessorId} -> ${dependency.successorId}`);
      }
      taskById.get(dependency.successorId).predecessors.push({
        id: dependency.predecessorId,
        type: dependency.type,
        lag: dependency.lag
      });
    }

    const graph = new TaskDependencyGraph().setNodes(normalizedTasks).setEdges(normalizedDependencies);
    const topology = topologicalSort(graph);
    if (topology.hasCycle) {
      return { ...topology, nodeCount: graph.getNodeCount(), edgeCount: graph.getEdgeCount(), projectDuration: null, tasks: [] };
    }
    if (normalizedTasks.length === 0) {
      return { ...topology, nodeCount: 0, edgeCount: 0, projectDuration: 0, tasks: [] };
    }

    const earlySchedule = calculateForwardPass(normalizedTasks, topology.orderedIds, 0);
    const schedule = calculateBackwardPass(normalizedTasks, topology.orderedIds, earlySchedule, normalizedDependencies);
    const sourceById = new Map(tasks.map(task => [normalizeId(task.id, 'task.id'), task]));
    const scheduledTasks = schedule.map(item => {
      const source = sourceById.get(normalizeId(item.taskId, 'taskId'));
      return { ...item, name: source?.name, code: source?.code, status: source?.status };
    });
    const projectDuration = Math.max(...scheduledTasks.map(task => task.earlyFinish));

    return {
      ...topology,
      nodeCount: graph.getNodeCount(),
      edgeCount: graph.getEdgeCount(),
      projectDuration,
      tasks: scheduledTasks
    };
  }

  async getProjectSchedule(projectId, mockDependencies = null) {
    if (!this.pool?.query) throw new Error('Database pool chưa được khởi tạo');
    const [tasks] = await this.pool.query(
      'SELECT id, project_id, work_item_id, name, code, duration, status FROM tasks WHERE project_id = ? ORDER BY id ASC',
      [projectId]
    );

    let dependencies;
    let integrationStatus;
    if (Array.isArray(mockDependencies)) {
      dependencies = mockDependencies;
      integrationStatus = 'USING_MOCK_DEPENDENCIES';
    } else {
      const [rows] = await this.pool.query(
        'SELECT id, project_id, predecessor_task_id, successor_task_id, dependency_type, lag_days FROM task_dependencies WHERE project_id = ? ORDER BY id ASC',
        [projectId]
      );
      dependencies = rows.map(row => ({
        predecessorId: row.predecessor_task_id,
        successorId: row.successor_task_id,
        type: row.dependency_type,
        lag: Number(row.lag_days)
      }));
      integrationStatus = 'INTEGRATED WITH S-06';
    }

    return {
      projectId,
      integrationStatus,
      dependenciesCount: dependencies.length,
      ...this.computeSchedule(tasks, dependencies)
    };
  }
}

module.exports = { SchedulerService };
