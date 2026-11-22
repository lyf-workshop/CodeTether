# Task: Release v0.1.0-alpha.6 (Windows, D3b's Desktop Usability Fixes)

**Where it runs.** On Windows, with SSH to us-vps-01 for the upload. The Owner develops and releases only on Windows for now (AD-13). This release builds no Mac or Android package and deploys no service.

**Branch and worktree.**

- Fetch first, with tags.
- **Merge D3b first,** if `origin/main` does not yet contain `feat/d3b-desktop-usability` (approved 2026-11-22 at `4773611`; `d3b-desktop-usability.md`):
  - The branch already contains `main` at `5aa8ae5`. In a clean worktree on `main`, merge `origin/feat/d3b-desktop-usability` with a merge commit (`--no-ff`). Stop on any conflict.
  - The merge commit's tree must equal `4773611`'s tree. Check it, and stop if it does not.
  - On the merge commit, run `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`, and `cargo test --locked` in `apps/desktop/src-tauri` (build the Host sidecar first with `pnpm desktop:sidecar`).
  - Push `main`. This push needs the Owner's approval; the starting message may give it.
- Then start from that `origin/main`.
- Create branch `release/v0.1.0-alpha.6` in worktree `E:/Projects/Software/agenthub/release-v0.1.0-alpha.6`.

**Why this task exists.**

- alpha.6 brings D3b, the desktop usability pass, to the Owner's installed app. Its most visible changes:
  - The window reopens with its last size, position and maximized state. The Owner asked for this on 2026-11-21.
  - Long project paths keep the project's folder name.
  - Commands show as they ran, in the timeline, in 工具输出 and in the Approval.
  - The project page is calmer, and the Approval box is compact.
  - Dates use one local format, with no ISO timestamps.
  - A computer that is reconnecting stays in the offline group.
- It is the third one-click update, through the same path as alpha.4 and alpha.5.
- **You do every step yourself:** signing, uploading, the update in the installed app, and the acceptance checks. The Owner only reads your report and answers the approvals listed under Boundaries.
- **The installed app is the Owner's.** While you drive it, the Owner does not use it. Claude Code does not touch it either; it checks the installed alpha.6 hands-on after your report.

**References** (read with `git show origin/ux/design:<path>`):

- **This release's template:** `docs/reviews/release-alpha5-prompt.md` and its review `release-v0.1.0-alpha.5.md`, especially "Acceptance" and "Notes for the next release prompt"
- `docs/DEVELOPMENT-PROCESS.md` §3 and §7
- `docs/ux-redesign/05-desktop-update.md` §4, §5.2–§5.8, §6 and §7
- `docs/release/codetether-update.key.pub`: the update public key
- **What ships:** `d3b-desktop-usability-prompt.md` (goals 1 to 13) and its review `d3b-desktop-usability.md`. Decisions 4 and 5 under "Decisions on the report's limits" hand two checks to this release.

Before starting, confirm this file has 4 second-level headings and that the last one is "Report".

## Goals

**Must:**

1. **Start check.** Stop and tell the Owner if any of these fails:
   - Since `v0.1.0-alpha.5` (`5aa8ae5`), the first-parent history of `origin/main` holds exactly one merge: D3b (the merge you made, or found).
   - No migration was added since alpha.5; the latest is still 026.
   - `pnpm-lock.yaml` is unchanged since alpha.5.
   - The installed app is alpha.5: build ID `git-5aa8ae5adffc`.
   - SSH to us-vps-01 works non-interactively with the access this computer already has.
   - Record the free space on D: and E:.
2. **Version and changelog** on the release branch.
   - **Version:** run `pnpm version:set 0.1.0-alpha.6`, then `pnpm version:check`. Android stays at `0.1.0-alpha.3`, because this release ships no APK. Say so in the report.
   - **`CHANGELOG.md`:** add a `v0.1.0-alpha.6` entry above alpha.5. List the user-visible changes since alpha.5, in Simplified Chinese, with no stage codes or internal terms. Cover at least:
     - the window reopens with the size, position and maximized state it had last; it appears only when CodeTether is ready, and a maximized window opens maximized
     - long project paths keep the project's folder name
     - commands show as they ran, in the timeline, in 工具输出 and in approval requests, without the PowerShell wrapper or extra quoting; 工具输出's list previews each command
     - a more compact approval box that leaves more room for the conversation
     - the notice about Codex's unavailable default model shows only until the first message
     - dates in one local format; a Codex session imported without a title is named by its local date and time
     - the project page: search as you type, filters only once a project has more than five conversations, earlier sessions folded into one line with their count, and row actions that no longer cover the status
     - 设备 says how many items need attention and links to 待处理; 添加项目 and 配对新设备 sit at the top; project cards on a computer's page show running and waiting conversations
     - a computer that is reconnecting stays in the offline group until it connects
     - Settings' section list stays in view; clearer 关于与检查 details, where a tool's badge agrees with its version rows
     - an archived conversation's title bar says it is archived
     - plainer wording in the command palette, when adding a project, and in failure messages
   - **Release notes:** write the same entry as plain text to `D:/Projects/Software/agenthub-archive/release-v0.1.0-alpha.6/notes.txt`. About shows six lines before "more" (05 §4), so put the six most useful lines first, starting with the window.
   - Commit both on the release branch.
