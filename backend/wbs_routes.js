const express = require('express');
const router = express.Router();
const {
  DEPENDENCY_TYPES,
  ALLOWED_TYPE_CODES,
  validateDependency,
  getAllDependencies,
  getDependencyById,
  createDependency,
  updateDependency,
  deleteDependency,
  deleteDependenciesForWorkItem
} = require('./src/models/dependencyManager');

// Dữ liệu mẫu In-Memory cho hạng mục WBS khi chạy chế độ Standalone (không có MySQL)
let inMemoryWorkItems = [
  { id: 1, project_id: 1, parent_id: null, code: "HM-01", name: "Phần ngầm & Móng", unit: "Gói", quantity: 1, status: "in_progress" },
  { id: 2, project_id: 1, parent_id: 1, code: "HM-01.01", name: "Đào đất hố móng", unit: "m3", quantity: 1200, status: "completed" },
  { id: 3, project_id: 1, parent_id: 2, code: "HM-01.01.01", name: "Đào đất thủ công hố móng", unit: "m3", quantity: 300, status: "completed" },
  { id: 4, project_id: 1, parent_id: 2, code: "HM-01.01.02", name: "Vận chuyển đất thải", unit: "chuyến", quantity: 80, status: "in_progress" },
  { id: 5, project_id: 1, parent_id: 1, code: "HM-01.02", name: "Đổ bê tông lót móng", unit: "m3", quantity: 150, status: "pending" },
  { id: 6, project_id: 1, parent_id: null, code: "HM-02", name: "Phần thân & Kết cấu", unit: "Gói", quantity: 1, status: "pending" },
  { id: 7, project_id: 1, parent_id: 6, code: "HM-02.01", name: "Lắp dựng cốt thép cột vách", unit: "tấn", quantity: 45, status: "pending" },
  { id: 8, project_id: 1, parent_id: 6, code: "HM-02.02", name: "Đổ bê tông sàn tầng 1", unit: "m3", quantity: 280, status: "pending" }
];

