/* eslint-disable no-unused-vars, no-undef */
const TabMcp = {
  async render(container) {
    container.innerHTML = `
      <h2>${TEXT.MCP_TITLE}</h2>
      <div class="action-bar">
        <div class="left">
          <button class="btn btn-primary" id="mcp-add-btn">${TEXT.MCP_ADD}</button>
        </div>
        <div class="right">
          <button class="btn" id="mcp-refresh-btn">${TEXT.BTN_REFRESH}</button>
        </div>
      </div>
      <div id="mcp-list"></div>
    `;

    $('#mcp-add-btn').addEventListener('click', () => this._showAddModal());
    $('#mcp-refresh-btn').addEventListener('click', () => this._load());

    await this._load();
  },

  async _load() {
    const list = $('#mcp-list');
    list.innerHTML = '<div class="spinner spinner-lg" style="margin: 20px;"></div>';

    try {
      const servers = await window.openclawAPI.mcp.list();

      if (servers.length === 0) {
        list.innerHTML = `<div class="empty-state"><div class="empty-icon">&#128268;</div><p>${TEXT.MCP_NO_SERVERS}</p></div>`;
        return;
      }

      list.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead><tr><th>名称</th><th>命令</th><th>参数</th><th>操作</th></tr></thead>
            <tbody id="mcp-tbody"></tbody>
          </table>
        </div>
      `;

      const tbody = $('#mcp-tbody');
      for (const server of servers) {
        const tr = createElement('tr');
        tr.innerHTML = `
          <td><strong>${server.name}</strong></td>
          <td><code>${server.command || '-'}</code></td>
          <td><code>${(server.args || []).join(' ') || '-'}</code></td>
          <td>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-sm btn-ghost mcp-edit-btn" data-name="${server.name}">${TEXT.BTN_EDIT}</button>
              <button class="btn btn-sm btn-danger mcp-delete-btn" data-name="${server.name}">${TEXT.BTN_DELETE}</button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      }

      $$('.mcp-edit-btn', tbody).forEach(btn => {
        btn.addEventListener('click', () => {
          const s = servers.find(s => s.name === btn.dataset.name);
          if (s) this._showEditModal(s);
        });
      });

      $$('.mcp-delete-btn', tbody).forEach(btn => {
        btn.addEventListener('click', () => this._deleteServer(btn.dataset.name));
      });
    } catch (err) {
      list.innerHTML = `<p style="color: var(--danger);">加载失败: ${err.message}</p>`;
    }
  },

  _showAddModal() {
    const overlay = $('#modal-overlay');
    const title = $('#modal-title');
    const body = $('#modal-body');
    const footer = $('#modal-footer');

    title.textContent = TEXT.MCP_ADD;
    body.innerHTML = `
      <div class="form-group">
        <label>${TEXT.MCP_NAME}</label>
        <input class="input" id="mcp-modal-name" placeholder="如: my-mcp-server">
      </div>
      <div class="form-group">
        <label>${TEXT.MCP_COMMAND}</label>
        <input class="input" id="mcp-modal-command" placeholder="如: npx, node, python">
      </div>
      <div class="form-group">
        <label>${TEXT.MCP_ARGS}（每行一个）</label>
        <textarea class="textarea" id="mcp-modal-args" rows="3" placeholder="-y&#10;@modelcontextprotocol/server-name"></textarea>
      </div>
      <div class="form-group">
        <label>${TEXT.MCP_ENV}（JSON 格式）</label>
        <textarea class="textarea" id="mcp-modal-env" rows="3" placeholder='{"KEY": "value"}'></textarea>
      </div>
    `;
    footer.innerHTML = `
      <button class="btn" id="modal-cancel-btn">${TEXT.BTN_CANCEL}</button>
      <button class="btn btn-primary" id="modal-save-btn">${TEXT.BTN_SAVE}</button>
    `;

    show(overlay);

    $('#modal-cancel-btn').addEventListener('click', () => hide(overlay));
    $('#modal-close').addEventListener('click', () => hide(overlay));
    $('#modal-save-btn').addEventListener('click', async () => {
      const name = $('#mcp-modal-name').value.trim();
      const command = $('#mcp-modal-command').value.trim();
      const argsText = $('#mcp-modal-args').value.trim();
      const envText = $('#mcp-modal-env').value.trim();

      if (!name || !command) { Toast.warning('名称和命令不能为空'); return; }

      const args = argsText ? argsText.split('\n').map(s => s.trim()).filter(Boolean) : [];
      let env = {};
      if (envText) {
        try { env = JSON.parse(envText); } catch { Toast.error('环境变量 JSON 格式无效'); return; }
      }

      const result = await window.openclawAPI.mcp.add({ name, command, args, env });
      if (result.success) {
        Toast.success(TEXT.TOAST_SAVED);
        hide(overlay);
        this._load();
      } else {
        Toast.error(result.message || TEXT.TOAST_ERROR);
      }
    });
  },

  _showEditModal(server) {
    const overlay = $('#modal-overlay');
    const title = $('#modal-title');
    const body = $('#modal-body');
    const footer = $('#modal-footer');

    title.textContent = '编辑 ' + server.name;
    body.innerHTML = `
      <div class="form-group">
        <label>${TEXT.MCP_COMMAND}</label>
        <input class="input" id="mcp-modal-command" value="${server.command || ''}">
      </div>
      <div class="form-group">
        <label>${TEXT.MCP_ARGS}（每行一个）</label>
        <textarea class="textarea" id="mcp-modal-args" rows="3">${(server.args || []).join('\n')}</textarea>
      </div>
      <div class="form-group">
        <label>${TEXT.MCP_ENV}（JSON 格式）</label>
        <textarea class="textarea" id="mcp-modal-env" rows="3">${JSON.stringify(server.env || {}, null, 2)}</textarea>
      </div>
    `;
    footer.innerHTML = `
      <button class="btn" id="modal-cancel-btn">${TEXT.BTN_CANCEL}</button>
      <button class="btn btn-primary" id="modal-save-btn">${TEXT.BTN_SAVE}</button>
    `;

    show(overlay);

    $('#modal-cancel-btn').addEventListener('click', () => hide(overlay));
    $('#modal-close').addEventListener('click', () => hide(overlay));
    $('#modal-save-btn').addEventListener('click', async () => {
      const command = $('#mcp-modal-command').value.trim();
      const argsText = $('#mcp-modal-args').value.trim();
      const envText = $('#mcp-modal-env').value.trim();

      const args = argsText ? argsText.split('\n').map(s => s.trim()).filter(Boolean) : [];
      let env = {};
      if (envText) {
        try { env = JSON.parse(envText); } catch { Toast.error('环境变量 JSON 格式无效'); return; }
      }

      const result = await window.openclawAPI.mcp.update(server.name, { command, args, env });
      if (result.success) {
        Toast.success(TEXT.TOAST_SAVED);
        hide(overlay);
        this._load();
      } else {
        Toast.error(result.message || TEXT.TOAST_ERROR);
      }
    });
  },

  async _deleteServer(name) {
    if (!confirm(`确定要删除 MCP 服务器 "${name}" 吗？`)) return;

    const result = await window.openclawAPI.mcp.remove(name);
    if (result.success) {
      Toast.success(TEXT.TOAST_DELETED);
      this._load();
    } else {
      Toast.error(result.message || TEXT.TOAST_ERROR);
    }
  }
};
