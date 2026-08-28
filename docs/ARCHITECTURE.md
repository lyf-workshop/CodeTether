# CodeTether Architecture

## Status

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

**Phase 4A — Tauri Desktop Shell Foundation** is implemented and validated. `apps/desktop` packages the existing Web application and supervises a revision-coupled Node SEA build of the existing Host. It adds native application/window/process lifecycle only; it does not move Project, Conversation, Attention, persistence, Agent, Protocol, or projection logic into Rust. Phase 4B is not authorized.

No native folder picker, Project discovery/scanning, rename/relocate, read/unread Inbox history, archive/delete/history pagination, remote access, authentication, multiple-Machine Project model, notification delivery, tray, or updater exists yet. SQLite remains local Host data, not a remote or multi-user service.

## System Context

The local Desktop path is:

```text
Tauri Desktop Shell
    ├── window / application lifecycle
    ├── owned Host sidecar supervision
    └── native capability boundary
              │
              ▼
Existing Web UI
              │ Protocol v1 HTTP + SSE
              ▼
Local Host on 127.0.0.1
              │
              ▼
Agent Adapter
              │
              ▼
Codex App Server
```

Future web and mobile clients use the same host boundary:

```text
Mobile / Web
      │
      ▼
 Machine Host
```

The Host remains the runtime and durable product-state authority. Clients render normalized data and send explicit Protocol v1 commands rather than operating provider protocols directly. Tauri does not introduce a second application API: its private parent/child pipe is only a lifecycle channel.

## Monorepo Boundaries

```text
apps/web                   Frozen product UI and HostRuntime/Protocol consumer
apps/desktop               Tauri v2 window, packaging, and owned Host supervision
apps/host                  Codex runtime, loopback Host API, and SQLite persistence

packages/ui                Shared design system
packages/protocol          Client-to-Host Protocol v1 and Zod wire contracts
packages/client            Small non-React HTTP/SSE Protocol v1 client
packages/agent-core        Minimal normalized runtime event contract
packages/adapter-codex     Codex App Server process, transport, and translation
packages/adapter-claude    Future Claude Code adapter placeholder
packages/adapter-opencode  Future OpenCode adapter placeholder
packages/shared            Environment-neutral shared utilities placeholder
```

Dependencies point inward toward stable contracts. UI code does not import provider adapters. `packages/adapter-codex` depends on `packages/agent-core`; neither package depends on product UI.

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

The Host creates opaque `projectId`, `conversationId`, `turnId`, `itemId`, and `approvalId` values. Private maps bind runtime identities to the exact Codex Thread, Turn, Item, approval request, and JSON-RPC request identities. Browser routing never uses a provider Thread ID. Numeric and string JSON-RPC request IDs remain distinct through tagged internal keys. Approval resolution revalidates the full Conversation/Turn/Item/provider-request binding, requires a still-pending record, and rejects repeated resolution.

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

Mutations require an `actionId`. A bounded 256-entry in-memory cache returns the original Promise/result for an identical retry while that action remains retained, rejects reuse with different input, never evicts in-flight actions, and explicitly reports capacity pressure. Settled entries are eventually evicted, so this is a recent-retry guarantee rather than durable exactly-once execution; callers must use globally random action IDs and retry a lost response promptly. Mutation responses share `accepted`, `completed`, or `rejected` status semantics while retaining endpoint-specific data. Safe errors use protocol codes rather than forwarding provider JSON-RPC errors.

Project creation accepts an `actionId`, absolute local path, and optional display name. The Host resolves the path to a canonical existing directory, applies any configured registration-root constraint, and stores one durable identity per canonical root. Repeating the same root returns the existing Project with `created: false`. List/read responses compute `available` or `unavailable` from the current filesystem rather than treating availability as durable truth. Delete removes only a registration and is rejected while any runtime or durable Conversation references it; it never deletes files or cascades Conversation history.

Create Conversation currently accepts only Codex, optional model/reasoning, and a registered `projectId`. Its stored `cwd` is a real-path-validated directory contained by that Project root. The deprecated Protocol v1 `cwd` request remains an additive compatibility path, but it may only map to an existing registered, available Project and cannot register a path or expand trust. The API does not implement Project discovery or a general filesystem chooser.

### SSE Ordering and Replay

