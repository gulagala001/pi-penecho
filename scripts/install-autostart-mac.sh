#!/usr/bin/env bash
# 电脑端开机自启:桥(9191+9288 控制台/安装门户)+ PenEcho 白板(3888) 注册为 launchd 常驻服务
# 装一次,以后 Mac 重启全自动;崩了自动拉起。幂等。
set -euo pipefail

NODE="/Users/mac/.local/node/bin/node"
BRIDGE_DIR="/Users/mac/Projects/pen e cho"
PENECHO_CLI="/Users/mac/.local/node/bin/penecho"
AGENTS="$HOME/Library/LaunchAgents"

[ -x "$NODE" ] || { echo "找不到 node: $NODE"; exit 1; }
[ -f "$PENECHO_CLI" ] || { echo "找不到 penecho: $PENECHO_CLI"; exit 1; }

echo "==> 生成 LaunchAgent 配置"
cat > "$AGENTS/com.pi-penecho.bridge.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.pi-penecho.bridge</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$BRIDGE_DIR/src/server.mjs</string></array>
  <key>WorkingDirectory</key><string>$BRIDGE_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$BRIDGE_DIR/bridge.log</string>
  <key>StandardErrorPath</key><string>$BRIDGE_DIR/bridge.log</string>
</dict></plist>
EOF

cat > "$AGENTS/com.pi-penecho.board.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.pi-penecho.board</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$PENECHO_CLI</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.penecho/logs/penecho.log</string>
  <key>StandardErrorPath</key><string>$HOME/.penecho/logs/penecho.log</string>
</dict></plist>
EOF

echo "==> 停掉手动启动的旧进程(避免端口冲突)"
kill $(lsof -tnP -iTCP:9191 -sTCP:LISTEN) 2>/dev/null || true
kill $(lsof -tnP -iTCP:3888 -sTCP:LISTEN) 2>/dev/null || true
sleep 1

echo "==> 注册并启动服务"
mkdir -p "$HOME/.penecho/logs"
launchctl unload "$AGENTS/com.pi-penecho.bridge.plist" 2>/dev/null || true
launchctl unload "$AGENTS/com.pi-penecho.board.plist" 2>/dev/null || true
launchctl load "$AGENTS/com.pi-penecho.bridge.plist"
launchctl load "$AGENTS/com.pi-penecho.board.plist"

echo "==> 等待就绪"
for _ in $(seq 1 30); do
  curl -s -m 1 http://127.0.0.1:9191/health >/dev/null 2>&1 && curl -s -m 1 -o /dev/null http://127.0.0.1:3888/ && break
  sleep 1
done

B="FAIL"; P="FAIL"
curl -s -m 2 http://127.0.0.1:9191/health >/dev/null 2>&1 && B="OK"
curl -s -m 2 -o /dev/null http://127.0.0.1:3888/ && P="OK"
echo "   桥(9191): $B    白板(3888): $P"
[ "$B" = OK ] && [ "$P" = OK ] || { echo "有服务没起来,看日志: tail $BRIDGE_DIR/bridge.log ~/.penecho/logs/penecho.log"; exit 1; }

cat <<'DONE'

✅ 电脑端已注册为常驻服务:
   - 桥(控制台 http://localhost:9191 + 安装门户 9288)
   - PenEcho 白板(http://localhost:3888)
   - Syncthing 同步端(此前已注册)
以后 Mac 重启全部自动启动,无需任何操作。

手动管理:
  停止  launchctl unload ~/Library/LaunchAgents/com.pi-penecho.{bridge,board}.plist
  启动  launchctl load   ~/Library/LaunchAgents/com.pi-penecho.{bridge,board}.plist
DONE
