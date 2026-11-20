# Task: W0e Windows Fixes After alpha.4 (Composer, Menus, File Links, Status Check, Inspector, Title Bar, 待处理)

**Where it runs.** On Windows. The Owner develops only on Windows for now (AD-13).

- Never stop, replace or reconfigure the installed app or its Host on `127.0.0.1:4317`, and never open its live database.
- Run any development build with its own Host port, `CODETETHER_DATA_DIR`, database and WebView2 data folder.

**Branch and worktree.** Start from the current `origin/main`, at `13fa6b8` or later (fetch first). D2.5 and the model-catalog fix are already in it. Create branch `fix/w0e-after-alpha4` in worktree `D:/Projects/Software/agenthub-work/fix-w0e-after-alpha4`. W0f runs at the same time and also edits `apps/host/src/api/host-service.ts`, in other places. If W0f merges first, merge `main` into your branch.

**Why this task exists.** Claude Code used the installed alpha.4 hands-on. These five problems confuse the user every day or look broken:

- Codex's answers show raw Markdown links to local files.
- Settings › 关于与检查 says "设置需要处理" when nothing is wrong.
- After a runtime failure, the inspector says Codex reports no file changes.
- In dark mode the window's title bar stays white.
- 待处理 only grows, and items can be cleared only one at a time.

The Owner then found two more on 2026-11-19, and they come first:

- Sending a message changes the Composer: a panel appears under the input, the input locks, and the timeline jumps.
- The model menu is as narrow as its button, so model names wrap over three lines and the check mark covers "Opus".

The Owner also asked to fix existing problems before any new feature. **Do goals 6 and 7 first.** alpha.5 ships these fixes with D2.5.

**References** (read with `git show origin/ux/design:<path>`):

- `docs/reviews/2026-11-19-main-detail-pass.md`: Claude Code's measured pass over `main` at `13fa6b8`, with evidence in `D:/Projects/Software/agenthub-archive/detail-pass-2026-11-19/` (findings 1–4 and 18 are goal 10)

- `docs/reviews/2026-11-19-alpha4-hands-on-ui-review.md`, findings 2–6, 12, 14 and 15, with screenshots in `D:/Projects/Software/agenthub-archive/ui-review-2026-11-19/`. The Owner's are `owner-composer-running.png`, `owner-codex-model-menu.png` and `owner-claude-model-menu.png`.
- `docs/ux-redesign/10-desktop-improvements.md` §3.3, "While a Turn runs": the Composer design for goal 6, changed on 2026-11-19
- `docs/reviews/2026-11-17-windows-completion-scope.md`, rows W0-20 to W0-26
- `docs/reviews/w0-small-fixes.md`: W0d's offline group, which goal 2 reuses
- `docs/PRODUCT.md`: Phase 4D (user copy avoids implementation terms), and the Inbox (Attention) rules
- `docs/FROZEN-BOUNDARIES.md`: the native-feature boundaries (Phase 4B, 4C, 4G.1, 4G.2)

Before starting, confirm this file has 4 second-level headings and that the last one is "Report".

## Goals

**Must:**

1. **Local-file links read as file names** (W0-20; finding 2).
   - **Today:** Codex writes links such as `[budget.mjs](E:/Projects/…/budget.mjs)` or `[README.md](README.md)`. The message renderer accepts only `http`, `https` and `mailto` links, so everything else shows as raw Markdown, with the full path.
   - **Change:**
     - When a link's destination is a local path, show its label as a file reference, styled like inline code with design tokens. Local paths include:
       - a Windows drive path
       - a `file:` URL
       - an absolute POSIX path
       - a relative path without a scheme
       - any of these with a line suffix such as `:12` or `#L12`
     - The destination may appear as a tooltip. It is not clickable.
     - Every other rejected destination (for example `javascript:` or `data:`) keeps today's inert text.
     - `http`, `https` and `mailto` links are unchanged.
   - **Tests:** each path form above, with and without a line suffix; a label containing emphasis or code; an unsafe scheme staying inert; a web link unchanged.
   - **Not here:** opening the file, revealing it in Explorer, or jumping to the inspector. Each is a native or product feature that needs its own decision.
