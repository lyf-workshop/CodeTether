# CodeTether V2

> A control center for AI coding agents.

CodeTether is a planned desktop and mobile workspace for supervising and controlling coding agents across projects and machines. V1 is Codex-first, with provider-neutral boundaries for later Claude Code and OpenCode support.

Phase 1 is accepted and frozen as **CodeTether V2 Frontend Core v1**, the accepted local runtime is frozen as **Phase 2A Codex Runtime v1**, and Phase 2B is accepted as the development-only Protocol v1 loopback HTTP/SSE boundary. The complete read path is frozen as **Live Conversation Read Model v1**. Phase 2C.2 connects the existing live Conversation Composer, one-shot Approval actions, and Interrupt control to that boundary while the Host remains canonical state owner. Demo, Inbox, and Conversations remain Mock data; there is still no persistence, Tauri shell, authentication, remote access, or non-Codex provider.

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
pnpm host:control                              # Run the isolated browser-control harness
pnpm host:observe -- create --cwd <absolute-path>  # Create a live dev Conversation
pnpm host:observe -- turn --conversation <conv_id> --input <text>  # Start a dev Turn
```

`pnpm codex:spike` uses only the ignored `.tmp/codetether-codex-spike/` workspace. It must never target the CodeTether source repository.

For an end-to-end local browser-control check, run `pnpm host:control` and `pnpm dev`, then open one of the printed `/conversations/conv_*` routes. The general isolated Conversation supports text Turns and interruption; the linked Git fixture supports safe command-Approval checks. The Host records canonical User input and publishes final mutation state through Protocol events, so refresh and `stream.reset` reconstruct the same retained Timeline. History remains process-local and bounded; a Host restart still clears it.

## Documentation

- [Product specification](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Agent development rules](AGENTS.md)

## Status

Phase 2C.2 live Conversation control is implemented and validated, and is awaiting review. Do not add live data to Inbox or Conversations, add persistence or remote exposure, begin Phase 3, or redesign the frozen frontend. See the roadmap for ordered gates.
