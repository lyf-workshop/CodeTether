# Phase 8B — Provider Lifecycle & Compatibility

## Scope and invariant

Phase 8B makes changes to an installed Codex or Claude Code runtime observable and safe. It does not install, update, downgrade, remove, migrate, or automatically switch a Provider. It also does not introduce a Provider backend/profile manager.

The core model is deliberately split:

```text
Provider identity
  != ProviderInstallation
  != installation revision
  != runtime compatibility
  != backend readiness
```

- **Provider** is the immutable product identity `codex` or `claude-code` already attached to a Conversation.
- **ProviderInstallation** is one Machine-scoped logical installation, including its private launcher/resolved executable and its durable selected state.
- **Installation revision** identifies the observed executable artifacts behind that logical installation. An in-place update changes the revision without necessarily changing the installation identity.
- **Runtime compatibility** says whether the selected revision satisfies CodeTether's local execution contract and optional features.
- **Backend readiness** describes the effective inference backend configuration and its last safe readiness observation. It is not runtime compatibility.

Projects, Project Locations, Conversations, Turns, native-session bindings, Machine trust, and Relay enrollment remain durable when a Provider changes or disappears.

## Data flow

Local lifecycle observation stays in the Host-owned Machine boundary:

```text
Machine
  -> bounded Provider installation discovery
  -> ProviderInstallation
  -> version + exact executable-revision observation
  -> zero-inference compatibility probe
  -> observed capability contract
  -> runtime compatibility
```

Backend observation is separate:

```text
effective Provider execution environment
  -> allowlisted backend configuration observation
  -> backend mode + secret-presence booleans
  -> backend readiness
```

Execution eligibility composes independent truths:

```text
Conversation
  + immutable Machine / Provider / ProjectLocation
  + bound or selected ProviderInstallation
  + current installation revision
  + runtime compatibility
  + Conversation-required capabilities
  + backend readiness / current execution health
  + Machine transport and capacity
  -> one explicit NEW Turn
```

For a remote Machine, discovery and probing execute on Node:

```text
Web -> Host -> Machine Transport (Direct first, otherwise Relay)
            -> Node ProviderLifecycleCoordinator
            -> Machine-local installation discovery and probes
            -> bounded sanitized lifecycle result
            -> Host durable last-known observation
            -> Web
```

The Relay transports only opaque nested Machine TLS records. It does not decode or persist Provider installation, version, capability, backend, path, native-session, or credential data.

## ProviderInstallation

One installation belongs to exactly one `(machineId, provider)` pair. Its durable private record includes:

- an opaque `pinst_*` installation identity;
- a private logical locator;
- private launcher and resolved-executable paths;
- launcher kind and safely inferred installation method;
- availability, observed version, and opaque `prev_*` revision;
- first- and last-observed timestamps;
- the latest bounded compatibility and backend observations.

The public lifecycle projection omits launcher and resolved paths. It exposes only the opaque installation identity, Provider, selected state, safe version/provenance labels, availability, opaque revision, bounded compatibility/backend state, and observation time. A local advanced technical surface may show a path only through a deliberately local presentation boundary; the Relay and ordinary lifecycle DTO do not receive one.

### Launcher and resolved executable

A launcher is not assumed to be the binary revision. It may be a native file, symlink, hard link, wrapper, or npm shim. Discovery preserves the exact launch specification required by the adapter and separately resolves the files whose identity and contents determine the revision.

The same executable found through a configured path, prior selection, `PATH`, or a known official location is deduplicated by Machine-local file identity. A legitimate link or wrapper is retained rather than rejected, while aliases do not become duplicate installations.

### Logical identity and revision

`ProviderInstallation` identity is derived from Machine, Provider, and a private stable logical locator. It is not derived only from Provider name, version, or current `PATH` order. The revision is derived separately from a bounded digest of the exact execution artifacts and is exposed only as a Machine-scoped opaque value.

This permits an in-place update:

```text
same launcher / logical installation
  + changed resolved target or executable content
  -> same pinst_* identity
  -> new prev_* revision
  -> old compatibility observation invalid
  -> fresh bounded probe
```

Path equality alone is not enough to trust a replacement binary. Conversely, a version-string change is evidence of change but is not the sole compatibility authority.

## Installation discovery and bounds

Provider adapters enumerate only bounded, explicit sources:

1. an explicitly configured executable, when one exists;
2. the durable previously selected/observed launchers;
3. a bounded number of `PATH` entries;
4. known official Provider locations and installation roots.

Discovery does not recursively crawl a home directory or drive. Each candidate is resolved independently so one broken installation cannot hide another. Candidate paths and returned installation counts are capped; public lifecycle results retain at most eight installations per Provider.

If a bounded scan reports that its candidate set was truncated, CodeTether retains omitted known installations and the durable selection as last-known truth. A truncated or timed-out candidate set cannot prove removal; only a complete current Machine observation may mark an omitted installation unavailable.

Discovery and compatibility observation are Machine-local and read-only. They never rewrite Provider binaries, settings, credentials, or native-session stores. They do not run model inference.

## Deterministic selection

Each Machine/Provider pair has at most one durable selected installation. On first observation, the existing configured/runtime resolution semantics establish the selection. Later refreshes prioritize and preserve that selected logical installation even if `PATH` order changes or another compatible installation appears.

Install method is informational and never execution authority. An alternate installation is not an automatic fallback. If the selected installation is missing, unavailable, or incompatible, CodeTether reports that state and keeps the alternate visible; it does not silently switch an existing Conversation or resend a Prompt through another executable.

The selected installation is the source for version observation, compatibility probing, fresh Conversation execution, native-session discovery, and native resume. Adapter layers do not independently resolve the Provider again.

Phase 8B formalizes the current configured/runtime selection; it does not add a general installation picker or arbitrary rebinding command. Any future explicit selection change must be a separate user action, apply only at a safe boundary, and must not migrate an active Turn or an existing Conversation's immutable installation binding. A new Conversation may use the then-selected eligible installation.

## Conversation installation consistency

Migration 016 adds a private immutable Conversation-to-installation binding. New and adopted Conversations bind transactionally to the exact selected eligible installation. A pre-8B Conversation remains readable without Provider access and is bound conservatively only when CodeTether has an exact current selected installation at a legitimate execution boundary.

The binding includes the Conversation's existing Machine and Provider in its foreign-key relationship. It therefore cannot cross Machine or Provider. An update to the same logical installation may replace its revision after revalidation, but the Conversation remains bound to the same `pinst_*` identity. CodeTether does not automatically rebind a Conversation to another installation.

For a new remote session, discovery, validation, session open, and execution carry both the expected installation identity and expected revision through a narrow typed Machine operation. Node rejects a stale or mismatched pair before Provider execution. Raw executable paths never cross that protocol.

## Compatibility model

Runtime compatibility uses five states:

- `verified`: the revision/version is covered by shipped evidence and its required contracts pass.
- `compatible_unverified`: the exact version is new to the shipped verified set, but bounded required-contract probes pass and no known incompatibility applies.
- `limited`: core execution remains safe, while an optional CodeTether feature is unavailable.
- `incompatible`: a required runtime or protocol contract is missing or malformed.
- `unavailable`: the selected installation cannot currently be resolved or executed.

`RuntimeReadiness` is derived from that compatibility state as `ready`, `limited`, `blocked`, or `unavailable`. Temporary inference-service, quota, authentication, or gateway failures do not turn a compatible runtime into an incompatible one.

### Version policy

The shipped adapter policy contains the versions already verified by CodeTether and a small contract version. An unknown newer or older version is not rejected merely for its number. The adapter first validates the version response, then uses zero-inference local CLI/help/protocol probes for the exact contracts CodeTether requires.

A downgrade, launcher-target change, executable-content change, or CodeTether compatibility-contract change invalidates the prior result and requires a new observation. Malformed version output remains unknown and cannot be guessed from arbitrary prose. A known missing mandatory contract becomes incompatible; a missing optional contract becomes limited when core execution remains valid.

