# Task: X1b Image Attachments in the Composer (This Computer)

**Where it runs.** On Windows. It needs this computer's installed Codex and Claude Code for real Turns. Goal 9 needs the Mac for one check; ask the Owner to relay it, or run it there yourself.

**Windows-only scope (Owner, 2026-11-18; AD-13).** Goal 9 (the Mac check) is postponed. Keep shared code building on macOS, but accept on Windows only.

**Branch and worktree.** Start from the current `origin/main` after task 5 (D2 model-control integration) and D2.5 (`feat/d2-5-timeline`) have both been merged (fetch first). D2.5 restyles the User message that will show the thumbnails. Create branch `feat/x1b-image-attachments` in worktree `D:/Projects/Software/agenthub-work/feat-x1b-image-attachments`.

**Why this task exists.** The Composer shows a disabled "附件" button. The Owner wants attachments to work (AD-12). The most common need is to show the agent a screenshot: an error dialog, a broken layout, a design. Both Providers accept images; CodeTether's Turn input accepts only text.

**Scope decided in AD-12:**

- **Images only:** PNG, JPEG, WebP and GIF.
- **Conversations on this computer only**, for local Codex and local Claude Code.

Conversations on other computers, and the tablet, phone and iPad, come in a later task. Files that are not images are later too; project files will be referenced with "@" (04 W15).

**References** (read with `git show origin/ux/design:<path>`):

- `docs/reviews/2026-11-13-assessment-and-plan.md`, AD-2 (revised) and AD-12
- `docs/reviews/2026-11-13-desktop-ui-review.md`, finding 3
- `docs/ux-redesign/04-requirements.md` W16 (and W4 for drafts)
- `docs/ux-redesign/10-desktop-improvements.md` §3.3 and the X1 stage in §1 (I3, "Attachment uploads": drag into the Composer, choose with the button, preview)
- `docs/ux-redesign/03-project-plan.md` §6 (invariants)
- `docs/ARCHITECTURE.md` (Protocol v1 boundary, Turn admission, durable Turn records, Search projection)
- `docs/FROZEN-BOUNDARIES.md` (restart-safe `actionId` admission, no automatic Prompt replay, notification privacy, Search indexes only titles and User text)

Before starting, confirm this file has 4 second-level headings and that the last one is "Report".

## Goals

**Must:**

1. **Attaching in the Composer.**
   - The "附件" button opens a file chooser filtered to the four image types.
   - Pasting an image from the clipboard attaches it; this is the screenshot case.
   - Dropping image files onto the Composer attaches them.
   - Each attachment shows as a thumbnail chip with its name and size, and a remove button. It is keyboard reachable, and screen readers announce it.
   - **Limits:** up to 6 images per Turn, each at most 5 MiB.
     - Anything else is refused at once with a plain Chinese reason: another type, an oversize file, more than 6 images.
     - SVG is refused; it can carry script.
   - **Text is still required:** Send stays disabled until there is text. The hint says so ("添加一句说明再发送"). This keeps titles, Search and input history text-based.
   - **Drafts:** an attachment stays with its conversation's draft while the app runs. Losing it on reload is acceptable; say so in the report.
2. **The Host owns the bytes.**
   - An upload endpoint stores each image in a CodeTether-owned folder under the data directory, and returns an attachment id plus its media type, byte size and SHA-256.
   - The Host checks the type from the file's magic bytes, not from the client's header, and enforces the limits again.
   - Identical bytes may be stored once.
   - Turn start references attachment ids.
   - **The durable Turn record keeps attachment metadata only:** id, media type, size and hash. No bytes go into SQLite, the snapshot JSON, the Search projection, logs, notifications or Attention.
   - **Orphans:** an upload that no Turn references is deleted after 24 hours. The Host checks at startup and on later uploads, with no new timer loop.
   - **Retention:** an attachment referenced by a Turn lives as long as the conversation. Removing a project's registration keeps history, so it keeps attachments too.
3. **Serving the image back.**
   - The Host serves an attachment by id, under the same Origin rules as every other route, with:
     - its sniffed type
     - `X-Content-Type-Options: nosniff`
     - an inline disposition
   - An unknown or unreferenced id returns 404.
4. **Providers receive the images.**
   - **Local Codex:** the images reach the Turn through the App Server's image input. Prefer the local-path form, pointing at the Host's stored file.
   - **Local Claude Code:** the images reach the Turn as image content blocks in the stream-json user message.
   - Verify both against the installed versions. A real Turn must show that the agent saw the image: it answers a question only the image can answer. Record that in the report.
5. **Capability is reported, not guessed.**
   - The Host states per conversation whether image input is available: true for local Codex and local Claude Code, false for every other computer.
   - If the model catalog from task 5 reports input modalities, a model without image input turns it off.
   - The Composer shows "附件" only when it is available. Paste and drop do nothing when it is not.
   - No disabled "即将推出" button remains anywhere.
6. **History shows what was sent.**
   - The User message in the timeline shows the images as thumbnails, opening full size in an in-app viewer.
   - Cold conversations and restarts show the same thumbnails.
   - **Retry** of a failed Turn (Phase 6D) sends the same text and the same attachments, as a fresh Turn with a fresh `actionId`.
