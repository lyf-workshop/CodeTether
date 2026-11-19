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

- [`docs/ux-redesign`](docs/ux-redesign) is the source of truth for UI design: the prototype, screenshots, and dev handoff (02), the requirements (04), and the stage plan (03). Implement approved designs faithfully; do not redesign them in code. Figma is no longer used (Owner decision, 2026-11-02).
- [`docs/PRODUCT.md`](docs/PRODUCT.md) is the source of truth for product behavior and scope.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) is the source of truth for system boundaries and technical architecture.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) is the source of truth for phase order, exit gates, and the current status of every stage.
- [`docs/DEVELOPMENT-PROCESS.md`](docs/DEVELOPMENT-PROCESS.md) defines how work moves from requirement to release: branches, review, acceptance, and what every coding prompt must state.
- [`docs/FROZEN-BOUNDARIES.md`](docs/FROZEN-BOUNDARIES.md) records the implementation boundaries of the accepted Phase 4–10 work. They still bind the code.

Documents are maintained on the `ux/design` branch. On `main` and on feature branches, `docs/` can be older; when a task prompt says to read a document with `git show origin/ux/design:<path>`, that version wins. Do not edit `AGENTS.md` or `docs/` on a feature branch unless the task prompt asks for it; list the documentation changes you think are needed in your report instead.

When sources disagree, apply this order:

1. The task prompt for the current stage or fix. It is the Owner's authorization record and may explicitly extend a frozen boundary.
2. Stage status in `docs/ROADMAP.md`.
3. `docs/PRODUCT.md` and `docs/ARCHITECTURE.md`.
4. `docs/FROZEN-BOUNDARIES.md`. Status words inside it ("pending", "remains unauthorized", "ready for the Owner's freeze decision", "closure is unconfirmed") are historical and do not override 1–3.

If a conflict remains after applying this order, stop and report it instead of inventing a compromise. Keep these documents updated when an approved decision changes.

## Current Scope

Work follows the v4 product stages at the top of [`docs/ROADMAP.md`](docs/ROADMAP.md), with each stage's content in `docs/ux-redesign/03-project-plan.md` §4. Each stage, fix, or maintenance task is authorized only by its own task prompt in `docs/reviews/`. Anything that `docs/FROZEN-BOUNDARIES.md` or the Out of Scope list below marks as unauthorized stays so until a task prompt authorizes it.

This file deliberately does not record which stages are in progress, accepted, or released; that lives only in `docs/ROADMAP.md`, so this file cannot go stale.

## Out of Scope

Do not implement the following unless a v4 stage in `docs/ROADMAP.md` authorizes it through its own task prompt (for example, U1 covers desktop auto-update and update signing, and the M series covers mobile):

