# Phase 8C — Zero-Config Onboarding & Doctor

## Status and foundation

Phase 8C is the current approved implementation scope. It is not accepted, frozen, or declared ready.

It builds only on accepted behavior:

- Phase 8A Existing Session Discovery & Adoption, frozen at `5d2f67c0d007b416d6bcd143fcdca9905fffd915`;
- Phase 8B Provider Lifecycle & Compatibility, frozen at `89808b2f2ffaddf2ab26552671176a3e5487483d`;
- the accepted Phase 7 Direct/Relay trust, transport, security, and roaming foundation; and
- the existing durable Project, ProjectLocation, Machine, Conversation, Turn, Attention, Search, and Desktop lifecycle authorities.

This document records the implemented Phase 8C architecture and its validation obligations. It does not claim Owner acceptance or frozen status; review readiness still depends on the complete final deterministic and REAL installed evidence.

## Product boundary

Phase 8C turns existing technical capabilities into a concise setup and recovery experience. Zero-config means that ordinary users do not need to understand CodeTether's internal topology. It does not mean that CodeTether guesses state, bypasses Provider authentication, weakens Machine trust, mutates Provider installations, or retries work automatically.

Ordinary concepts are:

- This computer and another computer;
- Codex and Claude Code;
- AI service;
- Project and previous conversations;
- Connected, Ready, Limited, Needs attention, and Check again.

Advanced details may expose bounded safe facts such as Provider version and provenance, compatibility state, backend mode, observation time, Direct or Relay transport, Machine fingerprint, and canonical diagnostic code. They do not expose credentials, native-session identity, raw Provider errors, or Relay secrets.

## Authority and composition

Onboarding and Doctor are projections over existing authorities:

```text
Desktop / Host lifecycle
  + Machine trust and connectivity
  + selected ProviderInstallation and compatibility
  + runtime readiness
  + effective backend mode and readiness
  + Project / exact ProjectLocation
  + Phase 8A session-discovery capability
  -> onboarding presentation and Doctor component states
```

Neither surface owns a second Provider scanner, transport state machine, path canonicalizer, Project registry, pairing protocol, backend model, or execution-eligibility calculation. The Host remains durable product authority, Node observes remote Machine facts, and Relay remains transport-only.

SQLite migration 017 (`onboarding_progress`) stores one compare-and-set guarded singleton containing only user-flow progress. It does not copy current Provider, Machine, Project, backend, or connectivity truth into a competing table. The durable record retains:

- the last logically completed onboarding step;
- whether onboarding was completed;
- explicit optional skips; and
- the optional selected Project/Machine context needed to resume the flow.

Every mutation carries an `actionId` and expected revision. Equivalent repeated transitions converge, conflicting windows must refresh durable truth, and the migration initializes an existing Phase 8B user directly into completed setup without launching a Provider or changing any existing entity.

Database migration itself starts no Provider, performs no backend inference, and changes no trust or credential state.

## Onboarding state machine

The durable logical progression is:

```text
welcome
  -> computer_check
  -> provider_check
  -> project_setup
  -> previous_conversations
  -> remote_setup
  -> ready
```

Steps represent flow progress, not authority. On entry or resume, the UI re-reads current product facts while retaining the last valid user-visible step; it does not skip forward or manufacture readiness from saved progress. If the selected ProjectLocation is deleted while setup is paused, the database foreign key clears only that context, later completion transitions fail closed, and an explicit `project_reselect` action returns the flow to Project setup without deleting product data.

Local-only setup never requires remote setup or Relay. Remote setup and previous-conversation import are explicitly skippable. Codex and Claude Code are individually optional. At least one truthful usable execution path is sufficient to complete an Agent-ready local flow; with no ready Provider, application setup may complete but the UI must say that no AI coding tool is ready.

Existing users are detected from durable product state. An upgrade from Phase 8B must not force a destructive Welcome flow when valid Machines, Projects, or Conversations already exist. It may show a concise readiness summary or only the missing setup step. Normal CodeTether or Provider updates do not reset completion.

## Provider detection and guidance

Provider cards consume Phase 8B lifecycle projections for the exact selected installation CodeTether would execute. They never select a newly found alternate or fall back to the first executable on `PATH`. Multiple installations remain visible as a simple count in ordinary UI, with safe selected-installation metadata under Details.

