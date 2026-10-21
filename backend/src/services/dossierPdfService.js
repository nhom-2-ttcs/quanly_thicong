const fs = require('fs');
const path = require('path');

class DossierPdfService {
  constructor() {
    this._chromiumAvailable = null;
  }

  /**
   * Kiểm tra khả năng chạy Chromium headless từ playwright-core
   */
  async isChromiumAvailable() {
    if (this._chromiumAvailable !== null) return this._chromiumAvailable;
    try {
      const { chromium } = require('playwright-core');
      const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
      await browser.close();
      this._chromiumAvailable = true;
      return true;
    } catch (_) {
      this._chromiumAvailable = false;
      return false;
    }
  }

  /**
   * Tìm và đọc ảnh thành base64 data URI
   */
  resolveImageBase64(photo) {
    if (!photo) return null;
    if (photo.data && typeof photo.data === 'string' && photo.data.startsWith('data:image')) {
      return photo.data;
    }

    const candidatePaths = [
      photo.file_path,
      photo.file_path ? path.resolve(photo.file_path) : null,
      photo.file_name ? path.join(__dirname, '../../uploads/acceptance', photo.file_name) : null,
      photo.file_name ? path.join(__dirname, '../../uploads', photo.file_name) : null,
      photo.file_path ? path.join(process.cwd(), photo.file_path) : null,
      photo.file_path ? path.join(__dirname, '../../', photo.file_path.replace(/^\//, '')) : null
    ].filter(Boolean);

    for (const p of candidatePaths) {
      try {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          const buf = fs.readFileSync(p);
          const mime = photo.mime_type || (p.endsWith('.png') ? 'image/png' : 'image/jpeg');
          return `data:${mime};base64,${buf.toString('base64')}`;
        }
      } catch (_) {}
    }
    return null;
  }

  /**
   * Tạo mã HTML hoàn chỉnh cho hồ sơ nghiệm thu
   */
  generateHtmlDossier(dossier) {
    const project = dossier.project || {};
    const workItem = dossier.work_item || {};
    const periods = Array.isArray(dossier.periods) ? dossier.periods : [];
    const exportTime = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

    const contractQtyStr = workItem.contract_quantity !== null && workItem.contract_quantity !== undefined
      ? Number(workItem.contract_quantity).toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
      : (workItem.khoi_luong_hop_dong ? Number(workItem.khoi_luong_hop_dong).toLocaleString('vi-VN') : '—');

    const finalCumulativeStr = Number(dossier.final_cumulative_quantity || 0).toLocaleString('vi-VN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    const totalPeriodQtyStr = Number(dossier.total_period_quantity || 0).toLocaleString('vi-VN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    // Bảng các đợt nghiệm thu đã duyệt
    let tableRowsHtml = '';
    if (periods.length === 0) {
      tableRowsHtml = `
        <tr>
          <td colspan="10" style="text-align: center; padding: 24px; color: #64748b; font-style: italic;">
            Hạng mục này hiện chưa có đợt nghiệm thu nào ở trạng thái "Đã phê duyệt" (Approved).
          </td>
        </tr>
      `;
    } else {
      tableRowsHtml = periods.map((p, idx) => {
        const periodQty = Number(p.period_quantity || 0).toLocaleString('vi-VN', { minimumFractionDigits: 2 });
        const cumQty = Number(p.cumulative_quantity || 0).toLocaleString('vi-VN', { minimumFractionDigits: 2 });
        const fromDate = p.from_date || '—';
        const toDate = p.to_date || '—';
        const approver = p.approved_by_name || 'Ban Quản Lý Dự Án';
        const creator = p.created_by_name || 'Kỹ sư giám sát';
        const approvedAt = p.approved_at ? new Date(p.approved_at).toLocaleDateString('vi-VN') : '—';

        return `
          <tr>
            <td style="text-align: center; font-weight: bold;">${idx + 1}</td>
            <td style="text-align: center; font-weight: bold; color: #1d4ed8;">Đợt ${p.period_number}</td>
            <td style="font-weight: 600; font-family: monospace;">${p.sheet_code}</td>
            <td style="text-align: center;">${fromDate} → ${toDate}</td>
            <td style="text-align: right; font-weight: 600;">${periodQty}</td>
            <td style="text-align: right; font-weight: 700; color: #047857;">${cumQty}</td>
            <td style="text-align: center;">${p.unit || workItem.unit || 'm3'}</td>
            <td>${creator}</td>
            <td>${approver} <br><span style="font-size: 8pt; color: #64748b;">(${approvedAt})</span></td>
            <td style="font-size: 8.5pt;">${p.notes || '—'}</td>
          </tr>
        `;
      }).join('');
    }

    // Phần hình ảnh hiện trường đính kèm theo từng đợt
    let photosSectionHtml = '';
    let totalPhotosCount = 0;

    periods.forEach(p => {
      const photos = Array.isArray(p.photos) ? p.photos : [];
      if (photos.length === 0) return;

      totalPhotosCount += photos.length;
      const photoCards = photos.map(photo => {
        const base64Img = this.resolveImageBase64(photo);
        const hasExif = Boolean(photo.has_metadata);
        
        let metaHtml = '';
        if (photo.taken_at || photo.latitude) {
          const timeText = photo.taken_at ? `🕒 Thời điểm: ${photo.taken_at}` : '🕒 Thời điểm: Chưa rõ';
          const gpsText = photo.latitude ? `📍 Tọa độ GPS: ${Number(photo.latitude).toFixed(5)}°N, ${Number(photo.longitude || 0).toFixed(5)}°E` : '📍 Tọa độ GPS: Chưa có';
          metaHtml = `
            <div style="font-size: 8.5pt; color: #1e3a8a; background: #eff6ff; padding: 4px 6px; border-radius: 4px; margin-top: 4px;">
              <div>${timeText}</div>
              <div>${gpsText}</div>
            </div>
          `;
        } else {
          metaHtml = `
            <div style="font-size: 8.5pt; color: #991b1b; background: #fef2f2; padding: 4px 6px; border-radius: 4px; margin-top: 4px; border: 1px dashed #fca5a5;">
              ⚠️ Không có siêu dữ liệu (Không có tọa độ GPS / thời gian chụp EXIF)
            </div>
          `;
        }

        const imgTag = base64Img
          ? `<img src="${base64Img}" alt="${photo.file_name}" style="max-width: 100%; max-height: 180px; object-fit: contain; border-radius: 4px; display: block; margin: 0 auto;">`
          : `<div style="height: 120px; background: #f1f5f9; display: flex; align-items: center; justify-content: center; color: #64748b; font-size: 9pt; border-radius: 4px; text-align: center; padding: 8px;">
               📸 [${photo.file_name}]<br><span style="font-size: 8pt; color: #94a3b8;">Tệp ảnh không sẵn có trên máy chủ</span>
             </div>`;

        return `
          <div class="photo-card" style="border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; background: #ffffff; break-inside: avoid; display: flex; flex-direction: column; justify-content: space-between;">
            <div style="text-align: center; margin-bottom: 6px;">
              ${imgTag}
            </div>
            <div>
              <div style="font-size: 9pt; font-weight: bold; color: #0f172a; word-break: break-all;">${photo.file_name}</div>
              ${photo.caption ? `<div style="font-size: 8.5pt; color: #475569; font-style: italic;">"${photo.caption}"</div>` : ''}
              ${metaHtml}
            </div>
          </div>
        `;
      }).join('');

      photosSectionHtml += `
        <div style="margin-top: 16px; break-inside: avoid;">
          <h4 style="font-size: 11pt; color: #1e293b; border-left: 4px solid #1d4ed8; padding-left: 8px; margin-bottom: 8px;">
            Ảnh hiện trường Đợt ${p.period_number} (${p.sheet_code}) — ${photos.length} ảnh
          </h4>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
            ${photoCards}
          </div>
        </div>
      `;
    });

    if (totalPhotosCount === 0) {
      photosSectionHtml = `
        <div style="padding: 12px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px; color: #64748b; font-size: 9.5pt; font-style: italic; margin-top: 12px;">
          Không có ảnh hiện trường đính kèm trong các đợt nghiệm thu đã duyệt của hạng mục này.
        </div>
      `;
    }

    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>Hồ sơ nghiệm thu - ${workItem.code || 'HM'} - ${workItem.name || 'Hạng mục'}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 15mm 12mm 15mm 12mm;
      @bottom-center {
        content: "Trang " counter(page) " / " counter(pages);
        font-size: 8pt;
        color: #64748b;
      }
    }
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif;
      font-size: 10pt;
      line-height: 1.35;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 0;
    }
    .header-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
    }
    .header-table td {
      border: none;
      vertical-align: top;
      padding: 2px 4px;
    }
    .title-banner {
      text-align: center;
      margin: 10px 0 16px 0;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 10px;
    }
    .title-banner h1 {
      font-size: 14pt;
      font-weight: 800;
      margin: 0 0 4px 0;
      text-transform: uppercase;
      color: #1e3a8a;
      letter-spacing: 0.5px;
    }
    .title-banner p {
      margin: 2px 0;
      font-size: 9.5pt;
      color: #475569;
    }
    .meta-box {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 10px 14px;
      margin-bottom: 14px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      row-gap: 6px;
      column-gap: 20px;
      font-size: 9.5pt;
    }
    .meta-grid strong {
      color: #0f172a;
    }
    .stats-strip {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin-bottom: 14px;
    }
    .stat-card {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 6px;
      padding: 8px 10px;
      text-align: center;
    }
    .stat-card .val {
      font-size: 13pt;
      font-weight: 800;
      color: #1d4ed8;
      font-family: monospace;
    }
    .stat-card .lbl {
      font-size: 8pt;
      font-weight: 700;
      color: #475569;
      text-transform: uppercase;
    }
    table.data-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 6px;
      margin-bottom: 14px;
      font-size: 9pt;
    }
    table.data-table th, table.data-table td {
      border: 1px solid #94a3b8;
      padding: 6px 8px;
    }
    table.data-table th {
      background-color: #e2e8f0;
      color: #0f172a;
      font-weight: 700;
      text-align: center;
    }
    table.data-table tr {
      break-inside: avoid;
    }
    .section-title {
      font-size: 11pt;
      font-weight: 800;
      color: #1e3a8a;
      margin: 14px 0 6px 0;
      text-transform: uppercase;
      border-bottom: 1.5px solid #cbd5e1;
      padding-bottom: 3px;
    }
    .signatures-block {
      margin-top: 24px;
      width: 100%;
      border-collapse: collapse;
      break-inside: avoid;
    }
    .signatures-block td {
      border: none;
      width: 50%;
      text-align: center;
      vertical-align: top;
      padding: 8px;
    }
    .sig-title {
      font-weight: 800;
      font-size: 9.5pt;
      text-transform: uppercase;
      color: #0f172a;
    }
    .sig-sub {
      font-size: 8.5pt;
      color: #64748b;
      font-style: italic;
      margin-top: 2px;
    }
    .sig-space {
      height: 60px;
    }
    .sig-name {
      font-weight: 700;
      font-size: 9.5pt;
    }
    .footer-note {
      font-size: 8pt;
      color: #94a3b8;
      border-top: 1px dashed #cbd5e1;
      padding-top: 6px;
      margin-top: 20px;
      text-align: center;
    }
  </style>
