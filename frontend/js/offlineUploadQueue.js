(function (root, factory) {
  'use strict';

  const queue = factory(root);
  root.OfflineUploadQueue = queue;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = queue;
  }
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const STORAGE_KEY = 'journal-image-upload-queue';

  function getStorage() {
    if (!root.localStorage) {
      throw new Error('Trình duyệt không hỗ trợ LocalStorage.');
    }
    return root.localStorage;
  }

  function readQueue() {
    const value = getStorage().getItem(STORAGE_KEY);
    if (!value) return [];

    let entries;
    try {
      entries = JSON.parse(value);
    } catch (error) {
      throw new Error('Hàng chờ tải ảnh trong LocalStorage bị lỗi định dạng.', { cause: error });
    }
    if (!Array.isArray(entries)) {
      throw new Error('Dữ liệu hàng chờ tải ảnh không hợp lệ.');
    }
    return entries;
  }

  function saveQueue(entries) {
    try {
      getStorage().setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch (error) {
      throw new Error(
        'Không thể lưu hàng chờ tải ảnh. LocalStorage có thể đã hết dung lượng.',
        { cause: error }
      );
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new root.FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Không thể đọc dữ liệu ảnh để lưu ngoại tuyến.'));
      reader.readAsDataURL(blob);
    });
  }

  async function dataUrlToFile(entry) {
    const response = await root.fetch(entry.fileDataUrl);
    const blob = await response.blob();
    return new root.File(
      [blob],
      entry.fileName,
      { type: entry.fileType, lastModified: entry.lastModified }
    );
  }

  function createId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') {
      return root.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  async function enqueue(file, metadata) {
    if (!file || typeof file.size !== 'number' || typeof file.name !== 'string') {
      throw new TypeError('Cần truyền một tệp ảnh hợp lệ để đưa vào hàng chờ.');
    }

    const entries = readQueue();
    const entry = {
      id: createId(),
      fileName: file.name,
      fileType: file.type || 'application/octet-stream',
      lastModified: file.lastModified || Date.now(),
      fileDataUrl: await blobToDataUrl(file),
      metadata: metadata || {},
      createdAt: new Date().toISOString(),
      attempts: 0,
      lastError: ''
    };

    entries.push(entry);
    saveQueue(entries);
    if (root.dispatchEvent && typeof root.CustomEvent === 'function') {
      root.dispatchEvent(new root.CustomEvent('sync-status-changed', {
        detail: { action: 'photo-enqueued', entry: Object.assign({}, entry, { fileDataUrl: undefined }) }
      }));
    }
    return Object.assign({}, entry, { fileDataUrl: undefined });
  }

  function list() {
    return readQueue().map(entry => Object.assign({}, entry, { fileDataUrl: undefined }));
  }

  async function retry(id, uploadFn) {
    if (typeof uploadFn !== 'function') {
      throw new TypeError('Cần truyền hàm tải ảnh lên để thử lại.');
    }

    const entries = readQueue();
    const index = entries.findIndex(entry => entry.id === id);
    if (index < 0) {
      throw new Error('Không tìm thấy ảnh trong hàng chờ tải lên.');
    }

    const entry = entries[index];
    entry.attempts += 1;

    try {
      const file = await dataUrlToFile(entry);
      const result = await uploadFn(file, entry.metadata);
      entries.splice(index, 1);
      saveQueue(entries);
      if (root.dispatchEvent && typeof root.CustomEvent === 'function') {
        root.dispatchEvent(new root.CustomEvent('sync-status-changed', {
          detail: { action: 'photo-uploaded', id }
        }));
      }
      return result;
    } catch (error) {
      entry.lastError = error && error.message
        ? error.message
        : 'Tải ảnh lên thất bại.';
      saveQueue(entries);
      throw error;
    }
  }

  async function uploadOrQueue(file, uploadFn, metadata) {
    if (typeof uploadFn !== 'function') {
      throw new TypeError('Cần truyền hàm tải ảnh lên.');
    }

    try {
      return { uploaded: true, result: await uploadFn(file, metadata || {}) };
    } catch (error) {
      const item = await enqueue(file, metadata);
      return {
        uploaded: false,
        queued: true,
        item,
        error: error && error.message ? error.message : 'Tải ảnh lên thất bại.'
      };
    }
  }

  function render(container, uploadFn) {
    if (!root.document || !container || !container.appendChild) {
      throw new TypeError('Cần truyền phần tử DOM để hiển thị hàng chờ tải ảnh.');
    }

    const listElement = root.document.createElement('ul');
    listElement.className = 'journal-upload-queue';

    list().forEach(item => {
      const row = root.document.createElement('li');
      row.className = 'journal-upload-queue__item';

      const fileName = root.document.createElement('span');
      fileName.textContent = item.fileName;

      const badge = root.document.createElement('span');
      badge.className = 'journal-upload-queue__badge';
      badge.textContent = 'Chưa tải lên';

      const retryButton = root.document.createElement('button');
      retryButton.type = 'button';
      retryButton.textContent = '🔄 Thử lại';
      retryButton.disabled = typeof uploadFn !== 'function';

      const message = root.document.createElement('span');
      message.className = 'journal-upload-queue__message';
      message.setAttribute('role', 'status');
      message.textContent = item.lastError || '';

      retryButton.addEventListener('click', async () => {
        retryButton.disabled = true;
        message.textContent = 'Đang thử tải lên...';
        try {
          await retry(item.id, uploadFn);
          render(container, uploadFn);
        } catch (error) {
          message.textContent = error && error.message
            ? `Tải lên thất bại: ${error.message}`
            : 'Tải lên thất bại. Ảnh vẫn được giữ trong hàng chờ.';
          retryButton.disabled = false;
        }
      });

      row.append(fileName, badge, retryButton, message);
      listElement.appendChild(row);
    });

    container.replaceChildren(listElement);
    return listElement;
  }

  function count() {
    return readQueue().length;
  }

  function clear() {
    saveQueue([]);
    if (root.dispatchEvent && typeof root.CustomEvent === 'function') {
      root.dispatchEvent(new root.CustomEvent('sync-status-changed', {
        detail: { action: 'queue-cleared' }
      }));
    }
  }

  return { enqueue, list, retry, uploadOrQueue, render, count, clear };
}));
