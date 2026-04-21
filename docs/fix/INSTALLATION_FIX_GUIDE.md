# OpenClaw 安装管理器 - 依赖检测问题修复指南

## 问题描述

用户在其他电脑上安装 OpenClaw 时，安装管理器无法检测到已安装的 Node.js 和 Git，导致显示为未安装状态。

## 问题分析

经过分析，问题的主要原因是：

1. **PATH环境变量配置差异**：不同电脑的PATH配置可能与检测器预期不同
2. **安装路径多样性**：Node.js和Git可能安装在非标准位置
3. **检测逻辑不够健壮**：原检测器在某些环境下无法正确识别已安装的依赖

## 修复方案

### 1. 改进 DependencyChecker.js

将以下改进应用到 `src/main/services/dependency-checker.js` 中：

#### 1.1 增强 _execCommand 方法

```javascript
/**
 * 执行命令并返回结果（增强版）
 */
async _execCommand(cmd, args, timeout = 30000) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    // 构建更完整的环境变量，确保包含常见的 Node.js 和 Git 路径
    const env = { ...process.env };

    // 常见的 Node.js 和 Git 安装路径
    const extraPaths = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs'),
      path.join(os.homedir(), 'AppData', 'Roaming', 'npm'),
      path.join(os.homedir(), '.npm-global', 'bin'),
      'C:\\Program Files\\nodejs',
      'C:\\Program Files\\Git\\bin',
      'C:\\Program Files\\Git\\cmd',
      'C:\\Program Files (x86)\\Git\\bin',
      'C:\\Program Files (x86)\\Git\\cmd',
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Git', 'bin'),
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Git', 'cmd'),
      path.join(os.homedir(), 'scoop', 'shims'),
      'C:\\ProgramData\\chocolatey\\bin'
    ];

    // 将额外路径添加到现有PATH前面
    env.PATH = [...extraPaths, env.PATH].filter(p => p).join(path.delimiter);

    const child = spawn(cmd, args, {
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
      env: env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

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
          success: code === 0 || stdout.trim().length > 0, // 对于版本命令，有输出就认为成功
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
```

#### 1.2 增强 _checkNode 方法

```javascript
/**
 * 检测 Node.js（增强版）
 */
async _checkNode() {
  if (this._cache.node !== null) {
    return this._cache.node;
  }

  Logger.info('[_checkNode] Starting enhanced detection...');

  const result = { installed: false, version: null, satisfies: false };

  // 方法1: 直接运行 node --version
  try {
    const execResult = await this._execCommand('node', ['--version']);
    if (execResult.success && execResult.stdout) {
      const version = execResult.stdout.replace(/^v/, '').trim();
      const major = parseInt(version.split('.')[0], 10);
      result.installed = true;
      result.version = version;
      result.satisfies = major >= 18;
      result.path = execResult.path;
      Logger.info(`[_checkNode] Found via command: v${version}`);
      this._cache.node = result;
      return result;
    }
  } catch (err) {
    Logger.warn(`[_checkNode] Method 1 failed: ${err.message}`);
  }

  // 方法2: 使用 where/which 查找
  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    const whichResult = await this._execCommand(whichCmd, ['node']);
    if (whichResult.success && whichResult.stdout) {
      const nodePath = process.platform === 'win32'
        ? whichResult.stdout.trim().split('\n')[0].trim()
        : whichResult.stdout.trim();

      if (nodePath && fs.existsSync(nodePath)) {
        const versionResult = await this._execCommand(nodePath, ['--version']);
        if (versionResult.success && versionResult.stdout) {
          const version = versionResult.stdout.replace(/^v/, '').trim();
          const major = parseInt(version.split('.')[0], 10);
          result.installed = true;
          result.version = version;
          result.satisfies = major >= 18;
          result.path = nodePath;
          Logger.info(`[_checkNode] Found via which/where: v${version}`);
          this._cache.node = result;
          return result;
        }
      }
    }
  } catch (err) {
    Logger.warn(`[_checkNode] Method 2 failed: ${err.message}`);
  }

  // 方法3: 检查扩展的常见安装路径
  const extendedNodePaths = [
    // 标准安装路径
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs', 'node.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'nodejs', 'node.exe'),
    path.join(process.env.APPDATA || '', 'npm', 'node.exe'),

    // 用户级安装
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node.exe'),
    path.join(os.homedir(), '.npm-global', 'bin', 'node.exe'),

    // 版本管理器安装路径
    path.join(os.homedir(), '.nvm', 'versions', 'node'),
    path.join(os.homedir(), '.volta', 'bin', 'node'),
    path.join(os.homedir(), '.fnm', 'node-versions')
  ];

  for (const nodePath of extendedNodePaths) {
    if (fs.existsSync(nodePath)) {
      // 如果是目录，检查其中的node.exe
      if (fs.statSync(nodePath).isDirectory()) {
        const nodeExePath = path.join(nodePath, 'node.exe');
        if (fs.existsSync(nodeExePath)) {
          const versionResult = await this._execCommand(nodeExePath, ['--version']);
          if (versionResult.success && versionResult.stdout) {
            const version = versionResult.stdout.replace(/^v/, '').trim();
            const major = parseInt(version.split('.')[0], 10);
            result.installed = true;
            result.version = version;
            result.satisfies = major >= 18;
            result.path = nodeExePath;
            Logger.info(`[_checkNode] Found at common path: v${version}`);
            this._cache.node = result;
            return result;
          }
        }
      } else {
        // 如果是文件，直接测试
        const versionResult = await this._execCommand(nodePath, ['--version']);
        if (versionResult.success && versionResult.stdout) {
          const version = versionResult.stdout.replace(/^v/, '').trim();
          const major = parseInt(version.split('.')[0], 10);
          result.installed = true;
          result.version = version;
          result.satisfies = major >= 18;
          result.path = nodePath;
          Logger.info(`[_checkNode] Found at common path: v${version}`);
          this._cache.node = result;
          return result;
        }
      }
    }
  }

  Logger.warn('[_checkNode] Node.js NOT FOUND after all methods');
  this._cache.node = result;
  return result;
}
```

