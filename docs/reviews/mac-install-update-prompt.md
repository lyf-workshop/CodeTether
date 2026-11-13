# Task: Update the Installed Mac App to fd1d905

Run on Mac. This is installation work. Do not change repository code, commit, push, or tag.

Before starting, confirm this file has 4 second-level headings and the final section is "Report".

## Goals

Update `/Applications/CodeTether.app` from the current `origin/main` build (`b668e53`) to `fd1d905`, the Supervisor frame-budget fix on `origin/fix/b1-supervisor-internal`. Once the user approves merging, `origin/main` will fast-forward to the same commit with the same build ID.

Acceptance:

1. The new app runs over 60 seconds, with a build ID beginning `git-fd1d905` and no `dirty` suffix.
2. The 4317 listener comes from `/Applications/CodeTether.app`, with no `Unsupported SQLite schema` in logs.
3. The user confirms the window opens, This Computer is online, and the iPad remains listed under Phones and Tablets.
4. Production `com.codetether.node` is unaffected, with the same PID before and after.

## Known Facts

- **Previous installation**: reuse `~/agenthub-archive/mac-install-b1-report.md` for building, pnpm entry handling, and Node selection. Use checksum-verified official Node 26.4.0 at `~/agenthub-work/i1-node-26.4.0`, not Homebrew Node. `apps/desktop/scripts/build-sidecar.mjs` expects `$PNPM_HOME/node_modules/pnpm/bin/pnpm.mjs`. Load `~/agenthub-work/v4-build.env` with `set -a; . …; set +a` without printing it.
- **No new migrations**: `fd1d905` changes reads only. Schema remains 24, allowing rollback to the currently installed `b668e53` app with the same data if startup fails.
- **Backup**: use `mv` to move the current `/Applications/CodeTether.app` into backup as the rollback build. After app exit, back up `~/Library/Application Support/CodeTether` with mode 700, excluding private-key directory `Node/`, and verify database checksums. Store backups under `~/agenthub-archive/mac-install-backup-<date>/`.
- **Quit the current app**: it remains in the tray after window closure. Quit normally using its tray menu or `osascript -e 'quit app "CodeTether"'`, then confirm port 4317 is free before replacement.
- **iPad pairing**: the paired iPad awaits this update for continued acceptance. Pairing persists in the data directory. Do not remove or re-pair it.
- **Permission dialogs**: the new CDHash may prompt again on first subsequent Desktop/Documents/Downloads access, as expected.
- **Origins**: packaged desktop origins are already allowed by the control service. No allowlist change is needed.

## Boundaries

- **Decide independently**: build/install methods, environment diagnosis, and retries. If the new app fails, restore the previous build and verify startup before informing the user.
- **Ask the user first**:
  - Visual confirmation for acceptance item 3.
  - Normal quit fails and process termination is needed.
  - Repository changes are needed to build.
- **Do not**:
  - Read `.secrets/`, other `.env` files, credential files, `~/.codex/auth.json`, or `~/.claude.json`.
  - Read database contents. Inspect size, modification time, and checksum only.
  - Touch `com.codetether.node`, its executable, or `Node/` data.
  - Remove or pair devices on the device page.
  - Commit, push, or tag.

## Report

Append "Update to fd1d905" to `~/agenthub-archive/mac-install-b1-report.md`:

- Before/after build ID and CDHash, source commit, Node version/checksum.
- Backup directory and checksum verification.
- Build/install issues and solutions.
- All four acceptance results.
- Whether rollback occurred and why.
- Unfinished work and reasons.
