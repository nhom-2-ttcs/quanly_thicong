const store = require('../models/store');

class PaymentService {
  constructor(db) {
    this.db = db;
    this.pool = db?.pool || db;
  }

  get isConnected() {
    return Boolean(this.db && this.db.isConnected !== false && this.pool?.query);
  }

  /**
   * Lấy tỉ lệ tạm giữ hợp đồng (%) của dự án (AC 1 S-45)
   */
  async getProjectRetentionRate(projectId) {
    const pId = Number(projectId);
    if (this.isConnected) {
      try {
        const [rows] = await this.pool.query(
          'SELECT retention_rate FROM projects WHERE id = ? LIMIT 1',
          [pId]
        );
        if (rows && rows.length > 0 && rows[0].retention_rate !== null && rows[0].retention_rate !== undefined) {
          return Number(rows[0].retention_rate);
        }
      } catch (_) {}
    }
    return store.getProjectRetentionRate(pId);
  }

  /**
   * Cập nhật tỉ lệ tạm giữ hợp đồng (%) cho dự án
   */
  async updateProjectRetentionRate(projectId, rate) {
    const pId = Number(projectId);
    const r = Number(rate);
    if (isNaN(r) || r < 0 || r > 100) {
      const err = new Error('Tỉ lệ tạm giữ hợp đồng phải là số thực từ 0% đến 100%');
      err.status = 400;
      throw err;
    }

    if (this.isConnected) {
      try {
        await this.pool.query(
          'UPDATE projects SET retention_rate = ? WHERE id = ?',
          [r, pId]
        );
      } catch (_) {}
    }
    store.updateProjectRetentionRate(pId, r);

    return {
      success: true,
      project_id: pId,
      retention_rate: Number(r.toFixed(2)),
      message: `Đã cập nhật tỉ lệ tạm giữ hợp đồng cho dự án thành ${r.toFixed(2)}%`
    };
  }

  /**
   * Lấy dữ liệu điền sẵn cho đề nghị thanh toán từ các phiếu nghiệm thu đã duyệt (S-43 & S-45)
   */
  async getPrefillData(projectId) {
    const pId = Number(projectId);
    const retentionRate = await this.getProjectRetentionRate(pId);

    // Lấy các phiếu nghiệm thu ĐÃ DUYỆT chưa được thanh toán hoặc toàn bộ phiếu đã duyệt
    let approvedSheets = [];
    if (this.isConnected) {
      try {
        const [sheets] = await this.pool.query(
          `SELECT s.id, s.sheet_code, s.name, s.period_number, s.from_date, s.to_date, s.approved_at
           FROM acceptance_sheets s
           WHERE s.project_id = ? AND s.status = 'approved'
           ORDER BY s.period_number ASC`,
          [pId]
        );
        approvedSheets = sheets || [];
      } catch (_) {
        approvedSheets = store.inMemoryAcceptanceSheets.filter(s => Number(s.project_id) === pId && s.status === 'approved');
      }
    } else {
      approvedSheets = store.inMemoryAcceptanceSheets.filter(s => Number(s.project_id) === pId && s.status === 'approved');
    }

    // Lấy đơn giá hợp đồng của các work_items để tính thành tiền
    const workItemsMap = new Map();
    if (this.isConnected) {
      try {
        const [wRows] = await this.pool.query(
          'SELECT id, code, name, unit, don_gia_hop_dong, khoi_luong_hop_dong FROM work_items WHERE project_id = ?',
          [pId]
        );
        (wRows || []).forEach(w => workItemsMap.set(Number(w.id), w));
      } catch (_) {}
    }

    // Tổng hợp các hạng mục từ các phiếu nghiệm thu
    const items = [];
    let grossTotal = 0;

    for (const s of approvedSheets) {
      let sheetItems = [];
      if (this.isConnected) {
        try {
          const [itRows] = await this.pool.query(
            'SELECT * FROM acceptance_sheet_items WHERE sheet_id = ?',
            [s.id]
          );
          sheetItems = itRows || [];
        } catch (_) {}
      } else {
        sheetItems = store.inMemoryAcceptanceSheetItems.filter(i => i.sheet_id === s.id);
      }

      for (const it of sheetItems) {
        const wInfo = it.work_item_id ? workItemsMap.get(Number(it.work_item_id)) : null;
        const unitPrice = (wInfo && wInfo.don_gia_hop_dong !== null && wInfo.don_gia_hop_dong !== undefined)
          ? Number(wInfo.don_gia_hop_dong)
          : (it.unit_price ? Number(it.unit_price) : 500000); // Đơn giá mẫu nếu chưa khai
        const periodQty = Number(it.period_quantity || 0);
        const lineTotal = Number((periodQty * unitPrice).toFixed(2));
        grossTotal += lineTotal;

        items.push({
          acceptance_sheet_id: s.id,
          acceptance_sheet_code: s.sheet_code,
          work_item_id: it.work_item_id,
          item_name: it.item_name,
          unit: it.unit || 'm3',
          period_quantity: periodQty,
          unit_price: unitPrice,
          line_total: lineTotal
        });
      }
    }

    // Tự động tính phần tạm giữ và thực nhận theo S-45 (AC 2, AC 3, AC 4)
    grossTotal = Number(grossTotal.toFixed(2));
    const retentionAmount = Number((grossTotal * (retentionRate / 100)).toFixed(2));
    const netPayable = Number((grossTotal - retentionAmount).toFixed(2));

    // Xác định số đợt đề nghị tiếp theo
    const currentRequests = await this.getPaymentRequests(pId);
    const nextPeriodNumber = (currentRequests.requests?.length || 0) + 1;
    const padPeriod = String(nextPeriodNumber).padStart(2, '0');

    return {
      project_id: pId,
      suggested_request_code: `DNTT-${padPeriod}`,
      suggested_name: `Đề nghị thanh toán Đợt ${nextPeriodNumber}`,
      suggested_period_number: nextPeriodNumber,
      retention_rate: Number(retentionRate.toFixed(2)),
      gross_amount: grossTotal,
      retention_amount: retentionAmount,
      net_payable_amount: netPayable,
      items
    };
  }

