# Plan(L5)

## 计划概述

### 目标
按 L1 终极形态交付:手机单 APK 一体化 → 配对闭环 → 多项目同步 → 多会话 → 电脑端 Electron。每 Phase 在安卓模拟器自动化验收,用户只拿成品。

### 范围边界
同 INTENT.md 边界(无 iOS/云/多人协作)。过渡形态(Termux 套件)保持可用直至 P2 交付替换。

### 前置条件
- 模拟器组件已装(emulator + android-34 arm64 镜像,2026-07-29 下载完成)
- pi-session-scout 调研(pi-agent-core 会话 API/pi-ai 降级线)若返回有官方会话 API,P4 改用之并记偏离

## 阶段划分

### Phase 1: 模拟器基建 + 单 APK 技术验证(胜负手)
- **FEAT**: FEAT-0.0.1
- **FEAT**: FEAT-1.1.1
- 内容:scripts/emu 四件套;nodejs-lts deb 提取(node+全部依赖 .so)+ hello.mjs 缝入 jniLibs(lib*.so 伪装+useLegacyPackaging);spike Activity exec 起 server;失败则启 proot 回退再验
- exit_criteria:①模拟器装 spike.apk 后 `adb shell curl 127.0.0.1:8787/hello` 返回 200(截图留证)②`adb shell ps` 可见 node 进程且 SELinux 无 denial 日志
- status: **done**(2026-07-29)
  - 证据 ①:`adb forward` + curl 返回 `hello from embedded node v24.18.0 (arm64)`;app 界面自证 ✅(截图 spike-final.png)
  - 证据 ②:ps 可见 `libnode_exec.so` 进程;dmesg 无 avc denied
  - 过程发现(进 CLAUDE.md 教训库):AGP jniLibs 只打包 *.so 后缀(libz.so.1 等被丢弃)→ 依赖库走 assets 解压+LD_LIBRARY_PATH;模拟器系统代理劫回环(显式 NO_PROXY);明文 HTTP 需 manifest usesCleartextTraffic;Deb 解包用 bsdtar(Mac ar 不认);libsqlite 独立成包;node 24 deb 依赖 9 库(z/cares/sqlite3/crypto.3/ssl.3/icudata.78/i18n.78/icuuc.78/c++_shared)

### Phase 2: 单 APK 成品化(手机端一体化)
- **FEAT**: FEAT-1.1.2
- **FEAT**: FEAT-1.2.1
- **FEAT**: FEAT-1.2.2
- 内容:rootfs 预制(node+bundle+syncthing+busybox+启动脚本);ForegroundService(dataSync+通知);首启引导状态机(装环境→发现电脑(内置 10.0.2.2)→输码位→就绪);子进程守护与自恢复
- exit_criteria:①模拟器冷装 APK→走完引导到白板页显示,全程无浏览器/终端元素(UI dump 断言)②`adb shell am force-stop` 重开后 30s 内 3888/9191 恢复 200 ③白板 app 内手写模拟请求经 9191 全链路(test:bridge 对模拟器实例)通过
- status: **done**(2026-07-29)
  - 证据 ①:APK 43M 冷装→BOOTING(解压 100M)→白板页完整显示(截图 p2-ready.png:PenEcho Ready+QUICK TOUR,无浏览器元素);桥 health ok/白板 37968B/syncthing 200(adb forward 19191/13888/18384 验证)
  - 证据 ②:force-stop 后服务 000→am start 重开 **2s** 恢复 200(标准 30s)
  - 证据 ③:run-as 预置含 key config(shell 管道法绕 SELinux)→ `BASE=http://127.0.0.1:19191 npm run test:bridge` 两轮全过(61.2s 板书 7 条 write_text + 19.0s 会话记忆)
  - 组件:scripts/build-rootfs.sh(8 deb 提取+esbuild+penecho pack+manifest/version.txt);EngineBoot.java(版本戳解压/sync generate/spawn 三进程/崩溃退避重拉/start 幂等防 EADDRINUSE);EngineService.java(前台 dataSync);MainActivity 一体化重写(Termux 流程全删)
  - 过程发现:①aapt 忽略点开头文件且残留 .version 进 manifest 会 FNFE(构建先 `find . -name ".*" -delete`)②run-as cwd 不可靠用绝对路径 ③shell 管道法(cat|run-as sh -c)绕 SELinux 写 app 私有目录 ④adb forward 撞 Mac 端口用高位映射(19191)

