# CodeTether Architecture

## Status

Owner accepted and froze **Phase 8C** at `67c71f2e3ad390004cc60fe30925224a02aba485`
with 129 / 129 criteria passing. **Phase 8D** is now authorized for implementation
only: distribution, POSIX sidecar supervision, user-service installation, native
bundle configuration, bounded platform discovery and release identity/checksums.
REAL macOS and physical Linux acceptance is pending. This supersedes older
current-scope wording below, without changing any frozen product authority.
See [Phase 8D architecture, support matrix and REAL handoff](PHASE8D-CROSS-PLATFORM-DISTRIBUTION.md).

Distribution adds no SQLite migration, Provider profile or Machine protocol.
Windows Job Objects remain unchanged. A private POSIX guardian reserves the owned
Host process-group leader until cleanup, accepts only the packaged Host launch,
and observes the Desktop parent pipe. Linux systemd user and macOS LaunchAgent
installers retain durable identity and do not import shell credentials. The root
product version and clean Git build identity bind release artifacts; SHA-256 and
native receipt checks never turn build success into REAL platform support.

Phase 1 Frontend Experience is accepted and frozen as **CodeTether V2 Frontend Core v1**. Phase 2A and Phase 2A.1 are accepted and frozen as **Phase 2A Codex Runtime v1**. Phase 2B is accepted as the versioned local Client-to-Host boundary: HTTP commands, an SSE event stream, CodeTether-owned public identities, in-memory snapshot/replay, and a non-React client.

Phase 2C.1 is accepted, and Phase 2C.1.1 is frozen as **Live Conversation Read Model v1**: one application-scoped Web runtime connects the frozen Conversation Detail to Protocol v1, while bounded Host-owned history reconstructs the same retained multi-Turn view after initial load, refresh, reconnect reset, or live event application. Phase 2C.2 is accepted and frozen as **CodeTether Local Codex Alpha v0.1**, connecting only the existing text Composer, one-shot Approval actions, and Interrupt control. Phase 2D audited and stabilized this boundary without adding product scope.

**Phase 3A — Minimal Durable Persistence** is implemented and validated. A small `node:sqlite` boundary in the local Host preserves CodeTether Conversation/provider identity and normalized per-Turn snapshots across restart, while a later Turn lazily resumes the saved Codex Thread. A real isolated restart walkthrough confirmed Timeline reconstruction and retained provider context.

**Phase 3B.1 — Durable Project Identity & Local Workspace Authorization** is implemented and validated. The Host now owns durable `proj_*` Project identities and canonical authorized local roots. Every durable Conversation references one Project, while its `cwd` remains a contained working directory. Availability is computed from the filesystem, and every new Turn re-authorizes the saved root before Codex runs.

**Phase 3B.2 — Real Projects UI** is implemented and validated. The Web app reads and mutates the existing Project API through `packages/client` and TanStack Query. It provides real Project list/add/detail/remove routes while the Host remains the sole authority for Project records, path authorization, availability, duplicate registration, and deletion conflicts.

**Phase 3C.1 — Durable Conversation Index & Title** is implemented and validated. SQLite now owns a Project-scoped product-history index distinct from the bounded Runtime Snapshot. Every Conversation has one durable deterministic title and a dedicated activity clock, and Protocol v1 exposes bounded summary reads without provider Thread or workspace-routing metadata.

**Phase 3C.1.1 — Durable Conversation Detail & Bounded Runtime Hydration** is implemented and validated. A single-Conversation durable read now reconstructs a bounded recent Timeline independently of runtime admission or Codex availability. Control of a cold Conversation hydrates that durable state into the bounded Host working set and resumes its saved provider Thread only when a new Turn actually starts.

**Phase 3C.2 — Real Conversations Experience** is implemented and validated. The real Project-scoped Conversations page, Conversation Rail, Current Project context, breadcrumbs, and minimal Codex-only New Conversation flow now consume the durable Project/Conversation APIs through `packages/client` and TanStack Query. Cold and live Conversation routes still converge on one normalized Conversation ViewModel; React does not learn hydration or provider identity.

**Phase 3D.2 — Real Inbox UI** is implemented and validated. SQLite owns a low-frequency, Conversation-linked index of real Approval, completed-review, and failed-Turn Attention. Protocol v1 exposes typed list/resolve commands and reliable semantic SSE transitions without exposing provider requests or turning Runtime Snapshot into Inbox storage. The real Inbox and Sidebar count now consume that boundary through `packages/client` and TanStack Query.

**Phase 3E.1 — Approval Interaction Layout Stabilization** is implemented and validated. Actionable Approvals now occupy a bounded Pending Action Dock outside the independently scrolling Timeline, with stable Inspector/Composer layout, exact identities, and deliberate scroll/focus behavior.

**Phase 4A — Tauri Desktop Shell Foundation** is implemented and validated. `apps/desktop` packages the existing Web application and supervises a revision-coupled Node SEA build of the existing Host. It adds native application/window/process lifecycle without moving Project, Conversation, Attention, persistence, Agent, Protocol, or projection logic into Rust.

**Phase 4B — Native Folder Picker** is accepted and frozen. Tauri 2.11.x and the official Rust dialog plugin 2.7.2 expose one directory-only `pick_project_directory` command with an exact main-window capability. React receives only the selected path string; the existing Host Project API still owns canonicalization, authorization, duplicate identity, persistence, and safe errors.

**Phase 4C — Desktop Notifications** is implemented, validated, accepted, and frozen. New `attention.created` events are the sole arrival trigger for privacy-bounded Approval, completed-review, and failed-Turn notifications. A centralized Desktop adapter, pure foreground suppression, process-scoped Attention-ID deduplication, validated click intents, and three persisted application preferences add delivery without moving Attention truth into Tauri.

**Phase 4D — Desktop Product Polish & Dogfooding** is implemented, validated, accepted, and frozen. Its changes remain inside the shared Web presentation layer: deterministic Tool disclosure, safe Agent-message Markdown, display-only contained-path shortening, public Turn/Diff anchors, and denser truthful product surfaces. Durable records, Runtime projection, Protocol v1, Host ownership, native capabilities, and Browser/Desktop component identity are unchanged.

**Phase 4E.1 — Durable Conversation Organization Model** is accepted and frozen at `afac51a`. SQLite migration 005 and additive Protocol v1/Client contracts make manual title ownership, Pin, and Archive durable without changing provider identity, history, Attention truth, or `lastActivityAt`. Organization writes remain Provider-independent.

**Phase 4E.2 — Conversation Organization UI** is accepted and frozen at `84de855`. The shared Web/Desktop React tree consumes that accepted model through archive-aware TanStack Query indexes, exact Client mutations, and `conversation.updated` invalidation. Active/archived URL state, Rename/Pin/Archive/Unarchive controls, archived Detail/Composer presentation, and a bounded current-archived Rail context add no durable or provider state to React.

**Phase 4F.1 — Durable Conversation Search Model & API** is accepted and frozen at `38481ad`. SQLite migration 006 owns a normalized title/canonical-User-input projection, while additive Protocol v1 and Client contracts expose a strict Project-scoped, filtered, cursor-paginated Search read. Search never depends on Runtime hydration, provider availability, Project filesystem availability, or `snapshot_json`.

**Phase 4F.2 — Search UI & History Discovery** is accepted and frozen at `545db8c`. The shared Browser/Desktop Project Conversation List and Rail use explicit Browse and durable Search query modes, URL-backed query/archive state, debounced abortable TanStack Query reads, and bounded cursor Load More. Match explanation and public Turn navigation remain presentation concerns; Search and its organization/realtime integration do not add client-owned durable state, Runtime admission, provider control, or native capability.

**Phase 4G.1 — System Tray & Background Runtime Foundation** is accepted and frozen at `cee3a71`. The Rust shell creates one native tray after Host readiness, treats main-window X/Alt+F4 as hide rather than application exit, restores the same ready window through one function for Tray/notification/single-instance activation, and reserves the existing 12-second bounded graceful Host shutdown for an idempotent explicit Tray Quit. This changes window/application lifecycle only; Host, Runtime, Attention, notification, and provider truth remain where they were.

**Phase 4G.2 — Windows Session & Background Reliability** is accepted and frozen at `f576b05`. One explicit Desktop lifecycle reducer keeps application, window, Windows system/session, and owned-Runtime states independent. Sleep never forces Host shutdown or restart; one bounded exact-owned-Host identity probe is admitted per resume cycle, and the existing Web HostRuntime then reconnects its one SSE stream through the accepted cursor/reset path. Windows session-end query is memory-only and prompt, while confirmation receives a separate 2-second best-effort termination budget. Abnormal parent loss remains bounded by the Job Object plus durable restart reconciliation, and Explorer tray recovery stays within the pinned Tauri/`tray-icon` implementation. Its evidence classifications remain part of the frozen boundary.

**Phase 5B — Claude Code Capability Expansion** is accepted and frozen at `5dac13c`. Protocol v1 continues to define durable `codex | claude-code` identity, presentation-safe Provider descriptors/capabilities, provider-neutral Tool kinds, and canonical Provider errors. Migration 007 remains unchanged, one Host-owned registry selects the adapter for each immutable Conversation Provider, and both adapters share the existing Runtime admission budget and unified product API. Claude's bounded detection, structured process arguments/JSONL stdin, native session create/resume, Provider-owned effort options, and normalized text/Tool events remain frozen. Approval, reliable interrupt, edit, shell, Diff, and model selection remain intentionally unsupported.

**Phase 6A — Durable Machine Foundation** is accepted and frozen at `0858fc7`. SQLite migration 008 creates exactly one durable local Machine, separates logical Project identity from a Machine-scoped authorized Project Location, and backfills every Conversation with the same required immutable Machine identity. Protocol v1/Client add strict Machine list/detail reads and require `machineId` for ordinary Conversation creation. Machine and Provider registries remain separate.

**Phase 6B.1 — Remote Node Identity & Secure Pairing** is accepted and frozen at `30559a3`. A minimal CodeTether Node owns a durable random Machine identity and private cryptographic identity. The local Host coordinates explicit short-lived PAKE pairing, user confirmation, durable pinned trust, mutually authenticated reconnect, bounded heartbeat, truthful availability, and unpair. The remote wire protocol is private to the Host/Node boundary; Web still uses typed Protocol v1.

**Phase 6B.2 — Secure Connection Recovery & Address Mobility** is accepted and frozen at `53e7c21`. Trust continues to be the pinned Node identity rather than an address. The Host retains a bounded private set of authenticated endpoint hints, tries them through one cancellable per-Machine reconnect coordinator, and authenticates a manually supplied recovery address before promoting it.

**Phase 6C.2 — Remote Codex Execution Foundation** is accepted and frozen at `0b60dc6`. Its exact remote Codex text-streaming/native-resume session, process ownership, private native identity, and fail-closed behavior remain unchanged.

**Phase 6C.3 — Remote Claude Code Execution Foundation** is accepted and frozen at `4239cc3`. It extends the existing authenticated remote Provider-session boundary to Claude Code without changing Conversation, Machine, ProjectLocation, trust, reconnect, or Codex semantics. A fixed Node-owned restricted Claude profile admits only streaming, native resume, Read/Glob/Grep Tool events, and validated effort. Provider-specific raw streams, credentials, private session identity, executable resolution, argv, and environment remain Node-private; Edit, Write, shell, Diff, Approval, interrupt, model selection, generic RPC/filesystem access, synchronization, discovery, and relay remain absent.

**Phase 6C.4 — Remote Execution Hardening** is accepted and frozen at `01e749c`. It hardens both accepted remote Provider paths with durable Turn-start admission identity, no-replay handling for uncertain execution, bounded transport/event/reconnect resources, an authenticated execution-session heartbeat and Node-side Controller lease, exact Linux parent-death process-group cleanup, hydration-aware disposal, and safe stale-lock recovery. It does not change public Provider capabilities, Conversation APIs, Tool permissions, UI, trust, or Project Location semantics.

**Phase 6D — Provider Failure Diagnostics & Recovery UX** is accepted and frozen at `cb2c412`. It layers one strict CodeTether-owned `CanonicalFailure` model, durable failed-Turn metadata, bounded recent Provider execution health, upstream Codex/Claude/transport/runtime classification, and controlled recovery presentation over the frozen local and remote execution paths. It adds no Provider capability, credential flow, automatic login, Provider/Machine/directory fallback, automatic Prompt replay, continuous Provider polling, or raw-log surface.

**Phase 7A — Internet Relay Architecture Foundation** is accepted and frozen at `67e2a98`. It adds a standalone Internet Relay and outbound-only authenticated Controller/Node control connections for enrollment, liveness, presence, and authorized rendezvous. Its frozen protocol is control-only and cannot carry Prompt, Conversation, Provider, Tool, filesystem, shell, Terminal, or arbitrary payload data.

**Phase 7B — Authenticated Relay Transport** is accepted and frozen at `b0f74f5`. It carries the existing authenticated Machine protocol through one purpose-bound, ephemeral Relay channel when the direct route is unavailable. Direct remains first, an active Machine session or Turn never changes transport, and the Relay adds no Provider capability, generic tunnel, arbitrary destination, account authority, Machine trust, or automatic Prompt replay.

**Phase 7C — End-to-End Security Hardening** is accepted and frozen at `f42a988`. It formalizes and hardens the existing nested TLS boundary: TLS 1.3-only Machine sessions, exact paired Controller/Node SPKI pins, mandatory pins for Relay-backed streams, no session-ticket reuse or early execution data, no plaintext fallback, endpoint-local private keys, opaque Relay payload forwarding, infrastructure-only Relay persistence, and controlled metadata-only observability. It adds no custom cryptography, Provider capability, or traffic-obfuscation system.

**Phase 7D — Network Roaming & Internet Reliability** is accepted and frozen at `abbcf38`. Durable identity remains independent from network location, one reconnect authority owns each logical connection, idle connectivity recovers automatically, and active Turns never migrate or replay uncertain Prompts.

**Phase 8A — Existing Session Discovery & Adoption** is accepted and frozen at `5d2f67c`. It adds request-scoped, Machine-local, Provider-specific metadata discovery for exact Project Locations; short-lived opaque public candidates; and atomic, idempotent adoption into the existing Conversation/private native-session binding. Discovery and adoption are read-only and perform no inference. Only a later explicit Turn uses the frozen native-resume path.

**Phase 8B — Provider Lifecycle & Compatibility** is accepted and frozen at `89808b2f2ffaddf2ab26552671176a3e5487483d`. It distinguishes Provider identity, Machine-scoped Provider installations, executable revisions, runtime compatibility, capability observations, and inference-backend readiness. Bounded Machine-local coordinators preserve one deterministic selected installation, revalidate changed revisions without model inference, and keep existing Conversation/history/native-session state available through incompatibility.

**Phase 8C — Zero-Config Onboarding & Doctor** is the current approved implementation scope. It adds a durable resumable setup-flow projection and a bounded Doctor composition over the accepted Desktop/Host, Machine, Provider lifecycle, Project Location, native-session discovery/adoption, secure pairing, and Direct/Relay authorities. Ordinary presentation hides internal topology through progressive disclosure, while advanced details retain safe canonical facts. Phase 8C does not add a second readiness authority, automatic Provider mutation, installation/backend/profile switching, generic remote command or filesystem access, weakened Machine trust, automatic session import, background inference, Prompt retry/replay, cross-platform distribution, Mobile, Remote Terminal, or Remote Files.

No Project discovery/scanning, Project or Location rename/relocate, multi-root Location on one Machine, cross-Project/global Search, Agent/Tool/Terminal/Diff/Approval or semantic Search, Search history/analytics, Conversation Delete/bulk organization/tags/folders/groups/old-Turn history pagination, read/unread Inbox history, remote execution beyond the exact accepted Codex/restricted-Claude profiles, LAN discovery, generic remote Provider data, Machine switching, notifications after explicit application exit, updater, OpenCode/third Provider, cross-Provider handoff, Claude capability parity, generic Relay tunnel, or general filesystem bridge exists. Host SQLite remains local durable product state, not a remote or multi-user service; the Relay owns a separate minimal infrastructure registry only.

Doctor's remote ProjectLocation check uses the existing narrow folder-validation operation on a bounded, pinned connection without replacing the heartbeat or refreshing Provider metadata. Contextual UI reads request this existing check for the selected Project rather than treating a prior folder check as current authority; global reads remain metadata-only. This avoids demoting a current backend execution observation merely by checking the folder. Execution admission and explicit Provider refresh retain their accepted lifecycle behavior; Doctor never promotes last-known health or opens a Provider session.

## System Context

The local Desktop path is:

```text
Tauri Desktop Shell
    ├── window / application lifecycle
    ├── Windows power / session lifecycle reconciliation
    ├── one native System Tray / explicit Quit
    ├── owned Host sidecar supervision
    ├── exact Project directory picker capability
    └── bounded Attention notification delivery / click activation
              │
              ▼
Existing Web UI
              │ Protocol v1 HTTP + SSE
              ▼
Local Host on 127.0.0.1
       ├──────┴────── Host-owned durable Machine + Project Location
       │                    │
       │                    └── Machine-scoped Provider composition
       │                        ├── Codex Adapter → Codex App Server
       │                        └── Claude Code Adapter → bounded Claude CLI child
       │
       └── Secure Machine Connection Boundary
                 │ encrypted authenticated LAN channel
                 ▼
          CodeTether Node
          └── purpose-specific Machine, Project Location, Provider discovery, and frozen direct execution runtime
```

Future web and mobile clients use the same host boundary:

```text
Mobile / Web
      │
      ▼
 Machine Host
```

Phase 7A adds a separate control-only Internet topology:

```text
Existing Web UI
      │ Protocol v1 on loopback
      ▼
Desktop-owned Host
      └── outbound TLS control connection ──┐
                                            ▼
                                  CodeTether Relay
                                            ▲
CodeTether Node                             │
      └── outbound TLS control connection ──┘

Direct Provider execution remains:
Desktop-owned Host ── authenticated direct Machine transport ──> CodeTether Node
```

Relay presence is only evidence that the peer's current authenticated control connection is live. It is not Machine pairing, Provider health, Project Location availability, or execution readiness. No WebView makes an Internet Relay connection, and no Relay path enters the Provider runtime in Phase 7A.

Phase 7B adds one authenticated data path without changing those ownership boundaries:

```text
Desktop-owned Host
  └─ existing Controller identity
      └─ inner TLS 1.3 Machine session
          └─ purpose-bound machine_tls_v1 Relay channel
              └─ public Relay TCP 443
                  └─ purpose-bound machine_tls_v1 Relay channel
                      └─ inner TLS 1.3 Machine session
                          └─ existing CodeTether Node dispatcher/runtime
```

The Relay routes only bounded opaque Machine TLS wire records between the exact authorized Controller and Node epochs. TLS handshake metadata and traffic shape remain observable, while Machine application records are TLS 1.3 ciphertext. The end peers still authenticate the frozen Machine identities and protocol, and only the existing Node dispatcher can admit Project Location, Provider session, or Turn operations.

The Host remains the runtime and durable product-state authority. Clients render normalized data and send explicit Protocol v1 commands rather than operating provider protocols directly. Tauri does not introduce a second business API: its private parent/child pipe is only a lifecycle channel, its Project-directory command only acquires an explicit user selection, and its notification commands accept and return only a bounded public `NotificationIntent`. Native code never queries, creates, resolves, or routes Attention.

## Monorepo Boundaries

```text
apps/web                   Frozen product UI and HostRuntime/Protocol consumer
apps/desktop               Tauri v2 window/tray and Windows session lifecycle, packaging, owned Host supervision, exact directory picker, and bounded notification delivery
apps/host                  Provider registry/runtimes, loopback Host API, and SQLite persistence
apps/relay                 Standalone TLS Relay service, minimal infrastructure persistence, connection ownership, presence, rendezvous, and bounded ephemeral Machine-channel routing

packages/ui                Shared design system
packages/protocol          Client-to-Host Protocol v1 and Zod wire contracts
packages/client            Small non-React HTTP/SSE Protocol v1 client
packages/agent-core        Minimal normalized runtime event contract
packages/machine-transport Private purpose-specific authenticated Host ↔ Node protocol over direct sockets or an existing bounded Duplex
packages/relay-protocol    Versioned bounded Relay control and machine_tls_v1 channel messages, framing, identity transcripts, and shared client/server primitives
packages/relay-client      Outbound authenticated Relay lifecycle, rendezvous, and purpose-bound Machine-channel Duplex
packages/adapter-codex     Codex App Server process, transport, and translation
packages/adapter-claude    Claude Code detection, safe process boundary, JSONL parsing, and event normalization
packages/adapter-opencode  Future OpenCode adapter placeholder
packages/shared            Environment-neutral shared utilities placeholder
```

Dependencies point inward toward stable contracts. UI code does not import Provider adapters. `packages/adapter-codex` and `packages/adapter-claude` depend on the minimal normalized contracts rather than product UI; `apps/host` is the only layer that owns and selects them.

## Verified Phase 2A Runtime

The verified spike path is:

```text
apps/host spike CLI
        │
        ▼
CodexAppServerClient
        │
        ▼
newline transport + pending request map
        │
        ▼
one long-running `codex app-server` child process
        │
        ▼
local Codex runtime

provider notifications
        │
        ▼
Codex normalizer
        │
        ▼
minimal CodeTether runtime events
```

The verified executable is `codex-cli 0.149.1`. Both JSON Schema and TypeScript protocol definitions were generated from that installed executable with:

```text
codex app-server generate-json-schema --out <directory>
codex app-server generate-ts --out <directory>
```

Generated output is ignored development evidence under `.tmp/`; it is not copied into source and is not a runtime dependency. The implemented protocol subset follows the generated schema rather than an older external enum or legacy CodeTether implementation. Real wire messages remain authoritative evidence: the 0.149.1 command-approval request included an additional `availableDecisions` field omitted by its generated binding. The client therefore parses required identity fields tolerantly and preserves raw diagnostic metadata instead of assuming generated output is exhaustive.

### Process and Transport

`packages/adapter-codex` owns one child process started with the App Server's stdio listener. It separates protocol stdout from diagnostic stderr, frames UTF-8 newline-delimited messages, generates request IDs, matches responses through a pending-request map, dispatches notifications and server requests, and rejects pending work on timeout or unexpected process exit.

Unknown notifications are logged and ignored. Malformed JSON, unknown response IDs, remote errors, startup failure, request timeout, and unexpected exit remain visible diagnostic errors. Shutdown closes stdin first, allows a grace period, and terminates the child only when necessary.

### Initialize Handshake

The successful sequence is:

```text
initialize
  clientInfo.name    = codetether
  clientInfo.title   = CodeTether
  clientInfo.version = repository package version
initialized
```

The generated Codex 0.149.1 envelope does not require a `jsonrpc: "2.0"` member. Request IDs may be strings or numbers. The `initialized` notification has no parameters.

### Thread and Turn

The original spike creates one Codex-owned ephemeral Thread with the isolated workspace's absolute path, `workspace-write` sandboxing, `on-request` approval policy, and user-reviewed approvals. Phase 2A.1 also creates non-ephemeral Threads when a cross-process resume scenario requires Codex persistence. Provider-generated Thread and Turn IDs are retained; CodeTether does not invent replacements for them.

The Test Workspace is `.tmp/codetether-codex-spike/`. It is ignored by the parent repository, contains restrictive local instructions, and has an independent Git boundary so provider Git inspection cannot walk into the CodeTether source repository.

### Observed Provider Methods

One successful real Turn observed these incoming methods:

```text
remoteControl/status/changed
thread/started
mcpServer/startupStatus/updated
thread/status/changed
turn/started
hook/started
hook/completed
item/started
item/completed
item/agentMessage/delta
item/commandExecution/outputDelta
thread/tokenUsage/updated
account/rateLimits/updated
turn/diff/updated
turn/completed
```

Phase 2A.1 additionally observed `item/commandExecution/requestApproval`, `serverRequest/resolved`, and interruption-related completion during its manual scenarios. The implementation also recognizes generated-schema file-change and permissions approval methods, but methods not seen in a real run are not documented as observed behavior.

### Normalized Runtime Events

`packages/agent-core` currently defines only:

```text
conversation.started
turn.started
message.delta
message.completed
tool.started
tool.output
tool.completed
file.changed
approval.requested
turn.completed
turn.interrupted
turn.failed
```

Raw provider method and payload may be attached as optional diagnostic metadata. They are not the normalized contract. A failed Codex Turn is derived from `turn/completed` with `turn.status = "failed"`; Codex 0.149.1 does not expose a separate `turn/failed` notification in the generated schema.

### Approvals

The client has explicit command and file-change approval handler paths that ask for terminal `y`/`n` input and return only a one-shot allow or deny response. It does not auto-approve, persist decisions, or expose `Always Allow`. Only the command path has been manually exercised; the other paths remain fixture/schema coverage.

Phase 2A.1 observed a real command approval end to end with Codex 0.149.1. The server request method was `item/commandExecution/requestApproval`. Its request carried the provider `threadId`, `turnId`, and `itemId` plus command, working directory, reason, environment, timing, and available decisions. An Allow Once response used `{ "decision": "accept" }`; a second isolated run used `{ "decision": "decline" }`. Both were bound to the exact provider request and Item before a response was emitted. Allow resumed the command and completed the Turn. Decline completed the command Item unsuccessfully without running it, then allowed the Turn to finish safely.

The generated `item/permissions/requestApproval` schema still has no explicit deny response variant. CodeTether does not infer one. File-change and permissions approvals remain schema-supported but not manually observed.

The local Codex installation also has a user `PermissionRequest` hook capable of pre-resolving escalation before an App Server request reaches CodeTether. Local CodeTether Host launch paths disable Codex hooks by default so an Approval cannot bypass the CodeTether control path; an explicit adapter caller may opt back into its own provider configuration. Hook coexistence and precedence still require a later production policy decision.

## Verified Phase 2A.1 Runtime Semantics

### Multiple Turns and Threads

One App Server process completed two sequential Turns in one Thread. The second Turn retained a marker from the first and made the requested small workspace edit without restarting App Server. Provider Turn IDs remained distinct.

The same App Server process also hosted two different Threads with distinct markers. Events were keyed by provider Thread and Turn identity, and neither final output nor aggregated delta state crossed Thread boundaries.

### Resume

A non-ephemeral Thread completed a seed Turn, the first client and App Server process shut down, and a new process resumed the same provider Thread with `thread/resume`. A follow-up Turn retained the seed marker. Codex 0.149.1 did not emit a new `thread/started` notification for the resumed Thread in this run, so the `thread/resume` response is the resume authority.

No CodeTether persistence was added. The manual harness retained the provider Thread ID only long enough to validate the restarted process.

### Interrupt

`turn/interrupt` was sent with the exact provider `threadId` and `turnId` while a bounded command was running. Codex returned an empty success result and later emitted `turn/completed` with status `interrupted`, which normalizes to `turn.interrupted`. A subsequent Turn on the same Thread completed, confirming interruption does not terminate the Thread.

The interrupted command produced a delayed diagnostic about an unknown process ID after the follow-up began. It did not corrupt routing or prevent clean shutdown, but late diagnostics must remain observable.

### Failure Semantics

A safe command exited non-zero. Its Tool completed with `success = false`, while the containing Turn still completed and produced a final explanation. This verifies that Tool failure and Turn failure are different states. A real provider Turn with terminal status `failed` was not observed, so `turn.failed` remains schema-derived and fixture-tested rather than manually validated.

### Runtime Memory Ownership

Runtime memory has explicit scope:

- **Process:** child process, transport, pending RPC requests, bounded event queue, queue pump, bounded delta-integrity tracker, and runtime failure/shutdown state.
- **Thread:** provider conversation identity and the active Turn pointer needed to reject cross-Turn contamination.
- **Turn:** last completed Agent message, terminal waiters, bounded terminal-result cache, and file-change de-duplication.

Streaming message text is not duplicated in the adapter's lifecycle state. The semantics harness verifies aggregated output with incremental SHA-256 digests bounded to 1,024 active message Items. Turn state is released after terminal completion is consumed or a waiter times out, and immediately when runtime failure/shutdown rejects the Turn. Terminal results that arrive before their waiter use a 64-entry cache; late-event tombstones are bounded to 256 entries. Process shutdown rejects all unresolved work and clears the lifecycle registry. No database or durable event store exists.

### Event Identity

Every normalized Turn event carries the provider Thread ID and Turn ID. Item events retain the provider Item ID. Approval events also retain an approval/request identity, and the response path validates Thread, Turn, and Item binding. When Codex supplies no separate approval ID, the current event uses the JSON-RPC request ID, which is correlation identity for that connection rather than a durable approval identifier. Phase 2B translates those provider identities to CodeTether-owned public identities before crossing the client boundary.

## Verified Phase 2B Client-to-Host Protocol v1

The implemented local path is:

```text
non-React client
      -> HTTP commands + SSE events
apps/host local API on 127.0.0.1
      -> in-memory Host service
      -> normalized Agent Core events
      -> Codex adapter and App Server
```

`packages/protocol` is the only wire-contract source. It exports shared TypeScript types and strict Zod schemas. Every bootstrap, snapshot, mutation, event, and safe error envelope carries `protocolVersion: 1`. Raw Codex JSON-RPC methods, IDs, payloads, and errors are not public protocol fields.

### Public Identity and State

The Host creates opaque `projectId`, `conversationId`, `turnId`, `itemId`, and `approvalId` values. Private maps bind runtime identities to the exact owning Provider session, Turn, Item, and, when supported, approval-request identities. Browser routing never uses a private Provider session ID. Codex numeric and string JSON-RPC request IDs remain distinct through tagged internal keys. Approval resolution revalidates the full Conversation/Turn/Item/provider-request binding, requires a still-pending record, and rejects repeated resolution.

At the Phase 2B acceptance boundary state was memory-only. Phase 3A subsequently made Conversation/Turn presentation state durable, and Phase 3B.1 made Project authorization durable. `GET /api/v1/snapshot` still returns the current epoch, current sequence, Conversation summaries, active Turns, pending Approvals, and bounded runtime histories; after restart those runtime histories are reconstructed from SQLite under a new epoch.

### HTTP Commands

The local API implements:

```text
GET  /api/v1/bootstrap
GET  /api/v1/snapshot
GET  /api/v1/events
GET  /api/v1/projects
POST /api/v1/projects
GET  /api/v1/projects/:projectId
DELETE /api/v1/projects/:projectId
POST /api/v1/conversations
POST /api/v1/conversations/:conversationId/turns
POST /api/v1/conversations/:conversationId/turns/:turnId/interrupt
POST /api/v1/approvals/:approvalId/resolve
```

Mutations require an `actionId`. A bounded 256-entry in-memory cache returns the original Promise/result for an identical retry while that action remains retained, rejects reuse with different input, never evicts in-flight actions, and explicitly reports capacity pressure. Settled entries are eventually evicted, so this remains a recent-retry guarantee for every mutation except Turn start; callers must use globally random action IDs. Phase 6C.4 adds a deliberately narrow durable Turn-start admission ledger: the Host atomically inserts the public Turn, its canonical input/snapshot, Conversation update, and the `actionId` association before Provider execution. A retry after Host restart resolves to the exact associated Turn when Conversation and input match, while conflicting reuse fails closed. It does not make Provider execution transactional, persist action results, or provide generalized durable exactly-once commands. Mutation responses share `accepted`, `completed`, or `rejected` status semantics while retaining endpoint-specific data. Safe errors use protocol codes rather than forwarding Provider transport errors.

Project creation accepts an `actionId`, absolute local path, and optional display name. The Host resolves the path to a canonical existing directory, applies any configured registration-root constraint, and stores one durable identity per canonical root. Repeating the same root returns the existing Project with `created: false`. List/read responses compute `available` or `unavailable` from the current filesystem rather than treating availability as durable truth. Delete removes only a registration and is rejected while any runtime or durable Conversation references it; it never deletes files or cascades Conversation history.

Create Conversation accepts an immutable `codex | claude-code` Provider identity and a registered `projectId`. Codex retains its optional model/reasoning controls. Claude Code rejects model selection but accepts only an effort identifier present in its Host-owned capability descriptor; an unknown or stale option fails as `invalid_request` before Provider launch. The stored `cwd` is a real-path-validated directory contained by that Project root. The deprecated Protocol v1 `cwd` request remains an additive compatibility path, but it may only map to an existing registered, available Project and cannot register a path or expand trust. The API does not implement Project discovery or a general filesystem chooser.

### SSE Ordering and Replay

Every Host process generates one non-persistent UUID `epoch`. A Host-global positive `seq` is assigned only after a regular event fits the reliable replay buffer. The SSE ID and envelope `eventId` are exactly `<epoch>:<seq>`, and the SSE `event` field equals the protocol event type. An empty snapshot's synthetic reconnect cursor is `<epoch>:0`; it closes the snapshot-to-stream race without claiming that sequence zero was emitted.

The replay buffer holds aggregated client events, not raw Provider transport events. It is bounded to 2,048 events and approximately 8 MiB by default, evicting oldest events by count or encoded size. `Last-Event-ID` reconnect replays the subsequent retained sequence. An epoch mismatch, evicted cursor, or future cursor produces a connection-local `stream.reset` control carrying the current `<epoch>:<currentSeq>` boundary; it is sent first and the recovery stream closes without allocating a sequence or entering replay. Runtime-history compaction is a different reset cause: after applying the triggering event, the Host publishes a sequenced and replayable `stream.reset` with reason `history_evicted`. That boundary reaches current observers and reconnecting observers alike, forcing all projections to replace from the newly compacted Snapshot. Heartbeats are SSE comments and do not consume sequence numbers.

Two live clients received identical event IDs and sequence values in tests and in the real integration path. Disconnecting one observer does not affect another. Replay is written directly with HTTP backpressure rather than being copied into the live queue. Each live connection defaults to 256 queued frames and approximately 1 MiB, while one standalone valid frame may be as large as 9 MiB. Heartbeats may coalesce or drop; reliable overflow closes only the slow connection so it can reconnect or fetch a snapshot. Approval and terminal events are never silently discarded. The non-React client independently caps an SSE frame at 10 MiB and an HTTP JSON body at 64 MiB, which covers the bounded aggregate Alpha Snapshot.

A fatal Provider runtime signal affects only Conversations owned by that Provider: it terminates their active public Turns with a safe `runtime_unavailable` error, resolves that Provider's pending Approvals as declined, clears its Turn-scoped buffers, and makes new control mutations for that Provider return HTTP 503. The other Provider remains available. Provider error text never crosses the client boundary. If failure occurs while idle, clients learn the failure on their next bootstrap or mutation because Protocol v1 does not yet define a capability-change event.

### Verified Real Integration

`pnpm host:integration` starts one real Codex App Server behind the loopback API and uses only ignored, explicitly allowed `.tmp` workspaces. The final verified run completed a file-changing Turn, streamed aggregated message/tool/file events to two clients with identical identities, replayed 21 events exactly after reconnect, returned `history_evicted` and `epoch_mismatch` reset controls, accepted one bound command approval, interrupted a bounded command, reached zero active Turns and pending Approvals, shut down, and observed a different epoch after Host restart.

The primary Turn delivered 56 aggregated message deltas, two completed messages, two tool starts, four tool-output batches, two tool completions, one file change, and one completed Turn. Unknown Codex notifications remained diagnostic-only. The interrupt produced a late provider command diagnostic about the terminated process, consistent with the previously observed interrupt semantics; it did not cross the public protocol or corrupt shutdown.

## Phase 2C.1 Live Conversation Read Model

The implemented browser read path is:

```text
Host HTTP/SSE
      -> packages/client
      -> one application-scoped HostRuntime
      -> TanStack Query bootstrap/snapshot/projection cache
      -> pure Conversation projection
      -> ConversationViewModel adapter
      -> frozen Conversation Detail components
```

`HostRuntime` is shared per application `QueryClient`, so React components never open or parse their own SSE connections. It requests bootstrap first, rejects an incompatible Protocol version, replaces the projection from `GET /api/v1/snapshot`, and then opens one event stream using the Snapshot cursor. The centralized development base URL defaults to `http://127.0.0.1:4317` and may be overridden with `VITE_CODETETHER_HOST_URL`; it is not repeated in components.

TanStack Query owns Host bootstrap, Snapshot, and projection cache entries. The stream lifecycle remains outside Query. The runtime exposes only `connecting`, `connected`, `reconnecting`, `unavailable`, and `incompatible` connection states to views. A temporary disconnect retains the last projection while reconnecting. The epoch/sequence cursor is browser-memory only: a page refresh starts again from bootstrap and Snapshot rather than `localStorage` or IndexedDB.

Every regular event is checked against the current projection epoch and sequence before application. Duplicate events do not update the projection. An epoch mismatch, sequence gap, invalid older event, or public `stream.reset` stops incremental application, fetches a fresh Snapshot, atomically replaces the projection, and then reconnects from the new Snapshot cursor. React components do not inspect `epoch`, `seq`, `Last-Event-ID`, provider Thread IDs, or Codex JSON-RPC.

The pure projection consumes `conversation.started`, Turn lifecycle, aggregated message, Tool, file-change, and Approval events. Message deltas are merged by Conversation, Turn, and Item identity; `message.completed` finalizes the same record instead of creating a duplicate. Tool output is attached to the corresponding Tool and, for command execution, to one bounded terminal tail. Terminal text is capped at 128 KiB per Conversation projection so a long process cannot create an unbounded browser history. File changes have one source in the projection and feed both Timeline and Inspector view data.

The route boundary is explicit: `/conversations/demo` continues to use the accepted Mock adapter, while a valid `/conversations/conv_*` identity selects the Host projection. Both data sources become the same `ConversationViewModel` before entering the frozen component tree; the JSX does not parse Host or provider payloads. Phase 2C.2 supplies an optional typed control controller only at this route boundary, so the same Composer, Header, and Timeline components keep their accepted Mock presentation without branching on provider payloads.

Phase 2C.1.1 extends Protocol v1 additively with optional per-Conversation runtime snapshots. A current Host always supplies retained Turns, canonical text inputs, Agent messages, Tools, file changes, Turn outcomes, pending Approvals through the existing top-level records, the latest terminal tail, and explicit eviction/truncation metadata. The Web read model preserves that retention metadata even though the frozen v1 Conversation UI does not add a truncation banner. Older Phase 2B Snapshots without this optional field remain valid Protocol v1 records.

Live `turn.started` and Snapshot Turn records carry the same Host-owned canonical input. The projection groups all presentation Items by public Turn/Item identity, so applying live events and rebuilding from Snapshot produce the same retained multi-Turn view. `stream.reset` atomically replaces from this complete process-local Snapshot rather than discarding the Timeline. Timeline Diff and Inspector Changes continue to consume one shared projected Changes collection.

This is bounded runtime state, not an event store. The Host defaults to 20 retained Turns, 512 combined message/Tool/change entries, a 128 KiB terminal tail, a 512 KiB presentation-text ceiling, and an approximately 4 MiB encoded runtime budget per Conversation. Old completed Turns are evicted first; the active Turn and its canonical input are retained, and every eviction or truncation is explicit in Snapshot metadata and emits the replayable Snapshot boundary described above. Text input above the 512 KiB Host ceiling is rejected before Provider execution rather than silently truncated. Protocol wire safety ceilings remain higher than Host retention limits.

Tool presentation is a deterministic client-side mapping over normalized Host Tool records. It lexically unwraps safe PowerShell `-Command` wrappers and recognizes a deliberately small set such as Git status, file reads, and test commands. Unknown commands remain “执行命令”; raw commands stay available in the bounded terminal/details state and never become the Timeline row title. Provider output is reduced to stable short failure summaries without losing the bounded full output tail.

The final 2026-08-26 completeness run used the isolated `.tmp/codetether-read-completeness/` workspace and local default `gpt-5.6-sol` model. One long-running Host completed two Turns on the same Conversation. Its final Snapshot retained both canonical User inputs, five Agent messages, five command Tools, two `src/example.ts` changes, the latest terminal tail, and completed status. The second Turn used context from the first and replaced only the requested fixture comment. The browser observed the live Turn, then preserved the full Timeline after a sequenced `stream.reset` caused a fresh Snapshot request, and preserved it again after a page refresh. Timeline Tool titles remained stable labels such as `执行命令` and `读取文件`; full PowerShell commands appeared only in terminal/details presentation. The run produced zero browser console errors and warnings.

The same manual path initially exposed an oversized Tool-name defect when a complete PowerShell invocation exceeded the Protocol title ceiling. Provider translation now emits the stable name `command`, carries raw command text in a separate field capped at 32 KiB, and bounds short started/completed summaries. A regression test covers commands above 40 KiB and verifies that failure tails remain available without crashing translation.

The real browser check also exposed a Phase 2B client defect that Node-only tests had not caught: storing `Window.fetch` and invoking it as a client member loses the required browser receiver. `packages/client` now binds the configured Fetch implementation to `globalThis`, with a regression test for the receiver contract.

## Phase 2C.2 Live Conversation Control

The application-scoped `HostRuntime` owns one `LiveConversationActions` mutation boundary over `packages/client`. React controllers call only text Turn start, exact-Turn interrupt, and exact-Approval resolution. Every new logical action receives a cryptographically random `act_<uuid>` identity. A duplicate in-flight intent shares one Promise, while an ambiguous transport failure retains its action identity for a safe idempotent retry; a definitive HTTP result releases it. Provider errors remain behind the safe Protocol error envelope.

Host events remain canonical. Composer submission does not append a User message locally: the Host records input, publishes `turn.started`, and the projection creates the User Timeline entry. HTTP acceptance may clear the matching draft, but it does not settle the Turn. The Composer disables duplicate submission and new input while a Turn is active, preserves a draft after failure or concurrent editing, treats Enter as send and Shift+Enter as newline, and ignores Enter during IME composition. Connection and Bootstrap capability state gate every live control. Unsupported quick actions, model/reasoning/permission changes, and Stop remain disabled rather than simulating success.

Pending Approvals stay as an ordered plural projection. Each visible row uses its own public `approvalId`, independent mutation state, one-shot Allow Once or Decline action, and remains present after HTTP 202 until `approval.resolved` arrives. Interrupt similarly binds the exact public Conversation and active Turn and waits for `turn.interrupted`; it does not terminate the Thread. After that event, the same Conversation accepts another Turn.

Timeline auto-follow is presentation-only state. New activity follows the bottom only while the user remains near it; scrolling upward freezes position and exposes a restrained “跳到最新” action. Tool rows use deterministic semantic titles and bounded wrapper-free subtitles, workspace file changes display paths relative to the authorized `cwd`, and complete command/error output remains in the bounded Terminal projection.

The 2026-08-26 browser validation used only the ignored `.tmp/codetether-codex-semantics-browser-control/` and linked approval workspaces. One real Conversation completed multiple browser-submitted Turns, retained prior context, was interrupted during a bounded 20-second sleep, then completed a following Turn on the same Thread. Separate real command Approvals verified Allow Once and Decline: Allow executed `git status --short` and completed; Decline did not execute it and the Provider still completed the Turn. A longer read-only result caused no horizontal overflow at 1536 x 1024 or 1280 x 900. Synthetic browser composition events plus pure keyboard tests verified that an IME Enter does not submit; a physical Windows IME session remains a human acceptance check.

## Phase 2D Alpha Stabilization

The Alpha audit found no React/provider dependency leak and no competing authoritative Conversation state. It did identify several P1 boundedness and lifecycle gaps, fixed without expanding product scope:

- The Host admits at most eight in-memory Conversations per process by default. With the approximately 4 MiB per-Conversation history budget, retained history is therefore bounded to approximately 32 MiB of encoded data before JavaScript object and temporary serialization overhead.
- One active Turn admits at most 1,024 provider Item identities and 1,024 normalized file-change identities. The normalizer stores fixed-size SHA-256 dedupe keys rather than complete diff text.
- At most 32 Approvals may remain pending; overflow is declined fail-closed before a public record is allocated. Resolved Approval history remains capped at 256.
- JSON-RPC stdout framing has a 16 MiB UTF-8 line ceiling. Overflow rejects pending requests and fails the transport instead of retaining an unbounded partial line.
- Browser Agent-message projection retains at most 512 KiB per message field, while terminal projection retains the existing 128 KiB tail.
- History truncation changes revision only on its first transition to truncated, preventing every later delta from publishing another `stream.reset`.
- Failure of the reliable runtime event/control path initiates idempotent runtime close, so a live Codex child cannot continue unobserved. Local Host assembly also closes an already-started runtime if a later construction or listen step fails.

An ordinary synthetic retained Conversation with 20 Turns, 40 Agent messages, 40 Tools, 20 changes, and 9,020 terminal bytes produced a 389,041-byte Snapshot. Warm schema validation measured 0.210 ms median / 0.460 ms p95, and projection reconstruction measured 0.547 ms median / 0.935 ms p95 on the audit machine. At a near-cap 3.90 MiB history, each additional delta cost approximately 14.429 ms median / 15.002 ms p95 because retention enforcement serializes the full runtime; this is measured P2 performance debt, not a correctness blocker for the local Alpha.

At the Phase 2D audit boundary, the stabilized process-level lower bound was approximately 32 MiB of encoded retained Conversation history plus the 8 MiB replay buffer, 4 MiB provider-binding buffer, 1 MiB provider queue, bounded approval/action/identity maps, and temporary Snapshot/SSE serialization. Actual JavaScript heap and the Codex child process were higher. Phase 3A retains these runtime limits while adding the distinct durable boundary below.

## Phase 3A Minimal Durable Persistence

Phase 3A adds one deliberately narrow storage boundary under `apps/host/src/persistence`. It uses the standard synchronous `node:sqlite` API available without an experimental flag from the repository's Node.js 22.13 minimum. No ORM, event store, CQRS layer, repository hierarchy, or raw provider-event table is introduced.

### Data Location and Database Configuration

The database file is `codetether.sqlite3` under an OS-appropriate user-data directory, never the repository:

```text
Windows  %LOCALAPPDATA%\CodeTether
macOS    ~/Library/Application Support/CodeTether
Linux    $XDG_DATA_HOME/codetether, otherwise ~/.local/share/codetether
```

`CODETETHER_DATA_DIR` overrides the directory for development and tests and must be absolute. Tests use independent temporary directories. The Store enables foreign keys, WAL journaling, a 5,000 ms busy timeout, and `PRAGMA quick_check` on open. An open, migration, or integrity failure preserves the database and prevents the Host from starting; CodeTether never deletes or replaces a failed database automatically.

### Minimal Schema and Migrations

The migration runner records ordered versions in `schema_migrations`, rejects an unknown or renamed applied migration, and applies each new migration in an immediate transaction. Migration 001 (`initial`) introduced `conversations` and `turns`. Phase 3B.1 migration 002 (`projects`) adds durable Project identity and rebuilds Conversation foreign keys without discarding existing history. Phase 3C.1 migration 003 (`conversation_title`) adds durable titles and a separate last-activity clock, backfilling existing rows transactionally from their first canonical text input. Phase 3D.1 migration 004 (`attention`) adds the durable Attention index without retroactively creating work from older completed Turns. Phase 4E.1 migration 005 (`conversation_organization`) adds manual/generated title ownership and nullable Pin/Archive timestamps. Phase 4F.1 migration 006 (`conversation_search`) adds and transactionally backfills the derived title/canonical-User-input Search projection. The current schema contains:

```text
projects
  project_id            CodeTether public identity, primary key
  name                  local display name
  root_path             canonical authorized local root
  root_path_key         normalized unique comparison key
  created_at, updated_at

conversations
  conversation_id       CodeTether public identity, primary key
  project_id            required Project foreign key, delete restricted
  title                 canonical product title
  title_source          generated or manual title ownership
  pinned_at             nullable Project-ordering timestamp
  archived_at           nullable organization timestamp; excludes Pin
  provider              immutable codex or claude-code identity
  provider_thread_id    private Provider session/resume identity, nullable while creating
  cwd, model, reasoning
  status, created_at, updated_at, last_activity_at

turns
  turn_id               CodeTether public identity, primary key
  conversation_id       foreign key with cascade delete
  provider_turn_id      private provider identity when available
  input                  canonical text input JSON
  status, started_at, completed_at
  snapshot_version, snapshot_json

attention_items
  attention_id           CodeTether attn_* public identity, primary key
  source_key             stable semantic identity, unique
  project_id             required Project foreign key, delete restricted
  conversation_id        required Conversation foreign key, delete restricted
  turn_id                optional exact Turn foreign key, delete restricted
  type, status            approval/completed_review/failed; open/resolved/expired
  payload_json            bounded normalized presentation metadata
  created_at, updated_at, resolved_at

conversation_search_documents
  document_key            stable internal title/Turn document key, primary key
  conversation_id         required Conversation foreign key, cascade delete
  turn_id                 public Turn foreign key for User-input documents
  field                   title or user_input
  normalized_text         derived searchable NFC/lowercase/whitespace projection
```

Indexes cover Project identity, active/archived Conversation ordering, lightweight Project/title lookup, per-Conversation Turn chronology, Attention status/priority lookup, and Search-document ownership by Conversation/field/Turn. Migration 002 backfills one Project for each distinct normalized legacy Conversation root and binds every existing Conversation to it. Project availability is intentionally absent from SQLite; the Host computes it by inspecting the saved canonical root. `snapshot_json` contains only versioned CodeTether normalized/presentation state for that Turn: messages, Tools, file changes, outcome, bounded terminal tail, and Approval history. It never contains raw Codex JSON-RPC or Claude JSONL. `attention_items.payload_json` is capped at 256 KiB and contains only normalized presentation metadata, never a Conversation snapshot or provider request. Search source-table triggers maintain only the normalized title/input projection; they never extract from `snapshot_json`.

### State Boundaries

The three state layers remain intentionally different:

- **Runtime memory:** current high-frequency working state and the bounded recent projection window (20 Turns, 512 presentation entries, 128 KiB terminal tail, approximately 4 MiB per retained Conversation).
- **SQLite:** durable Project authorization, Conversation identity, provider Thread identity, canonical inputs, per-Turn normalized snapshots, Attention state, and the derived title/User-input Search projection across Host processes. Older completed Turns are not deleted merely because they leave the runtime window.
- **SSE replay:** up to 2,048 aggregated client events / approximately 8 MiB for short reconnects within one Host epoch. It is not persistence.

Startup loads the durable Project registry, then restores at most the existing process admission limit of eight most-recent Conversations and the most recent 20 Turns per restored Conversation into runtime memory. Complete durable Turn rows remain on disk. The single-Conversation read exposes a recent 20-Turn window plus older-history metadata, but pagination for the older rows is not implemented.

### Write and Recovery Semantics

Conversation creation first inserts a local `creating` record, then creates the provider Thread, then durably records the provider identity and ready state before publishing the Conversation. Provider creation failure rolls back the incomplete local record. A final local write failure fails the runtime closed rather than presenting an undurable ready Conversation.

Turn start first creates a durable `starting` Turn with canonical User input; the migration-006 trigger updates its Search projection in that same SQLite transaction. Provider execution is not started if that write fails. Once Codex returns its Turn identity, the Host binds and persists it before publishing `turn.started`. Streaming remains memory-first: dirty Turn snapshots flush on a 300 ms throttle rather than on every delta. `turn.started`, Approval requested/resolved, completed, failed, and interrupted boundaries flush synchronously; graceful shutdown flushes all remaining dirty Turns and checkpoints WAL.

A database failure during an intermediate flush moves the Host to an explicit unavailable/fail-closed state. A terminal durability failure cannot be advertised as a durable successful completion. Provider errors remain behind safe Protocol errors.

At startup, `starting`, `running`, or `waiting` Turns cannot still be live. They are durably reconciled to `interrupted` with `host_restart`; running messages/Tools become interrupted and the Conversation becomes idle. Any pending Approval becomes expired historical state with the same reason and is never inserted into the new process's actionable Approval registry. A `creating` Conversation without a provider Thread becomes failed rather than masquerading as ready.

Restored Conversations retain their CodeTether `conversationId` and private provider Thread ID, but the Host does not resume every Codex Thread at startup. On the first new Turn it calls `thread/resume` with the exact saved provider Thread and authorized `cwd`, then starts the new provider Turn. If Codex cannot resume that Thread, durable local history remains available while controls fail safely with `provider_conversation_unavailable`; Phase 3A does not fork or replace it automatically.

A Host restart always generates a new, non-persistent SSE epoch. Replay and action-idempotency caches remain process-local. The Web runtime must replace from the new Snapshot and reject ambiguous in-flight mutations from the previous epoch; it must not automatically replay them as though the old result were known. Restored presentation entries preserve their stable order when already unique; legacy/cross-epoch collisions are deterministically rebased in Turn chronology, and the new epoch's event sequence starts after the largest restored presentation order.

Phase 3A completed a real isolated multi-Turn run with a full Host shutdown and no residual Codex child process. The same CodeTether `conversationId`, User/Agent messages, Tools, Diff, and terminal summary returned from SQLite after restart. The next Turn lazily resumed the exact stored provider Thread and correctly recalled the pre-restart marker `PERSIST-ORBIT-731`; a subsequent restart also verified repaired cross-epoch presentation ordering.

On the validated Windows/Node 25 development run, the final SQLite file was 53,248 bytes for six harness-created Conversation records, four completed Turns, and 9,444 bytes of normalized Turn snapshots. A 200-write synthetic check using an approximately 8 KiB snapshot measured 0.398 ms median, 0.558 ms p95, and 1.512 ms maximum synchronous write latency. These are development observations rather than production performance guarantees; the 300 ms dirty window keeps normal streaming from writing each delta.

## Phase 3B.1 Durable Project Identity and Local Authorization

A Project is the Host-owned durable identity of one authorized local workspace. Its public record contains `projectId`, name, canonical `rootPath`, computed availability, and creation/update timestamps. The persistence record additionally stores an internal normalized `root_path_key` used to enforce one Project per canonical root. Phase 3B.1 deliberately does not add filesystem generation identities, multiple Project locations, Project discovery, or a Projects product surface.

### Registration and Availability

Registration performs absolute-path validation, filesystem real-path resolution, normalized root comparison, and directory validation. Optional Host-configured roots constrain which new roots may be registered. Duplicate registration of the same canonical root returns the existing Project rather than creating another identity. Host startup reloads Project records from SQLite, so authorization survives restart.

Availability is computed, not stored. Reading a Project whose path no longer resolves returns `availability: unavailable` without deleting the durable record or its history. A moved, replaced, missing, symlink-changed, or otherwise unauthorized root cannot be used for control until its saved canonical identity is valid again.

### Conversation Ownership and Working Directories

Every current durable Conversation has one required Project foreign key. The Conversation keeps its own canonical `cwd` because a Turn may run in a subdirectory, but that working directory is never an independent authorization grant. Before Conversation creation, every Turn, and lazy provider Thread resume, the Host resolves both the saved Project root and candidate `cwd`, verifies that the saved root still resolves to the same canonical identity, and verifies that the working directory is the root or a contained descendant. Failure returns the safe `project_unavailable` boundary before provider work starts.

Protocol v1 is extended additively: new callers create Conversations with `projectId`, while the deprecated `cwd` request shape remains only for compatibility. The compatibility path searches already registered Projects and selects the most specific available containing root. It cannot register an arbitrary directory or expand the configured trust boundary.

### Project Deletion

Project deletion removes only CodeTether's durable registration. It performs no filesystem operation. The Project foreign key uses restricted deletion, and the Host also checks runtime ownership plus in-flight Conversation-creation reservations; a Project referenced or reserved by any durable or in-memory Conversation returns `project_has_conversations`. The reservation begins before asynchronous workspace authorization and is released after the durable/runtime identity is established or creation fails, preventing delete/create races without a global Project lock. There is no cascade, Conversation reassignment, or history loss.

### Real Validation

The 2026-08-26 Windows validation used `codex-cli 0.149.1`, an ignored isolated Project, and a SQLite data directory outside the repository. One Conversation completed a Turn, the Host shut down completely, and a new Host process restored the same Project, Conversation, Timeline, and a new SSE epoch without receiving a workspace allowlist again. Its first post-restart Turn lazily resumed the saved provider Thread and recalled the exact pre-restart marker `PROJECT-BOUNDARY-8427`. Moving the Project directory made `GET /projects` report `unavailable`; the two-Turn history remained readable while a new Turn failed with `project_unavailable` before provider resume. Restoring the directory made it available again, and a third Turn completed on the same Conversation. The final database was 65,536 bytes for two Project records, two Conversation records, and three completed Turns.

## Phase 3B.2 Real Projects UI

The real Project frontend keeps the accepted application boundaries intact:

```text
Projects React routes
      -> TanStack Query
      -> application HostRuntime
      -> packages/client
      -> Protocol v1 Project API
      -> Host-owned Project registry and SQLite
```

`/projects` lists only real Project fields returned by the Host: name, canonical root path, availability, and update time. `/projects/:projectId` performs its own Project read and displays the same record plus creation time. Loading, empty, Host-unavailable, not-found, available, and unavailable views are distinct; an unavailable Project remains inspectable because the durable record still exists.

The Phase 3B.2 add dialog accepted a manually entered absolute path and optional name. Phase 4B retains that Browser behavior and lets Desktop fill the same form through one native directory selection. Client validation remains intentionally limited to required-form checks. The client sends the request through the typed Project API, while the Host owns real-path resolution, configured-root authorization, canonical duplicate detection, and safe error semantics. A duplicate root returns the existing Project and the UI routes to that identity without adding a second cached row.

Removal is registration-only. The UI requires confirmation that local files, Git data, and source code are untouched, then calls the existing delete endpoint. A referenced Project keeps its record and displays the specific `project_has_conversations` conflict; there is no cascade or force-delete path. Successful mutation results update or invalidate the shared Project query keys instead of storing a second Project registry in React or Zustand.

Phase 3B.2 added no Host endpoint, filesystem scanner, native folder picker, rename/relocate operation, Git model, Project Conversation projection, or New Conversation flow. Later accepted phases added the real Conversation flow, and Phase 4B added only native directory acquisition; no Project scanner, relocation, or second Project store was introduced.

## Phase 3C.1 Durable Conversation Index and Title

The durable Conversation index and Runtime Snapshot serve different responsibilities:

```text
SQLite Conversation index
  = complete bounded product-history query for a Project

Runtime Snapshot
  = reconnect/rebuild boundary for the recent in-memory live Timeline
```

`GET /api/v1/projects/:projectId/conversations` always queries SQLite through the concrete Host Store. It never falls back to the runtime map and never parses `turns.snapshot_json`. The query selects only summary columns, excludes transient `creating` rows, scopes every row to the requested Project, and sorts by `last_activity_at DESC, conversation_id ASC`. The default limit is 50 and the maximum is 100; provider and canonical status filters are optional. A missing Project returns `not_found`, while an unavailable Project remains readable because history access does not authorize a new workspace operation.

`ConversationSummary` contains `conversationId`, `projectId`, title, provider, optional model/reasoning, canonical status, creation/update timestamps, and `lastActivityAt`. It deliberately excludes `providerThreadId`, `cwd`, SQLite row details, and provider payloads. `packages/protocol` remains the single wire definition, and `packages/client.listProjectConversations()` is the typed non-React consumer.

New Conversations are persisted with `新会话`. Before the provider starts the first Turn, the Host records canonical User input and—within the same SQLite transaction—replaces that default with a deterministic local title. The title generator normalizes NFC and whitespace, selects the opening sentence/clause, strips only a small fixed request-prefix set, and truncates to at most 48 graphemes while respecting the 240-code-unit wire bound. Once a Conversation has a recorded Turn, subsequent Turns and provider resume do not change its title. Migration 003 applies the same function to the first durable text input of existing Conversations; rows without a Turn retain the default.

`updated_at` remains the general record modification timestamp. `last_activity_at` is separate so metadata-only provider resume changes cannot reorder old history. Conversation creation, canonical Turn input/start, Approval request/resolution, terminal Turn outcomes, and restart interruption advance activity. Project metadata does not. Runtime records carry the same current title/activity values so live Snapshot state and SQLite summaries remain consistent.

The index is bounded but not paginated. A later real history UI must define continuation for Projects with more than 100 Conversations. The Host restores at most eight Conversations into runtime memory by default, but Phase 3C.1.1 makes older durable Conversations independently readable and internally hydratable for control without making the product list depend on that working-set limit.

## Phase 3C.1.1 Durable Conversation Detail and Working-Set Hydration

Conversation history now has three deliberately separate layers:

```text
SQLite Conversation index and normalized Turn snapshots
  = durable product identity and history across Host processes

Host runtime working set (eight Conversations by default)
  = bounded live state, active control bindings, and current SSE projection

Codex provider session
  = provider-owned Thread context, resumed only when control needs it
```

`GET /api/v1/conversations/:conversationId` reads a durable Conversation without admitting it to the runtime working set. It returns the existing `ConversationSummary` and `ConversationRuntimeSnapshot` contracts, reconstructed from the most recent 20 durable Turns by default, plus `hasOlderHistory`, `retainedTurnCount`, and `totalTurnCount`. It also distinguishes currently actionable pending Approvals from bounded non-actionable resolved or `host_restart`-expired Approval history. The response excludes provider Thread identity, raw Codex data, SQLite details, workspace-routing fields, and internal hydration state.

A cold detail read is provider-independent: it neither starts an owning Provider process nor resumes a Provider session, emits an SSE event, mutates durable status, nor consumes one of the eight runtime slots. This remains true when the Project directory is unavailable or the saved Provider session is missing, so local history stays readable even when future control must fail closed.

Starting a Turn on a cold Conversation is a separate internal control path. The Host deduplicates concurrent hydration, reserves a working-set slot, reconstructs the same bounded durable projection, installs provider/public Turn identity mappings, revalidates the Project workspace, lazily calls provider Thread resume, and only then starts the new Turn. Action idempotency continues to wrap the whole operation. Hydration is not a public command or query option.

Working-set admission uses safe least-recently-used eviction. Only an idle, clean, unpinned Conversation with no active/starting/interrupting Turn, hydration, or pending Approval may leave memory. Eviction removes process-local state and provider bindings only; SQLite history and the provider-owned Thread remain intact. If every candidate is protected, control returns explicit `runtime_unavailable` rather than evicting active state or exceeding the bound.

Cold reconstruction compacts retained presentation order into one unique monotonic window. At startup the Host initializes its process-global event sequence above restored presentation order—and reserves the full runtime-entry range when cold provider Conversations exist—so later live Items cannot collide with durable Item order. A read-only cold GET does not advance sequence; new events still pass the existing preview/durable-publication sequence check before fanout.

If the Codex executable cannot launch, the local loopback Host can still start with its durable API in read-only mode. Bootstrap reports Codex/resume capabilities unavailable; Project, index, and Conversation-detail reads continue from SQLite, while provider-dependent mutations return `runtime_unavailable`. This fallback does not invent a provider session or weaken workspace/history safety.

Phase 3C.1.1 adds no database table, event store, provider-event persistence, durable LRU state, or durable SSE/action state. It does not add full-history pagination, a history-loading UI, Real Conversations/Conversation Rail data, or another provider. The durable detail intentionally exposes only its bounded recent window; `hasOlderHistory` is the explicit boundary for future pagination work.

## Phase 3C.2 Real Conversations Experience

The route hierarchy supplies Product context without a global Project store. `/projects/:projectId/conversations` queries the real Project and the latest 100 SQLite-backed Conversation summaries. `/conversations/:conversationId` first reads the durable detail contract, obtains its `projectId`, then queries the same Project and Project-scoped summary list for breadcrumbs, Sidebar context, and Rail presentation. `/conversations` redirects to `/projects`; the Demo route remains a development fixture and is not linked by real product navigation.

At the Phase 3C.2 boundary, the list and Rail used the same `listProjectConversations()` Client boundary and preserved Host `lastActivityAt DESC` order by default. Local search/filter/sort operated only on that bounded response. Provider groups were data-driven and showed only Codex; unsupported Machine, Git, archive, rename, and delete fields/actions were omitted instead of populated with Mock values. Later organization and durable Search-read boundaries remain additive and are described below.

New Conversation remains intentionally minimal. The current Project is locked when route context supplies one; otherwise the dialog queries available Projects and requires an explicit selection. Agent is locked to Codex, model and reasoning use Host defaults, each create intent receives one random `actionId`, and successful creation invalidates the exact Project index before navigating to the new empty durable Conversation. The Host records the first User input and owns the deterministic title update.

The application-scoped Host Runtime continues to own one SSE stream and one live Conversation projection. Only semantic lifecycle events—`conversation.started`, `turn.started`, Approval requested/resolved, and terminal Turn outcomes—invalidate product-summary queries. `message.delta` and `tool.output` never trigger index refetches. The Runtime retains Bootstrap capabilities independently of Query cache garbage collection so long-running or cold-conversation controls cannot become disabled merely because an unobserved query aged out.

Project unavailability is presentation and authorization state, not history deletion: list, Rail, and detail remain readable while new Conversation and existing controls are disabled. Host unavailability is distinct from an empty index and exposes an explicit retry path. At 1280 px the accepted Detail hides the persistent Inspector behind its existing overlay toggle; no Conversation surface introduces horizontal document overflow.

## Phase 3D.1 Durable Attention Model

Attention is a durable view of Conversation work that still needs explicit user action or review; it is not a new top-level product entity, an Activity log, or a Notification delivery system. Migration 004 adds one `attention_items` row per stable semantic source. The unique source keys are derived from the exact Approval or terminal Turn identity, so Provider replay, SSE replay, and Host restart cannot create duplicates.

Protocol v1 supports `GET /api/v1/attention` with optional Project, type, status, and bounded-limit filters. The response contains presentation-safe `AttentionItem` records and an open summary (`totalOpen`, `approvalOpen`, `completedReviewOpen`, `failedOpen`). Ordering is Host-owned: Approval first, failed Turn second, completed review third, then newest creation first. The query reads only `attention_items` and never deserializes Turn snapshots. `packages/client` exposes the same boundary through `listAttention()`.

Only three types have reliable semantics in the current Runtime:

- `approval` is created from a bound `approval.requested`; only the existing exact Approval endpoint may accept or decline it. The matching `approval.resolved` records the decision and resolves Attention.
- `completed_review` is created once after a durable `turn.completed` and remains open until an explicit review acknowledgement.
- `failed` is created only from canonical `turn.failed` and remains open until acknowledgement. A failed Tool, user interrupt, or `host_restart` interruption does not manufacture failed Attention.

`POST /api/v1/attention/:attentionId/resolve` is therefore limited to completed-review and failed items. It carries the normal bounded process-local `actionId`, returns the original successful result for the same action, rejects a new operation against an already terminal item, and never changes the underlying Turn result. Generic resolution of Approval Attention is rejected so the UI cannot hide an item while its provider request still waits.

Approval request/resolution and completed/failed Turn finalization write their normalized Turn/Conversation boundary and Attention transition in one SQLite transaction. Only after that transaction succeeds does the Host publish the original lifecycle event followed by reliable `attention.created` or `attention.resolved`. Those events use normal Host-global sequence/replay and cannot silently drop; after `stream.reset`, clients rebuild from the durable list rather than deriving Attention from high-frequency Conversation events.

Provider Approval handles remain process-local. During restart reconciliation, any open Approval Attention becomes `expired` with `host_restart` inside the same reconciliation transaction and is never restored to the actionable registry. Completed-review and failed items remain durable. Migration deliberately does not backfill Attention for pre-004 Turn history, avoiding a synthetic backlog the user never received.

There is no `question` / needs-reply Attention because Codex does not currently expose a reliable structured Agent-question signal. Text punctuation, content heuristics, and extra LLM classification are intentionally not used. Read/unread and Activity remain separate future work. Phase 4C consumes only the existing `attention.created` semantic event for Desktop delivery and does not extend this model.

The real isolated validation observed the exact sequence `approval.requested` → `attention.created` → `approval.resolved` → `attention.resolved`, followed by `turn.completed` → a second `attention.created`. Allow Once took 6.075 ms at the local HTTP boundary; after a full Host restart, the durable list read took 3.398 ms and explicit review resolution took 4.739 ms. The 98,304-byte temporary database was removed after validation, and the disposable workspace remained unchanged. A real Codex `turn.failed` was not observed; failed Attention remains fixture-validated and is not inferred from Tool failure.

## Phase 3D.2 Real Inbox UI

The application owns one canonical open-Attention TanStack Query. It requests the Host's bounded `limit=100` list, preserves Host ordering, and renders the response summary directly rather than deriving global counts from the returned page. The Inbox and Primary Sidebar consume the same cache; no Inbox record is copied into Zustand or a second React context.

The UI has three exact action paths. Approval cards call `resolveApproval(approvalId, decision)` and remain visible until the semantic resolution arrives. Completed review calls `resolveAttention` before navigating to the durable Conversation. Failed work offers navigation without resolution plus an explicit acknowledgement that resolves only Attention and leaves the Turn failed. Every item has independent in-flight/error state, and the browser never uses command text or list position as approval identity.

Only `attention.created` and `attention.resolved` trigger low-frequency Attention query synchronization. Conversation deltas and Tool output do not invalidate the Inbox. After `stream.reset` or a Host epoch replacement, Snapshot recovery completes first and then the durable Attention list is fetched again. This gives all local browser clients the same queue without treating process-local SSE replay as permanent Inbox storage.

The real Inbox enriches presentation through one Projects query and at most one cached Conversation-index query per involved Project; it does not issue one request per row or deserialize Turn snapshots. Host unavailable, empty, loading, mutation error, and the 100-item bound are distinct UI states. The removed Mock semantics—question/needs-reply, unread, mark-all-read, average response, risk counts, retry, and fake provider/Machine metadata—are not inferred or replaced.

## Phase 3E.1 Approval Interaction Layout Stabilization

The Conversation Workspace uses four stable grid rows: Header, `minmax(0, 1fr)` Timeline, conditional Pending Action Dock, and Composer. Only the Timeline owns the main vertical scroll. The Dock is constrained to the Workspace column, caps its scrolling body at 160 px (approximately 216 px including its header and border), and keeps action buttons from shrinking; long normalized command/context text truncates in the primary row and remains available in bounded details or Terminal.

Timeline Approval entries are compact, non-interactive history. The Dock consumes the same ordered plural pending-Approval projection and exact `approvalId` controller, so multiple requests retain independent mutation/error state without creating another Approval source of truth. Semantic Tool presentation unwraps safe PowerShell command wrappers for the primary title/subtitle while retaining the normalized command only in details and Terminal.

Timeline scroll decisions are isolated in a pure helper. Content follows the bottom only while the user is already bottom-anchored; Approval appearance/removal and Dock-driven viewport resize preserve an upper reading position. A `ResizeObserver` re-anchors a bottom reader without coupling the Dock to Timeline content. Approval appearance moves focus only when it disables the actively focused Composer; resolution advances to the next Approval, or returns through the Timeline to the Composer once the active Turn reaches an editable terminal state.

## UI

The UI presents projects, conversations, approvals, changes, terminal output, context, and the supported Agent. Figma defines visual and interaction behavior. Phase 2C.1 through Phase 2C.2 preserve the accepted visual structure and change only the Conversation Detail data/control boundary for valid live Conversation routes. Phase 3B.2 replaces only the Projects placeholder with the accepted real list and overview surface. Phase 3C.2 keeps the accepted Conversations/Detail visual structures while replacing their Product data boundary with real Project and durable Conversation reads. Phase 3D.2 adapts only the accepted Inbox surface to real Attention semantics. Phase 4C replaces only the Settings placeholder with one small Desktop-notification preference section. Phase 4D refines this same shared component tree, Phase 4E.2 connects organization truth, and Phase 4F.2 connects Project-scoped durable Search. Phase 4G.1 adds only a compact Desktop background-running explanation to that Settings surface. Phase 4G.2 adds no page or product state; Web receives only a process-local resume signal that asks the existing HostRuntime to reconnect its accepted SSE transport. Accepted Phase 5A replaces false Codex-only presentation with Host descriptors and durable Conversation Provider identity. Phase 5B reuses that generic descriptor to expose a Provider-labelled Claude effort Select while preserving Codex's existing default reasoning presentation; List, Rail, Header, Inbox, Search, and controls remain canonical and no existing Conversation can switch Provider.

