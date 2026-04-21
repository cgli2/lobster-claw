/* eslint-disable no-unused-vars, no-undef */
const DashboardController = {
  _initialized: false,
  _currentTab: 'status',

  _tabs: {
    status: TabStatus,
    chat: TabChat,
    apikeys: TabApiKeys,
    env: TabEnv,
    config: TabConfig,
    service: TabService,
    logs: TabLogs,
    mcp: TabMcp,
    profiles: TabProfiles,
    skills: TabSkills,
    channels: TabChannels,
    tasks: TabTasks
  },

  _initializedTabs: new Set(),

  init(version) {
    if (this._initialized) return;
    this._initialized = true;

    // Set version badge
    const badge = $('#version-badge');
    if (badge) {
      badge.textContent = version ? 'v' + version : '未安装';
    }

    // Bind tab navigation
    $$('.tab-nav .tab-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        if (tab) this.switchTab(tab);
      });
    });

    // Load initial tab
    this.switchTab('status');
  },

  /** Reset dashboard state so it can be re-initialized */
  reset() {
    // Cleanup current tab
    if (this._initialized) {
      const prevTab = this._tabs[this._currentTab];
      if (prevTab && prevTab.cleanup) {
        prevTab.cleanup();
      }
    }
    this._initialized = false;
    this._currentTab = 'status';
    this._initializedTabs.clear();
    // 清空所有已渲染的 tab DOM
    const content = $('#tab-content');
    if (content) content.innerHTML = '';
  },

  switchTab(tabName) {
    if (!this._tabs[tabName]) return;

    // Cleanup previous tab if it has a cleanup method
    const prevTab = this._tabs[this._currentTab];
    if (prevTab && prevTab.cleanup) {
      prevTab.cleanup();
    }

    this._currentTab = tabName;

    // Update nav active state
    $$('.tab-nav .tab-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    const tab = this._tabs[tabName];
    const alreadyRendered = this._initializedTabs.has(tabName);

    if (!alreadyRendered) {
      // 首次切入：隐藏其他已渲染的 tab，创建新容器
      const content = $('#tab-content');
      $$('.tab-page', content).forEach(p => (p.style.display = 'none'));
      const page = document.createElement('div');
      page.className = 'tab-page active';
      page.id = `tab-page-${tabName}`;
      content.appendChild(page);
      if (tab && tab.render) {
        tab.render(page);
        this._initializedTabs.add(tabName);
      }
    } else {
      // 已渲染过：隐藏其他，显示当前
      const content = $('#tab-content');
      $$('.tab-page', content).forEach(p => (p.style.display = 'none'));
      const page = $(`#tab-page-${tabName}`);
      if (page) page.style.display = '';
      // 只调用 activate（无需重建 DOM）
      if (tab && tab.activate) {
        tab.activate();
      }
      return;
    }

    // 首次渲染后调用 activate
    if (tab && tab.activate) {
      tab.activate();
    }
  }
};
