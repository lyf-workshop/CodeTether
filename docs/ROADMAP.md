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

**Status:** implementation, automated validation, and real browser-control validation are complete; awaiting review.

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

## Phase 3 — Conversation Management

**Goal:** make conversations durable and manageable beyond a single live run.

Planned outcomes:

- Persistence and schema migration strategy.
- Conversation creation, listing, history, resume, interruption, termination, and failure recovery.
- Project association, model/reasoning/permission metadata, changes, and relevant activity history.
- Reconnection behavior without duplicate execution.

Exit gate: supported Codex conversations survive application/host restarts and can be found, inspected, and resumed reliably.

## Phase 4 — Machines

**Goal:** model and operate more than one trusted machine coherently.

Planned outcomes:

- Stable machine identity and capability/availability status.
- Project locations and conversations associated with machines.
- Clear offline, reconnecting, incompatible, and unavailable states.
- Machine trust and authorization foundations.

Exit gate: users can understand which trusted machine owns a project or conversation and safely target supported operations.

## Phase 5 — Remote LAN / Tailscale

**Goal:** securely monitor and control a machine host from another device over a user-managed trusted network.

Planned outcomes:

- Authenticated and encrypted remote client/host connection.
- LAN and Tailscale-style discovery/configuration guidance.
- Reconnect, event catch-up, command authorization, and audit behavior.
- Remote monitor, approve, reply, interrupt, and resume flows.

Exit gate: a remote web/mobile client can safely operate the supported loop without a public cloud relay.

## Phase 6 — Claude Code

**Goal:** validate that the provider-neutral architecture supports a second agent.

Planned outcomes:

- Claude Code detection, models/capabilities, session lifecycle, and event translation.
- Explicit handling for capability differences without leaking raw protocol concepts into UI.
- Regression coverage across Codex and Claude Code.

Exit gate: supported Claude Code conversations work through the same core product model. Cross-agent handoff remains prohibited.

## Phase 7 — OpenCode

**Goal:** add OpenCode through the established adapter model.

Planned outcomes:

- OpenCode detection, capabilities, session lifecycle, and normalized events.
- Provider comparison and compatibility coverage.
- No provider-specific branching in shared product UI unless an approved capability difference requires it.

Exit gate: OpenCode passes the shared adapter contract and core conversation workflows without weakening existing providers.

## Phase 8 — Mobile Polish

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
