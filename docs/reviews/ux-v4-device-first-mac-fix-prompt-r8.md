# Task: Mac Round 8 (Restore Startup, Then Diagnose and Fix System Notifications in One Round)

Run on Mac. The user requests faster progress and grants greater autonomy: directly perform the authorized actions below without asking again. The boundaries in Absolutely Prohibited remain unchanged.

First read rounds 1–7 in `~/agenthub-archive/v4-acceptance-report-mac.md` and `docs/reviews/ux-v4-device-first-mac-fix-prompt-r7.md` on `origin/ux/design`. Reuse r7's diagnostic design. UI follows docs/ux-redesign under temporary user authorization overriding AGENTS.md's “Figma is the only source.”

Before starting, confirm this file has 12 second-level headings, ends with Restrictions, and has no omission markers in its body. Stop and report if incomplete.

## Current State

- Branch `fix/macos-notifications`, local HEAD `aeb0b5f` (r7 diagnostic commit), not yet pushed; remote still `a8abbec`.
- `/Applications/CodeTether.app` is r7 build `git-aeb0b5fbd229`; Host exits with code 1 after launch, making CodeTether unusable.
- Last working backup: `~/agenthub-archive/mac-install-backup-2026-10-23/CodeTether-a8abbec.app`.
- r7 raw log `~/agenthub-archive/v4-mac-r7-desktop-stderr.raw` remains. Host errors are forwarded there with `[codetether:host]`. r7 sanitization retained only desktop, lifecycle, notification lines, filtering the error out; sanitized logs therefore omit the exit cause.
- Reviewer hypothesis: Host code did not change; packaging environment did.
  - r7 packaged Host using Node 25.5.0 from `/tmp/codetether-node-v25.5.0`. Round 1 records the SHA256-verified official Node 26.4.0 ARM package.
  - App shrank from 157.8 MB to 145.6 MB; the 12 MB difference resembles an embedded Node version change.
  - Unconfirmed; use logs as evidence.

## Authorized (Proceed Without Asking)

- Edit and commit on `fix/macos-notifications` in `~/agenthub-work/v4-fix-macos-notify`; scope in part three.
- Download official Node packages from nodejs.org and verify SHA256 against `SHASUMS256.txt`. Keep in temporary directories and use through PATH for packaging; do not install system-wide.
- Repeated packaging and replacement of `/Applications/CodeTether.app`. Before every replacement, confirm a working backup; if needed, copy the current app into `~/agenthub-archive/mac-install-backup-2026-10-23/`, including build ID in its name.
- Run `lsregister -f /Applications/CodeTether.app`.
- Launch with `open -a /Applications/CodeTether.app --stderr <log-path>`, quit normally with `osascript -e 'quit app "CodeTether"'`, and confirm Desktop, Host, Host guardian all exit. If not exited within 15 seconds, ask the user to quit from the menu bar; no `kill`.
- Switch windows yourself during testing: `osascript -e 'tell application "Finder" to activate'` to obscure CodeTether; send ⌘M with System Events while CodeTether is foreground to minimize it.
- At most 10 Codex turns.
- Finally push only `fix/macos-notifications` (`git push origin fix/macos-notifications`, without `--force`).

## Actions Still Requiring the User

- When notifications appear, report whether visible onscreen/in Notification Center and click when needed.
- Quit from the menu bar if the agent cannot quit CodeTether.

## Part One: Restore CodeTether Startup

1. Extract Host errors from r7 raw logs. First redact `sk-…`, `sb_publishable_…`, Bearer using sed; then inspect only `[codetether:host]` lines, skipping `provider-unknown-notification`. Report the errors found.
2. Inspect `~/agenthub-archive/v4-acceptance-build-logs/` and earlier reports to establish which Node built a8abbec. If unconfirmed, use Node 26.4.0 recorded in round 1.
3. Act on the cause:
   - Node/runtime errors (e.g. modules, APIs, SQLite), or unclear cause but confirmed version difference: repackage using the same Node as a8abbec.
   - Port 4317 occupied: identify with `lsof -nP -iTCP:4317 -sTCP:LISTEN`. If CodeTether's own leftover Host, quit normally as above; if another program, stop and ask the user, without terminating it.
   - Database/migration errors: leave data untouched, restore a8abbec backup, report, and stop.
   - Clear Host-code defect: restore a8abbec backup, report, and stop. No `apps/host` changes this round.
