/* eslint-disable no-unused-vars, no-undef */
const TabProfiles = {
  async render(container) {
    container.innerHTML = `
      <h2>${TEXT.PROFILES_TITLE}</h2>
      <div class="action-bar">
        <div class="left">
          <button class="btn btn-primary" id="profiles-create-btn">${TEXT.PROFILES_CREATE}</button>
          <button class="btn" id="profiles-import-btn">${TEXT.BTN_IMPORT}</button>
        </div>
        <div class="right">
          <button class="btn" id="profiles-refresh-btn">${TEXT.BTN_REFRESH}</button>
        </div>
      </div>
      <div id="profiles-list"></div>
    `;

    $('#profiles-create-btn').addEventListener('click', () => this._showCreateModal());
    $('#profiles-import-btn').addEventListener('click', () => this._importProfile());
    $('#profiles-refresh-btn').addEventListener('click', () => this._load());

    await this._load();
  },

  async _load() {
    const list = $('#profiles-list');
    list.innerHTML = '<div class="spinner spinner-lg" style="margin: 20px;"></div>';

    try {
      const profiles = await window.openclawAPI.profiles.list();

      if (profiles.length === 0) {
        list.innerHTML = `<div class="empty-state"><div class="empty-icon">&#128193;</div><p>${TEXT.PROFILES_NO_PROFILES}</p><p style="font-size: 12px; color: var(--text-muted);">创建配置档案可以快照当前配置，方便切换不同场景</p></div>`;
        return;
      }

      list.innerHTML = '';
      for (const profile of profiles) {
        const card = createElement('div', { className: 'card', style: 'margin-bottom: 12px;' });
        card.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div>
              <h3 style="font-size: 15px; margin-bottom: 4px;">${profile.name}</h3>
              <p style="font-size: 12px; color: var(--text-muted);">
                ${profile.description || '无描述'}
                &middot; 创建于 ${new Date(profile.createdAt).toLocaleString()}
              </p>
            </div>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-sm btn-primary profile-switch-btn" data-name="${profile.name}">${TEXT.PROFILES_SWITCH}</button>
              <button class="btn btn-sm profile-export-btn" data-name="${profile.name}">${TEXT.BTN_EXPORT}</button>
              <button class="btn btn-sm btn-danger profile-delete-btn" data-name="${profile.name}">${TEXT.BTN_DELETE}</button>
            </div>
          </div>
        `;
        list.appendChild(card);
      }

      $$('.profile-switch-btn', list).forEach(btn => {
        btn.addEventListener('click', () => this._switchProfile(btn.dataset.name));
      });
      $$('.profile-export-btn', list).forEach(btn => {
        btn.addEventListener('click', () => this._exportProfile(btn.dataset.name));
      });
      $$('.profile-delete-btn', list).forEach(btn => {
        btn.addEventListener('click', () => this._deleteProfile(btn.dataset.name));
      });
    } catch (err) {
      list.innerHTML = `<p style="color: var(--danger);">加载失败: ${err.message}</p>`;
    }
  },

  _showCreateModal() {
    const overlay = $('#modal-overlay');
    const title = $('#modal-title');
    const body = $('#modal-body');
    const footer = $('#modal-footer');

    title.textContent = TEXT.PROFILES_CREATE;
    body.innerHTML = `
      <div class="form-group">
        <label>${TEXT.PROFILES_NAME}</label>
        <input class="input" id="profile-modal-name" placeholder="如: 工作环境">
      </div>
      <div class="form-group">
        <label>${TEXT.PROFILES_DESC}</label>
        <input class="input" id="profile-modal-desc" placeholder="可选描述">
      </div>
      <p style="font-size: 12px; color: var(--text-muted);">将当前配置文件创建为一个快照档案</p>
    `;
    footer.innerHTML = `
      <button class="btn" id="modal-cancel-btn">${TEXT.BTN_CANCEL}</button>
      <button class="btn btn-primary" id="modal-save-btn">${TEXT.BTN_CONFIRM}</button>
    `;

    show(overlay);

    $('#modal-cancel-btn').addEventListener('click', () => hide(overlay));
    $('#modal-close').addEventListener('click', () => hide(overlay));
    $('#modal-save-btn').addEventListener('click', async () => {
      const name = $('#profile-modal-name').value.trim();
      const desc = $('#profile-modal-desc').value.trim();

      if (!name) { Toast.warning('档案名称不能为空'); return; }

      const result = await window.openclawAPI.profiles.create(name, desc);
      if (result.success) {
        Toast.success('档案已创建');
        hide(overlay);
        this._load();
      } else {
        Toast.error(result.message || TEXT.TOAST_ERROR);
      }
    });
  },

  async _switchProfile(name) {
    if (!confirm(TEXT.PROFILES_SWITCH_CONFIRM)) return;

    const result = await window.openclawAPI.profiles.switchTo(name);
    if (result.success) {
      Toast.success(`已切换到档案: ${name}`);
    } else {
      Toast.error(result.message || TEXT.TOAST_ERROR);
    }
  },

  async _exportProfile(name) {
    const result = await window.openclawAPI.profiles.exportProfile(name);
    if (result.success) {
      Toast.success('导出成功');
    } else if (result.message !== '已取消') {
      Toast.error(result.message || TEXT.TOAST_ERROR);
    }
  },

  async _importProfile() {
    const result = await window.openclawAPI.profiles.importProfile();
    if (result.success) {
      Toast.success('导入成功: ' + result.name);
      this._load();
    } else if (result.message !== '已取消') {
      Toast.error(result.message || TEXT.TOAST_ERROR);
    }
  },

  async _deleteProfile(name) {
    if (!confirm(TEXT.PROFILES_DELETE_CONFIRM)) return;

    const result = await window.openclawAPI.profiles.remove(name);
    if (result.success) {
      Toast.success(TEXT.TOAST_DELETED);
      this._load();
    } else {
      Toast.error(result.message || TEXT.TOAST_ERROR);
    }
  }
};
