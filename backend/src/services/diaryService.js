const {
  getSiteDiaries,
  getSiteDiaryByDate,
  saveSiteDiaryEntry,
  lockSiteDiary,
  inMemorySiteDiaries,
  inMemorySiteDiaryPhotos,
  getSiteDiaryPhotos,
  saveSiteDiaryPhoto,
  updateSiteDiaryPhoto,
  registerPendingSiteDiaryPhotos,
  deleteSiteDiaryPhoto,
  inMemorySiteDiaryItems,
  getSiteDiaryItems,
  getSiteDiaryItemById,
  saveSiteDiaryItem,
  updateSiteDiaryItem,
  deleteSiteDiaryItem,
  clearSiteDiaryItems,
  inMemoryTasks,
  inMemoryWorkItems,
  inMemorySiteDiaryItemConflicts,
  inMemorySiteDiaryItemHistory,
  saveSiteDiaryItemConflict,
  getSiteDiaryItemConflicts,
  getSiteDiaryItemConflictById,
  updateSiteDiaryItemConflict,
  saveSiteDiaryItemHistory,
  getSiteDiaryItemHistory
} = require('../models/store');

const DAY_NAMES = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

function isValidDateString(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  return (
    dateObj.getUTCFullYear() === y &&
    (dateObj.getUTCMonth() + 1) === m &&
    dateObj.getUTCDate() === d
  );
}

