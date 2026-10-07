/**
 * Dependency Service (S-06 / SCRUM-61)
 * Nghiệp vụ kiểm thực, chống trùng lặp, phát hiện chu trình (S-07 integration) và quản lý transaction
 */

const { DEPENDENCY_TYPES, validateDependencyContract } = require('../domain/scheduling/contracts');
const { TaskDependencyGraph } = require('../domain/scheduling/graph');
const { topologicalSort } = require('../domain/scheduling/topologicalSort');
const { ScheduleResultRepository } = require('../repositories/scheduleResultRepository');

class DependencyService {
  constructor(dependencyRepo, db = null) {
    this.repo = dependencyRepo;
    this.pool = db?.pool || db;
    this.scheduleResultRepo = new ScheduleResultRepository(db);
  }

  /**
   * Lấy danh sách quan hệ phụ thuộc theo dự án
   */
  async getDependenciesByProject(projectId) {
    const pId = Number(projectId);
    if (!Number.isInteger(pId) || pId <= 0) {
      return { status: 400, success: false, message: 'Mã dự án (projectId) không hợp lệ' };
    }

    const project = await this.repo.getProjectById(pId);
    if (!project) {
      return { status: 404, success: false, message: 'Dự án không tồn tại' };
    }

    const rows = await this.repo.findAllByProjectId(pId);
    return { status: 200, success: true, data: rows };
  }

  /**
   * Lấy chi tiết quan hệ phụ thuộc theo ID
   */
  async getDependencyById(id) {
    const depId = Number(id);
    if (!Number.isInteger(depId) || depId <= 0) {
      return { status: 400, success: false, message: 'Mã quan hệ (id) không hợp lệ' };
    }

    const dep = await this.repo.findById(depId);
    if (!dep) {
      return { status: 404, success: false, message: 'Không tìm thấy quan hệ phụ thuộc' };
    }

    return { status: 200, success: true, data: dep };
  }

  /**
   * Khởi tạo quan hệ phụ thuộc mới (T-13, T-14)
   */
  async createDependency(projectId, payload) {
    const pId = Number(projectId);
    if (!Number.isInteger(pId) || pId <= 0) {
      return { status: 400, success: false, message: 'Mã dự án (projectId) không hợp lệ' };
    }

    const predId = Number(payload.predecessorId ?? payload.predecessor_id ?? payload.predecessorTaskId ?? payload.predecessor_task_id);
    const succId = Number(payload.successorId ?? payload.successor_id ?? payload.successorTaskId ?? payload.successor_task_id);
    const rawType = payload.type ?? payload.dependencyType ?? payload.dependency_type ?? 'FS';
    const rawLag = payload.lag ?? payload.lagDays ?? payload.lag_days ?? 0;

    // 1. Kiểm thực hợp đồng S-06 / S-07
    const contractVal = validateDependencyContract({
      predecessorId: predId,
      successorId: succId,
      type: rawType,
      lag: rawLag
    });
    if (!contractVal.valid) {
      return { status: 400, success: false, message: contractVal.error };
    }

    const type = String(rawType).toUpperCase();
    const lag = Number(rawLag);

    let conn = null;
    if (this.pool && typeof this.pool.getConnection === 'function') {
      try {
        conn = await this.pool.getConnection();
        await conn.beginTransaction();
      } catch {
        conn = null;
      }
    }

    try {
      // 2. Kiểm tra dự án tồn tại
      const project = await this.repo.getProjectById(pId, conn);
      if (!project) {
        if (conn) await conn.rollback();
        return { status: 404, success: false, message: 'Dự án không tồn tại' };
      }

      // 3. Kiểm tra công việc trước (predecessor) và sau (successor)
      const predTask = await this.repo.getTaskById(predId, conn);
      if (!predTask) {
        if (conn) await conn.rollback();
        return { status: 404, success: false, message: `Công việc đứng trước (ID: ${predId}) không tồn tại` };
      }

      const succTask = await this.repo.getTaskById(succId, conn);
      if (!succTask) {
        if (conn) await conn.rollback();
        return { status: 404, success: false, message: `Công việc đứng sau (ID: ${succId}) không tồn tại` };
      }

      // 4. Kiểm tra cả 2 công việc thuộc cùng dự án
      if (Number(predTask.project_id) !== pId || Number(succTask.project_id) !== pId) {
        if (conn) await conn.rollback();
        return { status: 400, success: false, message: 'Cả hai công việc phải thuộc cùng dự án được chỉ định' };
      }

      // 5. Kiểm tra không tạo trùng dependency
      const existing = await this.repo.findByPair(predId, succId, conn);
      if (existing) {
        if (conn) await conn.rollback();
        return { status: 409, success: false, message: 'Quan hệ phụ thuộc giữa 2 công việc này đã tồn tại' };
      }

      // 6. Phát hiện chu trình (Cycle Detection) trước khi lưu
      const currentDeps = await this.repo.findAllByProjectId(pId, conn);
      const candidateEdges = [
        ...currentDeps.map(d => ({
          predecessorId: d.predecessor_task_id,
          successorId: d.successor_task_id,
          type: d.dependency_type,
          lag: d.lag_days
        })),
        { predecessorId: predId, successorId: succId, type, lag }
      ];

      const graph = new TaskDependencyGraph();
      // Nạp các tasks liên quan
      let allTasks = [];
      const executor = conn || this.pool;
      if (executor?.query) {
        const [taskRows] = await executor.query('SELECT id, name, code, duration, status FROM tasks WHERE project_id = ?', [pId]);
        allTasks = taskRows || [];
      } else {
        allTasks = [predTask, succTask];
      }

      graph.setNodes(allTasks);
      graph.setEdges(candidateEdges);

      const scheduleCheck = topologicalSort(graph);
      if (scheduleCheck.hasCycle) {
        if (conn) await conn.rollback();
        return {
          status: 422,
          success: false,
          hasCycle: true,
          cycleNodes: scheduleCheck.cycleNodes,
          cyclePath: scheduleCheck.cyclePath,
          message: `Không thể tạo quan hệ phụ thuộc vì sẽ gây ra vòng lặp chu trình: ${scheduleCheck.cyclePath}`
        };
      }

      // 7. Tạo bản ghi dependency
      const created = await this.repo.create({
        projectId: pId,
        predecessorTaskId: predId,
        successorTaskId: succId,
        dependencyType: type,
        lagDays: lag
      }, conn);

      try {
        await this.scheduleResultRepo.markStale(pId, conn);
      } catch {}

      if (conn) await conn.commit();
      return { status: 201, success: true, data: created, message: 'Tạo quan hệ phụ thuộc thành công' };
    } catch (err) {
      if (conn) await conn.rollback();
      return { status: 500, success: false, message: err.message };
    } finally {
      if (conn) conn.release();
    }
  }

