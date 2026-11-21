# Task: Release v0.1.0-alpha.5 (Windows, the Fixes After alpha.4)

**Where it runs.** On Windows, with SSH to us-vps-01 for the upload. The Owner develops and releases only on Windows for now (AD-13). This release builds no Mac or Android package and deploys no service.

**Branch and worktree.**

- Fetch first, with tags.
- **Merge D3a first,** if `origin/main` does not yet contain `feat/d3a-desktop-consistency` (accepted 2026-11-21 at `6f3dc65`; `d3a-desktop-consistency.md`):
  - The branch already contains `main` at `6553480`. In a clean worktree on `main`, merge `origin/feat/d3a-desktop-consistency` with a merge commit (`--no-ff`). Stop on any conflict.
  - The merge commit's tree must equal `6f3dc65`'s tree. Check it, and stop if it does not.
  - On the merge commit, run `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`, and `cargo test --locked` in `apps/desktop/src-tauri`.
  - Push `main`. This push needs the Owner's approval; the starting message may give it.
- Then start from that `origin/main`.
- Create branch `release/v0.1.0-alpha.5` in worktree `E:/Projects/Software/agenthub/release-v0.1.0-alpha.5`.

**Why this task exists.**

- alpha.5 brings everything fixed since alpha.4 to the Owner's installed app:
  - D2.5's new timeline
  - the restored-conversation model catalog fix
  - W0f's diagnostic logs
  - the Owner's UI/UX runtime audit
  - W0e's Windows fixes
  - D3a's consistent status vocabulary and page headers
- It is the second one-click update, through the same path as alpha.4.
- **You do every step yourself:** signing, uploading, the update in the installed app, and the acceptance checks. The Owner only reads your report and answers the approvals listed under Boundaries.
- **The installed app is the Owner's.** While you drive it, the Owner does not use it. Claude Code does not touch it either.

**References** (read with `git show origin/ux/design:<path>`):

- **This release's template:** `docs/reviews/release-alpha4-prompt.md` and its review `release-v0.1.0-alpha.4.md`, especially "Prompt errors and deviations" and "Notes for the next release prompt"
- `docs/DEVELOPMENT-PROCESS.md` §3 and §7
- `docs/ux-redesign/05-desktop-update.md` §4, §5.2–§5.8, §6 and §7
- `docs/release/codetether-update.key.pub`: the update public key
- **What ships, and what each review carries to acceptance:**
  - `d2-5-timeline-restyle.md`
  - `restored-conversation-model-catalog.md`
  - `w0f-runtime-diagnostics.md`
  - `ui-ux-runtime-audit.md`
  - `w0e-windows-fixes.md`
  - `d3a-desktop-consistency.md`

Before starting, confirm this file has 4 second-level headings and that the last one is "Report".

## Goals

**Must:**

1. **Start check.** Stop and tell the Owner if any of these fails:
   - Since `v0.1.0-alpha.4` (`6283aa0`), the first-parent history of `origin/main` holds exactly six merges:
     - D2.5 (`9932e70`)
     - the catalog fix (`13fa6b8`)
     - W0f (`745c701`)
     - the UI/UX audit (`6fb9dd3`)
     - W0e (`6553480`)
     - D3a (the merge you made, or found)
   - No migration was added since alpha.4; the latest is still 026.
   - The installed app is alpha.4: build ID `git-6283aa0e1ab9`.
   - SSH to us-vps-01 works non-interactively with the access this computer already has.
   - Record the free space on D: and E:.
2. **Version and changelog** on the release branch.
   - **Version:** run `pnpm version:set 0.1.0-alpha.5`, then `pnpm version:check`. Android stays at `0.1.0-alpha.3`, because this release ships no APK. Say so in the report.
   - **`CHANGELOG.md`:** add a `v0.1.0-alpha.5` entry above alpha.4. List the user-visible changes since alpha.4, in Simplified Chinese, with no stage codes or internal terms. Cover at least:
     - the new conversation timeline: clearer tool rows, highlighted code, readable diffs
     - the message box staying still when you send, also after a multi-line message
     - menus that fit their content
     - right after start-up, New Conversation says the AI tools are being checked and enables them as soon as they are ready; the red "CodeTether 暂时无法连接" error after start-up is fixed
     - when Codex's configured default model is not available, CodeTether picks an available one and says so
     - the unavailable-model warning after restoring an archived conversation
     - one set of status words on every page; an old failure shows as a dated note, and tools on a computer that is not connected are no longer red
     - 关于与检查 gives a result without a selected project, and lists offline computers in one group
     - 待处理: "全部知道了" on each tab, and items of archived conversations hidden
     - links to local files in replies, and the side panel after a failed run
     - the title bar in dark mode
     - drafts kept when the window reloads, the command palette, and narrow windows
     - local diagnostic logs without conversation content, to explain failures
   - **Release notes:** write the same entry as plain text to `D:/Projects/Software/agenthub-archive/release-v0.1.0-alpha.5/notes.txt`. About shows six lines before "more" (05 §4), so put the six most useful lines first.
   - Commit both on the release branch.
