const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { DiaryService, isValidDateString } = require('../src/services/diaryService');
const {
  inMemorySiteDiaries,
  inMemorySiteDiaryPhotos,
  inMemorySiteDiaryItems,
  getSiteDiaryPhotos,
  getSiteDiaryItems
} = require('../src/models/store');
const {
  validateUploadedFile,
  generateSafeFileName,
  parseMultipartBuffer
} = require('../src/middlewares/multipartUpload');
const diaryRoutesFactory = require('../src/routes/diaryRoutes');

test('=== [T52 / S-23] BỘ KIỂM THỬ GỬI NHẬT KÝ THI CÔNG & ẢNH ĐÍNH KÈM ===', async (t) => {
  const mockDb = { pool: null }; // In-memory store
  const diaryService = new DiaryService(mockDb);
  const projectId = 1;

  // Dọn dẹp store trước khi chạy test
  inMemorySiteDiaries.length = 0;
  inMemorySiteDiaryPhotos.length = 0;
  inMemorySiteDiaryItems.length = 0;

  // ========================================================
  // NHÓM A — FRONTEND TEST SUITE
  // ========================================================
  await t.test('--- NHÓM A: KIỂM THỬ FRONTEND & FORM NHẬT KÝ T52 ---', async (tA) => {
    const htmlPath = path.join(__dirname, '../../frontend/diary.html');
    const content = fs.readFileSync(htmlPath, 'utf8');

    await tA.test('A1: Mở form gửi nhật ký thành công - Có đầy đủ các trường và vùng tải ảnh T52', () => {
      assert.strictEqual(fs.existsSync(htmlPath), true, 'Tệp frontend/diary.html phải tồn tại');
      assert.ok(content.includes('id="diary-form"'), 'Phải có form nhật ký');
      assert.ok(content.includes('id="input-diary-date"'), 'Phải có ô nhập ngày nhật ký');
      assert.ok(content.includes('id="select-work-item"'), 'Phải có ô chọn công việc liên kết (T52)');
      assert.ok(content.includes('id="photo-dropzone"'), 'Phải có vùng kéo thả ảnh dropzone');
      assert.ok(content.includes('id="input-diary-photos"'), 'Phải có input file đính kèm ảnh');
      assert.ok(content.includes('id="photo-preview-container"'), 'Phải có khu vực xem trước ảnh chờ tải');
      assert.ok(content.includes('id="existing-photos-container"'), 'Phải có khu vực hiển thị ảnh đã lưu');
      assert.ok(content.includes('id="photo-lightbox"'), 'Phải có modal xem phóng to ảnh');
    });

    await tA.test('A2: Không gửi khi thiếu trường bắt buộc diary_date', () => {
      // Kiểm tra trong code giao diện có chặn khi diary_date trống
      assert.ok(content.includes('if (!diaryDate)'), 'Giao diện phải kiểm tra diaryDate bắt buộc');
      assert.ok(content.includes('Vui lòng chọn ngày nhật ký'), 'Phải có thông báo tiếng Việt khi thiếu ngày');
    });

    await tA.test('A3: Gửi đúng dữ liệu và ID công việc work_item_id / items', () => {
      assert.ok(content.includes("formData.append('work_item_id'"), 'Phải gửi field work_item_id');
      assert.ok(content.includes("formData.append('items'"), 'Phải gửi field items dạng JSON');
    });

    await tA.test('A4: Gửi ảnh qua FormData đúng field photos và không tự đặt Content-Type thủ công', () => {
      assert.ok(content.includes("formData.append('photos'"), 'Phải gửi file qua field photos');
      // Đảm bảo không ghi đè Content-Type: multipart/form-data trong headers của fetch
      assert.ok(
        content.includes('KHÔNG đặt Content-Type để trình duyệt tự tạo boundary multipart') ||
        content.includes('KHÔNG đặt Content-Type'),
        'Phải tuân thủ quy tắc không set Content-Type thủ công cho FormData'
      );
    });

    await tA.test('A5: Chọn file không hợp lệ thì hiển thị lỗi tiếng Việt và không thêm vào danh sách gửi', () => {
      assert.ok(content.includes('ALLOWED_MIME_TYPES'), 'Phải có danh sách MIME hợp lệ');
      assert.ok(content.includes('MAX_FILE_SIZE'), 'Phải có giới hạn MAX_FILE_SIZE = 5MB');
      assert.ok(content.includes('không hợp lệ. Chỉ chấp nhận các định dạng ảnh'), 'Phải có thông báo lỗi MIME type tiếng Việt');
      assert.ok(content.includes('vượt quá giới hạn 5MB cho phép'), 'Phải có thông báo lỗi dung lượng tiếng Việt');
    });

    await tA.test('A6: Khi API thành công, giao diện hiển thị toast tiếng Việt và tải lại dữ liệu tuần & ảnh', () => {
      assert.ok(content.includes('showSuccessToast'), 'Phải hiển thị toast thành công tiếng Việt');
      assert.ok(content.includes('clearSelectedPhotos'), 'Phải dọn danh sách ảnh chờ sau khi thành công');
      assert.ok(content.includes('loadWeekData'), 'Phải đồng bộ lại dữ liệu tuần');
    });

    await tA.test('A7: Khi API trả lỗi validation hoặc lỗi server, giao diện hiển thị thông báo và giữ nguyên dữ liệu', () => {
      assert.ok(content.includes('showErrorToast'), 'Phải hiển thị toast lỗi');
      assert.ok(content.includes('Dữ liệu trên form và ảnh được giữ nguyên') || content.includes('Dữ liệu không bị xóa'), 'Không được xóa dữ liệu khi có lỗi');
    });

    await tA.test('A8: Khi mất mạng, không báo gửi thành công giả', () => {
      assert.ok(content.includes('catch (err)'), 'Phải có khối catch bắt lỗi mạng');
      assert.ok(content.includes('Lỗi kết nối đến máy chủ') || content.includes('Lỗi kết nối'), 'Báo lỗi kết nối máy chủ rõ ràng');
    });

    await tA.test('A9: Bấm gửi liên tiếp không tạo nhiều request ngoài dự kiến (chống double-submit)', () => {
      assert.ok(content.includes('if (btn.disabled) return'), 'Phải kiểm tra và ngắt nếu nút đang disabled');
      assert.ok(content.includes('btn.disabled = true'), 'Phải khóa nút gửi ngay khi bắt đầu submit');
      assert.ok(content.includes('finally {'), 'Phải mở lại nút trong khối finally');
    });
  });

  // ========================================================
  // NHÓM B — BACKEND / API TEST SUITE
  // ========================================================
  await t.test('--- NHÓM B: KIỂM THỬ BACKEND API CONTRACT & UPLOAD AN TOÀN ---', async (tB) => {
    await tB.test('B1: Nhận đúng payload nhật ký và lưu chi tiết items công việc', async () => {
      const testDate = '2026-10-14';
      const payload = {
        diary_date: testDate,
        weather_condition: 'sunny',
        is_rain_day: false,
        weather_notes: 'Trời nắng ráo, nhiệt độ 30 độ C',
        manpower_count: 25,
        equipment_status: '1 cần cẩu, 2 máy xúc vận hành bình thường',
        work_notes: 'Thi công ép cọc đại trà phân đoạn 1',
        work_item_id: 101,
        items: [
          {
            work_item_id: 101,
            work_content: 'Ép cọc bê tông cốt thép D400',
            quantity_done: 12,
            unit: 'tim cọc'
          }
        ]
      };

      const saved = await diaryService.saveDiary(projectId, payload, 1);
      assert.ok(saved, 'Phải lưu thành công');
      assert.strictEqual(saved.diary_date, testDate);
      assert.strictEqual(saved.manpower_count, 25);

      // Kiểm tra items được liên kết đúng với nhật ký
      const items = getSiteDiaryItems(saved.id);
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].work_item_id, 101);
      assert.strictEqual(items[0].quantity_done, 12);
      assert.strictEqual(items[0].unit, 'tim cọc');
    });

    await tB.test('B2: Nhận đúng file đính kèm và liên kết với nhật ký (lưu vào site_diary_photos)', async () => {
      const testDate = '2026-10-15';
      const mockFiles = [
        {
          filename: 'diary_1_20261015_abc123.jpg',
          path: '/uploads/diaries/diary_1_20261015_abc123.jpg',
          size: 1024 * 500, // 500 KB
          mimetype: 'image/jpeg',
          caption: 'Thi công cốt thép móng M1'
        },
        {
          filename: 'diary_1_20261015_def456.png',
          path: '/uploads/diaries/diary_1_20261015_def456.png',
          size: 1024 * 800, // 800 KB
          mimetype: 'image/png',
          caption: 'Kiểm tra độ sụt bê tông'
        }
      ];

      const payload = {
        diary_date: testDate,
        weather_condition: 'cloudy',
        manpower_count: 18,
        equipment_status: 'Máy trộn bê tông hoạt động tốt',
        work_notes: 'Đổ bê tông sàn tầng 1'
      };

      const saved = await diaryService.saveDiary(projectId, payload, 1, mockFiles);
      assert.ok(saved);
      assert.strictEqual(saved.diary_date, testDate);

      // Kiểm tra ảnh được gắn vào nhật ký
      const photos = getSiteDiaryPhotos(saved.id);
      assert.strictEqual(photos.length, 2, 'Phải lưu đủ 2 ảnh đính kèm');
      assert.strictEqual(photos[0].file_name, 'diary_1_20261015_abc123.jpg');
      assert.strictEqual(photos[0].caption, 'Thi công cốt thép móng M1');
      assert.strictEqual(photos[1].file_name, 'diary_1_20261015_def456.png');

      // Khi gọi getDiaryByDate, photos phải có url đầy đủ
      const detail = await diaryService.getDiaryByDate(projectId, testDate);
      assert.strictEqual(detail.photos.length, 2);
      assert.strictEqual(detail.photos[0].url, '/uploads/diaries/diary_1_20261015_abc123.jpg');
    });

    await tB.test('B3: Từ chối dữ liệu không hợp lệ (sai định dạng ngày, work_item_id âm/sai định dạng)', async () => {
      // 1. Ngày sai định dạng
      await assert.rejects(
        async () => {
          await diaryService.saveDiary(projectId, { diary_date: '15-10-2026' });
        },
        /Ngày nhật ký không hợp lệ/
      );

      // 2. work_item_id không phải số nguyên dương
      await assert.rejects(
        async () => {
          await diaryService.saveDiary(projectId, {
            diary_date: '2026-10-16',
            work_item_id: -5
          });
        },
        /Mã công việc \(work_item_id\) phải là số nguyên dương/
      );

      // 3. Nhân lực âm
      await assert.rejects(
        async () => {
          await diaryService.saveDiary(projectId, {
            diary_date: '2026-10-16',
            manpower_count: -10
          });
        },
        /Số lượng nhân lực phải là số nguyên không âm/
      );
    });

    await tB.test('B4: Từ chối file sai loại MIME hoặc vượt quá dung lượng 5MB', () => {
      // 1. File hợp lệ (JPEG 2MB)
      const validCheck = validateUploadedFile({
        originalName: 'hien_truong.jpg',
        mimeType: 'image/jpeg',
        size: 2 * 1024 * 1024
      });
      assert.strictEqual(validCheck.valid, true);

      // 2. File sai MIME (PDF)
      const invalidMimeCheck = validateUploadedFile({
        originalName: 'ban_ve.pdf',
        mimeType: 'application/pdf',
        size: 1024 * 500
      });
      assert.strictEqual(invalidMimeCheck.valid, false);
      assert.ok(invalidMimeCheck.error.includes('Chỉ chấp nhận định dạng ảnh'));

      // 3. File vượt quá 5MB
      const oversizedCheck = validateUploadedFile({
        originalName: 'anh_nang.jpg',
        mimeType: 'image/jpeg',
        size: 6 * 1024 * 1024 // 6MB
      });
      assert.strictEqual(oversizedCheck.valid, false);
      assert.ok(oversizedCheck.error.includes('vượt quá dung lượng cho phép'));
    });

    await tB.test('B5: Xử lý file trùng tên an toàn, sinh tên file ngẫu nhiên chống path traversal', () => {
      const dangerousNames = [
        '../../../etc/passwd',
        '..\\..\\windows\\system32\\cmd.exe',
        'my photo with spaces & symbols !@#$.png',
        'test.php.jpg'
      ];

      for (const dangerousName of dangerousNames) {
        const safeName = generateSafeFileName(1, dangerousName);
        // Tên file sinh ra không được chứa '..' hoặc ký tự nguy hiểm
        assert.ok(!safeName.includes('..'), `Tên an toàn không được chứa '..': ${safeName}`);
        assert.ok(!safeName.includes('/'), `Tên an toàn không được chứa '/': ${safeName}`);
        assert.ok(!safeName.includes('\\'), `Tên an toàn không được chứa '\\': ${safeName}`);
        assert.ok(safeName.startsWith('diary_1_'), `Phải có tiền tố diary_1_: ${safeName}`);
      }

      // Hai file cùng tên gốc phải sinh ra hai safeName khác nhau hoàn toàn
      const name1 = generateSafeFileName(1, 'photo.jpg');
      const name2 = generateSafeFileName(1, 'photo.jpg');
      assert.notStrictEqual(name1, name2, 'Hai file trùng tên phải sinh mã ngẫu nhiên khác nhau để tránh đè file');
    });

    await tB.test('B6: Parser Multipart native đọc đúng boundary và tách file an toàn', () => {
      const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
      const body = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="diary_date"\r\n\r\n` +
        `2026-10-18\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="photos"; filename="test.jpg"\r\n` +
        `Content-Type: image/jpeg\r\n\r\n` +
        `fake-binary-jpeg-data\r\n` +
        `--${boundary}--\r\n`
      );

      const parsed = parseMultipartBuffer(body, boundary);
      assert.strictEqual(parsed.fields.diary_date, '2026-10-18');
      assert.strictEqual(parsed.files.length, 1);
      assert.strictEqual(parsed.files[0].originalName, 'test.jpg');
      assert.strictEqual(parsed.files[0].mimeType, 'image/jpeg');
      assert.strictEqual(parsed.files[0].data.toString(), 'fake-binary-jpeg-data');
    });

    await tB.test('B7: Kiểm tra quyền truy cập RBAC và khóa sổ S-24', async () => {
      const testDate = '2026-10-17';
      // 1. Tạo nhật ký bình thường
      const saved = await diaryService.saveDiary(projectId, {
        diary_date: testDate,
        weather_condition: 'sunny',
        work_notes: 'Công việc ngày 17'
      }, 1);

      // Khóa sổ ngày này (S-24)
      await diaryService.lockDiary(projectId, testDate, 1);

      // 2. Cố tình sửa hoặc thêm ảnh vào ngày đã khóa sổ => Bị từ chối với HTTP 423
      await assert.rejects(
        async () => {
          await diaryService.saveDiary(projectId, {
            diary_date: testDate,
            weather_condition: 'rain_all_day'
          }, 1);
        },
        (err) => {
          assert.strictEqual(err.status, 423);
          assert.ok(err.message.includes('đã bị khóa sổ'));
          return true;
        }
      );

      // 3. Cố tình tải thêm ảnh vào ngày đã khóa sổ => Bị từ chối với HTTP 423
      await assert.rejects(
        async () => {
          await diaryService.addPhotos(projectId, testDate, [{ filename: 'new.jpg' }], 1);
        },
        (err) => {
          assert.strictEqual(err.status, 423);
          return true;
        }
      );
    });

    await tB.test('B8: Xóa ảnh đính kèm khỏi nhật ký thành công (deletePhoto)', async () => {
      const testDate = '2026-10-18';
      const mockFiles = [
        {
          filename: 'photo_to_delete.jpg',
          path: '/uploads/diaries/photo_to_delete.jpg',
          size: 1024 * 100,
          mimetype: 'image/jpeg'
        }
      ];

      const saved = await diaryService.saveDiary(projectId, {
        diary_date: testDate,
        weather_condition: 'sunny'
      }, 1, mockFiles);

      const photosBefore = getSiteDiaryPhotos(saved.id);
      assert.strictEqual(photosBefore.length, 1);
      const photoId = photosBefore[0].id;

      // Xóa ảnh
      await diaryService.deletePhoto(projectId, photoId);

      const photosAfter = getSiteDiaryPhotos(saved.id);
      assert.strictEqual(photosAfter.length, 0, 'Ảnh phải được xóa khỏi nhật ký');
    });

    await tB.test('B9: Xóa ảnh không tồn tại trả về lỗi 404', async () => {
      await assert.rejects(
        async () => {
          await diaryService.deletePhoto(projectId, 999999);
        },
        (err) => {
          assert.strictEqual(err.status, 404);
          assert.ok(err.message.includes('Không tìm thấy ảnh đính kèm'));
          return true;
        }
      );
    });

    await tB.test('B10: Không thể xóa ảnh thuộc dự án khác (ngăn chặn xóa chéo dự án)', async () => {
      // Tạo nhật ký và ảnh ở dự án 2
      const savedOther = await diaryService.saveDiary(2, {
        diary_date: '2026-10-19',
        weather_condition: 'sunny'
      }, 1, [
        {
          filename: 'photo_proj_2.jpg',
          path: '/uploads/diaries/photo_proj_2.jpg',
          size: 1024 * 50,
          mimetype: 'image/jpeg'
        }
      ]);
      const otherPhotos = getSiteDiaryPhotos(savedOther.id);
      const otherPhotoId = otherPhotos[0].id;

      // Cố tình dùng projectId 1 để xóa ảnh của projectId 2
      await assert.rejects(
        async () => {
          await diaryService.deletePhoto(1, otherPhotoId);
        },
        (err) => {
          assert.strictEqual(err.status, 404);
          return true;
        }
      );

      // Ảnh của dự án 2 vẫn còn nguyên vẹn
      const afterAttempt = getSiteDiaryPhotos(savedOther.id);
      assert.strictEqual(afterAttempt.length, 1);
    });

    await tB.test('B11: Xóa ảnh thuộc nhật ký đã bị khóa sổ ném lỗi HTTP 423', async () => {
      const lockDate = '2026-10-20';
      const saved = await diaryService.saveDiary(projectId, {
        diary_date: lockDate,
        weather_condition: 'sunny'
      }, 1, [
        {
          filename: 'photo_locked.jpg',
          path: '/uploads/diaries/photo_locked.jpg',
          size: 1024 * 80,
          mimetype: 'image/jpeg'
        }
      ]);
      const photoId = getSiteDiaryPhotos(saved.id)[0].id;

      // Khóa sổ nhật ký ngày này
      await diaryService.lockDiary(projectId, lockDate, 1);

      // Thao tác xóa ảnh phải bị chặn với mã 423
      await assert.rejects(
        async () => {
          await diaryService.deletePhoto(projectId, photoId);
        },
        (err) => {
          assert.strictEqual(err.status, 423);
          assert.ok(err.message.includes('đã bị khóa sổ'));
          return true;
        }
      );

      // Ảnh vẫn còn nguyên vẹn
      assert.strictEqual(getSiteDiaryPhotos(saved.id).length, 1);
    });

    await tB.test('B12: Không xóa file vật lý nếu file vẫn được bản ghi khác dùng chung', async () => {
      const sharedFileName = 'shared_photo_specimen.jpg';
      const uploadsDir = path.join(__dirname, '../uploads/diaries');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      const testFilePath = path.join(uploadsDir, sharedFileName);
      fs.writeFileSync(testFilePath, 'dummy-binary-photo-content');

      // Tạo 2 nhật ký cùng tham chiếu sharedFileName
      const d1 = await diaryService.saveDiary(projectId, {
        diary_date: '2026-10-21',
        weather_condition: 'sunny'
      }, 1, [{ filename: sharedFileName, path: `/uploads/diaries/${sharedFileName}`, size: 100, mimetype: 'image/jpeg' }]);

      const d2 = await diaryService.saveDiary(projectId, {
        diary_date: '2026-10-22',
        weather_condition: 'cloudy'
      }, 1, [{ filename: sharedFileName, path: `/uploads/diaries/${sharedFileName}`, size: 100, mimetype: 'image/jpeg' }]);

      const p1Id = getSiteDiaryPhotos(d1.id)[0].id;
      const p2Id = getSiteDiaryPhotos(d2.id)[0].id;

      // Xóa bản ghi ảnh p1Id
      await diaryService.deletePhoto(projectId, p1Id);

      // Bản ghi p1 đã mất, nhưng file vật lý vẫn PHẢI CÒN vì p2 vẫn tham chiếu
      assert.strictEqual(fs.existsSync(testFilePath), true, 'File vật lý không được xóa vì p2 vẫn tham chiếu');

      // Xóa tiếp bản ghi ảnh p2Id
      await diaryService.deletePhoto(projectId, p2Id);

      // Khi không còn bản ghi nào tham chiếu, file vật lý được dọn sạch
      assert.strictEqual(fs.existsSync(testFilePath), false, 'File vật lý phải được dọn khi không còn bản ghi nào tham chiếu');
    });

    await tB.test('B13: Phân quyền RBAC - Người dùng Viewer bị chặn 403 Forbidden khi gọi route xóa ảnh', async () => {
      const routes = diaryRoutesFactory({ pool: null });
      // Tìm handler của route DELETE /projects/:projectId/diaries/photos/:photoId
      const deleteRouteLayer = routes.stack.find(
        layer => layer.route && layer.route.path === '/projects/:projectId/diaries/photos/:photoId' && layer.route.methods.delete
      );
      assert.ok(deleteRouteLayer, 'Phải có route DELETE /projects/:projectId/diaries/photos/:photoId');

      const deleteHandler = deleteRouteLayer.route.stack[deleteRouteLayer.route.stack.length - 1].handle;

      const mockReq = {
        params: { projectId: '1', photoId: '99' },
        user: { role: 'Viewer', id: 999 },
        headers: {}
      };

      let statusCode = 0;
      let responseBody = null;
      const mockRes = {
        status: (code) => {
          statusCode = code;
          return {
            json: (data) => { responseBody = data; }
          };
        },
        json: (data) => { responseBody = data; }
      };

      await deleteHandler(mockReq, mockRes);
      assert.strictEqual(statusCode, 403, 'Người dùng Viewer phải bị trả về HTTP 403');
      assert.strictEqual(responseBody.success, false);
      assert.ok(responseBody.message.toLowerCase().includes('quyền'));
    });

    await tB.test('B14: Kiểm tra mã frontend diary.html - Giữ nguyên ảnh trên giao diện nếu API trả lỗi', () => {
      const htmlPath = path.join(__dirname, '../../frontend/diary.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');

      // Đảm bảo có confirmation
      assert.ok(htmlContent.includes('confirm('), 'Phải có xác nhận trước khi xóa ảnh');

      // Đảm bảo chỉ lọc gỡ ảnh khi res.ok && data.success
      assert.ok(
        htmlContent.includes('if (res.ok && data.success)'),
        'Chỉ được gỡ ảnh khỏi giao diện sau khi máy chủ xác nhận thành công'
      );

      // Đảm bảo có bắt lỗi catch và hiển thị thông báo lỗi
      assert.ok(htmlContent.includes('showErrorToast'), 'Phải hiển thị toast lỗi khi xóa thất bại');
    });

    await tB.test('B15: Bố cục ảnh responsive không làm tràn màn hình (mobile & desktop)', () => {
      const htmlPath = path.join(__dirname, '../../frontend/diary.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');

      assert.ok(htmlContent.includes('.photo-preview-grid'), 'Phải có class .photo-preview-grid');
      assert.ok(htmlContent.includes('repeat(auto-fill, minmax('), 'Grid ảnh phải tự co giãn tự động');
      assert.ok(htmlContent.includes('object-fit: cover'), 'Ảnh thumbnail phải giữ đúng tỷ lệ không méo');
      assert.ok(htmlContent.includes('@media (max-width: 480px)'), 'Phải có media query cho màn hình nhỏ');
      assert.ok(htmlContent.includes('width: 100%'), 'Không được gây tràn ngang khung chứa');
    });
  });

  // ========================================================
  // NHÓM C — REGRESSION TEST SUITE
  // ========================================================
  await t.test('--- NHÓM C: KIỂM THỬ HỒI QUY REGRESSION T51 & T52 ---', async (tC) => {
    await tC.test('C1: Nhật ký có ngày mưa và ảnh đính kèm vẫn đồng bộ chính xác trên bảng đối chiếu tuần (T51)', async () => {
      const dateMonday = '2026-10-26';
      await diaryService.saveDiary(projectId, {
        diary_date: dateMonday,
        weather_condition: 'rain_all_day',
        is_rain_day: true,
        weather_notes: 'Mưa to ngập toàn công trường',
        manpower_count: 10
      }, 1, [
        {
          filename: 'rain_evidence.jpg',
          path: '/uploads/diaries/rain_evidence.jpg',
          size: 1024 * 300,
          mimetype: 'image/jpeg',
          caption: 'Ảnh hiện trường ngập nước do mưa cả ngày'
        }
      ]);

      const weekComparison = await diaryService.getWeeklyComparison(projectId, dateMonday);
      assert.strictEqual(weekComparison.success, true);
      assert.strictEqual(weekComparison.summary.workdayRainCount, 1);

      // Thẻ ngày thứ Hai phải nhận diện được có nhật ký và có ảnh
      const mondayDay = weekComparison.days.find(d => d.date === dateMonday);
      assert.ok(mondayDay);
      assert.strictEqual(mondayDay.hasDiary, true);
      assert.strictEqual(mondayDay.isRainDay, true);
    });

    await tC.test('C2: Danh sách nhật ký getDiaries trả về kèm photosCount chính xác', async () => {
      const list = await diaryService.getDiaries(projectId, { date: '2026-10-26' });
      assert.strictEqual(list.length, 1);
      assert.strictEqual(list[0].photosCount, 1, 'photosCount phải bằng 1');
    });
  });
});
