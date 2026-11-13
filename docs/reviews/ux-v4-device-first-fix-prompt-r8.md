# Task — Fix Added and Deleted File Diffs, Reinstall Outside the Codex App, and Finish Item 9 and Icon Checks

Use branch `ux/v4-device-first` and worktree `D:/Projects/Software/agenthub-ux-v4-device-first`. The starting commit must be `4f30416e4307731d38141ac244c47b8ba716546f`, with a clean working tree. Otherwise stop and report. UI and icons follow docs/ux-redesign. This temporary user authorization takes precedence over AGENTS.md's Figma-only source rule.

The user requires the agent to inspect the installed UI directly, without returning visual judgments to the user.

Previous results are in `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r7.md`, with review findings under Round 7 in `docs/reviews/ux-v4-device-first.md`. Fourteen items have passed, leaving item 9. Also fix one defect and add two icon checks.

## Part One — Diff Display for Added and Deleted Files

Symptom — Codex creates a 27-byte file, but Changes shows `+0`, and opening it says the file changed without a displayable diff from CodeTether.

Root cause — For `kind.type = add` in Codex App Server `fileChange`, `diff` contains the complete new file rather than unified diff. Frontend `parseUnifiedDiff` (`apps/web/src/runtime/host/conversation-projection.ts:1344`) recognizes only lines beginning with `+`, `-`, or a space, so it recognizes none. Deletion likely also contains full text, but verify first.

Required approach follows.
1. Verify using local Codex 0.162.1 `codex app-server generate-json-schema` to inspect `FileUpdateChange`, and a read-only installed local API query of R7's added change. Determine whether `diff` has lines beginning with `@@`, `---`, or `+++`. Record only presence, length, and line count, without content. Stop and report if the findings differ from this description.
2. Update `#normalizeFileChanges` in `packages/adapter-codex/src/normalizer.ts`.
   - For additions without unified-diff markers, convert to `@@ -0,0 +1,<line-count> @@`, prefixing every line with `+`.
   - For deletions, use `@@ -1,<line-count> +0,0 @@` and prefix lines with `-`.
   - Preserve existing unified diffs, modifications, and renames.
   - For a missing final newline, add unified diff's `\ No newline at end of file` marker.
   - Empty files produce no diff lines and zero additions/deletions.
   - Respect existing size limits after conversion, including prefixes. Locate and reuse the existing limit.
3. Preserve frontend and protocol. Do not migrate stored historical changes. State this in the report.
4. Extend existing normalizer tests under `packages/adapter-codex/test/` to cover the following.
   - Multiline and single-line additions, missing final newline, empty files, and Chinese content.
   - Deleted files.
   - Already unified added-file diffs preserved unchanged.
   - Unaffected modifications.
   - Long files approaching the limit.
   Add a case in `apps/web/test/conversation-projection.test.mjs` verifying correct added-line count and content from the converted addition.

Use one commit, for example `fix(adapter-codex): show added and deleted file content as diffs`.

## Part Two — Package and Have the User Install Outside Codex

R7's installer ran inside the Codex desktop app, a Store/MSIX application. Programs launched there redirect `%APPDATA%` writes into
`C:\Users\Administrator\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Roaming\Microsoft\Windows\Start Menu\Programs\CodeTether.lnk`.
The agent therefore saw a shortcut that was absent from the real Start menu. Windows had no application registration, Start search could not find it, and notifications appeared disabled.

1. Inspect the current shell's package identity through kernel32 `GetCurrentPackageFullName`. Return code 15700 means no identity. Report the result.
2. Package with these preparations.
   - First copy the R6 installer (SHA256 `56A1841DDD8BCF93…`) and its SHA256 into `D:/Projects/Software/agenthub-archive/installers/4f30416/`.
   - Reuse R6's three account settings and the public key already supplied by the user.
3. Regardless of step 1, installation belongs to the user. The agent runs neither installers nor uninstallers. Give these instructions and wait for a reply.
   - Quit CodeTether from the tray.
   - Double-click the new installer in File Explorer and finish with default options, outside the Codex app.
   - Search for CodeTether in Start and launch it, also checking Start registration.
4. After the user's reply, verify read-only that the following hold.
   - `C:\Users\Administrator\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\CodeTether.lnk` exists with AppID `com.codetether.desktop`. Query from a process without package identity. If step 1 found an identity, ask the user to run `! powershell.exe -NoProfile -Command "Test-Path -LiteralPath $env:APPDATA'\Microsoft\Windows\Start Menu\Programs\CodeTether.lnk'"` in ordinary PowerShell.
   - `Get-StartApps` lists CodeTether.
   - Bootstrap `hostVersion` is the first 12 characters of the part-one commit.
   - CodeTether has no process package identity.
   - Projects, devices, and conversation counts match the end of R7.
5. Preserve the old redirected shortcut inside the Codex package directory and report that it remains.

