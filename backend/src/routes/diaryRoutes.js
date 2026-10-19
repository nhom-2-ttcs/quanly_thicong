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

  // ========================================================
  // S-21 / SCRUM-113: CÁC ROUTE GHI VÀ LỌC MỤC NHẬT KÝ HẰNG NGÀY GẮN HẠNG MỤC
  // ========================================================

  // 9. Lấy danh sách mục nhật ký theo dự án (hỗ trợ lọc theo ngày, theo hạng mục work_item_id) (AC 2)
  router.get('/projects/:projectId/diary-items', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ' });
    }

    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const { date, work_item_id, start_date, end_date } = req.query;
      const items = await diaryService.getDiaryItems(projectId, {
        date,
        work_item_id: (work_item_id !== undefined && work_item_id !== '') ? Number(work_item_id) : undefined,
        start_date,
        end_date
      });
      res.json({ success: true, data: items });
    } catch (err) {
      res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Lỗi khi lấy danh sách mục nhật ký'
      });
    }
  });

  // 10. Kỹ sư giám sát ghi thêm một mục nhật ký gắn hạng mục thi công (AC 1 & AC 3)
  router.post('/projects/:projectId/diary-items', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ' });
    }

    if (checkViewerForbidden(req, res)) return;

    try {
      const userId = req.user?.userId || req.user?.id || 1;
      const dateStr = req.body.diary_date || req.body.date || new Date().toISOString().split('T')[0];
      const result = await diaryService.addDiaryItem(projectId, dateStr, req.body, userId);
      res.status(201).json({
        success: true,
        message: 'Ghi mục nhật ký thành công',
        data: result.item,
        dayItems: result.dayItems
      });
    } catch (err) {
      const statusCode = err.status || 500;
      res.status(statusCode).json({
        success: false,
        message: err.message || 'Không thể lưu mục nhật ký'
      });
    }
  });

  // 11. Cập nhật nội dung mục nhật ký
  router.put('/projects/:projectId/diary-items/:itemId', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const itemId = Number(req.params.itemId);

    if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(itemId) || itemId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId hoặc itemId không hợp lệ' });
    }

    if (checkViewerForbidden(req, res)) return;

    try {
      const updated = await diaryService.updateDiaryItem(projectId, itemId, req.body);
      res.json({
        success: true,
        message: 'Cập nhật mục nhật ký thành công',
        data: updated
      });
    } catch (err) {
      const statusCode = err.status || 500;
      res.status(statusCode).json({
        success: false,
        message: err.message || 'Không thể cập nhật mục nhật ký'
      });
    }
  });

  // 12. Xóa mục nhật ký
  router.delete('/projects/:projectId/diary-items/:itemId', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const itemId = Number(req.params.itemId);

    if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(itemId) || itemId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId hoặc itemId không hợp lệ' });
    }

    if (checkViewerForbidden(req, res)) return;

    try {
      await diaryService.deleteDiaryItem(projectId, itemId);
      res.json({
        success: true,
        message: 'Đã xóa mục nhật ký thành công'
      });
    } catch (err) {
      const statusCode = err.status || 500;
      res.status(statusCode).json({
        success: false,
        message: err.message || 'Không thể xóa mục nhật ký'
      });
    }
  });

  // ==============================================================
  // S-32: PHÁT HIỆN XUNG ĐỘT NGOẠI TUYẾN & GIẢI QUYẾT XUNG ĐỘT (SCRUM-145)
  // ==============================================================

  // 13. Đồng bộ mục nhật ký ngoại tuyến kèm kiểm tra phiên bản (AC 1 & AC 3)
  router.post('/projects/:projectId/diary-items/sync', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ' });
    }

    if (checkViewerForbidden(req, res)) return;

    try {
      const userId = req.user?.userId || req.user?.id || 1;
      const result = await diaryService.syncDiaryItem(projectId, req.body, userId);
      if (result.conflict) {
        return res.status(409).json(result);
      }
      res.json(result);
    } catch (err) {
      const statusCode = err.status || 500;
      res.status(statusCode).json({
        success: false,
        message: err.message || 'Lỗi khi đồng bộ mục nhật ký'
      });
    }
  });

  // 14. Lấy danh sách các xung đột mục nhật ký (AC 2)
  router.get('/projects/:projectId/diary-items/conflicts', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ' });
    }

    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const conflicts = await diaryService.getConflicts(projectId, req.query);
      res.json({ success: true, data: conflicts });
    } catch (err) {
      const statusCode = err.status || 500;
      res.status(statusCode).json({
        success: false,
        message: err.message || 'Lỗi khi lấy danh sách xung đột'
      });
    }
  });

  // 15. Kỹ sư giám sát chọn bản giữ để giải quyết xung đột (AC 2)
  router.post('/projects/:projectId/diary-items/conflicts/:conflictId/resolve', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const conflictId = Number(req.params.conflictId);

    if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(conflictId) || conflictId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId hoặc conflictId không hợp lệ' });
    }

    if (checkViewerForbidden(req, res)) return;

    try {
      const userId = req.user?.userId || req.user?.id || 1;
      const result = await diaryService.resolveConflict(projectId, conflictId, req.body, userId);
      res.json(result);
    } catch (err) {
      const statusCode = err.status || 500;
      res.status(statusCode).json({
        success: false,
        message: err.message || 'Lỗi khi giải quyết xung đột'
      });
    }
  });

  // 16. Xem lịch sử các phiên bản của mục nhật ký (AC 2)
  router.get('/projects/:projectId/diary-items/:itemId/history', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const itemId = Number(req.params.itemId);

    if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(itemId) || itemId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId hoặc itemId không hợp lệ' });
    }

    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const history = await diaryService.getItemHistory(projectId, itemId);
      res.json({ success: true, data: history });
    } catch (err) {
      const statusCode = err.status || 500;
      res.status(statusCode).json({
        success: false,
        message: err.message || 'Lỗi khi lấy lịch sử mục nhật ký'
      });
    }
  });

  return router;
};