The client owns ephemeral presentation state only. TanStack Query stores bootstrap, Snapshot, Conversation projection, Project queries, Conversation indexes, and Attention queries; Zustand remains limited to UI state. Project, Conversation, Attention, Agent, Machine, and retained Timeline records must not be duplicated into a client store as a second runtime authority. The Host remains the product-state source of truth.

The live Conversation, Conversation index, Project, and Inbox paths consume Protocol v1 through `packages/client`, never Codex wire messages or `packages/adapter-codex` directly. Phase 2C.2 sends only text Turn start, one-shot Approval resolution, and exact-Turn interrupt commands; Project/Conversation product surfaces add only the existing list/read/create/delete Project operations, durable Conversation reads, and minimal Conversation creation. Phase 3D.2 adds explicit completed-review/failed Attention resolution while preserving the exact Approval endpoint safety boundary.

### Phase 4D Presentation Projection

Phase 4D keeps durable and live normalized data intact and derives only render-time presentation:

- Runs of at least three adjacent completed routine Tools become one expandable group. The pure grouping function preserves order and identity, and never groups failures, active work, tests, explicit actions, or Diff-producing Tools. Refreshing the same normalized Timeline produces the same grouping.
- Agent text passes through a small typed Markdown parser and React renderer supporting headings, paragraphs, ordered/unordered lists, strong text, inline code, fenced code, and `http` / `https` / `mailto` links. React escapes unknown/raw HTML; images remain inert; unsafe URLs are rejected; no HTML injection or remote media load exists.
- A Project root may be used to shorten a reliably contained absolute path for display. Canonical roots, durable message bodies, terminal content, and normalized changes are never rewritten. Ambiguous, relative-escaping, or outside-root paths remain unchanged.
- `?turn=<turnId>` is a public navigation hint. Inbox review/failure actions and notification click intents can carry the existing public Turn identity; the Conversation Timeline focuses the matching Turn without resolving Attention or creating navigation state in SQLite.
- Inspector Changes owns ephemeral selected-file state. Selecting a file focuses the matching Timeline Diff block, while Timeline and Inspector continue consuming the same normalized Changes collection.

Long titles and paths are constrained with truncation and full-text affordances; unsupported Composer and primary-navigation controls are hidden rather than simulated. Product copy uses CodeTether/user language, while Host, Runtime, projection, and provider terms remain valid internal architecture vocabulary.

## Phase 4E.1 Durable Conversation Organization

Migration 005 extends the existing `conversations` table with `title_source`, `pinned_at`, and `archived_at`, replaces the old Project/activity index with partial active/archived ordering indexes, and adds a lightweight Project/title index for later bounded title lookup. Existing titles backfill as `generated`; no historical Turn is scanned and no provider identity, snapshot, Attention row, activity timestamp, or Project relationship is rewritten. `titleSource` is either `generated` or `manual`; nullable timestamps are the sole Pin and Archive truth, and Archive atomically clears Pin. Migration 005 itself introduced no FTS or Search service; the later Phase 4F.1 read model is described below.

Manual Rename is a narrow `PATCH /api/v1/conversations/:conversationId` mutation. The Protocol boundary normalizes NFC, trims and collapses Unicode whitespace, rejects empty titles, and rejects rather than truncates values beyond 240 UTF-16 code units or 160 graphemes. Rename sets `titleSource=manual`; first-input deterministic generation runs only while the source remains `generated`, so pre-Turn manual names survive provider execution. Pin/Unpin and Archive/Unarchive use explicit POST subresources. Every mutation carries `actionId`, returns the public `ConversationSummary`, updates `updatedAt` only when metadata changes, and leaves `lastActivityAt` unchanged.

The Project index accepts a strict `archived=false|true|all` filter and defaults to active history. Active rows order by Pin presence, `pinnedAt DESC`, `lastActivityAt DESC`, then `conversationId ASC`; archived rows order by `archivedAt DESC`, then identity. These indexed queries read Conversation metadata only and never parse Turn snapshots.

Archive is organization state, not execution status. The Host rejects Archive while a Conversation is starting, running, waiting, or owns a process-live/open Approval. Archived detail and completed-review/failed Attention remain readable and navigable, Project deletion remains blocked by the durable Conversation, and Start Turn returns `conversation_archived` until explicit Unarchive. No organization mutation starts an owning Provider, resumes a Provider session, or hydrates a cold Conversation; already-hydrated records receive only the changed public metadata.

Changed writes publish one reliable, sequenced `conversation.updated` event containing a presentation-safe `ConversationSummary`; logical no-ops return their idempotent result without fabricating another change event. The summary/detail/Snapshot contracts carry current organization metadata while continuing to exclude provider Thread identity and SQLite details. `packages/client` exposes typed Rename, Pin/Unpin, Archive/Unarchive methods with response and route-identity validation. Phase 4E.1 adds no Search/FTS, pagination, Delete, tags, folders, groups, or bulk operations.

## Phase 4E.2 Conversation Organization UI

The Project Conversation route owns only presentation and navigation state. Its `view=archived` search parameter selects the archived Host index; the default route selects active history. Active and archived queries use separate TanStack Query keys containing `projectId` and archive scope, and React renders rows in the exact Host order rather than sorting Pin or activity metadata again. Existing status and bounded loaded-index filtering remain subordinate presentation filters, not a Search service.

One shared organization-control composition serves List rows, Rail rows, and the Conversation Header. It invokes the typed Client mutations with fresh `actionId` values, keeps pending/error state scoped to the affected action, and relies on the returned public summary plus Query invalidation for final truth. Rename validates only immediate form usability before deferring normalization and limits to the Protocol; Archive confirmation explains preservation and remains open on a Host conflict; Pin/Unpin and Unarchive require no speculative local reordering. React stores no `isPinned`, `isArchived`, or title mirror in Zustand, `localStorage`, or another context.

Archived Detail uses the ordinary provider-independent Conversation read and Timeline/Inspector component tree. A presentation banner identifies Archive separately from execution status, Composer control is replaced before text entry with an explicit Restore action, and successful Restore returns the same Detail to active controls. The ordinary Rail continues to query only active history; when its selected Detail is archived, it adds that one public Conversation summary in a small archived context section rather than loading the full archived index.

Accepted `conversation.updated` envelopes invalidate the relevant detail and archive-aware Project indexes at low frequency. Thus another Client's Rename, Pin, Archive, or Unarchive updates List, Rail, Header, Breadcrumb, and Composer state without page refresh; `message.delta` and Tool output do not cause organization refetches. Inbox and notification links continue routing by public Conversation identity, so a later-archived target opens the readable archived state without resolving Attention or automatically restoring it. Querying, viewing, renaming, pinning, archiving, or restoring a cold Conversation never hydrates or resumes Codex; only later Start Turn control may do so.

At its frozen boundary, Phase 4E.2 added no full-history/global Search, FTS/semantic index, pagination, Conversation Delete, bulk actions, tags, folders, groups, drag ordering, Activity, tray/background runtime, remote operation, or provider expansion.

## Phase 4F.1 Durable Conversation Search Model & API

Migration 006 creates `conversation_search_documents`, with one normalized title row per Conversation and one normalized canonical-User-input row per durable Turn. Its foreign keys remain subordinate to the existing Conversation/Turn graph. Migration-time `INSERT ... SELECT` backfills migration-005 databases inside the normal migration transaction; source-table triggers update the projection in the same transaction after Conversation creation, title changes, and Turn input writes. Rename and generated-title replacement therefore retire the old title immediately, while Pin and Archive do not rewrite text. The projection stores no Agent message, Tool/Terminal output, Diff, Approval envelope, provider payload, or presentation snapshot.

The production Node SEA and development Node runtime both expose SQLite 3.52 with FTS5 enabled, but Phase 4F.1 deliberately does not depend on FTS5. The `unicode61` token model does not provide the required predictable substring behavior for short CJK queries, while trigram tokenization cannot serve one- or two-code-point queries. Instead, the Host registers one deterministic `codetether_search_normalize` SQLite function before migrations and uses parameter-bound `instr(normalized_text, normalized_query)` predicates entirely inside SQLite. This keeps Project/filter/ranking/deduplication/pagination in the database without loading a Project's history into JavaScript or parsing `snapshot_json`.

V1 normalization is NFC followed by Unicode lowercasing, Unicode-whitespace collapse, and trim. It deliberately does not perform NFKC compatibility folding, accent folding, stemming, fuzzy matching, token expansion, or natural-language/semantic inference. Punctuation remains literal. Canonically equivalent combining forms and ordinary case differences match; full-width compatibility forms and unrelated accented forms remain distinct. Query and preview wire limits are enforced by code-unit and grapheme bounds.

The strict `GET /api/v1/projects/:projectId/conversations/search` query accepts `q`, `archive=active|archived|all`, the real durable provider/status filters, `limit`, and an opaque Host cursor. Default limit is 25 and maximum is 100. Unknown or duplicate query parameters, blank/oversized queries, invalid enums/limits, and malformed or context-mismatched cursors fail as `invalid_request`. Cursor state binds the Project, normalized query, and filters plus the last public deterministic sort tuple; it exposes no SQLite offset, row ID, or SQL state. Concurrent title/archive/activity changes between pages have read-committed cursor semantics rather than a long-lived snapshot: a result can move across a page boundary, but malformed cursors, cross-scope leakage, and non-progressing loops are rejected.

SQLite assigns rank tiers in this order: exact normalized title, title prefix, title substring, then canonical User-input substring. A window function chooses one deterministic representative match per Conversation. Active ties prefer pinned work and then `lastActivityAt DESC`; archived ties use `archivedAt DESC`; identity is the final stable tie-breaker. A User-input result contains the public `turnId` and a bounded Unicode-safe plain-text excerpt only. Title matches need no preview. The public response is a `ConversationSummary` plus this match metadata and never contains full Turns, private provider identities, `cwd`, SQLite fields, HTML, or raw source envelopes.

`HostService` first proves the durable Project exists but does not require its root to be available, then delegates directly to `ConversationStore`. No Search path invokes the runtime, reads the hydrated working set, starts an owning Provider, or resumes a Provider session. `packages/client` validates the route Project, requested archive/provider/status partition, cursor progress, and response union. No Search SSE event exists; future UI may invalidate queries from existing low-frequency Conversation lifecycle events. The current loaded-index Conversation field remains unchanged and truthfully bounded until a separately approved UI phase consumes this API.

On the Phase 4F.1 validation machine, fixtures at 50, 500, and 5,000 Conversations each carried one canonical input per Conversation. Across 20 warm reads at each size, a common query measured 0.560/0.617 ms, 2.191/2.489 ms, and 13.591/13.879 ms median/p95 respectively. At 5,000 Conversations, title search measured 9.413/9.757 ms, user-input search 12.336/12.535 ms, no-match search 7.856/7.980 ms, Unicode search 9.595/9.917 ms, and archived search 2.949/3.224 ms. Projection storage was 32,768 bytes at 50 Conversations, 200,704 bytes at 500, and 1,929,216 bytes at 5,000. These are observed local measurements, not wire guarantees or a reason to claim fuzzy/semantic scalability.

## Phase 4F.2 Search UI & History Discovery

The Project Conversation route treats `q` and `view` as navigation state. A blank/trim-empty query remains Browse mode and uses the archive-aware Conversation index; a nonblank query enters Search mode and uses `searchProjectConversations()` directly. React trims only to decide the mode; canonical URL/request normalization comes from the shared Protocol query schema rather than a second component rule. Same-mode typing replaces the current URL entry immediately while the durable request waits for the 250 ms debounce; entering or leaving Search remains navigable through browser history. Refresh and deep links reconstruct from the URL rather than browser storage.

Search pages use a distinct TanStack infinite-query identity containing Project, query, archive, provider, status, and limit. The Client receives each query's AbortSignal, so an older response cannot replace a newer query. Each first request asks for 25 Host-ranked results; opaque cursor pages append only after explicit Load More, deduplicate by public Conversation identity defensively, and stop if the Host cursor cannot progress. React does not fetch every page, fabricate a total, filter the ordinary 100-row index, or reimplement ranking.

The List renders the public Conversation summary with title, execution/organization metadata, and a bounded match explanation. A title match is identified as such; a `user_input` match shows the Host-provided plain-text preview as something the user previously asked. The compact Rail uses the same durable API over active Conversations and a one-line clue, while keeping its current nonmatching Conversation as separate orientation and its existing bounded current-archived section. No result exposes `matchedTurnId`, public/private record IDs, ranking score, full Prompt, SQL state, or provider identity as visible metadata.

For a canonical-User-input match, navigation reuses the existing public `?turn=<turnId>` hint. The ordinary durable Conversation detail either focuses that retained Turn or presents the established older-history boundary when the identity is outside its recent window. The Search layer never loads an older snapshot, synthesizes a Timeline item, admits a cold Conversation to the Runtime, or resumes Codex; old-Turn pagination remains a separate future capability.

Rename, Pin, Archive, and Unarchive continue through the Phase 4E typed mutations. Their successful responses invalidate ordinary indexes, detail, and Project Search scope; accepted low-frequency `conversation.updated` and relevant durable Conversation/Turn lifecycle transitions invalidate Search queries across clients. Search does not subscribe to `message.delta` or Tool output. A rename can make a result enter or leave, Pin can rerank an active tie, and Archive/Unarchive moves it between exact Host partitions without an optimistic client sort or splice.

At its frozen boundary, Phase 4F.2 adds no SQLite table, Protocol route, Search event, Zustand server state, `localStorage` Search state, Desktop command, or Tauri capability. Browser and Desktop execute the same React/Client flow against the loopback Host. Cross-Project/global Search, Agent/Tool/Terminal/Diff/Approval Search, fuzzy/semantic behavior, Search analytics/history, and old-Turn history pagination remain absent.

## Desktop Shell

`apps/desktop` is a Windows-first Tauri 2.11.x shell around the existing Web/Host system. It creates one native-decorated `main` window, uses the stable `com.codetether.desktop` bundle identifier, and loads the same `apps/web` build used by Browser mode. Production loads packaged Web assets; development lets the Tauri CLI own the Vite process. Window, tray, power/session observation, and owned-process supervision remain native lifecycle responsibilities; there is no `DesktopConversationPage`, Desktop-only React tree, or Tauri business command layer.

The Rust layer owns application/window/tray lifecycle, single-instance behavior, Host process supervision, startup diagnostics, packaging, one explicit Project directory picker, and bounded Windows notification display/click activation. The official single-instance plugin is registered before other plugins; a second launch invokes the shared existing-window restore path and does not start a second Host. The main window starts hidden against the application's dark background and is shown only after bootstrap readiness plus Protocol/build identity validation, avoiding an unstyled white surface. Native window decorations remain unchanged.

### System Tray and Background Runtime

Accepted Phase 4G.1 makes window visibility independent of application and Runtime liveness. After Host readiness, Rust creates exactly one built-in Tauri tray from the configured CodeTether icon. Its surface is intentionally bounded to a `CodeTether` tooltip, left-click restore, `打开 CodeTether`, and `退出 CodeTether`; it has no Attention projection, badge, recent-item model, provider control, or Web-owned creation lifecycle.

A close request for the `main` window, including Alt+F4, is prevented while the Desktop is running and hides that same WebView window. It does not call Host shutdown, remount React, restart the Host, interrupt a Turn, or expire a live Approval. Ordinary minimize remains distinct. One `show_main_window` function checks that readiness is complete and quit has not begun, then unminimizes, shows, and focuses the existing window for tray click/menu, notification activation, and second-instance activation. No path creates another window or Host.

Tray Quit owns one atomic transition from running to stopping. Repeated Quit requests and restore races become no-ops; the existing Host drain has a 12-second ceiling before the tray is removed and the Desktop process exits. A first successful hide claims one process-local flag, atomically creates one versioned Desktop-owned marker under application-local data (or the isolated `CODETETHER_DATA_DIR` used by smoke tests), and attempts one native education notification. Project SQLite and Web notification preferences do not own this marker. The centralized native capability reports background-runtime availability to shared Settings as read-only presentation data; Browser reports unavailable and receives no lifecycle command.

### Windows Session and Background Reliability

Phase 4G.2 models four independent native axes: Desktop application state, main-window presentation, Windows power/session state, and owned Runtime health. X/Alt+F4 still maps only the window axis to hidden; Tray Quit still maps the application and Runtime axes through the accepted 12-second graceful path. Lock/unlock observation updates only process-memory session diagnostics and does not hide, reveal, stop, or resume provider work.

`WM_POWERBROADCAST/PBT_APMSUSPEND` records a suspended system state and performs no Host I/O, shutdown, or restart. The first automatic or user resume message for that cycle admits exactly one native reconciliation. Rust first confirms that the recorded owned child has not exited, then makes one bounded loopback bootstrap request and requires the existing Protocol version, revision-coupled Host build identity, and exact startup Host epoch. A live but temporarily unresponsive owned child is retained rather than killed or replaced; an exited, incompatible, or identity-changed child enters the existing failure shutdown. No case starts an automatic replacement Host.

After that native check, Rust emits only `codetether://desktop-resumed` with the startup-owned public Host epoch. The Browser-safe adapter uses the already granted event listen/unlisten boundary, and one application-scoped listener registered outside React StrictMode asks HostRuntime to close or abort its possibly half-open SSE connection. A transient native-listener registration error receives one bounded retry; there is no recurring registration loop. Before reopening SSE, HostRuntime performs a fresh bootstrap read and rejects any epoch other than the exact native-owned epoch. Its existing loop then reconnects with the canonical `Last-Event-ID`; ordinary sequence/replay/reset rules decide whether replay or Snapshot replacement is needed. This adds no polling, second stream, second projection, Protocol event, or client-owned durable state. Host-backed TanStack queries remain `networkMode: 'always'`, so unrelated Internet reachability cannot pause loopback reads or queue mutations.

The Windows end-session subclass returns `TRUE` promptly from `WM_QUERYENDSESSION` after an in-memory `SessionEnding` transition; it performs no filesystem, Host, or network work on that query path. A false `WM_ENDSESSION` restores the prior system state and normal close-to-tray behavior. A confirmed `WM_ENDSESSION` claims shutdown idempotently, attempts the same owned-Host drain with a distinct 2-second best-effort ceiling, allows process exit, and then chains back to Windows/Tao teardown. It intentionally does not promise Tray Quit's 12-second graceful interval.

On abnormal Desktop/parent death, `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` still guarantees cleanup of the owned Host/Provider process tree even when no graceful flush wins the race. The next Host startup applies the established SQLite reconciliation: incomplete Turns become interrupted and process-live Approvals become expired history. Explorer taskbar/tray recreation remains the responsibility of the pinned Tauri 2.11.5 `tray-icon` feature and locked `tray-icon` 0.24.2 implementation; CodeTether adds no Explorer polling loop, duplicate tray registry, or second lifecycle authority.

### Desktop Attention Notifications

`HostRuntime` publishes a low-frequency applied-event observer only after an SSE envelope passes epoch/sequence validation and advances the canonical projection. The application-scoped notification coordinator subscribes once and considers only `attention.created`; duplicate/out-of-order envelopes, `stream.reset`, Snapshot replacement, Attention-query refetch, and Host restart reconstruction are not arrivals. The coordinator claims each `attentionId` synchronously before asynchronous preference, window, metadata, permission, and delivery work, while the Rust boundary independently retains a bounded process-local delivered-ID set.

Windows WebView2 may suspend a minimized document and pause its SSE consumer. For the lifetime of the Desktop click-intent subscription, the adapter therefore holds a shared `navigator.locks` lease using the Wry/WebView2 background-execution workaround and releases it during teardown; environments without Web Locks safely no-op. This preserves the existing Web-owned Host stream rather than adding native polling, a second Attention projection, a daemon, or changed close semantics. Native intent queuing plus focus, page-show, and visibility wakeups safely recover a click event missed while the WebView was suspended.

The pure product model maps the three `AttentionType` values to fixed copy, truncates Project names at 24 graphemes and Conversation titles at 36 graphemes, and creates a minimal intent containing `attentionId`, type, `projectId`, `conversationId`, optional public `turnId`, title, and two-line body. It suppresses only when the main window is focused, visible, non-minimized, and the current Web surface is the Inbox or exact affected Conversation. Reading preferences, metadata resolution, permission, native delivery, diagnostics, and navigation are all best-effort and cannot interrupt Host streaming or mutate Attention.

Notification click activation is process-local. Rust queues a validated intent, calls the same ready/not-quitting window-restoration path used by Tray and single-instance activation, then emits one signal for the Web adapter to drain the bounded FIFO. Web revalidates the public intent and owns the Conversation route. Clicking never resolves an Approval, completed review, or failure; a stale click simply opens the current durable Conversation state. Hiding to Tray keeps the Desktop/Host process alive; explicit Tray Quit ends both, after which there is no daemon or closed-app callback.

The three default-on booleans are the only Phase 4C application preferences. Settings and delivery share a versioned, complete record under the installed WebView's origin-scoped `localStorage`; every successful toggle uses synchronous `setItem`, and missing, malformed, partial, inaccessible, or future-version data falls back safely. This file-free WebView preference boundary is separate from Project SQLite and from durable Attention. Browser has a different origin and an unavailable native adapter, so it exposes only an honest unavailable state and Inbox remains its notification surface.

### Host Sidecar and Revision Coupling

The production Host is still the TypeScript/Node Host. `desktop:sidecar` bundles its production entry and dependencies with esbuild while leaving Node built-ins external, then uses Node's official `--build-sea` flow to emit a target-triple-named executable under `apps/desktop/src-tauri/binaries`. The current direct SEA builder requires Node 25.5 or newer at build time. The packaged application does not require a separately installed Node.js runtime.

The build embeds one `git-<12-character-revision>` identity, with a `-dirty` suffix when applicable, into both the Host bootstrap and Rust shell. Desktop readiness accepts only Protocol v1 plus that exact build identity, preventing a shell from silently operating an unrelated bundled Host revision.

### Startup and Ownership

Desktop preflights `127.0.0.1:4317` before spawn. An existing CodeTether-shaped service and an unknown port occupant are distinct startup failures; neither is attached, stopped, or replaced. If the port is free, Tauri starts exactly one external binary with `CODETETHER_DESKTOP_MANAGED=1`, pipes its standard input, and passes one explicit Origin: `http://tauri.localhost` in production or the Vite Origin in development.

The managed Host installs its stdin/EOF watcher and waits for a private `start` activation before initializing the runtime. Rust sends that activation only after assigning the sidecar to its owned Windows Job Object, closing the spawn-to-ownership window in which a Codex descendant could otherwise escape the Job. Readiness then polls `GET /api/v1/bootstrap` instead of sleeping for a fixed interval. Startup has a 15-second ceiling and distinguishes a missing binary, spawn failure, existing Host, unknown port conflict, early Host exit, timeout, Protocol/build incompatibility, Windows lifecycle-hook failure, and tray creation failure. The lifecycle hook is attached before readiness completes, and the tray is created only after readiness and before the first window reveal; either initialization failure drains the owned Host and exits instead of leaving a partially managed shell. An unexpected exit after readiness reports a native Desktop failure; after acknowledgement, Desktop exits and releases its owned Job/process tree without entering an automatic restart loop.

### Shutdown and Parent Loss

Explicit Tray Quit writes the private line `shutdown\n` to the owned Host, waits up to 12 seconds for the existing Host graceful-close path, and only then terminates its own process tree on timeout. The Host stops new HTTP action admission, drains admitted mutations before Runtime/SQLite teardown, finalizes dirty SQLite state, closes HTTP/SSE, releases process-local Approval requests for restart-time durable expiry, and shuts down each owning Provider process through the established adapter lifecycle. Main-window X/Alt+F4 does none of these operations; it hides only. Windows sleep likewise records suspension without closing or restarting the Host.

