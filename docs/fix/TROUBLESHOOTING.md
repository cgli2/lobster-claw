# 故障排查指南

## 常见问题

### 1. 打包后无法检测已安装的 OpenClaw

**症状**：
- 开发环境 (`npm run dev`) 可以正确检测
- 打包后的程序无法检测，一直显示未安装

**解决方法**：
1. 打开开发者工具 (按 F12)
2. 在控制台运行诊断：
```javascript
const diag = await window.openclawAPI.utils.runDiagnostics();
console.log(JSON.stringify(diag, null, 2));
```

3. 检查诊断输出：
   - `openclaw.installed`: 是否检测到已安装
   - `openclaw.configPath`: 配置目录路径
   - `openclaw.version`: 检测到的版本

4. 如果配置目录存在但未检测到：
```javascript
// 手动检查配置目录
const configPath = diag.openclaw.configPath;
console.log('Config exists:', diag.openclaw.configExists);
console.log('Config content:', diag.openclaw.configContent);
```

### 2. 资源文件缺失

**症状**：
- 安装 Node.js 时提示找不到安装包
- 诊断报告显示 `nodeInstaller: false`

**解决方法**：
1. 检查诊断报告中的 `resources` 部分：
```javascript
const diag = await window.openclawAPI.utils.runDiagnostics();
console.log('Resources:', diag.resources);
```

2. 确认资源文件存在：
   - Node.js 安装包应位于：`resources/nodejs/node-v22.22.1-x64.msi`
   - 如果打包后缺失，检查 `package.json` 的 `extraResources` 配置

3. 如果使用便携版，确保资源文件在正确的位置

### 3. Git 安装失败

**症状**：
- 提示 "未找到内置 Git 安装包"

**解决方法**：
1. 手动下载 Git：
   - 访问：https://git-scm.com/download/win
   - 下载 Git for Windows 安装包
   - 使用默认设置安装

2. 或者自行添加安装包：
   - 将 `Git-2.x.x-64-bit.exe` 放入 `resources/gitbash/` 目录
   - 重新打包

### 4. OpenClaw 安装失败

**症状**：
- `npm install -g openclaw@latest` 执行失败

**解决方法**：
1. 检查网络连接
2. 尝试切换镜像源（在安装步骤选择）
3. 手动安装：
```bash
# 在命令行执行
npm install -g openclaw@latest
```

## 诊断工具使用

### 运行完整诊断

打开开发者工具 (F12)，在控制台运行：

```javascript
const diag = await window.openclawAPI.utils.runDiagnostics();

// 查看完整结果
console.log(diag);

// 检查特定部分
console.log('系统信息:', diag.system);
console.log('资源文件:', diag.resources);
console.log('OpenClaw状态:', diag.openclaw);
console.log('总结:', diag.summary);
```

### 保存诊断报告

```javascript
const reportPath = await window.openclawAPI.utils.saveDiagnosticReport();
console.log('诊断报告已保存至:', reportPath);

// 在文件资源管理器中打开
require('electron').shell.openPath(reportPath);
```

### 诊断报告示例

```
=== OpenClaw 安装管理器诊断报告 ===
生成时间: 2024-03-12T10:30:45.123Z

--- 系统环境 ---
操作系统: win32 x64
用户目录: C:\Users\YourName
Node.js: 已安装 (v22.22.1)
npm: 已安装 (10.5.2)
Git: 已安装 (2.49.0)

--- 资源文件 ---
运行模式: 打包环境
资源根目录: C:\Program Files\OpenClaw安装管理器\resources
Node.js 安装包: 存在 (C:\Program Files\OpenClaw安装管理器\resources\nodejs\node-v22.22.1-x64.msi)
Git 安装包: 缺失

--- OpenClaw 状态 ---
已安装: 是
版本: 1.2.3
配置目录: 存在 (C:\Users\YourName\.openclaw)

--- 总结 ---
✓ 所有检查通过
```

## 手动检查步骤

### 1. 检查 OpenClaw 配置目录

```javascript
// Windows: %USERPROFILE%\.openclaw
// Linux/Mac: ~/.openclaw

const fs = require('fs');
const path = require('path');
const os = require('os');

const configPath = path.join(os.homedir(), '.openclaw');
const exists = fs.existsSync(configPath);
console.log('OpenClaw 配置目录存在:', exists);

if (exists) {
  const files = fs.readdirSync(configPath);
  console.log('目录内容:', files);
}
```

### 2. 检查 openclaw.json

```javascript
const fs = require('fs');
const path = require('path');
const os = require('os');

const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');

if (fs.existsSync(configPath)) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log('版本:', config.app?.version || config.version);
  console.log('配置:', JSON.stringify(config, null, 2));
} else {
  console.log('配置文件不存在');
}
```

### 3. 检查 OpenClaw 可执行文件

```javascript
// Windows
const path = require('path');
const os = require('os');
const fs = require('fs');

const possiblePaths = [
  path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'openclaw.cmd'),
  path.join(os.homedir(), '.npm-global', 'openclaw.cmd'),
  path.join(os.homedir(), '.npm-global', 'bin', 'openclaw.cmd'),
];

for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    console.log('找到可执行文件:', p);
  }
}
```

## 获取帮助

如果以上方法都无法解决问题：

1. 运行诊断工具并保存报告
2. 将诊断报告发到 GitHub Issues
3. 包含以下信息：
   - 操作系统版本
   - 应用版本
   - 完整的诊断报告
   - 复现步骤

## 调试模式

启用详细日志：

1. 打开开发者工具 (F12)
2. 切换到 Console 标签
3. 所有日志都会显示在控制台
4. 切换到 Network 标签查看网络请求
5. 切换到 Application 标签查看本地存储
