#!/bin/bash
# OpenClaw 一键安装脚本 for Git Bash / WSL
# 用法: bash install-openclaw.sh [--mirror] [--wsl]

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 默认配置
USE_MIRROR=false
USE_WSL=false
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
AGENT_ID="main"

# 解析参数
while [[ $# -gt 0 ]]; do
  case $1 in
    --mirror)
      USE_MIRROR=true
      shift
      ;;
    --wsl)
      USE_WSL=true
      shift
      ;;
    --help)
      echo "用法: bash install-openclaw.sh [选项]"
      echo "选项:"
      echo "  --mirror    使用国内 npm 镜像 (npmmirror.com)"
      echo "  --wsl       在 WSL 环境中安装"
      echo "  --help      显示帮助信息"
      exit 0
      ;;
    *)
      echo "未知选项: $1"
      echo "使用 --help 查看帮助"
      exit 1
      ;;
  esac
done

# 打印带颜色的消息
print_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
  echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# 检查依赖
check_dependencies() {
  print_info "检查依赖..."
  
  # 检查 Node.js
  if ! command -v node &> /dev/null; then
    print_error "未找到 Node.js，请先安装 Node.js 22+"
    exit 1
  fi
  
  NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$NODE_VERSION" -lt 22 ]; then
    print_error "Node.js 版本过低，需要 22+，当前版本: $(node --version)"
    exit 1
  fi
  print_success "Node.js 版本: $(node --version)"
  
  # 检查 npm
  if ! command -v npm &> /dev/null; then
    print_error "未找到 npm"
    exit 1
  fi
  print_success "npm 版本: $(npm --version)"
  
  # 检查 git
  if ! command -v git &> /dev/null; then
    print_error "未找到 git"
    exit 1
  fi
  print_success "git 已安装"
}

# 配置 npm
setup_npm() {
  print_info "配置 npm..."
  
  # 创建 npm 全局目录
  mkdir -p "$HOME/.npm-global"
  npm config set prefix "$HOME/.npm-global"
  export PATH="$HOME/.npm-global/bin:$PATH"
  
  # 设置镜像
  if [ "$USE_MIRROR" = true ]; then
    print_info "使用国内镜像: https://registry.npmmirror.com"
    npm config set registry https://registry.npmmirror.com
  else
    npm config set registry https://registry.npmjs.org
  fi
  
  # 配置 git 使用 HTTPS
  git config --global url."https://github.com/".insteadOf "git@github.com:"
  git config --global url."https://".insteadOf "git://"
}

# 安装 OpenClaw
install_openclaw() {
  print_info "开始安装 OpenClaw..."
  
  if [ "$USE_WSL" = true ]; then
    print_info "在 WSL 环境中安装..."
  fi
  
  npm install -g openclaw@latest
  
  if ! command -v openclaw &> /dev/null; then
    print_error "OpenClaw 安装失败，命令未找到"
    exit 1
  fi
  
  print_success "OpenClaw 安装成功: $(openclaw --version)"
}

# 创建必要的目录结构
create_directories() {
  print_info "创建目录结构..."
  
  # 主目录
  mkdir -p "$OPENCLAW_HOME"
  mkdir -p "$OPENCLAW_HOME/logs"
  mkdir -p "$OPENCLAW_HOME/config-backups"
  
  # Agent 目录
  mkdir -p "$OPENCLAW_HOME/agents/$AGENT_ID/agent"
  mkdir -p "$OPENCLAW_HOME/agents/$AGENT_ID/workspace"
  
  print_success "目录结构创建完成"
}

# 生成 UUID
generate_uuid() {
  if command -v uuidgen &> /dev/null; then
    uuidgen
  else
    # 使用 /dev/urandom 生成 UUID
    od -x /dev/urandom | head -1 | awk '{OFS="-"; print $2$3,$4,$5,$6,$7$8$9}'
  fi
}