function getMonday(dateInput) {
  const d = new Date(dateInput);
  const day = d.getDay();
  // Chủ Nhật (0) -> lùi 6 ngày về Thứ Hai tuần trước; Thứ 2 (1) -> lùi 0; Thứ 3 (2) -> lùi 1...
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const dayNum = String(monday.getDate()).padStart(2, '0');
  return `${y}-${m}-${dayNum}`;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dayNum = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dayNum}`;
}

class DiaryService {
  constructor(db) {
    this.db = db;
    this.pool = db?.pool || db;
  }

  _normalizeItems(entryData) {
    let items = [];
    if (Array.isArray(entryData.items)) {
      items = entryData.items;
    } else if (typeof entryData.items === 'string' && entryData.items.trim()) {
      try {
        const parsed = JSON.parse(entryData.items);
        if (Array.isArray(parsed)) items = parsed;
      } catch (e) {}
    }

    if (items.length === 0 && (entryData.work_item_id || entryData.work_content)) {
      items = [{
        work_item_id: entryData.work_item_id ? Number(entryData.work_item_id) : null,
        work_content: String(entryData.work_content || entryData.work_notes || '').trim(),
        log_time: entryData.log_time ? String(entryData.log_time).trim() : null,
        quantity_done: Number(entryData.quantity_done || 0),
        unit: String(entryData.unit || '').trim()
      }];
    }
    return items.map(it => ({
      work_item_id: it.work_item_id ? Number(it.work_item_id) : null,
      work_content: String(it.work_content || it.content || it.name || '').trim(),
      log_time: it.log_time ? String(it.log_time).trim() : null,
      quantity_done: Number(it.quantity_done || it.quantity || 0),
      unit: String(it.unit || '').trim()
    }));
  }

  validateEntry(data) {
    const errors = [];
    if (!data.diary_date || !isValidDateString(data.diary_date)) {
      errors.push('Ngày nhật ký không hợp lệ hoặc thiếu định dạng YYYY-MM-DD');
    }

    const allowedConditions = ['sunny', 'cloudy', 'rain_intermittent', 'rain_all_day'];
    if (data.weather_condition && !allowedConditions.includes(data.weather_condition)) {
      errors.push(`Điều kiện thời tiết không hợp lệ. Phải là một trong: ${allowedConditions.join(', ')}`);
    }

    if (data.manpower_count !== undefined && data.manpower_count !== null && data.manpower_count !== '') {
      const num = Number(data.manpower_count);
      if (!Number.isInteger(num) || num < 0) {
        errors.push('Số lượng nhân lực phải là số nguyên không âm (>= 0)');
      }
    }

    if (data.work_item_id !== undefined && data.work_item_id !== null && data.work_item_id !== '') {
      const wid = Number(data.work_item_id);
      if (!Number.isInteger(wid) || wid <= 0) {
        errors.push('Mã công việc (work_item_id) phải là số nguyên dương');
      }
    }

    if (data.items) {
      let itemsList = data.items;
      if (typeof itemsList === 'string' && itemsList.trim()) {
        try {
          itemsList = JSON.parse(itemsList);
        } catch (e) {
          errors.push('Danh sách công việc (items) không đúng định dạng JSON');
        }
      }
      if (Array.isArray(itemsList)) {
        for (const it of itemsList) {
          if (it.work_item_id !== undefined && it.work_item_id !== null && it.work_item_id !== '') {
            const wid = Number(it.work_item_id);
            if (!Number.isInteger(wid) || wid <= 0) {
              errors.push(`Mã công việc (${it.work_item_id}) trong danh sách công việc không hợp lệ`);
              break;
            }
          }
        }
      }
    }

    return errors;
  }

  async getDiaryByDate(projectId, dateStr) {
    const pId = Number(projectId);
    if (!isValidDateString(dateStr)) {
      throw new Error('Định dạng ngày không hợp lệ');
    }

    let diary = null;

    if (this.pool?.query) {
      const [rows] = await this.pool.query(
        'SELECT * FROM site_diaries WHERE project_id = ? AND diary_date = ? LIMIT 1',
        [pId, dateStr]
      );
      if (rows && rows.length > 0) {
        diary = rows[0];
        if (diary.diary_date instanceof Date) {
          const y = diary.diary_date.getFullYear();
          const m = String(diary.diary_date.getMonth() + 1).padStart(2, '0');
          const d = String(diary.diary_date.getDate()).padStart(2, '0');
          diary.diary_date = `${y}-${m}-${d}`;
        }
      }
    } else {
      diary = getSiteDiaryByDate(pId, dateStr);
    }

    if (!diary) return null;

    // Lấy danh sách ảnh đính kèm (T52 & S-33 T-60)
    let photos = [];
    if (this.pool?.query) {
      try {
        const [pRows] = await this.pool.query(
          'SELECT id, diary_id, file_name, file_path, file_size, mime_type, caption, upload_status, client_photo_id, created_at FROM site_diary_photos WHERE diary_id = ? ORDER BY id ASC',
          [diary.id]
        );
        photos = (pRows || []).map(p => {
          const status = p.upload_status || 'completed';
          const isPending = status === 'pending' || status === 'uploading';
          return {
            ...p,
            upload_status: status,
            url: isPending ? null : (p.file_name ? `/uploads/diaries/${p.file_name}` : null)
          };
        });
      } catch (e) {
        photos = getSiteDiaryPhotos(diary.id).map(p => {
          const status = p.upload_status || 'completed';
          const isPending = status === 'pending' || status === 'uploading';
          return {
            ...p,
            upload_status: status,
            url: isPending ? null : (p.file_name ? `/uploads/diaries/${p.file_name}` : null)
          };
        });
      }
    } else {
      photos = getSiteDiaryPhotos(diary.id).map(p => {
        const status = p.upload_status || 'completed';
        const isPending = status === 'pending' || status === 'uploading';
        return {
          ...p,
          upload_status: status,
          url: isPending ? null : (p.file_name ? `/uploads/diaries/${p.file_name}` : null)
        };
      });
    }

    // Lấy danh sách công việc chi tiết (T51/T52/S-21)
    let items = [];
    if (this.pool?.query) {
      try {
        const [iRows] = await this.pool.query(
          `SELECT i.*, w.name as work_item_name, w.code as work_item_code
           FROM site_diary_items i
           LEFT JOIN work_items w ON i.work_item_id = w.id
           WHERE i.diary_id = ? ORDER BY i.log_time ASC, i.id ASC`,
          [diary.id]
        );
        items = iRows || [];
      } catch (e) {
        items = getSiteDiaryItems(diary.id).map(it => {
          const wi = inMemoryWorkItems.find(w => Number(w.id) === Number(it.work_item_id));
          return {
            ...it,
            work_item_name: wi?.name || null,
            work_item_code: wi?.code || null
          };
        });
      }
    } else {
      items = getSiteDiaryItems(diary.id).map(it => {
        const wi = inMemoryWorkItems.find(w => Number(w.id) === Number(it.work_item_id));
        return {
          ...it,
          work_item_name: wi?.name || null,
          work_item_code: wi?.code || null
        };
      });
    }

    diary.photos = photos;
    diary.items = items;
    return diary;
  }

  async getDiaries(projectId, { date, start_date, end_date, is_rain_day } = {}) {
    const pId = Number(projectId);

    let list = [];
    if (this.pool?.query) {
      let query = 'SELECT * FROM site_diaries WHERE project_id = ?';
      const params = [pId];

      if (date) {
        query += ' AND diary_date = ?';
        params.push(date);
      }
      if (start_date && end_date) {
        query += ' AND diary_date >= ? AND diary_date <= ?';
        params.push(start_date, end_date);
      }
      if (is_rain_day !== undefined) {
        query += ' AND is_rain_day = ?';
        params.push(is_rain_day ? 1 : 0);
      }

      query += ' ORDER BY diary_date ASC';
      const [rows] = await this.pool.query(query, params);
      list = (rows || []).map(r => {
        if (r.diary_date instanceof Date) {
          const y = r.diary_date.getFullYear();
          const m = String(r.diary_date.getMonth() + 1).padStart(2, '0');
          const d = String(r.diary_date.getDate()).padStart(2, '0');
          r.diary_date = `${y}-${m}-${d}`;
        }
        return r;
      });
    } else {
      list = getSiteDiaries({
        project_id: pId,
        date,
        start_date,
        end_date,
        is_rain_day
      });
    }

    // Đính kèm số lượng ảnh cho mỗi nhật ký
    return Promise.all(list.map(async (entry) => {
      let photosCount = 0;
      if (this.pool?.query) {
        try {
          const [cRows] = await this.pool.query(
            'SELECT COUNT(*) as count FROM site_diary_photos WHERE diary_id = ?',
            [entry.id]
          );
          photosCount = cRows[0]?.count || 0;
        } catch (e) {
          photosCount = getSiteDiaryPhotos(entry.id).length;
        }
      } else {
        photosCount = getSiteDiaryPhotos(entry.id).length;
      }
      return {
        ...entry,
        photosCount
      };
    }));
  }

  async saveDiary(projectId, entryData, userId = 1, files = []) {
    const pId = Number(projectId);
    if (!Number.isInteger(pId) || pId <= 0) {
      const err = new Error('projectId không hợp lệ');
      err.status = 400;
      throw err;
    }

    const validationErrors = this.validateEntry(entryData);
    if (validationErrors.length > 0) {
      const err = new Error(validationErrors.join('; '));
      err.status = 400;
      throw err;
    }

    const diaryDate = entryData.diary_date;
    const weatherCond = entryData.weather_condition || 'sunny';
    // Đánh dấu ngày mưa: nếu là rain_all_day hoặc truyền is_rain_day = true
    const isRain = (weatherCond === 'rain_all_day' || Boolean(entryData.is_rain_day)) ? 1 : 0;
    const manpower = Number(entryData.manpower_count || 0);
    const equipStatus = entryData.equipment_status ? String(entryData.equipment_status).trim() : '';
    const weatherNotes = entryData.weather_notes ? String(entryData.weather_notes).trim() : '';
    const workNotes = entryData.work_notes ? String(entryData.work_notes).trim() : '';
    const tempMin = entryData.temperature_min !== undefined && entryData.temperature_min !== null ? Number(entryData.temperature_min) : null;
    const tempMax = entryData.temperature_max !== undefined && entryData.temperature_max !== null ? Number(entryData.temperature_max) : null;

    let diaryId = null;

    if (this.pool?.query) {
      // 1. Kiểm tra khóa sổ trước khi lưu (S-24)
      const [existingRows] = await this.pool.query(
        'SELECT id, is_locked FROM site_diaries WHERE project_id = ? AND diary_date = ? LIMIT 1',
        [pId, diaryDate]
      );

      if (existingRows && existingRows.length > 0 && existingRows[0].is_locked === 1) {
        const err = new Error('Nhật ký của ngày này đã bị khóa sổ, không thể chỉnh sửa.');
        err.status = 423;
        throw err;
      }

      // 2. Thực hiện UPSERT an toàn - Không tạo bản ghi trùng khi lưu nhiều lần
      const [insertRes] = await this.pool.query(
        `INSERT INTO site_diaries (
          project_id, diary_date, weather_condition, is_rain_day,
          temperature_min, temperature_max, weather_notes,
          manpower_count, equipment_status, work_notes, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          weather_condition = VALUES(weather_condition),
          is_rain_day = VALUES(is_rain_day),
          temperature_min = VALUES(temperature_min),
          temperature_max = VALUES(temperature_max),
          weather_notes = VALUES(weather_notes),
          manpower_count = VALUES(manpower_count),
          equipment_status = VALUES(equipment_status),
          work_notes = VALUES(work_notes),
          updated_at = CURRENT_TIMESTAMP`,
        [
          pId, diaryDate, weatherCond, isRain,
          tempMin, tempMax, weatherNotes,
          manpower, equipStatus, workNotes, userId
        ]
      );

      diaryId = (existingRows && existingRows.length > 0) ? existingRows[0].id : insertRes.insertId;

      // 3. Lưu chi tiết các công việc thực hiện trong ngày (items)
      const items = this._normalizeItems(entryData);
      if (items.length > 0) {
        await this.pool.query('DELETE FROM site_diary_items WHERE diary_id = ?', [diaryId]);
        for (const it of items) {
          const wId = it.work_item_id ? Number(it.work_item_id) : null;
          const content = String(it.work_content || it.content || it.name || '').trim();
          const logTime = it.log_time ? String(it.log_time).trim() : null;
          const qty = Number(it.quantity_done || it.quantity || 0);
          const unit = String(it.unit || '').trim();
          if (content || wId) {
            await this.pool.query(
              'INSERT INTO site_diary_items (diary_id, work_item_id, work_content, log_time, quantity_done, unit) VALUES (?, ?, ?, ?, ?, ?)',
              [diaryId, wId, content || 'Hoàn thành hạng mục', logTime, qty, unit]
            );
          }
        }
      }

      // 4. Lưu ảnh đính kèm hoàn chỉnh (photos)
      if (Array.isArray(files) && files.length > 0) {
        for (const file of files) {
          const fileName = file.filename || file.file_name || file.name;
          const filePath = file.path || file.file_path || file.url || '';
          const fileSize = Number(file.size || file.file_size || 0);
          const mimeType = file.mimetype || file.mime_type || 'image/jpeg';
          const caption = file.caption ? String(file.caption).trim() : null;

          await this.pool.query(
            'INSERT INTO site_diary_photos (diary_id, file_name, file_path, file_size, mime_type, caption, upload_status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [diaryId, fileName, filePath, fileSize, mimeType, caption, 'completed']
          );
        }
      }

      // 4b. Lưu danh sách ảnh chờ tải nền (S-33 / SCRUM-158 / T-60)
      let pendingList = [];
      if (Array.isArray(entryData.pending_photos)) {
        pendingList = entryData.pending_photos;
      } else if (typeof entryData.pending_photos === 'string' && entryData.pending_photos.trim()) {
        try {
          const parsed = JSON.parse(entryData.pending_photos);
          if (Array.isArray(parsed)) pendingList = parsed;
        } catch (_) {}
      }

      if (pendingList.length > 0) {
        for (const p of pendingList) {
          const fileName = p.file_name || p.fileName || 'anh_cho_tai.jpg';
          const fileSize = Number(p.file_size || p.fileSize || 0);
          const mimeType = p.mime_type || p.fileType || 'image/jpeg';
          const caption = p.caption ? String(p.caption).trim() : null;
          const clientPhotoId = p.client_photo_id || p.id || null;
          await this.pool.query(
            'INSERT INTO site_diary_photos (diary_id, file_name, file_path, file_size, mime_type, caption, upload_status, client_photo_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [diaryId, fileName, '', fileSize, mimeType, caption, 'pending', clientPhotoId]
          );
        }
      }

      return this.getDiaryByDate(pId, diaryDate);
    }

    // In-memory fallback
    const saved = saveSiteDiaryEntry({
      project_id: pId,
      diary_date: diaryDate,
      weather_condition: weatherCond,
      is_rain_day: Boolean(isRain),
      temperature_min: tempMin,
      temperature_max: tempMax,
      weather_notes: weatherNotes,
      manpower_count: manpower,
      equipment_status: equipStatus,
      work_notes: workNotes,
      created_by: userId
    });

    diaryId = saved.id;

    // Lưu items in-memory
    const items = this._normalizeItems(entryData);
    if (items.length > 0) {
      clearSiteDiaryItems(diaryId);
      items.forEach(it => {
        saveSiteDiaryItem({
          diary_id: diaryId,
          work_item_id: it.work_item_id ? Number(it.work_item_id) : null,
          work_content: String(it.work_content || it.content || it.name || '').trim(),
          log_time: it.log_time ? String(it.log_time).trim() : null,
          quantity_done: Number(it.quantity_done || it.quantity || 0),
          unit: String(it.unit || '').trim()
        });
      });
    }

    // Lưu photos in-memory
    if (Array.isArray(files) && files.length > 0) {
      files.forEach(f => {
        saveSiteDiaryPhoto({
          diary_id: diaryId,
          file_name: f.filename || f.file_name || f.name,
          file_path: f.path || f.file_path || f.url || '',
          file_size: Number(f.size || f.file_size || 0),
          mime_type: f.mimetype || f.mime_type || 'image/jpeg',
          caption: f.caption ? String(f.caption).trim() : null,
          upload_status: 'completed'
        });
      });
    }

    // Lưu pending_photos in-memory (S-33 / T-60)
    let pendingListMem = [];
    if (Array.isArray(entryData.pending_photos)) {
      pendingListMem = entryData.pending_photos;
    } else if (typeof entryData.pending_photos === 'string' && entryData.pending_photos.trim()) {
      try {
        const parsed = JSON.parse(entryData.pending_photos);
        if (Array.isArray(parsed)) pendingListMem = parsed;
      } catch (_) {}
    }
    if (pendingListMem.length > 0) {
      registerPendingSiteDiaryPhotos(diaryId, pendingListMem);
    }

    return this.getDiaryByDate(pId, diaryDate);
  }

  async addPhotos(projectId, diaryDate, files = [], userId = 1) {
    const pId = Number(projectId);
    const diary = await this.getDiaryByDate(pId, diaryDate);
    if (!diary) {
      const err = new Error(`Không tìm thấy nhật ký ngày ${diaryDate} để đính kèm ảnh`);
      err.status = 404;
      throw err;
    }

    if (diary.is_locked === 1) {
      const err = new Error('Nhật ký của ngày này đã bị khóa sổ, không thể đính kèm thêm ảnh.');
      err.status = 423;
      throw err;
    }

    if (!Array.isArray(files) || files.length === 0) {
      const err = new Error('Không có file ảnh nào được tải lên');
      err.status = 400;
      throw err;
    }

    if (this.pool?.query) {
      for (const file of files) {
        const fileName = file.filename || file.file_name;
        const filePath = file.path || file.file_path || '';
        const fileSize = Number(file.size || 0);
        const mimeType = file.mimetype || 'image/jpeg';
        const caption = file.caption || null;

        await this.pool.query(
          'INSERT INTO site_diary_photos (diary_id, file_name, file_path, file_size, mime_type, caption, upload_status) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [diary.id, fileName, filePath, fileSize, mimeType, caption, 'completed']
        );
      }
    } else {
      files.forEach(f => {
        saveSiteDiaryPhoto({
          diary_id: diary.id,
          file_name: f.filename || f.file_name,
          file_path: f.path || f.file_path || '',
          file_size: Number(f.size || 0),
          mime_type: f.mimetype || 'image/jpeg',
          caption: f.caption || null,
          upload_status: 'completed'
        });
      });
    }

    return this.getDiaryByDate(pId, diaryDate);
  }

  /**
   * S-33 / SCRUM-158 / T-60: Đăng ký hàng đợi ảnh chờ tải nền
   */
  async registerPendingPhotos(projectId, diaryDate, pendingPhotos = [], userId = 1) {
    const pId = Number(projectId);
    let diary = await this.getDiaryByDate(pId, diaryDate);
    if (!diary) {
      diary = await this.saveDiary(pId, { diary_date: diaryDate }, userId);
    }

    if (diary.is_locked === 1) {
      const err = new Error('Nhật ký đã bị khóa sổ, không thể đăng ký thêm ảnh.');
      err.status = 423;
      throw err;
    }

    const list = Array.isArray(pendingPhotos) ? pendingPhotos : [];
    if (list.length === 0) return { success: true, registeredCount: 0 };

    if (this.pool?.query) {
      for (const p of list) {
        const fileName = p.file_name || p.fileName || 'anh_cho_tai.jpg';
        const fileSize = Number(p.file_size || p.fileSize || 0);
        const mimeType = p.mime_type || p.fileType || 'image/jpeg';
        const caption = p.caption ? String(p.caption).trim() : null;
        const clientPhotoId = p.client_photo_id || p.id || null;

        await this.pool.query(
          `INSERT INTO site_diary_photos (diary_id, file_name, file_path, file_size, mime_type, caption, upload_status, client_photo_id)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
          [diary.id, fileName, '', fileSize, mimeType, caption, clientPhotoId]
        );
      }
    } else {
      registerPendingSiteDiaryPhotos(diary.id, list);
    }

    return this.getDiaryByDate(pId, diaryDate);
  }

  /**
   * S-33 / SCRUM-159 & SCRUM-160 / T-61 & T-62: Tải lên từng ảnh nền từ hàng đợi
   * - Hỗ trợ retry không gây hỏng file trên máy chủ
   * - Cập nhật trạng thái từ 'pending' sang 'completed'
   */
  async uploadSinglePhoto(projectId, diaryDate, file, { client_photo_id, caption, userId = 1 } = {}) {
    const pId = Number(projectId);
    let diary = await this.getDiaryByDate(pId, diaryDate);
    if (!diary) {
      diary = await this.saveDiary(pId, { diary_date: diaryDate }, userId);
    }

    if (diary.is_locked === 1) {
      const err = new Error('Nhật ký đã bị khóa sổ, không thể tải ảnh lên.');
      err.status = 423;
      throw err;
    }

    if (!file) {
      const err = new Error('Không có tệp ảnh nào được gửi lên');
      err.status = 400;
      throw err;
    }

    const fileName = file.filename || file.file_name;
    const filePath = file.path || file.file_path || '';
    const fileSize = Number(file.size || 0);
    const mimeType = file.mimetype || 'image/jpeg';
    const photoCaption = caption || file.caption || null;
    const clientId = client_photo_id || null;

    if (this.pool?.query) {
      let existingId = null;
      if (clientId) {
        const [rows] = await this.pool.query(
          'SELECT id, caption FROM site_diary_photos WHERE diary_id = ? AND client_photo_id = ? LIMIT 1',
          [diary.id, clientId]
        );
        if (rows && rows.length > 0) {
          existingId = rows[0].id;
        }
      }

      if (existingId) {
        await this.pool.query(
          `UPDATE site_diary_photos
           SET file_name = ?, file_path = ?, file_size = ?, mime_type = ?,
               caption = COALESCE(?, caption), upload_status = 'completed'
           WHERE id = ?`,
          [fileName, filePath, fileSize, mimeType, photoCaption, existingId]
        );
      } else {
        await this.pool.query(
          `INSERT INTO site_diary_photos (diary_id, file_name, file_path, file_size, mime_type, caption, upload_status, client_photo_id)
           VALUES (?, ?, ?, ?, ?, ?, 'completed', ?)`,
          [diary.id, fileName, filePath, fileSize, mimeType, photoCaption, clientId]
        );
      }
    } else {
      const existing = clientId ? inMemorySiteDiaryPhotos.find(p => p.diary_id === diary.id && p.client_photo_id === clientId) : null;
      if (existing) {
        updateSiteDiaryPhoto(existing.id, {
          file_name: fileName,
          file_path: filePath,
          file_size: fileSize,
          mime_type: mimeType,
          caption: photoCaption || existing.caption,
          upload_status: 'completed'
        });
      } else {
        saveSiteDiaryPhoto({
          diary_id: diary.id,
          file_name: fileName,
          file_path: filePath,
          file_size: fileSize,
          mime_type: mimeType,
          caption: photoCaption,
          upload_status: 'completed',
          client_photo_id: clientId
        });
      }
    }

    return {
      success: true,
      message: 'Tải ảnh nền thành công',
      photo: {
        file_name: fileName,
        file_size: fileSize,
        mime_type: mimeType,
        url: `/uploads/diaries/${fileName}`,
        caption: photoCaption,
        upload_status: 'completed',
        client_photo_id: clientId
      }
    };
  }

  async deletePhoto(projectId, photoId) {
    const phId = Number(photoId);
    if (this.pool?.query) {
      const [rows] = await this.pool.query(
        `SELECT p.*, d.is_locked, d.project_id
         FROM site_diary_photos p
         JOIN site_diaries d ON p.diary_id = d.id
         WHERE p.id = ? LIMIT 1`,
        [phId]
      );
      if (!rows || rows.length === 0) {
        const err = new Error('Không tìm thấy ảnh đính kèm');
        err.status = 404;
        throw err;
      }
      if (rows[0].is_locked === 1) {
        const err = new Error('Nhật ký đã bị khóa sổ, không thể xóa ảnh.');
        err.status = 423;
        throw err;
      }
      await this.pool.query('DELETE FROM site_diary_photos WHERE id = ?', [phId]);
      return true;
    }

    return deleteSiteDiaryPhoto(phId);
  }

  /**
   * T51: Xem và đối chiếu dữ liệu tuần làm việc (Thứ Hai -> Thứ Sáu và mở rộng)
   */
  async getWeeklyComparison(projectId, targetDate) {
    const pId = Number(projectId);
    const baseDate = targetDate && isValidDateString(targetDate) ? targetDate : new Date().toISOString().split('T')[0];
    const mondayStr = getMonday(baseDate);

    // Lập danh sách 5 ngày làm việc chính thức (T2 -> T6) và 2 ngày cuối tuần (T7, CN)
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const dateStr = addDays(mondayStr, i);
      const dObj = new Date(dateStr + 'T00:00:00Z');
      const dayOfWeekIdx = dObj.getUTCDay(); // 0: CN, 1: T2, ..., 6: T7
      weekDays.push({
        date: dateStr,
        dayOfWeekIndex: dayOfWeekIdx,
        dayOfWeekName: DAY_NAMES[dayOfWeekIdx],
        isWorkday: dayOfWeekIdx >= 1 && dayOfWeekIdx <= 5, // Thứ 2 đến thứ 6
        isWeekend: dayOfWeekIdx === 0 || dayOfWeekIdx === 6
      });
    }

    const sundayStr = weekDays[6].date;
    const fridayStr = weekDays[4].date;

    // Lấy dữ liệu nhật ký của cả tuần
    const diaries = await this.getDiaries(pId, { start_date: mondayStr, end_date: sundayStr });
    const diaryMap = new Map();
    diaries.forEach(d => diaryMap.set(d.diary_date, d));

    let workdayRainCount = 0;
    const rainDates = [];

    const daysWithData = weekDays.map(wd => {
      const entry = diaryMap.get(wd.date) || null;
      const isRain = entry ? Boolean(entry.is_rain_day) : false;

      if (wd.isWorkday && isRain) {
        workdayRainCount++;
        rainDates.push(wd.date);
      }

      return {
        ...wd,
        hasDiary: Boolean(entry),
        diaryId: entry?.id || null,
        weatherCondition: entry?.weather_condition || 'none',
        weatherConditionText: entry ? (
          entry.weather_condition === 'rain_all_day' ? 'Mưa cả ngày' :
          entry.weather_condition === 'rain_intermittent' ? 'Mưa ngắt quãng' :
          entry.weather_condition === 'cloudy' ? 'Nhiều mây' : 'Nắng ráo'
        ) : 'Chưa có nhật ký',
        isRainDay: isRain,
        manpowerCount: entry?.manpower_count !== undefined ? entry.manpower_count : 0,
        equipmentStatus: entry?.equipment_status || '',
        weatherNotes: entry?.weather_notes || '',
        workNotes: entry?.work_notes || '',
        isLocked: Boolean(entry?.is_locked)
      };
    });

    // Lấy danh sách công việc của dự án để đối chiếu công việc có khả năng bị ảnh hưởng
    let activeTasks = [];
    try {
      if (this.pool?.query) {
        const [tRows] = await this.pool.query(
          'SELECT id, name, code, duration, status FROM tasks WHERE project_id = ? ORDER BY id ASC',
          [pId]
        );
        activeTasks = tRows || [];
      } else {
        activeTasks = (inMemoryTasks || []).filter(t => t.project_id === pId);
      }
    } catch (e) {
      // Bỏ qua lỗi query task nếu có
    }

    return {
      success: true,
      projectId: pId,
      weekRange: {
        startDate: mondayStr,
        fridayDate: fridayStr,
        endDate: sundayStr
      },
      summary: {
        totalWorkdays: 5,
        workdayRainCount,
        rainDates,
        rainRatio: Math.round((workdayRainCount / 5) * 100),
        statusAlert: workdayRainCount >= 3 ? 'high_risk' : (workdayRainCount > 0 ? 'medium_risk' : 'normal'),
        impactDescription: workdayRainCount === 0
          ? 'Thời tiết tuần làm việc thuận lợi, không có ngày mưa cản trở tiến độ.'
          : `Ghi nhận ${workdayRainCount}/5 ngày làm việc bị MƯA CẢ NGÀY (${rainDates.join(', ')}). Công trường cần đối chiếu nhật ký mưa với các công việc bị chậm tiến độ để lập biên bản gia hạn hoặc điều chỉnh kế hoạch thi công.`
      },
      days: daysWithData,
      tasksUnderReview: activeTasks.slice(0, 5).map(t => ({
        id: t.id,
        name: t.name,
        code: t.code,
        status: t.status,
        possibleDelayNote: workdayRainCount > 0 ? `Bị ảnh hưởng gián đoạn do ${workdayRainCount} ngày mưa trong tuần` : 'Đang thực hiện bình thường'
      }))
    };
  }

  // ========================================================
  // S-21 / SCRUM-113: KỸ SƯ GIÁM SÁT GHI MỤC NHẬT KÝ HẰNG NGÀY GẮN HẠNG MỤC
  // Acceptance Criteria:
  // AC 1: Ghi mục nhật ký với hạng mục, nội dung công việc và giờ -> hiện ngay trong danh sách nhật ký của ngày hôm đó.
  // AC 2: Mở nhật ký, lọc theo hạng mục hoặc theo ngày -> chỉ thấy mục khớp.
  // AC 3: Để trống hạng mục -> bị chặn (mục nhật ký nào cũng phải gắn được vào hạng mục để tra hồ sơ).
  // ========================================================

  validateDiaryItem(itemData) {
    if (!itemData || typeof itemData !== 'object') {
      const err = new Error('Dữ liệu mục nhật ký không hợp lệ');
      err.status = 400;
      throw err;
    }

    // AC 3: Ràng buộc bắt buộc hạng mục (work_item_id)
    const workItemId = itemData.work_item_id !== undefined && itemData.work_item_id !== null && itemData.work_item_id !== ''
      ? Number(itemData.work_item_id)
      : null;

    if (!workItemId || !Number.isInteger(workItemId) || workItemId <= 0) {
      const err = new Error('Hạng mục không được để trống. Mục nhật ký nào cũng phải gắn được vào hạng mục để sau này tra hồ sơ.');
      err.status = 400;
      throw err;
    }

    // Bắt buộc nội dung công việc
    const workContent = String(itemData.work_content || '').trim();
    if (!workContent) {
      const err = new Error('Nội dung công việc không được để trống.');
      err.status = 400;
      throw err;
    }

    return {
      work_item_id: workItemId,
      work_content: workContent,
      log_time: itemData.log_time ? String(itemData.log_time).trim() : null,
      quantity_done: Number(itemData.quantity_done || 0),
      unit: String(itemData.unit || '').trim()
    };
  }

  async addDiaryItem(projectId, diaryDate, itemData, userId = 1) {
    const pId = Number(projectId);
    if (!Number.isInteger(pId) || pId <= 0) {
      const err = new Error('projectId không hợp lệ');
      err.status = 400;
      throw err;
    }

    const dateStr = diaryDate || new Date().toISOString().split('T')[0];
    if (!isValidDateString(dateStr)) {
      const err = new Error('Ngày nhật ký không hợp lệ (YYYY-MM-DD)');
      err.status = 400;
      throw err;
    }

    // AC 3: Kiểm tra hợp lệ (chặn nếu để trống hạng mục)
    const validated = this.validateDiaryItem(itemData);

    // Chuẩn hóa giờ ghi nhận (giờ)
    let logTime = validated.log_time;
    if (!logTime) {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      logTime = `${hh}:${mm}`;
    }

    // Đảm bảo bản ghi nhật ký ngày đã tồn tại
    let diary = await this.getDiaryByDate(pId, dateStr);
    if (!diary) {
      diary = await this.saveDiary(pId, { diary_date: dateStr }, userId);
    }

    if (diary.is_locked === 1) {
      const err = new Error('Nhật ký của ngày này đã bị khóa sổ, không thể ghi thêm mục.');
      err.status = 423;
      throw err;
    }

    let createdItem = null;
    let dayItems = [];

    if (this.pool?.query) {
      const [insertRes] = await this.pool.query(
        `INSERT INTO site_diary_items (diary_id, work_item_id, work_content, log_time, quantity_done, unit)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [diary.id, validated.work_item_id, validated.work_content, logTime, validated.quantity_done, validated.unit]
      );
      const itemId = insertRes.insertId;

      const [rows] = await this.pool.query(
        `SELECT i.*, w.name as work_item_name, w.code as work_item_code, d.diary_date, d.is_locked
         FROM site_diary_items i
         JOIN site_diaries d ON i.diary_id = d.id
         LEFT JOIN work_items w ON i.work_item_id = w.id
         WHERE i.id = ?`,
        [itemId]
      );
      createdItem = rows[0] || null;

      const [dRows] = await this.pool.query(
        `SELECT i.*, w.name as work_item_name, w.code as work_item_code, d.diary_date, d.is_locked
         FROM site_diary_items i
         JOIN site_diaries d ON i.diary_id = d.id
         LEFT JOIN work_items w ON i.work_item_id = w.id
         WHERE i.diary_id = ?
         ORDER BY i.log_time ASC, i.id ASC`,
        [diary.id]
      );
      dayItems = dRows || [];
    } else {
      const saved = saveSiteDiaryItem({
        diary_id: diary.id,
        work_item_id: validated.work_item_id,
        work_content: validated.work_content,
        log_time: logTime,
        quantity_done: validated.quantity_done,
        unit: validated.unit
      });

      const wi = inMemoryWorkItems.find(w => Number(w.id) === validated.work_item_id);
      createdItem = {
        ...saved,
        work_item_name: wi?.name || null,
        work_item_code: wi?.code || null,
        diary_date: dateStr,
        is_locked: diary.is_locked || 0
      };

      dayItems = getSiteDiaryItems(diary.id).map(it => {
        const w = inMemoryWorkItems.find(x => Number(x.id) === Number(it.work_item_id));
        return {
          ...it,
          work_item_name: w?.name || null,
          work_item_code: w?.code || null,
          diary_date: dateStr,
          is_locked: diary.is_locked || 0
        };
      }).sort((a, b) => String(a.log_time || '').localeCompare(String(b.log_time || '')) || (a.id - b.id));
    }

    return {
      success: true,
      message: 'Ghi mục nhật ký thành công',
      item: createdItem,
      dayItems
    };
  }

  /**
   * AC 2: Lọc mục nhật ký theo hạng mục hoặc theo ngày
   */
  async getDiaryItems(projectId, { date, work_item_id, start_date, end_date } = {}) {
    const pId = Number(projectId);
    if (!Number.isInteger(pId) || pId <= 0) {
      const err = new Error('projectId không hợp lệ');
      err.status = 400;
      throw err;
    }

    if (this.pool?.query) {
      let query = `
        SELECT 
          i.id, i.diary_id, i.work_item_id, i.work_content, i.log_time, i.quantity_done, i.unit, i.created_at, i.updated_at,
          d.diary_date, d.weather_condition, d.is_locked,
          w.name as work_item_name, w.code as work_item_code
        FROM site_diary_items i
        JOIN site_diaries d ON i.diary_id = d.id
        LEFT JOIN work_items w ON i.work_item_id = w.id
        WHERE d.project_id = ?
      `;
      const params = [pId];

      if (date) {
        query += ' AND d.diary_date = ?';
        params.push(date);
      }
      if (work_item_id !== undefined && work_item_id !== null && work_item_id !== '') {
        query += ' AND i.work_item_id = ?';
        params.push(Number(work_item_id));
      }
      if (start_date && end_date) {
        query += ' AND d.diary_date >= ? AND d.diary_date <= ?';
        params.push(start_date, end_date);
      }

      query += ' ORDER BY d.diary_date DESC, i.log_time ASC, i.id ASC';
      const [rows] = await this.pool.query(query, params);
      return (rows || []).map(r => {
        if (r.diary_date instanceof Date) {
          const y = r.diary_date.getFullYear();
          const m = String(r.diary_date.getMonth() + 1).padStart(2, '0');
          const d = String(r.diary_date.getDate()).padStart(2, '0');
          r.diary_date = `${y}-${m}-${d}`;
        }
        return r;
      });
    }

    // In-memory fallback
    const result = [];
    const targetWorkItemId = (work_item_id !== undefined && work_item_id !== null && work_item_id !== '')
      ? Number(work_item_id)
      : null;

    for (const item of inMemorySiteDiaryItems) {
      const d = inMemorySiteDiaries.find(x => Number(x.id) === Number(item.diary_id) && Number(x.project_id) === pId);
      if (!d) continue;

      if (date && d.diary_date !== date) continue;
      if (targetWorkItemId !== null && Number(item.work_item_id) !== targetWorkItemId) continue;
      if (start_date && d.diary_date < start_date) continue;
      if (end_date && d.diary_date > end_date) continue;

      const wi = inMemoryWorkItems.find(w => Number(w.id) === Number(item.work_item_id));
      result.push({
        ...item,
        work_item_name: wi?.name || null,
        work_item_code: wi?.code || null,
        diary_date: d.diary_date,
        weather_condition: d.weather_condition,
        is_locked: d.is_locked || 0
      });
    }

    result.sort((a, b) => {
      if (a.diary_date !== b.diary_date) {
        return b.diary_date.localeCompare(a.diary_date);
      }
      return String(a.log_time || '').localeCompare(String(b.log_time || '')) || (a.id - b.id);
    });

    return result;
  }

  async updateDiaryItem(projectId, itemId, updateData = {}) {
    const pId = Number(projectId);
    const iId = Number(itemId);
    if (!Number.isInteger(pId) || pId <= 0 || !Number.isInteger(iId) || iId <= 0) {
      const err = new Error('projectId hoặc itemId không hợp lệ');
      err.status = 400;
      throw err;
    }

    if (this.pool?.query) {
      const [rows] = await this.pool.query(
        `SELECT i.*, d.project_id, d.is_locked
         FROM site_diary_items i
         JOIN site_diaries d ON i.diary_id = d.id
         WHERE i.id = ? AND d.project_id = ? LIMIT 1`,
        [iId, pId]
      );
      if (!rows || rows.length === 0) {
        const err = new Error('Không tìm thấy mục nhật ký');
        err.status = 404;
        throw err;
      }
      if (rows[0].is_locked === 1) {
        const err = new Error('Nhật ký đã bị khóa sổ, không thể chỉnh sửa.');
        err.status = 423;
        throw err;
      }

      const updates = [];
      const params = [];
      if (updateData.work_item_id !== undefined) {
        const wId = Number(updateData.work_item_id);
        if (!wId || wId <= 0) {
          const err = new Error('Hạng mục không được để trống. Mục nhật ký nào cũng phải gắn được vào hạng mục để sau này tra hồ sơ.');
          err.status = 400;
          throw err;
        }
        updates.push('work_item_id = ?');
        params.push(wId);
      }
      if (updateData.work_content !== undefined) {
        const content = String(updateData.work_content).trim();
        if (!content) {
          const err = new Error('Nội dung công việc không được để trống.');
          err.status = 400;
          throw err;
        }
        updates.push('work_content = ?');
        params.push(content);
      }
      if (updateData.log_time !== undefined) {
        updates.push('log_time = ?');
        params.push(updateData.log_time ? String(updateData.log_time).trim() : null);
      }
      if (updateData.quantity_done !== undefined) {
        updates.push('quantity_done = ?');
        params.push(Number(updateData.quantity_done || 0));
      }
      if (updateData.unit !== undefined) {
        updates.push('unit = ?');
        params.push(String(updateData.unit || '').trim());
      }

      if (updates.length > 0) {
        params.push(iId);
        await this.pool.query(`UPDATE site_diary_items SET ${updates.join(', ')} WHERE id = ?`, params);
      }

      const [updatedRows] = await this.pool.query(
        `SELECT i.*, w.name as work_item_name, w.code as work_item_code, d.diary_date, d.is_locked
         FROM site_diary_items i
         JOIN site_diaries d ON i.diary_id = d.id
         LEFT JOIN work_items w ON i.work_item_id = w.id
         WHERE i.id = ?`,
        [iId]
      );
      return updatedRows[0];
    }

    // In-memory
    const existing = inMemorySiteDiaryItems.find(i => Number(i.id) === iId);
    if (!existing) {
      const err = new Error('Không tìm thấy mục nhật ký');
      err.status = 404;
      throw err;
    }
    const diary = inMemorySiteDiaries.find(d => Number(d.id) === Number(existing.diary_id) && Number(d.project_id) === pId);
    if (!diary) {
      const err = new Error('Không tìm thấy mục nhật ký thuộc dự án');
      err.status = 404;
      throw err;
    }
    if (diary.is_locked === 1) {
      const err = new Error('Nhật ký đã bị khóa sổ, không thể chỉnh sửa.');
      err.status = 423;
      throw err;
    }

    if (updateData.work_item_id !== undefined) {
      const wId = Number(updateData.work_item_id);
      if (!wId || wId <= 0) {
        const err = new Error('Hạng mục không được để trống. Mục nhật ký nào cũng phải gắn được vào hạng mục để sau này tra hồ sơ.');
        err.status = 400;
        throw err;
      }
    }
    if (updateData.work_content !== undefined && !String(updateData.work_content).trim()) {
      const err = new Error('Nội dung công việc không được để trống.');
      err.status = 400;
      throw err;
    }

    const updated = updateSiteDiaryItem(iId, updateData);
    const wi = inMemoryWorkItems.find(w => Number(w.id) === Number(updated.work_item_id));
    return {
      ...updated,
      work_item_name: wi?.name || null,
      work_item_code: wi?.code || null,
      diary_date: diary.diary_date,
      is_locked: diary.is_locked || 0
    };
  }

  async deleteDiaryItem(projectId, itemId) {
    const pId = Number(projectId);
    const iId = Number(itemId);
    if (!Number.isInteger(pId) || pId <= 0 || !Number.isInteger(iId) || iId <= 0) {
      const err = new Error('projectId hoặc itemId không hợp lệ');
      err.status = 400;
      throw err;
    }

    if (this.pool?.query) {
      const [rows] = await this.pool.query(
        `SELECT i.*, d.project_id, d.is_locked
         FROM site_diary_items i
         JOIN site_diaries d ON i.diary_id = d.id
         WHERE i.id = ? AND d.project_id = ? LIMIT 1`,
        [iId, pId]
      );
      if (!rows || rows.length === 0) {
        const err = new Error('Không tìm thấy mục nhật ký');
        err.status = 404;
        throw err;
      }
      if (rows[0].is_locked === 1) {
        const err = new Error('Nhật ký đã bị khóa sổ, không thể xóa mục.');
        err.status = 423;
        throw err;
      }
      await this.pool.query('DELETE FROM site_diary_items WHERE id = ?', [iId]);
      return true;
    }

    // In-memory
    const existing = inMemorySiteDiaryItems.find(i => Number(i.id) === iId);
    if (!existing) {
      const err = new Error('Không tìm thấy mục nhật ký');
      err.status = 404;
      throw err;
    }
    const diary = inMemorySiteDiaries.find(d => Number(d.id) === Number(existing.diary_id) && Number(d.project_id) === pId);
    if (!diary) {
      const err = new Error('Không tìm thấy mục nhật ký thuộc dự án');
      err.status = 404;
      throw err;
    }
    if (diary.is_locked === 1) {
      const err = new Error('Nhật ký đã bị khóa sổ, không thể xóa mục.');
      err.status = 423;
      throw err;
    }
    return deleteSiteDiaryItem(iId);
  }

  async lockDiary(projectId, dateStr, userId = 1) {
    const pId = Number(projectId);
    if (this.pool?.query) {
      await this.pool.query(
        'UPDATE site_diaries SET is_locked = 1, locked_at = CURRENT_TIMESTAMP, locked_by = ? WHERE project_id = ? AND diary_date = ?',
        [userId, pId, dateStr]
      );
    } else {
      lockSiteDiary(pId, dateStr, userId);
    }
    return { success: true, message: `Đã khóa sổ nhật ký ngày ${dateStr}` };
  }

  /**
   * ==============================================================
   * S-32: PHÁT HIỆN XUNG ĐỘT HAI NGƯỜI SỬA CÙNG MỤC VÀ GIỮ CẢ HAI BẢN (SCRUM-145)
   * NFR: Phát hiện bằng số phiên bản của mục, tăng mỗi lần máy chủ ghi.
   * AC 1: Hai người cùng sửa một mục ngoại tuyến -> Đồng bộ: Bản đến sau KHÔNG GHI ĐÈ, lưu thành bản xung đột.
   * AC 2: Có bản xung đột -> Kỹ sư giám sát thấy cả hai bản cạnh nhau, chọn bản giữ, bản kia lưu trong lịch sử.
   * AC 3: Hai người sửa hai trường khác nhau -> Hệ thống gộp được (3-way merge) và không báo xung đột.
   * ==============================================================
   */

  async syncDiaryItem(projectId, syncData = {}, userId = 1) {
    const pId = Number(projectId);
    const itemId = Number(syncData.item_id || syncData.id);
    if (!Number.isInteger(pId) || pId <= 0 || !Number.isInteger(itemId) || itemId <= 0) {
      const err = new Error('projectId hoặc item_id không hợp lệ');
      err.status = 400;
      throw err;
    }

    const baseVersion = Number(syncData.base_version || 1);
    const deviceId = syncData.device_id ? String(syncData.device_id) : null;

    // Chuẩn hóa dữ liệu incoming
    const incomingData = {
      work_item_id: syncData.work_item_id !== undefined ? (syncData.work_item_id ? Number(syncData.work_item_id) : null) : undefined,
      work_content: syncData.work_content !== undefined ? String(syncData.work_content).trim() : undefined,
      log_time: syncData.log_time !== undefined ? (syncData.log_time ? String(syncData.log_time).trim() : null) : undefined,
      quantity_done: syncData.quantity_done !== undefined ? Number(syncData.quantity_done || 0) : undefined,
      unit: syncData.unit !== undefined ? String(syncData.unit || '').trim() : undefined
    };

    if (this.pool?.query) {
      const [itemRows] = await this.pool.query(
        `SELECT i.*, d.project_id, d.diary_date, d.is_locked, w.name as work_item_name, w.code as work_item_code
         FROM site_diary_items i
         JOIN site_diaries d ON i.diary_id = d.id
         LEFT JOIN work_items w ON i.work_item_id = w.id
         WHERE i.id = ? AND d.project_id = ? LIMIT 1`,
        [itemId, pId]
      );
      if (!itemRows || itemRows.length === 0) {
        const err = new Error('Không tìm thấy mục nhật ký trên máy chủ');
        err.status = 404;
        throw err;
      }
      const currentItem = itemRows[0];
      if (currentItem.is_locked === 1) {
        const err = new Error('Nhật ký đã bị khóa sổ, không thể đồng bộ chỉnh sửa.');
        err.status = 423;
        throw err;
      }

      const currentVersion = Number(currentItem.version || 1);

      // Trường hợp 1: Không có xung đột phiên bản (base_version >= currentVersion)
      if (baseVersion >= currentVersion) {
        const nextVersion = currentVersion + 1;
        const updates = ['version = ?', 'has_conflict = 0'];
        const params = [nextVersion];

        if (incomingData.work_item_id !== undefined) {
          updates.push('work_item_id = ?');
          params.push(incomingData.work_item_id);
        }
        if (incomingData.work_content !== undefined) {
          updates.push('work_content = ?');
          params.push(incomingData.work_content);
        }
        if (incomingData.log_time !== undefined) {
          updates.push('log_time = ?');
          params.push(incomingData.log_time);
        }
        if (incomingData.quantity_done !== undefined) {
          updates.push('quantity_done = ?');
          params.push(incomingData.quantity_done);
        }
        if (incomingData.unit !== undefined) {
          updates.push('unit = ?');
          params.push(incomingData.unit);
        }

        params.push(itemId);
        await this.pool.query(`UPDATE site_diary_items SET ${updates.join(', ')} WHERE id = ?`, params);

        // Lưu lịch sử
        await this.pool.query(
          `INSERT INTO site_diary_item_history (item_id, diary_id, version, work_item_id, work_content, log_time, quantity_done, unit, change_type, changed_by, change_summary)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'updated', ?, 'Đồng bộ trực tiếp phiên bản mới')`,
          [
            itemId,
            currentItem.diary_id,
            nextVersion,
            incomingData.work_item_id !== undefined ? incomingData.work_item_id : currentItem.work_item_id,
            incomingData.work_content !== undefined ? incomingData.work_content : currentItem.work_content,
            incomingData.log_time !== undefined ? incomingData.log_time : currentItem.log_time,
            incomingData.quantity_done !== undefined ? incomingData.quantity_done : currentItem.quantity_done,
            incomingData.unit !== undefined ? incomingData.unit : currentItem.unit,
            userId
          ]
        );

        const [freshRows] = await this.pool.query(
          `SELECT i.*, d.project_id, d.diary_date, d.is_locked, w.name as work_item_name, w.code as work_item_code
           FROM site_diary_items i
           JOIN site_diaries d ON i.diary_id = d.id
           LEFT JOIN work_items w ON i.work_item_id = w.id
           WHERE i.id = ?`,
          [itemId]
        );
        return {
          success: true,
          conflict: false,
          merged: false,
          message: 'Đồng bộ mục nhật ký thành công',
          item: freshRows[0]
        };
      }

      // Trường hợp 2: base_version < currentVersion -> Kiểm tra xung đột hoặc auto-merge (AC 1 & AC 3)
      let baseData = syncData.base_data || null;
      if (!baseData) {
        // Tìm trong bảng lịch sử phiên bản tương ứng baseVersion
        const [histRows] = await this.pool.query(
          `SELECT * FROM site_diary_item_history WHERE item_id = ? AND version = ? ORDER BY id DESC LIMIT 1`,
          [itemId, baseVersion]
        );
        if (histRows && histRows.length > 0) {
          baseData = histRows[0];
        }
      }

      const checkFields = ['work_content', 'log_time', 'quantity_done', 'unit', 'work_item_id'];
      const clientDiffs = {};
      const serverDiffs = {};
      const conflictedFields = [];

      for (const field of checkFields) {
        const clientVal = incomingData[field];
        const serverVal = currentItem[field];
        const baseVal = baseData ? baseData[field] : undefined;

        const isClientChanged = clientVal !== undefined && (baseVal !== undefined ? String(clientVal) !== String(baseVal) : String(clientVal) !== String(serverVal));
        const isServerChanged = baseVal !== undefined ? String(serverVal) !== String(baseVal) : true;

        if (isClientChanged) clientDiffs[field] = clientVal;
        if (isServerChanged) serverDiffs[field] = serverVal;

        // Nếu cả hai bên cùng sửa trường này và giá trị khác nhau -> XUNG ĐỘT
        if (isClientChanged && isServerChanged && String(clientVal) !== String(serverVal)) {
          conflictedFields.push(field);
        }
      }

      // AC 3: Giả sử hai người sửa hai trường khác nhau của cùng mục, khi đồng bộ, thì hệ thống gộp được và không báo xung đột
      if (conflictedFields.length === 0) {
        const nextVersion = currentVersion + 1;
        const mergedItemData = {
          work_item_id: clientDiffs.work_item_id !== undefined ? clientDiffs.work_item_id : currentItem.work_item_id,
          work_content: clientDiffs.work_content !== undefined ? clientDiffs.work_content : currentItem.work_content,
          log_time: clientDiffs.log_time !== undefined ? clientDiffs.log_time : currentItem.log_time,
          quantity_done: clientDiffs.quantity_done !== undefined ? clientDiffs.quantity_done : currentItem.quantity_done,
          unit: clientDiffs.unit !== undefined ? clientDiffs.unit : currentItem.unit
        };

        await this.pool.query(
          `UPDATE site_diary_items
           SET work_item_id = ?, work_content = ?, log_time = ?, quantity_done = ?, unit = ?, version = ?, has_conflict = 0
           WHERE id = ?`,
          [
            mergedItemData.work_item_id,
            mergedItemData.work_content,
            mergedItemData.log_time,
            mergedItemData.quantity_done,
            mergedItemData.unit,
            nextVersion,
            itemId
          ]
        );

        await this.pool.query(
          `INSERT INTO site_diary_item_history (item_id, diary_id, version, work_item_id, work_content, log_time, quantity_done, unit, change_type, changed_by, change_summary)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'auto_merged', ?, 'Tự động gộp 3-way không xung đột trường')`,
          [
            itemId,
            currentItem.diary_id,
            nextVersion,
            mergedItemData.work_item_id,
            mergedItemData.work_content,
            mergedItemData.log_time,
            mergedItemData.quantity_done,
            mergedItemData.unit,
            userId
          ]
        );

        const [freshRows] = await this.pool.query(
          `SELECT i.*, d.project_id, d.diary_date, d.is_locked, w.name as work_item_name, w.code as work_item_code
           FROM site_diary_items i
           JOIN site_diaries d ON i.diary_id = d.id
           LEFT JOIN work_items w ON i.work_item_id = w.id
           WHERE i.id = ?`,
          [itemId]
        );

        return {
          success: true,
          conflict: false,
          merged: true,
          message: 'Hệ thống đã tự động gộp các trường không trùng lặp thành công',
          item: freshRows[0]
        };
      }

      // AC 1: Giả sử hai người cùng sửa một mục khi ngoại tuyến, khi cả hai đồng bộ, thì bản đến sau không ghi đè mà được lưu thành bản xung đột
      await this.pool.query('UPDATE site_diary_items SET has_conflict = 1 WHERE id = ?', [itemId]);

      const clientVersionPayload = {
        work_item_id: incomingData.work_item_id !== undefined ? incomingData.work_item_id : currentItem.work_item_id,
        work_content: incomingData.work_content !== undefined ? incomingData.work_content : currentItem.work_content,
        log_time: incomingData.log_time !== undefined ? incomingData.log_time : currentItem.log_time,
        quantity_done: incomingData.quantity_done !== undefined ? incomingData.quantity_done : currentItem.quantity_done,
        unit: incomingData.unit !== undefined ? incomingData.unit : currentItem.unit
      };

      const serverVersionPayload = {
        work_item_id: currentItem.work_item_id,
        work_content: currentItem.work_content,
        log_time: currentItem.log_time,
        quantity_done: currentItem.quantity_done,
        unit: currentItem.unit
      };

      const [conflictRes] = await this.pool.query(
        `INSERT INTO site_diary_item_conflicts
         (item_id, diary_id, base_version, server_version, client_version_data, server_version_data, conflicted_fields, submitted_by, device_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          itemId,
          currentItem.diary_id,
          baseVersion,
          currentVersion,
          JSON.stringify(clientVersionPayload),
          JSON.stringify(serverVersionPayload),
          JSON.stringify(conflictedFields),
          userId,
          deviceId
        ]
      );

      return {
        success: false,
        conflict: true,
        merged: false,
        message: 'Phát hiện xung đột dữ liệu: hai người cùng sửa một mục khi ngoại tuyến. Bản đến sau được giữ lại an toàn.',
        conflict_id: conflictRes.insertId,
        server_version: currentVersion,
        base_version: baseVersion,
        current_server: serverVersionPayload,
        incoming: clientVersionPayload,
        conflicted_fields: conflictedFields
      };
    }

    // ==========================================
    // IN-MEMORY FALLBACK (STANDALONE / TEST)
    // ==========================================
    const currentItem = getSiteDiaryItemById(itemId);
    if (!currentItem) {
      const err = new Error('Không tìm thấy mục nhật ký trên máy chủ');
      err.status = 404;
      throw err;
    }

    const diary = inMemorySiteDiaries.find(d => Number(d.id) === Number(currentItem.diary_id) && Number(d.project_id) === pId);
    if (!diary) {
      const err = new Error('Không tìm thấy nhật ký thuộc dự án');
      err.status = 404;
      throw err;
    }
    if (diary.is_locked === 1) {
      const err = new Error('Nhật ký đã bị khóa sổ, không thể đồng bộ chỉnh sửa.');
      err.status = 423;
      throw err;
    }

    const currentVersion = Number(currentItem.version || 1);

    // Trường hợp 1: Không xung đột
    if (baseVersion >= currentVersion) {
      const updated = updateSiteDiaryItem(itemId, {
        ...incomingData,
        has_conflict: 0
      });

      saveSiteDiaryItemHistory({
        item_id: itemId,
        diary_id: currentItem.diary_id,
        version: updated.version,
        work_item_id: updated.work_item_id,
        work_content: updated.work_content,
        log_time: updated.log_time,
        quantity_done: updated.quantity_done,
        unit: updated.unit,
        change_type: 'updated',
        changed_by: userId,
        change_summary: 'Đồng bộ trực tiếp phiên bản mới'
      });

      const wi = inMemoryWorkItems.find(w => Number(w.id) === Number(updated.work_item_id));
      return {
        success: true,
        conflict: false,
        merged: false,
        message: 'Đồng bộ mục nhật ký thành công',
        item: {
          ...updated,
          work_item_name: wi?.name || null,
          work_item_code: wi?.code || null,
          diary_date: diary.diary_date
        }
      };
    }

    // Trường hợp 2: base_version < currentVersion -> Phân tích AC 1 & AC 3
    let baseData = syncData.base_data || null;
    if (!baseData) {
      const hist = getSiteDiaryItemHistory(itemId);
      const match = hist.find(h => Number(h.version) === baseVersion);
      if (match) baseData = match;
    }

    const checkFields = ['work_content', 'log_time', 'quantity_done', 'unit', 'work_item_id'];
    const clientDiffs = {};
    const serverDiffs = {};
    const conflictedFields = [];

    for (const field of checkFields) {
      const clientVal = incomingData[field];
      const serverVal = currentItem[field];
      const baseVal = baseData ? baseData[field] : undefined;

      const isClientChanged = clientVal !== undefined && (baseVal !== undefined ? String(clientVal) !== String(baseVal) : String(clientVal) !== String(serverVal));
      const isServerChanged = baseVal !== undefined ? String(serverVal) !== String(baseVal) : true;

      if (isClientChanged) clientDiffs[field] = clientVal;
      if (isServerChanged) serverDiffs[field] = serverVal;

      if (isClientChanged && isServerChanged && String(clientVal) !== String(serverVal)) {
        conflictedFields.push(field);
      }
    }

    // AC 3: Tự động gộp
    if (conflictedFields.length === 0) {
      const mergedFields = {
        work_item_id: clientDiffs.work_item_id !== undefined ? clientDiffs.work_item_id : currentItem.work_item_id,
        work_content: clientDiffs.work_content !== undefined ? clientDiffs.work_content : currentItem.work_content,
        log_time: clientDiffs.log_time !== undefined ? clientDiffs.log_time : currentItem.log_time,
        quantity_done: clientDiffs.quantity_done !== undefined ? clientDiffs.quantity_done : currentItem.quantity_done,
        unit: clientDiffs.unit !== undefined ? clientDiffs.unit : currentItem.unit,
        has_conflict: 0
      };

      const updated = updateSiteDiaryItem(itemId, mergedFields);

      saveSiteDiaryItemHistory({
        item_id: itemId,
        diary_id: currentItem.diary_id,
        version: updated.version,
        work_item_id: updated.work_item_id,
        work_content: updated.work_content,
        log_time: updated.log_time,
        quantity_done: updated.quantity_done,
        unit: updated.unit,
        change_type: 'auto_merged',
        changed_by: userId,
        change_summary: 'Tự động gộp 3-way không xung đột trường'
      });

      const wi = inMemoryWorkItems.find(w => Number(w.id) === Number(updated.work_item_id));
      return {
        success: true,
        conflict: false,
        merged: true,
        message: 'Hệ thống đã tự động gộp các trường không trùng lặp thành công',
        item: {
          ...updated,
          work_item_name: wi?.name || null,
          work_item_code: wi?.code || null,
          diary_date: diary.diary_date
        }
      };
    }

    // AC 1: Xung đột phát sinh -> Không ghi đè
    currentItem.has_conflict = 1;

    const clientVersionPayload = {
      work_item_id: incomingData.work_item_id !== undefined ? incomingData.work_item_id : currentItem.work_item_id,
      work_content: incomingData.work_content !== undefined ? incomingData.work_content : currentItem.work_content,
      log_time: incomingData.log_time !== undefined ? incomingData.log_time : currentItem.log_time,
      quantity_done: incomingData.quantity_done !== undefined ? incomingData.quantity_done : currentItem.quantity_done,
      unit: incomingData.unit !== undefined ? incomingData.unit : currentItem.unit
    };

    const serverVersionPayload = {
      work_item_id: currentItem.work_item_id,
      work_content: currentItem.work_content,
      log_time: currentItem.log_time,
      quantity_done: currentItem.quantity_done,
      unit: currentItem.unit
    };

    const conflict = saveSiteDiaryItemConflict({
      item_id: itemId,
      diary_id: currentItem.diary_id,
      base_version: baseVersion,
      server_version: currentVersion,
      client_version_data: clientVersionPayload,
      server_version_data: serverVersionPayload,
      conflicted_fields: conflictedFields,
      submitted_by: userId,
      device_id: deviceId,
      status: 'pending'
    });

    return {
      success: false,
      conflict: true,
      merged: false,
      message: 'Phát hiện xung đột dữ liệu: hai người cùng sửa một mục khi ngoại tuyến. Bản đến sau được giữ lại an toàn.',
      conflict_id: conflict.id,
      server_version: currentVersion,
      base_version: baseVersion,
      current_server: serverVersionPayload,
      incoming: clientVersionPayload,
      conflicted_fields: conflictedFields
    };
  }

  /**
   * AC 2: Lấy danh sách xung đột để kỹ sư giám sát xử lý
   */
  async getConflicts(projectId, { status = 'pending', itemId, diaryId } = {}) {
    const pId = Number(projectId);
    if (!Number.isInteger(pId) || pId <= 0) {
      const err = new Error('projectId không hợp lệ');
      err.status = 400;
      throw err;
    }

    if (this.pool?.query) {
      let query = `
        SELECT c.*, 
               d.diary_date, d.project_id,
               i.work_content as current_work_content,
               w.name as work_item_name, w.code as work_item_code
        FROM site_diary_item_conflicts c
        JOIN site_diaries d ON c.diary_id = d.id
        JOIN site_diary_items i ON c.item_id = i.id
        LEFT JOIN work_items w ON i.work_item_id = w.id
        WHERE d.project_id = ?
      `;
      const params = [pId];

      if (status) {
        query += ' AND c.status = ?';
        params.push(status);
      }
      if (itemId) {
        query += ' AND c.item_id = ?';
        params.push(Number(itemId));
      }
      if (diaryId) {
        query += ' AND c.diary_id = ?';
        params.push(Number(diaryId));
      }

      query += ' ORDER BY c.created_at DESC';
      const [rows] = await this.pool.query(query, params);
      return (rows || []).map(r => {
        if (typeof r.client_version_data === 'string') {
          try { r.client_version_data = JSON.parse(r.client_version_data); } catch (_) {}
        }
        if (typeof r.server_version_data === 'string') {
          try { r.server_version_data = JSON.parse(r.server_version_data); } catch (_) {}
        }
        if (typeof r.conflicted_fields === 'string') {
          try { r.conflicted_fields = JSON.parse(r.conflicted_fields); } catch (_) {}
        }
        if (r.diary_date instanceof Date) {
          const y = r.diary_date.getFullYear();
          const m = String(r.diary_date.getMonth() + 1).padStart(2, '0');
          const d = String(r.diary_date.getDate()).padStart(2, '0');
          r.diary_date = `${y}-${m}-${d}`;
        }
        return r;
      });
    }

    // In-memory
    const results = [];
    for (const c of inMemorySiteDiaryItemConflicts) {
      const d = inMemorySiteDiaries.find(x => Number(x.id) === Number(c.diary_id) && Number(x.project_id) === pId);
      if (!d) continue;

      if (status && c.status !== status) continue;
      if (itemId && Number(c.item_id) !== Number(itemId)) continue;
      if (diaryId && Number(c.diary_id) !== Number(diaryId)) continue;

      const item = getSiteDiaryItemById(c.item_id);
      const wi = inMemoryWorkItems.find(w => Number(w.id) === Number(item?.work_item_id));

      results.push({
        ...c,
        diary_date: d.diary_date,
        project_id: d.project_id,
        current_work_content: item?.work_content || '',
        work_item_name: wi?.name || null,
        work_item_code: wi?.code || null
      });
    }

    results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return results;
  }

  /**
   * AC 2: Kỹ sư giám sát chọn bản giữ, bản kia vẫn lưu trong lịch sử
   */
  async resolveConflict(projectId, conflictId, { choice } = {}, userId = 1) {
    const pId = Number(projectId);
    const cId = Number(conflictId);
    if (!Number.isInteger(pId) || pId <= 0 || !Number.isInteger(cId) || cId <= 0) {
      const err = new Error('projectId hoặc conflictId không hợp lệ');
      err.status = 400;
      throw err;
    }

    if (choice !== 'keep_server' && choice !== 'keep_incoming') {
      const err = new Error('Lựa chọn không hợp lệ. Vui lòng chọn "keep_server" hoặc "keep_incoming"');
      err.status = 400;
      throw err;
    }

    if (this.pool?.query) {
      const [cRows] = await this.pool.query(
        `SELECT c.*, d.project_id, d.is_locked
         FROM site_diary_item_conflicts c
         JOIN site_diaries d ON c.diary_id = d.id
         WHERE c.id = ? AND d.project_id = ? LIMIT 1`,
        [cId, pId]
      );
      if (!cRows || cRows.length === 0) {
        const err = new Error('Không tìm thấy bản ghi xung đột');
        err.status = 404;
        throw err;
      }
      const conflict = cRows[0];
      if (conflict.status === 'resolved') {
        const err = new Error('Xung đột này đã được giải quyết trước đó');
        err.status = 400;
        throw err;
      }

      const clientData = typeof conflict.client_version_data === 'string' ? JSON.parse(conflict.client_version_data) : conflict.client_version_data;
      const serverData = typeof conflict.server_version_data === 'string' ? JSON.parse(conflict.server_version_data) : conflict.server_version_data;

      const [itemRows] = await this.pool.query('SELECT * FROM site_diary_items WHERE id = ?', [conflict.item_id]);
      if (!itemRows || itemRows.length === 0) {
        const err = new Error('Mục nhật ký liên quan không còn tồn tại');
        err.status = 404;
        throw err;
      }
      const item = itemRows[0];
      const newVersion = (item.version || 1) + 1;

      if (choice === 'keep_server') {
        // Lưu bản incoming vào lịch sử (bản bị loại bỏ)
        await this.pool.query(
          `INSERT INTO site_diary_item_history (item_id, diary_id, version, work_item_id, work_content, log_time, quantity_done, unit, change_type, changed_by, change_summary)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'conflict_superseded', ?, 'Bản ngoại tuyến bị hủy do kỹ sư giám sát chọn giữ bản máy chủ')`,
          [
            conflict.item_id,
            conflict.diary_id,
            conflict.base_version,
            clientData.work_item_id,
            clientData.work_content,
            clientData.log_time,
            clientData.quantity_done,
            clientData.unit,
            userId
          ]
        );
      } else if (choice === 'keep_incoming') {
        // Lưu bản server cũ vào lịch sử
        await this.pool.query(
          `INSERT INTO site_diary_item_history (item_id, diary_id, version, work_item_id, work_content, log_time, quantity_done, unit, change_type, changed_by, change_summary)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'conflict_superseded', ?, 'Bản máy chủ cũ bị thay thế do kỹ sư giám sát chọn bản ngoại tuyến')`,
          [
            conflict.item_id,
            conflict.diary_id,
            item.version,
            item.work_item_id,
            item.work_content,
            item.log_time,
            item.quantity_done,
            item.unit,
            userId
          ]
        );

        // Cập nhật mục nhật ký thành bản incoming
        await this.pool.query(
          `UPDATE site_diary_items
           SET work_item_id = ?, work_content = ?, log_time = ?, quantity_done = ?, unit = ?, version = ?
           WHERE id = ?`,
          [
            clientData.work_item_id,
            clientData.work_content,
            clientData.log_time,
            clientData.quantity_done,
            clientData.unit,
            newVersion,
            conflict.item_id
          ]
        );

        // Lưu bản mới vào lịch sử
        await this.pool.query(
          `INSERT INTO site_diary_item_history (item_id, diary_id, version, work_item_id, work_content, log_time, quantity_done, unit, change_type, changed_by, change_summary)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'conflict_resolved', ?, 'Đã áp dụng bản ngoại tuyến theo quyết định của kỹ sư giám sát')`,
          [
            conflict.item_id,
            conflict.diary_id,
            newVersion,
            clientData.work_item_id,
            clientData.work_content,
            clientData.log_time,
            clientData.quantity_done,
            clientData.unit,
            userId
          ]
        );
      }

      // Đánh dấu conflict đã giải quyết
      await this.pool.query(
        `UPDATE site_diary_item_conflicts
         SET status = 'resolved', resolved_choice = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [choice, userId, cId]
      );

      // Kiểm tra nếu không còn pending conflict nào trên item thì reset has_conflict = 0
      const [remaining] = await this.pool.query(
        `SELECT COUNT(*) as count FROM site_diary_item_conflicts WHERE item_id = ? AND status = 'pending'`,
        [conflict.item_id]
      );
      if (!remaining[0] || remaining[0].count === 0) {
        await this.pool.query('UPDATE site_diary_items SET has_conflict = 0 WHERE id = ?', [conflict.item_id]);
      }

      const [freshRows] = await this.pool.query(
        `SELECT i.*, d.project_id, d.diary_date, d.is_locked, w.name as work_item_name, w.code as work_item_code
         FROM site_diary_items i
         JOIN site_diaries d ON i.diary_id = d.id
         LEFT JOIN work_items w ON i.work_item_id = w.id
         WHERE i.id = ?`,
        [conflict.item_id]
      );

      return {
        success: true,
        message: 'Đã giải quyết xung đột thành công',
        resolved_choice: choice,
        item: freshRows[0]
      };
    }

    // In-memory
    const conflict = getSiteDiaryItemConflictById(cId);
    if (!conflict) {
      const err = new Error('Không tìm thấy bản ghi xung đột');
      err.status = 404;
      throw err;
    }
    if (conflict.status === 'resolved') {
      const err = new Error('Xung đột này đã được giải quyết trước đó');
      err.status = 400;
      throw err;
    }

    const item = getSiteDiaryItemById(conflict.item_id);
    if (!item) {
      const err = new Error('Mục nhật ký liên quan không còn tồn tại');
      err.status = 404;
      throw err;
    }

    const clientData = conflict.client_version_data;

    if (choice === 'keep_server') {
      saveSiteDiaryItemHistory({
        item_id: conflict.item_id,
        diary_id: conflict.diary_id,
        version: conflict.base_version,
        work_item_id: clientData.work_item_id,
        work_content: clientData.work_content,
        log_time: clientData.log_time,
        quantity_done: clientData.quantity_done,
        unit: clientData.unit,
        change_type: 'conflict_superseded',
        changed_by: userId,
        change_summary: 'Bản ngoại tuyến bị hủy do kỹ sư giám sát chọn giữ bản máy chủ'
      });
    } else if (choice === 'keep_incoming') {
      saveSiteDiaryItemHistory({
        item_id: conflict.item_id,
        diary_id: conflict.diary_id,
        version: item.version,
        work_item_id: item.work_item_id,
        work_content: item.work_content,
        log_time: item.log_time,
        quantity_done: item.quantity_done,
        unit: item.unit,
        change_type: 'conflict_superseded',
        changed_by: userId,
        change_summary: 'Bản máy chủ cũ bị thay thế do kỹ sư giám sát chọn bản ngoại tuyến'
      });

      updateSiteDiaryItem(conflict.item_id, {
        work_item_id: clientData.work_item_id,
        work_content: clientData.work_content,
        log_time: clientData.log_time,
        quantity_done: clientData.quantity_done,
        unit: clientData.unit
      });

      saveSiteDiaryItemHistory({
        item_id: conflict.item_id,
        diary_id: conflict.diary_id,
        version: item.version,
        work_item_id: clientData.work_item_id,
        work_content: clientData.work_content,
        log_time: clientData.log_time,
        quantity_done: clientData.quantity_done,
        unit: clientData.unit,
        change_type: 'conflict_resolved',
        changed_by: userId,
        change_summary: 'Đã áp dụng bản ngoại tuyến theo quyết định của kỹ sư giám sát'
      });
    }

    updateSiteDiaryItemConflict(cId, {
      status: 'resolved',
      resolved_choice: choice,
      resolved_by: userId,
      resolved_at: new Date().toISOString()
    });

    // Kiểm tra còn pending không
    const remainingPending = inMemorySiteDiaryItemConflicts.some(
      c => Number(c.item_id) === Number(conflict.item_id) && c.status === 'pending'
    );
    if (!remainingPending) {
      item.has_conflict = 0;
    }

    const wi = inMemoryWorkItems.find(w => Number(w.id) === Number(item.work_item_id));
    return {
      success: true,
      message: 'Đã giải quyết xung đột thành công',
      resolved_choice: choice,
      item: {
        ...item,
        work_item_name: wi?.name || null,
        work_item_code: wi?.code || null
      }
    };
  }

  /**
   * AC 2: Lấy lịch sử các phiên bản của mục nhật ký (đảm bảo bản kia vẫn lưu trong lịch sử)
   */
  async getItemHistory(projectId, itemId) {
    const pId = Number(projectId);
    const iId = Number(itemId);
    if (!Number.isInteger(pId) || pId <= 0 || !Number.isInteger(iId) || iId <= 0) {
      const err = new Error('projectId hoặc itemId không hợp lệ');
      err.status = 400;
      throw err;
    }

    if (this.pool?.query) {
      const [rows] = await this.pool.query(
        `SELECT h.*, u.full_name as changed_by_name, w.name as work_item_name, w.code as work_item_code
         FROM site_diary_item_history h
         JOIN site_diaries d ON h.diary_id = d.id
         LEFT JOIN users u ON h.changed_by = u.id
         LEFT JOIN work_items w ON h.work_item_id = w.id
         WHERE h.item_id = ? AND d.project_id = ?
         ORDER BY h.version DESC, h.created_at DESC`,
        [iId, pId]
      );
      return rows || [];
    }

    // In-memory
    const item = getSiteDiaryItemById(iId);
    if (!item) return [];

    const history = getSiteDiaryItemHistory(iId);
    return history.map(h => {
      const wi = inMemoryWorkItems.find(w => Number(w.id) === Number(h.work_item_id));
      return {
        ...h,
        changed_by_name: h.changed_by === 2 ? 'Trần Mạnh Dũng (Chỉ huy trưởng)' : 'Kỹ sư giám sát',
        work_item_name: wi?.name || null,
        work_item_code: wi?.code || null
      };
    });
  }
}

module.exports = { DiaryService, DAY_NAMES, getMonday, addDays, isValidDateString };
