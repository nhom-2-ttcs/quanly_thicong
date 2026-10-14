const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs');
const path = require('path');
const diaryRoutes = require('../src/routes/diaryRoutes');
const { createSession, inMemoryUsers, inMemorySiteDiaries, inMemorySiteDiaryItems, inMemorySiteDiaryPhotos } = require('../src/models/store');
const { authenticate } = require('../src/utils/rbac');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  const mockDb = { isConnected: false, pool: null };
  app.use('/api', diaryRoutes(mockDb));
  return app;
}

const pmUser = inMemoryUsers.find(u => u.role_id === 2) || { id: 2, email: 'dtc245160020@ictu.edu.vn', role_id: 2, role_name: 'project_manager' };
const pmToken = createSession(pmUser);

async function makeRequest(app, method, url, body = null, token = null) {
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

test('S-30 / SCRUM-143: Đồng bộ ngoại tuyến, bảo vệ Idempotency và cách ly lỗi từng mục', async (t) => {
  const app = createTestApp();

  // Reset store
  inMemorySiteDiaries.length = 0;
  inMemorySiteDiaryItems.length = 0;
  inMemorySiteDiaryPhotos.length = 0;

  await t.test('TC-S30-01: Gửi lại cùng client_diary_id không tạo bản ghi trùng lặp (Idempotent)', async () => {
    const clientDiaryId = 'client-diary-uuid-1001';
    const payload = {
      client_diary_id: clientDiaryId,
      diary_date: '2026-10-25',
      weather_condition: 'sunny',
      manpower_count: 20,
      equipment_status: 'Máy đào 01, Máy ủi 02',
      work_notes: 'Đồng bộ lần đầu từ thiết bị ngoại tuyến'
    };

    // Lần gửi 1
    const res1 = await makeRequest(app, 'POST', '/api/projects/1/diaries', payload, pmToken);
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.data.success, true);
    const diaryId1 = res1.data.data.id;
    assert.ok(diaryId1);

    const countAfterFirst = inMemorySiteDiaries.length;
    assert.strictEqual(countAfterFirst, 1);

    // Lần gửi 2 (retry với cùng client_diary_id do chập chờn mạng)
    const res2 = await makeRequest(app, 'POST', '/api/projects/1/diaries', payload, pmToken);
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.data.success, true);
    assert.strictEqual(res2.data.data.id, diaryId1, 'Phải trả về đúng bản ghi đã tạo, không tạo mới');

    const countAfterRetry = inMemorySiteDiaries.length;
    assert.strictEqual(countAfterRetry, 1, 'Tổng số bản ghi trong CSDL vẫn là 1, không được nhân bản');
  });

  await t.test('TC-S30-02: Gửi lại cùng client_item_id trong danh sách công việc không tạo mục trùng', async () => {
    const clientItemId = 'client-item-uuid-2002';
    const payloadWithItem = {
      diary_date: '2026-10-26',
      weather_condition: 'cloudy',
      items: [
        {
          client_item_id: clientItemId,
          work_content: 'Gia công cốt thép đài móng',
          quantity_done: 15.5,
          unit: 'tấn'
        }
      ]
    };

    // Gửi lần 1
    const res1 = await makeRequest(app, 'POST', '/api/projects/1/diaries', payloadWithItem, pmToken);
    assert.strictEqual(res1.status, 200);
    const diaryId = res1.data.data.id;

    const items1 = inMemorySiteDiaryItems.filter(i => i.diary_id === diaryId && i.client_item_id === clientItemId);
    assert.strictEqual(items1.length, 1);

    // Gửi lần 2
    const res2 = await makeRequest(app, 'POST', '/api/projects/1/diaries', payloadWithItem, pmToken);
    assert.strictEqual(res2.status, 200);

    const items2 = inMemorySiteDiaryItems.filter(i => i.diary_id === diaryId && i.client_item_id === clientItemId);
    assert.strictEqual(items2.length, 1, 'Mục công việc không được nhân đôi khi retry');
  });

  await t.test('TC-S30-03: Gửi lại cùng client_photo_id không tạo ảnh trùng lặp trong thư viện nhật ký', async () => {
    const { saveSiteDiaryPhoto } = require('../src/models/store');
    const clientPhotoId = 'client-photo-uuid-3003';

    // Đính kèm ảnh lần 1
    const photo1 = saveSiteDiaryPhoto({
      diary_id: 1,
      file_name: 'hien_truong_1.jpg',
      file_size: 250000,
      mime_type: 'image/jpeg',
      client_photo_id: clientPhotoId
    });

    const initialPhotoCount = inMemorySiteDiaryPhotos.filter(p => p.client_photo_id === clientPhotoId).length;
    assert.strictEqual(initialPhotoCount, 1);

    // Đính kèm ảnh lần 2 cùng client_photo_id
    const photo2 = saveSiteDiaryPhoto({
      diary_id: 1,
      file_name: 'hien_truong_1_retry.jpg',
      file_size: 250000,
      mime_type: 'image/jpeg',
      client_photo_id: clientPhotoId
    });

    assert.strictEqual(photo1.id, photo2.id, 'Phải cập nhật bản ghi ảnh cũ cùng ID');
    const afterCount = inMemorySiteDiaryPhotos.filter(p => p.client_photo_id === clientPhotoId).length;
    assert.strictEqual(afterCount, 1, 'Không được tạo thêm ảnh trùng lặp');
  });

  await t.test('TC-S30-04: Lỗi ở một mục đồng bộ phải lưu/hiện lý do và KHÔNG CHẶN các mục sau tiếp tục', async () => {
    // Giả lập danh sách hàng chờ 3 mục: Mục 1 hợp lệ, Mục 2 lỗi (thiếu ngày hoặc dữ liệu sai), Mục 3 hợp lệ
    const queue = [
      {
        id: 'queue-1',
        data: { diary_date: '2026-10-27', weather_condition: 'sunny', manpower_count: 10 }
      },
      {
        id: 'queue-2',
        data: { diary_date: 'invalid-date', weather_condition: 'sunny' } // Sẽ gây lỗi 400
      },
      {
        id: 'queue-3',
        data: { diary_date: '2026-10-28', weather_condition: 'sunny', manpower_count: 12 }
      }
    ];

    const syncResults = [];

    // Bộ xử lý đồng bộ tuần tự
    for (const item of queue) {
      try {
        const res = await makeRequest(app, 'POST', '/api/projects/1/diaries', item.data, pmToken);
        if (res.status >= 200 && res.status < 300) {
          syncResults.push({ id: item.id, status: 'synced', error: null });
        } else {
          syncResults.push({ id: item.id, status: 'failed', error: res.data?.message || 'Lỗi HTTP' });
        }
      } catch (err) {
        syncResults.push({ id: item.id, status: 'failed', error: err.message });
      }
    }

    // Kiểm tra kết quả
    assert.strictEqual(syncResults.length, 3);
    assert.strictEqual(syncResults[0].status, 'synced');
    assert.strictEqual(syncResults[1].status, 'failed');
    assert.ok(syncResults[1].error, 'Mục 2 phải lưu trữ thông điệp lỗi');
    assert.match(syncResults[1].error, /ngày/i);
    assert.strictEqual(syncResults[2].status, 'synced', 'Mục 3 vẫn phải tiếp tục đồng bộ thành công dù Mục 2 lỗi');
  });

  await t.test('TC-S30-05: Kiểm tra tính sẵn sàng của schema MySQL (file migration S-30 và db.js)', () => {
    const migrationPath = path.join(__dirname, '../../migration_s30_idempotency_keys.sql');
    assert.ok(fs.existsSync(migrationPath), 'File migration_s30_idempotency_keys.sql phải tồn tại');
    const content = fs.readFileSync(migrationPath, 'utf8');

    assert.ok(content.includes('uq_diary_client_id'), 'Phải có UNIQUE KEY uq_diary_client_id');
    assert.ok(content.includes('uq_item_client_id'), 'Phải có UNIQUE KEY uq_item_client_id');
    assert.ok(content.includes('uq_photo_client_id'), 'Phải có UNIQUE KEY uq_photo_client_id');

    const dbPath = path.join(__dirname, '../db.js');
    const dbContent = fs.readFileSync(dbPath, 'utf8');
    assert.ok(dbContent.includes('client_diary_id'), 'db.js phải khai báo client_diary_id');
    assert.ok(dbContent.includes('client_item_id'), 'db.js phải khai báo client_item_id');
  });
});
