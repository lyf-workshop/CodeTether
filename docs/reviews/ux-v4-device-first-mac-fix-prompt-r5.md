# Task. Fix macOS notifications (Mac round 5, limited code changes)

Run on Mac. This round changes code, packages, and replaces the installed Mac build. Read rounds 1–4 in `~/agenthub-archive/v4-acceptance-report-mac.md` first. UI follows docs/ux-redesign under temporary authorization overriding AGENTS.md's Figma-only rule.

The agent must inspect installed UI directly instead of returning judgments to the user.

## Background

After four rounds, 13 Mac items pass, item 9 notifications never appeared, and item 10 is untested. Round 4 confirmed notifications enabled in system settings, no Focus mode, and no Desktop notification log records.

Reviewer diagnosis.
1. Likely WKWebView suspends background pages by default (`inactiveSchedulingPolicy` is suspend). Occluded/minimized CodeTether cannot receive Host Attention and request notifications. Once foreground again, design suppresses them. Windows Web Lock solves similar behavior but not macOS. Tauri 2.11.5 exposes `backgroundThrottling` for macOS 14+.
2. Successful macOS delivery has no log (`apps/desktop/src-tauri/src/macos_notifications.rs:289-310`), obscuring absent delivery vs invisible delivery.
3. Click after exit looks only in memory (`macos_notifications.rs:66-77`), otherwise restoring window without conversation. Reuse Windows R11 attention-ID `activate_notification_link`.

## Part 1. Preparation

1. `git fetch origin`. Create clean `fix/macos-notifications` from `origin/main` (`835489dd3c9e7e703ecdfb86b9cd4d2f53391b16`), for example `~/agenthub-work/v4-fix-macos-notify`. Preserve other Mac worktrees and original `apps/site/` changes.
2. Read `sw_vers -productVersion`. Below 14.0, part 2 item 3 has no effect. Record and continue.
3. Copy current 835489d `/Applications/CodeTether.app` to `~/agenthub-archive/mac-install-backup-2026-10-23/CodeTether-835489d.app` and verify counts/bytes. Existing data backup suffices.

## Part 2. Code changes

Limit changes below to 2–3 feature commits ending `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

1. Logging (`apps/desktop/src-tauri/src/attention_notifications.rs` and `macos_notifications.rs`).
   - At entry, `deliver_attention_notification` logs `[codetether:desktop] notification requested type=<type>` on all platforms.
   - After macOS permission request, log `[codetether:desktop] macOS notification authorization result=<granted|denied|error>`.
   - After system acceptance, log `[codetether:desktop] notification shown type=<type> platform=macos` corresponding to Windows shown.
   - In `initialize`, read `getNotificationSettingsWithCompletionHandler` once and log `[codetether:desktop] macOS notification authorization status=<notDetermined|denied|authorized|provisional|ephemeral|unknown>`.
   - Exclude titles/bodies/all IDs. Follow small `notification_activated_log` helpers and unit-test sentinel exclusion.
2. Click after exit (`macos_notifications.rs:66-77`).
   - On memory miss, extract attention ID from exact prefix `codetether-attention-<attentionId>`, validate `is_public_id(…, "attn_")`.
   - Valid ID calls `activate_notification_link`, widen its `#[cfg(windows)]` to `any(windows, target_os = "macos")`. Invalid values only restore as today.
   - Test valid identifier, wrong prefix, invalid ID, and empty.
3. Background suspension (`main` window in `apps/desktop/src-tauri/tauri.conf.json`).
   - Add `"backgroundThrottling": "disabled"`, ineffective on Windows/Linux and harmless there.
   - Update affected `apps/desktop/test/security-config.test.mjs`/configuration tests and explain rationale in macOS notification paragraph of `docs/ARCHITECTURE.md`.
4. Preserve web code, Host, notification copy/switches, and Windows behavior.

Checks.
- `env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm typecheck`, equivalently lint/build.
- `pnpm test` has three known Windows installer-path failures on macOS. Allow no new failures.
- In `apps/desktop/src-tauri` run `cargo test`, `cargo clippy --all-targets -- -D warnings`, `cargo fmt --check`.
- Prettier-check changed files.
- Windows reviewer checks cross-platform log compilation. If possible install `x86_64-pc-windows-msvc` and run `cargo check`, otherwise record inability.

## Part 3. Package and install

