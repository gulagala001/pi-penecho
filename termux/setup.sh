#!/data/data/com.termux/files/usr/bin/bash
# pi-penecho 安卓一键安装(Termux 内执行)
# 用法: curl -sL <脚本地址> | bash
#    或: bash setup.sh [自定义bundle地址]
set -e

BUNDLE_URL="${1:-https://github.com/gulagala001/pi-penecho/releases/latest/download/pi-penecho-termux-arm64.tar.gz}"

echo "┌─────────────────────────────────────┐"
echo "│   PenEcho 移动套件 · 一键安装       │"
echo "└─────────────────────────────────────┘"

echo "==> [1/4] 安装基础包(nodejs-lts + syncthing,可能需要几分钟)"
pkg update -y
pkg install -y nodejs-lts syncthing curl tar

echo "==> [2/4] 下载 PenEcho 移动套件"
PKG_TMP="$PREFIX/tmp"
mkdir -p "$PKG_TMP"
curl -fL --retry 3 --connect-timeout 15 -o "$PKG_TMP/penecho-bundle.tar.gz" "$BUNDLE_URL"

echo "==> [3/4] 解压安装"
rm -rf "$HOME/penecho-mobile"
mkdir -p "$HOME/penecho-mobile"
tar xzf "$PKG_TMP/penecho-bundle.tar.gz" -C "$HOME/penecho-mobile" --strip-components=1
rm -f "$PKG_TMP/penecho-bundle.tar.gz"
chmod +x "$HOME/penecho-mobile/"*.sh

# Termux:Boot 开机自启(没装 Termux:Boot 则跳过,仅提示)
mkdir -p "$HOME/.termux/boot"
cp "$HOME/penecho-mobile/boot.sh" "$HOME/.termux/boot/start-penecho.sh"
chmod +x "$HOME/.termux/boot/start-penecho.sh"

# 打开 Termux 时自动补启动(幂等;Boot 未装/被系统跳过时兜底)
if ! grep -q "penecho-mobile/start.sh" "$HOME/.bashrc" 2>/dev/null; then
  echo '~/penecho-mobile/start.sh' >> "$HOME/.bashrc"
fi

echo "==> [4/4] 启动服务"
bash "$HOME/penecho-mobile/start.sh"

# 记忆同步:预建工作区 + 大文件忽略规则(与 Mac 端规则一致,双保险)
mkdir -p "$HOME/Projects/考研new"
cat > "$HOME/Projects/考研new/.stignore" <<'STIGN'
// 平板只带文字记忆(md/txt/json),大二进制留 Mac
*.pdf
*.zip
*.jpg
*.jpeg
*.png
*.gif
*.mp4
*.mov
*.ppt
*.pptx
*.doc
*.docx
*.epub
*.7z
*.rar
STIGN

# 启动配对守护(后台等 10 分钟;Mac 端在 8384 网页发起配对后自动接受)
nohup bash "$HOME/penecho-mobile/pair-accept.sh" > "$HOME/penecho-mobile/logs/pair.log" 2>&1 &

cat <<'EOF'

╔══════════════════════════════════════════╗
║  安装完成!接下来:                        ║
╠══════════════════════════════════════════╣
║  【同步记忆】在 Mac 上(与平板同一 WiFi):  ║
║  打开 http://127.0.0.1:8384             ║
║  →「添加远程设备」→ 选你的平板           ║
║  → 勾选共享「考研new」→ 保存             ║
║  平板会自动接受(10 分钟内有效)           ║
║  配对成功后约 5MB 的笔记/进度自动到位     ║
╠══════════════════════════════════════════╣
║  【白板 app】安装 PenEcho-board.apk      ║
║  首次打开自动跳控制台 → 粘贴 Kimi key     ║
║  → 保存 → ≡ 回到白板,开始写字           ║
╠══════════════════════════════════════════╣
║  提示:把 Termux 加入系统「后台白名单」     ║
║  (设置→应用→Termux→电池→无限制)         ║
╚══════════════════════════════════════════╝

日常管理(在 Termux 里):
  启动  ~/penecho-mobile/start.sh
  停止  ~/penecho-mobile/stop.sh
  日志  tail -f ~/penecho-mobile/logs/bridge.log
  重跑配对  bash ~/penecho-mobile/pair-accept.sh
EOF