</head>
<body>

  <!-- Tiêu ngữ & Đơn vị -->
  <table class="header-table">
    <tr>
      <td style="width: 45%;">
        <div style="font-weight: bold; font-size: 9pt; text-transform: uppercase;">BAN QUẢN LÝ DỰ ÁN CÔNG TRÌNH</div>
        <div style="font-size: 8.5pt; color: #475569;">Dự án: <strong>${project.name || 'Dự án thi công'}</strong></div>
        <div style="font-size: 8.5pt; color: #64748b;">Mã dự án: ${project.code || `DA-${project.id || 1}`}</div>
      </td>
      <td style="width: 55%; text-align: center;">
        <div style="font-weight: bold; font-size: 9pt; text-transform: uppercase;">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
        <div style="font-weight: bold; font-size: 9pt;">Độc lập – Tự do – Hạnh phúc</div>
        <div style="font-size: 8pt; color: #64748b; margin-top: 2px;">---------o0o---------</div>
      </td>
    </tr>
  </table>

  <!-- Tiêu đề hồ sơ -->
  <div class="title-banner">
    <h1>HỒ SƠ NGHIỆM THU KHỐI LƯỢNG HẠNG MỤC</h1>
    <p>Tổng hợp các đợt nghiệm thu đã được phê duyệt làm căn cứ hoàn công và quyết toán</p>
    <p style="font-size: 8.5pt; color: #64748b;">Thời điểm xuất: ${exportTime}</p>
  </div>

  <!-- Thông tin hạng mục WBS -->
  <div class="meta-box">
    <div class="meta-grid">
      <div>Mã hạng mục: <strong>${workItem.code || `HM-${workItem.id}`}</strong></div>
      <div>Tên hạng mục: <strong>${workItem.name || 'Hạng mục thi công'}</strong></div>
      <div>Đơn vị tính: <strong>${workItem.unit || 'm3'}</strong></div>
      <div>Khối lượng hợp đồng: <strong>${contractQtyStr} ${workItem.unit || 'm3'}</strong></div>
    </div>
  </div>

  <!-- Chỉ số thống kê -->
  <div class="stats-strip">
    <div class="stat-card">
      <div class="val">${periods.length}</div>
      <div class="lbl">Số đợt đã duyệt</div>
    </div>
    <div class="stat-card">
      <div class="val">${finalCumulativeStr} ${workItem.unit || 'm3'}</div>
      <div class="lbl">Khối lượng lũy kế đã duyệt</div>
    </div>
    <div class="stat-card">
      <div class="val">${totalPeriodQtyStr} ${workItem.unit || 'm3'}</div>
      <div class="lbl">Tổng khối lượng thực hiện</div>
    </div>
  </div>

  <!-- Bảng tổng hợp các đợt nghiệm thu -->
  <div class="section-title">I. BẢNG TỔNG HỢP CÁC ĐỢT NGHIỆM THU ĐÃ DUYỆT</div>
  <table class="data-table">
    <thead>
      <tr>
        <th style="width: 4%;">STT</th>
        <th style="width: 8%;">Đợt</th>
        <th style="width: 11%;">Mã phiếu</th>
        <th style="width: 15%;">Thời gian nghiệm thu</th>
        <th style="width: 11%;">Khối lượng đợt</th>
        <th style="width: 11%;">Khối lượng lũy kế</th>
        <th style="width: 6%;">ĐVT</th>
        <th style="width: 12%;">Người lập</th>
        <th style="width: 12%;">Người duyệt</th>
        <th style="width: 10%;">Ghi chú</th>
      </tr>
    </thead>
    <tbody>
      ${tableRowsHtml}
    </tbody>
  </table>

  <!-- Ảnh hiện trường có tọa độ và thời gian -->
  <div class="section-title">II. HÌNH ẢNH HIỆN TRƯỜNG ĐÍNH KÈM & SIÊU DỮ LIỆU GPS</div>
  ${photosSectionHtml}

  <!-- Chữ ký xác nhận -->
  <table class="signatures-block">
    <tr>
      <td>
        <div class="sig-title">NGƯỜI LẬP HỒ SƠ</div>
        <div class="sig-sub">(Ký, ghi rõ họ tên và chức danh)</div>
        <div class="sig-space"></div>
        <div class="sig-name">${(periods[0] && periods[0].created_by_name) || 'Kỹ sư giám sát'}</div>
      </td>
      <td>
        <div class="sig-title">CHỈ HUY TRƯỞNG / BAN QLDA</div>
        <div class="sig-sub">(Ký duyệt, đóng dấu hoặc xác nhận số)</div>
        <div class="sig-space"></div>
        <div class="sig-name">${(periods[0] && periods[0].approved_by_name) || 'Ban Quản Lý Dự Án'}</div>
      </td>
    </tr>
  </table>

  <div class="footer-note">
    Hồ sơ được trích xuất tự động từ Hệ thống Quản lý Điều hành Thi công Công trình (S-50 / Sprint 8). Dữ liệu chỉ bao gồm các đợt nghiệm thu đã có trạng thái "Approved".
  </div>

