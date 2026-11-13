# Task: Mac Round 7 (Instrument the Web Notification Pipeline to Explain the Missing Second Notification)

Run on Mac. Make a small code change in one new `fix/macos-notifications` commit, then package, replace the installed app, and test. First read rounds 1–6 in `~/agenthub-archive/v4-acceptance-report-mac.md`. UI follows docs/ux-redesign under temporary user authorization overriding AGENTS.md's “Figma is the only source.”

User requirement: the agent evaluates UI directly, without handing judgments back to the user. User actions below (click Finder, click notifications, quit) are needed because the agent cannot perform them or doing so would affect test results.

Read-only checks before starting:
- `/Applications/CodeTether.app` runs `git-a8abbecc12ea`;
- Production data has 11 projects, 2 devices, 25 conversations;
- `origin/fix/macos-notifications` is `a8abbecc12ea6b0b5fa83c52373a85322435130e`.

Stop and report any mismatch.

## Background

Round 6:
- The system control notification appeared.
- After normal `open -a` launch, the first turn (obscured by Finder) produced a notification; clicking returned to the correct conversation. Native notification delivery, display, and clicks therefore work.
- Later turns completed normally; Inbox grew from 24 to 26, proving Host generated new attention items, but Desktop logs had no new `notification requested`.

The problem is therefore in the web layer between receiving Host `attention.created` and calling `deliver_attention_notification`. In `apps/web/src/runtime/notifications/attention-notification-coordinator.ts`, `#deliverAttention` (lines 193–297) can silently return at:
- Lines 197, 208, 261, 274: coordinator stopped (`#isActive` false).
- Line 201: `recentIds.has` true. `main.tsx` currently passes no `recentIds`; this should be unreachable, to be confirmed by logs.
- Line 221: this notification category is disabled.
- Line 247: suppressed because “user is viewing” (window focused, visible, not minimized, on Inbox or this conversation).
- `getWindowState` at line 225 and `ensurePermission` at 266: a never-resolving call stalls the item forever without error. A stuck `ensurePermission` blocks all later items queued behind the shared request (`native-capabilities.ts:309-326`).
- After SSE disconnect, a reconnect `stream.reset` causes a fresh snapshot; intervening attention items never arrive as `attention.created`. This is intentional, but determine whether it happened during testing.

Web failure diagnostics currently use only `console.warn`, invisible in the installed app, explaining the absent logs in earlier rounds.

This round adds diagnostics only, without a fix. The reviewer will specify a fix after seeing the logs.

## Part One: Preparation

1. `git fetch origin`; in existing workspace `~/agenthub-work/v4-fix-macos-notify`, confirm `fix/macos-notifications` is clean and HEAD/remote both equal `a8abbecc12ea6b0b5fa83c52373a85322435130e`. Leave other Mac workspaces and main-workspace website changes untouched.
2. Copy current `/Applications/CodeTether.app` (a8abbec) to `~/agenthub-archive/mac-install-backup-2026-10-23/CodeTether-a8abbec.app`; verify file count and size. The data directory was already backed up; no repeat needed.

## Part Two: Code Changes

Only the changes below, in one commit: `chore(desktop): log notification pipeline stages for diagnosis`, ending with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

### 1. Native Log Command (Rust)

Add `log_notification_stage` in `apps/desktop/src-tauri/src/attention_notifications.rs`:
- One parameter, `stage`, a Rust enum deserialized with serde `rename_all = "kebab-case"`. Reject unknown values during deserialization; no arbitrary strings.
- Exactly these enum values:
  - `received`: new `attention.created` received;
  - `skip-inactive`, `skip-recent`, `skip-disabled`, `skip-suppressed`, `skip-permission-denied`: early returns;
  - `window-state-start`, `window-state-done`, `window-state-timeout`;
  - `metadata-start`, `metadata-done`;
  - `permission-start`, `permission-done`, `permission-timeout`;
  - `deliver-start`, `deliver-done`;
  - `failed-recent-id-read`, `failed-preferences`, `failed-window-state`, `failed-presentation`, `failed-metadata`, `failed-permission`, `failed-delivery`, `failed-recent-id-write`, `failed-click-listener`, `failed-navigation`;
  - `sse-connected`, `sse-reconnecting`, `sse-reset`, `sse-unavailable`.
- Do only `eprintln!("[codetether:desktop] notification stage={stage}")`. No state reads/writes; return `()`.
- Generate the line with a small helper following `notification_requested_log`. Unit-test every value for fixed format/no newlines. Also test deserialization rejects unknown, empty, and newline-containing values.

