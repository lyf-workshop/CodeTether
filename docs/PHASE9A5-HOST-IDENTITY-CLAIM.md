# Phase 9A.5 Host Identity and Owner-Confirmed Claim

## Scope

Phase 9A.5 adds a durable `host_*` identity and an additive Control Plane
directory and claim protocol. It does not authorize Host Supervisor access,
Machine trust, Node pairing, Controller credentials, Relay enrollment, or
Provider execution.

The Phase 9A.5 implementation baseline is `5a683ae5d3c2418aff9dfc79c347a318cf5900fb`.
This is an implementation checkpoint, not a Phase 9A.5 closure or freeze.

## Host and Machine are different authorities

`host_*` identifies the local CodeTether product and its durable account/cloud
ownership. `machine_*` identifies an execution location owned by the Host.
They remain independent even when both run on one computer. A claim updates
only Host ownership metadata in the private `control_plane` schema.

## Durable local identity

Host SQLite schema version 19 stores one `host_identity` row containing the
Host id, public JWK, RFC 7638 fingerprint, algorithm, generation, safe label,
platform, app version, timestamps, and an opaque local key handle. It never
stores private key bytes. The row survives process restart, logout, ordinary
upgrades, and Control Plane outage. A replacement Host id is rejected once a
durable identity exists.

The Windows implementation uses a separate `CodeTether.HostIdentity.*` CNG
key namespace with the Windows CNG Software KSP. The P-256 private key is
non-exportable and remains local. The public JWK can be reloaded after a
process restart and signs ES256 payloads. This implementation does not claim
TPM backing.

## Unclaimed registration

The Control Plane migration `0004_host_identity_claim.sql` adds unclaimed Host
support and `host_registration_challenges`. Registration is a bounded,
one-use challenge plus an ES256 signature over a canonical payload. The cloud
stores only public Host metadata and records `host_identity_registered`.
Registration does not claim the Host.

## Owner-confirmed claim

An authenticated human session and a non-revoked ProductDevice belonging to
that user can request a claim for the user's personal Space. The request binds
the exact Host id, fingerprint, generation, user, device, Space, challenge,
audience, protocol version, and expiry. The Host must sign the exact canonical
confirmation payload with its local private key before completion.

The claim is completed transactionally in PostgreSQL. The challenge is
one-use and expires after five minutes. A Host that is already claimed cannot
be claimed again. Concurrent claims serialize through the Host state update
and the database transaction. Completion records bounded
`host_claim_requested`, `host_claim_confirmed`, and `host_claim_completed`
events without secrets.

The ignored Windows validation harness keeps the authenticated session and
challenge in its running process. It writes only bounded public metadata to
`apps/control-plane/.tmp/phase9a5-host-claim/pending-claim.json`, including a
named-pipe handoff. `confirm-host-claim.ps1` displays the Host, fingerprint,
requesting user/device, target Space, claim id, and expiry. It exits before
signing unless the Owner explicitly reruns it with `-Confirm`. After that
action, the running harness reloads the canonical Host CNG key, signs the
canonical confirmation payload, submits it through the Control Plane claim
route with the existing human plus ProductDevice authentication, verifies
atomic completion and authority boundaries, checks replay rejection, reloads
the Host identity, and writes a privacy-safe receipt plus SHA-256 manifest.

`preflight.ps1` runs the Node 22, verified-TLS, migration/checksum, and local
Host readiness checks without email, OTP, Supabase session acquisition, claim
creation, or other mutation. The current development Host readiness result is
stable host identity generation 1 with a non-exportable Windows CNG Software
KSP key. Owner REAL claim execution remains gated on the private migration
preflight and explicit local confirmation.

No claim creates a `host_device_authorizations` row. ProductDevice
authentication therefore remains separate from Supervisor authorization.
No claim changes Machine, Controller, Node, Relay, Project, Conversation, or
Provider state.

## Expired claim recovery

An interrupted claim can outlive its five-minute deadline while the still
unowned Host remains reserved in `pending`. Recovery is an explicit,
device-bound de-authorization operation:

`POST /v1/hosts/:hostId/claims/:claimId/expire`

The request requires a valid Supabase human session and a current,
non-revoked ProductDevice proof. Its signed body binds the exact target Space,
Host fingerprint, and claim generation; the service also requires that the
authenticated User and ProductDevice are the original claim requester. The
transaction locks and revalidates the exact Host and claim, current device,
Space membership, active reservation, and prior expiration event. PostgreSQL
server time—not a client clock—must be strictly later than both the claim and
challenge deadlines.

Only a `requested`, unconfirmed, unconsumed claim for a still-unowned
`pending` Host can make the transition. The same transaction marks that exact
claim `expired`, returns the exact Host to `unclaimed`, leaves
`owning_space_id` null, and appends one bounded `host_claim_expired` event. A
repeat after the complete transition is deterministic and does not append a
second event. Conflicting ownership, confirmation, identity, generation,
reservation, or event state fails closed; it is never repaired
opportunistically.

Expiration does not consume the enrollment challenge. Its `expires_at`
deadline already makes it unusable, while `consumed_at` remains null because
no Host confirmation occurred. The raw nonce is intentionally never persisted
and is neither reconstructed nor required: a Host signature would add no
security to an operation that can only remove an expired reservation and
cannot grant ownership or execution authority.

Expiration and a later claim are separate actions. A released Host may accept
a new claim with a new claim id, challenge, nonce, expiry, ProductDevice proof,
and explicit Owner confirmation. An old confirmation cannot complete an
expired claim or transfer to the new claim.

## Outage behavior

An unclaimed Host continues local operation and retains its local Machine and
Provider state while the Control Plane is unavailable. A new cloud claim may
be blocked during an outage; local startup is not cloud-dependent.

## Privacy

Cloud persistence contains public Host key material, fingerprint, safe labels,
claim metadata, digests, and bounded security events only. It does not contain
Host private keys, ProductDevice private keys, JWTs, refresh tokens, OTPs,
passwords, authorization headers, raw signatures, raw nonces, filesystem
paths, Provider credentials, or Controller private keys.

## Deferred work

Host Supervisor authorization, Host transfer, user-facing key rotation,
cross-platform protected key implementations, hardware attestation, recovery,
and account linking remain outside Phase 9A.5. Phase 9A.5 also does not modify
Machine trust, Node pairing, Controller or Relay authority, Provider
execution, or Mobile surfaces.
