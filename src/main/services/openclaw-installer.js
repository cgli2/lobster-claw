const ShellExecutor = require('../utils/shell-executor');
const OnboardConfigWriter = require('./onboard-config-writer');
const Logger = require('../utils/logger');
const { getNpmPrefix } = require('../utils/paths');
const { network, timeouts } = require('../config/defaults');
const fs = require('fs');
const path = require('path');
const os = require('os');

class OpenClawInstaller {
  constructor() {
    this.configWriter = new OnboardConfigWriter();
  }

  _generateUUID() {
    // Simple UUID v4 generator for older Node.js versions
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  async getVersion() {
    try {
      const mode = ShellExecutor.getExecutionMode();
      Logger.info('getVersion - execution mode: ' + mode);
      Logger.info('getVersion - checking if OpenClaw is installed...');

      // 第一步：检查安装目录（最可靠的指标）
      const isInstalled = await ShellExecutor.checkOpenClawInstalled();
      Logger.info('getVersion - checkOpenClawInstalled result: ' + isInstalled);

      if (!isInstalled) {
        Logger.warn('getVersion - OpenClaw not installed (config directory missing)');
        return null;
      }

      // 第二步：尝试通过命令获取版本（最准确，反映实际安装的版本）
      Logger.info('getVersion - Trying to get version via command...');
      let output = null;

      if (mode === 'wsl') {
        // WSL 模式
        const result = await ShellExecutor.runCommand('wsl', ['--exec', 'bash', '-c',
          'export LANG=zh_CN.UTF-8 LC_ALL=zh_CN.UTF-8 && export PATH="$HOME/.npm-global/bin:$PATH" && openclaw --version'], {
          forceNative: true, timeout: 15000
        });
        output = (result.stdout || '') + (result.stderr || '');
      } else {
        // Windows 原生模式：使用完整路径执行，避免 PATH 问题
        const openclawPath = await ShellExecutor._findOpenClawExecutable();
        if (openclawPath) {
          Logger.info('getVersion - Found executable at: ' + openclawPath);
          try {
            const result = await ShellExecutor.runCommand(openclawPath, ['--version'], { timeout: 15000 });
            output = (result.stdout || '') + (result.stderr || '');
          } catch (e) {
            Logger.warn('getVersion - Failed to execute openclaw --version: ' + e.message);
          }
        } else {
          // 如果找不到可执行文件，尝试直接运行命令
          try {
            const result = await ShellExecutor.runCommand('openclaw', ['--version'], { timeout: 15000 });
            output = (result.stdout || '') + (result.stderr || '');
          } catch (e) {
            Logger.warn('getVersion - openclaw command failed: ' + e.message);
          }
        }
      }

      // 第三步：解析输出中的版本号
      if (output) {
        // 检查是否包含错误信息
        if (output.includes('Error') || output.includes('error') ||
            output.includes('not found') || output.includes('不是内部或外部命令')) {
          Logger.warn('getVersion - Command returned error: ' + output);
        } else {
          // openclaw may output "openclaw vX.Y.Z" or just "X.Y.Z"
          const match = output.match(/(\d+\.\d+\.\d+)/);
          if (match && match[1]) {
            Logger.info('getVersion - Successfully detected version from command: ' + match[1]);
            return match[1];
          }
        }
      }

      // 第四步：尝试从配置文件读取版本（作为后备方案）
      Logger.info('getVersion - Reading version from config file as fallback...');
      const homeDir = os.homedir();
      const configPath = path.join(homeDir, '.openclaw', 'openclaw.json');

      try {
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          // 尝试多个可能的版本字段
          const version = config.app?.version || config.version || config.meta?.lastTouchedVersion;
          if (version) {
            Logger.info('getVersion - Successfully read version from config: ' + version);
            return version;
          }
        }
      } catch (err) {
        Logger.warn('getVersion - Failed to read version from config: ' + err.message);
      }

      // 如果所有方法都失败，但配置目录存在，假设已安装
      Logger.warn('getVersion - Could not determine version, but OpenClaw seems installed');
      return 'unknown';
    } catch (err) {
      Logger.error('getVersion failed: ' + err.message);
      Logger.error('getVersion stack: ' + err.stack);
      return null;
    }
  }

