/**
 * Thuật toán Sắp xếp Topo (Topological Sort) & Phát hiện Vòng lặp (Cycle Detection)
 * (S-07 / SCRUM-62 / T-16 & T-17)
 * 
 * Triển khai thuật toán Kahn (BFS In-Degree) kết hợp DFS chu trình có giới hạn độ sâu
 * - Độ phức tạp: O(V + E) thời gian, O(V + E) bộ nhớ
 * - Tuyệt đối không treo, không đệ quy không giới hạn, không lặp vô hạn
 * - Kết quả tất định (deterministic) thông qua quy tắc sắp xếp chỉ số node khi in-degree = 0
 */

/**
 * Tìm chu trình cụ thể trong tập các node còn lại có in-degree > 0
 * @param {TaskDependencyGraph} graph 
 * @param {Set<number>} candidateIds 
 * @returns {Array<number>} mảng các id tạo thành chu trình khép kín, ví dụ [1, 2, 1]
 */
function traceCycle(graph, candidateIds) {
  const visited = new Set();
  const onPath = new Map(); // id -> index trong path
  const path = [];

  for (const startId of candidateIds) {
    if (visited.has(startId)) continue;

    // DFS lặp sử dụng explicit stack để tránh tràn call stack
    const stack = [{ id: startId, succIndex: 0 }];
    path.push(startId);
    onPath.set(startId, 0);
    visited.add(startId);

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const successors = graph.getSuccessors(top.id).filter(id => candidateIds.has(id));

      if (top.succIndex < successors.length) {
        const nextId = successors[top.succIndex];
        top.succIndex++;

        if (onPath.has(nextId)) {
          // Tìm thấy vòng lặp! Cắt lát chu trình từ vị trí nextId đến hết
          const cycleStartIndex = onPath.get(nextId);
          const cycle = path.slice(cycleStartIndex);
          cycle.push(nextId); // Khép kín vòng
          return cycle;
        }

        if (!visited.has(nextId)) {
          visited.add(nextId);
          onPath.set(nextId, path.length);
          path.push(nextId);
          stack.push({ id: nextId, succIndex: 0 });
        }
      } else {
        // Backtrack
        const popped = stack.pop();
        path.pop();
        onPath.delete(popped.id);
      }
    }
  }

  // Fallback nếu không truy vết được lát cắt đơn, trả danh sách candidate
  return Array.from(candidateIds);
}

function compareIds(a, b) {
  return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
}

/**
 * Thực hiện sắp xếp thứ tự phụ thuộc (Topological Sort) bằng thuật toán Kahn
 * @param {TaskDependencyGraph} graph 
 * @returns {{
 *   success: boolean,
 *   hasCycle: boolean,
 *   order?: Array<Object>,
 *   orderedIds?: Array<number>,
 *   cycleNodes?: Array<number>,
 *   cyclePath?: string,
 *   message?: string
 * }}
 */
function topologicalSort(graph) {
  const nodeCount = graph.getNodeCount();

  // 1. Trường hợp đồ thị rỗng (0 node)
  if (nodeCount === 0) {
    return {
      success: true,
      hasCycle: false,
      order: [],
      orderedIds: [],
      message: 'Đồ thị không chứa công việc nào'
    };
  }

  // 2. Kiểm tra nhanh self-loop (cạnh từ A -> A)
  for (const edge of graph.edges) {
    if (edge.predecessorId === edge.successorId) {
      const selfNode = graph.getNode(edge.predecessorId);
      const selfId = selfNode?.id ?? edge.predecessorId;
      const name = selfNode ? `[${selfNode.code || selfNode.id}] ${selfNode.name}` : `Task #${edge.predecessorId}`;
      return {
        success: false,
        hasCycle: true,
        cycleNodes: [selfId, selfId],
        cyclePath: `${name} -> ${name}`,
        message: `Phát hiện quan hệ phụ thuộc tự trỏ (Self-loop) tại công việc: ${name}`
      };
    }
  }

  // 3. Sao chép in-degree để tính toán
  const inDegreeMap = new Map();
  for (const id of graph.nodes.keys()) {
    inDegreeMap.set(id, graph.getInDegree(id));
  }

  // 4. Khởi tạo hàng đợi chứa các node có in-degree = 0
  // Sắp xếp ID tăng dần để đảm bảo tính tất định (deterministic)
  const zeroQueue = [];
  for (const [id, deg] of inDegreeMap.entries()) {
    if (deg === 0) {
      zeroQueue.push(id);
    }
  }
  zeroQueue.sort(compareIds);

  const orderedIds = [];
  const orderedNodes = [];
  const maxIterations = nodeCount + graph.getEdgeCount() + 10;
  let iterations = 0;

  // 5. Duyệt Kahn BFS
  while (zeroQueue.length > 0) {
    iterations++;
    if (iterations > maxIterations) {
      // Guard bảo vệ chống lặp vô hạn tuyệt đối
      break;
    }

    const currentId = zeroQueue.shift();
    const currentNode = graph.getNode(currentId);
    orderedIds.push(currentNode?.id ?? currentId);
    orderedNodes.push(currentNode);

    const successors = graph.getSuccessors(currentId);
    // Sắp xếp successors để đưa vào queue một cách deterministic
    const newlyZeroNodes = [];

    for (const succId of successors) {
      const updatedDegree = (inDegreeMap.get(succId) || 0) - 1;
      inDegreeMap.set(succId, updatedDegree);

      if (updatedDegree === 0) {
        newlyZeroNodes.push(succId);
      }
    }

    newlyZeroNodes.sort(compareIds);
    for (const nz of newlyZeroNodes) {
      zeroQueue.push(nz);
    }
    // Duy trì hàng đợi luôn sắp xếp tăng dần để deterministic khi có nhiều nhánh
    zeroQueue.sort(compareIds);
  }

  // 6. Kiểm tra kết quả sắp xếp
  if (orderedIds.length === nodeCount) {
    return {
      success: true,
      hasCycle: false,
      order: orderedNodes,
      orderedIds: orderedIds,
      message: 'Sắp xếp thứ tự phụ thuộc thành công (DAG hợp lệ)'
    };
  }

  // 7. Đồ thị có chu trình (vòng lặp)
  const remainingIds = new Set();
  for (const [id, deg] of inDegreeMap.entries()) {
    if (deg > 0) {
      remainingIds.add(id);
    }
  }

  const cycleKeys = traceCycle(graph, remainingIds);
  const cycleNodes = cycleKeys.map(id => graph.getNode(id)?.id ?? id);
  const cyclePath = cycleKeys
    .map(id => {
      const n = graph.getNode(id);
      return n ? `${n.code || n.id}` : `#${id}`;
    })
    .join(' -> ');

  return {
    success: false,
    hasCycle: true,
    cycleNodes,
    cyclePath,
    message: `Phát hiện quan hệ phụ thuộc vòng lặp (Circular Dependency): ${cyclePath}`
  };
}

module.exports = {
  topologicalSort,
  traceCycle
};
