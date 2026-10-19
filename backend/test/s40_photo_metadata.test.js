const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { parseExifMetadata, formatExifDate } = require('../src/utils/exifParser');
const diaryRoutes = require('../src/routes/diaryRoutes');
const {
  createSession,
  inMemoryUsers,
  inMemorySiteDiaries,
  inMemorySiteDiaryPhotos,
  saveSiteDiaryEntry
} = require('../src/models/store');
const { authenticate } = require('../src/utils/rbac');

/**
 * Tạo buffer JPEG nhị phân chuẩn có cấu trúc EXIF (APP1 0xFFE1)
 * Chứa DateTimeOriginal và toạ độ GPS
 */
function createSyntheticExifJpeg({
  dateStr = '2026:10:16 14:30:25',
  lat = 21.028511, // 21 độ 1 phút 42.64 giây Bắc
  lon = 105.854222 // 105 độ 51 phút 15.20 giây Đông
} = {}) {
  // SOI Marker
  const soi = Buffer.from([0xFF, 0xD8]);

  // Exif Header: "Exif\0\0"
  const exifHeader = Buffer.from('Exif\0\0', 'ascii');

  // TIFF Header: 'II' (Little Endian), 42, offset IFD0 = 8
  const tiffHeader = Buffer.alloc(8);
  tiffHeader.write('II', 0, 2, 'ascii');
  tiffHeader.writeUInt16LE(42, 2);
  tiffHeader.writeUInt32LE(8, 4);

  // IFD0 entries count = 3: Make, ExifSubIFD pointer, GPSInfo pointer
  const ifd0 = Buffer.alloc(2 + 12 * 3 + 4);
  let pos = 0;
  ifd0.writeUInt16LE(3, pos); pos += 2;

  // Entry 1: Make (0x010F), ASCII, count 6 -> offset 122
  ifd0.writeUInt16LE(0x010F, pos); pos += 2;
  ifd0.writeUInt16LE(2, pos); pos += 2; // ASCII
  ifd0.writeUInt32LE(6, pos); pos += 4;
  ifd0.writeUInt32LE(122, pos); pos += 4;

  // Entry 2: ExifSubIFD (0x8769), LONG, count 1 -> offset 50
  ifd0.writeUInt16LE(0x8769, pos); pos += 2;
  ifd0.writeUInt16LE(4, pos); pos += 2;
  ifd0.writeUInt32LE(1, pos); pos += 4;
  ifd0.writeUInt32LE(50, pos); pos += 4; // ExifSubIFD at offset 50

  // Entry 3: GPSInfo (0x8825), LONG, count 1 -> offset 68
  ifd0.writeUInt16LE(0x8825, pos); pos += 2;
  ifd0.writeUInt16LE(4, pos); pos += 2;
  ifd0.writeUInt32LE(1, pos); pos += 4;
  ifd0.writeUInt32LE(68, pos); pos += 4; // GPSInfo at offset 68

  // Next IFD = 0
  ifd0.writeUInt32LE(0, pos); pos += 4;

  // ExifSubIFD: count = 1: DateTimeOriginal (0x9003) -> size 18 bytes
  const exifSub = Buffer.alloc(2 + 12 * 1 + 4);
  pos = 0;
  exifSub.writeUInt16LE(1, pos); pos += 2;
  exifSub.writeUInt16LE(0x9003, pos); pos += 2; // DateTimeOriginal
  exifSub.writeUInt16LE(2, pos); pos += 2; // ASCII
  exifSub.writeUInt32LE(20, pos); pos += 4; // length 20
  exifSub.writeUInt32LE(128, pos); pos += 4; // located at offset 128
  exifSub.writeUInt32LE(0, pos); pos += 4;

  // GPS IFD: count = 4: LatRef(0x0001), Lat(0x0002), LonRef(0x0003), Lon(0x0004) -> size 54 bytes
  const gpsIfd = Buffer.alloc(2 + 12 * 4 + 4);
  pos = 0;
  gpsIfd.writeUInt16LE(4, pos); pos += 2;

  // GPSLatRef 'N'
  gpsIfd.writeUInt16LE(0x0001, pos); pos += 2;
  gpsIfd.writeUInt16LE(2, pos); pos += 2;
  gpsIfd.writeUInt32LE(2, pos); pos += 4;
  gpsIfd.write('N\0', pos, 2, 'ascii'); pos += 4;

  // GPSLatitude (3 RATIONALs = 24 bytes at offset 148)
  gpsIfd.writeUInt16LE(0x0002, pos); pos += 2;
  gpsIfd.writeUInt16LE(5, pos); pos += 2; // RATIONAL
  gpsIfd.writeUInt32LE(3, pos); pos += 4;
  gpsIfd.writeUInt32LE(148, pos); pos += 4;

  // GPSLonRef 'E'
  gpsIfd.writeUInt16LE(0x0003, pos); pos += 2;
  gpsIfd.writeUInt16LE(2, pos); pos += 2;
  gpsIfd.writeUInt32LE(2, pos); pos += 4;
  gpsIfd.write('E\0', pos, 2, 'ascii'); pos += 4;

  // GPSLongitude (3 RATIONALs = 24 bytes at offset 172)
  gpsIfd.writeUInt16LE(0x0004, pos); pos += 2;
  gpsIfd.writeUInt16LE(5, pos); pos += 2; // RATIONAL
  gpsIfd.writeUInt32LE(3, pos); pos += 4;
  gpsIfd.writeUInt32LE(172, pos); pos += 4;

  gpsIfd.writeUInt32LE(0, pos); pos += 4;

  // Values block (strings & rationals) starting at offset 122
  const values = Buffer.alloc(128);
  // at 122 - 122 = 0
  values.write('Canon\0', 0, 'ascii');
  // at 128 - 122 = 6
  values.write(dateStr + '\0', 6, 'ascii');

  // Lat rationals: 21/1, 1/1, 4264/100 at 148 - 122 = 26
  const latPos = 26;
  values.writeUInt32LE(21, latPos); values.writeUInt32LE(1, latPos + 4);
  values.writeUInt32LE(1, latPos + 8); values.writeUInt32LE(1, latPos + 12);
  values.writeUInt32LE(4264, latPos + 16); values.writeUInt32LE(100, latPos + 20);

  // Lon rationals: 105/1, 51/1, 1520/100 at 172 - 122 = 50
  const lonPos = 50;
  values.writeUInt32LE(105, lonPos); values.writeUInt32LE(1, lonPos + 4);
  values.writeUInt32LE(51, lonPos + 8); values.writeUInt32LE(1, lonPos + 12);
  values.writeUInt32LE(1520, lonPos + 16); values.writeUInt32LE(100, lonPos + 20);

  // Ghép toàn bộ payload TIFF
  const tiffPayload = Buffer.concat([tiffHeader, ifd0, exifSub, gpsIfd, values]);

  // APP1 Marker
  const app1Length = 2 + exifHeader.length + tiffPayload.length;
  const app1Marker = Buffer.alloc(4);
  app1Marker.writeUInt16BE(0xFFE1, 0);
  app1Marker.writeUInt16BE(app1Length, 2);

  // EOI Marker
  const eoi = Buffer.from([0xFF, 0xD9]);

  return Buffer.concat([soi, app1Marker, exifHeader, tiffPayload, eoi]);
}

