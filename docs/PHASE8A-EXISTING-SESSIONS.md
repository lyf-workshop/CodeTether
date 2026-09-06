# Phase 8A — Existing Session Discovery & Adoption

## Scope and invariant

Phase 8A adds one narrow bridge from Provider-owned native history into the existing CodeTether Conversation model. It does not add an imported runtime, a transcript-replay system, a Provider lifecycle manager, or a remote filesystem API.

The product invariant is:

```text
Discover != Adopt != Resume
```

- **Discover** reads bounded native metadata on the Machine that owns the Provider store. It creates no CodeTether Conversation or Turn, performs no inference, and does not modify Provider storage.
- **Adopt** revalidates one short-lived candidate and atomically creates or resolves one ordinary durable CodeTether Conversation with the existing private native-session binding. It still performs no inference and writes nothing to Provider storage.
- **Resume** happens only when the user later sends an explicit Turn. The existing runtime resumes the bound Provider-native session. CodeTether never replays historical transcript messages to reconstruct context.

## Data flow

Local discovery stays inside the Desktop-owned Host process:

```text
Web -> Host -> exact ProjectLocation -> ProviderSessionDiscovery
                                      -> Provider-owned metadata surface
```

Remote discovery uses the accepted Machine path:

```text
Web
  -> Host
  -> exact ProjectLocation
  -> Machine Transport (Direct first, otherwise Relay)
  -> Node
  -> ProviderSessionDiscovery
  -> native Provider store/API
  -> sanitized private Machine metadata
  -> Host-owned opaque candidates
  -> Web
```

The public Relay carries only nested Machine TLS records. It does not parse Provider, title, path, candidate, or native-session data and persists none of it.

Adoption and later continuation are separate:

```text
opaque candidate
  -> Host-private candidate lookup
  -> exact Machine/Provider/ProjectLocation revalidation
  -> atomic Conversation + private native-session binding

new explicit Turn
  -> existing Conversation
  -> existing private native-session binding
  -> existing Provider-native resume
```

## Provider discovery boundary

`ProviderSessionDiscovery` is a Provider-facing, application-private interface. Codex and Claude implementations return only a guarded `NativeProviderSessionCandidate` containing private native identity/revision/path plus bounded presentation metadata. Those private fields never cross Protocol v1.

Discovery readiness and native-resume readiness are independent. Each scan reports its discovery status and a separate resume capability; each candidate also carries its own resumability. A locally readable store can therefore remain discoverable while an inference backend is offline, and a session written by an unsupported format can be shown without being falsely offered for continuation.

### Codex

The Codex adapter uses the installed Codex app-server's official metadata-only `thread/list` operation with `useStateDbOnly: true`, all supported interactive/CLI source kinds (including sessions created by `codex exec`), and the exact canonical working directory. Adoption revalidation uses metadata-only `thread/read` without turns. The adapter never invokes `thread/start`, `thread/resume`, or `turn/start` during discovery/adoption. It launches only a bounded purpose-scoped metadata child and awaits exact shutdown.

The state-database-only query is intentionally conservative. Legacy native sessions absent from the current Codex state database may not be discoverable; broader storage/version compatibility belongs to Phase 8B.

### Claude Code

The Claude adapter reads only immediate UUID `.jsonl` session files below the configured `CLAUDE_CONFIG_DIR/projects` location (or the normal user-local default). It does not recurse through the home directory, read settings or credentials, start Claude, or contact the inference backend. JSONL is streamed under per-line, per-file, aggregate-byte, file-count, directory-count, and entry-count bounds. Transcript content is discarded after extracting guarded metadata.

Current known writer versions (`2.1.250`, `2.1.251`, and `2.1.263`) are checked conservatively. Missing optional fields and unknown optional fields are tolerated; inconsistent identity/path evidence, truncation, oversized data, symlinks, or unknown required writer provenance cannot be claimed resumable. The Owner-configured Claude backend and exact executable remain unchanged. Local metadata discovery does not require backend availability; an actual later resume does.

Multiple installations remain a future Phase 8B product surface, but remote execution has one narrow correctness rule now: the Node snapshots its Provider environment and pins the first successfully resolved canonical Claude launcher for that Node lifecycle. Version/authentication observation and later new-session/native-resume execution use that same private launcher; they never independently re-resolve `PATH` or fall through to another installation after a Turn begins. A failed pre-selection resolution is not cached, so the existing bounded refresh can recover after installation repair. Store discovery remains executable-independent but uses the same lifecycle configuration environment, keeping `HOME`/`CLAUDE_CONFIG_DIR` selection consistent without starting Claude.

## Project and Machine authority

The request names only a CodeTether `projectId`, `machineId`, Provider, bounded page size, and opaque cursor. Host resolves the already registered Project Location. Web cannot supply an arbitrary Provider-store path.

