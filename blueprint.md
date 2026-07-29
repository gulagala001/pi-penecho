# 实现总纲(L3)

> 只画方案不发明功能;每个 FEAT 给接口+数据流+错误路径。

---

## 功能实现映射

### FEAT-0.0.1 模拟器测试基建(先行,验收之母)
- **接口**:`scripts/emu/{up,shot,ui,install}.sh`(起停 AVD/截图/UI dump/装 APK);AVD `test`(android-34, google_apis, arm64-v8a)
- **数据流**:sdkmanager 镜像 → avdmanager create → emulator(无头)→ adb 操作 → 截图/断言进验收脚本
- **错误路径**:镜像下载失败→重试 3 次;hvf 不可用→降级 `-accel off`(慢 5 倍仍可用);模拟器网络=10.0.2.0/24,**host 电脑固定为 10.0.2.2**,子网发现逻辑须内置该地址(见 FEAT-1.2.1)

### FEAT-1.1.1 app 内嵌 Node 拉起服务(胜负手)
- **接口**:`EngineBoot.start(context)`:解压/校验 rootfs → `exec(nativeLibDir/libnode_exec.so, ["bridge/server.mjs"], env)`;服务就绪回调 `onReady(bridgeHealth, boardUrl)`
- **数据流**:assets/rootfs.tar.gz(nodejs-lts 24.18.0 deb 提取的 node+依赖 .so、bundle<桥单文件+penecho>、syncthing android-arm64 静态二进制、busybox、启动脚本)→ 首启解压 `files/rootfs` → exec node(env:`HOME/PREFIX/LD_LIBRARY_PATH=nativeLibDir,PATH`)→ node 跑 `bridge/server.mjs`(9191)与 `penecho/server.js`(3888)同进程组 → 127.0.0.1 监听
- **打包**:node/proot 等可执行文件命名 `lib*.so` 入 `jniLibs/arm64-v8a/`;`packagingOptions.jniLibs.useLegacyPackaging=true`(extractNativeLibs,否则无文件路径可 exec)
- **错误路径**:①exec EACCES(ROM 收紧)→ 回退 proot(伪装同法,`proot -r rootfs` 提供前缀视图)②deb 依赖缺失→`LD_LIBRARY_PATH` 全量带上 deb 内全部 .so ③Android 14 限制子进程→主服务进程即 app 进程 fork 的子进程,纳入同一 ForegroundService 管辖
- **不选 proot 直连的依据**:ELF `PT_INTERP=/system/bin/linker64` 系统自带;`DT_NEEDED` 仅 soname,ld 按 `LD_LIBRARY_PATH` 解析;Node 运行不读 Termux 前缀资源。spike 先行验证,失败再引入 proot

### FEAT-1.1.2 前台保活与自恢复
- **接口**:`EngineService extends Service`(foregroundServiceType=`dataSync`,通知「白板服务运行中」);`onDestroy/onTaskRemoved → 重启策略`
- **数据流**:app 启动→bind/start EngineService→服务进程组挂靠;app 回到前台→health 探测→死亡则 `EngineBoot` 重启
- **错误路径**:服务被系统杀→app 下次前台 30s 内重启服务;持久保活依赖厂商白名单(引导页提示一次,不阻断)

### FEAT-1.2.1 首启引导状态机
- **接口**:状态 `ENGINE_BOOT → DISCOVER → PAIR_INPUT → PAIR_WAIT → READY`;每态一屏
- **数据流**:装 APK 首启→EngineBoot→子网发现(扫 /24 + **内置 10.0.2.2** 兼容模拟器)→显示 6 位码输入→POST redeem→轮询确认→就绪进白板
- **错误路径**:发现失败→手动输电脑 IP;码错/过期→明确提示可重输;等待超时→重新发起

### FEAT-1.2.2 全屏白板与内嵌控制台
- 现状:v1.1 已实现(WebView 全屏+浮动 ≡ 菜单+无浏览器元素),保留;一体化后服务地址不变(127.0.0.1)

### FEAT-2.1.1 Electron 桌面 app
- **接口**:双击 .app → 主进程拉起 桥(9191)+PenEcho(3888)+syncthing(resources 内二进制 spawn)+安装门户(9288);窗口加载控制台
- **数据流**:`desktop/main.mjs`:`app.whenReady → initBridge(import server.mjs 逻辑) → startPenEcho(require vendor server.js, env 注入) → spawnSync(re packagedResources) → createWindow(admin)`;打包 electron-builder(asar;penecho vendor 纯 JS 无 node_modules;icon;dmg)
- **错误路径**:端口被占(旧 bash 服务在跑)→检测 /health 特征,复用 or 提示退出旧实例;asar 内 fs 资源(admin/personas)经 Electron 补丁可读(已验证模式);syncthing home 用 `~/Library/Application Support/pi-penecho/syncthing`(与 bash 版隔离,迁移文档说明)
- **与 bash 版关系**:Electron 为最终形态;bash 脚本(install-mac.sh 等)保留为高级用户备选,README 标注

