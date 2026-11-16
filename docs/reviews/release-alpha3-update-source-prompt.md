# Task: Rebuild alpha.3 with the Update Source (Windows and Mac)

**Where it runs.** Part A on Windows, Part B on the Mac. Each agent does only its own part.

**Branch and worktree.** No branch and no commits. Build from the annotated tag `v0.1.0-alpha.3` (commit `0bf8cba`) in a detached worktree:

- **Windows:** reuse the E: build directory the release used (`E:/Projects/Software/agenthub/release-alpha3-windows-build/`), because D: is short of space.
- **Mac:** `~/agenthub-work/alpha3-update-build`.

**Why this task exists.**

- The alpha.3 release was built without `CODETETHER_UPDATE_BASE_URL` and `CODETETHER_UPDATE_PUBKEY`, so the installed app reports that automatic updates are not configured (05 §5.2).
- 05 §6 plans alpha.3 as the one manual install, after which alpha.4 is the first real one-click update.
- This task rebuilds the same tag and the same code with those two public build settings, and installs it.
- It needs only the public key. No update files are made or uploaded.

**References** (read with `git show origin/ux/design:<path>`):

- `docs/ux-redesign/05-desktop-update.md` §5.2, §5.7, §6 and §7
- `docs/release/codetether-update.key.pub`: the update public key
- `docs/reviews/release-v0.1.0-alpha.3.md`: the release review
- Part A only:
  - `docs/reviews/windows-install-update-prompt.md`
  - the release report `D:/Projects/Software/agenthub-archive/release-v0.1.0-alpha.3-r2-report.md`, "Windows 安装"
- Part B only: `docs/reviews/mac-install-update-prompt.md`

Before starting, confirm this file has 4 second-level headings and that the last one is "Report".

## Goals

**Must (both parts):**

1. **Start check.** Fetch with tags. Confirm two things, and stop and tell the Owner if either fails:
   - `v0.1.0-alpha.3` resolves to `0bf8cbae71019fd785194d027c4b0b5203182980`.
   - `docs/release/codetether-update.key.pub` exists on `origin/ux/design`.
2. **Build from the tag** with these two variables set in the build environment only, without editing tracked files:
   - `CODETETHER_UPDATE_BASE_URL=https://codetether.org/updates`
   - `CODETETHER_UPDATE_PUBKEY`: the exact content of `docs/release/codetether-update.key.pub`, with no trailing newline

   Constraints:
   - Do not set `TAURI_SIGNING_PRIVATE_KEY` or its password. This build makes no update files.
   - The build ID must be `git-0bf8cbae7101` with no `dirty` suffix.

3. **Prove the setting is in the binary.**
   - Search the built desktop executable for the public key string and the base URL.
   - Report the match counts. Both must be at least 1.
4. **Install** following that platform's install procedure:
   - quit the app normally
   - back up the program and the data with checksums
   - install
   - check health for more than 60 seconds
5. **Check the update state in the app.**
   - Settings no longer says automatic updates are not configured.
   - Run one "check for updates". Nothing exists at `https://codetether.org/updates/alpha/latest.json` yet; record exactly what the app shows (state and text).

**Must (Part A, Windows):**

6. **The installed build is the rollback target.** The app now running is the alpha.3 build without the update source: build ID `git-0bf8cbae7101`, installer SHA-256 `cf59d65f…54c5`. Keep its installer and the new backup.
7. **Reuse the release's procedure.** Use the release's Windows build and install procedure (its scripts and receipts in the E: build directory), adding only the two variables. Install with NSIS `/S /UPDATE`, as the release did.

**Must (Part B, Mac):**

8. **Follow `mac-install-update-prompt.md`,** with these changes:
   - **Target:** the tag's commit instead of `fd1d905`.
   - **Rollback target:** the app installed now (check its build ID; it should be `fd1d905`).
   - **Migrations:** the latest migration should be version 25, and alpha.3 should add none. Verify both before installing.
   - **Leave the Node alone:** the `Node/` directory and the `com.codetether.node` process, including their configuration and data.

**Should:**

9. **If the check shows an error.** If "check for updates" shows an error rather than "up to date" while `latest.json` is missing, report the error text. Then write a minimal `latest.json` for `0.1.0-alpha.3` with no platforms (05 §5.7) into the report folder, for the Owner to upload. Do not upload it.
10. **macOS notification permission.** On the Mac, check whether notification permission survived replacing the app, and whether LaunchServices shows a duplicate CodeTether registration (05 §6).

## Known facts

- **How the update setting works.**
  - The tag's `apps/desktop/src-tauri/tauri.conf.json` leaves `plugins.updater.pubkey` and `endpoints` empty.
  - `apps/desktop/src-tauri/src/desktop_update.rs` (around line 446) reads `CODETETHER_UPDATE_BASE_URL` and `CODETETHER_UPDATE_PUBKEY` with `option_env!`.
  - `build.rs` reruns when either variable changes.
  - Without both, the update status is `Unconfigured`.
- **The check.** The app checks `<base>/alpha/latest.json`. Release builds accept only HTTPS.
- **The public key is public.** It may appear in logs and in the report. The private signing key and its password are not part of this task. Do not look for them.
- **The build ID is the same for both builds** (same commit). Tell them apart by installer SHA-256.
- **The changelog.** The tag's `CHANGELOG.md` says the installer has no update source. Leave it; the alpha.4 entry corrects it.
- **Windows.**
  - D: had about 26 GB free on 2026-11-15, and the release ran out of space on D: once.
  - Task 1b (the phone diagnosis) may be using the installed desktop together with the phone.
- **Mac.**
  - Earlier installs used checksum-verified Node 26.4.0 at `~/agenthub-work/i1-node-26.4.0` and `~/agenthub-work/v4-build.env`. Load that file without printing it.
  - The pitfalls are in `~/agenthub-archive/mac-install-b1-report.md`.

## Boundaries

- **Decide yourself:**
  - the build directory
  - how to pass the two variables without editing tracked files
  - diagnosing and retrying build problems
- **Ask the Owner first:**
  - **Windows:** quitting the installed desktop. Task 1b may be in the middle of a check; wait for a go-ahead.
  - **Both:** any code change; anything that would change the tag or `main`; uploading anything to `codetether.org`.
- **Do not:**
  - commit, push, tag or merge
  - read, set or look for the update-signing private key or its password
  - read or print other credentials
  - deploy anything
  - edit `AGENTS.md` or `docs/`
  - delete the previous installer or backups

## Report

- **Windows:** write to `D:/Projects/Software/agenthub-archive/alpha3-update-source-windows-report.md`.
- **Mac:** write to `~/agenthub-archive/alpha3-update-source-mac-report.md`.

Include:

- **Build:** the tag commit; that both variables were set (first 12 characters of the public key); the installer path and SHA-256; and the match counts from goal 3.
- **Install:** build ID before and after, the backup location, and the health-check results.
- **Update state:** what Settings shows, and the result of "check for updates", quoted exactly. Also the `latest.json` file, if you wrote one.
- **Mac only:** notification permission and LaunchServices (goal 10).
- **Status:** anything not done and why, and the completion level reached.
