/**
 * Quản Lý Thi Công Hiện Trường - PWA Client Helper (S-27 / SCRUM-119)
 * - T-54 (SCRUM-129): Đăng ký Service Worker, Cache App Shell mở dưới 1s
 * - T-55 (SCRUM-130): Hỗ trợ Cài đặt màn hình chính, Chế độ Ngoại tuyến & Cập nhật SW
 */

(function () {
  'use strict';

  let deferredPrompt = null;
  let newWorker = null;

  // 1. Đo lường tốc độ mở App Shell (Tiêu chí chấp nhận mở dưới 1 giây - T-54)
  const perfMarkStart = performance.now();
  window.addEventListener('load', () => {
    const perfMarkEnd = performance.now();
    const loadDuration = Math.round(perfMarkEnd - perfMarkStart);
    window.pwaBenchmark = {
      durationMs: loadDuration,
      isUnder1Second: loadDuration < 1000,
      timestamp: new Date().toISOString()
    };
    console.log(`[PWA Shell] ⚡ Tốc độ mở trang: ${loadDuration}ms ${loadDuration < 1000 ? '✅ Đạt chuẩn <1s' : ''}`);
  });

  // 2. Đăng ký Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((registration) => {
          console.log('[PWA SW] Đăng ký thành công với scope:', registration.scope);

          // Kiểm tra bản cập nhật mới của Service Worker (T-55)
          registration.addEventListener('updatefound', () => {
            newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  // Đã có phiên bản mới sẵn sàng kích hoạt
                  showUpdateToast();
                }
              });
            }
          });
        })
        .catch((error) => {
          console.warn('[PWA SW] Đăng ký Service Worker thất bại:', error);
        });

      // Lắng nghe sự kiện chuyển đổi Service Worker controller
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });
    });
  }

  // 3. Xử lý Cài đặt ứng dụng vào màn hình chính (A2HS - Add to Home Screen - T-55)
  window.addEventListener('beforeinstallprompt', (e) => {
    // Ngăn chặn prompt mặc định của trình duyệt để hiển thị giao diện tùy biến
    e.preventDefault();
    deferredPrompt = e;
    window.deferredPWAInstallPrompt = e;

    // Hiển thị nút / banner cài đặt PWA
    showInstallPromptUI();
  });

  // Ghi nhận khi người dùng đã cài đặt thành công
  window.addEventListener('appinstalled', (evt) => {
    console.log('[PWA] Ứng dụng hiện trường đã được cài đặt lên thiết bị.');
    deferredPrompt = null;
    hideInstallPromptUI();
    showToastNotification('🎉 Đã cài đặt ứng dụng vào màn hình chính thành công!');
  });

  // 4. Giám sát trạng thái Mạng (Online / Offline)
  window.addEventListener('offline', () => {
    showNetworkStatus(false);
  });

  window.addEventListener('online', () => {
    showNetworkStatus(true);
  });

  // =========================================================================
  // GIAO DIỆN NGƯỜI DÙNG (UI COMPONENTS CHO PWA)
  // =========================================================================

  /**
   * Tạo và hiển thị Banner / Nút cài đặt ứng dụng
   */
  function showInstallPromptUI() {
    // Nếu ứng dụng đang chạy ở chế độ standalone (đã cài rồi), không hiển thị
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
      return;
    }

    let banner = document.getElementById('pwa-install-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'pwa-install-banner';
      banner.className = 'pwa-install-banner';
      banner.innerHTML = `
        <div class="pwa-banner-content">
          <div class="pwa-banner-icon">👷</div>
          <div class="pwa-banner-info">
            <strong>Cài đặt Quản Lý Thi Công</strong>
            <span>Mở nhanh như ứng dụng thật, dùng mượt mà tại hiện trường</span>
          </div>
        </div>
        <div class="pwa-banner-actions">
          <button id="pwa-btn-install" class="pwa-btn-primary">📲 Cài Đặt</button>
          <button id="pwa-btn-dismiss" class="pwa-btn-close" title="Đóng">&times;</button>
        </div>
      `;
      document.body.appendChild(banner);

      document.getElementById('pwa-btn-install').addEventListener('click', async () => {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          console.log(`[PWA Install] Lựa chọn của người dùng: ${outcome}`);
          deferredPrompt = null;
          hideInstallPromptUI();
        } else {
          // Hướng dẫn nếu thiết bị là iOS Safari
          if (isIosSafari()) {
            alert('Để cài đặt trên iPhone/iPad: Nhấn nút Chia sẻ (biểu tượng mũi tên lên) ở thanh trình duyệt, sau đó chọn "Thêm vào MH chính" (Add to Home Screen).');
          } else {
            alert('Trình duyệt của bạn hiện chưa kích hoạt lời mời cài đặt hoặc ứng dụng đã được cài.');
          }
        }
      });

      document.getElementById('pwa-btn-dismiss').addEventListener('click', () => {
        hideInstallPromptUI();
        localStorage.setItem('pwa_install_dismissed', 'true');
      });
    }

    if (localStorage.getItem('pwa_install_dismissed') !== 'true') {
      banner.style.display = 'flex';
    }

    // Nếu trang có sẵn nút cài đặt tùy chọn với ID 'btn-install-app'
    const customBtn = document.getElementById('btn-install-app');
    if (customBtn) {
      customBtn.style.display = 'inline-flex';
      customBtn.onclick = () => {
        if (deferredPrompt) {
          deferredPrompt.prompt();
        }
      };
    }
  }

  function hideInstallPromptUI() {
    const banner = document.getElementById('pwa-install-banner');
    if (banner) {
      banner.style.display = 'none';
    }
  }

  /**
   * Hiển thị Toast thông báo có bản cập nhật mới (T-55)
   */
  function showUpdateToast() {
    let toast = document.getElementById('pwa-update-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'pwa-update-toast';
      toast.className = 'pwa-toast-box';
      toast.innerHTML = `
        <div class="pwa-toast-text">
          <span>⚡ <strong>Có bản cập nhật mới</strong> cho ứng dụng hiện trường.</span>
        </div>
        <div class="pwa-toast-actions">
          <button id="pwa-btn-reload" class="pwa-btn-update">Cập nhật ngay</button>
          <button id="pwa-btn-close-toast" class="pwa-btn-close">&times;</button>
        </div>
      `;
      document.body.appendChild(toast);

      document.getElementById('pwa-btn-reload').addEventListener('click', () => {
        if (newWorker) {
          newWorker.postMessage({ type: 'SKIP_WAITING' });
        }
      });

      document.getElementById('pwa-btn-close-toast').addEventListener('click', () => {
        toast.style.display = 'none';
      });
    }
    toast.style.display = 'flex';
  }

  /**
   * Cảnh báo trạng thái mạng Online / Offline trên thanh trạng thái
   */
  function showNetworkStatus(isOnline) {
    let bar = document.getElementById('pwa-network-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'pwa-network-bar';
      document.body.appendChild(bar);
    }

    if (!isOnline) {
      bar.className = 'pwa-network-bar offline';
      bar.innerHTML = '⚠️ <strong>Bạn đang ngoại tuyến (Offline):</strong> Dữ liệu đã lưu vẫn sẵn sàng sử dụng tại công trường.';
      bar.style.display = 'block';
    } else {
      bar.className = 'pwa-network-bar online';
      bar.innerHTML = '✅ <strong>Đã kết nối Internet trở lại:</strong> Hệ thống sẵn sàng đồng bộ dữ liệu.';
      bar.style.display = 'block';
      setTimeout(() => {
        if (navigator.onLine) {
          bar.style.display = 'none';
        }
      }, 3500);
    }
  }

  function showToastNotification(msg) {
    const el = document.createElement('div');
    el.className = 'pwa-success-toast';
    el.innerText = msg;
    document.body.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, 4000);
  }

  function isIosSafari() {
    const ua = window.navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const isSafari = /WebKit/.test(ua) && !/CriOS|FxiOS|OPiOS|mercury/.test(ua);
    return isIos && isSafari;
  }

  // Đính kèm CSS định kiểu giao diện PWA tự động vào trang
  const style = document.createElement('style');
  style.textContent = `
    .pwa-install-banner {
      position: fixed;
      bottom: 24px;
      right: 24px;
      left: auto;
      transform: none;
      width: calc(100% - 48px);
      max-width: 420px;
      background: #0f172a;
      color: #ffffff;
      padding: 12px 16px;
      border-radius: 16px;
      box-shadow: 0 10px 25px rgba(15, 23, 42, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1);
      display: none;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      z-index: 99999;
      animation: pwaSlideToast 0.3s ease-out;
    }
    @keyframes pwaSlideToast {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    .pwa-banner-content {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .pwa-banner-icon {
      font-size: 26px;
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: linear-gradient(135deg, #1d4ed8, #0284c7);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .pwa-banner-info {
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .pwa-banner-info strong {
      font-size: 14px;
      color: #f8fafc;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pwa-banner-info span {
      font-size: 11px;
      color: #94a3b8;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pwa-banner-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .pwa-btn-primary {
      background: #1d4ed8;
      color: #ffffff;
      border: none;
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 700;
      border-radius: 999px;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s ease;
    }
    .pwa-btn-primary:hover {
      background: #2563eb;
    }
    .pwa-btn-close {
      background: transparent;
      border: none;
      color: #94a3b8;
      font-size: 20px;
      cursor: pointer;
      line-height: 1;
      padding: 4px;
    }
    .pwa-btn-close:hover {
      color: #ffffff;
    }
    .pwa-toast-box {
      position: fixed;
      top: 16px;
      right: 16px;
      background: #1e293b;
      color: #ffffff;
      padding: 12px 18px;
      border-radius: 12px;
      box-shadow: 0 10px 20px rgba(0,0,0,0.25);
      border: 1px solid #334155;
      display: none;
      align-items: center;
      gap: 14px;
      z-index: 100000;
    }
    .pwa-btn-update {
      background: #059669;
      color: #ffffff;
      border: none;
      padding: 6px 12px;
      font-size: 12.5px;
      font-weight: 700;
      border-radius: 8px;
      cursor: pointer;
    }
    .pwa-btn-update:hover {
      background: #10b981;
    }
    .pwa-network-bar {
      position: sticky;
      top: 0;
      left: 0;
      width: 100%;
      padding: 8px 16px;
      font-size: 13px;
      text-align: center;
      z-index: 100001;
      display: none;
    }
    .pwa-network-bar.offline {
      background: #f59e0b;
      color: #78350f;
    }
    .pwa-network-bar.online {
      background: #10b981;
      color: #064e3b;
    }
    .pwa-success-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #059669;
      color: #ffffff;
      padding: 12px 20px;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(5, 150, 105, 0.3);
      z-index: 100000;
    }
  `;
  document.head.appendChild(style);

  // Xuất helper ra đối tượng window để các module khác hoặc bộ test có thể gọi
  window.PWAHelper = {
    promptInstall: () => {
      if (deferredPrompt) deferredPrompt.prompt();
    },
    isInstallable: () => !!deferredPrompt,
    isStandalone: () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true,
    isOnline: () => navigator.onLine
  };
})();
