# Phase 8D — Cross-Platform Distribution

## Status and scope

Implementation-only continuation of Owner-frozen Phase 8C, baseline
`67c71f2e3ad390004cc60fe30925224a02aba485`. This document is not platform
acceptance. The original 120 Phase 8D criteria remain unchanged. Mandatory REAL
Mac/physical Linux receipts cannot be replaced by compilation, containers, or WSL.
No Phase 9, backend/profile manager, new Provider capability, updater, or Tag.

| Target              | Implementation                                              | REAL validation / support                                         |
| ------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| Windows x64 Desktop | Existing NSIS plus shared release identity                  | Supported frozen foundation; current artifact regression required |
| macOS arm64 Desktop | Native Tauri app/DMG configuration, icon, lifecycle bridge  | Pending; NOT Supported yet                                        |
| Linux x64 Node      | SEA/archive and systemd user installer                      | Container/WSL automation only; physical machine pending           |
| macOS arm64 Node    | SEA/archive and LaunchAgent installer                       | Pending; NOT Supported yet                                        |
| Linux arm64 Node    | Native-target build entry                                   | Pending / preview target only                                     |
| Linux x64 Desktop   | Tauri deb/AppImage configuration                            | Preview target, NOT AVAILABLE as a validated release              |
| Intel macOS         | Existing native x64 SEA mapping; no universal build promise | NOT OBSERVED                                                      |
| Windows Node        | Existing CLI/SEA; no user service implementation            | NOT Supported as a distributed background Node                    |

## Architecture and authority

Distribution wraps the frozen product; no database or Machine protocol migration
is introduced. Machine TLS, enrollment, immutable Machine/ProjectLocation and
ProviderInstallation bindings, actionId, no replay, and native Discover / Adopt /
Resume remain authoritative. Build identity is metadata, never trust authority.
Protocol incompatibility remains a CodeTether update issue, distinct from identity
mismatch or Provider compatibility. Equal build commits are not required between
compatible Controllers and Nodes. Unknown protocol versions still fail closed.

### POSIX supervision

Windows retains its kill-on-close Job Object. On POSIX, Desktop launches a private
guardian before Tauri initialization. It admits only the adjacent packaged Host
and fixed Host arguments. The guardian establishes a process group before Host
activation; a private pipe carries start, shutdown and existing recovery signals.
The guardian observes owner-pipe EOF even after hard Desktop termination.

The leader is observed using `waitid(WNOWAIT)` and is not reaped before the final
group signal. This reserves the group identity across normal leader exit, avoids
PID-reuse targeting, and makes consumed guards unable to signal later launches.
Exclusive child-reaping policy is checked before spawn; private guardians reset
inherited SIGCHLD auto-reaping. Loss of the reservation fails closed without a
numeric group signal. The inherited-auto-reap failure has a deterministic regression.
Graceful shutdown has a 12-second bound, followed by group termination and a
bounded two-second exit observation. No shell kill, process-name matching, or
arbitrary PID assignment is exposed. Automated tests cover normal exit,
descendants, independent groups, stale cleanup and parent-pipe EOF.

POSIX groups are not a sandbox against a process deliberately creating another
session/group. Node-owned remote Providers retain their frozen independent
guardian and lease authority. Packaged POSIX Codex compatibility probes have a
private per-probe guardian using the same reserved-leader mechanism, since their
separate groups cannot be contained by the outer Host group. Exact executable
and bounded argv cross an inherited pipe; the adapter's sanitized environment
is unchanged. EOF, timeout and explicit cancellation clean only that probe.
The native installed Mac regression remains mandatory.

### macOS desktop lifecycle

Tauri owns the native picker, application bundle, Dock and Single Instance.
Dock reopen restores the existing window. Menu-bar left click opens its menu;
Windows tray behavior is unchanged. NSWorkspace sleep/wake notifications feed
the existing lifecycle generations and bounded reconciliation, not a new
reconnect worker. Native notifications use the existing safe notification intent;
macOS activation/deep-link behavior still requires REAL validation.

