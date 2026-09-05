# Phase 7D Network Roaming and Internet Reliability

## Scope

Phase 7D makes the accepted Direct and Internet Relay transports recover
predictably from ordinary network movement and outages. It does not change the
Machine protocol, Provider adapters, Provider capability matrices, Conversation
or Turn model, execution-ownership boundary, durable `actionId` semantics, or
the Phase 7C end-to-end TLS security claim.

The reliability rule is:

> Network location is ephemeral. Cryptographic and product identity is durable.
> Idle connectivity may recover automatically, but an uncertain active Turn is
> never migrated or replayed.

This phase covers normal reconnect, address/interface changes, temporary DNS
or Relay failure, stale sockets after suspend, bounded offline retry, status
recovery, and new-Turn route selection. It does not implement Mobile, Push,
VPN, generic tunneling, NAT hole punching, STUN/TURN/WebRTC, offline Prompt
delivery, multi-Relay failover, or a new routing protocol.

## Durable identity versus network location

The following are durable identities or bindings:

- Controller identity and endpoint-local private key;
- Node identity and endpoint-local private key;
- CodeTether `machine_*` identity;
- exact Controller-to-Node pairing and SPKI pins;
- Relay application-identity pin, peer enrollment, and reciprocal grant;
- `(projectId, machineId)` Project Location;
- Conversation, Provider, Turn, durable Start `actionId`, and private native
  Provider-session identity.

The following are ephemeral routing or liveness state:

- private/public IP address, DNS answer, interface, source port, and NAT
  mapping;
- Direct socket candidate and authenticated connection;
- Controller and Node Relay TLS sockets;
- Relay connection epoch;
- process-private Relay Machine route generation, composed from the Controller
  epoch and current Node rendezvous/presence sequence;
- Relay Machine channel ID and generation;
- inner Machine TLS session and traffic keys;
- reconnect delay/timer and current presence observation;
- Web SSE connection and process-local replay cursor.

Changing an ephemeral value cannot create, replace, revoke, or silently rotate
a durable identity. An address change requires no Machine re-pairing, Relay
re-enrollment, Project Location recreation, Conversation rebind, or Provider
session replacement. Conversely, reaching the same address with a different
cryptographic identity fails closed; roaming is not trust-on-first-use.

## Connection ownership

There is one reconnect authority per logical connection owner:

| Connection                | Sole owner                                                                                   | Work it may recover                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Web to loopback Host SSE  | one application-scoped `HostRuntime`                                                         | bootstrap, Snapshot/replay/reset, observation                             |
| Controller to Relay       | Host Controller Relay coordinator, one worker per configured Controller/Machine relationship | Relay authentication, presence subscription, future channels              |
| Host to trusted Machine   | Host remote-Machine coordinator, one idle worker per Machine                                 | Direct/Relay qualification and future operations                          |
| Node to Relay             | one Node Relay manager                                                                       | Relay authentication, reciprocal grant publication, future channel offers |
| Active Provider execution | existing exact Machine/Provider session owner                                                | no transport reconnect or migration                                       |

React, Desktop windows, Provider adapters, Project Locations, Conversations,
Turns, and Relay channels do not create additional reconnect loops. A manual
retry or platform lifecycle hint expedites the existing owner; it does not
become another socket owner.

## Bounded backoff and coalesced wake

The Relay and Machine owners use a shared timing-only
`ReconnectWakeCoordinator`. The connection owner still owns its socket,
authentication, AbortController, and current generation. The coordinator owns
only:

- one current exponential-backoff value;
- at most one active timer/waiter;
- one level-triggered pending wake bit;
- one monotonic authenticated-stability interval;
- a closed state for bounded teardown.

`requestWake()` is idempotent until the worker consumes it. One thousand
near-simultaneous socket-close/network/resume/manual triggers can therefore
expedite one attempt, not create one thousand timers or sockets. A wake aborts
the current candidate or closes the stale idle connection and advances the
same worker. It does not open a Provider session or send an application
request.

Default production timing is:

| Owner                   | Initial | Maximum |  Jitter |       Stable reset |
| ----------------------- | ------: | ------: | ------: | -----------------: |
| Controller Relay        |     1 s |    60 s | 80–120% | 60 s authenticated |
| Node Relay              |     1 s |    60 s | 80–120% | 60 s authenticated |
| Host idle Machine route |     1 s |    30 s | 80–120% | 60 s authenticated |
| Web Host SSE            |  500 ms |    60 s | 80–120% |     60 s connected |

