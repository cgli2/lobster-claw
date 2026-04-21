/* eslint-disable no-unused-vars, no-undef */
const TabLogs = {
  _removeListener: null,
  _autoScroll: true,
  _logInfo: null,
  _ctxMenu: null,  // 右键菜单 DOM

  async render(container) {
    container.innerHTML = `
      <h2>${TEXT.LOGS_TITLE}</h2>
      <div class="action-bar">
        <div class="left">
          <label style="font-size: 13px; color: var(--text-secondary);">${TEXT.LOGS_SELECT}:</label>
          <select class="select" id="logs-select" style="width: 180px;">
            <option value="installer">installer-manager.log</option>
            <option value="app">app.log</option>
            <option value="gateway">gateway.log</option>
          </select>
        </div>
        <div class="right">
          <label style="display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-secondary); cursor: pointer;">
            <input type="checkbox" id="logs-autoscroll" checked> ${TEXT.LOGS_AUTO_SCROLL}
          </label>
          <button class="btn btn-sm" id="logs-copy-btn">复制</button>
          <button class="btn btn-sm" id="logs-clear-btn">${TEXT.LOGS_CLEAR}</button>
          <button class="btn btn-sm" id="logs-refresh-btn">${TEXT.BTN_REFRESH}</button>
        </div>
      </div>
      <div class="log-info-bar" id="log-info-bar" style="margin-bottom: 8px; font-size: 12px; color: var(--text-secondary);"></div>
      <div class="log-viewer" id="logs-viewer" style="height: 480px; max-height: none; user-select: text; cursor: text;">${TEXT.LOGS_NO_CONTENT}</div>
    `;

    $('#logs-select').addEventListener('change', () => this._switchLog());
    $('#logs-clear-btn').addEventListener('click', () => { $('#logs-viewer').textContent = ''; });
    $('#logs-refresh-btn').addEventListener('click', () => this._loadLog());
    $('#logs-copy-btn').addEventListener('click', () => this._copyLogs());
    $('#logs-autoscroll').addEventListener('change', (e) => { this._autoScroll = e.target.checked; });

    // 右键菜单
    this._initContextMenu();

    this._loadLog();
  },

  /** 初始化右键上下文菜单 */
  _initContextMenu() {
    // 创建菜单 DOM（单例，挂到 body）
    if (!this._ctxMenu) {
      const menu = document.createElement('div');
      menu.id = 'logs-ctx-menu';
      menu.style.cssText = `
        position: fixed;
        z-index: 9999;
        background: var(--bg-card, #2d2d44);
        border: 1px solid var(--border, #3a3a52);
        border-radius: var(--radius-sm, 4px);
        box-shadow: var(--shadow-lg, 0 4px 16px rgba(0,0,0,0.4));
        padding: 4px 0;
        min-width: 160px;
        display: none;
        user-select: none;
      `;
      menu.innerHTML = `
        <div class="ctx-menu-item" id="ctx-copy-selection" style="
          padding: 7px 14px;
          font-size: 13px;
          cursor: pointer;
          color: var(--text-primary, #e0e0e0);
          display: flex;
          align-items: center;
          gap: 8px;
        ">
          <span>📋</span><span>复制选中内容</span>
          <span style="margin-left:auto;font-size:11px;color:var(--text-muted,#6e6e80);">Ctrl+C</span>
        </div>
        <div style="height:1px;background:var(--border,#3a3a52);margin:3px 0;"></div>
        <div class="ctx-menu-item" id="ctx-copy-all" style="
          padding: 7px 14px;
          font-size: 13px;
          cursor: pointer;
          color: var(--text-primary, #e0e0e0);
          display: flex;
          align-items: center;
          gap: 8px;
        ">
          <span>📄</span><span>复制全部日志</span>
        </div>
        <div class="ctx-menu-item" id="ctx-select-all" style="
          padding: 7px 14px;
          font-size: 13px;
          cursor: pointer;
          color: var(--text-primary, #e0e0e0);
          display: flex;
          align-items: center;
          gap: 8px;
        ">
          <span>✏️</span><span>全选</span>
          <span style="margin-left:auto;font-size:11px;color:var(--text-muted,#6e6e80);">Ctrl+A</span>
        </div>
      `;
      document.body.appendChild(menu);
      this._ctxMenu = menu;

      // 菜单项 hover 效果
      menu.querySelectorAll('.ctx-menu-item').forEach(item => {
        item.addEventListener('mouseenter', () => {
          item.style.background = 'var(--bg-hover, #3a3a55)';
        });
        item.addEventListener('mouseleave', () => {
          item.style.background = '';
        });
      });

      // 点击菜单项
      document.getElementById('ctx-copy-selection').addEventListener('click', () => {
        this._hideContextMenu();
        const selected = window.getSelection().toString();
        if (selected) {
          navigator.clipboard.writeText(selected).then(() => {
            Toast.success('已复制选中内容');
          }).catch(() => Toast.error('复制失败'));
        } else {
          Toast.warning('请先选中要复制的内容');
        }
      });

      document.getElementById('ctx-copy-all').addEventListener('click', () => {
        this._hideContextMenu();
        this._copyLogs();
      });

      document.getElementById('ctx-select-all').addEventListener('click', () => {
        this._hideContextMenu();
        const viewer = document.getElementById('logs-viewer');
        if (viewer) {
          const range = document.createRange();
          range.selectNodeContents(viewer);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
      });

      // 点击其他地方关闭菜单
      document.addEventListener('click', (e) => {
        if (this._ctxMenu && !this._ctxMenu.contains(e.target)) {
          this._hideContextMenu();
        }
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this._hideContextMenu();
      });
    }

    // 绑定 viewer 右键事件（每次 render 后重新绑定）
    const viewer = document.getElementById('logs-viewer');
    if (viewer) {
      viewer.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this._showContextMenu(e.clientX, e.clientY);
      });
    }
  },

  _showContextMenu(x, y) {
    const menu = this._ctxMenu;
    if (!menu) return;

    // 先显示以便获取尺寸
    menu.style.display = 'block';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    // 防止超出视口
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = (x - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = (y - rect.height) + 'px';
    }

    // 根据是否有选中内容动态置灰"复制选中"
    const hasSel = window.getSelection().toString().length > 0;
    const copySelItem = document.getElementById('ctx-copy-selection');
    if (copySelItem) {
      copySelItem.style.opacity = hasSel ? '1' : '0.4';
      copySelItem.style.pointerEvents = hasSel ? '' : 'none';
    }
  },

  _hideContextMenu() {
    if (this._ctxMenu) this._ctxMenu.style.display = 'none';
  },

  async _loadLog() {
    const logType = $('#logs-select').value;
    const viewer = $('#logs-viewer');
    const infoBar = $('#log-info-bar');
    viewer.textContent = '加载中...';

    // Stop previous watcher
    this._stopWatch();

    try {
      // 获取日志信息
      this._logInfo = await window.openclawAPI.logs.getInfo(logType);

      // 更新信息栏
      if (this._logInfo.exists) {
        const sizeKB = (this._logInfo.size / 1024).toFixed(2);
        const modified = this._logInfo.modified ? new Date(this._logInfo.modified).toLocaleString() : '-';
        infoBar.innerHTML = `<span style="margin-right: 16px;">📁 路径: ${this._logInfo.path}</span><span style="margin-right: 16px;">📊 大小: ${sizeKB} KB</span><span>🕐 修改: ${modified}</span>`;
      } else {
        infoBar.innerHTML = `<span style="color: var(--warning);">⚠️ 日志文件不存在</span>`;
      }

      const lines = await window.openclawAPI.logs.read(logType, 500);
      viewer.innerHTML = '';

      if (lines.length === 0) {
        // 显示提示信息
        const desc = this._logInfo.description || '';
        viewer.innerHTML = `
          <div style="color: var(--text-secondary); padding: 20px; text-align: center;">
            <p style="margin-bottom: 8px;">${TEXT.LOGS_NO_CONTENT}</p>
            ${desc ? `<p style="font-size: 12px; color: var(--text-tertiary);">${desc}</p>` : ''}
            <p style="font-size: 12px; color: var(--text-tertiary); margin-top: 8px;">
              日志路径: ${this._logInfo.path}
            </p>
          </div>
        `;
      } else {
        for (const line of lines) {
          this._appendLogLine(viewer, line);
        }
      }
    } catch (err) {
      viewer.textContent = '加载失败: ' + err.message;
    }

    // Start watching for new lines
    this._startWatch(logType);
  },

  _switchLog() {
    this._loadLog();
  },

  _startWatch(logType) {
    this._removeListener = window.openclawAPI.logs.onLogLine((line) => {
      const viewer = $('#logs-viewer');
      if (viewer) {
        this._appendLogLine(viewer, line);
        // Limit lines
        while (viewer.children.length > 1000) {
          viewer.removeChild(viewer.firstChild);
        }
      }
    });

    window.openclawAPI.logs.startWatch(logType);
  },

  _stopWatch() {
    window.openclawAPI.logs.stopWatch();
    if (this._removeListener) {
      this._removeListener();
      this._removeListener = null;
    }
  },

  _appendLogLine(viewer, text) {
    let className = 'log-info';
    if (/\bERROR\b/i.test(text)) className = 'log-error';
    else if (/\bWARN/i.test(text)) className = 'log-warn';
    else if (/\bDEBUG\b/i.test(text)) className = 'log-debug';

    const line = createElement('div', { className }, text);
    viewer.appendChild(line);

    if (this._autoScroll) {
      viewer.scrollTop = viewer.scrollHeight;
    }
  },

  _copyLogs() {
    const viewer = $('#logs-viewer');
    if (!viewer || viewer.textContent === TEXT.LOGS_NO_CONTENT) {
      window.showToast?.('没有可复制的日志内容', 'warning');
      return;
    }

    // 收集所有日志文本
    const lines = [];
    viewer.querySelectorAll('div').forEach(div => {
      lines.push(div.textContent);
    });
    const text = lines.join('\n');

    navigator.clipboard.writeText(text).then(() => {
      window.showToast?.('日志已复制到剪贴板', 'success');
    }).catch(err => {
      console.error('复制失败:', err);
      window.showToast?.('复制失败', 'error');
    });
  },

  cleanup() {
    this._stopWatch();
    this._hideContextMenu();
    if (this._ctxMenu) {
      this._ctxMenu.remove();
      this._ctxMenu = null;
    }
  }
};
