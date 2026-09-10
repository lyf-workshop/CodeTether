# CodeTether Desktop

`apps/desktop` is the Windows-first Tauri v2 shell for the accepted CodeTether Local Workspace Alpha. It packages the existing `apps/web` UI and supervises a bundled executable form of the existing `apps/host` process.

The packaged application uses `CodeTether` as its product name and `com.codetether.desktop` as its stable bundle identifier.

It is deliberately not a second application backend. Project, Conversation, Attention, SQLite, Codex adapter, runtime projection, and Protocol v1 behavior remain owned by the Host/Web packages that also support standalone Browser development.

## Architecture

```text
Tauri v2 shell
  ├─ single main-window / System Tray lifecycle
  ├─ bounded Windows power / session lifecycle handling
  ├─ single-instance enforcement
  ├─ fixed Host sidecar spawn/readiness/exit supervision
  ├─ private owned-child shutdown channel
  ├─ exact Project directory picker
  ├─ bounded Attention notification delivery / click activation
  └─ explicit Tray Quit / bounded Host drain
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

Tauri does not expose business commands to React. The WebView continues to use `packages/client` over HTTP/SSE, exactly as Browser mode does. The native Project command only acquires a user-selected path before the existing Host Project mutation runs. Notification commands accept only a bounded public intent and never query or mutate Attention.

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
6. Rust attaches the exact main-window Windows power/session-end subclass; failure enters the owned startup-cleanup path. WTS lock/unlock registration is diagnostic-only and degrades safely if Terminal Services is not yet available.
7. Readiness polls `GET /api/v1/bootstrap` for up to 15 seconds.
8. Protocol v1 and the revision-coupled Host identity must both match, and Rust retains that Host epoch for bounded resume checks.
9. Rust creates the single CodeTether tray.
10. The main window is revealed only after Host readiness and tray creation succeed.

Startup distinguishes these safe failures:

- Host binary missing.
- Host spawn/process-tree ownership failure.
- Another CodeTether-shaped Host already running.
- An unknown process using port 4317.
- Host exit during startup.
- Bootstrap timeout.
- Protocol or bundled Host identity incompatibility.
- Windows main-window power/session-end subclass initialization failure.
- Tray creation failure.

Desktop never kills, replaces, or silently attaches to a process discovered through the port check.

## Host Ownership and Shutdown

Only the Host child started by the current Desktop process is owned. X and Alt+F4 no longer exit the application: Rust prevents destruction of the `main` window and hides it to the System Tray. The same Desktop, Host, WebView, route, running Turn, process-live Approval, Attention stream, and notification coordinator remain alive. Ordinary minimize remains ordinary minimize.

Only the tray item `退出 CodeTether` initiates normal product shutdown. It writes the private line below to the owned Host's piped stdin:

```text
shutdown
```

The Host then enters its graceful close path: it stops HTTP/SSE acceptance, drains admitted mutations to their durable boundary, releases process-local Approval requests, flushes dirty durable Turn state, checkpoints/closes SQLite, and shuts down the Codex App Server. Durable Approval expiry remains the established restart reconciliation. Desktop waits up to 12 seconds before terminating only its own process tree. An atomic lifecycle guard makes repeated Quit requests and simultaneous restore attempts no-ops; the tray is removed after the owned Host drain.

In managed mode, stdin EOF or a channel error requests the same graceful close. On abnormal Windows parent death, EOF handling races the kernel closing the Job Object: CodeTether attempts the graceful path, while `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` guarantees process-tree cleanup even when no flush grace period remains. Restart reconciliation remains the durability boundary. The Job is never used as authority over an external port occupant.

## Windows Lifecycle Reliability

Phase 4G.2 keeps the accepted 4G.1 window/application boundary and adds only bounded Windows power/session reliability:

| Boundary                 | CodeTether behavior                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X / Alt+F4               | Prevent main-window destruction and hide the existing WebView. Desktop, Host, Codex work, SSE, Approvals, and notifications remain live.                                                                                                                                                                                                                                                                                                  |
| Tray `退出 CodeTether`   | Enter the one idempotent normal-quit transition and allow up to 12 seconds for the established graceful owned-Host/SQLite/Codex drain before owned-tree termination.                                                                                                                                                                                                                                                                      |
| Sleep                    | Record the Windows system as suspended. Do not shut down, interrupt, expire Approval, or forcibly restart the owned Host.                                                                                                                                                                                                                                                                                                                 |
| Resume                   | Admit one recovery per suspend cycle. Check the recorded child once and make one bounded bootstrap request; Protocol v1, revision-coupled build identity, and the startup Host epoch must match. The bounded native event carries that exact epoch, and the existing HostRuntime must re-read bootstrap and match it before reconnecting its one SSE transport with the current `Last-Event-ID` and ordinary replay/reset/Snapshot rules. |
| OS session end           | `WM_QUERYENDSESSION` performs an immediate memory-only state transition and returns allow. Cancellation restores the prior lifecycle. Confirmed `WM_ENDSESSION` gets a separate 2-second best-effort bounded owned-Host termination attempt before Windows teardown continues.                                                                                                                                                            |
| Desktop/parent crash     | Closing the Job Object removes the owned Host/Codex tree. The next Host startup uses the existing SQLite restart reconciliation for interrupted Turns and expired process-live Approvals; no automatic restart loop is added.                                                                                                                                                                                                             |
| Explorer tray recreation | Recovery remains within pinned Tauri 2.11.5 / `tray-icon` 0.24.2 handling. CodeTether adds no tray poller, duplicate tray registry, or second lifecycle owner.                                                                                                                                                                                                                                                                            |

Resume never adopts a process found through port 4317. A still-live but temporarily unresponsive owned child is retained and the Web SSE reconnect is still requested; an exited, Protocol/build-incompatible, or epoch-changed child enters the existing visible failure cleanup path. Duplicate resume messages cannot start parallel health probes or streams. Lock/unlock observation updates lifecycle diagnostics only and does not change window or Runtime state.

The resume signal is process-local (`codetether://desktop-resumed`) and reuses the already reviewed Tauri event listen/unlisten capability. Its only payload is the startup-owned public Host epoch. One application-scoped listener is registered outside React StrictMode; a transient registration error receives one bounded retry, never a polling loop. HostRuntime closes or aborts its old transport, performs a fresh bootstrap read, refuses a different epoch, and only then reopens SSE. It is not a Protocol v1 event, native business command, poller, durable record, or second Runtime projection. Host-backed TanStack queries use `networkMode: 'always'`, so Windows Internet-connectivity state does not pause loopback Host reads or queue mutations.

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