2. **关于与检查 says what is true** (W0-22; finding 4).
   - **Today:**
     - The page says "设置需要处理" while this computer and both AI tools are ready.
     - Most of the page repeats the two offline remote computers' last-known diagnostics.
     - It also shows "此 AI 工具版本不受支持" for Claude Code next to a Claude Code that works.
   - **Cause of the summary:** without a selected project, the Host's `doctorOverallState` returns `needs_attention` whenever this computer is ready (Known facts).
   - **Change:**
     - Without a selected project, the overall state comes from this computer and its AI tools:
       - ready when one AI tool is ready
       - limited or unknown by the same rules the project case uses
       - "needs attention" only when no AI tool on this computer is usable
     - Remote computers keep their own section and do not change the summary.
     - On this page, offline remote computers move into W0d's closed group (`OfflineComputersGroup`), with its own key for this surface. An online remote computer stays outside the group, as in W0d.
     - Find where the "此 AI 工具版本不受支持" row comes from.
       - If it is an offline computer's last-known data, the group covers it.
       - If it is this computer, show only the installation in use, and report what the other row was.
   - **Tests:**
     - **Host:** no project with a ready local AI tool gives `ready`; no usable local AI tool gives `needs_attention`; the project cases are unchanged.
     - **Web:** two offline remote computers sit in the closed group on this page, and an online one stays outside.
3. **The inspector keeps its tabs after a runtime failure** (W0-23; finding 5).
   - **Today (alpha.4):**
     - After a runtime failure, the inspector lost "变更" and "工具输出" for a Codex conversation on this computer and said Codex does not report file changes.
     - The tabs came back with the next Turn.
     - `supportsDiff` and `supportsToolOutput` come from the live capabilities, which disappear while the runtime is unavailable (Known facts).
   - **First, check on `main` (D2.5 rewrote how tabs are chosen):** write a test in which the provider's live capabilities are missing or unavailable while the conversation's history has changes and tool output. If the tabs survive, keep the test and report that D2.5 fixed it.
   - **Otherwise, change:**
     - What the inspector can show for a conversation's history depends on its AI tool and on whether it runs on this computer. It does not depend on whether the runtime is available right now.
     - Composing, interrupting and Approvals stay gated on live availability, as today.
   - **Tests:** the failing case above, plus a Claude Code conversation that still shows only "文件".
4. **The title bar follows the theme** (W0-24; finding 6).
   - **Today:** in dark mode the app content turns dark, but the native title bar stays white.
   - **Change:**
     - When the theme preference changes, and at startup, the desktop app sets the native window theme to match:
       - "深色": dark
       - "浅色": light
       - "跟随系统": follow Windows
     - Use Tauri's window theme API. Add only the matching window permission to the main capability, and update that capability's description.
     - The browser build is unaffected.
   - **Tests:** the web side calls the native theme setter for each preference, and does nothing outside the desktop app. The desktop build still passes `cargo test`.
   - **Not here:** custom window chrome, or any other window permission.
5. **待处理 stays meaningful** (W0-21; finding 3; Owner decision 2026-11-19).
   - **Today:**
     - 74 open items going back to October. Most are "待查看" and "失败", including failures from the two offline computers.
     - Each item is cleared one at a time with "知道了".
     - Archived conversations keep their items.
   - **Change, part 1, "全部知道了":**
     - Each Inbox tab that contains failed or "待查看" items gets one "全部知道了" action for those items.
     - Approvals are never cleared in bulk.
     - One confirmation names the count, and says that conversations and their history are not affected.
     - The action uses the existing per-item acknowledgement, with its idempotent action IDs (Known facts).
       - Show progress.
       - If some items fail, keep them, and say how many could not be cleared.
       - A second click while it runs does nothing.
   - **Change, part 2, archived conversations:**
     - Items whose conversation is archived are neither listed nor counted.
     - Archiving does not acknowledge or delete them, and restoring the conversation brings them back.
     - Every place that shows Attention must agree: the Inbox list, its tab counts, the sidebar badge and the phone. So filter where the Host lists open Attention (`listAttention`, Known facts), unless you find a reason it cannot work there; in that case ask first.
     - An archived conversation should not have a pending Approval. If one can exist, keep showing it, because it still needs a decision.
   - **Tests:**
     - bulk acknowledge clears only failed and "待查看" items in the current tab
     - a partial failure leaves the failed items and reports their count
     - archiving hides a conversation's items, and restoring shows them again
     - the badge count matches the list
