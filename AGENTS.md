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

**Phase 4F.1 — Durable Conversation Search Model & API** is implemented; Owner acceptance is pending. Phase 4E.2 is accepted and frozen at `84de855`, Phase 4E.1 is accepted and frozen at `afac51a`, and Phase 4D, Phase 4C, Phase 4B, Phase 4A, Phase 3E.1, and the **CodeTether Local Workspace Alpha** remain frozen. The accepted frontend is still **CodeTether V2 Frontend Core v1**, the accepted local runtime is still **Phase 2A Codex Runtime v1**, Protocol v1 remains the **Phase 2B Client ↔ Host Protocol** boundary, and the durable Project/Conversation/Attention data layer remains authoritative. Phase 4F.1 adds a Project-scoped durable Search read model over Conversation titles and canonical User inputs without connecting it to the formal React Search UI or changing provider/runtime behavior. The current product boundary includes:

- A Project as a durable, authorized local workspace with a CodeTether-owned `proj_*` identity, name, canonical root path, timestamps, and availability computed from the filesystem rather than stored as durable truth.
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
- SQLite migration 005 (`conversation_organization`), which adds required `title_source` plus nullable `pinned_at` and `archived_at` metadata and active/archived/title indexes without changing Conversation, Project, Turn, Attention, or private provider identity. Existing titles backfill as `generated`.
- Durable manual Rename, Pin/Unpin, and Archive/Unarchive Host mutations through additive Protocol v1 contracts and typed `packages/client` methods. Manual titles normalize NFC/whitespace and fail rather than truncate outside their wire/grapheme bounds; a manual title is never overwritten by first-input generation.
- Active Conversation ordering is pinned first (`pinnedAt DESC`), then `lastActivityAt DESC` and `conversationId ASC`; archived history is ordered by `archivedAt DESC` and identity. Archive atomically clears Pin and never advances `lastActivityAt`.
- Archived Conversation history and completed/failed Attention remain readable, but new Turn control fails with `conversation_archived` until explicit Unarchive. Running, starting, waiting, or open-Approval Conversations cannot be archived.
- Reliable low-frequency `conversation.updated` events carry only the public `ConversationSummary` after changed organization mutations. Cold organization writes update SQLite/public runtime metadata without hydrating or resuming Codex.
- The real Project Conversation route expresses active or archived history in URL state, fetches the matching Host-owned index through distinct TanStack Query keys, and preserves Host ordering. Active rows expose bounded Rename, Pin/Unpin, and safe Archive controls; archived rows expose Rename and explicit Unarchive without inventing Delete, bulk actions, tags, folders, or local metadata.
- Real Conversation Detail and its Rail consume the same organization truth. Archived history stays readable with an explicit archived banner and disabled Composer plus Restore action, while the Rail keeps the active index and adds only the currently viewed archived Conversation as bounded context. Organization actions never hydrate a cold Conversation; only later Turn control may resume Codex.
- `conversation.updated` drives low-frequency invalidation of active/archived indexes and detail so Rename, Pin, Archive, and Unarchive synchronize across List, Rail, Header, Breadcrumb, archived state, and multiple clients. No organization field is copied to Zustand, `localStorage`, or another React store.
- SQLite migration 006 (`conversation_search`) adds a normalized projection containing one title document per Conversation and one canonical User-input document per Turn. Existing durable titles and inputs backfill transactionally; triggers update the projection in the same source transaction after Conversation creation, generated/manual title changes, and durable Turn input writes. Snapshot JSON, Agent output, Tool/Terminal output, Diff bodies, Approval commands, and provider payloads are never indexed.
- Protocol v1 exposes strict Project-scoped `GET /api/v1/projects/:projectId/conversations/search` reads with active/archived/all, provider, and execution-status filters plus bounded cursor pagination. Results contain only a public `ConversationSummary`, an exact `title` or `user_input` match reason, and for input matches a bounded plain-text preview plus public `turnId`; private provider identities, working directories, full Turns, and SQLite details remain absent.
- Search matching is an explainable SQLite substring query over NFC-normalized, Unicode-lowercased, whitespace-collapsed projection text. Exact title, title prefix, title substring, and User-input matches form stable rank tiers; one Conversation appears once. Opaque cursors bind Project, normalized query, and filters. Search never reads `snapshot_json`, hydrates a cold Conversation, starts Codex, resumes a provider Thread, or checks Project filesystem availability.
- `packages/client` exposes the typed `searchProjectConversations()` read with AbortSignal and route/filter/response validation. Phase 4F.1 deliberately leaves the existing loaded-index Conversation search field unchanged; the formal durable Search UI is not yet implemented.
- A real `/projects/:projectId/conversations` product history surface, real Project-derived Current Project context and breadcrumbs, and a real Conversation Rail driven by the durable index rather than Runtime Snapshot or Mock data.
- A minimal Codex-only New Conversation dialog through the typed Client boundary. A Project route locks its real Project; global entry requires selection of one available Project and uses Host-owned model/reasoning defaults.
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
- A private Desktop-managed lifecycle mode. The Host waits for Rust's `start` activation before runtime initialization, so the supervisor can establish owned process-tree containment first. Rust requests normal graceful shutdown through a piped `shutdown` line and waits for Host persistence and Codex cleanup. The managed Host treats parent stdin EOF as another graceful-shutdown request; on abnormal Windows parent death, a Job Object guarantees owned process-tree cleanup but may win the EOF race before a full flush grace period.
- Single-instance Desktop startup, explicit `127.0.0.1:4317` conflict handling, `/api/v1/bootstrap` readiness/version checks, and no silent attachment to or termination of an external process.
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
- A denser truthful Desktop surface: placeholder Activity/Agents/Machines navigation is absent from the primary Sidebar, unsupported Composer actions are hidden, long titles/paths are bounded with full-text affordances, Project IDs leave the primary overview, and user copy avoids exposing Host/Runtime implementation terms.

