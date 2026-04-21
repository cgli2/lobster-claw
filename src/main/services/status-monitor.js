const ShellExecutor = require('../utils/shell-executor');
const Logger = require('../utils/logger');
const { getNpmPrefix } = require('../utils/paths');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

class StatusMonitor {
  // 获取 openclaw 命令，根据执行模式返回适当的命令
  _getOpenClawCommand() {
    const mode = ShellExecutor.getExecutionMode();
    if (mode === 'wsl') {
      // WSL 模式：使用 wsl --exec 执行，并确保 PATH 包含 npm-global，同时设置 UTF-8 编码
      return {
        cmd: 'wsl',
        args: ['--exec', 'bash', '-c', 'export LANG=zh_CN.UTF-8 LC_ALL=zh_CN.UTF-8 && export PATH="$HOME/.npm-global/bin:$PATH" && openclaw'],
        forceNative: true
      };
    }
    // Windows 原生模式：优先使用完整路径
    const openclawPath = this._findOpenclawPath();
    return { cmd: openclawPath || 'openclaw', args: [], forceNative: false };
  }

  /**
   * 查找 openclaw 可执行文件路径（Windows 原生模式）
   */
  _findOpenclawPath() {
    const homeDir = os.homedir();
    const npmPrefix = getNpmPrefix();
    const possiblePaths = [
      // ★ 用户自定义 prefix 优先
      path.join(npmPrefix, 'openclaw.cmd'),
      path.join(npmPrefix, 'openclaw.exe'),
      path.join(npmPrefix, 'bin', 'openclaw.cmd'),
      // 标准路径
      path.join(homeDir, 'AppData', 'Roaming', 'npm', 'openclaw.cmd'),
      path.join(homeDir, 'AppData', 'Roaming', 'npm', 'openclaw.exe'),
      path.join(homeDir, '.npm-global', 'openclaw.cmd'),
    ];
    for (const p of possiblePaths) {
      try { if (fs.existsSync(p)) return p; } catch (_) {}
    }
    return null;
  }

  async runDoctor() {
    try {
      const cmdInfo = this._getOpenClawCommand();
      const result = await ShellExecutor.runCommand(
        cmdInfo.cmd, 
        [...cmdInfo.args, 'doctor'], 
        { timeout: 60000, forceNative: cmdInfo.forceNative }
      );
      return {
        success: result.code === 0,
        output: result.stdout || result.stderr || '无输出'
      };
    } catch (err) {
      Logger.error('Doctor failed: ' + err.message);
      return { success: false, output: '诊断运行失败: ' + err.message };
    }
  }

  /**
   * 增强版诊断：依次执行以下步骤，聚合结果：
   *   1. openclaw config validate  — 校验 openclaw.json 合法性
   *   2. openclaw status           — 查看 gateway / agent 运行状态
   *   3. openclaw doctor --fix     — 若前两步有错误则自动修复
   *
   * 返回：
   *   {
   *     steps: [{ name, cmd, success, output }],
   *     fixRan: boolean,   // 是否执行了 --fix
   *     fixOutput: string, // --fix 的输出（fixRan 时有效）
   *     overallSuccess: boolean
   *   }
   */
  async runValidateAndFix() {
    const cmdInfo = this._getOpenClawCommand();
    const run = async (extraArgs, timeoutMs = 20000) => {
      try {
        const r = await ShellExecutor.runCommand(
          cmdInfo.cmd,
          [...cmdInfo.args, ...extraArgs],
          { timeout: timeoutMs, forceNative: cmdInfo.forceNative }
        );
        return { success: r.code === 0, output: (r.stdout || r.stderr || '（无输出）').trim() };
      } catch (err) {
        return { success: false, output: '执行失败: ' + err.message };
      }
    };

    const steps = [];

    // Step 1: config validate
    Logger.info('[ValidateAndFix] Step 1: openclaw config validate');
    const validateResult = await run(['config', 'validate'], 15000);
    steps.push({ name: 'openclaw config validate', success: validateResult.success, output: validateResult.output });

    // Step 2: openclaw status
    Logger.info('[ValidateAndFix] Step 2: openclaw status');
    const statusResult = await run(['status'], 15000);
    steps.push({ name: 'openclaw status', success: statusResult.success, output: statusResult.output });

    // Step 3: openclaw gateway run（前台短跑，捕获启动日志/错误）
    // 背景：gateway 后台启动时 stdio: ignore，启动失败原因完全看不到。
    // 这里用前台模式运行，收集 stdout+stderr，10 秒后强制结束（正常 gateway 会一直运行，
    // 但如果配置有误或端口冲突，它会在几秒内输出错误并自行退出）。
    Logger.info('[ValidateAndFix] Step 3: openclaw gateway run (foreground, 10s capture)');
    const gatewayRunResult = await this._runGatewayForeground(12000);
    steps.push({ name: 'openclaw gateway run', success: gatewayRunResult.success, output: gatewayRunResult.output });

    // Step 4: 若 validate 或 status 失败，执行 doctor --fix
    const needFix = !validateResult.success || !statusResult.success;
    let fixRan = false;
    let fixOutput = '';

    if (needFix) {
      Logger.info('[ValidateAndFix] Step 4: openclaw doctor --fix (triggered by errors above)');
      const fixResult = await run(['doctor', '--fix'], 60000);
      fixRan = true;
      fixOutput = fixResult.output;
      steps.push({ name: 'openclaw doctor --fix', success: fixResult.success, output: fixResult.output });
    }

    const overallSuccess = steps.every(s => s.success);
    return { steps, fixRan, fixOutput, overallSuccess };
  }

