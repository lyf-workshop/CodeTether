# Phase 9 Account and Cloud Control Plane Authority

## Status

This document is the frozen Phase 9A.1 authority specification for the
CodeTether Account and Cloud Control Plane. It is based on the Owner-frozen
Phase 8D production baseline `cba5b947c1a34f039b5767b999e85ddc64ebbd3d`
and tag `phase8d-freeze-2026-09-20`.

Phase 9A.1 is documentation and architecture only. It does not authorize a
Control Plane service, database migration, Supabase integration, Relay change,
Host runtime change, or Mobile implementation. The companion decision record is
[ADR-ACCOUNT-AUTHORITY](adr/ADR-ACCOUNT-AUTHORITY.md).

The words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.

## Frozen authority principles

- Host remains the durable authority for local product and workspace truth.
- Node remains the authority for physical Provider processes and runtime truth.
- Controller trust remains the authority for Machine execution.
- Relay remains opaque rendezvous and transport infrastructure.
- Account and Cloud add human identity, product-device identity, Host ownership,
  safe Host discovery, and account-mediated authorization. They do not replace
  any Phase 8D authority.
- Cloud outage or account state MUST NOT rewrite local Project, Conversation,
  Turn, ProviderInstallation, native-session, Machine, or execution truth.

## Authority domains

Every identity namespace is independent:

```text
userId
  != spaceId
  != deviceId
  != hostId
  != machineId
  != nodeId
  != controllerId
  != relayPeerId
```

| Entity        | Durable prefix | Authority domain                               | Owner                                                   | Key ownership                                                                                                 | Authoritative persistence                                             | Revocation                                                                                          | Survives account logout | Survives reinstall                                                                                                               |
| ------------- | -------------- | ---------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| User          | `usr_*`        | Human account identity                         | The human; authentication is delegated to Supabase Auth | No CodeTether user private key; Supabase owns authentication credentials and tokens                           | Supabase Auth plus a Control Plane user projection                    | Suspend/delete Cloud account and revoke Supabase sessions; never delete local Host state remotely   | Yes                     | Yes; Cloud identity is independent of an app installation                                                                        |
| Space         | `space_*`      | Host ownership principal                       | Its members; MVP has exactly one owner User             | None                                                                                                          | Control Plane Postgres                                                | Disable/archive membership and ownership relations; no local content deletion                       | Yes                     | Yes                                                                                                                              |
| ProductDevice | `dev_*`        | Installed product-client identity              | Exactly one User in MVP                                 | Private signing key on the device; public key in Control Plane                                                | Control Plane registry plus OS-protected local key reference          | Revoke device, its device-session bindings, and its Host grants; do not revoke Machine trust        | Yes                     | Conditional: only if the same protected key and device record survive and can be proved; otherwise create a new `dev_*`          |
| Host          | `host_*`       | One local CodeTether durable product authority | One Space                                               | Private signing key stays on Host; public key may be stored in Cloud                                          | Host-local durable identity plus Control Plane public directory/claim | Unlink/transfer Cloud ownership and revoke Supervisor grants; preserve Host identity and local data | Yes                     | Only through a supported restore that preserves exact Host durable state and key; a destructive clean install creates a new Host |
| Machine       | `machine_*`    | Durable execution-location identity            | Host product state, not the Account service             | No independent account key; execution trust is represented by Controller and Node keys                        | Existing Host SQLite                                                  | Existing Machine unpair/removal rules only                                                          | Yes                     | Per frozen Phase 8D durable-state restore rules; account actions have no effect                                                  |
| Node          | `node_*`       | Physical remote runtime identity               | The Node installation/operator                          | Node private key stays in Node state; public identity is pinned by trusted Controller/Relay records           | Existing Node state and Host trust record                             | Existing explicit Machine trust revocation/unpair                                                   | Yes                     | Only when exact Node state is preserved; otherwise it is a new Node requiring pairing                                            |
| Controller    | `controller_*` | Per-Machine execution authorization identity   | Host                                                    | Controller private key stays in Host credential storage; public key is pinned by Node and enrolled with Relay | Existing Host credential store and Node trust state                   | Existing Controller revocation/unpair/recovery only                                                 | Yes                     | Only when exact Host credential state is preserved; account recovery cannot recreate it                                          |
| RelayPeer     | `relay_peer_*` | Relay infrastructure enrollment identity       | The endpoint role that controls its private key         | Private proof key stays at endpoint; Relay stores public identity and bounded enrollment state                | Existing Relay registry plus endpoint-local key state                 | Relay-only revocation; it does not unpair a Machine or unlink an account                            | Yes                     | Only if exact endpoint key state survives; otherwise explicit re-enrollment is required                                          |