  /**
   * Lấy danh sách đề nghị thanh toán của dự án kèm tổng tạm giữ luỹ kế (AC 5 S-45)
   */
  async getPaymentRequests(projectId) {
    const pId = Number(projectId);
    const retentionRate = await this.getProjectRetentionRate(pId);

    if (this.isConnected) {
      try {
        const [rows] = await this.pool.query(
          `SELECT pr.*, u.full_name as creator_name, app.full_name as approver_name,
                  (SELECT COUNT(i.id) FROM payment_request_items i WHERE i.payment_request_id = pr.id) as item_count
           FROM payment_requests pr
           LEFT JOIN users u ON pr.created_by = u.id
           LEFT JOIN users app ON pr.approved_by = app.id
           WHERE pr.project_id = ?
           ORDER BY pr.period_number DESC, pr.id DESC`,
          [pId]
        );

        let cumRetention = 0;
        let cumGross = 0;
        let cumNet = 0;
        (rows || []).forEach(r => {
          cumRetention += Number(r.retention_amount || 0);
          cumGross += Number(r.gross_amount || 0);
          cumNet += Number(r.net_payable_amount || 0);
        });

        return {
          requests: rows || [],
          summary: {
            retention_rate: Number(retentionRate.toFixed(2)),
            cumulative_retention_amount: Number(cumRetention.toFixed(2)),
            cumulative_gross_amount: Number(cumGross.toFixed(2)),
            cumulative_net_payable_amount: Number(cumNet.toFixed(2))
          }
        };
      } catch (_) {
        return store.getPaymentRequests(pId);
      }
    } else {
      return store.getPaymentRequests(pId);
    }
  }