6. **The Composer stays still when a message is sent** (W0-26; the Owner, 2026-11-19). This follows the new design in 10 §3.3, "While a Turn runs", which replaces the prototype's busy and waiting panels.
   - **Today:**
     - Sending adds a panel under the input: "Codex 正在工作", "这一轮完成后可以发送下一条消息" and "停止", at least 64 px high.
     - The input becomes read-only, "发送" turns grey, and the hint line below changes its text.
     - The Composer grows, and the timeline above it jumps (`owner-composer-running.png`).
     - "剩余上下文" shows with no value, although 10 §3.3 says the label is absent until a value is known (hands-on finding 12).
   - **Change,** as 10 §3.3 describes:
     - **Same size, same rows.** The Composer keeps its size and rows through idle, sending, running and waiting for an Approval. Nothing is added, removed or resized.
     - **The input stays editable while a Turn runs,** so the user can write the next message. The draft is kept as today. Sending stays blocked until the Turn ends, and nothing is queued.
     - **"停止" in place of "发送".** While a Turn runs and the AI tool can be interrupted, "发送" becomes "停止" in the same place and at the same size. Otherwise "发送" stays, disabled, with the reason as its tooltip.
     - **The state shows in the action bar,** in the slot that shows "字数" when idle:
       - a small spinner and "Codex 正在工作" while a Turn runs
       - "等你批准" while an Approval waits; the Approval dock keeps the decision
     - **The hint line** under the Composer stays one line high; only its text changes.
     - **"剩余上下文"** is not shown until a value is known.
     - **Archived and unavailable conversations** keep their explanation and action in place of the input. Those states never start from a send.
   - **Tests:**
     - the same rows render in idle, running and waiting
     - the input accepts text while a Turn runs, and sending stays blocked
     - "停止" appears only when the AI tool can be interrupted
     - Claude Code shows a disabled "发送" with its reason
     - no "剩余上下文" without a value
   - **Real check (Must):**
     - In a development build at 1440 and 1100 px, measure the Composer's bounding box with the same draft text:
       - before sending
       - while running
       - while waiting for an Approval
       - after the Turn ends
     - Its height may not change by more than 1 px.
     - Record the scroll position of the timeline's last message at the moment of sending, to show it does not jump.
7. **Menus fit their content** (W0-25; the Owner, 2026-11-19).
   - **Today:**
     - The shared `SelectContent` sets its width to its trigger's width. The model menu's trigger is a short "GPT-6-Sol".
     - So the Codex list wraps every name over three lines ("GPT- / 6.1 / Terra"), and in the Claude list the check mark covers "Opus" (`owner-codex-model-menu.png`, `owner-claude-model-menu.png`).
     - The New Conversation dialog caps its own menu at the trigger's width.
   - **Change:**
     - **Width.** A menu is at least as wide as its trigger, and as wide as its longest item allows within the window.
     - **Labels.** Item labels never wrap inside a word. A label too long for the window ends with an ellipsis and shows in full as its tooltip.
     - **The check mark** never overlaps a label.
     - **Fix it once, in the primitive,** and remove page-level overrides that fight it. AGENTS.md: correct the primitive, not each page.
     - **Check every menu:**
       - every `Select`: the Composer's model and reasoning, New Conversation, Add Project, and the project's conversation list
       - every other menu-like primitive (dropdown menus, popovers, the command palette) against the same three rules
   - **Tests:** the primitive's width rule with a short trigger and long items, and with a wide trigger and short items.
   - **Real check (Must):** a screenshot of every menu open, at 1440, 1100 and 800 px, in light and dark mode.
8. **Quality gate:**
   - `pnpm typecheck`, `pnpm lint`, `pnpm build` and `pnpm test`
   - `cargo test` in `apps/desktop/src-tauri`
   - `cargo test` in `packages/supervisor-mobile` if anything the phone reads changes. Nothing should; say so if it did.
   - `pnpm format:check` for the files you changed

**Should:**