In Desktop-managed mode, stdin EOF or channel error also requests the same graceful Host shutdown path. Windows additionally assigns the owned Host to a `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` Job Object. On abnormal parent death, stdin EOF and kernel Job teardown race: graceful close is attempted, while the Job guarantees no orphaned owned process even when it wins before SQLite can receive a full grace period. Existing restart reconciliation handles that crash boundary.

Phase 4G.2 subclasses only the exact main-window handle for Windows power/session messages. `WM_QUERYENDSESSION` is an immediate memory-only allow response; only confirmed `WM_ENDSESSION` invokes a 2-second best-effort bounded drain and continues OS termination. Cancellation rolls back that process-memory lifecycle state. Tauri's later unpreventable `RunEvent::Exit` shares the same idempotent guard, so it cannot begin a second drain. These safeguards are not authority to terminate a process discovered by port number. Non-Windows packaging remains future validation; the portable EOF protocol is isolated from the Windows Job Object and Windows message implementations.

### Native Security Boundary

`withGlobalTauri` remains disabled. The `main` WebView capability contains only the reviewed application permissions for `allow-project-directory-picker` and `allow-attention-notifications`; `core:event:allow-listen` / `allow-unlisten`; the three focused, minimized, and visible window-state reads; and `notification:allow-is-permission-granted` / `allow-request-permission`. The application permissions expose only `pick_project_directory`, `deliver_attention_notification`, and `take_pending_notification_intent`. Tauri's built-in `tray-icon` feature is Rust-owned, its Explorer recovery remains inside the pinned Tauri 2.11.5 / `tray-icon` 0.24.2 implementation, and it adds no Web command or capability. Phase 4G.2 reuses event listen/unlisten only for the process-local resume signal. There is no `notification:default`, `notification:allow-notify`, plugin wildcard, shell, process, filesystem, clipboard, global-shortcut, app-exit, or generic native command permission. Browser mode receives unavailable native capabilities and never executes the dynamically imported Tauri core, event, window, or notification modules.

The command uses the official Rust `tauri-plugin-dialog` 2.7.2 API to open one folder-only, single-selection dialog parented to the CodeTether main window. It accepts no frontend path or options and returns only `Option<String>`: a selected Unicode path or cancellation. It does not enumerate, read, write, canonicalize, authorize, or register that directory. The same `AddProjectDialog` then sends the selected string through `HostRuntime` and `packages/client` to the existing Project API. Host real-path and workspace policy remain the authorization boundary.

Tauri 2.11.5 registers the official Rust and JavaScript notification plugin 2.3.3 for the platform permission check. Windows display/click behavior uses the reviewed `tauri-winrt-notification` 0.7.3 boundary because the intent must restore the existing window and return exact public identities. Rust denies unknown fields, private/malformed identities, control characters, overlong content, and more than two body lines before delivery. Its queue and dedupe sets are bounded, and failure returns a safe error while logging only a Desktop diagnostic.

There is no `invoke("run_command")`, generic `invoke("native_action")`, arbitrary shell argument bridge, or filesystem grant to Web content. Tauri's folder dialog is directory acquisition, and native notifications are best-effort Attention delivery; neither is a second Client-to-Host protocol.

Production CSP allows HTTP/SSE connection only to `http://127.0.0.1:4317`; `script-src 'self'` permits only packaged same-origin entry and dynamic-import chunks, without remote scripts or `'unsafe-eval'`, and wildcard source directives are absent. `removeUnusedCommands` remains enabled. The Rust build manifest explicitly enumerates the three application commands, and the generated release allow-list contains exactly those commands even though the Browser-safe adapter is code-split. Development adds only the explicit Vite HTTP/WebSocket endpoints and its required eval allowance. The Host still binds loopback only and retains strict Host/Origin validation; Desktop-managed startup allowlists only its explicit WebView Origin rather than weakening CORS.

## Phase 6A Durable Machine Foundation

Machine is a Host-owned durable product entity, not a hostname, network address, hardware fingerprint, or process. Migration 008 creates one random `machine_*` row for the existing CodeTether data root with the safe display name `本地电脑`, `kind = local`, detected platform/architecture, creation time, and last-seen time. The unique local-kind constraint and migration ledger prevent restart duplication. The identity survives ordinary Host/Desktop restart, reboot, and application update because the database survives; deleting the data root is a new-install boundary and may produce a new identity. No Windows MachineGuid, serial, MAC, IP, username, Host/Desktop PID, or executable/install path is stored or published.

The durable ownership graph is:

```text
Machine
  └── Project Location (project_id, machine_id, canonical root)
        └── Conversation (project_id, machine_id, immutable provider)
              └── Turn / Attention / Search projection
```

`projects` now owns only logical Project identity, name, and timestamps. `project_locations` owns the authorized canonical root/key and timestamps under a composite `(project_id, machine_id)` identity; Phase 6A creates exactly one local Location for every Project, and Phase 6B.3 may add one Location for that logical Project on each trusted remote Machine. A unique Machine/root-key constraint prevents two Projects from claiming the same canonical directory. Every Conversation has a required `machine_id` and a composite foreign key to its exact Project Location. SQLite and Store update guards reject Machine reassignment, just as Provider and Project execution binding remain immutable. Migration 008 rebuilds the complete Project/Conversation-dependent foreign-key graph in one transaction so Provider session identity, Turn snapshots, Attention, organization metadata, Search documents/indexes/triggers, and public identities survive unchanged or all changes roll back.

`MachineRegistry` owns local Machine identity and safe CodeTether-level capabilities. `ProjectRegistry` owns Project/Location authorization. `ProviderRegistry` remains a separate adapter lookup. `HostService` composes them only through a narrow Machine-scoped Provider query: Conversation creation first validates the selected Machine, then the selected Provider descriptor on that Machine, then the Project Location. A Turn revalidates the Conversation's immutable Machine and exact authorized Location before native Provider resume. Machine reads, Project reads, Conversation history, Search, Rename, Pin, Archive, and Unarchive never admit a Runtime slot or create/resume a Provider process.

Protocol v1 adds strict `GET /api/v1/machines` and `GET /api/v1/machines/:machineId` reads. Detail returns one public Machine summary, the Provider descriptors evaluated for it, Projects projected with only Locations on it, and at most 100 recent public Conversation summaries. It never returns PIDs, private Provider session identity, arbitrary environment/device data, SQLite rows, or an executable path. Conversation creation requires `projectId`, `machineId`, and Provider; the response is validated against all three. There is no Machine mutation, command execution, heartbeat, telemetry event, remote endpoint, or generic native bridge.

The shared Web/Desktop UI stores Machine reads only in TanStack Query. `/machines` and `/machines/:machineId` show truthful local metadata, Providers, Projects, and recent Conversations. New Conversation preselects the sole eligible Machine but sends its real identity and uses that Machine's Provider descriptors. Project and Conversation views present Machine ownership without offering reassignment. Standalone Browser uses the same loopback Machine APIs; Desktop-managed capability flags truthfully add background runtime, native picker, and notification availability without moving ownership into Rust.

### Remote Node identity and pairing

Phase 6B.1 adds a separate `apps/node` process rather than duplicating the Host. The Node persists random CodeTether-owned Machine and Node identities plus a P-256 TLS identity; none derive from hostname, address, hardware, process, or installation identity. Its framed protocol is a closed union rather than generic RPC. Phase 6B.3 adds one authenticated Project Location validation request to the accepted pairing, identity/status heartbeat, endpoint-recovery, and trust-revocation messages. Accepted Phase 6C.1 adds one authenticated Provider-description request whose installation implementation can run only the two fixed version probes owned by Node code. Accepted Phase 6C.2 adds a dedicated bounded authenticated Codex session connection. Accepted Phase 6C.3 adds a Node-private bounded Claude authentication/readiness probe plus a parallel exact Claude session connection with validated effort and canonical Read/Search Tool events. The readiness result may enable only the exact execution capability subset; it does not change the public installation observation or expose credentials. In both execution cases the Controller supplies only exact product identities, the registered canonical root, an optional private native session identity, one action identity, and bounded Prompt text. The Node still has no Project/Conversation/Search/Attention database, shell, generic filesystem, arbitrary process/argv/environment/cwd, or Terminal handler. One Node accepts at most one trusted Controller.

Manual pairing starts with TLS 1.3 and a short-lived in-memory six-digit code. The code is proved with the RFC 9807 OPAQUE PAKE construction rather than transmitted, then the PAKE session is bound to the exact Machine/Node/Controller identities, nonces, and TLS exporter. Both screens show the same derived verification code before the user explicitly confirms. The code expires after five minutes, admits at most five login attempts, is consumed once, and is never persisted. Durable reconnect uses mutually presented certificates with exact pinned public-key fingerprints and rejects protocol, Machine, Node, Controller, or key replacement.

Migration 009 transactionally widens only the Machine kind and stores private peer binding in `trusted_machine_peers`; the accepted local Machine and complete Project/Conversation graph are copied unchanged. Public Protocol v1 exposes only safe Machine metadata and lifecycle state. Controller private keys live outside presentation SQLite under the Host data root; Node private identity stays in its own state root. POSIX files are mode-hardened, while Windows relies on the inherited per-user application-data ACL rather than DPAPI or a credential vault; this limitation is explicit. Unpair first records durable `revoking`, requires authenticated Node revocation, then removes local credential/trust state. Lost acknowledgements and credential-deletion failures remain fail-closed in bounded recovery instead of restoring possibly revoked trust.

The Host resolves a manually supplied endpoint, requires every resolved address to be private LAN space, and never modifies firewall policy or performs discovery. A single bounded worker per trusted Machine maintains authenticated liveness with exponential jittered backoff and publishes low-frequency `machine.updated` transitions. Phase 6B.2 stores at most eight private endpoint hints separately from trust, with one preferred authenticated endpoint and bounded fallbacks. A new manual address remains ephemeral until TLS public-key pinning plus the durable Machine and Node identities all match; only that authenticated success may insert and promote it. Mismatch cannot mutate trust, endpoint preference, or Machine identity. Private IPv4 and IPv6 ULA endpoints are parsed explicitly; unsupported link-local IPv6 scope handling is rejected rather than guessed.

### Remote Project Locations

Phase 6B.3 reuses the existing version-10 `projects` and `project_locations` schema, whose `(project_id, machine_id)` primary key and per-Machine canonical-root uniqueness already support one logical Project on multiple Machines. No schema migration is required. Host SQLite remains authoritative; the Node owns no duplicate Project record. Existing Project reads expose bounded presentation-safe Location summaries, and `POST /api/v1/projects/:projectId/locations` accepts an idempotency action, exact trusted remote `machineId`, and bounded path. The Host requires active trust and online authenticated transport before requesting validation. `DELETE /api/v1/projects/:projectId/locations/:machineId` accepts a separate idempotency action and removes only the exact remote association in a Host transaction after checking that no durable Conversation uses the same Project/Machine pair; the local Location is not independently removable. The authenticated validation operation is serialized per Machine; durable insert, removal, and the opposing unpair transition each recheck their constraints atomically in SQLite, so none can leave a dangling reference.

The Node rejects a non-absolute, missing, inaccessible, or non-directory path, resolves symlinks with the operating system's `realpath`, and returns only canonical path, basename, and fixed existence/directory confirmations. The request and response bind a fresh request identity plus the already authenticated Machine and Node identities; framing and path sizes remain bounded. There is no listing, file content, generic stat, read/write/delete, environment, credential, shell, or arbitrary method surface. The same Project/Machine/canonical path is idempotent, a different path for the pair conflicts rather than relocating, and another Project cannot claim the same canonical path on that Machine.

At the accepted Phase 6B.3 boundary, a trusted remote Machine advertises `projectAccess: true` and retains `providerExecution: false`. Accepted Phase 6C.2 may independently enable only its current tested remote Codex streaming/resume profile. Accepted Phase 6C.3 may enable only the current tested restricted Claude streaming/resume/Read/Search/effort profile. Phase 6C.4 changes neither profile. Every capability outside the exact Provider profile remains false. Project/Location and Machine-detail reads do not contact the Node, start a Provider, hydrate a Conversation, or poll the remote directory. A stored Location remains visible while its Machine is offline. Remote Location removal is an offline-capable Host metadata mutation: it performs no remote filesystem operation, trust mutation, or Provider admission. A second removal deterministically reports not found. Unpair continues to fail with `machine_has_project_locations` until every remote Location is explicitly removed, after which the frozen authenticated revocation path runs as a separate action.

### Remote Provider discovery

Accepted Phase 6C.1 extends the closed Machine message union with exactly `providers.describe` and `providers.described`. The authenticated request binds a fresh request identity plus the already pinned Machine and Node identities and carries no executable, argv, path, Prompt, workspace, or generic method field. The response contains exactly the canonical Codex and Claude Code public identities, safe availability/version data, the canonical capability booleans, and one observation timestamp.

Accepted Phase 6C.2 extends that same closed union only with exact Codex session open/ready/dispose and Turn start/started/event messages. Accepted Phase 6C.3 adds the corresponding exact Claude session family rather than a generic Provider method. Each session binds protocol, pinned Machine/Node, public Conversation/Project, registered root, and private native Provider identity; each Turn binds one action, Conversation, public Turn, private Provider identities, and bounded Prompt. Claude adds only one validated effort enum plus bounded canonical text and Read/Search Tool envelopes. No caller selects executable, argv, environment, model, shell, arbitrary cwd, Tool name, or method name. The Node revalidates the stored canonical directory immediately before each Prompt and launches the fixed tested Provider profile with `shell: false`. Codex rejects every unexpected Tool/file/Approval/server request/raw notification, while Claude admits only normalized Read/Glob/Grep events and fails closed on mutation, shell, unknown Tool, or malformed stream activity. Output framing, queue bytes, total output, concurrent sessions, and lifetime are bounded. Ambiguous loss is terminal and never causes automatic Prompt replay.

`apps/node` runs the two probes in parallel with fixed executable names and `--version` argv, `shell: false`, ignored stdin, a non-Project temporary working directory, a restricted environment, five-second timeout, independent four-KiB stdout/stderr limits, fatal UTF-8 decoding, and exact owned-child termination. It never returns executable paths, raw output, stderr, PATH, environment, credentials, or diagnostics. A malformed, unavailable, or unsupported executable becomes only a bounded Provider availability state; one failed probe does not discard the other result.

Migration 011 adds `remote_machine_provider_observations`, keyed by trusted Machine and canonical Provider identity with cascade cleanup on revocation. It stores only the validated public descriptor JSON and authenticated observation time. The reconnect coordinator admits at most one in-flight discovery per Machine, runs one bounded detection after authenticated reconnect, and permits one explicit refresh. Ordinary Machine/Project/Search reads never trigger detection. A successful observation publishes the existing low-frequency `machine.updated` signal; an offline or not-current connection exposes the durable snapshot only as `last_known`, while a Machine with no snapshot is `not_observed`.

Local Provider execution ownership remains in `ProviderRegistry`; remote discovery belongs to `RemoteMachineCoordinator` and never creates a runtime adapter, session, Conversation, or hydration slot. CLI availability alone therefore leaves `providerExecution: false`. Accepted Phase 6C.2 admits Codex only for an online authenticated Machine whose current descriptor exposes the separately tested streaming/resume profile. Accepted Phase 6C.3 independently admits Claude Code only when its current descriptor exposes the entire restricted streaming/resume/Read/Search/Tool-events/reasoning profile.

### Phase 6C.4 remote execution reliability

The Host owns restart-safe Turn admission, not remote execution replay. Migration 012 adds `turn_start_actions(action_id, turn_id, created_at)` with one unique public Turn per action. Creation of that association and the durable Turn/Conversation transition occurs in one SQLite transaction before the runtime is asked to start the Provider. The ordinary in-memory action cache still shares concurrent same-process requests, but after restart the durable lookup returns the exact existing Turn and validates its Conversation and canonical input. An action collision with different intent is rejected. There is no durable Provider event stream, action-result cache, or exactly-once guarantee for other mutations.

The machine client bounds every frame and pending socket write. After it sends a Turn-start frame, any timeout, abort, close, malformed acknowledgement, or identity mismatch makes Prompt ownership uncertain; it tears down that dedicated session and reports a canonical terminal failure. Neither the reconnect coordinator nor runtime retries that start. Session open has an earlier equivalent uncertainty boundary: once pinned TLS/Machine authentication has completed, any purpose-specific rejection, timeout, close, or malformed/missing ready response is marked authenticated and the coordinator stops that semantic operation. It neither falls back to another remembered endpoint nor records the authenticated endpoint as failed, because the Node may already have opened the native session and a second address attempt could duplicate it. Pre-authentication connection failures may still use the bounded endpoint recovery loop. Provider lifecycle discovery now owns an explicit 85-second overall work budget and a 110-second authenticated response ceiling. The work budget permits a bounded multi-install scan to run its several zero-inference version/help/handshake/schema/session-discovery contracts, but deliberately may end a pathological scan early rather than claiming a full worst-case completion bound. Its cleared, unref'd creation-time deadline aborts and awaits the exact shared probe generation; the additional 25 seconds exceeds three five-second cleanup waits and retains ten seconds for authenticated delivery. The private adapter may retain a probe-specific classification, but Protocol v1 projects verified lifecycle timeout through its existing retryable `provider_start_failed` code/reason; stronger cleanup uncertainty remains a canonical `execution_ownership_uncertain` failure carried by that already-admitted Provider operation code, distinct from a silent transport timeout or Node disconnect. A purpose-specific Provider session ready response has a composed 200-second ceiling: the complete 110-second lifecycle response envelope, up to five seconds each for the Node's outer Claude version probe, Claude preparation version probe, and Claude authentication-status probe, up to 30 seconds each for cold Codex initialize and thread start/resume, and the existing bounded 15-second handshake transport/scheduling margin. Both session-open paths therefore retain their full post-lifecycle handshake budget without allowing Controller to destroy a potentially accepted native session. While a Turn is active, the Node does not apply a wall-clock session receive timeout: quiet Provider work may continue until a canonical terminal event, connection loss, or explicit shutdown/disposal. This separates bounded transport progress from an artificial maximum Agent runtime.

Each remote runner drains Provider events through a bounded count-and-byte queue. Only adjacent compatible text deltas—and, for Claude, adjacent output from the same Tool item—may coalesce at the tail, preserving concatenated content and identity. A reliable event that cannot fit forces one safe terminal failure; terminal state is not silently dropped, and a slow Controller cannot produce unbounded Node memory.

The Host separately holds at most 512 Provider events or 4 MiB while startup events arrive before their private Provider Turn is bound to the admitted public Turn. Overflow records a marker keyed by exact Machine, Provider, private session, and Provider Turn, and removes only matching unbound events. Later frames for that marked session are ignored; unrelated buffered events and already running Turns continue unchanged. The Runtime subscription callback catches Host translation and durability failures instead of throwing through Provider-owned cleanup. Before publishing `running` or installing the Provider-Turn mapping, the owning Start action checks the marker and awaits `disposeConversation` for that exact private session. Cleanup success leaves the session requiring resume; cleanup rejection leaves it unavailable and retains a session-scoped barrier. Either path writes and publishes exactly one durable failed terminal, and a later Provider terminal cannot replace it. A local Runtime failure likewise terminalizes only the local Machine's matching Provider Turn rather than a remote Turn with the same private identity.

Cleanup is a keyed ownership barrier rather than fire-and-forget disposal. Each Host remote runtime tracks cleanup by both the encoded private Provider session and public Conversation, so same-Conversation create or hydration awaits the previous close and only one competing opener can proceed afterward. Each Node runner pool likewise retains the Conversation entry until the exact Provider process cleanup resolves. The Host's global eight-Conversation accounting includes pending disposals; a rejected disposal remains charged, and an unverified Node cleanup prevents replacement execution rather than assuming ownership was released. Shutdown awaits tracked openings, Turn pumps, and cleanups and reports cleanup failure instead of swallowing it.

Post-open failures use the same exact boundary. If an opened session has mismatched identity, collides with active ownership, arrives after runtime close, cannot be durably retained during Conversation create/resume, or returns an invalid/reused Turn identity, the owning layer closes and awaits that exact session before publishing the error. Cleanup failure changes the Conversation/runtime to unavailable and remains a barrier; it never silently rolls back public state while leaving an untracked native session or Provider tree.

On Linux, the Node launches each Provider through a private guardian owned by the same packaged executable. The guardian receives a bounded structured launch record over a private pipe, creates the Provider as the leader of its exact POSIX process group, and treats Node-parent pipe EOF as hard-parent death. It then terminates that exact group with bounded graceful and forced stages and refuses unsafe or changed identities; normal shutdown uses the same ownership path. This is the POSIX counterpart to exact owned-tree cleanup, not a general process-launch API.

Each active dedicated Codex or Claude execution connection also carries one Provider-specific authenticated heartbeat/ack. The Host starts it only after the Node has acknowledged Provider ownership; the Node renews an independent bounded Controller lease only from valid control messages for that exact Conversation/session. Missing acknowledgements close the Host session, and lease expiry destroys only the corresponding Node connection so its ordinary `finally` path awaits exact runner/guardian cleanup. The lease is connection ownership, not an Agent-progress timer: long silent Provider work remains valid while authenticated heartbeats continue, and neither side automatically replays an uncertain Prompt.

One `RemoteMachineCoordinator` remains responsible for each trusted Machine. Initial connection work has a bound, retry requests coalesce with the existing worker, backoff/timers remain capped, and endpoint flapping cannot create parallel attempts. Node state locking records process identity plus a random nonce, serializes stale-lock recovery through a short-lived recovery lock, validates liveness and an unchanged lock record, and removes only that proven stale file. A live owner, changed record, unsafe path, or unresolved race remains a startup failure.

### Phase 6D canonical failure and recovery boundary

Phase 6D uses one Provider- and Machine-neutral diagnostic path for local and remote execution:

```text
bounded private Provider / Runtime / Machine evidence
        -> owning adapter or transport classifier
        -> validated CanonicalFailure
        -> HostError + durable Turn snapshot
        -> Protocol v1 / Attention / bounded execution-health observation
        -> controlled Web copy and explicit recovery action
```

`packages/agent-core` owns the exhaustive `CanonicalFailure` vocabulary. A record contains one reason, its fixed category, retryability, user action, high-level source, occurrence timestamp, and matching CodeTether-owned technical code. Categories are `authentication`, `quota`, `provider`, `machine`, `project`, `runtime`, `transport`, and `generic`. Reasons distinguish login/expired/invalid/account authentication; usage, rate, and Provider-capacity limits; installation, unsupported version, misconfiguration, service, startup, crash, native-session, and protocol failures; offline/disconnected/identity/remote-execution Machine failures; missing/invalid/unavailable Project Locations; capacity, busy, lost/uncertain ownership, and output/protocol Runtime limits; lost/authentication/reconnecting transport; and conservative Provider, Runtime, or unknown fallbacks. Retryability is exactly `retry_now`, `retry_later`, `retry_after_user_action`, `not_retryable`, or `unknown`; the action enum permits only CodeTether-owned retry/wait/login/Machine/Project/repair/reconnect/reinstall/update/capacity/details/provider-contact/none choices and contains no URL or free-form Provider instruction.

Protocol v1 validates the complete reason profile, not merely each field independently: category, retryability, action, source, and technical code must match the selected reason. `HostError.failure` adds this record without removing the existing bounded public code/message compatibility boundary. The Host accepts an already validated canonical record, a recognized CodeTether-owned reason, or an allowlisted legacy error code. It never derives product semantics from an arbitrary exception message, stderr, stdout, JSON-RPC/JSONL envelope, TLS diagnostic, or Web-provided string; an unrecognized condition becomes a generic canonical failure. Historical Turns that contain only an older broad Host error keep that broad meaning and are not rewritten with guessed specificity.

Classification happens at the first boundary that owns reliable structured evidence. The Codex adapter maps only stable App Server `codexErrorInfo` forms, including usage-limit, unauthorized, overloaded/service, and structured HTTP 401/429 conditions. The Claude adapter maps only exact stream-json error/subtype tokens and its bounded machine-readable detection result. Startup, exact child exit, native-session loss, protocol-bound violations, Project validation, capacity/busy state, Machine connectivity, and execution-ownership uncertainty are classified by their owning adapter, Runtime, Project, or Machine-transport layer. Web has one exhaustive presentation mapping over canonical reasons and no Codex/Claude regex or stderr parser. Provider-private input remains within existing bounded parsers/frames and is discarded after classification; only the small controlled record may cross the public or persistence boundary.

