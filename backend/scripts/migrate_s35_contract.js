const { pool } = require('../db');

async function up() {
  console.log('=== Đang chạy Migration UP (T-66): Thêm các trường hợp đồng vào work_items ===');
  try {
    // 1. Kiểm tra và thêm cột khoi_luong_hop_dong
    const [cols] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'work_items'
    `);
    const colNames = cols.map(c => c.COLUMN_NAME.toLowerCase());

    if (!colNames.includes('khoi_luong_hop_dong')) {
      await pool.query(`
        ALTER TABLE work_items 
        ADD COLUMN khoi_luong_hop_dong DECIMAL(15, 4) DEFAULT NULL AFTER unit
      `);
      console.log(' -> Đã thêm cột khoi_luong_hop_dong DECIMAL(15, 4)');
    }

    if (!colNames.includes('don_gia_hop_dong')) {
      await pool.query(`
        ALTER TABLE work_items 
        ADD COLUMN don_gia_hop_dong DECIMAL(18, 2) DEFAULT NULL AFTER khoi_luong_hop_dong
      `);
      console.log(' -> Đã thêm cột don_gia_hop_dong DECIMAL(18, 2)');
    }

    console.log('✅ Hoàn thành Migration UP (T-66) thành công!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Lỗi khi migration UP:', err.message);
    process.exit(1);
  }
}

async function down() {
  console.log('=== Đang chạy Migration DOWN (T-66): Hoàn tác các trường hợp đồng ===');
  try {
    const [cols] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'work_items'
    `);
    const colNames = cols.map(c => c.COLUMN_NAME.toLowerCase());

    if (colNames.includes('don_gia_hop_dong')) {
      await pool.query(`ALTER TABLE work_items DROP COLUMN don_gia_hop_dong`);
      console.log(' -> Đã xóa cột don_gia_hop_dong');
    }

    if (colNames.includes('khoi_luong_hop_dong')) {
      await pool.query(`ALTER TABLE work_items DROP COLUMN khoi_luong_hop_dong`);
      console.log(' -> Đã xóa cột khoi_luong_hop_dong');
    }

    console.log('✅ Hoàn thành Migration DOWN thành công!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Lỗi khi migration DOWN:', err.message);
    process.exit(1);
  }
}

const action = process.argv[2] || 'up';
if (action === 'down') {
  down();
} else {
  up();
}