/**
 * Tạo test app Express
 */
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  const mockDb = { isConnected: false, pool: null };
  app.use('/api', diaryRoutes(mockDb));
  return app;
}

const adminUser = inMemoryUsers.find(u => u.role_id === 1) || { id: 1, email: 'admin@thicong.vn', role_id: 1, role_name: 'admin' };
const adminToken = createSession(adminUser);

async function makeRequest(app, method, url, body = null, token = adminToken) {
  const server = app.listen(0);
  const port = server.address().port;
  const targetUrl = `http://localhost:${port}${url}`;

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(targetUrl, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null
    });
    const status = res.status;
    let data;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status, data };
  } finally {
    server.close();
  }
}

test('=== [S-40 / SCRUM-194..197] ẢNH LƯU KÈM THỜI ĐIỂM VÀ TOẠ ĐỘ GPS TỪ SIÊU DỮ LIỆU ===', async (t) => {
  const app = createTestApp();

  // Reset in-memory database
  inMemorySiteDiaries.length = 0;
  inMemorySiteDiaryPhotos.length = 0;

  await t.test('1. T-85 (SCRUM-194): Đọc thời điểm và toạ độ GPS chính xác từ ảnh gốc có EXIF', () => {
    const sampleJpeg = createSyntheticExifJpeg({
      dateStr: '2026:10:16 15:45:10',
      lat: 21.028511,
      lon: 105.854222
    });

    const meta = parseExifMetadata(sampleJpeg);
    assert.strictEqual(meta.has_metadata, true, 'Ảnh phải được đánh dấu là có siêu dữ liệu');
    assert.strictEqual(meta.taken_at, '2026-10-16 15:45:10', 'Thời điểm chụp phải được chuẩn hóa sang định dạng chuẩn YYYY-MM-DD HH:MM:SS');
    assert.ok(Math.abs(meta.latitude - 21.028511) < 0.0001, `Vĩ độ phải xấp xỉ 21.0285, thực tế: ${meta.latitude}`);
    assert.ok(Math.abs(meta.longitude - 105.854222) < 0.0001, `Kinh độ phải xấp xỉ 105.8542, thực tế: ${meta.longitude}`);
    assert.strictEqual(meta.camera_make, 'Canon', 'Nhãn hiệu camera phải đọc đúng');
  });

  await t.test('2. T-85 (SCRUM-194) & AC 3: Ảnh không có EXIF metadata thì ghi nhận rõ là không có', () => {
    // Ảnh 1x1 pixel không có khối APP1
    const plainJpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xDB, 0x00, 0x43, 0x00, 0xFF, 0xD9]);
    const meta = parseExifMetadata(plainJpeg);

    assert.strictEqual(meta.has_metadata, false, 'Ảnh không có EXIF phải trả về has_metadata = false');
    assert.strictEqual(meta.taken_at, null);
    assert.strictEqual(meta.latitude, null);
    assert.strictEqual(meta.longitude, null);
  });

  await t.test('3. T-86 (SCRUM-195) & T-87 (SCRUM-196): Lưu metadata và liên kết với ảnh đã tải lên qua API hàng đợi S-33', async () => {
    const diaryDate = '2026-10-16';
    saveSiteDiaryEntry({
      project_id: 1,
      diary_date: diaryDate,
      weather: 'sunny',
      created_by: 1
    });

    const clientPhotoId = 'photo_s40_client_001';
    const sampleJpeg = createSyntheticExifJpeg({
      dateStr: '2026:10:16 09:15:30'
    });

    const { status, data } = await makeRequest(app, 'POST', `/api/projects/1/diaries/${diaryDate}/photos/upload-single`, {
      client_photo_id: clientPhotoId,
      file_name: 'hien_truong_mong_cau.jpg',
      file_size: sampleJpeg.length,
      mime_type: 'image/jpeg',
      caption: 'Thi công hố móng trụ T1 sáng 16/10',
      buffer: sampleJpeg.toString('base64')
    });

    assert.strictEqual(status, 200);
    assert.strictEqual(data.success, true);
    assert.ok(data.photo, 'Phải trả về thông tin ảnh đã tải');
    assert.strictEqual(data.photo.has_metadata, true);
    assert.strictEqual(data.photo.taken_at, '2026-10-16 09:15:30');
    assert.ok(Math.abs(data.photo.latitude - 21.028511) < 0.001);
    assert.ok(Math.abs(data.photo.longitude - 105.854222) < 0.001);
    assert.strictEqual(data.photo.metadata_status_text, 'Đã có siêu dữ liệu');
  });

  await t.test('4. T-87 (SCRUM-196): API trả về đầy đủ metadata khi xem nhật ký ngày', async () => {
    const { status, data } = await makeRequest(app, 'GET', '/api/projects/1/diaries/2026-10-16');
    assert.strictEqual(status, 200);
    const diary = data.data || data;
    assert.ok(Array.isArray(diary.photos));
    const photo = diary.photos.find(p => p.client_photo_id === 'photo_s40_client_001');
    assert.ok(photo, 'Phải tìm thấy ảnh trong danh sách');
    assert.strictEqual(photo.has_metadata, true);
    assert.strictEqual(photo.taken_at, '2026-10-16 09:15:30');
    assert.ok(photo.latitude > 0);
    assert.ok(photo.longitude > 0);
  });

  await t.test('5. T-88 (SCRUM-197): Ảnh chụp không có GPS/EXIF khi tải lên hiển thị rõ ràng là không có', async () => {
    const plainBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
    const { status, data } = await makeRequest(app, 'POST', '/api/projects/1/diaries/2026-10-16/photos/upload-single', {
      client_photo_id: 'photo_no_exif_002',
      file_name: 'screenshot_bao_cao.jpg',
      file_size: 1024,
      mime_type: 'image/jpeg',
      caption: 'Ảnh chụp màn hình không có GPS',
      buffer: plainBase64
    });

    assert.strictEqual(status, 200);
    assert.strictEqual(data.photo.has_metadata, false);
    assert.strictEqual(data.photo.taken_at, null);
    assert.strictEqual(data.photo.latitude, null);
    assert.strictEqual(data.photo.metadata_status_text, 'Không có siêu dữ liệu (không có GPS/thời gian chụp)');
  });
});
