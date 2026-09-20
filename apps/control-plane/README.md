# CodeTether Account Control Plane

`@codetether/control-plane` is the account-directory service introduced by
Phase 9A.2. It is separate from Host, Node, and Relay and owns only the Cloud
metadata frozen in `docs/ACCOUNT-CONTROL-PLANE.md`.

This foundation does **not** provide human login, public account mutations,
Host claiming, Supervisor transport, or Relay enrollment. Its HTTP surface is
limited to `GET`/`HEAD /healthz` and `/readyz` until authenticated routes are
implemented in a later phase.

## Layout

- `src/domain`: opaque account IDs and bounded domain validation;
- `src/persistence`: PostgreSQL pool, transactions, migrations, and the typed
  repository;
- `src/services`: centralized account-foundation invariants;
- `src/auth`: provider-neutral future human-auth verification boundary;
- `migrations`: isolated Control Plane PostgreSQL migrations; and
- `test`: embedded PostgreSQL-compatible constraint tests plus an optional
  native PostgreSQL migration gate.

No migration in this application touches the Host SQLite database.

## Local PostgreSQL

Use a disposable PostgreSQL database, whether from a local installation or a
container. Create a dedicated database and user, then provide the connection
string only through the process environment:

```powershell
$env:CODETETHER_CONTROL_PLANE_DATABASE_URL = '<postgresql connection URL>'
pnpm --filter @codetether/control-plane migrate
pnpm --filter @codetether/control-plane start
```

Do not place a database URL in source control. Migration output reports counts
only and service logs never print the URL.

## Configuration

| Variable                                                 | Required | Default       | Meaning                                |
| -------------------------------------------------------- | -------- | ------------- | -------------------------------------- |
| `CODETETHER_CONTROL_PLANE_DATABASE_URL`                  | yes      | none          | PostgreSQL connection URL              |
| `CODETETHER_CONTROL_PLANE_ENVIRONMENT`                   | no       | `development` | `development`, `test`, or `production` |
| `CODETETHER_CONTROL_PLANE_LISTEN_HOST`                   | no       | `127.0.0.1`   | loopback address only in 9A.2          |
| `CODETETHER_CONTROL_PLANE_LISTEN_PORT`                   | no       | `4320`        | health/readiness port                  |
| `CODETETHER_CONTROL_PLANE_DATABASE_POOL_MAX`             | no       | `10`          | bounded pool size                      |
| `CODETETHER_CONTROL_PLANE_DATABASE_CONNECT_TIMEOUT_MS`   | no       | `5000`        | connection acquisition timeout         |
| `CODETETHER_CONTROL_PLANE_DATABASE_IDLE_TIMEOUT_MS`      | no       | `30000`       | idle connection timeout                |
| `CODETETHER_CONTROL_PLANE_DATABASE_STATEMENT_TIMEOUT_MS` | no       | `15000`       | PostgreSQL statement timeout           |

The 9A.2 service rejects non-loopback listen addresses. A later authenticated
remote API phase must make any public exposure decision explicitly.

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
pnpm --filter @codetether/control-plane test
```

That optional test drops only the `control_plane` schema in the explicitly
named test database. It refuses database names without the safety suffix.