A failed Turn retains its bounded `HostError`, including `CanonicalFailure`, in the existing durable Turn snapshot. Terminal persistence, Attention creation, Snapshot/cold-detail reconstruction, archive reads, and restart recovery therefore share one classified outcome. Duplicate or delayed terminal events still use the frozen Turn/event idempotency rules and cannot create another failure card or overwrite the first terminal outcome. Abnormal Host-restart reconciliation may preserve the existing `interrupted` status while attaching `execution_ownership_uncertain`; diagnostic richness does not rewrite the terminal state or claim that Provider work did not run. Partial Agent text and Tool events already durably observed remain separate history rather than being promoted to a completed answer or hidden by the failure card.

Migration 013 (`provider_execution_health`) adds one replaceable row per `(machine_id, provider)` in `machine_provider_execution_health`. It stores only `state`, a canonical `failure_json` when required, and `observed_at`; the JSON is validity-checked and capped at 4 KiB. State is exactly `healthy`, `degraded`, `unavailable`, or `unknown`, and a timestamp-ordered upsert prevents an older observation from replacing newer truth. Provider installation/version/capability discovery remains in its existing descriptor/remote-observation boundary and is never rewritten because execution encountered authentication, quota, service, or Runtime failure. Machine Detail composes both facts; connection state determines whether execution health is presented as `current` or `last_known`, so an offline Machine never implies a live health check.

Health changes only from bounded trusted lifecycle observations: an execution start/terminal failure that actually describes Provider execution, or a later successful explicit Turn. Success records `healthy` for current presentation but never edits the historical failed Turn. Discovery and reads do not clear health, start a Provider, consume hydration capacity, or create continuous monitoring; reconnect may expose the existing bounded discovery/observation flow but adds no timer or health-only probe. Quota, rate-limit, service, and terminally cleaned-up crash observations are advisory rather than permanent Composer locks, allowing a later explicit Turn to test current truth under all ordinary eligibility gates.

Recovery remains a new user command, never runtime replay. A failure-card Retry is available only for the fixed `retry_now` plus `retry` profile after the old Turn is known terminal; it starts a new Turn in the same immutable Conversation with a fresh `actionId`, public Turn identity, and Provider execution identity. The old input is reused only because the user explicitly chose that action, and the old Turn, failure, and Attention remain immutable. `execution_ownership_uncertain`, `execution_lost`, and `transport_lost` are explicitly non-retryable because Provider acceptance or side effects cannot be proven. `provider_crashed` is likewise conservative: process termination proves that ownership ended, but not that the previous execution made no side effect, so the exact old Prompt is not offered as a safe Retry. Composer and New Conversation controls apply deterministic current-state precedence—Machine offline/reconnecting before stale Provider health, then exact Project Location and installation/capability eligibility, then Conversation/runtime capacity—and expose the matching explanation rather than arbitrary first-error-wins behavior, silent local/other-Machine fallback, or an alternate working directory.

The Timeline failure card, Machine Detail, Inbox, and existing failed-Attention notification path render only controlled copy selected by canonical reason plus already-public bounded Provider/Machine labels. Failure cards state that execution may be incomplete and that saved Conversation history remains readable; they do not promise that files or external side effects are unchanged. Keyboard-accessible actions may navigate only to validated CodeTether Machine/Project routes, and expandable technical details contain CodeTether codes/source/time rather than raw Provider content. Existing stable Attention source keys and notification Attention-ID deduplication remain authoritative, so reconnect, replay, restart, and multiple clients cannot manufacture another failure or delivery.

## Phase 7A Internet Relay Architecture Foundation

Phase 7A introduces a standalone `apps/relay` service and `packages/relay-protocol` control contract. The Relay is deployed independently from Desktop, Host, Node, and Web; it imports no Provider adapter, opens no Project, executes no CLI, and has no access to Host product SQLite. `packages/relay-protocol` is a strict discriminated message union with fixed protocol version and explicit frame, identifier, string, timeout, and pending-message bounds. Unknown fields and messages fail validation. The schema deliberately has no arbitrary `payload`, byte tunnel, execution, Prompt, Conversation, Provider, Tool, filesystem, shell, Terminal, or command representation.

### Identity and trust separation

Relay identity is a durable random ECDSA P-256 application identity generated once into the Relay's restricted state directory. Its fingerprint is independent of hostname, public IP, Alibaba instance identity, TLS certificate, and deployment path. Ordinary restart, certificate renewal, endpoint change, or state-preserving upgrade retains it. Missing, inconsistent, or unexpectedly replaced identity fails startup or client verification rather than silently generating or accepting a replacement. An explicit operator action is required to replace it.

TLS authenticates and encrypts the Internet transport; the pinned Relay application identity authenticates the CodeTether Relay independently. A normal public deployment validates both the CA-signed hostname certificate and the configured application fingerprint. A no-domain or development deployment must explicitly pin its transport certificate public key and the Relay application identity. That mode may bypass public-CA chain validation only so it can enforce the exact configured SPKI pin; there is no mode that skips both CA validation and explicit pin verification, and there is no plaintext fallback. An intentional endpoint update can retain enrollment only after the new endpoint proves the same Relay identity. A different Relay identity fails closed and leaves the previously pinned identity and endpoint state unchanged.

Machine trust remains exclusively the frozen Controller ↔ Node trust relation. The Node reuses its existing durable Node P-256 private identity; Relay stores only its public identity and fingerprint. The Host reuses the existing per-Machine Controller identity already created and pinned during pairing rather than inventing an account, global user key, or Relay-only Machine identity. Controller private keys remain Host-private, Node private keys remain Node-private, and Relay never receives either.

The Node authors a bounded reciprocal rendezvous grant naming the already-paired Controller fingerprint from its private trusted-controller state. Initial enrollment binds that assertion into the Node-signed enrollment transcript; a later replacement is accepted only from the exact current authenticated Node connection epoch. Relay authorizes a Controller presence query only when the authenticated Controller fingerprint matches the authenticated target Node's current grant. The Controller may request only a Node already represented by its local trusted Machine record; Web cannot supply an arbitrary Relay peer fingerprint. Both peers sharing one Relay, or knowing another peer identifier, creates no trust. Relay exposes no global peer list, search, or existence oracle to an unauthenticated or unauthorized caller.

Relay peer role is exactly `controller` or `node`, is authenticated and fixed at enrollment, and cannot mutate on reconnect. Relay infrastructure revocation closes the current epoch and blocks future Relay authentication, but does not delete or mutate Host/Node Machine pairing. Regaining Relay access requires explicit re-enrollment of the same cryptographic identity and immutable role with a newly issued role-scoped one-time token; neither revoked credentials nor a consumed token can silently restore access. Machine Unpair likewise remains a separate frozen product operation and does not implicitly administer the Relay.

### Enrollment and authenticated reconnect

An operator creates a random high-entropy, role-scoped, expiring, one-time enrollment token. Relay persists only bounded non-reusable token-verification metadata; plaintext token values never enter logs, metrics, evidence, public API responses, or durable client state. Token consumption and peer registration occur in one transaction with uniqueness constraints, so simultaneous attempts produce exactly one success. Replay, expiry, wrong role, peer-identity mismatch, and reuse after revocation fail safely without disclosing whether some other peer exists.

After enrollment, every connection proves possession of the enrolled identity key. Relay issues a cryptographically random, short-lived, one-use, connection-bound challenge; the signature transcript binds protocol version, Relay identity, peer identity and role, connection context, challenge identity/nonce, and expiry. A challenge is invalid after success, timeout, disconnect, or another connection, and recorded challenge/signature pairs cannot authenticate a later socket. Successful authentication creates a random ephemeral connection epoch. Peer identity maps to exactly one current epoch; the deterministic latest-authenticated-wins policy closes and invalidates the previous socket. Heartbeats and every state-changing control message carry the current epoch, so delayed frames from a replaced connection cannot refresh presence or mutate authorization.

### Presence, liveness, and rendezvous

Both Host/Desktop and Node initiate outbound persistent TLS control connections. Host owns the Controller connection and keeps Relay credentials out of Web. Node owns its connection independently and may remain present when Desktop is not running. Neither peer needs an inbound Internet listener, public address, static address, port-forwarding rule, UPnP, hole punching, STUN, TURN, WebRTC, VPN, or router configuration.

Heartbeats contain only bounded liveness identity such as epoch and ping identity. A missed bounded deadline retires the epoch and changes presence to offline; duplicate or delayed heartbeats cannot revive a stale epoch. Clients use one coalesced reconnect owner with capped exponential backoff and jitter, reset only after stable success. Reads and UI renders do not create workers, and an unreachable Relay cannot produce a busy loop, parallel timers, or failure of local/direct Machine operations.

Presence is ephemeral `online` or `offline`, with only a bounded safe `lastSeen` observation retained when needed. Rendezvous answers only `online`, `offline`, `unknown/not-enrolled`, `revoked`, or `protocol-incompatible` for an authorized exact peer. These are infrastructure reachability facts, not Provider health, Machine direct connectivity, Project Location validity, Conversation state, or execution eligibility.

### Relay persistence and operational boundary

Relay owns a separate minimal versioned SQLite registry containing its application identity and infrastructure records. A non-secret initialization marker in the same restricted state directory makes loss of an initialized database fail startup rather than generating a replacement identity. Durable records are limited to the Relay identity, enrolled peer public identity/fingerprint, immutable role, revocation, reciprocal Node-authored grants, bounded enrollment-token digest/scope/expiry/consumption metadata, schema/protocol metadata, and safe operational timestamps. WAL/transactions, uniqueness constraints, atomic migration, restrictive filesystem permissions, and indexed token state protect concurrent enrollment and restart. Live sockets, challenges, presence, connection epochs, pending messages, and retry timers remain ephemeral.

The Relay never stores Projects, Project Locations, Machines as product records, Conversations, Turns, Attention, Search, Prompts, Agent output, Tool output, Provider credentials or sessions, filesystem paths, source code, Diffs, Terminal output, raw environment, or future execution envelopes. Backup and restore cover only the Relay identity and minimal registry and must be performed as one consistent state unit; restoring them preserves the fingerprint and peer enrollment. Relay is not a second Host database, account system, directory, telemetry backend, or cloud authority.

The public service accepts TLS on TCP 443. Health/readiness output is minimal and exposes no registry or peer identity; detailed operational metrics are bound to loopback or another explicitly private management boundary. Safe metrics may count active authenticated connections by role, reconnects, auth/enrollment outcomes, rate limits, heartbeat timeouts, uptime, RSS, and file descriptors. Logs use controlled event codes, safe role, opaque/redacted peer reference, epoch, and timestamp only; tokens, keys, signatures, challenges, network payloads, Projects, Providers, and product data are forbidden. Untrusted strings are length/character bounded before structured logging.

Server limits cover total and per-peer connections, handshake/auth deadlines, maximum frame and pending-control queue sizes, heartbeat timeouts, enrollment/auth/malformed-frame rates, and graceful shutdown time. Limits use both connection-level and authenticated-identity controls where possible rather than treating a NAT source IP as identity. Graceful SIGTERM stops admission, closes peer epochs, finishes required transactions, closes SQLite, and exits within a bound. Hard restart relies only on committed identity/enrollment state; reconnect needs no new token and creates new epochs.

### Host, Node, and product presentation

Protocol v1 remains the Web ↔ Host boundary. It may expose only bounded presentation-safe Relay configuration, Controller connection status, authorized Node presence, Relay fingerprint/label, and controlled diagnostics. Enrollment tokens cross only an explicit Host mutation and are cleared after use; private keys, raw TLS/WebSocket diagnostics, signatures, challenges, private peer identities, and Relay registry data never reach Web or browser storage. Low-frequency Relay status invalidation is separate from `Machine.connectionState` so Relay presence cannot imply direct execution readiness.

Phase 6D's canonical diagnostic boundary extends only with CodeTether-owned Relay reasons such as not configured, unreachable, authentication failed, identity mismatch, protocol incompatible, revoked, and rate limited. The owning Relay client classifies bounded transport/protocol evidence; Web never parses TLS/socket prose. Machine Detail and Settings may show configured/enrollment/connected/reconnecting/offline state and authorized Node presence, but must state that Internet execution through Relay is not enabled. They expose no account, credential-management, global peer discovery, or execution switch.

Direct LAN Machine transport is preserved without routing changes. A connected Relay neither replaces the remembered direct endpoint nor becomes a fallback for session open, Turn start, Provider events, or Project Location operations. A Relay outage must leave local Providers, direct remote Codex and restricted Claude, Search, organization, Attention, durable history, and Phase 6D failure presentation operational. Tests must prove that Relay's schema cannot express execution payload and that real direct Provider execution sends no Agent data to Relay.

The production artifact is a standalone Linux service that does not require the source repository or a system Node.js installation at runtime. Its service account, explicit state/configuration directories, restrictive permissions, bounded logs, restart policy, SIGTERM behavior, backup/restore, upgrade, TLS, health, and public-port policy are documented beside the service. The Alibaba Cloud security group requires public inbound TCP 443 only for Relay; SSH administration remains under the Owner's existing policy, and development ports or the database are never exposed.

REAL Alibaba validation requires Owner-provided authorized access: an SSH-accessible target, username and approved authentication method, sudo/systemd permission, domain/DNS and TLS/ACME disposition, security-group verification authority, and a decision whether the production service remains running afterward. If those inputs are unavailable, local/staging protocol and lifecycle validation still proceeds, but no REAL Alibaba result or ready assessment may be fabricated. The Phase 7A attacker assumptions and explicit non-claims are maintained in `docs/PHASE7A-THREAT-MODEL.md`.

## Phase 7B Authenticated Relay Transport

### End-to-end trust and stream reuse

Phase 7B extends the Relay protocol to version 2 with one channel purpose: `machine_tls_v1`. A Controller may request a channel only for the exact Node allowed by the frozen reciprocal rendezvous grant, and the Relay binds the channel to fresh random channel identity/generation plus both current authenticated connection epochs. It cannot name a host, port, URL, process, Provider, Project path, or arbitrary destination.

Relay authentication authorizes use of Relay infrastructure only. After the Node prefilters an offer against its exact currently paired Controller fingerprint, the Controller and Node establish the existing TLS 1.3 `codetether-machine/1` session inside the Relay stream. The Controller still pins the expected Node certificate, Node identity, Machine identity, and protocol; the Node still validates the Controller certificate against its private Machine trust. Direct sockets and Relay Duplex streams then share the exact Machine hello, Location validation, Provider discovery, Codex/Claude session-open, Turn, lease, capacity, cleanup, and Node dispatcher paths. No Provider capability or execution policy is duplicated at the Relay boundary.

### Routing and execution ownership

Production routing is `direct_first`. Each idle Machine operation tries the existing authenticated direct endpoints first and may open a Relay channel only after direct connectivity fails before an authenticated semantic operation could have been accepted. An identity/protocol failure or any error marked `peerAuthenticated` is authoritative and stops fallback. Relay success records only Relay authentication; it does not promote or poison a direct endpoint. `relay_only` exists solely as an internal validation seam and is not a user-selectable transport mode.

Phase 7A presence and channel support are necessary but insufficient for the public `internetExecutionEnabled` result. During each Host process/current Relay Machine route generation, the Machine coordinator opens one bounded qualification channel, completes the frozen pinned Controller ↔ Node Machine TLS handshake for the exact durable trust, and requires the nonce-matched `machine.pong` within the 10-second Machine heartbeat timeout. That process-private route generation composes the Controller Relay connection epoch with a bounded Node rendezvous/presence sequence, so an online-to-online Node connection replacement invalidates the prior qualification even when the Controller socket is unchanged. It then closes that inner connection and retains only process-local qualification. A Host restart or loss/replacement of current Relay execution state clears that proof and requires requalification. The probe contains no Provider, Project Location, Prompt, Conversation, or Turn operation, starts no Provider, and does not replace the separate Provider, Project Location, busy, or runtime-capacity eligibility gates.

Once a Machine connection or Provider session chooses a transport, that generation keeps it until terminal close. Relay reconnect, connection-epoch replacement, grant removal, unpair, revocation, heartbeat timeout, Relay restart, channel timeout, or protocol failure destroys the exact channel; it never migrates a live session to Direct or a replacement Relay channel. A later explicit operation may choose again. A Turn-start write that loses its existing Node ownership acknowledgement remains `execution_ownership_uncertain`; neither channel ACK nor reconnect authorizes replay, and the Host's durable `actionId` mapping remains the logical idempotency authority.

### Delivery and acknowledgement layers

Relay channel delivery is bounded transport delivery, not exactly-once business delivery. A `channel.opened` response says only that the current Node Relay client accepted the purpose-bound offer. Each direction may then have one sequenced data chunk outstanding. The receiving Relay client acknowledges a chunk only as it enters or advances through its bounded Duplex read path, and the sending Duplex write resolves only after that peer acknowledgement returns. This propagates consumer backpressure, but it does not prove that Machine TLS authenticated, a Machine request parsed, a Provider session opened, a Prompt was accepted, a Tool ran, or a Turn completed.

The inner Machine protocol retains those semantic acknowledgements. Session-ready proves the purpose-specific Machine operation reached its existing authenticated boundary; Turn acknowledgement establishes the existing action/Provider ownership point; canonical terminal events complete the Turn. Callers must use the strongest applicable inner acknowledgement rather than inferring business state from Relay frame delivery.

### Channel bounds, persistence, and observability

The hard protocol ceilings are 256 live channels globally, eight per authenticated peer, 4 KiB decoded data per chunk, one unacknowledged chunk per direction, 10-second channel-open and data-acknowledgement deadlines, 8 KiB outer frames, 16 KiB parser buffering, and 16 queued control frames per Relay connection. Deployments may choose lower service channel counts but cannot exceed the protocol ceilings. Sequence, generation, purpose, peer, and both epoch mismatches fail closed; connection replacement or loss releases channel streams and timers. Node pending handshakes and established direct/Relay Machine sockets share its existing bounded connection ownership.

Channels, ciphertext, sequences, and acknowledgements are ephemeral and never enter Relay SQLite. Loopback metrics add only aggregate `activeChannels`, `openingChannels`, `pendingChannelDataFrames`/`pendingChannelDataBytes`, current `queuedInboundFrames`/`queuedInboundBytes` and `pendingOutboundFrames`/`pendingOutboundBytes`, their lifetime high-water marks, channel open/accept/reject/close/error counts, forwarded frame/byte counts, backpressure failures, and stale-frame counts. Metrics, logs, evidence, and errors never include channel bytes, Machine frames, Prompt, Provider output, Project data, credentials, private session identity, or per-peer/per-channel labels.

### Deployment, compatibility, and rollback

Phase 7B multiplexes control and Machine-channel frames on the same outbound peer connections and the same public Relay TLS listener. TCP 443 remains the only CodeTether Relay public ingress; management stays loopback-only on TCP 9443, and no new public, Node, database, or development port is required. The outer ALPN remains `codetether-relay/1`, while the signed/validated message protocol is version 2. Version 1 and version 2 deliberately fail closed rather than downgrade, so Relay, Desktop/Host, and Node artifacts must be upgraded as one coordinated compatibility set.

Channel state adds no durable Relay record. Before upgrade, retain the normal consistent Relay identity/registry backup. Rollback to Phase 7A means stopping the version-2 service and clients and restoring the matching Phase 7A Relay, Desktop/Host, and Node artifacts together while preserving the validated Phase 7A state directory; rolling back only one participant leaves Relay connectivity incompatible by design. Direct LAN execution remains the operational fallback whenever its frozen route is reachable.

### Relay visibility and Phase 7C boundary

The Relay forwards opaque Machine TLS wire records, so its application does not decode Prompts, Provider output, Tools, Project paths, credentials, or native Provider sessions. TLS 1.3 application records are ciphertext, while an operator can still observe enrolled identities/roles, authorized relationships, ordinary handshake metadata, connection and channel timing, channel counts, frame sizes, and byte volumes and can delay, drop, reorder, or terminate traffic. Phase 7B deferred formal verification of this boundary to Phase 7C. The complete frozen Phase 7B model remains documented in `docs/PHASE7B-THREAT-MODEL.md`.

## Phase 7D Network Roaming and Internet Reliability

### Identity, location, and durable state

Network location is ephemeral routing input, never product identity. Controller identity, Node identity, `machine_*` identity, Relay enrollment and application-identity pin, paired Machine trust, Project Locations, Conversations, durable Turn-start actions, and private Provider-session identity survive an address, interface, source-port, NAT mapping, DNS answer, socket, Relay epoch, or channel-generation change. No reconnect path creates a Machine, re-pairs a peer, re-enrolls an identity, relocates a Project, or replaces a Provider session merely because its network location changed.

Direct endpoint hints remain bounded private routing state. A newly supplied or recovered Direct address is promoted only after the existing TLS 1.3 Machine handshake validates the exact expected Node, Machine, Controller, protocol, and SPKI identities. Relay endpoint mobility likewise remains separate from the pinned Relay application identity: a new resolution or address may connect only when the configured outer TLS policy and expected Relay identity validate. A temporary dial or DNS failure changes current connectivity, not durable trust.

### Reconnect ownership and bounded wake coordination

Each logical connection still has exactly one authority: the application-scoped Web `HostRuntime` owns its one Host SSE loop; the Host Controller Relay coordinator owns one Relay worker for each configured Controller/Machine relationship; the Host remote-Machine coordinator owns one idle Direct/Relay qualification worker per trusted Machine; and the Node Relay manager owns the Node's one outbound Relay worker. React, Conversation runtimes, Provider adapters, Project Locations, and Turns do not own competing network loops.

Relay and Machine workers share a timing-only `ReconnectWakeCoordinator`. It owns one exponential-backoff timer, a level-triggered pending wake, and the authenticated-stability interval, while the caller retains sole ownership of the socket, authentication, and generation. Bursts of socket-close, resume, network-restored, timer, or manual-expedite signals coalesce into one pending wake. A wake interrupts the current candidate/stale idle connection and advances the existing worker; it never starts a parallel worker, Provider operation, Prompt, or new action.

Production Relay reconnect starts at one second and is capped at 60 seconds; the idle remote-Machine worker starts at one second and is capped by the 30-second Machine heartbeat interval. Both apply bounded 80–120% jitter. Backoff returns to its initial value only after an authenticated connection remained stable for at least 60 monotonic seconds, preventing a connect/disconnect flap from repeatedly resetting to an aggressive retry rate. The Web-to-Host SSE loop similarly backs off from 500 milliseconds to 60 seconds with jitter and a 60-second stable-reset threshold. Closing an owner cancels its timer and wakes any waiter for bounded shutdown.

### Generations and stale work

Every reconnect attempt belongs to the current owner and abortable cycle. A completed dial is admitted only if the owner, cycle, and lifetime signals are still current; a late candidate is closed before it can publish status, update endpoint preference, persist authentication time, or install channel handlers. An authenticated Controller reconnect creates a new Relay connection epoch; a current Node rendezvous/presence replacement advances the composite Relay Machine route generation even when that Controller epoch is unchanged. Either transition invalidates prior process-local Machine qualification and its idle route before stale callbacks can publish current state. A replacement route uses a new Machine channel generation and a fresh non-resumed inner Machine TLS session. Existing Phase 7B epoch/channel checks and Phase 7C TLS checks reject delayed old traffic. Web SSE additionally retains its Host runtime generation plus Host `<epoch>:<seq>` cursor rules, so an old observer cannot mutate a replacement projection.

An authenticated Relay control epoch is also disposable after a bounded
channel/control protocol failure: the exact epoch and all of its Machine
channels close, then the one owning coordinator may authenticate a fresh epoch
with unchanged enrollment and Machine trust. Exact terminal channel bindings
remain only for the existing bounded acknowledgement grace so already-queued
data or ACK records cannot escalate one failed channel into a permanently
stranded live Node. This infrastructure reconnect cannot reopen a Machine
channel or replay a Prompt. Relay identity mismatch, protocol incompatibility,
revocation, and registered-peer authentication failure still stop without an
automatic trust or enrollment change.

