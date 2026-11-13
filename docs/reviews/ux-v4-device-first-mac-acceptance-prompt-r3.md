# Task. Mac installed-build acceptance round 3 (notifications, items 5/6/10, icons)

Run on Mac, continuing prior rounds without reinstalling, rebuilding, or changing code. First read rounds 1/2 of `~/agenthub-archive/v4-acceptance-report-mac.md`. UI follows docs/ux-redesign under temporary authorization overriding AGENTS.md's Figma-only rule.

The agent must judge installed UI through accessibility interfaces/screenshots instead of handing judgments to the user.

Read-only verify running `/Applications/CodeTether.app` is `git-835489dd3c9e` with 11 production projects, two devices, 25 conversations. Stop on mismatch.

Round 2 had 11 passes, failures 5/9, untested 6/10. Review corrections follow.

- Item 5 was misstated in round-2 prompt. Composer is intentionally read-only during execution. Verify keyboard-send focus persists and typing resumes without a mouse after completion. Running `aria-disabled` (`apps/web/src/components/conversation/composer.tsx:227-228`) appearing as Disabled in accessibility is normal, not evidence of lost focus.
- Item 6. `sleep` needs no approval in Codex's default workspace sandbox. Request a write outside the test project instead.
- Item 9. Notifications were absent twice, cause unknown. Capture Desktop logs and diagnose without fixing.

## Part 1. Launch with logs

1. Read `CFBundleExecutable` from `/Applications/CodeTether.app/Contents/Info.plist`.
2. Ask for menu-bar exit, verifying Desktop, Host, and guardian stop.
3. Ask user to run and reply Started, replacing the executable placeholder.
   `/Applications/CodeTether.app/Contents/MacOS/<executable> 2> ~/agenthub-archive/v4-mac-r3-desktop-stderr.raw &`
4. Verify running build `git-835489dd3c9e` and first log line `[codetether:desktop] version=… build=git-835489dd3c9e`.

## Part 2. Notification prerequisites

Read-only, without settings changes.
- Record all three CodeTether notification switches. Ask the user to enable disabled ones and document their changes.
- Ask user to inspect System Settings > Notifications for CodeTether, recording Allow notifications and alert style, or absence.
- Record all log lines containing `notification` so far.

## Part 3. Turn tests

Use the existing Codex test conversation in `v4 Mac Acceptance Test`, no new conversation. Type and press Enter each time, without Send clicks.

Turn 1, approval/rejection and clicking while running.
1. Send "Create `~/agenthub-work/mac-r3-outside-check.txt` containing outside. This is outside the current project, request approval if required."
2. Immediately inspect focused element, recording whether it is the composer (item 5 first half).
3. Immediately ⌘M minimize.
4. Approval should produce a waiting-approval notification. Ask user to Allow the first macOS permission prompt.
5. If present, read Notification Center title/body. Body must be Device · Project plus explanation, no conversation title. Ask user to click and reply Clicked. Verify foreground window and route's current `turn`.
6. If absent, wait 60 seconds, record new notification logs, and ask user to switch back manually.
7. Reject in conversation. Verify no file was created and turn ends.

Turn 2, Allow once and typing after completion.
1. Send the same request with window foreground.
2. Allow once. Verify `~/agenthub-work/mac-r3-outside-check.txt` exists with content outside.
3. After completion type `abc` without mouse, verify composer receives it (item 5 second half), erase without sending.
4. Item 5 requires composer focus after sending both turns and successful typing here.
5. Delete only this round's `~/agenthub-work/mac-r3-outside-check.txt`.

Turn 3, click after exit.
Only if turn 1 delivered a notification.
1. Send "Reply only OK, do not read or write files" and minimize immediately.
2. After completion notification, do not click yet. Ask for menu-bar exit and verify processes stop.
3. Ask user to click the Notification Center entry and reply Clicked.
4. Record whether CodeTether starts, window appears, and route includes this turn.
5. Code note. `apps/desktop/src-tauri/src/macos_notifications.rs:66-77` only restores the window when the intent is absent from memory. If it opens without navigating, mark Fail and describe, without fixing.
6. This click-launch has no log. Ask for exit and restart using part 1 with `v4-mac-r3-desktop-stderr-2.raw`.

## Part 4. Item 10 startup first frame

1. Select light appearance and ask for menu-bar exit.
2. Use `screencapture -v -V 3 -R <x,y,w,h>` for three seconds over the future CodeTether window region. Ask user to launch immediately after recording starts. Obtain position from round-1 shots/window info. User decides screen-recording permission, agent does not alter settings.
3. Extract ten frames per second and inspect each for dark blue. Retain earliest visible-window frame only, delete video/other frames.
4. If capture fails, mark Untested without guessing.
5. System appearance and restart persistence passed round 2, no repeat.

## Part 5. Icons

Use `screencapture -R` on small regions.
- Dock icon.
- Menu-bar icon.
- Launchpad icon after user opens/searches CodeTether.
Verify purple dual cards in all three. Record caching honestly without clearing it.

## Budget and stop conditions

- At most three assigned Codex turns, no failed-turn resend, zero Claude Code turns.
- Missing turn-1 notification fails item 9. Record settings/log observations, omit turn 3, continue other parts.
- Honor Retry-After on 429/524, at most three timestamped retries, then stop/report.

## Do not do

- Code changes, commits, pushes, tags, reinstallation.
- Changes to account, Provider selection, gateway, `~/.codex`, `~/.claude`.
- Pair/unpair, add/remove projects.
- System/notification/recording/Gatekeeper changes or icon-cache clearing.
- Delete anything beyond this round's created file and intermediate recordings. Preserve backups/isolated data.

## Logs and report

- After testing ask for exit. Sed-redact `sk-…`, `sb_publishable_…`, Bearer from each `.raw`, retain only `[codetether:desktop]`, `[codetether:lifecycle]`, `notification` lines, save `.sanitized.log`, delete raw, then ask normal reopening.
- Append "Round 3" to `~/agenthub-archive/v4-acceptance-report-mac.md`.
  - Notification switches/system settings from part 2.
  - Turn times/results.
  - Send focus location.
  - Notification content and both click results.
  - All notification log lines.
  - Item 10 and icons.
  - Final 15-item totals.
  - Ending production project/device/conversation counts.
- Shots in `~/agenthub-archive/v4-acceptance-mac-screenshots/` with `r3-` filenames.
- Final Chinese pass/fail/untested summary identifies failures/reasons and includes full sanitized logs for Windows review.

## Restrictions

- Do not read .secrets/, any .env, credentials, machine-credentials contents, `~/.codex/auth.json`, `~/.claude.json`, or `~/agenthub-work/v4-build.env`.
- Never bypass denied permissions. Provide terminal commands for user execution.
- Report in Chinese without exclamation marks or em dashes.
