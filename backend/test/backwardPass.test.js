const assert = require('assert');
const { calculateForwardPass } = require('../src/algorithms/forwardPass');
const { calculateBackwardPass } = require('../src/algorithms/backwardPass');

function testBackwardPass() {
  console.log('--- Đang chạy test cho S-09 (T-20 & T-21) ---');

  // Mạng mẫu thử nghiệm:
  // T1 (3 ngày) -> FS -> T2 (4 ngày) -> FS -> T4 (2 ngày) (Nhánh găng: 3 + 4 + 2 = 9 ngày)
  // T1 (3 ngày) -> FS -> T3 (2 ngày) -> FS -> T4 (Nhánh phụ: 3 + 2 + 2 = 7 ngày)
  const tasks = [
    { id: 'T1', duration: 3, predecessors: [] },
    { id: 'T2', duration: 4, predecessors: [{ id: 'T1', type: 'FS', lag: 0 }] },
    { id: 'T3', duration: 2, predecessors: [{ id: 'T1', type: 'FS', lag: 0 }] },
    { id: 'T4', duration: 2, predecessors: [
      { id: 'T2', type: 'FS', lag: 0 },
      { id: 'T3', type: 'FS', lag: 0 }
    ]}
  ];

  const topoOrder = ['T1', 'T2', 'T3', 'T4'];
  const forwardResults = calculateForwardPass(tasks, topoOrder, 0);
  const backwardResults = calculateBackwardPass(forwardResults, tasks, topoOrder);

  const resultMap = new Map(backwardResults.map(t => [t.id, t]));

  // 1. Kiểm tra ngày hoàn thành dự án = 9
  assert.strictEqual(resultMap.get('T4').earlyFinish, 9, 'T4 earlyFinish phải bằng 9');
  assert.strictEqual(resultMap.get('T4').lateFinish, 9, 'T4 lateFinish phải bằng 9');

  // 2. Kiểm tra đường găng T1 -> T2 -> T4
  assert.strictEqual(resultMap.get('T1').totalFloat, 0, 'T1 float phải bằng 0');
  assert.strictEqual(resultMap.get('T1').isCritical, true, 'T1 phải là việc găng');

  assert.strictEqual(resultMap.get('T2').totalFloat, 0, 'T2 float phải bằng 0');
  assert.strictEqual(resultMap.get('T2').isCritical, true, 'T2 phải là việc găng');

  assert.strictEqual(resultMap.get('T4').totalFloat, 0, 'T4 float phải bằng 0');
  assert.strictEqual(resultMap.get('T4').isCritical, true, 'T4 phải là việc găng');

  // 3. Kiểm tra nhánh phụ T3: có độ trễ = 9 - 7 = 2 ngày
  assert.strictEqual(resultMap.get('T3').totalFloat, 2, 'T3 totalFloat phải bằng chênh lệch 2 ngày');
  assert.strictEqual(resultMap.get('T3').isCritical, false, 'T3 không phải là việc găng');

  console.log('✅ Toàn bộ bài test S-09 (T-20 & T-21) đã pass!');
}

try {
  testBackwardPass();
} catch (error) {
  console.error('❌ Test thất bại:', error.message);
  process.exit(1);
}
