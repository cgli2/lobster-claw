/* eslint-disable no-unused-vars, no-undef */
const TabStatus = {
  _uninstallListener: null,
  _pollTimer: null,

  async render(container) {
    container.innerHTML = `
      <h2>${TEXT.STATUS_TITLE}</h2>
      <div class="card-grid" style="margin-bottom: 24px;">
        <div class="stat-card">
          <div class="stat-label">${TEXT.STATUS_OPENCLAW_VERSION}</div>
          <div class="stat-value" id="stat-version">-</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">${TEXT.STATUS_SERVICE_STATUS}</div>
          <div class="stat-value" id="stat-service">
            <span class="status-indicator">
              <span class="status-dot stopped" id="stat-service-dot"></span>
              <span id="stat-service-text">${TEXT.STATUS_UNKNOWN}</span>
            </span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">${TEXT.STATUS_NODE_VERSION}</div>
          <div class="stat-value" id="stat-node">-</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">最新版本</div>
          <div class="stat-value" id="stat-latest">-</div>
        </div>
      </div>
      <div id="not-installed-alert" style="display: none; background: var(--warning-bg, #fff3cd); border: 1px solid var(--warning-border, #ffc107); border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
          <div>
            <strong style="color: var(--warning-text, #856404);">${TEXT.STATUS_NOT_INSTALLED_TITLE}</strong>
            <p style="margin: 4px 0 0; font-size: 13px; color: var(--warning-text, #856404);">${TEXT.STATUS_NOT_INSTALLED_DESC}</p>
          </div>
          <button class="btn btn-primary" id="status-reinstall-btn">${TEXT.STATUS_REINSTALL_BTN}</button>
        </div>
      </div>
      <div class="action-bar">
        <div class="left">
          <button class="btn" id="status-refresh-btn">${TEXT.BTN_REFRESH}</button>
          <button class="btn btn-primary" id="status-update-btn">${TEXT.STATUS_UPDATE_BTN}</button>
          <button class="btn btn-success" id="status-console-btn" title="${TEXT.STATUS_CONSOLE_TOOLTIP}">${TEXT.STATUS_OPEN_CONSOLE}</button>
        </div>
      </div>
      <div class="section">
        <h3>${TEXT.STATUS_DOCTOR_TITLE}</h3>
        <button class="btn" id="status-doctor-btn" style="margin-bottom: 12px;">${TEXT.STATUS_DOCTOR_RUN}</button>
        <div id="doctor-output"></div>
      </div>
      <div id="update-progress" style="display: none; margin-top: 16px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <span>更新进度</span>
          <span id="update-percent">0%</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" id="update-progress-fill" style="width:0%"></div></div>
        <div class="install-terminal" id="update-terminal" style="max-height: 200px; margin-top: 8px;"></div>
      </div>

      <!-- Uninstall Section -->
      <div class="section" style="margin-top: 32px; border-top: 1px solid var(--border); padding-top: 24px;">
        <h3 style="color: var(--danger);">${TEXT.UNINSTALL_TITLE}</h3>
        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 12px;">${TEXT.UNINSTALL_DESC}</p>
        <div id="uninstall-action-area">
          <button class="btn btn-danger" id="uninstall-btn">${TEXT.UNINSTALL_BTN}</button>
        </div>
        <div id="uninstall-confirm-area" style="display: none;">
          <div style="background: rgba(220,53,69,0.08); border: 1px solid var(--danger); border-radius: 8px; padding: 16px; margin-bottom: 12px;">
            <p style="font-size: 13px; color: var(--danger); margin: 0 0 12px;">${TEXT.UNINSTALL_CONFIRM_MSG}</p>
            <ul style="font-size: 12px; color: var(--text-secondary); margin: 0 0 12px; padding-left: 20px; line-height: 1.8;">
              <li>停止并卸载 OpenClaw Gateway 服务</li>
              <li>删除 ~/.openclaw 配置目录及所有配置文件</li>
              <li>卸载 openclaw npm 全局包</li>
            </ul>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-danger" id="uninstall-confirm-btn">${TEXT.UNINSTALL_CONFIRM_BTN}</button>
              <button class="btn" id="uninstall-cancel-btn">${TEXT.BTN_CANCEL}</button>
            </div>
          </div>
        </div>
        <div id="uninstall-progress-area" style="display: none;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
            <span id="uninstall-step-label">${TEXT.UNINSTALL_PROGRESS}</span>
            <span id="uninstall-percent">0%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" id="uninstall-progress-fill" style="width: 0%"></div>
          </div>
          <div class="install-terminal" id="uninstall-terminal" style="max-height: 200px; margin-top: 8px;"></div>
        </div>
      </div>
    `;

    $('#status-refresh-btn').addEventListener('click', () => this._refresh());
    $('#status-doctor-btn').addEventListener('click', () => this._runDoctor());
    $('#status-update-btn').addEventListener('click', () => this._runUpdate());
    $('#status-console-btn').addEventListener('click', () => this._openConsole());
    $('#status-reinstall-btn').addEventListener('click', () => {
      if (typeof AppController !== 'undefined') {
        AppController.switchToWizard();
      }
    });
    $('#uninstall-btn').addEventListener('click', () => this._showUninstallConfirm());
    $('#uninstall-cancel-btn').addEventListener('click', () => this._hideUninstallConfirm());
    $('#uninstall-confirm-btn').addEventListener('click', () => this._doUninstall());

    this._refresh();
    this._startPoll();
  },

  activate() {
    this._startPoll();
    this._refresh();
  },

  _startPoll() {
    this._stopPoll();
    this._pollTimer = setInterval(() => this._refreshServiceStatus(), TIMEOUTS.statusPollInterval);
  },

  _stopPoll() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  _showUninstallConfirm() {
    const actionArea = $('#uninstall-action-area');
    const confirmArea = $('#uninstall-confirm-area');
    if (actionArea) actionArea.style.display = 'none';
    if (confirmArea) confirmArea.style.display = '';
  },

  _hideUninstallConfirm() {
    const actionArea = $('#uninstall-action-area');
    const confirmArea = $('#uninstall-confirm-area');
    if (actionArea) actionArea.style.display = '';
    if (confirmArea) confirmArea.style.display = 'none';
  },

  _doUninstall() {
    const confirmArea = $('#uninstall-confirm-area');
    const progressArea = $('#uninstall-progress-area');
    const terminal = $('#uninstall-terminal');
    const fill = $('#uninstall-progress-fill');
    const percentLabel = $('#uninstall-percent');
    const stepLabel = $('#uninstall-step-label');

    if (confirmArea) confirmArea.style.display = 'none';
    if (progressArea) progressArea.style.display = '';
    if (terminal) clearChildren(terminal);

    // Disable all other action buttons during uninstall
    const btns = ['#status-refresh-btn', '#status-update-btn', '#status-doctor-btn', '#uninstall-btn'];
    btns.forEach(sel => { const b = $(sel); if (b) b.disabled = true; });

    // Remove old listener
    if (this._uninstallListener) {
      this._uninstallListener();
      this._uninstallListener = null;
    }

    this._uninstallListener = window.openclawAPI.install.onUninstallProgress((progress) => {
      if (fill) fill.style.width = progress.percent + '%';
      if (percentLabel) percentLabel.textContent = progress.percent + '%';

      if (progress.message) {
        const cls = progress.step === 'error' ? 'term-error' :
                    progress.step === 'done' ? 'term-success' : '';
        const line = createElement('div', { className: 'term-line ' + cls }, progress.message);
        terminal.appendChild(line);
        terminal.scrollTop = terminal.scrollHeight;
      }

      if (stepLabel) {
        const stepMap = {
          'start': '准备中...',
          'gateway-stop': '停止 Gateway...',
          'gateway-uninstall': '卸载 Gateway 服务...',
          'remove-config': '删除配置目录...',
          'npm-uninstall': '卸载 npm 包...',
          'verify': '验证结果...',
          'done': '卸载完成',
          'error': '卸载失败'
        };
        stepLabel.textContent = stepMap[progress.step] || progress.step;
      }

      if (progress.step === 'done') {
        if (this._uninstallListener) { this._uninstallListener(); this._uninstallListener = null; }
        Toast.success(TEXT.UNINSTALL_DONE);
        // 卸载成功后延迟跳转到安装向导，让用户看清最终提示
        setTimeout(() => {
          if (typeof AppController !== 'undefined' && AppController.switchToWizard) {
            AppController.switchToWizard();
          } else {
            // 兜底：刷新状态面板并显示重新安装提示
            this._refresh();
          }
        }, 1500);
      } else if (progress.step === 'error') {
        if (this._uninstallListener) { this._uninstallListener(); this._uninstallListener = null; }
        Toast.error(TEXT.UNINSTALL_FAIL + ': ' + progress.message);
        btns.forEach(sel => { const b = $(sel); if (b) b.disabled = false; });
      }
    });

    window.openclawAPI.install.uninstall();
  },

  async _refresh() {
    const alert = $('#not-installed-alert');
    const updateBtn = $('#status-update-btn');
    const consoleBtn = $('#status-console-btn');
    const doctorBtn = $('#status-doctor-btn');
    const uninstallBtn = $('#uninstall-btn');
    const uninstallActionArea = $('#uninstall-action-area');

    let isInstalled = false;

    try {
      // 先获取执行模式，确保使用正确的模式检测版本
      const mode = await window.openclawAPI.deps.getExecutionMode();
      console.log('Status check - Execution mode:', mode);
      
      const version = await window.openclawAPI.install.getVersion();
      const versionEl = $('#stat-version');
      // 只接受有效的版本号格式，避免显示乱码或错误信息
      if (version && typeof version === 'string' && /^\d+\.\d+\.\d+/.test(version)) {
        versionEl.textContent = 'v' + version;
        isInstalled = true;
      } else {
        versionEl.textContent = '未安装';
      }

      const info = await window.openclawAPI.utils.getPlatformInfo();
      $('#stat-node').textContent = info.nodeVersion || '-';
    } catch (err) {
      const versionEl = $('#stat-version');
      if (versionEl) versionEl.textContent = '获取失败';
      console.error('Status check failed:', err);
    }

    try {
      const status = await window.openclawAPI.service.getStatus();
      const dot = $('#stat-service-dot');
      const text = $('#stat-service-text');

      if (!status.installed) {
        dot.className = 'status-dot stopped';
        text.textContent = '未安装';
        isInstalled = false;
      } else if (status.running) {
        dot.className = 'status-dot running';
        text.textContent = TEXT.STATUS_RUNNING;
      } else {
        dot.className = 'status-dot stopped';
        text.textContent = TEXT.STATUS_STOPPED;
      }
    } catch (err) {
      console.error('Failed to get service status:', err);
      const text = $('#stat-service-text');
      if (text) text.textContent = TEXT.STATUS_UNKNOWN;
    }

    // Show/hide reinstall alert based on install status
    if (alert) {
      alert.style.display = isInstalled ? 'none' : 'block';
    }
    if (updateBtn) {
      updateBtn.disabled = !isInstalled;
    }
    if (consoleBtn) {
      consoleBtn.disabled = !isInstalled;
    }
    if (doctorBtn) {
      doctorBtn.disabled = !isInstalled;
    }
    if (uninstallBtn) {
      uninstallBtn.disabled = !isInstalled;
    }
    // Show/hide uninstall action area and reset confirm
    if (uninstallActionArea) {
      uninstallActionArea.style.display = isInstalled ? '' : 'none';
    }
    this._hideUninstallConfirm();

    // Check latest version in background
    try {
      const latestEl = $('#stat-latest');
      latestEl.textContent = '检查中...';
      latestEl.textContent = '-';
    } catch {}
  },

  /** 只刷新服务状态 dot/text，供定时轮询使用 */
  async _refreshServiceStatus() {
    try {
      const status = await window.openclawAPI.service.getStatus();
      const dot = $('#stat-service-dot');
      const text = $('#stat-service-text');
      if (!dot || !text) return;

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
    } catch (err) {
      console.error('Failed to poll service status:', err);
    }
  },

  async _runDoctor() {
    const output = $('#doctor-output');
    output.innerHTML = '<div style="padding: 12px;"><div class="spinner spinner-lg" style="margin: 0 auto;"></div><p style="text-align:center; color:var(--text-secondary); margin-top:10px;">正在运行诊断检查...</p></div>';

    try {
      const result = await window.openclawAPI.doctor.validateAndFix();
      output.innerHTML = this._renderValidateResult(result);
    } catch (err) {
      output.innerHTML = `<p style="color: var(--danger); padding:12px;">诊断失败: ${this._escapeHtml(err.message)}</p>`;
    }
  },

  /**
   * 将 validateAndFix 的结果渲染为 HTML（分步展示每条命令的输出）
   */
  _renderValidateResult(result) {
    if (!result || !result.steps) {
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return `<pre class="doctor-output">${this._escapeHtml(this._stripAnsi(text))}</pre>`;
    }

    const stepIcons = { true: '✅', false: '❌' };
    const stepsHtml = result.steps.map(step => {
      const icon = stepIcons[String(step.success)] || '⚠️';
      const color = step.success ? 'var(--success)' : 'var(--danger)';
      const outputText = this._escapeHtml(this._stripAnsi(step.output || ''));
      return `
        <div style="margin-bottom: 16px;">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
            <span>${icon}</span>
            <code style="font-size:13px; color:${color}; font-weight:600;">${this._escapeHtml(step.name)}</code>
          </div>
          <pre class="doctor-output" style="margin:0; font-size:12px; max-height:240px; overflow-y:auto;">${outputText}</pre>
        </div>`;
    }).join('');

    const overallIcon = result.overallSuccess ? '✅' : (result.fixRan ? '🔧' : '❌');
    const overallText = result.overallSuccess
      ? '所有检查通过'
      : result.fixRan
        ? '检测到问题，已自动运行 doctor --fix 修复，建议重启 Gateway'
        : '检测到问题（请查看上方详情）';
    const overallColor = result.overallSuccess ? 'var(--success)' : 'var(--warning, #f59e0b)';

    return `
      ${stepsHtml}
      <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:18px;">${overallIcon}</span>
        <span style="color:${overallColor}; font-weight:600;">${overallText}</span>
      </div>`;
  },

  async _openConsole() {
    const btn = $('#status-console-btn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '获取配置...';

    try {
      // 获取网关配置
      const config = await window.openclawAPI.config.read();
      const gateway = config.gateway || {};
      let host = gateway.bind || NETWORK.gatewayBind;
      const port = gateway.port || NETWORK.gatewayPort;
      const token = gateway.auth?.token || '';

      // 处理特殊绑定地址
      // 'loopback' 表示回环地址，'0.0.0.0' 或 '::' 表示所有接口
      if (host === 'loopback' || host === '0.0.0.0' || host === '::' || host === '*') {
        host = NETWORK.gatewayBind;
      }

      // 构建URL - 使用 hash 格式传递 token（#token=xxx）
      // 参考：openclaw dashboard 命令生成的 URL 格式
      const url = `http://${host}:${port}/#token=${encodeURIComponent(token)}`;

      // 打开浏览器
      await window.openclawAPI.utils.openExternal(url);
      btn.textContent = originalText;
    } catch (err) {
      Toast.error('打开控制台失败: ' + err.message);
      btn.textContent = originalText;
    } finally {
      btn.disabled = false;
    }
  },

  _runUpdate() {
    const progressDiv = $('#update-progress');
    const terminal = $('#update-terminal');
    const fill = $('#update-progress-fill');
    const percent = $('#update-percent');

    progressDiv.style.display = 'block';
    clearChildren(terminal);

    const removeListener = window.openclawAPI.install.onInstallProgress((progress) => {
      fill.style.width = progress.percent + '%';
      percent.textContent = progress.percent + '%';

      if (progress.message) {
        const line = createElement('div', { className: 'term-line' }, progress.message);
        terminal.appendChild(line);
        terminal.scrollTop = terminal.scrollHeight;
      }

      if (progress.step === 'done' || progress.step === 'error') {
        removeListener();
        this._refresh();
        if (progress.step === 'done') {
          Toast.success(progress.message || '更新完成');
        } else {
          Toast.error(progress.message || '更新失败');
        }
      }
    });

    window.openclawAPI.install.update();
  },

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  _stripAnsi(text) {
    return text.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '').replace(/\x1B\].*?\x07/g, '');
  },

  cleanup() {
    this._stopPoll();
    if (this._uninstallListener) {
      this._uninstallListener();
      this._uninstallListener = null;
    }
  }
};