  async install(onProgress, installDir) {
    onProgress({ step: 'start', message: '准备安装 OpenClaw...', percent: 5 });

    try {
      const mode = ShellExecutor.getExecutionMode();

      if (mode === 'wsl') {
        // WSL: Run everything in one bash session so npm config takes effect immediately
        onProgress({ step: 'npm-config', message: '配置 npm 并安装...', percent: 10 });
        
        // 创建 Windows 临时脚本文件，然后通过 WSL 执行
        const winTempDir = os.tmpdir();
        const scriptFileName = `openclaw-install-${Date.now()}.sh`;
        const winScriptPath = path.join(winTempDir, scriptFileName);
        
        // 脚本内容 - 使用单引号字符串避免转义问题
        // 配置 git 使用 HTTPS 代替 SSH，避免 GitHub 权限问题
        // 注意：不使用 set -e，而是显式检查每个命令的退出码
        const scriptContent = '#!/bin/bash\n' +
          'set -x\n' +
          'export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n' +
          'USER_NAME=$(whoami)\n' +
          'HOME_DIR=$(eval echo ~$USER_NAME)\n' +
          'export HOME=$HOME_DIR\n' +
          'echo "Using HOME=$HOME"\n' +
          '# 强制 git 使用 HTTPS 而不是 SSH\n' +
          'git config --global url."https://github.com/".insteadOf "git@github.com:"\n' +
          'git config --global url."https://".insteadOf "git://"\n' +
          '# 创建 wrapper 脚本强制 git 使用 HTTPS\n' +
          'mkdir -p "$HOME/.local/bin"\n' +
          'cat > "$HOME/.local/bin/git" << \'EOF\'\n' +
          '#!/bin/bash\n' +
          '/usr/bin/git -c url."https://github.com/".insteadOf="git@github.com:" "$@"\n' +
          'EOF\n' +
          'chmod +x "$HOME/.local/bin/git"\n' +
          'export PATH="$HOME/.local/bin:$PATH"\n' +
          'echo "Git config:"\n' +
          'git config --global --get-regexp url\n' +
          'mkdir -p "$HOME/.npm-global" || { echo "ERROR: Failed to create .npm-global directory"; exit 1; }\n' +
          'npm config set prefix "$HOME/.npm-global" || { echo "ERROR: Failed to set npm prefix"; exit 1; }\n' +
          'export PATH="$HOME/.npm-global/bin:$PATH"\n' +
          'echo "PATH=$PATH"\n' +
          'which npm\n' +
          'npm --version\n' +
          'echo "Starting npm install..."\n' +
          'npm install -g openclaw@latest 2>&1 || { echo "ERROR: npm install failed with code $?"; exit 1; }\n' +
          'echo "NPM install exit code: $?"\n' +
          'echo "Checking npm global packages..."\n' +
          'npm list -g --depth=0 2>&1\n' +
          'echo "Checking .npm-global/bin directory..."\n' +
          'ls -la "$HOME/.npm-global/bin/" 2>&1 || echo "WARNING: .npm-global/bin directory not found"\n' +
          'echo "Checking if openclaw command exists..."\n' +
          'which openclaw 2>&1 || echo "WARNING: openclaw not found in PATH"\n' +
          'echo "Trying openclaw --version..."\n' +
          'openclaw --version 2>&1 || echo "ERROR: openclaw --version failed"\n' +
          'echo "SUCCESS: Installation completed"\n';
        
        // 写入 Windows 临时目录
        fs.writeFileSync(winScriptPath, scriptContent, 'utf8');
        Logger.info('Install script written to: ' + winScriptPath);
        
        // 转换为 WSL 路径并执行
        const wslScriptPath = '/mnt/' + winTempDir.replace(/\\/g, '/').replace(/^([a-zA-Z]):/, '$1').toLowerCase() + '/' + scriptFileName;
        Logger.info('WSL script path: ' + wslScriptPath);
        
        let lastPercent = 10;
        const exitCode = await ShellExecutor.streamCommand(
          'wsl', ['--', 'bash', wslScriptPath],
          (line) => {
            Logger.info('npm install: ' + line);
            lastPercent = Math.min(lastPercent + 1, 85);
            onProgress({ step: 'npm-install', message: line, percent: lastPercent });
          },
          (errLine) => {
            Logger.warn('npm install stderr: ' + errLine);
            lastPercent = Math.min(lastPercent + 1, 85);
            onProgress({ step: 'npm-install', message: errLine, percent: lastPercent });
          },
          { timeout: 1800000, forceNative: true }
        );
        
        // 清理临时文件
        try {
          fs.unlinkSync(winScriptPath);
        } catch (e) {
          Logger.warn('Failed to cleanup temp script: ' + e.message);
        }

        if (exitCode !== 0) {
          throw new Error(`npm install 返回退出码 ${exitCode}`);
        }
      } else {
        // Windows native mode
        onProgress({ step: 'npm-install', message: '执行 npm install -g openclaw@latest ...', percent: 10 });
        
        // 优先使用用户选择的安装目录；未指定则回退到 ~/.npm-global
        const userProfile = process.env.USERPROFILE || process.env.HOME;
        const npmGlobalPath = installDir || path.join(userProfile, '.npm-global');
        
        // Step 0: 清理可能残留的旧版本文件（解决 EBUSY 问题）
        onProgress({ step: 'cleanup', message: '清理旧版本文件...', percent: 8 });
        try {
          const openclawCmdPath = path.join(npmGlobalPath, 'openclaw.cmd');
          const openclawPs1Path = path.join(npmGlobalPath, 'openclaw.ps1');
          const openclawBinDir = path.join(npmGlobalPath, 'node_modules', '.bin');
          const openclawModuleDir = path.join(npmGlobalPath, 'node_modules', 'openclaw');
          
          // 删除旧的 wrapper 文件
          if (fs.existsSync(openclawCmdPath)) {
            try {
              fs.unlinkSync(openclawCmdPath);
              Logger.info('Removed old openclaw.cmd');
            } catch (e) {
              Logger.warn('Failed to remove openclaw.cmd (may be in use): ' + e.message);
            }
          }
          if (fs.existsSync(openclawPs1Path)) {
            try {
              fs.unlinkSync(openclawPs1Path);
              Logger.info('Removed old openclaw.ps1');
            } catch (e) {
              Logger.warn('Failed to remove openclaw.ps1 (may be in use): ' + e.message);
            }
          }
          
          // 删除 .bin 目录下的 openclaw* 文件
          if (fs.existsSync(openclawBinDir)) {
            const binFiles = fs.readdirSync(openclawBinDir);
            for (const file of binFiles) {
              if (file.startsWith('openclaw')) {
                const filePath = path.join(openclawBinDir, file);
                try {
                  fs.unlinkSync(filePath);
                  Logger.info('Removed bin file: ' + filePath);
                } catch (e) {
                  Logger.warn('Failed to remove ' + file + ': ' + e.message);
                }
              }
            }
          }
          
          // 如果 .bin 目录为空，删除它以便 npm 可以重新创建
          if (fs.existsSync(openclawBinDir)) {
            const remainingFiles = fs.readdirSync(openclawBinDir);
            if (remainingFiles.length === 0) {
              try {
                fs.rmdirSync(openclawBinDir);
                Logger.info('Removed empty .bin directory');
              } catch (e) {
                Logger.warn('Failed to remove .bin directory: ' + e.message);
              }
            }
          }
          
          // 删除 openclaw 模块目录（如果存在），强制 npm 重新安装
          if (fs.existsSync(openclawModuleDir)) {
            try {
              fs.rmSync(openclawModuleDir, { recursive: true, force: true });
              Logger.info('Removed openclaw module directory');
            } catch (e) {
              Logger.warn('Failed to remove openclaw module directory: ' + e.message);
            }
          }
        } catch (e) {
          Logger.warn('Cleanup failed (non-fatal): ' + e.message);
        }
        
        // 先设置 npm prefix
        try {
          await ShellExecutor.runCommand('npm', ['config', 'set', 'prefix', npmGlobalPath, '--global'], { timeout:30000 });
          Logger.info('Windows npm prefix set to: ' + npmGlobalPath);
        } catch (e) {
          Logger.warn('Failed to set npm prefix: ' + e.message);
        }

        let lastPercent = 10;
        const exitCode = await ShellExecutor.streamCommand(
          'npm', ['install', '-g', 'openclaw@latest'],
          (line) => {
            lastPercent = Math.min(lastPercent + 1, 70);
            onProgress({ step: 'npm-install', message: line, percent: lastPercent });
          },
          (errLine) => {
            if (!errLine.includes('WARN')) {
              Logger.warn('npm install stderr: ' + errLine);
            }
            lastPercent = Math.min(lastPercent + 1, 70);
            onProgress({ step: 'npm-install', message: errLine, percent: lastPercent });
          },
          { timeout: 1800000 }
        );

        if (exitCode !== 0) {
          throw new Error(`npm install 返回退出码 ${exitCode}`);
        }
      }

      // Step 2: Create config directory and write ALL necessary config files
      onProgress({ step: 'config-dir', message: '创建配置目录结构...', percent: 75 });
      await this.configWriter.createConfigDir();
      
      // Create agent directory structure
      onProgress({ step: 'config-dir', message: '创建 Agent 目录结构...', percent: 76 });
      await this._createAgentDirectories();
      
      // Write default config with gateway.mode=local (required for gateway to start)
      onProgress({ step: 'config-write', message: '写入默认配置...', percent: 77 });
      try {
        const defaultToken = crypto.randomUUID ? crypto.randomUUID() : this._generateUUID();
        await this.configWriter.writeConfig({
          version: 1,
          gateway: {
            mode: 'local',
            port: network.gatewayPort,
            bind: network.gatewayBind,
            auth: {
              mode: 'token',
              token: defaultToken
            }
          },
          models: { 
            providers: {},
            default: null
          },
          agents: {
            list: [{ id: 'main' }]
          },
          env: {
            vars: {}
          },
          commands: {
            native: 'auto',
            nativeSkills: 'auto',
            restart: true,
            ownerDisplay: 'raw'
          },
          meta: {
            createdBy: 'OpenClawInstaller',
            createdAt: new Date().toISOString()
          }
        });
        Logger.info('Default config written with gateway token for native mode');
      } catch (err) {
        Logger.warn('Failed to write default config: ' + err.message);
      }
      
      // Step 2b: Create ALL necessary config files to prevent runtime errors
      onProgress({ step: 'config-write', message: '创建必要的配置文件...', percent: 78 });
      try {
        await this._createAllConfigFiles();
        Logger.info('All necessary config files created');
      } catch (err) {
        Logger.warn('Failed to create some config files: ' + err.message);
      }

      // Step 2c: 将用户选择的安装目录写入 .env（OPENCLAW_NPM_PREFIX）
      // 后续所有路径查找都会读取此变量，避免硬编码
      if (installDir) {
        try {
          const EnvManager = require('./env-manager');
          const envMgr = new EnvManager();
          const existingEnv = await envMgr.read();
          existingEnv['OPENCLAW_NPM_PREFIX'] = installDir;
          await envMgr.write(existingEnv);
          // 同时注入当前进程环境，让本次会话后续调用也能立即生效
          process.env.OPENCLAW_NPM_PREFIX = installDir;
          Logger.info('OpenClawInstaller: OPENCLAW_NPM_PREFIX=' + installDir + ' written to .env');
        } catch (envErr) {
          Logger.warn('OpenClawInstaller: failed to write OPENCLAW_NPM_PREFIX to .env: ' + envErr.message);
        }
      }

      // Step 3: Start gateway process (foreground mode, managed by ServiceController)
      onProgress({ step: 'gateway-start', message: '启动 Gateway 服务...', percent: 80 });
      try {
        const ServiceController = require('./service-controller');
        const svc = new ServiceController();
        // 设置更长的超时时间，因为健康检查需要最多15秒
        const gwResult = await Promise.race([
          svc.start(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('启动超时')), timeouts.startTimeout))
        ]);
        if (gwResult.success) {
          onProgress({ step: 'gateway-start', message: gwResult.output, percent: 90 });
        } else {
          Logger.warn('Gateway start: ' + gwResult.output);
          onProgress({ step: 'gateway-start', message: 'Gateway 暂未就绪，可稍后在管理面板中启动', percent: 88 });
        }
      } catch (err) {
        Logger.warn('Gateway start failed (non-fatal): ' + err.message);
        onProgress({ step: 'gateway-start', message: 'Gateway 启动跳过（可稍后在管理面板中启动）', percent: 88 });
      }

