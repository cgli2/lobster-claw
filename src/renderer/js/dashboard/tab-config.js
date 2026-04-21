/* eslint-disable no-unused-vars, no-undef */
const TabConfig = {
  _config: null,
  _mode: 'visual',

  async render(container) {
    container.innerHTML = `
      <h2>${TEXT.CONFIG_TITLE}</h2>
      <div class="action-bar">
        <div class="left">
          <div class="mode-toggle">
            <button class="active" id="config-mode-visual">${TEXT.CONFIG_MODE_VISUAL}</button>
            <button id="config-mode-json">${TEXT.CONFIG_MODE_JSON}</button>
          </div>
        </div>
        <div class="right">
          <span style="font-size: 12px; color: var(--text-muted); align-self: center;">${TEXT.CONFIG_BACKUP_NOTE}</span>
          <button class="btn" id="config-refresh-btn">${TEXT.BTN_REFRESH}</button>
          <button class="btn btn-success" id="config-save-btn">${TEXT.BTN_SAVE}</button>
        </div>
      </div>
      <div id="config-content"></div>
    `;

    $('#config-mode-visual').addEventListener('click', () => this._setMode('visual'));
    $('#config-mode-json').addEventListener('click', () => this._setMode('json'));
    $('#config-refresh-btn').addEventListener('click', () => this._load());
    $('#config-save-btn').addEventListener('click', () => this._save());

    await this._load();
  },

  async _load() {
    const content = $('#config-content');
    content.innerHTML = '<div class="spinner spinner-lg" style="margin: 20px;"></div>';

    try {
      this._config = await window.openclawAPI.config.read();

      // Ensure gateway.controlUi.allowedOrigins is set for management app access
      if (this._config.gateway && !this._config.gateway.controlUi?.allowedOrigins) {
        this._config.gateway.controlUi = {
          allowedOrigins: ['*']
        };
        // Auto-save the updated config
        await window.openclawAPI.config.write(this._config);
        console.log('Auto-added gateway.controlUi.allowedOrigins to config');
      }

      this._renderContent();
    } catch (err) {
      content.innerHTML = `<p style="color: var(--danger);">加载失败: ${err.message}</p>`;
    }
  },

  _setMode(mode) {
    this._mode = mode;
    $('#config-mode-visual').classList.toggle('active', mode === 'visual');
    $('#config-mode-json').classList.toggle('active', mode === 'json');
    this._renderContent();
  },

  _renderContent() {
    const content = $('#config-content');

    if (this._mode === 'json') {
      content.innerHTML = `<textarea class="json-editor" id="config-json-editor">${JSON.stringify(this._config || {}, null, 2)}</textarea>`;
    } else {
      this._renderVisual(content);
    }
  },

  _renderVisual(content) {
    const config = this._config || {};
    const sections = [];

    // Gateway section - 特殊处理，添加重新生成 Token 按钮
    if (config.gateway) {
      sections.push(this._buildGatewaySection(config.gateway));
    }

    // Agents section
    if (config.agents) {
      sections.push(this._buildAgentsSection(config.agents));
    }

    // Models section
    if (config.models) {
      sections.push(this._buildSection('模型配置', config.models, 'models', ['providers']));
    }

    // Channels section - 特殊处理
    if (config.channels) {
      sections.push(this._buildChannelsSection(config.channels));
    }

    // Plugins section - 过滤掉 enabled
    if (config.plugins) {
      sections.push(this._buildPluginsSection(config.plugins));
    }

    // MCP Servers section
    if (config.mcpServers) {
      sections.push(this._buildSection('MCP 服务器', config.mcpServers, 'mcpServers'));
    }

    // Other top-level keys (排除已知和不需要的)
    const knownKeys = ['gateway', 'agents', 'models', 'plugins', 'channels', 'mcpServers', 'meta', 'wizard', 'env', 'skills', 'session', 'update', 'commands'];
    for (const [key, value] of Object.entries(config)) {
      if (!knownKeys.includes(key) && typeof value === 'object' && Object.keys(value).length > 0) {
        sections.push(this._buildSection(key, value, key));
      }
    }

    if (sections.length === 0) {
      content.innerHTML = '<div class="empty-state"><p>暂无可编辑的配置段</p><p style="font-size:12px;">请切换到 JSON 模式直接编辑</p></div>';
      return;
    }

    content.innerHTML = sections.join('');

    // Bind regenerate token button
    const regenBtn = $('#regenerate-token-btn');
    if (regenBtn) {
      regenBtn.addEventListener('click', () => this._regenerateToken());
    }

    // Bind password toggle buttons
    $$('.toggle-password-btn', content).forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.target;
        const input = $(`#${targetId}`);
        if (input) {
          const isPassword = input.type === 'password';
          input.type = isPassword ? 'text' : 'password';
          // 切换图标样式
          btn.classList.toggle('active', !isPassword);
        }
      });
    });

    // Bind collapsible toggles
    $$('.config-section-toggle', content).forEach(btn => {
      btn.addEventListener('click', () => {
        const body = btn.parentElement.nextElementSibling;
        const isHidden = body.style.display === 'none';
        body.style.display = isHidden ? 'block' : 'none';
        btn.textContent = isHidden ? '\u25BC' : '\u25B6';
      });
    });
  },

  _buildGatewaySection(gateway) {
    const fields = [];
    
    // 端口
    fields.push(this._buildFieldRow('gateway.port', '端口', gateway.port, 'number'));
    
    // 绑定地址
    fields.push(this._buildFieldRow('gateway.bind', '绑定地址', gateway.bind || NETWORK.gatewayBind, 'text'));
    
    // 模式
    fields.push(this._buildFieldRow('gateway.mode', '模式', gateway.mode || 'local', 'text'));
    
    // Token - 特殊处理，添加重新生成按钮
    const currentToken = gateway.auth?.token || '';
    fields.push(`
      <div class="kv-row">
        <span class="kv-key">认证 Token</span>
        <div style="display: flex; gap: 8px; flex: 1;">
          <input class="input kv-value config-field" data-path="gateway.auth.token" value="${this._escapeAttr(currentToken)}" style="flex: 1;">
          <button class="btn btn-sm btn-ghost" id="regenerate-token-btn">${TEXT.CONFIG_REGENERATE_TOKEN}</button>
        </div>
      </div>
    `);

    return `
      <div class="card" style="margin-bottom: 12px;">
        <div class="card-header">
          <h3>网关配置 (Gateway)</h3>
          <button class="btn btn-sm btn-ghost config-section-toggle">\u25BC</button>
        </div>
        <div class="config-section-body">${fields.join('')}</div>
      </div>
    `;
  },

  _buildAgentsSection(agents) {
    const fields = [];
    
    // 默认模型配置
    if (agents.defaults?.model) {
      fields.push(this._buildFieldRow('agents.defaults.model.primary', '默认主模型', agents.defaults.model.primary || '', 'text'));
    }
    
    // Compaction 模式
    if (agents.defaults?.compaction) {
      fields.push(this._buildFieldRow('agents.defaults.compaction.mode', '压缩模式', agents.defaults.compaction.mode || 'safeguard', 'text'));
    }
    
    // 其他 defaults 配置
    if (agents.defaults) {
      for (const [key, value] of Object.entries(agents.defaults)) {
        if (key !== 'model' && key !== 'compaction' && typeof value !== 'object') {
          fields.push(this._buildFieldRow(`agents.defaults.${key}`, key, value));
        }
      }
    }

    return `
      <div class="card" style="margin-bottom: 12px;">
        <div class="card-header">
          <h3>Agent 配置</h3>
          <button class="btn btn-sm btn-ghost config-section-toggle">\u25BC</button>
        </div>
        <div class="config-section-body">${fields.join('') || '<p style="color: var(--text-muted);">无配置项</p>'}</div>
      </div>
    `;
  },

  _buildChannelsSection(channels) {
    const fields = [];
    const sensitiveKeys = ['secret', 'password', 'token', 'key', 'credential'];
    
    for (const [channelName, channelConfig] of Object.entries(channels)) {
      if (typeof channelConfig !== 'object') continue;
      
      // 过滤掉 enabled 字段，只显示账号配置
      const label = this._getChannelLabel(channelName);
      fields.push(`<div class="config-subsection" style="margin-bottom: 12px;"><strong>${label}</strong></div>`);
      
      if (channelConfig.accounts) {
        for (const [accountName, accountConfig] of Object.entries(channelConfig.accounts)) {
          if (typeof accountConfig === 'object') {
            for (const [key, value] of Object.entries(accountConfig)) {
              if (key !== 'enabled') {
                // 判断是否为敏感字段
                const isSensitive = sensitiveKeys.some(sk => key.toLowerCase().includes(sk));
                const fieldType = isSensitive ? 'password' : 'text';
                fields.push(this._buildFieldRow(`channels.${channelName}.accounts.${accountName}.${key}`, `${accountName}.${key}`, value, fieldType));
              }
            }
          }
        }
      }
      
      // 其他配置（排除 enabled 和 accounts）
      for (const [key, value] of Object.entries(channelConfig)) {
        if (key !== 'enabled' && key !== 'accounts' && typeof value !== 'object') {
          const isSensitive = sensitiveKeys.some(sk => key.toLowerCase().includes(sk));
          const fieldType = isSensitive ? 'password' : 'text';
          fields.push(this._buildFieldRow(`channels.${channelName}.${key}`, key, value, fieldType));
        }
      }
    }

    if (fields.length === 0) {
      return '';
    }

    return `
      <div class="card" style="margin-bottom: 12px;">
        <div class="card-header">
          <h3>渠道配置</h3>
          <button class="btn btn-sm btn-ghost config-section-toggle">\u25BC</button>
        </div>
        <div class="config-section-body">${fields.join('')}</div>
      </div>
    `;
  },

  _buildPluginsSection(plugins) {
    const fields = [];
    
    if (plugins.entries) {
      // 只显示已启用的插件，不显示 enabled 字段
      for (const [pluginName, pluginConfig] of Object.entries(plugins.entries)) {
        if (typeof pluginConfig === 'object') {
          const hasOtherFields = Object.keys(pluginConfig).some(k => k !== 'enabled');
          if (hasOtherFields) {
            fields.push(`<div class="config-subsection" style="margin: 8px 0 4px; color: var(--text-secondary);">${pluginName}</div>`);
            for (const [key, value] of Object.entries(pluginConfig)) {
              if (key !== 'enabled') {
                fields.push(this._buildFieldRow(`plugins.entries.${pluginName}.${key}`, key, value));
              }
            }
          }
        }
      }
    }

    if (fields.length === 0) {
      return '';
    }

    return `
      <div class="card" style="margin-bottom: 12px;">
        <div class="card-header">
          <h3>插件配置</h3>
          <button class="btn btn-sm btn-ghost config-section-toggle">\u25BC</button>
        </div>
        <div class="config-section-body">${fields.join('')}</div>
      </div>
    `;
  },

  _buildSection(title, data, path, excludeKeys = []) {
    const fields = this._flattenObject(data, path, excludeKeys, 3);
    const rows = fields.map(f => this._buildFieldRow(f.path, f.displayKey, f.value, this._guessFieldType(f.path, f.value)));

    if (rows.length === 0) {
      return '';
    }

    return `
      <div class="card" style="margin-bottom: 12px;">
        <div class="card-header">
          <h3>${title}</h3>
          <button class="btn btn-sm btn-ghost config-section-toggle">\u25BC</button>
        </div>
        <div class="config-section-body">${rows.join('')}</div>
      </div>
    `;
  },

  _buildFieldRow(path, displayKey, value, type = 'text') {
    let inputHtml;
    
    if (type === 'boolean') {
      const checked = value === true || value === 'true' ? 'checked' : '';
      inputHtml = `<input type="checkbox" class="config-field config-checkbox" data-path="${path}" ${checked}>`;
    } else if (type === 'number') {
      inputHtml = `<input type="number" class="input kv-value config-field" data-path="${path}" value="${this._escapeAttr(String(value ?? ''))}">`;
    } else if (type === 'password') {
      const inputId = `pwd-${path.replace(/\./g, '-')}`;
      inputHtml = `
        <div style="display: flex; gap: 4px; flex: 1;">
          <input type="password" class="input kv-value config-field" data-path="${path}" value="${this._escapeAttr(String(value ?? ''))}" id="${inputId}" style="flex: 1;">
          <button class="btn btn-sm btn-ghost toggle-password-btn" data-target="${inputId}" type="button" title="${TEXT.CONFIG_TOGGLE_PASSWORD}">
            <span class="eye-icon">&#128065;</span>
          </button>
        </div>
      `;
    } else {
      inputHtml = `<input class="input kv-value config-field" data-path="${path}" value="${this._escapeAttr(String(value ?? ''))}">`;
    }

    return `
      <div class="kv-row">
        <span class="kv-key" title="${path}">${displayKey}</span>
        ${inputHtml}
      </div>
    `;
  },

  _flattenObject(obj, prefix, excludeKeys = [], maxDepth = 3) {
    const result = [];
    if (maxDepth <= 0) return result;

    for (const [key, value] of Object.entries(obj || {})) {
      // 跳过 enabled 字段和排除的键
      if (key === 'enabled' || excludeKeys.includes(key)) continue;
      
      const path = prefix + '.' + key;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        result.push(...this._flattenObject(value, path, excludeKeys, maxDepth - 1));
      } else if (!Array.isArray(value)) {
        result.push({
          path,
          displayKey: key,
          value
        });
      }
    }
    return result;
  },

  _guessFieldType(path, value) {
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (path.includes('.port')) return 'number';
    return 'text';
  },

  _getChannelLabel(channelName) {
    const labels = {
      feishu: '飞书',
      dingtalk: '钉钉',
      wechat: '企业微信',
      qq: 'QQ'
    };
    return labels[channelName] || channelName;
  },

  _regenerateToken() {
    const newToken = crypto.randomUUID ? crypto.randomUUID() : this._generateUUID();
    const tokenInput = $('input[data-path="gateway.auth.token"]');
    if (tokenInput) {
      tokenInput.value = newToken;
      Toast.success(TEXT.CONFIG_TOKEN_REGENERATED);
    }
  },

  _generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  },

  async _save() {
    try {
      let configToSave;

      if (this._mode === 'json') {
        const editor = $('#config-json-editor');
        try {
          configToSave = JSON.parse(editor.value);
        } catch {
          Toast.error(TEXT.CONFIG_INVALID_JSON);
          return;
        }
      } else {
        // Apply visual edits back to config
        configToSave = JSON.parse(JSON.stringify(this._config || {}));

        $$('.config-field').forEach(input => {
          const path = input.dataset.path;
          let value;

          if (input.type === 'checkbox') {
            value = input.checked;
          } else if (input.type === 'number') {
            value = Number(input.value) || 0;
          } else {
            value = input.value;
          }

          this._setNestedValue(configToSave, path, value);
        });
      }

      // Ensure gateway.controlUi.allowedOrigins is set for management app access
      if (configToSave.gateway) {
        configToSave.gateway.controlUi = {
          allowedOrigins: ['*']
        };
      }

      const result = await window.openclawAPI.config.write(configToSave);
      if (result.success) {
        Toast.success(TEXT.CONFIG_SAVE_SUCCESS);
        this._config = configToSave;
      } else {
        Toast.error(result.message || TEXT.CONFIG_SAVE_ERROR);
      }
    } catch (err) {
      Toast.error('保存失败: ' + err.message);
    }
  },

  _setNestedValue(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) current[keys[i]] = {};
      current = current[keys[i]];
    }
    const lastKey = keys[keys.length - 1];
    current[lastKey] = value;
  },

  _escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
};
