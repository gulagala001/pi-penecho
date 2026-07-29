#!/usr/bin/env bash
# 构建 Android/Termux 离线套件:桥(esbuild 单文件)+ penecho(npm pack 纯 JS)+ 启停脚本
# 产物:dist/pi-penecho-termux-arm64.tar.gz,平板端解压即用,无需 npm install
set -euo pipefail
cd "$(dirname "$0")/.."

PENECHO_VERSION="${PENECHO_VERSION:-0.7.1}"
OUT=dist/termux
STAGE="$OUT/stage/penecho-mobile"
TARBALL="dist/pi-penecho-termux-arm64.tar.gz"

echo "==> 清理并准备目录"
rm -rf "$OUT" "$TARBALL"
mkdir -p "$STAGE/bridge" "$STAGE/logs"

echo "==> 打包桥(esbuild 单文件,剔除不用的 provider 重依赖)"
# 保留 @anthropic-ai/sdk(kimi-coding 走 anthropic-messages 协议,静态引用);
# 其余 provider(aws/google/mistral/openai)均为 pi-ai 动态 import,external 后运行时不会触达
# --main-fields=module,main:优先包内 ESM 版(避开 CJS require 问题)
# banner:残留的 CJS 依赖(如 yaml)经 createRequire 兜底
npx esbuild src/server.mjs --bundle --platform=node --format=esm --target=node20 \
  --main-fields=module,main \
  '--banner:js=import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' \
  --outfile="$STAGE/bridge/server.mjs" \
  '--external:@aws-sdk/*' '--external:@aws-crypto/*' '--external:@smithy/*' \
  '--external:@google/*' --external:google-auth-library --external:gaxios --external:gcp-metadata \
  '--external:@mistralai/*' --external:openai --external:sharp

echo "==> 复制运行时资源(布局与 src/ 同构:bridge/server.mjs → ../personas ../public)"
cp -R personas "$STAGE/personas"
cp -R public "$STAGE/public"

echo "==> 取 penecho@$PENECHO_VERSION(npm pack 纯 JS,无 node_modules,server 链零外部依赖)"
PACK_DIR=$(mktemp -d)
( cd "$PACK_DIR" && npm pack "penecho@$PENECHO_VERSION" --silent )
tar xzf "$PACK_DIR"/penecho-*.tgz -C "$PACK_DIR"
mv "$PACK_DIR/package" "$STAGE/penecho"
rm -rf "$PACK_DIR"

echo "==> 写启停脚本"
cat > "$STAGE/start.sh" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# PenEcho 移动套件启动(幂等:已在运行则直接报 OK)
cd "$HOME/penecho-mobile" || { echo "未安装:~/penecho-mobile 不存在"; exit 1; }
mkdir -p logs

BRIDGE_PORT="${PI_PENECHO_PORT:-9191}"
BOARD_PORT="${PENECHO_PORT:-3888}"
health() { curl -s -m 2 "http://127.0.0.1:$BRIDGE_PORT/health" >/dev/null 2>&1 && curl -s -m 2 -o /dev/null "http://127.0.0.1:$BOARD_PORT/"; }
if health; then echo "[penecho] 服务已在运行"; exit 0; fi

termux-wake-lock 2>/dev/null

# 桥
export PI_PENECHO_PORT="$BRIDGE_PORT"
# PenEcho(env 注入配置,不碰 ~/.penecho/config.env;HOST 锁回环,白板不对局域网暴露)
export HOST="${PENECHO_HOST:-127.0.0.1}" PORT="$BOARD_PORT"
export AI_PROVIDER=api AI_API_FORMAT=anthropic
export AI_API_URL="http://localhost:$BRIDGE_PORT"
export AI_API_KEY=managed-by-bridge
export AI_API_MODEL=k3 AI_EFFORT=medium
export AI_TIMEOUT_SECONDS=300
export PENECHO_AI_IMAGE_FORMAT=png

pkill -f "penecho-mobile/bridge/server.mjs" 2>/dev/null
pkill -f "penecho-mobile/penecho/server.js" 2>/dev/null
sleep 1
# 绝对路径启动:保证上面 pkill -f 的模式能匹配到旧进程
nohup node "$HOME/penecho-mobile/bridge/server.mjs" >> logs/bridge.log 2>&1 &
nohup node "$HOME/penecho-mobile/penecho/server.js" >> logs/penecho.log 2>&1 &

for _ in $(seq 1 40); do health && break; sleep 0.5; done
if health; then
  echo "[penecho] 启动完成 — 白板 http://127.0.0.1:$BOARD_PORT 控制台 http://127.0.0.1:$BRIDGE_PORT"
else
  echo "[penecho] 启动似乎失败,最近日志:"
  tail -n 5 logs/bridge.log logs/penecho.log 2>/dev/null
  exit 1
fi
EOF

cat > "$STAGE/stop.sh" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
pkill -f "penecho-mobile/bridge/server.mjs" 2>/dev/null
pkill -f "penecho-mobile/penecho/server.js" 2>/dev/null
termux-wake-unlock 2>/dev/null
echo "[penecho] 已停止"
EOF

# Termux:Boot 开机自启入口(由 setup.sh 拷到 ~/.termux/boot/)
cat > "$STAGE/boot.sh" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
sleep 5
"$HOME/penecho-mobile/start.sh"
EOF

chmod +x "$STAGE"/*.sh

echo "==> 打包"
mkdir -p dist
tar czf "$TARBALL" -C "$OUT/stage" penecho-mobile

echo ""
echo "完成: $TARBALL ($(du -h "$TARBALL" | cut -f1))"
echo "内容:"; tar tzf "$TARBALL" | head -20; echo "  ..."
