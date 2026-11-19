# Task: Release v0.1.0-alpha.4 (Windows, the First One-Click Update)

**Where it runs.** On Windows, with SSH to us-vps-01 for the upload. The Owner develops and releases only on Windows for now (AD-13). This release builds no Mac or Android package and deploys no service.

**Branch and worktree.**

- Fetch first, with tags.
- **Merge W0d first,** if `origin/main` does not yet contain `fix/w0-small-fixes` (accepted 2026-11-19 at `27c759a`; `w0-small-fixes.md`):
  - In a clean worktree on `main`, merge `origin/fix/w0-small-fixes` with a merge commit. The branch already contains `main`, so no conflict is expected; stop on any conflict.
  - On the merge commit, run `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`, and `cargo test --locked` in `apps/desktop/src-tauri`.
  - Push `main`. This push needs the Owner's approval; the starting message may give it.
- Then start from that `origin/main`.
- Create branch `release/v0.1.0-alpha.4` in worktree `E:/Projects/Software/agenthub/release-v0.1.0-alpha.4`. D: ran out of space during the alpha.3 gates.

**Why this task exists.**

- alpha.4 brings the Windows work since alpha.3 to the Owner's installed app: model control, faster sending, the sandbox fix and the W0 fixes.
- It is also the first real one-click update (U1; 05 §6). Since task 1c, the installed alpha.3 has carried the update source. alpha.4 must reach it through the app's own "check for updates", not through a manual install.
- **You do every step yourself** (the Owner, 2026-11-19): signing, uploading, the update in the installed app, and the acceptance checks. The Owner types the signing password once, the first time (goal 5), and otherwise only reads your report and answers the approvals listed under Boundaries.
- alpha.3's lesson: every desktop build that is meant for users must itself carry the update source (`release-v0.1.0-alpha.3.md`, "Notes for the next release prompt").

**References** (read with `git show origin/ux/design:<path>`):

- `docs/DEVELOPMENT-PROCESS.md` §3 and §7
- `docs/ux-redesign/05-desktop-update.md` §4, §5.2–§5.8, §6 and §7
- `docs/release/codetether-update.key.pub`: the update public key
- The last release: `docs/reviews/release-alpha3-prompt-r2.md` and its review `release-v0.1.0-alpha.3.md`
- The update-source build: `docs/reviews/release-alpha3-update-source-prompt.md` and its report `D:/Projects/Software/agenthub-archive/alpha3-update-source-windows-report.md`. They give the binary check, the backup and the install procedure.
- SSH to us-vps-01, and the rules for the other projects there: `docs/reviews/b0-relay-go-live-prompt.md` and its report `D:/Projects/Software/agenthub-archive/b0-report.md`
- The manual install, for the fallback only: `docs/reviews/windows-install-update-prompt.md`
- What ships, and what each review carries to alpha.4 acceptance:
  - `fix-w0-local-execution.md`
  - `d2-model-control.md`
  - `b3a-send-speed.md`
  - `w0-11-windows-sandbox.md`
  - `w0-small-fixes.md`

Before starting, confirm this file has 4 second-level headings and that the last one is "Report".

## Goals

**Must:**

