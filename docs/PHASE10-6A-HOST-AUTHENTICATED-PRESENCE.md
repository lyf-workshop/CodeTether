# Phase 10.6A — Host-authenticated presence

Owner-authorized implementation from `2e153879c7793edbac539d25802609ee4b4e0f3e`.
Implementation and isolated validation only; no production/client deployment,
identity, authorization, or Provider execution changes.

## Signed envelope audit

Existing canonical ES256 JWS type: `codetether-host-supervisor-transport+jws`.
Every field is signed: `v`, `aud`, `purpose`, `hostId`, `hostFingerprint`,
`hostIdentityGeneration`, `spaceId`, `transportTlsFingerprint`,
`controlPlaneOrigin`, `directEndpoints` (each host/port), `relay` (endpoint,
relayId, relayFingerprint, rendezvousId, rendezvousCapability,
hostTransportFingerprint), `iat`, `exp`, `protocolVersion`. No nonce/sequence.
Proof version stays 1; Host presence protocol stays 2; no new key/signature format.

## Narrow authentication and replay

Previously POST `/v1/hosts/:hostId/supervisor-host-presence` required user JWT,
ProductDevice proof and Host signature. Now ONLY that operation uses Host JWS
authentication. Account/device/claim/authorization/admission APIs retain user
and ProductDevice authentication. A Host signature cannot manage authorizations,
read workspace data, control another Host, or obtain user credentials.

Server locks the canonical Host row for the publication transaction. It verifies
claimed/non-revoked status, owning Space, active generation, route Host ID,
fingerprint and the stored canonical Host public key. Never a client-supplied JWK.
Signed issue time must be within ±120 seconds; `exp > iat`, `exp > now`, and
`exp-iat <= 600 seconds`. Strict schemas bound protocol/descriptors, 8 endpoints,
8192-byte proofs and 48000-byte HTTP bodies.

Old server already stored absolute signed expiry, not a receipt-time fresh lease.
New validation additionally bounds duration against signed issue time. Captured
payloads never extend beyond their signed expiry. Repeated/older issue times and
expiries cannot overwrite a newer row or advance updated_at. Only a higher active
canonical generation can replace obsolete-generation presence. No nonce table
or Control Plane migration is needed.

## Host ownership and secure signing

SupervisorTransportManager owns one HostPresencePublisher for a registered,
enabled Host with public claim context. It restores the SAME identity, publishes
immediately, renews every 2 minutes for a 10-minute lease, retries from 1 second
to a bounded 60 seconds and coalesces native wake/network recovery. Shutdown
aborts timers/signing/HTTP. Controller-only/unregistered/disabled installations
have no publisher. No React, TanStack Query or WebView timer owns this worker.

Host signs over its owned parent pipe; native background Desktop invokes the
existing CNG/Secure Enclave Host key. This is NOT renderer IPC. Native validation
allows only exact presence purpose/type, bounded reconstructed canonical JWS
bytes, Host-only key handle, matching public fingerprint/generation and
non-exportability. Requests are intercepted before normal log forwarding.
No user refresh token, password, cookie, ProductDevice private key, raw key export
or new key is introduced. Signed requests/Relay capabilities are never logged.

Local SQLite migration 23 is additive: public Space/origin/enablement context and
runtime-enabled flag on existing grants. No identity/grant is rewritten. Upgrade
can derive context from a verified existing Host-signed grant plus supported
public Control Plane URL. Otherwise normal authenticated owner setup configures
public context once; claimed Hosts with no local grants need that one-time step.
After context is durable, restart/session/renderer disappearance needs no owner
action. Production passes public URL into Host from existing build configuration.
HTTPS is required outside loopback development; redirects are not followed.

UI coordinator now reconciles OWNER grants only, consumes the Host's signed
descriptor and cannot publish a cloud lease. Runtime restores verified existing
grants without making cloud authorizations; pruned grants stay disabled through
renewal/restart. Each incoming session retains cloud revocation admission.

Presence and Relay have separate workers. HTTP failure does not kill Relay;
Relay retry does not kill Presence. Existing native resume and bounded retry
recover after real OS sleep; expiry while asleep is legitimate. No power policy,
inbound firewall rule, public Supervisor port or Relay protocol change.

## Logout and server ownership

Interactive token expiry cannot kill claimed Host liveness. Current product
sign-out signs out the UI account without unclaiming/disabling Host; this state
is preserved. A future logout-to-disable policy requires a product decision.
Explicit local disable stops the worker (last signed lease naturally expires).
Server unclaim/revocation rejects further publications.
Periodic UI grant reconciliation omits enablement and preserves a durable disabled
state. Only an explicit `enabled: true` action can re-enable it.

Security review conclusions: a ProductDevice signature cannot impersonate a Host;
Host A cannot publish Host B's lease; obsolete generations fail; captured signatures
cannot refresh signed expiry; Host-authenticated presence grants no general account
API access. The Host signing pipe receives no account/refresh token, ProductDevice
private key or Secure Enclave wrapped key representation.

