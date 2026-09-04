# CodeTether Relay

The CodeTether Relay is a standalone TLS service. The accepted Phase 7A
foundation carries enrollment, authentication, heartbeat, authorized Node
presence, and rendezvous metadata over outbound-only Controller and Node
connections. Phase 7B protocol version 2 additionally carries one bounded,
ephemeral, purpose-bound `machine_tls_v1` channel. It does not provide an
arbitrary destination, caller-defined application message, generic tunnel, or
Relay-owned Provider operation.

Phase 7A is accepted and frozen at `67e2a98`, and Phase 7B is accepted and
frozen at `b0f74f5`. Phase 7C is the current approved end-to-end security
hardening scope; it changes neither the Relay's purpose nor Provider behavior.

Relay enrollment is infrastructure access, not Machine pairing. A Node grants
presence visibility only to the exact Controller public-key fingerprint it has
already paired with. The Relay never lists peers and cannot create or replace
Controller ↔ Node trust.

## Phase 7B Machine channel boundary

The channel transports the existing end-peer Machine TLS session rather than a
new Relay execution protocol:

```text
Host Controller
  -> Relay TLS/control connection
  -> machine_tls_v1 channel
  -> Relay TLS/control connection
  -> Node
  -> existing inner TLS 1.3 Machine protocol and Node dispatcher
```

The Relay authorizes the exact enrolled Controller/Node relationship and binds
every channel to its random identity/generation plus both current connection
epochs. The Node then accepts only the exact currently paired Controller and
validates its inner Machine certificate. The Controller independently pins the
expected Node certificate, Node identity, Machine identity, ALPN, and protocol.
The Relay cannot name a host, port, URL, process, Provider, Project path, shell
command, or arbitrary destination. It routes opaque Machine TLS wire records
and never stores channel state or payload in SQLite. Machine application
records are TLS 1.3 ciphertext; ordinary handshake metadata, record sizes,
timing, volume, and Relay peer/channel control metadata remain observable.

Channel acknowledgement is transport flow control only. A channel-open result
says that the current Node Relay client accepted the offer. A data ACK says that
one sequenced chunk reached or advanced through the peer's bounded Duplex read
path; it does not prove Machine authentication, Machine request parsing,
Provider-session creation, Prompt acceptance, Tool execution, or Turn
completion. Those semantics remain owned by the inner Machine session-ready,
Turn acknowledgement and terminal messages plus the Host's durable `actionId`
ledger.

Protocol ceilings are 256 live channels globally, eight per authenticated peer,
4 KiB decoded data per chunk, one unacknowledged chunk per direction, 10-second
channel-open and data-acknowledgement deadlines, 8 KiB outer frames, 16 KiB
parser buffering, 16 queued control frames per Relay connection, and 240
channel-open attempts per authenticated identity per minute. A service may
configure lower channel/open counts but cannot exceed these limits. Thirty-two
stale, guessed, or cross-peer channel frames on one authenticated connection
disconnect only that offending connection. An exact closed binding remains as
a payload-free tombstone for at most one acknowledgement deadline so up to four
already-in-flight terminal ACK/data frames cannot poison unrelated multiplexed
channels; tombstones are bounded by the global channel ceiling. Stale
generation/epoch, sequence, authorization, capacity, timeout, connection
replacement, grant removal, revocation, or disconnect closes the exact channel;
Relay never retains bytes for reconnect or replays a Turn.

Production Host policy is Direct first. Relay is considered only after a
retryable Direct connectivity failure for an idle operation and before an
authenticated semantic acceptance boundary. Once a Machine session or Turn has
selected Direct or Relay, it does not migrate. Relay reconnect creates a new
channel generation for a later explicit operation, apart from one short-lived
Host qualification channel described below. A post-write loss remains
execution-ownership uncertainty and is not safe replay merely because a Relay
frame was acknowledged.