### Capability contract

Every tracked capability has three values:

```text
observedSupport + codeTetherEnabledPolicy -> effectiveSupport
```

The tracked contract separates execution, streaming, native resume, native-session discovery, file Read, Search, Tool events, and reasoning control. Required execution contracts and optional product features are evaluated independently. In particular:

- native-session discovery may become unavailable without disabling fresh execution;
- native resume may be required for one existing/adopted Conversation even when a fresh Conversation could still execute;
- Provider-observed support never expands CodeTether policy automatically.

The frozen Claude effective matrix remains unchanged: streaming, native resume, Read, Search/Glob/Grep, Tool events, and reasoning/effort control remain admitted. Edit, Write, Bash, Shell, PowerShell, Diff, Approval, Interrupt, Stop, and Model Selection remain disabled even if a newer Claude executable advertises them. Phase 8B does not add Codex capabilities either.

## Compatibility cache and stale-result guards

Compatibility is keyed by Machine, Provider, installation identity, opaque installation revision, and the adapter compatibility-contract version. A cached result is valid only for that exact tuple. A backend-configuration revision is tracked separately so backend change does not falsely invalidate an unchanged runtime contract.

One lifecycle coordinator per local Host or remote Node owns refreshes. Concurrent requests for the same Provider coalesce behind the same bounded work. Provider probes have fixed process, time, output, and candidate limits and are distinguishable from Provider Turn processes. A probe creates no Project, Conversation, Turn, `actionId`, execution ownership, Attention, or model request.

Each refresh has a generation/revision guard. If the launcher target or executable revision changes while a probe is running, the stale result is discarded and cannot overwrite the newer revision. Codex and Claude refresh independently, so one Provider failure does not erase the other's result.

Cold Project, Conversation, Search, organization, Inbox, and Attention reads consume durable state and do not start lifecycle probes. Reasonable probe points are startup's bounded initial observation, explicit **Check again**, Provider refresh, stale/missing capability at discovery, and the admission boundary before a new execution.

### Current and last-known state

A successful current Machine observation may replace the bounded current lifecycle row for its exact installation revision. Loss of Machine transport does not prove that an installation was removed, so an offline Machine retains the durable observation as `last_known` with its observation time. Only a current observation on the owning Machine may establish that an installation is unavailable.

Runtime compatibility and backend readiness also age independently. A configuration-only refresh cannot turn an earlier successful inference into a new current readiness proof; for the same backend-configuration revision, that readiness may remain visible only as `last_known`. A changed safe backend-configuration revision resets readiness to `unknown` or the applicable configuration/authentication state without invalidating an unchanged runtime compatibility result. Host or Node restart reconstructs coordinators from durable selection/observation state and re-observes at a bounded lifecycle point; it does not require Machine re-pairing, Relay re-enrollment, or Conversation recreation.

## Backend mode and readiness

Backend observation reads only an allowlisted projection of the effective environment that the selected installation will receive. Supported observation modes are `first_party`, `custom_gateway`, `bedrock`, `vertex`, and `unknown`. This is observation, not switching or setup.

The public safe configuration contains booleans such as `hasBaseUrl`, `hasApiKey`, `hasAuthToken`, `hasOAuthToken`, `bedrockConfigured`, and `vertexConfigured`, plus a configuration source class and optional sanitized custom-gateway origin. No credential value is returned or persisted in a public lifecycle record.

Backend readiness is one of:

- `unknown`: configuration is understood but no authoritative current inference result proves reachability;
- `ready`: a first-party auth check where authoritative, an explicit check, or a real execution has established readiness;
- `unavailable`: backend/network/service evidence shows current unavailability;
- `authentication_required`: the effective backend requires authentication;
- `misconfigured`: the effective configuration is internally invalid.

