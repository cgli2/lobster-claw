const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('openclawAPI', {
  // Dependency checking
  deps: {
    checkAll: () => ipcRenderer.invoke('deps:check-all'),
    checkForMode: (mode) => ipcRenderer.invoke('deps:check-for-mode', mode),
    checkWsl: () => ipcRenderer.invoke('deps:check-wsl'),
    
    // 安装方法 - 返回 Promise，支持 await
    installNode: (method) => ipcRenderer.invoke('deps:install-node', method),
    installGit: () => ipcRenderer.invoke('deps:install-git'),
    installWsl: () => ipcRenderer.invoke('deps:install-wsl'),
    installNodeWsl: () => ipcRenderer.invoke('deps:install-node-wsl'),
    
    // 模式管理
    setExecutionMode: (mode) => ipcRenderer.invoke('deps:set-execution-mode', mode),
    getExecutionMode: () => ipcRenderer.invoke('deps:get-execution-mode'),
    
    // 进度监听
    onDepsProgress: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('deps:progress', listener);
      return () => ipcRenderer.removeListener('deps:progress', listener);
    },
    onWslProgress: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('deps:wsl-progress', listener);
      return () => ipcRenderer.removeListener('deps:wsl-progress', listener);
    }
  },

  // OpenClaw installation
  install: {
    run: (options) => ipcRenderer.send('install:run', options),
    update: () => ipcRenderer.send('install:update'),
    getVersion: () => ipcRenderer.invoke('install:get-version'),
    uninstall: () => ipcRenderer.send('uninstall:run'),
    onInstallProgress: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('install:progress', listener);
      return () => ipcRenderer.removeListener('install:progress', listener);
    },
    onUninstallProgress: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('uninstall:progress', listener);
      return () => ipcRenderer.removeListener('uninstall:progress', listener);
    }
  },

  // Config management
  config: {
    read: () => ipcRenderer.invoke('config:read'),
    write: (data) => ipcRenderer.invoke('config:write', data),
    getPath: () => ipcRenderer.invoke('config:get-path'),
    writeOnboard: (formData) => ipcRenderer.invoke('config:write-onboard', formData),
    testConnection: (params) => ipcRenderer.invoke('config:test-connection', params),
    installDaemon: () => ipcRenderer.send('config:install-daemon'),
    onDaemonProgress: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('config:daemon-progress', listener);
      return () => ipcRenderer.removeListener('config:daemon-progress', listener);
    },
    // Auth profiles management
    readAuthProfiles: (agentId) => ipcRenderer.invoke('config:read-auth-profiles', agentId),
    writeAuthProfiles: (profiles, agentId) => ipcRenderer.invoke('config:write-auth-profiles', profiles, agentId),
    setProviderApiKey: (providerId, apiKey, agentId) => ipcRenderer.invoke('config:set-provider-apikey', providerId, apiKey, agentId),
    removeProviderApiKey: (providerId, agentId) => ipcRenderer.invoke('config:remove-provider-apikey', providerId, agentId),
    // Models config management for agent
    readModels: (agentId) => ipcRenderer.invoke('config:read-models', agentId),
    writeModels: (modelsConfig, agentId) => ipcRenderer.invoke('config:write-models', modelsConfig, agentId),
    setProviderModels: (providerId, providerConfig, agentId) => ipcRenderer.invoke('config:set-provider-models', providerId, providerConfig, agentId)
  },

  // Environment variables
  env: {
    read: () => ipcRenderer.invoke('env:read'),
    write: (envMap) => ipcRenderer.invoke('env:write', envMap),
    // 设置单个 API Key 到 .env（合并写）
    setApiKey: (envKey, apiKey) => ipcRenderer.invoke('env:set-api-key', envKey, apiKey),
    // 从 .env 删除单个 API Key
    removeApiKey: (envKey) => ipcRenderer.invoke('env:remove-api-key', envKey)
  },

  // Service control
  service: {
    start: () => ipcRenderer.invoke('service:start'),
    stop: () => ipcRenderer.invoke('service:stop'),
    restart: () => ipcRenderer.invoke('service:restart'),
    getStatus: () => ipcRenderer.invoke('service:get-status'),
    getAutostart: () => ipcRenderer.invoke('service:get-autostart'),
    setAutostart: (enable) => ipcRenderer.invoke('service:set-autostart', enable),
    installAutostart: () => ipcRenderer.invoke('service:install-autostart'),
    onStatusChange: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('service:status-change', listener);
      return () => ipcRenderer.removeListener('service:status-change', listener);
    },
    onServiceProgress: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('service:progress', listener);
      return () => ipcRenderer.removeListener('service:progress', listener);
    }
  },

  // Diagnostics
  doctor: {
    run: () => ipcRenderer.invoke('doctor:run'),
    validateAndFix: () => ipcRenderer.invoke('doctor:validate-and-fix')
  },

  // Logs
  logs: {
    read: (logType, lines) => ipcRenderer.invoke('logs:read', logType, lines),
    getInfo: (logType) => ipcRenderer.invoke('logs:getInfo', logType),
    startWatch: (logType) => ipcRenderer.send('logs:watch-start', logType),
    stopWatch: () => ipcRenderer.send('logs:watch-stop'),
    onLogLine: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('logs:line', listener);
      return () => ipcRenderer.removeListener('logs:line', listener);
    }
  },

  // Profile management
  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    switchTo: (name) => ipcRenderer.invoke('profiles:switch', name),
    create: (name, description) => ipcRenderer.invoke('profiles:create', name, description),
    remove: (name) => ipcRenderer.invoke('profiles:delete', name),
    exportProfile: (name) => ipcRenderer.invoke('profiles:export', name),
    importProfile: () => ipcRenderer.invoke('profiles:import'),
    showSaveDialog: () => ipcRenderer.invoke('profiles:save-dialog'),
    showOpenDialog: () => ipcRenderer.invoke('profiles:open-dialog')
  },

  // Dialog
  dialog: {
    selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
    selectFiles: () => ipcRenderer.invoke('dialog:selectFiles')
  },

  // MCP management
  mcp: {
    list: () => ipcRenderer.invoke('mcp:list'),
    add: (config) => ipcRenderer.invoke('mcp:add', config),
    remove: (name) => ipcRenderer.invoke('mcp:remove', name),
    update: (name, config) => ipcRenderer.invoke('mcp:update', name, config)
  },

  // Skills management
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    install: (skillId, version) => ipcRenderer.invoke('skills:install', skillId, version),
    remove: (skillId) => ipcRenderer.invoke('skills:remove', skillId),
    enable: (skillId) => ipcRenderer.invoke('skills:enable', skillId),
    disable: (skillId) => ipcRenderer.invoke('skills:disable', skillId),
    search: (query) => ipcRenderer.invoke('skills:search', query),
    explore: () => ipcRenderer.invoke('skills:explore'),
    listInstalled: () => ipcRenderer.invoke('skills:list-installed'),
    inspect: (skillId) => ipcRenderer.invoke('skills:inspect', skillId),
    info: (skillId) => ipcRenderer.invoke('skills:info', skillId),
    importBundled: () => ipcRenderer.invoke('skills:import-bundled'),
    getBundledList: () => ipcRenderer.invoke('skills:get-bundled-list'),
    createCustom: (options) => ipcRenderer.invoke('skills:create-custom', options),
    onImportProgress: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('skills:import-progress', listener);
      return () => ipcRenderer.removeListener('skills:import-progress', listener);
    }
  },

  // Channels management
  channels: {
    list: () => ipcRenderer.invoke('channels:list'),
    get: (channelType) => ipcRenderer.invoke('channels:get', channelType),
    update: (channelType, config) => ipcRenderer.invoke('channels:update', channelType, config),
    setEnabled: (channelType, enabled) => ipcRenderer.invoke('channels:set-enabled', channelType, enabled),
    test: (channelType, config) => ipcRenderer.invoke('channels:test', channelType, config),
    verifyPairing: (channelType, pairingCode) => ipcRenderer.invoke('channels:verify-pairing', channelType, pairingCode),
    definitions: () => ipcRenderer.invoke('channels:definitions')
  },

  // Tasks (Cron Jobs) management
  tasks: {
    list: (includeDisabled = true) => ipcRenderer.invoke('tasks:list', includeDisabled),
    create: (options) => ipcRenderer.invoke('tasks:create', options),
    edit: (taskId, options) => ipcRenderer.invoke('tasks:edit', taskId, options),
    enable: (taskId) => ipcRenderer.invoke('tasks:enable', taskId),
    disable: (taskId) => ipcRenderer.invoke('tasks:disable', taskId),
    delete: (taskId) => ipcRenderer.invoke('tasks:delete', taskId),
    run: (taskId) => ipcRenderer.invoke('tasks:run', taskId),
    history: (taskId, limit = 50) => ipcRenderer.invoke('tasks:history', taskId, limit),
    status: () => ipcRenderer.invoke('tasks:status')
  },

  // Chat management
  chat: {
    send: (options) => ipcRenderer.invoke('chat:send', options),
    sendLocal: (options) => ipcRenderer.invoke('chat:send-local', options),
    listAgents: () => ipcRenderer.invoke('chat:agents'),
    listSkills: () => ipcRenderer.invoke('chat:skills'),
    clearSession: (sessionId) => ipcRenderer.invoke('chat:clear-session', sessionId),
    // Session storage
    saveSession: (sessionId, messages, metadata) => ipcRenderer.invoke('chat:save-session', sessionId, messages, metadata),
    loadSession: (sessionId) => ipcRenderer.invoke('chat:load-session', sessionId),
    loadSessionMessages: (sessionId, offset, limit) => ipcRenderer.invoke('chat:load-session-messages', sessionId, offset, limit),
    listSessions: (limit) => ipcRenderer.invoke('chat:list-sessions', limit),
    deleteSession: (sessionId) => ipcRenderer.invoke('chat:delete-session', sessionId),
    saveSummary: (sessionId, summary, knowledgeItems) => ipcRenderer.invoke('chat:save-summary', sessionId, summary, knowledgeItems),
    getKnowledge: () => ipcRenderer.invoke('chat:get-knowledge'),
    getSessionStats: (sessionId) => ipcRenderer.invoke('chat:session-stats', sessionId),
    onStream: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('chat:stream', listener);
      return () => ipcRenderer.removeListener('chat:stream', listener);
    },
    // IM 渠道消息监听（飞书/钉钉等外部渠道消息同步到智能对话面板）
    startImWatch: () => ipcRenderer.send('chat:im-watch-start'),
    stopImWatch: () => ipcRenderer.send('chat:im-watch-stop'),
    onImMessage: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('chat:im-message', listener);
      return () => ipcRenderer.removeListener('chat:im-message', listener);
    }
  },

  // Utilities
  utils: {
    openExternal: (url) => ipcRenderer.send('utils:open-external', url),
    getAppVersion: () => ipcRenderer.invoke('utils:get-app-version'),
    getPlatformInfo: () => ipcRenderer.invoke('utils:get-platform-info'),
    checkPath: () => ipcRenderer.invoke('path:check'),
    addPath: (pathToAdd) => ipcRenderer.invoke('path:add', pathToAdd),
    runDiagnostics: () => ipcRenderer.invoke('diagnostics:run'),
    saveDiagnosticReport: () => ipcRenderer.invoke('diagnostics:save-report')
  }
});
