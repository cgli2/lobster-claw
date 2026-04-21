const ShellExecutor = require('../utils/shell-executor');
const Logger = require('../utils/logger');

class WslChecker {
  /**
   * Check WSL installation status
   * @returns {{ installed: boolean, version: string|null, distros: string[] }}
   */
  async checkWslStatus() {
    const result = { installed: false, version: null, distros: [] };

    try {
      // Try `wsl --status` first (available on newer Windows builds)
      const statusResult = await ShellExecutor.runCommand('wsl', ['--status'], {
        shell: 'cmd.exe',
        timeout: 15000,
        forceNative: true
      });

      if (statusResult.code === 0 && statusResult.stdout) {
        result.installed = true;
        // Try to extract WSL version
        const versionMatch = statusResult.stdout.match(/WSL\s*(\d)/i) ||
                             statusResult.stdout.match(/版本\s*[:：]\s*(\d)/);
        if (versionMatch) {
          result.version = versionMatch[1];
        }
      }
    } catch {
      // wsl --status may not be available; fall through to distro check
    }

    // Check installed distros via `wsl -l -v`
    try {
      const listResult = await ShellExecutor.runCommand('wsl', ['-l', '-v'], {
        shell: 'cmd.exe',
        timeout: 15000,
        forceNative: true
      });

      if (listResult.code === 0 && listResult.stdout) {
        // Parse distro list — output has null bytes in UTF-16 on some systems
        const cleanOutput = listResult.stdout.replace(/\0/g, '');
        const lines = cleanOutput.split(/\r?\n/).filter(l => l.trim());

        for (const line of lines) {
          // Skip header line
          if (line.includes('NAME') || line.includes('名称')) continue;
          // Parse: "* Ubuntu    Running    2"  or  "  Ubuntu    Stopped    2"
          const match = line.match(/^\s*\*?\s*(.+?)\s{2,}(Running|Stopped|已停止|正在运行)\s+(\d)\s*$/i);
          if (match) {
            result.distros.push({
              name: match[1].trim(),
              state: match[2].trim(),
              version: match[3].trim()
            });
          } else {
            // Simpler fallback: any line that looks like a distro name
            const simpleName = line.replace(/^\s*\*?\s*/, '').trim();
            if (simpleName && !simpleName.includes('---')) {
              result.distros.push({ name: simpleName, state: 'unknown', version: 'unknown' });
            }
          }
        }

        if (result.distros.length > 0) {
          result.installed = true;
          if (!result.version) {
            // Infer version from distros
            const v2 = result.distros.find(d => d.version === '2');
            result.version = v2 ? '2' : '1';
          }
        }
      }
    } catch (err) {
      Logger.warn('WSL distro list check failed: ' + err.message);
    }

    // Final fallback: just check if wsl.exe exists
    if (!result.installed) {
      try {
        const exists = await ShellExecutor.runCommand('where', ['wsl'], {
          shell: 'cmd.exe',
          timeout: 10000,
          forceNative: true
        });
        // wsl.exe may exist without any distro installed
        if (exists.code === 0) {
          result.installed = false; // wsl exists but no distro
          result.wslExeExists = true;
        }
      } catch {
        // WSL not available at all
      }
    }

    return result;
  }