### Phase 3: 配对闭环(码+确认+文件夹方向)
- **FEAT**: FEAT-2.2.1
- **FEAT**: FEAT-2.2.2
- **FEAT**: FEAT-2.2.3
- **FEAT**: FEAT-3.1.1
- 内容:pair.mjs 状态机(code/redeem/pending/confirm/reject/map);sync-folders.json 注册表+ensureSyncFolders;控制台「平板入口+配对+项目与同步」三卡;手机端配对页(读 deviceID→redeem→轮询→按 map 接受)
- exit_criteria:①端到端:控制台生码→模拟器 app 输码→控制台确认(勾选 2 文件夹分别 双向/仅电脑→平板)→syncthing 配置与勾选一致(API 断言 type)②手机端文件夹落点与 map 一致且开始同步(8384 API 可见 completion 前进)③错码/过期/拒绝三错误路径均有明确界面反馈
- status: todo

### Phase 4: 项目内多会话
- **FEAT**: FEAT-3.2.1
- **FEAT**: FEAT-3.2.2
- 内容:src/sessions.mjs 存档/读档薄层(index.json+<id>.json 图像占位化);server.mjs 会话路由;控制台会话卡升级;手机端 ≡ 菜单入口;保住 runTutorTurn 全部既有逻辑
- exit_criteria:①新建 2 会话各聊 1 轮→kill 桥→重启→会话列表/历史完整且可继续(test:bridge 逐会话验证)②切换会话后板书进入对应会话且 persona 随会话切换 ③npm run check + 既有 test:bridge 全绿(无回归)
- status: todo

### Phase 5: 电脑端 Electron app
- **FEAT**: FEAT-2.1.1
- **FEAT**: FEAT-2.1.2
- 内容:desktop/main.mjs(桥+PenEcho+syncthing+门户同进程);首运向导(填 key→二维码);electron-builder 出 .app/.dmg(Windows exe 顺手);与 bash 常驻服务端口冲突处理
- exit_criteria:①干净用户目录双击 .app→向导→填 key→窗口控制台可用(9191/3888/9288/8384 全在线)②首启向导二维码扫描可达安装页 ③asar 包内 personas/admin 资源读取正常(端到端一轮板书)
- status: todo

### Phase 6: 总装与陌生人验收
- **FEAT**: FEAT-2.3.1
- 内容:README/向导陌生人视角重写;Release v1.0(电脑 app+手机 APK);清退 Termux 过渡文档(归档层)
- exit_criteria:①按 README 从零(新用户目录+新 AVD)不看任何对话记录走通全程 ②全部成功标准勾选可举证据
- status: todo

## 文件清单(新建/改动)

