# Phase 9A.3 Supabase Auth and PostgreSQL REAL Closure

## Scope

Phase 9A.3 closes the initial human-authentication and managed PostgreSQL
foundation for the CodeTether Control Plane. It does not implement
ProductDevice authentication, Host claiming, Host Supervisor authorization,
Relay account transport, Desktop account UI, or Mobile.

The accepted implementation lineage is:

- Phase 9A.1 authority specification: `8e2ddc5214ef4f5c42af1de5157cbcb82e0dc3f9`
- Phase 9A.2 persistence foundation: `39f1014bb0e6afced97784d196c298fe266dbe95`
- Phase 9A.3 Supabase Auth implementation: `f9d451a5f9fd2f93a2a37c01be8fa5a84709efdb`
- PostgreSQL TLS/Supavisor correction: `4dd51505d55f9c829469f02c47dbbcaac1e5b870`

The frozen Phase 8D product baseline remains
`cba5b947c1a34f039b5767b999e85ddc64ebbd3d`.

## Owner-Accepted Native PostgreSQL REAL

The Owner completed the managed-development PostgreSQL smoke against the
Supabase Session Pooler. The accepted privacy-safe result proves:

| Check                                  | Result                                        |
| -------------------------------------- | --------------------------------------------- |
| Client TLS mode                        | `verified_ca`                                 |
| Client socket encrypted                | PASS                                          |
| Client certificate authorized          | PASS                                          |
| Client authorization error             | absent                                        |
| Client TLS verification                | PASS                                          |
| Connection classification              | `supabase_pooler`                             |
| Backend TLS observation                | `not_reported_through_pooler` (informational) |
| Database already at current migrations | PASS (`appliedCount = 0`)                     |
| Repeated migration no-op               | PASS                                          |
| Managed fixture rollback               | PASS                                          |
| Observed Control Plane constraints     | 242                                           |
| Observed Control Plane triggers        | 2                                             |

`appliedCount = 0` means every repository migration checksum was already
present and current. It is not a migration failure.

No database URL, password, CA contents, or other credential is retained in
this receipt.

## TLS Authority and Supavisor Semantics

The authoritative client TLS boundary is the established Node.js client to
Supavisor socket. The smoke requires all of the following before schema or
migration work:

- the configured mode is verified CA;
- the stream is a TLS socket with encryption active;
- the peer certificate is authorized;
- no authorization error is present.

The PostgreSQL `pg_stat_ssl` view observes the separate Supavisor-to-PostgreSQL
backend connection. For a recognized Supabase pooler,
`not_reported_through_pooler` and `unavailable_through_pooler` are informational
backend observations only. They cannot downgrade or upgrade the independently
verified client socket. Direct PostgreSQL connections retain the backend view
as an additional consistency check.

The connection factory continues to use `rejectUnauthorized: true`. There is
no plaintext fallback, `rejectUnauthorized: false`, or
`NODE_TLS_REJECT_UNAUTHORIZED=0` bypass. A failed CA check, an unauthorized
socket, or a non-TLS client stream fails closed. `NODE_EXTRA_CA_CERTS` may add
the managed service CA to Node.js trust without weakening certificate
verification. Connection-string TLS parameters are rejected by the managed
smoke so they cannot replace its explicit verified-CA policy.

## Migration and Managed-Smoke Safety

Control Plane migrations have deterministic filename ordering, transaction
scope, a PostgreSQL advisory transaction lock, SHA-256 history identity, and
checksum-drift rejection. Repeating current migrations is a no-op.

The managed Supabase smoke is non-destructive. It inspects the private schema,
applies only additive/idempotent migrations, verifies the resulting schema,
and performs its disposable repository fixture inside a transaction that is
rolled back. It does not drop a database or schema, truncate shared tables,
globally delete data, or reset Supabase Auth or Storage.

The destructive native integration test remains separate and requires an
explicit database name ending in `_test` or `_ci` before it may drop the
`control_plane` schema.

