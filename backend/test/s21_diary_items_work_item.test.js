/**
 * ========================================================
 * BỘ KIỂM THỬ: S-21 (SCRUM-113) — KỸ SƯ GIÁM SÁT GHI MỤC NHẬT KÝ HẰNG NGÀY GẮN HẠNG MỤC
 * Epic: SCRUM-122 [E-05] Nhật ký công trường ngoại tuyến
 * Sprint: SCRUM Sprint 4
 *
 * User Story:
 *   "Là kỹ sư giám sát, tôi muốn ghi nhật ký công trường trên điện thoại ngay tại chỗ
 *    để không phải chép lại từ sổ giấy vào cuối ngày."
 *
 * Acceptance Criteria (theo Excel):
 *   AC 1: Giả sử tôi đang ở công trường có mạng, khi ghi mục nhật ký với hạng mục,
 *         nội dung công việc và giờ, thì mục hiện ngay trong danh sách nhật ký của ngày hôm đó.
 *   AC 2: Giả sử tôi mở nhật ký, khi lọc theo hạng mục hoặc theo ngày, thì chỉ thấy mục khớp.
 *   AC 3: Giả sử tôi để trống hạng mục, khi lưu, thì bị chặn — mục nhật ký nào cũng phải gắn được
 *         vào hạng mục để sau này tra hồ sơ.
 *
 * NFR:
 *   - Giao diện dùng được bằng một tay dưới nắng; chữ và nút đủ lớn.
 * ========================================================
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');

const diaryRoutes = require('../src/routes/diaryRoutes');
const { DiaryService } = require('../src/services/diaryService');
const {
  inMemorySiteDiaries,
  inMemorySiteDiaryItems,
  inMemoryWorkItems,
  clearSiteDiaryItems
} = require('../src/models/store');

function createTestApp(diaryServiceInstance) {
  const app = express();
  app.use(express.json());

  // Giả lập middleware user Kỹ sư giám sát (đã xác thực)
  app.use((req, res, next) => {
    req.user = { id: 3, userId: 3, role_name: 'supervisor', role_id: 3 };
    next();
  });

  const mockDb = { isConnected: false, pool: null };
  const router = express.Router();

  // Route nạp danh sách hạng mục WBS cho frontend dropdown
  router.get('/projects/:projectId/work-items', (req, res) => {
    res.json({ success: true, data: inMemoryWorkItems });
  });

  app.use('/api', router);
  app.use('/api', diaryRoutes(mockDb));

  return app;
}

async function request(app, method, url, body = null) {
  const server = app.listen(0);
  const port = server.address().port;
  const targetUrl = `http://localhost:${port}${url}`;

  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(targetUrl, opts);
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  } finally {
    server.close();
  }
}

test('=== [S-21 / SCRUM-113] KIỂM THỬ GHI MỤC NHẬT KÝ HẰNG NGÀY GẮN HẠNG MỤC ===', async (t) => {
  const mockDb = { pool: null };
  const diaryService = new DiaryService(mockDb);
  const app = createTestApp(diaryService);
  const projectId = 1;

  // Thiết lập dữ liệu mẫu in-memory trước mỗi lượt test
  inMemorySiteDiaries.length = 0;
  inMemorySiteDiaryItems.length = 0;
  inMemoryWorkItems.length = 0;

  inMemoryWorkItems.push(
    { id: 101, project_id: projectId, code: 'HM-01', name: 'Đào móng và xử lý hố móng trụ T1' },
    { id: 102, project_id: projectId, code: 'HM-02', name: 'Gia công lắp dựng cốt thép dầm sàn' },
    { id: 103, project_id: projectId, code: 'HM-03', name: 'Đổ bê tông tươi mác 300 đài móng' }
  );

  // ----------------------------------------------------
  // TC 1: Kiểm tra NFR - Giao diện HTML & CSS cho mobile dùng 1 tay dưới nắng
  // ----------------------------------------------------
  await t.test('TC 1 [NFR]: Giao diện frontend/diary.html tối ưu 1 tay dưới nắng, chữ và nút đủ lớn', () => {
    const htmlPath = path.join(__dirname, '../../frontend/diary.html');
    assert.strictEqual(fs.existsSync(htmlPath), true, 'Tệp frontend/diary.html phải tồn tại');

    const html = fs.readFileSync(htmlPath, 'utf8');

    // NFR Nắng chói (Sun mode)
    assert.ok(html.includes('toggleSunlightMode'), 'Phải có chức năng chuyển đổi chế độ Nắng Chói');
    assert.ok(html.includes('sun-mode'), 'Phải có CSS rule sun-mode tương phản cao chống lóa nắng');

    // NFR Nút to bản dùng 1 tay
    assert.ok(html.includes('btn-one-hand-primary'), 'Phải có class CSS nút bấm to dùng 1 tay');
    assert.ok(html.includes('GHI MỤC NHẬT KÝ (LƯU TẠI CHỖ)'), 'Nút ghi mục phải có nhãn rõ ràng');

    // Form và các trường thông tin gắn hạng mục
    assert.ok(html.includes('id="s21-quick-form"'), 'Phải có form ghi nhanh S-21');
    assert.ok(html.includes('id="select-s21-work-item"'), 'Phải có ô chọn hạng mục bắt buộc');
    assert.ok(html.includes('id="s21-item-time"'), 'Phải có ô nhập giờ ghi nhận');
    assert.ok(html.includes('id="s21-item-content"'), 'Phải có ô nhập nội dung công việc');

    // Bộ lọc tra cứu theo hạng mục và ngày
    assert.ok(html.includes('id="filter-s21-work-item"'), 'Phải có dropdown lọc theo hạng mục');
    assert.ok(html.includes('id="filter-s21-date"'), 'Phải có ô chọn lọc theo ngày');
    assert.ok(html.includes('id="s21-items-container"'), 'Phải có container danh sách mục nhật ký');
  });

  // ----------------------------------------------------
  // TC 2: AC 3 - Chặn lưu khi để trống hạng mục
  // "Giả sử tôi để trống hạng mục, khi lưu, thì bị chặn — mục nhật ký nào cũng phải gắn được vào hạng mục để sau này tra hồ sơ."
  // ----------------------------------------------------
  await t.test('TC 2 [AC 3]: Để trống hạng mục khi ghi nhật ký thì bị chặn với thông báo rõ ràng', async () => {
    // 2.1 Kiểm thử tầng Service
    await assert.rejects(
      async () => {
        await diaryService.addDiaryItem(projectId, '2026-10-14', {
          work_item_id: null, // Để trống hạng mục
          work_content: 'Đang đổ bê tông lót đáy móng',
          log_time: '09:00'
        }, 3);
      },
      (err) => {
        assert.strictEqual(err.status, 400);
        assert.ok(err.message.includes('Hạng mục không được để trống'), 'Thông báo phải nêu rõ hạng mục không được để trống');
        assert.ok(err.message.includes('sau này tra hồ sơ'), 'Phải giải thích lý do tra cứu hồ sơ sau này');
        return true;
      }
    );

    // 2.2 Kiểm thử qua HTTP API POST /api/projects/:projectId/diary-items
    const res = await request(app, 'POST', `/api/projects/${projectId}/diary-items`, {
      diary_date: '2026-10-14',
      work_item_id: '', // Bỏ trống
      work_content: 'Đang kiểm tra cốt thép hố móng',
      log_time: '10:15'
    });

    assert.strictEqual(res.status, 400, 'Phải trả về HTTP 400 Bad Request');
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('Hạng mục không được để trống'), 'API phải chặn và trả về lỗi');
  });

  // ----------------------------------------------------
  // TC 3: AC 1 - Ghi mục nhật ký với hạng mục, nội dung công việc và giờ -> hiện ngay trong danh sách nhật ký của ngày hôm đó
  // ----------------------------------------------------
  await t.test('TC 3 [AC 1]: Ghi mục nhật ký thành công có hạng mục, nội dung, giờ -> hiện ngay trong danh sách ngày hôm đó', async () => {
    const testDate = '2026-10-14';
    const payload = {
      diary_date: testDate,
      work_item_id: 101, // Hạng mục 'HM-01'
      work_content: 'Hoàn thành đào 45m3 đất hố móng trụ T1 bằng máy xúc gầu 0.8m3',
      log_time: '08:30',
      quantity_done: 45,
      unit: 'm³'
    };

    const res = await request(app, 'POST', `/api/projects/${projectId}/diary-items`, payload);

    assert.strictEqual(res.status, 201, 'HTTP Status phải là 201 Created');
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data, 'Phải trả về mục nhật ký vừa tạo');
    assert.strictEqual(res.body.data.work_item_id, 101);
    assert.strictEqual(res.body.data.work_content, payload.work_content);
    assert.strictEqual(res.body.data.log_time, '08:30');
    assert.strictEqual(res.body.data.quantity_done, 45);
    assert.strictEqual(res.body.data.unit, 'm³');
    assert.strictEqual(res.body.data.diary_date, testDate);

    // Kiểm tra dayItems: Mục mới hiện ngay trong danh sách nhật ký của ngày hôm đó
    assert.ok(Array.isArray(res.body.dayItems), 'Phải trả về danh sách các mục trong ngày');
    const itemInDay = res.body.dayItems.find(i => i.id === res.body.data.id);
    assert.ok(itemInDay, 'Mục vừa ghi phải hiện diện ngay trong danh sách ngày hôm đó');
    assert.strictEqual(itemInDay.log_time, '08:30');
    assert.strictEqual(itemInDay.work_item_name, 'Đào móng và xử lý hố móng trụ T1');
  });

  // ----------------------------------------------------
  // TC 4: AC 2 - Mở nhật ký, lọc theo hạng mục hoặc theo ngày thì chỉ thấy mục khớp
  // ----------------------------------------------------
  await t.test('TC 4 [AC 2]: Lọc theo hạng mục hoặc theo ngày chỉ thấy các mục khớp điều kiện', async () => {
    // Chuẩn bị 3 mục nhật ký ở các ngày và các hạng mục khác nhau
    // Mục 1: Ngày 2026-10-14, Hạng mục 101 (HM-01), 08:30
    await diaryService.addDiaryItem(projectId, '2026-10-14', {
      work_item_id: 101,
      work_content: 'Đào đất đợt 1 trụ T1',
      log_time: '08:30'
    }, 3);

    // Mục 2: Ngày 2026-10-14, Hạng mục 102 (HM-02), 14:00
    await diaryService.addDiaryItem(projectId, '2026-10-14', {
      work_item_id: 102,
      work_content: 'Lắp dựng thép dầm D1',
      log_time: '14:00'
    }, 3);

    // Mục 3: Ngày 2026-10-15, Hạng mục 101 (HM-01), 09:15
    await diaryService.addDiaryItem(projectId, '2026-10-15', {
      work_item_id: 101,
      work_content: 'Vận chuyển đất thải ra bãi tập kết',
      log_time: '09:15'
    }, 3);

    // 4.1 Lọc theo ngày: chỉ thấy các mục của ngày 2026-10-14
    const filterByDateRes = await request(app, 'GET', `/api/projects/${projectId}/diary-items?date=2026-10-14`);
    assert.strictEqual(filterByDateRes.status, 200);
    assert.strictEqual(filterByDateRes.body.success, true);
    const dateItems = filterByDateRes.body.data;
    assert.ok(dateItems.length >= 2, 'Phải có các mục của ngày 2026-10-14');
    dateItems.forEach(item => {
      assert.strictEqual(item.diary_date, '2026-10-14', 'Mọi mục trong kết quả phải có ngày đúng 2026-10-14');
    });

    // 4.2 Lọc theo hạng mục: chỉ thấy các mục thuộc Hạng mục 101 (HM-01)
    const filterByWorkItemRes = await request(app, 'GET', `/api/projects/${projectId}/diary-items?work_item_id=101`);
    assert.strictEqual(filterByWorkItemRes.status, 200);
    const workItems = filterByWorkItemRes.body.data;
    assert.ok(workItems.length >= 2, 'Phải có các mục thuộc hạng mục 101');
    workItems.forEach(item => {
      assert.strictEqual(item.work_item_id, 101, 'Mọi mục trong kết quả phải thuộc hạng mục 101');
    });

    // 4.3 Lọc kết hợp CẢ Ngày (2026-10-15) VÀ Hạng mục (101): chỉ thấy đúng 1 mục khớp cả hai
    const filterBothRes = await request(app, 'GET', `/api/projects/${projectId}/diary-items?date=2026-10-15&work_item_id=101`);
    assert.strictEqual(filterBothRes.status, 200);
    const bothItems = filterBothRes.body.data;
    assert.strictEqual(bothItems.length, 1, 'Chỉ có đúng 1 mục khớp cả ngày 2026-10-15 và hạng mục 101');
    assert.strictEqual(bothItems[0].diary_date, '2026-10-15');
    assert.strictEqual(bothItems[0].work_item_id, 101);
    assert.strictEqual(bothItems[0].work_content, 'Vận chuyển đất thải ra bãi tập kết');
  });

  // ----------------------------------------------------
  // TC 5: Cập nhật & Xóa mục nhật ký gắn hạng mục
  // ----------------------------------------------------
  await t.test('TC 5: Cập nhật và Xóa mục nhật ký thành công', async () => {
    const item = await diaryService.addDiaryItem(projectId, '2026-10-16', {
      work_item_id: 103,
      work_content: 'Đổ bê tông lót ban đầu',
      log_time: '11:00'
    }, 3);

    const itemId = item.item.id;

    // Cập nhật nội dung và khối lượng
    const updateRes = await request(app, 'PUT', `/api/projects/${projectId}/diary-items/${itemId}`, {
      work_content: 'Đã hoàn thành đổ 20m3 bê tông lót mác 150',
      quantity_done: 20,
      unit: 'm³'
    });

    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updateRes.body.data.work_content, 'Đã hoàn thành đổ 20m3 bê tông lót mác 150');
    assert.strictEqual(updateRes.body.data.quantity_done, 20);

    // Xóa mục
    const deleteRes = await request(app, 'DELETE', `/api/projects/${projectId}/diary-items/${itemId}`);
    assert.strictEqual(deleteRes.status, 200);
    assert.strictEqual(deleteRes.body.success, true);

    // Xác nhận không còn trong danh sách
    const checkRes = await request(app, 'GET', `/api/projects/${projectId}/diary-items?date=2026-10-16`);
    const found = checkRes.body.data.find(i => i.id === itemId);
    assert.strictEqual(found, undefined, 'Mục đã xóa không còn xuất hiện trong danh sách');
  });

  // ----------------------------------------------------
  // TC 6: Chặn ghi/sửa khi sổ nhật ký ngày đã bị khóa (S-24 integration)
  // ----------------------------------------------------
  await t.test('TC 6: Chặn thêm hoặc sửa mục nhật ký khi ngày đã bị khóa sổ', async () => {
    const lockedDate = '2026-10-10';
    // Lưu và khóa sổ ngày này
    await diaryService.saveDiary(projectId, { diary_date: lockedDate }, 3);
    await diaryService.lockDiary(projectId, lockedDate, 1);

    // Cố gắng thêm mục mới vào ngày đã bị khóa
    const res = await request(app, 'POST', `/api/projects/${projectId}/diary-items`, {
      diary_date: lockedDate,
      work_item_id: 101,
      work_content: 'Cố tình thêm khi đã khóa sổ',
      log_time: '16:00'
    });

    assert.strictEqual(res.status, 423, 'Phải trả về HTTP 423 Locked khi ngày đã bị khóa');
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('khóa sổ'), 'Thông báo phải ghi nhận ngày đã bị khóa sổ');
  });
});
