# OpenClaw 安装管理器

基于 Electron 的 OpenClaw 一键安装与管理桌面应用，提供全中文图形化界面，支持 Windows 10/11。

## 功能概览

### 安装向导（5 步完成）

1. **欢迎页** - 功能介绍
2. **环境检测** - WSL 状态检测、运行模式选择（WSL / Windows 原生）、Node.js 与 npm 依赖检查及自动安装
3. **安装 OpenClaw** - 支持国内 npm 镜像源切换，通过 `npm install -g openclaw@latest` 全局安装并自动安装 Daemon 服务
4. **配置** - 图形化配置 AI 服务商、API 密钥、网关参数、默认模型等（替代 CLI `openclaw onboard`）
5. **完成** - 显示安装结果，进入管理面板

### 管理面板（8 个功能标签页）

| 标签页 | 功能 |
|--------|------|
| 状态监控 | OpenClaw 版本、服务状态、诊断检查、一键更新 |
| API 密钥 | 管理多个 AI 服务商的 API Key 和 Base URL |
| 环境变量 | 编辑 OpenClaw 环境变量 |
| 配置编辑 | 可视化 / JSON 双模式编辑 `openclaw.json` |
| 服务管理 | 启动、停止、重启 OpenClaw Daemon 服务 |
| 日志查看 | 实时查看和导出日志 |
| MCP 服务器 | 管理 MCP (Model Context Protocol) 服务器配置 |
| 配置档案 | 创建、切换、导入/导出配置档案 |

### 其他特性

- **WSL 支持** - 自动检测 WSL 安装状态，支持一键安装 WSL（UAC 提权），可选择 WSL 或 Windows 原生运行模式
- **双执行模式** - 原生模式直接在 Windows 运行，WSL 模式自动将命令包装为 `wsl -- bash -lc ...`
- **国内镜像** - 安装步骤支持一键切换 npmmirror.com 镜像源
- **安全架构** - 使用 Electron contextIsolation + preload 的 IPC 通信模式，禁用 nodeIntegration
- **单实例锁** - 防止重复启动

## 项目结构

```
src/
├── main/                          # 主进程
│   ├── main.js                    # 应用入口，窗口创建
│   ├── preload.js                 # preload 桥接，暴露安全 API
│   ├── ipc-handlers.js            # IPC 通信处理器注册
│   ├── utils/
│   │   ├── shell-executor.js      # 命令执行器（支持 native/WSL 双模式）
│   │   ├── paths.js               # 配置文件路径管理
│   │   └── logger.js              # 日志工具
│   └── services/
│       ├── dependency-checker.js   # 依赖检测（Node.js、npm、包管理器）
│       ├── wsl-checker.js          # WSL 检测与安装
│       ├── openclaw-installer.js   # OpenClaw 安装与更新
│       ├── onboard-config-writer.js# 配置文件生成（替代 CLI onboard）
│       ├── config-manager.js       # openclaw.json 读写
│       ├── env-manager.js          # .env 文件管理
│       ├── service-controller.js   # Daemon 服务控制
│       ├── log-manager.js          # 日志读取与监控
│       ├── status-monitor.js       # 状态监控与诊断
│       ├── profile-manager.js      # 配置档案管理
│       └── mcp-manager.js          # MCP 服务器管理
├── renderer/                      # 渲染进程
│   ├── index.html                 # 主页面
│   ├── styles/
│   │   ├── main.css               # 全局变量与基础样式
│   │   ├── components.css         # 通用组件样式
│   │   ├── wizard.css             # 安装向导样式
│   │   └── dashboard.css          # 管理面板样式
│   └── js/
│       ├── app.js                 # 应用初始化
│       ├── utils/
│       │   ├── i18n.js            # 中文文本常量
│       │   ├── dom-helpers.js     # DOM 工具函数
│       │   └── toast.js           # 消息提示组件
│       ├── wizard/
│       │   ├── wizard-controller.js # 向导步骤控制器
│       │   ├── step-welcome.js     # 步骤 1：欢迎
│       │   ├── step-check.js       # 步骤 2：环境检测
│       │   ├── step-install.js     # 步骤 3：安装
│       │   ├── step-configure.js   # 步骤 4：配置
│       │   └── step-complete.js    # 步骤 5：完成
│       └── dashboard/
│           ├── dashboard-controller.js # 面板标签页控制器
│           ├── tab-status.js       # 状态监控
│           ├── tab-apikeys.js      # API 密钥管理
│           ├── tab-env.js          # 环境变量
│           ├── tab-config.js       # 配置编辑器
│           ├── tab-service.js      # 服务管理
│           ├── tab-logs.js         # 日志查看
│           ├── tab-mcp.js          # MCP 服务器
│           └── tab-profiles.js     # 配置档案
```

## 开发

### 环境要求

- Node.js >= 18
- npm

### 安装依赖

```bash
npm install
```

### 开发运行

```bash
npm run dev
```

### 生产运行

```bash
npm start
```

### 打包构建

