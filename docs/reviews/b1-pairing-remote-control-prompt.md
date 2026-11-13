# Task: B1 pairing and remote control

Run on this Windows computer. The design is in `docs/ux-redesign/06-pairing-remote-control.md`, based on B1 in 03 sections 1.1 and 4 and A3-A6 in 04.

Before starting, confirm that this file has four second-level headings and that the final section is "Report".

## Goals

Implement 06.

1. Pairing by code (06 section 3.1): "Add device > Add phone or tablet" shows a six-digit code on the computer. Entering it on the new device completes pairing, and the computer automatically signs with the Host key.
2. One permission level (section 3.2): new authorizations use `supervisor_control`, which includes reads. Remove the local `/api/v1/supervisor/control/approve` and `host_supervisor_control` path.
3. Automatic renewal and re-signing (section 3.3).
4. Immediate disconnection after removal (section 3.4), including the new Host-signed revocation endpoint in the control service.
5. Automatic Relay configuration (section 3.5).
6. New remote operations (section 3.6). Gating, idempotency, and 409 behavior match local operations.
7. The "Phones and tablets" section on the devices page, the Add device window (section 1), and corrected device platforms (section 3.7).
8. Add pairing-code input to development diagnostics `#/dev/supervisor-check` to test as a new device.

Then deploy the control service and migration 0009 to us-vps-01. Follow the deployment and rollback procedures in the B0 report (`D:/Projects/Software/agenthub-archive/b0-report.md`).

Worktree and branch: create from `main`, for example branch `b1/pairing-remote-control` and worktree `D:/Projects/Software/agenthub-b1-pairing`. Decide how to split commits and whether to push.

## Known facts

- The control service signs nothing. The Host key signs authorizations and grants; the web app signs through Tauri `host_identity_key_sign` (`apps/web/src/runtime/account/control-plane-client.ts:822-856`, `remote-supervisor.ts:352-388`). Preserve this in the new flow.
- Database CHECK constraints allow only `supervisor_read` (migrations 0001:185 and 0007). Control-service schemas also hard-code that scope (`host-identity-service.ts:125`, `:924`, `:1285`).
- The Host currently determines control permission only from its local table (`supervisor-transport-manager.ts:296-298`), without checking the grant scope during connection (`packages/supervisor-transport/src/server.ts:667-677`).
- Lifetime constant `AUTHORIZATION_LIFETIME_MS` is in `host-identity-service.ts:143`. Renewal does not exist yet.
- The 60-second cleanup loop is at `local-supervisor-presence.tsx:23`; `activations/prune` closes connections (`server.ts:286-293`). Add renewal and re-signing to that loop.
- Reusable local functions are in `apps/host/src/api/host-service.ts`: `archiveConversation`:3137, `interruptTurn`:4167, `resolveApproval`:4278, `resolveAttention`, and `listAttention`:3186.
- Node pairing-code generation and constants can be reused (`packages/machine-transport/src/pairing-code.ts`, `constants.ts:31-33`). Validation belongs in the control service, persisted in Postgres; see 06 section 3.1.
- Relay values are in 06 section 3.5. Pass them to the Host following the control-service URL pattern in `host_supervisor.rs:265-271`. Confirm that `build.rs` recompiles when those variables change.
- Desktop platforms are hard-coded in `control-plane-client.ts:396-402`.
- Existing read-only Windows and Mac authorizations have expired. Keep them as historical records; no migration is needed.
- Both builds use port 4317. Exit the installed build before development testing, and use an isolated data directory.

## Precautions

- Never print credentials (database connection strings, Supabase keys, private keys), or include them in the repository or report.
- Back up the `control_plane` schema before deployment and document rollback. Migration 0009 only broadens CHECK and adds a pairing-session table. Roll back by restoring the old code, leaving the table in place.
- Never store pairing codes in plaintext. Attempt limits, one-time use, and expiry are enforced server-side and covered by tests.
- After deleting the old grant endpoint, verify that no other web-app location still calls it.
- Gates: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and desktop `cargo test`.
- Follow the user-facing wording in 06 section 1, without internal terminology.

## Report

Write `D:/Projects/Software/agenthub-archive/b1-report.md`. Put very long output in `b1-logs/`.

Include the following.

- Implementation of each goal;
- Migration and deployment procedure, backup locations, and rollback;
- Results for every acceptance item in 06 section 4; complete everything possible on Windows, and list the Mac actions so I can write a separate prompt;
- Branch and commit list;
- Incomplete work and its reasons;
- Differences from 06 introduced during implementation, and their reasons.
