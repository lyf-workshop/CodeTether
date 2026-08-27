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

**Phase 3D.2 — Real Inbox UI** is implemented and validated. The accepted frontend remains frozen as **CodeTether V2 Frontend Core v1**, the accepted local runtime remains frozen as **Phase 2A Codex Runtime v1**, Protocol v1 remains the accepted **Phase 2B Client ↔ Host Protocol** boundary, the complete read path remains frozen as **Live Conversation Read Model v1**, and the durable Project/Conversation/Attention data layer remains authoritative. The current product boundary now also includes:

- A Project as a durable, authorized local workspace with a CodeTether-owned `proj_*` identity, name, canonical root path, timestamps, and availability computed from the filesystem rather than stored as durable truth.
- SQLite migration 002 (`projects`), which adds the `projects` table and binds every durable Conversation to one Project through a non-null `project_id` foreign key. The Conversation `cwd` remains a contained working directory, not a second Project identity.
- Protocol v1 Project list, read, create, and delete commands plus Project-aware Conversation creation by `projectId`.
- Idempotent Project registration by canonical root: creating the same authorized root returns the existing Project instead of duplicating it.
- Real-path authorization at registration and again before every new Turn or provider resume. A missing, moved, or identity-changed root leaves durable history readable but makes workspace-dependent control fail with `project_unavailable`.
- Durable authorization across Host restarts and lazy Codex Thread resume only after the saved Project root and Conversation working directory are revalidated.
- Registration-only deletion: CodeTether never deletes workspace files, never cascades Conversation history, and rejects Project deletion while any durable/runtime Conversation references it or a Conversation creation has reserved it.
- A deprecated Protocol v1 `cwd` compatibility request that may resolve only to an already registered, available Project; it cannot create a Project or expand the Host's trusted roots.
- A real `/projects` list and `/projects/:projectId` overview backed by the existing Host Project API through `packages/client` and TanStack Query.
- Manual absolute-path Project registration with an optional name. The browser performs only basic form validation; the Host remains the source of truth for canonicalization, authorization, availability, duplicate detection, and safe errors.
- Registration-only removal with an explicit confirmation, a specific `project_has_conversations` conflict state, and no filesystem deletion.
- Distinct loading, empty, Host-unavailable, not-found, available, and unavailable Project views using only real Project fields.
- A durable deterministic Conversation title and Project-scoped SQLite index, plus provider-independent single-Conversation reads and bounded lazy runtime hydration for cold history.
- A real `/projects/:projectId/conversations` product history surface, real Project-derived Current Project context and breadcrumbs, and a real Conversation Rail driven by the durable index rather than Runtime Snapshot or Mock data.
- A minimal Codex-only New Conversation dialog through the typed Client boundary. A Project route locks its real Project; global entry requires selection of one available Project and uses Host-owned model/reasoning defaults.
- Real `/conversations/conv_*` routes read cold or live normalized history through one ViewModel, keep title/status/activity synchronized through low-frequency lifecycle events, and rely on Host-owned hydration and provider resume only when control begins.
- `/conversations` redirects to `/projects`; `/conversations/demo` remains a development-only visual fixture and is absent from real Project, list, Rail, Inbox, and TopBar navigation.
- SQLite migration 004 (`attention`) and a durable, Conversation-linked Attention index for exact Approval requests, completed Turns awaiting review, and failed Turns awaiting acknowledgement. Stable source keys prevent replay/restart duplication.
- Protocol v1 `GET /api/v1/attention` and explicit review/failure resolution, plus reliable `attention.created` / `attention.resolved` SSE events. Approval Attention can only be resolved through the bound Approval endpoint; pre-restart open Approval Attention expires and never recreates a provider request.
- A real `/inbox` global open-Attention surface backed by `packages/client` and TanStack Query, with Host-owned summary/order, exact Approval controls, explicit completed-review/failed resolution, semantic-event multi-client sync, stream-reset refetch, and a real Sidebar `totalOpen` badge.
- The real Inbox supports only Approval, completed-review, and failed-Turn work. It contains no Mock question/needs-reply, unread, mark-all-read, fake risk/response metrics, retry, provider, or Machine semantics.

Phase 3D.2 stops at the real durable Inbox boundary. It does not authorize read/unread state, Agent-question inference, notifications, Activity, archive/rename/delete, full-history pagination, provider selection, Project discovery, native folder picking, Tauri, or remote operation.

## Out of Scope

After Phase 3D.2, do not implement without a separately approved phase:

- Visual redesigns or unrelated refactors to the frozen Design System, AppShell, Inbox, Conversations, Conversation Workspace, or accepted Projects UI.
- Activity, Machines, Agents, Settings, an advanced New Conversation flow, or any other new product-page content or flow.
- Live Host data in another frozen page.
- A generic WebSocket RPC transport or interactive PTY transport.
- Tauri or desktop-shell functionality.
- Project discovery/scanning, a native folder picker, rename/relocate, multiple Project locations, Machine management, remote access, relay, authentication, or production Host services.
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
