#!/usr/bin/env bash
# 截图到指定文件。用法:bash scripts/emu/shot.sh /tmp/a.png
set -euo pipefail
export ANDROID_HOME="$HOME/.local/android"
OUT="${1:?用法: shot.sh <out.png>}"
"$ANDROID_HOME/platform-tools/adb" exec-out screencap -p > "$OUT"
echo "[emu] 截图: $OUT ($(du -h "$OUT" | cut -f1))"
