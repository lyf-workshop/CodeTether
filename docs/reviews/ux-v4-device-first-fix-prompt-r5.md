# Task: Chinese tool summaries, new icons, investigate Codex failures, reinstall once, and finish installed-app acceptance

Branch `ux/v4-device-first`, worktree `D:/Projects/Software/agenthub-ux-v4-device-first`. The starting commit must be `2d9ad41f7e381166e4bef49016290f279ad1145a`, with a clean working tree; otherwise stop and report. Follow docs/ux-redesign for the UI and icons. This temporary user authorization overrides the AGENTS.md rule that Figma is the sole source of truth.

User requirement: the agent must inspect the installed app directly and make the UI judgments itself.

Previous results: `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r4.md`.

## Part 1: Translate tool summaries into Chinese (item 14)

Symptom: search steps in Claude Code conversations display `Search workspace`.

Cause: `normalizeClaudeTool` and `normalizeSearchTool` in `packages/adapter-claude/src/normalizer.ts` contain fixed English summaries that the frontend displays directly (`conversation-timeline.tsx:245`, `inspector-panel.tsx:296`).

Changes:
1. Change the Claude adapter's `summary` to Chinese. Keep `name`, `kind`, and `command` unchanged; `command` remains the tool's own command text.

   | Case | Current | Replace with |
   |---|---|---|
   | Read, no safe path | `Read file` | `读取文件` |
   | Read, safe path | `Read <path>` | `读取 <路径>` |
   | Edit / Write, no safe path | `Edit file` | `编辑文件` |
   | Edit, safe path | `Edit <path>` | `编辑 <路径>` |
   | Write, safe path | `Write <path>` | `写入 <路径>` |
   | Bash / PowerShell | `Run unavailable tool` | `命令工具不可用` |
   | Other tools | `Run tool` | `使用工具` |
   | Glob / Grep | `Search workspace` | `搜索项目文件` |

   Summaries containing paths must still be truncated with `boundUtf8(..., MAX_CLAUDE_TOOL_SUMMARY_BYTES)`. Chinese characters use 3 bytes each; add a test ensuring long-path truncation does not split a character.
2. Replace the Codex adapter's English approval-summary fallbacks (`packages/adapter-codex/src/normalizer.ts:428`, `436`) with `Codex 请求运行命令` and `Codex 请求访问文件或权限`. Preserve commands and reasons read from Codex arguments.
3. Search `packages/adapter-*/src`, `apps/host/src`, and `apps/node/src` for fixed English sentences entering `summary`, `title`, or `message` and displayed in the UI.
   - Fix matching issues and add tests.
   - If unsure whether a string is displayed, leave it unchanged and list it in the report.
   - Text returned by AI tools, tool names, commands, and paths are excluded.
4. Update affected tests, including `packages/adapter-claude/test/normalizer.test.mjs` and `apps/node/test/remote-claude-runner.test.mjs`.
5. Do not change protocol fields, add a translation table, or modify frontend components.

Already paired remote devices must update before displaying Chinese summaries. Record this in the report; no further action is needed.

Commit separately, for example `fix(adapters): use Chinese tool summaries`.

## Part 2: Replace icons

Follow sections 1 and 2 of `D:/Projects/Software/agenthub/docs/reviews/ux-v4-device-first-icon-prompt.md`.

- The icon has been redesigned as two cards. Sources are in `D:/Projects/Software/agenthub/docs/ux-redesign/icon/final/`. Direction A and the kite have been abandoned.
- If the kite version was already implemented and committed, add another commit regenerating icons from the new sources and replacing it.
- Do not separately perform section 3's packaging and installation checks; include them in parts 4 and 5 here.
- Put that prompt's report contents in an Icons section of this report, without creating a separate `v4-icon-report.md`.

## Part 3: Investigate the Codex failure

Last round, the first Codex turn failed within 10 seconds with only `provider_error`; the test folder remained empty.

Unconfirmed clues:
- Codex on the local PATH is `C:\Users\Administrator\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe`, version 0.162.1.
- The adapter's tested version is 0.149.1 (`packages/adapter-codex/src/compatibility.ts:32`).
- The first installation check displayed 0.149.1.

