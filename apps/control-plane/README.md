# CodeTether Account Control Plane

`@codetether/control-plane` is the account-directory service introduced by
Phase 9A.2, connected to Supabase Auth in Phase 9A.3, and extended with
ProductDevice authentication in Phase 9A.4, Host ownership in Phase 9A.5, and
explicit ProductDevice-to-Host authorization in Phase 9A.6. It is separate
from Host, Node, and Relay and owns only the Cloud metadata frozen in
`docs/ACCOUNT-CONTROL-PLANE.md`.

Supabase is the sole human-authentication authority. CodeTether validates a
Supabase user access JWT and maps its exact issuer/subject to a stable `usr_*`
and personal `space_*`; it never stores access tokens, refresh tokens, OTPs,
passwords, or JWT signing secrets. ProductDevice registration combines a valid
human session with ES256 candidate-key possession. Device-bound requests then
require the human session and a signed, token-bound ProductDevice proof backed
by shared PostgreSQL replay protection. Supervisor transport, Relay
enrollment, and public account mutation remain unimplemented.

`GET /v1/account/me` remains human-authenticated and does not assert a device.
`GET /v1/device/me` requires both authorities. Bootstrap uses
`POST /v1/devices/registration-challenge` and `POST /v1/devices/register`.
`POST /v1/devices/:deviceId/revoke` requires a device-bound request from a
ProductDevice owned by the same User.

Host control admission uses the existing Host identity and
`host_device_authorizations` authority. The narrow
`/v1/hosts/:hostId/device-authorization` route family requests an exact
authorization, confirms it with the Host's existing ES256 key after explicit
local Owner action, reads its effective state, and revokes it. Every route
requires the human session plus the existing ProductDevice-bound proof. See
`docs/PHASE9A6-HOST-CONTROL-AUTHORIZATION.md` for the exact MVP boundary.

## Layout

- `src/domain`: opaque account IDs and bounded domain validation;
- `src/persistence`: PostgreSQL pool, transactions, migrations, and the typed
  repository;
- `src/services`: centralized account-foundation invariants;
- `src/auth`: provider-neutral verification boundary, Supabase JWT/JWKS
  adapter, and local interactive Email OTP development harness;
- `migrations`: isolated Control Plane PostgreSQL migrations; and
- `test`: embedded PostgreSQL-compatible constraint tests plus an optional
  native PostgreSQL migration gate.

No migration in this application touches the Host SQLite database.

## ProductDevice proof contract

Phase 9A.4 admits only ES256 over P-256. Public keys use a strict public EC JWK
with exactly `kty`, `crv`, `x`, and `y`; the server computes its RFC 7638
SHA-256 thumbprint. Private key fields and arbitrary algorithms are rejected.

Registration challenges are short-lived, purpose-bound, one-use records in the
existing enrollment-challenge authority. A candidate signs the exact challenge
before its random `dev_*` identity is committed.

The `x-codetether-device-proof` compact JWS signs a versioned, constrained RFC
8785 JSON payload binding the exact human access-token hash, ProductDevice and
key generation, uppercase method, canonical path and query, SHA-256 of the
exact admitted request bytes, a random nonce of at least 128 bits, issuance
time, protocol version, and audience. The server allows 120 seconds of clock
skew. PostgreSQL atomically reserves the digest of each nonce for the exact
device and generation for the proof's complete admissible lifetime. The token
hash remains stored as bounded binding metadata, not as part of nonce
uniqueness. A replay-store failure rejects the request. Registration challenge
issuance is transaction-serialized per User and fingerprint, allows only one
active challenge per fingerprint, and caps each User at five active challenges.
Every request must carry the device's exact current positive key generation;
old generations fail after a future rotation advances that record, while old
replay rows remain valid replay evidence until their bounded expiry.

The Control Plane stores the public JWK, public thumbprint, safe device
metadata, revocation state, and nonce/token digests. It never stores the raw
access token, proof, signature, nonce, or private key.

