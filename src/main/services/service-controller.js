const ShellExecutor = require('../utils/shell-executor');
const Logger = require('../utils/logger');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ConfigManager = require('./config-manager');
const { timeouts } = require('../config/defaults');

/**
 * 获取 cmd.exe 的完整路径，避免打包后 ENOENT。
 * %SystemRoot%\System32\cmd.exe 在所有 Windows 版本上均存在。
 */
function getCmdExePath() {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const full = path.join(systemRoot, 'System32', 'cmd.exe');
  return fs.existsSync(full) ? full : 'cmd.exe';
}

/**
 * 解码 Buffer，处理 Windows GBK 编码
 */
function decodeBuffer(data) {
  if (!data || data.length === 0) return '';
  const str = data.toString('utf8');
  // 清理乱码字符
  return str.replace(/[\ufffd]/g, '').replace(/[^\x20-\x7E\u4e00-\u9fa5\u3000-\u303F\uFF00-\uFFEF\r\n\t]/g, '');
}

/**
 * 查找 openclaw 可执行文件路径
 * 支持：npm 全局、.npm-global、nvm 各版本目录、PATH 环境变量
 * ★ 优先使用用户自定义的 npm prefix（OPENCLAW_NPM_PREFIX）
 */
function findOpenclawPath() {
  const homeDir = os.homedir();
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const { getNpmPrefix } = require('../utils/paths');
  const customPrefix = getNpmPrefix();

  const possiblePaths = [
    // ★ 用户自定义 prefix 优先（安装时指定的目录）
    path.join(customPrefix, 'openclaw.cmd'),
    path.join(customPrefix, 'openclaw.exe'),
    path.join(customPrefix, 'bin', 'openclaw.cmd'),
    // npm 全局安装路径（用户目录）
    path.join(homeDir, 'AppData', 'Roaming', 'npm', 'openclaw.cmd'),
    path.join(homeDir, 'AppData', 'Roaming', 'npm', 'openclaw.exe'),
    // .npm-global 路径
    path.join(homeDir, '.npm-global', 'openclaw.cmd'),
    path.join(homeDir, '.npm-global', 'bin', 'openclaw.cmd'),
    // 其他常见路径
    path.join(homeDir, '.npm', 'global', 'openclaw.cmd'),
    // Program Files 安装（使用环境变量）
    path.join(programFiles, 'nodejs', 'openclaw.cmd'),
  ];

  // 从 PATH 环境变量中查找（已在 PATH 里的优先级最高，但放最后作为兜底）
  const pathDirs = (process.env.PATH || '').split(';');
  for (const dir of pathDirs) {
    if (dir.trim()) {
      possiblePaths.push(path.join(dir.trim(), 'openclaw.cmd'));
      possiblePaths.push(path.join(dir.trim(), 'openclaw.exe'));
    }
  }

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        Logger.info('Found openclaw at: ' + p);
        return p;
      }
    } catch (e) {
      // 跳过无法访问的路径
    }
  }

  Logger.warn('openclaw not found in any known location, customPrefix=' + customPrefix);
  return null;
}

class ServiceController {
  constructor() {
    const projectRoot = path.join(__dirname, '../../..');
    this.scriptPath = path.join(projectRoot, 'scripts/gateway-control.sh');
    this.pidFile = path.join(os.homedir(), '.openclaw', 'gateway.pid');
    this.configMgr = new ConfigManager();
    this.openclawPath = null; // 将在首次使用时查找
    Logger.info('Gateway controller initialized');
  }

  /**
   * 获取网关端口（从配置读取）
   */
  async _getGatewayPort() {
    try {
      const config = await this.configMgr.read();
      const port = config?.gateway?.port || 18789;
      Logger.info('Gateway port from config: ' + port);
      return port;
    } catch (e) {
      Logger.warn('Failed to read gateway port from config: ' + e.message);
      return 18789;
    }
  }

  /**
   * 获取 openclaw 命令路径
   * 优先使用完整路径，避免 PATH 问题
   */
  _getOpenclawCmd() {
    if (!this.openclawPath) {
      this.openclawPath = findOpenclawPath();
    }
    // 如果找到完整路径，使用它；否则使用命令名
    return this.openclawPath || 'openclaw';
  }

  /**
   * 启动 Gateway 服务
   * @param {Function} onProgress - 可选的进度回调函数
   */
  async start(onProgress) {
    const mode = ShellExecutor.getExecutionMode();
    Logger.info(`Starting gateway (${mode} mode)`);
    
    if (mode === 'wsl') {
      return this._startWsl(onProgress);
    } else {
      return this._startNative(onProgress);
    }
  }

  /**
   * 获取 gateway.cmd 路径（由 openclaw gateway install 生成的服务启动脚本）
   * 该文件包含完整的 node 路径和参数，直接运行即可，无需调用 openclaw 命令
   */
  _getGatewayCmdPath() {
    return path.join(os.homedir(), '.openclaw', 'gateway.cmd');
  }

