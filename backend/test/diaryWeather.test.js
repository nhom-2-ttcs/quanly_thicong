const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { DiaryService, getMonday, addDays, isValidDateString } = require('../src/services/diaryService');
const { inMemorySiteDiaries } = require('../src/models/store');

test('=== [T51 / S-22] BỘ KIỂM THỬ FORM THỐNG KÊ & ĐÁNH DẤU NGÀY MƯA ===', async (t) => {
  const mockDb = { pool: null }; // Chạy với in-memory store
  const diaryService = new DiaryService(mockDb);
  const projectId = 1;

  // Xóa sạch dữ liệu in-memory trước khi test
  inMemorySiteDiaries.length = 0;

  await t.test('TC 1: Mở form T51 thành công - File giao diện frontend/diary.html tồn tại và đầy đủ cấu trúc', () => {
    const htmlPath = path.join(__dirname, '../../frontend/diary.html');
    assert.strictEqual(fs.existsSync(htmlPath), true, 'Tệp frontend/diary.html phải tồn tại');

    const content = fs.readFileSync(htmlPath, 'utf8');
    assert.ok(content.includes('id="diary-form"'), 'Phải có form nhập nhật ký');
    assert.ok(content.includes('id="input-diary-date"'), 'Phải có ô chọn ngày nhật ký');
    assert.ok(content.includes('id="opt-rain-all-day"'), 'Phải có tùy chọn Mưa cả ngày');
    assert.ok(content.includes('id="input-is-rain-day"'), 'Phải có checkbox đánh dấu ngày mưa');
    assert.ok(content.includes('id="input-manpower"'), 'Phải có ô nhập nhân lực');
    assert.ok(content.includes('id="input-equipment-status"'), 'Phải có ô nhập thiết bị');
    assert.ok(content.includes('id="workdays-grid"'), 'Phải có bảng lưới tuần làm việc Thứ 2 - Thứ 6');
  });

  await t.test('TC 2: Nhập dữ liệu ngày mưa hợp lệ và lưu thành công', async () => {
    const testDate = '2026-10-12';
    const payload = {
      diary_date: testDate,
      weather_condition: 'rain_all_day',
      is_rain_day: true,
      weather_notes: 'Mưa lớn từ 08:00 đến 17:00',
      manpower_count: 20,
      equipment_status: '2 máy đào tạm dừng, 1 máy bơm hoạt động',
      work_notes: 'Công nhân làm việc gia công thép trong nhà'
    };

    const saved = await diaryService.saveDiary(projectId, payload, 1);
    assert.ok(saved, 'Phải lưu thành công');
    assert.strictEqual(saved.project_id, projectId);
    assert.strictEqual(saved.diary_date, testDate);
    assert.strictEqual(saved.weather_condition, 'rain_all_day');
    assert.strictEqual(saved.is_rain_day, 1, 'Ngày mưa phải được đánh dấu là 1');
    assert.strictEqual(saved.manpower_count, 20);
    assert.strictEqual(saved.equipment_status, '2 máy đào tạm dừng, 1 máy bơm hoạt động');
  });

  await t.test('TC 3: [AC Chính S-22] Nhập mưa cả ngày từ Thứ Hai đến Thứ Sáu, dữ liệu lưu đúng', async () => {
    // Giả sử tuần làm việc từ Thứ Hai 2026-10-19 đến Thứ Sáu 2026-10-23
    const workdays = [
      '2026-10-19', // Thứ Hai
      '2026-10-20', // Thứ Ba
      '2026-10-21', // Thứ Tư
      '2026-10-22', // Thứ Năm
      '2026-10-23'  // Thứ Sáu
    ];

    for (let i = 0; i < workdays.length; i++) {
      const date = workdays[i];
      const res = await diaryService.saveDiary(projectId, {
        diary_date: date,
        weather_condition: 'rain_all_day',
        is_rain_day: true,
        weather_notes: `Mưa to cả ngày liên tục ngày thứ ${i + 2}`,
        manpower_count: 15 + i,
        equipment_status: `Thiết bị công trường ngày ${i + 1} tạm dừng do mưa lầy`,
        work_notes: `Tạm hoãn đổ bê tông hố móng trụ T${i + 1}`
      }, 1);

      assert.strictEqual(res.diary_date, date);
      assert.strictEqual(res.is_rain_day, 1);
    }

    // Xác nhận đã lưu đủ 5 bản ghi ngày mưa trong store
    const savedDiaries = await diaryService.getDiaries(projectId, {
      start_date: '2026-10-19',
      end_date: '2026-10-23'
    });
    assert.strictEqual(savedDiaries.length, 5, 'Phải có đủ 5 ngày nhật ký');
    savedDiaries.forEach((d, idx) => {
      assert.strictEqual(d.diary_date, workdays[idx], 'Ngày lưu phải khớp chính xác');
      assert.strictEqual(d.weather_condition, 'rain_all_day');
      assert.strictEqual(d.is_rain_day, 1, 'Mọi ngày từ T2 đến T6 đều phải đánh dấu ngày mưa');
    });
  });

  await t.test('TC 4: Tải lại và xem đối chiếu tuần (Weekly Comparison) xác nhận dữ liệu chính xác', async () => {
    // Truy vấn dữ liệu đối chiếu tuần cho tuần 2026-10-19
    const comparison = await diaryService.getWeeklyComparison(projectId, '2026-10-21');
    assert.strictEqual(comparison.success, true);
    assert.strictEqual(comparison.weekRange.startDate, '2026-10-19', 'Đầu tuần phải là Thứ Hai');
    assert.strictEqual(comparison.weekRange.fridayDate, '2026-10-23', 'Cuối tuần làm việc phải là Thứ Sáu');

    // Thống kê ngày mưa
    assert.strictEqual(comparison.summary.workdayRainCount, 5, 'Phải đếm đủ 5 ngày mưa trong tuần làm việc');
    assert.strictEqual(comparison.summary.rainRatio, 100, 'Tỷ lệ mưa tuần làm việc phải là 100%');
    assert.strictEqual(comparison.summary.statusAlert, 'high_risk', 'Phải cảnh báo nguy cơ cao (high_risk)');
    assert.ok(comparison.summary.impactDescription.includes('MƯA CẢ NGÀY'), 'Mô tả tác động phải nêu rõ mưa cả ngày');

    // Kiểm tra từng ngày trong danh sách days
    const workdays = comparison.days.filter(d => d.isWorkday);
    assert.strictEqual(workdays.length, 5);
    workdays.forEach(d => {
      assert.strictEqual(d.hasDiary, true, 'Ngày làm việc phải có nhật ký');
      assert.strictEqual(d.isRainDay, true, 'isRainDay phải là true');
      assert.strictEqual(d.weatherCondition, 'rain_all_day');
      assert.ok(d.manpowerCount >= 15);
    });
  });

  await t.test('TC 5: Kiểm tra dữ liệu gắn đúng ngày, đúng dự án và không nhầm lẫn giữa các ngày', async () => {
    const mondayDiary = await diaryService.getDiaryByDate(projectId, '2026-10-19');
    const fridayDiary = await diaryService.getDiaryByDate(projectId, '2026-10-23');

    assert.strictEqual(mondayDiary.diary_date, '2026-10-19');
    assert.strictEqual(fridayDiary.diary_date, '2026-10-23');
    assert.strictEqual(mondayDiary.manpower_count, 15);
    assert.strictEqual(fridayDiary.manpower_count, 19);
    assert.notStrictEqual(mondayDiary.weather_notes, fridayDiary.weather_notes);
  });

  await t.test('TC 6: Validation khi bỏ trống hoặc nhập dữ liệu không hợp lệ', async () => {
    // 1. Ngày trống
    await assert.rejects(
      async () => {
        await diaryService.saveDiary(projectId, { diary_date: '', weather_condition: 'sunny' });
      },
      (err) => err.status === 400 && err.message.includes('Ngày nhật ký không hợp lệ')
    );

    // 2. Ngày sai định dạng
    await assert.rejects(
      async () => {
        await diaryService.saveDiary(projectId, { diary_date: '19-10-2026', weather_condition: 'sunny' });
      },
      (err) => err.status === 400
    );

    // 3. Thời tiết không nằm trong danh mục cho phép
    await assert.rejects(
      async () => {
        await diaryService.saveDiary(projectId, { diary_date: '2026-10-25', weather_condition: 'bão tuyết siêu cấp' });
      },
      (err) => err.status === 400 && err.message.includes('Điều kiện thời tiết không hợp lệ')
    );

    // 4. Số nhân lực âm
    await assert.rejects(
      async () => {
        await diaryService.saveDiary(projectId, { diary_date: '2026-10-25', manpower_count: -10 });
      },
      (err) => err.status === 400 && err.message.includes('Số lượng nhân lực')
    );
  });

  await t.test('TC 7: Chống tạo bản ghi trùng khi người dùng bấm lưu nhiều lần (Idempotent Upsert)', async () => {
    const targetDate = '2026-10-26';
    const countBefore = inMemorySiteDiaries.filter(d => d.diary_date === targetDate).length;
    assert.strictEqual(countBefore, 0);

    // Bấm lưu lần 1
    await diaryService.saveDiary(projectId, {
      diary_date: targetDate,
      weather_condition: 'sunny',
      manpower_count: 10,
      equipment_status: '1 máy đào'
    });

    // Bấm lưu lần 2 (cập nhật nhân lực lên 12)
    await diaryService.saveDiary(projectId, {
      diary_date: targetDate,
      weather_condition: 'rain_all_day',
      is_rain_day: true,
      manpower_count: 12,
      equipment_status: '1 máy đào, 1 máy bơm'
    });

    // Bấm lưu lần 3
    await diaryService.saveDiary(projectId, {
      diary_date: targetDate,
      weather_condition: 'rain_all_day',
      is_rain_day: true,
      manpower_count: 12,
      equipment_status: '1 máy đào, 1 máy bơm'
    });

    const targetEntries = inMemorySiteDiaries.filter(d => d.diary_date === targetDate && d.project_id === projectId);
    assert.strictEqual(targetEntries.length, 1, 'Chỉ được có DUY NHẤT 1 bản ghi cho mỗi ngày của dự án');
    assert.strictEqual(targetEntries[0].manpower_count, 12);
    assert.strictEqual(targetEntries[0].is_rain_day, 1);
  });

  await t.test('TC 8: Tương thích khóa sổ (S-24): Chặn sửa nhật ký khi ngày đã bị khóa sổ', async () => {
    const lockedDate = '2026-10-27';
    // Tạo bản ghi ban đầu
    const entry = await diaryService.saveDiary(projectId, {
      diary_date: lockedDate,
      weather_condition: 'sunny',
      manpower_count: 20
    });

    // Giả lập khóa sổ ngày này (S-24)
    entry.is_locked = 1;

    // Thử cập nhật ngày đã khóa sổ
    await assert.rejects(
      async () => {
        await diaryService.saveDiary(projectId, {
          diary_date: lockedDate,
          weather_condition: 'rain_all_day',
          manpower_count: 5
        });
      },
      (err) => err.status === 423 && err.message.includes('khóa sổ')
    );
  });

  await t.test('TC 9: Kiểm tra tiện ích tính ngày tuần (getMonday, addDays, isValidDateString)', () => {
    assert.strictEqual(isValidDateString('2026-10-12'), true);
    assert.strictEqual(isValidDateString('2026-02-31'), false); // Ngày không có thực
    assert.strictEqual(isValidDateString('invalid'), false);

    // Thứ Hai 2026-10-12 -> getMonday phải là 2026-10-12
    assert.strictEqual(getMonday('2026-10-12'), '2026-10-12');
    // Thứ Tư 2026-10-14 -> getMonday phải là 2026-10-12
    assert.strictEqual(getMonday('2026-10-14'), '2026-10-12');
    // Chủ Nhật 2026-10-18 -> getMonday phải là 2026-10-12
    assert.strictEqual(getMonday('2026-10-18'), '2026-10-12');

    // Ngày lịch phải cho cùng kết quả ở máy chủ có múi giờ phía tây UTC.
    const timezoneCheck = spawnSync(process.execPath, ['-e',
      `const { getMonday } = require(${JSON.stringify(path.join(__dirname, '../src/services/diaryService'))}); process.stdout.write(getMonday('2026-10-14'));`
    ], { encoding: 'utf8', env: { ...process.env, TZ: 'America/Los_Angeles' } });
    assert.strictEqual(timezoneCheck.status, 0, timezoneCheck.stderr);
    assert.strictEqual(timezoneCheck.stdout, '2026-10-12');

    assert.strictEqual(addDays('2026-10-12', 4), '2026-10-16'); // T2 + 4 = T6
  });

  await t.test('TC 10: NFR Responsive trên điện thoại - Kiểm tra CSS trong diary.html', () => {
    const htmlPath = path.join(__dirname, '../../frontend/diary.html');
    const content = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(content.includes('<meta name="viewport" content="width=device-width, initial-scale=1.0">'), 'Phải có viewport chuẩn');
    assert.ok(content.includes('@media (max-width: 768px)'), 'Phải có media query cho mobile');
    assert.ok(content.includes('overflow-x: auto'), 'Phải hỗ trợ cuộn ngang tránh tràn màn hình');
    assert.ok(content.includes('box-sizing: border-box'), 'Phải áp dụng border-box cho layout');
  });

  await t.test('TC 11: [S-22 NFR] Danh sách thiết bị và loại thời tiết được nạp từ cấu hình tập trung, không hard-code rải rác', async () => {
    const configRes = diaryService.getDiaryConfig();
    assert.strictEqual(configRes.success, true);
    assert.ok(Array.isArray(configRes.data.weather_types), 'Phải có danh mục weather_types trong cấu hình');
    assert.ok(Array.isArray(configRes.data.equipment_list), 'Phải có danh mục equipment_list trong cấu hình');
    assert.ok(configRes.data.weather_types.length >= 4, 'Phải có tối thiểu 4 loại thời tiết');
    assert.ok(configRes.data.equipment_list.length >= 5, 'Phải có tối thiểu 5 loại thiết bị');

    // Cố ý gửi loại thời tiết không nằm trong danh mục cấu hình -> Bị từ chối
    await assert.rejects(
      async () => {
        await diaryService.saveDiary(projectId, {
          diary_date: '2026-10-22',
          weather_condition: 'alien_storm_snow',
          manpower_count: 5
        }, 1);
      },
      (err) => err.status === 400 && err.message.includes('Điều kiện thời tiết không hợp lệ')
    );
  });
});