#### 1.3 增强 _checkGit 方法

```javascript
/**
 * 检测 Git（增强版）
 */
async _checkGit() {
  if (this._cache.git !== null) {
    return this._cache.git;
  }

  Logger.info('[_checkGit] Starting enhanced detection...');

  const result = { installed: false, version: null, path: null };

  // 方法1: 直接运行 git --version
  try {
    const execResult = await this._execCommand('git', ['--version']);
    if (execResult.success && execResult.stdout) {
      const match = execResult.stdout.match(/git version (\d+\.\d+\.\d+)/i);
      if (match) {
        result.installed = true;
        result.version = match[1];
        result.path = execResult.path || 'git';
        Logger.info(`[_checkGit] Found via command: v${result.version}`);
        this._cache.git = result;
        return result;
      }
    }
  } catch (err) {
    Logger.warn(`[_checkGit] Method 1 failed: ${err.message}`);
  }

  // 方法2: 使用 where 查找
  try {
    const whereResult = await this._execCommand('where', ['git']);
    if (whereResult.success && whereResult.stdout) {
      const gitPaths = whereResult.stdout.trim().split(/\r?\n/).filter(p => p.trim());
      Logger.info(`[_checkGit] where found ${gitPaths.length} path(s)`);

      for (const gitPath of gitPaths) {
        const trimmedPath = gitPath.trim();
        if (fs.existsSync(trimmedPath)) {
          const versionResult = await this._execCommand(trimmedPath, ['--version']);
          if (versionResult.success && versionResult.stdout) {
            const match = versionResult.stdout.match(/git version (\d+\.\d+\.\d+)/i);
            if (match) {
              result.installed = true;
              result.version = match[1];
              result.path = trimmedPath;
              Logger.info(`[_checkGit] Found via where: v${result.version} at ${trimmedPath}`);
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

  // 方法3: 检查扩展的常见安装路径
  const extendedGitPaths = [
    // 标准 Git for Windows 安装路径
    'C:\\Program Files\\Git\\bin\\git.exe',
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files (x86)\\Git\\bin\\git.exe',
    'C:\\Program Files (x86)\\Git\\cmd\\git.exe',

    // 用户级安装
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Git', 'bin', 'git.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Git', 'cmd', 'git.exe'),

    // Scoop 安装
    path.join(os.homedir(), 'scoop', 'shims', 'git.exe'),
    path.join(os.homedir(), 'scoop', 'apps', 'git', 'current', 'bin', 'git.exe'),
    path.join(os.homedir(), 'scoop', 'apps', 'git', 'current', 'cmd', 'git.exe'),

    // Chocolatey 安装
    'C:\\ProgramData\\chocolatey\\bin\\git.exe',
    'C:\\Chocolatey\\bin\\git.exe',

    // 其他可能路径
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'git.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'cmd', 'git.exe')
  ];

  for (const gitPath of extendedGitPaths) {
    if (fs.existsSync(gitPath)) {
      Logger.info(`[_checkGit] Checking path: ${gitPath}`);
      try {
        const versionResult = await this._execCommand(gitPath, ['--version']);
        if (versionResult.success && versionResult.stdout) {
          const match = versionResult.stdout.match(/git version (\d+\.\d+\.\d+)/i);
          if (match) {
            result.installed = true;
            result.version = match[1];
            result.path = gitPath;
            Logger.info(`[_checkGit] Found at common path: v${result.version}`);
            this._cache.git = result;
            return result;
          }
        }
      } catch (err) {
        Logger.warn(`[_checkGit] Path ${gitPath} failed: ${err.message}`);
      }
    }
  }

  // 方法4: 从注册表查找（Windows）
  if (process.platform === 'win32') {
    const registryKeys = [
      'HKLM\\SOFTWARE\\GitForWindows',
      'HKCU\\SOFTWARE\\GitForWindows',
      'HKLM\\SOFTWARE\\Wow6432Node\\GitForWindows'
    ];

    for (const regKey of registryKeys) {
      try {
        const regResult = await this._execCommand('reg', ['query', regKey, '/v', 'InstallPath']);
        if (regResult.success && regResult.stdout) {
          const match = regResult.stdout.match(/InstallPath\s+REG_\w+\s+(.+)/i);
          if (match) {
            const installPath = match[1].trim();
            const gitBinPath = path.join(installPath, 'bin', 'git.exe');
            const gitCmdPath = path.join(installPath, 'cmd', 'git.exe');

            // 检查 bin 和 cmd 目录
            for (const gitPath of [gitBinPath, gitCmdPath]) {
              if (fs.existsSync(gitPath)) {
                const versionResult = await this._execCommand(gitPath, ['--version']);
                if (versionResult.success && versionResult.stdout) {
                  const verMatch = versionResult.stdout.match(/git version (\d+\.\d+\.\d+)/i);
                  if (verMatch) {
                    result.installed = true;
                    result.version = verMatch[1];
                    result.path = gitPath;
                    Logger.info(`[_checkGit] Found via registry: v${result.version} at ${gitPath}`);
                    this._cache.git = result;
                    return result;
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        Logger.warn(`[_checkGit] Registry ${regKey} failed: ${err.message}`);
      }
    }
  }

  Logger.warn('[_checkGit] Git NOT FOUND after all methods');
  this._cache.git = result;
  return result;
}
```

