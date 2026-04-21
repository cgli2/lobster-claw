const { ipcMain, shell, dialog, app } = require('electron');
const os = require('os');
const path = require('path');
const ShellExecutor = require('./utils/shell-executor');
const DependencyChecker = require('./services/dependency-checker');
const OpenClawInstaller = require('./services/openclaw-installer');
const Diagnostics = require('./utils/diagnostics');
const OnboardConfigWriter = require('./services/onboard-config-writer');
const OpenClawUninstaller = require('./services/openclaw-uninstaller');
const ConfigManager = require('./services/config-manager');
const EnvManager = require('./services/env-manager');
const ServiceController = require('./services/service-controller');
const LogManager = require('./services/log-manager');
const StatusMonitor = require('./services/status-monitor');
const ProfileManager = require('./services/profile-manager');
const McpManager = require('./services/mcp-manager');
const PathFixer = require('./services/path-fixer');
const SkillManager = require('./services/skill-manager');
const ChannelManager = require('./services/channel-manager');
const TaskManager = require('./services/task-manager');
const ChatService = require('./services/chat-service');
const ChatStorage = require('./services/chat-storage');
const ImMessageMonitor = require('./services/im-message-monitor');
const Logger = require('./utils/logger');

function registerAllHandlers(mainWindow) {
  const sendToRenderer = (channel, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  };

  const depChecker = new DependencyChecker();
  const installer = new OpenClawInstaller();
  const onboardWriter = new OnboardConfigWriter();
  const configMgr = new ConfigManager();
  const envMgr = new EnvManager();
  const serviceCtrl = new ServiceController();
  const logMgr = new LogManager();
  const statusMon = new StatusMonitor();
  const profileMgr = new ProfileManager();
  const mcpMgr = new McpManager();
  const skillMgr = new SkillManager();
  const channelMgr = new ChannelManager();
  const taskMgr = new TaskManager();
  const uninstaller = new OpenClawUninstaller();
  const pathFixer = new PathFixer();
  const chatService = new ChatService();
  const chatStorage = new ChatStorage();
  const imMonitor = new ImMessageMonitor();

  // === Dependencies ===
  
  // 检测所有依赖
  ipcMain.handle('deps:check-all', async () => {
    Logger.info('IPC: deps:check-all called');
    try {
      const result = await depChecker.checkAll();
      Logger.info('IPC: deps:check-all result: ' + JSON.stringify({
        node: result.node?.installed,
        npm: result.npm?.installed,
        git: result.git?.installed
      }));
      return result;
    } catch (err) {
      Logger.error('IPC: deps:check-all error: ' + err.message);
      throw err;
    }
  });

  // 安装 Node.js - 使用 handle 返回结果
  ipcMain.handle('deps:install-node', async (_event, method) => {
    Logger.info(`IPC: deps:install-node called with method: ${method}`);
    try {
      const result = await depChecker.installNode(method, (progress) => {
        sendToRenderer('deps:progress', progress);
      });
      Logger.info('IPC: deps:install-node completed: ' + JSON.stringify(result));
      return result;
    } catch (err) {
      Logger.error('IPC: deps:install-node error: ' + err.message);
      sendToRenderer('deps:progress', { step: 'error', message: err.message, percent: 0 });
      throw err;
    }
  });

  // 安装 Git - 使用 handle 返回结果
  ipcMain.handle('deps:install-git', async () => {
    Logger.info('IPC: deps:install-git called');
    try {
      const result = await depChecker.installGit((progress) => {
        sendToRenderer('deps:progress', progress);
      });
      Logger.info('IPC: deps:install-git completed: ' + JSON.stringify(result));
      return result;
    } catch (err) {
      Logger.error('IPC: deps:install-git error: ' + err.message);
      sendToRenderer('deps:progress', { step: 'error', message: err.message, percent: 0 });
      throw err;
    }
  });

  // WSL detection
  ipcMain.handle('deps:check-wsl', async () => {
    return await depChecker.checkWsl();
  });

  // WSL installation - 使用 handle 返回结果
  ipcMain.handle('deps:install-wsl', async () => {
    Logger.info('IPC: deps:install-wsl called');
    try {
      const result = await depChecker.installWsl((progress) => {
        sendToRenderer('deps:wsl-progress', progress);
      });
      return result;
    } catch (err) {
      sendToRenderer('deps:wsl-progress', { step: 'error', message: err.message, percent: 0 });
      throw err;
    }
  });

  // Execution mode management
  ipcMain.handle('deps:set-execution-mode', (_event, mode) => {
    ShellExecutor.setExecutionMode(mode);
    return { success: true, mode };
  });

  ipcMain.handle('deps:get-execution-mode', () => {
    return ShellExecutor.getExecutionMode();
  });

  // Mode-specific dependency check
  ipcMain.handle('deps:check-for-mode', async (_event, mode) => {
    Logger.info(`IPC: deps:check-for-mode called with mode: ${mode}`);
    try {
      const result = await depChecker.checkForMode(mode);
      Logger.info('IPC: deps:check-for-mode result: ' + JSON.stringify({
        node: result.node?.installed,
        npm: result.npm?.installed,
        git: result.git?.installed
      }));
      return result;
    } catch (err) {
      Logger.error('IPC: deps:check-for-mode error: ' + err.message);
      throw err;
    }
  });

  // Install Node in WSL - 使用 handle 返回结果
  ipcMain.handle('deps:install-node-wsl', async () => {
    Logger.info('IPC: deps:install-node-wsl called');
    try {
      const result = await depChecker.installNodeInWsl((progress) => {
        sendToRenderer('deps:progress', progress);
      });
      return result;
    } catch (err) {
      sendToRenderer('deps:progress', { step: 'error', message: err.message, percent: 0 });
      throw err;
    }
  });

  // === Install ===
  ipcMain.handle('install:get-version', async () => {
    try {
      Logger.info('IPC: install:get-version called');
      const version = await installer.getVersion();
      Logger.info('IPC: install:get-version returning: ' + version);
      return version;
    } catch (err) {
      Logger.error('get-version handler error: ' + err.message);
      Logger.error('get-version handler stack: ' + err.stack);
      return null;
    }
  });

  ipcMain.on('install:run', async (_event, options) => {
    try {
      // Apply mirror setting before install if requested
      if (options?.useMirror) {
        try {
          await installer.setMirror(true);
          sendToRenderer('install:progress', { step: 'mirror', message: '已切换到国内镜像源 (npmmirror.com)', percent: 3 });
        } catch (err) {
          sendToRenderer('install:progress', { step: 'mirror', message: '镜像源设置失败，使用默认源继续', percent: 3 });
        }
      }
      // installDir: 用户在向导中选择的 npm prefix 目录（可选，未选时使用默认值）
      await installer.install((progress) => {
        sendToRenderer('install:progress', progress);
      }, options?.installDir || null);
    } catch (err) {
      sendToRenderer('install:progress', { step: 'error', message: err.message, percent: 0 });
    }
  });

  ipcMain.on('install:update', async () => {
    try {
      await installer.update((progress) => {
        sendToRenderer('install:progress', progress);
      });
    } catch (err) {
      sendToRenderer('install:progress', { step: 'error', message: err.message, percent: 0 });
    }
  });

  // === Config ===
  ipcMain.handle('config:read', async () => {
    return await configMgr.read();
  });

  ipcMain.handle('config:write', async (_event, data) => {
    return await configMgr.write(data);
  });

  ipcMain.handle('config:get-path', () => {
    return configMgr.getConfigPath();
  });

  // Auth profiles management
  ipcMain.handle('config:read-auth-profiles', async (_event, agentId = 'main') => {
    return await configMgr.readAuthProfiles(agentId);
  });

  ipcMain.handle('config:write-auth-profiles', async (_event, profiles, agentId = 'main') => {
    return await configMgr.writeAuthProfiles(profiles, agentId);
  });

  ipcMain.handle('config:set-provider-apikey', async (_event, providerId, apiKey, agentId = 'main') => {
    return await configMgr.setProviderApiKey(providerId, apiKey, agentId);
  });

  ipcMain.handle('config:remove-provider-apikey', async (_event, providerId, agentId = 'main') => {
    return await configMgr.removeProviderApiKey(providerId, agentId);
  });

  // Models config management for agent
  ipcMain.handle('config:read-models', async (_event, agentId = 'main') => {
    return await configMgr.readModels(agentId);
  });

  ipcMain.handle('config:write-models', async (_event, modelsConfig, agentId = 'main') => {
    return await configMgr.writeModels(modelsConfig, agentId);
  });

  ipcMain.handle('config:set-provider-models', async (_event, providerId, providerConfig, agentId = 'main') => {
    return await configMgr.setProviderModels(providerId, providerConfig, agentId);
  });

  // Onboard config write (replaces CLI onboard)
  ipcMain.handle('config:write-onboard', async (_event, formData) => {
    return await onboardWriter.writeOnboard(formData);
  });

  // Daemon installation (streaming)
  ipcMain.on('config:install-daemon', async () => {
    try {
      await onboardWriter.installDaemon((progress) => {
        sendToRenderer('config:daemon-progress', progress);
      });
    } catch (err) {
      sendToRenderer('config:daemon-progress', { step: 'error', message: err.message, percent: 0 });
    }
  });

  // Test AI provider connection
  ipcMain.handle('config:test-connection', async (_event, params) => {
    const { apiKey, baseUrl, model } = params;
    try {
      // Use Node.js built-in https/http to make a lightweight chat completion request
      const url = new URL(baseUrl.replace(/\/+$/, '') + '/chat/completions');
      const https = require(url.protocol === 'https:' ? 'https' : 'http');

      const postData = JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1
      });

      const headers = { 'Content-Type': 'application/json' };
      // Only set Authorization header if API key is provided (Ollama doesn't need it)
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const result = await new Promise((resolve, reject) => {
        const req = https.request(url, {
          method: 'POST',
          headers: headers,
          timeout: 30000
        }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try {
              const json = JSON.parse(body);
              if (res.statusCode >= 200 && res.statusCode < 300) {
                const reply = json.choices?.[0]?.message?.content || '';
                resolve({ success: true, message: `模型 ${model} 响应正常` + (reply ? ` (${reply.substring(0, 50)})` : '') });
              } else {
                const errMsg = json.error?.message || json.message || body.substring(0, 200);
                resolve({ success: false, message: `HTTP ${res.statusCode}: ${errMsg}` });
              }
            } catch {
              resolve({ success: false, message: `HTTP ${res.statusCode}: ${body.substring(0, 200)}` });
            }
          });
        });

        req.on('error', (err) => reject(err));
        req.on('timeout', () => { req.destroy(); reject(new Error('请求超时 (30秒)')); });
        req.write(postData);
        req.end();
      });

      return result;
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  // === Env ===
  ipcMain.handle('env:read', async () => {
    return await envMgr.read();
  });

  ipcMain.handle('env:write', async (_event, envMap) => {
    return await envMgr.write(envMap);
  });

  // 设置单个 API Key 到 .env（合并写，不覆盖其他条目）
  ipcMain.handle('env:set-api-key', async (_event, envKey, apiKey) => {
    return await envMgr.setApiKey(envKey, apiKey);
  });

  // 从 .env 删除单个 API Key
  ipcMain.handle('env:remove-api-key', async (_event, envKey) => {
    return await envMgr.removeApiKey(envKey);
  });

  // === PATH Fixer ===
  ipcMain.handle('path:check', async () => {
    return await pathFixer.checkAndFix();
  });

  ipcMain.handle('path:add', async (_event, pathToAdd) => {
    return pathFixer.addToSystemPath(pathToAdd);
  });

  // === Service ===
  ipcMain.handle('service:start', async () => {
    const result = await serviceCtrl.start((progress) => {
      sendToRenderer('service:progress', progress);
    });
    // Gateway 启动后立即使探测缓存失效，下次发消息可立刻探测到新状态
    chatService.invalidateGatewayCache();
    return result;
  });

  ipcMain.handle('service:stop', async () => {
    const result = await serviceCtrl.stop();
    // Gateway 停止后立即使探测缓存失效
    chatService.invalidateGatewayCache();
    return result;
  });

  ipcMain.handle('service:restart', async () => {
    return await serviceCtrl.restart((progress) => {
      sendToRenderer('service:progress', progress);
    });
  });

  ipcMain.handle('service:get-status', async () => {
    return await serviceCtrl.getStatus();
  });

  ipcMain.handle('service:get-autostart', async () => {
    return await serviceCtrl.getAutostart();
  });

  ipcMain.handle('service:set-autostart', async (_event, enable) => {
    return await serviceCtrl.setAutostart(enable);
  });

  ipcMain.handle('service:install-autostart', async () => {
    return await serviceCtrl.installAutostartTask();
  });

  // === Doctor ===
  ipcMain.handle('doctor:run', async () => {
    return await statusMon.runDoctor();
  });

  // 增强版诊断：config validate → status → doctor --fix（有错时）
  ipcMain.handle('doctor:validate-and-fix', async () => {
    return await statusMon.runValidateAndFix();
  });

  // === Logs ===
  ipcMain.handle('logs:read', async (_event, logType, lines) => {
    return await logMgr.read(logType, lines);
  });

  ipcMain.handle('logs:getInfo', async (_event, logType) => {
    return await logMgr.getLogInfo(logType);
  });

  ipcMain.on('logs:watch-start', (_event, logType) => {
    logMgr.startWatch(logType, (line) => {
      sendToRenderer('logs:line', line);
    });
  });

  ipcMain.on('logs:watch-stop', () => {
    logMgr.stopWatch();
  });

  // === Profiles ===
  ipcMain.handle('profiles:list', async () => {
    return await profileMgr.list();
  });

  ipcMain.handle('profiles:switch', async (_event, name) => {
    return await profileMgr.switchTo(name);
  });

  ipcMain.handle('profiles:create', async (_event, name, description) => {
    return await profileMgr.create(name, description);
  });

  ipcMain.handle('profiles:delete', async (_event, name) => {
    return await profileMgr.remove(name);
  });

  ipcMain.handle('profiles:export', async (_event, name) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出配置档案',
      defaultPath: `${name}.json`,
      filters: [{ name: 'JSON 文件', extensions: ['json'] }]
    });
    if (!result.canceled && result.filePath) {
      return await profileMgr.exportProfile(name, result.filePath);
    }
    return { success: false, message: '已取消' };
  });

  ipcMain.handle('profiles:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入配置档案',
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return await profileMgr.importProfile(result.filePaths[0]);
    }
    return { success: false, message: '已取消' };
  });

  // === Directory Selection ===
  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择工作目录',
      properties: ['openDirectory', 'createDirectory']
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, path: result.filePaths[0] };
    }
    return { success: false, message: '已取消' };
  });

  // === File Selection for Chat Attachments ===
  ipcMain.handle('dialog:selectFiles', async () => {
    const supportedExts = [
      '.txt', '.md', '.markdown', '.log', '.csv',
      '.json', '.yaml', '.yml', '.xml', '.html', '.htm',
      '.js', '.ts', '.py', '.java', '.c', '.cpp', '.h', '.cs', '.go', '.rs', '.php', '.rb', '.sh',
      '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.pdf'
    ];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择附件文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '支持的文件类型', extensions: supportedExts.map(e => e.slice(1)) },
        { name: '文本文件', extensions: ['txt', 'md', 'markdown', 'log', 'csv', 'json', 'yaml', 'yml', 'xml'] },
        { name: 'Office 文件', extensions: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf'] },
        { name: '代码文件', extensions: ['js', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'php', 'rb', 'sh'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, message: '已取消', files: [] };
    }

    const fs = require('fs');
    const path = require('path');
    const files = [];
    const MAX_FILE_SIZE = 500 * 1024; // 500KB 限制，避免消息过长

    for (const filePath of result.filePaths) {
      const ext = path.extname(filePath).toLowerCase();
      const name = path.basename(filePath);
      try {
        const stat = fs.statSync(filePath);
        if (stat.size > MAX_FILE_SIZE) {
          files.push({ name, path: filePath, error: `文件过大（${Math.round(stat.size / 1024)}KB，上限 500KB）` });
          continue;
        }
        // Office/PDF 类型提示用户内容为纯文本（不支持提取富文本）
        const binaryExts = ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.pdf'];
        if (binaryExts.includes(ext)) {
          files.push({ name, path: filePath, error: `${ext} 格式暂不支持直接读取内容，请转存为 .txt 或 .md 后重试` });
          continue;
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        files.push({ name, path: filePath, content, size: stat.size });
      } catch (err) {
        files.push({ name, path: filePath, error: `读取失败: ${err.message}` });
      }
    }

    return { success: true, files };
  });


  // === MCP ===
  ipcMain.handle('mcp:list', async () => {
    return await mcpMgr.list();
  });

  ipcMain.handle('mcp:add', async (_event, config) => {
    return await mcpMgr.add(config);
  });

  ipcMain.handle('mcp:remove', async (_event, name) => {
    return await mcpMgr.remove(name);
  });

  ipcMain.handle('mcp:update', async (_event, name, config) => {
    return await mcpMgr.update(name, config);
  });

  // === Skills ===
  ipcMain.handle('skills:list', async () => {
    return await skillMgr.list();
  });

  ipcMain.handle('skills:install', async (_event, skillId, version) => {
    return await skillMgr.install(skillId, version);
  });

  ipcMain.handle('skills:remove', async (_event, skillId) => {
    return await skillMgr.remove(skillId);
  });

  ipcMain.handle('skills:enable', async (_event, skillId) => {
    return await skillMgr.enable(skillId);
  });

  ipcMain.handle('skills:disable', async (_event, skillId) => {
    return await skillMgr.disable(skillId);
  });

  ipcMain.handle('skills:search', async (_event, query) => {
    return await skillMgr.search(query);
  });

  ipcMain.handle('skills:explore', async () => {
    return await skillMgr.explore();
  });

  ipcMain.handle('skills:list-installed', async () => {
    return await skillMgr.listInstalled();
  });

  ipcMain.handle('skills:inspect', async (_event, skillId) => {
    return await skillMgr.inspect(skillId);
  });

  ipcMain.handle('skills:info', async (_event, skillId) => {
    return await skillMgr.getInfo(skillId);
  });

  ipcMain.handle('skills:import-bundled', async (event) => {
    return await skillMgr.importBundledSkills((progress) => {
      event.sender.send('skills:import-progress', progress);
    });
  });

  ipcMain.handle('skills:get-bundled-list', async () => {
    return skillMgr.getBundledSkillsList();
  });

  ipcMain.handle('skills:create-custom', async (_event, options) => {
    return await skillMgr.createCustomSkill(options);
  });

  // === Channels ===
  ipcMain.handle('channels:list', async () => {
    return await channelMgr.list();
  });

  ipcMain.handle('channels:get', async (_event, channelType) => {
    return await channelMgr.get(channelType);
  });

  ipcMain.handle('channels:update', async (_event, channelType, config) => {
    return await channelMgr.update(channelType, config);
  });

  ipcMain.handle('channels:set-enabled', async (_event, channelType, enabled) => {
    return await channelMgr.setEnabled(channelType, enabled);
  });

  ipcMain.handle('channels:test', async (_event, channelType, config) => {
    return await channelMgr.testConnection(channelType, config);
  });

  ipcMain.handle('channels:verify-pairing', async (_event, channelType, pairingCode) => {
    return await channelMgr.verifyPairingCode(channelType, pairingCode);
  });

  ipcMain.handle('channels:definitions', async () => {
    return channelMgr.getChannelDefinitions();
  });

  // === Uninstall ===
  ipcMain.on('uninstall:run', async () => {
    try {
      await uninstaller.uninstall((progress) => {
        sendToRenderer('uninstall:progress', progress);
      });
    } catch (err) {
      sendToRenderer('uninstall:progress', { step: 'error', message: err.message, percent: 0 });
    }
  });

  // === Utils ===
  ipcMain.on('utils:open-external', (_event, url) => {
    shell.openExternal(url);
  });

  ipcMain.handle('utils:get-app-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('utils:get-platform-info', async () => {
    // Use system node, not Electron's bundled node (process.version)
    let systemNodeVersion = null;
    try {
      const output = await ShellExecutor.getOutput('node', ['--version'], { timeout: 10000 });
      if (output) systemNodeVersion = output.trim();
    } catch {}

    return {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: systemNodeVersion || process.version,
      osRelease: os.release(),
      homeDir: os.homedir()
    };
  });

  // === Diagnostics ===
  ipcMain.handle('diagnostics:run', async () => {
    return await Diagnostics.runFullDiagnostic();
  });

  ipcMain.handle('diagnostics:save-report', async () => {
    return await Diagnostics.saveReportToFile();
  });

  // === Tasks (Cron Jobs) ===
  ipcMain.handle('tasks:list', async (_event, includeDisabled = true) => {
    return await taskMgr.listTasks(includeDisabled);
  });

  ipcMain.handle('tasks:create', async (_event, options) => {
    return await taskMgr.createTask(options);
  });

  ipcMain.handle('tasks:edit', async (_event, taskId, options) => {
    return await taskMgr.editTask(taskId, options);
  });

  ipcMain.handle('tasks:enable', async (_event, taskId) => {
    return await taskMgr.enableTask(taskId);
  });

  ipcMain.handle('tasks:disable', async (_event, taskId) => {
    return await taskMgr.disableTask(taskId);
  });

  ipcMain.handle('tasks:delete', async (_event, taskId) => {
    return await taskMgr.deleteTask(taskId);
  });

  ipcMain.handle('tasks:run', async (_event, taskId) => {
    return await taskMgr.runTask(taskId);
  });

  ipcMain.handle('tasks:history', async (_event, taskId, limit = 50) => {
    return await taskMgr.getTaskHistory(taskId, limit);
  });

  ipcMain.handle('tasks:status', async () => {
    return await taskMgr.getSchedulerStatus();
  });

  // === Chat ===
  
  // 发送消息到 OpenClaw Agent
  ipcMain.handle('chat:send', async (_event, options) => {
    Logger.info('IPC: chat:send called');
    try {
      // 使用流式回调
      const result = await chatService.sendMessage(options, (type, data) => {
        sendToRenderer('chat:stream', { type, data });
      });
      Logger.info('IPC: chat:send result: ' + JSON.stringify({ success: result?.success, error: result?.error || 'none', replyLength: result?.reply?.length || 0 }));
      return result;
    } catch (err) {
      Logger.error('IPC: chat:send error: ' + err.message);
      return { success: false, error: err.message };
    }
  });

  // 使用本地模式发送消息
  ipcMain.handle('chat:send-local', async (_event, options) => {
    Logger.info('IPC: chat:send-local called');
    try {
      const result = await chatService.sendMessageLocal(options, (type, data) => {
        sendToRenderer('chat:stream', { type, data });
      });
      return result;
    } catch (err) {
      Logger.error('IPC: chat:send-local error: ' + err.message);
      return { success: false, error: err.message };
    }
  });

  // 获取可用代理列表
  ipcMain.handle('chat:agents', async () => {
    return await chatService.listAgents();
  });

  // 获取技能列表
  ipcMain.handle('chat:skills', async () => {
    return await chatService.listSkills();
  });

  // 清理会话
  ipcMain.handle('chat:clear-session', async (_event, sessionId) => {
    return chatService.clearSession(sessionId);
  });

  // === Chat Storage ===
  
  // 保存会话
  ipcMain.handle('chat:save-session', async (_event, sessionId, messages, metadata) => {
    return chatStorage.saveSession(sessionId, messages, metadata);
  });

  // 加载会话
  ipcMain.handle('chat:load-session', async (_event, sessionId) => {
    return chatStorage.loadSession(sessionId);
  });

  // 分页加载会话消息（滚动分页）
  ipcMain.handle('chat:load-session-messages', async (_event, sessionId, offset, limit) => {
    return chatStorage.loadSessionMessages(sessionId, offset, limit);
  });

  // 获取最近会话列表
  ipcMain.handle('chat:list-sessions', async (_event, limit) => {
    return chatStorage.listRecentSessions(limit);
  });

  // 删除会话
  ipcMain.handle('chat:delete-session', async (_event, sessionId) => {
    return chatStorage.deleteSession(sessionId);
  });

  // 保存总结
  ipcMain.handle('chat:save-summary', async (_event, sessionId, summary, knowledgeItems) => {
    return chatStorage.saveSummary(sessionId, summary, knowledgeItems);
  });

  // 获取知识库
  ipcMain.handle('chat:get-knowledge', async () => {
    return chatStorage.getKnowledgeBase();
  });

  // 获取会话统计
  ipcMain.handle('chat:session-stats', async (_event, sessionId) => {
    return chatStorage.getSessionStats(sessionId);
  });

  // === IM 渠道消息监听 ===

  // 开始监听 IM 渠道消息（飞书、钉钉等）
  ipcMain.on('chat:im-watch-start', () => {
    Logger.info('IPC: chat:im-watch-start');
    imMonitor.start((msg) => {
      sendToRenderer('chat:im-message', msg);
    });
  });

  // 停止监听 IM 渠道消息
  ipcMain.on('chat:im-watch-stop', () => {
    Logger.info('IPC: chat:im-watch-stop');
    imMonitor.stop();
  });
}

module.exports = { registerAllHandlers };
