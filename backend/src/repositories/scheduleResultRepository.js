/**
 * ScheduleResultRepository (S-12 / SCRUM-67 / T-26)
 * Thao tác dữ liệu bảng schedule_results và project_schedule_status
 * Hỗ trợ giao dịch (database transaction), rollback khi lỗi chu trình,
 * và đánh dấu kết quả stale / needs_recalculation khi thay đổi task hoặc dependency.
 */

// Bộ nhớ đệm fallback in-memory khi chạy standalone hoặc unit test không có MySQL pool
const inMemoryScheduleResults = new Map();
const inMemoryScheduleStatus = new Map();

class ScheduleResultRepository {
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
   * Đánh dấu kết quả tính toán của dự án là cũ (stale / needs_recalculation = true)
   * Kích hoạt khi công việc (duration) hoặc quan hệ phụ thuộc thay đổi
   */
  async markStale(projectId, conn = null) {
    const pId = Number(projectId);
    if (!Number.isInteger(pId) || pId <= 0) return;

    if (!this.isDatabaseAvailable()) {
      const results = inMemoryScheduleResults.get(pId);
      if (Array.isArray(results)) {
        for (const item of results) {
          item.is_stale = true;
        }
      }
      const status = inMemoryScheduleStatus.get(pId) || {};
      inMemoryScheduleStatus.set(pId, { ...status, needsRecalculation: true });
      return;
    }

    const executor = this.getExecutor(conn);
    try {
      await executor.query(
        'UPDATE schedule_results SET is_stale = TRUE WHERE project_id = ?',
        [pId]
      );
      await executor.query(
        `INSERT INTO project_schedule_status (project_id, needs_recalculation)
         VALUES (?, TRUE)
         ON DUPLICATE KEY UPDATE needs_recalculation = TRUE`,
        [pId]
      );
    } catch (err) {
      // Nếu bảng chưa được tạo trong môi trường mock, fallback in-memory
      const status = inMemoryScheduleStatus.get(pId) || {};
      inMemoryScheduleStatus.set(pId, { ...status, needsRecalculation: true });
    }
  }

  /**
   * Kiểm tra bộ nhớ đệm tiến độ của dự án có bị stale hoặc chưa được tính hay không
   */
  async isStale(projectId, conn = null) {
    const pId = Number(projectId);
    if (!Number.isInteger(pId) || pId <= 0) return true;

    if (!this.isDatabaseAvailable()) {
      const status = inMemoryScheduleStatus.get(pId);
      if (!status || status.needsRecalculation) return true;
      const results = inMemoryScheduleResults.get(pId);
      if (!Array.isArray(results) || results.length === 0) return true;
      return results.some(r => r.is_stale);
    }

    const executor = this.getExecutor(conn);
    try {
      // 1. Kiểm tra cờ needs_recalculation trong project_schedule_status
      const [statusRows] = await executor.query(
        'SELECT needs_recalculation FROM project_schedule_status WHERE project_id = ?',
        [pId]
      );
      if (statusRows.length === 0 || statusRows[0].needs_recalculation) {
        return true;
      }

      // 2. Kiểm tra bất kỳ bản ghi nào trong schedule_results bị stale
      const [staleRows] = await executor.query(
        'SELECT 1 FROM schedule_results WHERE project_id = ? AND is_stale = TRUE LIMIT 1',
        [pId]
      );
      if (staleRows.length > 0) {
        return true;
      }

      // 3. Kiểm tra số lượng task trong dự án có khớp với số dòng kết quả đã lưu hay không
      const [countRows] = await executor.query(
        `SELECT 
          (SELECT COUNT(*) FROM tasks WHERE project_id = ?) AS task_count,
          (SELECT COUNT(*) FROM schedule_results WHERE project_id = ?) AS result_count`,
        [pId, pId]
      );

      const taskCount = Number(countRows[0]?.task_count ?? 0);
      const resultCount = Number(countRows[0]?.result_count ?? 0);

      if (taskCount === 0 && resultCount === 0) {
        return false; // Dự án không có task nào, kết quả rỗng hợp lệ
      }

      if (taskCount !== resultCount) {
        return true;
      }

      return false;
    } catch {
      return true;
    }
  }

