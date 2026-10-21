const fs = require('fs');
const store = require('../models/store');
const { parseExifMetadata, extractJpegDimensions, evaluatePhotoSuspicion } = require('../utils/exifParser');
let recordSheetAuditLog;
try {
  ({ recordSheetAuditLog } = require('./sheetAuditService'));
} catch (_) {}

class AcceptanceService {
  constructor(db) {
    this.db = db;
    this.pool = db?.pool || db;
  }

  get isConnected() {
    return Boolean(this.db && this.db.isConnected !== false && this.pool?.query);
  }

  /**
   * SCRUM-179 / T-70: Lấy luỹ kế đã duyệt gần nhất và số đội đã báo (S-26) để điền sẵn vào form
   */
  async getPrefillData(projectId, toDate = null, fromDate = null) {
    const pId = Number(projectId);
    const currentDate = toDate || new Date().toISOString().slice(0, 10);

    // 1. Lấy danh sách hạng mục công việc (Work items) của dự án kèm khối lượng hợp đồng (S-35 / S-37)
    let workItems = [];
    if (this.isConnected) {
      try {
        const [wRows] = await this.pool.query(
          'SELECT id, project_id, code, name, unit, khoi_luong_hop_dong, don_gia_hop_dong FROM work_items WHERE project_id = ? ORDER BY id ASC',
          [pId]
        );
        workItems = wRows || [];
      } catch (_) {
        workItems = (store.inMemoryWorkItems || []).filter(w => Number(w.project_id) === pId);
      }
    } else {
      workItems = (store.inMemoryWorkItems || []).filter(w => Number(w.project_id) === pId);
    }

    if (workItems.length === 0) {
      // Nếu chưa có work_items, lấy từ tasks hoặc tạo mục mẫu
      const tasks = store.getTasks ? store.getTasks(pId) : (store.inMemoryTasks || []).filter(t => Number(t.project_id) === pId);
      workItems = tasks.map(t => ({
        id: t.work_item_id || t.id,
        code: t.code || `CV-${t.id}`,
        name: t.name,
        unit: 'm3',
        khoi_luong_hop_dong: t.quantity || null,
        don_gia_hop_dong: null
      }));
    }

    // 2. Tìm phiếu nghiệm thu ĐÃ DUYỆT gần nhất để lấy luỹ kế đợt trước (previous_approved_quantity)
    const prevApprovedMap = new Map();
    let nextPeriodNumber = 1;

    if (this.isConnected) {
      try {
        const [sheets] = await this.pool.query(
          'SELECT id, period_number, sheet_code FROM acceptance_sheets WHERE project_id = ? AND status = "approved" ORDER BY period_number DESC LIMIT 1',
          [pId]
        );
        if (sheets && sheets.length > 0) {
          const latestApproved = sheets[0];
          nextPeriodNumber = latestApproved.period_number + 1;
          const [items] = await this.pool.query(
            'SELECT work_item_id, item_name, cumulative_quantity FROM acceptance_sheet_items WHERE sheet_id = ?',
            [latestApproved.id]
          );
          (items || []).forEach(it => {
            if (it.work_item_id) {
              prevApprovedMap.set(Number(it.work_item_id), Number(it.cumulative_quantity || 0));
            } else if (it.item_name) {
              prevApprovedMap.set(it.item_name.trim().toLowerCase(), Number(it.cumulative_quantity || 0));
            }
          });
        } else {
          // Tính nextPeriodNumber dựa trên tổng số phiếu đã tạo
          const [allSheets] = await this.pool.query(
            'SELECT MAX(period_number) AS max_p FROM acceptance_sheets WHERE project_id = ?',
            [pId]
          );
          if (allSheets && allSheets[0]?.max_p) {
            nextPeriodNumber = Number(allSheets[0].max_p) + 1;
          }
        }
      } catch (_) {
        const latestApproved = store.getLatestApprovedAcceptanceSheet(pId);
        if (latestApproved) {
          nextPeriodNumber = latestApproved.period_number + 1;
          latestApproved.items.forEach(it => {
            if (it.work_item_id) {
              prevApprovedMap.set(Number(it.work_item_id), Number(it.cumulative_quantity || 0));
            } else if (it.item_name) {
              prevApprovedMap.set(it.item_name.trim().toLowerCase(), Number(it.cumulative_quantity || 0));
            }
          });
        }
      }
    } else {
      const latestApproved = store.getLatestApprovedAcceptanceSheet(pId);
      if (latestApproved) {
        nextPeriodNumber = latestApproved.period_number + 1;
        latestApproved.items.forEach(it => {
          if (it.work_item_id) {
            prevApprovedMap.set(Number(it.work_item_id), Number(it.cumulative_quantity || 0));
          } else if (it.item_name) {
            prevApprovedMap.set(it.item_name.trim().toLowerCase(), Number(it.cumulative_quantity || 0));
          }
        });
      } else {
        const all = store.getAcceptanceSheets(pId);
        if (all.length > 0) {
          nextPeriodNumber = Math.max(...all.map(s => s.period_number || 1)) + 1;
        }
      }
    }

    // 3. Tổng hợp số đội đã báo ở S-26 (team_daily_progress) để đối chiếu
    const teamReportedMap = new Map();
    if (this.isConnected) {
      try {
        let q = `
          SELECT t.work_item_id, SUM(p.reported_quantity) AS total_reported
          FROM team_daily_progress p
          JOIN tasks t ON p.task_id = t.id
          WHERE p.project_id = ?
        `;
        const params = [pId];
        if (toDate) {
          q += ' AND p.report_date <= ?';
          params.push(toDate);
        }
        if (fromDate) {
          q += ' AND p.report_date >= ?';
          params.push(fromDate);
        }
        q += ' GROUP BY t.work_item_id';
        const [progRows] = await this.pool.query(q, params);
        (progRows || []).forEach(r => {
          if (r.work_item_id) {
            teamReportedMap.set(Number(r.work_item_id), Number(r.total_reported || 0));
          }
        });
      } catch (_) {}
    } else {
      const allProg = store.getTeamDailyProgress(null, null, pId);
      allProg.forEach(p => {
        if (toDate && p.report_date > toDate) return;
        if (fromDate && p.report_date < fromDate) return;
        const task = store.inMemoryTasks.find(t => t.id === p.task_id);
        const wId = p.work_item_id || task?.work_item_id || p.task_id;
        if (wId) {
          const cur = teamReportedMap.get(Number(wId)) || 0;
          teamReportedMap.set(Number(wId), cur + Number(p.reported_quantity || 0));
        }
      });
    }

    // 4. Ghép nối dữ liệu trả về cho form
    const items = workItems.map(w => {
      const wId = Number(w.id);
      const prevApproved = prevApprovedMap.get(wId) || prevApprovedMap.get(w.name?.trim().toLowerCase()) || 0;
      const teamReported = teamReportedMap.get(wId) || 0;
      const contractLimit = (w.khoi_luong_hop_dong !== undefined && w.khoi_luong_hop_dong !== null)
        ? Number(w.khoi_luong_hop_dong)
        : (w.quantity !== undefined && w.quantity !== null ? Number(w.quantity) : null);
      const unitPrice = (w.don_gia_hop_dong !== undefined && w.don_gia_hop_dong !== null)
        ? Number(w.don_gia_hop_dong)
        : 0;

      return {
        work_item_id: wId,
        code: w.code,
        item_name: w.name,
        unit: w.unit || 'm3',
        contract_quantity: contractLimit !== null ? Number(contractLimit.toFixed(4)) : null,
        unit_price: unitPrice,
        previous_approved_quantity: Number(prevApproved.toFixed(2)),
        cumulative_quantity: Number(prevApproved.toFixed(2)), // Mặc định bằng đợt trước, người dùng nhập thêm
        period_quantity: 0.00, // Tự động tính: cumulative - previous_approved
        team_reported_quantity: Number(teamReported.toFixed(2)), // Số đội báo ở S-26 để đối chiếu (AC 3)
        difference: Number((0.00 - teamReported).toFixed(2))
      };
    });

    const padPeriod = String(nextPeriodNumber).padStart(2, '0');
    return {
      project_id: pId,
      suggested_period_number: nextPeriodNumber,
      suggested_sheet_code: `NT-${padPeriod}`,
      suggested_name: `Nghiệm thu khối lượng Đợt ${nextPeriodNumber}`,
      items
    };
  }