## Windows ProductDevice key

The Windows Desktop key store uses the Microsoft CNG Key Storage Provider to
create a persisted ECDSA P-256 key with an explicit non-exportable policy.
Normal application code receives only an opaque key handle, public JWK, and raw
ES256 signature. It cannot export private-key bytes. The abstraction has
create, public-key, sign, and explicit-destroy operations and leaves future
macOS, iOS, and Android protected-key implementations outside this phase.

ProductDevice authentication alone grants no Host, Machine, Node, Controller,
Relay, Provider, Conversation, Turn, or Supervisor authority. Host registration
and Owner-confirmed claiming are separate Phase 9A.5 operations. Phase 9A.6
adds a separate explicit ProductDevice-to-Host authorization, which still does
not create Machine Controller trust or another execution identity. Local
CodeTether remains independent of Control Plane availability. Device
revocation blocks subsequent device-bound authentication and effective Host
authorization without deleting the User, personal Space, Host, Machine trust,
or local product data.

An exact expired Host claim can be released through
`POST /v1/hosts/:hostId/claims/:claimId/expire`. The route requires both the
Supabase human session and a ProductDevice-bound request proof. PostgreSQL
server time is authoritative. One transaction validates the original
User/device/Space and Host identity, marks only the eligible requested claim
expired, returns only its still-unowned pending Host to `unclaimed`, and emits
one `host_claim_expired` security event. It does not consume the already-expired
challenge, reconstruct its nonce, grant ownership, or create Supervisor,
Machine, Node, Relay, or Provider authority. A later claim is a distinct action
with a new challenge and Owner confirmation.

## Local PostgreSQL

Use a disposable PostgreSQL database, whether from a local installation, a
container, or the dedicated Supabase development project. Create a dedicated
database/user where applicable, then provide the connection string only through
the process environment:

```powershell
$env:CODETETHER_CONTROL_PLANE_DATABASE_URL = '<postgresql connection URL>'
pnpm --filter @codetether/control-plane migrate
pnpm --filter @codetether/control-plane start
```

Do not place a database URL in source control. Migration output reports counts
only and service logs never print the URL. The `control_plane` schema is private
application persistence and must not be added to Supabase Exposed Schemas.
For a plaintext PostgreSQL server bound only to the local development machine,
set `CODETETHER_CONTROL_PLANE_DATABASE_TLS=disable` explicitly; managed
PostgreSQL keeps the certificate-verified default.

## Configuration

| Variable                                                 | Required | Default       | Meaning                                                                                  |
| -------------------------------------------------------- | -------- | ------------- | ---------------------------------------------------------------------------------------- |
| `CODETETHER_CONTROL_PLANE_DATABASE_URL`                  | yes      | none          | PostgreSQL connection URL                                                                |
| `CODETETHER_CONTROL_PLANE_ENVIRONMENT`                   | no       | `development` | `development`, `test`, or `production`                                                   |
| `CODETETHER_CONTROL_PLANE_LISTEN_HOST`                   | no       | `127.0.0.1`   | loopback address only in 9A.2                                                            |
| `CODETETHER_CONTROL_PLANE_LISTEN_PORT`                   | no       | `4320`        | health/readiness port                                                                    |
| `CODETETHER_CONTROL_PLANE_DATABASE_POOL_MAX`             | no       | `10`          | bounded pool size                                                                        |
| `CODETETHER_CONTROL_PLANE_DATABASE_CONNECT_TIMEOUT_MS`   | no       | `5000`        | connection acquisition timeout                                                           |
| `CODETETHER_CONTROL_PLANE_DATABASE_IDLE_TIMEOUT_MS`      | no       | `30000`       | idle connection timeout                                                                  |
| `CODETETHER_CONTROL_PLANE_DATABASE_STATEMENT_TIMEOUT_MS` | no       | `15000`       | PostgreSQL statement timeout                                                             |
| `CODETETHER_CONTROL_PLANE_DATABASE_TLS`                  | no       | `verify-full` | certificate-verified TLS; use `disable` only for an explicitly local disposable database |
| `SUPABASE_URL`                                           | service  | none          | exact HTTPS Supabase project origin                                                      |
| `SUPABASE_PUBLISHABLE_KEY`                               | service  | none          | `sb_publishable_*` application key                                                       |