### 2. 额外的改进措施

#### 2.1 创建诊断工具

创建 `diagnose-env.js` 作为环境诊断工具：

```javascript
// 参考上面创建的 diagnose-env.js 文件
```

#### 2.2 改进错误处理和用户提示

在检测失败时提供更清晰的错误信息和解决建议：

```javascript
// 在检测失败时提供更详细的错误信息
if (!dependency.installed) {
  Logger.warn(`Dependency ${depName} not found. Possible solutions:`);
  Logger.warn(`1. Ensure ${depName} is installed and in system PATH`);
  Logger.warn(`2. Restart your terminal/IDE to reload PATH variables`);
  Logger.warn(`3. Manually add ${depName} installation directory to PATH`);
  Logger.warn(`4. Run this application as administrator if needed`);
}
```

## 部署说明

1. 更新 `src/main/services/dependency-checker.js` 文件
2. 测试在不同环境下的依赖检测能力
3. 确保打包后的应用能够正确检测已安装的依赖
4. 更新相关文档和故障排除指南

## 验证步骤

1. 在干净的虚拟机或容器中测试安装流程
2. 确保检测器能够识别各种安装方式的 Node.js 和 Git
3. 验证在不同PATH配置下的检测准确性
4. 测试在不同用户权限级别下的运行情况