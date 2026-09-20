# CodeTether Account Control Plane

`@codetether/control-plane` is the account-directory service introduced by
Phase 9A.2 and connected to Supabase Auth in Phase 9A.3. It is separate from
Host, Node, and Relay and owns only the Cloud metadata frozen in
`docs/ACCOUNT-CONTROL-PLANE.md`.

Supabase is the sole human-authentication authority. CodeTether validates a
Supabase user access JWT and maps its exact issuer/subject to a stable `usr_*`
and personal `space_*`; it never stores access tokens, refresh tokens, OTPs,
passwords, or JWT signing secrets. Full ProductDevice authentication, Host
claiming, Supervisor transport, Relay enrollment, and public account mutation
remain unimplemented. The only authenticated product route is the bounded
development proof `GET /v1/account/me`, which explicitly reports that device
authentication belongs to Phase 9A.4.

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

For the non-destructive managed-PostgreSQL smoke, use the same environment and
run:

```powershell
pnpm --filter @codetether/control-plane smoke:supabase-postgres
```

The smoke rejects unexpected private-schema conflicts and CodeTether table
names in `public`, runs migrations twice to prove checksum/no-op behavior,
checks TLS, and performs repository write/read inside a transaction that is
always rolled back. It never drops a remote schema.

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

For a native PostgreSQL migration/bootstrap gate, provide a dedicated,
disposable database whose name ends in `_test` or `_ci`:

```powershell
$env:CODETETHER_CONTROL_PLANE_TEST_DATABASE_URL = '<isolated PostgreSQL test URL>'
$env:CODETETHER_CONTROL_PLANE_TEST_DATABASE_TLS = 'disable' # local database only
pnpm --filter @codetether/control-plane test
```

That optional test drops only the `control_plane` schema in the explicitly
named test database. It refuses database names without the safety suffix.
