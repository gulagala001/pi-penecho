# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 这是什么

**pi-penecho**:PenEcho 白板(localhost:3888)↔ 常驻 pi agent 的本地桥。学生白板手写 → agent(会话记忆 + persona + 工作区文件工具)→ 板书 JSON。无构建步骤,ESM,Node ≥20。

## 常用命令

```bash
npm start                   # 起桥(127.0.0.1:9191)
npm run check               # 全部源码语法检查(改完必跑)
npm run smoke               # 冒烟:pi+端点最小调用
npm run test:bridge         # 全链路:模拟 PenEcho 请求,验证契约+工具+记忆
node scripts/payload-debug.mjs   # LLM 输出排查(dump payload+事件流)
tail -f bridge.log          # 运行日志
# 重启桥:
kill $(lsof -tnP -iTCP:9191 -sTCP:LISTEN) && nohup node src/server.mjs > bridge.log 2>&1 &
```

## 架构

```
src/server.mjs   HTTP 路由:/(控制台)、/config、/profiles、/config/fetch-models、/session/*(多会话)、/pair/*(配对)、/sync/folders、/v1/messages
src/bridge.mjs   核心:agent 单例、resolveModel、runTutorTurn(gen 代际+abort+480s 看门狗)、会话管理(hardReset/replaceMessages/入档钩子)、公式落档兜底
src/sessions.mjs 多会话:JsonlSessionRepo 薄层(pi-agent-core 复用);增量入档+切换回放+persona 随会话+启动恢复;存档 ~/.pi-penecho/sessions/
src/config.mjs   配置 v2:profiles(多端点)+ persona + 通用项;~/.pi-penecho/config.json(600),旧版自动迁移
src/prompt.mjs   persona 加载(personas/*.md + ~/.pi-penecho/personas/)、frontmatter 解析、画布契约注入、workspace CLAUDE.md 热加载
src/tools.mjs    createWorkspaceTools(workspace):4 个文件工具,safeResolve 防逃逸;无 workspace → 零工具
personas/*.md    内置角色(frontmatter: name/description/workspace;正文支持 {{canvasContract}} {{boardFontSize}} {{workspace}})
public/admin.html 控制台(原生 JS,formTouched 防轮询冲表单)
```

**请求流**:`POST /v1/messages` → 无图透传上游 / 带图进 `runTutorTurn` → 系统提示 = persona 装配 + 画布契约(PenEcho 请求 system 字段捕获,canvasSystemRef 缓存)→ agent.prompt(text, images) → 回应提取(**优先 submit_board 工具参数**,文本抠 JSON 兜底,失败重试一次)→ 包装 anthropic 响应。并发:单 agent 串行,`gen` 代际 + `agent.abort()` 实现 PenEcho supersede 语义;改这段小心 waitForIdle 死锁。

**结构化输出(双通道)**:agent 注册了 `submit_board` 工具(intent/observedText/message/commands schema,constrainedSampling prefer),调用后 afterToolCall `terminate:true` 立即停轮。官方 Kimi 端点实测稳定;**中转站可能空调用({})**——所以提取时校验 `capturedBoard.intent` 非空才采信,否则退回文本抠 JSON。两条通道都不能删。

**配置流**:控制台 POST /config|/profiles → saveConfig + applyRuntime(不重建 agent,保会话);文件外部改动 → 每轮请求前 hotReload(mtime)。

## 血泪教训(别再踩)

