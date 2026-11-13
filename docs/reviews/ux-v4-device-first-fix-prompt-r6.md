# Task. Diagnose Codex failures and notifications, reinstall once, and finish installed-build acceptance

Branch `ux/v4-device-first`, worktree `D:/Projects/Software/agenthub-ux-v4-device-first`. Require clean `9de227968aa738801ed5b04d304cc44fb8c77ddd` or stop/report. UI/icons follow docs/ux-redesign under temporary user authorization overriding AGENTS.md's Figma-only rule.

The agent must inspect the installed UI directly instead of delegating judgments to the user.

Previous results are in `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r5.md`. Items 5, 6, 8, 9, 14 and taskbar/tray/Start-menu/Explorer icons remain.

## Part 1. Record Codex failure variants

Selected Codex 0.149.1 fails every turn with only `provider_error`. PATH's 0.162.1 succeeds when invoked directly.

Root cause is unknown. `packages/adapter-codex/src/failure-classifier.ts` maps unrecognized `codexErrorInfo` to `provider_error` without preserving the original variant.

Changes.
1. In `packages/adapter-codex/src/`, log one stderr line for Codex turn failure (`normalizer.ts:329`) and App Server rejection (`errors.ts:91`).
   `[codex:failure] variant=<variant> httpStatus=<integer or none> reason=<canonical reason>`
   - If `codexErrorInfo` is a string use it, or for a single-key object use its key, otherwise `unknown`. Accept only `^[A-Za-z][A-Za-z0-9]{0,63}$`, otherwise `unknown`.
   - `httpStatus` comes only from integer object `httpStatusCode`.
   - Exclude error text, `additionalDetails`, conversation content, paths, credentials.
   - Desktop already wraps Host stderr as `[codetether:host] ...` (`host_supervisor.rs:323`), so do not change Desktop.
2. Test strings, objects, HTTP status, invalid names, and exclusion of long `additionalDetails`.
3. Preserve classification for now. Decide new mappings only after reproduction in part 5 §3.

Also change the fallback `Codex 会话 — <时间>` to `Codex 会话 · <时间>` at `packages/adapter-codex/src/session-discovery.ts:995`, matching Claude, and update tests.

One commit, for example `fix(adapter-codex): log Codex failure variant`.

## Part 2. Record successful notification delivery too

All notification settings are on, but no notification appears within 90 seconds after completion and no `notification delivery failed` appears. Failure-only logging cannot distinguish absent frontend calls from Windows suppression.

Changes.
1. In `deliver_attention_notification`, `apps/desktop/src-tauri/src/attention_notifications.rs`, log the following.
   - After Windows accepts it, `[codetether:desktop] notification shown type=<type> app_id=<AppID>`.
   - Duplicate skip, `[codetether:desktop] notification skipped: already delivered`.
   - Exclude title, body, project name, device name.
2. Add/update Rust tests asserting title/body exclusion.

One commit, for example `fix(desktop): log attention notification delivery`.

## Part 3. Package and reinstall

As in R5 part 4.
- Back up the 9de2279 installer and SHA256 to `D:/Projects/Software/agenthub-archive/installers/9de2279/` before packaging.
- Three account settings.
  - VITE_SUPABASE_URL `https://qfktysdrytlaxvhzqpba.supabase.co`.
  - VITE_CODETETHER_CONTROL_PLANE_URL `https://api.codetether.org`.
  - Ask for VITE_SUPABASE_PUBLISHABLE_KEY or have the user package with `!`.
- Preserve data without another backup.
- Ask for tray exit before uninstalling, without process termination.
- Launch the original installed path using `Start-Process -FilePath <original install path> -RedirectStandardError <archive log>` to capture new diagnostics. If blocked, hand off `! powershell.exe -NoProfile -Command "..."`.
- Verify bootstrap `hostVersion` equals the final commit's first 12 characters.
- Redact `sk-…`, `sb_publishable_…`, and Bearer with sed before saving logs.

## Part 4. Check Windows notifications first

Do this before CodeTether tests without changing system settings.
1. Find full Start-menu `CodeTether.lnk` path and record user vs global directory.
2. Send one PowerShell notification with AppID `com.codetether.desktop` using `Windows.UI.Notifications.ToastNotificationManager` `CreateToastNotifier('com.codetether.desktop')`. Text is "CodeTether notification test".
3. Check display through notification history or UIAutomation.

Interpretation.
- Displayed. Windows delivery works. Continue CodeTether investigation in part 5 §4.
- Not displayed. Send the same notification with PowerShell's own AppID.
  - Only PowerShell works. Application registration is faulty. Record missing `Get-StartApps` entry, shortcut path, and possible causes, without registry/shortcut changes. Await my decision.
  - Neither works. Explain system notification settings for the user to check.

## Part 5. Finish installed-build acceptance

Use R5's UIAutomation plus window-only screenshots in `output/playwright/v4-installed-acceptance-r6/`. Record Pass/Fail/Untested with evidence.

