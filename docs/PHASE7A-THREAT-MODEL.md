# Phase 7A Internet Relay Threat Model

## Status and Scope

This document describes the security boundary for **Phase 7A — Internet Relay Architecture Foundation**. Phase 7A is the current approved implementation scope and is not yet accepted, frozen, or declared ready. Phase 6D is accepted and frozen at `cb2c412`.

Phase 7A transports only Relay control messages for enrollment, authentication, heartbeat, presence, authorized rendezvous, revocation, protocol negotiation, and safe errors. It does not transport or represent Prompt, Conversation, Agent, Tool, Provider, Project, filesystem, shell, Terminal, Diff, Approval, source-code, or arbitrary byte payloads. Direct authenticated Machine transport remains the only Provider-execution path.

## Security Objectives

- Authenticate Relay application identity independently from hostname, IP address, TLS certificate, or cloud instance identity.
- Authenticate each Controller and Node by proof of possession of an explicitly enrolled existing private identity.
- Preserve the frozen Controller ↔ Node Machine trust model; Relay enrollment and presence must never create or replace that trust.
- Authorize rendezvous only for the exact reciprocal Controller/Node relationship asserted by the already-trusted Node and held locally by the Controller.
- Prevent enrollment-token and authentication-challenge replay.
- Give each peer identity exactly one current authenticated connection epoch and reject stale-socket state changes.
- Bound attacker-controlled parsing, connections, handshakes, queues, timers, identifiers, logs, persistence, and retry work.
- Prevent global peer enumeration and disclosure of whether an arbitrary identity is enrolled.
- Keep all Agent/product data, peer private keys, and reusable enrollment secrets out of Relay state, logs, metrics, evidence, and Web.
- Preserve direct LAN and local CodeTether operation when Relay is unavailable or hostile.

## Protected Assets

- Relay application private identity and its stable public fingerprint.
- Existing per-Machine Controller private identities held by Host.
- Existing durable Node private identity held by Node.
- One-time enrollment tokens before use or expiry.
- Peer enrollment, immutable role, revocation, and reciprocal rendezvous grant records.
- Current connection ownership and presence truth.
- Availability and bounded resource use of Relay, Host, and Node clients.
- The separation between Relay infrastructure and Machine execution authority.

Projects, Conversations, Prompts, Provider sessions, and source files are not Relay assets because Phase 7A never sends or stores them.

## Trust Boundaries

```text
Web (untrusted presentation boundary)
  │ Protocol v1 on loopback
  ▼
Host / existing per-Machine Controller private identity
  │ outbound TLS + pinned Relay application identity
  ▼
Public Internet ──> CodeTether Relay <── Public Internet
                                           ▲
                         outbound TLS + pinned Relay identity
                                           │
                             Node / existing Node private identity
```

- Web cannot open a Relay socket, select an arbitrary peer identity, read private keys, retain enrollment tokens, or create rendezvous grants.
- Host and Node trust a configured Relay only after either normal CA/hostname verification or exact configured transport-SPKI verification, followed by matching its pinned CodeTether application identity.
- Relay trusts a peer role/identity only after one-time enrollment and a fresh challenge signature from that identity.
- Relay is not trusted to authorize Machine execution. A Relay result cannot change pairing, Project Location, Provider capability, or execution routing.
- The Relay operator controls the service infrastructure. The operator can observe infrastructure metadata and can delay, omit, or deny presence service. Phase 7A does not claim metadata privacy or availability against a malicious operator.

## Identity and Authorization Model

The Node reuses its existing durable P-256 Node identity. The Controller reuses the existing per-Machine P-256 Controller identity established by secure pairing. No account, global Controller identity, username/password, source-IP identity, or Relay-created Machine identity is introduced.

The Node authors a bounded rendezvous grant for an exact Controller fingerprint already present in its private paired-controller state. Initial enrollment includes the grant in the Node-signed transcript; later replacement is accepted only from that Node's exact current authenticated connection epoch. Relay associates that grant with the authenticated Node. An authenticated Controller can query that Node only when:

1. its local Host has an existing trusted Machine record for the Node;
2. its authenticated Controller fingerprint matches the Node-authored grant; and
3. both registrations are current and not revoked.

The Relay does not infer this relation merely because both peers are enrolled. It exposes no list-all, search, wildcard grant, arbitrary peer lookup, or unauthenticated existence response. Relay revocation blocks Relay access only; Machine Unpair remains a separate local trust operation.

## Attacker Assumptions

Assume an Internet attacker can:

- reach the public TLS listener;
- observe the Relay domain or public address and ordinary network metadata;
- open many connections and send arbitrary, malformed, oversized, delayed, duplicated, or out-of-order frames;
- replay previously recorded packets, challenges, signatures, enrollment attempts, and connection messages;
- know or guess public peer identifiers or fingerprints;
- share a NAT address with legitimate peers;
- send ANSI, control characters, newlines, fake structured-log fields, fake URLs, and large strings;
- interrupt connectivity and cause reconnect races or duplicate sockets;
- present another server at an old or changed endpoint.

