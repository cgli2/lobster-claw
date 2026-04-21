/* eslint-disable no-unused-vars, no-undef */
const TabApiKeys = {
  _config: null,
  _envData: {},   // .env 文件中的明文 Key（唯一真实存储）
  _providers: [], // 缓存已配置的厂商列表

  // 厂商配置统一由 js/utils/providers-data.js 中的 PROVIDER_DATA 维护
  // 管理面板只显示非 wizardOnly 的厂商（wizardOnly 仅在安装向导中使用，如 qwen-oauth）
  get _providerData() {
    return Object.fromEntries(
      Object.entries(PROVIDER_DATA).filter(([, v]) => !v.wizardOnly)
    );
  },

  async render(container) {
    container.innerHTML = `
      <h2>${TEXT.APIKEYS_TITLE}</h2>
      <div class="action-bar">
        <div class="left">
          <button class="btn btn-primary" id="apikeys-add-btn">${TEXT.APIKEYS_ADD}</button>
        </div>
        <div class="right">
          <button class="btn" id="apikeys-refresh-btn">${TEXT.BTN_REFRESH}</button>
        </div>
      </div>
      <!-- 默认厂商选择区域 -->
      <div id="default-provider-section" class="card" style="margin-bottom: 16px; display: none;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div>
            <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 4px;">默认模型服务商</div>
            <div style="font-size: 16px; font-weight: 600;">
              <span id="default-provider-name">-</span>
              <span id="default-provider-model" style="color: var(--text-muted); font-size: 13px; margin-left: 8px;"></span>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 12px;">
            <select class="input" id="default-provider-select" style="min-width: 200px;">
              <option value="">选择默认厂商...</option>
            </select>
            <button class="btn btn-sm btn-primary" id="set-default-btn">设为默认</button>
          </div>
        </div>
      </div>
      <div id="apikeys-list"></div>
    `;

    $('#apikeys-add-btn').addEventListener('click', () => this._showAddModal());
    $('#apikeys-refresh-btn').addEventListener('click', () => this._loadKeys());
    $('#set-default-btn').addEventListener('click', () => this._setDefaultProvider());

    await this._loadKeys();
  },

  async _loadKeys() {
    const list = $('#apikeys-list');
    list.innerHTML = '<div class="spinner spinner-lg" style="margin: 20px;"></div>';

    try {
      this._config = await window.openclawAPI.config.read();
      // 同时读取 .env，获取真实明文 Key
      this._envData = await window.openclawAPI.env.read();

      // 静默迁移：修复历史遗留数据
      await this._migrateConfig();

      this._providers = this._extractProviders(this._config, this._envData);

      // 更新默认厂商选择区域
      this._updateDefaultProviderSection();

      if (this._providers.length === 0) {
        list.innerHTML = `<div class="empty-state"><div class="empty-icon">&#128273;</div><p>${TEXT.APIKEYS_NO_PROVIDERS}</p></div>`;
        return;
      }

      list.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>服务商</th>
                <th>Base URL</th>
                <th>API Key</th>
                <th>默认</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody id="apikeys-tbody"></tbody>
          </table>
        </div>
      `;

      // 获取当前默认厂商
      const defaultProvider = this._getDefaultProvider();

      const tbody = $('#apikeys-tbody');
      for (const p of this._providers) {
        const isDefault = p.id === defaultProvider;
        const tr = createElement('tr');
        tr.innerHTML = `
          <td>
            <strong>${p.name}</strong>
            ${isDefault ? '<span class="badge badge-success" style="margin-left: 8px;">默认</span>' : ''}
          </td>
          <td><code>${p.baseUrl || '-'}</code></td>
          <td>
            <code class="api-key-display" data-provider-id="${this._escapeAttr(p.id)}" data-key="${this._escapeAttr(p.key)}" data-masked="true">${maskApiKey(p.key)}</code>
          </td>
          <td>
            <button class="btn btn-sm ${isDefault ? 'btn-primary' : 'btn-ghost'} set-default-row-btn" data-provider-id="${this._escapeAttr(p.id)}" ${isDefault ? 'disabled' : ''}>
              ${isDefault ? '当前' : '设为默认'}
            </button>
          </td>
          <td>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-sm btn-ghost toggle-key-btn">${TEXT.BTN_SHOW}</button>
              <button class="btn btn-sm btn-ghost edit-key-btn" data-provider-id="${this._escapeAttr(p.id)}">${TEXT.BTN_EDIT}</button>
              <button class="btn btn-sm btn-danger delete-key-btn" data-provider-id="${this._escapeAttr(p.id)}">${TEXT.BTN_DELETE}</button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      }

      // Bind toggle buttons
      $$('.toggle-key-btn', tbody).forEach(btn => {
        btn.addEventListener('click', () => {
          const code = btn.closest('tr').querySelector('.api-key-display');
          if (code.dataset.masked === 'true') {
            code.textContent = code.dataset.key;
            code.dataset.masked = 'false';
            btn.textContent = TEXT.BTN_HIDE;
          } else {
            code.textContent = maskApiKey(code.dataset.key);
            code.dataset.masked = 'true';
            btn.textContent = TEXT.BTN_SHOW;
          }
        });
      });

      // Bind delete buttons
      $$('.delete-key-btn', tbody).forEach(btn => {
        btn.addEventListener('click', () => this._deleteProvider(btn.dataset.providerId));
      });

      // Bind edit buttons
      $$('.edit-key-btn', tbody).forEach(btn => {
        btn.addEventListener('click', () => {
          const provider = this._providers.find(p => p.id === btn.dataset.providerId);
          if (provider) this._showEditModal(provider);
        });
      });

      // Bind set default buttons
      $$('.set-default-row-btn', tbody).forEach(btn => {
        btn.addEventListener('click', () => {
          if (!btn.disabled) {
            this._setDefaultProvider(btn.dataset.providerId);
          }
        });
      });

    } catch (err) {
      list.innerHTML = `<p style="color: var(--danger);">加载失败：${err.message}</p>`;
    }
  },

  /**
   * 获取当前默认厂商ID
   */
  _getDefaultProvider() {
    if (!this._config) return null;
    
    // 从 agents.defaults.model.primary 解析（格式: "providerId/modelName"）
    const primary = this._config.agents?.defaults?.model?.primary;
    if (primary) {
      const parts = primary.split('/');
      if (parts.length > 0) {
        return parts[0].toLowerCase();
      }
    }
    
    // 兼容旧配置：从 models.defaultProvider 获取
    if (this._config.models?.defaultProvider) {
      return this._config.models.defaultProvider;
    }
    
    // 兼容旧配置：从 models.default 解析
    if (this._config.models?.default) {
      const parts = this._config.models.default.split('.');
      if (parts.length > 0) {
        return parts[0].toLowerCase();
      }
    }
    
    return null;
  },

  /**
   * 获取默认厂商的模型名称
   */
  _getDefaultModel() {
    if (!this._config) return null;
    
    // 从 agents.defaults.model.primary 解析（格式: "providerId/modelName"）
    const primary = this._config.agents?.defaults?.model?.primary;
    if (primary) {
      const parts = primary.split('/');
      if (parts.length > 1) {
        return parts.slice(1).join('/');
      }
    }
    
    // 兼容旧配置
    if (this._config.models?.default) {
      const parts = this._config.models.default.split('.');
      if (parts.length > 1) {
        return parts.slice(1).join('.');
      }
    }
    
    return null;
  },

  /**
   * 更新默认厂商选择区域
   */
  _updateDefaultProviderSection() {
    const section = $('#default-provider-section');
    const select = $('#default-provider-select');
    const nameEl = $('#default-provider-name');
    const modelEl = $('#default-provider-model');
    
    if (!section || !select) return;
    
    // 如果没有配置的厂商，隐藏该区域
    if (this._providers.length === 0) {
      section.style.display = 'none';
      return;
    }
    
    section.style.display = '';
    
    // 填充下拉框
    select.innerHTML = '<option value="">选择厂商...</option>';
    for (const p of this._providers) {
      const option = createElement('option', { value: p.id }, p.name);
      select.appendChild(option);
    }
    
    // 更新当前默认厂商显示
    const defaultProvider = this._getDefaultProvider();
    const defaultModel = this._getDefaultModel();
    
    if (defaultProvider) {
      const provider = this._providers.find(p => p.id === defaultProvider);
      if (provider) {
        nameEl.textContent = provider.name;
        if (defaultModel) {
          modelEl.textContent = `(${defaultModel})`;
        } else {
          modelEl.textContent = '';
        }
        select.value = defaultProvider;
      } else {
        nameEl.textContent = defaultProvider;
        modelEl.textContent = '';
      }
    } else {
      nameEl.textContent = '未设置';
      modelEl.textContent = '';
    }
  },

  /**
   * 设置默认厂商
   */
  async _setDefaultProvider(providerId) {
    // 如果没有传入providerId，从下拉框获取
    if (!providerId) {
      providerId = $('#default-provider-select')?.value;
    }
    
    if (!providerId) {
      Toast.warning('请选择一个厂商');
      return;
    }
    
    const provider = this._providers.find(p => p.id === providerId);
    if (!provider) {
      Toast.error('未找到该厂商配置');
      return;
    }
    
    try {
      const config = this._config || {};
      
      // 获取该厂商的第一个模型作为默认模型
      let defaultModel = null;
      if (config.models?.providers?.[providerId]) {
        const providerConfig = config.models.providers[providerId];
        if (providerConfig.models && providerConfig.models.length > 0) {
          defaultModel = providerConfig.models[0];
          // 可能是对象格式 {id: 'xxx'} 或字符串格式
          if (typeof defaultModel === 'object' && defaultModel.id) {
            defaultModel = defaultModel.id;
          }
        }
      }
      
      // 设置 agents.defaults.model.primary（openclaw CLI 使用此配置）
      // 格式为 "providerId/modelName"，如 "qwen/qwen3.5-plus"
      if (!config.agents) config.agents = {};
      if (!config.agents.defaults) config.agents.defaults = {};
      if (!config.agents.defaults.model) config.agents.defaults.model = {};
      
      // 使用斜杠格式，这是 openclaw CLI 期望的格式
      if (defaultModel) {
        config.agents.defaults.model.primary = `${providerId}/${defaultModel}`;
      } else {
        config.agents.defaults.model.primary = providerId;
      }
      
      // 清理非法字段（如果存在）
      if (config.models) {
        delete config.models.defaultProvider;
        delete config.models.default;
      }
      
      await window.openclawAPI.config.write(config);
      Toast.success(`已将 ${provider.name} 设为默认厂商`);
      
      // 刷新列表
      await this._loadKeys();
    } catch (err) {
      Toast.error('设置失败：' + err.message);
    }
  },

  /**
   * 静默迁移：修复历史遗留配置数据，无需用户手动操作
   * 1. 将 env.vars 中的明文 Key 迁移到 .env，并从 env.vars 清除
   * 2. 为 models.providers 中缺少 api 字段的厂商补全
   */
  async _migrateConfig() {
    const config = this._config;
    if (!config) return;

    let configDirty = false;

    // 迁移1：env.vars 明文 Key → .env
    const vars = config.env?.vars || {};
    const keysToMigrate = Object.keys(vars).filter(k => k.endsWith('_API_KEY') && vars[k]);
    if (keysToMigrate.length > 0) {
      for (const key of keysToMigrate) {
        // 只有 .env 中没有该 Key 时才迁移（避免覆盖已有的更新值）
        if (!this._envData[key]) {
          await window.openclawAPI.env.setApiKey(key, vars[key]);
          this._envData[key] = vars[key];
        }
        delete vars[key];
      }
      if (Object.keys(vars).length === 0) {
        delete config.env.vars;
        if (Object.keys(config.env).length === 0) delete config.env;
      }
      configDirty = true;
    }

    // 迁移2：models.providers 缺少 api 字段 → 补全
    const providers = config.models?.providers || {};
    for (const [id, cfg] of Object.entries(providers)) {
      if (!cfg.api && id !== 'ollama') {
        // 从 PROVIDER_DATA 查找（先按 key 查，再按 providerId 查）
        const pd = PROVIDER_DATA[id] || Object.values(PROVIDER_DATA).find(d => d.providerId === id);
        cfg.api = pd?.api || 'openai-completions';
        configDirty = true;
      }
    }

    // 有变化才写回
    if (configDirty) {
      await window.openclawAPI.config.write(config);
    }
  },

  /**
   * 从配置中提取已配置的厂商列表
   * 策略：以 models.providers 为权威来源（知道有哪些厂商），
   *       Key 的真实值从 .env 文件读取（唯一存储明文的地方）
   */
  _extractProviders(config, envData = {}) {
    const providers = [];
    const seenIds = new Set();

    // 主要来源：models.providers（知道有哪些厂商及其配置）
    if (config && config.models && config.models.providers) {
      for (const [name, cfg] of Object.entries(config.models.providers)) {
        const id = name.toLowerCase();
        if (seenIds.has(id)) continue;

        // apiKey 字段可能是 ${VAR_NAME} 引用，也可能是明文
        let realKey = '';
        const apiKeyField = cfg.apiKey || '';
        const varMatch = apiKeyField.match(/^\$\{([^}]+)\}$/);
        if (varMatch) {
          // ${VAR_NAME} 引用 → 从 .env 取真实值
          realKey = envData[varMatch[1]] || '';
        } else if (apiKeyField && apiKeyField !== 'ollama') {
          // 旧版明文存储，直接使用
          realKey = apiKeyField;
        }

        // 没有 Key 且不是 ollama，也保留（可能尚未配置）
        const providerInfo = this._providerData[id];
        providers.push({
          id,
          name: providerInfo ? providerInfo.name : name,
          key: realKey,
          baseUrl: cfg.baseUrl || '',
          envKey: varMatch ? varMatch[1] : (providerInfo?.envKey || id.toUpperCase() + '_API_KEY'),
          source: 'models.providers'
        });
        seenIds.add(id);
      }
    }

    // 兼容旧版：env.vars 中存了明文 Key 但 models.providers 没有对应条目
    if (config && config.env && config.env.vars) {
      for (const [key, value] of Object.entries(config.env.vars)) {
        if (!key.endsWith('_API_KEY') || !value) continue;
        const id = key.replace('_API_KEY', '').toLowerCase();
        if (seenIds.has(id)) continue;
        const providerInfo = this._providerData[id];
        providers.push({
          id,
          name: providerInfo ? providerInfo.name : key.replace('_API_KEY', ''),
          key: value,
          baseUrl: '',
          envKey: key,
          source: 'env.vars'
        });
        seenIds.add(id);
      }
    }

    return providers;
  },

  _showAddModal() {
  const overlay = $('#modal-overlay');
  const title= $('#modal-title');
  const body = $('#modal-body');
  const footer= $('#modal-footer');

    title.textContent = TEXT.APIKEYS_ADD;
    
    // 复用安装向导的配置界面
  const providerOptions = Object.entries(this._providerData)
      .map(([id, p]) => `<option value="${id}">${p.name}</option>`)
      .join('');
    
    body.innerHTML = `
      <div class="form-group">
        <label>服务商</label>
        <select class="input" id="modal-provider-select">
          ${providerOptions}
          <option value="custom">自定义</option>
        </select>
      </div>
      <div class="form-group" id="modal-custom-name-group" style="display:none;">
        <label>自定义服务商名称</label>
        <input class="input" id="modal-custom-name" placeholder="my-provider">
      </div>
      <div class="form-group">
        <label>Base URL</label>
        <input class="input" id="modal-base-url" placeholder="https://...">
      </div>
      <div class="form-group">
        <label>API Key</label>
        <div class="field-row">
          <input class="input" id="modal-api-key" type="password" placeholder="" style="flex:1;">
          <button class="btn btn-sm btn-ghost" id="modal-apikey-toggle">显示</button>
        </div>
        <small style="color: var(--text-muted);" id="modal-apikey-hint"></small>
      </div>
      <div class="form-group">
        <label>模型</label>
        <div id="modal-model-wrapper">
          <input class="input" id="modal-model-name" placeholder="输入模型名称">
        </div>
      </div>
      <div class="field-row" style="gap: 12px; align-items: center; margin-top: 8px;">
        <button class="btn btn-sm" id="modal-test-btn">测试连接</button>
        <span id="modal-test-result" style="font-size: 12px;"></span>
      </div>
    `;
    footer.innerHTML = `
      <button class="btn" id="modal-cancel-btn">${TEXT.BTN_CANCEL}</button>
      <button class="btn btn-primary" id="modal-save-btn">${TEXT.BTN_SAVE}</button>
    `;

    show(overlay);

    // API key 显示/隐藏切换
    $('#modal-apikey-toggle').addEventListener('click', () => {
  const input = $('#modal-api-key');
  const btn = $('#modal-apikey-toggle');
  if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '隐藏';
      } else {
        input.type = 'password';
        btn.textContent = '显示';
      }
    });

    // 服务商变更时更新字段
    $('#modal-provider-select').addEventListener('change', () => {
  const providerId = $('#modal-provider-select').value;
  const customGroup = $('#modal-custom-name-group');
  const modelWrapper= $('#modal-model-wrapper');
      
  if (providerId === 'custom') {
   customGroup.style.display = '';
        $('#modal-base-url').value = '';
        $('#modal-api-key').placeholder= 'sk-...';
        $('#modal-apikey-hint').textContent = '请输入您的 API Key';
    modelWrapper.innerHTML = `<input class="input" id="modal-model-name" placeholder="输入模型名称，如 gpt-4o、claude-sonnet-4 等">`;
      } else {
   customGroup.style.display = 'none';
   const data = this._providerData[providerId];
        $('#modal-base-url').value = data.baseUrl;
        $('#modal-api-key').placeholder= data.placeholder;
        
        // Ollama 或没有模型的供应商 → 自由输入
    if (!data.models) {
      modelWrapper.innerHTML = `<input class="input" id="modal-model-name" placeholder="${data.modelPlaceholder || '输入模型名称'}">`;
        } else {
          // 有预定义模型的供应商 → 使用 select
      const options = data.models
            .map((m, i) => `<option value="${m}" ${i === 0 ? 'selected' : ''}>${m}</option>`)
            .join('');
      modelWrapper.innerHTML = `<select class="input" id="modal-model-name">${options}</select>`;
        }
        
        // API Key 提示
    if (data.noApiKey) {
          $('#modal-api-key').removeAttribute('required');
          $('#modal-apikey-hint').textContent = 'Ollama 本地运行通常不需要 API Key，可留空';
        } else {
          $('#modal-apikey-hint').textContent = '请输入您的 API Key';
        }
      }
    });

    // 初始化当前选中供应商的字段
  const initialProviderId = $('#modal-provider-select').value;
  const event = new Event('change');
    $('#modal-provider-select').dispatchEvent(event);

    // 测试连接按钮
    $('#modal-test-btn').addEventListener('click', () => this._testConnection());

    $('#modal-cancel-btn').addEventListener('click', () => hide(overlay));
    $('#modal-close').addEventListener('click', () => hide(overlay));
    $('#modal-save-btn').addEventListener('click', async () => {
      const providerId = $('#modal-provider-select').value;
      const customName = $('#modal-custom-name').value.trim();
      const baseUrl = $('#modal-base-url').value.trim();
      const apiKey = $('#modal-api-key').value.trim();
      const model = $('#modal-model-name').value.trim();

      const providerName = providerId === 'custom' ? (customName || 'CUSTOM') : providerId.toUpperCase();
      
      if (!baseUrl) { Toast.warning('请填写 Base URL'); return; }
      if (!apiKey && providerId !== 'ollama') { Toast.warning('请填写 API Key'); return; }
      if (!model) { Toast.warning('请填写模型名称'); return; }

      // 构建配置对象
      const config = this._config || {};
      if (!config.models) config.models = {};
      if (!config.models.providers) config.models.providers = {};

      // 确定环境变量名
      const providerDataEntry = this._providerData[providerId];
      const envVarName = providerDataEntry?.envKey || (providerName + '_API_KEY');

      // 1. 将真实 API Key 写入 .env（唯一存储明文的地方）
      if (apiKey) {
        await window.openclawAPI.env.setApiKey(envVarName, apiKey);
      }

      // 2. openclaw.json 中只存 ${VAR} 引用，不存明文
      const actualProviderId = providerId === 'custom' ? customName.toLowerCase() : (providerDataEntry?.providerId || providerId);
      const providerConfig = {
        baseUrl: baseUrl,
        apiKey: apiKey ? `\${${envVarName}}` : '',  // 引用，非明文
        models: [{ id: model, name: model }]
      };
      // 写入 api 协议类型（从 PROVIDER_DATA 获取，缺省 openai-completions）
      if (providerDataEntry?.api) {
        providerConfig.api = providerDataEntry.api;
      } else if (!providerDataEntry?.noApiKey) {
        // 有 apiKey 的厂商默认使用 openai-completions
        providerConfig.api = 'openai-completions';
      }
      config.models.providers[actualProviderId] = providerConfig;

      // 3. 清理 env.vars 中的明文 Key（新方式只用 .env，不再用 env.vars）
      if (config.env && config.env.vars) {
        delete config.env.vars[envVarName];
        // 如果 env.vars 空了，删除整个节点保持配置整洁
        if (Object.keys(config.env.vars).length === 0) {
          delete config.env.vars;
          if (Object.keys(config.env).length === 0) delete config.env;
        }
      }

      // 4. 设置默认模型（只有在没有设置时才自动设置）
      if (!config.agents?.defaults?.model?.primary) {
        if (!config.agents) config.agents = {};
        if (!config.agents.defaults) config.agents.defaults = {};
        if (!config.agents.defaults.model) config.agents.defaults.model = {};
        config.agents.defaults.model.primary = `${actualProviderId}/${model}`;
      }

      await window.openclawAPI.config.write(config);

      // 配置统一保存在 openclaw.json 中
      // 不再额外写入 auth-profiles.json 和 models.json
      // openclaw 会通过读取 openclaw.json 获取配置

      Toast.success(TEXT.TOAST_SAVED);
      hide(overlay);
      this._loadKeys();
    });
  },

  async _testConnection() {
  const btn = $('#modal-test-btn');
  const resultEl = $('#modal-test-result');

  const providerId = $('#modal-provider-select').value;
  const providerData = this._providerData[providerId];
  const apiKey = $('#modal-api-key').value.trim();
  const baseUrl = $('#modal-base-url').value.trim();
  const model = $('#modal-model-name').value.trim();

  // Ollama (noApiKey) doesn't require an API key
  if (!apiKey && !(providerData && providerData.noApiKey)) {
    resultEl.style.color = 'var(--warning)';
    resultEl.textContent = '请先填写 API Key';
    return;
  }
  if (!baseUrl) {
    resultEl.style.color = 'var(--warning)';
    resultEl.textContent = '请先填写 Base URL';
    return;
  }
  if (!model) {
    resultEl.style.color = 'var(--warning)';
    resultEl.textContent = '请先填写或选择模型';
    return;
  }

  btn.disabled = true;
  btn.textContent = '测试中...';
  resultEl.style.color = 'var(--text-muted)';
  resultEl.textContent = '';

  try {
  const result = await window.openclawAPI.config.testConnection({ apiKey, baseUrl, model });

  if (result.success) {
      resultEl.style.color = 'var(--success)';
      resultEl.textContent = '连接成功！' + (result.message ? ' - ' + result.message : '');
    } else {
      resultEl.style.color = 'var(--danger)';
      resultEl.textContent = '连接失败：' + (result.message || '未知错误');
    }
  } catch(err) {
    resultEl.style.color = 'var(--danger)';
    resultEl.textContent = '测试出错：' + err.message;
  }

  btn.disabled = false;
  btn.textContent = '测试连接';
  },

  _showEditModal(provider) {
    const overlay = $('#modal-overlay');
    const title = $('#modal-title');
    const body = $('#modal-body');
    const footer = $('#modal-footer');

    // 获取当前配置的模型信息
    const config = this._config || {};
    const providerConfig = config.models?.providers?.[provider.id] || {};
    const currentModels = providerConfig.models || [];
    const currentModel = currentModels.length > 0
      ? (typeof currentModels[0] === 'object' ? currentModels[0].id : currentModels[0])
      : '';

    // 获取该 provider 的预定义模型列表（如果有）
    const providerData = this._providerData[provider.id];
    const hasPresetModels = providerData && providerData.models && providerData.models.length > 0;

    // 构建模型选择UI
    let modelInputHtml;
    if (hasPresetModels) {
      const options = providerData.models
        .map(m => `<option value="${m}" ${m === currentModel ? 'selected' : ''}>${m}</option>`)
        .join('');
      modelInputHtml = `<select class="input" id="modal-edit-model">${options}</select>`;
    } else {
      modelInputHtml = `<input class="input" id="modal-edit-model" value="${this._escapeAttr(currentModel)}" placeholder="输入模型名称">`;
    }

    title.textContent = '编辑 ' + provider.name;
    body.innerHTML = `
      <div class="form-group">
        <label>Base URL</label>
        <input class="input" id="modal-edit-base-url" value="${this._escapeAttr(provider.baseUrl || '')}">
      </div>
      <div class="form-group">
        <label>API Key</label>
        <div class="field-row">
          <input class="input" id="modal-edit-key" type="password" value="${this._escapeAttr(provider.key)}" style="flex:1;">
          <button class="btn btn-sm btn-ghost" id="modal-edit-key-toggle">显示</button>
        </div>
      </div>
      <div class="form-group">
        <label>模型</label>
        <div id="modal-edit-model-wrapper">
          ${modelInputHtml}
        </div>
      </div>
      <div class="field-row" style="gap: 12px; align-items: center; margin-top: 8px;">
        <button class="btn btn-sm" id="modal-edit-test-btn">测试连接</button>
        <span id="modal-edit-test-result" style="font-size: 12px;"></span>
      </div>
    `;
    footer.innerHTML = `
      <button class="btn" id="modal-cancel-btn">${TEXT.BTN_CANCEL}</button>
      <button class="btn btn-primary" id="modal-save-btn">${TEXT.BTN_SAVE}</button>
    `;

    show(overlay);

    // API key 显示/隐藏切换
    $('#modal-edit-key-toggle').addEventListener('click', () => {
      const input = $('#modal-edit-key');
      const btn = $('#modal-edit-key-toggle');
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '隐藏';
      } else {
        input.type = 'password';
        btn.textContent = '显示';
      }
    });

    // 测试连接按钮
    $('#modal-edit-test-btn').addEventListener('click', async () => {
      const btn = $('#modal-edit-test-btn');
      const resultEl = $('#modal-edit-test-result');
      const newBaseUrl = $('#modal-edit-base-url').value.trim();
      const newKey = $('#modal-edit-key').value.trim();
      const newModel = $('#modal-edit-model').value.trim();

      if (!newKey && provider.id !== 'ollama') {
        resultEl.style.color = 'var(--warning)';
        resultEl.textContent = '请先填写 API Key';
        return;
      }
      if (!newBaseUrl) {
        resultEl.style.color = 'var(--warning)';
        resultEl.textContent = '请先填写 Base URL';
        return;
      }
      if (!newModel) {
        resultEl.style.color = 'var(--warning)';
        resultEl.textContent = '请先填写或选择模型';
        return;
      }

      btn.disabled = true;
      btn.textContent = '测试中...';
      resultEl.style.color = 'var(--text-muted)';
      resultEl.textContent = '';

      try {
        const result = await window.openclawAPI.config.testConnection({ apiKey: newKey, baseUrl: newBaseUrl, model: newModel });
        if (result.success) {
          resultEl.style.color = 'var(--success)';
          resultEl.textContent = '连接成功！' + (result.message ? ' - ' + result.message : '');
        } else {
          resultEl.style.color = 'var(--danger)';
          resultEl.textContent = '连接失败：' + (result.message || '未知错误');
        }
      } catch(err) {
        resultEl.style.color = 'var(--danger)';
        resultEl.textContent = '测试出错：' + err.message;
      }

      btn.disabled = false;
      btn.textContent = '测试连接';
    });

    $('#modal-cancel-btn').addEventListener('click', () => hide(overlay));
    $('#modal-close').addEventListener('click', () => hide(overlay));
    $('#modal-save-btn').addEventListener('click', async () => {
      const newBaseUrl = $('#modal-edit-base-url').value.trim();
      const newKey = $('#modal-edit-key').value.trim();
      const newModel = $('#modal-edit-model').value.trim();

      if (!newKey && provider.id !== 'ollama') { Toast.warning('API Key 不能为空'); return; }
      if (!newModel) { Toast.warning('请填写或选择模型'); return; }

      const configToSave = this._config || {};

      // 1. 将新 Key 写入 .env（明文只存这里）
      if (newKey && provider.envKey) {
        await window.openclawAPI.env.setApiKey(provider.envKey, newKey);
      }

      // 2. 更新 openclaw.json 中 models.providers 的 apiKey 为 ${VAR} 引用（或保持引用不变）
      if (configToSave.models && configToSave.models.providers && configToSave.models.providers[provider.id]) {
        // 保持或修正为 ${VAR} 引用形式
        const refValue = provider.envKey ? `\${${provider.envKey}}` : '';
        configToSave.models.providers[provider.id].apiKey = refValue;
        configToSave.models.providers[provider.id].baseUrl = newBaseUrl;
        // 更新模型
        configToSave.models.providers[provider.id].models = [{ id: newModel, name: newModel }];
        // 补全 api 字段（如果缺失）
        if (!configToSave.models.providers[provider.id].api) {
          const pd = PROVIDER_DATA[provider.id] || Object.values(PROVIDER_DATA).find(d => d.providerId === provider.id);
          if (pd?.api) {
            configToSave.models.providers[provider.id].api = pd.api;
          } else if (provider.id !== 'ollama') {
            configToSave.models.providers[provider.id].api = 'openai-completions';
          }
        }
      }

      // 3. 清理 env.vars 中旧的明文 Key
      if (configToSave.env && configToSave.env.vars && provider.envKey) {
        delete configToSave.env.vars[provider.envKey];
        if (Object.keys(configToSave.env.vars).length === 0) {
          delete configToSave.env.vars;
          if (Object.keys(configToSave.env).length === 0) delete configToSave.env;
        }
      }

      // 4. 如果当前是默认厂商，更新默认模型
      const currentPrimary = configToSave.agents?.defaults?.model?.primary || '';
      if (currentPrimary.startsWith(provider.id + '/')) {
        configToSave.agents.defaults.model.primary = `${provider.id}/${newModel}`;
      }

      await window.openclawAPI.config.write(configToSave);

      // 配置统一保存在 openclaw.json 中
      // 不再额外写入 auth-profiles.json 和 models.json

      Toast.success(TEXT.TOAST_SAVED);
      hide(overlay);
      this._loadKeys();
    });
  },

  async _deleteProvider(providerId) {
    if (!confirm(`确定要删除该服务商的配置吗？`)) return;

    const config = this._config || {};
    
    // 检查是否是默认厂商（从 agents.defaults.model.primary 判断）
    const currentPrimary = config.agents?.defaults?.model?.primary || '';
    const isDefault = currentPrimary.startsWith(providerId + '/') || currentPrimary === providerId;

    // 找到该厂商的 envKey
    const provider = this._providers.find(p => p.id === providerId);
    const envKey = provider?.envKey;

    // 1. 从 .env 中删除 API Key（明文只存在这里）
    if (envKey) {
      await window.openclawAPI.env.removeApiKey(envKey);
    }
    
    // 2. 从 env.vars 中删除（兼容旧版残留）
    if (config.env && config.env.vars) {
      const legacyKey = providerId.toUpperCase() + '_API_KEY';
      if (config.env.vars[legacyKey]) delete config.env.vars[legacyKey];
      if (envKey && config.env.vars[envKey]) delete config.env.vars[envKey];
    }

    // 从 models.providers 中删除
    if (config.models && config.models.providers && config.models.providers[providerId]) {
      delete config.models.providers[providerId];
    }

    // 如果删除的是默认厂商，更新 agents.defaults.model.primary
    if (isDefault) {
      // 如果还有其他厂商，自动选择第一个作为默认
      const remainingProviders = Object.keys(config.models.providers || {});
      if (remainingProviders.length > 0) {
        const newDefault = remainingProviders[0];
        const providerConfig = config.models.providers[newDefault];
        if (providerConfig?.models?.[0]) {
          const model = typeof providerConfig.models[0] === 'object' 
            ? providerConfig.models[0].id 
            : providerConfig.models[0];
          config.agents.defaults.model.primary = `${newDefault}/${model}`;
        }
      } else {
        // 没有其他厂商，清除默认配置
        if (config.agents?.defaults?.model) {
          delete config.agents.defaults.model.primary;
        }
      }
    }
    
    // 清理非法字段
    if (config.models) {
      delete config.models.defaultProvider;
      delete config.models.default;
    }

    await window.openclawAPI.config.write(config);

    // 配置统一保存在 openclaw.json 中
    // 不再额外维护 auth-profiles.json 和 models.json

    Toast.success(TEXT.TOAST_DELETED);
    this._loadKeys();
  },

  _escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
};

