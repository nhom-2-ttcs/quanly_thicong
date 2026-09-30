const express = require('express');

module.exports = (db) => {
  const router = express.Router();
  const pool = db?.pool || db;

  // 1. Lấy danh sách công việc theo dự án (hỗ trợ lọc theo work_item_id)
  router.get('/projects/:projectId/tasks', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ' });
    }

    const { work_item_id } = req.query;

    try {
      let query = `
        SELECT t.*, w.name AS work_item_name, w.code AS work_item_code 
        FROM tasks t 
        JOIN work_items w ON t.work_item_id = w.id 
        WHERE t.project_id = ?
      `;
      const params = [projectId];

      if (work_item_id) {
        query += ' AND t.work_item_id = ?';
        params.push(Number(work_item_id));
      }

      query += ' ORDER BY t.id ASC';

      const [rows] = await pool.query(query, params);
      res.json({ success: true, data: rows });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 2. Thêm công việc mới (S-05 / SCRUM-60 / T-11)
  const createTaskHandler = async (req, res) => {
    const projectId = Number(req.params.projectId || req.body.project_id);
    const { name, code, duration, work_item_id, status } = req.body;

    // Validation: Tên công việc không được để trống
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Tên công việc không được để trống'
      });
    }

    // Validation: project_id
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Mã dự án (project_id) không hợp lệ'
      });
    }

    // Validation: work_item_id
    const workItemId = Number(work_item_id);
    if (!Number.isInteger(workItemId) || workItemId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Phải chọn hạng mục WBS hợp lệ (work_item_id) để gắn công việc'
      });
    }

    // Validation: duration (đơn vị: Ngày - days)
    if (duration === undefined || duration === null || duration === '') {
      return res.status(400).json({
        success: false,
        message: 'Thời lượng công việc (duration) không được để trống'
      });
    }

    const durationNum = Number(duration);
    if (isNaN(durationNum) || !Number.isFinite(durationNum) || durationNum <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Thời lượng phải là một số dương hợp lệ (đơn vị: Ngày)'
      });
    }

    try {
      // Kiểm tra project tồn tại
      const [projects] = await pool.query('SELECT id FROM projects WHERE id = ?', [projectId]);
      if (projects.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Dự án không tồn tại'
        });
      }

      // Kiểm tra work_item tồn tại và thuộc cùng project
      const [workItems] = await pool.query(
        'SELECT id, project_id FROM work_items WHERE id = ?',
        [workItemId]
      );
      if (workItems.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Hạng mục WBS không tồn tại'
        });
      }
      if (workItems[0].project_id !== projectId) {
        return res.status(400).json({
          success: false,
          message: 'Hạng mục WBS không thuộc cùng dự án đã chọn'
        });
      }

      const taskCode = code ? String(code).trim() : null;
      const taskStatus = status || 'pending';

      const [result] = await pool.query(
        'INSERT INTO tasks (project_id, work_item_id, name, code, duration, status) VALUES (?, ?, ?, ?, ?, ?)',
        [projectId, workItemId, name.trim(), taskCode, durationNum, taskStatus]
      );

      res.status(201).json({
        success: true,
        id: result.insertId,
        data: {
          id: result.insertId,
          project_id: projectId,
          work_item_id: workItemId,
          name: name.trim(),
          code: taskCode,
          duration: durationNum,
          status: taskStatus
        },
        message: 'Thêm công việc thành công'
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  };

  router.post('/projects/:projectId/tasks', createTaskHandler);
  router.post('/tasks', createTaskHandler);

  // 3. Lấy chi tiết công việc
  router.get('/tasks/:id', async (req, res) => {
    const taskId = Number(req.params.id);
    try {
      const [rows] = await pool.query(
        `SELECT t.*, w.name AS work_item_name, w.code AS work_item_code 
         FROM tasks t 
         JOIN work_items w ON t.work_item_id = w.id 
         WHERE t.id = ?`,
        [taskId]
      );
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Công việc không tồn tại' });
      }
      res.json({ success: true, data: rows[0] });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 4. Cập nhật công việc
  router.put('/tasks/:id', async (req, res) => {
    const taskId = Number(req.params.id);
    const { name, code, duration, work_item_id, status } = req.body;

    try {
      const [existing] = await pool.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
      if (existing.length === 0) {
        return res.status(404).json({ success: false, message: 'Công việc không tồn tại' });
      }
      const task = existing[0];

      let updatedName = task.name;
      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length === 0) {
          return res.status(400).json({ success: false, message: 'Tên công việc không được để trống' });
        }
        updatedName = name.trim();
      }

      let updatedDuration = task.duration;
      if (duration !== undefined) {
        const dNum = Number(duration);
        if (isNaN(dNum) || !Number.isFinite(dNum) || dNum <= 0) {
          return res.status(400).json({
            success: false,
            message: 'Thời lượng phải là một số dương hợp lệ (đơn vị: Ngày)'
          });
        }
        updatedDuration = dNum;
      }

      let updatedWorkItemId = task.work_item_id;
      if (work_item_id !== undefined) {
        const wId = Number(work_item_id);
        const [wi] = await pool.query(
          'SELECT id, project_id FROM work_items WHERE id = ?',
          [wId]
        );
        if (wi.length === 0) {
          return res.status(404).json({ success: false, message: 'Hạng mục WBS mới không tồn tại' });
        }
        if (wi[0].project_id !== task.project_id) {
          return res.status(400).json({ success: false, message: 'Hạng mục WBS mới không thuộc cùng dự án' });
        }
        updatedWorkItemId = wId;
      }

      const updatedCode = code !== undefined ? (code ? String(code).trim() : null) : task.code;
      const updatedStatus = status !== undefined ? status : task.status;

      await pool.query(
        `UPDATE tasks 
         SET name = ?, code = ?, duration = ?, work_item_id = ?, status = ? 
         WHERE id = ?`,
        [updatedName, updatedCode, updatedDuration, updatedWorkItemId, updatedStatus, taskId]
      );

      res.json({ success: true, message: 'Cập nhật công việc thành công' });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 5. Xóa công việc
  router.delete('/tasks/:id', async (req, res) => {
    const taskId = Number(req.params.id);
    try {
      const [existing] = await pool.query('SELECT id FROM tasks WHERE id = ?', [taskId]);
      if (existing.length === 0) {
        return res.status(404).json({ success: false, message: 'Công việc không tồn tại' });
      }

      await pool.query('DELETE FROM tasks WHERE id = ?', [taskId]);
      res.json({ success: true, message: 'Xóa công việc thành công' });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  return router;
};
