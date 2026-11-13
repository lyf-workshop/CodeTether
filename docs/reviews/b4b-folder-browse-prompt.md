# Task: B4b Folder Browsing (Remote Management, Round 2)

Run the entire task on Mac to test macOS TCC permission behavior on a real system. Continue from `main` (currently `4801ef1`). B4b implements `folder.list` so tablets and iPads can browse remote folders and choose a folder when adding a project instead of typing its path. Commit and push to `feat/b4b-folder-browse`. Do not push `main`, merge, or tag.

References (read each with `git show`):

- `docs/ux-redesign/08-remote-management.md` §3.3 (`folder.list` design), §3.5 (devices accessed through a computer), §3.7 (desktop browsing entry), and §6 item 4 (Windows hidden folders and drive letters).
- `docs/ux-redesign/06-pairing-remote-control.md` §1: UI wording rules.

Before starting, confirm this file has 4 second-level headings and the final section is "Report".

## Goals

**Required**:

1. **Implement `folder.list` on the Host**:
   - Add the Supervisor operation `folder.list` (read-only, but requiring control permission).
   - Request: `machineId`, optional `path` (the user directory if omitted), optional `cursor`, optional `includeHidden` (false by default).
   - Response: `path`, `status` (`readable`/`access_denied`/`timeout`), optional `parent`, optional `drives` (at a Windows root). A `readable` response includes `folders`, `skipped`, and optional `nextCursor`. `access_denied` may include `systemPrivacy`.
   - Timeout: 3 seconds. Return `status: timeout` instead of failing the request.
   - Insufficient permission: return `status: access_denied`. Include `systemPrivacy: true` for macOS `EPERM`.
   - Hidden folders: names starting with `.`, or on the fixed list (`$Recycle.Bin`, `System Volume Information`, `$WinREAgent`, `Config.Msi`, `Recovery`, and `AppData` under the user directory). Return them with `hidden: true` when `includeHidden` is true.
   - Return at most 200 folders per level, also truncating by byte budget, whichever limit is reached first. Skip individual names exceeding 255 bytes and count them in `skipped`.
   - Symbolic links require `stat` to determine whether they are folders. Count this as a read.
   - **Do not open child folders**. List only the current level and omit per-folder accessibility checks.

2. **Limit concurrency to avoid blocking the libuv thread pool**:
   - Host and Node each allow at most 2 outstanding browsing reads.
   - If a read is already outstanding for the same normalized path, immediately return `status: timeout` instead of waiting for a second one.
   - When all slots are occupied, fail new requests immediately with `code: unavailable`, `reason: runtime_unavailable`.
   - See the full analysis in 08 §3.3, "Must not block other reads and writes".

3. **Cursors**:
   - Format: `fld_` plus a suffix, tied to the path and `includeHidden` parameters.
   - Valid only within one listing. Do not persist long-lived state.
   - Restart from the beginning of the current level after expiry.

4. **Frame size**:
   - Row data returned to phones and tablets must be ≤ 12 KiB.
   - The whole frame returned from Node to the computer must be ≤ 16 KiB (`path` and `parent` may each reach 4096 bytes, plus the envelope).
   - Calculate these budgets separately. Do not reuse the 12 KiB budget unchanged.

5. **Windows drives** (08 §6 item 4):
   - Include `drives` when listing a root. Each entry has `letter` (such as `C:`) and optional `label`.
   - Do not `stat` A–Z individually. Disconnected network drives can block threads.
   - Use one time-bounded system command to obtain drives without using the thread pool. Choose the command and explain it in the report.
   - Include `label` if available from the same operation, otherwise omit it.

6. **Windows hidden folders** (08 §6 item 4):
   - `fs.Stats` has no Windows file attributes, and no ready-made interface is available.
   - Determine hidden status by name only: a leading `.`, or the fixed list from item 1.
   - A few folders manually marked hidden by users will remain visible. This is acceptable.

7. **Devices accessed through a computer** (08 §3.5):
   - For a tablet/iPad `folder.list` request whose `machineId` identifies a remote device, forward the request through the computer to its Node.
   - Implement `folder.list` on Node with the same logic as Host.
   - The computer forwards tablet requests to Node and returns Node responses to the tablet.

8. **Rust core method**:
   - Add `folder_list` to `packages/supervisor-mobile/src/lib.rs`, exposed through UniFFI.
   - Add the corresponding Kotlin call.
   - iOS Swift currently has no repository. Document the interface signature in the report only.

9. **UI wording rules** (06 §1, 08 §1):
   - Do not expose technical terms such as Host, Node, Machine, Supervisor, or Relay in the UI.
   - Follow 08 §1 for error messages, for example:
     - macOS system denial (`systemPrivacy: true`): "You do not have permission to open this folder. In Mac System Settings › Privacy & Security › Files and Folders, allow CodeTether access, then retry."
     - macOS timeout: "A permission dialog may be open on the Mac. Click Allow on the Mac, then retry."
     - General insufficient permission: "You do not have permission to open this folder."
     - Timeout on other systems: "Reading this folder timed out. It may be a network drive. You can retry."
     - All slots occupied: "This computer is waiting for permission or other folder reads. Try again shortly."

**Expected**:

10. **Desktop browsing entry** (08 §3.7):
    - Allow browsing folders when adding a project for a paired device, as for local projects.
    - Retain manual path entry as a supplement to browsing.
    - Location: `apps/web/src/components/projects/add-project-fields.tsx:193`.

## Known Facts

- Paired devices currently require a complete path (`add-project-fields.tsx:193`).
- Node only validates an individual path with `project_location.validate`. It cannot list directories.
- The libuv thread pool defaults to 4 threads shared by the whole process (see 08 §3.3, "Must not block other reads and writes").
- macOS TCC permissions: Host is the desktop application's sidecar, while Node is a separate launchd service. Their permissions are recorded separately (08 §3.3).
- This round runs on Mac, allowing real testing of macOS permission dialogs.

## Boundaries

**Decide independently**:
- The Windows drive-discovery command (`wmic`, `Get-PSDrive`, `vol`, or another command), explaining the choice in the report.
- Cursor implementation, such as an in-memory cache or HMAC.
- Forwarding for devices accessed through a computer.

**Ask the user first**:
- Changing infrastructure outside `main`.
- Changing frozen Phase boundaries.

**Do not**:
- Implement `provider-sessions.discover` or `provider-sessions.adopt` (B4c).
- Implement T1b or iPad Add Project UI before all three B4 rounds merge into `main`.
- Read or print credentials.
- Push `main`, merge, or tag.

## Report

Append to `~/agenthub-archive/b4b-report.md` (a new file):

- Changes and corresponding commits for items 1–10.
- Windows drive-discovery command and reasons for choosing it.
- Real macOS TCC results, including folders that trigger dialogs and whether Node requires separate permission.
- Measured frame sizes (folders per level within 12 KiB and the Windows drive-list size).
- Concurrency-limit implementation, including counter ownership and release.
- Rust function signature for subsequent iOS work.
- Kotlin call-layer changes.
- typecheck / lint / Rust / Android / build / test results.
- Remote commit after pushing.
- Unfinished work and reasons.