Compatibility maps to ordinary language without changing semantics:

| Phase 8B state          | Ordinary presentation                                |
| ----------------------- | ---------------------------------------------------- |
| `verified`              | Ready                                                |
| `compatible_unverified` | Compatible — new version                             |
| `limited`               | Limited, with the unavailable optional feature named |
| `incompatible`          | Needs CodeTether update                              |
| `unavailable`           | Not available                                        |

A missing Provider is a normal actionable state. Phase 8C provides Provider-specific official installation guidance and an explicit re-check action. It does not install in the background, modify a package manager, update or downgrade an existing installation, silently elevate privileges, or claim that a newer release exists without authoritative evidence.

Provider checks remain bounded and coalesced by Phase 8B. Opening setup does not run model inference. Progress resolves asynchronously after the shell is visible.

## Runtime and backend readiness

Runtime compatibility and AI-service backend readiness remain separate rows and separate facts:

```text
Claude Code
  Runtime: Compatible
  AI service: Custom gateway — Unavailable
```

This state does not mean Claude Code is incompatible. Conversely, a reachable backend cannot make an incompatible executable eligible for execution. `Ready` requires the accepted execution-eligibility inputs rather than executable presence alone, and unknown backend readiness is shown as Not checked yet or equivalent.

Authentication guidance follows the effective backend mode:

- first-party mode may use authoritative Provider-native auth status and offer Sign in;
- a custom Anthropic-compatible gateway is shown as Custom gateway and is not forced through first-party Anthropic login;
- Bedrock and Vertex may be identified when Phase 8B observes them, but Phase 8C does not configure either mode; and
- a custom-gateway credential or configuration failure receives gateway-specific guidance, never the credential value.

If a user explicitly requests a backend connection check and authoritative readiness requires inference, the check is minimal, bounded, contains no Project source or prior Prompt, grants no Tool access beyond a proven requirement, creates no Conversation or Turn, and cleans its exact child process. No such inference runs continuously or merely because setup or Doctor opened.

## Project setup

The ordinary action is Choose a project folder. Local Desktop uses the accepted narrow native directory picker; Browser mode uses its existing manual path boundary. Host canonicalization, real-path authorization, duplicate matching, and availability remain final truth. Selecting an already known canonical location reuses its Project rather than creating a duplicate.

Remote Project setup uses a narrow typed `POST /api/v1/machines/:machineId/projects` operation for the remote-only first Project case and the existing purpose-specific ProjectLocation registration operation for an existing logical Project. Both require active pinned trust, a currently online Machine, and Node-owned exact path validation; the Host stores only the Node-canonicalized Location. Repeated canonical paths reuse the same logical Project. Phase 8C adds no remote directory listing, arbitrary read, generic filesystem browser, or onboarding-specific path equality. Git may enrich display where an accepted safe fact exists, but it is never a requirement.

An unavailable known location remains visible with targeted guidance such as “Project folder is unavailable on this computer.” Updating or choosing a location must use the accepted safe Project/Location semantics; onboarding never deletes files or silently moves Conversations.

## Previous conversations

After an exact ProjectLocation exists, setup may invoke Phase 8A discovery for supported Providers. The step is optional and treats no results, partial Provider failure, unsupported discovery, offline Machine, and Skip as normal outcomes.

The frozen distinction remains explicit:

```text
Discover metadata
  != adopt selected native session
  != resume Provider session on a later explicit Turn
```

CodeTether does not auto-import. Adoption occurs only after explicit user selection, is idempotent, creates no Turn, performs no inference, claims no Provider execution ownership, mutates no native Provider store, and never replays a transcript. Already adopted candidates are labelled as already in CodeTether and cannot be duplicated.

## Ready state

Ready summarizes only the facts necessary to begin:

- the selected computer is connected or local;
- at least one intended Provider execution path is truthfully usable;
- an exact ProjectLocation is valid; and
- optional limitations are named without turning them into core failure.

Onboarding completion requires no test Prompt. It persists only flow completion and does not suppress future real lifecycle or connectivity changes. Setup remains safely reopenable from Settings without resetting Projects, Conversations, Provider authentication, Machine trust, selected installations, native bindings, or Relay enrollment.

