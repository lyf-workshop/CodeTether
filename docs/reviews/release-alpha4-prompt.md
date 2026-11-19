# Task: Release v0.1.0-alpha.4 (Windows, the First One-Click Update)

**Where it runs.** On Windows. The Owner develops and releases only on Windows for now (AD-13). This release builds no Mac or Android package and deploys no server.

**Branch and worktree.**

- Start from `origin/main` after `fix/w0-small-fixes` (W0d) has merged. Fetch first, with tags.
- Create branch `release/v0.1.0-alpha.4` in worktree `E:/Projects/Software/agenthub/release-v0.1.0-alpha.4`. D: ran out of space during the alpha.3 gates.

**Why this task exists.**

- alpha.4 brings the Windows work since alpha.3 to the Owner's installed app: model control, faster sending, the sandbox fix and the W0 fixes.
- It is also the first real one-click update (U1; 05 §6). Since task 1c, the installed alpha.3 has carried the update source. alpha.4 must reach it through the app's own "check for updates", not through a manual install.
- alpha.3's lesson: every desktop build that is meant for users must itself carry the update source (`release-v0.1.0-alpha.3.md`, "Notes for the next release prompt").

**References** (read with `git show origin/ux/design:<path>`):

- `docs/DEVELOPMENT-PROCESS.md` §3 and §7
- `docs/ux-redesign/05-desktop-update.md` §4, §5.2–§5.8 and §6
- `docs/release/codetether-update.key.pub`: the update public key
- The last release: `docs/reviews/release-alpha3-prompt-r2.md` and its review `release-v0.1.0-alpha.3.md`
- The update-source build: `docs/reviews/release-alpha3-update-source-prompt.md` and its report `D:/Projects/Software/agenthub-archive/alpha3-update-source-windows-report.md`. They give the binary check, the backup and the install procedure.
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

4. **`main` and the tag.** With the Owner's approval:
   - Fast-forward `main` to the release branch and push it.
   - Create and push the annotated tag `v0.1.0-alpha.4`.
5. **The signed build, which the Owner runs.**
   - **The script.** Write `D:/Projects/Software/agenthub-archive/release-v0.1.0-alpha.4/build-signed.ps1`. Show it to the Owner before they run it in their own terminal, in the release worktree at the tag.
   - **Signing inputs:**
     - It asks for the private key file's path and its password with `Read-Host`, the password as a secure string.
     - It sets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` for that process only.
     - It never echoes them, writes them to a file, or records a transcript.
   - **Public inputs:**
     - `CODETETHER_UPDATE_BASE_URL=https://codetether.org/updates`
     - `CODETETHER_UPDATE_PUBKEY`: the exact content of `docs/release/codetether-update.key.pub`, with no trailing newline
     - `CODETETHER_UPDATE_NOTES`, read from `notes.txt`
   - **What it runs:** `pnpm release:desktop:windows-x64`, then `pnpm release:update-manifest`. Afterwards it clears all five variables, and its log contains none of the private inputs.
   - **Your part:** never run the script yourself, never read the key file, and never ask for the password.
6. **Check the update files** after the Owner's build.
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
   - **For the upload:** copy the files to `D:/Projects/Software/agenthub-archive/release-v0.1.0-alpha.4/upload/`, laid out as on the server: `alpha/latest.json`, and the installer and its `.sig` under `alpha/0.1.0-alpha.4/`.
7. **Back up before the update.**
   - With the Owner's go-ahead, the Owner quits CodeTether from the tray.
   - Back up the data directory and the program with checksums, following task 1c's procedure.
   - The Owner then starts CodeTether again from the Start menu.
   - Keep the alpha.3 installer with the update source as the rollback target: `E:/Projects/Software/agenthub/release-alpha3-windows-build/CodeTether_0.1.0-alpha.3_x64-setup.exe`, SHA-256 `a2020948…3df7`.
8. **The Owner uploads.**
   - The Owner copies `upload/alpha/0.1.0-alpha.4/` to us-vps-01 first, and `upload/alpha/latest.json` last, so that no client sees a manifest that points to a missing file.
   - This also closes Owner action 8.
   - Then check over HTTPS:
     - `https://codetether.org/updates/alpha/latest.json` serves the new content.
     - The installer URL answers 200, and the downloaded file's SHA-256 matches.
9. **The one-click update, done by the Owner.**
   - **Steps.** In the installed alpha.3, started from the Start menu, with no conversation running or waiting: Settings, then About, then check for updates, then update to `0.1.0-alpha.4`.
   - **Record** what the Owner sees at each step, including any SmartScreen prompt (05 §6), with screenshots.
   - **After the app reopens,** check:
     - The build ID is the tag's.
     - The Host on `127.0.0.1:4317` stays healthy for more than 60 seconds.
     - Migration 026 has been applied.
     - The Host's own backup `backups/<UTC time>-0.1.0-alpha.3/` exists with three files (05 §5.4).
     - The counts of projects and conversations are unchanged. `machine-credentials` and the earlier backups are kept.
     - About shows alpha.4, and one more check reports that the app is up to date.
   - **If the update fails:**
     - Record the exact text and state, keep the logs, and do not retry blindly.
     - With the Owner's go-ahead, install the same signed installer manually with NSIS `/S /UPDATE`, as task 1c did, so that acceptance can go on.
     - The failure becomes its own fix task.
