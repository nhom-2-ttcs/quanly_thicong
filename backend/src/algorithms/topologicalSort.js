/**
 * T16: Sắp thứ tự tô-pô không đệ quy theo bậc vào
 *
 * Thuật toán Kahn:
 * 1. Tính bậc vào (in-degree) của từng task.
 * 2. Đưa các task có bậc vào = 0 vào queue.
 * 3. Lấy từng task khỏi queue và đưa vào kết quả.
 * 4. Giảm bậc vào của các task kế tiếp.
 * 5. Task nào về 0 thì đưa vào queue.
 *
 * Không sử dụng đệ quy.
 *
 * Input:
 * [
 *   { id: 'A', predecessors: [] },
 *   { id: 'B', predecessors: ['A'] }
 * ]
 *
 * Output:
 * ['A', 'B']
 */

function topologicalSort(tasks) {
  const inDegree = new Map();
  const graph = new Map();

  // Khởi tạo
  for (const task of tasks) {
    inDegree.set(task.id, 0);
    graph.set(task.id, []);
  }

  // Xây dựng đồ thị và tính bậc vào
  for (const task of tasks) {
    for (const predecessor of task.predecessors || []) {
      if (!graph.has(predecessor)) {
        throw new Error(
          `Predecessor "${predecessor}" không tồn tại trong danh sách task`
        );
      }

      graph.get(predecessor).push(task.id);
      inDegree.set(task.id, inDegree.get(task.id) + 1);
    }
  }

  // Queue chứa các task có bậc vào bằng 0
  const queue = [];

  for (const task of tasks) {
    if (inDegree.get(task.id) === 0) {
      queue.push(task.id);
    }
  }

  const result = [];

  // Kahn algorithm - không đệ quy
  let queueIndex = 0;

  while (queueIndex < queue.length) {
    const current = queue[queueIndex++];
    result.push(current);

    for (const next of graph.get(current)) {
      inDegree.set(next, inDegree.get(next) - 1);

      if (inDegree.get(next) === 0) {
        queue.push(next);
      }
    }
  }

  // Nếu không xử lý hết task thì tồn tại chu trình
  if (result.length !== tasks.length) {
    throw new Error('Đồ thị có chu trình, không thể sắp thứ tự tô-pô');
  }

  return result;
}

module.exports = {
  topologicalSort
};
