# Phase 7C End-to-End Security

## Scope

Phase 7C hardens and verifies the existing Phase 7B transport. It does not add
a second encryption protocol, Agent runtime, Provider capability, generic
tunnel, account system, or user-selectable insecure mode.

The security claim supported by this implementation is:

> CodeTether Relay transports an authenticated Controller-to-Node Machine TLS
> session. Agent application records are protected by TLS 1.3 between the exact
> paired endpoints, and the Relay neither needs nor decodes their plaintext.

This claim covers confidentiality, integrity, and end-peer authentication for
Machine application traffic in transit while endpoint identity keys remain
uncompromised. It does not claim anonymity, traffic-shape concealment, endpoint
security, or availability against a Relay that refuses to forward traffic.

## Trust layers

Three independent checks remain mandatory:

1. **Relay transport identity.** Controller and Node verify the configured
   Relay TLS policy and the independently pinned Relay application identity.
2. **Relay infrastructure authorization.** The Relay authenticates each
   enrolled peer and applies the exact reciprocal rendezvous grant.
3. **Machine trust.** Controller and Node mutually prove possession of their
   Machine TLS private keys and validate the exact identities established by
   pairing.

The first two layers permit use of Relay infrastructure. They cannot create or
replace the third layer. A valid Relay channel from an unexpected Controller
is rejected by Node, and a channel routed to an unexpected Node is rejected by
Controller. Relay enrollment, source IP, hostname, channel ID, and connection
epoch are not Machine trust.

## Nested TLS boundary

```text
Controller / Host endpoint                       Node endpoint

Machine plaintext                                Machine plaintext
       |                                                ^
       | TLS 1.3 application encryption                | TLS 1.3 decryption
       v                                                |
Machine TLS wire records  ->  CodeTether Relay  ->  Machine TLS wire records
       |                         sees bounded            ^
       |                         opaque records          |
       +---- outer Controller-to-Relay TLS       outer Node-to-Relay TLS ----+
```

The Relay terminates the two outer Internet TLS connections. It does not
terminate the inner Machine TLS connection and has no Controller or Node
Machine private key. Its data plane forwards the same bounded `channel.data`
string unchanged between authenticated channel owners.

The phrase “Machine TLS wire records” is intentional. Agent application
records are ciphertext, but not every TLS handshake byte is encrypted. A Relay
operator able to inspect Relay process/network traffic may observe ordinary
TLS 1.3 handshake metadata such as record sizes, offered/selected protocol
parameters, key-share metadata, and the `codetether-machine/1` ALPN. CodeTether
does not configure inner SNI, and the Relay application does not parse this
handshake. Phase 7C does not claim that TLS handshake or traffic-shape metadata
is hidden.

## Machine TLS configuration

Both Direct and Relay Machine connections use the same implementation in
`packages/machine-transport`:

- minimum and maximum version are both `TLSv1.3`;
- ALPN must equal `codetether-machine/1`;
- both endpoints present self-signed ECDSA P-256 certificates;
- identity is the SHA-256 fingerprint of the certificate public-key SPKI;
- a TLS certificate proves possession of its private key during the handshake;
- CodeTether then compares the exact SPKI fingerprint in constant time;
- protocol, ALPN, certificate presence, and peer pin are checked before a
  Machine framing object is returned;
- Relay-backed stream APIs require the exact peer pin at both the type and
  runtime boundary;
- handshake failure destroys the stream, with no raw Machine fallback.

`rejectUnauthorized: false` is deliberate for Machine TLS and is not a
trust-all mode. Machine identities are self-signed rather than members of the
public Web PKI, so CA/hostname validation is not the authority. The exact
paired SPKI pin is the authority, and no Machine application write occurs
before that check succeeds. Direct pairing is the separate bounded exception
where a new identity is established through OPAQUE plus explicit presentation
confirmation; an already-paired Relay stream cannot use that exception.

After the TLS pin succeeds, Controller sends a fresh nonce in `machine.hello`
and validates the returned nonce, `machineId`, and `nodeId`. Node validates the
Controller fingerprint and `controllerId` against current durable trust. This
binds the cryptographic peer to the expected CodeTether Machine rather than to
the Relay route.

