# Phase 8D — Cross-Platform Distribution

## Status and scope

Owner-defined closure scope for the continuation of Owner-frozen Phase 8C,
baseline `67c71f2e3ad390004cc60fe30925224a02aba485`. The accepted functional
integration is `0248d0a0fda70fe62f0ab9f75088967c62ba63fe`. The final scope audit
result is `PHASE8D_SCOPE_CLOSURE_READY_FOR_OWNER_FREEZE`; the Owner has not yet
frozen Phase 8D. No Phase 9, backend/profile manager, new Provider capability,
updater, or Tag is authorized.

| Target                             | Status                                        | Evidence boundary                                                                                        |
| ---------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Windows x64 Desktop / Host         | SUPPORTED                                     | Current functional integration plus accepted Windows REAL                                                |
| macOS Apple Silicon Node / Desktop | SUPPORTED                                     | Accepted Windows → macOS physical REAL closure                                                           |
| Raspberry Pi 5 / Linux ARM64 Node  | SUPPORTED_WITH_PROVIDER_CAPABILITY_LIMITATION | Historical physical Node/Relay/typed-operation REAL; current-head revalidation deferred and non-blocking |
| Linux x64 Node                     | OUT_OF_CURRENT_SCOPE                          | No current Phase 8D support claim                                                                        |
| Linux Desktop                      | OUT_OF_CURRENT_SCOPE                          | No current Phase 8D support claim                                                                        |
| Windows Node                       | OUT_OF_CURRENT_SCOPE                          | No current Phase 8D support claim                                                                        |
| Windows ARM64                      | OUT_OF_CURRENT_SCOPE                          | No current Phase 8D support claim                                                                        |
| Intel macOS                        | OUT_OF_CURRENT_SCOPE                          | No current Phase 8D support claim                                                                        |

Explicit non-blocking boundaries:

- Windows full-OS-reboot recovery REAL: `DEFERRED_NON_BLOCKING`.
- Raspberry Pi current-integration-head physical revalidation:
  `DEFERRED_NON_BLOCKING`.
- Raspberry Pi Codex/Claude execution:
  `CAPABILITY_DEPENDENT_NOT_CURRENTLY_CLAIMED`.
- Public macOS notarization: `DISTRIBUTION_FOLLOW_UP`.

## Architecture and authority

Distribution wraps the frozen product; no database or Machine protocol migration
is introduced. Machine TLS, enrollment, immutable Machine/ProjectLocation and
ProviderInstallation bindings, actionId, no replay, and native Discover / Adopt /
Resume remain authoritative. Build identity is metadata, never trust authority.
Protocol incompatibility remains a CodeTether update issue, distinct from identity
mismatch or Provider compatibility. Equal build commits are not required between
compatible Controllers and Nodes. Unknown protocol versions still fail closed.

Host durable ProviderInstallation selection is product authority. A Node's
selected/default installation is observational or a local default only and cannot
replace that Host decision. Existing Conversation bindings are immutable; new
Conversations bind the current Owner-selected exact installation. Remote session
open carries and independently validates the exact `providerInstallationId` plus
`expectedInstallationRevision` against fresh physical inventory, current
fingerprint, compatibility, readiness, and Provider-specific capabilities. There
is no PATH-first, equivalent-version, Node-default, or alternate-installation
fallback.

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
For the supported Apple Silicon macOS scope, the accepted physical closure is the
authority for installed behavior; no separate unrecorded guardian claim is made.

### macOS desktop lifecycle

Tauri owns the native picker, application bundle, Dock and Single Instance.
Dock reopen restores the existing window. Menu-bar left click opens its menu;
Windows tray behavior is unchanged. NSWorkspace sleep/wake notifications feed
the existing lifecycle generations and bounded reconciliation, not a new
reconnect worker. Native notifications use the existing safe notification intent.
macOS delivery uses `UNUserNotificationCenter` with one lazy, coalesced Alert
authorization request, a bounded pending queue, and a retained delegate that
requests Banner/List presentation while the hidden-window application remains
active. Request acceptance, rather than attempted delivery, commits the one-time
background-runtime education marker. Notification activation restores the same
ready, not-quitting window and consumes a bounded process-memory mapping to
return the existing safe public Attention intent for exact routing. It never
mutates Attention, approves work or retries a Prompt. Public distribution polish,
including notarization, remains a follow-up rather than a Phase 8D architecture
closure blocker.

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

The presence of a release entry point does not establish a support claim. Linux
x64 Node/Desktop, Windows Node/ARM64, and Intel macOS remain out of current scope.

