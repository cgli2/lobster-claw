const fs = require('fs');
const { CONFIG_PATH } = require('../utils/paths');
const Logger = require('../utils/logger');

class McpManager {
  async _readConfig() {
    try {
      if (!fs.existsSync(CONFIG_PATH)) return {};
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch {
      return {};
    }
  }

  async _writeConfig(config) {
    const path = require('path');
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(CONFIG_PATH)) {
      fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak');
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  }

  async list() {
    const config = await this._readConfig();
    const mcpServers = config.mcpServers || {};
    return Object.entries(mcpServers).map(([name, cfg]) => ({
      name,
      command: cfg.command || '',
      args: cfg.args || [],
      env: cfg.env || {},
      enabled: cfg.enabled !== false
    }));
  }

  async add(serverConfig) {
    try {
      const config = await this._readConfig();
      if (!config.mcpServers) config.mcpServers = {};

      config.mcpServers[serverConfig.name] = {
        command: serverConfig.command || '',
        args: serverConfig.args || [],
        env: serverConfig.env || {},
        enabled: true
      };

      await this._writeConfig(config);
      Logger.info('MCP server added: ' + serverConfig.name);
      return { success: true };
    } catch (err) {
      Logger.error('Add MCP server failed: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  async remove(name) {
    try {
      const config = await this._readConfig();
      if (config.mcpServers && config.mcpServers[name]) {
        delete config.mcpServers[name];
        await this._writeConfig(config);
        Logger.info('MCP server removed: ' + name);
        return { success: true };
      }
      return { success: false, message: '服务器不存在' };
    } catch (err) {
      Logger.error('Remove MCP server failed: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  async update(name, serverConfig) {
    try {
      const config = await this._readConfig();
      if (!config.mcpServers || !config.mcpServers[name]) {
        return { success: false, message: '服务器不存在' };
      }

      config.mcpServers[name] = {
        ...config.mcpServers[name],
        command: serverConfig.command || config.mcpServers[name].command,
        args: serverConfig.args || config.mcpServers[name].args,
        env: serverConfig.env || config.mcpServers[name].env,
        enabled: serverConfig.enabled !== undefined ? serverConfig.enabled : config.mcpServers[name].enabled
      };

      await this._writeConfig(config);
      Logger.info('MCP server updated: ' + name);
      return { success: true };
    } catch (err) {
      Logger.error('Update MCP server failed: ' + err.message);
      return { success: false, message: err.message };
    }
  }
}

module.exports = McpManager;
