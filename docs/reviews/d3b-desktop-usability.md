# Review: `feat/d3b-desktop-usability` (2026-11-21)

**Branch.** Pushed at `03995ba`. It starts from `main` at `5aa8ae5` (alpha.5).

- Task prompt: `d3b-desktop-usability-prompt.md`.
- Report: `D:/Projects/Software/agenthub-archive/d3b-desktop-usability-report.md`, with evidence in `d3b-desktop-usability/`.
- One commit, 91 files, +2,127 / −548 lines:
  - mostly web and `packages/ui`
  - the adapter's fallback title (goal 2)
  - the desktop shell's window state (goal 13): `window_geometry.rs`, plus calls in `host_supervisor.rs` and `desktop_update.rs`
- No Host or Protocol field, no stored title rewritten, and no `docs/` edit.

**Gates (as reported):**

- typecheck, lint, build and test passed: 2,658 passed, 14 skipped, 0 failed (alpha.5: 2,634 passed)
- Prettier passed on the 87 changed files
- the desktop's `cargo test`: 97 + 3
- `rustfmt` passed on the four changed Rust files
- The optional whole-crate `cargo fmt --check` fails on `product_device_key_store.rs`. D3b does not touch that file.

**The screenshots show the committed code.** Claude Code built the web UI from `03995ba` with the diagnostic Host URL. Its entry file is `index-B6509rF7.js`, the same as the report's "after" bundle.

**Verdict.** One follow-up round.

- Most goals hold up on the Owner's data in a native window; see "Checked hands-on".
- Must-fix:
  - goal 13 shows a maximized window before the Host is ready
  - the offline group swallows computers that need action
  - real Codex commands still show their transport quoting (goal 9)
  - one more raw timestamp reaches the screen (goal 2)
  - one required "after" screenshot is blank

## Checked hands-on

**Setup.**

- **Build:** Claude Code built `03995ba` as an isolated desktop app in its review worktree:
  - the W0f diagnostic profile, on port 4320
  - its own identifier, `com.codetether.d3breview`
  - its own data folder, `F:/codetether-d3b-review/`
- **Data:** a read-only snapshot of the installed app's database, taken the same day: 17 projects, 62 conversations, 3 computers. No credentials were copied, so both paired computers read "身份验证失败".
- **Window:** the Owner's size, 1900 × 1250 px at 150 % (1252 CSS px), and 1100 CSS px.
- **Evidence:** `D:/Projects/Software/agenthub-archive/d3b-review-2026-11-21/`.
- **Left unchanged:**
  - The installed app was not touched; it stayed minimized throughout.
  - Codex still has 157 trust entries.

**One Codex Turn** ran in the scratch project `ta-budget-app`, with one Approval allowed once.

- It exists only in the isolated database.
- Codex's own session history gained one session for that folder, so the installed app's "以前的会话" there lists one more.

**Window state (goal 13).** Claude Code timed every show and hide of the app's windows from launch with a WinEvent hook (`launch-watch.ps1`, `r*-events.txt`).

| Step                                               | Measured                                                                                        |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| First start, nothing saved                         | (76, 34), 2182 × 1406: the configured default                                                   |
| Set (304, 34), 1900 × 1250, then close to the tray | saved `{"x":304,"y":34,"width":1878,"height":1194,"maximized":false}`                           |
| Stop the process and start again                   | (304, 34), 1900 × 1250; one show, after the Host is ready                                       |
| Maximize, close to the tray, stop, start again     | (−11, −11), 2582 × 1390, maximized; the saved record keeps the normal rectangle; see must-fix 1 |

The process was stopped rather than quit from the tray: the tray icon of the installed app sits beside it. Closing to the tray had already saved the state. The agent tested tray Quit.

**What holds up:**

- **设备:** the banner reads "56 件事需要你处理 · 39 件待查看 · 17 件失败" and links to 待处理.
- **The computer page:**
  - "配对新设备" is in the page header, and "添加项目" in the Projects header.
  - Project paths keep their distinguishing tails, such as "\read-only-preflight" (but see should-fix 10).
