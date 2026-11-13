# Task. U1 one-click desktop updates

Run on Windows or Mac. Continue from `main` (currently `b668e53`, v0.1.0-alpha.2). Enable one-click Windows/macOS desktop updates under Settings › About and checks, preserving local projects, conversations, and credentials. Implement the complete feature, including check, download, install, backup, rollback, version management, and release scripts. Push to `feat/u1-desktop-update` without pushing `main`, merging, or tagging.

References (read with `git show`).

- `docs/ux-redesign/05-desktop-update.md`, complete seven-section design.
- U1 in `docs/ux-redesign/03-project-plan.md` §4.
- "Release" in `docs/ux-redesign/04-requirements.md` §6.
- `docs/ROADMAP.md`, U1 scope and v0.1.0-alpha.3 goals.

Before starting, confirm this file has four second-level headings and the last section is "Report".

## Goals

**Required.**

1. **Rust update logic** (05 §5.1).
   - Integrate an exact `tauri-plugin-updater` version compatible with tauri 2.11.5.
   - Four application commands, `update_state`, `update_check`, `update_download`, `update_install`.
   - Rust owns the state machine (11 states in 05 §4).
   - Scheduled checks about one minute after startup, then every six hours.
   - Restart through Tauri core `AppHandle::restart`.

2. **Update URL and public key** (05 §5.2).
   - Compile-time `CODETETHER_UPDATE_BASE_URL` and `CODETETHER_UPDATE_PUBKEY` environment variables.
   - Enable only with both present. Otherwise show "Automatic updates are not configured in this build".
   - Fixed check URL `<base>/alpha/latest.json`.
   - Production accepts https only. Debug may use http for local tests.

3. **Installation order** (05 §5.3).
   - Web confirms no `running` / `waiting` conversations before `update_install`.
   - Rust gracefully stops Host through existing `shutdown_owned_host` (12 seconds).
   - Once Host stops, invoke plugin installation.
     - Windows uses `passive` NSIS, showing progress then reopening automatically.
     - macOS replaces .app then calls `restart`.

4. **Pre-update database backup** (05 §5.4).
   - Before opening its database, Host compares data-directory `host-product-version` with its product version.
   - If different and a database exists, do the following.
     - Copy `codetether.sqlite3`, `-wal`, and `-shm` verbatim to `backups/<UTC time>-<old version>/`, fsync before continuing.
     - Keep only the latest three backups.
     - Write the new marker only after successful migrations.
   - Backup failure prevents startup with an explicit reason, preserving the original database.
   - Back up database files only, excluding `machine-credentials` and other credentials.

5. **Returning to an older version** (05 §5.5).
   - Unknown applied migrations cause Host to exit with a dedicated code instead of 1 and a fixed stderr reason.
   - Desktop adds a matching startup-failure type with copy "This local data was created by a newer CodeTether version and cannot be opened by this version. Install a newer version or follow the instructions to restore the pre-update backup."
   - Document restoration in `apps/desktop/README.md`.

6. **Version management** (05 §5.6).
   - Root `package.json` is the sole source of truth.
   - Inject `PRODUCT_VERSION` during build instead of hand-maintaining it.
   - Add a version-setting script synchronizing `Cargo.toml`, `Cargo.lock`, and `apps/desktop/package.json`, plus a consistency test.
   - U1 version is `0.1.0-alpha.3`.

7. **Release artifacts and hosting** (05 §5.7).
   - Generate updater files only when all four variables exist.
     - `TAURI_SIGNING_PRIVATE_KEY`
     - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
     - `CODETETHER_UPDATE_BASE_URL`
     - `CODETETHER_UPDATE_PUBKEY`
   - Each platform outputs its installer, `.sig`, and platform-only `update-<platform>.json`.
   - `release:update-manifest` combines platform fragments into `latest.json`.
   - Layout is `<base>/alpha/latest.json`, with installers under `<base>/alpha/<version>/`.

8. **About-page version row** (05 §4).
   - Place it below the CodeTether name in the top About card.
   - Eleven states, including up-to-date, checking, available, downloading, downloaded, updating, and failed.
   - Display release notes as plain text, without HTML or Markdown links, truncated after 2,000 characters.
   - Count in-progress local conversations with status `running` or `waiting`.

9. **Web API boundary** (05 §5.1).
   - Do not install web `@tauri-apps/plugin-updater` or grant web `updater:*` permissions.
   - Web calls the four application commands.

**Outside this round.**
- Silent updates.
- Linux.
- Updates on Node-paired devices.
- Android (M series).
- One-click rollback button.
- Code-signing certificates and Mac notarization (not purchased yet, test system warnings).

## Known facts

- Baseline is `main` `b668e53` (v0.1.0-alpha.2).
  - Tauri `=2.11.5`, plugins dialog, notification, shell, single-instance, plus Windows deep-link.
  - Windows packaging is NSIS `currentUser`. macOS app + dmg uses ad-hoc signing.
  - Windows installation and data share `%LOCALAPPDATA%\CodeTether`.
  - Desktop writes `shutdown` to Host stdin and waits at most 12 seconds.
  - Database `schema_migrations` rejects unknown applied migrations with `Unsupported SQLite schema migration`, causing Host exit 1.
  - About does not show a version.
  - Release `apps/distribution/src/build.mjs` requires clean HEAD and writes installers to `output/release/<commit>/`.

- Update base is `https://codetether.org/updates` (decided 2026-11-01).
  - Check `https://codetether.org/updates/alpha/latest.json`.
  - Installers `https://codetether.org/updates/alpha/<version>/`.

- The user generates the update-signing private key locally with Tauri CLI `tauri signer generate`, stores it outside the repository with a password, and provides the public key for release instructions.

- Physical acceptance follows coding and review. The user manually installs alpha.3, then publishes alpha.4 and performs an update on both Windows and Mac.

## Boundaries

**Decide independently.**
- Implementation (state machine, Rust module structure, scheduling).
- Commit breakdown, with tests per item.
- Testing and screenshots.
- Version script implementation (Node.js or Bash/PowerShell).
- Release-script change scope.

**Ask the user first.**
- Node.js/TypeScript changes outside `apps/host`.
- Database schema changes (backup only reads/writes files).
- Personal action (signing-key generation, update uploads, physical acceptance).
- Reading or printing credentials/private keys.

**Do not do.**
- Read or print credentials/private keys.
- Push `main`, merge, or tag.
- Force-push.
- Upload updater artifacts to VPS (user handles this).
- Generate signing keys (user handles this).

## Report

Append to new `~/agenthub-archive/u1-report.md` with these sections.

- Base commit and confirmation all seven sections of 05 were read.
- Changes and commits for items 1–9.
- Rust unit/integration results.
- Web typecheck/lint/build results.
- Version-script test results.
- Release-script tests (test-key generation, build, output checks).
- Confirmation test keys were deleted.
- Remote commit after pushing.
- Remaining work, reasons, and completion level.

Exclude all credentials, private keys, and passwords.