## Session resumption, early data, and forward secrecy

Machine TLS configures `SSL_OP_NO_TICKET` on both client and server options,
which requests that OpenSSL avoid stateless session tickets. Under TLS 1.3,
OpenSSL may still emit a stateful post-handshake ticket. CodeTether does not
capture the client `session` event, persist its value, or supply a `session`
value to another `tls.connect()` call. The Machine verifier also rejects any
socket for which Node reports `isSessionReused() === true`. Machine connections
therefore must perform a fresh handshake, and deterministic validation requires
`isSessionReused() === false` with a distinct TLS exporter binding for each new
channel. This distinction follows OpenSSL's documented
[`SSL_OP_NO_TICKET` behavior](https://docs.openssl.org/3.5/man3/SSL_CTX_set_options/).

Machine messages are written only after `secure`/`secureConnect`, TLS version,
ALPN, and peer-pin verification. CodeTether does not request or send TLS early
data, so execution actions are not placed in 0-RTT. This conservative policy is
appropriate because TLS 1.3 0-RTT does not provide the ordinary cross-connection
replay guarantee. See [RFC 8446](https://www.rfc-editor.org/rfc/rfc8446.html)
and the [Node.js TLS session-resumption documentation](https://nodejs.org/api/tls.html#session-resumption).

Fresh public-key TLS 1.3 handshakes use the TLS library's ephemeral key
establishment and AEAD record protection. Under the TLS 1.3 security model,
this gives traffic-key forward secrecy and authenticated integrity; CodeTether
does not implement a custom cipher, key exchange, MAC, rekey schedule, or
session-key protocol. Traffic/exporter keys are not persisted or sent to the
Relay. This statement does not promise protection after an endpoint is
compromised while plaintext or live keys are available there.

TLS transport resumption is unrelated to Codex or Claude native Provider
session resume. Provider resume remains application state on Host/Node and can
continue across a fresh Machine TLS handshake.

## Long-term identity ownership and storage

- Controller Machine identity is stored in the Host's private
  `machine-credentials` directory, referenced from Host SQLite by a constrained
  filename and public fingerprint. Host SQLite does not contain the private
  key.
- Node Machine identity is stored in the Node's private data directory.
  Incomplete or malformed identity state fails closed instead of generating a
  replacement key.
- On POSIX, CodeTether enforces `0700` identity directories and `0600` regular
  identity files. On Windows, the private application-data directory relies on
  the owning user's inherited ACL; Phase 7C does not claim OS-vault or
  hardware-backed storage.
- The WebView, public Host protocol, `packages/client`, normal UI, diagnostics,
  and evidence receive no private key or TLS traffic secret.
- Relay SQLite contains the Relay's own private application identity and
  enrolled endpoint **public** keys/fingerprints. It contains no Controller or
  Node Machine private key.

The endpoint Machine identity key is also used by that endpoint to prove its
Relay enrollment identity. This does not merge authorization layers: Relay
stores only the public identity, while Node and Controller still perform the
independent pinned Machine TLS handshake and Machine identity checks.

Automatic Machine identity rotation is not implemented. Unexpected long-term
identity change fails closed and requires the existing explicit pairing/trust
lifecycle. The self-signed certificate is a wrapper around the pinned SPKI;
its public-CA name and validity period are not the durable trust authority.

## Plaintext and buffer boundaries

Plaintext necessarily exists at the trusted endpoints:

- Host creates Machine requests before TLS encryption and consumes normalized
  Machine responses after decryption.
- Node decrypts and validates Machine messages, revalidates ProjectLocation,
  and invokes the Provider runtime.
- Provider credentials and native Provider runtime state remain Node-local.

The Relay process temporarily owns bounded outer frames containing encoded
inner TLS wire records while forwarding them. It does not retain a complete
session, persist channel payload, or parse Machine messages. Queue teardown
releases application references. JavaScript, Node.js, OpenSSL, and the operating
system may copy buffers internally; CodeTether does not claim guaranteed
physical memory zeroization or protection from invasive endpoint/Relay memory
forensics.

No application-level compression is applied to inner Machine TLS records by
Relay, Relay protocol, or Relay client. Phase 7C adds no payload-aware
compression or padding.

## Relay application boundary

The production Relay depends on `@codetether/relay-protocol`, Zod, and its
certificate-generation dependency. It does not import Machine protocol,
Provider adapters, Host, Node, Web, Project, Conversation, or Tool decoders.

The data-plane schema can express only:

- exact authenticated peer/channel/epoch/generation bindings;
- purpose `machine_tls_v1`;
- direction and monotonic bounded sequence/acknowledgement;
- a bounded canonical base64url data chunk;
- controlled close/error state.

It cannot name a Machine operation, Provider, Project, Project path,
Conversation, Turn, Prompt, Tool, process, command, host, port, URL, or proxy
destination. Relay computes decoded byte length for bounds/accounting and
forwards the original string; it does not convert the contents into a Machine
message.

## Relay persistence, logging, and metrics

Relay SQLite has only four infrastructure tables:

- `relay_metadata`;
- `enrollment_tokens`;
- `peers`;
- `rendezvous_grants`.

It has no channel, traffic replay, Machine, Project, Conversation, Turn,
Prompt, Tool, Provider output, or Provider-session table. Channel records,
tombstones, queues, and encrypted bytes are ephemeral. A Relay restart loses
old channels; Relay does not store and forward their traffic after reconnect.

The structured logger accepts only a closed event vocabulary plus controlled
code/role and one-way opaque peer/connection references. Channel data is not a
logger field. Errors never dump raw frames. Aggregate private management metrics
contain numeric connection/channel/frame/byte/queue/failure/resource counters
only, with no business-content label.

Phase 7C validates a harmless unique sentinel across Relay transport and checks
the CodeTether-owned Relay journal, SQLite/WAL/SHM state, management metrics,
configuration, and evidence surfaces. Marker absence supports the logging and
persistence claims; cryptographic confidentiality rests additionally on the
code path, actual nested TLS handshake, peer verification, and intermediary
wire-record evidence.

## Relay-visible metadata inventory

“YES” means available to the Relay application or operator without decrypting
Machine application records. “NO” means the semantic value is not a Relay
protocol/database/log/metric field and is protected inside Machine TLS when
transported. “MAYBE” records a possible operational correlation rather than a
decoded field.

| Item                             | Relay sees | Notes                                                                       |
| -------------------------------- | ---------- | --------------------------------------------------------------------------- |
| Controller Relay public identity | YES        | Fingerprint/SPKI and opaque peer record                                     |
| Node Relay public identity       | YES        | Fingerprint/SPKI and opaque peer record                                     |
| Peer role                        | YES        | `controller` or `node`                                                      |
| Client build identity            | YES        | Bounded enrollment/authentication metadata                                  |
| Reciprocal grant relationship    | YES        | Exact Controller-to-Node relationship                                       |
| Relay connection epoch           | YES        | Ephemeral connection ownership                                              |
| Channel ID/generation/purpose    | YES        | Ephemeral; purpose is only `machine_tls_v1`                                 |
| Channel sequence/ack state       | YES        | Bounded flow control                                                        |
| Connection source IP             | YES        | Live admission/rate-limit input; not persisted/logged as an identity        |
| Connection/channel timing        | YES        | Operational timing is observable                                            |
| Frame size and byte count        | YES        | Aggregate counters and traffic shape                                        |
| Inner TLS handshake metadata     | YES        | Observable to an operator; Relay app does not parse it                      |
| Node `machine_*` ID              | NO         | Not a Relay field; stable Node public identity may be externally correlated |
| Human-readable Machine label     | NO         | Not carried by Relay channel schema                                         |
| Project ID                       | NO         | Machine TLS application data                                                |
| Project path / ProjectLocation   | NO         | Machine TLS application data                                                |
| Conversation ID                  | NO         | Machine TLS application data                                                |
| Turn ID / `actionId`             | NO         | Machine TLS application data                                                |
| Provider name                    | NO         | Machine TLS application data                                                |
| Prompt content                   | NO         | Machine TLS application data                                                |
| Agent output                     | NO         | Machine TLS application data                                                |
| Tool arguments/content/output    | NO         | Machine TLS application data                                                |
| Native Provider session ID       | NO         | Private Machine TLS application data                                        |
| Provider credentials             | NO         | Never leave Node                                                            |
| TLS traffic/exporter keys        | NO         | Endpoint/OpenSSL memory only                                                |

The Relay can infer traffic activity and may correlate a stable enrolled public
identity with external information. Phase 7C does not claim traffic-analysis
resistance or anonymity.

## Integrity, replay, and action ownership

TLS 1.3 AEAD authenticates application records. Corrupted records close the
inner TLS connection and do not become modified Machine messages. A record from
an old handshake is not valid under fresh traffic keys; channel generation,
epoch, sequence, and bounded tombstone rules also reject stale Relay frames.

TLS establishment and Relay ACKs are not Provider ownership. The existing
application layers remain distinct:

1. Relay accepted/opened/acknowledged transport bytes.
2. Machine TLS and exact peer/Machine identity established.
3. Node received and admitted a typed operation.
4. Provider ownership acknowledged.
5. Provider terminal result published.

The durable Host `actionId` ledger remains the logical idempotency authority.
Encryption failure does not create a new retry rule. If certainty is lost after
admission, the frozen ownership-uncertain path fails closed without Prompt
replay, transport migration, or a fabricated completion.

## Diagnostics and UX

Machine identity mismatch and Relay identity mismatch remain different
canonical failures. UI copy may say that the secure Machine or Relay identity
could not be verified and direct the user to existing Machine/Relay trust
management. It must not expose certificates, key paths, handshake transcripts,
session tickets, raw TLS errors, or a “trust anyway” action.

No ordinary UI displays cipher internals. Existing transport status remains the
appropriate user-facing level; Technical Details contains controlled codes,
safe labels, transport mode, and timestamp only.

## Threat model

Assume:

- Internet traffic can be observed, delayed, reordered, duplicated, or dropped;
- Relay infrastructure and its operator can observe the metadata listed above;
- Relay may route to the wrong enrolled peer, stop forwarding, delay traffic,
  refuse channels, or close connections;
- Controller and Node long-term identity keys remain uncompromised;
- the trusted endpoint runtimes and TLS library enforce the audited code path.

Security goals:

- exact Controller and Node peer authentication;
- Machine application payload confidentiality and integrity in transit;
- Relay cannot create Machine trust;
- no plaintext or weaker-authentication downgrade;
- Provider credentials remain Node-local;
- no Relay logging or persistence of Agent payload;
- transport loss preserves action ownership and no-replay semantics.

The Relay controls availability. It can learn traffic shape and relationships,
and it can prevent work from starting or interrupt work. It cannot, without an
endpoint key or a break in the negotiated TLS 1.3 implementation, authenticate
as the pinned peer, decrypt Agent application records, or alter a record into a
different valid Machine request. Routing to a different peer fails the end-peer
pin and Machine identity checks.

Non-goals:

- compromised Controller or Node protection;
- invasive process-memory or operating-system forensic guarantees;
- malicious-Relay availability;
- traffic-analysis resistance, padding, anonymity, onion/multi-hop routing;
- automatic identity rotation, post-quantum cryptography, or external formal
  security certification;
- penetration testing, exploit development, or adversarial infrastructure
  manipulation.

## Restart, compatibility, and rollback

Relay, Host, or Node restart creates a new outer connection/channel and a fresh
pinned Machine TLS handshake. No TLS session key, plaintext channel state, or
Machine frame is carried across Relay epochs. Provider native resume remains
independent and may continue after the new authenticated transport is ready.

Protocol version 2 and purpose `machine_tls_v1` remain explicit. Unsupported
older combinations fail incompatible rather than downgrade to plaintext. No
environment variable, production configuration, or UI option disables Machine
TLS, its peer pins, or Relay identity verification.

Rollback to frozen Phase 7B restores the matching Host, Node, and Relay
artifacts as a coordinated set. Phase 7C adds no database migration, identity
replacement, enrollment change, Machine trust change, Conversation change, or
Provider-session change, so the frozen Phase 7B state remains compatible. Direct
execution remains independently available when its trusted endpoint is
reachable.
