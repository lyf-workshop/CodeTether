# CodeTether V2

> A control center for AI coding agents.

CodeTether is a planned desktop and mobile workspace for supervising and controlling coding agents across projects and machines. V1 is Codex-first, with provider-neutral boundaries for later Claude Code and OpenCode support.

Phase 1 is accepted and frozen as **CodeTether V2 Frontend Core v1**, the accepted local runtime is frozen as **Phase 2A Codex Runtime v1**, and Phase 2B is accepted as the development-only Protocol v1 loopback HTTP/SSE boundary. Phase 2C.1 connects only a read-only real `conv_*` Conversation Detail route to that boundary. Demo, Inbox, and Conversations remain Mock data; there is still no persistence, Tauri shell, authentication, remote access, React write path, or non-Codex provider.

## Repository layout

```text
codetether-v2/
├── apps/
│   ├── web/                 # Frozen UI plus live Conversation read model
│   ├── desktop/             # Future Tauri 2 shell (placeholder)
│   └── host/                # Codex runtime harnesses and local Host API
├── packages/
│   ├── ui/                  # Shared design-system foundation (active)
│   ├── protocol/            # Client-to-Host Protocol v1
│   ├── client/              # Non-React HTTP/SSE Protocol client
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

The web app renders the shared desktop AppShell and the frozen Mock Conversation Detail at `/conversations/demo`. When the loopback Host is running, a valid `/conversations/conv_*` route reads the corresponding in-memory Conversation. During development, `/__ui` continues to present the shared component showcase; later product UI must follow Figma.

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
pnpm host:serve -- --workspace <absolute-path>  # Start the local-only Host API
pnpm host:integration                          # Run real HTTP/SSE integration
pnpm host:observe -- create --cwd <absolute-path>  # Create a live dev Conversation
pnpm host:observe -- turn --conversation <conv_id> --input <text>  # Start a dev Turn
```

`pnpm codex:spike` uses only the ignored `.tmp/codetether-codex-spike/` workspace. It must never target the CodeTether source repository.

For a Phase 2C.1 read-path check, start `host:serve` with an explicitly allowed ignored workspace, start `pnpm dev`, create a Conversation with `host:observe`, open the returned `/conversations/conv_*` route, and only then start its Turn. The current Snapshot has no Item history, so opening the browser after the Turn streams cannot reconstruct earlier messages, Tools, terminal output, or diffs. The Composer and all other controls on a live route are intentionally read-only.

## Documentation

- [Product specification](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Agent development rules](AGENTS.md)

## Status

Phase 2C.1 read-path implementation and manual real-Codex browser observation are complete and awaiting review. Do not connect React write actions, add live data to Inbox or Conversations, add persistence or remote exposure, begin Phase 2C.2, or redesign the frozen frontend. See the roadmap for ordered gates.