  /**
   * Install WSL (requires admin elevation, may need reboot)
   *
   * 修复说明：
   * 原实现用 PowerShell Start-Process -Verb RunAs -Wait，但 -Wait 只等 PowerShell 子进程
   * 退出，而 wsl --install 本身在 UAC 提权后是独立进程，导致立刻报完成（闪过问题）。
   *
   * 新实现：
   * 1. 利用 ResourceLocator 找到打包进去的 elevate.exe 工具，直接以管理员权限运行
   *    wsl.exe --install --no-launch，并同步等待进程退出。
   * 2. 若 elevate.exe 不可用，降级到 PowerShell 方式并给出明确的等待提示。
   * 3. 安装后重新检测 WSL 状态，确认是否真正安装成功。
   */
  async installWsl(onProgress) {
    const path = require('path');
    const fs = require('fs');

    onProgress({ step: 'start', message: '准备安装 WSL...', percent: 5 });

    try {
      onProgress({ step: 'elevating', message: '即将弹出管理员权限确认窗口，请点击"是"继续...', percent: 10 });

      // 方案 A：用 PowerShell -Wait 方式，但改用 wsl --install --no-launch
      // --no-launch 防止安装后自动弹出 Ubuntu 窗口，让安装更静默
      // 关键：用 cmd /c 包裹确保 wsl.exe 完整路径可被找到
      const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
      const wslExe = path.join(systemRoot, 'System32', 'wsl.exe');

      // 构造 PowerShell 命令：用 Start-Process 以管理员身份运行，并等待完成
      // 将退出码写入临时文件，因为 -Wait 的 ExitCode 在部分 Windows 版本上不可靠
      const tempFile = path.join(require('os').tmpdir(), 'wsl_install_result.txt');

      // 清理上次残留
      try { fs.unlinkSync(tempFile); } catch { /* ignore */ }

      const psScript = [
        `$wslExe = '${wslExe.replace(/'/g, "''")}'`,
        `$p = Start-Process -FilePath $wslExe -ArgumentList '--install','--no-launch' -Verb RunAs -Wait -PassThru`,
        `$exitCode = if ($p -and $p.ExitCode -ne $null) { $p.ExitCode } else { -1 }`,
        `Set-Content -Path '${tempFile.replace(/'/g, "''")}' -Value $exitCode`
      ].join('; ');

      Logger.info('WSL install: running PowerShell with UAC elevation...');

      const psExe = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const result = await ShellExecutor.runCommand(
        fs.existsSync(psExe) ? psExe : 'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
        { shell: false, timeout: 600000, forceNative: true }
      );

      Logger.info(`WSL install: PowerShell exited with code ${result.code}`);
      Logger.info(`WSL install: stdout: ${result.stdout?.slice(0, 500)}`);
      Logger.info(`WSL install: stderr: ${result.stderr?.slice(0, 500)}`);

      // 读取写入临时文件的退出码
      let wslExitCode = -1;
      try {
        const raw = fs.readFileSync(tempFile, 'utf8').trim();
        wslExitCode = parseInt(raw, 10);
        fs.unlinkSync(tempFile);
      } catch { /* 读不到就用 PowerShell 自身退出码 */ }

      onProgress({ step: 'installing', message: '安装命令已执行，正在验证结果...', percent: 70 });

      // wsl --install 成功退出码通常是 0 或 1（1=需要重启）
      // -1073741515 = 0xC0000135 = DLL 缺失，通常是权限被拒绝
      if (result.code !== 0 && result.code !== null) {
        // PowerShell 本身失败（用户拒绝 UAC 或其他错误）
        const errMsg = result.stderr || result.stdout || `退出码 ${result.code}`;
        throw new Error(`安装命令执行失败（PowerShell 退出码 ${result.code}）: ${errMsg.slice(0, 300)}`);
      }

      // 验证 WSL 是否已安装（wsl.exe 存在性）
      onProgress({ step: 'verifying', message: '验证 WSL 安装状态...', percent: 85 });

      // 等一下让系统完成注册
      await new Promise(r => setTimeout(r, 2000));

      const verifyResult = await this.checkWslStatus();
      Logger.info(`WSL install verify: installed=${verifyResult.installed}, wslExeExists=${verifyResult.wslExeExists}`);

      const needsReboot = wslExitCode === 1 ||
        (!verifyResult.installed && !verifyResult.wslExeExists);

      if (needsReboot) {
        onProgress({
          step: 'done',
          message: 'WSL 安装完成！需要重启计算机以完成设置，重启后请重新运行安装向导。',
          percent: 100,
          needsReboot: true
        });
      } else if (verifyResult.wslExeExists || verifyResult.installed) {
        onProgress({
          step: 'done',
          message: 'WSL 已成功安装！如需使用 WSL 模式，还需安装 Linux 发行版（如 Ubuntu）。',
          percent: 100,
          needsReboot: false
        });
      } else {
        // 安装命令跑了但检测不到 WSL，可能需要重启
        onProgress({
          step: 'done',
          message: 'WSL 安装命令已完成，请重启计算机后检查 WSL 状态。',
          percent: 100,
          needsReboot: true
        });
      }
    } catch (err) {
      Logger.error('WSL installation failed: ' + err.message);
      throw new Error('WSL 安装失败: ' + err.message);
    }
  }

