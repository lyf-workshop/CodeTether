# Task: open notification conversations through codetether:// links

Branch `ux/v4-device-first`, worktree `D:/Projects/Software/agenthub-ux-v4-device-first`, required starting commit `bb1d55b922753f08ea037d25fc3a4cd7063aa583`, clean tracked files; otherwise stop/report. UI follows docs/ux-redesign under temporary authorization overriding AGENTS.md's "Figma is the only source" rule.

The agent inspects the installed UI directly rather than delegates judgments to the user.

R10 results: `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r10.md`; review: round 10 of `docs/reviews/ux-v4-device-first.md`. Notification Center clicks did not fire in-process `Activated` or restore the window. User selected registering `codetether://` at installation and having Windows open that link on notification clicks.

## Design

1. Notification XML: add `activationType="protocol"` and `launch="codetether://notification/<attentionId>"` to `<toast>`. Include only Attention ID, never conversation title/project/body. Retain in-process `Activated`, which may fire first while the banner is visible.
2. Register `codetether` for the current user during installation, opening installed `codetether-desktop.exe "%1"`; remove on uninstall.
   - Check whether the tauri-bundler NSIS template corresponding to `@tauri-apps/cli` 2.11.4 supports `plugins.deep-link.desktop.schemes` and uninstall cleanup. If so use official `tauri-plugin-deep-link` at an exact version matching tauri 2.11.5, enabling `deep-link` in `tauri-plugin-single-instance`.
   - Otherwise use NSIS install/uninstall hooks to add/remove `HKCU\Software\Classes\codetether`, without a plugin.
   - Report the choice and evidence.
3. Receiving links:
   - While running, the single-instance plugin forwards Windows' second-process arguments to the existing process. Parse the link, resolve the in-memory notification intent by Attention ID, and use existing `activate_notification` to restore/navigate to the turn.
   - If absent from memory (e.g. after restart), restore the window and send Attention ID to the frontend. Use existing Host Attention reads to find conversation/turn; stay on the current page when unresolved. Verify the API can resolve by ID first. If not, restore only and report; do not modify Host.
   - If not running, Windows launches CodeTether with the link; handle it after startup as above.
4. Deduplication: callback and link may both arrive for one Attention item. Navigate once using existing Attention-ID deduplication.
5. Security: any program/webpage can open these links, so allow only restoring and navigating.
   - Accept exactly `codetether://notification/<attentionId>`, validating with existing `is_public_id(…, "attn_")` and bounded length.
   - Unknown paths or extra queries/fragments restore the window only.
   - Never confirm, resolve, approve, or start a turn.
   - Log only `[codetether:desktop] notification link received result=<matched|unmatched|invalid>`, excluding full links and IDs.
6. Development builds run from target/release with PowerShell AppID must not register links. Preserve the existing condition.

## Tests

Unit tests:
- Parsing valid/invalid IDs, oversized links, wrong paths, extra query/fragment, case variations, encoded characters, and empty input.
- Escaped notification XML with `activationType`/`launch`.
- Callback plus link for one Attention ID navigates once.
- Single-instance arguments containing a link enter link handling; other launches retain window restoration.
- Frontend navigates only if Attention-ID lookup finds the conversation.

Split into one or two functional commits. Run four gates, Rust tests, `cargo fmt --check`, and Prettier for changed files. Whole-repository `pnpm format:check` CRLF problems are outside this round.

## Packaging and installation

- Follow R10 in `.tmp/v4-r11-desktop-build.sh`, logging to `agenthub-archive/v4-r11-desktop-build.log`. Back up R10 installer (`D210320D…`) and SHA256SUMS.txt under `agenthub-archive/installers/bb1d55b/`. Request required approval and wait.
- The agent must not run installers/uninstallers. Ask the user to tray-exit CodeTether and install outside Codex:
  `! start "" "D:\Projects\Software\agenthub-ux-v4-device-first\apps\desktop\src-tauri\target\release\bundle\nsis\CodeTether_0.1.0-alpha.0_x64-setup.exe"`
  If auto-opened afterward, have the user tray-exit and relaunch with logs:
  `! powershell.exe -NoProfile -Command "Start-Process -FilePath 'C:\Users\Administrator\AppData\Local\CodeTether\codetether-desktop.exe' -RedirectStandardError 'D:\Projects\Software\agenthub-archive\v4-r11-desktop-stderr.raw'"`
- Read-only verify the new first-12-character build ID, `HKCU\Software\Classes\codetether` and installed executable command, one Desktop/Host, and unchanged data counts from R10.

## Live testing

Use one read-only Codex turn per test in `v4-accept-project` (e.g. "Reply only OK; do not read/write files"), then minimize and confirm `IsIconic=true`. User clicks; agent judges.

Test B, Notification Center (most important): wait for `dismissed reason=TimedOut`, then ask the user to press Win+N and click the top CodeTether item.

Test A, banner: warn that the banner lasts about six seconds and the turn about two minutes. User watches lower-right and clicks immediately. Record missed clicks without another turn.

Test C, app not running: after B, have user tray-exit and click the notification remaining from A/B. No new turn. Windows launches CodeTether without captured logs; judge window/route.

After every click record `notification activated`, `notification link received`, `main_window_restored`/`could not restore`, restored/foreground state, turn parameter/`notification-N`, and duplicate navigation. On success capture conversation header only.

Agent validates link safety read-only while running with `Start-Process 'codetether://notification/attn_invalid'` and `Start-Process 'codetether://other'`, once each. Confirm window restoration only, unchanged route/Attention state, and `invalid`/`unmatched` logs. These CodeTether link launches are explicitly allowed. On permission denial give `!` commands to the user.

Item 9 passes when B and C open the correct conversation. A passing is desirable; missing its banner does not block acceptance.

## Budget and stopping conditions

- Codex: at most two turns, one each for B/A. No resending failed turns.
- Claude Code: zero turns.
- If B fails, finish C and link-safety checks, then stop and identify the failed stage without further fixes this round.
- API 429/524: Retry-After, at most three retries with times recorded, then stop/report.

## Prohibitions

- Change only notification/link/single-instance/installation-registration code, configuration, and tests; preserve Host.
- No COM activator or shortcut changes.
- Agent runs no installers/uninstallers, never exits CodeTether, and launches only through the specified link-safety checks.
- Preserve account, Provider selection, gateway, and `~/.codex`.
- No manual registry writes, notification-setting changes, or icon-cache clearing. Only installer registers links.
- Preserve old Codex-package shortcuts, test projects/conversations, and `v4-firstrun-data`.
- No push, merge, or tag.

## Logs and report

- After user exits, redact `sk-…`, `sb_publishable_…`, and Bearer with sed. Keep startup/notification/link/window lines in a redacted copy, then delete only this `.raw`.
- Write `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r11.md`: registration choice/evidence, commits/checks, installer SHA256, registry checks, A/B/C timelines/screenshots, link safety, item 9 conclusion, and cumulative checklist.
- Screenshots: `output/playwright/v4-installed-acceptance-r11/`.

## Restrictions

- Do not read .secrets/, any .env, credential files, machine-credentials contents, `~/.codex/auth.json`, or ~/.claude.json.
- Exact dependency versions, official Tauri plugins only.
- On permission denial provide `! …` commands without bypassing.
- Report in Chinese without exclamation marks/em dashes.
- End commits with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
