(function (root, factory) {
  'use strict';

  const BackgroundPhotoQueue = factory(root);
  root.BackgroundPhotoQueue = BackgroundPhotoQueue;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BackgroundPhotoQueue;
  }
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const STORAGE_KEY = 'diary-background-photo-queue';
  const MAX_RETRIES = 5;

  let isProcessing = false;
  let isPaused = false;
  let activeListeners = {
    progress: [],
    'item-success': [],
    'item-error': [],
    'queue-empty': []
  };

  function getStorage() {
    if (root.localStorage) return root.localStorage;
    // In-memory fallback if localStorage is absent (e.g. Node.js unit tests)
    if (!root._mockLocalStorage) {
      const mem = {};
      root._mockLocalStorage = {
        getItem: (k) => mem[k] || null,
        setItem: (k, v) => { mem[k] = String(v); },
        removeItem: (k) => { delete mem[k]; }
      };
    }
    return root._mockLocalStorage;
  }

  function readQueue() {
    try {
      const raw = getStorage().getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function saveQueue(queue) {
    try {
      getStorage().setItem(STORAGE_KEY, JSON.stringify(queue));
    } catch (e) {
      console.warn('[PhotoQueue] Không thể lưu vào storage:', e.message);
    }
  }

  function generateId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') {
      return root.crypto.randomUUID();
    }
    return 'photo_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  }

  function blobToDataUrl(blob) {
    if (blob.dataUrl) return Promise.resolve(blob.dataUrl);
    return new Promise((resolve, reject) => {
      if (typeof root.FileReader === 'undefined') {
        return resolve('data:' + (blob.type || 'image/jpeg') + ';base64,');
      }
      const reader = new root.FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Không thể đọc file ảnh'));
      reader.readAsDataURL(blob);
    });
  }

  async function dataUrlToBlob(dataUrl, fileName, mimeType) {
    if (!dataUrl || typeof dataUrl !== 'string') {
      return new (root.Blob || class {})([], { type: mimeType || 'image/jpeg' });
    }
    if (typeof root.fetch === 'function' && dataUrl.startsWith('data:')) {
      try {
        const res = await root.fetch(dataUrl);
        return await res.blob();
      } catch (_) {}
    }

    const parts = dataUrl.split(',');
    const byteString = root.atob ? root.atob(parts[1] || '') : Buffer.from(parts[1] || '', 'base64').toString('binary');
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return new (root.Blob || Blob)([ab], { type: mimeType || 'image/jpeg' });
  }

  function emit(eventName, payload) {
    const list = activeListeners[eventName] || [];
    list.forEach(fn => {
      try { fn(payload); } catch (e) { console.warn(e); }
    });
  }

  /**
   * Đưa 1 hoặc nhiều ảnh vào hàng đợi tải nền (T-60 / T-62)
   */
  async function enqueueBatch({ projectId, diaryDate, photos }) {
    if (!Array.isArray(photos) || photos.length === 0) return [];
    const queue = readQueue();
    const createdItems = [];

    for (const item of photos) {
      const fileObj = item.file || item;
      const clientPhotoId = item.id || item.clientPhotoId || generateId();
      let dataUrl = item.dataUrl || item.previewUrl;

      if (!dataUrl && fileObj && typeof fileObj.slice === 'function') {
        try {
          dataUrl = await blobToDataUrl(fileObj);
        } catch (_) {
          dataUrl = '';
        }
      }

      const queueItem = {
        id: clientPhotoId,
        projectId: Number(projectId || 1),
        diaryDate: String(diaryDate),
        fileName: fileObj.name || item.name || item.fileName || 'photo.jpg',
        fileSize: Number(fileObj.size || item.size || item.fileSize || 0),
        fileType: fileObj.type || item.type || item.fileType || 'image/jpeg',
        caption: item.caption || '',
        dataUrl: dataUrl || '',
        status: 'pending', // 'pending' | 'uploading' | 'completed' | 'failed'
        attempts: 0,
        lastError: null,
        createdAt: new Date().toISOString()
      };

      queue.push(queueItem);
      createdItems.push(queueItem);
    }

    saveQueue(queue);
    emitProgress();

    // Tự động kích hoạt xử lý nền nếu đang rảnh
    if (!isProcessing && !isPaused) {
      processNext();
    }

    return createdItems;
  }

  /**
   * Lấy số lượng ảnh còn chờ tải
   */
  function getPendingCount() {
    const queue = readQueue();
    return queue.filter(item => item.status === 'pending' || item.status === 'uploading' || item.status === 'failed').length;
  }

  function getStats() {
    const queue = readQueue();
    const total = queue.length;
    const pending = queue.filter(i => i.status === 'pending').length;
    const uploading = queue.filter(i => i.status === 'uploading').length;
    const failed = queue.filter(i => i.status === 'failed').length;
    const completed = queue.filter(i => i.status === 'completed').length;
    return { total, pending, uploading, failed, completed };
  }

  function emitProgress(activeItem) {
    const stats = getStats();
    emit('progress', {
      ...stats,
      activeItem: activeItem || null,
      isOnline: typeof root.navigator !== 'undefined' ? (root.navigator.onLine !== false) : true
    });
  }

  /**
   * Xử lý lần lượt từng ảnh trong hàng đợi ở nền (AC 1 & T-62)
   */
  async function processNext() {
    if (isProcessing || isPaused) return;

    // Kiểm tra kết nối mạng
    if (typeof root.navigator !== 'undefined' && root.navigator.onLine === false) {
      isProcessing = false;
      emitProgress();
      return;
    }

    const queue = readQueue();
    const nextIdx = queue.findIndex(i => i.status === 'pending' || (i.status === 'failed' && i.attempts < MAX_RETRIES));

    if (nextIdx === -1) {
      isProcessing = false;
      emitProgress();
      emit('queue-empty', {});
      return;
    }

    const currentItem = queue[nextIdx];
    currentItem.status = 'uploading';
    currentItem.attempts += 1;
    saveQueue(queue);

    isProcessing = true;
    emitProgress(currentItem);

    try {
      // Chuẩn bị FormData tải ảnh đơn lẻ
      const blob = await dataUrlToBlob(currentItem.dataUrl, currentItem.fileName, currentItem.fileType);
      const formData = new (root.FormData || FormData)();

      // Nếu môi trường hỗ trợ File constructor
      let uploadFile = blob;
      if (typeof root.File === 'function') {
        try {
          uploadFile = new root.File([blob], currentItem.fileName, { type: currentItem.fileType });
        } catch (_) {}
      }

      formData.append('photo', uploadFile, currentItem.fileName);
      formData.append('client_photo_id', currentItem.id);
      let result;
      if (typeof BackgroundPhotoQueue.uploadHandler === 'function') {
        result = await BackgroundPhotoQueue.uploadHandler(currentItem, formData);
      } else {
        const token = root.localStorage ? root.localStorage.getItem('quanly_token') : null;
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        let baseUrl = '';
        if (typeof root.location !== 'undefined' && root.location.origin) {
          baseUrl = root.location.origin;
        } else if (typeof BackgroundPhotoQueue.apiBaseUrl === 'string') {
          baseUrl = BackgroundPhotoQueue.apiBaseUrl;
        } else if (typeof process !== 'undefined' && process.env.PORT) {
          baseUrl = `http://localhost:${process.env.PORT}`;
        } else {
          baseUrl = 'http://localhost:5000';
        }

        const uploadUrl = `${baseUrl}/api/projects/${currentItem.projectId}/diaries/${currentItem.diaryDate}/photos/upload-single`;

        const res = await (root.fetch || fetch)(uploadUrl, {
          method: 'POST',
          headers,
          body: formData
        });

        if (!res.ok) {
          const errorText = await res.text().catch(() => '');
          let errorMsg = `Máy chủ trả về HTTP ${res.status}`;
          try {
            const errJson = JSON.parse(errorText);
            errorMsg = errJson.message || errorMsg;
          } catch (_) {}
          throw new Error(errorMsg);
        }

        result = await res.json();
      }

      // Đánh dấu hoàn tất
      const updatedQueue = readQueue();
      const finishIdx = updatedQueue.findIndex(i => i.id === currentItem.id);
      if (finishIdx !== -1) {
        // Xóa khỏi hàng chờ để giải phóng bộ nhớ
        updatedQueue.splice(finishIdx, 1);
        saveQueue(updatedQueue);
      }

      emit('item-success', {
        item: currentItem,
        result: result?.photo || result
      });

      isProcessing = false;
      emitProgress();

      // Tiếp tục tải ảnh tiếp theo trong hàng đợi (AC 1)
      setTimeout(processNext, 100);

    } catch (err) {
      console.warn('[PhotoQueue] Tải ảnh thất bại:', currentItem.fileName, err.message);

      const updatedQueue = readQueue();
      const failIdx = updatedQueue.findIndex(i => i.id === currentItem.id);
      if (failIdx !== -1) {
        updatedQueue[failIdx].status = 'failed';
        updatedQueue[failIdx].lastError = err.message || 'Lỗi mạng hoặc máy chủ';
        saveQueue(updatedQueue);
      }

      emit('item-error', {
        item: currentItem,
        error: err.message
      });

      isProcessing = false;
      emitProgress();

      // Nếu mất mạng hoặc mạng gián đoạn (AC 2 & T-61):
      // Đợi sự kiện 'online' hoặc retry với backoff
      const isOffline = typeof root.navigator !== 'undefined' && root.navigator.onLine === false;
      if (!isOffline && currentItem.attempts < MAX_RETRIES) {
        // Thử lại sau 3s (Backoff)
        setTimeout(processNext, 3000);
      }
    }
  }

  function pause() {
    isPaused = true;
  }

  function resume() {
    isPaused = false;
    if (!isProcessing) {
      processNext();
    }
  }

  function retryFailed() {
    const queue = readQueue();
    queue.forEach(item => {
      if (item.status === 'failed') {
        item.status = 'pending';
        item.attempts = 0;
        item.lastError = null;
      }
    });
    saveQueue(queue);
    resume();
  }

  function clearAll() {
    saveQueue([]);
    isProcessing = false;
    emitProgress();
  }

  function addEventListener(eventName, fn) {
    if (!activeListeners[eventName]) activeListeners[eventName] = [];
    activeListeners[eventName].push(fn);
    return () => {
      activeListeners[eventName] = activeListeners[eventName].filter(cb => cb !== fn);
    };
  }

  // Tự động lắng nghe sự kiện online / offline của trình duyệt (AC 2 / T-61)
  if (typeof root.addEventListener === 'function') {
    root.addEventListener('online', () => {
      console.log('[PhotoQueue] 🟢 Đã kết nối lại mạng! Tự động tiếp tục tải ảnh nền...');
      resume();
    });

    root.addEventListener('offline', () => {
      console.log('[PhotoQueue] 🔴 Mất kết nối mạng. Tạm dừng hàng đợi tải ảnh an toàn.');
      pause();
    });
  }

  return {
    enqueueBatch,
    readQueue,
    getPendingCount,
    getStats,
    processNext,
    pause,
    resume,
    retryFailed,
    clearAll,
    on: addEventListener,
    STORAGE_KEY
  };
}));
