# Detail Pass: `main` at `13fa6b8` (2026-11-19)

The Owner asked to fix existing problems before any new feature, after finding two that Claude Code's alpha.4 hands-on check had missed. So Claude Code went through current `main` again, with a stricter checklist: every page, every menu and the Composer through a whole Turn, each measured. `main` includes D2.5 and the model-catalog fix; W0e and W0f were running at the same time.

## How it was checked

- **Build.** A separate worktree of `main` at `13fa6b8` (`D:/Projects/Software/agenthub-work/review-detail-main`), built with `pnpm build`.
  - An isolated Host on its own port, with its own data folder.
  - The web UI from Vite on port 5391.
  - Never the installed app, its Host on 4317, or the agents' builds.
- **Data.**
  - A copy of the Owner's pre-update database, made with SQLite's online backup API: 17 projects, 55 conversations. No credentials were copied.
  - Its two remote computers therefore read "身份验证失败" instead of offline. That state is an artifact of the copy; only the layout around it is judged.
  - One Codex Turn ran in a copy of the W0 scratch project, with the alpha.4 hands-on prompt and one Approval for `node --test`.
- **Tools.** Headless Chromium through Playwright. It does not touch the Owner's screen or browser.
  - **15 pages** at 1440, 1100 and 800 px, in light and dark mode. Each one was screenshotted and probed for:
    - horizontal overflow
    - cut-off and clipped text
    - overlapping text
    - last lines of one or two characters
  - **Six menus** opened at each width and measured.
  - **The Composer and the timeline,** measured at each state of a live Turn.
  - Evidence is in `D:/Projects/Software/agenthub-archive/detail-pass-2026-11-19/`: screenshots in `shots/`, measurements in `probe-pages-all.json`, `menus.json` and `live-codex-1440.json`.
- **Not checked:**
  - keyboard focus and screen readers
  - the desktop shell: title bar, tray, native dialogs
  - Claude Code through a live Turn
  - pages behind pairing

## Confirmed on `main`, already in W0e

| What                            | Measured                                                                                                                                                                                                                                                               | W0e goal |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| The Composer changes on send    | 135 px high when idle and 203 px from 300 ms after sending; its top moves up 68 px. The input is read-only while the Turn runs, so typing a draft does nothing. The hint line changes to "草稿会保留，CodeTether 不会自动重发消息。". It returns to 135 px at the end. | 6        |
| "剩余上下文" without a value    | In every Composer                                                                                                                                                                                                                                                      | 6        |
| Menus as narrow as their button | The Codex model menu is 83 px wide, as wide as "GPT-6-Sol", and every name wraps. The Claude model (78 px), Claude reasoning (90 px) and project tool filter (144 px) menus are also exactly as wide as their buttons, at every width.                                 | 7        |
| Raw Markdown file links         | Codex's answer ended with "[README.md](README.md)、[budget.mjs](D:/Projects/…/budget.mjs)"                                                                                                                                                                             | 1        |
| "设置需要处理" on 关于与检查    | With nothing wrong on this computer                                                                                                                                                                                                                                    | 2        |

The command palette and the conversation's "…" menu size themselves correctly.

## New findings