9. **Real checks** with an isolated development build on this computer, with screenshots in light and dark mode at 1440 and 1100 px:
   - **Goal 1:** a scratch conversation in a copy of the W0 scratch project, asking Codex to list the project's files and name them as links.
   - **Goals 2 and 5:**
     - Use a copy of the pre-update database backup, made with SQLite's online backup API, the way the model-catalog fix did (`D:/Projects/Software/agenthub-archive/fix-restored-conversation-model-catalog-report.md`). Copy no credentials.
     - In that copy, show 关于与检查, bulk-acknowledge one tab, and archive and restore one conversation.
     - Its remote computers will read "身份验证失败" rather than offline, because their credentials are not copied. Cover the offline group with tests.
   - **Goal 3:** a test is enough, unless a real runtime failure happens during your checks.
   - **Goal 4:** the desktop development build's title bar in each theme.

10. **Addendum from the detail pass** (added on 2026-11-19 after this task started; `2026-11-19-main-detail-pass.md`, findings 1–4 and 18). These come back to the surfaces goals 6 and 7 change.
    - **A failed automatic model-list read stays quiet** (finding 1).
      - Seen twice soon after the Host started: opening a conversation showed a red "CodeTether 暂时无法连接，请重试。" under the Composer. It stayed, because the automatic read never retries.
      - If the automatic read fails, the Composer shows nothing. The error appears when the user opens the model menu, which reads the list again as today.
      - The no-automatic-retry rule from the catalog fix stays.
      - Report what the failed read returned, if your checks see it.
    - **The current conversation is visible in the light sidebar** (finding 2).
      - Today its row is `rgb(245,243,239)` on a `rgb(243,241,237)` sidebar.
      - Fix the token so the current row is clearly marked in both themes, and report the contrast you reach.
    - **A tool waiting for an Approval says so** (finding 3). While a command waits for the user's decision, its timeline row reads "等待批准", not "运行中" with a spinner.
    - **The running placeholder is quiet** (finding 4).
      - The timeline's "Codex 正在运行，实时活动将在这里显示。" box has a 2 px blue border, so it looks like a focused text field. Give it a quiet style.
      - After goal 6, "running" should show only in the top bar, the Turn header, the Composer's action bar and the sidebar dot.
    - **One keyboard hint for every tool** (finding 18).
      - For Claude Code, the line under the Composer says "Claude Code 在这里只读取和搜索文件，不会修改代码。" instead of how to send.
      - The hint line always says how to send. The read-only note appears once elsewhere, for example in the Composer's placeholder.
    - **Tests:** one for each item, and screenshots before and after.

## Known facts

Line numbers are at `13fa6b8`.

- **Goal 1:**
  - `apps/web/src/components/conversation/message-markdown-model.ts`:
    - `SAFE_LINK_PROTOCOLS` is at line 40.
    - The link branch of the inline parser is at about line 178.
    - `safeMessageLink` is at line 225. It uses `new URL(...)`, so `E:/…` parses as the scheme `e:` and `README.md` throws.
  - The renderer is next to it (`message-markdown.tsx`). D2.5 added highlighted code blocks; keep its rule that no HTML reaches the DOM.
- **Goal 2:**
  - `doctorOverallState` is at `apps/host/src/api/host-service.ts:9189`, and its caller is at line 1065. With `project === undefined` it ends in `return 'needs_attention'`.
  - The web summary is `apps/web/src/components/onboarding/onboarding-model.ts:118–139`: "设置需要处理" is its fallback.
  - The page is `apps/web/src/components/doctor/doctor-page.tsx`. Its remote computers are rendered from line 372, and "此 AI 工具版本不受支持" is at line 810.
  - The group is `apps/web/src/components/machines/offline-computers-group.tsx`, with `isOfflineRemoteComputer` in `machine-presentation.ts:78`.
  - **Setup reads the same field.** The onboarding model switches on `doctor.overall` (`onboarding-model.ts:88`, with a note at line 351). Check every consumer of `doctor.overall` before changing it, and keep the first-run and setup flow as it is. If that flow depends on the no-project `needs_attention`, stop and report.
- **Goal 3:**
  - `deriveLiveControlAvailability` sets `supportsDiff` from the live capabilities (`apps/web/src/components/conversation/conversation-controls.ts:175`).
  - The inspector combines it with the computer kind (`inspector-panel.tsx:339`), and `conversation-inspector-state.ts` picks the tab.
  - The alpha.4 screenshots are `25-later.png` and `27-followup-90s.png` in the hands-on folder.