  /**
   * Lấy chi tiết một đề nghị thanh toán kèm các hạng mục chi tiết
   */
  async getPaymentRequestById(projectId, requestId) {
    const pId = Number(projectId);
    const rId = Number(requestId);

    if (this.isConnected) {
      try {
        const [rows] = await this.pool.query(
          `SELECT pr.*, u.full_name as creator_name, app.full_name as approver_name
           FROM payment_requests pr
           LEFT JOIN users u ON pr.created_by = u.id
           LEFT JOIN users app ON pr.approved_by = app.id
           WHERE pr.id = ? AND pr.project_id = ?`,
          [rId, pId]
        );
        if (!rows || rows.length === 0) return null;
        const request = rows[0];

        const [items] = await this.pool.query(
          `SELECT i.*, s.sheet_code as acceptance_sheet_code
           FROM payment_request_items i
           LEFT JOIN acceptance_sheets s ON i.acceptance_sheet_id = s.id
           WHERE i.payment_request_id = ?
           ORDER BY i.id ASC`,
          [rId]
        );

        return {
          ...request,
          items: items || []
        };
      } catch (_) {
        const mem = store.getPaymentRequestById(rId);
        if (!mem || Number(mem.project_id) !== pId) return null;
        return mem;
      }
    } else {
      const mem = store.getPaymentRequestById(rId);
      if (!mem || Number(mem.project_id) !== pId) return null;
      return mem;
    }
  }

  /**
   * Lập đề nghị thanh toán và tự động tính trừ phần tạm giữ (AC 2, AC 3, AC 4 S-45)
   */
  async createPaymentRequest(projectId, payload, userId = 1) {
    const pId = Number(projectId);
    const uId = Number(userId);

    const requestCode = String(payload.request_code || payload.code || '').trim();
    const name = String(payload.name || payload.title || '').trim();
    const periodNumber = Number(payload.period_number || 1);
    const fromDate = payload.from_date ? String(payload.from_date).trim() : new Date().toISOString().slice(0, 10);
    const toDate = payload.to_date ? String(payload.to_date).trim() : new Date().toISOString().slice(0, 10);
    const notes = payload.notes ? String(payload.notes).trim() : null;
    const rawItems = Array.isArray(payload.items) ? payload.items : [];

    if (!requestCode) {
      const err = new Error('Mã đề nghị thanh toán (request_code) không được để trống');
      err.status = 400;
      throw err;
    }
    if (!name) {
      const err = new Error('Tên đề nghị thanh toán (name) không được để trống');
      err.status = 400;
      throw err;
    }

    // 1. Tỉ lệ tạm giữ hợp đồng (%)
    let retentionRate = null;
    if (payload.retention_rate !== undefined && payload.retention_rate !== null) {
      retentionRate = Number(payload.retention_rate);
    } else {
      retentionRate = await this.getProjectRetentionRate(pId);
    }

    if (isNaN(retentionRate) || retentionRate < 0 || retentionRate > 100) {
      const err = new Error('Tỉ lệ tạm giữ hợp đồng (retention_rate) không hợp lệ (phải từ 0% đến 100%)');
      err.status = 400;
      throw err;
    }

    // 2. Tính toán chi tiết từng hạng mục
    let calculatedGross = 0;
    const computedItems = rawItems.map(it => {
      const periodQty = Number(it.period_quantity || 0);
      const unitPrice = Number(it.unit_price || 0);
      const lineTotal = it.line_total !== undefined && it.line_total !== null
        ? Number(it.line_total)
        : Number((periodQty * unitPrice).toFixed(2));
      calculatedGross += lineTotal;

      return {
        acceptance_sheet_id: Number(it.acceptance_sheet_id || 1),
        work_item_id: it.work_item_id ? Number(it.work_item_id) : null,
        item_name: String(it.item_name || 'Hạng mục').trim(),
        unit: String(it.unit || 'm3').trim(),
        period_quantity: periodQty,
        unit_price: unitPrice,
        line_total: lineTotal
      };
    });

    const grossAmount = payload.gross_amount !== undefined && payload.gross_amount !== null
      ? Number(Number(payload.gross_amount).toFixed(2))
      : Number(calculatedGross.toFixed(2));

    // AC 2: retention_amount = gross_amount * retention_rate / 100
    const retentionAmount = Number((grossAmount * (retentionRate / 100)).toFixed(2));

    // AC 3: net_payable_amount = gross_amount - retention_amount
    const netPayableAmount = Number((grossAmount - retentionAmount).toFixed(2));

    // AC 4: Đảm bảo chênh lệch bằng 0: gross_amount = retention_amount + net_payable_amount
    const checkSum = Number((retentionAmount + netPayableAmount).toFixed(2));
    if (checkSum !== grossAmount) {
      // Điều chỉnh làm tròn nếu lệch 1 xu
      const diff = Number((grossAmount - checkSum).toFixed(2));
      netPayableAmount = Number((netPayableAmount + diff).toFixed(2));
    }

    let createdRequest = null;

    if (this.isConnected) {
      try {
        // Kiểm tra trùng mã đề nghị thanh toán
        const [dup] = await this.pool.query(
          'SELECT id FROM payment_requests WHERE project_id = ? AND request_code = ? LIMIT 1',
          [pId, requestCode]
        );
        if (dup && dup.length > 0) {
          const err = new Error(`Mã đề nghị thanh toán "${requestCode}" đã tồn tại trong dự án này`);
          err.status = 409;
          throw err;
        }

        const [res] = await this.pool.query(
          `INSERT INTO payment_requests (project_id, request_code, name, period_number, from_date, to_date, gross_amount, retention_rate, retention_amount, net_payable_amount, status, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
          [
            pId,
            requestCode,
            name,
            periodNumber,
            fromDate,
            toDate,
            grossAmount,
            retentionRate,
            retentionAmount,
            netPayableAmount,
            notes,
            uId
          ]
        );
        const reqId = res.insertId;

        for (const it of computedItems) {
          await this.pool.query(
            `INSERT INTO payment_request_items (payment_request_id, acceptance_sheet_id, work_item_id, item_name, unit, period_quantity, unit_price, line_total)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [reqId, it.acceptance_sheet_id, it.work_item_id, it.item_name, it.unit, it.period_quantity, it.unit_price, it.line_total]
          );
        }

        createdRequest = await this.getPaymentRequestById(pId, reqId);
      } catch (err) {
        if (err.status) throw err;
        // Fallback in-memory nếu table chưa migrate
        createdRequest = store.savePaymentRequest({
          project_id: pId,
          request_code: requestCode,
          name,
          period_number: periodNumber,
          from_date: fromDate,
          to_date: toDate,
          gross_amount: grossAmount,
          retention_rate: retentionRate,
          retention_amount: retentionAmount,
          net_payable_amount: netPayableAmount,
          notes,
          created_by: uId
        }, computedItems);
      }
    } else {
      const all = store.getPaymentRequests(pId).requests || [];
      if (all.some(r => r.request_code.toLowerCase() === requestCode.toLowerCase())) {
        const err = new Error(`Mã đề nghị thanh toán "${requestCode}" đã tồn tại trong dự án này`);
        err.status = 409;
        throw err;
      }

      createdRequest = store.savePaymentRequest({
        project_id: pId,
        request_code: requestCode,
        name,
        period_number: periodNumber,
        from_date: fromDate,
        to_date: toDate,
        gross_amount: grossAmount,
        retention_rate: retentionRate,
        retention_amount: retentionAmount,
        net_payable_amount: netPayableAmount,
        notes,
        created_by: uId
      }, computedItems);
    }

