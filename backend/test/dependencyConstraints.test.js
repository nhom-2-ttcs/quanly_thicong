const assert = require('node:assert');

const {
  calculateFS,
  calculateSS,
  calculateFF,
  calculateSF
} = require('../src/algorithms/dependencyConstraints');

console.log('--- T18: Dependency Constraints Tests ---');

// FS
assert.strictEqual(
  calculateFS(10, 2),
  12,
  'FS: Start sau phải bằng Finish trước + Lag'
);

// SS
assert.strictEqual(
  calculateSS(10, 2),
  12,
  'SS: Start sau phải bằng Start trước + Lag'
);

// FF
assert.strictEqual(
  calculateFF(10, 2),
  12,
  'FF: Finish sau phải bằng Finish trước + Lag'
);

// SF
assert.strictEqual(
  calculateSF(10, 2),
  12,
  'SF: Finish sau phải bằng Start trước + Lag'
);

// Kiểm tra lag mặc định = 0
assert.strictEqual(calculateFS(10), 10);
assert.strictEqual(calculateSS(10), 10);
assert.strictEqual(calculateFF(10), 10);
assert.strictEqual(calculateSF(10), 10);

console.log('✓ FS test passed');
console.log('✓ SS test passed');
console.log('✓ FF test passed');
console.log('✓ SF test passed');
console.log('✓ Default lag test passed');
console.log('--- T18: ALL TESTS PASSED ---');