7. **Restart-safe admission is unchanged.**
   - The same `actionId` after a Host restart still resolves to the one Turn.
   - Reusing an `actionId` with different attachments is refused, as different text is today.
   - Nothing resends a Prompt automatically.
8. **Quality gate:**
   - `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`
   - `pnpm format:check` for changed files
   - tests for:
     - magic-byte checks, including a PNG renamed `.jpg`, an SVG and a truncated file
     - limits
     - orphan cleanup
     - the 404 cases
     - the durable record holding no bytes
     - both adapters' input encoding from fixtures
     - capability gating
     - retry carrying attachments
     - `actionId` reuse with different attachments
     - the migration, if there is one, on a copy of an existing database

**Should:**

9. **On the Mac:** paste and drop work in the signed app's WKWebView, and one real Turn with an image succeeds on each installed Provider there.
10. **Drop feedback:** the Composer shows a drop target while files are dragged over it, and a drop of non-image files explains why nothing was attached.

## Known facts

Line numbers refer to `4801ef1`.

- **Turn input.**
  - `packages/protocol/src/records.ts:229-241` (`TurnInputSchema`) is strict: `{ type: 'text', text }`, 1 to 1 MiB of non-whitespace text.
  - `StartTurnRequestSchema` (`commands.ts:547-552`) is `{ actionId, input }`, also strict.
  - An older Host rejects an unknown field. That is why goal 5 gates on a Host-reported capability.
- **The HTTP boundary's default body limit** is 64 KiB (`apps/host/src/api/http-boundary.ts:19`). Check the per-route limits before choosing how uploads are sent.
- **Codex.**
  - The local adapter sends `turn/start` with one text item (`packages/adapter-codex/src/client.ts:376-387`, and again at `:452`).
  - The App Server's input union also has image forms, including a local-path form. The adapter's tests already contain one (`packages/adapter-codex/test/client.test.mjs:820`, from native session history).
  - Take the exact shape from the installed Codex's generated schema.
- **Claude Code.**
  - The adapter writes one stream-json line, `{ type: 'user', message: { role: 'user', content: prompt } }` (`packages/adapter-claude/src/process.ts:191-193`).
  - The prompt is capped at `MAX_CLAUDE_PROMPT_BYTES = 1 MiB` (`process.ts:30`, checked at `:186`).
  - Base64 images make the line much larger, so that bound and the stdin delivery path must account for it.
  - Claude's API limits a single image to 5 MB, which is where goal 1's limit comes from.
- **The restricted Claude profile** (Read, Glob and Grep only, `dontAsk`) is frozen. Images need no new tool.
- **Retry.** `apps/web/src/components/conversation/use-live-conversation-controls.ts:121-147` rebuilds the input from the User message's text only. As written, it would drop attachments.
- **Search** indexes titles and canonical User text only (migration 006). Attachments must not enter it.
- **Notifications** carry only the Attention type, project name and conversation title (frozen). Attachments must not enter them.
- **Drag and drop in the desktop shell.** Tauri's window-level drag-and-drop handling can intercept file drops before the web page sees them. Check how `apps/desktop/src-tauri/tauri.conf.json` and the platform configs set it, and prove a drop reaches the Composer in the real desktop app, not only in the browser.
- **The file chooser.** A plain web file input works in WebView2 and WKWebView without a new native command. The frozen native boundary grants exact commands only, so prefer the web input.
- **Migrations.** Task 5 uses 026, and X1a may take the next number. Use the next free one at the time you start. If you need one, one is enough.
- **The Composer** after task 5 has the model control in its top bar. Add "附件" to the action bar, where 10 §3.3 places it.

## Boundaries

- **Decide yourself:**
  - the upload API's shape and route
  - the storage layout and file naming
  - whether a migration is needed and its layout
  - the thumbnail and viewer components
  - how the Turn record references attachments
  - test changes and commit splitting
- **Ask the Owner first:**
  - non-image types
  - any change to conversations on other computers, the Phase 6 Node, Supervisor operations, or the mobile layers
  - a new native (Tauri) command or permission
  - limits above those in goal 1
  - a second migration
  - replacing the installed desktop app
- **Do not:**
  - send attachment bytes or their paths to anything except the owning Provider on this computer
  - index or log them
  - auto-resend a Turn
  - edit `AGENTS.md` or `docs/`
  - push `main`, merge or tag
  - read or print credentials

Push `feat/x1b-image-attachments` to `origin`.

## Report

Write to `D:/Projects/Software/agenthub-archive/x1b-image-attachments-report.md`, with screenshots in `D:/Projects/Software/agenthub-archive/x1b-image-attachments/`:

- **Contract:** the protocol changes, the upload and serve routes, the Turn record shape, the migration (if any), and what an older client or Host does with each.
- **Providers:** the exact input shape sent to each, quoted from the installed versions' schema, and the real Turn showing that each agent saw the image.
- **Security:** the magic-byte checks, the headers, the Origin handling, and proof that no bytes reach SQLite, Search, logs or notifications.
- **Screenshots:** chips in the Composer (one image, six images, a refusal), the timeline thumbnails, the viewer, a cold reload, and the Composer for a conversation on another computer (no "附件"), in light and dark themes.
- **Mac:** goal 9 results, or why they are missing.
- **Gates:** results for each check, with failures quoted verbatim.
- **Commits:** your commits and the pushed remote commit.
- **Status:** anything not done and why, and the completion level reached.
