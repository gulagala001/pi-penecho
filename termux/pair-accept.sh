#!/data/data/com.termux/files/usr/bin/bash
# 平板端配对守护:10 分钟窗口内自动接受 Mac 的设备邀请 + 全部共享文件夹
# 文件夹落点:kaoyan-new → ~/Projects/考研new(对应 persona workspace)
#            pi-penecho-config → ~/.pi-penecho(API key / 人设 / 模型配置随之同步,免手填)
# 用法: bash pair-accept.sh(可后台运行;配对成功或超时自动退出)
set -u

ST_HOME="$HOME/.config/syncthing"
API="http://127.0.0.1:8384/rest"

[ -f "$ST_HOME/config.xml" ] || { echo "syncthing 配置不存在,先启动一次 syncthing"; exit 1; }
APIKEY=$(sed -n 's/.*<apikey>\(.*\)<\/apikey>.*/\1/p' "$ST_HOME/config.xml")

get() { curl -s -m 4 -H "X-API-Key: $APIKEY" "$API$1" 2>/dev/null; }
post() { curl -s -m 6 -H "X-API-Key: $APIKEY" -H "Content-Type: application/json" -X POST -d "$2" "$API$1" 2>/dev/null; }

# 文件夹 id → 本端落点
folder_path() {
  case "$1" in
    kaoyan-new) echo "$HOME/Projects/考研new" ;;
    pi-penecho-config) echo "$HOME/.pi-penecho" ;;
    *) echo "" ;;
  esac
}

# 等 syncthing API 就绪
for _ in $(seq 1 30); do get "/system/status" >/dev/null && break; sleep 2; done

echo "[pair] 等待 Mac 发起配对(对方在 Mac 端操作后这里自动接受)…"
DONE_MARK=""
for _ in $(seq 1 120); do
  # 1) 自动接受待配对设备
  DEV=$(get "/cluster/pending/devices" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const d=JSON.parse(s);console.log(Object.keys(d)[0]||"")}catch{}})' 2>/dev/null)
  if [ -n "$DEV" ]; then
    echo "[pair] 接受设备: ${DEV:0:13}…"
    post "/config/devices" "{\"deviceID\":\"$DEV\",\"name\":\"Mac\",\"addresses\":[\"dynamic\"],\"compression\":\"metadata\",\"introducer\":false,\"autoAcceptFolders\":false,\"paused\":false}" >/dev/null
    sleep 2
  fi

  # 2) 逐个接受待共享文件夹
  MACID=$(get "/config/devices" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const d=JSON.parse(s);const a=Array.isArray(d)?d:d.devices||[];console.log((a[0]||{}).deviceID||"")}catch{}})' 2>/dev/null)
  if [ -n "$MACID" ]; then
    for FID in $(get "/cluster/pending/folders" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{console.log(Object.keys(JSON.parse(s)).join(" "))}catch{}})' 2>/dev/null); do
      P=$(folder_path "$FID")
      [ -n "$P" ] || { echo "[pair] 跳过未知文件夹 $FID"; continue; }
      echo "[pair] 接受文件夹 $FID → $P"
      mkdir -p "$P"
      post "/config/folders" "{\"id\":\"$FID\",\"label\":\"$FID\",\"path\":\"$P\",\"type\":\"sendreceive\",\"devices\":[{\"deviceID\":\"$MACID\"}],\"rescanIntervalS\":30,\"fsWatcherEnabled\":true,\"fsWatcherDelayS\":5,\"ignorePerms\":true,\"paused\":false}" >/dev/null
      DONE_MARK="$DONE_MARK $FID"
      sleep 2
    done
  fi

  # 两个文件夹都接受完 → 成功退出
  case "$DONE_MARK" in
    *kaoyan-new*pi-penecho-config*)
      echo "[pair] ✅ 配对完成:记忆(约 5MB)与配置(含 API key)同步中"
      exit 0 ;;
  esac
  sleep 5
done
echo "[pair] 超时:已接受[$DONE_MARK]。若缺文件夹,请对方在 Mac 端确认已共享,然后重跑本脚本。"
exit 1