Every Host process generates one non-persistent UUID `epoch`. A Host-global positive `seq` is assigned only after a regular event fits the reliable replay buffer. The SSE ID and envelope `eventId` are exactly `<epoch>:<seq>`, and the SSE `event` field equals the protocol event type. An empty snapshot's synthetic reconnect cursor is `<epoch>:0`; it closes the snapshot-to-stream race without claiming that sequence zero was emitted.

The replay buffer holds aggregated client events, not raw Codex deltas. It is bounded to 2,048 events and approximately 8 MiB by default, evicting oldest events by count or encoded size. `Last-Event-ID` reconnect replays the subsequent retained sequence. An epoch mismatch, evicted cursor, or future cursor produces a connection-local `stream.reset` control carrying the current `<epoch>:<currentSeq>` boundary; it is sent first and the recovery stream closes without allocating a sequence or entering replay. Runtime-history compaction is a different reset cause: after applying the triggering event, the Host publishes a sequenced and replayable `stream.reset` with reason `history_evicted`. That boundary reaches current observers and reconnecting observers alike, forcing all projections to replace from the newly compacted Snapshot. Heartbeats are SSE comments and do not consume sequence numbers.

Two live clients received identical event IDs and sequence values in tests and in the real integration path. Disconnecting one observer does not affect another. Replay is written directly with HTTP backpressure rather than being copied into the live queue. Each live connection defaults to 256 queued frames and approximately 1 MiB, while one standalone valid frame may be as large as 9 MiB. Heartbeats may coalesce or drop; reliable overflow closes only the slow connection so it can reconnect or fetch a snapshot. Approval and terminal events are never silently discarded. The non-React client independently caps an SSE frame at 10 MiB and an HTTP JSON body at 64 MiB, which covers the bounded aggregate Alpha Snapshot.

A fatal Codex runtime signal terminates active public Turns with a safe `runtime_unavailable` error, resolves pending Approvals as declined, clears Turn-scoped buffers, disables the affected bootstrap capabilities, and makes new mutations return HTTP 503. Provider error text never crosses the client boundary. If failure occurs while idle, clients learn the capability change on their next bootstrap or mutation because Protocol v1 does not yet define a capability-change event.

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

