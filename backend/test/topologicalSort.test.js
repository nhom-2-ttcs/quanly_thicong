const assert = require('node:assert');

const {
  topologicalSort
} = require('../src/algorithms/topologicalSort');

console.log('--- T16: Topological Sort Tests ---');

// ============================================================
// TEST 1: K-01 - Thứ tự tô-pô cơ bản
// A -> B -> C
// ============================================================

const tasks = [
  { id: 'A', predecessors: [] },
  { id: 'B', predecessors: ['A'] },
  { id: 'C', predecessors: ['B'] }
];

const result = topologicalSort(tasks);

console.log('K-01 result:', result);

// Kiểm tra đủ số task
assert.strictEqual(
  result.length,
  3,
  'K-01: Kết quả phải có đủ 3 task'
);

// Kiểm tra A đứng trước B
assert.ok(
  result.indexOf('A') < result.indexOf('B'),
  'K-01: A phải đứng trước B'
);

// Kiểm tra B đứng trước C
assert.ok(
  result.indexOf('B') < result.indexOf('C'),
  'K-01: B phải đứng trước C'
);

console.log('✓ K-01 topological order passed');


// ============================================================
// TEST 2: Phát hiện chu trình
// A -> B -> C -> A
// ============================================================

const cyclicTasks = [
  { id: 'A', predecessors: ['C'] },
  { id: 'B', predecessors: ['A'] },
  { id: 'C', predecessors: ['B'] }
];

assert.throws(
  () => topologicalSort(cyclicTasks),
  /có chu trình/,
  'Phải phát hiện đồ thị có chu trình'
);

console.log('✓ Cycle detection passed');


// ============================================================
// TEST 3: 500 task - yêu cầu hiệu năng dưới 1 giây
// T0 -> T1 -> T2 -> ... -> T499
// ============================================================

const largeTasks = [];

for (let i = 0; i < 500; i++) {
  largeTasks.push({
    id: `T${i}`,
    predecessors: i === 0 ? [] : [`T${i - 1}`]
  });
}

const startTime = process.hrtime.bigint();

const largeResult = topologicalSort(largeTasks);

const endTime = process.hrtime.bigint();

const elapsedMs = Number(endTime - startTime) / 1_000_000;

console.log(
  `500-task execution time: ${elapsedMs.toFixed(3)} ms`
);

// Kiểm tra đủ 500 task
assert.strictEqual(
  largeResult.length,
  500,
  '500-task network phải trả về đủ 500 task'
);

// Kiểm tra thời gian dưới 1 giây
assert.ok(
  elapsedMs < 1000,
  `500-task network phải chạy dưới 1 giây, thực tế: ${elapsedMs.toFixed(3)} ms`
);

console.log('✓ 500-task performance test passed');


// ============================================================
// KẾT QUẢ
// ============================================================

console.log('--- T16: ALL TESTS PASSED ---');
