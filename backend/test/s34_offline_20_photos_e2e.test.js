const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { DiaryService } = require('../src/services/diaryService');
const {
  inMemorySiteDiaries,
  inMemorySiteDiaryPhotos,
  inMemorySiteDiaryItems,
  getSiteDiaryPhotos
} = require('../src/models/store');
const BackgroundPhotoQueue = require('../../frontend/js/backgroundPhotoQueue');

/**
 * ============================================================================
 * [S-34 / SCRUM-147] BẢN NGẮT MẠNG GHI 20 MỤC RỒI KẾT NỐI LẠI CHẠY TỰ ĐỘNG TRÊN CI
 * - T-63 (SCRUM-161): Tạo bản văn E2E offline với 20 ảnh đính kèm
 * - T-64 (SCRUM-162): Xác minh đủ dữ liệu và thử gửi vòng lặp
 * - T-65 (SCRUM-163): Chạy script trong CI dưới 3 phút (NFR: < 180 giây)
 * ============================================================================
 */
test('=== [S-34 / SCRUM-147] KỊCH BẢN E2E: NGẮT MẠNG GHI 20 ẢNH RỒI KẾT NỐI LẠI ===', async (t) => {
  const globalSuiteStart = performance.now();
  const projectId = 1;
  const testDate = '2026-10-25';
  const mockDb = { pool: null };
  const diaryService = new DiaryService(mockDb);

  // Dọn dẹp dữ liệu trước kiểm thử
  inMemorySiteDiaries.length = 0;
  inMemorySiteDiaryPhotos.length = 0;
  inMemorySiteDiaryItems.length = 0;
  BackgroundPhotoQueue.clearAll();

  // Khởi tạo trước một nhật ký ngày kiểm thử
  await diaryService.saveDiary(projectId, {
    diary_date: testDate,
    weather_condition: 'cloudy',
    manpower_count: 18,
    work_notes: 'Kiểm tra kịch bản ngắt mạng E2E ghi 20 ảnh (S-34)'
  }, 1);

  // Mock uploadHandler cho BackgroundPhotoQueue trong môi trường Node.js
  BackgroundPhotoQueue.uploadHandler = async (item) => {
    const fakeFile = {
      filename: `diary_${item.projectId}_${item.diaryDate}_${item.id}.jpg`,
      path: `/uploads/diaries/diary_${item.projectId}_${item.diaryDate}_${item.id}.jpg`,
      size: item.fileSize || 1024 * 200,
      mimetype: item.fileType || 'image/jpeg'
    };
    return diaryService.uploadSinglePhoto(item.projectId, item.diaryDate, fakeFile, {
      client_photo_id: item.id,
      caption: item.caption
    });
  };

  // ==========================================================================
  // PHẦN 1: T-63 (SCRUM-161) — TỰ ĐỘNG CHUYỂN NGOẠI TUYẾN & TẠO 20 MỤC ẢNH ĐÍNH KÈM
  // ==========================================================================
  await t.test('1. T-63 (SCRUM-161): Tự động chuyển trình duyệt ngoại tuyến, tạo 20 mục ảnh đính kèm rồi khôi phục mạng', async () => {
    // 1.1. Chuyển môi trường sang ngoại tuyến (Offline)
    BackgroundPhotoQueue.pause();
    assert.strictEqual(BackgroundPhotoQueue.isPaused(), true, 'Hàng đợi phải ở trạng thái tạm dừng an toàn khi mất sóng');

    // 1.2. Tạo 20 mục ảnh đính kèm hiện trường khi đang ngoại tuyến
    const offlinePhotos = Array.from({ length: 20 }, (_, i) => {
      const idx = String(i + 1).padStart(2, '0');
      return {
        id: `client_photo_offline_${idx}`,
        name: `hien_truong_offline_${idx}.jpg`,
        size: 1024 * (200 + i * 15),
        type: 'image/jpeg',
        caption: `Ảnh hiện trường vị trí móng #${idx} (chụp lúc mất sóng)`,
        dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
      };
    });

    assert.strictEqual(offlinePhotos.length, 20, 'Phải khởi tạo chính xác 20 mục ảnh đính kèm');

    // Đưa 20 ảnh vào hàng đợi offline
    const enqueued = await BackgroundPhotoQueue.enqueueBatch({
      projectId,
      diaryDate: testDate,
      photos: offlinePhotos
    });

    assert.strictEqual(enqueued.length, 20, 'Hàng đợi phải tiếp nhận đủ 20 ảnh');
    assert.strictEqual(BackgroundPhotoQueue.getPendingCount(), 20, 'Số ảnh chờ trong hàng đợi phải là 20');

    // Kiểm tra tính an toàn: Trong lúc mất sóng, không có ảnh nào được tải lên máy chủ
    const photosOnServerWhileOffline = getSiteDiaryPhotos(1);
    assert.strictEqual(photosOnServerWhileOffline.length, 0, 'Máy chủ tuyệt đối chưa nhận ảnh nào khi mạng đang ngắt');

    // 1.3. Khôi phục mạng (Online)
    BackgroundPhotoQueue.resume();
    assert.strictEqual(BackgroundPhotoQueue.isPaused(), false, 'Hàng đợi được kích hoạt tiếp tục sau khi có mạng');

    // Chờ hàng đợi xử lý nền xong toàn bộ 20 ảnh
    await BackgroundPhotoQueue.waitForAllProcessed(30000);

    // Kiểm tra hàng đợi sau khi đồng bộ
    const stats = BackgroundPhotoQueue.getStats();
    assert.strictEqual(stats.pending, 0, 'Không còn ảnh nào ở trạng thái pending');
    assert.strictEqual(stats.uploading, 0, 'Không còn ảnh nào đang uploading');
    assert.strictEqual(BackgroundPhotoQueue.getPendingCount(), 0, 'Hàng đợi phải rỗng sau khi hoàn tất đồng bộ');
  });

  // ==========================================================================
  // PHẦN 2: T-64 (SCRUM-162) — XÁC MINH ĐỦ DỮ LIỆU & THỬ GỬI VÒNG LẶP (IDEMPOTENCY)
  // ==========================================================================
  await t.test('2. T-64 (SCRUM-162): Máy chủ có đúng 20 mục, không trùng lặp; gửi một mã lặp vẫn chỉ có một bản sao', async () => {
    // 2.1. Xác minh dữ liệu trên máy chủ: Đúng 20 mục, không trùng lặp
    const diaryData = await diaryService.getDiaryByDate(projectId, testDate);
    assert.ok(diaryData, 'Phải truy vấn được nhật ký ngày');
    assert.strictEqual(diaryData.photos.length, 20, 'Máy chủ phải có ĐÚNG 20 MỤC ảnh');

    // Kiểm tra không có client_photo_id nào bị trùng lặp
    const clientIds = diaryData.photos.map(p => p.client_photo_id);
    const uniqueClientIds = new Set(clientIds);
    assert.strictEqual(uniqueClientIds.size, 20, 'Toàn bộ 20 client_photo_id trên máy chủ phải duy nhất, không trùng lặp');

    // Kiểm tra toàn bộ 20 ảnh đều ở trạng thái completed
    for (const photo of diaryData.photos) {
      assert.strictEqual(photo.upload_status, 'completed', `Ảnh ${photo.client_photo_id} phải có upload_status là completed`);
      assert.ok(photo.url && photo.url.startsWith('/uploads/diaries/'), `Ảnh ${photo.client_photo_id} phải có url hợp lệ`);
    }

    // 2.2. Kịch bản thử gửi vòng lặp / gửi lặp một mã (Duplicate Resend / Idempotency Test)
    // Giả sử ảnh thứ 5 (client_photo_offline_05) được gửi lại lần 2 do kết nối mạng chập chờn
    const duplicatePhotoPayload = {
      filename: 'diary_1_20261025_duplicate_attempt.jpg',
      path: '/uploads/diaries/diary_1_20261025_duplicate_attempt.jpg',
      size: 1024 * 250,
      mimetype: 'image/jpeg'
    };

    const duplicateRes = await diaryService.uploadSinglePhoto(projectId, testDate, duplicatePhotoPayload, {
      client_photo_id: 'client_photo_offline_05',
      caption: 'Ảnh hiện trường vị trí móng #05 (gửi lại lần 2 sau khi retry)'
    });

    assert.strictEqual(duplicateRes.success, true, 'Yêu cầu gửi lặp phải được tiếp nhận an toàn');
    assert.strictEqual(duplicateRes.photo.client_photo_id, 'client_photo_offline_05');

    // Kiểm tra lại dữ liệu trên máy chủ: Vẫn CHỈ CÓ 20 MỤC, KHÔNG BỊ TĂNG THÀNH 21!
    const diaryAfterDuplicate = await diaryService.getDiaryByDate(projectId, testDate);
    assert.strictEqual(diaryAfterDuplicate.photos.length, 20, 'Máy chủ VẪN CHỈ CÓ 20 MỤC sau khi gửi lại mã lặp');

    // Kiểm tra ảnh thứ 5 chỉ có duy nhất 1 bản ghi và được cập nhật caption
    const duplicateMatches = diaryAfterDuplicate.photos.filter(p => p.client_photo_id === 'client_photo_offline_05');
    assert.strictEqual(duplicateMatches.length, 1, 'Mã lặp client_photo_offline_05 CHỈ ĐƯỢC PHÉP CÓ ĐÚNG 1 BẢN SAO trên máy chủ');
    assert.strictEqual(duplicateMatches[0].caption, 'Ảnh hiện trường vị trí móng #05 (gửi lại lần 2 sau khi retry)');
  });

  // ==========================================================================
  // PHẦN 3: T-65 (SCRUM-163) — THEO DÕI THỜI GIAN & ĐÁP ỨNG NFR DƯỚI 3 PHÚT TRÊN CI
  // ==========================================================================
  await t.test('3. T-65 (SCRUM-163): Chạy script trong CI dưới 3 phút (NFR: < 180s)', async () => {
    const elapsedTotalMs = performance.now() - globalSuiteStart;
    const elapsedSeconds = (elapsedTotalMs / 1000).toFixed(3);
    const CI_NFR_LIMIT_MS = 180 * 1000; // 3 phút = 180,000 ms

    console.log('\n================================================================');
    console.log('⏱️ [BÁO CÁO THỜI GIAN CHẠY T-65 & NFR TRÊN CI]');
    console.log(`- Thời gian thực thi toàn bộ kịch bản E2E: ${elapsedSeconds} giây (${elapsedTotalMs.toFixed(1)} ms)`);
    console.log(`- Ngưỡng tối đa cho phép của NFR Story S-34: 180.000 giây (3 phút)`);
    console.log(`- Kết quả đánh giá: ${elapsedTotalMs < CI_NFR_LIMIT_MS ? '✅ ĐẠT YÊU CẦU NFR (PASS)' : '❌ VƯỢT QUÁ GIỚI HẠN (FAIL)'}`);
    console.log('================================================================\n');

    assert.ok(
      elapsedTotalMs < CI_NFR_LIMIT_MS,
      `Thời gian thực thi E2E (${elapsedSeconds}s) vượt quá giới hạn NFR của Story (180s)`
    );
  });

  // ==========================================================================
  // PHẦN 4: TỰ ĐỘNG KIỂM TRA TÍCH HỢP GIAO DIỆN DIARY.HTML & BROWSER QUEUE
  // ==========================================================================
  await t.test('4. T-63 / T-64 UI: Giao diện diary.html tích hợp đầy đủ hàng đợi ngắt mạng và chống trùng lặp', () => {
    const htmlPath = path.join(__dirname, '../../frontend/diary.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(html.includes('backgroundPhotoQueue.js'), 'diary.html phải nạp script backgroundPhotoQueue.js');
    assert.ok(html.includes('bg-upload-bar'), 'diary.html phải có thanh chỉ báo tiến trình tải nền');
    assert.ok(html.includes('enqueueBatch'), 'diary.html phải sử dụng enqueueBatch để đưa ảnh vào hàng đợi');
    assert.ok(html.includes('isOffline'), 'diary.html phải có cơ chế nhận diện ngoại tuyến để lưu tạm vào thiết bị');
  });
});
