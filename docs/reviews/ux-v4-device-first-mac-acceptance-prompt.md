# 任务：Mac 安装版验收（v4 电脑端）

这份提示词在 Mac 上运行。代码以 GitHub 上的 main 为准，提交必须是 `835489dd3c9e7e703ecdfb86b9cd4d2f53391b16`（标签 `v0.1.0-alpha.1`），否则停下报告。界面以 docs/ux-redesign 为准，这是用户的临时授权，优先于 AGENTS.md 里“Figma 是唯一来源”的规定。

用户要求：界面检查由智能体直接在安装版上完成，用辅助功能接口和只截 CodeTether 窗口的截图来判断，不把界面判断交回给用户。

Windows 安装版 15 项已经全部通过。这一轮只验 Mac，不改代码。发现问题时记下来，停在报告，不在这一轮修。

## 第一部分：准备

1. 拉取代码，`git fetch origin --tags`，在 `v0.1.0-alpha.1` 上新建一个干净的工作区。不要动 Mac 上已有的工作区和它们的未提交改动。
2. 只读记下现在 Mac 上的安装版：`/Applications/CodeTether.app`（或者实际所在位置）的版本、构建号，以及 `~/Library/Application Support/CodeTether` 里项目、设备、会话的数量。只记数量，不读数据库内容和凭据。
3. 备份，用户同意替换 Mac 安装版：
   - 把旧的 `CodeTether.app` 整个复制到 `~/agenthub-archive/mac-install-backup-<日期>/`；
   - 把 `~/Library/Application Support/CodeTether` 整个复制过去；
   - 在里面写一个 RESTORE.txt，说明怎么恢复。
   - 复制完核对文件数和总大小一致。备份不完整就停下。

## 第二部分：打包

- 打包需要三项环境变量：`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`、`VITE_CODETETHER_CONTROL_PLANE_URL`。值和 Windows 版相同，由用户在 Mac 的终端里设置。智能体只检查有没有设置，不打印、不保存、不再向用户索取。缺少时停下，请用户设置。
- 运行 `env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm install --frozen-lockfile`，然后 `pnpm desktop:build`。日志用 sed 去掉 `sk-…`、`sb_publishable_…` 和 Bearer 再保存。
- 打包前先跑一遍 `pnpm typecheck`、`pnpm lint`、`pnpm test`，记下结果。失败时写进报告，继续打包。
- 记下 `.app` 和 `.dmg` 的路径、大小和 SHA256。签名是临时签名（`signingIdentity: "-"`），不做公证。

## 第三部分：安装

1. 请用户从菜单栏退出旧的 CodeTether。确认进程都退出了。
2. 用新的 `.app` 替换 `/Applications/CodeTether.app`。数据目录不动。
3. 第一次打开时，macOS 可能提示“无法验证开发者”。如果出现，请用户在“系统设置 > 隐私与安全性”里点“仍要打开”。智能体不改 Gatekeeper 设置，不运行 `spctl --master-disable`，不去掉隔离属性以外的任何安全设置。
4. 打开后只读核对：运行版本是 `git-835489dd3c9e`，Desktop 和 Host 各一个，项目、设备、会话的数量和第一部分记下的一致。

## 第四部分：验收清单

按下面 15 项逐项检查，每项写“通过”“不通过”或“未测”和依据。Mac 上快捷键是 ⌘ 代替 Ctrl。

| # | 检查 |
|---|---|
| 1 | 首次设置：安装、运行、服务三项分开显示，主按钮“继续设置”。用单独的数据目录测，不动正式数据 |
| 2 | 添加一个项目，能看到并导入以前的 Codex / Claude Code 会话 |
| 3 | 侧栏：展开收起几个设备和项目，重启应用后保持；⌘B 收起和展开 |
| 4 | 新建会话：选项目和 AI 工具，不要求首条消息；创建后在会话里发第一句 |
| 5 | 发送后不用鼠标，直接继续打字（AI 工具运行中输入框只读但焦点还在） |
| 6 | 本机 Codex 会话：停止、批准“允许一次 / 拒绝”、变更面板能用，新增和删除文件能看到逐行差异 |
| 7 | Claude Code 会话：没有停止、批准按钮，看到说明 |
| 8 | 待处理页：三类都在，失败和已完成有“知道了”，不能批准的写原因 |
| 9 | 系统通知：内容是“设备 · 项目”加一句说明，没有会话标题；点开进入那个会话。分别测 CodeTether 在运行时和从菜单栏退出后点通知中心里的通知 |
| 10 | 设置：浅色、深色、跟随系统切换，重启后保持，启动不闪深蓝 |
| 11 | 次要文字（时间、脚注）看得清 |
| 12 | 后续规划页只列没做的功能，其他页面没有假开关 |
| 13 | 草稿：输入一半切到别的会话再回来，草稿还在；关掉应用后不保留 |
| 14 | 界面没有英文句子和“智能体”“此电脑” |
| 15 | 项目卡片高度是否整齐 |

另外看图标：Dock、启动台、菜单栏、关于窗口都是紫色双卡片，不是旧图标。

测试都在一个新建的测试文件夹里做，例如 `~/agenthub-work/v4-accept-project-mac`。只删这一轮自己建的文件。

## 预算和停止条件

- Codex：最多 4 个回合。Claude Code：最多 2 个回合。回合失败不重发。
- 第 9 项如果第一次点通知没打开会话，不要再追加回合，记下 Desktop 日志里 `[codetether:desktop]` 开头的通知相关行，停在报告。
- 遇到 API 429 或 524：按 Retry-After 等待，最多重试 3 次，每次记下时间，之后停下报告。

## 不要做的事

- 不改代码，不提交，不推送，不打标签。
- 不改账号、Provider 选择、gateway、`~/.codex` 和 `~/.claude`。
- 不配对、不取消配对，不移除已有项目。
- 不改系统设置、通知权限和 Gatekeeper。需要用户允许通知时，请用户自己在系统设置里打开。
- 不删备份，不删旧的 `.app`。

## 报告

- 写到 `~/agenthub-archive/v4-acceptance-report-mac.md`，包括：提交和标签，备份位置和核对结果，三项检查结果，安装包路径和 SHA256，运行版本，15 项逐项结果和依据，图标结果，没测的项目和原因，交给用户做的操作。
- 截图放在 `~/agenthub-archive/v4-acceptance-mac-screenshots/`，只截 CodeTether 窗口，不截整个屏幕，不截会话正文里的私人内容。
- 最后在回复里用中文给一段总结：几项通过、几项不通过、几项未测，不通过的是哪几项、为什么。用户会把这段转给 Windows 上的审核方。

## 限制

- 不读 .secrets/、任何 .env、凭据文件、machine-credentials 内容、`~/.codex/auth.json` 和 `~/.claude.json`。
- 某个操作被权限拒绝时，不绕过，写成命令交给用户在终端里运行。
- 报告用中文，不用感叹号和破折号。