The migration runner records ordered versions in `schema_migrations`, rejects an unknown or renamed applied migration, and applies each new migration in an immediate transaction. Migration 001 (`initial`) introduced `conversations` and `turns`. Phase 3B.1 migration 002 (`projects`) adds durable Project identity and rebuilds Conversation foreign keys without discarding existing history. Phase 3C.1 migration 003 (`conversation_title`) adds durable titles and a separate last-activity clock, backfilling existing rows transactionally from their first canonical text input. Phase 3D.1 migration 004 (`attention`) adds the durable Attention index without retroactively creating work from older completed Turns. The current schema contains:

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
  provider              currently constrained to codex
  provider_thread_id    private provider resume identity, nullable while creating
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
```

Indexes cover Project and Conversation recency, Project-scoped Conversation recency, per-Conversation Turn chronology, and Attention status/priority lookup. Migration 002 backfills one Project for each distinct normalized legacy Conversation root and binds every existing Conversation to it. Project availability is intentionally absent from SQLite; the Host computes it by inspecting the saved canonical root. `snapshot_json` contains only versioned CodeTether normalized/presentation state for that Turn: messages, Tools, file changes, outcome, bounded terminal tail, and Approval history. It never contains the Codex JSON-RPC stream. `attention_items.payload_json` is capped at 256 KiB and contains only normalized presentation metadata, never a Conversation snapshot or provider request.

### State Boundaries

The three state layers remain intentionally different:

- **Runtime memory:** current high-frequency working state and the bounded recent projection window (20 Turns, 512 presentation entries, 128 KiB terminal tail, approximately 4 MiB per retained Conversation).
- **SQLite:** durable Project authorization, Conversation identity, provider Thread identity, canonical inputs, per-Turn normalized snapshots, and Attention state across Host processes. Older completed Turns are not deleted merely because they leave the runtime window.
- **SSE replay:** up to 2,048 aggregated client events / approximately 8 MiB for short reconnects within one Host epoch. It is not persistence.

Startup loads the durable Project registry, then restores at most the existing process admission limit of eight most-recent Conversations and the most recent 20 Turns per restored Conversation into runtime memory. Complete durable Turn rows remain on disk. The single-Conversation read exposes a recent 20-Turn window plus older-history metadata, but pagination for the older rows is not implemented.

### Write and Recovery Semantics

Conversation creation first inserts a local `creating` record, then creates the provider Thread, then durably records the provider identity and ready state before publishing the Conversation. Provider creation failure rolls back the incomplete local record. A final local write failure fails the runtime closed rather than presenting an undurable ready Conversation.

Turn start first creates a durable `starting` Turn with canonical User input. Provider execution is not started if that write fails. Once Codex returns its Turn identity, the Host binds and persists it before publishing `turn.started`. Streaming remains memory-first: dirty Turn snapshots flush on a 300 ms throttle rather than on every delta. `turn.started`, Approval requested/resolved, completed, failed, and interrupted boundaries flush synchronously; graceful shutdown flushes all remaining dirty Turns and checkpoints WAL.

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

The add dialog accepts a manually entered absolute path and optional name. Browser validation is intentionally limited to required-form checks. The client sends the request through the typed Project API, while the Host owns real-path resolution, configured-root authorization, canonical duplicate detection, and safe error semantics. A duplicate root returns the existing Project and the UI routes to that identity without adding a second cached row.

Removal is registration-only. The UI requires confirmation that local files, Git data, and source code are untouched, then calls the existing delete endpoint. A referenced Project keeps its record and displays the specific `project_has_conversations` conflict; there is no cascade or force-delete path. Successful mutation results update or invalidate the shared Project query keys instead of storing a second Project registry in React or Zustand.

This phase adds no Host endpoint, filesystem scanner, browser or native folder picker, rename/relocate operation, Git model, Project Conversation projection, or New Conversation flow. The existing Sidebar project context is not promoted into a new global Project store; that integration waits for a separately approved live Conversations phase.

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

A cold detail read is provider-independent: it neither starts Codex nor resumes a Thread, emits an SSE event, mutates durable status, nor consumes one of the eight runtime slots. This remains true when the Project directory is unavailable or the saved provider Thread is missing, so local history stays readable even when future control must fail closed.

Starting a Turn on a cold Conversation is a separate internal control path. The Host deduplicates concurrent hydration, reserves a working-set slot, reconstructs the same bounded durable projection, installs provider/public Turn identity mappings, revalidates the Project workspace, lazily calls provider Thread resume, and only then starts the new Turn. Action idempotency continues to wrap the whole operation. Hydration is not a public command or query option.

Working-set admission uses safe least-recently-used eviction. Only an idle, clean, unpinned Conversation with no active/starting/interrupting Turn, hydration, or pending Approval may leave memory. Eviction removes process-local state and provider bindings only; SQLite history and the provider-owned Thread remain intact. If every candidate is protected, control returns explicit `runtime_unavailable` rather than evicting active state or exceeding the bound.

Cold reconstruction compacts retained presentation order into one unique monotonic window. At startup the Host initializes its process-global event sequence above restored presentation order—and reserves the full runtime-entry range when cold provider Conversations exist—so later live Items cannot collide with durable Item order. A read-only cold GET does not advance sequence; new events still pass the existing preview/durable-publication sequence check before fanout.

If the Codex executable cannot launch, the local loopback Host can still start with its durable API in read-only mode. Bootstrap reports Codex/resume capabilities unavailable; Project, index, and Conversation-detail reads continue from SQLite, while provider-dependent mutations return `runtime_unavailable`. This fallback does not invent a provider session or weaken workspace/history safety.

Phase 3C.1.1 adds no database table, event store, provider-event persistence, durable LRU state, or durable SSE/action state. It does not add full-history pagination, a history-loading UI, Real Conversations/Conversation Rail data, or another provider. The durable detail intentionally exposes only its bounded recent window; `hasOlderHistory` is the explicit boundary for future pagination work.

## Phase 3C.2 Real Conversations Experience

The route hierarchy supplies Product context without a global Project store. `/projects/:projectId/conversations` queries the real Project and the latest 100 SQLite-backed Conversation summaries. `/conversations/:conversationId` first reads the durable detail contract, obtains its `projectId`, then queries the same Project and Project-scoped summary list for breadcrumbs, Sidebar context, and Rail presentation. `/conversations` redirects to `/projects`; the Demo route remains a development fixture and is not linked by real product navigation.

The list and Rail use the same `listProjectConversations()` Client boundary and preserve Host `lastActivityAt DESC` order by default. Local search/filter/sort operates only on that bounded response. Provider groups are data-driven; the current real surface therefore shows only Codex. Unsupported Machine, Git, archive, rename, and delete fields/actions are omitted instead of populated with Mock values.

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

There is no `question` / needs-reply Attention because Codex does not currently expose a reliable structured Agent-question signal. Text punctuation, content heuristics, and extra LLM classification are intentionally not used. Read/unread, Notifications, and Activity remain separate future work.

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

The UI presents projects, conversations, agents, machines, approvals, changes, terminal output, and context. Figma defines visual and interaction behavior. Phase 2C.1 through Phase 2C.2 preserve the accepted visual structure and change only the Conversation Detail data/control boundary for valid live Conversation routes. Phase 3B.2 replaces only the Projects placeholder with the accepted real list and overview surface. Phase 3C.2 keeps the accepted Conversations/Detail visual structures while replacing their Product data boundary with real Project and durable Conversation reads. Phase 3D.2 adapts only the accepted Inbox surface to real Attention semantics.

The client owns ephemeral presentation state only. TanStack Query stores bootstrap, Snapshot, Conversation projection, Project queries, Conversation indexes, and Attention queries; Zustand remains limited to UI state. Project, Conversation, Attention, Agent, Machine, and retained Timeline records must not be duplicated into a client store as a second runtime authority. The Host remains the product-state source of truth.

The live Conversation, Conversation index, Project, and Inbox paths consume Protocol v1 through `packages/client`, never Codex wire messages or `packages/adapter-codex` directly. Phase 2C.2 sends only text Turn start, one-shot Approval resolution, and exact-Turn interrupt commands; Project/Conversation product surfaces add only the existing list/read/create/delete Project operations, durable Conversation reads, and minimal Conversation creation. Phase 3D.2 adds explicit completed-review/failed Attention resolution while preserving the exact Approval endpoint safety boundary.

## Desktop Shell

`apps/desktop` is a Windows-first Tauri v2 shell around the existing Web/Host system. It creates one native-decorated `main` window, uses the stable `com.codetether.desktop` bundle identifier, and loads the same `apps/web` build used by Browser mode. Production loads packaged Web assets; development lets the Tauri CLI own the Vite process. There is no `DesktopConversationPage`, Desktop-only React tree, or Tauri business command layer.

The Rust layer owns only application/window lifecycle, single-instance behavior, Host process supervision, startup diagnostics, and packaging. The official single-instance plugin is registered before other plugins; a second launch invokes restore/focus on the first ready window and does not start a second Host. The main window starts hidden against the application's dark background and is shown only after bootstrap readiness plus Protocol/build identity validation, avoiding an unstyled white surface. Native window decorations remain intentionally unchanged.

### Host Sidecar and Revision Coupling

The production Host is still the TypeScript/Node Host. `desktop:sidecar` bundles its production entry and dependencies with esbuild while leaving Node built-ins external, then uses Node's official `--build-sea` flow to emit a target-triple-named executable under `apps/desktop/src-tauri/binaries`. The current direct SEA builder requires Node 25.5 or newer at build time. The packaged application does not require a separately installed Node.js runtime.

The build embeds one `git-<12-character-revision>` identity, with a `-dirty` suffix when applicable, into both the Host bootstrap and Rust shell. Desktop readiness accepts only Protocol v1 plus that exact build identity, preventing a shell from silently operating an unrelated bundled Host revision.

### Startup and Ownership

Desktop preflights `127.0.0.1:4317` before spawn. An existing CodeTether-shaped service and an unknown port occupant are distinct startup failures; neither is attached, stopped, or replaced. If the port is free, Tauri starts exactly one external binary with `CODETETHER_DESKTOP_MANAGED=1`, pipes its standard input, and passes one explicit Origin: `http://tauri.localhost` in production or the Vite Origin in development.

