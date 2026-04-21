/* eslint-disable no-unused-vars, no-undef */
const TabTasks = {
  _currentView: 'list', // 'list' | 'history' | 'edit' | 'create'
  _tasks: [],
  _history: [],
  _editingTask: null,
  _pollTimer: null,
  _deliveryTargetsKey: 'openclaw_task_delivery_targets',

  // 获取本地存储的通知目标映射
  _getDeliveryTargets() {
    try {
      const data = localStorage.getItem(this._deliveryTargetsKey);
      return data ? JSON.parse(data) : {};
    } catch (e) {
      return {};
    }
  },

  // 保存通知目标到本地存储
  _saveDeliveryTarget(taskId, target) {
    const targets = this._getDeliveryTargets();
    if (target) {
      targets[taskId] = target;
    } else {
      delete targets[taskId];
    }
    localStorage.setItem(this._deliveryTargetsKey, JSON.stringify(targets));
  },

  // 获取指定任务的通知目标
  _getDeliveryTarget(taskId) {
    const targets = this._getDeliveryTargets();
    return targets[taskId] || '';
  },

  async render(container) {
    container.innerHTML = `
      <div class="tasks-container">
        <div class="tasks-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h2 style="margin: 0;">定时任务</h2>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary" id="tasks-refresh-btn">
              <span>刷新</span>
            </button>
            <button class="btn btn-primary" id="tasks-create-btn">
              <span>+ 新建任务</span>
            </button>
          </div>
        </div>

        <!-- 任务列表视图 -->
        <div id="tasks-list-view" class="tasks-view">
          <div id="tasks-list-container"></div>
        </div>

        <!-- 创建/编辑任务表单 -->
        <div id="tasks-form-view" class="tasks-view hidden">
          <div class="card" style="max-width: 560px; margin: 0 auto;">
            <div class="card-header" style="padding-bottom: 16px; border-bottom: 1px solid var(--border); margin-bottom: 20px;">
              <h3 id="tasks-form-title" style="margin: 0; font-size: 16px; flex: 1;">创建任务</h3>
              <button type="button" class="btn btn-ghost" id="task-close-btn" style="padding: 4px 8px; font-size: 18px; line-height: 1;">×</button>
            </div>
            
            <form id="tasks-form">
              <!-- 标题 -->
              <div class="form-group">
                <label>标题</label>
                <input type="text" id="task-name" class="input" placeholder="输入任务标题" required>
              </div>

              <!-- 提示词 -->
              <div class="form-group">
                <label>提示词</label>
                <textarea id="task-message" class="textarea" rows="4" placeholder="输入要执行的提示词..." required></textarea>
              </div>

              <!-- 计划 - 可视化选择 -->
              <div class="form-group">
                <label>计划</label>
                <div class="field-row" style="align-items: center; flex-wrap: nowrap;">
                  <select id="task-schedule-type" class="select" style="width: 120px; flex-shrink: 0;">
                    <option value="daily">每天</option>
                    <option value="weekly">每周</option>
                    <option value="monthly">每月</option>
                    <option value="once">执行一次</option>
                    <option value="interval">间隔执行</option>
                    <option value="custom">自定义 Cron</option>
                  </select>
                  
                  <!-- 每天选项 -->
                  <div id="schedule-daily" class="schedule-options" style="display: flex; align-items: center;">
                    <input type="time" id="daily-time" class="input" value="09:00" style="width: 100px;">
                  </div>
                  
                  <!-- 每周选项 -->
                  <div id="schedule-weekly" class="schedule-options hidden" style="display: flex; align-items: center; gap: 8px;">
                    <select id="weekly-day" class="select" style="width: 90px;">
                      <option value="1">周一</option>
                      <option value="2">周二</option>
                      <option value="3">周三</option>
                      <option value="4">周四</option>
                      <option value="5">周五</option>
                      <option value="6">周六</option>
                      <option value="0">周日</option>
                    </select>
                    <input type="time" id="weekly-time" class="input" value="09:00" style="width: 100px;">
                  </div>
                  
                  <!-- 每月选项 -->
                  <div id="schedule-monthly" class="schedule-options hidden" style="display: flex; align-items: center; gap: 8px;">
                    <select id="monthly-date" class="select" style="width: 80px;">
                      ${Array.from({length: 31}, (_, i) => `<option value="${i + 1}">${i + 1}日</option>`).join('')}
                    </select>
                    <input type="time" id="monthly-time" class="input" value="09:00" style="width: 100px;">
                  </div>
                  
                  <!-- 执行一次选项 -->
                  <div id="schedule-once" class="schedule-options hidden" style="display: flex; align-items: center;">
                    <input type="datetime-local" id="once-datetime" class="input" style="width: 200px;">
                  </div>
                  
                  <!-- 间隔执行选项 -->
                  <div id="schedule-interval" class="schedule-options hidden" style="display: flex; align-items: center; gap: 8px;">
                    <input type="number" id="interval-value" class="input" value="30" min="1" style="width: 80px;">
                    <select id="interval-unit" class="select" style="width: 90px;">
                      <option value="m">分钟</option>
                      <option value="h">小时</option>
                      <option value="d">天</option>
                    </select>
                  </div>
                  
                  <!-- 自定义 Cron 选项 -->
                  <div id="schedule-custom" class="schedule-options hidden" style="display: flex; align-items: center; flex: 1;">
                    <input type="text" id="custom-cron" class="input" placeholder="0 9 * * * (每天9点)" style="flex: 1;">
                  </div>
                </div>
                <small class="hint" id="schedule-hint" style="display: none;">格式：分 时 日 月 周</small>
              </div>

              <!-- 工作目录 -->
              <div class="form-group">
                <label>工作目录</label>
                <div class="input-with-btn">
                  <input type="text" id="task-workdir" class="input" placeholder="C:\\Users\\cgli\\lobsterai\\project">
                  <button type="button" class="btn btn-sm" id="browse-workdir-btn">浏览</button>
                </div>
              </div>

              <!-- 到期时间（可选） -->
              <div class="form-group">
                <label>到期时间 <span style="color: var(--text-muted); font-weight: normal;">（可选）</span></label>
                <input type="date" id="task-expire-date" class="input" style="width: 150px;">
              </div>

              <!-- IM 通知（可选） -->
              <div class="form-group">
                <label>IM 通知 <span style="color: var(--text-muted); font-weight: normal;">（可选）</span></label>
                <div class="field-row" style="gap: 8px;">
                  <select id="task-channel" class="select" style="width: 120px;">
                    <option value="">不通知</option>
                    <option value="feishu">飞书</option>
                    <option value="dingtalk">钉钉</option>
                    <option value="wechat">企业微信</option>
                  </select>
                  <input type="text" id="task-to" class="input" placeholder="通知目标ID" style="flex: 1;">
                </div>
                <small class="hint" id="channel-hint" style="display: none; margin-top: 4px;"></small>
              </div>

              <!-- 高级选项（折叠） -->
              <div class="form-group">
                <button type="button" class="btn btn-ghost btn-sm" id="toggle-advanced" style="padding-left: 0; color: var(--text-secondary);">
                  <span id="advanced-icon">▶</span> 高级选项
                </button>
                <div id="advanced-options" class="hidden" style="margin-top: 12px; padding: 16px; background: var(--bg-input); border-radius: var(--radius); border: 1px solid var(--border);">
                  <div class="field-row">
                    <div class="form-group" style="flex: 1; margin-bottom: 0;">
                      <label>时区</label>
                      <select id="task-tz" class="select">
                        <option value="Asia/Shanghai">北京时间</option>
                        <option value="Asia/Tokyo">东京时间</option>
                        <option value="UTC">UTC</option>
                        <option value="America/New_York">纽约时间</option>
                      </select>
                    </div>
                    <div class="form-group" style="flex: 1; margin-bottom: 0;">
                      <label>模型</label>
                      <input type="text" id="task-model" class="input" placeholder="默认模型">
                    </div>
                  </div>
                  <div class="form-group" style="margin-top: 12px; margin-bottom: 0;">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                      <input type="checkbox" id="task-disabled" style="width: auto;">
                      <span>创建后禁用</span>
                    </label>
                  </div>
                </div>
              </div>

              <!-- 操作按钮 -->
              <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border);">
               <button type="submit" class="btn btn-primary" id="task-submit-btn">确定</button>  
               <button type="button" class="btn" id="task-cancel-btn">取消</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <style>
        .tasks-container { padding: 0 0 20px 0; }
        .tasks-view { animation: fadeIn 0.2s ease; }
        .tasks-tab:hover { background: var(--bg-secondary); }
        .tasks-tab.active { border-bottom-color: var(--primary); color: var(--primary); }
        
        .task-card {
          background: var(--card-bg);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 12px;
          transition: box-shadow 0.2s;
        }
        .task-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        
        .task-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 12px;
        }
        .task-name { font-size: 16px; font-weight: 600; margin: 0; }
        .task-description { font-size: 13px; color: var(--text-muted); margin: 4px 0 0 0; }
        
        .task-status {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
        }
        .task-status.enabled { background: #e6f7ee; color: #00875a; }
        .task-status.disabled { background: #f4f5f7; color: #6b778c; }
        .task-status.error { background: #ffebe6; color: #de350b; }
        
        .task-meta {
          display: flex;
          gap: 24px;
          font-size: 13px;
          color: var(--text-muted);
          margin-bottom: 12px;
        }
        .task-meta-item { display: flex; align-items: center; gap: 4px; }
        
        .task-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .task-actions .btn { padding: 4px 12px; font-size: 12px; }
        
        /* 历史记录列表样式 */
        .history-list {
          max-height: 400px;
          overflow-y: auto;
        }
        
        .history-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 12px;
          background: var(--bg-secondary, #f5f5f5);
          border-radius: 6px;
          margin-bottom: 8px;
        }
        
        .history-item-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        
        .history-time {
          font-size: 13px;
          font-weight: 500;
        }
        
        .history-duration {
          font-size: 12px;
          color: var(--text-muted);
        }
        
        .history-status {
          font-size: 12px;
          padding: 2px 8px;
          border-radius: 4px;
        }
        .history-status.success { background: #e6f7ee; color: #00875a; }
        .history-status.error { background: #ffebe6; color: #de350b; }
        
        .history-card {
          background: var(--card-bg);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 12px 16px;
          margin-bottom: 8px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .history-status { font-size: 12px; padding: 2px 6px; border-radius: 3px; }
        .history-status.success { background: #e6f7ee; color: #00875a; }
        .history-status.error { background: #ffebe6; color: #de350b; }
        
        /* 任务表单样式 - 与添加模型表单保持一致 */
        .schedule-options.hidden {
          display: none !important;
        }
        
        .empty-state {
          text-align: center;
          padding: 60px 20px;
          color: var(--text-muted);
        }
        .empty-state h3 { margin: 0 0 8px 0; color: var(--text-primary); }
        
        /* 加载动画 */
        .spinner {
          width: 24px;
          height: 24px;
          border: 3px solid var(--border-color);
          border-top-color: var(--primary);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          margin: 0 auto 12px;
        }
        
        /* 按钮内的小型加载动画 */
        .btn-spinner {
          display: inline-block;
          width: 12px;
          height: 12px;
          border: 2px solid currentColor;
          border-top-color: transparent;
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
          vertical-align: middle;
          margin-right: 4px;
        }
        
        /* 任务卡片加载遮罩 */
        .task-loading-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10;
          border-radius: 8px;
        }
        
        .task-loading-content {
          display: flex;
          align-items: center;
          color: #fff;
          font-weight: 500;
          background: rgba(0, 0, 0, 0.7);
          padding: 12px 20px;
          border-radius: 6px;
        }
        
        .task-loading-content .spinner {
          border-color: rgba(255,255,255,0.3);
          border-top-color: #fff;
          margin: 0 10px 0 0;
        }
        
        .task-loading-text {
          font-size: 14px;
        }
        
        /* 错误指示器样式 */
        .task-error-indicator:hover {
          text-decoration: underline;
        }
        
        /* 错误模态框样式 */
        .error-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
        }
        
        .error-modal {
          background: var(--card-bg, #fff);
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
          max-width: 600px;
          width: 90%;
          max-height: 80vh;
          overflow: hidden;
        }
        
        .error-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-color, #e0e0e0);
        }
        
        .error-modal-header h3 {
          margin: 0;
          font-size: 16px;
          color: var(--text-primary, #333);
        }
        
        .error-modal-close {
          background: none;
          border: none;
          font-size: 24px;
          cursor: pointer;
          color: var(--text-muted, #666);
          padding: 0;
          line-height: 1;
        }
        
        .error-modal-close:hover {
          color: var(--text-primary, #333);
        }
        
        .error-modal-body {
          padding: 20px;
          overflow-y: auto;
          max-height: 60vh;
        }
        
        .error-info {
          margin-bottom: 16px;
          padding: 12px;
          background: var(--bg-secondary, #f5f5f5);
          border-radius: 6px;
          font-size: 14px;
        }
        
        .error-detail {
          padding: 12px;
          background: #fff5f5;
          border: 1px solid #ffcdd2;
          border-radius: 6px;
        }
        
        .error-detail strong {
          display: block;
          margin-bottom: 8px;
          color: #c62828;
        }
        
        .error-detail pre {
          margin: 0;
          padding: 12px;
          background: #fafafa;
          border-radius: 4px;
          font-family: monospace;
          font-size: 13px;
          white-space: pre-wrap;
          word-break: break-all;
          max-height: 300px;
          overflow-y: auto;
          color: #333;
        }
        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>
    `;

    // 绑定事件
    this._bindEvents();
    
    // 加载任务列表
    await this._loadTasks();
  },

  _bindEvents() {
    // 刷新按钮
    $('#tasks-refresh-btn')?.addEventListener('click', () => this._refreshCurrentView());

    // 新建按钮
    $('#tasks-create-btn')?.addEventListener('click', () => this._showCreateForm());

    // 调度类型切换 - 新的可视化选择器
    $('#task-schedule-type')?.addEventListener('change', (e) => {
      const type = e.target.value;
      // 隐藏所有选项
      ['daily', 'weekly', 'monthly', 'once', 'interval', 'custom'].forEach(t => {
        $(`#schedule-${t}`)?.classList.add('hidden');
      });
      // 显示当前选中的选项
      $(`#schedule-${type}`)?.classList.remove('hidden');
      // 显示/隐藏 Cron 提示
      $('#schedule-hint').style.display = type === 'custom' ? 'block' : 'none';
    });

    // 高级选项切换
    $('#toggle-advanced')?.addEventListener('click', () => {
      const panel = $('#advanced-options');
      const icon = $('#advanced-icon');
      const isHidden = panel.classList.contains('hidden');
      panel.classList.toggle('hidden', !isHidden);
      icon.textContent = isHidden ? '▼' : '▶';
    });

    // 通知渠道切换 - 显示对应的提示
    $('#task-channel')?.addEventListener('change', (e) => {
      const channel = e.target.value;
      const hint = $('#channel-hint');
      const toInput = $('#task-to');
      
      const hints = {
        'feishu': '飞书通知目标：填写 chatId（群聊ID）或 user:openId（用户openId）',
        'dingtalk': '钉钉通知目标：填写机器人 webhook 地址或群聊ID',
        'wechat': '企业微信通知目标：填写机器人 webhook 地址或群聊ID'
      };
      
      if (channel && hints[channel]) {
        hint.textContent = hints[channel];
        hint.style.display = 'block';
        toInput.placeholder = channel === 'feishu' ? '如: chat:oc_xxx 或 user:ou_xxx' : '如: webhook地址或群ID';
      } else {
        hint.style.display = 'none';
        toInput.placeholder = '通知目标ID';
      }
    });

    // 浏览工作目录按钮
    $('#browse-workdir-btn')?.addEventListener('click', () => this._browseWorkDir());

    // 关闭按钮
    $('#task-close-btn')?.addEventListener('click', () => this._showListView());

    // 表单提交
    $('#tasks-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this._submitForm();
    });

    // 取消按钮
    $('#task-cancel-btn')?.addEventListener('click', () => this._showListView());
  },

  async _browseWorkDir() {
    try {
      // 使用 Electron 的对话框选择目录
      const result = await window.openclawAPI.dialog?.selectDirectory();
      if (result?.success && result?.path) {
        $('#task-workdir').value = result.path;
      }
    } catch (err) {
      console.error('Directory selection failed:', err);
      Toast.error('选择目录失败: ' + err.message);
    }
  },

  _setRefreshLoading(loading) {
    const btn = $('#tasks-refresh-btn');
    if (!btn) return;
    const span = btn.querySelector('span');
    if (loading) {
      btn.disabled = true;
      if (span) {
        btn.dataset.origText = span.textContent;
        span.innerHTML = '<span class="btn-spinner"></span>';
      }
    } else {
      btn.disabled = false;
      if (span) span.textContent = btn.dataset.origText || '刷新';
    }
  },

  async _loadTasks(forceRefresh = false) {
    const container = $('#tasks-list-container');
    if (!container) return;

    // 如果有缓存数据，先显示缓存（快速响应）
    if (this._tasks && this._tasks.length > 0 && !forceRefresh) {
      this._renderTaskList();
      this._setRefreshLoading(true); // 刷新按钮显示 loading
    } else {
      // 显示加载状态
      container.innerHTML = `
        <div class="loading-container" style="text-align: center; padding: 60px 20px;">
          <div class="spinner spinner-lg" style="width: 40px; height: 40px; margin: 0 auto 16px;"></div>
          <div style="color: var(--text-muted); font-size: 14px;">加载任务列表...</div>
        </div>
      `;
    }

    // 检查是否正在加载
    if (this._loadingTasks) {
      return;
    }
    this._loadingTasks = true;

    try {
      const result = await window.openclawAPI.tasks.list(true);
      
      if (result.success) {
        this._tasks = result.jobs || [];
        this._renderTaskList();
      } else {
        // 只有在没有缓存数据时才显示错误
        if (!this._tasks || this._tasks.length === 0) {
          container.innerHTML = `
            <div class="empty-state">
              <p>加载失败: ${result.error || '未知错误'}</p>
              <button class="btn" onclick="TabTasks._loadTasks(true)">重试</button>
            </div>
          `;
        } else {
          Toast.error('刷新失败: ' + (result.error || '未知错误'));
        }
      }
    } catch (err) {
      // 只有在没有缓存数据时才显示错误
      if (!this._tasks || this._tasks.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <p>加载失败: ${err.message}</p>
            <button class="btn" onclick="TabTasks._loadTasks(true)">重试</button>
          </div>
        `;
      } else {
        Toast.error('刷新失败: ' + err.message);
      }
    } finally {
      this._loadingTasks = false;
      this._setRefreshLoading(false); // 恢复刷新按钮
    }
  },

  _renderTaskList() {
    const container = $('#tasks-list-container');
    if (!container) return;

    if (this._tasks.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <h3>暂无定时任务</h3>
          <p>点击"新建任务"创建你的第一个定时任务</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this._tasks.map(task => this._renderTaskCard(task)).join('');
    
    // 绑定任务卡片事件
    this._bindTaskCardEvents();
  },

  _renderTaskCard(task) {
    const statusClass = task.enabled ? 'enabled' : 'disabled';
    const statusText = task.enabled ? '已启用' : '已禁用';
    
    const schedule = task.schedule || {};
    const scheduleText = schedule.kind === 'cron' 
      ? `Cron: ${schedule.expr}` 
      : schedule.kind === 'every'
      ? `间隔: ${schedule.every}`
      : '一次性任务';

    const nextRun = task.state?.nextRunAtMs 
      ? new Date(task.state.nextRunAtMs).toLocaleString('zh-CN')
      : '未安排';

    const lastRun = task.state?.lastRunAtMs 
      ? new Date(task.state.lastRunAtMs).toLocaleString('zh-CN')
      : '从未执行';

    const lastStatus = task.state?.lastRunStatus || 'unknown';
    const hasError = lastStatus === 'error' || task.state?.consecutiveErrors > 0;
    
    // 存储任务信息，用于显示日志
    const taskInfo = JSON.stringify({
      id: task.id,
      name: task.name || '未命名任务',
      lastError: task.state?.lastError || '',
      consecutiveErrors: task.state?.consecutiveErrors || 0
    }).replace(/"/g, '&quot;');

    return `
      <div class="task-card" data-task-id="${task.id}" data-task-info="${taskInfo}">
        <div class="task-header">
          <div>
            <h3 class="task-name">${this._escapeHtml(task.name || '未命名任务')}</h3>
            ${task.description ? `<p class="task-description">${this._escapeHtml(task.description)}</p>` : ''}
          </div>
          <span class="task-status ${statusClass}">${statusText}</span>
        </div>
        
        <div class="task-meta">
          <div class="task-meta-item">
            <span>⏰</span>
            <span>${scheduleText}</span>
          </div>
          <div class="task-meta-item">
            <span>📍</span>
            <span>下次: ${nextRun}</span>
          </div>
          <div class="task-meta-item">
            <span>📋</span>
            <span>上次: ${lastRun}</span>
          </div>
          ${hasError ? `<div class="task-meta-item task-error-indicator" style="color: #de350b; cursor: pointer;" data-action="showError"><span>⚠️</span><span>错误: ${task.state?.consecutiveErrors || 1} 次 (点击查看)</span></div>` : ''}
        </div>

        <div class="task-actions">
          ${task.enabled 
            ? `<button class="btn btn-secondary" data-action="disable">禁用</button>`
            : `<button class="btn btn-success" data-action="enable">启用</button>`
          }
          <button class="btn btn-primary" data-action="run">立即运行</button>
          <button class="btn btn-secondary" data-action="history">历史</button>
          <button class="btn btn-secondary" data-action="edit">编辑</button>
          <button class="btn btn-danger" data-action="delete">删除</button>
        </div>
      </div>
    `;
  },

  _bindTaskCardEvents() {
    document.querySelectorAll('.task-card').forEach(card => {
      const taskId = card.dataset.taskId;
      
      card.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
          const action = btn.dataset.action;
          if (action === 'showError') {
            const taskInfo = JSON.parse(card.dataset.taskInfo.replace(/&quot;/g, '"'));
            this._showTaskError(taskInfo);
          } else {
            this._handleTaskAction(taskId, action);
          }
        });
      });
    });
  },

  // 显示任务错误信息
  _showTaskError(taskInfo) {
    const errorContent = taskInfo.lastError || '暂无错误详情';
    const errorHtml = `
      <div class="error-modal-overlay" id="error-modal-overlay">
        <div class="error-modal">
          <div class="error-modal-header">
            <h3>任务错误详情</h3>
            <button class="error-modal-close" id="error-modal-close">×</button>
          </div>
          <div class="error-modal-body">
            <div class="error-info">
              <strong>任务名称:</strong> ${this._escapeHtml(taskInfo.name)}<br>
              <strong>连续错误次数:</strong> ${taskInfo.consecutiveErrors} 次
            </div>
            <div class="error-detail">
              <strong>错误信息:</strong>
              <pre>${this._escapeHtml(errorContent)}</pre>
            </div>
          </div>
        </div>
      </div>
    `;
    
    // 移除已存在的模态框
    const existing = document.getElementById('error-modal-overlay');
    if (existing) existing.remove();
    
    // 添加新的模态框
    document.body.insertAdjacentHTML('beforeend', errorHtml);
    
    // 绑定关闭事件
    document.getElementById('error-modal-close')?.addEventListener('click', () => {
      document.getElementById('error-modal-overlay')?.remove();
    });
    
    document.getElementById('error-modal-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'error-modal-overlay') {
        document.getElementById('error-modal-overlay')?.remove();
      }
    });
  },

  async _handleTaskAction(taskId, action) {
    switch (action) {
      case 'enable':
        await this._enableTask(taskId);
        break;
      case 'disable':
        await this._disableTask(taskId);
        break;
      case 'run':
        await this._runTask(taskId);
        break;
      case 'history':
        await this._showTaskHistory(taskId);
        break;
      case 'edit':
        this._showEditForm(taskId);
        break;
      case 'delete':
        await this._deleteTask(taskId);
        break;
    }
  },
  
  async _showTaskHistory(taskId) {
    // 防止重复操作
    if (this._actionLocks && this._actionLocks[taskId]) {
      return;
    }
    this._actionLocks = this._actionLocks || {};
    this._actionLocks[taskId] = true;
    
    // 显示加载遮罩
    this._showTaskLoading(taskId, '加载历史...');
    
    try {
      const result = await window.openclawAPI.tasks.history(taskId, 20);
      this._hideTaskLoading(taskId);
      
      if (result.success && result.runs && result.runs.length > 0) {
        this._showHistoryModal(taskId, result.runs);
      } else if (result.success) {
        Toast.info('该任务暂无执行历史');
      } else {
        Toast.error('获取历史失败: ' + (result.error || '未知错误'));
      }
    } catch (err) {
      this._hideTaskLoading(taskId);
      Toast.error('获取历史失败: ' + err.message);
    } finally {
      this._actionLocks[taskId] = false;
    }
  },
  
  _showHistoryModal(taskId, runs) {
    const task = this._tasks.find(t => t.id === taskId);
    const taskName = task ? task.name : taskId;

    const historyHtml = runs.map(run => {
      const time = run.runAtMs ? new Date(run.runAtMs).toLocaleString('zh-CN') : '未知时间';
      const status = run.status || 'unknown';
      const statusClass = status === 'success' ? 'success' : 'error';
      const statusText = status === 'success' ? '成功' : '失败';
      const duration = run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : '-';

      return `
        <div class="history-item">
          <div class="history-item-info">
            <span class="history-time">${time}</span>
            <span class="history-duration">耗时 ${duration}</span>
          </div>
          <span class="history-status ${statusClass}">${statusText}</span>
        </div>
      `;
    }).join('');

    const modalHtml = `
      <div class="error-modal-overlay" id="history-modal-overlay">
        <div class="error-modal" style="max-width: 500px;">
          <div class="error-modal-header">
            <h3>执行历史: ${this._escapeHtml(taskName)}</h3>
            <button class="error-modal-close" id="history-modal-close">×</button>
          </div>
          <div class="error-modal-body" style="padding: 12px;">
            <div class="history-list">
              ${historyHtml}
            </div>
          </div>
        </div>
      </div>
    `;
    
    // 移除已存在的模态框
    const existing = document.getElementById('history-modal-overlay');
    if (existing) existing.remove();
    
    // 添加新的模态框
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // 绑定关闭事件
    document.getElementById('history-modal-close')?.addEventListener('click', () => {
      document.getElementById('history-modal-overlay')?.remove();
    });
    
    document.getElementById('history-modal-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'history-modal-overlay') {
        document.getElementById('history-modal-overlay')?.remove();
      }
    });
  },

  // 显示任务卡片的加载遮罩
  _showTaskLoading(taskId, message) {
    const card = document.querySelector(`.task-card[data-task-id="${taskId}"]`);
    if (!card) return;
    
    // 添加加载遮罩
    card.classList.add('task-loading');
    card.style.position = 'relative';
    
    // 禁用所有按钮
    card.querySelectorAll('.btn').forEach(btn => {
      btn.disabled = true;
    });
    
    // 创建遮罩层
    let overlay = card.querySelector('.task-loading-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'task-loading-overlay';
      overlay.innerHTML = `
        <div class="task-loading-content">
          <div class="spinner" style="width: 20px; height: 20px; margin: 0 8px 0 0;"></div>
          <span class="task-loading-text">${message}</span>
        </div>
      `;
      card.appendChild(overlay);
    } else {
      overlay.querySelector('.task-loading-text').textContent = message;
      overlay.style.display = 'flex';
    }
  },

  // 隐藏任务卡片的加载遮罩
  _hideTaskLoading(taskId) {
    const card = document.querySelector(`.task-card[data-task-id="${taskId}"]`);
    if (!card) return;
    
    card.classList.remove('task-loading');
    
    // 启用所有按钮
    card.querySelectorAll('.btn').forEach(btn => {
      btn.disabled = false;
    });
    
    // 移除遮罩层
    const overlay = card.querySelector('.task-loading-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  },

  async _enableTask(taskId) {
    // 防止重复操作
    if (this._actionLocks && this._actionLocks[taskId]) {
      return;
    }
    this._actionLocks = this._actionLocks || {};
    this._actionLocks[taskId] = true;
    
    // 显示加载遮罩
    this._showTaskLoading(taskId, '正在启用...');
    
    try {
      const result = await window.openclawAPI.tasks.enable(taskId);
      if (result.success) {
        Toast.success('任务已启用');
        // 成功后刷新列表
        await this._loadTasks(true);
      } else {
        Toast.error('启用失败: ' + (result.error || '未知错误'));
        this._hideTaskLoading(taskId);
      }
    } catch (err) {
      Toast.error('启用失败: ' + err.message);
      this._hideTaskLoading(taskId);
    } finally {
      this._actionLocks[taskId] = false;
    }
  },

  async _disableTask(taskId) {
    // 防止重复操作
    if (this._actionLocks && this._actionLocks[taskId]) {
      return;
    }
    this._actionLocks = this._actionLocks || {};
    this._actionLocks[taskId] = true;
    
    // 显示加载遮罩
    this._showTaskLoading(taskId, '正在禁用...');
    
    try {
      const result = await window.openclawAPI.tasks.disable(taskId);
      if (result.success) {
        Toast.success('任务已禁用');
        // 成功后刷新列表
        await this._loadTasks(true);
      } else {
        Toast.error('禁用失败: ' + (result.error || '未知错误'));
        this._hideTaskLoading(taskId);
      }
    } catch (err) {
      Toast.error('禁用失败: ' + err.message);
      this._hideTaskLoading(taskId);
    } finally {
      this._actionLocks[taskId] = false;
    }
  },

  async _runTask(taskId) {
    // 防止重复操作
    if (this._actionLocks && this._actionLocks[taskId]) {
      return;
    }
    this._actionLocks = this._actionLocks || {};
    this._actionLocks[taskId] = true;
    
    // 显示加载遮罩
    this._showTaskLoading(taskId, '正在运行...');
    
    try {
      const result = await window.openclawAPI.tasks.run(taskId);
      if (result.success) {
        Toast.success('任务已触发执行');
        this._hideTaskLoading(taskId);
      } else {
        Toast.error('执行失败: ' + (result.error || '未知错误'));
        this._hideTaskLoading(taskId);
      }
    } catch (err) {
      Toast.error('执行失败: ' + err.message);
      this._hideTaskLoading(taskId);
    } finally {
      this._actionLocks[taskId] = false;
    }
  },
  
  // 更新列表中的任务（乐观更新）
  _updateTaskInList(taskId, updates) {
    if (!this._tasks) return;
    
    const index = this._tasks.findIndex(t => t.id === taskId);
    if (index >= 0) {
      this._tasks[index] = { ...this._tasks[index], ...updates };
      this._renderTaskList();
    }
  },
  
  // 从列表中移除任务（乐观删除）
  _removeTaskFromList(taskId) {
    if (!this._tasks) return;
    
    this._tasks = this._tasks.filter(t => t.id !== taskId);
    this._renderTaskList();
  },

  async _deleteTask(taskId) {
    if (!confirm('确定要删除这个任务吗？此操作不可恢复。')) {
      return;
    }

    // 防止重复操作
    if (this._actionLocks && this._actionLocks[taskId]) {
      return;
    }
    this._actionLocks = this._actionLocks || {};
    this._actionLocks[taskId] = true;

    // 显示加载遮罩
    this._showTaskLoading(taskId, '正在删除...');

    try {
      const result = await window.openclawAPI.tasks.delete(taskId);
      if (result.success) {
        Toast.success('任务已删除');
        // 先从本地列表移除，确保 UI 立即更新
        this._removeTaskFromList(taskId);
        // 清理本地存储的通知目标
        this._saveDeliveryTarget(taskId, null);
      } else {
        Toast.error('删除失败: ' + (result.error || '未知错误'));
        this._hideTaskLoading(taskId);
      }
    } catch (err) {
      Toast.error('删除失败: ' + err.message);
      this._hideTaskLoading(taskId);
    } finally {
      this._actionLocks[taskId] = false;
    }
  },

  _showCreateForm() {
    this._editingTask = null;
    $('#tasks-form-title').textContent = '创建任务';
    $('#task-submit-btn').textContent = '创建任务';
    $('#tasks-form').reset();
    
    // 重置调度选项显示
    ['daily', 'weekly', 'monthly', 'once', 'interval', 'custom'].forEach(t => {
      $(`#schedule-${t}`)?.classList.add('hidden');
    });
    $('#schedule-daily').classList.remove('hidden');
    
    // 设置默认值
    $('#daily-time').value = '09:00';
    $('#task-tz').value = 'Asia/Shanghai';
    
    // 隐藏高级选项
    $('#advanced-options').classList.add('hidden');
    $('#advanced-icon').textContent = '▶';
    
    $('#tasks-list-view').classList.add('hidden');
    $('#tasks-form-view').classList.remove('hidden');
  },

  _showEditForm(taskId) {
    const task = this._tasks.find(t => t.id === taskId);
    if (!task) {
      Toast.error('未找到任务');
      return;
    }

    this._editingTask = task;
    $('#tasks-form-title').textContent = '编辑任务';
    $('#task-submit-btn').textContent = '保存任务';
    
    // 填充表单
    $('#task-name').value = task.name || '';
    $('#task-message').value = task.payload?.message || '';
    $('#task-model').value = task.payload?.model || '';
    $('#task-tz').value = task.schedule?.tz || 'Asia/Shanghai';
    $('#task-disabled').checked = !task.enabled;
    
    // 处理通知渠道
    const hasChannel = task.delivery?.mode === 'announce' && task.delivery?.channel;
    $('#task-channel').value = hasChannel ? task.delivery.channel : '';
    // 从本地存储获取通知目标（因为 openclaw 任务数据中不保存 to 字段）
    const savedTo = this._getDeliveryTarget(taskId);
    $('#task-to').value = savedTo || task.delivery?.to || '';
    
    // 触发渠道切换事件，显示提示
    if (hasChannel) {
      $('#task-channel').dispatchEvent(new Event('change'));
    }

    // 调度类型 - 简化处理，默认显示为自定义
    const schedule = task.schedule || {};
    $('#task-schedule-type').value = 'custom';
    ['daily', 'weekly', 'monthly', 'once', 'interval', 'custom'].forEach(t => {
      $(`#schedule-${t}`)?.classList.add('hidden');
    });
    $('#schedule-custom').classList.remove('hidden');
    
    if (schedule.kind === 'cron') {
      $('#custom-cron').value = schedule.expr || '';
    } else if (schedule.kind === 'every') {
      $('#custom-cron').value = schedule.every || '';
    }

    $('#tasks-list-view').classList.add('hidden');
    $('#tasks-form-view').classList.remove('hidden');
  },

  _showListView() {
    $('#tasks-list-view').classList.remove('hidden');
    $('#tasks-form-view').classList.add('hidden');
    this._currentView = 'list';
    
    // 重置表单状态和按钮
    this._editingTask = null;
    this._submitting = false;
    const submitBtn = $('#task-submit-btn');
    const cancelBtn = $('#task-cancel-btn');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '确定';
      submitBtn.style.opacity = '';
    }
    if (cancelBtn) {
      cancelBtn.disabled = false;
    }
  },

  _buildCronExpression(scheduleType) {
    switch (scheduleType) {
      case 'daily': {
        const time = $('#daily-time').value || '09:00';
        const [hour, minute] = time.split(':');
        return `${minute} ${hour} * * *`;
      }
      case 'weekly': {
        const day = $('#weekly-day').value || '1';
        const time = $('#weekly-time').value || '09:00';
        const [hour, minute] = time.split(':');
        return `${minute} ${hour} * * ${day}`;
      }
      case 'monthly': {
        const date = $('#monthly-date').value || '1';
        const time = $('#monthly-time').value || '09:00';
        const [hour, minute] = time.split(':');
        return `${minute} ${hour} ${date} * *`;
      }
      case 'once': {
        const datetime = $('#once-datetime').value;
        if (!datetime) return null;
        return new Date(datetime).toISOString();
      }
      case 'interval': {
        const value = $('#interval-value').value || '30';
        const unit = $('#interval-unit').value || 'm';
        return `${value}${unit}`;
      }
      case 'custom': {
        return $('#custom-cron').value.trim();
      }
      default:
        return '0 9 * * *'; // 默认每天9点
    }
  },

  async _submitForm() {
    // 防止重复提交
    if (this._submitting) {
      return;
    }
    
    const scheduleType = $('#task-schedule-type').value;
    const scheduleValue = this._buildCronExpression(scheduleType);

    // 验证
    const name = $('#task-name').value.trim();
    const message = $('#task-message').value.trim();

    if (!name) {
      Toast.error('请输入任务标题');
      return;
    }
    if (!message) {
      Toast.error('请输入提示词');
      return;
    }
    if (!scheduleValue) {
      if (scheduleType === 'custom') {
        Toast.error('请输入 Cron 表达式');
      } else if (scheduleType === 'once') {
        Toast.error('请选择执行时间');
      } else {
        Toast.error('请设置执行时间');
      }
      return;
    }

    // 构建选项 - 只包含有效值，避免传空字符串
    const options = {
      name: name,
      message: message
    };

    // 处理调度 - 只传一个参数
    if (scheduleType === 'once') {
      options.at = scheduleValue;
    } else if (scheduleType === 'interval') {
      options.every = scheduleValue;
    } else {
      // daily, weekly, monthly, custom 都使用 cron
      options.cron = scheduleValue;
    }

    // 可选参数 - 只在有值时添加
    const tz = $('#task-tz').value;
    if (tz && tz !== 'Asia/Shanghai') {
      options.tz = tz;
    }

    const model = $('#task-model').value.trim();
    if (model) {
      options.model = model;
    }

    if ($('#task-disabled').checked) {
      options.disabled = true;
    }

    // 处理通知渠道
    const channel = $('#task-channel').value;
    const to = $('#task-to').value.trim();
    if (channel) {
      options.announce = true;
      options.channel = channel;
      // 如果选择了通知渠道但没填写目标，提示用户
      if (!to) {
        Toast.error('请填写通知目标ID');
        return;
      }
      options.to = to;
    } else {
      // 如果编辑任务时清空了通知渠道，需要传递参数来清除通知设置
      if (this._editingTask) {
        options.announce = false;
        options.channel = '';
        options.to = '';
      }
    }

    // 锁定表单并显示加载状态
    this._submitting = true;
    const submitBtn = $('#task-submit-btn');
    const cancelBtn = $('#task-cancel-btn');
    const originalBtnText = submitBtn.textContent;
    
    submitBtn.disabled = true;
    submitBtn.textContent = '提交中...';
    submitBtn.style.opacity = '0.7';
    cancelBtn.disabled = true;

    try {
      let result;
      if (this._editingTask) {
        result = await window.openclawAPI.tasks.edit(this._editingTask.id, options);
      } else {
        result = await window.openclawAPI.tasks.create(options);
      }

      if (result.success) {
        Toast.success(this._editingTask ? '任务已更新' : '任务已创建');
        
        // 保存通知目标到本地存储（因为 openclaw 任务数据中不保存 to 字段）
        const taskId = this._editingTask?.id || result.job?.id;
        if (taskId) {
          this._saveDeliveryTarget(taskId, channel ? to : null);
        }
        
        this._showListView();
        // 先更新本地缓存，再后台刷新
        this._addTaskToList(result.job);
      } else {
        Toast.error('操作失败: ' + (result.error || '未知错误'));
        // 恢复按钮状态
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
        submitBtn.style.opacity = '';
        cancelBtn.disabled = false;
      }
    } catch (err) {
      Toast.error('操作失败: ' + err.message);
      // 恢复按钮状态
      submitBtn.disabled = false;
      submitBtn.textContent = originalBtnText;
      submitBtn.style.opacity = '';
      cancelBtn.disabled = false;
    } finally {
      this._submitting = false;
    }
  },
  
  // 立即添加任务到列表（乐观更新）
  _addTaskToList(task) {
    if (!task) return;
    
    // 确保任务列表已初始化
    if (!this._tasks) {
      this._tasks = [];
    }
    
    // 如果是编辑，替换现有任务
    if (this._editingTask) {
      const index = this._tasks.findIndex(t => t.id === task.id);
      if (index >= 0) {
        this._tasks[index] = task;
      } else {
        this._tasks.unshift(task);
      }
    } else {
      // 新任务，添加到开头
      this._tasks.unshift(task);
    }
    
    // 重新渲染列表
    this._renderTaskList();
    
    // 后台静默刷新数据
    this._refreshTasksInBackground();
  },
  
  // 后台静默刷新任务列表
  async _refreshTasksInBackground() {
    try {
      const result = await window.openclawAPI.tasks.list(true);
      if (result.success) {
        this._tasks = result.jobs || [];
        this._renderTaskList();
      }
    } catch (err) {
      // 静默失败，不影响用户体验
      console.error('Background refresh failed:', err);
    }
  },

  async _refreshCurrentView() {
    await this._loadTasks(true);
  },

  _escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  async activate() {
    await this._loadTasks();
    // 启动轮询
    this._startPoll();
  },

  _startPoll() {
    this._stopPoll();
    this._pollTimer = setInterval(() => {
      this._loadTasks();
    }, TIMEOUTS.statusPollInterval); // 30秒刷新一次
  },

  _stopPoll() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  cleanup() {
    this._stopPoll();
  }
};
