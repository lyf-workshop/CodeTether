# CodeTether Roadmap

## Phase Rules

Work proceeds in strict phases. A phase must meet its exit gate and be explicitly completed before work begins on the next phase. Later-phase infrastructure must not be pulled forward for convenience. Each transition should update the `Current Scope` in `AGENTS.md` and record any approved scope change in the relevant specification.

## Phase 0 — Foundation

**Goal:** establish a clean, maintainable repository and a reliable frontend engineering baseline.

Deliverables:

- Git repository and pnpm monorepo.
- Long-lived `apps/` and `packages/` boundaries.
- Minimal React 19, TypeScript, and Vite bootstrap in `apps/web`.
- Tailwind CSS 4 and shadcn/ui-compatible design-system foundation in `packages/ui`.
- Frontend dependencies ready for TanStack Router, TanStack Query, Zustand, Lucide, and Motion.
- Shared TypeScript, lint, formatting, typecheck, and build commands.
- `AGENTS.md`, repository README, product specification, architecture, and roadmap.
- README-only placeholders for future desktop, host, protocol, agent core, adapters, and shared code.

Exit gate:

- Dependency installation is reproducible from the lockfile.
- `pnpm typecheck`, `pnpm lint`, and `pnpm build` pass.
- No product page or runtime feature has been implemented.
- Foundation scope is reviewed and accepted.

## Phase 1 — Frontend Experience

**This is CodeTether's first true product milestone.** Its purpose is to prove that the product experience is good enough before backend and agent integration make it expensive to change.

Required implementation order:

1. **Phase 1A — Design System & Components** — approved `00 Foundations` tokens and reusable `92 Components`. Accepted.
2. **Phase 1B — Desktop AppShell** — the shared TopBar, PrimarySidebar, MainContent region, and placeholder routes. Accepted.
3. **Phase 1C — 07 Desktop — Conversation Detail** — accepted and frozen as **Conversation Workspace v1** after Phase 1C.2 final core-workspace polish. Mock data only.
4. **Phase 1D — 06 Desktop — Conversations** — accepted and frozen as **Desktop Conversations v1**. Mock data only; the new-conversation flow remains deferred.
5. **Phase 1E — 02 Desktop — Inbox** — accepted and frozen as **Desktop Inbox v1**. Mock data only.
6. **Phase 1F — Core Product Integration & UX Review** — accepted. Terminology, navigation, deep links, shared typed Mock state, accessibility, and cross-screen consistency were reviewed across the frozen experiences.

All data is mock data. Mock scenarios should cover realistic working, waiting, approval, question, failure, and completion states without pretending to be a backend.

Forbidden in Phase 1:

- Host implementation.
- Database or persistence implementation.
- Agent integration or SDKs.
- WebSocket backend or production transport.
- Desktop/Tauri implementation.

Exit gate:

- Approved target screens match Figma at required desktop and mobile breakpoints.
- Core states and interactions are demonstrable with realistic mock data.
- Shared components and tokens are consistent, accessible, and maintainable.
- Typecheck, lint, relevant tests, and production build pass.
- Product experience is explicitly accepted before backend work begins.

Phase 1 passed its exit gate and is frozen as **CodeTether V2 Frontend Core v1**.

## Phase 2 — Codex Local Loop

**Goal:** prove the first real end-to-end local agent loop with Codex.

### Phase 2A — Codex App Server Runtime Spike

**Status:** accepted after verification against local `codex-cli 0.149.1`.

Verified outcomes:

- Local App Server capabilities were inspected and both JSON Schema and TypeScript protocol definitions were generated into an ignored temporary directory.
- One long-running App Server process completed `initialize` / `initialized` once.
- A provider-owned ephemeral Thread and Turn were created in an isolated ignored workspace.
- A safe real prompt produced streamed Agent messages, command/tool events, a file change, diff notification, and successful Turn completion.
- Codex wire events were translated into the smallest currently needed `packages/agent-core` event contract.
- Manual one-shot approval dispatch was fixture-tested; real approval semantics were deliberately validated in Phase 2A.1.
- Fixture tests cover line framing, request matching, unknown notifications, event normalization, and pending-request rejection on process exit.
- The runtime shut down cleanly after the completed Turn.

Phase 2A deliberately contains no browser transport, React integration, persistence, Tauri shell, remote access, or non-Codex adapter.

Exit gate:

- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, and `pnpm test` pass.
- `pnpm codex:spike` completes one real safe Turn in the isolated workspace.
- Observed protocol behavior and unresolved gaps are documented.

### Phase 2A.1 — Codex Runtime Semantics & Approval Validation

**Status:** accepted and frozen with Phase 2A as **Phase 2A Codex Runtime v1** after controlled validation against local `codex-cli 0.149.1`.

Verified outcomes:

- Real `item/commandExecution/requestApproval` requests completed one isolated Allow Once run and one isolated Decline run, each bound to its provider request, Thread, Turn, and Item.
- One long-running App Server completed two sequential Turns in one Thread with retained context.
- One App Server hosted two concurrent Threads and Turns without cross-Thread event or delta contamination.
- A known non-ephemeral provider Thread ID resumed after restarting the App Server child process, and a follow-up Turn retained context. This does not claim Host/application restart recovery or CodeTether persistence.
- `turn/interrupt` produced a terminal interrupted status, and the same Thread accepted a later Turn.
- A safe non-zero command verified Tool failure inside a completed Turn; a true terminal Turn failure was not observed.
- Process-, Thread-, and Turn-scoped runtime memory now has explicit cleanup behavior.
- A bounded in-process Host queue coalesces compatible deltas while preserving identity and final text; approval and terminal lifecycle signals are delivered or cause an explicit runtime failure rather than being silently dropped.
- Fixture tests cover routing, Thread isolation, approval binding, cleanup, aggregation integrity, reliable overflow behavior, unknown request rejection, and process-exit rejection without launching Codex in `pnpm test`.

Known boundaries:

- File-change, permissions, and legacy approval requests were not observed in a real run.
- The runtime wire included an `availableDecisions` command-approval field omitted by the generated 0.149.1 binding, so tolerant parsing and raw diagnostic metadata remain necessary.
- No durable sequence, replay, reconnection, browser transport, React integration, persistence, Tauri shell, remote access, or production permission policy exists.

Exit gate:

- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, and `pnpm test` pass.
- Real Allow Once and Decline, multiple Turns, multiple Threads, known-ID resume across App Server child processes, and interruption complete in isolated manual scenarios.
- Lifecycle ownership, event identity, aggregation measurements, failure semantics, and unresolved protocol gaps are documented without overstating unobserved behavior.

### Phase 2B — Client-to-Host Protocol & Local API

**Status:** accepted and frozen as **Client-to-Host Protocol v1** after controlled real-Codex validation. Phase 2C.1 may consume this boundary but must not change its wire contract implicitly.

Verified outcomes:

- `packages/protocol` is the Protocol v1 source of truth for shared TypeScript and Zod contracts.
- HTTP commands and an SSE event stream are exposed only on `127.0.0.1`; explicit development Origins are allowlisted without wildcard CORS.
- The Host owns public Conversation, Turn, Item, Approval, action, epoch, sequence, and event identities while provider identities stay private.
- Bootstrap, in-memory snapshot, CodeTether Conversation creation, text Turn start, interrupt, and one-shot approval resolution are implemented.
- Every mutation requires a bounded in-memory idempotency key; identical retries do not duplicate provider actions while their recent result remains in the 256-entry cache.
- Aggregated events receive one process-global sequence and `<epoch>:<seq>` SSE identity, with bounded replay and a connection-local reset for wrong, evicted, or future cursors.
- Multi-client fanout preserves identical event identity. A bounded slow client is disconnected without affecting other observers; reliable lifecycle events are not silently dropped.
- A small non-React client validates HTTP/SSE responses and supports caller-controlled reconnect with `Last-Event-ID`.
- Fixture tests do not launch Codex. `pnpm host:integration` completed a real file-changing Turn, exact replay, command approval, interruption, reset handling, cleanup, and Host epoch change in isolated ignored workspaces.

Known boundaries:

- All Host state, replay, identity maps, and idempotency results are in memory and disappear on restart.
- The idempotency cache is a bounded recent-retry window, not durable exactly-once execution.
- `stream.reset` requires a fresh snapshot; no durable history or recovery exists.
- An idle runtime failure has no proactive capability-change event.
- At the Phase 2B acceptance boundary, the frozen React frontend still used Mock data and had not imported the client.
- Authentication, Tauri, LAN/remote exposure, interactive PTY, persistence, non-text inputs, and non-Codex providers remain unimplemented.

Exit gate:

- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, and `pnpm test` pass.
- The real local integration verifies HTTP commands, SSE events, two observers, successful replay, reset paths, approval, interrupt, cleanup, and a new epoch after restart.
- Protocol v1, local security boundaries, limits, and remaining non-durable behavior are documented without connecting React.

### Phase 2C.1 — Live Conversation Read Model

**Status:** accepted. The read-only live Conversation path is frozen except for explicit read-model completeness defects addressed in Phase 2C.1.1.

Implemented scope:

- One application-scoped Web `HostRuntime` uses `packages/client`; React components do not parse SSE or provider payloads.
- Bootstrap, Snapshot, and the Conversation projection are stored through TanStack Query, while SSE connection lifecycle remains in the runtime.
- The cursor is browser-memory only. Reconnect uses `Last-Event-ID`, and `stream.reset` or an invalid sequence boundary replaces the projection from a fresh Snapshot before streaming resumes.
- A pure projection handles Conversation, Turn, message, Tool, file-change, Approval, and terminal lifecycle events with Conversation/Turn/Item identity and duplicate/out-of-order protection.
- Command terminal output is bounded to the most recent 128 KiB per Conversation.
- Demo Mock and live Host records adapt to one `ConversationViewModel`: `/conversations/demo` stays frozen Mock UI, while a valid `/conversations/conv_*` route is read-only live data.
- Inbox and Conversations continue to use Mock data. Composer, Approval resolution, interrupt, stop, and all other React mutations remain disconnected.
- A development observation helper can create a Host Conversation and start a Turn in an explicitly allowed ignored workspace; it is not a product creation flow.

Known boundaries at acceptance:

- The original Phase 2C.1 Snapshot did not carry Timeline history or canonical User input. Phase 2C.1.1 replaces that incomplete process-local boundary with a bounded runtime Snapshot.
- Pending Approvals remain a read-only waiting state. Resolution is deferred to Phase 2C.2.
- No persistence, Inbox/Conversations live data, Tauri, remote access, or non-Codex provider is introduced.

Verified live observation:

- A browser subscribed to a real `conv_*` route before Turn start and displayed three Agent messages, four command executions, one file Diff, and terminal completion from a real local Codex Turn.
- The default local model was `gpt-5.6-sol`; the isolated workspace changed only `src/example.ts` by adding the requested one-line comment.
- A separate explicit-model attempt produced a real `turn.failed` presentation without crashing the page; the public Host error intentionally did not expose the provider cause.
- Closing the Host retained the last projection and changed the indicator to reconnecting. A clean connected browser run completed with zero console errors and zero warnings.
- The same `/conversations/demo` route continued to render the accepted Mock conversation after live validation.

