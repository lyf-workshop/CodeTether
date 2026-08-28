# CodeTether V2

> A control center for AI coding agents.

CodeTether is a Windows-first desktop workspace for supervising and controlling coding agents across projects, with a focused mobile companion planned for later. V1 is Codex-first, with provider-neutral boundaries for later Claude Code and OpenCode support.

Phase 1 is accepted and frozen as **CodeTether V2 Frontend Core v1**, the accepted local runtime is frozen as **Phase 2A Codex Runtime v1**, and Phase 2B is accepted as the local-only Protocol v1 loopback HTTP/SSE boundary shared by Browser and Desktop clients. The complete read path is frozen as **Live Conversation Read Model v1**. Phase 2C.2 is accepted and frozen as **CodeTether Local Codex Alpha v0.1**: the existing Conversation Workspace can start real text Turns, stream results, resolve one-shot Approvals, interrupt, and continue while the Host remains canonical state owner.

**Phase 3D.2 — Real Inbox UI** is implemented and validated. Projects, Conversations, and Attention remain durable Host-owned product records. The real `/inbox` consumes the typed Attention API and reliable semantic events for Approval, completed-review, and failed-Turn work, including the real Sidebar count and exact Approval controls. There is still no question inference, read/unread state, notifications, archive/rename/delete, full-history pagination, authentication, remote access, or non-Codex provider.

**Phase 3E.1 — Approval Interaction Layout Stabilization** is implemented and validated. Conversation Detail now keeps actionable Approval controls in a bounded Pending Action Dock between the independently scrolling Timeline and the mounted Composer; Timeline entries are history only, long commands stay bounded, and scroll/focus remain stable through one or multiple Approval transitions.

**Phase 4A — Tauri Desktop Shell Foundation** is implemented and validated. `apps/desktop` packages the existing Web UI and a revision-coupled Node SEA build of the existing Host into one Windows-first Tauri v2 application. Tauri owns window and owned-process lifecycle only; all Project, Conversation, Attention, Codex, persistence, and Protocol behavior remains in the accepted Web/Host layers.

**Phase 4B — Native Folder Picker** adds one narrow native capability: Desktop users select one directory through the Windows folder picker, then the existing typed Project mutation sends that path to the Host. Browser mode retains manual absolute-path entry. Tauri does not canonicalize, authorize, inspect, or persist the directory; the Host remains the sole Project authority.

## Current Alpha capabilities

- Run one long-lived local Codex App Server behind a loopback-only Host.
- Create durable local Codex Conversations and complete multiple UI-controlled Turns in Browser or Desktop.
- Stream Agent messages, Tool output, file changes, Diff, and terminal summaries through Protocol v1 HTTP/SSE.
- Resolve exact bound command Approvals with Allow Once or Decline.
- Interrupt an active Turn and continue the same Codex Thread afterward.
- Rebuild bounded retained history after browser refresh, replay, or `stream.reset`, and reconstruct recent runtime history from SQLite after Host restart.
- Observe the same ordered events from multiple local clients.
- Preserve the CodeTether Conversation ID and private Codex provider Thread ID across Host processes, with provider resume deferred until the next Turn.
- Register, list, inspect, and remove durable local Project registrations through Protocol v1 without granting filesystem access outside canonical authorized roots.
- Manage those Project registrations through the real desktop Projects list, manual add dialog, Project overview, unavailable state, and registration-only remove confirmation.
- Bind each durable Conversation to one Project while allowing its `cwd` to remain a real-path-validated directory contained by that Project root.
- Browse the real Project-scoped durable Conversation index, open cold history through the same frozen Conversation Detail, and continue it through bounded Host hydration and lazy provider resume.
- Create a minimal real Codex Conversation from Project or global context, then observe its Host-owned title, status, and activity update in the header, breadcrumb, Rail, and list.
- List durable open Attention globally or by Project, resolve completed-review and failed items explicitly, and keep Approval Attention synchronized only through its exact bound Approval command.
- Use the real Inbox to review that global Attention queue, filter its three supported types, act on exact Approvals, and keep multiple browser clients synchronized through semantic SSE events.
- Launch the same local workspace through a single-instance Desktop shell that owns its packaged loopback Host, while retaining the standalone Browser development workflow.

## Repository layout