Finder discovery reuses Phase 8B configured/prior/PATH/known candidate ordering.
The bounded known list adds `/opt/homebrew/bin` and `/usr/local/bin` for macOS;
existing `~/.local/bin`, Provider-native locations, verified npm shim resolution,
revision checks and deterministic installation selection remain intact. No
interactive shell is sourced and no alternate installation fallback is added.
Native session formats/locations remain solely in the Provider adapters.

## Build identity and release entry points

Root `package.json.version` is the authoritative product distribution version.
Tauri reads it by path. Cargo's required manifest mirror is checked against it
at build time. SEA builders embed that version and the existing git build ID.
Host and Node `--version` print safe component/version/build/platform/architecture
without opening state or starting a Provider. Desktop logs the same safe facts.
Internal workspace package versions are not release versions.

Use locked pnpm dependencies and the existing Node 25.8.2 SEA toolchain for the
current Alpha candidates. Release wrappers reject a dirty tracked tree and a
nonmatching native OS/architecture. They do not cross-build or claim support.

```text
pnpm install --frozen-lockfile
pnpm release:desktop:windows-x64
pnpm release:desktop:macos-arm64
pnpm release:desktop:linux-x64
pnpm release:node:linux-x64
pnpm release:node:linux-arm64
pnpm release:node:macos-arm64
pnpm release:manifest generate output/release/COMMIT DESCRIPTORS.json
pnpm release:manifest verify output/release/COMMIT release-manifest.json
```

