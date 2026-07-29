#!/data/data/com.termux/files/usr/bin/bash
# pi-penecho 安卓一键安装(Termux 内执行)
# 用法: curl -sL <脚本地址> | bash
#    或: bash setup.sh [自定义bundle地址]
set -e

BUNDLE_URL="${1:-https://github.com/gulagala001/pi-penecho/releases/latest/download/pi-penecho-termux-arm64.tar.gz}"

echo "┌─────────────────────────────────────┐"
echo "│   PenEcho 移动套件 · 一键安装       │"
echo "└─────────────────────────────────────┘"

echo "==> [1/4] 安装基础包(nodejs-lts 可能需要几分钟)"
pkg update -y
pkg install -y nodejs-lts curl tar

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

cat <<'EOF'

╔══════════════════════════════════════════╗
║  安装完成!接下来三步:              ║
╠══════════════════════════════════════════╣
║  1. 安装「白板」app(APK 找发你包的人要)   ║
║  2. 打开白板 app → 右上角「控制台」       ║
║     → 粘贴你的 Kimi API key → 保存        ║
║  3. 回到白板,开始写字                   ║
╠══════════════════════════════════════════╣
║  可选:装 Termux:Boot 可实现开机自启服务   ║
║  (要和 Termux 同一来源:都用 GitHub 版)    ║
║  没装 Boot 也没关系:重启平板后打开一次      ║
║  Termux,服务会自动启动(已写入 .bashrc)     ║
╠══════════════════════════════════════════╣
║  提示:把 Termux 加入系统「后台白名单」     ║
║  (设置→应用→Termux→电池→无限制),         ║
║  否则系统可能杀掉后台服务                 ║
╚══════════════════════════════════════════╝

日常管理(在 Termux 里):
  启动  ~/penecho-mobile/start.sh
  停止  ~/penecho-mobile/stop.sh
  日志  tail -f ~/penecho-mobile/logs/bridge.log
EOF
