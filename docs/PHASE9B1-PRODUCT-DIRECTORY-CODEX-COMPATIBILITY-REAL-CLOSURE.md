# Phase 9B.1 Product Directory and Codex Compatibility REAL Closure

## Status and lineage

Phase 9B.1 completed its automated REAL validation and final Owner GUI
observation on `phase9/product-directory`.

- Account Foundation baseline:
  `59debcaea31e3cdc65c557c85eaec325c04892dd`
- Phase 9B.1 validation and history-fix HEAD:
  `e1fca712b8f8700a68660f9aa5d043834b88dc15`
- Accepted status: `PHASE9B1_PRODUCT_DIRECTORY_AND_CODEX_COMPAT_REAL_PASS`

## Host directory REAL

The Owner verified that the Desktop loaded its account configuration,
authenticated successfully, rendered **My Hosts**, and showed the canonical
Host `host_4298c810e45c41a6a522aacdbb3f570b` as online with a verified identity
and an available Open action.

The directory remains a Control Plane admission index. Live Machine and
Provider state came from Host authority rather than the Control Plane, and an
arbitrary cloud directory row cannot substitute for the exact local Host
identity.

## Machine and Provider REAL

The Host-authoritative read returned:

| Machine       | Platform    | Codex              | Claude Code        |
| ------------- | ----------- | ------------------ | ------------------ |
| Local Machine | Windows x64 | 0.154.0, available | 2.1.251, available |
| Remote Node   | Linux ARM64 | unavailable        | unavailable        |
| Remote Node   | macOS ARM64 | 0.153.4, available | 2.1.268, available |

Directory and Machine reads created zero new Codex processes and zero new
Claude Code processes. Provider discovery therefore retained the cold-read
boundary.

## Complete native history

The user-visible history defect was that the Desktop could stop at the latest
native page and present partial history as complete. Phase 9B.1 now follows
every opaque previous cursor to the true beginning while preserving early,
middle, and latest entries, stable chronological order, stable identities,
deduplication, and ordered live continuation. Partial or malformed terminal
native pages remain explicitly incomplete.

The deterministic regression covered 130 Turns and 260 supported entries. All
260 identities were unique, the exact count and ordering passed, no cursor
range was skipped, and `historyComplete` became true only at the genuine
beginning. Commit `e1fca712b8f8700a68660f9aa5d043834b88dc15`
(`fix(conversations): keep partial native history incomplete`) closed the final
validation defect. No schema migration was required.

## Native Codex session compatibility

The disposable CodeTether Conversation
`conv_e5ecadae4c974e89ba106f1c85fd39cc` used a genuine Codex-created native
session with fingerprint
`sha256:eC2TeTP7pd8DDdGKlcHRDywrmukrzpdP4JeWA9cKmCk` and native ID suffix
`de934d26ee87`.

REAL evidence established that:

- Codex created the native identity; CodeTether neither fabricated nor cloned
  it;
- the first real Turn persisted rollout and state records;
- supported `thread/read` and `thread/list` found the exact session;
- the canonical Project working directory matched;
- CodeTether stored the exact native binding;
- restart preserved the Conversation, binding, and first-Turn history; and
- native resume continued through the same session.

For Codex 0.154.0, an unused newly created thread is not guaranteed to survive
a restart before its first real user Turn persists native state. This is an
observed upstream lifecycle boundary, not a CodeTether-only Conversation
model; CodeTether continues to report native persistence truthfully.

## Official discovery and Owner GUI observation

Supported native listing contained the exact CodeTether-created session. The
Owner then restarted the official ChatGPT/Codex Desktop and observed that the
same Conversation appeared in its Conversation list. This closes both
supported native discovery and official GUI visibility as REAL PASS.

The official Desktop did not add the externally created session to an already
running list immediately. The accepted compatibility limitation is:

`official_desktop_external_session_refresh_requires_restart`

After the normal restart lifecycle, discovery succeeds. This limitation does
not block native persistence, native resume, CodeTether operation, official
discovery, or title compatibility. CodeTether does not patch official private
databases, rewrite originator metadata, inject index records, copy session
metadata, or impersonate an official client to force an immediate refresh.

## Title compatibility

Codex-native title metadata remains authoritative when available. A generated
local fallback is used only while native naming metadata is absent; a later
native title replaces that generated fallback, and adopted Conversations can
recover their native title. Explicit manual CodeTether titles retain their
accepted manual semantics. CodeTether never writes unsupported title metadata
into official Codex storage.

For the disposable REAL Conversation, the Owner observed the same title in
official Codex and CodeTether.

## Evidence and final classification

Privacy-safe automated receipt:

`apps/host/.tmp/phase9b1-real-validation/evidence/phase9b1-automated-real-2026-09-23T172912151Z.json`

SHA-256:

`1bc2f847e462c403221ddd88cbd738a73fbf0b0a70c6de737b82c29ac9a35820`

Final classification:

- Host Directory: PASS
- Machine Read: PASS
- Provider Cold Read: PASS
- History Completeness: PASS
- Native Session Persistence: PASS
- Restart Persistence: PASS
- Native Resume: PASS
- Native Title: PASS
- Official Native Discovery: PASS
- Official Codex GUI Visibility: PASS

The evidence contains no OTP, JWT, refresh token, Supabase key, private key,
raw signature, Provider credential, or transcript body.

## Closure gates

The closure-only repository gates passed:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- changed-file Prettier
- `git diff --check`

No tracked Rust source changed, so Rust gates were not required. No OTP,
ProductDevice enrollment, Host claim, Host authorization, destructive Codex
session creation, or official GUI REAL flow was repeated for closure.

## Remaining product gap

Local Host entry is validated. The remaining major product gap is an
authorized remote ProductDevice-to-Host Supervisor transport for arbitrary
non-local Hosts, followed later by deliberate remote Project and Conversation
access. Phase 9B.1 does not implement that transport, Phase 9B.2, or Mobile.
