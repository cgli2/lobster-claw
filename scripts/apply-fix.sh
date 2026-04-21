#!/bin/bash
# OpenClaw 依赖检测修复补丁脚本

# 此脚本演示如何修复 OpenClaw 安装管理器中依赖检测的问题
# 主要是增强 dependency-checker.js 文件的功能

echo "OpenClaw 依赖检测修复指南"
echo "=========================="

echo ""
echo "1. 问题诊断:"
echo "   - 运行环境诊断工具: node diagnose-env.js"
echo "   - 检查 PATH 环境变量是否包含 Node.js 和 Git 路径"
echo "   - 验证 Node.js 和 Git 是否正常安装"

echo ""
echo "2. 修复步骤:"

echo "   a) 备份原始文件:"
echo "      cp src/main/services/dependency-checker.js src/main/services/dependency-checker.js.bak"

echo ""
echo "   b) 应用以下关键修复到 dependency-checker.js:"

cat << 'EOF'

// 在 _execCommand 方法中增强环境变量处理
async _execCommand(cmd, args, timeout = 30000) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    // 构建增强的环境变量
    const env = { ...process.env };

    // 添加常见的 Node.js 和 Git 安装路径
    const extraPaths = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs'),
      path.join(os.homedir(), 'AppData', 'Roaming', 'npm'),
      path.join(os.homedir(), '.npm-global', 'bin'),
      'C:\\Program Files\\nodejs',
      'C:\\Program Files\\Git\\bin',
      'C:\\Program Files\\Git\\cmd',
      'C:\\Program Files (x86)\\Git\\bin',
      'C:\\Program Files (x86)\\Git\\cmd'
    ];

    env.PATH = [...extraPaths, env.PATH].filter(p => p).join(path.delimiter);

    const child = spawn(cmd, args, {
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
      env: env,
      windowsHide: true
    });

    // ... 原有的处理逻辑 ...
  });
}

// 在 _checkNode 和 _checkGit 方法中增加更多检测路径
async _checkNode() {
  // ... 原有逻辑 ...

  // 增加更多常见路径检测
  const commonPaths = [
    // ... 原有路径 ...
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node.exe'),
    path.join(os.homedir(), '.npm-global', 'bin', 'node.exe'),
    // 添加更多可能的路径
  ];

  // ... 检测逻辑 ...
}

async _checkGit() {
  // ... 原有逻辑 ...

  // 增加注册表查询（Windows）
  if (process.platform === 'win32') {
    try {
      const regResult = await this._execCommand('reg', ['query', 'HKLM\\SOFTWARE\\GitForWindows', '/v', 'InstallPath']);
      // ... 处理注册表结果 ...
    } catch (err) {
      // 忽略注册表错误
    }
  }

  // ... 其他检测逻辑 ...
}
EOF

echo ""
echo "3. 测试修复:"
echo "   - 重新构建应用: npm run build"
echo "   - 在目标机器上测试依赖检测功能"
echo "   - 验证 Node.js 和 Git 能否被正确识别"

echo ""
echo "4. 额外建议:"
echo "   - 提供详细的安装文档，指导用户正确配置环境"
echo "   - 添加更友好的错误提示信息"
echo "   - 考虑提供一键修复环境变量的功能"