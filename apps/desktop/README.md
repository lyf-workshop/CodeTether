# CodeTether Desktop

`apps/desktop` is the Windows-first Tauri v2 shell for the accepted CodeTether Local Workspace Alpha. It packages the existing `apps/web` UI and supervises a bundled executable form of the existing `apps/host` process.

The packaged application uses `CodeTether` as its product name and `com.codetether.desktop` as its stable bundle identifier.

It is deliberately not a second application backend. Project, Conversation, Attention, SQLite, Codex adapter, runtime projection, and Protocol v1 behavior remain owned by the Host/Web packages that also support standalone Browser development.

## Architecture

```text
Tauri v2 shell
  ├─ single main-window lifecycle
  ├─ single-instance enforcement
  ├─ fixed Host sidecar spawn/readiness/exit supervision
  ├─ private owned-child shutdown channel
  └─ exact Project directory picker
             │
             ▼
existing apps/web build
             │ Protocol v1 HTTP + SSE
             ▼
Node SEA apps/host sidecar on 127.0.0.1:4317
             │
             ▼
existing Agent Core / Codex Adapter / Codex App Server
```

Tauri does not expose business commands to React. The WebView continues to use `packages/client` over HTTP/SSE, exactly as Browser mode does. The one native `pick_project_directory` command only acquires a user-selected path before the existing Host Project mutation runs.

## Prerequisites

Desktop development currently targets Windows and requires:

- Node.js 25.5 or newer. The Desktop build uses Node's official direct `--build-sea` command; the repository's lower Node minimum remains sufficient for non-Desktop work.
- pnpm at the repository-pinned version.
- Rust 1.85 or newer with the MSVC host target.
- Microsoft C++ Build Tools and the Windows SDK.
- Microsoft Edge WebView2 Runtime.
- A compatible `codex` executable on `PATH` for real Agent execution. The Host can still expose durable read-only history when Codex is unavailable.

Run `pnpm install` at the repository root before using the Desktop commands.

## Development

From the repository root:

```text
pnpm desktop:dev
```

This one command:

1. Builds workspace packages needed by the Host.
2. Bundles the Host and emits the Node SEA sidecar.
3. Starts the Vite server through Tauri's `beforeDevCommand`.
4. Launches one CodeTether Desktop process.
5. Lets Rust start, verify, and own the local Host.

Do not start `pnpm host:serve` beside `desktop:dev`. Port 4317 is intentionally exclusive, and Desktop does not attach to an externally owned Host.

Standalone Browser mode remains supported:

```text
pnpm host:serve -- --workspace <absolute-path>
pnpm dev
```

Browser mode does not execute Tauri APIs, retains the explicit Vite Origin allowlist, and keeps manual absolute-path Project entry.

## Production Build

From the repository root:

```text
pnpm desktop:build
```

The command first creates the Host sidecar, then Tauri builds `apps/web` and the Windows Desktop package. Expected generated outputs include:

```text
apps/desktop/src-tauri/binaries/codetether-host-<target-triple>.exe
apps/desktop/src-tauri/target/release/codetether-desktop.exe
apps/desktop/src-tauri/target/release/bundle/nsis/*.exe
```

Generated sidecars, Rust targets, and installers are build artifacts and are not source files. The installed application loads packaged Web assets; it does not connect to Vite or require pnpm at runtime.

The production Host executable is a Node Single Executable Application. esbuild bundles the Host entry and JavaScript dependencies, Node built-ins such as `node:sqlite` remain runtime built-ins inside the embedded Node executable, and the result is registered as a Tauri external binary. Ordinary users do not need a separate Node.js installation.

## Revision Coupling

`desktop:sidecar` derives a build identity from the current Git revision:

```text
git-<first 12 revision characters>[-dirty]
```

That identity is embedded in the Host bootstrap response and copied into the Rust build. Desktop readiness requires both Protocol v1 and the exact expected Host identity. A binary from another build is not silently accepted.

## Startup

Desktop startup follows this order:

1. The official Tauri single-instance plugin rejects a second owner; a second launch restores and focuses the existing `main` window.
2. The supervisor inspects `127.0.0.1:4317`.
3. A free port permits spawn of the fixed bundled `codetether-host` sidecar with `CODETETHER_DESKTOP_MANAGED=1`.
4. The supervisor assigns the owned process to a Windows Job Object and retains its child handle.
5. Rust writes the private `start` activation only after process-tree ownership is established, so startup cannot spawn Codex outside the owned Job.
6. Readiness polls `GET /api/v1/bootstrap` for up to 15 seconds.
7. Protocol v1 and the revision-coupled Host identity must both match.

Startup distinguishes these safe failures:

- Host binary missing.
- Host spawn/process-tree ownership failure.
- Another CodeTether-shaped Host already running.
- An unknown process using port 4317.
- Host exit during startup.
- Bootstrap timeout.
- Protocol or bundled Host identity incompatibility.

Desktop never kills, replaces, or silently attaches to a process discovered through the port check.

## Host Ownership and Shutdown

Only the Host child started by the current Desktop process is owned. Closing CodeTether exits the application; there is no tray behavior.

Normal shutdown writes the private line below to the owned Host's piped stdin:

```text
shutdown
```

The Host then enters its graceful close path: it stops HTTP/SSE acceptance, drains admitted mutations to their durable boundary, releases process-local Approval requests, flushes dirty durable Turn state, checkpoints/closes SQLite, and shuts down the Codex App Server. Durable Approval expiry remains the established restart reconciliation. Desktop waits up to 12 seconds before terminating only its own process tree.

In managed mode, stdin EOF or a channel error requests the same graceful close. On abnormal Windows parent death, EOF handling races the kernel closing the Job Object: CodeTether attempts the graceful path, while `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` guarantees process-tree cleanup even when no flush grace period remains. Restart reconciliation remains the durability boundary. The Job is never used as authority over an external port occupant.

