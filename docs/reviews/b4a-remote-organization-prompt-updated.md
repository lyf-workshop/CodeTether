# Task. B4a remote organization (remote management round 1), including projection policy

Run on Windows or Mac. Continue from `main` (currently `b668e53`). B4 gives tablets/iPads the computer's remaining management operations in three rounds. This first round covers error reasons, `conversation.list` `pinnedAt` and `archived`, remote project add/remove, conversation pin/rename/restore, and search. **Addition.** If `project.create` may exceed 16 KiB, return a target-device projection. Push to `feat/b4a-remote-organization`, without pushing `main`, merging, or tagging.

References (read using `git show`).

- `docs/ux-redesign/08-remote-management.md`, full seven-section design. B4a covers §§3.1, 3.2 and the first row of §7.
- B4 row in `docs/ux-redesign/03-project-plan.md` §4.
- Copy rules in `docs/ux-redesign/06-pairing-remote-control.md` §1.
- This prompt's "Projection policy" section.

Before starting, confirm this file has four second-level headings and the last section is "Report".

## Goals

**Required.**

1. **Failure reasons** (08 §3.2).
   - Extend Supervisor response frames with `reason`.
   - Use a subset of `HostErrorCode` (`packages/protocol/src/errors.ts`).
   - Preserve `code` and `reason` when mapping local `HostError` to Supervisor responses.
   - Add optional, backward-compatible `reason` to the phone/tablet Rust core.
   - Kotlin and Swift clients use `reason` for more precise error messages.

2. **`conversation.list` `pinnedAt` and `archived`** (08 §2).
   - Add `pinnedAt` to `SupervisorConversationDirectoryItem`.
   - Query `pinned_at` in `listSupervisorConversations`.
   - Sort pinned first (`pinnedAt DESC`), then `last_activity_at DESC`.
   - Add `archived` values `active`, `archived`, `all`, default `active`.

3. **Remote operations** (08 §3.1).
   - `project.create` reuses `createProject` locally or `createRemoteProject` for another device.
   - `project.remove` rejects projects with conversations using `project_has_conversations`.
   - `conversation.pin` requests desired `pinned` state rather than toggling.
   - `conversation.rename` allows 1–240 code units, at most 160 graphemes, NFC-normalized.
   - `conversation.restore` succeeds with the current conversation if already unarchived.
   - `conversation.search` allows 256 code units/160 graphemes, default page 25, maximum 100.

4. **Permission gates** (08 §3.1).
   - `project.create`, `project.remove`, `conversation.pin`, `conversation.rename`, and `conversation.restore` require control.
   - `conversation.search` requires read only (confirmed in 08 §6 item 3).
   - Include control operations in `isSupervisorControlOperation` (`packages/supervisor-transport/src/server.ts:710`).

5. **`actionId` idempotency** (08 §3.1).
   - `project.create` scope is global `'project.create'` locally and `project.remote.create:<machineId>` remotely.
   - `project.remove` scope is `project.delete:<projectId>`.
   - Pin, rename, and restore are conversation-scoped as locally.
   - Same actionId returns the first result. Use a new actionId after definitive failure.

6. **Write response frame checks** (08 §2).
   - Response `data` fits a 16 KiB frame.
   - Keep the 12 KiB row budget (`maximumRowsBytes` at `supervisor-operations.ts:20`).
   - **Add the projection policy** below.

7. **Rust methods** (08 §3.1).
   - Add corresponding UniFFI functions in `packages/supervisor-mobile/src/lib.rs`.
   - Kotlin (`apps/android/app/src/main/kotlin/org/codetether/supervisor/`) and Swift (`apps/ios/Sources/CodeTether/`) call them.

8. **Copy rules** (06 §1, 08 §1).
   - UI excludes Host, Node, Machine, ProductDevice, Supervisor, Relay, authorization, grant, and fingerprint.
   - Errors explain what happened and what to do.

---

## Projection policy (addition)

### Problem

Full `Project` from `project.create` can exceed 16 KiB in extreme cases.
- Up to 64 locations per project, each path 4096 bytes.
- Theoretical maximum 64 × 4096 ≈ 260 KiB >> 16 KiB.

### Decision

Supervisor may return a **projection containing the target device's location** when oversized, marked with `_projection`.

### Implementation details

**Response structure** for oversized `project.create`.

```typescript
{
  project: {
    projectId: "proj_xxx",
    name: "my-project",
    // ... basic fields (displayName, createdAt, etc.)
    locations: [
      {
        machineId: "target-machine-id",  // target device's location only
        path: "/path/to/project",
        availability: "available",
        // ... other required fields
      }
    ],
    // New projection marker
    _projection: {
      type: "target_location_only",      // identifies this as a projection
      reason: "frame_size_exceeded",     // projection reason
      completeSizeEstimate: 260000,      // estimated complete project bytes
      omittedLocationCount: 63           // omitted location count
    }
  },
  created: true,
  location: { ... }  // target device location detail
}
```