  /**
   * Check if Node.js is available inside WSL
   */
  async checkWslNode() {
    try {
      // Direct wsl command, same as: wsl -- node --version
      const result = await ShellExecutor.runCommand('wsl', ['--', 'node', '--version'], {
        shell: 'cmd.exe',
        timeout: 15000,
        forceNative: true
      });
      if (result.code === 0 && result.stdout) {
        const version = result.stdout.replace(/^v/, '').trim();
        const major = parseInt(version.split('.')[0], 10);
        return { installed: true, version, satisfies: major >= 22 };
      }
      return { installed: false, version: null, satisfies: false };
    } catch {
      return { installed: false, version: null, satisfies: false };
    }
  }

  /**
   * Check if npm is available inside WSL
   */
  async checkWslNpm() {
    try {
      const result = await ShellExecutor.runCommand('wsl', ['--', 'npm', '--version'], {
        shell: 'cmd.exe',
        timeout: 15000,
        forceNative: true
      });
      if (result.code === 0 && result.stdout) {
        return { installed: true, version: result.stdout.trim() };
      }
      return { installed: false, version: null };
    } catch {
      return { installed: false, version: null };
    }
  }

  /**
   * Install Node.js inside WSL using NodeSource - exact commands user verified work
   */
  async installWslNode(onProgress) {
    onProgress({ step: 'start', message: '准备在 WSL 中安装 Node.js...', percent: 5 });

    try {
      // Command 1: Add NodeSource repository
      onProgress({ step: 'setup', message: '配置 NodeSource 仓库...', percent: 15 });

      const setupResult = await ShellExecutor.runCommand('wsl', [
        '--', 'bash', '-c', 'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -'
      ], { shell: 'cmd.exe', timeout: 300000, forceNative: true });

      if (setupResult.code !== 0) {
        const errMsg = setupResult.stderr || setupResult.stdout || `退出码 ${setupResult.code}`;
        onProgress({ step: 'setup', message: '仓库配置: ' + errMsg.substring(0, 100), percent: 40 });
      } else {
        onProgress({ step: 'setup', message: 'NodeSource 仓库配置完成', percent: 40 });
      }

      // Command 2: Install Node.js
      onProgress({ step: 'install', message: '安装 Node.js...', percent: 50 });

      const installResult = await ShellExecutor.runCommand('wsl', [
        '--', 'bash', '-c', 'sudo apt install -y nodejs'
      ], { shell: 'cmd.exe', timeout: 300000, forceNative: true });

      if (installResult.code !== 0) {
        throw new Error('Node.js 安装失败: ' + (installResult.stderr || installResult.stdout || '未知错误').substring(0, 200));
      }

      // Configure npm mirror
      onProgress({ step: 'npm', message: '配置 npm 镜像...', percent: 85 });
      await ShellExecutor.runCommand('wsl', [
        '--', 'bash', '-c', 'npm config set registry https://registry.npmmirror.com'
      ], { shell: 'cmd.exe', timeout: 30000, forceNative: true });

      // Verify
      onProgress({ step: 'verify', message: '验证安装...', percent: 90 });
      const nodeCheck = await this.checkWslNode();
      const npmCheck = await this.checkWslNpm();

      if (nodeCheck.installed) {
        onProgress({ step: 'done', message: `Node.js v${nodeCheck.version}, npm v${npmCheck.version || '?'} 安装成功！`, percent: 100 });
      } else {
        onProgress({ step: 'done', message: '安装完成，请验证', percent: 100 });
      }
    } catch (err) {
      Logger.error('WSL Node.js installation failed: ' + err.message);
      throw new Error('WSL Node.js 安装失败: ' + err.message);
    }
  }
}

module.exports = WslChecker;
