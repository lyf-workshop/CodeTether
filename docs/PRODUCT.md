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

A durable logical workspace known to CodeTether. It has a CodeTether-owned identity, display name, and creation/update timestamps. The canonical authorized root and filesystem-derived availability belong to a Project Location on a specific Machine, so a future checkout on another Machine will not require a duplicate Project identity. Phase 6A still supports exactly one truthful local Location per Project.

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

A conversation belongs to exactly one Agent and one execution Machine. Codex conversations remain Codex conversations, and a Conversation created on one Machine cannot silently move to another; cross-agent handoff and Machine switching are intentionally unsupported.

### Agent

A supported coding-agent runtime/provider. Codex remains the established Provider; accepted Phase 5B preserves the deliberately restricted Claude Code capabilities proven through the same product model and real noninteractive interface. OpenCode remains deferred.

### Machine

A durable execution location where authorized Project workspaces and coding-agent sessions run. Phase 6A established one real local Windows Machine with a stable random CodeTether identity, accepted Phase 6B.1 adds real remote Machines through an explicit secure pairing flow, and accepted Phase 6B.2 keeps a trusted Node's cryptographic identity separate from its changing LAN endpoint. Phase 6B.3 allows a logical Project to register one durable Location on each trusted Machine, while remote coding-Agent execution remains unavailable. Machine identity is neither a network location, Host process identity, nor device fingerprint.

## Desktop Experience

Desktop is the primary environment for creating, supervising, and managing work. It should support:

- Navigating projects and conversations quickly.
- Reading conversation history and live agent output.
- Understanding reasoning, tool calls, terminal output, file changes, and diffs.
- Approving or rejecting risky actions with relevant context.
- Answering agent questions, interrupting work, and resuming tasks.
- Managing models, reasoning levels, permissions, and machines when those capabilities become available.

Conversation Detail is the product's most important future screen and should receive the strongest interaction and information-design attention.

Phase 4A packages the accepted local workspace as one Windows-first CodeTether Desktop application. Launching Desktop owns the local Host lifecycle and loads the same Web UI; users no longer need to understand separate Host and Vite processes for the packaged product. Phase 4B adds one explicit native convenience to that shell: Desktop users can choose a Project directory with the Windows folder picker. The accepted Phase 4C lets the same running Desktop deliver new durable Attention through Windows notifications and return the user to the exact Conversation. The accepted Phase 4D refines that shared product UI for sustained Desktop use without changing these ownership boundaries. The accepted Phase 4E.1 adds durable Conversation organization, accepted Phase 4E.2 connects that truth to the shared Desktop/Browser UI, and accepted Phase 4F.1/4F.2 add durable Project-scoped Search from Host through the shared List and Rail. Accepted Phase 4G.1 separates main-window visibility from the running Desktop/Host lifecycle through one minimal System Tray; accepted Phase 4G.2 hardens the same Windows-owned lifecycle across sleep/resume, session end, crash, and Explorer tray recovery without adding Desktop-native product-state authority. Accepted Phase 5A/5B do not alter that frozen lifecycle: the Host owns both Provider adapters, and Claude Code children naturally remain inside the same managed process tree. Phase 6A adds Host-owned durable Machine and Project Location truth without changing Rust/Tauri lifecycle behavior or adding a native command. The shell still does not own Machine, Project, Conversation, Approval, Inbox, Attention, organization, Search, or Provider truth and does not expose general native shell/filesystem power to the Web UI.

## Mobile Experience

Mobile is a companion, not a miniature desktop application. Its primary jobs are:

- **Monitor** current status and recent progress.
- **Approve** or reject pending operations safely.
- **Reply** to agent questions or provide short guidance.
- **Resume** a paused or waiting conversation.

Dense code review, project setup, and complex configuration remain desktop-first. Mobile screens should prioritize urgency, legibility, and quick completion.

## Product Areas

### Projects

