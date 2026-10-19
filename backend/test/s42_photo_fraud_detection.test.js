const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { evaluatePhotoSuspicion, extractJpegDimensions } = require('../src/utils/exifParser');
const AcceptanceService = require('../src/services/acceptanceService');
const store = require('../src/models/store');

describe('S-42: Phát hiện ảnh thiếu siêu dữ liệu hoặc có dấu hiệu chụp lại màn hình (Sprint 7 / Epic E-07)', () => {
  let service;
  const mockProjectId = 99;
  let testSheet;

  beforeEach(() => {
    store.inMemoryAcceptanceSheets = store.inMemoryAcceptanceSheets.filter(s => s.project_id !== mockProjectId);
    store.inMemoryAcceptanceSheetPhotos = store.inMemoryAcceptanceSheetPhotos.filter(p => p.sheet_id !== 9999);

    testSheet = store.saveAcceptanceSheet({
      id: 9999,
      project_id: mockProjectId,
      sheet_code: 'NT-PHOTO-TEST',
      name: 'Phiếu kiểm tra ảnh chống gian lận',
      period_number: 1,
      from_date: '2026-10-01',
      to_date: '2026-10-15',
      status: 'draft'
    });

    service = new AcceptanceService(null);
  });

  test('AC 1: Ảnh thiếu hoàn toàn siêu dữ liệu máy ảnh bị đánh dấu nghi vấn (missing_camera_metadata)', () => {
    const evalResult = evaluatePhotoSuspicion({
      metadata: { has_metadata: false, make: null, model: null },
      fileName: 'hien_truong_thi_cong.jpg',
      inspectionDate: '2026-10-15'
    });

    assert.strictEqual(evalResult.is_suspicious, true);
    assert.ok(evalResult.suspicious_reasons.includes('missing_camera_metadata'));
    assert.strictEqual(evalResult.confidence_level, 'low');
  });

  test('AC 2: Phát hiện ảnh chụp lại màn hình điện thoại (screenshot_detected) qua tên file', () => {
    const evalResult = evaluatePhotoSuspicion({
      metadata: { has_metadata: false },
      fileName: 'Screenshot_20261015_120000.png',
      inspectionDate: '2026-10-15'
    });

    assert.strictEqual(evalResult.is_suspicious, true);
    assert.ok(evalResult.suspicious_reasons.includes('screenshot_detected'));
    assert.strictEqual(evalResult.confidence_level, 'high');
  });

  test('AC 2: Phát hiện ảnh chụp lại màn hình qua kích thước và tỷ lệ màn hình điện thoại', () => {
    // Độ phân giải điển hình của màn hình smartphone (1080 x 2400 tỷ lệ 20:9)
    const evalResult = evaluatePhotoSuspicion({
      metadata: { has_metadata: true, make: null, model: null },
      fileName: 'IMG_20261015.jpg',
      width: 1080,
      height: 2400,
      inspectionDate: '2026-10-15'
    });

    assert.strictEqual(evalResult.is_suspicious, true);
    assert.ok(evalResult.suspicious_reasons.includes('screenshot_detected'));
  });

  test('AC 3: Phát hiện ngày chụp cách xa ngày nghiệm thu > 30 ngày (taken_time_too_far)', () => {
    const evalResult = evaluatePhotoSuspicion({
      metadata: {
        has_metadata: true,
        make: 'Apple',
        model: 'iPhone 15',
        taken_at: '2026-06-01 10:00:00' // Cách ngày nghiệm thu hơn 4 tháng (> 30 ngày)
      },
      fileName: 'photo_old.jpg',
      inspectionDate: '2026-10-15'
    });

    assert.strictEqual(evalResult.is_suspicious, true);
    assert.ok(evalResult.suspicious_reasons.includes('taken_time_too_far'));
    assert.strictEqual(evalResult.confidence_level, 'medium');
  });

  test('Ảnh hợp lệ: Đầy đủ máy ảnh, toạ độ GPS và ngày chụp gần ngày nghiệm thu', () => {
    const evalResult = evaluatePhotoSuspicion({
      metadata: {
        has_metadata: true,
        make: 'Samsung',
        model: 'Galaxy S23',
        taken_at: '2026-10-14 09:30:00',
        latitude: 21.0285,
        longitude: 105.8542
      },
      fileName: 'thi_cong_mong_chuan.jpg',
      width: 4000,
      height: 3000,
      inspectionDate: '2026-10-15'
    });

    assert.strictEqual(evalResult.is_suspicious, false);
    assert.strictEqual(evalResult.suspicious_reasons.length, 0);
    assert.strictEqual(evalResult.confidence_level, 'none');
  });

  test('AcceptanceService.addPhotos lưu và trả về chi tiết chống gian lận ảnh cho phiếu nghiệm thu', async () => {
    const files = [
      {
        file_name: 'Screenshot_hien_truong.png',
        file_size: 450000,
        mime_type: 'image/png',
        width: 1170,
        height: 2532
      },
      {
        file_name: 'chup_chuan_gps.jpg',
        file_size: 2500000,
        mime_type: 'image/jpeg',
        taken_at: '2026-10-15 08:00:00',
        latitude: 21.0285,
        longitude: 105.8542,
        is_suspicious: false,
        confidence_level: 'none'
      }
    ];

    const result = await service.addPhotos(mockProjectId, testSheet.id, files);
    assert.ok(result.success);
    assert.strictEqual(result.data.length, 2);

    const suspiciousPhoto = result.data.find(p => p.file_name.includes('Screenshot'));
    assert.ok(suspiciousPhoto);
    assert.strictEqual(suspiciousPhoto.is_suspicious, true);
    assert.ok(suspiciousPhoto.suspicious_reasons.includes('screenshot_detected'));
    assert.strictEqual(suspiciousPhoto.confidence_level, 'high');

    const cleanPhoto = result.data.find(p => p.file_name.includes('chup_chuan_gps'));
    assert.ok(cleanPhoto);
    assert.strictEqual(cleanPhoto.is_suspicious, false);
    assert.strictEqual(cleanPhoto.confidence_level, 'none');
  });

  test('extractJpegDimensions trích xuất đúng kích thước từ JPEG header hợp lệ', () => {
    // Tạo buffer JPEG tối thiểu có SOF0 marker (0xFF, 0xC0)
    const validJpeg = Buffer.from([
      0xFF, 0xD8, // SOI
      0xFF, 0xC0, // SOF0
      0x00, 0x11, // length
      0x08,       // precision
      0x04, 0x38, // height = 1080
      0x07, 0x80, // width = 1920
      0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01
    ]);

    const dims = extractJpegDimensions(validJpeg);
    assert.ok(dims);
    assert.strictEqual(dims.height, 1080);
    assert.strictEqual(dims.width, 1920);
  });
});
