# Phase 10A — Cross-Network Host Authorization

Phase 10A replaces the Phase 9C same-LAN authorization helper with a
Control-Plane-mediated workflow:

1. The requesting ProductDevice discovers the account-owned Host and submits a
   bounded `supervisor_read` access request over HTTPS.
2. The Host owner sees the pending request in CodeTether and chooses Allow or
   Deny.
3. Allow causes the local Windows Host to sign the existing authorization
   payload with its non-exportable Host key. The private key never leaves the
   Host.
4. The Control Plane verifies the request, generations, fingerprints, scope,
   challenge, and Host signature, then creates the normal
   `host_device_authorizations` record.
5. The requesting ProductDevice observes the same authorized Host directory
   used by the existing Supervisor read transport.

The Mac and Windows devices do not need to share a LAN. The authorization
workflow does not open a Windows listener, use port `4331`, or use Relay as an
authorization authority. Relay remains only the existing opaque Supervisor
transport after authorization is active.

## Phase 9C temporary helper retirement

The old Windows validation helper is disposable infrastructure. After a real
Phase 10A acceptance, the Owner should perform the following on the Windows
machine:

- stop the temporary `mac-authorize`/LAN helper process;
- remove the temporary inbound TCP `4331` firewall rule;
- remove temporary served authorization files and helper artifacts;
- preserve the production Host identity, ProductDevice identity, Host key,
  Control Plane authorization records, and CodeTether installation.

This cleanup is intentionally not automated from macOS and must not be run
against an inaccessible or unrelated Windows machine. Reusable test fixtures
and documentation remain in the repository; only the physical validation
artifacts and firewall exception are removed.

Phase 10A does not grant `supervisor_control`, start a Provider, create a
Conversation, or send a Codex/Claude turn.
