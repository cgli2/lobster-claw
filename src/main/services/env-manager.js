const fs = require('fs');
const path = require('path');
const { ENV_PATH, OPENCLAW_HOME } = require('../utils/paths');
const Logger = require('../utils/logger');

class EnvManager {
  /**
   * 读取 .env 文件，返回 key-value 对象（明文）
   */
  async read() {
    try {
      if (!fs.existsSync(ENV_PATH)) {
        return {};
      }
      const content = fs.readFileSync(ENV_PATH, 'utf-8');
      return this._parse(content);
    } catch (err) {
      Logger.error('Failed to read .env: ' + err.message);
      return {};
    }
  }

  /**
   * 将整个 key-value 对象写入 .env 文件（覆盖写）
   */
  async write(envMap) {
    try {
      const dir = path.dirname(ENV_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Backup
      if (fs.existsSync(ENV_PATH)) {
        fs.copyFileSync(ENV_PATH, ENV_PATH + '.bak');
      }

      const lines = [];
      for (const [key, value] of Object.entries(envMap)) {
        if (key.startsWith('#')) {
          lines.push(key); // Comments
        } else {
          lines.push(`${key}=${value}`);
        }
      }

      fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n', 'utf-8');
      Logger.info('.env saved successfully');
      return { success: true };
    } catch (err) {
      Logger.error('Failed to write .env: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * 设置（或更新）单个 API Key 到 .env 文件（合并写，不覆盖其他条目）
   * @param {string} envKey  - 环境变量名，如 MOONSHOT_API_KEY
   * @param {string} apiKey  - 真实密钥值
   */
  async setApiKey(envKey, apiKey) {
    try {
      const existing = await this.read();
      existing[envKey] = apiKey;
      return await this.write(existing);
    } catch (err) {
      Logger.error('Failed to set API key in .env: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * 从 .env 文件中删除单个 API Key
   * @param {string} envKey - 环境变量名
   */
  async removeApiKey(envKey) {
    try {
      const existing = await this.read();
      if (envKey in existing) {
        delete existing[envKey];
        return await this.write(existing);
      }
      return { success: true };
    } catch (err) {
      Logger.error('Failed to remove API key from .env: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * 解析 .env 文件内容
   */
  _parse(content) {
    const result = {};
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();
        // Remove surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        result[key] = value;
      }
    }
    return result;
  }
}

module.exports = EnvManager;
