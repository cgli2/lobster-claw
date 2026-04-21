/**
 * DependencyChecker - 依赖检测和安装模块
 * 
 * 核心功能：
 * 1. 检测系统已安装的依赖（Git, Node.js, npm, WSL）
 * 2. 自动下载并安装缺失的依赖
 * 
 * 设计原则：
 * - 所有检测方法返回统一格式 { installed: boolean, version: string|null, path?: string }
 * - 所有安装方法使用 onProgress 回调报告进度
 * - 详细的日志记录用于调试
 */

const { spawn } = require('child_process');
const ShellExecutor = require('../utils/shell-executor');
const WslChecker = require('./wsl-checker');
const Logger = require('../utils/logger');
const ResourceLocator = require('../utils/resource-locator');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');

/**
 * 获取 Windows System32 目录下可执行文件的完整路径。
 *
 * 问题：Electron 打包后运行时 PATH 不完整，spawn('msiexec') / spawn('winget')
 * 等系统工具会报 ENOENT。使用完整路径可以绕开 PATH 查找。
 *
 * @param {string} exeName - 可执行文件名，如 'msiexec.exe'
 * @returns {string} 完整路径（若文件不存在则返回原始名称作为降级）
 */
function getSystem32Exe(exeName) {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const full = path.join(systemRoot, 'System32', exeName);
  return fs.existsSync(full) ? full : exeName;
}

/**
 * 获取 winget.exe 的完整路径。
 * winget 安装在 WindowsApps 目录下，不在 System32，需要特殊处理。
 * 若找不到完整路径，回退到通过 shell: true 执行（让 cmd.exe 来解析）。
 */
