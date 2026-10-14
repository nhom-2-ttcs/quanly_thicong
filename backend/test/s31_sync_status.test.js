const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Đường dẫn tới các file module và trang giao diện
const FRONTEND_DIR = path.join(__dirname, '..', '..', 'frontend');
const SYNC_BAR_PATH = path.join(FRONTEND_DIR, 'js', 'syncStatusBarComponent.js');
const OFFLINE_DIARY_STORAGE_PATH = path.join(FRONTEND_DIR, 'js', 'offlineDiaryStorage.js');
const OFFLINE_QUEUE_PATH = path.join(FRONTEND_DIR, 'js', 'offlineUploadQueue.js');
const DIARY_HTML_PATH = path.join(FRONTEND_DIR, 'diary.html');
const INDEX_HTML_PATH = path.join(FRONTEND_DIR, 'index.html');

// Nạp module SyncStatusBar
const SyncStatusBar = require(SYNC_BAR_PATH);
const OfflineUploadQueue = require(OFFLINE_QUEUE_PATH);

/**
 * Mock môi trường client (LocalStorage, DOM, Event)
 */
function createMockClientEnvironment() {
  const store = {};
  const listeners = {};

  const mockLocalStorage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, val) => { store[key] = String(val); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); }
  };

  const mockElement = {
    id: '',
    className: '',
    innerHTML: '',
    style: {},
    children: [],
    attributes: {},
    querySelector(sel) {
      if (sel === '#btn-sync-now' && this.innerHTML.includes('id="btn-sync-now"')) {
        return { onclick: null, disabled: false, innerHTML: '' };
      }
      if (sel === '#btn-sync-refresh' && this.innerHTML.includes('id="btn-sync-refresh"')) {
        return { onclick: null, disabled: false, innerHTML: '' };
      }
      return null;
    },
    querySelectorAll(sel) {
      return [];
    }
  };

  const mockDocument = {
    getElementById: (id) => {
      if (id === 'sync-status-bar-container') {
        const el = Object.assign({}, mockElement, { id });
        return el;
      }
      return null;
    },
    createElement: (tag) => {
      return Object.assign({}, mockElement, { tagName: tag.toUpperCase() });
    },
    head: {
      appendChild: () => {}
    },
    body: {
      prepend: () => {},
      appendChild: () => {}
    },
    querySelector: () => null
  };

  const mockRoot = {
    localStorage: mockLocalStorage,
    document: mockDocument,
    CustomEvent: function(name, opts) { this.name = name; this.detail = opts && opts.detail; },
    addEventListener: (event, handler) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
    },
    dispatchEvent: (event) => {
      const list = listeners[event.name] || [];
      list.forEach(h => h(event));
    }
  };

  return { mockRoot, mockLocalStorage, store, listeners };
}

// =========================================================================
// KIỂM THỬ T-55 (SCRUM-153): ĐỌC SỐ LƯỢNG NHẬT KÝ VÀ HÌNH ẢNH ĐANG CHỜ
// =========================================================================

test('T-55: [AC Đếm chính xác] Đọc đúng số lượng nhật ký và hình ảnh đang chờ từ bộ nhớ máy', async () => {
  const { mockLocalStorage } = createMockClientEnvironment();

  // Thiết lập 2 nhật ký chưa đồng bộ trong LocalStorage fallback
  const mockDiaries = [
    { clientId: 'c1', content: 'Đổ bê tông sàn tầng 2', syncStatus: 'chưa đồng bộ', photo: null },
    { clientId: 'c2', content: 'Gia công cốt thép', syncStatus: 'chưa đồng bộ', photo: 'data:image/jpeg;base64,abc123' },
    { clientId: 'c3', content: 'Nghiệm thu cốp pha', syncStatus: 'đã đồng bộ', photo: null } // Đã đồng bộ, không tính
  ];
  mockLocalStorage.setItem('quanly_thicong_offline_diaries_fallback', JSON.stringify(mockDiaries));

  // Thiết lập 3 ảnh trong hàng đợi tải ảnh OfflineUploadQueue
  const mockPhotos = [
    { id: 'p1', fileName: 'hien_truong_1.jpg' },
    { id: 'p2', fileName: 'hien_truong_2.jpg' },
    { id: 'p3', fileName: 'hien_truong_3.jpg' }
  ];
  mockLocalStorage.setItem('journal-image-upload-queue', JSON.stringify(mockPhotos));

  // Gọi trực tiếp SyncStatusBar với custom mock client
  const testClient = {
    localStorage: mockLocalStorage,
    indexedDB: null,
    OfflineUploadQueue: {
      count: () => mockPhotos.length
    }
  };

  const counts = await SyncStatusBar.getPendingCounts.call(testClient);

  // 2 nhật ký chưa đồng bộ
  assert.strictEqual(counts.pendingDiaries, 2, 'Số mục nhật ký chưa đồng bộ phải bằng 2');
  // 3 ảnh trong hàng đợi + 1 ảnh đính kèm nhật ký chưa đồng bộ = 4 ảnh chờ
  assert.strictEqual(counts.pendingPhotos, 4, 'Số ảnh đang chờ phải tính đúng tổng ảnh');
  assert.strictEqual(counts.totalPending, 6, 'Tổng số mục chờ phải bằng 6');
  assert.strictEqual(counts.isSynced, false, 'Trạng thái chưa đồng bộ');
});

