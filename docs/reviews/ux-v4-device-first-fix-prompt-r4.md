# 任务：修复 Windows 添加项目的路径示例，重装后补完安装版验收

分支 `ux/v4-device-first`，工作区 `D:/Projects/Software/agenthub-ux-v4-device-first`。起点必须是 `b1e1ccf123c7adb8344720633e7726d5312e2030`，工作树干净，否则停下报告。界面以 docs/ux-redesign 原型为准，这是用户的临时授权，优先于 AGENTS.md 里“Figma 是唯一来源”的规定。

用户要求：界面检查由智能体直接在安装版上完成，不把界面判断交回给用户。

## 第一部分：修复（R4-1）

现象：在 Windows 本机添加项目时，文件夹输入框的示例是 `/Users/user/project`，应为 `C:\Projects\我的项目`。

根因：
- Host 的本机平台值是 `Windows`（`apps/host/src/api/machine-registry.ts:238`，另有 `migrations.ts:2596`）。
- `apps/web/src/components/projects/add-project-fields.tsx:157-163` 只比较小写的 `windows` 和 `win32`。
- 测试夹具用的是小写 `windows`（`apps/web/test/add-project-fields.test.mjs:96`），所以没测出来。

改法：
1. 在 `apps/web/src/components/machines/machine-presentation.ts` 加一个不区分大小写的平台归类函数。
   - `windows`、`win32` 归为 Windows；`macos`、`darwin` 归为 macOS；`linux` 归为 Linux；其他值归为其他。
   - 写法和同文件的 `machinePlatformLabel` 一致，用 `toLocaleLowerCase('en-US')`。`machinePlatformLabel` 可以改用它，但显示结果不能变。
2. `add-project-fields.tsx` 的示例改用这个函数。
   - 远程设备保持 `/home/user/project`。
   - 本机：Windows 用 `C:\Projects\我的项目`，macOS 用 `/Users/user/project`，Linux 和其他用 `/home/user/project`。
3. 在 apps/web 和 packages/ui 里再搜一遍对 `platform` 的大小写敏感比较。
   - 找到的同类问题一并改成用这个函数。
   - `node-pairing-model.ts` 的 `'linux' | 'macos'` 是内部参数，不是 Host 的值，不用改。
4. 测试：
   - `add-project-fields.test.mjs` 的本机夹具改成 Host 实际发出的 `Windows`。
   - 新增断言：`Windows`、`windows`、`win32`、`macOS`、`Linux` 各自对应的示例；远程设备的示例不变。
   - 给归类函数加单元测试。
5. 不改 Host 接口、路径校验或授权规则。

检查（都去掉 ANTHROPIC_* 环境变量）：
- 跑 `env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm typecheck`，`lint`、`test`、`build` 同样跑一遍，全部为 0。
- 改过的文件用 `xargs -n 40 npx prettier --list-different --end-of-line auto` 分批检查。

提交：
- 一个提交，例如 `fix(web): show Windows path example for the local Windows device`。
- 结尾写 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 不推送，不合并，不打标签。

## 第二部分：打包并重装

按 `docs/reviews/ux-v4-device-first-install-prompt.md` 的第 3 到第 7 步做，只有下面几处不同：

- 打包前，把现有的 b1e1ccf 安装包复制到 `D:/Projects/Software/agenthub-archive/installers/b1e1ccf/`，连同它的 SHA256。新的打包会覆盖同一路径。
- 三项账号配置：
  - VITE_SUPABASE_URL 用 `https://qfktysdrytlaxvhzqpba.supabase.co`；
  - VITE_CODETETHER_CONTROL_PLANE_URL 用 `https://api.codetether.org`；
  - VITE_SUPABASE_PUBLISHABLE_KEY 请用户提供，或者请用户自己用 `!` 运行打包命令。
- 数据保留，不另做数据备份。`windows-install-backup-20261020-pre-v4` 不动。
- 卸载前请用户从托盘退出 CodeTether。不结束进程。
- 装完后自动启动会被拦住，请用户运行：
  `! powershell.exe -NoProfile -Command "Start-Process -FilePath 'C:\Users\Administrator\AppData\Local\CodeTether\codetether-desktop.exe'"`
- 启动后确认 bootstrap 的 `hostVersion` 是新提交的前 12 位（`git-xxxxxxxxxxxx`）。

## 第三部分：补完安装版验收

在安装版窗口上直接检查，方法和安装报告第 9 节一样：UIAutomation 加只截 CodeTether 窗口的截图。截图放在 `output/playwright/v4-installed-acceptance/`。

逐项对照 `docs/reviews/ux-v4-device-first.md` 的 Windows 验收清单，每项写“通过、不通过、未测”和依据。重点是第 9 节还没测的项目：

- R4-1：本机添加项目的示例是 Windows 路径。
- 第 3 项：侧栏展开和收起后重启应用，状态保持；Ctrl B 能收起和展开。需要重启时请用户退出再用上面的命令启动。
- 第 10 项：重启时启动画面不闪深蓝。
- 第 4 到第 8 项：
  - 在 `D:/Projects/Software/agenthub-work/v4-accept-project` 新建一个空文件夹，作为测试项目添加进来。
  - 只在这个项目里新建会话。
  - Codex 最多跑 3 个简短回合，覆盖：发送后焦点、停止、一次需要批准的命令（选“拒绝”或“允许一次”）、变更面板。
  - Claude Code 跑 1 个简短回合，确认没有停止和批准按钮，并且有说明。
  - 测完不删除这个项目，在报告里写明它的存在。
- 第 8、9 项：待处理页和系统通知。通知内容只记“设备 · 项目”和说明，不记会话标题。
- 第 12 到第 15 项：后续规划页、草稿、英文扫描、卡片高度。

不要做的事：
- 不配对、不取消配对、不导入旧会话、不登录或改账号。
- 不在测试项目之外执行 AI 工具。

## 报告

写到 `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r4.md`，包括：
- 修复提交的哈希；
- 检查结果；
- 新安装包的 SHA256；
- 运行中的 `hostVersion`；
- 清单逐项结果和截图名；
- 没测的项目和原因；
- 被拒绝的操作和交给用户的 `!` 命令。

## 限制

- 只改第一部分说的文件和测试。不改 `docs/reviews/`。
- 不读 .secrets/、任何 .env、凭据文件、machine-credentials 内容和 ~/.claude.json。
- 主工作区里的未跟踪文件不动。
- 不用 `rm -rf`，不删备份和旧安装包，不运行 `git worktree remove`。
- 日志里的 `sk-…` 和 `sb_publishable_…` 用 sed 脱敏。
- 某个操作被权限拒绝时，不绕过，把命令写成 `! …` 交给用户。
- 遇到 API 429 或 524：按 Retry-After 等待，最多重试 3 次，每次记下时间，之后停下报告。
- 报告用中文，不用感叹号和破折号。