## Owner-Accepted Email OTP REAL

The Owner completed the development Email OTP flow. The accepted privacy-safe
result is:

| Check                              | Result                                   |
| ---------------------------------- | ---------------------------------------- |
| Supabase Email OTP authentication  | PASS                                     |
| CodeTether user                    | `usr_d1fea20ac539497cb4cb8101e352fc41`   |
| Personal Space                     | `space_94ccbd6f2a904770ab67b590fc748406` |
| Repeated external identity mapping | stable                                   |
| Personal Space count               | exactly 1                                |
| ProductDevice authentication       | `not_implemented_phase9a4`               |

The receipt contains no OTP, access token, refresh token, JWT, email address,
or SMTP credential.

## Human Authentication Authority

Supabase Auth remains the sole human-authentication and human-session
authority. It owns login, Email OTP, access and refresh tokens, identity
verification, session renewal, and account recovery. CodeTether verifies the
Supabase access-token statement but does not mint, refresh, persist, or recover
human sessions.

The Control Plane maps the verified immutable `(issuer, subject)` pair to a
CodeTether `usr_*` identity. Email is normalized optional profile metadata, not
durable identity. A database uniqueness constraint, transaction-scoped
advisory lock, and atomic account bootstrap ensure repeated authentication
returns the same User and personal Space. Bootstrap creates exactly one User,
one personal Space, and one owner membership in one transaction.

`device_session_bindings` is reserved for a future hashed external-session to
ProductDevice authorization binding. It stores no access token, refresh token,
password, or OTP and is not a second human-session authority.

## Private Schema and Cloud Privacy

All CodeTether Control Plane application tables and migration history live in
the private `control_plane` PostgreSQL schema. The application neither writes
these tables into `public` nor modifies Supabase-managed `auth`, `storage`, or
`extensions` schemas. The private schema must remain absent from Supabase Data
API exposed-schema configuration.

Schema audits reject product truth and sensitive fields. The Control Plane
does not durably store raw Supabase tokens, OTPs, passwords, Authorization
headers, Provider credentials, Prompts, transcripts, source code, filesystem
paths, raw diffs, terminal output, native Provider session identities, or
Controller, Host, or ProductDevice private keys. Explicit SHA-256 references
are used only for bounded high-entropy session/nonce correlation and binding;
their raw inputs are not stored.

Authentication and PostgreSQL errors expose only bounded CodeTether error
codes, smoke stages, SQLSTATE values, migration filenames, TLS policy booleans,
connection classification, and safe CodeTether IDs. Token contents, database
credentials, CA contents, and Provider data are not logged.

## Authority Boundaries Preserved

The account identities `usr_*`, `space_*`, `dev_*`, and `host_*` remain
separate from the Phase 8D `machine_*`, `node_*`, `controller_*`, and
`relay_peer_*` identities. Account authentication is not ProductDevice
authentication, Host Supervisor authorization, Machine Controller trust, or
Relay enrollment.

Phase 9A.3 adds a separate Control Plane application and does not change Host
execution authority, Node Provider ownership, Machine trust, Relay opacity,
Machine TLS, ProviderInstallation selection/admission, Conversation binding,
Turn ownership, native resume, or transcript replay rules. Signing in cannot
pair a Machine, trust a Node, start or resume a Turn, or change a Provider
installation.

## ProductDevice Boundary

ProductDevice public metadata persistence exists from Phase 9A.2, but native
key generation and device-bound authentication are deliberately not
implemented. `deviceAuthentication = "not_implemented_phase9a4"` is the
expected Phase 9A.3 result, not a failure. Phase 9A.4 must preserve the frozen
separation between human authentication and physical-device proof.

## Closure

The accepted Owner REAL evidence and automated regression coverage close the
Phase 9A.3 Supabase Auth and managed PostgreSQL scope. No REAL operation was
repeated to produce this document.
