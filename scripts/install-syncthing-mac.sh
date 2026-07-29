#!/usr/bin/env bash
# Mac 端 Syncthing 一键安装:二进制 → launchd 开机自启 → 共享「考研new」文件夹(待与平板配对)
# 幂等,可重复运行
set -euo pipefail

DEST="$HOME/.local/bin"
SYNC_DIR="$HOME/Projects/考研new"
ST_CONFIG="$HOME/.config/syncthing"
PLIST="$HOME/Library/LaunchAgents/com.penecho.syncthing.plist"

echo "==> [1/5] 下载 Syncthing(macos arm64)"
mkdir -p "$DEST"
if [ -x "$DEST/syncthing" ] && "$DEST/syncthing" --version >/dev/null 2>&1; then
  echo "   已安装:$("$DEST/syncthing" --version | head -1)"
else
  URL=$(curl -s https://api.github.com/repos/syncthing/syncthing/releases/latest \
    | grep -o 'https://[^"]*macos-arm64-v[^"]*\.zip' | sed -n '1p') || true
  [ -n "${URL:-}" ] || { echo "找不到下载地址(GitHub API 可能限流,稍后重试)"; exit 1; }
  echo "   $URL"
  TMP=$(mktemp -d)
  curl -fL --retry 3 -s -o "$TMP/st.zip" "$URL"
  unzip -o -q "$TMP/st.zip" -d "$TMP"
  cp "$TMP"/syncthing-macos-arm64-*/syncthing "$DEST/syncthing"
  chmod +x "$DEST/syncthing"
  rm -rf "$TMP"
  "$DEST/syncthing" --version | head -1
fi

echo "==> [2/5] 生成配置(已存在则跳过)"
if [ ! -f "$ST_CONFIG/config.xml" ]; then
  "$DEST/syncthing" generate --home="$ST_CONFIG" >/dev/null
  # v2 的 generate 会附带默认 ~/Sync 文件夹,移除(我们只要考研new)
  python3 - "$ST_CONFIG/config.xml" <<'PY'
import re, sys
cfg = sys.argv[1]
src = open(cfg).read()
# 删除 id="default" 的 folder 段(容错:没有就算了)
src2 = re.sub(r'    <folder id="default".*?</folder>\n', "", src, flags=re.S)
open(cfg, "w").write(src2)
PY
fi

echo "==> [3/5] 注入共享文件夹配置($SYNC_DIR + ~/.pi-penecho)"
inject_folder() { # $1=id $2=label $3=path
  grep -q "id=\"$1\"" "$ST_CONFIG/config.xml" && { echo "   $1 已存在,跳过"; return; }
  python3 - "$ST_CONFIG/config.xml" "$1" "$2" "$3" <<'PY'
import sys
cfg, fid, label, folder_path = sys.argv[1:5]
block = f'''    <folder id="{fid}" label="{label}" path="{folder_path}" type="sendreceive" rescanIntervalS="30" fsWatcherEnabled="true" fsWatcherDelayS="5" ignorePerms="true">
        <filesystemType>basic</filesystemType>
        <minDiskFree unit="%">1</minDiskFree>
        <maxConflicts>-1</maxConflicts>
        <paused>false</paused>
        <markerName>.stfolder</markerName>
    </folder>
</configuration>'''
src = open(cfg).read()
assert "</configuration>" in src, "config.xml 结构异常"
open(cfg, "w").write(src.replace("</configuration>", block))
print(f"   {fid} 已注入")
PY
}
inject_folder "kaoyan-new" "考研new" "$SYNC_DIR"
inject_folder "pi-penecho-config" "pi-penecho 配置" "$HOME/.pi-penecho"

echo "==> [4/5] launchd 开机自启"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.penecho.syncthing</string>
  <key>ProgramArguments</key>
  <array><string>$DEST/syncthing</string><string>serve</string><string>--no-browser</string><string>--home</string><string>$ST_CONFIG</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$ST_CONFIG/syncthing.log</string>
  <key>StandardErrorPath</key><string>$ST_CONFIG/syncthing.log</string>
</dict></plist>
EOF
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
sleep 3

echo "==> [5/5] 状态"
DEVICE_ID=$(sed -n 's/.*<device id="\([^"]*\)"[^>]*name=.*/\1/p' "$ST_CONFIG/config.xml" | head -1)
curl -s -m 3 -o /dev/null -w "Syncthing Web 控制台: http://127.0.0.1:8384 (HTTP %{http_code})\n" http://127.0.0.1:8384/ || echo "Web 控制台未就绪,稍等几秒再看"
echo ""
echo "本机设备 ID(配对时用,也可在 Web 控制台「操作→显示ID」查看):"
echo "  $DEVICE_ID"
echo ""
echo "下一步:平板跑完一键安装后,在控制台 http://localhost:9191 点「配对平板」即可"
echo "(等价命令行:bash scripts/pair-tablet.sh;手动方式:http://127.0.0.1:8384)。"
