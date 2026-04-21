/* eslint-disable no-unused-vars, no-undef */
const TabSkills = {
  _skills: [],
  _systemSkills: [],
  _customSkills: [],
  _searchResults: [],
  _isSearching: false,
  _currentTab: 'system', // 'system' or 'custom'
  _pendingSkillIds: new Set(), // 正在操作中的技能 ID，防止重复点击

  async render(container) {
    container.innerHTML = `
      <h2>${TEXT.SKILLS_TITLE}</h2>
      <div class="action-bar">
        <div class="left">
          <button class="btn btn-primary" id="skills-marketplace-btn">${TEXT.SKILLS_MARKETPLACE}</button>
          <button class="btn btn-success" id="skills-create-btn" style="display:none;">+ 新建技能</button>
        </div>
        <div class="right">
          <button class="btn" id="skills-refresh-btn">${TEXT.BTN_REFRESH}</button>
        </div>
      </div>
      
      <!-- Tab 切换 -->
      <div class="skills-tabs" style="display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--border); padding-bottom: 0;">
        <button class="skills-tab-btn active" data-tab="system" style="
          padding: 8px 16px;
          border: none;
          background: transparent;
          border-bottom: 2px solid var(--primary);
          color: var(--primary);
          font-weight: 500;
          cursor: pointer;
        ">${TEXT.SKILLS_SYSTEM_TAB}</button>
        <button class="skills-tab-btn" data-tab="custom" style="
          padding: 8px 16px;
          border: none;
          background: transparent;
          border-bottom: 2px solid transparent;
          color: var(--text-secondary);
          font-weight: 500;
          cursor: pointer;
        ">${TEXT.SKILLS_CUSTOM_TAB}</button>
      </div>
      
      <div id="skills-list"></div>
    `;

    $('#skills-marketplace-btn').addEventListener('click', () => this._showMarketplaceModal());
    $('#skills-create-btn').addEventListener('click', () => this._showCreateModal());
    $('#skills-refresh-btn').addEventListener('click', () => this._load());
    
    // Tab 切换事件
    $$('.skills-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._switchTab(btn.dataset.tab);
      });
    });

    await this._load();
  },
  
  _switchTab(tab) {
    this._currentTab = tab;
    
    // 更新 Tab 样式
    $$('.skills-tab-btn').forEach(btn => {
      if (btn.dataset.tab === tab) {
        btn.classList.add('active');
        btn.style.borderBottomColor = 'var(--primary)';
        btn.style.color = 'var(--primary)';
      } else {
        btn.classList.remove('active');
        btn.style.borderBottomColor = 'transparent';
        btn.style.color = 'var(--text-secondary)';
      }
    });

    // 自定义 tab 才显示"新建"按钮
    const createBtn = $('#skills-create-btn');
    if (createBtn) createBtn.style.display = tab === 'custom' ? '' : 'none';
    
    this._renderCurrentTab();
  },
  
  _renderCurrentTab() {
    const skills = this._currentTab === 'system' ? this._systemSkills : this._customSkills;
    this._renderSkillsList(skills);
  },

  /** 显示/隐藏刷新按钮旁的小 loading 指示器 */
  _setRefreshLoading(loading) {
    const btn = $('#skills-refresh-btn');
    if (!btn) return;
    if (loading) {
      btn.disabled = true;
      btn.dataset.origText = btn.textContent;
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;vertical-align:middle;"></span>';
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.origText || TEXT.BTN_REFRESH;
    }
  },

  async _load(silent = false) {
    const list = $('#skills-list');
    
    if (this._skills.length === 0) {
      // 无数据时显示全屏 loading
      list.innerHTML = '<div class="spinner spinner-lg" style="margin: 20px;"></div>';
    } else if (!silent) {
      // 有数据但手动刷新时，在按钮处显示 loading
      this._setRefreshLoading(true);
    }

    try {
      const result = await window.openclawAPI.skills.list();

      if (!result.success) {
        this._setRefreshLoading(false);
        if (this._skills.length === 0) {
          list.innerHTML = `<p style="color: var(--danger);">加载失败: ${result.message}</p>`;
        } else {
          Toast.warning('刷新失败: ' + result.message);
        }
        return;
      }

      this._skills = result.skills || [];
      
      // 分离系统内置技能和自定义技能
      this._systemSkills = this._skills.filter(s => s.source !== 'openclaw-workspace');
      this._customSkills = this._skills.filter(s => s.source === 'openclaw-workspace');

      this._setRefreshLoading(false);

      if (this._skills.length === 0) {
        list.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">&#128736;</div>
            <p>${TEXT.SKILLS_NO_SKILLS}</p>
            <button class="btn btn-primary" id="skills-install-first">${TEXT.SKILLS_INSTALL}</button>
          </div>
        `;
        $('#skills-install-first').addEventListener('click', () => this._showMarketplaceModal());
        return;
      }

      this._renderCurrentTab();
    } catch (err) {
      this._setRefreshLoading(false);
      if (this._skills.length === 0) {
        list.innerHTML = `<p style="color: var(--danger);">加载失败: ${err.message}</p>`;
      } else {
        Toast.warning('刷新失败: ' + err.message);
      }
    }
  },

  /** 激活时：有缓存则直接展示，后台刷新按钮显示 loading */
  activate() {
    if (this._skills.length > 0) {
      // 已有数据，在按钮处显示 loading 然后静默刷新
      this._setRefreshLoading(true);
      this._load(true);
    }
  },

  _renderSkillsList(skills) {
    const list = $('#skills-list');
    
    const isCustom = this._currentTab === 'custom';
    const tabTitle = isCustom ? TEXT.SKILLS_CUSTOM_TAB : TEXT.SKILLS_SYSTEM_TAB;

    // 自定义 tab 空状态特殊处理
    if (isCustom && skills.length === 0) {
      list.innerHTML = `
        <div class="section">
          <h3>${tabTitle} (0)</h3>
          <div class="empty-state" style="padding: 40px 20px; text-align: center;">
            <div class="empty-icon" style="font-size: 40px; margin-bottom: 12px;">✍️</div>
            <p style="color: var(--text-secondary); margin-bottom: 16px;">还没有自定义技能，点击「新建技能」开始创建</p>
            <button class="btn btn-success" id="skills-create-empty-btn">+ 新建技能</button>
          </div>
        </div>
      `;
      $('#skills-create-empty-btn').addEventListener('click', () => this._showCreateModal());
      return;
    }
    
    list.innerHTML = `
      <div class="section">
        <h3>${tabTitle} (${skills.length})</h3>
        <div class="table-wrap">
          <table class="skills-table">
            <thead>
              <tr>
                <th class="col-name">${TEXT.SKILLS_TITLE}</th>
                <th class="col-version">${TEXT.SKILLS_VERSION}</th>
                <th class="col-status">${TEXT.SKILLS_STATUS}</th>
                <th class="col-desc">${TEXT.SKILLS_DESCRIPTION}</th>
                <th class="col-actions">${TEXT.BTN_EDIT}</th>
              </tr>
            </thead>
            <tbody id="skills-tbody"></tbody>
          </table>
        </div>
      </div>
    `;

    const tbody = $('#skills-tbody');
    for (const skill of skills) {
      const tr = createElement('tr');
      const statusText = skill.disabled ? TEXT.SKILLS_STATUS_DISABLED : TEXT.SKILLS_STATUS_ENABLED;
      const statusClass = skill.disabled ? 'status-disabled' : 'status-enabled';
      
      // 使用 name 作为技能标识符
      const skillId = skill.name || skill.id;
      const skillName = skill.name || skill.id || 'Unknown';
      const description = skill.description || '-';
      
      tr.innerHTML = `
        <td class="col-name"><strong>${skillName}</strong></td>
        <td class="col-version"><code>${skill.version || '-'}</code></td>
        <td class="col-status"><span class="status-badge ${statusClass}">${statusText}</span></td>
        <td class="col-desc" style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${description}">${description}</td>
        <td class="col-actions">
          <div class="skill-actions">
            ${this._currentTab === 'custom' ? `
              ${skill.disabled 
                ? `<button class="btn btn-sm btn-primary skills-enable-btn" data-id="${skillId}">${TEXT.SKILLS_ENABLE}</button>`
                : `<button class="btn btn-sm btn-ghost skills-disable-btn" data-id="${skillId}">${TEXT.SKILLS_DISABLE}</button>`
              }
              <button class="btn btn-sm btn-danger skills-delete-btn" data-id="${skillId}" data-name="${skillName}">${TEXT.BTN_DELETE}</button>
            ` : `
              ${skill.disabled 
                ? `<button class="btn btn-sm btn-primary skills-enable-btn" data-id="${skillId}">${TEXT.SKILLS_ENABLE}</button>`
                : `<button class="btn btn-sm btn-ghost skills-disable-btn" data-id="${skillId}">${TEXT.SKILLS_DISABLE}</button>`
              }
            `}
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    }

    // Bind events
    $$('.skills-enable-btn', tbody).forEach(btn => {
      btn.addEventListener('click', () => {
        const tr = btn.closest('tr');
        this._enableSkill(btn.dataset.id, tr);
      });
    });

    $$('.skills-disable-btn', tbody).forEach(btn => {
      btn.addEventListener('click', () => {
        const tr = btn.closest('tr');
        this._disableSkill(btn.dataset.id, tr);
      });
    });

    $$('.skills-delete-btn', tbody).forEach(btn => {
      btn.addEventListener('click', () => {
        const tr = btn.closest('tr');
        this._deleteSkill(btn.dataset.id, btn.dataset.name, tr);
      });
    });
  },

  async _enableSkill(skillId, tr) {
    console.log('Enabling skill:', skillId);
    if (!skillId) {
      Toast.error('技能ID为空');
      return;
    }
    if (this._pendingSkillIds.has(skillId)) return; // 防重复
    this._pendingSkillIds.add(skillId);
    this._lockSkillRow(tr, TEXT.SKILLS_ENABLE);
    try {
      const result = await window.openclawAPI.skills.enable(skillId);
      if (result.success) {
        Toast.success(TEXT.SKILLS_STATUS_ENABLED);
        this._load();
      } else {
        Toast.error(result.message || TEXT.TOAST_ERROR);
        this._unlockSkillRow(tr);
      }
    } catch (err) {
      Toast.error(err.message);
      this._unlockSkillRow(tr);
    } finally {
      this._pendingSkillIds.delete(skillId);
    }
  },

  async _disableSkill(skillId, tr) {
    console.log('Disabling skill:', skillId);
    if (!skillId) {
      Toast.error('技能ID为空');
      return;
    }
    if (this._pendingSkillIds.has(skillId)) return; // 防重复
    this._pendingSkillIds.add(skillId);
    this._lockSkillRow(tr, TEXT.SKILLS_DISABLE);
    try {
      const result = await window.openclawAPI.skills.disable(skillId);
      if (result.success) {
        Toast.success(TEXT.SKILLS_STATUS_DISABLED);
        this._load();
      } else {
        Toast.error(result.message || TEXT.TOAST_ERROR);
        this._unlockSkillRow(tr);
      }
    } catch (err) {
      Toast.error(err.message);
      this._unlockSkillRow(tr);
    } finally {
      this._pendingSkillIds.delete(skillId);
    }
  },

  /** 锁定技能行（操作中），禁用所有按钮并显示 loading */
  _lockSkillRow(tr, actionLabel) {
    if (!tr) return;
    tr.style.opacity = '0.6';
    tr.style.pointerEvents = 'none';
    // 在操作列插入 loading 指示器
    const actionsCell = tr.querySelector('.skill-actions');
    if (actionsCell) {
      actionsCell.dataset.origHtml = actionsCell.innerHTML;
      actionsCell.innerHTML = `
        <span style="display:inline-flex;align-items:center;gap:6px;color:var(--text-secondary);font-size:12px;">
          <span class="spinner" style="width:13px;height:13px;border-width:2px;"></span>
          ${actionLabel}中...
        </span>
      `;
    }
  },

  /** 解锁技能行（操作失败时恢复） */
  _unlockSkillRow(tr) {
    if (!tr) return;
    tr.style.opacity = '';
    tr.style.pointerEvents = '';
    const actionsCell = tr.querySelector('.skill-actions');
    if (actionsCell && actionsCell.dataset.origHtml) {
      actionsCell.innerHTML = actionsCell.dataset.origHtml;
      delete actionsCell.dataset.origHtml;
    }
  },

  async _deleteSkill(skillId, skillName, tr) {
    const confirmMsg = TEXT.SKILLS_DELETE_CONFIRM.replace('{name}', skillName);
    if (!confirm(confirmMsg)) return;

    if (this._pendingSkillIds.has(skillId)) return; // 防重复
    this._pendingSkillIds.add(skillId);
    this._lockSkillRow(tr, TEXT.BTN_DELETE);

    try {
      const result = await window.openclawAPI.skills.remove(skillId);
      if (result.success) {
        Toast.success(TEXT.TOAST_DELETED);
        this._load();
      } else {
        Toast.error(result.message || TEXT.TOAST_ERROR);
        this._unlockSkillRow(tr);
      }
    } catch (err) {
      Toast.error(err.message);
      this._unlockSkillRow(tr);
    } finally {
      this._pendingSkillIds.delete(skillId);
    }
  },

  // ── 创建自定义技能 ────────────────────────────────────────────

  _showCreateModal() {
    const overlay = $('#modal-overlay');
    const title = $('#modal-title');
    const body = $('#modal-body');
    const footer = $('#modal-footer');

    title.textContent = '新建自定义技能';
    body.innerHTML = `
      <style>
        .create-skill-field { margin-bottom: 16px; }
        .create-skill-field label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; color: var(--text-primary); }
        .create-skill-field .field-hint { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
        .audit-result { border-radius: 8px; padding: 12px 14px; margin-top: 12px; font-size: 13px; line-height: 1.7; }
        .audit-pass  { background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.3); color: #166534; }
        .audit-warn  { background: rgba(234,179,8,0.08);  border: 1px solid rgba(234,179,8,0.4);  color: #854d0e; }
        .audit-fail  { background: rgba(239,68,68,0.08);  border: 1px solid rgba(239,68,68,0.3);  color: #991b1b; }
        .audit-item  { display: flex; gap: 6px; align-items: flex-start; margin-bottom: 4px; }
        .audit-item:last-child { margin-bottom: 0; }
        .md-drop-zone {
          border: 2px dashed var(--border);
          border-radius: 8px;
          padding: 20px;
          text-align: center;
          cursor: pointer;
          transition: border-color 0.2s, background 0.2s;
          color: var(--text-muted);
          font-size: 13px;
          position: relative;
        }
        .md-drop-zone:hover, .md-drop-zone.drag-over { border-color: var(--primary); background: rgba(99,102,241,0.04); }
        .md-drop-zone input[type=file] { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
        .md-preview {
          margin-top: 10px;
          max-height: 180px;
          overflow-y: auto;
          background: var(--bg-primary, #1e1e2e);
          border: 1px solid var(--border, #3a3a52);
          border-radius: 6px;
          padding: 10px 12px;
          font-family: var(--font-mono, "Cascadia Code", "Consolas", monospace);
          font-size: 12px;
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-all;
          color: var(--text-primary, #e0e0e0);
        }
      </style>

      <!-- 技能名称 -->
      <div class="create-skill-field">
        <label>技能名称 <span style="color: var(--danger);">*</span></label>
        <input class="input" id="cs-name" placeholder="如：my-skill、code-reviewer" autocomplete="off" spellcheck="false">
        <div class="field-hint">只允许小写字母、数字、连字符 <code>-</code> 和下划线 <code>_</code>，将作为技能目录名</div>
        <div id="cs-name-err" style="color: var(--danger); font-size: 12px; margin-top: 4px; display:none;"></div>
      </div>

      <!-- 描述 -->
      <div class="create-skill-field">
        <label>技能描述 <span style="color: var(--danger);">*</span></label>
        <input class="input" id="cs-desc" placeholder="一句话描述技能的用途，将写入 SKILL.md frontmatter">
        <div class="field-hint">建议 10-100 字符</div>
      </div>

      <!-- 版本 -->
      <div class="create-skill-field">
        <label>版本号</label>
        <input class="input" id="cs-version" placeholder="1.0.0" value="1.0.0" style="width: 120px;">
      </div>

      <!-- 导入 SKILL.md -->
      <div class="create-skill-field">
        <label>SKILL.md 内容 <span style="color: var(--danger);">*</span></label>
        <div class="md-drop-zone" id="cs-drop-zone">
          <input type="file" id="cs-file-input" accept=".md,.txt">
          <div id="cs-drop-text">
            <div style="font-size: 20px; margin-bottom: 6px;">📄</div>
            点击选择或拖拽 <strong>.md</strong> 文件至此处
          </div>
        </div>
        <div id="cs-md-preview" class="md-preview" style="display:none;"></div>
        <div class="field-hint">请上传符合 Skill 规范的 Markdown 文件，上传后将自动进行安全审计</div>
      </div>

      <!-- 审计结果区 -->
      <div id="cs-audit-area"></div>
    `;

    footer.innerHTML = `
      <button class="btn" id="cs-cancel-btn">${TEXT.BTN_CANCEL}</button>
      <button class="btn btn-primary" id="cs-submit-btn" disabled>创建技能</button>
    `;

    show(overlay);

    // 绑定事件
    $('#modal-close').addEventListener('click', () => hide(overlay));
    $('#cs-cancel-btn').addEventListener('click', () => hide(overlay));

    // 名称实时校验
    $('#cs-name').addEventListener('input', () => this._validateSkillName());

    // 文件上传（点击 & 拖拽）
    const fileInput = $('#cs-file-input');
    const dropZone = $('#cs-drop-zone');

    fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) this._handleMdFile(e.target.files[0]);
    });
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f) this._handleMdFile(f);
    });

    // 提交
    $('#cs-submit-btn').addEventListener('click', () => this._doCreateSkill());
  },

  /** 校验技能名称格式 */
  _validateSkillName() {
    const input = $('#cs-name');
    const errEl = $('#cs-name-err');
    if (!input) return false;
    const v = input.value.trim();
    let msg = '';
    if (!v) {
      msg = '技能名称不能为空';
    } else if (!/^[a-z0-9][a-z0-9-_]*$/.test(v)) {
      msg = '只允许小写字母、数字、连字符 - 和下划线 _，且须以字母或数字开头';
    } else if (v.length > 64) {
      msg = '名称不超过 64 个字符';
    }
    if (errEl) {
      errEl.textContent = msg;
      errEl.style.display = msg ? '' : 'none';
    }
    if (input) {
      input.style.borderColor = msg ? 'var(--danger)' : '';
    }
    return !msg;
  },

  /** 读取 MD 文件并执行审计 */
  _handleMdFile(file) {
    const maxSize = 512 * 1024; // 512KB
    if (file.size > maxSize) {
      Toast.error('文件过大，请上传小于 512KB 的 .md 文件');
      return;
    }
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['md', 'txt'].includes(ext)) {
      Toast.error('仅支持 .md / .txt 格式');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      this._currentMdContent = content;

      // 更新 drop zone 显示已选文件名
      const dropText = $('#cs-drop-text');
      if (dropText) dropText.innerHTML = `<span style="color:var(--primary)">✔ ${file.name}</span> <span style="font-size:11px;color:var(--text-muted);">(${(file.size/1024).toFixed(1)} KB)</span>`;

      // 预览前 20 行
      const preview = $('#cs-md-preview');
      if (preview) {
        const lines = content.split('\n').slice(0, 20).join('\n');
        preview.textContent = lines + (content.split('\n').length > 20 ? '\n...' : '');
        preview.style.display = '';
      }

      // 执行审计
      const auditResult = this._auditMdContent(content);
      this._renderAuditResult(auditResult);

      // 只有通过才允许提交
      const submitBtn = $('#cs-submit-btn');
      if (submitBtn) submitBtn.disabled = auditResult.level === 'fail';
    };
    reader.readAsText(file, 'utf-8');
  },

  /**
   * 对 SKILL.md 内容做安全审计
   * 返回 { level: 'pass'|'warn'|'fail', items: [{icon, text, level}] }
   */
  _auditMdContent(content) {
    const items = [];
    const add = (icon, text, level = 'info') => items.push({ icon, text, level });

    // ── 1. 基础结构 ──────────────────────────────
    const hasFrontmatter = /^\s*---[\s\S]*?---/.test(content);
    if (hasFrontmatter) {
      add('✅', '检测到 YAML frontmatter');
    } else {
      add('ℹ️', 'frontmatter 缺失（创建时将自动补充）', 'info');
    }

    const hasH1orH2 = /^#{1,2}\s+\S/m.test(content);
    if (hasH1orH2) {
      add('✅', '包含标题结构（H1/H2）');
    } else {
      add('⚠️', '未检测到 H1/H2 标题，建议在 MD 中加入标题', 'warn');
    }

    // ── 2. 内容长度 ──────────────────────────────
    const trimmed = content.trim();
    if (trimmed.length < 50) {
      add('❌', 'SKILL.md 内容过短（< 50 字符），技能描述太少', 'fail');
    } else if (trimmed.length < 200) {
      add('⚠️', 'SKILL.md 内容较短，建议补充更多使用说明', 'warn');
    } else {
      add('✅', `内容长度 ${trimmed.length} 字符`);
    }

    // ── 3. 安全风险检测 ──────────────────────────
    // 3a. 禁止包含可执行的危险指令描述
    const dangerPatterns = [
      { re: /rm\s+-rf?\s+[\/~]/, label: 'rm -rf 危险删除命令' },
      { re: /format\s+[a-zA-Z]:/, label: 'Windows 磁盘格式化命令' },
      { re: /del\s+\/[sS]\s+\/[fF]/, label: 'del /S /F 危险删除命令' },
      { re: /:(){ :|:& };:/, label: 'Fork 炸弹' },
    ];
    for (const p of dangerPatterns) {
      if (p.re.test(content)) {
        add('❌', `检测到危险命令模式：${p.label}，禁止创建`, 'fail');
      }
    }

    // 3b. 禁止硬编码敏感信息
    const secretPatterns = [
      { re: /sk-[a-zA-Z0-9]{20,}/, label: 'OpenAI API Key' },
      { re: /AKIA[0-9A-Z]{16}/, label: 'AWS Access Key' },
      { re: /ghp_[a-zA-Z0-9]{36}/, label: 'GitHub Personal Token' },
      { re: /(?:password|passwd|secret|token)\s*[:=]\s*["']?\S{8,}["']?/i, label: '疑似硬编码密码/Token' },
    ];
    for (const p of secretPatterns) {
      if (p.re.test(content)) {
        add('❌', `检测到疑似敏感信息：${p.label}，请删除后重试`, 'fail');
      }
    }

    // 3c. 外部脚本注入
    const scriptPatterns = [
      { re: /curl\s+.*\|\s*(?:bash|sh|python|node|perl)/i, label: '下载并执行远程脚本（curl | bash）' },
      { re: /wget\s+.*\|\s*(?:bash|sh|python|node|perl)/i, label: '下载并执行远程脚本（wget | sh）' },
      { re: /eval\s*\(\s*(?:atob|fetch|require)\s*/i, label: 'eval 动态执行可疑代码' },
    ];
    for (const p of scriptPatterns) {
      if (p.re.test(content)) {
        add('⚠️', `检测到潜在风险：${p.label}，请确认此命令是否必要`, 'warn');
      }
    }

    // 3d. 可疑 URL / 钓鱼链接
    const suspiciousUrlRe = /https?:\/\/(?:\d{1,3}\.){3}\d{1,3}/;
    if (suspiciousUrlRe.test(content)) {
      add('⚠️', '包含 IP 地址形式的 URL，请确认来源可信', 'warn');
    }

    // ── 4. 规范性建议 ─────────────────────────────
    const hasCodeBlock = /```[\s\S]*?```/.test(content);
    if (!hasCodeBlock) {
      add('ℹ️', '未发现代码块，若技能涉及命令/代码示例，建议用 ``` 包裹', 'info');
    } else {
      add('✅', '包含代码块示例');
    }

    // ── 汇总级别 ──────────────────────────────────
    const hasFail = items.some(i => i.level === 'fail');
    const hasWarn = items.some(i => i.level === 'warn');
    const level = hasFail ? 'fail' : hasWarn ? 'warn' : 'pass';

    return { level, items };
  },

  /** 渲染审计结果到 #cs-audit-area */
  _renderAuditResult(auditResult) {
    const area = $('#cs-audit-area');
    if (!area) return;

    const { level, items } = auditResult;
    const cls = { pass: 'audit-pass', warn: 'audit-warn', fail: 'audit-fail' }[level];
    const header = {
      pass: '✅ 安全审计通过，可以创建技能',
      warn: '⚠️ 审计发现潜在问题，请确认后继续',
      fail: '❌ 审计未通过，请修正后重新上传'
    }[level];

    area.innerHTML = `
      <div class="audit-result ${cls}">
        <div style="font-weight: 600; margin-bottom: 8px;">${header}</div>
        ${items.map(item => `
          <div class="audit-item">
            <span style="flex-shrink:0;">${item.icon}</span>
            <span>${item.text}</span>
          </div>
        `).join('')}
      </div>
    `;
  },

  /** 执行创建 */
  async _doCreateSkill() {
    if (!this._validateSkillName()) {
      Toast.error('请先修正技能名称');
      return;
    }
    const name = $('#cs-name').value.trim();
    const desc = $('#cs-desc').value.trim();
    const version = ($('#cs-version').value || '1.0.0').trim();

    if (!desc || desc.length < 5) {
      Toast.error('技能描述至少需要 5 个字符');
      return;
    }
    if (!this._currentMdContent) {
      Toast.error('请先上传 SKILL.md 文件');
      return;
    }

    const submitBtn = $('#cs-submit-btn');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '创建中...'; }

    try {
      const result = await window.openclawAPI.skills.createCustom({
        name,
        description: desc,
        mdContent: this._currentMdContent,
        version
      });

      if (result.success) {
        Toast.success(result.message || '技能创建成功');
        hide($('#modal-overlay'));
        this._currentMdContent = null;
        // 切换到自定义 tab 并刷新
        this._switchTab('custom');
        await this._load();
      } else {
        Toast.error(result.message || '创建失败');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '创建技能'; }
      }
    } catch (err) {
      Toast.error('创建失败：' + err.message);
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '创建技能'; }
    }
  },

  // ── 技能市场 ──────────────────────────────────────────────────

  _showMarketplaceModal() {
    const overlay = $('#modal-overlay');
    const title = $('#modal-title');
    const body = $('#modal-body');
    const footer = $('#modal-footer');

    title.textContent = TEXT.SKILLS_MARKETPLACE;
    body.innerHTML = `
      <div class="form-group">
        <label>${TEXT.SKILLS_SEARCH}</label>
        <div style="display: flex; gap: 8px;">
          <input class="input" id="skills-search-input" placeholder="${TEXT.SKILLS_SEARCH_PLACEHOLDER}" style="flex: 1;">
          <button class="btn btn-primary" id="skills-search-btn">${TEXT.BTN_CONFIRM}</button>
        </div>
        <p class="form-hint">${TEXT.SKILLS_MARKETPLACE_NOTE}</p>
      </div>
      <div id="skills-search-results" style="margin-top: 16px; max-height: 300px; overflow-y: auto;"></div>
    `;
    footer.innerHTML = `
      <button class="btn" id="modal-close-btn">${TEXT.BTN_CLOSE}</button>
    `;

    show(overlay);

    $('#modal-close-btn').addEventListener('click', () => hide(overlay));
    $('#modal-close').addEventListener('click', () => hide(overlay));
    
    const searchInput = $('#skills-search-input');
    const searchBtn = $('#skills-search-btn');
    
    searchBtn.addEventListener('click', () => this._performSearch(searchInput.value.trim()));
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this._performSearch(searchInput.value.trim());
      }
    });
    
    // Auto-focus search input
    searchInput.focus();
  },

  async _performSearch(query) {
    if (!query) {
      Toast.warning('请输入搜索关键词');
      return;
    }

    const resultsContainer = $('#skills-search-results');
    resultsContainer.innerHTML = '<div class="spinner" style="margin: 20px auto;"></div>';

    try {
      const result = await window.openclawAPI.skills.search(query);
      
      if (!result.success) {
        resultsContainer.innerHTML = `<p style="color: var(--danger);">搜索失败: ${result.message}</p>`;
        return;
      }

      this._searchResults = result.results || [];

      if (this._searchResults.length === 0) {
        resultsContainer.innerHTML = `<p class="text-secondary" style="text-align: center; padding: 20px;">${TEXT.SKILLS_NO_RESULTS}</p>`;
        return;
      }

      this._renderSearchResults(resultsContainer);
    } catch (err) {
      resultsContainer.innerHTML = `<p style="color: var(--danger);">搜索失败: ${err.message}</p>`;
    }
  },

  _renderSearchResults(container) {
    container.innerHTML = `
      <h4 style="margin-bottom: 12px;">${TEXT.SKILLS_SEARCH_RESULTS} (${this._searchResults.length})</h4>
      <div class="skills-search-list">
        ${this._searchResults.map(skill => `
          <div class="skill-search-item" style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            margin-bottom: 8px;
          ">
            <div style="flex: 1;">
              <div style="font-weight: 600; margin-bottom: 4px;">${skill.name || skill.id}</div>
              <div style="font-size: 12px; color: var(--text-secondary);">${skill.description || ''}</div>
              ${skill.version ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">v${skill.version}</div>` : ''}
            </div>
            <button class="btn btn-sm btn-primary skills-install-btn" data-id="${skill.id || skill.name}" style="margin-left: 12px;">
              ${TEXT.SKILLS_INSTALL}
            </button>
          </div>
        `).join('')}
      </div>
    `;

    $$('.skills-install-btn', container).forEach(btn => {
      btn.addEventListener('click', () => this._installSkill(btn.dataset.id, btn));
    });
  },

  async _installSkill(skillId, btn) {
    const originalText = btn.textContent;
    btn.textContent = TEXT.SKILLS_INSTALLING;
    btn.disabled = true;

    try {
      const result = await window.openclawAPI.skills.install(skillId);
      if (result.success) {
        Toast.success(TEXT.SKILLS_INSTALL_SUCCESS);
        hide($('#modal-overlay'));
        this._load();
      } else {
        Toast.error(result.message || TEXT.SKILLS_INSTALL_ERROR);
        btn.textContent = originalText;
        btn.disabled = false;
      }
    } catch (err) {
      Toast.error(err.message);
      btn.textContent = originalText;
      btn.disabled = false;
    }
  }
};

