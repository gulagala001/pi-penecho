# pi-penecho

一个能在白板上和你互动、**有记忆**的智能体。

你在 [PenEcho](https://github.com/penecho/penecho) 白板上手写 → 智能体看见你的笔迹、记得之前每一轮、用板书回答(文字 / LaTeX 公式 / 函数图像),还能读写你指定的工作区文件——长期记忆放文件,会话只是工作台。

**电脑 + 安卓手机/平板双端**:电脑端一个图形 app(macOS / Windows),手机端一个 APK(白板、智能体发动机、同步全内置),同一 WiFi 扫码配对,多个项目文件夹各自同步,项目内多会话可切换。

## 三步上手

### ① 电脑:下载 app,双击打开

从 [Releases](https://github.com/gulagala001/pi-penecho/releases/latest) 下载:
- **macOS**:`pi-penecho-x.y.z-mac-arm64.dmg`,拖进「应用程序」双击。首次打开若提示「未验证的开发者」:右键 app → 打开 → 打开。
- **Windows**:`pi-penecho-x.y.z-win-x64.exe`(安装版)或 `-win-x64.zip`(免安装,解压即用)。首次运行可能弹 SmartScreen →「更多信息」→「仍要运行」。

> 安装包未买平台签名,源码全公开可自查。

窗口里就是控制台。在「端点 Profile」卡选 API 格式、粘贴你的 API key → 保存。
支持三类端点:**Anthropic 兼容**(Kimi 等)、**OpenAI 兼容**(DeepSeek / OpenRouter / 各类中转,chat/completions)、**OpenAI Responses**(官方 GPT-5 系)。

### ② 手机/平板:扫码装 app

控制台「平板配对」卡有二维码 → 手机/平板相机扫码 → 下载安装 `PenEcho-board.apk`(43MB,发动机内置)→ 打开,等它就绪(首次约半分钟)。

> 没有电脑在身边时,手机也可直接访问 https://gulagala001.github.io/pi-penecho/ 下载。

### ③ 配对,开始同步

1. 控制台点「生成配对码」
2. app 右下角 **≡** → **配对电脑**(自动找到电脑)→ 输入 6 位码
3. 电脑上**确认配对**,勾选要同步的文件夹(记忆/讲义/配置)和方向(双向 / 仅电脑→平板 / 仅平板→电脑)

完成。白板上手写提问,智能体板书回答,记得你学过什么;手机端离开电脑也能独立使用(记忆已同步到本机)。

## 进阶

- **多项目**:控制台「同步文件夹」卡管理多个项目文件夹,每个项目有自己的 persona(角色)和工作区
- **多会话**:控制台「会话」卡按项目/主题开多个会话,随时切换;会话存档在本地,重启不丢
- **自定义角色**:persona 就是一个 Markdown 文件,放 `~/.pi-penecho/personas/` 即出现在控制台下拉框
- **手机端控制台**:app ≡ → 控制台,与电脑端同一个界面

## 常见问题

- **配对找不到电脑**:确认电脑 app 在运行、两端同一 WiFi;或在 app 里点「手动输入 IP」
- **配对码报错**:码 10 分钟有效、一次性,回电脑重新生成
- **文件夹不同步**:控制台确认文件夹已勾选;同步走 [Syncthing](https://syncthing.net)(开源、P2P、无云端),两端在线时自动进行
- **Mac app 无法打开**:系统设置 → 隐私与安全性 → 「仍要打开」

## 开发者

```bash
git clone https://github.com/gulagala001/pi-penecho.git
cd pi-penecho && npm install
npm start            # 桥 127.0.0.1:9191(控制台同址)
npm run check        # 语法门禁
npm run test:bridge  # 全链路冒烟(模拟白板请求)
npm run build:desktop  # 桌面物料(桥 bundle + penecho + syncthing)
npm run dist:desktop   # electron-builder 出 dmg
bash scripts/build-apk.sh  # 安卓 APK(需 Android SDK + 模拟器四件套 scripts/emu/)
```

架构与踩坑记录见 [CLAUDE.md](CLAUDE.md) 与 [plan.md](plan.md)。launchd 命令行常驻等过渡脚本归档在 `scripts/legacy/`(已被桌面 app 取代,仅备查)。项目规范文档:INTENT.md(意图)、alignment.md(对齐)、blueprint.md(蓝图)、AI_README.md(架构地图)。

## 许可与致谢

- 白板:[PenEcho](https://github.com/penecho/penecho)(AGPL-3.0)
- 智能体运行时:[pi](https://github.com/earendil-works/pi)
- 同步:[Syncthing](https://syncthing.net)(MPL-2.0)
- 本项目:AGPL-3.0(随 PenEcho)
