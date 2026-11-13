# Task: Replace the Installed Mac App with a Post-B1 Build

Run on Mac. This is installation work. Do not change repository code, commit, push, or tag.

Before starting, confirm this file has 4 second-level headings and the final section is "Report".

## Goals

Replace `/Applications/CodeTether.app` with an `origin/main` build (`b668e53` or newer), achieving:

1. Startup using existing production data, then continued operation.
2. Add Device › Add Phone or Tablet (B1) available for iPad pairing.
3. Production `com.codetether.node` service unaffected, with the same PID before and after.

Acceptance: the new application runs for over 60 seconds, logs contain no `Unsupported SQLite schema`, the 4317 listener comes from `/Applications/CodeTether.app`, and the user confirms the window opens, This Computer is online, and Add Phone or Tablet is present.

## Known Facts

- **Background**: the installed pre-B1 build is `git-111f1b08e5f3`, commit `111f1b0`. Newer software migrated `~/Library/Application Support/CodeTether` to schema 24, introduced by B1. The old app exits with `Unsupported SQLite schema migration 24`. See "Installed-app exit investigation" in `~/agenthub-archive/b4-mac-folder-access.md`. Rolling back to that old app cannot recover failure.
- **Backup**: before any change, back up production data to `~/agenthub-archive/mac-install-backup-<date>/` with mode 700, excluding `Node/` because it contains Node private keys. Verify database checksums. Reuse `mac-install-backup-2026-11-06-210423/` if already checksum-verified. Move the old `.app` into backup using `mv`, without deleting it.
- **Build**:
  - Build in a new isolated worktree, leaving existing Mac worktrees untouched. It must be clean because build scripts append `dirty` for uncommitted changes.
  - Use checksum-verified official Node 26.4.0 (`~/agenthub-work/i1-node-26.4.0`, checksum recorded in `~/agenthub-archive/b4-mac-folder-access.md`). B4 testing found Host builds using Homebrew Node failed to launch.
  - Load `~/agenthub-work/v4-build.env` in the build shell with `set -a; . …; set +a` without printing it.
  - `runPnpm` in `apps/desktop/scripts/build-sidecar.mjs` expects `$PNPM_HOME/node_modules/pnpm/bin/pnpm.mjs`, or the Node executable directory if `PNPM_HOME` is unset. This assumes Windows layout. Official Node archives omit pnpm, so direct building fails with `MODULE_NOT_FOUND`, observed on 2026-11-06. Use repository pnpm `11.20.0`. Provide the entry without changing repository code or the Node directory.
- **Origins**: the control service already allows packaged desktop origins. No allowlist or Windows-user action is needed.
- **Permission dialogs**: the new CDHash causes fresh prompts on first access to Desktop, Documents, or Downloads, as expected from B4 testing. The installed app is ad-hoc signed. `spctl --assess` rejects it, but ordinary application launching works.

## Boundaries

- **Decide independently**: pnpm entry provision, build diagnosis/retries, installation, and verification.
- **Ask the user first**:
  - Visual confirmation, as the final verification step.
  - A running CodeTether desktop process needs termination.
  - Repository changes are needed to build.
  - The new app fails to launch. Do not independently restore data or the old app.
- **Do not**:
  - Read `.secrets/`, other `.env` files, credential files, `~/.codex/auth.json`, or `~/.claude.json`.
  - Read database contents. Inspect size, modification time, and checksum only.
  - Touch `com.codetether.node`, its executable, or `Node/` data.
  - Commit, push, or tag. The user handles versioning/release separately.

## Report

Write `~/agenthub-archive/mac-install-b1-report.md`:

- Before/after build ID, `CFBundleVersion`, CDHash, source commit, Node version/checksum.
- Backup directory and checksum verification.
- Build issues and solutions.
- Runtime duration, 4317 listener path, schema errors, and user UI confirmation.
- Whether the `com.codetether.node` PID remained unchanged.
- Unfinished work and reasons.
