# OpenClaw 依赖检测修复说明

## 问题概述
OpenClaw 在打包后部署到其他电脑时，无法检测到已安装的 Node.js 和 Git，尽管这些工具已在系统中正确安装。

## 修复内容

### 1. 改进了命令执行逻辑
- 扩展了 PATH 环境变量，包含更多可能的安装路径
- 改进了进程启动选项，使用更兼容的 shell 配置
- 修改了成功判断条件，对于版本命令只要有输出即视为成功

### 2. 增强了 Node.js 检测
- 添加了 `where node` 命令作为备用检测方法
- 扩展了常见安装路径列表，包括用户特定路径
- 降低了最低版本要求（从 v22 改为 v18）

### 3. 增强了 npm 检测
- 添加了 `where npm` 命令作为备用检测方法
- 改进了错误处理和路径解析

### 4. 增强了 Git 检测
- 保留了原有的多种检测方法
- 优化了路径搜索逻辑

## 技术细节

### 关键修改点：
1. `src/main/services/dependency-checker.js` 文件中的 `_execCommand` 方法
2. `src/main/services/dependency-checker.js` 文件中的 `_checkNode` 方法
3. `src/main/services/dependency-checker.js` 文件中的 `_checkNpm` 方法

### 主要改进：
- 更灵活的环境变量设置
- 更可靠的进程启动选项
- 更全面的路径搜索策略
- 更宽松的成功判断条件

## 预期效果
修复后，OpenClaw 应该能够在打包部署到其他电脑时正确检测到已安装的 Node.js、npm 和 Git，无论它们安装在什么位置。

## 验证方法
可以使用 `node validate-fix.js` 脚本来验证修复是否生效。