Backoff does not reset merely because a handshake briefly succeeded. A
connection must stay stable for the reset interval. This prevents a flapping
network from continuously retrying at the initial rate. Service-provided retry
delay is a bounded minimum within the same maximum. Shutdown closes the
coordinator, cancels its one timer, and settles its waiter.

Elapsed reconnect and heartbeat decisions use monotonic time where duration
correctness matters. Wall-clock time remains only for bounded user-facing and
durable observations. A wall-clock adjustment or resume-time jump cannot
manufacture a stable interval or replay every timer that would have elapsed
during sleep.

## Connection generations and stale-state rejection

Every reconnectable worker has a lifetime plus an abortable connection cycle.
An asynchronous dial result is accepted only when all of the following are
still true:

- the owning worker is still the current worker for that Machine/peer;
- its lifetime is open;
- its exact cycle was not invalidated by a wake, shutdown, reconfiguration, or
  replacement;
- endpoint and peer identity checks succeeded.

A late result is closed before it can publish online state, update endpoint
preference, persist authentication time, install handlers, or start discovery.
After authentication, either endpoint's Relay replacement creates a new
ephemeral Machine route generation:

```text
same durable identities
        +
new Controller Relay epoch (Controller replacement)
        or
new Node rendezvous/presence sequence (Node replacement)
        +
new Controller/Node Machine route generation
        +
new Relay Machine channel generation
        +
fresh non-resumed inner Machine TLS session
```

Phase 7B channel binding rejects old epoch/generation/sequence traffic. A
current Relay rendezvous observation advances the bounded process-private
Machine route generation before status publication, including an
online-to-online Node connection replacement that leaves the Controller epoch
unchanged; ordinary heartbeats do not advance it. Host qualification and its
idle Machine worker bind to that composite generation and are synchronously
invalidated before old-route callbacks can publish current state. Phase 7C
requires a fresh TLS 1.3 handshake and exact end-peer pins. Host Machine workers
reject a stale dial callback, and the Web runtime rejects an old loop generation
or old Host `<epoch>:<seq>` event. Delayed `online`, `offline`, socket-error,
channel-close, Machine-TLS, or observer events therefore cannot mutate a newer
generation.

Connection epochs, Machine route generations, channel IDs, timers, pending
wakes, and current interface state are process-local and are never written to
product or Relay persistence. Startup always reconstructs connectivity from
durable configuration and trust.

## Recovery state machine

The compact conceptual lifecycle is:

```text
disabled
   |
offline -> connecting -> authenticating -> online
   ^             |             |            |
   +-------------+-------------+-- reconnecting
```

Boundary-specific public enums remain authoritative:

- Relay exposes `not_configured`, `enrollment_required`, `connecting`,
  `connected`, `reconnecting`, `offline`, `identity_mismatch`,
  `authentication_failed`, `revoked`, and `incompatible`;
- Machine exposes `connecting`, `online`, `offline`, `recovery_required`,
  `authentication_failed`, and `incompatible` for a remote Machine;
- Web-to-Host observation exposes `connecting`, `connected`, `reconnecting`,
  `unavailable`, and `incompatible`.

The conceptual `authenticating` step is not a promise of a separate UI state.
It explains why an open socket is not yet `online`. Status becomes online only
after the relevant authentication and identity checks. Recoverable short
failure can remain reconnecting while bounded retry proceeds; a lasting outage
becomes truthful offline/unavailable without deleting configuration or trust.

## Direct recovery and address mobility

The Direct route preserves the Phase 6B.2 model:

1. Load the bounded private endpoint hints for the exact trusted Machine.
2. Try the preferred and fallback candidates through one worker.
3. Require TLS 1.3, `codetether-machine/1`, exact paired SPKI identity,
   Controller/Node/Machine identity, and protocol validation.
4. Promote a new or recovered candidate only after authentication.
5. Treat temporary reachability failure as current connectivity failure, not
   trust failure.

An authenticated semantic handoff remains an uncertainty boundary. A
purpose-specific operation that may have reached Node does not silently try a
second Direct address or Relay path. A later idle cycle can requalify Direct,
and a later explicit operation can select it.

Phase 7D does not add LAN discovery or trust a hostname, subnet, SSID, IP, or
recently observed route as identity. Explicit endpoint recovery remains the
only way to add a new Direct hint.

## Relay recovery, DNS, and endpoint mobility

Controller and Node Relay connections authenticate by durable endpoint keys,
enrollment records, and the independently expected Relay identity. Their
source IP, source port, and interface may change. A Controller reconnect creates
a new connection epoch without re-enrollment. A Node reconnect is also visible
to an unchanged Controller connection as a fresh rendezvous observation and
therefore advances that Machine's composite route generation.