Exit gate:

- Snapshot projection, delta merge/deduplication, Tool and Approval lifecycle, terminal bounds, duplicate/out-of-order handling, reset replacement, and unavailable/incompatible connection states have focused tests.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, and `pnpm test` pass.
- With Host and Web running separately, a real isolated Codex Turn streams message, Tool, file-change, and completion state into the frozen Conversation Detail with zero browser console errors or warnings.
- The accepted Demo route and other frozen Mock pages remain visually and behaviorally unchanged.

### Phase 2C.1.1 — Conversation Read Model Completeness

**Status:** accepted and frozen as **Live Conversation Read Model v1**.

Implemented scope:

- Protocol v1 is extended additively with optional per-Conversation runtime Snapshots while retaining compatibility with accepted Phase 2B Snapshot records.
- The Host owns canonical text Turn input and emits the same input through live `turn.started` data and Snapshot Turn records, so every observer sees the same User message.
- Each Conversation retains bounded process-local Turns, Agent messages, Tool executions, file changes, Turn outcomes, pending Approvals, and the latest terminal tail; raw Codex JSON-RPC is never retained as history.
- Snapshot-only reconstruction and live event application converge on the same multi-Turn `ConversationViewModel`; refresh and `stream.reset` replace from the complete retained Snapshot.
- Runtime-history eviction or truncation publishes a sequenced, replayable `stream.reset` boundary so connected and reconnecting observers replace from the same compacted Snapshot.
- Timeline Diff and Inspector Changes still use one projected Changes collection.
- Provider command Tools use a stable presentation name plus a separately bounded raw command. Deterministic Tool presentation unwraps safe PowerShell command wrappers, recognizes a small stable command set, summarizes common failures, and keeps raw commands out of Timeline titles.

Memory boundaries:

- The Host retains at most 20 recent Turns and 512 combined message/Tool/change entries per Conversation by default.
- Terminal output keeps the most recent 128 KiB; individual presentation text is bounded at 512 KiB; the encoded runtime budget is approximately 4 MiB per Conversation.
- Old completed Turns are evicted before the active Turn. The active Turn and its canonical input are never silently removed, and Snapshot history metadata reports eviction or truncation.
- Canonical text input above 512 KiB is rejected before Provider execution. Host restart still clears every runtime record because this phase adds no persistence.
- These limits are per Conversation. Process-wide Conversation admission and an explicit cap for active-Turn provider Item bindings remain later Host lifecycle work; unretained bindings are swept when the Turn becomes terminal.

Exit gate:

- Tests cover Host-owned User input, two observers, multi-Turn reconstruction, live/Snapshot equivalence, refresh/reset replacement, Tool presentation, command failures, bounded eviction, terminal bounds, and pending Approval restoration.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, and `pnpm test` pass.
- A real isolated two-Turn Codex Conversation survives browser refresh and reconnect/reset reconstruction without losing User messages, Agent messages, Tools, Changes, or final status.
- The frozen Conversation Detail visual structure and every React write boundary remain unchanged.

Verified result:

- One Host epoch completed two real Turns in the same `conv_*` Conversation and retained two canonical User inputs, five Agent messages, five command Tools, two file changes, the latest terminal tail, and completed status.
- A sequenced Snapshot boundary caused the browser to fetch Snapshot and reconnect without losing Timeline content. A subsequent full page refresh reconstructed the same two-Turn view.
- Stable Timeline Tool titles replaced full PowerShell executable strings; raw commands remained available in terminal/details data.
- The final 1536 x 1024 browser review reported zero console errors and zero warnings.

### Phase 2C.2 — Live Conversation Control

**Status:** accepted and frozen as **CodeTether Local Codex Alpha v0.1**.

Implemented scope:

- The existing Composer starts real text Turns through Protocol v1. Canonical User messages still come only from Host-owned `turn.started` state; React never appends a competing optimistic message.
- Every logical mutation receives a random `actionId`. In-flight duplicate intent is shared, ambiguous retries retain the same identity, and definitive results release it.
- Active Turns disable new submission rather than introducing queue or steer behavior. Enter sends, Shift+Enter inserts a newline, and IME composition does not submit.
- Every pending Approval remains visible by exact public `approvalId` with independent Allow Once/Decline mutation state until `approval.resolved` is observed.
- Header Interrupt binds the exact active Conversation and Turn and waits for `turn.interrupted`. Stop remains unavailable because Protocol v1 has no Thread-termination command.
- Host connection and advertised Bootstrap capabilities gate Composer, Approval, and Interrupt controls. Unsupported quick actions and model/reasoning/permission changes remain read-only.
- Timeline auto-follow respects manual upward scrolling and offers “跳到最新”; workspace file paths are presented relative to the authorized root, while complete command/error text remains in Terminal/details.
- Demo, Inbox, and Conversations remain Mock data, and the accepted visual/component structure is unchanged.

Verified result:

- A browser completed multiple real Turns in one Codex Conversation and retained context across follow-up prompts.
- A safe real command Approval completed after Allow Once. A separate Decline prevented command execution and correctly allowed the Provider Turn to complete rather than forcing a failed UI state.
- A bounded sleep Turn emitted `turn.interrupted`; the same Thread then accepted and completed another browser-submitted Turn.
- A longer read-only Turn kept the Composer visible and caused no horizontal overflow at 1536 x 1024 or 1280 x 900.
- Browser automation verified bottom-follow, manual-scroll preservation, jump-to-latest, and synthetic IME composition behavior. Physical Windows IME input remains a human acceptance check.

Known boundaries:

- Host and browser state remain process-local; Host restart loses CodeTether Conversation records.
- Protocol Approval records do not yet carry a trusted structured risk/reason presentation, and file-change/permissions Approvals were not observed in this phase.
- Stop, queue/steer, attachments, live Inbox/Conversations data, persistence, desktop packaging, remote access, and non-Codex providers remain deferred.

Exit gate:

- Tests cover Composer intent, action identity and duplicate suppression, IME keys, draft retention, connection/capability gating, interrupt identity, independent Approval identity, safe mutation errors, auto-scroll decisions, and stable Tool presentation.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, and `pnpm test` pass.
- Real browser validation completes Send, multi-Turn context, Approval Allow/Decline, Interrupt, and Continue in ignored isolated workspaces with no browser console errors or warnings.

### Phase 2D — Local Alpha Audit & Stabilization

**Status:** complete with a `READY` verdict. The audited Alpha is frozen; Phase 3A was subsequently authorized as the next isolated scope.

Verified outcomes:

- Repository, dependency, architectural-boundary, wire-contract, state-ownership, memory, failure, security, UX, test, developer-experience, and documentation audits were completed against the tagged Alpha baseline.
- No P0 defect or layer-boundary leak was found. Protocol v1 remains the only Client-to-Host wire source of truth, and provider identities remain behind the Host/adapter boundary.
- P1 stabilization bounded process-wide Conversation admission, pending Approvals, active-Turn provider/file identities, JSON-RPC line framing, and browser message projection. Repeated history truncation now emits one reset boundary instead of a reset storm.
- Losing the reliable runtime control path now closes the Codex child, and partial local-Host assembly failures clean up the already-started runtime.
- Ordinary 20-Turn Snapshot reconstruction remained fast; near-cap history serialization and some browser-lifetime retry state remain measured technical debt rather than correctness blockers.
- Real isolated Codex and browser runs revalidated multi-Turn context, Approval Allow/Decline, Interrupt/Continue, refresh recovery, and 1280-pixel layout without console errors or warnings.
- Physical Windows Chinese IME behavior and destructive hard-kill/orphan scenarios were not manually claimed as passing.

Exit gate:

- All P1 findings required for a bounded and safe local Alpha are fixed with focused regression tests.
- Full typecheck, lint, format, build, fixture test, diff, and real isolated integration gates pass.
- The final audit report records remaining P2/P3 debt and recommends—but does not begin—the next phase.

## Phase 3 — Durable Conversation Management

**Goal:** make conversations durable and manageable beyond one Host process without expanding prematurely into an event-store or general project platform.

### Phase 3A — Minimal Durable Persistence

**Status:** complete. Automated durability gates and the real isolated restart/context-retention walkthrough passed.

Verified scope:

- Standard Node `node:sqlite` storage outside the repository, with `CODETETHER_DATA_DIR` for absolute-path development/test isolation and OS user-data defaults otherwise.
- A minimal transactional migration runner and only `schema_migrations`, `conversations`, and `turns` in schema version 1.
- Durable CodeTether Conversation/Turn identities, private Codex provider Thread/Turn identities, canonical text input, status/timestamps, and versioned normalized per-Turn presentation snapshots.
- Memory-first streaming with a 300 ms dirty-snapshot flush window, synchronous lifecycle/Approval flushes, final flush on graceful shutdown, WAL checkpointing, and fail-closed database error behavior.
- Startup reconstruction of the bounded recent runtime window while retaining older durable Turn rows for a later history interface.
- Restart reconciliation: incomplete Turns become `interrupted` with `host_restart`, Conversations return to idle, and old pending Approvals become expired, non-actionable history.
- Lazy `thread/resume` on the first post-restart Turn. Missing provider history preserves local display history and returns `provider_conversation_unavailable` instead of silently creating a different Thread.
- A new Host epoch after restart; SSE replay and action idempotency remain intentionally process-local, and the Web runtime does not automatically retry an uncertain mutation from the prior epoch.

Not included:

- Raw provider-event persistence, an event store, CQRS, ORM, durable exactly-once commands, or automatic active-Turn recovery.
- Full-history pagination, retention/archive policy, real Conversations/Inbox data, Project management, Tauri, remote access, or another provider.

Exit gate results:

- Fresh/existing migrations, restart reconstruction, write/open/migration failure behavior, bounds, expired Approval recovery, new epoch, missing provider Thread, and lazy resume have fixture coverage without launching Codex during `pnpm test`.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, `pnpm test`, and `git diff --check` pass.
- A real isolated Conversation completed multiple browser Turns; the Host fully stopped and restarted against the same database; the same `conversationId` and Timeline returned; and a later Turn proved that the resumed Codex Thread retained prior context.
- Database size, write latency, flush behavior, browser console state, and the post-restart 1536 × 1024 view were recorded.

### Phase 3B.1 — Durable Project Identity & Local Workspace Authorization

**Status:** implemented and validated.

Verified scope:

- A durable CodeTether Project represents one authorized local workspace with a `proj_*` public identity, name, canonical root path, timestamps, and filesystem-computed availability.
- SQLite migration 002 (`projects`) creates the Project table, backfills distinct legacy Conversation roots, and rebuilds every durable Conversation with a required Project foreign key while preserving its contained `cwd`.
- Protocol v1 and `packages/client` support Project list, read, create, and delete. New Conversation creation uses `projectId`.
- Registration resolves and validates the real directory and optional configured-root constraint. Re-registering the same canonical root returns the existing Project instead of duplicating it.
- Durable Project authorization reloads after Host restart. Each Conversation creation, Turn, and lazy provider Thread resume revalidates the saved root and contained working directory before provider work starts.
- A missing, moved, or identity-changed Project root remains visible as unavailable. Durable Conversation history stays readable, while controls fail safely with `project_unavailable`.
- Project deletion removes only the registration, never filesystem data. It is rejected while any durable or runtime Conversation references or is being created against the Project, so concurrent creation cannot race deletion and history cannot cascade away.
- The deprecated Protocol v1 `cwd` Conversation request may only map to an already registered, available Project and cannot create a new authorization grant.

Not included:

- Projects UI, filesystem browser/discovery, import UX, live Conversations/Inbox data, or a new Conversation product flow.
- Multiple Project locations, Machine binding, filesystem generation identity, workspace relocation, or automatic repair of an unavailable root.
- Tauri, remote access, authentication, or another provider.

Exit gate results:

- Fresh and upgraded databases preserve Project and Conversation identity with foreign-key integrity.
- Duplicate registration, unavailable roots, containment, symlink/junction behavior, legacy request confinement, deletion safety, restart authorization, and lazy-resume authorization have focused coverage.
- Protocol, client, Host API, persistence, and real isolated integration gates validate the Project-aware control path without changing the frozen frontend.
- A real `codex-cli 0.149.1` Conversation survived a complete Host restart, recalled `PROJECT-BOUNDARY-8427` through the saved provider Thread, failed closed while its Project directory was temporarily unavailable, and completed another Turn after that directory was restored.

### Phase 3B.2 — Real Projects UI

**Status:** implemented and validated. The accepted scope stops at real local Project list/add/detail/remove.

Verified scope:

- `/projects` lists real Host-owned Project records and distinguishes loading, empty, and Host-unavailable states.
- `/projects/:projectId` independently reads and presents the real name, canonical root path, availability, and timestamps without Mock analytics, Git data, or Conversation counts.
- A keyboard-accessible add dialog accepts a manual absolute path and optional name. The Host remains authoritative for path validation, canonicalization, authorization, duplicate detection, and safe errors.
- Duplicate canonical registration returns and opens the existing Project without creating a second list entry.
- Unavailable Project roots remain inspectable with durable metadata and a restrained unavailable state.
- Removal requires explicit confirmation that no filesystem data is deleted. A referenced Project reports `project_has_conversations`; there is no cascade or force delete.
- TanStack Query owns Project server-state caching and mutation refresh, while React uses the typed `packages/client` boundary rather than direct fetch calls or a duplicate Project store.

Not included:

- Native folder selection, filesystem scanning/discovery, import automation, rename, relocation, or automatic repair of an unavailable root.
- Real Conversations or Inbox data, a New Conversation flow, Project Conversation counts, Git status/management, or repository indexing.
- Tauri, Machine management, remote access, authentication, another provider, or mobile UI.

Exit gate results:

- Real browser flows validated empty state, registration, duplicate handling, detail read, Host restart persistence, unavailable/recovered roots, registration-only removal, and the referenced-Project conflict without deleting either test directory.
- Projects list and detail were reviewed at 1536 × 1024 and 1280 × 900 without horizontal overflow, and the unavailable state was captured separately.
- Focus behavior, Dialog Escape restoration, safe Host errors, query updates, and focused Project UI/data tests passed alongside the repository typecheck, lint, format, build, test, and diff gates.
- Inbox, Conversations, Conversation Detail, AppShell, and the Design System retain their accepted visual and data boundaries.

### Phase 3C.1 — Durable Conversation Index & Title

**Status:** implemented and validated. The accepted scope stops at the durable history index and typed non-React client.

Verified scope:

- SQLite migration 003 adds a required canonical title and a distinct `last_activity_at` activity clock to every Conversation without changing its Project, provider Thread, Turn, or normalized Timeline identity.
- Existing rows use their first durable text input for deterministic title backfill; rows without a Turn remain `新会话`.
- New Conversations start as `新会话`. The first Host-recorded text input generates one local title before provider execution; later Turns and provider resume do not rewrite it.
- Title generation normalizes Unicode/whitespace, uses the opening sentence or clause, removes only a small stable set of request prefixes, and truncates safely to 48 graphemes within the wire bound. It never calls a model.
- `GET /api/v1/projects/:projectId/conversations` queries only durable Conversation summary columns, is scoped to one Project, sorts by last activity descending, defaults to 50 rows, and rejects limits above 100.
- Optional canonical provider/status filters are validated at the Protocol boundary. Unavailable Projects remain readable; unknown Projects return `not_found`.
- `ConversationSummary` exposes product identity, title, provider/model/reasoning, canonical status, and timestamps while keeping `cwd`, provider Thread identity, and SQLite details private.
- `packages/client` provides the matching typed list method without connecting the frozen Conversations UI.

Not included:

- Real Conversations UI, real Conversation Rail, New Conversation UI, current-Project frontend integration, Inbox data, or search indexing.
- Cursor pagination. V1 returns a bounded first page only; a later history surface must define continuation before assuming more than 100 rows are visible.
- AI title generation, rename UI, or a title-rewrite subsystem.
- At the Phase 3C.1 exit boundary, cold Conversations beyond the eight-Conversation runtime admission window did not yet hydrate for control; Phase 3C.1.1 subsequently closes that runtime gap without connecting React.

Exit gate results:

- Fresh and migrated databases, Unicode/title bounds, no-Turn fallback, first-input ownership, second-Turn stability, Project isolation, canonical status, last-activity ordering, restart restore, query bounds, and private-provider-field exclusion have focused coverage.
- A 100-row fixture query reads only `conversations` summary columns and completed in approximately 2–3 ms on the validation machine; corrupt Turn snapshot JSON does not affect the index query.
- A real isolated Codex run retained deterministic titles over multiple Turns, returned two Project Conversations in activity order, preserved that order through a full Host restart, and lazily resumed the original provider Thread to recall `INDEX-TITLE-731`.
- The frozen React product surfaces remain unchanged.

### Phase 3C.1.1 — Durable Conversation Detail & Bounded Runtime Hydration

**Status:** implemented and validated. The accepted scope stops at the provider-independent durable detail read and internal cold-control hydration path.

Verified scope:

- Product history, the Host runtime working set, and the Codex provider session are separate layers: SQLite owns durable identity/history; at most eight Conversations are admitted to live memory by default; Codex owns Thread context and is resumed only for control.
- `GET /api/v1/conversations/:conversationId` reconstructs the most recent 20 durable Turns by default using the existing normalized `ConversationRuntimeSnapshot`, with `hasOlderHistory`, retained/total Turn counts, actionable pending Approvals, and bounded resolved/expired Approval history.
- Cold detail reads do not hydrate runtime state, start or resume Codex, advance SSE sequence, mutate durable state, or require an available Project/provider Thread.
- Starting a Turn on a cold Conversation deduplicates internal hydration, reserves bounded runtime capacity, restores durable presentation/identity state, revalidates the workspace, and lazily resumes the saved provider Thread before starting provider work.
- Runtime capacity uses least-recently-used eviction only for safe idle, clean, unpinned Conversations. Active, starting, interrupting, hydrating, dirty, or Approval-waiting Conversations are protected; capacity pressure without a safe victim returns `runtime_unavailable`.
- Cold presentation order is compacted, while already-hot restored order stays stable when it is unambiguous. The Host event sequence starts above the possible durable order range when cold provider Conversations exist, preventing a new live Item from colliding with cold history. Durable publication still checks that preview and published sequence agree.
- If Codex launch fails, the loopback Host remains available for durable Project/index/detail reads with provider capabilities disabled; provider-dependent mutations fail closed.
- Protocol v1 and `packages/client.getConversation()` expose only CodeTether summary/runtime/history contracts. Provider Thread identity, raw provider data, SQLite details, workspace routing, and internal hydration state remain private.

Not included:

- Real Conversations UI, real Conversation Rail, current-Project frontend integration, New Conversation UI, or Inbox data.
- Full-history pagination or a browser history-loading flow. The detail response is a bounded recent window and reports older durable history explicitly.
- New persistence tables, an event store, durable runtime admission/LRU state, provider-event persistence, durable SSE replay, or durable action idempotency.
- Tauri, remote access, another provider, queue/steer, attachments, or a production Host lifecycle supervisor.

Exit gate results:

- Fixture coverage verifies cold read purity, recent-20/older-history metadata, User/Agent/Tool/Change/Terminal reconstruction, pending/resolved/expired Approval semantics, eight-runtime startup admission, single hydration/resume, safe LRU eviction, protected active state, concurrent-control deduplication, and private-field exclusion.
- HTTP integration verifies strict single-Conversation reads, unknown/query rejection, provider-independent unavailable history, and read-only Host startup when the Codex executable cannot launch.
- A real Codex integration created 12 durable Conversations, restarted the Host with exactly eight hydrated and zero active Conversations, read an older Conversation without hydrating it, then lazily hydrated/resumed its original Thread and completed a second Turn that recalled the pre-restart marker. In the final run, the cold SQLite read took 1.368 ms, runtime hydration before provider resume 1.729 ms, provider lazy resume 120.790 ms, and provider Turn start 42.111 ms.
- Cold reconstruction and subsequent live events preserve unique presentation order and strict Host-global sequence without publishing a synthetic hydration event.
- The accepted frontend remains unchanged; Real Conversations and history pagination remain separately authorized future work.

### Phase 3C.2 — Real Conversations Experience

**Status:** implemented and validated. The accepted scope stops at the real Project-scoped Conversation list/Rail/context and minimal Codex Conversation creation.

Verified scope:

- `/projects/:projectId/conversations` reads up to the latest 100 durable summaries through `packages/client` and TanStack Query, preserves Host activity order, and distinguishes loading, empty, unavailable Project, Host-unavailable, and local no-result states.
- The accepted Conversations visual structure now presents only real Project, title, provider, model, canonical status, and activity fields. Provider groups are data-driven, so current real data shows Codex only; fake Machine, Git, archive, Claude Code, and OpenCode Conversation data are absent.
- `/conversations/:conversationId` reads cold or live normalized detail through one ViewModel. Its Rail queries the owning Project's durable index, selects by `conversationId`, scrolls beyond eight Conversations, and does not resume Codex merely to show history.
- Current Project context and breadcrumbs derive from the route/detail `projectId`; there is no persisted last-Project store. `/conversations` redirects to `/projects`, while `/conversations/demo` remains a development-only fixture outside real navigation.
- Project Detail can open the real history or the minimal New Conversation dialog. Project context is locked when known; global entry queries available Projects; Agent is locked to Codex; model/reasoning use Host defaults; mutation identity is random and duplicate in-flight submission is suppressed.
- A zero-Turn Conversation renders a real empty Timeline and enabled Composer. The first Host-owned input updates the durable title, and low-frequency lifecycle events refresh the header, breadcrumb, Rail, and index without refetching on message or Tool deltas.
- Unavailable Project history remains readable while create/control paths are disabled. Host failure is not presented as an empty list and exposes an explicit retry.
- Bootstrap capability state is retained by the application Host Runtime rather than relying on an unobserved Query cache lifetime, preserving controls during long-running sessions.