Relay presence alone does not publish Internet execution as available. For the
current Host process and live Relay epoch, the Host first opens a bounded
`machine_tls_v1` channel, completes the existing pinned Controller-to-Node
Machine TLS handshake, and receives the nonce-matched `machine.pong` within the
10-second Machine heartbeat timeout. The qualification connection is then
closed. It sends no Provider, Project Location, Prompt, or Conversation
operation, starts no Provider, and does not prove Provider, Project Location,
Conversation, or runtime-capacity eligibility. Loss of current Relay execution
state clears the process-local qualification; Host or Relay reconnection must
qualify the new current state before public `internetExecutionEnabled` can be
true again.

## Phase 7C end-to-end security boundary

Relay transport has two independent TLS layers: each peer authenticates the
Relay over its outer Internet TLS connection, while the paired Controller and
Node establish `codetether-machine/1` TLS inside the purpose-bound channel. The
inner Machine connection is TLS 1.3-only and each endpoint requires the exact
expected peer SPKI fingerprint. Relay authentication, enrollment, presence, or
channel acceptance cannot replace that pin or authorize a Machine operation.

The Machine policy requests no stateless tickets, and CodeTether captures,
persists, and supplies no TLS resumption state. OpenSSL may still emit a
stateful TLS 1.3 post-handshake ticket, but CodeTether never reuses it and the
Machine verifier rejects a socket reported as resumed. Each new Relay channel
therefore performs a fresh authenticated inner handshake before any Machine
frame, and no early-data API is used.
Handshake, pin, ALPN, or protocol failure closes the stream; there is no
plaintext, trust-Relay, or weaker-TLS fallback.

Controller and Node Machine private identities stay on their respective
endpoints. They are distinct from the Relay's own application and transport
identity. The Relay has no Machine/Provider/content decoder and applies no
payload-aware compression; it forwards bounded channel data unchanged and
keeps only infrastructure state plus aggregate numeric observability. It never
logs or persists raw inner wire records. This protects Machine application
confidentiality and integrity in transit but does not hide ordinary handshake
metadata or traffic shape, protect a compromised endpoint, or prevent the
Relay from delaying or denying service. The full implementation-based trust,
key, plaintext, metadata, and threat model is in
`docs/PHASE7C-END-TO-END-SECURITY.md`.

## Build and install

Use Node 25.5 or newer to produce the official Single Executable Application:

```text
pnpm relay:sea
```

The artifact is written below `apps/relay/dist/sea/`. Install it as
`/usr/local/bin/codetether-relay`; the source repository and a system Node.js
installation are not required at runtime. Create a locked-down service account,
copy `deploy/codetether-relay.service` to systemd, and put a configuration file
at `/etc/codetether-relay/relay.json`. The state directory must be explicit and
is restricted to mode `0700`; its SQLite database is mode `0600`. The supplied
unit creates the state and configuration directories with mode `0700`, bounds
open file descriptors and journal emission, and grants only the capability
needed to bind port 443. Install the configuration and any private TLS key so
only root and the dedicated service identity can read them.

For a Linux x64 build, a minimal installation sequence is:

```text
sudo useradd --system --home-dir /var/lib/codetether-relay --shell /usr/sbin/nologin codetether-relay
sudo install -o root -g root -m 0755 apps/relay/dist/sea/codetether-relay-linux-x64 /usr/local/bin/codetether-relay
sudo install -o root -g root -m 0644 apps/relay/deploy/codetether-relay.service /etc/systemd/system/codetether-relay.service
sudo install -d -o codetether-relay -g codetether-relay -m 0700 /etc/codetether-relay /var/lib/codetether-relay
sudo install -o codetether-relay -g codetether-relay -m 0600 apps/relay/deploy/relay.config.example.json /etc/codetether-relay/relay.json
```

Use the matching SEA filename on another supported architecture. Repeating
`useradd` after the dedicated account already exists is unnecessary.

```text
sudo systemctl daemon-reload
sudo systemctl enable --now codetether-relay
sudo systemctl restart codetether-relay
sudo journalctl -u codetether-relay
```

The service handles `SIGTERM`, stops accepting connections, invalidates current
epochs, closes sockets and SQLite, and exits in bounded time. The systemd unit
grants only `CAP_NET_BIND_SERVICE` for port 443 and confines writes to the state
directory.