Wire the command into all three existing permission/command lists consistently:
- Command list in `apps/desktop/src-tauri/build.rs`;
- `commands.allow` in `apps/desktop/src-tauri/permissions/attention-notifications.toml`;
- `generate_handler!` at `host_supervisor.rs:1287`.

Update `apps/desktop/test/security-config.test.mjs`'s command-list test (`Web UI exposes only the bounded Desktop product commands`) with the new command. Add it to the Native Security Boundary section of `docs/ARCHITECTURE.md`, explaining that it accepts only fixed stage names and writes one log line.

### 2. Web Coordinator (TypeScript)

Add `logStage(stage)` to the notifications adapter in `apps/web/src/runtime/native/native-capabilities.ts`:
- Call `invoke('log_notification_stage', { stage })`;
- Swallow errors; do not throw or retry;
- Browser version (no Tauri) is a no-op.

Add the optional method to `DesktopNotificationAdapter`. In `attention-notification-coordinator.ts`:
- Log `received` for every new `attention.created` in `#onAppliedEvent`; do not log deduplicated events that return early.
- In `#deliverAttention`, log corresponding `skip-…` at each early return and corresponding `failed-…` with every `#report` (one-to-one with `DesktopNotificationFailureStage`).
- Log `…-start` and `…-done` before/after `getWindowState`, `resolveMetadata`, `ensurePermission`, and `deliver`.
- Wrap `getWindowState` and `ensurePermission` in a 5-second timeout; log `…-timeout` on expiration:
  - Window-state timeout follows existing error handling: consider the user “not viewing” and continue;
  - Permission timeout follows existing error handling: stop this item;
  - Do not cancel underlying requests; only stop waiting for this notification;
  - Clear timers when requests settle.
- Do not change conditions, notification copy, deduplication, or preferences. Timeouts are the only behavior change, affecting only never-resolving requests.

In `apps/web/src/main.tsx`, subscribe with `runtime.subscribe` (`host-runtime.ts:296`). Listener takes no arguments; read `runtime.getConnectionState()` inside it. Only on actual transitions to `connected`, `reconnecting`, `unavailable`, log `sse-connected`, `sse-reconnecting`, `sse-unavailable` respectively. Release this subscription with the coordinator on `pagehide`. Where `HostRuntime` handles `stream.reset` (around `host-runtime.ts:798`), log `sse-reset` through the existing applied event or a minimal callback. Choose the smallest change; do not change reconnect behavior.

Logs contain stage names only, no titles, bodies, device names, project names, paths, or IDs.

### 3. Window Event Logs (Rust)

In existing `RunEvent::WindowEvent` handling in `host_supervisor.rs`:
- `Resized`: on actual minimized-state changes, use existing `log_lifecycle_event` for `main_window_minimized` or `main_window_restored`; never log every resize.
- Add `WindowEvent::Focused(focused)`: log `main_window_focused` or `main_window_blurred`.

### 4. Tests

- Coordinator tests (existing attention-notification-coordinator test file in `apps/web`):
  - Every early-return branch logs its stage;
  - Never-resolving `ensurePermission` and `getWindowState` log `permission-timeout` and `window-state-timeout` after 5 seconds; use a fake clock, no real 5-second wait;
  - After window-state timeout, the notification still reaches `deliver-start`;
  - Browser adapter's `logStage` invokes no Tauri module.
- No new failures in existing tests.

### Leave Unchanged

- Host, notification copy/preferences/deduplication, Windows notification behavior, Rust native delivery logic.
- No new dependencies.

### Checks

- `env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm typecheck`; run `lint` and `build` with the same environment removal.
- `pnpm test`: 3 known Windows installer-path failures; Claude tests have `/var` vs `/private/var` path issues, rerun with canonical `TMPDIR`. No new failures beyond these categories.
- In `apps/desktop/src-tauri`: `cargo test --locked`, `cargo clippy --locked --all-targets -- -D warnings`, `cargo fmt --check`.
- Prettier-check changed files; `git diff --check` must be silent.
- No Windows toolchain installation; reviewer verifies Windows compilation.

## Part Three: Package and Install

1. Use build configuration `~/agenthub-work/v4-build.env`. Load only with `set -a; . ~/agenthub-work/v4-build.env; set +a` in the packaging shell; do not print/copy contents. Run `pnpm desktop:build`, redacting `sk-…`, `sb_publishable_…`, Bearer with sed before saving logs.
2. Record `.app` and `.dmg` paths, sizes, SHA256.
3. Ask the user to quit CodeTether from the menu bar; confirm Desktop, Host, Host guardian all exit.
4. Replace `/Applications/CodeTether.app` with the new `.app`, leaving data untouched. Run `lsregister -f /Applications/CodeTether.app` once afterward (explain beforehand). Do not unregister other apps.
5. Launch normally as in round 6, never directly execute the binary:
   `open -a /Applications/CodeTether.app --stderr ~/agenthub-archive/v4-mac-r7-desktop-stderr.raw`
   If `--stderr` captures no logs, stop and report; do not switch to direct binary launch.
