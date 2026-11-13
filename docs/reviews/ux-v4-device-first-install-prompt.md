# Task: replace installed Windows CodeTether with ux/v4-device-first (b1e1ccf)

The user explicitly authorized removing the current installed version and installing this branch's build: "You can remove the installed version and install the new version; I am not using it for development yet." Operate only on this Windows computer; preserve Mac.

This installs an unmerged, untagged commit, unlike DEVELOPMENT-PROCESS's tagged-main rule. Follow this task-specific user authorization and disclose the exception. UI follows docs/ux-redesign prototypes under temporary authorization overriding AGENTS.md's Figma-only rule. No code changes.

## Current state

- Worktree `D:/Projects/Software/agenthub-ux-v4-device-first`, branch `ux/v4-device-first`, required HEAD `b1e1ccf123c7adb8344720633e7726d5312e2030`, clean worktree; otherwise stop/report.
- Installed version:
  - CodeTether 0.1.0-alpha.0 from main bbcda69.
  - Installed under `C:\Users\Administrator\AppData\Local\CodeTether`, also the data directory containing codetether.sqlite3, logs, machine-credentials, etc.
  - WebView data: `C:\Users\Administrator\AppData\Local\com.codetether.desktop`.
- Backup already exists at `D:/Projects/Software/agenthub-archive/windows-install-backup-20261020-pre-v4`, containing full copies of both directories, previous installer/SHA256, and RESTORE.txt with file/byte counts. Preserve it unchanged.
- Previous `pnpm desktop:build` failed pre-web-build checks for missing VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_CODETETHER_CONTROL_PLANE_URL. Host already builds as `git-b1e1ccf123c7`.
- Silent uninstall (`/S`) removes executable files only. Tauri deletes `com.codetether.desktop` only when "Delete application data" is selected; installation-directory database/credentials remain for the new version.

## Steps

1. Verify worktree/HEAD as above.
2. Obtain the three account settings.
   - They are public application configuration (`apps/web/README.md`) but must come from the user. Ask for values used by the installed build, or have the user run step 3 with `!` and resume at step 4.
   - Never search files, registry, environment-variable storage, or old executables for them.
   - Format is defined in `apps/web/scripts/check-desktop-account-config.mjs`:
     - URLs end at domain/port;
     - Control URL accepts https or http localhost/127.0.0.1;
     - Key starts `sb_publishable_`.
   - Supply environment variables. Desktop embeds the control URL via `option_env!` (`host_supervisor.rs:267`); .env alone is insufficient. Write no .env files.
3. Package in background (possibly over ten minutes), waiting for completion.
   ```bash
   cd D:/Projects/Software/agenthub-ux-v4-device-first && export VITE_SUPABASE_URL='…' VITE_SUPABASE_PUBLISHABLE_KEY='…' VITE_CODETETHER_CONTROL_PLANE_URL='…' && env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm desktop:build 2>&1 | sed -E 's/sk-[A-Za-z0-9_-]+/sk-REDACTED/g' > D:/Projects/Software/agenthub-archive/v4-desktop-build-20261020.log; echo "exit ${PIPESTATUS[0]}"
   ```
   - Success requires exit 0 and fresh `apps/desktop/src-tauri/target/release/bundle/nsis/CodeTether_0.1.0-alpha.0_x64-setup.exe`. Record size, mtime, SHA256.
   - Check `git status`; report tracked build changes without committing or reverting.
   - On failure stop before uninstalling and provide redacted errors.
4. Pre-uninstall checks.
   - No codetether-desktop.exe/codetether-host.exe and no 4317 listener. If running, ask user to tray-exit. If another program owns 4317, stop/report.
   - Installation/WebView file counts and bytes must match RESTORE.txt.
     - A mismatch means the old version ran since backup; make another equivalent backup at `D:/Projects/Software/agenthub-archive/windows-install-backup-<time>-pre-v4b`.
     - Verify new backup counts/bytes before continuing.
     - Copy machine-credentials without opening.
5. Uninstall.
   - Run `C:\Users\Administrator\AppData\Local\CodeTether\uninstall.exe /S`. NSIS copies itself to temp and returns immediately.
   - Wait at most two minutes for both:
     - codetether-desktop.exe and uninstall.exe disappear from installation directory;
     - CodeTether entry disappears under `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall`.
   - Confirm codetether.sqlite3, logs, machine-credentials, and `com.codetether.desktop` remain. If deleted, stop/report and await the user's restoration decision using RESTORE.txt.
6. Install.
   - Run step 3's installer with `/S`.
   - Verify:
     - Registry DisplayVersion 0.1.0-alpha.0, InstallLocation `C:\Users\Administrator\AppData\Local\CodeTether`;
     - Fresh codetether-desktop.exe/codetether-host.exe, today's mtimes, SHA256 different from old backups.
   - Report whether a Start menu shortcut exists.
7. Launch and confirm.
   - Launch `C:\Users\Administrator\AppData\Local\CodeTether\codetether-desktop.exe`, waiting at most 60 seconds for 127.0.0.1:4317.
   - Exactly one installed-path codetether-host.exe owns 4317.
   - Host buildId is `git-b1e1ccf123c7`.
     - Request `http://127.0.0.1:4317/api/v1/bootstrap`, using release `desktop_origin()` from host_supervisor.rs if needed. Print build/version fields only, never full response.
     - On rejection record status without bypassing, then search only buildId lines in the newest logs, redacting first.
   - Ask user to visually confirm the new Chinese UI with Device > Project sidebar grouping.
   - Leave the application running for acceptance.
8. Write `D:/Projects/Software/agenthub-archive/v4-install-report-20261020.md` with:
   - Per-step results, commands, and exit codes;
   - Installer path, size, SHA256, source commit;
   - Data preserved after uninstall and any new backup;
   - Registry, process/port, and buildId checks;
   - Only hostnames for the two account URLs, excluding key;
   - Denied operations and `!` commands handed to user;
   - Process exception: unmerged/untagged b1e1ccf installed.

## Restrictions

- No code changes, commits, pushes, merges, or tags. Preserve `docs/reviews/`, maintained by the reviewer.
- Do not read:
  - .secrets/;
  - Any .env;
  - Credential files or machine-credentials contents;
  - ~/.claude.json;
  - phase9c-control-plane.env in agenthub-archive.
- Preserve main-worktree untracked .secrets/, PHASE8D-*.json, PHASE8D-*.txt, demo-ui-*.html, ICON-COLLECTION-PLAN.md, docs/MULTI-PROVIDER-STRATEGY.md, packages/ui/src/assets/ under `D:/Projects/Software/agenthub`.
- Do not terminate processes; request tray exit when needed.
- No `rm -rf` on data, deletion of any backup/old phase10 installers, or `git worktree remove`.
- Redact `sk-…` with sed in all logs/output before display.
- On permission denial, provide the command as `! …` rather than bypassing.
- API 429/524: wait per Retry-After, retry up to three times with timestamps, then stop/report.
- Environment:
  - Git Bash on Windows;
  - Node `D:\DevTools\Miniconda\node.exe` (v25.8.2);
  - cargo 1.98.0 in ~/.cargo/bin, added to PATH by packaging script.
- Report in Chinese without exclamation marks or em dashes.