Projects organize codebases and provide the stable logical authorization context for Conversations. The local Host owns durable Project identity plus its Machine-scoped Project Locations, canonical root authorization, computed availability, and mutation results; the Web UI renders those records and never becomes a competing authority. One logical Project may have at most one Location on each Machine. The Projects surface lists real registrations, adds a local root with an optional display name, shows every registered Location, and removes only an unreferenced CodeTether registration after explicit confirmation. Desktop acquires a local root through one native directory picker, while standalone Browser mode retains manual absolute-path entry. A remote Location is registered only after the already trusted and online Node validates the supplied absolute directory and returns its canonical real path through the purpose-specific authenticated transport operation. A Conversation references one Project and its exact Machine, and may use a working directory contained within that Machine's authorized Location. Filesystem availability can change independently of durable identity, so unavailable history remains readable but Agent control fails closed. Project discovery/scanning, Location removal/relocation, synchronization, drag-and-drop, and recent folders remain future work.

### Conversations

Conversations organize Agent sessions, history, supported model/reasoning/permission choices, current status, Machine, and Project. They should make live and historical work easy to follow. A single Conversation never moves between Providers or Machines. CodeTether owns the durable public Conversation, Machine, and Provider identity; the Codex Thread or Claude Code session identity remains private Host metadata used to continue that same Provider context after a restart.

Within a Project, an empty Search field browses the ordinary active or archived Conversation index. A nonempty query searches all durable Conversation titles and canonical User inputs in that scope through the Host rather than filtering only the summaries already loaded in the browser. The query and active/archived view are URL state so refresh, Back/Forward, and deep links preserve the discovery context. Results explain whether the title or something the user previously asked matched and may show the durable public Agent; they do not expose a ranking score, full Prompt, private Provider session identity, or database detail.

Search remains bounded and explicit: it requests 25 results at a time and loads another opaque-cursor page only when the user asks. An input match may navigate using the existing public Turn focus hint. If that Turn is older than the retained Conversation detail, CodeTether opens the real Conversation and explains that the matching history segment is not loaded; Search does not hydrate an owning Provider or invent older-Turn pagination.

### Agents

Agents expose detected Providers and explicit capabilities through a unified experience. Provider-specific protocol details must not leak into product UI. Codex advertises the established control surface. Claude Code truthfully advertises its restricted read/search Tool and native-session streaming/resume path plus the installed CLI's real effort control under the Provider-labelled “思考强度” UI. Approval, reliable interrupt, edit, shell, Diff, and model selection remain absent because Phase 5B did not prove a safe product contract for them. OpenCode remains deferred.

The Host detects Provider availability once per lifecycle and presents actionable states—available, not installed, unsupported version, misconfigured, or temporarily unavailable—without exposing executable paths or CLI diagnostics. This descriptor is a bounded startup capability snapshot rather than a continuously probed health signal; a later Provider failure still fails the exact mutation with a canonical safe error. New Conversation chooses one available Agent and stores that identity durably. Existing Conversations display their owning Agent but never offer Provider switching, handoff, delegation, or history replay into another Agent.

Codex and Claude Code Conversations coexist inside the same Project, Conversation index, Rail, organization controls, durable title/User-input Search, Inbox, and notification flow. These product reads and metadata mutations stay cold and never launch either CLI. The same bounded Runtime working set applies across both Providers; a real Turn is the point at which the Host creates or resumes the Conversation's native Provider session.

The Claude Code execution profile remains intentionally safe and minimal. Canonical User input travels to the CLI through stdin rather than a shell command. Only Read, Glob, and Grep are admitted in its noninteractive `dontAsk` profile; text streaming and identity-preserving structured Tool activity are normalized into the existing Timeline, while unrecognized or unavailable Tools remain generic. Phase 5B can normalize observed Edit/Write paths defensively, but Edit capability remains false; unexpected Bash/PowerShell envelopes fail closed as Generic Tool without publishing their command. The production launch allowlist still prevents Edit and Shell execution. Restricted execution receives only an allowlisted, private projection of required operating-system/network context plus the user's Claude authentication/endpoint/model configuration. CodeTether does not load or copy ordinary hooks, plugins, MCP, or Project settings, while acknowledging that Claude's own managed-policy settings may still apply. Unrelated Host environment values are absent. CodeTether does not silently grant write/shell access or manufacture an Approval flow that the CLI integration cannot represent reliably.

