#!/usr/bin/env bash
# 安装 APK 到测试 AVD。用法:bash scripts/emu/install.sh path/to.apk
set -euo pipefail
export ANDROID_HOME="$HOME/.local/android"
APK="${1:?用法: install.sh <apk>}"
"$ANDROID_HOME/platform-tools/adb" install -r -g "$APK"
