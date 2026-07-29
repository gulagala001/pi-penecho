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

echo "==> [3/5] 注入共享文件夹配置($SYNC_DIR)"
if ! grep -q 'id="kaoyan-new"' "$ST_CONFIG/config.xml"; then
  # 在 </configuration> 前插入 folder 段;缺省字段由 syncthing 启动时规范化补齐
  python3 - "$ST_CONFIG/config.xml" "$SYNC_DIR" <<'PY'
import sys
cfg, folder_path = sys.argv[1], sys.argv[2]
block = f'''    <folder id="kaoyan-new" label="考研new" path="{folder_path}" type="sendreceive" rescanIntervalS="30" fsWatcherEnabled="true" fsWatcherDelayS="5" ignorePerms="true">
        <filesystemType>basic</filesystemType>
        <minDiskFree unit="%">1</minDiskFree>
        <versioning></versioning>
        <copiers>0</copiers>
        <pullerMaxPendingKiB>0</pullerMaxPendingKiB>
        <hashers>0</hashers>
        <order>random</order>
        <ignoreDelete>false</ignoreDelete>
        <scanProgressIntervalS>0</scanProgressIntervalS>
        <pullerPauseS>0</pullerPauseS>
        <maxConflicts>-1</maxConflicts>
        <disableSparseFiles>false</disableSparseFiles>
        <disableTempIndexes>false</disableTempIndexes>
        <paused>false</paused>
        <weakHashThresholdPct>25</weakHashThresholdPct>
        <markerName>.stfolder</markerName>
        <copyOwnershipFromParent>false</copyOwnershipFromParent>
        <modTimeWindowS>0</modTimeWindowS>
        <maxConcurrentWrites>2</maxConcurrentWrites>
        <disableFsync>false</disableFsync>
        <blockPullOrder>standard</blockPullOrder>
        <copyRangeMethod>standard</copyRangeMethod>
        <caseSensitiveFS>false</caseSensitiveFS>
        <junctionsAsDirs>false</junctionsAsDirs>
        <syncOwnership>false</syncOwnership>
        <sendOwnership>false</sendOwnership>
        <syncXattrs>false</syncXattrs>
        <sendXattrs>false</sendXattrs>
        <xattrFilter>
            <maxSingleEntrySize>1024</maxSingleEntrySize>
            <maxTotalSize>4096</maxTotalSize>
        </xattrFilter>
    </folder>
</configuration>'''
src = open(cfg).read()
assert "</configuration>" in src, "config.xml 结构异常"
open(cfg, "w").write(src.replace("</configuration>", block))
print("文件夹配置已注入")
PY
else
  echo "已存在,跳过"
fi

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
echo "下一步:平板装好 syncthing 并启动后,两台设备同一 WiFi,"
echo "打开 http://127.0.0.1:8384 →「添加远程设备」→ 列表里选你的平板 → 勾选共享「考研new」→ 保存。"
