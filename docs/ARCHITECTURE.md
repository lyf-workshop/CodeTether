# CodeTether Architecture

## Status

Phase 1 Frontend Experience is accepted and frozen as **CodeTether V2 Frontend Core v1**. Phase 2A implements only a development Runtime Spike: an in-process Node.js CLI harness can drive one local Codex App Server through initialize, Thread, Turn, streamed events, and shutdown. The frozen React frontend remains Mock-only and is not connected to this runtime.

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

The future Machine Host will be the runtime authority. Clients must render normalized data and send explicit commands rather than operate provider protocols directly. Phase 2A validates only the lower Host-to-Codex portion of this model.

## Monorepo Boundaries

```text
apps/web                   React web/PWA client; frozen Mock frontend
apps/desktop               Future Tauri 2 desktop shell placeholder
apps/host                  Phase 2A development runner and process lifecycle

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

Generated output is ignored development evidence under `.tmp/`; it is not copied into source and is not a runtime dependency. The implemented protocol subset follows the generated schema rather than an older external enum or legacy CodeTether implementation.

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

The spike creates one Codex-owned ephemeral Thread with the isolated workspace's absolute path, `workspace-write` sandboxing, `on-request` approval policy, and user-reviewed approvals. It then starts one Turn with a safe text prompt. Provider-generated Thread and Turn IDs are retained; CodeTether does not invent replacements for them in this spike.

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

The implementation also recognizes the generated-schema file-patch and approval methods needed by the spike, but methods not seen in the real run are not documented as observed behavior.

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
turn.failed
```

Raw provider method and payload may be attached as optional diagnostic metadata. They are not the normalized contract. A failed Codex Turn is derived from `turn/completed` with `turn.status = "failed"`; Codex 0.149.1 does not expose a separate `turn/failed` notification in the generated schema.

### Approvals

The client dispatches command and file-change approval server requests to an explicit terminal `y`/`n` prompt and returns only a one-shot allow or deny response. It does not auto-approve, persist decisions, or expose `Always Allow`.

The successful real Turn did not request approval, so end-to-end approval behavior remains unverified. The generated `item/permissions/requestApproval` schema has no explicit deny response variant; denial behavior for that method remains a known protocol gap rather than an inferred fact.

## UI

The UI presents projects, conversations, agents, machines, approvals, changes, terminal output, context, and notifications. Figma defines visual and interaction behavior. The accepted frontend remains Mock-only during Phase 2A.

The client owns ephemeral presentation state only. TanStack Query is reserved for future host/server state, and Zustand is limited to UI state. Project, Conversation, Agent, and Machine records must not be duplicated into a client store as a second runtime authority.

The UI must eventually consume a versioned client-to-host protocol, not Codex wire messages or `packages/adapter-codex` directly. No transport has been selected or implemented in Phase 2A.

## Desktop Shell

The future Tauri 2 shell will package the web UI and supply OS-level capabilities that truly require a native boundary. It remains unimplemented. Business rules, agent execution, and durable data must not be moved into UI-specific Tauri commands.

## Host

`apps/host` currently owns only the development spike lifecycle: preparing the isolated workspace, checking the executable, starting the adapter, printing normalized events, collecting a summary, and shutting down. It is not yet a general machine-host service and exposes no HTTP, WebSocket, or SSE endpoint.

The future Host is expected to coordinate project discovery, conversation lifecycle, execution commands, persistence, recovery, live event delivery, and remote trust. Those responsibilities remain planned rather than implemented.

## Client-to-Host Protocol

`packages/protocol` remains a placeholder. A later phase must define versioned client-to-host identifiers, commands, records, events, errors, capability negotiation, ordering, and reconnection semantics. Provider wire payloads must stay behind adapters.

## Agent Adapter Boundary

Phase 2A deliberately does not introduce a speculative multi-provider `AgentAdapter` interface. The Codex implementation is separated by real responsibilities—process, transport, client, protocol subset, logging, and normalization—while `packages/agent-core` contains only the minimal observed product meaning.

Provider-specific capabilities may remain Codex-specific when a natural common concept has not been proven. Claude Code and OpenCode implementations are deferred to their roadmap phases.

## Persistence

There is no database, event store, repository abstraction, or migration in Phase 2A. Thread IDs, Turn IDs, events, and summaries exist only in process memory and terminal output. Persistence design starts only after the runtime loop is understood.

## Event Streaming

The verified runtime is event-driven:

```text
Codex stdout → line decoder → transport dispatch → normalizer → CLI subscriber
```

It uses no polling or database scan. Ordering, durable event identity, replay, reconnection, backpressure, and multi-client observation are not solved by the spike and must be designed at the future client-to-host boundary.

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
- Approval dispatch is implemented but was not exercised by the successful real Turn.
- Generated protocol artifacts and real-agent workspace files remain ignored under `.tmp/`.
- Legacy CodeTether code and structure are not architectural inputs.
