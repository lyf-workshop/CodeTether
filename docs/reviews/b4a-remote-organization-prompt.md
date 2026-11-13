# Task: B4a Remote Organization Operations (Remote Management, Round 1)

Run on Windows or Mac. Continue from `main` (currently `b668e53`). B4 gives tablets and iPads the remaining management operations available on computers. It has three rounds. This first round covers failure reasons, `pinnedAt` and `archived` in `conversation.list`, remote project addition/removal, remote conversation pinning/renaming/restoration, and remote search. Commit and push to `feat/b4a-remote-organization`. Do not push `main`, merge, or tag.

References (read each with `git show`):

- `docs/ux-redesign/08-remote-management.md`: the complete design (7 sections). B4a corresponds to §3.1, §3.2, and the first row in §7.
- The B4 row in `docs/ux-redesign/03-project-plan.md` §4.
- `docs/ux-redesign/06-pairing-remote-control.md` §1: UI wording rules.

Before starting, confirm this file has 4 second-level headings and the final section is "Report".

## Goals

**Required**:

1. **Include reasons in failure responses** (08 §3.2):
   - Extend Supervisor protocol response frames with a `reason` field.
   - Use a subset of `HostErrorCode` (`packages/protocol/src/errors.ts`) for `reason`.
   - Preserve `code` and `reason` when mapping local `HostError` values to Supervisor responses.
   - Add an optional, backward-compatible `reason` field to the mobile/tablet Rust core.
   - Clients (Kotlin and Swift) use `reason` for more precise error messages.

2. **`pinnedAt` and `archived` in `conversation.list`** (08 §2):
   - Add `pinnedAt` to `SupervisorConversationDirectoryItem`.
   - Read `pinned_at` in the `listSupervisorConversations` query.
   - Sort pinned conversations first (`pinnedAt DESC`), then by `last_activity_at DESC`.
   - Add an `archived` parameter (`active`, `archived`, `all`), defaulting to `active`.

3. **Add remote operations** (08 §3.1):
   - `project.create`: reuse `createProject` (local) or `createRemoteProject` (another device).
   - `project.remove`: delete the project, rejecting projects with conversations with reason `project_has_conversations`.
   - `conversation.pin`: pin a conversation. The request carries the target `pinned` state, rather than toggling it.
   - `conversation.rename`: rename a conversation. Titles must have 1–240 code units, at most 160 graphemes, and NFC normalization.
   - `conversation.restore`: restore a conversation. If already unarchived, return success and the current conversation.
   - `conversation.search`: search conversations. Queries have at most 256 code units and 160 graphemes. Pages default to 25 results, with a maximum of 100.

4. **Permission gates** (08 §3.1):
   - `project.create`, `project.remove`, `conversation.pin`, `conversation.rename`, and `conversation.restore` require control permission.
   - `conversation.search` requires viewing permission only (confirmed in 08 §6 item 3).
   - Add the operations to `isSupervisorControlOperation` (`packages/supervisor-transport/src/server.ts:710`).

5. **`actionId` idempotency** (08 §3.1):
   - `project.create` scope: global `'project.create'` for the local machine, `project.remote.create:<machineId>` for other devices.
   - `project.remove` scope: `project.delete:<projectId>`.
   - `conversation.pin`, `conversation.rename`, and `conversation.restore` scope: the conversation, as in local operations.
   - Retransmission: the same actionId returns the first result. After an explicit failure, retry with a new actionId.

6. **Frame checks for writes** (08 §2):
   - Response `data` must fit a 16 KiB frame.
   - Retain the 12 KiB row-data budget (`maximumRowsBytes` at `supervisor-operations.ts:20`).

7. **Rust core methods** (08 §3.1):
   - Add corresponding Rust functions to `packages/supervisor-mobile/src/lib.rs`, exposed through UniFFI.
   - Kotlin (`apps/android/app/src/main/kotlin/org/codetether/supervisor/`) and Swift (`apps/ios/Sources/CodeTether/`) call these methods.

