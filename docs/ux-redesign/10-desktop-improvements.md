# 10 · Desktop Experience Improvements (D2)

Date — 2026-11-09. Based on the five core issues you raised after using D1 (`v0.1.0-alpha.2`), requirements in 04, the desktop v4 prototype, and the tablet design in 07.

## 0. Background

D1 shipped as `v0.1.0-alpha.2`, with account, project, conversation, Codex/Claude Code execution, Inbox, approval, archive and search, notifications, and background tray functionality. Actual use revealed five core experience issues affecting everyday efficiency and usability. They require product UI and interaction redesign rather than small fixes.

D2 addresses these five issues to make desktop suitable for everyday use.

Note (2026-11-13): file paths in this document such as `apps/web/app/(main)/devices/page.tsx` are illustrative Next.js-style names. The web app is Vite with TanStack Router; the real components live under `apps/web/src/components/` (for example `apps/web/src/components/conversation/composer.tsx`).

## 1. Five Core Issues

### I1. The Machine Concept Is Exposed to Users

**Current problems**
- The UI shows a Machine hierarchy, with multiple Machines under one physical computer.
- Users see technical architecture instead of “My computer → My projects.”
- Abstract concepts add cognitive overhead.

**User expectations**
- A computer directly displays its projects.
- Users do not need to understand Machine, Node, or Host terminology.
- A flat Computers › Projects › Conversations hierarchy.

**Improvement goals**
- Hide the Machine layer completely in the frontend, showing only computers.
- Group the Devices page and project selector by physical computer.
- Preserve backend architecture and the frozen Machine boundary in AGENTS.md.

**Boundaries**
- How multiple Machines on one physical computer, such as WSL and Windows, should appear remains undecided.
- Remote devices accessed through another computer still have independent computer sections.
- Machine and Node terminology appears only in developer tools and debugging interfaces.

---

### I2. Insufficient Differentiation Between Codex and Claude Code

**Current problems**
- Both Providers use the same UI without reflecting their characteristics.
- Codex supports full file editing, Shell, and approval, while Claude has read-only Tools.
- The UI does not explain why users should choose Codex or Claude.
- Users cannot determine which tool is appropriate.

**Capability differences** (frozen boundaries)
- **Codex, local** supports conversation, file editing, Shell, approval, stop, changes, and Terminal output.
- **Codex, remote** supports conversation and changes from read-only history.
- **Claude Code, local and remote** supports conversation, read-only file tools (Read/Glob/Grep), and effort selection, without approval, stop, or editing.

**Improvement goals**
1. **Explain the differences when creating a conversation**
   - Tool cards list core capabilities using icons and short descriptions.
   - Unavailable capabilities appear gray or labeled unsupported.
   - Provide suggested use cases, such as “Choose Codex to modify code, or Claude for read-only analysis.”

2. **Adapt conversation pages to the Provider**
   - Claude Code conversations hide approval cards and Stop.
   - Distinguish panel titles as File Changes for Codex and Viewed Files for Claude.
   - Differentiate editing and read-only Tool cards in the Timeline.

3. **Identify Providers**
   - Add the Provider icon and name to the conversation title bar.
   - Show Provider type in every conversation list row.

**Important** — Using Codex or Claude within CodeTether should feel consistent with their respective native applications. Dynamically adjust elements to Provider capabilities within the common UI.

**Exclusions**
- Do not give Codex and Claude separate theme colors or page layouts.
- Preserve a unified design language while adjusting feature visibility.

---

### I3. The Composer Needs Rebuilding

**Current problems**, compared with ChatGPT Desktop, Codex CLI, and Kiro
- Composer is a simple input and send button fixed at the bottom.
- It has no entries for model selection, voice, attachments, or multimodal input.
- Multiline input lacks good automatic expansion and shortcuts.
- Current context limits and remaining capacity are not visible.

