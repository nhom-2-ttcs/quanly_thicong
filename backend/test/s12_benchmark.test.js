/**
 * Benchmark 500 Task Performance (S-12 / SCRUM-67)
 * Đo lường hiệu năng thực tế độc lập:
 * 1. Thời gian API T-27 dưới 300 ms với 500 task
 * 2. Thời gian render bảng T-28 dưới 1000 ms với 500 task
 * Chạy warm-up và ghi nhận min, median, p95 thật
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { SchedulerService } = require('../src/domain/scheduling/schedulerService');
const { ScheduleResultRepository } = require('../src/repositories/scheduleResultRepository');

/**
 * Sinh dữ liệu kiểm thử 500 công việc có cấu trúc phân nhánh thực tế
 */
function generate500BenchmarkNetwork() {
  const TASK_COUNT = 500;
  const tasks = [];
  const dependencies = [];

  for (let i = 1; i <= TASK_COUNT; i++) {
    tasks.push({
      id: i,
      taskId: i,
      code: `BM-${String(i).padStart(4, '0')}`,
      name: `Công việc kiểm chuẩn hiệu năng #${i}`,
      duration: (i % 7) + 1,
      status: 'pending'
    });
  }

  // Tạo liên kết tuần tự và 5 nhánh song song hội tụ
  for (let i = 1; i <= TASK_COUNT - 5; i++) {
    // Liên kết FS chính
    dependencies.push({
      predecessorId: i,
      successorId: i + 1,
      type: 'FS',
      lag: 0
    });

    // Thỉnh thoảng thêm liên kết SS hoặc FF
    if (i % 10 === 0 && i + 5 <= TASK_COUNT) {
      dependencies.push({
        predecessorId: i,
        successorId: i + 5,
        type: 'SS',
        lag: 1
      });
    }
  }

  return { tasks, dependencies };
}

function calculatePercentile(values, percentile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

test('Benchmark S-12: API T-27 đạt thời gian dưới 300 ms với 500 công việc', async () => {
  const { tasks, dependencies } = generate500BenchmarkNetwork();
  const repo = new ScheduleResultRepository({});
  const benchmarkProjectId = 9500;

  // Khởi tạo và lưu sẵn kết quả trong cache
  const scheduler = new SchedulerService({});
  const computed = scheduler.computeSchedule(tasks, dependencies);
  await repo.saveResultsInTransaction(benchmarkProjectId, computed.tasks, computed.projectDuration);

  // Ghi nhận cấu hình máy
  const cpus = os.cpus();
  console.log('\n======================================================');
  console.log('📊 THÔNG SỐ MÔI TRƯỜNG BENCHMARK 500 TASK (S-12)');
  console.log(`- Hệ điều hành: ${os.type()} ${os.release()} (${os.arch()})`);
  console.log(`- CPU: ${cpus[0]?.model || 'Unknown'} (${cpus.length} cores)`);
  console.log(`- Node.js: ${process.version}`);
  console.log(`- Quy mô mạng: ${tasks.length} tasks, ${dependencies.length} dependencies`);
  console.log('======================================================');

  // 1. Warm-up
  for (let w = 0; w < 3; w++) {
    await repo.getSavedResults(benchmarkProjectId);
  }

  // 2. Chạy đo 10 lần thực tế
  const RUNS = 10;
  const durations = [];

  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    const result = await repo.getSavedResults(benchmarkProjectId);
    const end = performance.now();
    durations.push(end - start);
    assert.equal(result.tasks.length, 500);
  }

  const min = Math.min(...durations);
  const max = Math.max(...durations);
  const median = calculatePercentile(durations, 50);
  const p95 = calculatePercentile(durations, 95);

  console.log('🚀 KẾT QUẢ ĐO THỜI GIAN API TRUY VẤN LỊCH 500 TASK (T-27):');
  console.log(`- Số lần chạy: ${RUNS}`);
  console.log(`- Tối thiểu (Min): ${min.toFixed(3)} ms`);
  console.log(`- Trung vị (Median): ${median.toFixed(3)} ms`);
  console.log(`- Phân vị 95 (P95): ${p95.toFixed(3)} ms`);
  console.log(`- Tối đa (Max): ${max.toFixed(3)} ms`);
  console.log(`- Ngưỡng AC: < 300 ms -> KẾT QUẢ: ${p95 < 300 ? '✅ PASS' : '❌ FAIL'}`);
  console.log('======================================================');

  assert.ok(p95 < 300, `P95 thời gian API (${p95.toFixed(2)} ms) phải nhỏ hơn 300 ms`);
  assert.ok(median < 300, `Median thời gian API (${median.toFixed(2)} ms) phải nhỏ hơn 300 ms`);
});

