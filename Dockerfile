# ==============================================================================
# OpenClaw 安装管理器 - 多架构 Docker 构建环境
# 用于在 Linux 上交叉编译 Windows 安装包 (NSIS)
# 支持架构: amd64, arm64
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: base - 系统级依赖 (Wine, NSIS, build tools)
# ------------------------------------------------------------------------------
FROM node:22-bookworm AS base

# 设置环境变量
ENV DEBIAN_FRONTEND=noninteractive \
    WINEDEBUG=-all \
    WINEPREFIX=/root/.wine \
    # npm/Electron 国内镜像配置
    npm_config_registry=https://registry.npmmirror.com \
    ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
    ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
    # 避免 npm 交互
    npm_config_yes=true \
    # macOS 构建：使用系统 genisoimage 创建 .dmg
    USE_SYSTEM_GENISOIMAGE=true

# 添加 32 位架构支持 (仅 amd64)，安装 Wine 和 NSIS
RUN set -ex && \
    # 检测架构
    ARCH=$(dpkg --print-architecture) && \
    echo "Building for architecture: $ARCH" && \
    \
    # 更新包索引
    apt-get update && \
    \
    # 安装基础构建工具
    apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        wget \
        gnupg \
        python3 \
        make \
        g++ \
        gcc \
        nsis \
        zip \
        unzip \
        xz-utils \
        genisoimage \
    && \
    \
    # 安装 Wine (架构相关)
    if [ "$ARCH" = "amd64" ]; then \
        # amd64: 添加 32 位架构支持
        dpkg --add-architecture i386 && \
        apt-get update && \
        apt-get install -y --no-install-recommends \
            wine64 \
            wine32 \
        ; \
    elif [ "$ARCH" = "arm64" ]; then \
        # arm64: 只安装 wine64
        apt-get install -y --no-install-recommends \
            wine64 \
        ; \
    fi && \
    \
    # 清理 apt 缓存
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# 设置工作目录
WORKDIR /app

# ------------------------------------------------------------------------------
# Stage 2: deps - 安装 npm 依赖
# ------------------------------------------------------------------------------
FROM base AS deps

# 复制依赖文件
COPY package.json package-lock.json ./

# 安装依赖 (使用国内镜像)
RUN npm ci --prefer-offline && \
    # 清理 npm 缓存
    npm cache clean --force

# ------------------------------------------------------------------------------
# Stage 3: builder - 复制源码，准备构建
# ------------------------------------------------------------------------------
FROM deps AS builder

# 复制构建配置和脚本
COPY electron-builder.yml ./
COPY scripts/ ./scripts/

# 处理 afterPack 脚本兼容性：
# 将 electron-builder.yml 中的 .bat 替换为 .sh
RUN sed -i 's/filter-locales\.bat/filter-locales.sh/g' electron-builder.yml && \
    # 确保 .sh 脚本可执行
    chmod +x scripts/filter-locales.sh 2>/dev/null || true

# 复制源码和资源
COPY build/ ./build/
COPY src/ ./src/
COPY resources/ ./resources/

# 默认命令：执行构建
CMD ["npm", "run", "build"]
