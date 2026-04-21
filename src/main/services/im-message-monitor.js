/**
 * ImMessageMonitor - IM 渠道消息监听服务
 *
 * 功能：
 * 通过监听 openclaw 滚动日志文件，实时捕获飞书、钉钉等 IM 渠道传入的
 * 用户消息和 Agent 回复，推送给渲染进程在"智能对话"面板展示。
 *
 * openclaw 日志系统说明：
 *   - 日志格式：JSON Lines，每行为 tslog logObj 序列化后的 JSON 对象
 *   - 日志路径：%TEMP%\openclaw\openclaw-YYYY-MM-DD.log（每日滚动）
 *   - 关键字段：
 *       "_meta.subsystem"  子系统名称（如 "gateway/channels/feishu"）
 *       "0"                消息正文（无 meta 时直接是字符串；有 meta 时是 meta 对象）
 *       "1"                消息正文（有 meta 对象时）
 *       "time"             ISO 时间戳
 *
 * 推送消息格式（推送到渲染进程 'chat:im-message' 频道）：
 * {
 *   id: string,           // 唯一消息 ID
 *   channel: string,      // 渠道名称：feishu | dingtalk | wechat | slack | ...
 *   role: 'user'|'assistant',
 *   content: string,      // 消息正文
 *   sender: string,       // 发送人（用户消息才有意义）
 *   timestamp: number     // 毫秒时间戳
 * }
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const Logger = require('../utils/logger');
const { getOpenclawLogDir, getOpenclawLogFileForDate } = require('../utils/paths');

// ────────────────────────────────────────────────────────────────────────────
// 已知的 IM 渠道子系统前缀（tslog 里的 subsystem 字段）
// openclaw 的 subsystem 命名规律：<channelName> 或 gateway/channels/<channelName>
// 也可能记录在 meta.provider / meta.channel 字段里
// ────────────────────────────────────────────────────────────────────────────
const IM_CHANNEL_NAMES = new Set([
  'feishu', 'lark',
  'dingtalk', 'dingding',
  'wechat', 'weixin',
  'slack',
  'telegram',
  'discord',
  'whatsapp',
]);

/** 渠道名规范化映射 */
const CHANNEL_NORMALIZE = {
  lark: 'feishu',
  dingding: 'dingtalk',
  weixin: 'wechat',
};

function normalizeChannel(name) {
  const lower = (name || '').toLowerCase();
  return CHANNEL_NORMALIZE[lower] || lower;
}

// ────────────────────────────────────────────────────────────────────────────
// tslog logObj 字段提取工具
// tslog 以 "0", "1", "2"... 为键存放位置参数
// 调用方式 logger.info(message)           → { "0": "message" }
// 调用方式 logger.info(meta, message)     → { "0": meta, "1": "message" }
// ────────────────────────────────────────────────────────────────────────────
function getTslogArgs(obj) {
  const args = [];
  for (let i = 0; ; i++) {
    if (!(String(i) in obj)) break;
    args.push(obj[String(i)]);
  }
  return args;
}

function getTslogMessage(obj) {
  const args = getTslogArgs(obj);
  if (args.length === 0) return '';
  // 单参数：直接是字符串
  if (args.length === 1) return typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0]);
  // 多参数：最后一个通常是 message string，前面的是 meta
  const last = args[args.length - 1];
  return typeof last === 'string' ? last : JSON.stringify(last);
}

function getTslogMeta(obj) {
  const args = getTslogArgs(obj);
  if (args.length < 2) return null;
  // 第一个参数如果是对象，视为 meta
  return typeof args[0] === 'object' && args[0] !== null ? args[0] : null;
}

// ────────────────────────────────────────────────────────────────────────────

class ImMessageMonitor {
  constructor() {
    this._watcher = null;       // fs.watch 实例（当前日志文件）
    this._currentLogFile = '';  // 正在监听的日志文件路径
    this._fileOffset = 0;       // 已读字节数
    this._running = false;
    this._onMessage = null;     // (msg) => void 回调
    this._midnightTimer = null; // 每日滚动定时器
    this._watchRetryTimer = null;
  }

