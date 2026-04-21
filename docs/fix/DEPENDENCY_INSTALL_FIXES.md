# 修复说明：依赖安装问题

## 问题描述
用户遇到安装依赖时的错误：
- 错误代码：`1619` (安装程序返回错误代码)
- 文件操作错误：`ENOENT: no such file or directory, rename 'C:\Users\op.36964\.openclaw-installer\cache\NodeJS-installer.msi.downloading' -> 'C:\Users\op.36964\.openclaw-installer\cache\NodeJS-installer.msi'`
- `winget` 未找到错误：`spawn winget ENOENT`

## 问题分析
经过分析代码，发现问题主要集中在 `DependencyChecker` 类的下载和安装功能：

1. 缓存目录（`~/.openclaw-installer/cache`）可能不存在
2. 下载过程中出现临时文件操作异常
3. 下载函数没有充分处理边界情况

## 修复内容

### 1. 改进 `_downloadNodeInstaller` 函数
- 在下载前确保缓存目录存在
- 添加递归创建目录的逻辑

### 2. 改进 `_downloadGitInstaller` 函数
- 在下载前确保缓存目录存在
- 添加递归创建目录的逻辑

### 3. 增强 `_downloadFile` 函数
- 更好的临时文件处理
- 在重命名前检查源文件是否存在
- 改进错误处理和清理机制
- 添加更详细的日志记录

## 使用说明

如果遇到类似问题，可以按以下步骤操作：

1. 运行缓存清理脚本：
   ```bash
   node clean-cache.js
   ```

2. 然后再尝试安装依赖

## 额外工具

- `clean-cache.js`: 清理缓存目录中的临时文件
- `fix-cache-dir.js`: 确保缓存目录结构正确

这些修复使依赖安装过程更加稳定，能够更好地处理缓存目录不存在或临时文件异常的情况。