Phase 4C remains bounded to best-effort native delivery while the Desktop process and its owned Host are running. Phase 4D, Phase 4E.1, and Phase 4E.2 are accepted and frozen. Phase 4F.1 is implemented but must not be described as accepted or frozen until Owner review. It authorizes only the exact durable title/User-input Search model, Project-scoped API, cursor pagination, and typed Client boundary above. A formal Search UI, Agent/Tool/Terminal/Diff search, semantic or cross-Project Search, history pagination, Delete, bulk organization, tags/folders/groups, tray behavior, closed-app notifications, a Notification Center/history, push infrastructure, custom window chrome, updating/signing infrastructure, Activity, Machine management, remote operation, and another provider remain unauthorized.

## Out of Scope

During and after Phase 4F.1, do not implement without a separately approved phase:

- Visual redesigns or unrelated refactors to the frozen Design System, AppShell, Inbox, Conversations, Conversation Workspace, or accepted Projects UI.
- Activity, Machines, Agents, a broader Settings redesign, an advanced New Conversation flow, or any other new product-page content or flow beyond the exact notification preferences.
- Live Host data in another frozen page.
- A generic WebSocket RPC transport or interactive PTY transport.
- System tray behavior, notifications after full application exit, notification-history UI, push/email/chat delivery, custom sounds or schedules, custom window chrome, auto-update, signing/release channels, drag-and-drop folders, recent-folder menus, Open in Explorer, or any other native product feature beyond the exact Phase 4B picker and Phase 4C notification delivery.
- A generic Tauri command runner, arbitrary shell bridge, arbitrary filesystem capability, or a second Client-to-Host business protocol.
- Project discovery/scanning, rename/relocate, multiple Project locations, Machine management, remote access, relay, or authentication.
- The formal durable Search UI, cross-Project/global Search, Agent response or Tool/Terminal/Diff/Approval search, FTS/semantic/embedding search, history pagination, Conversation Delete, bulk organization, tags, folders, groups, or drag reordering. Phase 4F.1 exposes only the Project-scoped title/canonical-User-input backend and typed Client boundary.
- Filesystem deletion, recursive cleanup, cascading Project deletion, or automatic reassignment of existing Conversations to another Project.
- Stop/thread termination, Turn queueing, steering, retry-Turn, attachments, images, voice, Skill upload, or another React write path beyond minimal Codex Conversation creation, text Turn start, one-shot Approval resolution, and interrupt.
- Actionable Approval recovery across restart, `Always Allow`, automatic approval, or a production permission-policy system. Expired Approval history may be retained only to explain what happened.
- Claude Code or OpenCode adapters, speculative provider implementations, or cross-agent conversation handoff.
- Mobile screens, team, enterprise, public cloud relay, or other later-phase platform features.
- Event sourcing, CQRS, an ORM, a repository hierarchy, a durable provider-event log, or durable exactly-once command processing.
- Durable Approval resolution across restart. A pre-restart provider request is no longer actionable after its process dies.

Do not install dependencies for an out-of-scope runtime merely because its directory exists.

## Core Entities

### Project

A durable, authorized local workspace in which an agent operates. It has one canonical local root and computed availability, and its real list/add/detail/remove UI is backed by the Host-owned record. It does not yet support discovery, relocation, or multiple Machine locations.

### Conversation

The durable unit of user-agent work and history. It is associated with one Project, one Agent, one Machine, plus a model, reasoning setting, permission mode, and event history. In the current model it never changes agents.

### Agent

A coding-agent provider/runtime, initially Codex and later Claude Code, OpenCode, and others through adapters.

### Machine

A computer capable of hosting projects and running agent sessions. A conversation executes on one machine at a time.

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
