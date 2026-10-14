/**
 * Service Worker: Quản Lý Thi Công Hiện Trường (S-27 / SCRUM-119)
 * Subtask T-54 (SCRUM-129): Cấu hình Web App Manifest, Service Worker cache app shell mở dưới 1s
 * Subtask T-55 (SCRUM-130): Bộ kiểm thử PWA: cài đặt màn hình chính, mở offline và cập nhật SW
 */

const CACHE_VERSION = 'v1.0.0';
const CACHE_NAME = `quanly-thicong-appshell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `quanly-thicong-runtime-${CACHE_VERSION}`;

// Danh sách tài nguyên cốt lõi (App Shell) cần cache ngay khi cài đặt
const APP_SHELL_ASSETS = [
  '/',
  '/diary.html',
  '/index.html',
  '/schedule.html',
  '/teams.html',
  '/wbs.html',
  '/calendar.html',
  '/gantt.html',
  '/login.html',
  '/register.html',
  '/offline.html',
  '/manifest.json',
  '/js/pwa-register.js',
  '/js/app-navbar.js',
  '/icons/icon.svg',
  '/icons/icon-72x72.png',
  '/icons/icon-96x96.png',
  '/icons/icon-128x128.png',
  '/icons/icon-144x144.png',
  '/icons/icon-152x152.png',
  '/icons/icon-192x192.png',
  '/icons/icon-384x384.png',
  '/icons/icon-512x512.png',
  '/icons/icon-maskable-192x192.png',
  '/icons/icon-maskable-512x512.png'
];

/**
 * 1. Sự kiện INSTALL: Tải trước toàn bộ App Shell vào Cache
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Dùng Promise.allSettled để tránh trường hợp 1 file chưa sẵn sàng làm hỏng toàn bộ quá trình cài đặt
      const cachePromises = APP_SHELL_ASSETS.map(async (url) => {
        try {
          const response = await fetch(url, { cache: 'no-cache' });
          if (response.ok) {
            await cache.put(url, response);
          }
        } catch (err) {
          console.warn(`[SW] Chưa thể nạp trước tài nguyên: ${url}`, err);
        }
      });
      await Promise.allSettled(cachePromises);
    })
  );
  // Kích hoạt ngay service worker mới không cần đợi tab cũ đóng
  self.skipWaiting();
});

/**
 * 2. Sự kiện ACTIVATE: Dọn dẹp cache phiên bản cũ & chiếm quyền điều khiển
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((existingCache) => {
          if (existingCache !== CACHE_NAME && existingCache !== RUNTIME_CACHE) {
            console.log(`[SW] Dọn dẹp phiên bản cache cũ: ${existingCache}`);
            return caches.delete(existingCache);
          }
        })
      );
    }).then(() => {
      // Chiếm quyền điều khiển ngay lập tức cho các trang đang mở
      return self.clients.claim();
    })
  );
});

/**
 * 3. Sự kiện FETCH: Chiến lược phản hồi tối ưu cho Hiện trường di động
 * - App Shell / Tĩnh: Stale-While-Revalidate (Ưu tiên phản hồi ngay < 50ms từ Cache, cập nhật ngầm)
 * - API (/api/): Network-First (Lấy dữ liệu mới nhất, fallback an toàn khi mất sóng)
 * - Navigation: Trả về trang offline nếu hoàn toàn mất kết nối
 */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Bỏ qua các giao thức không phải http/https (như chrome-extension://)
  if (!url.protocol.startsWith('http')) return;

  // Bỏ qua các request POST, PUT, DELETE không được phép lưu vào Cache API
  if (req.method !== 'GET') {
    return;
  }

  // A. CHIẾN LƯỢC CHO API (/api/): Network-First
  // NFR S-27: Service Worker chỉ cache App Shell, không cache nhầm dữ liệu API hay thay thế dữ liệu ngoại tuyến của S-29
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname.includes('/diaries') || url.pathname.includes('/diary-items') || url.pathname.includes('/photos')) {
      return; // Không can thiệp để client S-29 tự quản lý ngoại tuyến với IndexedDB
    }
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          // Lưu bản sao runtime cache cho các truy vấn GET xem dữ liệu thi công
          if (networkRes && networkRes.status === 200) {
            const resClone = networkRes.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, resClone));
          }
          return networkRes;
        })
        .catch(async () => {
          // Khi rớt mạng: Thử tìm trong runtime cache đã lưu
          const cachedRes = await caches.match(req);
          if (cachedRes) {
            return cachedRes;
          }
          // Trả về JSON thông báo ngoại tuyến thân thiện, tránh sập giao diện
          return new Response(
            JSON.stringify({
              offline: true,
              success: false,
              message: 'Thiết bị đang ở chế độ ngoại tuyến (Offline). Dữ liệu hiện tại được nạp từ bộ nhớ tạm.'
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json; charset=utf-8' }
            }
          );
        })
    );
    return;
  }

  // B. CHIẾN LƯỢC CHO APP SHELL & TÀI NGUYÊN TĨNH: Stale-While-Revalidate
  // Giúp mở ứng dụng trong vòng dưới 1 giây (đạt tiêu chí chấp nhận T-54)
  event.respondWith(
    caches.match(req).then((cachedResponse) => {
      const fetchPromise = fetch(req)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(req, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          // Nếu không có mạng và là trang điều hướng (navigate)
          if (req.mode === 'navigate') {
            const offlinePage = await caches.match('/offline.html');
            if (offlinePage) return offlinePage;
          }
          return null;
        });

      // Nếu có sẵn trong cache, trả về NGAY LẬP TỨC (đảm bảo tốc độ mở dưới 1 giây)
      if (cachedResponse) {
        return cachedResponse;
      }

      // Nếu chưa có trong cache, đợi mạng tải về
      return fetchPromise.then((res) => {
        if (res) return res;
        if (req.mode === 'navigate') {
          return caches.match('/offline.html');
        }
        return new Response('Tài nguyên không khả dụng ngoại tuyến', { status: 503 });
      });
    })
  );
});

/**
 * 4. Sự kiện MESSAGE: Cho phép giao diện kích hoạt cập nhật ngay
 */
self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data.type === 'GET_VERSION') {
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({
        version: CACHE_VERSION,
        cacheName: CACHE_NAME
      });
    }
  }

  if (event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ success: true });
      }
    });
  }
});
