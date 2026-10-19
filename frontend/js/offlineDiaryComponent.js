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
        <div style="font-size: 13px; font-weight: bold; margin-bottom: 4px; color: #1e40af;">
          📅 ${item.diary_date || 'Hôm nay'} — ☀️ ${item.weather_condition || 'Nắng'} | 👥 ${item.manpower_count || 0} công nhân
        </div>
        ${item.equipment_status ? `<div style="font-size: 12px; color: #475569; margin-bottom: 4px;">🚜 Thiết bị: ${item.equipment_status}</div>` : ''}
        ${Array.isArray(item.items) && item.items.length > 0 ? `
          <div style="background: #f1f5f9; padding: 6px 10px; border-radius: 4px; font-size: 12.5px; margin: 6px 0;">
            ${item.items.map(it => `<div>🔨 <strong>${it.work_content || 'Công việc'}</strong>: ${it.quantity_done || 0} ${it.unit || ''}</div>`).join('')}
          </div>
        ` : ''}
        <p style="margin: 6px 0; white-space: pre-wrap; font-size: 13px;">${item.content || item.work_notes || '<em>(Không có ghi chú thêm)</em>'}</p>
        ${item.lastError ? `
          <div style="margin-top: 6px; padding: 6px 10px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 4px; color: #dc2626; font-size: 12px;">
            ⚠️ <strong>Lý do lỗi đồng bộ:</strong> ${item.lastError}
          </div>
        ` : ''}
        ${item.photo ? `<img src="${item.photo}" alt="Ảnh đính kèm" style="max-width: 160px; max-height: 160px; object-fit: cover; border-radius: 4px; display: block; margin-top: 8px;">` : ''}
      </div>
    `).join('');

    const todayStr = new Date().toISOString().split('T')[0];

    this.container.innerHTML = `
      <div style="max-width: 650px; margin: 0 auto; font-family: sans-serif;">
        <h3>S-29: Ghi nhật ký công trường ngoại tuyến (Có cấu trúc)</h3>
        ${warningHtml}
        
        <form id="offline-diary-form" style="border: 1px solid #ccc; padding: 16px; border-radius: 6px; background: #fafafa; margin-bottom: 20px;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
            <div>
              <label style="display: block; font-weight: bold; margin-bottom: 4px; font-size: 13px;">Ngày nhật ký *:</label>
              <input type="date" id="diary-date" value="${todayStr}" style="width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" required />
            </div>
            <div>
              <label style="display: block; font-weight: bold; margin-bottom: 4px; font-size: 13px;">Thời tiết:</label>
              <select id="diary-weather" style="width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                <option value="sunny">Nắng ráo (Sunny)</option>
                <option value="cloudy">Nhiều mây (Cloudy)</option>
                <option value="rain_intermittent">Mưa rải rác (Rain intermittent)</option>
                <option value="rain_all_day">Mưa cả ngày (Rain all day)</option>
              </select>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
            <div>
              <label style="display: block; font-weight: bold; margin-bottom: 4px; font-size: 13px;">Quân số nhân lực (người):</label>
              <input type="number" id="diary-manpower" min="0" value="15" style="width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" />
            </div>
            <div>
              <label style="display: block; font-weight: bold; margin-bottom: 4px; font-size: 13px;">Thiết bị thi công chính:</label>
              <input type="text" id="diary-equipment" placeholder="Ví dụ: Máy đào, máy lu..." style="width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" />
            </div>
          </div>

          <div style="background: #edf2f7; padding: 10px; border-radius: 6px; margin-bottom: 10px;">
            <label style="display: block; font-weight: bold; margin-bottom: 4px; font-size: 13px;">Hạng mục công việc thi công:</label>
            <input type="text" id="diary-work-content" placeholder="Nội dung công việc (ví dụ: Đào đất hố móng trụ T1)" style="width: 100%; box-sizing: border-box; padding: 8px; margin-bottom: 6px; border: 1px solid #ccc; border-radius: 4px;" />
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <input type="number" id="diary-work-qty" step="any" min="0" placeholder="Khối lượng (ví dụ: 45.5)" style="width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" />
              <input type="text" id="diary-work-unit" placeholder="Đơn vị (ví dụ: m3)" style="width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" />
            </div>
          </div>

          <div style="margin-bottom: 10px;">
            <label style="display: block; font-weight: bold; margin-bottom: 4px; font-size: 13px;">Ghi chú thi công / hiện trường:</label>
            <textarea id="diary-content" rows="3" style="width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" placeholder="Nhập ghi chú thi công..."></textarea>
          </div>

          <div style="margin-bottom: 12px;">
            <label style="display: block; font-weight: bold; margin-bottom: 4px; font-size: 13px;">Chụp / Chọn ảnh hiện trường:</label>
            <input type="file" id="diary-photo" accept="image/*" />
          </div>

          <button type="submit" style="background: #1976d2; color: #fff; padding: 10px 18px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; width: 100%;">
            💾 Lưu trên máy (Offline có cấu trúc)
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
      const diary_date = document.getElementById('diary-date').value;
      const weather_condition = document.getElementById('diary-weather').value;
      const manpower_count = Number(document.getElementById('diary-manpower').value || 0);
      const equipment_status = document.getElementById('diary-equipment').value.trim();
      const work_content = document.getElementById('diary-work-content').value.trim();
      const quantity_done = Number(document.getElementById('diary-work-qty').value || 0);
      const unit = document.getElementById('diary-work-unit').value.trim();
      const content = document.getElementById('diary-content').value.trim();
      const photoFile = document.getElementById('diary-photo').files[0];

      if (!content && !work_content && !photoFile) {
        alert('Vui lòng nhập nội dung công việc, ghi chú hoặc đính kèm ảnh.');
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

      const items = work_content ? [{
        work_content,
        quantity_done,
        unit
      }] : [];

      await saveOfflineDiary({
        project_id: 1,
        diary_date,
        weather_condition,
        manpower_count,
        equipment_status,
        work_notes: content,
        content,
        items,
        photoDataUrl
      });

      await this.refreshStorage();
      await this.loadItems();
      this.render();
      alert('Đã lưu nhật ký có cấu trúc vào bộ nhớ máy thành công (trạng thái: chưa đồng bộ)!');
    };
  }
}
