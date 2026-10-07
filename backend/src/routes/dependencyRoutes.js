/**
 * Dependency Routes (S-06 / SCRUM-61)
 * Định tuyến các API CRUD quan hệ phụ thuộc công việc với phân quyền RBAC
 */

const express = require('express');
const { DependencyRepository } = require('../repositories/dependencyRepository');
const { DependencyService } = require('../services/dependencyService');
const { checkViewerForbidden, checkProjectReadAccess } = require('../utils/rbac');

module.exports = (db) => {
  const router = express.Router();
  const repo = new DependencyRepository(db);
  const service = new DependencyService(repo, db);

  // 1. Lấy danh sách quan hệ phụ thuộc theo dự án
  // Quyền: Admin, Project Manager và Viewer (được gán dự án)
  router.get('/projects/:projectId/dependencies', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (checkProjectReadAccess(req, res, projectId)) return;

    const result = await service.getDependenciesByProject(projectId);
    res.status(result.status).json(result);
  });

  // 2. Tạo quan hệ phụ thuộc mới (T-13, T-14)
  // Quyền: Admin và Project Manager (Viewer bị chặn HTTP 403)
  router.post('/projects/:projectId/dependencies', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (checkViewerForbidden(req, res)) return;
    if (checkProjectReadAccess(req, res, projectId)) return;

    const result = await service.createDependency(projectId, req.body);
    res.status(result.status).json(result);
  });

  // 3. Lấy chi tiết quan hệ phụ thuộc theo ID
  router.get('/dependencies/:id', async (req, res) => {
    const id = Number(req.params.id);
    const detail = await service.getDependencyById(id);
    if (!detail.success) {
      return res.status(detail.status).json(detail);
    }

    if (checkProjectReadAccess(req, res, detail.data.project_id)) return;
    res.status(detail.status).json(detail);
  });

  // 4. Cập nhật quan hệ phụ thuộc (T-14)
  // Quyền: Admin và Project Manager (Viewer bị chặn HTTP 403)
  router.put('/dependencies/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (checkViewerForbidden(req, res)) return;

    const existing = await repo.findById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy quan hệ phụ thuộc' });
    }

    if (checkProjectReadAccess(req, res, existing.project_id)) return;

    const result = await service.updateDependency(id, req.body);
    res.status(result.status).json(result);
  });

  // 5. Xóa quan hệ phụ thuộc
  // Quyền: Admin và Project Manager (Viewer bị chặn HTTP 403)
  router.delete('/dependencies/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (checkViewerForbidden(req, res)) return;

    const existing = await repo.findById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy quan hệ phụ thuộc để xóa' });
    }

    if (checkProjectReadAccess(req, res, existing.project_id)) return;

    const result = await service.deleteDependency(id);
    res.status(result.status).json(result);
  });

  return router;
};
