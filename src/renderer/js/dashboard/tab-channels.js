/* eslint-disable no-unused-vars, no-undef */
const TabChannels = {
  _channels: [],
  _selectedChannel: null,
  _hasChanges: false,

  async render(container) {
    container.innerHTML = `
      <h2>${TEXT.CHANNELS_TITLE}</h2>
      <div class="channels-layout">
        <aside class="channels-sidebar" id="channels-sidebar">
          <!-- Channel list will be rendered here -->
        </aside>
        <div class="channels-content" id="channels-content">
          <!-- Channel config will be rendered here -->
        </div>
      </div>
    `;

    await this._load();
  },

  async _load() {
    const sidebar = $('#channels-sidebar');
    sidebar.innerHTML = '<div class="spinner" style="margin: 20px auto;"></div>';

    try {
      const result = await window.openclawAPI.channels.list();

      if (!result.success) {
        sidebar.innerHTML = `<p style="color: var(--danger); padding: 20px;">加载失败: ${result.message}</p>`;
        return;
      }

      this._channels = result.channels || [];
      
      // Select first channel by default
      if (this._channels.length > 0 && !this._selectedChannel) {
        this._selectedChannel = this._channels[0].type;
      }

      this._renderSidebar();
      this._renderContent();
    } catch (err) {
      sidebar.innerHTML = `<p style="color: var(--danger); padding: 20px;">加载失败: ${err.message}</p>`;
    }
  },

  _renderSidebar() {
    const sidebar = $('#channels-sidebar');
    
    sidebar.innerHTML = this._channels.map(channel => `
      <div class="channel-item ${channel.type === this._selectedChannel ? 'active' : ''}" data-type="${channel.type}">
        <div class="channel-info">
          <div class="channel-icon" style="background: ${this._getChannelColor(channel.type)}; color: white;">
            ${this._getChannelIcon(channel.type)}
          </div>
          <span class="channel-name">${channel.name}</span>
        </div>
        <div class="toggle-switch ${channel.enabled ? 'enabled' : ''}" data-type="${channel.type}"></div>
      </div>
    `).join('');

    // Bind channel selection
    $$('.channel-item', sidebar).forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('toggle-switch')) return;
        this._selectChannel(item.dataset.type);
      });
    });

    // Bind toggle switches
    $$('.toggle-switch', sidebar).forEach(toggle => {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const channelType = toggle.dataset.type;
        const channel = this._channels.find(c => c.type === channelType);
        if (channel) {
          this._toggleChannel(channelType, !channel.enabled);
        }
      });
    });
  },

  _renderContent() {
    const content = $('#channels-content');
    const channel = this._channels.find(c => c.type === this._selectedChannel);

    if (!channel) {
      content.innerHTML = `<p class="text-secondary">${TEXT.CHANNELS_SELECT_CHANNEL}</p>`;
      return;
    }

    const config = channel.config || {};
    
    content.innerHTML = `
      <div class="channels-header">
        <div class="channels-title">
          <span style="font-size: 18px; font-weight: 600;">${channel.name}${TEXT.CHANNELS_SETTINGS}</span>
          <span class="status-badge ${channel.enabled ? 'status-connected' : 'status-disconnected'}">
            ${channel.enabled ? TEXT.CHANNELS_ENABLED : TEXT.CHANNELS_DISABLED}
          </span>
        </div>
      </div>
      
      <div class="channels-form">
        ${channel.fields.map(field => `
          <div class="form-group">
            <label>${field.label}</label>
            <div class="input-with-clear">
              <input 
                class="input channel-config-input" 
                type="${field.type === 'password' ? 'password' : 'text'}"
                data-key="${field.key}"
                value="${config[field.key] || ''}"
                placeholder="${field.placeholder || ''}"
                ${!channel.enabled ? 'disabled' : ''}
              >
              ${config[field.key] ? `
                <button class="btn btn-icon btn-clear" data-key="${field.key}">&#10005;</button>
              ` : ''}
              ${field.type === 'password' && config[field.key] ? `
                <button class="btn btn-icon btn-toggle-visibility" data-key="${field.key}">&#128065;</button>
              ` : ''}
            </div>
          </div>
        `).join('')}
      </div>

      <div class="channels-actions">
        <button class="btn" id="channels-test-btn" ${!channel.enabled ? 'disabled' : ''}>
          <span class="icon">&#128227;</span> ${TEXT.CHANNELS_TEST_CONNECTION}
        </button>
        ${channel.requiresPairing ? `
          <button class="btn btn-primary" id="channels-pairing-btn">
            <span class="icon">&#128273;</span> 验证配对码
          </button>
        ` : ''}
      </div>

      <div class="channels-footer">
        <button class="btn" id="channels-cancel-btn">${TEXT.CHANNELS_CANCEL}</button>
        <button class="btn btn-primary" id="channels-save-btn">${TEXT.CHANNELS_SAVE}</button>
      </div>
    `;

    // Bind input changes
    $$('.channel-config-input', content).forEach(input => {
      input.addEventListener('input', () => {
        this._hasChanges = true;
      });
    });

    // Bind clear buttons
    $$('.btn-clear', content).forEach(btn => {
      btn.addEventListener('click', () => {
        const input = $(`.channel-config-input[data-key="${btn.dataset.key}"]`);
        if (input) {
          input.value = '';
          this._hasChanges = true;
        }
      });
    });

    // Bind password visibility toggle
    $$('.btn-toggle-visibility', content).forEach(btn => {
      btn.addEventListener('click', () => {
        const input = $(`.channel-config-input[data-key="${btn.dataset.key}"]`);
        if (input) {
          input.type = input.type === 'password' ? 'text' : 'password';
        }
      });
    });

    // Bind test button
    $('#channels-test-btn').addEventListener('click', () => this._testConnection());

    // Bind pairing button
    const pairingBtn = $('#channels-pairing-btn');
    if (pairingBtn) {
      pairingBtn.addEventListener('click', () => this._verifyPairingCode());
    }

    // Bind cancel button
    $('#channels-cancel-btn').addEventListener('click', () => {
      if (this._hasChanges) {
        if (confirm('确定要放弃未保存的更改吗？')) {
          this._hasChanges = false;
          this._renderContent();
        }
      } else {
        this._renderContent();
      }
    });

    // Bind save button
    $('#channels-save-btn').addEventListener('click', () => this._saveConfig());
  },

  _selectChannel(channelType) {
    if (this._hasChanges) {
      if (!confirm('确定要放弃未保存的更改吗？')) {
        return;
      }
    }
    
    this._selectedChannel = channelType;
    this._hasChanges = false;
    this._renderSidebar();
    this._renderContent();
  },

  async _toggleChannel(channelType, enabled) {
    const channel = this._channels.find(c => c.type === channelType);
    if (!channel) return;

    // ── 启用时：给 toggle 加 loading 状态，防止重复点击 ──────────────────
    let toggleEl = null;
    if (enabled) {
      toggleEl = $(`[data-type="${channelType}"].toggle-switch`);
      if (toggleEl) {
        toggleEl.classList.add('loading');
        toggleEl.style.pointerEvents = 'none';
        toggleEl.title = '正在检测插件，请稍候...';
      }
      Toast.info(`正在检测 ${channel.name} 插件，请稍候...`);
    }

    try {
      const result = await window.openclawAPI.channels.setEnabled(channelType, enabled);

      if (result.success) {
        // 更新本地状态
        channel.enabled = enabled;

        if (enabled && result.pluginInstalled) {
          Toast.success(`${channel.name} 插件安装成功，渠道已启用`);
        } else if (enabled && result.pluginAlreadyInstalled) {
          Toast.success(TEXT.CHANNELS_ENABLED);
        } else if (!enabled) {
          Toast.success(TEXT.CHANNELS_DISABLED);
        } else {
          Toast.success(TEXT.CHANNELS_ENABLED);
        }

        this._renderSidebar();
        this._renderContent();
      } else {
        // 失败时回滚 toggle 显示（不更新 channel.enabled）
        if (result.pluginError) {
          // 插件安装失败：弹出详细错误对话框
          const errMsg = result.message || '插件安装失败，请手动安装后重试';
          Toast.error(`无法启用 ${channel.name}：${errMsg}`);
        } else {
          Toast.error(result.message || TEXT.TOAST_ERROR);
        }
        // 重新渲染 sidebar，恢复原来的 toggle 状态
        this._renderSidebar();
        this._renderContent();
      }
    } catch (err) {
      Toast.error(err.message);
      this._renderSidebar();
      this._renderContent();
    } finally {
      // 清理 loading 状态（如果渲染前还存在的话）
      if (toggleEl) {
        toggleEl.classList.remove('loading');
        toggleEl.style.pointerEvents = '';
        toggleEl.title = '';
      }
    }
  },


  async _testConnection() {
    const channel = this._channels.find(c => c.type === this._selectedChannel);
    if (!channel) return;

    if (!channel.enabled) {
      Toast.warning(TEXT.CHANNELS_ENABLE_FIRST);
      return;
    }

    const testBtn = $('#channels-test-btn');
    const originalText = testBtn.innerHTML;
    testBtn.innerHTML = `<span class="spinner spinner-sm"></span> ${TEXT.CHANNELS_TESTING}`;
    testBtn.disabled = true;

    try {
      // 采集当前表单的所有 input 值（含未保存的修改）
      const config = {};
      $$('.channel-config-input').forEach(input => {
        config[input.dataset.key] = input.value.trim();
      });

      const result = await window.openclawAPI.channels.test(channel.type, config);

      if (result.autoSaved) {
        // 后端自动补写了配置，同步更新本地缓存和表单状态
        channel.config = { ...channel.config, ...config };
        this._hasChanges = false;
        Toast.info('配置未保存，已自动写入后执行测试');
      }

      if (result.success && result.connected) {
        Toast.success(TEXT.CHANNELS_CONNECTED);
      } else {
        Toast.error(result.message || TEXT.CHANNELS_DISCONNECTED);
      }
    } catch (err) {
      Toast.error(err.message);
    } finally {
      testBtn.innerHTML = originalText;
      testBtn.disabled = false;
    }
  },

  async _verifyPairingCode() {
    const channel = this._channels.find(c => c.type === this._selectedChannel);
    if (!channel) return;

    // Get pairing code from input
    const pairingInput = $('.channel-config-input[data-key="pairingCode"]');
    if (!pairingInput) {
      Toast.error('未找到配对码输入框');
      return;
    }

    const pairingCode = pairingInput.value.trim();
    if (!pairingCode) {
      Toast.error('请输入配对码');
      return;
    }

    const pairingBtn = $('#channels-pairing-btn');
    const originalText = pairingBtn.innerHTML;
    pairingBtn.innerHTML = `<span class="spinner spinner-sm"></span> 验证中...`;
    pairingBtn.disabled = true;

    try {
      const result = await window.openclawAPI.channels.verifyPairing(channel.type, pairingCode);
      
      if (result.success) {
        // 更新本地配置
        channel.config.pairingCode = pairingCode;
        // 自动保存配置
        await this._saveConfig();
        Toast.success(result.message || '配对成功！');
      } else {
        Toast.error(result.message || '配对失败');
      }
    } catch (err) {
      Toast.error(err.message);
    } finally {
      pairingBtn.innerHTML = originalText;
      pairingBtn.disabled = false;
    }
  },

  async _saveConfig() {
    const channel = this._channels.find(c => c.type === this._selectedChannel);
    if (!channel) return;

    // Collect config values
    const config = {};
    $$('.channel-config-input').forEach(input => {
      config[input.dataset.key] = input.value.trim();
    });

    try {
      Toast.info('正在保存配置...');
      
      const result = await window.openclawAPI.channels.update(channel.type, {
        enabled: channel.enabled,
        config: config
      });

      if (result.success) {
        Toast.success(TEXT.CHANNELS_CONFIG_SAVED);
        this._hasChanges = false;
        
        // Update local state
        channel.config = { ...channel.config, ...config };
        this._renderContent();
      } else {
        Toast.error(result.message || TEXT.CHANNELS_CONFIG_ERROR);
      }
    } catch (err) {
      Toast.error(err.message);
    }
  },

  _getChannelIcon(type) {
    const icons = {
      feishu: '&#128038;',     // Bird for Feishu
      dingtalk: '&#128241;',   // Phone for DingTalk
      qq: '&#128037;',         // Penguin-like for QQ
      wechat: '&#128172;'      // Chat bubble for WeChat
    };
    return icons[type] || '&#128226;';
  },

  _getChannelColor(type) {
    const colors = {
      feishu: '#3370FF',      // Feishu blue
      dingtalk: '#0089FF',    // DingTalk blue
      qq: '#12B7F5',          // QQ blue
      wechat: '#07C160'       // WeChat green
    };
    return colors[type] || '#666';
  }
};
