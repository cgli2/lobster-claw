const fs = require('fs');
const path = require('path');
const { CONFIG_PATH, PROFILES_DIR } = require('../utils/paths');
const Logger = require('../utils/logger');

class ProfileManager {
  constructor() {
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(PROFILES_DIR)) {
      try {
        fs.mkdirSync(PROFILES_DIR, { recursive: true });
      } catch {}
    }
  }

  _indexPath() {
    return path.join(PROFILES_DIR, '_profiles-index.json');
  }

  _readIndex() {
    const idx = this._indexPath();
    if (!fs.existsSync(idx)) return [];
    try {
      return JSON.parse(fs.readFileSync(idx, 'utf-8'));
    } catch {
      return [];
    }
  }

  _writeIndex(data) {
    fs.writeFileSync(this._indexPath(), JSON.stringify(data, null, 2), 'utf-8');
  }

  async list() {
    return this._readIndex();
  }

  async create(name, description) {
    this._ensureDir();
    try {
      if (!fs.existsSync(CONFIG_PATH)) {
        return { success: false, message: '当前无配置文件可快照' };
      }

      const safeName = name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_');
      const fileName = `profile-${safeName}-${Date.now()}.json`;
      const filePath = path.join(PROFILES_DIR, fileName);

      fs.copyFileSync(CONFIG_PATH, filePath);

      const index = this._readIndex();
      index.push({
        name,
        description: description || '',
        fileName,
        createdAt: new Date().toISOString()
      });
      this._writeIndex(index);

      Logger.info('Profile created: ' + name);
      return { success: true };
    } catch (err) {
      Logger.error('Create profile failed: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  async switchTo(name) {
    try {
      const index = this._readIndex();
      const profile = index.find(p => p.name === name);
      if (!profile) {
        return { success: false, message: '档案不存在' };
      }

      const filePath = path.join(PROFILES_DIR, profile.fileName);
      if (!fs.existsSync(filePath)) {
        return { success: false, message: '档案文件丢失' };
      }

      // Backup current config
      if (fs.existsSync(CONFIG_PATH)) {
        fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak');
      }

      // Copy profile to config
      fs.copyFileSync(filePath, CONFIG_PATH);

      Logger.info('Switched to profile: ' + name);
      return { success: true };
    } catch (err) {
      Logger.error('Switch profile failed: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  async remove(name) {
    try {
      const index = this._readIndex();
      const profileIdx = index.findIndex(p => p.name === name);
      if (profileIdx === -1) {
        return { success: false, message: '档案不存在' };
      }

      const profile = index[profileIdx];
      const filePath = path.join(PROFILES_DIR, profile.fileName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      index.splice(profileIdx, 1);
      this._writeIndex(index);

      Logger.info('Profile deleted: ' + name);
      return { success: true };
    } catch (err) {
      Logger.error('Delete profile failed: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  async exportProfile(name, targetPath) {
    try {
      const index = this._readIndex();
      const profile = index.find(p => p.name === name);
      if (!profile) {
        return { success: false, message: '档案不存在' };
      }

      const filePath = path.join(PROFILES_DIR, profile.fileName);
      if (!fs.existsSync(filePath)) {
        return { success: false, message: '档案文件丢失' };
      }

      fs.copyFileSync(filePath, targetPath);
      Logger.info('Profile exported: ' + name + ' -> ' + targetPath);
      return { success: true };
    } catch (err) {
      Logger.error('Export profile failed: ' + err.message);
      return { success: false, message: err.message };
    }
  }

  async importProfile(sourcePath) {
    try {
      // Validate JSON
      const content = fs.readFileSync(sourcePath, 'utf-8');
      JSON.parse(content);

      const baseName = path.basename(sourcePath, '.json');
      const name = '导入-' + baseName;
      const fileName = `profile-import-${Date.now()}.json`;
      const filePath = path.join(PROFILES_DIR, fileName);

      this._ensureDir();
      fs.copyFileSync(sourcePath, filePath);

      const index = this._readIndex();
      index.push({
        name,
        description: '从 ' + path.basename(sourcePath) + ' 导入',
        fileName,
        createdAt: new Date().toISOString()
      });
      this._writeIndex(index);

      Logger.info('Profile imported from: ' + sourcePath);
      return { success: true, name };
    } catch (err) {
      Logger.error('Import profile failed: ' + err.message);
      return { success: false, message: err.message };
    }
  }
}

module.exports = ProfileManager;
