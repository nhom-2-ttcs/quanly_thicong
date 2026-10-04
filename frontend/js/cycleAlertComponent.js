(function (root) {
  'use strict';

  const ALERT_ID = 'cycle-detected-alert';
  const STYLE_ID = 'cycle-detected-alert-style';

  function injectStyles() {
    if (root.document.getElementById(STYLE_ID)) return;

    const style = root.document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .cycle-alert {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        margin: 16px 0;
        padding: 14px 16px;
        border: 1px solid #f87171;
        border-left: 5px solid #dc2626;
        border-radius: 8px;
        background: #fef2f2;
        color: #991b1b;
        box-shadow: 0 4px 12px rgba(127, 29, 29, 0.12);
        font: 600 14px/1.5 system-ui, sans-serif;
      }
      .cycle-alert__message { flex: 1; }
      .cycle-alert__dismiss {
        flex: none;
        padding: 0 4px;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: 20px;
        line-height: 1;
        cursor: pointer;
      }
      .cycle-alert__dismiss:focus-visible {
        outline: 2px solid currentColor;
        outline-offset: 2px;
      }
    `;
    root.document.head.appendChild(style);
  }

  function findTarget(target) {
    if (target && typeof target === 'object' && target.nodeType === 1) {
      return target;
    }

    if (typeof target === 'string') {
      const selected = root.document.querySelector(target);
      if (selected) return selected;
    }

    return root.document.querySelector(
      '[data-cycle-alert-target], main, .main-content, form'
    ) || root.document.body;
  }

  function show(message, target) {
    if (!root.document || !root.document.body) {
      throw new Error('Không thể hiển thị cảnh báo chu trình khi DOM chưa sẵn sàng.');
    }

    injectStyles();

    let banner = root.document.getElementById(ALERT_ID);
    if (!banner) {
      banner = root.document.createElement('div');
      banner.id = ALERT_ID;
      banner.className = 'cycle-alert';
      banner.setAttribute('role', 'alert');
      banner.setAttribute('aria-live', 'assertive');

      const text = root.document.createElement('span');
      text.className = 'cycle-alert__message';
      banner.appendChild(text);

      const dismiss = root.document.createElement('button');
      dismiss.className = 'cycle-alert__dismiss';
      dismiss.type = 'button';
      dismiss.setAttribute('aria-label', 'Đóng thông báo');
      dismiss.textContent = '×';
      dismiss.addEventListener('click', () => banner.remove());
      banner.appendChild(dismiss);
    }

    banner.querySelector('.cycle-alert__message').textContent = String(message);

    const anchor = findTarget(target);
    if (anchor === root.document.body) {
      root.document.body.insertBefore(banner, root.document.body.firstChild);
    } else if (anchor.parentNode) {
      anchor.parentNode.insertBefore(banner, anchor);
    } else {
      root.document.body.insertBefore(banner, root.document.body.firstChild);
    }

    return banner;
  }

  function hide() {
    const banner = root.document && root.document.getElementById(ALERT_ID);
    if (banner) banner.remove();
  }

  const component = { show, hide };
  root.CycleAlertComponent = component;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = component;
  }
}(typeof window !== 'undefined' ? window : globalThis));
