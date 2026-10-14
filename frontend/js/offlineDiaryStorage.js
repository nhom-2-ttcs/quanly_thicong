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

// T-50 & S-29: Lưu nhật ký có cấu trúc đầy đủ và ảnh đính kèm với trạng thái "chưa đồng bộ"
export async function saveOfflineDiary(entryData = {}) {
  const db = await openOfflineDB();
  const clientId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'offline-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);

  // Chuẩn hoá dữ liệu nhật ký có cấu trúc đầy đủ (S-29)
  const diaryEntry = {
    clientId: entryData.clientId || clientId,
    client_diary_id: entryData.client_diary_id || entryData.clientId || clientId,
    project_id: Number(entryData.project_id || 1),
    diary_date: entryData.diary_date || new Date().toISOString().split('T')[0],
    weather_condition: entryData.weather_condition || 'sunny',
    temperature_min: entryData.temperature_min !== undefined ? entryData.temperature_min : null,
    temperature_max: entryData.temperature_max !== undefined ? entryData.temperature_max : null,
    weather_notes: entryData.weather_notes || '',
    manpower_count: Number(entryData.manpower_count || 0),
    equipment_status: entryData.equipment_status || '',
    work_notes: entryData.work_notes || entryData.content || '',
    content: entryData.content || entryData.work_notes || '',
    items: Array.isArray(entryData.items) ? entryData.items.map(it => ({
      client_item_id: it.client_item_id || ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'item-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9)),
      work_item_id: it.work_item_id || null,
      work_content: it.work_content || it.content || '',
      log_time: it.log_time || null,
      quantity_done: Number(it.quantity_done || 0),
      unit: it.unit || ''
    })) : [],
    photo: entryData.photo || entryData.photoDataUrl || null,
    photos: Array.isArray(entryData.photos) ? entryData.photos : (entryData.photo || entryData.photoDataUrl ? [{
      client_photo_id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'photo-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9),
      dataUrl: entryData.photo || entryData.photoDataUrl,
      file_name: entryData.fileName || 'photo.jpg'
    }] : []),
    syncStatus: 'chưa đồng bộ',
    lastError: null,
    syncAttempts: 0,
    createdAt: entryData.createdAt || new Date().toISOString()
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

// S-30: Đánh dấu một mục nhật ký đồng bộ thất bại kèm lý do lỗi (không chặn mục khác)
export async function markDiarySyncFailed(clientId, errorMessage) {
  const db = await openOfflineDB();
  const errorReason = String(errorMessage || 'Lỗi đồng bộ không xác định');

  if (!db) {
    const list = getFallbackStore();
    const item = list.find(d => d.clientId === clientId);
    if (item) {
      item.syncStatus = 'lỗi đồng bộ';
      item.lastError = errorReason;
      item.syncAttempts = (item.syncAttempts || 0) + 1;
      item.lastAttemptAt = new Date().toISOString();
      saveFallbackStore(list);
      notifySyncStatusChanged('diary-sync-failed', { clientId, error: errorReason });
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
      item.syncStatus = 'lỗi đồng bộ';
      item.lastError = errorReason;
      item.syncAttempts = (item.syncAttempts || 0) + 1;
      item.lastAttemptAt = new Date().toISOString();
      const putReq = store.put(item);
      putReq.onsuccess = () => {
        notifySyncStatusChanged('diary-sync-failed', { clientId, error: errorReason });
        resolve(item);
      };
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
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

let activeSyncPromise = null;

// S-30 / SCRUM-143: Tự động đồng bộ các nhật ký ngoại tuyến theo thứ tự tạo
export function syncPendingDiaries(apiBaseUrl = '') {
  if (activeSyncPromise) {
    return activeSyncPromise;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return Promise.resolve({ synced: 0, failed: 0, total: 0, offline: true });
  }

  notifySyncStatusChanged('sync-started');

  activeSyncPromise = (async () => {
    try {
      const pendingList = await getPendingDiaries();
      // Đồng bộ theo đúng thứ tự tạo (FIFO)
      pendingList.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

      let syncedCount = 0;
      let failedCount = 0;

      for (const entry of pendingList) {
        try {
          const projectId = entry.project_id || 1;
          const payload = {
            client_diary_id: entry.client_diary_id || entry.clientId,
            diary_date: entry.diary_date,
            weather_condition: entry.weather_condition || 'sunny',
            manpower_count: entry.manpower_count || 0,
            equipment_status: entry.equipment_status || '',
            work_notes: entry.work_notes || entry.content || '',
            items: entry.items || [],
            photos: (Array.isArray(entry.photos) && entry.photos.length > 0)
              ? entry.photos.map(p => ({ data: p.dataUrl || p.data, filename: p.file_name || p.name || 'photo.jpg', caption: p.caption || '' }))
              : (entry.photo ? [{ data: entry.photo, filename: entry.fileName || 'photo.jpg' }] : [])
          };

          const res = await fetch(`${apiBaseUrl}/api/projects/${projectId}/diaries`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          });

          if (res.ok) {
            await markDiarySynced(entry.clientId);
            syncedCount++;
          } else {
            let errText = `HTTP ${res.status}`;
            try {
              const errData = await res.json();
              errText = errData.message || errText;
            } catch (_) {}
            await markDiarySyncFailed(entry.clientId, errText);
            failedCount++;
            // Không ngắt vòng lặp: các mục sau vẫn tiếp tục đồng bộ (S-30)
          }
        } catch (networkErr) {
          // Lỗi kết nối mạng: đánh dấu thất bại mục hiện tại, tiếp tục
          await markDiarySyncFailed(entry.clientId, networkErr.message || 'Mất kết nối mạng khi gửi');
          failedCount++;
        }
      }

      if (syncedCount > 0) {
        recordLastSyncTime();
      }

      notifySyncStatusChanged('sync-finished', { synced: syncedCount, failed: failedCount });
      return { synced: syncedCount, failed: failedCount, total: pendingList.length };
    } finally {
      activeSyncPromise = null;
    }
  })();

  return activeSyncPromise;
}

// Chờ cho đến khi toàn bộ nhật ký đang chờ được đồng bộ hoàn tất
export async function waitForAllDiariesSynced(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (activeSyncPromise) {
      await activeSyncPromise;
    }
    const pending = await getPendingDiaries();
    if (pending.length === 0) {
      return true;
    }
    await new Promise(r => setTimeout(r, 50));
  }
  return (await getPendingDiaries()).length === 0;
}

// Tự động lắng nghe sự kiện có mạng lại để tự động đồng bộ (S-30)
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[OfflineDiaryStorage] 🟢 Có kết nối mạng trở lại, kích hoạt tự động đồng bộ...');
    syncPendingDiaries().catch(e => console.warn('[AutoSync] Lỗi:', e));
  });
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
    markDiarySyncFailed,
    markAllDiariesSynced,
    syncPendingDiaries,
    waitForAllDiariesSynced,
    recordLastSyncTime,
    getLastSyncTime,
    requestPersistentStorage,
    checkStorageQuota,
    LAST_SYNC_KEY
  };
}
