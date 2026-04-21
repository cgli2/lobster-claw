const fs = require('fs');
const path = require('path');
const os = require('os');
const { CONFIG_PATH, getNpmPrefix } = require('../utils/paths');
const ShellExecutor = require('../utils/shell-executor');
const Logger = require('../utils/logger');

class ChannelManager {
  /**
   * 支持的渠道配置定义
   */
  static CHANNEL_DEFINITIONS = {
    feishu: {
      name: '飞书',
      icon: 'feishu',
      fields: [
        { key: 'appId', label: 'App ID', type: 'text', required: true, placeholder: 'cli_xxx' },
        { key: 'appSecret', label: 'App Secret', type: 'password', required: true, placeholder: 'xxx' },
        { key: 'pairingCode', label: '配对码', type: 'text', required: false, placeholder: '从机器人消息中获取' }
      ],
      supportsMultipleAccounts: true,
      requiresPairing: true
    },
    dingtalk: {
      name: '钉钉',
      icon: 'dingtalk',
      fields: [
        { key: 'appKey', label: 'App Key', type: 'text', required: true },
        { key: 'appSecret', label: 'App Secret', type: 'password', required: true }
      ],
      supportsMultipleAccounts: false
    },
    qq: {
      name: 'QQ',
      icon: 'qq',
      fields: [
        { key: 'appId', label: 'App ID', type: 'text', required: true },
        { key: 'token', label: 'Token', type: 'password', required: true }
      ],
      supportsMultipleAccounts: false
    },
    wechat: {
      name: '企业微信',
      icon: 'wechat',
      fields: [
        { key: 'corpId', label: 'Corp ID', type: 'text', required: true },
        { key: 'corpSecret', label: 'Corp Secret', type: 'password', required: true }
      ],
      supportsMultipleAccounts: false
    }
  };

  /**
   * 渠道对应的 openclaw 内置插件（extension）映射。
   *
   * value 说明：
   *   - pluginId   : openclaw extensions 目录下的子目录名 / `openclaw skills install` 的 ID
   *   - isBuiltin  : true = 随 openclaw 主包发布的内置 extension，通常位于
   *                  node_modules/openclaw/extensions/<pluginId>；
   *                  false = 需要单独 npm 安装的独立包
   *   - installCmd : 可选，覆盖默认安装命令（数组，传给 ShellExecutor.runCommand 的 args）
   *
   * 目前 feishu / dingtalk / wechat / qq 都是 openclaw 内置 extension，
   * 判断"是否已安装"用 _isExtensionInstalled()；
   * 未来如有独立发布的插件，把 isBuiltin 设为 false 并提供 installCmd。
   */
  static CHANNEL_PLUGIN_MAP = {
    feishu:   { pluginId: 'feishu',   isBuiltin: true },
    dingtalk: { pluginId: 'dingtalk', isBuiltin: true },
    wechat:   { pluginId: 'wechat',   isBuiltin: true },
    qq:       { pluginId: 'qq',       isBuiltin: true }
  };


  async _readConfig() {
    try {
      if (!fs.existsSync(CONFIG_PATH)) {
        return {};
      }
      const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      Logger.error('ChannelManager: failed to read config: ' + err.message);
      return {};
    }
  }