**Reference, ChatGPT Desktop**
- Model selection, such as GPT-4 and o1.
- Adjustable reasoning effort.
- A hold-to-speak voice button.
- Attachment and image uploads.
- Multiline input that expands up to half the screen.
- Possibly a Full Access permissions toggle.

**Improvement goals**

**First stage (D2.1) — Basic Composer Rebuild**
1. **Enhanced multiline input**
   - Automatic height from at least two lines to 40% of the viewport.
   - Shift+Enter for newlines, with configurable Enter or Ctrl+Enter sending.
   - Input history using up/down arrows for earlier messages.
   - Automatic drafts restored when switching conversations.

2. **Provider and model display and switching**, aligned with native apps
   - Show Provider and model at the top left, such as “Codex · GPT-4” or “Claude Opus 5.5.”
   - Clicking opens a model-selection dropdown.
     - Codex lists available OpenAI models such as GPT-4 and o1.
     - Claude lists available Claude models such as Opus and Sonnet.
   - Claude supports adjustable reasoning effort.
   - Show remaining context as a progress indicator and percentage.

3. **Quick actions**
   - Clear input with Esc.
   - Copy the previous turn's input with Ctrl+Up.
   - Reference files or context with @ if supported by the protocol.

**Required protocol extensions**
- Model switching within a conversation requires a new Protocol v1 interface.
- Provider and model are currently fixed at creation. Add `conversation.updateModel` or an equivalent interface.
- Alternatively, allow per-message model overrides.

**Second stage (X1, after M2) — Advanced Features**
4. **Voice input**
   - Hold the microphone button to speak and transcribe on release.
   - Use system speech recognition APIs or Whisper integration.
   - Support Chinese and English.

5. **Attachment uploads**, if supported by the protocol
   - Drag files into Composer.
   - Choose files with the attachment button.
   - Preview attached files.

6. **Permission controls**, corresponding to Full Access in 04
   - Switch Approval mode among Always Ask, Read Only, and Full Access.
   - Show the current permission level in Composer.

**Third stage (later) — Editing and Export**
7. **Edit sent messages**
   - Add Edit next to each User message.
   - Regenerate the conversation from the edited message.
   - Mark the original message Edited.

8. **Export conversations**
   - Export Markdown, HTML, and PDF.
   - Include complete messages, code blocks, and Tool calls.
   - Preserve syntax highlighting and formatting.

---

### I4. Pairing Speed

**Current problems**
- Pairing takes too long, with exact duration still to be measured.
- Users wait a long time after entering a pairing code.

**Improvement goals**
- Complete pairing within one to three seconds.
- Optimize the bottlenecks.

**Measurements required first**
1. Total time from code entry to successful pairing.
2. Time spent in each stage.
   - Frontend submission to backend receipt.
   - Backend code validation.
   - TLS handshake if using Relay.
   - Database writes for trust and endpoint records.
   - Frontend confirmation through polling or SSE.

**Possible optimizations**
- Reduce TLS handshakes or use session resumption.
- Write asynchronously, returning success before background persistence.
- Replace frontend polling with SSE.
- Simplify code validation by removing unnecessary checks.

**Undecided**
- Which stage is the bottleneck? Real measurements are required.
- Is asynchronous “Pairing in progress” acceptable, showing the device first and marking it Connecting?

---

### I5. Conversation Interaction Redesign (Timeline Styling)

**Current problems**, compared with Codex CLI and Kiro
- The Timeline is too compact and difficult to read.
- Code blocks lack line numbers, clear syntax highlighting, and discoverable copying.
- Tight message spacing causes fatigue in long conversations.
- Collapse, expansion, and scroll-position controls may be missing.

**References, your images 5 and 6**
- Image 5 is the current tablet's compact, tightly spaced presentation.
- Image 6 is the Codex/Kiro desktop style, with more spacing, clear code blocks, and potentially line numbers, copying, and collapsing.

**Improvement goals**