### Machines

Machines show real execution locations and trusted future execution locations. Phase 6A exposes the real `本地电脑`: its safe Windows/architecture identity, implemented product capabilities, actual Provider availability, registered Project Locations, and recent Conversations. Accepted Phase 6B.1 adds remote Node identity, trust, and reachability; accepted Phase 6B.2 adds secure address recovery without changing that identity. Phase 6B.3 lets a trusted remote Machine validate and own durable Project Location metadata. Each local or remote identity is random and durable in its own CodeTether data root, survives ordinary restart/update/reboot, and is independent from hostname, IP, hardware identifiers, and process identity. Removing a Node data root intentionally creates a new identity.

The Machines surface shows only real durable Machines. A user can pair a remote CodeTether Node by manually entering its LAN address and one-time code, confirm the presented identity, observe authenticated connection state, recover an offline trusted Node by supplying a new address, inspect logical Projects registered on that Machine, and explicitly unpair only while it has no Project Locations. A remote Project Location can be removed separately from Project Detail when no durable Conversation is bound to that Project/Machine pair; this removes only Controller-owned registration metadata, works while the Machine is offline, and never deletes remote files, the logical Project, the Machine, or trust. The new address is only remembered after the already pinned peer, Machine, and Node identities authenticate successfully; an address mismatch never replaces trust or creates a Machine. A trusted remote Machine advertises Project access for the narrow directory-validation and Location-registration flow but no Provider execution. The surface still has no resource charts, SSH, remote Terminal, remote Providers, ports, services, or invented execution capability. Reading, reconnecting, and Location registration/removal never start Codex or Claude Code. New Conversation continues to offer only Machines with both a real available Project Location and Provider execution capability.

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

Each new `attention.created` event may produce one Windows notification while CodeTether Desktop and its owned Host are running, including while the main window is hidden in the System Tray. Snapshot, restart, reconnect reset, and durable Inbox reconstruction do not create notifications. The native copy contains only a short type-specific message plus a clamped Project name and Conversation title; it excludes prompts, commands, paths, output, diffs, Agent text, raw errors, and provider identities.

A focused, visible Desktop suppresses the notification only when the Inbox or exact affected Conversation already presents the Attention. A hidden, minimized, or unfocused window remains background. Clicking a delivered notification uses the same existing-window restoration path as the Tray and second-instance activation, then opens the Conversation, but never approves, resolves, reviews, acknowledges, or retries the work. Three application preferences control Approval, completed-review, and failed notifications independently and default on. Browser mode has no native delivery and continues to rely on Inbox.

### Background Runtime

CodeTether Desktop now distinguishes its main window from the application and managed Runtime. X and Alt+F4 hide the main window to the Windows System Tray while the Desktop process, owned Host, running Provider work, pending Approval, Attention stream, and notification delivery continue. Ordinary minimize remains ordinary Windows minimize. The Tray uses the CodeTether icon and exposes only Open and explicit Quit; its left click also restores the existing main window. Reopening the installed executable while hidden restores that same single instance rather than starting another Host.

Only `退出 CodeTether` performs normal product shutdown. It gives the owned Host up to 12 seconds to complete its established graceful HTTP/SSE, admitted-mutation, SQLite, Approval, Runtime, and owning-Provider drain before terminating only the owned process tree. Hiding a window never manufactures restart, interruption, or Approval-expiry semantics. The first successful close-to-tray attempts one explanation after persisting a versioned Desktop preference outside Project SQLite. Settings contains a compact Desktop-only explanation, not a behavior toggle. Standalone Browser lifecycle is unchanged and has no Tray surface.

Windows sleep suspends the Desktop lifecycle without shutting down or forcibly restarting the owned Host. Each resume cycle performs one bounded check that the exact owned Host process still presents the expected Protocol, build, and Host epoch, then asks the existing Web HostRuntime to reconnect its one SSE stream through the ordinary cursor/reset path. A transiently unresponsive but still-owned Host is not killed or replaced; a changed/exited/incompatible Host enters the existing visible failure and cleanup boundary rather than an automatic restart loop.

