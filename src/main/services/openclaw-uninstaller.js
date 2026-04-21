const ShellExecutor = require('../utils/shell-executor');
const Logger = require('../utils/logger');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { getNpmPrefix } = require('../utils/paths');

/**
 * 递归删除目录（Node.js 原生，不依赖外部命令）
 * 作为第一道防线，失败了再用 PowerShell 补救
 */
function removeDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) return { ok: true, skipped: true };
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
    return { ok: !fs.existsSync(dirPath) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * 用 PowerShell Remove-Item 强制删除目录（处理权限/锁定问题）
 */
async function removeDirPowerShell(dirPath) {
  try {
    await ShellExecutor.runCommand(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
       `Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "${dirPath}"`],
      { forceNative: true, timeout: 30000 }
    );
    return { ok: !fs.existsSync(dirPath) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * 双保险删除：先 Node fs，再 PowerShell，最后检查
 */
async function removeDir(dirPath, label) {
  if (!fs.existsSync(dirPath)) {
    Logger.info(`[uninstall] ${label} not found, skip: ${dirPath}`);
    return { ok: true, skipped: true };
  }

  Logger.info(`[uninstall] Removing ${label}: ${dirPath}`);

  // 第一道：Node.js 原生 fs.rmSync
  const r1 = removeDirSync(dirPath);
  if (r1.ok) {
    Logger.info(`[uninstall] ${label} removed by Node fs`);
    return { ok: true };
  }
  Logger.warn(`[uninstall] Node fs failed for ${label}: ${r1.error}, trying PowerShell...`);

  // 第二道：PowerShell Remove-Item
  const r2 = await removeDirPowerShell(dirPath);
  if (r2.ok) {
    Logger.info(`[uninstall] ${label} removed by PowerShell`);
    return { ok: true };
  }

  Logger.error(`[uninstall] Failed to remove ${label}: ${r2.error}`);
  return { ok: false, error: r2.error || '权限不足，无法删除目录' };
}

class OpenClawUninstaller {
  /**
   * 完整卸载 OpenClaw
   *
   * Steps:
   *  1. Stop gateway process
   *  2. Clean up legacy schtasks service
   *  3. Remove ~/.openclaw config directory
   *  4. npm uninstall -g openclaw
   *  5. Remove npm global install files (node_modules/openclaw + .bin/openclaw*)
   *  6. Remove any other remaining files
   *  7. Verify
   */
  async uninstall(onProgress) {
    const mode = ShellExecutor.getExecutionMode();
    const homeDir = os.homedir();
    const configDir = path.join(homeDir, '.openclaw');
    const npmPrefix = getNpmPrefix();

    onProgress({ step: 'start', message: '准备卸载 OpenClaw...', percent: 0 });

    // ── Step 1: Stop gateway ─────────────────────────────────────────
    onProgress({ step: 'gateway-stop', message: '停止 Gateway 进程...', percent: 8 });
    try {
      const ServiceController = require('./service-controller');
      const svc = new ServiceController();
      const result = await svc.stop();
      Logger.info('Gateway stop: ' + result.output);
      onProgress({ step: 'gateway-stop', message: '✓ ' + (result.output || 'Gateway 已停止'), percent: 15 });
    } catch (err) {
      Logger.warn('Gateway stop failed (non-fatal): ' + err.message);
      onProgress({ step: 'gateway-stop', message: 'Gateway 停止失败（继续卸载）', percent: 15 });
    }

    // ── Step 2: Uninstall legacy schtasks service ────────────────────
    onProgress({ step: 'gateway-uninstall', message: '清理 Gateway 服务...', percent: 18 });
    try {
      if (mode === 'wsl') {
        await ShellExecutor.runCommand('wsl', ['--exec', 'bash', '-c',
          'export PATH="$HOME/.npm-global/bin:$PATH" LANG=zh_CN.UTF-8 LC_ALL=zh_CN.UTF-8 && openclaw gateway uninstall 2>/dev/null || true'],
          { timeout: 15000, forceNative: true });
      } else {
        await ShellExecutor.runCommand('openclaw', ['gateway', 'uninstall'], { timeout: 15000 });
      }
    } catch { /* non-fatal */ }
    onProgress({ step: 'gateway-uninstall', message: '✓ 服务清理完成', percent: 22 });

    // ── Step 3: Remove ~/.openclaw config directory ──────────────────
    onProgress({ step: 'remove-config', message: '删除配置目录 ~/.openclaw ...', percent: 25 });
    try {
      if (mode === 'wsl') {
        // WSL 内也要删
        await ShellExecutor.runCommand('wsl', ['--exec', 'bash', '-c',
          'LANG=zh_CN.UTF-8 LC_ALL=zh_CN.UTF-8 rm -rf ~/.openclaw'],
          { timeout: 30000, forceNative: true });
        Logger.info('WSL config dir removed');
      }

      // Windows 侧删除（双保险）
      const r = await removeDir(configDir, '~/.openclaw');
      if (r.skipped) {
        onProgress({ step: 'remove-config', message: '配置目录不存在，跳过', percent: 35 });
      } else if (r.ok) {
        onProgress({ step: 'remove-config', message: '✓ 配置目录已删除：' + configDir, percent: 35 });
      } else {
        onProgress({ step: 'remove-config', message: `⚠ 配置目录删除失败（${r.error}），继续卸载...`, percent: 35 });
      }
    } catch (err) {
      Logger.warn('Remove config dir failed: ' + err.message);
      onProgress({ step: 'remove-config', message: `⚠ 配置目录删除异常：${err.message}，继续卸载...`, percent: 35 });
    }

    // ── Step 4: npm uninstall -g openclaw ────────────────────────────
    onProgress({ step: 'npm-uninstall', message: '执行 npm uninstall -g openclaw ...', percent: 38 });
    try {
      let lastPercent = 38;

      if (mode === 'wsl') {
        const cmd = 'export PATH=$HOME/.npm-global/bin:$PATH LANG=zh_CN.UTF-8 LC_ALL=zh_CN.UTF-8 && npm uninstall -g openclaw';
        const exitCode = await ShellExecutor.streamCommand(
          'wsl', ['--exec', 'bash', '-c', cmd],
          (line) => { lastPercent = Math.min(lastPercent + 2, 62); onProgress({ step: 'npm-uninstall', message: line, percent: lastPercent }); },
          (errLine) => { Logger.warn('npm uninstall stderr: ' + errLine); },
          { timeout: 120000, forceNative: true }
        );
        if (exitCode !== 0) throw new Error(`npm uninstall 退出码 ${exitCode}`);
      } else {
        const exitCode = await ShellExecutor.streamCommand(
          'npm', ['uninstall', '-g', 'openclaw'],
          (line) => { lastPercent = Math.min(lastPercent + 2, 62); onProgress({ step: 'npm-uninstall', message: line, percent: lastPercent }); },
          (errLine) => { Logger.warn('npm uninstall stderr: ' + errLine); },
          { timeout: 120000 }
        );
        if (exitCode !== 0) throw new Error(`npm uninstall 退出码 ${exitCode}`);
      }
      onProgress({ step: 'npm-uninstall', message: '✓ npm 全局包已卸载', percent: 65 });
    } catch (err) {
      Logger.warn('npm uninstall failed (non-fatal, will clean manually): ' + err.message);
      onProgress({ step: 'npm-uninstall', message: `npm 卸载命令失败（${err.message}），尝试手动清理...`, percent: 65 });
    }

    // ── Step 5: 手动删除 npm 安装目录（最关键的一步）────────────────
    // npm uninstall 失败/遗漏时，直接删文件系统确保彻底清除
    onProgress({ step: 'remove-remaining', message: '清理 npm 安装目录...', percent: 68 });

    // 所有可能的 npm prefix 路径（含自定义 prefix）
    const npmPrefixes = [
      npmPrefix,
      path.join(homeDir, '.npm-global'),
      path.join(homeDir, 'AppData', 'Roaming', 'npm'),
    ].filter((v, i, arr) => arr.indexOf(v) === i); // 去重

    let removedCount = 0;
    let percent = 68;

    for (const prefix of npmPrefixes) {
      // 删 node_modules/openclaw 目录
      const modDir = path.join(prefix, 'node_modules', 'openclaw');
      if (fs.existsSync(modDir)) {
        const r = await removeDir(modDir, `node_modules/openclaw in ${prefix}`);
        if (r.ok) {
          removedCount++;
          percent = Math.min(percent + 5, 85);
          onProgress({ step: 'remove-remaining', message: `✓ 已删除 ${modDir}`, percent });
        } else {
          onProgress({ step: 'remove-remaining', message: `⚠ 删除失败 ${modDir}: ${r.error}`, percent });
        }
      }

      // 删 .bin/ 下的 openclaw 相关文件
      const binDir = path.join(prefix, 'node_modules', '.bin');
      const binFiles = ['openclaw', 'openclaw.cmd', 'openclaw.ps1'];
      for (const fname of binFiles) {
        const fpath = path.join(binDir, fname);
        if (fs.existsSync(fpath)) {
          try {
            fs.unlinkSync(fpath);
            Logger.info(`[uninstall] Removed bin file: ${fpath}`);
            removedCount++;
          } catch (err) {
            Logger.warn(`[uninstall] Failed to remove ${fpath}: ${err.message}`);
          }
        }
      }

      // 删 prefix 根目录下的 openclaw.cmd / openclaw.ps1 / openclaw
      const rootBinFiles = ['openclaw', 'openclaw.cmd', 'openclaw.ps1'];
      for (const fname of rootBinFiles) {
        const fpath = path.join(prefix, fname);
        if (fs.existsSync(fpath)) {
          try {
            fs.unlinkSync(fpath);
            Logger.info(`[uninstall] Removed root bin file: ${fpath}`);
            removedCount++;
          } catch (err) {
            Logger.warn(`[uninstall] Failed to remove ${fpath}: ${err.message}`);
          }
        }
      }
    }

    // 清理旧版 OneClaw / ClawWindows 路径
    const legacyDirs = [
      path.join(homeDir, 'AppData', 'Local', 'OneClaw'),
      path.join(homeDir, 'AppData', 'Roaming', 'ClawWindows', 'core_runtime', 'node_modules', 'openclaw'),
    ];
    for (const d of legacyDirs) {
      if (fs.existsSync(d)) {
        const r = await removeDir(d, d);
        if (r.ok) removedCount++;
      }
    }

    percent = Math.min(percent + 5, 88);
    onProgress({ step: 'remove-remaining', message: `✓ 文件清理完成（共清理 ${removedCount} 项）`, percent });

    // ── Step 6: Verify ──────────────────────────────────────────────
    onProgress({ step: 'verify', message: '验证卸载结果...', percent: 92 });

    const remaining = [];
    // 检查配置目录
    if (fs.existsSync(configDir)) remaining.push('~/.openclaw 目录仍存在');
    // 检查 npm 安装目录
    for (const prefix of npmPrefixes) {
      const modDir = path.join(prefix, 'node_modules', 'openclaw');
      if (fs.existsSync(modDir)) remaining.push(`${modDir} 仍存在`);
    }

    const cmdExists = await ShellExecutor.commandExists('openclaw');

    if (remaining.length === 0 && !cmdExists) {
      onProgress({ step: 'done', message: '✅ OpenClaw 已完全卸载，欢迎重新安装', percent: 100 });
    } else {
      const details = remaining.length > 0
        ? remaining.join('；')
        : 'openclaw 命令仍可访问（可能需要重启终端）';
      Logger.warn('[uninstall] Incomplete: ' + details);
      onProgress({ step: 'done', message: `⚠ 卸载基本完成，但部分文件未能删除：${details}`, percent: 100 });
    }
  }
}

module.exports = OpenClawUninstaller;