**First stage (D2.5) — Timeline Restyling**
1. **Spacing and layout**
   - Increase message spacing from 12px to 20px.
   - Distinguish User and Agent messages by background or alignment.
   - Increase maximum width from 740px to 800px.

2. **Enhanced code blocks**
   - Optional line numbers.
   - Language label at the top right.
   - Copy on hover, with Copied feedback.
   - Syntax highlighting through Prism or highlight.js.
   - Horizontal scrolling without wrapping long lines.

3. **Collapse long content**
   - Collapse code blocks longer than 30 lines by default, showing “Expand N lines.”
   - Collapse Terminal output beyond 500 lines, showing a summary.
   - Save collapse state in localStorage.

4. **Tool cards**
   - Distinct icons and colors for reading, searching, and editing.
   - Red borders and error reasons for failed Tools.
   - Group consecutive file reads.

5. **Scrolling and navigation**
   - Jump to Latest when away from the bottom.
   - Jump to a specific turn when arriving from Inbox or a notification.
   - Sticky conversation title bar during scrolling.

**Second stage (D2.5+) — Advanced Interactions**
6. **Message actions**, for later implementation
   - Edit sent messages and regenerate from that point.
   - Delete individual messages.
   - Copy message text.
   - Reference a message through @ in new input.

7. **Enhanced Diff view**
   - Sidebar overview showing changed files.
   - Inline diffs highlighting only changed characters.
   - Accept This Change, if supported by the protocol.

8. **Conversation export**, for later implementation
   - Markdown, HTML, and PDF.
   - Complete messages, code blocks, and Tool calls.
   - Preserved syntax highlighting and formatting.

---

## 2. Priorities and Dependencies

### Stage Breakdown

| Stage | Improvements | Estimated Effort | Dependencies | Notes |
| ------ | ------------------- | ---------- | ------------------------ | -------------------------------------- |
| D2.1 | I1 (flatten computer hierarchy) + I3.1 (basic Composer) | Medium | None | Address the two issues with the greatest impact on daily use first. |
| D2.2 | I2 (Provider differentiation) | Small | D2.1 | Local changes to creation and conversation pages. |
| D2.5 | I5 (Timeline rebuild) | Large | D2.1 | Broad conversation-interaction improvements, with the largest scope. |
| D2.4 | I4 (pairing speed) | Undecided | Bottleneck measurement | Measure first, then choose optimizations and estimate effort. |
| X1 | I3.2 (voice/attachments) | Large | D2.1, protocol extensions, after M2 | Advanced input features developed alongside mobile. |

### Implementation Order

**First batch (D2.1)**
1. I1, flatten the computer hierarchy.
2. I3.1, rebuild the basic Composer.

**Second batch (D2.2)**
3. I2, differentiate Providers.

**Third batch (D2.5)**
4. I5, restyle the Timeline.

**Independent optimization (D2.4)**
5. I4, measure pairing speed before scheduling improvements.

**Longer term (X1)**
6. I3.2, voice input and attachments after M2.

---

## 3. Detailed Design

### 3.1 Flatten the Computer Hierarchy (I1)

#### Frontend Changes

**Devices (`/devices`)**
- Remove the Machine term and hierarchy.
- Each physical computer has one card.
  - Title is its name, such as “Windows desktop” or “Mac mini.”
  - Subtitle combines online status and connection method, such as “Online · Same network” or “Online · Over internet.”
  - Card details include the following.
    - Operating system and architecture, such as “Windows 11 · x64.”
    - One status row each for Codex and Claude Code.
    - Project count, such as “3 projects.”
  - Clicking opens that computer's details.

**Device details (`/devices/:computerId`)**
- Top shows computer name, online status, and system information.
- First section lists projects, with one card per project showing its name, path, and recent activity.
- Second section shows the latest 10 conversations in time order.
- Third section shows AI tool installation and execution states for Codex and Claude Code.
- Fourth section shows connection method and last online time.
- Bottom contains Add Project and, for local computers, Pair New Device.

