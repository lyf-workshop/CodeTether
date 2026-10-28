# 任务：Mac 第 7 轮（给网页通知链路加诊断，查清第二次为什么没发）

在 Mac 上运行。这一轮改少量代码，在 `fix/macos-notifications` 分支上新增一个提交，然后打包、替换安装版、实测。先读 `~/agenthub-archive/v4-acceptance-report-mac.md` 里第 1 到 6 轮的记录。界面以 docs/ux-redesign 为准，这是用户的临时授权，优先于 AGENTS.md 里“Figma 是唯一来源”的规定。

开始前只读核对：
- `/Applications/CodeTether.app` 运行的构建是 `git-a8abbecc12ea`；
- 正式数据是 11 个项目、2 台设备、25 个会话；
- `origin/fix/macos-notifications` 是 `a8abbecc12ea6b0b5fa83c52373a85322435130e`。

有一项不一致就停下报告。

## 背景

第 6 轮：
- 系统对照通知能显示。
- 用 `open -a` 正常启动后，第一次回合（访达遮挡）弹出了通知，点击也回到了对应会话。这说明原生通知、显示和点击都是好的。
- 之后几次回合都正常完成，待处理从 24 增加到 26，说明 Host 生成了新的待处理，但 Desktop 日志里没有新的 `notification requested`。

所以问题出在网页这一层，从收到 Host 的
...[1028 chars omitted]...
 diff；
  - 脱敏日志全文。
  用户会转给 Windows 上的审核方。

## 限制

- 不读 .secrets/、其他 .env、凭据文件、machine-credentials 内容、`~/.codex/auth.json` 和 `~/.claude.json`。`v4-build.env` 只用于打包时加载，不读出内容。
- 每次运行 `defaults` 和 `lsregister` 前，先说明要做什么。
- 不注销或删除别的 App 登记，不删备份。
- 新增依赖要写精确版本，这一轮预计不需要新增。
- 某个操作被权限拒绝时，不绕过，写成命令交给用户在终端里运行。
- 报告用中文，不用感叹号和破折号。
