/**
 * S-39 / SCRUM-168: Dịch vụ ghi nhật ký thao tác trên phiếu chỉ ghi thêm (Append-Only Audit Logs)
 * 
 * Đáp ứng AC:
 * - Ghi thao tác trên:
 *   1. Phiếu nghiệm thu (acceptance_sheet)
 *   2. Đề nghị thanh toán (payment_request)
 *   3. Khối lượng hợp đồng (contract_volume / work_item)
 *   4. Khóa sổ nhật ký (site_diary_lock)
 * - Kèm thông tin bắt buộc: người thực hiện, thời điểm, loại thao tác, giá trị trước/sau (old_values, new_values), lý do/ghi chú.
 * - Tính chất Append-Only: Không có API sửa hoặc xoá bản ghi nhật ký.
 */

const store = require('../models/store');
const db = require('../../db');

class SheetAuditService {
  constructor(customDb = null) {
    this.db = customDb || db;
    this.pool = this.db?.pool || this.db;
  }

  get isConnected() {
    return Boolean(this.db && this.db.isConnected !== false && this.pool?.query);
  }

  /**
   * Ghi nhận thao tác mới vào nhật ký (chỉ ghi thêm - Append Only)
   * @param {Object} logData 
   */
  async recordLog(logData) {
    const {
      projectId,
      entityType,
      entityId,
      action,
      performedBy,
      userName = null,
      roleName = null,
      oldValues = null,
      newValues = null,
      changeSummary = null,
      reason = null,
      ipAddress = null
    } = logData;

    if (!projectId || !entityType || !entityId || !action) {
      throw new Error('projectId, entityType, entityId, and action are required to record audit log');
    }

    const pId = Number(projectId);
    const eId = String(entityId);
    const userId = performedBy ? Number(performedBy) : null;
    const oldValJson = oldValues !== undefined && oldValues !== null ? (typeof oldValues === 'string' ? oldValues : JSON.stringify(oldValues)) : null;
    const newValJson = newValues !== undefined && newValues !== null ? (typeof newValues === 'string' ? newValues : JSON.stringify(newValues)) : null;

    if (this.isConnected) {
      try {
        const query = `
          INSERT INTO sheet_audit_logs 
          (project_id, entity_type, entity_id, action, performed_by, user_name, role_name, old_values, new_values, change_summary, reason, ip_address, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;
        const [result] = await this.pool.query(query, [
          pId,
          entityType,
          eId,
          action.toUpperCase(),
          userId,
          userName || null,
          roleName || null,
          oldValJson,
          newValJson,
          changeSummary || null,
          reason || null,
          ipAddress || null
        ]);

        const insertedId = result.insertId;
        return {
          id: insertedId,
          project_id: pId,
          entity_type: entityType,
          entity_id: eId,
          action: action.toUpperCase(),
          performed_by: userId,
          user_name: userName || null,
          role_name: roleName || null,
          old_values: oldValues,
          new_values: newValues,
          change_summary: changeSummary || null,
          reason: reason || null,
          ip_address: ipAddress || null,
          created_at: new Date().toISOString()
        };
      } catch (err) {
        console.warn('[SheetAuditService] Database insert failed, falling back to in-memory store:', err.message);
      }
    }

    // Fallback: In-memory store
    return store.saveSheetAuditLog({
      project_id: pId,
      entity_type: entityType,
      entity_id: eId,
      action: action.toUpperCase(),
      performed_by: userId,
      user_name: userName || null,
      role_name: roleName || null,
      old_values: oldValues,
      new_values: newValues,
      change_summary: changeSummary || null,
      reason: reason || null,
      ip_address: ipAddress || null
    });
  }

  /**
   * Truy vấn danh sách nhật ký thao tác kèm bộ lọc
   */
  async getLogs(projectId, filters = {}) {
    const pId = Number(projectId);
    const {
      entityType,
      entityId,
      action,
      fromDate,
      toDate,
      search,
      limit = 50,
      offset = 0
    } = filters;

    if (this.isConnected) {
      try {
        let sql = `SELECT * FROM sheet_audit_logs WHERE project_id = ?`;
        const params = [pId];

        if (entityType) {
          sql += ` AND entity_type = ?`;
          params.push(entityType);
        }
        if (entityId) {
          sql += ` AND entity_id = ?`;
          params.push(String(entityId));
        }
        if (action) {
          sql += ` AND action = ?`;
          params.push(action.toUpperCase());
        }
        if (fromDate) {
          sql += ` AND created_at >= ?`;
          params.push(`${fromDate} 00:00:00`);
        }
        if (toDate) {
          sql += ` AND created_at <= ?`;
          params.push(`${toDate} 23:59:59`);
        }
        if (search) {
          sql += ` AND (change_summary LIKE ? OR reason LIKE ? OR user_name LIKE ? OR entity_id LIKE ?)`;
          const s = `%${search}%`;
          params.push(s, s, s, s);
        }

        // Count total
        const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
        const [countRows] = await this.pool.query(countSql, params);
        const total = countRows && countRows[0] ? countRows[0].total : 0;

        sql += ` ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`;
        params.push(Number(limit), Number(offset));

        const [rows] = await this.pool.query(sql, params);

        const logs = (rows || []).map(row => {
          let oldVal = row.old_values;
          let newVal = row.new_values;
          if (typeof oldVal === 'string') {
            try { oldVal = JSON.parse(oldVal); } catch (_) {}
          }
          if (typeof newVal === 'string') {
            try { newVal = JSON.parse(newVal); } catch (_) {}
          }
          return {
            ...row,
            old_values: oldVal,
            new_values: newVal
          };
        });

        return {
          total,
          limit: Number(limit),
          offset: Number(offset),
          data: logs
        };
      } catch (err) {
        console.warn('[SheetAuditService] Database query failed, falling back to in-memory store:', err.message);
      }
    }

    // Fallback: In-memory store
    return store.getSheetAuditLogs(pId, {
      entityType,
      entityId,
      action,
      fromDate,
      toDate,
      search,
      limit,
      offset
    });
  }

  /**
   * Lấy chi tiết 1 bản ghi nhật ký
   */
  async getLogById(projectId, logId) {
    const pId = Number(projectId);
    const lId = Number(logId);

    if (this.isConnected) {
      try {
        const [rows] = await this.pool.query(
          'SELECT * FROM sheet_audit_logs WHERE id = ? AND project_id = ? LIMIT 1',
          [lId, pId]
        );
        if (rows && rows.length > 0) {
          const row = rows[0];
          let oldVal = row.old_values;
          let newVal = row.new_values;
          if (typeof oldVal === 'string') {
            try { oldVal = JSON.parse(oldVal); } catch (_) {}
          }
          if (typeof newVal === 'string') {
            try { newVal = JSON.parse(newVal); } catch (_) {}
          }
          return {
            ...row,
            old_values: oldVal,
            new_values: newVal
          };
        }
        return null;
      } catch (err) {
        console.warn('[SheetAuditService] Database getLogById failed, fallback:', err.message);
      }
    }

    return store.getSheetAuditLogById(lId, pId);
  }
}

// Singleton helper
const defaultService = new SheetAuditService();

module.exports = {
  SheetAuditService,
  defaultService,
  recordSheetAuditLog: (logData) => defaultService.recordLog(logData),
  getSheetAuditLogs: (projectId, filters) => defaultService.getLogs(projectId, filters),
  getSheetAuditLogById: (projectId, logId) => defaultService.getLogById(projectId, logId)
};
