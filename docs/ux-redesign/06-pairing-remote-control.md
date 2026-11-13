# 06 · Pairing and Remote Control (B1)

Date — 2026-11-03. References are 03 §1.1 (simplified multi-device support) and B1 in §4, A3–A6 in 04, and the code at `main` `d3be8ed`.

## 1. What Users See

### On the Computer

- **Devices page `/devices`**
  - Keep the existing computer sections at the top, with each computer's projects.
  - Add a “Phones and tablets” section at the bottom, listing paired phones and tablets with name, operating system, last use, and “Remove.”
  - Place “Add device” at the top right.
- **Add Device `/add`**
  - **Add phone or tablet** opens a six-digit pairing code and countdown, with the instruction “Sign in to the same account in CodeTether on your phone and enter this code.” After successful entry, the dialog shows “Added · vivo X60” and a “Done” button.
  - **Add another computer** continues using the current CodeTether Node pairing flow until E1, then switches to the same pairing-code flow.
- **Remove** uses the confirmation “Removing vivo X60 disconnects it immediately. Pair again to use it later. Work running on the computer is unaffected.”
- Settings › Account retains only account information and sign-out. Move its current read-only “Phones and tablets allowed to access this computer” list to Devices.

### On the New Device (Mobile UI Arrives in M1, with a Development Diagnostic Page Simulating It in B1)

Sign in to the same account → Enter the pairing code → See “Connected to Windows desktop.” The user does not choose a computer first because the code already identifies it.

### Pairing Code Rules

- Six digits, valid for five minutes, single use. Closing the dialog or clicking “Cancel” invalidates the code immediately.
- Five incorrect entries under the same account invalidate all its currently valid codes. Generate a new code on the computer.
- Only devices signed in to the same account are accepted.

### Wording

The UI must not expose the terms Host, Node (after E1), Machine, ProductDevice, Supervisor, Relay, authorization, grant, or fingerprint. Errors explain what happened and how to proceed, for example the following.

- “Incorrect pairing code. Three attempts remaining.”
- “This pairing code has expired. Generate a new one on the computer.”
- “This computer cannot be reached right now. Check that it is on and connected to the internet.”

## 2. Current Code (Verified on main)

- **Authorization** — Control Plane only stores authorizations and answers connection checks. It signs nothing.
  - Host's key signs authorizations stored in `host_device_authorizations` (migration 0001:175).
  - The database CHECK allows only `supervisor_read` (0001:185, also unchanged in 0007).
  - Authorizations last 30 days (`host-identity-service.ts:143`), with no renewal path (`:1824-1827`).
- **Control permissions** — Only the local Host's `host_supervisor_control` table is consulted. Connection checks do not inspect the scope in the grant.
  - The local grant endpoint `/api/v1/supervisor/control/approve` (`local-http-server.ts:605`) does not validate the request origin, allowing any local program to call it.
- **Revocation**
  - Existing revocation endpoints let devices revoke only themselves (`server.ts:849`, `:2136-2143`). The computer cannot revoke a phone.
  - Disconnection is delayed. Sessions last up to five minutes (`constants.ts:22`), and the cleanup loop runs every 60 seconds (`local-supervisor-presence.tsx:23`).
- **Requests and approvals (Phase 10A)** — Control Plane endpoints remain (`server.ts:533-703`), although v4 removed their UI.
- **Remote operations** total 12 (`packages/supervisor-transport/src/protocol.ts:280-376`). Existing local functions available for reuse include the following.
  - `archiveConversation`
  - `interruptTurn` (checks `capabilities.interrupt`)
  - `resolveApproval`
  - `resolveAttention`
  - `listAttention`

  They all reside in `host-service.ts` and support `actionId` idempotency.

- **Relay** — Configurable only through three environment variables (`supervisor-transport-manager.ts:1197`). The Control Plane address is embedded at build time and passed from Desktop to Host (`host_supervisor.rs:265-271`). Relay can follow that pattern.
- **Pairing codes** — Node's six-digit generation and constants can be reused (`packages/machine-transport/src/pairing-code.ts`, `constants.ts:31-33`). Its OPAQUE validation and in-memory storage are unsuitable for cross-network pairing mediated by Control Plane.
- **Device platform** — Desktop registration hardcodes `macOS-arm64`, including on Windows (`control-plane-client.ts:396-402`), causing incorrect device-list labels.

## 3. Implementation

### 3.1 Pairing Codes (Mediated by Control Plane and Signed with Host's Key)

1. Clicking “Add phone or tablet” on the computer makes the web app create a pairing session through Control Plane for this Host, valid for five minutes, and receive a six-digit code.
   - Control Plane stores only a keyed code hash (HMAC, with a server-only key) and a failed-attempt count.
