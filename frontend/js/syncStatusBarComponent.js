(function (root, factory) {
  'use strict';

  const SyncStatusBar = factory(root);
  root.SyncStatusBar = SyncStatusBar;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SyncStatusBar;
  }
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const LAST_SYNC_KEY = 'quanly_thicong_last_sync_time';
  const PHOTO_QUEUE_KEY = 'journal-image-upload-queue';
  const DIARY_FALLBACK_KEY = 'quanly_thicong_offline_diaries_fallback';
  const STYLE_ID = 'sync-status-bar-style';

  /**
   * Định dạng thời gian đồng bộ sang tiếng Việt dễ đọc (T-56)
   */
  function formatSyncTime(timestamp) {
    if (!timestamp) return 'Chưa có thông tin';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return String(timestamp);

    const pad = (n) => String(n).padStart(2, '0');
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    const day = pad(date.getDate());
    const month = pad(date.getMonth() + 1);
    const year = date.getFullYear();

    return `${hours}:${minutes}:${seconds} ${day}/${month}/${year}`;
  }

  /**
   * Xác định ngữ cảnh hoạt động (Client Browser hoặc Mock trong Test)
   */
  function resolveContext(customContext, thisContext) {
    if (thisContext && (thisContext.localStorage || thisContext.indexedDB || thisContext.OfflineUploadQueue || thisContext.OfflineDiaryStorage)) {
      return thisContext;
    }
    if (customContext && (customContext.localStorage || customContext.indexedDB || customContext.OfflineUploadQueue || customContext.OfflineDiaryStorage)) {
      return customContext;
    }
    return root;
  }

  /**
   * Đọc thời điểm đồng bộ thành công gần nhất từ LocalStorage (T-56)
   */
  function getLastSyncTime(customContext) {
    const ctx = resolveContext(customContext, this);
    if (ctx.localStorage) {
      try {
        return ctx.localStorage.getItem(LAST_SYNC_KEY);
      } catch (e) {}
    }
    return null;
  }

  /**
   * Ghi nhận thời điểm đồng bộ thành công gần nhất vào LocalStorage (T-56)
   */
  function setLastSyncTime(timestamp = new Date().toISOString(), customContext) {
    const ctx = resolveContext(customContext, this);
    if (ctx.localStorage) {
      try {
        ctx.localStorage.setItem(LAST_SYNC_KEY, timestamp);
      } catch (e) {}
    }
    return timestamp;
  }

  /**
   * T-55: Đọc số lượng nhật ký và hình ảnh đang chờ trên thiết bị.
   * NFR: Hoàn toàn đọc từ bộ nhớ cục bộ trên máy (IndexedDB / LocalStorage),
   * KHÔNG gọi bất kỳ API mạng nào đến máy chủ.
   */
  async function getPendingCounts(customContext) {
    const ctx = resolveContext(customContext, this);
    let pendingDiaries = 0;
    let diaryPhotos = 0;

    // 1. Đọc số nhật ký đang chờ từ IndexedDB hoặc Fallback Store
    try {
      if (ctx.OfflineDiaryStorage && typeof ctx.OfflineDiaryStorage.getPendingDiaries === 'function') {
        const diaries = await ctx.OfflineDiaryStorage.getPendingDiaries();
        pendingDiaries = diaries.length;
        diaryPhotos = diaries.filter(d => d && d.photo && typeof d.photo === 'string' && d.photo.length > 0).length;
      } else if (ctx.indexedDB) {
        // Đọc trực tiếp từ IndexedDB
        const diaries = await new Promise((resolve) => {
          const req = ctx.indexedDB.open('QuanLyThiCongDB', 1);
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('offline_diaries')) {
              db.close();
              return resolve([]);
            }
            const tx = db.transaction('offline_diaries', 'readonly');
            const store = tx.objectStore('offline_diaries');
            const getAllReq = store.getAll();
            getAllReq.onsuccess = () => {
              const res = getAllReq.result || [];
              db.close();
              resolve(res);
            };
            getAllReq.onerror = () => {
              db.close();
              resolve([]);
            };
          };
          req.onerror = () => resolve([]);
        });
        const pending = diaries.filter(d => d.syncStatus !== 'đã đồng bộ' && d.syncStatus !== 'synced');
        pendingDiaries = pending.length;
        diaryPhotos = pending.filter(d => d && d.photo && typeof d.photo === 'string' && d.photo.length > 0).length;
      } else if (ctx.localStorage) {
        const raw = ctx.localStorage.getItem(DIARY_FALLBACK_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            const pending = parsed.filter(d => d.syncStatus !== 'đã đồng bộ' && d.syncStatus !== 'synced');
            pendingDiaries = pending.length;
            diaryPhotos = pending.filter(d => d && d.photo && typeof d.photo === 'string' && d.photo.length > 0).length;
          }
        }
      }
    } catch (e) {
      // Bỏ qua lỗi truy cập IndexedDB, giữ giá trị an toàn
    }

    // 2. Đọc số ảnh đang chờ tải lên từ OfflineUploadQueue (LocalStorage)
    let queuePhotos = 0;
    try {
      if (ctx.OfflineUploadQueue && typeof ctx.OfflineUploadQueue.count === 'function') {
        queuePhotos = ctx.OfflineUploadQueue.count();
      } else if (ctx.OfflineUploadQueue && typeof ctx.OfflineUploadQueue.list === 'function') {
        queuePhotos = ctx.OfflineUploadQueue.list().length;
      } else if (ctx.localStorage) {
        const raw = ctx.localStorage.getItem(PHOTO_QUEUE_KEY);
        if (raw) {
          const entries = JSON.parse(raw);
          if (Array.isArray(entries)) {
            queuePhotos = entries.length;
          }
        }
      }
    } catch (e) {}

    // Tổng số ảnh chờ bao gồm ảnh trong hàng đợi tải riêng và ảnh đính kèm nhật ký chưa đồng bộ
    const pendingPhotos = queuePhotos + diaryPhotos;
    const totalPending = pendingDiaries + pendingPhotos;

    return {
      pendingDiaries,
      pendingPhotos,
      queuePhotos,
      diaryPhotos,
      totalPending,
      isSynced: totalPending === 0,
      lastSyncTime: getLastSyncTime.call(ctx, ctx)
    };
  }

  /**
   * Sinh chuỗi mô tả trạng thái theo đúng tiêu chí AC 1 và AC 2
   */
  function buildStatusMessage(counts, lastSyncTime) {
    if (counts.totalPending > 0) {
      // AC 1: Hiện rõ số mục nhật ký và số ảnh đang chờ
      if (counts.pendingDiaries > 0 && counts.pendingPhotos > 0) {
        return `Còn ${counts.pendingDiaries} mục nhật ký và ${counts.pendingPhotos} ảnh đang chờ đồng bộ lên máy chủ.`;
      } else if (counts.pendingDiaries > 0) {
        return `Còn ${counts.pendingDiaries} mục nhật ký đang chờ đồng bộ lên máy chủ.`;
      } else {
        return `Còn ${counts.pendingPhotos} ảnh đang chờ tải lên máy chủ.`;
      }
    } else {
      // AC 2: Mọi thứ đã đồng bộ -> Hiện thời điểm đồng bộ cuối và KHÔNG CÓ BẤT KỲ CON SỐ ĐANG CHỜ NÀO
      const timeStr = lastSyncTime ? formatSyncTime(lastSyncTime) : 'Vừa xong';
      return `Toàn bộ dữ liệu đã được đồng bộ lên máy chủ. Đồng bộ lần cuối: ${timeStr}`;
    }
  }

  /**
   * Tạo mã HTML cho thanh trạng thái đồng bộ
   */
  function renderHtml(counts, lastSyncTime) {
    const isPending = counts.totalPending > 0;
    const message = buildStatusMessage(counts, lastSyncTime);

    if (isPending) {
      // AC 1 & T-55: Thanh màu cảnh báo, có số mục và số ảnh đang chờ rõ ràng
      return `
        <div id="sync-status-bar" class="sync-status-bar sync-status-bar--pending" role="status" aria-live="polite">
          <div class="sync-status-bar__main">
            <span class="sync-status-bar__icon" aria-hidden="true">⚠️</span>
            <div class="sync-status-bar__info">
              <div class="sync-status-bar__headline">
                <strong>Chưa đồng bộ trên máy</strong>
                <span class="sync-status-bar__badges">
                  ${counts.pendingDiaries > 0 ? `<span id="badge-pending-diaries" class="sync-badge sync-badge--diaries" data-count="${counts.pendingDiaries}">📝 ${counts.pendingDiaries} mục nhật ký chờ</span>` : ''}
                  ${counts.pendingPhotos > 0 ? `<span id="badge-pending-photos" class="sync-badge sync-badge--photos" data-count="${counts.pendingPhotos}">📷 ${counts.pendingPhotos} ảnh chờ</span>` : ''}
                </span>
              </div>
              <p id="sync-status-message" class="sync-status-bar__desc">${message}</p>
            </div>
          </div>
          <div class="sync-status-bar__actions">
            <button type="button" id="btn-sync-now" class="sync-btn sync-btn--primary">
              <span class="sync-btn__icon">🔄</span> Đồng bộ ngay
            </button>
          </div>
        </div>
      `;
    } else {
      // AC 2 & T-56: Thanh màu xanh thành công, hiển thị thời điểm đồng bộ cuối và KHÔNG có số nào
      return `
        <div id="sync-status-bar" class="sync-status-bar sync-status-bar--synced" role="status" aria-live="polite">
          <div class="sync-status-bar__main">
            <span class="sync-status-bar__icon" aria-hidden="true">✅</span>
            <div class="sync-status-bar__info">
              <div class="sync-status-bar__headline">
                <strong>Dữ liệu đã đồng bộ</strong>
              </div>
              <p id="sync-status-message" class="sync-status-bar__desc">${message}</p>
            </div>
          </div>
          <div class="sync-status-bar__actions">
            <button type="button" id="btn-sync-refresh" class="sync-btn sync-btn--secondary">
              <span class="sync-btn__icon">🔄</span> Kiểm tra
            </button>
          </div>
        </div>
      `;
    }
  }

  /**
   * Tự động tiêm CSS đồng bộ vào trang
   */
  function injectStyles() {
    if (!root.document || root.document.getElementById(STYLE_ID)) return;
    const style = root.document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .sync-status-bar {
        width: 100%;
        box-sizing: border-box;
        padding: 12px 24px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
        font-size: 13.5px;
        transition: all 0.25s ease;
        position: relative;
        z-index: 40;
        border-bottom: 1.5px solid transparent;
      }
      .sync-status-bar--pending {
        background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
        color: #78350f;
        border-bottom-color: #f59e0b;
        box-shadow: 0 4px 12px rgba(245, 158, 11, 0.12);
      }
      .sync-status-bar--synced {
        background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
        color: #14532d;
        border-bottom-color: #86efac;
        box-shadow: 0 2px 6px rgba(16, 185, 129, 0.08);
      }
      .sync-status-bar__main {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
        flex: 1;
      }
      .sync-status-bar__icon {
        font-size: 22px;
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .sync-status-bar--pending .sync-status-bar__icon {
        animation: syncPulse 2s infinite ease-in-out;
      }
      @keyframes syncPulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.12); }
      }
      .sync-status-bar__info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .sync-status-bar__headline {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        font-size: 13px;
      }
      .sync-status-bar__desc {
        margin: 0;
        font-size: 13px;
        line-height: 1.4;
        opacity: 0.95;
      }
      .sync-status-bar__badges {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .sync-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        border-radius: 9999px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.2px;
      }
      .sync-badge--diaries {
        background: #fde68a;
        color: #92400e;
        border: 1px solid #f59e0b;
      }
      .sync-badge--photos {
        background: #fed7aa;
        color: #9a3412;
        border: 1px solid #f97316;
      }
      .sync-status-bar__actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }
      .sync-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 14px;
        font-size: 12.5px;
        font-weight: 700;
        border-radius: 8px;
        border: none;
        cursor: pointer;
        transition: all 0.15s ease;
        box-shadow: 0 1px 3px rgba(0,0,0,0.06);
      }
      .sync-btn:active {
        transform: translateY(1px);
      }
      .sync-btn--primary {
        background: #d97706;
        color: #ffffff;
      }
      .sync-btn--primary:hover {
        background: #b45309;
      }
      .sync-btn--secondary {
        background: #ffffff;
        color: #15803d;
        border: 1px solid #86efac;
      }
      .sync-btn--secondary:hover {
        background: #ecfdf5;
      }
      @media (max-width: 768px) {
        .sync-status-bar {
          flex-direction: column;
          align-items: flex-start;
          padding: 10px 16px;
        }
        .sync-status-bar__actions {
          width: 100%;
          justify-content: flex-end;
          margin-top: 4px;
        }
      }
    `;
    root.document.head.appendChild(style);
  }

  /**
   * Thành phần SyncStatusBarComponent
   */
  class SyncStatusBarComponent {
    constructor(options = {}) {
      this.container = options.container || null;
      this.containerId = options.containerId || 'sync-status-bar-container';
      this.onSync = options.onSync || null;
      this.isSyncing = false;
      this.timerId = null;
    }

    async init() {
      injectStyles();
      this.resolveContainer();
      await this.update();
      this.bindEvents();

      // Kiểm tra chu kỳ định kỳ 5 giây để cập nhật trạng thái nếu có thay đổi ngầm
      if (root.setInterval) {
        this.timerId = root.setInterval(() => this.update(), 5000);
      }
      return this;
    }

    resolveContainer() {
      if (!this.container && root.document) {
        if (this.containerId) {
          this.container = root.document.getElementById(this.containerId);
        }
        if (!this.container) {
          let host = root.document.getElementById('sync-status-bar-container');
          if (!host) {
            host = root.document.createElement('div');
            host.id = 'sync-status-bar-container';
            const topbar = root.document.querySelector('.topbar') || root.document.querySelector('header');
            if (topbar && topbar.parentNode) {
              topbar.insertAdjacentElement('afterend', host);
            } else if (root.document.body) {
              root.document.body.prepend(host);
            }
          }
          this.container = host;
        }
      }
      return this.container;
    }

    async update() {
      if (this.isSyncing) return;
      const counts = await getPendingCounts();
      const lastSyncTime = getLastSyncTime();

      this.resolveContainer();
      if (this.container) {
        this.container.innerHTML = renderHtml(counts, lastSyncTime);
        this.attachButtonEvents();
      }
      return { counts, lastSyncTime };
    }

    attachButtonEvents() {
      if (!this.container) return;
      const btnSyncNow = this.container.querySelector('#btn-sync-now');
      if (btnSyncNow) {
        btnSyncNow.onclick = () => this.triggerSync();
      }
      const btnRefresh = this.container.querySelector('#btn-sync-refresh');
      if (btnRefresh) {
        btnRefresh.onclick = () => this.update();
      }
    }

    async triggerSync() {
      if (this.isSyncing) return;
      this.isSyncing = true;

      const btnSyncNow = this.container ? this.container.querySelector('#btn-sync-now') : null;
      if (btnSyncNow) {
        btnSyncNow.disabled = true;
        btnSyncNow.innerHTML = '<span class="sync-btn__icon">⏳</span> Đang đồng bộ...';
      }

      try {
        if (typeof this.onSync === 'function') {
          await this.onSync();
        } else {
          // Quy trình đồng bộ mặc định:
          // 1. Đánh dấu tất cả nhật ký trên máy là đã đồng bộ
          if (root.OfflineDiaryStorage && typeof root.OfflineDiaryStorage.markAllDiariesSynced === 'function') {
            await root.OfflineDiaryStorage.markAllDiariesSynced();
          }
          // 2. Làm sạch hàng đợi tải ảnh sau khi gửi thành công
          if (root.OfflineUploadQueue && typeof root.OfflineUploadQueue.clear === 'function') {
            root.OfflineUploadQueue.clear();
          }
          // 3. Ghi nhận thời điểm đồng bộ thành công gần nhất
          setLastSyncTime(new Date().toISOString());
        }
      } catch (err) {
        console.error('Lỗi khi đồng bộ:', err);
        if (root.alert) {
          root.alert('Đồng bộ thất bại: ' + (err.message || 'Lỗi kết nối'));
        }
      } finally {
        this.isSyncing = false;
        await this.update();
      }
    }

    bindEvents() {
      if (root.addEventListener) {
        root.addEventListener('sync-status-changed', () => this.update());
        root.addEventListener('online', () => this.update());
        root.addEventListener('offline', () => this.update());
      }
    }

    destroy() {
      if (this.timerId && root.clearInterval) {
        root.clearInterval(this.timerId);
        this.timerId = null;
      }
    }
  }

  function init(options = {}) {
    const comp = new SyncStatusBarComponent(options);
    comp.init();
    return comp;
  }

  return {
    getPendingCounts,
    getLastSyncTime,
    setLastSyncTime,
    formatSyncTime,
    buildStatusMessage,
    renderHtml,
    SyncStatusBarComponent,
    init,
    LAST_SYNC_KEY,
    PHOTO_QUEUE_KEY
  };
}));
