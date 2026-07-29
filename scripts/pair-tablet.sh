#!/usr/bin/env bash
# Mac 端一键配对:发现局域网里的平板 Syncthing,自动加设备并把两个共享文件夹分给它
# 前提:平板已跑完 setup.sh(syncthing 在线);两端同一 WiFi
# 用法: bash scripts/pair-tablet.sh
set -euo pipefail

ST_CONFIG="$HOME/.config/syncthing"
APIKEY=$(sed -n 's/.*<apikey>\(.*\)<\/apikey>.*/\1/p' "$ST_CONFIG/config.xml")
API="http://127.0.0.1:8384/rest"
FOLDERS="kaoyan-new pi-penecho-config"

get() { curl -s -m 5 -H "X-API-Key: $APIKEY" "$API$1"; }

MYID=$(sed -n 's/.*<device id="\([^"]*\)"[^>]*name=.*/\1/p' "$ST_CONFIG/config.xml" | head -1)

echo "==> 扫描局域网设备(约 10 秒)…"
FOUND=""
for _ in $(seq 1 5); do
  FOUND=$(get "/system/discovery" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    ids = [k for k in d.keys() if k != '$MYID']
    print('\n'.join(ids))
except Exception:
    pass")
  [ -n "$FOUND" ] && break
  sleep 3
done

[ -n "$FOUND" ] || { echo "没发现任何平板。请确认:①平板 setup.sh 已跑完 ②两端同一 WiFi ③平板 Termux 未被杀后台"; exit 1; }

COUNT=$(echo "$FOUND" | wc -l | tr -d ' ')
if [ "$COUNT" != "1" ]; then
  echo "发现多个设备,请手工到 http://127.0.0.1:8384 选择你的平板:"
  echo "$FOUND"
  exit 1
fi

TABLET=$(echo "$FOUND" | head -1)
echo "==> 发现平板: ${TABLET:0:13}…,添加为远程设备"
curl -s -m 6 -H "X-API-Key: $APIKEY" -H "Content-Type: application/json" -X POST "$API/config/devices" \
  -d "{\"deviceID\":\"$TABLET\",\"name\":\"平板\",\"addresses\":[\"dynamic\"],\"compression\":\"metadata\",\"introducer\":false,\"autoAcceptFolders\":false,\"paused\":false}" >/dev/null

for FID in $FOLDERS; do
  echo "==> 共享文件夹 $FID → 平板"
  TMP=$(mktemp)
  get "/config/folders/$FID" > "$TMP"
  python3 - "$TMP" "$TABLET" <<'PY'
import json, sys
cfg_file, dev = sys.argv[1], sys.argv[2]
f = json.load(open(cfg_file))
devs = f.setdefault("devices", [])
if not any(d.get("deviceID") == dev for d in devs):
    devs.append({"deviceID": dev, "introducedBy": "", "encryptionPassword": ""})
f["paused"] = False
json.dump(f, open(cfg_file, "w"))
PY
  curl -s -m 6 -H "X-API-Key: $APIKEY" -H "Content-Type: application/json" -X PUT "$API/config/folders/$FID" --data-binary "@$TMP" >/dev/null
  rm -f "$TMP"
done

echo ""
echo "✅ Mac 端配对已发起。平板上的配对守护会在约 10 秒内自动接受,"
echo "   随后记忆(考研new 的 md 档案)与配置(含 API key)自动同步到平板。"
