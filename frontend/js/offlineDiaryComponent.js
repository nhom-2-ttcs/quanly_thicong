import {
  saveOfflineDiary,
  getOfflineDiaries,
  requestPersistentStorage,
  checkStorageQuota
} from './offlineDiaryStorage.js';

export class OfflineDiaryComponent {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.storageInfo = null;
    this.items = [];
    this.init();
  }

  async init() {
    await requestPersistentStorage();
    await this.refreshStorage();
    await this.loadItems();
    this.render();
  }

  async refreshStorage() {
    this.storageInfo = await checkStorageQuota(80);
  }

  async loadItems() {
    this.items = await getOfflineDiaries();
  }

  render() {
    if (!this.container) return;

    const warningHtml = this.storageInfo ? `
      <div style="padding: 10px; margin-bottom: 12px; border-radius: 4px; font-size: 14px;
                  background-color: ${this.storageInfo.isNearFull ? '#ffebee' : '#e8f5e9'};
                  color: ${this.storageInfo.isNearFull ? '#c62828' : '#2e7d32'};
                  border: 1px solid ${this.storageInfo.isNearFull ? '#ef9a9a' : '#c8e6c9'};">
        <strong>Bộ nhớ thiết bị:</strong> Còn trống ${this.storageInfo.remainingMB} MB (Đã dùng ${this.storageInfo.percentUsed}%)
        ${this.storageInfo.isNearFull ? '<br><strong>⚠️ CẢNH BÁO: Bộ nhớ trên máy gần đầy!</strong>' : ''}
      </div>
    ` : '';

    const listHtml = this.items.map(item => `
      <div style="border: 1px solid #e0e0e0; border-radius: 4px; padding: 12px; margin-bottom: 10px; background: #fff;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <span style="font-weight: bold; color: #e65100; font-size: 13px;">[${item.syncStatus}]</span>
          <span style="font-size: 12px; color: #757575;">${new Date(item.createdAt).toLocaleString()}</span>
        </div>
        <div style="font-size: 12px; color: #555; word-break: break-all; margin-bottom: 6px;">
          <strong>Client ID:</strong> ${item.clientId}
        </div>
        <p style="margin: 6px 0; white-space: pre-wrap;">${item.content || '<em>(Không có nội dung ghi chú)</em>'}</p>
        ${item.photo ? `<img src="${item.photo}" alt="Ảnh đính kèm" style="max-width: 160px; max-height: 160px; object-fit: cover; border-radius: 4px; display: block; margin-top: 8px;">` : ''}
      </div>
    `).join('');

    this.container.innerHTML = `
      <div style="max-width: 650px; margin: 0 auto; font-family: sans-serif;">
        <h3>S-29: Ghi nhật ký công trường ngoại tuyến</h3>
        ${warningHtml}
        
        <form id="offline-diary-form" style="border: 1px solid #ccc; padding: 16px; border-radius: 6px; background: #fafafa; margin-bottom: 20px;">
          <div style="margin-bottom: 10px;">
            <label style="display: block; font-weight: bold; margin-bottom: 4px;">Nội dung nhật ký:</label>
            <textarea id="diary-content" rows="4" style="width: 100%; box-sizing: border-box; padding: 8px;" placeholder="Nhập ghi chú thi công..."></textarea>
          </div>
          <div style="margin-bottom: 12px;">
            <label style="display: block; font-weight: bold; margin-bottom: 4px;">Chụp / Chọn ảnh hiện trường:</label>
            <input type="file" id="diary-photo" accept="image/*" />
          </div>
          <button type="submit" style="background: #1976d2; color: #fff; padding: 10px 18px; border: none; border-radius: 4px; cursor: pointer;">
            Lưu trên máy (Offline)
          </button>
        </form>

        <h4>Danh sách nhật ký trên máy (${this.items.length} mục)</h4>
        <div id="offline-diaries-list">
          ${this.items.length === 0 ? '<p style="color: #777;">Chưa có mục nào được lưu offline.</p>' : listHtml}
        </div>
      </div>
    `;

    this.attachEvents();
  }

  attachEvents() {
    const form = document.getElementById('offline-diary-form');
    if (!form) return;

    form.onsubmit = async (e) => {
      e.preventDefault();
      const content = document.getElementById('diary-content').value.trim();
      const photoFile = document.getElementById('diary-photo').files[0];

      if (!content && !photoFile) {
        alert('Vui lòng nhập nội dung hoặc đính kèm ảnh.');
        return;
      }

      let photoDataUrl = null;
      if (photoFile) {
        photoDataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(photoFile);
        });
      }

      await saveOfflineDiary({ content, photoDataUrl });
      await this.refreshStorage();
      await this.loadItems();
      this.render();
      alert('Đã lưu nhật ký vào bộ nhớ máy thành công (trạng thái: chưa đồng bộ)!');
    };
  }
}
