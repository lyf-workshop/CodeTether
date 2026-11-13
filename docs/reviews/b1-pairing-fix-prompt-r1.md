# Task: B1 review fixes and additional Windows testing (round 1)

Run on this Windows computer. Worktree `D:/Projects/Software/agenthub-b1-pairing`, branch `b1/pairing-remote-control` (currently `955d567`). References: design `docs/ux-redesign/06-pairing-remote-control.md` and previous report `D:/Projects/Software/agenthub-archive/b1-report.md`.

Before starting, confirm that this file has four second-level headings and that the final section is "Report".

## Goals

### A. Fix issues found in review

Add tests for every item that fail before the fix and pass afterward.

1. **The Host decides whether to renew.** Currently `local-supervisor-presence.tsx:124-131` signs for every device marked `renewalEligible` by the control service. `renewPairedDevice` (`pairing-client.ts:402`) and `signAuthorization` (`:484`) check only identity fields. If the control service malfunctions or is compromised, the Host renews a removed device for 31 days.
   - Before signing, verify locally that an active grant exists for this device, with matching `deviceFingerprint` and `deviceKeyGeneration`; pairing has not been revoked locally; and fewer than 15 days remain, or it has expired and meets the re-signing conditions in 06 section 3.3.
   - If these conditions fail, do not sign. Renewal for other devices must remain unaffected.
2. **The reconciliation loop must not restore a local revocation.**
   - `activate` (`supervisor-transport-manager.ts:710`) ignores the local revocation table, so the reconciliation loop can reactivate revoked grants. If control-service revocation fails (a network error during removal), the devices page and local state disagree.
   - `disableDevice` (`:1127-1134`) disconnects only when the revocation record is first inserted. Retrying removal will not disconnect a connection that was reactivated in between.
   - Change this so revoked pairings cannot be reactivated and every validated revocation disconnects the device. Pairing the same device again with a new pairing root must still work. Grants contain no pairing-root ID, so decide how activation should establish this.
3. **Tell callers when `attention.list` is truncated.** `supervisor-operations.ts:98` uses `boundedRows` to discard excess items but does not return `truncated` as `conversation.recent` (`:86`) does. Callers receive totals that disagree with the items. Update the protocol schema and client together.
4. **Issue control grants only for authorizations the Host itself signed.** On `main`, `reconcileSupervisorGrantSnapshot` (`remote-supervisor.ts:396-457`) signs grants only for `supervisor_read`. This branch extends it to `supervisor_control`: when the control service lists an authorization with an empty `grant`, the web app signs it with the Host key. The control service does not retain the authorization's Host signature, so the Host cannot confirm that it signed that control authorization during pairing or renewal.
   - Restrict control-grant signing to authorizations backed by local evidence. For example, record authorization IDs signed by the Host, or have the control service retain and return the Host signature for verification. Choose the approach.
   - If the control service changes, follow the previous backup, deployment, and rollback procedure.

### B. Smaller issues

5. `boundedChanges` (`supervisor-operations.ts:51-57`): if the first item at an offset still exceeds the budget after removing its diff, it returns 503 and callers can never page past it. Allow pagination to continue, for example by retaining only the path and counting the omission.
6. The comment at `supervisor-operations.ts:17` says Supervisor uses the same 16 KiB frames as Machine. Its actual limit is 256 KiB. Correct the comment; the 12 KiB budget may remain.

### C. Additional Windows testing (unfinished items from 06 section 4)

7. Three writes through the public Relay: `attention.resolve`, `approval.resolve`, and `turn.interrupt`, plus the 409 response for `conversation.archive`. Use dedicated test projects and Turns, preserving existing conversations and Attention items.
8. On the diagnostics page, AI tools without approval and stopping support must not show either button.
9. Production renewal and re-signing: pair a new test authorization, shorten its expiry in the control service, and verify that the 60-second loop renews it. Then let it expire, restart the development build, and verify re-signing. Back up those rows before modifying them, change only this test authorization, and revoke it after testing.
10. Record the error classification when a reconnect is rejected after removal. The previous round did not capture it.

After all items pass, push `b1/pairing-remote-control` to origin for Mac acceptance.

## Known facts

- Previous gates all passed: `pnpm test` had 2,404 tests with zero failures; desktop `cargo test` passed 80 tests.
- The production control service runs `af3a607`, migrated through 0009. Rollback link `/opt/codetether/control-plane/.b1-20261102-01-rollback`; deployment instructions are in `b1-report.md`.
- Public testing requires temporarily allowing CORS for the development origin `http://127.0.0.1:5173`. Use the previous scripts (`b1-logs/control-plane-test-origin*.py`) and restore afterward.
- Development launcher `b1-logs/windows-dev-launch.mjs` uses the isolated data directory `D:/Projects/Software/agenthub-work/b1-check-data`. Both builds use 4317. Exit the installed build from the tray first, then reopen it after testing.
- After builds, `Cargo.toml` and 15 `permissions/autogenerated/*.toml` files may appear modified while matching the index byte-for-byte (CRLF). In that case restore them with `git checkout --`.

## Precautions

- Never print credentials or include them in the repository or report.
- Back up production data before changing it, and modify only test authorizations.
- Gates: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and desktop `cargo test`.

## Report

Write `D:/Projects/Software/agenthub-archive/b1-fix-report-r1.md`. Put long output in `b1-logs/`.

- What changed for each item and which tests were added; the approach selected for item 4 and its rationale;
- Results and logs for every additional test;
- Deployment, backup, and rollback details if the control service changed;
- Commit list, gate results, and push result;
- Incomplete work and its reasons.
