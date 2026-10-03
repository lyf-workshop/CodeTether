# Phase 10A.1 — Multi-ProductDevice Supervisor transport

Implementation branch: `phase10/multi-device-supervisor-transport`, based on
`d8d046d2bd5df0e757ddee06abf0e06d119a74bc`. This document is a deployment
handoff, not a production acceptance receipt. No production authorization,
identity, or Relay deployment is changed by this branch.

## Authority and wire model

- One signed, expiring Host presence describes the Host's Direct endpoints and
  optional opaque Relay rendezvous. It is bound to the Host ID, fingerprint,
  generation, Space, and inner Supervisor TLS fingerprint; it contains no
  Project, Conversation, transcript, or Provider state.
- The Control Plane returns that presence only alongside an effective
  ProductDevice-specific authorization and the exact Host-signed grant. Host
  presence is not itself access permission. Unauthorized devices do not obtain
  an effective Supervisor directory entry.
- The Supervisor server retains up to 64 independent signed grant activations.
  A v2-presence client selects its authorization ID _inside_ end-to-end TLS,
  then proves the corresponding ProductDevice and passes current Control Plane
  admission. Existing v1 per-device descriptors remain readable during rollout.
  Scope and Host-local control approval remain per authorization ID.
- The existing Host-signed Owner approval payload binds the authorization ID,
  ProductDevice ID/fingerprint/generation, Host ID/fingerprint/generation,
  Space, User, scope, and expiry. Phase 10A did not persist its signature as a
  reusable Supervisor grant. The Host therefore signs the already-active,
  exact-tuple Supervisor grant during reconciliation. This adds no authorization
  and does not repeat Owner Allow. The existing `hauth_*` is retained.
- The authenticated Windows owner device queries only current Host
  authorizations. Grant materialization verifies the original Host public key,
  exact authorization tuple, and existing authorization state. Removed grants
  are pruned from the Host's active registry; the Control Plane independently
  rejects revoked devices at each new admission. A Host restart reconciles the
  same durable authorization IDs without reenrollment.

## Existing Relay reuse

`apps/relay` already carries Supervisor channels over raw TLS/TCP with bounded
frames, per-channel ACK/backpressure, exact rendezvous capability, and opaque
inner TLS bytes. The Host opens one outbound Relay control connection. The
adapter now permits up to the existing eight channels per peer, with
per-channel lifetime and bounded exact-binding tombstones. Closing one device
channel does not close the Host control connection or another device channel.
Relay authenticates its own outer transport and pairs a rendezvous; it does not
authenticate ProductDevices, decide scope, decrypt Supervisor data, or become
Host/Machine authority. Controller/Node pairing identities are not reused.

## Required deployment sequence — not performed here

1. Deploy the exact new Control Plane commit and apply only additive migration
   `0008_host_supervisor_presence.sql`. Preserve the existing database and
   migration 0007 state. Verify public health/readiness and an owner-only,
   ProductDevice-proof-authenticated authorization-list response. Do not create
   or alter `hauth_e6c2bb245dac4a12820a66237b30a093`.
2. Deploy the existing `apps/relay` raw TLS service using its existing
   `apps/relay/deploy/` configuration/service templates and a durable Relay
   identity. `relay.codetether.org` needs DNS, a valid public TLS certificate,
   and a deliberately allocated public TCP listener (typically 443). This is
   **not HTTP or WebSocket**: a normal Caddy HTTP reverse-proxy route cannot
   forward it. If `api.codetether.org` already owns 443 on the same address,
   allocate a separate address or a separately approved public port before
   deployment. Keep Relay management bound to loopback. Verify Windows and Mac
   can open outbound TLS to the same public Relay identity; do not open inbound
   Windows 4318 or restore port 4331.
3. Install the exact new Windows Host/Desktop build. Configure only the existing
   public `CODETETHER_SUPERVISOR_RELAY_ENDPOINT`,
   `CODETETHER_SUPERVISOR_RELAY_ID`, and
   `CODETETHER_SUPERVISOR_RELAY_FINGERPRINT` as one validated set. The endpoint
   uses `tls://relay.codetether.org[:port]` for public-CA TLS, or the existing
   explicitly pinned `tls+pinned://` mode. Preserve Windows Host CNG key,
   ProductDevice key, SQLite, and all authorization IDs. Verify 4317, 4318,
   outbound Relay presence, one effective Host presence with Direct and Relay
   descriptors, and both Windows/Mac Host-signed grants.
4. Update the physical Mac client to the same exact commit. Using its existing
   ProductDevice and authorization, verify normal Host directory visibility,
   Direct where reachable, then forced Relay read-only Host/Machine/Project/
   Conversation/history reads. Verify restart persistence, no Provider start,
   no `supervisor_control`, no LAN helper, and no new authorization. Physical
   cross-network acceptance is a separate Owner gate.

Deployment must stop on a missing Relay DNS/TCP/TLS plan or any identity,
generation, grant, scope, or authorization mismatch. No active Supervisor
session migrates between Direct and Relay; reconnect authenticates afresh.
