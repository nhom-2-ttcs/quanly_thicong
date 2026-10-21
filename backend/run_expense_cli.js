const fs = require('fs');
const readline = require('readline');
const mysql = require('mysql2/promise');

async function main() {
    const args = process.argv.slice(2);
    const command = args[0]; // 'add', 'import-csv', 'list'
    const projectId = parseInt(args[1]) || 1;

    const connection = await mysql.createConnection({
        host: 'quanly_thicong_db',
        port: 3306,
        user: 'root',
        password: 'secret',
        database: 'quanly_thicong'
    });

    try {
        if (command === 'add') {
            // T-111: Ghi chi phí đơn lẻ
            const date = args[2] || '2026-10-22';
            const amount = parseFloat(args[3]);
            const type = args[4] || 'khac';
            const workItemId = args[5] && args[5] !== 'null' ? parseInt(args[5]) : null;
            const notes = args[6] || '';

            if (isNaN(amount)) {
                console.log("👉 Cú pháp: node run_expense_cli.js add <projectId> <date> <amount> <type> [workItemId] [notes]");
                process.exit(1);
            }

            let validWorkItemId = null;
            if (workItemId) {
                const [checkRows] = await connection.execute(
                    'SELECT id, name FROM work_items WHERE id = ? AND project_id = ?',
                    [workItemId, projectId]
                );
                if (checkRows.length > 0) {
                    validWorkItemId = workItemId;
                } else {
                    console.log(`⚠️ Hạng mục ID ${workItemId} không tồn tại. Tự động đưa vào mục [Chờ phân bổ]!`);
                }
            }

            await connection.execute(`
                INSERT INTO actual_expenses (project_id, expense_date, amount, expense_type, work_item_id, notes)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [projectId, date, amount, type, validWorkItemId, notes]);

            console.log(`\n✅ [T-111] Đã ghi nhận khoản chi ${amount.toLocaleString('vi-VN')} đ | Trạng thái: ${validWorkItemId ? 'Đã gán hạng mục #' + validWorkItemId : 'CHỜ PHÂN BỔ'}\n`);

        } else if (command === 'import-csv') {
            // T-112: Nhập hàng loạt từ file CSV
            const csvFile = args[2] || '/app/expenses_sample.csv';
            if (!fs.existsSync(csvFile)) {
                console.error(`❌ Không tìm thấy file CSV: ${csvFile}`);
                process.exit(1);
            }

            console.log(`\n📂 [T-112] Đang đọc và nạp file CSV: ${csvFile}...`);
            const fileStream = fs.createReadStream(csvFile);
            const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

            let isHeader = true;
            let successCount = 0;
            let unallocatedCount = 0;

            for await (const line of rl) {
                if (isHeader) { isHeader = false; continue; }
                const cols = line.split(',').map(s => s.trim());
                if (cols.length < 3) continue;

                const [date, amtStr, type, itemStr, notes] = cols;
                const amount = parseFloat(amtStr);
                const reqItemId = itemStr ? parseInt(itemStr) : null;

                let finalItemId = null;
                if (reqItemId) {
                    const [ck] = await connection.execute(
                        'SELECT id FROM work_items WHERE id = ? AND project_id = ?',
                        [reqItemId, projectId]
                    );
                    if (ck.length > 0) finalItemId = reqItemId;
                }

                await connection.execute(`
                    INSERT INTO actual_expenses (project_id, expense_date, amount, expense_type, work_item_id, notes)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, [projectId, date, amount, type, finalItemId, notes || '']);

                if (finalItemId) {
                    successCount++;
                } else {
                    unallocatedCount++;
                }
            }

            console.log(`✅ [T-112 HOÀN TẤT]: Đã nạp thành công từ CSV.`);
            console.log(`   - Gán trực tiếp vào hạng mục: ${successCount} khoản.`);
            console.log(`   - Đưa vào mục [Chờ phân bổ]: ${unallocatedCount} khoản.\n`);
        }

        // Xuất báo cáo nghiệm thu
        console.log(`======================= BÁO CÁO CHI PHÍ THỰC TẾ (S-47) =======================\n`);
        
        const [allocatedRows] = await connection.execute(`
            SELECT e.id, e.expense_date, e.amount, e.expense_type, w.name AS item_name, e.notes
            FROM actual_expenses e
            JOIN work_items w ON e.work_item_id = w.id
            WHERE e.project_id = ?
            ORDER BY e.expense_date ASC, e.id ASC
        `, [projectId]);

        console.log(`📌 CÁC KHOẢN CHI ĐÃ GÁN HẠNG MỤC:`);
        if (allocatedRows.length === 0) {
            console.log(`   (Trống)`);
        } else {
            allocatedRows.forEach(r => {
                console.log(`   [ID ${String(r.id).padEnd(2)}] ${r.expense_date.toISOString().slice(0,10)} | ${String(r.amount.toLocaleString('vi-VN') + ' đ').padEnd(16)} | ${String(r.expense_type).padEnd(14)} | HM: ${String(r.item_name).padEnd(25)} | ${r.notes}`);
            });
        }

        const [unallocatedRows] = await connection.execute(`
            SELECT e.id, e.expense_date, e.amount, e.expense_type, e.notes
            FROM actual_expenses e
            WHERE e.project_id = ? AND e.work_item_id IS NULL
            ORDER BY e.expense_date ASC, e.id ASC
        `, [projectId]);

        console.log(`\n⏳ CÁC KHOẢN CHI CHỜ PHÂN BỔ (Chưa gán hạng mục):`);
        if (unallocatedRows.length === 0) {
            console.log(`   (Không có khoản chi nào chờ phân bổ)`);
        } else {
            unallocatedRows.forEach(r => {
                console.log(`   [ID ${String(r.id).padEnd(2)}] ${r.expense_date.toISOString().slice(0,10)} | ${String(r.amount.toLocaleString('vi-VN') + ' đ').padEnd(16)} | ${String(r.expense_type).padEnd(14)} | ${r.notes}`);
            });
        }

        const [sumRes] = await connection.execute(`
            SELECT 
                COALESCE(SUM(CASE WHEN work_item_id IS NOT NULL THEN amount ELSE 0 END), 0) AS total_allocated,
                COALESCE(SUM(CASE WHEN work_item_id IS NULL THEN amount ELSE 0 END), 0) AS total_unallocated,
                COALESCE(SUM(amount), 0) AS total_all
            FROM actual_expenses WHERE project_id = ?
        `, [projectId]);

        console.log(`\n------------------------------------------------------------------------------`);
        console.log(`📊 TỔNG KHOẢN ĐÃ GÁN : ${parseFloat(sumRes[0].total_allocated).toLocaleString('vi-VN')} đ`);
        console.log(`📊 TỔNG CHỜ PHÂN BỔ  : ${parseFloat(sumRes[0].total_unallocated).toLocaleString('vi-VN')} đ`);
        console.log(`💰 TỔNG CHI PHÍ THỰC : ${parseFloat(sumRes[0].total_all).toLocaleString('vi-VN')} đ`);
        console.log(`==============================================================================\n`);

    } catch (e) {
        console.error("Lỗi:", e.message);
    } finally {
        await connection.end();
    }
}

main();