**New Conversation (`/conversations/new`)**
- The first step, Select Project, follows these rules.
  - Group by computer, such as This Computer and Mac mini.
  - List each computer's projects beneath its heading.
  - Offline computers and projects are gray and unselectable.

**Conversation lists and search**
- Device fields show computer names.
- Search results also group by computer name.

**Edge cases**
- Multiple Machines on one physical computer, such as Windows and WSL, behave as follows.
  - Display as separate computers named “Windows desktop” and “Windows desktop (WSL).”
  - Projects and conversations belong to their respective Machines.
  - Users can clearly identify Windows projects and WSL projects.

#### Backend Remains Unchanged

- Preserve the Machine table and projects' and conversations' `machine_id` fields.
- Preserve Protocol v1 `/machines` interfaces.
- Aggregate Machines with the same `computer_id` for frontend display.

#### Terminology Mapping

| Backend or Code | Frontend Display |
| ------------- | -------------- |
| Machine | Hidden |
| Computer | Computer |
| Node | Hidden |
| Local Machine | This computer |
| Remote Machine | Computer name |

---

### 3.2 Provider Differentiation (I2)

#### New Conversation Page

**Tool cards**, replacing the existing Picker with a card list
- Codex card follows these specifications.
  - Icon is `>` (terminal).
  - Title is **Codex**.
  - Subtitle is “Full development capabilities.”
  - Capability list has icons.
    - ✅ Edit files
    - ✅ Execute commands
    - ✅ Approval confirmation
    - ✅ View changes
  - Suggested use case is modifying code, running commands, and installing dependencies.
  - Availability states follow.
    - Available cards have a blue border and can be clicked.
    - Unavailable cards are gray, with Not Installed or Not Signed In as the subtitle.

- Claude Code card follows these specifications.
  - Use the Claude icon.
  - Title is **Claude Code**.
  - Subtitle is “Read-only analysis and conversation.”
  - Capability list has icons.
    - ✅ Read files
    - ✅ Search content
    - ✅ Reasoning effort
    - ❌ Edit files
    - ❌ Execute commands
  - Suggested use cases are code review, understanding projects, and answering questions.
  - Availability styling matches the preceding rules.

**Reasoning effort selection**
- Show only for Claude Code.
- Use a segmented control or slider.
- Low, Medium, and High map to Claude effort.

#### Conversation Page

**Title bar**
- Add a Provider icon on the left, using `>` for Codex and the Claude icon for Claude.
- Show the Provider name beneath the title, such as Codex or Claude Opus 5.5.

**Timeline**
- Codex edits use blue file, terminal, and Shell icons.
- Claude Code's read-only operations use gray Read, Grep, and Glob icons.
- Approval cards appear only for Codex.

**Changes panel titles**
- Codex uses “File changes (3).”
- Claude Code uses “Viewed files (2).”

**Running status strip**
- Codex shows Stop.
- Claude Code hides Stop and explains “Claude Code does not support stopping.”

---

### 3.3 Basic Composer Rebuild (I3.1)

#### Layout

```
┌────────────────────────────────────────────────────────────────────┐
│ Codex · GPT-4                                                 [▼]  │  ← Provider information bar
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│ [Input field, at least 2 lines, up to 40% of the viewport]          │
│                                                                    │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│                              Characters 125                  [Send] │  ← Action bar
└────────────────────────────────────────────────────────────────────┘
```

Changed 2026-11-13 (AD-2 in `docs/reviews/2026-11-13-assessment-and-plan.md`). The 03 §6 invariant applies: the interface only shows capabilities the backend really provides. The earlier layout showed three placeholders:

- remaining context
- Attach
- Voice

They are not shown greyed out once a real control exists. Revised 2026-11-14 (AD-2 revised, AD-12): the Owner wants all three built. Until then they stay on `main` as they are, and tasks X1a (remaining context), X1b (image attachments) and X1c (voice) each replace one with a working control.

