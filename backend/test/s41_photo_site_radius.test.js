const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');
const acceptanceRoutes = require('../src/routes/acceptanceRoutes');
const projectRoutes = require('../src/routes/projectRoutes');
const {
  calculateHaversineDistance,
  evaluatePhotoSuspicion
} = require('../src/utils/exifParser');
const {
  createSession,
  inMemoryUsers,
  inMemoryProjects,
  addProjectMember,
  inMemoryAcceptanceSheets,
  inMemoryAcceptanceSheetPhotos,
  getProjectSiteLocation,
  updateProjectSiteLocation
} = require('../src/models/store');
const { authenticate } = require('../src/utils/rbac');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  const mockDb = { isConnected: false, pool: null };
  app.use('/api', acceptanceRoutes(mockDb));
  app.use('/api', projectRoutes(mockDb));
  return app;
}

// User tokens
const adminUser = inMemoryUsers.find(u => u.role_id === 1) || { id: 1, email: 'admin@thicong.vn', role_id: 1, role_name: 'admin' };
const pmUser = inMemoryUsers.find(u => u.role_id === 2) || { id: 2, email: 'pm@thicong.vn', role_id: 2, role_name: 'project_manager' };
const supervisorUser = { id: 30, email: 'supervisor_s41@thicong.vn', role_id: 3, role_name: 'site_manager' };
const viewerUser = inMemoryUsers.find(u => u.role_id === 7) || { id: 31, email: 'viewer_s41@thicong.vn', role_id: 7, role_name: 'viewer' };

addProjectMember({ projectId: 1, userId: adminUser.id, roleId: 1 });
addProjectMember({ projectId: 1, userId: pmUser.id, roleId: 2 });
addProjectMember({ projectId: 1, userId: supervisorUser.id, roleId: 3 });
addProjectMember({ projectId: 1, userId: viewerUser.id, roleId: 7 });

addProjectMember({ projectId: 2, userId: adminUser.id, roleId: 1 });
addProjectMember({ projectId: 2, userId: pmUser.id, roleId: 2 });

const adminToken = createSession(adminUser);
const pmToken = createSession(pmUser);
const supervisorToken = createSession(supervisorUser);
const viewerToken = createSession(viewerUser);