### FEAT-2.1.2 首次运行向导
- **接口**:无 key 检测(config.apiKeyMasked==null)→ 向导页(填 key→验证→生成手机安装二维码)
- **错误路径**:key 验证失败→留在向导;跳过→可控制台后补

### FEAT-2.2.1 配对码状态机(电脑端,src/pair.mjs 扩展)
- **接口(HTTP)**:
  - `POST /pair/code` → `{code, expiresAt}`(6 位数字,内存存 {value, expiresAt},10 分钟)
  - `POST /pair/redeem` `{code, deviceId, deviceName}` → 校验→`pending.set(deviceId,{name,at})` → `{ok:true,pending:true}`;错码/过期 `{ok:false,error}`
  - `GET /pair/status` → `{peers[], pending[], folders[]}`(pending 供控制台确认列表)
  - `POST /pair/confirm` `{deviceId, folders:[{id, direction}]}` → syncthing 加设备+按 direction 共享(both=sendreceive/send=sendonly/receive=receiveonly)
  - `POST /pair/reject` `{deviceId}`
  - `GET /pair/map?deviceId=` → `[{id, tabletPath, type}]`(手机端接受用;type=镜像方向:电脑 sendonly→手机 receiveonly)
- **数据流**:控制台生成码→手机 redeem→pending→电脑确认(勾选)→syncthing REST 写配置→手机轮询 map 接受→同步建立
- **错误路径**:码过期自动作废;重复 redeem 幂等;confirm 时文件夹缺失→返回 missing 列表;单新设备限制(多设备候选→控制台列表选择)

### FEAT-2.2.2 手机端配对页
- **接口**:app 内「配对电脑」屏:发现的电脑列表+6 位码输入+状态(待确认/成功/失败原因)
- **数据流**:读本机 syncthing deviceID(一体化后同文件系统直读 `~/.config/syncthing/config.xml`)→ redeem→轮询 `/pair/status` 直到自己消失于 pending(=已确认)→拉 `/pair/map` → syncthing REST 接受文件夹(落点+type)
- **错误路径**:syncthing 未就绪→等待重试;拒绝→显示并允许重新输码

### FEAT-2.2.3 文件夹与方向勾选
- 控制台确认对话框:复选文件夹(来自注册表)+每行方向下拉(双向/电脑→平板/平板→电脑);写入 syncthing folder type;映射表同步下发

### FEAT-2.3.1 陌生人级 README/向导
- 以「零前提新用户」视角重写:每步有预期画面;无未定义名词;模拟器截图佐证关键步

### FEAT-3.1.1 同步文件夹注册表
- **接口**:`~/.pi-penecho/sync-folders.json`:
  ```json
  { "folders": [{ "id": "kaoyan-new", "label": "考研new", "persona": "kaoyan-tutor",
    "macPath": "~/Projects/考研new", "tabletPath": "~/Projects/考研new",
    "direction": "both", "enabled": true }] }
  ```
  控制台「项目与同步」页 CRUD
- **数据流**:桥启动/保存时 `ensureSyncFolders()`:对 enabled 项在 syncthing 创建/更新 folder(path 展开 ~,type=direction);pair map 依此下发
- **错误路径**:macPath 不存在→跳过并 warn;与既有 kaoyan-new/pi-penecho-config 两 folder 兼容(迁移:首次启动若配置缺失,自动生成含这两项的注册表)

### FEAT-3.1.2 手机端映射落位
- 见 FEAT-2.2.2 数据流尾段;落点按 `/pair/map` 的 tabletPath(以 ~ 相对,手机端展开为 app 私有 home)

### FEAT-3.2.1 会话存档/读档层(核心手术,保守设计)
- **接口(src/sessions.mjs 新增)**:
  - `listSessions()` → `[{id,name,persona,createdAt,updatedAt}]`(读 `~/.pi-penecho/sessions/index.json`)
  - `createSession(persona,name?)` / `switchSession(id)` / `renameSession(id,name)` / `deleteSession(id)`
  - 内部:`saveCurrent()`(当前 agent.state.messages 图像占位化后落盘 `sessions/<id>.json`)+ `loadInto(id)`(abort→gen++→重置 agent.state(messages/tools/persona 应用))
