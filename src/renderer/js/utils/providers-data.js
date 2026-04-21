/* eslint-disable no-unused-vars */
/**
 * PROVIDER_DATA - 统一厂商配置枚举
 *
 * 所有 AI 服务商的元数据在此统一维护，避免在多处重复定义。
 * 引用此数据的模块：
 *   - step-configure.js（安装向导配置页）
 *   - tab-apikeys.js（管理面板模型配置页）
 *   - onboard-config-writer.js（配置写入服务，主进程侧）
 *
 * 官方文档: https://docs.openclaw.ai/zh-CN/providers
 *
 * 字段说明：
 *   name          - 显示名称
 *   baseUrl       - API 基础地址
 *   placeholder   - API Key 输入框提示文字
 *   models        - 预定义模型列表（null 表示自由输入，如 Ollama）
 *   modelPlaceholder - models 为 null 时的输入框提示（可选）
 *   envKey        - 存储 API Key 的环境变量名（null 表示不需要 Key，如 OAuth/Ollama）
 *   providerId    - openclaw.json 中 models.providers 使用的 ID
 *   modelPrefix   - 模型名前缀（用于构建 agents.defaults.model.primary 的 providerId 部分）
 *   api           - API 协议类型（可选，默认 openai-completions）
 *   noApiKey      - true 表示不需要 API Key（如 Ollama 本地）
 *   oauth         - true 表示使用 OAuth 登录（安装向导专用，管理面板不显示）
 *   wizardOnly    - true 表示仅在安装向导中显示，管理面板 API Keys 页不显示
 */
const PROVIDER_DATA = {
  moonshot: {
    name: 'Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.cn/v1',
    placeholder: 'sk-...',
    models: ['kimi-k2.5', 'kimi-k2-0905-preview', 'kimi-k2-turbo-preview', 'kimi-k2-thinking', 'kimi-k2-thinking-turbo'],
    envKey: 'MOONSHOT_API_KEY',
    providerId: 'moonshot',
    modelPrefix: 'moonshot'
  },

  'kimi-coding': {
    name: 'Kimi Coding',
    baseUrl: 'https://api.kimi.com/coding',
    placeholder: 'sk-...',
    models: ['k2p5'],
    envKey: 'KIMI_API_KEY',
    providerId: 'kimi-coding',
    modelPrefix: 'kimi-coding'
  },

  qwen: {
    name: 'Qwen (通义千问)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    placeholder: 'sk-...(阿里百炼)',
    models: ['qwen-plus', 'qwen-max', 'qwen-coder-plus', 'qwen-turbo'],
    envKey: 'DASHSCOPE_API_KEY',
    providerId: 'qwen',
    modelPrefix: 'qwen'
  },

  // 安装向导专用：Qwen OAuth 登录（不需要手动输入 API Key）
  'qwen-oauth': {
    name: 'Qwen (通义千问) - OAuth',
    baseUrl: 'https://portal.qwen.ai/v1',
    placeholder: 'OAuth 登录（无需手动输入）',
    models: ['qwen-portal/coder-model', 'qwen-portal/vision-model'],
    envKey: null,
    providerId: 'qwen-portal',
    modelPrefix: 'qwen-portal',
    oauth: true,
    wizardOnly: true  // 管理面板 API Keys 页不显示此选项
  },

  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    placeholder: 'sk-...',
    models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
    envKey: 'DEEPSEEK_API_KEY',
    providerId: 'deepseek',
    modelPrefix: 'deepseek'
  },

  minimax: {
    name: 'MiniMax M2.1',
    baseUrl: 'https://api.minimax.io/anthropic',
    placeholder: 'sk-...',
    models: ['MiniMax-M2.1', 'MiniMax-M2.1-lightning'],
    envKey: 'MINIMAX_API_KEY',
    providerId: 'minimax',
    modelPrefix: 'minimax',
    api: 'anthropic-messages'
  },

  glm: {
    name: 'GLM (Z.AI)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
    placeholder: 'sk-...',
    models: ['glm-5', 'glm-4.7', 'glm-4.6'],
    envKey: 'ZAI_API_KEY',
    providerId: 'zai',
    modelPrefix: 'zai'
  },

  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    placeholder: 'sk-...',
    models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
    envKey: 'OPENAI_API_KEY',
    providerId: 'openai',
    modelPrefix: 'openai'
  },

  ollama: {
    name: 'Ollama（本地）',
    baseUrl: 'http://localhost:11434/v1',
    placeholder: '可留空',
    models: null,
    noApiKey: true,
    modelPlaceholder: '输入已拉取的模型名，如 llama3, qwen2.5, deepseek-r1',
    envKey: null,
    providerId: 'ollama',
    modelPrefix: 'ollama'
  }
};
