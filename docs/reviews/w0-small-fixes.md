# Review: `fix/w0-small-fixes` (2026-11-19)

**Branch.** Pushed at `1983291`. Task prompt: `w0-small-fixes-prompt.md`. Report: `D:/Projects/Software/agenthub-archive/w0-small-fixes-report.md`.

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

## Round 2 (requested 2026-11-19)

Implement goal 4 of the prompt on the same branch, as published on `ux/design`: offline remote computers go into one closed group on the devices page and in the sidebar, with this computer first.

- The development database has no paired computers, so the tests carry it.
- The check with the Owner's two offline computers happens at alpha.4 acceptance.

## Next

After round 2 is accepted, merge into `main` with a merge commit, with the Owner's approval to push `main`. The alpha.4 release (`release-alpha4-prompt.md`) starts from that `main`.