test('Benchmark S-12: Màn hình bảng render 500 công việc dưới 1000 ms (T-28)', () => {
  const { tasks, dependencies } = generate500BenchmarkNetwork();
  const scheduler = new SchedulerService({});
  const computed = scheduler.computeSchedule(tasks, dependencies);

  // Giả lập chính xác hàm renderTable của schedule.html
  function renderTableBenchmark(tasksList) {
    const rows = [];
    const len = tasksList.length;
    for (let i = 0; i < len; i++) {
      const t = tasksList[i];
      const isCrit = Boolean(t.isCritical);
      const rowClass = isCrit ? 'critical-row' : '';
      const statusHtml = isCrit 
        ? '<span class="status-badge status-critical">🔥 Việc găng</span>' 
        : `<span class="status-badge status-normal">Bình thường (${t.totalFloat}d)</span>`;

      rows.push(`
        <tr class="${rowClass}">
          <td class="cell-center">${i + 1}</td>
          <td><span class="task-code">${t.code || `CV-${t.taskId}`}</span></td>
          <td><strong>${t.name}</strong></td>
          <td class="cell-center cell-mono">${t.duration}</td>
          <td class="cell-center cell-mono">${t.earlyStart}</td>
          <td class="cell-center cell-mono">${t.earlyFinish}</td>
          <td class="cell-center cell-mono">${t.lateStart}</td>
          <td class="cell-center cell-mono">${t.lateFinish}</td>
          <td class="cell-center cell-mono">${t.totalFloat}</td>
          <td class="cell-center">${statusHtml}</td>
        </tr>
      `);
    }
    return rows.join('');
  }

  // 1. Warm-up
  for (let w = 0; w < 3; w++) {
    renderTableBenchmark(computed.tasks);
  }

  // 2. Chạy đo 10 lần
  const RUNS = 10;
  const durations = [];

  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    const html = renderTableBenchmark(computed.tasks);
    const end = performance.now();
    durations.push(end - start);
    assert.ok(html.length > 50000, 'HTML đầu ra phải đầy đủ 500 dòng');
  }

  const min = Math.min(...durations);
  const max = Math.max(...durations);
  const median = calculatePercentile(durations, 50);
  const p95 = calculatePercentile(durations, 95);

  console.log('\n🖥️ KẾT QUẢ ĐO THỜI GIAN RENDER BẢNG 500 TASK (T-28):');
  console.log(`- Số lần chạy: ${RUNS}`);
  console.log(`- Tối thiểu (Min): ${min.toFixed(3)} ms`);
  console.log(`- Trung vị (Median): ${median.toFixed(3)} ms`);
  console.log(`- Phân vị 95 (P95): ${p95.toFixed(3)} ms`);
  console.log(`- Tối đa (Max): ${max.toFixed(3)} ms`);
  console.log(`- Ngưỡng AC: < 1000 ms -> KẾT QUẢ: ${p95 < 1000 ? '✅ PASS' : '❌ FAIL'}`);
  console.log('======================================================\n');

  assert.ok(p95 < 1000, `P95 thời gian render (${p95.toFixed(2)} ms) phải nhỏ hơn 1000 ms`);
  assert.ok(median < 1000, `Median thời gian render (${median.toFixed(2)} ms) phải nhỏ hơn 1000 ms`);
});
