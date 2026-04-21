/* eslint-disable no-unused-vars, no-undef */
const TabEnv = {
  _envData: {},

  /** Check if a variable name looks like a secret (API key, token, password, etc.) */
  _isSensitive(key) {
    return /key|secret|token|password|credential/i.test(key);
  },

  async render(container) {
    container.innerHTML = `
      <h2>${TEXT.ENV_TITLE}</h2>
      <p style="color: var(--text-muted); margin-bottom: 16px; font-size: 13px;">${TEXT.ENV_HINT}</p>
      
      <!-- PATH Fix Section -->
      <div class="card" style="margin-bottom: 20px; border: 1px solid var(--warning-border, #ffc107); background: rgba(255, 193, 7, 0.05);">
        <div class="card-header">
          <h3 style="margin: 0;">🔧 CMD 命令修复</h3>
        </div>
        <div class="card-body" style="padding: 16px;">
          <p style="margin: 0 0 12px; font-size: 13px; color: var(--text-secondary);">
            如果在 CMD 中无法使用 <code>openclaw</code> 命令，点击下面的按钮自动修复：
          </p>
          <div style="display: flex; gap: 12px; align-items: center;">
            <button class="btn btn-primary" id="env-path-check-btn">检查并修复 PATH</button>
            <span id="env-path-status" style="font-size: 13px;"></span>
          </div>
        </div>
      </div>
      
      <div class="action-bar">
        <div class="left">
          <button class="btn btn-primary" id="env-add-btn">${TEXT.ENV_ADD}</button>
        </div>
        <div class="right">
          <button class="btn" id="env-refresh-btn">${TEXT.BTN_REFRESH}</button>
          <button class="btn btn-success" id="env-save-btn">${TEXT.BTN_SAVE}</button>
        </div>
      </div>
      <div id="env-list"></div>
      <div class="section" style="margin-top: 24px;">
        <h3>常用变量参考</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>变量名</th><th>说明</th></tr></thead>
            <tbody>
              ${TEXT.ENV_PRESETS.map(p => `<tr><td><code>${p.key}</code></td><td>${p.desc}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    $('#env-add-btn').addEventListener('click', () => this._addRow());
    $('#env-refresh-btn').addEventListener('click', () => this._load());
    $('#env-save-btn').addEventListener('click', () => this._save());
    $('#env-path-check-btn').addEventListener('click', () => this._checkAndFixPath());

    await this._load();
  },

  async _load() {
    const list = $('#env-list');
    list.innerHTML = '<div class="spinner" style="margin: 12px;"></div>';
  
    try {
      this._envData = await window.openclawAPI.env.read();
      this._renderList();
    } catch (err) {
      list.innerHTML = `<p style="color: var(--danger);">加载失败：${err.message}</p>`;
    }
  },
  
  async _checkAndFixPath() {
    const statusEl = $('#env-path-status');
    statusEl.style.color = 'var(--text-muted)';
    statusEl.textContent = '检查中...';
  
    try {
      // Check current PATH status
      const checkResult = await window.openclawAPI.utils.checkPath();
        
      if (!checkResult.success) {
        statusEl.style.color = 'var(--danger)';
        statusEl.textContent = '检查失败：' + checkResult.message;
        return;
      }
  
      statusEl.style.color = checkResult.inSystemPath ? 'var(--success)' : 'var(--warning)';
      statusEl.textContent = checkResult.message;
  
      if (!checkResult.inSystemPath) {
        // Ask user before fixing
        if (!confirm(`检测到 npm 全局目录不在系统 PATH 中：\n\n${checkResult.npmGlobalPath}\n\n是否自动添加到系统 PATH？（需要管理员权限）`)) {
          return;
        }
  
        // Try to add to system PATH
        statusEl.style.color = 'var(--text-muted)';
        statusEl.textContent = '添加中...';
          
        const addResult = await window.openclawAPI.utils.addPath(checkResult.npmGlobalPath);

        if (addResult.success) {
          statusEl.style.color = 'var(--success)';

          if (addResult.alreadyExists) {
            statusEl.textContent = '路径已在 PATH 中';
          } else if (addResult.usedUserPath) {
            statusEl.textContent = addResult.message;
            setTimeout(() => {
              alert('✓ 已添加到用户环境变量！\n\n' +
                '说明：由于没有管理员权限，已添加到用户 PATH。\n' +
                '效果：仅对当前用户生效。\n\n' +
                '请重启终端（CMD/PowerShell）或注销并重新登录，\n' +
                '然后就可以使用 openclaw 命令了。');
            }, 100);
          } else {
            statusEl.textContent = addResult.message + ' - 请重启终端使更改生效';
            setTimeout(() => {
              alert('✓ 已成功添加到 PATH！\n\n' +
                '请重启终端（CMD/PowerShell）或注销并重新登录，\n' +
                '然后就可以使用 openclaw 命令了。');
            }, 100);
          }
        } else {
          statusEl.style.color = 'var(--danger)';

          if (addResult.requiresAdmin) {
            statusEl.textContent = '需要管理员权限';
            setTimeout(() => {
              if (confirm('❌ 添加失败：需要管理员权限\n\n' +
                '解决方案：\n' +
                '1. 以管理员身份运行此应用\n' +
                '2. 或手动添加环境变量\n\n' +
                '点击"确定"查看手动添加步骤')) {
                alert('手动添加步骤：\n\n' +
                  '1. 右键"此电脑" → "属性"\n' +
                  '2. 点击"高级系统设置"\n' +
                  '3. 点击"环境变量"\n' +
                  '4. 在"用户变量"或"系统变量"中找到 PATH\n' +
                  '5. 点击"编辑"，添加以下路径：\n' +
                  `   ${checkResult.npmGlobalPath}\n` +
                  '6. 确定保存，重启终端');
              }
            }, 100);
          } else {
            statusEl.textContent = addResult.message;
          }
        }
      }
    } catch (err) {
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = '操作失败：' + err.message;
    }
  },

  _renderList() {
    const list = $('#env-list');
    const entries = Object.entries(this._envData);

    if (entries.length === 0) {
      list.innerHTML = `<div class="empty-state"><p>${TEXT.ENV_NO_VARS}</p></div>`;
      return;
    }

    list.innerHTML = '';
    for (const [key, value] of entries) {
      this._addRowElement(list, key, value);
    }
  },

  _addRowElement(parent, key, value) {
    const row = createElement('div', { className: 'kv-row' });
    const sensitive = this._isSensitive(key);
    row.innerHTML = `
      <input class="input kv-key" style="width: 220px; flex-shrink: 0;" value="${key || ''}" placeholder="变量名">
      <div style="flex: 1; position: relative; display: flex; align-items: center;">
        <input class="input kv-value" style="flex: 1; padding-right: 36px;" type="${sensitive ? 'password' : 'text'}" value="${value || ''}" placeholder="变量值">
        <button class="btn-eye" type="button" title="显示/隐藏" style="position: absolute; right: 6px; background: none; border: none; cursor: pointer; color: var(--text-muted); font-size: 14px; padding: 2px 4px;">&#128065;</button>
      </div>
      <div class="kv-actions">
        <button class="btn btn-sm btn-danger env-delete-row">${TEXT.BTN_DELETE}</button>
      </div>
    `;
    parent.appendChild(row);

    // Toggle password visibility
    const eyeBtn = row.querySelector('.btn-eye');
    const valueInput = row.querySelector('.kv-value');
    eyeBtn.addEventListener('click', () => {
      const isHidden = valueInput.type === 'password';
      valueInput.type = isHidden ? 'text' : 'password';
      eyeBtn.style.opacity = isHidden ? '1' : '0.5';
    });
    eyeBtn.style.opacity = sensitive ? '0.5' : '1';

    // When key name changes, auto-detect if it should be masked
    const keyInput = row.querySelector('.kv-key');
    keyInput.addEventListener('change', () => {
      const nowSensitive = this._isSensitive(keyInput.value);
      valueInput.type = nowSensitive ? 'password' : 'text';
      eyeBtn.style.opacity = nowSensitive ? '0.5' : '1';
    });

    row.querySelector('.env-delete-row').addEventListener('click', () => {
      row.remove();
    });
  },

  _addRow() {
    const list = $('#env-list');
    // Remove empty state if present
    const emptyState = list.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    this._addRowElement(list, '', '');

    // Focus the new key input
    const inputs = list.querySelectorAll('.kv-key');
    if (inputs.length > 0) inputs[inputs.length - 1].focus();
  },

  async _save() {
    const list = $('#env-list');
    const rows = $$('.kv-row', list);
    const envMap = {};

    for (const row of rows) {
      const key = row.querySelector('.kv-key').value.trim();
      const value = row.querySelector('.kv-value').value;
      if (key) {
        envMap[key] = value;
      }
    }

    try {
      const result = await window.openclawAPI.env.write(envMap);
      if (result.success) {
        Toast.success(TEXT.TOAST_SAVED);
        this._envData = envMap;
      } else {
        Toast.error(result.message || TEXT.TOAST_ERROR);
      }
    } catch (err) {
      Toast.error('保存失败: ' + err.message);
    }
  }
};