6. Read-only verify:
   - Running build matches the new commit's first 12 characters;
   - Production data remains 11 projects, 2 devices, 25 conversations;
   - Logs contain `authorization status=…` and `notification stage=sse-connected`.
   Missing `sse-connected` means web logging is not connected; stop and investigate before testing.

## Part Four: Live Tests

Use the test Codex conversation in `v4 Mac Acceptance Test`; each time send “Reply only OK; do not read or write files.” Leave at least 1 minute between the three tests; do not send consecutively.

For every test record: start/end times; all `notification stage=…`, `notification requested`, `notification shown`, `[codetether:lifecycle]` lines during it; notification presence onscreen/in Notification Center; Inbox count.

Test 1, obscured window:
- Immediately after sending, ask the user to click Finder so it covers CodeTether, without minimizing.
- Wait until 30 seconds after turn completion.

Test 2, foreground window on another page:
- Immediately after sending, switch to Devices and keep the window foreground.
- Wait until 30 seconds after turn completion.

Test 3, minimized:
- Immediately after sending, minimize with ⌘M and verify `main_window_minimized` in logs. If missing, record it without compensating by another method.
- Wait until 30 seconds after turn completion. If a notification appears, ask the user to click it; the agent checks return to this conversation.

After each test determine the stopping point from logs:

| Log | Conclusion |
|---|---|
| No `received` | Web never received `attention.created`; check concurrent `sse-reconnecting` or `sse-reset` |
| `received` followed by `skip-…` | This check suppressed delivery; identify which |
| `…-start` without `…-done` or `…-timeout` | Stalled at this step, timeout also ineffective; identify which |
| `…-timeout` | This step exceeded 5 seconds; identify which |
| `deliver-done` followed by `notification shown` but nothing onscreen | Return to system layer; record this |

## Budget and Stop Conditions

- Codex: at most 3 turns, one per test; do not resend failed turns. Claude Code: 0 turns.
- Run all three tests; do not stop because one lacks a notification. This round collects logs.
- Fix failed checks before packaging. If changes exceed part two, stop and report.
- API 429 or 524: wait per Retry-After, retry at most 3 times, record each time, then stop and report.

## Prohibited Actions

- Edit only part-two files, corresponding tests, and the specified `docs/ARCHITECTURE.md` section.
- No push, merge, or tag. Ask at the end of the report whether to push; only after consent push `fix/macos-notifications`, without force.
- Do not change account, Provider selection, gateway, `~/.codex`, or `~/.claude`.
- No pairing, unpairing, project creation, or project removal.
- Do not change system settings, notification permission, Focus, or Gatekeeper, or clear icon caches.
- Do not delete backups or old `.app` copies.

## Logs and Report

- After testing, ask the user to quit CodeTether, then process logs:
  - Redact `sk-…`, `sb_publishable_…`, Bearer with sed;
  - Retain only lines containing `[codetether:desktop]`, `[codetether:lifecycle]`, or `notification`;
  - Save as `.sanitized.log`, then delete `.raw`;
  - Finally ask the user to reopen CodeTether normally.
- Append a Round 7 section to `~/agenthub-archive/v4-acceptance-report-mac.md`, including:
  - Commit hash/title and check results;
  - Installer paths/SHA256 and running version;
  - All three test times, log lines, screen observations, and conclusions from the table;
  - Final totals across 15 items;
  - Production project/device/conversation counts at completion.
- End with a Chinese summary and attach:
  - `git log --oneline origin/main..HEAD`;
  - `git diff --stat origin/main..HEAD`;
  - Complete diff of this round's new commit;
  - Full sanitized logs.
  The user will forward them to the reviewer on Windows.

## Restrictions

- Do not read .secrets/, other .env files, credential files, machine-credentials contents, `~/.codex/auth.json`, or `~/.claude.json`. Load `v4-build.env` only as in part three step 1; never read contents.
- Explain before each `defaults` or `lsregister` invocation.
- Never unregister/delete other apps' registrations or delete backups.
- Pin exact versions for any new dependencies; none are expected this round.
- If permission is denied, do not bypass it; give the user a command to run in Terminal.
- Write the report in Chinese, without exclamation marks or em dashes.
