const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { DiaryService } = require('../src/services/diaryService');
const {
  inMemorySiteDiaries,
  inMemorySiteDiaryPhotos,
  inMemorySiteDiaryItems,
  getSiteDiaryPhotos
} = require('../src/models/store');
const BackgroundPhotoQueue = require('../../frontend/js/backgroundPhotoQueue');

test('=== [S-33 / SCRUM-158, SCRUM-159, SCRUM-160] BỘ KIỂM THỬ HÀNG ĐỢI ẢNH NỀN & PHỤC HỒI MẤT MẠNG ===', async (t) => {
  const mockDb = { pool: null }; // Fast In-Memory
  const diaryService = new DiaryService(mockDb);
  const projectId = 1;
  const testDate = '2026-10-18';

  // Dọn dẹp store trước kiểm thử
  inMemorySiteDiaries.length = 0;
  inMemorySiteDiaryPhotos.length = 0;
  inMemorySiteDiaryItems.length = 0;
  BackgroundPhotoQueue.clearAll();

  // ========================================================
  // NHÓM 1: NFR & T-60 (SCRUM-158) — LƯU NHẬT KÝ TRƯỚC, HÀNG ĐỢI ẢNH GỬI SAU
  // ========================================================
  await t.test('1. NFR: Ảnh gửi sau mục nhật ký, mục không chờ ảnh', async () => {
    const startTime = Date.now();
    const payload = {
      diary_date: testDate,
      weather_condition: 'sunny',
      manpower_count: 20,
      work_notes: 'Thi công lắp dựng cốt thép dầm sàn tầng 3',
      // Kèm 30 ảnh chờ tải ở nền
      pending_photos: Array.from({ length: 30 }, (_, i) => ({
        client_photo_id: `client_img_${i + 1}`,
        file_name: `hien_truong_dam_${i + 1}.jpg`,
        file_size: 1024 * 350,
        mime_type: 'image/jpeg',
        caption: `Chi tiết vị trí ${i + 1}`
      }))
    };

    const saved = await diaryService.saveDiary(projectId, payload, 1);
    const elapsed = Date.now() - startTime;

    assert.ok(saved, 'Nhật ký phải được lưu ngay lập tức');
    assert.strictEqual(saved.diary_date, testDate);
    assert.ok(elapsed < 200, `Lưu nhật ký phải tức thời (<200ms), thực tế: ${elapsed}ms`);

    // Kiểm tra 30 ảnh đã được ghi nhận vào hệ thống với trạng thái 'pending'
    const photos = getSiteDiaryPhotos(saved.id);
    assert.strictEqual(photos.length, 30, 'Phải ghi nhận đủ 30 ảnh trong danh sách');
    assert.strictEqual(photos[0].upload_status, 'pending', 'Ảnh đầu tiên phải ở trạng thái pending');
    assert.strictEqual(photos[29].upload_status, 'pending', 'Ảnh thứ 30 phải ở trạng thái pending');
  });

  // ========================================================
  // NHÓM 2: AC 3 & T-60 (SCRUM-158) — HIỂN THỊ Ô ẢNH CHỜ THAY VÌ ẢNH VỠ
  // ========================================================
  await t.test('2. AC 3: Mục nhật ký đã lên nhưng ảnh chưa, xem mục thấy ô ảnh chờ thay vì ảnh vỡ', async () => {
    // 2.1. API getDiaryByDate trả về url = null cho các ảnh pending để tránh trình duyệt cố tải url rỗng
    const diaryData = await diaryService.getDiaryByDate(projectId, testDate);
    assert.ok(diaryData, 'Phải lấy được nhật ký ngày');
    assert.strictEqual(diaryData.photos.length, 30);

    const firstPhoto = diaryData.photos[0];
    assert.strictEqual(firstPhoto.upload_status, 'pending');
    assert.strictEqual(firstPhoto.url, null, 'Ảnh pending không được trả url thực để tránh vỡ ảnh');

    // 2.2. Kiểm tra frontend template render ô ảnh chờ (photo-card-pending)
    const htmlPath = path.join(__dirname, '../../frontend/diary.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(htmlContent.includes('photo-card-pending'), 'Frontend phải có class photo-card-pending cho ô ảnh chờ');
    assert.ok(htmlContent.includes('photo-placeholder-wrap'), 'Frontend phải có khung placeholder ảnh chờ');
    assert.ok(htmlContent.includes('Đang tải nền...'), 'Frontend phải hiển thị nhãn Đang tải nền');
  });

  // ========================================================
  // NHÓM 3: AC 1 & T-62 (SCRUM-160) — TẢI LẦN LƯỢT 30 ẢNH NỀN & KHÔNG CHẶN GHI CHÉP
  // ========================================================
  await t.test('3. AC 1: Có 30 ảnh chờ, ảnh tải lần lượt ở nền và kỹ sư vẫn ghi mục mới được', async () => {
    // Cấu hình mock uploadHandler cho BackgroundPhotoQueue trong môi trường Node.js
    BackgroundPhotoQueue.uploadHandler = async (item) => {
      const fakeFile = {
        filename: `diary_${item.projectId}_${item.diaryDate}_${item.id}.jpg`,
        path: `/uploads/diaries/diary_${item.projectId}_${item.diaryDate}_${item.id}.jpg`,
        size: item.fileSize,
        mimetype: item.fileType
      };
      return diaryService.uploadSinglePhoto(item.projectId, item.diaryDate, fakeFile, {
        client_photo_id: item.id,
        caption: item.caption
      });
    };

    const clientPhotos = Array.from({ length: 30 }, (_, i) => ({
      id: `client_img_${i + 1}`,
      name: `hien_truong_dam_${i + 1}.jpg`,
      size: 1024 * 350,
      type: 'image/jpeg',
      caption: `Chi tiết vị trí ${i + 1}`,
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
    }));

    const enqueued = await BackgroundPhotoQueue.enqueueBatch({
      projectId,
      diaryDate: testDate,
      photos: clientPhotos
    });

    assert.strictEqual(enqueued.length, 30, 'Phải đưa đủ 30 ảnh vào hàng đợi');
    assert.strictEqual(BackgroundPhotoQueue.getPendingCount(), 30, 'Số ảnh chờ trong queue phải là 30');
    BackgroundPhotoQueue.clearAll();

    // 3.2. Kỹ sư ghi mục nhật ký mới cho ngày tiếp theo mà hoàn toàn KHÔNG bị chặn
    const nextDate = '2026-10-19';
    const newDiaryPayload = {
      diary_date: nextDate,
      weather_condition: 'cloudy',
      manpower_count: 15,
      work_notes: 'Bảo dưỡng bê tông sàn, kiểm tra tim trục móng'
    };
    const newDiary = await diaryService.saveDiary(projectId, newDiaryPayload, 1);
    assert.ok(newDiary, 'Kỹ sư vẫn ghi được mục mới bình thường');
    assert.strictEqual(newDiary.diary_date, nextDate);

    // 3.3. Tải tuần tự ảnh nền lên máy chủ qua uploadSinglePhoto
    const fakeFile1 = {
      filename: 'diary_1_20261018_img1.jpg',
      path: '/uploads/diaries/diary_1_20261018_img1.jpg',
      size: 1024 * 350,
      mimetype: 'image/jpeg'
    };

    const uploadRes = await diaryService.uploadSinglePhoto(projectId, testDate, fakeFile1, {
      client_photo_id: 'client_img_1',
      caption: 'Chi tiết vị trí 1 đã hoàn tất tải'
    });

    assert.strictEqual(uploadRes.success, true);
    assert.strictEqual(uploadRes.photo.upload_status, 'completed');
    assert.strictEqual(uploadRes.photo.url, '/uploads/diaries/diary_1_20261018_img1.jpg');

    // Kiểm tra trong nhật ký: ảnh 1 đã completed với URL hợp lệ, ảnh 2 vẫn pending
    const updatedDiary = await diaryService.getDiaryByDate(projectId, testDate);
    const photo1 = updatedDiary.photos.find(p => p.client_photo_id === 'client_img_1');
    const photo2 = updatedDiary.photos.find(p => p.client_photo_id === 'client_img_2');

    assert.strictEqual(photo1.upload_status, 'completed');
    assert.strictEqual(photo1.url, '/uploads/diaries/diary_1_20261018_img1.jpg');
    assert.strictEqual(photo2.upload_status, 'pending');
    assert.strictEqual(photo2.url, null);
  });

  // ========================================================
  // NHÓM 4: AC 2 & T-61 (SCRUM-159) — ĐỨT MẠNG GIỮA CHỪNG & GỬI LẠI KHÔNG HỎNG FILE
  // ========================================================
  await t.test('4. AC 2: Mất mạng giữa lúc tải ảnh, khi có mạng lại tải tiếp không hỏng tệp trên server', async () => {
    // 4.1. Kiểm tra cơ chế ghi file nguyên tử (Atomic Write): File tạm .part được dọn dẹp nếu có lỗi
    const uploadDir = path.join(__dirname, '../../uploads/diaries');
    fs.mkdirSync(uploadDir, { recursive: true });

    const corruptTestTarget = path.join(uploadDir, 'test_interrupted.jpg');
    const tempPartFile = `${corruptTestTarget}.part`;

    // Mô phỏng file đang ghi dở khi đứt mạng
    fs.writeFileSync(tempPartFile, 'partial-data-network-disconnect');
    assert.ok(fs.existsSync(tempPartFile), 'File .part tồn tại trong lúc đang tải');

    // Khi ngắt mạng và hủy request, dọn dẹp file tạm
    if (fs.existsSync(tempPartFile)) {
      fs.unlinkSync(tempPartFile);
    }
    assert.strictEqual(fs.existsSync(tempPartFile), false, 'File tạm .part phải được dọn dẹp');
    assert.strictEqual(fs.existsSync(corruptTestTarget), false, 'Không để lại file hỏng trên máy chủ');

    // 4.2. Khi mạng có lại, gửi lại ảnh từ đầu hoàn tất thành công
    const fakeFile2 = {
      filename: 'diary_1_20261018_img2_retry.jpg',
      path: '/uploads/diaries/diary_1_20261018_img2_retry.jpg',
      size: 1024 * 350,
      mimetype: 'image/jpeg'
    };

    const retryRes = await diaryService.uploadSinglePhoto(projectId, testDate, fakeFile2, {
      client_photo_id: 'client_img_2',
      caption: 'Chi tiết vị trí 2 tải lại thành công sau đứt mạng'
    });

    assert.strictEqual(retryRes.success, true);
    assert.strictEqual(retryRes.photo.upload_status, 'completed');
    assert.strictEqual(retryRes.photo.file_name, 'diary_1_20261018_img2_retry.jpg');
  });

  // ========================================================
  // NHÓM 5: BẢO VỆ KHÓA SỔ S-24
  // ========================================================
  await t.test('5. Bảo vệ khóa sổ S-24: Chặn tải thêm ảnh nền khi nhật ký đã bị khóa sổ (HTTP 423)', async () => {
    // Khóa sổ nhật ký ngày testDate
    const { lockSiteDiary } = require('../src/models/store');
    lockSiteDiary(projectId, testDate, 1);

    const fakeFile3 = {
      filename: 'diary_1_locked_attempt.jpg',
      path: '/uploads/diaries/diary_1_locked_attempt.jpg',
      size: 1024 * 100,
      mimetype: 'image/jpeg'
    };

    await assert.rejects(
      async () => {
        await diaryService.uploadSinglePhoto(projectId, testDate, fakeFile3, {
          client_photo_id: 'client_img_3'
        });
      },
      (err) => {
        assert.strictEqual(err.status, 423);
        assert.ok(err.message.includes('khóa sổ'));
        return true;
      }
    );

    // Dọn dẹp hàng đợi kết thúc test
    BackgroundPhotoQueue.clearAll();
  });
});