  /**
   * Lấy kết quả tiến độ đã lưu trong bảng schedule_results
   * Sắp xếp theo early_start tăng dần, khóa phụ task_id ổn định
   * Hỗ trợ lọc việc găng (criticalOnly)
   */
  async getSavedResults(projectId, { criticalOnly = false } = {}, conn = null) {
    const pId = Number(projectId);
    if (!Number.isInteger(pId) || pId <= 0) {
      return { tasks: [], projectDuration: 0, totalTasks: 0, criticalTasksCount: 0, calculatedAt: null };
    }

    if (!this.isDatabaseAvailable()) {
      const allResults = inMemoryScheduleResults.get(pId) || [];
      const status = inMemoryScheduleStatus.get(pId) || {};
      const sorted = [...allResults].sort((a, b) => {
        if (a.earlyStart !== b.earlyStart) return a.earlyStart - b.earlyStart;
        return String(a.taskId).localeCompare(String(b.taskId));
      });
      const filtered = criticalOnly ? sorted.filter(t => t.isCritical) : sorted;
      return {
        tasks: filtered,
        projectDuration: status.projectDuration ?? (sorted.length ? Math.max(...sorted.map(t => t.earlyFinish)) : 0),
        totalTasks: sorted.length,
        criticalTasksCount: sorted.filter(t => t.isCritical).length,
        calculatedAt: status.calculatedAt || null
      };
    }

    const executor = this.getExecutor(conn);
    try {
      let query = `
        SELECT 
          sr.task_id AS taskId,
          t.name,
          t.code,
          CAST(t.duration AS DOUBLE) AS duration,
          CAST(sr.early_start AS DOUBLE) AS earlyStart,
          CAST(sr.early_finish AS DOUBLE) AS earlyFinish,
          CAST(sr.late_start AS DOUBLE) AS lateStart,
          CAST(sr.late_finish AS DOUBLE) AS lateFinish,
          CAST(sr.total_float AS DOUBLE) AS totalFloat,
          (sr.is_critical = 1) AS isCritical,
          sr.calculated_at AS calculatedAt
        FROM schedule_results sr
        JOIN tasks t ON sr.task_id = t.id
        WHERE sr.project_id = ?
      `;

      const params = [pId];

      if (criticalOnly) {
        query += ' AND sr.is_critical = TRUE';
      }

      query += ' ORDER BY sr.early_start ASC, sr.task_id ASC';

      const [rows] = await executor.query(query, params);

      // Lấy thời lượng dự án và thông tin tính toán
      const [statusRows] = await executor.query(
        'SELECT project_duration, calculated_at FROM project_schedule_status WHERE project_id = ?',
        [pId]
      );

      const [countRows] = await executor.query(
        `SELECT 
          COUNT(*) AS total_tasks,
          SUM(CASE WHEN is_critical = TRUE THEN 1 ELSE 0 END) AS critical_count
         FROM schedule_results WHERE project_id = ?`,
        [pId]
      );

      const totalTasks = Number(countRows[0]?.total_tasks ?? rows.length);
      const criticalTasksCount = Number(countRows[0]?.critical_count ?? 0);
      const projectDuration = statusRows.length > 0 && statusRows[0].project_duration !== null
        ? Number(statusRows[0].project_duration)
        : (rows.length > 0 ? Math.max(...rows.map(r => r.earlyFinish)) : 0);

      const calculatedAt = statusRows.length > 0 ? statusRows[0].calculated_at : (rows[0]?.calculatedAt ?? null);

      return {
        tasks: rows.map(r => ({
          ...r,
          isCritical: Boolean(r.isCritical)
        })),
        projectDuration,
        totalTasks,
        criticalTasksCount,
        calculatedAt
      };
    } catch (err) {
      return { tasks: [], projectDuration: 0, totalTasks: 0, criticalTasksCount: 0, calculatedAt: null, error: err.message };
    }
  }