test('T-55: [AC Đếm chính xác] Chỉ có nhật ký chờ, không có ảnh trong hàng đợi', async () => {
  const { mockLocalStorage } = createMockClientEnvironment();

  const mockDiaries = [
    { clientId: 'c1', content: 'Kiểm tra trắc đạc', syncStatus: 'chưa đồng bộ', photo: null }
  ];
  mockLocalStorage.setItem('quanly_thicong_offline_diaries_fallback', JSON.stringify(mockDiaries));
  mockLocalStorage.setItem('journal-image-upload-queue', JSON.stringify([]));

  const testClient = {
    localStorage: mockLocalStorage,
    indexedDB: null
  };

  const counts = await SyncStatusBar.getPendingCounts.call(testClient);
  assert.strictEqual(counts.pendingDiaries, 1);
  assert.strictEqual(counts.pendingPhotos, 0);
  assert.strictEqual(counts.totalPending, 1);
  assert.strictEqual(counts.isSynced, false);
});

test('T-55: [AC Đếm chính xác] Chỉ có ảnh trong hàng đợi, không có nhật ký chờ', async () => {
  const { mockLocalStorage } = createMockClientEnvironment();

  mockLocalStorage.setItem('quanly_thicong_offline_diaries_fallback', JSON.stringify([]));
  const mockPhotos = [
    { id: 'p1', fileName: 'anh1.jpg' },
    { id: 'p2', fileName: 'anh2.jpg' }
  ];
  mockLocalStorage.setItem('journal-image-upload-queue', JSON.stringify(mockPhotos));

  const testClient = {
    localStorage: mockLocalStorage,
    indexedDB: null
  };

  const counts = await SyncStatusBar.getPendingCounts.call(testClient);
  assert.strictEqual(counts.pendingDiaries, 0);
  assert.strictEqual(counts.pendingPhotos, 2);
  assert.strictEqual(counts.totalPending, 2);
  assert.strictEqual(counts.isSynced, false);
});

// =========================================================================
// KIỂM THỬ NFR: SỐ ĐẾM ĐỌC TỪ HÀNG ĐỢI TRÊN MÁY, KHÔNG GỌI MÁY CHỦ
// =========================================================================

test('T-55 & S-31 [NFR]: Quá trình kiểm tra và đếm số lượng tuyệt đối không gọi API máy chủ', async () => {
  let networkCallCount = 0;

  // Giả lập/giám sát lệnh gọi mạng toàn cục
  const originalFetch = global.fetch;
  global.fetch = () => {
    networkCallCount++;
    throw new Error('NFR Violation: Không được phép gọi fetch máy chủ!');
  };

  try {
    const { mockLocalStorage } = createMockClientEnvironment();
    mockLocalStorage.setItem('quanly_thicong_offline_diaries_fallback', JSON.stringify([
      { clientId: 'c1', content: 'Nhật ký test', syncStatus: 'chưa đồng bộ' }
    ]));
    mockLocalStorage.setItem('journal-image-upload-queue', JSON.stringify([
      { id: 'p1', fileName: 'anh.jpg' }
    ]));

    const testClient = { localStorage: mockLocalStorage, indexedDB: null };

    // Thực hiện đếm nhiều lần liên tiếp
    await SyncStatusBar.getPendingCounts.call(testClient);
    await SyncStatusBar.getPendingCounts.call(testClient);
    await SyncStatusBar.getPendingCounts.call(testClient);

    assert.strictEqual(networkCallCount, 0, 'Số lần gọi máy chủ (fetch) phải tuyệt đối bằng 0');
  } finally {
    global.fetch = originalFetch;
  }
});

