const test = require('node:test');
const assert = require('node:assert');
const { TaskDependencyGraph } = require('../src/domain/scheduling/graph');
const { topologicalSort } = require('../src/domain/scheduling/topologicalSort');
const { SchedulerService } = require('../src/domain/scheduling/schedulerService');
const { validateDependencyContract } = require('../src/domain/scheduling/contracts');

test('S-07 Test 1: Đồ thị rỗng (0 node)', () => {
  const graph = new TaskDependencyGraph();
  const result = topologicalSort(graph);

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.hasCycle, false);
  assert.deepStrictEqual(result.orderedIds, []);
});

test('S-07 Test 2: Đồ thị 1 node duy nhất không có cạnh', () => {
  const graph = new TaskDependencyGraph();
  graph.addNode({ id: 10, name: 'Đào móng', duration: 3 });
  const result = topologicalSort(graph);

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.hasCycle, false);
  assert.deepStrictEqual(result.orderedIds, [10]);
});

test('S-07 Test 3: Đồ thị tuyến tính A -> B -> C', () => {
  const graph = new TaskDependencyGraph();
  graph.setNodes([
    { id: 1, code: 'A', name: 'Đào đất' },
    { id: 2, code: 'B', name: 'Đổ bê tông lót' },
    { id: 3, code: 'C', name: 'Lắp cốt thép' }
  ]);
  graph.addEdge({ predecessorId: 1, successorId: 2, type: 'FS', lag: 0 });
  graph.addEdge({ predecessorId: 2, successorId: 3, type: 'FS', lag: 0 });

  const result = topologicalSort(graph);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.hasCycle, false);
  assert.deepStrictEqual(result.orderedIds, [1, 2, 3]);
});

test('S-07 Test 4: Đồ thị phân nhánh A -> B và A -> C', () => {
  const graph = new TaskDependencyGraph();
  graph.setNodes([
    { id: 1, code: 'A' },
    { id: 2, code: 'B' },
    { id: 3, code: 'C' }
  ]);
  graph.addEdge({ predecessorId: 1, successorId: 2 });
  graph.addEdge({ predecessorId: 1, successorId: 3 });

  const result = topologicalSort(graph);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.hasCycle, false);
  assert.strictEqual(result.orderedIds[0], 1, 'Node 1 phải đứng đầu');
  assert.deepStrictEqual(result.orderedIds, [1, 2, 3], 'Kết quả deterministic theo ID');
});

test('S-07 Test 5: Đồ thị hội tụ A -> C và B -> C', () => {
  const graph = new TaskDependencyGraph();
  graph.setNodes([
    { id: 1, code: 'A' },
    { id: 2, code: 'B' },
    { id: 3, code: 'C' }
  ]);
  graph.addEdge({ predecessorId: 1, successorId: 3 });
  graph.addEdge({ predecessorId: 2, successorId: 3 });

  const result = topologicalSort(graph);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.hasCycle, false);
  assert.strictEqual(result.orderedIds[2], 3, 'Node 3 phải đứng cuối cùng sau cả 1 và 2');
  assert.deepStrictEqual(result.orderedIds, [1, 2, 3]);
});

test('S-07 Test 6: Đồ thị có các thành phần rời nhau (disconnected components)', () => {
  const graph = new TaskDependencyGraph();
  // Component 1: 1 -> 2
  // Component 2: 3 -> 4
  // Component 3: 5 (isolated)
  graph.setNodes([
    { id: 1, code: 'T1' },
    { id: 2, code: 'T2' },
    { id: 3, code: 'T3' },
    { id: 4, code: 'T4' },
    { id: 5, code: 'T5' }
  ]);
  graph.addEdge({ predecessorId: 1, successorId: 2 });
  graph.addEdge({ predecessorId: 3, successorId: 4 });

  const result = topologicalSort(graph);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.hasCycle, false);
  assert.strictEqual(result.orderedIds.length, 5);

  const idx1 = result.orderedIds.indexOf(1);
  const idx2 = result.orderedIds.indexOf(2);
  const idx3 = result.orderedIds.indexOf(3);
  const idx4 = result.orderedIds.indexOf(4);

  assert.ok(idx1 < idx2, '1 phải đứng trước 2');
  assert.ok(idx3 < idx4, '3 phải đứng trước 4');
});

test('S-07 Test 7: Phát hiện Self-loop A -> A', () => {
  const graph = new TaskDependencyGraph();
  graph.addNode({ id: 1, code: 'A', name: 'Thi công cọc' });
  graph.addEdge({ predecessorId: 1, successorId: 1 });

  const result = topologicalSort(graph);
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.hasCycle, true);
  assert.deepStrictEqual(result.cycleNodes, [1, 1]);
  assert.ok(result.message.includes('Self-loop'));
});

test('S-07 Test 8: Phát hiện Vòng 2 node: A -> B -> A', () => {
  const graph = new TaskDependencyGraph();
  graph.setNodes([
    { id: 1, code: 'A' },
    { id: 2, code: 'B' }
  ]);
  graph.addEdge({ predecessorId: 1, successorId: 2 });
  graph.addEdge({ predecessorId: 2, successorId: 1 });

  const result = topologicalSort(graph);
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.hasCycle, true);
  assert.ok(result.cycleNodes.length >= 2);
  assert.ok(result.cycleNodes.includes(1) && result.cycleNodes.includes(2));
});