The Desktop pins Tauri 2.11.5 with its built-in `tray-icon` feature and lockfile-pinned `tray-icon` 0.24.2 implementation, the official Rust Dialog plugin 2.7.2, the official Rust/JavaScript Notification plugin 2.3.3, the Windows activation helper `tauri-winrt-notification` 0.7.3, and the macOS `objc2-user-notifications` 0.3.2 bindings. `withGlobalTauri` remains disabled. Tray creation, Explorer recovery handling, events, and Quit stay entirely inside trusted Rust/Tauri. `capabilities/main.json` grants the `main` WebView only the reviewed Project-picker and Attention-notification application permissions; event listen/unlisten; focused/minimized/visible window reads; and the Notification plugin's permission-check/request commands. The Phase 4G.2 resume signal reuses event listen/unlisten and adds no invoke command. The capability does not grant app exit, `notification:default`, `notification:allow-notify`, a Dialog wildcard, or any shell, process, filesystem, clipboard, or global-shortcut permission.

Production keeps `removeUnusedCommands` enabled. `build.rs` explicitly enumerates `pick_project_directory`, `deliver_attention_notification`, and `take_pending_notification_intent` in the Tauri application manifest, and the generated release allow-list contains exactly those three application commands. The Web adapter's Tauri modules remain dynamic imports: Browser mode never executes them, while production packages them as same-origin chunks allowed by `script-src 'self'` without enabling remote scripts or `'unsafe-eval'`.

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

Phase 4B does not add Project discovery, relocation, multiple roots, drag-and-drop, recent folders, Open in Explorer, or a file picker. The accepted Phase 4G.1 tray and Phase 4G.2 Windows reliability work remain lifecycle surfaces only; updater, custom window chrome, and remote networking remain separate phases.

## Desktop Attention Notifications

Only a newly accepted `attention.created` event can request native delivery. The application-scoped coordinator never derives notifications from Turn events, Agent text, Snapshot/query reconstruction, `stream.reset`, or Host restart. It maps Approval, completed review, and failed Turn to fixed privacy-safe copy containing only a clamped Project name and Conversation title.

The Desktop suppresses a notification only when its focused, visible, non-minimized window already presents the Inbox or the exact affected Conversation. A hidden-to-tray, minimized, or unfocused window is background and remains eligible. Preferences for the three supported types default on and persist as one versioned record in the installed WebView origin's `localStorage`, outside Project SQLite. Browser mode never loads the native adapter and continues to use the durable Inbox alone.