Not included:

- Real Inbox, Activity, Conversation archive/rename/delete, older-history pagination UI, full-text search, Project discovery, native folder selection, or Git management.
- Provider selection, Claude Code, OpenCode, Machine management, Tauri, remote access, authentication, queue/steer, or attachments.
- A persistent Current Project preference or global Project store.

Exit gate results:

- A real browser flow registered one isolated Project, created a Conversation, completed a file-changing Codex Turn, observed its durable title in Detail/List/Rail, and continued the same Thread after cold hydration.
- Twelve durable Conversations remained listable and Rail-accessible while the Host working set stayed bounded. Opening the oldest history did not require provider execution; starting the next Turn lazily resumed it and recalled `PHASE3C2-ALPHA-731`.
- After a full Host restart and new epoch, the same 12 Conversations and three-Turn Timeline were restored; the original provider Thread resumed and recalled the same marker. Temporarily moving the Project left List/Detail readable and disabled create/control until the directory was restored.
- 1536 × 1024 screenshots cover real List, real Detail/Rail, New Conversation, empty Conversation, and 12+ history. List/Detail/Dialog were also checked at 1280 × 900 with no document overflow and correct Dialog Escape focus restoration.
- The final stable browser walkthrough produced zero console errors and warnings, and the repository typecheck, lint, format, build, tests, and diff checks passed.

### Phase 3D.1 — Durable Attention Model

**Status:** implemented and validated. The accepted scope stops at the durable Host/Protocol/Client Attention boundary; the frozen Inbox UI remains Mock-backed.

Verified scope:

- SQLite migration 004 adds `attention_items` with CodeTether `attn_*` identity, exact Project/Conversation/Turn foreign keys, a stable unique semantic source key, bounded normalized payload JSON, and open/resolved/expired lifecycle.
- Reliable current semantics create only Approval, completed-review, and failed-Turn Attention. Tool failure, user interrupt, and restart interruption do not create failed items. There is no question detection because no structured provider signal exists.
- `GET /api/v1/attention` provides bounded global or Project-scoped reads, Host-owned priority ordering, and open counts. It reads the Attention index rather than Runtime Snapshot or Turn snapshot JSON.
- `POST /api/v1/attention/:attentionId/resolve` explicitly acknowledges completed-review or failed items with normal action idempotency. Approval Attention can only resolve through the exact bound Approval endpoint.
- Durable Turn finalization and Approval lifecycle writes share the relevant SQLite transaction with Attention creation/resolution. Stable source keys make Provider replay and restart idempotent.
- `attention.created` and `attention.resolved` are reliable, sequenced SSE events. Replay is process-local; `stream.reset` recovery queries the durable Attention list.
- Host restart preserves completed-review and failed items while expiring open Approval Attention with `host_restart`; it never reconstructs an actionable provider request. Migration does not backfill pre-004 Turn history.
- `packages/client` exposes typed `listAttention()` and `resolveAttention()` methods. Existing Web runtime projection treats Attention events as cursor-only and does not connect them to Inbox or Conversation state.

Not included:

- Real Inbox UI, read/unread, questions/needs-reply, Activity, Notifications, or delivery badges.
- Retry, queue/steer, provider expansion, Tauri, remote access, authentication, or persistence of provider requests/SSE/action caches.

Exit gate results:

- Fixture integration covers Approval allow/decline, exact binding, duplicate prevention, two-client fanout, replay/reset reconstruction, completed/failed restart survival, Approval restart expiry, explicit resolution, unavailable Project reads, and safe public payloads.
- A real isolated Codex run produced an Approval Attention, resolved it through Allow Once, completed the Turn, survived a full Host restart with the completed-review item intact, and explicitly marked that review resolved. A real `turn.failed` was not observed and remains fixture-validated; Tool failure was not substituted for it.
- Attention list fixtures measured approximately 1.3 ms for 100 rows and 4.6 ms for 500 rows on the validation machine; these are development observations, not production guarantees.

### Phase 3D.2 — Real Inbox UI

**Status:** implemented and validated. The accepted Desktop Inbox now consumes the durable Attention boundary without changing the frozen Conversation, Project, AppShell, or Design System structures.

Verified scope:

- `/inbox` queries up to 100 open Attention items through `packages/client` and TanStack Query, preserves Host priority order, and displays the Host-owned total/Approval/completed-review/failed summary.
- Approval items use the exact bound Approval ID and one-shot accept/decline endpoint. Completed review resolves durably before navigation; failed acknowledgement resolves only Attention, while opening a failed Conversation leaves it open and the Turn failed.
- The Primary Sidebar badge uses `summary.totalOpen`, hides at zero, and caps presentation at `99+` without deriving its value from the bounded item page.
- `attention.created` and `attention.resolved` synchronize the Inbox and badge across clients. High-frequency Conversation/Tool events do not invalidate the query; `stream.reset` and epoch replacement refetch durable Attention after Snapshot recovery.
- Loading, empty, Host-unavailable, mutation error, unavailable-Project, and 100-item-bound states are distinct. The real route contains no Mock Inbox context, question/needs-reply, unread, mark-all-read, fake risk/response metrics, retry action, provider group, or Machine metadata.

Not included:

- Structured questions/needs-reply, read/unread or processed-history UI, Activity, Notifications, Browser Push, retry-Turn, or pagination.
- Provider expansion, Tauri, remote access, authentication, queue/steer, or attachments.

Exit gate results:

- A real isolated Codex Approval appeared in two browser clients, changed the shared Sidebar count, completed both Allow Once and Decline paths, and disappeared only after the semantic resolution. The resulting completed review survived a full Host restart, resolved durably before navigation, and disappeared from the other client without refresh.
- A canonical fixture `turn.failed` traversed the real Host HTTP/SSE/SQLite/UI boundary. Opening its Conversation did not resolve it; acknowledgement removed only Attention and the durable Conversation/Turn remained failed. Tool failure was not substituted for Turn failure.
- 1536 × 1024 captures cover Approval, completed review, and failed work; the empty state was checked at 1280 × 900. A stable post-restart browser session produced zero console errors and warnings.

### Phase 3E.1 — Approval Interaction Layout Stabilization

**Status:** implemented and validated. This is a focused P1 stabilization of the accepted Conversation Detail, not a protocol or product-scope expansion.

Verified scope:

- Conversation Workspace rows are Header, independently scrolling Timeline, bounded conditional Pending Action Dock, and mounted Composer. The Dock does not enter Timeline content or the Inspector column.
- Timeline Approval entries are compact history only. Every Allow Once/Decline control lives in the Dock and remains bound to its exact public `approvalId` with independent mutation state.
- Semantic command labels keep the PowerShell wrapper out of primary Approval/Tool presentation; bounded details and Terminal retain the full normalized command.
- One and multiple pending Approvals, long command details, 1536-pixel persistent Inspector, 1280-pixel Inspector overlay, upper-history scroll preservation, bottom anchoring, and focus recovery are covered by tests and browser measurements.

Exit gate results:

- A real isolated Codex command Approval completed through Allow Once; a second real Approval was declined, did not execute, and still allowed the Turn to complete. Both left the Dock only after Host events and restored the Composer when the Turn became editable.
- The deterministic Host Protocol/SSE browser harness displayed two simultaneous Approvals, preserved exact independent identities, kept a reader's `scrollTop` unchanged through both resolutions, and bounded the Dock to 216 px with no horizontal overflow.
- 1536 × 1024 and 1280 × 900 captures cover persistent Inspector, two Approvals, long details, overlay Inspector, and resolved state. Browser sessions reported zero errors and warnings.

## Phase 4 — Desktop Productization

**Goal:** turn the accepted local Web + Host workspace into one owned desktop application before adding new workspace features or remote operation.

### Phase 4A — Tauri Desktop Shell Foundation

**Status:** implemented, validated, accepted, and frozen. Phase 4B and Phase 4C add only their separately authorized native capabilities on this lifecycle foundation.

Authorized scope:

- A Windows-first Tauri v2 application in `apps/desktop` with one native-decorated CodeTether window and the existing `apps/web` production build as its only product UI.
- A revision-coupled Host sidecar built from the existing TypeScript Host with Node's official Single Executable Application pipeline. Production runtime must not require a system Node.js, Vite server, or pnpm.
- One root development command (`pnpm desktop:dev`), one production build command (`pnpm desktop:build`), Rust validation (`pnpm desktop:check`), and a packaged-sidecar smoke path.
- Desktop-owned Host supervision on `127.0.0.1:4317`: explicit port preflight, spawn, `/api/v1/bootstrap` readiness/version validation, unexpected-exit observation, and no automatic crash-restart loop.
- A private managed-process channel: Rust sends `start` only after Windows process-tree ownership is established; `shutdown` over piped stdin requests the existing graceful Host close; parent EOF requests the same close; a Windows owned-process Job Object is the no-orphan timeout/parent-loss fallback.
- Single-instance behavior that restores/focuses the first window and never starts a second Host or SQLite writer.
- Exact production/development Origin allowlists, loopback-only Host binding, minimal CSP, and a Tauri capability file with no React shell/filesystem permission or generic command bridge.
- Existing OS data-directory semantics and `CODETETHER_DATA_DIR` test isolation; Tauri must not create a second database or product-state owner.

Not included:

- Native folder picker, notifications, system tray, custom window chrome, updater/signing/release channels, or multiple windows.
- Activity, Search, rename/archive/pin, queue/steer, attachments, Machine backend, LAN/remote access, authentication, or another provider.
- Rewriting the Host in Rust, copying business state into Tauri, changing Protocol v1, or forking Desktop-specific React product pages.

Exit gate:

- Existing Node/Web tests and type/lint/format/build checks pass, together with `cargo fmt --check`, `cargo check`, `cargo clippy`, and `cargo test`.
- A real Windows `pnpm desktop:build` produces a launchable Desktop artifact with packaged Web assets and the Node SEA Host sidecar.
- Cold launch works without a manually running Host, Vite, or Web server; the shell reports missing binary, spawn failure, port conflict, early exit, timeout, and incompatible bootstrap distinctly.
- Real Project/Conversation/Codex streaming, Tool/Diff, Approval Dock, Inbox, persistence, full exit/relaunch, lazy provider resume, running-Turn exit, and pending-Approval exit preserve their previously accepted semantics.
- Closing Desktop gracefully drains its owned Host/Codex tree; no listener or child remains. An external port occupant remains alive, and a second Desktop launch starts no second Host.
- Browser mode continues to operate against a separately launched Host with no Tauri import or product behavior fork.

Exit gate results:

- `pnpm desktop:build` produced the Windows release executable and unsigned NSIS artifact with packaged `apps/web` assets plus the revision-coupled Node SEA Host. The release executable, not an installed NSIS copy, passed isolated cold-start package smoke without a manual Host, Vite, pnpm, or system Node runtime.
- Packaged lifecycle smoke verified real `WM_CLOSE` graceful ownership cleanup, unexpected Host-exit detection, one Host for two Desktop launches, and safe refusal of both an unknown 4317 listener and an externally started CodeTether Host. No tested external process was killed or adopted, and owned process trees plus port 4317 were released.
- One-command `pnpm desktop:dev` launched Vite, Desktop, and its managed Host with no second terminal. The standalone Browser path also traversed real Projects, Conversations, durable history, and Inbox with zero browser errors or warnings and no Tauri import.
- An isolated real Codex workflow exercised Project/Conversation creation, streaming, Tools, Diff, a real command Approval through the Phase 3E.1 Dock, completed-review Inbox state, Desktop exit/relaunch, durable history, and lazy provider resume with retained context.
- Closing during a running Turn preserved durable history and restored the Turn as interrupted/idle. Closing with a pending Approval restored it only as expired `host_restart` history; it was not actionable. Normal exit left no owned Host, Codex App Server, WebView child, or 4317 listener.
- Node/TypeScript/Web validation, Rust fmt/check/clippy/test, Desktop security tests, SEA path-leak check, release packaging, and lifecycle smoke passed. Parent EOF requests graceful shutdown; abnormal parent death guarantees no orphan through the Windows Job Object but does not claim a full flush grace period.

### Phase 4B — Native Folder Picker

**Status:** implemented, validated, accepted, and frozen.

Implemented scope:

- Tauri 2.11.x registers the official Rust Dialog plugin 2.7.2 and one narrow `pick_project_directory` command. The main-window capability allows only that command; there is no Dialog wildcard, filesystem, shell, or process permission.
- The native command opens one directory-only, single-selection picker owned by the CodeTether main window and returns only the selected Unicode path string or cancellation. It accepts no arbitrary native action, path, command, or filesystem operation from React.
- A centralized Browser-safe native-capability adapter detects Tauri in one place and lazy-loads the core invoke API. Standalone Browser mode does not execute Tauri code and retains manual absolute-path Project entry.
- One `AddProjectDialog` owns both acquisition modes, optional Project name, `idle` / `picking` / `registering` states, duplicate-click protection, safe picker/Host errors, and selected basename/path presentation. The existing Host Project API remains the sole canonicalization, authorization, duplicate, and persistence boundary.
- The Projects header and empty state reuse that dialog. The global New Conversation flow hands off to the same controlled dialog when no available Project exists, then returns to Project selection without nested modal focus scopes.

Not included:

- Filesystem enumeration/read/write permissions, generic Tauri invoke/shell bridges, Project discovery/scanning, path canonicalization in React/Rust, relocation, multi-root Projects, drag-and-drop, recent folders, Open in Explorer, or a file picker.
- Notifications, system tray, custom window chrome, updater/signing, Activity, Search, Machine management, LAN/remote access, authentication, or another provider.

Exit gate results:

- Full Node/Web and Rust quality gates pass, including exact capability/security regression checks and Browser fallback tests.
- Real Windows native picker behavior passes in `pnpm desktop:dev`: the picker is main-window-owned, cancellation leaves the shared dialog open, focus returns deliberately, and long Unicode paths containing spaces and parentheses stay bounded.
- Production `pnpm desktop:build` emits the raw Desktop executable and NSIS package. The raw package cold-starts without Vite or an external Host, and the Phase 4A lifecycle/single-instance/port-ownership suite remains green.
- The generated NSIS package installs to an isolated per-user location, launches its bundled Host/Web assets, opens the real native picker, registers a real Project, completes a real Codex Conversation, exits gracefully with no owned process or 4317 listener, uninstalls, and removes its exact test state.
- Registering the same canonical directory returns the same Project identity and does not add a row. Standalone Browser manual-path registration remains functional with zero browser console errors or warnings and no Tauri runtime execution.

### Phase 4C — Desktop Notifications

**Status:** implemented, validated, accepted, and frozen.

Implemented scope:

- Existing durable Attention remains the only notification source of truth. The Desktop delivery path consumes only new `attention.created` events for Approval, completed review, and failed Turn; it never derives user need from Agent text or from `approval.requested`, `turn.completed`, or `turn.failed` separately.
- A centralized Browser-safe native notification adapter handles availability, permission, delivery, click callbacks, and the minimal focused/visible/minimized window state. Standalone Browser mode never imports or invokes native notification/window APIs and continues to use Inbox only.
- A shared Web Lock keeps the accepted HostRuntime SSE consumer eligible to run while Windows WebView2 is minimized and is released with the Desktop subscription. The native queue plus event/focus/page-show/visibility wake paths recover click intents without polling or moving Attention truth into Tauri.
- Notification intents carry only CodeTether `attentionId`, type, `projectId`, and `conversationId`, plus privacy-bounded copy derived from a clamped Project name and Conversation title. They contain no prompt, command, path, output, diff, Agent message, raw error, provider payload, or provider identity.
- A pure V1 suppression rule omits native delivery when the focused, visible, non-minimized Desktop already presents the global Inbox or exact affected Conversation. Background, minimized, other-Project, and other-Conversation work remains eligible.
- One running Desktop process deduplicates by `attentionId`, covering SSE replay, reconnect, StrictMode, and remount. Snapshot/query reconstruction, `stream.reset`, epoch replacement, and Host/Desktop restart do not replay the durable open-Attention backlog as new notifications.
- A click restores, unminimizes, and focuses the existing single-instance main window, then hands a validated public `NotificationIntent` to the Web navigation boundary. The Web opens the durable Conversation and never treats the click as Approval, review, acknowledgement, retry, or resolution.
- `/settings` contains only three Desktop notification preferences—Approval, work completed, and execution failed—and defaults all three on. The complete versioned record is written immediately to the installed WebView origin's `localStorage`, outside Project SQLite. Browser mode reports the Desktop capability unavailable rather than presenting fake delivery.
- Notification failure or denied/unavailable permission is best-effort and cannot fail the Host, Agent, Conversation, Attention, Inbox, or application. Delivery subscribes only to low-frequency semantic Attention events and does not observe message or Tool streaming.
- Tauri 2.11.5 pins the official notification plugin 2.3.3 and `tauri-winrt-notification` 0.7.3. The main capability grants only the two bounded application permissions, event listen/unlisten, focused/minimized/visible window reads, and notification permission check/request; generic notification send and unrelated native powers remain denied. Production same-origin dynamic chunks run under `script-src 'self'`, while the explicit Rust application manifest and generated allow-list retain exactly the three reviewed application commands with `removeUnusedCommands` enabled.

Not included:

- System tray, minimize-to-tray, changed close semantics, notification history/center UI, or notifications after full application exit.
- Push server, remote/mobile/browser push, email, Slack or other chat delivery, Activity, Search, or a second Alert/unread database.
- Custom sounds, volume, quiet hours, Do Not Disturb scheduling, notification aggregation, priority manipulation, or a rules engine.
- Custom window chrome, updater/signing/release channels, Machine backend, LAN/remote access, Tailscale, authentication, Claude Code, or OpenCode.

Exit gate results:

- Full Node/Web and Rust quality gates passed, including notification mapping, privacy clamp, foreground suppression, other-Conversation delivery, preference persistence, Browser unavailability, adapter failure, click validation/navigation, window focus, replay/reset/restart, deduplication, and listener lifecycle coverage.
- Windows development validation exercised real Approval and completed-review Attention plus the canonical failed fixture while CodeTether was backgrounded/minimized. Clicks returned to the exact Conversation; exact-Conversation foreground Approval produced only the Approval Dock, and click never resolved durable Attention.
- Replay, `stream.reset`, restart reconstruction, rapid distinct Attention, resolved-before-click, unavailable Project, Unicode, and long-title paths retained durable truth without duplicate delivery or accidental resolution.
- `pnpm desktop:build`, the raw release executable, and an isolated installed NSIS application verified CodeTether branding, notification display/click, single-instance restoration/focus, restart behavior, graceful close, and no residual owned processes. Standalone Browser regression remained free of Tauri execution and native errors.
- Owner acceptance is complete. Phase 4C remains bounded to best-effort delivery while the owned Desktop process and Host are running; it does not add tray or closed-app behavior.

### Phase 4D — Desktop Product Polish & Dogfooding

**Status:** implemented, validated, accepted, and frozen.

Implemented scope:

- A deterministic presentation pass groups runs of at least three adjacent routine completed Tool executions. Failed, active, test, Approval-linked, and Diff-producing work remains independently visible, and expansion restores every original normalized Tool row.
- Agent messages render a deliberately small safe Markdown subset: headings, paragraphs, ordered and unordered lists, bold text, inline code, fenced code, and allowed `http`, `https`, and `mailto` links. Raw HTML, remote images, script/iframe execution, unsafe URLs, and HTML injection remain unsupported.
- Reliably Project-contained absolute paths may be shortened in presentation only. Canonical Project roots, durable Agent messages, terminal output, and normalized change data remain unchanged; ambiguous or outside-root paths remain verbatim.
- Inbox and notification navigation can carry an existing public Turn identity through `?turn=<turnId>`. Conversation Detail focuses the corresponding Turn without resolving Attention. Selecting an Inspector Changes file locates the matching Timeline Diff without creating another Diff model.
- Desktop surfaces use denser, bounded titles, paths, Rail rows, Project metadata, Composer controls, and Settings rows. Placeholder Activity/Agents/Machines navigation and unsupported Composer actions are hidden, while user-facing errors and status copy avoid exposing Host/Runtime implementation terms.

Not included:

- Conversation organization was outside this presentation-only phase; Phase 4E.1 below later adds its durable non-React model.
- Tray/background-after-close behavior, notification history, custom window chrome, updater, remote access, or additional native capability.
- Claude Code, OpenCode, another provider, or changes to Agent/Conversation ownership.
- Persistence, Protocol v1, Host Runtime, Attention semantics, normalized event history, or a Desktop-specific React product tree.

Exit gate:

- Focused presentation tests cover Tool grouping, Markdown and safe links, contained-path display, Turn/Diff navigation, Composer autofocus, long titles and paths, minimum-window density, and product truthfulness.
- Existing Browser and Desktop product flows continue to use one shared Web UI and the frozen Host/Protocol boundaries.
- Owner dogfooding accepted the sustained-use experience; Phase 4D is frozen at commit `f0ebf69`.

### Phase 4E.1 — Durable Conversation Organization Model

**Status:** accepted and frozen at commit `afac51a`.

Implemented scope:

- SQLite migration 005 extends each durable Conversation with required `title_source` and nullable `pinned_at` / `archived_at` fields, active/archived ordering indexes, and a lightweight Project/title index. Existing titles backfill as `generated`; Project, Turn, Attention, provider Thread/Turn identities, snapshots, and `last_activity_at` remain intact. No FTS/Search service is added.
- `titleSource` distinguishes `generated` and `manual`. Manual Rename normalizes NFC and whitespace, rejects empty or over-bound titles without truncation, sets the source to `manual`, and prevents the first canonical User input from overwriting it. Unrenamed Conversations retain deterministic generated-title behavior.
- Pin/Unpin use `pinnedAt` as their only source of truth. Active history orders pinned Conversations first by `pinnedAt DESC`, then all rows by `lastActivityAt DESC` and `conversationId ASC`.
- Archive/Unarchive use `archivedAt` independently of execution status. Archive atomically clears Pin and is rejected for starting/running/waiting or open-Approval Conversations. Archived detail and completed-review/failed Attention remain readable; Start Turn returns `conversation_archived` until explicit Unarchive.
- The Project list query defaults to `archived=false`, strictly accepts `false`, `true`, or `all`, and orders archived history by `archivedAt DESC` plus identity. Organization writes update `updatedAt` but never `lastActivityAt`.
- Protocol v1 adds exact Rename, Pin/Unpin, and Archive/Unarchive request/response contracts plus the presentation-safe `conversation.updated` SSE event. `packages/client` implements all five methods with `actionId`, `AbortSignal`, response validation, and route-identity checks.
- Cold Rename/Pin/Archive writes operate on SQLite and synchronize public metadata only if a runtime record already exists. They never admit a Conversation to the bounded working set, start Codex, resume a provider Thread, or change private provider identity.

Not included:

- Search UI/backend, FTS/semantic indexing, pagination, tags, folders, groups, bulk actions, or Conversation Delete.
- Runtime refactoring, provider lifecycle changes, Attention redesign, Activity, tray/background runtime, remote operation, or another provider.

Acceptance boundary:

- Owner review confirmed migration safety, title ownership, stable active/archived ordering, archive control/Attention safety, restart durability, cold Provider isolation, typed Client behavior, and real Codex context resume. Phase 4E.1 is the frozen organization source of truth for Phase 4E.2.

### Phase 4E.2 — Conversation Organization UI

**Status:** accepted and frozen at commit `84de855`.

Implemented scope:

- `/projects/:projectId/conversations` has an active/archived organization dimension expressed by the URL. The default active view queries `archived=false`; `?view=archived` queries `archived=true`. Both use distinct TanStack Query keys and preserve Host ordering instead of re-sorting Pin, activity, or archive timestamps in React.
- Active rows expose exact Rename, Pin/Unpin, and confirmed Archive actions; archived rows expose Rename and Restore. Rename errors remain inline, Archive is disabled for visibly running/waiting work and remains Host-authoritative against races, and mutations affect only the relevant Conversation controls rather than locking the page.
- Conversation Detail exposes the same compact organization controls. Archived history remains readable in the existing Timeline/Inspector tree, shows Archive separately from execution status, and replaces Turn composition with an explicit Restore action. Successful Detail Archive navigates to the archived Project view instead of implying deletion.
- The active Conversation Rail preserves Host order and Pin markers. When a public deep link, Inbox item, or notification opens an archived Conversation, the Rail includes only that current archived item as context above active history; it does not load every archived row.
- Rename, Pin, Archive, and Unarchive use the Phase 4E.1 typed Client boundary and TanStack Query as the only frontend server-state owner. Low-frequency `conversation.updated` invalidates archive-aware indexes and detail so List, Rail, Header, Breadcrumb, archived state, and Composer controls synchronize across clients without subscribing organization queries to streaming deltas.
- Cold reads and organization mutations remain Provider-isolated. No List, Rail, Detail read, Rename, Pin, Archive, or Unarchive action starts Codex, resumes a Thread, or expands the hydrated working set; only a later Start Turn may do so.

Not included:

- Full-history/global Search, Search backend, FTS/semantic indexing, pagination, Conversation Delete, bulk actions, tags, folders, groups, or drag ordering.
- Runtime or persistence changes, provider lifecycle changes, Attention/notification redesign, Activity, tray/background runtime, remote operation, or another provider.
- A Desktop-only Conversation component tree or another local organization source of truth.

Acceptance boundary:

- Owner review confirmed active/archived URL navigation, Host ordering, Rename/Pin/Archive/Unarchive behavior, archived Detail/Composer safety, active/current-archived Rail context, multi-client `conversation.updated` synchronization, cold Provider isolation, responsive/focus behavior, restart durability, and real Codex context resume. Phase 4E.2 is frozen at `84de855`.
- Phase 4E.2 did not itself authorize a Search UI, background runtime, or another provider.

### Phase 4F.1 — Durable Conversation Search Model & API

**Status:** accepted and frozen at commit `38481ad`.

Implemented scope:

- SQLite migration 006 transactionally creates and backfills a small normalized projection over the current durable Conversation title and every canonical Turn User input. Source-table triggers update title/input documents in the same write transaction. Search never indexes `snapshot_json`, Agent output, Tool/Terminal output, Diffs, Approvals, or provider payloads.
- The runtime audit confirmed SQLite 3.52 and FTS5 in the development Node 25.8.2 runtime used to build the official SEA. V1 nevertheless uses a normalized SQLite projection plus parameter-bound `instr` queries because FTS token boundaries are not predictable for short CJK substring queries. Search remains production-safe without an extension or runtime-specific tokenizer assumption.
- Protocol v1 adds a strict Project-scoped Search query/result model and `GET /api/v1/projects/:projectId/conversations/search`. It supports active/archived/all, the real provider/status filters, default-25/max-100 cursor pagination, public match metadata, and bounded plain-text User-input previews.
- Ranking is deterministic: exact title, title prefix, title substring, then canonical User input; one representative match is returned per Conversation. Active ties prefer Pin and activity, archived ties use archive time, and public Conversation identity is the final tie-breaker.
- Opaque cursors bind Project, normalized query, and filters. Search remains available for an unavailable Project, does not touch Attention, does not read presentation snapshots, and does not hydrate, launch, or resume a provider runtime.
- `packages/client` exposes typed `searchProjectConversations()` with AbortSignal, response validation, route/filter identity checks, and cursor-progress validation. At the frozen 4F.1 boundary, the existing bounded loaded-index Search field remained unchanged and was not presented as full-history Search.

Not included:

- Formal durable Search UI, cross-Project/global Search, Agent-response/Tool/Terminal/Diff/Approval search, semantic Search, embeddings, or FTS product behavior.
- History Turn pagination, Delete, bulk actions, tags/folders/groups, Activity, tray/background runtime, remote operation, or another provider.
- Runtime, provider, Attention, Desktop native-capability, or Conversation execution-status changes.

Acceptance boundary:

- Owner review confirmed migration/backfill integrity, exact matching/ranking/filter behavior, cursor safety, Project isolation, cold/provider isolation, restart behavior, production runtime compatibility, performance/storage evidence, typed Client behavior, and the real Codex restart/Search/lazy-resume path. Phase 4F.1 is frozen at `38481ad`.
- Phase 4F.1 did not itself authorize a formal Search UI, background runtime, or another provider.

### Phase 4F.2 — Search UI & History Discovery

**Status:** accepted and frozen at `545db8c`.

Implemented scope:

- The existing Project Conversation List and real Conversation Rail enter durable Search mode for a nonblank query and remain ordinary Browse mode when it is blank. The URL carries `q` together with the existing active/archived `view`, preserving refresh, Back/Forward, and deep-link state without `localStorage` or another Search store.
- Search input is truthful about title and prior User-input scope. A 250 ms debounce plus TanStack Query identity and `AbortSignal` prevent stale requests from replacing newer text; clearing the input returns immediately to the normal archive-aware index rather than filtering a Search page or the loaded 100 summaries.
- Search uses distinct infinite-query keys for Project, normalized request identity, archive, provider, and status. It asks for 25 Host-ranked results initially and appends one opaque-cursor page only through explicit Load More; it does not auto-fetch all history, fabricate a total, re-rank results, or apply execution filters only after retrieval.
- List rows show the real Conversation summary, Pin/Archive/execution state, and an honest title or bounded canonical-User-input match explanation. The denser Rail uses the same durable API for active history with a one-line clue and keeps the current nonmatching or archived Conversation as separate orientation rather than mixing it into results.
- Canonical-User-input results reuse the existing public Turn focus hint. A retained Turn is focused; a match older than the bounded detail window opens the real Conversation and presents the established older-history boundary without hydrating a provider, parsing `snapshot_json`, or inventing history pagination.
- Rename, Pin, Archive, and Unarchive remain Host-owned organization mutations. Mutation completion and low-frequency `conversation.updated`/durable lifecycle invalidation refresh matching Search partitions so multi-client results enter, leave, rerank, archive, or restore from Host truth without subscribing Search to message/tool deltas.
- Browser and Desktop use the same Web/Client implementation. Phase 4F.2 introduces no Rust/Tauri change or native capability, and searching or opening a cold Conversation remains Provider-independent until a real Start Turn requests lazy resume.

Not included:

- Cross-Project/global Search, Agent-response/Tool/Terminal/Diff/Approval Search, semantic/fuzzy Search, embeddings, Search history/analytics, or a TopBar command palette.
- Old-Turn history pagination, Search total count, Conversation Delete, bulk actions, tags/folders/groups, Activity, tray/background runtime, remote operation, or another provider.
- A new Protocol route, SQLite projection, Search SSE event, client-owned organization state, Desktop command, or native capability.

Acceptance boundary:

- Owner review confirmed URL Browse/Search navigation, truthful match explanations, stale-request safety, cursor Load More, active/archived/status behavior, List/Rail density, public Turn focus and older-history boundary, organization actions, multi-client invalidation, cold/provider isolation, Browser/Desktop parity, responsive/focus behavior, restart, and the real Codex Search-to-lazy-resume path. Phase 4F.2 is frozen at `545db8c`.
- Phase 4F.2 did not itself authorize System Tray/background runtime, global/semantic Search, another provider, or any other next phase.

### Phase 4G.1 — System Tray & Background Runtime Foundation

**Status:** accepted and frozen at `cee3a71`.

Implemented scope:

- The native-decorated main window is no longer the application lifetime boundary. X and Alt+F4 prevent main-window destruction and hide the existing WebView to the Windows System Tray, while ordinary minimize remains a normal Windows minimize and the Desktop-owned Host/Codex process tree continues running.
- Rust creates exactly one tray after the Host passes Protocol/build readiness and before the first window reveal. It uses the configured CodeTether icon and tooltip, restores on completed left click, and exposes only `打开 CodeTether` plus `退出 CodeTether`; tray-creation failure drains the owned Host and exits instead of leaving a nonfunctional shell.
- Tray click, Tray Open, notification activation, and single-instance activation call one ready/not-quitting `show_main_window` boundary that unminimizes, shows, and focuses the same main window. Hidden second-instance activation never starts another Host or SQLite writer, and hide/show does not navigate or remount the shared React application.
- Explicit Tray Quit is guarded as a one-way/idempotent lifecycle transition and reuses the Phase 4A bounded graceful Host/SQLite/Codex shutdown before removing the tray and exiting. Window hide does not invoke restart reconciliation; explicit Quit and abnormal process loss retain the established interrupted-Turn and expired-Approval safety semantics.
- The first successful hide atomically persists one versioned Desktop-owned education marker outside Project SQLite and attempts one native “still running” explanation. Shared Settings receives only a Browser-safe read-only `backgroundRuntime.available` capability and a compact Desktop explanation with no behavior toggle; Browser mode exposes neither tray controls nor lifecycle changes.
- The Tauri built-in `tray-icon` feature is Rust-owned. Phase 4G.1 adds no Web app-exit command, generic native invoke, shell/process/filesystem capability, notification database, Attention store, Host API, provider control, or second Runtime projection.
- The unpreventable Tauri exit path performs a best-effort synchronous Host drain and the Windows Job Object still guarantees no owned orphan after parent loss. Exact Windows sleep/resume and session-end handling remained outside the 4G.1 boundary and is added separately in Phase 4G.2 below.

Not included at the frozen 4G.1 boundary:

- Start with Windows, a close-behavior setting, tray badges/dynamic Attention counts, recent Project/Conversation menus, inline tray Approval actions, multiple windows, or minimize-to-tray.
- Notifications after explicit application exit, a notification-history center, application DND/sound controls, remote/mobile/browser push, email/chat delivery, or an OS background daemon.
- Automatic Host restart, updater/signing, custom window chrome, remote access, global/semantic Search, Activity, Machine management, or another provider.
- A stronger Windows session-ending contract, sleep/wake recovery policy, or macOS/Linux tray validation.

Acceptance boundary:

- Owner review confirmed X and Alt+F4 hide behavior, one tray and process tree, Host/epoch preservation, hidden second-instance restore, route/scroll/Approval preservation, background SSE and Approval/completed/failed notification delivery, exact notification navigation, running Turn and pending Approval continuity, idempotent explicit Quit, unexpected-Host/startup failure behavior, Browser isolation, raw release/installed NSIS behavior, process/port cleanup, and real Codex background flows. Phase 4G.1 is frozen at `cee3a71`.
- Phase 4G.1 did not itself authorize Windows session/background reliability, Start with Windows, notification-history work, or another provider. Phase 4G.2 below is a separately bounded lifecycle reliability scope.

### Phase 4G.2 — Windows Session & Background Reliability

**Status:** accepted and frozen at `f576b05`.

Implemented scope:

- The accepted window/application contract is unchanged: X and Alt+F4 hide the existing main window only, while `退出 CodeTether` is the sole normal product exit and retains the idempotent 12-second graceful owned-Host/SQLite/Codex shutdown ceiling.
- One native lifecycle reducer tracks Desktop application, window, Windows power/session, and owned-Runtime state independently. Session lock/unlock is observed without changing window visibility, Agent execution, or product truth.
- Windows sleep records suspension and performs no Host shutdown, forced restart, provider interruption, or Approval expiry. Exactly one recovery is admitted for each resume cycle.
- Resume performs one bounded check of the exact owned Host: the recorded child must remain live and one loopback bootstrap response must match Protocol v1, the revision-coupled build identity, and the startup Host epoch. A live but temporarily unresponsive owned child is not killed or replaced; an exited/incompatible/identity-changed child enters the existing failure cleanup boundary. No automatic restart loop is introduced.
- After the native resume check, one process-local event carries the exact startup-owned Host epoch to the existing application HostRuntime. One application-scoped listener asks the Runtime to close or abort its possibly half-open SSE transport; the Runtime re-reads bootstrap, rejects any other epoch, and only then lets the ordinary stream loop reconnect with its current `Last-Event-ID` and accepted replay, `stream.reset`, sequence, and Snapshot replacement semantics. There is no second stream, poller, Runtime projection, or recovery protocol.
- `WM_QUERYENDSESSION` performs only an immediate process-memory transition and returns allow without Host, filesystem, or network work. A cancelled end session restores the prior lifecycle. Confirmed `WM_ENDSESSION` receives a distinct 2-second best-effort bounded owned-Host termination attempt, then yields to Windows teardown; it does not claim the 12-second Tray Quit guarantee.
- Abnormal Desktop/parent loss still closes the Windows Job Object and therefore the owned Host/Codex process tree. On the next launch, the accepted durable restart reconciliation marks incomplete Turns interrupted and process-live Approvals expired; Phase 4G.2 does not attempt automatic process recovery.
- Windows Explorer tray recreation remains handled by the pinned Tauri 2.11.5 `tray-icon` feature and locked `tray-icon` 0.24.2 implementation. CodeTether adds no tray poller, duplicate tray registry, or second lifecycle owner.

Not included:

- Start with Windows, a close-behavior or sleep/wake setting, minimize-to-tray, automatic Host restart, an OS daemon, multiple windows, or a CodeTether-specific Explorer watcher.
- Tray Attention badges/counts, recent Project/Conversation menus, inline Approval actions, notifications after explicit Quit, notification history, push/email/chat delivery, custom sounds/schedules, updater/signing, custom window chrome, Activity, Machine management, remote access, or another provider.
- A Protocol v1 change, native business command, new Tauri Web permission, durable lifecycle log, provider-state copy, second Attention/Runtime projection, or macOS/Linux lifecycle claim.

Validation boundary:

- Focused Rust lifecycle/reducer/message tests, Host/Web resume-reconnect tests, and packaged Windows lifecycle smoke cover repeated suspend/resume and lock/unlock cycles, a single check/reconnect per cycle, exact Host PID/epoch preservation, cancelled and confirmed session end, the 2-second termination budget, close-to-tray after cancellation, crash cleanup, and process/port release.
- Real raw-release evidence covers hidden idle sleep/wake, pending Approval sleep/wake and later resolution, Explorer restart with one recovered tray, and a 30-minute background soak with real Codex Turns. Confirmed session end and repeated power/session cycles remain explicitly simulated; real logoff/shutdown, an actively executing Turn at the exact suspend instant, and a controlled provider-network change after wake have not been observed.
- The pinned Tauri/`tray-icon` boundary remains responsible for Explorer tray recovery rather than a CodeTether re-registration loop. Final clean post-commit evidence confirmed matching Desktop/Host build identity from `f576b05` without `-dirty`, installed NSIS smoke, exact Tray Quit, zero remaining CodeTether processes, and zero port-4317 listeners. A real installed Sleep occurred but its automation-parent Job ended before post-wake runtime identity could be observed, so installed-runtime continuity is explicitly unobserved; real OS logoff/shutdown, dedicated Win+L, provider-network-change, and active-Turn-at-suspend remain separately unobserved.

Acceptance boundary:

- Owner acceptance freezes Phase 4G.2 at `f576b05`. Further Desktop lifecycle polish is not authorized unless a later Provider phase introduces a specific regression.
- This acceptance does not broaden the observed-vs-simulated lifecycle claims above and does not authorize Start with Windows, automatic Host restart, or another native product surface.

## Phase 5A — Second Provider Foundation: Claude Code

**Status:** accepted and frozen at `a1329f2`.

Implemented architecture:

- A narrow Provider contract now exists only at the proven Host boundary. One `ProviderRegistry` maps immutable durable `codex | claude-code` Conversation identity to the owning runtime; the existing Conversation-create, Turn, read, organization, Search, Attention, Snapshot, and SSE APIs remain Provider-neutral. There are no Provider-specific Web endpoints or Client methods.
- Protocol v1 adds presentation-safe availability and capability descriptors, canonical Provider errors, and Read/Edit/Shell/Search/Generic Tool kinds. It never exposes executable paths, private session/Turn identities, raw Codex JSON-RPC, Claude JSONL, stderr, or ranking/runtime internals.
- SQLite migration 007 (`provider_foundation`) transactionally widens the Conversation Provider constraint and rebuilds the dependent Turn/Attention/Search graph while preserving all Project, existing Codex Conversation/session identity, title/organization/activity, Turn/snapshot, Attention, Search-document, index, and trigger data.
- Both Providers share the existing process-wide eight-Conversation hydrated working-set limit. List, Detail, Rail, Search, Rename, Pin, Archive, and Unarchive remain cold and never spawn or resume either CLI; only real Turn control performs native Provider hydration/resume.
- Claude Code detection safely resolves a native executable or verified npm installation and performs bounded version/authentication checks once per Host lifecycle. Public states distinguish available, not installed, unsupported version, misconfigured, and unavailable without revealing the executable path or raw diagnostic.
- Claude session creation uses a native UUID session identity; restart continuation uses the CLI's native `--resume` contract and never re-prompts full durable history to imitate context. One active Turn owns one child process, executes in the already authorized Conversation working directory, receives bounded canonical User input through JSONL stdin, and uses structured argv with `shell: false`.
- Claude text and high-confidence Tool events normalize into the existing semantic stream. Read, Edit/Write paths, and Glob/Grep map to bounded canonical Tool fields; unavailable Bash/PowerShell and unknown Tools remain Generic rather than publishing a raw command or relying on name heuristics. Public payloads stay bounded and presentation-safe.
- The Phase 5A Claude execution profile is intentionally restricted to Read/Glob/Grep under noninteractive `dontAsk`, strict MCP, and no permission bypass. Its descriptor advertises streaming, native resume, Read, Search, and Tool events, but not machine-readable Approval, interrupt, Edit, Shell, Diff, model selection, or Codex-style reasoning control. Shared UI hides or disables unsupported controls while Codex retains its established capability surface.
- New Conversation can select an actually available Codex or Claude Code Agent. Provider identity remains fixed afterward; mixed-Provider Conversations share one Project index, Rail, organization model, Search projection, Inbox, Attention, and notification presentation without Provider switching or handoff.
- Provider failures are scoped to their registry entry and map to bounded canonical errors such as not installed, unsupported version, start failure, lost session, or unavailable. One failed Provider does not fail the other's live work, and history remains readable while an executable is unavailable.

Not included:

- Cross-Provider Conversation switching, handoff, delegation, transcript replay, Claude Agent Teams/subagents, OpenCode, Gemini, Provider marketplace, or global Provider-settings work.
- Claude capability expansion beyond the restricted foundation remains deferred to separately reviewed capability phases; no bypass mode is authorized.
- Remote Provider execution, Mobile, MCP management UI, Queue/Steer, Attachments, or changes to the frozen Phase 4G Desktop lifecycle outside a demonstrated regression.

Exit gate:

- Real installed Claude Code detection, a real streamed Conversation, basic real Tool normalization, native restart/resume marker retention, mixed Codex/Claude history, durable Search/organization compatibility, cold Provider isolation, background Tray completion with no orphan, installed Desktop smoke, and clean Codex regressions must all pass.
- Fixture parser/process tests supported but did not replace the required REAL Claude Code evidence. Owner acceptance froze the implementation and clean post-commit installed/background evidence at `a1329f2`.

## Phase 5B — Claude Code Capability Expansion

**Status:** accepted and frozen at `5dac13c`.