  /**
   * 启动监听
   * @param {Function} onMessage - 收到新消息时调用，参数为消息对象
   */
  start(onMessage) {
    if (this._running) return;
    this._running = true;
    this._onMessage = onMessage;

    this._startWatchingTodayLog();
    this._scheduleMidnightRoll();

    Logger.info('ImMessageMonitor started, watching dir: ' + getOpenclawLogDir());
  }

  /** 停止监听 */
  stop() {
    this._running = false;
    this._closeWatcher();
    if (this._midnightTimer) {
      clearTimeout(this._midnightTimer);
      this._midnightTimer = null;
    }
    if (this._watchRetryTimer) {
      clearTimeout(this._watchRetryTimer);
      this._watchRetryTimer = null;
    }
    Logger.info('ImMessageMonitor stopped');
  }

  // ─── 私有方法 ─────────────────────────────────────────────────────────────

  /** 开始监听今天的日志文件 */
  _startWatchingTodayLog() {
    const logFile = getOpenclawLogFileForDate();

    // 如果已经在监听同一文件，不重复初始化
    if (this._watcher && this._currentLogFile === logFile) return;

    this._closeWatcher();
    this._currentLogFile = logFile;

    // 初始化偏移量：跳过历史内容，只看新增
    try {
      if (fs.existsSync(logFile)) {
        this._fileOffset = fs.statSync(logFile).size;
      } else {
        this._fileOffset = 0;
      }
    } catch (_) {
      this._fileOffset = 0;
    }

    this._attachWatcher(logFile);
  }

  /** 关闭当前 watcher */
  _closeWatcher() {
    if (this._watcher) {
      try { this._watcher.close(); } catch (_) {}
      this._watcher = null;
    }
  }

  /** 挂载 fs.watch 到指定日志文件 */
  _attachWatcher(logFile) {
    if (!this._running) return;

    try {
      const watcher = fs.watch(logFile, { persistent: false }, (event) => {
        if (!this._running) return;
        if (event === 'change') {
          this._readNewContent(logFile);
        }
      });

      watcher.on('error', (err) => {
        Logger.debug(`ImMessageMonitor watcher error (${path.basename(logFile)}): ${err.message}`);
        this._closeWatcher();
        // 等待后重试
        this._watchRetryTimer = setTimeout(() => {
          if (this._running) this._attachWatcher(logFile);
        }, 5000);
      });

      this._watcher = watcher;
      Logger.debug('ImMessageMonitor watching: ' + logFile);
    } catch (_err) {
      // 文件不存在时 fs.watch 会抛，等待文件出现
      Logger.debug(`ImMessageMonitor: ${path.basename(logFile)} not found, retrying in 10s`);
      this._watchRetryTimer = setTimeout(() => {
        if (this._running) this._attachWatcher(logFile);
      }, 10000);
    }
  }

  /** 在午夜切换到新的日志文件 */
  _scheduleMidnightRoll() {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const msUntilMidnight = tomorrow.getTime() - now.getTime() + 1000; // 多 1 秒确保跨过 0 点

    this._midnightTimer = setTimeout(() => {
      if (!this._running) return;
      Logger.info('ImMessageMonitor: daily log roll');
      this._startWatchingTodayLog();
      this._scheduleMidnightRoll(); // 安排下一天
    }, msUntilMidnight);
  }

  /** 读取日志文件新增内容（增量读取） */
  _readNewContent(logFile) {
    try {
      if (!fs.existsSync(logFile)) return;

      const stat = fs.statSync(logFile);
      const prevOffset = this._fileOffset;

      if (stat.size < prevOffset) {
        // 文件被截断（日志轮转），重置偏移
        this._fileOffset = 0;
        return;
      }
      if (stat.size === prevOffset) return;

      const fd = fs.openSync(logFile, 'r');
      const newBytes = stat.size - prevOffset;
      const buf = Buffer.alloc(newBytes);
      const bytesRead = fs.readSync(fd, buf, 0, newBytes, prevOffset);
      fs.closeSync(fd);

      this._fileOffset = prevOffset + bytesRead;

      const newContent = buf.slice(0, bytesRead).toString('utf-8');
      this._parseLogContent(newContent);
    } catch (err) {
      Logger.debug('ImMessageMonitor read error: ' + err.message);
    }
  }

