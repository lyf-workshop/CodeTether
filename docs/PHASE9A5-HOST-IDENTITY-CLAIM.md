# Phase 9A.5 Host Identity and Owner-Confirmed Claim

## Scope

Phase 9A.5 adds a durable `host_*` identity and an additive Control Plane
directory and claim protocol. It does not authorize Host Supervisor access,
Machine trust, Node pairing, Controller credentials, Relay enrollment, or
Provider execution.

The accepted implementation baseline is `ce75ad29e459704235b49b72c21a06ae1c32e8ef`.

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

No claim creates a `host_device_authorizations` row. ProductDevice
authentication therefore remains separate from Supervisor authorization.
No claim changes Machine, Controller, Node, Relay, Project, Conversation, or
Provider state.

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
and account linking remain outside Phase 9A.5.
