const path = require('path');
const fs = require('fs');
const os = require('os');
const Logger = require('./logger');

/**
 * ResourceLocator - 统一的资源文件定位工具
 * 解决开发和打包环境下路径不一致的问题
 */
class ResourceLocator {
  /**
   * 检测当前是否在打包环境中运行
   */
  static isPackaged() {
    return process.defaultApp !== true && process.resourcesPath !== '';
  }

  /**
   * 获取资源根目录
   * 开发环境: 项目根目录
   * 打包环境: process.resourcesPath
   */
  static getResourcesRoot() {
    if (ResourceLocator.isPackaged()) {
      // 打包环境: resourcesPath 指向 resources 目录
      Logger.info('ResourceLocator: Packaged mode, resourcesPath = ' + process.resourcesPath);
      return process.resourcesPath;
    } else {
      // 开发环境: 项目根目录 (从 src/main/utils 向上三级到项目根)
      const root = path.join(__dirname, '..', '..', '..');
      Logger.info('ResourceLocator: Dev mode, root = ' + root);
      return root;
    }
  }

  /**
   * 查找资源文件（支持多个可能的路径）
   * @param {string[]} relativePaths - 相对路径数组
   * @param {string} description - 资源描述（用于日志）
   * @returns {string|null} 找到的文件完整路径，未找到返回 null
   */
  static findResource(relativePaths, description = 'resource') {
    const resourcesRoot = ResourceLocator.getResourcesRoot();

    Logger.info(`ResourceLocator: Looking for ${description}`);
    Logger.info(`ResourceLocator: resourcesRoot = ${resourcesRoot}`);

    // 尝试所有可能的路径
    const pathsToTry = [];
    
    for (const relPath of relativePaths) {
      // 路径 1: resourcesRoot / relativePath
      pathsToTry.push(path.join(resourcesRoot, relPath));
      
      // 路径 2: resourcesRoot / resources / relativePath (打包时的额外资源目录)
      pathsToTry.push(path.join(resourcesRoot, 'resources', relPath));
    }

    // 在开发模式下，额外尝试项目根目录下的 resources
    if (!ResourceLocator.isPackaged()) {
      const projectRoot = path.join(__dirname, '..', '..');
      for (const relPath of relativePaths) {
        pathsToTry.push(path.join(projectRoot, 'resources', relPath));
      }
    }

    // 去重
    const uniquePaths = [...new Set(pathsToTry)];

    // 检查每个路径
    for (const filePath of uniquePaths) {
      if (fs.existsSync(filePath)) {
        Logger.info(`ResourceLocator: Found ${description} at ${filePath}`);
        return filePath;
      } else {
        Logger.debug(`ResourceLocator: ${description} not found at ${filePath}`);
      }
    }

    Logger.warn(`ResourceLocator: ${description} not found in any location`);
    return null;
  }

  /**
   * 获取 Node.js 安装包路径
   */
  static getNodeJsInstaller() {
    const nodeMsi = ResourceLocator.findResource(
      ['nodejs/node-v22.22.1-x64.msi'],
      'Node.js installer'
    );
    return nodeMsi;
  }

  /**
   * 获取 Git 安装包路径
   */
  static getGitInstaller() {
    // 尝试多个可能的 Git 版本
    const gitVersions = [
      'gitbash/Git-2.49.0-64-bit.exe',
      'gitbash/Git-2.48.1-64-bit.exe',
      'gitbash/Git-2.47.0-64-bit.exe',
      'gitbash/Git-2.46.0-64-bit.exe'
    ];

    for (const relPath of gitVersions) {
      const gitExe = ResourceLocator.findResource(
        [relPath],
        'Git installer'
      );
      if (gitExe) {
        return gitExe;
      }
    }

    Logger.warn('ResourceLocator: Git installer not found. User will need to install Git manually or provide the installer.');
    return null;
  }

  /**
   * 检查所有必需的资源文件
   */
  static checkAllResources() {
    const resources = [
      { name: 'Node.js installer', path: ResourceLocator.getNodeJsInstaller() },
      { name: 'Git installer', path: ResourceLocator.getGitInstaller() }
    ];

    const results = resources.map(r => ({
      name: r.name,
      exists: r.path !== null,
      path: r.path
    }));

    Logger.info('ResourceLocator: Resource check results:');
    results.forEach(r => {
      Logger.info(`  ${r.name}: ${r.exists ? 'EXISTS' : 'MISSING'} (${r.path || 'N/A'})`);
    });

    return results;
  }
}

module.exports = ResourceLocator;