- **Dates:** every page checked uses one format family, for example "11月19日 21:26" and "上次运行失败 · 10月22日".
- **The project page:**
  - With more than five conversations, the filters sit in one row, and there is no "搜索" button.
  - `ta-budget-app`, which has only archived conversations, shows just the search box and "查看已归档会话".
  - "发现 9 个以前的会话" is collapsed to one line.
- **The sidebar:** no "查看已归档会话" row, and an expanded project with no conversations shows no filler row.
- **Settings:** the section list stays in view while 关于与检查 scrolls at the Owner's size, and the app frame does not move. "检查时间" reads "11月21日 08:53". The "以前的会话" card stacks its two pairs.
- **Goal 10:** the Raspberry Pi's Codex reads "已安装，待确认", and its rows read "0.161.0 · 未选择" and "尚未选择". The badge and the rows agree.
- **An archived conversation's top bar** reads "已归档".
- **The command palette's footer** reads "↑↓ 选择 Enter 打开 Esc 关闭".
- **New Conversation at 1100 px** shows the full computer name and path.
- **The Turn at 1100 px:**
  - The timeline has no "已请求批准" card while the Approval waits.
  - The message box stayed 73 px from sending to the end.

## Must-fix

1. **A maximized window is shown before the Host is ready** (goal 13: "Never restore visibility… That stays as it is").
   - **Measured** (`r3-maximized-restart-events.txt`):
     - At 672 ms after launch, the hidden main window gets SHOW (maximized) and HIDE in the same millisecond.
     - The real show follows at 1688 ms.
     - A restart from a normal saved state shows the window once (`r2-normal-restart-events.txt`).
   - **The cause:**
     - `window_geometry::initialize` calls `window.maximize()` while the window is hidden.
     - In tao 0.35.3, `set_maximized` calls `ShowWindow(SW_MAXIMIZE)` whether or not the window is visible, and only then `SW_HIDE` (`platform_impl/windows/window_state.rs`, `apply_diff`).
     - `SW_MAXIMIZE` also activates the window.
   - **The agent's check missed it:** it read rectangles after the start, which cannot show this.
   - **Fix:** keep the window hidden until the Host-ready show. For example, apply the maximized state at that show, or set the placement without showing the window.
   - **Verify:**
     - Record show, hide and foreground events from launch to the real show, for a normal and a maximized saved state.
     - Quote the event lines: exactly one show per start, after the Host is ready.
2. **The offline group swallows computers that need action** (goal 11).
   - **The rule today:** `OfflineComputerMembership.isGrouped` keeps a computer that was once offline in the group for every state except `online`.
   - **The effect:** a computer that returns as `authentication_failed`, `recovery_required` or `incompatible` stays collapsed under "N 台离线". Those states need the user, and they are not offline.
   - **Rule:**
     - Only `connecting` keeps a previously offline computer in the group.
     - Every other state takes it out.
     - `offline` puts it back.
   - **Tests:**
     - `offline` → `authentication_failed`: not grouped
     - `offline` → `connecting`: grouped
3. **Real Codex commands still show their transport quoting** (goal 9). This was seen on a fresh Turn and on the alpha.5 conversation:
   - **Where:**
     - The timeline row reads `执行命令 "rg --files --hidden -g ""!.gi…`.
     - "工具输出" lists `"rg --files --hidden -g ""!.git"""`.
     - It also lists `"Get-Location; rg --files --hidden -g ""!.git"" -g …`: the goal's own example, unchanged.
   - **The raw commands**, from the isolated database:
     - `"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "rg --files --hidden -g '"'!.git'"'"`
     - `"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "Get-Location; rg --files --hidden -g '"'!.git'"' -g '"'!node_modules'"'"`
   - **The gap:** D3b's tests cover a bare `powershell -Command "…""…"""` and a wholly quoted `rg` command, but not this form: a quoted launcher whose argument contains `'"'…'"'`.
   - **Fix:** make the display show these as the user would type them. Keep the raw command intact.
   - **Correction (round 1 review):** the example given here, `rg --files --hidden -g "!.git"`, was wrong. The command that ran is `rg --files --hidden -g '!.git'`. See round 2, must-fix 2.
   - **Tests:** use these two exact strings, carried through the presentation used by both the timeline and "工具输出".
