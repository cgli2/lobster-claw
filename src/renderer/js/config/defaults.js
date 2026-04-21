/**
 * 渲染进程默认配置
 * 
 * 本文件集中管理渲染进程中所有的硬编码参数值，便于维护和修改。
 * 注意：这是纯浏览器端代码，不能使用 Node.js 模块。
 */

// 警告：此文件通过 script 标签引入，全局变量将直接暴露
(function(global) {
  'use strict';

  /**
   * 配置对象
   */
  var RENDERER_CONFIG = {
    /** 网络相关 */
    network: {
      gatewayBind: '127.0.0.1',
      gatewayPort: 18789,
      ollamaBaseUrl: 'http://localhost:11434/v1'
    },

    /** 超时设置（毫秒） */
    timeouts: {
      statusPollInterval: 5000,     // 服务状态轮询间隔
      gatewayCacheTtl: 30000,      // Gateway 缓存 TTL
      cliTimeout: 30000,           // CLI 命令超时
      defaultTimeout: 120000,      // 默认超时
      gatewayProbeTimeout: 1500    // Gateway 探测超时
    },

    /** 样式相关 */
    styles: {
      toastDuration: 3000,          // Toast 显示时长
      toastErrorDuration: 5000,   // 错误提示显示时长
      toastZIndex: 9999,           // Toast z-index
      modalZIndex: 10000,          // 弹窗 z-index
      copyButtonResetTime: 2000    // 复制按钮恢复时间
    }
  };

  // 导出到全局作用域
  global.RENDERER_CONFIG = RENDERER_CONFIG;

  // 为方便使用，创建简化的别名
  global.NETWORK = RENDERER_CONFIG.network;
  global.TIMEOUTS = RENDERER_CONFIG.timeouts;
  global.STYLES = RENDERER_CONFIG.styles;

})(typeof window !== 'undefined' ? window : this);