  /**
   * Windows native mode: start gateway
   * 策略：直接 spawn detached 运行 ~/.openclaw/gateway.cmd，
   *       完全不依赖 openclaw CLI，不触发 UAC。
   */
  async _startNative(onProgress) {
    try {
      // 先检查是否已经在运行
      const status = await this._getNativeStatus();
      if (status.running) {
        Logger.info('Gateway already running, PID: ' + status.pid);
        return { success: true, output: 'Gateway 已在运行中 (PID: ' + status.pid + ')' };
      }

      // 启动前用 openclaw config validate 检查配置，提前发现非法字段
      // 这样可以避免 gateway 因配置错误启动即退出，然后等到 30 秒超时
      try {
        const openclawCmd = this._getOpenclawCmd();
        const validateResult = await this._runCommand(
          getCmdExePath(), ['/d', '/c', openclawCmd, 'config', 'validate'], 8000
        );
        if (validateResult.code !== 0 && validateResult.stderr) {
          Logger.warn('openclaw config validate failed: ' + validateResult.stderr.substring(0, 300));
          // 尝试 doctor --fix 自动修复
          Logger.info('Attempting openclaw doctor --fix before gateway start...');
          const fixResult = await this._runCommand(
            getCmdExePath(), ['/d', '/c', openclawCmd, 'doctor', '--fix'], 20000
          );
          Logger.info('doctor --fix result: code=' + fixResult.code + ', stdout=' + (fixResult.stdout || '').substring(0, 200));
        } else {
          Logger.info('openclaw config validate: OK');
        }
      } catch (e) {
        Logger.warn('Config validate/fix check failed (non-blocking): ' + e.message);
      }

      // 优先使用 gateway.cmd（openclaw gateway install 生成，包含完整 node 路径）
      const gatewayCmdPath = this._getGatewayCmdPath();
      const hasGatewayCmd = fs.existsSync(gatewayCmdPath);

      Logger.info('Starting gateway process...');
      Logger.info('gateway.cmd exists: ' + hasGatewayCmd + ' (' + gatewayCmdPath + ')');

      // 构建精简环境变量（仅在没有 gateway.cmd 时需要完整 PATH）
      const env = this._buildEnv();

      let pid = null;
      let spawnError = null;

      if (hasGatewayCmd) {
        // ===== 首选路径：直接运行 gateway.cmd =====
        // gateway.cmd 内部已硬编码完整 node.exe 路径，spawn 时不需要 shell，不触发 UAC
        Logger.info('Starting gateway via gateway.cmd (direct spawn, no UAC)...');
        try {
          const child = spawn(getCmdExePath(), ['/d', '/c', gatewayCmdPath], {
            detached: true,
            windowsHide: true,
            stdio: 'ignore',
            env: env
          });
          child.unref();
          pid = child.pid;
          Logger.info('Gateway spawned via gateway.cmd, PID: ' + pid);
        } catch (err) {
          spawnError = err;
          Logger.error('gateway.cmd spawn failed: ' + err.message);
        }
      }

      if (!hasGatewayCmd || spawnError || !pid) {
        // ===== 备选路径：通过 openclaw.cmd 启动 =====
        // 注意：不能加 --force 参数，openclaw gateway run 不支持该参数，
        // 会导致进程因参数错误立即退出（exit code 1）。
        const openclawCmd = this._getOpenclawCmd();
        Logger.info('Falling back to openclaw cmd: ' + openclawCmd);
        spawnError = null;
        // 捕获子进程 stderr 输出（写入临时文件），用于诊断启动失败原因
        const stderrLog = path.join(os.tmpdir(), 'openclaw-gateway-stderr.log');
        try {
          let stderrStream = null;
          try {
            stderrStream = fs.createWriteStream(stderrLog, { flags: 'w' });
          } catch (_) { /* 打开失败忽略 */ }

          // detached 进程不能直接传 Stream 对象到 stdio，改用 'pipe' 并手动管道
          // 简单策略：先用 pipe 捕获 stderr，拿到 child 引用后立即 pipe 到文件
          const args = openclawCmd.toLowerCase().endsWith('.cmd') || openclawCmd === 'openclaw'
            ? ['/d', '/c', openclawCmd, 'gateway', 'run']
            : null;

          const child = args
            ? spawn(getCmdExePath(), args, { detached: true, windowsHide: true, stdio: ['ignore', 'ignore', stderrStream ? 'pipe' : 'ignore'], env })
            : spawn(openclawCmd, ['gateway', 'run'], { detached: true, windowsHide: true, stdio: ['ignore', 'ignore', stderrStream ? 'pipe' : 'ignore'], env });

          // 将 stderr 管道到文件（只收集最初的几秒，够诊断了）
          if (stderrStream && child.stderr) {
            child.stderr.pipe(stderrStream);
          }

          child.unref();
          pid = child.pid;
          Logger.info('Gateway spawned via openclaw fallback, PID: ' + pid);
        } catch (err) {
          spawnError = err;
          Logger.error('openclaw fallback spawn failed: ' + err.message);
          return { success: false, output: 'Gateway 启动失败：' + err.message + '\n请先运行 openclaw gateway install' };
        }
      }

      // 轮询等待启动完成（使用配置的超时时间）
      const startTime = Date.now();
      const timeout = timeouts.startTimeout;
      const pollInterval = 1000;

      if (onProgress) {
        onProgress({ step: 'starting', message: '正在启动 Gateway...', percent: 10 });
      }

      // 监听 spawn 子进程退出事件（如果进程异常退出，可以提前终止等待）
      let spawnedChild = null;
      let processExitCode = null;
      // 重新走一遍 spawn 逻辑以拿到 child 引用（上面已经 unref 了，需要在外层捕获）
      // 此处我们通过给子进程加 exit 监听来提前感知失败
      // 注意：上面 spawn 已经 unref()，这里追加监听不影响进程生命周期
      try {
        const { spawn: spawnCheck } = require('child_process');
        // 直接 check 进程是否还活着（通过 kill -0，不会真杀进程）
        if (pid) {
          if (process.platform === 'win32') {
            // Windows: 用完整路径调用 tasklist，并监听 error 事件防止 ENOENT Uncaught Exception
            const tasklistExe = this._getSysCmd('tasklist');
            const chk = spawnCheck(tasklistExe,
              ['/fo', 'csv', '/nh', '/fi', `PID eq ${pid}`],
              { windowsHide: true, stdio: 'ignore' });
            chk.on('error', () => { /* ignore - just a liveness check */ });
          } else {
            const chk = spawnCheck('kill', ['-0', `${pid}`],
              { stdio: 'ignore' });
            chk.on('error', () => { /* ignore */ });
          }
        }
      } catch { /* ignore */ }

      let lastProgress = 10;
      let processGoneEarly = false;
      while (Date.now() - startTime < timeout) {
        await this._sleep(pollInterval);

        // 检查进程是否还在（如果不在了，可能是配置错误导致 openclaw 启动后立即退出）
        if (pid && !processGoneEarly) {
          const tasklist = this._getSysCmd('tasklist');
          const checkResult = await this._runCommand(tasklist, ['/fo', 'csv', '/nh', '/fi', `PID eq ${pid}`], 3000);
          // tasklist 找不到 PID → 进程已退出
          if (checkResult.code === 0 && checkResult.stdout && !checkResult.stdout.includes(String(pid))) {
            processGoneEarly = true;
            Logger.warn(`Gateway process (PID ${pid}) exited early - possible config error or port conflict`);
          }
        }

        const verifyStatus = await this._getNativeStatus();
        if (verifyStatus.running) {
          // 保存真实 PID（从端口探测到的，比 spawn PID 更准确）
          try {
            const pidDir = path.dirname(this.pidFile);
            if (!fs.existsSync(pidDir)) fs.mkdirSync(pidDir, { recursive: true });
            fs.writeFileSync(this.pidFile, String(verifyStatus.pid));
          } catch (e) { /* ignore */ }
          Logger.info('Gateway started successfully after ' + Math.round((Date.now() - startTime) / 1000) + 's');
          return { success: true, output: 'Gateway 启动成功 (PID: ' + verifyStatus.pid + ')' };
        }

        // 进程已退出且端口未监听 → 提前失败，不用等到超时
        if (processGoneEarly) {
          Logger.error('Gateway process exited without listening on port - check openclaw.json config');
          // 尝试读取 stderr 日志，给用户更具体的错误信息
          let stderrDetail = '';
          const stderrLog = path.join(os.tmpdir(), 'openclaw-gateway-stderr.log');
          try {
            if (fs.existsSync(stderrLog)) {
              const raw = fs.readFileSync(stderrLog, 'utf8').trim();
              if (raw) {
                stderrDetail = '\n\n错误详情：\n' + raw.substring(0, 500);
                Logger.error('Gateway stderr: ' + raw.substring(0, 500));
              }
            }
          } catch (_) {}
          const port = await this._getGatewayPort();
          return {
            success: false,
            output: 'Gateway 进程异常退出。可能原因：\n' +
                    '1. openclaw.json 配置有误（运行 openclaw config validate 检查）\n' +
                    '2. 端口 ' + port + ' 被占用（检查是否有其他进程占用该端口）\n' +
                    '3. openclaw 版本过旧（运行 npm install -g openclaw@latest 更新）\n' +
                    '4. 如问题持续，请在 CMD 中手动运行 "openclaw gateway run" 查看详细错误' +
                    stderrDetail
          };
        }

        const elapsed = Date.now() - startTime;
        const progress = Math.min(90, 10 + Math.floor(elapsed / timeout * 80));
        if (progress > lastProgress && onProgress) {
          lastProgress = progress;
          onProgress({
            step: 'starting',
            message: '正在等待 Gateway 启动... (' + Math.round(elapsed / 1000) + 's)',
            percent: progress
          });
        }
      }

      Logger.error('Gateway failed to start - timeout after ' + timeout / 1000 + 's');
      return {
        success: false,
        output: `Gateway 启动超时（${timeout / 1000}s）。请手动运行：\n` +
                '  openclaw config validate   （检查配置）\n' +
                '  openclaw gateway run       （前台启动，查看详细错误）'
      };
    } catch (e) {
      Logger.error('Gateway start failed: ' + e.message);
      Logger.error('Stack: ' + e.stack);
      return { success: false, output: 'Gateway 启动失败：' + e.message };
    }
  }

