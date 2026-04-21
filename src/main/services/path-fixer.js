const { execSync } = require('child_process');
const path = require('path');
const Logger = require('../utils/logger');

class PathFixer {
  /**
   * Get npm global prefix directory
   */
  getNpmGlobalPath() {
    try {
      const prefix = execSync('npm config get prefix', { encoding: 'utf8' }).trim();
      return prefix;
    } catch (e) {
      Logger.error('Failed to get npm prefix: ' + e.message);
      return null;
    }
  }

  /**
   * Check if a path exists in system PATH
   */
  isInSystemPath(targetPath) {
    try {
      const currentPath = execSync('powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'PATH\', \'Machine\')"', {
        encoding: 'utf8'
      }).trim();

      return currentPath.toLowerCase().includes(targetPath.toLowerCase());
    } catch (e) {
      Logger.error('Failed to check system PATH: ' + e.message);
      return false;
    }
  }

  /**
   * Add path to user PATH (no admin required)
   * This is safer and works without UAC
   */
  addToUserPath(pathToAdd) {
    try {
      // First check if already in user PATH
      const currentUserPath = execSync('powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'PATH\', \'User\')"', {
        encoding: 'utf8'
      }).trim();

      if (currentUserPath.toLowerCase().includes(pathToAdd.toLowerCase())) {
        return { success: true, message: '路径已在用户 PATH 中', alreadyExists: true };
      }

      // Add to user PATH using PowerShell (correctly appends instead of overwriting)
      const newPath = currentUserPath + ';' + pathToAdd;
      execSync(`powershell.exe -NoProfile -Command "[Environment]::SetEnvironmentVariable('PATH', '${newPath.replace(/'/g, "''")}', 'User')"`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });

      Logger.info('Added to user PATH: ' + pathToAdd);
      return { success: true, message: '已成功添加到用户 PATH（重启应用后生效）' };
    } catch (e) {
      Logger.error('Failed to add to user PATH: ' + e.message);
      return { success: false, message: '添加失败：' + e.message };
    }
  }

  /**
   * Add path to system PATH (requires admin)
   * Falls back to user PATH if no admin privileges
   */
  addToSystemPath(pathToAdd) {
    try {
      // First check if already in PATH
      if (this.isInSystemPath(pathToAdd)) {
        return { success: true, message: '路径已在系统 PATH 中', alreadyExists: true };
      }

      // Try to add to system PATH using PowerShell (appends instead of overwriting)
      const currentPath = execSync('powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'PATH\', \'Machine\')"', {
        encoding: 'utf8'
      }).trim();

      const newPath = currentPath + ';' + pathToAdd;
      execSync(`powershell.exe -NoProfile -Command "[Environment]::SetEnvironmentVariable('PATH', '${newPath.replace(/'/g, "''")}', 'Machine')"`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });

      Logger.info('Added to system PATH: ' + pathToAdd);
      return { success: true, message: '已成功添加到系统 PATH' };
    } catch (e) {
      // If failed (likely due to permissions), try user PATH instead
      Logger.warn('Failed to add to system PATH, trying user PATH: ' + e.message);

      const userResult = this.addToUserPath(pathToAdd);
      if (userResult.success) {
        return {
          success: true,
          message: '已添加到用户 PATH（需要管理员权限才能添加到系统 PATH）',
          usedUserPath: true
        };
      }

      return {
        success: false,
        message: '添加失败：' + e.message + '。请尝试以管理员身份运行应用，或手动添加环境变量。',
        requiresAdmin: true
      };
    }
  }

  /**
   * Check current PATH status and provide fix suggestions
   */
  async checkAndFix() {
    const npmGlobalPath = this.getNpmGlobalPath();
    
    if (!npmGlobalPath) {
      return { 
        success: false, 
        message: '无法获取 npm 全局目录路径',
        npmGlobalPath: null,
        inSystemPath: false
      };
    }

    const inSystemPath = this.isInSystemPath(npmGlobalPath);
    
    return {
      success: true,
      npmGlobalPath,
      inSystemPath,
      message: inSystemPath 
        ? 'npm 全局目录已在系统 PATH 中'
        : 'npm 全局目录不在系统 PATH 中，需要添加'
    };
  }
}

module.exports = PathFixer;
