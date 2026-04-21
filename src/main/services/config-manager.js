const fs = require('fs');
const path = require('path');
const { CONFIG_PATH, OPENCLAW_HOME } = require('../utils/paths');
const Logger = require('../utils/logger');

class ConfigManager {
  getConfigPath() {
    return CONFIG_PATH;
  }

  /**
   * Get the path to auth-profiles.json for a specific agent
   * @param {string} agentId - Agent ID (default: 'main')
   * @returns {string} Path to auth-profiles.json
   */
  getAuthProfilesPath(agentId = 'main') {
    return path.join(OPENCLAW_HOME, 'agents', agentId, 'agent', 'auth-profiles.json');
  }

  /**
   * Read auth-profiles.json for a specific agent
   * @param {string} agentId - Agent ID (default: 'main')
   * @returns {Object} Auth profiles data
   */
  async readAuthProfiles(agentId = 'main') {
    try {
      const authPath = this.getAuthProfilesPath(agentId);
      if (!fs.existsSync(authPath)) {
        return { version: 1, profiles: {} };
      }
      const content = fs.readFileSync(authPath, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      Logger.error('Failed to read auth-profiles: ' + err.message);
      return { version: 1, profiles: {} };
    }
  }

  /**
   * Write auth-profiles.json for a specific agent
   * @param {Object} profiles - Auth profiles data
   * @param {string} agentId - Agent ID (default: 'main')
   * @returns {Object} Result object with success flag
   */
  async writeAuthProfiles(profiles, agentId = 'main') {
    try {
      const authPath = this.getAuthProfilesPath(agentId);
      const dir = path.dirname(authPath);

      // Ensure directory exists
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Backup current file if exists
      if (fs.existsSync(authPath)) {
        const bakPath = authPath + '.bak';
        fs.copyFileSync(authPath, bakPath);
      }

      // Ensure proper structure
      const data = {
        version: profiles.version || 1,
        profiles: profiles.profiles || {}
      };

      const jsonStr = JSON.stringify(data, null, 2);
      fs.writeFileSync(authPath, jsonStr, 'utf-8');
      Logger.info('Auth profiles saved successfully for agent: ' + agentId);
      return { success: true };
    } catch (err) {
      Logger.error('Failed to write auth-profiles: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * Update or add an API key for a provider
   * @param {string} providerId - Provider ID (e.g., 'kimi', 'openai')
   * @param {string} apiKey - API key value
   * @param {string} agentId - Agent ID (default: 'main')
   * @returns {Object} Result object with success flag
   */
  async setProviderApiKey(providerId, apiKey, agentId = 'main') {
    try {
      const profiles = await this.readAuthProfiles(agentId);

      // Update the provider's API key
      profiles.profiles[providerId] = {
        ...(profiles.profiles[providerId] || {}),
        apiKey: apiKey
      };

      return await this.writeAuthProfiles(profiles, agentId);
    } catch (err) {
      Logger.error('Failed to set provider API key: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * Remove an API key for a provider
   * @param {string} providerId - Provider ID (e.g., 'kimi', 'openai')
   * @param {string} agentId - Agent ID (default: 'main')
   * @returns {Object} Result object with success flag
   */
  async removeProviderApiKey(providerId, agentId = 'main') {
    try {
      const profiles = await this.readAuthProfiles(agentId);

      if (profiles.profiles[providerId]) {
        delete profiles.profiles[providerId];
      }

      return await this.writeAuthProfiles(profiles, agentId);
    } catch (err) {
      Logger.error('Failed to remove provider API key: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * Get the path to models.json for a specific agent
   * @param {string} agentId - Agent ID (default: 'main')
   * @returns {string} Path to models.json
   */
  getModelsPath(agentId = 'main') {
    return path.join(OPENCLAW_HOME, 'agents', agentId, 'agent', 'models.json');
  }

  /**
   * Read models.json for a specific agent
   * @param {string} agentId - Agent ID (default: 'main')
   * @returns {Object} Models config data
   */
  async readModels(agentId = 'main') {
    try {
      const modelsPath = this.getModelsPath(agentId);
      if (!fs.existsSync(modelsPath)) {
        return { providers: {} };
      }
      const content = fs.readFileSync(modelsPath, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      Logger.error('Failed to read models config: ' + err.message);
      return { providers: {} };
    }
  }

  /**
   * Write models.json for a specific agent
   * @param {Object} modelsConfig - Models config data
   * @param {string} agentId - Agent ID (default: 'main')
   * @returns {Object} Result object with success flag
   */
  async writeModels(modelsConfig, agentId = 'main') {
    try {
      const modelsPath = this.getModelsPath(agentId);
      const dir = path.dirname(modelsPath);

      // Ensure directory exists
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Backup current file if exists
      if (fs.existsSync(modelsPath)) {
        const bakPath = modelsPath + '.bak';
        fs.copyFileSync(modelsPath, bakPath);
      }

      // Ensure proper structure
      const data = {
        providers: modelsConfig.providers || {}
      };

      const jsonStr = JSON.stringify(data, null, 2);
      fs.writeFileSync(modelsPath, jsonStr, 'utf-8');
      Logger.info('Models config saved successfully for agent: ' + agentId);
      return { success: true };
    } catch (err) {
      Logger.error('Failed to write models config: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * Update or add a provider configuration in models.json
   * @param {string} providerId - Provider ID (e.g., 'kimi', 'openai')
   * @param {Object} providerConfig - Provider configuration { baseUrl, apiKey, models }
   * @param {string} agentId - Agent ID (default: 'main')
   * @returns {Object} Result object with success flag
   */
  async setProviderModels(providerId, providerConfig, agentId = 'main') {
    try {
      const models = await this.readModels(agentId);

      // Update the provider's configuration
      models.providers[providerId] = {
        baseUrl: providerConfig.baseUrl,
        apiKey: providerConfig.apiKey,
        models: providerConfig.models || []
      };

      return await this.writeModels(models, agentId);
    } catch (err) {
      Logger.error('Failed to set provider models: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  async read() {
    try {
      if (!fs.existsSync(CONFIG_PATH)) {
        return {};
      }
      const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      Logger.error('Failed to read config: ' + err.message);
      // Try backup
      const bakPath = CONFIG_PATH + '.bak';
      if (fs.existsSync(bakPath)) {
        try {
          const bakContent = fs.readFileSync(bakPath, 'utf-8');
          return JSON.parse(bakContent);
        } catch {
          Logger.error('Backup config also corrupted');
        }
      }
      return {};
    }
  }

  async write(data) {
    try {
      // Ensure directory exists
      const dir = path.dirname(CONFIG_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Backup current config
      if (fs.existsSync(CONFIG_PATH)) {
        const bakPath = CONFIG_PATH + '.bak';
        fs.copyFileSync(CONFIG_PATH, bakPath);
      }

      // Validate JSON
      const jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      JSON.parse(jsonStr); // Validate

      fs.writeFileSync(CONFIG_PATH, jsonStr, 'utf-8');
      Logger.info('Config saved successfully');
      return { success: true };
    } catch (err) {
      Logger.error('Failed to write config: ' + err.message);
      return { success: false, message: err.message };
    }
  }
}

module.exports = ConfigManager;