function getWingetPath() {
  // winget 通常在 %LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe
  const localAppData = process.env.LOCALAPPDATA || '';
  if (localAppData) {
    const candidate = path.join(localAppData, 'Microsoft', 'WindowsApps', 'winget.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  // 备用：在 Program Files 的 WindowsApps 里
  const pfx86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  for (const base of [pfx86, pf]) {
    const candidate = path.join(base, 'Microsoft', 'WindowsApps', 'winget.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  // 找不到就返回 null，调用方改用 shell: true 方式
  return null;
}

/**
 * 获取常见安装路径（动态生成，不包含硬编码用户路径）
 * @returns {object} { nodePaths, gitPaths, npmPaths, extraPaths }
 */
function getCommonInstallPaths() {
  const homeDir = os.homedir();
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  return {
    // Node.js 常见安装路径
    nodePaths: [
      // 标准 Program Files 安装（使用环境变量）
      path.join(programFiles, 'nodejs', 'node.exe'),
      path.join(programFilesX86, 'nodejs', 'node.exe'),
      // 用户目录下的安装
      path.join(homeDir, 'AppData', 'Roaming', 'npm', 'node.exe'),
      path.join(homeDir, '.npm-global', 'node.exe'),
      path.join(homeDir, 'AppData', 'Local', 'node', 'node.exe'),
      // Scoop 安装
      path.join(homeDir, 'scoop', 'apps', 'nodejs', 'current', 'node.exe'),
      path.join(homeDir, 'scoop', 'shims', 'node.exe'),
      // NVM for Windows（用户目录下）
      path.join(homeDir, 'nvm4w', 'nodejs', 'node.exe'),
      path.join(homeDir, 'nvm', 'nodejs', 'node.exe'),
      // 根目录安装（常见但非标准）
      'C:\\nodejs\\node.exe',
    ],
    // Git 常见安装路径
    gitPaths: [
      path.join(programFiles, 'Git', 'bin', 'git.exe'),
      path.join(programFiles, 'Git', 'cmd', 'git.exe'),
      path.join(programFilesX86, 'Git', 'bin', 'git.exe'),
      path.join(programFilesX86, 'Git', 'cmd', 'git.exe'),
      path.join(homeDir, 'AppData', 'Local', 'Programs', 'Git', 'bin', 'git.exe'),
      path.join(homeDir, 'scoop', 'apps', 'git', 'current', 'bin', 'git.exe'),
      path.join(homeDir, 'scoop', 'shims', 'git.exe'),
      'C:\\ProgramData\\chocolatey\\bin\\git.exe',
    ],
    // npm 常见路径
    npmPaths: [
      path.join(homeDir, 'AppData', 'Roaming', 'npm', 'npm.cmd'),
      path.join(homeDir, '.npm-global', 'npm.cmd'),
      path.join(homeDir, 'scoop', 'shims', 'npm.exe'),
    ],
    // 用于 PATH 环境变量的额外路径
    extraPaths: [
      // Node.js 标准路径
      path.join(programFiles, 'nodejs'),
      path.join(programFilesX86, 'nodejs'),
      // Git 标准路径
      path.join(programFiles, 'Git', 'bin'),
      path.join(programFiles, 'Git', 'cmd'),
      path.join(programFilesX86, 'Git', 'bin'),
      path.join(programFilesX86, 'Git', 'cmd'),
      // 用户全局 npm 路径
      path.join(homeDir, 'AppData', 'Roaming', 'npm'),
      path.join(homeDir, 'AppData', 'Roaming', 'npm', 'node_modules', '.bin'),
      path.join(homeDir, '.npm-global'),
      path.join(homeDir, '.npm-global', 'bin'),
      // Scoop 安装路径
      path.join(homeDir, 'scoop', 'shims'),
      path.join(homeDir, 'scoop', 'apps', 'nodejs', 'current'),
      path.join(homeDir, 'scoop', 'apps', 'git', 'current', 'bin'),
      // Chocolatey
      'C:\\ProgramData\\chocolatey\\bin',
    ]
  };
}

class DependencyChecker {
  constructor() {
    this.wslChecker = new WslChecker();
    // 缓存检测结果，避免重复检测
    this._cache = {
      git: null,
      node: null,
      npm: null
    };
  }

  // ==================== 公共 API ====================

  /**
   * 检测所有依赖（用于初始状态展示）
   */
  async checkAll() {
    Logger.info('=== DependencyChecker.checkAll() START ===');

    // 关键：Electron 打包后继承的 PATH 非常精简（无用户 PATH），
    // 必须先从注册表读取完整的 Machine + User PATH 并合并进 process.env.PATH，
    // 才能正确检测到用户已安装的 Node.js / Git / npm。
    await this._refreshPath();
    // 清除缓存，确保用新 PATH 重新检测
    this._cache = { git: null, node: null, npm: null };
    
    const result = {
      node: { installed: false, version: null, satisfies: false },
      npm: { installed: false, version: null },
      git: { installed: false, version: null },
      packageManagers: [],
      wsl: { installed: false, version: null, distros: [] }
    };

    // 先检测 Node（_checkNpm 方法0 依赖 _cache.node，必须先跑完）
    const nodeResult = await this._checkNode();

    // Node 检测完后，并行检测其余项
    const [npmResult, gitResult, wslResult, packageManagers] = await Promise.all([
      this._checkNpm(),
      this._checkGit(),
      this._checkWsl(),
      this._checkPackageManagers()
    ]);

    result.node = nodeResult;
    result.npm = npmResult;
    result.git = gitResult;
    result.wsl = wslResult;
    result.packageManagers = packageManagers;

    Logger.info('=== DependencyChecker.checkAll() RESULT ===');
    Logger.info(`Node.js: ${result.node.installed ? result.node.version : 'NOT INSTALLED'}`);
    Logger.info(`npm: ${result.npm.installed ? result.npm.version : 'NOT INSTALLED'}`);
    Logger.info(`Git: ${result.git.installed ? result.git.version : 'NOT INSTALLED'}`);
    Logger.info(`WSL: ${result.wsl.installed ? 'INSTALLED' : 'NOT INSTALLED'}`);
    
    return result;
  }

  /**
   * 检测特定模式的依赖
   */
  async checkForMode(mode) {
    Logger.info(`=== DependencyChecker.checkForMode(${mode}) START ===`);

    // 每次检测前刷新 PATH，确保使用完整的用户环境变量
    await this._refreshPath();
    this._cache = { git: null, node: null, npm: null };
    
    if (mode === 'wsl') {
      const node = await this.wslChecker.checkWslNode();
      const npm = await this.wslChecker.checkWslNpm();
      return { node, npm, git: { installed: true, version: 'wsl' }, mode: 'wsl' };
    }

    // Native 模式 - 先跑 node，再并行跑 npm/git（npm 检测依赖 _cache.node）
    const nodeResult = await this._checkNode();
    const [npmResult, gitResult] = await Promise.all([
      this._checkNpm(),
      this._checkGit()
    ]);

    const result = {
      node: nodeResult,
      npm: npmResult,
      git: gitResult,
      mode: 'native'
    };

    Logger.info(`=== checkForMode(${mode}) RESULT ===`);
    Logger.info(`Node: ${result.node.installed ? result.node.version : 'NOT INSTALLED'}`);
    Logger.info(`npm: ${result.npm.installed ? result.npm.version : 'NOT INSTALLED'}`);
    Logger.info(`Git: ${result.git.installed ? result.git.version : 'NOT INSTALLED'}`);

    return result;
  }

  /**
   * 检测 Git（单独暴露的 API）
   */
  async checkGit() {
    return this._checkGit();
  }

  // ==================== 核心检测方法 ====================

  /**
   * 检测 Node.js
   * 关键修复：优先检查常见安装路径，确保能检测到新安装的 Node.js
   */
  async _checkNode() {
    // 使用缓存
    if (this._cache.node !== null) {
      return this._cache.node;
    }

    Logger.info('[_checkNode] Starting detection...');

    const result = { installed: false, version: null, satisfies: false };

    try {
      // 方法1: 优先检查常见安装路径（这是最直接可靠的方法）
      Logger.info('[_checkNode] Method 1: Checking common installation paths');
      const commonNodePaths = getCommonInstallPaths().nodePaths;

      // 补充：从环境变量动态解析 nvm-windows / fnm / volta / nvs 等版本管理器路径
      const dynamicNodePaths = [];
      const nvmHome = process.env.NVM_HOME || process.env.NVM_DIR;
      if (nvmHome && fs.existsSync(nvmHome)) {
        // nvm-windows: NVM_HOME\v22.x.x\node.exe — 找所有子目录下的 node.exe
        try {
          const nvmDirs = fs.readdirSync(nvmHome).filter(d => /^v?\d+\.\d+/.test(d));
          // 按版本号降序，优先检测最新版
          nvmDirs.sort((a, b) => {
            const va = a.replace(/^v/, '').split('.').map(Number);
            const vb = b.replace(/^v/, '').split('.').map(Number);
            return vb[0] - va[0] || vb[1] - va[1] || vb[2] - va[2];
          });
          for (const d of nvmDirs.slice(0, 5)) { // 最多检查最新5个版本
            dynamicNodePaths.push(path.join(nvmHome, d, 'node.exe'));
          }
          Logger.info(`[_checkNode] nvm-windows dirs found: ${nvmDirs.length}, checking top ${Math.min(5, nvmDirs.length)}`);
        } catch (e) {
          Logger.warn('[_checkNode] nvm dir scan failed: ' + e.message);
        }
      }
      // fnm / volta / nvs
      const fnmDir = process.env.FNM_DIR;
      if (fnmDir && fs.existsSync(fnmDir)) {
        // fnm: FNM_DIR/node-versions/<ver>/installation/node.exe
        try {
          const verDir = path.join(fnmDir, 'node-versions');
          if (fs.existsSync(verDir)) {
            const vers = fs.readdirSync(verDir).sort((a, b) => {
              const va = a.split('.').map(Number); const vb = b.split('.').map(Number);
              return vb[0] - va[0] || vb[1] - va[1] || vb[2] - va[2];
            });
            for (const v of vers.slice(0, 3)) {
              dynamicNodePaths.push(path.join(verDir, v, 'installation', 'node.exe'));
            }
          }
        } catch (e) { /* ignore */ }
      }
      // Volta (AppData\Local\Volta\bin\node.exe 或 volta shims)
      const voltaHome = process.env.VOLTA_HOME || path.join(os.homedir(), 'AppData', 'Local', 'Volta');
      if (fs.existsSync(voltaHome)) {
        dynamicNodePaths.push(path.join(voltaHome, 'bin', 'node.exe'));
      }

      const allNodePaths = [...dynamicNodePaths, ...commonNodePaths];

      for (const nodePath of allNodePaths) {
        const exists = fs.existsSync(nodePath);
        Logger.info(`[_checkNode] Checking: ${nodePath} (exists: ${exists})`);
        if (exists) {
          try {
            Logger.info(`[_checkNode] Executing: ${nodePath} --version`);
            const versionResult = await this._execCommand(nodePath, ['--version']);
            Logger.info(`[_checkNode] Result: success=${versionResult.success}, stdout=${versionResult.stdout?.substring(0, 30)}`);
            if (versionResult.success && versionResult.stdout) {
              const version = versionResult.stdout.replace(/^v/, '').trim();
              const major = parseInt(version.split('.')[0], 10);
              result.installed = true;
              result.version = version;
              result.satisfies = major >= 18;
              result.path = nodePath;
              Logger.info(`[_checkNode] ✓ Verified: v${version} at ${nodePath}`);
              this._cache.node = result;
              return result;
            }
          } catch (execErr) {
            Logger.warn(`[_checkNode] Failed to execute ${nodePath}: ${execErr.message}`);
          }
        }
      }

      // 方法2: 尝试直接运行 node --version（依赖 _refreshPath 刷新后的 PATH）
      Logger.info('[_checkNode] Method 2: Trying direct command');
      Logger.info(`[_checkNode] Current PATH preview: ${(process.env.PATH || '').substring(0, 200)}`);
      const execResult = await this._execCommand('node', ['--version']);

      if (execResult.success && execResult.stdout) {
        const version = execResult.stdout.replace(/^v/, '').trim();
        const major = parseInt(version.split('.')[0], 10);
        result.installed = true;
        result.version = version;
        result.satisfies = major >= 18;
        result.path = execResult.path;
        Logger.info(`[_checkNode] ✓ Found via command: v${version}`);
        this._cache.node = result;
        return result;
      }

      // 方法3: 使用 where 命令查找
      Logger.info('[_checkNode] Method 3: Using where command');
      const whereExe = getSystem32Exe('where.exe');
      const whereResult = await this._execCommand(whereExe, ['node'], 10000);
      if (whereResult.success && whereResult.stdout) {
        const nodePaths = whereResult.stdout.trim().split(/\r?\n/).filter(p => p.trim());
        Logger.info(`[_checkNode] where found ${nodePaths.length} path(s)`);

        for (const nodePath of nodePaths) {
          const trimmedPath = nodePath.trim();
          if (fs.existsSync(trimmedPath)) {
            Logger.info(`[_checkNode] Trying path: ${trimmedPath}`);
            const versionResult = await this._execCommand(trimmedPath, ['--version'], 10000);
            if (versionResult.success && versionResult.stdout) {
              const version = versionResult.stdout.replace(/^v/, '').trim();
              const major = parseInt(version.split('.')[0], 10);
              result.installed = true;
              result.version = version;
              result.satisfies = major >= 18;
              result.path = trimmedPath;
              Logger.info(`[_checkNode] ✓ Found via where: v${version} at ${trimmedPath}`);
              this._cache.node = result;
              return result;
            }
          }
        }
      }

      Logger.warn('[_checkNode] Node.js not found in any location');
    } catch (err) {
      Logger.error(`[_checkNode] Error: ${err.message}`);
    }

    this._cache.node = result;
    return result;
  }

  /**
   * 检测 npm
   * 关键修复：
   * 1. 优先使用直接命令（npm --version），因为 .cmd 文件路径含空格时 spawn 处理有问题
   * 2. 如果 Node.js 已检测到，npm 必然存在（npm 随 Node.js 一起安装）
   */
  async _checkNpm() {
    if (this._cache.npm !== null) {
      return this._cache.npm;
    }

    Logger.info('[_checkNpm] Starting detection...');

    const result = { installed: false, version: null };

    try {
      // 方法0: 如果 node 已找到，直接从 node 同目录下找 npm.cmd
      // （nvm-windows / fnm 等环境下 node 和 npm 在同一目录，不在系统 PATH 里）
      if (this._cache.node?.installed && this._cache.node?.path) {
        const nodeDir = path.dirname(this._cache.node.path);
        const npmCmdPath = path.join(nodeDir, 'npm.cmd');
        const npmExePath = path.join(nodeDir, 'npm');
        Logger.info(`[_checkNpm] Method 0: Checking npm beside node at: ${nodeDir}`);
        for (const npmPath of [npmCmdPath, npmExePath]) {
          if (fs.existsSync(npmPath)) {
            Logger.info(`[_checkNpm] Found npm at: ${npmPath}`);
            const versionResult = await this._execCommand(npmPath, ['--version'], 15000);
            if (versionResult.success && versionResult.stdout) {
              result.installed = true;
              result.version = versionResult.stdout.trim();
              Logger.info(`[_checkNpm] ✓ Found beside node: v${result.version}`);
              this._cache.npm = result;
              return result;
            }
          }
        }
        // npm.cmd 不在 node 目录，但 node 在 nvm 目录——尝试 npm-cli.js（node 内置模块路径）
        const builtinNpmCli = path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
        if (fs.existsSync(builtinNpmCli)) {
          Logger.info(`[_checkNpm] Found npm-cli.js beside node: ${builtinNpmCli}`);
          const versionResult = await this._execCommand(this._cache.node.path, [builtinNpmCli, '--version'], 15000);
          if (versionResult.success && versionResult.stdout) {
            result.installed = true;
            result.version = versionResult.stdout.trim();
            Logger.info(`[_checkNpm] ✓ Found via node + npm-cli.js: v${result.version}`);
            this._cache.npm = result;
            return result;
          }
        }
      }

      // 方法1: 直接运行 npm --version（依赖 _refreshPath 刷新后的 PATH）
      Logger.info('[_checkNpm] Method 1: Direct npm command');
      const execResult = await this._execCommand('npm', ['--version'], 15000);
      
      if (execResult.success && execResult.stdout) {
        result.installed = true;
        result.version = execResult.stdout.trim();
        Logger.info(`[_checkNpm] ✓ Found via direct command: v${result.version}`);
        this._cache.npm = result;
        return result;
      }
      
      Logger.info(`[_checkNpm] Method 1 result: success=${execResult.success}, stdout=${execResult.stdout}, stderr=${execResult.stderr}`);

      // 方法2: 如果 Node.js 已安装，npm 必然存在
      // 尝试用 node 直接执行 npm-cli.js
      if (this._cache.node?.installed) {
        Logger.info('[_checkNpm] Method 2: Node.js detected, trying npm-cli.js');
        
        // npm-cli.js 的可能位置
        const npmCliPaths = [
          path.join(path.dirname(this._cache.node.path), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
          path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
          path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        ];
        
        for (const cliPath of npmCliPaths) {
          if (fs.existsSync(cliPath)) {
            Logger.info(`[_checkNpm] Found npm-cli.js at: ${cliPath}`);
            const nodeExe = this._cache.node.path || 'node';
            const versionResult = await this._execCommand(nodeExe, [cliPath, '--version'], 15000);
            if (versionResult.success && versionResult.stdout) {
              result.installed = true;
              result.version = versionResult.stdout.trim();
              Logger.info(`[_checkNpm] ✓ Found via npm-cli.js: v${result.version}`);
              this._cache.npm = result;
              return result;
            }
          }
        }
      }

      // 方法3: 使用 where 命令查找 npm
      Logger.info('[_checkNpm] Method 3: where command');
      const whereExe = getSystem32Exe('where.exe');
      const whereResult = await this._execCommand(whereExe, ['npm'], 10000);
      if (whereResult.success && whereResult.stdout) {
        Logger.info(`[_checkNpm] where result: ${whereResult.stdout}`);
        // where 找到了，说明 npm 在 PATH 中，再次尝试执行
        const retryResult = await this._execCommand('npm', ['--version'], 15000);
        if (retryResult.success && retryResult.stdout) {
          result.installed = true;
          result.version = retryResult.stdout.trim();
          Logger.info(`[_checkNpm] ✓ Found after where: v${result.version}`);
          this._cache.npm = result;
          return result;
        }
      }

      // 方法4: 检查 npm 文件是否存在（仅作辅助判断，不执行）
      Logger.info('[_checkNpm] Method 4: Check npm file existence');
      const commonNpmPaths = [
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'npm.cmd'),
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'npm.cmd'),
        path.join(os.homedir(), 'scoop', 'shims', 'npm.exe'),
      ];
      
      for (const npmPath of commonNpmPaths) {
        if (fs.existsSync(npmPath)) {
          Logger.info(`[_checkNpm] Found npm file at: ${npmPath}`);
          // 文件存在但执行失败，可能是 PATH 问题
          // 如果 Node.js 存在，假设 npm 也存在
          if (this._cache.node?.installed) {
            result.installed = true;
            result.version = 'unknown (file found)';
            Logger.info(`[_checkNpm] ✓ Assuming npm installed with Node.js`);
            this._cache.npm = result;
            return result;
          }
        }
      }

      Logger.warn('[_checkNpm] npm not found in any location');
    } catch (err) {
      Logger.error(`[_checkNpm] Error: ${err.message}`);
    }

    this._cache.npm = result;
    return result;
  }

  /**
   * 检测 Git - 核心检测方法
   */
  async _checkGit() {
    if (this._cache.git !== null) {
      return this._cache.git;
    }

    Logger.info('[_checkGit] ========== STARTING GIT DETECTION ==========');
    
    const result = { installed: false, version: null, path: null };

    // 方法1: 直接运行 git --version（最常见的情况）
    Logger.info('[_checkGit] Method 1: Direct command');
    try {
      const execResult = await this._execCommand('git', ['--version'], 15000);
      if (execResult.success && execResult.stdout) {
        const match = execResult.stdout.match(/git version (\d+\.\d+\.\d+)/i);
        if (match) {
          result.installed = true;
          result.version = match[1];
          result.path = execResult.path || 'git';
          Logger.info(`[_checkGit] ✓ Found via direct command: v${result.version}`);
          this._cache.git = result;
          return result;
        }
      }
    } catch (err) {
      Logger.warn(`[_checkGit] Method 1 failed: ${err.message}`);
    }

    // 方法2: 使用 where 命令查找
    Logger.info('[_checkGit] Method 2: where command');
    try {
      const whereExe = getSystem32Exe('where.exe');
      const whereResult = await this._execCommand(whereExe, ['git'], 10000);
      if (whereResult.success && whereResult.stdout) {
        const gitPaths = whereResult.stdout.trim().split(/\r?\n/).filter(p => p.trim());
        Logger.info(`[_checkGit] where found ${gitPaths.length} path(s)`);
        
        for (const gitPath of gitPaths) {
          const trimmedPath = gitPath.trim();
          if (fs.existsSync(trimmedPath)) {
            Logger.info(`[_checkGit] Trying path: ${trimmedPath}`);
            const versionResult = await this._execCommand(trimmedPath, ['--version'], 10000);
            if (versionResult.success && versionResult.stdout) {
              const match = versionResult.stdout.match(/git version (\d+\.\d+\.\d+)/i);
              if (match) {
                result.installed = true;
                result.version = match[1];
                result.path = trimmedPath;
                Logger.info(`[_checkGit] ✓ Found via where: v${result.version} at ${trimmedPath}`);
                this._cache.git = result;
                return result;
              }
            }
          }
        }
      }
    } catch (err) {
      Logger.warn(`[_checkGit] Method 2 failed: ${err.message}`);
    }

    // 方法3: 检查常见安装路径
    Logger.info('[_checkGit] Method 3: Common paths');
    const commonPaths = getCommonInstallPaths().gitPaths;

    for (const gitPath of commonPaths) {
      const exists = fs.existsSync(gitPath);
      Logger.info(`[_checkGit] Checking path: ${gitPath} (exists: ${exists})`);
      if (exists) {
        try {
          Logger.info(`[_checkGit] Executing: ${gitPath} --version`);
          const versionResult = await this._execCommand(gitPath, ['--version'], 10000);
          Logger.info(`[_checkGit] Result: success=${versionResult.success}, stdout=${versionResult.stdout?.substring(0, 50)}, stderr=${versionResult.stderr?.substring(0, 50)}`);
          if (versionResult.success && versionResult.stdout) {
            const match = versionResult.stdout.match(/git version (\d+\.\d+\.\d+)/i);
            if (match) {
              result.installed = true;
              result.version = match[1];
              result.path = gitPath;
              Logger.info(`[_checkGit] ✓ Found at common path: v${result.version}`);
              this._cache.git = result;
              return result;
            } else {
              Logger.warn(`[_checkGit] Version regex did not match: ${versionResult.stdout}`);
            }
          } else {
            Logger.warn(`[_checkGit] Command failed or no output: code=${versionResult.code}`);
          }
        } catch (err) {
          Logger.warn(`[_checkGit] Path ${gitPath} failed: ${err.message}`);
        }
      }
    }

    // 方法4: 从注册表查找
    Logger.info('[_checkGit] Method 4: Registry');
    const regExe = getSystem32Exe('reg.exe');
    const registryPaths = [
      { key: 'HKLM\\SOFTWARE\\GitForWindows', name: 'InstallPath' },
      { key: 'HKCU\\SOFTWARE\\GitForWindows', name: 'InstallPath' },
    ];

    for (const reg of registryPaths) {
      try {
        const regResult = await this._execCommand(regExe, ['query', reg.key, '/v', reg.name], 5000);
        if (regResult.success && regResult.stdout) {
          const match = regResult.stdout.match(/InstallPath\s+REG_SZ\s+(.+)/i);
          if (match) {
            const installPath = match[1].trim();
            const gitPath = path.join(installPath, 'bin', 'git.exe');
            Logger.info(`[_checkGit] Registry found install path: ${installPath}`);
            
            if (fs.existsSync(gitPath)) {
              const versionResult = await this._execCommand(gitPath, ['--version'], 10000);
              if (versionResult.success && versionResult.stdout) {
                const verMatch = versionResult.stdout.match(/git version (\d+\.\d+\.\d+)/i);
                if (verMatch) {
                  result.installed = true;
                  result.version = verMatch[1];
                  result.path = gitPath;
                  Logger.info(`[_checkGit] ✓ Found via registry: v${result.version}`);
                  this._cache.git = result;
                  return result;
                }
              }
            }
          }
        }
      } catch (err) {
        Logger.warn(`[_checkGit] Registry ${reg.key} failed: ${err.message}`);
      }
    }

    Logger.warn('[_checkGit] ✗ Git NOT FOUND after all detection methods');
    this._cache.git = result;
    return result;
  }

  /**
   * 检测 WSL
   */
  async _checkWsl() {
    try {
      return await this.wslChecker.checkWslStatus();
    } catch (err) {
      Logger.error(`[_checkWsl] Error: ${err.message}`);
      return { installed: false, version: null, distros: [] };
    }
  }

  /**
   * 检测包管理器
   */
  async _checkPackageManagers() {
    const managers = [];
    const toCheck = ['winget', 'choco', 'scoop'];

    for (const mgr of toCheck) {
      try {
        const result = await this._execCommand(mgr, ['--version'], 5000);
        if (result.success) {
          managers.push(mgr);
        }
      } catch {}
    }

    return managers;
  }

  // ==================== 安装方法 ====================

  /**
   * 安装 Git
   */
  async installGit(onProgress) {
    Logger.info('=== installGit() START ===');
    onProgress({ step: 'start', message: '准备安装 Git...', percent: 5 });

    // 清除缓存
    this._cache.git = null;

    // 检查是否已安装
    const existing = await this._checkGit();
    if (existing.installed) {
      Logger.info(`Git already installed: v${existing.version}`);
      onProgress({ step: 'done', message: `Git ${existing.version} 已安装`, percent: 100 });
      return { success: true, version: existing.version };
    }

    // 获取安装包
    let installerPath = ResourceLocator.getGitInstaller();
    
    if (!installerPath) {
      // 自动下载
      Logger.info('No built-in installer, downloading...');
      onProgress({ step: 'downloading', message: '正在下载 Git 安装包...', percent: 10 });

      try {
        installerPath = await this._downloadGitInstaller(onProgress);
      } catch (downloadErr) {
        Logger.error(`Download failed: ${downloadErr.message}`);
        onProgress({ step: 'error', message: `下载失败: ${downloadErr.message}`, percent: 0 });
        throw new Error(`无法下载 Git: ${downloadErr.message}`);
      }
    }

    Logger.info(`Using installer: ${installerPath}`);
    onProgress({ step: 'installing', message: '正在安装 Git...', percent: 40 });

    // 执行安装
    try {
      const exitCode = await this._runInstaller(installerPath, [
        '/VERYSILENT',
        '/NORESTART', 
        '/NOCANCEL',
        '/SP-',
        '/COMPONENTS=assoc,assoc_sh,consolefont,gitlfs,windowsterminal'
      ], (line) => {
        onProgress({ step: 'installing', message: line || '正在安装...', percent: 60 });
      });

      if (exitCode !== 0) {
        throw new Error(`安装程序返回错误代码: ${exitCode}`);
      }

      Logger.info('Git installation completed, refreshing PATH...');
      onProgress({ step: 'verifying', message: '刷新环境变量...', percent: 80 });

      // 刷新 PATH
      await this._refreshPath();

      // 清除缓存重新检测
      this._cache.git = null;
      
      // 等待一下让系统更新
      await this._sleep(2000);

      // 验证安装
      const verify = await this._checkGit();
      if (verify.installed) {
        Logger.info(`Git installed successfully: v${verify.version}`);
        onProgress({ step: 'done', message: `Git ${verify.version} 安装成功`, percent: 100 });
        return { success: true, version: verify.version };
      } else {
        Logger.warn('Git installed but not detected, may need restart');
        onProgress({ step: 'done', message: 'Git 安装完成，可能需要重启应用', percent: 100 });
        return { success: true, needsRestart: true };
      }
    } catch (installErr) {
      Logger.error(`Installation failed: ${installErr.message}`);
      onProgress({ step: 'error', message: `安装失败: ${installErr.message}`, percent: 0 });
      throw installErr;
    }
  }

  /**
   * 安装 Node.js
   */
  async installNode(method, onProgress) {
    Logger.info(`=== installNode(${method || 'auto'}) START ===`);
    onProgress({ step: 'start', message: '准备安装 Node.js...', percent: 5 });

    // 清除缓存
    this._cache.node = null;
    this._cache.npm = null;

    // 检查是否已安装
    const existing = await this._checkNode();
    if (existing.installed && existing.satisfies) {
      Logger.info(`Node.js already installed: v${existing.version}`);
      onProgress({ step: 'done', message: `Node.js ${existing.version} 已安装`, percent: 100 });
      return { success: true, version: existing.version };
    }

    // 获取安装包
    let msiPath = ResourceLocator.getNodeJsInstaller();

    if (!msiPath) {
      // 自动下载
      Logger.info('No built-in installer, downloading...');
      onProgress({ step: 'downloading', message: '正在下载 Node.js 安装包...', percent: 10 });

      try {
        msiPath = await this._downloadNodeInstaller(onProgress);
      } catch (downloadErr) {
        Logger.error(`Download failed: ${downloadErr.message}`);
        // 尝试使用 winget
        return await this._installNodeViaWinget(onProgress);
      }
    }

    Logger.info(`Using installer: ${msiPath}`);
    onProgress({ step: 'installing', message: '正在安装 Node.js...', percent: 40 });

    // 执行安装
    try {
      const exitCode = await this._runMsiInstaller(msiPath, (line) => {
        onProgress({ step: 'installing', message: line || '正在安装...', percent: 60 });
      });

      if (exitCode !== 0) {
        throw new Error(`安装程序返回错误代码: ${exitCode}`);
      }

      Logger.info('Node.js installation completed, refreshing PATH...');
      onProgress({ step: 'verifying', message: '刷新环境变量...', percent: 80 });

      // 刷新 PATH
      await this._refreshPath();

      // 清除缓存重新检测
      this._cache.node = null;
      this._cache.npm = null;
      
      await this._sleep(2000);

      // 验证安装
      const verify = await this._checkNode();
      if (verify.installed) {
        Logger.info(`Node.js installed successfully: v${verify.version}`);
        onProgress({ step: 'done', message: `Node.js ${verify.version} 安装成功`, percent: 100 });
        return { success: true, version: verify.version };
      } else {
        Logger.warn('Node.js installed but not detected, may need restart');
        onProgress({ step: 'done', message: 'Node.js 安装完成，可能需要重启应用', percent: 100 });
        return { success: true, needsRestart: true };
      }
    } catch (installErr) {
      Logger.error(`Installation failed: ${installErr.message}`);
      onProgress({ step: 'error', message: `安装失败: ${installErr.message}`, percent: 0 });
      throw installErr;
    }
  }

  /**
   * 通过 winget 安装 Node.js
   * winget.exe 不在 System32，需要特殊路径处理
   */
  async _installNodeViaWinget(onProgress) {
    Logger.info('Trying winget installation...');
    onProgress({ step: 'installing', message: '使用 winget 安装 Node.js...', percent: 30 });

    try {
      const wingetExe = getWingetPath();
      // 若找不到 winget 完整路径，回退到 shell:true 模式（让系统 shell 自行解析）
      const installerPath = wingetExe || 'winget';
      const spawnOptions = wingetExe ? {} : { shell: true };
      Logger.info(`winget path: ${installerPath} (shell: ${!!spawnOptions.shell})`);

      const exitCode = await this._runInstaller(installerPath, [
        'install', 'OpenJS.NodeJS.LTS',
        '--accept-package-agreements',
        '--accept-source-agreements'
      ], (line) => {
        onProgress({ step: 'installing', message: line, percent: 60 });
      }, spawnOptions);

      if (exitCode !== 0) {
        throw new Error(`winget 返回错误代码: ${exitCode}`);
      }

      await this._refreshPath();
      this._cache.node = null;
      this._cache.npm = null;

      const verify = await this._checkNode();
      if (verify.installed) {
        onProgress({ step: 'done', message: `Node.js ${verify.version} 安装成功`, percent: 100 });
        return { success: true, version: verify.version };
      }

      onProgress({ step: 'done', message: 'Node.js 安装完成，可能需要重启应用', percent: 100 });
      return { success: true, needsRestart: true };
    } catch (err) {
      onProgress({ step: 'error', message: `安装失败: ${err.message}`, percent: 0 });
      throw err;
    }
  }

  // ==================== 辅助方法 ====================

  /**
   * 执行命令并返回结果
   * 关键修复：确保使用更新后的 PATH 环境变量
   */
  async _execCommand(cmd, args, timeout = 30000) {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      // 构建环境变量 - 使用最新的 process.env.PATH
      const env = { ...process.env };

      // 确保 PATH 包含常见目录（优先级最高）
      // 注意：使用动态路径，不包含硬编码用户路径
      const extraPaths = getCommonInstallPaths().extraPaths;

      // 构建 PATH：常见路径（优先级高）+ 当前环境 PATH
      const currentPaths = (env.PATH || '').split(';').filter(p => p.trim());
      const allPaths = [...extraPaths, ...currentPaths];

      // 去重并保持顺序
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
      
      Logger.debug(`[_execCommand] PATH for ${cmd}: ${env.PATH.substring(0, 100)}...`);

      let child;
      try {
        // Windows 上使用 shell: true 让 Node.js 自动处理命令查找和执行
        if (process.platform === 'win32') {
          // 检查 cmd 是否是完整路径
          const isFullPath = cmd.includes('\\') || cmd.includes('/');
          // 检查是否是 .cmd 或 .bat 文件
          const isCmdFile = cmd.toLowerCase().endsWith('.cmd') || cmd.toLowerCase().endsWith('.bat');
          // 检查是否是 .exe 文件
          const isExeFile = cmd.toLowerCase().endsWith('.exe');
          
          if (isFullPath && (isExeFile || !isCmdFile)) {
            // 如果是完整路径且是 .exe 文件（或不是 .cmd/.bat），直接执行不使用 shell
            Logger.debug(`[_execCommand] Using direct spawn for full path: ${cmd}`);
            child = spawn(cmd, args, {
              env: env,
              windowsHide: true,
              stdio: ['pipe', 'pipe', 'pipe']
            });
          } else {
            // 对于命令名或 .cmd/.bat 文件路径，使用 shell: true
            // 这让 Node.js 自动处理：
            // 1. 在 PATH 中查找命令
            // 2. 正确处理 .cmd/.bat 文件
            // 3. 处理路径中的空格
            Logger.debug(`[_execCommand] Using shell:true for: ${cmd}`);
            child = spawn(cmd, args, {
              shell: true,
              env: env,
              windowsHide: true,
              stdio: ['pipe', 'pipe', 'pipe']
            });
          }
        } else {
          child = spawn(cmd, args, {
            shell: true,
            env: env,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe']
          });
        }
      } catch (spawnErr) {
        Logger.error(`[_execCommand] Spawn error: ${spawnErr.message}`);
        resolve({ success: false, stdout: '', stderr: spawnErr.message, error: spawnErr.message });
        return;
      }

      const timer = setTimeout(() => {
        killed = true;
        child.kill();
        resolve({ success: false, stdout: '', stderr: 'Timeout', error: 'Timeout' });
      }, timeout);

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (!killed) {
          resolve({
            success: code === 0 || stdout.trim().length > 0,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            code: code,
            path: cmd
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        if (!killed) {
          resolve({ success: false, stdout: '', stderr: err.message, error: err.message });
        }
      });
    });
  }

  /**
   * 在常见路径中查找可执行文件
   */
  async _findInCommonPaths(exeName, searchPaths) {
    for (const searchPath of searchPaths) {
      const fullPath = path.join(searchPath, exeName);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
    return null;
  }

  /**
   * 运行安装程序
   * @param {string} installerPath - 可执行文件路径（建议传完整路径）
   * @param {string[]} args - 命令行参数
   * @param {Function} onOutput - 输出回调
   * @param {object} [spawnOptions] - 额外的 spawn 选项（可覆盖默认值）
   */
  async _runInstaller(installerPath, args, onOutput, spawnOptions = {}) {
    return new Promise((resolve, reject) => {
      Logger.info(`Running installer: ${installerPath} ${args.join(' ')}`);
      
      const child = spawn(installerPath, args, {
        shell: false,
        windowsHide: true,
        detached: true,
        ...spawnOptions
      });

      let stderr = '';

      child.stdout?.on('data', (data) => {
        const line = data.toString().trim();
        if (line && onOutput) onOutput(line);
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
        Logger.warn(`Installer stderr: ${data.toString().trim()}`);
      });

      child.on('close', (code) => {
        Logger.info(`Installer exited with code: ${code}`);
        resolve(code || 0);
      });

      child.on('error', (err) => {
        Logger.error(`Installer error: ${err.message}`);
        reject(err);
      });
    });
  }

  /**
   * 运行 MSI 安装程序
   * msiexec.exe 位于 %SystemRoot%\System32\，必须用完整路径避免打包后 ENOENT
   */
  async _runMsiInstaller(msiPath, onOutput) {
    return this._runInstaller(getSystem32Exe('msiexec.exe'), [
      '/i', msiPath,
      '/qn',
      '/norestart',
      'ADDLOCAL=ALL'
    ], onOutput);
  }

  /**
   * 刷新 PATH 环境变量
   * 关键修复：使用 PowerShell 直接读取注册表和系统环境变量，确保获取最新值
   */
  async _refreshPath() {
    Logger.info('Refreshing PATH environment variable...');

    // PowerShell 完整路径，避免 Electron 打包后 PATH 里找不到它
    const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
    const powershellExe = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

    try {
      // 用一条 PowerShell 命令同时获取 Machine + User PATH 并展开所有 %VAR% 引用。
      //
      // 为什么要展开？
      //   注册表里的 PATH 类型是 REG_EXPAND_SZ，包含 %SystemRoot%、%NVM_HOME% 等
      //   未展开的变量引用。如果不展开直接拼进 process.env.PATH，形如 %NVM_HOME%\nodejs
      //   的条目永远找不到实际目录，导致 node/npm 检测失败。
      //
      // 方案：让 PowerShell 用 [Environment]::ExpandEnvironmentVariables() 做展开，
      //   输出格式 "MACHINE|<machine_path>\nUSER|<user_path>"，一次调用拿到两个值。
      // 强制 PowerShell 输出 UTF-8，避免中文路径乱码
      const combinedPsResult = await this._execCommand(powershellExe, [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-OutputFormat', 'Text',
        '-Command',
        [
          '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;',
          '$m=[Environment]::GetEnvironmentVariable("Path","Machine");',
          '$u=[Environment]::GetEnvironmentVariable("Path","User");',
          '$me=[Environment]::ExpandEnvironmentVariables($m);',
          '$ue=[Environment]::ExpandEnvironmentVariables($u);',
          'Write-Output "MACHINE|$me";',
          'Write-Output "USER|$ue"'
        ].join(' ')
      ], 15000);

      Logger.info(`PowerShell combined PATH result: success=${combinedPsResult.success}, length=${combinedPsResult.stdout?.length || 0}`);

      let machinePath = '';
      let userPath = '';

      if (combinedPsResult.success && combinedPsResult.stdout) {
        for (const line of combinedPsResult.stdout.split(/\r?\n/)) {
          if (line.startsWith('MACHINE|')) {
            machinePath = line.slice('MACHINE|'.length).trim();
          } else if (line.startsWith('USER|')) {
            userPath = line.slice('USER|'.length).trim();
          }
        }
        Logger.info(`Machine PATH length: ${machinePath.length}, User PATH length: ${userPath.length}`);
      } else {
        // PowerShell 失败时降级到 reg.exe + 手动展开
        Logger.warn('PowerShell PATH read failed, falling back to reg.exe');
        const regExe = getSystem32Exe('reg.exe');

        const expandEnvVars = (str) => {
          // 简单替换常见的 %VAR% 引用
          return str.replace(/%([^%]+)%/g, (_, name) => process.env[name] || `%${name}%`);
        };

        try {
          const regResult = await this._execCommand(regExe, [
            'query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
            '/v', 'Path'
          ], 10000);
          if (regResult.success && regResult.stdout) {
            const match = regResult.stdout.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.+)/i);
            if (match) {
              machinePath = expandEnvVars(match[1].trim());
              Logger.info('Got Machine PATH from registry (reg.exe)');
            }
          }
        } catch (regErr) {
          Logger.warn(`Registry Machine PATH read failed: ${regErr.message}`);
        }

        try {
          const regResult = await this._execCommand(regExe, [
            'query', 'HKCU\\Environment',
            '/v', 'Path'
          ], 10000);
          if (regResult.success && regResult.stdout) {
            const match = regResult.stdout.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.+)/i);
            if (match) {
              userPath = expandEnvVars(match[1].trim());
              Logger.info('Got User PATH from registry (reg.exe)');
            }
          }
        } catch (regErr) {
          Logger.warn(`Registry User PATH read failed: ${regErr.message}`);
        }
      }

      // 合并 PATH
      const allPaths = [];
      
      // 添加常见安装路径（确保新安装的软件能被找到）
      const commonPaths = [
        // 标准 Node.js 安装路径
        'C:\\Program Files\\nodejs',
        'C:\\Program Files (x86)\\nodejs',
        // Git 标准路径
        'C:\\Program Files\\Git\\bin',
        'C:\\Program Files\\Git\\cmd',
        'C:\\Program Files (x86)\\Git\\bin',
        'C:\\Program Files (x86)\\Git\\cmd',
        // 用户自定义安装路径
        'D:\\Program Files\\nodejs',
        'D:\\Program Files\\Git\\bin',
        'D:\\Program Files\\Git\\cmd',
        'D:\\Programs\\nodejs',
        'D:\\Programs\\Git\\bin',
        'D:\\Programs\\Git\\cmd',
        'D:\\programs\\nodejs',
        'D:\\programs\\git\\bin',
        'D:\\programs\\git\\cmd',
        // NVM for Windows 路径
        'D:\\programs\\nvm4w\\nodejs',
        'D:\\programs\\nvm',
        'D:\\nvm4w\\nodejs',
        'C:\\nvm4w\\nodejs',
        path.join(os.homedir(), 'nvm4w', 'nodejs'),
        // 用户全局 npm 路径
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm'),
        path.join(os.homedir(), '.npm-global'),
        path.join(os.homedir(), '.npm-global', 'bin'),
        // Scoop
        path.join(os.homedir(), 'scoop', 'shims'),
        path.join(os.homedir(), 'scoop', 'apps', 'nodejs', 'current'),
        path.join(os.homedir(), 'scoop', 'apps', 'git', 'current', 'bin'),
        // Chocolatey
        'C:\\ProgramData\\chocolatey\\bin',
      ];
      
      // 先添加常见路径（优先级高）
      for (const p of commonPaths) {
        if (fs.existsSync(p)) {
          allPaths.push(p);
        }
      }
      
      // 添加系统 PATH
      if (machinePath) {
        allPaths.push(...machinePath.split(';').filter(p => p.trim()));
      }
      
      // 添加用户 PATH
      if (userPath) {
        allPaths.push(...userPath.split(';').filter(p => p.trim()));
      }
      
      // 添加当前进程 PATH（作为后备）
      if (process.env.PATH) {
        allPaths.push(...process.env.PATH.split(';').filter(p => p.trim()));
      }
      
      // 去重并保持顺序
      const uniquePaths = [];
      const seen = new Set();
      for (const p of allPaths) {
        const normalized = p.toLowerCase().trim();
        if (!seen.has(normalized) && normalized) {
          seen.add(normalized);
          uniquePaths.push(p.trim());
        }
      }
      
      process.env.PATH = uniquePaths.join(';');
      
      Logger.info(`PATH refreshed, ${uniquePaths.length} entries`);
      Logger.info(`PATH preview: ${process.env.PATH.substring(0, 200)}...`);
      
      // 验证关键路径是否存在
      const nodePaths = uniquePaths.filter(p => p.toLowerCase().includes('nodejs'));
      const gitPaths = uniquePaths.filter(p => p.toLowerCase().includes('git'));
      Logger.info(`Node.js paths in PATH: ${nodePaths.length}`);
      Logger.info(`Git paths in PATH: ${gitPaths.length}`);
      
    } catch (err) {
      Logger.error(`PATH refresh failed: ${err.message}`);
      Logger.error(`Stack: ${err.stack}`);
    }
  }

  /**
   * 下载文件
   * 关键修复：添加更好的错误处理和文件权限处理
   */
  async _downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      const tempPath = destPath + '.downloading';

      Logger.info(`Downloading: ${url}`);

      // 确保目录存在
      const dir = path.dirname(tempPath);
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
          Logger.info(`Created directory: ${dir}`);
        }
      } catch (mkdirErr) {
        Logger.error(`Failed to create directory: ${mkdirErr.message}`);
        reject(new Error(`无法创建缓存目录: ${mkdirErr.message}`));
        return;
      }

      // 清理任何现有的临时文件（处理权限问题）
      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
          Logger.info(`Cleaned up existing temp file: ${tempPath}`);
        } catch (err) {
          Logger.warn(`Could not remove existing temp file: ${err.message}`);
          // 如果无法删除，使用一个不同的临时文件名
          const timestamp = Date.now();
          const altTempPath = `${destPath}.${timestamp}.downloading`;
          Logger.info(`Using alternative temp path: ${altTempPath}`);
          return this._downloadFileWithTempPath(url, destPath, altTempPath, onProgress)
            .then(resolve)
            .catch(reject);
        }
      }

      return this._downloadFileWithTempPath(url, destPath, tempPath, onProgress)
        .then(resolve)
        .catch(reject);
    });
  }

  /**
   * 内部方法：使用指定的临时路径下载文件
   */
  async _downloadFileWithTempPath(url, destPath, tempPath, onProgress) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      
      const request = protocol.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 120000
      }, (response) => {
        // 处理重定向
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          Logger.info(`Redirect to: ${response.headers.location}`);
          this._downloadFile(response.headers.location, destPath, onProgress)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'], 10) || 0;
        let downloaded = 0;

        let file;
        try {
          file = fs.createWriteStream(tempPath);
        } catch (createErr) {
          Logger.error(`Failed to create write stream: ${createErr.message}`);
          reject(new Error(`无法创建文件: ${createErr.message}`));
          return;
        }

        response.on('data', (chunk) => {
          downloaded += chunk.length;
          if (totalSize > 0 && onProgress) {
            const percent = Math.round((downloaded / totalSize) * 100);
            onProgress({
              step: 'downloading',
              message: `下载中 ${(downloaded / 1024 / 1024).toFixed(1)}/${(totalSize / 1024 / 1024).toFixed(1)} MB (${percent}%)`,
              percent
            });
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close(() => {
            // 文件关闭后再进行重命名操作
            setImmediate(() => {
              try {
                // 确保源文件存在
                if (!fs.existsSync(tempPath)) {
                  reject(new Error(`临时文件不存在: ${tempPath}`));
                  return;
                }

                // 如果目标文件存在，先删除它
                if (fs.existsSync(destPath)) {
                  try {
                    fs.unlinkSync(destPath);
                  } catch (unlinkErr) {
                    Logger.warn(`Could not remove existing dest file: ${unlinkErr.message}`);
                  }
                }

                // 重命名临时文件为最终文件
                fs.renameSync(tempPath, destPath);
                Logger.info(`Download completed: ${destPath}`);
                resolve(destPath);
              } catch (err) {
                Logger.error(`Failed to rename temp file: ${err.message}`);
                // 尝试清理临时文件
                try {
                  if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                } catch (cleanupErr) {
                  Logger.warn(`Could not clean up temp file: ${cleanupErr.message}`);
                }
                reject(new Error(`保存文件失败: ${err.message}`));
              }
            });
          });
        });

        file.on('error', (err) => {
          Logger.error(`File write error: ${err.message}`);
          file.destroy();
          try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
          reject(new Error(`写入文件失败: ${err.message}`));
        });
      });

      request.on('error', (err) => {
        Logger.error(`Download error: ${err.message}`);
        try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
        reject(err);
      });

      request.on('timeout', () => {
        Logger.warn(`Download timeout for: ${url}`);
        request.destroy();
        try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
        reject(new Error('下载超时'));
      });
    });
  }

  /**
   * 下载 Git 安装包
   */
  async _downloadGitInstaller(onProgress) {
    const cacheDir = path.join(os.homedir(), '.openclaw-installer', 'cache');

    // 确保缓存目录存在
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
      Logger.info(`Created cache directory: ${cacheDir}`);
    }

    const destPath = path.join(cacheDir, 'Git-installer.exe');

    // 检查缓存
    if (fs.existsSync(destPath)) {
      const stats = fs.statSync(destPath);
      if (stats.size > 50 * 1024 * 1024) { // > 50MB
        Logger.info(`Using cached Git installer: ${destPath}`);
        return destPath;
      }
    }

    const urls = [
      'https://github.com/git-for-windows/git/releases/download/v2.49.0.windows.1/Git-2.49.0-64-bit.exe',
      'https://github.com/git-for-windows/git/releases/download/v2.48.1.windows.1/Git-2.48.1-64-bit.exe'
    ];

    for (const url of urls) {
      try {
        return await this._downloadFile(url, destPath, onProgress);
      } catch (err) {
        Logger.warn(`Failed to download from ${url}: ${err.message}`);
      }
    }

    throw new Error('所有下载源都失败了');
  }

  /**
   * 下载 Node.js 安装包
   */
  async _downloadNodeInstaller(onProgress) {
    const cacheDir = path.join(os.homedir(), '.openclaw-installer', 'cache');

    // 确保缓存目录存在
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
      Logger.info(`Created cache directory: ${cacheDir}`);
    }

    const destPath = path.join(cacheDir, 'NodeJS-installer.msi');

    // 检查缓存
    if (fs.existsSync(destPath)) {
      const stats = fs.statSync(destPath);
      if (stats.size > 25 * 1024 * 1024) { // > 25MB
        Logger.info(`Using cached Node.js installer: ${destPath}`);
        return destPath;
      }
    }

    const url = 'https://nodejs.org/dist/v22.22.1/node-v22.22.1-x64.msi';
    return await this._downloadFile(url, destPath, onProgress);
  }

  /**
   * 延迟
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ==================== 代理方法 ====================

  async installWsl(onProgress) {
    return await this.wslChecker.installWsl(onProgress);
  }

  async installNodeInWsl(onProgress) {
    return await this.wslChecker.installWslNode(onProgress);
  }
}

module.exports = DependencyChecker;
