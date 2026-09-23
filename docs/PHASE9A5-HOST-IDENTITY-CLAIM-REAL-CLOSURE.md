# Phase 9A.5 Host Identity and Claim REAL Closure

## Status

Phase 9A.5 Host identity and claim MVP completed its Owner REAL validation on
2026-09-23 from `phase9/account-control-plane` at
`775a1ffe616c797475fbbe20f0b47bfa9f4bf893`.

Implementation lineage:

- `f6907563f5028f6a1ddcda53eaeb385e92d76c1b` — ProductDevice authentication
  prerequisite
- `ce75ad29e459704235b49b72c21a06ae1c32e8ef` — ProductDevice REAL-validation
  closure fixes
- `5a683ae5d3c2418aff9dfc79c347a318cf5900fb` — Host identity and
  owner-confirmed claim protocol
- `76dc5ece4cf14f3c5e0de9bf88d394f735bb87bd` — durable Host identity
  bootstrap
- `775a1ffe616c797475fbbe20f0b47bfa9f4bf893` — explicit stale Host-claim
  expiration and reservation release

## Durable identities

- User: `usr_d1fea20ac539497cb4cb8101e352fc41`
- Personal Space: `space_94ccbd6f2a904770ab67b590fc748406`
- ProductDevice: `dev_dcf9368eb11941a294f837250d012570`, generation 1
- Host: `host_4298c810e45c41a6a522aacdbb3f570b`, generation 1
- Host fingerprint:
  `sha256:bCXUQA1QjjL9xuWBd6cZTsPih8JdNjg11rGQ7YKzXYI`

The runtime ProductDevice remained non-revoked and backed by its persistent,
protected local key. The Host retained the same persistent, non-exportable
Windows CNG Software KSP key and reloaded the same identity after restart.

## Human identity and Owner confirmation

The authenticated Supabase issuer and immutable subject resolved to the
existing canonical User and personal Space. The subject matched the expected
identity, the external identity was already known, no alternate User was
returned, and no new CodeTether User was created.

The claim harness then used the exact active ProductDevice. Claim
`hclaim_f53ff6e9b82849b794168cbc38f48832` proceeded only after the Owner
explicitly confirmed the bounded local claim description. The Host signed the
exact confirmation with its durable CNG key; no private key, raw signature,
JWT, OTP, or claim nonce was written to the receipt.

## Final ownership and authority boundary

The claim lifecycle state is `completed`. The Host cloud ownership state is
`claimed`, and its exact `ownerSpaceId` is
`space_94ccbd6f2a904770ab67b590fc748406`. Therefore that Space owns
`host_4298c810e45c41a6a522aacdbb3f570b`.

The completed claim created zero `host_device_authorizations` and zero
Supervisor grants. Host ownership remains distinct from Host control
authorization. It did not change Machine trust, Node pairing, Relay state, or
Provider authority.

The completed claim rejected replay, and the Host identity remained stable
after restart.

## Stale-claim recovery

The earlier interrupted claim `hclaim_aa823bc939c849ce995df3bab232a2d1`
was expired through the explicit production stale-claim recovery operation.
That operation released only the expired pending reservation, left ownership
null, rejected reuse of the old confirmation, and returned the Host to
`unclaimed` before the successful claim above. Its accepted REAL status is
`PHASE9A5_STALE_CLAIM_EXPIRATION_REAL_PASS`.

## REAL evidence

Privacy-safe receipt:

`apps/control-plane/.tmp/phase9a5-host-claim/evidence/phase9a5-host-claim-2026-09-23T084630658Z.json`

SHA-256:

`937ec8afe24a009a0ce09bcc490a295dd5a4aa28aa78cee9df9443f2f4690367`

The corresponding manifest matches the receipt. The receipt records
`PHASE9A5_HOST_ORCHESTRATION_PASS`, completed ownership, replay rejection,
restart-stable Host identity, and zero automatic Host-device authorizations.

## Deferred MVP work

The following remain deferred and are not Phase 9A.5 blockers:

- account linking and alternate-identity cleanup;
- Host transfer;
- teams and organizations;
- hardware attestation and passkeys;
- advanced key rotation;
- sophisticated RBAC; and
- recovery mechanisms beyond the current working stale-claim path.

Phase 9A.5 does not implement Host Supervisor authorization, Phase 9A.6, or
Mobile behavior.
