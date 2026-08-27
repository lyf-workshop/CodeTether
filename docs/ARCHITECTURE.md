# CodeTether Architecture

## Status

Phase 1 Frontend Experience is accepted and frozen as **CodeTether V2 Frontend Core v1**. Phase 2A and Phase 2A.1 are accepted and frozen as **Phase 2A Codex Runtime v1**. Phase 2B is accepted as the versioned local Client-to-Host boundary: HTTP commands, an SSE event stream, CodeTether-owned public identities, in-memory snapshot/replay, and a non-React client.

Phase 2C.1 is accepted, and Phase 2C.1.1 is frozen as **Live Conversation Read Model v1**: one application-scoped Web runtime connects the frozen Conversation Detail to Protocol v1, while bounded Host-owned history reconstructs the same retained multi-Turn view after initial load, refresh, reconnect reset, or live event application. Phase 2C.2 is accepted and frozen as **CodeTether Local Codex Alpha v0.1**, connecting only the existing text Composer, one-shot Approval actions, and Interrupt control. Phase 2D audited and stabilized this boundary without adding product scope. Demo, Inbox, and Conversations remain Mock-only.

No Tauri shell, database, persistence, remote access, authentication, or production machine-host service exists yet. The Phase 2B server is a development-only loopback API.

## System Context

The intended local desktop path remains:

```text
Desktop UI
    │
    ▼
Machine Host
    │
    ▼
Agent Adapter
    │
    ▼
Coding Agent
```

Future web and mobile clients use the same host boundary:

```text
Mobile / Web
      │
      ▼
 Machine Host
```

The future Machine Host will be the runtime authority. Clients must render normalized data and send explicit commands rather than operate provider protocols directly. Phase 2A and Phase 2A.1 validate only the lower Host-to-Codex portion of this model.

## Monorepo Boundaries