  async getStatus() {
    try {
      const cmdInfo = this._getOpenClawCommand();
      const result = await ShellExecutor.runCommand(
        cmdInfo.cmd, 
        [...cmdInfo.args, 'status'], 
        { timeout: 15000, forceNative: cmdInfo.forceNative }
      );
      return {
        success: result.code === 0,
        output: result.stdout || result.stderr || '无输出'
      };
    } catch (err) {
      return { success: false, output: err.message };
    }
  }

  async getLatestVersion() {
    try {
      const result = await ShellExecutor.runCommand('npm', ['view', 'openclaw', 'version'], { timeout: 30000 });
      return result.code === 0 ? result.stdout.trim() : null;
    } catch {
      return null;
    }
  }

  /**
   * 前台运行 openclaw gateway run，捕获 stdout+stderr，用于诊断 gateway 启动失败的原因。
   *
   * 策略：
   *   - 以前台模式（stdio pipe）启动 gateway，超时后强制杀掉
   *   - 若 gateway 在超时前自行退出（配置/端口错误），返回错误输出
   *   - 若 gateway 在超时内一直跑（说明启动成功），则认为成功并返回已收集的输出
   *
   * @param {number} timeoutMs  等待时间，毫秒（默认 12000）
   * @returns {Promise<{success: boolean, output: string}>}
   */
  async _runGatewayForeground(timeoutMs = 12000) {
    return new Promise((resolve) => {
      // 查找 openclaw 可执行文件
      const homeDir = os.homedir();
      const npmPrefix = getNpmPrefix();
      const possiblePaths = [
        path.join(npmPrefix, 'openclaw.cmd'),
        path.join(homeDir, 'AppData', 'Roaming', 'npm', 'openclaw.cmd'),
      ];
      let openclawPath = null;
      for (const p of possiblePaths) {
        try { if (fs.existsSync(p)) { openclawPath = p; break; } } catch (_) {}
      }
      if (!openclawPath) openclawPath = 'openclaw';

      const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
      const cmdExe = path.join(systemRoot, 'System32', 'cmd.exe');

      // 构建最小化的环境：保留当前 PATH 并确保 npm-global 在首位
      const env = { ...process.env };
      const npmGlobal = getNpmPrefix();
      env.PATH = npmGlobal + ';' + (env.PATH || '');

      // Windows cmd.exe 输出编码为系统代码页（GBK），不是 UTF-8。
      // 先把原始 Buffer 攒起来，最终再统一解码，避免多字节字符被截断导致乱码。
      const stdoutChunks = [];
      const stderrChunks = [];
      let stdoutLen = 0;
      let stderrLen = 0;
      const chunkLimit = 8000; // 最多收集 8KB，够看错误了

      // 解码 Buffer：优先 UTF-8，若含替换字符（\uFFFD）则改用 latin1 并过滤非打印字符
      const decodeChunks = (chunks) => {
        if (chunks.length === 0) return '';
        const buf = Buffer.concat(chunks);
        const utf8 = buf.toString('utf8');
        if (!utf8.includes('\uFFFD')) return utf8;
        // 回退：latin1（保留所有字节），再过滤掉非 ASCII / 非中文字符
        const raw = buf.toString('latin1');
        return raw.replace(/[^\x20-\x7E\u4e00-\u9fa5\u3000-\u303F\uFF00-\uFFEF\r\n\t]/g, '');
      };

      let resolved = false;

      const done = (success, extra) => {
        if (resolved) return;
        resolved = true;
        const stdout = decodeChunks(stdoutChunks).trim();
        const stderr = decodeChunks(stderrChunks).trim();
        const combined = [stdout, stderr].filter(Boolean).join('\n').trim();
        const output = combined
          ? (extra ? extra + '\n\n--- 输出 ---\n' + combined : combined)
          : (extra || '（无输出）');
        resolve({ success, output });
      };

      let child;
      try {
        child = spawn(
          cmdExe,
          ['/d', '/c', openclawPath, 'gateway', 'run'],
          { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env }
        );
      } catch (spawnErr) {
        return resolve({ success: false, output: 'spawn 失败: ' + spawnErr.message });
      }

      child.stdout.on('data', (d) => {
        if (stdoutLen < chunkLimit) { stdoutChunks.push(d); stdoutLen += d.length; }
      });
      child.stderr.on('data', (d) => {
        if (stderrLen < chunkLimit) { stderrChunks.push(d); stderrLen += d.length; }
      });

      // 进程自行退出（通常是出错了）
      child.on('close', (code) => {
        clearTimeout(timer);
        if (!resolved) {
          // 退出码非 0 或有 stderr → 失败；success 判断在 done 内完成
          const hasStderr = stderrChunks.length > 0 && stderrLen > 0;
          const success = code === 0 && !hasStderr;
          done(success, code !== 0 ? `进程退出，退出码: ${code}` : null);
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        done(false, 'spawn error: ' + err.message);
      });

      // 超时：gateway 还在运行 → 说明启动成功，杀掉并报告"已启动"
      const timer = setTimeout(() => {
        if (resolved) return;
        try { child.kill('SIGTERM'); } catch (_) {}
        // 给 kill 一点时间再 resolve
        setTimeout(() => {
          done(true, 'Gateway 进程在 ' + (timeoutMs / 1000) + 's 内保持运行（启动正常）');
        }, 300);
      }, timeoutMs);
    });
  }
}

module.exports = StatusMonitor;

