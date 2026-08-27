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

The current phase is **Phase 2D — Local Alpha Audit & Stabilization**. The accepted frontend is frozen as **CodeTether V2 Frontend Core v1**, the accepted local runtime is frozen as **Phase 2A Codex Runtime v1**, Protocol v1 is frozen at the accepted **Phase 2B Client ↔ Host Protocol** boundary, the complete read path is frozen as **Live Conversation Read Model v1**, and the working product baseline is tagged **CodeTether Local Codex Alpha v0.1**. Allowed work is limited to:

- Auditing repository size, dependencies, architecture direction, wire-contract ownership, runtime state ownership, and documentation truth.
- Measuring bounded Host/browser memory, Snapshot/projection cost, streaming aggregation, test health, and development workflow.
- Revalidating reconnect, Host/Codex failure, process cleanup, Approval identity safety, workspace confinement, safe errors, and the existing local browser control loop.
- Recording real UX findings by severity without redesigning frozen product surfaces.
- Fixing only a reproducible P0/P1 correctness, security, bounded-memory, or conflicting-source-of-truth defect required to keep the existing Alpha safe and correct.
- Updating specifications with verified Alpha capabilities, limits, measurements, and audit conclusions.

This phase stops after the Alpha audit and stabilization report. Do not begin Persistence, another product surface, another provider, desktop packaging, or remote access.

## Out of Scope

During Phase 2D, do not implement:

- Visual redesigns or unrelated refactors to the frozen Design System, AppShell, Inbox, Conversations, or Conversation Workspace. Phase 2D does not authorize a product UI change.
- Activity, Projects, Machines, Agents, Settings, New Conversation, or any other new product-page content or flow.
- Live Host data in Inbox, Conversations, or another frozen page.
- A generic WebSocket RPC transport or interactive PTY transport.
- Tauri or desktop-shell functionality.
- SQLite, another database, persistence, migrations, repositories, or durable event storage.
- Machine management, project management, remote access, relay, authentication, or production Host services.
- Stop/thread termination, Turn queueing, steering, retry-Turn, attachments, images, voice, Skill upload, or another React write path beyond text Turn start, one-shot Approval resolution, and interrupt.
- Approval persistence, `Always Allow`, automatic approval, or a production permission-policy system.
- Claude Code or OpenCode adapters, speculative provider implementations, or cross-agent conversation handoff.
- Mobile screens, team, enterprise, public cloud relay, or other later-phase platform features.

Do not install dependencies for an out-of-scope runtime merely because its directory exists.

## Core Entities

### Project

A local codebase or workspace in which an agent operates.

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
- Use TanStack Query for future server/host state.
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
