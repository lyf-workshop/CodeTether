# Task: determine why notification clicks do not open conversations

Branch `ux/v4-device-first`, worktree `D:/Projects/Software/agenthub-ux-v4-device-first`, starting commit must be `9800ae2f8b7dc44c73317aeb2afa7cb61ed53b17` with clean tracked files; otherwise stop/report. UI follows docs/ux-redesign under temporary user authorization overriding AGENTS.md's "Figma is the only source" rule.

The agent must inspect the installed UI directly rather than delegate UI judgments to the user.

R9 results: section 22 of `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r8.md`; review: round 9 of `docs/reviews/ux-v4-device-first.md`. Notifications are generated with correct copy. After the user clicked in Notification Center, CodeTether stayed minimized and its route did not change.

## Background and hypothesis

Windows notification clicks follow one path: `ToastNotification.Activated` registered in `apps/desktop/src-tauri/src/attention_notifications.rs`, calling `activate_notification` to restore the window and emit a navigation intent. Notification XML has no `launch` argument, and installation registers no COM activator (no shortcut `ToastActivatorCLSID`).

R9's click came ten minutes after completion, long after banner timeout, from Notification Center. Microsoft documentation says desktop apps without a COM activator are not guaranteed an in-process `Activated` callback after notification-center clicks. The assumption in comment `:354` that notifications remain clickable there after banner timeout was never tested.

Test banner clicks before timeout separately from Notification Center clicks afterward. This remains a hypothesis until observed. Alternatively, `Activated` may fire while window restoration fails. Current logs cannot distinguish them, so add diagnostics first.

## Part one: diagnostic logs

Add two logs in `attention_notifications.rs`, excluding content and identifiers:
- At entry to `Activated`, before `activation_flag`, log `[codetether:desktop] notification activated type=<type>`; log repeats too with `repeat=true|false`.
- In `Dismissed`, log `[codetether:desktop] notification dismissed reason=<TimedOut|UserCanceled|ApplicationHidden|unknown>`.

Follow `notification_shown_log` with small helpers and unit tests. Successful restoration already logs `[codetether:lifecycle] main_window_restored`, and failure logs `could not restore the main window`; add no duplicates.

One commit, e.g. `fix(desktop): log notification activation and dismissal`. Run the four usual gates and Rust tests, Prettier for modified files, and `cargo fmt --check`.

## Part two: package; user installs outside Codex

- Follow `.tmp/v4-r8-desktop-build.sh` in new `.tmp/v4-r10-desktop-build.sh`, logging to `agenthub-archive/v4-r10-desktop-build.log`. Before packaging, copy R8 installer (`6A454BB5…`) and SHA256 to `agenthub-archive/installers/9800ae2/`. Request approval when required and wait; never bypass it.
- The agent must not execute installers/uninstallers. Ask the user to tray-exit CodeTether, double-click the new installer outside Codex, then launch outside Codex with Desktop stderr capture:
  `! powershell.exe -NoProfile -Command "Start-Process -FilePath 'C:\Users\Administrator\AppData\Local\CodeTether\codetether-desktop.exe' -RedirectStandardError 'D:\Projects\Software\agenthub-archive\v4-r10-desktop-stderr.raw'"`
- After the reply, read-only verify first-12-character commit build ID, one Desktop and one Host, and unchanged data counts from R9's end.

## Part three: test click types separately

In the `v4-accept-project` Codex conversation, send one read-only turn for each test (e.g. "Reply only OK; do not read/write files"), then minimize and verify `IsIconic=true`. The user performs both clicks following clear instructions; the agent evaluates logs/window state.

Test A, banner:
1. Before sending, tell the user to click the lower-right banner immediately when it appears after completion.
2. Record `notification shown` time and wait for "Clicked banner".

Test B, Notification Center:
1. Do not click after completion. Wait at most 60 seconds for that notification's `notification dismissed reason=TimedOut`.
2. Ask the user to press Win+N, click the top CodeTether notification, and reply "Clicked".

After each click record:
- `notification activated`, `main_window_restored`, or `could not restore` logs;
- Restored/foreground window state (`IsIconic`, foreground window);
- Whether the route contains this turn's `turn` parameter and `notification-N` hash;
- On success, a screenshot limited to conversation header.

Even if A fails, perform B, then stop.

## Conclusions

Choose one of these conclusions without fixing further:
1. A and B pass: item 9 passes.
2. A passes and B has no `activated`: hypothesis confirmed. Present evidence; reviewer and user decide the fix.
3. `activated` exists but restoration or routing fails: identify the exact stage and code location.
4. Otherwise describe observations faithfully.

## Budget and stopping conditions

- Codex: at most two turns, one each for A/B. Never resend failed turns.
- Claude Code: zero turns.
- On API 429/524, wait per Retry-After and retry at most three times, recording timestamps, then stop/report.

## Prohibitions

- Edit only part-one files/tests. Preserve notification XML, shortcuts, installer scripts; add no COM activator.
- Agent must not execute installers/uninstallers or launch/exit CodeTether.
- Preserve account, Provider selection, gateway, and `~/.codex`.
- Preserve registry/notification settings and icon cache.
- Preserve old Codex-package shortcuts, test projects/conversations, and `v4-firstrun-data`.
- No push, merge, or tag.

## Logs and report

- After user exits CodeTether, redact `sk-…`, `sb_publishable_…`, and Bearer with sed. Keep only startup/notification/window lines from `[codetether:desktop]` and `[codetether:lifecycle]`, save a redacted copy, then remove only this `.raw`.
- Write `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r10.md`, including commits/checks, installer SHA256, running version, timelines (send, complete, shown, dismissed, click, activated, restore, route), screenshot names, one conclusion above, and cumulative checklist.
- Screenshots: `output/playwright/v4-installed-acceptance-r10/`.

## Restrictions

- Do not read .secrets/, any .env, credential files, machine-credentials contents, `~/.codex/auth.json`, or ~/.claude.json.
- On permission denial, give the command as `! …` to the user without bypassing.
- Report in Chinese, without exclamation marks or em dashes.
- End commits with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
