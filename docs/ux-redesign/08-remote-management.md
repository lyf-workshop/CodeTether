# 08 · Remote Management (B4)

Date: 2026-11-05. Based on 07 §6, B4 in 03 §4, 04 P1/P2/P5/P6/P9/C3/C4, and code at `main` `b668e53`.

B4 enables remaining desktop management operations from tablets/iPad: folder browsing, project add/remove, prior-session discovery/import, project search, pinning, renaming, and restoration. T1b/I1 implement UI. B4 implements backend and desktop browsing only.

## 1. User Experience

Follow the 07 prototype. B4 defines operation behavior/messages without a new layout.

### Tablet and iPad

- **Add Project** (07 03-07–03-09): device → browse folder → name → select/import previous conversations.
  - Start in the computer's user directory, showing folders only. Tap to descend, Up to ascend, through disk root. On Windows, ascending further lists drives.
  - Opening an inaccessible folder shows an inline permission/timeout reason, without alert dialogs. Do not prelabel inaccessible children. Mac attribute checks succeed before permission, so cannot predict this (§3.3). Hide hidden folders by default, with a Show Hidden Folders switch.
  - Default the editable name to the folder name.
- **Previous Conversations**: available at the final add step and project page. Show searching status with cancellation. Group by tool, showing title, last use, resumability, and imported state. Already imported items cannot be selected again.
- **Project** (07 03-04–03-06):
  - Conversations / Archived segments. Pinned first, then recent activity.
  - Search titles/user input with a matching-text preview.
  - Confirm removal. Projects containing conversations cannot be removed. Explain that conversations remain and require archiving or desktop handling first. Offer no forced deletion.
- **Conversation More**: pin, unpin, rename, archive, restore. B1 already supports archive. B4 adds the rest.
- Indirect devices support these operations too, with browsing/scanning executed on the target device.

### Desktop (04 P9)

- Adding projects on paired devices currently requires full paths (`apps/web/src/components/projects/add-project-fields.tsx:193`). Add browsing like local projects, retaining manual path entry as a supplement.
- Local projects retain the native folder picker.

### Wording

Follow 06 §1. UI excludes Host, Node (after E1), Machine, ProductDevice, Supervisor, Relay, authorization, grant, and fingerprint. Errors explain events and recovery:

- "You do not have permission to open this folder. In Mac System Settings › Privacy & Security › Files and Folders, allow CodeTether access, then retry." For macOS system denial with `systemPrivacy: true`. For indirect devices, name codetether-node.
- "A permission dialog may be open on the Mac. Click Allow there, then retry." For macOS read timeout.
- "You do not have permission to open this folder." When `systemPrivacy` is not true, including other OSes and ordinary macOS permissions.
- "Reading this folder timed out. It may be a network drive. You can retry." For other OS timeouts.
- "This computer is waiting for other folder permissions or reads. Try again shortly." When browsing slots are full (§3.3). On Mac append guidance to handle any permission dialog there first.
- macOS dialog/settings names: Host is CodeTether (one desktop run showed lowercase codetether, unexplained), Node is codetether-node. Verify Host naming during B4 acceptance and adjust wording.
- "This folder has already been added. Open the existing project."
- "This project still has conversations and cannot be removed."
- "The discovery results expired. Search again."
- "This computer is unreachable. Make sure it is on and connected to the internet."
- "This device does not have permission to use this computer." For view-only devices.

## 2. Current Code (Verified at `main` `b668e53`)

