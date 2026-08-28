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

**Status:** implemented and validated. This lifecycle foundation remains frozen while Phase 4B adds only native directory acquisition.

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

**Status:** implemented and required validation complete; Owner acceptance is pending. Do not mark this phase accepted or frozen until Owner review.

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

## Phase 5 — Machines

**Goal:** model and operate more than one trusted machine coherently.

Planned outcomes:

- Stable machine identity and capability/availability status.
- Project locations and conversations associated with machines.
- Clear offline, reconnecting, incompatible, and unavailable states.
- Machine trust and authorization foundations.

Exit gate: users can understand which trusted machine owns a project or conversation and safely target supported operations.

## Phase 6 — Remote LAN / Tailscale

**Goal:** securely monitor and control a machine host from another device over a user-managed trusted network.

Planned outcomes:

- Authenticated and encrypted remote client/host connection.
- LAN and Tailscale-style discovery/configuration guidance.
- Reconnect, event catch-up, command authorization, and audit behavior.
- Remote monitor, approve, reply, interrupt, and resume flows.

Exit gate: a remote web/mobile client can safely operate the supported loop without a public cloud relay.

## Phase 7 — Claude Code

**Goal:** validate that the provider-neutral architecture supports a second agent.

Planned outcomes:

- Claude Code detection, models/capabilities, session lifecycle, and event translation.
- Explicit handling for capability differences without leaking raw protocol concepts into UI.
- Regression coverage across Codex and Claude Code.

Exit gate: supported Claude Code conversations work through the same core product model. Cross-agent handoff remains prohibited.

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