Run every maintenance command that opens the live Relay SQLite state as the
dedicated service identity, as shown below. This avoids leaving root-owned WAL
or shared-memory files beside service-owned state.

## Configuration and TLS

`deploy/relay.config.example.json` is the no-domain configuration. Its
`pinned_identity` mode creates a self-signed TLS certificate from the same
durable P-256 Relay application key. The TLS SPKI pin therefore equals the Relay
application fingerprint. Clients must verify that exact TLS SPKI before sending
an enrollment token, then independently verify the signed Relay challenge.
There is no plaintext, IP-based trust, or trust-on-first-use fallback. Initialize
the state once on the server, obtain the safe fingerprint with `identity`, and
confirm that fingerprint to each client through a separate trusted operator
channel before enrollment.

With a DNS name and CA certificate, use
`deploy/relay.config.public-ca.example.json` and normal hostname/CA validation:

```json
{
  "stateDirectory": "/var/lib/codetether-relay",
  "listen": { "host": "0.0.0.0", "port": 443 },
  "management": { "host": "127.0.0.1", "port": 9443 },
  "tls": {
    "mode": "public_ca",
    "certificatePath": "/etc/codetether-relay/fullchain.pem",
    "privateKeyPath": "/etc/codetether-relay/privkey.pem"
  }
}
```

The CA TLS key may differ from the Relay application key. Clients still pin and
verify the application fingerprint. On POSIX the configured private-key file
must have no group/other permission bits and remain readable by the dedicated
service user. A standard ACME client may renew the certificate and atomically
install a service-readable copy into `/etc/codetether-relay`; install the private
key as `codetether-relay:codetether-relay` mode `0600`, then restart the Relay so
it loads the new files. Certificate rotation does not rotate the Relay
application identity.

Relay protocol version 2 is framed TLS with the transport-family
`codetether-relay/1` ALPN, not HTTP or WebSocket. The ALPN label remains stable;
the signed and strictly validated message handshake rejects Relay protocol
version 1 rather than silently downgrading. An HTTP reverse proxy is therefore
not a compatible Relay frontend.
If an existing proxy is retained, it must use layer-4 TLS pass-through that
leaves the Relay certificate, ALPN, long-lived connection, frame bounds, and
application-identity checks intact. Direct TLS termination in the Relay is the
simplest supported deployment. Client source IP and forwarded headers are never
identity.

Only `443/TCP` needs public Alibaba Cloud security-group ingress. Keep SSH under
the Owner's existing administrative policy. Do not expose the loopback
management port, SQLite, development ports 4317/4318/5173, or a broad port
range. Controller and Node need outbound TLS only; neither needs an
inbound port, static address, UPnP, or NAT rule.

### Alibaba Cloud deployment modes

For an Owner-operated Alibaba Cloud instance without a domain, deploy the
standalone Relay on public TCP 443 with `pinned_identity`, distribute only its
safe fingerprint out of band, and configure each peer with that exact pin. A
public IP or a permissive security group is never identity. When an Owner-owned
domain is available, point its DNS record to the instance, install a CA-signed
certificate with `public_ca`, and retain the same application fingerprint and
state directory.

In either mode, the Relay adds only public inbound `443/TCP`. Keep SSH access
under the Owner's existing restricted administration policy and verify the
Alibaba security group separately from the guest firewall. The optional
management listener remains `127.0.0.1:9443`; do not publish it through the
security group or a proxy. Existing unrelated services and firewall rules are
outside the Relay deployment and must not be modified as a side effect.

## Identity and enrollment

Relay identity is created randomly on first state initialization and is not
derived from host, domain, IP, MAC, or cloud instance. Inspect only its safe
identity fields:

```text
sudo -u codetether-relay -- /usr/local/bin/codetether-relay identity --state-dir /var/lib/codetether-relay
```

The state directory also contains a non-secret initialization marker. Once it
exists, a missing database fails startup instead of generating another Relay
identity. Do not delete individual state files. Replacing the entire state
directory is an explicit identity replacement and requires deliberate client
pin and enrollment recovery; ordinary restart, upgrade, certificate renewal,
hostname change, and IP change keep the existing state directory.