macOS builds require a Mac, Xcode/CLI tools and a native arm64 Node runtime.
The minimum is macOS **13.5**, matching the embedded [Node 25.8.2 runtime](https://github.com/nodejs/node/blob/v25.8.2/BUILDING.md).
The supported Linux target is Raspberry Pi 5 on Debian 12/aarch64 for the
historically validated Node/Relay/typed-operation boundary. Existing Linux x64
and Desktop build plumbing is implementation-only and out of current scope; it
does not establish universal Linux support. No Linux desktop WebKit/GTK dependency
is silently omitted.

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
bytes alone is never a content audit. Accepted REAL receipts remain the authority
for supported targets; build tooling does not scan Owner secrets.

## Installation and user services

Windows retains current-user NSIS, Start Menu/shortcuts and isolated installer
smoke. Desktop uninstall retains product data. macOS Desktop is installed by
dragging the packaged app to Applications; ordinary use does not require source
commands. Accepted support remains bound to the recorded physical receipts;
public notarized distribution is a separate follow-up.

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
Secure pairing retains Phase 8C's one-time code, cryptographic transcript, safe
candidate, and explicit confirmation. A Relay-enrolled Node in pairing mode may
also publish one short-lived, one-time Relay pairing target, allowing the same
OPAQUE pairing state machine to run inside fresh end-to-end Machine TLS over a
purpose-bound opaque Relay stream. Relay never receives the six-digit code and
cannot create Controller trust or carry a pre-trust Machine operation. For an
initial pairing session, stop the service and use the installed binary's existing
`--pair` operation with the exact same `--data-dir`, then return to the service;
no persistent pairing code or rendezvous capability is written to a unit/plist.
Administrator-assisted Relay provisioning remains separate. See
`PHASE8D-RELAY-ASSISTED-FIRST-PAIRING.md`. Relay-assisted first pairing and the
Windows → macOS service handoff have accepted REAL evidence for the supported
scope.

If every usable Controller credential is lost while the Node still retains its
pinned Controller, the installed Node exposes only the local management commands
`controller list` and `controller recover`. Recovery requires the service to be
stopped, exclusive ownership of the existing state lock by the same OS user that
owns the private state directory, an explicit Controller identity, and exact
interactive confirmation containing the durable Machine identity and public-key
fingerprint suffix. The targeted trust removal and its bounded safe audit record
are committed by one atomic replacement of the trust file. The command cannot
create state, is absent from Machine TLS and Relay protocols, does not enable a
pairing code, and does not alter Machine/Node identity, Relay state, Provider
state, Projects, or native sessions. A replacement Controller must subsequently
complete the existing one-time pairing protocol.

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
Long-running log-retention policy and public distribution operations remain
follow-up concerns. Desktop uses its existing safe technical log/diagnostic
channel; there is no newly invented persistent Desktop log path.

Service configuration sets only a bounded executable search path. Provider
native credential/config files remain endpoint-local. Shell-only credentials are
not copied; readiness must remain unknown/unavailable when unavailable to the
service. Doctor's runtime/backend separation and custom-gateway semantics remain
unchanged. This is not a Backend/Profile Manager.

Phase 8D treats a paired Node as a trusted execution endpoint. The exact selected
Codex process runs as the Node's non-root operating-system user and retains that
user's normal native backend, authentication, session-store, and configured MCP
authority. CodeTether does not isolate, parse, copy, rewrite, enumerate, or expose
that configuration. Private MCP startup lifecycle notifications are ignored by
the remote text projection; they do not create a Machine-protocol Tool surface or
relax Controller authentication, exact installation binding, Turn ownership, or
no-replay rules.

## Native historical transcript projection

Phase 8D includes one shared corrective read path for explicitly adopted native
Conversations. Current Codex reads the official bounded `thread/turns/list`
retained-history surface with full persisted items and retains a guarded
`thread/items/list` compatibility path for Provider versions that exposed it;
Claude Code reads its bounded Machine-local JSONL session file. Each adapter owns
native format validation, safe visible-content normalization, Provider-private
pagination and its content-free adoption boundary. Unsupported or changed
formats affect historical display only and do not poison execution or native
resume compatibility.

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

The authority sequence is explicitly `discover != adopt != resume`. Discovery is
read-only and starts no Provider work. Adoption creates one Conversation binding
without converting native history into durable Turns. Native entries remain
Provider-owned, read-only projections with no `actionId`, execution ownership, or
retry semantics. Only a later explicit Turn uses Provider-native continuation;
historical transcript text is never injected to reconstruct context.

## Signing and updates

Tauri's [Windows signing configuration](https://v2.tauri.app/distribute/sign/windows/)
can use a securely provisioned certificate store/signing tool and private build
configuration; [macOS signing/notarization](https://v2.tauri.app/distribute/sign/macos/)
uses its documented secure environment/CI inputs. Never commit credentials or
print them. No production credentials were requested or observed in this pass.
Signed, unsigned, ad-hoc, notarized and not-observed remain separate manifest
states. macOS SEA signing and required JIT entitlements must be checked on the
native artifact; ad-hoc development signing is not public signing/notarization.
Public macOS notarization is `DISTRIBUTION_FOLLOW_UP`, not an architecture closure
blocker. Signing is not SmartScreen reputation. No silent update is implemented.

## Accepted REAL closure evidence

### Windows x64 Desktop / Host

`WINDOWS_CODEX_NATIVE_HISTORY_ADOPT_RESUME_REAL_PASS`

Accepted evidence covers the clean functional build, normal Desktop/Host startup,
local Codex execution, native-session discovery, read-only historical projection,
adoption, Provider-native resume, cold reopen, and immutable exact
ProviderInstallation binding. Historical entries converted into durable Turns,
historical transcript replay, retries, and duplicate execution are all zero. The
one post-adoption user action created exactly one durable Turn. Full Windows OS
reboot recovery REAL remains `DEFERRED_NON_BLOCKING` and is not claimed.

### Windows → Apple Silicon macOS

`WINDOWS_MAC_REAL_PHYSICAL_CLOSURE_PASS`

Accepted evidence covers matching validation builds, Relay-assisted first pairing,
durable Machine identity, Controller trust, `machine_tls_v1`, Relay-only typed
transport with zero Direct fallback, Host-authoritative ProviderInstallation
selection, exact Conversation installation binding and revision validation, the
exact physical Claude runner, Prompt equality through the Adapter, physical stdin
delivery, parsed Provider protocol execution, native resume, the exact two-Turn
boundary, zero replay/duplicates, and the final relay-only
`machine.providers.refresh` preserving Owner selection.

`PROVIDER_RETURNED_NONCOMPLIANT_RESPONSE` records one fresh Claude sentinel-text
mismatch as informational Provider semantics only. Complete delivery and valid
Provider execution were proven; it is not a transport, Prompt-delivery, Provider
service, or Phase 8D infrastructure failure.

### Raspberry Pi 5 / Linux ARM64 Node

`RASPBERRY_PI_HISTORICAL_REAL = PASS`

Historical physical Debian 12/aarch64 evidence covers Node build/install, durable
Machine/Node identity, Controller trust, Relay connectivity, production Relay
typed operations, one Windows relay-only `machine.providers.refresh`, one execution,
one result, and no replay. The device is currently unavailable, so physical
revalidation of integration `0248d0a0fda70fe62f0ab9f75088967c62ba63fe` is
`DEFERRED_NON_BLOCKING`; current-head physical final REAL is not claimed.

Codex and Claude installations on the Pi were not proven compatible for coding-
agent execution. `PROVIDER_EXECUTION_ON_PI =
CAPABILITY_DEPENDENT_NOT_CURRENTLY_CLAIMED`. Pi support is limited to Machine
identity, Node runtime, pairing/trust, Relay connectivity, Machine TLS, typed Node
operations, remote management/presence, and already evidenced reconnect behavior.

## Product claim boundary

Phase 8D may claim Windows Host control of an Apple Silicon macOS Node,
Relay-assisted first pairing, durable Machine identity, exact ProviderInstallation
selection and binding, provider-neutral Codex and Claude architecture,
Provider-native session resume, Codex historical native-session adoption,
read-only historical transcript projection, Relay-only typed Machine operations,
and Provider lifecycle/readiness projection.

It does not claim universal Linux support, Linux x64 validation, Pi Codex/Claude
execution, Windows reboot recovery REAL, public notarized macOS distribution, or
cross-agent Conversation handoff.

## Validation artifacts are not product lineage

Evidence-only commits `4ba9df456e5829ef91bdcd026e9e5cbaa643263b`,
`18d8c98ccbcc7d2b67bb261f92843ac3c0e68df9`, and
`6b92a1f7a9082809786023d00d5b1f63059af427` remain excluded from product
integration. Temporary combined REAL heads, including `2825a2d41ebb`,
`f2e4ca31a2ee`, and `280e2baaa08b`, are historical validation artifacts only.
Their evidence instrumentation is not product functionality.

Phase 8D remains ready for the Owner's freeze decision and is not frozen by this
document.
