const path = require('path');
const os = require('os');
const fs = require('fs');

const homeDir = os.homedir();

// Windows native paths
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(homeDir, '.openclaw');
const CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || path.join(OPENCLAW_HOME, 'openclaw.json');
const ENV_PATH = path.join(OPENCLAW_HOME, '.env');
const PROFILES_DIR = path.join(OPENCLAW_HOME, 'config-backups');
const LOGS_DIR = path.join(OPENCLAW_HOME, 'logs');

/**
 * 获取 openclaw 的 npm global prefix（安装根目录）。
 *
 * 优先级（从高到低）：
 *   1. 当前进程环境变量 OPENCLAW_NPM_PREFIX（安装时写入后即可生效）
 *   2. ~/.openclaw/.env 文件中的 OPENCLAW_NPM_PREFIX 条目
 *   3. 默认值 ~/.npm-global
 *
 * 注意：此函数是同步的，供路径常量初始化和其他同步上下文使用。
 *
 * @returns {string}
 */
function getNpmPrefix() {
  // 1. 进程环境变量最优先（安装阶段 inject 后立即可用）
  if (process.env.OPENCLAW_NPM_PREFIX) {
    return process.env.OPENCLAW_NPM_PREFIX;
  }

  // 2. 尝试从 .env 文件读取
  try {
    if (fs.existsSync(ENV_PATH)) {
      const content = fs.readFileSync(ENV_PATH, 'utf-8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.startsWith('OPENCLAW_NPM_PREFIX=')) {
          const val = trimmed.slice('OPENCLAW_NPM_PREFIX='.length).trim()
            .replace(/^["']|["']$/g, ''); // strip optional quotes
          if (val) {
            // 写回进程环境，下次调用直接走分支 1
            process.env.OPENCLAW_NPM_PREFIX = val;
            return val;
          }
        }
      }
    }
  } catch (_) {
    // 读取失败时直接回退默认值
  }

  // 3. 默认值
  return path.join(homeDir, '.npm-global');
}

/**
 * 获取 openclaw 进程日志目录。
 *
 * openclaw 使用 resolvePreferredOpenClawTmpDir() 确定日志目录，Windows 上为：
 *   %TEMP%\openclaw  （若 %TEMP%\openclaw 无法访问则退回 %TEMP%\openclaw-<uid>）
 *
 * 日志文件名格式：openclaw-YYYY-MM-DD.log（每日滚动）
 *
 * @returns {string} 日志目录绝对路径
 */
function getOpenclawLogDir() {
  return path.join(os.tmpdir(), 'openclaw');
}

/**
 * 返回指定日期的 openclaw 滚动日志文件路径。
 * @param {Date} [date=new Date()] 日期（默认今天）
 * @returns {string}
 */
function getOpenclawLogFileForDate(date) {
  const d = date || new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return path.join(getOpenclawLogDir(), `openclaw-${yyyy}-${mm}-${dd}.log`);
}

// WSL Linux paths (used when executing commands inside WSL)
function getWslPaths() {
  return {
    OPENCLAW_HOME: '$HOME/.openclaw',
    CONFIG_PATH: '$HOME/.openclaw/openclaw.json',
    ENV_PATH: '$HOME/.openclaw/.env',
    LOGS_DIR: '$HOME/.openclaw/logs'
  };
}

// Convert a WSL Linux path to a Windows-accessible \\wsl$\ path
function getWslWindowsPath(wslPath) {
  // Replace $HOME with actual WSL home via \\wsl$\<distro>\home\<user>
  // This is a best-effort conversion for reading files from Windows side
  return `\\\\wsl$\\Ubuntu${wslPath.replace('$HOME', '/home/' + os.userInfo().username)}`;
}

// Return the correct path set based on execution mode
function getPathsForMode(mode) {
  if (mode === 'wsl') {
    return getWslPaths();
  }
  return { OPENCLAW_HOME, CONFIG_PATH, ENV_PATH, PROFILES_DIR, LOGS_DIR };
}

module.exports = {
  homeDir,
  OPENCLAW_HOME,
  CONFIG_PATH,
  ENV_PATH,
  PROFILES_DIR,
  LOGS_DIR,
  getNpmPrefix,
  getOpenclawLogDir,
  getOpenclawLogFileForDate,
  getWslPaths,
  getWslWindowsPath,
  getPathsForMode
};

