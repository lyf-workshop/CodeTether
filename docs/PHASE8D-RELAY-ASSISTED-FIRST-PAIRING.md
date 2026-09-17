# Phase 8D - Relay-Assisted First Pairing Bootstrap

## Status and scope

This document records the implementation and automated validation boundary for
first pairing through CodeTether Relay. It does not claim production deployment,
Windows-to-macOS physical validation, or platform acceptance.

The change closes the bootstrap deadlock in which a loopback-only Node could be
Relay-enrolled and online but could not acquire its first Controller trust because
pairing required a directly reachable LAN listener. Direct pairing remains
supported. A pairing attempt selects exactly one explicit target and never falls
back across transports.

## Pairing targets

The public Host request accepts either the legacy Direct address or a typed
pairing target:

- `direct` contains the existing bounded Node host and port.
- `relay` contains the Relay endpoint and transport-security mode, pinned Relay
  application fingerprint, target Node fingerprint, random rendezvous identity,
  and a 256-bit rendezvous capability.

The stable user-facing Relay form is
`codetether-pairing://relay/v1?...`. It contains no six-digit pairing code,
private key, enrollment token, or Machine trust. Unknown or duplicate target
parameters fail parsing. The Web passes the parsed target to Host and does not
interpret Relay transport internals.

## Rendezvous lifecycle

An already-enrolled, currently connected Node may register one in-memory pairing
rendezvous. Its expiry cannot exceed the existing five-minute pairing lifetime.
The Relay stores only the capability digest and bounded routing metadata. It does
not persist the capability or opaque payload. A Relay restart or Node disconnect
invalidates the registration.

When pairing mode starts while Relay is offline, the Node retains the same live
pairing session and registers its rendezvous on a reconnect within that session's
TTL. It publishes the Relay target only after registration succeeds. Expiry,
pairing cancellation, successful consumption, pairing disable, Node disconnect,
Relay disconnect, or Node shutdown removes the registration and destroys its
pairing streams.

A rendezvous has at most three authorization attempts, one registered rendezvous
per Node, 64 Relay-wide rendezvous, and one accepted stream. The existing Relay
frame, channel, outstanding-frame, queue, byte, timeout, and connection limits
also apply. A consumed, expired, unknown, or wrong-capability rendezvous cannot be
opened again.

## Pre-trust Relay authority

The Host creates the normal per-Machine Controller key before connecting. For a
Relay target it opens a short-lived pairing-scoped Relay connection. The Relay
challenge transcript binds the Relay challenge, rendezvous identity, a digest of
the rendezvous capability, target Node fingerprint, Controller public key and
fingerprint, and Controller build identity. The Controller proves possession of
that key.

This connection can open only `pairing_opaque_v1` for the exact rendezvous and
Node named during authentication. It cannot subscribe to presence, open
`machine_tls_v1`, replace grants, register rendezvous, enumerate peers or
rendezvous, or issue a Machine operation. It is destroyed after pairing success,
failure, cancellation, or expiry.

The Relay accepts rendezvous registration only from a currently authenticated,
enrolled Node. Possession of the rendezvous capability creates neither a durable
Relay peer nor Machine trust.

## Existing pairing protocol reuse

Direct and Relay pairing use one Machine pairing implementation. Direct supplies
a TCP stream; Relay supplies a purpose-bound opaque Duplex. Both then establish a
fresh inner Machine TLS 1.3 session with `codetether-machine/1` ALPN and run the
same framed OPAQUE exchange.

The existing pairing transcript is unchanged. It binds the OPAQUE-derived session
key to the pairing attempt, Machine and Node identity, Controller identity, both
nonces, both TLS certificate fingerprints, and the TLS exporter from the actual
inner end-to-end Machine TLS session. A Relay cannot read or forge that exporter,
splice a stream into another pairing session, validate the six-digit code, or
impersonate either endpoint.

Wrong codes fail in the existing OPAQUE path. Successful cryptographic exchange
returns the existing safe candidate and verification code. Explicit user
confirmation remains mandatory. Candidate creation does not mutate trust.

## Commit and transition

Confirmation retains the established fail-closed distributed ordering:

1. Host stages the Machine, per-Machine Controller credential, pinned Node trust,
   and Relay configuration as pending durable state.
2. Node verifies the confirmation tag and durably records the exact Controller.
3. For Relay pairing only, Node projects that already-created trust to Relay.
4. Node returns the existing signed acknowledgement.
5. Host activates the staged Machine trust and starts the normal trusted Relay
   coordinator.

Relay reconciliation can admit only the exact Controller key whose pairing
rendezvous was consumed for that live Node connection. An idempotent retry is
allowed only when that exact Controller public key is already present in the
Relay registry, covering a lost post-trust acknowledgement. Direct pairing does
not store the Controller SPKI needed for this bootstrap projection and cannot
silently enroll a Controller with Relay.

After activation, ordinary presence and `machine_tls_v1` use the existing
Node-authored reciprocal grant and nested pinned Machine TLS. The pairing stream
cannot carry normal Machine or Provider operations.

Failure before Host staging removes the temporary Controller credential and
leaves no Machine or Node trust. Failure after staging follows the existing
pending-trust recovery boundary; CodeTether does not generate another Controller
or replay pairing automatically.

## Relay visibility and privacy

Relay can observe connection and channel timing, byte counts, peer public
identities, rendezvous identity, target Node fingerprint, expiry, capability
digest, and bounded lifecycle outcomes. Safe logs use operational references and
rejection codes only.

Relay cannot see the six-digit pairing code, OPAQUE secret material, inner
Machine TLS plaintext, pairing confirmation contents, private keys, Provider
credentials, Project contents, or Machine operations. It stores no pairing
payload, code, raw capability, or pairing-session record in SQLite.

## Protocol and persistence decision

Relay protocol version remains `2`. The additions are new strict message variants
and the new `pairing_opaque_v1` channel purpose; existing enrollment, presence,
and `machine_tls_v1` messages retain their exact schemas and behavior. Unknown
messages already fail closed, so there is no ambiguous downgrade or silent mixed
behavior. Production rollout must upgrade Relay, Node, and Desktop together before
using a Relay pairing target. Existing trusted v2 peers continue to use their
unchanged message families after a coordinated upgrade.

No Host database migration is required. Existing Machine trust and migration 014
Relay configuration remain authoritative. Relay rendezvous state is ephemeral;
the independent Relay registry gains a Controller peer only after confirmed Node
trust is reconciled.

## Validation boundary

Automated coverage includes target parsing, Direct compatibility, Relay
authentication and authorization boundaries, wrong code, candidate and explicit
confirmation, one-time consumption, expiry, disconnect and reconnect cleanup,
bounded registry behavior, no pre-trust Machine channel, durable Host binding,
and transition to an ordinary trusted Relay Machine TLS operation.

Production Relay deployment and the REAL Windows Controller to loopback-only
Apple Silicon Mac flow remain separate Owner-authorized work.
