/**
 * Graph Domain Model cho Quản Lý Tiến Độ & Phụ Thuộc (S-07 / SCRUM-62 / T-15)
 * Cấu trúc dữ liệu đồ thị có hướng (Directed Graph)
 */

class TaskDependencyGraph {
  constructor() {
    this.nodes = new Map(); // id -> node object
    this.adjacencyList = new Map(); // id -> Set of successorIds
    this.inDegree = new Map(); // id -> integer in-degree
    this.edges = []; // Array of { predecessorId, successorId, type, lag }
  }

  /**
   * Thêm một node (công việc) vào đồ thị
   * @param {Object} node { id, code, name, duration, ... }
   */
  addNode(node) {
    if (!node || node.id === undefined || node.id === null) {
      throw new Error('Node phải có thuộc tính id hợp lệ');
    }
    const id = Number(node.id);
    if (!this.nodes.has(id)) {
      this.nodes.set(id, { ...node, id });
      this.adjacencyList.set(id, new Set());
      this.inDegree.set(id, 0);
    }
    return this;
  }

  /**
   * Nạp danh sách nodes vào đồ thị
   * @param {Array<Object>} nodeList
   */
  setNodes(nodeList = []) {
    for (const node of nodeList) {
      this.addNode(node);
    }
    return this;
  }

  /**
   * Thêm một cạnh có hướng (quan hệ phụ thuộc) từ predecessor -> successor
   * @param {Object} edge { predecessorId, successorId, type, lag }
   */
  addEdge(edge) {
    if (!edge) return this;

    const from = Number(edge.predecessorId ?? edge.predecessor_id);
    const to = Number(edge.successorId ?? edge.successor_id);
    const type = (edge.type || 'FS').toUpperCase();
    const lag = Number(edge.lag || 0);

    if (isNaN(from) || isNaN(to)) {
      throw new Error('Cạnh phải chứa predecessorId và successorId hợp lệ');
    }

    // Nếu node chưa được khai báo trước trong danh sách node, tự động khởi tạo node rỗng
    if (!this.nodes.has(from)) {
      this.addNode({ id: from, name: `Task #${from}`, code: `T-${from}` });
    }
    if (!this.nodes.has(to)) {
      this.addNode({ id: to, name: `Task #${to}`, code: `T-${to}` });
    }

    // Kiểm tra duplicate edge: nếu đã có cạnh from -> to thì bỏ qua (idempotent)
    const successors = this.adjacencyList.get(from);
    if (successors.has(to)) {
      // Đã tồn tại cạnh này, bỏ qua duplicate edge theo quy tắc rõ ràng
      return this;
    }

    successors.add(to);
    this.inDegree.set(to, (this.inDegree.get(to) || 0) + 1);
    this.edges.push({ predecessorId: from, successorId: to, type, lag });

    return this;
  }

  /**
   * Nạp danh sách cạnh vào đồ thị
   * @param {Array<Object>} edgeList
   */
  setEdges(edgeList = []) {
    for (const edge of edgeList) {
      this.addEdge(edge);
    }
    return this;
  }

  getNodes() {
    return Array.from(this.nodes.values());
  }

  getNode(id) {
    return this.nodes.get(Number(id));
  }

  getNodeCount() {
    return this.nodes.size;
  }

  getEdgeCount() {
    return this.edges.length;
  }

  getSuccessors(id) {
    const set = this.adjacencyList.get(Number(id));
    return set ? Array.from(set) : [];
  }

  getInDegree(id) {
    return this.inDegree.get(Number(id)) || 0;
  }
}

module.exports = {
  TaskDependencyGraph
};
