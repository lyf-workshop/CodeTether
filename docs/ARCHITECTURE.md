# CodeTether Architecture

## Status

This document describes the intended architecture and its boundaries. In Phase 0, only `apps/web` and `packages/ui` have executable foundations. Desktop, Host, Protocol, Agent Core, adapters, persistence, and event streaming are documentation or README-only placeholders; none is implemented.

## System Context

The future local desktop path is:

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

Web and mobile clients use the same host boundary:

```text
Mobile / Web
      │
      ▼
 Machine Host
```

The Machine Host is the authority for execution, persisted records, permissions, and live state. Clients render normalized data and send explicit commands; they do not operate agent protocols directly.

## Planned Monorepo Boundaries

```text
apps/web                 React web/PWA client
apps/desktop             Tauri 2 desktop shell
apps/host                Node.js machine host

packages/ui              Shared design system
packages/protocol        Versioned client ↔ host contracts
packages/agent-core      Provider-neutral adapter interfaces and events
packages/adapter-codex   Codex-specific integration
packages/adapter-claude  Claude Code-specific integration
packages/adapter-opencode OpenCode-specific integration
packages/shared          Small environment-neutral shared utilities
```

Dependencies should point inward toward stable contracts. UI code must not import provider adapters. Adapters may depend on agent-core and protocol-neutral domain types, never on product UI.

## UI

The UI presents projects, conversations, agents, machines, approvals, changes, terminal output, context, and notifications. Figma defines its visual and interaction behavior.

The client owns ephemeral presentation state only—for example open panels, selected inspector tab, command palette visibility, and mobile navigation. TanStack Query will manage host/server state. Zustand will manage UI state and must not become a duplicate database for Projects, Conversations, Agents, or Machines.

The UI consumes normalized protocol records and events. It must not parse Codex, Claude Code, or OpenCode wire formats.

## Desktop Shell

The future Tauri 2 shell packages the web UI for desktop and supplies OS-level capabilities that truly require a native boundary, such as window lifecycle, secure local integration, and launching or connecting to the machine host.

The shell should remain thin. Business rules, agent execution, and durable data do not belong in UI-specific Tauri commands merely because the desktop app can call them.

## Host

The future Node.js host runs on a Machine and coordinates:

- Project discovery and local paths.
- Conversation/session lifecycle.
- Agent adapter detection and execution.
- Commands such as send, interrupt, terminate, approve, and reject.
- Persistence and recovery.
- Normalized live event streaming.
- Authentication, authorization, and machine trust for remote clients.

The host is the single runtime authority. Multiple clients may observe it, but client reconnection must not create a competing session owner.

## Protocol

`packages/protocol` will define versioned contracts between clients and the host, including:

- Identifiers and normalized domain records.
- Query and command payloads.
- Event envelopes, sequence/cursor semantics, and timestamps.
- Errors and capability negotiation.
- Compatibility and protocol-version rules.

Contracts should be transport-aware only where necessary. A future transport can change without rewriting product-domain semantics.

## Agent Adapter

Each coding agent will be integrated through a provider-neutral boundary conceptually shaped like:

```ts
interface AgentAdapter {
  detect(): unknown
  listModels(): unknown
  createSession(): unknown
  resumeSession(): unknown
  sendMessage(): unknown
  interrupt(): unknown
  terminate(): unknown
  approve(): unknown
  reject(): unknown
}
```

This is an architectural sketch, not a current API. Real types and lifecycle semantics will be designed only when the Codex local loop is implemented.

Adapters translate provider-specific behavior into normalized events such as:

```text
MessageDelta
ReasoningDelta
ToolStarted
ToolFinished
ShellStarted
ShellOutput
FileChanged
DiffUpdated
ApprovalRequested
QuestionRequested
SessionCompleted
SessionFailed
```

Provider-specific details may be retained as optional metadata for diagnostics, but the UI should depend on the normalized meaning.

## Persistence

Persistence will eventually store durable entities and history: projects, conversations, machines, agent/session references, messages, events, permission decisions, and recovery metadata.

Design principles:

- The host owns durable records.
- Stable CodeTether IDs are distinct from provider session IDs.
- An append-oriented event history supports reconstruction and auditability where appropriate.
- Schema migrations must be explicit and tested.
- Secrets, credentials, and approval scope require separate security treatment.

No database or persistence library is selected or installed in Phase 0 or Phase 1.

## Event Streaming

Agent activity is incremental and ordered. The host will normalize provider output, persist durable events as required, and stream them to connected clients. The design must eventually account for:

- Ordering within a conversation/session.
- Stable event identity and duplicate handling.
- Reconnection from a cursor or snapshot.
- Backpressure and high-volume terminal output.
- Partial message/reasoning deltas and terminal states.
- Multiple observing clients without duplicated execution.

WebSocket or another transport will be selected during the relevant phase. Phase 0 and Phase 1 must not implement a backend or simulate a production transport.

## Conversation Ownership

A Conversation is bound to one Project, one Agent, and the Machine executing it, plus model, reasoning, permission, and history. In the current plan, an existing Conversation cannot be continued by a different Agent. Supporting cross-agent handoff would require explicit product semantics and history translation and is out of scope.

## Security Boundary

Agent execution can read files, run commands, and change code. The host must eventually enforce permission policy and produce explicit approval requests. Remote control requires authenticated clients, trusted machine identity, scoped authorization, secure transport, and auditable decisions. These requirements are recorded now but implemented only in their roadmap phases.

## Current Architectural Constraints

- Phase 0 implements frontend foundations only.
- Phase 1 uses mock data only.
- No Tauri, database, host, WebSocket backend, agent SDK, or adapter is installed yet.
- Legacy CodeTether code and structure are not architectural inputs unless a later task explicitly requests review of a validated low-level capability.