4. After repackaging, replace, `lsregister -f`, launch with `open -a … --stderr`, and verify:
   - Running build matches current HEAD's first 12 characters;
   - Logs contain `notification stage=sse-connected`;
   - Production data remains 11 projects, 2 devices, 25 conversations.
5. At most two packaging attempts. If still unable to launch, restore a8abbec, verify it works, then stop and report. The user must finish with a working CodeTether.

## Part Two: Diagnostic Live Tests

Use r7 diagnostic commit `aeb0b5f`. Packaging checks match r7: `pnpm typecheck`, `lint`, `build`, `cargo test`, `clippy`, `fmt`. No rerun needed if part one changed no code.

Use the test Codex conversation in `v4 Mac Acceptance Test`; each time type “Reply only OK; do not read or write files” using the keyboard. Leave at least 1 minute between tests.

Crucial: while waiting for notifications, do not click/focus CodeTether or capture screenshots in a way that foregrounds it. By design, no notification is sent when CodeTether is foreground on this conversation or Inbox; doing so invalidates results. Use only `screencapture -R` for a small region at the screen's upper right.

Test 1, obscured window: immediately after sending, activate Finder. Expect `main_window_blurred` in logs.
Test 2, foreground window on another page: immediately switch to Devices; keep window foreground.
Test 3, minimized: immediately send ⌘M. Expect `main_window_minimized`; if absent, send ⌘M once more; if still absent, record honestly.

For each test, wait for turn completion plus 30 seconds, then record:
- All `notification stage=…`, `notification requested`, `notification shown`, `[codetether:lifecycle]` lines in that interval;
- Upper-right screenshot;
- User observations;
- Inbox count.

Interpret logs:

| Log | Conclusion |
|---|---|
| No `received` | Web never received `attention.created`; check concurrent `sse-reconnecting` or `sse-reset` |
| `received` then `skip-suppressed` | Considered “user viewing.” Compare lifecycle lines: if actually foreground on this conversation/Inbox, intended behavior; correct test method and retry. If blurred/minimized already, a defect |
| `received` then another `skip-…` or `failed-…` | Identify the stage |
| `…-start` without `…-done` or `…-timeout` | Stalled at that step; timeout also ineffective |
| `…-timeout` | Step exceeded 5 seconds |
| Both `deliver-done` and `notification shown`, nothing onscreen | Return to system layer; record this |

## Part Three: Fix According to Logs

If logs identify a web-notification-pipeline defect, fix it directly without waiting for the reviewer:
- Allowed files:
  - `apps/web/src/runtime/notifications/`;
  - `apps/web/src/runtime/native/native-capabilities.ts`;
  - `apps/web/src/main.tsx`;
  - `apps/web/src/runtime/host/host-runtime.ts`, only event publication and near `stream.reset`;
  - `apps/desktop/src-tauri/src/attention_notifications.rs` and `macos_notifications.rs`;
  - `apps/desktop/src-tauri/src/host_supervisor.rs`, window events only;
  - Corresponding tests and the notification section of `docs/ARCHITECTURE.md`.
- One commit per fix, clearly explaining the cause, with a reproducing test.
- Do not change Host, notification copy, preference semantics, the “no notification while user is viewing” rule, deduplication, or Windows behavior. If necessary for a fix, stop and report.
- Retain diagnostic logs; the reviewer decides whether to remove them.
- Repackage, replace, and retest only previously failing items. At most 3 fixes.

## Part Four: Complete Item 9 Acceptance

