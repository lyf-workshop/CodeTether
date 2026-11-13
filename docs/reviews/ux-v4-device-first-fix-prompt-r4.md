# Task. Fix the Windows add-project path example and finish installed-build acceptance after reinstallation

Branch `ux/v4-device-first`, worktree `D:/Projects/Software/agenthub-ux-v4-device-first`. Require clean `b1e1ccf123c7adb8344720633e7726d5312e2030`, otherwise stop and report. UI follows docs/ux-redesign prototypes under temporary user authorization overriding AGENTS.md's Figma-only rule.

The agent must inspect the installed UI directly instead of delegating UI judgments to the user.

## Part 1. Fix (R4-1)

Symptom. Adding a local Windows project shows `/Users/user/project` rather than `C:\Projects\我的项目`.

Root cause.
- Local Host platform is `Windows` (`apps/host/src/api/machine-registry.ts:238`, also `migrations.ts:2596`).
- `apps/web/src/components/projects/add-project-fields.tsx:157-163` compares only lowercase `windows` and `win32`.
- Fixture `apps/web/test/add-project-fields.test.mjs:96` uses lowercase `windows`, hiding the issue.

Changes.
1. Add case-insensitive platform classification in `apps/web/src/components/machines/machine-presentation.ts`.
   - Group `windows`/`win32` as Windows, `macos`/`darwin` as macOS, `linux` as Linux, everything else as other.
   - Match `machinePlatformLabel` with `toLocaleLowerCase('en-US')`. It may reuse this helper without changing displayed output.
2. Use the classifier in `add-project-fields.tsx` examples.
   - Remote devices keep `/home/user/project`.
   - Locally use `C:\Projects\我的项目` for Windows, `/Users/user/project` for macOS, and `/home/user/project` for Linux/other.
3. Search apps/web and packages/ui for other case-sensitive `platform` comparisons.
   - Fix equivalent issues using this helper.
   - `node-pairing-model.ts` 'linux' | 'macos' is internal, not Host data, and needs no change.
4. Tests.
   - Change the local fixture to actual Host value `Windows`.
   - Assert examples for `Windows`, `windows`, `win32`, `macOS`, and `Linux`, plus unchanged remote examples.
   - Unit-test the classifier.
5. Preserve Host APIs, path validation, and authorization rules.

Checks, with ANTHROPIC_* removed.
- Run `env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm typecheck`, and equivalently `lint`, `test`, and `build`, all exit 0.
- Check changed files with `xargs -n 40 npx prettier --list-different --end-of-line auto`.

Commit.
- One commit, such as `fix(web): show Windows path example for the local Windows device`.
- End with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- No push, merge, or tag.

## Part 2. Package and reinstall

Follow steps 3–7 of `docs/reviews/ux-v4-device-first-install-prompt.md`, with these differences.

- Before packaging, copy the b1e1ccf installer and SHA256 to `D:/Projects/Software/agenthub-archive/installers/b1e1ccf/`. Packaging overwrites the original path.
- Three account settings.
  - VITE_SUPABASE_URL is `https://qfktysdrytlaxvhzqpba.supabase.co`.
  - VITE_CODETETHER_CONTROL_PLANE_URL is `https://api.codetether.org`.
  - Ask for VITE_SUPABASE_PUBLISHABLE_KEY or have the user run packaging with `!`.
- Preserve data without another backup. Leave `windows-install-backup-20261020-pre-v4` untouched.
- Ask for normal tray exit before uninstalling. Do not terminate processes.
- Automatic startup after installation is blocked. Ask the user to run
  `! powershell.exe -NoProfile -Command "Start-Process -FilePath 'C:\Users\Administrator\AppData\Local\CodeTether\codetether-desktop.exe'"`
- Verify bootstrap `hostVersion` equals the new commit's first 12 characters (`git-xxxxxxxxxxxx`).

## Part 3. Finish installed-build acceptance

Inspect the installed window with UIAutomation and CodeTether-window-only screenshots, as in installation report §9. Store shots in `output/playwright/v4-installed-acceptance/`.

Compare Windows acceptance items in `docs/reviews/ux-v4-device-first.md`, recording Pass/Fail/Untested with evidence. Focus on those still untested in §9.

- R4-1. Local add-project example is a Windows path.
- Item 3. Sidebar expansion persists across restart, Ctrl B toggles. Ask for exit/restart with the command above.
- Item 10. Startup does not flash dark blue.
- Items 4–8.
  - Create an empty `D:/Projects/Software/agenthub-work/v4-accept-project` test folder and add it as a project.
  - Create conversations only there.
  - At most three brief Codex turns covering send focus, stop, one approval-required command (Reject or Allow once), and Changes.
  - One brief Claude Code turn verifying no stop/approval buttons and an explanation.
  - Preserve and document the test project.
- Items 8–9. Inbox and notifications. Record only Device · Project and explanation, excluding conversation title.
- Items 12–15. Roadmap, drafts, English-copy scan, card heights.

Do not do the following.
- Pair, unpair, import old conversations, log in, or change accounts.
- Execute AI tools outside the test project.

## Report

Write `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r4.md`.
- Fix commit hash.
- Check results.
- New installer SHA256.
- Running `hostVersion`.
- Per-item results and screenshot names.
- Untested items and reasons.
- Denied operations and handed-off `!` commands.

## Restrictions

- Change only part-1 files and tests, not `docs/reviews/`.
- Do not read .secrets/, any .env, credential files, machine-credentials contents, or ~/.claude.json.
- Preserve main-worktree untracked files.
- No `rm -rf`, backup/old-installer deletion, or `git worktree remove`.
- Redact `sk-…` and `sb_publishable_…` using sed.
- Do not bypass permission denial. Hand commands to the user as `! …`.
- For API 429/524 honor Retry-After, at most three retries with timestamps, then stop/report.
- Report in Chinese without exclamation marks or em dashes.
