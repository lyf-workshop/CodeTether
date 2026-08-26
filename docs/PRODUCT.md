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

A local codebase or workspace known to CodeTether. A project has an identity, one or more machine locations over time, and conversations that operate on it.

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

Projects organize local codebases and provide the stable context for conversations. Users should be able to understand where a project exists and see its related work. Project management will eventually come from the machine host rather than client-only state.

### Conversations

Conversations organize agent sessions, history, model and reasoning choices, permission mode, current status, machine, and project. They should make live and historical work easy to follow. A single conversation never moves between agent providers in the current model.

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

**Phase 2C.2 — Live Conversation Control** connects the existing live Conversation Detail controls without changing its product design. A user may submit one text Turn when no Turn is active, resolve every pending Approval with Allow Once or Decline, interrupt the exact active Turn, and continue the same Conversation afterward. Host events remain final truth: User messages are never client-only records, Approval cards remain until resolved events arrive, and interrupted state is not assumed from an HTTP acknowledgement. Unsupported quick actions, Stop, queue/steer, attachments, and model/reasoning/permission changes remain unavailable.

This remains a bounded, non-durable local Alpha boundary. Old completed Turns or presentation entries may be explicitly evicted, and a Host restart still clears all runtime history. `/conversations/demo`, Inbox, and Conversations continue to use Mock data. Phase 2C.2 adds no persistence, Tauri functionality, remote access, authentication, or non-Codex provider integration. See [`ROADMAP.md`](ROADMAP.md) for phase gates.