Reconnect duration and heartbeat expiry use monotonic elapsed time where duration correctness matters. Wall-clock ISO timestamps remain presentation/persistence observations only. A suspend-induced late timer therefore produces one current-cycle decision rather than replaying every missed reconnect interval.

### Idle recovery, presence, and execution eligibility

The reconnect state machine is conceptually:

```text
disabled
   |
offline -> connecting -> authenticating -> online
   ^             |             |            |
   +-------------+-------------+-- reconnecting
```

Exact public status vocabularies remain boundary-specific, but `online` is published only after the relevant authenticated connection succeeds. Short failures may remain visibly reconnecting while bounded retry continues; a genuine outage is not presented as Provider failure or durable trust loss. Relay heartbeat expiry removes current presence, and reconnection creates current presence again. Presence remains Relay reachability only and never implies Direct availability, inner Machine TLS qualification, Project Location validity, Provider availability, runtime capacity, or Conversation readiness.

Automatic recovery applies to idle infrastructure: Relay control connections, Direct endpoint qualification, Relay Machine-channel eligibility, and Web SSE observation may reconnect. Provider discovery is not fired for every flap; an idle authenticated Machine route schedules at most one short stability-delayed discovery, cancels it when that generation closes, and keeps the frozen current/last-known semantics. Cold history, Search, organization, Inbox, Project detail, and Machine detail continue to read durable state without opening a Provider execution session.

### Desktop resume, background operation, and observer recovery

Windows suspend does not terminate or restart the owned Host. On a coalesced resume cycle the Desktop keeps its frozen exact-owned-Host probe and Web `desktop-resumed` recovery, and also sends one bounded private `network-restored desktop_resume <generation>` lifecycle hint to that exact sidecar. The Host accepts only strictly increasing positive safe generations and asks its existing Relay and remote-Machine coordinators to wake; it creates no new networking authority. Stale sockets are discarded and reauthenticated instead of being trusted because an object still exists. The same application-scoped Web runtime aborts a stale bootstrap/SSE candidate, fetches current bootstrap truth, and resumes through the frozen replay/reset model.

This path is independent from window visibility. Hiding to Tray, locking the Windows session, or turning off the display does not create another Host, Relay client, Machine worker, Provider execution, or SSE authority. On shutdown, the Desktop/Host/Node owners abort connection cycles, close owned sockets/channels, cancel reconnect timers and listeners, and retain only durable configuration/trust.

Physical Linux suspend signals are not introduced in Phase 7D. The Node normally learns of connectivity loss through its authenticated Relay socket and heartbeat lifecycle; its one manager also exposes the same coalesced reconnect-wake seam for a future platform owner. WSL2 lifecycle evidence must not be described as physical Linux sleep behavior.

### Routing and active-Turn boundary

Transport qualification is recomputed for each new explicit Machine operation. A new Turn prefers an authenticated usable Direct route, otherwise uses an eligible authenticated Relay route, and fails truthfully when neither is usable. Opening a socket is insufficient: existing exact identity, inner Machine TLS, Machine hello, Relay presence/channel, Project Location, Provider, capacity, and Conversation gates remain authoritative for their respective path.

Transport selection is immutable after a Machine session or Turn generation begins. A Relay Turn never migrates to Direct when Direct appears, and a Direct Turn never migrates to Relay when Direct disappears. Reconnect restores only future eligibility. Loss after a Start write continues to use the frozen Provider-ownership uncertainty rules: no reconnect, lifecycle signal, SSE reset, Relay acknowledgement, or transport availability callback resends the Prompt or creates a replacement `actionId`. A later user-authored Turn may choose the newly qualified route only after the earlier Turn has one safe durable terminal outcome.

Provider native-session identity and Project Location are application state above transport. A fresh socket, Relay epoch, Machine channel, or inner TLS handshake therefore neither replaces a Codex/Claude native session nor creates another `(projectId, machineId)` Location. Native resume remains explicit on the next Turn and never uses transcript replay.

## Existing native-session discovery and adoption

Phase 8A adds `ProviderSessionDiscovery` behind each Provider adapter. Local adapters run in Host; remote adapters run in Node through two narrow Machine operations for bounded enumeration and exact candidate revalidation. The request carries the existing Project/Location identity, Provider, cursor, and limit—not an arbitrary filesystem path—and Relay continues to forward only opaque Machine TLS. Codex uses metadata-only app-server list/read methods. Claude streams guarded metadata from its known user-local session store without starting its executable or contacting its configured inference backend. The Host admits at most four distinct Provider-session scans process-wide by default while identical keys coalesce behind one worker; saturation reports discovery unavailable without starting inference or an unbounded worker set.

Host converts private native identities into short-lived random candidate references scoped to the exact Project and Machine. Adoption resolves that private candidate, revalidates the current Provider metadata and exact canonical Location, then transactionally creates or resolves one ordinary Conversation/private native-session binding. Discovery and adoption create no Turn, take no execution ownership, and perform no native resume. A later explicit Turn hydrates the same Conversation through the existing native-resume path. See [`PHASE8A-EXISTING-SESSIONS.md`](PHASE8A-EXISTING-SESSIONS.md) for bounds, failure semantics, privacy, and future-phase boundaries.

## Provider lifecycle and compatibility

Phase 8B adds one bounded lifecycle authority for each owning Machine. It discovers configured, previously known, bounded `PATH`, and known official Provider locations; deduplicates aliases by private file identity; preserves launcher/wrapper details separately from the resolved execution artifact; and records one durable selected installation per Machine/Provider. A `ProviderInstallation` has a stable Machine-scoped opaque identity, while an exact content-derived revision changes when an in-place update, launcher-target change, downgrade, or replacement changes what will execute. Changing `PATH` cannot override an established selection, and a missing selected installation does not trigger an automatic alternate-installation fallback. A truncated bounded scan retains omitted installations and selection as last-known; only a complete current Machine observation can confirm removal.

Compatibility is revision- and adapter-contract-scoped rather than an exact-version allowlist. Verified revisions remain `verified`; an unknown newer or older version may become `compatible_unverified` after bounded zero-inference contract probes; loss of an optional feature becomes `limited`; a missing mandatory execution/protocol contract becomes `incompatible`; and an unresolved installation becomes `unavailable`. Each capability retains separate observed, CodeTether-enabled, and effective truth. The frozen Claude policy therefore cannot expand when a Provider adds features, and native-session discovery may become unavailable without incorrectly disabling otherwise compatible fresh execution.

Runtime compatibility remains separate from backend readiness. The selected installation's exact restricted execution environment is inspected only through an allowlisted, secret-free projection that can identify first-party, custom-gateway, Bedrock, Vertex, or unknown mode. Backend state may be unknown, ready, unavailable, authentication-required, or misconfigured without rewriting runtime compatibility. First-party auth status is used only where authoritative; a custom gateway is evaluated from its effective configuration and explicit/real execution evidence rather than from `claude auth status` alone.

Current and last-known lifecycle truth remain distinct. A remote transport outage retains the latest bounded observation with its timestamp and cannot establish installation removal. A configuration-only refresh may retain prior readiness for the same backend-configuration revision only as last-known; a changed configuration revision resets backend readiness without invalidating unchanged runtime compatibility. Host and Node restart reconstruct these coordinators from durable selection and observation state, without Machine re-pairing, Relay re-enrollment, or Conversation recreation.

New and adopted Conversations acquire one private immutable installation binding. Pre-8B Conversations remain readable and bind conservatively only when an exact current selected installation is established at a legitimate execution boundary. Discovery, validation, native resume, and new execution then use that same installation identity and revision; Node rejects a stale expected revision before Provider work. An active Turn keeps its already-owned process even if the on-disk executable changes, and no lifecycle refresh can migrate it, choose another installation, defer a Prompt, create another `actionId`, or replay uncertain work. See [`PHASE8B-PROVIDER-LIFECYCLE.md`](PHASE8B-PROVIDER-LIFECYCLE.md) for the complete state model, probe/cache rules, backend semantics, privacy, and later-phase boundaries.

## Zero-config onboarding and Doctor

The exact local Codex execution runtime is deferred until an admitted native
conversation create/resume requires it. Lifecycle assembly and metadata refresh
retain Phase 8B's bounded compatibility probes but do not retain an idle execution
App Server. Concurrent first admissions share one initialization; failed or closing
initialization remains closed without automatic retry/replay. Exact installation,
revision, environment, and execution policy remain unchanged.

Phase 8C composes existing product truth instead of creating another source of truth. Migration 017 (`onboarding_progress`) creates one revision-guarded singleton containing the flow version, last valid step, optional exact Project/Machine context, explicit optional dispositions, timestamps, and the latest bounded action identity. It contains no Provider, backend, trust, connectivity, or readiness copy. Existing durable Phase 8B product state initializes as completed; a genuinely fresh database starts at Welcome. Every resume re-reads current Machine, Provider lifecycle, backend, Project Location, and discovery facts. Migration and reads require no Provider process, backend inference, trust change, or destructive reset.

The approved state progression is `welcome -> computer_check -> provider_check -> project_setup -> previous_conversations -> remote_setup -> ready`; the `remote_setup` screen itself is explicitly optional. Local-only setup can reach Ready without Relay or another Machine when at least one actual execution path and an exact Project Location are usable. Codex and Claude Code are individually optional. Provider cards consume Phase 8B's selected installation and current/last-known observations, map compatibility into ordinary copy, and continue to distinguish executable/runtime compatibility from the effective AI-service backend. A custom gateway never inherits first-party sign-in requirements merely from Provider auth status. If a selected Location is removed while setup is paused, its existing foreign key clears only the flow context and a narrow `project_reselect` transition returns the user to Project setup; later steps cannot complete without a valid retained context.

Project setup uses the accepted native directory picker and Host canonicalization. For a remote-only first Project, one narrow typed Machine operation validates an exact user-entered directory through the already authenticated Node and creates or reuses the logical Project plus its Node-canonicalized Location atomically; an existing Project uses the frozen narrow Location registration operation. Neither path adds onboarding-specific path equality, arbitrary remote listing/read, or a generic remote browser. Once an exact Location exists, the optional Previous Conversations step calls Phase 8A discovery. Discovery, explicit selection/adoption, and later native resume remain distinct: no automatic import, Provider execution, inference, transcript conversion, or native-store mutation occurs during setup.

Remote setup is a human-friendly wrapper around the frozen two-step pairing and pinned Controller/Node identities. The one-time expiring pairing code is not a durable Machine credential, confirmation remains explicit, and identity mismatch fails closed. Ordinary UI may say “another computer” and “Internet access”; advanced details may expose safe transport or fingerprint information. No public Node port, port forwarding, manual TLS configuration, or Relay protocol knowledge is required, and Relay remains an opaque transport with no onboarding, Project, Provider, session, or credential persistence.

Doctor derives component states from existing authorities for this computer, Provider installation/runtime/current execution health, AI-service backend, current Project Location, remote trust/connectivity, and native-session discovery. Its small presentation vocabulary may include ready, needs-attention, limited, unavailable, offline, and unknown, with current and last-known freshness kept explicit. Overall Ready means at least one same-Machine Project/Provider path for the current context is usable and the local durable Host state is healthy; an optional Provider or discovery feature may be limited without making the whole product unusable. An ordinary Doctor read does not contact remote filesystems and therefore reports an online remote Location as unknown. The explicit bounded `check=true` read revalidates only the registered exact Location through the existing purpose-specific Node operation and coalesces concurrent checks.

Opening onboarding or Doctor performs no inference. The explicit `Check again` action reuses bounded/coalesced lifecycle, connectivity, and exact ProjectLocation validation operations and reports partial failure without upgrading stale facts. A Node-owned lifecycle deadline is presented with contextual check-again copy while retaining Protocol v1's canonical retryable `provider_start_failed` diagnostic; an absent/blackholed Machine response remains transport truth, and Web never parses process text to distinguish them. Phase 8C adds no dedicated inference-based backend-check action; backend readiness changes only through existing authoritative lifecycle or explicit execution evidence. Repairs are narrow user actions such as checking again, choosing a folder, viewing official installation guidance, signing in only for the effective first-party mode, or reopening the existing secure pairing flow. There is no “repair everything,” Provider installation/switch, credential rewrite, trust reset, deferred Prompt, or automatic retry/replay. See [`PHASE8C-ZERO-CONFIG-ONBOARDING-DOCTOR.md`](PHASE8C-ZERO-CONFIG-ONBOARDING-DOCTOR.md) for the state, privacy, offline, idempotency, user-journey, and future-distribution boundaries.

A stale Direct or Relay socket can outlive its useful route after a network change. The Node assigns each authenticated Machine connection a process-local generation. A newer generation from the same paired Controller may supersede an older runner only while it is idle and only when its Conversation, Project, canonical root, exact native Provider session identity, and Provider options match. The old exact connection is retired and its Provider cleanup is awaited before the same native session is reopened. Active, mismatched, closing, or cleanup-uncertain ownership remains fail-closed and busy. Connection generations are not durable identity, and this handoff cannot migrate or replay an active Turn.

### Offline startup, recovery ordering, and limitations

Host and Node startup always reconstruct connection coordination from durable trust/configuration; no pre-exit socket, channel, timer, or connection epoch is persisted or assumed live. Starting either peer while Relay or Internet access is unavailable leaves local runtime/history healthy and bounded retry active. Relay-first, Node-first, or Controller-last restoration converges through the same identity-authenticated workers. CodeTether does not queue a Prompt for later delivery while offline.

Phase 7D does not promise connectivity through captive portals, networks that block outbound TCP 443, restrictive corporate proxies, DNS filtering, severe packet loss, or ISP outages. It adds no captive-portal detector, HTTP/SOCKS proxy product, VPN, STUN/TURN/WebRTC, NAT hole punching, multi-Relay or multi-region failover, packet-size obfuscation, or new IPv6 routing architecture. Hostname-based Relay reconnect uses the platform/Node TLS stack's normal fresh connection resolution; direct-IP deployments do not require DNS. Address-family support remains that of the existing Node.js/operating-system stack and deployed endpoint configuration.

The detailed state model, operational limits, validation boundary, rollback, and Phase 8 separation are recorded in `docs/PHASE7D-NETWORK-RELIABILITY.md`.

## Host

`apps/host` owns the loopback HTTP/SSE server, Provider registry/runtimes and local lifecycle coordinator, live state, Phase 3A SQLite boundary, Phase 3B.1 durable Project registry, Phase 3C.1 durable Conversation index/title rules, Phase 3C.1.1 cold detail/hydration boundary, Phase 3D.1 durable Attention projection, Phase 4E.1 Conversation organization model, Phase 4F.1 durable Search projection/read, Phase 5A Provider selection, Phase 6D canonical failure/health composition, and the Controller Relay client. It allocates public identities, maps them to private Provider and selected-installation identities, validates actions and Project workspaces, reconstructs bounded live or cold views from durable Turn records, applies Provider-independent organization writes, searches durable title/User-input text without runtime admission, hydrates control state on demand, selects only the immutable owning adapter/installation for control, validates structured upstream failures, records bounded health/lifecycle observations, sequences client events, and performs bounded fanout/replay. Relay configuration and connection state stay separate from direct endpoint truth, Provider runtime compatibility, backend readiness, and Provider process ownership. The Host's Machine coordinator owns direct-first route selection before an operation begins and never changes the selected transport or Provider installation for an active session or Turn. The same Host entry supports standalone Browser development and the production Desktop sidecar; Desktop-managed mode changes lifecycle wiring and Origin input, not business behavior.

Automatic Project-root discovery, Location relocation, multi-root Locations on one Machine, generalized durable action logging, full-history pagination, richer remote Claude capability parity, and richer remote Codex capability parity remain planned rather than implemented. Migration 012 is only the narrow Turn-start admission association described above, and migration 013 is only the latest bounded presentation-safe Provider execution-health observation. Remote identity/trust, bounded authenticated endpoint recovery, purpose-specific remote Location validation, Provider description, the fixed Codex text profile, and the restricted Claude profile exist only at the Machine connection boundary.

## Client-to-Host Protocol

Phase 8C adds strict Protocol v1 onboarding progress/transitions, a bounded Doctor report with an explicit factual-check flag, and one narrow remote-only Project-create request. The typed client exposes only those exact operations; it receives no executable path, credential, private native-session identity, generic command, remote directory listing, or Relay socket authority.

`packages/protocol` defines Protocol v1 identifiers, commands, records, events, safe errors with strict `CanonicalFailure`, Provider descriptors/capabilities with optional bounded execution health, Phase 8B's bounded `MachineProviderLifecycle` and safe Conversation-bound lifecycle summary, canonical Tool kinds, ordering, reconnect cursors, strict Project and Project Location records/mutations, the Project-scoped `ConversationSummary`, bounded durable Conversation-detail response, Conversation organization mutations, durable Conversation Search query/result/cursor contracts, durable Attention contracts, bounded presentation-safe Relay/transport status, and Phase 8A's opaque Provider-session discovery/adoption contracts with TypeScript and Zod. `packages/client` implements the matching HTTP/SSE consumer—including Project Location registration, bounded Provider lifecycle refresh, opaque previous-session discovery/adoption, Conversation organization, Search, Attention, ordinary Conversation creation, and Host-owned Relay configuration/enrollment/status—without React, executable paths, credentials, native-session identity, or Relay-socket methods. Purpose-specific Host ↔ Node Location validation, Provider lifecycle description/refresh, native-session discovery/revalidation, and exact-installation Codex/Claude session envelopes remain private to `packages/machine-transport` and run over either direct TLS or a Relay-provided Duplex. The separate Internet envelope remains in `packages/relay-protocol`; version 2 adds only the fixed `machine_tls_v1` channel family and cannot name or decode a Machine operation. Raw Provider payloads, executable paths, backend secrets, and private native session identities remain behind Node/Host adapters and are visible to neither Web nor the Relay application. Strict mixed-revision compatibility is not silently negotiated: an incompatible Protocol, installation revision, or Relay peer fails closed instead of weakening validation or mutating durable trust.

## Agent Adapter Boundary

Phase 5A introduces a narrow adapter boundary only after Codex and Claude Code provide a second concrete case. `AgentHostRuntime` carries the common Host operations—create/resume session, start Turn, optional interrupt, event/failure subscriptions, process-live Approval callbacks, cold-session disposal, and shutdown. A Host-owned `ProviderRegistry` maps the immutable durable Provider to one runtime, one exact installation identity/revision, one public descriptor, and one lifecycle projection. Session lookup keys combine Provider identity with the private Provider session identity, so equal opaque IDs from different Providers cannot collide. Provider-specific process, installation discovery, compatibility probing, backend observation, transport, parsing, permission, and structured-error classification code remains inside its adapter; Phase 6D adds only the shared controlled failure result, not a Host/Web Provider-prose parser.

Protocol v1 exposes the effective `ProviderDescriptor`—identity, display name, availability, optional tested/current version and models, plus explicit booleans for streaming, resume, interrupt, Approval, Read/Edit/Shell/Search, Diff, Tool events, model selection, and reasoning control—and a separate bounded lifecycle projection. The latter contains opaque installation/revision identity, compatibility/capability state, safe provenance, and backend mode/readiness but no execution path or credential. The ordinary create-Conversation and Turn endpoints select the adapter and immutable installation binding from durable Conversation state; neither `packages/client` nor React exposes `startClaudeTurn`, an arbitrary executable selector, or Provider-specific HTTP routes. Bootstrap keeps its legacy Codex capability fields for compatibility while adding the descriptor list.

The registry scopes Runtime failures and Approval identity to the owning Provider. A Claude failure cannot fail a Codex Turn, and unknown Provider identity fails closed. Both Providers consume the same Host-wide hydrated-Conversation limit—eight by default—rather than receiving separate budgets. Idle eviction may dispose a cold adapter session object; durable identity and history remain in SQLite and the next real Turn performs native resume. Phase 6D execution-health observations are keyed by the same immutable Machine/Provider pair and cannot change installation discovery, capability admission, Conversation binding, or this shared capacity ownership.

`packages/adapter-claude` performs bounded discovery of configured, previously selected, `PATH`, and known official launchers; resolves native, link, wrapper, or verified npm launch specifications; and fingerprints the exact execution artifacts. Phase 5A was accepted against Claude Code `2.1.250`; Phase 5B revalidated the same boundary against `2.1.251`; Phase 8A revalidated the unchanged capability boundary against `2.1.263`. These remain shipped verified versions, but Phase 8B no longer makes exact version equality the sole admission rule: an unknown version may be used only after its bounded zero-inference version/help contract passes. One local or Node lifecycle coordinator owns selection, revision validation, observation, and refresh; execution and session discovery consume that exact selected installation context and never independently fall through to another `PATH` candidate. Backend observation is separate and uses authentication status only for first-party mode when authoritative. The adapter never publishes a path, credential, or raw diagnostic. Available Claude sessions use a UUID with native `--session-id` creation and `--resume` after Host restart. One active Turn owns one child; canonical input is encoded as a JSONL SDK User message on stdin, not placed in argv, and the process uses structured arguments with `shell: false` in the already authorized Conversation working directory.

`packages/adapter-codex` uses the same bounded installation/revision model around its exact executable and the CodeTether-owned App Server contract. A recognized version may be verified; an unknown newer or older version must expose the required local `app-server`/stdio surface rather than being rejected solely by number. The metadata-only thread list/read contract is optional for core execution, so losing it makes existing-session discovery unavailable without falsely classifying the execution runtime as incompatible. Codex backend configuration and current execution health remain separate from executable compatibility.

Claude `--restricted` deliberately ignores ordinary user settings. At Host preparation, the adapter reads only the user-scope Claude `settings.json` `env` object and privately projects an exact allowlist of required operating-system/network context plus Claude authentication, endpoint, and model-routing values into the restricted child environment, with an explicit process environment taking precedence. CodeTether does not load or copy ordinary hooks, plugins, permissions, MCP configuration, or Project/local settings, and unrelated Host variables or credentials do not cross the spawn boundary. Claude's own managed-policy settings may still apply; CodeTether does not claim to bypass them. The secret-bearing environment is retained behind a closure rather than serialized with detection, and no value enters argv, Protocol descriptors, evidence, or normal logs.

The Claude stream parser normalizes text deltas, terminal Turn state, and high-confidence `Read`, project-contained `Edit`/`Write` paths, and `Glob`/`Grep` events into bounded existing Tool fields. Because the production profile does not admit Shell, unexpected `Bash`/`PowerShell` envelopes fail closed as Generic Tool without a command; other unknown Tools likewise remain generic rather than being guessed. Public events are bounded and presentation-safe. Raw JSONL, session objects, environment data, executable paths, and stderr never cross the adapter boundary.

The Claude launch profile remains deliberately restricted to `Read`, `Glob`, and `Grep` with noninteractive `dontAsk`, strict MCP configuration, and no permission bypass. Its descriptor advertises streaming, native resume, Read, Search, Tool events, and the installed CLI's real `--effort` control. The Host owns the bounded effort identifiers/labels and passes the selected value as a structured argv pair; no Prompt enters argv. Claude Tool envelopes keep stable Provider tool identity while Read/Glob/Grep and project-contained Edit/Write paths normalize into bounded canonical fields. Because Shell is not an admitted product capability, unexpected Bash/PowerShell envelopes fail closed as Generic Tool without publishing the provider command. The production allowlist prevents Edit and Shell execution. Machine-readable Approval, reliable interrupt, Edit, Shell, Diff, and model selection remain false and must not be simulated in shared UI. Codex retains its established capabilities and runtime behavior.

## Persistence

