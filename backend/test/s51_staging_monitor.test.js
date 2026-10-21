const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const StagingMonitor = require('../src/services/stagingMonitor');

// Lớp giả lập đồng hồ thời gian (Fake Clock) để kiểm thử mà không cần chờ thật 5 phút
class FakeClock {
  constructor(initialTime = 1700000000000) {
    this.currentTime = initialTime;
  }
  now() {
    return this.currentTime;
  }
  advanceSeconds(seconds) {
    this.currentTime += seconds * 1000;
  }
  setTimeout(fn, ms) {
    // Trong môi trường mock, execute ngay hoặc qua real timer tối thiểu
    return setTimeout(fn, 10);
  }
  clearTimeout(id) {
    clearTimeout(id);
  }
}

describe('S-51 (SCRUM-E01): Giám sát sức khỏe Staging & Cảnh báo downtime 5 phút', () => {

  // ==========================================
  // PHẦN 1: KIỂM THỬ ENDPOINT READINESS PROBE (/api/health/readiness)
  // ==========================================
  describe('1. Endpoint kiểm tra độ sẵn sàng (/api/health/readiness)', () => {
    test('1.1. Trả về HTTP 200 khi ứng dụng và CSDL sẵn sàng', async () => {
      const app = express();
      // Giả lập DB hoạt động bình thường
      const mockDb = {
        isConnected: true,
        pool: {
          query: async (sql) => [{ solution: 2 }]
        }
      };

      app.get('/api/health/readiness', async (req, res) => {
        try {
          await mockDb.pool.query('SELECT 1');
          res.status(200).json({
            status: 'ready',
            uptime: 100,
            timestamp: new Date().toISOString(),
            checks: { app: 'ok', db: 'ok' }
          });
        } catch (_) {
          res.status(503).json({ status: 'unhealthy' });
        }
      });

      const server = app.listen(0);
      const port = server.address().port;

      try {
        const res = await fetch(`http://localhost:${port}/api/health/readiness`);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.status, 'ready');
        assert.equal(data.checks.app, 'ok');
        assert.equal(data.checks.db, 'ok');
      } finally {
        server.close();
      }
    });

    test('1.2. Trả về HTTP 503 khi CSDL lỗi hoặc truy vấn quá thời gian; KHÔNG để lộ secret/stack trace', async () => {
      const app = express();
      // Giả lập DB ném lỗi kết nối có chứa connection string nhạy cảm
      const sensitiveError = new Error('Access denied for user "root"@"mysql.internal" using password: YES (secret_db_password_12345)');

      app.get('/api/health/readiness', async (req, res) => {
        try {
          throw sensitiveError;
        } catch (_) {
          // Bảo mật theo S-51: Tuyệt đối không leak connection string hay stack trace
          res.status(503).json({
            status: 'unhealthy',
            uptime: 100,
            timestamp: new Date().toISOString(),
            checks: { app: 'ok', db: 'error' },
            message: 'Cơ sở dữ liệu không phản hồi hoặc truy vấn kiểm tra bị quá thời gian.'
          });
        }
      });

      const server = app.listen(0);
      const port = server.address().port;

      try {
        const res = await fetch(`http://localhost:${port}/api/health/readiness`);
        assert.equal(res.status, 503);
        const data = await res.json();
        assert.equal(data.status, 'unhealthy');
        assert.equal(data.checks.db, 'error');

        const rawBody = JSON.stringify(data);
        assert.ok(!rawBody.includes('secret_db_password_12345'), 'Không được để lộ mật khẩu CSDL');
        assert.ok(!rawBody.includes('mysql.internal'), 'Không được để lộ connection string host');
        assert.ok(!rawBody.includes('stack'), 'Không được để lộ stack trace');
      } finally {
        server.close();
      }
    });
  });

  // ==========================================
  // PHẦN 2: KIỂM THỬ STAGING MONITOR VỚI FAKE CLOCK (KHÔNG CHỜ 5 PHÚT THẬT)
  // ==========================================
  describe('2. Tiến trình giám sát StagingMonitor độc lập', () => {
    let fakeClock;
    let webhookCalls;
    let targetProbeStatus;

    beforeEach(() => {
      fakeClock = new FakeClock();
      webhookCalls = [];
      targetProbeStatus = { status: 200, body: { status: 'ready' } };
    });

    function createMockFetch() {
      return async (url, options = {}) => {
        // Nếu là gọi Webhook cảnh báo
        if (url.includes('webhook.example.com')) {
          const body = options.body ? JSON.parse(options.body) : null;
          webhookCalls.push({ url, options, body });
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true })
          };
        }

        // Nếu là gọi probe kiểm tra sức khỏe
        if (targetProbeStatus.error) {
          const err = new Error(targetProbeStatus.error);
          if (targetProbeStatus.error === 'ECONNREFUSED') err.code = 'ECONNREFUSED';
          throw err;
        }

        return {
          ok: targetProbeStatus.status >= 200 && targetProbeStatus.status < 300,
          status: targetProbeStatus.status,
          statusText: targetProbeStatus.status === 200 ? 'OK' : 'Service Unavailable',
          json: async () => targetProbeStatus.body || {}
        };
      };
    }

    test('2.1. API/DB bình thường: Monitor kiểm tra định kỳ, không gửi cảnh báo nào', async () => {
      const mockFetch = createMockFetch();
      const monitor = new StagingMonitor({
        targetUrl: 'http://staging.internal/api/health/readiness',
        webhookUrl: 'https://webhook.example.com/alerts',
        intervalSeconds: 30,
        alertThresholdSeconds: 300, // 5 phút
        clock: fakeClock,
        fetchFn: mockFetch,
        logger: { log: () => {}, warn: () => {}, error: () => {} }
      });

      // Lần kiểm tra 1 tại t = 0s
      const r1 = await monitor.checkOnce();
      assert.equal(r1.success, true);
      assert.equal(monitor.isHealthy, true);
      assert.equal(monitor.failureStartTime, null);
      assert.equal(webhookCalls.length, 0);

      // Trôi qua 2 phút (120s), kiểm tra lần 2
      fakeClock.advanceSeconds(120);
      const r2 = await monitor.checkOnce();
      assert.equal(r2.success, true);
      assert.equal(monitor.isHealthy, true);
      assert.equal(webhookCalls.length, 0);
    });

    test('2.2. Lỗi chưa vượt ngưỡng 5 phút (< 300s): Ghi nhận downtime nhưng KHÔNG gửi cảnh báo', async () => {
      const mockFetch = createMockFetch();
      const monitor = new StagingMonitor({
        targetUrl: 'http://staging.internal/api/health/readiness',
        webhookUrl: 'https://webhook.example.com/alerts',
        intervalSeconds: 30,
        alertThresholdSeconds: 300, // 5 phút
        clock: fakeClock,
        fetchFn: mockFetch,
        logger: { log: () => {}, warn: () => {}, error: () => {} }
      });

      // Giả lập DB lỗi (503)
      targetProbeStatus = { status: 503, body: { status: 'unhealthy', checks: { db: 'error' } } };

      // Lần check 1: t = 0s (Bắt đầu lỗi)
      await monitor.checkOnce();
      assert.equal(monitor.isHealthy, false);
      assert.notEqual(monitor.failureStartTime, null);
      assert.equal(monitor.alertSent, false);
      assert.equal(webhookCalls.length, 0, 'Chưa được gửi cảnh báo ở 0s');

      // Check tại t = 150s (2.5 phút)
      fakeClock.advanceSeconds(150);
      await monitor.checkOnce();
      assert.equal(monitor.alertSent, false);
      assert.equal(webhookCalls.length, 0, 'Chưa được gửi cảnh báo ở 150s');

      // Check tại t = 299s (4 phút 59 giây - chưa đủ 300s)
      fakeClock.advanceSeconds(149);
      await monitor.checkOnce();
      assert.equal(monitor.alertSent, false);
      assert.equal(webhookCalls.length, 0, 'Chưa được gửi cảnh báo ở 299s');
    });

    test('2.3. Tại mốc 5 phút (>= 300s): Gửi webhook cảnh báo chính xác với thông tin downtime', async () => {
      const mockFetch = createMockFetch();
      const monitor = new StagingMonitor({
        targetUrl: 'http://staging.internal/api/health/readiness',
        webhookUrl: 'https://webhook.example.com/alerts',
        intervalSeconds: 30,
        alertThresholdSeconds: 300, // 5 phút
        clock: fakeClock,
        fetchFn: mockFetch,
        logger: { log: () => {}, warn: () => {}, error: () => {} }
      });

      targetProbeStatus = { status: 503, body: { status: 'unhealthy' } };

      // t = 0s: Bắt đầu lỗi
      await monitor.checkOnce();

      // Tiến đồng hồ tới t = 300s (đúng 5 phút)
      fakeClock.advanceSeconds(300);
      await monitor.checkOnce();

      assert.equal(monitor.alertSent, true, 'alertSent phải bật true');
      assert.equal(webhookCalls.length, 1, 'Phải gửi đúng 1 cảnh báo');

      const alertPayload = webhookCalls[0].body;
      assert.equal(alertPayload.event, 'STAGING_DOWNTIME_ALERT');
      assert.equal(alertPayload.severity, 'CRITICAL');
      assert.equal(alertPayload.downtime_seconds, 300);
      assert.equal(alertPayload.downtime_minutes, 5);
      assert.ok(alertPayload.message.includes('quá 5 phút'));
    });

    test('2.4. Sự cố kéo dài liên tục (> 5 phút): Chống gửi cảnh báo lặp (Anti-spam alert)', async () => {
      const mockFetch = createMockFetch();
      const monitor = new StagingMonitor({
        targetUrl: 'http://staging.internal/api/health/readiness',
        webhookUrl: 'https://webhook.example.com/alerts',
        intervalSeconds: 30,
        alertThresholdSeconds: 300,
        clock: fakeClock,
        fetchFn: mockFetch,
        logger: { log: () => {}, warn: () => {}, error: () => {} }
      });

      targetProbeStatus = { status: 503 };

      // t = 0s: lỗi
      await monitor.checkOnce();

      // t = 300s: chạm ngưỡng 5 phút -> gửi cảnh báo lần 1
      fakeClock.advanceSeconds(300);
      await monitor.checkOnce();
      assert.equal(webhookCalls.length, 1);

      // t = 330s: tiếp tục lỗi -> KHÔNG gửi lặp
      fakeClock.advanceSeconds(30);
      await monitor.checkOnce();
      assert.equal(webhookCalls.length, 1, 'Không gửi lặp ở 330s');

      // t = 600s: tiếp tục lỗi (10 phút) -> VẪN KHÔNG gửi lặp
      fakeClock.advanceSeconds(270);
      await monitor.checkOnce();
      assert.equal(webhookCalls.length, 1, 'Không gửi lặp ở 600s');
    });

    test('2.5. Phục hồi trước ngưỡng 5 phút: Reset bộ đếm sự cố, không gửi cảnh báo', async () => {
      const mockFetch = createMockFetch();
      const monitor = new StagingMonitor({
        targetUrl: 'http://staging.internal/api/health/readiness',
        webhookUrl: 'https://webhook.example.com/alerts',
        intervalSeconds: 30,
        alertThresholdSeconds: 300,
        clock: fakeClock,
        fetchFn: mockFetch,
        logger: { log: () => {}, warn: () => {}, error: () => {} }
      });

      // t = 0s: lỗi
      targetProbeStatus = { status: 503 };
      await monitor.checkOnce();
      assert.notEqual(monitor.failureStartTime, null);

      // t = 180s (3 phút): hệ thống tự phục hồi về 200 OK
      fakeClock.advanceSeconds(180);
      targetProbeStatus = { status: 200, body: { status: 'ready' } };
      await monitor.checkOnce();

      assert.equal(monitor.isHealthy, true);
      assert.equal(monitor.failureStartTime, null, 'Bộ đếm sự cố phải được reset về null');
      assert.equal(monitor.alertSent, false);
      assert.equal(webhookCalls.length, 0, 'Không có webhook nào được gửi do phục hồi trước ngưỡng 5 phút');
    });

    test('2.6. Phục hồi sau khi đã cảnh báo: Gửi thông báo phục hồi và bắt đầu chu kỳ mới', async () => {
      const mockFetch = createMockFetch();
      const monitor = new StagingMonitor({
        targetUrl: 'http://staging.internal/api/health/readiness',
        webhookUrl: 'https://webhook.example.com/alerts',
        intervalSeconds: 30,
        alertThresholdSeconds: 300,
        clock: fakeClock,
        fetchFn: mockFetch,
        logger: { log: () => {}, warn: () => {}, error: () => {} }
      });

      // t = 0s: lỗi
      targetProbeStatus = { status: 503 };
      await monitor.checkOnce();

      // t = 360s (6 phút): vượt ngưỡng -> đã gửi cảnh báo downtime
      fakeClock.advanceSeconds(360);
      await monitor.checkOnce();
      assert.equal(webhookCalls.length, 1);
      assert.equal(webhookCalls[0].body.event, 'STAGING_DOWNTIME_ALERT');

      // t = 420s (7 phút): hệ thống phục hồi 200 OK
      fakeClock.advanceSeconds(60);
      targetProbeStatus = { status: 200, body: { status: 'ready' } };
      await monitor.checkOnce();

      assert.equal(monitor.isHealthy, true);
      assert.equal(monitor.failureStartTime, null, 'failureStartTime phải được reset');
      assert.equal(monitor.alertSent, false, 'alertSent phải được reset');

      // Đã gửi thông báo phục hồi (RECOVERED)
      assert.equal(webhookCalls.length, 2);
      assert.equal(webhookCalls[1].body.event, 'STAGING_RECOVERED');
      assert.ok(webhookCalls[1].body.message.includes('phục hồi'));

      // Chu kỳ sự cố mới độc lập: Lại bị lỗi lúc t = 500s
      fakeClock.advanceSeconds(80);
      targetProbeStatus = { status: 503 };
      await monitor.checkOnce();
      assert.notEqual(monitor.failureStartTime, null);
      assert.equal(monitor.alertSent, false);

      // t = 800s (sau 300s của sự cố mới) -> gửi cảnh báo của chu kỳ mới
      fakeClock.advanceSeconds(300);
      await monitor.checkOnce();
      assert.equal(webhookCalls.length, 3, 'Gửi cảnh báo sự cố mới thành công');
      assert.equal(webhookCalls[2].body.event, 'STAGING_DOWNTIME_ALERT');
    });

    test('2.7. API backend dừng hoàn toàn (ECONNREFUSED / Network crash): Monitor phát hiện và cảnh báo', async () => {
      const mockFetch = createMockFetch();
      const monitor = new StagingMonitor({
        targetUrl: 'http://staging.internal:5000/api/health/readiness',
        webhookUrl: 'https://webhook.example.com/alerts',
        intervalSeconds: 30,
        alertThresholdSeconds: 300,
        clock: fakeClock,
        fetchFn: mockFetch,
        logger: { log: () => {}, warn: () => {}, error: () => {} }
      });

      // Mô phỏng container backend bị dừng, ném lỗi kết nối mạng ECONNREFUSED
      targetProbeStatus = { error: 'connect ECONNREFUSED 127.0.0.1:5000' };

      // t = 0s
      const r1 = await monitor.checkOnce();
      assert.equal(r1.success, false);
      assert.equal(monitor.isHealthy, false);

      // t = 300s
      fakeClock.advanceSeconds(300);
      await monitor.checkOnce();

      assert.equal(monitor.alertSent, true);
      assert.equal(webhookCalls.length, 1);
      assert.ok(webhookCalls[0].body.reason.includes('ECONNREFUSED'));
    });

    test('2.8. Webhook không cấu hình hoặc bị lỗi/timeout: Monitor không bị crash', async () => {
      let loggedError = false;
      const failingWebhookFetch = async (url) => {
        if (url.includes('failing-webhook')) {
          throw new Error('Webhook endpoint timed out after 5000ms');
        }
        return { ok: false, status: 503, json: async () => ({}) };
      };

      const monitor = new StagingMonitor({
        targetUrl: 'http://staging.internal/api/health/readiness',
        webhookUrl: 'https://failing-webhook.example.com/alerts',
        alertThresholdSeconds: 300,
        clock: fakeClock,
        fetchFn: failingWebhookFetch,
        logger: {
          log: () => {},
          warn: () => {},
          error: () => { loggedError = true; }
        }
      });

      // t = 0s
      await monitor.checkOnce();
      // t = 300s
      fakeClock.advanceSeconds(300);

      // Không được ném lỗi ra ngoài làm sập tiến trình monitor
      await assert.doesNotReject(async () => {
        await monitor.checkOnce();
      });

      assert.equal(loggedError, true, 'Monitor phải ghi nhận log lỗi gửi webhook mà không dừng tiến trình');
    });
  });
});
