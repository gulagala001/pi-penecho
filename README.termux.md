# 安卓平板安装指南

> **极简版入口(推荐)**: 在 Mac 或平板浏览器打开
> **https://gulagala001.github.io/pi-penecho/**
> 按页面上的 4 张卡片操作即可(含下载二维码和一键复制)。
> 本文档是完整版说明 + 故障排查存档。

装好后:点「PenEcho 白板」图标 → 全屏白板,手写提问,AI 板书回答。你的考研笔记、进度、API 设置通过 Syncthing 在 Mac 与平板间自动同步。

## 流程总览

| 步骤 | 动作 | 说明 |
|---|---|---|
| 1 | 装 Termux | [直链下载](https://github.com/gulagala001/pi-penecho/releases/latest/download/termux.apk)(镜像自 termux/termux-app v0.118.3,GPL 开源) |
| 2 | Termux 里粘贴一行命令 | `curl -sL https://github.com/gulagala001/pi-penecho/releases/latest/download/setup.sh \| bash` |
| 3 | 装白板 app | [直链下载](https://github.com/gulagala001/pi-penecho/releases/latest/download/PenEcho-board.apk) |
| 4 | 配对同步 | Mac 上跑 `bash scripts/pair-tablet.sh`(或让 Claude 代劳):自动发现平板并完成配对 |

配对后自动同步两个文件夹:
- `考研new` → 平板 `~/Projects/考研new`(md 记忆档案约 5MB;PDF/图片/视频按 .stignore 规则留 Mac)
- `pi-penecho 配置` → 平板 `~/.pi-penecho`(config.json,含 API key / persona / 模型设置——**平板免填 key**)

> 配置改动请固定在一端进行(推荐 Mac 控制台 http://localhost:9191),改动几秒内同步到另一端并热加载生效;两端同时改同一配置可能产生冲突副本。

## 日常使用

- 点「PenEcho 白板」图标即用;服务在 Termux 后台自动运行
- 右下角 ≡ 小球:控制台 / 回白板 / 刷新
- 平板重启后:打开一次 Termux,服务自动恢复(已在 .bashrc 挂幂等启动);或装 [Termux:Boot](https://github.com/gulagala001/pi-penecho/releases/latest/download/termux-boot.apk) 实现开机自启

## 防杀后台(建议设一次)

设置 → 应用 → 应用管理 → **Termux** → 电池/耗电管理 → **「无限制」**;最近任务界面给 Termux 卡片**加锁**。
没设置也不影响使用,只是服务可能几小时后被系统停掉——重开 Termux 即恢复。

## 故障排查

**白板一直「正在连接白板服务」**
Termux 里跑 `~/penecho-mobile/start.sh` 看报错;日志 `tail -50 ~/penecho-mobile/logs/bridge.log`。

**配对没反应**
确认两端同一 WiFi;平板重跑 `bash ~/penecho-mobile/pair-accept.sh`;Mac 重跑 `bash scripts/pair-tablet.sh`。
Syncthing 控制台:Mac http://127.0.0.1:8384 。

**AI 不回应**
控制台(≡ 小球)检查 key;`bridge.log` 看报错。

**更新到新版本**
重新跑步骤 2 的命令(配置与笔记保留)。白板 app 更新:下载新 APK 覆盖安装。

## 卸载

Termux 里 `~/penecho-mobile/stop.sh`,然后卸载 Termux 和白板 app;Mac 端 Syncthing 移除平板设备即可。