- **Goal 4:**
  - The theme is applied in `apps/web/src/runtime/theme/theme-preference.ts`.
  - Native calls go through `apps/web/src/runtime/native/native-capabilities.ts`.
  - The main window's permissions are in `apps/desktop/src-tauri/capabilities/main.json`, and the window keeps native decorations (`tauri.conf.json`).
- **Goal 5:**
  - "知道了" calls `acknowledgeInboxAttention` (`apps/web/src/components/inbox/inbox-actions.ts:54`) from `inbox-page.tsx:194`.
  - `apps/web/src/runtime/host/attention-actions.ts` owns one idempotent action ID per acknowledgement.
  - The Host lists open Attention in `listAttention` (`host-service.ts:3609`).
  - The Android app reads Attention through the Supervisor projection (`apps/android/.../remote/RemoteProjection.kt`). Check whether it reads the same list.
- **Goals 6 and 7:**
  - `apps/web/src/components/conversation/composer.tsx`:
    - The gate is computed at line 117, and `canEdit` (line 126) is false whenever a gate exists, which locks the input while a Turn runs.
    - The model and reasoning menus are at lines 372–457.
    - The panel is appended inside the form at lines 548–600, with `min-h-16`.
    - The hint line is at lines 602–618.
  - The gate texts are in `conversation-gate-presentation.ts:205–230`.
  - The prototype's busy panel is in `docs/ux-redesign/prototype/conv.js:71`. 10 §3.3 now supersedes it.
  - The width rule is `w-[var(--radix-select-trigger-width)] min-w-[var(--radix-select-trigger-width)]` in `packages/ui/src/components/select.tsx:79`, and items reserve `pr-8` for the check at line 117.
  - The New Conversation cap is `max-w-[var(--radix-select-trigger-width)]` in `apps/web/src/components/conversations/new-conversation-fields.tsx:127`.
  - Messages while a Turn runs (W10, group C) are a separate, later design. This task only keeps the input editable and blocked from sending.
- **The W0 scratch project** `ta-budget-app` is at `E:/Projects/Software/agenthub/w0-audit/fixtures/windows-desktop-audit-scratch-projects-for-timing-and-path-display/ta-budget-app`. Work in a copy.
- **The scope rule for native features.** This prompt authorizes exactly one native addition: setting the window theme. It does not authorize opening files or folders, revealing in Explorer, or any other window or filesystem permission.

## Boundaries

- **Decide yourself:**
  - the wording, within PRODUCT Phase 4D
  - the file reference's style, using existing tokens
  - how the confirmation and progress look
  - test design and commit splitting
- **Ask the Owner first:**
  - a new Host endpoint or Protocol change for bulk acknowledgement
  - any change to what archiving does beyond hiding Attention
  - a change to first-run routing
  - replacing the installed desktop build
- **Do not:**
  - make file links clickable, or open files or folders
  - add other window or filesystem permissions, or custom window chrome
  - acknowledge or delete Attention when a conversation is archived
  - change Approval behavior
  - use the installed app, its Host or its live database
  - edit `AGENTS.md` or `docs/`
  - force-push, merge to `main`, or tag
  - read or print credentials

Push `fix/w0e-after-alpha4` to `origin`.

## Report

Write to `D:/Projects/Software/agenthub-archive/w0e-windows-fixes-report.md`:

- **Addendum (goal 10):** each item's change, with screenshots and tests.
- **Composer:** the measurements of goal 6 in a table, with screenshots of each state, and the tests.
- **Menus:** every menu you checked, with its screenshots before and after, and the tests.
- **File links:** the rule for each destination form, its tests, and a screenshot of a real Codex answer.
- **关于与检查:**
  - the Host change and its tests
  - every consumer of `doctor.overall` you checked
  - where "此 AI 工具版本不受支持" came from
  - screenshots
- **Inspector:** whether D2.5 already fixed it, the test, and any change.
- **Title bar:** the permission added, the tests, and screenshots in each theme.
- **待处理:**
  - where the archived filter lives, and why
  - how the phone was checked
  - the bulk action's behavior on partial failure
  - tests, and screenshots before and after in the database copy
- **Gates:** results for TypeScript and Rust, with any failures verbatim.
- **Commits:** your commits and the pushed remote commit.
- **Docs:** documentation changes you think are needed. PRODUCT's Inbox rules change with goal 5.
- **Status:** anything left undone and why, and which completion level the work reached.