- Visual redesigns or unrelated refactors to the frozen Design System, AppShell, Inbox, Conversations, Conversation Workspace, or accepted Projects UI.
- Activity, a standalone Agent-management page, a Settings redesign beyond the narrow Setup/Doctor entry points and accepted settings surfaces, an advanced New Conversation flow beyond truthful Machine/Provider installation, health, and capability gating, or unrelated new product-page content.
- Live Host data in another frozen page.
- A generic WebSocket RPC transport or interactive PTY transport.
- Start with Windows, tray badges/dynamic Attention counts, recent Project/Conversation tray menus, a close-behavior preference, notifications after explicit application exit, notification-history UI, push/email/chat delivery, custom sounds or schedules, custom window chrome, auto-update, signing/release channels, drag-and-drop folders, recent-folder menus, Open in Explorer, or any other native product feature beyond the exact Phase 4B picker, Phase 4C notification delivery, Phase 4G.1 tray lifecycle, and Phase 4G.2 Windows lifecycle reliability boundary.
- A generic Tauri command runner, arbitrary shell bridge, arbitrary filesystem capability, or a second Client-to-Host business protocol.
- Project discovery/scanning, Project or Location rename/relocate, multi-root Locations on one Machine, remote Claude Edit/Write/Shell/Diff/Approval/interrupt (remote model and reasoning selection for the next Turn is admitted by D2; see `docs/ARCHITECTURE.md`, "Model and reasoning control"), remote MCP/plugins/hooks, SSH, LAN discovery, file synchronization, generic remote control/filesystem/Terminal, arbitrary remote process invocation, or execution on an untrusted/offline Machine or unregistered Location.
- Any Relay payload other than the accepted bounded opaque Machine TLS wire records, generic TCP/WebSocket proxying, account/cloud control-plane behavior, Relay-created Machine trust, NAT traversal or hole punching, STUN/TURN/WebRTC/UPnP, multi-region Relay, clustering/failover, Mobile, Push, captive-portal product, arbitrary proxy configuration, or custom network-routing protocol.
- Cross-Project/global Search, Agent response or Tool/Terminal/Diff/Approval search, FTS/semantic/embedding Search product behavior, old-Turn history pagination, Search history/analytics, Conversation Delete, bulk organization, tags, folders, groups, or drag reordering. Phase 4F.2 consumes only the accepted Project-scoped title/canonical-User-input backend and its typed Client boundary.
- Filesystem deletion, recursive cleanup, cascading Project deletion, or automatic reassignment of existing Conversations to another Project.
- Turn queueing, steering, automatic Prompt replay, attachments, images, voice, Skill upload, or a Provider-specific React/HTTP write path. Phase 6D's frozen explicit safe fresh-Turn action remains the only retry mechanism where its canonical failure policy permits it; Claude Code interrupt and Approval controls remain unavailable unless a later parity phase establishes stable machine-readable semantics, and existing Codex control remains unchanged.
- Actionable Approval recovery across restart, `Always Allow`, automatic approval, or a production permission-policy system. Expired Approval history may be retained only to explain what happened.
- Claude Code capability parity beyond the approved restricted foundation, OpenCode or any third Provider before stage P1 (multi-tool support, after M2), speculative Provider implementations, Provider switching on an existing Conversation, or cross-agent conversation handoff.
- Mobile screens and mobile background/push/battery behavior outside the M-series stage being executed (Android first; see `docs/ux-redesign/03-project-plan.md` and `04-requirements.md`). Team, enterprise, a commercial CodeTether cloud/account Relay control plane, or other platform features not in a v4 stage.
- Event sourcing, CQRS, an ORM, a repository hierarchy, a durable provider-event log, or generalized durable exactly-once command processing. Migration 012 remains limited to restart-safe exactly-once admission for the existing Turn-start `actionId`; migration 013 retains only one bounded execution-health observation per Machine/Provider pair; all other mutations retain their accepted bounded process-local idempotency semantics.
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

A durable execution location capable of hosting authorized Project Locations and Provider sessions. Phase 6A established one truthful local Windows Machine, accepted Phase 6B.1 adds real paired remote Machines with stable CodeTether-owned identities and authenticated availability, accepted Phase 6B.2 recovers an existing trusted Machine across a LAN endpoint change without making location its identity, accepted Phase 6B.3 lets a trusted remote Machine validate and own durable Project Location metadata, accepted Phase 6C.1 can describe installed coding-agent CLIs, accepted Phase 6C.2 executes only its fixed remote Codex profile, accepted Phase 6C.3 executes only the restricted remote Claude Code streaming/resume/Read/Search/effort profile, and accepted Phase 6C.4 hardens those two exact profiles without adding execution capability. Phase 6D may expose separate bounded execution-health truth and recovery guidance; it does not change what the Machine can execute. A Conversation still executes on one immutable Machine.

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
- Redesign a UI defined in `docs/ux-redesign` based on personal preference.
- Copy legacy CodeTether code or use its directory structure as the basis for V2.

Legacy CodeTether may be consulted only when explicitly requested, and only for a previously validated low-level capability.

## Quality Gate

After important work, run at minimum, in this order:

```text
pnpm typecheck
pnpm lint
pnpm build
pnpm test
```

`pnpm test` uses the build output of workspace packages, so run it after `pnpm build`.

Also run the checks for what you touched:

- Rust: `cargo test` in `packages/supervisor-mobile` when the mobile Rust core or the Supervisor wire format changes (its interop test compares the TypeScript and Rust encodings), and in `apps/desktop/src-tauri` when the desktop shell changes.
- Android: the Gradle gate (`testDebugUnitTest lint assembleDebug assembleDebugAndroidTest`) when `apps/android` or the Rust core changes.
- Formatting: `pnpm format:check` must pass for files you changed.

Do not claim completion while known type errors, lint errors, failing tests, build failures, or obvious regressions remain. If a check cannot run, report the exact reason.