1. **Start check.** Stop and tell the Owner if any of these fails:
   - Since `v0.1.0-alpha.3` (`0bf8cba`), the first-parent history of `origin/main` holds exactly five merges: W0a (`9cb3e5b`), task 5 (`3a97f6f`), B3a (`8bedb8b`), the W0-11 fix (`49dcd89`) and W0d. Anything else, such as D2.5, belongs to the next release.
   - The installed app is alpha.3 with the update source: build ID `git-0bf8cbae7101`, and its desktop executable contains the public key (task 1c's check).
   - SSH to us-vps-01 works non-interactively with the access this computer already has.
   - Record the free space on D: and E:.
2. **Version and changelog** on the release branch.
   - **Version:** run `pnpm version:set 0.1.0-alpha.4`, then `pnpm version:check`. Android stays at `0.1.0-alpha.3`, because this release ships no APK. Say so in the report.
   - **`CHANGELOG.md`:** add a `v0.1.0-alpha.4` entry above alpha.3. List the user-visible changes since alpha.3, in Simplified Chinese, with no stage codes or internal terms. Cover at least:
     - choosing the model and the reasoning strength for each conversation
     - the warning when the current model is not available to this account, and the failure that leads to the model picker
     - the message appearing as soon as it is sent, much faster follow-ups, and a failed send that is marked and returns its text
     - an empty conversation that failed on its first message after a restart (fixed)
     - Codex commands that could not run in the Windows sandbox when CodeTether was started from certain terminals (fixed)
     - newer Claude Code versions accepted, with a specific reason when one is not
     - the dialog when the local service stops, with a restart
     - signing in from the first-run screens
     - file-change Approvals no longer called commands
     - offline remote computers kept in one closed group
     - a correction to alpha.3's line that the installer has no update source: alpha.3 installs from 2026-11-16 on, and every later version, update from inside the app
   - **Release notes:** write the same entry as plain text to `D:/Projects/Software/agenthub-archive/release-v0.1.0-alpha.4/notes.txt`. The About page shows six lines before "more" (05 §4), so put the six most useful lines first.
   - Commit both on the release branch.
3. **Quality gate on the release branch,** in this order:
   - `pnpm typecheck`, `pnpm lint`, `pnpm build`, then `pnpm test`
   - `cargo test` in `packages/supervisor-mobile`
   - `cargo test` in `apps/desktop/src-tauri`. Build the Host sidecar first with `pnpm desktop:sidecar`.
   - the Android Gradle gate (`testDebugUnitTest lint assembleDebug assembleDebugAndroidTest`), because task 5 changed the Rust core
   - `pnpm format:check` for the files you changed

   Then push the release branch.

4. **`main` and the tag,** with the Owner's approval (the starting message may already give it):
   - Fast-forward `main` to the release branch and push it.
   - Create and push the annotated tag `v0.1.0-alpha.4`.
5. **The signed build.**
   - **The password, stored once** (the Owner's decision, 2026-11-19).
     - Look for `%USERPROFILE%/.codetether-release/update-key-password.dpapi`. If it exists, use it.
     - If it does not, open a visible window on the Owner's desktop that asks for the password as a secure string, and tell the Owner in one line that it is waiting.
     - Save the password encrypted with Windows DPAPI for the current user (`ConvertFrom-SecureString` without a key) to that file. Restrict the folder to the current user.
     - That file is the only place the password is kept. It never appears in plain text on disk, in a log, in an argument list or in your output.
   - **The key file.**
     - Find the private key by its file name, `codetether-update.key` (the private half of `codetether-update.key.pub`), outside the repository, without opening it.
     - If there is not exactly one, ask for its path in the same window.
     - Record the path, which is not secret, in `%USERPROFILE%/.codetether-release/update-key-path.txt`.
   - **The script.** Write `D:/Projects/Software/agenthub-archive/release-tools/build-signed.ps1`, reusable for later releases. It takes the worktree and the version as parameters. It:
     - decrypts the password straight into `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, and sets `TAURI_SIGNING_PRIVATE_KEY` to the key's path, for its own process only
     - sets `CODETETHER_UPDATE_BASE_URL=https://codetether.org/updates`; `CODETETHER_UPDATE_PUBKEY` to the exact content of `docs/release/codetether-update.key.pub`, with no trailing newline; and `CODETETHER_UPDATE_NOTES` from `notes.txt`
     - runs `pnpm release:desktop:windows-x64`, then `pnpm release:update-manifest`, in the worktree at the tag
     - clears all five variables at the end, even on failure
     - writes a log, and checks before it exits that the log does not contain the password
     - uses no transcript and no command tracing
   - **A wrong password.** If signing fails because of the password, delete the stored file, ask once more through the window, and stop if the second try fails.
6. **Check the update files.**
   - **The build:**
     - The build ID is `git-` followed by the tag commit's first 12 characters, with no `dirty` suffix.
     - The built desktop executable contains the public key and the base URL. Report the match counts; each must be at least 1.
   - **The output.** `output/release/<commit>/alpha/` holds the installer, its `.sig`, `update-windows-x64.json` and `latest.json`.
   - **`latest.json`:**
     - Its version is `0.1.0-alpha.4`.
     - It lists only `windows-x86_64`; a missing macOS entry is expected (05 §5.7).
     - Its URL lies under `https://codetether.org/updates/alpha/0.1.0-alpha.4/`.
     - Its signature equals the `.sig` file.
   - **The signature:**
     - Its key ID matches the public key's (`39A9367FBD7A5F67`). Decode both, and say how.
     - Record the installer's size and SHA-256.
7. **Back up before the update,** while the app keeps running.
   - **The database:** take a consistent copy with SQLite's online backup API, and check the copy with `PRAGMA integrity_check`.
   - **The program files:** copy them.
   - Record checksums, and restrict the backup folder to the current user, as task 1c did.
   - **The rollback target:** keep the alpha.3 installer with the update source, `E:/Projects/Software/agenthub/release-alpha3-windows-build/CodeTether_0.1.0-alpha.3_x64-setup.exe` (SHA-256 `a2020948…3df7`).
8. **Upload to us-vps-01** over the SSH access this computer already has.
   - **Look first, without changing anything:**
     - how the web server serves `https://codetether.org/`
     - where its document root is
     - whether a file placed under `updates/alpha/` would be served as it is
   - **Upload order:**
     - the installer and its `.sig` to `updates/alpha/0.1.0-alpha.4/`
     - then `latest.json` to `updates/alpha/`, written under a temporary name and renamed, so that no client sees a manifest that points to a missing file
   - **Permissions:** the files must be readable by the web server. Change no other website file.
   - **If serving `/updates/` needs a web server configuration change:**
     - Ask the Owner first.
     - Back up the configuration, test it, and reload rather than restart.
     - Check that the website and the other projects on the server are as healthy as before.
   - **Check over HTTPS:**
     - `https://codetether.org/updates/alpha/latest.json` serves the new content.
     - The installer URL answers 200, and the downloaded file's SHA-256 matches.
   - **Record** in the report what you created on the server, so that the next release reuses it. This also closes Owner action 8.
9. **The one-click update in the installed app.**
   - **Use the app as the Owner started it.** If it is not running, start it the way the Owner does: through Explorer, using the Start-menu shortcut. Never start it with `Start-Process` from your own environment (`w0-11-windows-sandbox.md`, carried item 3).
   - **First,** check through the Host's API that no conversation is running or waiting.
   - **Drive the window** with Windows UI Automation or an equivalent that clicks the real controls: Settings, then About, then check for updates, then update to `0.1.0-alpha.4`.
   - **Record** each step with a screenshot, including any SmartScreen prompt (05 §6).
   - **After the app reopens,** check:
     - The build ID is the tag's.
     - The Host on `127.0.0.1:4317` stays healthy for more than 60 seconds.
     - Migration 026 has been applied.
     - The Host's own backup `backups/<UTC time>-0.1.0-alpha.3/` exists with three files (05 §5.4).
     - The counts of projects and conversations are unchanged. `machine-credentials` and the earlier backups are kept.
     - About shows alpha.4, and one more check reports that the app is up to date.
   - **If the update fails:**
     - Record the exact text and state, keep the logs, and do not retry blindly.
     - Then install the same signed installer with NSIS `/S /UPDATE`, as task 1c did, so that acceptance can go on.
     - The failure becomes its own fix task.
10. **The acceptance checks, run by you** on the installed alpha.4.
    - **How:**
      - Drive the real window as in goal 9, and read Host-side facts where that helps.
      - Take a screenshot for each check.
      - Use W0's existing scratch project and conversations. Add no project, and leave the Owner's other projects and conversations alone.
    - **The checklist.** Write `D:/Projects/Software/agenthub-archive/release-v0.1.0-alpha.4/acceptance-checklist.md` in Simplified Chinese. For each check, give what was done, what was expected, what happened, and the screenshot.
    - **The checks:**
      - **Model control** (`d2-model-control.md`, "Carried to alpha.4 acceptance"):
        - Unarchive a W0 scratch conversation that stores `gpt-6.2-sol`. It shows "不在此账号的可用模型中".
        - Switch to `gpt-6.1-sol` through the failure card, and the next Turn runs with it.
        - Older Codex and Claude Code conversations, including an imported one, show no warning.
        - Change the reasoning strength once.
      - **Sending** (`b3a-send-speed.md`, carried item 5):
        - In the real window, a message appears at once, and so does a follow-up.
        - Close the window to the tray, reopen it from the tray icon, and send again.
        - Quit from the tray, start the app again through Explorer, then send the first message in an empty conversation created before the quit.
      - **The sandbox** (`w0-11-windows-sandbox.md`):
        - A Turn runs a command and a test in the scratch project, with no "registered Core" error.
        - An Approval for a test runner that starts child processes is expected until W17.
      - **The Host stops** (`w0-small-fixes.md`, carried item 1):
        - With nothing running, end the installed `codetether-host.exe`. The dialog "CodeTether 本地服务已停止" appears.
        - Choose "重启 CodeTether", and the app comes back with the same data.
      - **Offline computers** (W0d goal 4): the devices page and the sidebar show this computer first, and the two offline computers in one closed group. Open the group once, then close it again.
      - **Approval wording:** when Codex asks to change a file in the scratch project, the Composer says "AI 工具请求修改文件". Reject it.
      - **Claude Code** (`fix-w0-local-execution.md`): the installed Claude Code is admitted, or the dialog gives a specific reason.
    - **Codex trust entries.**
      - Before the first Turn, record Codex's trust entries in the Owner's Codex configuration.
      - Afterwards, remove only the entries that your Turns added, and list them in the report. The Owner approves this for this task.
    - **If a check cannot be automated,** say which one and why, and leave it for the Owner. Do not mark it passed.

**Should:**

11. **Clean up,** as alpha.3 did.
    - List the merged branches and worktrees, and delete the local ones.
    - List the merged remote branches in the report, but do not delete them.
    - Never delete `ux/design`, `docs/english`, `i1/ipad-app`, `spike/*`, `archive/*` or `phase8d/*`.
    - Never delete a branch with commits not in `main`, or one that a running or paused task uses, such as D2.5's or task 1b's.
    - Leave any worktree that has uncommitted changes, and report it.

## Known facts

- **What ships.** Since alpha.3 (`0bf8cba`), `main` gained:
  - W0a (`9cb3e5b`)
  - task 5 (`3a97f6f`)
  - B3a (`8bedb8b`)
  - the W0-11 fix (`49dcd89`)
  - W0d

  D2.5 is not in this release; it merges after the tag.

- **Migrations.**
  - Task 5 adds migration 026 (`conversation_model_switching`). Verify on the release branch that it is the only migration since alpha.3.
  - After the update, alpha.3 cannot open the database (05 §5.5). Going back means reinstalling the alpha.3 installer and restoring the backup from goal 7, or the Host's own backup.
- **Where the installed app checks.**
  - alpha.3 checks `https://codetether.org/updates/alpha/latest.json`.
  - Today that URL answers 404, and "check for updates" shows "暂时无法检查更新，请稍后再试" (task 1c's report).
  - This release's `latest.json` replaces the platform-less alpha.3 file of Owner action 8.
- **How the signed build works.**
  - `pnpm release:desktop:windows-x64` (`apps/distribution/src/build.mjs`) requires a clean tree.
  - It makes signed update files only when all four variables are set (`apps/distribution/src/update-manifest.mjs`); with only some of them it fails. It writes to `output/release/<commit>/`.
  - Tauri accepts the private key as a file path in `TAURI_SIGNING_PRIVATE_KEY`.
  - Without `CODETETHER_UPDATE_NOTES`, the notes say only "CodeTether 0.1.0-alpha.4 更新。"
  - `pnpm release:update-manifest` merges the platform fragments into `latest.json`.
- **The update source is compiled in.**
  - `CODETETHER_UPDATE_BASE_URL` and `CODETETHER_UPDATE_PUBKEY` are read with `option_env!` at build time. The signed build sets both.
  - The gates' ordinary builds do not need them, and those builds are not for users.
- **The signing key.**
  - The Owner generated it on 2026-11-15 on this computer, outside the repository, protected by a password. The public key's ID is `39A9367FBD7A5F67`.
  - The installed alpha.3 trusts only this key, so a new key would break the update path. Never generate a replacement.
- **us-vps-01.**
  - SSH access from this computer was set up for B0.
  - The server also hosts the website and other projects (03 §6). Ask before anything that could affect them.
  - SSH has timed out during the banner exchange before. Make each upload step safe to repeat.
- **Driving the app.** The window is a WebView2 page, and its controls are exposed to Windows UI Automation. The task dialog for a stopped Host and the tray icon are native Windows controls.
- **Start the app the way the Owner does** (`w0-11-windows-sandbox.md`, carried item 3): through Explorer or the Start menu. If a script must start it, remove every `CODEX_*` variable from its environment first.
- **Known noise.** After task 1c's install, the Control Plane rejected the installed app's presence report (`4xx`). It cleared after a re-login on 2026-11-17. If a health check shows it again, record it; it does not block this release.
- **Docs.** `ux/design` is the source for `docs/`. Do not merge it here, and do not edit `docs/` or `AGENTS.md` on the release branch.

## Boundaries

- **Decide yourself:**
  - the CHANGELOG wording
  - the build directories
  - how to diagnose and retry build problems
  - how to drive the window and the native dialogs
  - the folder layout under the website's `updates/` directory
  - how to decode and compare the key IDs
  - installing the same signed installer manually if the one-click update fails (goal 9)
- **Ask the Owner first:**
  - pushing `main`, and creating or pushing the tag, unless the starting message approves them
  - any web server configuration change on us-vps-01
  - any code change needed to pass a check, and any merge conflict
- **Do not:**
  - print, copy, log or transmit the signing private key or its password. Store the password only in the one DPAPI file of goal 5. The key never leaves this computer.
  - generate a new signing key
  - change other website files, or restart services on us-vps-01
  - force-push, rebase pushed branches or rewrite history
  - build or install a Mac or Android package, or deploy the Relay or the Control Plane
  - add projects to the installed app, or touch conversations other than W0's scratch ones
  - edit `docs/` or `AGENTS.md`
  - delete the alpha.3 installers or any backup
  - delete remote branches
  - read or print other credentials

## Report

Write to `D:/Projects/Software/agenthub-archive/release-v0.1.0-alpha.4-report.md`:

- **Start check:** the five merges, the installed build, SSH, and the free space.
- **Release branch:** its commits, the version change, and the full CHANGELOG entry.
- **Gates:** the result of each check, with any failures verbatim.
- **`main` and the tag:** the W0d merge commit, and the remote commits.
- **Signing:** whether the password was stored in this run or reused, and the key path's folder. Never the password or the key.
- **Signed build:** the build ID, the match counts, each file with its size and SHA-256, the content of `latest.json`, and the key-ID comparison.
- **Backup:** its location, the integrity check, and the checksums.
- **Upload:** what you created on the server, any configuration change, and the HTTPS results.
- **One-click update:** each step with screenshots, any SmartScreen prompt, and the checks after the update. If it failed: the failure, and the fallback.
- **Acceptance:** each check's result with its screenshot, the trust entries added and removed, and any check left for the Owner.
- **Cleanup:** the branches and worktrees deleted and kept, with reasons, and the merged remote branches.
- **Status:** anything left undone and why, and which completion level the work reached.