Create a high-entropy, role-scoped, single-use token. The command prints the
secret exactly once; transmit it through an approved private channel and do not
capture it in shell history or service logs.

```text
sudo -u codetether-relay -- /usr/local/bin/codetether-relay token create --state-dir /var/lib/codetether-relay --role controller --ttl-seconds 600
sudo -u codetether-relay -- /usr/local/bin/codetether-relay token create --state-dir /var/lib/codetether-relay --role node --ttl-seconds 600
```

The database stores only the SHA-256 token digest. Consumption and peer
registration are one transaction, so simultaneous use has one winner. A client
that loses the `peer.ready` response reconnects by its enrolled fingerprint; it
does not replay the token. Reconnect proves possession of the enrolled P-256
private key with a fresh, signed, connection-bound challenge.

The create command writes a non-secret token reference to stderr. An unused
token can be revoked without putting its secret in process arguments:

```text
sudo -u codetether-relay -- /usr/local/bin/codetether-relay token revoke --state-dir /var/lib/codetether-relay --token-reference relay_token_EXAMPLE
```

### Enroll Controller and Node peers

For a Controller, use the trusted Machine's Relay section in CodeTether
Desktop. Confirm the Relay application fingerprint out of band, then submit the
matching Controller-scoped token once. Web sends that explicit mutation only to
the local Host and clears its password input; it never opens the Relay socket or
stores the token.

