# AI_README.md

> **每个 AI 进项目读的第一个文件。** 架构 + 目录规范唯一真相源。
> 阅读顺序:本文件 → CLAUDE.md(血泪教训) → INTENT.md(L1) → alignment.md(L2) → blueprint.md(L3) → plan.md(L5)

---

## 项目概述

**pi-penecho**:有记忆的白板智能体系统。PenEcho 手写白板 ↔ 常驻 pi agent(会话记忆+persona+工作区文件工具)↔ Anthropic 兼容端点(Kimi)。形态:**电脑端**(Mac,Electron 目标)+ **手机端**(安卓单 APK 目标),局域网 Syncthing 双端同步记忆与配置。当前生产形态:bash 桥(9191)+全局 penecho(3888)+安卓 Termux 套件;正向 L1 终极形态演进。

## 总体架构

```
电脑端: PenEcho(3888) → 桥(9191, agent 单例+会话层) → Kimi;Syncthing(8384);安装门户(9288)
手机端: 白板 app(WebView→127.0.0.1:3888) + 同构桥/同步(目标:全部内嵌单 APK)
桥请求流: /v1/messages → 无图透传 / 带图 runTutorTurn(gen 代际+abort+480s 看门狗)
        → submit_board 工具参数优先,文本抠 JSON 兜底 → 公式落档兜底(LATEX_RE)
```

## 目录规范

### 什么文件放哪里

| 路径 | 用途 | 例子 |
|------|------|------|
| `src/` | 桥核心源码(ESM) | server.mjs(路由) bridge.mjs(agent 核心) config.mjs prompt.mjs tools.mjs pair.mjs sessions.mjs(规划) |
| `personas/` | 内置角色(frontmatter:name/description/workspace) | kaoyan-tutor.md general.md |
| `public/` | 控制台前端(原生 JS) | admin.html |
| `scripts/` | 可执行脚本(bash/node) | build-termux-bundle.sh build-apk.sh install-*.sh pair-tablet.sh emu/(规划:模拟器) |
| `android/` | 白板 app(Gradle 项目) | app/src/main/java/... MainActivity.java |
| `termux/` | 手机端 Termux 时代物料(过渡形态) | setup.sh pair-accept.sh |
| `docs/` | GitHub Pages 源 | index.html |
| `dist/` | 构建产物(gitignore) | *.tar.gz *.apk index.html setup.sh |
| `desktop/` | (规划)Electron 电脑端 | main.mjs |
| 根目录规范文档 | L1-L5 + 说明 | INTENT.md alignment.md blueprint.md plan.md AI_README.md CLAUDE.md README*.md |

### 根目录允许的文件

仅以下文件,禁止新增其他散落文件(脚本归 scripts/,文档归对应层):

`AI_README.md`、`CLAUDE.md`、`INTENT.md`、`intent_log.md`、`alignment.md`、`blueprint.md`、`plan.md`、`README.md`、`README.zh-CN.md`、`README.termux.md`、`LICENSE`、`package.json`、`package-lock.json`、`bridge.log`(运行日志,gitignore)、`.gitignore`

### 目录对齐校验

`dist/`、`node_modules/`、`android/.gradle/`、`android/app/build/` 均为生成物,不入 git、不写文档引用其内部。

### 禁止放的路径

- 根目录新建 `*.sh`/`*.mjs`(归 scripts/ 或 src/)
- 任何含 API key 的文件(配置只在 `~/.pi-penecho/`,永不入项目)
- `android/app/src/main/assets/termux.apk`(33M 二进制,构建时从 dist/ 取)
- `personas/` 外的 persona 定义(用户私人在 `~/.pi-penecho/personas/`)

## 命名规范

- 源码:`kebab-case.mjs`(bridge.mjs) / `lower-single.mjs`(tools.mjs)
- 脚本:`动词-名词.sh`(build-apk.sh / install-*.sh)
- FEAT ID:L2 统一分配,L3/L5/提交信息引用同一 ID
- 提交信息:中文,`主题: 要点`(必要时列点),禁散弹式多主题单提交

## 关键文件索引

| 关注点 | 文件 |
|--------|------|
| 请求流/agent 核心 | src/bridge.mjs(249 行,runTutorTurn 在 185) |
| 保命逻辑清单 | CLAUDE.md「血泪教训」段(禁删区) |
| 配对 | src/pair.mjs + scripts/pair-tablet.sh |
| 会话(规划) | src/sessions.mjs ↔ blueprint FEAT-3.2.1 |
| 单 APK | android/ + scripts/build-apk.sh + blueprint FEAT-1.1.1 |
| 同步注册表 | ~/.pi-penecho/sync-folders.json(契约见 blueprint FEAT-3.1.1) |

## 技术栈(从 L3 提取)

Node 24 ESM / esbuild / 原生 Java(Android) / Electron(规划) / Syncthing v2 / 官方 Android Emulator / 无前端框架。

## 快速启动

```bash
npm ci                 # 装依赖
npm run check          # 语法全检(改完必跑)
npm start              # 桥 127.0.0.1:9191
npm run test:bridge    # 全链路(模拟 PenEcho 请求,真调 LLM)
bash scripts/install-mac.sh        # 电脑端一键(含常驻)
bash scripts/build-termux-bundle.sh # 手机 Termux 包(过渡形态)
bash scripts/build-apk.sh           # 白板 APK
```

## 变更日志

| 时间 | 摘要 |
|------|------|
| 2026-07-29 | 初始化:L4 建立,收录现行目录;标注规划目录(desktop/、sessions.mjs、scripts/emu/) |