- **AGP jniLibs 只打包 *.so 后缀**:`libz.so.1`/`libcrypto.so.3` 这类带版本后缀的库会被静默丢弃!要 exec 的二进制伪装成 `lib*.so` 进 jniLibs(+`useLegacyPackaging=true`),但**依赖库走 assets 解压到 files/**,`LD_LIBRARY_PATH` 指过去(exec 需要 nativeLibraryDir,dlopen 只需 files 可读)。
- **Android 14 模拟器系统代理劫回环**:`HttpURLConnection` 默认走系统代理,127.0.0.1 请求被发去 10.0.2.2;探测本机服务必须 `openConnection(Proxy.NO_PROXY)`。
- **明文 HTTP 要 manifest 显式放行**:`usesCleartextTraffic="true"`,否则 `Cleartext HTTP traffic not permitted`(回环也拦)。
- **.deb 在 Mac 用 bsdtar 解**(tar -xf),系统 `ar` 不认;Termux 的库与 CLI 分包(如 libsqlite ≠ sqlite)。
- **node 24(Termux deb)依赖 9 个库**:libz.so.1、libcares.so、libsqlite3.so、libcrypto.so.3、libssl.so.3、libicudata/i18n/uc.so.78、libc++_shared.so;PT_INTERP=/system/bin/linker64,无 proot 可直连(已验证,见 plan P1)。
- **syncthing folder.type 是文件夹级不是设备级**:「A 设备双向、B 设备只收」同一 folder 做不到。配对确认时的方向选择必须写回 sync-folders.json 注册表(单一事实源),pairMap 永远读注册表。
- **syncthing 共享文件夹前设备必须先注册**:`POST /config/devices` 加对端,folder.devices 才能引用;只写 folder 不注册设备 = 永远连不上(connections 为空)。
- **已配对设备重新 redeem 必须短路**(alreadyPaired 直接放行去同步设置):否则轮询把历史 peers 误判成本轮确认,reject 对老设备静默失效。
- **模拟器 NAT 隔离 syncthing discovery**:两端互不可见,验收时手机端 Mac 设备地址手动改 `tcp://10.0.2.2:22000`;真机同 WiFi 用 dynamic 不受影响,不要为模拟器改产品代码。
- **Electron 子进程跑 Node 脚本**:`spawn(process.execPath, [entry], {env:{ELECTRON_RUN_AS_NODE:"1"}})` = 内嵌 node,干净机器零依赖;桥/白板/syncthing 三服务同哲学退避重拉,已在跑的(launchd)复用不重起。
- **electron-builder 的 files 是允许清单**:dist/ 只放行了 index.html+APK,手机端探测的 /setup.sh 没带 → 探测路径一律用 `/`(index.html 恒在);物料多就 `asar:false` 散装,路径直给不折腾 unpack。
- **Mac 上多个 Electron app 互相抢 activate**:验收脚本按 bundle id 置前(`bundle identifier is "com.pi-penecho.desktop"`),按名字必抢错。
- **syncthing config.xml 第一个 `<device>` 不是本机**:接受过对端设备后顺序会变,本机 ID 永远走 REST `/rest/system/status` 的 myID(PairManager 曾因此把 Mac 加成自己的对端)。
- **全新 syncthing 上 confirm 必缺 folder**:folder 落地(ensureSyncFolders)要在桥启动时+confirm 前各跑一次,否则「设备加了、共享 missing」。
- **「Provider is not configured」= key 为空,不是网络问题**:pi-ai 的 applyAuth 在 overrides.apiKey 为空且 env 无 KIMI_API_KEY 时抛此错,assistant 消息 stopReason=error 原样进会话——空输出排查先看 bridge.log 的 [tutor][debug] lastMsg。
- **模拟器 adb 杀 app 留孤儿进程**:kill 端口进程后 libnode_exec 可能残留占 9191,新桥 EADDRINUSE 崩溃循环;验收清场用 `kill -9 $(ps -A | grep libnode_exec)`(真机 force-stop/升级由系统杀全进程组,无此问题)。

- **0.0.0.0 不能进浏览器**:PenEcho 启动日志的 `http://0.0.0.0:3888` 是监听声明,系统代理会 502。访问永远用 `localhost:3888`。
- **角色边界必须写死**:不约束时 agent 会把职责文件(CLAUDE.md)当板书素材抄给学生。persona 里的边界段不许删。
- **thinkingLevel 别上 high**:实测单轮 15 分钟。medium≈15 秒。
- **中转端点 + 非内置模型两个坑**:① resolveModel 兜底构造时 maxTokens 必须 ≤32768(k3 的 131072 会 400);② galaihub 的 kimi-k2.7-code 在 effort=low 下输出全进 thinking、text 为空(官方端点正常)——该模型只能 medium/high/max。
- **"讲完没落档"是头号历史投诉**:bridge.mjs 的 LATEX_RE 兜底(≥3 处公式未写文件→追加补写轮)和 persona 铁律是双保险,改动时两个都要保住。
- **JsonlSessionRepo.create 直接返回 Session**:别再 open 一遍(open 要 metadata 带 path,传 Session 会崩 `exists(undefined)`);list() 返回的才是 metadata。
- **多会话三条已知限制**(sessions.mjs 注释):undo 后 jsonl 残留被撤销条目;存档图像占位化(文字/板书才是记忆);双端勿同时聊同一会话(syncthing conflict 副本不丢但分叉)。
- 长期记忆=文件,会话只是工作台。需要跨重启保留的东西走配置文件,不走会话。

## 外部依赖方

- **PenEcho**(npm 全局):配置 `~/.penecho/config.env`(AI_API_URL 指本桥,AI_TIMEOUT_SECONDS=300,PENECHO_AI_IMAGE_FORMAT=png)。别改 PenEcho 源码(升级会覆盖)。
- **pi**(npm:`@earendil-works/pi-ai` + `pi-agent-core`):provider 用 kimi-coding(anthropic-messages);模型对象可在 catalog 基础上覆盖 baseUrl/contextWindow/maxTokens。
- **Kimi key**:配置在 config.json 的 profile.apiKey;环境 KIMI_API_KEY/ANTHROPIC_AUTH_TOKEN 仅首次兜底。注意 fanbox 会话外普通终端没有 ANTHROPIC_AUTH_TOKEN。
