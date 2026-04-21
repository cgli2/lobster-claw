/* eslint-disable no-unused-vars, no-undef */

/**
 * StepCheck - 安装向导依赖检测步骤
 * 
 * 功能：
 * 1. 选择运行模式（Native 默认 / WSL）
 * 2. 检测系统已安装的依赖
 * 3. 自动安装缺失的依赖
 */
const StepCheck = {
  _checkResult: null,
  _selectedMode: null,
  _modeDepResult: null,
  _installing: false,
  _progressListeners: [],

  async render(container) {
    clearChildren(container);

    container.innerHTML = `
      <h2>${TEXT.WIZARD_CHECK_TITLE}</h2>
      <p class="step-desc">${TEXT.WIZARD_CHECK_DESC}</p>
      <div id="check-sections"></div>
      <div class="wizard-actions">
        <button class="btn" id="check-prev-btn">${TEXT.BTN_PREV}</button>
        <div style="display:flex; gap:8px;">
          <button class="btn" id="check-recheck-btn">${TEXT.WIZARD_CHECK_RECHECK}</button>
          <button class="btn btn-primary" id="check-next-btn" disabled>${TEXT.BTN_NEXT}</button>
        </div>
      </div>
    `;

    $('#check-prev-btn').addEventListener('click', () => WizardController.prev());
    $('#check-recheck-btn').addEventListener('click', () => this._runFullCheck());
    $('#check-next-btn').addEventListener('click', () => this._proceedNext());

    await this._runFullCheck();
  },

  async _runFullCheck() {
    const sections = $('#check-sections');
    sections.innerHTML = `
      <div class="check-section">
        <div class="dep-check-item">
          <div class="dep-check-icon"><div class="spinner"></div></div>
          <div class="dep-check-info">
            <div class="dep-check-name">${TEXT.WIZARD_CHECK_CHECKING}</div>
          </div>
        </div>
      </div>
    `;
    this._selectedMode = null;
    this._modeDepResult = null;
    this._updateNextBtn();

    try {
      console.log('[StepCheck] Calling deps.checkAll()...');
      const result = await window.openclawAPI.deps.checkAll();
      console.log('[StepCheck] checkAll result:', result);
      this._checkResult = result;
      this._renderSections(result);
    } catch (err) {
      console.error('[StepCheck] checkAll error:', err);
      sections.innerHTML = `
        <div class="check-section">
          <div class="dep-check-item">
            <div class="dep-check-icon fail">!</div>
            <div class="dep-check-info">
              <div class="dep-check-name">检测失败</div>
              <div class="dep-check-detail">${err.message}</div>
            </div>
          </div>
        </div>
      `;
    }
  },

  _renderSections(result) {
    const sections = $('#check-sections');
    clearChildren(sections);

    // Section 1: 模式选择（原生为默认，WSL 内嵌安装入口）
    this._renderModeSelector(sections, result.wsl);

    // Section 2: 模式依赖检测（选模式后显示）
    const depsSection = createElement('div', { className: 'check-section', id: 'mode-deps-section' });
    sections.appendChild(depsSection);

    // 默认选中"原生"模式
    this._selectMode('native');
  },

  _renderModeSelector(parent, wsl) {
    const section = createElement('div', { className: 'check-section' });
    const wslAvailable = wsl.installed && wsl.distros.length > 0;
    const wslExeExists = wsl.wslExeExists || false;

    // WSL 状态描述文字
    let wslStatusHtml = '';
    if (wslAvailable) {
      const distroList = wsl.distros.map(d =>
        `<li>${d.name} (WSL${d.version !== 'unknown' ? d.version : ''}) - ${d.state}</li>`
      ).join('');
      wslStatusHtml = `
        <div class="wsl-mode-status status-ok">
          <span style="color: var(--success);">&#10003; ${TEXT.WSL_INSTALLED.replace('{version}', wsl.version || '')}</span>
          <ul class="wsl-distro-list" style="margin: 4px 0 0 0;">${distroList}</ul>
        </div>
      `;
    } else {
      // WSL 未安装或没有发行版，显示安装按钮（隐藏，只在选 WSL 模式时才出现）
      const wslStatusText = wslExeExists
        ? `<span style="color: var(--warning);">&#9888; ${TEXT.WSL_NO_DISTRO}</span>`
        : `<span style="color: var(--text-muted);">&#10007; ${TEXT.WSL_NOT_INSTALLED}</span>`;

      wslStatusHtml = `
        <div class="wsl-mode-status status-missing" id="wsl-install-area" style="display:none;">
          <div style="margin-bottom: 8px; font-size: 13px;">${wslStatusText}</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">${TEXT.WSL_NOT_INSTALLED_DESC}</div>
          <button class="btn btn-sm" id="install-wsl-btn">${TEXT.WSL_INSTALL_BTN}</button>
        </div>
      `;
    }

    section.innerHTML = `
      <div class="check-section-title">
        <span class="section-icon">1</span>
        ${TEXT.MODE_SECTION_TITLE}
      </div>
      <div class="mode-selector">
        <div class="mode-option" id="mode-native" data-mode="native">
          <div class="mode-option-header">
            <div class="mode-radio"></div>
            <span class="mode-option-title">${TEXT.MODE_NATIVE_TITLE}</span>
          </div>
          <div class="mode-option-desc">${TEXT.MODE_NATIVE_DESC}</div>
        </div>
        <div class="mode-option ${wslAvailable ? '' : ''}" id="mode-wsl" data-mode="wsl">
          <div class="mode-option-header">
            <div class="mode-radio"></div>
            <span class="mode-option-title">${TEXT.MODE_WSL_TITLE}</span>
            ${wslAvailable ? `<span class="mode-badge">${TEXT.MODE_WSL_RECOMMENDED}</span>` : ''}
          </div>
          <div class="mode-option-desc">${TEXT.MODE_WSL_DESC}</div>
          ${wslStatusHtml}
        </div>
      </div>
    `;

    parent.appendChild(section);

    // 绑定模式选择事件
    const modeNative = $('#mode-native');
    const modeWsl = $('#mode-wsl');

    if (modeNative) {
      modeNative.addEventListener('click', () => this._selectMode('native'));
    }
    if (modeWsl) {
      modeWsl.addEventListener('click', () => this._selectMode('wsl'));
    }

    // 绑定 WSL 安装按钮（只在 WSL 未安装时存在）
    const wslBtn = $('#install-wsl-btn');
    if (wslBtn) {
      wslBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // 防止触发模式选择
        this._installWsl();
      });
    }
  },

  async _selectMode(mode) {
    this._selectedMode = mode;

    // 更新选中样式
    const modeWsl = $('#mode-wsl');
    const modeNative = $('#mode-native');
    if (modeWsl) modeWsl.classList.toggle('selected', mode === 'wsl');
    if (modeNative) modeNative.classList.toggle('selected', mode === 'native');

    // WSL 安装区域：只在选 WSL 且 WSL 未安装时展示
    const wslInstallArea = $('#wsl-install-area');
    if (wslInstallArea) {
      wslInstallArea.style.display = mode === 'wsl' ? '' : 'none';
    }

    // 检测所选模式的依赖
    await this._checkModeDeps(mode);
  },

  async _checkModeDeps(mode) {
    const section = $('#mode-deps-section');
    if (!section) return;

    section.innerHTML = `
      <div class="check-section-title">
        <span class="section-icon">2</span>
        ${TEXT.MODE_DEPS_TITLE}
      </div>
      <div class="mode-deps-result">
        <div class="dep-check-item">
          <div class="dep-check-icon"><div class="spinner"></div></div>
          <div class="dep-check-info">
            <div class="dep-check-name">${TEXT.MODE_DEPS_CHECKING}</div>
          </div>
        </div>
      </div>
    `;

    try {
      console.log(`[StepCheck] Calling checkForMode(${mode})...`);
      const result = await window.openclawAPI.deps.checkForMode(mode);
      console.log('[StepCheck] checkForMode result:', result);
      this._modeDepResult = result;
      this._renderModeDeps(section, result, mode);
    } catch (err) {
      console.error('[StepCheck] checkForMode error:', err);
      section.innerHTML += `
        <div class="dep-check-item">
          <div class="dep-check-icon fail">!</div>
          <div class="dep-check-info">
            <div class="dep-check-name">检测失败</div>
            <div class="dep-check-detail">${err.message}</div>
          </div>
        </div>
      `;
    }
  },

  _renderModeDeps(section, result, mode) {
    const modeLabel = mode === 'wsl' ? 'WSL' : 'Windows';

    let html = `
      <div class="check-section-title">
        <span class="section-icon">2</span>
        ${TEXT.MODE_DEPS_TITLE}（${modeLabel}）
      </div>
      <div class="mode-deps-result">
    `;

    // Node.js
    if (result.node.installed && result.node.satisfies) {
      html += `
        <div class="dep-check-item">
          <div class="dep-check-icon ok">&#10003;</div>
          <div class="dep-check-info">
            <div class="dep-check-name">${TEXT.WIZARD_CHECK_NODE}</div>
            <div class="dep-check-detail">${TEXT.WIZARD_CHECK_NODE_OK.replace('{version}', result.node.version)}</div>
          </div>
        </div>
      `;
    } else if (result.node.installed && !result.node.satisfies) {
      html += `
        <div class="dep-check-item">
          <div class="dep-check-icon warn">!</div>
          <div class="dep-check-info">
            <div class="dep-check-name">${TEXT.WIZARD_CHECK_NODE}</div>
            <div class="dep-check-detail">${TEXT.WIZARD_CHECK_NODE_LOW.replace('{version}', result.node.version)}</div>
          </div>
          <button class="btn btn-primary btn-sm" id="mode-install-node-btn">${TEXT.WIZARD_CHECK_INSTALL_BTN}</button>
        </div>
      `;
    } else {
      html += `
        <div class="dep-check-item">
          <div class="dep-check-icon fail">&#10007;</div>
          <div class="dep-check-info">
            <div class="dep-check-name">${TEXT.WIZARD_CHECK_NODE}</div>
            <div class="dep-check-detail">${mode === 'wsl' ? TEXT.MODE_DEPS_WSL_NODE_MISSING : TEXT.WIZARD_CHECK_NODE_MISSING}</div>
          </div>
          <button class="btn btn-primary btn-sm" id="mode-install-node-btn">
            ${mode === 'wsl' ? TEXT.MODE_DEPS_WSL_NODE_INSTALL : TEXT.WIZARD_CHECK_INSTALL_BTN}
          </button>
        </div>
      `;
    }

    // Git (仅在 Windows 原生模式下显示)
    if (mode === 'native' && result.git) {
      if (result.git.installed) {
        html += `
          <div class="dep-check-item">
            <div class="dep-check-icon ok">&#10003;</div>
            <div class="dep-check-info">
              <div class="dep-check-name">Git</div>
              <div class="dep-check-detail">已安装 (${result.git.version})</div>
            </div>
          </div>
        `;
      } else {
        html += `
          <div class="dep-check-item">
            <div class="dep-check-icon warn">!</div>
            <div class="dep-check-info">
              <div class="dep-check-name">Git</div>
              <div class="dep-check-detail">未安装（将自动安装）</div>
            </div>
          </div>
        `;
      }
    }

    // npm
    if (result.npm.installed) {
      html += `
        <div class="dep-check-item">
          <div class="dep-check-icon ok">&#10003;</div>
          <div class="dep-check-info">
            <div class="dep-check-name">${TEXT.WIZARD_CHECK_NPM}</div>
            <div class="dep-check-detail">${TEXT.WIZARD_CHECK_NPM_OK.replace('{version}', result.npm.version)}</div>
          </div>
        </div>
      `;
    } else {
      html += `
        <div class="dep-check-item">
          <div class="dep-check-icon fail">&#10007;</div>
          <div class="dep-check-info">
            <div class="dep-check-name">${TEXT.WIZARD_CHECK_NPM}</div>
            <div class="dep-check-detail">${TEXT.WIZARD_CHECK_NPM_MISSING}（随 Node.js 一起安装）</div>
          </div>
        </div>
      `;
    }

    // Summary
    const allOk = result.node.installed && result.node.satisfies && result.npm.installed;
    if (allOk) {
      html += `
        <div class="dep-check-item" style="border-color: var(--success);">
          <div class="dep-check-icon ok">&#10003;</div>
          <div class="dep-check-info">
            <div class="dep-check-name" style="color: var(--success);">${TEXT.MODE_DEPS_ALL_OK}</div>
          </div>
        </div>
      `;
    }

    html += '</div>';
    section.innerHTML = html;

    this._updateNextBtn();

    // 绑定安装 Node.js 按钮
    const installBtn = $('#mode-install-node-btn');
    if (installBtn) {
      installBtn.addEventListener('click', () => this._installNodeForMode(mode));
    }
  },

  _updateNextBtn() {
    const nextBtn = $('#check-next-btn');
    if (!nextBtn) return;

    const hasMode = !!this._selectedMode;
    const depsOk = this._modeDepResult &&
      this._modeDepResult.node.installed &&
      this._modeDepResult.node.satisfies &&
      this._modeDepResult.npm.installed;

    nextBtn.disabled = !(hasMode && depsOk);
  },

  async _proceedNext() {
    if (!this._selectedMode) return;

    // 保存执行模式到主进程
    await window.openclawAPI.deps.setExecutionMode(this._selectedMode);
    WizardController.setExecutionMode(this._selectedMode);
    WizardController.next();
  },

  async _installWsl() {
    const wslBtn = $('#install-wsl-btn');
    if (wslBtn) {
      wslBtn.disabled = true;
      wslBtn.textContent = TEXT.WSL_INSTALLING;
    }

    // 设置进度监听
    const removeListener = window.openclawAPI.deps.onWslProgress((progress) => {
      if (wslBtn) wslBtn.textContent = progress.message || TEXT.WSL_INSTALLING;

      if (progress.step === 'done') {
        if (wslBtn) {
          wslBtn.textContent = progress.needsReboot ? TEXT.WSL_INSTALL_REBOOT : 'WSL 安装完成';
          wslBtn.disabled = true;
        }
        removeListener();
        // Re-check after a short delay
        setTimeout(() => this._runFullCheck(), 2000);
      } else if (progress.step === 'error') {
        if (wslBtn) {
          wslBtn.textContent = TEXT.WSL_INSTALL_BTN;
          wslBtn.disabled = false;
        }
        Toast.error(progress.message);
        removeListener();
      }
    });

    try {
      await window.openclawAPI.deps.installWsl();
    } catch (err) {
      console.error('[StepCheck] WSL install error:', err);
      Toast.error(err.message);
      if (wslBtn) {
        wslBtn.textContent = TEXT.WSL_INSTALL_BTN;
        wslBtn.disabled = false;
      }
      removeListener();
    }
  },

  /**
   * 安装依赖（根据模式）
   */
  async _installNodeForMode(mode) {
    if (this._installing) return;
    this._installing = true;

    const installBtn = $('#mode-install-node-btn');
    if (installBtn) {
      installBtn.disabled = true;
      installBtn.textContent = TEXT.WIZARD_CHECK_INSTALLING;
    }

    // 添加进度区域
    const depsSection = $('#mode-deps-section');
    const progressItem = createElement('div', { className: 'dep-check-item', id: 'node-install-progress' });
    progressItem.innerHTML = `
      <div class="dep-check-icon"><div class="spinner"></div></div>
      <div class="dep-check-info">
        <div class="dep-check-name">正在安装依赖...</div>
        <div class="dep-check-detail" id="node-install-msg">准备中...</div>
      </div>
    `;
    const depsResult = depsSection.querySelector('.mode-deps-result');
    if (depsResult) depsResult.appendChild(progressItem);

    // 设置进度监听
    const removeListener = window.openclawAPI.deps.onDepsProgress((progress) => {
      const msg = $('#node-install-msg');
      if (msg) msg.textContent = progress.message;

      if (progress.step === 'done') {
        const icon = progressItem.querySelector('.dep-check-icon');
        if (icon) { icon.className = 'dep-check-icon ok'; icon.innerHTML = '&#10003;'; }
        removeListener();
        // 重新检测
        setTimeout(() => {
          this._installing = false;
          this._checkModeDeps(mode);
        }, 1000);
      } else if (progress.step === 'error') {
        const icon = progressItem.querySelector('.dep-check-icon');
        if (icon) { icon.className = 'dep-check-icon fail'; icon.innerHTML = '!'; }
        if (installBtn) { installBtn.disabled = false; installBtn.textContent = TEXT.WIZARD_CHECK_INSTALL_BTN; }
        this._installing = false;
        removeListener();
      }
    });

    try {
      if (mode === 'wsl') {
        // WSL 模式：直接安装 Node.js
        console.log('[StepCheck] Installing Node.js in WSL...');
        await window.openclawAPI.deps.installNodeWsl();
      } else {
        // Native 模式：先安装 Git，再安装 Node.js
        const msgEl = $('#node-install-msg');
        
        // 步骤 1: 安装 Git
        if (msgEl) msgEl.textContent = '检查并安装 Git...';
        console.log('[StepCheck] Installing Git...');
        try {
          await window.openclawAPI.deps.installGit();
          console.log('[StepCheck] Git installed successfully');
        } catch (gitErr) {
          console.warn('[StepCheck] Git installation error (may already installed):', gitErr.message);
          // Git 可能已安装，继续
        }
        
        // 步骤 2: 安装 Node.js
        if (msgEl) msgEl.textContent = '安装 Node.js...';
        console.log('[StepCheck] Installing Node.js...');
        await window.openclawAPI.deps.installNode('builtin');
        console.log('[StepCheck] Node.js installed successfully');
      }
    } catch (err) {
      console.error('[StepCheck] Installation error:', err);
      const icon = progressItem.querySelector('.dep-check-icon');
      if (icon) { icon.className = 'dep-check-icon fail'; icon.innerHTML = '!'; }
      const msg = $('#node-install-msg');
      if (msg) msg.textContent = '安装失败: ' + err.message;
      if (installBtn) { installBtn.disabled = false; installBtn.textContent = TEXT.WIZARD_CHECK_INSTALL_BTN; }
      this._installing = false;
      removeListener();
      Toast.error('安装失败: ' + err.message);
    }
  }
};

