# Task: W0 Small Fixes (Host Stop, First-Run Sign-In, Approval Wording, Offline Computers)

**Where it runs.** On Windows. The Owner develops only on Windows for now (AD-13).

- Never stop, replace or reconfigure the installed app or its Host on `127.0.0.1:4317`.
- Run any development build with its own Host port, `CODETETHER_DATA_DIR`, database and WebView2 data folder.

**Branch and worktree.** Start from the current `origin/main` after `feat/d2-model-control` has merged (fetch first). Create branch `fix/w0-small-fixes` in worktree `D:/Projects/Software/agenthub-work/fix-w0-small-fixes`. If B3a merges while you work, merge `main` into your branch; both change `conversation-gate-presentation.ts`.

**Why this task exists.** W0 and W0b found four small problems that each confuse the user at a specific moment:

- when the local service stops
- on the very first launch
- when an Approval asks to change files
- when someone who uses only this computer sees remote computers they do not use

Each fix is small and needs no design note.

**References** (read with `git show origin/ux/design:<path>`):

- `docs/reviews/2026-11-17-windows-completion-scope.md`, group A (W0-09, W0-12, W0-17)
- `docs/PRODUCT.md`, Phase 4D (user copy avoids implementation terms)
- `docs/FROZEN-BOUNDARIES.md`: Phase 4G.1 and 4G.2 (tray and Windows lifecycle)
- `docs/ux-redesign/03-project-plan.md` §6 (invariants)

Before starting, confirm this file has 4 second-level headings and that the last one is "Report".

## Goals

**Must:**

1. **The local service stops while the app is open** (W0-09).
   - **Today:** the native dialog is titled "CodeTether 启动失败", although startup succeeded long before. After the user dismisses it, they must find and open the app again by hand.
   - **Change:**
     - Give this case its own title and text: the local service stopped. Say that saved projects and conversations are kept on this computer.
     - Offer one clear action that restarts CodeTether, next to the existing safe exit. Restarting relaunches the desktop app, which then starts its Host as at a normal launch. Nothing is restarted automatically without the user's choice.
     - A real startup failure keeps its current title and text.
   - **Tests:** the Rust side picks the right text for each case, and the restart action relaunches the app.
2. **Sign-in can be found on the first launch** (W0-17).
   - **Today:** with an empty profile, the first screen goes straight to "设置进度" and "开始设置". Its text says no account is needed, but nothing on it opens the account page before the setup wizard is finished.
   - **Change:**
     - Add a visible, keyboard-reachable entry for an existing account, such as "已有账号？登录", on the first-run screens.
     - It opens the existing account page, and the user can return to setup from there.
     - Keep the statement that this computer can be used without an account. Do not change the sign-in flow itself.
   - **Tests:** the entry renders on the first-run screens and leads to the account page.
3. **A file Approval is not called a command** (W0-12, the wording part).
   - **Today:** a pending file-change Approval makes the Composer say "等你批准一条命令" (`conversation-gate-presentation.ts`, about line 207 at `0bf8cba`).
   - **Change:** use the Approval's `kind`:
     - `command`: keeps the command wording
     - `file-change`: says the agent wants to change files
     - `unknown`: neutral wording
   - **Tests:** one for each kind, in the gate presentation and in the Approval dock's title.
   - **Not here:** showing the paths and the patch before the decision. That needs Host and adapter changes and is decided in the W17 design note.
4. **Offline remote computers stay out of the way** (W0-04; the Owner, 2026-11-18). This replaces D3a's goal 9.
   - **Today:**
     - The devices page and the sidebar list two paired remote computers. Both are offline, because remote work is postponed.
     - They cannot be unpaired while offline: the app must reach a computer to revoke its trust. The Owner also wants to keep the pairing for later.
     - Next to them, the account and this computer's status are mixed together, so someone who uses only this computer has to work out what each one means.
   - **Change:**
     - **Devices page:**
       - This computer comes first, with one line saying it works without an account.
       - Where the account appears, say what it is for: pairing phones and other computers.
       - Offline remote computers move into one row, such as "其他电脑 · 2 台离线", closed by default. Opening it shows them as today, with their detail pages and actions.
     - **Sidebar:** offline remote computers move into one group, closed by default, the same way.
     - **Online remote computers:** a remote computer that is online shows as it does today, outside the group.
     - **No remote computers:** no group appears.
     - **Open or closed:** whether the group is open is UI state for this viewer (Zustand, or storage wrapped in try/catch), never Host data.
   - **Limits:**
     - No change to pairing, trust, Host data or what the Host reports.
     - Nothing is deleted, and no remote request is made.
   - **Tests:**
     - two offline remote computers: the group is closed and shows 2
     - opening the group shows both
     - an online remote computer stays outside the group
     - with no remote computers, no group appears