The managed Host installs its stdin/EOF watcher and waits for a private `start` activation before initializing the runtime. Rust sends that activation only after assigning the sidecar to its owned Windows Job Object, closing the spawn-to-ownership window in which a Codex descendant could otherwise escape the Job. Readiness then polls `GET /api/v1/bootstrap` instead of sleeping for a fixed interval. Startup has a 15-second ceiling and distinguishes a missing binary, spawn failure, existing Host, unknown port conflict, early Host exit, timeout, and Protocol/build incompatibility. An unexpected exit after readiness reports a native Desktop failure; after acknowledgement, Desktop exits and releases its owned Job/process tree without entering an automatic restart loop.

### Shutdown and Parent Loss

Normal Desktop exit writes the private line `shutdown\n` to the owned Host, waits up to 12 seconds for the existing Host graceful-close path, and only then terminates its own process tree on timeout. The Host stops new HTTP action admission, drains admitted mutations before Runtime/SQLite teardown, finalizes dirty SQLite state, closes HTTP/SSE, releases process-local Approval requests for restart-time durable expiry, and shuts down the Codex App Server through the established adapter lifecycle.

In Desktop-managed mode, stdin EOF or channel error also requests the same graceful Host shutdown path. Windows additionally assigns the owned Host to a `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` Job Object. On abnormal parent death, stdin EOF and kernel Job teardown race: graceful close is attempted, while the Job guarantees no orphaned owned process even when it wins before SQLite can receive a full grace period. Existing restart reconciliation handles that crash boundary. This is a last-resort ownership safeguard, not authority to terminate a process discovered by port number. Non-Windows packaging remains future validation; the portable EOF protocol is isolated from the Windows Job Object implementation.

