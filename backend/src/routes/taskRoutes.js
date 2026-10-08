const express = require('express');
const { checkViewerForbidden, checkProjectReadAccess } = require('../utils/rbac');
const { ScheduleResultRepository } = require('../repositories/scheduleResultRepository');
const { getTasks, createTaskData, updateTaskData, deleteTaskData } = require('../models/store');

function formatDateISO(val) {
  if (!val) return null;
  if (typeof val === 'string') return val.split('T')[0];
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(val);
}

module.exports = (db) => {
  const router = express.Router();
  const pool = db?.pool || db;
  const scheduleResultRepo = new ScheduleResultRepository(db);

  // 1. Lấy danh sách công việc theo dự án (hỗ trợ lọc theo work_item_id)
  router.get('/projects/:projectId/tasks', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ' });
    }

    if (checkProjectReadAccess(req, res, projectId)) return;

    const { work_item_id } = req.query;

    if (!db?.isConnected) {
      return res.json({ success: true, data: getTasks(projectId, work_item_id) });
    }

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
      res.json({ success: true, data: getTasks(projectId, work_item_id) });
    }
  });

  // 2. Thêm công việc mới (S-05 / SCRUM-60 / T-11 & S-15: Hỗ trợ tiến độ thực tế)
  const createTaskHandler = async (req, res) => {
    if (checkViewerForbidden(req, res)) return;

    const projectId = Number(req.params.projectId || req.body.project_id);
    const { name, code, duration, work_item_id, status, actual_start, actual_end, percent_complete } = req.body;

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
    if (isNaN(durationNum) || !Number.isFinite(durationNum) || !Number.isInteger(durationNum) || durationNum <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Thời lượng phải là số nguyên dương (đơn vị: Ngày)'
      });
    }

    // S-15 / AC 3: Validation phần trăm hoàn thành [0, 100]
    let pctNum = 0;
    if (percent_complete !== undefined && percent_complete !== null && percent_complete !== '') {
      pctNum = Number(percent_complete);
      if (isNaN(pctNum) || !Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100) {
        return res.status(400).json({
          success: false,
          message: 'Phần trăm hoàn thành phải nằm trong khoảng từ 0 đến 100'
        });
      }
    }

    // S-15 / AC 2: Validation ngày kết thúc thực tế không được sớm hơn ngày bắt đầu thực tế
    const actStart = actual_start ? String(actual_start).trim() : null;
    const actEnd = actual_end ? String(actual_end).trim() : null;
    if (actStart && actEnd) {
      if (new Date(actEnd) < new Date(actStart)) {
        return res.status(400).json({
          success: false,
          message: 'Ngày kết thúc thực tế không được sớm hơn ngày bắt đầu thực tế'
        });
      }
    }

    if (!db?.isConnected) {
      let taskStatus = status || 'pending';
      if (taskStatus === 'pending' && actStart) taskStatus = 'in_progress';
      if (pctNum === 100 && actEnd) taskStatus = 'completed';
      const created = createTaskData({
        project_id: projectId,
        work_item_id: workItemId,
        name: name.trim(),
        code: code ? String(code).trim() : null,
        duration: durationNum,
        actual_start: actStart,
        actual_end: actEnd,
        percent_complete: pctNum,
        status: taskStatus
      });
      return res.status(201).json({
        success: true,
        id: created.id,
        message: 'Thêm công việc thành công',
        data: created
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

      // S-05: Công việc chỉ được gắn vào hạng mục lá, từ chối hạng mục cha
      const [childItems] = await pool.query(
        'SELECT id FROM work_items WHERE parent_id = ? LIMIT 1',
        [workItemId]
      );
      if (childItems.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Công việc chỉ được gắn vào hạng mục lá, không được gắn vào hạng mục cha'
        });
      }

      const taskCode = code ? String(code).trim() : null;
      // S-15 / AC 1: Nếu chưa bắt đầu mà có actual_start thì chuyển sang in_progress
      let taskStatus = status || 'pending';
      if (taskStatus === 'pending' && actStart) {
        taskStatus = 'in_progress';
      }
      if (pctNum === 100 && actEnd) {
        taskStatus = 'completed';
      }

      const [result] = await pool.query(
        `INSERT INTO tasks (project_id, work_item_id, name, code, duration, actual_start, actual_end, percent_complete, status) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [projectId, workItemId, name.trim(), taskCode, durationNum, actStart, actEnd, pctNum, taskStatus]
      );

      try {
        await scheduleResultRepo.markStale(projectId);
      } catch {}

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
          actual_start: actStart,
          actual_end: actEnd,
          percent_complete: pctNum,
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

      if (checkProjectReadAccess(req, res, rows[0].project_id)) return;

      res.json({ success: true, data: rows[0] });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 4. Cập nhật công việc
  router.put('/tasks/:id', async (req, res) => {
    if (checkViewerForbidden(req, res)) return;

    const taskId = Number(req.params.id);
    const { name, code, duration, work_item_id, status, actual_start, actual_end, percent_complete } = req.body;

    if (!db?.isConnected) {
      const updated = updateTaskData(taskId, {
        name: name ? String(name).trim() : undefined,
        code: code ? String(code).trim() : undefined,
        duration: duration !== undefined ? Number(duration) : undefined,
        work_item_id: work_item_id !== undefined ? Number(work_item_id) : undefined,
        status: status !== undefined ? status : undefined,
        actual_start: actual_start !== undefined ? (actual_start ? String(actual_start).trim() : null) : undefined,
        actual_end: actual_end !== undefined ? (actual_end ? String(actual_end).trim() : null) : undefined,
        percent_complete: percent_complete !== undefined ? Number(percent_complete) : undefined
      });
      return res.json({ success: true, message: 'Cập nhật công việc thành công', data: updated });
    }

    try {
      const [existing] = await pool.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
      if (existing.length === 0) {
        return res.status(404).json({ success: false, message: 'Công việc không tồn tại' });
      }
      const task = existing[0];

      if (checkProjectReadAccess(req, res, task.project_id)) return;

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
        if (isNaN(dNum) || !Number.isFinite(dNum) || !Number.isInteger(dNum) || dNum <= 0) {
          return res.status(400).json({
            success: false,
            message: 'Thời lượng phải là số nguyên dương (đơn vị: Ngày)'
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

        // S-05: Kiểm tra chỉ cho phép gắn vào hạng mục lá
        const [childItems] = await pool.query(
          'SELECT id FROM work_items WHERE parent_id = ? LIMIT 1',
          [wId]
        );
        if (childItems.length > 0) {
          return res.status(400).json({
            success: false,
            message: 'Công việc chỉ được gắn vào hạng mục lá, không được gắn vào hạng mục cha'
          });
        }

        updatedWorkItemId = wId;
      }

      const updatedCode = code !== undefined ? (code ? String(code).trim() : null) : task.code;
      
      // S-15: Xử lý các trường tiến độ thực tế (actual_start, actual_end, percent_complete)
      let updatedActualStart = task.actual_start ? formatDateISO(task.actual_start) : null;
      if (actual_start !== undefined) {
        updatedActualStart = actual_start ? String(actual_start).trim() : null;
      }

      let updatedActualEnd = task.actual_end ? formatDateISO(task.actual_end) : null;
      if (actual_end !== undefined) {
        updatedActualEnd = actual_end ? String(actual_end).trim() : null;
      }

      // AC 2: Ngày kết thúc thực tế không được sớm hơn ngày bắt đầu thực tế
      if (updatedActualStart && updatedActualEnd) {
        if (new Date(updatedActualEnd) < new Date(updatedActualStart)) {
          return res.status(400).json({
            success: false,
            message: 'Ngày kết thúc thực tế không được sớm hơn ngày bắt đầu thực tế'
          });
        }
      }

      // AC 3: Phần trăm hoàn thành phải trong khoảng 0-100
      let updatedPercent = task.percent_complete !== null && task.percent_complete !== undefined ? Number(task.percent_complete) : 0;
      if (percent_complete !== undefined && percent_complete !== null && percent_complete !== '') {
        const pNum = Number(percent_complete);
        if (isNaN(pNum) || !Number.isFinite(pNum) || pNum < 0 || pNum > 100) {
          return res.status(400).json({
            success: false,
            message: 'Phần trăm hoàn thành phải nằm trong khoảng từ 0 đến 100'
          });
        }
        updatedPercent = pNum;
      }

      // AC 4: Mở lại việc đã kết thúc thực tế
      const isTaskAlreadyFinished = task.status === 'completed' || Number(task.percent_complete) === 100 || (task.actual_end !== null && task.actual_end !== undefined);
      const isReopeningWithLessThan100 = percent_complete !== undefined && Number(percent_complete) < 100;
      if (isTaskAlreadyFinished && isReopeningWithLessThan100) {
        const isConfirmed = req.body?.confirm_reopen === true || req.body?.confirm === true || req.query?.confirm === 'true';
        if (!isConfirmed) {
          return res.status(409).json({
            success: false,
            requires_confirmation: true,
            message: 'Công việc đã kết thúc thực tế. Bạn có chắc chắn muốn mở lại một việc đã xong với tiến độ nhỏ hơn 100% không?'
          });
        }
      }

      let updatedStatus = status !== undefined ? status : task.status;
      // AC 1: Việc chưa bắt đầu mà có actual_start thì chuyển sang in_progress
      if (updatedStatus === 'pending' && updatedActualStart) {
        updatedStatus = 'in_progress';
      }
      if (isTaskAlreadyFinished && isReopeningWithLessThan100) {
        updatedStatus = 'in_progress';
        if (actual_end === undefined) {
          updatedActualEnd = null;
        }
      }
      if (updatedPercent === 100 && updatedActualEnd) {
        updatedStatus = 'completed';
      }

      await pool.query(
        `UPDATE tasks 
         SET name = ?, code = ?, duration = ?, work_item_id = ?, actual_start = ?, actual_end = ?, percent_complete = ?, status = ? 
         WHERE id = ?`,
        [updatedName, updatedCode, updatedDuration, updatedWorkItemId, updatedActualStart, updatedActualEnd, updatedPercent, updatedStatus, taskId]
      );

      try {
        await scheduleResultRepo.markStale(task.project_id);
      } catch {}

      res.json({ success: true, message: 'Cập nhật công việc thành công' });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 4b. Cập nhật tiến độ thực tế tách kế hoạch (S-15 / SCRUM-88 / SCRUM-100 / T-35)
  const updateTaskProgressHandler = async (req, res) => {
    if (checkViewerForbidden(req, res)) return;

    const taskId = Number(req.params.id);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      return res.status(400).json({ success: false, message: 'ID công việc không hợp lệ' });
    }

    const { actual_start, actual_end, percent_complete, confirm_reopen } = req.body;

    if (!db?.isConnected) {
      let pct = percent_complete !== undefined ? Number(percent_complete) : undefined;
      const updated = updateTaskData(taskId, {
        actual_start: actual_start !== undefined ? (actual_start ? String(actual_start).trim() : null) : undefined,
        actual_end: actual_end !== undefined ? (actual_end ? String(actual_end).trim() : null) : undefined,
        percent_complete: pct,
        status: pct === 100 ? 'completed' : (actual_start ? 'in_progress' : undefined)
      });
      return res.json({
        success: true,
        message: 'Cập nhật tiến độ thực tế thành công',
        data: updated
      });
    }

    try {
      const [existing] = await pool.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
      if (existing.length === 0) {
        return res.status(404).json({ success: false, message: 'Công việc không tồn tại' });
      }
      const task = existing[0];

      if (checkProjectReadAccess(req, res, task.project_id)) return;

      // AC 3: Validation phần trăm hoàn thành [0, 100]
      let newPercent = task.percent_complete !== null && task.percent_complete !== undefined ? Number(task.percent_complete) : 0;
      if (percent_complete !== undefined && percent_complete !== null && percent_complete !== '') {
        const pctNum = Number(percent_complete);
        if (isNaN(pctNum) || !Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100) {
          return res.status(400).json({
            success: false,
            message: 'Phần trăm hoàn thành phải nằm trong khoảng từ 0 đến 100'
          });
        }
        newPercent = pctNum;
      }

      // AC 2: Validation ngày kết thúc thực tế không được sớm hơn ngày bắt đầu thực tế
      let newActualStart = actual_start !== undefined 
        ? (actual_start ? String(actual_start).trim() : null) 
        : (task.actual_start ? formatDateISO(task.actual_start) : null);
        
      let newActualEnd = actual_end !== undefined 
        ? (actual_end ? String(actual_end).trim() : null) 
        : (task.actual_end ? formatDateISO(task.actual_end) : null);

      if (newActualStart && newActualEnd) {
        if (new Date(newActualEnd) < new Date(newActualStart)) {
          return res.status(400).json({
            success: false,
            message: 'Ngày kết thúc thực tế không được sớm hơn ngày bắt đầu thực tế'
          });
        }
      }

      // AC 4: Công việc đã kết thúc thực tế, nhập lại phần trăm < 100 -> hỏi xác nhận vì đang mở lại một việc đã xong
      const isTaskAlreadyFinished = task.status === 'completed' || Number(task.percent_complete) === 100 || (task.actual_end !== null && task.actual_end !== undefined);
      const isReopeningWithLessThan100 = percent_complete !== undefined && Number(percent_complete) < 100;

      if (isTaskAlreadyFinished && isReopeningWithLessThan100) {
        const isConfirmed = confirm_reopen === true || req.body?.confirm === true || req.query?.confirm === 'true';
        if (!isConfirmed) {
          return res.status(409).json({
            success: false,
            requires_confirmation: true,
            message: 'Công việc đã kết thúc thực tế. Bạn có chắc chắn muốn mở lại một việc đã xong với tiến độ nhỏ hơn 100% không?'
          });
        }
      }

      // AC 1: Giả sử một việc chưa bắt đầu, Khi nhập ngày bắt đầu thực tế -> chuyển sang đang làm, số liệu kế hoạch gốc (duration) không đổi
      let newStatus = task.status;
      if (task.status === 'pending' && newActualStart) {
        newStatus = 'in_progress';
      }

      // Nếu mở lại một việc đã xong
      if (isTaskAlreadyFinished && isReopeningWithLessThan100) {
        newStatus = 'in_progress';
        if (actual_end === undefined) {
          newActualEnd = null;
        }
      }

      // Nếu phần trăm đạt 100 và có ngày kết thúc thực tế -> completed
      if (newPercent === 100 && newActualEnd) {
        newStatus = 'completed';
      }

      // NFR: Cập nhật CSDL tách cột số liệu thực tế, KHÔNG GHI ĐÈ số liệu kế hoạch (duration giữ nguyên)
      await pool.query(
        `UPDATE tasks 
         SET actual_start = ?, actual_end = ?, percent_complete = ?, status = ? 
         WHERE id = ?`,
        [newActualStart, newActualEnd, newPercent, newStatus, taskId]
      );

      const [updatedRows] = await pool.query(
        `SELECT t.*, w.name AS work_item_name, w.code AS work_item_code 
         FROM tasks t 
         JOIN work_items w ON t.work_item_id = w.id 
         WHERE t.id = ?`,
        [taskId]
      );

      res.json({
        success: true,
        message: 'Cập nhật tiến độ thực tế thành công',
        data: updatedRows[0]
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  };

  router.patch('/tasks/:id/progress', updateTaskProgressHandler);
  router.put('/tasks/:id/progress', updateTaskProgressHandler);
  router.patch('/projects/:projectId/tasks/:id/progress', updateTaskProgressHandler);

  // 5. Xóa công việc (S-05 AC 4: hỏi xác nhận, xóa quan hệ liên quan trong transaction, ghi nhật ký)
  router.delete('/tasks/:id', async (req, res) => {
    if (checkViewerForbidden(req, res)) return;

    const taskId = Number(req.params.id);

    if (!db?.isConnected) {
      deleteTaskData(taskId);
      return res.json({
        success: true,
        deleted_dependencies_count: 0,
        message: 'Xóa công việc thành công'
      });
    }

    try {
      const [existing] = await pool.query('SELECT id, project_id FROM tasks WHERE id = ?', [taskId]);
      if (existing.length === 0) {
        return res.status(404).json({ success: false, message: 'Công việc không tồn tại' });
      }
      const taskProjectId = existing[0].project_id;

      if (checkProjectReadAccess(req, res, taskProjectId)) return;

      // Kiểm tra công việc có quan hệ phụ thuộc liên quan hay không
      let depRows = [];
      try {
        const [rows] = await pool.query(
          'SELECT id FROM task_dependencies WHERE predecessor_task_id = ? OR successor_task_id = ?',
          [taskId, taskId]
        );
        depRows = rows || [];
      } catch {
        depRows = [];
      }

      if (depRows.length > 0) {
        const isConfirmed = req.query?.confirm === 'true' || req.body?.confirm === true;
        if (!isConfirmed) {
          return res.status(409).json({
            success: false,
            requires_confirmation: true,
            dependency_count: depRows.length,
            message: `Công việc đang có ${depRows.length} quan hệ phụ thuộc liên kết. Vui lòng xác nhận để xóa công việc và các quan hệ phụ thuộc liên quan.`
          });
        }
      }

      // Thực thi xóa an toàn trong một transaction
      let conn = null;
      if (typeof pool.getConnection === 'function') {
        try {
          conn = await pool.getConnection();
          await conn.beginTransaction();
        } catch {
          conn = null;
        }
      }
      const executor = conn || pool;

      try {
        if (depRows.length > 0) {
          await executor.query(
            'DELETE FROM task_dependencies WHERE predecessor_task_id = ? OR successor_task_id = ?',
            [taskId, taskId]
          );
        }

        await executor.query('DELETE FROM tasks WHERE id = ?', [taskId]);

        if (conn) {
          await conn.commit();
        }

        // Ghi nhật ký thao tác (Audit log)
        console.log(`[AUDIT] Người dùng ID ${req.user?.userId || req.user?.id || 'anonymous'} đã xóa công việc ID ${taskId} ("${existing[0].name}") thuộc dự án ${taskProjectId}${depRows.length > 0 ? ` cùng ${depRows.length} quan hệ phụ thuộc liên kết` : ''}`);

        try {
          await scheduleResultRepo.markStale(taskProjectId);
        } catch {}

        res.json({
          success: true,
          deleted_dependencies_count: depRows.length,
          message: 'Xóa công việc thành công'
        });
      } catch (transErr) {
        if (conn) {
          try { await conn.rollback(); } catch {}
        }
        throw transErr;
      } finally {
        if (conn && typeof conn.release === 'function') {
          conn.release();
        }
      }
    } catch (err) {
      if (err.errno === 1451 || err.code === 'ER_ROW_IS_REFERENCED_2') {
        return res.status(409).json({
          success: false,
          message: 'Không thể xóa công việc do ràng buộc khóa ngoại chưa được giải phóng.'
        });
      }
      res.status(500).json({ success: false, message: err.message });
    }
  });

  return router;
};