macOS builds require a Mac, Xcode/CLI tools and a native arm64 Node runtime.
The minimum is macOS **13.5**, matching the embedded [Node 25.8.2 runtime](https://github.com/nodejs/node/blob/v25.8.2/BUILDING.md).
Linux x64/arm64 require glibc 2.28+, kernel 4.18+, libstdc++ and libatomic;
the release test target is Ubuntu 24.04 or Debian 12, not all Linux distributions.
No Linux desktop WebKit/GTK dependency is silently omitted.

No repository CI existed at the baseline. Native, deterministic commands are
provided for an approved future runner; no fictitious hosted Mac job is claimed.

## Artifacts, checksums and privacy

Names are `CodeTether-COMPONENT-VERSION-PLATFORM-ARCH.TYPE`. Node archives contain
only the executable, an architecture/checksum-checking `install.sh`, `INSTALL.txt`,
and safe `build.json`; never the repository,
Provider installations, user configuration, sessions, .env or Playwright output.
Desktop NSIS/DMG/deb/AppImage outputs are copied to canonical release names with
SHA-256 build receipts. A build receipt is not an installed acceptance receipt.

The Alpha manifest contains version, full commit, channel, generatedAt and
component/platform/architecture/filename/size/sha256/artifactType/signingState.
Generation requires matching hash-bound native launch and privacy receipts;
verification rejects missing/corrupt files, duplicates, changed manifests,
platform mismatches, stale commits and absent observations. BUILD ONLY remains
BUILD ONLY. The manifest is metadata, not executable update authority.

The content scanner checks unpacked release inputs against synthetic UTF-8 and
UTF-16 sentinels, private-key payloads and forbidden filenames. Native app/archive
contents must also be inspected after packaging/signing. Scanning compressed
bytes alone is never a content audit. Final REAL artifact privacy and installed
receipts are still required; this implementation does not scan Owner secrets.

## Installation and user services

Windows retains current-user NSIS, Start Menu/shortcuts and isolated installer
smoke. Desktop uninstall retains product data. macOS Desktop is installed by
dragging the packaged app to Applications; ordinary use does not require source
commands. Finder/upgrade/reinstall behavior must be observed on the final DMG.

For a verified Node archive, extract into a user-owned directory, then run:

```sh
./codetether-node --version
./install.sh
./codetether-node service status
./codetether-node service stop
./codetether-node service start
./codetether-node service restart
./codetether-node service uninstall
```

Installation must run as the intended **non-root** user and requires the SEA
artifact, not an arbitrary Node interpreter. It copies the executable to a stable
absolute path, writes an owned user service, and starts it. Wrong native build
targets fail at the builder; users must choose their named architecture artifact.
No sudo/root Provider execution, arbitrary shell, remote installer, environment
editor or generic filesystem API is introduced.

Linux uses `systemctl --user`, `WantedBy=default.target`, bounded restart rate,
`KillMode=control-group`, 0077 umask and a 30-second stop bound. A working user
service manager is required. Autostart occurs at user login; persistent operation
without a login session requires administrator-approved linger policy, which the
installer does not silently enable. macOS uses `launchctl bootstrap/bootout/print`
in `gui/UID`, `kickstart` for restart, RunAtLoad, throttled restart-on-failure and
0077 umask. A GUI login session is required; no Terminal must remain open.

Services bind only loopback on an ephemeral port. Outbound enrolled Relay access
remains the Internet path. No public inbound port/firewall rule is created.
Secure pairing and current Alpha Relay provisioning still use Phase 8C's guided,
explicit authorization flow. For an initial pairing session, stop the service
and use the installed binary's existing `--pair` operation with the exact same
`--data-dir`, then return to the service; no persistent pairing code is written
to a unit/plist. Administrator-assisted Relay provisioning remains separate.
Fresh remote pairing/service handoff remains a mandatory REAL validation item.

Unit/plist serialization escapes paths, `%`, `$`, quotes and XML characters.
Paths must be absolute/control-free. Existing symlink ancestors and unowned
registrations fail closed; exclusive staging prevents overwrite through a
pre-existing staging file. Reinstall stops the exact existing service and updates
only product binary/registration. Uninstall removes those, **not durable state**.
An interrupted installation fails explicitly and retains state; do not delete
identity to recover. Downgrade is unsupported.

## Data, logs, environment and permissions

| Component            | Default state                                                  |
| -------------------- | -------------------------------------------------------------- |
| Windows Desktop      | `%LOCALAPPDATA%/CodeTether` (unchanged)                        |
| macOS Desktop        | `~/Library/Application Support/CodeTether`                     |
| Linux Host Preview   | `$XDG_DATA_HOME/codetether` or `~/.local/share/codetether`     |
| Linux Node, new user | `~/.local/share/codetether-node/state`                         |
| macOS Node, new user | `~/Library/Application Support/CodeTether/Node/state`          |
| Existing Node        | `~/.codetether-node` retained; explicit `--data-dir` unchanged |

Both legacy and new Node state present is ambiguous and fails closed; the user
must choose the exact existing state, never silently obtain another identity.
Private Node directories retain 0700 and sensitive files 0600. Service binaries
are 0700; registrations 0600. The existing endpoint-local key store remains; no
Keychain migration, cloud credential copy or destructive state migration exists.

Linux service diagnostics use the user journal. macOS service logs are under
the Node application's `logs/service.log`, with private parent directory/umask.
Long-running macOS log retention/rotation still requires the platform lifecycle
validation pass. Desktop uses its existing safe technical log/diagnostic channel;
there is no newly invented persistent Desktop log path.

Service configuration sets only a bounded executable search path. Provider
native credential/config files remain endpoint-local. Shell-only credentials are
not copied; readiness must remain unknown/unavailable when unavailable to the
service. Doctor's runtime/backend separation and custom-gateway semantics remain
unchanged. This is not a Backend/Profile Manager.

## Native historical transcript projection

Phase 8D includes one shared corrective read path for explicitly adopted native
Conversations. Codex reads the official bounded `thread/items/list` metadata
surface; Claude Code reads its bounded Machine-local JSONL session file. Each
adapter owns native format validation, safe visible-content normalization,
Provider-private pagination and its content-free adoption boundary. Unsupported
or changed formats affect historical display only and do not poison execution or
native resume compatibility.

Web requests the recent page only when an adopted Conversation is opened. Host
authorizes the exact immutable Conversation, Machine, ProjectLocation, Provider
and selected ProviderInstallation, then projects random scoped public cursors and
opaque entry identities. Remote reads use one narrow Machine TLS transcript
operation; no arbitrary file path or generic filesystem operation is exposed.
Relay remains an opaque nested-TLS byte forwarder and stores no transcript data.

Native historical entries render before durable CodeTether Turns and are always
read-only. They are never inserted into Turn, action, execution, Attention,
notification, failure or Search tables. New adoptions persist only migration
018's nullable opaque boundary; existing adoptions use conservative Provider
evidence and report partial history if they cannot be split reliably. Native
resume continues by private Provider session identity and never by transcript
replay.

## Signing and updates

Tauri's [Windows signing configuration](https://v2.tauri.app/distribute/sign/windows/)
can use a securely provisioned certificate store/signing tool and private build
configuration; [macOS signing/notarization](https://v2.tauri.app/distribute/sign/macos/)
uses its documented secure environment/CI inputs. Never commit credentials or
print them. No production credentials were requested or observed in this pass.
Signed, unsigned, ad-hoc, notarized and not-observed remain separate manifest
states. macOS SEA signing and required JIT entitlements must be checked on the
native artifact; ad-hoc development signing is not public signing/notarization.
Signing is not SmartScreen reputation. No silent update is implemented.

## Later REAL validation checklist

### Approved Apple Silicon Mac

Access needed: arm64 hardware, supported macOS 13.5+ with a logged-in GUI session,
Xcode/CLI tools, repository build access or approved artifact transfer, permission
to install an isolated test app and user LaunchAgent, compatible endpoint-local
Codex/Claude availability, and explicit permission for sleep/wake testing. No
passwords/private keys should be placed in chat or receipts.

1. Build clean HEAD: locked install, repository gates, Rust fmt/check/clippy/test,
   native arm64 Host/Node SEA, `.app` and DMG. Hash before testing; inspect resources
   and signing state. Record `macos-desktop-artifact.json` / `macos-node-artifact.json`.
2. Finder launch without Terminal PATH; keyboard onboarding, native picker with
   spaces/Unicode/symlink/case variants, exact two Provider installations, Doctor.
   Record `macos-first-launch-real.json` and actual platform/path observations.
3. Isolated explicit local Codex and Claude Turns: streaming, one completion,
   exact executable/revision/location/backend. No fallback. Record provider receipts.
4. External native sessions created before discovery: store pre/post hash/count,
   discover/adopt/rescan with zero inference, explicit native resume continuity,
   no transcript replay/replacement. Record `macos-session-adoption-real.json`.
5. Close/reopen/menu/Dock/Single Instance/Quit/restart; reinstall and upgrade
   preserve Projects/history/native bindings/onboarding/selection/trust. Observe
   sleep/wake/network change; uncertain active Turns never replay. Record lifecycle receipts.
6. Install the final Node archive as the test user; verify LaunchAgent, actual
   service environment, identity/permissions, pairing and Relay-only execution.
   Restart/logout-login; identity and native resume persist. Test Windows Controller
   to macOS Node. Record install/service/Relay/controller receipts.
7. From packaged macOS Desktop control physical Linux over Direct and REAL Internet
   Relay-only. Record exact provenance, zero Direct fallback, no active migration.
8. Remove test LaunchAgent/binary/test-owned projects/sessions, retain or explicitly
   dispose only authorized test state, audit processes/ports/privacy/Relay grants.

### Approved physical Linux machine

Access needed: Ubuntu 24.04 or Debian 12 preferred, actual distro/kernel/architecture
recorded, x64 mandatory (arm64 optional), a non-root user with a working systemd
user manager, installed compatible Providers, outbound TLS access to the accepted
Relay and a permitted private Direct path. Obtain permission for real restart or
reboot/login testing. Do not supply passwords or private keys as evidence.

1. Transfer the final hash-bound matching archive; verify checksum and `--version`.
2. Install as intended user; verify service UID, 0700/0600 state, exact Providers,
   endpoint-local auth/custom gateway, pairing and narrow ProjectLocation setup.
3. Execute both Providers remotely across representative Windows/macOS Controllers;
   Direct and REAL INTERNET Relay-only, exact installation/location/actionId,
   one execution/completion, no replay/fallback. Record `linux-node-*-real.json`.
4. Native session read-only discover/adopt/resume; restart service, real session
   return/reboot where approved, upgrade and uninstall/reinstall with identity
   preserved. Record state hashes/continuity without raw native session IDs.
5. One safe active transport interruption fails closed; later explicit Turn works.
6. Record timings/resources/privacy, remove test unit/processes/registrations and
   temporary Relay peers/grants/tokens, verify Owner and production Relay preserved.

All REAL receipts bind final commit and exact artifact SHA-256. Keep failed and
superseded runs. Final hardware pass re-evaluates all original 120 criteria; this
implementation document neither waives them nor claims acceptance.
