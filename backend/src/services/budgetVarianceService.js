/**
 * S-48 (SCRUM-224 / SCRUM-232 / SCRUM-233)
 * Phân hệ so sánh dự toán, thực chi và cảnh báo vượt ngưỡng theo cấu trúc cây WBS
 * 
 * - T-113: Tính dự toán, thực chi và tổng theo cây (từ hạng mục lá cộng dồn lên cây cha; không cộng giữa các cấp)
 * - T-114: Hiển thị bảng và đánh dấu cảnh báo điều kiện (chi phí > 80% VÀ khối lượng thu được < 80%)
 */

const store = require('../models/store');

// Ngưỡng cảnh báo theo AC S-48
const WARNING_COST_RATIO_THRESHOLD = 0.80;      // 80% chi phí dự toán
const WARNING_QUANTITY_RATIO_THRESHOLD = 0.80;  // 80% khối lượng thu được

/**
 * Làm tròn số thực 2 chữ số thập phân HALF_UP
 */
function round2(val) {
  const num = Number(val);
  if (isNaN(num)) return 0;
  return Number(Math.round(Number(num + 'e2')) + 'e-2');
}

/**
 * Làm tròn khối lượng 4 chữ số thập phân
 */
function round4(val) {
  const num = Number(val);
  if (isNaN(num)) return 0;
  return Number(Math.round(Number(num + 'e4')) + 'e-4');
}

class BudgetVarianceService {
  constructor(db) {
    this.db = db;
    this.pool = db?.pool || db;
  }

  get isConnected() {
    return Boolean(this.db && this.db.isConnected !== false && this.pool?.query);
  }

  /**
   * Lấy danh sách work_items thô của dự án
   */
  async getRawWorkItems(projectId) {
    const pId = Number(projectId);
    if (this.isConnected) {
      try {
        const [rows] = await this.pool.query(
          `SELECT id, project_id, parent_id, code, name, unit,
                  khoi_luong_du_toan, don_gia_du_toan, thanh_tien_du_toan,
                  thuc_chi, khoi_luong_thu_duoc,
                  khoi_luong_hop_dong, don_gia_hop_dong, status
           FROM work_items
           WHERE project_id = ?
           ORDER BY id ASC`,
          [pId]
        );
        // S-47: Lấy thêm tổng chi phí từ bảng actual_expenses nếu có
        let s47ExpensesMap = new Map();
        try {
          const [expRows] = await this.pool.query(
            'SELECT work_item_id, SUM(amount) AS total_expense FROM actual_expenses WHERE project_id = ? AND work_item_id IS NOT NULL GROUP BY work_item_id',
            [pId]
          );
          if (expRows) {
            expRows.forEach(r => s47ExpensesMap.set(Number(r.work_item_id), Number(r.total_expense || 0)));
          }
        } catch (_) {}

        if (rows && rows.length > 0) {
          return rows.map(r => {
            const s47Expense = s47ExpensesMap.get(Number(r.id)) || 0;
            const directExpense = Number(r.thuc_chi || 0);
            const finalActualCost = directExpense > 0 ? directExpense : s47Expense;

            return {
              id: Number(r.id),
              project_id: Number(r.project_id),
              parent_id: r.parent_id !== null ? Number(r.parent_id) : null,
              code: r.code || `HM-${r.id}`,
              name: r.name,
              unit: r.unit || 'm3',
              khoi_luong_du_toan: Number(r.khoi_luong_du_toan || 0),
              don_gia_du_toan: Number(r.don_gia_du_toan || 0),
              thanh_tien_du_toan: Number(r.thanh_tien_du_toan || 0),
              thuc_chi: finalActualCost,
              khoi_luong_thu_duoc: Number(r.khoi_luong_thu_duoc || 0),
              status: r.status
            };
          });
        }
      } catch (err) {
        console.warn('[BudgetVarianceService] Lỗi query MySQL, dùng fallback in-memory:', err.message);
      }
    }

    // In-memory fallback
    const items = (store.inMemoryWorkItems || []).filter(w => Number(w.project_id) === pId);
    return items.map(w => ({
      id: Number(w.id),
      project_id: Number(w.project_id),
      parent_id: w.parent_id !== null && w.parent_id !== undefined ? Number(w.parent_id) : null,
      code: w.code || `HM-${w.id}`,
      name: w.name,
      unit: w.unit || 'm3',
      khoi_luong_du_toan: Number(w.khoi_luong_du_toan || 0),
      don_gia_du_toan: Number(w.don_gia_du_toan || 0),
      thanh_tien_du_toan: Number(w.thanh_tien_du_toan || (w.khoi_luong_du_toan && w.don_gia_du_toan ? w.khoi_luong_du_toan * w.don_gia_du_toan : 0)),
      thuc_chi: Number(w.thuc_chi || 0),
      khoi_luong_thu_duoc: Number(w.khoi_luong_thu_duoc || 0),
      status: w.status
    }));
  }