```text
apps/web                   Frozen React UI plus live Conversation read/control boundary
apps/desktop               Future Tauri 2 desktop shell placeholder
apps/host                  Codex runtime harnesses and Phase 2B local Host API

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

The Host creates opaque `conversationId`, `turnId`, `itemId`, and `approvalId` values. Private maps bind them to the exact Codex Thread, Turn, Item, approval request, and JSON-RPC request identities. Browser routing never uses a provider Thread ID. Numeric and string JSON-RPC request IDs remain distinct through tagged internal keys. Approval resolution revalidates the full Conversation/Turn/Item/provider-request binding, requires a still-pending record, and rejects repeated resolution.

State is in memory only. `GET /api/v1/snapshot` returns the current epoch, current sequence, Conversation summaries, active Turns, and pending Approvals. A Host restart creates a new epoch and an empty snapshot; it does not recover Conversations.

### HTTP Commands

The local API implements:

```text
GET  /api/v1/bootstrap
GET  /api/v1/snapshot
GET  /api/v1/events
POST /api/v1/conversations
POST /api/v1/conversations/:conversationId/turns
POST /api/v1/conversations/:conversationId/turns/:turnId/interrupt
POST /api/v1/approvals/:approvalId/resolve
```

Mutations require an `actionId`. A bounded 256-entry in-memory cache returns the original Promise/result for an identical retry while that action remains retained, rejects reuse with different input, never evicts in-flight actions, and explicitly reports capacity pressure. Settled entries are eventually evicted, so this is a recent-retry guarantee rather than durable exactly-once execution; callers must use globally random action IDs and retry a lost response promptly. Mutation responses share `accepted`, `completed`, or `rejected` status semantics while retaining endpoint-specific data. Safe errors use protocol codes rather than forwarding provider JSON-RPC errors.

Create Conversation currently accepts only Codex, text-only Turns, optional model/reasoning, and an absolute existing working directory contained by an explicit allowed root after real-path resolution. The API does not implement Project discovery or a general filesystem chooser.

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

The stabilized process-level lower bound is approximately 32 MiB of encoded retained Conversation history plus the 8 MiB replay buffer, 4 MiB provider-binding buffer, 1 MiB provider queue, bounded approval/action/identity maps, and temporary Snapshot/SSE serialization. Actual JavaScript heap and the Codex child process are higher. All state remains process-local and disappears on Host restart.

## UI

The UI presents projects, conversations, agents, machines, approvals, changes, terminal output, context, and notifications. Figma defines visual and interaction behavior. Phase 2C.1 through Phase 2C.2 preserve the accepted visual structure and change only the Conversation Detail data/control boundary for valid live Conversation routes.

The client owns ephemeral presentation state only. TanStack Query stores bootstrap, Snapshot, and Conversation projection state; Zustand remains limited to UI state. Project, Conversation, Agent, Machine, and retained Timeline records must not be duplicated into a client store as a second runtime authority.

The live Conversation path consumes Protocol v1 through `packages/client`, never Codex wire messages or `packages/adapter-codex` directly. Inbox and Conversations remain Mock data. Phase 2C.2 sends only text Turn start, one-shot Approval resolution, and exact-Turn interrupt commands; no other React write path is connected.

## Desktop Shell

The future Tauri 2 shell will package the web UI and supply OS-level capabilities that truly require a native boundary. It remains unimplemented. Business rules, agent execution, and durable data must not be moved into UI-specific Tauri commands.

## Host

`apps/host` owns the development harness lifecycle plus the Phase 2B in-memory Host service and loopback HTTP/SSE server. It allocates public identities, maps them to provider identities, validates actions and workspaces, owns live snapshot state, sequences client events, and performs bounded fanout/replay. It remains a development local service rather than a durable production machine host.

The future Host is expected to coordinate project discovery, conversation lifecycle, execution commands, persistence, recovery, live event delivery, and remote trust. Those responsibilities remain planned rather than implemented.

## Client-to-Host Protocol

`packages/protocol` defines Protocol v1 identifiers, commands, records, events, safe errors, capabilities, ordering, and reconnect cursors with TypeScript and Zod. `packages/client` implements the matching HTTP/SSE consumer without React. Provider wire payloads remain behind adapters, and unknown provider notifications are diagnostics rather than public events.

## Agent Adapter Boundary

Phase 2A deliberately does not introduce a speculative multi-provider `AgentAdapter` interface. The Codex implementation is separated by real responsibilities—process, transport, client, protocol subset, lifecycle, logging, and normalization—while `packages/agent-core` contains only the minimal observed product meaning.

Provider-specific capabilities may remain Codex-specific when a natural common concept has not been proven. Claude Code and OpenCode implementations are deferred to their roadmap phases.

## Persistence

There is no CodeTether database, durable event store, repository abstraction, or migration in Phase 2A through Phase 2C.2. Public/provider identity maps, bounded Conversation runtime history, snapshots, replay events, action results, and the browser Conversation projection exist only in memory. Codex itself owns its resumable Thread record; CodeTether persistence and application-restart recovery remain deferred.

## Event Streaming

The verified runtime is event-driven:

```text
Codex stdout → line decoder → transport dispatch → normalizer → bounded Host queue → CLI subscriber
```

It uses no polling or database scan. The adapter does not intentionally coalesce or discard provider events. The Phase 2A.1 semantics harness adds a development Host queue bounded to 256 events and approximately 1 MiB by default, with a per-delta cap. Adjacent `message.delta` and `tool.output` events with the same Thread, Turn, Item, and stream identity may be coalesced. Under pressure, only coalescible deltas may be evicted; approvals use a direct control callback, and terminal lifecycle events are either delivered or cause an explicit runtime failure rather than being silently dropped. If reliable-only events exceed the bound, the runtime fails explicitly instead of growing an unbounded queue.

The final two-Turn validation observed 171 raw message/tool delta events and delivered 118 aggregated events, a 31.0% reduction, with exact raw-to-delivered integrity for both message text and tool output, canonical final-message integrity, and zero dropped deltas. The flush/coalescing parameters are experimental rather than a finalized client protocol.

Phase 2B adds non-durable Host-global ordering, bounded replay, explicit reconnect reset, and isolated multi-client observation at the client boundary. These guarantees apply only within one in-memory Host epoch; durable replay remains deferred.

Phase 2C.1 adds one browser consumer for that stream. It rejects duplicate and out-of-order events before updating the TanStack Query projection. Phase 2C.1.1 makes the Snapshot replacement complete for all retained runtime history, so a reset or unrecoverable cursor condition reconstructs the same retained Timeline rather than merging across incompatible epochs. The guarantee ends at the explicit in-memory eviction boundary and at Host restart.

## Conversation Ownership

A Conversation is bound to one Project, one Agent, and the Machine executing it, plus model, reasoning, permission, and history. An existing Conversation cannot switch providers. Phase 2A maps one Codex Thread to one continuing Codex conversation concept but does not persist a CodeTether Conversation record.

## Security Boundary

Agent execution can read files, run commands, and change code. The spike confines the real Turn to a dedicated ignored workspace, uses `workspace-write` and `on-request` approval settings, forbids automatic approval, and records protocol summaries without environment variables or credentials.

The Phase 2B HTTP server additionally binds only `127.0.0.1`, requires the exact loopback `Host` authority, enforces an explicit Origin allowlist without a wildcard, limits JSON bodies and SSE connections, validates every wire payload, returns safe error envelopes, and real-path-checks working directories against explicit allowed roots.

These controls are development safeguards, not a production security model. Authentication, authorization, machine trust, durable audit, TLS, pairing, and remote transport security remain unimplemented. The server must not bind to LAN interfaces in this phase.

## Current Architectural Constraints

- Only valid live Conversation Detail routes are connected to the runtime; Demo, Inbox, and Conversations remain Mock data.
- The Host API is a development-only loopback service, not a durable daemon or remote service.
- The real integration is Codex-only and was verified against local `codex-cli 0.149.1`.
- React can start text Turns, resolve one-shot pending Approvals, and interrupt the exact active Turn on a valid live Conversation route. Stop/thread termination, queueing, steering, attachments, configuration changes, and other write paths are not connected.
- No Tauri shell, database, persistence, authentication, remote access, or production permission policy exists.
- Command Allow Once and Decline were exercised through real App Server requests; file-change and permissions approvals were not observed.
- Multi-Turn, multi-Thread, cross-process resume, interruption, and safe Tool failure were manually validated.
- A real terminal Turn failure was not observed.
- Protocol v1 replay, action idempotency, public identities, and snapshot state are process-local and reset on Host restart.
- Action idempotency is bounded to the recent 256 retained actions, not durable exactly-once execution.
- SSE slow-client recovery currently closes the lagging connection; clients must reconnect or fetch a snapshot after `stream.reset`.
- The browser cursor and live Conversation projection are memory-only and reset on page refresh.
- Snapshot reconstructs only the bounded in-memory history retained by the current Host process; evicted records and all state from a previous Host process are intentionally unavailable.
- Terminal projection retains only the most recent 128 KiB per Conversation.
- Runtime history remains limited per Conversation, and the Host admits at most eight in-memory Conversations by default. Active-Turn provider Item and file-change identity maps are each capped at 1,024 entries; exceeding a bound fails explicitly rather than growing without limit.
- An idle runtime failure changes bootstrap capabilities but has no proactive Protocol v1 capability-change event.
- Local Host launch paths disable Codex hooks by default so user hooks cannot pre-resolve escalation ahead of CodeTether Approval handling.
- Protocol v1 Approval presentation does not yet expose a trusted structured risk or provider reason field, so the live UI shows kind, semantic command/action, workspace context, and identity without fabricating risk.
- Generated protocol artifacts and real-agent workspace files remain ignored under `.tmp/`.
- Legacy CodeTether code and structure are not architectural inputs.