# 创建默认配置文件
create_default_configs() {
  print_info "创建默认配置文件..."
  
  local default_token=$(generate_uuid)
  
  # 1. 创建 openclaw.json
  cat > "$OPENCLAW_HOME/openclaw.json" << EOF
{
  "version": 1,
  "gateway": {
    "mode": "local",
    "port": 18789,
    "bind": "127.0.0.1",
    "authToken": "$default_token"
  },
  "models": {
    "providers": {},
    "default": null
  },
  "agents": {
    "list": [
      {
        "id": "$AGENT_ID"
      }
    ]
  },
  "env": {
    "vars": {}
  },
  "commands": {
    "native": "auto",
    "nativeSkills": "auto",
    "restart": true,
    "ownerDisplay": "raw"
  },
  "meta": {
    "createdBy": "install-openclaw.sh",
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  }
}
EOF
  print_success "创建: $OPENCLAW_HOME/openclaw.json"
  
  # 2. 创建空的 .env 文件
  touch "$OPENCLAW_HOME/.env"
  print_success "创建: $OPENCLAW_HOME/.env"
  
  # 3. 创建 auth-profiles.json
  cat > "$OPENCLAW_HOME/agents/$AGENT_ID/agent/auth-profiles.json" << EOF
{
  "version": 1,
  "profiles": {}
}
EOF
  print_success "创建: $OPENCLAW_HOME/agents/$AGENT_ID/agent/auth-profiles.json"
  
  # 4. 创建 models.json
  cat > "$OPENCLAW_HOME/agents/$AGENT_ID/agent/models.json" << EOF
{
  "providers": {}
}
EOF
  print_success "创建: $OPENCLAW_HOME/agents/$AGENT_ID/agent/models.json"
  
  # 5. 创建 agent 配置文件
  cat > "$OPENCLAW_HOME/agents/$AGENT_ID/agent/agent.json" << EOF
{
  "id": "$AGENT_ID",
  "name": "Main Agent",
  "version": 1,
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  print_success "创建: $OPENCLAW_HOME/agents/$AGENT_ID/agent/agent.json"
}

# 验证安装
verify_installation() {
  print_info "验证安装..."
  
  local all_good=true
  
  # 检查命令
  if command -v openclaw &> /dev/null; then
    print_success "OpenClaw 命令可用: $(openclaw --version)"
  else
    print_error "OpenClaw 命令不可用"
    all_good=false
  fi
  
  # 检查配置文件
  local files=(
    "$OPENCLAW_HOME/openclaw.json"
    "$OPENCLAW_HOME/.env"
    "$OPENCLAW_HOME/agents/$AGENT_ID/agent/auth-profiles.json"
    "$OPENCLAW_HOME/agents/$AGENT_ID/agent/models.json"
    "$OPENCLAW_HOME/agents/$AGENT_ID/agent/agent.json"
  )
  
  for file in "${files[@]}"; do
    if [ -f "$file" ]; then
      print_success "配置文件存在: $file"
    else
      print_error "配置文件缺失: $file"
      all_good=false
    fi
  done
  
  if [ "$all_good" = true ]; then
    print_success "安装验证通过！"
    return 0
  else
    print_error "安装验证失败，请检查上述错误"
    return 1
  fi
}

# 显示安装后信息
show_post_install_info() {
  echo ""
  echo "========================================"
  print_success "OpenClaw 安装完成！"
  echo "========================================"
  echo ""
  echo "安装信息:"
  echo "  安装目录: $OPENCLAW_HOME"
  echo "  Agent ID: $AGENT_ID"
  echo "  版本: $(openclaw --version 2>/dev/null || echo '未知')"
  echo ""
  echo "常用命令:"
  echo "  openclaw --version    # 查看版本"
  echo "  openclaw doctor       # 诊断检查"
  echo "  openclaw status       # 查看状态"
  echo "  openclaw dashboard    # 打开管理面板"
  echo ""
  echo "配置文件位置:"
  echo "  主配置: $OPENCLAW_HOME/openclaw.json"
  echo "  环境变量: $OPENCLAW_HOME/.env"
  echo "  认证配置: $OPENCLAW_HOME/agents/$AGENT_ID/agent/auth-profiles.json"
  echo ""
  echo "下一步:"
  echo "  1. 配置 API 密钥: 编辑 $OPENCLAW_HOME/.env 添加 KIMI_API_KEY 等"
  echo "  2. 启动 Gateway: openclaw gateway start"
  echo "  3. 或使用 OpenClaw 安装管理器进行图形化配置"
  echo ""
}

# 主函数
main() {
  echo "========================================"
  echo "  OpenClaw 一键安装脚本"
  echo "========================================"
  echo ""
  
  check_dependencies
  setup_npm
  install_openclaw
  create_directories
  create_default_configs
  verify_installation
  show_post_install_info
}

# 运行主函数
main "$@"
