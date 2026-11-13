# Task: Rotate the Control Service's Database Connection Credentials

Run on Windows, using SSH for server operations. This is production operations work. Do not change repository code or commit. References: the B0 report `D:/Projects/Software/agenthub-archive/b0-report.md` (control-service deployment, backup, and rollback), and "Credential incident" in the T1a report `D:/Projects/Software/agenthub-archive/t1a-report.md`.

Before starting, confirm this file has 4 second-level headings and the final section is "Report".

## Goals

During T1a, panic output from an NDK smoke test wrote inherited environment variables to tool records and local logs, including the database credentials in `CODETETHER_CONTROL_PLANE_DATABASE_URL`. The local log has been overwritten, but the tool record cannot be withdrawn, so treat the credential as exposed. The also-exposed `SUPABASE_PUBLISHABLE_KEY` is intentionally public to clients and does not need rotation.

Required outcomes:

1. **Determine the credential's scope**. Identify the database role and every consumer, including the control service, migration scripts, and local test/build scripts. Inspect only the username and hostname. Do not view or print passwords.
2. **Determine the source of exposure**. Find why Windows Android-build subprocesses inherited the variable, such as user/system environment variables, an automatically loaded file, or a startup script. Production database credentials do not belong in the development machine's global environment.
3. **Replace the password**. Invalidate the old password and configure the control service with the new one.
4. **Confirm recovery**. The control service runs normally, `healthz` and `readyz` return 200, Host presence publications from both computers return 2xx, and database connections using the old password fail.
5. **Remove unnecessary copies**. Delete or move copies that should not be local, remove the source identified in item 2, and tell the user where the new credential remains stored.

## Known Facts

- The control service runs on us-vps-01, managed by `codetether-control-plane.service`, under user `codetether`, with working directory `/opt/codetether/control-plane/current/apps/control-plane` (B0 report).
- The database is Supabase PostgreSQL 17. The service verifies certificates through `NODE_EXTRA_CA_CERTS=/etc/codetether/supabase-root-2021-ca.pem`. Preserve this verification chain and keep TLS verification enabled.
- Two password scenarios are possible:
  - The connection uses Supabase's main database password. It must be reset in the Supabase console by the user personally and affects every consumer of that password.
  - The connection uses a separate role. An authorized connection can change it through `ALTER ROLE`.
  - Identify the scenario and inform the user before choosing a procedure.
- New password: generate a sufficiently long random value and write it directly into the server's control-service configuration, without terminal echo, command-line arguments, logs, or local files.
- Cutover impact: restarting the control service interrupts login, device registration, pairing, and Host presence publication for several seconds. Relay and established direct/Relay connections are unaffected.
- SSH has previously timed out during banner exchange. Avoid leaving a partial cutover on an unstable connection. Back up configuration and prepare the new configuration first, then change the password, configuration, and restart in one connection.

## Boundaries

- **Decide independently**: methods for tracing scope and source, backup/cutover procedures, and verification methods.
- **Ask the user first**:
  - Before changing the password and whenever the user must operate the Supabase console.
  - Before restarting the control service.
  - Before deleting local files or changing Windows user/system environment variables.
  - If any service other than the control service uses the credential.
- **Do not**:
  - Read, print, or copy passwords, complete connection strings, tokens, or private keys. Logs and reports may show usernames and hostnames only.
  - Change database schema/data, control-service code, or other configuration.
  - Touch other services on the server.

On failure, restore the original configuration using B0's rollback procedure, verify service recovery, then inform the user. Once the old password is invalid, rollback means returning configuration to a working state rather than restoring the old password.

## Report

Write to `D:/Projects/Software/agenthub-archive/db-credential-rotation-report.md`:

- Role name, hostname, and credential consumers.
- Source of exposure and how it was handled.
- Password-change mechanism (console or `ALTER ROLE`) and who performed it.
- Backup location and rollback procedure.
- Verification results for goal item 4.
- Remaining locations storing the new credential.
- Unfinished work and reasons.