  /**
   * T-113: Tính toán dự toán, thực chi và cộng dồn theo cây WBS
   * T-114: Đánh dấu cảnh báo điều kiện (chi phí > 80% VÀ khối lượng thu được < 80%)
   * NFR T-113: Không cộng các tài khoản giữa các cây cấp
   * 
   * @param {Array} rawItems Danh sách work_items phẳng
   * @returns {Object} { tree: [...], flatList: [...], summary: {...} }
   */
  calculateTreeVariance(rawItems) {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return {
        tree: [],
        flatList: [],
        summary: {
          total_budget: 0,
          total_actual_cost: 0,
          total_earned_value: 0,
          overall_cost_percentage: 0,
          overall_quantity_percentage: 0,
          total_items: 0,
          warning_items_count: 0,
          leaf_items_count: 0
        }
      };
    }

    // 1. Tạo node map và xác định quan hệ cha - con
    const itemMap = new Map();
    const childrenMap = new Map();

    rawItems.forEach(item => {
      const cloned = {
        ...item,
        children: [],
        level: 0,
        is_leaf: false,
        budget_cost: 0,
        actual_cost: round2(item.thuc_chi || 0),
        budget_qty: round4(item.khoi_luong_du_toan || 0),
        actual_qty: round4(item.khoi_luong_thu_duoc || 0),
        unit_price: round2(item.don_gia_du_toan || 0),
        earned_value: 0,
        cost_percentage: 0,
        quantity_percentage: 0,
        is_warning: false,
        warning_type: 'normal',
        warning_reason: null
      };

      // Tính thành tiền dự toán cho nút hiện tại
      if (item.thanh_tien_du_toan && Number(item.thanh_tien_du_toan) > 0) {
        cloned.budget_cost = round2(item.thanh_tien_du_toan);
      } else {
        cloned.budget_cost = round2(cloned.budget_qty * cloned.unit_price);
      }

      itemMap.set(cloned.id, cloned);
      childrenMap.set(cloned.id, []);
    });

    const rootNodes = [];
    rawItems.forEach(item => {
      const node = itemMap.get(item.id);
      if (item.parent_id !== null && item.parent_id !== undefined && itemMap.has(item.parent_id)) {
        childrenMap.get(item.parent_id).push(node);
      } else {
        rootNodes.push(node);
      }
    });

    // 2. Gán children và xác định nút lá
    itemMap.forEach((node, id) => {
      node.children = childrenMap.get(id) || [];
      node.is_leaf = node.children.length === 0;
    });

