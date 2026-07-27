# pi-penecho

把 [PenEcho](https://github.com/penecho/penecho) 手绘画板接到一个**常驻 [pi](https://github.com/earendil-works/pi) agent** 上的本地桥——让白板上的 AI 真正"有记忆"。

你在白板上手写 → agent 看见你的笔迹、记得本节课之前每一轮、用板书回答(文字 / LaTeX 公式 / 函数图像 / 手绘),还能读写你指定的工作区文件。

```
PenEcho(API 模式)──→ pi-penecho(:9191)──→ Anthropic 兼容端点
                          │
                          └─ 常驻 pi agent(内存会话)
                             ├─ persona 系统(Markdown 定义角色)
                             ├─ 工作区文件工具(read/write/append/list)
                             └─ 画布契约 → 板书 JSON 指令
```

## 为什么

PenEcho 自带的执行器是单轮的:每次请求独立,AI 只看得到当前画面。问答够用,协作不够。pi-penecho 把后端换成有状态的 agent:

- **会话记忆**:一整个工作 session 是同一场对话——它记得讲过什么、你哪错了、上次停在哪儿。
- **Persona 系统**:AI 的角色就是一个 Markdown 文件(`personas/*.md`)。考研家教、通用白板伙伴、或者你自己写的任何角色,一键切换。
- **工作区工具**:persona 可以声明 `workspace` 目录,agent 获得限定在该目录的 `read_file` / `write_file` / `append_file` / `list_dir`。**长期记忆放文件,会话只是工作台。**
- **多端点 profiles**:任意 Anthropic 兼容端点(Kimi 官方、中转站等),存成可切换的 profile;模型列表从端点 `/v1/models` 直接拉。
- **控制台 UI**:`http://localhost:9191`——状态、端点/模型配置、persona 选择、会话管理(新建对话/撤销上轮)、最近轮次。

## 快速开始

需要:Node.js 20+、[PenEcho](https://github.com/penecho/penecho)(`npm i -g penecho`)、一个 Anthropic 兼容端点的 API key。

```bash
git clone https://github.com/gulagala001/pi-penecho.git
cd pi-penecho
npm install
npm start          # 桥监听 127.0.0.1:9191
```

把 PenEcho 指向桥(`~/.penecho/config.env`):

```ini
AI_PROVIDER=api
AI_API_FORMAT=anthropic
AI_API_URL=http://localhost:9191
AI_API_KEY=<你的 key>          # 透传请求用
AI_API_MODEL=k3                # 非空即可,真实模型在控制台里选
AI_TIMEOUT_SECONDS=300
PENECHO_AI_IMAGE_FORMAT=png
```

跑 `penecho`,打开 **http://localhost:3888**(别用 `0.0.0.0`,见 FAQ),控制台开 **http://localhost:9191**。

## Persona

persona 是带 frontmatter 的 Markdown:

```markdown
---
name: 我的角色
description: 控制台里显示的描述
workspace: /绝对路径   # 可选;声明后 agent 获得限定此目录的文件工具
---
你是……(系统提示正文;{{canvasContract}}、{{boardFontSize}} 会被替换)
```

- 内置在 `personas/`(`general` 通用助手、`kaoyan-tutor` 考研家教示例)。
- 自定义 persona 放 `~/.pi-penecho/personas/`,不动 repo 即可生效。
- workspace 里若有 `CLAUDE.md`,全文自动附加进系统提示并热更新。

## 配置

`~/.pi-penecho/config.json`(600 权限,外部改动热加载)。所有字段控制台里也能改:

| 字段 | 说明 |
| --- | --- |
| profiles | 命名端点配置:`apiUrl`、`apiKey`、`model`、`contextWindow`/`maxTokens`(空=自动) |
| persona | 当前 persona id |
| thinkingLevel | 推荐 `medium`;`high` 单轮可达十几分钟 |
| keepImages | 会话里保留最近几张白板图(更早的剪成文字占位) |
| boardFontSize | 板书字号偏好 |

## 脚本

```bash
npm run check        # 全部源码语法检查
npm run smoke        # 最小调用冒烟(文本/图像/记忆)
npm run test:bridge  # 全链路:模拟 PenEcho 请求 → JSON 契约 → 工具 → 记忆
node scripts/payload-debug.mjs   # dump pi 原始请求与事件流(LLM 排查)
```

## FAQ / 踩坑记录

- **"网页打不开 / 502"**:你访问的是 `http://0.0.0.0:3888`。那是监听声明不是可访问地址,系统代理会 502。用 `http://localhost:3888`。
- **中转端点 + 自定义模型 id**:不在内置目录的模型按 k3 模板构造,但 `maxTokens` 会压到 ≤32768(否则中转站拒绝 131072)。另外实测某中转的 `kimi-k2.7-code` 在 `low` 档输出全进 thinking(text 为空),该模型请用 `medium`/`high`/`max`。
- **长期记忆属于文件**。桥重启会话即清;带 workspace 的 persona 应该把重要的东西写进工作区(内置考研家教就是这么设计的)。

## License

MIT。PenEcho 是 AGPL(独立项目,本桥通过 HTTP 使用它);pi 是 MIT。