After all three tests produce notifications:
1. Content: “Device · Project” plus explanation, no conversation title.
2. Click while running: repeat test 3. Ask the user to click the notification. The agent confirms window foregrounded, route contains this turn's `turn` parameter and `notification-N`, and navigation occurs once only.
3. Click after exit: repeat test 3. After notification appears, do not click yet; agent quits normally and confirms all processes exit, then asks the user to click it in Notification Center. Agent confirms CodeTether launches, window appears, and route includes this turn's `turn`. This launch has no logs; evaluate window and route.

Item 9 passes only if tests 1, 2, 3 all produce notifications with correct content, and both clicks open the correct conversation.

Finally launch normally with `open -a` so the user has the working latest version.

## Checks Before Each Commit

- `env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm typecheck`; run `lint`, `build` the same way.
- `pnpm test`: 3 known Windows installer-path failures; Claude `/var` vs `/private/var` issue, rerun with `TMPDIR=/private/tmp`. No new failures beyond these categories.
- In `apps/desktop/src-tauri`: `cargo test --locked`, `cargo clippy --locked --all-targets -- -D warnings`, `cargo fmt --check`.
- Prettier-check changed files; `git diff --check` must be silent.
- Load build configuration using `set -a; . ~/agenthub-work/v4-build.env; set +a` in the packaging shell without printing/copying contents. Redact `sk-…`, `sb_publishable_…`, Bearer with sed before saving build logs.

## Budget and Stop Conditions

- Codex: at most 10 turns. Claude Code: 0 turns. Do not resend failed turns.
- Packaging + replacement: at most 6 times. Fixes: at most 3.
- API 429 or 524: wait per Retry-After, retry at most 3 times, record each time, then stop and report.
- Restore a working CodeTether before stopping/reporting when:
  - Host code is defective;
  - Database errors occur;
  - Needed changes exceed part three;
  - Budget exhausted.

## Absolutely Prohibited

- No push to `main`, merges, tags, or force pushes. Push only `fix/macos-notifications`.
- No `apps/host` changes.
- Do not read .secrets/, other .env files, credential files, machine-credentials contents, `~/.codex/auth.json`, or `~/.claude.json`. Load `v4-build.env` only as above, without reading contents.
- No database-content reads; counts only. Do not delete, modify, or restore production data directory.
- Do not change account, Provider selection, gateway, `~/.codex`, or `~/.claude`. No pairing, unpairing, project creation/removal.
- Do not change system settings, notification permission, Focus, Screen Recording permission, or Gatekeeper. No icon-cache clearing or unregistering other apps.
- Do not delete backups or old `.app` copies.
- Never use `kill -9` on any process.
- Leave main Mac workspace's website changes untouched.

## Logs and Report

- Process every raw log, including r7:
  - Redact `sk-…`, `sb_publishable_…`, Bearer with sed;
  - Retain lines containing `[codetether:desktop]`, `[codetether:lifecycle]`, `notification`, plus error lines starting `[codetether:host]`; exclude `provider-unknown-notification`;
  - Save as `.sanitized.log`, then delete `.raw`.
- Append a Round 8 section to `~/agenthub-archive/v4-acceptance-report-mac.md`, including:
  - Host exit cause and treatment;
  - Node version and SHA256;
  - Each commit hash/title and check results;
  - Installer paths/SHA256 and running version;
  - Each test's time, log lines, screenshots, user observations, table-based conclusion;
  - What was fixed and why;
  - Item 9 conclusion;
  - Final totals across 15 items;
  - Production project/device/conversation counts at completion;
  - Push result.
- End with a Chinese summary and attach:
  - `git log --oneline origin/main..HEAD`;
  - `git diff --stat origin/main..HEAD`;
  - Complete diffs of this round's new commits;
  - Full sanitized logs.
  The user will forward them to the reviewer on Windows.

## Restrictions

- Pin exact versions for new dependencies; none are expected this round.
- If permission is denied, do not bypass it; give the user a command to run in Terminal.
- Write the report in Chinese, without exclamation marks or em dashes.
