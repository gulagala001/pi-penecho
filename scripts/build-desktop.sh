#!/bin/bash
# 电脑端 Electron 物料准备:桥 bundle + penecho + syncthing 二进制
# 之后 npx electron . 开发跑,或 npx electron-builder 打包
set -e
cd "$(dirname "$0")/.."
PENECHO_VERSION="${PENECHO_VERSION:-0.7.1}"

echo "==> [1/3] 桥 esbuild 单文件(与 rootfs 同参数)"
npx esbuild src/server.mjs --bundle --platform=node --format=esm --target=node20 \
  --main-fields=module,main \
  '--banner:js=import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' \
  --outfile=desktop/bridge-bundle.mjs \
  '--external:@aws-sdk/*' '--external:@aws-crypto/*' '--external:@smithy/*' \
  '--external:@google/*' --external:google-auth-library --external:gaxios --external:gcp-metadata \
  '--external:@mistralai/*' --external:openai --external:sharp 2>&1 | tail -1

echo "==> [2/3] penecho $PENECHO_VERSION pack 解开"
rm -rf desktop/penecho desktop/.pack
mkdir -p desktop/.pack
( cd desktop/.pack && npm pack "penecho@$PENECHO_VERSION" --silent )
tar xzf desktop/.pack/*.tgz -C desktop/.pack
mv desktop/.pack/package desktop/penecho
rm -rf desktop/.pack

echo "==> [3/3] syncthing 二进制(当前平台)"
mkdir -p desktop/bin
SRC="$(command -v syncthing || echo "$HOME/.local/bin/syncthing")"
cp "$SRC" desktop/bin/$(uname -s | grep -qi windows && echo syncthing.exe || echo syncthing)
chmod +x desktop/bin/syncthing 2>/dev/null || true

echo "完成。开发: npx electron .  打包: npx electron-builder"