Implementation scope:

- Re-audit the installed Claude Code CLI before changing any capability. Only stable noninteractive machine-readable behavior may cross the existing Provider adapter; terminal scraping, fake parity, Provider-specific public APIs, transcript replay, and Conversation Provider switching remain forbidden.
- Preserve the accepted Read/Glob/Grep-only production launch profile, strict MCP boundary, `dontAsk`, structured argv, JSONL stdin, and `shell: false`. Observed Edit/Write paths may be normalized defensively, while unexpected Bash/PowerShell envelopes remain Generic without exposing their commands; the corresponding product capabilities remain false until a safe permission contract is proven.
- Enrich canonical Tool events from stable structured Tool identity with bounded presentation-safe command/path clues. Raw Claude Tool IDs, protocol objects, stderr, private session identity, absolute escaping paths, and arbitrary environment data remain private.
- Expose the installed CLI's real `--effort` values through generic Host-owned reasoning metadata and a Provider-labelled “思考强度” control. This is not a claim that Claude effort is semantically equivalent to Codex reasoning. Unknown/stale values fail as `invalid_request` before Provider launch.
- Keep Approval, reliable interrupt, Edit, Shell, Diff, and model selection unsupported unless real evidence proves every required safety and lifecycle property. A documented flag or interactive terminal affordance alone is insufficient.
- Stress native resume across repeated Host restarts, cold organization/Search, background completion, and mixed Provider history. Test bounded simultaneous Claude Conversations under the existing shared eight-Conversation admission budget and verify process/event isolation and cleanup.
- Run complete Codex, Desktop managed-Host/Tray, installed package, Search/organization, and process-ownership regressions without modifying the frozen Phase 4G lifecycle absent a demonstrated regression.

Not included:

- Claude Approval simulation, auto-approval, bypass permissions, terminal/ANSI scraping, generic Host shell/filesystem APIs, or CodeTether-owned command execution.
- Provider switching/handoff/delegation, transcript replay fallback, Claude Agent Teams/subagents, MCP/plugin/hooks management, OpenCode/Gemini, remote Provider execution, or global Provider settings.
- A Claude-specific Timeline, Diff UI, Search system, organization model, Attention store, Client endpoint, or durable Conversation schema.

Exit gate:

- The public capability matrix matches real installed Claude Code behavior, real effort choices and richer Tool normalization pass, unsupported capabilities have explicit evidence-based reasons, repeated resume/concurrency/mixed-Provider/background flows are truthful, Codex and installed Desktop regressions pass, all process/port cleanup succeeds, and the working tree ends clean in one coherent commit.
- REAL, SIMULATED, UNSUPPORTED, and NOT OBSERVED evidence remain distinct. Owner acceptance freezes the evidence-driven capability matrix at `5dac13c`: streaming, native resume, Read, Search/Glob/Grep, Tool events, and native effort control are supported; Edit/Write, Shell, Diff, interrupt, Approval, and model selection remain intentionally unsupported.

## Phase 6A — Durable Machine Foundation

**Status:** accepted and frozen at `0858fc7`.

**Goal:** make Machine a durable first-class execution identity while retaining exactly one truthful local Windows Machine.

Implementation scope:

- SQLite migration 008 creates one random durable `machine_*` local identity, moves the existing authorized root out of the logical Project into a Machine-scoped `project_locations` row, and backfills every Conversation with the same required immutable `machine_id` without changing Provider/session, Turn, Attention, Search, or organization identity.
- Protocol v1 and the typed Client add strict Machine list/detail reads. The public Machine record contains only a safe display name, local kind, platform, architecture, availability, timestamps, and implemented CodeTether-level capabilities; it contains no hardware fingerprint, hostname, user, network address, process identity, or command surface.
- Machine and Provider registries remain separate. The Host composes Provider descriptors for the selected Machine, requires an available Project Location and Provider when creating a Conversation, and keeps the existing ordinary Provider-neutral create/Turn APIs.
- Every new Conversation request supplies `projectId`, `machineId`, and Provider. Both Machine and Provider are immutable after creation. Existing data migrates to the canonical local Machine, and cold reads, Search, organization, Project reads, and Machine detail do not hydrate or resume a Provider.
- `/machines` and `/machines/:machineId` show only real local metadata, actual Providers, registered Projects, and bounded recent Conversations. New Conversation preselects the sole eligible Machine but submits its real identity; Project and Conversation surfaces display the Machine without a switch control.
- Machine identity survives ordinary Host/Desktop restart, Windows reboot, and update through the retained data root. Deleting the data root is explicitly a new-install identity boundary. Phase 6A adds no native capability and does not alter the accepted Phase 4G lifecycle.

Not included:

- SSH, remote transport/control, pairing, trust exchange, LAN/mDNS discovery, relay, incoming listener, remote filesystem/Terminal/shell, port forwarding, synchronization, Wake-on-LAN, or fake remote Machine records.
- Machine add/remove/rename, a second Project Location, Project relocation, moving an existing Conversation between Machines, resource monitoring, heartbeat/telemetry loops, or a third Provider.

Exit gate:

- Exactly one stable local Machine exists after migration/restart; every Project has its preserved local Location; every existing/new Conversation has the correct immutable Machine; mixed Codex/Claude execution, native resume, Search/organization/Attention, cold isolation, and frozen background behavior remain correct.
- The real Machines UI and explicit New Conversation binding use Host truth, the clean installed Desktop retains Machine identity and cleans up all owned processes/listeners, evidence is classified truthfully, and the working tree ends clean in one coherent commit.

## Phase 6B.1 — Remote Node Identity & Secure Pairing

**Status:** accepted and frozen at `30559a3`.

**Goal:** establish the first trustworthy LAN relationship between the existing Desktop-owned Host and a second real Machine running a minimal CodeTether Node, without executing Projects, Conversations, or Providers remotely.

### In scope

- A minimal independently launched Node with a durable random Machine identity and private cryptographic identity, explicit short-lived one-time pairing mode, clean shutdown, and no Provider/process child ownership.
- Manual LAN address plus short-code pairing, PAKE-based proof, a separate presentation-safe Machine confirmation step, durable pinned peer trust, protocol-version negotiation, authenticated reconnect after either side restarts, and identity-mismatch failure without silent key replacement.
- Transactional migration 009 preserves the accepted local Machine and complete Project/Conversation graph while admitting bounded remote Machine records plus private trust metadata. Pairing codes, reusable bearer tokens, private keys, handshake transcripts, process identity, and Provider identities remain absent from public Machine data.
- `/machines` and `/machines/:machineId` truthfully show local and paired remote Machines, authenticated online/offline/authentication/incompatible state, safe platform/architecture/name metadata, and explicit online unpair. Remote capabilities remain false; Provider/Project/Conversation sections remain empty rather than fabricated.
- Strict bounded Host ↔ Node framing, TLS encryption, authenticated identity, attempt/rate/connection/timeout limits, bounded heartbeat/backoff, log redaction, application-private credential files (POSIX mode hardening and inherited Windows user-data ACLs), and no shell/filesystem/process/generic-RPC surface. Phase 6B.1 does not claim OS credential-vault storage.

### Out of scope

- Remote Project Location, Conversation, Turn, Codex, Claude Code, Terminal, filesystem, Git, Diff, Approval, process execution, SSH/SFTP/SCP, sync, port forwarding, Wake-on-LAN, discovery, firewall modification, relay, NAT traversal, accounts, or Machine switching for existing Conversations.

### Exit gate

- A separate-process Node can be explicitly paired, confirmed, authenticated, persisted, restarted/reconnected without code reuse or duplicate Machine records, shown truthfully online/offline, and explicitly unpaired; wrong identity and malformed/replayed/expired/rate-limited attempts fail closed. Local Machine, mixed Provider, Search/organization/Attention, frozen background lifecycle, process cleanup, tests, and clean build identity remain correct.

## Phase 6B.2 — Secure Connection Recovery & Address Mobility

**Status:** current approved implementation scope; not accepted or frozen.

**Goal:** let an already trusted remote Machine recover across an ordinary LAN endpoint change without making network location an identity or requiring unnecessary re-pairing.

### In scope

- A transactional bounded endpoint-hint model private to the Host, with one authenticated preferred endpoint, bounded alternatives, success/failure timestamps, duplicate suppression, and deterministic eviction.
- One cancellable reconnect worker per trusted Machine, ordered preferred/fallback attempts, capped exponential jittered backoff, explicit Retry, and a manual address update that promotes only after the accepted pinned TLS/Machine/Node identity checks succeed.
- Truthful online/connecting/offline/authentication/recovery/incompatible presentation plus a compact Connection section. A wrong Node at a remembered or candidate endpoint fails closed without trust replacement, Machine duplication, or endpoint poisoning.
- IPv4 and robust private IPv6 endpoint parsing. Link-local IPv6 remains unsupported until scope/interface handling is trustworthy. LAN discovery is investigated but not shipped; no unauthenticated hint establishes trust.

### Out of scope

- Remote Project Location, Conversation, Turn, Provider, Terminal, filesystem, Git, Diff, Approval, process execution, SSH/SFTP/SCP, sync, discovery shipment, port forwarding, Wake-on-LAN, firewall modification, relay, NAT traversal, public Internet access, or Machine switching.

### Exit gate

- A real trusted Node survives restart and address change as the same cryptographic Machine without re-pairing; a different Node at the same endpoint fails closed; endpoint history and workers remain bounded; installed Desktop restart, local behavior, Provider isolation, cleanup, tests, and clean build identity remain correct.

## Phase 7 — Remote LAN / Tailscale

**Goal:** securely monitor and control a machine host from another device over a user-managed trusted network.

Planned outcomes:

- Authenticated and encrypted remote client/host connection.
- LAN and Tailscale-style discovery/configuration guidance.
- Reconnect, event catch-up, command authorization, and audit behavior.
- Remote monitor, approve, reply, interrupt, and resume flows.

Exit gate: a remote web/mobile client can safely operate the supported loop without a public cloud relay.

## Phase 8 — OpenCode

**Goal:** add OpenCode through the established adapter model.

Planned outcomes:

- OpenCode detection, capabilities, session lifecycle, and normalized events.
- Provider comparison and compatibility coverage.
- No provider-specific branching in shared product UI unless an approved capability difference requires it.

Exit gate: OpenCode passes the shared adapter contract and core conversation workflows without weakening existing providers.

## Phase 9 — Mobile Polish

**Goal:** make the remote companion exceptional for short, high-value interventions.

Planned outcomes:

- Refined Monitor, Approve, Reply, and Resume flows.
- Notification deep links and urgency-aware navigation.
- Touch, small-screen, connectivity, latency, and accessibility polish.
- Explicit separation from desktop-only dense workflows.

Exit gate: core mobile tasks are fast, legible, safe, resilient, and validated on representative devices.

## Deferred Beyond This Roadmap

- Team collaboration.
- Enterprise administration and policy.
- Cross-agent conversation handoff.
- Public cloud relay.