| #   | Severity    | Finding                                                                                                                                                                                                                                                                                                                                                                                  | Evidence (`shots/`)                                | Goes to                    |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------- |
| 1   | High        | **A red "CodeTether 暂时无法连接，请重试。" under the Composer on opening a conversation.** Seen twice in about ten direct opens, both within a minute of the Host starting. It stays: the automatic model-list read never retries, and the user did nothing to cause it. Later opens were clean.                                                                                        | `p-convCodex-1440-light.png`, `cold-1.png`         | W0e addendum               |
| 2   | Medium–High | **The current conversation is unmarked in the light sidebar.** Its row is `rgb(245,243,239)` on a `rgb(243,241,237)` sidebar, a difference of 2 of 255. In dark mode it is clearly visible.                                                                                                                                                                                              | `p-convCodex-1440-light.png`                       | W0e addendum               |
| 3   | Medium      | **A tool waiting for an Approval says "运行中".** The page header says "等待批准", the dock asks for a decision, and the `node --test` row shows a spinner and "运行中".                                                                                                                                                                                                                 | `l-codex-1440-e-approval-0.png`                    | W0e addendum               |
| 4   | Medium      | **The running placeholder looks like a focused text field.** "Codex 正在运行，实时活动将在这里显示。" sits in a box with a 2 px blue border. At that moment, "running" shows five times: the top bar, the Turn header, this box, the Composer panel and the sidebar dot.                                                                                                                 | `l-codex-1440-c-sent.png`                          | W0e addendum               |
| 5   | Medium      | **An Approval fills the bottom of the window.** It shows three times:<br>- the timeline row "已请求批准 · 请在下方待处理操作中确认"<br>- the dock (185 px)<br>- the Composer panel "等你批准一条命令"<br>Together they take about 390 of 900 px, and the timeline shrinks to about 300 px. W0e goal 6 removes the Composer panel. The timeline row and the dock still repeat each other. | `l-codex-1440-e-approval-0.png`                    | D3b goal 6                 |
| 6   | Medium      | **Two words for an Approval:** the dock says "等待你的审批" and "命令审批"; the timeline, Composer and buttons say "批准".                                                                                                                                                                                                                                                               | `l-codex-1440-e-approval-0.png`                    | D3a goal 4                 |
| 7   | Low–Medium  | **A model's name is written two ways:** "gpt-6-sol" under the title, "GPT-6-Sol" in the Composer.                                                                                                                                                                                                                                                                                        | `l-codex-1440-f-done.png`                          | D3a goal 4                 |
| 8   | Low–Medium  | **Claude's reasoning menu cannot go back to the default.** The button reads "推理：默认", but the list has only 低, 中, 高, 超高 and 最大.                                                                                                                                                                                                                                               | `m-claude-reasoning-1440.png`                      | D3a goal 4                 |
| 9   | Low–Medium  | **The devices page at 800 px keeps two columns** of about 245 px. Lines wrap word by word ("macOS · / arm64 · / 身份验证 / 失败"), and names are cut to "Code…".                                                                                                                                                                                                                         | `p-devices-800-light.png`                          | D3b goal 8                 |
| 10  | Low–Medium  | **In the sidebar at 1100 px and below,** a computer's status touches its cut-off name ("CodeTether N…身份验证失败"), overlapping by 11 px.                                                                                                                                                                                                                                               | `p-devices-800-light.png`                          | D3b goal 8                 |
| 11  | Low         | **Last lines of one or two characters** in descriptions:<br>- the devices subtitle ends with "话。"<br>- the same in Settings › 后台运行 and 账号 at 800 px, 关于与检查, and Inbox failure text<br>A double space after "。" recurs ("以前的会话", the New Conversation advisory, failure copy).                                                                                         | `p-devices-1440-light.png`, `probe-pages-all.json` | D3a, new goal 10           |
| 12  | Low         | **The remote computer card** repeats its status in the subtitle ("macOS · arm64 · 身份验证失败"). Its note "AI 工具显示上次已知的安装状态" sits on the divider below it.                                                                                                                                                                                                                 | `p-devices-1440-light.png`                         | D3a goal 5                 |
| 13  | Low         | **Project list rows** leave about 120 px empty right of the date.                                                                                                                                                                                                                                                                                                                        | `p-project-1440-light.png`                         | D3b goal 3                 |
| 14  | Low         | **"以前的会话"** has a lone icon box above its heading, says "工作区" where the app says "项目", and shows an amber box when Claude Code simply cannot list sessions.                                                                                                                                                                                                                    | `p-project-1440-light.png`                         | D3b goal 3; D3a goal 4     |
| 15  | Low         | **The inspector's "变更"** lists `r8-codex-diff-check.txt` twice (+3 and −3) without saying which Turn each belongs to.                                                                                                                                                                                                                                                                  | `p-convCodex-1440-light.png`                       | D3b goal 6                 |
| 16  | Low         | **"工具输出"** shows the command as escaped JSON: `"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command 'node --test'`. This extends D2.5's carried item 3.                                                                                                                                                                                                         | `l-codex-1440-f-done.png`                          | D3b goal 9                 |
| 17  | Low         | **An archived conversation's top bar** shows its last Turn's "失败", not that it is archived.                                                                                                                                                                                                                                                                                            | `p-convArchived-1440-light.png`                    | D3b goal 6                 |
| 18  | Low         | **The keyboard hint depends on the tool.** For Claude Code, the line under the Composer says "Claude Code 在这里只读取和搜索文件，不会修改代码。" instead of how to send.                                                                                                                                                                                                                | `p-convClaude-1440-light.png`                      | W0e goal 6 (the hint line) |

Findings 1–4 come back to the surfaces W0e is changing, so they go to it as an addendum. The rest extend D3a and D3b, which have not started.

## Already in D3a or D3b, confirmed again

- Paths cut at the end on project cards, so the folder name that tells projects apart is lost (D3b goal 1).
- The "搜索" button next to the search box, and two stacked filter rows (D3b goal 3).
- "返回设备" next to the breadcrumb, and "在线" twice on the computer card (D3a goal 5).
- The Inbox subtitle crowding its title (D3a goal 3).
- "本地…" in the New Conversation dialog, and the amber advisory box for a healthy tool (D3b goal 8, D3a goal 2).
- The sidebar's "还没有会话" and "查看已归档会话" filler rows (D3b goal 7).
- The generic failure copy with its double space (D3b goal 9).

## Method changes kept

The probe and scripts in the evidence folder can run against any build. Later hands-on checks reuse them: every menu opened and measured, and the Composer measured through a whole Turn.