An unexpected Host exit reports a specific native Desktop failure. After acknowledgement, Desktop exits and releases its owned Job/process tree instead of pretending the workspace is healthy. Phase 4A does not run an automatic restart loop.

## Data Location

Desktop does not create a second persistence boundary. The sidecar uses the existing Host defaults:

- Windows: `%LOCALAPPDATA%\CodeTether\codetether.sqlite3`
- macOS: `~/Library/Application Support/CodeTether/codetether.sqlite3`
- Linux: `$XDG_DATA_HOME/codetether/codetether.sqlite3`, otherwise `~/.local/share/codetether/codetether.sqlite3`

An absolute `CODETETHER_DATA_DIR` is inherited for isolated development and smoke tests. Do not point it at the CodeTether repository.

## Origin and CSP

The fixed business endpoint remains:

```text
http://127.0.0.1:4317
```

Production WebView requests use the explicit `http://tauri.localhost` Origin. Development uses `http://127.0.0.1:5173`. Desktop-managed Host startup passes only the applicable Origin; wildcard CORS remains forbidden.

Production CSP permits `connect-src` only to the loopback Host. Development adds only the explicit Vite HTTP/WebSocket endpoints. Remote scripts and wildcard network sources are not enabled.

## Native Capability Boundary

The Desktop currently pins Tauri 2.11.x and the official Rust Dialog plugin 2.7.2. `withGlobalTauri` remains disabled. `capabilities/main.json` grants the `main` WebView exactly one application permission, `allow-project-directory-picker`, which maps only to the command `pick_project_directory`. It does not grant a Dialog-plugin wildcard or any shell, process, or filesystem permission. Tauri also generates the lower-level `allow-pick-project-directory` command permission during the build, but the main capability deliberately grants only the reviewed application permission.

React can receive only the selected path string or cancellation from that command. It cannot:

- Execute an arbitrary shell command.
- Spawn another process.
- Enumerate, read, write, canonicalize, or authorize a directory through Tauri.
- Replace HTTP/SSE with a Tauri business RPC path.

The shell plugin is still consumed only by trusted Rust code to launch the fixed Host sidecar. There is no generic `run_command`, `native_action`, or filesystem invoke bridge.

## Project Directory Picker

Desktop Add Project uses this narrow chain:

```text
shared AddProjectDialog
  -> Browser-safe NativeCapabilities adapter
  -> pick_project_directory
  -> Rust Dialog plugin (directory-only, single selection, main-window parent)
  -> selected path string
  -> existing HostRuntime / packages/client Project mutation
  -> Host canonicalization, workspace authorization, duplicate handling, SQLite
```

Cancel returns `null` and leaves the Add Project dialog open without an error or empty mutation. Native picker failure is presented as a safe inline error. The shared dialog separates `picking` from Project `registering`, deduplicates a picker already in flight, and keeps the existing action-ID/idempotency mutation path.

Desktop presents the selected directory basename first and a truncated full path second. The optional Project name remains unset unless the user enters it, so Host default naming is unchanged. The native layer does not split, normalize, inspect, or quote the path; Unicode and spaces are carried as a Rust/JavaScript string to the Host API.

Standalone Browser mode uses the same `AddProjectDialog`, but its native capability is unavailable and the existing absolute-path input is shown instead. The Tauri core module is lazy-loaded only after the centralized adapter detects a real Tauri runtime. The Projects page, Projects empty state, and global New Conversation handoff do not maintain separate Desktop and Browser forms.

Phase 4B does not add Project discovery, relocation, multiple roots, drag-and-drop, recent folders, Open in Explorer, or a file picker. Notifications, tray, updater, custom window chrome, and remote networking also remain separate phases.

## Validation Commands

```text
pnpm desktop:sidecar       # Build the target-triple Node SEA Host
pnpm --dir apps/desktop test
pnpm desktop:check         # cargo fmt/check/clippy/test
pnpm desktop:build         # Build Web, raw Desktop executable, and NSIS package
pnpm desktop:package-smoke # Cold-start the release executable against temp data
pnpm desktop:installer-smoke # Build, install, launch, verify, close, and uninstall NSIS
pnpm desktop:installer-smoke:hold # Keep the exact isolated install open for UI smoke
pnpm desktop:installer-smoke:cleanup # Remove only that held smoke installation
```

The package smoke argument is internal test plumbing. It starts the release application against an isolated `CODETETHER_DATA_DIR`, waits for a verified Host, requests owned graceful shutdown, and expects exit code zero.

The required Phase 4B validation has completed in development, raw production, and an isolated installed NSIS application. The real Windows picker passed cancellation, selection, main-window ownership, Unicode/space paths, Project registration, TopBar New Conversation handoff, and a real Codex Conversation. Graceful close removed the owned Desktop/Host/Codex process tree and released port 4317; uninstall removed the exact smoke installation, registry identity, and state. Phase acceptance remains an Owner decision.

## Known Limitations

- Phase 4B remains Windows-first. macOS/Linux packaging, native dialog, and process-tree behavior have not been accepted.
- The Host uses fixed port 4317. Dynamic-port negotiation is not implemented.
- A running external CodeTether Host is reported rather than adopted.
- Host crash recovery is visible but not automatically retried.
- Native decorations are retained; custom Desktop chrome is future polish.
- Builds/installers are unsigned local Alpha artifacts. Signing, updater, and release channels are not implemented.
- The current application icon is a minimal Alpha asset; final brand artwork is still pending.
- Drag-and-drop folders, recent-folder persistence, Project relocation/multi-root, Open in Explorer, Desktop notifications, tray, remote access, Machine management, and additional Agent providers remain out of scope.