项目使用 [electron-builder](https://www.electron.build/) 打包，支持本地构建和 Docker 构建两种方式，产物输出到 `dist/` 目录。

#### 快速命令参考

**本地构建**

```bash
npm run build           # Windows 安装包
npm run build:portable  # Windows 便携版
npm run build:mac       # macOS 安装包
npm run build:all       # 全平台 (Windows + macOS)
```

**Docker 构建（推荐，无需配置本地环境）**

```bash
docker compose build                  # 构建镜像
docker compose run --rm build-app     # Windows 安装包
docker compose run --rm build-mac     # macOS 安装包
docker compose run --rm build-all     # 全平台构建
docker compose run --rm build-dev     # 开发模式（挂载源码）
docker compose run --rm shell         # 进入容器调试
```

---

#### 本地构建详细说明

配置文件为 `electron-builder.yml`，输出格式为 NSIS 安装程序。

**1. 确认前置条件**

- 已执行 `npm install` 安装所有依赖
- `build/icon.png` 图标文件存在（建议 256x256 以上的 PNG）

**2. 执行打包命令**

```bash
npm run build
```

等同于执行 `electron-builder --win`，打包过程需要几分钟（首次构建会下载 Electron 预编译包和 NSIS 工具，耗时较长）。

**3. 获取输出产物**

打包完成后，产物位于 `dist/` 目录：

```
dist/
├── OpenClaw安装管理器 Setup 1.0.0.exe    # NSIS 安装程序（交给用户的文件）
├── win-unpacked/                          # 免安装版（解压即用）
│   ├── OpenClaw安装管理器.exe             # 主程序
│   └── ...
└── builder-effective-config.yaml          # 实际生效的构建配置
```

- `OpenClaw安装管理器 Setup 1.0.0.exe` - 标准 Windows 安装程序，双击运行即可安装，支持自定义安装路径，会创建桌面快捷方式和开始菜单快捷方式
- `win-unpacked/` - 绿色免安装版目录，可直接运行其中的 exe 或打成 zip 分发

**4. 打包配置说明**

`electron-builder.yml` 中的关键配置：

```yaml
appId: com.openclaw.installer-manager   # 应用唯一标识
productName: OpenClaw安装管理器           # 安装程序中显示的应用名
directories:
  output: dist                          # 输出目录
files:                                  # 打包包含的文件
  - src/**/*
  - package.json
  - node_modules/**/*
win:
  target:
    - target: nsis                      # 使用 NSIS 打包格式
      arch:
        - x64                           # 仅 64 位
  icon: build/icon.png                  # 应用图标
nsis:
  oneClick: false                       # 非一键安装，显示安装向导
  allowToChangeInstallationDirectory: true  # 允许用户选择安装目录
  language: 2052                        # 中文界面（LCID 2052 = 简体中文）
  createDesktopShortcut: true           # 创建桌面快捷方式
  createStartMenuShortcut: true         # 创建开始菜单快捷方式
  shortcutName: OpenClaw安装管理器       # 快捷方式名称
```

**5. 常见问题**

| 问题 | 解决方法 |
|------|----------|
| 首次打包很慢 | electron-builder 需要下载 Electron 二进制包和 NSIS 工具到缓存目录，后续构建会复用缓存 |
| 下载超时失败 | 设置国内镜像：`npx cross-env ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run build` |
| 缺少 icon.png | 确保 `build/icon.png` 存在，建议尺寸 256x256 或更大 |
| 杀毒软件误报 | Electron 打包的 exe 可能触发误报，添加白名单或使用代码签名证书 |
| 想生成便携版 zip | 在 `electron-builder.yml` 的 `win.target` 中添加 `- target: zip` |

#### Docker 构建详细说明

Docker 构建无需在本地安装 Node.js、Wine、NSIS 等工具，特别适合 CI/CD 或跨平台构建场景。

**构建镜像**

```bash
docker compose build
```

**构建命令**

| 命令 | 说明 |
|------|------|
| `docker compose run --rm build-app` | 构建 Windows 安装包 (.exe) |
| `docker compose run --rm build-mac` | 构建 macOS 安装包 (.dmg) |
| `docker compose run --rm build-all` | 同时构建 Windows 和 macOS |
| `docker compose run --rm build-dev` | 开发模式，挂载本地源码 |
| `docker compose run --rm shell` | 进入容器交互式调试 |

**多架构镜像构建**

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t openclaw-builder .
```

**Docker 构建说明**

- 镜像基于 `node:22-bookworm`，内置 Wine + NSIS 交叉编译工具
- 已配置国内 npmmirror 镜像源，避免 Electron 下载超时
- 支持 amd64 和 arm64 架构
- macOS 构建在 Docker/Linux 中生成的是未签名 .dmg，用户首次打开需右键 → 打开
- 构建产物自动输出到本地 `dist/` 目录

## 技术栈

- **Electron 34** - 桌面应用框架
- **原生 HTML/CSS/JS** - 无前端框架依赖，轻量快速
- **electron-store** - 持久化存储
- **chokidar** - 文件监控（日志实时查看）
- **electron-builder** - 打包构建

## 常见问题

### 1. PATH 环境变量配置

**问题**: 安装后命令行提示 `openclaw 不是内部或外部命令`

**解决**:
1. 在应用的 **"环境变量"** 标签页点击 "检查 PATH"
2. 点击 "添加到 PATH" 自动添加（推荐）
3. **重启终端**（关闭并重新打开 CMD/PowerShell）

详细说明请查看：[PATH_TROUBLESHOOTING.md](PATH_TROUBLESHOOTING.md)

### 2. 权限问题

**问题**: 添加 PATH 时提示 "需要管理员权限"

**解决**:
- 应用会自动尝试添加到用户 PATH（不需要管理员权限）
- 用户 PATH 仅对当前用户生效，更安全
- 如需系统 PATH，请以管理员身份运行应用

### 3. 资源文件缺失

**问题**: 提示找不到 Node.js 或 Git 安装包

**解决**:
- Node.js 安装包应位于 `resources/nodejs/` 目录
- Git 安装包应位于 `resources/gitbash/` 目录
- 如果缺失，可以从官网下载后放入对应目录

## 许可证

MIT
