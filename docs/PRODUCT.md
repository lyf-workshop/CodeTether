# CodeTether Product Specification

## Vision

CodeTether will become **a control center for AI coding agents**: a coherent workspace where developers can see what agents are doing, guide their work, control risk, and continue tasks across their own machines without separately managing every provider CLI.

The product is not a generic administration dashboard. It is an AI coding workspace. The primary experience should make it feel as though an agent is actively working inside the user's project while the user supervises, directs, and controls that work.

## Target Users

- Individual developers who use coding agents throughout the day.
- Technical power users who run multiple projects or concurrent conversations.
- Developers who work across more than one personal machine.
- Users who need to monitor or approve long-running work away from their desk.

Team administration and enterprise management are not current target scenarios.

## Core Problem

Agent tools currently fragment the developer's attention across separate CLIs, histories, permission models, project contexts, and machines. It is difficult to answer basic cross-session questions quickly:

- Which agent is working, waiting, blocked, or finished?
- What project and machine does the conversation belong to?
- What tools ran, what files changed, and what is the current diff?
- Does an agent need approval or an answer?
- Can the user interrupt, reply, resume, or continue from another device?

CodeTether provides one interaction model for those responsibilities while preserving provider-specific behavior behind adapters.

## Product Principles

- **Workspace over dashboard:** center the work, conversation, tools, and code—not aggregate vanity metrics.
- **Clarity under density:** show substantial technical detail without visual noise.
- **Control with context:** approvals and interventions must show enough context to make a safe decision.
- **Fast feedback:** streaming work, state transitions, and user actions should feel immediate.
- **Desktop depth, mobile focus:** each device serves its best use cases.
- **Provider-neutral product language:** users may know the active provider, but core workflows remain consistent.
- **Design fidelity:** Figma is the only source of truth for visual design.

## Core Objects

### Project

A durable, authorized local workspace known to CodeTether. In the current local model it has a CodeTether-owned identity, display name, one canonical root path, creation/update timestamps, and availability derived from the current filesystem. Conversations operate inside that root. Multiple Machine locations remain a future product capability rather than part of the current record.

### Conversation

The central unit of work and history. A conversation combines:

```text
Conversation
├── Project
├── Agent
├── Machine
├── Model
├── Reasoning
├── Permission
└── History
```

A conversation belongs to exactly one agent. Codex conversations remain Codex conversations; cross-agent handoff is intentionally unsupported in the current product plan.

### Agent

A supported coding-agent runtime/provider. V1 prioritizes Codex. Claude Code and OpenCode arrive in later phases through the same product model.

### Machine

A computer that stores projects and runs the local host and agent processes. Machine availability and execution state are part of the user's operating context.

## Desktop Experience

Desktop is the primary environment for creating, supervising, and managing work. It should support:

- Navigating projects and conversations quickly.
- Reading conversation history and live agent output.
- Understanding reasoning, tool calls, terminal output, file changes, and diffs.
- Approving or rejecting risky actions with relevant context.
- Answering agent questions, interrupting work, and resuming tasks.
- Managing models, reasoning levels, permissions, and machines when those capabilities become available.

Conversation Detail is the product's most important future screen and should receive the strongest interaction and information-design attention.

## Mobile Experience

Mobile is a companion, not a miniature desktop application. Its primary jobs are:

- **Monitor** current status and recent progress.
- **Approve** or reject pending operations safely.
- **Reply** to agent questions or provide short guidance.
- **Resume** a paused or waiting conversation.

Dense code review, project setup, and complex configuration remain desktop-first. Mobile screens should prioritize urgency, legibility, and quick completion.

## Product Areas

### Projects

Projects organize local codebases and provide the stable authorization context for Conversations. The local Host now owns durable Project identity and root authorization; a Conversation references one Project and may use a working directory contained within its canonical root. Filesystem availability can change independently of the durable record, so an unavailable Project keeps its history but cannot start or control Agent work until its saved root is valid again. The Projects product surface and multiple-Machine location management remain future work.

### Conversations

Conversations organize agent sessions, history, model and reasoning choices, permission mode, current status, machine, and project. They should make live and historical work easy to follow. A single conversation never moves between agent providers in the current model. CodeTether owns the durable public Conversation identity; a provider Thread ID is private Host metadata used to continue that same provider context after a restart.

### Agents

Agents expose available providers and capabilities through a unified experience. Provider-specific protocol details must not leak into product UI. V1 focuses on Codex; Claude Code and OpenCode follow after the core loop is proven.

### Machines

Machines show where projects and agents can run, whether a host is reachable, and which conversations are active there. Machine identity and trust are prerequisites for later remote control.

### Inbox

Inbox is an action-oriented queue for items that need the user's attention, such as approvals, questions, failures, and important completions. It is not a general activity log.

### Activity

Activity provides a chronological view of meaningful events across conversations and machines. It supports awareness and navigation without replacing the full conversation history.

### Permissions

Permissions communicate what an agent may do and govern risky actions. Approval requests must state the proposed action, scope, origin conversation, machine, and relevant consequences. Permission UX must favor informed, explicit decisions.

### Changes

Changes show files created, modified, moved, or deleted by the agent and provide a coherent diff view. The product should connect changes to the conversation activity that caused them.

### Terminal

Terminal presents commands, streaming output, exit state, and relevant process information. It exists to make agent execution observable and controllable, not to replicate a full terminal emulator prematurely.

