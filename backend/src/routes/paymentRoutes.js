const express = require('express');
const PaymentService = require('../services/paymentService');
const { checkViewerForbidden, checkProjectReadAccess } = require('../utils/rbac');

module.exports = (db) => {
  const router = express.Router();
  const paymentService = new PaymentService(db);

  // 1. AC 1 (S-45): Lấy tỉ lệ tạm giữ hợp đồng (%) của dự án
  router.get('/projects/:projectId/retention-rate', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const rate = await paymentService.getProjectRetentionRate(projectId);
      res.json({
        success: true,
        project_id: projectId,
        retention_rate: Number(Number(rate).toFixed(2))
      });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // 2. AC 1 (S-45): Cập nhật tỉ lệ tạm giữ hợp đồng (%) cho dự án (Kế toán / Chỉ huy trưởng / Admin)
  router.put('/projects/:projectId/retention-rate', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;
    if (checkViewerForbidden(req, res)) return;

    const roleStr = String(req.user?.role_name || req.user?.role || '').toLowerCase();
    const canConfig = req.user?.role_id === 1 || req.user?.role_id === 2 || req.user?.role_id === 5 ||
                      roleStr.includes('admin') || roleStr.includes('project_manager') || roleStr.includes('accountant');
    if (req.user && !canConfig) {
      return res.status(403).json({
        success: false,
        message: 'Quyền truy cập bị từ chối: Chỉ Ban quản lý, Kế toán hoặc Chỉ huy trưởng mới được cấu hình tỉ lệ tạm giữ hợp đồng.'
      });
    }

    try {
      const { retention_rate } = req.body;
      const result = await paymentService.updateProjectRetentionRate(projectId, retention_rate);
      res.json(result);
    } catch (err) {
      res.status(err.status || 400).json({ success: false, message: err.message });
    }
  });

  // 3. S-43 & S-45: Lấy dữ liệu điền sẵn cho đề nghị thanh toán từ phiếu nghiệm thu đã duyệt (cũ)
  router.get('/projects/:projectId/payment-requests/prefill', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const prefill = await paymentService.getPrefillData(projectId);
      res.json({ success: true, data: prefill });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // S-43 / T-97: Lấy danh sách phiếu NT đã duyệt CHƯA đưa vào đề nghị (kèm hạng mục + đơn giá)
  router.get('/projects/:projectId/payment-requests/available-sheets', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const periodNumber = (req.query.period_number !== undefined && req.query.period_number !== null && req.query.period_number !== '')
        ? Number(req.query.period_number)
        : null;
      const sheets = await paymentService.getApprovedSheetsAvailable(projectId, periodNumber);
      res.json({
        success: true,
        project_id: projectId,
        count: sheets.length,
        data: sheets
      });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // S-43 / T-97+T-98: Lấy dữ liệu điền sẵn preview đề nghị từ phiếu NT đã duyệt chưa liên kết
  router.get('/projects/:projectId/payment-requests/s43-prefill', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const periodNumber = (req.query.period_number !== undefined && req.query.period_number !== null && req.query.period_number !== '')
        ? Number(req.query.period_number)
        : null;
      const prefill = await paymentService.getS43PrefillData(projectId, periodNumber);
      res.json({ success: true, data: prefill });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });



  // 4. AC 5 (S-45): Lấy danh sách đề nghị thanh toán kèm tổng tạm giữ luỹ kế
  router.get('/projects/:projectId/payment-requests', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const data = await paymentService.getPaymentRequests(projectId);
      res.json({
        success: true,
        project_id: projectId,
        data: data.requests,
        summary: data.summary
      });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // 5. Lấy chi tiết đề nghị thanh toán
  router.get('/projects/:projectId/payment-requests/:id', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const requestId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(requestId) || requestId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId hoặc requestId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const item = await paymentService.getPaymentRequestById(projectId, requestId);
      if (!item) {
        return res.status(404).json({ success: false, message: 'Không tìm thấy đề nghị thanh toán.' });
      }
      res.json({ success: true, data: item });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // 6. AC 2, 3, 4 (S-45): Lập đề nghị thanh toán và trừ đúng phần tạm giữ hợp đồng (thủ công)
  router.post('/projects/:projectId/payment-requests', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;
    if (checkViewerForbidden(req, res)) return;

    try {
      const userId = req.user?.id || req.user?.userId || 1;
      const result = await paymentService.createPaymentRequest(projectId, req.body, userId);
      res.status(201).json(result);
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message, details: err.details });
    }
  });

  // S-43 / T-98+T-99: Tự sinh đề nghị thanh toán từ phiếu NT đã duyệt chưa liên kết
  // (khoá liên kết nguyên tử tại tầng lưu trữ — một phiếu chỉ vào được một đề nghị)
  router.post('/projects/:projectId/payment-requests/from-acceptance-sheets', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;
    if (checkViewerForbidden(req, res)) return;

    try {
      const userId = req.user?.id || req.user?.userId || 1;
      const result = await paymentService.createFromAcceptanceSheets(projectId, req.body, userId);
      res.status(201).json(result);
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message, details: err.details });
    }
  });

  // 7. Phê duyệt đề nghị thanh toán (Chỉ huy trưởng / Chủ đầu tư / Admin)
  router.post('/projects/:projectId/payment-requests/:id/approve', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const requestId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(requestId) || requestId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId hoặc requestId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;
    if (checkViewerForbidden(req, res)) return;

    const roleStr = String(req.user?.role_name || req.user?.role || '').toLowerCase();
    const canApprove = req.user?.role_id === 1 || req.user?.role_id === 2 || req.user?.role_id === 6 ||
                       roleStr.includes('admin') || roleStr.includes('project_manager') || roleStr.includes('client');
    if (req.user && !canApprove) {
      return res.status(403).json({
        success: false,
        message: 'Quyền truy cập bị từ chối: Chỉ Ban quản lý, Chỉ huy trưởng hoặc Chủ đầu tư mới được duyệt đề nghị thanh toán.'
      });
    }

    try {
      const userId = req.user?.id || req.user?.userId || 1;
      const result = await paymentService.approvePaymentRequest(projectId, requestId, userId);
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  return router;
};
