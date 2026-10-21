const express = require('express');
const {
  checkViewerForbidden,
  checkProjectReadAccess,
  checkProjectManagerAccess
} = require('../utils/rbac');
const {
  canUserAccessProject,
  inMemoryProjects,
  inMemoryUsers,
  SEED_ROLES,
  findUserByEmail,
  createUser,
  getProjectMembers,
  findProjectMember,
  countProjectManagers,
  addProjectMember,
  updateProjectMemberRole,
  removeProjectMember,
  getProjectInvitations,
  findPendingInvitation,
  createProjectInvitation,
  getProjectSiteLocation,
  updateProjectSiteLocation
} = require('../models/store');
const { isValidCalendarDate, withStartDate } = require('../utils/projectStartDate');

module.exports = (db) => {
  const router = express.Router();
  const pool = db?.pool || db;

  // 1. Lấy danh sách dự án (Viewer và thành viên chỉ thấy dự án được phân quyền, Admin thấy tất cả)
  router.get('/projects', async (req, res) => {
    if (db && db.isConnected === false) {
      let rows = inMemoryProjects;
      if (req.user && req.user.role_name !== 'admin' && req.user.role_id !== 1) {
        rows = rows.filter(p => canUserAccessProject(req.user, p.id));
      }
      return res.json({ success: true, data: rows.map(withStartDate) });
    }
    try {
      let [rows] = await pool.query('SELECT * FROM projects ORDER BY id ASC');
      
      // Nếu người dùng không phải Admin hệ thống, lọc chỉ lấy dự án được cấp quyền
      if (req.user && req.user.role_name !== 'admin' && req.user.role_id !== 1) {
        const uId = req.user.userId || req.user.id;
        try {
          const [memberRows] = await pool.query('SELECT project_id FROM project_members WHERE user_id = ?', [uId]);
          const allowedIds = new Set(memberRows.map(r => Number(r.project_id)));
          rows = rows.filter(p => allowedIds.has(Number(p.id)) || canUserAccessProject(req.user, p.id));
        } catch (mErr) {
          rows = rows.filter(p => canUserAccessProject(req.user, p.id));
        }
      }

      res.json({ success: true, data: rows.map(withStartDate) });
    } catch (err) {
      let rows = inMemoryProjects;
      if (req.user && req.user.role_name !== 'admin' && req.user.role_id !== 1) {
        rows = rows.filter(p => canUserAccessProject(req.user, p.id));
      }
      res.json({ success: true, data: rows });
    }
  });

  // 2. Lấy thông tin chi tiết một dự án
  router.get('/projects/:id', async (req, res) => {
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'Mã dự án không hợp lệ' });
    }

    if (checkProjectReadAccess(req, res, projectId)) return;

    if (db && db.isConnected === false) {
      const proj = inMemoryProjects.find(p => p.id === projectId);
      if (!proj) {
        return res.status(404).json({ success: false, message: 'Dự án không tồn tại' });
      }
      return res.json({ success: true, data: withStartDate(proj) });
    }

    try {
      const [rows] = await pool.query('SELECT * FROM projects WHERE id = ?', [projectId]);
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Dự án không tồn tại' });
      }
      res.json({ success: true, data: withStartDate(rows[0]) });
    } catch (err) {
      const proj = inMemoryProjects.find(p => p.id === projectId);
      if (!proj) {
        return res.status(404).json({ success: false, message: 'Dự án không tồn tại' });
      }
      res.json({ success: true, data: proj });
    }
  });

  // 3. Tạo dự án mới (Viewer bị cấm -> 403)
  router.post('/projects', async (req, res) => {
    if (checkViewerForbidden(req, res)) return;

    const { name, code, description, start_date } = req.body;
    if (!name || !code) {
      return res.status(400).json({ success: false, message: 'Tên dự án và mã dự án không được để trống' });
    }
    if (start_date !== undefined && start_date !== null && start_date !== '' && !isValidCalendarDate(start_date)) {
      return res.status(400).json({ success: false, message: 'Ngày khởi công không hợp lệ (định dạng YYYY-MM-DD)' });
    }

    try {
      const [result] = await pool.query(
        'INSERT INTO projects (name, code, description, start_date) VALUES (?, ?, ?, ?)',
        [name.trim(), code.trim(), description ? description.trim() : null, start_date || null]
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
    const { name, code, description, start_date, site_latitude, site_longitude, site_radius_meters, latitude, longitude, radius_meters } = req.body;
    if (start_date !== undefined && start_date !== null && !isValidCalendarDate(start_date)) {
      return res.status(400).json({ success: false, message: 'Ngày khởi công không hợp lệ (định dạng YYYY-MM-DD)' });
    }

    const latVal = site_latitude !== undefined ? site_latitude : latitude;
    const lonVal = site_longitude !== undefined ? site_longitude : longitude;
    const radVal = site_radius_meters !== undefined ? site_radius_meters : radius_meters;

    if (latVal !== undefined && latVal !== null && latVal !== '') {
      const nLat = Number(latVal);
      if (isNaN(nLat) || nLat < -90 || nLat > 90) {
        return res.status(400).json({ success: false, message: 'Vĩ độ tâm công trường không hợp lệ (-90 đến 90 độ)' });
      }
    }
    if (lonVal !== undefined && lonVal !== null && lonVal !== '') {
      const nLon = Number(lonVal);
      if (isNaN(nLon) || nLon < -180 || nLon > 180) {
        return res.status(400).json({ success: false, message: 'Kinh độ tâm công trường không hợp lệ (-180 đến 180 độ)' });
      }
    }
    if (radVal !== undefined && radVal !== null && radVal !== '') {
      const nRad = Number(radVal);
      if (isNaN(nRad) || nRad <= 0) {
        return res.status(400).json({ success: false, message: 'Bán kính công trường phải là số dương lớn hơn 0 mét' });
      }
    }

    if (checkProjectReadAccess(req, res, projectId)) return;

    if (db && db.isConnected === false) {
      const proj = inMemoryProjects.find(p => p.id === projectId);
      if (!proj) return res.status(404).json({ success: false, message: 'Dự án không tồn tại' });
      if (name) proj.name = name.trim();
      if (code) proj.code = code.trim();
      if (description) proj.description = description.trim();
      if (start_date) proj.start_date = start_date;
      if (latVal !== undefined) proj.site_latitude = latVal !== null && latVal !== '' ? Number(latVal) : null;
      if (lonVal !== undefined) proj.site_longitude = lonVal !== null && lonVal !== '' ? Number(lonVal) : null;
      if (radVal !== undefined) proj.site_radius_meters = radVal !== null && radVal !== '' ? Number(radVal) : null;
      return res.json({ success: true, message: 'Cập nhật dự án thành công', data: withStartDate(proj) });
    }

    try {
      const [existing] = await pool.query('SELECT id FROM projects WHERE id = ?', [projectId]);
      if (existing.length === 0) {
        return res.status(404).json({ success: false, message: 'Dự án không tồn tại' });
      }

      await pool.query(
        `UPDATE projects
         SET name = COALESCE(?, name),
             code = COALESCE(?, code),
             description = COALESCE(?, description),
             start_date = COALESCE(?, start_date),
             site_latitude = COALESCE(?, site_latitude),
             site_longitude = COALESCE(?, site_longitude),
             site_radius_meters = COALESCE(?, site_radius_meters)
         WHERE id = ?`,
        [
          name ? name.trim() : null,
          code ? code.trim() : null,
          description ? description.trim() : null,
          start_date || null,
          latVal !== undefined && latVal !== '' ? Number(latVal) : null,
          lonVal !== undefined && lonVal !== '' ? Number(lonVal) : null,
          radVal !== undefined && radVal !== '' ? Number(radVal) : null,
          projectId
        ]
      );
      res.json({ success: true, message: 'Cập nhật dự án thành công' });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 4b. S-41 (SCRUM-170 / AC 1): Lấy toạ độ tâm và bán kính công trường dự án
  router.get('/projects/:id/site-location', async (req, res) => {
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'Mã dự án không hợp lệ' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;

    if (db && db.isConnected === false) {
      const loc = getProjectSiteLocation(projectId);
      if (!loc) return res.status(404).json({ success: false, message: 'Dự án không tồn tại' });
      return res.json({ success: true, data: loc });
    }

    try {
      const [rows] = await pool.query('SELECT site_latitude, site_longitude, site_radius_meters FROM projects WHERE id = ?', [projectId]);
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Dự án không tồn tại' });
      }
      res.json({
        success: true,
        data: {
          site_latitude: rows[0].site_latitude !== null ? Number(rows[0].site_latitude) : null,
          site_longitude: rows[0].site_longitude !== null ? Number(rows[0].site_longitude) : null,
          site_radius_meters: rows[0].site_radius_meters !== null ? Number(rows[0].site_radius_meters) : null
        }
      });
    } catch (err) {
      const loc = getProjectSiteLocation(projectId);
      if (!loc) return res.status(404).json({ success: false, message: 'Dự án không tồn tại' });
      res.json({ success: true, data: loc });
    }
  });

  // 4c. S-41 (SCRUM-170 / AC 1): Khai báo/cập nhật toạ độ tâm và bán kính công trường dự án
  router.put('/projects/:id/site-location', async (req, res) => {
    if (checkViewerForbidden(req, res)) return;
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'Mã dự án không hợp lệ' });
    }
    if (checkProjectManagerAccess(req, res, projectId)) return;

    const { site_latitude, site_longitude, site_radius_meters, latitude, longitude, radius_meters } = req.body || {};
    const latVal = site_latitude !== undefined ? site_latitude : latitude;
    const lonVal = site_longitude !== undefined ? site_longitude : longitude;
    const radVal = site_radius_meters !== undefined ? site_radius_meters : radius_meters;

    if (latVal !== undefined && latVal !== null && latVal !== '') {
      const nLat = Number(latVal);
      if (isNaN(nLat) || nLat < -90 || nLat > 90) {
        return res.status(400).json({ success: false, message: 'Vĩ độ tâm công trường không hợp lệ (-90 đến 90 độ).' });
      }
    }
    if (lonVal !== undefined && lonVal !== null && lonVal !== '') {
      const nLon = Number(lonVal);
      if (isNaN(nLon) || nLon < -180 || nLon > 180) {
        return res.status(400).json({ success: false, message: 'Kinh độ tâm công trường không hợp lệ (-180 đến 180 độ).' });
      }
    }
    if (radVal !== undefined && radVal !== null && radVal !== '') {
      const nRad = Number(radVal);
      if (isNaN(nRad) || nRad <= 0) {
        return res.status(400).json({ success: false, message: 'Bán kính công trường phải là số dương lớn hơn 0 mét.' });
      }
    }

    const newLat = (latVal !== undefined && latVal !== null && latVal !== '') ? Number(latVal) : null;
    const newLon = (lonVal !== undefined && lonVal !== null && lonVal !== '') ? Number(lonVal) : null;
    const newRad = (radVal !== undefined && radVal !== null && radVal !== '') ? Number(radVal) : null;

    if (db && db.isConnected === false) {
      const updated = updateProjectSiteLocation(projectId, {
        site_latitude: newLat,
        site_longitude: newLon,
        site_radius_meters: newRad
      });
      return res.json({
        success: true,
        message: 'Khai báo toạ độ tâm và bán kính công trường thành công.',
        data: updated
      });
    }

    try {
      const [existing] = await pool.query('SELECT id FROM projects WHERE id = ?', [projectId]);
      if (existing.length === 0) {
        return res.status(404).json({ success: false, message: 'Dự án không tồn tại' });
      }

      await pool.query(
        'UPDATE projects SET site_latitude = ?, site_longitude = ?, site_radius_meters = ? WHERE id = ?',
        [newLat, newLon, newRad, projectId]
      );

      // Đồng bộ in-memory
      updateProjectSiteLocation(projectId, {
        site_latitude: newLat,
        site_longitude: newLon,
        site_radius_meters: newRad
      });

      res.json({
        success: true,
        message: 'Khai báo toạ độ tâm và bán kính công trường thành công.',
        data: {
          site_latitude: newLat,
          site_longitude: newLon,
          site_radius_meters: newRad
        }
      });
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

  // ==========================================
  // S-28 (SCRUM-120): QUẢN LÝ THÀNH VIÊN DỰ ÁN VÀ LỜI MỜI
  // ==========================================

  // 6. Lấy danh sách thành viên dự án
  router.get('/projects/:id/members', async (req, res) => {
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'Mã dự án không hợp lệ' });
    }

    if (checkProjectReadAccess(req, res, projectId)) return;

    if (db && db.isConnected === false) {
      const proj = inMemoryProjects.find(p => p.id === projectId);
      if (!proj) {
        return res.status(404).json({ success: false, message: 'Dự án không tồn tại' });
      }
      const members = getProjectMembers(projectId);
      return res.json({ success: true, data: members });
    }

    try {
      const [projRows] = await pool.query('SELECT id FROM projects WHERE id = ?', [projectId]);
      if (projRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Dự án không tồn tại' });
      }

      const [members] = await pool.query(`
        SELECT pm.project_id, pm.user_id, pm.role_id, pm.created_at,
               u.email, u.full_name,
               r.name AS role_name, r.display_name AS role_display_name
        FROM project_members pm
        JOIN users u ON pm.user_id = u.id
        LEFT JOIN roles r ON pm.role_id = r.id
        WHERE pm.project_id = ?
        ORDER BY pm.created_at ASC
      `, [projectId]);

      res.json({ success: true, data: members });
    } catch (err) {
      const members = getProjectMembers(projectId);
      res.json({ success: true, data: members });
    }
  });

  // 7. Thêm thành viên vào dự án hoặc tạo lời mời (AC 1 & AC 2)
  router.post('/projects/:id/members', async (req, res) => {
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'Mã dự án không hợp lệ' });
    }

    // Kiểm tra quyền: Phải là Ban quản lý dự án hoặc Admin (S-28)
    if (checkProjectManagerAccess(req, res, projectId)) return;

    // Kiểm tra dự án tồn tại
    if (db && db.isConnected === false) {
      const proj = inMemoryProjects.find(p => p.id === projectId);
      if (!proj) {
        return res.status(404).json({ success: false, message: 'Dự án không tồn tại' });
      }
    } else {
      try {
        const [projRows] = await pool.query('SELECT id FROM projects WHERE id = ?', [projectId]);
        if (projRows.length === 0) {
          return res.status(404).json({ success: false, message: 'Dự án không tồn tại' });
        }
      } catch (e) {
        const proj = inMemoryProjects.find(p => p.id === projectId);
        if (!proj) {
          return res.status(404).json({ success: false, message: 'Dự án không tồn tại' });
        }
      }
    }

    const { user_id, userId, email, role_id, roleId, role } = req.body || {};

    // Chuẩn hóa role
    let resolvedRoleId = Number(role_id || roleId);
    if (!resolvedRoleId && role) {
      const r = SEED_ROLES.find(x => x.name.toLowerCase() === String(role).toLowerCase() || x.display_name.toLowerCase() === String(role).toLowerCase());
      if (r) resolvedRoleId = r.id;
    }
    if (!resolvedRoleId && !role_id && !roleId && !role) {
      resolvedRoleId = 4; // Mặc định Đội trưởng thi công (AC 1)
    }

    // Role không được là Admin hệ thống (role_id 1)
    if (resolvedRoleId === 1 || String(role).toLowerCase() === 'admin') {
      return res.status(400).json({
        success: false,
        message: 'Vai trò không hợp lệ trong dự án. Không thể gán quyền quản trị viên hệ thống.'
      });
    }

    // Kiểm tra vai trò hợp lệ (2, 3, 4, 5, 6, 7)
    const validRole = SEED_ROLES.find(r => r.id === resolvedRoleId);
    if (!validRole || resolvedRoleId < 2 || resolvedRoleId > 7) {
      return res.status(400).json({
        success: false,
        message: 'Vai trò dự án không hợp lệ. Vui lòng chọn một trong các vai trò thi công hợp lệ.'
      });
    }

    const targetUserId = Number(user_id || userId);
    let targetEmail = email ? String(email).trim().toLowerCase() : null;

    if (targetEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(targetEmail)) {
        return res.status(400).json({
          success: false,
          message: 'Định dạng email không hợp lệ.'
        });
      }
    }

    if (!targetUserId && !targetEmail) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp ID người dùng hoặc email để thêm vào dự án.'
      });
    }

    // Tìm user mục tiêu
    let targetUser = null;
    if (targetUserId) {
      targetUser = inMemoryUsers.find(u => u.id === targetUserId);
      if (!targetUser && pool && db.isConnected !== false) {
        try {
          const [uRows] = await pool.query('SELECT * FROM users WHERE id = ?', [targetUserId]);
          if (uRows.length > 0) targetUser = uRows[0];
        } catch (e) {}
      }
      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: 'Không tìm thấy người dùng trong hệ thống.'
        });
      }
      targetEmail = targetUser.email.toLowerCase();
    } else if (targetEmail) {
      targetUser = findUserByEmail(targetEmail);
      if (!targetUser && pool && db.isConnected !== false) {
        try {
          const [uRows] = await pool.query('SELECT * FROM users WHERE LOWER(email) = ?', [targetEmail]);
          if (uRows.length > 0) targetUser = uRows[0];
        } catch (e) {}
      }
    }

    // Trường hợp 1: Người dùng ĐÃ CÓ TÀI KHOẢN (AC 1)
    if (targetUser) {
      const existingMember = findProjectMember(projectId, targetUser.id);
      if (existingMember) {
        return res.status(409).json({
          success: false,
          message: 'Người dùng này đã là thành viên của dự án.'
        });
      }

      if (pool && db.isConnected !== false) {
        try {
          const [checkRows] = await pool.query(
            'SELECT * FROM project_members WHERE project_id = ? AND user_id = ?',
            [projectId, targetUser.id]
          );
          if (checkRows.length > 0) {
            return res.status(409).json({
              success: false,
              message: 'Người dùng này đã là thành viên của dự án.'
            });
          }

          await pool.query(
            'INSERT INTO project_members (project_id, user_id, role_id) VALUES (?, ?, ?)',
            [projectId, targetUser.id, resolvedRoleId]
          );
        } catch (dbErr) {
          if (dbErr.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
              success: false,
              message: 'Người dùng này đã là thành viên của dự án.'
            });
          }
        }
      }

      // Cập nhật bộ nhớ in-memory ngay lập tức
      addProjectMember({
        projectId,
        userId: targetUser.id,
        roleId: resolvedRoleId
      });

      return res.status(201).json({
        success: true,
        message: `Đã thêm thành viên "${targetUser.full_name}" vào dự án với vai trò "${validRole.display_name}".`,
        data: {
          project_id: projectId,
          user_id: targetUser.id,
          email: targetUser.email,
          full_name: targetUser.full_name,
          role_id: resolvedRoleId,
          role_name: validRole.name,
          role_display_name: validRole.display_name
        }
      });
    }

    // Trường hợp 2: Người dùng CHƯA CÓ TÀI KHOẢN -> Tạo lời mời (AC 2)
    const existingInv = findPendingInvitation(targetEmail, projectId);
    if (existingInv) {
      return res.status(409).json({
        success: false,
        message: 'Lời mời cho email này đã tồn tại và đang chờ phản hồi.'
      });
    }

    if (pool && db.isConnected !== false) {
      try {
        const [invRows] = await pool.query(
          "SELECT * FROM project_invitations WHERE project_id = ? AND email = ? AND status = 'pending'",
          [projectId, targetEmail]
        );
        if (invRows.length > 0) {
          return res.status(409).json({
            success: false,
            message: 'Lời mời cho email này đã tồn tại và đang chờ phản hồi.'
          });
        }
      } catch (e) {}
    }

    const currentUserId = req.user ? (req.user.id || req.user.userId) : null;
    const inv = createProjectInvitation({
      projectId,
      email: targetEmail,
      roleId: resolvedRoleId,
      invitedBy: currentUserId
    });

    createUser({
      email: targetEmail,
      full_name: targetEmail.split('@')[0],
      role_id: resolvedRoleId,
      must_set_password: true
    });

    if (pool && db.isConnected !== false) {
      try {
        await pool.query(
          'INSERT INTO project_invitations (project_id, email, role_id, invited_by, status) VALUES (?, ?, ?, ?, ?)',
          [projectId, targetEmail, resolvedRoleId, currentUserId, 'pending']
        );
        await pool.query(
          'INSERT IGNORE INTO users (email, password_hash, salt, full_name, role_id, must_set_password) VALUES (?, ?, ?, ?, ?, TRUE)',
          [targetEmail, '', '', targetEmail.split('@')[0], resolvedRoleId]
        );
      } catch (dbErr) {}
    }

    return res.status(201).json({
      success: true,
      message: `Đã tạo lời mời cho email "${targetEmail}" với vai trò "${validRole.display_name}". Người dùng có thể đặt mật khẩu ở lần đăng nhập đầu tiên.`,
      data: {
        invitation_id: inv.id,
        project_id: projectId,
        email: targetEmail,
        role_id: resolvedRoleId,
        role_name: validRole.name,
        role_display_name: validRole.display_name,
        status: 'pending'
      }
    });
  });

  // 8. Tạo lời mời tham gia dự án (S-28 / AC 2 endpoint chuyên biệt)
  const inviteHandler = async (req, res) => {
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'Mã dự án không hợp lệ' });
    }

    if (checkProjectManagerAccess(req, res, projectId)) return;

    if (db && db.isConnected === false) {
      const proj = inMemoryProjects.find(p => p.id === projectId);
      if (!proj) {
        return res.status(404).json({ success: false, message: 'Dự án không tồn tại' });
      }
    } else {
      try {
        const [projRows] = await pool.query('SELECT id FROM projects WHERE id = ?', [projectId]);
        if (projRows.length === 0) {
          return res.status(404).json({ success: false, message: 'Dự án không tồn tại' });
        }
      } catch (e) {
        const proj = inMemoryProjects.find(p => p.id === projectId);
        if (!proj) {
          return res.status(404).json({ success: false, message: 'Dự án không tồn tại' });
        }
      }
    }

    const { email, role_id, roleId, role } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, message: 'Vui lòng cung cấp địa chỉ email.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({ success: false, message: 'Định dạng email không hợp lệ.' });
    }

    let resolvedRoleId = Number(role_id || roleId);
    if (!resolvedRoleId && role) {
      const r = SEED_ROLES.find(x => x.name.toLowerCase() === String(role).toLowerCase() || x.display_name.toLowerCase() === String(role).toLowerCase());
      if (r) resolvedRoleId = r.id;
    }
    if (!resolvedRoleId) {
      resolvedRoleId = 4; // Mặc định Đội trưởng thi công (AC 1)
    }

    if (resolvedRoleId === 1 || String(role).toLowerCase() === 'admin') {
      return res.status(400).json({
        success: false,
        message: 'Vai trò không hợp lệ trong dự án. Không thể gán quyền quản trị viên hệ thống.'
      });
    }

    const validRole = SEED_ROLES.find(r => r.id === resolvedRoleId);
    if (!validRole || resolvedRoleId < 2 || resolvedRoleId > 7) {
      return res.status(400).json({
        success: false,
        message: 'Vai trò dự án không hợp lệ.'
      });
    }

    // Nếu email này đã có tài khoản, thêm thẳng vào dự án
    let existingUser = findUserByEmail(cleanEmail);
    if (!existingUser && pool && db.isConnected !== false) {
      try {
        const [uRows] = await pool.query('SELECT * FROM users WHERE LOWER(email) = ?', [cleanEmail]);
        if (uRows.length > 0) existingUser = uRows[0];
      } catch (e) {}
    }

    if (existingUser) {
      const existingMember = findProjectMember(projectId, existingUser.id);
      if (existingMember) {
        return res.status(409).json({ success: false, message: 'Người dùng này đã là thành viên của dự án.' });
      }

      if (pool && db.isConnected !== false) {
        try {
          await pool.query(
            'INSERT INTO project_members (project_id, user_id, role_id) VALUES (?, ?, ?)',
            [projectId, existingUser.id, resolvedRoleId]
          );
        } catch (dbErr) {
          if (dbErr.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: 'Người dùng này đã là thành viên của dự án.' });
          }
        }
      }

      addProjectMember({ projectId, userId: existingUser.id, roleId: resolvedRoleId });
      return res.status(201).json({
        success: true,
        message: `Đã thêm thành viên "${existingUser.full_name}" vào dự án với vai trò "${validRole.display_name}".`,
        data: {
          project_id: projectId,
          user_id: existingUser.id,
          email: existingUser.email,
          full_name: existingUser.full_name,
          role_id: resolvedRoleId,
          role_name: validRole.name,
          role_display_name: validRole.display_name
        }
      });
    }

    // Kiểm tra lời mời trùng
    const existingInv = findPendingInvitation(cleanEmail, projectId);
    if (existingInv) {
      return res.status(409).json({
        success: false,
        message: 'Lời mời cho email này đã tồn tại và đang chờ phản hồi.'
      });
    }

    if (pool && db.isConnected !== false) {
      try {
        const [invRows] = await pool.query(
          "SELECT * FROM project_invitations WHERE project_id = ? AND email = ? AND status = 'pending'",
          [projectId, cleanEmail]
        );
        if (invRows.length > 0) {
          return res.status(409).json({
            success: false,
            message: 'Lời mời cho email này đã tồn tại và đang chờ phản hồi.'
          });
        }
      } catch (e) {}
    }

    const currentUserId = req.user ? (req.user.id || req.user.userId) : null;
    const inv = createProjectInvitation({
      projectId,
      email: cleanEmail,
      roleId: resolvedRoleId,
      invitedBy: currentUserId
    });

    createUser({
      email: cleanEmail,
      full_name: cleanEmail.split('@')[0],
      role_id: resolvedRoleId,
      must_set_password: true
    });

    if (pool && db.isConnected !== false) {
      try {
        await pool.query(
          'INSERT INTO project_invitations (project_id, email, role_id, invited_by, status) VALUES (?, ?, ?, ?, ?)',
          [projectId, cleanEmail, resolvedRoleId, currentUserId, 'pending']
        );
        await pool.query(
          'INSERT IGNORE INTO users (email, password_hash, salt, full_name, role_id, must_set_password) VALUES (?, ?, ?, ?, ?, TRUE)',
          [cleanEmail, '', '', cleanEmail.split('@')[0], resolvedRoleId]
        );
      } catch (dbErr) {}
    }

    return res.status(201).json({
      success: true,
      message: `Đã tạo lời mời cho email "${cleanEmail}" với vai trò "${validRole.display_name}". Người dùng có thể đặt mật khẩu ở lần đăng nhập đầu tiên.`,
      data: {
        invitation_id: inv.id,
        project_id: projectId,
        email: cleanEmail,
        role_id: resolvedRoleId,
        role_name: validRole.name,
        role_display_name: validRole.display_name,
        status: 'pending'
      }
    });
  };

  router.post('/projects/:id/invitations', inviteHandler);
  router.post('/projects/:id/invite', inviteHandler);

  // 9. Lấy danh sách lời mời đang chờ của dự án
  router.get('/projects/:id/invitations', async (req, res) => {
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'Mã dự án không hợp lệ' });
    }

    if (checkProjectManagerAccess(req, res, projectId)) return;

    if (db && db.isConnected === false) {
      const proj = inMemoryProjects.find(p => p.id === projectId);
      if (!proj) {
        return res.status(404).json({ success: false, message: 'Dự án không tồn tại' });
      }
      return res.json({ success: true, data: getProjectInvitations(projectId) });
    }

    try {
      const [projRows] = await pool.query('SELECT id FROM projects WHERE id = ?', [projectId]);
      if (projRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Dự án không tồn tại' });
      }

      const [rows] = await pool.query(`
        SELECT pi.id, pi.project_id, pi.email, pi.role_id, pi.status, pi.created_at,
               r.name AS role_name, r.display_name AS role_display_name
        FROM project_invitations pi
        LEFT JOIN roles r ON pi.role_id = r.id
        WHERE pi.project_id = ? AND pi.status = 'pending'
        ORDER BY pi.created_at DESC
      `, [projectId]);
      res.json({ success: true, data: rows });
    } catch (err) {
      res.json({ success: true, data: getProjectInvitations(projectId) });
    }
  });

  // 10. Đổi vai trò thành viên trong dự án
  router.put('/projects/:id/members/:userId', async (req, res) => {
    const projectId = Number(req.params.id);
    const targetUserId = Number(req.params.userId);
    if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(targetUserId) || targetUserId <= 0) {
      return res.status(400).json({ success: false, message: 'Thông số không hợp lệ' });
    }

    if (checkProjectManagerAccess(req, res, projectId)) return;

    const { role_id, roleId, role } = req.body || {};
    let resolvedRoleId = Number(role_id || roleId);
    if (!resolvedRoleId && role) {
      const r = SEED_ROLES.find(x => x.name.toLowerCase() === String(role).toLowerCase() || x.display_name.toLowerCase() === String(role).toLowerCase());
      if (r) resolvedRoleId = r.id;
    }

    if (resolvedRoleId === 1 || String(role).toLowerCase() === 'admin') {
      return res.status(400).json({
        success: false,
        message: 'Vai trò không hợp lệ trong dự án. Không thể gán quyền quản trị viên hệ thống.'
      });
    }

    const validRole = SEED_ROLES.find(r => r.id === resolvedRoleId);
    if (!validRole || resolvedRoleId < 2 || resolvedRoleId > 7) {
      return res.status(400).json({
        success: false,
        message: 'Vai trò dự án không hợp lệ.'
      });
    }

    // Kiểm tra thành viên tồn tại
    const existingMember = findProjectMember(projectId, targetUserId);
    if (!existingMember && (!pool || db.isConnected === false)) {
      return res.status(404).json({ success: false, message: 'Thành viên không tồn tại trong dự án.' });
    }

    // NFR: Không được hạ quyền ban quản lý cuối cùng
    if (existingMember && (existingMember.role_id === 2 || existingMember.role_name === 'project_manager') && resolvedRoleId !== 2) {
      const managerCount = countProjectManagers(projectId);
      if (managerCount <= 1) {
        return res.status(400).json({
          success: false,
          message: 'Không thể thay đổi vai trò của ban quản lý cuối cùng của dự án.'
        });
      }
    }

    if (pool && db.isConnected !== false) {
      try {
        const [mRows] = await pool.query(
          'SELECT * FROM project_members WHERE project_id = ? AND user_id = ?',
          [projectId, targetUserId]
        );
        if (mRows.length === 0) {
          return res.status(404).json({ success: false, message: 'Thành viên không tồn tại trong dự án.' });
        }
        if (mRows[0].role_id === 2 && resolvedRoleId !== 2) {
          const [managers] = await pool.query(
            'SELECT user_id FROM project_members WHERE project_id = ? AND role_id = 2',
            [projectId]
          );
          if (managers.length <= 1) {
            return res.status(400).json({
              success: false,
              message: 'Không thể thay đổi vai trò của ban quản lý cuối cùng của dự án.'
            });
          }
        }
        await pool.query(
          'UPDATE project_members SET role_id = ? WHERE project_id = ? AND user_id = ?',
          [resolvedRoleId, projectId, targetUserId]
        );
      } catch (err) {
        return res.status(500).json({ success: false, message: 'Lỗi khi cập nhật vai trò thành viên.' });
      }
    }

    updateProjectMemberRole({ projectId, userId: targetUserId, roleId: resolvedRoleId });
    res.json({
      success: true,
      message: `Cập nhật vai trò thành viên thành "${validRole.display_name}" thành công.`
    });
  });

  // 11. Gỡ thành viên khỏi dự án (S-28 / AC 3 & NFR)
  router.delete('/projects/:id/members/:userId', async (req, res) => {
    const projectId = Number(req.params.id);
    const targetUserId = Number(req.params.userId);
    if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(targetUserId) || targetUserId <= 0) {
      return res.status(400).json({ success: false, message: 'Thông số không hợp lệ' });
    }

    if (checkProjectManagerAccess(req, res, projectId)) return;

    const currentUserId = req.user ? (req.user.id || req.user.userId) : null;
    const isSelfRemoval = Boolean(currentUserId && currentUserId === targetUserId);

    // Kiểm tra trong in-memory trước
    const existingMember = findProjectMember(projectId, targetUserId);

    // NFR: Không được tự gỡ chính mình nếu là ban quản lý cuối cùng của dự án (và không thể gỡ ban quản lý cuối cùng)
    const isTargetManager = existingMember && (existingMember.role_id === 2 || existingMember.role_name === 'project_manager');
    if (isTargetManager) {
      const managerCount = countProjectManagers(projectId);
      if (managerCount <= 1) {
        return res.status(400).json({
          success: false,
          message: isSelfRemoval
            ? 'Không thể tự gỡ chính mình khi bạn là ban quản lý cuối cùng của dự án.'
            : 'Không thể gỡ ban quản lý cuối cùng của dự án.'
        });
      }
    }

    if (pool && db.isConnected !== false && pool.getConnection) {
      let connection = null;
      try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Kiểm tra dự án tồn tại
        const [projRows] = await connection.query('SELECT id FROM projects WHERE id = ?', [projectId]);
        if (projRows.length === 0) {
          await connection.rollback();
          return res.status(404).json({ success: false, message: 'Dự án không tồn tại.' });
        }

        // Kiểm tra thành viên tồn tại và khóa dòng để chống race condition
        const [mRows] = await connection.query(
          'SELECT * FROM project_members WHERE project_id = ? AND user_id = ? FOR UPDATE',
          [projectId, targetUserId]
        );
        if (mRows.length === 0) {
          await connection.rollback();
          return res.status(404).json({ success: false, message: 'Thành viên không tồn tại trong dự án.' });
        }

        const dbMember = mRows[0];
        if (dbMember.role_id === 2) {
          const [managers] = await connection.query(
            'SELECT user_id FROM project_members WHERE project_id = ? AND role_id = 2 FOR UPDATE',
            [projectId]
          );
          if (managers.length <= 1) {
            await connection.rollback();
            return res.status(400).json({
              success: false,
              message: isSelfRemoval
                ? 'Không thể tự gỡ chính mình khi bạn là ban quản lý cuối cùng của dự án.'
                : 'Không thể gỡ ban quản lý cuối cùng của dự án.'
            });
          }
        }

        // Thu hồi quyền: Xóa khỏi project_members (KHÔNG xóa users, KHÔNG xóa nhật ký thao tác hay công việc cũ)
        await connection.query(
          'DELETE FROM project_members WHERE project_id = ? AND user_id = ?',
          [projectId, targetUserId]
        );

        await connection.commit();
      } catch (err) {
        if (connection) await connection.rollback();
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi gỡ thành viên khỏi dự án.' });
      } finally {
        if (connection) connection.release();
      }
    } else {
      if (!existingMember) {
        return res.status(404).json({ success: false, message: 'Thành viên không tồn tại trong dự án.' });
      }
    }

    // Cập nhật bộ nhớ in-memory ngay lập tức để có hiệu lực ở request kế tiếp
    removeProjectMember({ projectId, userId: targetUserId });

    return res.json({
      success: true,
      message: 'Đã gỡ thành viên khỏi dự án thành công. Lịch sử thao tác cũ của thành viên vẫn được bảo lưu.'
    });
  });

  return router;
};