An incidental operating-system behavior that preserves a key across application
uninstall MUST NOT be treated as recovery authority by itself. Reuse of a
ProductDevice or Host identity requires proof of the exact previously registered
key and an intact non-revoked durable record.

## Ownership graph

The MVP ownership graph is:

```text
User
  |-- owns ProductDevice
  `-- member of Space

Space
  `-- owns Host

Host
  `-- independently authorizes ProductDevice for an exact scope
```

Every User receives one personal Space and one owner membership. A Host belongs
to a Space, never only to a `userId`. This makes a future organization another
Space kind rather than requiring Host ownership to be rewritten.

MVP does not implement invitations, multiple members, roles, organization UI, or
shared Host access.

## Trust separation

The following authorities are separate and non-transitive:

```text
Account authentication
  != ProductDevice authentication
  != Host Supervisor authorization
  != Machine Controller trust
  != Relay enrollment
```

Account login MUST NOT:

- pair a Node;
- trust a Machine;
- expose, rotate, recreate, or revoke a Controller credential;
- authorize Provider execution;
- create a Host Supervisor grant;
- imply Relay enrollment; or
- mutate local product data.

Directory visibility means only that the authenticated User may discover safe
metadata for a Host owned by a Space of which the User is a member. It does not
authorize a connection to that Host.

## Human authentication authority

Managed Supabase Auth is the Phase 9 MVP human-authentication authority.

The method order is frozen as:

1. email OTP first;
2. Apple and Google before public Mobile release;
3. passkeys later after the selected integration is production-ready; and
4. no CodeTether-managed password database in MVP.

Supabase Auth owns:

- email/social identity verification;
- human sign-in and account recovery authentication;
- auth access tokens;
- auth refresh tokens and refresh families;
- provider linking; and
- revocation of Supabase human-auth sessions as supported by that service.

CodeTether MUST NOT build a second human refresh-token or password-recovery
authority.

### Auth session versus device authorization

A valid Supabase access token proves a current human-authentication statement. It
does not prove which installed CodeTether client is presenting it.

The Control Plane may persist a `device_session_binding` that binds a verified
Supabase session identifier to a ProductDevice, its key generation, and a
CodeTether authorization generation. That record:

- contains no access token or refresh token;
- cannot renew or recover a Supabase session;
- grants nothing without a currently valid Supabase access token;
- expires no later than the underlying Supabase session;
- may be revoked independently for device-security purposes; and
- exists only to enforce device-key binding, replay protection, and revocation.

It is not an `account_session` and MUST NOT become a duplicate human-auth
session system.

## ProductDevice contract

The minimum ProductDevice record contains:

- `deviceId`;
- `ownerUserId`;
- `type`: initially `desktop_host`, `desktop_client`, `mobile`, or `tablet`;
- public signing key;
- signature algorithm identifier;
- public-key fingerprint;
- bounded user-controlled label;
- coarse platform;
- app and protocol version;
- `createdAt`;
- `lastSeenAt`;
- `revokedAt`; and
- monotonically increasing `keyGeneration`.

Cloud stores the public key only. Private keys SHOULD be non-exportable where
practical:

- Windows uses CNG, with TPM-backed storage where available and an
  operating-system-protected fallback.
- macOS uses Keychain/Secure Enclave facilities where available.
- iOS uses Secure Enclave/SecKey facilities where available.
- Android uses Android Keystore, hardware-backed where available.

Hardware attestation is not required for MVP. Absence of hardware backing MUST
be represented truthfully and MUST NOT silently weaken a policy that explicitly
requires it in a later phase.

Key loss or rotation increments `keyGeneration`. A request signed by an older
generation fails closed. Recovery that cannot prove the prior key creates a new
ProductDevice rather than silently taking over the old identity.

## Device-bound request proof

Every authenticated Control Plane product request requires both:

1. a currently valid Supabase access token; and
2. a signature from the registered ProductDevice private key.

### Canonical proof payload

The signed payload is a versioned, domain-separated object containing at least:

- proof version and audience;
- SHA-256 of the exact presented Supabase access token, or a verified stable
  session/token identifier when the selected Supabase contract guarantees one;
- `deviceId` and `keyGeneration`;
- uppercase HTTP method;
- canonical route/resource and canonical query;
- SHA-256 of the exact bounded request-body bytes, including the standard hash
  of an empty body;
- a cryptographically random nonce with at least 128 bits of entropy; and
- integer UTC issuance time.

The implementation MUST use a standards-based signature algorithm from a
versioned allowlist and deterministic canonical encoding. The default encoding
decision is RFC 8785 JSON Canonicalization Scheme for this object, with UTF-8
bytes and SHA-256. A later change requires a new proof version; there is no
heuristic cross-version parsing or algorithm fallback.

Canonical resource construction uses normalized RFC 3986 path encoding and a
query sorted by encoded name and then encoded value. Scheme, proxy-added headers,
display host names, locale, and JSON parser reserialization are not implicit
inputs. The body hash covers the exact transmitted bytes accepted by the bounded
request parser.

### Time and replay rules

- The maximum accepted clock difference is plus or minus 120 seconds.
- A proof outside that window is rejected before product dispatch.
- Nonce uniqueness is scoped to exact device, key generation, and Supabase token
  binding.
- An accepted nonce remains reserved until the bound access token expires plus
  the clock-tolerance window.
- Reuse is rejected even when the earlier request failed after authentication.
- A legitimate client retry creates a new nonce and proof. Product mutation
  idempotency, when later implemented, remains a separate action identity.
- All horizontally scaled Control Plane instances share replay state. If replay
  state cannot be checked, authenticated product dispatch fails closed.

The server verifies the Supabase token before accepting its identity claims, then
resolves the exact non-revoked ProductDevice/key generation, then verifies the
device proof and consumes the nonce atomically before dispatch.

Proofs, raw tokens, body bytes, signatures, and nonce values MUST NOT enter
security-event payloads or ordinary logs. A rejection records only bounded IDs,
the safe `replay_rejected` event type where applicable, and a CodeTether-owned
reason code.

## Host identity contract

`hostId` identifies one durable local CodeTether product authority. It does not
identify a Machine, Node, operating-system installation record, ProductDevice, or
Controller.

The Host identity contains:

- random durable `host_*` ID;
- Host signing public key and algorithm;
- local operating-system-protected private-key reference;
- public-key fingerprint;
- monotonically increasing `claimGeneration`; and
- creation and safe lifecycle timestamps.

The private key never enters Cloud, Relay, Web, evidence receipts, or SQLite as
raw key material. Host SQLite may store only an opaque key reference and public
metadata.

Host identity survives normal restart, upgrade, account sign-out, Cloud outage,
and account unlink. Unlink does not destroy or rotate it by default. A destructive
reinstall without supported restoration of exact Host state creates a new Host.

Host signing authority MUST NOT reuse a Machine Controller private key.

## Host claim contract

The first claim requires all of:

- signed-in active User;
- non-revoked registered ProductDevice;
- exact Host public identity and fingerprint;
- short-lived, one-use, purpose-bound claim challenge;
- explicit confirmation through the local Host product; and
- Host signature over the challenge and proposed personal Space.

The challenge binds its identifier, expiry, User, ProductDevice, Host, Host key,
target Space, and claim purpose. It is consumed atomically. Expiry, reuse,
identity mismatch, signature mismatch, pre-existing incompatible ownership, or
changed `claimGeneration` fails closed.

Only after verification does the Control Plane assign the Host to the personal
Space. Account login alone cannot claim a Host.

Claiming uploads no Machine, Project, Conversation, Turn, ProviderInstallation,
native-session, Provider credential, or Controller state.

## Host Supervisor authorization

Host ownership and ProductDevice Supervisor authorization are separate.

The only initial scope is:

```text
supervisor_read
```

An authorization binds:

- `hostId`;
- `claimGeneration`;
- `deviceId`;
- ProductDevice public-key fingerprint and `keyGeneration`;
- User and Space context;
- exact scope;
- unique serial and authorization generation;
- `issuedAt` and bounded `expiresAt`; and
- optional `revokedAt`.

The Host independently approves and signs the authorization. The Host-local
authorization record and Host signature are authority. The Control Plane may
index and deliver the signed grant but cannot mint one.

To open a Supervisor connection, the Host verifies its exact identity and claim
generation, the signed grant, current local revocation state, the ProductDevice
proof, and the allowed scope. No grant authorizes Node pairing, Machine
operations, Provider selection, Provider execution, Conversation mutation, or
access to Controller credentials.

No perpetual grant is permitted. Lifetime and renewal policy will be fixed before
implementation; renewal still requires a valid account, device, Host claim, and
Host policy.

## Host transfer and recovery

MVP has no cloud-only Host transfer.

Transfer requires:

1. current-owner reauthentication when the current owner is available;
2. explicit physical/local Host confirmation;
3. new-owner authentication and confirmation;
4. incrementing `claimGeneration`;
5. revoking every old Host-device authorization and rendezvous binding; and
6. recording bounded transfer audit events.

The Host identity and Phase 8D execution identities remain unchanged. Email
access, account recovery, or support staff action alone cannot seize or transfer
a Host. A recovery flow without the current owner still requires proof of local
Host control and a separately documented Owner-approved policy.

## Cloud data classification

### CLOUD_ALLOWED

- CodeTether user ID and bounded display profile;
- verified login-provider subject references and verified email projection;
- Space and membership records;
- ProductDevice public identity, safe label, coarse platform, versions,
  revocation, and last-seen hint;
- Host public identity, safe label, coarse platform, safe protocol/build range,
  ownership, claim generation, revocation, and last-seen hint;
- Host-signed Supervisor authorization metadata and signature;
- opaque Relay rendezvous handle and bounded infrastructure state;
- enrollment challenge metadata and consumed/expired state;
- bounded security events;
- future subscription, entitlement, device-limit, and Relay-quota metadata; and
- non-authoritative online/last-seen hints.

### CLOUD_FORBIDDEN

- Provider API keys or authentication material;
- Codex or Claude credentials;
- Prompts or Conversation transcripts;
- source code;
- filesystem, Project, or working-directory paths;
- raw Diffs or unrestricted file content;
- Terminal output;
- raw Tool payloads;
- native Provider session IDs or secrets;
- Machine Controller private keys;
- Host or ProductDevice private keys;
- Node private keys or Provider configuration;
- raw environment variables or command lines;
- Host SQLite backups; and
- authoritative Machine, Project, Conversation, Turn, Provider selection, or
  execution state.

Filesystem paths remain local because they commonly disclose usernames,
organization names, repository names, and workspace structure.

## Control Plane service boundary

The future service location is frozen as:

```text
apps/control-plane
```

It is a separate service from `apps/relay` and `apps/host`.

Control Plane owns:

- account directory projections;
- ProductDevice registry and revocation;
- Spaces and memberships;
- Host ownership, claims, and safe Host directory;
- device-session bindings and request-proof replay state;
- indexing/delivery of Host-signed Supervisor grants;
- account-mediated rendezvous metadata; and
- bounded security events.

Control Plane does not own Machine, Project, Conversation, Turn,
ProviderInstallation, Provider selection, Provider execution, or native-session
truth. It does not proxy generic Host APIs, Relay bytes, filesystems, terminals,
or Provider protocols.

## Persistence entity specification

These are conceptual entities only. Phase 9A.1 creates no migration.

### Supabase Auth owned

| Entity                           | Meaning                                                              |
| -------------------------------- | -------------------------------------------------------------------- |
| Supabase users                   | Human authentication account and account status at the auth provider |
| Supabase identities              | Email/social identity verification and provider linking              |
| Supabase sessions/access tokens  | Short-lived human-authentication statements                          |
| Supabase refresh tokens/families | Human session renewal and reuse handling                             |
| Supabase recovery/OTP state      | Email OTP and account-recovery authentication                        |

### Control Plane owned

| Conceptual table             | Meaning and authority limit                                                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                      | Maps durable `usr_*` to the immutable verified Supabase subject; contains no password or refresh token                                          |
| `login_identities`           | Minimal issuer/subject projection from verified Supabase identity; it does not verify credentials or recover accounts                           |
| `spaces`                     | Personal ownership scope now; organization-compatible scope later                                                                               |
| `space_memberships`          | MVP has one owner membership per personal Space                                                                                                 |
| `product_devices`            | Public device identity, key generation, safe metadata, and revocation                                                                           |
| `hosts`                      | Public Host identity, owner Space, claim generation, safe directory metadata, and unlink/revocation state                                       |
| `host_claims`                | One-use claim attempts and verified claim lifecycle; no local product data                                                                      |
| `host_device_authorizations` | Index/delivery record for exact Host-signed grants; it cannot create authority without a valid Host signature and Host-local record             |
| `device_session_bindings`    | Device-key binding to a verified Supabase session plus authorization generation; no auth/refresh token and no independent human-session renewal |
| `enrollment_challenges`      | Bounded, purpose-specific, expiring, one-use challenges and consumption state                                                                   |
| `relay_rendezvous_bindings`  | Opaque Host/device infrastructure handles and bounded status; no account authority in Relay                                                     |
| `security_events`            | Bounded account/device/Host security vocabulary with safe IDs and codes only                                                                    |

### Host local

| Entity                    | Meaning                                                                          |
| ------------------------- | -------------------------------------------------------------------------------- |
| Host identity             | `host_*`, public metadata, protected private-key reference, and claim generation |
| Account claim             | Current Space association and signed claim evidence needed locally               |
| Authorized ProductDevices | Authoritative Host Supervisor grants, scopes, serials, expiries, and revocation  |

Control Plane Postgres is not a replica of Host SQLite.

## Sign-out, deletion, and unlink semantics

### Sign out

- Ends the selected Supabase client session as supported.
- Revokes/deactivates the corresponding CodeTether device-session binding.
- Retains ProductDevice registration unless explicitly revoked.
- Retains Host ownership and Host Supervisor grants unless explicitly revoked.
- Leaves all local Host data and execution trust unchanged.

### Global logout

- Revokes all Supabase human-auth sessions as supported.
- Invalidates all CodeTether device-session bindings through a User
  authorization-generation change.
- Does not automatically delete ProductDevices, Hosts, or Host grants.
- Requires each device to authenticate again before establishing a new account
  session.
- Leaves all local Host data and execution trust unchanged.

### Device revocation

- Revokes device-session bindings and increments the device authorization/key
  generation as policy requires.
- Revokes or invalidates every Host Supervisor grant for that device.
- Blocks new account-mediated Relay authorization for that device.
- Does not unpair Machines or delete local data.

### Account deletion

- Enters a bounded Cloud account-deletion lifecycle and removes directory access,
  sessions, ProductDevice access, and account-mediated rendezvous.
- MUST NOT send a remote instruction to delete Projects, Conversations, Turns,
  Machines, Provider credentials, native sessions, or source files.
- Leaves the local Host usable. A Host may become unlinked/unclaimed after the
  deletion lifecycle according to an explicit later implementation policy.

### Host unlink

- Removes account discovery and account-mediated access.
- Revokes Host Supervisor grants/rendezvous for that claim generation.
- Preserves Host identity, local product state, Machine trust, and Provider state.

## Cloud outage behavior

Cloud unavailability MUST NOT prevent:

- local Desktop use;
- local Host reads and mutations already authorized by the local product;
- existing Project and Conversation access;
- existing Machine Controller trust;
- local Provider work;
- existing Direct or Relay Machine execution under Phase 8D authority; or
- cleanup/terminalization of work already owned by Host/Node.

Cloud outage may prevent:

- new account sign-in or recovery;
- new ProductDevice registration;
- Host directory discovery;
- a new Host claim or transfer;
- new account-mediated Relay enrollment; and
- new or renewed remote Host Supervisor authorization.

An already authenticated Supervisor connection MAY continue only until its
existing bounded session expires and Host policy still permits it. There is no
promise of new remote authorization while Cloud is unavailable.

Subscription or entitlement lookup failure MUST NOT terminate an active Provider
Turn or rewrite durable local truth.

## Relay separation

The frozen relations are:

```text
Account != Relay
Host ownership != Relay enrollment
Relay enrollment != Host authorization
Host authorization != Machine Controller trust
```

Relay remains an infrastructure service with its own identity, peer registry,
one-time enrollment, revocation, and bounded grants. It does not become an
account database, Host directory, or authorization oracle.

A future Control Plane may authorize issuance of a bounded one-time Relay
enrollment capability. Relay receives the minimum peer role, public identity,
opaque grant ID, expiry, and purpose necessary. Opaque grant IDs are preferred
to `userId` or `spaceId`.

Successful Relay enrollment still grants no Host content access and no Machine
execution authority. A future Mobile-to-Host channel requires separate pinned
end-to-end Host authentication and Host Supervisor authorization.

Phase 9A.1 changes no Relay protocol or persistence.

## Migration contract

Account support is additive and opt-in. An unclaimed Phase 8D Host remains fully
functional locally.

Existing identities and records remain unchanged, including:

- `machine_*`;
- `node_*`;
- `controller_*`;
- `relay_peer_*`;
- Projects and Project Locations;
- Conversations and Turns;
- ProviderInstallations and selection;
- native Provider sessions; and
- existing Controller/Node/Relay enrollment state.

New identity namespaces are limited to:

- `usr_*`;
- `space_*`;
- `dev_*`; and
- `host_*`.

No account migration may recreate, renumber, import into Cloud, or infer ownership
from an existing execution identity. Claiming a Host adds a relation around the
existing product; it does not convert its data model.

## Future Mobile account contract

The deferred Mobile client may later:

- create/register a ProductDevice;
- authenticate a User through Supabase Auth;
- prove its ProductDevice private key;
- retrieve the safe authorized Host directory;
- request an exact Host Supervisor authorization;
- resolve the Host public identity and opaque rendezvous metadata; and
- present the Host-signed grant over a future authenticated Host connection.

Mobile does not receive a Controller private key, become a Node execution
Controller, receive Provider credentials, or acquire Host access merely by being
logged into the same account.

Actual Mobile transport and UI remain deferred beyond Phase 9A.1.

## Future Space extensibility

The MVP creates only personal Spaces with one owner membership. A future
organization may reuse the same `spaces`, `space_memberships`, and Host ownership
relations while adding invitations, roles, and shared access.

Host rows therefore reference `spaceId`, not `ownerUserId`. ProductDevices remain
owned by individual Users, and a future organization grants those devices scoped
access through membership plus Host authorization. No team implementation is
authorized by this specification.

## Security-event vocabulary

The initial bounded vocabulary is:

- `sign_in`;
- `sign_out`;
- `device_registered`;
- `device_revoked`;
- `host_claim_requested`;
- `host_claimed`;
- `host_unlinked`;
- `host_transfer_requested`;
- `host_transferred`;
- `supervisor_authorized`;
- `supervisor_revoked`; and
- `replay_rejected`.

A record may contain only a random event ID, event type, occurrence time, bounded
actor/target public IDs, success/failure outcome, CodeTether-owned reason code,
and safe correlation ID. Retention is bounded by a later operations policy.

Security events contain no token, OTP, email body, private key, signature, nonce,
raw request body, Prompt, transcript, path, source code, Provider payload, native
session ID, raw IP address, or unrestricted user-agent string.

## Phase 9A.1 non-goals

This specification does not implement or authorize:

- `apps/control-plane` runtime code;
- any database migration;
- Supabase SDK or OAuth integration;
- OTP delivery;
- ProductDevice native key code;
- Host identity runtime code;
- Relay protocol changes;
- Mobile code;
- teams, invitations, or RBAC;
- billing or subscription enforcement; or
- Provider or Machine execution changes.

## Phase 9A.2 persistence foundation

Phase 9A.2 adds an isolated `apps/control-plane` TypeScript service and a new
PostgreSQL `control_plane` schema. It implements only the frozen account-domain
IDs, constrained persistence, typed repository/service boundary, deterministic
migration runner, and local health/readiness surface. Production persistence
uses a bounded `pg` connection pool; the service remains loopback-only and has
no public account mutation routes in this phase.

The migration contains application User mirrors, Spaces and memberships,
ProductDevice public metadata, Host public metadata, claim and Supervisor-grant
metadata, device-session bindings, enrollment challenges, opaque rendezvous
bindings, and bounded append-only security events. It contains no human-auth
token authority and no Host product or execution truth.

Phase 9A.2 did not include Supabase Auth integration, native ProductDevice key
generation, Host claim execution, remotely exposed authenticated APIs, Relay
changes, Desktop account UI, or Mobile. Development, migration, configuration,
and test-database instructions live in `apps/control-plane/README.md`.

## Phase 9A.3 Supabase Auth integration

Phase 9A.3 keeps Supabase Auth as the sole human-session authority. The Control
Plane verifies asymmetric Supabase user JWTs against the exact project issuer
and JWKS, validates audience and lifetime, and maps the immutable
`issuer + subject` pair to a random CodeTether `usr_*`. Email is only a verified,
normalized projection and never a durable identity. If a development project
still uses legacy symmetric signing, CodeTether validates the user token through
the exact Supabase Auth `/user` endpoint with the publishable application key;
it does not acquire or store the shared signing secret.

The first authenticated bootstrap creates the User, one personal Space, one
owner membership, and one `login_*` identity mapping transactionally. Repeated
authentication returns the same User and Space. The Cloud schema stores no
access token, refresh token, OTP, password, or second human session authority.

`GET /v1/account/me` is a bounded development proof of this human-auth boundary.
It returns only the CodeTether User status and personal Space identity and
truthfully marks ProductDevice authentication as not implemented until Phase
9A.4. It grants no Host, Machine, Controller, Relay, Provider, Conversation, or
Turn authority.

Production database access continues to use native PostgreSQL against the
private `control_plane` schema with TLS certificate verification, pool/connect
and statement timeouts, checksummed migrations, and advisory locking. That
schema must not be exposed through the Supabase Data API. Supabase-managed
`auth`, `storage`, and `extensions` schemas remain untouched.
