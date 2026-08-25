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
2. **Phase 1B — Desktop AppShell** — the shared TopBar, PrimarySidebar, MainContent region, and placeholder routes. No product-page content.
3. **Phase 1C — 07 Desktop — Conversation Detail** — the most important workspace and the standard for live agent supervision.
4. **06 Desktop — Conversations** — conversation navigation and management experience.
5. **02 Desktop — Inbox** — action-focused approvals, questions, failures, and completions.

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

## Phase 2 — Codex Local Loop

**Goal:** prove the first real end-to-end local agent loop with Codex.

Planned outcomes:

- Minimal machine host boundary and protocol contracts.
- Codex detection and a typed Codex adapter.
- Create/send/stream/interrupt/complete lifecycle on one local machine.
- Normalized events required by the approved Conversation Detail UI.
- Permission and question flows at the minimum scope needed for the local loop.

Exit gate: one local Codex task can be controlled end to end through CodeTether with observable, recoverable state and passing quality checks.

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
