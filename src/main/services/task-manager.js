/**
 * TaskManager - 定时任务管理服务
 * 
 * 功能：
 * 1. 管理 OpenClaw 定时任务（cron jobs）
 * 2. 通过 openclaw cron 命令与 Gateway 交互
 */

const { spawn } = require('child_process');
const ShellExecutor = require('../utils/shell-executor');
const Logger = require('../utils/logger');
const { getNpmPrefix } = require('../utils/paths');
const path = require('path');
const fs = require('fs');
const os = require('os');

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
 */
function findOpenclawPath() {
  const homeDir = os.homedir();
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';

  const npmPrefix = getNpmPrefix();
  const possiblePaths = [
    // npm 全局安装路径（优先使用配置的 prefix）
    path.join(npmPrefix, 'openclaw.cmd'),
    // AppData Roaming npm 路径
    path.join(homeDir, 'AppData', 'Roaming', 'npm', 'openclaw.cmd'),
    path.join(homeDir, 'AppData', 'Roaming', 'npm', 'openclaw.exe'),
    // 其他常见路径
    path.join(homeDir, '.npm', 'global', 'openclaw.cmd'),
    // Program Files 安装（使用环境变量）
    path.join(programFiles, 'nodejs', 'openclaw.cmd'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      Logger.info('Found openclaw at: ' + p);
      return p;
    }
  }

  return null;
}

class TaskManager {
  constructor() {
    this.openclawPath = null;
    this._listCache = null;      // { jobs, timestamp }
    this._listCacheTTL = 30000; // 30 秒有效
    Logger.info('TaskManager initialized');
  }

  /** 判断缓存是否有效 */
  _isCacheValid() {
    return this._listCache && (Date.now() - this._listCache.timestamp < this._listCacheTTL);
  }

  /** 主动清除列表缓存（创建/删除/启用/禁用后调用） */
  _invalidateCache() {
    this._listCache = null;
  }

  /**
   * 获取 openclaw 命令路径
   */
  _getOpenclawCmd() {
    if (!this.openclawPath) {
      this.openclawPath = findOpenclawPath();
    }
    return this.openclawPath || 'openclaw';
  }

  /**
   * 构建包含必要 PATH 的环境变量
   */
  _buildEnv() {
    const env = { ...process.env };
    const homeDir = os.homedir();
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    const nodePaths = [
      path.join(programFiles, 'nodejs'),
      path.join(programFilesX86, 'nodejs'),
      path.join(homeDir, 'nvm4w', 'nodejs'),
      path.join(homeDir, 'nvm', 'nodejs'),
      'C:\\nodejs',
    ];

    const npmGlobalPaths = [
      getNpmPrefix(),
      path.join(getNpmPrefix(), 'bin'),
      path.join(homeDir, 'AppData', 'Roaming', 'npm'),
      path.join(homeDir, '.npm', 'global'),
    ];

    const allPaths = [...nodePaths, ...npmGlobalPaths];
    const existingPaths = (env.PATH || '').split(';').filter(p => p.trim());
    allPaths.push(...existingPaths);

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
    return env;
  }

