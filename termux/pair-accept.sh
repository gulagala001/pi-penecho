#!/data/data/com.termux/files/usr/bin/bash
# 平板端配对守护:10 分钟窗口内自动接受 Mac 发来的设备邀请 + 「考研new」文件夹共享
# 文件夹落点固定为 ~/Projects/考研new(与 persona 的 workspace: ~/Projects/考研new 对应)
# 用法: bash pair-accept.sh(可后台运行;配对成功或超时自动退出)
set -u

ST_HOME="$HOME/.config/syncthing"
TARGET="$HOME/Projects/考研new"
API="http://127.0.0.1:8384/rest"

[ -f "$ST_HOME/config.xml" ] || { echo "syncthing 配置不存在,先启动一次 syncthing"; exit 1; }
APIKEY=$(sed -n 's/.*<apikey>\(.*\)<\/apikey>.*/\1/p' "$ST_HOME/config.xml")

get() { curl -s -m 4 -H "X-API-Key: $APIKEY" "$API$1" 2>/dev/null; }
post() { curl -s -m 6 -H "X-API-Key: $APIKEY" -H "Content-Type: application/json" -X POST -d "$2" "$API$1" 2>/dev/null; }

# 等 syncthing API 就绪
for _ in $(seq 1 30); do get "/system/status" >/dev/null && break; sleep 2; done

echo "[pair] 等待 Mac 发起配对(请在 Mac 上打开 http://127.0.0.1:8384 添加本设备并共享「考研new」)…"
for _ in $(seq 1 120); do
  # 1) 自动接受待配对设备
  DEV=$(get "/cluster/pending/devices" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const d=JSON.parse(s);const k=Object.keys(d)[0]||"";console.log(k)}catch{}})' 2>/dev/null)
  if [ -n "$DEV" ]; then
    echo "[pair] 接受设备: ${DEV:0:13}…"
    post "/config/devices" "{\"deviceID\":\"$DEV\",\"name\":\"Mac\",\"addresses\":[\"dynamic\"],\"compression\":\"metadata\",\"introducer\":false,\"autoAcceptFolders\":false,\"paused\":false}" >/dev/null
  fi

  # 2) 自动接受 kaoyan-new 文件夹
  HAS_FOLDER=$(get "/cluster/pending/folders" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const d=JSON.parse(s);console.log(d["kaoyan-new"]?"1":"")}catch{}})' 2>/dev/null)
  if [ -n "$HAS_FOLDER" ] && [ -n "$DEV" ]; then
    # 已配对的 Mac 设备 ID(可能刚接受完,从 config 读)
    MACID=$(get "/config/devices" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const d=JSON.parse(s);const a=Array.isArray(d)?d:d.devices||[];console.log((a[0]||{}).deviceID||"")}catch{}})' 2>/dev/null)
    if [ -n "$MACID" ]; then
      echo "[pair] 接受文件夹 kaoyan-new → $TARGET"
      mkdir -p "$TARGET"
      post "/config/folders" "{\"id\":\"kaoyan-new\",\"label\":\"考研new\",\"path\":\"$TARGET\",\"type\":\"sendreceive\",\"devices\":[{\"deviceID\":\"$MACID\"}],\"rescanIntervalS\":30,\"fsWatcherEnabled\":true,\"fsWatcherDelayS\":5,\"ignorePerms\":true,\"paused\":false}" >/dev/null
      sleep 3
      echo "[pair] ✅ 配对完成,开始同步记忆(md 档案,约 5MB)"
      exit 0
    fi
  fi
  sleep 5
done
echo "[pair] 超时未等到配对。可重跑本脚本,或在平板浏览器打开 http://127.0.0.1:8384 手动接受。"
exit 1