3. **Quality gate on the release branch,** in this order:
   - `pnpm typecheck`, `pnpm lint`, `pnpm build`, then `pnpm test`
   - `cargo test` in `packages/supervisor-mobile`
   - `cargo test` in `apps/desktop/src-tauri`. Build the Host sidecar first with `pnpm desktop:sidecar`.
   - the Android Gradle gate (`testDebugUnitTest lint assembleDebug assembleDebugAndroidTest`), because the audit changed `apps/android`
   - Prettier for the files you changed

   Then push the release branch.

4. **`main` and the tag,** with the Owner's approval (the starting message may already give it):
   - Fast-forward `main` to the release branch and push it.
   - Create and push the annotated tag `v0.1.0-alpha.5`.
5. **The signed build,** with the scripts in `D:/Projects/Software/agenthub-archive/release-tools/` and the password stored for alpha.4.
   - **Before building,** assert that `CODETETHER_W0F_HOST_PORT` and `CODETETHER_W0F_DATA_DIR` are unset in the process, user and machine environments (`w0f-runtime-diagnostics.md`, carried item 2). Stop if either is set.
   - Run `build-signed.ps1` for the tag. If signing fails because of the password, follow alpha.4's rule: delete the stored file, ask once more through the window, and stop if the second try fails.
6. **Check the update files,** as for alpha.4:
   - **The build:**
     - The build ID is `git-` followed by the tag commit's first 12 characters, with no `dirty` suffix.
     - The desktop executable contains the public key and the base URL. Give the match counts.
   - **The output:** the installer, its `.sig`, `update-windows-x64.json` and `latest.json`.
   - **`latest.json`:**
     - version `0.1.0-alpha.5`
     - only the `windows-x86_64-nsis` platform
     - a URL under `https://codetether.org/updates/alpha/0.1.0-alpha.5/`
     - a signature equal to the `.sig`
   - **The key IDs** match `39A9367FBD7A5F67`.
   - Record the installer's size and SHA-256.
7. **Back up before the update,** while the app keeps running.
   - **The database:** take an online backup, and check it with `PRAGMA integrity_check`.
   - **The program files:** copy them.
   - Record checksums, and restrict the folder to the current user.
   - **The rollback target:** keep alpha.4's signed installer (SHA-256 `fb554c34…a2bd31`). Find it in alpha.4's release output, or download it from its URL under `updates/alpha/0.1.0-alpha.4/` and check the hash.
8. **Upload to us-vps-01,** reusing alpha.4's static root `/opt/codetether/updates` and its Caddy route.
   - Upload the installer and `.sig` to `alpha/0.1.0-alpha.5/` first. Then upload `latest.json`, written under a temporary name and renamed.
   - Keep alpha.4's files. Change nothing else on the server.
   - **Check over HTTPS:** `latest.json` serves the new content, and the installer answers 200 with a matching SHA-256.
9. **The one-click update in the installed app,** as for alpha.4.
   - **Start the app as the Owner does,** through Explorer or the Start menu, never from your own environment. If it is not running, start it that way.
   - **First,** check through the Host's API that no conversation is running or waiting.
   - **Drive the real window** with Windows UI Automation: Settings › 关于与检查 › check for updates › update. Screenshot each step.
   - **When the update restarts the app,** go straight to goal 10's cold-start check before anything else.
   - **After the update,** check:
     - The build ID is the tag's.
     - The Host on `127.0.0.1:4317` stays healthy for more than 60 seconds, from the installed data folder.
     - The counts of projects, conversations and Turns are unchanged. `machine-credentials` and the earlier backups are kept.
     - About shows alpha.5, and one more check reports the app is up to date.
   - **If the update fails:** record the exact text and state, keep the logs, and do not retry blindly. Then install the same signed installer with NSIS `/S /UPDATE` so acceptance can go on. The failure becomes its own fix task.
