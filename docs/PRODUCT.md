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

Phase 4A packages the accepted local workspace as one Windows-first CodeTether Desktop application. Launching Desktop owns the local Host lifecycle and loads the same Web UI; users no longer need to understand separate Host and Vite processes for the packaged product. Phase 4B adds one explicit native convenience to that shell: Desktop users can choose a Project directory with the Windows folder picker. Phase 4C lets the same running Desktop deliver new durable Attention through Windows notifications and return the user to the exact Conversation. The shell still does not own Project, Conversation, Approval, Inbox, or Attention truth and does not expose general native shell/filesystem power to the Web UI.

## Mobile Experience

Mobile is a companion, not a miniature desktop application. Its primary jobs are:

- **Monitor** current status and recent progress.
- **Approve** or reject pending operations safely.
- **Reply** to agent questions or provide short guidance.
- **Resume** a paused or waiting conversation.

Dense code review, project setup, and complex configuration remain desktop-first. Mobile screens should prioritize urgency, legibility, and quick completion.

## Product Areas

### Projects

Projects organize local codebases and provide the stable authorization context for Conversations. The local Host owns durable Project identity, canonical root authorization, availability, and mutation results; the Web UI renders those records and never becomes a competing Project authority. The Projects surface lists real registrations, adds a local root with an optional display name, shows the real Project overview and unavailable state, and removes only an unreferenced CodeTether registration after explicit confirmation. Desktop acquires the root through one native directory picker, while standalone Browser mode retains manual absolute-path entry. Both use the same Add Project dialog, typed Client mutation, and Host registration API. A Conversation references one Project and may use a working directory contained within its canonical root. Filesystem availability can change independently of the durable record, so an unavailable Project keeps its history but cannot start or control Agent work until its saved root is valid again. Project discovery/scanning, rename/relocate, drag-and-drop, recent folders, and multiple-Machine location management remain future work.

### Conversations

Conversations organize agent sessions, history, model and reasoning choices, permission mode, current status, machine, and project. They should make live and historical work easy to follow. A single conversation never moves between agent providers in the current model. CodeTether owns the durable public Conversation identity; a provider Thread ID is private Host metadata used to continue that same provider context after a restart.

### Agents

Agents expose available providers and capabilities through a unified experience. Provider-specific protocol details must not leak into product UI. V1 focuses on Codex; Claude Code and OpenCode follow after the core loop is proven.

### Machines

Machines show where projects and agents can run, whether a host is reachable, and which conversations are active there. Machine identity and trust are prerequisites for later remote control.

### Inbox

Inbox is an action-oriented queue for items that need the user's attention, such as approvals, questions, failures, and important completions. It is not a general activity log.

The current durable backend supports only semantics the Runtime can identify structurally: Approval, completed review, and failed Turn. Question / needs-reply remains a future Inbox capability until an Agent exposes a reliable structured question signal; punctuation, text heuristics, and extra LLM classification must not invent it.

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

Notifications alert the user when intervention is useful without duplicating every activity event. The current Desktop implementation uses only the three structurally supported durable Attention types: Approval, completed review, and failed Turn. It never analyzes Agent text to guess a question, completion, or failure.

Each new `attention.created` event may produce one Windows notification while CodeTether Desktop and its owned Host are running. Snapshot, restart, reconnect reset, and durable Inbox reconstruction do not create notifications. The native copy contains only a short type-specific message plus a clamped Project name and Conversation title; it excludes prompts, commands, paths, output, diffs, Agent text, raw errors, and provider identities.

A focused, visible Desktop suppresses the notification only when the Inbox or exact affected Conversation already presents the Attention. Clicking a delivered notification restores and focuses the existing main window and opens the Conversation, but never approves, resolves, reviews, acknowledges, or retries the work. Three application preferences control Approval, completed-review, and failed notifications independently and default on. Browser mode has no native delivery and continues to rely on Inbox.

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

**Phase 3B.2 — Real Projects UI** is implemented and validated. `/projects` lists Host-owned Project records and distinguishes loading, empty, and Host-unavailable states. `/projects/:projectId` reads the Project independently and shows only its real name, root path, availability, and timestamps. Phase 3B.2 originally used manual absolute-path entry; Phase 4B now lets Desktop acquire that same form value through a native directory picker while Browser mode keeps the original input. Host validation remains authoritative. Duplicate canonical roots open the existing Project, unavailable roots remain inspectable, and removal never touches the filesystem or bypasses `project_has_conversations`.

**Phase 3C.1 — Durable Conversation Index & Title** is implemented and validated. Every Conversation now owns a durable deterministic title. It starts as `新会话`; the first canonical text input replaces that default with a locally generated, Unicode-safe title and later Turns do not rewrite it. SQLite is the source of truth for the Project-scoped Conversation history index, independently of the bounded Runtime Snapshot.

Protocol v1 now exposes a bounded `GET /api/v1/projects/:projectId/conversations` history read with canonical status and last-activity ordering. The public summary omits private provider Thread identity and workspace routing metadata. Project history remains readable while its root is unavailable, and Host restart preserves title, status, Project ownership, and ordering.

