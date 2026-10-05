const { normalizeId } = require('../../algorithms/backwardPass');

class TaskDependencyGraph {
  constructor() {
    this.nodes = new Map();
    this.adjacencyList = new Map();
    this.inDegree = new Map();
    this.edges = [];
  }

  addNode(node) {
    const id = normalizeId(node?.id, 'node.id');
    if (this.nodes.has(id)) throw new Error(`ID task bị trùng: ${id}`);
    this.nodes.set(id, { ...node });
    this.adjacencyList.set(id, new Set());
    this.inDegree.set(id, 0);
    return this;
  }

  setNodes(nodes = []) {
    if (!Array.isArray(nodes)) throw new Error('nodes phải là một mảng');
    nodes.forEach(node => this.addNode(node));
    return this;
  }

  addEdge(edge) {
    const from = normalizeId(edge?.predecessorId, 'edge.predecessorId');
    const to = normalizeId(edge?.successorId, 'edge.successorId');
    const type = String(edge?.type ?? 'FS').toUpperCase();
    const lag = Number(edge?.lag ?? 0);
    if (!['FS', 'SS', 'FF', 'SF'].includes(type)) throw new Error(`Loại quan hệ "${type}" không hợp lệ`);
    if (!Number.isFinite(lag)) throw new Error('lag phải là số hữu hạn');
    if (!this.nodes.has(from) || !this.nodes.has(to)) {
      throw new Error(`Dependency tham chiếu task không tồn tại: ${from} -> ${to}`);
    }
    const successors = this.adjacencyList.get(from);
    if (successors.has(to)) return this;
    successors.add(to);
    this.inDegree.set(to, this.inDegree.get(to) + 1);
    this.edges.push({ predecessorId: from, successorId: to, type, lag });
    return this;
  }

  setEdges(edges = []) {
    if (!Array.isArray(edges)) throw new Error('edges phải là một mảng');
    edges.forEach(edge => this.addEdge(edge));
    return this;
  }

  getNodes() { return Array.from(this.nodes.values()); }
  getNode(id) { return this.nodes.get(normalizeId(id, 'node.id')); }
  getNodeCount() { return this.nodes.size; }
  getEdgeCount() { return this.edges.length; }
  getSuccessors(id) { return Array.from(this.adjacencyList.get(normalizeId(id, 'node.id')) || []); }
  getInDegree(id) { return this.inDegree.get(normalizeId(id, 'node.id')) || 0; }
}

module.exports = { TaskDependencyGraph };