Windows session end has a deliberately different contract from Tray Quit. `WM_QUERYENDSESSION` records only an in-memory state and returns promptly, so cancellation can restore normal hide/restore behavior without side effects. Confirmed `WM_ENDSESSION` receives a 2-second best-effort bounded owned-Host termination attempt before OS teardown proceeds; it is not promised the ordinary 12-second graceful interval. Abnormal Desktop loss relies on the Windows Job Object to remove the owned Host/Provider process tree, and the next Host launch applies the established durable restart reconciliation. Explorer tray recovery is delegated to the pinned Tauri/`tray-icon` implementation rather than a second CodeTether tray watcher or lifecycle owner.

## Future Remote Access

CodeTether should eventually allow a web or mobile client to connect securely to a user's machine host over a trusted network, initially local network or Tailscale-style connectivity. Remote clients should be able to monitor work and issue authorized control actions while execution and project access remain on the user's machine.

Public cloud relay is not part of the current plan. Remote architecture must preserve explicit machine trust, authentication, authorization, and auditability.

## V1 Priorities and Boundaries

V1 remains **Codex-first**. Accepted Phase 5A/5B validate that the same product entities and canonical control boundary can host one deliberately restricted second Provider. Phase 6A makes the execution Machine explicit while retaining only the current local Windows machine.

Explicitly deferred:

- Claude Code machine-readable Approval, edit/shell permission policy, Diff, reliable interrupt, and account-valid model selection. Claude effort is supported, but it is not claimed to be semantically identical to Codex reasoning.
- OpenCode integration.
- Provider switching, handoff, delegation, or transcript replay between existing Conversations.
- Teams and shared organizational workspaces.
- Enterprise administration and policy features.
- Cross-agent conversation handoff.
- Public cloud relay.
- SSH, LAN discovery, remote Projects/Providers/files/Terminal/shell, file or Git synchronization, port forwarding, Wake-on-LAN, relay, and fake remote Machines.
- Moving an existing Conversation between Machines or adding a second Location to a Project.

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

At the Phase 3C.2 boundary, the real list showed only supported providers and known metadata, performed local title/provider filtering over at most the latest 100 summaries, and had no archive, rename, delete, or older-history pagination UI. `/conversations/demo` remains a development-only visual fixture. At that boundary there was no Project discovery/scanning, native folder picker, rename/relocate, Tauri functionality, remote access, authentication, multi-Machine Project location model, or non-Codex provider integration. Later organization and Search-backend phases are described below; see [`ROADMAP.md`](ROADMAP.md) for current phase gates and verified constraints.

**Phase 3D.1 — Durable Attention Model** is implemented and validated. Attention is not a new core product entity: it is the durable, user-facing actionable/review state produced by a Project Conversation. The Host creates exact Approval Attention from `approval.requested`, completed-review Attention from `turn.completed`, and failed Attention only from `turn.failed`. Tool failure and interruption do not imply failed work.

Approval Attention resolves only when the bound provider Approval is actually accepted or declined. Completed-review and failed items require an explicit review/acknowledgement mutation; reading or preloading a Conversation does not resolve them, and acknowledgement never changes the underlying Turn outcome. Host restart preserves review/failure work while expiring open Approval Attention because its provider request handle is no longer live.

**Phase 3D.2 — Real Inbox UI** is implemented and validated. `/inbox` is the global open Attention queue and uses Host summary counts, Host priority ordering, and only the three structurally supported types. Approval actions call the exact bound Approval endpoint; viewing completed work resolves review before navigation, while opening a failed Conversation does not acknowledge it. The Sidebar badge uses `summary.totalOpen`, and `attention.created` / `attention.resolved` keep browser clients synchronized. Read/unread, Activity, and structured questions remain unimplemented; Phase 4C later adds Desktop delivery without changing these Inbox semantics.

