#!/usr/bin/env bash
# 构建白板壳 APK(单 APK 形态:assets 内嵌发动机 termux.apk,构建时自动从 dist/ 取)
# 产物:dist/PenEcho-board.apk
set -euo pipefail
cd "$(dirname "$0")/../android"

export JAVA_HOME="${JAVA_HOME:-$HOME/.local/java/temurin-21/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/.local/android}"

[ -f app/src/main/assets/termux.apk ] || cp ../dist/termux.apk app/src/main/assets/termux.apk

./gradlew assembleRelease --console=plain -q
cp app/build/outputs/apk/release/app-release.apk ../dist/PenEcho-board.apk
echo "完成: dist/PenEcho-board.apk ($(du -h ../dist/PenEcho-board.apk | cut -f1))"
