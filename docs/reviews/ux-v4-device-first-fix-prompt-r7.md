# 任务：改用 Codex 0.162.1、恢复开始菜单快捷方式，补完第 6、8、9 项和图标

分支 `ux/v4-device-first`，工作区 `D:/Projects/Software/agenthub-ux-v4-device-first`。起点必须是 `4f30416e4307731d38141ac244c47b8ba716546f`，工作树干净，否则停下报告。界面和图标以 docs/ux-redesign 为准，这是用户的临时授权，优先于 AGENTS.md 里“Figma 是唯一来源”的规定。

用户要求：界面检查由智能体直接在安装版上完成，不把界面判断交回给用户。

上一轮的结果见 `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r6.md`，审核意见见 `docs/reviews/ux-v4-device-first.md` 的“第 6 轮”。现在 12 项通过，还差第 6、8、9 项和四处图标。

这一轮预计不改代码。只有第四部分查出确定原因时才改，改了要重新打包。

## 第一部分：开始菜单快捷方式

R6 重装时 `C:\Users\Administrator\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\CodeTether.lnk` 是存在的，现在没有了。桌面上的 `E:\OneDrive\Desktop\CodeTether.lnk` 还在。没有开始菜单快捷方式，Windows 就没有登记 `com.codetether.desktop` 这个应用，这可能就是通知和开始菜单图标的问题。

1. 只读查一遍：
   - `.tmp/` 里本轮和上几轮的脚本有没有删除或移动开始菜单文件的操作；
   - 开始菜单 Programs 目录和 `C:\ProgramData\Microsoft\Windows\Start Menu\Programs` 里有没有改名或放进子文件夹的 CodeTether 快捷方式。
   查不出是谁删的就写“原因不明”，不要猜。
2. 恢复快捷方式的办法是用同一个 R6 安装包重装一次，因为安装程序会创建带正确 AppID 的快捷方式。
   - 安装包：R6 的 `56A1841DDD8BCF93…`，不重新打包。
   - 步骤和 R6 第三部分一样：请用户从托盘退出，不结束进程；保留数据；用 `Start-Process -RedirectStandardError <归档目录下的日志>` 启动原安装路径。
   - 启动后确认 `hostVersion` 还是 `git-4f30416e4307`。
3. 重装后确认快捷方式在，AppID 是 `com.codetether.desktop`，`Get-StartApps` 能列出 CodeTether。
4. 本轮开始时、每一部分结束时、报告前，各查一次这个快捷方式还在不在，记下时间。中途又消失时，记下前后做了什么，然后停下报告。

## 第二部分：Codex 改选 0.162.1

用户已经同意：在 CodeTether 里改用本机最新的 Codex 0.162.1（`C:\Users\Administrator\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe`）。

- 只在安装版的设备页或设置页的 Codex 安装列表里点 0.162.1 的“选择”。
- 不升级、不降级、不删除任何 Codex，不改 `~/.codex`，不读 `~/.codex/auth.json`。
- 选完用本机接口只读确认选定的是 0.162.1，状态是“兼容 · 可运行”。
- 列表里没有 0.162.1，或者它不能选，停下报告原因。

0.162.1 不在适配器验证过的版本表里（`packages/adapter-codex/src/compatibility.ts:32`），本轮不改这张表，写进报告即可。

## 第三部分：第 6、8 项

在测试项目 `D:/Projects/Software/agenthub-work/v4-accept-project` 的 Codex 会话里做，最多 4 个简短回合：

1. 先发一个回合，例如“只回复 ok”。
   - 还是失败：记下日志里的 `[codex:failure]` 那一行，停下报告。不改分类器，不换回 0.149.1。
2. 能跑通后，用剩下的 3 个回合测：
   - 停止：发一个要跑一会儿的请求，运行中点“停止”，确认回合停下，界面状态正确；
   - 批准：一次需要批准的命令，先在待处理页确认它出现，再选“拒绝”或“允许一次”；
   - 变更：在测试文件夹里写一个新文件，看变更面板。
3. 第 8 项：待处理页要同时看到等待批准、失败、已完成三类，失败和已完成有“知道了”。
   - 只对本轮测试会话产生的项目点“知道了”，不动以前的项目。
   - 不能批准的项目要写出原因。

## 第四部分：第 9 项系统通知