10. **The acceptance checklist.**
    - **The file.** Write `D:/Projects/Software/agenthub-archive/release-v0.1.0-alpha.4/acceptance-checklist.md` in Simplified Chinese. For each check, give what to do and what to expect.
    - **Who runs it.** The Owner runs it on the installed alpha.4, started from the Start menu. You read Host-side facts where that helps, but you do not drive the Owner's window.
    - **The checks:**
      - **Model control** (`d2-model-control.md`, "Carried to alpha.4 acceptance"):
        - Unarchive a W0 scratch conversation that stores `gpt-6.2-sol`. It shows "不在此账号的可用模型中".
        - Switch to `gpt-6.1-sol` through the failure card, and the next Turn runs with it.
        - Older Codex and Claude Code conversations, including an imported one, show no warning.
        - Change the reasoning strength once.
      - **Sending** (`b3a-send-speed.md`, carried item 5):
        - In the real window, a message appears at once, and so does a follow-up.
        - Close the window to the tray, reopen it from the tray, and send again.
        - Quit, start again, then send the first message in an empty conversation created before the quit.
      - **The sandbox** (`w0-11-windows-sandbox.md`):
        - A Turn runs a command and a test in a project, with no "registered Core" error.
        - An Approval for a test runner that starts child processes is expected until W17.
      - **The Host stops** (`w0-small-fixes.md`, carried item 1):
        - With nothing running, end `codetether-host.exe` in Task Manager. The dialog "CodeTether 本地服务已停止" appears.
        - Choose "重启 CodeTether", and the app comes back with the same data.
      - **Offline computers** (W0d goal 4): the devices page and the sidebar show this computer first, and the two offline computers in one closed group.
      - **Approval wording:** when Codex asks to change a file, the Composer says "AI 工具请求修改文件".
      - **Claude Code** (`fix-w0-local-execution.md`): the installed Claude Code is admitted, or the dialog gives a specific reason.
    - **Results** go into the report once the Owner has run the checks.

**Should:**

11. **Clean up,** as alpha.3 did.
    - List the merged branches and worktrees. Delete the local ones.
    - Delete remote branches only after the Owner confirms the list.
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
  - Without `CODETETHER_UPDATE_NOTES`, the notes say only "CodeTether 0.1.0-alpha.4 更新。"
  - `pnpm release:update-manifest` merges the platform fragments into `latest.json`.
- **The update source is compiled in.**
  - `CODETETHER_UPDATE_BASE_URL` and `CODETETHER_UPDATE_PUBKEY` are read with `option_env!` at build time. The signed build sets both.
  - The gates' ordinary builds do not need them, and those builds are not for users.
- **Start the app the way the Owner does** (`w0-11-windows-sandbox.md`, carried item 3): from the Start menu or Explorer. If a script must start it, remove every `CODEX_*` variable from its environment first.
- **Known noise.** After task 1c's install, the Control Plane rejected the installed app's presence report (`4xx`). It cleared after a re-login on 2026-11-17. If a health check shows it again, record it; it does not block this release.
- **The signing key.** The private key and its password stay with the Owner (05 §7, decision 2). The public key's ID is `39A9367FBD7A5F67`.
- **Docs.** `ux/design` is the source for `docs/`. Do not merge it here, and do not edit `docs/` or `AGENTS.md` on the release branch.

## Boundaries

- **Decide yourself:**
  - the CHANGELOG wording
  - the build directories
  - how to diagnose and retry build problems
  - the checklist's layout
  - how to decode and compare the key IDs
- **Ask the Owner first:**
  - pushing `main`, and creating or pushing the tag
  - quitting the installed app (goal 7)
  - the manual-install fallback (goal 9)
  - any code change needed to pass a check, and any merge conflict
  - deleting remote branches
- **Do not:**
  - run the signed build yourself
  - read, print, copy or ask for the signing private key or its password
  - log into us-vps-01 or upload anything
  - force-push, rebase pushed branches or rewrite history
  - build or install a Mac or Android package, or deploy the Relay or the Control Plane
  - edit `docs/` or `AGENTS.md`
  - delete the alpha.3 installers or any backup
  - read or print other credentials

## Report

Write to `D:/Projects/Software/agenthub-archive/release-v0.1.0-alpha.4-report.md`:

- **Start check:** the five merges, the installed build, and the free space.
- **Release branch:** its commits, the version change, and the full CHANGELOG entry.
- **Gates:** the result of each check, with any failures verbatim.
- **`main` and the tag:** the remote commits.
- **Signed build:** the build ID, the match counts, each file with its size and SHA-256, the content of `latest.json`, and the key-ID comparison.
- **Backup:** its location and checksums.
- **Upload check:** the HTTPS results.
- **One-click update:** each step as the Owner saw it, with screenshots and any SmartScreen prompt, and the checks after the update. If it failed: the failure, and the fallback.
- **Acceptance:** each checklist result, once the Owner has run them.
- **Cleanup:** the branches and worktrees deleted and kept, with reasons.
- **Status:** anything left undone and why, and which completion level the work reached.