  /**
   * Cập nhật quan hệ phụ thuộc (T-14)
   */
  async updateDependency(id, payload) {
    const depId = Number(id);
    if (!Number.isInteger(depId) || depId <= 0) {
      return { status: 400, success: false, message: 'Mã quan hệ (id) không hợp lệ' };
    }

    const existing = await this.repo.findById(depId);
    if (!existing) {
      return { status: 404, success: false, message: 'Không tìm thấy quan hệ phụ thuộc' };
    }

    const rawType = payload.type ?? payload.dependencyType ?? payload.dependency_type ?? existing.dependency_type;
    const rawLag = payload.lag ?? payload.lagDays ?? payload.lag_days ?? existing.lag_days;

    const type = String(rawType).toUpperCase();
    if (!DEPENDENCY_TYPES[type]) {
      return { status: 400, success: false, message: `Loại quan hệ '${type}' không hợp lệ. Phải là một trong: FS, SS, FF, SF` };
    }

    const lag = Number(rawLag);
    if (!Number.isFinite(lag)) {
      return { status: 400, success: false, message: 'Độ trễ lag phải là số hữu hạn' };
    }

    let conn = null;
    if (this.pool && typeof this.pool.getConnection === 'function') {
      try {
        conn = await this.pool.getConnection();
        await conn.beginTransaction();
      } catch {
        conn = null;
      }
    }

    try {
      const updated = await this.repo.update(depId, { dependencyType: type, lagDays: lag }, conn);
      try {
        await this.scheduleResultRepo.markStale(existing.project_id, conn);
      } catch {}
      if (conn) await conn.commit();
      return { status: 200, success: true, data: updated, message: 'Cập nhật quan hệ phụ thuộc thành công' };
    } catch (err) {
      if (conn) await conn.rollback();
      return { status: 500, success: false, message: err.message };
    } finally {
      if (conn) conn.release();
    }
  }

  /**
   * Xóa quan hệ phụ thuộc
   */
  async deleteDependency(id) {
    const depId = Number(id);
    if (!Number.isInteger(depId) || depId <= 0) {
      return { status: 400, success: false, message: 'Mã quan hệ (id) không hợp lệ' };
    }

    const existing = await this.repo.findById(depId);
    if (!existing) {
      return { status: 404, success: false, message: 'Không tìm thấy quan hệ phụ thuộc để xóa' };
    }

    let conn = null;
    if (this.pool && typeof this.pool.getConnection === 'function') {
      try {
        conn = await this.pool.getConnection();
        await conn.beginTransaction();
      } catch {
        conn = null;
      }
    }

    try {
      await this.repo.delete(depId, conn);
      try {
        await this.scheduleResultRepo.markStale(existing.project_id, conn);
      } catch {}
      if (conn) await conn.commit();
      return { status: 200, success: true, message: 'Đã xóa quan hệ phụ thuộc thành công' };
    } catch (err) {
      if (conn) await conn.rollback();
      return { status: 500, success: false, message: err.message };
    } finally {
      if (conn) conn.release();
    }
  }
}

module.exports = {
  DependencyService
};