**Phase 3E.1 — Approval Interaction Layout Stabilization** is implemented and validated. A pending Approval is an actionable state, not the primary Timeline row: the Conversation Workspace keeps Header, Timeline, a bounded Pending Action Dock, and Composer as stable rows. The Timeline presents a compact non-interactive request marker while the Approval is actionable, then normal Tool and Turn outcomes retain the execution history; the Dock owns every exact Allow Once/Decline control, semantic command presentation, bounded details, multiple-Approval scrolling, and focus recovery. Approval appearance never forces a reader away from older Timeline history; an already-bottom reader remains bottom-anchored.

**Phase 4A — Tauri Desktop Shell Foundation** is implemented and validated. It packages `apps/web` and a revision-coupled Node SEA build of the existing Host into one Windows-first Tauri v2 application. Tauri owns application, window, and owned-child lifecycle. Product commands still use Protocol v1 HTTP/SSE, Host state and SQLite remain authoritative, and Browser mode remains supported.

**Phase 4B — Native Folder Picker** is accepted and frozen. Tauri 2.11.x uses the official Rust dialog plugin 2.7.2 behind one exact `pick_project_directory` capability. The command opens a single directory-only picker owned by the main window and returns only the selected Unicode path string or cancellation. React passes that value through the same Add Project mutation; it does not read the directory, infer a Project name, canonicalize the path, or grant workspace authorization. The Host remains the only Project authority.

Desktop and Browser share one Add Project dialog. Desktop presents folder selection and a selected-folder summary; Browser mode retains manual absolute-path entry without loading native code. When the global New Conversation flow has no available Project, it hands off to the same Add Project dialog and returns after Host registration.

**Phase 4C — Desktop Notifications** is implemented, validated, accepted, and frozen. The running Desktop consumes `attention.created` as its only notification arrival source, applies preference, foreground-presentation, and Attention-ID deduplication policy, and delivers privacy-bounded Windows notifications through the official Tauri v2 notification boundary. Notification clicks restore/focus the existing single-instance window and route by CodeTether public identities without changing durable Attention state. The minimal `/settings` surface persists its three default-on booleans as an application preference in the installed WebView origin, outside Project SQLite.

**Phase 4D — Desktop Product Polish & Dogfooding** is implemented, validated, accepted, and frozen. Long Conversation presentation now groups only adjacent routine completed Tool work and expands back to every original row, while failures, tests, Approvals, and file changes remain prominent. Agent messages render a deliberately small safe Markdown subset without raw HTML or remote images, and reliably Project-contained absolute paths are shortened only for display. Inbox and notification navigation can target a public Turn without resolving Attention, and Inspector file selection locates the corresponding Timeline Diff. Header, Rail, Composer, Project, Sidebar, error, and Settings surfaces are denser and more truthful: unsupported controls and placeholder navigation are hidden, long titles and paths stay bounded, and implementation terms such as Host and Runtime no longer dominate normal user copy.

**Phase 4E.1 — Durable Conversation Organization Model** is accepted and frozen at `afac51a`. Every durable Conversation has a `generated` or `manual` title source plus optional Pin and Archive timestamps. Manual Rename, Pin/Unpin, and Archive/Unarchive are durable, action-idempotent Host mutations exposed by additive Protocol v1 contracts and typed Client methods. They preserve Project, Conversation, Turn, Attention, provider Thread, and `lastActivityAt` identity; changed metadata publishes one low-frequency `conversation.updated` summary.

Active history defaults to non-archived Conversations, with pinned work first and stable activity/identity ordering. Archived history remains readable but cannot start a Turn until explicit Unarchive; archive is rejected for running, starting, waiting, or open-Approval work, and archiving atomically clears Pin. Completed-review and failed Attention remain navigable even when their Conversation is archived. Manual titles are normalized and bounded without silent truncation, and first-input title generation cannot replace a manual title. Lightweight Project/title and ordering indexes make the metadata search-ready at local scale without adding FTS or a Search product surface.

**Phase 4E.2 — Conversation Organization UI** is accepted and frozen at `84de855`. The real Project Conversation page separates active and archived history through URL state and distinct Host-backed queries. Active history preserves Host-owned Pin/activity ordering and exposes only Rename, Pin/Unpin, and confirmed Archive; archived history exposes Rename and explicit Restore. Rename, Pin, Archive, and Unarchive update the List, Rail, Header, Breadcrumb, and Detail from typed mutation results plus low-frequency `conversation.updated` synchronization rather than local organization state.

