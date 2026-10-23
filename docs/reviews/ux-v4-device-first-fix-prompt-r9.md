# 任务：补完第 9 项通知点击

分支 `ux/v4-device-first`，工作区 `D:/Projects/Software/agenthub-ux-v4-device-first`，HEAD 必须是 `9800ae2f8b7dc44c73317aeb2afa7cb61ed53b17`，跟踪工作树干净，否则停下报告。安装版就是 R8 装的这一版（`git-9800ae2f8b7d`），不打包、不重装、不改代码。界面以 docs/ux-redesign 为准，这是用户的临时授权，优先于 AGENTS.md 里“Figma 是唯一来源”的规定。

用户要求：界面检查由智能体直接在安装版上完成，不把界面判断交回给用户。

R8 的结果见 `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r8.md`，审核意见见 `docs/reviews/ux-v4-device-first.md` 的“第 8 轮”。14 项已通过。第 9 项的通知已经能弹出，文案是“本地电脑 · v4-accept-project”加一句说明，没有会话标题，这一点 R8 已经从通知历史里核实过。只差一步：点通知，确认打开的是那个会话。

## 做法

这一轮改用 Codex 回合，因为 Claude Code 那边的 gateway 在 R8 返回了 `provider_service_unavailable`。原因不归这一轮查。

1. 请用户在 Codex 应用外启动 CodeTether，这次不用抓日志。用户可以从开始菜单启动，也可以运行下面这条 `!` 命令：
   `! powershell.exe -NoProfile -Command "Start-Process -FilePath 'C:\Users\Administrator\AppData\Local\CodeTether\codetether-desktop.exe'"`
   等用户回复“已启动”。
2. 在测试项目 `v4-accept-project` 的 Codex 会话里发 1 个只读的简短回合，例如“只回复 OK，不要读写文件”。发送后最小化窗口，并且等最小化真的生效（`IsIconic=true`）再开始计时。
3. 回合完成后，用 attention 接口（带 `Origin: http://tauri.localhost`）确认“已完成”提醒已经生成，再用原生 Toast History 确认 CodeTether 多了 1 条完成通知。只记标题、“设备 · 项目”和说明，不记会话标题和输入内容。
4. 点通知：
   - 先试智能体自己点：打开通知中心（Win+N），用 UIAutomation 找 CodeTether 那一条，点一次。
   - 找不到唯一的那一条时，不要猜，也不要点别的通知。请用户在通知中心里点那条 CodeTether 通知，回复“已点击”。点击这一下由用户做，结果由智能体判断。
5. 点击后由智能体检查：CodeTether 窗口已恢复并在前台，路由是那个 Codex 会话，第 2 步的回合显示在里面。截一张只包含会话标题栏区域的窗口截图。

## 预算和停止条件

- Codex：最多 1 个回合。回合失败时不重发，写进报告后停下。
- Claude Code：0 个回合。
- 横幅或通知中心里都没有这条通知时，停下报告，不改代码。
- 遇到 API 429 或 524：按 Retry-After 等待，最多重试 3 次，每次记下时间，之后停下报告。

## 不要做的事

- 不打包，不运行安装程序或卸载程序。智能体不启动、不退出 CodeTether。
- 不改产品代码，不改账号、Provider 选择、gateway 和 `~/.codex`。
- 不改注册表、通知设置和快捷方式，不清图标缓存。
- 不删 Codex 包目录里的旧快捷方式，不删测试项目、测试会话和 `v4-firstrun-data`。
- 不推送，不合并，不打标签。

## 报告

追加到 `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r8.md`，新开一节“第 9 项补测”，包括：
- 回合的开始、完成时间和终态；
- attention 和 Toast History 的结果，通知文案；
- 由谁点的通知，点击后窗口状态和路由，截图名；
- 第 9 项结论和清单累计结果。

截图放在 `output/playwright/v4-installed-acceptance-r8/`。

## 限制

- 不读 .secrets/、任何 .env、凭据文件、machine-credentials 内容、`~/.codex/auth.json` 和 ~/.claude.json。
- 日志里的 `sk-…` 和 `sb_publishable_…` 用 sed 脱敏。
- 某个操作被权限拒绝时，不绕过，把命令写成 `! …` 交给用户。
- 报告用中文，不用感叹号和破折号。
