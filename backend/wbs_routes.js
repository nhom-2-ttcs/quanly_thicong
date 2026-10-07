const express = require('express');
const { checkViewerForbidden, checkProjectReadAccess } = require('./src/utils/rbac');
const router = express.Router();
const {
  getSession,
  inMemoryWorkItems,
  inMemoryMilestones,
  getMilestones,
  createMilestoneData,
  findWorkItemById
} = require('./src/models/store');

module.exports = (db) => {
  const pool = db ? (db.pool || db) : null;

  // Hàm kiểm tra xác thực và phân quyền (Chỉ Chủ đầu tư, Chỉ huy trưởng/Ban quản lý và Admin mới được đặt milestone - Tiêu chí 5)
  function authenticateAndAuthorizeMilestone(req, res) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '') || req.query.token || req.body?.token;
    const session = getSession(token);

    if (!session) {
      res.status(401).json({
        success: false,
        message: 'Vui lòng đăng nhập để thực hiện đặt mốc tiến độ (milestone).'
      });
      return null;
    }

    const ALLOWED_ROLES = ['client', 'project_manager', 'admin'];
    const ALLOWED_ROLE_IDS = [1, 2, 6];

    const isRoleAllowed = ALLOWED_ROLES.includes(session.role_name) || ALLOWED_ROLE_IDS.includes(session.role_id);
    if (!isRoleAllowed) {
      res.status(403).json({
        success: false,
        message: 'Chỉ Chủ đầu tư và Ban quản lý (Chỉ huy trưởng) mới được phép đặt mốc tiến độ (milestone).'
      });
      return null;
    }

    return session;
  }

  // Hàm đệ quy kiểm tra targetParentId có phải con/cháu của itemId không
  async function isDescendant(itemId, targetParentId) {
    if (!targetParentId) return false;
    if (parseInt(itemId) === parseInt(targetParentId)) return true;

    let currentParent = targetParentId;
    while (currentParent !== null) {
      if (parseInt(currentParent) === parseInt(itemId)) {
        return true;
      }
      if (pool && pool.query) {
        try {
          const [rows] = await pool.query('SELECT parent_id FROM work_items WHERE id = ?', [currentParent]);
          if (!rows || rows.length === 0) break;
          currentParent = rows[0].parent_id;
          continue;
        } catch (e) {}
      }
      const item = inMemoryWorkItems.find(w => w.id === parseInt(currentParent, 10));
      if (!item) break;
      currentParent = item.parent_id;
    }
    return false;
  }

  // 1. Lấy danh sách hạng mục theo dự án
  router.get('/projects/:projectId/work-items', async (req, res) => {
    if (checkProjectReadAccess(req, res, req.params.projectId)) return;

    try {
      if (pool && pool.query) {
        try {
          const [rows] = await pool.query(
            'SELECT * FROM work_items WHERE project_id = ? ORDER BY id ASC',
            [req.params.projectId]
          );
          if (rows && rows.length > 0) {
            return res.json({ success: true, data: rows });
          }
        } catch (err) {
          console.warn('[WBS] Dùng fallback in-memory cho work-items:', err.message);
        }
      }
      res.json({ success: true, data: inMemoryWorkItems });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 2. Thêm hạng mục mới
  router.post('/work-items', async (req, res) => {
    if (checkViewerForbidden(req, res)) return;

    const { project_id, parent_id, name, code, unit, quantity } = req.body;
    if (!name || !project_id) {
      return res.status(400).json({ success: false, message: 'Thiếu tên hạng mục hoặc project_id' });
    }
    try {
      if (pool && pool.query) {
        try {
          const [result] = await pool.query(
            'INSERT INTO work_items (project_id, parent_id, name, code, unit, quantity) VALUES (?, ?, ?, ?, ?, ?)',
            [project_id, parent_id || null, name, code || null, unit || null, quantity || 0]
          );
          return res.json({ success: true, id: result.insertId, message: 'Thêm hạng mục thành công' });
        } catch (err) {
          console.warn('[WBS] DB insert fail, rollback to in-memory:', err.message);
        }
      }
      const newId = inMemoryWorkItems.length > 0 ? Math.max(...inMemoryWorkItems.map(w => w.id)) + 1 : 1;
      const newItem = {
        id: newId,
        project_id: parseInt(project_id, 10),
        parent_id: parent_id ? parseInt(parent_id, 10) : null,
        name: name.trim(),
        code: code ? code.trim() : `HM-${newId}`,
        unit: unit || null,
        quantity: quantity || 0,
        status: 'pending'
      };
      inMemoryWorkItems.push(newItem);
      res.json({ success: true, id: newId, message: 'Thêm hạng mục thành công' });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 3. Cập nhật hạng mục (Chặn vòng lặp đệ quy T-10)
  router.put('/work-items/:id', async (req, res) => {
    if (checkViewerForbidden(req, res)) return;

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

      if (pool && pool.query) {
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
        } catch (err) {
          console.warn('[WBS] DB update fail, using fallback:', err.message);
        }
      }

      const item = inMemoryWorkItems.find(w => w.id === parseInt(itemId, 10));
      if (item) {
        if (name !== undefined) item.name = name;
        if (code !== undefined) item.code = code;
        if (unit !== undefined) item.unit = unit;
        if (quantity !== undefined) item.quantity = quantity;
        if (status !== undefined) item.status = status;
        if (parent_id !== undefined) item.parent_id = parent_id ? parseInt(parent_id, 10) : null;
      }

      res.json({ success: true, message: 'Cập nhật thành công' });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 4. Xóa hạng mục (Chặn xóa khi có con T-10)
  router.delete('/work-items/:id', async (req, res) => {
    if (checkViewerForbidden(req, res)) return;

    const itemId = req.params.id;
    try {
      let hasChildren = false;
      if (pool && pool.query) {
        try {
          const [children] = await pool.query('SELECT id FROM work_items WHERE parent_id = ?', [itemId]);
          if (children && children.length > 0) hasChildren = true;
        } catch (err) {}
      }

      if (!hasChildren) {
        const memChildren = inMemoryWorkItems.filter(w => w.parent_id === parseInt(itemId, 10));
        if (memChildren.length > 0) hasChildren = true;
      }

      if (hasChildren) {
        return res.status(400).json({ 
          success: false, 
          message: `Lỗi ràng buộc (T-10): Không thể xoá vì hạng mục này đang có hạng mục con!` 
        });
      }

      // Kiểm tra ràng buộc công việc (S-05): Chặn xoá khi hạng mục đang chứa công việc
      if (pool && pool.query) {
        try {
          const [tasks] = await pool.query('SELECT id FROM tasks WHERE work_item_id = ?', [itemId]);
          if (tasks && tasks.length > 0) {
            return res.status(409).json({
              success: false,
              message: 'Lỗi ràng buộc: Không thể xoá vì hạng mục này đang có công việc thi công gắn vào!'
            });
          }
          await pool.query('DELETE FROM work_items WHERE id = ?', [itemId]);
        } catch (err) {
          if (err.statusCode === 409 || err.status === 409) throw err;
        }
      }

      const idx = inMemoryWorkItems.findIndex(w => w.id === parseInt(itemId, 10));
      if (idx !== -1) {
        inMemoryWorkItems.splice(idx, 1);
      }
      res.json({ success: true, message: 'Xóa hạng mục thành công' });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // ==========================================================
  // CÁC ENDPOINT CHO TASK T-43: BẢNG MILESTONES
  // ==========================================================

  // 5. Lấy danh sách milestones (Lọc theo work_item_id hoặc lấy tất cả mốc đang hiệu lực)
  router.get('/milestones', async (req, res) => {
    try {
      const { work_item_id, is_active } = req.query;

      if (pool && pool.query) {
        try {
          let sql = `
            SELECT m.id, m.work_item_id, DATE_FORMAT(m.due_date, '%Y-%m-%d') AS due_date, m.title, m.created_by, m.is_active, m.created_at,
                   u.full_name AS created_by_name, r.display_name AS created_by_role,
                   w.name AS work_item_name, w.code AS work_item_code
            FROM milestones m
            LEFT JOIN users u ON m.created_by = u.id
            LEFT JOIN roles r ON u.role_id = r.id
            LEFT JOIN work_items w ON m.work_item_id = w.id
            WHERE 1=1
          `;
          const params = [];

          if (work_item_id) {
            sql += ` AND m.work_item_id = ?`;
            params.push(work_item_id);
          }
          if (is_active !== undefined) {
            sql += ` AND m.is_active = ?`;
            params.push(is_active === 'true' || is_active === '1' ? 1 : 0);
          } else {
            // Mặc định lấy mốc đang hiệu lực (NFR T-43)
            sql += ` AND m.is_active = 1`;
          }

          sql += ` ORDER BY m.created_at DESC`;

          const [rows] = await pool.query(sql, params);
          if (rows && rows.length > 0) {
            return res.json({ success: true, data: rows });
          }
        } catch (err) {
          console.warn('[MILESTONES] MySQL query fail, using fallback:', err.message);
        }
      }

      // Fallback in-memory
      const filter = {};
      if (work_item_id) filter.work_item_id = work_item_id;
      filter.is_active = is_active !== undefined ? (is_active === 'true' || is_active === '1') : true;

      const milestones = getMilestones(filter);
      res.json({ success: true, data: milestones });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 6. Tạo mốc tiến độ (Milestone) mới cho hạng mục (T-43)
  router.post('/milestones', async (req, res) => {
    const session = authenticateAndAuthorizeMilestone(req, res);
    if (!session) return; // Đã trả về 401 hoặc 403

    const { work_item_id, due_date, title } = req.body;

    // Validation 1: Kiểm tra dữ liệu đầu vào
    if (!work_item_id) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng chọn hạng mục công việc để gắn milestone.'
      });
    }

    if (!due_date) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập ngày bắt buộc cho milestone.'
      });
    }

    const parsedDate = new Date(due_date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Ngày bắt buộc không hợp lệ. Vui lòng định dạng YYYY-MM-DD.'
      });
    }

    const cleanTitle = title ? title.trim() : null;
    const workItemIdInt = parseInt(work_item_id, 10);
    const creatorId = session.userId;

    try {
      let createdMilestone = null;

      if (pool && pool.query) {
        try {
          // NFR T-43: Đảm bảo một hạng mục chỉ có 1 mốc bàn giao đang hiệu lực
          // Vô hiệu hóa mốc cũ trước khi tạo mốc mới
          await pool.query(
            'UPDATE milestones SET is_active = 0 WHERE work_item_id = ? AND is_active = 1',
            [workItemIdInt]
          );

          const [result] = await pool.query(
            'INSERT INTO milestones (work_item_id, due_date, title, created_by, is_active) VALUES (?, ?, ?, ?, 1)',
            [workItemIdInt, due_date, cleanTitle, creatorId]
          );

          createdMilestone = {
            id: result.insertId,
            work_item_id: workItemIdInt,
            due_date,
            title: cleanTitle,
            created_by: creatorId,
            created_by_name: session.full_name,
            created_by_role: session.role_display_name || session.role_name,
            is_active: 1
          };
        } catch (err) {
          console.warn('[MILESTONES] MySQL insert fail, fallback to in-memory:', err.message);
        }
      }

      // Luôn đồng bộ với in-memory store để hỗ trợ test & standalone mode
      const memMilestone = createMilestoneData({
        work_item_id: workItemIdInt,
        due_date,
        title: cleanTitle,
        created_by: creatorId
      });

      if (!createdMilestone) {
        createdMilestone = memMilestone;
      }

      return res.status(201).json({
        success: true,
        message: 'Đặt mốc tiến độ (milestone) thành công!',
        data: createdMilestone
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 7. Endpoint đường dẫn RESTful thay thế: POST /api/work-items/:workItemId/milestones
  router.post('/work-items/:workItemId/milestones', async (req, res) => {
    req.body.work_item_id = req.params.workItemId;
    return router.handle(req, res);
  });

  // 8. Vô hiệu hóa / Hủy mốc tiến độ (Milestone)
  router.delete('/milestones/:id', async (req, res) => {
    const session = authenticateAndAuthorizeMilestone(req, res);
    if (!session) return;

    const milestoneId = parseInt(req.params.id, 10);
    try {
      if (pool && pool.query) {
        try {
          await pool.query('UPDATE milestones SET is_active = 0 WHERE id = ?', [milestoneId]);
        } catch (err) {}
      }

      const mem = inMemoryMilestones.find(m => m.id === milestoneId);
      if (mem) mem.is_active = 0;

      res.json({ success: true, message: 'Đã hủy mốc tiến độ thành công.' });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  return router;
};

