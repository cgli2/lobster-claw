const fs = require('fs');
const path = require('path');
const ShellExecutor = require('../utils/shell-executor');
const { OPENCLAW_HOME, CONFIG_PATH, getPathsForMode } = require('../utils/paths');
const Logger = require('../utils/logger');
const { network, features } = require('../config/defaults');

class OnboardConfigWriter {
  /**
   * Convert GUI form data to openclaw.json config structure
   * 按照官方文档: https://docs.openclaw.ai/zh-CN/providers
   */
  buildConfigJson(formData) {
    const config = {};

    // AI provider / API key configuration
    if (formData.provider && (formData.apiKey || formData.provider === 'ollama' || formData.oauth)) {
      const envVars = {};
      const providers = {};

      switch (formData.provider) {
        case 'moonshot':
          // 官方文档: https://docs.openclaw.ai/zh-CN/providers/moonshot
          envVars.MOONSHOT_API_KEY = formData.apiKey;
          providers.moonshot = {
            baseUrl: formData.baseUrl || 'https://api.moonshot.cn/v1',
            apiKey: '${MOONSHOT_API_KEY}',
            api: 'openai-completions',
            models: [
              {
                id: 'kimi-k2.5',
                name: 'Kimi K2.5',
                reasoning: false,
                input: ['text'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 256000,
                maxTokens: 8192
              }
            ]
          };
          break;
        case 'kimi-coding':
          // 官方文档: https://docs.openclaw.ai/zh-CN/providers/moonshot
          envVars.KIMI_API_KEY = formData.apiKey;
          providers['kimi-coding'] = {
            baseUrl: formData.baseUrl || 'https://api.kimi.com/coding',
            apiKey: '${KIMI_API_KEY}',
            api: 'anthropic-messages',
            models: [
              {
                id: 'k2p5',
                name: 'Kimi for Coding',
                reasoning: true,
                input: ['text', 'image'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 262144,
                maxTokens: 32768
              }
            ]
          };
          break;
        case 'qwen':
          // 官方文档: https://docs.openclaw.ai/zh-CN/providers/qwen
          // Qwen 使用阿里百炼平台 API Key
          envVars.DASHSCOPE_API_KEY = formData.apiKey;
          providers.qwen = {
            baseUrl: formData.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            apiKey: '${DASHSCOPE_API_KEY}',
            api: 'openai-completions',
            models: [
              {
                id: 'qwen-plus',
                name: 'Qwen Plus',
                reasoning: false,
                input: ['text'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128000,
                maxTokens: 8192
              },
              {
                id: 'qwen-max',
                name: 'Qwen Max',
                reasoning: false,
                input: ['text'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128000,
                maxTokens: 8192
              },
              {
                id: 'qwen-coder-plus',
                name: 'Qwen Coder Plus',
                reasoning: false,
                input: ['text'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128000,
                maxTokens: 8192
              }
            ]
          };
          break;

        case 'qwen-oauth':
          // 安装向导专用：Qwen OAuth 登录（不需要 API Key）
          providers['qwen-portal'] = {
            baseUrl: formData.baseUrl || 'https://portal.qwen.ai/v1',
            api: 'openai-completions',
            models: [
              {
                id: 'qwen-portal/coder-model',
                name: 'Qwen Portal Coder',
                reasoning: false,
                input: ['text'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128000,
                maxTokens: 8192
              },
              {
                id: 'qwen-portal/vision-model',
                name: 'Qwen Portal Vision',
                reasoning: false,
                input: ['text', 'image'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128000,
                maxTokens: 8192
              }
            ]
          };
          break;
        case 'deepseek':
          envVars.DEEPSEEK_API_KEY = formData.apiKey;
          providers.deepseek = {
            baseUrl: formData.baseUrl || 'https://api.deepseek.com',
            apiKey: '${DEEPSEEK_API_KEY}',
            api: 'openai-completions',
            models: [
              {
                id: 'deepseek-chat',
                name: 'DeepSeek Chat',
                reasoning: false,
                input: ['text'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128000,
                maxTokens: 8192
              }
            ]
          };
          break;
        case 'minimax':
          // 官方文档: https://docs.openclaw.ai/zh-CN/providers/minimax
          envVars.MINIMAX_API_KEY = formData.apiKey;
          providers.minimax = {
            baseUrl: formData.baseUrl || 'https://api.minimax.io/anthropic',
            apiKey: '${MINIMAX_API_KEY}',
            api: 'anthropic-messages',
            models: [
              {
                id: 'MiniMax-M2.1',
                name: 'MiniMax M2.1',
                reasoning: false,
                input: ['text'],
                cost: { input: 15, output: 60, cacheRead: 2, cacheWrite: 10 },
                contextWindow: 200000,
                maxTokens: 8192
              }
            ]
          };
          break;
        case 'glm':
          // 官方文档: https://docs.openclaw.ai/zh-CN/providers/glm
          // GLM 通过 Z.AI 平台访问
          envVars.ZAI_API_KEY = formData.apiKey;
          providers.zai = {
            baseUrl: formData.baseUrl || 'https://open.bigmodel.cn/api/paas/v4/',
            apiKey: '${ZAI_API_KEY}',
            api: 'openai-completions',
            models: [
              {
                id: 'glm-4.7',
                name: 'GLM 4.7',
                reasoning: false,
                input: ['text'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128000,
                maxTokens: 8192
              }
            ]
          };
          break;
        case 'openai':
          envVars.OPENAI_API_KEY = formData.apiKey;
          providers.openai = {
            baseUrl: formData.baseUrl || 'https://api.openai.com/v1',
            apiKey: '${OPENAI_API_KEY}',
            api: 'openai-completions',
            models: [
              {
                id: 'gpt-4o',
                name: 'GPT-4o',
                reasoning: false,
                input: ['text', 'image'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128000,
                maxTokens: 8192
              }
            ]
          };
          break;
        case 'ollama':
          // Ollama runs locally; API key is optional
          providers.ollama = {
            baseUrl: formData.baseUrl || 'http://localhost:11434/v1',
            apiKey: 'ollama',
            api: 'openai-completions',
            models: []
          };
          break;
        default:
          // Custom provider
          if (formData.providerName) {
            const upperName = formData.providerName.toUpperCase();
            envVars[`${upperName}_API_KEY`] = formData.apiKey;
            providers[formData.providerName] = {
              baseUrl: formData.baseUrl || '',
              apiKey: `\${${upperName}_API_KEY}`,
              api: 'openai-completions',
              models: []
            };
          }
      }

      if (Object.keys(envVars).length > 0) {
        config.env = { vars: envVars };
      }
      if (Object.keys(providers).length > 0) {
        config.models = config.models || {};
        config.models.mode = 'merge';
        config.models.providers = providers;
      }
    }

    // Default model - 使用官方文档格式 "providerId/modelName"
    // 例如 "qwen/qwen3.5-plus", "deepseek/deepseek-chat"
    if (formData.model && formData.provider) {
      config.agents = config.agents || {};
      config.agents.defaults = config.agents.defaults || {};
      
      // 确保模型标识符格式正确
      let modelIdentifier = formData.model;
      
      // 如果模型名不包含斜杠，添加 providerId 前缀
      if (!modelIdentifier.includes('/')) {
        // 获取正确的 providerId
        const providerIdMap = {
          'moonshot': 'moonshot',
          'kimi-coding': 'kimi-coding',
          'qwen': 'qwen',
          'qwen-oauth': 'qwen-portal',
          'deepseek': 'deepseek',
          'minimax': 'minimax',
          'glm': 'zai',
          'openai': 'openai',
          'ollama': 'ollama'
        };
        const providerId = providerIdMap[formData.provider] || formData.provider;
        modelIdentifier = `${providerId}/${formData.model}`;
      }
      
      config.agents.defaults.model = { primary: modelIdentifier };
    }

    // Gateway configuration
    // 合法字段（来自 `openclaw config get gateway` 实测）：
    //   mode, port, bind, controlUi, auth.mode, auth.token
    // 不合法字段：authToken（顶层，会报 "Unrecognized key: authToken"）
    //
    // 认证结构：
    //   "auth": { "mode": "token", "token": "<uuid>" }
    if (formData.gateway) {
      config.gateway = {
        mode: 'local'  // Required by OpenClaw — without this, gateway start is blocked
      };
      if (formData.gateway.port) {
        config.gateway.port = parseInt(formData.gateway.port, 10) || network.gatewayPort;
      }
      if (formData.gateway.bind) {
        config.gateway.bind = formData.gateway.bind;
      }
      // authToken → gateway.auth.{mode, token}（正确的配置文件结构）
      if (formData.gateway.authToken) {
        config.gateway.auth = {
          mode: 'token',
          token: formData.gateway.authToken
        };
      }
    } else {
      // Even if user didn't touch gateway settings, set the required mode
      config.gateway = { mode: 'local' };
    }

    // Configure gateway control UI to allow all origins (for management app access)
    config.gateway.controlUi = {
      allowedOrigins: ['*']
    };

    // Default models for agents
    if (formData.defaults) {
      config.agents = config.agents || {};
      if (formData.defaults.codingModel) {
        config.agents.codingModel = formData.defaults.codingModel;
      }
      if (formData.defaults.chatModel) {
        config.agents.chatModel = formData.defaults.chatModel;
      }
    }

    // Advanced options
    if (formData.advanced) {
      // workspace 不是顶层合法字段（会报 "<root>: Unrecognized key: workspace"）
      // 正确路径是 agents.defaults.workspace
      if (formData.advanced.workspacePath) {
        config.agents = config.agents || {};
        config.agents.defaults = config.agents.defaults || {};
        config.agents.defaults.workspace = formData.advanced.workspacePath;
      }
    }

    return config;
  }

  /**
   * Ensure the OpenClaw config directory exists
   */
  async createConfigDir() {
    const mode = ShellExecutor.getExecutionMode();

    if (mode === 'wsl') {
      const paths = getPathsForMode('wsl');
      await ShellExecutor.runCommand('mkdir', ['-p', paths.OPENCLAW_HOME]);
    } else {
      if (!fs.existsSync(OPENCLAW_HOME)) {
        fs.mkdirSync(OPENCLAW_HOME, { recursive: true });
      }
    }
  }

  /**
   * Write config to openclaw.json
   */
  async writeConfig(configData) {
    const mode = ShellExecutor.getExecutionMode();
    const jsonStr = JSON.stringify(configData, null, 2);

    try {
      await this.createConfigDir();

      if (mode === 'wsl') {
        const paths = getPathsForMode('wsl');
        // Write via WSL command — escape JSON for shell
        const escaped = jsonStr.replace(/'/g, "'\\''");
        await ShellExecutor.runCommand('bash', ['-c', `echo '${escaped}' > ${paths.CONFIG_PATH}`]);
      } else {
        // Backup existing config
        if (fs.existsSync(CONFIG_PATH)) {
          const backupPath = CONFIG_PATH + '.bak';
          fs.copyFileSync(CONFIG_PATH, backupPath);
        }
        fs.writeFileSync(CONFIG_PATH, jsonStr, 'utf-8');
      }

      Logger.info('Onboard config written to ' + CONFIG_PATH);
      return { success: true };
    } catch (err) {
      Logger.error('Failed to write onboard config: ' + err.message);
      throw new Error('写入配置文件失败: ' + err.message);
    }
  }

  /**
   * Write .env file for API keys (environment variables)
   */
  async writeEnvFile(envVars) {
    if (!envVars || Object.keys(envVars).length === 0) return;

    const mode = ShellExecutor.getExecutionMode();
    const lines = Object.entries(envVars).map(([k, v]) => `${k}=${v}`).join('\n');

    try {
      if (mode === 'wsl') {
        const paths = getPathsForMode('wsl');
        const escaped = lines.replace(/'/g, "'\\''");
        await ShellExecutor.runCommand('bash', ['-c', `echo '${escaped}' > ${paths.ENV_PATH}`]);
      } else {
        const envPath = path.join(OPENCLAW_HOME, '.env');
        // Merge with existing .env if present
        let existing = {};
        if (fs.existsSync(envPath)) {
          const content = fs.readFileSync(envPath, 'utf-8');
          for (const line of content.split(/\r?\n/)) {
            const match = line.match(/^([^#=]+)=(.*)$/);
            if (match) existing[match[1].trim()] = match[2].trim();
          }
        }
        Object.assign(existing, envVars);
        const merged = Object.entries(existing).map(([k, v]) => `${k}=${v}`).join('\n');
        fs.writeFileSync(envPath, merged + '\n', 'utf-8');
      }
    } catch (err) {
      Logger.error('Failed to write .env: ' + err.message);
    }
  }

  /**
   * Write auth-profiles.json for OpenClaw agent authentication
   */
  async writeAuthProfiles(formData, agentId = 'main') {
    if (!formData.apiKey || !formData.provider) return;

    const providerId = formData.provider === 'custom' ? (formData.providerName || 'custom').toLowerCase() : formData.provider;
    const authProfilesPath = path.join(OPENCLAW_HOME, 'agents', agentId, 'agent', 'auth-profiles.json');

    try {
      // Ensure directory exists
      const dir = path.dirname(authProfilesPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Read existing profiles or create new
      let profiles = { version: 1, profiles: {} };
      if (fs.existsSync(authProfilesPath)) {
        try {
          const content = fs.readFileSync(authProfilesPath, 'utf-8');
          profiles = JSON.parse(content);
        } catch (err) {
          Logger.warn('Failed to parse existing auth-profiles.json, creating new one');
        }
      }

      // Update the provider's API key
      profiles.profiles[providerId] = {
        ...(profiles.profiles[providerId] || {}),
        apiKey: formData.apiKey
      };

      // Backup existing file if present
      if (fs.existsSync(authProfilesPath)) {
        fs.copyFileSync(authProfilesPath, authProfilesPath + '.bak');
      }

      // Write the file
      fs.writeFileSync(authProfilesPath, JSON.stringify(profiles, null, 2), 'utf-8');
      Logger.info(`Auth profiles written for provider ${providerId} to ${authProfilesPath}`);
    } catch (err) {
      Logger.error('Failed to write auth-profiles.json: ' + err.message);
    }
  }

  /**
   * Full onboard write: build config, write files, run doctor --fix
   */
  async writeOnboard(formData) {
    const config = this.buildConfigJson(formData);

    // Extract env vars for .env file (API keys)
    const envVars = config.env?.vars || {};
    if (Object.keys(envVars).length > 0) {
      await this.writeEnvFile(envVars);
    }

    // Write the main config
    await this.writeConfig(config);

    // 写完配置后执行 openclaw doctor --fix，自动修正配置文件中的已知问题
    // （例如旧版本遗留的非法字段、目录缺失等）
    // 失败不阻断流程，只记录日志
    try {
      Logger.info('Running openclaw doctor --fix to validate and repair config...');
      const ServiceController = require('./service-controller');
      const svc = new ServiceController();
      const openclawCmd = svc._getOpenclawCmd();
      if (openclawCmd) {
        const { execSync } = require('child_process');
        const output = execSync(`"${openclawCmd}" doctor --fix`, {
          timeout: 30000,
          windowsHide: true,
          encoding: 'utf8'
        });
        Logger.info('openclaw doctor --fix output: ' + output.substring(0, 500));
      }
    } catch (e) {
      Logger.warn('openclaw doctor --fix failed (non-blocking): ' + e.message.substring(0, 200));
    }

    return { success: true, config };
  }

  /**
   * Start the OpenClaw gateway process (replaces schtasks-based install)
   */
  async installDaemon(onProgress) {
    onProgress({ step: 'start', message: '启动 Gateway 服务...', percent: 10 });

    try {
      const ServiceController = require('./service-controller');
      const svc = new ServiceController();
      const result = await svc.start();

      if (result.success) {
        onProgress({ step: 'done', message: result.output, percent: 100 });
      } else {
        throw new Error(result.output);
      }
    } catch (err) {
      Logger.error('Gateway start failed: ' + err.message);
      throw new Error('Gateway 启动失败: ' + err.message);
    }
  }
}

module.exports = OnboardConfigWriter;