### Context

Context explains what project information, files, instructions, model configuration, and relevant conversation history the agent is using. It should help users understand agent decisions without exposing provider protocol internals.

### Notifications

Notifications alert the user when intervention is useful—especially questions, approvals, failures, and completion. They should be timely and actionable without duplicating every activity event.

## Future Remote Access

CodeTether should eventually allow a web or mobile client to connect securely to a user's machine host over a trusted network, initially local network or Tailscale-style connectivity. Remote clients should be able to monitor work and issue authorized control actions while execution and project access remain on the user's machine.

Public cloud relay is not part of the current plan. Remote architecture must preserve explicit machine trust, authentication, authorization, and auditability.

## V1 Priorities and Boundaries

V1 is **Codex-first**. It proves the product experience and local execution loop before broad provider support.

Explicitly deferred:

- Claude Code integration.
- OpenCode integration.
- Teams and shared organizational workspaces.
- Enterprise administration and policy features.
- Cross-agent conversation handoff.
- Public cloud relay.

## Current Phase

Phase 1 Frontend Experience is accepted and frozen as **CodeTether V2 Frontend Core v1**. Phase 2A and Phase 2A.1 are accepted and frozen as **Phase 2A Codex Runtime v1**. Phase 2B is accepted as the local-only Client-to-Host Protocol v1 boundary.

**Phase 2C.1 — Live Conversation Read Model** is accepted. It connects only the frozen Desktop Conversation Detail read path to that Host boundary. A real `conv_*` route loads bootstrap and an in-memory Snapshot, follows normalized Host events over one application-scoped SSE runtime, projects them into the same view model used by the Demo, and renders the result read-only.

**Phase 2C.1.1 — Conversation Read Model Completeness** is accepted and frozen as **Live Conversation Read Model v1**. The Host is the process-local source of truth for the retained Conversation Timeline. The additive Protocol v1 Snapshot carries recent Turns, canonical text User inputs, Agent messages, Tool executions, file changes, Turn outcomes, pending Approvals, and the latest bounded terminal tail. Initial load, page refresh, reconnect reset, and live event application therefore reconstruct the same retained view within one Host process. Stable Tool presentation labels keep raw Provider command strings out of Timeline titles.

**Phase 2C.2 — Live Conversation Control** is accepted and frozen as **CodeTether Local Codex Alpha v0.1**. A user may submit one text Turn when no Turn is active, resolve every pending Approval with Allow Once or Decline, interrupt the exact active Turn, and continue the same Conversation afterward. Host events remain final truth: User messages are never client-only records, Approval cards remain until resolved events arrive, and interrupted state is not assumed from an HTTP acknowledgement. Unsupported quick actions, Stop, queue/steer, attachments, and model/reasoning/permission changes remain unavailable.

**Phase 2D — Local Alpha Audit & Stabilization** is complete with a `READY` verdict and no remaining P0/P1 blocker. It froze **CodeTether Local Codex Alpha v0.1** without redesigning its accepted product surfaces.

**Phase 3A — Minimal Durable Persistence** is complete and validated. Local SQLite durability now preserves CodeTether Conversation identity, the private Codex provider Thread identity, canonical User input, and normalized per-Turn presentation state. Runtime memory remains the authority for high-frequency live work, SQLite is the restart boundary, and SSE replay remains a short-lived transport boundary. On startup, recent durable history is reconstructed for the existing Conversation Detail; incomplete Turns become interrupted because CodeTether does not pretend they survived the Host process, and pre-restart Approvals become non-actionable expired history. A later Turn lazily resumes the stored Codex Thread rather than creating a new Conversation.

Phase 3A does not make all product data durable and does not add a general history browser. Older durable Turns may remain on disk beyond the bounded runtime window, but no pagination UI exists. If the provider Thread cannot be resumed, the local Timeline remains readable and the control path reports that the provider Conversation is unavailable. Action idempotency and SSE replay remain process-local, so a client must reconcile through the new Host epoch and Snapshot rather than replaying an uncertain old mutation. A real isolated multi-Turn restart verified Timeline reconstruction and retained Codex context through the exact saved provider Thread.

**Phase 3B.1 — Durable Project Identity & Local Workspace Authorization** is implemented and validated. A Project registration contains `projectId`, name, canonical root path, and timestamps; availability is computed at read time. SQLite migration 002 (`projects`) makes every durable Conversation reference one Project, while the Conversation `cwd` remains a real-path-validated working directory contained by that Project. Registration is idempotent by canonical root, survives Host restart, and is re-authorized before every new Turn and lazy provider Thread resume.

Protocol v1 now supports listing, reading, creating, and deleting Project registrations. New Conversations use `projectId`. The deprecated `cwd` compatibility form can only resolve an already registered, available Project and cannot expand trust. Deleting a Project removes only the registration, never files or Conversation history, and is rejected while a Conversation references it. Missing or moved Project roots remain visible as unavailable so durable history stays readable; controls fail with `project_unavailable`.

`/conversations/demo`, Inbox, Conversations, and the Projects page continue to use Mock data. Phase 3B.2 is not authorized. There is no Tauri functionality, remote access, authentication, live Project/Conversation listing, multi-Machine Project location model, or non-Codex provider integration. See [`ROADMAP.md`](ROADMAP.md) for phase gates and verified constraints.