  /**
   * SCRUM-180 / T-71: Tạo API lập phiếu và tính khối lượng đợt
   */
  async createAcceptanceSheet(projectId, payload, userId = 1) {
    const pId = Number(projectId);
    const uId = Number(userId);

    const sheetCode = String(payload.sheet_code || payload.code || '').trim();
    const name = String(payload.name || payload.title || '').trim();
    const periodNumber = Number(payload.period_number || 1);
    const fromDate = payload.from_date ? String(payload.from_date).trim() : new Date().toISOString().slice(0, 10);
    const toDate = payload.to_date ? String(payload.to_date).trim() : new Date().toISOString().slice(0, 10);
    const notes = payload.notes ? String(payload.notes).trim() : null;
    const rawItems = Array.isArray(payload.items) ? payload.items : [];

    if (!sheetCode) {
      const err = new Error('Mã phiếu nghiệm thu (sheet_code) không được để trống');
      err.status = 400;
      throw err;
    }
    if (!name) {
      const err = new Error('Tên phiếu nghiệm thu (name) không được để trống');
      err.status = 400;
      throw err;
    }

    // Lấy luỹ kế đã duyệt đợt trước và số đội báo để điền sẵn nếu client không truyền
    const prevApprovedMap = new Map();
    const teamReportedMap = new Map();
    if (this.isConnected) {
      try {
        const [sheets] = await this.pool.query(
          'SELECT id FROM acceptance_sheets WHERE project_id = ? AND status = "approved" ORDER BY period_number DESC LIMIT 1',
          [pId]
        );
        if (sheets && sheets.length > 0) {
          const [itRows] = await this.pool.query(
            'SELECT work_item_id, item_name, cumulative_quantity FROM acceptance_sheet_items WHERE sheet_id = ?',
            [sheets[0].id]
          );
          (itRows || []).forEach(it => {
            if (it.work_item_id) prevApprovedMap.set(Number(it.work_item_id), Number(it.cumulative_quantity || 0));
          });
        }
        let q = `
          SELECT COALESCE(p.work_item_id, t.work_item_id, p.task_id) AS work_item_id, SUM(p.reported_quantity) AS total_reported
          FROM team_daily_progress p
          LEFT JOIN tasks t ON p.task_id = t.id
          WHERE p.project_id = ?
          GROUP BY COALESCE(p.work_item_id, t.work_item_id, p.task_id)
        `;
        const [progRows] = await this.pool.query(q, [pId]);
        (progRows || []).forEach(r => {
          if (r.work_item_id) teamReportedMap.set(Number(r.work_item_id), Number(r.total_reported || 0));
        });
      } catch (_) {}
    } else {
      const latestApproved = store.getLatestApprovedAcceptanceSheet(pId);
      if (latestApproved) {
        latestApproved.items.forEach(it => {
          if (it.work_item_id) prevApprovedMap.set(Number(it.work_item_id), Number(it.cumulative_quantity || 0));
        });
      }
      const allProg = store.getTeamDailyProgress(null, null, pId);
      allProg.forEach(p => {
        const task = store.inMemoryTasks.find(t => t.id === p.task_id);
        const wId = p.work_item_id || task?.work_item_id || p.task_id;
        if (wId) {
          const cur = teamReportedMap.get(Number(wId)) || 0;
          teamReportedMap.set(Number(wId), cur + Number(p.reported_quantity || 0));
        }
      });
    }

    // Tự động tính khối lượng đợt cho từng hạng mục:
    // AC 2: Khối lượng đợt bằng luỹ kế hiện tại trừ luỹ kế đợt trước đã duyệt
    const computedItems = rawItems.map(it => {
      const wId = it.work_item_id ? Number(it.work_item_id) : null;
      const cumulative = Number(it.cumulative_quantity || 0);
      const previousApproved = it.previous_approved_quantity !== undefined && it.previous_approved_quantity !== null
        ? Number(it.previous_approved_quantity)
        : (wId && prevApprovedMap.has(wId) ? prevApprovedMap.get(wId) : 0);

      if (cumulative < previousApproved) {
        const err = new Error(`Khối lượng luỹ kế (${cumulative}) không thể nhỏ hơn luỹ kế đã duyệt đợt trước (${previousApproved}) cho hạng mục "${it.item_name || it.name || wId}"`);
        err.status = 400;
        throw err;
      }

      const periodQty = Number((cumulative - previousApproved).toFixed(2));
      const teamReported = it.team_reported_quantity !== undefined && it.team_reported_quantity !== null
        ? Number(it.team_reported_quantity)
        : (wId && teamReportedMap.has(wId) ? teamReportedMap.get(wId) : 0);
      const diff = Number((periodQty - teamReported).toFixed(2));

      return {
        work_item_id: wId,
        task_id: it.task_id ? Number(it.task_id) : null,
        item_name: String(it.item_name || it.name || 'Hạng mục nghiệm thu').trim(),
        unit: String(it.unit || 'm3').trim(),
        previous_approved_quantity: previousApproved,
        cumulative_quantity: cumulative,
        period_quantity: periodQty,
        team_reported_quantity: teamReported,
        difference: diff,
        notes: it.notes || it.note ? String(it.notes || it.note).trim() : null
      };
    });

    let createdSheet = null;

    if (this.isConnected) {
      const conn = await this.pool.getConnection();
      await conn.beginTransaction();

      try {
        // 1. Kiểm tra trùng mã phiếu trong cùng dự án
        const [dup] = await conn.query(
          'SELECT id FROM acceptance_sheets WHERE project_id = ? AND sheet_code = ? LIMIT 1',
          [pId, sheetCode]
        );
        if (dup && dup.length > 0) {
          const err = new Error(`Mã phiếu "${sheetCode}" đã tồn tại trong dự án này`);
          err.status = 409;
          throw err;
        }

        // 2. SCRUM-S37 / T-68: Khóa dòng và kiểm tra luỹ kế không vượt khối lượng hợp đồng (FOR UPDATE để tuần tự hóa chống Race Condition R-05)
        const [workItemsRows] = await conn.query(
          'SELECT id, code, name, khoi_luong_hop_dong FROM work_items WHERE project_id = ? FOR UPDATE',
          [pId]
        );
        const workItemsMap = new Map();
        (workItemsRows || []).forEach(w => {
          workItemsMap.set(Number(w.id), w);
        });

        for (const it of computedItems) {
          const wInfo = it.work_item_id ? workItemsMap.get(Number(it.work_item_id)) : null;
          const contractLimit = (wInfo && wInfo.khoi_luong_hop_dong !== null && wInfo.khoi_luong_hop_dong !== undefined)
            ? Number(wInfo.khoi_luong_hop_dong)
            : (it.contract_quantity !== undefined && it.contract_quantity !== null ? Number(it.contract_quantity) : null);

          if (contractLimit !== null && !isNaN(contractLimit) && contractLimit > 0) {
            if (it.cumulative_quantity > contractLimit) {
              const itemCode = wInfo?.code || `CV-${it.work_item_id || 'X'}`;
              const itemName = it.item_name || wInfo?.name || 'Hạng mục';
              const err = new Error(`Khối lượng luỹ kế (${it.cumulative_quantity}) vượt quá khối lượng hợp đồng (${contractLimit}) của hạng mục "${itemName}" (${itemCode})`);
              err.status = 400;
              err.details = {
                work_item_id: it.work_item_id,
                item_name: itemName,
                item_code: itemCode,
                contract_quantity: contractLimit,
                cumulative_quantity: it.cumulative_quantity,
                excess_quantity: Number((it.cumulative_quantity - contractLimit).toFixed(2))
              };
              throw err;
            }
          }
        }

        // 3. Tạo phiếu nghiệm thu
        const [res] = await conn.query(
          `INSERT INTO acceptance_sheets (project_id, sheet_code, name, period_number, from_date, to_date, status, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
          [pId, sheetCode, name, periodNumber, fromDate, toDate, notes, uId]
        );
        const sheetId = res.insertId;

        for (const it of computedItems) {
          await conn.query(
            `INSERT INTO acceptance_sheet_items (sheet_id, work_item_id, task_id, item_name, unit, previous_approved_quantity, cumulative_quantity, period_quantity, team_reported_quantity, difference, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [sheetId, it.work_item_id, it.task_id, it.item_name, it.unit, it.previous_approved_quantity, it.cumulative_quantity, it.period_quantity, it.team_reported_quantity, it.difference, it.notes]
          );
        }

        await conn.commit();
        createdSheet = await this.getAcceptanceSheetById(pId, sheetId);
      } catch (err) {
        await conn.rollback();
        if (err.sqlState === '45000' || (err.message && err.message.toLowerCase().includes('vượt quá khối lượng hợp đồng'))) {
          err.status = 400;
        }
        throw err;
      } finally {
        conn.release();
      }
    } else {
      const all = store.getAcceptanceSheets(pId);
      if (all.some(s => s.sheet_code.toLowerCase() === sheetCode.toLowerCase())) {
        const err = new Error(`Mã phiếu "${sheetCode}" đã tồn tại trong dự án này`);
        err.status = 409;
        throw err;
      }

      // S-37 In-memory validation
      const inMemWorkItems = (store.inMemoryWorkItems || []).filter(w => Number(w.project_id) === pId);
      const inMemTasks = (store.inMemoryTasks || []).filter(t => Number(t.project_id) === pId);

      for (const it of computedItems) {
        let contractLimit = null;
        let itemCode = 'CV';
        if (it.work_item_id) {
          const wi = inMemWorkItems.find(w => Number(w.id) === Number(it.work_item_id));
          if (wi) {
            itemCode = wi.code || itemCode;
            contractLimit = (wi.khoi_luong_hop_dong !== undefined && wi.khoi_luong_hop_dong !== null)
              ? Number(wi.khoi_luong_hop_dong)
              : (wi.quantity !== undefined ? Number(wi.quantity) : null);
          } else {
            const task = inMemTasks.find(t => Number(t.work_item_id || t.id) === Number(it.work_item_id));
            if (task) {
              itemCode = task.code || itemCode;
              contractLimit = task.quantity ? Number(task.quantity) : null;
            }
          }
        }
        if (it.contract_quantity !== undefined && it.contract_quantity !== null) {
          contractLimit = Number(it.contract_quantity);
        }

        if (contractLimit !== null && !isNaN(contractLimit) && contractLimit > 0) {
          if (it.cumulative_quantity > contractLimit) {
            const itemName = it.item_name || 'Hạng mục';
            const err = new Error(`Khối lượng luỹ kế (${it.cumulative_quantity}) vượt quá khối lượng hợp đồng (${contractLimit}) của hạng mục "${itemName}" (${itemCode})`);
            err.status = 400;
            err.details = {
              work_item_id: it.work_item_id,
              item_name: itemName,
              item_code: itemCode,
              contract_quantity: contractLimit,
              cumulative_quantity: it.cumulative_quantity,
              excess_quantity: Number((it.cumulative_quantity - contractLimit).toFixed(2))
            };
            throw err;
          }
        }
      }

      const sheet = store.saveAcceptanceSheet({
        project_id: pId,
        sheet_code: sheetCode,
        name,
        period_number: periodNumber,
        from_date: fromDate,
        to_date: toDate,
        status: 'draft',
        notes,
        created_by: uId
      });

      computedItems.forEach(it => {
        store.saveAcceptanceSheetItem({
          sheet_id: sheet.id,
          ...it
        });
      });

      createdSheet = store.getAcceptanceSheetById(sheet.id);
    }

    // S-39: Ghi nhật ký thao tác lập phiếu nghiệm thu (Append-Only)
    try {
      if (recordSheetAuditLog && createdSheet) {
        await recordSheetAuditLog({
          projectId: pId,
          entityType: 'acceptance_sheet',
          entityId: String(createdSheet.id),
          action: 'CREATE',
          performedBy: uId,
          oldValues: null,
          newValues: {
            sheet_code: createdSheet.sheet_code,
            name: createdSheet.name,
            period_number: createdSheet.period_number,
            from_date: createdSheet.from_date,
            to_date: createdSheet.to_date,
            status: createdSheet.status,
            items_count: (createdSheet.items || []).length
          },
          changeSummary: `Lập phiếu nghiệm thu đợt ${createdSheet.period_number} (${createdSheet.sheet_code})`,
          reason: notes || 'Lập mới phiếu nghiệm thu'
        });
      }
    } catch (auditErr) {
      console.warn('[AcceptanceService] Audit log recording failed:', auditErr.message);
    }

    return {
      success: true,
      message: 'Lập phiếu nghiệm thu theo đợt thành công',
      data: createdSheet
    };
  }

