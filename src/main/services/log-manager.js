const fs = require('fs');
const path = require('path');
const { OPENCLAW_HOME, LOGS_DIR } = require('../utils/paths');
const Logger = require('../utils/logger');

let chokidar = null;
function getChokidar() {
  if (!chokidar) {
    chokidar = require('chokidar');
  }
  return chokidar;
}

class LogManager {
  constructor() {
    this._watcher = null;
    this._lastSize = 0;
    this._currentFile = null;
  }

  _getLogPath(logType) {
    const knownLogs = {
      'app': path.join(OPENCLAW_HOME, 'app.log'),
      'gateway': path.join(OPENCLAW_HOME, 'gateway.log'),
      'installer': path.join(OPENCLAW_HOME, 'installer-manager.log')
    };
    return knownLogs[logType] || path.join(OPENCLAW_HOME, logType);
  }

  /**
   * 获取日志文件的描述信息
   */
  _getLogDescription(logType) {
    const descriptions = {
      'app': 'OpenClaw 应用日志（需要 OpenClaw 运行时才会生成）',
      'gateway': 'Gateway 服务日志（需要 Gateway 服务运行时才会生成）',
      'installer': '安装管理器日志'
    };
    return descriptions[logType] || '';
  }

  async read(logType, lines = 200) {
    const logPath = this._getLogPath(logType);
    try {
      if (!fs.existsSync(logPath)) {
        // 返回空数组，前端会显示提示信息
        return [];
      }
      const content = fs.readFileSync(logPath, 'utf-8');
      const allLines = content.split(/\r?\n/).filter(l => l.trim());
      return allLines.slice(-lines);
    } catch (err) {
      Logger.error('Failed to read log: ' + err.message);
      return [];
    }
  }

  /**
   * 获取日志文件信息（用于前端显示）
   */
  async getLogInfo(logType) {
    const logPath = this._getLogPath(logType);
    const exists = fs.existsSync(logPath);
    const description = this._getLogDescription(logType);
    
    let size = 0;
    let modified = null;
    
    if (exists) {
      try {
        const stats = fs.statSync(logPath);
        size = stats.size;
        modified = stats.mtime;
      } catch {}
    }
    
    return {
      type: logType,
      path: logPath,
      exists,
      description,
      size,
      modified
    };
  }

  startWatch(logType, onLine) {
    this.stopWatch();

    const logPath = this._getLogPath(logType);
    this._currentFile = logPath;

    try {
      if (fs.existsSync(logPath)) {
        const stats = fs.statSync(logPath);
        this._lastSize = stats.size;
      } else {
        this._lastSize = 0;
      }

      const ch = getChokidar();
      this._watcher = ch.watch(logPath, {
        persistent: true,
        usePolling: true,
        interval: 1000
      });

      this._watcher.on('change', () => {
        try {
          const stats = fs.statSync(logPath);
          if (stats.size > this._lastSize) {
            const fd = fs.openSync(logPath, 'r');
            const buffer = Buffer.alloc(stats.size - this._lastSize);
            fs.readSync(fd, buffer, 0, buffer.length, this._lastSize);
            fs.closeSync(fd);

            const newContent = buffer.toString('utf-8');
            const newLines = newContent.split(/\r?\n/).filter(l => l.trim());
            for (const line of newLines) {
              onLine(line);
            }
          }
          this._lastSize = stats.size;
        } catch (err) {
          Logger.warn('Log watch error: ' + err.message);
        }
      });
    } catch (err) {
      Logger.error('Failed to start log watch: ' + err.message);
    }
  }

  stopWatch() {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
    this._currentFile = null;
    this._lastSize = 0;
  }

  getAvailableLogs() {
    const logs = [];
    const possibleLogs = ['app.log', 'gateway.log', 'installer-manager.log'];
    for (const name of possibleLogs) {
      const logPath = path.join(OPENCLAW_HOME, name);
      if (fs.existsSync(logPath)) {
        logs.push({ name: name.replace('.log', ''), path: logPath });
      }
    }

    // Also check logs directory
    if (fs.existsSync(LOGS_DIR)) {
      try {
        const files = fs.readdirSync(LOGS_DIR);
        for (const file of files) {
          if (file.endsWith('.log')) {
            logs.push({ name: file.replace('.log', ''), path: path.join(LOGS_DIR, file) });
          }
        }
      } catch {}
    }

    return logs;
  }
}

module.exports = LogManager;