  /** 解析新增日志内容，逐行提取 IM 消息 */
  _parseLogContent(content) {
    const lines = content.split(/\r?\n/).filter(l => l.trim());
    for (const line of lines) {
      try {
        const msg = this._tryParseImMessage(line);
        if (msg && this._onMessage) {
          this._onMessage(msg);
        }
      } catch (_) {}
    }
  }

  /**
   * 尝试从单行日志中解析 IM 消息
   * openclaw 日志是 JSON Lines（tslog 格式），偶尔也有纯文本行。
   */
  _tryParseImMessage(line) {
    const trimmed = line.trim();

    // ── 方式 1：完整 JSON 行（tslog 格式）────────────────────────────────
    if (trimmed.startsWith('{')) {
      try {
        const obj = JSON.parse(trimmed);
        return this._extractFromTslogObj(obj);
      } catch (_) {}
    }

    // ── 方式 2：行内嵌 JSON payload（结构化文本日志的兜底）──────────────
    const jsonMatch = trimmed.match(/\{.*\}/);
    if (jsonMatch) {
      try {
        const obj = JSON.parse(jsonMatch[0]);
        const result = this._extractFromTslogObj(obj);
        if (result) return result;
      } catch (_) {}
    }

    // ── 方式 3：关键字匹配（纯文本日志最终兜底）─────────────────────────
    return this._extractFromTextLog(trimmed);
  }

  /**
   * 从 tslog logObj 中提取 IM 消息
   *
   * tslog logObj 结构：
   * {
   *   "_meta": { "subsystem": "gateway/channels/feishu", "logLevelId": 3, ... },
   *   "0": <meta 对象 or 消息字符串>,
   *   "1": <消息字符串 (仅当 "0" 是 meta 对象时)>,
   *   "time": "2026-03-16T12:00:00.000+08:00"
   * }
   */
  _extractFromTslogObj(obj) {
    if (!obj || typeof obj !== 'object') return null;

    // ── 1. 从 _meta.subsystem 提取渠道 ─────────────────────────────────
    const subsystem = (obj._meta?.subsystem || obj._meta?.name || '').toLowerCase();
    let channel = this._channelFromSubsystem(subsystem);

    // ── 2. 从 meta 参数（"0" 字段）提取渠道（如果 subsystem 找不到）───
    const metaArg = getTslogMeta(obj);
    if (!channel && metaArg) {
      channel = normalizeChannel(
        metaArg.channel || metaArg.provider || metaArg.source || ''
      ) || null;
      if (channel && !IM_CHANNEL_NAMES.has(channel)) channel = null;
    }

    // ── 2b. 宽松扫描：遍历所有字符串值寻找渠道名 ─────────────────────
    if (!channel) {
      channel = this._scanObjectForChannel(obj);
    }

    if (!channel) return null;

    // ── 3. 取消息正文 ──────────────────────────────────────────────────
    const message = getTslogMessage(obj);
    if (!message) return null;

    // ── 4. 判断方向 ────────────────────────────────────────────────────
    const direction = this._detectDirection(message, metaArg, obj);
    if (!direction) return null;

    // ── 5. 提取发送人 ──────────────────────────────────────────────────
    const sender = this._extractSender(metaArg, direction, channel);

    // ── 6. 构建消息对象 ────────────────────────────────────────────────
    const ts = obj.time ? new Date(obj.time).getTime() : Date.now();
    return {
      id: metaArg?.msgId || metaArg?.messageId || metaArg?.msg_id || String(ts + Math.random()),
      channel,
      role: direction === 'inbound' ? 'user' : 'assistant',
      content: message,
      sender,
      timestamp: isNaN(ts) ? Date.now() : ts,
    };
  }

