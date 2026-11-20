# Task: W0e Windows Fixes After alpha.4 (File Links, Status Check, Inspector, Title Bar, 待处理)

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

alpha.5 ships these fixes with D2.5.

**References** (read with `git show origin/ux/design:<path>`):

- `docs/reviews/2026-11-19-alpha4-hands-on-ui-review.md`, findings 2–6, with screenshots in `D:/Projects/Software/agenthub-archive/ui-review-2026-11-19/`
- `docs/reviews/2026-11-17-windows-completion-scope.md`, rows W0-20 to W0-24
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
6. **Quality gate:**
   - `pnpm typecheck`, `pnpm lint`, `pnpm build` and `pnpm test`
   - `cargo test` in `apps/desktop/src-tauri`
   - `cargo test` in `packages/supervisor-mobile` if anything the phone reads changes. Nothing should; say so if it did.
   - `pnpm format:check` for the files you changed

**Should:**

7. **Real checks** with an isolated development build on this computer, with screenshots in light and dark mode at 1440 and 1100 px:
   - **Goal 1:** a scratch conversation in a copy of the W0 scratch project, asking Codex to list the project's files and name them as links.
   - **Goals 2 and 5:**
     - Use a copy of the pre-update database backup, made with SQLite's online backup API, the way the model-catalog fix did (`D:/Projects/Software/agenthub-archive/fix-restored-conversation-model-catalog-report.md`). Copy no credentials.
     - In that copy, show 关于与检查, bulk-acknowledge one tab, and archive and restore one conversation.
     - Its remote computers will read "身份验证失败" rather than offline, because their credentials are not copied. Cover the offline group with tests.
   - **Goal 3:** a test is enough, unless a real runtime failure happens during your checks.
   - **Goal 4:** the desktop development build's title bar in each theme.

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