Phase 3A uses `node:sqlite` for the minimal durable records described above. CodeTether Conversation and Turn identities, private provider identities, canonical text inputs, statuses, timestamps, and normalized per-Turn snapshots survive Host restart. Phase 3B.1 adds durable Project identity, canonical root authorization metadata, and the required Conversation-to-Project relationship. Phase 3C.1 adds the canonical title and last-activity index fields needed for product history without introducing an event table. Phase 3C.1.1 adds read-through reconstruction and runtime admission rules only. Phase 3D.1 adds normalized Attention state without persisting provider requests or SSE history. Phase 4E.1 adds title ownership and nullable Pin/Archive timestamps to the same Conversation row; it adds no organization table or durable event/action log. Phase 4F.1 adds a derived normalized title/User-input Search projection with source-table triggers and no copied presentation snapshot. Phase 5A migration 007 (`provider_foundation`) transactionally rebuilds the Conversation-dependent table graph only to widen the Provider constraint to `codex | claude-code`; it preserves existing Codex Provider identity, private session/Turn identity, Projects, organization metadata, Turns, Attention, Search documents/indexes/triggers, and snapshots. Phase 6A migration 008 (`machine_foundation`) transactionally creates the canonical local Machine, separates Project Locations, and adds the required immutable Conversation Machine while rebuilding/preserving the same dependent graph and Search triggers. Accepted Phase 6B.1 migration 009 (`remote_machine_trust`) adds real remote Machine identity plus presentation-private pinned trust without changing that local graph. Accepted Phase 6B.2 migration 010 (`remote_machine_endpoints`) removes location from the peer identity row, transactionally backfills its one accepted endpoint into a private bounded hint table, and keeps exactly one preferred endpoint per trust. Accepted Phase 6B.3 adds no migration because the version-10 composite Project Location schema already supports one Location per Project/Machine; new remote rows remain ordinary Host-owned SQLite product state. Phase 6C.1 migration 011 adds only presentation-safe authenticated remote Provider observations keyed to existing trust. No pairing code, private key, executable path, raw Provider output, environment, full endpoint history, or trust fingerprint becomes public Machine data. Phase 4C stores only three versioned notification booleans in Desktop WebView `localStorage`; delivered-ID and click queues remain bounded process memory. Raw Codex JSON-RPC, Claude JSONL, SSE events, replay cursors, notification history, action results, computed Project/Machine availability, LRU state, hydration state, provider-session state, and browser projection state are not stored.

SQLite does not replace runtime history. The active Turn is assembled and streamed in memory, with throttled normalized snapshot writes and synchronous terminal flushes. It also does not replace a Provider's native session store: CodeTether persists the exact private Codex Thread or Claude session identity and asks the owning adapter to resume it lazily. Phase 5A does not replay a stored transcript into Claude to imitate resume and does not store an arbitrary Provider metadata blob. The migration runner and Store remain concrete Host modules rather than a generic persistence abstraction.

Phase 6C.2 and Phase 6C.3 need no migration: the existing immutable Machine/Project/Provider binding, private `provider_thread_id`, Turn snapshot, Search, organization, and Attention graph already own durable remote execution truth. Accepted Phase 6C.4 migration 012 adds only `turn_start_actions`, keyed by the public `actionId` and uniquely referencing the exact durable Turn created in the same transaction. Accepted Phase 6D extends the existing bounded Turn `HostError` snapshot with a validated canonical failure; no parallel failure table or migration of guessed historical detail is needed. Migration 013 adds only the latest `machine_provider_execution_health` row for each Machine/Provider pair, with its controlled state, optional bounded canonical failure, and observation time. Neither migration stores a second Prompt, Provider event, result envelope, executable, environment, credential, endpoint, raw error, or native session identity. Private native Codex and Claude identities remain presentation-inaccessible. Phase 7A migration 014 (`relay_controller_configuration`) adds one private `machine_relay_configurations` row for an existing trusted remote Machine. It contains only the bounded endpoint host/port, `public_ca | pinned_identity` transport mode, pinned Relay application fingerprint, optional safe display label, enablement, `required | enrolled | revoked` enrollment state, and lifecycle timestamps. The per-Machine Controller private credential remains in its existing private identity store, and enrollment tokens, live epochs, challenges, pending messages, and presence history are never persisted. The independent Relay registry remains outside Host product SQLite and cannot reference product Projects, Conversations, Turns, Attention, Search, or Provider sessions.

Phase 8A migration 015 (`existing_provider_sessions`) adds only Conversation origin, private native-session materialization truth, and a partial uniqueness constraint over Machine, Provider, and private native session identity. Existing Conversations backfill as CodeTether-created without Provider access. The native identity remains in the established private Conversation field and is absent from Protocol v1, URLs, Search, Relay state, logs, and evidence.

Phase 8B migration 016 (`provider_lifecycle`) adds a bounded current lifecycle graph: private Machine/Provider installations, one selected installation per Machine/Provider, latest revision-scoped compatibility/capability state, latest safe backend observation, and one immutable private Conversation-to-installation binding. The migration launches no Provider and leaves pre-8B Conversations unbound until an exact selected installation can be established lazily; it never binds history to an arbitrary current `PATH` candidate. Installation paths, private file identities, and raw configuration remain Host-private, while credentials, Prompts, Provider output, native-session data, and an unbounded lifecycle event history are not stored. Existing Phase 8A adopted bindings and all earlier Conversation/Turn/Search/organization state remain intact.

Phase 8C migration 017 (`onboarding_progress`) adds only one durable setup-flow singleton. It stores the flow version, current step, monotonic revision, optional Project/Machine context, optional previous-conversation and remote-setup dispositions, one bounded last action identity, and timestamps. It stores no readiness result, Provider installation or backend state, Project path/name, pairing/Relay secret, native-session identity, Prompt, or output. Existing product state is preserved and initialized as completed without launching a Provider; fresh state begins at Welcome.

Entering the onboarding Ready step revalidates the exact ProjectLocation and
composes current Provider lifecycle facts without another automatic installation
scan. Under frozen Phase 8B semantics a metadata-only scan retains known backend
health as last-known; it cannot re-check an AI service. Avoiding that redundant
scan preserves a current observation established by normal execution without
promoting unknown or stale evidence. Explicit Check Again still refreshes facts.

## Event Streaming

The verified runtime is event-driven:

```text
Codex stdout → line decoder → transport dispatch → normalizer → bounded Host queue → CLI subscriber
Claude JSONL stdout → bounded parser → normalizer ────────────┘
```

It uses no polling or database scan. The adapter does not intentionally coalesce or discard provider events. The Phase 2A.1 semantics harness adds a development Host queue bounded to 256 events and approximately 1 MiB by default, with a per-delta cap. Adjacent `message.delta` and `tool.output` events with the same Thread, Turn, Item, and stream identity may be coalesced. Under pressure, only coalescible deltas may be evicted; approvals use a direct control callback, and terminal lifecycle events are either delivered or cause an explicit runtime failure rather than being silently dropped. If reliable-only events exceed the bound, the runtime fails explicitly instead of growing an unbounded queue.

The final two-Turn validation observed 171 raw message/tool delta events and delivered 118 aggregated events, a 31.0% reduction, with exact raw-to-delivered integrity for both message text and tool output, canonical final-message integrity, and zero dropped deltas. The flush/coalescing parameters are experimental rather than a finalized client protocol.

Phase 2B adds non-durable Host-global ordering, bounded replay, explicit reconnect reset, and isolated multi-client observation at the client boundary. These guarantees apply only within one Host epoch. Phase 3A persists Conversation state but deliberately does not persist replay events or epochs; a restarted Host creates a new epoch and serves a fresh durable Snapshot. Phase 3D.1 Attention transitions and Phase 4E.1 `conversation.updated` metadata transitions use the same replay, while durable Attention and Conversation reads remain reset/restart truth.

Phase 2C.1 adds one browser consumer for that stream. It rejects duplicate and out-of-order events before updating the TanStack Query projection. Phase 2C.1.1 makes the Snapshot replacement complete for all retained runtime history, so a reset or unrecoverable cursor condition reconstructs the same retained Timeline rather than merging across incompatible epochs. The guarantee ends at the explicit in-memory eviction boundary and at Host restart.

Phase 4C observes only accepted applied envelopes after that validation boundary. It never subscribes to `message.delta` or `tool.output` for delivery and never polls Attention. A reset or new epoch refetches durable Attention for Inbox truth but publishes no notification arrival, preventing historical open review/failure work from firing on application restart. Phase 4F.2 likewise uses only validated low-frequency Conversation lifecycle events to invalidate durable Search queries; high-frequency message/tool deltas never trigger Search reads.

Phase 4G.2 does not add an event-stream protocol. After one native owned-Host identity check per Windows resume cycle, a process-local Tauri event carries that exact startup-owned epoch to the existing HostRuntime. The Runtime closes or aborts its current connection, re-reads bootstrap, refuses a different epoch, and only then lets the same stream loop reconnect with its current `Last-Event-ID`; replay, `stream.reset`, sequence validation, and Snapshot replacement remain the only SSE reconciliation rules. Duplicate power-resume messages do not create duplicate native probes or parallel streams.

The Provider boundary adds no Provider-specific public event stream. Both adapters emit the same normalized Agent event union into the existing Host sequencing, durable projection, SSE replay, Snapshot, Attention, and notification paths. Tool events carry only the canonical Read/Edit/Shell/Search/Generic kind and bounded presentation fields. Phase 5B adds one optional provider-neutral command/path clue to internal Tool events; the Host continues to clamp and normalize it before public publication, and raw Provider tool IDs/objects never cross the boundary. Accepted Phase 6C.4 adds the separate bounded/coalescing Node-to-Host queues described above; it does not change public event identity or make SSE durable. Phase 6D carries the validated canonical failure on the existing terminal error/Turn snapshot and failed-Attention payload rather than adding a Provider-specific stream or second Attention system. One terminal Turn still creates at most one durable failure outcome and one stable-source Attention item. Failed-Turn operating-system notifications omit the Conversation title because generated titles can contain Prompt text; their reason copy is controlled by CodeTether. Raw Codex JSON-RPC, Claude JSONL, transport diagnostics, and arbitrary Provider prose remain private.

## Conversation Ownership

A Conversation is bound to one Project, one Agent, and one execution Machine, plus supported configuration, title, organization metadata, and history. Its durable `provider` and `machineId` are selected at creation and cannot switch. Phase 3A makes the CodeTether `conversationId` durable and stores the corresponding private Provider session identity without exposing it as browser routing identity; migration 007 preserves every existing Codex identity while allowing new Claude Code records. Phase 3B.1 makes Project ownership a required durable relation; Phase 6A binds that Project through an exact Machine-scoped Location and backfills all prior history to the canonical local Machine. `cwd` remains a contained execution working directory, not a Project or Machine identity. Phase 3C.1 makes title and last activity Host-owned durable product facts rather than React or Runtime-Snapshot inventions. Phase 4E.1 distinguishes generated/manual title ownership and adds Pin/Archive without changing execution status or activity. Phase 3C.1.1 keeps durable identity/history, bounded live working state, and the Provider-owned session separate so a Machine/Project/Conversation read, Search, or organization write cannot accidentally become Provider control. Only Start Turn may hydrate and natively resume the immutable owning Provider on the immutable Machine.

## Security Boundary

Agent execution can read files, run commands, and change code. The spike confines the real Turn to a dedicated ignored workspace, uses `workspace-write` and `on-request` approval settings, forbids automatic approval, and records protocol summaries without environment variables or credentials.

The Claude boundary remains narrower than Codex. Executable discovery never concatenates a shell command, and launch uses a resolved executable plus structured argv with `shell: false`; Prompt data is a bounded JSONL stdin message. Every create/resume/Turn path receives the Host's already reauthorized contained working directory. The safe profile disables slash commands and Chrome, uses strict MCP configuration, denies unpromptable permission escalation with `dontAsk`, and admits only Read/Glob/Grep. Effort is one validated adapter-owned argv value. Full Prompt, raw stderr, arbitrary environment, CLI path, Provider session object, raw tool identity, and Claude protocol objects are not written to normal product logs or returned to Web.

The Phase 2B HTTP server additionally binds only `127.0.0.1`, requires the exact loopback `Host` authority, enforces an explicit Origin allowlist without a wildcard, limits JSON bodies and SSE connections, validates every wire payload, and returns safe error envelopes. Browser development retains its two explicit Vite Origins. Desktop-managed startup supplies only the verified Tauri Origin (`http://tauri.localhost` in the production Windows WebView) or its explicit development Vite Origin; it does not enable wildcard CORS. Phase 3B.1 turns workspace confinement into durable Project authorization: registration resolves a canonical directory under any configured roots, and every new Turn or lazy provider resume re-resolves the saved Project root and contained `cwd`. An unavailable or changed root fails closed with `project_unavailable` while history remains readable.

The Tauri capability boundary exposes only the exact directory-picker and bounded Attention-notification commands to React and no generic native command surface. Production CSP is explicit and loopback-only, while Rust owns the fixed Host sidecar command and private lifecycle pipe. A selected path still crosses the existing Project API before it becomes an authorized workspace; a notification intent can only display safe copy and later return public routing identities. The local business API remains loopback-only. The separate outbound Host ↔ Node boundary uses the accepted TLS 1.3 encrypted, authenticated, strictly framed protocol for pairing, identity/status heartbeat, endpoint recovery, trust revocation, and the one purpose-specific Project Location validation request. The addition keeps certificate pinning and exact Machine/Node identity checks, adds no plaintext fallback, exposes no loopback HTTP API, and cannot be expanded into generic RPC or filesystem access over the LAN.

Phase 6D treats every raw diagnostic as Provider- or infrastructure-private and potentially malicious. HTML, Markdown, ANSI/control characters, fake URLs or authentication instructions, embedded JSON, oversized repetition, invalid encoding, stack traces, executable paths, environment values, tokens/cookies/headers, TLS material, Prompt/source text, and native session identity cannot become trusted UI instructions or public recovery policy. Structured classifiers may inspect only their already bounded private input and emit an enum-owned record; Web renders ordinary controlled text without raw HTML, Provider Markdown, or Provider URLs. Public schema bounds, the 4-KiB durable health-failure ceiling, safe Host messages, and canonical-only logging/evidence prevent diagnostic, credential, control-character, and log injection. Technical Details exposes only CodeTether-owned code, source, and time plus existing safe public labels.

Phase 7A treats the public Relay listener as Internet-attacker reachable. TLS is mandatory, application identity is pinned separately, peer authentication proves possession of a previously enrolled P-256 identity, and all challenges, frames, queues, timers, connection counts, retries, and unauthenticated work are bounded. Source IP, DNS resolution, hostname, forwarded headers, Alibaba instance metadata, and common enrollment on one Relay grant no Machine authority. One-time tokens, private keys, signatures, challenges, reciprocal grants, and peer registry details remain outside Web, public health, ordinary logs, and evidence. The narrow schema and authorization checks prevent Relay from becoming a generic tunnel or global peer directory. The complete Phase 7A assumptions and abuse cases are recorded in `docs/PHASE7A-THREAT-MODEL.md`.

Phase 7B keeps that outer boundary and places the existing end-peer Machine TLS session inside one authorized `machine_tls_v1` channel. Channel identifiers, generations, both peer epochs, purpose, sequence, size, outstanding-frame count, and deadlines are validated before forwarding. Relay delivery acknowledgements remain below Machine semantic ownership and cannot make replay safe. The Relay application sees ciphertext and bounded traffic metadata, not decoded Machine operations; the residual malicious-Relay and Phase 7C boundary is recorded in `docs/PHASE7B-THREAT-MODEL.md`.

Phase 7C verifies that the Relay-facing stream APIs require exact paired peer pins and that Machine framing is created only after TLS 1.3, `codetether-machine/1` ALPN, certificate presence, SPKI identity checks, and an explicit non-resumed-session check succeed. Machine TLS requests no stateless tickets, while CodeTether captures, persists, and supplies no resumption state and sends no execution action as early data. OpenSSL may still issue a stateful post-handshake ticket, but CodeTether does not reuse it and rejects any socket Node reports as resumed. Fresh Relay channels therefore establish fresh Machine TLS handshakes and bindings. The Relay forwards bounded opaque TLS wire records unchanged; it imports no Machine/Provider/content decoder, persists no channel payload, logs no payload, and reports only aggregate numeric transport metrics. Ordinary TLS handshake metadata and traffic shape remain observable to the Relay operator, and Relay still controls availability. The exact trust model, plaintext/key boundaries, metadata inventory, and limitations are in `docs/PHASE7C-END-TO-END-SECURITY.md`.

Phase 7D treats an address, interface, DNS answer, socket, Relay epoch, and Machine channel as replaceable network state while retaining all Phase 7C identity and TLS checks. A reconnect wake can invalidate stale transport work and expedite the one owning worker, but it cannot weaken a pin, make a Relay identity authoritative for Machine trust, start Provider work, migrate an active Turn, or replay a Prompt. New Direct and Relay generations repeat the same exact endpoint authentication before they become usable.

Phase 8B treats executable paths, file identities, binary hashes, Provider settings, and backend credentials as Machine-local private material. Only Machine-scoped opaque installation/revision identifiers and a bounded safe lifecycle projection cross product boundaries. Backend configuration observation is allowlisted and value-free for secrets; it may publish presence booleans, a mode, and a sanitized origin but never a token, cookie, Authorization header, credential-bearing URL, or complete environment. Compatibility probes use exact structured executables and arguments with `shell: false`, bounded time/output/process ownership, no model inference, and no generic remote command or filesystem surface. Relay sees only the existing encrypted Machine records and persists no lifecycle state.

## Current Architectural Constraints

- Valid live Conversation Detail, Project list/detail, Project-scoped Conversations, real Conversation Rail, and global real Inbox routes are connected to the Host. Demo remains a development fixture absent from real navigation.
- The Host API remains a loopback-only service with local SQLite records. Browser development may launch it separately; CodeTether Desktop packages and owns the same Host as a revision-coupled sidecar. The bounded Machine client reaches a trusted Node through Direct first or one purpose-bound Relay Duplex when eligible; both routes run the same inner Machine TLS/protocol. Web does not connect to the Internet Relay directly.
- Codex remains the accepted full-control integration and `codex-cli 0.149.1` remains a shipped verified lifecycle version; an unknown revision must pass the bounded current adapter contract rather than inheriting trust from its version number. Phase 5A's Claude Code foundation is frozen at `a1329f2`, Phase 5B's evidence-driven capability matrix is accepted and frozen at `5dac13c`, remote reliability is accepted and frozen at Phase 6C.4 commit `01e749c`, Phase 6D diagnostics are accepted and frozen at `cb2c412`, Phase 7A is accepted and frozen at `67e2a98`, Phase 7B is accepted and frozen at `b0f74f5`, Phase 7C is accepted and frozen at `f42a988`, Phase 7D is accepted and frozen at `abbcf38`, and Phase 8A is accepted and frozen at `5d2f67c`. Lifecycle observation cannot broaden frozen Provider capabilities.
- React can start text Turns on either available Provider through the same command. It exposes one-shot Approval and exact active-Turn interrupt only when the owning Provider descriptor advertises them; those controls remain Codex-only in Phase 5B. Claude can expose its Host-owned effort choices without inventing model, permission, Approval, Diff, or interrupt controls. Queueing, steering, attachments, Provider switching, and unsupported Provider configuration remain unavailable.
- Durable local Machine identity, Machine-scoped Project Location authorization, real Machine/Project/Conversation UI, explicit remote Node trust/availability, one durable Location per Project/Machine, explicit safe remote-Location removal, and the exact accepted remote Codex/restricted-Claude Provider profiles exist. Desktop native directory acquisition, Browser manual-path fallback, Project-aware Conversation history/create flows, Project-scoped title/User-input Search in List and Rail, the real open Attention queue, running-Desktop Attention notifications, close-to-tray background runtime, and bounded Windows sleep/resume/session-end reliability remain unchanged. Phase 7A supplies Relay enrollment/control/presence/rendezvous, Phase 7B carries only that existing Machine protocol through an authenticated purpose-bound channel, Phase 7C verifies its nested end-peer TLS security, and Phase 7D adds bounded idle network recovery without adding another transport or Runtime. Phase 8A adds exact-Location Provider-native session discovery and adoption. Phase 8B adds bounded multiple-installation observation, durable deterministic selection/binding, revision-scoped compatibility, and separate backend readiness; it does not mutate Provider installations or profiles. Phase 8C is authorized to add only the setup/Doctor composition described above. There is no arbitrary Project/filesystem discovery, unmatched-session browser, historical transcript conversion, Location relocation, multi-root Location on one Machine, generic Relay/remote filesystem tunnel, synchronization, LAN discovery, cross-Project/global or semantic Search, Agent/Tool/Terminal/Diff Search, old-Turn history pagination, Search history/analytics, Inbox history/read state, account system, Start with Windows, automatic Host restart, tray badges/recent-item menus, delivery after explicit Quit, automatic Provider updater/downgrader, backend/account/profile switcher, cross-platform distribution, Mobile client, deferred Prompt queue, or general production permission-policy system.
- The Desktop owns only the Host process it starts. A pre-existing CodeTether Host or unknown service on port 4317 is reported and left untouched; lifecycle startup, resume, session-end, and crash handling never attach, replace, or kill by port.
- The production Desktop build embeds `apps/web` assets and a Node SEA Host executable. Runtime use does not depend on Vite, pnpm, or a system Node.js installation; building the current SEA requires Node 25.5+ plus the Windows Rust/MSVC/WebView2 prerequisites.
- Command Allow Once and Decline were exercised through real App Server requests; file-change and permissions approvals were not observed.
- Multi-Turn, multi-Thread, cross-process resume, interruption, and safe Tool failure were manually validated.
- A real terminal Turn failure was not observed.
- Protocol v1 replay, epoch/sequence state, and browser projection state are process-local and reset on Host restart. Conversation/Turn identity, normalized snapshots, and their bounded canonical failure metadata are durable. General mutation idempotency remains process-local; only the existing Turn-start action-to-Turn admission association is durable in migration 012. Migration 013 retains only the latest bounded Provider-health observation and is not a failure history or monitoring service.
- Action idempotency is bounded to the recent 256 retained actions for non-Turn-start mutations. Turn start is restart-safe exactly-once admission only; Provider execution is not transactional, and uncertain execution is failed rather than replayed.
- SSE slow-client recovery currently closes the lagging connection; clients must reconnect or fetch a snapshot after `stream.reset`.
- The browser cursor and live Conversation projection are memory-only and rebuild from Host Snapshot on page refresh or epoch change.
- Snapshot reconstructs the bounded recent hot-runtime window, including after Host restart. The Project-scoped index separately lists durable summaries, and single-Conversation GET reconstructs a recent 20-Turn durable view without hydration. The real list/Rail/detail consume these reads, but older Turn rows are not pageable.
- Every durable Conversation references one Project and the exact Machine-scoped Project Location where it executes. Project deletion is registration-only and is rejected while Conversations exist; CodeTether never deletes the workspace, reassigns the Machine, or cascades history.
- Protocol v1's deprecated `cwd` Conversation request may only resolve an existing registered available Project Location on the explicitly selected Machine. New callers use `projectId` plus `machineId`.
- Terminal projection retains only the most recent 128 KiB per Conversation.
- Runtime history remains limited per Conversation, and the Host restores/admits at most eight in-memory Conversations across Codex and Claude Code combined by default. Older Conversations remain cold-readable through Detail/Rail/Search/organization paths, and Start Turn hydrates them internally with safe idle-LRU eviction plus native lazy Provider resume. Active-Turn Provider Item and file-change identity maps are each capped at 1,024 entries; exceeding a bound fails explicitly rather than growing without limit.
- An idle runtime failure changes bootstrap capabilities but has no proactive Protocol v1 capability-change event.
- Local Host launch paths disable Codex hooks by default so user hooks cannot pre-resolve escalation ahead of CodeTether Approval handling.
- Protocol v1 Approval presentation does not yet expose a trusted structured risk or provider reason field, so the live UI shows kind, semantic command/action, workspace context, and identity without fabricating risk.
- Approvals do not survive as actionable requests across a Host restart; pending records are expired with `host_restart` because their provider request handles belong to the old process.
- A stored Provider session is resumed lazily on the next Turn by its owning adapter. If that native session is missing, local history remains readable and control returns a bounded Provider-session error; automatic fork, replacement, transcript replay, or Provider handoff is not implemented.
- SQLite retains normalized per-Turn snapshots without a disk retention policy in this phase, so database size grows with durable history until a later archive/retention design.
- Generated protocol artifacts and real-agent workspace files remain ignored under `.tmp/`.
- Legacy CodeTether code and structure are not architectural inputs.