</body>
</html>`;
  }

  /**
   * Tạo tệp PDF thực tế (Buffer) sử dụng Chromium (Playwright-core)
   * hoặc Fallback PDF engine nếu môi trường không có Chromium.
   */
  async generateDossierPdf(dossier) {
    const htmlContent = this.generateHtmlDossier(dossier);

    // 1. Cố gắng sinh PDF bằng Playwright Chromium
    try {
      const { chromium } = require('playwright-core');
      const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });

      try {
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'load' });
        const pdfBuffer = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '15mm', right: '12mm', bottom: '15mm', left: '12mm' }
        });
        await browser.close();
        return pdfBuffer;
      } catch (pageErr) {
        await browser.close();
        throw pageErr;
      }
    } catch (chromiumErr) {
      console.warn('[DossierPdfService] Chromium PDF render failed, falling back to clean PDF 1.4 generator:', chromiumErr.message);
      return this._generateFallbackPdf(dossier);
    }
  }

  /**
   * Bộ sinh PDF dự phòng độc lập chuẩn ISO 32000-1 (PDF 1.4)
   * Đảm bảo luôn trả về buffer PDF hợp lệ (%PDF-) ngay cả khi container không có trình duyệt.
   */
  _generateFallbackPdf(dossier) {
    const project = dossier.project || {};
    const workItem = dossier.work_item || {};
    const periods = Array.isArray(dossier.periods) ? dossier.periods : [];

    const lines = [
      'CONG HOA XA HOI CHU NGHIA VIET NAM',
      'Doc lap - Tu do - Hanh phuc',
      '-------------------------------------------------------',
      'HO SO NGHIEM THU KHOI LUONG HANG MUC (S-50)',
      `Du an: ${project.name || 'Du an'} (Ma: ${project.code || project.id || 'DA-1'})`,
      `Hang muc: ${workItem.name || 'Hang muc'} (Ma: ${workItem.code || workItem.id || 'HM-1'})`,
      `Khoi luong hop dong: ${workItem.contract_quantity || workItem.khoi_luong_hop_dong || 0} ${workItem.unit || 'm3'}`,
      `Tong so dot da phe duyet: ${periods.length} dot`,
      `Tong khoi luong luy ke da duyet: ${dossier.final_cumulative_quantity || 0} ${workItem.unit || 'm3'}`,
      '-------------------------------------------------------',
      'DANH SACH CAC DOT NGHIEM THU DA DUYET (STATUS = APPROVED):'
    ];

    if (periods.length === 0) {
      lines.push('  (Chua co dot nghiem thu nao o trang thai da phe duyet)');
    } else {
      periods.forEach((p, idx) => {
        lines.push(`  [Dot ${p.period_number}] Phieu: ${p.sheet_code} | Thoi gian: ${p.from_date || ''} -> ${p.to_date || ''}`);
        lines.push(`    - Khuc luong dot: ${p.period_quantity || 0} ${p.unit || workItem.unit || 'm3'}`);
        lines.push(`    - Khuc luong luy ke: ${p.cumulative_quantity || 0} ${p.unit || workItem.unit || 'm3'}`);
        lines.push(`    - Nguoi lap: ${p.created_by_name || 'Ky su giam sat'} | Nguoi duyet: ${p.approved_by_name || 'Ban QLDA'} (${p.approved_at || ''})`);
        if (p.photos && p.photos.length > 0) {
          lines.push(`    - Anh hien truong (${p.photos.length} anh):`);
          p.photos.forEach(ph => {
            const meta = (ph.taken_at || ph.latitude)
              ? `Thoi diem: ${ph.taken_at || 'N/A'}, Toa do GPS: ${ph.latitude || 'N/A'}, ${ph.longitude || 'N/A'}`
              : 'Khong co sieu du lieu GPS / thoi gian chup';
            lines.push(`      * ${ph.file_name}: [${meta}]`);
          });
        }
      });
    }

    lines.push('-------------------------------------------------------');
    lines.push('XAC NHAN:');
    lines.push('Nguoi lap ho so:                              Chi huy truong / Ban QLDA:');
    lines.push('(Ky va ghi ro ho ten)                         (Ky va ghi ro ho ten)');

    // Dựng PDF 1.4 stream thủ công
    const textStream = lines.map((l, i) => `1 0 0 1 50 ${780 - (i * 18)} Tm (${l.replace(/[()\\]/g, '')}) Tj`).join('\n');
    const streamContent = `BT\n/F1 10 Tf\n${textStream}\nET`;

    const pdfParts = [
      '%PDF-1.4\n',
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
      `4 0 obj\n<< /Length ${Buffer.byteLength(streamContent)} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
      '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'
    ];

    let offset = 0;
    const xref = ['xref\n0 6\n0000000000 65535 f \n'];
    let body = '';

    for (let i = 0; i < pdfParts.length; i++) {
      if (i > 0) {
        const offsetStr = String(offset).padStart(10, '0');
        xref.push(`${offsetStr} 00000 n \n`);
      }
      body += pdfParts[i];
      offset = Buffer.byteLength(body);
    }

    const startXref = offset;
    const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;
    return Buffer.from(body + xref.join('') + trailer, 'utf-8');
  }
}

module.exports = new DossierPdfService();
