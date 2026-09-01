# CodeTether V2

## Product

CodeTether is a desktop and mobile workspace for managing AI coding agents. Its goal is to become **a control center for AI coding agents**: one place to manage projects, conversations, agents, machines, approvals, changes, terminals, context, and notifications without separately operating each provider's CLI.

The desktop experience is the primary environment for development and management. Mobile is a focused companion for monitoring, approving, replying, and resuming; it is not a scaled-down desktop UI.

## Product Principles

- Build an AI coding workspace, not an admin panel, CRUD system, or generic enterprise dashboard.
- Make the agent's work inside the user's project the center of the experience.
- Treat frontend quality as core product value: clear, fast, fluid, consistent, professional, and suitable for long daily sessions.
- Keep information dense but calm. Preserve hierarchy and make current agent state obvious.
- Optimize desktop for deep control and mobile for quick intervention.
- A conversation belongs to exactly one agent in the current product model. Do not implement cross-agent handoff.
- Prefer a Codex-first V1 while preserving provider-neutral boundaries for later adapters.

## Source of Truth

- **Figma** is the sole source of truth for UI design. Implement approved designs faithfully; do not redesign them in code.
- [`docs/PRODUCT.md`](docs/PRODUCT.md) is the source of truth for product behavior and scope.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) is the source of truth for system boundaries and technical architecture.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) is the source of truth for phase order and exit gates.

If sources conflict, stop and resolve the conflict instead of inventing a compromise. Keep these documents updated when an approved decision changes.

## Current Scope

**Phase 6C.3 — Remote Claude Code Execution Foundation** is the current approved implementation scope; it is not yet accepted, frozen, or declared ready. Phase 6C.2 is accepted and frozen at `0b60dc6`, Phase 6C.1 is accepted and frozen at `466d63c`, Phase 6B.3 is accepted and frozen at `11c652c`, Phase 6B.2 is accepted and frozen at `53e7c21`, Phase 6B.1 is accepted and frozen at `30559a3`, Phase 6A is accepted and frozen at `0858fc7`, Phase 5B is accepted and frozen at `5dac13c`, Phase 5A is accepted and frozen at `a1329f2`, Phase 4G.2 is accepted and frozen at `f576b05`, Phase 4G.1 is accepted and frozen at `cee3a71`, Phase 4F.2 is accepted and frozen at `545db8c`, Phase 4F.1 is accepted and frozen at `38481ad`, Phase 4E.2 is accepted and frozen at `84de855`, Phase 4E.1 is accepted and frozen at `afac51a`, and Phase 4D, Phase 4C, Phase 4B, Phase 4A, Phase 3E.1, and the **CodeTether Local Workspace Alpha** remain frozen. Protocol v1 remains the only Web ↔ local Host product boundary, and durable Machine/Project-location/Conversation/Turn/Attention data remains authoritative. Phase 6C.3 extends the accepted remote execution path only to the frozen restricted Claude Code profile: streaming, native resume, Read, Glob/Grep search, canonical Tool events, and Provider-native effort. Edit, Write, Shell, Diff, Approval, interrupt, model selection, generic process/filesystem access, synchronization, discovery expansion, and relay remain absent. The current implementation boundary includes:

- A Project as a durable logical workspace with a CodeTether-owned `proj_*` identity, name, and timestamps. Its authorized roots and availability belong to durable Machine-scoped Project Locations rather than to the Project identity itself; there is at most one Location for each Project/Machine pair.
- One canonical durable local Machine with a random CodeTether-owned `machine_*` identity, safe display/platform/architecture metadata, product-level capabilities, and no hardware fingerprint, Host PID, username, network address, or raw operating-system identifier.
- SQLite migration 008 (`machine_foundation`), which transactionally creates the one local Machine, moves every existing Project root into `project_locations`, and backfills every existing Conversation with the same immutable `machine_id` while preserving Provider/session identity, Turns, Attention, Search, and organization metadata.
- Protocol v1 and `packages/client` expose strict Machine list/detail reads. Machine detail composes the real machine-scoped Provider descriptors, registered Project Locations, and bounded recent Conversations without starting or resuming either Provider.
- Every new Conversation explicitly selects a real `machineId`, `projectId`, and immutable Provider. The selected Project must have an available authorized Location on that Machine, and the selected Provider must be available there; neither Machine nor Provider can be switched afterward.
- A real `/machines` list and `/machines/:machineId` detail surface show only real local and trusted remote Machines. Local detail composes actual Providers, Projects, and recent Conversations; remote detail truthfully shows registered Projects plus current/last-known/not-observed Provider discovery. New Conversation may select remote Codex or restricted remote Claude Code only while exact Machine/Location/current tested execution gates pass; every Conversation surface shows its immutable owning Machine without a switch control.
- A separately launched CodeTether Node owns a random durable remote Machine identity and cryptographic identity. Beyond the frozen pairing, authenticated status, heartbeat, endpoint-recovery, Project Location validation, trust-revocation, Provider-description, and Codex execution protocol, Phase 6C.3 adds one closed Claude session/Turn message family. It can run only the Node-owned restricted Read/Glob/Grep profile and cannot accept executable, arbitrary argv, environment, model, arbitrary cwd, filesystem command, shell, Terminal, Approval, interrupt, or generic RPC input.
- Pairing is explicit and two-step: the Node enables a one-time expiring short code, the Desktop submits a manual LAN address plus code, and the user confirms the presentation-safe Machine identity before trust is committed. Reconnect authenticates pinned peer identities and never reuses the pairing code.
- Remote Machine records are durable, while online/offline/authentication/incompatibility state remains truthful connection state. A trusted remote Machine advertises `projectAccess: true` for bounded Location registration. It advertises `providerExecution: true` only when at least one current authenticated descriptor matches an exact admitted Node execution profile; provider-specific Conversation eligibility remains separate, and reads never hydrate Providers.
- SQLite migration 009 (`remote_machine_trust`) admits only real remote Machine identities and their private pinned trust without changing the accepted local graph. Migration 010 (`remote_machine_endpoints`) separates location hints from that cryptographic trust, transactionally backfills the accepted endpoint, and enforces one preferred bounded endpoint set per trusted Machine.
- Accepted Phase 6B.3 requires no SQLite migration: the existing version-10 `project_locations` schema already owns durable Locations in Host SQLite and enforces one row per Project/Machine plus unambiguous canonical-path ownership on a Machine. Accepted Phase 6C.1 migration 011 stores only authenticated presentation-safe remote Provider descriptors and their observation timestamp. Phase 6C.2 and Phase 6C.3 need no migration because the existing private Provider session identity, immutable Machine/Project binding, and durable reasoning field already own remote resume truth; executable paths, environment, raw output, diagnostics, and credentials are never persisted.
- Registering the same Project/Machine/canonical path is idempotent. A different path for the same pair or the same canonical path claimed by another Project fails closed. An explicit remote ProjectLocation removal deletes only the exact Controller-owned association, rejects the canonical local Location and any Project/Machine pair used by durable Conversations, works while the remote Machine is offline, and leaves Project, Machine, trust, remote files, and Providers untouched. Project relocation remains absent, and unpair stays blocked until all Locations are explicitly removed.
- Trusted peer identity remains cryptographic and independent from location. A bounded private endpoint set remembers only previously authenticated addresses; one per-Machine coordinator tries the preferred and fallback endpoints with bounded jittered backoff. A manual candidate is promoted only after the existing pinned TLS, Machine, and Node identity checks succeed, while mismatch leaves trust and endpoint preference unchanged.
- SQLite migration 002 (`projects`), which adds the `projects` table and binds every durable Conversation to one Project through a non-null `project_id` foreign key. The Conversation `cwd` remains a contained working directory, not a second Project identity.
- Protocol v1 Project list, read, create, and delete commands plus Project-aware Conversation creation by `projectId`.
- Idempotent Project registration by canonical root: creating the same authorized root returns the existing Project instead of duplicating it.
- Real-path authorization at registration and again before every new Turn or provider resume. A missing, moved, or identity-changed root leaves durable history readable but makes workspace-dependent control fail with `project_unavailable`.
- Durable authorization across Host restarts and lazy Codex Thread resume only after the saved Project root and Conversation working directory are revalidated.
- Registration-only deletion: CodeTether never deletes workspace files, never cascades Conversation history, and rejects Project deletion while any durable/runtime Conversation references it or a Conversation creation has reserved it.
- A deprecated Protocol v1 `cwd` compatibility request that may resolve only to an already registered, available Project; it cannot create a Project or expand the Host's trusted roots.
- A real `/projects` list and `/projects/:projectId` overview backed by the existing Host Project API through `packages/client` and TanStack Query.
- One shared Add Project flow with an optional name. CodeTether Desktop can acquire one directory path through the Windows native folder picker; standalone Browser mode retains manual absolute-path entry. Both paths submit the same typed Project mutation, and the Host remains the source of truth for canonicalization, authorization, availability, duplicate detection, and safe errors.
- Registration-only removal with an explicit confirmation, a specific `project_has_conversations` conflict state, and no filesystem deletion.
- Distinct loading, empty, Host-unavailable, not-found, available, and unavailable Project views using only real Project fields.
- A durable deterministic Conversation title and Project-scoped SQLite index, plus provider-independent single-Conversation reads and bounded lazy runtime hydration for cold history.
- A durable Provider identity with exactly `codex` or `claude-code` for the accepted Phase 5A boundary. A Conversation chooses its Provider at creation and never switches, hands off, or replays history into another Provider. Existing Codex records remain Codex records.
- Protocol v1 `ProviderDescriptor` discovery reports a presentation-safe availability state (`available`, `not_installed`, `unsupported_version`, `misconfigured`, or `unavailable`), tested/version metadata, and explicit capabilities for streaming, resume, interrupt, Approval, file/tool/diff, model-selection, and reasoning control. Executable paths, CLI diagnostics, raw Provider session objects, and Provider wire envelopes remain private.
- Remote Provider descriptors reuse that canonical vocabulary. The Node performs fixed `codex --version` and `claude --version` probes with `shell: false`, bounded time/output, isolated working directory, restricted environment, and exact child cleanup. Installation remains distinct from execution: current supported Codex may expose only remote `streaming` and `resume`, while current authenticated supported Claude Code may expose only `streaming`, `resume`, `fileRead`, `search`, `toolEvents`, and `reasoningControl`; the local `ProviderRegistry` never owns remote processes.
- One Host-owned `ProviderRegistry` maps durable Provider identity to the exact adapter. The ordinary Conversation-create, Turn-start, interrupt, Snapshot/SSE, Attention, organization, and Search APIs remain canonical; there are no `/codex/*`, `/claude/*`, or Provider-specific Client methods. Unknown Providers fail closed.
- SQLite migration 007 (`provider_foundation`) widens the durable Conversation Provider constraint from Codex-only to `codex | claude-code` while transactionally preserving Projects, Conversation organization, Turns, Attention, Search documents/triggers, private session identities, and existing Codex data.
- Local Codex, local Claude Code, remote Codex, and remote Claude Code share the same process-wide eight-Conversation hydrated working-set budget. Cold reads, Search, Rename, Pin, Archive, Unarchive, Machine/Project detail, and Location reads do not create or resume any Provider process; only Start Turn admits the bound Conversation and performs native Provider create/resume on its owning Machine.
- Remote Codex uses the existing ordinary Conversation/Turn/SSE/Attention APIs through a Machine-scoped runtime resolver. The Node revalidates the exact registered canonical root immediately before each Prompt, owns the exact App Server child, and exposes only normalized text plus terminal Turn state. Its tested fixed profile disables Tool/file/shell/network/MCP/plugin/hook/browser/computer surfaces, uses `never` Approval, keeps native thread identity private, and fails closed on any unexpected Provider notification or request. Transport loss never automatically replays a Prompt.
- Remote Claude Code uses those same generic Host APIs and Machine-scoped runtime resolver while keeping all Claude stream-json and native session details inside the Node/adapter boundary. The Node revalidates the exact registered canonical root immediately before each Prompt, owns an exact POSIX Provider process group, publishes only canonical text and Read/Search Tool lifecycles, and fails closed on unsupported Tool or malformed protocol output. Transport loss never automatically replays a Prompt.
- The Claude Code adapter performs one bounded Host-lifecycle detection of a safely resolved CLI and reports installed/auth/version state without exposing its path. It creates or resumes the Provider's native session identity, sends canonical User input over JSONL stdin with structured argv and `shell: false`, and normalizes streaming text plus structured, identity-preserving Read/Glob/Grep and bounded Edit/Write path envelopes into the existing Provider-neutral event model. Unexpected Bash/PowerShell and unknown Tools remain Generic without publishing a raw command. Only capabilities admitted by the public descriptor are executable through the product.
- Claude Code execution remains deliberately restricted in Phase 5B: machine-readable Approval, reliable interrupt, file edit, shell, Diff, and model selection are not advertised. The adapter keeps the noninteractive `dontAsk` profile with only Read/Glob/Grep Tools admitted. The installed CLI's real `--effort` primitive is exposed generically as Host-owned Claude “思考强度” options; it is not presented as semantic parity with Codex reasoning.
- Provider runtime failures are scoped to that Provider and translated to bounded canonical errors such as `provider_not_installed`, `provider_version_unsupported`, `provider_start_failed`, `provider_session_lost`, or `provider_unavailable`. One Provider failure does not fail live work owned by the other Provider, and raw CLI stderr is not product copy.
- SQLite migration 005 (`conversation_organization`), which adds required `title_source` plus nullable `pinned_at` and `archived_at` metadata and active/archived/title indexes without changing Conversation, Project, Turn, Attention, or private provider identity. Existing titles backfill as `generated`.
- Durable manual Rename, Pin/Unpin, and Archive/Unarchive Host mutations through additive Protocol v1 contracts and typed `packages/client` methods. Manual titles normalize NFC/whitespace and fail rather than truncate outside their wire/grapheme bounds; a manual title is never overwritten by first-input generation.
- Active Conversation ordering is pinned first (`pinnedAt DESC`), then `lastActivityAt DESC` and `conversationId ASC`; archived history is ordered by `archivedAt DESC` and identity. Archive atomically clears Pin and never advances `lastActivityAt`.
- Archived Conversation history and completed/failed Attention remain readable, but new Turn control fails with `conversation_archived` until explicit Unarchive. Running, starting, waiting, or open-Approval Conversations cannot be archived.
- Reliable low-frequency `conversation.updated` events carry only the public `ConversationSummary` after changed organization mutations. Cold organization writes update SQLite/public runtime metadata without hydrating or resuming the owning Provider.
- The real Project Conversation route expresses active or archived history in URL state, fetches the matching Host-owned index through distinct TanStack Query keys, and preserves Host ordering. Active rows expose bounded Rename, Pin/Unpin, and safe Archive controls; archived rows expose Rename and explicit Unarchive without inventing Delete, bulk actions, tags, folders, or local metadata.
- Real Conversation Detail and its Rail consume the same organization truth. Archived history stays readable with an explicit archived banner and disabled Composer plus Restore action, while the Rail keeps the active index and adds only the currently viewed archived Conversation as bounded context. Organization actions never hydrate a cold Conversation; only later Turn control may resume its owning Provider.
- `conversation.updated` drives low-frequency invalidation of active/archived indexes and detail so Rename, Pin, Archive, and Unarchive synchronize across List, Rail, Header, Breadcrumb, archived state, and multiple clients. No organization field is copied to Zustand, `localStorage`, or another React store.
- SQLite migration 006 (`conversation_search`) adds a normalized projection containing one title document per Conversation and one canonical User-input document per Turn. Existing durable titles and inputs backfill transactionally; triggers update the projection in the same source transaction after Conversation creation, generated/manual title changes, and durable Turn input writes. Snapshot JSON, Agent output, Tool/Terminal output, Diff bodies, Approval commands, and provider payloads are never indexed.
- Protocol v1 exposes strict Project-scoped `GET /api/v1/projects/:projectId/conversations/search` reads with active/archived/all, provider, and execution-status filters plus bounded cursor pagination. Results contain only a public `ConversationSummary`, an exact `title` or `user_input` match reason, and for input matches a bounded plain-text preview plus public `turnId`; private provider identities, working directories, full Turns, and SQLite details remain absent.
- Search matching is an explainable SQLite substring query over NFC-normalized, Unicode-lowercased, whitespace-collapsed projection text. Exact title, title prefix, title substring, and User-input matches form stable rank tiers; one Conversation appears once. Opaque cursors bind Project, normalized query, and filters. Search never reads `snapshot_json`, hydrates a cold Conversation, starts a Provider process, resumes a Provider session, or checks Project filesystem availability.
- `packages/client` exposes the typed `searchProjectConversations()` read with AbortSignal and route/filter/response validation. Blank Conversation search input still uses the ordinary Host index; a nonblank query uses this durable Search API rather than filtering the currently loaded 100 summaries.
- The Project Conversation route expresses Search text as `q` alongside its active/archived `view` URL state. Browse and Search remain separate TanStack Query modes; Search applies a 250 ms debounce, aborts stale requests, passes archive/provider/status filters to the Host, and appends explicit 25-result cursor pages only when the user chooses Load More.
- Conversation List and Rail share the same Project-scoped durable Search truth while retaining density appropriate to each surface. Results show the public Conversation summary and an honest title or canonical-User-input match explanation; they expose no ranking score, database identity, private provider identity, or full Prompt.
- A User-input match may reuse the existing public `?turn=<turnId>` focus contract. If that Turn is outside the bounded retained Conversation detail, navigation opens the real Conversation and presents the existing older-history boundary instead of fabricating content, loading `snapshot_json`, hydrating the Runtime, or resuming Codex.
- Rename, Pin, Archive, and Unarchive remain Phase 4E Host mutations. Their successful results and low-frequency `conversation.updated` events invalidate matching Search queries so multi-client results enter, leave, or rerank from Host truth; no Search result or organization field is copied to Zustand or browser storage.
- A real `/projects/:projectId/conversations` product history surface, real Project-derived Current Project context and breadcrumbs, and a real Conversation Rail driven by the durable index rather than Runtime Snapshot or Mock data.
- A capability-aware New Conversation dialog through the same typed Client boundary. A Project route locks its real Project; global entry requires one available Project. Codex preserves its existing Host-owned model/reasoning defaults and API capabilities, while Claude Code exposes only controls supported by its detected capability descriptor, including its Provider-labelled effort options when available.
- Real `/conversations/conv_*` routes read cold or live normalized history through one ViewModel, keep title/status/activity synchronized through low-frequency lifecycle events, and rely on Host-owned hydration and provider resume only when control begins.
- `/conversations` redirects to `/projects`; `/conversations/demo` remains a development-only visual fixture and is absent from real Project, list, Rail, Inbox, and TopBar navigation.
- SQLite migration 004 (`attention`) and a durable, Conversation-linked Attention index for exact Approval requests, completed Turns awaiting review, and failed Turns awaiting acknowledgement. Stable source keys prevent replay/restart duplication.
- Protocol v1 `GET /api/v1/attention` and explicit review/failure resolution, plus reliable `attention.created` / `attention.resolved` SSE events. Approval Attention can only be resolved through the bound Approval endpoint; pre-restart open Approval Attention expires and never recreates a provider request.
- A real `/inbox` global open-Attention surface backed by `packages/client` and TanStack Query, with Host-owned summary/order, exact Approval controls, explicit completed-review/failed resolution, semantic-event multi-client sync, stream-reset refetch, and a real Sidebar `totalOpen` badge.
- The real Inbox supports only Approval, completed-review, and failed-Turn work. It contains no Mock question/needs-reply, unread, mark-all-read, fake risk/response metrics, retry, provider, or Machine semantics.
- A Conversation Workspace with stable Header, independently scrolling Timeline, bounded Pending Action Dock, and mounted Composer rows. Actionable Approvals live in the Dock; Timeline Approval entries remain non-interactive history.
- Pending Approval presentation uses semantic command labels, exact `approvalId` controls, bounded details, independent mutation state, bottom-follow only for a reader already at the bottom, preserved upper-history position, and deliberate focus recovery.
- A Windows-first Tauri v2 application in `apps/desktop` that loads the existing `apps/web` component tree; Tauri is not a second product UI or business backend.
- One Desktop-owned Host sidecar built from the existing Node Host with the official Node Single Executable Application pipeline. The packaged Host carries the same revision-derived build identity as the Rust shell and does not require a system Node.js installation at runtime.
- A private Desktop-managed lifecycle mode. The Host waits for Rust's `start` activation before runtime initialization, so the supervisor can establish owned process-tree containment first. Rust requests normal graceful shutdown through a piped `shutdown` line and waits for Host persistence and Provider cleanup. The managed Host treats parent stdin EOF as another graceful-shutdown request; on abnormal Windows parent death, a Job Object guarantees owned process-tree cleanup but may win the EOF race before a full flush grace period.
- Single-instance Desktop startup, explicit `127.0.0.1:4317` conflict handling, `/api/v1/bootstrap` readiness/version checks, and no silent attachment to or termination of an external process.
- One Rust-owned System Tray created only after the managed Host passes readiness. Closing the main window with X or Alt+F4 prevents window destruction and hides it while the Desktop process, exact Host child, Provider work, SSE, durable Attention, and notification delivery remain running; ordinary minimize remains an ordinary Windows minimize.
- The tray uses the configured CodeTether application icon, a `CodeTether` tooltip, left-click restore, and only `打开 CodeTether` plus `退出 CodeTether`. One centralized `show_main_window` path unminimizes, shows, and focuses the existing ready window for tray activation, notification activation, and a second-instance launch; it never creates a second window or Host and refuses restoration once explicit quit begins.
- Tray Quit remains the only product exit: an idempotent guard gives the owned Host up to 12 seconds to complete its existing graceful HTTP/SSE, mutation, Runtime, SQLite, Approval, and owning-Provider drain, then terminates only the owned process tree if necessary. X and Alt+F4 remain hide-only and do not interrupt a running Turn or expire a process-live Approval.
- Windows sleep marks the Desktop lifecycle suspended without shutting down or forcibly restarting the exact owned Host. One recovery is admitted per resume cycle: Rust performs one bounded liveness plus Protocol/build/epoch identity check against that owned Host, then signals the existing Web HostRuntime to retire any half-open SSE connection and reconnect through its ordinary `Last-Event-ID` / Snapshot-reset path.
- `WM_QUERYENDSESSION` performs only an immediate in-memory lifecycle transition and permits Windows to continue; it does no Host or disk I/O. Cancellation restores the prior lifecycle state. A confirmed `WM_ENDSESSION` receives a separate 2-second best-effort bounded owned-Host termination path before Windows teardown proceeds.
- Abnormal Desktop/parent loss still relies on `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` to remove the owned Host/Provider process tree, with the established durable restart reconciliation converting incomplete Turns to interrupted history and expiring process-live Approvals on the next launch. There is no automatic Host restart.
- Windows Explorer tray recovery remains owned by the pinned Tauri 2.11.5 / `tray-icon` 0.24.2 handling. CodeTether does not add a polling tray watcher, a second tray, or another lifecycle owner.
- The first successful close-to-tray writes one versioned Desktop-owned education marker outside Project SQLite and attempts one privacy-safe native explanation. Settings exposes only a compact Desktop background-running explanation with no toggle; the centralized Browser-safe capability reports this surface unavailable in standalone Browser mode.
- Production Web assets loaded from the Tauri package, while the standalone Browser/Web workflow remains supported. Business traffic continues through Protocol v1 HTTP/SSE on loopback.
- A minimal native security boundary: Tauri 2.11.5 with the official Rust dialog plugin 2.7.2 and notification plugin 2.3.3 exposes only the exact Project-picker and bounded Attention-notification commands to the `main` window. The capability grants only event listen/unlisten, focused/minimized/visible window reads, and notification permission check/request beyond those application commands; it grants no generic notification send, filesystem traversal/read/write, shell, or process permission. Windows toast activation uses the pinned `tauri-winrt-notification` 0.7.3 boundary. Production CSP still permits network access only to the loopback Host, and the Host explicitly allows the verified Tauri production Origin without wildcard CORS.
- A centralized Browser-safe native capability adapter. Desktop uses the narrow directory picker; Browser mode never executes the Tauri adapter and continues to accept a manual absolute path.
- One controlled Add Project dialog shared by the Projects page, its empty state, and the global New Conversation handoff. When no available Project exists, the TopBar flow can add one and return to New Conversation without nesting modal dialogs or inventing a second Project creation path.
- A Desktop-only notification adapter behind the same centralized native-capability boundary. Only new `attention.created` events for Approval, completed review, and failed Turn may produce a native notification; Snapshot, Attention-query, restart, and `stream.reset` reconstruction never manufacture delivery.
- Privacy-bounded notification copy containing only the Attention type, Project name, and Conversation title. Prompt text, commands, paths, Terminal output, diffs, Agent messages, provider errors, and private provider identities never enter a notification intent.
- A pure foreground suppression rule: a focused, visible, non-minimized Desktop suppresses delivery only when the global Inbox or the exact affected Conversation already presents the Attention. Background, minimized, other-Project, and other-Conversation work remains eligible.
- Attention-ID delivery deduplication across replay, reconnect, StrictMode, and remount within the running Desktop process. Notification click carries only CodeTether public identities, restores/focuses the one main window, and lets the Web navigation boundary open the durable Conversation without resolving, acknowledging, retrying, or approving anything.
- A minimal `/settings` Desktop notification preference surface for Approval, completed review, and failed Turn, all enabled by default. The complete versioned record persists synchronously in the installed WebView's origin-scoped `localStorage`, outside Project SQLite; malformed or partial data falls back safely. Browser mode truthfully reports native notifications unavailable and retains Inbox behavior only.
- Deterministic presentation-only grouping for runs of at least three adjacent routine completed Tool executions. Failed, active, test, Approval-linked, and Diff-producing work stays independently visible, and expanding a group reveals every original normalized Tool row without changing durable history.
- Safe Agent-message Markdown for headings, paragraphs, ordered/unordered lists, bold text, inline code, fenced code, and explicitly allowed `http`, `https`, and `mailto` links. Raw HTML, image loading, iframe/script execution, `javascript:` URLs, and `dangerouslySetInnerHTML` are absent.
- Display-only shortening of reliably Project-contained paths in Agent messages, file changes, and Project surfaces. Canonical Project paths and durable Agent text remain unchanged; ambiguous or escaping paths remain verbatim.
- Public Turn anchors shared by Inbox and notification navigation, plus Inspector Changes selection that locates the matching Timeline Diff. These are routing and presentation concerns, not new Conversation or Attention state.
- A denser truthful Desktop surface: placeholder Activity/Agents navigation is absent while the real Machines destination is restored; unsupported Composer actions are hidden, long titles/paths are bounded with full-text affordances, Project IDs leave the primary overview, and user copy avoids exposing Host/Runtime implementation terms.