### Native Security Boundary

The WebView capability file contains no permissions. `withGlobalTauri` is disabled, and the React application imports no Tauri API. The shell plugin is used only from trusted Rust code to launch the fixed bundled sidecar; there is no `invoke("run_command")`, arbitrary shell argument bridge, or filesystem grant to Web content.

Production CSP allows HTTP/SSE connection only to `http://127.0.0.1:4317`; scripts and assets remain self-hosted, and wildcard source directives are absent. Development adds only the explicit Vite HTTP/WebSocket endpoints. The Host still binds loopback only and retains strict Host/Origin validation; Desktop-managed startup allowlists only its explicit WebView Origin rather than weakening CORS.

## Host

`apps/host` owns the loopback HTTP/SSE server, Codex runtime, live state, Phase 3A SQLite boundary, Phase 3B.1 durable Project registry, Phase 3C.1 durable Conversation index/title rules, Phase 3C.1.1 cold detail/hydration boundary, and Phase 3D.1 durable Attention projection. It allocates public identities, maps them to private provider identities, validates actions and Project workspaces, reconstructs bounded live or cold views from durable Turn records, hydrates control state on demand, sequences client events, and performs bounded fanout/replay. The same Host entry supports standalone Browser development and the production Desktop sidecar; Desktop-managed mode changes lifecycle wiring and Origin input, not business behavior.

Project discovery/import UX, multiple Machine locations, durable action logging, full-history pagination, machine trust, and remote operation remain planned rather than implemented.

## Client-to-Host Protocol

`packages/protocol` defines Protocol v1 identifiers, commands, records, events, safe errors, capabilities, ordering, reconnect cursors, the strict Project-scoped `ConversationSummary`, bounded durable Conversation-detail response, and durable Attention contracts with TypeScript and Zod. `packages/client` implements the matching HTTP/SSE consumer—including Conversation and Attention reads/mutations—without React. Provider wire payloads remain behind adapters, and unknown provider notifications are diagnostics rather than public events.

## Agent Adapter Boundary

Phase 2A deliberately does not introduce a speculative multi-provider `AgentAdapter` interface. The Codex implementation is separated by real responsibilities—process, transport, client, protocol subset, lifecycle, logging, and normalization—while `packages/agent-core` contains only the minimal observed product meaning.

Provider-specific capabilities may remain Codex-specific when a natural common concept has not been proven. Claude Code and OpenCode implementations are deferred to their roadmap phases.

## Persistence

Phase 3A uses `node:sqlite` for the minimal durable records described above. CodeTether Conversation and Turn identities, private provider identities, canonical text inputs, statuses, timestamps, and normalized per-Turn snapshots survive Host restart. Phase 3B.1 adds durable Project identity, canonical root authorization metadata, and the required Conversation-to-Project relationship. Phase 3C.1 adds the canonical title and last-activity index fields needed for product history without introducing an event table. Phase 3C.1.1 adds read-through reconstruction and runtime admission rules only. Phase 3D.1 adds normalized Attention state without persisting provider requests or SSE history. Raw Codex JSON-RPC, SSE events, replay cursors, action results, computed Project availability, LRU state, hydration state, provider-session state, and browser projection state are not stored.

