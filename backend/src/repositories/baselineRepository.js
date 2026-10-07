/**
 * BaselineRepository (S-18 / SCRUM-91)
 * Quản lý lưu trữ và truy vấn kế hoạch gốc (Baseline Schedules)
 * Tuân thủ NFR: Lưu bảng riêng, không phải cờ trong schedule_results
 * Tuân thủ AC 1, AC 2, AC 3, AC 4:
 * - Lưu bản kế hoạch gốc độc lập (AC 1)
 * - Cung cấp dữ liệu thanh mờ cho sơ đồ (AC 2)
 * - Cho phép chốt lại lần 2, ghi nhận lịch sử ai chốt và thời điểm chốt (AC 3)
 * - Xác định trạng thái chưa chốt để hiển thị gợi ý (AC 4)
 */

// Bộ nhớ đệm fallback in-memory khi chạy standalone hoặc unit test
const inMemoryBaselines = new Map(); // projectId -> Array of baseline_schedules
const inMemoryBaselineTasks = new Map(); // baselineScheduleId -> Array of baseline_tasks
const inMemoryBaselineHistory = new Map(); // projectId -> Array of baseline_history
let autoIncrementId = 1;

class BaselineRepository {
  constructor(db) {
    this.pool = db?.pool || db;
  }

  getExecutor(conn = null) {
    return conn || this.pool;
  }

  isDatabaseAvailable() {
    return Boolean(this.pool && typeof this.pool.query === 'function' && typeof this.pool.getConnection === 'function');
  }

  /**
   * Lấy kế hoạch gốc hiện hành (is_current = TRUE) của dự án
   * @param {number} projectId 
   */
  async getCurrentBaseline(projectId, conn = null) {
    const pId = Number(projectId);
    if (!Number.isInteger(pId) || pId <= 0) {
      return { hasBaseline: false, baseline: null, tasks: [] };
    }

    if (!this.isDatabaseAvailable()) {
      const list = inMemoryBaselines.get(pId) || [];
      const current = list.find(b => b.is_current);
      if (!current) {
        return { hasBaseline: false, baseline: null, tasks: [] };
      }
      const tasks = inMemoryBaselineTasks.get(current.id) || [];
      return {
        hasBaseline: true,
        baseline: { ...current },
        tasks: tasks.map(t => ({ ...t }))
      };
    }

    const executor = this.getExecutor(conn);
    try {
      const [rows] = await executor.query(
        `SELECT id, project_id, version, is_current, project_duration, 
                created_by, created_by_name, reason, created_at
         FROM baseline_schedules
         WHERE project_id = ? AND is_current = TRUE
         LIMIT 1`,
        [pId]
      );

      if (!rows || rows.length === 0) {
        return { hasBaseline: false, baseline: null, tasks: [] };
      }

      const baseline = rows[0];
      const [taskRows] = await executor.query(
        `SELECT id, baseline_schedule_id, project_id, task_id, task_code, 
                task_name, duration, early_start, early_finish, late_start, 
                late_finish, total_float, is_critical, created_at
         FROM baseline_tasks
         WHERE baseline_schedule_id = ?
         ORDER BY early_start ASC, task_id ASC`,
        [baseline.id]
      );

      return {
        hasBaseline: true,
        baseline: {
          id: baseline.id,
          projectId: baseline.project_id,
          version: baseline.version,
          isCurrent: Boolean(baseline.is_current),
          projectDuration: Number(baseline.project_duration),
          createdBy: baseline.created_by,
          createdByName: baseline.created_by_name,
          reason: baseline.reason,
          createdAt: baseline.created_at
        },
        tasks: (taskRows || []).map(r => ({
          id: r.id,
          baselineScheduleId: r.baseline_schedule_id,
          projectId: r.project_id,
          taskId: r.task_id,
          taskCode: r.task_code,
          taskName: r.task_name,
          duration: Number(r.duration),
          earlyStart: Number(r.early_start),
          earlyFinish: Number(r.early_finish),
          lateStart: Number(r.late_start),
          lateFinish: Number(r.late_finish),
          totalFloat: Number(r.total_float),
          isCritical: Boolean(r.is_critical),
          createdAt: r.created_at
        }))
      };
    } catch (err) {
      // Nếu bảng chưa có trong database, fallback in-memory
      const list = inMemoryBaselines.get(pId) || [];
      const current = list.find(b => b.is_current);
      if (!current) {
        return { hasBaseline: false, baseline: null, tasks: [] };
      }
      const tasks = inMemoryBaselineTasks.get(current.id) || [];
      return {
        hasBaseline: true,
        baseline: { ...current },
        tasks: tasks.map(t => ({ ...t }))
      };
    }
  }