- **Remote operations use Supervisor**. `supervisor.request` distinguishes `operation`, protocol 1 (`packages/supervisor-transport/src/protocol.ts:417`). B1 schema is `supervisorB1OperationSchema` (:372). Local executor is `executeSupervisorB1Operation` at `apps/host/src/api/supervisor-operations.ts:71`.
- **One permission scope** per connection: `supervisor_read` or `supervisor_control` (`packages/supervisor-transport/src/server.ts:54`). `isSupervisorControlOperation` (:710) lists controls. Missing control permission throws `operation_not_allowed` (:539).
- **Mutations carry `actionId`**, `act_` plus 6–96 characters (`packages/protocol/src/ids.ts:63`). Host `#executeAction` returns the previous result for identical actionId/content and conflict for different content. Each operation has its own scope (§3.1).
- **Response frames** (`protocol.ts:517`) contain only `ok`, `data`, `code`, `httpStatus`. Codes: `invalid_request`, `operation_not_allowed`, `not_found`, `conflict`, `unsupported`, `unavailable`, `session_expired`, `internal`. `httpStatus` is only 409/422 and appears only with `unsupported` (:542).
- **Errors are flattened**. `server.ts:646` builds failures using code and unsupported-only status. `supervisorReadErrorCode` (`server.ts:803`) recognizes 6 names, maps `runtime_unavailable`/`provider_unavailable` to `unavailable`, and everything else to `internal`, ignoring HTTP status. Existing local reasons such as `project_has_conversations`, `conversation_archived`, `machine_unreachable` disappear remotely. B3 exposes send reasons (03 §4), and B4 shares that mechanism (§3.2).
- **Size limits**:
  - Mobile Rust requests are at most 16 KiB with an 8-second wait (`packages/supervisor-mobile/src/wire.rs:13-14`). `Response` (:571) denies unknown fields, but its unvalidated `data: Value` tolerates extra data fields. `Operation` (:652) parses Kotlin JSON (`lib.rs:140`) with `deny_unknown_fields` (:650), rejecting unknown operations/fields. Kotlin/core ship together, so old versions cannot send extensions, as expected.
  - Actual Supervisor frames are 16 KiB, not 256 KiB. Server (`packages/supervisor-transport/src/server.ts:9`) uses machine transport `FramedMachineConnection` and `machineTransportLimits.maximumFrameBytes`. `supervisorTransportLimits.maximumFrameBytes` declares 256 KiB (`constants.ts:12`) but is ineffective. Rust also reads 16 KiB (`wire.rs:373`). List rows fit 12 KiB (`maximumRowsBytes`, `supervisor-operations.ts:20`), but unbounded details such as `machine.get` can exceed the frame and become `internal`, observed on Android/iPad devices on 2026-11-07. See `docs/reviews/b1-supervisor-internal-fix-prompt.md`. Every B4 operation, including detail, must fit 16 KiB.
  - Computer/Node frames are 16 KiB (`packages/machine-transport/src/constants.ts:26`).
- **Directory lacks pinning**. `SupervisorConversationDirectoryItem` (`apps/host/src/persistence/conversation-store.ts:265`) has no `pinnedAt`. `listSupervisorConversations` (:3403) omits `pinned_at`, sorting only by `last_activity_at`. Local sidebar uses pinned first (`apps/web/src/components/app-shell/workspace-sidebar-model.ts:128`).
- **Local operations missing remotely**:
  - Add: `createProject` (`host-service.ts:3266`) / `createRemoteProject` (:2393), taking `actionId`, optional `name` (1–240), and `path` (1–4096), per `packages/protocol/src/commands.ts:79`, :93.
  - Remove: `deleteProject` (`host-service.ts:3290`), rejecting any conversations, including archives, or active operations with `project_has_conversations` (`host-service.ts:10009`).
  - Discover: `discoverProviderSessions` (`host-service.ts:2569`), at most 60 seconds/100 pages (`host-service.ts:299-300`), coalesced by project/machine/tool/path (:6269 key). Snapshots last 5 minutes and hold at most 4000 items (`provider-session-discovery-registry.ts:24-26`). Expired cursors yield `provider_session_candidate_expired` (`host-service.ts:2596`).
  - Import: `adoptProviderSession` (`host-service.ts:2707`), using short-lived `candidate_` references without native session IDs.
  - Search: `searchProjectConversations` (`host-service.ts:2524`). Query ≤256 code units/160 graphemes, default page size 25/maximum 100, preview ≤1024 code units/160 graphemes, `csc_` cursor ≤2048 (`packages/protocol/src/conversation-search.ts:10`).
  - Pin/unpin/rename/restore: `pinConversation` (:3108), `unpinConversation` (:3127), `renameConversation` (:3088), `unarchiveConversation` (:3176). Titles 1–240 code units/≤160 graphemes, NFC-normalized (`packages/protocol/src/records.ts:49`).
- **No project rename**. Local PATCH at `local-http-server.ts:1808` changes conversation titles only. The Rename in 07 §4 refers to conversations. B4 excludes project rename.
- **Folder browsing is new**. Local native picker is `apps/desktop/src-tauri/src/project_directory_picker.rs:4`. Node only validates one path with `project_location.validate` (`packages/machine-transport/src/messages.ts:439`, handler `apps/node/src/node-service.ts:740`), without directory listing.
- **Desktop-to-desktop operations** use `POST /api/v1/remote-supervisor/sessions/:id/operations` (`local-http-server.ts:676`), validating `supervisorB1OperationSchema`. Client: `apps/web/src/runtime/account/remote-supervisor.ts`.

## 3. Implementation

Match local permission gates, actionId idempotency, busy conflicts, and active-archive denial, following 06 §3.6.

### 3.1 New Remote Operations

All except `conversation.search` require control and join `isSupervisorControlOperation`. Read-only `folder.list` is control because external-folder visibility is a new capability, unavailable to view-only devices. Search needs viewing only (§6 item 3).

