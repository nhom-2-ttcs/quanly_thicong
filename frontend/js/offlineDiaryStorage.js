// Quản lý lưu trữ nhật ký ngoại tuyến với IndexedDB và Storage API
const DB_NAME = 'QuanLyThiCongDB';
const STORE_NAME = 'offline_diaries';
const DB_VERSION = 1;
export const LAST_SYNC_KEY = 'quanly_thicong_last_sync_time';
const FALLBACK_STORAGE_KEY = 'quanly_thicong_offline_diaries_fallback';

// Bộ nhớ dự phòng khi IndexedDB không khả dụng (ví dụ trong môi trường test/headless)
let memoryStore = [];

function getFallbackStore() {
  if (typeof localStorage !== 'undefined') {
    try {
      const data = localStorage.getItem(FALLBACK_STORAGE_KEY);
      if (data) return JSON.parse(data);
    } catch (e) {
      // Bỏ qua lỗi parse
    }
  }
  return memoryStore;
}

function saveFallbackStore(list) {
  memoryStore = list;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      // LocalStorage đầy hoặc bị chặn
    }
  }
}

function notifySyncStatusChanged(action, details = {}) {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('sync-status-changed', {
        detail: { action, ...details }
      }));
    } catch (e) {}
  }
}

export function openOfflineDB() {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // T-50: Mỗi mục có mã định danh sinh trên máy (clientId) làm key
        db.createObjectStore(STORE_NAME, { keyPath: 'clientId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// T-50: Lưu nhật ký và ảnh đính kèm với trạng thái "chưa đồng bộ"
export async function saveOfflineDiary({ content, photoDataUrl }) {
  const db = await openOfflineDB();
  const clientId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'offline-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);

  const diaryEntry = {
    clientId: clientId,
    content: content || '',
    photo: photoDataUrl || null,
    syncStatus: 'chưa đồng bộ',
    createdAt: new Date().toISOString()
  };

  if (!db) {
    const list = getFallbackStore();
    list.push(diaryEntry);
    saveFallbackStore(list);
    notifySyncStatusChanged('diary-saved', { entry: diaryEntry });
    return diaryEntry;
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(diaryEntry);
    req.onsuccess = () => {
      notifySyncStatusChanged('diary-saved', { entry: diaryEntry });
      resolve(diaryEntry);
    };
    req.onerror = () => reject(req.error);
  });
}

// T-50: Đọc toàn bộ danh sách nhật ký trên máy
export async function getOfflineDiaries() {
  const db = await openOfflineDB();
  if (!db) {
    return getFallbackStore();
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// T-55: Lấy danh sách các nhật ký đang chờ đồng bộ
export async function getPendingDiaries() {
  const all = await getOfflineDiaries();
  return all.filter(item => item.syncStatus !== 'đã đồng bộ' && item.syncStatus !== 'synced');
}

// T-55: Đếm số lượng nhật ký đang chờ đồng bộ (không gọi máy chủ)
export async function countPendingDiaries() {
  const pending = await getPendingDiaries();
  return pending.length;
}

// T-56: Đánh dấu một nhật ký đã đồng bộ lên máy chủ
export async function markDiarySynced(clientId) {
  const db = await openOfflineDB();
  if (!db) {
    const list = getFallbackStore();
    const item = list.find(d => d.clientId === clientId);
    if (item) {
      item.syncStatus = 'đã đồng bộ';
      item.syncedAt = new Date().toISOString();
      saveFallbackStore(list);
      notifySyncStatusChanged('diary-synced', { clientId });
    }
    return item || null;
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(clientId);
    getReq.onsuccess = () => {
      const item = getReq.result;
      if (!item) return resolve(null);
      item.syncStatus = 'đã đồng bộ';
      item.syncedAt = new Date().toISOString();
      const putReq = store.put(item);
      putReq.onsuccess = () => {
        notifySyncStatusChanged('diary-synced', { clientId });
        resolve(item);
      };
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

// T-56: Đánh dấu tất cả nhật ký là đã đồng bộ hoàn tất
export async function markAllDiariesSynced() {
  const db = await openOfflineDB();
  const now = new Date().toISOString();

  if (!db) {
    const list = getFallbackStore();
    let count = 0;
    list.forEach(item => {
      if (item.syncStatus !== 'đã đồng bộ' && item.syncStatus !== 'synced') {
        item.syncStatus = 'đã đồng bộ';
        item.syncedAt = now;
        count++;
      }
    });
    saveFallbackStore(list);
    recordLastSyncTime(now);
    notifySyncStatusChanged('all-synced', { count });
    return count;
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      let count = 0;
      all.forEach(item => {
        if (item.syncStatus !== 'đã đồng bộ' && item.syncStatus !== 'synced') {
          item.syncStatus = 'đã đồng bộ';
          item.syncedAt = now;
          store.put(item);
          count++;
        }
      });
      tx.oncomplete = () => {
        recordLastSyncTime(now);
        notifySyncStatusChanged('all-synced', { count });
        resolve(count);
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

// T-56: Ghi nhận thời điểm đồng bộ thành công gần nhất vào thiết bị
export function recordLastSyncTime(timestamp = new Date().toISOString()) {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(LAST_SYNC_KEY, timestamp);
    } catch (e) {}
  }
  return timestamp;
}

// T-56: Đọc thời điểm đồng bộ thành công gần nhất từ thiết bị
export function getLastSyncTime() {
  if (typeof localStorage !== 'undefined') {
    try {
      return localStorage.getItem(LAST_SYNC_KEY);
    } catch (e) {}
  }
  return null;
}

// T-51: Xin quyền lưu trữ bền để trình duyệt không tự xóa dữ liệu
export async function requestPersistentStorage() {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
    const isPersisted = await navigator.storage.persist();
    return isPersisted;
  }
  return false;
}

// T-51: Kiểm tra dung lượng còn lại và cảnh báo khi gần đầy
export async function checkStorageQuota(thresholdPercent = 80) {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate();
    const used = estimate.usage || 0;
    const total = estimate.quota || 0;
    const remainingBytes = Math.max(0, total - used);
    const remainingMB = (remainingBytes / (1024 * 1024)).toFixed(2);
    const percentUsed = total > 0 ? (used / total) * 100 : 0;

    return {
      usedMB: (used / (1024 * 1024)).toFixed(2),
      remainingMB: remainingMB,
      percentUsed: percentUsed.toFixed(1),
      isNearFull: percentUsed >= thresholdPercent
    };
  }
  return null;
}

// Gắn vào window để các script không dùng ES module có thể truy cập dễ dàng
if (typeof window !== 'undefined') {
  window.OfflineDiaryStorage = {
    openOfflineDB,
    saveOfflineDiary,
    getOfflineDiaries,
    getPendingDiaries,
    countPendingDiaries,
    markDiarySynced,
    markAllDiariesSynced,
    recordLastSyncTime,
    getLastSyncTime,
    requestPersistentStorage,
    checkStorageQuota,
    LAST_SYNC_KEY
  };
}