Phase 4C notification delivery remains bounded to the lifetime of the Desktop process and its owned Host, which accepted Phase 4G.1 keeps running while the main window is hidden. Phase 4G.2 is accepted and frozen at `f576b05`; do not continue Desktop lifecycle work unless Phase 6C.3 exposes a concrete regression. Its evidence classifications remain accurate: real raw-release Sleep/Wake, pending-Approval continuity, and Explorer recovery do not imply real logoff/shutdown, provider-network-change, active-Turn-at-suspend, dedicated Win+L, or installed-runtime-across-Sleep validation. Confirmed Windows session end remains a 2-second best-effort termination budget, not the ordinary 12-second graceful Tray Quit guarantee. Phase 5B is accepted and frozen at `5dac13c`; its unsupported Claude Edit/Write, Shell, Diff, interrupt, Approval, and model-selection boundaries must not be reinterpreted. Phase 6A is accepted and frozen at `0858fc7`; its local execution semantics remain unchanged. Phase 6B.1 is accepted and frozen at `30559a3`; its secure pairing and trust model remains unchanged. Phase 6B.2 is accepted and frozen at `53e7c21`; its cryptographic-identity, endpoint-hint, and bounded reconnect model remains unchanged. Phase 6B.3 is accepted and frozen at `11c652c`; its remote Project Location registration/removal and separate Unpair semantics remain unchanged. Phase 6C.1 is accepted and frozen at `466d63c`; its discovery freshness and observation semantics remain unchanged. Phase 6C.2 is accepted and frozen at `0b60dc6`; its bounded remote Codex execution and evidence remain unchanged. Phase 6C.3 authorizes only restricted remote Claude streaming, native resume, Read, Glob/Grep search, Tool normalization, and effort control. Claude Edit/Write/Shell/Diff/Approval/interrupt/model selection, generic remote control/filesystem/process, cross-Provider handoff, location relocation, synchronization, relay, LAN discovery shipment, and further Windows polish remain unauthorized.