The official Notification plugin owns the platform permission check. Its current Windows desktop API does not expose notification activation, so a narrow Rust bridge displays the toast with the installed `com.codetether.desktop` AUMID, accepts only the validated public `NotificationIntent`, and queues a click for Web navigation. A click calls the same ready/not-quitting window restoration path as Tray and single-instance activation; it never approves, resolves, acknowledges, or retries Attention. Dedupe is process-scoped by `attentionId`, and all native delivery failures remain best-effort.

macOS delivery uses `UNUserNotificationCenter` rather than the plugin's
deprecated `NSUserNotificationCenter` path. The first real delivery lazily
requests Alert authorization, concurrent requests share that one request, and
the pending queue is capped at 256 entries. A retained native delegate requests
Banner/List presentation while CodeTether remains active with its main window
hidden. Accepted Attention notifications retain at most 256 public intents in
process memory; activation consumes the matching intent, restores the same
ready window, and reuses the existing exact-Conversation event/queue route.

Windows WebView2 can suspend a minimized document and pause its SSE consumer. While the Desktop click-intent subscription is active, the adapter holds a shared `navigator.locks` lease using the Wry/WebView2 background-execution workaround and releases it during teardown. Environments without Web Locks safely no-op. A bounded native queue plus the Tauri event and focus/page-show/visibility wakeups recover clicks missed during suspension without polling or creating another Attention projection.

## System Tray and Background Runtime

The System Tray is created exactly once, after Host readiness and before the first window reveal. It uses the configured CodeTether application icon, the `CodeTether` tooltip, a completed left-click restore action, and only these menu items:

```text
打开 CodeTether
──────────────
退出 CodeTether
```

Tray click, Tray Open, notification click, and hidden second-instance launch all call the same Rust `show_main_window` path. That path restores only the existing ready window, unminimizes it when necessary, shows it, and requests focus. Once Quit begins it refuses restoration, so a notification, tray click, or second launch cannot reopen the application during shutdown.

On the first successful close-to-tray, Rust attempts the native “CodeTether 仍在后台运行” explanation and atomically creates the versioned `background-runtime-education-v1` marker only after the platform accepts that notification request. Isolated smoke runs place the marker beneath their absolute `CODETETHER_DATA_DIR`. This Desktop preference is not Project/Attention data. The shared native-capabilities adapter exposes a read-only `backgroundRuntime.available` value so Settings can show a compact Desktop explanation; Browser mode reports `false`, displays no background-runtime surface, and receives no native lifecycle command.

Phase 4G.1 is accepted and frozen at `cee3a71`. Its tray does not add Start with Windows, minimize-to-tray, a close-behavior toggle, tray Attention counts/badges, recent Projects/Conversations, inline Approval actions, notifications after explicit Quit, an OS daemon, or automatic Host restart. Phase 4G.2 does not change that menu or product scope. Explorer taskbar recreation is handled by the pinned Tauri/`tray-icon` boundary rather than a CodeTether watcher or second tray.

## Desktop Product Polish

Phase 4D refines the existing shared Web product tree for sustained Desktop use; it does not add a Desktop-only Conversation page or another native/business boundary.

- Adjacent runs of at least three routine completed Tool executions use deterministic, expandable presentation grouping. Failures, active work, tests, Approvals, and Diff-producing Tools remain individually visible, and the normalized Timeline is unchanged.
- Agent messages render a small safe Markdown subset through typed React elements. Raw HTML, remote images, unsafe URLs, iframe/script execution, and `dangerouslySetInnerHTML` are not used.
- Project-contained absolute paths may be shortened for display only. Durable message text, canonical roots, Terminal content, and Host authorization inputs are not rewritten.
- Inbox and notification navigation may target an existing public Turn; Inspector file selection locates the matching Timeline Diff. Neither path creates durable navigation state or changes Attention resolution.
- Long titles and paths are bounded with full-text affordances, dense Rail and Settings surfaces remain usable at the Desktop minimum size, unsupported controls are hidden, and normal product copy avoids exposing Host/Runtime internals.

Phase 4D changed no Tauri capability, sidecar lifecycle, Project/Conversation/Attention persistence, Protocol v1 contract, or Browser/Desktop component identity. It is accepted and frozen. Durable organization and Search were added in their later accepted phases; accepted Phase 4G.1 adds only the tray/background lifecycle described above, and Phase 4G.2 hardens only its Windows power/session reliability. Additional providers remain separate phases.

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