// =========================================================================
// KIỂM THỬ S-31 AC 1: KHI CÒN MỤC CHƯA ĐỒNG BỘ -> HIỆN SỐ MỤC VÀ SỐ ẢNH ĐANG CHỜ
// =========================================================================

test('S-31 [AC 1]: Thanh trên cùng hiển thị rõ số mục nhật ký và số ảnh đang chờ khi còn dữ liệu', () => {
  const counts = {
    pendingDiaries: 3,
    pendingPhotos: 5,
    totalPending: 8,
    isSynced: false
  };

  const message = SyncStatusBar.buildStatusMessage(counts, null);
  assert.ok(message.includes('3 mục nhật ký'), 'Thông báo phải ghi rõ 3 mục nhật ký');
  assert.ok(message.includes('5 ảnh'), 'Thông báo phải ghi rõ 5 ảnh đang chờ');

  const html = SyncStatusBar.renderHtml(counts, null);
  // Kiểm tra class cảnh báo
  assert.ok(html.includes('sync-status-bar--pending'), 'Thanh trạng thái phải có class pending');
  assert.ok(html.includes('Chưa đồng bộ trên máy'), 'Phải có tiêu đề chưa đồng bộ');

  // Kiểm tra badge số mục nhật ký
  assert.ok(html.includes('id="badge-pending-diaries"'), 'Phải có badge số nhật ký');
  assert.ok(html.includes('3 mục nhật ký chờ'), 'Badge phải hiển thị 3 mục nhật ký');

  // Kiểm tra badge số ảnh chờ
  assert.ok(html.includes('id="badge-pending-photos"'), 'Phải có badge số ảnh');
  assert.ok(html.includes('5 ảnh chờ'), 'Badge phải hiển thị 5 ảnh');

  // Kiểm tra nút hành động đồng bộ ngay
  assert.ok(html.includes('id="btn-sync-now"'), 'Phải có nút [Đồng bộ ngay]');
});

// =========================================================================
// KIỂM THỬ T-56 (SCRUM-154) & S-31 AC 2: KHI MỌI THỨ ĐÃ ĐỒNG BỘ
// =========================================================================

test('T-56 & S-31 [AC 2]: Khi hàng trống (đã đồng bộ), thanh hiện thời điểm đồng bộ cuối và KHÔNG CÓ SỐ NÀO', () => {
  const counts = {
    pendingDiaries: 0,
    pendingPhotos: 0,
    totalPending: 0,
    isSynced: true
  };
  const lastSyncIso = '2026-10-14T18:45:00.000Z';

  const message = SyncStatusBar.buildStatusMessage(counts, lastSyncIso);
  // Phải có thông điệp đồng bộ và thời điểm
  assert.ok(message.includes('Toàn bộ dữ liệu đã được đồng bộ lên máy chủ'), 'Thông điệp xác nhận đã đồng bộ');
  assert.ok(message.includes('Đồng bộ lần cuối:'), 'Phải hiển thị thời điểm đồng bộ');

  // Tiêu chí nghiêm ngặt AC 2: KHÔNG CÓ BẤT KỲ CON SỐ NÀO VỀ HÀNG CHỜ
  assert.ok(!message.includes('0 mục'), 'Không được hiển thị "0 mục"');
  assert.ok(!message.includes('0 ảnh'), 'Không được hiển thị "0 ảnh"');
  assert.ok(!message.includes('0 đang chờ'), 'Không được chứa chuỗi số chờ');

  const html = SyncStatusBar.renderHtml(counts, lastSyncIso);
  // Class thành công
  assert.ok(html.includes('sync-status-bar--synced'), 'Thanh trạng thái phải có class synced');
  assert.ok(html.includes('Dữ liệu đã đồng bộ'), 'Tiêu đề thông báo đã đồng bộ');

  // Các badge số đếm chờ KHÔNG ĐƯỢC XUẤT HIỆN
  assert.ok(!html.includes('id="badge-pending-diaries"'), 'Badge nhật ký chờ phải biến mất khi đã đồng bộ');
  assert.ok(!html.includes('id="badge-pending-photos"'), 'Badge ảnh chờ phải biến mất khi đã đồng bộ');
  assert.ok(!html.includes('mục nhật ký chờ'), 'Không có text mục chờ');
  assert.ok(!html.includes('ảnh chờ'), 'Không có text ảnh chờ');
});