  /**
   * 查找系统安装的 Node.js 路径（需要 v22.12+，因为 openclaw 需要此版本）
   */
  _findSystemNodePath() {
    const homeDir = os.homedir();
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    
    // 可能的 Node.js 安装路径（按优先级排序）
    const possiblePaths = [
      // nvm4w 安装（用户配置的路径）
      'D:\\programs\\nvm4w\\nodejs\\node.exe',
      path.join(homeDir, 'nvm4w', 'nodejs', 'node.exe'),
      path.join(homeDir, 'nvm', 'nodejs', 'node.exe'),
      // Program Files 安装
      path.join(programFiles, 'nodejs', 'node.exe'),
      path.join(programFilesX86, 'nodejs', 'node.exe'),
      // 其他常见路径
      'C:\\nodejs\\node.exe',
    ];
    
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        Logger.info('Found system Node.js at: ' + p);
        return p;
      }
    }
    
    return null;
  }

  /**
   * 执行 openclaw cron 命令
   */
  async _runCronCommand(args, timeout = 30000) {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      const env = this._buildEnv();
      const homeDir = os.homedir();
      
      // 找到 openclaw 的实际路径
      const openclawModulePath = path.join(getNpmPrefix(), 'node_modules', 'openclaw', 'openclaw.mjs');
      
      // 找到系统安装的 Node.js（openclaw 需要 v22.12+）
      const systemNodePath = this._findSystemNodePath();
      if (!systemNodePath) {
        resolve({ 
          success: false, 
          error: '找不到系统安装的 Node.js v22.12+，请确保已安装 Node.js 并添加到 PATH' 
        });
        return;
      }
      
      // 构建参数列表，使用 "=" 分隔符来处理带空格的值
      // 这是解决 Windows CMD 参数解析问题的最可靠方法
      const formattedArgs = [];
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        // 检查是否是选项名（以 -- 开头）且不是标志（如 --json, --disabled）
        if (arg.startsWith('--') && i + 1 < args.length && !args[i + 1].startsWith('--')) {
          const nextArg = args[i + 1];
          // 使用 = 分隔符保持一致性
          formattedArgs.push(`${arg}=${nextArg}`);
          i++; // 跳过下一个参数
        } else {
          // 标志参数（如 --json, --disabled）直接添加
          formattedArgs.push(arg);
        }
      }
      
      const fullArgs = [openclawModulePath, 'cron', ...formattedArgs];
      Logger.info(`Executing: ${systemNodePath} ${fullArgs.join(' ')}`);
      
      const child = spawn(systemNodePath, fullArgs, {
        env: env,
        cwd: path.dirname(openclawModulePath),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const timer = setTimeout(() => {
        killed = true;
        child.kill();
        resolve({ success: false, error: 'Timeout', stdout, stderr });
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
          // 尝试从输出中提取 JSON
          let jsonData = null;
          try {
            // 查找 JSON 对象（可能在其他输出之后）
            const jsonMatch = stdout.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              jsonData = JSON.parse(jsonMatch[0]);
            }
          } catch (e) {
            // JSON 解析失败，返回原始输出
          }

          resolve({
            success: code === 0,
            code,
            stdout,
            stderr,
            data: jsonData
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        if (!killed) {
          resolve({ success: false, error: err.message, stdout, stderr });
        }
      });
    });
  }

  /**
   * 判断错误是否为 Gateway 暂时性连接问题（如重启中）
   * 这类错误不应向用户展示，优先使用缓存数据
   */
  _isGatewayTransientError(errorMsg) {
    if (!errorMsg) return false;
    const msg = errorMsg.toLowerCase();
    return msg.includes('gateway closed') ||
           msg.includes('1006') ||
           msg.includes('abnormalclosure') ||
           msg.includes('econnrefused') ||
           msg.includes('connect econnrefused') ||
           msg.includes('socket hang up');
  }

  /**
   * 获取任务列表（带缓存）
   */
  async listTasks(includeDisabled = true, useCache = true) {
    // 返回缓存（如果未过期且不是强制刷新）
    if (useCache && this._isCacheValid()) {
      Logger.info('TaskManager: returning cached tasks list');
      return { success: true, jobs: this._listCache.jobs, fromCache: true };
    }

    try {
      const args = ['list', '--json'];
      if (includeDisabled) {
        args.push('--all');
      }

      const result = await this._runCronCommand(args, 30000);

      if (result.success && result.data) {
        const jobs = result.data.jobs || [];
        // 更新缓存
        this._listCache = {
          jobs,
          timestamp: Date.now()
        };
        return {
          success: true,
          jobs,
          total: result.data.total || 0,
          hasMore: result.data.hasMore || false
        };
      }

      // ★ 如果失败原因是 Gateway 连接问题（重启中），返回缓存数据而非报错
      const errorMsg = result.stderr || result.error || '';
      if (this._isGatewayTransientError(errorMsg) && this._listCache) {
        Logger.info('TaskManager: gateway transient error, returning stale cache');
        return { success: true, jobs: this._listCache.jobs, fromCache: true, stale: true };
      }

      return {
        success: false,
        error: result.stderr || result.error || '获取任务列表失败',
        jobs: []
      };
    } catch (err) {
      Logger.error('listTasks error: ' + err.message);
      // ★ 同样，catch 中也检查是否为 Gateway 暂时性错误
      if (this._isGatewayTransientError(err.message) && this._listCache) {
        Logger.info('TaskManager: gateway transient error (exception), returning stale cache');
        return { success: true, jobs: this._listCache.jobs, fromCache: true, stale: true };
      }
      return { success: false, error: err.message, jobs: [] };
    }
  }

  /**
   * 创建新任务
   */
  async createTask(options) {
    try {
      const args = ['add', '--json'];

      // 必需参数
      if (options.name) {
        args.push('--name', options.name);
      }
      if (options.message) {
        args.push('--message', options.message);
      }

      // 调度方式
      if (options.cron) {
        args.push('--cron', options.cron);
      } else if (options.every) {
        args.push('--every', options.every);
      } else if (options.at) {
        args.push('--at', options.at);
      }

      // 可选参数
      if (options.tz) {
        args.push('--tz', options.tz);
      }
      if (options.model) {
        args.push('--model', options.model);
      }
      if (options.session) {
        args.push('--session', options.session);
      }
      if (options.description) {
        args.push('--description', options.description);
      }
      if (options.timeout) {
        args.push('--timeout', String(options.timeout));
      }
      if (options.disabled) {
        args.push('--disabled');
      }

      // 投递选项
      if (options.announce) {
        args.push('--announce');
      }
      if (options.channel) {
        args.push('--channel', options.channel);
      }
      if (options.to) {
        args.push('--to', options.to);
      }

      const result = await this._runCronCommand(args, 30000);
      
      if (result.success && result.data) {
        return {
          success: true,
          job: result.data.job || result.data
        };
      }

      return {
        success: false,
        error: result.stderr || result.error || '创建任务失败'
      };
    } catch (err) {
      Logger.error('createTask error: ' + err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * 编辑任务
   */
  async editTask(taskId, options) {
    try {
      // edit 命令不支持 --json 参数
      const args = ['edit', taskId];

      if (options.name !== undefined) {
        args.push('--name', options.name);
      }
      if (options.message !== undefined) {
        args.push('--message', options.message);
      }
      if (options.cron !== undefined) {
        args.push('--cron', options.cron);
      }
      if (options.every !== undefined) {
        args.push('--every', options.every);
      }
      if (options.tz !== undefined) {
        args.push('--tz', options.tz);
      }
      if (options.model !== undefined) {
        args.push('--model', options.model);
      }
      if (options.description !== undefined) {
        args.push('--description', options.description);
      }
      if (options.timeout !== undefined) {
        args.push('--timeout', String(options.timeout));
      }

      // 投递选项
      if (options.announce !== undefined) {
        if (options.announce) {
          args.push('--announce');
        } else {
          args.push('--no-deliver');
        }
      }
      if (options.channel !== undefined) {
        args.push('--channel', options.channel);
      }
      if (options.to !== undefined) {
        args.push('--to', options.to);
      }

      const result = await this._runCronCommand(args, 30000);
      
      // 检查 stderr 是否有错误信息
      const hasError = result.stderr && (
        result.stderr.includes('error') || 
        result.stderr.includes('Error') ||
        result.stderr.includes('failed') ||
        result.stderr.includes('unknown option')
      );
      
      if (result.success && !hasError) {
        this._invalidateCache(); // 清除缓存
        return { success: true };
      }

      return {
        success: false,
        error: this._extractError(result.stderr || result.error || '编辑任务失败')
      };
    } catch (err) {
      Logger.error('editTask error: ' + err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * 启用任务
   */
  async enableTask(taskId) {
    try {
      // enable/disable 命令不支持 --json 参数
      const result = await this._runCronCommand(['enable', taskId], 15000);
      
      // 即使命令成功，也需要检查 stderr 是否有错误信息
      const hasError = result.stderr && (
        result.stderr.includes('error') || 
        result.stderr.includes('Error') ||
        result.stderr.includes('failed')
      );
      
      if (result.success && !hasError) {
        this._invalidateCache(); // 清除缓存
        return { success: true };
      }

      return {
        success: false,
        error: this._extractError(result.stderr || result.error || '启用任务失败')
      };
    } catch (err) {
      Logger.error('enableTask error: ' + err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * 禁用任务
   */
  async disableTask(taskId) {
    try {
      // enable/disable 命令不支持 --json 参数
      const result = await this._runCronCommand(['disable', taskId], 15000);

      // 检查 stderr 是否有错误信息
      const hasError = result.stderr && (
        result.stderr.includes('error') ||
        result.stderr.includes('Error') ||
        result.stderr.includes('failed')
      );

      if (result.success && !hasError) {
        this._invalidateCache(); // 清除缓存
        return { success: true };
      }

      return {
        success: false,
        error: this._extractError(result.stderr || result.error || '禁用任务失败')
      };
    } catch (err) {
      Logger.error('disableTask error: ' + err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * 删除任务
   */
  async deleteTask(taskId) {
    try {
      // rm 命令不支持 --json 参数
      const result = await this._runCronCommand(['rm', taskId], 15000);
      
      // 检查 stderr 是否有错误信息
      const hasError = result.stderr && (
        result.stderr.includes('error') || 
        result.stderr.includes('Error') ||
        result.stderr.includes('failed') ||
        result.stderr.includes('not found')
      );
      
      if (result.success && !hasError) {
        // 验证任务是否真的被删除了 - 再次列出任务检查（使用force刷新）
        const verifyResult = await this.listTasks(true, false);
        if (verifyResult.success) {
          const stillExists = verifyResult.jobs.some(job => job.id === taskId);
          if (stillExists) {
            Logger.warn('Task still exists after deletion: ' + taskId);
            return { success: false, error: '任务删除失败：任务仍然存在' };
          }
        }
        this._invalidateCache(); // 清除缓存
        return { success: true };
      }

      return {
        success: false,
        error: this._extractError(result.stderr || result.error || '删除任务失败')
      };
    } catch (err) {
      Logger.error('deleteTask error: ' + err.message);
      return { success: false, error: err.message };
    }
  }
  
  /**
   * 从 stderr 中提取有用的错误信息
   */
  _extractError(stderr) {
    if (!stderr) return '未知错误';
    
    // 过滤掉 ANSI 颜色代码和无关信息
    const lines = stderr.split('\n');
    const errorLines = [];
    
    for (const line of lines) {
      const cleanLine = line
        .replace(/\x1b\[[0-9;]*m/g, '')  // 移除 ANSI 颜色代码
        .replace(/\[.*?\]/g, '')          // 移除 [agents/xxx] 前缀
        .trim();
      
      // 只保留包含有用信息的行
      if (cleanLine && 
          !cleanLine.includes('ignored invalid auth') &&
          !cleanLine.includes('store load') &&
          (cleanLine.includes('error') || 
           cleanLine.includes('Error') || 
           cleanLine.includes('failed') ||
           cleanLine.includes('unknown option') ||
           cleanLine.includes('not found'))) {
        errorLines.push(cleanLine);
      }
    }
    
    return errorLines.length > 0 ? errorLines.join('; ') : stderr;
  }

  /**
   * 立即运行任务
   */
  async runTask(taskId) {
    try {
      // run 命令不支持 --json 参数
      const result = await this._runCronCommand(['run', taskId], 60000);
      
      // 检查 stderr 是否有错误信息
      const hasError = result.stderr && (
        result.stderr.includes('error') || 
        result.stderr.includes('Error') ||
        result.stderr.includes('failed') ||
        result.stderr.includes('unknown option')
      );
      
      if (result.success && !hasError) {
        return { success: true, output: result.stdout };
      }

      return {
        success: false,
        error: this._extractError(result.stderr || result.error || '运行任务失败')
      };
    } catch (err) {
      Logger.error('runTask error: ' + err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * 获取任务执行历史
   * @param {string|null} taskId - 任务ID，如果为null则获取所有任务的历史
   * @param {number} limit - 返回记录数量限制
   */
  async getTaskHistory(taskId, limit = 50) {
    try {
      // runs 命令必须指定 --id 参数
      // 如果没有指定 taskId，返回空列表（不支持获取所有任务的历史）
      if (!taskId) {
        return {
          success: true,
          runs: [],
          total: 0
        };
      }

      // runs 命令不支持 --json 参数
      const args = ['runs', '--id', taskId, '--limit', String(limit)];

      const result = await this._runCronCommand(args, 30000);
      
      // 检查 stderr 是否有错误信息
      const hasError = result.stderr && (
        result.stderr.includes('error') || 
        result.stderr.includes('Error') ||
        result.stderr.includes('failed') ||
        result.stderr.includes('not specified') ||
        result.stderr.includes('unknown option')
      );
      
      if (result.success && !hasError) {
        // 尝试从 stdout 解析 JSON 数据
        let runs = [];
        if (result.stdout) {
          try {
            // 尝试解析 JSON 数组
            const jsonMatch = result.stdout.match(/\[[\s\S]*?\]/);
            if (jsonMatch) {
              runs = JSON.parse(jsonMatch[0]);
            } else {
              // 尝试解析单个对象或包含 runs 字段的对象
              const objMatch = result.stdout.match(/\{[\s\S]*?\}/);
              if (objMatch) {
                const obj = JSON.parse(objMatch[0]);
                runs = obj.runs || [obj];
              }
            }
          } catch (e) {
            Logger.warn('Failed to parse runs output: ' + e.message);
          }
        }
        
        return {
          success: true,
          runs: runs,
          total: runs.length
        };
      }

      return {
        success: false,
        error: this._extractError(result.stderr || result.error || '获取历史记录失败'),
        runs: []
      };
    } catch (err) {
      Logger.error('getTaskHistory error: ' + err.message);
      return { success: false, error: err.message, runs: [] };
    }
  }

  /**
   * 获取调度器状态
   */
  async getSchedulerStatus() {
    try {
      const result = await this._runCronCommand(['status', '--json'], 15000);
      
      if (result.success && result.data) {
        return {
          success: true,
          status: result.data
        };
      }

      return {
        success: false,
        error: result.stderr || result.error || '获取状态失败'
      };
    } catch (err) {
      Logger.error('getSchedulerStatus error: ' + err.message);
      return { success: false, error: err.message };
    }
  }
}

module.exports = TaskManager;