The package smoke argument is internal test plumbing. It starts the release application against an isolated `CODETETHER_DATA_DIR`, waits for a verified Host, requests the same owned explicit-Quit path used by the tray, and expects exit code zero. The lifecycle smoke additionally exercises real WM_CLOSE/Alt+F4 hiding and hidden single-instance restoration without treating window close as shutdown.

The required Phase 4B validation completed in development, raw production, and an isolated installed NSIS application. The real Windows picker passed cancellation, selection, main-window ownership, Unicode/space paths, Project registration, TopBar New Conversation handoff, and a real Codex Conversation. Graceful close removed the owned Desktop/Host/Codex process tree and released port 4317; uninstall removed the exact smoke installation, registry identity, and state. Phase 4B is accepted and frozen.

The required Phase 4C Windows validation also completed in development, the raw production executable, and an isolated installed NSIS application. It covered real Approval and completed-review delivery, the canonical failed fixture, exact-Conversation foreground suppression, background/minimized and other-Conversation delivery, click restoration/focus/navigation, replay/reset/restart deduplication, preferences, Unicode/long-title copy, Browser fallback, CodeTether installed branding, and graceful lifecycle cleanup. Clicks did not approve, review, acknowledge, retry, or resolve Attention. Phase 4C is accepted and frozen.

Phase 4G.1 Owner acceptance is complete and the System Tray/background-runtime foundation is frozen at `cee3a71`. Its validation covered real X and Alt+F4 hiding, hidden single-instance restore, one continuing Host/epoch and route, running Turn/pending Approval continuity, background notifications, explicit 12-second-bounded Quit, unexpected Host/startup failure, Browser isolation, and raw/installed process-tree cleanup.

Phase 4G.2 is implemented and its evidence is deliberately classified. Real raw-release observations cover hidden idle sleep/wake, pending Approval sleep/wake and later resolution, Explorer restart with one recovered tray, a 30-minute process soak with real Codex Turns, and clean process/port/SQLite shutdown. Packaged harness evidence simulates five suspend/resume cycles, five lock/unlock cycles, cancelled/confirmed session end, and session-query plus real forced-parent termination/restart recovery. The final installed NSIS baseline passed install, launch, Host readiness, hide, exact Tray Quit, uninstall, and process/port/state cleanup. An additional real installed Sleep occurred, but automation-parent Job termination removed the installed process tree before post-wake identity could be observed, so installed-runtime continuity is explicitly unobserved rather than passed. Real Windows logoff/shutdown, dedicated Win+L, a Turn known to be actively executing at the exact suspend instant, and a controlled provider-network change after wake were also not observed and must not be inferred from those harnesses. Windows suppressed native toast display because the existing per-app setting was disabled; durable Inbox truth remained available. Evidence collection is complete and Owner acceptance remains pending; no additional product capability is part of that review.

## Known Limitations

- Desktop packaging, native folder selection, process-tree behavior, and notification delivery remain Windows-first. macOS/Linux have not been validated.
- The Host uses fixed port 4317. Dynamic-port negotiation is not implemented.
- A running external CodeTether Host is reported rather than adopted.
- Host crash or a failed resume identity check is visible but never automatically retried.
- Native decorations are retained; custom Desktop chrome is future polish.
- Builds/installers are unsigned local Alpha artifacts. Signing, updater, and release channels are not implemented.
- The current application icon is a minimal Alpha asset; final brand artwork is still pending.
- Notification click activation exists while the Desktop process is running, including hidden-to-tray state. Delivery after explicit Quit, notification history, push, custom sounds, and quiet-hour rules are not implemented.
- Start with Windows, tray Attention badges/counts, recent-item tray menus, a close-behavior preference, automatic Host restart, and macOS/Linux tray or session-lifecycle validation are not implemented.
- Windows confirmed logoff/shutdown has an explicit 2-second best-effort termination budget, not Tray Quit's 12-second graceful guarantee; forced OS teardown can still win before SQLite receives a clean flush.
- Explorer tray recreation relies on the pinned Tauri 2.11.5 / `tray-icon` 0.24.2 handling; CodeTether has no custom Explorer watcher or tray re-registration loop.
- Drag-and-drop folders, recent-folder persistence, Project relocation/multi-root, Open in Explorer, remote access, Machine management, and additional Agent providers remain out of scope.
- Conversation Delete, bulk organization, tags/folders/groups, global/semantic Search, and old-Turn pagination remain out of scope.
