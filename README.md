# CodeTether V2

> A control center for AI coding agents.

CodeTether is a planned desktop and mobile workspace for supervising and controlling coding agents across projects and machines. V1 is Codex-first, with provider-neutral boundaries for later Claude Code and OpenCode support.

This repository is currently in **Phase 1C.2 — Core Workspace UX Polish**. The Phase 1C engineering and product structure is accepted; active work is limited to final visual and UX refinement of the Figma-approved, mock-only conversation workspace. It does not contain a host, persistence, desktop integration, real agent actions, or agent adapters.

## Repository layout

```text
codetether-v2/
├── apps/
│   ├── web/                 # React web/PWA bootstrap (active)
│   ├── desktop/             # Future Tauri 2 shell (placeholder)
│   └── host/                # Future Node.js agent host (placeholder)
├── packages/
│   ├── ui/                  # Shared design-system foundation (active)
│   ├── protocol/            # Future client/host contracts (placeholder)
│   ├── agent-core/          # Future provider-neutral abstraction (placeholder)
│   ├── adapter-codex/       # Future Codex adapter (placeholder)
│   ├── adapter-claude/      # Future Claude Code adapter (placeholder)
│   ├── adapter-opencode/    # Future OpenCode adapter (placeholder)
│   └── shared/              # Future shared utilities (placeholder)
├── docs/
│   ├── PRODUCT.md
│   ├── ARCHITECTURE.md
│   └── ROADMAP.md
└── AGENTS.md                # Long-lived development rules
```

## Prerequisites

- Node.js 22.12 or newer
- pnpm 10 or newer (the repository records the exact package-manager version)

## Setup

```bash
pnpm install
pnpm dev
```

The web app renders the shared desktop AppShell and a mock Conversation Detail preview at `/conversations/demo`. During development, `/__ui` continues to present the shared component showcase; later product UI must follow Figma.

## Commands

```bash
pnpm dev           # Start apps/web
pnpm typecheck     # Typecheck all implemented workspaces
pnpm lint          # Lint the repository
pnpm build         # Build all implemented workspaces
pnpm format        # Format writable source files
pnpm format:check  # Verify formatting
```

Tests will be added with behavior that merits testing; the root quality gate must include `pnpm test` once test scripts exist.

## Documentation

- [Product specification](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Agent development rules](AGENTS.md)

## Status

Do not start Conversations, Inbox, later Phase 1 product-screen content, or runtime infrastructure without an explicit phase transition. See the roadmap for ordered gates.
