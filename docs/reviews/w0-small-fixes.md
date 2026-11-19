# Review: `fix/w0-small-fixes` (2026-11-19)

**Branch.** Round 1 pushed at `1983291`, round 2 at `27c759a`. Task prompt: `w0-small-fixes-prompt.md`. Report: `D:/Projects/Software/agenthub-archive/w0-small-fixes-report.md`.

- The work started from `3a97f6f` (`main` after task 5). `1983291` merges `main` at `49dcd89`, which adds B3a and the W0-11 fix.
- `8c29fdc` adds the Host-stop dialog and its restart action (desktop shell).
- `c6e848e` words the Composer by the Approval's kind.
- `163002c` adds the sign-in entry on the first-run screens.

**Gates (as reported, on the merge commit):**

- typecheck, lint and build passed
- `pnpm test`: 2,529 passed, 14 skipped, 0 failed
- `cargo test --locked` in `apps/desktop/src-tauri`: 86 passed
- Prettier, rustfmt and `git diff --check` passed on the changed files

**Verdict.** Goals 1–3 accepted, no must-fix. Goal 4 was not done, and that is not the agent's fault.

- Goal 4 (offline remote computers in a closed group) was added to the prompt on 2026-11-18 (`fbcaa6b`). It was never published to `ux/design`, because pushing `ux/design` was still waiting for the Owner's approval.
- The agent therefore worked from the published three-goal version, and did all of it.
- Round 2 adds goal 4 on the same branch.

## Checked in this review

- **The Host-stop dialog (goal 1).**
  - **Which text.** The new dialog appears only when the Host exits after the window has opened. A Host that dies during startup keeps the existing "CodeTether 启动失败" text. A Rust test covers both cases.
  - **The text.** The title is "CodeTether 本地服务已停止". The body is "已保存的项目和对话仍保留在这台电脑上。你可以重启 CodeTether，或安全退出。" The buttons are "重启 CodeTether" and "退出 CodeTether".
  - **The choice.**
    - Exit is the default button, and Esc or closing the dialog also exits.
    - The app restarts only when the user picks restart; a test covers that.
    - During a Windows session end, it never restarts.
  - **How the restart runs.**
    - It runs after the normal bounded shutdown. The Host's process tree is drained and the tray icon removed first.
    - Then Tauri relaunches the app, which starts its Host as it does at a normal launch.
  - **Other paths.**
    - A Host found dead after the computer wakes from sleep now leads to the same dialog.
    - If Windows cannot show the dialog, a plain message box says to reopen CodeTether, and the app exits.
  - **Scope.** The restart can be reached only from this dialog. The change adds no Tauri command, Web capability or permission. The shell's changes are confined to `host_supervisor.rs`, `startup_error.rs` and one `windows-sys` feature.
  - **On a real device,** with a development build:
    - Stopping its Host and choosing restart brought back the same project and conversation from the same isolated database.
    - Choosing safe exit released both of its ports.
- **First-run sign-in (goal 2).**
  - "已有账号？登录" appears above every setup step until setup is finished. It opens the existing account page.
  - While setup is unfinished, the account page shows "返回设置向导".
  - The sign-in flow is unchanged, and the setup progress did not advance.
  - DOM tests cover it, and so does a run from empty data and WebView2 folders. No email or code was submitted.
- **Approval wording (goal 3).**
  - With one pending Approval, the Composer's title follows its kind:
    - `command`: "等你批准一条命令"
    - `file-change`: "AI 工具请求修改文件"
    - `unknown`: "有操作等你批准"
  - With more than one pending Approval, it uses the neutral text.
  - The Approval dock's titles were already specific to each kind; a test now pins them.
  - What an Approval does and shows is unchanged.
  - **On a real device:** the real Codex App Server sent a real file-change Approval, while a local stand-in played the model's reply. Both texts appeared. Rejecting the change left the file untouched.
- **Isolation.**
  - The installed Host kept the same process the whole time.
  - The development build used its own Host, Supervisor and Vite ports (49219–49221), its own database and its own WebView2 folder.
  - The first attempt collided with the installed app's Supervisor port `4318` (`EADDRINUSE`). The installed app was not changed.
- **Merging.** The branch already contains `main` at `49dcd89`.

## Carried items (not blocking)

1. **The dialog in the installed build.** The dialog uses the Windows task dialog, which needs the Common Controls 6 that the Tauri application manifest declares. The development build shows that it works. alpha.4 acceptance repeats goal 1 once on the installed app.
2. **Signing in with a real account from the first-run screens** was not tried, because the development build has no account service. The account page itself did not change.
3. **The development-port backlog item** (from B3a) should also cover the Supervisor port. The development sidecar defaults to `4318`, which the installed app holds.

## Round 2 (2026-11-19)

**Commit.** `27c759a`, on the same branch.

- It changes only the devices page and the sidebar, adds one component (`offline-computers-group.tsx`) and adds a DOM test.
- Goals 1–3 are untouched.

**Gates (as reported):**

- typecheck, lint and build passed
- `pnpm test`: 2,531 passed, 14 skipped, 0 failed
- `cargo test --locked` in `apps/desktop/src-tauri`: 86 passed
- Prettier and `git diff --check` passed on the changed files

**Verdict.** Goal 4 accepted, no must-fix. W0d is complete.

- **The group.**
  - On the devices page and in the sidebar, offline remote computers go into one row, "其他电脑 · N 台离线", which starts closed.
  - Opening it shows the existing cards and tree entries, with their detail links and actions.
  - Online and connecting computers stay outside the group. With no offline remote computer, there is no row.
- **This computer first.** The existing sort already put it first. Its card now says "这台电脑无需账号即可使用。"
- **The account.**
  - The phones-and-tablets section says "账号用于将手机或平板与电脑配对。其他电脑也可以直接配对，无需账号。"
  - This corrects the prompt, which said the account is for pairing phones and other computers. Computers pair without an account today (04, "Account"); that changes with E1 (04 E10).
- **Open or closed.**
  - Each surface keeps its own state in `sessionStorage`, wrapped in try/catch, so each launch starts closed.
  - No Host data, pairing or trust changed, and opening the group makes no request.
- **Tests.** Two DOM tests mount the real devices page and the real sidebar. They cover:
  - the group closed, showing 2
  - both computers shown when it is opened
  - online and connecting computers outside the group
  - a computer that comes online leaving the group, with the count dropping
  - no group when there is only this computer
  - each surface keeping its own state
- **Screenshots** use synthetic data in a static preview. Nothing was paired, and the installed app was not used. alpha.4 acceptance checks the Owner's two offline computers.

**Carried item.** In the sidebar, the group does not open by itself when the current conversation belongs to an offline computer, so the tree cannot show where the user is. This is small; add it to D3a (task 10) when it is dispatched.

## Next

Merge into `main` with a merge commit, with the Owner's approval to push `main`. The alpha.4 release agent does this as its first step (`release-alpha4-prompt.md`) and releases from that `main`.
