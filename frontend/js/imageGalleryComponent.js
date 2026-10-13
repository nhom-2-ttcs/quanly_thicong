(function (root, factory) {
  'use strict';

  const component = factory(root);
  root.ImageGalleryComponent = component;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = component;
  }
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const STYLE_ID = 'journal-image-gallery-style';

  function injectStyles() {
    if (root.document.getElementById(STYLE_ID)) return;

    const style = root.document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .journal-image-gallery {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: 10px;
      }
      .journal-image-gallery__item {
        display: block;
        overflow: hidden;
        aspect-ratio: 1;
        padding: 0;
        border: 0;
        border-radius: 8px;
        background: #f1f5f9;
        cursor: zoom-in;
      }
      .journal-image-gallery__thumbnail {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .journal-image-gallery__lightbox[hidden] { display: none; }
      .journal-image-gallery__lightbox {
        position: fixed;
        z-index: 10000;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 48px 16px 16px;
        background: rgba(0, 0, 0, 0.88);
      }
      .journal-image-gallery__full {
        max-width: min(100%, 1400px);
        max-height: 100%;
        object-fit: contain;
      }
      .journal-image-gallery__close {
        position: absolute;
        top: 12px;
        right: 16px;
        border: 0;
        background: transparent;
        color: #fff;
        font: 32px/1 system-ui, sans-serif;
        cursor: pointer;
      }
      .journal-image-gallery__status {
        color: #fff;
        font: 15px/1.5 system-ui, sans-serif;
      }
    `;
    root.document.head.appendChild(style);
  }

  function render(container, images) {
    if (!root.document || !container || !container.appendChild) {
      throw new TypeError('Cần truyền phần tử DOM để hiển thị thư viện ảnh.');
    }
    if (!Array.isArray(images)) {
      throw new TypeError('Danh sách ảnh phải là một mảng.');
    }

    injectStyles();
    const gallery = root.document.createElement('div');
    gallery.className = 'journal-image-gallery';
    gallery.setAttribute('aria-label', 'Ảnh trong nhật ký');

    const lightbox = root.document.createElement('div');
    lightbox.className = 'journal-image-gallery__lightbox';
    lightbox.hidden = true;
    lightbox.setAttribute('role', 'dialog');
    lightbox.setAttribute('aria-modal', 'true');
    lightbox.setAttribute('aria-label', 'Ảnh phóng to');

    const closeButton = root.document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'journal-image-gallery__close';
    closeButton.setAttribute('aria-label', 'Đóng ảnh');
    closeButton.textContent = '×';

    const fullImage = root.document.createElement('img');
    fullImage.className = 'journal-image-gallery__full';
    fullImage.alt = '';
    fullImage.hidden = true;

    const status = root.document.createElement('p');
    status.className = 'journal-image-gallery__status';
    status.setAttribute('role', 'status');
    status.hidden = true;

    function closeLightbox() {
      lightbox.hidden = true;
      fullImage.removeAttribute('src');
      fullImage.hidden = true;
      status.hidden = true;
    }

    function openImage(image) {
      fullImage.removeAttribute('src');
      fullImage.alt = image.alt || 'Ảnh nhật ký';
      fullImage.hidden = true;
      status.textContent = 'Đang tải ảnh...';
      status.hidden = false;
      lightbox.hidden = false;
      closeButton.focus();

      fullImage.onload = () => {
        status.hidden = true;
        fullImage.hidden = false;
      };
      fullImage.onerror = () => {
        status.textContent = 'Không tải được ảnh gốc. Vui lòng thử lại.';
        status.hidden = false;
      };

      fullImage.src = image.originalUrl;
    }

    images.forEach(image => {
      if (!image || typeof image.thumbnailUrl !== 'string' ||
          typeof image.originalUrl !== 'string') {
        throw new TypeError('Mỗi ảnh cần có thumbnailUrl và originalUrl.');
      }

      const button = root.document.createElement('button');
      button.type = 'button';
      button.className = 'journal-image-gallery__item';
      button.setAttribute('aria-label', `Phóng to ${image.alt || 'ảnh nhật ký'}`);

      const thumbnail = root.document.createElement('img');
      thumbnail.className = 'journal-image-gallery__thumbnail';
      thumbnail.src = image.thumbnailUrl;
      thumbnail.alt = image.alt || 'Ảnh nhật ký';
      thumbnail.loading = 'lazy';
      thumbnail.decoding = 'async';

      button.appendChild(thumbnail);
      button.addEventListener('click', () => openImage(image));
      gallery.appendChild(button);
    });

    lightbox.appendChild(closeButton);
    lightbox.appendChild(fullImage);
    lightbox.appendChild(status);
    closeButton.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', event => {
      if (event.target === lightbox) closeLightbox();
    });
    lightbox.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeLightbox();
    });

    container.replaceChildren(gallery, lightbox);
    return {
      element: gallery,
      destroy() {
        container.replaceChildren();
      }
    };
  }

  return { render };
}));
