# Development and builds

For product features and platform status, see the [README](../README.md). This guide covers source builds, development commands, and local data.

## Prerequisites

- Node.js 22.13.0 or newer, with `node:sqlite` available without an experimental flag.
- pnpm 10 or newer; use the repository's recorded package-manager version, `pnpm@11.20.0`, for reproducible installs.

Desktop builds also require Node.js **25.5 or newer** for the official `--build-sea` Host sidecar pipeline and Rust **1.85 or newer**. On Windows, install the Rust MSVC target, Microsoft C++ Build Tools, the Windows SDK, and Microsoft Edge WebView2 Runtime. macOS builds require a native Mac with Xcode or Command Line Tools and an arm64 Node runtime. See the [native platform prerequisites](PHASE8D-CROSS-PLATFORM-DISTRIBUTION.md) for platform-specific details.

Install and authenticate the Codex or Claude Code CLI you intend to use. Reading stored conversation history does not require starting a CLI session.

## Desktop build configuration

The desktop build uses three required `VITE_*` variables and one optional variable. Configure the required variables in the build environment before building the desktop app. These settings are compiled into the Web client, so they must contain client-facing configuration only.

| Variable                            | Requirement                              | Purpose                                                                                                                      |
| ----------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `VITE_CODETETHER_CONTROL_PLANE_URL` | Required; validated by the desktop build | Base URL of the account control-plane API used for device registration, Host registration and claiming, and access requests. |
| `VITE_SUPABASE_URL`                 | Required; validated by the desktop build | Supabase project URL used by the account authentication client.                                                              |
| `VITE_SUPABASE_PUBLISHABLE_KEY`     | Required; validated by the desktop build | Supabase publishable client key used to initialize that authentication client.                                               |
| `VITE_CODETETHER_HOST_URL`          | Optional; local default                  | Base URL used by the Web client for the local Host's HTTP/SSE API; it must match the desktop-owned loopback Host.            |

The optional Host URL has a loopback default in the client; setting it does not change where the desktop sidecar listens. Keep private credentials out of client build configuration.

## Build from source

Run these commands at the repository root after configuring the build environment:

```bash
pnpm install --frozen-lockfile
pnpm desktop:build
```

The desktop build compiles the Host sidecar, Web assets, and native desktop bundle for the current platform. On Windows, the bundle is an NSIS installer. Building does not install or launch the application.

## Development workflows

For desktop development, install dependencies as above, then run:

```bash
pnpm desktop:dev
```

This builds the Host sidecar, starts Vite through Tauri, launches one desktop window, and supervises its owned Host. Use an isolated absolute `CODETETHER_DATA_DIR` for development data and do not start a second Host for this workflow.

For browser development, build the Web app's workspace dependencies before the first run. This excludes the Web app itself:

```bash
pnpm --filter "@codetether/web^..." build
```

Then start the local Host and Web app in separate terminals:

```bash
pnpm host:serve --workspace <absolute-path>
pnpm dev
```

`pnpm dev` starts only the Web app. Use an existing disposable directory for `<absolute-path>`, then add or open its project in the UI. The Host owns durable history; refreshing the client reconstructs retained history, and sending a message after a Host restart resumes the saved CLI session when supported.

## Commands

All commands below are defined in the root `package.json`. Commands that execute Codex or exercise desktop packaging should use isolated data and disposable workspaces.

```bash
pnpm dev           # Start apps/web
pnpm typecheck     # Typecheck workspaces with a typecheck script
pnpm lint          # Lint the repository
pnpm build         # Build workspaces with a build script
pnpm test          # Run workspace test scripts
pnpm format        # Format repository files
pnpm format:check  # Check repository formatting
pnpm codex:spike   # Run the manual real-Codex integration spike
pnpm host:serve --workspace <absolute-path>  # Start the loopback Host API
pnpm host:integration                          # Run real HTTP/SSE integration
pnpm host:control                              # Run the isolated browser-control harness
pnpm host:observe create --cwd <absolute-path>  # Create a development conversation
pnpm host:observe turn --conversation <conv_id> --input <text>  # Send a development message
pnpm desktop:dev             # Build the sidecar, start Vite, and launch Tauri
pnpm desktop:sidecar         # Build the Node SEA Host executable
pnpm desktop:check           # Build the sidecar and run Rust fmt/check/clippy/test
pnpm desktop:build           # Build the sidecar, Web assets, and native desktop bundle
pnpm desktop:package-smoke   # Build and cold-start the packaged app with temporary data
pnpm desktop:installer-smoke # Build, install, launch, verify, close, and remove the Windows installer
pnpm desktop:installer-smoke:hold     # Keep an isolated installed app open for manual checks
pnpm desktop:installer-smoke:cleanup  # Remove the exact held smoke installation
```

`pnpm codex:spike` uses only the ignored `.tmp/codetether-codex-spike/` workspace. Do not target the CodeTether source repository with real Codex integration checks. `pnpm host:control` exercises interruption and one-shot command approval in an isolated workspace.

## Local data

The Host uses Node's standard `node:sqlite` API and stores `codetether.sqlite3` outside the repository:

- Windows: `%LOCALAPPDATA%\CodeTether\codetether.sqlite3`; if `LOCALAPPDATA` is unset, the equivalent directory beneath the user's home is used.
- macOS: `~/Library/Application Support/CodeTether/codetether.sqlite3`.
- Linux: `$XDG_DATA_HOME/codetether/codetether.sqlite3` when set, otherwise `~/.local/share/codetether/codetether.sqlite3`.

Set `CODETETHER_DATA_DIR` to an **absolute** directory to isolate development or test data. For example, in PowerShell:

```powershell
$env:CODETETHER_DATA_DIR = "$env:TEMP\codetether-dev"
```

Set it in the same terminal before starting the selected workflow. Do not point it at the CodeTether repository or commit a real database.

SQLite enables foreign keys, WAL mode, a five-second busy timeout, versioned migrations, and an integrity check at open. Database open, migration, integrity, and required write failures are fatal; the Host does not delete or silently replace a failed database.

## Local Host security

The Host listens only on `127.0.0.1`. It checks the request authority and uses an exact Origin allowlist. Local Codex hooks are disabled by default so approval decisions stay on the CodeTether control path.

Project registration requires an absolute existing directory resolved to its real path. When `--workspace` roots are configured, registrations must stay within those roots. Each conversation's working directory must remain within its saved project root, which is revalidated before execution. Use ignored disposable workspaces for development checks that run a CLI.

See [Architecture](ARCHITECTURE.md) for the local Host, persistence, and paired-device security boundaries.
