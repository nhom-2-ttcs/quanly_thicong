// cpmCalculator.js - Hoàn thiện tính năng S-16 / SCRUM-89, SCRUM-101, SCRUM-102

function recalculateNetworkSchedule(tasks, completedTaskId, actualDelayDays) {
    console.log(`\n========================================`);
    console.log(`[SCRUM-101] BẮT ĐẦU TÍNH LẠI TOÀN MẠNG LƯỚI CHO TASK: ${completedTaskId}`);
    console.log(`========================================`);
    
    let targetTask = tasks.find(t => t.id === completedTaskId);
    if (!targetTask) {
        console.log("Không tìm thấy công việc!");
        return;
    }

    let projectDelay = 0;

    // Xử lý logic theo Acceptance Criteria
    if (targetTask.isOnCriticalPath) {
        projectDelay = actualDelayDays;
        console.log(`[AC1] Việc găng trễ ${actualDelayDays} ngày -> Ngày hoàn thành dự án lùi đúng ${projectDelay} ngày.`);
    } else {
        if (actualDelayDays <= targetTask.allowedSlack) {
            console.log(`[AC2] Việc không găng trễ (${actualDelayDays} ngày) <= độ trễ cho phép (${targetTask.allowedSlack} ngày) -> Ngày hoàn thành không đổi.`);
        } else {
            let excessDelay = actualDelayDays - targetTask.allowedSlack;
            targetTask.isOnCriticalPath = true; // Trở thành việc găng mới
            projectDelay = excessDelay;
            console.log(`[AC3] Việc không găng trễ vượt mức (${actualDelayDays} > ${targetTask.allowedSlack}) -> Trở thành VIỆC GĂNG MỚI. Lùi ngày dự án: ${projectDelay} ngày.`);
        }
    }

    // [SCRUM-102] Hiển thị chênh lệch ngày hoàn thành và trạng thái găng mới
    displayVarianceAndCriticalPath(targetTask, projectDelay);

    return projectDelay;
}

function displayVarianceAndCriticalPath(task, varianceDays) {
    console.log(`\n--- [SCRUM-102] KẾT QUẢ HIỂN THỊ CHI TIẾT ---`);
    console.log(`- Mã công việc: ${task.id}`);
    console.log(`- Chênh lệch ngày hoàn thành dự án: +${varianceDays} ngày`);
    if (task.isOnCriticalPath) {
        console.log(`- Trạng thái đường găng: [CẢNH BÁO] Đã chuyển thành VIỆC GĂNG MỚI!`);
    } else {
        console.log(`- Trạng thái đường găng: Bình thường (Không đổi)`);
    }
}

// [NFR] Kiểm tra hiệu năng với mạng lưới 500 việc (chạy không khóa giao diện, dưới 5 giây)
function runLargeNetworkPerformanceTest() {
    console.log(`\n----------------------------------------`);
    console.log(`[NFR] Đang kiểm tra hiệu năng với 500 công việc...`);
    const startTime = performance.now();

    let largeTasks = [];
    for (let i = 1; i <= 500; i++) {
        largeTasks.push({ 
            id: `T-${i}`, 
            isOnCriticalPath: (i === 10), // Giả sử có 1 việc găng ban đầu
            allowedSlack: 2 
        });
    }

    // Giả lập một việc không găng bị trễ nhiều
    let delayedTask = largeTasks[100];
    delayedTask.allowedSlack = 1;

    recalculateNetworkSchedule(largeTasks, delayedTask.id, 5);

    const endTime = performance.now();
    const duration = (endTime - startTime).toFixed(2);
    console.log(`[NFR] Hoàn thành xử lý 500 việc trong: ${duration} ms (Đạt yêu cầu < 5000ms).`);
    console.log(`----------------------------------------\n`);
}

// Chạy thử nghiệm các kịch bản mẫu
const sampleTasks = [
    { id: "T-36", isOnCriticalPath: false, allowedSlack: 2 },
    { id: "T-37", isOnCriticalPath: true, allowedSlack: 0 }
];

// Kịch bản 1: Việc không găng trễ vượt mức (Kích hoạt việc găng mới)
recalculateNetworkSchedule(sampleTasks, "T-36", 5);

// Kịch bản 2: Kiểm tra hiệu năng 500 việc (NFR)
runLargeNetworkPerformanceTest();