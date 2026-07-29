#!/usr/bin/env bash
# pi-penecho 电脑端一键安装(macOS):从裸机到可用
#   Node.js → 项目依赖 → PenEcho → 配置模板 → Syncthing 同步端 → launchd 常驻服务
# 幂等,每步已就绪则跳过。装完:控制台 http://localhost:9191(填 API key 即可用)
set -euo pipefail
cd "$(dirname "$0")/.."

NODE_VER="v24.18.0"   # 与开发实测一致;pi-ai 要求 ≥22.19
NODE_PREFIX="$HOME/.local/node"

echo "┌──────────────────────────────────────┐"
echo "│   pi-penecho 电脑端一键安装          │"
echo "└──────────────────────────────────────┘"

# ---------- 1. Node.js ----------
echo "==> [1/6] Node.js"
NODE_BIN=""
if command -v node >/dev/null 2>&1; then
  V=$(node -v)
  MAJOR=$(echo "$V" | sed 's/v\([0-9]*\).*/\1/')
  if [ "$MAJOR" -ge 22 ]; then NODE_BIN=$(command -v node); echo "   已有 $V,跳过"; fi
fi
if [ -z "$NODE_BIN" ] && [ -x "$NODE_PREFIX/bin/node" ]; then
  V=$("$NODE_PREFIX/bin/node" -v)
  MAJOR=$(echo "$V" | sed 's/v\([0-9]*\).*/\1/')
  if [ "$MAJOR" -ge 22 ]; then NODE_BIN="$NODE_PREFIX/bin/node"; echo "   已有 $V($NODE_PREFIX),跳过"; fi
fi
if [ -z "$NODE_BIN" ]; then
  ARCH=$(uname -m); [ "$ARCH" = "arm64" ] && PKG="darwin-arm64" || PKG="darwin-x64"
  echo "   安装 Node $NODE_VER ($PKG) → $NODE_PREFIX"
  TMP=$(mktemp -d)
  curl -fL --retry 3 -s -o "$TMP/node.tar.gz" "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-$PKG.tar.gz"
  mkdir -p "$NODE_PREFIX"
  tar xzf "$TMP/node.tar.gz" -C "$NODE_PREFIX" --strip-components=1
  rm -rf "$TMP"
  NODE_BIN="$NODE_PREFIX/bin/node"
  # 终端可用性(launchd 用绝对路径不依赖 PATH,这是给用户手动操作用的)
  grep -q '.local/node/bin' "$HOME/.zshrc" 2>/dev/null || \
    echo 'export PATH="$HOME/.local/node/bin:$PATH"' >> "$HOME/.zshrc"
fi
export PATH="$(dirname "$NODE_BIN"):$PATH"
echo "   node: $(node -v) @ $NODE_BIN"

# ---------- 2. 项目依赖 ----------
echo "==> [2/6] 项目依赖(npm ci)"
npm ci --silent

# ---------- 3. PenEcho ----------
echo "==> [3/6] PenEcho 白板服务"
if command -v penecho >/dev/null 2>&1; then
  echo "   已安装: $(penecho --version 2>/dev/null || echo 已存在),跳过"
else
  npm i -g penecho --silent
  echo "   已安装: $(penecho --version)"
fi

# ---------- 4. 配置模板 ----------
echo "==> [4/6] 配置(已存在则保留)"
mkdir -p "$HOME/.penecho"
if [ ! -f "$HOME/.penecho/config.env" ]; then
  cat > "$HOME/.penecho/config.env" <<'EOF'
AI_PROVIDER=api
AI_API_FORMAT=anthropic
AI_API_URL=http://localhost:9191
AI_API_KEY=managed-by-bridge
AI_API_MODEL=k3
AI_EFFORT=medium
AI_TIMEOUT_SECONDS=300
PENECHO_AI_IMAGE_FORMAT=png
EOF
  echo "   已生成 ~/.penecho/config.env(指向本桥)"
else
  echo "   ~/.penecho/config.env 已存在,跳过"
fi
# ~/.pi-penecho/config.json 由桥首次启动自动生成(默认 kimi 官方端点,key 留空待控制台填)

# ---------- 5/6. 同步端 + 常驻 ----------
echo "==> [5/6] Syncthing 同步端"
bash scripts/install-syncthing-mac.sh

echo "==> [6/6] 常驻服务(launchd)"
bash scripts/install-autostart-mac.sh

cat <<'DONE'

╔══════════════════════════════════════════╗
║  ✅ 电脑端安装完成,全部常驻:              ║
║  · 控制台+桥    http://localhost:9191    ║
║  · 白板        http://localhost:3888     ║
║  · 安装门户    http://<本机IP>:9288      ║
║  · 同步端      http://127.0.0.1:8384     ║
╠══════════════════════════════════════════╣
║  下一步:                                  ║
║  1. 控制台填 API key(配置页)→ 保存        ║
║  2. 平板安装:                            ║
║     https://gulagala001.github.io/       ║
║     pi-penecho/                          ║
║     (或平板直连 http://<本机IP>:9288)     ║
╚══════════════════════════════════════════╝
DONE