For a hostname endpoint, each new TLS connection uses the normal Node.js/OS
resolution path rather than a CodeTether-owned permanent resolved-IP cache.
After connection or network failure, a later attempt can therefore receive a
new DNS answer. The new endpoint is usable only when outer TLS policy and the
pinned Relay application identity still validate. Temporary resolution
failure is a recoverable Relay/network condition; it does not become Provider
unavailability, Machine unpair, or Relay deletion. Direct-IP deployments remain
supported and do not require a hostname.

Phase 7D does not implement a custom DNS resolver, DNS-over-HTTPS, captive
portal detector, arbitrary HTTP/SOCKS proxy configuration, or automatic
secondary Relay.

## Presence and execution eligibility

Relay presence is a current authenticated-control-connection observation. A
Node that loses that connection ages out through the existing bounded Relay
heartbeat/timeout path rather than remaining online indefinitely. Reconnect
publishes a new current presence observation. `lastConnectedAt` and other safe
timestamps may explain prior state, but they do not make it current.

Presence is necessary but insufficient for Internet execution. Relay execution
also requires current Controller authentication, reciprocal authorization,
current Node presence, a fresh channel, verified inner Machine TLS, exact
Machine trust, a valid Project Location, Provider eligibility, runtime
capacity, and a free Conversation. Direct status remains independent. The UI
can therefore truthfully represent either:

```text
Direct unavailable + Relay connected + Node online -> ready via Relay
Direct available + Relay offline                  -> ready via Direct
Neither transport usable                          -> temporarily unavailable
```

Historical Turn failures remain immutable when current connectivity recovers.
A later successful connection/Turn may restore current status without
rewriting old evidence.

## Idle recovery versus active execution

Idle recovery may happen automatically for:

- Controller and Node Relay control connections;
- Direct Machine route qualification;
- Relay Machine transport qualification and future channel creation;
- current presence;
- the Web observer and its durable Snapshot/replay projection.

Active Provider execution does not receive transparent transport continuity.
Once an operation chooses Direct or Relay, that transport remains fixed for
the execution generation. If certainty is lost:

- the old Turn does not migrate between Direct and Relay;
- the Prompt is not resent over a new socket/channel;
- a reconnect or Relay ACK does not establish Provider ownership;
- the durable Start `actionId` is not regenerated;
- no offline/deferred Prompt queue is created;
- the frozen ownership model publishes one safe completed, failed, or
  interrupted outcome based only on known evidence.

After the old Turn is terminal, a separately authored Turn with its own new
action may use whichever route is currently qualified. Replaying the same
durable `actionId` after routing changes still resolves to the original action
or canonical conflict and cannot start a second Provider execution.

## New-Turn route requalification

Transport choice is reevaluated for every new explicit operation:

```text
authenticated Direct usable    -> Direct
Direct unusable + Relay usable  -> Relay
both unusable                   -> no execution
```

The routes are not raced. A socket-open callback, Relay presence callback, or
network-restored signal cannot itself start a Turn. An identity/protocol error
and a potentially accepted semantic operation remain authoritative and stop
fallback exactly as in Phase 7B. Transport becoming available during an
already admitted Turn cannot create a second execution.

An authenticated Relay control epoch that encounters a channel/control
protocol failure is retired in full and may reconnect through the same bounded
coordinator. Exact terminal channel bindings remain as short bounded
tombstones so already-queued data or acknowledgements cannot turn a scoped
channel failure into a stranded Node. This reconnect never reuses a Machine
channel or replays a semantic operation. Relay identity mismatch, protocol
incompatibility, revocation, and registered-peer authentication failure remain
terminal until their explicit frozen recovery action.

## Suspend, resume, Tray, and Windows session behavior

The Windows Desktop continues to own one Host sidecar. Suspend does not stop or
restart that Host. On each coalesced native resume cycle:

1. the Desktop sends one private
   `network-restored desktop_resume <generation>` line to its exact Host;
2. Host lifecycle parsing admits only strictly increasing positive safe
   generations;
3. Host asks the existing Controller Relay and remote-Machine workers to wake;
4. the existing exact-owned-Host health/identity probe validates the sidecar;
5. the Desktop emits its bounded `desktop-resumed` event to the one Web
   runtime;
6. stale candidates/connections are discarded and fresh identity-authenticated
   generations are established as needed;
7. Web validates the owned Host epoch and rebuilds/replays through the frozen
   SSE rules.

Duplicate resume indications coalesce and cannot create another worker,
Desktop window, Host, SSE runtime, Provider process, or Prompt. A suspend during
an active Turn still follows fail-closed execution ownership; resume repairs
future connectivity only.

