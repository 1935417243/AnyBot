#!/bin/sh
set -eu

# ── Helpers ──────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { printf "${CYAN}▸${NC} %s\n" "$*"; }
ok()    { printf "${GREEN}✔${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}⚠${NC} %s\n" "$*"; }
fail()  { printf "${RED}✖${NC} %s\n" "$*"; exit 1; }

prompt_input() {
  printf "${BOLD}%s${NC}" "$1" >&2
  read -r REPLY
  echo "$REPLY"
}

PROJECT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"

# ── Banner ───────────────────────────────────────────────────────────

echo ""
printf "${BOLD}╔══════════════════════════════════════════╗${NC}\n"
printf "${BOLD}║           AnyBot  Setup Wizard           ║${NC}\n"
printf "${BOLD}╚══════════════════════════════════════════╝${NC}\n"
echo ""

# ── Detect OS ────────────────────────────────────────────────────────

OS="$(uname -s)"
case "$OS" in
  Linux*)  OS_NAME="Linux"  ;;
  Darwin*) OS_NAME="macOS"  ;;
  *)       OS_NAME="$OS"    ;;
esac
ok "检测到操作系统: $OS_NAME"

# ── Check required tools ─────────────────────────────────────────────

info "正在检查依赖..."
MISSING=""

check_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    VER=$("$1" --version 2>/dev/null | head -1 || echo "已安装")
    ok "$1 — $VER"
  else
    warn "$1 未找到"
    MISSING="$MISSING $1"
  fi
}

check_cmd node
check_cmd npm
check_cmd codex

if [ -n "$MISSING" ]; then
  echo ""
  warn "以下工具缺失:$MISSING"
  echo ""

  case "$OS_NAME" in
    Linux)
      info "在 Ubuntu/Debian 上安装 Node.js:"
      echo "  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -"
      echo "  sudo apt-get install -y nodejs"
      echo ""
      info "在 CentOS/RHEL/Fedora 上安装 Node.js:"
      echo "  curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -"
      echo "  sudo yum install -y nodejs  # 或 dnf install -y nodejs"
      echo ""
      info "或使用 nvm (推荐):"
      echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"
      echo "  nvm install --lts"
      echo ""
      ;;
    macOS)
      info "使用 Homebrew 安装:"
      echo "  brew install node"
      echo ""
      ;;
  esac

  if echo "$MISSING" | grep -q "codex"; then
    info "安装 Codex CLI (默认 Provider):"
    echo "  npm install -g @openai/codex"
    echo ""
  fi

  printf "是否继续安装？缺失的工具需要后续手动安装 [y/N]: "
  read -r CONTINUE
  case "$CONTINUE" in
    [yY]*) ;;
    *) echo "已取消。"; exit 0 ;;
  esac
  echo ""
fi

# ── Configure workspace ──────────────────────────────────────────────

echo ""
printf "${BOLD}── 工作区配置 ──${NC}\n"
echo ""
info "工作区是 AI CLI 执行命令时的工作目录。"
info "Provider 会在这个目录下读写文件、执行 git 操作等。"
echo ""

DEFAULT_WORKDIR="$HOME"
WORKDIR=$(prompt_input "请输入工作目录 [$DEFAULT_WORKDIR]: ")
WORKDIR="${WORKDIR:-$DEFAULT_WORKDIR}"

# Expand ~ if user typed it
case "$WORKDIR" in
  "~"*)  WORKDIR="$HOME${WORKDIR#\~}" ;;
esac

if [ ! -d "$WORKDIR" ]; then
  warn "目录 $WORKDIR 不存在"
  printf "是否创建？ [y/N]: "
  read -r CREATE_DIR
  case "$CREATE_DIR" in
    [yY]*)
      mkdir -p "$WORKDIR"
      ok "已创建 $WORKDIR"
      ;;
    *)
      fail "工作目录不存在，已取消"
      ;;
  esac
fi
ok "工作目录: $WORKDIR"

# ── Copy default md files to workspace ────────────────────────────────

MD_SRC="$PROJECT_DIR/src/agent/md_files"
COPIED_FILES=""