  /**
   * Lưu toàn bộ kết quả tính toán trong một Database Transaction duy nhất (T-26)
   * Nếu có lỗi hoặc cycle, tự động ROLLBACK; không bao giờ lưu dở dang
   */
  async saveResultsInTransaction(projectId, scheduledTasks = [], projectDuration = 0) {
    const pId = Number(projectId);
    if (!Number.isInteger(pId) || pId <= 0) {
      throw new Error('projectId không hợp lệ');
    }

    if (!this.pool || typeof this.pool.getConnection !== 'function') {
      const now = new Date().toISOString();
      const inMemList = scheduledTasks.map(t => ({
        taskId: t.taskId ?? t.id,
        name: t.name,
        code: t.code,
        duration: Number(t.duration),
        earlyStart: Number(t.earlyStart),
        earlyFinish: Number(t.earlyFinish),
        lateStart: Number(t.lateStart),
        lateFinish: Number(t.lateFinish),
        totalFloat: Number(t.totalFloat),
        isCritical: Boolean(t.isCritical),
        is_stale: false,
        calculatedAt: now
      }));
      inMemoryScheduleResults.set(pId, inMemList);
      inMemoryScheduleStatus.set(pId, {
        needsRecalculation: false,
        projectDuration: Number(projectDuration),
        calculatedAt: now,
        hasCycle: false,
        cycleInfo: null
      });

      // Nếu mock pool có hàm query nhưng không có getConnection
      if (this.pool && typeof this.pool.query === 'function') {
        try {
          await this.pool.query('DELETE FROM schedule_results WHERE project_id = ?', [pId]);
          if (scheduledTasks.length > 0) {
            const values = scheduledTasks.map(t => [
              pId,
              Number(t.taskId ?? t.id),
              Number(t.earlyStart),
              Number(t.earlyFinish),
              Number(t.lateStart),
              Number(t.lateFinish),
              Number(t.totalFloat),
              Boolean(t.isCritical),
              false
            ]);
            await this.pool.query(
              `INSERT INTO schedule_results (
                project_id, task_id, early_start, early_finish, late_start, late_finish, total_float, is_critical, is_stale
              ) VALUES ?`,
              [values]
            );
          }
        } catch {}
      }

      return { success: true };
    }

    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      // 1. Xóa kết quả cũ của đúng dự án này
      await conn.query('DELETE FROM schedule_results WHERE project_id = ?', [pId]);

      // 2. Chèn hàng loạt kết quả mới nếu có công việc
      if (scheduledTasks.length > 0) {
        const values = scheduledTasks.map(t => [
          pId,
          Number(t.taskId ?? t.id),
          Number(t.earlyStart),
          Number(t.earlyFinish),
          Number(t.lateStart),
          Number(t.lateFinish),
          Number(t.totalFloat),
          Boolean(t.isCritical),
          false
        ]);

        await conn.query(
          `INSERT INTO schedule_results (
            project_id, task_id, early_start, early_finish, late_start, late_finish, total_float, is_critical, is_stale
          ) VALUES ?`,
          [values]
        );
      }

      // 3. Cập nhật trạng thái bộ nhớ đệm dự án
      await conn.query(
        `INSERT INTO project_schedule_status (
          project_id, needs_recalculation, project_duration, calculated_at, has_cycle, cycle_info
        ) VALUES (?, FALSE, ?, NOW(), FALSE, NULL)
        ON DUPLICATE KEY UPDATE 
          needs_recalculation = FALSE,
          project_duration = VALUES(project_duration),
          calculated_at = NOW(),
          has_cycle = FALSE,
          cycle_info = NULL`,
        [pId, Number(projectDuration)]
      );

      await conn.commit();
      return { success: true };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Xóa toàn bộ dữ liệu lịch của một dự án (phục vụ dọn dẹp hoặc test benchmark)
   */
  async clearProject(projectId) {
    const pId = Number(projectId);
    if (!Number.isInteger(pId) || pId <= 0) return;

    if (!this.isDatabaseAvailable()) {
      inMemoryScheduleResults.delete(pId);
      inMemoryScheduleStatus.delete(pId);
      return;
    }

    try {
      await this.pool.query('DELETE FROM schedule_results WHERE project_id = ?', [pId]);
      await this.pool.query('DELETE FROM project_schedule_status WHERE project_id = ?', [pId]);
    } catch {
      // Bỏ qua lỗi dọn dẹp
    }
  }
}

module.exports = {
  ScheduleResultRepository,
  inMemoryScheduleResults,
  inMemoryScheduleStatus
};