  /**
   * 构建包含必要 PATH 的环境变量
   * 关键：必须包含 node.exe 的目录，否则 .cmd 脚本无法执行
   */
  _buildEnv() {
    const env = { ...process.env };
    const homeDir = os.homedir();
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    // --- 优先路径：已确认存在的 Node.js 安装目录 ---
    const priorityPaths = [];

    // 1. 当前进程的 node.exe 所在目录（仅在非 Electron 打包环境下有效）
    // 注意：Electron 打包后 process.execPath 指向 Electron 主进程（如 lobster-claw.exe），
    // 而非 node.exe，将其目录加入 PATH 没有意义。检测 process.versions.electron 来区分。
    if (!process.versions.electron) {
      // 纯 Node.js 环境（npm run dev 开发模式）：execPath 即 node.exe
      const currentNodeDir = path.dirname(process.execPath);
      if (currentNodeDir && currentNodeDir !== '.') {
        priorityPaths.push(currentNodeDir);
      }
    } else {
      // Electron 打包环境：尝试从 process.env 或注册表找到 node.exe 真实路径
      // 这里先尝试 process.env 中已有的 Path（系统注册的 Node 路径通常在 Machine PATH）
      // 后面步骤 3 会扫描标准安装路径，步骤 5 会从 PowerShell 读取完整用户 PATH
    }

    // 2. npm 全局安装路径（openclaw.cmd 通常安装在这里）
    const npmGlobalPaths = [
      path.join(homeDir, 'AppData', 'Roaming', 'npm'),
      path.join(homeDir, '.npm-global'),
      path.join(homeDir, '.npm-global', 'bin'),
    ];
    for (const p of npmGlobalPaths) {
      try { if (fs.existsSync(p)) priorityPaths.push(p); } catch (e) { /* skip */ }
    }

    // 3. 标准 Node.js 安装路径（按优先级排列）
    const standardNodePaths = [
      path.join(programFiles, 'nodejs'),
      path.join(programFilesX86, 'nodejs'),
      'C:\\nodejs',
    ];
    for (const p of standardNodePaths) {
      try { if (fs.existsSync(p)) priorityPaths.push(p); } catch (e) { /* skip */ }
    }

    // 4. nvm for Windows 当前激活版本目录
    const nvmRoot = process.env.NVM_HOME || path.join(homeDir, 'AppData', 'Roaming', 'nvm');
    try {
      if (fs.existsSync(nvmRoot)) {
        const entries = fs.readdirSync(nvmRoot);
        // 找到版本目录（形如 v20.x.x 或 20.x.x）
        const versionDirs = entries
          .filter(e => /^v?\d+\.\d+/.test(e))
          .map(e => path.join(nvmRoot, e))
          .filter(p => { try { return fs.existsSync(path.join(p, 'node.exe')); } catch { return false; } });
        // 取最新版本（按版本号排序，降序）
        versionDirs.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        if (versionDirs.length > 0) {
          priorityPaths.push(versionDirs[0]);
        }
      }
    } catch (e) {
      // 跳过 nvm 目录查找错误
    }

    // 5. 尝试从 PowerShell 读取 User+Machine PATH，确保 nvm/fnm 等用户级 node 路径被包含
    //    Electron 打包后继承的是精简系统 PATH，用户 PATH（%NVM_HOME% 等）不在其中。
    //    关键：使用 spawn 而非 execSync + shell，避免引号嵌套问题；
    //    PowerShell 的字符串参数名用单引号传递，不受外层 JS 字符串影响。
    try {
      const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
      const psExe = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const { spawnSync } = require('child_process');
      // 用单引号包裹环境变量名称，避免被 PowerShell 的参数解析误判
      // 分拆为独立参数传给 spawnSync，完全绕开 shell 引号嵌套问题
      const psScript = [
        '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;',
        "$u=[Environment]::GetEnvironmentVariable('Path','User');",
        "$m=[Environment]::GetEnvironmentVariable('Path','Machine');",
        "Write-Output ($u + ';' + $m)"
      ].join(' ');
      const spawnResult = spawnSync(
        psExe,
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text', '-Command', psScript],
        { timeout: 4000, windowsHide: true, encoding: 'buffer' }
      );
      if (spawnResult.status === 0 && spawnResult.stdout) {
        // 尝试 UTF-8 解码；若有乱码则说明 OutputEncoding 未生效，回退到 process.env.PATH
        const rawOut = spawnResult.stdout.toString('utf8').trim();
        // 过滤掉明显乱码：包含 \uFFFD（替换字符）则丢弃
        if (rawOut && !rawOut.includes('\uFFFD')) {
          const regParts = rawOut.split(';').map(p => p.trim()).filter(Boolean);
          priorityPaths.push(...regParts);
          Logger.info('_buildEnv: injected ' + regParts.length + ' paths from User+Machine PATH');
        } else {
          Logger.warn('_buildEnv: PowerShell PATH output contains garbled chars, skipping');
        }
      } else if (spawnResult.stderr) {
        Logger.warn('_buildEnv: PowerShell PATH query failed: ' + spawnResult.stderr.toString('utf8').substring(0, 200));
      }
    } catch (e) {
      Logger.warn('_buildEnv: failed to read User PATH via PowerShell: ' + e.message);
    }


    const existingPaths = (env.PATH || '').split(';').filter(p => p.trim());
    const allPaths = [...priorityPaths, ...existingPaths];

    // 去重，保持顺序
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
    Logger.info('Built PATH with ' + uniquePaths.length + ' entries, node paths first');
    Logger.debug('PATH preview: ' + env.PATH.substring(0, 200));

    // 注入 ~/.openclaw/.env 中的变量，使 openclaw.json 里的 ${VAR} 占位符能被展开
    // 例如：apiKey: "${KIMI_API_KEY}" → 需要子进程环境里有 KIMI_API_KEY
    const dotEnvPath = path.join(homeDir, '.openclaw', '.env');
    try {
      if (fs.existsSync(dotEnvPath)) {
        const envContent = fs.readFileSync(dotEnvPath, 'utf-8');
        let injected = 0;
        for (const rawLine of envContent.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line || line.startsWith('#')) continue;
          const eqIdx = line.indexOf('=');
          if (eqIdx <= 0) continue;
          const key = line.slice(0, eqIdx).trim();
          let value = line.slice(eqIdx + 1).trim();
          // 去除首尾引号（单引号或双引号）
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          if (key) {
            env[key] = value;
            injected++;
          }
        }
        Logger.info('Injected ' + injected + ' vars from .env into gateway env');
      }
    } catch (e) {
      Logger.warn('Failed to read .env for gateway: ' + e.message);
    }

