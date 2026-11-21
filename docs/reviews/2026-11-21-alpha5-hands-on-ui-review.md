# Hands-on UI Review: Installed alpha.5 (2026-11-21)

Claude Code used the installed app itself after the alpha.5 release, as it did after alpha.4 (`2026-11-19-alpha4-hands-on-ui-review.md`). The Owner approved the session. This review complements the release agent's acceptance (`release-v0.1.0-alpha.5.md`); it does not replace it.

## How it was checked

- **Build:** the installed `v0.1.0-alpha.5` (`git-5aa8ae5adffc`), with the Owner's real data.
- **Start:** quit once from the tray, then started again from the Start-menu shortcut through Explorer.
- **Window:**
  - The Owner's size: 1900 × 1250 px at 150 % scaling, about 1252 × 796 CSS px.
  - Also resized to 1100 and 800 CSS px.
  - Light and dark themes.
- **Data:**
  - The Owner's projects and conversations were only looked at. 待处理 was not acknowledged.
  - One Codex conversation ran in the W0 scratch project `ta-budget-app`. The prompt asked Codex to list the files and run `node --test`, changing nothing, and one Approval for `node --test` was allowed.
  - Afterwards that conversation was archived, and so was the one left from the alpha.4 check.
  - Totals went from 61 to 62 conversations and from 126 to 127 Turns.
  - Codex still has 157 trust entries, the release agent's count, so none was added.
- **Restored afterwards:** the light theme, the window's size and position, the 关于与检查 page, and the minimized state.
- **Tools:**
  - Windows UI Automation and window screenshots. Evidence and scripts are in `D:/Projects/Software/agenthub-archive/ui-review-2026-11-21/`.
  - The tray, Start-menu and typing scripts are the release agent's (`release-v0.1.0-alpha.5/ui/`), copied with a byte-order mark: Windows PowerShell 5.1 misreads their Chinese names without one.

## What works

- **The cold start on 设备,** the release's open item 1, now closed (`cold1.txt`, `cold1-*.png`):
  - 设备 opened 1.1 s after the window appeared.
  - Both local tools read "正在检查…" from 1.3 s.
  - Claude Code read "可用" at 9.3 s, and Codex at 11.1 s.
  - Nothing turned red, and the remote tools stayed neutral ("已安装，待确认").
  - The sampling ran every 150 ms plus the cost of UI Automation, so these times are upper bounds.
- **The message box stays still** (`turn1.txt`).
  - At the Owner's size, the input measured 73 px and the input area 274 px at every sample: empty, filled, just after sending, while running, during the Approval, and after the Turn.
  - During the Turn the timeline scrolled to keep the newest content in view, with no other movement.
- **The Approval** (`turn1-approval-0.png`):
  - The header, the tool row and the dock read "等待批准".
  - The message box read "等你批准" and offered "停止".
  - The first sandboxed `node --test` failed with `spawn EPERM` (the `unelevated` sandbox, before W17). One "允许一次" let the Turn finish, after 42 s in all.
- **The model menu** fits its content: 8 models, 173 px wide.
- **Dark theme** is coherent on the conversation, 设备, 待处理, New Conversation and the command palette, and the native title bar is dark.
- **Narrow windows.**
  - At 1100 and 800 CSS px, the conversation, 设备 and Settings hold together.
  - At 800 px the inspector hides, and Settings' section list becomes tabs.
  - After the stale state described under "Not counted", four resizes of the conversation took effect in 37–53 ms each.
- **The default-model notice** shows in a new conversation. Once the conversation's first Turn has run, the conversation has its own model, so on reopening the notice is gone. That is correct.

## Findings

1. **A computer that keeps reconnecting jumps in and out of the offline group on 设备** (`devices-steady.txt`, `cold1-04-4570ms.png` and `cold1-05-5671ms.png`).
   - **What happens:**
     - The Owner's Linux computer has been offline since 11/7.
     - About every 35 s it reads "连接中" for about 5 s. During that time its card appears in the grid beside 本地电脑, and "其他电脑 · 2 台离线" becomes "1 台离线".
     - The group row and 手机和平板 below it move by 18 CSS px each time.
     - In 75 s the page changed six times; at start-up it changed five times in 11 s.
   - **Why:** the group holds only computers whose state is `offline` (W0d, W0e). A reconnect attempt briefly makes the state `connecting`.
   - **Expected:** a computer that was offline stays in the group while it retries, and leaves the group only when it connects. The sidebar's group follows the same rule.
   - Goes to D3b, goal 11.
2. **"工具输出" still lists last lines of output** (`turn1-99-end.png`).
   - D2.5 fixed this in the timeline, but the inspector's list still previews each command with its last line, for example "})", "duration_ms 90.7674", "-a---- 132 README.md" and a full project path.
   - One title keeps a leading quote: `"Get-Location; rg --files --hidden -…`.
   - Goes to D3b, goal 9.
3. **Settings' section list scrolls away.**
   - On 关于与检查 at the Owner's size, scrolling down takes the list (外观 … 关于与检查) off screen and leaves the left 300 CSS px empty (`00-start-restored.png`).
   - The list should stay in view. Goes to D3b, goal 12.
4. **Small copy and format details on 关于与检查** (`00-start-restored.png`, `w1100-about.png`):
   - "检查时间 · 检查于 2026/11/21 05:24" says "检查" twice.
   - The "以前的会话" card puts two label–value pairs on one row with no gap between them ("支持查找 Claude Code").
   - Dates come in three formats: "2026/11/21 05:24" there, "2026年11月10日 07:28" on 设备, and "11月4日" in the dated note.
   - Goes to D3b, goals 2 and 12.
5. **The window forgets its size.**
   - After the restart the window opened at 2182 × 1406 px, not the Owner's 1900 × 1250 at (304, 34). The release agent saw the same after the update.
   - Remembering the window's size and position is a native feature. AGENTS.md keeps native features out of scope until a task prompt authorizes them.
   - **Owner decision:** add it to D3b, for example with Tauri's window-state plugin, or leave it.

**Already in D3b:**

- the escaped PowerShell command in "工具输出" (goal 9)
- "本…" in the New Conversation dialog's location line (goal 8)
- the ISO timestamps in imported conversations' titles, such as "Codex 会话 · 2026-11-19T17:36:46.000Z" on the project page (goal 2)
- the command palette's footer "这里只匹配已加载的标题" (goal 9)

## Not counted

- **A stale accessibility tree after resizes.**
  - Twice after a resize, UI Automation kept the web view at its previous size, with only four elements and no document.
  - Once, the conversation page also stayed drawn at the previous width until Claude Code opened 待处理.
  - Four later resizes of the same page took effect in 37–53 ms, and the problem did not come back.
  - It most likely came from Claude Code's own UI Automation load, which timed out on that page; it is not counted as a product problem.
  - **For the next check:** after a resize, click once inside the page before reading the tree.
- **Keys.** A synthesized Esc did not close the model menu, as with alpha.4's check. Keyboard behavior was not judged.
- **Model names** such as "GPT-6.1 Terra" next to "GPT-6.1-Sol" come from Codex's own catalog.