Every Provider-recorded working directory is canonicalized on its owning Machine and must equal that exact Project Location under the already accepted platform rules. Display name, folder basename, Git repository identity, remote URL, IP address, and a path string on another Machine are never adoption authority. Windows and Linux/WSL paths are not silently translated into each other.

## Public candidate privacy

Web receives a random, short-lived `candidate_*` identifier scoped to the exact Project and Machine. It may also receive Provider, Machine, bounded title/timestamps, candidate resumability, historical-transcript availability, and already-adopted state. It never receives:

- raw native session identity or revision;
- Provider-store or Project path;
- Prompt, response, Tool content, or transcript;
- Provider credentials, executable path, or backend secret.

The Host registry is memory-only, expires snapshots after five minutes, has no cleanup timer, and bounds snapshots, candidates, cursors, and page size. Adoption always re-reads the exact native metadata; a removed, changed, expired, wrong-Project, wrong-Machine, or wrong-Provider candidate fails without creating a Conversation.

## Bounds and cancellation

- Public pages default to 50 and accept at most 100 rows.
- A Host scan retains at most 1,000 native candidates and 100 Provider pages under one 60-second aggregate deadline.
- Private Machine pages carry at most eight worst-case candidates within the frozen 16 KiB Machine frame bound. Remote aggregation has a 60-second total deadline and 128-page ceiling.
- Claude scans inspect at most 4,096 project buckets, 5,000 session files, 20,000 store entries, 16 MiB per session file, 2 MiB per JSONL line, and 256 MiB total by default.
- Identical Host and Claude scans coalesce. Each caller owns only its wait; cancelling one observer does not cancel another. The underlying scan aborts when its final waiter leaves, and a new request waits for exact cleanup before starting one fresh worker.
- The Host admits at most four distinct Provider-session scans process-wide by default. Saturation returns bounded discovery-unavailable truth instead of starting another worker or a Provider inference runtime; identical scan keys continue to share their one admitted worker.
- Host/Node shutdown and Machine connection teardown abort the exact owned scan and await bounded child/file cleanup.

Metrics contain only Provider, counts, elapsed time, truncation, and canonical failure reasons. They contain no path, title, native identity, or transcript content.

## Persistence and idempotency

Migration 015 adds only:

- Conversation origin (`codetether` or `adopted_native`);
- private Provider-session materialization truth;
- a partial unique constraint for `(machine_id, provider, provider_thread_id)` when a native binding exists.

Existing Conversations backfill as CodeTether-created without contacting a Provider. Adoption uses an immediate SQLite transaction, so sequential, concurrent, multi-observer, and post-restart attempts converge on one Conversation. A binding already attached to a different Project/Location fails closed.

Adopted Conversations retain the discovered Provider title until an explicit CodeTether Rename. Rename, Pin, Archive, Restore, Search, and cold detail reads affect only normal CodeTether product state; they never rename, remove, or edit Provider-native history.

## Failure behavior

Discovery isolates malformed entries and Provider-specific failures where possible. Canonical public outcomes include unavailable discovery, unsupported format, unreadable store, offline Machine, and expired/changed candidate. Raw parser, filesystem, Provider, or native-identity detail remains private.

If an adopted native session later disappears, its CodeTether Conversation and history remain readable. A later explicit resume fails canonically; CodeTether neither creates a replacement native session under the same Conversation nor replays a transcript.

Cancelling request-scoped discovery is administrative. It does not mark an independently executing remote Turn lost, change Machine trust, or manufacture a Machine outage.

## Historical transcript scope

Phase 8A does not import historical transcripts. `historicalTranscript` is reported as unavailable for the supported adapters. Only the normal CodeTether title and future CodeTether Turns participate in Search. This avoids guessed Tool fidelity, fabricated events, and accidental replay.

## UI

After a successful existing Project/Location registration, the optional **Previous conversations** step scans the exact Machine, groups compact rows by Provider, supports individual and visible-page selection, reports partial/zero/offline/unsupported/expired states, and offers **Skip**. Import results are isolated per item. Already-adopted sessions open their one existing Conversation.

Opening or refreshing the UI never adopts, resumes, or starts inference. Focus, keyboard selection, live loading status, and bounded scrolling remain accessible at supported Desktop sizes.

## Security and Phase 7 preservation

Direct-first/Relay-fallback selection applies independently to each remote discovery/adoption revalidation operation. Machine TLS, exact end-peer identity, Relay opacity, execution ownership, durable Turn `actionId`, no active-Turn migration, no Prompt replay, bounded queues, and frozen Claude capabilities remain unchanged.

## Future boundaries

- Phase 8B may broaden Provider-format/version compatibility and lifecycle reporting, including explicit discovered-installation identity, compatibility, health, and default selection for Machines with more than one installation.
- Phase 8C may model Provider backend/profile readiness. Discovery identity remains Machine + Provider + native session, not backend profile.
- Phase 8D may broaden onboarding/Doctor workflows.
- Mobile, Remote Terminal, Remote Files, full transcript conversion, unmatched-session browsing, and new Providers remain outside Phase 8A.
