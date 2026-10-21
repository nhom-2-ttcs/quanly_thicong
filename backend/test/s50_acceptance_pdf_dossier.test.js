const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const acceptanceRoutes = require('../src/routes/acceptanceRoutes');
const dossierPdfService = require('../src/services/dossierPdfService');
const store = require('../src/models/store');
const { authenticate } = require('../src/utils/rbac');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  const mockDb = { isConnected: false, pool: null };
  app.use('/api', acceptanceRoutes(mockDb));
  return app;
}

// Thiết lập User và Token cho RBAC
const adminUser = store.inMemoryUsers?.find(u => u.role_id === 1) || { id: 1, email: 'admin@thicong.vn', role_id: 1, role_name: 'admin' };
const pmUser = store.inMemoryUsers?.find(u => u.role_id === 2) || { id: 2, email: 'pm@thicong.vn', role_id: 2, role_name: 'project_manager' };
const supervisorUser = { id: 201, email: 'supervisor@thicong.vn', role_id: 3, role_name: 'site_manager' };
const outsiderUser = { id: 999, email: 'outsider@thicong.vn', role_id: 4, role_name: 'contractor' }; // Không thuộc dự án 50

const mockProjectId = 50;
const outsiderProjectId = 99;

store.addProjectMember({ projectId: mockProjectId, userId: adminUser.id, roleId: 1 });
store.addProjectMember({ projectId: mockProjectId, userId: pmUser.id, roleId: 2 });
store.addProjectMember({ projectId: mockProjectId, userId: supervisorUser.id, roleId: 3 });

const adminToken = store.createSession(adminUser);
const pmToken = store.createSession(pmUser);
const supervisorToken = store.createSession(supervisorUser);
const outsiderToken = store.createSession(outsiderUser);

async function makeRequest(app, method, url, token = null) {
  const server = app.listen(0);
  const port = server.address().port;
  const targetUrl = `http://localhost:${port}${url}`;

  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(targetUrl, { method, headers });
    const contentType = res.headers.get('content-type') || '';
    let body = null;
    let buffer = null;

    if (contentType.includes('application/json')) {
      body = await res.json();
    } else {
      const arrayBuf = await res.arrayBuffer();
      buffer = Buffer.from(arrayBuf);
    }

    return {
      status: res.status,
      headers: res.headers,
      body,
      buffer
    };
  } finally {
    server.close();
  }
}