Investigate in order and record each result:
1. Read-only checks:
   - `codex --version`;
   - the Codex version and path in the installed app's Settings or health check;
   - which executable Host uses, finding its resolution rules in source.
2. Read the failed Codex conversation through the installed app's local API (`127.0.0.1:4317`, with `Origin: http://tauri.localhost`).
   - Record failure fields: `reason`, `code`, source, and the original `codexErrorInfo` type name if exposed.
   - Do not record text returned by the AI tool.
   - Stop if the API requires login credentials; do not search for credentials.
3. Run Codex directly once in `D:/Projects/Software/agenthub-work/v4-accept-project`:
   - Command: `codex exec --sandbox read-only --skip-git-repo-check "只回复 ok"`. Confirm argument names with `codex exec --help`.
   - Record the exit code and error category; redact output with sed before saving.
   - Run only once. This also leaves a Codex conversation in the test folder for part 5, item 2.
4. If Codex runs directly but fails through the installed app, compare the Codex 0.162.1 `codex app-server` protocol:
   - Read-only commands such as `codex app-server generate-json-schema` are permitted.
   - You may also compare the adapter's schema checks.
5. Decide:
   - If the cause is in CodeTether and the change stays within `packages/adapter-codex/`, fix it, add tests, and commit separately, for example `fix(adapter-codex): …`.
   - If the cause is in Codex itself (login, quota, service, configuration), do not fix it; report the category and the user's required action.
   - If unresolved, state how far the investigation reached without guessing.

Prohibited:
- Do not log in/out or upgrade/downgrade Codex.
- Do not modify `~/.codex` configuration.
- Do not read `~/.codex/auth.json` or other credential files.

## Part 4: Package and reinstall

Follow steps 3 through 7 of `docs/reviews/ux-v4-device-first-install-prompt.md`, as in R4 part 2, with these differences:

- Before packaging, copy the existing 2d9ad41 installer and its SHA256 to `D:/Projects/Software/agenthub-archive/installers/2d9ad41/`.
- Account configuration:
  - VITE_SUPABASE_URL: `https://qfktysdrytlaxvhzqpba.supabase.co`;
  - VITE_CODETETHER_CONTROL_PLANE_URL: `https://api.codetether.org`;
  - Ask the user for VITE_SUPABASE_PUBLISHABLE_KEY, or ask them to run the packaging command themselves with `!`.
- Preserve data without making another data backup.
- Before uninstalling, ask the user to exit CodeTether from the tray; do not terminate processes.
- Launch the original installed path using `Start-Process`. If blocked, ask the user to run:
  `! powershell.exe -NoProfile -Command "Start-Process -FilePath 'C:\Users\Administrator\AppData\Local\CodeTether\codetether-desktop.exe'"`
- After launch, verify bootstrap's `hostVersion` equals the first 12 characters of the final commit.

## Part 5: Finish installed-app acceptance

Use UIAutomation and screenshots cropped to the CodeTether window, as in R4. Save screenshots under `output/playwright/v4-installed-acceptance-r5/`. Check every Windows acceptance item in `docs/reviews/ux-v4-device-first.md`, reporting Pass, Fail, or Not tested with evidence.

Execution budget:
- Codex: 1 direct invocation in part 3, at most 3 brief turns in the installed app.
- Claude Code: 1 installed-app turn.
- Run only in the test folder.

### 1. Item 14: Chinese summaries

In a Claude Code conversation in the test project, send a prompt requiring search and reading, such as asking to list the folder's files and read one.

- Check that step summaries in the conversation and right panel are Chinese.
- Inspect every page again for English sentences and the prohibited Chinese terms `智能体` and `此电脑`.

### 2. Item 2: Import a previous conversation

Use only the Codex conversation left in the test folder by part 3.

- Find Previous conversations in the test project, import it, and verify it opens.
- Do not import conversations from other projects.
- If part 3 left no conversation, mark Not tested and explain why.

### 3. Items 6 and 8: Codex stop, approval, changes, and Attention

Proceed only if part 3 establishes that Codex works; otherwise mark Not tested. Cover these in at most 3 turns:
- Stop;
- A command requiring approval: verify it appears in Attention first, then choose Deny or Allow once;
- A file write, checking the Changes panel.

