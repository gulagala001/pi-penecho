# 平板端安装指南(pi-penecho)

> **极简入口(推荐)**:https://gulagala001.github.io/pi-penecho/
> 本文档是完整版说明 + 故障排查存档。

pi-penecho 让你在平板上拥有一个**有记忆的白板智能体**:手写提问,它板书回答;它的档案、笔记和你的设置(API key、人设)通过 Syncthing 在**电脑端 ↔ 平板端**之间自动保持一致。

## 两端模型

| 端 | 构成 | 状态 |
|---|---|---|
| **电脑端**(Mac) | 桥 + PenEcho 白板服务 + Syncthing 同步端 | 已常驻运行;控制台 http://localhost:9191 |
| **平板端** | Termux(发动机:跑与电脑端相同的服务)+「PenEcho 白板」app(全屏窗口) | 三步装好 |

## 平板端三步

**① 装发动机(Termux)** — [直链下载](https://github.com/gulagala001/pi-penecho/releases/latest/download/termux.apk)(镜像自 termux/termux-app v0.118.3,GPL 开源),装完不用打开。

**② 初始化** — 打开 Termux 粘贴一行,回车,等「平板端安装完成」:
```bash
curl -sL https://github.com/gulagala001/pi-penecho/releases/latest/download/setup.sh | bash
```

**③ 装白板 app** — [直链下载](https://github.com/gulagala001/pi-penecho/releases/latest/download/PenEcho-board.apk)。

## 配对(电脑端,一次)

两端连同一 WiFi。Mac 控制台(http://localhost:9191)→「平板配对」卡片 → **配对平板**。
(等价命令行:`bash scripts/pair-tablet.sh`)

配对后自动同步:
- **资料/记忆文件夹**(示例 id `kaoyan-new`,即本机的 `~/Projects/考研new`)→ 平板 `~/Projects/考研new`;只带 md/txt 等文字档案(约 5MB),PDF/图片/视频按 `.stignore` 规则留电脑端
- **配置文件夹**(`pi-penecho-config`,即 `~/.pi-penecho`)→ 平板 `~/.pi-penecho`:API key、persona、模型设置随之到位,**平板免配置**

> fork 本项目做自己的部署时:资料夹 id/路径在 `scripts/install-syncthing-mac.sh`(SYNC_DIR)、`termux/pair-accept.sh`(PENECHO_DIR_KAOYAN)、`src/pair.mjs`(PENECHO_PAIR_FOLDERS)三处改。
> 配置改动请固定在一端进行(推荐电脑端控制台),几秒同步到另一端并热加载;两端同时改同一配置可能产生冲突副本。

## 日常使用

- 平板:点「PenEcho 白板」图标即用;右下角 ≡ 小球 = 控制台 / 回白板 / 刷新
- 平板重启后:打开一次 Termux 服务自动恢复(.bashrc 幂等启动);或装[开机自启插件 Termux:Boot](https://github.com/gulagala001/pi-penecho/releases/latest/download/termux-boot.apk)
- 电脑端一切照旧,两端记忆实时一致

## 防杀后台(建议设一次)

设置 → 应用 → **Termux** → 电池 → **「无限制」**;最近任务界面给 Termux 卡片**加锁**。
不设也能用,只是服务可能数小时后被系统停掉——重开 Termux 即恢复。

## 故障排查

**白板一直「正在连接白板服务」**:Termux 里跑 `~/penecho-mobile/start.sh` 看报错;日志 `tail -50 ~/penecho-mobile/logs/bridge.log`

**配对没反应**:确认同一 WiFi;平板重跑 `bash ~/penecho-mobile/pair-accept.sh`;电脑端重按「配对平板」。Syncthing 控制台:http://127.0.0.1:8384

**智能体不回应**:≡ → 控制台查 key;`bridge.log` 看报错

**更新**:重跑第②步命令(配置与档案保留);白板 app 用新 APK 覆盖安装

## 卸载

平板:Termux 里 `~/penecho-mobile/stop.sh`,卸载 Termux 与白板 app。电脑端:Syncthing 控制台移除平板设备。