SQLite does not replace runtime history. The active Turn is assembled and streamed in memory, with throttled normalized snapshot writes and synchronous terminal flushes. It also does not replace the Codex provider's Thread store: CodeTether persists the exact provider Thread identity and asks Codex to resume it lazily. The migration runner and Store are intentionally concrete Host modules rather than a generic persistence abstraction.

## Event Streaming

The verified runtime is event-driven:

```text
Codex stdout → line decoder → transport dispatch → normalizer → bounded Host queue → CLI subscriber
```

It uses no polling or database scan. The adapter does not intentionally coalesce or discard provider events. The Phase 2A.1 semantics harness adds a development Host queue bounded to 256 events and approximately 1 MiB by default, with a per-delta cap. Adjacent `message.delta` and `tool.output` events with the same Thread, Turn, Item, and stream identity may be coalesced. Under pressure, only coalescible deltas may be evicted; approvals use a direct control callback, and terminal lifecycle events are either delivered or cause an explicit runtime failure rather than being silently dropped. If reliable-only events exceed the bound, the runtime fails explicitly instead of growing an unbounded queue.

The final two-Turn validation observed 171 raw message/tool delta events and delivered 118 aggregated events, a 31.0% reduction, with exact raw-to-delivered integrity for both message text and tool output, canonical final-message integrity, and zero dropped deltas. The flush/coalescing parameters are experimental rather than a finalized client protocol.

Phase 2B adds non-durable Host-global ordering, bounded replay, explicit reconnect reset, and isolated multi-client observation at the client boundary. These guarantees apply only within one Host epoch. Phase 3A persists Conversation state but deliberately does not persist replay events or epochs; a restarted Host creates a new epoch and serves a fresh durable Snapshot. Phase 3D.1 Attention transitions use the same replay while the durable Attention list remains the reset/restart source of truth.

Phase 2C.1 adds one browser consumer for that stream. It rejects duplicate and out-of-order events before updating the TanStack Query projection. Phase 2C.1.1 makes the Snapshot replacement complete for all retained runtime history, so a reset or unrecoverable cursor condition reconstructs the same retained Timeline rather than merging across incompatible epochs. The guarantee ends at the explicit in-memory eviction boundary and at Host restart.

## Conversation Ownership

A Conversation is bound to one Project, one Agent, and the Machine executing it, plus model, reasoning, permission, title, and history. An existing Conversation cannot switch providers. Phase 3A makes the CodeTether `conversationId` durable and stores the corresponding private Codex provider Thread identity without exposing it as browser routing identity. Phase 3B.1 makes Project ownership a required durable relation; `cwd` remains a contained execution location, not a competing Project identity. Phase 3C.1 makes title and last activity Host-owned durable product facts rather than React or Runtime-Snapshot inventions. Phase 3C.1.1 keeps durable identity/history, bounded live working state, and the provider-owned session separate so a product read cannot accidentally become provider control.

## Security Boundary

Agent execution can read files, run commands, and change code. The spike confines the real Turn to a dedicated ignored workspace, uses `workspace-write` and `on-request` approval settings, forbids automatic approval, and records protocol summaries without environment variables or credentials.

The Phase 2B HTTP server additionally binds only `127.0.0.1`, requires the exact loopback `Host` authority, enforces an explicit Origin allowlist without a wildcard, limits JSON bodies and SSE connections, validates every wire payload, and returns safe error envelopes. Browser development retains its two explicit Vite Origins. Desktop-managed startup supplies only the verified Tauri Origin (`http://tauri.localhost` in the production Windows WebView) or its explicit development Vite Origin; it does not enable wildcard CORS. Phase 3B.1 turns workspace confinement into durable Project authorization: registration resolves a canonical directory under any configured roots, and every new Turn or lazy provider resume re-resolves the saved Project root and contained `cwd`. An unavailable or changed root fails closed with `project_unavailable` while history remains readable.

The Tauri capability boundary exposes no native command to React. Production CSP is explicit and loopback-only, while Rust owns the fixed Host sidecar command and private lifecycle pipe. This does not make the loopback API a remote security model: authentication, machine trust, durable audit, TLS, pairing, and remote transport security remain unimplemented. The server must not bind to LAN interfaces in this phase.

