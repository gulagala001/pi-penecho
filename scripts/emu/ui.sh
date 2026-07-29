#!/usr/bin/env bash
#  dump 当前界面 UI 结构(XML)。用法:bash scripts/emu/ui.sh [out.xml]
set -euo pipefail
export ANDROID_HOME="$HOME/.local/android"
ADB="$ANDROID_HOME/platform-tools/adb"
OUT="${1:-/tmp/ui-dump.xml}"
"$ADB" shell uiautomator dump /sdcard/__ui.xml >/dev/null 2>&1
"$ADB" pull /sdcard/__ui.xml "$OUT" >/dev/null 2>&1
echo "[emu] UI dump: $OUT"