async function makeRequest(app, method, url, body = null, token = null) {
  const server = app.listen(0);
  const port = server.address().port;
  const targetUrl = `http://localhost:${port}${url}`;

  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

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

test('S-41 (SCRUM-170) — Ảnh chụp ngoài bán kính công trường bị đánh dấu nghi vấn', async (suite) => {
  const app = createTestApp();
  const projectId = 1;

  // Tọa độ tâm công trường mẫu: Trụ sở Công trình Dự án 1 (Hồ Hoàn Kiếm, Hà Nội)
  const siteCenterLat = 21.028511;
  const siteCenterLon = 105.854167;
  const siteRadiusMeters = 500; // 500 mét

  await suite.test('Migration: Xác thực file migration UP và DOWN của S-41', () => {
    const upSqlPath = path.resolve(__dirname, '../../migration_s41_photo_site_radius.sql');
    const downSqlPath = path.resolve(__dirname, '../../migration_s41_photo_site_radius_down.sql');

    assert.ok(fs.existsSync(upSqlPath), 'File migration UP phải tồn tại');
    assert.ok(fs.existsSync(downSqlPath), 'File migration DOWN phải tồn tại');

    const upContent = fs.readFileSync(upSqlPath, 'utf8');
    const downContent = fs.readFileSync(downSqlPath, 'utf8');

    assert.ok(upContent.includes('site_latitude'), 'UP migration phải thêm site_latitude');
    assert.ok(upContent.includes('site_longitude'), 'UP migration phải thêm site_longitude');
    assert.ok(upContent.includes('site_radius_meters'), 'UP migration phải thêm site_radius_meters');
    assert.ok(upContent.includes('distance_to_center_meters'), 'UP migration phải thêm distance_to_center_meters');

    assert.ok(downContent.includes('DROP COLUMN'), 'DOWN migration phải xóa các cột đã thêm');
  });

  await suite.test('AC 1: Dự án khai báo tọa độ tâm và bán kính công trường (API & Store)', async () => {
    // 1. Cập nhật cấu hình địa điểm công trường qua API PUT
    const updateRes = await makeRequest(
      app,
      'PUT',
      `/api/projects/${projectId}/site-location`,
      {
        site_latitude: siteCenterLat,
        site_longitude: siteCenterLon,
        site_radius_meters: siteRadiusMeters
      },
      pmToken
    );

    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.data.success, true);
    assert.equal(Number(updateRes.data.data.site_latitude), siteCenterLat);
    assert.equal(Number(updateRes.data.data.site_longitude), siteCenterLon);
    assert.equal(Number(updateRes.data.data.site_radius_meters), siteRadiusMeters);

    // 2. Lấy thông tin cấu hình qua API GET
    const getRes = await makeRequest(
      app,
      'GET',
      `/api/projects/${projectId}/site-location`,
      null,
      supervisorToken
    );

    assert.equal(getRes.status, 200);
    assert.equal(Number(getRes.data.data.site_latitude), siteCenterLat);
    assert.equal(Number(getRes.data.data.site_longitude), siteCenterLon);
    assert.equal(Number(getRes.data.data.site_radius_meters), siteRadiusMeters);

    // 3. Validation từ chối khi toạ độ hoặc bán kính không hợp lệ (400)
    const invalidLatRes = await makeRequest(
      app,
      'PUT',
      `/api/projects/${projectId}/site-location`,
      {
        site_latitude: 95.5, // > 90
        site_longitude: siteCenterLon,
        site_radius_meters: siteRadiusMeters
      },
      pmToken
    );
    assert.equal(invalidLatRes.status, 400);

    const invalidRadiusRes = await makeRequest(
      app,
      'PUT',
      `/api/projects/${projectId}/site-location`,
      {
        site_latitude: siteCenterLat,
        site_longitude: siteCenterLon,
        site_radius_meters: -50 // âm
      },
      pmToken
    );
    assert.equal(invalidRadiusRes.status, 400);
  });

  await suite.test('Công thức Haversine: Kiểm thử tính khoảng cách địa lý theo đáp án tính tay độc lập', () => {
    // Điểm A: 21.028511, 105.854167 (Tâm Hồ Gươm)
    // Điểm B: 21.017320, 105.784010 (Keangnam Landmark 72)
    // Đáp án tính tay độc lập: d ≈ 7387.6m
    const dist = calculateHaversineDistance(21.028511, 105.854167, 21.017320, 105.784010);
    assert.ok(dist !== null, 'Khoảng cách không được null');
    assert.ok(Math.abs(dist - 7387.6) < 1.0, `Khoảng cách tính được (${dist}m) phải khớp đáp án tính tay độc lập (~7387.6m)`);

    // Điểm trùng nhau: khoảng cách = 0
    const zeroDist = calculateHaversineDistance(21.028511, 105.854167, 21.028511, 105.854167);
    assert.equal(zeroDist, 0);

    // Tọa độ không hợp lệ trả về null
    assert.equal(calculateHaversineDistance(null, 105.0, 21.0, 105.0), null);
  });

  await suite.test('AC 2: Ảnh ở trong bán kính công trường KHÔNG bị đánh dấu ngoài bán kính', async () => {
    // Điểm nằm cách tâm công trường ~100 mét (vĩ độ lệch 0.0009 độ)
    const insideLat = 21.029410;
    const insideLon = 105.854167;

    const evaluation = evaluatePhotoSuspicion({
      metadata: {
        has_metadata: true,
        latitude: insideLat,
        longitude: insideLon,
        camera_make: 'Apple',
        camera_model: 'iPhone 15 Pro',
        taken_at: '2026-10-22T08:00:00.000Z'
      },
      fileName: 'anh_trong_ban_kinh.jpg',
      inspectionDate: '2026-10-22',
      projectLocation: {
        site_latitude: siteCenterLat,
        site_longitude: siteCenterLon,
        site_radius_meters: siteRadiusMeters
      }
    });

    assert.ok(evaluation.distance_to_center_meters < siteRadiusMeters, 'Khoảng cách phải nhỏ hơn bán kính');
    assert.ok(!evaluation.suspicious_reasons.includes('outside_site_radius'), 'Ảnh trong bán kính không được có cờ outside_site_radius');
  });

  await suite.test('AC 2: Ảnh ở ngoài bán kính công trường BỊ đánh dấu nghi vấn và ghi nhận khoảng cách', async () => {
    // Điểm tại Keangnam (cách ~7388 mét > 500 mét)
    const outsideLat = 21.017320;
    const outsideLon = 105.784010;

    const evaluation = evaluatePhotoSuspicion({
      metadata: {
        has_metadata: true,
        latitude: outsideLat,
        longitude: outsideLon,
        camera_make: 'Samsung',
        camera_model: 'Galaxy S24',
        taken_at: '2026-10-22T08:30:00.000Z'
      },
      fileName: 'anh_ngoai_ban_kinh.jpg',
      inspectionDate: '2026-10-22',
      projectLocation: {
        site_latitude: siteCenterLat,
        site_longitude: siteCenterLon,
        site_radius_meters: siteRadiusMeters
      }
    });

    assert.equal(evaluation.is_suspicious, true);
    assert.ok(evaluation.suspicious_reasons.includes('outside_site_radius'), 'Ảnh ngoài bán kính phải có cờ outside_site_radius');
    assert.equal(evaluation.confidence_level, 'high', 'Ảnh ngoài bán kính có độ tin cậy cảnh báo cao');
    assert.ok(evaluation.distance_to_center_meters > siteRadiusMeters);
    assert.ok(Math.abs(evaluation.distance_to_center_meters - 7387.6) < 2.0);
    assert.ok(evaluation.suspicious_details.includes('vượt quá bán kính cho phép'));
  });

  await suite.test('Kiểm tra tại ranh giới bán kính: d <= R là trong bán kính; d > R là ngoài bán kính', () => {
    const projectLoc = {
      site_latitude: siteCenterLat,
      site_longitude: siteCenterLon,
      site_radius_meters: 500
    };

    // Điểm A: cách tâm 499m (d <= R) -> KHÔNG bị đánh dấu
    // Điểm B: cách tâm 501m (d > R) -> BỊ đánh dấu
    const boundaryInsideLat = siteCenterLat + (499.0 / 111195);
    const evalInside = evaluatePhotoSuspicion({
      metadata: { has_metadata: true, latitude: boundaryInsideLat, longitude: siteCenterLon, camera_make: 'Sony', camera_model: 'A7', taken_at: '2026-10-22T08:00:00.000Z' },
      fileName: 'bien_trong.jpg',
      inspectionDate: '2026-10-22',
      projectLocation: projectLoc
    });
    assert.ok(!evalInside.suspicious_reasons.includes('outside_site_radius'), 'Điểm d <= R không được đánh dấu ngoài bán kính');

    const boundaryOutsideLat = siteCenterLat + (501.0 / 111195);
    const evalOutside = evaluatePhotoSuspicion({
      metadata: { has_metadata: true, latitude: boundaryOutsideLat, longitude: siteCenterLon, camera_make: 'Sony', camera_model: 'A7', taken_at: '2026-10-22T08:00:00.000Z' },
      fileName: 'bien_ngoai.jpg',
      inspectionDate: '2026-10-22',
      projectLocation: projectLoc
    });
    assert.ok(evalOutside.suspicious_reasons.includes('outside_site_radius'), 'Điểm d > R phải bị đánh dấu ngoài bán kính');
  });

  await suite.test('Thiếu tọa độ GPS và cấu hình dự án chưa khai báo không bị đánh dấu nhầm', () => {
    const projectLoc = {
      site_latitude: siteCenterLat,
      site_longitude: siteCenterLon,
      site_radius_meters: siteRadiusMeters
    };

    // 1. Ảnh thiếu GPS: Không bị coi là ngoài bán kính
    const noGpsEval = evaluatePhotoSuspicion({
      metadata: {
        has_metadata: false,
        latitude: null,
        longitude: null,
        taken_at: '2026-10-22T08:00:00.000Z'
      },
      fileName: 'anh_khong_gps.jpg',
      inspectionDate: '2026-10-22',
      projectLocation: projectLoc
    });
    assert.ok(!noGpsEval.suspicious_reasons.includes('outside_site_radius'), 'Ảnh thiếu GPS không được coi là ngoài bán kính');
    assert.equal(noGpsEval.distance_to_center_meters, null);

    // 2. Dự án chưa cấu hình toạ độ tâm (null): Ảnh có GPS không bị đánh dấu ngoài bán kính
    const unconfiguredLoc = {
      site_latitude: null,
      site_longitude: null,
      site_radius_meters: null
    };
    const unconfiguredEval = evaluatePhotoSuspicion({
      metadata: {
        has_metadata: true,
        latitude: 21.017320,
        longitude: 105.784010,
        camera_make: 'Apple',
        camera_model: 'iPhone 15',
        taken_at: '2026-10-22T08:00:00.000Z'
      },
      fileName: 'anh_co_gps.jpg',
      inspectionDate: '2026-10-22',
      projectLocation: unconfiguredLoc
    });
    assert.ok(!unconfiguredEval.suspicious_reasons.includes('outside_site_radius'), 'Dự án chưa cấu hình toạ độ không được đánh dấu ngoài bán kính');
    assert.equal(unconfiguredEval.distance_to_center_meters, null);
  });

  await suite.test('Không lẫn cấu hình tọa độ giữa hai dự án khác nhau', async () => {
    // Dự án 2: Công trình tại TP. Hồ Chí Minh (Nhà thờ Đức Bà: 10.779784, 106.699017, R = 1000m)
    updateProjectSiteLocation(2, {
      site_latitude: 10.779784,
      site_longitude: 106.699017,
      site_radius_meters: 1000
    });

    const locProj1 = getProjectSiteLocation(1);
    const locProj2 = getProjectSiteLocation(2);

    assert.equal(locProj1.site_latitude, siteCenterLat);
    assert.equal(locProj2.site_latitude, 10.779784);

    // Ảnh chụp tại Hà Nội:
    // Thuộc Dự án 1 (Hà Nội): Trong bán kính
    const evalProj1 = evaluatePhotoSuspicion({
      metadata: { has_metadata: true, latitude: siteCenterLat, longitude: siteCenterLon, camera_make: 'Apple', camera_model: 'iPhone 15', taken_at: '2026-10-22T08:00:00.000Z' },
      fileName: 'hanoi.jpg',
      inspectionDate: '2026-10-22',
      projectLocation: locProj1
    });
    assert.ok(!evalProj1.suspicious_reasons.includes('outside_site_radius'));

    // Cùng ảnh đó nếu nộp vào Dự án 2 (TP.HCM): Ngoài bán kính (> 1000km)
    const evalProj2 = evaluatePhotoSuspicion({
      metadata: { has_metadata: true, latitude: siteCenterLat, longitude: siteCenterLon, camera_make: 'Apple', camera_model: 'iPhone 15', taken_at: '2026-10-22T08:00:00.000Z' },
      fileName: 'hanoi.jpg',
      inspectionDate: '2026-10-22',
      projectLocation: locProj2
    });
    assert.ok(evalProj2.suspicious_reasons.includes('outside_site_radius'));
    assert.ok(evalProj2.distance_to_center_meters > 1000000, 'Khoảng cách giữa HN và HCM phải > 1000km');
  });

  await suite.test('AC 3: Người duyệt phiếu nhìn thấy dấu nghi vấn và khoảng cách trong phiếu nghiệm thu (E2E API)', async () => {
    // 1. Tạo phiếu nghiệm thu
    const createSheetRes = await makeRequest(
      app,
      'POST',
      `/api/projects/${projectId}/acceptance-sheets`,
      {
        sheet_code: 'NT-S41-PHOTO-01',
        title: 'Phiếu kiểm tra ảnh ngoài bán kính S41',
        period_number: 201,
        cutoff_date: '2026-10-22',
        items: []
      },
      supervisorToken
    );
    assert.equal(createSheetRes.status, 201);
    const sheetId = createSheetRes.data.data.id;

    // 2. Upload/Đính kèm 2 ảnh:
    // - Ảnh 1: Trong bán kính (Hồ Gươm)
    // - Ảnh 2: Ngoài bán kính (Keangnam Landmark)
    const attachRes = await makeRequest(
      app,
      'POST',
      `/api/projects/${projectId}/acceptance-sheets/${sheetId}/photos`,
      {
        photos: [
          {
            file_name: 'inside_site_photo.jpg',
            caption: 'Ảnh hiện trường hố móng khu A',
            has_metadata: true,
            latitude: siteCenterLat,
            longitude: siteCenterLon,
            camera_make: 'Apple',
            camera_model: 'iPhone 15 Pro',
            taken_at: '2026-10-22T09:00:00.000Z'
          },
          {
            file_name: 'outside_site_photo.jpg',
            caption: 'Ảnh chụp tại Keangnam ngoài bán kính',
            has_metadata: true,
            latitude: 21.017320,
            longitude: 105.784010,
            camera_make: 'Samsung',
            camera_model: 'Galaxy S24',
            taken_at: '2026-10-22T09:15:00.000Z'
          }
        ]
      },
      supervisorToken
    );

    assert.equal(attachRes.status, 201);
    assert.equal(attachRes.data.success, true);

    // 3. Người duyệt (PM) xem chi tiết phiếu nghiệm thu
    const viewSheetRes = await makeRequest(
      app,
      'GET',
      `/api/projects/${projectId}/acceptance-sheets/${sheetId}`,
      null,
      pmToken
    );

    assert.equal(viewSheetRes.status, 200);
    const photos = viewSheetRes.data.data.photos;
    assert.equal(photos.length, 2);

    const insidePhoto = photos.find(p => p.file_name === 'inside_site_photo.jpg');
    assert.ok(insidePhoto);
    assert.ok(!insidePhoto.suspicious_reasons.includes('outside_site_radius'), 'Ảnh trong bán kính không bị gắn cờ outside_site_radius');
    assert.equal(insidePhoto.distance_to_center_meters, 0);

    const outsidePhoto = photos.find(p => p.file_name === 'outside_site_photo.jpg');
    assert.ok(outsidePhoto);
    assert.equal(outsidePhoto.is_suspicious, true);
    assert.ok(outsidePhoto.suspicious_reasons.includes('outside_site_radius'));
    assert.equal(outsidePhoto.confidence_level, 'high');
    assert.ok(outsidePhoto.distance_to_center_meters > 500);
    assert.ok(outsidePhoto.suspicious_details.includes('vượt quá bán kính cho phép'));
  });

  await suite.test('Cảnh báo ngoài bán kính không làm mất các cảnh báo gian lận khác', () => {
    // Ảnh vừa chụp ngoài bán kính, vừa là ảnh chụp màn hình (screenshot_detected), vừa chụp cách xa ngày
    const evaluation = evaluatePhotoSuspicion({
      metadata: {
        has_metadata: true,
        latitude: 21.017320,
        longitude: 105.784010,
        camera_make: null,
        camera_model: null,
        taken_at: '2026-08-01T10:00:00.000Z' // Cách hơn 80 ngày so với 2026-10-22
      },
      width: 1080,
      height: 2400, // Tỉ lệ màn hình điện thoại
      fileName: 'screenshot_ngoai_cong_truong.png',
      inspectionDate: '2026-10-22',
      projectLocation: {
        site_latitude: siteCenterLat,
        site_longitude: siteCenterLon,
        site_radius_meters: siteRadiusMeters
      }
    });

    assert.equal(evaluation.is_suspicious, true);
    assert.ok(evaluation.suspicious_reasons.includes('outside_site_radius'), 'Phải có cảnh báo ngoài bán kính');
    assert.ok(evaluation.suspicious_reasons.includes('screenshot_detected'), 'Không được mất cảnh báo ảnh chụp màn hình');
    assert.ok(evaluation.suspicious_reasons.includes('taken_time_too_far'), 'Không được mất cảnh báo thời gian quá xa');
    assert.ok(evaluation.suspicious_reasons.includes('missing_camera_metadata'), 'Không được mất cảnh báo thiếu camera metadata');
  });
});
