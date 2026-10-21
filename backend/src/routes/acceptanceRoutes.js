const express = require('express');
const AcceptanceService = require('../services/acceptanceService');
const { checkViewerForbidden, checkProjectReadAccess, checkProjectManagerAccess } = require('../utils/rbac');

module.exports = (db) => {
  const router = express.Router();
  const acceptanceService = new AcceptanceService(db);

  // 1. T-70 (SCRUM-179): Lấy dữ liệu điền sẵn cho phiếu mới (luỹ kế đợt trước & số đội báo S-26)
  router.get('/projects/:projectId/acceptance-sheets/prefill', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const { to_date, from_date } = req.query;
      const prefill = await acceptanceService.getPrefillData(projectId, to_date, from_date);
      res.json({ success: true, data: prefill });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // 2. T-71 (SCRUM-180): Lấy danh sách phiếu nghiệm thu của dự án
  router.get('/projects/:projectId/acceptance-sheets', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const sheets = await acceptanceService.getAcceptanceSheets(projectId);
      res.json({ success: true, data: sheets });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // 3. T-71 (SCRUM-180): Lấy chi tiết phiếu nghiệm thu
  router.get('/projects/:projectId/acceptance-sheets/:id', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const sheetId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(sheetId) || sheetId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId hoặc sheetId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const sheet = await acceptanceService.getAcceptanceSheetById(projectId, sheetId);
      if (!sheet) {
        return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu nghiệm thu.' });
      }
      res.json({ success: true, data: sheet });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // 4. T-71 (SCRUM-180): Lập phiếu nghiệm thu theo đợt & tự tính khối lượng đợt
  router.post('/projects/:projectId/acceptance-sheets', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;
    if (checkViewerForbidden(req, res)) return;

    try {
      const userId = req.user?.id || req.user?.userId || 1;
      const result = await acceptanceService.createAcceptanceSheet(projectId, req.body, userId);
      res.status(201).json(result);
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // 5. Phê duyệt phiếu nghiệm thu (Chỉ huy trưởng / Ban QLDA)
  router.post('/projects/:projectId/acceptance-sheets/:id/approve', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const sheetId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(sheetId) || sheetId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId hoặc sheetId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;
    if (checkViewerForbidden(req, res)) return;

    // Chỉ Admin hoặc Chỉ huy trưởng/Ban QLDA được duyệt
    const roleStr = String(req.user?.role_name || req.user?.role || '').toLowerCase();
    const isManagerOrAdmin = req.user?.role_id === 1 || req.user?.role_id === 2 || req.user?.role_id === 3 ||
                             roleStr.includes('admin') || roleStr.includes('project_manager') || roleStr.includes('site_manager');
    if (req.user && !isManagerOrAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Quyền truy cập bị từ chối: Chỉ Ban quản trị hoặc Chỉ huy trưởng mới được phép phê duyệt phiếu nghiệm thu.'
      });
    }

    try {
      const userId = req.user?.id || req.user?.userId || 1;
      const result = await acceptanceService.approveAcceptanceSheet(projectId, sheetId, userId);
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // 5b. S-38 (SCRUM-167 / AC 2): Ban quản lý trả lại phiếu nghiệm thu kèm lý do
  router.post('/projects/:projectId/acceptance-sheets/:id/reject', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const sheetId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(sheetId) || sheetId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId hoặc sheetId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;
    if (checkViewerForbidden(req, res)) return;

    // Chỉ Admin hoặc Chỉ huy trưởng/Ban QLDA được trả lại phiếu
    const roleStr = String(req.user?.role_name || req.user?.role || '').toLowerCase();
    const isManagerOrAdmin = req.user?.role_id === 1 || req.user?.role_id === 2 || req.user?.role_id === 3 ||
                             roleStr.includes('admin') || roleStr.includes('project_manager') || roleStr.includes('site_manager');
    if (req.user && !isManagerOrAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Quyền truy cập bị từ chối: Chỉ Ban quản trị hoặc Chỉ huy trưởng mới được phép trả lại phiếu nghiệm thu.'
      });
    }

    try {
      const userId = req.user?.id || req.user?.userId || 1;
      const { reason } = req.body || {};
      const result = await acceptanceService.rejectAcceptanceSheet(projectId, sheetId, userId, reason);
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // 5c. S-38 (SCRUM-167 / AC 2 & AC 3): Cập nhật/sửa phiếu nghiệm thu (Chặn sửa phiếu đã duyệt)
  router.put('/projects/:projectId/acceptance-sheets/:id', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const sheetId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(sheetId) || sheetId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId hoặc sheetId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;
    if (checkViewerForbidden(req, res)) return;

    try {
      const userId = req.user?.id || req.user?.userId || 1;
      const result = await acceptanceService.updateAcceptanceSheet(projectId, sheetId, req.body, userId);
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // 6. Đính kèm ảnh hiện trường vào phiếu nghiệm thu (AC 4)
  router.post('/projects/:projectId/acceptance-sheets/:id/photos', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const sheetId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(sheetId) || sheetId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId hoặc sheetId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;
    if (checkViewerForbidden(req, res)) return;

    try {
      // Hỗ trợ truyền mảng photos dạng json hoặc files
      const photos = Array.isArray(req.body?.photos) ? req.body.photos : (req.body?.file_name ? [req.body] : (req.files || []));
      const result = await acceptanceService.addPhotos(projectId, sheetId, photos);
      res.status(201).json(result);
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // 7. Xóa phiếu nghiệm thu (Chỉ khi là bản nháp draft)
  router.delete('/projects/:projectId/acceptance-sheets/:id', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const sheetId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(sheetId) || sheetId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId hoặc sheetId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;
    if (checkViewerForbidden(req, res)) return;

    try {
      const result = await acceptanceService.deleteAcceptanceSheet(projectId, sheetId);
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  return router;
};
