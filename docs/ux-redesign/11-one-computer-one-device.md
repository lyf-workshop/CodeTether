# 11 · One Computer, One Device (E1): Design

**Date:** 2026-11-13.

**Status:** Draft for Owner review (DEVELOPMENT-PROCESS step 2). Task prompts follow only after the decisions in §7 are made.

**Covers:** 03 §4 E1; 04 E5–E7, E9, E10; and the 04 performance target "connected within 3 seconds of a correct pairing code".

## 1. Goals and non-goals

**Goals (from 03 E1):**

1. **One app per computer.** Every computer runs only the CodeTether desktop app, with no separate Node installation or pairing. This covers Windows, macOS and Linux. Headless Linux keeps a command-line sign-in and pairing.
2. **Adding a computer works like adding a phone.** Sign in to the same account, then enter the 6-digit code shown on the other computer. Later, an "Allow this device to use this computer?" prompt also works.
3. **A conversation belongs only to the computer that runs it.** Every other device reads and controls it live, without copies. Both computers show the same conversation list.
4. **Pairing completes within 3 seconds** on a healthy network.
5. **Existing Node pairings keep working until migration.** Migration loses no projects or conversations. Afterwards the Node, LAN-address, update-address and Relay-configuration UI is removed (E5–E7).

**Non-goals:**

- Syncing or copying conversations between computers.
- Running a conversation on a computer other than the one that holds its project.
- Sharing between accounts.
- Changing how phones and tablets are trusted.

## 2. Today

Two remote-access models exist side by side.

### 2.1 Machine model (Phases 6–8)

- The desktop Host is a _Controller_. A separately installed CodeTether Node is a remote _Machine_, paired with a code plus a LAN address.
- Controller and Node pin each other's identities over an inner TLS 1.3 Machine session, either direct or through Relay `machine_tls_v1` channels.
- The Node runs the AI tools, while **the Controller's database owns the conversation** (`machine_id` = the Node's Machine).
- This needs:
  - endpoint hints (migration 010)
  - Relay controller configuration (migration 014)
  - `apps/node` (about 11.9k lines)
  - `packages/machine-transport`
  - `apps/host/src/api/remote-machine-coordinator.ts` (4.2k lines)
- Only one Controller per Node. Windows cannot be a Node.

### 2.2 Account and Supervisor model (Phases 9–10, B1, B4a)

- **Identities.** Each desktop Host has an account-claimed `host_*` identity. Each client has a ProductDevice `dev_*` identity. The desktop already registers its own ProductDevice; key storage is behind `ProductDeviceIdentityCapability`, see `PHASE9C-MACOS-PRODUCTDEVICE-KEY-STORAGE.md`.
- **Grants.** A pairing code on the computer leads to a Host-signed grant for that device.
- **Transport.** The Supervisor transport uses TLS 1.3 with Host pinning and device proof, direct or through Relay.
- **Operations.** Directory, history, live read, create, turn start, Attention, approval, interrupt, changes and organization; B4b adds folder browsing and D2 adds model control.
- **Clients.** Tablets and the iPad use this model. The desktop has a Supervisor client in `apps/web/src/runtime/account/remote-supervisor.ts`, used today by pairing and the development pages.

### 2.3 Consequences

- A conversation that Windows starts on the Mac through the Node lives in the Windows database. The Mac's own conversations live on the Mac. Neither computer sees the other's.
- Pairing polls every 2 seconds on both sides (`pairing-flow.ts:27`), and the Host then processes every grant. Total time is 5–10 seconds.
- There are two remote APIs to maintain, and only the Supervisor one serves phones and tablets.

## 3. Design

### 3.1 Core decision: computers use each other as tablets do

**Each computer is one Host.**

- It has its own `host_*` identity.
- It has its own durable data.
- It has exactly one Machine: itself.

**Using another computer.** A computer that wants to use another computer becomes a **Supervisor client** of that computer's Host, with its own ProductDevice identity. That is exactly the role a tablet has.

**The Node and Machine model is retired after migration** (§4).

**Why this model:**

