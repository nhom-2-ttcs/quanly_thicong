/**
 * Hệ Thống Quản Lý Thi Công - Shared Topbar & Auth Sync (Unified Navigation)
 * Đồng bộ thanh điều hướng Topbar, bảo lưu projectId, trạng thái active tab & tài khoản đăng nhập
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

    const nameEls = document.querySelectorAll('#display-user-name, #user-name, #user-display-name');
    nameEls.forEach(el => { el.innerText = userName; });

    const roleEls = document.querySelectorAll('#display-user-role, #user-role, #user-display-role');
    roleEls.forEach(el => { el.innerText = String(userRole); });

    const avatarEls = document.querySelectorAll('#avatar-letter, #user-avatar');
    avatarEls.forEach(el => { el.innerText = firstLetter; });

    const userPills = document.querySelectorAll('.user-pill, #user-pill, #user-info-pill, .user-profile');
    userPills.forEach(el => {
      if (el.style.display === 'none') {
        el.style.display = 'inline-flex';
      }
    });
  }

  // 2. Bảo lưu projectId trên tất cả các liên kết phân hệ
  function syncProjectIdToLinks() {
    const urlParams = new URLSearchParams(window.location.search);
    const rawProjectId = urlParams.get('projectId');
    const pId = Number(rawProjectId);
    const currentProjectId = (Number.isInteger(pId) && pId > 0) ? pId : (rawProjectId ? rawProjectId : null);

    if (!currentProjectId) return;

    const navLinks = document.querySelectorAll('.nav-dock a, .module-nav a');
    navLinks.forEach(link => {
      try {
        const target = new URL(link.href, window.location.origin);
        // Không gắn projectId vào Trang chủ (index.html) để giữ trang chủ ở mức danh sách tổng thể
        if (target.pathname !== '/' && target.pathname !== '/index.html' && target.pathname !== '/login.html') {
          target.searchParams.set('projectId', String(currentProjectId));
          link.href = target.pathname + target.search;
        }
      } catch (e) {}
    });
  }

  // 3. Đánh dấu chính xác duy nhất 1 tiện ích active theo trang hiện tại
  function highlightActiveNav() {
    const currentPath = window.location.pathname.toLowerCase();
    const navItems = document.querySelectorAll('.nav-dock a, .module-nav a');

    navItems.forEach(item => {
      const href = (item.getAttribute('href') || '').toLowerCase();
      const isMatch = (
        (currentPath.endsWith('index.html') || currentPath === '/') && (href.includes('index.html') || href === '/') ||
        (currentPath.includes('wbs.html') && href.includes('wbs.html')) ||
        (currentPath.includes('schedule.html') && href.includes('schedule.html')) ||
        (currentPath.includes('gantt.html') && href.includes('gantt.html')) ||
        (currentPath.includes('calendar.html') && href.includes('calendar.html')) ||
        (currentPath.includes('diary.html') && href.includes('diary.html')) ||
        (currentPath.includes('teams.html') && href.includes('teams.html')) ||
        (currentPath.includes('acceptance.html') && href.includes('acceptance.html')) ||
        (currentPath.includes('payment.html') && href.includes('payment.html')) ||
        (currentPath.includes('budget.html') && href.includes('budget.html')) ||
        (currentPath.includes('progress-summary.html') && href.includes('progress-summary.html')) ||
        (currentPath.includes('audit-logs.html') && href.includes('audit-logs.html'))
      );

      if (isMatch) {
        item.classList.add('active');
        if (item.classList.contains('back-btn')) {
          item.setAttribute('aria-current', 'page');
        }
      } else {
        item.classList.remove('active');
        if (item.classList.contains('back-btn')) {
          item.removeAttribute('aria-current');
        }
      }
    });
  }

  // 4. Hàm Đăng Xuất dùng chung
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

  // 5. Khởi chạy khi DOM sẵn sàng
  function init() {
    syncUserProfile();
    syncProjectIdToLinks();
    highlightActiveNav();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