## Current Architectural Constraints

- Valid live Conversation Detail, Project list/detail, Project-scoped Conversations, real Conversation Rail, and global real Inbox routes are connected to the Host. Demo remains a development fixture absent from real navigation.
- The Host API is a loopback-only service with local SQLite records. Browser development may launch it separately; CodeTether Desktop packages and owns the same Host as a revision-coupled sidecar. It is not a LAN daemon or remote service.
- The real integration is Codex-only and was verified against local `codex-cli 0.149.1`.
- React can start text Turns, resolve one-shot pending Approvals, and interrupt the exact active Turn on a valid live Conversation route. Stop/thread termination, queueing, steering, attachments, configuration changes, and other write paths are not connected.
- Durable local Project identity, authorization, real list/add/detail/remove UI, Project-aware Conversation history/create flows, the real open Attention queue, and the Tauri Desktop lifecycle shell exist. There is no native folder picker, Project discovery/import, rename/relocate, Inbox history/read state, multiple-Machine location model, authentication, remote access, full-history pagination, notification delivery, tray, updater, or production permission policy.
- The Desktop owns only the Host process it starts. A pre-existing CodeTether Host or unknown service on port 4317 is reported and left untouched; Phase 4A does not attach, replace, or kill by port.
- The production Desktop build embeds `apps/web` assets and a Node SEA Host executable. Runtime use does not depend on Vite, pnpm, or a system Node.js installation; building the current SEA requires Node 25.5+ plus the Windows Rust/MSVC/WebView2 prerequisites.
- Command Allow Once and Decline were exercised through real App Server requests; file-change and permissions approvals were not observed.
- Multi-Turn, multi-Thread, cross-process resume, interruption, and safe Tool failure were manually validated.
- A real terminal Turn failure was not observed.
- Protocol v1 replay, action idempotency, epoch/sequence state, and browser projection state are process-local and reset on Host restart. Conversation/Turn identity and normalized snapshots are durable.
- Action idempotency is bounded to the recent 256 retained actions, not durable exactly-once execution.
- SSE slow-client recovery currently closes the lagging connection; clients must reconnect or fetch a snapshot after `stream.reset`.
- The browser cursor and live Conversation projection are memory-only and rebuild from Host Snapshot on page refresh or epoch change.
- Snapshot reconstructs the bounded recent hot-runtime window, including after Host restart. The Project-scoped index separately lists durable summaries, and single-Conversation GET reconstructs a recent 20-Turn durable view without hydration. The real list/Rail/detail consume these reads, but older Turn rows are not pageable.
- Every durable Conversation references one Project. Project deletion is registration-only and is rejected while Conversations exist; CodeTether never deletes the workspace or cascades its history.
- Protocol v1's deprecated `cwd` Conversation request may only resolve an existing registered available Project. New callers use `projectId`.
- Terminal projection retains only the most recent 128 KiB per Conversation.
- Runtime history remains limited per Conversation, and the Host restores/admits at most eight in-memory Conversations by default. Older Conversations remain cold-readable through the real Detail/Rail path, and Start Turn hydrates them internally with safe idle-LRU eviction plus lazy provider resume. Active-Turn provider Item and file-change identity maps are each capped at 1,024 entries; exceeding a bound fails explicitly rather than growing without limit.
- An idle runtime failure changes bootstrap capabilities but has no proactive Protocol v1 capability-change event.
- Local Host launch paths disable Codex hooks by default so user hooks cannot pre-resolve escalation ahead of CodeTether Approval handling.
- Protocol v1 Approval presentation does not yet expose a trusted structured risk or provider reason field, so the live UI shows kind, semantic command/action, workspace context, and identity without fabricating risk.
- Approvals do not survive as actionable requests across a Host restart; pending records are expired with `host_restart` because their provider request handles belong to the old process.
- A stored provider Thread is resumed lazily on the next Turn. If resume fails because that provider Thread is missing, local history remains readable and controls return `provider_conversation_unavailable`; automatic fork/replacement is not implemented.
- SQLite retains normalized per-Turn snapshots without a disk retention policy in this phase, so database size grows with durable history until a later archive/retention design.
- Generated protocol artifacts and real-agent workspace files remain ignored under `.tmp/`.
- Legacy CodeTether code and structure are not architectural inputs.
