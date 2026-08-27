# CodeTether V2

> A control center for AI coding agents.

CodeTether is a planned desktop and mobile workspace for supervising and controlling coding agents across projects and machines. V1 is Codex-first, with provider-neutral boundaries for later Claude Code and OpenCode support.

Phase 1 is accepted and frozen as **CodeTether V2 Frontend Core v1**, the accepted local runtime is frozen as **Phase 2A Codex Runtime v1**, and Phase 2B is accepted as the development-only Protocol v1 loopback HTTP/SSE boundary. The complete read path is frozen as **Live Conversation Read Model v1**. Phase 2C.2 is accepted and frozen as **CodeTether Local Codex Alpha v0.1**: the existing Conversation Workspace can start real text Turns, stream results, resolve one-shot Approvals, interrupt, and continue while the Host remains canonical state owner.

**Phase 3A — Minimal Durable Persistence** is implemented and validated. CodeTether Conversation identity, Codex provider Thread identity, and normalized per-Turn presentation snapshots now survive a complete Host restart. The restored Conversation can start another Turn through a lazy `thread/resume`, and a real isolated run confirmed that Codex retained pre-restart context. Demo, Inbox, and Conversations remain Mock data; there is still no Tauri shell, authentication, remote access, Project management, or non-Codex provider.

## Current Alpha capabilities

- Run one long-lived local Codex App Server behind a loopback-only Host.
- Create durable local Codex Conversations and complete multiple browser-controlled Turns.
- Stream Agent messages, Tool output, file changes, Diff, and terminal summaries through Protocol v1 HTTP/SSE.
- Resolve exact bound command Approvals with Allow Once or Decline.
- Interrupt an active Turn and continue the same Codex Thread afterward.
- Rebuild bounded retained history after browser refresh, replay, or `stream.reset`, and reconstruct recent runtime history from SQLite after Host restart.
- Observe the same ordered events from multiple local clients.
- Preserve the CodeTether Conversation ID and private Codex provider Thread ID across Host processes, with provider resume deferred until the next Turn.

## Repository layout

```text
codetether-v2/
├── apps/
│   ├── web/                 # Frozen UI plus live Conversation read model
│   ├── desktop/             # Future Tauri 2 shell (placeholder)
│   └── host/                # Local Host API, Codex runtime, and SQLite persistence
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

- Node.js 22.13 or newer (`node:sqlite` must be available without the experimental flag)
- pnpm 10 or newer (the repository records the exact package-manager version)

## Setup

```bash
pnpm install
pnpm dev
```

The web app renders the shared desktop AppShell and the frozen Mock Conversation Detail at `/conversations/demo`. When the loopback Host is running, a valid `/conversations/conv_*` route reads the corresponding Host Conversation. During development, `/__ui` continues to present the shared component showcase; later product UI must follow Figma.

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

For an end-to-end local browser-control check, run `pnpm host:control` and `pnpm dev`, then open one of the printed `/conversations/conv_*` routes. The general isolated Conversation supports text Turns and interruption; the linked Git fixture supports safe command-Approval checks. The Host prints its `databasePath`, records canonical User input before provider execution, and publishes final mutation state through Protocol events. Refresh and `stream.reset` reconstruct the retained Timeline; after a Host restart, SQLite reconstructs the recent runtime Snapshot and the next Turn lazily resumes the saved Codex Thread.

### Local data

The Host uses Node's standard `node:sqlite` API and stores `codetether.sqlite3` outside the repository:

- Windows: `%LOCALAPPDATA%\CodeTether\codetether.sqlite3`
- macOS: `~/Library/Application Support/CodeTether/codetether.sqlite3`
- Linux: `$XDG_DATA_HOME/codetether/codetether.sqlite3` when set, otherwise `~/.local/share/codetether/codetether.sqlite3`

Set `CODETETHER_DATA_DIR` to an **absolute** directory to isolate development or test data:

```powershell
$env:CODETETHER_DATA_DIR = "$env:TEMP\codetether-dev"
pnpm host:control
```

Do not point this variable at the CodeTether repository and do not commit a real database. SQLite uses foreign keys, WAL mode, a five-second busy timeout, an integrity check at open, and a minimal versioned migration table. A database open, migration, integrity, or required write failure is fatal; CodeTether never deletes or silently replaces the user's database.

The development Host accepts only absolute existing directories contained by an explicitly configured workspace root after real-path resolution. It binds to `127.0.0.1`, uses an exact Origin allowlist, and disables local Codex hooks by default so approval decisions stay on the CodeTether control path. Use only an ignored disposable workspace for real-agent development checks.

## Known Alpha limitations

- Phase 3A persists normalized Conversation/Turn snapshots, not raw Codex JSON-RPC events; it is intentionally not an event store.
- The Host restores only the bounded recent runtime window (20 Turns by default) into memory. Older durable Turns remain in SQLite, but no history-pagination UI exists yet.
- Startup currently admits the eight most-recent durable Conversations into runtime memory; a live durable Conversations index and lazy loading are deferred.
- A Turn that was `starting`, `running`, or `waiting` at restart becomes `interrupted` with reason `host_restart`. It is not resumed automatically.
- A pending Approval from a previous Host process is retained only as expired history and cannot be resolved after restart.
- Action idempotency and SSE replay remain process-local. A new Host epoch must fetch a fresh Snapshot and must not automatically replay an uncertain mutation from the previous epoch.
- If Codex can no longer resume the stored provider Thread, local durable history remains readable but new controls return `provider_conversation_unavailable`.
- Only Codex, text Turn start, one-shot command Approval, and Turn interrupt are connected.
- Inbox and Conversations are still product-quality Mock surfaces rather than live Host projections.
- Stop/terminate, queue/steer, attachments, Project management, Tauri packaging, remote access, authentication, and other providers are not implemented.
- File-change and permissions Approval variants have fixture/schema coverage but have not been observed in a real Codex run.
- Physical Windows Chinese IME input has not been manually validated; automated composition-event coverage exists.
- The Host assumes one primary writer process for a data directory; a second-Host ownership/lease mechanism is not implemented yet.

## Documentation

- [Product specification](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Agent development rules](AGENTS.md)

## Status

**CodeTether Local Codex Alpha v0.1** is accepted and tagged. **Phase 3A — Minimal Durable Persistence** is complete: fixture gates and a real multi-Turn Host restart, Snapshot reconstruction, lazy provider Thread resume, and context-retention walkthrough all passed. Phase 3B has not started. Do not add live data to Inbox or Conversations, Project management, desktop packaging, remote exposure, or another provider without a separately approved phase. See the roadmap for ordered gates.
