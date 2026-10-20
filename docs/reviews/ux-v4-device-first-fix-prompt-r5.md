# 任务：中文工具摘要、新图标、查 Codex 失败，重装一次后补完安装版验收

分支 `ux/v4-device-first`，工作区 `D:/Projects/Software/agenthub-ux-v4-device-first`。起点必须是 `2d9ad41f7e381166e4bef49016290f279ad1145a`，工作树干净，否则停下报告。界面和图标以 docs/ux-redesign 为准，这是用户的临时授权，优先于 AGENTS.md 里“Figma 是唯一来源”的规定。

用户要求：界面检查由智能体直接在安装版上完成，不把界面判断交回给用户。

上一轮的结果见 `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r4.md`。

## 第一部分：工具摘要改成中文（第 14 项）

现象：Claude Code 会话的搜索步骤显示 `Search workspace`。

根因：`packages/adapter-claude/src/normalizer.ts` 的 `normalizeClaudeTool` 和 `normalizeSearchTool` 写了固定英文摘要，前端直接显示（`conversation-timeline.tsx:245`、`inspector-panel.tsx:296`）。

改法：
1. Claude 适配器的 `summary` 改成中文。`name`、`kind`、`command` 不变，`command` 仍是工具自己的命令文字。

   | 情况 | 现在 | 改成 |
   |---|---|---|
   | Read，没有安全路径 | `Read file` | `读取文件` |
   | Read，有安全路径 | `Read <路径>` | `读取 <路径>` |
   | Edit / Write，没有安全路径 | `Edit file` | `编辑文件` |
   | Edit，有安全路径 | `Edit <路径>` | `编辑 <路径>` |
   | Write，有安全路径 | `Write <路径>` | `写入 <路径>` |
   | Bash / PowerShell | `Run unavailable tool` | `命令工具不可用` |
   | 其他工具 | `Run tool` | `使用工具` |
   | Glob / Grep | `Search workspace` | `搜索项目文件` |

   有路径时摘要仍用 `boundUtf8(..., MAX_CLAUDE_TOOL_SUMMARY_BYTES)` 截断。中文每字 3 字节，加一个测试确认长路径截断后不会切坏字符。
2. Codex 适配器批准摘要的英文兜底（`packages/adapter-codex/src/normalizer.ts:428`、`436`）改成 `Codex 请求运行命令` 和 `Codex 请求访问文件或权限`。从 Codex 参数读到的命令和原因保持原样。
3. 在 `packages/adapter-*/src`、`apps/host/src`、`apps/node/src` 里搜一遍会进入 `summary`、`title`、`message` 并显示在界面上的固定英文句子。
   - 找到的同类问题一并改，加测试。
   - 拿不准会不会显示的，不改，列进报告。
   - AI 工具自己返回的文字、工具名、命令和路径不算。
4. 更新受影响的测试：`packages/adapter-claude/test/normalizer.test.mjs`、`apps/node/test/remote-claude-runner.test.mjs` 等。
5. 不改协议字段、不加翻译表、不改前端组件。

已配对的远程设备要更新到新版本后才会显示中文，这一点写进报告，不用处理。

提交：一个提交，例如 `fix(adapters): use Chinese tool summaries`。

## 第二部分：换图标

按 `D:/Projects/Software/agenthub/docs/reviews/ux-v4-device-first-icon-prompt.md` 的第 1、2 节做。

- 图标已经重新设计成风筝，源文件在 `D:/Projects/Software/agenthub/docs/ux-redesign/icon/final/`。之前的方向 A 已放弃。
- 那份文件第 3 节的打包和安装检查不单独做，放到本文件第四、第五部分。
- 那份文件的报告内容写进本次报告的“图标”一节，不另写 `v4-icon-report.md`。

## 第三部分：查 Codex 失败原因

上一轮 Codex 第一个回合在 10 秒内失败，错误码只有 `provider_error`，测试文件夹仍是空的。

线索（未证实）：
- 本机 PATH 上的 Codex 是 `C:\Users\Administrator\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe`，版本 0.162.1。
- 适配器验证过的版本是 0.149.1（`packages/adapter-codex/src/compatibility.ts:32`）。
- 第一次安装检查时界面显示的是 0.149.1。

按顺序查，每一步记下结果：
1. 只读核对：
   - `codex --version`；
   - 安装版设置或状态检查页显示的 Codex 版本和路径；
   - Host 用的是哪个 codex 可执行文件，从源码找出它的查找规则。
