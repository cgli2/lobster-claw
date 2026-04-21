/* eslint-disable no-unused-vars, no-undef */
const StepComplete = {
  _bundledSkills: [],
  _importProgressListener: null,

  async render(container) {
    clearChildren(container);

    let version = '';
    try {
      version = await window.openclawAPI.install.getVersion() || '';
    } catch {}

    // 获取内置技能列表
    try {
      this._bundledSkills = await window.openclawAPI.skills.getBundledList() || [];
    } catch (err) {
      console.warn('Failed to get bundled skills:', err);
      this._bundledSkills = [];
    }

    container.innerHTML = `
      <div style="text-align: center; padding-top: 40px;">
        <div style="width: 80px; height: 80px; margin: 0 auto 20px; background: rgba(102,187,106,0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
          <span style="font-size: 40px; color: var(--success);">&#10003;</span>
        </div>
        <h2>${TEXT.WIZARD_COMPLETE_TITLE}</h2>
        <p class="step-desc" style="text-align: center;">${TEXT.WIZARD_COMPLETE_DESC}</p>
        ${version ? `<div class="badge badge-success" style="font-size: 14px; padding: 4px 16px; margin-bottom: 24px;">${TEXT.WIZARD_COMPLETE_VERSION}: v${version}</div>` : ''}
      </div>
      
      <!-- 内置技能导入区域 -->
      ${this._bundledSkills.length > 0 ? `
      <div class="card" style="margin: 24px 0;">
        <h3 style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
          <span>&#128736;</span>
          ${TEXT.WIZARD_COMPLETE_BUNDLED_SKILLS}
          <span style="font-size: 12px; color: var(--text-muted); font-weight: normal;">(${this._bundledSkills.length} 个可用)</span>
        </h3>
        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 16px;">
          ${TEXT.WIZARD_COMPLETE_SELECT_SKILLS}
        </p>
        <div class="skills-checkbox-list" style="max-height: 200px; overflow-y: auto; margin-bottom: 16px;">
          ${this._bundledSkills.map(skill => `
            <label class="skill-checkbox-item" style="display: flex; align-items: flex-start; gap: 8px; padding: 8px; margin-bottom: 4px; border-radius: 4px; cursor: pointer;">
              <input type="checkbox" class="skill-select-cb" data-skill="${skill.name}" checked style="margin-top: 3px;">
              <div>
                <div style="font-weight: 500;">${skill.name}</div>
                <div style="font-size: 12px; color: var(--text-muted);">${skill.description}</div>
              </div>
            </label>
          `).join('')}
        </div>
        <button class="btn btn-primary" id="import-skills-btn" style="width: 100%;">
          ${TEXT.WIZARD_COMPLETE_IMPORT_SKILLS}
        </button>
        <div id="import-progress" style="margin-top: 12px; display: none;">
          <div class="progress-bar" style="height: 6px; background: var(--border); border-radius: 3px; overflow: hidden;">
            <div id="import-progress-bar" style="height: 100%; background: var(--primary); width: 0%; transition: width 0.3s;"></div>
          </div>
          <div id="import-progress-text" style="font-size: 12px; color: var(--text-secondary); margin-top: 8px; text-align: center;"></div>
        </div>
        <div id="import-result" style="margin-top: 12px; display: none;"></div>
      </div>
      ` : ''}
      
      <div style="display: flex; gap: 12px; justify-content: center; margin-top: 30px;">
        <button class="btn" id="complete-doctor-btn">${TEXT.WIZARD_COMPLETE_RUN_DOCTOR}</button>
        <button class="btn btn-primary btn-lg" id="complete-dashboard-btn">${TEXT.WIZARD_COMPLETE_OPEN_DASHBOARD}</button>
      </div>
      <div id="doctor-result" style="margin-top: 24px;"></div>
    `;

    // 绑定事件
    $('#complete-dashboard-btn').addEventListener('click', () => {
      WizardController.finish();
    });

    $('#complete-doctor-btn').addEventListener('click', async () => {
      const resultDiv = $('#doctor-result');
      resultDiv.innerHTML = '<div style="text-align: center;"><div class="spinner spinner-lg"></div><p style="margin-top: 12px; color: var(--text-secondary);">正在运行诊断检查...</p></div>';

      try {
        const result = await window.openclawAPI.doctor.validateAndFix();
        resultDiv.innerHTML = this._renderValidateResult(result);
      } catch (err) {
        resultDiv.innerHTML = `<div class="card"><p style="color: var(--danger);">诊断失败: ${this._escapeHtml(err.message)}</p></div>`;
      }
    });

    // 导入技能按钮
    const importBtn = $('#import-skills-btn');
    if (importBtn) {
      importBtn.addEventListener('click', () => this._importSelectedSkills());
    }

    // 监听导入进度
    this._importProgressListener = window.openclawAPI.skills.onImportProgress((progress) => {
      this._updateImportProgress(progress);
    });
  },

  async _importSelectedSkills() {
    const importBtn = $('#import-skills-btn');
    const progressDiv = $('#import-progress');
    const progressBar = $('#import-progress-bar');
    const progressText = $('#import-progress-text');
    const resultDiv = $('#import-result');

    // 获取选中的技能
    const selectedSkills = [];
    $$('.skill-select-cb:checked').forEach(cb => {
      selectedSkills.push(cb.dataset.skill);
    });

    if (selectedSkills.length === 0) {
      Toast.warning('请至少选择一个技能');
      return;
    }

    // 显示进度
    importBtn.disabled = true;
    importBtn.textContent = TEXT.WIZARD_COMPLETE_IMPORTING_SKILLS;
    progressDiv.style.display = '';
    resultDiv.style.display = 'none';
    progressBar.style.width = '0%';
    progressText.textContent = `准备导入 ${selectedSkills.length} 个技能...`;

    try {
      // 调用导入 API
      const result = await window.openclawAPI.skills.importBundled();

      // 显示结果
      resultDiv.style.display = '';
      if (result.success) {
        let resultHtml = '';
        if (result.imported && result.imported.length > 0) {
          resultHtml += `<div style="color: var(--success); margin-bottom: 8px;">
            &#10003; ${TEXT.WIZARD_COMPLETE_SKILLS_IMPORTED.replace('{count}', result.imported.length)}
            <span style="font-size: 12px;">(${result.imported.join(', ')})</span>
          </div>`;
        }
        if (result.skipped && result.skipped.length > 0) {
          resultHtml += `<div style="color: var(--text-secondary); margin-bottom: 8px;">
            &#9888; ${TEXT.WIZARD_COMPLETE_SKIPS_SKILLS.replace('{count}', result.skipped.length)}
          </div>`;
        }
        if (result.failed && result.failed.length > 0) {
          resultHtml += `<div style="color: var(--danger);">
            &#10007; ${result.failed.length} 个导入失败
            <span style="font-size: 12px;">(${result.failed.map(f => f.name).join(', ')})</span>
          </div>`;
        }
        resultDiv.innerHTML = resultHtml || `<div style="color: var(--text-secondary);">${TEXT.WIZARD_COMPLETE_NO_SKILLS}</div>`;
        
        progressBar.style.width = '100%';
        progressText.textContent = '导入完成！';
        importBtn.textContent = '已导入';
      } else {
        resultDiv.innerHTML = `<div style="color: var(--danger);">导入失败: ${result.message}</div>`;
        importBtn.disabled = false;
        importBtn.textContent = TEXT.WIZARD_COMPLETE_IMPORT_SKILLS;
      }
    } catch (err) {
      resultDiv.style.display = '';
      resultDiv.innerHTML = `<div style="color: var(--danger);">导入出错: ${err.message}</div>`;
      importBtn.disabled = false;
      importBtn.textContent = TEXT.WIZARD_COMPLETE_IMPORT_SKILLS;
    }
  },

  _updateImportProgress(progress) {
    const progressBar = $('#import-progress-bar');
    const progressText = $('#import-progress-text');
    
    if (!progressBar || !progressText) return;

    const percent = Math.round((progress.current / progress.total) * 100);
    progressBar.style.width = `${percent}%`;
    progressText.textContent = `正在导入 ${progress.skill} (${progress.current}/${progress.total})`;
  },

  destroy() {
    // 清理进度监听器
    if (this._importProgressListener) {
      this._importProgressListener();
      this._importProgressListener = null;
    }
  },

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  _stripAnsi(text) {
    // Remove ANSI escape codes (colors, cursor movement, etc.)
    return text.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '').replace(/\x1B\].*?\x07/g, '');
  },

  /**
   * 将 validateAndFix 的结果渲染为 HTML（分步展示每条命令的输出）
   */
  _renderValidateResult(result) {
    if (!result || !result.steps) {
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return `<div class="card"><pre class="doctor-output">${this._escapeHtml(this._stripAnsi(text))}</pre></div>`;
    }

    const stepIcons = { true: '✅', false: '❌' };
    const stepsHtml = result.steps.map(step => {
      const icon = stepIcons[String(step.success)] || '⚠️';
      const color = step.success ? 'var(--success)' : 'var(--danger)';
      const output = this._escapeHtml(this._stripAnsi(step.output || ''));
      return `
        <div style="margin-bottom: 16px;">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
            <span>${icon}</span>
            <code style="font-size:13px; color:${color}; font-weight:600;">${this._escapeHtml(step.name)}</code>
          </div>
          <pre class="doctor-output" style="margin:0; font-size:12px; max-height:200px; overflow-y:auto; background:var(--bg-secondary,#1e1e1e); padding:10px; border-radius:4px;">${output}</pre>
        </div>`;
    }).join('');

    const overallIcon = result.overallSuccess ? '✅' : (result.fixRan ? '🔧' : '❌');
    const overallText = result.overallSuccess
      ? '所有检查通过'
      : result.fixRan
        ? '检测到问题，已自动运行 doctor --fix 修复'
        : '检测到问题（已尝试修复，请重启 Gateway 后再试）';
    const overallColor = result.overallSuccess ? 'var(--success)' : 'var(--warning, #f59e0b)';

    return `
      <div class="card">
        <h3 style="margin-bottom:16px;">诊断结果</h3>
        ${stepsHtml}
        <div style="border-top:1px solid var(--border);padding-top:12px;display:flex;align-items:center;gap:8px;">
          <span style="font-size:18px;">${overallIcon}</span>
          <span style="color:${overallColor}; font-weight:600;">${overallText}</span>
        </div>
      </div>`;
  }
};