- **数据流**:HTTP `/session/list|new|switch|rename|delete`(server.mjs 路由扩展)→ sessions.mjs → **复用既有单 agent**:`switch` = 存档当前+清空 agent.state+读档目标+`applyRuntime(persona)`;`runTutorTurn` 零改动(仍操作当前 agent,gen 代际继续防飞)
- **关键保留**:runTutorTurn 轮次逻辑/submit_board 双通道/LATEX_RE 落档兜底/gen+abort 打断语义——全部不动(见 ADR-2)
- **错误路径**:存档写盘失败→切换中止不丢当前;读档 JSON 损坏→新空会话+原文件改名 .corrupt 保留;并发切换(gen 全局递增天然互斥)

### FEAT-3.2.2 会话切换 UI
- 控制台「会话」卡升级为列表(当前高亮)+新建/重命名/删除;手机端 ≡ 菜单加「会话…」跳控制台同页

---

## 架构决策记录

| ID | 决策 | 选项 | 理由 |
|----|------|------|------|
| ADR-1 | 单 APK 用「Termux deb 提取 + jniLibs 伪装 + LD_LIBRARY_PATH 直连」,不引 proot(首选) | A 直连(选) / B proot / C nodejs-mobile(Node 18,pi-ai 要求 ≥22 否决) / D 维持 Termux(违背 L1#1) | 无现成轮子中链路最短;proot 仅在 exec 受限 ROM 作回退;C 版本硬伤 |
| ADR-2 | 多会话用「存档/读档薄层」复用单 agent,不重构 runTutorTurn | A 薄层(选) / B 会话多实例注册表(内存×N、abort 语义重写) | 保住全部血泪教训(双通道/落档兜底/gen 语义);B 风险大收益仅是省切换重建毫秒 |
| ADR-3 | 配对「手机输码发起+电脑确认」,取代「电脑发现手机」 | A 码+确认(选) / B 仅自动发现 | 用户指定形态;码提供带外认证(同 WiFi 陌生人无法偷偷配对);发现仍作辅助(候选列表) |
| ADR-4 | 电脑端 Electron,不选 Tauri/原生壳 | A Electron(选) / B Tauri(需 Rust 链+sidecar 复杂度) / C Swift 壳(仅 Mac,Node 侧车) | 同构 JS 栈复用 server.mjs/桥全部代码;团队(单人)维护成本最低;体积 250MB 可接受 |
| ADR-5 | 同步仅 Syncthing 局域网直连,不自建同步协议 | A Syncthing(选) / B 自建 | 轮子成熟(TLS/增量/方向三态);边界已声明不做云 |

## 风险登记

| ID | 风险 | 等级 | 缓解 |
|----|------|------|------|
| RISK-1 | 部分 ROM 禁止 app 私有库目录 exec 或杀子进程 | 高 | spike 先行+proot 回退预案;真机矩阵(用户平板+模拟器) |
| RISK-2 | Android 14 前台服务类型/通知权限收紧致保活失效 | 中 | 声明 dataSync 类型+通知权限引导;被杀后前台 30s 自恢复兜底 |
| RISK-3 | Electron 首版体积与签名(Gatekeeper 未公证) | 低 | 文档「右键打开」;后续可公证 |
| RISK-4 | 会话存档含历史图像致文件膨胀 | 低 | 落盘前图像占位化(恢复后无需历史图) |
| RISK-5 | syncthing v2 API/config 结构再变(已遇 --home 变更) | 中 | 关键调用处版本探测+失败时引导 8384 手动兜底 |

## 技术栈总览

| 层 | 选型 | 说明 |
|----|------|------|
| 桥 | Node 24 ESM, esbuild 单文件 | 现状,不动 |
| 手机端 | 原生 Java Activity+WebView+ForegroundService;Node/同步二进制内嵌(Termux deb/syncthing 官方) | 单 APK |
| 电脑端 | Electron + electron-builder | 窗口=控制台 |
| 同步 | Syncthing v2(REST API) | 局域网直连 |
| 测试 | 官方 emulator(android-34 arm64)+adb+uiautomator | 验收自动化 |
| 前端 | 原生 JS(不引框架) | admin.html 延续 |

## 与 L2 对齐校验

全部 15 FEAT + 1 衍生均有方案;无 alignment.md 之外的 FEAT。✓

## 变更日志

| 时间 | 摘要 |
|------|------|
| 2026-07-29 | 初始化:5 ADR + 5 RISK + 全 FEAT 三件事 |