新建:scripts/emu/*、src/sessions.mjs、desktop/*(P5)、android/app/src/main/java/com/penecho/board/{EngineBoot,EngineService}.java(P2)、~/.pi-penecho/sync-folders.json(契约)
改动:src/pair.mjs(P3)、src/server.mjs(P3/P4 路由)、public/admin.html(P3/P4 卡片)、MainActivity.java(P2/P3)、README*.md(P6)

## 风险与备选

- RISK-1(exec 受限):P1 spike 失败→proot 回退;proot 亦败→维持 Termux 形态并将 L1#1 降格(走意图变更,不偷降)
- RISK-2(保活):前台服务+自恢复兜底,验收不依赖厂商白名单
- pi-ai 会话 API 若存在:P4 换用并记偏离(不重复造轮子)

## 执行日志

| 时间 | 动作 | 结果 |
|------|------|------|
| 2026-07-29 | L1-L5 建立 | 待 P1 开工 |
| 2026-07-29 | pi-session-scout 调研回报 | ①pi-agent-core harness 层有 JsonlSessionRepo/Session(磁盘持久化 create/open/list/delete/fork),Agent 多实例无限制,messages 可序列化 → P4 优先评估复用(不重复造轮子) ②pi-ai/pi-agent-core 最后支持 Node20 的版本为 0.74.2,无 Node18 版 → nodejs-mobile 路线终局排除,ADR-1 直连内嵌确认为唯一路径 |

| 2026-07-29 | P2 开工(单 APK 成品化) | build-rootfs.sh 完成并跑通:物料就位 jniLibs(libnode_exec.so 43M+libsyncthing_exec.so 26M)+ assets/rootfs(libs 45M 9库/bridge 1.1M/penecho 1.4M/personas/public/manifest.txt/.version);EngineBoot.java(解压+版本戳、sync generate、spawn 三进程 env 注入、崩溃退避重拉、NO_PROXY 健康探测)与 EngineService.java(前台 dataSync+通知,START_STICKY)写完;待:MainActivity 改造(删 Termux 流程)、manifest 权限与 service 声明、build-apk.sh 删 termux.apk 拷贝、模拟器验收 |

## Phase 2 中途快照(压缩保护 · 2026-07-29 晚)

**正在做**:android/ 主工程一体化改造,下一步=MainActivity 删除 decideFlow/installEngine/showInitGuide(Termux 流程),改为启动 EngineService→BOOTING(EngineBoot.Listener.onProgress)→onReady→白板;保留 buildWebView/buildWaitView/buildFab/discoverPortal/waitForServices/key 检测;manifest 删 REQUEST_INSTALL_PACKAGES,加 FOREGROUND_SERVICE/FOREGROUND_SERVICE_DATA_SYNC(API34)/POST_NOTIFICATIONS(API33)+`<service android:name=".EngineService" android:foregroundServiceType="dataSync" android:exported="false"/>`;build-apk.sh 删 assets/termux.apk 拷贝行;.gitignore 加 android/app/src/main/jniLibs/ 与 assets/rootfs/(二进制不入库,build-rootfs.sh 重取);验收=模拟器冷装→BOOTING→白板 200→adb forward 9191 后 BASE=http://127.0.0.1:9191 npm run test:bridge(debug 版可 run-as 预置含 key 的 config.json)。

**环境速查**:JAVA_HOME=~/.local/java/temurin-21/Contents/Home;ANDROID_HOME=~/.local/android;gradle=~/.local/gradle-8.10.2/bin/gradle;adb=~/.local/android/platform-tools/adb;AVD 起法 scripts/emu/up.sh;gh=~/.local/bin/gh(已登录);release=gulagala001/pi-penecho v0.3.0(公开)。

**调研结论(P4 用)**:pi-agent-core harness 层有 JsonlSessionRepo/Session(磁盘持久化 create/open/list/delete/fork),Agent 多实例无限制,messages 可 get/set 序列化;pi-ai 0.74.2=最后支持 Node20 版,无 Node18 版(降级路线死刑,ADR-1 直连内嵌唯一解)。

## 偏离记录

| 时间 | 偏离 | 原因 |
|------|------|------|
| 2026-07-29 | P4 持久化优先评估 pi-agent-core 自带 JsonlSessionRepo(原计划纯自研 sessions.mjs) | 不重复造轮子(约束);若其树状模型与 runTutorTurn 线性 messages 不兼容再回退自研薄层并再记偏离 |

## 与 L3/L4 对齐校验

全部 Phase 的 FEAT 出自 alignment.md;路径符合 AI_README.md 目录规范。✓