## Out of Scope

During Phase 6C.3, do not implement without a separately approved phase:

- Visual redesigns or unrelated refactors to the frozen Design System, AppShell, Inbox, Conversations, Conversation Workspace, or accepted Projects UI.
- Activity, a standalone Agent-management page, a broader Settings redesign, an advanced New Conversation flow beyond Machine/Provider capability gating, or unrelated new product-page content.
- Live Host data in another frozen page.
- A generic WebSocket RPC transport or interactive PTY transport.
- Start with Windows, tray badges/dynamic Attention counts, recent Project/Conversation tray menus, a close-behavior preference, notifications after explicit application exit, notification-history UI, push/email/chat delivery, custom sounds or schedules, custom window chrome, auto-update, signing/release channels, drag-and-drop folders, recent-folder menus, Open in Explorer, or any other native product feature beyond the exact Phase 4B picker, Phase 4C notification delivery, Phase 4G.1 tray lifecycle, and Phase 4G.2 Windows lifecycle reliability boundary.
- A generic Tauri command runner, arbitrary shell bridge, arbitrary filesystem capability, or a second Client-to-Host business protocol.
- Project discovery/scanning, Project or Location rename/relocate, multi-root Locations on one Machine, remote Claude Edit/Write/Shell/Diff/Approval/interrupt/model selection, remote MCP/plugins/hooks, SSH, LAN discovery, relay, file synchronization, generic remote control/filesystem/Terminal, arbitrary remote process invocation, or execution on an untrusted/offline Machine or unregistered Location.
- Cross-Project/global Search, Agent response or Tool/Terminal/Diff/Approval search, FTS/semantic/embedding Search product behavior, old-Turn history pagination, Search history/analytics, Conversation Delete, bulk organization, tags, folders, groups, or drag reordering. Phase 4F.2 consumes only the accepted Project-scoped title/canonical-User-input backend and its typed Client boundary.
- Filesystem deletion, recursive cleanup, cascading Project deletion, or automatic reassignment of existing Conversations to another Project.
- Turn queueing, steering, retry-Turn, attachments, images, voice, Skill upload, or a Provider-specific React/HTTP write path. Claude Code interrupt and Approval controls remain unavailable unless a later parity phase establishes stable machine-readable semantics; existing Codex control remains unchanged.
- Actionable Approval recovery across restart, `Always Allow`, automatic approval, or a production permission-policy system. Expired Approval history may be retained only to explain what happened.
- Claude Code capability parity beyond the approved restricted foundation, OpenCode or any third Provider, speculative Provider implementations, Provider switching on an existing Conversation, or cross-agent conversation handoff.
- Mobile screens, team, enterprise, public cloud relay, or other later-phase platform features.
- Event sourcing, CQRS, an ORM, a repository hierarchy, a durable provider-event log, or durable exactly-once command processing.
- Durable Approval resolution across restart. A pre-restart provider request is no longer actionable after its process dies.