Item 8 must show Awaiting approval, Failed, and Completed; Failed and Completed need a Got it action. Explain why any item cannot be approved.

### 4. Item 9: System notifications

Before testing, inspect without modifying:
- `ToastEnabled` under `HKCU\Software\Microsoft\Windows\CurrentVersion\PushNotifications`;
- whether `HKCU\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\com.codetether.desktop` exists and its `Enabled` value;
- the AppID from `Get-StartApps | Where-Object Name -like '*CodeTether*'`, expected `com.codetether.desktop`;
- whether Do Not Disturb (Focus Assist) is enabled.

If anything is disabled, provide a `!` command or Settings path to the user and wait for confirmation before testing.

During testing:
- Minimize CodeTether immediately after sending. Notifications are suppressed only when the window is foregrounded and showing Attention or that same conversation (`desktop-notification-model.ts:105`).
- Read notification history or use UIAutomation; record only Device · Project and the explanation, without the conversation title.
- Click the notification and verify the correct conversation opens.
- Installed Desktop stderr is normally unavailable. For one launch this round, use `Start-Process -RedirectStandardError <log under archive>` at the original installed path and search for `notification delivery failed`. Redact logs before saving.

### 5. Item 10: No dark-blue flash at launch

Last round missed approximately the first 1.4 seconds. This time the sampling script must launch the app:
- Begin polling for the window, then call `Start-Process` in the same script;
- Poll at intervals of at most 50 ms, capturing as soon as the window becomes visible and continuing for at least 5 seconds after launch;
- Use the R4 color criteria.

Record process launch time, first visible-frame time, and first screenshot time. If the first screenshot is more than 100 ms after visibility, still mark Not tested.

### 6. Item 1: First-time setup

Launch once using a new empty data directory without touching existing data:
1. Ask the user to exit from the tray.
2. Set `$env:CODETETHER_DATA_DIR='D:\Projects\Software\agenthub-work\v4-firstrun-data'` in PowerShell, then launch the original installed path with `Start-Process`. Create this directory empty.
3. Verify first-time setup appears; Installation, Execution, and Service are separate; the primary button is Continue setup. Do not log in, pair, or add projects.
4. Ask the user to exit from the tray again, launch normally without that environment variable, and verify the original data remains.

The WebView data directory does not change, so first-time setup may still not appear. Mark Not tested with the reason; do not clear WebView data.

### 7. Icons

Following icon-task section 3, inspect the window title bar, taskbar, tray, Start menu, and executable in the installation directory. Report Windows caching an old icon accurately; do not clear the system icon cache.

### Prohibited actions

- Do not pair/unpair or remove existing projects.
- Do not log in or change accounts.
- Import only the single conversation specified in item 2.
- Do not run AI tools outside the test folder.
- Retain the test project, test conversations, and `v4-firstrun-data` after testing and record this in the report.

## Checks and commits

- Before every commit, run `env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm typecheck`, and run `lint`, `test`, and `build` in the same way. All must exit 0.
- Check changed files in batches with `xargs -n 40 npx prettier --list-different --end-of-line auto`.
- End commit messages with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Do not push, merge, or tag.

## Report

Write `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r5.md`, including:
- Commit hashes and check results;
- Summaries changed in part 1 and English strings listed but left unchanged;
- Icons: file dimensions and layers, legibility at 16 pixels, and screenshots of each location;
- Codex: findings from every investigation step, conclusion category, and user action needed;
- New installer SHA256 and running `hostVersion`;
- Each checklist result and screenshot name;
- Untested items and reasons;
- Denied operations and `!` commands handed to the user.

## Restrictions

- Change only files and tests specified in parts 1, 2, and 3. Do not edit `docs/reviews/`.
- Do not read .secrets/, any .env, credential files, machine-credentials contents, `~/.codex/auth.json`, or ~/.claude.json.
- Leave untracked files in the main workspace untouched.
- Do not use `rm -rf`, delete backups or old installers, or run `git worktree remove`.
- Redact `sk-…` and `sb_publishable_…` from logs with sed.
- Do not bypass denied permissions; give the user the command as `! …`.
- On API 429 or 524, follow Retry-After, retry at most 3 times, record each attempt's time, then stop and report.
- Write the report in Chinese without exclamation marks or em dashes.