2. 用安装版本机接口只读查询上一轮失败的那个 Codex 会话（`127.0.0.1:4317`，带 `Origin: http://tauri.localhost`）。
   - 记下失败相关字段：`reason`、`code`、来源，以及原始 `codexErrorInfo` 的类型名（如果接口给出）。
   - 不记 AI 工具返回的文字。
   - 接口要求登录凭据时停下，不去找凭据。
3. 在测试文件夹 `D:/Projects/Software/agenthub-work/v4-accept-project` 里直接运行一次 Codex：
   - 命令：`codex exec --sandbox read-only --skip-git-repo-check "只回复 ok"`。参数名以 `codex exec --help` 为准。
   - 记下退出码和错误类别，输出用 sed 脱敏后再保存。
   - 只运行这一次。这一次也会在测试文件夹留下一个 Codex 会话，第五部分第 2 项要用。
4. 如果 Codex 自己能跑而安装版失败，对照 Codex 0.162.1 的 `codex app-server` 协议找差异：
   - 可以用 `codex app-server generate-json-schema` 之类的只读命令；
   - 也可以对照适配器的 schema 检查。
5. 判断：
   - 原因在 CodeTether，而且改动只在 `packages/adapter-codex/` 里：修复，加测试，单独一个提交，例如 `fix(adapter-codex): …`。
   - 原因在 Codex 本身（没登录、额度、服务、配置）：不修，把类别写进报告，告诉用户需要做什么。
   - 查不出来：写明查到哪一步，不要猜。

不要做的事：
- 不登录、不登出、不升级或降级 Codex；
- 不改 `~/.codex` 里的配置；
- 不读 `~/.codex/auth.json` 或其他凭据文件。

## 第四部分：打包并重装

按 `docs/reviews/ux-v4-device-first-install-prompt.md` 的第 3 到第 7 步做，和 R4 第二部分一样，只有下面几处不同：

- 打包前，把现有的 2d9ad41 安装包复制到 `D:/Projects/Software/agenthub-archive/installers/2d9ad41/`，连同它的 SHA256。
- 三项账号配置：
  - VITE_SUPABASE_URL 用 `https://qfktysdrytlaxvhzqpba.supabase.co`；
  - VITE_CODETETHER_CONTROL_PLANE_URL 用 `https://api.codetether.org`；
  - VITE_SUPABASE_PUBLISHABLE_KEY 请用户提供，或者请用户自己用 `!` 运行打包命令。
- 数据保留，不另做数据备份。
- 卸载前请用户从托盘退出 CodeTether，不结束进程。
- 启动用原安装路径的 `Start-Process`。被拦住时请用户运行：
  `! powershell.exe -NoProfile -Command "Start-Process -FilePath 'C:\Users\Administrator\AppData\Local\CodeTether\codetether-desktop.exe'"`
- 启动后确认 bootstrap 的 `hostVersion` 是最后一个提交的前 12 位。

## 第五部分：补完安装版验收

方法和 R4 一样：UIAutomation 加只截 CodeTether 窗口的截图。截图放在 `output/playwright/v4-installed-acceptance-r5/`。逐项对照 `docs/reviews/ux-v4-device-first.md` 的 Windows 验收清单，每项写“通过、不通过、未测”和依据。

执行预算：
- Codex：第三部分直接运行 1 次，安装版里最多 3 个简短回合。
- Claude Code：安装版里 1 个回合。
- 只在测试文件夹里运行。

### 1. 第 14 项：中文摘要

在测试项目的 Claude Code 会话里发一句会用到搜索和读取的话，例如“列出这个文件夹里的文件，读一下其中一个”。

- 看会话和右侧面板里的步骤摘要是不是中文。
- 再扫一遍所有页面，确认没有英文句子和“智能体”“此电脑”。

### 2. 第 2 项：导入以前的会话

只用第三部分在测试文件夹里留下的那个 Codex 会话。

- 在测试项目里找到“以前的会话”，导入它，确认能打开。
- 不导入其他项目的会话。
- 第三部分没留下会话时写“未测”和原因。

### 3. 第 6、8 项：Codex 停止、批准、变更，待处理

第三部分查出 Codex 能正常运行后再做，否则写“未测”。最多 3 个回合，覆盖：
- 停止；
- 一次需要批准的命令：先在待处理页确认它出现，选“拒绝”或“允许一次”；
- 一次写文件，看变更面板。

第 8 项要看到等待批准、失败、已完成三类，失败和已完成有“知道了”。不能批准的项目要写出原因。

### 4. 第 9 项：系统通知

