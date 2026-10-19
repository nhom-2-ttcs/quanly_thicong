const express = require('express');
const { SheetAuditService } = require('../services/sheetAuditService');
const { checkProjectReadAccess } = require('../utils/rbac');

module.exports = (db) => {
  const router = express.Router();
  const auditService = new SheetAuditService(db);

  // 1. Chặn tuyệt đối mọi thao tác sửa hoặc xóa (AC: Tính chất Append-Only)
  // Trả về HTTP 405 Method Not Allowed
  const rejectImmutableMethods = (req, res, next) => {
    if (['PUT', 'DELETE', 'PATCH'].includes(req.method.toUpperCase())) {
      return res.status(405).json({
        success: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Nhật ký thao tác là dữ liệu chỉ ghi thêm (append-only), không được phép chỉnh sửa hoặc xóa.'
      });
    }
    next();
  };

  router.use('/projects/:projectId/sheet-audit-logs', rejectImmutableMethods);

  // 2. Tra cứu danh sách nhật ký thao tác trên phiếu (Chủ đầu tư, QLDA, Chỉ huy trưởng, TVGS...)
  router.get('/projects/:projectId/sheet-audit-logs', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const {
        entity_type,
        entityType,
        entity_id,
        entityId,
        action,
        from_date,
        fromDate,
        to_date,
        toDate,
        search,
        limit,
        offset
      } = req.query;

      const filters = {
        entityType: entity_type || entityType,
        entityId: entity_id || entityId,
        action,
        fromDate: from_date || fromDate,
        toDate: to_date || toDate,
        search,
        limit: limit ? Number(limit) : 50,
        offset: offset ? Number(offset) : 0
      };

      const result = await auditService.getLogs(projectId, filters);
      return res.json({
        success: true,
        ...result
      });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // 3. Xem chi tiết 1 bản ghi nhật ký thao tác (bao gồm giá trị trước/sau đầy đủ)
  router.get('/projects/:projectId/sheet-audit-logs/:id', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const logId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(logId) || logId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId hoặc logId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const log = await auditService.getLogById(projectId, logId);
      if (!log) {
        return res.status(404).json({ success: false, message: 'Không tìm thấy bản ghi nhật ký thao tác.' });
      }
      return res.json({
        success: true,
        data: log
      });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // 4. Bắt cụ thể các method sửa/xóa trên route con nếu có
  router.all('/projects/:projectId/sheet-audit-logs/:id', (req, res) => {
    if (['PUT', 'DELETE', 'PATCH', 'POST'].includes(req.method.toUpperCase())) {
      return res.status(405).json({
        success: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Nhật ký thao tác là dữ liệu chỉ ghi thêm (append-only), không được phép chỉnh sửa hoặc xóa.'
      });
    }
    return res.status(405).json({ success: false, message: 'Phương thức không được hỗ trợ.' });
  });

  return router;
};
