#!/usr/bin/env bash
# 关闭测试 AVD
set -euo pipefail
export ANDROID_HOME="$HOME/.local/android"
"$ANDROID_HOME/platform-tools/adb" emu kill 2>/dev/null || true
echo "[emu] 已关闭"
