const express = require('express');
const { checkViewerForbidden, checkProjectReadAccess } = require('../utils/rbac');
const { DiaryService } = require('../services/diaryService');

module.exports = (db) => {
  const router = express.Router();
  const diaryService = new DiaryService(db);

  // 1. Xem đối chiếu tuần làm việc và thống kê ngày mưa (T51)
  // Lưu ý: Đặt route /week-comparison trước route /:date để tránh trùng khớp tham số
  router.get('/projects/:projectId/diaries/week-comparison', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ' });
    }

    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const targetDate = req.query.date || req.query.target_date || new Date().toISOString().split('T')[0];
      const result = await diaryService.getWeeklyComparison(projectId, targetDate);
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Lỗi khi lấy dữ liệu đối chiếu tuần'
      });
    }
  });

  // 2. Lấy danh sách nhật ký theo dự án (hỗ trợ lọc ngày, khoảng ngày, ngày mưa)
  router.get('/projects/:projectId/diaries', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ' });
    }

    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const { date, start_date, end_date, is_rain_day } = req.query;
      const isRain = is_rain_day !== undefined ? (is_rain_day === 'true' || is_rain_day === '1') : undefined;

      const data = await diaryService.getDiaries(projectId, {
        date,
        start_date,
        end_date,
        is_rain_day: isRain
      });

      res.json({ success: true, data });
    } catch (err) {
      res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Lỗi khi truy vấn danh sách nhật ký'
      });
    }
  });

  // 3. Lấy chi tiết nhật ký của một ngày cụ thể
  router.get('/projects/:projectId/diaries/:date', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const dateStr = req.params.date;

    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ' });
    }

    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const data = await diaryService.getDiaryByDate(projectId, dateStr);
      if (!data) {
        return res.status(404).json({
          success: false,
          message: `Chưa có dữ liệu nhật ký cho ngày ${dateStr}`,
          data: null
        });
      }
      res.json({ success: true, data });
    } catch (err) {
      res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Lỗi khi lấy chi tiết nhật ký ngày'
      });
    }
  });

const { handleMultipartUpload } = require('../middlewares/multipartUpload');

  // 4. Lưu / Cập nhật nhật ký ngày (Form T51 & T52 - hỗ trợ gửi công việc và ảnh đính kèm)
  router.post('/projects/:projectId/diaries', handleMultipartUpload, async (req, res) => {
    const projectId = Number(req.params.projectId || req.body.project_id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ' });
    }

    // RBAC: Chặn Viewer sửa/lưu dữ liệu
    if (checkViewerForbidden(req, res)) return;

    try {
      const userId = req.user?.userId || req.user?.id || 1;
      const files = req.files || [];
      const saved = await diaryService.saveDiary(projectId, req.body, userId, files);
      res.status(200).json({
        success: true,
        message: 'Lưu thông tin nhật ký thi công và ảnh đính kèm thành công',
        data: saved
      });
    } catch (err) {
      const statusCode = err.status || 500;
      res.status(statusCode).json({
        success: false,
        message: err.message || 'Không thể lưu nhật ký công trường'
      });
    }
  });

  // 5. Đính kèm thêm ảnh vào nhật ký ngày đã có (T52)
  router.post('/projects/:projectId/diaries/:date/photos', handleMultipartUpload, async (req, res) => {
    const projectId = Number(req.params.projectId);
    const dateStr = req.params.date;

    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ' });
    }

    if (checkViewerForbidden(req, res)) return;

    try {
      const userId = req.user?.userId || req.user?.id || 1;
      const files = req.files || [];
      const updated = await diaryService.addPhotos(projectId, dateStr, files, userId);
      res.status(200).json({
        success: true,
        message: 'Tải ảnh đính kèm lên nhật ký thành công',
        data: updated
      });
    } catch (err) {
      const statusCode = err.status || 500;
      res.status(statusCode).json({
        success: false,
        message: err.message || 'Không thể tải ảnh đính kèm lên'
      });
    }
  });

  // 6. Xóa ảnh đính kèm khỏi nhật ký (T52)
  router.delete('/projects/:projectId/diaries/photos/:photoId', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const photoId = Number(req.params.photoId);

    if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(photoId) || photoId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId hoặc photoId không hợp lệ' });
    }

    if (checkViewerForbidden(req, res)) return;

    try {
      await diaryService.deletePhoto(projectId, photoId);
      res.json({
        success: true,
        message: 'Đã xóa ảnh đính kèm thành công'
      });
    } catch (err) {
      const statusCode = err.status || 500;
      res.status(statusCode).json({
        success: false,
        message: err.message || 'Không thể xóa ảnh đính kèm'
      });
    }
  });

  // 7. S-33 / SCRUM-158 / T-60: Đăng ký danh sách ảnh vào hàng đợi nền
  router.post('/projects/:projectId/diaries/:date/photo-queue/register', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const dateStr = req.params.date;

    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ' });
    }

    if (checkViewerForbidden(req, res)) return;

    try {
      const userId = req.user?.userId || req.user?.id || 1;
      const pendingPhotos = req.body?.pending_photos || req.body?.photos || [];
      const updated = await diaryService.registerPendingPhotos(projectId, dateStr, pendingPhotos, userId);
      res.status(200).json({
        success: true,
        message: 'Đăng ký danh sách ảnh vào hàng đợi nền thành công',
        data: updated
      });
    } catch (err) {
      const statusCode = err.status || 500;
      res.status(statusCode).json({
        success: false,
        message: err.message || 'Không thể đăng ký hàng đợi ảnh'
      });
    }
  });

  // 8. S-33 / SCRUM-159 & SCRUM-160 / T-61 & T-62: Tải lên từng ảnh nền trong hàng đợi
  router.post('/projects/:projectId/diaries/:date/photos/upload-single', handleMultipartUpload, async (req, res) => {
    const projectId = Number(req.params.projectId);
    const dateStr = req.params.date;

    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ' });
    }

    if (checkViewerForbidden(req, res)) return;

    try {
      const userId = req.user?.userId || req.user?.id || 1;
      const file = (req.files && req.files.length > 0) ? req.files[0] : null;
      if (!file) {
        return res.status(400).json({ success: false, message: 'Vui lòng đính kèm tệp ảnh cần tải lên' });
      }

      const clientPhotoId = req.body.client_photo_id || req.body.id || null;
      const caption = req.body.caption || '';

      const result = await diaryService.uploadSinglePhoto(projectId, dateStr, file, {
        client_photo_id: clientPhotoId,
        caption,
        userId
      });

      res.status(200).json(result);
    } catch (err) {
      const statusCode = err.status || 500;
      res.status(statusCode).json({
        success: false,
        message: err.message || 'Lỗi khi tải ảnh nền lên máy chủ'
      });
    }
  });

  return router;
};