| Operation | Purpose | Reuse |
| ---------------------------- | -------------------------------- | ------------------------------------------------------------------- |
| `folder.list` | List a folder's child folders | New local reads and §3.5 messages for indirect devices |
| `project.create` | Add project | Local `createProject`, other devices `createRemoteProject` |
| `project.remove` | Remove project | `deleteProject` |
| `provider-sessions.discover` | Find previous conversations | `discoverProviderSessions`, adapted to short wait/polling in §3.4 |
| `provider-sessions.adopt` | Import one prior conversation | `adoptProviderSession` |
| `conversation.search` | Project search | `searchProjectConversations`, bounded to 12 KiB |
| `conversation.pin` | Pin/unpin | `pinConversation` / `unpinConversation`, target `pinned: boolean` |
| `conversation.rename` | Rename conversation | `renameConversation`, `ManualConversationTitleSchema` |
| `conversation.restore` | Restore archive | `unarchiveConversation` |

Extend existing `conversation.list` items with optional `pinnedAt`, omitted when unpinned, and optional `archived` filter (`active`, `archived`, `all`), **default `all`**. Existing lists do not filter archives. Installed T1a projects filter after fetching everything (`apps/android/app/src/main/java/org/codetether/app/remote/RemoteSupervisor.kt:116`), so default active would hide archived items. Sort like local sidebar: descending pin time first, then descending activity.

Compatibility reasons must be accurate:

- Response: Rust `Response` (`wire.rs:571`) rejects extra envelope fields. Only `data: Value` tolerates additions, and Kotlin `org.json` ignores additional `pinnedAt`.
- Request: old clients omit `archived`, relying on server default all. `Operation` parsing (`lib.rs:140`, `wire.rs:647-651`) rejects unknown fields/operations, so adding Kotlin `archived` requires the matching core update, packaged together.

Later T1b/I1 versions can send `archived` instead of retrieving and filtering complete lists.

Mutation actionId scopes match local operations:

- `project.create`: global `'project.create'` through local `createProject` (`host-service.ts:3266`), or `project.remote.create:<machineId>` via remote creation (:2393). Duplicate submission returns the same project.
- `project.remove`: `project.delete:<projectId>` (`host-service.ts:3290`).
- `provider-sessions.adopt`: `provider.session.adopt:<projectId>:<machineId>`, matching `adoptProviderSession` (`host-service.ts:2719`).
- Pin/rename/restore: conversation scope, matching their local functions.

#### When No Result Arrives

B4 writes cannot query `action.get`. It only calls `getTurnForStartAction` for message-send IDs (`apps/host/src/api/supervisor-transport-manager.ts:322`), returning not_found otherwise. Do not expand it. Persisting all action results would require a migration while offering only what retransmission already provides.

Host's in-memory `apps/host/src/api/action-idempotency-cache.ts` holds at most 256 records, evicts earliest completed first, clears on exit, and caches failures. Clients follow:

- **No response**, from 8-second timeout/disconnect: retransmit the same actionId. If Host has not restarted/evicted it, return the first result, including failure.
- **Explicit `ok: false`**: repeating that actionId repeats the failure. User Retry uses a fresh actionId.

After Host restart/eviction, retransmission executes again. Every write must remain safe and understandable:

- `project.create`: same folder returns existing project with `created` set to `false` (`created: false`).
- `project.remove`: a repeated completed removal returns `not_found`. A removal retransmission treats this as already removed.
- `provider-sessions.adopt`: returns `already_adopted`.
- `conversation.pin`: sends desired `pinned`, rather than toggle, so repetition is safe. Rename repeats the same title.
- `conversation.restore`: already-active conversation returns success/current conversation. Verify current local behavior. If local unarchive rejects it, normalize at Supervisor without changing local API.

#### Operation Requests and Responses

All use `supervisor.request`. Only operation-specific fields are listed below. Results live in response `data`.

`folder.list` (read-only, control required):

- Request: `machineId`, optional `path`, `cursor`, `includeHidden` (default false).
- Response: `path`, `status`, optional `parent`/`drives`. Readable includes `folders`, `skipped`, optional `nextCursor`. Access denied may include `systemPrivacy`. See §3.3.

`project.create`:

- Request: `machineId`, `actionId`, `path` (1–4096 bytes), optional `name` (1–240 code units).
- Response: local `CreateProjectResponse` `data` `{project, created}`, remote `CreateRemoteProjectResponse` `data` `{project, location, created}`. Already-added folders return existing data and `created: false`, without failure.

`project.remove`:

- Request: `projectId`, `actionId`.
- Response: `{projectId}`.

`provider-sessions.discover`:

- Request: `projectId`, `machineId`, optional `provider`, `cursor`, `limit` (default 50/maximum 100), `rescan` (default false).
- Response: `status` is `scanning` or `complete`. Complete includes `candidates`, `providers`, optional `nextCursor`, matching local `DiscoverProviderSessionsResponse`. Scanning omits candidates.

`provider-sessions.adopt`:

- Request: `projectId`, `machineId`, `actionId`, `discoveryCandidateId`.
- Response: `{conversation, disposition}`, with `disposition` equal to `adopted` or `already_adopted`.

`conversation.search`:

- Request: `projectId`, `query` (1–256 code units/≤160 graphemes), optional `archive` (active/archived/all, default active), `provider`, `status`, `cursor`, `limit` (default 25/maximum 100).
- Response: `results`, `hasMore`, optional `nextCursor`, matching local `ConversationSearchResponse`.

`conversation.pin`, `conversation.rename`, `conversation.restore`:

- All requests contain `machineId`, `projectId`, `conversationId`, `actionId`. Pin adds desired boolean `pinned`, rename adds `title`.
- All return `{conversation}`, with `conversation` using `ConversationSummary`.
- First validate ownership with `getSupervisorConversation(machineId, projectId, conversationId)`, matching B1.

### 3.2 Error Reporting

Do not add envelope fields. `supervisorResponseSchema` (`protocol.ts:517`) and Rust `Response` (`wire.rs:571`) reject them, so an envelope reason breaks installed clients. Put failure reason inside `data`, whose `z.unknown()` / Rust `Value` permits it. Existing failures (`server.ts:646`) omit data. Adding failure data uses the existing frame shape.

- Map `code` from Host error names, not HTTP status. Existing `supervisorReadErrorCode` (`server.ts:803`) recognizes names and falls back internal. B4 adds this mapping:

  | Host error | `code` |
  | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
  | `not_found`, `project_location_not_found`, `project_location_missing` | `not_found` |
  | `conflict`, `project_has_conversations`, `project_location_conflict`, `project_location_has_conversations`, `project_location_local_required`, `conversation_archived`, `provider_session_candidate_expired` | `conflict` |
  | `invalid_request`, `project_location_invalid` | `invalid_request` |
  | `runtime_unavailable`, `provider_unavailable`, `machine_unreachable`, `machine_connection_failed`, `provider_session_discovery_unavailable` | `unavailable` |
  | Others | `internal` |

- Failure `data` includes `reason`, using existing `HostErrorCode` (`packages/protocol/src/errors.ts:61`). Omit unrecognized reasons, retaining code only.
- Three local path failures use generic `invalid_request` with `project_location_invalid` in `failure.reason` (`host-service.ts:10022`, :9899). For generic invalid_request/conflict/unavailable, fall back to failure.reason only if it is a valid HostErrorCode. This distinguishes invalid paths from malformed requests.
- Omit developer-facing English `message`. Clients choose UI wording from reason.
- Apply to failures before execution. Started operations with uncertain results still return internal, preserving B3 uncertainty handling.
- B3 send failures share `data.reason`. Whichever task implements first extracts shared mapping rather than duplicating it.

### 3.3 Folder Browsing

`folder.list` request:

- `machineId`: target device.
- Optional `path`: default user directory if available, otherwise root. Windows root lists drives, other systems use `/`.
- Optional `cursor`: continue a page.
- `includeHidden`: default `false`.

Path rules:

- Absolute, ≤4096 bytes, no NUL, matching `RemoteProjectLocationPathSchema` (`packages/machine-transport/src/messages.ts:263`).
- Normalize before reading, resolving symlinks to real locations. Return normalized `path`, which clients use for further navigation without joining paths themselves.
- No project-root restriction. Browsing all folders was approved 2026-11-04. Control-capable devices can already execute tools/commands there, so listing does not expand their authority. Relay sees encrypted streams only.

Response:

- `path`: normalized current level, user directory initially or empty string for root listing.
- `parent`: preceding level, omitted at root.
- `drives`: Windows root only, with `letter` such as `C:` and optional `label`.
- `status`: `readable`, `access_denied`, `timeout` (not complete in 3 seconds). Only `readable` includes `folders`, `skipped`, and `nextCursor`. All are successful `ok: true`, not §3.2 failures. Inaccessible folders are ordinary outcomes explained inline (§1), avoiding a new permission HostErrorCode.
- `systemPrivacy`: `true` only for macOS `access_denied` with `EPERM` (privacy denial). Ordinary `EACCES` omits it. Clients use this distinction for System Settings guidance.
- `folders`: `name`/`hidden` entries without child opens or predicted accessibility. Current-level status determines accessibility after navigation. Pre-permission Mac attributes cannot predict it (§3.3).
- `nextCursor`: present when more results remain.

Count and size:

- At most 200 folders per level, also byte-bounded, whichever comes first. Skip/count names over 255 bytes.
- `skipped` counts overlong/unsupported names, including invalid Windows Unicode. Only positive counts show that some folders could not be displayed.
- Budget by recipient: mobile row data keeps 12 KiB. Node-to-computer whole frames must fit 16 KiB. Path/parent may each consume 4096 bytes plus envelope, so derive row budget by subtraction rather than copying 12 KiB.
- Cursors must not encode full paths, which may reach 4096 bytes and overflow cursor limits. Use server-issued short `fld_` references bound to matching path/includeHidden. Valid within one listing only, without long-lived state. Restart that level after expiry.

Read behavior:

- Three-second level timeout returns `status: timeout`, insufficient permission returns `status: access_denied`, including at the initial location, without request failure.
- Hidden detection includes a leading `.` and Windows hidden attributes. Omit by default, return with `hidden: true` when enabled. See §6 item 4 for Windows implementation.

Must not block other reads and writes:

- Node.js filesystem operations, `dns.lookup`, some crypto/compression share libuv's default 4-thread process-wide pool, including `worker_threads`. A privacy dialog or disconnected network drive can retain a thread indefinitely. The 3-second response timeout does not cancel the OS call or release that thread.
- Four blocked reads stop other filesystem work/discovery and DNS to Relay/account services. Tablets may lose connectivity and even timeout feedback.
- Therefore:
  - One directory read per level, no child opens. Symlink `stat` to determine folder type also counts as a read.
  - Separate browsing limits per Host/Node process: at most 2 unreturned reads. Timed-out OS calls keep slots until actually returning. Two pool threads remain for other work, and another folder remains browsable during one pending permission.
  - A second outstanding read for the same normalized path returns timeout immediately.
  - Full slots immediately fail new browsing with `code: unavailable` / `reason: runtime_unavailable`, without queueing. Explain the pending permissions/reads.
  - Increasing `UV_THREADPOOL_SIZE` merely postpones exhaustion without reclaiming blocked calls.
  - Do not initially use separate reader processes. Both Host/Node are Node SEA and launching per level costs hundreds of milliseconds. Real Mac reads hung about 95 minutes. Child processes could be killed without occupying parent threads, but permission attribution/sharing among child/Host/Node is untested. Start with slots, investigating processes only if both slots often remain full.
- Drive enumeration likewise avoids individual drive reads because disconnected network drives block (§6 item 4).

macOS permission dialogs, tested 2026-11-05 on macOS 27.0/Apple M4. Report: `docs/reports/B4-MAC-FOLDER-ACCESS-REPORT.md` on `spike/b4-mac-folder-access`:

Mac has two readers with separate permissions:

- **Host**: desktop-launched Node SEA sidecar (`externalBin` in `apps/desktop/src-tauri/tauri.conf.json`, launched by `host_supervisor.rs:255`). Used when tablet/iPad browses the Mac itself. Desktop is ad-hoc signed (`signingIdentity: "-"`, `tauri.macos.conf.json`), without `NSDesktopFolderUsageDescription`, `NSDocumentsFolderUsageDescription`, or `NSDownloadsFolderUsageDescription` in `Info.plist`.
- **CodeTether Node**: independent launchd user service `com.codetether.node` (`apps/node/src/service-installation.ts:19`), executable `~/Library/Application Support/CodeTether/Node/bin/codetether-node`, ad-hoc signed at build (`apps/node/scripts/build-node.mjs:102`). Used from Windows (§3.5). Neither desktop child nor app bundle.

Real first reads of Desktop/Documents/Downloads produced Mac permission dialogs:

1. **Attributes cannot predict permission.** `stat` and `access(R_OK | X_OK)` succeed for protected directories/children before permission, without prompting. Stat took under 2 ms, access 6–27 ms. Therefore child accessibility cannot be premarked. After denial, `access` returns `EPERM`, but `readdir` already does so immediately, making prechecks unnecessary.
2. **`readdir` waits indefinitely for dialog handling.** The longest attended run was 84,969 ms of user response time, not a system ceiling. Unattended runs hung about 5.8 minutes (EPERM), 15 minutes (EPERM), and 95 minutes (success). No continuous recording establishes dialog persistence or user influence. Treat waiting as potentially unbounded, including a remote tablet's first Desktop tap on an unattended Mac.
3. **Allow succeeds, denial gives EPERM, subsequent reads immediately EPERM (~0.5 ms), without another prompt.** Retests occurred 12–29 seconds after completion. To reverse denial, use System Settings › Privacy & Security › Files and Folders, with per-program Desktop/Documents/Downloads switches. Node did not appear under Full Disk Access.
4. **Privacy denial is EPERM, ordinary `chmod 000` denial is `EACCES`**, allowing distinction.
5. **Permission binds executable path and signing identity.** Restart preserves approval. Changed Node contents/CDHash or identical copy at another path prompts again. Rebuilt Host/Desktop also prompts. Ad-hoc CDHash changes every build, so updates require someone at the Mac to approve first protected-folder access again.
6. **Host and Node permissions are independent.** Node appears as `codetether-node`. Host dialogs appeared as lowercase `codetether` for Desktop, `CodeTether` for Documents/Downloads and rebuild, cause unexplained. Its exact System Settings entry was not checked.
7. **Blocked reads occupy the pool.** With one pending read, `stat('/tmp')`/`dns.lookup('localhost')` remain millisecond-scale. Four pending reads block both until dialogs resolve, for 23.5 seconds on Host and 30 seconds on Node. The 2-slot limit is required, not optional optimization.