Assume the attacker does not possess an enrolled Controller, Node, or Relay private key. Compromise of an endpoint private key, operating system, Relay host/root account, CA, DNS operator, or Owner administrative channel is treated as a separate compromise boundary rather than solved by the Relay protocol alone.

## Threats and Required Mitigations

### Relay impersonation and endpoint substitution

An attacker may redirect DNS, reuse an address, or present a valid certificate for another service. Public-CA clients validate the CA chain and hostname; pinned-identity clients may bypass that public-CA chain only to require the exact configured certificate SPKI. Both paths then verify the separately pinned Relay application fingerprint. Endpoint changes preserve enrollment only when the same application identity proves possession. Identity mismatch fails closed without overwriting the trusted fingerprint or endpoint. There is no mode that accepts an unverified certificate identity and no plaintext fallback.

### Peer spoofing and role mutation

Enrollment binds one public peer identity and exactly one `controller` or `node` role. Reconnect signs a canonical transcript with the enrolled private key. Role is included in the transcript and persisted registration and cannot change through reconnect. Wrong keys, fingerprints, roles, signatures, or transcript fields close the connection with a controlled non-enumerating error.

### Enrollment-token theft, guessing, and replay

Tokens are cryptographically random, high entropy, single use, role scoped, short lived, and input bounded. Relay stores only non-reusable verification metadata. Consumption and registration occur in one transaction. Concurrent attempts yield one success; every replay, expiry, wrong-role use, or identity mismatch fails. Attempts are rate limited without treating shared source IP as peer identity. Tokens are never logged, returned after use, persisted by clients, or included in evidence.

### Authentication challenge replay

Challenges are random, short lived, one use, and bound to their exact connection and Relay/peer/protocol/role context. Relay invalidates a challenge on use, timeout, disconnect, or replacement. A signature recorded on one connection cannot authenticate another connection. Challenge and signature material is not logged or exposed to Web.

### Duplicate connections and stale-frame confusion

Successful authentication creates a random connection epoch. Each peer identity has one current epoch. The deterministic latest-authenticated-wins rule invalidates and closes the prior socket. Every heartbeat and state-changing control message is checked against the socket's current epoch. Old sockets and delayed frames cannot restore presence, mutate a grant, answer a rendezvous, or displace the current owner.

### Peer enumeration and rendezvous bypass

Relay provides no global directory. Unauthorized and unauthenticated requests do not reveal whether a target exists, is enrolled, is revoked, or is online. Authorized lookup accepts only bounded opaque identity and validates both the authenticated Controller and the reciprocal Node-authored grant. Knowledge of a peer identifier, common Relay membership, common source address, or role does not grant access.

### Protocol downgrade and schema expansion

Handshake and signed transcripts bind the exact supported Relay protocol version. Incompatibility fails closed; no legacy or plaintext downgrade is attempted. The strict discriminated schema rejects unknown fields and message types. Tests must reject attempts to encode execution, Prompt, Provider, Conversation, Tool, filesystem, shell, Terminal, arbitrary JSON payload, and opaque binary tunnel data.

### Resource exhaustion

Relay enforces maximum total connections, per-peer current connections, pending unauthenticated handshakes, frame and string sizes, handshake/auth timeouts, pending control queue depth/bytes, heartbeat timeout, enrollment attempts, authentication failures, and malformed-frame rates. Clients use one coalesced reconnect owner with capped exponential backoff and jitter. Closed connections release registry entries, timers, parsers, and queued frames. Rate limits combine connection and authenticated-identity controls where possible; IP address alone is neither identity nor the sole limiter.

### Malformed input and log injection

All frames are length checked before allocation and strictly decoded/validated. Invalid encoding, oversized input, unknown fields, ANSI/control/newline characters, fake structured-log fragments, and attacker URLs never become trusted messages or logs. Logs select controlled event/error codes and bounded safe role, opaque peer reference, epoch, and timestamp fields. No raw frame, token, challenge, signature, key, arbitrary identifier, or future product content is logged.

### Persistence corruption and identity replacement

The Relay identity is created transactionally inside the minimal SQLite registry, which is held in a restrictive state directory and validated against its public fingerprint on every load. A non-secret initialization marker makes a missing database in an initialized directory fail startup rather than regenerate identity. The registry uses migrations, WAL where appropriate, transactions, foreign/uniqueness constraints, and atomic token consumption. Missing or incomplete identity metadata and unsupported schema also fail startup. Backup/restore treats identity plus registry as one consistent unit and reconstructs the marker only from a validated existing registry. Replacing the entire state directory is an explicit operator identity replacement, never the continuation of the old Relay.

