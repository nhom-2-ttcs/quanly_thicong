const assert = require('node:assert');

const {
  calculateFS,
  calculateSS,
  calculateFF,
  calculateSF
} = require('../src/algorithms/dependencyConstraints');

console.log('--- T18: Dependency Constraints Tests ---');

// ============================================================
// TEST 1: Finish-to-Start (FS)
// Start(next) >= Finish(previous) + Lag
// ============================================================

assert.strictEqual(
  calculateFS(10, 2),
  12,
  'FS: Start sau phải bằng Finish trước + Lag'
);

assert.strictEqual(
  calculateFS(10, 0),
  10,
  'FS: Lag = 0 phải trả về Finish trước'
);

console.log('✓ FS tests passed');


// ============================================================
// TEST 2: Start-to-Start (SS)
// Start(next) >= Start(previous) + Lag
// ============================================================

assert.strictEqual(
  calculateSS(10, 2),
  12,
  'SS: Start sau phải bằng Start trước + Lag'
);

assert.strictEqual(
  calculateSS(10, 0),
  10,
  'SS: Lag = 0 phải trả về Start trước'
);

console.log('✓ SS tests passed');


// ============================================================
// TEST 3: Finish-to-Finish (FF)
// Finish(next) >= Finish(previous) + Lag
// ============================================================

assert.strictEqual(
  calculateFF(10, 2),
  12,
  'FF: Finish sau phải bằng Finish trước + Lag'
);

assert.strictEqual(
  calculateFF(10, 0),
  10,
  'FF: Lag = 0 phải trả về Finish trước'
);

console.log('✓ FF tests passed');


// ============================================================
// TEST 4: Start-to-Finish (SF)
// Finish(next) >= Start(previous) + Lag
// ============================================================

assert.strictEqual(
  calculateSF(10, 2),
  12,
  'SF: Finish sau phải bằng Start trước + Lag'
);

assert.strictEqual(
  calculateSF(10, 0),
  10,
  'SF: Lag = 0 phải trả về Start trước'
);

console.log('✓ SF tests passed');


// ============================================================
// TEST 5: Kiểm tra Lag âm
// ============================================================

assert.strictEqual(
  calculateFS(10, -2),
  8,
  'FS: Lag âm phải được tính đúng'
);

assert.strictEqual(
  calculateSS(10, -2),
  8,
  'SS: Lag âm phải được tính đúng'
);

assert.strictEqual(
  calculateFF(10, -2),
  8,
  'FF: Lag âm phải được tính đúng'
);

assert.strictEqual(
  calculateSF(10, -2),
  8,
  'SF: Lag âm phải được tính đúng'
);

console.log('✓ Negative lag tests passed');


// ============================================================
// TEST 6: Mỗi công thức có assertion riêng
//
// Nếu sửa sai một trong bốn hàm:
// calculateFS
// calculateSS
// calculateFF
// calculateSF
//
// assertion tương ứng sẽ fail.
// ============================================================

const formulas = [
  {
    name: 'FS',
    actual: calculateFS(20, 5),
    expected: 25
  },
  {
    name: 'SS',
    actual: calculateSS(20, 5),
    expected: 25
  },
  {
    name: 'FF',
    actual: calculateFF(20, 5),
    expected: 25
  },
  {
    name: 'SF',
    actual: calculateSF(20, 5),
    expected: 25
  }
];

for (const formula of formulas) {
  assert.strictEqual(
    formula.actual,
    formula.expected,
    `${formula.name}: công thức bị sai`
  );
}

console.log('✓ Independent formula assertions passed');


// ============================================================
// KẾT QUẢ
// ============================================================

console.log('--- T18: ALL TESTS PASSED ---');
