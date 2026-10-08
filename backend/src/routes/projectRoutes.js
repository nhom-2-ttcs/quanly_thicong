const express = require('express');
const { checkViewerForbidden, checkProjectReadAccess } = require('../utils/rbac');
const { canUserAccessProject, inMemoryProjects } = require('../models/store');

module.exports = (db) => {
  const router = express.Router();
  const pool = db?.pool || db;

  // 1. Lấy danh sách dự án (Viewer chỉ thấy dự án được phân quyền)
  router.get('/projects', async (req, res) => {
    if (!db?.isConnected) {
      let rows = inMemoryProjects;
      if (req.user && (req.user.role_name === 'viewer' || req.user.role_id === 7)) {
        rows = rows.filter(p => canUserAccessProject(req.user, p.id));
      }
      return res.json({ success: true, data: rows });
    }
    try {
      let [rows] = await pool.query('SELECT * FROM projects ORDER BY id ASC');
      
      // Nếu có thông tin người dùng đăng nhập là viewer, lọc chỉ lấy dự án được cấp quyền
      if (req.user && (req.user.role_name === 'viewer' || req.user.role_id === 7)) {
        rows = rows.filter(p => canUserAccessProject(req.user, p.id));
      }

      res.json({ success: true, data: rows });
    } catch (err) {
      res.json({ success: true, data: inMemoryProjects });
    }
  });

  // 2. Lấy thông tin chi tiết một dự án
  router.get('/projects/:id', async (req, res) => {
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'Mã dự án không hợp lệ' });
    }

    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const [rows] = await pool.query('SELECT * FROM projects WHERE id = ?', [projectId]);
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Dự án không tồn tại' });
      }
      res.json({ success: true, data: rows[0] });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 3. Tạo dự án mới (Viewer bị cấm -> 403)
  router.post('/projects', async (req, res) => {
    if (checkViewerForbidden(req, res)) return;

    const { name, code, description } = req.body;
    if (!name || !code) {
      return res.status(400).json({ success: false, message: 'Tên dự án và mã dự án không được để trống' });
    }

    try {
      const [result] = await pool.query(
        'INSERT INTO projects (name, code, description) VALUES (?, ?, ?)',
        [name.trim(), code.trim(), description ? description.trim() : null]
      );
      res.status(201).json({
        success: true,
        id: result.insertId,
        message: 'Khởi tạo dự án mới thành công'
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 4. Cập nhật dự án (Viewer bị cấm -> 403)
  router.put('/projects/:id', async (req, res) => {
    if (checkViewerForbidden(req, res)) return;

    const projectId = Number(req.params.id);
    const { name, code, description } = req.body;

    try {
      const [existing] = await pool.query('SELECT id FROM projects WHERE id = ?', [projectId]);
      if (existing.length === 0) {
        return res.status(404).json({ success: false, message: 'Dự án không tồn tại' });
      }

      await pool.query(
        'UPDATE projects SET name = COALESCE(?, name), code = COALESCE(?, code), description = COALESCE(?, description) WHERE id = ?',
        [name ? name.trim() : null, code ? code.trim() : null, description ? description.trim() : null, projectId]
      );
      res.json({ success: true, message: 'Cập nhật dự án thành công' });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 5. Xóa dự án (Viewer bị cấm -> 403)
  router.delete('/projects/:id', async (req, res) => {
    if (checkViewerForbidden(req, res)) return;

    const projectId = Number(req.params.id);
    try {
      const [existing] = await pool.query('SELECT id FROM projects WHERE id = ?', [projectId]);
      if (existing.length === 0) {
        return res.status(404).json({ success: false, message: 'Dự án không tồn tại' });
      }

      await pool.query('DELETE FROM projects WHERE id = ?', [projectId]);
      res.json({ success: true, message: 'Xóa dự án thành công' });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  return router;
};
