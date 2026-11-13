# Task: finish notification click in item 9

Branch `ux/v4-device-first`, worktree `D:/Projects/Software/agenthub-ux-v4-device-first`, HEAD must be `9800ae2f8b7dc44c73317aeb2afa7cb61ed53b17` and tracked worktree clean, otherwise stop/report. Installed build is the R8 version (`git-9800ae2f8b7d`); no packaging, reinstall, or code changes. UI follows docs/ux-redesign under temporary user authorization overriding AGENTS.md's "Figma is the only source" rule.

User requirement: the agent inspects the installed UI directly rather than delegating UI judgments to the user.

R8 results are in `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r8.md`; review is round 8 of `docs/reviews/ux-v4-device-first.md`. Fourteen items passed. Item 9's notification appears with "Local computer / v4-accept-project" and explanatory text, excluding conversation title, verified in notification history. Only clicking it and confirming the correct conversation remains.

## Procedure

Use a Codex turn this round because Claude Code's gateway returned `provider_service_unavailable` in R8. Investigating that cause is outside this round.

1. Ask the user to launch CodeTether outside Codex, without log capture. Start menu or this `!` command is acceptable:
   `! powershell.exe -NoProfile -Command "Start-Process -FilePath 'C:\Users\Administrator\AppData\Local\CodeTether\codetether-desktop.exe'"`
   Wait for "Started".
2. Send one short read-only Codex turn in test project `v4-accept-project`, for example "Reply only OK; do not read or write files". Minimize after sending and confirm `IsIconic=true` before timing.
3. After completion, use Attention API with `Origin: http://tauri.localhost` to confirm the completed item, then native Toast History to verify exactly one new completion notification. Record only notification heading, device/project, and explanation, excluding conversation title/input.
4. Click notification:
   - First try opening Notification Center (Win+N), locating the CodeTether item with UIAutomation, and clicking once.
   - If not uniquely identifiable, do not guess or click other notifications. Ask the user to click that CodeTether notification and reply "Clicked". The user performs the click; the agent evaluates the result.
5. Verify CodeTether is restored/foreground, routed to that Codex conversation, and displaying step 2's turn. Capture only the conversation-header area of its window.

## Budget and stopping conditions

- Codex: at most one turn. On failure, record and stop without resending.
- Claude Code: zero turns.
- Stop/report if no notification exists in either banner or Notification Center; no code fixes.
- For API 429/524, wait per Retry-After and retry at most three times, recording times, then stop/report.

## Prohibitions

- No packaging, installer/uninstaller execution. The agent neither launches nor exits CodeTether.
- No product code, account, Provider-selection, gateway, or `~/.codex` changes.
- No registry, notification-setting, shortcut, or icon-cache changes.
- Preserve old shortcuts in the Codex package, test projects/conversations, and `v4-firstrun-data`.
- No push, merge, or tag.

## Report

Append "Item 9 additional testing" to `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r8.md`, including:
- Turn start/completion times and terminal state;
- Attention/Toast History results and notification copy;
- Who clicked, resulting window state/route, screenshot name;
- Item 9 conclusion and cumulative checklist results.

Screenshots go under `output/playwright/v4-installed-acceptance-r8/`.

## Restrictions

- Do not read .secrets/, any .env, credential files, machine-credentials contents, `~/.codex/auth.json`, or ~/.claude.json.
- Redact `sk-…` and `sb_publishable_…` values with sed.
- If permission denies an operation, provide its command as `! …` for the user instead of bypassing.
- Write the report in Chinese without exclamation marks or em dashes.