Budget.
- Installed Codex, at most four brief turns (one reproduction, three for items 6/8). No direct CLI.
- Installed Claude Code, at most two turns.
- Execute only in `D:/Projects/Software/agenthub-work/v4-accept-project`.

### 1. Item 5, continue typing after sending

Use the test project's Claude Code conversation with the window foreground throughout.
1. Click the input once, type a short message, press Enter, then stop using the mouse.
2. During execution inspect focus using UIAutomation. It stays on the read-only composer.
3. After completion type a few characters directly. Verify they appear, then erase without sending.

If keyboard send creates no turn, identify focus and whether keys reached the window. Report the cause instead of substituting a button click.

### 2. Item 14, no English sentences in UI

Scope is fixed copy generated by this version. Exclude the following but list them in the report.
- Historical records from older versions.
- AI-generated text, tool names, commands, paths.
- Fault-code values.
- Codex, Claude Code, Relay, Node names.

Scan Home, Devices, Project, Conversation, Inbox, every Settings page, Roadmap, initial setup (R5 `v4-firstrun-data` screenshots allowed), and new conversation content from §§1/3. UI words meaning "agent" or "this PC" also fail.

### 3. Items 6/8, Codex

1. Send a brief test turn, such as "Reply only ok".
2. On failure find `[codex:failure]` in part-3 logs and record variant/HTTP status.
3. Act on evidence.
   - Account/login/quota/service failure. Do not fix, explain required user action.
   - A variant with known 0.162.1 schema meaning missing in classification (such as `rateLimitExceeded`). Add that observed mapping and tests in a separate commit.
   - Apparent old 0.149.1 issue. Ask whether the user approves selecting 0.162.1. If approved select in installed Settings without modifying `~/.codex`.
   - Otherwise report investigation progress without guessing.
4. Once usable, spend remaining three turns on stop, an approval-required command (verify Inbox before Reject/Allow once), and a file write/Changes.
5. Inbox must show approval, failed, and completed categories, with "Got it" on failure/completion and reasons for non-approvable entries.

### 4. Item 9, system notifications

If part-4 test notification was absent, mark Untested and explain.

Otherwise.
1. Send one brief Claude Code turn, immediately minimizing.
2. Wait 90 seconds, inspecting `notification shown` / `notification skipped`.
3. Read-only `GET http://127.0.0.1:4317/api/v1/attention` with `Origin: http://tauri.localhost` must show completion Attention for this turn.
4. Read notification through history/UIAutomation, recording Device · Project and explanation, not conversation title.
5. Click and verify the correct conversation.

Interpretation.
- Attention exists, no `notification shown`. Trace early return in `apps/web/src/runtime/notifications/attention-notification-coordinator.ts`. Report findings and fix only confirmed causes in a separate tested commit.
- `notification shown` exists, Windows displays nothing. Report and await my decision.

### 5. Icons

Capture final dual-card icons in four locations.
- Taskbar CodeTether button.
- Tray, including hidden-icons popup.
- Start-menu search result for CodeTether.
- `codetether-desktop.exe` row in Explorer at `C:\Users\Administrator\AppData\Local\CodeTether`.

If Explorer cannot foreground, ask for `! explorer.exe "C:\Users\Administrator\AppData\Local\CodeTether"` then capture.

If old icons remain, honestly record "Icon cache" and do not clear it. Explain optional user `! ie4uinit.exe -show`, then recheck if run.

### Do not do

- Pair, unpair, remove projects, import conversations.
- Log in/out or change accounts.
- Upgrade/downgrade Codex or modify `~/.codex`.
- Modify Windows registry, shortcuts, or notification settings.
- Delete test project/conversations or `v4-firstrun-data`. Document retained data.

## Checks and commits

- Before each commit run `env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm typecheck` and equivalent `lint`/`test`/`build`, all exit 0. Also `cargo test` in `apps/desktop/src-tauri` for Rust changes.
- Batch Prettier using `xargs -n 40 npx prettier --list-different --end-of-line auto`.
- End commits with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- No push, merge, or tag.

## Report

Write `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r6.md`.
- Commit hashes and check results.
- Installer SHA256 and running `hostVersion`.
- Observed Codex variant/HTTP status, cause category, required user action.
- Both part-4 notifications, shortcut path, delivery logs, Attention creation.
- Items 5, 6, 8, 9, 14 with evidence/screenshots and excluded English for item 14.
- Four icon screenshots and conclusions.
- Untested items/reasons.
- Denied actions and handed-off `!` commands.

## Restrictions

- Change only part-1/2 files/tests and confirmed fixes under part 5 §§3/4. Preserve `docs/reviews/`.
- Do not read .secrets/, any .env, credentials, machine-credentials, `~/.codex/auth.json`, or ~/.claude.json.
- Preserve main-worktree untracked files.
- No `rm -rf`, backup/installer deletion, or `git worktree remove`.
- Sed-redact `sk-…` and `sb_publishable_…`.
- Never bypass denied permissions, hand off `! …`.
- Honor Retry-After on 429/524, at most three timestamped retries, then stop/report.
- Report in Chinese without exclamation marks or em dashes.
