# Task. B0 remote access go-live (deploy Control Plane migration 0008 and public Relay, then verify forced Relay)

Run on this Windows computer and access us-vps-01 through SSH. References are B0 at the top of `docs/ROADMAP.md`, §§4 and 6 of `docs/ux-redesign/03-project-plan.md`, `docs/PHASE10A1-MULTI-DEVICE-SUPERVISOR-TRANSPORT.md`, `docs/PHASE9B2-REMOTE-HOST-SUPERVISOR.md`, `apps/control-plane/README.md`, and `apps/relay/README.md`.

Before starting, confirm this file has five second-level headings and the last section is "Report".

## Goals

1. Update the Control Plane on us-vps-01 to `main` and migrate the database to 0008.
2. Deploy a public Relay reachable from outside the network.
3. Configure Relay for the Host on this Windows computer and bring Relay presence online.
4. Provide a development diagnostic page for forced-Relay read-only verification. Mac cross-device validation will have its own prompt and is outside this task.

Choose the implementation and order based on actual server conditions. Deployment, server configuration changes, commits, and branch pushes are authorized.

## Known facts

- **No desktop repackaging is needed.** Phase 10A and 10A.1 code is already on `main` (`454f414`). The installed `v0.1.0-alpha.2` (`0f624ae`) includes all relevant Control Plane, Relay, and Host changes, and those applications have not changed since.
- **Migration 0008** (`apps/control-plane/migrations/0008_host_supervisor_presence.sql`).
  - It adds only `control_plane.host_supervisor_presence` and one index. There is no rollback script, and the table does not affect old code.
  - `runMigrations` executes it automatically at startup, or `migrate` can run separately. It runs in a transaction, records each file's SHA-256, and rejects a mismatch between file content and the recorded checksum.
  - Deployment documentation only records migration 0006. Migration 0007 is likely already deployed.
- **Inspect how the Control Plane runs on the server.** It listens only on loopback, defaults to port 4320, and is exposed as api.codetether.org by a reverse proxy. Its deployment configuration is not in the repository.
- **Relay cannot run behind an HTTP reverse proxy.** It uses native TLS with ALPN `codetether-relay/1`.
  - If the website or API already occupies 443, options include the following.
    - A separate public IP.
    - A separate port such as 8443.
    - Layer-4 SNI routing in front of the existing ingress. This changes website and API ingress, so ask the user before choosing it.
  - The repository contains systemd unit `apps/relay/deploy/codetether-relay.service` and configuration template `relay.config.public-ca.example.json`.
  - Do not expose management port `127.0.0.1:9443` publicly.
  - Relay generates a random identity on first startup. Deleting `/var/lib/codetether-relay` changes that identity, so back it up.
  - Restart Relay after certificate renewal.
- **The Host reads Relay configuration at runtime.** Set either all or none of `CODETETHER_SUPERVISOR_RELAY_ENDPOINT`, `CODETETHER_SUPERVISOR_RELAY_ID`, and `CODETETHER_SUPERVISOR_RELAY_FINGERPRINT` (`apps/host/src/api/supervisor-transport-manager.ts:1197`). Verify that Desktop passes them when starting the Host (`apps/desktop/src-tauri/src/host_supervisor.rs`).
- **The forced-Relay switch no longer exists.** `8ddf668` removed it along with the v3 UI.
  - No web code calls `connectRemoteSupervisor` anymore (`apps/web/src/runtime/account/remote-supervisor.ts:408`).
  - The Host's `/api/v1/remote-supervisor/connections` still accepts `forceRelay` (`apps/host/src/api/local-http-server.ts:154`).
- **The old Relay's status is unknown.** A Relay previously ran on Alibaba Cloud (build `git-2b1a67606f24`). Report it if found, without changing it.
- **Database connection.** You may read the server's Control Plane environment file to obtain the connection string for backup and querying `control_plane.schema_migrations`. Do not print the connection string.
- **Do not use smoke for post-deployment checks.** `pnpm --filter @codetether/control-plane smoke:supabase-postgres` is not read-only. It runs migrations and writes test data before rolling back (`apps/control-plane/src/native-postgres-smoke.ts:275`). Its `expectedTables` allowlist (line 11 of the same file) also omits 0007's `host_access_requests` and 0008's `host_supervisor_presence`, so it will fail on an already migrated database.
  - Add both tables to the allowlist on the branch and add a test.
  - Use `/healthz`, `/readyz`, and a `schema_migrations` query for post-deployment checks.
- **SSH.** SSH access to us-vps-01 should already be configured on this computer. If a password or passphrase is required, provide the command as `! …` for the user to run.

## Diagnostic page

- Implement on a new branch such as `b0/relay-go-live`, with the worktree at `D:/Projects/Software/agenthub-b0-relay-go-live`.
- Include the page only in development builds, for example `#/dev/supervisor-check`. Exclude it from production builds.
- Reuse `connectRemoteSupervisor`. Let the user choose a Host under the same account and then "Automatic" or "Relay only".
- Sequentially make read-only calls to `host.bootstrap`, `machine.list`, `machine.get`, `project.list`, `conversation.list`, `conversation.get`, and `conversation.history`.
- Show success, direct or relay transport, duration, and error type for each step. Do not display conversation titles, prompts, or paths.
- The page is read-only. Do not create conversations, send messages, or request `supervisor_control`.
- Gates are `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`.

Development and installed builds both use port 4317. Exit the installed build before development testing and use a separate data directory, such as `CODETETHER_DATA_DIR=D:/Projects/Software/agenthub-work/b0-check-data`.

## Notes

- **Backups.** Back up the following before changes and document rollback.
  - The Control Plane's `control_plane` schema.
  - The current code directory and process configuration.
  - Relay state and configuration.

  Copy the backups to `D:/Projects/Software/agenthub-archive/b0-backups/`. The Relay state backup contains a private key and belongs only in this directory.

- **Credentials.** Never print database connection strings, Supabase keys, or certificate private keys, or write them to the repository, logs, or report. `relayId` and `relayFingerprint` are public and may be recorded.
- **Other server projects.** us-vps-01 also hosts the website and other projects. Ask before actions affecting them, such as changing website or API ingress, restarting their services, or deleting data. After deployment, verify they are as healthy as before.
- **Authorization.** Preserve existing authorization `hauth_e6c2bb245dac4a12820a66237b30a093` and Host identity. If verification finds an unexpected identity, authorization generation, or scope, stop and investigate.
- **Phase 9C temporary LAN helper.** Retirement steps are in `docs/PHASE10A-CROSS-NETWORK-HOST-AUTHORIZATION.md:24-39`. List what remains on this computer in the report and let the user decide when to clean it up.

## Report

Write to `D:/Projects/Software/agenthub-archive/b0-report.md`. Put lengthy command output in `D:/Projects/Software/agenthub-archive/b0-logs/`. Remove credentials when organizing logs while preserving error lines.

Include the following.

- Actual server conditions, including how the Control Plane runs, the pre-deployment migration version, and who occupies 443.
- Chosen Relay port arrangement and rationale.
- Actions at each step, verification commands, and results.
- Backup locations, SHA-256 values, and rollback method.
- Relay `relayId`, `relayFingerprint`, address, and certificate expiration.
- Windows Relay presence status and diagnostic page results.
- Branch name and commit list.
- Unfinished work and reasons.