      // Step 4: Verify installation
      onProgress({ step: 'verify', message: '验证安装结果...', percent: 92 });

      const version = await this.getVersion();
      if (!version) {
        throw new Error('安装验证失败: 无法获取 OpenClaw 版本号，请检查安装日志');
      }
      onProgress({ step: 'verify', message: `OpenClaw 版本: v${version}`, percent: 94 });

      // Step 4b: Verify all config files exist
      onProgress({ step: 'verify', message: '验证配置文件完整性...', percent: 96 });
      const verifyResult = await this.verifyInstallation();
      if (!verifyResult.success) {
        Logger.warn('Config files verification failed: ' + verifyResult.message);
        onProgress({ step: 'verify', message: `警告: ${verifyResult.message}`, percent: 97 });
      } else {
        Logger.info('All config files verified successfully');
        onProgress({ step: 'verify', message: '所有配置文件已就绪', percent: 97 });
      }

      // 补全 extensions 目录下缺少的 README.md（避免 AI 读取时报 ENOENT）
      this._ensureExtensionReadmes();

      onProgress({ step: 'done', message: `OpenClaw v${version} 安装成功！所有配置文件已预生成。`, percent: 100 });
    } catch (err) {
      Logger.error('OpenClaw install failed: ' + err.message);
      throw new Error('OpenClaw 安装失败: ' + err.message);
    }
  }

  async update(onProgress) {
    onProgress({ step: 'start', message: '准备更新 OpenClaw...', percent: 5 });

    try {
      const oldVersion = await this.getVersion();
      const mode = ShellExecutor.getExecutionMode();

      if (mode === 'wsl') {
        // WSL: Run in one bash session using temp script file
        const winTempDir = os.tmpdir();
        const scriptFileName = `openclaw-update-${Date.now()}.sh`;
        const winScriptPath = path.join(winTempDir, scriptFileName);
        
        const scriptContent = '#!/bin/bash\n' +
          'export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n' +
          'USER_NAME=$(whoami)\n' +
          'HOME_DIR=$(eval echo ~$USER_NAME)\n' +
          'export HOME=$HOME_DIR\n' +
          'git config --global url."https://github.com/".insteadOf "git@github.com:"\n' +
          'git config --global url."https://".insteadOf "git://"\n' +
          'mkdir -p "$HOME/.npm-global" || { echo "ERROR: Failed to create .npm-global directory"; exit 1; }\n' +
          'npm config set prefix "$HOME/.npm-global" || { echo "ERROR: Failed to set npm prefix"; exit 1; }\n' +
          'export PATH="$HOME/.npm-global/bin:$PATH"\n' +
          'npm install -g openclaw@latest || { echo "ERROR: npm install failed with code $?"; exit 1; }\n' +
          'echo "SUCCESS: Update completed"\n';
        
        fs.writeFileSync(winScriptPath, scriptContent, 'utf8');
        const wslScriptPath = '/mnt/' + winTempDir.replace(/\\/g, '/').replace(/^([a-zA-Z]):/, '$1').toLowerCase() + '/' + scriptFileName;
        
        let lastPercent = 15;
        const exitCode = await ShellExecutor.streamCommand(
          'wsl', ['--', 'bash', wslScriptPath],
          (line) => {
            lastPercent = Math.min(lastPercent + 2, 85);
            onProgress({ step: 'updating', message: line, percent: lastPercent });
          },
          (errLine) => {
            lastPercent = Math.min(lastPercent + 1, 85);
            onProgress({ step: 'updating', message: errLine, percent: lastPercent });
          },
          { timeout: 1800000, forceNative: true }
        );
        
        // 清理临时文件
        try {
          fs.unlinkSync(winScriptPath);
        } catch (e) {
          Logger.warn('Failed to cleanup temp script: ' + e.message);
        }

        if (exitCode !== 0) {
          throw new Error(`npm install 返回退出码 ${exitCode}`);
        }
      } else {
        // Windows native
        let lastPercent = 15;
        const exitCode = await ShellExecutor.streamCommand(
          'npm', ['install', '-g', 'openclaw@latest'],
          (line) => {
            lastPercent = Math.min(lastPercent + 2, 85);
            onProgress({ step: 'updating', message: line, percent: lastPercent });
          },
          (errLine) => {
            lastPercent = Math.min(lastPercent + 1, 85);
            onProgress({ step: 'updating', message: errLine, percent: lastPercent });
          },
          { timeout: 1800000 }
        );

        if (exitCode !== 0) {
          throw new Error(`npm install 返回退出码 ${exitCode}`);
        }
      }

      onProgress({ step: 'verify', message: '验证更新结果...', percent: 90 });

      const newVersion = await this.getVersion();

      // 补全 extensions 目录下缺少的 README.md
      this._ensureExtensionReadmes();

      if (newVersion && oldVersion && newVersion !== oldVersion) {
        onProgress({ step: 'done', message: `已从 v${oldVersion} 更新到 v${newVersion}`, percent: 100 });
      } else if (newVersion) {
        onProgress({ step: 'done', message: `当前已是最新版本 v${newVersion}`, percent: 100 });
      } else {
        onProgress({ step: 'done', message: '更新完成', percent: 100 });
      }
    } catch (err) {
      Logger.error('OpenClaw update failed: ' + err.message);
      throw new Error('更新失败: ' + err.message);
    }
  }

  /**
   * 补全 openclaw extensions 目录下缺少的 README.md 文件
   *
   * 背景：部分 extension（如 feishu、slack、telegram 等）发布时没有带 README.md，
   * 但 openclaw 运行时的 read 工具在被 AI 调用时会尝试读取该文件，
   * 导致 "[tools] read failed: ENOENT" 错误出现在对话界面。
   * 这里在安装/更新完成后自动为缺失的 extension 补建占位 README.md。
   */
  _ensureExtensionReadmes() {
    try {
      const npmPrefix = this._getNpmPrefix();
      if (!npmPrefix) return;

      const extDir = path.join(npmPrefix, 'node_modules', 'openclaw', 'extensions');
      if (!fs.existsSync(extDir)) return;

      const entries = fs.readdirSync(extDir, { withFileTypes: true });
      let created = 0;

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const readmePath = path.join(extDir, entry.name, 'README.md');
        if (fs.existsSync(readmePath)) continue;

        // 写入最小化 README，让 AI read 工具不再报 ENOENT
        const content = `# ${entry.name}\n\n${entry.name} extension for OpenClaw.\n`;
        try {
          fs.writeFileSync(readmePath, content, 'utf-8');
          created++;
          Logger.info(`OpenClawInstaller: created missing README.md for extension "${entry.name}"`);
        } catch (writeErr) {
          Logger.warn(`OpenClawInstaller: failed to create README.md for "${entry.name}": ${writeErr.message}`);
        }
      }

      if (created > 0) {
        Logger.info(`OpenClawInstaller: created ${created} missing README.md files in extensions dir`);
      }
    } catch (err) {
      // 非致命错误，仅记录警告
      Logger.warn('OpenClawInstaller: _ensureExtensionReadmes failed: ' + err.message);
    }
  }

  /**
   * 获取 npm global prefix 路径。
   * 优先读取 .env 中 OPENCLAW_NPM_PREFIX（用户在安装时自定义的目录），
   * 再通过 `npm config get prefix` 动态查询，最后回退默认值。
   */
  _getNpmPrefix() {
    // 1. 优先从 .env / 进程环境变量读取用户自定义路径
    const custom = getNpmPrefix();
    if (custom && custom !== path.join(os.homedir(), '.npm-global')) {
      // 非默认值，说明用户确实设置过
      return custom;
    }
    // 2. 通过 npm config get prefix 获取当前实际值
    try {
      const { execSync } = require('child_process');
      const prefix = execSync('npm config get prefix', { encoding: 'utf8', timeout: 5000 }).trim();
      if (prefix && prefix !== 'undefined') return prefix;
    } catch (_) { /* ignore */ }
    // 3. 最终回退：返回 getNpmPrefix() 的默认值（~/.npm-global）
    return custom;
  }

  async setMirror(useMirror) {
    try {
      const registry = useMirror ? 'https://registry.npmmirror.com' : 'https://registry.npmjs.org';
      const mode = ShellExecutor.getExecutionMode();

      if (mode === 'wsl') {
        await ShellExecutor.runCommand('wsl', ['--exec', 'bash', '-c', `npm config set registry ${registry}`], {
          timeout: 30000, forceNative: true
        });
      } else {
        await ShellExecutor.runCommand('npm', ['config', 'set', 'registry', registry], { timeout: 30000 });
      }
      Logger.info('npm registry set to: ' + registry);
      return { success: true, registry };
    } catch (err) {
      Logger.error('Set mirror failed: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * Create agent directory structure
   */
  async _createAgentDirectories() {
    const { OPENCLAW_HOME } = require('../utils/paths');
    const mode = ShellExecutor.getExecutionMode();
    const agentId = 'main';
    
    if (mode === 'wsl') {
      // WSL: Use bash commands
      const paths = require('../utils/paths').getPathsForMode('wsl');
      const agentDir = `${paths.OPENCLAW_HOME}/agents/${agentId}/agent`;
      const workspaceDir = `${paths.OPENCLAW_HOME}/agents/${agentId}/workspace`;
      const logsDir = `${paths.OPENCLAW_HOME}/logs`;
      const backupDir = `${paths.OPENCLAW_HOME}/config-backups`;
      
      await ShellExecutor.runCommand('wsl', ['--exec', 'bash', '-c', `mkdir -p "${agentDir}" "${workspaceDir}" "${logsDir}" "${backupDir}"`], {
        timeout: 30000, forceNative: true
      });
    } else {
      // Windows native
      const path = require('path');
      const agentDir = path.join(OPENCLAW_HOME, 'agents', agentId, 'agent');
      const workspaceDir = path.join(OPENCLAW_HOME, 'agents', agentId, 'workspace');
      const logsDir = path.join(OPENCLAW_HOME, 'logs');
      const backupDir = path.join(OPENCLAW_HOME, 'config-backups');
      
      [agentDir, workspaceDir, logsDir, backupDir].forEach(dir => {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      });
    }
    Logger.info('Agent directories created');
  }

  /**
   * Create ALL necessary config files to prevent runtime errors
   * This ensures auth-profiles.json and other files exist before first run
   */
  async _createAllConfigFiles() {
    const { OPENCLAW_HOME } = require('../utils/paths');
    const mode = ShellExecutor.getExecutionMode();
    const agentId = 'main';
    const path = require('path');
    
    // Define all config files that need to be created
    const configFiles = [
      {
        path: mode === 'wsl' 
          ? `$HOME/.openclaw/agents/${agentId}/agent/auth-profiles.json`
          : path.join(OPENCLAW_HOME, 'agents', agentId, 'agent', 'auth-profiles.json'),
        content: JSON.stringify({ version: 1, profiles: {} }, null, 2),
        description: 'Auth profiles'
      },
      {
        path: mode === 'wsl'
          ? `$HOME/.openclaw/agents/${agentId}/agent/models.json`
          : path.join(OPENCLAW_HOME, 'agents', agentId, 'agent', 'models.json'),
        content: JSON.stringify({ providers: {} }, null, 2),
        description: 'Models config'
      },
      {
        path: mode === 'wsl'
          ? `$HOME/.openclaw/agents/${agentId}/agent/agent.json`
          : path.join(OPENCLAW_HOME, 'agents', agentId, 'agent', 'agent.json'),
        content: JSON.stringify({ 
          id: agentId, 
          name: 'Main Agent', 
          version: 1,
          createdAt: new Date().toISOString()
        }, null, 2),
        description: 'Agent config'
      },
      {
        path: mode === 'wsl'
          ? `$HOME/.openclaw/.env`
          : path.join(OPENCLAW_HOME, '.env'),
        content: '# OpenClaw Environment Variables\n# Add your API keys here, e.g.:\n# KIMI_API_KEY=your_api_key_here\n',
        description: 'Environment variables'
      }
    ];
    
    for (const file of configFiles) {
      try {
        if (mode === 'wsl') {
          // WSL: Use echo command to write file
          const escapedContent = file.content.replace(/'/g, "'\\''");
          await ShellExecutor.runCommand('wsl', ['--exec', 'bash', '-c', `echo '${escapedContent}' > ${file.path}`], {
            timeout: 10000, forceNative: true
          });
        } else {
          // Windows native
          if (!fs.existsSync(file.path)) {
            fs.writeFileSync(file.path, file.content, 'utf-8');
          }
        }
        Logger.info(`Created ${file.description}: ${file.path}`);
      } catch (err) {
        Logger.warn(`Failed to create ${file.description}: ${err.message}`);
        // Continue with other files
      }
    }
  }

  /**
   * Verify that all necessary config files exist
   * Returns object with success flag and list of missing files
   */
  async verifyInstallation() {
    const { OPENCLAW_HOME } = require('../utils/paths');
    const mode = ShellExecutor.getExecutionMode();
    const agentId = 'main';
    const path = require('path');
    
    const requiredFiles = mode === 'wsl' ? [
      { path: `$HOME/.openclaw/openclaw.json`, name: 'Main config' },
      { path: `$HOME/.openclaw/.env`, name: 'Environment variables' },
      { path: `$HOME/.openclaw/agents/${agentId}/agent/auth-profiles.json`, name: 'Auth profiles' },
      { path: `$HOME/.openclaw/agents/${agentId}/agent/models.json`, name: 'Models config' }
    ] : [
      { path: path.join(OPENCLAW_HOME, 'openclaw.json'), name: 'Main config' },
      { path: path.join(OPENCLAW_HOME, '.env'), name: 'Environment variables' },
      { path: path.join(OPENCLAW_HOME, 'agents', agentId, 'agent', 'auth-profiles.json'), name: 'Auth profiles' },
      { path: path.join(OPENCLAW_HOME, 'agents', agentId, 'agent', 'models.json'), name: 'Models config' }
    ];
    
    const missingFiles = [];
    
    for (const file of requiredFiles) {
      try {
        let exists;
        if (mode === 'wsl') {
          const result = await ShellExecutor.runCommand('wsl', ['--exec', 'bash', '-c', `test -f ${file.path} && echo 'EXISTS' || echo 'MISSING'`], {
            timeout: 5000, forceNative: true
          });
          exists = result.stdout && result.stdout.includes('EXISTS');
        } else {
          exists = fs.existsSync(file.path);
        }
        
        if (!exists) {
          missingFiles.push(file.name);
        }
      } catch (err) {
        missingFiles.push(file.name);
      }
    }
    
    return {
      success: missingFiles.length === 0,
      missingFiles,
      message: missingFiles.length === 0 
        ? 'All config files verified' 
        : `Missing files: ${missingFiles.join(', ')}`
    };
  }
}

module.exports = OpenClawInstaller;
