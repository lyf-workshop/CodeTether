# CodeTether V2

> A control center for AI coding agents.

CodeTether is a planned desktop and mobile workspace for supervising and controlling coding agents across projects and machines. V1 is Codex-first, with provider-neutral boundaries for later Claude Code and OpenCode support.

Phase 1 is accepted and frozen as **CodeTether V2 Frontend Core v1**, the accepted local runtime is frozen as **Phase 2A Codex Runtime v1**, and Phase 2B is accepted as the development-only Protocol v1 loopback HTTP/SSE boundary. The complete read path is frozen as **Live Conversation Read Model v1**. Phase 2C.2 is accepted and frozen as **CodeTether Local Codex Alpha v0.1**: the existing Conversation Workspace can start real text Turns, stream results, resolve one-shot Approvals, interrupt, and continue while the Host remains canonical state owner. Demo, Inbox, and Conversations remain Mock data; there is still no persistence, Tauri shell, authentication, remote access, or non-Codex provider.

## Current Alpha capabilities

- Run one long-lived local Codex App Server behind a loopback-only Host.
- Create in-memory Codex Conversations and complete multiple browser-controlled Turns.
- Stream Agent messages, Tool output, file changes, Diff, and terminal summaries through Protocol v1 HTTP/SSE.
- Resolve exact bound command Approvals with Allow Once or Decline.
- Interrupt an active Turn and continue the same Codex Thread afterward.
- Rebuild bounded retained history after browser refresh, replay, or `stream.reset` within the same Host process.
- Observe the same ordered events from multiple local clients.

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

The development Host accepts only absolute existing directories contained by an explicitly configured workspace root after real-path resolution. It binds to `127.0.0.1`, uses an exact Origin allowlist, and disables local Codex hooks by default so approval decisions stay on the CodeTether control path. Use only an ignored disposable workspace for real-agent development checks.

## Known Alpha limitations

- Host restart loses CodeTether Conversation identity and retained history; there is no database or recovery layer.
- Only Codex, text Turn start, one-shot command Approval, and Turn interrupt are connected.
- Inbox and Conversations are still product-quality Mock surfaces rather than live Host projections.
- Stop/terminate, queue/steer, attachments, Project management, Tauri packaging, remote access, authentication, and other providers are not implemented.
- File-change and permissions Approval variants have fixture/schema coverage but have not been observed in a real Codex run.
- Physical Windows Chinese IME input has not been manually validated; automated composition-event coverage exists.

## Documentation

- [Product specification](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Agent development rules](AGENTS.md)

## Status

**CodeTether Local Codex Alpha v0.1** is accepted and tagged. Phase 2D audited and stabilized the current local Alpha without selecting or starting a next product phase. Do not add live data to Inbox or Conversations, persistence, desktop packaging, remote exposure, or another provider without an explicit next-phase decision. See the roadmap for ordered gates.