  /**
   * Chốt kế hoạch gốc (AC 1 & AC 3):
   * - Lần đầu: tạo bản V1 (action: create_initial)
   * - Lần 2 trở đi: thay thế bản cũ làm current, ghi lại lịch sử ai chốt và lúc nào (action: update_overwrite)
   */
  async lockBaseline(projectId, { tasks, projectDuration, userId, userName, reason }) {
    const pId = Number(projectId);
    if (!Number.isInteger(pId) || pId <= 0) {
      throw new Error('projectId không hợp lệ');
    }
    if (!Array.isArray(tasks) || tasks.length === 0) {
      throw new Error('Không có danh sách công việc để chốt kế hoạch gốc');
    }

    const durationVal = Number(projectDuration) || 0;
    const authorName = String(userName || 'Ban Quản Lý Dự Án').trim();
    const reasonText = reason ? String(reason).trim() : null;

    if (!this.isDatabaseAvailable()) {
      return this._lockBaselineInMemory(pId, {
        tasks,
        projectDuration: durationVal,
        userId,
        userName: authorName,
        reason: reasonText
      });
    }

    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      // 1. Kiểm tra bản baseline hiện hành
      const [existingRows] = await conn.query(
        'SELECT id, version FROM baseline_schedules WHERE project_id = ? AND is_current = TRUE',
        [pId]
      );

      let nextVersion = 1;
      let actionType = 'create_initial';

      if (existingRows.length > 0) {
        // Đã có bản cũ -> bản mới thay thế bản cũ (AC 3)
        const oldBaseline = existingRows[0];
        nextVersion = (oldBaseline.version || 1) + 1;
        actionType = 'update_overwrite';

        // Đổi is_current của bản cũ thành FALSE
        await conn.query(
          'UPDATE baseline_schedules SET is_current = FALSE WHERE project_id = ?',
          [pId]
        );
      }

      // 2. Chèn bản baseline mới vào baseline_schedules
      const [insertRes] = await conn.query(
        `INSERT INTO baseline_schedules 
         (project_id, version, is_current, project_duration, created_by, created_by_name, reason)
         VALUES (?, ?, TRUE, ?, ?, ?, ?)`,
        [pId, nextVersion, durationVal, userId || null, authorName, reasonText || (nextVersion === 1 ? 'Khởi công chốt kế hoạch gốc ban đầu' : `Chốt điều chỉnh kế hoạch gốc lần ${nextVersion}`)]
      );

      const baselineId = insertRes.insertId;

      // 3. Chèn các công việc vào baseline_tasks
      const taskValues = tasks.map(t => [
        baselineId,
        pId,
        t.taskId || t.id,
        t.taskCode || t.code || null,
        t.taskName || t.name || 'Công việc',
        Number(t.duration) || 1,
        Number(t.earlyStart ?? 0),
        Number(t.earlyFinish ?? (t.duration || 1)),
        Number(t.lateStart ?? 0),
        Number(t.lateFinish ?? (t.duration || 1)),
        Number(t.totalFloat ?? 0),
        Boolean(t.isCritical)
      ]);

      await conn.query(
        `INSERT INTO baseline_tasks 
         (baseline_schedule_id, project_id, task_id, task_code, task_name, duration, 
          early_start, early_finish, late_start, late_finish, total_float, is_critical)
         VALUES ?`,
        [taskValues]
      );

      // 4. Ghi lịch sử vào baseline_history (AC 3: Ai chốt và lúc nào)
      await conn.query(
        `INSERT INTO baseline_history
         (project_id, baseline_schedule_id, version, action, created_by, created_by_name, task_count, project_duration, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pId,
          baselineId,
          nextVersion,
          actionType,
          userId || null,
          authorName,
          tasks.length,
          durationVal,
          reasonText || (nextVersion === 1 ? 'Chốt kế hoạch gốc ban đầu lúc khởi công' : `Cập nhật thay thế kế hoạch gốc lần ${nextVersion}`)
        ]
      );

      await conn.commit();

      return {
        success: true,
        baselineId,
        version: nextVersion,
        action: actionType,
        createdByName: authorName,
        taskCount: tasks.length,
        projectDuration: durationVal,
        message: nextVersion === 1 
          ? 'Chốt kế hoạch gốc ban đầu thành công' 
          : `Chốt cập nhật kế hoạch gốc lần ${nextVersion} thành công (đã lưu lịch sử thay đổi)`
      };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  _lockBaselineInMemory(pId, { tasks, projectDuration, userId, userName, reason }) {
    const list = inMemoryBaselines.get(pId) || [];
    const current = list.find(b => b.is_current);

    let nextVersion = 1;
    let actionType = 'create_initial';

    if (current) {
      current.is_current = false;
      nextVersion = (current.version || 1) + 1;
      actionType = 'update_overwrite';
    }

    const baselineId = autoIncrementId++;
    const now = new Date();

    const newBaseline = {
      id: baselineId,
      project_id: pId,
      projectId: pId,
      version: nextVersion,
      is_current: true,
      isCurrent: true,
      project_duration: projectDuration,
      projectDuration,
      created_by: userId || null,
      createdBy: userId || null,
      created_by_name: userName,
      createdByName: userName,
      reason: reason || (nextVersion === 1 ? 'Khởi công chốt kế hoạch gốc' : `Cập nhật kế hoạch gốc lần ${nextVersion}`),
      created_at: now,
      createdAt: now
    };

    list.push(newBaseline);
    inMemoryBaselines.set(pId, list);

    const bTasks = tasks.map((t, idx) => ({
      id: autoIncrementId++,
      baseline_schedule_id: baselineId,
      baselineScheduleId: baselineId,
      project_id: pId,
      projectId: pId,
      task_id: t.taskId || t.id || (idx + 1),
      taskId: t.taskId || t.id || (idx + 1),
      task_code: t.taskCode || t.code || `CV-${idx + 1}`,
      taskCode: t.taskCode || t.code || `CV-${idx + 1}`,
      task_name: t.taskName || t.name || 'Công việc',
      taskName: t.taskName || t.name || 'Công việc',
      duration: Number(t.duration) || 1,
      early_start: Number(t.earlyStart ?? 0),
      earlyStart: Number(t.earlyStart ?? 0),
      early_finish: Number(t.earlyFinish ?? (t.duration || 1)),
      earlyFinish: Number(t.earlyFinish ?? (t.duration || 1)),
      late_start: Number(t.lateStart ?? 0),
      lateStart: Number(t.lateStart ?? 0),
      late_finish: Number(t.lateFinish ?? (t.duration || 1)),
      lateFinish: Number(t.lateFinish ?? (t.duration || 1)),
      total_float: Number(t.totalFloat ?? 0),
      totalFloat: Number(t.totalFloat ?? 0),
      is_critical: Boolean(t.isCritical),
      isCritical: Boolean(t.isCritical),
      created_at: now,
      createdAt: now
    }));

    inMemoryBaselineTasks.set(baselineId, bTasks);

    const histList = inMemoryBaselineHistory.get(pId) || [];
    histList.unshift({
      id: autoIncrementId++,
      project_id: pId,
      projectId: pId,
      baseline_schedule_id: baselineId,
      baselineScheduleId: baselineId,
      version: nextVersion,
      action: actionType,
      created_by: userId || null,
      createdBy: userId || null,
      created_by_name: userName,
      createdByName: userName,
      task_count: tasks.length,
      taskCount: tasks.length,
      project_duration: projectDuration,
      projectDuration,
      reason: reason || (nextVersion === 1 ? 'Chốt kế hoạch gốc ban đầu' : `Cập nhật kế hoạch gốc lần ${nextVersion}`),
      created_at: now,
      createdAt: now
    });
    inMemoryBaselineHistory.set(pId, histList);

    return {
      success: true,
      baselineId,
      version: nextVersion,
      action: actionType,
      createdByName: userName,
      taskCount: tasks.length,
      projectDuration,
      message: nextVersion === 1
        ? 'Chốt kế hoạch gốc ban đầu thành công'
        : `Chốt cập nhật kế hoạch gốc lần ${nextVersion} thành công (đã lưu lịch sử thay đổi)`
    };
  }

  /**
   * Lấy lịch sử tất cả các lần chốt kế hoạch gốc (AC 3)
   */
  async getHistory(projectId, conn = null) {
    const pId = Number(projectId);
    if (!Number.isInteger(pId) || pId <= 0) return [];

    if (!this.isDatabaseAvailable()) {
      const list = inMemoryBaselineHistory.get(pId) || [];
      return list.map(h => ({ ...h }));
    }

    const executor = this.getExecutor(conn);
    try {
      const [rows] = await executor.query(
        `SELECT id, project_id, baseline_schedule_id, version, action, 
                created_by, created_by_name, task_count, project_duration, 
                reason, created_at
         FROM baseline_history
         WHERE project_id = ?
         ORDER BY id DESC, created_at DESC`,
        [pId]
      );
      return (rows || []).map(r => ({
        id: r.id,
        projectId: r.project_id,
        baselineScheduleId: r.baseline_schedule_id,
        version: r.version,
        action: r.action,
        createdBy: r.created_by,
        createdByName: r.created_by_name,
        taskCount: r.task_count,
        projectDuration: Number(r.project_duration),
        reason: r.reason,
        createdAt: r.created_at
      }));
    } catch (err) {
      const list = inMemoryBaselineHistory.get(pId) || [];
      return list.map(h => ({ ...h }));
    }
  }

  /**
   * Xóa toàn bộ baseline của project (dùng trong test fixtures)
   */
  async clearProject(projectId) {
    const pId = Number(projectId);
    inMemoryBaselines.delete(pId);
    inMemoryBaselineHistory.delete(pId);
    for (const [k, v] of inMemoryBaselineTasks.entries()) {
      if (v.some(t => t.project_id === pId)) {
        inMemoryBaselineTasks.delete(k);
      }
    }

    if (this.isDatabaseAvailable()) {
      try {
        await this.pool.query('DELETE FROM baseline_schedules WHERE project_id = ?', [pId]);
      } catch (e) {
        // bỏ qua nếu bảng chưa tồn tại
      }
    }
  }
}

module.exports = {
  BaselineRepository,
  inMemoryBaselines,
  inMemoryBaselineTasks,
  inMemoryBaselineHistory
};
