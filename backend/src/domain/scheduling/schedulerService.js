/**
 * Scheduler Service (S-07 / SCRUM-62)
 * Tích hợp công việc (S-05) với quan hệ phụ thuộc (S-06)
 */

const { TaskDependencyGraph } = require('./graph');
const { topologicalSort } = require('./topologicalSort');
const { validateDependencyContract } = require('./contracts');

class SchedulerService {
  constructor(db) {
    this.db = db;
    this.pool = db?.pool || db;
  }

  /**
   * Tính toán thứ tự phụ thuộc từ danh sách tasks và dependencies truyền vào
   * @param {Array<Object>} tasks Danh sách công việc (S-05)
   * @param {Array<Object>} dependencies Danh sách quan hệ phụ thuộc (S-06 contract)
   */
  computeSchedule(tasks = [], dependencies = []) {
    // 1. Validate các dependency records theo contract
    const validEdges = [];
    for (const dep of dependencies) {
      const val = validateDependencyContract(dep);
      if (!val.valid) {
        // Nếu là self-loop, cho phép đồ thị phát hiện để báo chi tiết
        if (val.error && val.error.includes('Self-loop')) {
          validEdges.push(dep);
        } else {
          return {
            success: false,
            hasCycle: false,
            error: val.error,
            message: `Lỗi hợp đồng quan hệ phụ thuộc: ${val.error}`
          };
        }
      } else {
        validEdges.push(dep);
      }
    }

    // 2. Xây dựng đồ thị
    const graph = new TaskDependencyGraph();
    graph.setNodes(tasks);
    graph.setEdges(validEdges);

    // 3. Thực hiện Topological Sort & Cycle Detection
    const result = topologicalSort(graph);
    return {
      ...result,
      nodeCount: graph.getNodeCount(),
      edgeCount: graph.getEdgeCount()
    };
  }

  /**
   * Tính toán thứ tự cho một dự án cụ thể từ cơ sở dữ liệu
   * @param {number} projectId 
   * @param {Array<Object>} [mockDependencies] Tùy chọn mock dependencies khi S-06 chưa có bảng CSDL
   */
  async getProjectSchedule(projectId, mockDependencies = null) {
    if (!this.pool) {
      throw new Error('Database pool chưa được khởi tạo');
    }

    // 1. Đọc tasks của dự án từ S-05
    const [tasks] = await this.pool.query(
      'SELECT id, project_id, work_item_id, name, code, duration, status FROM tasks WHERE project_id = ? ORDER BY id ASC',
      [projectId]
    );

    // 2. Đọc dependencies (S-06)
    let dependencies = [];
    let integrationStatus = 'READY';

    if (mockDependencies !== null && Array.isArray(mockDependencies)) {
      dependencies = mockDependencies;
      integrationStatus = 'USING_MOCK_DEPENDENCIES';
    } else {
      // Kiểm tra xem bảng task_dependencies (S-06) đã được tạo bởi thành viên khác chưa
      try {
        const [tables] = await this.pool.query(
          "SHOW TABLES LIKE 'task_dependencies'"
        );
        if (tables && tables.length > 0) {
          const [deps] = await this.pool.query(
            'SELECT * FROM task_dependencies WHERE project_id = ?',
            [projectId]
          );
          dependencies = deps;
        } else {
          // Bảng chưa được tạo bởi thành viên S-06 -> Báo đúng trạng thái blocked theo Quy tắc 2
          integrationStatus = 'BLOCKED BY S-06 INTEGRATION';
        }
      } catch (e) {
        integrationStatus = 'BLOCKED BY S-06 INTEGRATION';
      }
    }

    const scheduleResult = this.computeSchedule(tasks, dependencies);

    return {
      projectId,
      integrationStatus,
      ...scheduleResult
    };
  }
}

module.exports = {
  SchedulerService
};