For first-party Claude mode, structured auth status may contribute to readiness. For a custom gateway, `claude auth status` is not authoritative; effective gateway configuration and an explicit or real inference result own readiness. Bedrock and Vertex flags can be identified without creating credentials or switching modes. Foundry or conflicting routing inputs remain safely `unknown` rather than guessed.

An inference backend outage therefore has this shape:

```text
Runtime: Compatible
Backend: Custom gateway — Unavailable
History/Search/Organization: Available
New execution: blocked or fails canonically
```

When the backend recovers, a later explicit check or execution may restore current readiness. No Provider reinstall, Conversation recreation, native-session rebinding, or failed-Turn rewrite occurs.

## Provider change, removal, and recovery

Lifecycle revalidation occurs only at bounded points. It never interrupts or migrates an active Provider process because the executable on disk changed. The active Turn remains owned by the exact process and transport that accepted it. No failure or revision change triggers an automatic retry, alternate installation, deferred Prompt, new `actionId`, or Prompt replay.

The next explicit Turn checks the bound installation/revision. If the same logical installation has a compatible new revision, it may continue after revalidation. If required compatibility is absent, that execution is blocked canonically while history remains readable.

When a selected executable disappears, the durable installation and Conversation binding are retained and shown as unavailable. An offline Machine retains last-known state rather than inventing removal. A current Machine observation may confirm removal. If the same logical installation returns, CodeTether re-observes its exact revision and compatibility before use. It does not trust path reuse alone.

Installation incompatibility or absence affects only execution-dependent actions. Project and Conversation lists, historical Turn detail, Search, Rename, Pin, Archive, Restore, Inbox, and Attention continue to use durable Host state without launching a Provider probe. A failed historical Turn is never rewritten when the installation or backend later recovers.

## Phase 8A integration

Phase 8A's Discover, Adopt, and Resume separation remains authoritative. Discovery is scoped to the selected installation's effective configuration and native-session-store context. A candidate records the private installation identity/revision so adoption can revalidate the same context; adoption binds the resulting Conversation to that installation without inference.

If an update preserves execution but makes the native session format unsupported, runtime state is `limited`, previous-conversation discovery reports unavailable for that version, and fresh execution remains eligible. If native resume is unavailable for an already bound Conversation, that Conversation remains visible but cannot safely continue. CodeTether does not create a replacement native session or replay historical transcript content.

Lifecycle observation never writes Provider session stores. Existing Phase 8A native-session identity, read-only discovery, adoption idempotency, ProjectLocation matching, and Relay opacity remain unchanged.

## Persistence

Migration 016 (`provider_lifecycle`) adds a bounded current graph:

- `provider_installations` for private Machine/Provider logical installation and current revision metadata;
- `machine_provider_installation_selections` for one durable selected installation per Machine/Provider;
- `provider_installation_compatibility` for the latest revision/contract-scoped compatibility and capability observation;
- `provider_backend_observations` for the latest safe backend-mode/readiness observation without credentials;
- `conversation_provider_installation_bindings` for one immutable private installation binding per Conversation.

The migration itself performs no Provider access or process launch. Existing Conversations are not arbitrarily assigned to whatever happens to be first on `PATH`; their history and Phase 8A native bindings remain intact until exact lazy binding is possible. The schema stores no Prompt, Provider output, raw environment, credential, raw native session, or unbounded lifecycle event history.

## Protocol and ownership boundaries

Protocol v1 exposes a bounded `MachineProviderLifecycle` projection with at most one selected installation and safe current/last-known/not-observed state. Conversation Detail may expose the matching safe lifecycle summary for its private bound installation; it does not expose the binding or executable path.

The private Machine protocol adds only typed Provider lifecycle description/refresh and expected-installation fields on Provider discovery, validation, and session-open operations. It adds no generic process execution, arbitrary argument, arbitrary path, file read, or filesystem browsing command. Node remains the owner of remote Provider paths, configuration, probes, and child processes.

Direct and Relay routes carry the same Machine lifecycle operation. Direct remains preferred when usable. Relay remains transport-only and stores none of the result.