Archived Conversation Detail remains fully readable, clearly separates archived organization state from execution status, disables Turn composition before input, and provides explicit Restore. The normal Rail remains an active-history surface while adding only the currently viewed archived Conversation as bounded context. Inbox and notification routes can still open archived history without restoring or resolving it, and viewing or organizing a cold Conversation does not start or resume its owning Provider.

At its frozen boundary, Phase 4E.2 added no full-history or global Search, FTS/semantic indexing, pagination, Delete, bulk actions, tags, folders, groups, drag ordering, Activity, tray/background runtime, remote operation, or another provider.

**Phase 4F.1 — Durable Conversation Search Model & API** is accepted and frozen at `38481ad`. Search is a Project-scoped SQLite read over two explicit durable sources: the current Conversation title and each Turn's canonical User input. Migration 006 transactionally backfills a small normalized projection and keeps it synchronized with source writes. It never indexes or queries Agent messages, Tool/Terminal output, Diff bodies, Approval commands, provider payloads, or `snapshot_json`.

Matching is predictable textual substring matching after NFC normalization, Unicode lowercasing, Unicode-whitespace collapse, and trim. It is neither fuzzy nor semantic and does not apply compatibility or accent folding. Exact title, title prefix, title substring, and User-input matches form deterministic rank tiers; each Conversation appears once, and input matches include only a bounded plain-text preview and public Turn identity. Active/archived/all, provider, and execution-status filters remain distinct, and opaque cursor pagination defaults to 25 results with a maximum of 100.

`GET /api/v1/projects/:projectId/conversations/search` and the typed `searchProjectConversations()` Client method expose this read without checking Project filesystem availability, parsing presentation snapshots, hydrating a cold Conversation, launching Codex, or resuming a provider Thread.

**Phase 4F.2 — Search UI & History Discovery** is accepted and frozen at `545db8c`. The real Project Conversation List and Rail enter durable Search mode for a nonblank URL-backed query and remain in ordinary Browse mode when it is blank. Search requests are debounced by 250 ms, isolated by Project/query/archive/provider/status TanStack Query identity, cancellable through AbortSignal, and paged by an explicit Load More control. Active and archived search share the query text but call their exact Host partitions; React neither searches the loaded 100-row index nor re-ranks Host results.

Title matches are identified without manufacturing relevance scores; canonical-User-input matches show only the Host-bounded plain-text preview as the reason they appeared. The List and compact Rail preserve real Pin/Archive/status metadata and their existing organization actions. Mutation results and low-frequency `conversation.updated` invalidation make matching results enter, leave, or rerank across clients. Public Turn focus is reused when available, while an older non-retained match opens the Conversation with the existing safe history-boundary explanation. Search itself remains a local durable read and never starts or resumes Codex.

At its frozen boundary, Phase 4F.2 adds no Agent/Tool/Terminal/Diff search, semantic or cross-Project/global Search, history pagination, Search history/analytics, native capability, background runtime, or additional provider.

**Phase 4G.1 — System Tray & Background Runtime Foundation** is accepted and frozen at `cee3a71`. The Rust shell creates one tray only after Host readiness, intercepts main-window X/Alt+F4 as hide, and retains ordinary minimize semantics. Tray click, Tray Open, notification activation, and hidden single-instance activation share one bounded `show_main_window` path that unminimizes, shows, and focuses the existing ready window while refusing restoration after Quit begins.

Tray Quit is guarded for idempotency and gives the existing graceful Host/SQLite/Codex shutdown up to 12 seconds before removing the tray and exiting. A first-hide education marker is Desktop-owned and versioned, and the shared Settings tree exposes only a Browser-safe capability-gated explanation. No Tauri Web command, filesystem/shell/process permission, product database, Attention projection, or second notification system is added.

