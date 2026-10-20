# 任务：换上 CodeTether 新图标（双卡片）

分支 `ux/v4-device-first`，工作区 `D:/Projects/Software/agenthub-ux-v4-device-first`。

**开始条件**：这份文件是 R5 任务（`ux-v4-device-first-fix-prompt-r5.md`）的第二部分，在 R5 第一部分提交之后接着做，只做第 1、2 节。打包、重装和安装位置的检查放在 R5 第四、第五部分，和 R5 的修复一起重装一次。单独执行时，起点是 ux/v4-device-first 的最新提交，工作树干净。

之前的方向 A（蓝底白色连线）和风筝都已经放弃，不要用。如果你已经按风筝生成过图标文件，用新的源文件重新生成，覆盖原来的。

图标由审核方设计定稿，源文件在 `D:/Projects/Software/agenthub/docs/ux-redesign/icon/final/`，说明见同目录的 README.md。界面和图标以 docs/ux-redesign 为准，这是用户的临时授权，优先于 AGENTS.md 里“Figma 是唯一来源”的规定。不要改图形本身；你觉得哪里画得不对，就在报告里写出来，不要自己改。

## 1. 生成图标文件

把三个 SVG 复制到 `apps/desktop/src-tauri/icons/source/` 并提交，以后可以重新生成。

用本机已有的 Playwright Chromium（`C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1237/`）把 SVG 渲染成透明背景的 PNG，不要新装依赖。临时脚本放在 `.tmp/`，不提交。

| 输出 | 来源 |
|---|---|
| `icons/32x32.png`（如果 tauri.conf.json 引用） | `codetether-app-small.svg` |
| `icons/128x128.png`、`icons/128x128@2x.png`（256）、`icons/icon.png`（512） | `codetether-app.svg` |
| `icons/icon.ico`：16、24、32、48、64、256 六层，都用 PNG 编码 | 16、24、32 用 `codetether-app-small.svg`，48 以上用 `codetether-app.svg` |
| `icons/icon.icns`：16、32、64、128、256、512、1024（含 @2x） | `codetether-app-macos.svg` |

- 不要用 `tauri icon` 一次生成全部。它所有尺寸都从同一张图缩小，小尺寸版本就用不上了。可以先用它生成 icns 再核对尺寸。
- ico 和 icns 用 Node 自己写容器：ico 是 6 字节文件头加每层 16 字节目录，图像数据直接用 PNG；icns 用 `ic04`…`ic10` 这些类型。不要用 ImageMagick 之类的外部工具。
- 只替换文件名不变的文件。`tauri.conf.json` 的 `bundle.icon` 只在新增引用时才改。
- 写一个测试 `apps/desktop/test/icons.test.mjs`（或放进现有的桌面测试），检查以下几点：
  - `icon.ico` 里正好有这 6 层，尺寸对；
  - `icon.icns` 里有上面这些类型；
  - PNG 的尺寸对；
  - `icons/source/` 里三个 SVG 都在。

## 2. 检查

- 去掉 ANTHROPIC_* 环境变量后跑 `pnpm typecheck`、`lint`、`test`、`build`，全部为 0。
- 改过的文件用 prettier 分批检查（`xargs -n 40`）。
- 把 16、24、32、48、256 的结果拼成一张对比图，放到 `output/icon-check/`（不提交）。浅色和深色背景各一行。
- 自己看这张图，写下 16 像素时后卡片、前卡片和上面的 `>_` 是否还能分辨。看不到图片时，用像素取色核对，写明是取色结果。

提交：一个提交，例如 `feat(desktop): replace app icon with CodeTether stacked cards mark`。结尾写 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。不推送，不合并，不打标签。

## 3. 打包、重装、在真实位置检查

按 `docs/reviews/ux-v4-device-first-install-prompt.md` 的第 3 到第 7 步做，和 R4 的第二部分一样：

- 打包前把当前安装包复制到 `D:/Projects/Software/agenthub-archive/installers/<R4 提交前 12 位>/`，连同 SHA256。
- 账号配置：
  - VITE_SUPABASE_URL 用 `https://qfktysdrytlaxvhzqpba.supabase.co`；
  - VITE_CODETETHER_CONTROL_PLANE_URL 用 `https://api.codetether.org`；
  - publishable key 请用户提供。
- 卸载前请用户从托盘退出 CodeTether。保留数据。
- 装完请用户用 `! powershell.exe -NoProfile -Command "Start-Process -FilePath 'C:\Users\Administrator\AppData\Local\CodeTether\codetether-desktop.exe'"` 启动。
- 确认 `hostVersion` 是新提交的前 12 位。

图标检查：
- 截图看这几个位置：窗口标题栏、任务栏（只截任务栏那一条）、托盘区域、开始菜单里的 CodeTether、安装目录里 exe 的资源管理器图标。
- Windows 会缓存图标，如果还显示旧图标，在报告里写明，不要清系统图标缓存。
- 截图放到 `output/playwright/v4-icon-check/`。

## 报告

写到 `D:/Projects/Software/agenthub-archive/v4-icon-report.md`，包括：
- 提交哈希和检查结果；
- 各图标文件的尺寸和层；
- 对比图和截图的路径；
- 16 像素时卡片和 `>_` 能否分辨；
- 新安装包的 SHA256 和 `hostVersion`；
- 没能确认的地方，例如图标缓存。

## 限制

- 只改 `apps/desktop/src-tauri/icons/` 和对应的测试。必要时可以改 `tauri.conf.json` 的 `bundle.icon`。不改 Rust 代码，不做 macOS 菜单栏模板图标。不改 `docs/reviews/`。
- 不读 .secrets/、任何 .env、凭据文件、machine-credentials 内容和 ~/.claude.json。
- 主工作区里的未跟踪文件不动。
- 不用 `rm -rf`，不删备份和旧安装包，不运行 `git worktree remove`。
- 日志里的 `sk-…` 和 `sb_publishable_…` 用 sed 脱敏。
- 某个操作被权限拒绝时，不绕过，把命令写成 `! …` 交给用户。
- 遇到 API 429 或 524：按 Retry-After 等待，最多重试 3 次，每次记下时间，之后停下报告。
- 报告用中文，不用感叹号和破折号。