  /**
   * Lấy danh sách phiếu nghiệm thu của dự án
   */
  async getAcceptanceSheets(projectId) {
    const pId = Number(projectId);
    if (this.isConnected) {
      try {
        const [rows] = await this.pool.query(
          `SELECT s.*, u.full_name as creator_name, app.full_name as approver_name,
                  COUNT(i.id) as item_count,
                  COALESCE(SUM(i.period_quantity), 0) as total_period_quantity,
                  (SELECT COUNT(p.id) FROM acceptance_sheet_photos p WHERE p.sheet_id = s.id) as photo_count
           FROM acceptance_sheets s
           LEFT JOIN users u ON s.created_by = u.id
           LEFT JOIN users app ON s.approved_by = app.id
           LEFT JOIN acceptance_sheet_items i ON s.id = i.sheet_id
           WHERE s.project_id = ?
           GROUP BY s.id
           ORDER BY s.period_number DESC, s.id DESC`,
          [pId]
        );
        return rows || [];
      } catch (_) {
        return store.getAcceptanceSheets(pId);
      }
    } else {
      return store.getAcceptanceSheets(pId).map(s => {
        const full = store.getAcceptanceSheetById(s.id);
        const totalPeriod = (full?.items || []).reduce((acc, it) => acc + Number(it.period_quantity || 0), 0);
        return {
          ...s,
          item_count: (full?.items || []).length,
          photo_count: (full?.photos || []).length,
          total_period_quantity: Number(totalPeriod.toFixed(2))
        };
      });
    }
  }

