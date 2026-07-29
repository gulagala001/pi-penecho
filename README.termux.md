# 安卓平板安装指南

把 PenEcho 白板 + AI 家教完整装进安卓平板,**不需要电脑**。装好后:点「PenEcho 白板」图标 → 全屏白板,手写提问,AI 板书回答。

> 原理一句话:Termux(安卓上的 Linux 环境)在后台跑服务,「白板」app 负责显示。你只需要接触白板 app。

## 准备

- 安卓平板(Android 8 以上),能上网
- 约 10 分钟
- 你的 **Kimi API key**(在 Mac 上打开 http://localhost:9191 ,「配置」页可复制;key 形如 sk-...)

## 第一步:装 Termux(后台发动机)

1. 平板浏览器打开 https://github.com/termux/termux-app/releases
2. 找最新版本,下载文件名含 **`arm64-v8a`** 且以 `github-android` 结尾的 APK
   (例如 `termux-app_v0.118.3+github-android_arm64-v8a.apk`)
3. 安装。系统问「允许安装未知来源应用」时允许
4. 【可选但推荐】同样方式装 **Termux:Boot**:https://github.com/termux/termux-boot/releases
   —— 装它后平板重启会自动起服务;不装的话,重启后需要打开一次 Termux(服务会自动启动)

> ⚠️ 不要用应用商店/Play Store 里的 Termux,那是废弃的旧版。

## 第二步:一键安装服务

打开 Termux,**粘贴下面这行**,回车:

```bash
curl -sL https://github.com/gulagala001/pi-penecho/releases/latest/download/setup.sh | bash
```

等待跑完(装 Node 可能要几分钟),看到「安装完成」字样。

## 第三步:装白板 app

1. 平板浏览器下载:
   https://github.com/gulagala001/pi-penecho/releases/latest/download/PenEcho-board.apk
2. 安装并打开「PenEcho 白板」
3. 第一次打开会**自动跳到控制台页** → 粘贴 Kimi API key → 点「保存」
4. 点右下角半透明小圆球 **≡** →「回到白板」,开始写字

## 日常使用

- 点「PenEcho 白板」图标即用。服务在后台自己跑,**不用打开 Termux**
- 右下角小球 **≡** 三个功能:控制台(换模型/人设/字号)、回白板、刷新
- 平板重启后:装了 Termux:Boot 就全自动;没装就打开一次 Termux(几秒后服务自动起,然后可以关掉)

## 必做:防止系统杀后台

国产系统(小米/红米、华为/荣耀、OPPO、vivo…)会清理后台进程,导致白板连不上。**每个品牌都设一下**:

1. 设置 → 应用 → 应用管理 → **Termux** → 电池/耗电管理 → 选 **「无限制」**(或「允许后台活动」)
2. 打开最近任务(多任务)界面 → 找到 Termux 卡片 → 下拉或点锁形图标 → **加锁**

不同品牌菜单名字略有差异,搜「你的品牌 + 应用后台白名单」即可。

## 常见问题

**白板一直显示「正在连接白板服务」**
打开 Termux,输入 `~/penecho-mobile/start.sh` 回车,看报什么错。多半是服务没起或被杀了(检查上一条白名单设置)。

**写字后 AI 不回应 / 报错**
右下角 ≡ → 控制台,确认 API key 有效;或在 Termux 里看日志:
`tail -50 ~/penecho-mobile/logs/bridge.log`

**想换 AI 模型 / 角色人设 / 板书字号**
≡ → 控制台,和 Mac 上的控制台完全一样。

**更新到新版本**
重新跑第二步那行命令。你的配置(API key、人设选择)会保留。

## 卸载

Termux 里:`~/penecho-mobile/stop.sh`,然后卸载 Termux 和白板 app。
