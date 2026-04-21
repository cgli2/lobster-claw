/* eslint-disable no-unused-vars, no-undef */
const TabService = {
  _pollTimer: null,
  _progressListener: null,
  _isOperating: false,

  async render(container) {
    container.innerHTML = `
      <h2>${TEXT.SERVICE_TITLE}</h2>

      <!-- 服务状态 + 操作按钮 -->
      <div class="card" style="margin-bottom: 16px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div>
            <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 4px;">${TEXT.SERVICE_STATUS}</div>
            <div style="font-size: 20px; font-weight: 700;">
              <span class="status-indicator">
                <span class="status-dot stopped" id="svc-status-dot"></span>
                <span id="svc-status-text">${TEXT.STATUS_UNKNOWN}</span>
              </span>
            </div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-success" id="svc-start-btn">${TEXT.SERVICE_START}</button>
            <button class="btn btn-danger" id="svc-stop-btn">${TEXT.SERVICE_STOP}</button>
            <button class="btn" id="svc-restart-btn">${TEXT.SERVICE_RESTART}</button>
          </div>
        </div>
        <!-- 进度条区域 -->
        <div id="svc-progress-container" class="hidden" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-color);">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="spinner" id="svc-spinner" style="width: 20px; height: 20px; border-width: 2px;"></div>
            <div style="flex: 1;">
              <div id="svc-progress-text" style="font-size: 13px; color: var(--text-muted); margin-bottom: 4px;">正在启动...</div>
              <div class="progress-bar" style="height: 4px; background: var(--border-color); border-radius: 2px; overflow: hidden;">
                <div id="svc-progress-bar" style="height: 100%; background: var(--primary); width: 0%; transition: width 0.3s;"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 开机自启开关 -->
      <div class="card" style="margin-bottom: 16px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div>
            <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">随系统自动启动</div>
            <div style="font-size: 12px; color: var(--text-muted);" id="svc-autostart-desc">
              开启后，系统登录时将自动启动 Gateway 服务
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <span id="svc-autostart-badge" style="
              font-size: 11px;
              padding: 2px 8px;
              border-radius: 10px;
              background: var(--border-color);
              color: var(--text-muted);
            ">检测中...</span>
            <!-- Toggle Switch -->
            <label class="svc-toggle" style="position: relative; display: inline-block; width: 44px; height: 24px; cursor: pointer;">
              <input type="checkbox" id="svc-autostart-toggle" style="opacity:0;width:0;height:0;">
              <span class="svc-toggle-slider" style="
                position: absolute; inset: 0;
                background: var(--border-color);
                border-radius: 24px;
                transition: background 0.25s;
              ">
                <span style="
                  position: absolute; left: 3px; top: 3px;
                  width: 18px; height: 18px;
                  background: #fff;
                  border-radius: 50%;
                  transition: transform 0.25s;
                  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
                  display: block;
                " id="svc-toggle-knob"></span>
              </span>
            </label>
          </div>
        </div>
        <!-- 任务不存在时的提示 -->
        <div id="svc-autostart-warn" class="hidden" style="
          margin-top: 10px;
          padding: 8px 12px;
          background: var(--warning-bg, #fff3cd);
          border: 1px solid var(--warning-border, #ffc107);
          border-radius: 6px;
          font-size: 12px;
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        ">
          <span>尚未设置开机自启计划任务，点击右侧按钮可一键完成设置。</span>
          <button class="btn btn-sm" id="svc-install-autostart-btn" style="white-space:nowrap;flex-shrink:0;">一键设置自启</button>
        </div>
      </div>

      <!-- 操作日志 -->
      <div class="section">
        <h3>操作日志</h3>
        <div class="log-viewer" id="svc-log" style="max-height: 300px; min-height: 100px;"></div>
      </div>
    `;

    // 注入 toggle 样式（只注入一次）
    if (!document.getElementById('svc-toggle-style')) {
      const style = document.createElement('style');
      style.id = 'svc-toggle-style';
      style.textContent = `
        #svc-autostart-toggle:checked + .svc-toggle-slider {
          background: var(--primary, #6366f1) !important;
        }
        #svc-autostart-toggle:checked + .svc-toggle-slider #svc-toggle-knob {
          transform: translateX(20px);
        }
        .svc-toggle { user-select: none; }
        .svc-toggle:hover .svc-toggle-slider { filter: brightness(1.1); }
      `;
      document.head.appendChild(style);
    }

    $('#svc-start-btn').addEventListener('click', () => this._doAction('start'));
    $('#svc-stop-btn').addEventListener('click', () => this._doAction('stop'));
    $('#svc-restart-btn').addEventListener('click', () => this._doAction('restart'));

    // 开关事件
    $('#svc-autostart-toggle').addEventListener('change', (e) => {
      this._setAutostartToggle(e.target.checked);
    });

    // 一键安装自启计划任务
    document.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'svc-install-autostart-btn') {
        this._installAutostart();
      }
    });

    // 监听服务操作进度
    this._progressListener = window.openclawAPI.service.onServiceProgress(
      (progress) => { this._updateProgress(progress); }
    );

    // 初始状态
    this._refreshStatus();
    this._refreshAutostart();
    this._startPoll();
  },

  async activate() {
    this._startPoll();
    await this._refreshStatus();
    await this._refreshAutostart();
  },

  _updateProgress(progress) {
    const container = $('#svc-progress-container');
    const bar = $('#svc-progress-bar');
    const text = $('#svc-progress-text');
    if (container && bar && text) {
      container.classList.remove('hidden');
      bar.style.width = progress.percent + '%';
      text.textContent = progress.message || '正在处理...';
      if (progress.percent >= 100 || progress.step === 'done') {
        setTimeout(() => { container.classList.add('hidden'); }, 3000);
      }
    }
  },

  _setButtonsDisabled(disabled) {
    this._isOperating = disabled;
    ['svc-start-btn', 'svc-stop-btn', 'svc-restart-btn'].forEach(id => {
      const btn = $(`#${id}`);
      if (btn) {
        btn.disabled = disabled;
        btn.style.opacity = disabled ? '0.5' : '1';
      }
    });
  },

  async _refreshStatus() {
    try {
      const status = await window.openclawAPI.service.getStatus();
      const dot = $('#svc-status-dot');
      const text = $('#svc-status-text');
      if (dot && text) {
        if (!status.installed) {
          dot.className = 'status-dot stopped';
          text.textContent = '未安装';
        } else if (status.running) {
          dot.className = 'status-dot running';
          text.textContent = TEXT.STATUS_RUNNING;
        } else {
          dot.className = 'status-dot stopped';
          text.textContent = TEXT.STATUS_STOPPED;
        }
      }
    } catch (err) {
      console.error('Failed to get service status:', err);
      const text = $('#svc-status-text');
      if (text) text.textContent = TEXT.STATUS_UNKNOWN;
    }
  },

  // ── 一键安装开机自启 ──────────────────────────

  async _installAutostart() {
    const btn = document.getElementById('svc-install-autostart-btn');
    const log = $('#svc-log');
    const ts = new Date().toLocaleTimeString();

    if (btn) {
      btn.disabled = true;
      btn.textContent = '安装中...';
    }

    try {
      const result = await window.openclawAPI.service.installAutostart();
      if (result.success) {
        Toast.success(result.message);
        this._appendLog(log, `[${ts}] ${result.message}`, 'log-info');
        // 刷新状态，成功后提示栏会消失
        await this._refreshAutostart();
      } else {
        Toast.error(result.message);
        this._appendLog(log, `[${ts}] 失败：${result.message}`, 'log-error');
        if (btn) { btn.disabled = false; btn.textContent = '一键设置自启'; }
      }
    } catch (e) {
      Toast.error('安装失败：' + e.message);
      this._appendLog(log, `[${ts}] 错误：${e.message}`, 'log-error');
      if (btn) { btn.disabled = false; btn.textContent = '一键设置自启'; }
    }
  },

  // ── 开机自启 ──────────────────────────────────

  async _refreshAutostart() {
    const toggle = $('#svc-autostart-toggle');
    const badge = $('#svc-autostart-badge');
    const warn = $('#svc-autostart-warn');
    if (!toggle) return;

    try {
      const result = await window.openclawAPI.service.getAutostart();

      if (!result.taskExists) {
        // 计划任务不存在
        toggle.disabled = true;
        toggle.checked = false;
        this._syncToggleVisual(false);
        if (badge) {
          badge.textContent = '未安装';
          badge.style.background = 'var(--warning-bg, #fff3cd)';
          badge.style.color = '#856404';
        }
        if (warn) warn.classList.remove('hidden');
      } else {
        toggle.disabled = false;
        toggle.checked = result.enabled;
        this._syncToggleVisual(result.enabled);
        if (badge) {
          badge.textContent = result.enabled ? '已启用' : '已禁用';
          badge.style.background = result.enabled
            ? 'rgba(99,102,241,0.15)'
            : 'var(--border-color)';
          badge.style.color = result.enabled
            ? 'var(--primary, #6366f1)'
            : 'var(--text-muted)';
        }
        if (warn) warn.classList.add('hidden');
      }
    } catch (e) {
      console.error('Failed to get autostart:', e);
      if (badge) badge.textContent = '获取失败';
    }
  },

  // 把 CSS 动画和 JS 状态同步（处理 :checked 伪类 vs 直接赋值的问题）
  _syncToggleVisual(enabled) {
    const toggle = $('#svc-autostart-toggle');
    const slider = toggle ? toggle.nextElementSibling : null;
    const knob = $('#svc-toggle-knob');
    if (!slider || !knob) return;
    if (enabled) {
      slider.style.background = 'var(--primary, #6366f1)';
      knob.style.transform = 'translateX(20px)';
    } else {
      slider.style.background = 'var(--border-color)';
      knob.style.transform = 'translateX(0)';
    }
  },

  async _setAutostartToggle(enable) {
    const toggle = $('#svc-autostart-toggle');
    const badge = $('#svc-autostart-badge');
    const log = $('#svc-log');
    const ts = new Date().toLocaleTimeString();

    // 立即在视觉上同步（先行更新，失败再回退）
    this._syncToggleVisual(enable);
    if (toggle) toggle.disabled = true;
    if (badge) {
      badge.textContent = '更新中...';
      badge.style.background = 'var(--border-color)';
      badge.style.color = 'var(--text-muted)';
    }

    try {
      const result = await window.openclawAPI.service.setAutostart(enable);
      if (result.success) {
        Toast.success(result.message);
        this._appendLog(log, `[${ts}] ${result.message}`, 'log-info');
      } else {
        Toast.error(result.message);
        this._appendLog(log, `[${ts}] 失败：${result.message}`, 'log-error');
        // 回退视觉状态
        this._syncToggleVisual(!enable);
        if (toggle) toggle.checked = !enable;
      }
    } catch (e) {
      Toast.error('操作失败：' + e.message);
      this._appendLog(log, `[${ts}] 错误：${e.message}`, 'log-error');
      this._syncToggleVisual(!enable);
      if (toggle) toggle.checked = !enable;
    } finally {
      if (toggle) toggle.disabled = false;
      // 刷新一次以获取真实状态
      await this._refreshAutostart();
    }
  },

  // ── 服务操作 ──────────────────────────────────

  async _doAction(action) {
    if (this._isOperating) {
      Toast.warning('请等待当前操作完成');
      return;
    }

    const log = $('#svc-log');
    const timestamp = new Date().toLocaleTimeString();
    const progressContainer = $('#svc-progress-container');
    const progressBar = $('#svc-progress-bar');
    const progressText = $('#svc-progress-text');

    if (progressContainer) progressContainer.classList.remove('hidden');
    if (progressBar) progressBar.style.width = '0%';
    if (progressText) {
      progressText.textContent = `正在${action === 'start' ? '启动' : action === 'stop' ? '停止' : '重启'}...`;
    }

    this._setButtonsDisabled(true);
    this._appendLog(log, `[${timestamp}] 执行: ${action}...`);

    try {
      let result;
      switch (action) {
        case 'start':   result = await window.openclawAPI.service.start(); break;
        case 'stop':    result = await window.openclawAPI.service.stop(); break;
        case 'restart': result = await window.openclawAPI.service.restart(); break;
      }

      const ts2 = new Date().toLocaleTimeString();
      if (result.success) {
        this._appendLog(log, `[${ts2}] ${action} 成功`, 'log-info');
        Toast.success(`${action} 成功`);
        if (progressBar) progressBar.style.width = '100%';
        if (progressText) progressText.textContent = '操作完成';
      } else {
        this._appendLog(log, `[${ts2}] ${action} 失败: ${result.output}`, 'log-error');
        Toast.error(`${action} 失败`);
        if (progressContainer) progressContainer.classList.add('hidden');
      }

      if (result.output) this._appendLog(log, result.output);
    } catch (err) {
      this._appendLog(log, `错误: ${err.message}`, 'log-error');
      Toast.error(`操作失败: ${err.message}`);
      if (progressContainer) progressContainer.classList.add('hidden');
    } finally {
      this._setButtonsDisabled(false);
    }

    setTimeout(() => {
      if (progressContainer) progressContainer.classList.add('hidden');
    }, 3000);

    // ★ 启动/重启后进行延迟多次验证，确保 UI 显示最终真实状态
    if (action === 'start' || action === 'restart') {
      // 连续刷新 3 次（间隔 1.5 秒），覆盖 Gateway 启动初始化窗口期
      for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 1500));
        await this._refreshStatus();
      }
    } else {
      this._refreshStatus();
    }
  },

  _appendLog(container, text, className) {
    if (!container) return;
    const line = createElement('div', { className: className || 'log-info' }, text);
    container.appendChild(line);
    container.scrollTop = container.scrollHeight;
  },

  _startPoll() {
    this._stopPoll();
    this._pollTimer = setInterval(() => this._refreshStatus(), TIMEOUTS.statusPollInterval);
  },

  _stopPoll() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  cleanup() {
    this._stopPoll();
    if (this._progressListener) {
      this._progressListener();
      this._progressListener = null;
    }
  }
};
