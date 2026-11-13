# Task. Update installed Windows build to fd1d905

Run on Windows. This is installation only. No repository changes, commits, pushes, or tags.

Before starting, confirm this file has four second-level headings and the last section is "Report".

## Goals

Update installed CodeTether on Windows from `git-b668e53f2c79` to `fd1d905`, the Supervisor frame-budget fix (`origin/fix/b1-supervisor-internal`). With user approval, `origin/main` will fast-forward to this same commit and build ID.

Completion criteria follow.

1. The new build stays running with build ID starting `git-fd1d905` and no `dirty` suffix.
2. The port-4317 listener comes from the install directory, with the desktop program in that directory as its parent.
3. Computer identity and all three machines remain, Host online publication returns 2xx, and Relay receives `supervisor.ready(role=host)`.
4. The user confirms the window opens, "This computer" is online, and "Add device › Add phone or tablet" is present.

## Known facts

- **Install location.** `C:/Users/Administrator/AppData/Local/CodeTether`, with `codetether.sqlite3` in the same directory (`%LOCALAPPDATA%\CodeTether`). This is the only production installation.
- **Previous update.** During vivo acceptance on 2026-11-06, `git-5edcbbf31a02` was updated in place to `b668e53`. Evidence is in `D:/Projects/Software/agenthub-archive/t1a-logs/vivo-x60/`.
  - `windows-upgrade.json` records normal tray exit, port 4317 verification, and NSIS `/S /UPDATE` in-place installation.
  - `windows-b668e53/` contains build scripts/receipts, `nsis-safety-review.md` (data preservation with `/UPDATE`), and `verify-installed-desktop.py`.
  - "Evidence and retest boundaries" in `t1a-report.md` records pitfalls. Tauri rejects `CI=1`, so use `CI=true`. Tray-exit scripting needs collection assembly references in current PowerShell. Tauri temporarily rewrites newlines in 18 TOMLs, making the worktree/build ID dirty unless restored. Installed desktop differs from the build artifact in only three BundleType bytes (`UNKNOWN` → `NSIS`), which is normal.
  - Reuse scripts after verifying they target the new commit and paths.
- **No new migrations.** `fd1d905` changes reads only, permitting rollback. If startup fails, reinstall `windows-b668e53/CodeTether_0.1.0-alpha.0_x64-setup.exe` in place to reopen original data.
- **Backups.** After application exit and before replacement, back up `codetether.sqlite3`, `-wal`, and `-shm` into `D:/Projects/Software/agenthub-archive/windows-install-backup-<date>/`, restrict access to the current user, and verify checksums without reading contents. Save the three executables separately as before.
- **Build.** Use a new isolated worktree, such as `D:/Projects/Software/agenthub-work/windows-install-fd1d905`, preserving existing worktrees such as `fix-b1-supervisor-internal`. Reuse child-process environment allowlists without reading `.env`.
- **Current state.** No phones/tablets are paired (vivo test authorization removed). Preserve both Node-connected remote machines.
- **Origins.** The control service already permits packaged desktop origins. No relaxation needed.

## Boundaries

- **Decide independently.** Build/install procedures, script reuse, build environment issues, diagnosis, and retries. If startup fails, independently roll back, confirm old startup, then report.
- **Ask the user first.**
  - Window confirmation (criterion 4).
  - Killing processes if normal tray exit fails.
  - Repository code changes needed for building.
  - Production configuration changes.
- **Do not do.**
  - Read or print `.secrets/`, `.env`, tokens, keys, connection strings, or credentials.
  - Read database contents. Inspect only sizes, modification times, and checksums.
  - Touch remote machines, Node, or pairing.
  - Commit, push, or tag.

## Report

Write to `D:/Projects/Software/agenthub-archive/windows-install-fd1d905-report.md`.

- Before/after build IDs, desktop/Host SHA-256, and installer size/SHA-256.
- Backup directory and checksum verification.
- Build/install problems and solutions.
- Outcomes for all four completion criteria.
- Whether rollback occurred and why.
- Remaining work and reasons.