5. **Quality gate:**
   - `pnpm typecheck`, `pnpm lint`, `pnpm build` and `pnpm test`
   - `cargo test` in `apps/desktop/src-tauri`
   - `pnpm format:check` for the files you changed

**Should:**

6. **Real-device checks** with a development build on this computer:
   - **Goal 1:** stop only the development build's own Host process, then use the restart action.
   - **Goal 2:** use an empty data folder and an empty WebView2 folder. Opening the account page is enough. Do not sign in unless the Owner is present and agrees.
   - **Goal 3:** a scratch conversation whose Turn asks for a file change.
   - **Goal 4:** a development build's own database has no paired computers. Use the tests here; the check with the Owner's two offline computers happens at alpha.4 acceptance.

## Known facts

- **W0-09** (`D:/Projects/Software/agenthub-archive/w0-windows-desktop-audit-report.md`):
  - The dialog comes from `apps/desktop/src-tauri/src/startup_error.rs:13` and `:28`. The Host supervisor raises it at `host_supervisor.rs:1277` (line numbers at `0bf8cba`).
  - The main window keeps a note that it shows cached data.
- **W0-17** (`D:/Projects/Software/agenthub-archive/w0b-windows-desktop-audit-report.md`):
  - The first-run layout is `apps/web/src/components/onboarding/onboarding-step-layout.tsx:115`.
  - The routing that sends a new profile into setup is in `apps/web/src/components/app-shell/root-layout.tsx:49`.
  - W0b's isolated launch used empty Host and WebView2 folders and found no "账号" or "登录" on the first screen (`w0b-windows-desktop-audit/measurements/clean-guard.json`).
- **W0-12:**
  - An Approval record has `kind: 'command' | 'file-change' | 'unknown'` (`packages/protocol/src/records.ts:301`).
  - The dock uses the summary as its detail (`apps/web/src/components/conversation/pending-action-dock-model.ts:69`) and renders it at `pending-action-dock.tsx:186`.
  - W0b's screenshot: `w0b-windows-desktop-audit/screenshots/j3-recovery-dock.png`.
- **W0-04's evidence:** `D:/Projects/Software/agenthub-archive/w0-windows-desktop-audit-report.md`, finding W0-04 (`j11-account-settled.json`, `j1-first-native.png`). The sidebar's computer sections are in `apps/web/src/components/app-shell/workspace-device-section.tsx`; the devices page sorts with `sortMachinesForDisplay` (`apps/web/src/components/machines/machines-page.tsx`).
- **D3a follows this task.** D3a restyles the same devices page (status wording, page header). It starts after this task has merged and keeps this goal's order and grouping.
- **The scope rule for native features.** The Out of Scope list in AGENTS.md limits native features to the accepted Phase 4 boundaries. This prompt authorizes exactly one addition: relaunching the app from the dialog that reports a stopped local service. It does not authorize a general restart command or any other native command.

## Boundaries

- **Decide yourself:**
  - the exact wording, within PRODUCT Phase 4D
  - how the dialog offers its two choices
  - test design
  - commit splitting
- **Ask the Owner first:**
  - restarting the Host automatically without the user's choice
  - any change to the sign-in flow
  - replacing the installed desktop build
- **Do not:**
  - change Approval behavior or what an Approval shows beyond its wording
  - edit `AGENTS.md` or `docs/`
  - force-push, merge to `main`, or tag
  - read or print credentials

Push `fix/w0-small-fixes` to `origin`.

## Report

Write to `D:/Projects/Software/agenthub-archive/w0-small-fixes-report.md`:

- **Host stop:** the new dialog text and action, its tests, and a screenshot.
- **First-run sign-in:** the entry, its tests, and a screenshot from an empty profile.
- **Approval wording:** the text for each kind, its tests, and a screenshot of a file-change Approval.
- **Offline computers:** the devices page and sidebar with the group closed and open, and the tests.
- **Gates:** results for TypeScript and Rust, with any failures verbatim.
- **Commits:** your commits and the pushed remote commit.
- **Docs:** documentation changes you think are needed.
- **Status:** anything left undone and why, and which completion level the work reached.
