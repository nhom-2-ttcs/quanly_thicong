const express = require('express');

module.exports = (db) => {
  const router = express.Router();
  const pool = db ? (db.pool || db) : null;

  // S-35 / T-67: Cập nhật hợp đồng cho hạng mục lá
  router.put('/work-items/:id/contract', async (req, res) => {
    const itemId = parseInt(req.params.id, 10);
    const { unit, don_vi, khoi_luong, khoi_luong_hop_dong, don_gia, don_gia_hop_dong, project_id } = req.body;

    const finalUnit = unit || don_vi;
    const rawQty = (khoi_luong !== undefined) ? khoi_luong : khoi_luong_hop_dong;
    const rawPrice = (don_gia !== undefined) ? don_gia : don_gia_hop_dong;

    if (!itemId) {
      return res.status(400).json({ success: false, message: 'ID hạng mục không hợp lệ.' });
    }

    try {
      if (!pool || !pool.query) {
        return res.status(500).json({ success: false, message: 'Database chưa sẵn sàng.' });
      }

      // 1. Kiểm tra tồn tại hạng mục
      let checkSql = 'SELECT * FROM work_items WHERE id = ?';
      let checkParams = [itemId];
      if (project_id) {
        checkSql += ' AND project_id = ?';
        checkParams.push(project_id);
      }
      const [items] = await pool.query(checkSql, checkParams);
      if (!items || items.length === 0) {
        return res.status(404).json({ success: false, message: 'Hạng mục không tồn tại hoặc không thuộc dự án.' });
      }
      const currentItem = items[0];

      // 2. AC: Chặn khai báo trên hạng mục cha (Leaf Check)
      const [children] = await pool.query('SELECT COUNT(1) AS child_count FROM work_items WHERE parent_id = ?', [itemId]);
      if (children[0].child_count > 0) {
        return res.status(400).json({
          success: false,
          message: 'Chỉ được phép khai báo khối lượng và đơn giá hợp đồng cho hạng mục lá.'
        });
      }

      // 3. NFR: Kiểm tra số không âm và chính xác
      if (rawQty === undefined || rawQty === null || rawQty === '' || isNaN(rawQty) || Number(rawQty) < 0) {
        return res.status(400).json({ success: false, message: 'Khối lượng phải là số không âm.' });
      }
      if (rawPrice === undefined || rawPrice === null || rawPrice === '' || isNaN(rawPrice) || Number(rawPrice) < 0) {
        return res.status(400).json({ success: false, message: 'Đơn giá phải là số không âm.' });
      }

      const validUnit = finalUnit ? String(finalUnit).trim() : (currentItem.unit || 'm');
      const formattedQty = parseFloat(rawQty).toFixed(4);
      const formattedPrice = parseFloat(rawPrice).toFixed(2);

      await pool.query(
        'UPDATE work_items SET unit = ?, khoi_luong_hop_dong = ?, don_gia_hop_dong = ? WHERE id = ?',
        [validUnit, formattedQty, formattedPrice, itemId]
      );

      const [updatedRows] = await pool.query('SELECT * FROM work_items WHERE id = ?', [itemId]);
      const updatedItem = updatedRows[0];

      // S-39 / SCRUM-168: Ghi nhật ký thao tác cập nhật khối lượng hợp đồng (Append-Only)
      try {
        let recordSheetAuditLog;
        try {
          ({ recordSheetAuditLog } = require('./src/services/sheetAuditService'));
        } catch (_) {}

        if (recordSheetAuditLog) {
          const pId = currentItem.project_id || project_id;
          const uId = req.user?.id || req.user?.userId || null;
          await recordSheetAuditLog({
            projectId: pId,
            entityType: 'contract_volume',
            entityId: String(itemId),
            action: 'UPDATE',
            performedBy: uId,
            userName: req.user?.name || req.user?.username || null,
            roleName: req.user?.role_name || req.user?.role || null,
            oldValues: {
              unit: currentItem.unit,
              khoi_luong_hop_dong: currentItem.khoi_luong_hop_dong,
              don_gia_hop_dong: currentItem.don_gia_hop_dong
            },
            newValues: {
              unit: validUnit,
              khoi_luong_hop_dong: formattedQty,
              don_gia_hop_dong: formattedPrice
            },
            changeSummary: `Cập nhật khối lượng & đơn giá hợp đồng hạng mục "${currentItem.name || currentItem.code || itemId}"`,
            reason: req.body?.reason || 'Cập nhật khối lượng hợp đồng',
            ipAddress: req.ip || req.connection?.remoteAddress || null
          });
        }
      } catch (auditErr) {
        console.warn('[s35_routes] Audit log recording failed:', auditErr.message);
      }

      return res.json({
        success: true,
        message: 'Cập nhật hợp đồng thành công.',
        data: updatedItem
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  return router;
};
