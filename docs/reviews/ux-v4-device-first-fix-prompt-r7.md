# Task. Select Codex 0.162.1, restore the Start-menu shortcut, and finish items 6, 8, 9 and icons

Branch `ux/v4-device-first`, worktree `D:/Projects/Software/agenthub-ux-v4-device-first`. Require clean `4f30416e4307731d38141ac244c47b8ba716546f`, otherwise stop and report. UI/icons follow docs/ux-redesign under temporary user authorization overriding AGENTS.md's Figma-only rule.

The agent must inspect the installed UI directly instead of returning UI judgments to the user.

See `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r6.md` and "Round 6" of `docs/reviews/ux-v4-device-first.md`. Twelve items pass. Items 6, 8, 9 and icons in four locations remain.

Code changes are not expected unless part 4 identifies a confirmed cause. Repackage if code changes.

## Part 1. Start-menu shortcut

R6 reinstallation had `C:\Users\Administrator\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\CodeTether.lnk`, now absent. Desktop `E:\OneDrive\Desktop\CodeTether.lnk` remains. Without a Start-menu shortcut, Windows does not register `com.codetether.desktop`, possibly explaining notifications and Start-menu icons.

1. Inspect read-only.
   - This and prior rounds' `.tmp/` scripts for Start-menu deletion/movement.
   - Programs and `C:\ProgramData\Microsoft\Windows\Start Menu\Programs` for renamed/nested shortcuts.
   If attribution fails, record "Unknown cause" without guessing.
2. Reinstall the same R6 installer to restore a correctly identified shortcut.
   - Use R6 `56A1841DDD8BCF93…`, without rebuilding.
   - Follow R6 part 3. Ask for tray exit, never terminate processes, preserve data, and launch the original installed path with `Start-Process -RedirectStandardError <archive log>`.
   - Verify `hostVersion` remains `git-4f30416e4307`.
3. Confirm shortcut exists, AppID is `com.codetether.desktop`, and `Get-StartApps` lists CodeTether.
4. Check at task start, after every part, and before reporting, recording time. If it disappears again, record surrounding actions and stop.

## Part 2. Select Codex 0.162.1

The user authorized selecting latest local Codex 0.162.1 (`C:\Users\Administrator\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe`) inside CodeTether.

- Click Select only for 0.162.1 in the installed Devices/Settings Codex installation list.
- Do not upgrade, downgrade, delete Codex, modify `~/.codex`, or read `~/.codex/auth.json`.
- Confirm read-only through the local API that selected version is 0.162.1 and status is "Compatible · Runnable".
- If absent/unselectable, stop and explain.

0.162.1 is absent from the adapter's tested-version list (`packages/adapter-codex/src/compatibility.ts:32`). Record this without changing that list.

## Part 3. Items 6 and 8

Use the Codex conversation in `D:/Projects/Software/agenthub-work/v4-accept-project`, at most four brief turns.

1. Start with a request such as "Reply only ok".
   - If still failing, record `[codex:failure]` and stop. Do not change classification or return to 0.149.1.
2. If successful, use the remaining three turns for the following.
   - Stop a request that runs long enough, verify stopped turn and correct UI state.
   - One approval-required command, observe it in Inbox, then Reject or Allow once.
   - Write one new test-folder file and inspect Changes.
3. Item 8 must show waiting approval, failure, and completion together, with "Got it" for failed/completed.
   - Acknowledge only items from this round's test conversations.
   - Explain non-approvable entries.

## Part 4. Item 9 system notifications

1. After part 1, read `CreateToastNotifier('com.codetether.desktop').Setting`.
2. If `Enabled`, do the following.
   - Send one brief Claude Code turn in the test project and immediately minimize.
   - Within 90 seconds inspect `notification shown` or `notification skipped`.
   - Verify completion Attention with `GET http://127.0.0.1:4317/api/v1/attention`, `Origin: http://tauri.localhost`.
   - Read notification history/UIAutomation, recording only Device · Project and explanation, not conversation title.
   - Click and confirm the correct conversation opens.
   - A Codex approval/failure while minimized in part 3 may replace this test, saving the Claude turn.
3. If still `DisabledForApplication`, ask the user to check CodeTether in Settings > System > Notifications and enable it if appropriate. Do not edit registry. Recheck after confirmation, then follow step 2.
4. Attention exists but no `notification shown` means frontend did not call native delivery. Trace the return in `apps/web/src/runtime/notifications/attention-notification-coordinator.ts`. Fix only a confirmed cause in a separate tested commit, then rebuild/reinstall.
5. If `notification shown` exists but Windows shows nothing, report and await my decision.

The local account is built-in Administrator and CodeTether is elevated. Record without changing it.

## Part 5. Icons

Three of four locations remain.

- Taskbar. R6's old kite is icon caching. Let the user decide on `! ie4uinit.exe -show`, then recapture. Without it, record "Icon cache".
- Tray. R6 popup moved after capture. Open hidden icons, wait for two identical position reads, then capture.
- Start menu. After shortcut restoration, search CodeTether and capture the app row.

Explorer and title bar passed R6 and need no repeat.

## Execution budget

- Installed Codex, at most four turns. No direct Codex CLI.
- Installed Claude Code, at most one turn for part 4.
- Execute only in the test folder.

## Do not do

- Pair, unpair, remove existing projects, or import conversations.
- Log in/out or change account.
- Edit registry/system notification settings. Restore shortcuts only by reinstalling, never manually.
- Clear icon caches. The user decides whether to run `ie4uinit.exe`.
- Delete test projects/conversations or `v4-firstrun-data` afterward.

## Checks and commits

Required only if part 4 step 4 changes code.
- Run `env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm typecheck` and equivalently `lint`, `test`, `build`, all exit 0.
- Batch-check changed files with `xargs -n 40 npx prettier --list-different --end-of-line auto`.
- End commits with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Packaging uses R6's three settings and the already supplied public key.
- No push, merge, or tag.

## Report

Write `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r7.md`.
- Shortcut investigation, post-reinstall state, times/results of every existence check.
- Running `hostVersion` and whether the original R6 installer was used.
- Codex versions/states before/after selection and every turn outcome.
- Items 6, 8, 9 with evidence/screenshots.
- Notification `Setting`, logs, and Attention generation.
- Taskbar/tray/Start-menu icon screenshots and conclusions.
- Cumulative checklist results.
- Untested items/reasons, denied actions and handed-off `!` commands.

Screenshots go in `output/playwright/v4-installed-acceptance-r7/`.

## Restrictions

- Do not read .secrets/, any .env, credential files, machine-credentials contents, `~/.codex/auth.json`, or ~/.claude.json.
- Do not modify `docs/reviews/` or main-worktree untracked files.
- No `rm -rf`, backup/old-installer deletion, or `git worktree remove`.
- Redact `sk-…` and `sb_publishable_…` with sed.
- Do not bypass denied permissions. Hand commands to the user as `! …`.
- For API 429/524 honor Retry-After, at most three retries with timestamps, then stop/report.
- Report in Chinese without exclamation marks or em dashes.
