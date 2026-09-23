const express = require('express');
const router = express.Router();

module.exports = (db) => {
  const pool = db.pool || db;

  // Hàm đệ quy kiểm tra targetParentId có phải con/cháu của itemId không
  async function isDescendant(itemId, targetParentId) {
    if (!targetParentId) return false;
    if (parseInt(itemId) === parseInt(targetParentId)) return true;

    let currentParent = targetParentId;
    while (currentParent !== null) {
      if (parseInt(currentParent) === parseInt(itemId)) {
        return true;
      }
      const [rows] = await pool.query('SELECT parent_id FROM work_items WHERE id = ?', [currentParent]);
      if (!rows || rows.length === 0) break;
      currentParent = rows[0].parent_id;
    }
    return false;
  }

  // 1. Lấy danh sách hạng mục theo dự án
  router.get('/projects/:projectId/work-items', async (req, res) => {
    try {
      const [rows] = await pool.query(
        'SELECT * FROM work_items WHERE project_id = ? ORDER BY id ASC',
        [req.params.projectId]
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 2. Thêm hạng mục mới
  router.post('/work-items', async (req, res) => {
    const { project_id, parent_id, name, code, unit, quantity } = req.body;
    if (!name || !project_id) {
      return res.status(400).json({ success: false, message: 'Thiếu tên hạng mục hoặc project_id' });
    }
    try {
      const [result] = await pool.query(
        'INSERT INTO work_items (project_id, parent_id, name, code, unit, quantity) VALUES (?, ?, ?, ?, ?, ?)',
        [project_id, parent_id || null, name, code || null, unit || null, quantity || 0]
      );
      res.json({ success: true, id: result.insertId, message: 'Thêm hạng mục thành công' });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 3. Cập nhật hạng mục (Chặn vòng lặp đệ quy T-10)
  router.put('/work-items/:id', async (req, res) => {
    const { name, code, unit, quantity, status, parent_id } = req.body;
    const itemId = req.params.id;

    try {
      if (parent_id !== undefined && parent_id !== null) {
        if (parseInt(itemId) === parseInt(parent_id)) {
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

      res.json({ success: true, message: 'Cập nhật thành công' });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 4. Xóa hạng mục (Chặn xóa khi có con T-10)
  router.delete('/work-items/:id', async (req, res) => {
    const itemId = req.params.id;
    try {
      const [children] = await pool.query('SELECT id FROM work_items WHERE parent_id = ?', [itemId]);
      if (children.length > 0) {
        return res.status(400).json({ 
          success: false, 
          message: `Lỗi ràng buộc (T-10): Không thể xoá vì hạng mục này đang có hạng mục con!` 
        });
      }

      await pool.query('DELETE FROM work_items WHERE id = ?', [itemId]);
      res.json({ success: true, message: 'Xóa hạng mục thành công' });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  return router;
};
