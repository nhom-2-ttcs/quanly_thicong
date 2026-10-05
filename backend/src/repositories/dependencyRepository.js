/**
 * Dependency Repository (S-06 / SCRUM-61)
 * Thao tác dữ liệu bảng task_dependencies với MySQL và fallback in-memory (phục vụ unit test)
 */

class DependencyRepository {
  constructor(db) {
    this.db = db;
    this.pool = db?.pool || db;
    // In-memory fallback khi chạy môi trường test không có MySQL
    this.inMemoryDeps = [];
    this.nextId = 1;
  }

  getExecutor(conn) {
    return conn || this.pool;
  }

  async getProjectById(projectId, conn = null) {
    const executor = this.getExecutor(conn);
    if (!executor?.query) {
      return { id: Number(projectId), name: 'Dự án Mẫu', code: 'DA-01' };
    }
    const [rows] = await executor.query('SELECT id, name, code FROM projects WHERE id = ?', [projectId]);
    return rows && rows.length > 0 ? rows[0] : null;
  }

  async getTaskById(taskId, conn = null) {
    const executor = this.getExecutor(conn);
    if (!executor?.query) {
      return null;
    }
    const [rows] = await executor.query('SELECT id, project_id, work_item_id, name, code, duration, status FROM tasks WHERE id = ?', [taskId]);
    return rows && rows.length > 0 ? rows[0] : null;
  }

  async findAllByProjectId(projectId, conn = null) {
    const executor = this.getExecutor(conn);
    if (!executor?.query) {
      return this.inMemoryDeps.filter(d => Number(d.project_id) === Number(projectId));
    }

    const [rows] = await executor.query(`
      SELECT
        d.id,
        d.project_id,
        d.predecessor_task_id,
        d.successor_task_id,
        d.dependency_type,
        d.lag_days,
        d.created_at,
        d.updated_at,
        tp.name AS predecessor_task_name,
        tp.code AS predecessor_task_code,
        ts.name AS successor_task_name,
        ts.code AS successor_task_code
      FROM task_dependencies d
      JOIN tasks tp ON d.predecessor_task_id = tp.id
      JOIN tasks ts ON d.successor_task_id = ts.id
      WHERE d.project_id = ?
      ORDER BY d.id ASC
    `, [projectId]);

    return rows;
  }

  async findById(id, conn = null) {
    const executor = this.getExecutor(conn);
    if (!executor?.query) {
      return this.inMemoryDeps.find(d => Number(d.id) === Number(id)) || null;
    }

    const [rows] = await executor.query(`
      SELECT
        d.id,
        d.project_id,
        d.predecessor_task_id,
        d.successor_task_id,
        d.dependency_type,
        d.lag_days,
        d.created_at,
        d.updated_at,
        tp.name AS predecessor_task_name,
        tp.code AS predecessor_task_code,
        ts.name AS successor_task_name,
        ts.code AS successor_task_code
      FROM task_dependencies d
      JOIN tasks tp ON d.predecessor_task_id = tp.id
      JOIN tasks ts ON d.successor_task_id = ts.id
      WHERE d.id = ?
    `, [id]);

    return rows && rows.length > 0 ? rows[0] : null;
  }

  async findByPair(predId, succId, conn = null) {
    const executor = this.getExecutor(conn);
    if (!executor?.query) {
      return this.inMemoryDeps.find(
        d => Number(d.predecessor_task_id) === Number(predId) && Number(d.successor_task_id) === Number(succId)
      ) || null;
    }

    const [rows] = await executor.query(`
      SELECT * FROM task_dependencies
      WHERE predecessor_task_id = ? AND successor_task_id = ?
    `, [predId, succId]);

    return rows && rows.length > 0 ? rows[0] : null;
  }

  async countByTaskId(taskId, conn = null) {
    const executor = this.getExecutor(conn);
    if (!executor?.query) {
      return this.inMemoryDeps.filter(
        d => Number(d.predecessor_task_id) === Number(taskId) || Number(d.successor_task_id) === Number(taskId)
      ).length;
    }

    const [rows] = await executor.query(`
      SELECT COUNT(*) AS total FROM task_dependencies
      WHERE predecessor_task_id = ? OR successor_task_id = ?
    `, [taskId, taskId]);

    return rows && rows[0] ? Number(rows[0].total) : 0;
  }

  async create({ projectId, predecessorTaskId, successorTaskId, dependencyType, lagDays }, conn = null) {
    const executor = this.getExecutor(conn);
    if (!executor?.query) {
      const newId = this.nextId++;
      const item = {
        id: newId,
        project_id: Number(projectId),
        predecessor_task_id: Number(predecessorTaskId),
        successor_task_id: Number(successorTaskId),
        dependency_type: dependencyType,
        lag_days: Number(lagDays),
        created_at: new Date(),
        updated_at: new Date()
      };
      this.inMemoryDeps.push(item);
      return item;
    }

    const [result] = await executor.query(`
      INSERT INTO task_dependencies (project_id, predecessor_task_id, successor_task_id, dependency_type, lag_days)
      VALUES (?, ?, ?, ?, ?)
    `, [projectId, predecessorTaskId, successorTaskId, dependencyType, lagDays]);

    return this.findById(result.insertId, conn);
  }

  async update(id, { dependencyType, lagDays }, conn = null) {
    const executor = this.getExecutor(conn);
    if (!executor?.query) {
      const item = this.inMemoryDeps.find(d => Number(d.id) === Number(id));
      if (!item) return null;
      if (dependencyType !== undefined) item.dependency_type = dependencyType;
      if (lagDays !== undefined) item.lag_days = Number(lagDays);
      item.updated_at = new Date();
      return item;
    }

    await executor.query(`
      UPDATE task_dependencies
      SET dependency_type = COALESCE(?, dependency_type),
          lag_days = COALESCE(?, lag_days)
      WHERE id = ?
    `, [dependencyType, lagDays, id]);

    return this.findById(id, conn);
  }

  async delete(id, conn = null) {
    const executor = this.getExecutor(conn);
    if (!executor?.query) {
      const idx = this.inMemoryDeps.findIndex(d => Number(d.id) === Number(id));
      if (idx !== -1) {
        this.inMemoryDeps.splice(idx, 1);
        return true;
      }
      return false;
    }

    const [result] = await executor.query('DELETE FROM task_dependencies WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }
}

module.exports = {
  DependencyRepository
};