## Evidence and deployment handoff

### Local readiness versus background health

Source-proven dependency: LocalProviderLifecycleCoordinator.create awaited both
installation/backend probes BEFORE HTTP/Supervisor assembly. Current probe success
is not required for cold local reads. Pending coordinator restores last-known
installation metadata and unavailable/no-execution runtimes; discovery runs AFTER
LOCAL_READY through the existing serialized Host handoff/commit/discard path.
It cannot enable execution early. Shutdown aborts/joins probes before closing
SQLite. The native 15-second timeout is unchanged. Historical physical timeout
attribution remains unproven beyond this blocking dependency.

Safe monotonic diagnostics cover native Desktop/child launch, Host process,
SQLite, existing Host record, Supervisor/API listeners, optional Relay/Presence
startup and Provider discovery. ProductDevice restore belongs to native/client
identity and is not falsely reported by Host SQLite. Tests use ephemeral ports
for the same services, NOT installed physical 4317/4318 processes. Three isolated
Windows runs held discovery unresolved for 1200 ms after healthy APIs; LOCAL_READY
was ~96/63/79 ms and Supervisor listener ~93/63/77 ms. These are not new installed
Desktop/CNG/production Relay startup acceptance. Cloud session, Relay registration
and Presence success are BACKGROUND_HEALTHY, not local launch prerequisites.

Isolated tests use synthetic identities, temporary SQLite/Postgres and ephemeral
ports. Deterministic clock tests cover renderer disappearance, hidden duration
beyond lease, retry/backoff/wake, disable and shutdown. Runtime fixtures restore
Windows/macOS public identity profiles and existing grants without a renderer.
These are NOT a new physical macOS Secure Enclave/hidden-window acceptance.
Historical Mac expiry process/renderer/sleep/Relay/session evidence is UNKNOWN.
machine.get HTTP 500 stays a separate follow-up.

### Final implementation verification — 2026-10-07

Branch: `phase10/host-authenticated-presence`.
Presence implementation: `29d36eab2e7052d351c92bff7448f7ae412441aa`.
Startup/final wiring hardening: `670d831ac2335da8d9c64214217ae5b51444b337`.
Use the final branch HEAD containing BOTH commits, never an intermediate binary.

`pnpm typecheck`, `pnpm lint`, `pnpm build`, `git diff --check`,
`cargo fmt --check` and Windows `cargo check`: PASS.
Final root `pnpm test`: 1843 tests, 1829 PASS, 0 FAIL, 14 skipped.
Host: 544/544; Web: 455/455; Control Plane: 92 PASS/1 skipped;
Supervisor: 6/6; Relay: 56/56. Focused Host ownership/transport suite: 14/14.
Native purpose-limited pipe integration target: 2/2 PASS. Full Rust lib tests
were not claimed; the separately known baseline test-module import defect is
out of scope. Compiler dead-code and frontend bundle-size/import warnings remain.
13 root skips are existing Windows/POSIX platform restrictions; 1 is the absent
explicitly isolated native PostgreSQL URL. Embedded PostgreSQL contract tests ran.

Latest three Windows isolated Host runs (milliseconds):

| Phase                     |   Run 1 |   Run 2 |   Run 3 |
| ------------------------- | ------: | ------: | ------: |
| Local SQLite open         |   37.14 |   34.40 |   31.00 |
| Supervisor listener       |   64.87 |   45.05 |   40.78 |
| Product API listener      |   67.39 |   45.59 |   41.35 |
| LOCAL_READY               |   67.40 |   45.59 |   41.36 |
| Background discovery done | 1327.34 | 1278.38 | 1273.80 |

These runs deliberately keep discovery unresolved after healthy API reads.
They use ephemeral ports and temporary local state, not installed Desktop launch
or physical CNG/Secure Enclave timing. Native ProductDevice/CNG restore timing and
production sleep/wake/renderer-destruction acceptance remain deployment gates.
The unchanged baseline missing-Codex integration test also passed in an isolated
`2e153879` worktree (~15.84 seconds total test), confirming that its old readiness
wait included real discovery. The new fixture uses deterministic empty scans;
slow-discovery semantics are tested separately, not hidden by a longer timeout.

During one preliminary startup test, inherited public Relay environment briefly
connected synthetic test registrations; all those connections closed in cleanup.
Final startup/managed smoke fixtures explicitly disable inherited production
Relay configuration. No canonical production identity, authorization, request or
Host claim was created/changed; no production deployment or Provider Turn occurred.

Pending: Owner review; deploy CP code first (migration head stays 0008); then build
and install reviewed exact Windows/macOS Desktop + Host with existing public
Control Plane/Relay config, preserving SQLite/platform keys/authorizations.
Local migration 23 follows normal upgrade. Verify physical background/reload/
restart/wake and existing bidirectional read-only access. Never repeat Request
Access/Allow, change scopes, or redeploy Relay for this change.