- It reuses the newer path that is deployed and account-based: pairing codes, grants, Relay presence, and Supervisor operations including B4a, B4b and D2.
- Phones and tablets already depend on that path, so there is one remote API instead of two.
- Ownership becomes simple: the conversation's record, the AI-tool session and its Attention all live on the computer that executes it.

**No new identity types.** Host, ProductDevice, Relay and account identities stay independent (03 §6).

### 3.2 Adding a computer

1. On computer A: Devices › Add device shows a 6-digit code. This is the existing B1 flow.
2. On computer B, signed in to the same account: Devices › "Use another computer" › enter the code. B's ProductDevice receives a grant on A's Host.
3. **Mutual by default (decision D1).** The user's own computers usually want to use each other. After step 2, B shows "Also let A use this computer?". Confirming it on B issues the reverse grant on B's Host.

   Both grants are therefore issued from a computer's own UI, which keeps the 03 §6 invariant that only the computer's interface can add a device.

4. Removing either direction disconnects that direction immediately. Removing a computer from Devices removes both directions.

### 3.3 "Allow on this computer"

- The Control Plane already has `GET /v1/hosts/access-requests/pending` (`apps/control-plane/src/server.ts:596`), and the desktop already calls it (`control-plane-client.ts:836`).
- E1 adds a prompt on every signed-in computer. When a new device on the same account asks for access, the computer shows "Allow ‹device› to use this computer?"
  - **Allow** issues the grant.
  - **Ignore** leaves the request to expire.
- The pairing code remains as the alternative.

### 3.4 Pairing within 3 seconds

- **Long polling.** The Control Plane's pending and redeem endpoints get a long-poll form. The request waits up to about 25 seconds and returns as soon as the request it waits for changes state.
- **Narrower processing.** The Host processes only the new request, not every grant.
- **Progress.** Both sides show steps: code accepted, computer confirmed, connected.
- **Shared flow.** Phones, tablets and computers use the same flow; T1b, I1 and M1 update their waiting screens.
- **Measure.** Time from entering the code to "connected", measured on real devices.

### 3.5 What a computer shows for other computers

- The desktop device tree, the conversation lists and Home show every paired computer's projects and conversations, read live through Supervisor, grouped by device (04 E11).
- Creating a conversation in a project on B, from A, is `conversation.create` on B's Host. Reply, approve, stop, changes, organization, model control and folder browsing all go through the existing Supervisor operations.
- **No local mirror.** Nothing about another computer's conversations is written to A's SQLite. Only TanStack Query's in-memory cache holds it. When B is offline, A shows B as offline, using what it last read in this session.
- **Not over Supervisor:** AI-tool installation, sign-in, Settings and diagnostics of another computer. These are done on that computer.
- **Notifications from other computers (decision D3).**
  - Recommended: carry them on B2's long-lived connection, the same one phones use.
  - Until B2 lands, A only shows Attention counts for B while A's window is visible, by reading `attention.list` when the device tree refreshes.

### 3.6 Headless Linux

- A command-line Host replaces `apps/node` on servers. It is the same Host code, built as a single executable without Tauri. It offers:
  - `login`: email code, as on the iPad
  - `pair`: prints a 6-digit code, or shows pending access requests to allow
  - `serve`: runs as a systemd user service, keeping Relay presence
- It exposes no local web UI. Its loopback API stays off, or is token-protected per `docs/adr/ADR-LOCAL-API-SESSION-TOKEN.md`.
- It has to exist before Linux Nodes can migrate.

### 3.7 Windows as a device (E9)

This is solved by §3.1. A Windows desktop Host is already reachable over Supervisor; tablets use it today.

## 4. Migrating existing Node pairings

**What exists today.** The Windows Host holds:

- the Machine record for the Mac Node
- the Mac's Project Locations
- the conversations that ran on the Mac

The AI-tool sessions themselves (Codex and Claude Code transcripts) are on the Mac's disk.

**Plan:**