3. **Quality gate on the release branch,** in this order:
   - `pnpm typecheck`, `pnpm lint`, `pnpm build`, then `pnpm test`
   - `cargo test` in `packages/supervisor-mobile`
   - `cargo test` in `apps/desktop/src-tauri`. Build the Host sidecar first with `pnpm desktop:sidecar`.
   - Prettier for the files you changed

   The Android Gradle gate is not needed: nothing in `apps/android` or the Rust core changed since alpha.5. Say so in the report.

   Then push the release branch.

4. **`main` and the tag,** with the Owner's approval (the starting message may already give it):
   - Fast-forward `main` to the release branch and push it.
   - Create and push the annotated tag `v0.1.0-alpha.6`.
5. **The signed build,** with the scripts in `D:/Projects/Software/agenthub-archive/release-tools/` and the password stored for alpha.4.
   - **Before building,** assert that no `CODETETHER_W0F_*` variable is set in the process, user or machine environment. Stop if one is. This matters more now (see "W0f's isolated profile").
   - Run `build-signed.ps1` for the tag. If signing fails because of the password, follow alpha.4's rule: delete the stored file, ask once more through the window, and stop if the second try fails.
6. **Check the update files,** as for alpha.5:
   - **The build:**
     - The build ID is `git-` followed by the tag commit's first 12 characters, with no `dirty` suffix.
     - The desktop executable contains the public key and the base URL. Give the match counts.
   - **The output:** the installer, its `.sig`, `update-windows-x64.json` and `latest.json`.
   - **`latest.json`:**
     - version `0.1.0-alpha.6`
     - only the `windows-x86_64-nsis` platform
     - a URL under `https://codetether.org/updates/alpha/0.1.0-alpha.6/`
     - a signature equal to the `.sig`
   - **The key IDs** match `39A9367FBD7A5F67`.
   - Record the installer's size and SHA-256.
7. **Back up before the update,** while the app keeps running.
   - **The database:** take an online backup, and check it with `PRAGMA integrity_check`.
   - **The program files:** copy them.
   - Record checksums, and restrict the folder to the current user.
   - **The rollback target:** keep alpha.5's signed installer (SHA-256 `6e434f46…a992f`). Find it in alpha.5's release output, or download it from its URL under `updates/alpha/0.1.0-alpha.5/` and check the hash.
8. **Upload to us-vps-01,** reusing the static root `/opt/codetether/updates` and its Caddy route.
   - Upload the installer and `.sig` to `alpha/0.1.0-alpha.6/` first. Then upload `latest.json`, written under a temporary name and renamed.
   - Keep alpha.4's and alpha.5's files. Change nothing else on the server.
   - **Check over HTTPS:** `latest.json` serves the new content, and the installer answers 200 with a matching SHA-256.
9. **The one-click update in the installed app,** as for alpha.5.
   - **Start the app as the Owner does,** through Explorer or the Start menu, never from your own environment. If it is not running, start it that way.
   - **First,** check through the Host's API that no conversation is running or waiting.
   - **Before you click,** record the window's outer rectangle in physical pixels and whether it is maximized. Confirm that `window-geometry-v1.json` does not exist yet in the app's config folder.
   - **Drive the real window** with Windows UI Automation: Settings › 关于与检查 › check for updates › update. Screenshot each step.
   - **When the update restarts the app,** record:
     - when the window appears, against when the Host on `127.0.0.1:4317` reports ready
     - the window's rectangle
     - Keep sampling while the window is hidden. alpha.5's observer stopped when the window was briefly hidden.
     - The expected result is the default centered window, because alpha.5 saved nothing, and no visible window before the Host is ready.
   - **After the update,** check:
     - The build ID is the tag's.
     - The Host on `127.0.0.1:4317` stays healthy for more than 60 seconds, from the installed data folder.
     - The counts of projects, conversations and Turns are unchanged. `machine-credentials` and the earlier backups are kept.
     - About shows alpha.6, and one more check reports the app is up to date.
   - **If the update fails:** record the exact text and state, keep the logs, and do not retry blindly. Then install the same signed installer with NSIS `/S /UPDATE` so acceptance can go on. The failure becomes its own fix task.