  /**
   * Lấy chi tiết 1 phiếu nghiệm thu kèm các hạng mục và ảnh đính kèm
   */
  async getAcceptanceSheetById(projectId, sheetId) {
    const pId = Number(projectId);
    const sId = Number(sheetId);

    if (this.isConnected) {
      const [sRows] = await this.pool.query(
        `SELECT s.*, u.full_name as creator_name, app.full_name as approver_name
         FROM acceptance_sheets s
         LEFT JOIN users u ON s.created_by = u.id
         LEFT JOIN users app ON s.approved_by = app.id
         WHERE s.id = ? AND s.project_id = ?`,
        [sId, pId]
      );
      if (!sRows || sRows.length === 0) return null;
      const sheet = sRows[0];

      const [items] = await this.pool.query(
        'SELECT * FROM acceptance_sheet_items WHERE sheet_id = ? ORDER BY id ASC',
        [sId]
      );

      const [photos] = await this.pool.query(
        'SELECT * FROM acceptance_sheet_photos WHERE sheet_id = ? ORDER BY id ASC',
        [sId]
      );

      const mappedPhotos = (photos || []).map(p => {
        let reasons = [];
        try {
          if (Array.isArray(p.suspicious_reasons)) {
            reasons = p.suspicious_reasons;
          } else if (typeof p.suspicious_reasons === 'string' && p.suspicious_reasons.trim()) {
            reasons = JSON.parse(p.suspicious_reasons);
          }
        } catch (_) {}

        return {
          ...p,
          url: p.file_path || `/uploads/acceptance/${p.file_name}`,
          is_suspicious: Boolean(p.is_suspicious),
          suspicious_reasons: reasons,
          confidence_level: p.confidence_level || 'none',
          suspicious_details: p.suspicious_details || null,
          metadata_status_text: (p.has_metadata || p.taken_at || p.latitude)
            ? 'Đã có siêu dữ liệu'
            : 'Không có siêu dữ liệu'
        };
      });

      return {
        ...sheet,
        items: items || [],
        photos: mappedPhotos
      };
    } else {
      const sheet = store.getAcceptanceSheetById(sId);
      if (!sheet || Number(sheet.project_id) !== pId) return null;
      return sheet;
    }
  }