## Failure and diagnostics semantics

The lifecycle boundary maps private probe/start/backend failures into CodeTether-owned states and existing canonical diagnostics. The Web never parses Provider stdout/stderr, stack traces, `ECONNRESET`, or arbitrary Provider prose.

Failures remain scoped:

- missing/broken executable -> installation unavailable;
- missing mandatory local contract or incompatible structured output -> runtime incompatible;
- optional discovery contract absent -> runtime limited;
- backend authentication/configuration/outage -> backend readiness, not runtime incompatibility;
- Machine offline -> last-known lifecycle state with offline transport truth;
- stale expected installation/revision -> fail before Provider execution.

Historical failed Turns remain immutable after recovery. A compatible version change does not generate Attention. Current product UX presents a meaningful execution-blocking state without deleting or hiding history and without creating an unbounded lifecycle notification stream.

## User interface

Machine Detail presents compact Provider lifecycle status using product language such as **Compatible**, **Compatible — new version**, **Limited**, **Needs CodeTether update**, **Not installed**, **Backend unavailable**, **Sign-in required**, and **Check again**. Runtime and Backend are separate rows. Multiple installations can be acknowledged with one selected item and bounded alternatives without showing raw paths by default.

Refresh is keyboard accessible, uses the one lifecycle coordinator, preserves focus, and displays refreshing/current/last-known truth without blocking the page synchronously. Status is not color-only. Existing Conversation Detail remains readable when execution is unavailable and its Composer explains the current bound-installation block.

There is no **Update Provider** mutation or general installation picker in Phase 8B. The UI reports the deterministic selected installation and bounded alternatives; full installation management, backend/profile selection, and onboarding diagnosis remain later phases.

## Privacy and security

Provider credentials and backend credentials remain on the owning local Machine or Node. Lifecycle code never returns or logs API keys, auth tokens, OAuth tokens, cookies, Authorization headers, complete environment dumps, raw settings files, Prompts, Provider output, Tool output, native session IDs, or Provider history.

Private executable paths and file identities remain Machine-local/Host-private. Public and evidence-safe fields are Provider, safe version, opaque Machine-scoped installation/revision identifiers or fingerprints, selected flag, install method, compatibility/capability booleans, backend mode/readiness, sanitized origin where appropriate, timestamps, counts, timings, and canonical diagnostic codes.

Machine TLS, exact peer identities, Node-local credentials, no plaintext fallback, Relay opacity, Direct-first routing, reconnect generation rules, execution ownership, and durable `actionId` semantics are unchanged.

## Explicit boundaries

Phase 8B does not implement:

- automatic Provider update, download, install, removal, or downgrade;
- automatic alternate-installation or backend fallback;
- a latest-version registry/network lookup;
- Provider account, credential, gateway, model-profile, or quota-driven switching;
- a full Provider installation wizard, onboarding flow, or Doctor;
- Provider capability expansion, new Providers, or cross-Provider handoff;
- Mobile, Remote Terminal, Remote Files, VPN, or routing changes.

Phase 8C may build a Provider Backend/Profile Manager on top of the backend observations, while keeping installation identity separate from backend identity. Phase 8D may build a zero-config onboarding/Doctor flow that composes installation presence, selection, compatibility, backend configuration/readiness, authentication, and session-discovery support. Neither is implemented here.

## Operational limitations

- Compatibility is guaranteed only for shipped verified versions and unknown revisions that pass the current bounded adapter contract; universal historical/future compatibility is not claimed.
- Installation provenance may remain `unknown` when the filesystem does not prove a safe method.
- Backend `unknown` is normal until an authoritative check or real execution occurs; Phase 8B does not burn quota in background.
- Bedrock and Vertex mode recognition may be fixture-validated without Owner credentials; Phase 8B does not configure them.
- No automatic rebind exists when a selected installation disappears. Another installation can be reported but is not silently used.
- A future signed remote compatibility-policy service is out of scope; the current policy ships with CodeTether.