测试前只读核对，不修改：
- `HKCU\Software\Microsoft\Windows\CurrentVersion\PushNotifications` 的 `ToastEnabled`；
- `HKCU\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\com.codetether.desktop` 是否存在，`Enabled` 的值；
- `Get-StartApps | Where-Object Name -like '*CodeTether*'` 的 AppID，应为 `com.codetether.desktop`；
- 勿扰模式（专注助手）是否开着。

有关闭的项目时，把它写成 `!` 命令或系统设置路径交给用户，等用户确认后再测。

测试时：
- 发送后马上把 CodeTether 窗口最小化。应用只在窗口在前台、正显示待处理页或同一会话时才不弹通知（`desktop-notification-model.ts:105`）。
- 用通知历史或 UIAutomation 读通知内容，只记“设备 · 项目”和说明，不记会话标题。
- 点通知，确认打开的是那个会话。
- 安装版的 Desktop 错误输出平时看不到。可以在本轮的某次启动用 `Start-Process -RedirectStandardError <归档目录下的日志>` 启动原安装路径，查找 `notification delivery failed`。日志脱敏后再保存。

### 5. 第 10 项：启动不闪深蓝

上一轮最早约 1.4 秒没截到。这次让采样脚本自己启动应用：
- 先开始轮询窗口，再在同一个脚本里 `Start-Process`；
- 每 50 毫秒以内找一次窗口，窗口一可见就开始截图，至少截到启动后 5 秒；
- 判定颜色和 R4 用的相同。

报告写明进程启动时间、第一个可见帧时间、第一张截图时间。第一张截图晚于窗口可见超过 100 毫秒时，仍写“未测”。

### 6. 第 1 项：首次设置

用一个新的空数据目录启动一次，不动现有数据：
1. 请用户从托盘退出。
2. 在 PowerShell 里设置 `$env:CODETETHER_DATA_DIR='D:\Projects\Software\agenthub-work\v4-firstrun-data'`，然后用原安装路径 `Start-Process`。这个目录要新建而且是空的。
3. 检查：首次设置出现；安装、运行、服务三项分开显示；主按钮是“继续设置”。不登录、不配对、不添加项目。
4. 请用户再从托盘退出，然后不带这个环境变量正常启动，确认原数据都在。

WebView 的数据目录不跟着换，所以首次设置可能仍不出现。这时写“未测”和原因，不去清 WebView 数据。

### 7. 图标

按图标任务第 3 节检查以下位置：窗口标题栏、任务栏、托盘、开始菜单、安装目录里 exe 的图标。Windows 缓存了旧图标时如实写，不清系统图标缓存。

### 不要做的事

- 不配对、不取消配对，不移除已有项目。
- 不登录或改账号。
- 只导入第 2 项说的那一个会话。
- 不在测试文件夹之外运行 AI 工具。
- 测完保留测试项目、测试会话和 `v4-firstrun-data`，在报告里写明。

## 检查和提交

- 每个提交前都跑 `env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm typecheck`，`lint`、`test`、`build` 同样跑一遍，全部为 0。
- 改过的文件用 `xargs -n 40 npx prettier --list-different --end-of-line auto` 分批检查。
- 提交结尾写 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 不推送，不合并，不打标签。

## 报告

写到 `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r5.md`，包括：
- 各提交的哈希和检查结果；
- 第一部分改了哪些摘要，以及列出但没改的英文；
- 图标：各文件尺寸和层，16 像素能否分辨，各位置截图；
- Codex：每一步查到什么，结论属于哪一类，用户需要做什么；
- 新安装包的 SHA256，运行中的 `hostVersion`；
- 清单逐项结果和截图名；
- 没测的项目和原因；
- 被拒绝的操作和交给用户的 `!` 命令。

## 限制

- 只改第一、第二、第三部分说的文件和测试。不改 `docs/reviews/`。
- 不读 .secrets/、任何 .env、凭据文件、machine-credentials 内容、`~/.codex/auth.json` 和 ~/.claude.json。
- 主工作区里的未跟踪文件不动。
- 不用 `rm -rf`，不删备份和旧安装包，不运行 `git worktree remove`。
- 日志里的 `sk-…` 和 `sb_publishable_…` 用 sed 脱敏。
- 某个操作被权限拒绝时，不绕过，把命令写成 `! …` 交给用户。
- 遇到 API 429 或 524：按 Retry-After 等待，最多重试 3 次，每次记下时间，之后停下报告。
- 报告用中文，不用感叹号和破折号。