4. **One more raw timestamp** (goal 2).
   - **Where:** the Owner's active conversation "Codex 会话 — 2026-10-20T16:09:22.000Z" shows its ISO time on 待处理 and wherever its title appears.
   - **Why:**
     - The title uses an em dash.
     - `displayConversationTitle` only matches "Codex 会话 · <ISO>".
     - This form is not in the repository's history, but it is in the Owner's data.
   - **Fix:**
     - Format any stored title made of "Codex 会话", one separator (· — – -) and an ISO timestamp.
     - Append a date only for Codex conversations. A conversation of another tool that the user titled "Codex 会话" stays as it is.
   - **Tests:** both separators, and the other-tool case.
5. **Evidence.**
   - **The blank screenshot:** `after-computer-detail.png` is blank, 11 KB of background. The contact sheet made at 09:08 shows the page; the re-capture at 09:17 replaced it. Capture it again, and check that no required image is blank.
   - **The scrolled Settings capture:** in `after-settings-native-scrolled.png`, the whole app frame is shifted up about 44 CSS px, with an empty strip at the bottom. With the mouse wheel, Claude Code saw no shift.
     - Say how that capture was scrolled.
     - If keyboard focus or `scrollIntoView` scrolls the frame, fix it.

## Should-fix

6. **During an Approval at 1100 px, the timeline gets about a third of the window** (goal 6). The report gives no measurement for this goal.
   - **Measured at 1100 × 796 CSS px** (`turn1100-approval-0.png`):
     - the timeline: about 280 CSS px (35 %)
     - the Approval dock: about 189 CSS px
     - the message box: 135 CSS px
   - **Repetition:** the dock repeats the tool row's `node --test` and "等待批准", and its header takes two lines.
   - **Target:** compact the dock within the prototype's design. For example, put the header and its sentence on one line, and the context and time on the command's line. With one Approval at 1100 × 796, the timeline keeps at least 320 CSS px.
   - **Report** the measurement.
7. **Project rows show their actions all the time** (goal 3, rows).
   - D3b removed the hover-only opacity when `showProvider` is set. So pin, archive and ⋯ now show on every row.
   - Prototype 02-04 shows only the status and date, and three icons on every row work against a calmer page.
   - **Fix:** show the actions on hover and on keyboard focus, over the right end of the row, without reserving space.
   - **The archived view:** its filled "恢复会话" button on every row predates D3b. It follows the same rule, or becomes a secondary button.