**Phase 4G.2 — Windows Session & Background Reliability** is accepted and frozen at `f576b05`. Sleep records suspension and never forces a Host restart. One bounded owned-Host identity check runs per resume cycle, after which the existing SSE consumer reconnects with its canonical cursor and normal Snapshot/reset rules. Session-end query is memory-only; cancellation restores the prior lifecycle, while confirmation receives a separate 2-second best-effort bounded termination attempt. Crash cleanup remains the Windows Job Object plus durable restart reconciliation, and Explorer tray recovery remains the pinned Tauri/`tray-icon` responsibility. Its evidence boundary remains unchanged: real raw-release Sleep/Wake, pending Approval, Explorer, soak, and installed baseline observations are distinct from simulated message cycles and unobserved real logoff/shutdown, dedicated Win+L, provider-network-change, active-Turn-at-suspend, and installed-runtime-across-Sleep boundaries.

**Phase 5A — Second Provider Foundation: Claude Code** is accepted and frozen at `a1329f2`. Protocol v1 models durable `codex | claude-code` Provider identity, presentation-safe detection/capabilities, provider-neutral Tool kinds, and bounded canonical Provider errors. Migration 007 safely widens existing Codex-only persistence. The Host owns one Provider registry and routes the existing create/Turn/interrupt/read/organization/Search surfaces to each Conversation's immutable Provider while preserving one shared hydration budget. The accepted Claude Code adapter safely detects the CLI, uses its native session create/resume identity, sends Prompts through JSONL stdin with structured process arguments, and normalizes text and high-confidence Tools into the existing event model.

**Phase 5B — Claude Code Capability Expansion** is accepted and frozen at `5dac13c`. The installed Claude Code `2.1.251` boundary provides stable structured identities for Read, Glob, Grep, Edit, Write, and Bash plus a real `--effort` option. CodeTether enriches canonical Tool presentation from those structured envelopes and exposes only the Host-owned Claude effort choices. Its production launch remains Read/Glob/Grep-only. Approval, reliable interrupt, edit, shell, Diff, and model selection stay unsupported because no safe and complete product boundary was proven; unsupported capabilities are not simulated for UI symmetry.

**Phase 6A — Durable Machine Foundation** is accepted and frozen at `0858fc7`. It adds one durable canonical local Machine, Machine-scoped Project Locations, required immutable Conversation `machineId`, machine-scoped Provider composition, strict Machine list/detail APIs, and real Machines/New Conversation/Project/Conversation presentation.

**Phase 6B.1 — Remote Node Identity & Secure Pairing** is accepted and frozen at `30559a3`. It adds a minimal CodeTether Node, stable remote and cryptographic identity, explicit one-time expiring pairing, user confirmation, durable pinned trust, authenticated LAN reconnect, truthful online/offline state, and pair/unpair UI.

**Phase 6B.2 — Secure Connection Recovery & Address Mobility** is accepted and frozen at `53e7c21`. It adds a bounded private set of authenticated endpoint hints, one cancellable reconnect coordinator per trusted Machine, and a manual address recovery action that authenticates existing trust before promotion. It deliberately adds no discovery shipment, remote Project Location, Conversation, Provider, Turn, Terminal, filesystem, shell, relay, or public-Internet behavior.

**Phase 6B.3 — Remote ProjectLocation** is the current approved implementation phase; it is not yet accepted or frozen. It uses the existing version-10 `project_locations` schema without a new migration so Host SQLite can own one durable canonical Location per Project/Machine. The trusted Node exposes only a purpose-specific authenticated absolute-path, `realpath`, and existing-directory validation operation. Remote Machines advertise Project access but not Provider execution. An explicit remote-Location removal deletes only the exact Host-owned association, rejects the canonical local Location and any pair referenced by durable Conversations, and permits the existing authenticated Unpair flow only as a later separate action. Remote Conversation execution, generic filesystem access, Location relocation, synchronization, discovery, and relay remain absent.

Start with Windows, tray Attention badges/counts, recent-item tray menus, close-behavior settings, notification delivery after explicit Quit, notification history, remote/mobile/browser push, email/chat delivery, custom sounds, schedules, updater/signing, automatic Host restart, drag-and-drop, Project discovery, Project/Location relocation, synchronization, remote execution/control, discovery shipment, relay, OpenCode/third Providers, cross-Provider handoff, and Claude capability parity remain unimplemented.