1. Load prior `~/agenthub-work/v4-build.env` only in packaging shell via `set -a; . ~/agenthub-work/v4-build.env; set +a`, without printing/copying content. Run `pnpm desktop:build` and sed-redact `sk-…`, `sb_publishable_…`, Bearer before logs.
2. Record .app/.dmg paths/sizes/SHA256.
3. Ask for menu-bar exit, verify Desktop/Host/guardian stopped.
4. Replace `/Applications/CodeTether.app` without data changes. If blocked, ask Open Anyway in Privacy & Security.
5. Ask user to launch with logs, replacing placeholder with Info.plist `CFBundleExecutable`, and reply Started.
   `/Applications/CodeTether.app/Contents/MacOS/<executable> 2> ~/agenthub-archive/v4-mac-r5-desktop-stderr.raw &`
6. Verify new commit's first-12 build, 11 projects/two devices/25 conversations, and `authorization status=…` log.

## Part 4. Testing

Use only the Codex test conversation in `v4 Mac Acceptance Test`, sending "Reply only OK, do not read or write files" each time.

Test 1, foreground window but different conversation.
- Immediately switch to Devices after sending, keeping foreground.
- Expect `notification requested`, `notification shown`, and visible banner with Device · Project plus explanation, excluding conversation title.
- Establish native delivery itself works.

Test 2, occluded window.
- Ask user to click Finder immediately after sending so it covers CodeTether, without minimizing.
- Expect the same as test 1.

Test 3, minimized click.
- Immediately ⌘M after sending.
- Ask user to click the notification and reply Clicked.
- Verify foreground window and route containing this turn and `notification-N`, navigating once.

Test 4, click after exit.
- Minimize after sending. Do not click notification yet.
- Ask menu-bar exit and verify processes stopped.
- Ask Notification Center click and reply Clicked.
- Verify launch, visible window, and current-turn route. No log for this startup, use window/route.

Interpretation.
- Test 1 absent. Native path issue, inspect both authorization logs, stop/report, omit tests 2–4.
- Test 1 works but 2/3 absent. Throttling did not solve suspension, record macOS/logs, stop/report.
- Item 9 requires notifications in 2/3 with correct content, and correct conversation navigation in 3/4.

## Part 5. Item 10 and icons

Round 4 established agent screenshots work. Complete these directly without waiting for user UI judgment.
1. Select light appearance, ask menu-bar exit.
2. Start `screencapture -v -V 3 -R <x,y,w,h> <file>` over window region, immediately `open -a CodeTether`. Extract 10 fps and inspect dark-blue frames. Keep earliest visible-window frame only, delete video/other frames.
3. Use `screencapture -R` on Dock and menu-bar icons, both purple dual cards.
4. Skip Launchpad. About and `icon.icns` already verified.
5. Failed captures are Untested with reason, never guessed.

## Budget and stop conditions

- At most four Codex turns, one per test, no failed-turn resend. Zero Claude Code turns.
- Fix failed checks before packaging. Stop/report if fixes exceed part 2.
- Honor Retry-After on 429/524, at most three timestamped retries, then stop/report.

## Do not do

- Change files beyond part 2 and matching tests/docs. Preserve web, Host, Windows behavior, notification copy.
- Push, merge, tag. Ask at report end whether to push to GitHub, then push only `fix/macos-notifications` with approval.
- Change account, Provider selection, gateway, `~/.codex`, `~/.claude`.
- Pair/unpair, add/remove projects.
- Change system settings, notification/recording permissions, Focus, Gatekeeper, or icon caches.
- Delete backups/old .app.

## Logs and report

- Ask exit, sed-redact `sk-…`, `sb_publishable_…`, Bearer, retain `[codetether:desktop]`, `[codetether:lifecycle]`, `notification` lines in `.sanitized.log`, delete raw, ask normal reopening.
- Append Round 5 to `~/agenthub-archive/v4-acceptance-report-mac.md`.
  - macOS version.
  - Commit hashes/titles, all checks.
  - Installer paths/SHA256 and running version.
  - Four test times/logs/conclusions.
  - Item 10 and icons.
  - Final 15-item totals.
  - Final production project/device/conversation counts.
- Final Chinese summary includes the following.
  - `git log --oneline origin/main..HEAD`.
  - `git diff --stat origin/main..HEAD`.
  - Complete part-2 `git diff origin/main..HEAD`.
  - Full sanitized logs.
  User forwards to Windows reviewer.

## Restrictions

- Do not read .secrets/, other .env, credentials, machine-credentials contents, `~/.codex/auth.json`, `~/.claude.json`. Load `v4-build.env` only as part 3 item 1, never print.
- Exact versions for new dependencies, none expected.
- Never bypass denied permissions. Provide commands for user terminal execution.
- Report in Chinese without exclamation marks or em dashes.
