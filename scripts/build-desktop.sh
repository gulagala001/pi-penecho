#!/bin/bash
# 电脑端 Electron 物料准备:桥 bundle + penecho + syncthing 二进制
# 之后 npx electron . 开发跑,或 npx electron-builder 打包
set -e
cd "$(dirname "$0")/.."
PENECHO_VERSION="${PENECHO_VERSION:-0.7.1}"

echo "==> [1/4] 桥 esbuild 单文件(与 rootfs 同参数)"
# 注意:openai SDK 必须进 bundle(pi-ai openai-completions/responses API 依赖它),不可 external
npx esbuild src/server.mjs --bundle --platform=node --format=esm --target=node20 \
  --main-fields=module,main \
  '--banner:js=import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' \
  --outfile=desktop/bridge-bundle.mjs \
  '--external:@aws-sdk/*' '--external:@aws-crypto/*' '--external:@smithy/*' \
  '--external:@google/*' --external:google-auth-library --external:gaxios --external:gcp-metadata \
  '--external:@mistralai/*' --external:sharp 2>&1 | tail -1

echo "==> [2/4] penecho $PENECHO_VERSION pack 解开"
rm -rf desktop/penecho desktop/.pack
mkdir -p desktop/.pack
( cd desktop/.pack && npm pack "penecho@$PENECHO_VERSION" --silent )
tar xzf desktop/.pack/*.tgz -C desktop/.pack
mv desktop/.pack/package desktop/penecho
rm -rf desktop/.pack
# 上游源码补丁:画布 autosave + 顶栏换行(升级 penecho 后锚点漂移会显式报错)
node scripts/patch-penecho.mjs desktop/penecho

echo "==> [3/4] Windows 图标(PNG 内嵌 ICO)"
node scripts/make-ico.mjs

echo "==> [4/4] syncthing 二进制(按平台分目录 desktop/bin/<mac|win|linux>/)"
# TARGETS:空格分隔目标平台(默认当前平台)。例:TARGETS="mac win" 为 mac+win 双端备料
# 本机已装 syncthing 且目标=当前平台时直接复制;否则从 GitHub releases 下载 SYNCTHING_VERSION
SYNCTHING_VERSION="${SYNCTHING_VERSION:-2.1.2}"
UNAME_S="$(uname -s)"
case "$UNAME_S" in
  Darwin) HOST_PLAT=mac ;;
  Linux) HOST_PLAT=linux ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT) HOST_PLAT=win ;;
  *) HOST_PLAT=mac ;;
esac
HOST_ARCH="$(uname -m)" # arm64 / x86_64
TARGETS="${TARGETS:-$HOST_PLAT}"

fetch_syncthing() { # $1=平台(mac|win|linux) $2=输出路径
  local plat="$1" out="$2"
  local suffix asset tmp
  case "$plat" in
    mac)   suffix="macos-$([ "$HOST_ARCH" = "arm64" ] && echo arm64 || echo amd64)"; asset="syncthing" ;;
    win)   suffix="windows-amd64"; asset="syncthing.exe" ;;
    linux) suffix="linux-amd64"; asset="syncthing" ;;
  esac
  local name="syncthing-${suffix}-v${SYNCTHING_VERSION}"
  local ext="zip"; [ "$plat" = "linux" ] && ext="tar.gz"
  local url="https://github.com/syncthing/syncthing/releases/download/v${SYNCTHING_VERSION}/${name}.${ext}"
  tmp="$(mktemp -d)"
  echo "    下载 $url"
  curl -fL --retry 3 -sS -o "$tmp/pkg.$ext" "$url"
  if [ "$ext" = "zip" ]; then unzip -q -o "$tmp/pkg.$ext" -d "$tmp/x"; else tar xzf "$tmp/pkg.$ext" -C "$tmp" --one-top-level=x; fi
  cp "$tmp/x/$name/$asset" "$out"
  chmod +x "$out" 2>/dev/null || true
  rm -rf "$tmp"
}

for plat in $TARGETS; do
  bin_name="syncthing"; [ "$plat" = "win" ] && bin_name="syncthing.exe"
  out="desktop/bin/$plat/$bin_name"
  mkdir -p "desktop/bin/$plat"
  if [ "$plat" = "$HOST_PLAT" ] && command -v syncthing >/dev/null 2>&1; then
    cp "$(command -v syncthing)" "$out"; echo "    $plat: 复制本机 $(command -v syncthing)"
  elif [ "$plat" = "$HOST_PLAT" ] && [ -x "$HOME/.local/bin/syncthing" ]; then
    cp "$HOME/.local/bin/syncthing" "$out"; echo "    $plat: 复制 ~/.local/bin/syncthing"
  elif [ -f "$out" ]; then
    echo "    $plat: 复用已有 $out"
  else
    fetch_syncthing "$plat" "$out"
  fi
done
# 清理旧版根级二进制(已迁到平台子目录)
rm -f desktop/bin/syncthing desktop/bin/syncthing.exe

echo "完成。开发: npx electron .  打包: npx electron-builder"