10. **The acceptance checks, run by you** on the installed alpha.5.
    - **How:**
      - Drive the real window, and read Host-side facts where that helps.
      - Take a screenshot for each check.
      - Use W0's existing scratch project and conversations. Add no project, and leave the Owner's other projects and conversations alone.
    - **The checklist.** Write `D:/Projects/Software/agenthub-archive/release-v0.1.0-alpha.5/acceptance-checklist.md` in Simplified Chinese. For each check, give what was done, what was expected, what happened, and the screenshot.
    - **The checks:**
      - **Cold start** (`w0e-windows-fixes.md`, W0-27 and W0-30; `d3a-desktop-consistency.md`, must-fix 3). The check lasts only seconds after each start, so use two starts.
        - **Right after the update restarts the app:** open 设备 at once. The local Codex and Claude Code read "正在检查…", then "可用". Nothing local reads red "暂时不可用".
        - **Then quit from the tray, and start the app again from the Start menu:** open New Conversation in the scratch project at once. Codex reads "正在检查…" and becomes selectable in the same dialog, without reopening it.
        - Give the seconds from the window appearing to Codex being selectable.
        - Create a Codex conversation at once and send a short message. It completes, and "CodeTether 暂时无法连接" never appears.
      - **The default model** (W0-29).
        - Read `model` in the Owner's Codex configuration. Read only; do not change it.
        - If it names a model that the model menu does not list (it was `gpt-6.2-astra`), the new conversation shows the notice that CodeTether chose an available model, with the menu's display name. The notice stays until you change the model, and Send works.
        - If the model is listed, say so; the notice is then not expected.
      - **The restored conversation** (`restored-conversation-model-catalog.md`, carried item 1; alpha.4's failed check). Repeat alpha.4's check exactly:
        - Archive, then restore from inside its workspace, the W0 scratch conversation that stores `gpt-6.2-sol`.
        - "gpt-6.2-sol 不在此账号的可用模型中" appears without opening the model picker, and the old archived error does not.
      - **The timeline in the installed window** (`d2-5-timeline-restyle.md`, carried item 1). In the scratch project, run a Turn that reads files and runs `node --test`, with one Approval.
        - Tool rows show the command without the PowerShell wrapper.
        - The pending tool reads "等待批准". Approve once, and the Turn completes.
        - A fenced code block is highlighted.
      - **The Composer** (W0e goals 6 and 7). Use UI Automation bounding rectangles, at the window size the Owner uses.
        - Record the message box's height before sending, just after sending, while running, and after the Turn.
        - Send a five-line message, then type one character. The height follows the draft only and does not jump.
        - Open the model menu: it fits its content.
      - **Status words** (D3a).
        - On 设备, the computer page, 关于与检查 and New Conversation, the local Claude Code reads the same. If its last execution failure is old, it reads "可用" with a dated note.
        - The Owner's paired computers that are not connected show no red tool badges.
        - 关于与检查 with no project selected gives its summary without asking for a project.
        - The offline computers' group on 设备 and in the sidebar opens and closes.
      - **The title bar** follows the dark theme. Switch to dark, screenshot, and switch back to the Owner's theme.
      - **The diagnostic logs** (`w0f-runtime-diagnostics.md`, carried item 2).
        - `logs/host-diagnostics.jsonl` and `logs/desktop.jsonl` exist next to the installed database.
        - Only the Owner's account can read them; give their access lists.
        - Spot-check them: no file paths, prompts or message text.
    - **Codex trust entries.**
      - Before the first Turn, record Codex's trust entries in the Owner's Codex configuration.
      - Afterwards, remove only the entries that your Turns added, and list them in the report. The Owner approves this for this task.
    - **If a check cannot be automated,** say which one and why, and leave it for the Owner. Do not mark it passed.

**Should:**

11. **Clean up.**
    - **Delete these local branches and worktrees:** the ones merged since alpha.4, and alpha.4's release worktree, which was left because of the path-length limit.
    - **Path length:** remove large `node_modules` folders first, for example with `robocopy /MIR` from an empty folder. If a worktree still cannot be removed, keep it and list it.
    - **Remote branches:** list the merged ones in the report, but do not delete them.
    - **Never delete:**
      - `ux/design`, `docs/english`, `i1/ipad-app`, `spike/*`, `archive/*` or `phase8d/*`
      - the worktrees `D:/Projects/Software/agenthub-work/docs-english` and `D:/Projects/Software/agenthub-work/review-detail-main`, which Claude Code uses
      - a branch with commits not in `main`, or one that a paused task uses, such as task 1b's
    - Leave any worktree that has uncommitted changes, and report it.

## Known facts

- **What ships.** Since alpha.4 (`6283aa0`), `main` gained six merges (goal 1).
- **Migrations.** None since alpha.4. The database stays readable by alpha.4, but going back still means reinstalling alpha.4's installer and restoring goal 7's backup.
- **Where the installed app checks.** alpha.4 checks `https://codetether.org/updates/alpha/latest.json`, which serves alpha.4's manifest today.
- **The release path from alpha.4** (`release-v0.1.0-alpha.4.md`):
  - `latest.json` lists `windows-x86_64-nsis`, which Tauri checks first.
  - The site is a Next.js standalone server. Update files are served by a static Caddy route, `handle_path /updates/*` to `/opt/codetether/updates`, which the Owner approved for alpha.4.
  - The Host's own pre-update backup is one checkpointed database file.
  - The first alpha.4 signed build stopped on a line-ending change in `Cargo.toml`. A rebuild passed.
- **The signing key.**
  - Its public key's ID is `39A9367FBD7A5F67`. The installed app trusts only this key, so never generate a replacement.
  - The password is stored with DPAPI for the Owner's account. `%USERPROFILE%/.codetether-release/` holds the password file and the key's path.
- **W0f's isolated profile.**
  - `CODETETHER_W0F_HOST_PORT` and `CODETETHER_W0F_DATA_DIR` move a diagnostic desktop build to another port and data folder.
  - A build meant for users must have neither.
  - Any Host started on a port other than 4317 skips the production Relay (`w0f-runtime-diagnostics.md`, "Behavior changes").
- **Cold start.**
  - On the review's isolated Host, Codex became ready 6–10 s after the Host started.
  - Until then the Host reports the tool as unavailable, and the web shows "正在检查…" by inference (`w0e-windows-fixes.md`, round 2 carried item 1). If the startup check itself fails, the dialog keeps "正在检查…" until 重新检查 on 关于与检查 succeeds. Record that if you see it; it does not block this release.
- **Start the app the way the Owner does:** through Explorer or the Start menu. If a script must start it, remove every `CODEX_*` variable from its environment first (`w0-11-windows-sandbox.md`, carried item 3). In alpha.4, starting it through COM from the agent's environment failed twice.
- **Driving the app.** The window is a WebView2 page whose controls are exposed to Windows UI Automation. The stopped-Host dialog and the tray icon are native Windows controls.
- **us-vps-01** also hosts the website and other projects. SSH has timed out during the banner exchange before, so make each upload step safe to repeat.
- **Docs.** `ux/design` is the source for `docs/`. Do not merge it here, and do not edit `docs/` or `AGENTS.md` on the release branch.

## Boundaries

- **Decide yourself:**
  - the CHANGELOG wording
  - the build directories
  - how to diagnose and retry build problems
  - how to drive the window and the native dialogs
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
  - add projects to the installed app, or touch conversations other than W0's scratch ones
  - press "全部知道了" or acknowledge any of the Owner's 待处理 items
  - change the Owner's Codex configuration, except removing the trust entries your Turns added
  - edit `docs/` or `AGENTS.md`
  - delete the alpha.4 installer, any backup, or remote branches
  - read or print other credentials

## Report

Write to `D:/Projects/Software/agenthub-archive/release-v0.1.0-alpha.5-report.md`:

- **Start check:** the six merges, the D3a merge commit and its tree check, the installed build, SSH, and the free space.
- **Release branch:** its commits, the version change, and the full CHANGELOG entry.
- **Gates:** the result of each check, with any failures verbatim.
- **`main` and the tag:** the remote commits.
- **Signed build:** the environment assertion, the build ID, the match counts, each file with its size and SHA-256, the content of `latest.json`, and the key-ID comparison.
- **Backup:** its location, the integrity check, and the checksums.
- **Upload:** what you created on the server, and the HTTPS results.
- **One-click update:** each step with screenshots, and the checks after the update. If it failed: the failure, and the fallback.
- **Acceptance:** each check's result with its screenshot, the cold-start seconds, the Composer heights, the trust entries added and removed, and any check left for the Owner.
- **Cleanup:** the branches and worktrees deleted and kept, with reasons, and the merged remote branches.
- **Status:** anything left undone and why, and which completion level the work reached.