Do not install dependencies for an out-of-scope runtime merely because its directory exists.

## Core Entities

### Project

A durable logical workspace in which an agent operates. Its identity and display name are independent from durable Machine-scoped authorized Locations containing canonical roots and computed availability. Phase 6B.3 supports at most one Location for a Project on each Machine and explicit safe removal of an unreferenced remote Location; it does not support discovery, relocation, synchronization, or multiple roots on the same Machine.

### Conversation

The durable unit of user-agent work and history. It is associated with one Project, one Agent, one Machine, plus a model, reasoning setting, permission mode, and event history. In the current model it never changes agents.

### Agent

A coding-agent Provider/runtime. Codex is the established full-control Provider; accepted Phase 5B preserves the bounded Claude Code capability matrix proven at its real noninteractive boundary. Availability is composed for the selected Machine without merging the Provider and Machine registries. OpenCode and others remain future adapters.

### Machine

A durable execution location capable of hosting authorized Project Locations and Provider sessions. Phase 6A established one truthful local Windows Machine, accepted Phase 6B.1 adds real paired remote Machines with stable CodeTether-owned identities and authenticated availability, accepted Phase 6B.2 recovers an existing trusted Machine across a LAN endpoint change without making location its identity, accepted Phase 6B.3 lets a trusted remote Machine validate and own durable Project Location metadata, accepted Phase 6C.1 can describe installed coding-agent CLIs, and accepted Phase 6C.2 executes only its fixed remote Codex profile. Phase 6C.3 may additionally execute only the restricted remote Claude Code streaming/resume/Read/Search/effort profile on the exact trusted online Machine and registered Location. A Conversation still executes on one immutable Machine.

