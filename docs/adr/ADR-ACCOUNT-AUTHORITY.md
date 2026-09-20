# ADR: Account and Cloud Authority Separation

## Status

Accepted and frozen for Phase 9A.1 on 2026-09-20.

Baseline: Owner-frozen Phase 8D commit
`cba5b947c1a34f039b5767b999e85ddc64ebbd3d`, tagged
`phase8d-freeze-2026-09-20`.

Normative details are defined in
[Phase 9 Account and Cloud Control Plane Authority](../ACCOUNT-CONTROL-PLANE.md).

## Context

Phase 8D has no user account or global product-device directory. Its security
authorities are deliberately local and execution-scoped: Host owns durable
product state, Node owns physical Provider runtime, Controller trust authorizes
Machine execution, and Relay supplies opaque infrastructure transport.

A Mobile client and additional Desktop devices require human authentication,
device ownership, Host discovery, revocation, and a safe way to request Host
access. Adding those concepts directly to Machine pairing or Relay enrollment
would conflate product ownership with execution authority and would let account
or infrastructure compromise bypass the frozen Phase 8D model.

## Decision

1. Introduce independent `usr_*`, `space_*`, `dev_*`, and `host_*` identities.
   They never replace existing `machine_*`, `node_*`, `controller_*`, or
   `relay_peer_*` identities.
2. Use a Space as the Host ownership principal. MVP gives each User one personal
   Space; future organizations may use the same abstraction.
3. Use managed Supabase Auth as the sole MVP human-authentication and refresh-token
   authority. Email OTP ships first, Apple and Google precede public Mobile, and
   passkeys follow later. CodeTether does not store MVP passwords.
4. Authenticate a ProductDevice separately through proof of its private signing
   key. Control Plane device-session bindings do not issue or refresh human-auth
   tokens.
5. Give each Host its own durable identity and signing key, distinct from Machine
   and Controller identities.
6. Require a signed-in User, registered ProductDevice, one-use challenge, local
   confirmation, and Host signature to claim a Host.
7. Separate Host ownership from Host Supervisor authorization. Directory
   visibility does not grant access. Host signs every scoped ProductDevice grant;
   the initial scope is only `supervisor_read`.
8. Keep `apps/control-plane` separate from Host and Relay. Cloud stores only
   account, public identity, ownership, directory, bounded authorization, and
   infrastructure rendezvous metadata.
9. Keep Relay enrollment, Host authorization, and Machine Controller trust
   separate and non-transitive.
10. Make account adoption additive and opt-in. Existing local product data and
    every Phase 8D execution identity remain unchanged.

## Consequences

### Positive

- Account compromise alone cannot pair a Node, obtain a Controller private key,
  or authorize Provider execution.
- Control Plane or Relay compromise cannot mint a Host-signed Supervisor grant.
- Existing Hosts continue to work locally during Cloud outages and before account
  setup.
- A personal MVP can evolve into organization ownership without rewriting Host
  ownership.
- Human authentication remains delegated to a maintained authentication service
  instead of creating a second password and refresh-token system.

### Costs

- A remote client must prove both a valid human-auth session and its ProductDevice
  key.
- Host claim and new-device access require explicit local confirmation.
- Control Plane, Host authorization, and Relay enrollment have separate
  revocation and lifecycle handling.
- ProductDevice and Host keys require platform-specific protected storage in a
  later implementation phase.

## Rejected alternatives

- **Account login directly grants Host access:** rejected because account
  compromise would bypass Host authority.
- **Account login creates Machine trust:** rejected because Controller/Node trust
  is the frozen execution boundary.
- **Mobile becomes a Machine Controller:** rejected because Mobile supervision is
  a Host product access role, not Node execution authority.
- **Relay becomes the account directory:** rejected because Relay is opaque
  infrastructure and must not own product authority.
- **Host belongs directly to a User:** rejected because it prevents clean future
  organization ownership.
- **CodeTether issues a second human refresh token:** rejected because Supabase
  Auth already owns human session renewal and recovery.
- **Cloud-only Host transfer:** rejected because recovered or compromised account
  access alone must not seize a Host.

## Change control

Any future change that merges these identity domains, permits Cloud or Relay to
mint Machine/Provider authority, introduces a second human-auth refresh-token
authority, or uploads Cloud-forbidden product content requires a new ADR and
explicit Owner approval. It cannot be treated as an implementation detail.
