(function (root) {
  'use strict';

  function getTaskName(taskId, taskMap) {
    let value;

    if (Array.isArray(taskMap)) {
      const task = taskMap.find(item => {
        if (!item || typeof item !== 'object') return false;
        const id = item.id ?? item.task_id ?? item.taskId;
        return id !== undefined && String(id) === String(taskId);
      });

      if (task) {
        value = task.name || task.title || task.task_name;
      }
    } else if (taskMap instanceof Map) {
      value = taskMap.get(taskId);
      if (value === undefined) value = taskMap.get(String(taskId));
      if (value === undefined && String(taskId).trim() !== '') {
        const numericId = Number(taskId);
        if (Number.isFinite(numericId)) value = taskMap.get(numericId);
      }
    } else if (taskMap && typeof taskMap === 'object') {
      const key = String(taskId);
      if (Object.prototype.hasOwnProperty.call(taskMap, key)) {
        value = taskMap[key];
      }
    }

    if (value && typeof value === 'object') {
      value = value.name || value.title;
    }

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    return `Công việc #${String(taskId)}`;
  }

  function formatCycleMessage(cycleIds, taskMap) {
    if (!Array.isArray(cycleIds) || cycleIds.length < 2) {
      return 'Không thể lưu quan hệ: phát hiện chu trình phụ thuộc.';
    }

    const links = [];
    for (let index = 0; index < cycleIds.length - 1; index += 1) {
      const from = getTaskName(cycleIds[index], taskMap);
      const to = getTaskName(cycleIds[index + 1], taskMap);

      links.push(index === 0
        ? `Công việc '${from}' đang chờ '${to}'`
        : `'${from}' lại đang chờ '${to}'`);
    }

    return `Không thể lưu quan hệ: ${links.join(', mà ')}`;
  }

  let componentLoad;
  const scriptUrl = root.document && root.document.currentScript
    ? root.document.currentScript.src
    : '';

  function loadAlertComponent() {
    if (root.CycleAlertComponent) {
      return Promise.resolve(root.CycleAlertComponent);
    }

    if (!root.document || !scriptUrl) {
      return Promise.reject(new Error(
        'Không thể nạp cycleAlertComponent.js: hãy tải CycleErrorFormatter từ một thẻ script trong trình duyệt.'
      ));
    }

    if (!componentLoad) {
      componentLoad = new Promise((resolve, reject) => {
        const script = root.document.createElement('script');
        script.src = new URL('cycleAlertComponent.js', scriptUrl).href;
        script.onload = () => {
          if (root.CycleAlertComponent) {
            resolve(root.CycleAlertComponent);
          } else {
            reject(new Error('cycleAlertComponent.js không khởi tạo CycleAlertComponent.'));
          }
        };
        script.onerror = () => {
          componentLoad = null;
          reject(new Error('Không tải được cycleAlertComponent.js.'));
        };
        root.document.head.appendChild(script);
      });
    }

    return componentLoad;
  }

  function show(cycleIds, taskMap, target) {
    const message = formatCycleMessage(cycleIds, taskMap);
    return loadAlertComponent().then(component => component.show(message, target));
  }

  const formatter = { formatCycleMessage, show };
  root.CycleErrorFormatter = formatter;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = formatter;
  }
}(typeof window !== 'undefined' ? window : globalThis));
