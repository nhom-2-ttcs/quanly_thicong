/**
 * Staging Health Monitor Service (S-51 / SCRUM-E01 / T-119)
 * Giám sát sức khỏe môi trường Staging chạy độc lập với tiến trình ứng dụng
 * Tự động gửi cảnh báo webhook khi hệ thống gián đoạn liên tục quá 5 phút (300s)
 * Chống gửi cảnh báo lặp, xử lý timeout và ghi nhận phục hồi
 */

class StagingMonitor {
  constructor(options = {}) {
    this.targetUrl = options.targetUrl || process.env.MONITOR_TARGET_URL || 'http://localhost:5000/api/health/readiness';
    this.intervalSeconds = Number(options.intervalSeconds || process.env.MONITOR_INTERVAL_SECONDS || 30);
    this.alertThresholdSeconds = Number(options.alertThresholdSeconds || process.env.MONITOR_ALERT_THRESHOLD_SECONDS || 300); // 5 phút
    this.webhookUrl = options.webhookUrl || process.env.ALERT_WEBHOOK_URL || null;
    this.webhookTimeoutMs = Number(options.webhookTimeoutMs || process.env.ALERT_WEBHOOK_TIMEOUT_MS || 5000);
    this.probeTimeoutMs = Number(options.probeTimeoutMs || process.env.MONITOR_PROBE_TIMEOUT_MS || 5000);

    // Dependencies có thể inject để test với fake clock & mock fetch
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.clock = options.clock || {
      now: () => Date.now(),
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis)
    };
    this.logger = options.logger || console;

