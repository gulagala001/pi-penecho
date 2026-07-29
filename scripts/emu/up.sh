#!/usr/bin/env bash
# 启动测试 AVD(无头),等待 boot 完成。用法:bash scripts/emu/up.sh
set -euo pipefail
export ANDROID_HOME="$HOME/.local/android"
EMU="$ANDROID_HOME/emulator/emulator"
ADB="$ANDROID_HOME/platform-tools/adb"
AVD_NAME="${1:-test}"

if "$ADB" devices | grep -q "emulator-"; then
  echo "[emu] 已在运行"; exit 0
fi

echo "[emu] 启动 AVD: $AVD_NAME(无头)"
nohup "$EMU" -avd "$AVD_NAME" -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect \
  > "$HOME/.local/android/emulator.log" 2>&1 &

echo "[emu] 等待开机…"
"$ADB" wait-for-device
for _ in $(seq 1 90); do
  BOOT=$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
  [ "$BOOT" = "1" ] && break
  sleep 2
done
[ "$BOOT" = "1" ] || { echo "[emu] 开机超时,看 $HOME/.local/android/emulator.log"; exit 1; }
echo "[emu] 就绪: $("$ADB" shell getprop ro.build.version.release | tr -d '\r') ($("$ADB" shell getprop ro.product.cpu.abi | tr -d '\r'))"