    // 3. Đệ quy tính toán cộng dồn từ lá lên cha (Post-order Traversal)
    function processNode(node, level = 0) {
      node.level = level;

      if (node.is_leaf) {
        // Hạng mục LÁ:
        // Sản lượng hoàn thành (earned value) = khối lượng thu được x đơn giá dự toán
        if (node.unit_price > 0 && node.actual_qty > 0) {
          node.earned_value = round2(node.actual_qty * node.unit_price);
        } else if (node.budget_qty > 0 && node.budget_cost > 0) {
          node.earned_value = round2((node.actual_qty / node.budget_qty) * node.budget_cost);
        } else {
          node.earned_value = 0;
        }

        // Tỷ lệ chi phí: (Thực chi / Dự toán) * 100
        if (node.budget_cost > 0) {
          node.cost_percentage = round2((node.actual_cost / node.budget_cost) * 100);
        } else {
          node.cost_percentage = node.actual_cost > 0 ? 100 : 0;
        }

        // Tỷ lệ khối lượng: (Khối lượng thu được / Khối lượng dự toán) * 100
        if (node.budget_qty > 0) {
          node.quantity_percentage = round2((node.actual_qty / node.budget_qty) * 100);
        } else if (node.budget_cost > 0 && node.earned_value > 0) {
          node.quantity_percentage = round2((node.earned_value / node.budget_cost) * 100);
        } else {
          node.quantity_percentage = 0;
        }
      } else {
        // Hạng mục CHA:
        // Đệ quy xử lý các con trước
        node.children.forEach(child => processNode(child, level + 1));

        // T-113 AC: Cộng dồn chi phí dự toán, thực chi và sản lượng từ các con trực tiếp
        let sumBudgetCost = 0;
        let sumActualCost = 0;
        let sumEarnedValue = 0;

        node.children.forEach(child => {
          sumBudgetCost += child.budget_cost;
          sumActualCost += child.actual_cost;
          sumEarnedValue += child.earned_value;
        });

        node.budget_cost = round2(sumBudgetCost);
        node.actual_cost = round2(sumActualCost);
        node.earned_value = round2(sumEarnedValue);

        // Tỷ lệ chi phí cấp cha
        if (node.budget_cost > 0) {
          node.cost_percentage = round2((node.actual_cost / node.budget_cost) * 100);
        } else {
          node.cost_percentage = node.actual_cost > 0 ? 100 : 0;
        }

        // Tỷ lệ khối lượng cấp cha: Dựa trên tổng giá trị sản lượng thu được / tổng dự toán
        if (node.budget_cost > 0) {
          node.quantity_percentage = round2((node.earned_value / node.budget_cost) * 100);
        } else {
          node.quantity_percentage = 0;
        }
      }

      // 4. T-114 AC: Đánh dấu khi chi phí vượt 80% dự toán nhưng khối lượng thu được chưa đạt 80%
      // Điều kiện: cost_percentage > 80% VÀ quantity_percentage < 80%
      const isCostExceeded = node.cost_percentage > (WARNING_COST_RATIO_THRESHOLD * 100);
      const isQuantityDeficient = node.quantity_percentage < (WARNING_QUANTITY_RATIO_THRESHOLD * 100);

      if (isCostExceeded && isQuantityDeficient) {
        node.is_warning = true;
        node.warning_type = 'cost_overrun_progress_lag';
        node.warning_reason = `Cảnh báo: Chi phí đã chi vượt quá 80% dự toán (${node.cost_percentage.toFixed(1)}%) nhưng khối lượng thu được chưa đạt 80% (${node.quantity_percentage.toFixed(1)}%).`;
      } else {
        node.is_warning = false;
        node.warning_type = isCostExceeded ? 'cost_high_progress_good' : 'normal';
        node.warning_reason = null;
      }
    }

    // Tiến hành xử lý cây từ các nút gốc
    rootNodes.forEach(root => processNode(root, 0));

    // 5. NFR T-113: "Không cộng các tài khoản giữa các cây cấp"
    // Khi tổng hợp toàn dự án (summary):
    // Chỉ tính tổng từ các nút GỐC (level 0) - hoặc tổng từ tất cả nút LÁ (cả 2 cách cho cùng kết quả)
    // Tuyệt đối không cộng cả nút cha lẫn nút con để tránh nhân đôi giá trị!
    let totalProjectBudget = 0;
    let totalProjectActualCost = 0;
    let totalProjectEarnedValue = 0;
    let totalWarningItems = 0;
    let totalLeafItems = 0;

    // Flatten tree để trả về bảng phẳng tiện dụng cho frontend và kiểm thử
    const flatList = [];
    function flatten(nodes) {
      nodes.forEach(n => {
        flatList.push(n);
        if (n.is_warning) totalWarningItems++;
        if (n.is_leaf) totalLeafItems++;
        if (n.children && n.children.length > 0) {
          flatten(n.children);
        }
      });
    }
    flatten(rootNodes);

