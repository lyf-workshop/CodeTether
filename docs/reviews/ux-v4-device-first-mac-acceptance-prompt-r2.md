# Task: Additional Mac Installed-App Acceptance (v4 Desktop, Round 2)

Run on Mac. Continue the previous round without reinstalling, repackaging, or code changes. Read the previous report `~/agenthub-archive/v4-acceptance-report-mac.md` first. The UI follows docs/ux-redesign under temporary user authorization overriding AGENTS.md's “Figma is the only source.”

User requirement: the agent checks the installed app directly using accessibility APIs and screenshots; do not delegate UI judgments to the user.

Before starting, read-only verification: `/Applications/CodeTether.app` runs build `git-835489dd3c9e`, with 11 projects, 2 devices, 25 conversations. Stop and report any mismatch.

Previous round: 9 passed, 0 failed, 6 untested. This round covers items 1, 2, 5, 6, 9, 10 and icons.

## Part One: Additional Tests with Production Data

Use the existing `v4 Mac Acceptance Test` project (directory `~/agenthub-work/v4-accept-project-mac`) and its test Codex conversation; do not create a new project.

Items 6 and 5:
1. Turn 1: send “Run `sleep 20 && echo done`.” Once approval appears, confirm the item under Waiting for approval in Inbox, then return to the conversation and Reject. Confirm the turn ends without executing the command.
2. Turn 2: send “Create `mac-r2-diff-check.txt` in the current directory with three lines: first, second, third.” Allow once if approval is needed. While the turn is running (composer read-only), type a few characters directly with the keyboard; confirm focus remains in the composer and characters can be entered, for item 5. After completion, confirm `+3` in Changes and open it to see the three additions.
3. Turn 3: send “Run `sleep 120 && echo done`”; approve, then click Stop while running. Confirm the turn stops and status becomes Stopped.

Item 9 while CodeTether is running:
4. Turn 4: send “Delete `mac-r2-diff-check.txt`”; Allow once if needed. Immediately minimize the window (⌘M) after sending.
   - macOS requests notification permission on the first notification. Ask the user to Allow; the agent does not change system settings.
   - After completion, read CodeTether's notification in Notification Center and record its text: “Device · Project” plus an explanation, without the conversation title.
   - Ask the user to click this notification and reply “Clicked.” The user clicks; the agent evaluates whether the window comes forward and the route contains this turn's `turn` parameter and `notification-N`.
   - Confirm `-3` in Changes and open it to see the three deletions.

Item 9 after CodeTether quits:
5. Turn 5: send “Reply only OK; do not read or write files,” then minimize. Wait for completion and notification; do not click it yet.
   - Ask the user to quit CodeTether from the menu bar. Confirm Desktop, Host, and Host guardian all exit.
   - Ask the user to open Notification Center, click the CodeTether notification, and reply “Clicked.”
   - Record whether CodeTether launches, the window appears, and the route includes this turn's `turn` parameter.
   - Read-only code hint: `apps/desktop/src-tauri/src/macos_notifications.rs:66-77` restores the window without navigation if the notification is absent from memory. A click after exit may only open the window without the conversation. If observed, honestly mark Failed, record behavior and code location; do not fix this round.

## Part Two: Item 10, Theme

1. Select System in settings; confirm appearance matches the current system setting.
2. Ask the user to switch light/dark once in System Settings > Appearance; the agent confirms CodeTether follows, then asks the user to restore the original appearance. Do not change system settings yourself.
3. Select dark and light separately, quit from the menu bar and reopen each time, confirming persistence.
4. Check for a dark-blue startup flash: select light, quit/reopen, and capture several CodeTether-window screenshots within the first second. If unable to capture the first frame, mark Untested; do not guess.
5. Restore the user's original theme preference afterward.

## Part Three: Items 1 and 2 with Isolated Data

Leave production data directory `~/Library/Application Support/CodeTether` untouched.

1. Ask the user to quit CodeTether from the menu bar.
2. Launch the installed app with a separate data directory, e.g. `~/agenthub-work/v4-firstrun-data-mac`. First verify in code that Desktop and Host honor `CODETETHER_DATA_DIR` (around `apps/desktop/src-tauri/src/system_tray.rs:180`), then give the user a terminal command such as:
   `CODETETHER_DATA_DIR="$HOME/agenthub-work/v4-firstrun-data-mac" /Applications/CodeTether.app/Contents/MacOS/<actual-executable-name>`
3. After launch, read-only confirm Host uses the isolated directory: 0 projects and 0 conversations. Otherwise immediately ask the user to quit, stop, and report.
4. Item 1: first-run setup shows installation, runtime, and service separately; main button says Continue setup.
5. Item 2: add a folder containing existing Codex conversation records (read-only find a working directory in `~/.codex/sessions`, reading directory paths only, no conversation content). Confirm previous conversations appear and import one. Import only into isolated data.
6. Ask the user to quit the isolated instance, then open CodeTether normally from Launchpad; confirm production data returns (11 projects).

## Part Four: Icons

Capture small regions containing only the CodeTether icon: Dock, Launchpad, menu bar, About window. Confirm purple stacked cards, not old icons. Honestly record old cached icons without clearing caches.

## Budget and Stop Conditions

- Codex: at most 5 turns allocated as above; do not resend failed turns. Claude Code: 0 turns.
- Record a failed step and continue independent steps.
- API 429 or 524: wait per Retry-After, retry at most 3 times, record each time, then stop and report.

## Prohibited Actions

- No code changes, commits, pushes, tags, or reinstallation.
- Do not change account, Provider selection, gateway, `~/.codex`, or `~/.claude`.
- No pairing, unpairing, or project removal. No new projects except isolated data in part three.
- The agent does not change system settings, notification permissions, or Gatekeeper, or clear icon caches.
- Delete only this round's `mac-r2-diff-check.txt`. Do not delete backups or isolated data directories.

## Report

- Append a Round 2 section to `~/agenthub-archive/v4-acceptance-report-mac.md`: times/results for each turn; conclusions/evidence for items 1, 2, 5, 6, 9, 10; notification text; results of both notification clicks; icons; final totals across 15 items; production project/device/conversation counts at completion.
- Save screenshots in `~/agenthub-archive/v4-acceptance-mac-screenshots/` with `r2-` prefixes.
- End with a Chinese summary: counts passed, failed, untested, and failed items with reasons.

## Restrictions

- Do not read .secrets/, any .env, credential files, machine-credentials contents, `~/.codex/auth.json`, `~/.claude.json`, or `~/agenthub-work/v4-build.env`.
- If permission is denied, do not bypass it; give the user a command to run in Terminal.
- Write the report in Chinese, without exclamation marks or em dashes.