**Protocol extension** (`packages/protocol/src/commands.ts`).

```typescript
export const CreateRemoteProjectResponseSchema = z.object({
  project: ProjectSchema.extend({
    _projection: z.object({
      type: z.enum(['complete', 'target_location_only']),
      reason: z.enum(['frame_size_exceeded']).optional(),
      completeSizeEstimate: z.number().optional(),
      omittedLocationCount: z.number().optional(),
    }).optional(),
  }),
  location: RemoteProjectLocationSchema,
  created: z.boolean(),
})
```

**Client behavior.**

- `_projection.type === 'target_location_only'` means successful creation with only the target location shown.
- Immediately load the complete project in the background with `project.detail`.
- Show successful creation while locations load progressively, without interrupting UX.

**Measured data.**

- Typical projects (1–8 locations), complete response < 1 KiB, always complete.
- Large projects (8–16 locations), < 8 KiB, always complete.
- Extreme projects (64 locations), ~260 KiB, projected.

### Differences from local behavior

| Dimension | Local `createProject` | Remote `project.create` |
|------|-----------------|-----------------|
| Complete project | Always | Usually, projected when oversized |
| Projection marker | None | `_projection` field |
| Frame limit | None | 16 KiB |
| Client experience | All locations immediately after creation | Target location first, others loaded afterward |

**Projection is rare.** Extreme 64-location projects are estimated below 0.1% of users, but the protocol must handle them instead of returning `internal`.

---

## Known facts

- Baseline `main` `b668e53`.
- Remote operations use Supervisor `supervisor.request`, distinguished by `operation`, protocol version 1.
- B1 schema is `supervisorB1OperationSchema` (`packages/supervisor-transport/src/protocol.ts:372`).
- Local execution is `executeSupervisorB1Operation` in `apps/host/src/api/supervisor-operations.ts:71`.
- Permission is either `supervisor_read` or `supervisor_control`.
- Mutations carry `actionId`, `act_` followed by 6–96 characters.
- Host `#executeAction` deduplicates by actionId.

- Response frames (`protocol.ts:517`) contain only `ok`, `data`, `code`, and `httpStatus`.
  - Eight `code` values are `invalid_request`, `operation_not_allowed`, `not_found`, `conflict`, `unsupported`, `unavailable`, `session_expired`, and `internal`.
  - `httpStatus` allows only 409 or 422, and only with `unsupported`.
  - Errors are flattened. Failure construction at `server.ts:646` keeps only `code`. B4a adds `reason`.

- Size limits.
  - Phone/tablet Rust requests are at most 16 KiB with an eight-second wait.
  - Actual Supervisor frame limit is 16 KiB.
  - Row data is bounded below 12 KiB.

- Existing local operations absent remotely.
  - Add project `createProject` (`host-service.ts:3266`) and `createRemoteProject` (:2393).
  - Remove project `deleteProject` (`host-service.ts:3290`).
  - Search `searchProjectConversations` (`host-service.ts:2524`).
  - Pin/unpin/rename/restore `pinConversation` (:3108), `unpinConversation` (:3127), `renameConversation` (:3088), `unarchiveConversation` (:3176).

- Conversation directory lacks pin state. `SupervisorConversationDirectoryItem` has no `pinnedAt`, and `listSupervisorConversations` does not query `pinned_at`.

## Boundaries

**Decide independently.**
- Implementation.
- Commit breakdown, one or more per item with tests.
- Tests and screenshots.
- Exact `reason` subset from `HostErrorCode`.
- Projection frame threshold (currently 16 KiB, adjustment uncertain, keeping it is recommended).

**Ask the user first.**
- Supervisor protocol version changes (extensions usually need a version bump).
- Public phone/tablet Rust API (UniFFI definition) changes.
- Whether projection is implemented now or deferred until real oversize occurs (implementing now is recommended).

**Do not do.**
- Read or print credentials.
- Push `main`, merge, or tag.
- Force-push.
- Folder browsing (B4b).
- Discover/import earlier conversations (B4c).

## Report

Append to new `~/agenthub-archive/b4a-report.md` with these sections.

- Base commit and confirmation all seven sections of 08 were read.
- Changes and commits for items 1–8.
- Protocol details (`reason` subset, version change, `_projection` implementation).
- Measured response sizes for different project sizes.
- Rust unit/integration results.
- Node.js typecheck/lint/unit/integration results.
- Kotlin and Swift handling of `_projection`.
- Remote commit after pushing.
- Remaining work, reasons, and completion level.

---

## Outside this round

- `folder.list` browsing, B4b.
- `provider-sessions.discover` and `provider-sessions.adopt`, B4c.
- Tablet/iPad remote-management UI, after all B4 rounds merge into `main`.
