# OpenClaw 管理面板对话功能修复 - 测试指南

## 修复总结

### 问题 1：Qwen 模型配置错误 ✅ 已修复
**错误：** `No API key found for provider "qwen-portal"`

**修复：** 修改 `onboard-config-writer.js`，为标准 Qwen（阿里百炼）使用正确的 provider ID `qwen` 和环境变量 `DASHSCOPE_API_KEY`。

### 问题 2：管理面板对话失败（Gateway 404 不降级）✅ 已修复
**错误：** `Gateway 不支持聊天接口（返回 404）`

**修复：** 修改 `chat-service.js`，当 Gateway 返回 404/401/403/5xx 时，返回 `null` 触发 CLI 降级到 `--local` 模式。

### 问题 3：本地模式也失败 ❓ 待验证
**状态：** 需要用户测试验证

**可能原因：**
1. `openclaw.mjs` 文件找不到
2. Node.js 版本太低（需要 v22.12+）
3. `--local` 模式实现有 bug
4. API Key 没有正确传递给 CLI

---

## 测试步骤

### 测试前准备

1. **检查 OpenClaw 版本**
   ```bash
   openclaw --version
   ```
   确保是最新版本（如果不是，运行 `npm install -g openclaw@latest`）

2. **检查 Node.js 版本**
   ```bash
   node --version
   ```
   需要 v22.12 或更高版本

3. **检查 openclaw.mjs 文件是否存在**
   ```bash
   dir "%USERPROFILE%\.npm-global\node_modules\openclaw\openclaw.mjs"
   ```
   或
   ```bash
   dir "%APPDATA%\npm\node_modules\openclaw\openclaw.mjs"
   ```

4. **检查配置文件**
   打开 `~/.openclaw/openclaw.json`，确认：
   - provider ID 是 `qwen`（不是 `qwen-portal`）
   - 有 `DASHSCOPE_API_KEY` 环境变量

### 测试 1：管理面板 - 正常模式（使用 Gateway）

**步骤：**
1. 打开 OpenClaw 安装管理器
2. 进入"管理面板"
3. 点击"智能对话"
4. 确保"本地模式"**未勾选**
5. 发送一条测试消息（如"你好"）

**预期结果：**
- Gateway 状态正常（端口 18789 监听）
- 消息发送成功
- 收到 AI 回复

**如果失败：**
- 检查 Gateway 状态：
  ```bash
  netstat -ano | findstr "18789"
  ```
- 查看日志：`~/.openclaw/logs/gateway.log`

### 测试 2：管理面板 - 本地模式（不依赖 Gateway）

**步骤：**
1. 打开 OpenClaw 安装管理器
2. 进入"管理面板"
3. 点击"智能对话"
4. 勾选"本地模式"
5. 发送一条测试消息（如"你好"）

**预期结果：**
- 不依赖 Gateway，直接使用 `openclaw agent --local` 命令
- 消息发送成功
- 收到 AI 回复

**如果失败：**
1. 检查 Node.js 是否存在：
   ```bash
   where node
   ```

2. 检查 openclaw.mjs 是否存在：
   ```bash
   dir /s /b openclaw.mjs
   ```

3. 手动测试 CLI 命令：
   ```bash
   node "C:\Users\你的用户名\.npm-global\node_modules\openclaw\openclaw.mjs" agent --local --json --agent main -m "你好"
   ```

4. 检查 .env 文件中的 API Key：
   ```bash
   type "%USERPROFILE%\.openclaw\.env"
   ```
   确认有 `DASHSCOPE_API_KEY=sk-...`

### 测试 3：UI Control 对话（对比测试）

**步骤：**
1. 打开 OpenClaw 安装管理器
2. 进入"UI Control"
3. 在输入框中发送消息

**预期结果：**
- 对话正常工作（根据用户反馈，这个应该已经正常）

**目的：**
- 验证配置是正确的
- 对比管理面板的行为

### 测试 4：Gateway 健康检查

**步骤：**
```bash
openclaw gateway health
```

**预期结果：**
- 显示 Gateway 运行状态
- 如果失败，尝试重启：
  ```bash
  openclaw gateway restart
  ```

### 测试 5：CLI 本地模式直接测试

**步骤：**
```bash
# 使用你的 API Key
set DASHSCOPE_API_KEY=sk-your-api-key

# 测试本地模式
openclaw agent --local --json --agent main -m "你好"
```

**预期结果：**
- 直接调用 Qwen API
- 返回 JSON 格式的回复

---

## 问题排查

### 问题：找不到 openclaw.mjs