  /**
   * Phê duyệt phiếu nghiệm thu (Chỉ huy trưởng / Ban QLDA)
   */
  async approveAcceptanceSheet(projectId, sheetId, userId) {
    const pId = Number(projectId);
    const sId = Number(sheetId);
    const uId = Number(userId);

    const sheet = await this.getAcceptanceSheetById(pId, sId);
    if (!sheet) {
      const err = new Error('Không tìm thấy phiếu nghiệm thu để duyệt');
      err.status = 404;
      throw err;
    }

    if (sheet.status === 'approved') {
      const err = new Error('Phiếu nghiệm thu này đã được phê duyệt trước đó.');
      err.status = 400;
      throw err;
    }

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    if (this.isConnected) {
      await this.pool.query(
        'UPDATE acceptance_sheets SET status = "approved", approved_by = ?, approved_at = ? WHERE id = ?',
        [uId, now, sId]
      );
    } else {
      store.updateAcceptanceSheet(sId, {
        status: 'approved',
        approved_by: uId,
        approved_at: now
      });
    }

    const updatedSheet = await this.getAcceptanceSheetById(pId, sId);

    // S-39: Ghi nhật ký thao tác phê duyệt phiếu nghiệm thu (Append-Only)
    try {
      if (recordSheetAuditLog) {
        await recordSheetAuditLog({
          projectId: pId,
          entityType: 'acceptance_sheet',
          entityId: String(sId),
          action: 'APPROVE',
          performedBy: uId,
          oldValues: {
            status: sheet.status,
            approved_by: sheet.approved_by,
            approved_at: sheet.approved_at
          },
          newValues: {
            status: 'approved',
            approved_by: uId,
            approved_at: now
          },
          changeSummary: `Phê duyệt phiếu nghiệm thu đợt ${sheet.period_number || 1} (${sheet.sheet_code})`,
          reason: 'Phê duyệt nghiệm thu hoàn thành'
        });
      }
    } catch (auditErr) {
      console.warn('[AcceptanceService] Audit log approval recording failed:', auditErr.message);
    }

    return {
      success: true,
      message: `Đã phê duyệt phiếu nghiệm thu "${sheet.sheet_code}" thành công!`,
      data: updatedSheet
    };
  }

  /**
   * S-38 (SCRUM-167 / AC 2): Ban quản lý trả lại phiếu nghiệm thu kèm lý do bắt buộc
   * Phiếu quay về cho người lập sửa
   */
  async rejectAcceptanceSheet(projectId, sheetId, userId, reason) {
    const pId = Number(projectId);
    const sId = Number(sheetId);
    const uId = Number(userId);

    const sheet = await this.getAcceptanceSheetById(pId, sId);
    if (!sheet) {
      const err = new Error('Không tìm thấy phiếu nghiệm thu để trả lại');
      err.status = 404;
      throw err;
    }

    const cleanReason = String(reason || '').trim();
    if (!cleanReason) {
      const err = new Error('Lý do trả lại phiếu nghiệm thu là bắt buộc và không được để trống.');
      err.status = 400;
      throw err;
    }

    if (sheet.status === 'approved') {
      const err = new Error('Phiếu nghiệm thu đã phê duyệt không thể trả lại. Muốn điều chỉnh phải lập phiếu điều chỉnh.');
      err.status = 422;
      throw err;
    }

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    if (this.isConnected) {
      await this.pool.query(
        'UPDATE acceptance_sheets SET status = "rejected", rejection_reason = ?, rejected_by = ?, rejected_at = ? WHERE id = ? AND project_id = ?',
        [cleanReason, uId, now, sId, pId]
      );
    } else {
      store.rejectAcceptanceSheet(sId, {
        reason: cleanReason,
        rejected_by: uId
      });
    }

    const updatedSheet = await this.getAcceptanceSheetById(pId, sId);

    // Ghi nhật ký audit log thao tác trả lại phiếu nghiệm thu (Append-Only)
    try {
      if (recordSheetAuditLog) {
        await recordSheetAuditLog({
          projectId: pId,
          entityType: 'acceptance_sheet',
          entityId: String(sId),
          action: 'REJECT',
          performedBy: uId,
          oldValues: {
            status: sheet.status,
            rejection_reason: sheet.rejection_reason || null
          },
          newValues: {
            status: 'rejected',
            rejection_reason: cleanReason,
            rejected_by: uId,
            rejected_at: now
          },
          changeSummary: `Trả lại phiếu nghiệm thu đợt ${sheet.period_number || 1} (${sheet.sheet_code}) kèm lý do: ${cleanReason}`,
          reason: cleanReason
        });
      }
    } catch (auditErr) {
      console.warn('[AcceptanceService] Audit log rejection recording failed:', auditErr.message);
    }

    return {
      success: true,
      message: `Đã trả lại phiếu nghiệm thu "${sheet.sheet_code}". Phiếu đã được chuyển về cho người lập sửa.`,
      data: updatedSheet
    };
  }