#### Functional Details

**Provider information bar**
- Left shows Provider icon, name, and model.
- Right contains the model and effort control when the Provider supports model switching (D2 model control). Otherwise it is absent.
- Remaining context ("剩余 N%") appears here once a Provider reports real context usage (X1a). When no value is known, there is no label and no empty indicator.

**Input field**
- Initial height is two lines, approximately 48px.
- Expand automatically when input exceeds two lines.
- Maximum height is 40% of the viewport, approximately 300–400px.
- Scroll internally beyond that height.
- Placeholders depend on Provider.
  - Codex uses “Tell Codex what to do…”
  - Claude uses “Ask Claude a question…”

**Shortcuts**
- Enter sends, configurable as Ctrl+Enter in Settings.
- Shift+Enter inserts a newline.
- Ctrl+Up copies the previous turn's input.
- Esc clears input.
- Ctrl+K opens the command palette.

**Action bar**
- Attachment (X1b, images, conversations on this computer) and voice (X1c, desktop only) buttons. Each is shown only where it works.
- Live character count.
- Send, disabled for empty input.

**Draft saving**
- Save automatically to localStorage 500ms after each input change.
- Use key `composer-draft-${conversationId}`.
- Restore when switching conversations.

---

### 3.4 Timeline Restyling (I5)

**Status:** implemented by D2.5, accepted 2026-11-19 (`docs/reviews/d2-5-timeline-restyle.md`). It merges after the alpha.4 tag. The report maps each hex value below to a named token.

#### Overall Layout

- Increase maximum width from 740px to 800px.
- Background is `#fafafa` in light mode and `#0a0a0a` in dark mode.
- Increase message spacing from 12px to 20px.

#### Message Cards

**User messages**
- Background is white in light mode and `#1a1a1a` in dark mode.
- Corners are 12px.
- Padding is 16px 20px.
- No border.
- Left aligned.
- Font size is 15px.

**Agent messages**
- Same background as User messages.
- Left aligned.
- Avatar uses the Agent icon for Codex or Claude.
- Show Codex or Claude above the message.

**System messages**, including approval, failure, and running states
- Light-gray background in light mode and `#262626` in dark mode.
- Solid 2px border, with blue, orange, red, or green according to type.
- Corners are 8px.
- Padding is 12px 16px.

#### Code Blocks

**Basic appearance**
```
┌────────────────────────────────────────────┐
│ JavaScript                        [Copy]  │  ← Title bar
├────────────────────────────────────────────┤
│ 1  const greeting = "Hello, world!";       │  ← Line number and code
│ 2  console.log(greeting);                  │
│ 3                                          │
└────────────────────────────────────────────┘
```

**Implementation details**
- Title bar follows these specifications.
  - Left contains the automatically detected language.
  - Right contains Copy, shown on hover.
  - Background is `#2d2d2d` in light mode and `#1a1a1a` in dark mode.
  - Height is 32px.

- Code area follows these specifications.
  - Light-gray, right-aligned line numbers in a 40px column.
  - Monospace code with Prism.js syntax highlighting.
  - Background is `#1e1e1e` in light mode and `#0d0d0d` in dark mode.
  - Padding is 12px.
  - Horizontal scrolling without wrapping.

- Collapsing follows these rules.
  - Above 30 lines, collapse by default to the first 10 and last 5 lines.
  - Show “Expand N lines” between them.
  - Save expansion state to localStorage.

**Syntax highlighting**
- Use Prism.js or highlight.js.
- Support JavaScript, TypeScript, Python, Rust, Go, HTML, CSS, JSON, Shell, and SQL.
- Detect language from the Markdown fence or file extension.

#### Tool Cards

**Layout**
```
┌─────────────────────────────────────────────┐
│ [Icon] Operation                  [Expand] │  ← Title bar
├─────────────────────────────────────────────┤
│ Details, collapsed by default               │
└─────────────────────────────────────────────┘
```