**Expected**:

8. **UI wording rules** (06 §1, 08 §1):
   - Do not expose Host, Node, Machine, ProductDevice, Supervisor, Relay, authorization, grant, or fingerprint in the UI.
   - Errors explain only what happened and how to proceed:
     - "This folder has already been added. Open the existing project."
     - "This project still has conversations and cannot be removed."
     - "This computer is unreachable. Make sure it is on and connected to the internet."
     - "This device does not have permission to use this computer."

**Outside this round**:
- `folder.list` (folder browsing): B4b.
- `provider-sessions.discover` and `provider-sessions.adopt` (scanning and importing previous conversations): B4c.
- T1b and iPad remote-management UI: after all three B4 rounds merge into `main`.

## Known Facts

- Current state: `main` `b668e53`.
  - Remote operations use Supervisor. Requests are `supervisor.request`, distinguished by `operation`, with protocol version 1.
  - B1 operations are defined in `supervisorB1OperationSchema` (`packages/supervisor-transport/src/protocol.ts:372`).
  - Local execution is in `executeSupervisorB1Operation` at `apps/host/src/api/supervisor-operations.ts:71`.
  - Permission is either `supervisor_read` or `supervisor_control`.
  - Mutations carry an `actionId`, formatted as `act_` followed by 6–96 characters.
  - Host `#executeAction` deduplicates by actionId.

- Response frames (`protocol.ts:517`) contain only `ok`, `data`, `code`, and `httpStatus`.
  - `code` has only 8 values: `invalid_request`, `operation_not_allowed`, `not_found`, `conflict`, `unsupported`, `unavailable`, `session_expired`, and `internal`.
  - `httpStatus` allows only 409 or 422, and appears only when `code` is `unsupported`.
  - Errors are flattened. Failure responses built at `server.ts:646` carry only `code` and, only for `unsupported`, `httpStatus`.

- Size limits:
  - The mobile/tablet Rust core limits each request to 16 KiB and each wait to 8 seconds.
  - The actual Supervisor frame limit is 16 KiB.
  - List row data is bounded to 12 KiB.

- Already available locally, but not remotely:
  - Add project: `createProject` (`host-service.ts:3266`) and `createRemoteProject` (:2393).
  - Remove project: `deleteProject` (`host-service.ts:3290`).
  - Search: `searchProjectConversations` (`host-service.ts:2524`).
  - Pin, unpin, rename, restore: `pinConversation` (:3108), `unpinConversation` (:3127), `renameConversation` (:3088), `unarchiveConversation` (:3176).

- The conversation directory lacks pinning. `SupervisorConversationDirectoryItem` has no `pinnedAt`, and the `listSupervisorConversations` query does not read `pinned_at`.

## Boundaries

**Decide independently**:
- Implementation approach.
- Commit breakdown (one or more commits per item, with tests).
- Test and screenshot methods.
- The exact `reason` subset selected from `HostErrorCode`.

**Ask the user first**:
- Changing the Supervisor protocol version (protocol extensions normally require a version bump).
- Changing the public mobile/tablet Rust core interface (UniFFI definitions).
- Requiring the user to operate Android or iPad personally.

**Do not**:
- Read or print credentials.
- Push `main`, merge, or tag.
- Force-push.
- Browse folders (B4b).
- Scan or import previous conversations (B4c).

## Report

Append to `~/agenthub-archive/b4a-report.md` (a new file), using these sections:

- Starting point: the branch's base commit and confirmation that all 7 sections of 08 were read.
- Changes and corresponding commits for each item 1–8.
- Protocol-extension details (the exact `reason` subset and whether the protocol version changed).
- Rust test results (unit and integration tests).
- Node.js test results (type checking, lint, unit and integration tests).
- Remote commit after pushing.
- Unfinished work, reasons, and the current completion level.