describe('S-50 (SCRUM-E10): Xuất hồ sơ nghiệm thu PDF theo hạng mục WBS', () => {
  const app = createTestApp();
  const workItemId1 = 5001; // Đổ bê tông móng
  const workItemId2 = 5002; // Cốt thép sàn
  const emptyWorkItemId = 5003; // Hạng mục chưa có đợt nghiệm thu nào

  beforeEach(() => {
    // 1. Reset dữ liệu dự án 50 trong store
    store.inMemoryProjects = (store.inMemoryProjects || []).filter(p => Number(p.id) !== mockProjectId);
    store.inMemoryProjects.push({
      id: mockProjectId,
      code: 'DA-LANDMARK-50',
      name: 'Dự án Toà nhà Phức hợp Landmark 50',
      description: 'Dự án kiểm thử hồ sơ nghiệm thu S-50'
    });

    // 2. Thiết lập Work items
    store.inMemoryWorkItems = (store.inMemoryWorkItems || []).filter(w => Number(w.project_id) !== mockProjectId);
    store.inMemoryWorkItems.push(
      {
        id: workItemId1,
        project_id: mockProjectId,
        code: 'HM-BT-01',
        name: 'Đổ bê tông móng M1',
        unit: 'm3',
        khoi_luong_hop_dong: 500.0,
        don_gia_hop_dong: 1500000
      },
      {
        id: workItemId2,
        project_id: mockProjectId,
        code: 'HM-CT-02',
        name: 'Gia công lắp dựng cốt thép sàn tầng 1',
        unit: 'tấn',
        khoi_luong_hop_dong: 80.0,
        don_gia_hop_dong: 18000000
      },
      {
        id: emptyWorkItemId,
        project_id: mockProjectId,
        code: 'HM-SN-03',
        name: 'Sơn bả hoàn thiện mặt ngoài',
        unit: 'm2',
        khoi_luong_hop_dong: 1200.0,
        don_gia_hop_dong: 85000
      }
    );

    // 3. Reset Acceptance Sheets, Items, Photos (xóa bằng splice để giữ nguyên reference array)
    store.inMemoryAcceptanceSheets.splice(0, store.inMemoryAcceptanceSheets.length);
    store.inMemoryAcceptanceSheetItems.splice(0, store.inMemoryAcceptanceSheetItems.length);
    store.inMemoryAcceptanceSheetPhotos.splice(0, store.inMemoryAcceptanceSheetPhotos.length);

    // 4. Tạo 3 đợt nghiệm thu:
    // Đợt 1: APPROVED - Khối lượng đợt: 150 m3, Luỹ kế: 150 m3
    const sheet1 = store.saveAcceptanceSheet({
      id: 501,
      project_id: mockProjectId,
      sheet_code: 'NT-D01-2026',
      name: 'Nghiệm thu khối lượng Đợt 1',
      period_number: 1,
      from_date: '2026-03-01',
      to_date: '2026-03-15',
      status: 'approved',
      notes: 'Nghiệm thu đạt yêu cầu kỹ thuật TCVN',
      created_by: supervisorUser.id,
      approved_by: pmUser.id,
      approved_at: '2026-03-16 10:00:00'
    });
    store.saveAcceptanceSheetItem({
      sheet_id: sheet1.id,
      work_item_id: workItemId1,
      item_name: 'Đổ bê tông móng M1',
      unit: 'm3',
      previous_approved_quantity: 0.0,
      period_quantity: 150.0,
      cumulative_quantity: 150.0,
      notes: 'Đợt 1 đạt'
    });
    // Ảnh có đầy đủ thời điểm và toạ độ GPS (S-40)
    store.saveAcceptanceSheetPhoto({
      sheet_id: sheet1.id,
      file_name: 'be_tong_mong_d01_gps.jpg',
      file_path: '/uploads/acceptance/be_tong_mong_d01_gps.jpg',
      file_size: 102400,
      mime_type: 'image/jpeg',
      caption: 'Hiện trường đổ bê tông móng đợt 1',
      taken_at: '2026-03-14 15:30:00',
      latitude: 10.776889,
      longitude: 106.700806,
      has_metadata: true
    });

    // Đợt 2: APPROVED - Khối lượng đợt: 200 m3, Luỹ kế: 350 m3
    const sheet2 = store.saveAcceptanceSheet({
      id: 502,
      project_id: mockProjectId,
      sheet_code: 'NT-D02-2026',
      name: 'Nghiệm thu khối lượng Đợt 2',
      period_number: 2,
      from_date: '2026-03-16',
      to_date: '2026-03-31',
      status: 'approved',
      notes: 'Nghiệm thu đợt 2 bảo dưỡng tốt',
      created_by: supervisorUser.id,
      approved_by: adminUser.id,
      approved_at: '2026-04-01 14:00:00'
    });
    store.saveAcceptanceSheetItem({
      sheet_id: sheet2.id,
      work_item_id: workItemId1,
      item_name: 'Đổ bê tông móng M1',
      unit: 'm3',
      previous_approved_quantity: 150.0,
      period_quantity: 200.0,
      cumulative_quantity: 350.0,
      notes: 'Đợt 2 đạt'
    });
    // Ảnh thiếu metadata (Không có GPS & thời gian)
    store.saveAcceptanceSheetPhoto({
      sheet_id: sheet2.id,
      file_name: 'be_tong_mong_d02_nometadata.png',
      file_path: '/uploads/acceptance/be_tong_mong_d02_nometadata.png',
      file_size: 98000,
      mime_type: 'image/png',
      caption: 'Ảnh chụp từ Zalo không có EXIF',
      taken_at: null,
      latitude: null,
      longitude: null,
      has_metadata: false
    });

    // Đợt 3: DRAFT (Bản nháp) - KHÔNG ĐƯỢC ĐƯA VÀO HỒ SƠ
    const sheet3 = store.saveAcceptanceSheet({
      id: 503,
      project_id: mockProjectId,
      sheet_code: 'NT-D03-DRAFT',
      name: 'Nghiệm thu khối lượng Đợt 3 (Nháp)',
      period_number: 3,
      from_date: '2026-04-01',
      to_date: '2026-04-15',
      status: 'draft',
      notes: 'Đang tổng hợp chưa duyệt',
      created_by: supervisorUser.id
    });
    store.saveAcceptanceSheetItem({
      sheet_id: sheet3.id,
      work_item_id: workItemId1,
      item_name: 'Đổ bê tông móng M1',
      unit: 'm3',
      previous_approved_quantity: 350.0,
      period_quantity: 100.0,
      cumulative_quantity: 450.0
    });

    // Đợt 4: REJECTED (Bị từ chối) - KHÔNG ĐƯỢC ĐƯA VÀO HỒ SƠ
    const sheet4 = store.saveAcceptanceSheet({
      id: 504,
      project_id: mockProjectId,
      sheet_code: 'NT-D04-REJECTED',
      name: 'Nghiệm thu khối lượng Đợt 4 (Bị từ chối)',
      period_number: 4,
      from_date: '2026-04-16',
      to_date: '2026-04-30',
      status: 'rejected',
      notes: 'Từ chối do bê tông nứt mặt'
    });
    store.saveAcceptanceSheetItem({
      sheet_id: sheet4.id,
      work_item_id: workItemId1,
      item_name: 'Đổ bê tông móng M1',
      unit: 'm3',
      previous_approved_quantity: 350.0,
      period_quantity: 50.0,
      cumulative_quantity: 400.0
    });

    // Phiếu dự án khác (outsiderProjectId = 99) - KHÔNG ĐƯỢC ĐƯA VÀO HỒ SƠ
    const outsiderSheet = store.saveAcceptanceSheet({
      id: 991,
      project_id: outsiderProjectId,
      sheet_code: 'NT-OUTSIDER',
      name: 'Dự án khác',
      period_number: 1,
      from_date: '2026-03-01',
      to_date: '2026-03-15',
      status: 'approved'
    });
    store.saveAcceptanceSheetItem({
      sheet_id: outsiderSheet.id,
      work_item_id: workItemId1,
      item_name: 'Đổ bê tông móng M1',
      unit: 'm3',
      previous_approved_quantity: 0,
      period_quantity: 999.0,
      cumulative_quantity: 999.0
    });
  });

  // ==========================================
  // 1. KIỂM THỬ DỮ LIỆU TỔNG HỢP (JSON PREVIEW)
  // ==========================================
  test('1. Tổng hợp đúng tất cả các đợt đã duyệt và tính luỹ kế chính xác', async () => {
    const res = await makeRequest(
      app,
      'GET',
      `/api/projects/${mockProjectId}/work-items/${workItemId1}/acceptance-dossier`,
      pmToken
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    const dossier = res.body.data;

    // Kiểm tra thông tin dự án & hạng mục
    assert.equal(dossier.project.id, mockProjectId);
    assert.equal(dossier.project.code, 'DA-LANDMARK-50');
    assert.equal(dossier.work_item.id, workItemId1);
    assert.equal(dossier.work_item.code, 'HM-BT-01');
    assert.equal(dossier.work_item.contract_quantity, 500.0);

    // Kiểm tra số đợt: Phải có đúng 2 đợt đã duyệt (Đợt 1 và Đợt 2)
    assert.equal(dossier.total_approved_periods, 2);
    assert.equal(dossier.periods.length, 2);

    // Kiểm tra số liệu luỹ kế:
    // Đợt 1: period = 150, cum = 150
    // Đợt 2: period = 200, cum = 350
    assert.equal(dossier.periods[0].period_number, 1);
    assert.equal(dossier.periods[0].period_quantity, 150.0);
    assert.equal(dossier.periods[0].cumulative_quantity, 150.0);
    assert.equal(dossier.periods[0].approved_by_name, pmUser.full_name || 'pm@thicong.vn');

    assert.equal(dossier.periods[1].period_number, 2);
    assert.equal(dossier.periods[1].period_quantity, 200.0);
    assert.equal(dossier.periods[1].cumulative_quantity, 350.0);

    // Luỹ kế cuối cùng phải bằng 350, tổng khối lượng thực hiện = 350
    assert.equal(dossier.final_cumulative_quantity, 350.0);
    assert.equal(dossier.total_period_quantity, 350.0);
  });

  test('2. Loại bỏ hoàn toàn phiếu nháp (draft), bị từ chối (rejected) và dữ liệu dự án khác', async () => {
    const res = await makeRequest(
      app,
      'GET',
      `/api/projects/${mockProjectId}/work-items/${workItemId1}/acceptance-dossier`,
      adminToken
    );

    assert.equal(res.status, 200);
    const periods = res.body.data.periods;

    // Không chứa phiếu nháp (sheet_code NT-D03-DRAFT)
    assert.ok(!periods.some(p => p.sheet_code === 'NT-D03-DRAFT'), 'Không được chứa phiếu nháp');
    // Không chứa phiếu bị từ chối (NT-D04-REJECTED)
    assert.ok(!periods.some(p => p.sheet_code === 'NT-D04-REJECTED'), 'Không được chứa phiếu bị từ chối');
    // Không chứa dữ liệu dự án khác (NT-OUTSIDER)
    assert.ok(!periods.some(p => p.sheet_code === 'NT-OUTSIDER'), 'Không được lẫn dữ liệu dự án khác');
  });

  test('3. Xử lý ảnh đính kèm: Nhận diện ảnh có metadata GPS và ghi rõ ảnh thiếu metadata', async () => {
    const res = await makeRequest(
      app,
      'GET',
      `/api/projects/${mockProjectId}/work-items/${workItemId1}/acceptance-dossier`,
      supervisorToken
    );

    assert.equal(res.status, 200);
    const p1 = res.body.data.periods[0];
    const p2 = res.body.data.periods[1];

    // Đợt 1: Có ảnh kèm toạ độ GPS và thời gian
    assert.equal(p1.photos.length, 1);
    assert.equal(p1.photos[0].has_metadata, true);
    assert.ok(p1.photos[0].metadata_note.includes('Tọa độ GPS'));
    assert.ok(p1.photos[0].metadata_note.includes('10.77689'));

    // Đợt 2: Ảnh không có siêu dữ liệu
    assert.equal(p2.photos.length, 1);
    assert.equal(p2.photos[0].has_metadata, false);
    assert.equal(p2.photos[0].metadata_note, 'Không có siêu dữ liệu');
  });

  test('4. Hạng mục chưa có đợt nghiệm thu nào (Dữ liệu rỗng): trả về periods rỗng, không lỗi', async () => {
    const res = await makeRequest(
      app,
      'GET',
      `/api/projects/${mockProjectId}/work-items/${emptyWorkItemId}/acceptance-dossier`,
      pmToken
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.total_approved_periods, 0);
    assert.equal(res.body.data.final_cumulative_quantity, 0);
    assert.equal(res.body.data.total_period_quantity, 0);
    assert.deepEqual(res.body.data.periods, []);
  });

  // ==========================================
  // 2. KIỂM THỬ PHÂN QUYỀN & CHẶN TRUY CẬP CHÉO
  // ==========================================
  test('5. Chặn người dùng không có quyền trong dự án (HTTP 403)', async () => {
    const res = await makeRequest(
      app,
      'GET',
      `/api/projects/${mockProjectId}/work-items/${workItemId1}/acceptance-dossier`,
      outsiderToken // Người dùng không thuộc dự án 50
    );

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.ok(res.body.message.includes('Quyền truy cập bị từ chối'));
  });

  test('6. Trả về 404 khi hạng mục không tồn tại hoặc không thuộc dự án', async () => {
    const nonExistentItemId = 99999;
    const res = await makeRequest(
      app,
      'GET',
      `/api/projects/${mockProjectId}/work-items/${nonExistentItemId}/acceptance-dossier`,
      adminToken
    );

    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
  });

  test('7. Trả về 400 khi projectId hoặc workItemId không hợp lệ (NaN, âm)', async () => {
    const res = await makeRequest(
      app,
      'GET',
      `/api/projects/${mockProjectId}/work-items/abc/acceptance-dossier`,
      adminToken
    );

    assert.equal(res.status, 400);
  });

  // ==========================================
  // 3. KIỂM THỬ XUẤT TỆP PDF THỰC TẾ (DOWNLOAD)
  // ==========================================
  test('8. Tải tệp PDF thực tế: Content-Type application/pdf, header attachment, mã %PDF- hợp lệ', async () => {
    const res = await makeRequest(
      app,
      'GET',
      `/api/projects/${mockProjectId}/work-items/${workItemId1}/acceptance-dossier/pdf`,
      pmToken
    );

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');

    const disposition = res.headers.get('content-disposition');
    assert.ok(disposition.includes('attachment'), 'Header phải là attachment tải về');
    assert.ok(disposition.includes('HM-BT-01') || disposition.includes('HM_BT_01'), 'Tên file phải chứa mã hạng mục');
    assert.ok(disposition.endsWith('.pdf"'), 'Tên file phải có đuôi .pdf');

    assert.ok(res.buffer, 'Buffer PDF không được rỗng');
    assert.ok(res.buffer.length > 500, `Dung lượng PDF hợp lệ (${res.buffer.length} bytes)`);

    // Kiểm tra Magic Bytes PDF (%PDF-)
    const magic = res.buffer.subarray(0, 5).toString('utf-8');
    assert.equal(magic, '%PDF-', 'Tệp tải về phải có magic header chuẩn PDF (%PDF-)');
  });

  test('9. Xuất PDF cho hạng mục chưa có đợt nghiệm thu nào vẫn tạo file PDF hợp lệ', async () => {
    const res = await makeRequest(
      app,
      'GET',
      `/api/projects/${mockProjectId}/work-items/${emptyWorkItemId}/acceptance-dossier/pdf`,
      adminToken
    );

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.ok(res.buffer.length > 500);
    assert.equal(res.buffer.subarray(0, 5).toString('utf-8'), '%PDF-');
  });

  test('10. dossierPdfService sinh mã HTML đầy đủ tiêu ngữ tiếng Việt, bảng và khối chữ ký', () => {
    const mockDossier = {
      project: { id: 1, code: 'DA-01', name: 'Dự án Cầu Vàm Cỏ' },
      work_item: { id: 10, code: 'HM-10', name: 'Đúc dầm Super-T', unit: 'phiến', contract_quantity: 40 },
      total_approved_periods: 1,
      final_cumulative_quantity: 12,
      total_period_quantity: 12,
      periods: [
        {
          period_number: 1,
          sheet_code: 'NT-D01',
          from_date: '2026-03-01',
          to_date: '2026-03-15',
          period_quantity: 12,
          cumulative_quantity: 12,
          unit: 'phiến',
          created_by_name: 'Nguyễn Văn Kỹ Sư',
          approved_by_name: 'Trần Văn Chỉ Huy Trưởng',
          approved_at: '2026-03-16 09:00:00',
          photos: [
            {
              file_name: 'dam_super_t.jpg',
              has_metadata: true,
              taken_at: '2026-03-14 10:00:00',
              latitude: 10.5,
              longitude: 106.5
            }
          ]
        }
      ]
    };

    const html = dossierPdfService.generateHtmlDossier(mockDossier);
    assert.ok(html.includes('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM'));
    assert.ok(html.includes('HỒ SƠ NGHIỆM THU KHỐI LƯỢNG HẠNG MỤC'));
    assert.ok(html.includes('Đúc dầm Super-T'));
    assert.ok(html.includes('Nguyễn Văn Kỹ Sư'));
    assert.ok(html.includes('Trần Văn Chỉ Huy Trưởng'));
    assert.ok(html.includes('10.50000°N'));
    assert.ok(html.includes('CHỈ HUY TRƯỞNG / BAN QLDA'));
  });
});
