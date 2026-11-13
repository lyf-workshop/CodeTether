# Task — Mac Round 6: Diagnose Notifications Accepted by the System but Never Displayed

Run on Mac. Do not change code, repackage, or reinstall. First read rounds 1–5 in `~/agenthub-archive/v4-acceptance-report-mac.md`. UI follows docs/ux-redesign under temporary user authorization that overrides AGENTS.md's Figma-only source rule.

The agent must inspect the UI directly instead of returning visual judgments to the user. The requests below to watch the screen are necessary to confirm whether system notifications appear, alongside the agent's screenshot checks.

Before starting, verify read-only that `/Applications/CodeTether.app` runs build `git-a8abbecc12ea` and production data contains 11 projects, 2 devices, and 25 conversations. Otherwise stop and report.

## Background

Round 5 logged `notification requested`, `authorization result=granted`, and `notification shown … platform=macos`, followed after restart by `authorization status=authorized`. The web app requested notification delivery, macOS granted permission, and `addNotificationRequest` returned without error. However, neither the screen nor Notification Center displayed it. The code does not remove delivered notifications and supplies only a title and body.

Remaining hypotheses concern the system.
1. System-wide banners are suppressed, for example during screen sharing, remote control, or mirroring, when macOS suppresses notifications by default.
2. Several apps share bundle ID `com.codetether.desktop`, including the installation, two backups, two build directories, and possibly a DMG. Their distinct ad-hoc signatures may prevent the notification service from matching the running app, causing notifications to be dropped.
3. Rounds 3–5 launched the app's executable directly in a terminal for logging, bypassing normal LaunchServices startup, potentially affecting notification attribution.
4. Round 4's `log stream` omitted `--level debug`. Most usernoted records are info/debug, so an empty log does not prove the system received nothing.

Determine which hypothesis applies this round.

## Part One — Read-Only Checks

1. Run `codesign -dv --verbose=4 /Applications/CodeTether.app 2>&1` and record Identifier, Signature, CDHash, and TeamIdentifier lines.
2. List all registered apps with this bundle ID.
   `/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -dump | grep -B5 -A5 'com.codetether.desktop' | grep -E '^\s*path:'`
   Record paths only.
3. Run `defaults read com.apple.ncprefs apps`, extracting only fields in the `bundle-id = "com.codetether.desktop"` section. Record no other app's settings.
4. Ask the user two questions, recording answers without asking for changes.
   - Is this Mac currently being operated through screen sharing, remote desktop, or mirroring?
   - Is Allow Notifications When Mirroring or Sharing Displays enabled in System Settings > Notifications?

## Part Two — Control Notification Without a Turn

1. Run `osascript -e 'display notification "诊断用测试通知" with title "通知对照"'`.
2. Immediately capture a small region at the screen's top right and ask the user to inspect that area and Notification Center, answering Seen or Not Seen.
3. If unseen, system-wide suppression such as sharing or Focus is responsible, rather than CodeTether. Explain the cause, skip parts three and four, and write the report.

## Part Three — Retest After Normal System Launch

1. Ask the user to quit CodeTether from the menu bar, and confirm Desktop, Host, and Host guardian have exited.
2. The agent launches normally through the system while retaining logs.
   `open -a /Applications/CodeTether.app --stderr ~/agenthub-archive/v4-mac-r6-desktop-stderr.raw`
3. Verify running build and data counts read-only.
4. Capture system notification logs in another terminal, stopping 60 seconds after the turn ends.
   `log stream --level debug --style compact --predicate 'process == "usernoted" OR process == "NotificationCenter" OR subsystem == "com.apple.UserNotifications"' > ~/agenthub-archive/v4-mac-r6-usernoted-1.raw`
5. Turn 1 uses the test Codex conversation in `v4 Mac Acceptance Test`. Type the exact prompt `只回复 OK，不要读写文件` (“Reply only OK, without reading or writing files”). Immediately ask the user to click Finder so that it covers CodeTether.
6. Within 60 seconds of completion, capture the top-right screen region, ask the user to check the screen and Notification Center, record new Desktop log lines containing `notification`, and stop log stream.
7. If notification appears, it should contain Device · Project and an explanation, without a conversation title. Use turn 2 to complete round 5's tests 3 and 4, clicking once while CodeTether is running, then asking the user to quit CodeTether and clicking again in Notification Center. Turn 2 may run only once. Use the notifications produced by turns 1 and 2 for the two clicks. If both open the correct conversation, item 9 passes.
8. If no notification appears, record usernoted lines containing codetether, then proceed to part four.

## Part Four — Duplicate Registrations for One Bundle ID

Proceed only if part one, step 2 found multiple paths and part three still produced no notification.

1. Show the registered paths, identifying backups and build copies. Ask whether unused copies should be unregistered with `lsregister -u <path>`. Only unregister backup/build copies, preserving `/Applications/CodeTether.app`. Unregistering removes system registration without deleting files and is reversible with `lsregister -f <path>`.
2. After approval, the user runs the commands personally, or explicitly authorizes the agent to do so.
3. Run `lsregister -f /Applications/CodeTether.app`. Ask the user to quit, restart using part three, step 2, and use turn 2 to repeat steps 4–7 with log filename suffix `-2`.
4. If turn 2 was already consumed in part three, do not run another turn. State this in the report.

## Icons

If round 5 lacks Dock and menu-bar icon captures, add them using `screencapture -R` on small icon-only regions and verify the purple double-card design.

## Budget and Stop Conditions

- At most two Codex turns and zero Claude Code turns. Do not resend failed turns.
- On API 429 or 524, follow Retry-After, retry at most three times, and record each attempt's time. Then stop and report.

## Prohibited Actions

- No code changes, commits, pushes, reinstallations, or repackaging.
- Preserve account, Provider selection, gateway, `~/.codex`, and `~/.claude`.
- The agent reads but does not change notification permissions, Focus, notifications during mirroring, or Gatekeeper.
- Delete no app copies or backups. Part-four unregistration requires user approval.
- Do not clear the notification database or icon cache.

## Logs and Report

- After testing, ask the user to quit, process logs, then ask the user to reopen CodeTether normally.
  - For Desktop, redact `sk-…`, `sb_publishable_…`, and Bearer with sed. Retain only lines containing `[codetether:desktop]`, `[codetether:lifecycle]`, or `notification`.
  - For usernoted, retain only case-insensitive codetether lines and record the raw log's total line count.
  - Save each as `.sanitized.log`, then delete `.raw`.
- Append a new Round 6 section to `~/agenthub-archive/v4-acceptance-report-mac.md`, covering the following.
  - Part-one signature details, registered paths, CodeTether's ncprefs section, sharing status, and mirroring notification setting.
  - Control-notification results.
  - Time, observations, and log lines for each part-three turn.
  - Whether part four ran and its results.
  - Icon findings.
  - Final totals for the 15-item checklist.
  - Final production counts for projects, devices, and conversations.
- End the reply with a Chinese summary, full sanitized logs, and the lsregister path list for forwarding to the Windows reviewer.

## Restrictions

- Do not read .secrets/, any .env, credential files, machine-credentials contents, `~/.codex/auth.json`, `~/.claude.json`, or `~/agenthub-work/v4-build.env`.
- Do not bypass permission rejection. Give the command to the user for terminal execution.
- Write the report in Chinese, without exclamation marks or em dashes.
