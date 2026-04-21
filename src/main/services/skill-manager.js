const fs = require('fs');
const path = require('path');
const http = require('http');
const ShellExecutor = require('../utils/shell-executor');
const Logger = require('../utils/logger');
const { OPENCLAW_HOME, CONFIG_PATH } = require('../utils/paths');
const { network, timeouts } = require('../config/defaults');

class SkillManager {
  constructor() {
    this._listCache = null;      // { skills, timestamp }
    this._listCacheTTL = 60000; // 60 秒有效（增加到1分钟，减少CLI调用频率）
  }

  /** 判断缓存是否有效 */
  _isCacheValid() {
    return this._listCache && (Date.now() - this._listCache.timestamp < this._listCacheTTL);
  }

  /** 主动清除列表缓存（安装/删除/启用/禁用后调用） */
  _invalidateCache() {
    this._listCache = null;
  }

  /**
   * 获取 Gateway 配置
   */
  _getGatewayConfig() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        const port = config.gateway?.port || 18789;
        const token = config.gateway?.auth?.token || '';
        return { port, token, host: network.gatewayBind };
      }
    } catch (err) {
      Logger.warn('SkillManager: failed to read gateway config: ' + err.message);
    }
    return { port: network.gatewayPort, token: '', host: network.gatewayBind };
  }

  /**
   * 调用 Gateway HTTP API
   */
  async _callGatewayApi(tool, args = {}) {
    const { port, token, host } = this._getGatewayConfig();
    
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        tool,
        args,
        action: 'json'
      });

      const options = {
        hostname: host,
        port: port,
        path: '/tools/invoke',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      Logger.info(`SkillManager: sending request to ${host}:${port}/tools/invoke, tool: ${tool}`);
      
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          Logger.info(`SkillManager: response status: ${res.statusCode}, data: ${data.substring(0, 200)}`);
          try {
            const result = JSON.parse(data);
            if (result.ok) {
              resolve({ success: true, result: result.result });
            } else {
              resolve({ success: false, message: result.error?.message || 'API调用失败' });
            }
          } catch (e) {
            resolve({ success: false, message: '解析响应失败: ' + e.message });
          }
        });
      });

      req.on('error', (err) => {
        Logger.error(`SkillManager: request error: ${err.message}`);
        resolve({ success: false, message: '请求失败: ' + err.message });
      });

      req.setTimeout(timeouts.cliTimeout, () => {
        req.destroy();
        resolve({ success: false, message: '请求超时' });
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * 从目录中读取技能列表
   */
  _readSkillsFromDir(dirPath, enabled = true) {
    const skills = [];
    if (!fs.existsSync(dirPath)) {
      return skills;
    }
    
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          skills.push({
            id: entry.name,
            name: entry.name,
            version: '-',
            enabled: enabled
          });
        }
      }
    } catch (err) {
      Logger.warn(`SkillManager: failed to read skills from ${dirPath}: ${err.message}`);
    }
    
    return skills;
  }

  /**
   * 获取已安装技能列表
   */
  async list() {
    try {
      // 返回缓存（如果未过期）
      if (this._isCacheValid()) {
        Logger.info('SkillManager: returning cached skills list');
        return { success: true, skills: this._listCache.skills, fromCache: true };
      }

      Logger.info('SkillManager: listing installed skills');
      
      // 使用 openclaw CLI 命令获取技能列表（这是最完整的数据源）
      let skills = [];
      
      try {
        const result = await ShellExecutor.runCommand('openclaw', ['skills', 'list', '--json'], {
          timeout: 30000
        });

        if (result.code === 0) {
          // 解析 JSON 输出 - 需要处理 ANSI 转义码、日志信息和多行 JSON
          let cliSkills = [];
          try {
            let output = result.stdout || '';
            
            // 剥离 ANSI 转义码
            output = output.replace(/\x1b\[[0-9;]*m/g, '');
            
            // 使用大括号计数来提取完整的 JSON 对象
            const lines = output.split('\n');
            let jsonLines = [];
            let braceCount = 0;
            let inJson = false;
            
            for (const line of lines) {
              if (!inJson && line.trim().startsWith('{')) {
                inJson = true;
              }
              
              if (inJson) {
                jsonLines.push(line);
                braceCount += (line.match(/{/g) || []).length;
                braceCount -= (line.match(/}/g) || []).length;
                
                if (braceCount === 0) {
                  break;
                }
              }
            }
            
            if (jsonLines.length > 0) {
              const jsonStr = jsonLines.join('\n');
              const parsed = JSON.parse(jsonStr);
              if (Array.isArray(parsed)) {
                cliSkills = parsed;
              } else if (parsed && typeof parsed === 'object') {
                cliSkills = parsed.skills || parsed.data || parsed.results || [];
              }
            }
          } catch (e) {
            Logger.warn('SkillManager: failed to parse skills JSON: ' + e.message);
            cliSkills = this._parseTextOutput(result.stdout);
          }
          
          // 直接使用 CLI 返回的技能列表，确保保留所有字段
          for (const cliSkill of cliSkills) {
            const name = cliSkill.name || cliSkill.id;
            if (!name) continue;
            
            skills.push({
              ...cliSkill,
              id: name,
              name: name,
              // disabled 字段表示是否禁用
              enabled: !cliSkill.disabled
            });
          }
        }
      } catch (cliErr) {
        Logger.warn('SkillManager: CLI list failed: ' + cliErr.message);
      }

      // 确保 skills 始终是数组
      if (!Array.isArray(skills)) {
        skills = [];
      }

      // ── 扫描 workspace/skills 目录，标记/补充自定义技能 ─────────────────
      // CLI 的 managedSkillsDir 可能指向不同路径（如 ~/.openclaw/skills），
      // 因此 CLI 列表里不会包含 workspace/skills 下的自定义技能，
      // 即使包含也不会带 source=openclaw-workspace 标记。
      // 这里直接扫描目录，确保自定义技能能出现在"自定义技能"标签页。
      try {
        const { skillsDir } = this._getSkillDirs();
        if (fs.existsSync(skillsDir)) {
          const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
          // 已有 id 集合（用名称匹配）
          const existingById = new Map(skills.map(s => [s.id || s.name, s]));

          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const skillName = entry.name;

            // 读取 SKILL.md frontmatter
            let description = '';
            let version = '-';
            const skillMdPath = path.join(skillsDir, skillName, 'SKILL.md');
            if (fs.existsSync(skillMdPath)) {
              try {
                const content = fs.readFileSync(skillMdPath, 'utf-8');
                const descMatch = content.match(/^description:\s*["']?(.+?)["']?\s*$/m);
                const verMatch  = content.match(/^version:\s*["']?(.+?)["']?\s*$/m);
                if (descMatch) description = descMatch[1].trim();
                if (verMatch)  version = verMatch[1].trim();
              } catch (_) { /* 忽略 */ }
            }

            if (existingById.has(skillName)) {
              // CLI 已收录：只补打 source 标记，不新增条目
              const existing = existingById.get(skillName);
              existing.source = 'openclaw-workspace';
              if (!existing.description && description) existing.description = description;
              if ((!existing.version || existing.version === '-') && version !== '-') existing.version = version;
              Logger.info(`SkillManager: marked CLI skill "${skillName}" as openclaw-workspace`);
            } else {
              // CLI 未收录：新增条目
              skills.push({
                id: skillName,
                name: skillName,
                description,
                version,
                disabled: false,
                enabled: true,
                source: 'openclaw-workspace'
              });
              Logger.info(`SkillManager: appended custom skill "${skillName}" from workspace/skills`);
            }
          }
        }
      } catch (dirErr) {
        Logger.warn('SkillManager: failed to scan skills dir: ' + dirErr.message);
      }

      // ── 补充扫描 skills-disabled 目录 ────────────────────────
      // CLI 不会返回已禁用的自定义技能，需要手动读取 skills-disabled 目录
      try {
        const { disabledDir } = this._getSkillDirs();
        if (fs.existsSync(disabledDir)) {
          const entries = fs.readdirSync(disabledDir, { withFileTypes: true });
          const existingIds = new Set(skills.map(s => s.id || s.name));

          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const skillName = entry.name;
            if (existingIds.has(skillName)) continue; // 已收录则跳过

            // 尝试读取 SKILL.md frontmatter 以获取描述、版本等
            let description = '';
            let version = '-';
            const skillMdPath = path.join(disabledDir, skillName, 'SKILL.md');
            if (fs.existsSync(skillMdPath)) {
              try {
                const content = fs.readFileSync(skillMdPath, 'utf-8');
                const descMatch = content.match(/^description:\s*["']?(.+?)["']?\s*$/m);
                const verMatch  = content.match(/^version:\s*["']?(.+?)["']?\s*$/m);
                if (descMatch) description = descMatch[1].trim();
                if (verMatch)  version = verMatch[1].trim();
              } catch (_) { /* 忽略 */ }
            }

            skills.push({
              id: skillName,
              name: skillName,
              description,
              version,
              disabled: true,
              enabled: false,
              source: 'openclaw-workspace'
            });
            Logger.info(`SkillManager: appended disabled custom skill "${skillName}"`);
          }
        }
      } catch (dirErr) {
        Logger.warn('SkillManager: failed to scan skills-disabled dir: ' + dirErr.message);
      }

      // 写入缓存
      this._listCache = { skills, timestamp: Date.now() };

      return { success: true, skills };
    } catch (err) {
      Logger.error('SkillManager: list error: ' + err.message);
      return { success: false, message: err.message, skills: [] };
    }
  }

  /**
   * 获取可用技能列表（满足依赖条件的）
   */
  async listEligible() {
    try {
      Logger.info('SkillManager: listing eligible skills');
      const result = await ShellExecutor.runCommand('openclaw', ['skills', 'list', '--eligible', '--json'], {
        timeout: 30000
      });

      if (result.code !== 0) {
        return { success: false, message: result.stderr || '获取可用技能列表失败', skills: [] };
      }

      let skills = [];
      try {
        const output = result.stdout.trim();
        if (output) {
          const parsed = JSON.parse(output);
          if (Array.isArray(parsed)) {
            skills = parsed;
          } else if (parsed && typeof parsed === 'object') {
            skills = parsed.skills || parsed.data || parsed.results || [];
          }
        }
      } catch (e) {
        skills = this._parseTextOutput(result.stdout);
      }

      if (!Array.isArray(skills)) {
        skills = [];
      }

      return { success: true, skills };
    } catch (err) {
      Logger.error('SkillManager: listEligible error: ' + err.message);
      return { success: false, message: err.message, skills: [] };
    }
  }

  /**
   * 安装技能
   * @param {string} skillId - 技能ID或名称
   * @param {string} version - 版本号（可选）
   */
  async install(skillId, version = null) {
    try {
      Logger.info(`SkillManager: installing skill ${skillId}${version ? '@' + version : ''}`);
      
      const args = ['skills', 'install', skillId];
      if (version) {
        args.push('--version', version);
      }

      const result = await ShellExecutor.runCommand('openclaw', args, {
        timeout: 120000 // 安装可能需要较长时间
      });

      if (result.code !== 0) {
        Logger.error('SkillManager: install failed: ' + result.stderr);
        return { success: false, message: result.stderr || '安装技能失败' };
      }

      this._invalidateCache(); // 安装后清除缓存
      Logger.info('SkillManager: skill installed successfully');
      return { success: true, message: '技能安装成功' };
    } catch (err) {
      Logger.error('SkillManager: install error: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * 删除技能 - 使用 Gateway API 或文件系统
   * @param {string} skillId - 技能ID或名称
   */
  async remove(skillId) {
    try {
      Logger.info(`SkillManager: removing skill ${skillId}`);
      
      // 首先尝试使用 Gateway API
      const apiResult = await this._callGatewayApi('skills.remove', { skill: skillId });
      if (apiResult.success) {
        Logger.info('SkillManager: skill removed via Gateway API');
        return { success: true, message: '技能已删除' };
      }
      
      Logger.warn(`SkillManager: Gateway API failed, trying filesystem: ${apiResult.message}`);
      
      // Gateway API 失败，尝试直接删除文件系统中的技能文件夹
      const { skillsDir, disabledDir } = this._getSkillDirs();
      const enabledPath = path.join(skillsDir, skillId);
      const disabledPath = path.join(disabledDir, skillId);
      
      let removed = false;
      
      // 尝试删除启用的技能
      if (fs.existsSync(enabledPath)) {
        fs.rmSync(enabledPath, { recursive: true, force: true });
        Logger.info(`SkillManager: removed enabled skill at ${enabledPath}`);
        removed = true;
      }
      
      // 尝试删除禁用的技能
      if (fs.existsSync(disabledPath)) {
        fs.rmSync(disabledPath, { recursive: true, force: true });
        Logger.info(`SkillManager: removed disabled skill at ${disabledPath}`);
        removed = true;
      }
      
      if (removed) {
        this._invalidateCache(); // 删除后清除缓存
        return { success: true, message: '技能已删除' };
      }
      
      return { success: false, message: `技能 ${skillId} 不存在或无法删除` };
    } catch (err) {
      Logger.error('SkillManager: remove error: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * 获取技能目录路径
   */
  _getSkillDirs() {
    // 技能存放在 workspace/skills/ 目录下
    const skillsDir = path.join(OPENCLAW_HOME, 'workspace', 'skills');
    const disabledDir = path.join(OPENCLAW_HOME, 'workspace', 'skills-disabled');
    return { skillsDir, disabledDir };
  }

  /**
   * 确保目录存在
   */
  _ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 判断某个技能是否为自定义技能（位于 workspace/skills 或 workspace/skills-disabled）
   * @param {string} skillId
   * @returns {'enabled'|'disabled'|null}  null 表示不是自定义技能
   */
  _getCustomSkillState(skillId) {
    const { skillsDir, disabledDir } = this._getSkillDirs();
    if (fs.existsSync(path.join(skillsDir, skillId))) return 'enabled';
    if (fs.existsSync(path.join(disabledDir, skillId))) return 'disabled';
    return null;
  }

  /**
   * 启用技能
   * - 自定义技能：将文件夹从 skills-disabled 移回 skills
   * - 系统技能：使用 openclaw CLI config 命令
   * @param {string} skillId - 技能ID或名称
   */
  async enable(skillId) {
    try {
      Logger.info(`SkillManager: enabling skill "${skillId}"`);

      if (!skillId) {
        return { success: false, message: '技能ID不能为空' };
      }

      const customState = this._getCustomSkillState(skillId);

      // ── 自定义技能：移动文件夹 ──────────────────────────────
      if (customState !== null) {
        const { skillsDir, disabledDir } = this._getSkillDirs();

        if (customState === 'enabled') {
          Logger.info(`SkillManager: custom skill "${skillId}" is already in skills dir`);
          this._invalidateCache();
          return { success: true, message: '技能已启用' };
        }

        // 从 skills-disabled → skills
        const srcPath = path.join(disabledDir, skillId);
        const destPath = path.join(skillsDir, skillId);
        this._ensureDir(skillsDir);
        fs.renameSync(srcPath, destPath);
        Logger.info(`SkillManager: custom skill moved to enabled: ${destPath}`);
        this._invalidateCache();
        return { success: true, message: '技能已启用' };
      }

      // ── 系统技能：openclaw config 命令 ─────────────────────
      Logger.info(`SkillManager: using openclaw config to enable "${skillId}"`);
      const result = await ShellExecutor.runCommand('openclaw', ['config', 'set', `skills.entries.${skillId}.enabled`, 'true'], {
        timeout: 30000
      });

      Logger.info(`SkillManager: config command result: code=${result.code}, stdout=${result.stdout}, stderr=${result.stderr}`);

      if (result.code === 0) {
        this._invalidateCache();
        Logger.info('SkillManager: skill enabled via config command');
        return { success: true, message: '技能已启用' };
      }

      return { success: false, message: result.stderr || '启用失败' };
    } catch (err) {
      Logger.error('SkillManager: enable error: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * 禁用技能
   * - 自定义技能：将文件夹从 skills 移到 skills-disabled
   * - 系统技能：使用 openclaw CLI config 命令
   * @param {string} skillId - 技能ID或名称
   */
  async disable(skillId) {
    try {
      Logger.info(`SkillManager: disabling skill "${skillId}"`);

      if (!skillId) {
        return { success: false, message: '技能ID不能为空' };
      }

      const customState = this._getCustomSkillState(skillId);

      // ── 自定义技能：移动文件夹 ──────────────────────────────
      if (customState !== null) {
        const { skillsDir, disabledDir } = this._getSkillDirs();

        if (customState === 'disabled') {
          Logger.info(`SkillManager: custom skill "${skillId}" is already in skills-disabled dir`);
          this._invalidateCache();
          return { success: true, message: '技能已禁用' };
        }

        // 从 skills → skills-disabled
        const srcPath = path.join(skillsDir, skillId);
        const destPath = path.join(disabledDir, skillId);
        this._ensureDir(disabledDir);
        fs.renameSync(srcPath, destPath);
        Logger.info(`SkillManager: custom skill moved to disabled: ${destPath}`);
        this._invalidateCache();
        return { success: true, message: '技能已禁用' };
      }

      // ── 系统技能：openclaw config 命令 ─────────────────────
      Logger.info(`SkillManager: using openclaw config to disable "${skillId}"`);
      const result = await ShellExecutor.runCommand('openclaw', ['config', 'set', `skills.entries.${skillId}.enabled`, 'false'], {
        timeout: 30000
      });

      Logger.info(`SkillManager: config command result: code=${result.code}, stdout=${result.stdout}, stderr=${result.stderr}`);

      if (result.code === 0) {
        this._invalidateCache();
        Logger.info('SkillManager: skill disabled via config command');
        return { success: true, message: '技能已禁用' };
      }

      return { success: false, message: result.stderr || '禁用失败' };
    } catch (err) {
      Logger.error('SkillManager: disable error: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * 搜索技能市场
   * @param {string} query - 搜索关键词
   */
  async search(query) {
    try {
      Logger.info(`SkillManager: searching skills with query "${query}"`);
      
      // 尝试使用 clawhub 搜索（不带 --json 参数）
      const result = await ShellExecutor.runCommand('npx', ['clawhub', 'search', query], {
        timeout: 60000,
        cwd: OPENCLAW_HOME
      });

      if (result.code !== 0) {
        Logger.error('SkillManager: search failed: ' + result.stderr);
        
        // 检查是否是速率限制错误
        if (result.stderr && result.stderr.includes('Rate limit')) {
          return { 
            success: false, 
            message: '搜索过于频繁，请稍后再试（npm 速率限制）', 
            results: [],
            rateLimited: true
          };
        }
        
        return { success: false, message: result.stderr || '搜索技能失败', results: [] };
      }

      // 检查输出中是否包含速率限制警告
      if (result.stdout && result.stdout.includes('Rate limit exceeded')) {
        Logger.warn('SkillManager: search rate limited');
        return { 
          success: false, 
          message: '搜索过于频繁，请稍后再试（npm 速率限制）', 
          results: [],
          rateLimited: true
        };
      }

      // 解析文本输出
      let results = this._parseSearchOutput(result.stdout);

      if (!Array.isArray(results)) {
        results = [];
      }

      return { success: true, results };
    } catch (err) {
      Logger.error('SkillManager: search error: ' + err.message);
      return { success: false, message: err.message, results: [] };
    }
  }

  /**
   * 获取技能详情
   * @param {string} skillId - 技能ID或名称
   */
  async getInfo(skillId) {
    try {
      Logger.info(`SkillManager: getting info for skill ${skillId}`);
      
      const result = await ShellExecutor.runCommand('openclaw', ['skills', 'info', skillId, '--json'], {
        timeout: 30000
      });

      if (result.code !== 0) {
        return { success: false, message: result.stderr || '获取技能信息失败' };
      }

      let info = {};
      try {
        const output = result.stdout.trim();
        if (output) {
          info = JSON.parse(output);
        }
      } catch (e) {
        info = { description: result.stdout };
      }

      return { success: true, info };
    } catch (err) {
      Logger.error('SkillManager: getInfo error: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * 更新技能
   * @param {string} skillId - 技能ID或名称
   */
  async update(skillId) {
    try {
      Logger.info(`SkillManager: updating skill ${skillId}`);
      
      const result = await ShellExecutor.runCommand('openclaw', ['skills', 'update', skillId], {
        timeout: 120000
      });

      if (result.code !== 0) {
        Logger.error('SkillManager: update failed: ' + result.stderr);
        return { success: false, message: result.stderr || '更新技能失败' };
      }

      Logger.info('SkillManager: skill updated successfully');
      return { success: true, message: '技能已更新' };
    } catch (err) {
      Logger.error('SkillManager: update error: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * 浏览最新技能
   */
  async explore() {
    try {
      Logger.info('SkillManager: exploring latest skills');
      
      const result = await ShellExecutor.runCommand('npx', ['clawhub', 'explore'], {
        timeout: 60000,
        cwd: OPENCLAW_HOME
      });

      if (result.code !== 0) {
        Logger.error('SkillManager: explore failed: ' + result.stderr);
        return { success: false, message: result.stderr || '浏览技能失败', results: [] };
      }

      // 解析文本输出
      let results = this._parseSearchOutput(result.stdout);

      if (!Array.isArray(results)) {
        results = [];
      }

      return { success: true, results };
    } catch (err) {
      Logger.error('SkillManager: explore error: ' + err.message);
      return { success: false, message: err.message, results: [] };
    }
  }

  /**
   * 列出已安装的技能（使用 clawhub list）
   */
  async listInstalled() {
    try {
      Logger.info('SkillManager: listing installed skills via clawhub');
      
      const result = await ShellExecutor.runCommand('npx', ['clawhub', 'list'], {
        timeout: 30000,
        cwd: OPENCLAW_HOME
      });

      if (result.code !== 0) {
        Logger.error('SkillManager: list installed failed: ' + result.stderr);
        return { success: false, message: result.stderr || '获取已安装技能失败', results: [] };
      }

      // 解析文本输出
      let results = this._parseSearchOutput(result.stdout);

      if (!Array.isArray(results)) {
        results = [];
      }

      return { success: true, results };
    } catch (err) {
      Logger.error('SkillManager: listInstalled error: ' + err.message);
      return { success: false, message: err.message, results: [] };
    }
  }

  /**
   * 查看技能详情
   * @param {string} skillId - 技能ID或名称
   */
  async inspect(skillId) {
    try {
      Logger.info(`SkillManager: inspecting skill ${skillId}`);
      
      if (!skillId) {
        return { success: false, message: '技能ID不能为空' };
      }
      
      const result = await ShellExecutor.runCommand('npx', ['clawhub', 'inspect', skillId], {
        timeout: 30000,
        cwd: OPENCLAW_HOME
      });

      if (result.code !== 0) {
        Logger.error('SkillManager: inspect failed: ' + result.stderr);
        return { success: false, message: result.stderr || '查看技能详情失败' };
      }

      return { 
        success: true, 
        details: result.stdout || '暂无详情信息'
      };
    } catch (err) {
      Logger.error('SkillManager: inspect error: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * 解析文本格式输出（当 JSON 解析失败时）
   */
  _parseTextOutput(output) {
    const skills = [];
    const lines = output.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      // 尝试匹配常见的技能列表格式
      // 例如: "skill-name@1.0.0 [enabled]" 或 "skill-name (v1.0.0)"
      const match = line.match(/^(\S+)(?:[@\s]+v?(\S+))?\s*(?:\[?(enabled|disabled)\]?)?/i);
      if (match) {
        skills.push({
          id: match[1],
          name: match[1],
          version: match[2] || 'unknown',
          enabled: match[3] ? match[3].toLowerCase() === 'enabled' : true
        });
      }
    }
    
    return skills;
  }

  /**
   * 解析搜索输出
   */
  _parseSearchOutput(output) {
    const results = [];
    const lines = output.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      // 尝试匹配搜索结果格式
      const match = line.match(/^(\S+)\s*-\s*(.+)/);
      if (match) {
        results.push({
          id: match[1],
          name: match[1],
          description: match[2]
        });
      }
    }
    
    return results;
  }

  /**
   * 导入内置 skills 到 openclaw
   * @param {Function} onProgress - 进度回调函数
   * @returns {Promise<{success: boolean, message: string, imported: string[], skipped: string[]}>}
   */
  async importBundledSkills(onProgress = null) {
    const { app } = require('electron');
    const results = {
      success: true,
      message: '',
      imported: [],
      skipped: [],
      failed: []
    };

    try {
      // 获取打包后的 skills 目录路径
      let bundledSkillsPath;
      if (app.isPackaged) {
        // 打包后：resources 目录结构是 resources/skills（不是 resources/resources/skills）
        // app.getAppPath() 返回 app.asar 的路径，其父目录就是 resources
        bundledSkillsPath = path.join(path.dirname(app.getAppPath()), 'skills');
      } else {
        // 开发模式：直接使用项目中的 resources/skills
        bundledSkillsPath = path.join(__dirname, '..', '..', '..', 'resources', 'skills');
      }

      Logger.info(`SkillManager: looking for bundled skills at ${bundledSkillsPath}`);

      if (!fs.existsSync(bundledSkillsPath)) {
        Logger.warn(`SkillManager: bundled skills directory not found at ${bundledSkillsPath}`);
        results.message = '未找到内置技能目录';
        return results;
      }

      // 获取目标目录
      const { skillsDir } = this._getSkillDirs();
      this._ensureDir(skillsDir);

      // 读取所有 skill 目录
      const skillDirs = fs.readdirSync(bundledSkillsPath, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);

      if (skillDirs.length === 0) {
        Logger.info('SkillManager: no bundled skills found');
        results.message = '没有找到内置技能';
        return results;
      }

      Logger.info(`SkillManager: found ${skillDirs.length} bundled skills: ${skillDirs.join(', ')}`);

      // 复制每个 skill
      for (let i = 0; i < skillDirs.length; i++) {
        const skillName = skillDirs[i];
        const srcPath = path.join(bundledSkillsPath, skillName);
        const destPath = path.join(skillsDir, skillName);

        // 报告进度
        if (onProgress) {
          onProgress({
            current: i + 1,
            total: skillDirs.length,
            skill: skillName,
            status: 'importing'
          });
        }

        // 检查是否已存在
        if (fs.existsSync(destPath)) {
          Logger.info(`SkillManager: skill ${skillName} already exists, skipping`);
          results.skipped.push(skillName);
          continue;
        }

        try {
          // 复制目录
          this._copyDirSync(srcPath, destPath);
          Logger.info(`SkillManager: imported skill ${skillName}`);
          results.imported.push(skillName);
        } catch (copyErr) {
          Logger.error(`SkillManager: failed to import skill ${skillName}: ${copyErr.message}`);
          results.failed.push({ name: skillName, error: copyErr.message });
        }
      }

      // 生成结果消息
      const parts = [];
      if (results.imported.length > 0) {
        parts.push(`成功导入 ${results.imported.length} 个技能`);
      }
      if (results.skipped.length > 0) {
        parts.push(`跳过 ${results.skipped.length} 个已存在的技能`);
      }
      if (results.failed.length > 0) {
        parts.push(`${results.failed.length} 个导入失败`);
      }
      results.message = parts.join('，') || '没有需要导入的技能';

      Logger.info(`SkillManager: import completed - ${results.message}`);
      return results;

    } catch (err) {
      Logger.error(`SkillManager: import bundled skills error: ${err.message}`);
      results.success = false;
      results.message = `导入失败: ${err.message}`;
      return results;
    }
  }

  /**
   * 获取内置 skills 列表（用于预览）
   * @returns {Array<{name: string, description: string}>}
   */
  getBundledSkillsList() {
    const { app } = require('electron');
    const skills = [];

    try {
      let bundledSkillsPath;
      if (app.isPackaged) {
        // 打包后：resources 目录结构是 resources/skills
        bundledSkillsPath = path.join(path.dirname(app.getAppPath()), 'skills');
      } else {
        bundledSkillsPath = path.join(__dirname, '..', '..', '..', 'resources', 'skills');
      }

      if (!fs.existsSync(bundledSkillsPath)) {
        return skills;
      }

      const skillDirs = fs.readdirSync(bundledSkillsPath, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);

      for (const skillName of skillDirs) {
        const skillMdPath = path.join(bundledSkillsPath, skillName, 'SKILL.md');
        let description = '';

        if (fs.existsSync(skillMdPath)) {
          try {
            const content = fs.readFileSync(skillMdPath, 'utf-8');
            // 解析 YAML frontmatter 中的 description
            const descMatch = content.match(/^---\s*\n[\s\S]*?^description:\s*["']?(.+?)["']?\s*$/m);
            if (descMatch) {
              description = descMatch[1].trim();
            }
          } catch (e) {
            // 忽略解析错误
          }
        }

        skills.push({
          name: skillName,
          description: description || '无描述'
        });
      }

      return skills;

    } catch (err) {
      Logger.error(`SkillManager: get bundled skills list error: ${err.message}`);
      return skills;
    }
  }

  /**
   * 创建自定义技能
   * @param {object} options
   * @param {string} options.name      - 技能目录名（英文，即 skillId）
   * @param {string} options.description - 技能描述
   * @param {string} options.mdContent   - SKILL.md 正文内容（frontmatter 由此方法生成）
   * @param {string} [options.version]   - 版本号，默认 1.0.0
   * @returns {{ success, message, skillPath? }}
   */
  async createCustomSkill({ name, description, mdContent, version = '1.0.0' }) {
    try {
      if (!name || !/^[a-z0-9][a-z0-9-_]*$/.test(name)) {
        return { success: false, message: '技能名称只能包含小写字母、数字、连字符和下划线，且须以字母或数字开头' };
      }
      if (!description || description.trim().length < 5) {
        return { success: false, message: '技能描述至少需要 5 个字符' };
      }
      if (!mdContent || mdContent.trim().length === 0) {
        return { success: false, message: 'SKILL.md 内容不能为空' };
      }

      const { skillsDir } = this._getSkillDirs();
      const skillDir = path.join(skillsDir, name);

      // 检查是否已存在同名技能
      if (fs.existsSync(skillDir)) {
        return { success: false, message: `技能 "${name}" 已存在，请换一个名称或先删除旧技能` };
      }

      // 生成 SKILL.md（frontmatter + 用户写的内容）
      const frontmatter = [
        '---',
        `name: ${name}`,
        `description: ${description.trim()}`,
        `version: ${version}`,
        '---',
        ''
      ].join('\n');

      // 若用户上传的 MD 自带 frontmatter，剥掉它，避免重复
      let body = mdContent;
      if (/^\s*---[\s\S]*?---/.test(body)) {
        body = body.replace(/^\s*---[\s\S]*?---\s*/, '');
      }

      const finalMd = frontmatter + body.trimStart();

      // 写文件
      this._ensureDir(skillsDir);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), finalMd, 'utf-8');

      this._invalidateCache();
      Logger.info(`SkillManager: custom skill "${name}" created at ${skillDir}`);
      return { success: true, message: `技能 "${name}" 已创建`, skillPath: skillDir };
    } catch (err) {
      Logger.error('SkillManager: createCustomSkill error: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * 同步复制目录
   */
  _copyDirSync(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this._copyDirSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

module.exports = SkillManager;