2. The new device submits the code using its own ProductDevice identity.
   - Control Plane compares it against active sessions for the same account.
   - On a match, it marks the session “Claimed by device” and produces the authorization payload for signing, including this Host, the device, its key, permissions, and expiry.
3. While the computer's dialog remains open, poll session state every two seconds. Upon a claim, perform the following.
   - Sign with Host's key through the existing Tauri `host_identity_key_sign` command.
   - Submit confirmation to Control Plane, which verifies the signature through the existing path and stores the authorization.
   - Show “Added · Device name.” No additional Allow click on the computer is required, as decided by the user.
4. Automatic signing occurs only in this dialog and for this session. Closing the dialog stops signing. Host's key signature remains the authorization authority, with Control Plane serving as intermediary.

The old request and approval endpoints lose their UI callers but remain available for now.

### 3.2 One Permission

- New authorizations use `supervisor_control`, which includes read access. Add migration 0009 to extend the CHECK while preserving old `supervisor_read` records.
- Host determines control permission from the Host-signed authorization and the grant's scope.
- Remove the local `/api/v1/supervisor/control/approve` endpoint and the `host_supervisor_control` path. Control permission then comes only from pairing through the computer UI and cannot be acquired by other local programs.
- Approval and stop still follow AI tool capabilities and the existing local gates, as on the computer.

### 3.3 Automatic Renewal

- Authorization duration remains 30 days.
- While the computer is on, the existing 60-second loop checks authorizations. If fewer than 15 days remain and the device has connected in the last 30 days, sign and submit a replacement with Host's key. The new authorization supersedes the old one, which is marked replaced.
- If the computer has been off long enough for authorization to expire, renew on the next startup provided the device was used within the 30 days preceding expiry.
- Devices unused for more than 30 days expire naturally. The Devices page shows “Expired. Pair again.”

### 3.4 Immediate Disconnection on Removal

- Clicking “Remove” on Devices triggers the following.
  - The web app first asks local Host to disable connections from this device immediately and close existing connections.
  - Then it signs a revocation with Host's key and submits it to Control Plane. This requires a new Host-signed revocation endpoint in Control Plane.
- If the phone unpairs itself or the account revokes it, the computer learns of this at the next handshake, within five minutes. This delay is acceptable and must be documented.

### 3.5 Automatic Relay Configuration

- In `host_supervisor.rs`, embed Relay's address, ID, and fingerprint at compile time and pass them to Host, following the Control Plane address pattern. Environment variables can still override them.
- These three values are public information. Their current values follow.
  - `tls://relay.codetether.org:8443`
  - `relay_d41fc913a6e74e65b916467b97bc299b`
  - `k1TqjlBhncNd1_fFKmuDr1uHOAYKOhVg7C92mopj0sg`
- Future Relay changes ship through new versions using U1's one-click updater.

### 3.6 Additional Remote Operations

Gating, `actionId` idempotency, busy 409 responses, and refusal to archive running conversations all match local behavior.

| Operation | Purpose | Reuses |
| ---------------------- | ---------------------------------- | ------------------------ |
| `conversation.recent` | Read recent conversations by computer without first selecting a project | Query used by the sidebar's Recent Conversations |
| `attention.list` | Inbox list | `listAttention` |
| `attention.resolve` | Resolve completed items | `resolveAttention` |
| `approval.resolve` | Approve or reject | `resolveApproval` |
| `turn.interrupt` | Stop | `interruptTurn` |
| `conversation.changes` | Read changes | Local changes-panel data |

### 3.7 Related Fixes

- Register Desktop with the actual platform, such as `Windows-x64` or `macOS-arm64`.
- Use a system-provided device display name, such as the computer name or phone model.

## 4. Acceptance

- Generate a code on the computer and enter it on the development diagnostic page `#/dev/supervisor-check` as the new device. B0 added that page, and B1 adds pairing-code entry. Verify successful pairing.
  - Test expired codes, five incorrect attempts, cancellation, and reuse of a consumed code.
- After pairing, use Relay in “Relay only” mode. All seven existing reads and the new operations in §3.6 must pass. Unsupported AI tools must not display approval or stop.
- After removal, existing connections disconnect within seconds and reconnection is rejected.
- Simulate a shorter authorization duration to verify renewal and renewal after expiry.
- Direct calls from other local programs to the old permission-grant endpoint fail because it no longer exists.
- Perform one cross-device pairing each on Windows and Mac, using Windows as the computer and the Mac development diagnostic page as the new device. The Mac step has a separate prompt.

## 5. Outside B1

- Phone and tablet interfaces (M1, M2).
- Computer-to-computer pairing codes, an Allow action on the computer, and Node migration (E1).
- Push notifications (B2).