test('S-07 Test 9: Phát hiện Vòng nhiều node: A -> B -> C -> A', () => {
  const graph = new TaskDependencyGraph();
  graph.setNodes([
    { id: 1, code: 'A' },
    { id: 2, code: 'B' },
    { id: 3, code: 'C' }
  ]);
  graph.addEdge({ predecessorId: 1, successorId: 2 });
  graph.addEdge({ predecessorId: 2, successorId: 3 });
  graph.addEdge({ predecessorId: 3, successorId: 1 });

  const result = topologicalSort(graph);
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.hasCycle, true);
  assert.ok(result.cycleNodes.length >= 3);
  assert.ok(result.message.includes('Circular Dependency'));
});

test('S-07 Test 10: Xử lý Duplicate edge (không tăng in-degree thừa)', () => {
  const graph = new TaskDependencyGraph();
  graph.setNodes([
    { id: 1, code: 'A' },
    { id: 2, code: 'B' }
  ]);
  // Thêm cạnh 1 -> 2 nhiều lần
  graph.addEdge({ predecessorId: 1, successorId: 2, type: 'FS' });
  graph.addEdge({ predecessorId: 1, successorId: 2, type: 'FS' });
  graph.addEdge({ predecessorId: 1, successorId: 2, type: 'SS' });

  assert.strictEqual(graph.getEdgeCount(), 1, 'Cạnh trùng phải được deduplicate');
  assert.strictEqual(graph.getInDegree(2), 1, 'In-degree của node 2 chỉ là 1');

  const result = topologicalSort(graph);
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.orderedIds, [1, 2]);
});

test('S-07 Test 11: Node xuất hiện trong edge nhưng thiếu trong danh sách nodes', () => {
  const graph = new TaskDependencyGraph();
  // Không gọi addNode trước, chỉ thêm edge
  graph.addEdge({ predecessorId: 100, successorId: 200 });

  assert.strictEqual(graph.getNodeCount(), 2, 'Tự động tạo placeholder node');
  const result = topologicalSort(graph);
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.orderedIds, [100, 200]);
});

test('S-07 Test 12: Đồ thị lớn 100 node đảm bảo O(V+E) và không treo', () => {
  const startTime = Date.now();
  const graph = new TaskDependencyGraph();
  const N = 100;

  for (let i = 1; i <= N; i++) {
    graph.addNode({ id: i, code: `TASK-${i}`, duration: 2 });
  }
  // Tạo chuỗi tuyến tính 1 -> 2 -> ... -> 100
  for (let i = 1; i < N; i++) {
    graph.addEdge({ predecessorId: i, successorId: i + 1 });
  }

  const result = topologicalSort(graph);
  const elapsed = Date.now() - startTime;

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.orderedIds.length, N);
  assert.strictEqual(result.orderedIds[0], 1);
  assert.strictEqual(result.orderedIds[N - 1], N);
  assert.ok(elapsed < 200, `Thuật toán phải xử lý 100 nodes cực nhanh (< 200ms, thực tế: ${elapsed}ms)`);
});

test('S-07 Test 13: Tính tất định (Deterministic) qua nhiều lần chạy liên tiếp', () => {
  const makeGraph = () => {
    const g = new TaskDependencyGraph();
    g.setNodes([
      { id: 5, code: 'E' },
      { id: 2, code: 'B' },
      { id: 1, code: 'A' },
      { id: 4, code: 'D' },
      { id: 3, code: 'C' }
    ]);
    g.addEdge({ predecessorId: 1, successorId: 4 });
    g.addEdge({ predecessorId: 2, successorId: 5 });
    g.addEdge({ predecessorId: 3, successorId: 4 });
    return g;
  };

  const firstResult = topologicalSort(makeGraph()).orderedIds;
  for (let run = 0; run < 10; run++) {
    const currentResult = topologicalSort(makeGraph()).orderedIds;
    assert.deepStrictEqual(
      currentResult,
      firstResult,
      `Lần chạy ${run + 1} phải cho kết quả giống hệt lần 1`
    );
  }
});

test('S-06 Contract Validation: Kiểm tra định dạng quan hệ phụ thuộc', () => {
  // Hợp lệ
  const validDep = { predecessorId: 1, successorId: 2, type: 'FS', lag: 2 };
  assert.strictEqual(validateDependencyContract(validDep).valid, true);

  // Thiếu id
  assert.strictEqual(validateDependencyContract({ predecessorId: null, successorId: 2 }).valid, false);

  // Self-loop
  const selfLoop = validateDependencyContract({ predecessorId: 1, successorId: 1 });
  assert.strictEqual(selfLoop.valid, false);
  assert.ok(selfLoop.error.includes('Self-loop'));

  // Sai loại quan hệ
  const invalidType = validateDependencyContract({ predecessorId: 1, successorId: 2, type: 'INVALID' });
  assert.strictEqual(invalidType.valid, false);

  // Sai lag (NaN)
  const invalidLag = validateDependencyContract({ predecessorId: 1, successorId: 2, type: 'FS', lag: 'abc' });
  assert.strictEqual(invalidLag.valid, false);
});
