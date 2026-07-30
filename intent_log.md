# 意图变更时间线(intent_log)

| 时间 | 变更类型 | 摘要 | 触发 |
|------|----------|------|------|
| 2026-07-29 | 初始化 | L1 建立:双端一体化、单 APK 优先、陌生人可上手、多项目多会话;Q4 伪成功"都算"(装起来费劲/不稳定/不好用均算失败) | project-standards skill 冷启动 |
| 2026-07-29 | 达成 | L1 全部目标交付并发布 v1.0.0:手机单 APK 一体化(内嵌 node+syncthing)、Electron 电脑端双击即用、6 位码配对+文件夹方向、多项目同步、多会话(JsonlSessionRepo);陌生人全流程实测走通,手机端独立板书验证 | P3-P6 连续交付,Release 资产含验收期全部修复 |
| 2026-07-30 | 达成 | v1.1.0:Windows 桌面端(syncthing win 二进制+ST_HOME 平台分支+nsis/zip 打包)、桥多 API 格式(anthropic/openai completions/openai responses,控制台可选)、画板 autosave(刷新/跳走/重开不丢,Electron 无头实测)、顶栏窄窗 flex-wrap 不挤丢按钮;mac dmg/win zip 实构建验证,OpenAI 契约测试 20 项+真实 Kimi 链路回归全绿 | 用户反馈:win 适配 + 三个 bug(画板清空/不接 OpenAI/右上角挤没) |
