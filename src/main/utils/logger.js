const fs = require('fs');
const path = require('path');
const { OPENCLAW_HOME } = require('./paths');

const LOG_FILE = path.join(OPENCLAW_HOME, 'installer-manager.log');

class Logger {
  static _ensureDir() {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  static _formatTimestamp(date = new Date()) {
    // Format: YYYY-MM-DD HH:mm:ss (本地时间)
    const pad = (n) => String(n).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  /**
   * 清理消息中的非打印字符和控制字符
   * 同时尝试修复常见的编码问题
   */
  static _cleanMessage(message) {
    if (typeof message !== 'string') {
      message = String(message);
    }
    
    // 移除 ANSI 转义序列（颜色代码等）
    message = message.replace(/\x1b\[[0-9;]*m/g, '');
    
    // 移除其他控制字符（保留换行和制表符）
    message = message.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    
    return message;
  }

  static _write(level, message) {
    try {
      Logger._ensureDir();
      const timestamp = Logger._formatTimestamp();
      const cleanMessage = Logger._cleanMessage(message);
      const line = `[${timestamp}] [${level}] ${cleanMessage}\n`;
      fs.appendFileSync(LOG_FILE, line, 'utf-8');
    } catch {
      // Silently fail if we can't write logs
    }
  }

  static info(message) {
    Logger._write('INFO', message);
  }

  static warn(message) {
    Logger._write('WARN', message);
  }

  static error(message) {
    Logger._write('ERROR', message);
  }

  static debug(message) {
    Logger._write('DEBUG', message);
  }
}

module.exports = Logger;
