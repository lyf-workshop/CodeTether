# Phase 9B.2 Remote Host Supervisor Transport REAL Closure

## Status and lineage

Phase 9B.2 completed Direct and forced-Relay REAL validation on
`phase9/remote-host-supervisor`.

- Phase 9B.1 closure baseline:
  `6cb762931e9e76b57c3a0c69c94dab9f30f590c0`
- Direct implementation and REAL fix:
  `a30c764bdc8e5b8c95255f268b46bd86cd555a0c`
- Relay implementation:
  `e2caabab43a55cbdf70ffa72a881777198161d75`
- Relay REAL recovery HEAD:
  `7329ae7697d86f09f9c5c93a5f2c91ac3ae433a5`
- Accepted status: `PHASE9B2_REMOTE_HOST_SUPERVISOR_REAL_PASS`

## Transport architecture

The exact local Host continues to use the validated local fast path. A
non-local authorized Host tries the dedicated Direct Supervisor transport
first and falls back to the opaque Relay only for bounded connection-
establishment failures. Security or authentication failures fail closed and
cannot trigger a Relay bypass. An active session remains on its selected
transport until disconnect; a later reconnect performs fresh authentication
and may select Direct or Relay again.

Direct uses TLS 1.3 on the dedicated Supervisor port 4318. Relay carries that
same end-to-end Supervisor TLS stream inside the existing bounded Relay byte
transport:

```text
ProductDevice <-> opaque Relay <-> Host Supervisor
```

The Relay terminates only its outer transport. It cannot decrypt Supervisor
application payloads, authorize a ProductDevice or Host, mint a Supervisor
session, or become Machine or product-state authority.

## Trust separation

Phase 9B.2 preserves the following boundaries:

- ProductDevice identity and proof are not Machine Controller identity or
  proof.
- Host identity is not Node identity.
- Relay presence is routing state, not Host authorization.
- Control Plane admission is not Host-local Supervisor authorization.
- Host authorization does not grant a Machine execution lease.

Neither Direct nor Relay REAL used a Controller private key, Node pairing,
Relay peer identity as product authorization, or a Machine execution lease.
The Control Plane remains limited to account and ProductDevice admission,
Space/Host ownership, authorization and directory metadata, and safe
rendezvous metadata. Machines, Projects, Conversations, Turns, Provider native
sessions, source code, and transcripts remain outside cloud authority.

## Direct REAL

The forced-remote Direct REAL path used TLS 1.3 on port 4318, verified the
exact Host identity, authenticated the existing ProductDevice, revalidated the
current Host authorization, and completed `host.bootstrap`, `machine.list`,
and `machine.get`. The local 4317 product-data path was bypassed, Controller
trust was not used, Provider cold-read was preserved, and the normal local
fast path still passed afterward.

The REAL Direct defect was a hostname-only Host descriptor on Windows.
Hostname resolution produced IPv6/link-local candidates while the Supervisor
listener was IPv4, causing Direct TLS establishment to fail with `EINVAL`.
Commit `a30c764bdc8e5b8c95255f268b46bd86cd555a0c`
(`fix(host): advertise concrete Supervisor endpoints`) replaced that ambiguity
with a bounded loopback validation endpoint and concrete current non-internal
IPv4 LAN endpoints.

## Relay REAL and lifecycle fixes

The forced-Relay REAL path completed:

```text
ProductDevice
  -> Relay outer transport
  -> end-to-end Supervisor TLS
  -> exact Host identity verification
  -> ProductDevice proof
  -> current Host authorization
  -> host.bootstrap
  -> machine.list
  -> machine.get
```

The Host Relay presence remained online. The UI reported the Host online and
enabled Open. The REAL run used neither local 4317 nor a Direct 4318 data
connection. It established one authenticated Supervisor session over one
ProductDevice Relay connection. Two descriptor activations were observed;
descriptor activation is not application-session establishment.

Two REAL defects were fixed:

