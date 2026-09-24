# Phase 9B.2 Remote Host Supervisor Transport

## Status

Phase 9B.2 has a distinct ProductDevice-to-Host Direct/Relay transport and a
bounded read-only Supervisor surface. Direct REAL is accepted at `a30c764`.
The purpose-bound opaque Relay fallback is implemented and automated; forced
Relay Owner REAL remains the phase gate. This document does not claim Phase
9B.2 closure.

Baseline: `6cb762931e9e76b57c3a0c69c94dab9f30f590c0` on
`phase9/remote-host-supervisor`.

## Authority boundary

The transport preserves these separations:

- ProductDevice identity is not Machine Controller identity.
- Host identity is not Node or Machine identity.
- Control Plane admission is not sufficient without a Host-signed grant.
- Relay carries only opaque records and cannot authorize a ProductDevice or
  mint a Host approval.

The accepted `host_device_authorization` remains the Control Plane admission
record. Migration `0006_host_supervisor_transport.sql` adds only the exact
Host-signed `supervisor_read` grant and a short-lived Host-signed transport
descriptor to that existing authorization. The local Host also stores the
public signed grant in SQLite migration 020. No private key, bearer token,
signature input, Machine state, Project path, or Provider state is persisted in
either addition.

The grant binds the exact authorization, User, Space, ProductDevice and key
generation, Host fingerprint and generation, authorization generation/serial,
scope, and existing authorization lifetime. Materializing it cannot create,
renew, widen, revoke, or transfer an authorization.

## Direct transport

The Desktop-managed Host listens on a separate Supervisor port (4318 by
default). The existing loopback product API remains bound to 127.0.0.1:4317 and
is not exposed remotely.

The Host publishes a short-lived signed descriptor containing its ephemeral
Supervisor TLS public-key fingerprint and bounded concrete IPv4 endpoints.
Loopback supports the explicit same-machine forced-remote validation path;
current non-internal IPv4 addresses support direct LAN entry without relying on
machine-name resolution. A client:

1. verifies the grant and descriptor with the selected Host's durable ES256
   public key;
2. verifies the exact Host ID, fingerprint, generation, ProductDevice, and
   authorization binding;
3. establishes fresh TLS 1.3 with a dedicated ALPN and the descriptor-pinned
   transport key;
4. signs the exact TLS-exporter-bound Host challenge with the existing
   ProductDevice key using the Phase 9A.4 request-proof contract; and
5. admits the session only after the Control Plane revalidates the current
   human session, ProductDevice, Space ownership, Host, authorization,
   timestamp, and shared replay nonce.

The Host retains only a five-minute in-memory session. Disconnect or expiry
requires a fresh challenge and ProductDevice proof. Revoked devices, revoked or
expired authorizations, changed ownership, and changed Host identity fail new
admission through the existing effective-authorization check.

## Read-only surface

The Supervisor protocol has exactly three operations:

- `host.bootstrap`
- `machine.list`
- `machine.get`

Machine data is read from Host authority. Remote Machine detail deliberately
omits Projects and Conversations. The protocol schema has no message, Provider
start/resume, shell, filesystem, pairing, approval, or generic RPC operation.
Representative write-shaped requests fail protocol validation before reaching
Host business logic. Directory and Machine reads retain the cold-read boundary
and do not hydrate Codex or Claude Code.

The Desktop keeps the validated exact-local Host path as its fast path. A
non-local authorized Host uses the separate Supervisor broker and then renders
the same bounded Machine/Provider status model. `?forceRemote=1` or the
development environment flag `VITE_CODETETHER_FORCE_REMOTE=1` is an explicit
validation-only mode that bypasses 4317 as the product-data path while retaining
the same real Host and ProductDevice identities. The loopback broker still
coordinates the outbound Supervisor socket; the Host/Machine response travels
through the pinned 4318 Supervisor connection.

## Opaque Relay fallback

The existing Relay TLS, framing, heartbeat, flow-control, timeout, queue, and
connection lifecycle are reused. Controller/Node enrollment, Machine pairing,
and `machine_tls_v1` authorization are not reused. A separate ephemeral
`srv_*` rendezvous matches one Host outbound presence with one ProductDevice
attempt using a random capability from the Host-signed transport descriptor.
The Relay stores only the capability digest in memory and persists no
Supervisor presence, channel, or payload.

The existing Supervisor TLS 1.3 connection runs inside the Relay byte stream.
Consequently the ProductDevice still pins the exact Host transport identity,
both peers derive the same inner TLS exporter, and the Host still delegates the
one-use ProductDevice proof and current authorization decision to the Control
Plane. Relay outer authentication proves only ownership of the ephemeral
transport key used for routing; it is not ProductDevice or Host authorization.

Normal selection is Direct first. Only bounded network-establishment failures
may fall back to Relay. Host identity, descriptor, protocol, ProductDevice,
replay, expiry, and authorization failures stop without fallback. An active
session never migrates between Direct and Relay. A configured Host establishes
and maintains its outbound Relay presence with bounded reconnect for the Host
process lifetime. An authenticated Desktop coordinator keeps the signed Control
Plane transport descriptor fresh regardless of which product page is visible.

The Host configuration is intentionally bounded and contains no credential:

- `CODETETHER_SUPERVISOR_RELAY_ENDPOINT` (`tls://` for public CA or
  `tls+pinned://` for an explicitly pinned deployment)
- `CODETETHER_SUPERVISOR_RELAY_ID`
- `CODETETHER_SUPERVISOR_RELAY_FINGERPRINT`

All three must be present or all absent. `VITE_CODETETHER_FORCE_RELAY=1` (or
`?forceRelay=1`) is validation-only: it bypasses the local and Direct data
paths but retains the normal end-to-end authentication.

## Validation

Focused tests cover Direct and actual Relay-service transport, exact identity
binding, ProductDevice proof, replay/expiry/revocation rejection,
Controller/ProductDevice identity separation, opaque payload handling,
Direct-to-Relay fallback, security-failure no-fallback, clean reconnect,
allowlisted reads, durable public-grant persistence, migration behavior,
directory projection, and cold Host/Machine reads. Full repository gates must
pass before the implementation commit.

Forced Relay REAL and physical cross-device validation remain pending. No
Account Foundation enrollment, Host claim, or Host authorization flow is to be
repeated for that validation.
