const express = require('express');
const BudgetVarianceService = require('../services/budgetVarianceService');
const { checkViewerForbidden, checkProjectReadAccess } = require('../utils/rbac');

module.exports = (db) => {
  const router = express.Router();
  const service = new BudgetVarianceService(db);

  // 1. T-113 & T-114 (S-48): Lấy báo cáo so sánh dự toán, thực chi và cảnh báo theo cây WBS
  router.get('/projects/:projectId/budget-variance', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const report = await service.getProjectBudgetVarianceReport(projectId);
      res.json({
        success: true,
        project_id: projectId,
        ...report
      });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // 2. Lấy danh sách phẳng kèm tính toán và đánh dấu cảnh báo
  router.get('/projects/:projectId/budget-variance/flat', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const report = await service.getProjectBudgetVarianceReport(projectId);
      res.json({
        success: true,
        project_id: projectId,
        items: report.flatList,
        summary: report.summary
      });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // 3. S-46 (SCRUM-222): Nhập / Cập nhật dự toán cho hạng mục lá
  router.put('/work-items/:itemId/budget', async (req, res) => {
    const itemId = Number(req.params.itemId);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return res.status(400).json({ success: false, message: 'ID hạng mục không hợp lệ.' });
    }
    if (checkViewerForbidden(req, res)) return;

    try {
      const updated = await service.updateLeafBudget(itemId, req.body || {});
      res.json({
        success: true,
        message: 'Cập nhật dự toán hạng mục thành công.',
        data: updated
      });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // 4. S-47: Nhập / Ghi nhận chi phí thực tế (thực chi) và khối lượng thu được cho hạng mục lá
  router.put('/work-items/:itemId/actual-expense', async (req, res) => {
    const itemId = Number(req.params.itemId);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return res.status(400).json({ success: false, message: 'ID hạng mục không hợp lệ.' });
    }
    if (checkViewerForbidden(req, res)) return;

    try {
      const updated = await service.updateLeafActualExpense(itemId, req.body || {});
      res.json({
        success: true,
        message: 'Cập nhật thực chi và khối lượng thu được thành công.',
        data: updated
      });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // 5. S-48 AC 3 & T-114 AC 2: Nạp bộ dữ liệu mẫu cho tính toán phản hồi
  router.post('/projects/:projectId/budget-variance/seed-sample', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;
    if (checkViewerForbidden(req, res)) return;

    try {
      const result = await service.seedS48SampleData(projectId);
      res.json({
        success: true,
        message: 'Đã nạp thành công bộ dữ liệu mẫu S-48 cho tính toán phản hồi.',
        ...result
      });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  return router;
};
