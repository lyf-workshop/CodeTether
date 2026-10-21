# 任务：修新增和删除文件的差异显示，在 Codex 应用外重装，补完第 9 项和图标

分支 `ux/v4-device-first`，工作区 `D:/Projects/Software/agenthub-ux-v4-device-first`。起点必须是 `4f30416e4307731d38141ac244c47b8ba716546f`，工作树干净，否则停下报告。界面和图标以 docs/ux-redesign 为准，这是用户的临时授权，优先于 AGENTS.md 里“Figma 是唯一来源”的规定。

用户要求：界面检查由智能体直接在安装版上完成，不把界面判断交回给用户。

上一轮的结果见 `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r7.md`，审核意见见 `docs/reviews/ux-v4-device-first.md` 的“第 7 轮”。现在 14 项通过，只差第 9 项。另外要修一个缺陷，补两处图标。

## 第一部分：新增和删除文件的差异显示

现象：Codex 新建一个 27 字节的文件，变更面板显示 `+0`，点开是“文件已变更，CodeTether 未提供可展示的差异内容”。

根因：Codex App Server 的 `fileChange` 里，`kind.type` 为 `add` 时，`diff` 字段是新文件的全文，不是统一差异格式。前端 `parseUnifiedDiff`（`apps/web/src/runtime/host/conversation-projection.ts:1344`）只认 `+`、`-`、空格开头的行，所以一行也认不出来。`kind.type` 为 `delete` 时很可能也是全文，要先核实。

改法：
1. 先核实。用本机 Codex 0.162.1 的 `codex app-server generate-json-schema` 看 `FileUpdateChange` 的说明，再用安装版本机接口只读查 R7 的那个新增变更：`diff` 有没有 `@@` 或 `---`、`+++` 开头的行。只记有没有、长度和行数，不记内容。核实结果和上面说的不一致时，停下报告。
2. 在 `packages/adapter-codex/src/normalizer.ts` 的 `#normalizeFileChanges` 里改：
   - `kind` 是新增，且 `diff` 里没有统一差异的标记时，把它转成统一差异：`@@ -0,0 +1,<行数> @@`，每行前面加 `+`。
   - `kind` 是删除，同样处理，用 `@@ -1,<行数> +0,0 @@`，每行前面加 `-`。
   - 已经是统一差异的，原样保留。修改和改名不动。
   - 文件末尾没有换行时，按统一差异的写法加 `\ No newline at end of file`。
   - 空文件：不生成差异行，增删数都是 0。
   - 转换后的长度要守住现有的大小上限，不能因为加了前缀而超出。看一下现有上限在哪里，照着用。
3. 前端和协议不改。已经存下来的旧变更不迁移，在报告里写明。
4. 测试，放在 `packages/adapter-codex/test/` 已有的 normalizer 测试里：
   - 新增多行文件、单行文件、没有末尾换行、空文件、中文内容；
   - 删除文件；
   - 已经是统一差异的新增，原样保留；
   - 修改文件不受影响；
   - 接近上限的长文件。
   再在 `apps/web/test/conversation-projection.test.mjs` 加一个用例，确认转换后的新增变更能解析出正确的增加行数和行内容。

提交：一个提交，例如 `fix(adapter-codex): show added and deleted file content as diffs`。

## 第二部分：打包，并交给用户在 Codex 应用外安装

R7 的问题根源：安装程序是在 Codex 桌面应用里运行的。Codex 桌面应用是商店（MSIX）应用，从它里面启动的程序写 `%APPDATA%` 时被重定向到了
`C:\Users\Administrator\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Roaming\Microsoft\Windows\Start Menu\Programs\CodeTether.lnk`。
所以智能体看到快捷方式在，真实的开始菜单里却没有。Windows 没有登记这个应用，开始菜单搜不到，通知也被判为关闭。

1. 先检查你自己的运行环境：用 `GetCurrentPackageFullName`（kernel32）查当前 shell 有没有包身份，返回 15700 表示没有。把结果写进报告。
2. 打包：
   - 打包前把 R6 安装包（SHA256 `56A1841DDD8BCF93…`）复制到 `D:/Projects/Software/agenthub-archive/installers/4f30416/`，连同 SHA256。
   - 三项账号配置和 R6 一样，公开 key 沿用用户已经提供的。
3. 安装由用户做，智能体不运行安装程序和卸载程序，不管第 1 步的结果是什么。把下面这些写给用户，然后等用户回复：
   - 先从托盘退出 CodeTether。
   - 在文件资源管理器里双击新安装包，按默认选项装完。不要在 Codex 应用里运行。
   - 装完后从开始菜单搜“CodeTether”启动。这一步同时检查开始菜单。
4. 用户回复后，只读确认：
   - `C:\Users\Administrator\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\CodeTether.lnk` 存在、AppID 是 `com.codetether.desktop`。要从没有包身份的进程里查，第 1 步有包身份时，请用户在普通 PowerShell 里运行 `! powershell.exe -NoProfile -Command "Test-Path -LiteralPath $env:APPDATA'\Microsoft\Windows\Start Menu\Programs\CodeTether.lnk'"`。
   - `Get-StartApps` 能列出 CodeTether；
   - bootstrap 的 `hostVersion` 是第一部分提交的前 12 位；
   - CodeTether 进程没有包身份；
   - 数据还在：项目、设备、会话数和 R7 结束时一致。
5. 不删除 Codex 包目录里那个重定向出来的旧快捷方式，在报告里写明它还在。

