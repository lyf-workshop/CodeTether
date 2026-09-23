# Phase 9A.6 Host Control Authorization REAL Closure

## Status and lineage

Phase 9A.6 completed its Owner REAL validation on 2026-09-23 from
`phase9/account-control-plane`.

- Phase 9A.5 Account Foundation baseline:
  `23f7a9796e64872473f7f659bfabaffb7a0ac97a`
- Phase 9A.6 implementation:
  `9996b925e140ef32472bc266cd3a4a1b49411f73`
- Accepted status: `PHASE9A6_HOST_CONTROL_AUTHORIZATION_REAL_PASS`

## MVP authorization model

The deliberately narrow product model is:

```text
ProductDevice -> Host = unauthorized | authorized
```

Effective admission requires the current Space to own the Host, the exact
current ProductDevice to remain active, and an active authorization for that
exact ProductDevice and Host. A revoked ProductDevice fails admission even if
its authorization row remains. Phase 9A.6 adds no roles, permission hierarchy,
delegation, or general RBAC.

## Migration

Migration `0005_host_device_authorization.sql` extends the existing private
`control_plane` enrollment-challenge authority with the bounded
`host_device_authorization` purpose. It does not create a second authorization
system.

Owner REAL deployment established:

- first run: one migration applied and four already applied;
- second run: zero migrations applied and all five already applied.

The migration is therefore deployed and idempotent.

## REAL identities and ownership

- User: `usr_d1fea20ac539497cb4cb8101e352fc41`
- Personal Space: `space_94ccbd6f2a904770ab67b590fc748406`
- ProductDevice: `dev_dcf9368eb11941a294f837250d012570`, generation 1,
  active
- Host: `host_4298c810e45c41a6a522aacdbb3f570b`, generation 1
- Host fingerprint:
  `sha256:bCXUQA1QjjL9xuWBd6cZTsPih8JdNjg11rGQ7YKzXYI`
- Authorization: `hauth_f00a74aff9b14c2d92c9c8193515b08d`, active

The receipt confirms that the personal Space still owns the exact Host. The
Host identity remained stable across restart, and the runtime ProductDevice
remained active at generation 1.

## Owner confirmation and access results

The REAL flow completed human identity preflight and resolution, exact
ProductDevice discovery, existing Host ownership validation, authorization
request, explicit local Owner confirmation, Host-signed confirmation, durable
authorization persistence, and final admission checks.

- Explicit local Owner confirmation: PASS
- ProductDevice-bound authorized Host access: PASS
- Human-authenticated request without ProductDevice proof: DENY
- Durable authorization state: `authorized`
- Relay bindings created: 0

The Host signature remained the grant authority. No JWT, OTP, private key, raw
signature, raw nonce, Provider credential, or database credential is present
in the closure evidence.

## Revocation behavior

The effective admission check always revalidates the current ProductDevice.
Revoking the ProductDevice therefore denies Host admission without requiring
the authorization row to be deleted and without changing Host ownership or
Machine trust. The separate authorization revocation operation disables only
the exact ProductDevice-to-Host relationship.

## Authority boundary

Phase 9A.6 did not mutate Machine trust, Controller identity or trust, Node
pairing, Relay enrollment, Provider credentials, Provider execution authority,
Project authority, Conversation authority, or Turn authority. ProductDevice
Host authorization remains distinct from Machine Controller trust.

## REAL evidence

Privacy-safe receipt:

`apps/control-plane/.tmp/phase9a6-host-authorization/evidence/phase9a6-host-authorization-2026-09-23T102110706Z.json`

SHA-256:

`a961ff6caafa2a53f954ab7476fa85d20d743fa584149f19a2ed1fc9c11d4384`

The corresponding manifest and independently computed receipt digest match.

## Automated gates

The Phase 9A.6 implementation gates completed with:

- Control Plane tests: 78 passed, 1 optional native PostgreSQL skip, 0 failed;
- repository tests: 1,684 passed, 14 platform/optional skips, 0 failed;
- repository typecheck, lint, and build: PASS;
- changed-document formatting and `git diff --check`: PASS.

No Provider, Machine, OTP, ProductDevice enrollment, Host claim, stale-claim,
or Host-authorization REAL operation was repeated for closure.

## Deferred account features

The following remain explicitly deferred:

- account linking and alternate-identity cleanup;
- Host transfer;
- teams and organizations;
- passkeys and hardware attestation;
- advanced key rotation;
- sophisticated RBAC and complex IAM; and
- advanced recovery beyond the accepted working paths.

## Account Foundation MVP decision

Phase 9A Account Foundation MVP is complete. Its accepted capabilities are
Supabase human authentication, stable `usr_*` identity, personal `space_*`,
ProductDevice identity and authentication, durable Host identity, Host claim
and Space ownership, stale Host-claim recovery, explicit ProductDevice-to-Host
authorization, Host authorization admission checking, and authorization
revocation behavior.

Account Foundation stops here. Deferred account features are not required for
the MVP closure, and no subsequent Account, Mobile, or product phase begins as
part of this decision.
