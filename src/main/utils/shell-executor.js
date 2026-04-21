const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Logger = require('./logger');
const { getNpmPrefix } = require('./paths');

// Windows 下的默认代码页
const WIN_CODEPAGE = 'cp936'; // GBK

/**
 * 获取 cmd.exe 的完整路径。
 *
 * 问题根源：在 Electron 打包后的应用里，spawn 的 shell 选项传字符串 'cmd.exe'
 * 时，Node.js 会尝试在 PATH 里查找 cmd.exe，但打包环境下 PATH 可能不完整，
 * 导致 ENOENT。
 *
 * 解决方案：优先使用 %SystemRoot%\System32\cmd.exe 的完整路径；
 * 若环境变量不可用则回退到 true（让 Node.js 自行处理）。
 */
function getCmdShell() {
  if (process.platform !== 'win32') return true;
  // %SystemRoot% 在所有 Windows 版本上都存在（通常是 C:\Windows）
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const cmdPath = path.join(systemRoot, 'System32', 'cmd.exe');
  if (fs.existsSync(cmdPath)) return cmdPath;
  // 终极回退：shell: true 让 Node.js 自动解析
  return true;
}

/**
 * 解码 Buffer，处理 Windows GBK 编码
 */
function decodeBuffer(data) {
  if (!data || data.length === 0) return '';
  
  // 尝试 UTF-8 解码
  const utf8Str = data.toString('utf8');
  
  // 检查是否有乱码特征（常见的 UTF-8 解码 GBK 数据产生的乱码模式）
  const hasMojibake = /[\ufffd]/.test(utf8Str) || 
    /[\u4e00-\u9fa5][\ufffd]/.test(utf8Str) ||
    /锟斤拷|璇枓鍒|不是内部|不是外部/.test(utf8Str);
  
  if (hasMojibake) {
    // 尝试使用 iconv-lite（如果可用）或者简单地替换乱码
    try {
      // 检查是否是中文 Windows 错误消息
      // 常见模式：'xxx' 不是内部或外部命令
      const cleaned = utf8Str
        .replace(/[\ufffd]+/g, '') // 移除替换字符
        .replace(/[^\x20-\x7E\u4e00-\u9fa5\u3000-\u303F\uFF00-\uFFEF\r\n\t]/g, '');
      return cleaned || utf8Str;
    } catch (e) {
      return utf8Str;
    }
  }
  
  return utf8Str;
}

class ShellExecutor {
  // Global execution mode: 'native' (Windows) or 'wsl'
  static _executionMode = null;
  static _configFile = path.join(os.homedir(), '.openclaw-installer', 'config.json');

