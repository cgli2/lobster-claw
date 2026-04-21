/**
 * 默认配置参数
 * 
 * 本文件集中管理项目中所有的硬编码参数值，便于维护和修改。
 * 所有其他模块应优先引用此文件中的配置，而非使用硬编码值。
 */

const path = require('path');
const os = require('os');

/**
 * 默认配置 - 网络相关
 */
const network = {
  /** Gateway 服务默认绑定地址 */
  gatewayBind: '127.0.0.1',
  
  /** Gateway 服务默认端口 */
  gatewayPort: 18789,
  
  /** Ollama 本地 API 默认地址 */
  ollamaBaseUrl: 'http://localhost:11434/v1',
  
  /** Gateway API 路径 */
  gatewayApiPath: '/v1/chat/completions',
  
  /** Gateway 工具调用路径 */
  gatewayToolsPath: '/tools/invoke',
};

/**
 * 默认配置 - 超时设置（毫秒）
 */
const timeouts = {
  /** 常规请求超时 */
  defaultTimeout: 120000,           // 2 分钟
  
  /** Gateway 探测超时 */
  gatewayProbeTimeout: 1500,        // 1.5 秒
  
  /** Gateway 缓存 TTL */
  gatewayCacheTtl: 30000,           // 30 秒
  
  /** 技能列表缓存 TTL */
  skillsCacheTtl: 30000,            // 30 秒
  
  /** 服务状态轮询间隔 */
  statusPollInterval: 5000,         // 5 秒
  
  /** 服务启动超时（首次启动需要加载模型等资源，可能较久） */
  startTimeout: 60000,              // 60 秒
  
  /** 安装操作超时 */
  installTimeout: 1800000,          // 30 分钟
  
  /** npm 命令超时 */
  npmTimeout: 30000,                // 30 秒
  
  /** CLI 命令默认超时 */
  cliTimeout: 30000,               // 30 秒
  
  /** 长时间运行命令超时 */
  cliLongTimeout: 120000,          // 2 分钟
  
  /** CLI 聊天超时（CLI 模式天生较慢：冷启动 + 无流式）
   * 注意：Electron IPC 本身没有内置超时限制，但为了避免无限等待，
   * 设置一个合理的上限。大模型推理复杂问题时可能需要较长时间。
   */
  cliChatTimeout: 300000,          // 5 分钟（给大模型足够推理时间）
};

/**
 * 默认配置 - 样式相关
 * 
 * 注意：部分复杂样式仍保留在各组件的 CSS 文件中
 */
const styles = {
  /** 提示信息显示时长 */
  toastDuration: 3000,
  
  /** 错误提示显示时长 */
  toastErrorDuration: 5000,
  
  /** Toast z-index */
  toastZIndex: 9999,
  
  /** 弹窗 z-index */
  modalZIndex: 10000,
};

/**
 * 默认配置 - 路径相关
 */
const paths = {
  /** OpenClaw 主目录名称 */
  openclawDirName: '.openclaw',
  
  /** 配置文件名称 */
  configFileName: 'openclaw.json',
  
  /** 环境变量文件名称 */
  envFileName: '.env',
  
  /** Agent 目录名称 */
  agentsDirName: 'agents',
  
  /** 技能目录名称 */
  skillsDirName: 'skills',
  
  /** 禁用的技能目录名称 */
  skillsDisabledDirName: 'skills-disabled',
  
  /** workspace 目录名称 */
  workspaceDirName: 'workspace',
  
  /** 认证配置目录名称 */
  authProfilesFileName: 'auth-profiles.json',
  
  /** 模型配置目录名称 */
  modelsFileName: 'models.json',
  
  /** Agent 配置目录名称 */
  agentFileName: 'agent.json',
};

/**
 * 默认配置 - 功能开关
 */
const features = {
  /** Gateway 控制台允许的跨域来源 */
  allowedOrigins: ['*'],
  
  /** Gateway 默认运行模式 */
  gatewayMode: 'local',
  
  /** 认证模式 */
  authMode: 'token',
};

/**
 * 获取完整配置对象的便捷方法
 */
function getConfig() {
  return {
    network,
    timeouts,
    styles,
    paths,
    features
  };
}

/**
 * 导出各独立配置对象，便于直接引用
 */
module.exports = {
  // 网络配置
  network,
  
  // 超时配置
  timeouts,
  
  // 样式配置
  styles,
  
  // 路径配置
  paths,
  
  // 功能配置
  features,
  
  // 便捷方法
  getConfig,
  
  // 兼容旧代码的导出
  DEFAULT_TIMEOUT: timeouts.defaultTimeout,
  GATEWAY_PORT: network.gatewayPort,
  GATEWAY_BIND: network.gatewayBind,
};