The Node reads its optional Relay setup from its existing private `--data-dir`.
Write `relay.json` there as a private regular file. For the no-domain mode, the
transport and application fingerprints are the same durable Relay fingerprint:

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "endpoint": { "host": "RELAY_HOST_OR_ADDRESS", "port": 443 },
  "relayIdentityFingerprint": "CONFIRMED_RELAY_FINGERPRINT",
  "tls": {
    "mode": "pinned_certificate",
    "certificatePublicKeyFingerprint": "CONFIRMED_RELAY_FINGERPRINT"
  }
}
```

For a public-CA endpoint, use
`"tls": { "mode": "public_ca", "serverName": "relay.example.com" }` while
retaining the independently confirmed `relayIdentityFingerprint`. Place the
Node-scoped token alone, with one trailing newline permitted, in the private
`relay-enrollment-token` file beside `relay.json`. Both files must be owned by
the Node service identity and mode `0600`. Do not put the token inside JSON, a
command argument, an environment dump, or evidence.

Start or restart the exact Node service. It atomically claims the token file,
authenticates outbound, persists only the bounded Relay registration, and
deletes the plaintext token after successful enrollment. A later restart
authenticates by the existing Node key without another token. After Relay
revocation, placing a fresh Node-scoped token and explicitly restarting the Node
is the only re-enrollment path; the old token and registration cannot restore
access automatically.

Revoke Relay access separately from Machine unpairing:

```text
sudo -u codetether-relay -- /usr/local/bin/codetether-relay peer revoke --state-dir /var/lib/codetether-relay --peer-fingerprint PEER_PUBLIC_KEY_FINGERPRINT
```

A running service notices external revocation during bounded liveness checks,
terminates the current connection, and rejects future authentication. Revocation
does not mutate Controller Machine trust. To regain Relay access, the operator
must issue a fresh role-scoped one-time token and the peer must explicitly
re-enroll the same cryptographic identity and immutable role. The consumed old
token and revoked enrollment cannot be reused, and re-enrollment does not pair
or unpair a Machine. Fingerprint revocation selects one exact known identity;
there is intentionally no command or endpoint that lists or searches all peers.

## Health, metrics, and logs

When configured, loopback-only `GET /healthz`, `/readyz`, and `/metrics` expose
minimal process/service counters. Metrics contain aggregate connection,
authentication, enrollment, heartbeat, rate-limit, uptime, file-descriptor, and
RSS values plus active/opening channels, bounded terminal-channel tombstones,
pending channel data frames/bytes,
open/accept/reject/close/error outcomes, forwarded frame/byte counts,
four directional Relay-channel byte counters, backpressure failures, and
stale-channel frames. Aggregate
`queuedInboundFrames`/`queuedInboundBytes` and
`pendingOutboundFrames`/`pendingOutboundBytes` expose current framed-connection
pressure; `framedQueueFramesHighWaterMark`/`framedQueueBytesHighWaterMark` and
the pending-channel high-water marks retain only lifetime counts. They expose no
peer directory, identities, channel bytes, Machine frames, or product content.

```text
curl --fail --silent http://127.0.0.1:9443/healthz
curl --fail --silent http://127.0.0.1:9443/readyz
curl --fail --silent http://127.0.0.1:9443/metrics
```

Logs contain controlled event/code/role fields and one-way opaque references.
They never contain tokens, challenges, signatures, private keys, raw inner
Machine TLS records, Prompts, Projects, Conversations, paths, Provider output,
Tool content, private Provider session identity, or arbitrary client strings.
The supplied unit rate-limits journal emission. Configure the host's normal
journald size/retention policy so stored logs are bounded as well.

## Backup, restore, and upgrade

Prepare a restricted backup parent, then create an online-consistent SQLite
backup into a new directory:

```text
sudo install -d -o codetether-relay -g codetether-relay -m 0700 /var/backups/codetether-relay
```

```text
sudo -u codetether-relay -- /usr/local/bin/codetether-relay backup --state-dir /var/lib/codetether-relay --output /var/backups/codetether-relay/relay-2026-09-03
```

The backup contains the Relay private identity and minimal peer registry in one
SQLite file, so protect it like a private key. Restore only into a new, empty
state directory:

```text
sudo install -d -o codetether-relay -g codetether-relay -m 0700 /var/lib/codetether-relay-restored
sudo -u codetether-relay -- /usr/local/bin/codetether-relay restore --backup /var/backups/codetether-relay/relay-2026-09-03 --state-dir /var/lib/codetether-relay-restored
```

Stop the service before switching its configured state directory. Verify the
restored fingerprint with `identity`, update the configuration intentionally,
and start the service. A correct restore retains Relay identity, enrollments,
revocations, and grants. It never contains client private keys or CodeTether
product data. Do not merge two state directories or restore over live state.

For an upgrade, first create and protect a backup, stop the service, replace only
the executable while keeping the state directory, then start and verify
`/readyz`, the application fingerprint, peer reconnect, and absence of duplicate
registrations. Unsupported database or wire versions fail closed. Changing
hostname or IP is safe when clients intentionally update the endpoint and the
pinned application identity remains the same. A different Relay identity must
never be accepted silently.

Phase 7B changes the Relay wire protocol from version 1 to version 2 but adds no
durable channel table. Upgrade the Relay, Desktop/Host, and Node as one planned
compatibility set; mixed version-1/version-2 peers disconnect and reconnect with
a safe incompatibility diagnostic rather than negotiating down. The upgrade
continues to use public TCP 443 only. Do not add another security-group rule,
publish loopback TCP 9443, expose SQLite, or expose development ports.

To roll back, stop the version-2 participants and restore the matching Phase 7A
Relay, Desktop/Host, and Node artifacts together. Keep the validated Relay state
directory (or restore its consistent pre-upgrade backup), verify the unchanged
application fingerprint, then verify version-1 peer reconnect and authorized
presence. Rolling back only the Relay or only one peer is intentionally
incompatible. Direct LAN transport remains independent while reachable.

Phase 7C rollback restores the matching frozen Phase 7B Desktop/Host and Node
artifacts at `b0f74f5` while preserving Relay protocol-v2 identity, state,
enrollments, and grants. Restore the Relay artifact only if Phase 7C changed
it. Verify the unchanged Relay and Machine identity pins plus Direct and Relay
operation after rollback; never downgrade Machine traffic to plaintext.

The verified Phase 7C claim is deliberately narrow: the Relay application does
not need plaintext for Machine application traffic and does not decode Prompt,
Provider output, Tool activity, Project paths, credentials, or native Provider
session identity. Operators can still observe peer relationships, ordinary TLS
handshake metadata, timing, counts, frame sizes, and byte volume and can disrupt
availability. Phase 7C does not claim traffic-analysis resistance, anonymity,
compromised-endpoint protection, or availability against a malicious Relay.
