# CodeTether Phase 9A.4 ProductDevice REAL Closure

## Status

Phase 9A.4 ProductDevice identity and device-bound authentication is closed
with the implementation baseline `f6907563f5028f6a1ddcda53eaeb385e92d76c1b`
on `phase9/account-control-plane`.

The accepted Owner-operated Windows REAL evidence has status
`PHASE9A4_PRODUCT_DEVICE_REAL_PASS`.

## REAL evidence

The accepted REAL flow used the existing Supabase human identity
`usr_d1fea20ac539497cb4cb8101e352fc41` and registered ProductDevice
`dev_eacef960c6234691a1ad07064cc0d81f` with public fingerprint
`sha256:j2XmZpNpHhVRAe9L4dumHvr4O3E9cU84ZXo6imDhjK8` and key generation `1`.

The registration challenge was consumed once and the device was created for
the exact User. A valid device-bound `GET /v1/device/me` request was accepted,
while the human JWT without a ProductDevice proof was rejected. Reusing the
accepted proof was rejected as `device_proof_replayed`. PostgreSQL supplied
the shared replay authority and retained two nonce reservations: one for the
accepted device request and one for the accepted revoke request. The rejected
replay and rejected post-revocation request did not reserve additional nonces.

The ProductDevice was revoked. A fresh proof made with the old key was then
rejected as `device_revoked`.

## Request binding

The accepted proof bound the current Supabase token digest, exact `dev_*`
identity, key generation, HTTP method, canonical resource, empty-body SHA-256,
fresh nonce, issuance timestamp, audience, proof version, and protocol
version. Canonical resource and body handling remain the production
versioned protocol; closure changes did not weaken them.

## Replay authority

Replay state is stored in the private PostgreSQL
`control_plane.device_request_nonces` table. Its primary key is
`(device_id, key_generation, nonce_hash)`, so reservation is atomic and shared
across Control Plane instances. Replay-store failure remains fail-closed, and
expiry-based cleanup does not remove unexpired reservations or weaken replay
correctness.

## Revocation

Revocation is checked before accepting a new device proof into normal
authenticated execution. A valid human session, possession of the old private
key, a fresh nonce, a current timestamp, and an otherwise valid ES256 proof
cannot authenticate the revoked `dev_*`.

The REAL lifecycle did not delete or alter the `usr_*` identity or personal
Space, and did not change Host, Machine, Node, Controller, Relay, Project,
Conversation, Turn, Provider, or ProviderInstallation authority.

## Windows CNG key evidence

The Windows validation key used Microsoft CNG persisted P-256 storage through
the ProductDevice key abstraction. ES256 signing worked, the private material
was non-exportable through the abstraction, the opaque persisted handle could
be reloaded, and the public EC JWK was derived for RFC 7638 fingerprinting.

The evidence proves CNG Software KSP protection. It does not claim TPM backing.
After REAL closure the validation key was destroyed; lookup and signing were
unavailable afterward.

## Privacy evidence

The REAL privacy audit found no raw ProductDevice private key, Supabase access
JWT, refresh token, OTP, password, Authorization header, raw device
signature, raw replay nonce, Provider credential, Host private key, or
Controller private key in durable Control Plane state. Public JWK, public
fingerprint, key generation, digest metadata, revocation state, and bounded
security-event metadata remain permitted.

The closure audit is schema-aware and limited to the private `control_plane`
schema and the exact REAL attempt rows. It does not perform broad whole-schema
secret scans in production code.

## Authority boundary

The REAL ProductDevice lifecycle created no Host claim, Host Supervisor grant,
Machine trust change, Node pairing, Relay enrollment, or Provider authority.

The identity namespaces remain independent:

`usr_* != space_* != dev_* != host_* != machine_* != node_* != controller_* != relay_peer_*`.

ProductDevice authentication is separate from human authentication, Host
Supervisor authorization, Machine Controller trust, and Relay enrollment.

## Migration 0003

`0003_product_device_authentication.sql` remains additive, private to the
`control_plane` schema, deterministic, checksum-protected, advisory-lock
compatible, repeat/no-op safe, and non-destructive. Accepted REAL database
deployment evidence was:

- first run: `appliedCount = 1`, `alreadyAppliedCount = 2`;
- repeat run: `appliedCount = 0`, `alreadyAppliedCount = 3`.

The migration adds the ProductDevice registration-challenge projection and
PostgreSQL replay-nonce table. No fourth migration was introduced for closure.

## Closure fixes

The native PostgreSQL smoke expected-table allowlist now includes
`device_registration_challenges` and `device_request_nonces` while continuing
to reject genuinely unexpected tables and public-schema conflicts.

The workspace test scripts now use Node 22's supported
`--experimental-test-isolation=none` flag instead of the unsupported
`--test-isolation=none` spelling. This preserves the intended shared-process
test semantics and keeps order/shared-state failures visible.

## REAL receipt

The accepted privacy-safe receipt is:

`apps/control-plane/.tmp/phase9a4-product-device-real/evidence/phase9a4-product-device-real-resume-20260922T070013.547Z.json`

Its SHA-256 manifest is:

`apps/control-plane/.tmp/phase9a4-product-device-real/evidence/phase9a4-product-device-real-resume-20260922T070013.547Z.json.sha256`

Receipt SHA-256:

`4f4d86312c92ba586a4b6a4d68470584611278bf100f1ac6858c693647d05db0`

The receipt and manifest are repository-ignored and contain no OTP, token,
database credential, raw nonce, signature, or private key.

## Phase 9A.3 and Phase 8D non-regression

Supabase remains the sole human authentication/session authority. Stable
issuer-plus-subject mapping still produces `usr_*`, exactly one personal Space
is preserved, PostgreSQL TLS remains verified fail-closed, and no raw token is
persisted.

Phase 8D Host execution authority, Node Provider runtime authority, Relay
opacity, Machine transport, Controller trust, Provider adapters and
installations, Conversation binding, Turn ownership, native resume, and
transcript/replay rules remain unchanged. ProductDevice code is additive.

## Deferred work

The following remain outside Phase 9A.4: user-facing ProductDevice key
rotation, macOS protected-key support, iOS Secure Enclave support, Android
Keystore support, hardware attestation, ProductDevice recovery, and account
linking.

Host claiming, Host Supervisor authorization, Relay account transport, Mobile,
Provider changes, Machine trust changes, and Controller trust changes are not
implemented by this closure.