**Phase 3C.1.1 — Durable Conversation Access & Lazy Hydration** is implemented and validated. Any Conversation returned by the durable index can be read from SQLite independently of Runtime admission and Codex availability. Control hydrates only the bounded recent working state and lazily resumes the saved provider Thread; safe idle-LRU eviction keeps the Runtime working set bounded.

**Phase 3C.2 — Real Conversations Experience** is implemented and validated. `/projects/:projectId/conversations` presents the real durable Project history, `/conversations/:conversationId` uses the same frozen Detail for hot or cold normalized state, and the Rail reads the owning Project's real index. Current Project context is route-derived, and Project Detail can open the real history or the minimal Codex-only New Conversation flow. The Host remains the source of truth for User messages, title, status, activity, workspace availability, hydration, and provider resume.

The real list shows only supported providers and known metadata. It performs local title/provider search over at most the latest 100 summaries and has no archive, rename, delete, or older-history pagination UI. `/conversations/demo` remains a development-only visual fixture. At the Phase 3C.2 boundary there was no Project discovery/scanning, native folder picker, rename/relocate, Tauri functionality, remote access, authentication, multi-Machine Project location model, or non-Codex provider integration. See [`ROADMAP.md`](ROADMAP.md) for current phase gates and verified constraints.

**Phase 3D.1 — Durable Attention Model** is implemented and validated. Attention is not a new core product entity: it is the durable, user-facing actionable/review state produced by a Project Conversation. The Host creates exact Approval Attention from `approval.requested`, completed-review Attention from `turn.completed`, and failed Attention only from `turn.failed`. Tool failure and interruption do not imply failed work.

Approval Attention resolves only when the bound provider Approval is actually accepted or declined. Completed-review and failed items require an explicit review/acknowledgement mutation; reading or preloading a Conversation does not resolve them, and acknowledgement never changes the underlying Turn outcome. Host restart preserves review/failure work while expiring open Approval Attention because its provider request handle is no longer live.

**Phase 3D.2 — Real Inbox UI** is implemented and validated. `/inbox` is the global open Attention queue and uses Host summary counts, Host priority ordering, and only the three structurally supported types. Approval actions call the exact bound Approval endpoint; viewing completed work resolves review before navigation, while opening a failed Conversation does not acknowledge it. The Sidebar badge uses `summary.totalOpen`, and `attention.created` / `attention.resolved` keep browser clients synchronized. Read/unread, Activity, and structured questions remain unimplemented; Phase 4C later adds Desktop delivery without changing these Inbox semantics.

**Phase 3E.1 — Approval Interaction Layout Stabilization** is implemented and validated. A pending Approval is an actionable state, not the primary Timeline row: the Conversation Workspace keeps Header, Timeline, a bounded Pending Action Dock, and Composer as stable rows. The Timeline presents a compact non-interactive request marker while the Approval is actionable, then normal Tool and Turn outcomes retain the execution history; the Dock owns every exact Allow Once/Decline control, semantic command presentation, bounded details, multiple-Approval scrolling, and focus recovery. Approval appearance never forces a reader away from older Timeline history; an already-bottom reader remains bottom-anchored.

**Phase 4A — Tauri Desktop Shell Foundation** is implemented and validated. It packages `apps/web` and a revision-coupled Node SEA build of the existing Host into one Windows-first Tauri v2 application. Tauri owns application, window, and owned-child lifecycle. Product commands still use Protocol v1 HTTP/SSE, Host state and SQLite remain authoritative, and Browser mode remains supported.

**Phase 4B — Native Folder Picker** is accepted and frozen. Tauri 2.11.x uses the official Rust dialog plugin 2.7.2 behind one exact `pick_project_directory` capability. The command opens a single directory-only picker owned by the main window and returns only the selected Unicode path string or cancellation. React passes that value through the same Add Project mutation; it does not read the directory, infer a Project name, canonicalize the path, or grant workspace authorization. The Host remains the only Project authority.

Desktop and Browser share one Add Project dialog. Desktop presents folder selection and a selected-folder summary; Browser mode retains manual absolute-path entry without loading native code. When the global New Conversation flow has no available Project, it hands off to the same Add Project dialog and returns after Host registration.

**Phase 4C — Desktop Notifications** is implemented, and its required Windows development, production, and installed-NSIS validation has completed; Owner acceptance is pending. The running Desktop consumes `attention.created` as its only notification arrival source, applies preference, foreground-presentation, and Attention-ID deduplication policy, and delivers privacy-bounded Windows notifications through the official Tauri v2 notification boundary. Notification clicks restore/focus the existing single-instance window and route by CodeTether `projectId`, `conversationId`, `attentionId`, and type without changing durable Attention state. The minimal `/settings` surface persists its three default-on booleans as an application preference in the installed WebView origin, outside Project SQLite. This validation status does not mark Phase 4C accepted or frozen before Owner review.

Tray, closed-app delivery, notification history, remote/mobile/browser push, email/chat delivery, custom sounds, schedules, updater/signing, drag-and-drop, Project discovery/relocation, remote access, Machine management, and additional Agent providers remain unimplemented.