    return {
      success: true,
      message: 'Lập đề nghị thanh toán thành công, đã khấu trừ đúng phần tạm giữ theo hợp đồng',
      data: createdRequest
    };
  }

  /**
   * Phê duyệt đề nghị thanh toán (Chủ đầu tư / Chỉ huy trưởng)
   */
  async approvePaymentRequest(projectId, requestId, userId) {
    const pId = Number(projectId);
    const rId = Number(requestId);
    const uId = Number(userId);

    const req = await this.getPaymentRequestById(pId, rId);
    if (!req) {
      const err = new Error('Không tìm thấy đề nghị thanh toán để duyệt');
      err.status = 404;
      throw err;
    }

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    if (this.isConnected) {
      try {
        await this.pool.query(
          'UPDATE payment_requests SET status = "approved", approved_by = ?, approved_at = ? WHERE id = ?',
          [uId, now, rId]
        );
      } catch (_) {
        store.approvePaymentRequest(pId, rId, uId);
      }
    } else {
      store.approvePaymentRequest(pId, rId, uId);
    }

    return {
      success: true,
      message: `Đã phê duyệt đề nghị thanh toán "${req.request_code}" thành công!`,
      data: await this.getPaymentRequestById(pId, rId)
    };
  }
}

module.exports = PaymentService;
