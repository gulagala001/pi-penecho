#!/usr/bin/env bash
# 构建手机端「发动机总成」物料(FEAT-1.1.1 正式版):
#   node/syncthing 可执行 → android/app/src/main/jniLibs/(伪装 lib*.so,exec 用)
#   依赖库/桥/penecho/资源 → android/app/src/main/assets/rootfs/(首启解压)
# 幂等可重复;deb 缓存在 dist/cache/。
set -euo pipefail
cd "$(dirname "$0")/.."

PENECHO_VERSION="${PENECHO_VERSION:-0.7.1}"
CACHE=dist/cache
J=android/app/src/main/jniLibs/arm64-v8a
R=android/app/src/main/assets/rootfs
BASE="https://packages.termux.dev/apt/termux-main"

DEBS=(
  "pool/main/n/nodejs-lts/nodejs-lts_24.18.0_aarch64.deb"
  "pool/main/z/zlib/zlib_1.3.2_aarch64.deb"
  "pool/main/c/c-ares/c-ares_1.34.8_aarch64.deb"
  "pool/main/libs/libsqlite/libsqlite_3.53.4_aarch64.deb"
  "pool/main/o/openssl/openssl_1:3.6.3_aarch64.deb"
  "pool/main/libi/libicu/libicu_78.3_aarch64.deb"
  "pool/main/libc/libc++/libc++_29_aarch64.deb"
  "pool/main/s/syncthing/syncthing_2.1.2_aarch64.deb"
)

echo "==> [1/5] 下载/缓存 Termux deb × ${#DEBS[@]}"
mkdir -p "$CACHE" "$J" "$R/libs"
for f in "${DEBS[@]}"; do
  n=$(basename "$f")
  [ -f "$CACHE/$n" ] || curl -fL --retry 3 -s -o "$CACHE/$n" "$BASE/$f"
done

echo "==> [2/5] 解包提取"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
U="data/data/com.termux/files/usr"
for f in "${DEBS[@]}"; do
  deb=$(basename "$f")
  n="${deb%.deb}"
  mkdir -p "$WORK/$n"
  tar -xf "$CACHE/$deb" -C "$WORK/$n"
  tar -xJf "$WORK/$n/data.tar.xz" -C "$WORK/$n"
done

# 可执行(进 jniLibs;AGP 只打包 *.so 后缀,命名即伪装)
cp "$WORK/nodejs-lts_24.18.0_aarch64/$U/bin/node" "$J/libnode_exec.so"
cp "$WORK/syncthing_2.1.2_aarch64/$U/bin/syncthing" "$J/libsyncthing_exec.so"

# 依赖库(进 assets/rootfs/libs,首启解压,LD_LIBRARY_PATH 指过去)
cp -L "$WORK/zlib_1.3.2_aarch64/$U/lib/libz.so.1" "$R/libs/libz.so.1"
cp -L "$WORK/c-ares_1.34.8_aarch64/$U/lib/libcares.so" "$R/libs/libcares.so"
cp -L "$WORK/libsqlite_3.53.4_aarch64/$U/lib/libsqlite3.so.0" "$R/libs/libsqlite3.so"
cp -L "$WORK/openssl_1:3.6.3_aarch64/$U/lib/libcrypto.so.3" "$R/libs/libcrypto.so.3"
cp -L "$WORK/openssl_1:3.6.3_aarch64/$U/lib/libssl.so.3" "$R/libs/libssl.so.3"
cp -L "$WORK/libicu_78.3_aarch64/$U/lib/libicudata.so.78" "$R/libs/libicudata.so.78"
cp -L "$WORK/libicu_78.3_aarch64/$U/lib/libicui18n.so.78" "$R/libs/libicui18n.so.78"
cp -L "$WORK/libicu_78.3_aarch64/$U/lib/libicuuc.so.78" "$R/libs/libicuuc.so.78"
cp -L "$WORK/libc++_29_aarch64/$U/lib/libc++_shared.so" "$R/libs/libc++_shared.so"

echo "==> [3/5] 桥 esbuild 单文件(与 build-termux-bundle 同参数)"
# 注意:openai SDK 必须进 bundle(pi-ai openai-completions/responses API 依赖它),不可 external
mkdir -p "$R/bridge"
npx esbuild src/server.mjs --bundle --platform=node --format=esm --target=node20 \
  --main-fields=module,main \
  '--banner:js=import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' \
  --outfile="$R/bridge/server.mjs" \
  '--external:@aws-sdk/*' '--external:@aws-crypto/*' '--external:@smithy/*' \
  '--external:@google/*' --external:google-auth-library --external:gaxios --external:gcp-metadata \
  '--external:@mistralai/*' --external:sharp 2>&1 | tail -1

echo "==> [4/5] 运行时资源(personas/public 与 bridge/ 同构)+ penecho pack"
rm -rf "$R/personas" "$R/public" "$R/penecho"
cp -R personas "$R/personas"
cp -R public "$R/public"
PACK=$(mktemp -d)
( cd "$PACK" && npm pack "penecho@$PENECHO_VERSION" --silent )
tar xzf "$PACK"/penecho-*.tgz -C "$PACK"
mv "$PACK/package" "$R/penecho"
rm -rf "$PACK"
# 上游源码补丁:画布 autosave + 顶栏换行(与桌面端同一补丁)
node scripts/patch-penecho.mjs "$R/penecho"

echo "==> [5/5] 物料清单 + 解压清单(manifest)"
# 版本戳(内容变化即重解)与文件清单(app 首启按单解压)
# 注意:aapt 忽略点开头文件!清理隐藏文件,清单同步排除(否则 APK 缺项,解压 FNFE)
( cd "$R" && find . -name ".*" -type f -delete && { echo "built=$(date +%s)"; } > version.txt && find . -type f ! -name ".*" | LC_ALL=C sort > manifest.txt )
du -sh "$J"/* "$R"/libs "$R"/bridge "$R"/penecho 2>/dev/null | sort -rh
echo ""
echo "完成。下一步:bash scripts/build-apk.sh"