**症状：**
```
Error: Cannot find module 'C:\Users\...\openclaw.mjs'
```

**解决方案：**
1. 确认 OpenClaw 已安装：
   ```bash
   npm list -g openclaw
   ```

2. 如果未安装或路径不对，重新安装：
   ```bash
   npm install -g openclaw@latest
   ```

3. 查找正确的路径：
   ```bash
   where openclaw
   ```
   然后根据结果找到对应的 .mjs 文件

### 问题：Node.js 版本太低

**症状：**
```
找不到系统安装的 Node.js v22.12+
```

**解决方案：**
1. 下载并安装 Node.js v22.12+：
   https://nodejs.org/

2. 安装后重启电脑

3. 验证版本：
   ```bash
   node --version
   ```

### 问题：API Key 未配置

**症状：**
```
No API key found for provider "qwen"
```

**解决方案：**
1. 打开配置文件：
   ```bash
   notepad "%USERPROFILE%\.openclaw\.env"
   ```

2. 添加 API Key：
   ```
   DASHSCOPE_API_KEY=sk-your-api-key-here
   ```

3. 保存并重启 OpenClaw

### 问题：模型名称错误

**症状：**
```
模型调用失败，请检查模型配置
```

**解决方案：**
1. 打开 `~/.openclaw/openclaw.json`
2. 检查 `agents.defaults.model.primary` 的值
3. 应该是 `qwen/qwen-plus` 或 `qwen/qwen-max` 等
4. 不是 `qwen-portal/...`

### 问题：CLI 返回 404

**症状：**
```
CLI --local 模式也返回 404
```

**可能原因：**
1. API Key 无效或过期
2. 模型名称不正确
3. 网络问题无法访问阿里云服务

**解决方案：**
1. 验证 API Key：
   ```bash
   curl -X POST "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions" \
     -H "Authorization: Bearer sk-your-api-key" \
     -H "Content-Type: application/json" \
     -d '{"model": "qwen-plus", "messages": [{"role": "user", "content": "hi"}]}'
   ```

2. 检查网络连接

3. 确认模型名称在阿里云平台可用

---

## 日志查看

### Gateway 日志
```bash
type "%USERPROFILE%\.openclaw\logs\gateway.log"
```

### 主进程日志（Electron）
在开发者工具中查看 Console

### CLI 日志
在命令行运行 CLI 命令时查看输出

---

## 验证修复

### 验证 Qwen 配置修复

1. 打开 `~/.openclaw/openclaw.json`
2. 确认：
   ```json
   {
     "env": {
       "vars": {
         "DASHSCOPE_API_KEY": "your-api-key"
       }
     },
     "models": {
       "providers": {
         "qwen": {
           "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
           "apiKey": "${DASHSCOPE_API_KEY}",
           ...
         }
       }
     }
   }
   ```

### 验证 Gateway 404 降级修复

1. 确保 Gateway 返回 404（或停止 Gateway）
2. 在管理面板发送消息
3. 应该自动降级到 CLI --local 模式
4. 查看日志确认：
   ```
   Gateway /v1/chat/completions returned 404 - gateway version may be outdated, will fallback to CLI --local mode
   CLI fallback (local): ...
   ```

---

## 反馈收集

如果测试后仍然有问题，请提供以下信息：

1. **错误消息截图**
2. **日志文件**：
   - `~/.openclaw/logs/gateway.log`
   - Electron 控制台日志（按 F12 打开）

3. **配置文件**（脱敏后）：
   - `~/.openclaw/openclaw.json`
   - `~/.openclaw/.env`（隐藏 API Key）

4. **测试结果**：
   - 测试 1：正常模式 ✓/✗
   - 测试 2：本地模式 ✓/✗
   - 测试 3：UI Control ✓/✗
   - 测试 4：Gateway 健康 ✓/✗
   - 测试 5：CLI 本地模式 ✓/✗

5. **环境信息**：
   - Node.js 版本：`node --version`
   - OpenClaw 版本：`openclaw --version`
   - 操作系统：Windows 版本
   - openclaw.mjs 路径：`where /r C:\ openclaw.mjs`

---

## 总结

本次修复解决了两个主要问题：

1. **Qwen 配置错误**：现在使用正确的 provider ID `qwen` 和环境变量 `DASHSCOPE_API_KEY`

2. **Gateway 404 不降级**：现在当 Gateway 返回 404/401/403/5xx 时，会自动降级到 CLI --local 模式

**待验证：** 本地模式（CLI fallback）是否正常工作，需要用户根据测试指南进行验证。
