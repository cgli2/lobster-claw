const fs = require('fs');
const path = require('path');
const os = require('os');
const ResourceLocator = require('./resource-locator');
const Logger = require('./logger');

/**
 * 诊断工具 - 用于检测和报告系统状态
 */
class Diagnostics {
  /**
   * 运行完整的系统诊断
   */
  static async runFullDiagnostic() {
    const results = {
      timestamp: new Date().toISOString(),
      system: Diagnostics.checkSystem(),
      resources: Diagnostics.checkResources(),
      openclaw: await Diagnostics.checkOpenClawStatus(),
      summary: []
    };

    // 生成总结
    const issues = [];
    if (!results.system.node.installed) issues.push('Node.js 未安装');
    else if (!results.system.node.satisfies) issues.push('Node.js 版本过低（需要 22+）');

    if (!results.system.npm.installed) issues.push('npm 未安装');
    if (!results.system.git.installed) issues.push('Git 未安装');

    if (!results.resources.nodeInstaller) issues.push('Node.js 安装包缺失');
    if (!results.resources.gitInstaller) issues.push('Git 安装包缺失（可选）');

    if (!results.openclaw.installed) issues.push('OpenClaw 未安装');

    if (issues.length === 0) {
      results.summary.push('✓ 所有检查通过');
    } else {
      results.summary.push('✗ 发现以下问题：');
      results.summary.push(...issues);
    }

    return results;
  }

  /**
   * 检查系统环境
   */
  static checkSystem() {
    const { execSync } = require('child_process');

    const getNodeVersion = () => {
      try {
        const output = execSync('node --version', { encoding: 'utf8' }).trim();
        const match = output.match(/v(\d+)\.\d+\.\d+/);
        if (match) {
          const version = match[1];
          return { installed: true, version: output, satisfies: parseInt(version) >= 22 };
        }
      } catch {}
      return { installed: false, version: null, satisfies: false };
    };

    const getNpmVersion = () => {
      try {
        const output = execSync('npm --version', { encoding: 'utf8' }).trim();
        return { installed: true, version: output };
      } catch {}
      return { installed: false, version: null };
    };

    const getGitVersion = () => {
      try {
        const output = execSync('git --version', { encoding: 'utf8' }).trim();
        const match = output.match(/git version (\d+\.\d+\.\d+)/);
        if (match) {
          return { installed: true, version: match[1] };
        }
      } catch {}
      return { installed: false, version: null };
    };

    return {
      platform: os.platform(),
      arch: os.arch(),
      node: getNodeVersion(),
      npm: getNpmVersion(),
      git: getGitVersion(),
      homedir: os.homedir(),
      userProfile: process.env.USERPROFILE
    };
  }

  /**
   * 检查资源文件
   */
  static checkResources() {
    const nodeInstaller = ResourceLocator.getNodeJsInstaller();
    const gitInstaller = ResourceLocator.getGitInstaller();

    return {
      nodeInstaller: !!nodeInstaller,
      nodeInstallerPath: nodeInstaller || null,
      gitInstaller: !!gitInstaller,
      gitInstallerPath: gitInstaller || null,
      resourcesRoot: ResourceLocator.getResourcesRoot(),
      isPackaged: ResourceLocator.isPackaged()
    };
  }

  /**
   * 检查 OpenClaw 状态
   */
  static async checkOpenClawStatus() {
    const ShellExecutor = require('./shell-executor');
    const homeDir = os.homedir();
    const configPath = path.join(homeDir, '.openclaw');

    // 检查配置目录
    const configExists = fs.existsSync(configPath);
    let configContent = null;

    if (configExists) {
      try {
        const configFile = path.join(configPath, 'openclaw.json');
        if (fs.existsSync(configFile)) {
          configContent = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        }
      } catch (err) {
        configContent = { error: err.message };
      }
    }

    // 检查版本
    const OpenClawInstaller = require('../services/openclaw-installer');
    const installer = new OpenClawInstaller();
    const version = await installer.getVersion();

    return {
      installed: await ShellExecutor.checkOpenClawInstalled(),
      configExists,
      configPath,
      version,
      configContent
    };
  }

  /**
   * 生成诊断报告
   */
  static generateReport(results) {
    let report = '';

    report += '=== OpenClaw 安装管理器诊断报告 ===\n';
    report += `生成时间: ${results.timestamp}\n\n`;

    report += '--- 系统环境 ---\n';
    report += `操作系统: ${results.system.platform} ${results.system.arch}\n`;
    report += `用户目录: ${results.system.userProfile}\n`;
    report += `Node.js: ${results.system.node.installed ? `已安装 (${results.system.node.version})` : '未安装'}\n`;
    report += `npm: ${results.system.npm.installed ? `已安装 (${results.system.npm.version})` : '未安装'}\n`;
    report += `Git: ${results.system.git.installed ? `已安装 (${results.system.git.version})` : '未安装'}\n\n`;

    report += '--- 资源文件 ---\n';
    report += `运行模式: ${results.resources.isPackaged ? '打包环境' : '开发环境'}\n`;
    report += `资源根目录: ${results.resources.resourcesRoot}\n`;
    report += `Node.js 安装包: ${results.resources.nodeInstaller ? `存在 (${results.resources.nodeInstallerPath})` : '缺失'}\n`;
    report += `Git 安装包: ${results.resources.gitInstaller ? `存在 (${results.resources.gitInstallerPath})` : '缺失'}\n\n`;

    report += '--- OpenClaw 状态 ---\n';
    report += `已安装: ${results.openclaw.installed ? '是' : '否'}\n`;
    report += `版本: ${results.openclaw.version || '未知'}\n`;
    report += `配置目录: ${results.openclaw.configExists ? `存在 (${results.openclaw.configPath})` : '不存在'}\n\n`;

    report += '--- 总结 ---\n';
    results.summary.forEach(line => report += line + '\n');

    return report;
  }

  /**
   * 保存诊断报告到文件
   */
  static async saveReportToFile() {
    const results = await Diagnostics.runFullDiagnostic();
    const report = Diagnostics.generateReport(results);

    const reportPath = path.join(os.homedir(), 'openclaw-installer-diagnostic.txt');
    fs.writeFileSync(reportPath, report, 'utf8');

    return reportPath;
  }
}

module.exports = Diagnostics;
