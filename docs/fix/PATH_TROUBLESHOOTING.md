# 环境变量 PATH 配置指南

## 问题说明

在安装 OpenClaw 后，需要将 npm 全局目录添加到 PATH 环境变量中，才能在命令行中使用 `openclaw` 命令。

## 自动添加（推荐）

在应用的 **"环境变量"** 标签页中：

1. 点击 **"检查 PATH"** 按钮
2. 如果显示 "需要添加"，点击 **"添加到 PATH"**
3. 系统会自动尝试添加：
   - **优先**：添加到用户 PATH（不需要管理员权限）
   - **备选**：如果需要系统 PATH，会提示需要管理员权限
4. **重启终端**（CMD/PowerShell）使更改生效

## 手动添加步骤

如果自动添加失败，可以手动操作：

### 方法一：添加到用户 PATH（推荐，不需要管理员权限）

1. 按 `Win + R`，输入 `sysdm.cpl`，回车
2. 点击 **"高级"** 标签页
3. 点击 **"环境变量"** 按钮
4. 在 **"用户变量"** 区域：
   - 如果已有 `Path` 变量：
     - 选中 `Path`，点击 **"编辑"**
     - 点击 **"新建"**
     - 添加路径：`C:\Users\你的用户名\.npm-global`
     - 点击 **"确定"**
   - 如果没有 `Path` 变量：
     - 点击 **"新建"**
     - 变量名：`Path`
     - 变量值：`C:\Users\你的用户名\.npm-global`
     - 点击 **"确定"**
5. 一路点击 **"确定"** 关闭所有对话框
6. **重启终端**（关闭并重新打开 CMD/PowerShell）

### 方法二：添加到系统 PATH（需要管理员权限）

1. 以管理员身份运行应用或 PowerShell
2. 按 `Win + R`，输入 `sysdm.cpl`，回车
3. 点击 **"高级"** 标签页
4. 点击 **"环境变量"** 按钮
5. 在 **"系统变量"** 区域：
   - 选中 `Path`，点击 **"编辑"**
   - 点击 **"新建"**
   - 添加路径：`C:\Users\你的用户名\.npm-global`
   - 点击 **"确定"**
6. 一路点击 **"确定"** 关闭所有对话框
7. **重启终端**（关闭并重新打开 CMD/PowerShell）

## 快速命令行方式（需要管理员权限）

以管理员身份运行 PowerShell，执行：

```powershell
# 添加到用户 PATH（推荐）
[Environment]::SetEnvironmentVariable('PATH', [Environment]::GetEnvironmentVariable('PATH', 'User') + ';C:\Users\你的用户名\.npm-global', 'User')

# 或者添加到系统 PATH（对所有用户生效）
[Environment]::SetEnvironmentVariable('PATH', [Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';C:\Users\你的用户名\.npm-global', 'Machine')
```

**注意**：将 `你的用户名` 替换为实际的 Windows 用户名。

## 验证配置

重启终端后，执行以下命令验证：

```bash
# 检查 openclaw 命令
openclaw --version

# 检查 npm 全局路径
npm config get prefix

# 检查 PATH 环境变量（PowerShell）
$env:PATH -split ';' | Select-String npm

# 检查 PATH 环境变量（CMD）
echo %PATH%
```

## 常见问题

### Q: 为什么添加后还是提示找不到命令？

**A:** 需要重启终端。环境变量的更改只有在新的进程中才会生效。

解决方法：
1. 完全关闭所有 CMD/PowerShell 窗口
2. 重新打开终端
3. 再次尝试 `openclaw --version`

### Q: 用户 PATH 和系统 PATH 有什么区别？

**A:**
- **用户 PATH**：
  - 仅对当前用户生效
  - 不需要管理员权限
  - 更安全，推荐使用

- **系统 PATH**：
  - 对所有用户生效
  - 需要管理员权限
  - 适合多用户共享的场景

### Q: 添加到 PATH 后需要重启电脑吗？

**A:** 不需要。只需要：
1. 关闭所有终端窗口
2. 重新打开终端
3. 新的 PATH 配置就会生效

### Q: 如何查看当前 PATH 配置？

**PowerShell:**
```powershell
# 查看用户 PATH
[Environment]::GetEnvironmentVariable('PATH', 'User')

# 查看系统 PATH
[Environment]::GetEnvironmentVariable('PATH', 'Machine')

# 查看当前进程的 PATH
$env:PATH
```

**CMD:**
```cmd
# 查看当前 PATH
echo %PATH%
```

### Q: 路径中有空格怎么办？

**A:** Windows 环境变量支持路径中的空格，无需特殊处理。但确保路径正确：

```powershell
# 示例：如果用户名包含空格
C:\Users\John Doe\.npm-global
```

## 最佳实践

1. **优先使用用户 PATH**
   - 不需要管理员权限
   - 更安全，不影响其他用户
   - 应用默认会尝试用户 PATH

2. **使用应用自动添加**
   - 一键操作
   - 自动处理权限问题
   - 提供详细的错误提示

3. **定期检查**
   - 在应用的 "环境变量" 标签页查看状态
   - 确保配置正确

4. **重启终端**
   - 任何 PATH 修改后都需要重启终端
   - 新开的终端窗口才会加载新配置

## 相关链接

- [Windows 环境变量官方文档](https://docs.microsoft.com/zh-cn/windows/win32/procthread/environment-variables)
- [npm 全局安装路径配置](https://docs.npmjs.com/cli/v9/configuring-npm/folders#prefix-configuration)
