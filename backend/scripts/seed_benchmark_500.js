/**
 * Script khởi tạo dữ liệu benchmark 500 tasks trong MySQL container
 * Đảm bảo idempotent, cô lập ở project_id = 9500, không làm ảnh hưởng dữ liệu chính
 */

const mysql = require('mysql2/promise');
const { SchedulerService } = require('../src/domain/scheduling/schedulerService');

async function seedBenchmarkData() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'secret',
    database: process.env.DB_NAME || 'quanly_thicong'
  });

  try {
    console.log('Đang kết nối CSDL và tạo dữ liệu dự án benchmark 9500...');

    // 1. Tạo Project 9500
    await connection.query(`
      INSERT INTO projects (id, name, code, description)
      VALUES (9500, 'Dự án Benchmark 500 Công việc', 'PRJ-BM500', 'Dự án đo kiểm chuẩn hiệu năng Sprint 2 S-12')
      ON DUPLICATE KEY UPDATE name = VALUES(name)
    `);

    // 2. Tạo Work Item 9500
    await connection.query(`
      INSERT INTO work_items (id, project_id, name, code)
      VALUES (9500, 9500, 'Hạng mục Benchmark 500 Công việc', 'WBS-BM500')
      ON DUPLICATE KEY UPDATE name = VALUES(name)
    `);

    // 3. Chuẩn bị 500 tasks và 544 dependencies
    const TASK_COUNT = 500;
    const tasks = [];
    const dependencies = [];

    for (let i = 1; i <= TASK_COUNT; i++) {
      const taskId = 9500000 + i;
      tasks.push({
        id: taskId,
        taskId: taskId,
        projectId: 9500,
        workItemId: 9500,
        code: `BM-${String(i).padStart(4, '0')}`,
        name: `Công việc kiểm chuẩn hiệu năng #${i}`,
        duration: (i % 7) + 1,
        status: 'pending'
      });
    }

    for (let i = 1; i <= TASK_COUNT - 5; i++) {
      const predId = 9500000 + i;
      const succId = 9500000 + i + 1;
      dependencies.push({
        predecessorId: predId,
        successorId: succId,
        type: 'FS',
        lag: 0
      });

      if (i % 10 === 0 && i + 5 <= TASK_COUNT) {
        dependencies.push({
          predecessorId: predId,
          successorId: 9500000 + i + 5,
          type: 'SS',
          lag: 1
        });
      }
    }

    // 4. Batch insert Tasks vào CSDL
    console.log(`Đang nạp ${tasks.length} tasks vào CSDL...`);
    const taskValues = tasks.map(t => [t.id, t.projectId, t.workItemId, t.name, t.code, t.duration, t.status]);
    await connection.query(`
      INSERT INTO tasks (id, project_id, work_item_id, name, code, duration, status)
      VALUES ?
      ON DUPLICATE KEY UPDATE 
        name = VALUES(name),
        duration = VALUES(duration)
    `, [taskValues]);

    // 5. Batch insert Dependencies
    console.log(`Đang nạp ${dependencies.length} dependencies vào CSDL...`);
    await connection.query('DELETE FROM task_dependencies WHERE project_id = 9500');
    const depValues = dependencies.map((d, idx) => [
      9500000 + idx + 1,
      9500,
      d.predecessorId,
      d.successorId,
      d.type,
      d.lag
    ]);
    await connection.query(`
      INSERT INTO task_dependencies (id, project_id, predecessor_task_id, successor_task_id, dependency_type, lag_days)
      VALUES ?
    `, [depValues]);

    // 6. Tính toán CPM và lưu kết quả vào schedule_results
    console.log('Đang tính toán CPM và lưu cache schedule_results trong CSDL...');
    const scheduler = new SchedulerService({});
    const computed = scheduler.computeSchedule(tasks, dependencies);

    const { ScheduleResultRepository } = require('../src/repositories/scheduleResultRepository');
    const repo = new ScheduleResultRepository(connection);
    await repo.saveResultsInTransaction(9500, computed.tasks, computed.projectDuration);

    console.log('✅ Khởi tạo dữ liệu benchmark 500 tasks hoàn tất thành công!');
  } catch (err) {
    console.error('Lỗi khởi tạo benchmark:', err);
    throw err;
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  seedBenchmarkData().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { seedBenchmarkData };