    // Trạng thái theo dõi sự cố
    this.isHealthy = true;
    this.failureStartTime = null;
    this.consecutiveFailures = 0;
    this.alertSent = false;
    this.recoveryAlertSent = false;
    this.lastCheckTime = null;
    this.lastResult = null;
    this.timerId = null;
    this.isRunning = false;
  }

  /**
   * Thực hiện một lần kiểm tra sức khoẻ (probe check)
   */
  async checkOnce() {
    const checkTimestamp = this.clock.now();
    this.lastCheckTime = checkTimestamp;

    let probeResult = null;
    let isProbeSuccess = false;
    let failureReason = null;

    try {
      const controller = new AbortController();
      const timeoutId = this.clock.setTimeout(() => controller.abort(), this.probeTimeoutMs);

      const res = await this.fetchFn(this.targetUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });

      this.clock.clearTimeout(timeoutId);

      let body = null;
      try {
        body = await res.json();
      } catch (_) {
        body = { status: res.statusText };
      }

      if (res.ok && res.status === 200) {
        // Backend phản hồi 200 OK
        isProbeSuccess = true;
        probeResult = {
          success: true,
          status: res.status,
          timestamp: checkTimestamp,
          data: body
        };
      } else {
        isProbeSuccess = false;
        failureReason = `HTTP ${res.status}: ${body?.message || res.statusText || 'Trạng thái không sẵn sàng'}`;
        probeResult = {
          success: false,
          status: res.status,
          timestamp: checkTimestamp,
          reason: failureReason
        };
      }
    } catch (err) {
      isProbeSuccess = false;
      const isTimeout = err.name === 'AbortError' || (err.message && err.message.includes('timeout'));
      failureReason = isTimeout ? 'Yêu cầu kiểm tra sức khoẻ bị quá thời gian (Timeout)' : `Không thể kết nối máy chủ (${err.message})`;
      probeResult = {
        success: false,
        status: 0,
        timestamp: checkTimestamp,
        reason: failureReason
      };
    }

    this.lastResult = probeResult;

    // Xử lý chuyển đổi trạng thái
    if (isProbeSuccess) {
      await this._handleSuccess(checkTimestamp);
    } else {
      await this._handleFailure(checkTimestamp, failureReason);
    }

    return probeResult;
  }

  /**
   * Xử lý khi kiểm tra thành công
   */
  async _handleSuccess(now) {
    if (this.failureStartTime !== null) {
      const downtimeSeconds = Math.floor((now - this.failureStartTime) / 1000);
      this.logger.log(`[StagingMonitor] ✅ Hệ thống Staging đã PHỤC HỒI sau ${downtimeSeconds} giây gián đoạn.`);

      // Nếu trước đó đã gửi cảnh báo lỗi 5 phút -> gửi tiếp thông báo phục hồi
      if (this.alertSent) {
        await this._sendWebhookAlert({
          event: 'STAGING_RECOVERED',
          severity: 'INFO',
          service: 'staging_backend',
          status: 'ready',
          downtime_seconds: downtimeSeconds,
          failure_start_time: new Date(this.failureStartTime).toISOString(),
          recovered_at: new Date(now).toISOString(),
          message: `✅ THÔNG BÁO: Môi trường Staging đã phục hồi và hoạt động bình thường trở lại sau ${Math.floor(downtimeSeconds / 60)} phút (${downtimeSeconds}s) gián đoạn.`
        });
        this.recoveryAlertSent = true;
      }

      // Bắt đầu lại bộ đếm cho các sự cố tiếp theo
      this.failureStartTime = null;
      this.alertSent = false;
      this.consecutiveFailures = 0;
    }

    this.isHealthy = true;
  }

  /**
   * Xử lý khi phát hiện lỗi
   */
  async _handleFailure(now, reason) {
    this.isHealthy = false;
    this.consecutiveFailures++;

    if (this.failureStartTime === null) {
      this.failureStartTime = now;
      this.logger.warn(`[StagingMonitor] ⚠️ Bắt đầu ghi nhận sự cố Staging không phản hồi lúc ${new Date(now).toISOString()} (${reason})`);
    }

    const downtimeSeconds = Math.floor((now - this.failureStartTime) / 1000);
    this.logger.warn(`[StagingMonitor] ⚠️ Staging đang gián đoạn liên tục: ${downtimeSeconds}s / ngưỡng ${this.alertThresholdSeconds}s (Lỗi lần ${this.consecutiveFailures})`);

    // Kiểm tra ngưỡng cảnh báo (>= 300 giây = 5 phút)
    if (downtimeSeconds >= this.alertThresholdSeconds && !this.alertSent) {
      this.logger.error(`[StagingMonitor] 🚨 Ngưỡng gián đoạn 5 phút đã bị vượt (${downtimeSeconds}s >= ${this.alertThresholdSeconds}s)! Gửi cảnh báo sự cố ngay lập tức.`);

      const alertPayload = {
        event: 'STAGING_DOWNTIME_ALERT',
        severity: 'CRITICAL',
        service: 'staging_backend',
        status: 'unhealthy',
        downtime_seconds: downtimeSeconds,
        downtime_minutes: Math.round(downtimeSeconds / 60),
        failure_start_time: new Date(this.failureStartTime).toISOString(),
        alert_time: new Date(now).toISOString(),
        message: `🚨 CẢNH BÁO: Môi trường Staging không phản hồi liên tục quá ${Math.floor(downtimeSeconds / 60)} phút (${downtimeSeconds} giây)! Vui lòng kiểm tra dịch vụ backend/database.`,
        reason: reason
      };

      await this._sendWebhookAlert(alertPayload);
      // Đánh dấu đã gửi cảnh báo để TRÁNH GỬI LẶP cho cùng một sự cố
      this.alertSent = true;
    }
  }

  /**
   * Gửi cảnh báo qua Webhook tới kênh nhóm
   */
  async _sendWebhookAlert(payload) {
    if (!this.webhookUrl) {
      this.logger.warn('[StagingMonitor] ℹ️ ALERT_WEBHOOK_URL chưa được cấu hình. Bỏ qua gửi webhook thực tế.');
      return false;
    }

    try {
      const controller = new AbortController();
      const timeoutId = this.clock.setTimeout(() => controller.abort(), this.webhookTimeoutMs);

      const res = await this.fetchFn(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'QuanLyThiCong-StagingMonitor/1.0'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      this.clock.clearTimeout(timeoutId);

      if (!res.ok) {
        this.logger.warn(`[StagingMonitor] Webhook cảnh báo trả về mã trạng thái HTTP ${res.status}`);
        return false;
      }

      this.logger.log(`[StagingMonitor] ✅ Đã gửi thành công webhook cảnh báo: [${payload.event}]`);
      return true;
    } catch (err) {
      // Xử lý timeout/lỗi webhook: Tuyệt đối không làm crash monitor
      const isTimeout = err.name === 'AbortError';
      this.logger.error(`[StagingMonitor] Lỗi khi gửi webhook cảnh báo (${isTimeout ? 'Timeout' : err.message})`);
      return false;
    }
  }

  /**
   * Bắt đầu vòng lặp giám sát
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.logger.log(`[StagingMonitor] 🚀 Khởi động dịch vụ giám sát Staging: Mục tiêu=${this.targetUrl}, Chu kỳ=${this.intervalSeconds}s, Ngưỡng cảnh báo=${this.alertThresholdSeconds}s (5 phút)`);

    // Thực hiện lần kiểm tra đầu tiên ngay lập tức
    this.checkOnce();

    // Lên lịch các lần kiểm tra định kỳ
    this.timerId = setInterval(() => {
      if (this.isRunning) {
        this.checkOnce();
      }
    }, this.intervalSeconds * 1000);
  }

  /**
   * Dừng dịch vụ giám sát
   */
  stop() {
    this.isRunning = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.logger.log('[StagingMonitor] 🛑 Đã dừng dịch vụ giám sát Staging.');
  }
}

module.exports = StagingMonitor;