  /**
   * S-38 (SCRUM-167 / AC 2 & AC 3): Cập nhật / sửa phiếu nghiệm thu
   * AC 2: Phiếu bị trả lại quay về cho người lập sửa
   * AC 3: Chặn sửa trực tiếp phiếu đã duyệt; muốn sửa phải lập phiếu điều chỉnh
   */
  async updateAcceptanceSheet(projectId, sheetId, payload = {}, userId = 1) {
    const pId = Number(projectId);
    const sId = Number(sheetId);
    const uId = Number(userId);

    const sheet = await this.getAcceptanceSheetById(pId, sId);
    if (!sheet) {
      const err = new Error('Không tìm thấy phiếu nghiệm thu để cập nhật');
      err.status = 404;
      throw err;
    }

    // AC 3: Chặn sửa trực tiếp phiếu đã duyệt
    if (sheet.status === 'approved') {
      const err = new Error('Phiếu nghiệm thu đã được phê duyệt không được phép chỉnh sửa trực tiếp. Vui lòng lập phiếu điều chỉnh.');
      err.status = 422;
      throw err;
    }

    const name = payload.name !== undefined ? String(payload.name).trim() : (payload.title !== undefined ? String(payload.title).trim() : sheet.name);
    const notes = payload.notes !== undefined ? String(payload.notes).trim() : (payload.note !== undefined ? String(payload.note).trim() : (sheet.notes || sheet.note));
    const rawItems = Array.isArray(payload.items) ? payload.items : null;

    if (rawItems && rawItems.length > 0) {
      // 1. Lấy previous approved quantities
      const prevApprovedMap = new Map();
      if (this.isConnected) {
        try {
          const [prevSheets] = await this.pool.query(
            'SELECT id FROM acceptance_sheets WHERE project_id = ? AND status = "approved" AND id != ? ORDER BY period_number DESC LIMIT 1',
            [pId, sId]
          );
          if (prevSheets && prevSheets.length > 0) {
            const [itRows] = await this.pool.query(
              'SELECT work_item_id, cumulative_quantity FROM acceptance_sheet_items WHERE sheet_id = ?',
              [prevSheets[0].id]
            );
            (itRows || []).forEach(it => {
              if (it.work_item_id) prevApprovedMap.set(Number(it.work_item_id), Number(it.cumulative_quantity || 0));
            });
          }
        } catch (_) {}
      } else {
        const latestApproved = store.getLatestApprovedAcceptanceSheet(pId);
        if (latestApproved && latestApproved.id !== sId) {
          latestApproved.items.forEach(it => {
            if (it.work_item_id) prevApprovedMap.set(Number(it.work_item_id), Number(it.cumulative_quantity || 0));
          });
        }
      }

      // 2. Tính toán & kiểm tra luỹ kế
      const computedItems = rawItems.map(it => {
        const wId = it.work_item_id ? Number(it.work_item_id) : null;
        const cumulative = Number(it.cumulative_quantity || 0);
        const previousApproved = it.previous_approved_quantity !== undefined && it.previous_approved_quantity !== null
          ? Number(it.previous_approved_quantity)
          : (wId && prevApprovedMap.has(wId) ? prevApprovedMap.get(wId) : 0);

        if (cumulative < previousApproved) {
          const err = new Error(`Khối lượng luỹ kế (${cumulative}) không thể nhỏ hơn luỹ kế đã duyệt đợt trước (${previousApproved}) cho hạng mục "${it.item_name || it.name || wId}"`);
          err.status = 400;
          throw err;
        }

        const periodQty = Number((cumulative - previousApproved).toFixed(2));
        const teamReported = it.team_reported_quantity !== undefined && it.team_reported_quantity !== null
          ? Number(it.team_reported_quantity)
          : Number(it.period_quantity || 0);
        const diff = Number((periodQty - teamReported).toFixed(2));

        return {
          work_item_id: wId,
          task_id: it.task_id ? Number(it.task_id) : null,
          item_name: String(it.item_name || it.name || 'Hạng mục nghiệm thu').trim(),
          unit: String(it.unit || 'm3').trim(),
          previous_approved_quantity: previousApproved,
          cumulative_quantity: cumulative,
          period_quantity: periodQty,
          team_reported_quantity: teamReported,
          difference: diff,
          notes: it.notes || it.note ? String(it.notes || it.note).trim() : null
        };
      });

      if (this.isConnected) {
        const conn = await this.pool.getConnection();
        await conn.beginTransaction();
        try {
          // Khóa work_items và kiểm tra giới hạn hợp đồng S-37
          const [workItemsRows] = await conn.query(
            'SELECT id, code, name, khoi_luong_hop_dong FROM work_items WHERE project_id = ? FOR UPDATE',
            [pId]
          );
          const workItemsMap = new Map();
          (workItemsRows || []).forEach(w => workItemsMap.set(Number(w.id), w));

          for (const it of computedItems) {
            const wInfo = it.work_item_id ? workItemsMap.get(Number(it.work_item_id)) : null;
            const contractLimit = (wInfo && wInfo.khoi_luong_hop_dong !== null && wInfo.khoi_luong_hop_dong !== undefined)
              ? Number(wInfo.khoi_luong_hop_dong)
              : (it.contract_quantity !== undefined && it.contract_quantity !== null ? Number(it.contract_quantity) : null);

            if (contractLimit !== null && !isNaN(contractLimit) && contractLimit > 0) {
              if (it.cumulative_quantity > contractLimit) {
                const itemCode = wInfo?.code || `CV-${it.work_item_id || 'X'}`;
                const itemName = it.item_name || wInfo?.name || 'Hạng mục';
                const err = new Error(`Khối lượng luỹ kế (${it.cumulative_quantity}) vượt quá khối lượng hợp đồng (${contractLimit}) của hạng mục "${itemName}" (${itemCode})`);
                err.status = 400;
                throw err;
              }
            }
          }

          // Cập nhật thông tin phiếu (chuyển status thành draft sau khi sửa)
          await conn.query(
            'UPDATE acceptance_sheets SET name = ?, notes = ?, status = "draft" WHERE id = ? AND project_id = ?',
            [name, notes, sId, pId]
          );

          // Xóa các item cũ và thêm item mới
          await conn.query('DELETE FROM acceptance_sheet_items WHERE sheet_id = ?', [sId]);
          for (const it of computedItems) {
            await conn.query(
              `INSERT INTO acceptance_sheet_items (sheet_id, work_item_id, task_id, item_name, unit, previous_approved_quantity, cumulative_quantity, period_quantity, team_reported_quantity, difference, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [sId, it.work_item_id, it.task_id, it.item_name, it.unit, it.previous_approved_quantity, it.cumulative_quantity, it.period_quantity, it.team_reported_quantity, it.difference, it.notes]
            );
          }
          await conn.commit();
        } catch (err) {
          await conn.rollback();
          throw err;
        } finally {
          conn.release();
        }
      } else {
        // In-memory S-37 validation & update
        const inMemWorkItems = (store.inMemoryWorkItems || []).filter(w => Number(w.project_id) === pId);
        for (const it of computedItems) {
          let contractLimit = null;
          if (it.work_item_id) {
            const wi = inMemWorkItems.find(w => Number(w.id) === Number(it.work_item_id));
            if (wi) {
              contractLimit = (wi.khoi_luong_hop_dong !== undefined && wi.khoi_luong_hop_dong !== null)
                ? Number(wi.khoi_luong_hop_dong)
                : (wi.quantity !== undefined ? Number(wi.quantity) : (wi.contract_quantity !== undefined ? Number(wi.contract_quantity) : null));
            }
          }
          if (it.contract_quantity !== undefined && it.contract_quantity !== null) {
            contractLimit = Number(it.contract_quantity);
          }
          if (contractLimit !== null && !isNaN(contractLimit) && contractLimit > 0) {
            if (it.cumulative_quantity > contractLimit) {
              const err = new Error(`Khối lượng luỹ kế (${it.cumulative_quantity}) vượt quá khối lượng hợp đồng (${contractLimit}) của hạng mục "${it.item_name}"`);
              err.status = 400;
              throw err;
            }
          }
        }

        store.updateAcceptanceSheet(sId, { name, notes, status: 'draft' });
        const filtered = store.inMemoryAcceptanceSheetItems.filter(i => i.sheet_id !== sId);
        store.inMemoryAcceptanceSheetItems.length = 0;
        store.inMemoryAcceptanceSheetItems.push(...filtered);
        computedItems.forEach(it => store.saveAcceptanceSheetItem({ sheet_id: sId, ...it }));
      }
    } else {
      // Chỉ cập nhật thông tin chung
      if (this.isConnected) {
        await this.pool.query(
          'UPDATE acceptance_sheets SET name = ?, notes = ? WHERE id = ? AND project_id = ?',
          [name, notes, sId, pId]
        );
      } else {
        store.updateAcceptanceSheet(sId, { name, notes });
      }
    }

    const updatedSheet = await this.getAcceptanceSheetById(pId, sId);

    // Ghi audit log
    try {
      if (recordSheetAuditLog) {
        await recordSheetAuditLog({
          projectId: pId,
          entityType: 'acceptance_sheet',
          entityId: String(sId),
          action: 'UPDATE',
          performedBy: uId,
          oldValues: { name: sheet.name, status: sheet.status },
          newValues: { name: updatedSheet.name, status: updatedSheet.status },
          changeSummary: `Người lập sửa lại phiếu nghiệm thu (${sheet.sheet_code})`,
          reason: notes || 'Cập nhật nội dung phiếu nghiệm thu'
        });
      }
    } catch (_) {}

    return {
      success: true,
      message: `Cập nhật phiếu nghiệm thu "${sheet.sheet_code}" thành công!`,
      data: updatedSheet
    };
  }

  /**
   * Đính kèm ảnh hiện trường vào phiếu nghiệm thu (AC 4 & S-40 EXIF & S-41 Site Radius & S-42 Anti-fraud)
   */
  async addPhotos(projectId, sheetId, files = []) {
    const pId = Number(projectId);
    const sId = Number(sheetId);

    const sheet = await this.getAcceptanceSheetById(pId, sId);
    if (!sheet) {
      const err = new Error('Không tìm thấy phiếu nghiệm thu để đính kèm ảnh');
      err.status = 404;
      throw err;
    }

    if (!Array.isArray(files) || files.length === 0) {
      const err = new Error('Không có tệp ảnh nào được gửi lên');
      err.status = 400;
      throw err;
    }

    // S-41 (AC 1): Lấy tọa độ tâm và bán kính công trường của đúng dự án này
    let projectLocation = null;
    if (this.isConnected) {
      try {
        const [projRows] = await this.pool.query(
          'SELECT site_latitude, site_longitude, site_radius_meters FROM projects WHERE id = ?',
          [pId]
        );
        if (projRows && projRows.length > 0) {
          projectLocation = projRows[0];
        }
      } catch (_) {}
    } else {
      projectLocation = store.getProjectSiteLocation ? store.getProjectSiteLocation(pId) : null;
    }

    const added = [];
    for (const file of files) {
      const fileName = file.filename || file.file_name || file.name;
      const filePath = file.path || file.file_path || file.url || `/uploads/acceptance/${fileName}`;
      const fileSize = Number(file.size || file.file_size || 0);
      const mimeType = file.mimetype || file.mime_type || 'image/jpeg';
      const caption = file.caption ? String(file.caption).trim() : null;

      // S-40: Đọc thời điểm và toạ độ GPS từ EXIF
      let exif = { has_metadata: false, taken_at: null, latitude: null, longitude: null };
      let dims = null;
      try {
        const buf = file.buffer || (file.path && fs.existsSync(file.path) ? fs.readFileSync(file.path) : null);
        if (buf) {
          exif = parseExifMetadata(buf);
          dims = extractJpegDimensions(buf);
        }
      } catch (_) {}

      const takenAt = file.taken_at || exif.taken_at || null;
      const latitude = file.latitude !== undefined && file.latitude !== null ? Number(file.latitude) : exif.latitude;
      const longitude = file.longitude !== undefined && file.longitude !== null ? Number(file.longitude) : exif.longitude;
      const hasMetadata = Boolean(exif.has_metadata || takenAt || (latitude !== null && latitude !== undefined));

      // SCRUM-S42 & S-41: Phát hiện ảnh thiếu siêu dữ liệu, chụp lại màn hình, hoặc ngoài bán kính công trường
      const suspicion = evaluatePhotoSuspicion({
        metadata: {
          ...exif,
          taken_at: takenAt,
          latitude,
          longitude,
          has_metadata: hasMetadata,
          camera_make: file.camera_make || file.make || exif.camera_make || exif.make,
          camera_model: file.camera_model || file.model || exif.camera_model || exif.model
        },
        fileName,
        width: file.width || dims?.width,
        height: file.height || dims?.height,
        inspectionDate: sheet.to_date || sheet.from_date || new Date().toISOString().slice(0, 10),
        projectLocation
      });

      const isSuspicious = file.is_suspicious !== undefined ? Boolean(file.is_suspicious) : suspicion.is_suspicious;
      const suspiciousReasons = file.suspicious_reasons || suspicion.suspicious_reasons || [];
      const confidenceLevel = file.confidence_level || suspicion.confidence_level || 'none';
      const suspiciousDetails = file.suspicious_details || (suspicion.suspicious_details ? JSON.stringify(suspicion.suspicious_details) : null);
      const distanceToCenter = file.distance_to_center_meters !== undefined && file.distance_to_center_meters !== null
        ? Number(file.distance_to_center_meters)
        : (suspicion.distance_to_center_meters !== undefined ? suspicion.distance_to_center_meters : null);

      if (this.isConnected) {
        const [res] = await this.pool.query(
          `INSERT INTO acceptance_sheet_photos (sheet_id, file_name, file_path, file_size, mime_type, caption, taken_at, latitude, longitude, distance_to_center_meters, has_metadata, is_suspicious, suspicious_reasons, confidence_level, suspicious_details)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sId,
            fileName,
            filePath,
            fileSize,
            mimeType,
            caption,
            takenAt,
            latitude,
            longitude,
            distanceToCenter,
            hasMetadata,
            isSuspicious,
            JSON.stringify(suspiciousReasons),
            confidenceLevel,
            suspiciousDetails
          ]
        );
        added.push({
          id: res.insertId,
          sheet_id: sId,
          file_name: fileName,
          file_path: filePath,
          url: filePath,
          caption,
          taken_at: takenAt,
          latitude,
          longitude,
          distance_to_center_meters: distanceToCenter,
          has_metadata: hasMetadata,
          is_suspicious: isSuspicious,
          suspicious_reasons: suspiciousReasons,
          confidence_level: confidenceLevel,
          suspicious_details: suspiciousDetails,
          metadata_status_text: hasMetadata ? 'Đã có siêu dữ liệu' : 'Không có siêu dữ liệu'
        });
      } else {
        const photo = store.saveAcceptanceSheetPhoto({
          sheet_id: sId,
          file_name: fileName,
          file_path: filePath,
          file_size: fileSize,
          mime_type: mimeType,
          caption,
          taken_at: takenAt,
          latitude,
          longitude,
          distance_to_center_meters: distanceToCenter,
          has_metadata: hasMetadata,
          is_suspicious: isSuspicious,
          suspicious_reasons: suspiciousReasons,
          confidence_level: confidenceLevel,
          suspicious_details: suspiciousDetails
        });
        added.push({
          ...photo,
          url: filePath,
          distance_to_center_meters: distanceToCenter,
          metadata_status_text: hasMetadata ? 'Đã có siêu dữ liệu' : 'Không có siêu dữ liệu'
        });
      }
    }

    return {
      success: true,
      message: `Đã đính kèm ${added.length} ảnh hiện trường vào phiếu nghiệm thu`,
      data: added,
      photos: added
    };
  }

  /**
   * Xóa phiếu nghiệm thu (Chỉ khi ở trạng thái draft)
   */
  async deleteAcceptanceSheet(projectId, sheetId) {
    const pId = Number(projectId);
    const sId = Number(sheetId);

    const sheet = await this.getAcceptanceSheetById(pId, sId);
    if (!sheet) {
      const err = new Error('Không tìm thấy phiếu nghiệm thu');
      err.status = 404;
      throw err;
    }

    if (sheet.status === 'approved') {
      const err = new Error('Phiếu nghiệm thu đã phê duyệt không thể xóa.');
      err.status = 409;
      throw err;
    }

    if (this.isConnected) {
      await this.pool.query('DELETE FROM acceptance_sheets WHERE id = ?', [sId]);
    } else {
      store.deleteAcceptanceSheet(sId);
    }

    return {
      success: true,
      message: 'Đã xóa phiếu nghiệm thu thành công'
    };
  }
}

module.exports = AcceptanceService;