1. 第一部分完成后，只读查 `CreateToastNotifier('com.codetether.desktop').Setting`。
2. 结果是 `Enabled`：
   - 在测试项目的 Claude Code 会话里发 1 个简短回合，发送后马上把窗口最小化。
   - 90 秒内读日志里的 `notification shown` 或 `notification skipped`。
   - 用 `GET http://127.0.0.1:4317/api/v1/attention`（带 `Origin: http://tauri.localhost`）确认“已完成”提醒已经生成。
   - 用通知历史或 UIAutomation 读通知内容，只记“设备 · 项目”和说明，不记会话标题。
   - 点通知，确认打开的是那个会话。
   - 第三部分 Codex 的批准或失败如果在窗口最小化时发生，也可以用来测，这样不用另花 Claude 回合。
3. 结果还是 `DisabledForApplication`：
   - 请用户打开“设置 > 系统 > 通知”，看列表里有没有 CodeTether，开关是否打开。有关的话请用户自己打开，智能体不改注册表。
   - 用户确认后再查一次，再按第 2 步测。
4. 提醒已生成但日志里没有 `notification shown`：说明前端没调用。查 `apps/web/src/runtime/notifications/attention-notification-coordinator.ts` 在哪一步返回了，找到确定原因再改，单独一个提交，加测试，然后重新打包、重装。
5. 日志里有 `notification shown`、Windows 却没显示：写进报告，等我决定。

本机账号是内置 Administrator，CodeTether 以提升权限运行。这一点写进报告，不用处理。

## 第五部分：图标

四处里还差三处：

- 任务栏：R6 显示旧风筝，是图标缓存。请用户自己决定要不要运行 `! ie4uinit.exe -show`，运行后再截一次。用户不运行就如实写“图标缓存”。
- 托盘：R6 截图后窗口位置变了。这次先展开隐藏图标弹层，等位置稳定（连续两次读到的位置一致）再截图。
- 开始菜单：第一部分恢复快捷方式后，搜“CodeTether”，截应用结果那一行。

Explorer 和标题栏 R6 已经确认，不用重做。

## 执行预算

- Codex：安装版里最多 4 个回合。不直接运行 Codex 命令行。
- Claude Code：安装版里最多 1 个回合，只用于第四部分。
- 只在测试文件夹里运行。

## 不要做的事

- 不配对、不取消配对，不移除已有项目，不导入其他会话。
- 不登录、不登出，不改账号。
- 不改 Windows 注册表和系统通知设置。快捷方式只通过重装恢复，不手动创建。
- 不清系统图标缓存，`ie4uinit.exe` 由用户决定是否运行。
- 测完保留测试项目、测试会话和 `v4-firstrun-data`。

## 检查和提交

只有第四部分第 4 步改了代码时才需要：
- 提交前跑 `env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm typecheck`，`lint`、`test`、`build` 同样跑一遍，全部为 0；
- 改过的文件用 `xargs -n 40 npx prettier --list-different --end-of-line auto` 分批检查；
- 提交结尾写 `Co-Authored-By: Claude Code <noreply@anthropic.com>`；
- 打包时三项账号配置和 R6 一样，公开 key 沿用用户已经提供的；
- 不推送，不合并，不打标签。

## 报告

写到 `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r7.md`，包括：
- 快捷方式：消失原因的排查结果，重装后的状态，每次检查的时间和结果；
- 运行中的 `hostVersion`，重装是否用了 R6 原安装包；
- Codex：改选前后的版本和状态，每个回合的结果；
- 第 6、8、9 项的结果、依据和截图名；
- 通知：`Setting` 的值，日志里的通知记录，提醒有没有生成；
- 任务栏、托盘、开始菜单三处图标的截图和结论；
- 清单累计结果；
- 没测的项目和原因，被拒绝的操作和交给用户的 `!` 命令。

截图放在 `output/playwright/v4-installed-acceptance-r7/`。

## 限制

- 不读 .secrets/、任何 .env、凭据文件、machine-credentials 内容、`~/.codex/auth.json` 和 ~/.claude.json。
- 不改 `docs/reviews/`，主工作区里的未跟踪文件不动。
- 不用 `rm -rf`，不删备份和旧安装包，不运行 `git worktree remove`。
- 日志里的 `sk-…` 和 `sb_publishable_…` 用 sed 脱敏。
- 某个操作被权限拒绝时，不绕过，把命令写成 `! …` 交给用户。
- 遇到 API 429 或 524：按 Retry-After 等待，最多重试 3 次，每次记下时间，之后停下报告。
- 报告用中文，不用感叹号和破折号。