## Architecture Principles

- Prefer the simplest design that meets the current phase.
- Maintain explicit boundaries between UI, desktop shell, host, protocol, agent core, and provider adapters.
- Keep each fact owned by one layer; avoid duplicated or competing state.
- Keep provider-specific protocols behind adapters. UI consumes normalized contracts only.
- Avoid oversized components, modules, stores, and catch-all utility packages.
- Prefer mature solutions over custom implementations when they fit the need.
- Do not abstract before a real repeated requirement exists.
- Do not over-engineer future phases or introduce infrastructure early.
- Keep dependencies directional; product UI must not import provider-specific code.

## Frontend Principles

- All reusable public UI primitives belong in `packages/ui`.
- Do not redefine Button, Input, Card, or other shared primitives per page.
- Use design tokens for color, typography, spacing, radius, elevation, and motion.
- Avoid inline styles, magic numbers, broad CSS overrides, and one-off foundational colors.
- Never use `!important` to patch a design-system problem; correct the token, primitive, or composition.
- Use Tailwind CSS and shadcn/ui consistently, with Lucide for interface icons.
- Use TanStack Query for server/host state.
- Use Zustand only for UI state such as sidebar collapse, inspector visibility/tab, command palette, and mobile navigation.
- Do not copy Project, Conversation, Agent, Machine, or other host-owned records into Zustand as a second source of truth.
- Honor accessibility, keyboard navigation, focus behavior, reduced motion, responsive behavior, empty states, loading states, and error states.