8. **"发现 0 个以前的会话"** (the agent's `after-project-six.png`).
   - **What it says today:** "发现 0 个以前的会话 · Codex：以前的会话暂时不可用。 Claude Code：…"
   - **Problems:**
     - It reports 0 found when Codex could not be listed at all.
     - A stray space follows "。".
   - **Fix:**
     - When a tool cannot list its sessions, give no count for it.
     - Join the notes without a space.
9. **The computer page shows a count twice** (code read; the snapshot had no running conversation).
   - The project card's tag shows "N 个等待批准" (or "N 个运行中"), and the metrics line repeats it.
   - Show each count once.
10. **A gap after "…" in shortened paths.**
    - "E:\Projects\Softw… \read-only-preflight": there is a space between the ellipsis and the tail on cards, the project header and New Conversation.
    - It reads as a space in the path. Let the two parts touch.
11. **"AI 服务尚未检查 · 尚未检查"** on a paired computer's tool card on 关于与检查.
    - The row's label already contains its value: `provider-presentation.ts` returns "AI 服务尚未检查" when no service is known.
    - This predates D3b, and it is the same kind of fix as goal 12's "检查时间". The label reads "AI 服务".

**Nits** (fix them if you touch the code):

- **Off-screen restores:**
  - `rcNormalPosition` is in workspace coordinates, which differ from screen coordinates when the taskbar is on the top or the left.
  - Restore the position before the size, so that a monitor with different scaling does not rescale the saved size.
- **An empty-state message:** a project with only archived conversations reads "还没有会话", although three exist. Something like "没有进行中的会话" is accurate.

## Decisions on the report's limits

1. **No activity counts on 设备's overview.** Accepted: the prompt's request rule applies.
2. **An adopted untitled Codex conversation shows its adoption date.**
   - Accepted for now.
   - Keeping the native creation date needs a Host field, so it joins the small Host and Protocol task in the backlog.
3. **Not using the official window-state plugin.** Accepted: its file holds visibility, decorations and fullscreen, and it restores a rectangle that only overlaps a monitor.
4. **Goal 11 on the Owner's data** was a sample of the Host's states, not of the page.
   - Accepted: D3b's page cannot reach the installed Host without breaking isolation.
   - The unit test and the sample cover it, and Claude Code checks the page after the release.
5. **The update path was only read, not run.** Accepted. The next release prompt checks that the window keeps its rectangle through the one-click update.
6. **`cargo fmt` on `product_device_key_store.rs`.** This predates D3b, so it goes to the backlog.

## Follow-up round 1

On the same branch and worktree:

- **Fix:** must-fix 1–5 and should-fix 6–11.
- **Boundaries:** the same as the task prompt.
- **Gates:** run them all again, including `cargo test` in `apps/desktop/src-tauri`.
- **Evidence:**
  - the event lines for must-fix 1
  - the measurement for should-fix 6
  - before-and-after screenshots for should-fix 7, 8 and 10
- **Report:** append a "Follow-up round 1" section to the D3b report.
- **Push** the branch.

## Review of follow-up round 1 (`5d3584a`)

**Branch.** Two commits on `03995ba`: `55856f9` (the review fixes) and `5d3584a` (root scroll containment). 45 files, +510 / −127 lines.

- The changes are in the desktop shell's `window_geometry.rs` and `host_supervisor.rs`, the web UI, `packages/ui` and the tests.
- No Host, Protocol or `docs/` file changed.

**Gates (as reported).**

- typecheck, lint, build and test: 2,663 passed, 14 skipped, 0 failed
- Prettier on the changed files
- the desktop's `cargo test`: 98 + 3
- `rustfmt` on the changed Rust files

**Checked hands-on.**

- **Build:** Claude Code rebuilt the isolated app at `5d3584a`. It used the same recipe and data snapshot as before, and the web entry `index-B9YSqcAh.js`.
- **Window:** the Owner's size (1252 CSS px) and 1100 × 796 CSS px.
- **A Turn:** one Codex Turn ran in `ta-budget-app`. Its one Approval was declined by the script.
- **Commands:** every real Codex command in the snapshot was run through the branch's command display.
- **Evidence:** `D:/Projects/Software/agenthub-archive/d3b-review-r1-2026-11-21/`. The installed app was not touched; it stayed hidden in the tray.

**Verdict.** One more round. Must-fix 1 and 3 are not met. Four smaller problems were found.

**What holds up:**

- **Must-fix 2:** the two paired computers return as "身份验证失败" and show as cards, not in the offline group. The tests cover the rule.
- **Must-fix 4:** the em-dash title reads "Codex 会话 · 10月20日 11:09" on 待处理. That is local time; the machine is on US Central time.
- **Must-fix 5:**
  - The blank screenshot was replaced.
  - With the mouse wheel, 关于与检查 scrolls and the app frame stays put.
  - The `scrollIntoView` shift is reproduced and fixed in the agent's evidence.
- **The normal-size restart** (`n1-normal-events.txt`): one SHOW at the saved rectangle, after the Host is ready, and no later move.
- **Should-fix 6:**
  - The dock is 131 CSS px, down from 189. Its header is one line, and the command, context and time share one line.
  - The message box stayed 73 px from sending to the end.
  - For the timeline, see round 2, should-fix 7.
- **Should-fix 7:** rows show no actions at rest. On the archived view, "恢复会话 ⋯" is secondary and covers the status and the date whole.
- **Should-fix 9 and 11:**
  - 9 is code-read; the snapshot has no running conversation.
  - 11: "AI 服务" reads "尚未检查".
- **Nits:** the workspace-to-screen conversion and the order "position before size" are in, with a test.

## Follow-up round 2

On the same branch and worktree, from `5d3584a`.

### Must-fix

1. **A maximized start still shows the normal window first** (round 1, must-fix 1).
   - **Measured:** `m2-maximized-events.txt` records the Tauri window's SHOW at 1828 ms. At that moment it is not maximized: its rectangle is the saved normal one, 1267 × 833 logical px. A LOCATION event at the same millisecond then maximizes it.
   - **The agent's own trace** says the same: "`zoomed=False` … Tauri maximized it immediately afterward".
   - **On screen:** a capture burst (`m2-maximized-frames/`, `m2-maximized-strip.png`) shows the window at its normal size first. Then the maximize animation plays for about 250 ms, with a ghosted double image, before the window fills the screen.
   - **The cause:** `show_after_ready` calls `window.show()` (`SW_SHOW`, at the normal rectangle) and then `window.maximize()` (`SW_MAXIMIZE`).
   - **Fix:** the window's first visible frame is maximized.
     - For example, reveal the hidden window with one `ShowWindow(hwnd, SW_SHOWMAXIMIZED)` call. Then call `window.show()` so that tao's visible flag agrees. tao updates its maximized flag from `WM_SIZE`.
     - Keep the saved normal rectangle as the restore rectangle.
   - **Verify:**
     - Record SHOW, HIDE, FOREGROUND and LOCATION events. At the SHOW, the window is maximized. After it, there is no LOCATION event from the normal rectangle to the maximized one.
     - Capture the screen during the start: no frame shows the window at its normal size.
     - Claude Code's scripts do both: `launch-watch2.ps1 -Burst` and `capture-burst.ps1`.
     - Run the normal-size start again too, and quote both traces.
2. **The command display still shows transport quoting** (round 1, must-fix 3, which gave a wrong example).
   - **Measured:** the snapshot has 148 Codex PowerShell commands. The 138 in the `powershell.exe -Command <script>` form were run through the branch's `createTimelineToolPresentation`, using the probes `real_probe2.mjs` and `quote_probe.mjs`:
     - 101 show the script exactly.
     - 29 still show quoting, for example `'$n=0; Get-Content -LiteralPath '"'index.html' | ForEach-Object { "'$n++; …'`.
     - 2 show doubled backslashes, for example `-LiteralPath '.git\\HEAD'`.
     - 6 show other wrong text.
     - The other 10 use `pwsh -NoProfile -Command` and were not compared.
   - **What ran:**
     - The review's example was wrong: `rg --files --hidden -g '!.git'` ran, not `-g "!.git"`.
     - The `'"'` → `""` replacement changes meaning: `-Pattern '$state'` displays as `-Pattern "$state"`, which PowerShell expands.
   - **The cause:**
     - Codex's command string is a POSIX shell join, Rust `shlex`, of `[powershell.exe, -Command, <script>]`.
     - A run of characters that contains `'` goes in double quotes, with `\` escaping `\`, `"`, `$` and the backquote.
     - A run that contains `!`, `$` or the backquote goes in single quotes.
     - A script with none of `'`, `\` or `^` is single-quoted whole.
   - **Fix:**
     - When the command string splits as POSIX shell words into a PowerShell executable, its flags, `-Command` and exactly one script word, display that script word.
     - Otherwise keep today's handling, and remove the `'"'` replacement.
     - The decode stays in the web presentation: D3b changes no Host or Protocol field. An adapter-provided argv joins the backlog.
   - **Tests:** a round trip. For a table of scripts, build the raw string with the same quoting as Codex, then check that the displayed command equals the script, along with the timeline subject and the "工具输出" title. Include:
     - paths with `\`
     - `'$x'`, `"…"`, `!`, `|`, `;` and nested quotes
     - `-NoProfile`
     - the two strings from round 1 must-fix 3, now expected as `rg --files --hidden -g '!.git'` and `Get-Location; rg --files --hidden -g '!.git' -g '!node_modules'`
   - **Also check:** the Approval dock and 待处理 use the same presentation.
   - **Claude Code** reruns its probe over the snapshot's real commands.

### Should-fix

3. **A row's actions cut its status in half** (`21-crop.png`).
   - On hover, the action pill covers "成" of "已完成", so "已完" shows beside the pill.
   - **Fix:** on hover and focus, the actions take the place of either the whole status-and-date group, or the date alone with the status whole. No word may be cut.
   - **Check** with the widest status and date, at 1100 and 1252 CSS px.
4. **The previous-sessions header hides Codex's count** (`20-project-ta-budget-rest.png`, `24-previous-expanded.png`).
   - **What it does:** any tool that is not `supported` removes the count, including Claude Code reporting "当前版本不支持查找以前的会话".
   - **The effect:** on the Owner's data, every project's header reads "以前的会话 · Claude Code：…". The expanded panel says "已找到 5 个会话".
   - **Fix:**
     - Count the sessions of the tools that listed.
     - Leave out the count only when no tool listed.
     - When the panel is expanded, show each problem note once: it is now in both the header and the body.
5. **The shortened-path gap remains on the computer page** (`30-path-zoom.png`).
   - At 1252 CSS px, cards still read "E:\Projects\Softw… \read-only-preflight", "Software\… \w0b-native-seed" and "ag… \ta-budget-app".
   - **The cause:** `text-overflow: ellipsis` leaves the unused part of the last character cell inside the box. In a monospace font that is 0 to 1 character wide, so a fixed −2 px margin fits only some cases.
   - **Fix:** cut the prefix at a character boundary, so that the ellipsis ends the box. For example, compute how many characters fit.
   - **Check** every card on the computer page at 1100 and 1252 CSS px, plus the project header and New Conversation. Report the measured gaps.
6. **The Approval's context label loses the project name** (`turn1100-approval-0.png`).
   - It reads "windows-deskto…": the last two segments of the working folder, cut at 96 px.
   - **Fix:**
     - Leave the context out when it is the conversation's project root.
     - Otherwise keep its end: the folder name stays and the parent is cut.
7. **The model notice takes the message box's room for the whole conversation** (`turn1100-approval-0.png`, `turn1100-99-end.png`).
   - **The notice:** "Codex 配置的默认模型 gpt-6.2-astra 当前不在模型列表中…" stays for the conversation's whole life, at 48 CSS px. It predates D3b.
   - **The cost:** during an Approval at 1100 × 796, the visible timeline is 298 CSS px with the notice and about 346 without it. The target is 320.
   - **Fix:** show the notice until the first Turn starts, or let the user dismiss it.
   - **Measure** the timeline below the title block. The report's 433 CSS px includes about 88 CSS px under the title block.

**Nit:** 关于与检查 says "此版本暂不支持查找以前的对话"; the app's word is "会话" (`onboarding-model.ts`).

### Process

- **Gates:** all of them, including `cargo test` in `apps/desktop/src-tauri`.
- **Evidence:**
  - must-fix 1: the event lines for both starts, and the frames for the maximized start
  - must-fix 2: the round-trip test table
  - should-fix 3–7: before-and-after screenshots or measurements
- **Report:** append a "Follow-up round 2" section to the D3b report.
- **Push** the branch.