On entry to Ready, CodeTether revalidates the exact ProjectLocation and reads
current authoritative Provider facts without automatically repeating installation
detection. Installed remote validation showed that the redundant metadata scan
demoted newly successful backend observations to last-known, as Phase 8B correctly
requires for a metadata-only check. The Ready transition now preserves that frozen
freshness rule by avoiding the redundant scan, not by treating stale health as
current. Explicit Check Again and remote Project selection still refresh Providers;
unknown or last-known backend readiness still cannot become Ready by itself.

## Add another computer

The guided remote flow uses product language:

```text
Add another computer
  -> install or run CodeTether on that computer
  -> enter the one-time setup information
  -> confirm the intended computer
  -> connected
  -> check Codex / Claude Code
  -> register an exact remote Project
```

This is a wrapper around the accepted Controller-to-Node pairing protocol, not a new trust mechanism. The short code remains one-time, expiring, attempt-limited, and scoped to one pairing. It is never a reusable Machine credential. The user confirms safe computer name/platform metadata before durable pinned trust is committed; an identity mismatch fails closed and has no one-click bypass.

Phase 8C does not require a public Node port, port forwarding, SSH, manual TLS configuration, or manual Relay protocol configuration. Controller and Node retain their outbound Relay connections, inner Machine TLS, exact pins, reciprocal authorization, and bounded rendezvous behavior. Ordinary UI says Internet access; Advanced Details may say Direct or Relay. Relay presence alone never becomes Provider or execution readiness.

Transient sleep, Wi-Fi change, Relay outage, or Direct address change does not recommend Pair again. Network location remains ephemeral while Machine identity and trust remain durable. Interrupted setup preserves only valid committed progress and retries idempotently; it never creates a second trust relationship for the same accepted operation.

The optional setup step includes collapsed, current-scope guidance for obtaining the matching Linux x64 CodeTether remote-helper artifact from the controlled test/deployment provider and using its fixed pairing startup options. The Desktop installer does not claim to bundle or copy that artifact. The guidance explicitly rejects public port forwarding. Phase 8C does not create the cross-platform distribution, signing, or installer matrix assigned to Phase 8D.

## Doctor architecture

Doctor answers “What is preventing me from using CodeTether right now?” It remains available after onboarding from a stable Setup/Doctor or Help/Diagnostics entry point.

Doctor components use a small presentation vocabulary such as:

- `ready`;
- `needs_attention`;
- `limited`;
- `unavailable`;
- `offline`; and
- `unknown`.

Recommended sections are This computer, AI tools, Current project, Remote access, Previous conversations, and Advanced details. Component facts include:

- Desktop/Host, current lifecycle, and local durable-state availability;
- exact selected Provider installation, version, compatibility, runtime, backend, auth need, and observation freshness;
- Project, exact Location, Machine, and safe current accessibility;
- remote trust, current connectivity, Direct/Relay route, Node reachability, and remote Provider observation; and
- native-session discovery support, which remains optional for fresh execution.

Overall Ready means at least one intended execution path for the selected context is usable and no core product requirement blocks it. Codex Ready with Claude unavailable may still be overall Ready. Remote readiness is summarized independently when remote use is configured. Relay presence, a Provider executable, onboarding completion, or a last-known observation is never sufficient by itself.

Offline and stale facts are explicit, for example “Last known: Ready; checked two hours ago; computer offline.” An ordinary read does not contact a remote Project filesystem, so an online remote Location remains unknown until explicit Check again validates its already-registered exact root. A failed or partial current refresh is announced, does not fabricate removal, destroy last-known data, or poison another Machine or Provider.

## Check again and repair

Opening Doctor starts no inference and no continuous polling. `Check again` uses existing bounded/coalesced Provider/connectivity refresh plus purpose-specific exact ProjectLocation validation, with fixed Machine and validation fanout. Remote lifecycle discovery has one Node-owned 85-second work budget and a 110-second authenticated response ceiling, reserving the full three-wait exact-child cleanup bound plus delivery slack. A verified lifecycle timeout retains private probe classification but maps onto Protocol v1's existing retryable `provider_start_failed` code/reason with contextual check-again copy; cleanup uncertainty retains the stronger canonical `execution_ownership_uncertain` failure behind that admitted Provider-operation wire code, while a silent transport timeout remains a Machine connectivity failure. Purpose-specific session open composes that complete lifecycle envelope with its existing 90-second Provider handshake budget. Codex and Claude checks may run concurrently where safe, and one Provider failure remains isolated where a bounded partial observation is possible. Phase 8C deliberately adds no separate inference-based backend-test button; current backend truth remains the Phase 8B observation established by its authoritative lifecycle or real explicit execution boundary.