for f in AGENTS.md MEMORY.md PROFILE.md BOOTSTRAP.md; do
  if [ -f "$WORKDIR/$f" ]; then
    info "$f 已存在于工作目录，跳过"
  else
    cp "$MD_SRC/$f" "$WORKDIR/$f"
    COPIED_FILES="$COPIED_FILES $f"
  fi
done

if [ -n "$COPIED_FILES" ]; then
  ok "已复制默认配置文件到工作目录:$COPIED_FILES"
fi

# ── Configure sandbox mode ───────────────────────────────────────────

echo ""
printf "${BOLD}── 安全模式 ──${NC}\n"
echo ""
info "Sandbox 模式控制 Provider 对文件系统的访问权限："
echo "  1) read-only          — 只读（最安全，默认）"
echo "  2) workspace-write    — 可写工作目录"
echo "  3) danger-full-access — 完全访问（危险）"
echo ""
SANDBOX_CHOICE=$(prompt_input "请选择 [1]: ")
case "$SANDBOX_CHOICE" in
  2) CODEX_SANDBOX="workspace-write" ;;
  3) CODEX_SANDBOX="danger-full-access" ;;
  *) CODEX_SANDBOX="read-only" ;;
esac
ok "安全模式: $CODEX_SANDBOX"

# ── Configure web port ───────────────────────────────────────────────

echo ""
WEB_PORT=$(prompt_input "Web UI 端口 [19981]: ")
WEB_PORT="${WEB_PORT:-19981}"
ok "Web UI 端口: $WEB_PORT"

# ── Write .env ───────────────────────────────────────────────────────

ENV_FILE="$PROJECT_DIR/.env"

if [ -f "$ENV_FILE" ]; then
  echo ""
  warn "检测到已有 .env 文件"
  printf "是否覆盖？ [y/N]: "
  read -r OVERWRITE
  case "$OVERWRITE" in
    [yY]*) ;;
    *)
      ok "保留现有 .env，跳过写入"
      SKIP_ENV=1
      ;;
  esac
fi

if [ "${SKIP_ENV:-0}" != "1" ]; then
  cat > "$ENV_FILE" <<EOF
# ── Provider ────────────────────────────────────────
PROVIDER=codex

# ── Codex CLI ───────────────────────────────────────
CODEX_BIN=codex
CODEX_MODEL=
CODEX_SANDBOX=$CODEX_SANDBOX
CODEX_SYSTEM_PROMPT=
CODEX_WORKDIR=$WORKDIR

# ── Web ─────────────────────────────────────────────
WEB_PORT=$WEB_PORT

# ── 日志 ────────────────────────────────────────────
LOG_LEVEL=info
LOG_INCLUDE_CONTENT=false
LOG_INCLUDE_PROMPT=false
EOF
  ok "已生成 $ENV_FILE"
fi

# ── Install dependencies ─────────────────────────────────────────────

echo ""
printf "${BOLD}── 安装依赖 ──${NC}\n"
echo ""

if [ -d "$PROJECT_DIR/node_modules" ]; then
  info "node_modules 已存在，跳过安装（如需重装请删除 node_modules 后重新运行）"
else
  info "正在安装 npm 依赖..."
  cd "$PROJECT_DIR"
  npm install
  ok "依赖安装完成"
fi

# ── Done ─────────────────────────────────────────────────────────────

echo ""
printf "${BOLD}╔══════════════════════════════════════════╗${NC}\n"
printf "${BOLD}║          ✔  配置完成！                   ║${NC}\n"
printf "${BOLD}╚══════════════════════════════════════════╝${NC}\n"
echo ""
info "启动方式："
echo ""
echo "  前台运行:  npm start"
echo "  后台运行:  npm run bot:start"
echo "  查看状态:  npm run bot:status"
echo "  停止运行:  npm run bot:stop"
echo ""
info "Web UI 地址: http://localhost:$WEB_PORT"
echo ""
info "频道配置（飞书等）可在 Web UI 的设置页面中管理，"
info "或直接编辑 .data/channels.json"
echo ""