    return env;
  }

  /**
   * WSL mode: use shell script via WSL
   */
  async _startWsl(onProgress) {
    try {
      Logger.info('Executing gateway script in WSL');
      
      if (onProgress) {
        onProgress({ step: 'starting', message: '正在通过 WSL 启动 Gateway...', percent: 20 });
      }
      
      const result = await ShellExecutor.runCommand('wsl', [
        '--exec', 'bash', this.scriptPath.replace(/\\/g, '/'), 'start'
      ], {
        timeout: timeouts.startTimeout,
        forceNative: true
      });
      
      if (result.code === 0) {
        Logger.info('Gateway started in WSL');
        return { success: true, output: result.stdout || 'Gateway 已启动 (WSL)' };
      } else {
        return { success: false, output: result.stderr || 'Gateway 启动失败' };
      }
    } catch (e) {
      return { success: false, output: 'Gateway 启动失败：' + e.message };
    }
  }

  async stop() {
    const mode = ShellExecutor.getExecutionMode();
    Logger.info('Stopping gateway (' + mode + ' mode)');
    
    if (mode === 'wsl') {
      return this._stopWsl();
    } else {
      return this._stopNative();
    }
  }

  /**
   * Windows native mode: stop gateway
   * 只使用 taskkill 直接按 PID 杀进程，不调用 openclaw gateway stop（可能触发 UAC）
   */
  async _stopNative() {
    try {
      const status = await this._getNativeStatus();

      if (!status.running && !status.pidFromFile) {
        Logger.info('Gateway is not running');
        return { success: true, output: 'Gateway 未在运行' };
      }

      // 收集所有需要杀掉的 PID（去重）
      const pidsToKill = new Set();
      if (status.pidFromPort) pidsToKill.add(status.pidFromPort);
      if (status.pidFromFile && status.pidFromFile !== status.pidFromPort) {
        pidsToKill.add(status.pidFromFile);
      }

      for (const pid of pidsToKill) {
        try {
          // /T 同时终止子进程树，确保 cmd.exe 启动的 node 子进程也被杀掉
          // taskkill 不需要管理员权限来终止同一用户的进程，不触发 UAC
          const result = await this._runCommand('taskkill', ['/F', '/T', '/PID', String(pid)]);
          if (result.code === 0) {
            Logger.info('Gateway stopped via taskkill /T, PID: ' + pid);
          } else {
            Logger.warn('taskkill PID ' + pid + ' failed: ' + result.stderr);
          }
        } catch (e) {
          Logger.warn('taskkill PID ' + pid + ' error: ' + e.message);
        }
      }

      // 清理 PID 文件
      try {
        if (fs.existsSync(this.pidFile)) fs.unlinkSync(this.pidFile);
      } catch (e) { /* ignore */ }

      // 无论 taskkill 是否成功，都验证端口是否已关闭（最终状态才是真实结果）
      await this._sleep(500);
      const afterStatus = await this._getNativeStatus();
      if (!afterStatus.running) {
        return { success: true, output: 'Gateway 已停止' };
      } else {
        return { success: false, output: 'Gateway 停止失败，请手动关闭相关进程' };
      }
    } catch (e) {
      Logger.error('Gateway stop failed: ' + e.message);
      return { success: false, output: 'Gateway 停止失败：' + e.message };
    }
  }

  /**
   * WSL mode: stop gateway
   */
  async _stopWsl() {
    try {
      const result = await ShellExecutor.runCommand('wsl', [
        '--exec', 'bash', this.scriptPath.replace(/\\/g, '/'), 'stop'
      ], {
        timeout: 15000,
        forceNative: true
      });
      
      Logger.info('Gateway stopped in WSL');
      return { success: true, output: result.stdout || 'Gateway 已停止' };
    } catch (e) {
      return { success: false, output: 'Gateway 停止失败：' + e.message };
    }
  }

  /**
   * 重启 Gateway 服务
   * @param {Function} onProgress - 可选的进度回调函数
   */
  async restart(onProgress) {
    if (onProgress) {
      onProgress({ step: 'stopping', message: '正在停止 Gateway...', percent: 5 });
    }
    await this.stop();
    await this._sleep(2000);  // ★ 从 1000 增加到 2000，让旧 WebSocket 连接充分关闭
    if (onProgress) {
      onProgress({ step: 'starting', message: '正在启动 Gateway...', percent: 10 });
    }
    return this.start(onProgress);
  }

  async getStatus() {
    const mode = ShellExecutor.getExecutionMode();
    
    if (mode === 'wsl') {
      return this._getWslStatus();
    } else {
      return this._getNativeStatus();
    }
  }

  /**
   * Windows native mode: get gateway status
   */
  async _getNativeStatus() {
    try {
      // 获取配置中的端口
      const port = await this._getGatewayPort();
      
      // 通过 netstat 查找监听端口的进程
      const result = await this._runCommand('netstat', ['-ano']);
      
      if (result.code === 0 && result.stdout) {
        const lines = result.stdout.split('\n');
        for (const line of lines) {
          if (line.includes(':' + port) && line.includes('LISTENING')) {
            const parts = line.trim().split(/\s+/);
            const pid = parseInt(parts[parts.length - 1], 10);
            
            if (pid && !isNaN(pid)) {
              // 读取 PID 文件
              let pidFromFile = null;
              try {
                if (fs.existsSync(this.pidFile)) {
                  pidFromFile = parseInt(fs.readFileSync(this.pidFile, 'utf8').trim(), 10);
                }
              } catch (e) {
                // ignore
              }

              return {
                running: true,
                installed: true,
                pid: pid,
                pidFromPort: pid,
                pidFromFile: pidFromFile,
                output: 'Gateway 运行中 (PID: ' + pid + ', Port: ' + port + ')',
                raw: result.stdout
              };
            }
          }
        }
      }

      // 检查 PID 文件是否存在
      let pidFromFile = null;
      try {
        if (fs.existsSync(this.pidFile)) {
          pidFromFile = parseInt(fs.readFileSync(this.pidFile, 'utf8').trim(), 10);
        }
      } catch (e) {
        // ignore
      }

      return {
        running: false,
        installed: true,
        pidFromFile: pidFromFile,
        output: 'Gateway 未运行',
        raw: ''
      };
    } catch (e) {
      return {
        running: false,
        installed: false,
        output: 'openclaw 未安装或命令不可用',
        raw: ''
      };
    }
  }

  /**
   * WSL mode: get gateway status
   */
  async _getWslStatus() {
    try {
      const result = await ShellExecutor.runCommand('wsl', [
        '--exec', 'bash', this.scriptPath.replace(/\\/g, '/'), 'status'
      ], {
        timeout: 10000,
        forceNative: true
      });
      
      if (result.code === 0) {
        return {
          running: true,
          installed: true,
          output: result.stdout || 'Gateway 运行中',
          raw: result.stdout
        };
      } else {
        return {
          running: false,
          installed: true,
          output: 'Gateway 未运行',
          raw: ''
        };
      }
    } catch (e) {
      return {
        running: false,
        installed: false,
        output: 'openclaw 未安装或命令不可用',
        raw: ''
      };
    }
  }

  /**
   * 系统命令完整路径（避免 PATH 查找和 shell 调用）
   */
  _getSysCmd(name) {
    const sys32 = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, 'System32', name + '.exe')
      : path.join('C:\\Windows', 'System32', name + '.exe');
    if (fs.existsSync(sys32)) return sys32;
    return name; // 找不到时回退到命令名
  }

  /**
   * 执行命令的辅助方法（用于状态检查、taskkill 等短命令）
   * 不使用 shell: true，直接执行，不触发 UAC
   */
  _runCommand(cmd, args, timeout = 10000) {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';

      // 对系统命令使用完整路径，避免 PATH 查找
      // 如果传入的已经是完整路径（含路径分隔符），直接使用
      const sysCommands = ['netstat', 'taskkill', 'tasklist', 'schtasks'];
      const isFullPath = cmd.includes('/') || cmd.includes('\\');
      const resolvedCmd = (!isFullPath && sysCommands.includes(cmd.toLowerCase()))
        ? this._getSysCmd(cmd)
        : cmd;

      const child = spawn(resolvedCmd, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
        // 不传 shell: true，直接执行，避免 UAC
      });

      const timer = setTimeout(() => {
        child.kill();
        resolve({ code: 1, stdout, stderr: 'Timeout' });
      }, timeout);

      child.stdout.on('data', (data) => {
        stdout += decodeBuffer(data);
      });

      child.stderr.on('data', (data) => {
        stderr += decodeBuffer(data);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code: code || 0, stdout, stderr });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ code: 1, stdout, stderr: err.message });
      });
    });
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async _checkHealth() {
    try {
      const mode = ShellExecutor.getExecutionMode();
      if (mode === 'wsl') {
        const r = await ShellExecutor.runCommand('wsl', ['--exec', 'bash', '-c', 'export PATH="$HOME/.npm-global/bin:$PATH" && openclaw gateway health'], {
          timeout: 10000, forceNative: true
        });
        return r.code === 0;
      } else {
        const openclawCmd = this._getOpenclawCmd();
        const result = await this._runCommand(openclawCmd, ['gateway', 'health'], 8000);
        return result.code === 0;
      }
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────
  // 开机自启管理
  //
  // 策略：
  //   1. 由管理面板直接调用 schtasks.exe（完整路径）注册/删除计划任务，
  //      不再依赖 openclaw gateway install（该命令在 PATH 不完整时报 ENOENT）。
  //   2. 任务名固定为 "OpenClawGateway"，登录时以当前用户身份运行 gateway.cmd。
  //   3. 关闭自启 → 删除计划任务（schtasks /delete）
  //   4. 开启自启 → 创建计划任务（schtasks /create）
  //   5. 查询状态 → schtasks /query /tn "OpenClawGateway"
  // ─────────────────────────────────────────────

  /** 计划任务名称 */
  get _taskName() { return 'OpenClawGateway'; }

  /**
   * 确保 gateway.cmd 头部已注入拦截逻辑（兼容旧版标志文件方案）。
   * 幂等：已注入则跳过。
   */
  _injectGatewayCmdGuard() {
    const cmdPath = this._getGatewayCmdPath();
    if (!fs.existsSync(cmdPath)) return;
    try {
      const original = fs.readFileSync(cmdPath, 'utf8');
      if (original.includes('autostart_disabled')) return;
      const guardLine = 'if exist "%USERPROFILE%\\.openclaw\\autostart_disabled" exit /b 0\r\n';
      const firstNewline = original.indexOf('\n');
      const patched = firstNewline === -1
        ? original + '\r\n' + guardLine
        : original.slice(0, firstNewline + 1) + guardLine + original.slice(firstNewline + 1);
      fs.writeFileSync(cmdPath, patched, 'utf8');
      Logger.info('gateway.cmd guard injected');
    } catch (e) {
      Logger.warn('Failed to inject gateway.cmd guard: ' + e.message);
    }
  }

  /**
   * 检查计划任务是否存在（精确匹配任务名）
   */
  async _checkTaskExists() {
    try {
      const schtasks = this._getSysCmd('schtasks');
      const result = await this._runCommand(
        schtasks,
        ['/query', '/tn', this._taskName, '/fo', 'CSV'],
        8000
      );
      // 退出码 0 = 任务存在；非 0 = 不存在或无权限
      return result.code === 0 && result.stdout.length > 0;
    } catch (e) {
      return false;
    }
  }

  /**
   * 获取开机自启状态
   */
  async getAutostart() {
    if (process.platform !== 'win32') {
      return { enabled: false, taskExists: false };
    }
    try {
      const taskExists = await this._checkTaskExists();
      Logger.info('Autostart: taskExists=' + taskExists);
      return { enabled: taskExists, taskExists };
    } catch (e) {
      Logger.error('getAutostart error: ' + e.message);
      return { enabled: false, taskExists: false };
    }
  }

  /**
   * 安装开机自启计划任务（由管理面板直接调用 schtasks.exe，不依赖 openclaw gateway install）
   *
   * 关键设计：
   *   - 用 schtasks /create /xml 导入任务 XML，Command 和 Arguments 分开放在 XML 节点里，
   *     彻底绕开 schtasks /tr 命令行引号嵌套地狱。
   *   - 任务执行体优先使用 gateway.cmd（直接路径），fallback 到 openclaw.cmd gateway run。
   *   - LogonTrigger + LeastPrivilege：用户登录时启动，不需要管理员权限。
   */
  async installAutostartTask() {
    if (process.platform !== 'win32') {
      return { success: false, message: '当前平台不支持计划任务' };
    }

    try {
      const schtasks = this._getSysCmd('schtasks');
      const cmdExe = getCmdExePath();

      // 决定任务执行体：Command = cmd.exe，Arguments = /d /c "<path>"
      const gatewayCmdPath = this._getGatewayCmdPath();
      let taskCommand, taskArguments;

      if (fs.existsSync(gatewayCmdPath)) {
        taskCommand = cmdExe;
        taskArguments = `/d /c "${gatewayCmdPath}"`;
        Logger.info('installAutostartTask: using gateway.cmd');
      } else {
        // gateway.cmd 不存在，改用 openclaw.cmd gateway run
        const openclawCmd = findOpenclawPath();
        if (!openclawCmd || openclawCmd === 'openclaw') {
          return {
            success: false,
            message: '找不到 openclaw 可执行文件，请确认 openclaw 已正确安装（npm install -g openclaw）'
          };
        }
        taskCommand = cmdExe;
        taskArguments = `/d /c "${openclawCmd}" gateway run`;
        Logger.info('installAutostartTask: using openclaw.cmd, path=' + openclawCmd);
      }

      // 先尝试删除旧任务（幂等，失败也没关系）
      await this._execSchtasks(`"${schtasks}" /delete /tn "${this._taskName}" /f`);

      // 生成任务 XML 并写入临时文件
      // schtasks /xml 要求文件编码为 UTF-16 LE with BOM
      const username = process.env.USERNAME || os.userInfo().username;
      const xmlPath = path.join(os.tmpdir(), 'openclaw_task.xml');
      const taskXml = this._buildTaskXml(taskCommand, taskArguments, username);
      const bom = Buffer.from([0xff, 0xfe]);
      const content = Buffer.from(taskXml, 'utf16le');
      fs.writeFileSync(xmlPath, Buffer.concat([bom, content]));

      Logger.info('task xml written to: ' + xmlPath);
      const createCmd = `"${schtasks}" /create /tn "${this._taskName}" /xml "${xmlPath}" /f`;
      Logger.info('schtasks create cmd: ' + createCmd);

      const createResult = await this._execSchtasks(createCmd);

      // 清理临时文件
      try { fs.unlinkSync(xmlPath); } catch (_) {}

      if (createResult.code === 0) {
        Logger.info('Autostart task created: ' + this._taskName);
        return { success: true, message: '开机自启已设置，重启后自动生效' };
      } else {
        const errMsg = createResult.stderr || createResult.stdout || '未知错误';
        Logger.error('schtasks /create failed: ' + errMsg);
        return { success: false, message: '创建计划任务失败：' + errMsg };
      }
    } catch (e) {
      Logger.error('installAutostartTask error: ' + e.message);
      return { success: false, message: '安装失败：' + e.message };
    }
  }

  /**
   * 构建计划任务 XML（Windows Task Scheduler 格式，兼容 Win7+）
   * Command 和 Arguments 分开存放，不需要任何 shell 引号转义。
   *
   * @param {string} command   可执行文件完整路径，如 C:\Windows\System32\cmd.exe
   * @param {string} args      参数字符串，如 /d /c "C:\Users\...\gateway.cmd"
   * @param {string} username  运行用户名
   */
  _buildTaskXml(command, args, username) {
    // XML 中对特殊字符转义
    const esc = (s) => s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>OpenClaw Gateway autostart on user logon</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${esc(username)}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${esc(username)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${esc(command)}</Command>
      <Arguments>${esc(args)}</Arguments>
    </Exec>
  </Actions>
</Task>`;
  }

  /**
   * 用 exec 执行 schtasks 命令行（完整字符串），避免 spawn 参数引号问题。
   * @param {string} cmdLine 完整命令行字符串
   * @returns {Promise<{code:number,stdout:string,stderr:string}>}
   */
  _execSchtasks(cmdLine) {
    return new Promise((resolve) => {
      exec(cmdLine, { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => {
        const code = err ? (err.code || 1) : 0;
        resolve({
          code,
          stdout: (stdout || '').trim(),
          stderr: (stderr || '').trim()
        });
      });
    });
  }

  /**
   * 设置开机自启（开启：创建任务；关闭：删除任务）
   * @param {boolean} enable
   */
  async setAutostart(enable) {
    if (process.platform !== 'win32') {
      return { success: false, message: '当前平台不支持开机自启管理' };
    }
    try {
      if (!enable) {
        // 禁用：删除计划任务
        const schtasks = this._getSysCmd('schtasks');
        const result = await this._execSchtasks(`"${schtasks}" /delete /tn "${this._taskName}" /f`);
        if (result.code === 0) {
          Logger.info('Autostart task deleted');
          return { success: true, message: '已禁用开机自启' };
        } else {
          // 任务不存在时 /delete 也会返回非 0，但逻辑上算"已禁用"
          const alreadyGone = /找不到|does not exist|cannot find/i.test(result.stderr + result.stdout);
          if (alreadyGone) return { success: true, message: '已禁用开机自启' };
          return { success: false, message: '删除计划任务失败：' + (result.stderr || result.stdout) };
        }
      } else {
        // 启用：直接调用 installAutostartTask 创建任务
        return await this.installAutostartTask();
      }
    } catch (e) {
      Logger.error('setAutostart error: ' + e.message);
      return { success: false, message: '操作失败：' + e.message };
    }
  }
}

module.exports = ServiceController;