Repair actions are narrow and explicit:

- Check again;
- Choose project;
- View official Provider installation instructions;
- Sign in when the effective first-party backend requires it;
- start or reconnect CodeTether on the other computer; or
- open the existing secure setup/settings surface.

There is no Repair everything action. Doctor never installs, downgrades, switches, or rewrites a Provider/backend; exposes or rewrites credentials; unpairs/re-pairs automatically; removes a ProjectLocation; queues a Prompt; changes a historical Turn; or retries/replays failed work. Security-sensitive changes require deliberate confirmation.

Doctor consumes Phase 6D and Phase 8B canonical diagnostics. Web does not parse stderr, stack traces, transport exceptions, or arbitrary Provider prose. Where hydrated Direct admission pressure previously surfaced legacy `machine_pairing_rate_limited` wording, Phase 8C may map an already-known transport/admission reason to “Computer temporarily busy” or equivalent; it must not change the frozen transport behavior or misrepresent a true pairing limit.

## Public projection and privacy

Any public onboarding/Doctor DTO is bounded to the fields required for cards and actions. It does not serialize whole internal Machine or Provider records.

Never expose, persist in new setup state, log, send through Relay persistence, or include in evidence:

- Provider API keys, auth/OAuth tokens, cookies, or Authorization headers;
- raw secret environment values or credential-bearing URLs;
- Relay enrollment/setup secrets or Machine private keys;
- raw native Provider session IDs;
- raw Provider output, stderr, stack traces, or history; or
- Owner Prompts, Agent/Tool output, Project source, or sensitive Owner paths.

Safe public metadata includes controlled Provider labels and versions, compatibility and readiness enums, credential-present booleans, backend mode, sanitized origin under Advanced Details where already allowed, counts, freshness/timestamps, transport labels, provenance, and canonical CodeTether-owned reasons.

Relay persistence remains infrastructure-only and receives no onboarding progress, Project name, Provider UI state, session metadata, or credential. Synthetic secret-sentinel tests must audit Host SQLite, Relay SQLite, public DTOs, SSE, logs, and final evidence.

## Offline, restart, and idempotency

The installed Desktop opens without Internet. Local history, Search, organization, and Machine-local metadata remain available. Relay unavailability is not a local first-launch requirement, and a compatible local Provider may remain usable when the optional remote path is down.

Closing or restarting during onboarding resumes from a valid logical state. Restart after completion opens the ordinary product rather than Welcome and leaves Doctor available. Tray close, explicit Quit, Single Instance, Windows session lifecycle, notifications, and Host/Provider cleanup retain their frozen semantics.

Repeated Continue, Skip, Refresh, Import, Pair, and Project actions must be idempotent or guarded by their existing action identities. Duplicate clicks, browser refresh, reconnect, or multiple controllers cannot create duplicate Machines, trust records, ProjectLocations, Conversations, adoptions, or workers. Doctor refresh inherits Phase 8B coalescing and bounded process/output ownership; no orphan onboarding, Doctor, discovery, backend-check, or Provider process may remain.

## Accessibility and responsiveness

The Desktop shell renders before long-running checks resolve. Provider and connectivity checks update progressively with accessible loading/busy semantics. Status text remains authoritative rather than color or icon alone. Primary setup, Skip, adoption, pairing confirmation, Details, Doctor refresh, and repair actions are keyboard accessible; step changes move focus sensibly and dialogs remain escapable where appropriate.

Required validation includes 1440×900, 1100×700, and a smaller supported Desktop window without clipped critical actions. The established premium dark navy/black visual system remains authoritative; Phase 8C is not a redesign.

Performance evidence must distinguish REAL installed timings from deterministic fixture timings for first render, Provider detection/lifecycle refresh, Project validation, previous-session discovery, Doctor render, and Doctor refresh. No synchronous check blocks initial rendering, and no continuous polling or quota-consuming health loop is introduced.

## User journeys

### A. New local user

```text
Install and open CodeTether
  -> concise Welcome
  -> check this computer and exact selected Providers
  -> show runtime and AI-service truth separately
  -> choose an existing project folder
  -> optionally discover and explicitly adopt previous conversations
  -> skip remote setup if unwanted
  -> Ready without a test Prompt
```