这一轮看不到 Desktop 的错误输出，因为是用户启动的。第 9 项需要看日志时，请用户从托盘退出后运行：
`! powershell.exe -NoProfile -Command "Start-Process -FilePath 'C:\Users\Administrator\AppData\Local\CodeTether\codetether-desktop.exe' -RedirectStandardError 'D:\Projects\Software\agenthub-archive\v4-r8-desktop-stderr.raw'"`
在 Claude Code 里用 `!` 运行，或者在普通 PowerShell 里运行，不要在 Codex 应用里运行。日志保存前用 sed 去掉 `sk-…`、`sb_publishable_…` 和 Bearer，脱敏后删除 `.raw`。

## 第三部分：第 9 项系统通知

1. 只读查 `CreateToastNotifier('com.codetether.desktop').Setting`。
   - 还是 `DisabledForApplication`：请用户打开“设置 > 系统 > 通知”，看列表里有没有 CodeTether，开关是否打开，有关的话请用户自己打开。用户确认后再查一次。还不行就停下报告。
2. 是 `Enabled` 后：
   - 在测试项目的 Claude Code 会话里发 1 个简短回合，发送后马上把窗口最小化。
   - 90 秒内读日志里的 `notification shown` 或 `notification skipped`。
   - 用 `GET http://127.0.0.1:4317/api/v1/attention`（带 `Origin: http://tauri.localhost`）确认“已完成”提醒已经生成。
   - 用通知历史或 UIAutomation 读通知内容，只记“设备 · 项目”和说明，不记会话标题。
   - 点通知，确认打开的是那个会话。
3. 提醒已生成，日志里却没有 `notification shown`：前端没调用，查 `apps/web/src/runtime/notifications/attention-notification-coordinator.ts` 在哪一步返回了。找到确定原因再改，单独一个提交，加测试，再打包一次，还是请用户安装。
4. 日志里有 `notification shown`，Windows 却没显示：写进报告，等我决定。

## 第四部分：变更差异复测

在测试项目 `D:/Projects/Software/agenthub-work/v4-accept-project` 的 Codex 会话里，最多 2 个回合：

1. 新建一个 3 行的测试文件。变更面板应显示 `+3`，点开能看到 3 行新增内容。
2. 删除这个文件。需要批准时选“允许一次”。变更面板应显示 `-3`，点开能看到 3 行删除内容。

只删这一轮自己建的文件，`r5-read-check.txt` 和 `r7-codex-change-check.txt` 保留。

## 第五部分：图标

- 开始菜单：第二部分第 3 步用户从开始菜单启动时，截搜索结果那一行。用户已经关掉了搜索，就由智能体再搜一次。
- 任务栏：CodeTether 运行时截任务栏按钮。还显示旧风筝时，请用户自己决定要不要运行 `! ie4uinit.exe -show`，运行后再截一次。用户不运行就如实写“图标缓存”。
- 标题栏、托盘、Explorer 前几轮已经确认，不用重做。

## 执行预算

- Codex：安装版里最多 2 个回合，只用于第四部分。不直接运行 Codex 命令行，只读的 `generate-json-schema` 除外。
- Claude Code：安装版里最多 1 个回合，只用于第三部分。
- 只在测试文件夹里运行。

## 不要做的事

- 智能体不运行安装程序、卸载程序，不启动或结束 CodeTether 进程。启动和退出都交给用户。
- 不配对、不取消配对，不移除已有项目，不导入其他会话。
- 不登录、不登出，不改账号，不改 Codex 的选择和 `~/.codex`。
- 不改 Windows 注册表、快捷方式和系统通知设置，不清图标缓存。
- 测完保留测试项目、测试会话和 `v4-firstrun-data`。

## 检查和提交

- 每个提交前都跑 `env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm typecheck`，`lint`、`test`、`build` 同样跑一遍，全部为 0。
- 改过的文件用 `xargs -n 40 npx prettier --list-different --end-of-line auto` 分批检查。
- 提交结尾写 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 不推送，不合并，不打标签。

## 报告

写到 `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r8.md`，包括：
- 第一部分核实结果，各提交的哈希和检查结果；
- 你的 shell 有没有包身份；
- 新安装包的 SHA256，用户安装和启动的方式，运行中的 `hostVersion`；
- 快捷方式、`Get-StartApps`、进程包身份、数据数量的核对结果；
- 第 9 项：`Setting` 的值，日志里的通知记录，提醒有没有生成，通知内容和点击结果，截图名；
- 第四部分新增和删除的显示结果和截图名；
- 开始菜单、任务栏图标的截图和结论；
- 清单累计结果；
- 没测的项目和原因，交给用户的 `!` 命令和用户的回复。

截图放在 `output/playwright/v4-installed-acceptance-r8/`。

## 限制

- 只改第一部分说的文件和测试，以及第三部分第 3 步查出确定原因后的修复。不改 `docs/reviews/`。
- 不读 .secrets/、任何 .env、凭据文件、machine-credentials 内容、`~/.codex/auth.json` 和 ~/.claude.json。
- 主工作区里的未跟踪文件不动。
- 不用 `rm -rf`，不删备份和旧安装包，不运行 `git worktree remove`。
- 日志里的 `sk-…` 和 `sb_publishable_…` 用 sed 脱敏。
- 某个操作被权限拒绝时，不绕过，把命令写成 `! …` 交给用户。
- 遇到 API 429 或 524：按 Retry-After 等待，最多重试 3 次，每次记下时间，之后停下报告。
- 报告用中文，不用感叹号和破折号。