Desktop stderr is unavailable this round because the user starts the app. When item 9 needs logs, ask the user to quit from the tray and run the following.
`! powershell.exe -NoProfile -Command "Start-Process -FilePath 'C:\Users\Administrator\AppData\Local\CodeTether\codetether-desktop.exe' -RedirectStandardError 'D:\Projects\Software\agenthub-archive\v4-r8-desktop-stderr.raw'"`
Run through `!` in Claude Code or ordinary PowerShell, outside Codex. Before saving logs, use sed to redact `sk-…`, `sb_publishable_…`, and Bearer, then delete `.raw`.

## Part Three — Item 9, System Notifications

1. Read `CreateToastNotifier('com.codetether.desktop').Setting`.
   - If it remains `DisabledForApplication`, ask the user to inspect Settings > System > Notifications for CodeTether and its toggle, enabling it personally if off. Query again after confirmation. Stop and report if it still fails.
2. Once `Enabled`, perform the following.
   - Send one short turn in the test project's Claude Code conversation, immediately minimizing the window.
   - Within 90 seconds, inspect logs for `notification shown` or `notification skipped`.
   - Confirm the completed Attention item through `GET http://127.0.0.1:4317/api/v1/attention`, with `Origin: http://tauri.localhost`.
   - Read notification contents through history or UIAutomation. Record only Device · Project and the explanation, without the conversation title.
   - Click it and confirm the correct conversation opens.
3. If Attention exists but `notification shown` is absent, locate the return point in `apps/web/src/runtime/notifications/attention-notification-coordinator.ts`. Fix only after identifying the definite cause, in a separate tested commit. Repackage and again ask the user to install.
4. If logs contain `notification shown` but Windows shows nothing, report it and wait for my decision.

## Part Four — Diff Retest

Use at most two Codex turns in test project `D:/Projects/Software/agenthub-work/v4-accept-project`.

1. Create a three-line test file. Changes must show `+3` and three added lines when opened.
2. Delete it, selecting Allow Once if approval is needed. Changes must show `-3` and three deleted lines.

Delete only the file created this round. Preserve `r5-read-check.txt` and `r7-codex-change-check.txt`.

## Part Five — Icons

- Start menu — Capture the search-result row during the user's launch in part two, step 3. If the user closed search, the agent searches again.
- Taskbar — Capture the running app's button. If the old kite remains, let the user decide whether to run `! ie4uinit.exe -show`, then capture again. If declined, report icon caching accurately.
- Title bar, tray, and Explorer were confirmed in earlier rounds and need no repeat.

## Execution Budget

- Codex has at most two installed-app turns, only for part four. Do not invoke Codex CLI directly except the read-only `generate-json-schema` check.
- Claude Code has at most one installed-app turn, only for part three.
- Operate only inside the test folder.

## Prohibited Actions

- The agent runs no installer or uninstaller and starts or terminates no CodeTether processes. The user starts and quits it.
- No pairing, unpairing, removal of existing projects, or import of other conversations.
- No sign-in, sign-out, account changes, Codex selection changes, or changes to `~/.codex`.
- Do not modify the Windows registry, shortcuts, system notification settings, or icon cache.
- Preserve the test project, conversations, and `v4-firstrun-data` after testing.

## Checks and Commits

- Before each commit, run `env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm typecheck`, and run `lint`, `test`, and `build` in the same way. All must exit 0.
- Check changed files in batches with `xargs -n 40 npx prettier --list-different --end-of-line auto`.
- End commit messages with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Do not push, merge, or tag.

## Report

Write `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r8.md`, covering the following.
- Part-one verification, commit hashes, and check results.
- Whether the agent's shell has package identity.
- New installer SHA256, the user's installation and launch method, and running `hostVersion`.
- Shortcut, `Get-StartApps`, process identity, and data-count checks.
- Item 9, including `Setting`, notification logs, Attention creation, content and click results, and screenshot names.
- Added/deleted diff results and screenshots from part four.
- Start and taskbar icon screenshots and conclusions.
- Cumulative checklist results.
- Untested items and reasons, supplied `!` commands, and user replies.

Save screenshots to `output/playwright/v4-installed-acceptance-r8/`.

## Restrictions

- Change only part-one files and tests, plus a part-three step-3 fix after confirming its cause. Do not change `docs/reviews/`.
- Do not read .secrets/, any .env, credential files, machine-credentials contents, `~/.codex/auth.json`, or ~/.claude.json.
- Preserve untracked files in the main workspace.
- Do not use `rm -rf`, delete backups or old installers, or run `git worktree remove`.
- Redact `sk-…` and `sb_publishable_…` from logs using sed.
- Do not bypass permission rejection. Give the user the command in `! …` form.
- On API 429 or 524, follow Retry-After, retry at most three times, and record each attempt's time. Then stop and report.
- Write the report in Chinese, without exclamation marks or em dashes.
