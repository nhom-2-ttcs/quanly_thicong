const mysql = require('mysql2/promise');

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 3) {
        console.log("👉 Cú pháp: node run_budget_cli.js <project_id> <work_item_id> <budget_amount>");
        process.exit(1);
    }

    const projectId = parseInt(args[0]);
    const workItemId = parseInt(args[1]);
    const amount = parseFloat(args[2]);

    const connection = await mysql.createConnection({
        host: 'quanly_thicong_db',
        port: 3306,
        user: 'root',
        password: 'secret',
        database: 'quanly_thicong'
    });

    try {
        // 1. Kiểm tra tồn tại của work_item
        const [itemRows] = await connection.execute(
            'SELECT id, name, parent_id FROM work_items WHERE id = ? AND project_id = ?',
            [workItemId, projectId]
        );
        if (itemRows.length === 0) {
            console.error(`❌ Không tìm thấy hạng mục ID ${workItemId} trong dự án ${projectId}.`);
            process.exit(1);
        }

        // 2. Ràng buộc T-109: Chỉ cho nhập ở node lá, cấm node cha
        const [childRows] = await connection.execute(
            'SELECT COUNT(*) as count FROM work_items WHERE parent_id = ?',
            [workItemId]
        );
        if (childRows[0].count > 0) {
            console.error(`\n❌ [T-109 VIOLATION]: Hạng mục "${itemRows[0].name}" (ID ${workItemId}) là HẠNG MỤC CHA (${childRows[0].count} mục con trực thuộc).`);
            console.error(`👉 Quy tắc AC: Không được nhập dự toán trực tiếp cho hạng mục cha. Tổng sẽ tự cộng dồn từ các lá bên dưới!\n`);
            process.exit(1);
        }

        // 3. Lấy phiên bản dự toán hiện hành
        const [verRows] = await connection.execute(
            'SELECT * FROM project_budget_versions WHERE project_id = ? AND is_current = TRUE LIMIT 1',
            [projectId]
        );
        let currentVersion = verRows[0];

        if (!currentVersion) {
            const [initVer] = await connection.execute(
                'INSERT INTO project_budget_versions (project_id, version_number, is_current) VALUES (?, 1, TRUE)',
                [projectId]
            );
            currentVersion = { id: initVer.insertId, version_number: 1 };
        }

        // 4. Ràng buộc T-110: Kiểm tra phát sinh thực chi (nhật ký đã chốt/khóa is_locked = 1)
        let hasActualCost = false;
        try {
            const [diaryRows] = await connection.execute(
                'SELECT COUNT(*) as count FROM site_diaries WHERE project_id = ? AND is_locked = 1',
                [projectId]
            );
            hasActualCost = parseInt(diaryRows[0].count) > 0;
        } catch (e) {
            hasActualCost = false;
        }

        let targetVersionId = currentVersion.id;

        if (hasActualCost) {
            console.log(`\n⚡ [T-110 DETECTED]: Dự án đã phát sinh thực chi (nhật ký đã duyệt/khóa).`);
            console.log(`🔒 Chốt lưu trữ v${currentVersion.version_number}. Tạo phiên bản mới...`);

            await connection.execute(
                'UPDATE project_budget_versions SET is_current = FALSE WHERE id = ?',
                [currentVersion.id]
            );

            const nextVerNum = currentVersion.version_number + 1;
            const [newVerRes] = await connection.execute(
                'INSERT INTO project_budget_versions (project_id, version_number, is_current) VALUES (?, ?, TRUE)',
                [projectId, nextVerNum]
            );
            targetVersionId = newVerRes.insertId;

            // Clone dữ liệu phiên bản cũ sang phiên bản mới để giữ nguyên lịch sử
            await connection.execute(`
                INSERT INTO budget_items (version_id, work_item_id, budget_amount)
                SELECT ?, work_item_id, budget_amount FROM budget_items WHERE version_id = ?
            `, [targetVersionId, currentVersion.id]);

            console.log(`✅ Đã sinh thành công phiên bản mới: v${nextVerNum}`);
        } else {
            console.log(`\nℹ Chưa có thực chi: Cập nhật trực tiếp trên phiên bản hiện hành v${currentVersion.version_number}.`);
        }

        // 5. Lưu dự toán cho node lá
        await connection.execute(`
            INSERT INTO budget_items (version_id, work_item_id, budget_amount)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE budget_amount = VALUES(budget_amount)
        `, [targetVersionId, workItemId, amount]);

        console.log(`✅ Đã lưu dự toán cho hạng mục "${itemRows[0].name}": ${amount.toLocaleString('vi-VN')} đ`);

        // 6. Tính toán Roll-up cây WBS và hiển thị (T-109)
        console.log(`\n================ BẢNG DỰ TOÁN HẠNG MỤC (ROLL-UP CÂY) ================\n`);
        const [itemsList] = await connection.execute(
            'SELECT id, name, parent_id FROM work_items WHERE project_id = ? ORDER BY id ASC',
            [projectId]
        );
        const [budgetList] = await connection.execute(
            'SELECT work_item_id, budget_amount FROM budget_items WHERE version_id = ?',
            [targetVersionId]
        );

        const budgetMap = {};
        budgetList.forEach(r => { budgetMap[r.work_item_id] = parseFloat(r.budget_amount); });

        const nodeMap = new Map();
        itemsList.forEach(item => {
            nodeMap.set(item.id, { ...item, children: [], total: 0 });
        });

        const roots = [];
        nodeMap.forEach(node => {
            if (node.parent_id && nodeMap.has(node.parent_id)) {
                nodeMap.get(node.parent_id).children.push(node);
            } else {
                roots.push(node);
            }
        });

        function calc(node) {
            if (!node.children || node.children.length === 0) {
                node.total = budgetMap[node.id] || 0;
                return node.total;
            }
            let s = 0;
            for (const c of node.children) {
                s += calc(c);
            }
            node.total = s;
            return s;
        }

        roots.forEach(r => calc(r));

        function printTree(nodes, level = 0) {
            nodes.forEach(n => {
                const indent = '   '.repeat(level);
                const prefix = n.children.length === 0 ? '🍃 [Lá]' : '📁 [Cha]';
                console.log(`${indent}${prefix} ID: ${String(n.id).padEnd(3)} | ${String(n.name).padEnd(30)} : ${n.total.toLocaleString('vi-VN')} đ`);
                if (n.children.length > 0) printTree(n.children, level + 1);
            });
        }

        printTree(roots);
        console.log(`\n======================================================================\n`);

    } catch (e) {
        console.error("Lỗi:", e.message);
    } finally {
        await connection.end();
    }
}

main();