Untested: dialog screenshots, true indefinite unattended ceiling, protected external volumes (`/Volumes`), iCloud Drive, and network drives. Use behavior-based 3-second timeout/limits rather than path allowlists.

Decisions from these results:

- Keep 3 seconds/2 slots, separately per Host and Node. Desktop browsing (§3.7) shares Host slots with Supervisor folder.list.
- Preserve three statuses, adding `systemPrivacy: true` only when macOS `errno` is `EPERM`. Do not send every permission failure to System Settings.
- Timed-out OS calls remain active and retain slots until returning, potentially minutes later. User approval releases slots. Retrying then starts a fresh fast permitted read.
- Two unattended protected reads can occupy both slots and reject all browsing until someone handles Mac dialogs. Explain this known outcome without another mechanism.
- B4 does not preserve permissions across updates (§5). Existing timeout guidance instructs approval. Add no proactive post-update permission message.
- Dialogs appear on the accessed Mac/device, never the browsing tablet/computer.
- User-directory/root listing should not prompt because they are unprotected. This was not separately tested. Confirm during B4 Mac acceptance.

### 3.4 Discover Previous Conversations

Discovery may take 60 seconds (`host-service.ts:299`) while clients wait 8. Do not wait for completion in `provider-sessions.discover`:

- Request machineId/projectId, optional provider/cursor, limit default 50/maximum 100 matching local, and rescan default false.
- Keep the Host scan alive independently of individual request signals. Existing `waitForProviderSessionScan` (`host-service.ts:8853`) cancels when its final waiter aborts, and snapshots appear only after discoverProviderSessions completes. Returning after 4 seconds must not cancel the scan, or subsequent polls have nothing. Retained scans save snapshots on completion themselves.
- Start if absent and wait at most 4 seconds. Return `status: complete` and results immediately if finished.
- Otherwise return `status: scanning` without candidates. Continue server-side and coalesce by project\0machine\0tool\0path as locally, without duplicate scans.
- Poll every 3 seconds using the same request. The first poll after completion returns complete, candidates, providers, nextCursor.
- Rescan true discards existing matching snapshots and restarts. Default false reuses valid snapshots.
- Cursor requests read snapshots only. Expiry at 5 minutes returns conflict / provider_session_candidate_expired.
- Local scan-capacity exhaustion returns an unavailable page (`host-service.ts:6287`). Remotely return scanning for later polling rather than implying no results.
- Candidate fields match `ProviderSessionDiscoveryCandidateSchema` (`packages/protocol/src/provider-sessions.ts:74`): title, tool, created/last-used time, resumability, history presence, adoption status and conversationId when adopted. No native session IDs.
- `createSnapshot` in `provider-session-discovery-registry.ts` currently generates new candidate IDs on each scan, invalidating selections. Preserving selection requires stable cross-rescan references without exposing native session IDs. Decide before writing implementation prompts.
- Bound bytes with resumable cursors, not unmodified `boundedRows`, which drops rows without cursors (`supervisor-operations.ts:26`). `provider-session-discovery-registry.ts` `#page` advances by offset plus page length and would skip byte-truncated rows. It must issue a cursor at the first omitted candidate.
- Title bounds are code units, not bytes. A 240-code-unit Chinese title can occupy about 720 UTF-8 bytes (`packages/protocol/src/provider-sessions.ts`), reducing estimated page capacity.
- Cancel by stopping client polling. Retained scans keep their own 60-second deadline. Add no cancellation operation.

Adopt through `provider-sessions.adopt`, one actionId/item. Clients submit bulk selections individually so failures do not affect other imports and can retry independently.

### 3.5 Devices Accessed Through a Computer

For indirect folder.list, forward to that device's Node, adding messages patterned on project_location.validate:

- `folder.list` request: `protocolVersion`, `requestId`, `expectedMachineId`, `expectedNodeId`, optional `path`/`cursor`, `includeHidden`. Add to `AuthenticatedRequestSchema` at `apps/node/src/node-service.ts:87`.
- `folder.listed` response: normalized path/status, optional parent/drives, readable-only folders/skipped/nextCursor, and access_denied optional systemPrivacy.
- Permission/timeout belong in listed status, not `machine.error`, requiring no new error codes. Other validation reuses `machine.error` codes `project_location_path_invalid`, `project_location_missing`, `project_location_not_directory`, `project_location_inaccessible`.
- Node enforces 2 outstanding browsing slots (§3.3). Full slots return `machine.error`, mapped by computer to unavailable / runtime_unavailable. The implementing agent chooses an existing/new wire code after checking `MachineWireErrorCodeSchema` (`packages/machine-transport/src/messages.ts:1730`) and reports it.
- Computer waits longer than Node's 3 seconds so Node can report timeout first.
- Share one listing implementation at a Node-accessible dependency location, separating transport from filesystem-testable logic like `apps/node/src/project-location-validation.ts`.
- Offline device returns unavailable with machine_unreachable or machine_connection_failed, matching `machineUnavailableError` (`host-service.ts:9788`).
- Whole computer/Node frames fit 16 KiB. With path/parent up to 4096 bytes each, derive row budget as §3.3 instead of assuming 12 KiB fits.

### 3.6 Size and Timeouts

- Every request must fit 16 KiB. The largest above, folder.list with 4096-byte path, leaves room.
- Mobile row data fits 12 KiB with continuation at truncation: nextCursor for folder/discovery and nextCursor/hasMore for search. Reuse boundedRows accumulation, not its cursorless row-dropping behavior.
- Search `matchPreview` can be 1024 code units locally. Remote byte-bounded pages may be shorter than requested limit, indicated by hasMore. Encode cursors from the last returned result's ordering key, not requested limit, to avoid skipping omissions.
- Server processing ≤6 seconds leaves room within client 8 seconds. The folder's 3 seconds is an internal wait, not total request duration. Pool protection is in §3.3 and confirmed by Mac tests.
- Discovery's 4-second wait is the only near-limit operation. Do not extend it.

### 3.7 Desktop Browsing Entry

- Adding paired-device projects uses a new local browsing endpoint directly, without Supervisor. Desktop-to-own-Host access does not need another mobile authorization layer.
- Reuse §3.5 listing logic and folder.list response shape.
- Replace the paired-device browsing-unavailable text at `add-project-fields.tsx:193` with browse/manual entry. Manual paths retain Node project_location.validate checks.

### 3.8 Rust Core

Add all 9 operations from §3.1 to `Operation` in `packages/supervisor-mobile/src/wire.rs`, exposing matching UniFFI methods. This layer forwards requests/results without UI.

- Retain data as Value, with interpretation in Kotlin/Swift, matching existing operations.
- Forward failure data.reason. `MobileError::Failure` (`wire.rs:628`) currently carries code/httpStatus only and needs reason for T1b/I1 messages.
- Add optional archived defaultall to conversation.list, preserving T1a's all-record filtering (§3.1), not defaultactive.

## 4. Acceptance

Use development diagnostics or a minimal client, independent of T1b UI.

- **Permission**: view-only connections return operation_not_allowed for each §3.1 operation. Control connections execute them.
- **Browse**: user directory through root/drives, >200 or byte-bounded folders give nextCursor without duplicates/omissions. Hidden default off/on works. Permission denial returns ok true/access_denied. Fake-filesystem traces verify only current-level readdir plus symlink stat, with no child opens.
- **Timeout/limits**: a never-returning fake filesystem yields timeout after 3 seconds. Same-path retry is immediate with no duplicate read. Two blocked reads cause immediate third unavailable/runtime_unavailable, while `project.list`/`conversation.history` keep working. Returning OS calls free slots. Repeat on Node.
- **macOS**, Host and Node separately, Desktop/Documents/Downloads at least once each. Reset Host permissions by app ID with `tccutil reset`, and copy Node to a fresh path without resetting whole system categories.
  - User/root listings do not prompt.
  - First protected navigation returns timeout after 3 seconds and prompts Mac. Allow then retry gives readable.
  - Deny then retry immediately gives access_denied/systemPrivacy true. `chmod 000` under `/tmp` gives access_denied without systemPrivacy.
  - With two permission reads pending, dns.lookup/project.list remain millisecond-scale.
  - Record dialog/settings names and verify §1 messages.
