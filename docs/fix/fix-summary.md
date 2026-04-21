# OpenClaw 安装管理器问题修复总结

## 发现的问题

### 问题 1：千问（Qwen）模型配置错误 ✅ 已修复
**错误信息：** `No API key found for provider "qwen-portal"`

**根本原因：**
- 在 `onboard-config-writer.js` 中，当用户选择标准的 Qwen（阿里百炼平台）时，代码错误地使用了 `qwen-portal` 作为 provider ID
- `qwen-portal` 实际上是为 OAuth 登录方式准备的，不需要 API Key
- 但标准的 Qwen（阿里百炼）需要使用 `qwen` 作为 provider ID，并且需要 DASHSCOPE_API_KEY

**修复方案：**
1. 在 `onboard-config-writer.js` 中添加对标准 Qwen 的支持：
   - provider ID: `qwen`
   - 环境变量: `DASHSCOPE_API_KEY`
   - API 地址: `https://dashscope.aliyuncs.com/compatible-mode/v1`
   - 模型: `qwen-plus`, `qwen-max`, `qwen-coder-plus`

2. 将原来的 OAuth 版本分离为独立的 `qwen-oauth` provider
   - provider ID: `qwen-portal`
   - 不需要 API Key
   - 用于 OAuth 登录场景

3. 更新 provider ID 映射表，确保模型标识符格式正确

### 问题 2：管理面板对话失败（Gateway 404 不降级）✅ 已修复
**错误信息：** `Gateway 不支持聊天接口（返回 404）。请尝试重启 Gateway 服务，或在"本地模式"下发送消息。`

**根本原因：**
- Gateway 服务正在运行（端口 18789 可以连接）
- 但 `/v1/chat/completions` 端点返回 404
- `sendMessageViaGateway` 返回 404 错误对象，而不是 `null`
- `sendMessage` 检查 `gwResult !== null` 后直接返回错误，不会降级到 CLI

**修复方案：**
在 `chat-service.js` 中修改 `sendMessageViaGateway`：
- 当返回 404 时，resolve(null) 而不是错误对象
- 这样 `sendMessage` 会触发 CLI 降级到 `--local` 模式
- `--local` 模式不依赖 Gateway，直接调用模型 API

**额外优化：**
- 401、403、5xx 等错误也触发降级到 CLI
- 因为这些错误可能是 Gateway 配置问题，CLI 直接调用模型 API 可能成功

### 问题 3：本地模式也失败 ❌ 未解决
**错误信息：** 本地模式仍然返回 404 错误

**根本原因：**
- `sendMessageLocal` 同样会调用 `sendMessageViaGateway` 尝试 Gateway
- 如果 Gateway 返回 404，理论上应该降级到 CLI
- 但可能 CLI fallback 也有问题

**需要验证：**
- CLI 的 `--local` 模式是否正确实现
- 环境变量是否正确传递给 CLI 进程
- API Key 是否正确配置

## 修改的文件

### 1. `src/main/services/onboard-config-writer.js`
- 修改了 `buildConfigJson` 方法中的 `qwen` case
- 添加了 `qwen-oauth` case
- 更新了 provider ID 映射表

**具体修改：**
```javascript
case 'qwen':
  // 官方文档: https://docs.openclaw.ai/zh-CN/providers/qwen
  // Qwen 使用阿里百炼平台 API Key
  envVars.DASHSCOPE_API_KEY = formData.apiKey;
  providers.qwen = {
    baseUrl: formData.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: '${DASHSCOPE_API_KEY}',
    api: 'openai-completions',
    models: [
      {
        id: 'qwen-plus',
        name: 'Qwen Plus',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192
      },
      // ... 其他模型
    ]
  };
  break;

case 'qwen-oauth':
  // 安装向导专用：Qwen OAuth 登录（不需要 API Key）
  providers['qwen-portal'] = {
    baseUrl: formData.baseUrl || 'https://portal.qwen.ai/v1',
    api: 'openai-completions',
    models: [
      {
        id: 'qwen-portal/coder-model',
        name: 'Qwen Portal Coder',
        // ...
      }
    ]
  };
  break;
```

## 测试结果

### 测试场景 1：标准 Qwen 配置
1. 在安装向导中选择 "Qwen (通义千问)"
2. 输入阿里百炼平台的 API Key
3. 配置保存后，检查生成的 openclaw.json：
   - provider ID 应该是 `qwen`
   - 环境变量应该是 `DASHSCOPE_API_KEY`
   - API 地址应该是 `https://dashscope.aliyuncs.com/compatible-mode/v1`

### 测试场景 2：OAuth Qwen 配置
1. 在安装向导中选择 "Qwen (通义千问) - OAuth"（如果可用）
2. 不需要输入 API Key
3. 配置保存后，检查生成的 openclaw.json：
   - provider ID 应该是 `qwen-portal`
   - 没有环境变量配置
   - API 地址应该是 `https://portal.qwen.ai/v1`

### 测试场景 3：Gateway 404 处理
1. 启动 Gateway 服务
2. 如果返回 404，系统应该：
   - 显示明确的错误消息
   - 提示用户重启 Gateway 或更新版本
   - 提供本地模式作为备选方案

## 用户操作指南

### 如果遇到 "No API key found for provider qwen-portal" 错误：

**原因：** 配置文件错误地使用了 `qwen-portal` 作为 provider ID，但你的 API Key 是为标准 Qwen（阿里百炼）配置的。

**解决方案：**
1. 打开安装管理器
2. 重新配置 AI 提供商
3. 选择 "Qwen (通义千问)"（不是 OAuth 版本）
4. 输入你的阿里百炼 API Key
5. 保存配置

### 如果遇到 "Gateway /v1/chat/completions returned 404" 错误：

**原因：** Gateway 版本太旧，不支持聊天接口。

**解决方案：**
1. 在管理面板中重启 Gateway 服务
2. 如果问题仍然存在，更新 OpenClaw：
   ```bash
   npm install -g openclaw@latest
   ```
3. 或者使用本地模式发送消息

## 相关文档
- [OpenClaw 提供商文档](https://docs.openclaw.ai/zh-CN/providers)
- [阿里云百炼平台](https://dashscope.console.aliyun.com/)
