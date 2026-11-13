# 05 · One-Click Desktop Updates (U1)

Date — 2026-11-01. References are `main` 0f624ae (v0.1.0-alpha.2), the U1 row in 03-project-plan.md, and 04-requirements.md §6, “Release.”

## 1. Goals and Scope

- Windows and macOS desktop users can update to a new version from Settings › About and Checks, preserving local projects, conversations, and credentials.
- A new version produces a prompt. Updating requires a user click. Wait for conversations that are running or awaiting approval to finish.
- Back up the local database before updating. If a new version changes the schema and the user returns to an older version, the older version must explain the situation and support restoration from the backup.
- Exclusions include silent updates, Linux, updates on paired Node devices, Android (covered by the M series), a one-click rollback button, code-signing certificates, and Mac notarization. Certificates and notarization will not be purchased yet. Test the resulting system warnings.

## 2. Current Implementation (Verified on main)

- Tauri is pinned to `=2.11.5`. Plugins are limited to dialog, notification, shell, and single-instance, plus deep-link on Windows. There are no updater or process plugins. `apps/desktop/test/security-config.test.mjs:301` prohibits `tauri_plugin_process::init`.
- Packaging uses NSIS `currentUser` on Windows and app + dmg with ad-hoc signing on macOS. `tauri.conf.json` has neither `plugins.updater` nor `createUpdaterArtifacts`.
- On Windows, the install and data directory are both `%LOCALAPPDATA%\CodeTether`. It contains `codetether-desktop.exe`, `codetether-host.exe`, `codetether.sqlite3` (WAL mode, with `-wal` / `-shm`), and `machine-credentials`.
- The root `package.json` version remains `0.1.0-alpha.0`, although tags have reached alpha.2. `build.rs` checks that the Cargo version matches. `apps/web/src/runtime/account/control-plane-client.ts:9` hardcodes `PRODUCT_VERSION`. Control Plane treats `appVersion` as bounded text without version gating.
- To stop Host, Desktop writes `shutdown` to stdin and waits up to 12 seconds (`shutdown_owned_host` in `host_supervisor.rs`). On Windows, Host runs inside a Job Object and is terminated when Desktop exits. Unfinished turns are recorded as `host_restart` on the next launch, without being silently lost.
- Database migrations use the `schema_migrations` table, with each migration running inside `BEGIN IMMEDIATE`. An unknown applied migration throws `Unsupported SQLite schema migration` (`migrations.ts:206`). Host exits with code 1, and Desktop shows only the generic “Local service exited unexpectedly.” There is no backup logic.
- A conversation with status `running` or `waiting` (awaiting approval) always has an `activeTurnId` (`packages/protocol/src/records.ts:172`). Snapshot `activeTurns` counts only `running`, excluding conversations awaiting approval.
- The About page, `apps/web/src/components/settings/about-settings.tsx`, does not display a version.
- The release script, `apps/distribution/src/build.mjs`, requires a clean HEAD and writes installers to `output/release/<commit>/`. It does not sign updates.

## 3. User Flow

1. Check approximately one minute after startup and every six hours thereafter. The About page also supports a manual “Check for updates.”
2. When an update exists, show a small dot beside “About and Checks” in Settings navigation. The version row at the top of About displays the new version and release notes. Do not send a system notification.
3. When the user clicks “Update to x,” perform the following.
   - Download, display progress, and verify the update signature.
   - If no conversations are active, close the local service, install, and reopen CodeTether.
   - If conversations are active, remain at “Downloaded, waiting for conversations to finish.” Enable the button only after all active conversations finish. The user then clicks “Restart and update.”
4. After reopening, About shows “Updated to x.” Updating does not interrupt running AI tools. Once phones and tablets are supported, they will disconnect briefly during updates.

## 4. About Page Version Row

Place the version row in the first card on the About page, below the CodeTether name.

| State | Text on the Left | Button on the Right |
| -------------------- | ----------------------------------------------------------------------- | ------------------------ |
| Updates not configured in this build | Version 0.1.0-alpha.3 · Automatic updates are not configured in this build | None |
| Up to date | Version x · You are up to date · Last checked 3 minutes ago | Check for updates |
| Checking | Version x · Checking for updates… | Check for updates (disabled) |
| New version available | Version y is available (current x), with plain-text release notes below, up to 6 lines with expansion | Update to y |
| Downloading | Downloading y · 42% | None |
| Downloaded, conversations active | Downloaded y. Two conversations are running or awaiting approval. Update after they finish, without interrupting them. | Restart and update (disabled) |
| Downloaded, ready to update | Downloaded y. CodeTether will close for a few seconds during the update, then reopen automatically. | Restart and update |
| Updating | Closing the local service and installing y… | None |
| Check failed | Unable to check for updates right now. Try again later. | Retry |
| Download failed | Downloading y did not finish. Please retry. | Retry |
| Invalid signature | The download failed verification and was not installed. Try again later. Contact us if it keeps failing. | Retry |
| Installation failed | The update did not finish. The current version remains usable. | Retry |

- Display release notes only as plain text. Do not interpret HTML or Markdown links. Truncate notes beyond 2,000 characters.
- Count active local conversations by status `running` or `waiting`, rather than relying only on `activeTurns`.

## 5. Technical Design

### 5.1 Update Logic Lives in Rust

- Use `tauri-plugin-updater`, pinned to a version compatible with Tauri 2.11.5, and invoke it only from Rust. Do not install the web-side `@tauri-apps/plugin-updater` or grant any `updater:*` permissions to the web app.
- Add four application commands. The web app cannot provide addresses, public keys, or paths.
  - `update_state` returns the current state from the table in §4.
  - `update_check`.
  - `update_download` accepts only a Channel for progress reporting.
  - `update_install`.
