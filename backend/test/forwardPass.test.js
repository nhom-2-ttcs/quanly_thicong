const assert = require('node:assert');

const {
  calculateForwardPass
} = require('../src/algorithms/forwardPass');

console.log('--- T19: Forward Pass Tests ---');

// ============================================================
// TEST 1: K-01
// ============================================================

const tasks = [
  {
    id: 'A',
    duration: 5,
    predecessors: []
  },
  {
    id: 'B',
    duration: 3,
    predecessors: [
      {
        id: 'A',
        type: 'FS',
        lag: 0
      }
    ]
  },
  {
    id: 'C',
    duration: 4,
    predecessors: [
      {
        id: 'B',
        type: 'FS',
        lag: 0
      }
    ]
  }
];

const topologicalOrder = ['A', 'B', 'C'];

const result = calculateForwardPass(
  tasks,
  topologicalOrder,
  0
);

console.log('K-01 result:', result);

// A: ES = 0, EF = 5
assert.strictEqual(
  result[0].earlyStart,
  0,
  'K-01: A phải bắt đầu từ projectStart'
);

assert.strictEqual(
  result[0].earlyFinish,
  5,
  'K-01: EF(A) phải bằng ES(A) + duration'
);

// B: ES = 5, EF = 8
assert.strictEqual(
  result[1].earlyStart,
  5,
  'K-01: ES(B) phải bằng EF(A)'
);

assert.strictEqual(
  result[1].earlyFinish,
  8,
  'K-01: EF(B) phải bằng ES(B) + duration'
);

// C: ES = 8, EF = 12
assert.strictEqual(
  result[2].earlyStart,
  8,
  'K-01: ES(C) phải bằng EF(B)'
);

assert.strictEqual(
  result[2].earlyFinish,
  12,
  'K-01: EF(C) phải bằng ES(C) + duration'
);

console.log('✓ K-01 forward pass passed');

// ============================================================
// TEST 2: Finish-to-Start (FS)
// ============================================================

const fsTasks = [
  {
    id: 'A',
    duration: 10,
    predecessors: []
  },
  {
    id: 'B',
    duration: 5,
    predecessors: [
      {
        id: 'A',
        type: 'FS',
        lag: 2
      }
    ]
  }
];

const fsResult = calculateForwardPass(
  fsTasks,
  ['A', 'B']
);

assert.strictEqual(
  fsResult[1].earlyStart,
  12,
  'FS: ES(B) = EF(A) + Lag'
);

assert.strictEqual(
  fsResult[1].earlyFinish,
  17,
  'FS: EF(B) = ES(B) + duration'
);

console.log('✓ FS forward pass passed');

// ============================================================
// TEST 3: Start-to-Start (SS)
// ============================================================

const ssTasks = [
  {
    id: 'A',
    duration: 10,
    predecessors: []
  },
  {
    id: 'B',
    duration: 5,
    predecessors: [
      {
        id: 'A',
        type: 'SS',
        lag: 2
      }
    ]
  }
];

const ssResult = calculateForwardPass(
  ssTasks,
  ['A', 'B']
);

assert.strictEqual(
  ssResult[1].earlyStart,
  2,
  'SS: ES(B) = ES(A) + Lag'
);

assert.strictEqual(
  ssResult[1].earlyFinish,
  7,
  'SS: EF(B) = ES(B) + duration'
);

console.log('✓ SS forward pass passed');

// ============================================================
// TEST 4: Finish-to-Finish (FF)
// ============================================================

const ffTasks = [
  {
    id: 'A',
    duration: 10,
    predecessors: []
  },
  {
    id: 'B',
    duration: 5,
    predecessors: [
      {
        id: 'A',
        type: 'FF',
        lag: 2
      }
    ]
  }
];

const ffResult = calculateForwardPass(
  ffTasks,
  ['A', 'B']
);

assert.strictEqual(
  ffResult[1].earlyStart,
  7,
  'FF: ES(B) phải được suy ra từ EF(A) + Lag - duration(B)'
);

assert.strictEqual(
  ffResult[1].earlyFinish,
  12,
  'FF: EF(B) = EF(A) + Lag'
);

console.log('✓ FF forward pass passed');

// ============================================================
// TEST 5: Start-to-Finish (SF)
// ============================================================

const sfTasks = [
  {
    id: 'A',
    duration: 10,
    predecessors: []
  },
  {
    id: 'B',
    duration: 5,
    predecessors: [
      {
        id: 'A',
        type: 'SF',
        lag: 2
      }
    ]
  }
];

const sfResult = calculateForwardPass(
  sfTasks,
  ['A', 'B']
);

// SF constraint:
// Finish(B) >= Start(A) + Lag
// Start(A) = 0, Lag = 2
// => Finish(B) >= 2
//
// Vì projectStart = 0 nên B không được bắt đầu trước 0.
// Do đó ES(B) = 0, EF(B) = 5.

assert.strictEqual(
  sfResult[1].earlyStart,
  0,
  'SF: Early Start không được trước projectStart'
);

assert.strictEqual(
  sfResult[1].earlyFinish,
  5,
  'SF: Early Finish = Early Start + duration'
);

console.log('✓ SF forward pass passed');

// ============================================================
// TEST 6: Nhiều predecessor -> lấy ràng buộc lớn nhất
// ============================================================

const multipleTasks = [
  {
    id: 'A',
    duration: 5,
    predecessors: []
  },
  {
    id: 'B',
    duration: 10,
    predecessors: []
  },
  {
    id: 'C',
    duration: 3,
    predecessors: [
      {
        id: 'A',
        type: 'FS',
        lag: 0
      },
      {
        id: 'B',
        type: 'FS',
        lag: 2
      }
    ]
  }
];

const multipleResult = calculateForwardPass(
  multipleTasks,
  ['A', 'B', 'C']
);

// A: EF = 5
// B: EF = 10
// C:
//   constraint từ A = 5
//   constraint từ B = 10 + 2 = 12
// => ES(C) = 12
// => EF(C) = 15

assert.strictEqual(
  multipleResult[2].earlyStart,
  12,
  'C phải lấy ràng buộc lớn nhất từ các predecessor'
);

assert.strictEqual(
  multipleResult[2].earlyFinish,
  15,
  'EF(C) = ES(C) + duration'
);

console.log('✓ Multiple predecessor max constraint passed');

// ============================================================
// TỔNG KẾT
// ============================================================

console.log('--- T19: ALL TESTS PASSED ---');
