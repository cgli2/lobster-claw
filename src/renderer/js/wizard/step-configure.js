/* eslint-disable no-unused-vars, no-undef */
const StepConfigure = {
  // 厂商配置统一由 js/utils/providers-data.js 中的 PROVIDER_DATA 维护
  // 安装向导使用全部厂商（包含 wizardOnly 的条目，如 qwen-oauth）
  get _providerData() { return PROVIDER_DATA; },

  render(container) {
    clearChildren(container);

    const providerOptions = Object.entries(this._providerData)
      .map(([id, p]) => `<option value="${id}">${p.name}</option>`)
      .join('');

    container.innerHTML = `
      <h2>${TEXT.WIZARD_CONFIG_TITLE}</h2>
      <p class="step-desc">${TEXT.WIZARD_CONFIG_DESC}</p>
      <div class="config-form" id="config-form">

        <!-- Section 1: AI Provider -->
        <div class="config-section" id="section-provider">
          <div class="config-section-header">
            <span class="config-section-title">${TEXT.WIZARD_CONFIG_SECTION_PROVIDER}</span>
            <span class="config-section-toggle">&#9660;</span>
          </div>
          <div class="config-section-body">
            <div class="config-field">
              <label>${TEXT.WIZARD_CONFIG_PROVIDER}</label>
              <select id="cfg-provider">
                ${providerOptions}
                <option value="custom">自定义</option>
              </select>
            </div>
            <div class="config-field" id="cfg-custom-name-field" style="display:none;">
              <label>${TEXT.WIZARD_CONFIG_CUSTOM_PROVIDER}</label>
              <input type="text" id="cfg-custom-name" placeholder="my-provider">
            </div>
            <div class="config-field">
              <label>${TEXT.WIZARD_CONFIG_APIKEY}</label>
              <div class="field-row">
                <input type="password" id="cfg-apikey" placeholder="" style="flex:1;">
                <button class="btn btn-sm btn-ghost" id="cfg-apikey-toggle">${TEXT.BTN_SHOW}</button>
              </div>
              <span style="font-size: 11px; color: var(--text-muted);">${TEXT.WIZARD_CONFIG_APIKEY_HINT}</span>
            </div>
            <div class="config-field">
              <label>${TEXT.WIZARD_CONFIG_BASEURL}</label>
              <input type="text" id="cfg-baseurl" placeholder="">
            </div>
            <div class="config-field">
              <label>${TEXT.WIZARD_CONFIG_MODEL}</label>
              <div id="cfg-model-wrapper"></div>
            </div>
            <div id="cfg-test-area" style="margin-top: 4px;">
              <div class="field-row" style="gap: 12px; align-items: center;">
                <button class="btn btn-sm" id="cfg-test-btn">${TEXT.WIZARD_CONFIG_TEST_BTN}</button>
                <span id="cfg-test-result" style="font-size: 12px;"></span>
              </div>
            </div>
          </div>
        </div>

        <!-- Section 2: Gateway -->
        <div class="config-section collapsed" id="section-gateway">
          <div class="config-section-header">
            <span class="config-section-title">${TEXT.WIZARD_CONFIG_SECTION_GATEWAY}</span>
            <span class="config-section-toggle">&#9660;</span>
          </div>
          <div class="config-section-body">
            <div class="config-field">
              <label>${TEXT.WIZARD_CONFIG_GATEWAY_PORT}</label>
              <input type="number" id="cfg-gateway-port" value="18789" min="1024" max="65535">
            </div>
            <div class="config-field">
              <label>${TEXT.WIZARD_CONFIG_GATEWAY_BIND}</label>
              <input type="text" id="cfg-gateway-bind" value="loopback" placeholder="loopback">
            </div>
            <div class="config-field">
              <label>${TEXT.WIZARD_CONFIG_GATEWAY_TOKEN}</label>
              <div class="field-row">
                <input type="text" id="cfg-gateway-token" placeholder="可选" style="flex:1;">
                <button class="btn btn-sm btn-ghost" id="cfg-gen-token">${TEXT.WIZARD_CONFIG_GATEWAY_TOKEN_GEN}</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Section 3: Default Models -->
        <div class="config-section collapsed" id="section-models">
          <div class="config-section-header">
            <span class="config-section-title">${TEXT.WIZARD_CONFIG_SECTION_MODELS}</span>
            <span class="config-section-toggle">&#9660;</span>
          </div>
          <div class="config-section-body">
            <div class="config-field">
              <label>${TEXT.WIZARD_CONFIG_CODING_MODEL}</label>
              <input type="text" id="cfg-coding-model" placeholder="留空使用默认值">
            </div>
            <div class="config-field">
              <label>${TEXT.WIZARD_CONFIG_CHAT_MODEL}</label>
              <input type="text" id="cfg-chat-model" placeholder="留空使用默认值">
            </div>
          </div>
        </div>

        <!-- Section 4: Advanced -->
        <div class="config-section collapsed" id="section-advanced">
          <div class="config-section-header">
            <span class="config-section-title">${TEXT.WIZARD_CONFIG_SECTION_ADVANCED}</span>
            <span class="config-section-toggle">&#9660;</span>
          </div>
          <div class="config-section-body">
            <div class="config-field">
              <label>${TEXT.WIZARD_CONFIG_WORKSPACE}</label>
              <div class="field-row">
                <input type="text" id="cfg-workspace" placeholder="留空使用默认值" style="flex:1;">
                <button class="btn btn-sm btn-ghost" id="cfg-workspace-browse">浏览</button>
              </div>
            </div>
          </div>
        </div>

      </div>

      <div class="wizard-actions">
        <button class="btn" id="config-prev-btn">${TEXT.BTN_PREV}</button>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-ghost" id="config-skip-btn">${TEXT.WIZARD_CONFIG_SKIP}</button>
          <button class="btn btn-primary" id="config-save-btn">${TEXT.BTN_SAVE} & ${TEXT.BTN_NEXT}</button>
        </div>
      </div>
    `;

    this._bindEvents();
    this._updateProviderFields();
  },

  _bindEvents() {
    // Section collapse/expand
    $$('.config-section-header').forEach(header => {
      header.addEventListener('click', () => {
        header.parentElement.classList.toggle('collapsed');
      });
    });

    // Provider change
    $('#cfg-provider').addEventListener('change', () => this._updateProviderFields());

    // API key toggle
    $('#cfg-apikey-toggle').addEventListener('click', () => {
      const input = $('#cfg-apikey');
      const btn = $('#cfg-apikey-toggle');
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = TEXT.BTN_HIDE;
      } else {
        input.type = 'password';
        btn.textContent = TEXT.BTN_SHOW;
      }
    });

    // Generate token
    $('#cfg-gen-token').addEventListener('click', () => {
      const token = crypto.randomUUID ? crypto.randomUUID() : this._generateUUID();
      $('#cfg-gateway-token').value = token;
    });

    // Workspace browse
    $('#cfg-workspace-browse').addEventListener('click', async () => {
      try {
        const result = await window.openclawAPI.dialog.selectDirectory();
        if (result.success && result.path) {
          $('#cfg-workspace').value = result.path;
        }
      } catch (err) {
        // 忽略取消操作
      }
    });

    // Test connection
    $('#cfg-test-btn').addEventListener('click', () => this._testConnection());

    // Navigation
    $('#config-prev-btn').addEventListener('click', () => WizardController.prev());
    $('#config-skip-btn').addEventListener('click', () => WizardController.next());
    $('#config-save-btn').addEventListener('click', () => this._saveAndNext());
  },

  _updateProviderFields() {
    const provider = $('#cfg-provider').value;
    const customField = $('#cfg-custom-name-field');
    const baseUrlInput = $('#cfg-baseurl');
    const apiKeyInput = $('#cfg-apikey');
    const modelWrapper = $('#cfg-model-wrapper');

    // Clear test result on provider change
    const testResult = $('#cfg-test-result');
    if (testResult) testResult.textContent = '';

    // Show/hide custom name field
    if (customField) {
      customField.style.display = provider === 'custom' ? '' : 'none';
    }

    // Set base URL and placeholder, render model field
    if (provider !== 'custom' && this._providerData[provider]) {
      const data = this._providerData[provider];
      baseUrlInput.value = data.baseUrl;
      apiKeyInput.placeholder = data.placeholder;

      // Ollama or providers with models: null → free-form input
      if (!data.models) {
        modelWrapper.innerHTML = `<input type="text" id="cfg-model" placeholder="${data.modelPlaceholder || '输入模型名称'}">`;
      } else {
        // Use <select> for known providers with predefined models
        const options = data.models
          .map((m, i) => `<option value="${m}" ${i === 0 ? 'selected' : ''}>${m}</option>`)
          .join('');
        modelWrapper.innerHTML = `<select id="cfg-model">${options}</select>`;
      }

      // Mark API key as optional for providers like Ollama
      const apiKeyHint = apiKeyInput.parentElement?.parentElement?.querySelector('span');
      if (data.noApiKey) {
        apiKeyInput.removeAttribute('required');
        if (apiKeyHint) apiKeyHint.textContent = 'Ollama 本地运行通常不需要 API Key，可留空';
      } else {
        if (apiKeyHint) apiKeyHint.textContent = TEXT.WIZARD_CONFIG_APIKEY_HINT;
      }
    } else {
      baseUrlInput.value = '';
      apiKeyInput.placeholder = 'API Key';

      // Use <input> for custom provider so user can freely type
      modelWrapper.innerHTML = `<input type="text" id="cfg-model" placeholder="输入模型名称，如 gpt-4o、claude-sonnet-4 等">`;

      const apiKeyHint = apiKeyInput.parentElement?.parentElement?.querySelector('span');
      if (apiKeyHint) apiKeyHint.textContent = TEXT.WIZARD_CONFIG_APIKEY_HINT;
    }
  },

  /** Get the current model value regardless of whether it's a select or input */
  _getModelValue() {
    const el = $('#cfg-model');
    return el ? el.value.trim() : '';
  },

  async _testConnection() {
    const btn = $('#cfg-test-btn');
    const resultEl = $('#cfg-test-result');

    const provider = $('#cfg-provider').value;
    const providerData = this._providerData[provider];
    const apiKey = $('#cfg-apikey').value.trim();
    const baseUrl = $('#cfg-baseurl').value.trim();
    const model = this._getModelValue();

    // Ollama (noApiKey) doesn't require an API key
    if (!apiKey && !(providerData && providerData.noApiKey)) {
      resultEl.style.color = 'var(--warning)';
      resultEl.textContent = TEXT.WIZARD_CONFIG_TEST_NO_KEY;
      return;
    }
    if (!baseUrl) {
      resultEl.style.color = 'var(--warning)';
      resultEl.textContent = TEXT.WIZARD_CONFIG_TEST_NO_URL;
      return;
    }
    if (!model) {
      resultEl.style.color = 'var(--warning)';
      resultEl.textContent = TEXT.WIZARD_CONFIG_TEST_NO_MODEL;
      return;
    }

    btn.disabled = true;
    btn.textContent = TEXT.WIZARD_CONFIG_TEST_TESTING;
    resultEl.style.color = 'var(--text-muted)';
    resultEl.textContent = '';

    try {
      const result = await window.openclawAPI.config.testConnection({ apiKey, baseUrl, model });

      if (result.success) {
        resultEl.style.color = 'var(--success)';
        resultEl.textContent = TEXT.WIZARD_CONFIG_TEST_OK + (result.message ? ' - ' + result.message : '');
      } else {
        resultEl.style.color = 'var(--danger)';
        resultEl.textContent = TEXT.WIZARD_CONFIG_TEST_FAIL + ': ' + (result.message || '未知错误');
      }
    } catch (err) {
      resultEl.style.color = 'var(--danger)';
      resultEl.textContent = TEXT.WIZARD_CONFIG_TEST_FAIL + ': ' + err.message;
    }

    btn.disabled = false;
    btn.textContent = TEXT.WIZARD_CONFIG_TEST_BTN;
  },

  async _saveAndNext() {
    const saveBtn = $('#config-save-btn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = TEXT.WIZARD_CONFIG_SAVING; }

    try {
      const provider = $('#cfg-provider').value;
      const formData = {
        provider: provider === 'custom' ? ($('#cfg-custom-name').value.trim() || 'custom') : provider,
        providerName: provider === 'custom' ? ($('#cfg-custom-name').value.trim() || 'custom') : undefined,
        apiKey: $('#cfg-apikey').value.trim(),
        baseUrl: $('#cfg-baseurl').value.trim(),
        model: this._getModelValue() || null,
        gateway: {
          port: $('#cfg-gateway-port').value,
          bind: $('#cfg-gateway-bind').value.trim(),
          authToken: $('#cfg-gateway-token').value.trim() || undefined
        },
        defaults: {
          codingModel: $('#cfg-coding-model').value.trim() || undefined,
          chatModel: $('#cfg-chat-model').value.trim() || undefined
        },
        advanced: {
          workspacePath: $('#cfg-workspace').value.trim() || undefined
        }
      };

      // Write config if at least provider is chosen (Ollama may have no API key)
      const providerInfo = this._providerData[provider];
      if (formData.apiKey || (providerInfo && providerInfo.noApiKey)) {
        await window.openclawAPI.config.writeOnboard(formData);

        // 配置统一保存在 openclaw.json 中
        // 不再额外写入 auth-profiles.json，openclaw 会通过读取 openclaw.json 获取配置

        Toast.success(TEXT.WIZARD_CONFIG_SAVE_SUCCESS);
      }

      WizardController.next();
    } catch (err) {
      Toast.error(TEXT.WIZARD_CONFIG_SAVE_ERROR + ': ' + err.message);
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = TEXT.BTN_SAVE + ' & ' + TEXT.BTN_NEXT; }
    }
  },

  _generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
};