- **Retransmit**: same B4 actionId returns first result, including failure. After Host restart, same-ID create gives created false, remove not_found, adopt already_adopted, and pin/rename/restore success.
- **Add/remove**: added projects appear in project.list. Adding an existing folder returns the same project with `created: false`, without error. Retrying with the same actionId returns the original project/result. Conversations block removal with `conflict` / `reason: project_has_conversations`. Empty projects remove.
- **Discovery**: >4 seconds returns scanning then complete through polling. Disconnect the waiter at 4 seconds and ensure the scan survives. No duplicate scans. Rescan discards snapshot. Expired cursor gives `conflict` / `reason: provider_session_candidate_expired`. Imported candidates are marked, same-ID adopt does not duplicate.
- **Truncation**: folder/discovery nextCursor points at the first omitted row, preventing skips.
- **Search**: title/content queries include `matchedField`. Byte-full pages return hasMore and duplicate-free continuation.
- **Pin/rename/restore**: pin supplies pinnedAt and first ordering, unpin removes the field, titles over 240 code units return invalid_request, restored archives return to Conversations.
- **Indirect devices**: browse/add on an online Node, with unavailable and machine-unreachable-like reason when offline.
- **Mapping**: all reasons already exist in HostErrorCode. Invalid path maps to invalid_request with fallback project_location_invalid.
- **Frame size**: mobile rows ≤12 KiB, requests ≤16 KiB, whole indirect-device frames ≤16 KiB. Verify full search/folder pages.
- Desktop paired-device Add Project supports browse and manual paths.

## 5. Outside B4

- Tablet/iPad UI (T1b/I1). B4 provides interfaces/core methods only.
- Project rename, absent locally (§2).
- Send speed/errors (B3), sharing §3.2 mapping only.
- Notifications/background connectivity (B2).
- Empty conversation after `conversation.create` second-step failure and action.get creation-ID lookup, handled alongside B3.
- One-computer/one-device flattening (E1). Retain local/indirect distinction.
- macOS permission retention after desktop/Node updates. Ad-hoc CDHash changes prompt again (§3.3). Stable signing belongs to U1/E1/distribution decisions. B4 explains through timeout guidance.
- Mobile management presentation (M series). APIs are shared, visible scope decided there.

## 6. Decisions Needed Before Prompts

1. macOS protected-folder behavior was tested 2026-11-05 (§3.3), no longer blocking. Unresolved non-blockers: Host System Settings entry (check in acceptance), unattended upper bound (assume unbounded), dialog screenshots. The installed `/Applications/CodeTether.app` also exited about 0.45 seconds after startup because pre-B1 code met schema 24 data. It was replaced with main on 2026-11-06 (`docs/reviews/mac-install-b1-prompt.md`), unrelated to B4 design.
2. Preserve selections across rescans despite changing candidate IDs, using a non-native stable reference (§3.4).
   - Proposal: no new field. Make candidate IDs stable per Host lifetime using a random in-memory HMAC key over project/machine/tool/native session ID. Truncate to a candidate_ suffix of 16–96 characters (`packages/protocol/src/provider-sessions.ts:24`). Rescans retain IDs/selections, outsiders cannot reverse them, and Host restart changes IDs. The client clears selections and explains that the user must select again.
3. Search currently requires control. Decide whether read-only search can use viewing permission.
   - Proposal: yes, because titles/user content are already readable through `conversation.list` / `conversation.history`. Folder browsing differs by exposing outside-project folders and still requires control.
   - 2026-11-07: §3.1 adopts this proposal. Issuing the B4a prompt confirms it, otherwise request revision.
4. Node.js lacks Windows file-attribute/drive enumeration interfaces in `fs.Stats` and repository code. Stat A–Z can block on disconnected drives (§3.3).
   - Proposal: detect hidden by leading dot or fixed names `$Recycle.Bin`, `System Volume Information`, `$WinREAgent`, `Config.Msi`, `Recovery`, and user `AppData`. Manually hidden exceptions may remain visible, acceptably.
   - Proposal: use one time-bounded system command for drives outside the thread pool, chosen/reported by implementer. Include labels if available without extra work.

## 7. Implementation Rounds

B4 exceeds a single review's size (`docs/DEVELOPMENT-PROCESS.md` §4). Use three sequential branches:

| Round | Contents | Required decision | Prompt |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------ |
| **B4a** | Failure reasons (§3.2), conversation.list pinnedAt/archived, project.create/remove, conversation.pin/rename/restore/search, write-frame checks, Rust methods | §6 item3 | `docs/reviews/b4a-remote-organization-prompt.md` |
| **B4b** | folder.list (§3.3), indirect listing (§3.5), desktop entry (§3.7), Rust methods | §6 item4 | After B4a review |
| **B4c** | provider-sessions.discover/adopt (§3.4), Rust methods | §6 item2 | After B4b review |

T1b/iPad management UI follows after all B4 rounds merge into main.
