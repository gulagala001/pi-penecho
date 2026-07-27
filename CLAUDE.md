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
src/server.mjs   HTTP 路由:/(控制台)、/config、/profiles、/config/fetch-models、/session/*、/v1/messages
src/bridge.mjs   核心:agent 单例、resolveModel、runTutorTurn(gen 代际+abort+480s 看门狗)、会话管理、公式落档兜底
src/config.mjs   配置 v2:profiles(多端点)+ persona + 通用项;~/.pi-penecho/config.json(600),旧版自动迁移
src/prompt.mjs   persona 加载(personas/*.md + ~/.pi-penecho/personas/)、frontmatter 解析、画布契约注入、workspace CLAUDE.md 热加载
src/tools.mjs    createWorkspaceTools(workspace):4 个文件工具,safeResolve 防逃逸;无 workspace → 零工具
personas/*.md    内置角色(frontmatter: name/description/workspace;正文支持 {{canvasContract}} {{boardFontSize}} {{workspace}})
public/admin.html 控制台(原生 JS,formTouched 防轮询冲表单)
```

**请求流**:`POST /v1/messages` → 无图透传上游 / 带图进 `runTutorTurn` → 系统提示 = persona 装配 + 画布契约(PenEcho 请求 system 字段捕获,canvasSystemRef 缓存)→ agent.prompt(text, images) → 抠 JSON(失败重试一次)→ 包装 anthropic 响应。并发:单 agent 串行,`gen` 代际 + `agent.abort()` 实现 PenEcho supersede 语义;改这段小心 waitForIdle 死锁。

**配置流**:控制台 POST /config|/profiles → saveConfig + applyRuntime(不重建 agent,保会话);文件外部改动 → 每轮请求前 hotReload(mtime)。

## 血泪教训(别再踩)

- **0.0.0.0 不能进浏览器**:PenEcho 启动日志的 `http://0.0.0.0:3888` 是监听声明,系统代理会 502。访问永远用 `localhost:3888`。
- **角色边界必须写死**:不约束时 agent 会把职责文件(CLAUDE.md)当板书素材抄给学生。persona 里的边界段不许删。
- **thinkingLevel 别上 high**:实测单轮 15 分钟。medium≈15 秒。
- **中转端点 + 非内置模型两个坑**:① resolveModel 兜底构造时 maxTokens 必须 ≤32768(k3 的 131072 会 400);② galaihub 的 kimi-k2.7-code 在 effort=low 下输出全进 thinking、text 为空(官方端点正常)——该模型只能 medium/high/max。
- **"讲完没落档"是头号历史投诉**:bridge.mjs 的 LATEX_RE 兜底(≥3 处公式未写文件→追加补写轮)和 persona 铁律是双保险,改动时两个都要保住。
- 长期记忆=文件,会话只是工作台。需要跨重启保留的东西走配置文件,不走会话。

## 外部依赖方

- **PenEcho**(npm 全局):配置 `~/.penecho/config.env`(AI_API_URL 指本桥,AI_TIMEOUT_SECONDS=300,PENECHO_AI_IMAGE_FORMAT=png)。别改 PenEcho 源码(升级会覆盖)。
- **pi**(npm:`@earendil-works/pi-ai` + `pi-agent-core`):provider 用 kimi-coding(anthropic-messages);模型对象可在 catalog 基础上覆盖 baseUrl/contextWindow/maxTokens。
- **Kimi key**:配置在 config.json 的 profile.apiKey;环境 KIMI_API_KEY/ANTHROPIC_AUTH_TOKEN 仅首次兜底。注意 fanbox 会话外普通终端没有 ANTHROPIC_AUTH_TOKEN。
