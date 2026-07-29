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
- status: todo

### Phase 2: 单 APK 成品化(手机端一体化)
- **FEAT**: FEAT-1.1.2
- **FEAT**: FEAT-1.2.1
- **FEAT**: FEAT-1.2.2
- 内容:rootfs 预制(node+bundle+syncthing+busybox+启动脚本);ForegroundService(dataSync+通知);首启引导状态机(装环境→发现电脑(内置 10.0.2.2)→输码位→就绪);子进程守护与自恢复
- exit_criteria:①模拟器冷装 APK→走完引导到白板页显示,全程无浏览器/终端元素(UI dump 断言)②`adb shell am force-stop` 重开后 30s 内 3888/9191 恢复 200 ③白板 app 内手写模拟请求经 9191 全链路(test:bridge 对模拟器实例)通过
- status: todo

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

## 偏离记录

(空——开工后一条一记,藏=违规)

## 与 L3/L4 对齐校验

全部 Phase 的 FEAT 出自 alignment.md;路径符合 AI_README.md 目录规范。✓