  /**
   * 写入配置文件
   */
  async _writeConfig(config) {
    try {
      const dir = path.dirname(CONFIG_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Backup current config
      if (fs.existsSync(CONFIG_PATH)) {
        fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak');
      }
      
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
      Logger.info('ChannelManager: config saved successfully');
      return { success: true };
    } catch (err) {
      Logger.error('ChannelManager: failed to write config: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * 获取所有渠道配置
   */
  async list() {
    try {
      const config = await this._readConfig();
      const channels = config.channels || {};
      
      const result = [];
      for (const [type, definition] of Object.entries(ChannelManager.CHANNEL_DEFINITIONS)) {
        const channelConfig = channels[type] || {};
        result.push({
          type,
          name: definition.name,
          icon: definition.icon,
          enabled: channelConfig.enabled === true,
          config: this._extractChannelConfig(type, channelConfig),
          fields: definition.fields,
          supportsMultipleAccounts: definition.supportsMultipleAccounts,
          requiresPairing: definition.requiresPairing || false
        });
      }
      
      return { success: true, channels: result };
    } catch (err) {
      Logger.error('ChannelManager: list error: ' + err.message);
      return { success: false, message: err.message, channels: [] };
    }
  }

  /**
   * 获取单个渠道配置
   */
  async get(channelType) {
    try {
      const config = await this._readConfig();
      const channels = config.channels || {};
      const channelConfig = channels[channelType] || {};
      const definition = ChannelManager.CHANNEL_DEFINITIONS[channelType];
      
      if (!definition) {
        return { success: false, message: '未知的渠道类型' };
      }
      
      return {
        success: true,
        channel: {
          type: channelType,
          name: definition.name,
          icon: definition.icon,
          enabled: channelConfig.enabled === true,
          config: this._extractChannelConfig(channelType, channelConfig),
          fields: definition.fields,
          supportsMultipleAccounts: definition.supportsMultipleAccounts,
          requiresPairing: definition.requiresPairing || false
        }
      };
    } catch (err) {
      Logger.error('ChannelManager: get error: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * 更新渠道配置
   */
  async update(channelType, channelData) {
    try {
      Logger.info(`ChannelManager: updating channel ${channelType}`);
      
      const config = await this._readConfig();
      if (!config.channels) {
        config.channels = {};
      }
      
      const definition = ChannelManager.CHANNEL_DEFINITIONS[channelType];
      if (!definition) {
        return { success: false, message: '未知的渠道类型' };
      }
      
      // 构建渠道配置
      const channelConfig = {
        enabled: channelData.enabled === true
      };
      
      // 根据渠道类型构建配置
      if (channelType === 'feishu') {
        // 飞书支持多账户配置
        if (channelData.config?.accounts) {
          channelConfig.accounts = channelData.config.accounts;
        } else if (channelData.config?.appId && channelData.config?.appSecret) {
          channelConfig.accounts = {
            main: {
              appId: channelData.config.appId,
              appSecret: channelData.config.appSecret
            },
            default: {
              appId: channelData.config.appId,
              appSecret: channelData.config.appSecret
            }
          };
        }
        // 保存配对码（如果有）
        if (channelData.config?.pairingCode !== undefined) {
          channelConfig.pairingCode = channelData.config.pairingCode;
        }
      } else {
        // 其他渠道直接存储字段
        for (const field of definition.fields) {
          if (channelData.config?.[field.key] !== undefined) {
            channelConfig[field.key] = channelData.config[field.key];
          }
        }
      }
      
      config.channels[channelType] = channelConfig;
      
      const result = await this._writeConfig(config);
      if (!result.success) {
        return result;
      }
      
      Logger.info(`ChannelManager: channel ${channelType} updated successfully`);
      return { success: true, message: '配置已保存' };
    } catch (err) {
      Logger.error('ChannelManager: update error: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * 设置渠道启用状态
   *
   * 当 enabled=true 时，会先通过 ensureChannelPlugin() 检测该渠道对应的
   * openclaw 插件是否已安装，未安装则自动安装后再写入启用状态。
   * 返回值中包含 pluginInstalled / pluginAlreadyInstalled 字段，供前端展示进度。
   */
  async setEnabled(channelType, enabled) {
    try {
      Logger.info(`ChannelManager: setting channel ${channelType} enabled=${enabled}`);

      // ── 启用时先确保对应插件已安装 ────────────────────────────────────────
      let pluginEnsureResult = null;
      if (enabled) {
        pluginEnsureResult = await this.ensureChannelPlugin(channelType);
        if (!pluginEnsureResult.success) {
          // 插件安装失败 → 阻止启用，返回错误
          return {
            success: false,
            message: pluginEnsureResult.message,
            pluginError: true
          };
        }
      }

      // ── 写入启用状态 ──────────────────────────────────────────────────────
      const config = await this._readConfig();
      if (!config.channels) {
        config.channels = {};
      }

      if (!config.channels[channelType]) {
        config.channels[channelType] = {};
      }

      config.channels[channelType].enabled = enabled === true;

      const result = await this._writeConfig(config);
      if (!result.success) {
        return result;
      }

      Logger.info(`ChannelManager: channel ${channelType} enabled state updated`);
      return {
        success: true,
        message: enabled ? '渠道已启用' : '渠道已禁用',
        pluginInstalled: pluginEnsureResult?.installed ?? false,
        pluginAlreadyInstalled: pluginEnsureResult?.alreadyInstalled ?? false
      };
    } catch (err) {
      Logger.error('ChannelManager: setEnabled error: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * 检测渠道对应的 openclaw 插件是否已安装，未安装则自动安装。
   *
   * 检测策略（优先级从高到低）：
   *   1. 查找 node_modules/openclaw/extensions/<pluginId> 目录（内置 extension 最可靠）
   *   2. 调用 `openclaw skills list --json`，看结果里是否包含该插件
   *
   * 安装策略：
   *   - isBuiltin=true  → 调用 `openclaw skills install <pluginId>`
   *   - isBuiltin=false → 使用 pluginInfo.installCmd 或默认安装命令
   *
   * @param {string} channelType
   * @returns {Promise<{success:boolean, alreadyInstalled:boolean, installed:boolean, message:string}>}
   */
  async ensureChannelPlugin(channelType) {
    const pluginInfo = ChannelManager.CHANNEL_PLUGIN_MAP[channelType];

    // 该渠道没有对应插件要求 → 直接通过
    if (!pluginInfo) {
      return { success: true, alreadyInstalled: true, installed: false, message: '无需插件' };
    }

    const { pluginId } = pluginInfo;
    Logger.info(`ChannelManager: ensuring plugin "${pluginId}" for channel "${channelType}"`);

    try {
      // ── Step 1: 检查是否已安装 ──────────────────────────────────────────
      const isInstalled = await this._isPluginInstalled(pluginId, pluginInfo.isBuiltin);

      if (isInstalled) {
        Logger.info(`ChannelManager: plugin "${pluginId}" already installed`);
        return { success: true, alreadyInstalled: true, installed: false, message: `插件 ${pluginId} 已安装` };
      }

      // ── Step 2: 执行安装 ─────────────────────────────────────────────────
      Logger.info(`ChannelManager: plugin "${pluginId}" not found, installing...`);
      const installResult = await this._installPlugin(pluginId, pluginInfo);

      if (!installResult.success) {
        Logger.error(`ChannelManager: failed to install plugin "${pluginId}": ${installResult.message}`);
        return {
          success: false,
          alreadyInstalled: false,
          installed: false,
          message: `插件 "${pluginId}" 安装失败：${installResult.message}\n请手动运行：openclaw skills install ${pluginId}`
        };
      }

      Logger.info(`ChannelManager: plugin "${pluginId}" installed successfully`);
      return { success: true, alreadyInstalled: false, installed: true, message: `插件 ${pluginId} 安装成功` };
    } catch (err) {
      Logger.error(`ChannelManager: ensureChannelPlugin error for "${pluginId}": ${err.message}`);
      return { success: false, alreadyInstalled: false, installed: false, message: err.message };
    }
  }

  /**
   * 判断指定插件是否已安装。
   * 对内置 extension（isBuiltin=true）直接检查文件系统；
   * 否则通过 `openclaw skills list --json` 查询。
   *
   * @param {string} pluginId
   * @param {boolean} isBuiltin
   * @returns {Promise<boolean>}
   */
  async _isPluginInstalled(pluginId, isBuiltin) {
    // 方法一：检查内置 extension 目录（快速，不依赖 CLI）
    if (isBuiltin) {
      const extPath = this._getExtensionPath(pluginId);
      if (extPath) {
        Logger.info(`ChannelManager: found extension at ${extPath}`);
        return true;
      }
    }

    // 方法二：通过 CLI 查询已安装列表（兜底）
    try {
      const result = await ShellExecutor.runCommand('openclaw', ['skills', 'list', '--json'], {
        timeout: 20000
      });

      if (result.code === 0 && result.stdout) {
        // 剥离 ANSI、提取 JSON
        const clean = result.stdout.replace(/\x1b\[[0-9;]*m/g, '');
        const jsonStart = clean.indexOf('[');
        const jsonStr = jsonStart >= 0 ? clean.slice(jsonStart) : clean;
        try {
          const skills = JSON.parse(jsonStr);
          if (Array.isArray(skills)) {
            return skills.some(s => (s.name || s.id || '') === pluginId);
          }
        } catch (_) { /* 解析失败则继续 */ }
      }
    } catch (err) {
      Logger.warn(`ChannelManager: skills list query failed: ${err.message}`);
    }

    return false;
  }

  /**
   * 查找内置 extension 的安装路径。
   * openclaw 主包安装在 npm global 的 node_modules/openclaw/ 下，
   * extensions 子目录即为各内置渠道插件所在位置。
   *
   * @param {string} pluginId
   * @returns {string|null} 目录路径，不存在时返回 null
   */
  _getExtensionPath(pluginId) {
    const homeDir = os.homedir();

    // 1. 优先检查用户自定义 npm prefix（从 .env 读取 OPENCLAW_NPM_PREFIX）
    const customPrefix = getNpmPrefix();

    // 常见 npm global prefix 候选路径（自定义在前，默认在后）
    const npmPrefixCandidates = [
      customPrefix,
      process.env.NPM_CONFIG_PREFIX,
      path.join(homeDir, 'AppData', 'Roaming', 'npm'),
      path.join(homeDir, '.npm-global'),
      path.join(homeDir, '.npm-global', 'lib'),
      // Linux / macOS
      '/usr/local',
      '/usr',
    ].filter(Boolean);

    for (const prefix of npmPrefixCandidates) {
      // Windows: <prefix>/node_modules/openclaw/extensions/<pluginId>
      // Unix:    <prefix>/lib/node_modules/openclaw/extensions/<pluginId>
      const candidates = [
        path.join(prefix, 'node_modules', 'openclaw', 'extensions', pluginId),
        path.join(prefix, 'lib', 'node_modules', 'openclaw', 'extensions', pluginId)
      ];
      for (const p of candidates) {
        try {
          if (fs.existsSync(p)) return p;
        } catch (_) { /* 无权限时跳过 */ }
      }
    }

    return null;
  }

  /**
   * 执行插件安装。
   *
   * @param {string} pluginId
   * @param {object} pluginInfo  - CHANNEL_PLUGIN_MAP 中的条目
   * @returns {Promise<{success:boolean, message:string}>}
   */
  async _installPlugin(pluginId, pluginInfo) {
    try {
      // 自定义安装命令（未来扩展用）
      if (pluginInfo.installCmd) {
        const [cmd, ...args] = pluginInfo.installCmd;
        const result = await ShellExecutor.runCommand(cmd, args, { timeout: 120000 });
        return result.code === 0
          ? { success: true, message: '安装成功' }
          : { success: false, message: result.stderr || result.stdout || '安装失败' };
      }

      // 默认：openclaw skills install <pluginId>
      const result = await ShellExecutor.runCommand('openclaw', ['skills', 'install', pluginId], {
        timeout: 120000
      });

      if (result.code === 0) {
        return { success: true, message: '安装成功' };
      }

      return { success: false, message: result.stderr || result.stdout || '安装失败' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }



  /**
   * 测试渠道连接
   *
   * 流程：
   *   1. 读取 openclaw.json，检查该渠道配置是否已完整写入
   *   2. 如果未配置（或字段不完整），且调用方传入了 channelConfig（表单当前值），
   *      则先自动调用 update() 写入配置，再执行测试
   *   3. 执行 openclaw channels status --json，解析结果返回连通性
   */
  async testConnection(channelType, channelConfig) {
    try {
      Logger.info(`ChannelManager: testing connection for ${channelType}`);

      // ── Step 1：检查 openclaw.json 中该渠道配置是否完整 ──────────────────
      const config = await this._readConfig();
      const existingChannelCfg = config.channels?.[channelType];
      const alreadyConfigured = this._isChannelConfigured(channelType, existingChannelCfg);

      // ── Step 2：如未配置，自动用表单传入的值写入配置 ──────────────────────
      let autoSaved = false;
      if (!alreadyConfigured && channelConfig && Object.keys(channelConfig).length > 0) {
        Logger.info(`ChannelManager: channel ${channelType} not configured in openclaw.json, auto-saving before test`);

        // 判断表单值里必填字段是否有值，避免写入空配置
        const definition = ChannelManager.CHANNEL_DEFINITIONS[channelType];
        const requiredFields = (definition?.fields || []).filter(f => f.required);
        const hasRequiredValues = requiredFields.every(f => channelConfig[f.key]);

        if (!hasRequiredValues) {
          const missing = requiredFields.filter(f => !channelConfig[f.key]).map(f => f.label).join('、');
          return {
            success: false,
            connected: false,
            message: `请先填写以下必填项：${missing}，然后再测试连通性`
          };
        }

        // 获取当前已有的 enabled 状态，不覆盖
        const currentEnabled = existingChannelCfg?.enabled ?? true;
        const updateResult = await this.update(channelType, {
          enabled: currentEnabled,
          config: channelConfig
        });

        if (!updateResult.success) {
          return {
            success: false,
            connected: false,
            message: `自动保存配置失败：${updateResult.message}`
          };
        }

        autoSaved = true;
        Logger.info(`ChannelManager: auto-saved config for ${channelType} before test`);
      }

      // ── Step 3：执行连通性测试 ─────────────────────────────────────────────
      const result = await ShellExecutor.runCommand('openclaw', ['channels', 'status', '--json'], {
        timeout: 30000
      });

      if (result.code !== 0) {
        return {
          success: false,
          connected: false,
          message: result.stderr || '连接测试失败'
        };
      }

      // 解析状态输出
      let statusData = {};
      try {
        const output = result.stdout.trim();
        const jsonStart = output.indexOf('{');
        const jsonOutput = jsonStart >= 0 ? output.substring(jsonStart) : output;
        statusData = JSON.parse(jsonOutput);
      } catch (e) {
        Logger.warn('ChannelManager: failed to parse status JSON: ' + e.message);
        return this._parseConnectionStatus(channelType, result.stdout);
      }

      // 查找对应渠道的状态
      const channelStatus = statusData.channels?.[channelType];
      const accountStatus = statusData.channelAccounts?.[channelType];

      if (channelStatus) {
        const isConfigured = channelStatus.configured === true;
        const isRunning = channelStatus.running === true;
        const isConnected = isConfigured && isRunning;

        let message = '状态未知';
        if (!isConfigured) {
          message = '渠道未配置';
        } else if (!isRunning) {
          message = '渠道未运行';
        } else {
          message = '连接正常';
        }

        return {
          success: true,
          connected: isConnected,
          autoSaved,
          message,
          details: {
            channel: channelStatus,
            accounts: accountStatus
          }
        };
      }

      return {
        success: true,
        connected: false,
        autoSaved,
        message: '未找到该渠道的状态信息'
      };
    } catch (err) {
      Logger.error('ChannelManager: testConnection error: ' + err.message);
      return { success: false, connected: false, message: err.message };
    }
  }

  /**
   * 验证配对码
   * @param {string} channelType - 渠道类型
   * @param {string} pairingCode - 配对码
   */
  async verifyPairingCode(channelType, pairingCode) {
    try {
      Logger.info(`ChannelManager: verifying pairing code for ${channelType}`);
      
      if (!pairingCode || !pairingCode.trim()) {
        return { success: false, message: '配对码不能为空' };
      }
      
      // 使用 openclaw pairing approve 命令验证配对码
      // 格式: openclaw pairing approve <channel> <pairingCode>
      const result = await ShellExecutor.runCommand('openclaw', ['pairing', 'approve', channelType, pairingCode.trim()], {
        timeout: 30000
      });
      
      Logger.info(`ChannelManager: approve result: code=${result.code}, stdout=${result.stdout}, stderr=${result.stderr}`);
      
      if (result.code === 0) {
        // 配对成功，保存配对码到配置
        try {
          const config = await this._readConfig();
          if (config.channels && config.channels[channelType]) {
            config.channels[channelType].pairingCode = pairingCode.trim();
            await this._writeConfig(config);
            Logger.info(`ChannelManager: pairing code saved for ${channelType}`);
          }
        } catch (saveErr) {
          Logger.warn(`ChannelManager: failed to save pairing code: ${saveErr.message}`);
        }
        
        return { 
          success: true, 
          message: '配对成功！飞书机器人现在可以正常工作了',
          verified: true
        };
      }
      
      // 检查错误信息
      const stderr = result.stderr || '';
      if (stderr.includes('not found') || stderr.includes('unknown') || stderr.includes('No pending')) {
        return { success: false, message: '配对码无效或已过期，请重新给机器人发消息获取新的配对码' };
      }
      if (stderr.includes('already')) {
        return { success: false, message: '该设备已经配对过了' };
      }
      
      return { success: false, message: result.stderr || '配对失败，请检查配对码是否正确' };
    } catch (err) {
      Logger.error('ChannelManager: verifyPairingCode error: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * 检查 openclaw.json 中该渠道的必填字段是否已完整写入
   * @param {string} channelType
   * @param {Object} channelConfig  - openclaw.json 中 channels[channelType] 的内容
   * @returns {boolean}
   */
  _isChannelConfigured(channelType, channelConfig) {
    if (!channelConfig) return false;

    const definition = ChannelManager.CHANNEL_DEFINITIONS[channelType];
    if (!definition) return false;

    if (channelType === 'feishu') {
      // 飞书：必须有 accounts.main.appId 和 accounts.main.appSecret
      const mainAccount = channelConfig.accounts?.main;
      return !!(mainAccount?.appId && mainAccount?.appSecret);
    }

    // 其他渠道：所有 required 字段均有值
    for (const field of definition.fields) {
      if (field.required && !channelConfig[field.key]) {
        return false;
      }
    }
    return true;
  }

  /**
   * 提取渠道配置
   */
  _extractChannelConfig(type, channelConfig) {
    if (!channelConfig) return {};
    
    const definition = ChannelManager.CHANNEL_DEFINITIONS[type];
    if (!definition) return {};
    
    if (type === 'feishu') {
      // 飞书特殊处理 - 支持多账户
      const accounts = channelConfig.accounts || {};
      const mainAccount = accounts.main || {};
      return {
        appId: mainAccount.appId || '',
        appSecret: mainAccount.appSecret || '',
        pairingCode: channelConfig.pairingCode || '',
        accounts: accounts
      };
    }
    
    // 其他渠道直接提取字段
    const config = {};
    for (const field of definition.fields) {
      config[field.key] = channelConfig[field.key] || '';
    }
    return config;
  }

  /**
   * 解析连接状态文本输出
   */
  _parseConnectionStatus(channelType, output) {
    const lines = output.split('\n');
    let isConnected = false;
    let message = '状态未知';
    
    for (const line of lines) {
      if (line.toLowerCase().includes(channelType.toLowerCase())) {
        if (line.includes('connected') || line.includes('healthy') || line.includes('ok')) {
          isConnected = true;
          message = '连接正常';
        } else if (line.includes('error') || line.includes('fail') || line.includes('disconnected')) {
          isConnected = false;
          message = line.trim();
        }
      }
    }
    
    return {
      success: true,
      connected: isConnected,
      message
    };
  }

  /**
   * 获取渠道定义（用于前端展示）
   */
  getChannelDefinitions() {
    return ChannelManager.CHANNEL_DEFINITIONS;
  }
}

module.exports = ChannelManager;