**Styles by type**
- File reads use a blue icon, with path visible while collapsed.
- File edits use a green icon, with path and changed-line count visible while collapsed.
- Command execution uses an orange icon, showing the command while collapsed.
- Search uses a purple icon, showing keywords and result count while collapsed.
- Failures have a red border and expand automatically to show the error.

**Grouping**
- Merge consecutive Tools of one type, such as three file reads, into one card.
- The title reads “Read 3 files.”
- Expansion lists each file.

#### Scrolling and Navigation

**Jump to Latest**
- Show when more than 200px from the bottom.
- Float at the bottom right.
- Use a circular blue button with a downward arrow.
- Clicking scrolls smoothly to the bottom.

**Jump to a specific turn**
- Links from Inbox or notifications include `?turn=<turnId>`.
- Automatically scroll to that Turn and highlight it for two seconds.
- Use a yellow background that fades away.

**Sticky title bar**
- Keep the conversation title bar at the top while scrolling.
- Show conversation title, Provider, and project.
- Use a translucent frosted-glass background.

---

### 3.5 Pairing Speed Optimization (I4)

#### Measurement Plan

Add timestamp logs at the following points.

**Frontend (`apps/web`)**
1. User clicks Connect Computer.
2. Frontend sends the pairing request.
3. Frontend receives success.
4. SSE receives the device-online event.

**Backend (`packages/host`)**
5. Host receives the pairing request.
6. Validate the code.
7. Write the trust record to SQLite.
8. Write the endpoint record to SQLite.
9. Start the TLS handshake.
10. Complete the TLS handshake.
11. Return success.

**Timing targets**
- Total duration is ≤ 3 seconds.
- Stage targets follow.
  - Frontend → Backend under 100ms.
  - Code validation under 50ms.
  - Database writes under 200ms.
  - TLS handshake under 1s.
  - Backend → Frontend under 100ms.
  - SSE delivery under 500ms.

#### Possible Optimizations

**If TLS handshakes are slow**
- Use TLS session resumption.
- Connect in advance while the code is being entered.

**If database writes are slow**
- Write asynchronously, returning success before background persistence.
- Batch writes in a transaction.

**If polling is slow**
- Replace frontend polling with SSE.
- Push device-online events from the backend.

**If validation is slow**
- Simplify pairing-code validation.
- Remove unnecessary encryption and decryption.

---

## 4. Implementation Plan

### D2.1 — Flattening and Basic Composer

**Estimated file changes**
- `apps/web/app/(main)/devices/page.tsx` reworks Devices.
- `apps/web/app/(main)/devices/[id]/page.tsx` reworks device details.
- `apps/web/app/(main)/conversations/new/page.tsx` updates project selection.
- `apps/web/components/composer/composer.tsx` rebuilds Composer.
- `apps/web/components/composer/provider-info-bar.tsx` adds the Provider bar.
- `packages/client` adds Machine aggregation helpers.

**Effort** — Approximately two to three days.

**Tests**
- Correct computer counts and names on Devices.
- Projects grouped by computer during conversation creation.
- Multiline input and automatic Composer growth.
- Draft saving and restoration.

---

### D2.2 — Provider Differentiation

**Estimated file changes**
- `apps/web/app/(main)/conversations/new/page.tsx` adds tool cards.
- `apps/web/app/(main)/conversations/[id]/page.tsx` updates conversation headings and explanations.
- `apps/web/components/timeline/timeline.tsx` updates Tool styling.
- `apps/web/components/timeline/approval-card.tsx` appears only for Codex.
- `apps/web/components/changes-panel/changes-panel.tsx` differentiates panel titles.

**Effort** — Approximately one to two days.

**Tests**
- Capability differences are visible when choosing a Provider.
- Codex shows approval and stop, while Claude does not.
- Changes-panel titles are correct.