1. `forceRelay` was declared in the wrong strict request schema, so the local
   Host HTTP boundary rejected the connection request before application
   reads. Commit `f6d11b6df3f0b4e7c65ecd8454679ef8fb9e6e2a`
   (`fix(host): admit forced Relay Supervisor connections`) corrected the
   request boundary.
2. An expired Web session did not release its Host transport. A following
   Relay offer encountered the busy channel and raised `relay_protocol_error`,
   incorrectly terminating Host Relay presence as `peer_disconnected`.
   Commit `7329ae7697d86f09f9c5c93a5f2c91ac3ae433a5`
   (`fix(relay): preserve Supervisor presence on reconnect`) made Web delete
   stale sessions, added bounded Host expiry cleanup, changed a busy offer to
   bounded `not_available`, and used a rejected-channel tombstone so a late
   close cannot terminate the current channel.

The final lifecycle has no reconnect loop during a healthy session. Relay
disconnect closes the current Supervisor session, and a fresh reconnect uses
fresh authentication.

## Read-only and cold-read boundary

The remote Supervisor surface exposes exactly:

- `host.bootstrap`
- `machine.list`
- `machine.get`

It exposes no remote Project or Conversation reads, Agent message send,
Provider start/resume, shell execution, filesystem mutation, or tool approval.
Direct and Relay validation each observed zero new Codex processes and zero
new Claude Code processes while reading Host, Machine, and Provider status.

Local Desktop-to-Host operation remains independent of Control Plane, Relay,
and internet availability. Phase 9B.2 does not route the local fast path
through cloud infrastructure.

## Migration and REAL environment

The Control Plane migration head is
`0006_host_supervisor_transport.sql`. Owner REAL deployment applied migration
0006 once and a second run verified idempotency. Relay required no additional
Control Plane migration.

Control Plane REAL build, migration, and runtime used Node 22.22.2 from a
temporary official SHA-256-verified distribution. The global Node/Miniconda
installation was not modified.

## Evidence and final classification

Direct REAL receipt:

`apps/control-plane/.tmp/phase9b2-direct-supervisor/evidence/phase9b2-direct-supervisor-2026-09-24T112603938Z.json`

SHA-256:

`61be41af9b1a48b59b1c64a5422106fe4962a6f975edf4ce6c535652f5850b85`

Relay REAL receipt:

`apps/control-plane/.tmp/phase9b2-relay-supervisor/evidence/phase9b2-relay-supervisor-2026-09-24T160816923Z.json`

SHA-256:

`00aae2b028e2efc0c3cea03fafd94169e8ff99a8f94a72d42d6f232f73167414`

Final classification:

- Local Host Fast Path: PASS
- Direct Supervisor: PASS
- Relay Supervisor: PASS
- Direct-first / Relay fallback: PASS
- Host Identity Verification: PASS
- ProductDevice Authentication: PASS
- Host Authorization Verification: PASS
- ProductDevice / Controller Separation: PASS
- Host Bootstrap Read: PASS
- Machine List: PASS
- Machine Detail: PASS
- Provider Cold Read: PASS
- Read-Only Enforcement: PASS
- Local Mode Cloud Independence: PASS
- Physical Second-Device Validation: DEFERRED

The receipts contain no OTP, JWT, database credential, private key, raw
signature, raw nonce, Relay credential, Provider credential, source code, or
transcript content.

## Deferred validation and next product gap

Physical validation from a second enrolled ProductDevice remains a release or
pre-Mobile validation item. It is not a Phase 9B.2 closure blocker because
forced Direct and forced Relay REAL used the actual ProductDevice/Host
cryptographic path and the automated suites exercised distinct and rejected
identity cases. No second ProductDevice was enrolled for closure.

Phase 9B.2 stops at read-only Host, Machine, and Provider status. The next
major product gap is deliberate remote navigation from Host to Machine to
Projects and Conversations. This closure does not begin that work, Phase 9B.3,
or Mobile.