Window visibility is separate from runtime state. Close-to-Tray, a locked
Windows session, and display-off keep the existing Host ownership model and do
not create alternate connection/key paths. Restoring the window reads current
Host truth. Normal shutdown cancels reconnect waits, closes sockets/channels,
removes native listeners with their owner, and performs the established
bounded process cleanup.

No physical-Linux suspend listener is added. The Node normally detects a stale
connection through Relay socket/heartbeat closure and reconnects through its
single manager. WSL2 stop/start or network regeneration may validate Node
address mobility, but is not evidence of physical Linux sleep/wake behavior.

## Offline startup and long-offline behavior

Starting Desktop/Host or Node without Relay/Internet connectivity must still
load durable identity and local state, then start exactly one bounded
coordinator per configured owner. The application does not assume pre-crash
sockets survived. History, Search, Rename, Pin, Archive/Restore, Inbox,
Attention, Conversation detail, Project detail, and last-known Machine detail
remain cold-readable. Local Providers remain independent of Relay reachability.

While offline:

- exponential backoff remains capped;
- there is one timer/waiter per owner and no accumulated retry history;
- provider discovery does not run continuously and no Provider starts merely
  because connectivity is absent;
- Machine trust, enrollment, pins, Locations, Conversations, and sessions are
  retained for hours or days;
- the Composer does not queue a Prompt for future automatic execution.

When connectivity returns, the same workers reauthenticate and future
execution becomes eligible without restarting the application. Relay-first,
Node-first, Controller-first, or Controller-last recovery all converge through
the same durable identities and fresh generations.

## Provider and Project continuity

Relay/Direct connection generations are ephemeral; Codex and Claude native
session identity is not. A new explicit Turn after network recovery resumes the
same native session through its owning Provider and Machine when the Provider
supports resume. CodeTether does not replay the transcript or replace the
Provider session solely because an IP, interface, Relay epoch, or inner TLS
session changed.

Project Location remains exactly `(projectId, machineId)`. Network movement
does not create, relocate, or rewrite it, and Node still revalidates its exact
canonical root before every Provider start/resume.

Provider installation discovery remains distinct from connectivity and
execution health. The idle Machine worker waits for a short stable connection
window before scheduling at most one discovery for the current generation. If
the route flaps before that window, its timer is cancelled. Reconnect therefore
does not spawn a provider probe on every transient transition, and cold reads
do not probe or hydrate a Provider.

The eight-second Machine Provider-discovery response budget remains separate
from purpose-specific Provider session opening. Session ready is bounded at 90
seconds: three sequential Provider-admission probes may consume five seconds
each, cold Codex initialize and thread start/resume may consume 30 seconds
each, and 15 seconds remains as a bounded transport/scheduling margin. A
timeout after Machine authentication remains an uncertain session-open
failure: it closes that route and never falls back or reissues the semantic
operation.

## Web and SSE recovery

The Web `HostRuntime` retains one application-scoped stream authority. It uses
bounded jittered exponential reconnect rather than a fixed hot loop and resets
that delay only after stable connectivity. A Desktop resume can abort a stale
bootstrap or half-open stream, but repeated resume notifications collapse into
one requested recovery.

On reconnection, the Host epoch/sequence cursor, bounded replay, `stream.reset`,
Snapshot replacement, duplicate rejection, and sequence-gap rules remain the
only projection authority. Reconnecting one or several observers never sends a
Machine request, starts a Provider, replays a Prompt, or creates another Turn.
Terminal Attention and Desktop notifications remain keyed to the one durable
product outcome rather than to transport connection events.

## Diagnostics and user experience

Existing typed statuses and Phase 6D canonical failures remain the product
boundary. Normal copy distinguishes temporary Relay/network loss, Node
offline, Machine transport unavailable, identity/authentication failure, and
Provider failure without displaying raw `ECONNRESET`, DNS-library text, TLS
stack traces, socket details, or retry timers.

`reconnecting` is a real temporary state, not execution readiness. The UI does
not report online before authentication, and it does not hide a long outage
behind false online state. Relay status, Node presence, Direct status, and
execution eligibility remain separate. Status is conveyed with text as well
as color. Short recoverable flaps do not create one Attention/notification per
transition; one connectivity-caused terminal Turn produces at most its one
canonical Attention/notification.

## Resource and lifecycle bounds

The reliability path remains bounded by:

- one reconnect worker and at most one reconnect timer per logical owner;
- one pending coalesced wake per worker;
- one active candidate/current socket per connection cycle;
- existing bounded Direct endpoint candidates;
- existing Relay peer/channel/frame/queue limits;
- existing Machine frame/event/backpressure limits;
- one stability-delayed Provider-discovery timer per connected Machine;
- one application-scoped SSE stream and bounded replay/live queue;
- process-local current generations rather than persistent flap history.

Repeated network flaps must return sockets, channels, timers, listeners,
tombstones, waiters, discovery tasks, and SSE subscriptions to steady state.
The reconnect path cannot bypass Provider/runtime capacity or transport
backpressure. Relay heartbeat and uptime duration accounting uses a monotonic
clock; public observed timestamps remain wall-clock values.

## Security preservation

Roaming changes routing only. Direct and Relay still require:

- TLS 1.3-only `codetether-machine/1` sessions;
- exact paired Controller/Node SPKI and Machine identity;
- no plaintext fallback, TLS resumption, or 0-RTT execution data;
- endpoint-local private keys and Node-local Provider credentials;
- Relay application identity verification and reciprocal authorization;
- opaque bounded Relay payload forwarding with no Agent logging/persistence.

An address or DNS change cannot invoke an insecure override or replace a pin.
Unexpected Controller, Node, Machine, or Relay identity fails closed. Phase 7D
does not weaken Phase 7C to improve availability.

## Production and platform limitations

The production topology remains one accepted Alibaba Relay: public TCP 443 and
loopback-only management TCP 9443. Phase 7D requires no new public port, second
Relay, firewall rule, public Node listener, or generic tunnel. The Relay still
controls availability even though it cannot decode Machine application data.

CodeTether cannot promise recovery until the platform offers usable Internet.
Known normal limitations include captive portals, networks blocking outbound
443, corporate proxy requirements, DNS filtering, severe packet loss, ISP
outage, and platform networking bugs. This phase does not add captive-portal
detection or general proxy support. IPv4/IPv6 behavior remains that of the
existing Node.js/OS stack and configured endpoints; full IPv6 roaming is not a
separate validated claim.

The primary Controller is installed Windows Desktop. WSL2 Ubuntu 24.04 is a
production Linux Node artifact/runtime target but does not prove physical
Linux power or radio behavior. Carrier cellular roaming, every NAT type,
physical Linux beyond the available environment, and 24-hour reliability are
valid separately classified validation gaps rather than reasons to invent
evidence.

## Validation boundary

Phase 7D validation combines:

- deterministic 100-flap and 1,000-trigger coalescing fixtures;
- stale Relay/Direct/Machine/channel/SSE generation checks;
- simulated address/DNS/lifecycle transitions with exact identity continuity;
- Direct/Relay/both-unavailable routing and no-mid-Turn-migration tests;
- durable `actionId`, Attention, notification, Provider-discovery, and
  backpressure regressions;
- REAL Internet Direct/Relay Provider, native resume, Tray, restart/outage,
  long-offline, and strongest-practical network-address mobility evidence;
- a mostly idle long-duration production reliability session with bounded
  Relay, Host, and Node resources.

Evidence classification must distinguish `REAL`, `REAL INTERNET`,
`REAL INSTALLED DESKTOP`, `REAL VM`, `OWNER-ASSISTED REAL`, `AUTOMATED`,
`SIMULATED`, and `NOT OBSERVED`. Disconnecting and reconnecting on the same
route is not proof of a changed public source route. WSL regeneration is not a
physical Linux roam. No public IP, Prompt, Provider output, credential,
private key, or native Provider-session identity belongs in evidence.

## Rollback

Phase 7D adds no product or Relay database schema and no durable network-state
migration. Safe rollback is a coordinated return of Desktop/Host, Node, and
Relay runtime artifacts to frozen Phase 7C commit
`f42a9880090068ee8dcc1ad0d6bb4862f15dedea` when a changed Relay artifact was
deployed. Stop the current process/service normally, restore the matching
artifact, and start it against the same accepted durable state.

Rollback preserves Relay identity, peer enrollment, reciprocal grants,
Machine trust and credentials, Project Locations, Conversations, Turns,
durable `actionId` entries, and private Provider-session identities. It removes
only the Phase 7D reconnect/wake hardening and does not repair or replay an
interrupted Turn. Direct execution remains available according to the frozen
Phase 7C route and current network reachability.

## Phase 8 boundary

Phase 7D leaves typed status, centralized connection ownership, durable state
independent of sockets, and fail-closed transport-loss semantics suitable for a
future client. It does not implement iOS, Android, APNs, FCM, mobile UI, mobile
background execution, mobile battery policy, or mobile-specific suspension.
Those require a separate Phase 8 specification and product decision.
