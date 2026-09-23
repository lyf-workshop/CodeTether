# Phase 9B.1 Product Directory and Codex Compatibility

Phase 9B.1 begins user-visible account-connected Desktop work on top of the
accepted Phase 9A Account Foundation. It does not add an identity, permission,
or transport authority.

## Authenticated Host directory

The Desktop signs in through the configured Supabase project and keeps
Supabase as the only human-session authority. It enumerates only existing
CodeTether ProductDevice CNG public keys, matches one of them to the active
public ProductDevice records owned by the authenticated User, and signs the
existing Phase 9A.4 request-proof contract. It never creates a ProductDevice
from the directory flow.

`GET /v1/hosts/directory` requires both the human access JWT and that exact
ProductDevice proof. The private-schema query returns a Host only while all of
the following remain true:

- the authenticated User is active and still owns the personal Space;
- that Space currently owns the claimed, non-revoked Host;
- the exact ProductDevice is current and non-revoked; and
- the exact `supervisor_read` Host authorization is current, unexpired, and
  non-revoked.

The response contains only bounded Host label/platform/public identity and
authorization metadata. Machine state, Project paths, Conversations, Provider
sessions, source, credentials, and transcript content remain outside the
Control Plane. Directory reads do not start a Provider.

## Desktop connection boundary

The directory is an admission index, not an online-status authority. The UI
renders it first, then compares the selected row with the identity of the
Desktop-owned local Host. An exact match may open the existing `/machines`
surface, which reads live Machine and Provider state from that Host. A stale
cloud row is never called online.

Phase 9A.6 deliberately stopped before implementing ProductDevice-to-Host
Supervisor transport. The existing Phase 7/8 Direct/Relay stack is a
Controller-to-Node Machine transport; using it as a Desktop-to-Host transport
would collapse ProductDevice identity into Machine Controller trust. Therefore
Phase 9B.1 does not fabricate arbitrary remote Host entry. Non-local directory
rows remain `Unreachable` until a separately authorized Host Supervisor
transport can enforce both Control Plane admission and Host-local acceptance.

## Native Codex history

Codex already exposes stored native transcript history through opaque,
Provider-owned cursor pages. The Host and adapter preserved those cursors, but
Conversation Detail stopped after the initial page unless the user repeatedly
requested older history. The newest page could consequently look complete
while early or middle history remained unloaded.

For one explicitly selected adopted native Conversation, the Web client now
continues through every opaque earlier-page cursor. It retains the existing
cycle defense, stable Provider item identities, chronological flattening, and
deduplication, and exposes an explicit `historyComplete` state. List, directory,
and application startup reads do not hydrate transcript history or start a
Provider.

## Native Codex session persistence

New local Codex Conversations continue to use Codex's supported app-server
`thread/start` operation with `ephemeral: false`. Before CodeTether reports a
new native session as successfully created, it performs the supported
metadata-only `thread/read` and verifies the exact thread identity, persistent
state, and canonical Project root. A missing, ephemeral, mismatched, or
unreadable native thread fails closed before a successful binding is returned.

A read-only differential audit of the installed Codex 0.154.0 state found that
both official-created and CodeTether-created sessions have genuine persisted
native rollout/state records and are resumable. The official-created record
also carries an official Desktop origin and native name; the app-server-created
record uses the supported CodeTether/app-server origin and may initially lack a
native name. No supported operation in the admitted API was found for
impersonating the official Desktop origin or forcing a native name. CodeTether
does not edit the official application's private database or fabricate/copy a
native session identity. Official UI discovery therefore remains an Owner REAL
observation gate.

## Native title authority

For generated Codex titles, opening a specific local Conversation performs one
bounded metadata-only `thread/read`. If Codex exposes an exact native `name`,
CodeTether reconciles its generated fallback to that value and publishes the
ordinary Conversation update. A missing native name leaves the existing local
fallback. A native name that appears later wins on a later open/refresh.

The read neither resumes nor starts Codex. Explicit CodeTether manual titles
retain the accepted Phase 4E user-owned behavior; the native reconciliation
only replaces generated fallback titles. CodeTether does not write a title into
Codex private storage.

## Configuration

The Desktop Web build consumes only public application configuration:

- `VITE_CODETETHER_CONTROL_PLANE_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

The Control Plane allows only exact configured browser origins through
`CODETETHER_CONTROL_PLANE_ALLOWED_ORIGINS`. Development defaults admit the
Tauri production origin and the repository Vite origin. No Supabase secret key,
database credential, JWT, OTP, private key, or Provider credential belongs in
source or a REAL receipt.

## Owner REAL validation

Run the Control Plane and Desktop in two PowerShell terminals that already
contain the accepted development environment. Do not paste an OTP or token into
chat or a tracked file.

Control Plane terminal:

```powershell
pnpm --filter @codetether/control-plane build
pnpm --filter @codetether/control-plane start
```

Desktop terminal:

```powershell
$env:VITE_CODETETHER_CONTROL_PLANE_URL = 'http://127.0.0.1:4320'
$env:VITE_SUPABASE_URL = $env:SUPABASE_URL
$env:VITE_SUPABASE_PUBLISHABLE_KEY = $env:SUPABASE_PUBLISHABLE_KEY
pnpm desktop:dev
```

Then perform one bounded validation:

1. Open **My Hosts**, sign in with the existing Owner email, and enter the OTP
   only in the local Desktop.
2. Confirm the canonical authorized Host is listed and no unowned or
   unauthorized Host is shown.
3. Open the canonical Host. Confirm its exact local identity is shown online,
   the existing Machines page loads live Machine/Provider state, and merely
   listing the directory starts no Codex or Claude process.
4. Open a disposable known long adopted Codex Conversation and verify early,
   middle, and latest supported history appears in chronological order without
   duplicates.
5. In an existing disposable Codex Project, create one new Codex Conversation,
   send one harmless prompt, record only safe CodeTether identifiers, and quit
   and restart CodeTether. Confirm the same Conversation resumes.
6. Refresh or restart the official Codex Desktop normally. Observe whether that
   exact native session appears and whether CodeTether converges to its native
   title. Do not edit official Codex storage if it does not appear.

The final official-discovery result is not accepted until that last Owner
observation is recorded.

## Schema

No Control Plane or Host migration is required. Phase 9B.1 reuses migrations
018 (native transcript boundary) and 0005 (Host device authorization) without
modifying historical migration files.