- Keep the state machine in Rust. Retain the downloaded installer only in memory, requiring another download after restarting CodeTether.
- Schedule checks in a Rust background task, independently of web-view suspension. macOS suspends web content when the window is minimized.
- Do not use the process plugin. Restart through Tauri core's `AppHandle::restart`.

### 5.2 Update URL and Public Key

- Read these environment variables at compile time using `option_env!`, following the Control Plane address pattern.
  - `CODETETHER_UPDATE_BASE_URL`.
  - `CODETETHER_UPDATE_PUBKEY`.
- Enable updates only when both exist. If either is missing, show “Automatic updates are not configured in this build.” Ordinary `desktop:build` and development builds are therefore unaffected.
- Always check `<base>/alpha/latest.json`. Release builds accept only HTTPS. HTTP is available only for local testing in debug builds.
- Requests contain only version, platform, and architecture, with no account token or project or conversation information.

### 5.3 Installation Sequence

1. The web app confirms that no conversations are `running` / `waiting`, then calls `update_install`.
2. Rust shuts down Host normally using the existing `shutdown_owned_host` (12 seconds). If shutdown fails, abandon the update, restart Host, and enter “Installation failed.”
3. Once Host has stopped, invoke plugin installation.
   - On Windows use `passive` mode. NSIS displays a progress bar, then reopens the application automatically.
   - On macOS replace the .app, then call `restart`.
4. A race remains if a turn starts between steps 1 and 2. As with quitting CodeTether today, it is recorded as `host_restart` on the next launch, without being lost. Document this behavior.

### 5.4 Database Backup Before Updating (Owned by Host)

- Before opening the database, Host compares the data directory's `host-product-version` marker with its own product version. Use the semantic version, rather than the Git build ID.
- If the versions differ and the database already exists, perform the following.
  - Copy `codetether.sqlite3`, `-wal`, and `-shm` unchanged into `backups/<UTC-time>-<old-version>/`, then fsync before proceeding.
  - Retain only the three most recent backups.
  - Write the new version marker only after successful migration.
- If copying fails, do not start. Report a specific cause, such as insufficient disk space, and preserve the original database.
- Back up only database files. Do not copy `machine-credentials` or other credentials.
- This ensures that every version change triggers a backup, including one-click updates, manual reinstalls, and Mac app replacement.

### 5.5 Returning to an Older Version

- When Host detects an unknown database migration, exit with a dedicated code instead of 1 and write one fixed reason line to stderr.
- Add a corresponding Desktop startup-failure type with the message “This local data comes from a newer version of CodeTether and cannot be opened by this version. Install a newer version or follow the instructions to restore the backup from before the update.”
- Document restoration in `apps/desktop/README.md`. Quit CodeTether, copy the three backup files back into the data directory, then open the older version.

### 5.6 Version Numbers

- The root `package.json` is the single source of truth.
- Inject `PRODUCT_VERSION` at build time instead of hardcoding it.
- Add a version-setting script that synchronizes `Cargo.toml`, `Cargo.lock`, and `apps/desktop/package.json`, with a test checking consistency.
- U1 uses version `0.1.0-alpha.3`. The updater compares semantic versions, so every subsequent release must first increase the version.

### 5.7 Release Artifacts and Hosting

- Generate update artifacts only when all four environment variables exist. Check only for their presence, without printing values.
  - `TAURI_SIGNING_PRIVATE_KEY`.
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
  - `CODETETHER_UPDATE_BASE_URL`.
  - `CODETETHER_UPDATE_PUBKEY`.
- Each platform produces an installer, a `.sig` signature, and an `update-<platform>.json` fragment containing only that platform.
  - Windows uses the NSIS installer.
  - macOS uses `.app.tar.gz`.
- `release:update-manifest` merges platform fragments into `latest.json`. If a platform has not been uploaded, omit it from `latest.json`. That platform shows “You are up to date” instead of an error.
- The directory layout is `<base>/alpha/latest.json`, with installers under `<base>/alpha/<version>/`. An agent may handle uploading.

### 5.8 Invariants

- The web app cannot initiate downloads or installations from arbitrary addresses. Installation requires a verified signature.
- Keep the signing private key out of the repository. For testing, the agent generates a disposable key outside the repository and deletes it afterward.
- Do not print credentials or keys or include them in reports.

## 6. Risks Requiring Real-Device Testing

- The Windows install directory is also the data directory. Verify in tauri-bundler's NSIS template that update installation and uninstallation preserve the database, `backups/`, and `machine-credentials`. Confirm which directory the uninstall “Delete application data” checkbox removes.
- The Windows installer lacks code signing. Test whether downloading and running it from the app produces a SmartScreen warning and capture screenshots.
- macOS ad-hoc signatures change on every build. On your Mac, test whether notification permission survives an update and whether LaunchServices adds a duplicate registration.
- The first update requires manual installation. Existing alpha.1 / alpha.2 builds have no updater. Install alpha.3 manually once, then release alpha.4 to test an actual one-click update.

## 7. Decisions Needed from You

1. Update hosting was decided on 2026-11-01 as us-vps-01. The tentative base URL is `https://codetether.org/updates`, giving a check URL of `https://codetether.org/updates/alpha/latest.json`. Website source exists only on the VPS. You upload and maintain this directory, and the coding agent does not log into the VPS. You may change the exact path, which determines only `CODETETHER_UPDATE_BASE_URL`.
2. Generate the update signing private key on your own computer with Tauri CLI's `tauri signer generate`. Store it outside the repository with a password. Provide the public key for the release documentation. The coding agent will include commands directly usable on this computer in its report.
3. After implementation and review, manually install alpha.3, release alpha.4, and perform one update each on Windows and Mac.
