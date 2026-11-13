# Task: Mac Installed App Round 4 (Find Out Why Notifications Never Appeared)

Run on Mac. Diagnose only; no code changes, reinstallation, or repackaging. First read rounds 1–3 in `~/agenthub-archive/v4-acceptance-report-mac.md`. UI follows docs/ux-redesign under temporary user authorization overriding AGENTS.md's “Figma is the only source.”

Read-only checks before starting: `/Applications/CodeTether.app` runs `git-835489dd3c9e`; production data has 11 projects, 2 devices, 25 conversations. Stop and report any mismatch.

Currently 13 passed, item 9 failed, item 10 untested. Round 3 logs contain no desktop-notification lines. Code inspection suggests three possibilities:

- A: The web layer never requested delivery. macOS may suspend WebView when CodeTether is minimized, preventing Host attention events from arriving. By restoration, the window is foreground, so the event intentionally generates no notification (`apps/web/src/runtime/notifications/desktop-notification-model.ts:115-129`).
- B: macOS received the notification, but system settings, Focus, or alert style hid it. CodeTether does not log successful macOS delivery (`apps/desktop/src-tauri/src/macos_notifications.rs:289-310`), so logs cannot show this.
- C: Notification authorization never resolves, leaving notifications queued (`macos_notifications.rs:260-287`).

This round determines which applies.

## Part One: System Settings (Read Only)

1. Ask the user to open System Settings > Notifications > CodeTether and report: Allow notifications on/off; alert style (None, Banners, Alerts); Show in Notification Center; Show on Lock Screen.
2. Ask whether Focus is enabled in Control Center.
3. Record without asking for changes. If Allow notifications is off or alert style is None, classify as B, record it, proceed directly to part three, then stop.

## Part Two: Launch with Logs

1. Ask the user to quit CodeTether from the menu bar; confirm Desktop, Host, Host guardian all exit.
2. Ask the user to run this in Terminal (`<executable-name>` is `CFBundleExecutable` from `Info.plist`) and reply “Started”:
   `/Applications/CodeTether.app/Contents/MacOS/<executable-name> 2> ~/agenthub-archive/v4-mac-r4-desktop-stderr.raw &`
3. Read-only confirm running build `git-835489dd3c9e`.

## Part Three: Two Comparison Tests

Use the test Codex conversation in `v4 Mac Acceptance Test`. Each time send “Reply only OK; do not read or write files.”

Before each send, start capturing macOS notification logs in another Terminal window; stop 60 seconds after the turn ends:
`log stream --style compact --predicate 'process == "usernoted" OR process == "NotificationCenter"' > ~/agenthub-archive/v4-mac-r4-usernoted-<1-or-2>.raw`
If macOS requests permission, let the user decide. The agent does not alter settings.

Test 1, obscured without minimizing:
1. Immediately after sending, ask the user to click Finder or another app so it covers CodeTether; do not minimize CodeTether.
2. Wait 60 seconds after the turn ends without switching back.
3. Record: notification on screen; notification in Notification Center; new Desktop-log lines containing `notification`; any `com.codetether.desktop` in usernoted logs.

Test 2, minimized:
1. Immediately after sending, minimize with ⌘M.
2. Wait 60 seconds after the turn ends without restoring.
3. Record the same four observations.

Interpretation:
- Notification in test 1 but not test 2: A, WebView stopped after minimization.
- Both usernoted logs contain `com.codetether.desktop`, but no onscreen notification: B.
- Neither usernoted log contains it, with no Desktop `delivery failed`: possibly A or C; report honestly without guessing.

## Part Four: Screenshot Permission

The first three rounds captured neither Dock/menu-bar/Launchpad icons nor the startup first frame. First check whether screenshots contain only desktop wallpaper without other apps' windows. If so, the terminal you use lacks Screen Recording permission. Read-only confirm, report, and ask the user whether to enable permission for that terminal in System Settings > Privacy & Security > Screen Recording. If enabled, complete round 3 part four (first startup frame) and part five (icons). Otherwise mark Untested.

## Budget and Stop Conditions

- Codex: at most 2 turns. Claude Code: 0 turns. Do not resend failed turns.
- API 429 or 524: wait per Retry-After, retry at most 3 times, record each time, then stop and report.

## Prohibited Actions

- No code changes, commits, pushes, or reinstallation.
- Do not change account, Provider selection, gateway, `~/.codex`, or `~/.claude`.
- The agent does not change system settings, notification permission, Focus, Screen Recording permission, or Gatekeeper, or clear icon caches.
- Do not touch others' changes in the original Mac workspace, including `apps/site/.env.example` and `apps/site/components/site-analytics.tsx`; do not read env files other than `.env.example`.

## Logs and Report

- After testing, ask the user to quit CodeTether, then process logs:
  - Desktop: redact `sk-…`, `sb_publishable_…`, Bearer with sed; retain only lines containing `[codetether:desktop]`, `[codetether:lifecycle]`, or `notification`.
  - usernoted: retain only lines containing `codetether`, case-insensitive.
  - Save both as `.sanitized.log`, then delete `.raw`.
  - Finally ask the user to reopen CodeTether normally.
- Append a Round 4 section to `~/agenthub-archive/v4-acceptance-report-mac.md`, including:
  - Read-only system settings from part one;
  - Both test times and the four observations for each;
  - A/B/C conclusion with evidence;
  - Screenshot-permission conclusion;
  - Final totals across 15 items;
  - Production project/device/conversation counts at completion.
- End with a Chinese summary and the complete contents of both sanitized logs in the reply; the user will forward them to the reviewer on Windows.

## Restrictions

- Do not read .secrets/, any .env, credential files, machine-credentials contents, `~/.codex/auth.json`, `~/.claude.json`, or `~/agenthub-work/v4-build.env`.
- If permission is denied, do not bypass it; give the user a command to run in Terminal.
- Write the report in Chinese, without exclamation marks or em dashes.