  /**
   * 宽松模式：递归扫描对象所有字符串值，匹配 IM 渠道名
   * 深度限制为 3 层，避免扫描过深消耗性能
   */
  _scanObjectForChannel(obj, depth = 0) {
    if (depth > 3 || !obj || typeof obj !== 'object') return null;
    for (const val of Object.values(obj)) {
      if (typeof val === 'string') {
        const ch = normalizeChannel(val.trim());
        if (IM_CHANNEL_NAMES.has(ch)) return ch;
        // 检查是否包含渠道名（如 "gateway/channels/feishu" 整体作为值）
        for (const name of IM_CHANNEL_NAMES) {
          if (val.toLowerCase().includes(name)) return normalizeChannel(name);
        }
      } else if (typeof val === 'object' && val !== null) {
        const found = this._scanObjectForChannel(val, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * 从 subsystem 字符串提取渠道名
   * 常见格式：
   *   "feishu"
   *   "gateway/channels/feishu"
   *   "channels/feishu/main"
   *   "providers/feishu"
   */
  _channelFromSubsystem(subsystem) {
    if (!subsystem) return null;
    // 按 "/" 拆分，找到第一个命中 IM_CHANNEL_NAMES 的片段
    for (const part of subsystem.split('/')) {
      const ch = normalizeChannel(part);
      if (IM_CHANNEL_NAMES.has(ch)) return ch;
    }
    return null;
  }

  /**
   * 检测消息方向（inbound = 用户→agent，outbound = agent→用户）
   * 依赖消息文本关键词 + meta 字段
   */
  _detectDirection(message, meta, obj) {
    // ── 优先：meta 里显式的 direction/type 字段 ──────────────────────
    const dir = (
      meta?.direction || meta?.type || meta?.event || meta?.action ||
      obj._meta?.direction || ''
    ).toLowerCase();

    if (['inbound', 'receive', 'received', 'incoming', 'in', 'user_message'].includes(dir)) {
      return 'inbound';
    }
    if (['outbound', 'send', 'sending', 'sent', 'out', 'reply', 'replied'].includes(dir)) {
      return 'outbound';
    }

    // ── 文本关键词匹配 ────────────────────────────────────────────────
    const lower = message.toLowerCase();

    // inbound 特征
    if (
      lower.includes('received message') ||
      lower.includes('inbound message') ||
      lower.includes('incoming message') ||
      lower.includes('message received') ||
      lower.includes('user message') ||
      /^received\b/.test(lower) ||
      (meta?.userId && !meta?.reply)
    ) {
      return 'inbound';
    }

    // outbound 特征
    if (
      lower.includes('sending reply') ||
      lower.includes('sent reply') ||
      lower.includes('outbound message') ||
      lower.includes('reply sent') ||
      lower.includes('message sent') ||
      lower.includes('dispatching') ||
      meta?.reply || meta?.replyContent
    ) {
      return 'outbound';
    }

    // 无法判断方向，跳过
    return null;
  }

  /** 提取发送人信息 */
  _extractSender(meta, direction, channel) {
    if (direction === 'outbound') return 'assistant';
    if (!meta) return channel + ' 用户';

    return (
      meta.senderName ||
      meta.userName ||
      meta.name ||
      meta.sender ||
      meta.user ||
      meta.userId ||
      meta.openId ||
      meta.open_id ||
      (channel + ' 用户')
    );
  }

  /**
   * 从纯文本日志行提取消息（最终兜底）
   * 匹配格式：[feishu] Received message from xxx: "消息内容"
   */
  _extractFromTextLog(line) {
    const channelPattern = Array.from(IM_CHANNEL_NAMES).join('|');
    const inboundRe = new RegExp(
      `\\[(${channelPattern})\\].*?(?:received|incoming|inbound).*?(?:from\\s+(\\S+))?[:\\s]+"([^"]+)"`,
      'i'
    );
    const outboundRe = new RegExp(
      `\\[(${channelPattern})\\].*?(?:reply|send|outbound|response).*?"([^"]+)"`,
      'i'
    );

    let m = line.match(inboundRe);
    if (m) {
      return {
        id: String(Date.now() + Math.random()),
        channel: normalizeChannel(m[1]),
        role: 'user',
        content: m[3],
        sender: m[2] || '用户',
        timestamp: Date.now(),
      };
    }

    m = line.match(outboundRe);
    if (m) {
      return {
        id: String(Date.now() + Math.random()),
        channel: normalizeChannel(m[1]),
        role: 'assistant',
        content: m[2],
        sender: 'assistant',
        timestamp: Date.now(),
      };
    }

    return null;
  }
}

module.exports = ImMessageMonitor;
