# CodeTether Architecture

## Status

Phase 1 Frontend Experience is accepted and frozen as **CodeTether V2 Frontend Core v1**. Phase 2A proved the basic local Codex App Server loop. Phase 2A.1 has now validated the control semantics needed before defining a client-to-host protocol: real approval, multiple Turns and Threads, cross-process resume, interruption, safe command failure, runtime cleanup, identity preservation, and bounded delta delivery. The frozen React frontend remains Mock-only and is not connected to this runtime.

No browser API, Tauri shell, database, persistence, remote access, or production machine-host service exists yet.

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
apps/web                   React web/PWA client; frozen Mock frontend
apps/desktop               Future Tauri 2 desktop shell placeholder
apps/host                  Phase 2A development runners and process lifecycle

packages/ui                Shared design system
packages/protocol          Future client-to-host contracts placeholder
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

The local Codex installation also has a user `PermissionRequest` hook capable of pre-resolving escalation before an App Server request reaches CodeTether. The Phase 2A.1 semantics runner starts App Server with hooks disabled only for its disposable protocol-validation scenarios. The default adapter launcher continues to respect user configuration. Hook coexistence and precedence require an explicit product decision in a later phase.

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

Every normalized Turn event carries the provider Thread ID and Turn ID. Item events retain the provider Item ID. Approval events also retain an approval/request identity, and the response path validates Thread, Turn, and Item binding. When Codex supplies no separate approval ID, the current event uses the JSON-RPC request ID, which is correlation identity for that connection rather than a durable approval identifier. There is no CodeTether-wide sequence or replay cursor yet; those belong to the future client-to-host protocol.

## UI

The UI presents projects, conversations, agents, machines, approvals, changes, terminal output, context, and notifications. Figma defines visual and interaction behavior. The accepted frontend remains Mock-only during Phase 2A.

The client owns ephemeral presentation state only. TanStack Query is reserved for future host/server state, and Zustand is limited to UI state. Project, Conversation, Agent, and Machine records must not be duplicated into a client store as a second runtime authority.

The UI must eventually consume a versioned client-to-host protocol, not Codex wire messages or `packages/adapter-codex` directly. No transport has been selected or implemented in Phase 2A.

## Desktop Shell

The future Tauri 2 shell will package the web UI and supply OS-level capabilities that truly require a native boundary. It remains unimplemented. Business rules, agent execution, and durable data must not be moved into UI-specific Tauri commands.

## Host

`apps/host` currently owns only development harness lifecycle: preparing isolated workspaces, checking the executable, starting the adapter, printing normalized events, collecting summaries, running Phase 2A.1 semantic scenarios, and shutting down. It is not yet a general machine-host service and exposes no HTTP, WebSocket, or SSE endpoint.

The future Host is expected to coordinate project discovery, conversation lifecycle, execution commands, persistence, recovery, live event delivery, and remote trust. Those responsibilities remain planned rather than implemented.

## Client-to-Host Protocol

`packages/protocol` remains a placeholder. A later phase must define versioned client-to-host identifiers, commands, records, events, errors, capability negotiation, ordering, and reconnection semantics. Provider wire payloads must stay behind adapters.

## Agent Adapter Boundary

Phase 2A deliberately does not introduce a speculative multi-provider `AgentAdapter` interface. The Codex implementation is separated by real responsibilities—process, transport, client, protocol subset, lifecycle, logging, and normalization—while `packages/agent-core` contains only the minimal observed product meaning.

Provider-specific capabilities may remain Codex-specific when a natural common concept has not been proven. Claude Code and OpenCode implementations are deferred to their roadmap phases.

## Persistence

There is no CodeTether database, event store, repository abstraction, or migration in Phase 2A or Phase 2A.1. Thread IDs, Turn IDs, events, and summaries exist only in runtime memory and terminal output. Codex itself owns the resumable Thread record used by `thread/resume`; CodeTether persistence design remains deferred.

## Event Streaming

The verified runtime is event-driven:

```text
Codex stdout → line decoder → transport dispatch → normalizer → bounded Host queue → CLI subscriber
```

It uses no polling or database scan. The adapter does not intentionally coalesce or discard provider events. The Phase 2A.1 semantics harness adds a development Host queue bounded to 256 events and approximately 1 MiB by default, with a per-delta cap. Adjacent `message.delta` and `tool.output` events with the same Thread, Turn, Item, and stream identity may be coalesced. Under pressure, only coalescible deltas may be evicted; approvals use a direct control callback, and terminal lifecycle events are either delivered or cause an explicit runtime failure rather than being silently dropped. If reliable-only events exceed the bound, the runtime fails explicitly instead of growing an unbounded queue.

The final two-Turn validation observed 171 raw message/tool delta events and delivered 118 aggregated events, a 31.0% reduction, with exact raw-to-delivered integrity for both message text and tool output, canonical final-message integrity, and zero dropped deltas. The flush/coalescing parameters are experimental rather than a finalized client protocol.

Durable ordering, a global sequence, replay, reconnection, and multi-client observation remain unsolved and must be designed at the future client-to-host boundary.

## Conversation Ownership

A Conversation is bound to one Project, one Agent, and the Machine executing it, plus model, reasoning, permission, and history. An existing Conversation cannot switch providers. Phase 2A maps one Codex Thread to one continuing Codex conversation concept but does not persist a CodeTether Conversation record.

## Security Boundary

Agent execution can read files, run commands, and change code. The spike confines the real Turn to a dedicated ignored workspace, uses `workspace-write` and `on-request` approval settings, forbids automatic approval, and records protocol summaries without environment variables or credentials.

These controls are development safeguards, not a production security model. Authentication, authorization, machine trust, durable audit, secret handling, and remote transport security remain unimplemented.

## Current Architectural Constraints

- The frozen React frontend is not connected to the runtime.
- The Host is a development CLI harness, not a daemon or browser service.
- The real integration is Codex-only and was verified against local `codex-cli 0.149.1`.
- No Tauri shell, browser API, database, persistence, remote access, or production permission policy exists.
- Command Allow Once and Decline were exercised through real App Server requests; file-change and permissions approvals were not observed.
- Multi-Turn, multi-Thread, cross-process resume, interruption, and safe Tool failure were manually validated.
- A real terminal Turn failure was not observed.
- The bounded queue is an in-process prototype, not a browser/client delivery protocol.
- User approval hooks can pre-resolve escalation; the validation runner disables hooks only in disposable semantics scenarios.
- Generated protocol artifacts and real-agent workspace files remain ignored under `.tmp/`.
- Legacy CodeTether code and structure are not architectural inputs.