### Relay outage or malicious availability behavior

Relay disconnect changes only Relay presence/diagnostics and starts bounded reconnect. It cannot unpair Machines, alter trusted endpoints, change Provider health, replay a Prompt, start a Runtime, or block local/direct operations. Direct Remote Codex and restricted Claude continue through the frozen Machine transport whenever that route is reachable. A malicious Relay operator can deny or lie about Relay-provided presence; clients must never interpret presence alone as execution authority or safety.

## Data Minimization and Privacy

Permitted durable Relay data is limited to:

- Relay application identity;
- enrolled peer public key/fingerprint and immutable role;
- revocation state;
- reciprocal Node-authored rendezvous authorization;
- enrollment-token digest, scope, expiry, and consumption metadata;
- schema/protocol version and safe operational timestamps.

Presence, challenges, connection epochs, sockets, queues, and heartbeat identifiers remain ephemeral except for an optional bounded safe last-seen timestamp. Relay never stores or receives Projects, Project Locations, Machine product records, Conversations, Turns, Attention, Search, Prompts, Provider output/credentials/sessions, paths, source code, Tools, Diffs, Terminal output, environment data, or TLS/client private keys.

Public health returns only minimal liveness/readiness. Detailed metrics remain locally or privately bound and contain counts and process resource measurements, not peer identity or product data. Evidence may include safe opaque IDs, fingerprints, epochs, timings, counts, build identities, and statuses, but no token, key, signature, challenge, credential, Prompt, source, private Provider session, or environment dump.

## Operational Security

- Public inbound exposure is TCP 443 only for Relay. Development ports, metrics, health administration, SQLite, and Provider/Host ports are not public.
- The production service uses a dedicated restricted user, explicit state/configuration directories, restrictive permissions, bounded logs, restart-on-failure, and bounded graceful SIGTERM.
- TLS certificate provisioning/renewal uses a standard CA/ACME path when a domain is available. Certificate rotation does not rotate Relay application identity.
- Exact process identity is used for hard-failure testing; name-wide or port-wide termination is prohibited outside a fully isolated disposable environment.
- Upgrade and backup/restore tests reuse the same identity/registry and verify no duplicate registration or silent re-enrollment.
- Restoring a revoked peer requires a fresh role-scoped one-time token and explicit re-enrollment of the same peer identity and immutable role. It never restores or changes Machine pairing.
- Operator-generated enrollment tokens are removed or expire after validation; no reusable test secret remains deployed.

## Validation Requirements

Automated coverage must include token expiry/replay/concurrent use, challenge replay/wrong signature, role mutation, duplicate connection replacement, stale epochs, unauthorized lookup, enumeration attempts, protocol mismatch, oversized/malformed/unknown frames, rate limits, log injection, revoked peers, heartbeat timeout, clean shutdown, hard restart persistence, 100 connection lifecycles, multiple isolated peers, and the inability to represent execution payload.

REAL validation must cover outbound Controller and Node connections to a public TLS Relay, authorized presence, Node/Desktop/Relay restart without re-enrollment, exact hard Relay failure recovery, endpoint/network address change where practical, 30-minute bounded resource behavior, and direct Codex/Claude execution both while Relay is connected and while it is offline. Evidence must prove the direct transport remained selected and Relay received no Agent payload.

Alibaba validation requires an Owner-provided SSH-accessible target, username and approved authentication path, authorized sudo/systemd lifecycle, domain/DNS and TLS/ACME disposition, security-group verification authority, and a decision whether the final production service remains deployed. If these are unavailable, the result is `OWNER ACTION REQUIRED FOR REAL ALIBABA DEPLOYMENT`; local/staging evidence cannot be presented as public Internet proof.

## Explicit Non-Claims and Residual Risks

- Phase 7A does not provide Internet Agent execution, data tunneling, E2E execution-payload encryption, NAT traversal, Mobile, Push, accounts, multi-region operation, clustering, failover, or protection from endpoint compromise.
- TLS terminates at Relay, but Phase 7A sends no Agent or product execution content. Confidentiality from a Relay operator for future execution content is a later-phase design requirement.
- A Relay operator can observe connection time, role, enrolled public identity, authorized relationship, and presence metadata and can deny service or return false infrastructure presence. That cannot grant Machine execution because existing peer trust and direct execution transport remain authoritative.
- A stolen peer private key can authenticate as that peer until Relay revocation and local key/trust recovery occur. Key rotation/recovery beyond explicit revocation and re-enrollment is not expanded into an account system in Phase 7A.
- Single-Relay availability, multi-region recovery, commercial abuse prevention, and large fleet behavior are not Phase 7A guarantees.

No Phase 7A security statement may be interpreted as acceptance, freezing, or authorization to begin Phase 7B.