```text
codetether-v2/
├── apps/
│   ├── web/                 # Frozen UI plus live Conversation read model
│   ├── desktop/             # Tauri v2 shell and Host sidecar packaging
│   └── host/                # Local Host API, Project registry, Codex runtime, and SQLite
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

Desktop sidecar builds have additional Windows-first prerequisites:

- Node.js 25.5 or newer for the official direct `--build-sea` pipeline
- Rust 1.85 or newer with the MSVC target
- Microsoft C++ Build Tools and the Windows SDK
- Microsoft Edge WebView2 Runtime
- A locally available Codex executable for real Agent execution (durable reads can still operate when Codex is unavailable)

## Setup

```bash
pnpm install
pnpm dev
```

`pnpm dev` preserves the standalone Browser workflow and starts only the Web application; launch the Host separately for that mode. For the single-command Desktop development workflow, use `pnpm desktop:dev`. It builds the Host sidecar, starts the Vite process through Tauri, launches one Desktop window, and supervises the owned Host.

The shared Web app renders the same AppShell in both modes. `/projects` manages real durable Project registrations, `/projects/:projectId/conversations` lists a Project's durable Conversations, `/conversations/conv_*` reads or controls the selected Conversation, and `/inbox` presents durable open Attention. `/conversations` redirects to Project selection. `/conversations/demo` remains only a development visual fixture, and `/__ui` presents the shared component showcase.

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
pnpm desktop:dev             # Build the Host sidecar, start Vite, and launch Tauri
pnpm desktop:sidecar         # Build the revision-coupled Node SEA Host executable
pnpm desktop:check           # Run Rust fmt/check/clippy/test gates
pnpm desktop:build           # Build Web assets, Desktop binary, sidecar, and NSIS bundle
pnpm desktop:package-smoke   # Build and cold-start the packaged executable against temp data
pnpm desktop:installer-smoke # Install, launch, verify, close, and remove the NSIS artifact
pnpm desktop:installer-smoke:hold     # Keep an isolated installed app open for manual UI smoke
pnpm desktop:installer-smoke:cleanup  # Remove only the exact held smoke installation
```

`pnpm codex:spike` uses only the ignored `.tmp/codetether-codex-spike/` workspace. It must never target the CodeTether source repository.

For Desktop development, set an isolated absolute `CODETETHER_DATA_DIR` when desired and run only `pnpm desktop:dev`; do not start a second Host. For Browser development, run `pnpm host:serve -- --workspace <absolute-path>` and `pnpm dev`, then open `/projects`. From the real Project overview, open its Conversations page and create a Codex Conversation. `pnpm host:control` remains a focused integration harness for interruption and safe command-Approval checks. The Host records canonical User input before provider execution and publishes final mutation state through Protocol events. Refresh and `stream.reset` reconstruct the retained Timeline; after a Host restart, SQLite restores durable history and the next Turn lazily resumes the saved Codex Thread.

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

The development Host registers only absolute existing directories after real-path resolution. When one or more `--workspace` roots are configured, new registrations must be contained by those roots. Every Conversation working directory must remain contained by its saved Project root. The Host binds to `127.0.0.1`, uses an exact Origin allowlist, and disables local Codex hooks by default so approval decisions stay on the CodeTether control path. Use only an ignored disposable workspace for real-agent development checks.

### Local Projects

Protocol v1 exposes the durable Project boundary through:

```text
GET    /api/v1/projects
POST   /api/v1/projects
GET    /api/v1/projects/:projectId
DELETE /api/v1/projects/:projectId
```

Create Project accepts an absolute `path`, an `actionId`, and an optional display `name` (the Host otherwise uses the directory name). The Host resolves and validates the directory before storing its canonical root. Registering the same canonical root again returns the existing Project with `created: false`; it does not create a duplicate identity.

New Conversation callers use `projectId`. The deprecated Protocol v1 `cwd` form exists only for compatibility and succeeds only when that directory is already contained by a registered, available Project. The `--workspace <absolute-path>` Host option remains an assembly helper that registers the explicit root; it is not a filesystem discovery or product import flow.

Deleting a Project removes only its CodeTether registration. It never deletes or changes files and never cascades Conversation history. The Host rejects deletion while any durable or runtime Conversation references the Project, including while a Conversation creation has reserved that Project.

The Projects UI uses these endpoints through `packages/client` and TanStack Query. One shared Add Project dialog accepts an optional display name. Desktop acquires its path through a single-directory native picker; Browser mode retains manual absolute-path entry. In both modes the selected or entered path is only an input to the same Host mutation, so canonicalization and authorization remain entirely Host-owned. Duplicate registration opens the existing Project instead of adding another row. Unavailable roots remain inspectable, and removal requires explicit confirmation that local source files and Git data are untouched. Workspace scanning, rename, and relocation are not implemented.

### Local Conversations

The durable product-history boundary is separate from Runtime Snapshot reconnect state:

```text
GET  /api/v1/projects/:projectId/conversations
GET  /api/v1/conversations/:conversationId
POST /api/v1/conversations
```

The real Conversations page and Rail use the Project-scoped index through `packages/client` and TanStack Query. Search is local to the returned maximum of 100 recent summaries. Opening a cold Conversation reads normalized SQLite history without starting Codex; sending a new Turn lets the Host hydrate its bounded working set and lazily resume the private provider Thread. New Conversation currently locks Agent to Codex and uses Host defaults for model and reasoning.

### Local Attention

The durable Attention boundary is separate from Runtime Snapshot. The real Inbox consumes this boundary through `packages/client` and TanStack Query:

```text
GET  /api/v1/attention
POST /api/v1/attention/:attentionId/resolve
POST /api/v1/approvals/:approvalId/resolve
```

`GET /attention` defaults to open work, supports Project/type/status/limit filters, and returns open counts. Generic Attention resolution only acknowledges completed-review or failed items; Approval must remain bound to its existing one-shot accept/decline endpoint. `attention.created` and `attention.resolved` are reliable SSE events, while the durable list is the source of truth after replay reset or Host restart.

The Inbox requests up to 100 open items in Host-owned priority order. It shows only Approval, completed-review, and failed-Turn work, uses the returned summary for its cards and Sidebar badge, and refreshes only on Attention semantic events or stream reset. Opening a failed Conversation does not acknowledge it; reviewing completed work and acknowledging a failed item are explicit durable mutations.

## Known Alpha limitations

- Phase 3A persists normalized Conversation/Turn snapshots, not raw Codex JSON-RPC events; it is intentionally not an event store.
- The Host restores only the bounded recent runtime window (20 Turns by default) into memory. Older durable Turns remain in SQLite, but no history-pagination UI exists yet.
- Startup admits at most the eight most-recent durable Conversations into runtime memory; older indexed Conversations are cold-read and hydrated on control with safe idle-LRU eviction.
- A Turn that was `starting`, `running`, or `waiting` at restart becomes `interrupted` with reason `host_restart`. It is not resumed automatically.
- A pending Approval from a previous Host process is retained only as expired history and cannot be resolved after restart.
- Action idempotency and SSE replay remain process-local. A new Host epoch must fetch a fresh Snapshot and must not automatically replay an uncertain mutation from the previous epoch.
- If Codex can no longer resume the stored provider Thread, local durable history remains readable but new controls return `provider_conversation_unavailable`.
- Only Codex, text Turn start, one-shot command Approval, and Turn interrupt are connected.
- Attention currently models only structured Approval, completed-review, and failed-Turn semantics. Structured Agent questions, read/unread, notifications, and Activity are not implemented.
- Projects and Conversations are real local surfaces, and Desktop supports explicit single-directory native selection. Project discovery/import, drag-and-drop, recent folders, rename/relocate, Conversation rename/archive/delete, history pagination, and multiple Machine locations are not implemented.
- Stop/terminate, queue/steer, attachments, Desktop notifications, tray behavior, updater/signing, remote access, authentication, and other providers are not implemented.
- Phase 4B remains Windows-first. macOS/Linux packaging, native dialog, signing, distribution, and process-tree validation remain future work.
- CodeTether Desktop uses the fixed loopback port 4317. It reports and leaves any existing CodeTether Host or unknown occupant untouched rather than attaching or killing by port.
- The packaged Host does not need a system Node.js runtime, but the current Desktop build pipeline requires Node 25.5+ to produce the official SEA executable. Real Codex work still requires a compatible local Codex installation.
- The current Desktop icon is a minimal Alpha asset; final brand artwork is still pending.
- File-change and permissions Approval variants have fixture/schema coverage but have not been observed in a real Codex run.
- Physical Windows Chinese IME input has not been manually validated; automated composition-event coverage exists.
- The Host assumes one primary writer process for a data directory; a second-Host ownership/lease mechanism is not implemented yet.

## Documentation

- [Product specification](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Agent development rules](AGENTS.md)

## Status

**CodeTether Local Workspace Alpha** remains the frozen product/runtime baseline, **Phase 4A — Tauri Desktop Shell Foundation** is implemented and validated around it, and **Phase 4B — Native Folder Picker** is limited to explicit directory acquisition through the existing Project flow. Do not extend this into question inference, read/unread state, notifications, Activity, archive/rename/delete, pagination, discovery, drag-and-drop, tray/updater behavior, remote exposure, or another provider without a separately approved phase. See the roadmap for ordered gates.