10. **The acceptance checks, run by you** on the installed alpha.6.
    - **How:**
      - Drive the real window, and read Host-side facts where that helps.
      - Take a screenshot for each check.
      - Use W0's existing scratch project, `ta-budget-app`. Add no project, and leave the Owner's other projects and conversations alone.
      - At the end, archive the conversation you created, as alpha.5 did.
    - **The checklist.** Write `D:/Projects/Software/agenthub-archive/release-v0.1.0-alpha.6/acceptance-checklist.md` in Simplified Chinese. For each check, give what was done, what was expected, what happened, and the screenshot.
    - **The checks:**
      - **The window's saved state** (D3b goal 13; review decision 5).
        - Set the window back to the rectangle you recorded before the update. Confirm that `window-geometry-v1.json` now exists and holds only `x`, `y`, `width`, `height` and `maximized`, and quote it.
        - Close to the tray and reopen from the tray. Measure the rectangle.
        - Quit from the tray and start from the Start menu. Measure the rectangle, and confirm that the window appears only after the Host is ready.
        - Maximize, quit from the tray, and start from the Start menu.
          - Record the window's show and location events with a WinEvent hook, and capture the screen during the start.
          - The window's first visible frame is maximized. No frame shows it at its normal size, and no maximize animation plays.
          - Restore it: it returns to the saved rectangle. Then minimize and restore once: the window animation still plays.
          - Claude Code's `launch-watch2.ps1 -Burst` and `capture-burst.ps1` in `D:/Projects/Software/agenthub-archive/d3b-review-r1-2026-11-21/` do the recording. They default to Claude Code's review build, start it themselves, and watch for 6 s. Point them at the installed executable, start the app through the Start menu instead, and watch until after the Host is ready.
        - End with the window at the rectangle you recorded, maximized only if it was before the update.
      - **A Turn with one Approval** (D3b round 2 must-fix 2, should-fix 6 and 7). In a new Codex conversation in the scratch project, at the window size the Owner uses:
        - **Before sending,** note whether the default-model notice shows (see "Known facts").
        - **Run a Turn** that lists the project's files with `rg` and runs `node --test`, with one Approval. Approve it once.
        - **The message box:** use UI Automation bounding rectangles. Record its height before sending, just after sending, while running, during the Approval and after the Turn. The notice, if any, goes when the Turn starts, and the height then stays the same.
        - **Commands:** the tool rows, 工具输出's titles and list, and the Approval show each command as it ran. There is no PowerShell wrapper, no `'"'` sequence and no doubled backslash. Quote each command as shown.
        - **The Approval box:** its header is one line, and the command and time share one line. It shows no folder label, because the conversation runs in the project's folder.
        - **The timeline row and the Approval box** do not repeat each other.
      - **Paths** (D3b goal 1; round 3). On the local computer's page, at the window size the Owner uses, quote the path shown on each project card. Include the two T1a scratch projects. Each shows its whole folder name or the folder name's end, with at most one ellipsis.
      - **Pages,** briefly. Claude Code checks them in detail afterwards.
        - **设备:**
          - The banner "N 件事需要你处理" opens 待处理. Acknowledge nothing.
          - Sample 设备 for at least 75 s, and report every change to the offline group and its count (D3b goal 11; decision 4). The Linux computer that reconnects every 35 s or so stays in the group.
        - **The computer page:** 添加项目 sits in the Projects header, and 配对新设备 in the page header.
        - **Dates:** 待处理 and the sidebar show no ISO timestamp. Quote one title of an adopted untitled Codex conversation, for example "Codex 会话 · 10月20日 11:09".
        - **The scratch project's page:**
          - Search filters as you type.
          - 以前的会话 is one line with its count.
          - Hovering a row shows its actions without cutting the status.
        - **The archived alpha.5 acceptance conversation:** open it from the archived view; its top bar says it is archived. Do not restore it.
        - **Settings:** the section list stays in view while the page scrolls, and 关于与检查's 检查时间 says "检查" once.
      - **The diagnostic logs** (alpha.5's note).
        - They are still next to the database.
        - Spot-check them, including any new window-state lines: no file paths, prompts or message text.
        - The access-list check is dropped: the logs take their access list from `AppData`, like the database (`release-v0.1.0-alpha.5.md`, open item 2).
    - **Codex trust entries.**
      - Before the first Turn, record Codex's trust entries in the Owner's Codex configuration.
      - Afterwards, remove only the entries that your Turns added, and list them in the report. The Owner approves this for this task.
    - **If a check cannot be automated,** say which one and why, and leave it for the Owner. Do not mark it passed.

**Should:**

11. **Clean up.**
    - **Delete these local branches and worktrees:**
      - D3b's worktree `D:/Projects/Software/agenthub-work/feat-d3b-desktop-usability` and its local branch
      - alpha.5's release worktree
    - **Path length:** remove the pnpm links before `git worktree remove`, as alpha.5 did. If a worktree still cannot be removed, keep it and list it.
    - **Remote branches:** list the merged ones in the report, but do not delete them.
    - **Never delete:**
      - `ux/design`, `docs/english`, `i1/ipad-app`, `spike/*`, `archive/*` or `phase8d/*`
      - the worktrees `D:/Projects/Software/agenthub-work/docs-english` and `D:/Projects/Software/agenthub-work/review-detail-main`, which Claude Code uses
      - `F:/codetether-d3b-review/`, Claude Code's isolated review build
      - a branch with commits not in `main`, or one that a paused task uses, such as task 1b's
    - Leave any worktree that has uncommitted changes, and report it.

## Known facts

- **What ships.** Since alpha.5 (`5aa8ae5`), `main` gains one merge: D3b. That is five commits, from `03995ba` to `4773611`, in 107 files.
- **Migrations.** None since alpha.5. The database stays readable by alpha.5, and alpha.5 ignores `window-geometry-v1.json`. Going back still means reinstalling alpha.5's installer and restoring goal 7's backup.
- **Dependencies.** D3b adds no npm or Rust dependency. Its only manifest change turns on one feature, `Win32_Graphics_Dwm`, of the `windows` crate the desktop already uses.
- **Where the installed app checks.** alpha.5 checks `https://codetether.org/updates/alpha/latest.json`, which serves alpha.5's manifest today.
- **The release path from alpha.4 and alpha.5:**
  - `latest.json` lists `windows-x86_64-nsis`, which Tauri checks first.
  - The site is a Next.js standalone server. Update files are served by a static Caddy route, `handle_path /updates/*` to `/opt/codetether/updates`.
  - The Host's own pre-update backup is one checkpointed database file.
  - alpha.5's first offline install stopped on a dependency missing from the pnpm store. If that happens, install again with the frozen lockfile in prefer-offline mode.
- **The signing key.**
  - Its public key's ID is `39A9367FBD7A5F67`. The installed app trusts only this key, so never generate a replacement.
  - The password is stored with DPAPI for the Owner's account. `%USERPROFILE%/.codetether-release/` holds the password file and the key's path.
- **W0f's isolated profile.**
  - `CODETETHER_W0F_HOST_PORT` and `CODETETHER_W0F_DATA_DIR` move a diagnostic desktop build to another port and data folder. Any Host started on a port other than 4317 skips the production Relay.
  - D3b's window state reads `CODETETHER_W0F_DATA_DIR` when the desktop is compiled. A build made with it set would keep the installed app's window state in that folder.
  - A build meant for users must have neither variable.
- **The window's saved state** (D3b goal 13; the D3b report, "Window state verification").
  - **The file:** `window-geometry-v1.json` in Tauri's `app_config_dir()` for `com.codetether.desktop`. It holds only `x`, `y`, `width`, `height` and `maximized`.
  - **When it is saved:** when the window moves or resizes, and by the updater before it exits.
  - **With nothing saved,** the window is the configured 1440 × 900 logical, centered. On the review's 2560 × 1440 screen at 150 % that was (38, 34), 2182 × 1406 physical px.
  - **A saved rectangle falls back to that default** when it does not fit fully on a monitor, is below 1100 × 700, or is larger than the screen.
  - **Start-up:** the window starts hidden and appears when the Host is ready. A saved maximized state reveals it already maximized, with the window animation off for that reveal only.
  - **On the review's isolated build,** (304, 34), 1900 × 1250 px held through closing to the tray and reopening, and through quitting and starting again. Maximized was (−11, −11), 2582 × 1390 px.
  - **Not testable in this release:** this update runs alpha.5's updater, which saves nothing. The first alpha.6 start is therefore the default window, and keeping the rectangle through the update's own restart is first checked at the next update.
  - **The hook and the capture:** Windows PowerShell is not DPI-aware, so the WinEvent hook reports logical px (physical ÷ 1.5). The capture script is DPI-aware.
- **Commands.**
  - Codex's command string is a POSIX shell join of the program, its flags and the script.
  - The web shows the script only when quoting its words again gives the same string back. Otherwise it keeps the old display.
  - Claude Code ran all 148 real PowerShell commands in a copy of the Owner's data through it, and all displayed exactly.
  - Codex chooses the commands, so quote what shows rather than expecting exact text.
- **The Approval's folder label** is the conversation's working folder, not the command's. For a conversation that CodeTether creates, that is the project's folder, and the label is left out (`d3b-desktop-usability.md`, round 3, finding A).
- **The default model.** At alpha.5, the Owner's Codex default `gpt-6.2-astra` was not in the model list, so a new conversation showed a notice. Read `model` in the Owner's Codex configuration, read only. If it is now listed, say so: the notice is then not expected.
- **The first `node --test`** in the sandbox may fail with `spawn EPERM`, as in alpha.5. That is the `unelevated` sandbox before W17, not a release defect.
- **Start the app the way the Owner does:** through Explorer or the Start menu. If a script must start it, remove every `CODEX_*` variable from its environment first (`w0-11-windows-sandbox.md`, carried item 3).
- **Driving the app.**
  - The window is a WebView2 page whose controls are exposed to Windows UI Automation. The stopped-Host dialog and the tray icon are native Windows controls.
  - Find the window by class `Tauri Window` titled `CodeTether`, not by `MainWindowHandle`.
  - After a resize or a scroll, the UI Automation tree and window captures can be stale. Click once on a blank spot inside the page first.
  - Hover needs real mouse moves. Absolute `mouse_event` moves are reliable; relative moves land elsewhere.
- **us-vps-01** also hosts the website and other projects. SSH has timed out during the banner exchange before, so make each upload step safe to repeat.
- **Docs.** `ux/design` is the source for `docs/`. Do not merge it here, and do not edit `docs/` or `AGENTS.md` on the release branch.

## Boundaries

- **Decide yourself:**
  - the CHANGELOG wording
  - the build directories
  - how to diagnose and retry build problems
  - how to drive the window and the native dialogs, and how to adapt Claude Code's recording scripts
  - installing the same signed installer manually if the one-click update fails (goal 9)
- **Ask the Owner first:**
  - pushing `main`, and creating or pushing the tag, unless the starting message approves them
  - any web server configuration change on us-vps-01
  - any code change needed to pass a check, and any merge conflict
- **Do not:**
  - print, copy, log or transmit the signing private key or its password
  - generate a new signing key
  - change other website files, or restart services on us-vps-01
  - force-push, rebase pushed branches or rewrite history
  - build or install a Mac or Android package, or deploy the Relay or the Control Plane
  - add projects to the installed app, or touch conversations other than W0's scratch ones and the one you create
  - press "全部知道了" or acknowledge any of the Owner's 待处理 items
  - change the Owner's Codex configuration, except removing the trust entries your Turns added
  - leave the window anywhere but the rectangle you recorded before the update
  - edit `docs/` or `AGENTS.md`
  - delete the alpha.4 or alpha.5 installer, any backup, or remote branches
  - touch `F:/codetether-d3b-review/`
  - read or print other credentials

## Report

Write to `D:/Projects/Software/agenthub-archive/release-v0.1.0-alpha.6-report.md`:

- **Start check:** the one merge, the D3b merge commit and its tree check, the installed build, SSH, and the free space.
- **Release branch:** its commits, the version change, and the full CHANGELOG entry.
- **Gates:** the result of each check, with any failures verbatim.
- **`main` and the tag:** the remote commits.
- **Signed build:** the environment assertion, the build ID, the match counts, each file with its size and SHA-256, the content of `latest.json`, and the key-ID comparison.
- **Backup:** its location, the integrity check, and the checksums.
- **Upload:** what you created on the server, and the HTTPS results.
- **One-click update:** each step with screenshots, the window's rectangle before the update and after its restart, when the window appeared against Host-ready, and the checks after the update. If it failed: the failure, and the fallback.
- **Acceptance:**
  - each check's result with its screenshot
  - for the window: the saved file's content, each measured rectangle, and the event lines and frames of the maximized start
  - the message box's heights, and each command as shown
  - the path on each project card
  - every change in the 75 s sample of 设备
  - the trust entries added and removed, and any check left for the Owner
- **Cleanup:** the branches and worktrees deleted and kept, with reasons, and the merged remote branches.
- **Status:** anything left undone and why, and which completion level the work reached.