module.exports = (db) => {
  const pool = db ? (db.pool || db) : null;

  // Hàm đệ quy kiểm tra targetParentId có phải con/cháu của itemId không
  async function isDescendant(itemId, targetParentId) {
    if (!targetParentId) return false;
    if (parseInt(itemId, 10) === parseInt(targetParentId, 10)) return true;

    if (pool) {
      try {
        let currentParent = targetParentId;
        while (currentParent !== null) {
          if (parseInt(currentParent, 10) === parseInt(itemId, 10)) {
            return true;
          }
          const [rows] = await pool.query('SELECT parent_id FROM work_items WHERE id = ?', [currentParent]);
          if (!rows || rows.length === 0) break;
          currentParent = rows[0].parent_id;
        }
        return false;
      } catch (e) {
        // Fallback in-memory
      }
    }

    let curr = targetParentId;
    while (curr !== null) {
      if (parseInt(curr, 10) === parseInt(itemId, 10)) return true;
      const found = inMemoryWorkItems.find(w => parseInt(w.id, 10) === parseInt(curr, 10));
      if (!found) break;
      curr = found.parent_id;
    }
    return false;
  }

  // =========================================================================
  // I. API HẠNG MỤC CÔNG VIỆC (WORK ITEMS / WBS)
  // =========================================================================

  // 1. Lấy danh sách hạng mục theo dự án
  router.get('/projects/:projectId/work-items', async (req, res) => {
    const projectId = parseInt(req.params.projectId, 10) || 1;
    if (pool) {
      try {
        const [rows] = await pool.query(
          'SELECT * FROM work_items WHERE project_id = ? ORDER BY id ASC',
          [projectId]
        );
        if (rows && rows.length > 0) {
          return res.json({ success: true, data: rows });
        }
      } catch (err) {
        // Chuyển sang in-memory nếu lỗi kết nối MySQL
      }
    }
    const filtered = inMemoryWorkItems.filter(item => parseInt(item.project_id, 10) === projectId);
    res.json({ success: true, data: filtered });
  });

  // 2. Thêm hạng mục mới
  router.post('/work-items', async (req, res) => {
    const { project_id, parent_id, name, code, unit, quantity } = req.body;
    if (!name || !project_id) {
      return res.status(400).json({ success: false, message: 'Thiếu tên hạng mục hoặc project_id' });
    }
    const projId = parseInt(project_id, 10);
    const pId = parent_id ? parseInt(parent_id, 10) : null;

    if (pool) {
      try {
        const [result] = await pool.query(
          'INSERT INTO work_items (project_id, parent_id, name, code, unit, quantity) VALUES (?, ?, ?, ?, ?, ?)',
          [projId, pId, name, code || null, unit || null, quantity || 0]
        );
        return res.json({ success: true, id: result.insertId, message: 'Thêm hạng mục thành công' });
      } catch (err) {
        // Fallback in-memory
      }
    }

    const newId = inMemoryWorkItems.length > 0 
      ? Math.max(...inMemoryWorkItems.map(w => w.id)) + 1 
      : 1;
    const newItem = {
      id: newId,
      project_id: projId,
      parent_id: pId,
      name,
      code: code || `HM-${newId}`,
      unit: unit || null,
      quantity: quantity || 0,
      status: 'pending'
    };
    inMemoryWorkItems.push(newItem);
    res.json({ success: true, id: newId, message: 'Thêm hạng mục thành công' });
  });

  // 3. Cập nhật hạng mục (Chặn vòng lặp đệ quy T-10)
  router.put('/work-items/:id', async (req, res) => {
    const { name, code, unit, quantity, status, parent_id } = req.body;
    const itemId = req.params.id;

    try {
      if (parent_id !== undefined && parent_id !== null) {
        if (parseInt(itemId, 10) === parseInt(parent_id, 10)) {
          return res.status(400).json({ 
            success: false, 
            message: 'Lỗi quy tắc cây (T-10): Không thể đặt hạng mục làm con của chính nó!' 
          });
        }

        const isLoop = await isDescendant(itemId, parent_id);
        if (isLoop) {
          return res.status(400).json({ 
            success: false, 
            message: 'Lỗi quy tắc cây (T-10): Không thể chuyển hạng mục làm con của chính nhánh con/cháu của nó (Tránh lặp vô tận)!' 
          });
        }
      }

      if (pool) {
        try {
          await pool.query(
            `UPDATE work_items 
             SET name = COALESCE(?, name), 
                 code = COALESCE(?, code), 
                 unit = COALESCE(?, unit), 
                 quantity = COALESCE(?, quantity), 
                 status = COALESCE(?, status),
                 parent_id = CASE WHEN ? IS NOT NULL THEN ? ELSE parent_id END
             WHERE id = ?`,
            [name, code, unit, quantity, status, parent_id !== undefined ? parent_id : null, parent_id, itemId]
          );
          return res.json({ success: true, message: 'Cập nhật thành công' });
        } catch (err) {
          // Fallback in-memory
        }
      }

      const item = inMemoryWorkItems.find(w => parseInt(w.id, 10) === parseInt(itemId, 10));
      if (!item) {
        return res.status(404).json({ success: false, message: 'Không tìm thấy hạng mục' });
      }
      if (name !== undefined) item.name = name;
      if (code !== undefined) item.code = code;
      if (unit !== undefined) item.unit = unit;
      if (quantity !== undefined) item.quantity = quantity;
      if (status !== undefined) item.status = status;
      if (parent_id !== undefined) item.parent_id = parent_id ? parseInt(parent_id, 10) : null;

      res.json({ success: true, message: 'Cập nhật thành công' });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 4. Xóa hạng mục (Chặn xóa khi có con T-10 & Tự động xóa quan hệ liên quan)
  router.delete('/work-items/:id', async (req, res) => {
    const itemId = parseInt(req.params.id, 10);
    try {
      if (pool) {
        try {
          const [children] = await pool.query('SELECT id FROM work_items WHERE parent_id = ?', [itemId]);
          if (children && children.length > 0) {
            return res.status(400).json({ 
              success: false, 
              message: `Lỗi ràng buộc (T-10): Không thể xoá vì hạng mục này đang có hạng mục con!` 
            });
          }

          // Xóa quan hệ phụ thuộc liên quan trong MySQL
          await pool.query(
            'DELETE FROM work_item_dependencies WHERE predecessor_id = ? OR successor_id = ?',
            [itemId, itemId]
          );
          await pool.query('DELETE FROM work_items WHERE id = ?', [itemId]);
          deleteDependenciesForWorkItem(itemId);
          return res.json({ success: true, message: 'Xóa hạng mục thành công' });
        } catch (err) {
          // Fallback in-memory
        }
      }

      const hasChildren = inMemoryWorkItems.some(w => parseInt(w.parent_id, 10) === itemId);
      if (hasChildren) {
        return res.status(400).json({ 
          success: false, 
          message: `Lỗi ràng buộc (T-10): Không thể xoá vì hạng mục này đang có hạng mục con!` 
        });
      }

      const idx = inMemoryWorkItems.findIndex(w => parseInt(w.id, 10) === itemId);
      if (idx !== -1) {
        inMemoryWorkItems.splice(idx, 1);
      }
      // Dọn dẹp quan hệ phụ thuộc liên quan (Cascade Clean-up)
      deleteDependenciesForWorkItem(itemId);

      res.json({ success: true, message: 'Xóa hạng mục thành công' });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // =========================================================================
  // II. CÁC ENDPOINT CHO SPRINT S-06: KHAI BÁO QUAN HỆ PHỤ THUỘC & ĐỘ TRỄ
  // =========================================================================

  // 1. Lấy danh mục 4 loại quan hệ chuẩn quốc tế (FS, SS, FF, SF)
  router.get('/dependencies/types', (req, res) => {
    res.json({
      success: true,
      data: Object.values(DEPENDENCY_TYPES),
      codes: ALLOWED_TYPE_CODES
    });
  });

  // 2. Lấy danh sách toàn bộ quan hệ phụ thuộc theo dự án
  router.get('/projects/:projectId/dependencies', async (req, res) => {
    const projectId = parseInt(req.params.projectId, 10) || 1;

    if (pool) {
      try {
        const [rows] = await pool.query(`
          SELECT 
            d.id, d.project_id, d.predecessor_id, d.successor_id, d.dependency_type, d.lag, d.created_at,
            p.name AS predecessor_name, p.code AS predecessor_code,
            s.name AS successor_name, s.code AS successor_code
          FROM work_item_dependencies d
          LEFT JOIN work_items p ON d.predecessor_id = p.id
          LEFT JOIN work_items s ON d.successor_id = s.id
          WHERE d.project_id = ?
          ORDER BY d.id ASC
        `, [projectId]);

        if (rows) {
          const enriched = rows.map(r => ({
            ...r,
            type_info: DEPENDENCY_TYPES[r.dependency_type] || null
          }));
          return res.json({ success: true, data: enriched });
        }
      } catch (err) {
        // Fallback in-memory
      }
    }

    const items = inMemoryWorkItems;
    const deps = getAllDependencies(projectId);
    const enriched = deps.map(d => {
      const pred = items.find(w => parseInt(w.id, 10) === parseInt(d.predecessor_id, 10));
      const succ = items.find(w => parseInt(w.id, 10) === parseInt(d.successor_id, 10));
      return {
        ...d,
        predecessor_name: pred ? pred.name : `Hạng mục #${d.predecessor_id}`,
        predecessor_code: pred ? pred.code : `HM-${d.predecessor_id}`,
        successor_name: succ ? succ.name : `Hạng mục #${d.successor_id}`,
        successor_code: succ ? succ.code : `HM-${d.successor_id}`,
        type_info: DEPENDENCY_TYPES[d.dependency_type] || null
      };
    });

    res.json({ success: true, data: enriched });
  });

  // 3. Khai báo quan hệ phụ thuộc mới [S-06]
  // Tiêu chí kiểm định:
  // - Lưu được đủ 4 loại: FS, SS, FF, SF.
  // - Độ trễ có thể dương, bằng 0 hoặc âm.
  // - Không cho một công việc phụ thuộc chính nó.
  // - Không cho trùng cặp công việc trước và công việc sau.
  // - Loại quan hệ lưu bằng mã cố định, không lưu chuỗi tiếng Việt.
  router.post('/dependencies', async (req, res) => {
    const { project_id, predecessor_id, successor_id, dependency_type, lag } = req.body;
    const projId = parseInt(project_id, 10) || 1;

    let existingDeps = [];
    if (pool) {
      try {
        const [rows] = await pool.query(
          'SELECT id, predecessor_id, successor_id FROM work_item_dependencies WHERE project_id = ?',
          [projId]
        );
        existingDeps = rows || [];
      } catch (e) {
        existingDeps = getAllDependencies(projId);
      }
    } else {
      existingDeps = getAllDependencies(projId);
    }

    // Xác thực các quy tắc nghiệp vụ theo tiêu chí chấp nhận S-06
    const validation = validateDependency(
      { project_id: projId, predecessor_id, successor_id, dependency_type, lag },
      existingDeps
    );

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.error
      });
    }

    const sanitized = validation.sanitized;

    // Lưu vào MySQL nếu có kết nối
    if (pool) {
      try {
        const [result] = await pool.query(`
          INSERT INTO work_item_dependencies (project_id, predecessor_id, successor_id, dependency_type, lag)
          VALUES (?, ?, ?, ?, ?)
        `, [sanitized.project_id, sanitized.predecessor_id, sanitized.successor_id, sanitized.dependency_type, sanitized.lag]);

        sanitized.id = result.insertId;
        // Đồng bộ vào in-memory
        try { createDependency({ ...sanitized, id: result.insertId }); } catch (e) {}

        return res.status(201).json({
          success: true,
          message: 'Khai báo quan hệ phụ thuộc thành công!',
          data: {
            ...sanitized,
            id: result.insertId,
            type_info: DEPENDENCY_TYPES[sanitized.dependency_type]
          }
        });
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(400).json({
            success: false,
            message: 'Không cho trùng cặp công việc trước và công việc sau. Cặp quan hệ này đã tồn tại trong hệ thống!'
          });
        }
        // Fallback in-memory
      }
    }

    try {
      const created = createDependency(sanitized);
      return res.status(201).json({
        success: true,
        message: 'Khai báo quan hệ phụ thuộc thành công!',
        data: {
          ...created,
          type_info: DEPENDENCY_TYPES[created.dependency_type]
        }
      });
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }
  });

  // 4. Cập nhật quan hệ phụ thuộc (Sửa loại quan hệ hoặc độ trễ)
  router.put('/dependencies/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { dependency_type, lag, predecessor_id, successor_id } = req.body;

    let existingDeps = [];
    let currentRecord = null;

    if (pool) {
      try {
        const [rows] = await pool.query('SELECT * FROM work_item_dependencies WHERE id = ?', [id]);
        if (rows && rows.length > 0) {
          currentRecord = rows[0];
          const [allRows] = await pool.query('SELECT id, predecessor_id, successor_id FROM work_item_dependencies');
          existingDeps = allRows || [];
        }
      } catch (e) {
        currentRecord = getDependencyById(id);
        existingDeps = getAllDependencies();
      }
    } else {
      currentRecord = getDependencyById(id);
      existingDeps = getAllDependencies();
    }

    if (!currentRecord) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy quan hệ phụ thuộc cần sửa' });
    }

    const merged = {
      project_id: currentRecord.project_id,
      predecessor_id: predecessor_id !== undefined ? predecessor_id : currentRecord.predecessor_id,
      successor_id: successor_id !== undefined ? successor_id : currentRecord.successor_id,
      dependency_type: dependency_type !== undefined ? dependency_type : currentRecord.dependency_type,
      lag: lag !== undefined ? lag : currentRecord.lag
    };

    const validation = validateDependency(merged, existingDeps, id);
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.error });
    }

    const sanitized = validation.sanitized;

    if (pool) {
      try {
        await pool.query(`
          UPDATE work_item_dependencies
          SET predecessor_id = ?, successor_id = ?, dependency_type = ?, lag = ?
          WHERE id = ?
        `, [sanitized.predecessor_id, sanitized.successor_id, sanitized.dependency_type, sanitized.lag, id]);

        try { updateDependency(id, sanitized); } catch (e) {}
        return res.json({
          success: true,
          message: 'Cập nhật quan hệ phụ thuộc thành công!',
          data: { ...sanitized, id, type_info: DEPENDENCY_TYPES[sanitized.dependency_type] }
        });
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(400).json({
            success: false,
            message: 'Không cho trùng cặp công việc trước và công việc sau.'
          });
        }
      }
    }

    try {
      const updated = updateDependency(id, sanitized);
      return res.json({
        success: true,
        message: 'Cập nhật quan hệ phụ thuộc thành công!',
        data: { ...updated, type_info: DEPENDENCY_TYPES[updated.dependency_type] }
      });
    } catch (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
  });

  // 5. Xóa quan hệ phụ thuộc
  router.delete('/dependencies/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (pool) {
      try {
        await pool.query('DELETE FROM work_item_dependencies WHERE id = ?', [id]);
        deleteDependency(id);
        return res.json({ success: true, message: 'Xóa quan hệ phụ thuộc thành công!' });
      } catch (err) {
        // Fallback in-memory
      }
    }

    const deleted = deleteDependency(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy quan hệ phụ thuộc để xóa' });
    }
    res.json({ success: true, message: 'Xóa quan hệ phụ thuộc thành công!' });
  });

  return router;
};