  static _ensureConfigDir() {
    const dir = path.dirname(ShellExecutor._configFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  static _loadConfig() {
    try {
      if (fs.existsSync(ShellExecutor._configFile)) {
        const config = JSON.parse(fs.readFileSync(ShellExecutor._configFile, 'utf8'));
        return config.executionMode || 'native';
      }
    } catch (err) {
      console.error('Failed to load execution mode config:', err);
    }
    return 'native';
  }

  static _saveConfig(mode) {
    try {
      ShellExecutor._ensureConfigDir();
      const config = { executionMode: mode, updatedAt: new Date().toISOString() };
      fs.writeFileSync(ShellExecutor._configFile, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to save execution mode config:', err);
    }
  }

  static setExecutionMode(mode) {
    if (mode === 'native' || mode === 'wsl') {
      ShellExecutor._executionMode = mode;
      ShellExecutor._saveConfig(mode);
    }
  }

  static getExecutionMode() {
    if (!ShellExecutor._executionMode) {
      ShellExecutor._executionMode = ShellExecutor._loadConfig();
    }
    return ShellExecutor._executionMode;
  }

  /**
   * Adapt command for current execution mode.
   * In WSL mode, wraps the command with `wsl --exec bash -c` to avoid PATH issues.
   * options.forceNative = true bypasses WSL wrapping (for wsl management commands).
   */
  static _adaptCommand(cmd, args, options) {
    if (ShellExecutor._executionMode === 'wsl' && !options.forceNative) {
      // Use wsl --exec to avoid inheriting Windows PATH with spaces
      // This prevents "export: `Files/Common': not a valid identifier" errors
      const fullCmd = [cmd, ...args].join(' ');
      return { cmd: 'wsl', args: ['--exec', 'bash', '-c', fullCmd], shell: false };
    }
    // 统一处理 shell 选项：把裸字符串 'cmd.exe' 替换成完整路径
    // 这样无论调用方显式传 shell:'cmd.exe' 还是使用默认值，都能正确找到 cmd.exe
    let shell = options.shell !== undefined ? options.shell : getCmdShell();
    if (shell === 'cmd.exe') shell = getCmdShell();
    return { cmd, args, shell };
  }

  /**
   * Run a command and collect complete output
   * @param {string} cmd - Command to run
   * @param {string[]} args - Arguments
   * @param {object} options - Options (timeout, cwd, env, shell, forceNative)
   * @returns {Promise<{stdout: string, stderr: string, code: number}>}
   */
  static runCommand(cmd, args = [], options = {}) {
    return new Promise((resolve, reject) => {
      const timeout = options.timeout || 300000; // 5 min default
      const adapted = ShellExecutor._adaptCommand(cmd, args, options);

      // 为 WSL 准备环境变量，移除可能导致问题的 Windows PATH
      const env = { 
        ...process.env, 
        ...(options.env || {}),
        // 确保 WSL 使用 UTF-8 编码
        LANG: 'zh_CN.UTF-8',
        LC_ALL: 'zh_CN.UTF-8'
      };
      
      // 如果目标命令是 wsl，清除 PATH 避免空格问题
      if (adapted.cmd === 'wsl') {
        delete env.PATH;
      }

      const spawnOptions = {
        cwd: options.cwd || undefined,
        env: env,
        windowsHide: true
      };
      // Only set shell if it's not false
      if (adapted.shell) {
        spawnOptions.shell = adapted.shell;
      }

      let stdout = '';
      let stderr = '';
      let killed = false;

      const child = spawn(adapted.cmd, adapted.args, spawnOptions);

      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        reject(new Error(`命令执行超时 (${timeout / 1000}秒): ${cmd}`));
      }, timeout);

      child.stdout.on('data', (data) => {
        stdout += decodeBuffer(data);
      });

      child.stderr.on('data', (data) => {
        stderr += decodeBuffer(data);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (!killed) {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * Run a command with streaming output (line by line)
   * @param {string} cmd - Command to run
   * @param {string[]} args - Arguments
   * @param {function} onData - Callback for each line of output
   * @param {function} onError - Callback for errors
   * @param {object} options - Options
   * @returns {Promise<number>} - Exit code
   */
  static streamCommand(cmd, args = [], onData, onError, options = {}) {
    return new Promise((resolve, reject) => {
      const timeout = options.timeout || 1800000; // 30 min for install operations
      const adapted = ShellExecutor._adaptCommand(cmd, args, options);

      // 为 WSL 准备环境变量，移除可能导致问题的 Windows PATH
      const env = { 
        ...process.env, 
        ...(options.env || {}),
        // 确保 WSL 使用 UTF-8 编码
        LANG: 'zh_CN.UTF-8',
        LC_ALL: 'zh_CN.UTF-8'
      };
      
      // 如果目标命令是 wsl，清除 PATH 避免空格问题
      if (adapted.cmd === 'wsl') {
        delete env.PATH;
      }

      const spawnOptions = {
        cwd: options.cwd || undefined,
        env: env,
        windowsHide: true
      };
      // Only set shell if it's not false
      if (adapted.shell) {
        spawnOptions.shell = adapted.shell;
      }

      let killed = false;
      const child = spawn(adapted.cmd, adapted.args, spawnOptions);

      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        reject(new Error(`命令执行超时 (${timeout / 1000}秒): ${cmd}`));
      }, timeout);

      let buffer = '';
      const processBuffer = (chunk, isStderr) => {
        buffer += decodeBuffer(chunk);
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.trim()) {
            if (isStderr && onError) {
              onError(line);
            } else if (onData) {
              onData(line);
            }
          }
        }
      };

      child.stdout.on('data', (data) => processBuffer(data, false));
      child.stderr.on('data', (data) => processBuffer(data, true));

      child.on('close', (code) => {
        clearTimeout(timer);
        // Flush remaining buffer
        if (buffer.trim() && onData) {
          onData(buffer.trim());
        }
        if (!killed) {
          resolve(code);
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * Run a simple command and return stdout (convenience method)
   */
  static async getOutput(cmd, args = [], options = {}) {
    try {
      const result = await ShellExecutor.runCommand(cmd, args, {
        ...options,
        timeout: options.timeout || 30000
      });
      return result.code === 0 ? result.stdout : null;
    } catch {
      return null;
    }
  }

  /**
   * Check if a command exists
   */
  static async commandExists(cmd) {
    if (ShellExecutor._executionMode === 'wsl') {
      try {
        // WSL 模式下需要确保 PATH 包含 npm-global
        const result = await ShellExecutor.runCommand('wsl', ['--exec', 'bash', '-c', `export PATH="$HOME/.npm-global/bin:$PATH" && which ${cmd}`], {
          timeout: 10000,
          forceNative: true
        });
        return result.code === 0;
      } catch {
        return false;
      }
    }
    try {
      // Windows 原生模式：需要确保 PATH 包含所有可能的 npm 全局目录
      const userProfile = process.env.USERPROFILE || process.env.HOME || os.homedir();
      const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
      const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      const npmPrefix = getNpmPrefix(); // 用户自定义安装目录（优先）
      const env = { ...process.env };

      // 构建 PATH：包含所有可能的 npm 全局目录（使用环境变量，不包含硬编码用户路径）
      const possiblePaths = [
        npmPrefix,                                                              // 用户自定义 prefix（最优先）
        path.join(npmPrefix, 'bin'),
        path.join(userProfile, '.npm-global'),
        path.join(userProfile, '.npm-global', 'node_modules', '.bin'),
        path.join(userProfile, 'AppData', 'Roaming', 'npm'),
        path.join(userProfile, 'AppData', 'Roaming', 'npm', 'node_modules', '.bin'),
        path.join(userProfile, '.npm', 'global'),
        path.join(programFiles, 'nodejs'),
        path.join(programFilesX86, 'nodejs'),
      ];

      let newPath = [...possiblePaths];
      if (env.PATH) {
        newPath = newPath.concat(env.PATH.split(';'));
      }
      env.PATH = newPath.join(';');

      const result = await ShellExecutor.runCommand('where', [cmd], {
        shell: getCmdShell(),
        timeout: 10000,
        env
      });
      return result.code === 0;
    } catch {
      return false;
    }
  }

  /**
   * Check if OpenClaw is installed
   * 简化检测：只检查 ~/.openclaw 目录（最可靠的指标）
   */
  static async checkOpenClawInstalled() {
    // 获取用户主目录（优先使用 os.homedir()，它在 Electron 打包环境下更可靠）
    const homeDir = os.homedir();
    const configPath = path.join(homeDir, '.openclaw');

    Logger.info('========================================');
    Logger.info('checkOpenClawInstalled: START');
    Logger.info('checkOpenClawInstalled: homeDir=' + homeDir);
    Logger.info('checkOpenClawInstalled: configPath=' + configPath);

    try {
      const exists = fs.existsSync(configPath);

      if (exists) {
        try {
          const stats = fs.statSync(configPath);
          Logger.info('checkOpenClawInstalled: isDirectory=' + stats.isDirectory());
          Logger.info('checkOpenClawInstalled: mtime=' + stats.mtime.toISOString());

          // 验证这是一个有效的 OpenClaw 目录（至少包含 openclaw.json 或 node_modules）
          const files = fs.readdirSync(configPath);
          const isValid = files.length > 0 && (
            files.includes('openclaw.json') ||
            files.includes('node_modules') ||
            files.includes('agents') ||
            files.includes('logs')
          );

          Logger.info('checkOpenClawInstalled: files=' + JSON.stringify(files));
          Logger.info('checkOpenClawInstalled: isValid=' + isValid);

          Logger.info('checkOpenClawInstalled: END - returning ' + isValid);
          Logger.info('========================================');
          return isValid;
        } catch (e) {
          Logger.warn('checkOpenClawInstalled: stat/readdir failed: ' + e.message);
        }
      }

      Logger.info('checkOpenClawInstalled: END - returning false (not installed)');
      Logger.info('========================================');
      return false;
    } catch (e) {
      Logger.error('checkOpenClawInstalled: error=' + e.message);
      Logger.error('checkOpenClawInstalled: stack=' + e.stack);
      Logger.info('========================================');
      return false;
    }
  }

  /**
   * Find OpenClaw executable path
   * @returns {string|null} Path to openclaw executable or null
   */
  static async _findOpenClawExecutable() {
    const userProfile = process.env.USERPROFILE || process.env.HOME;

    // 优先使用用户在安装时自定义的 npm prefix（读取 .env 中的 OPENCLAW_NPM_PREFIX）
    const npmPrefix = getNpmPrefix();

    // 候选路径：自定义 prefix 在前，标准位置在后
    const possiblePaths = [
      // ── 用户自定义安装目录（最优先）────────────────────────────────
      path.join(npmPrefix, 'openclaw.cmd'),
      path.join(npmPrefix, 'openclaw.exe'),
      path.join(npmPrefix, 'bin', 'openclaw.cmd'),
      path.join(npmPrefix, 'bin', 'openclaw.exe'),
      // ── 标准默认位置 ─────────────────────────────────────────────
      path.join(userProfile, 'AppData', 'Roaming', 'npm', 'openclaw.cmd'),
      path.join(userProfile, 'AppData', 'Roaming', 'npm', 'openclaw.exe'),
      path.join(userProfile, '.npm-global', 'openclaw.cmd'),
      path.join(userProfile, '.npm-global', 'openclaw.exe'),
      path.join(userProfile, '.npm-global', 'bin', 'openclaw.cmd'),
      path.join(userProfile, '.npm-global', 'bin', 'openclaw.exe'),
      path.join(userProfile, '.npm', 'global', 'bin', 'openclaw.cmd'),
      path.join(userProfile, '.npm', 'global', 'bin', 'openclaw.exe'),
    ];

    for (const exePath of possiblePaths) {
      if (fs.existsSync(exePath)) {
        Logger.info('_findOpenClawExecutable: found at ' + exePath);
        return exePath;
      }
    }

    Logger.warn('_findOpenClawExecutable: not found in common locations');
    return null;
  }

  /**
   * Run a command explicitly inside WSL (regardless of current mode)
   */
  static runInWsl(cmd, args = [], options = {}) {
    const fullCmd = [cmd, ...args].join(' ');
    return ShellExecutor.runCommand('wsl', ['--', 'bash', '-lc', fullCmd], {
      ...options,
      shell: getCmdShell(),
      forceNative: true
    });
  }

  /**
   * Stream a command explicitly inside WSL
   */
  static streamInWsl(cmd, args = [], onData, onError, options = {}) {
    const fullCmd = [cmd, ...args].join(' ');
    return ShellExecutor.streamCommand('wsl', ['--', 'bash', '-lc', fullCmd], onData, onError, {
      ...options,
      shell: getCmdShell(),
      forceNative: true
    });
  }
}

module.exports = ShellExecutor;
