# Phase 7B Authenticated Relay Transport Threat Model

## Scope

Phase 7B carries the existing private CodeTether Machine protocol through a
purpose-bound Internet Relay channel. It does not add a generic tunnel,
arbitrary destination, account system, new Provider operation, Terminal,
filesystem browser, or transport migration for an active Turn.

The normal path is:

```text
Host Controller identity
  -> outbound Relay TLS/control connection
  -> authorized ephemeral machine_tls_v1 channel
  -> outbound Node Relay TLS/control connection
  -> existing Controller <-> Node Machine TLS session
  -> existing typed Machine protocol and Node-owned Provider runtime
```

Relay enrollment authenticates access to Relay infrastructure. The inner
Machine TLS session still authenticates the exact paired Controller and Node,
pins the expected Node public-key fingerprint and Machine identity, and is the
only authority that admits Machine operations.

## Attacker assumptions

Assume an attacker can connect to public TCP 443, send malformed or oversized
Relay frames, record and replay old traffic, guess channel identifiers, delay or
drop traffic, and control one legitimately enrolled peer. Source addresses are
not stable identities. Also assume the Relay operator controls the Relay host
and can observe Relay connection and channel metadata.

The attacker does not initially possess the private Controller or Node Machine
identity keys. A stolen one-time enrollment token is useful only within its
role and lifetime and only once; it does not create Machine pairing.

## Security boundaries

- Relay application identity remains pinned independently from endpoint, DNS,
  public IP, and its public TLS certificate.
- Every data channel binds the exact current Controller and Node Relay
  connection epochs, a Relay-generated channel identity and generation, one
  reciprocal Node-authored rendezvous grant, and the fixed `machine_tls_v1`
  purpose.
- Node explicitly accepts an offered channel, then independently validates the
  Controller certificate through the frozen Machine trust store.
- Controller independently validates the Node certificate, Node identity and
  Machine identity through the frozen Machine handshake.
- Relay presence is not execution authority. Public Internet-execution
  availability additionally requires a bounded, process-local check through the
  current Relay state: the exact paired endpoints complete their inner Machine
  TLS handshake and a nonce-matched Machine ping, then close that qualification
  connection. Restart or loss of current Relay execution state clears the
  result. The check starts no Provider and proves no Project Location, Provider,
  Conversation, or capacity eligibility.
- A Relay ACK means only that Relay accepted or forwarded one channel frame.
  It does not mean Node received a Machine request, admitted a Provider session,
  established Provider execution ownership, or completed a Turn.
- The existing durable Host `actionId` ledger and Node session/action checks
  remain the logical idempotency authorities. Network delivery is not claimed
  to be exactly once.

## Channel and payload bounds

The public Relay protocol can name only an authenticated Node peer; it cannot
name a host, port, URL, process, Provider, Project path, shell, or arbitrary
destination. Machine TLS ciphertext is split into bounded channel chunks. Each
direction has one outstanding sequence at a time and requires an application
ACK before another chunk, propagating bounded consumer backpressure across the
Relay. Per-peer/global channel limits, open and acknowledgement timeouts, outer
frame limits, bounded connection queues, a per-identity channel-open token
bucket, and a per-connection stale/cross-peer-frame strike limit prevent
unbounded accumulation or unlimited authenticated channel churn. A removed
channel's exact binding may remain as a payload-free, globally bounded tombstone
for one acknowledgement deadline; it ignores at most four already-in-flight
frames for that exact peer/epoch/generation while mismatched, guessed, or excess
terminal frames still consume the offender's strike budget.

Channels and their data are ephemeral. Relay SQLite contains no channel,
Machine payload, Project, Conversation, Turn, Prompt, Agent output, Tool output,
Provider credential, Provider session, filesystem path, or replay record.
Relay never stores and resends a Turn after reconnect.

## Failure semantics

Connection replacement, revocation, grant removal, heartbeat timeout, peer
disconnect, Relay restart, protocol violation, queue pressure, or Relay shutdown
invalidates the exact bound channel generation. Frames from an old connection
epoch, another peer, a guessed/reused channel, or a closed generation cannot
mutate the new connection. Exact late frames recognized by the bounded terminal
tombstone are discarded and cannot recreate state.

An idle operation may select Direct first and Relay only when Direct is not
usable. Once a Machine session or Turn generation is established, its transport
is fixed. An active Turn never migrates between Direct and Relay, and channel
reconnect never replays a Prompt. Loss after a Turn-start write but before the
existing Node ownership acknowledgement remains execution-ownership uncertainty
and is not exposed as safe Retry.

## Relay compromise boundary and Phase 7C

Phase 7B deliberately preserves the existing TLS 1.3 Machine session inside the
Relay channel. Therefore the implemented Relay forwards Machine TLS ciphertext,
not decoded Prompts, Provider output, Tool output, Project paths, credentials,
or native Provider session identifiers. Relay logs and evidence also exclude
channel payload bytes.

This is not a declaration that Phase 7C is complete. Phase 7B does not make the
broader formal claims for a fully compromised Relay host, traffic-analysis or
metadata minimization, forward-secrecy/rekey lifecycle, key compromise
recovery, or a dedicated cryptographic audit. A malicious Relay can still
observe peer connectivity, roles, timing, channel counts, frame sizes and byte
volumes; it can drop, delay, reorder or terminate traffic and deny service. It
cannot use Relay enrollment or routing alone to authenticate as the paired
Controller or Node without the corresponding Machine private key, but Phase 7C
must separately harden and validate the complete compromised-infrastructure
model.

## Explicit non-claims

Phase 7B does not claim generic Internet reachability, transparent network
failover, exactly-once packet delivery, uninterrupted active-Turn recovery,
Relay clustering, multi-region failover, Mobile/Push support, or any new Codex
or Claude Code capability.
