/* eslint-disable no-unused-vars, no-undef */
const StepInstall = {
  _removeListener: null,

  render(container) {
    clearChildren(container);

    const mode = WizardController.getExecutionMode();
    const modeLabel = mode === 'wsl' ? TEXT.WIZARD_INSTALL_MODE_WSL : TEXT.WIZARD_INSTALL_MODE_NATIVE;

    container.innerHTML = `
      <h2>${TEXT.WIZARD_INSTALL_TITLE}</h2>
      <p class="step-desc">${TEXT.WIZARD_INSTALL_DESC}</p>
      <div class="mode-indicator">
        ${TEXT.WIZARD_INSTALL_MODE_LABEL}：${modeLabel}
      </div>
      <div style="margin-bottom: 12px;">
        <div style="display: inline-flex; align-items: center; gap: 8px; margin-bottom: 6px;">
          <label class="toggle">
            <input type="checkbox" id="mirror-toggle" checked>
            <span class="slider"></span>
          </label>
          <span style="font-size: 13px; color: var(--text-secondary); white-space: nowrap;">${TEXT.WIZARD_INSTALL_MIRROR}</span>
        </div>
        <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">${TEXT.WIZARD_INSTALL_MIRROR_DESC}</div>
      </div>
      <div id="install-start-area" style="padding: 16px 0 24px;">
        <div style="text-align: center;">
          <button class="btn btn-primary" id="install-start-btn" style="padding: 10px 36px; font-size: 15px;">${TEXT.WIZARD_INSTALL_START_BTN}</button>
        </div>
      </div>
      <div id="install-progress-area" style="margin-bottom: 12px; display: none;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
          <span id="install-step-label">${TEXT.WIZARD_INSTALL_PROGRESS}</span>
          <span id="install-percent">0%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" id="install-progress-fill" style="width: 0%"></div>
        </div>
      </div>
      <div class="install-terminal" id="install-terminal" style="display: none;"></div>
      <div class="wizard-actions">
        <button class="btn" id="install-prev-btn">${TEXT.BTN_PREV}</button>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-danger" id="install-retry-btn" style="display:none;">${TEXT.WIZARD_INSTALL_RETRY}</button>
          <button class="btn btn-primary" id="install-next-btn" disabled>${TEXT.BTN_NEXT}</button>
        </div>
      </div>
    `;


    $('#install-prev-btn').addEventListener('click', () => WizardController.prev());
    $('#install-next-btn').addEventListener('click', () => WizardController.next());
    $('#install-retry-btn').addEventListener('click', () => this._doInstall());
    $('#install-start-btn').addEventListener('click', () => this._doInstall());
  },

  _doInstall() {
    // Hide start area, show progress + terminal
    const startArea = $('#install-start-area');
    const progressArea = $('#install-progress-area');
    const terminal = $('#install-terminal');
    if (startArea) startArea.style.display = 'none';
    if (progressArea) progressArea.style.display = '';
    if (terminal) terminal.style.display = '';

    // Disable mirror toggle and prev button during install
    const mirrorToggle = $('#mirror-toggle');
    if (mirrorToggle) mirrorToggle.disabled = true;
    const prevBtn = $('#install-prev-btn');
    if (prevBtn) prevBtn.disabled = true;

    const useMirror = mirrorToggle ? mirrorToggle.checked : false;
    this._startInstall(useMirror, null);
  },

  _startInstall(useMirror, installDir) {
    const terminal = $('#install-terminal');
    const progressFill = $('#install-progress-fill');
    const percentLabel = $('#install-percent');
    const stepLabel = $('#install-step-label');
    const retryBtn = $('#install-retry-btn');
    const nextBtn = $('#install-next-btn');

    clearChildren(terminal);
    if (retryBtn) retryBtn.style.display = 'none';
    if (nextBtn) nextBtn.disabled = true;
    if (progressFill) progressFill.style.width = '0%';
    if (percentLabel) percentLabel.textContent = '0%';

    const mode = WizardController.getExecutionMode();
    this._addTermLine(terminal, `> 开始安装 OpenClaw（${mode === 'wsl' ? 'WSL 模式' : 'Windows 原生模式'}）...`, 'term-info');
    if (installDir) {
      this._addTermLine(terminal, `> 安装目录: ${installDir}`, 'term-info');
    }
    if (useMirror) {
      this._addTermLine(terminal, '> 已启用国内镜像源 (npmmirror.com)', 'term-info');
    }

    // Remove old listener if any
    if (this._removeListener) {
      this._removeListener();
    }

    this._removeListener = window.openclawAPI.install.onInstallProgress((progress) => {
      if (progressFill) progressFill.style.width = progress.percent + '%';
      if (percentLabel) percentLabel.textContent = progress.percent + '%';

      if (progress.message) {
        const cls = progress.step === 'error' ? 'term-error' :
                    progress.step === 'done' ? 'term-success' : '';
        this._addTermLine(terminal, progress.message, cls);
      }

      if (progress.step === 'done') {
        // 安装完成后验证版本，确保真正安装成功
        this._addTermLine(terminal, '> 正在验证安装结果...', 'term-info');
        // 先获取当前执行模式，确保验证使用正确的模式
        window.openclawAPI.deps.getExecutionMode().then(mode => {
          this._addTermLine(terminal, `> 当前执行模式: ${mode}`, 'term-info');
          return window.openclawAPI.install.getVersion();
        }).then(version => {
          if (version) {
            if (nextBtn) nextBtn.disabled = false;
            if (stepLabel) stepLabel.textContent = '安装完成';
            this._addTermLine(terminal, `> 安装成功！版本: v${version}`, 'term-success');
          } else {
            if (stepLabel) stepLabel.textContent = '安装验证失败';
            this._addTermLine(terminal, '> 安装验证失败: 无法获取版本号', 'term-error');
            this._addTermLine(terminal, '> 可能安装未成功完成，请查看上方日志', 'term-error');
            if (retryBtn) retryBtn.style.display = '';
          }
        }).catch(err => {
          if (stepLabel) stepLabel.textContent = '验证出错';
          this._addTermLine(terminal, '> 验证过程出错: ' + err.message, 'term-error');
          if (retryBtn) retryBtn.style.display = '';
        });
      } else if (progress.step === 'error') {
        if (retryBtn) retryBtn.style.display = '';
        if (stepLabel) stepLabel.textContent = '安装失败';
        this._addTermLine(terminal, '> 安装失败: ' + progress.message, 'term-error');
        const prevBtn = $('#install-prev-btn');
        if (prevBtn) prevBtn.disabled = false;
      } else {
        if (stepLabel) stepLabel.textContent = this._getStepText(progress.step);
      }
    });

    window.openclawAPI.install.run({ useMirror, installDir });
  },

  _addTermLine(terminal, text, className) {
    if (!terminal) return;
    const line = createElement('div', { className: 'term-line ' + (className || '') }, text);
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
  },

  _getStepText(step) {
    const map = {
      'start': '准备中...',
      'mirror': '设置镜像源...',
      'npm-install': '安装 npm 包...',
      'config-dir': '创建配置目录...',
      'gateway-start': '启动 Gateway 服务...',
      'verify': '验证安装...',
      'done': '安装完成',
      'error': '安装失败'
    };
    return map[step] || step;
  },

  cleanup() {
    if (this._removeListener) {
      this._removeListener();
      this._removeListener = null;
    }
  }
};