This journey requires no terminal interaction when a supported Provider is already installed/configured and a local folder can be selected.

### B. Existing CodeTether user

```text
Upgrade from frozen Phase 8B state
  -> existing durable state detected
  -> no destructive Welcome reset
  -> open the ordinary product or only the missing setup step
  -> Doctor remains available
```

Projects, Locations, Machines, Conversations, Turns, native bindings, selected installations, Provider/backend configuration, Machine trust, and Relay enrollment remain unchanged.

### C. Remote user

```text
Choose Add another computer
  -> follow current supported CodeTether-on-that-computer guidance
  -> use the one-time setup flow
  -> explicitly confirm the intended Machine
  -> establish existing pinned trust
  -> observe remote Providers through Phase 8B
  -> register an exact remote ProjectLocation
  -> Ready through Direct or authorized Relay connectivity
```

The user does not configure a public Node port, TLS certificate, or Relay protocol. Presence alone is not shown as execution readiness.

### D. Broken Provider or backend

```text
Open Doctor
  -> see whether installation/runtime or AI service is blocking work
  -> retain access to history and organization
  -> take one targeted action outside or inside CodeTether as appropriate
  -> Check again
  -> regain eligibility only from current authoritative facts
```

A custom-gateway outage does not recommend reinstalling Claude or signing in to first-party Anthropic. Recovery never mutates the old failed Turn or automatically resends its Prompt.

## Validation boundary

Closure validation reproduced a remote-only readiness interaction: Doctor's
ProjectLocation check reused execution admission validation, which restarted
metadata discovery and correctly demoted a just-observed backend success under
Phase 8B. Doctor now requests only the existing exact-folder validation on a
bounded, independently pinned Machine connection, leaving the current heartbeat
and Provider observation generation intact. Canonical ProjectLocation checks,
Machine trust, transport bounds, execution authorization, and explicit lifecycle
refresh semantics are unchanged. No Provider work is started and no last-known
backend state is promoted to current.

Installed validation found that the legacy local Codex execution App Server was
started eagerly while assembling lifecycle metadata. Phase 8C defers that exact
execution runtime until an admitted native conversation create/resume needs it.
The existing bounded Phase 8B probes still establish compatibility; metadata reads,
setup, Doctor, and metadata refresh leave no execution child. Concurrent first
admissions share one initialization, shutdown owns any opening child, and a failed
initialization stays closed without retry or replay. The executable, environment,
installation/revision binding, execution profile, and remote runtimes are unchanged.

Phase 8C is ready for Owner review only after the specification's complete deterministic and REAL matrix is observed. In particular, mandatory evidence includes a clean installed Windows NSIS first-run and returning-user flow, current exact Codex and Claude rendering, current custom-gateway runtime/backend separation, isolated Project and Phase 8A discovery/adoption without inference, offline startup, guided isolated remote pairing/Provider/Project setup, truthful Relay-only readiness, Direct/Relay execution regressions, adopted-session native resume, accessibility, stress/coalescing, secret sentinels, package gates, cleanup, Owner-state preservation, production-Relay preservation, and a clean tracked worktree.

Fixture results must be classified as AUTOMATED or SIMULATED, never REAL. Mandatory observations that cannot be made remain NOT OBSERVED and require a `NOT READY` assessment. Final evidence belongs under `output/playwright/phase8c/final-evidence/` and must not reuse or modify the frozen Phase 8B evidence.

## Boundaries after Phase 8C

Phase 8D is Cross-Platform Distribution. It owns the wider Windows release gaps, macOS Desktop/Node, Linux Node/Desktop distribution, platform credential storage, tray/background and sleep/wake differences, path semantics, installers/packages, signing, notarization, and update delivery. Phase 8C may keep setup architecture portable but does not implement those deliverables.

Advanced Provider Management remains deferred beyond Phase 8C. It owns multiple backend/gateway/account profiles, ccswitch-like switching, credential/profile management, model profiles, quota-driven switching, and automatic backend/account failover.

Also out of scope are Mobile/Phase 9, a CodeTether cloud account system, team/organization administration, self-hosted Relay wizard, generic remote Terminal/Files, new Providers, and capability expansion. Phase 8C stops after onboarding and Doctor implementation and validation.
