# CodeTether V2

> A control center for AI coding agents.

CodeTether is a planned desktop and mobile workspace for supervising and controlling coding agents across projects and machines. V1 is Codex-first, with provider-neutral boundaries for later Claude Code and OpenCode support.

Phase 1 is accepted and frozen as **CodeTether V2 Frontend Core v1**. The current work is **Phase 2A — Codex App Server Runtime Spike**: a development-only Host CLI can drive one local Codex Thread and Turn inside an isolated temporary workspace. The real runtime is not connected to React and includes no persistence, browser API, Tauri shell, remote access, or non-Codex provider.

## Repository layout

```text
codetether-v2/
├── apps/
│   ├── web/                 # Frozen React web/PWA frontend
│   ├── desktop/             # Future Tauri 2 shell (placeholder)
│   └── host/                # Phase 2A Runtime Spike runner
├── packages/
│   ├── ui/                  # Shared design-system foundation (active)
│   ├── protocol/            # Future client/host contracts (placeholder)
│   ├── agent-core/          # Minimal normalized runtime events
│   ├── adapter-codex/       # Codex App Server spike adapter
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
pnpm test          # Run fixture-based runtime tests
pnpm format        # Format writable source files
pnpm format:check  # Verify formatting
pnpm codex:spike   # Run the manual real-Codex integration spike
```

`pnpm codex:spike` uses only the ignored `.tmp/codetether-codex-spike/` workspace. It must never target the CodeTether source repository.

## Documentation

- [Product specification](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Agent development rules](AGENTS.md)

## Status

Phase 2A implementation is complete and awaiting review. Do not connect the Runtime Spike to the browser, add persistence, begin Phase 2B, or redesign the frozen frontend without an explicit phase transition. See the roadmap for ordered gates.
