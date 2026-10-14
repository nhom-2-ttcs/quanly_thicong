/**
 * Hệ Thống Quản Lý Thi Công - Shared Topbar & Auth Sync
 * Đồng bộ thanh điều hướng Topbar, trạng thái tài khoản đăng nhập & Đăng xuất trên tất cả các trang
 */

(function () {
  'use strict';

  // 1. Đồng bộ thông tin người dùng từ LocalStorage hoặc API /api/auth/me
  async function syncUserProfile() {
    const token = localStorage.getItem('quanly_token');
    let user = null;

    const userStr = localStorage.getItem('quanly_user');
    if (userStr) {
      try {
        user = JSON.parse(userStr);
      } catch (e) {}
    }

    if (!user && token) {
      try {
        const host = window.location.hostname || 'localhost';
        const res = await fetch('/api/auth/me', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.user) {
            user = data.user;
            localStorage.setItem('quanly_user', JSON.stringify(user));
          }
        }
      } catch (e) {}
    }

    const userName = (user && (user.full_name || user.fullName || user.name || user.email)) || 'Nguyễn Quản Trị';
    const userRole = (user && (user.role_display_name || user.role_name || user.role)) || 'Quản trị viên hệ thống';
    const firstLetter = (userName.trim()[0] || 'U').toUpperCase();

    // Cập nhật các ID người dùng xuất hiện trên các trang
    const nameEls = document.querySelectorAll('#display-user-name, #user-name, #user-display-name');
    nameEls.forEach(el => { el.innerText = userName; });

    const roleEls = document.querySelectorAll('#display-user-role, #user-role, #user-display-role');
    roleEls.forEach(el => { el.innerText = String(userRole); });

    const avatarEls = document.querySelectorAll('#avatar-letter, #user-avatar');
    avatarEls.forEach(el => { el.innerText = firstLetter; });

    const userPills = document.querySelectorAll('.user-pill, #user-pill, #user-info-pill');
    userPills.forEach(el => {
      if (el.style.display === 'none') {
        el.style.display = 'inline-flex';
      }
    });
  }

  // 2. Tự động đánh dấu active cho tab hiện tại dựa trên URL
  function highlightActiveNav() {
    const currentPath = window.location.pathname.toLowerCase();
    const navItems = document.querySelectorAll('.nav-dock-item, .nav-dock .nav-item');

    navItems.forEach(item => {
      const href = (item.getAttribute('href') || '').toLowerCase();
      // Chuẩn hóa tên trang
      const isMatch = (
        (currentPath.includes('index') && href.includes('index')) ||
        (currentPath === '/' && href.includes('index')) ||
        (currentPath.includes('wbs') && href.includes('wbs')) ||
        (currentPath.includes('schedule') && href.includes('schedule')) ||
        (currentPath.includes('gantt') && href.includes('gantt')) ||
        (currentPath.includes('calendar') && href.includes('calendar')) ||
        (currentPath.includes('diary') && href.includes('diary')) ||
        (currentPath.includes('teams') && href.includes('teams'))
      );

      if (isMatch) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  // 3. Hàm Đăng Xuất dùng chung
  window.handleLogout = async function () {
    const token = localStorage.getItem('quanly_token');
    if (token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ token })
        });
      } catch (e) {}
    }
    localStorage.removeItem('quanly_token');
    localStorage.removeItem('quanly_user');
    window.location.replace('/login.html');
  };

  // 4. Khởi chạy khi DOM sẵn sàng
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      syncUserProfile();
      highlightActiveNav();
    });
  } else {
    syncUserProfile();
    highlightActiveNav();
  }
})();