The service rejects non-loopback listen addresses. A later authenticated
remote API phase must make any public exposure decision explicitly.

The publishable key identifies the application; it is never accepted as a user
JWT. Human identity comes only from a verified Supabase user access JWT. The
preferred path verifies `ES256`/`RS256` JWTs against the project's pinned-issuer
JWKS. If a development project still uses legacy `HS256`, verification delegates
to that project's Auth `/user` endpoint using the publishable key instead of
copying the shared JWT signing secret into CodeTether.

## Migrations

Migration files use deterministic four-digit ordering. The runner creates only
the `control_plane` schema, serializes migration application, records a SHA-256
for every applied file, rejects checksum drift, and treats a repeated run as a
no-op.

Security-relevant entities use explicit lifecycle or revocation fields. All
ownership foreign keys use `ON DELETE RESTRICT`; no Cloud deletion cascades into
another authority. The service performs exact ownership/generation checks in
addition to composite database constraints. Security events are append-only at
the database boundary and contain no unrestricted JSON payload.

```powershell
pnpm --filter @codetether/control-plane migrate
```

For the non-destructive managed-development PostgreSQL smoke, use the same
environment and run:

```powershell
pnpm --filter @codetether/control-plane smoke:supabase-postgres
```

This mode accepts a managed development database named `postgres`; it does not
apply the disposable-database `_test`/`_ci` suffix rule. It rejects unexpected
private-schema conflicts and CodeTether table names in `public`, runs migrations
twice to prove checksum/no-op behavior, and performs repository write/read
inside a transaction that is always rolled back. Before those database stages,
it inspects the established node-postgres `TLSSocket` and requires encrypted,
CA-authorized transport under the `verify-full` policy. For a Supabase shared or
session pooler, `pg_stat_ssl` describes the pooler's separate PostgreSQL backend
connection, so a missing/false backend observation is reported as informational
rather than overriding proven client-to-pooler TLS. Direct Supabase PostgreSQL
connections retain the backend observation as an additional consistency check.
The smoke never drops a database or schema and never truncates
Supabase-managed or shared tables. Failure output contains only a bounded stage,
error class, PostgreSQL code when available, migration filename, and allowlisted
safety reason. It does not echo connection or credential material.

## Email OTP development flow

Configure Email OTP in the development Supabase project, using a template with
the numeric token. In a private interactive terminal with the three required
environment variables set, run:

```powershell
pnpm --filter @codetether/control-plane auth:email-otp
```

The harness prompts for email, requests an OTP through Supabase, reads the OTP
without echo, verifies the returned access JWT through the same Control Plane
verifier, and proves repeat login maps to one User and one personal Space. It
does not persist or print the OTP, access token, or refresh token. It implements
human authentication only; it does not claim ProductDevice proof.

## Tests

The default focused suite uses PGlite as an isolated, in-process PostgreSQL
engine so constraints and transactions are reproducible without Supabase or
production credentials:

```powershell
pnpm --filter @codetether/control-plane test
```

The separate destructive native PostgreSQL migration/bootstrap test requires a
dedicated, disposable database whose name ends in `_test` or `_ci`:

```powershell
$env:CODETETHER_CONTROL_PLANE_TEST_DATABASE_URL = '<isolated PostgreSQL test URL>'
$env:CODETETHER_CONTROL_PLANE_TEST_DATABASE_TLS = 'disable' # local database only
pnpm --filter @codetether/control-plane test
```

That optional test drops only the `control_plane` schema in the explicitly
named test database. It refuses database names without the safety suffix.
