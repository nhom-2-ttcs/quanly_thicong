// Quản lý lưu trữ nhật ký ngoại tuyến với IndexedDB và Storage API
const DB_NAME = 'QuanLyThiCongDB';
const STORE_NAME = 'offline_diaries';
const DB_VERSION = 1;

export function openOfflineDB() {
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
  const clientId = (crypto.randomUUID) ? crypto.randomUUID() : 'offline-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
  
  const diaryEntry = {
    clientId: clientId,
    content: content || '',
    photo: photoDataUrl || null,
    syncStatus: 'chưa đồng bộ',
    createdAt: new Date().toISOString()
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(diaryEntry);
    req.onsuccess = () => resolve(diaryEntry);
    req.onerror = () => reject(req.error);
  });
}

// T-50: Đọc toàn bộ danh sách nhật ký chưa đồng bộ
export async function getOfflineDiaries() {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// T-51: Xin quyền lưu trữ bền để trình duyệt không tự xóa dữ liệu
export async function requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    const isPersisted = await navigator.storage.persist();
    return isPersisted;
  }
  return false;
}

// T-51: Kiểm tra dung lượng còn lại và cảnh báo khi gần đầy
export async function checkStorageQuota(thresholdPercent = 80) {
  if (navigator.storage && navigator.storage.estimate) {
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
