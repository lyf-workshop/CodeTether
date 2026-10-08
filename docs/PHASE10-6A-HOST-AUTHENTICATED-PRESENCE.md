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

## Evidence and deployment handoff

Isolated tests use synthetic identities, temporary SQLite/Postgres and ephemeral
ports. Deterministic clock tests cover renderer disappearance, hidden duration
beyond lease, retry/backoff/wake, disable and shutdown. Runtime fixtures restore
Windows/macOS public identity profiles and existing grants without a renderer.
These are NOT a new physical macOS Secure Enclave/hidden-window acceptance.
Historical Mac expiry process/renderer/sleep/Relay/session evidence is UNKNOWN.
machine.get HTTP 500 stays a separate follow-up.

Not executed: review; deploy CP code first (migration head stays 0008); then build
and install reviewed exact Windows/macOS Desktop + Host with existing public
Control Plane/Relay config, preserving SQLite/platform keys/authorizations.
Local migration 23 follows normal upgrade. Verify physical background/reload/
restart/wake and existing bidirectional read-only access. Never repeat Request
Access/Allow, change scopes, or redeploy Relay for this change.