1. **Keep.** Node pairings work unchanged until both computers run a desktop with E1, or a headless Host on Linux.
2. **Move (decision D4, recommendation (a)).** On the computer that executed the work, which is the Mac:
   - The Mac's Host registers each Node Project Location's folder as a local project. This is idempotent by canonical root.
   - It adopts the native sessions through the existing Phase 8A import of previous sessions, so history comes from the native transcripts.
   - On Windows, the old records become a read-only "moved to ‹Mac›" archive, kept until the user removes the old Node pairing.
   - Alternative (b): a one-time authenticated transfer of CodeTether's own records (Turns, Attention, titles, pins) from Windows to the Mac. That needs a new export operation and preserves more, at the cost of a new protocol surface.
3. **Remove the UI.** After migration, unpair the Node and remove the Node, LAN-address, update-address and Relay-configuration UI (E5–E7).
4. **Remove the code.** Remove `apps/node`, `packages/machine-transport`, the remote Machine coordinator and their migrations' runtime paths one release later, so an installed version never depends on removed code. The schema keeps its tables until a later cleanup migration.

## 5. Stages

Each stage is one prompt and stays within about 30 files and 3,000 lines.

| Stage | Content                                                                                                                                           | Depends on   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| E1a   | Control Plane: long-poll for pending access requests and pairing redemption, plus progress states. Deployed by a separate prompt                  | —            |
| E1b   | Desktop: "Use another computer" (enter a code); productize the desktop Supervisor client; device tree and lists show other computers read-only    | E1a          |
| E1c   | Desktop: control on other computers (create, reply, approve, stop, changes, organization, model, folders) through Supervisor; mutual pairing (D1) | E1b, D2, B4b |
| E1d   | "Allow on this computer" prompt on every computer                                                                                                 | E1a          |
| E1e   | Headless Linux Host (command-line login, pairing and service)                                                                                     | E1a          |
| E1f   | Node migration (§4) and removal of the Node, address and Relay-configuration UI                                                                   | E1c, E1e     |
| E1g   | Code removal of the Node and Machine transport, one release after E1f                                                                             | E1f released |

Cross-computer notifications (D3) ride on B2. E1c ships without them if B2 is not ready.

## 6. Invariants and security

- **The 03 §6 invariants all hold:**
  - Devices are added only from a computer's UI (code or Allow).
  - One permission level.
  - Removal disconnects immediately.
  - Closing an app never stops work on another computer.
  - `actionId` idempotency.
  - No automatic resend.
  - Only real capabilities are shown.
- **A computer using another has exactly a tablet's rights.** It cannot pair further devices on that computer, and it cannot install or sign in AI tools there.
- **The desktop's ProductDevice key** becomes as valuable as a tablet's.
  - It must live in the OS key store: Windows DPAPI/CNG, macOS Keychain (Phase 9C), and the Linux Secret Service, or a `0600` file for the headless Host.
  - E1b verifies this for each platform before enabling the feature.
- **Local API.** With computers reachable remotely, the local-API token (S1, AD-5) matters more. Do S1 before E1c.
- **Relay capacity.** Every pair of computers adds Supervisor channels to the single Relay. Measure channel counts and memory in E1b.

## 7. Decisions for the Owner

| #   | Question                                                       | Recommendation                                                                                      |
| --- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| D1  | Should pairing two computers be mutual by default?             | Yes: two grants, the second confirmed on the other computer's screen                                |
| D2  | Where do other computers' conversations appear on the desktop? | In the same lists, grouped by device as in 04 E11                                                   |
| D3  | How do notifications from other computers arrive?              | Through B2's long-lived connection. Until then, counts only while the window is visible             |
| D4  | How is Node work migrated?                                     | (a) Adopt native sessions on the executing computer and keep the old records as a read-only archive |
| D5  | Should headless Linux be supported?                            | Yes, as E1e, before Node migration, because Linux servers are Node-only today                       |
| D6  | When is the Node code removed?                                 | One release after migration ships                                                                   |

## 8. To verify before writing prompts

- Each desktop install registers exactly one ProductDevice per account and can hold grants on several Hosts at once.
- What `GET /v1/hosts/access-requests/pending` returns today, and whether a new device creates such a request when it signs in.
- Supervisor operation coverage against the desktop features in §3.5, so that missing operations are listed per stage.
- The Phase 8A adoption path works for sessions created by a Node, which have the same native formats, on the Mac and on Linux.