    rootNodes.forEach(root => {
      totalProjectBudget += root.budget_cost;
      totalProjectActualCost += root.actual_cost;
      totalProjectEarnedValue += root.earned_value;
    });

    totalProjectBudget = round2(totalProjectBudget);
    totalProjectActualCost = round2(totalProjectActualCost);
    totalProjectEarnedValue = round2(totalProjectEarnedValue);

    const overallCostPercentage = totalProjectBudget > 0
      ? round2((totalProjectActualCost / totalProjectBudget) * 100)
      : 0;
    const overallQuantityPercentage = totalProjectBudget > 0
      ? round2((totalProjectEarnedValue / totalProjectBudget) * 100)
      : 0;

    const summary = {
      total_budget: totalProjectBudget,
      total_actual_cost: totalProjectActualCost,
      total_earned_value: totalProjectEarnedValue,
      overall_cost_percentage: overallCostPercentage,
      overall_quantity_percentage: overallQuantityPercentage,
      total_items: flatList.length,
      warning_items_count: totalWarningItems,
      leaf_items_count: totalLeafItems,
      has_warnings: totalWarningItems > 0
    };

    return {
      tree: rootNodes,
      flatList,
      summary
    };
  }

  /**
   * Lấy báo cáo so sánh dự toán, thực chi và cảnh báo của dự án
   */
  async getProjectBudgetVarianceReport(projectId) {
    const rawItems = await this.getRawWorkItems(projectId);
    return this.calculateTreeVariance(rawItems);
  }

  /**
   * S-46 (SCRUM-222): Nhập / Cập nhật dự toán cho hạng mục lá
   * Chặn không cho nhập dự toán trên hạng mục cha
   */
  async updateLeafBudget(itemId, { khoi_luong_du_toan, don_gia_du_toan, thanh_tien_du_toan, project_id }) {
    const id = Number(itemId);
    if (!id || id <= 0) {
      const err = new Error('ID hạng mục không hợp lệ.');
      err.status = 400;
      throw err;
    }

    const qty = (khoi_luong_du_toan !== undefined && khoi_luong_du_toan !== null && khoi_luong_du_toan !== '')
      ? Number(khoi_luong_du_toan) : null;
    const price = (don_gia_du_toan !== undefined && don_gia_du_toan !== null && don_gia_du_toan !== '')
      ? Number(don_gia_du_toan) : null;

    if (qty !== null && (isNaN(qty) || qty < 0)) {
      const err = new Error('Khối lượng dự toán phải là số không âm.');
      err.status = 400;
      throw err;
    }
    if (price !== null && (isNaN(price) || price < 0)) {
      const err = new Error('Đơn giá dự toán phải là số không âm.');
      err.status = 400;
      throw err;
    }

    let calculatedCost = null;
    if (thanh_tien_du_toan !== undefined && thanh_tien_du_toan !== null && thanh_tien_du_toan !== '') {
      calculatedCost = Number(thanh_tien_du_toan);
      if (isNaN(calculatedCost) || calculatedCost < 0) {
        const err = new Error('Thành tiền dự toán phải là số không âm.');
        err.status = 400;
        throw err;
      }
    } else if (qty !== null && price !== null) {
      calculatedCost = round2(qty * price);
    }

    if (this.isConnected) {
      try {
        // 1. Kiểm tra tồn tại
        const [items] = await this.pool.query('SELECT * FROM work_items WHERE id = ?', [id]);
        if (!items || items.length === 0) {
          const err = new Error('Hạng mục không tồn tại.');
          err.status = 404;
          throw err;
        }

        // 2. Leaf check: Chặn khai báo trên hạng mục cha
        const [children] = await this.pool.query('SELECT COUNT(1) AS child_count FROM work_items WHERE parent_id = ?', [id]);
        if (children[0].child_count > 0) {
          const err = new Error('Chỉ được phép nhập dự toán cho hạng mục lá (hạng mục không có hạng mục con).');
          err.status = 400;
          throw err;
        }

        await this.pool.query(
          `UPDATE work_items 
           SET khoi_luong_du_toan = COALESCE(?, khoi_luong_du_toan),
               don_gia_du_toan = COALESCE(?, don_gia_du_toan),
               thanh_tien_du_toan = COALESCE(?, thanh_tien_du_toan)
           WHERE id = ?`,
          [qty, price, calculatedCost, id]
        );

        const [updatedRows] = await this.pool.query('SELECT * FROM work_items WHERE id = ?', [id]);
        return updatedRows[0];
      } catch (err) {
        if (err.status) throw err;
        console.warn('[BudgetVarianceService] MySQL update error, falling back to in-memory:', err.message);
      }
    }

    // In-memory
    const item = (store.inMemoryWorkItems || []).find(w => Number(w.id) === id);
    if (!item) {
      const err = new Error('Hạng mục không tồn tại.');
      err.status = 404;
      throw err;
    }

    // Kiểm tra con
    const hasChildren = (store.inMemoryWorkItems || []).some(w => Number(w.parent_id) === id);
    if (hasChildren) {
      const err = new Error('Chỉ được phép nhập dự toán cho hạng mục lá (hạng mục không có hạng mục con).');
      err.status = 400;
      throw err;
    }

    if (qty !== null) item.khoi_luong_du_toan = qty;
    if (price !== null) item.don_gia_du_toan = price;
    if (calculatedCost !== null) {
      item.thanh_tien_du_toan = calculatedCost;
    } else if (item.khoi_luong_du_toan && item.don_gia_du_toan) {
      item.thanh_tien_du_toan = round2(item.khoi_luong_du_toan * item.don_gia_du_toan);
    }

    return item;
  }

  /**
   * S-47: Nhập / Ghi nhận chi phí thực tế (thực chi) và khối lượng thu được cho hạng mục lá
   */
  async updateLeafActualExpense(itemId, { thuc_chi, khoi_luong_thu_duoc }) {
    const id = Number(itemId);
    if (!id || id <= 0) {
      const err = new Error('ID hạng mục không hợp lệ.');
      err.status = 400;
      throw err;
    }

    const expense = (thuc_chi !== undefined && thuc_chi !== null && thuc_chi !== '')
      ? Number(thuc_chi) : null;
    const earnedQty = (khoi_luong_thu_duoc !== undefined && khoi_luong_thu_duoc !== null && khoi_luong_thu_duoc !== '')
      ? Number(khoi_luong_thu_duoc) : null;

    if (expense !== null && (isNaN(expense) || expense < 0)) {
      const err = new Error('Chi phí thực tế (thực chi) phải là số không âm.');
      err.status = 400;
      throw err;
    }
    if (earnedQty !== null && (isNaN(earnedQty) || earnedQty < 0)) {
      const err = new Error('Khối lượng thu được phải là số không âm.');
      err.status = 400;
      throw err;
    }

    if (this.isConnected) {
      try {
        const [items] = await this.pool.query('SELECT * FROM work_items WHERE id = ?', [id]);
        if (!items || items.length === 0) {
          const err = new Error('Hạng mục không tồn tại.');
          err.status = 404;
          throw err;
        }

        const [children] = await this.pool.query('SELECT COUNT(1) AS child_count FROM work_items WHERE parent_id = ?', [id]);
        if (children[0].child_count > 0) {
          const err = new Error('Chỉ được phép nhập thực chi cho hạng mục lá (hạng mục không có hạng mục con).');
          err.status = 400;
          throw err;
        }

        await this.pool.query(
          `UPDATE work_items
           SET thuc_chi = COALESCE(?, thuc_chi),
               khoi_luong_thu_duoc = COALESCE(?, khoi_luong_thu_duoc)
           WHERE id = ?`,
          [expense, earnedQty, id]
        );

        const [updatedRows] = await this.pool.query('SELECT * FROM work_items WHERE id = ?', [id]);
        return updatedRows[0];
      } catch (err) {
        if (err.status) throw err;
        console.warn('[BudgetVarianceService] MySQL update expense error, falling back:', err.message);
      }
    }

    // In-memory
    const item = (store.inMemoryWorkItems || []).find(w => Number(w.id) === id);
    if (!item) {
      const err = new Error('Hạng mục không tồn tại.');
      err.status = 404;
      throw err;
    }

    const hasChildren = (store.inMemoryWorkItems || []).some(w => Number(w.parent_id) === id);
    if (hasChildren) {
      const err = new Error('Chỉ được phép nhập thực chi cho hạng mục lá (hạng mục không có hạng mục con).');
      err.status = 400;
      throw err;
    }

    if (expense !== null) item.thuc_chi = expense;
    if (earnedQty !== null) item.khoi_luong_thu_duoc = earnedQty;

    return item;
  }

  /**
   * S-48 AC 3 & T-114 AC 2: Bộ dữ liệu mẫu chuẩn cho tính toán phản hồi
   * Cung cấp đầy đủ các ca kiểm thử:
   *  - Ca 1: Chi phí > 80% VÀ Khối lượng < 80% => CÓ CẢNH BÁO (Được đánh dấu)
   *  - Ca 2: Chi phí > 80% NHƯNG Khối lượng >= 80% => KHÔNG CẢNH BÁO (Hợp lý)
   *  - Ca 3: Chi phí <= 80% VÀ Khối lượng < 80% => KHÔNG CẢNH BÁO (Tiến độ bình thường)
   *  - Ca 4: Chi phí > 80% VÀ Khối lượng < 80% => CÓ CẢNH BÁO
   *  - Cấu trúc cây 3 tầng (Gốc -> Cha -> Con lá) chứng minh tính tổng theo cây và không cộng lặp các cấp
   */
  async seedS48SampleData(projectId = 1) {
    const pId = Number(projectId);

    const sampleItems = [
      // Level 0: Nút Gốc toàn dự án
      {
        id: 1000,
        project_id: pId,
        parent_id: null,
        code: 'HM-00',
        name: 'Gói thầu Xây lắp chính',
        unit: 'Gói',
        khoi_luong_du_toan: 0,
        don_gia_du_toan: 0,
        thanh_tien_du_toan: 0,
        thuc_chi: 0,
        khoi_luong_thu_duoc: 0
      },
      // Level 1: Nhánh 1 - Phần Ngầm & Móng
      {
        id: 1010,
        project_id: pId,
        parent_id: 1000,
        code: 'HM-01',
        name: 'Phần Ngầm & Móng',
        unit: 'Hạng mục',
        khoi_luong_du_toan: 0,
        don_gia_du_toan: 0,
        thanh_tien_du_toan: 0,
        thuc_chi: 0,
        khoi_luong_thu_duoc: 0
      },
      // Level 2 (Lá 1): Đào đất hố móng
      // Dự toán: 100 m3 x 500,000 đ = 50,000,000 đ
      // Thực chi: 45,000,000 đ (90% > 80%)
      // Khối lượng thu được: 60.0 m3 (60% < 80%)
      // => CẢNH BÁO VI PHẠM (Được đánh dấu)
      {
        id: 1011,
        project_id: pId,
        parent_id: 1010,
        code: 'HM-01.01',
        name: 'Đào đất hố móng bằng máy',
        unit: 'm3',
        khoi_luong_du_toan: 100.0,
        don_gia_du_toan: 500000.0,
        thanh_tien_du_toan: 50000000.0,
        thuc_chi: 45000000.0,
        khoi_luong_thu_duoc: 60.0
      },
      // Level 2 (Lá 2): Bê tông lót móng M100
      // Dự toán: 80 m3 x 1,000,000 đ = 80,000,000 đ
      // Thực chi: 70,000,000 đ (87.5% > 80%)
      // Khối lượng thu được: 72.0 m3 (90% >= 80%)
      // => KHÔNG CẢNH BÁO (Hợp lý)
      {
        id: 1012,
        project_id: pId,
        parent_id: 1010,
        code: 'HM-01.02',
        name: 'Bê tông lót móng đá 4x6 M100',
        unit: 'm3',
        khoi_luong_du_toan: 80.0,
        don_gia_du_toan: 1000000.0,
        thanh_tien_du_toan: 80000000.0,
        thuc_chi: 70000000.0,
        khoi_luong_thu_duoc: 72.0
      },
      // Level 1: Nhánh 2 - Phần Thân & Kết cấu
      {
        id: 1020,
        project_id: pId,
        parent_id: 1000,
        code: 'HM-02',
        name: 'Phần Thân & Kết cấu',
        unit: 'Hạng mục',
        khoi_luong_du_toan: 0,
        don_gia_du_toan: 0,
        thanh_tien_du_toan: 0,
        thuc_chi: 0,
        khoi_luong_thu_duoc: 0
      },
      // Level 2 (Lá 3): Cốt thép dầm sàn
      // Dự toán: 50 tấn x 2,000,000 đ = 100,000,000 đ
      // Thực chi: 40,000,000 đ (40% <= 80%)
      // Khối lượng thu được: 20.0 tấn (40% < 80%)
      // => KHÔNG CẢNH BÁO (Tiến độ bình thường, chi phí chưa vượt)
      {
        id: 1021,
        project_id: pId,
        parent_id: 1020,
        code: 'HM-02.01',
        name: 'Gia công lắp dựng cốt thép dầm sàn',
        unit: 'tấn',
        khoi_luong_du_toan: 50.0,
        don_gia_du_toan: 2000000.0,
        thanh_tien_du_toan: 100000000.0,
        thuc_chi: 40000000.0,
        khoi_luong_thu_duoc: 20.0
      },
      // Level 2 (Lá 4): Ván khuôn định hình
      // Dự toán: 200 m2 x 300,000 đ = 60,000,000 đ
      // Thực chi: 55,000,000 đ (91.67% > 80%)
      // Khối lượng thu được: 100.0 m2 (50% < 80%)
      // => CẢNH BÁO VI PHẠM (Được đánh dấu)
      {
        id: 1022,
        project_id: pId,
        parent_id: 1020,
        code: 'HM-02.02',
        name: 'Ván khuôn phủ phim dầm sàn',
        unit: 'm2',
        khoi_luong_du_toan: 200.0,
        don_gia_du_toan: 300000.0,
        thanh_tien_du_toan: 60000000.0,
        thuc_chi: 55000000.0,
        khoi_luong_thu_duoc: 100.0
      }
    ];

    if (this.isConnected) {
      try {
        // Xóa các mục của project cũ trước khi nạp bộ mẫu chuẩn
        await this.pool.query(
          `DELETE FROM work_items WHERE project_id = ?`,
          [pId]
        );

        for (const item of sampleItems) {
          await this.pool.query(
            `INSERT INTO work_items (id, project_id, parent_id, code, name, unit,
                                     khoi_luong_du_toan, don_gia_du_toan, thanh_tien_du_toan,
                                     thuc_chi, khoi_luong_thu_duoc)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               project_id = VALUES(project_id),
               parent_id = VALUES(parent_id),
               code = VALUES(code),
               name = VALUES(name),
               unit = VALUES(unit),
               khoi_luong_du_toan = VALUES(khoi_luong_du_toan),
               don_gia_du_toan = VALUES(don_gia_du_toan),
               thanh_tien_du_toan = VALUES(thanh_tien_du_toan),
               thuc_chi = VALUES(thuc_chi),
               khoi_luong_thu_duoc = VALUES(khoi_luong_thu_duoc)`,
            [
              item.id, item.project_id, item.parent_id, item.code, item.name, item.unit,
              item.khoi_luong_du_toan, item.don_gia_du_toan, item.thanh_tien_du_toan,
              item.thuc_chi, item.khoi_luong_thu_duoc
            ]
          );
        }
      } catch (err) {
        console.warn('[BudgetVarianceService] MySQL seed sample error, seeding in-memory:', err.message);
      }
    }

    // In-memory seed: xóa các item cũ của project này để thay bằng bộ mẫu chuẩn
    if (!store.inMemoryWorkItems) store.inMemoryWorkItems = [];
    store.inMemoryWorkItems = store.inMemoryWorkItems.filter(i => Number(i.project_id) !== pId);
    sampleItems.forEach(item => {
      store.inMemoryWorkItems.push({ ...item });
    });

    return this.calculateTreeVariance(sampleItems);
  }
}

module.exports = BudgetVarianceService;