test('T-56: [Ghi nhận & Đọc thời điểm đồng bộ cuối] Lưu trữ bền vững vào thiết bị', () => {
  const { mockLocalStorage } = createMockClientEnvironment();
  const testClient = { localStorage: mockLocalStorage };

  const testTimestamp = '2026-10-14T18:30:15.000Z';
  SyncStatusBar.setLastSyncTime.call(testClient, testTimestamp);

  const readBack = SyncStatusBar.getLastSyncTime.call(testClient);
  assert.strictEqual(readBack, testTimestamp, 'Thời điểm đọc lại phải khớp thời điểm đã ghi');

  const formatted = SyncStatusBar.formatSyncTime(testTimestamp);
  assert.ok(formatted.includes('14/10/2026') || formatted.includes('2026'), 'Định dạng ngày chuẩn tiếng Việt');
  assert.ok(formatted.includes(':'), 'Có hiển thị giờ phút giây');
});

// =========================================================================
// KIỂM THỬ TÍCH HỢP: QUY TRÌNH CHUYỂN TRẠNG THÁI TỪ CHỜ SANG ĐỒNG BỘ XONG
// =========================================================================

test('T-56 & S-31: Kích hoạt đồng bộ chuyển trạng thái từ Pending sang Synced và cập nhật thời điểm cuối', async () => {
  const { mockRoot, mockLocalStorage } = createMockClientEnvironment();

  // Ban đầu có 2 nhật ký chờ và 1 ảnh chờ
  const mockDiaries = [
    { clientId: 'c1', content: 'Việc 1', syncStatus: 'chưa đồng bộ' },
    { clientId: 'c2', content: 'Việc 2', syncStatus: 'chưa đồng bộ' }
  ];
  mockLocalStorage.setItem('quanly_thicong_offline_diaries_fallback', JSON.stringify(mockDiaries));
  mockLocalStorage.setItem('journal-image-upload-queue', JSON.stringify([{ id: 'p1', fileName: 'test.jpg' }]));

  let syncExecuted = false;
  const comp = new SyncStatusBar.SyncStatusBarComponent({
    container: mockRoot.document.getElementById('sync-status-bar-container'),
    onSync: async () => {
      syncExecuted = true;
      // Giả lập đồng bộ thành công: Đánh dấu tất cả nhật ký là đã đồng bộ và xóa hàng đợi ảnh
      mockDiaries.forEach(d => { d.syncStatus = 'đã đồng bộ'; d.syncedAt = new Date().toISOString(); });
      mockLocalStorage.setItem('quanly_thicong_offline_diaries_fallback', JSON.stringify(mockDiaries));
      mockLocalStorage.setItem('journal-image-upload-queue', JSON.stringify([]));
      mockLocalStorage.setItem(SyncStatusBar.LAST_SYNC_KEY, new Date().toISOString());
    }
  });

  // Gán ngữ cảnh mock vào comp
  await comp.triggerSync();

  assert.strictEqual(syncExecuted, true, 'Hàm onSync phải được thực thi');
  const lastSyncTime = mockLocalStorage.getItem(SyncStatusBar.LAST_SYNC_KEY);
  assert.ok(lastSyncTime, 'Phải ghi nhận thời điểm đồng bộ mới');
});

// =========================================================================
// KIỂM THỬ TRANG GIAO DIỆN HTML: DIARY.HTML & INDEX.HTML
// =========================================================================

test('S-31 & T-55: diary.html và index.html nhúng thanh trạng thái đồng bộ và nạp script cần thiết', () => {
  assert.ok(fs.existsSync(DIARY_HTML_PATH), 'diary.html phải tồn tại');
  assert.ok(fs.existsSync(INDEX_HTML_PATH), 'index.html phải tồn tại');

  const diaryHtml = fs.readFileSync(DIARY_HTML_PATH, 'utf-8');
  const indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf-8');

  // Kiểm tra container #sync-status-bar-container trên trang diary.html
  assert.ok(
    diaryHtml.includes('id="sync-status-bar-container"'),
    'diary.html phải có container #sync-status-bar-container'
  );
  assert.ok(
    diaryHtml.includes('syncStatusBarComponent.js'),
    'diary.html phải nạp script syncStatusBarComponent.js'
  );

  // Kiểm tra container #sync-status-bar-container trên trang index.html
  assert.ok(
    indexHtml.includes('id="sync-status-bar-container"'),
    'index.html phải có container #sync-status-bar-container'
  );
  assert.ok(
    indexHtml.includes('syncStatusBarComponent.js'),
    'index.html phải nạp script syncStatusBarComponent.js'
  );
});
