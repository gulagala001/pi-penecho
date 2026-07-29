#!/usr/bin/env bash
# 构建一体化白板 APK(单 APK:node/syncthing 内嵌,发动机隐形)
# 流程:build-rootfs.sh(物料)→ gradle assembleRelease → dist/PenEcho-board.apk
set -euo pipefail
cd "$(dirname "$0")/.."

bash scripts/build-rootfs.sh

cd android
export JAVA_HOME="${JAVA_HOME:-$HOME/.local/java/temurin-21/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/.local/android}"

./gradlew assembleRelease --console=plain -q
cp app/build/outputs/apk/release/app-release.apk ../dist/PenEcho-board.apk
echo "完成: dist/PenEcho-board.apk ($(du -h ../dist/PenEcho-board.apk | cut -f1))"