---

### D2.5 — Timeline Restyling

**Estimated file changes**
- `apps/web/components/timeline/timeline.tsx` updates overall layout and spacing.
- `apps/web/components/timeline/message-card.tsx` updates message cards.
- `apps/web/components/timeline/code-block.tsx` rebuilds code blocks.
- `apps/web/components/timeline/tool-card.tsx` rebuilds Tool cards.
- `apps/web/components/timeline/scroll-to-bottom.tsx` adds the scroll button.
- `apps/web/app/(main)/conversations/[id]/page.tsx` adds a sticky title bar.
- `packages/ui/src/components/code-block.tsx` provides the shared code-block component.

**Dependency**
- Prism.js or highlight.js for syntax highlighting.

**Effort** — Approximately three to four days.

**Tests**
- Code blocks have line numbers and Copy.
- Long blocks collapse by default.
- The title bar remains fixed while scrolling.
- Jump to Latest appears and hides correctly.

---

### D2.4 — Pairing Speed Optimization

**Effort** — Undecided, pending bottleneck measurement.

**Estimate** — One to two days if the bottleneck is clear.

---

## 5. Distance from the Final Goal

The complete desktop plan follows the v4 stages in `docs/ROADMAP.md`.

**Completed**
- ✅ D1, desktop v4 foundation (`v0.1.0-alpha.2`).
- ✅ B0, remote access launched.
- ✅ B1, cross-device acceptance passed.

**In progress**
- 🔄 U1, one-click updates, design complete and awaiting review.
- 🔄 D2, desktop experience improvements in this document.

**Not started**
- ⬜ B4, remote management, design complete and awaiting implementation.
- ⬜ P1, multi-tool support, including OpenCode.
- ⬜ E1, account-device model using shared account sign-in and pairing codes.
- ⬜ X1, advanced input with voice and attachments, after M2.

**Distance from everyday usability**
- D2 resolves the core desktop experience problems.
- With U1 updates and B4 remote management, desktop can serve as a primary everyday tool.

**Distance from the complete v4 plan**
- P1 multi-tool support, E1 account model, and X1 input enhancements remain.
- Tablet and phone work also proceeds in parallel. Android T1a is complete, and iPad I1 is in acceptance.

---

## 6. Decisions Confirmed by You (2026-11-09)

**Q1. I1, flattening Windows and WSL**
- ✅ Adopt option B, showing two computers named “Windows desktop” and “Windows desktop (WSL).”
- Projects and conversations belong to their respective Machines.
- Users can clearly distinguish projects on Windows from those on WSL.

**Q2. I2, Provider differentiation and Timeline style**
- ✅ Use a common frontend and theme colors.
- Dynamically show or hide approval, stop, editing, and other elements according to Codex and Claude Code capabilities.
- Preserve a unified design language.

**Q3. I3, model switching within a conversation**
- ✅ Required to align with the native app experience.
- Codex can switch OpenAI models such as GPT-4 and o1.
- Claude can switch Claude models such as Opus and Sonnet, plus effort.
- Extend the protocol with an interface for switching models inside a conversation.

**Q4. I3, regeneration and conversation branching**
- ✅ Defer both to later work.

**Q5. I4, asynchronous pairing**
- ✅ Measure bottlenecks before choosing optimizations.

**Q6. I5, message editing and conversation export**
- ✅ Sent-message editing should be supported, but later.
- ✅ Defer conversation export.

**Core goal**, translated from your words
> Our goal is that using Codex or Claude in this app should feel consistent with their respective native apps.

---

## 7. Appendix — Reference Screenshots

- Image 5 is the current tablet's compact Timeline, from your screenshot.
- Image 6 is the Codex/Kiro desktop Timeline, from your screenshot.

The screenshots are saved under `C:\Users\Administrator\AppData\Local\Temp\claude\...` and need copying into `docs/ux-redesign/screenshots/`.
