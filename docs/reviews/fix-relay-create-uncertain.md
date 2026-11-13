# Review record: fix/relay-create-uncertain

Date: 2026-11-07. Reviewed `e4bdd57` on `origin/fix/relay-create-uncertain` against `fd1d905`. Task: `docs/reviews/relay-create-uncertain-fix-prompt.md`. Execution report: `D:/Projects/Software/agenthub-archive/relay-create-uncertain-report.md`.

## Round 1

Conclusion: no required changes.

Only `apps/relay/src/supervisor-rendezvous.ts` and its integration tests changed.

Verified and correct:

- **First half of the original race**: after receiving ack, Relay awaited forwarding it to the original sender before clearing the unacknowledged sequence. The sender could send the next chunk before clearing, causing `flow_control_violation` and channel closure. The fix clears before forwarding.
- **Second half**: Relay set the acknowledgement timeout after a forwarded chunk's write finished. If the recipient acknowledged before the write callback, the original code created a timeout after acknowledgement, later falsely expiring. The fix checks that the chunk is still unacknowledged and the channel unchanged before scheduling. There is no `await` between the check and `setTimeout`, so events cannot interleave.
- Opposite directions use different connections. Clearing before forwarding preserves ordering within each connection.
- All three clients allow one unacknowledged chunk at a time: `packages/relay-client/src/machine-channel.ts`, `packages/supervisor-transport/src/relay.ts`, and `packages/supervisor-mobile/src/relay.rs`, consistent with the fix's assumptions.

Impact: Relay server only. Host, desktop, Android, and iPad need no changes or reinstall. Production Relay must be redeployed (`codetether-relay.service` on us-vps-01); prompt `docs/reviews/relay-deploy-ack-fix-prompt.md`.

Recommended changes:

1. **The original vivo incident remains unattributed** because the installed Windows build retained no Host diagnostics. Clarify where diagnostics added in `fd1d905` are written in installed builds and whether they remain inspectable afterward, or future physical-device failures will still lack explanations.
2. **Use production Relay logs to attribute the original incident**: if channel-close reasons are logged, look for `flow_control_violation` at the vivo retest times. The deployment prompt requires this pre-deployment check.
3. Integration tests were reviewed for coverage scope, without verifying individually that they reproduce the races reliably.
