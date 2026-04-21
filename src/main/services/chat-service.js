/**
 * ChatService - 智能对话服务
 *
 * 功能：
 * 1. 通过 OpenClaw Gateway HTTP API（/v1/chat/completions）进行真流式对话
 * 2. 支持 SSE 真流式响应（OpenAI 兼容格式）
 * 3. 管理会话历史
 *
 * 架构：
 * - 优先使用 Gateway HTTP SSE API（真流式）
 * - Gateway 不可用时自动降级到 CLI spawn + 模拟流
 */

const { spawn } = require('child_process');
const http = require('http');
const Logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { getNpmPrefix } = require('../utils/paths');
const { network, timeouts } = require('../config/defaults');

/**
 * 解码 Buffer，保留有效的 UTF-8 文本
 * 只移除无效的 UTF-8 替换字符（U+FFFD）和不可打印控制字符
 */
function decodeBuffer(data) {
  if (!data || data.length === 0) return '';
  const str = data.toString('utf8');
  // 移除无效 UTF-8 替换字符和 0x00-0x1F 范围的控制字符（保留 \r \n \t）
  return str.replace(/[\ufffd]/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/**
 * 查找 openclaw 可执行文件路径（用于 CLI fallback）
 * 优先使用用户自定义的 npm prefix（OPENCLAW_NPM_PREFIX）
 */
function findOpenclawPath() {
  const homeDir = os.homedir();
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const customPrefix = getNpmPrefix();

  const possiblePaths = [
    // 用户自定义 prefix 优先
    path.join(customPrefix, 'openclaw.cmd'),
    path.join(customPrefix, 'openclaw.exe'),
    path.join(customPrefix, 'bin', 'openclaw'),
    // 系统默认路径兜底
    path.join(homeDir, 'AppData', 'Roaming', 'npm', 'openclaw.cmd'),
    path.join(homeDir, 'AppData', 'Roaming', 'npm', 'openclaw.exe'),
    path.join(homeDir, '.npm-global', 'openclaw.cmd'),
    path.join(homeDir, '.npm', 'global', 'openclaw.cmd'),
    path.join(programFiles, 'nodejs', 'openclaw.cmd'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      Logger.info('Found openclaw at: ' + p);
      return p;
    }
  }

  return null;
}

/**
 * 查找 openclaw.mjs 模块路径（用于 CLI fallback node 直接调用）
 * 优先使用用户自定义的 npm prefix（OPENCLAW_NPM_PREFIX）
 */
function findOpenclawModulePath() {
  const homeDir = os.homedir();
  const customPrefix = getNpmPrefix();

  const possiblePaths = [
    path.join(customPrefix, 'node_modules', 'openclaw', 'openclaw.mjs'),
    path.join(homeDir, 'AppData', 'Roaming', 'npm', 'node_modules', 'openclaw', 'openclaw.mjs'),
    path.join(homeDir, '.npm-global', 'node_modules', 'openclaw', 'openclaw.mjs'),
    path.join(homeDir, '.npm', 'global', 'node_modules', 'openclaw', 'openclaw.mjs'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      Logger.info('Found openclaw.mjs at: ' + p);
      return p;
    }
  }

  // 最终兜底：用 customPrefix 路径（即使不存在也返回，让后续报错更清晰）
  return path.join(customPrefix, 'node_modules', 'openclaw', 'openclaw.mjs');
}

class ChatService {
  constructor() {
    this.openclawPath = null;
    this.sessions = new Map();
    this.defaultTimeout = timeouts.defaultTimeout; // 2 minutes（复杂任务通常不超过 2 分钟；如需更长可在 UI 配置）
    this.configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');

    // Gateway HTTP 配置（从 openclaw.json 读取）
    this.gatewayConfig = null;

    // Gateway 可用性缓存：避免每次消息都重新探测
    // { available: boolean, checkedAt: number, port: number }
    this._gatewayAvailableCache = null;
    this._gatewayCacheTtl = timeouts.gatewayCacheTtl; // 30 秒内缓存探测结果

    // Gateway 404 缓存：避免每次都探测+请求+获得404
    // { cachedAt: number }
    this._gateway404Cache = null;
    this._gateway404CacheTtl = 5 * 60 * 1000; // 404 缓存 5 分钟

    // CLI 专用超时（CLI 模式天生较慢：Node.js 冷启动 + 模型推理 + 无流式反馈）
    this.cliTimeout = timeouts.cliChatTimeout || 300000; // 5 分钟

    Logger.info('ChatService initialized');
  }

  /**
   * 读取 openclaw.json 配置
   */
  _readConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (err) {
      Logger.error('Failed to read openclaw config: ' + err.message);
    }
    return {};
  }

  /**
   * 获取 Gateway HTTP API 配置（每次从磁盘读取，避免缓存导致配置变更不生效）
   *
   * 注意：不再依赖 gateway.http.endpoints.chatCompletions.enabled 字段——
   * 该字段在标准安装的 openclaw.json 中并不存在，依赖它会导致永远走 CLI fallback。
   * 改为"始终尝试 Gateway，失败时才降级"策略。
   */
  _getGatewayConfig() {
    const config = this._readConfig();
    const port = config.gateway?.port || 18789;
    const token = config.gateway?.auth?.token || '';
    // 只要配置了 gateway 节点（或使用默认端口），就视为"可能可用"，直接发请求试探
    return { port, token, host: network.gatewayBind };
  }

  /**
   * 快速探测 Gateway 是否在监听（TCP connect，超时 1.5 秒）
   * 结果缓存 30 秒，避免每条消息都探测造成延迟。
   *
   * @returns {Promise<boolean>}
   */
  _probeGateway(host, port) {
    // 命中缓存
    if (this._gatewayAvailableCache &&
        this._gatewayAvailableCache.port === port &&
        (Date.now() - this._gatewayAvailableCache.checkedAt) < this._gatewayCacheTtl) {
      Logger.info(`Gateway probe cache hit: available=${this._gatewayAvailableCache.available}`);
      return Promise.resolve(this._gatewayAvailableCache.available);
    }

    return new Promise((resolve) => {
      const net = require('net');
      const socket = new net.Socket();
      let done = false;

      const finish = (available) => {
        if (done) return;
        done = true;
        socket.destroy();
        this._gatewayAvailableCache = { available, port, checkedAt: Date.now() };
        Logger.info(`Gateway probe ${host}:${port} → ${available ? 'UP' : 'DOWN'}`);
        resolve(available);
      };

      socket.setTimeout(timeouts.gatewayProbeTimeout); // 1.5 秒探测超时
      socket.connect(port, host, () => finish(true));
      socket.on('error', () => finish(false));
      socket.on('timeout', () => finish(false));
    });
  }

  /**
   * 使当前 Gateway 可用性缓存失效（在 Gateway 启动/停止后调用）
   */
  invalidateGatewayCache() {
    this._gatewayAvailableCache = null;
    this._gateway404Cache = null; // ★ 同时清除 404 缓存（Gateway 重启后可能支持新端点）
  }

  /**
   * 获取默认模型配置（用于 CLI fallback）
   */
  _getDefaultModel() {
    const config = this._readConfig();
    const primary = config.agents?.defaults?.model?.primary;
    if (primary) {
      const parts = primary.split('/');
      if (parts.length >= 2) {
        return { provider: parts[0], model: parts[1] };
      }
    }
    return null;
  }

  /**
   * 构建包含 API keys 的环境变量（用于 CLI fallback）
   */
  _buildEnvWithApiKeys() {
    const env = this._buildEnv();
    const homeDir = os.homedir();
    const envFilePath = path.join(homeDir, '.openclaw', '.env');

    if (fs.existsSync(envFilePath)) {
      try {
        const content = fs.readFileSync(envFilePath, 'utf-8');
        for (const line of content.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let value = trimmed.slice(eqIdx + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
              value = value.slice(1, -1);
            }
            if (key && value) env[key] = value;
          }
        }
      } catch (err) {
        Logger.warn('Failed to read .env for chat env: ' + err.message);
      }
    }

    const config = this._readConfig();
    if (config.env?.vars) {
      for (const [key, value] of Object.entries(config.env.vars)) {
        if (value && !env[key]) {
          env[key] = value;
        }
      }
    }

    return env;
  }

  /**
   * 获取 openclaw 命令路径（用于 CLI fallback）
   */
  _getOpenclawCmd() {
    if (!this.openclawPath) {
      this.openclawPath = findOpenclawPath();
    }
    return this.openclawPath || 'openclaw';
  }

  /**
   * 构建包含必要 PATH 的环境变量（用于 CLI fallback）
   */
  _buildEnv() {
    const env = { ...process.env };
    const homeDir = os.homedir();
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    const nodePaths = [
      path.join(programFiles, 'nodejs'),
      path.join(programFilesX86, 'nodejs'),
      path.join(homeDir, 'nvm4w', 'nodejs'),
      path.join(homeDir, 'nvm', 'nodejs'),
      'C:\\nodejs',
    ];

    const npmGlobalPaths = [
      getNpmPrefix(),                                        // 用户自定义 prefix 优先
      path.join(getNpmPrefix(), 'bin'),
      path.join(homeDir, 'AppData', 'Roaming', 'npm'),
      path.join(homeDir, '.npm-global'),
      path.join(homeDir, '.npm-global', 'bin'),
      path.join(homeDir, '.npm', 'global'),
    ];

    const allPaths = [...nodePaths, ...npmGlobalPaths];
    const existingPaths = (env.PATH || '').split(';').filter(p => p.trim());
    allPaths.push(...existingPaths);

    const uniquePaths = [];
    const seen = new Set();
    for (const p of allPaths) {
      const normalized = p.toLowerCase().trim();
      if (!seen.has(normalized) && normalized) {
        seen.add(normalized);
        uniquePaths.push(p.trim());
      }
    }

    env.PATH = uniquePaths.join(';');
    return env;
  }

  /**
   * 查找系统安装的 Node.js 路径（用于 CLI fallback）
   */
  _findSystemNodePath() {
    const homeDir = os.homedir();
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    const possiblePaths = [
      'D:\\programs\\nvm4w\\nodejs\\node.exe',
      path.join(homeDir, 'nvm4w', 'nodejs', 'node.exe'),
      path.join(homeDir, 'nvm', 'nodejs', 'node.exe'),
      path.join(programFiles, 'nodejs', 'node.exe'),
      path.join(programFilesX86, 'nodejs', 'node.exe'),
      'C:\\nodejs\\node.exe',
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        Logger.info('Found system Node.js at: ' + p);
        return p;
      }
    }

    return null;
  }

  // ─────────────────────────────────────────────────────────────────
  //  ★★★ 核心：Gateway HTTP SSE 真流式发送 ★★★
  // ─────────────────────────────────────────────────────────────────

  /**
   * 通过 Gateway HTTP SSE API 发送消息，获取真正的流式响应
   *
   * SSE 格式（OpenAI 兼容）：
   *   data: {"choices":[{"delta":{"content":"text"}}]}\n\n
   *   data: [DONE]\n\n
   *
   * @param {Object} options
   * @param {string} options.message
   * @param {string} [options.agent]  - agent id，默认 'main'
   * @param {Function} onStream       - (type, data) 回调
   * @returns {Promise<Object|null>}  成功返回结果对象，失败返回错误对象，Gateway 不可用时返回 null 触发 CLI 降级
   */
  async sendMessageViaGateway(options, onStream) {
    const gwCfg = this._getGatewayConfig();
    Logger.info(`Gateway config: host=${gwCfg.host}, port=${gwCfg.port}, hasToken=${!!gwCfg.token}`);
  
    // ★ 检查 404 缓存 —— 如果上次已知 Gateway 不支持该端点，直接跳过
    if (this._gateway404Cache && (Date.now() - this._gateway404Cache.cachedAt) < this._gateway404CacheTtl) {
      Logger.info('Gateway /v1/chat/completions known to return 404 (cached), skipping to CLI fallback');
      return null;
    }
  
    // ★ 先做快速 TCP 探测（1.5 秒超时，结果缓存 30 秒）
    // 避免“Gateway 未运行”时花 5 分钟等超时，也避免 CLI 冷启动带来 15+ 秒延迟
    const isUp = await this._probeGateway(gwCfg.host, gwCfg.port);
    if (!isUp) {
      Logger.warn(`Gateway not reachable at ${gwCfg.host}:${gwCfg.port}, falling back to CLI`);
      return null; // 触发 CLI 降级
    }

    const agentId = options.agent || 'main';
    const message = options.message || '';

    return new Promise((resolve) => {
      const bodyObj = {
        model: `openclaw:${agentId}`,
        stream: true,
        messages: [{ role: 'user', content: message }]
      };

      const bodyStr = JSON.stringify(bodyObj);

      const reqOptions = {
        hostname: gwCfg.host,
        port: gwCfg.port,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr)
        }
      };

      if (gwCfg.token) {
        reqOptions.headers['Authorization'] = `Bearer ${gwCfg.token}`;
      }

      Logger.info(`Sending via Gateway SSE: POST http://${gwCfg.host}:${gwCfg.port}/v1/chat/completions (agent=${agentId})`);

      let fullReply = '';
      let hasContent = false;
      let finished = false;

      const timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          req.destroy();
          if (onStream) onStream('thinking_end', '');
          resolve({
            success: false,
            error: 'Gateway request timeout',
            reply: fullReply || ''
          });
        }
      }, this.defaultTimeout);

      const req = http.request(reqOptions, (res) => {
        if (res.statusCode === 404) {
          // endpoint 未启用——返回 null 触发 CLI 降级到 --local 模式
          // --local 模式不依赖 gateway 路由，直接调用模型 API
          // 注意：不发 thinking_end，由 sendMessage 在 cli_fallback 时统一处理等待状态
          Logger.warn('Gateway /v1/chat/completions returned 404 - gateway version may be outdated, will fallback to CLI --local mode');
          this._gateway404Cache = { cachedAt: Date.now() }; // ★ 缓存 404 结果
          clearTimeout(timer);
          finished = true;
          resolve(null); // 触发 CLI fallback
          return;
        }

        if (res.statusCode !== 200) {
          let errBody = '';
          res.on('data', (c) => errBody += c.toString());
          res.on('end', () => {
            Logger.error(`Gateway HTTP error ${res.statusCode}: ${errBody.slice(0, 200)}`);
            clearTimeout(timer);
            finished = true;
            if (onStream) onStream('thinking_end', '');
            
            // 对于 401/403/5xx 等错误，也降级到 CLI --local 模式尝试
            // 因为这些可能是 Gateway 配置问题，CLI 直接调用模型 API 可能成功
            // 注意：不发 thinking_end，由 sendMessage 在 cli_fallback 时统一处理等待状态
            if (res.statusCode === 401 || res.statusCode === 403 || res.statusCode >= 500) {
              Logger.info(`Gateway HTTP ${res.statusCode} error, will fallback to CLI --local mode`);
              resolve(null); // 触发 CLI fallback
            } else {
              if (onStream) onStream('thinking_end', '');
              resolve({
                success: false,
                error: `Gateway returned HTTP ${res.statusCode}`,
                reply: ''
              });
            }
          });
          return;
        }

        // ★ 收到 200 响应头，立即通知前端"已连接，开始生成"
        // 不等 delta.role 帧，否则前端会一直卡在"连接中"
        if (onStream) onStream('thinking_end', '');

        // SSE 流式读取
        let buffer = '';

        res.on('data', (chunk) => {
          buffer += chunk.toString('utf8');

          // SSE 每条消息以 \n\n 结尾
          const lines = buffer.split('\n\n');
          buffer = lines.pop(); // 保留未完成的行

          for (const block of lines) {
            // 每个 block 可能包含多行，取 data: 行
            for (const line of block.split('\n')) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;

              const dataStr = trimmed.slice(5).trim();
              if (dataStr === '[DONE]') continue;

              try {
                const obj = JSON.parse(dataStr);
                const delta = obj.choices?.[0]?.delta;

                // delta.role 帧（角色帧）不含内容，跳过
                if (delta?.role && !delta.content) continue;

                if (delta?.content) {
                  const text = delta.content;
                  fullReply += text;
                  hasContent = true;
                  if (onStream) onStream('data', text);
                }
              } catch (e) {
                // 忽略解析失败的行
              }
            }
          }
        });

        res.on('end', () => {
          clearTimeout(timer);
          if (!finished) {
            finished = true;
            Logger.info(`Gateway SSE stream ended. Reply length: ${fullReply.length}`);
            resolve({
              success: true,
              code: 0,
              reply: fullReply || '（无响应内容）',
              payloads: fullReply ? [{ text: fullReply }] : [],
              meta: {}
            });
          }
        });

        res.on('error', (err) => {
          clearTimeout(timer);
          if (!finished) {
            finished = true;
            Logger.error('Gateway SSE stream error: ' + err.message);
            if (onStream && !hasContent) onStream('thinking_end', '');
            resolve({
              success: false,
              error: err.message,
              reply: fullReply || ''
            });
          }
        });
      });

      req.on('error', (err) => {
        clearTimeout(timer);
        if (!finished) {
          finished = true;
          Logger.warn('Gateway connection failed: ' + err.message + ' - falling back to CLI');
          resolve(null); // 触发降级
        }
      });

      req.write(bodyStr);
      req.end();
    });
  }

  // ─────────────────────────────────────────────────────────────────
  //  CLI fallback：模拟流式（当 Gateway 不可用时）
  // ─────────────────────────────────────────────────────────────────

  /**
   * 将完整文本分块推送给 onStream，模拟打字机流式效果
   */
  _simulateStream(text, onStream) {
    return new Promise((resolve) => {
      if (!text || !onStream) {
        resolve();
        return;
      }

      const rawChunks = [];
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const suffix = i < lines.length - 1 ? '\n' : '';

        if (line.length <= 60) {
          rawChunks.push(line + suffix);
        } else {
          const parts = line.match(/[^。！？，,.!?\n]{1,50}[。！？，,.!?]?/g) || [line];
          parts.forEach((part, pi) => {
            const isLast = pi === parts.length - 1;
            rawChunks.push(isLast ? part + suffix : part);
          });
        }
      }

      const chunks = rawChunks.filter(c => c.length > 0);
      if (chunks.length === 0) {
        resolve();
        return;
      }

      let idx = 0;
      const tick = () => {
        if (idx >= chunks.length) {
          resolve();
          return;
        }
        onStream('data', chunks[idx]);
        idx++;
        const delay = Math.min(50, Math.max(20, chunks[idx - 1].length * 0.6));
        setTimeout(tick, delay);
      };
      tick();
    });
  }

  /**
   * 解析 OpenClaw Agent 输出（JSON 格式）
   */
  _parseAgentOutput(stdout, onStream) {
    // ★ 诊断日志：记录输入
    Logger.debug(`_parseAgentOutput: stdout length=${stdout?.length || 0}, first 200 chars: ${stdout?.slice(0, 200)}`);
    
    const payloads = [];
    let meta = null;
    let reply = '';
    let error = null;
    let hasValidContent = false;

    // ★ 层 1：尝试直接解析整个 stdout 为单个 JSON
    try {
      const trimmed = stdout.trim();
      if (trimmed.startsWith('{')) {
        const obj = JSON.parse(trimmed);
        const result = this._extractFromParsedObject(obj, onStream);
        Logger.info(`_parseAgentOutput result (layer1-full): reply length=${result.reply?.length || 0}, error=${result.error || 'none'}`);
        return result;
      }
    } catch (e) { /* continue */ }

    // ★ 层 2：从 stdout 中提取第一个 { 到最后一个 } 的 JSON
    const firstBrace = stdout.indexOf('{');
    const lastBrace = stdout.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1 && firstBrace < lastBrace) {
      const jsonStr = stdout.substring(firstBrace, lastBrace + 1);
      try {
        const obj = JSON.parse(jsonStr);
        const result = this._extractFromParsedObject(obj, onStream);
        Logger.info(`_parseAgentOutput result (layer2-extract): reply length=${result.reply?.length || 0}, error=${result.error || 'none'}`);
        return result;
      } catch (e) {
        Logger.debug('Failed to parse extracted JSON: ' + e.message);
      }
    }

    // ★ 层 3：按行解析，跳过非 JSON 行（如 [plugins] 日志）
    const lines = stdout.split('\n').filter(line => line.trim());
    for (const line of lines) {
      const trimmed = line.trim();
      // 跳过 [plugins] 日志行和其他非 JSON 行
      if (trimmed.startsWith('[') && !trimmed.startsWith('[{')) continue;
      if (!trimmed.startsWith('{')) continue;
      try {
        const obj = JSON.parse(trimmed);
        const result = this._extractFromParsedObject(obj, onStream);
        if (result.reply || result.error) {
          Logger.info(`_parseAgentOutput result (layer3-line): reply length=${result.reply?.length || 0}, error=${result.error || 'none'}`);
          return result;
        }
      } catch (e) { /* ignore */ }
    }

    // ★ 层 4：尝试找到最后一个有效的 JSON 对象（反向遍历）
    for (let i = lines.length - 1; i >= 0; i--) {
      const trimmed = lines[i].trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        const obj = JSON.parse(trimmed);
        // 尝试从任何包含 text 字段的对象中提取
        if (obj.text && typeof obj.text === 'string' && obj.text !== 'Unknown error') {
          reply = obj.text;
          payloads.push({ text: obj.text });
          Logger.info(`_parseAgentOutput result (layer4-reverse): reply length=${reply.length}, error=none`);
          return { reply, payloads, meta, error: null };
        }
        // 尝试从嵌套结构中提取
        const deepResult = this._extractFromParsedObject(obj, onStream);
        if (deepResult.reply) {
          Logger.info(`_parseAgentOutput result (layer4-deep): reply length=${deepResult.reply.length}, error=${deepResult.error || 'none'}`);
          return deepResult;
        }
      } catch (e) { /* ignore */ }
    }

    Logger.info(`_parseAgentOutput result (fallback): reply length=0, error=none, stdout had ${lines.length} lines`);
    return { reply, payloads, meta, error };
  }

  /**
   * 从解析后的 JSON 对象中提取内容
   */
  _extractFromParsedObject(obj, onStream) {
    const payloads = [];
    let meta = null;
    let reply = '';
    let error = null;
    let hasValidContent = false;

    if (obj.result?.payloads && Array.isArray(obj.result.payloads)) {
      for (const p of obj.result.payloads) {
        payloads.push(p);
        if (p.text) {
          if (p.text === 'Unknown error') {
            error = p.text;
          } else {
            hasValidContent = true;
            if (onStream) onStream('data', p.text);
            reply += p.text;
          }
        }
      }
      if (obj.result.meta) meta = obj.result.meta;
    }

    if (obj.payloads && Array.isArray(obj.payloads)) {
      for (const p of obj.payloads) {
        payloads.push(p);
        if (p.text && (p.type === undefined || p.type === 'text')) {
          if (p.text === 'Unknown error') {
            error = p.text;
          } else {
            hasValidContent = true;
            if (onStream) onStream('data', p.text);
            reply += p.text;
          }
        }
      }
    }

    if (obj.meta) {
      meta = obj.meta;
      if (obj.stopReason === 'error') error = error || 'Agent returned error';
    }

    if (obj.type === 'text' && obj.text) {
      payloads.push(obj);
      hasValidContent = true;
      if (onStream) onStream('data', obj.text);
      reply += obj.text;
    }

    if (obj.status === 'error' || obj.summary === 'error') {
      error = error || obj.error || 'Agent execution failed';
    }

    if (!hasValidContent && error) reply = '';

    return { reply, payloads, meta, error };
  }

  /**
   * 从 session 文件中读取最后一条 assistant 消息
   * 用于 CLI stdout 为空时的后备方案
   *
   * @param {string} sessionId - session ID（如 'session-xxx'）
   * @param {string} agentId - agent ID（如 'main'）
   * @returns {{ reply: string, error: string|null }}
   */
  _readLastAssistantFromSession(sessionId, agentId) {
    try {
      // 1. 从 sessions.json 获取实际的 session 文件路径
      const sessionsJsonPath = path.join(os.homedir(), '.openclaw', 'agents', agentId, 'sessions', 'sessions.json');
      if (!fs.existsSync(sessionsJsonPath)) {
        Logger.debug(`sessions.json not found: ${sessionsJsonPath}`);
        return { reply: '', error: null };
      }

      const sessionsData = JSON.parse(fs.readFileSync(sessionsJsonPath, 'utf-8'));
      // 查找匹配的 session key（通常是 'agent:main:main' 或类似的）
      let sessionFile = null;
      for (const key of Object.keys(sessionsData)) {
        const session = sessionsData[key];
        if (session.sessionId === sessionId || key.includes(agentId)) {
          sessionFile = session.sessionFile;
          break;
        }
      }

      if (!sessionFile || !fs.existsSync(sessionFile)) {
        Logger.debug(`Session file not found for sessionId: ${sessionId}`);
        return { reply: '', error: null };
      }

      // 2. 读取 session 文件，反向查找最后一条 assistant 消息
      const content = fs.readFileSync(sessionFile, 'utf-8');
      const lines = content.trim().split('\n');

      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          // 查找 type=message 且 role=assistant 的记录
          if (obj.type === 'message' && obj.message?.role === 'assistant') {
            const content = obj.message?.content;
            if (Array.isArray(content)) {
              // 提取所有 text 类型的内容
              const textParts = content
                .filter(c => c.type === 'text' && c.text)
                .map(c => c.text);
              if (textParts.length > 0) {
                const reply = textParts.join('\n');
                Logger.info(`_readLastAssistantFromSession: found reply (${reply.length} chars) from ${path.basename(sessionFile)}`);
                return { reply, error: null };
              }
            } else if (typeof content === 'string' && content) {
              Logger.info(`_readLastAssistantFromSession: found reply (${content.length} chars) from ${path.basename(sessionFile)}`);
              return { reply: content, error: null };
            }
          }
        } catch (e) {
          // 跳过解析失败的行
        }
      }

      Logger.debug(`No assistant message found in session file: ${sessionFile}`);
      return { reply: '', error: null };
    } catch (err) {
      Logger.debug(`_readLastAssistantFromSession error: ${err.message}`);
      return { reply: '', error: null };
    }
  }

  // ─────────────────────────────────────────────────────────────────
  //  主接口：sendMessage（Gateway SSE 优先，CLI fallback）
  // ─────────────────────────────────────────────────────────────────

  /**
   * 清理指定 agent 的过期 session lock 文件
   *
   * openclaw 使用 *.jsonl.lock 文件防止并发访问 session，
   * 但如果进程异常退出（crash/kill），lock 文件不会被删除，
   * 导致后续所有 `openclaw agent` 命令超时等待 10s 后才放弃。
   *
   * 本方法在每次 CLI 调用前执行，满足以下任一条件则删除 lock 文件：
   *   1. Lock 文件中记录的 pid 对应的进程不存在（ESRCH）
   *   2. Lock 文件的创建时间超过 LOCK_MAX_AGE_MS（默认 10 分钟）
   *      —— 防止 pid 被系统复用给无关进程导致误判为"活跃"
   *
   * @param {string} agentId - agent 名称（通常为 'main'）
   */
  _cleanStaleLocks(agentId) {
    const LOCK_MAX_AGE_MS = 10 * 60 * 1000; // 10 分钟：openclaw 单次调用不会超过此时长
    const sessionsDir = path.join(os.homedir(), '.openclaw', 'agents', agentId, 'sessions');
    if (!fs.existsSync(sessionsDir)) return;

    // 读取 gateway pid（如存在），用于判断 lock 是否被 gateway 意外持有
    let gatewayPid = null;
    try {
      const gwPidFile = path.join(os.homedir(), '.openclaw', 'gateway.pid');
      if (fs.existsSync(gwPidFile)) {
        const gwPidStr = fs.readFileSync(gwPidFile, 'utf-8').trim();
        gatewayPid = parseInt(gwPidStr, 10) || null;
      }
    } catch (e) { /* ignore */ }
    let lockFiles;
    try {
      lockFiles = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.lock'));
    } catch (err) {
      Logger.warn(`Failed to read sessions dir for lock cleanup: ${err.message}`);
      return;
    }

    const now = Date.now();

    for (const lockFile of lockFiles) {
      const lockPath = path.join(sessionsDir, lockFile);
      let pid = null;
      let createdAt = null;

      try {
        const content = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
        pid = content.pid;
        createdAt = content.createdAt ? new Date(content.createdAt).getTime() : null;
      } catch (err) {
        // 读取或解析失败，视为损坏的 lock，也应删除
        Logger.warn(`Removing unreadable lock file: ${lockFile} (${err.message})`);
        try { fs.unlinkSync(lockPath); } catch (e) { /* ignore */ }
        continue;
      }

      // 判断条件1：pid 是否存活
      let pidAlive = false;
      if (pid) {
        try {
          process.kill(pid, 0); // signal 0：只探测进程，不发送信号
          pidAlive = true;
        } catch (e) {
          pidAlive = false; // ESRCH = No such process
        }
      }

      // 判断条件2：lock 是否超龄（防止 pid 被系统复用给无关进程）
      const lockAge = createdAt ? (now - createdAt) : Infinity;
      const lockExpired = lockAge > LOCK_MAX_AGE_MS;

      // 判断条件3：如果 pid 存活，进一步检查该进程的启动时间
      // 若进程启动时间 > lock 创建时间，说明 pid 已被系统复用，lock 是过期的
      let pidReuseDetected = false;
      if (pidAlive && createdAt && process.platform === 'win32') {
        try {
          const { execSync } = require('child_process');
          // wmic 返回格式: CreationDate=20260316205315.567061+480
          // 其中 +480 表示本地时区为 UTC+8（东八区），时间是本地时间
          const wmicOut = execSync(
            `wmic process where "ProcessId=${pid}" get CreationDate /format:value`,
            { timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }
          ).toString();
          // 完整匹配含时区偏移的格式: 20260316205315.567061+480
          const match = wmicOut.match(/CreationDate=(\d{14})[\d.]*([+-]\d+)/);
          if (match) {
            const d = match[1]; // 14位本地时间: YYYYMMDDHHmmss
            // new Date('...') 不含 Z 后缀时，Node.js 将其作为本地时间解析，
            // getTime() 返回的已经是 UTC 毫秒数，无需额外时区修正
            const procStartUTC = new Date(
              `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${d.slice(8,10)}:${d.slice(10,12)}:${d.slice(12,14)}`
            ).getTime();

            if (procStartUTC > createdAt + 5000) { // 留 5 秒宽容量
              pidReuseDetected = true;
              Logger.info(`Lock ${lockFile}: pid=${pid} started AFTER lock was created ` +
                `(pid_start_utc=${new Date(procStartUTC).toISOString()} > lock_created=${new Date(createdAt).toISOString()}), pid reused`);
            } else {
              Logger.debug(`Lock ${lockFile}: pid=${pid} appears legitimate ` +
                `(pid_start_utc=${new Date(procStartUTC).toISOString()}, lock_created=${new Date(createdAt).toISOString()})`);
            }
          }
        } catch (e) {
          // wmic 调用失败，忽略此检查
          Logger.debug(`wmic check failed for pid ${pid}: ${e.message}`);
        }
      }

      // 判断条件4：★ lock 被 gateway 进程持有——gateway 不应持有 session lock
      // Gateway 进程只负责路由，不直接执行 agent 任务；若 gateway 持有 session lock，
      // 说明 gateway 在启动时意外锁定了默认 session，导致所有 CLI 调用都被阻塞。
      // 检测策略：
      //   a) pid 与 gateway.pid 文件记录的一致（当前 gateway）
      //   b) Windows 下通过 wmic 检查进程命令行是否包含 'gateway'（旧 gateway 残留）
      let isGatewayLock = pidAlive && gatewayPid !== null && pid === gatewayPid;
      if (pidAlive && !isGatewayLock && process.platform === 'win32') {
        try {
          const { execSync } = require('child_process');
          const cmdLine = execSync(
            `wmic process where "ProcessId=${pid}" get CommandLine /format:value`,
            { timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }
          ).toString();
          if (cmdLine.toLowerCase().includes('gateway')) {
            isGatewayLock = true;
            Logger.info(`Lock ${lockFile}: pid=${pid} is a gateway process (cmdline contains 'gateway')`);
          }
        } catch (e) {
          Logger.debug(`wmic cmdline check failed for pid ${pid}: ${e.message}`);
        }
      }
      if (isGatewayLock) {
        Logger.warn(`Lock ${lockFile} is held by gateway pid=${pid}, which should not lock agent sessions. Removing.`);
      }

      // 综合判断：pid 不存在 OR lock 超龄 OR pid 已被系统复用 OR 被 gateway 持有 → 过期
      const isStale = !pidAlive || lockExpired || pidReuseDetected || isGatewayLock;

      if (isStale) {
        const reason = isGatewayLock
          ? `held by gateway pid=${pid} (gateway should not lock agent sessions)`
          : (!pidAlive
            ? `pid=${pid} no longer exists`
            : `lock age ${Math.round(lockAge / 1000)}s > ${LOCK_MAX_AGE_MS / 1000}s limit`);
        try {
          fs.unlinkSync(lockPath);
          Logger.info(`Removed stale lock file: ${lockFile} (${reason})`);
        } catch (err) {
          Logger.warn(`Failed to remove stale lock file ${lockFile}: ${err.message}`);
        }
      } else {
        Logger.info(`Lock file ${lockFile} held by active pid=${pid} (age ${Math.round(lockAge / 1000)}s), leaving it`);
      }
    }
  }

  /**
   * 发送消息（优先 Gateway HTTP SSE，降级到 CLI spawn）
   */
  async sendMessage(options, onStream) {
    // 1. 尝试 Gateway SSE
    const gwResult = await this.sendMessageViaGateway(options, onStream);
    if (gwResult !== null) {
      return gwResult; // Gateway 成功或明确失败
    }

    // 2. 降级到 CLI spawn（--local 模式，直接调用模型 API，不依赖 gateway 路由）
    // ★ 此时 Gateway 不可用（TCP 探测失败/404/连接错误），前端仍处于 connecting 状态
    // 立即通知前端"连接阶段结束，切换到思考阶段"，避免一直显示"正在连接..."
    // ★ 使用 --local 模式：当 Gateway 的 /v1/chat/completions 返回 404 时，
    //    非 local 的 CLI 模式会向 gateway 发路由请求也会挂起；
    //    --local 模式直接调用模型 API，不依赖 gateway，是正确的 fallback 路径
    if (onStream) onStream('cli_fallback', '');
    Logger.info('Falling back to CLI spawn (--local) for sendMessage');
    return this._sendMessageViaCli(options, onStream, true);
  }

  /**
   * 使用 --local 模式发送消息（优先 Gateway SSE，降级到 CLI local）
   */
  async sendMessageLocal(options, onStream) {
    // local 模式也先试 Gateway SSE（agent 运行路径相同）
    const gwResult = await this.sendMessageViaGateway(options, onStream);
    if (gwResult !== null) {
      return gwResult;
    }

    // 降级到 CLI --local spawn
    if (onStream) onStream('cli_fallback', '');
    Logger.info('Falling back to CLI local spawn for sendMessageLocal');
    return this._sendMessageViaCli(options, onStream, true);
  }

  /**
   * CLI spawn 实现（fallback）
   */
  async _sendMessageViaCli(options, onStream, useLocal) {
    const { message, agent, thinking } = options;
    const agentId = agent || 'main';

    // 在 spawn 前清理可能残留的过期 session lock 文件，
    // 防止因前一个进程崩溃遗留 lock 导致此次调用 10s 后超时
    this._cleanStaleLocks(agentId);

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;
      let streamedDataLength = 0;
      let jsonBuffer = ''; // ★ JSON 缓冲区：累积多次 data 事件中可能不完整的 JSON 行

      const env = this._buildEnvWithApiKeys();
      const homeDir = os.homedir();
      const openclawModulePath = findOpenclawModulePath();
      const systemNodePath = this._findSystemNodePath();

      if (!systemNodePath) {
        if (onStream) onStream('thinking_end', '');
        resolve({
          success: false,
          error: '找不到系统安装的 Node.js v22.12+，请确保已安装 Node.js 并添加到 PATH'
        });
        return;
      }

      // ★ 防止 CLI session 累积过多上下文导致模型推理超时
      // 若 session 文件 > 50KB（约 20-30 轮对话），则删除旧 session 让 agent 从零开始
      const panelSessionId = options.sessionId || `panel-main`;
      const sessionFile = path.join(os.homedir(), '.openclaw', 'agents', agentId, 'sessions', `${panelSessionId}.jsonl`);
      try {
        if (fs.existsSync(sessionFile)) {
          const stat = fs.statSync(sessionFile);
          if (stat.size > 50 * 1024) {
            Logger.warn(`CLI session file ${panelSessionId}.jsonl is ${Math.round(stat.size / 1024)}KB (> 50KB limit), removing to prevent timeout`);
            fs.unlinkSync(sessionFile);
          }
        }
      } catch (err) {
        Logger.debug(`Session file check failed: ${err.message}`);
      }

      const args = [openclawModulePath, 'agent'];
      if (useLocal) args.push('--local');
      args.push('--json', '--agent', agentId);
      if (thinking) args.push('--thinking', thinking);
      // 使用专属 session id，避免与飞书/其他渠道的 bot 竞争同一 session 锁
      // openclaw agent 支持 --session-id 来指定专属会话（不支持 --session-key）
      args.push('--session-id', panelSessionId);
      args.push('-m', message);

      // ★ 详细诊断日志
      const cliStartTime = Date.now();
      Logger.info(`CLI spawn command: ${systemNodePath} ${args.join(' ')}`);
      Logger.info(`CLI spawn cwd: ${path.dirname(openclawModulePath)}`);
      Logger.info(`CLI spawn env keys: ${Object.keys(env).filter(k => k.startsWith('OPENCLAW') || k.startsWith('QWEN') || k.startsWith('DASHSCOPE') || k === 'PATH').join(', ')}`);

      // ★ 检查 openclaw.mjs 是否存在
      if (!fs.existsSync(openclawModulePath)) {
        Logger.error(`openclaw.mjs not found at: ${openclawModulePath}`);
        if (onStream) onStream('thinking_end', '');
        resolve({
          success: false,
          error: `找不到 openclaw.mjs 模块: ${openclawModulePath}`
        });
        return;
      }

      const child = spawn(systemNodePath, args, {
        env,
        cwd: path.dirname(openclawModulePath),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // ★ 立即检查 spawn 是否成功
      if (!child || !child.pid) {
        Logger.error('Failed to spawn CLI process: child process is null or has no pid');
        if (onStream) onStream('thinking_end', '');
        resolve({
          success: false,
          error: '无法启动 CLI 进程，请检查 Node.js 安装'
        });
        return;
      }

      Logger.info(`CLI spawned successfully with pid: ${child.pid}`);

      const timer = setTimeout(() => {
        killed = true;
        child.kill();
        if (onStream) onStream('thinking_end', '');
        const timeoutMsg = `AI 助手响应超时（${Math.round(this.cliTimeout / 1000)} 秒内未收到回复）。` +
          '请检查网络连接和 API Key 配置后重试。';
        resolve({ success: false, error: timeoutMsg, stdout, stderr });
      }, this.cliTimeout);

      let firstDataReceived = false;
      child.stdout.on('data', (data) => {
        const text = decodeBuffer(data);
        // ★ 记录首次数据到达时间
        if (!firstDataReceived && text) {
          firstDataReceived = true;
          Logger.info(`CLI first stdout data at ${Date.now() - cliStartTime}ms`);
        }
        stdout += text;

        if (onStream && text) {
          // ★ 使用 jsonBuffer 累积多次到达的数据，避免不完整 JSON 行解析失败
          jsonBuffer += text;
          const lines = jsonBuffer.split('\n');
          // 保留最后一行（可能不完整）
          jsonBuffer = lines.pop() || '';
          
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) continue;
            try {
              const obj = JSON.parse(trimmed);
              // 处理 thinking
              if (obj.type === 'thinking' && obj.text) { onStream('thinking', obj.text); continue; }
              if (obj.thinking || obj.result?.thinking) {
                const thinkText = obj.thinking || obj.result?.thinking;
                if (thinkText) {
                  onStream('thinking', thinkText);
                }
              }
              if (obj.type === 'meta') {
                if (obj.stage === 'thinking_start') onStream('thinking_start', '');
                else if (obj.stage === 'thinking_end') onStream('thinking_end', '');
                continue;
              }
              // 处理 result.payloads
              if (obj.result?.payloads && Array.isArray(obj.result.payloads)) {
                for (const p of obj.result.payloads) {
                  if (p.type === 'thinking' && p.text) onStream('thinking', p.text);
                  else if (p.text && p.text !== 'Unknown error') { onStream('data', p.text); streamedDataLength += p.text.length; }
                }
              }
              // 处理顶层 payloads 格式
              if (obj.payloads && Array.isArray(obj.payloads)) {
                for (const p of obj.payloads) {
                  if (p.type === 'thinking' && p.text) onStream('thinking', p.text);
                  else if (p.text && p.text !== 'Unknown error') { onStream('data', p.text); streamedDataLength += p.text.length; }
                }
              }
            } catch (e) {
              Logger.debug(`CLI JSON parse skip: ${trimmed.slice(0, 80)}...`);
            }
          }
        }
      });

      child.stderr.on('data', (data) => {
        const text = decodeBuffer(data);
        stderr += text;
        if (onStream && text && !text.includes('ignored invalid auth') && !text.includes('[plugins]')) {
          onStream('stderr', text);
        }
      });

      // ★ exit 事件仅记录日志，不设置 processExited flag
      // Node.js 中 exit 先于 close 触发，close 是最终事件（stdio 已关闭），
      // 所有结果处理逻辑集中在 close 中执行
      child.on('exit', (code, signal) => {
        Logger.info(`CLI process exit event: code=${code}, signal=${signal}, elapsed: ${Date.now() - cliStartTime}ms`);
      });
      
      child.on('close', async (code) => {
        clearTimeout(timer);
        Logger.info(`CLI process close event: code=${code}, elapsed: ${Date.now() - cliStartTime}ms`);
        
        // ★ 处理 jsonBuffer 中残留的最后一行数据
        if (onStream && jsonBuffer.trim()) {
          const trimmed = jsonBuffer.trim();
          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
              const obj = JSON.parse(trimmed);
              // 处理 thinking
              if (obj.thinking || obj.result?.thinking) {
                const thinkText = obj.thinking || obj.result?.thinking;
                if (thinkText) {
                  onStream('thinking', thinkText);
                }
              }
              // 处理 result.payloads
              if (obj.result?.payloads && Array.isArray(obj.result.payloads)) {
                for (const p of obj.result.payloads) {
                  if (p.text && p.text !== 'Unknown error') {
                    onStream('data', p.text);
                    streamedDataLength += p.text.length;
                  }
                }
              }
              // 处理顶层 payloads 格式
              if (obj.payloads && Array.isArray(obj.payloads)) {
                for (const p of obj.payloads) {
                  if (p.text && p.text !== 'Unknown error') {
                    onStream('data', p.text);
                    streamedDataLength += p.text.length;
                  }
                }
              }
            } catch (e) {
              Logger.debug(`CLI final buffer parse skip: ${trimmed.slice(0, 80)}...`);
            }
          }
          jsonBuffer = '';
        }
        
        if (!killed) {
          let parsed = this._parseAgentOutput(stdout);
          // ★ 增强诊断日志：输出原始 stdout/stderr 前 300 字符便于排查
          Logger.info(`CLI result: success=${code === 0}, reply length=${parsed.reply?.length || 0}, error=${parsed.error || 'none'}, stdout length=${stdout.length}, streamed=${streamedDataLength}`);
          if (stdout.length > 0) Logger.debug(`CLI stdout (first 300): ${stdout.slice(0, 300)}`);
          if (stderr.length > 0) Logger.debug(`CLI stderr (first 300): ${stderr.slice(0, 300)}`);

          // ★ 后备方案：当 stdout 为空但 CLI 成功退出时，从 session 文件读取回复
          // 这处理 openclaw CLI --json 参数在某些情况下不输出到 stdout 的问题
          if (code === 0 && stdout.length === 0 && !parsed.reply) {
            const fallback = this._readLastAssistantFromSession(panelSessionId, agentId);
            if (fallback.reply) {
              parsed = { ...parsed, reply: fallback.reply };
              Logger.info(`CLI fallback: read reply from session file (${fallback.reply.length} chars)`);
            }
          }

          if (parsed.error) {
            if (onStream) onStream('thinking_end', '');
            // ★ 确保 resolve 包含 stdout 供前端兜底提取
            resolve({ success: false, error: parsed.error, stdout, stderr, reply: '', payloads: parsed.payloads, meta: parsed.meta });
          } else if (code !== 0) {
            // ★ CLI 返回非零退出码，但没有解析到错误信息
            // 尝试从 stderr 中提取错误信息
            let errorMsg = '大模型调用失败';
            if (stderr && stderr.trim()) {
              errorMsg += `: ${stderr.trim().slice(0, 200)}`;
            } else if (stdout && stdout.trim()) {
              // 如果 stdout 有内容但解析失败，可能是格式问题
              errorMsg += '（CLI 返回非零退出码，请检查模型配置和 API Key）';
            } else {
              errorMsg += '（CLI 无输出，请检查模型配置和 API Key）';
            }
            Logger.warn(`CLI exited with code ${code}, error: ${errorMsg}`);
            if (onStream) onStream('thinking_end', '');
            resolve({ success: false, error: errorMsg, stdout, stderr, reply: parsed.reply || '', payloads: parsed.payloads, meta: parsed.meta });
          } else {
            const reply = parsed.reply || '（无响应内容）';
            if (streamedDataLength === 0 && reply && reply !== '（无响应内容）' && onStream) {
              onStream('thinking_end', '');
              await this._simulateStream(reply, onStream);
            }
            // ★ 确保 resolve 包含 stdout 供前端兜底提取
            resolve({ success: true, code, stdout, stderr, reply, payloads: parsed.payloads, meta: parsed.meta });
          }
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        Logger.error(`CLI process error: ${err.message}`);
        if (!killed) {
          if (onStream) onStream('thinking_end', '');
          resolve({ success: false, error: `CLI 进程错误: ${err.message}`, stdout, stderr });
        }
      });

      // ★ 监听 spawn 错误（Node.js v22+ 中 spawn 错误可能通过 error 事件传递）
      child.on('spawn', () => {
        Logger.info(`CLI process spawned successfully, pid: ${child.pid}`);
      });
    });
  }

  /**
   * 获取可用的代理列表
   */
  async listAgents() {
    return {
      success: true,
      agents: [
        { id: 'default', name: '默认代理', description: 'OpenClaw 默认代理' }
      ]
    };
  }

  /**
   * 获取技能列表
   */
  async listSkills() {
    return new Promise((resolve) => {
      const env = this._buildEnv();
      const homeDir = os.homedir();
      const openclawModulePath = findOpenclawModulePath();
      const systemNodePath = this._findSystemNodePath();

      if (!systemNodePath) {
        resolve({ success: false, error: '找不到 Node.js', skills: [] });
        return;
      }

      const args = [openclawModulePath, 'skills', 'list', '--json'];
      const child = spawn(systemNodePath, args, {
        env,
        cwd: path.dirname(openclawModulePath),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      const timer = setTimeout(() => { child.kill(); resolve({ success: false, error: 'Timeout', skills: [] }); }, 30000);

      child.stdout.on('data', (data) => { stdout += decodeBuffer(data); });
      child.on('close', () => {
        clearTimeout(timer);
        try {
          const jsonMatch = stdout.match(/\[[\s\S]*\]/);
          if (jsonMatch) resolve({ success: true, skills: JSON.parse(jsonMatch[0]) });
          else resolve({ success: false, error: 'No skills data', skills: [] });
        } catch (e) {
          resolve({ success: false, error: e.message, skills: [] });
        }
      });
      child.on('error', (err) => { clearTimeout(timer); resolve({ success: false, error: err.message, skills: [] }); });
    });
  }

  /**
   * 清理会话
   */
  clearSession(sessionId) {
    this.sessions.delete(sessionId);
    return { success: true };
  }
}

module.exports = ChatService;