## Component Principles

- Give every component one clear responsibility.
- Prefer composition over a component that grows to hundreds or thousands of lines.
- Separate business/data orchestration from presentational UI where practical.
- Keep feature-specific components close to their feature; promote them to `packages/ui` only when they are genuinely reusable.
- Expose small, typed APIs and avoid boolean-prop explosions.
- Add a shared primitive only when a real design or product task requires it.

## AI Development Rules

Before every task:

1. Read `AGENTS.md`.
2. Read the relevant documents under `docs/`.
3. Inspect the existing implementation and working tree.
4. Make a short plan scoped to the request.
5. Only then modify code.

Never:

- Perform a broad refactor without being asked.
- Change architecture or source-of-truth decisions without approval.
- Delete or weaken functionality merely to make tests pass.
- Implement features outside the requested task or current phase.
- Redesign a Figma-defined UI based on personal preference.
- Copy legacy CodeTether code or use its directory structure as the basis for V2.

Legacy CodeTether may be consulted only when explicitly requested, and only for a previously validated low-level capability.

## Quality Gate

After important work, run at minimum:

```text
pnpm typecheck
pnpm lint
pnpm test      # when tests exist
pnpm build
```

Also run the most relevant focused checks during development. Do not claim completion while known type errors, lint errors, failing tests, build failures, or obvious regressions remain. If a check cannot run, report the exact reason.
