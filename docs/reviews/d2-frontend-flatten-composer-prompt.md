# Task — D2.1 Frontend Implementation: Flatten Computer Hierarchy and Rebuild the Basic Composer

Run on Windows. References are I1 (flattening) and I3 (Composer) in `docs/ux-redesign/10-desktop-improvements.md`. This round implements the flattened hierarchy and basic Composer input. Integrate model switching after the protocol work is complete.

Before starting, confirm that this file has four second-level headings and ends with “Report.”

## Goals

**Required changes**

### Part One — Flatten the Computer Hierarchy (I1)

1. **Hide the Machine concept and display computers**
   - User-facing UI must no longer show “Machine” or “Node.”
   - A physical computer may have multiple Machines, such as Windows and WSL. Display them as two independent computers.
   - Naming uses `displayName` + `platform` + `architecture`.
     - **Primary title** uses `displayName`, the Machine's user-defined computer name, up to 240 characters.
     - **Subtitle** uses `Operating system · Architecture · Connection status`.
       - Map `platform` values, including "windows" → "Windows", "darwin" → "macOS", and "linux" → "Linux".
       - Show `architecture`, such as "x64" or "arm64".
       - Map `connectionState`, including "local" → "Online", "online" → "Online", "offline" → "Offline", and "connecting" → "Connecting".
     - **Local computer** uses `displayName` plus the subtitle, without replacing the name with “This computer.” Users see the name they chose.
     - **Remote examples** follow.
       - "MacBook Pro" / "macOS · arm64 · Online"
       - "Windows WSL" / "Linux · x64 · Online", with the user-defined displayName "Windows WSL"
       - "Ubuntu Server" / "Linux · x64 · Offline"

2. **Rework Devices (`/devices`)**
   - Display each Machine as an independent computer card.
   - Each card contains the following.
     - Bold `displayName`, such as "MacBook Pro".
     - Gray `Operating system · Architecture · Connection status` subtitle, such as "macOS · arm64 · Online".
     - Details include the following.
       - One status row each for Codex and Claude Code, showing installation state such as Available, Not installed, or Not signed in.
       - Project count, such as "3 projects".
   - Clicking a card opens device details.
   - Use a responsive grid with two or three cards per row.
   - Sort as follows.
     - Local computer first.
     - Remote computers by most recent online time.
     - Offline computers last.

3. **Rework device details (`/devices/:machineId`)**
   - Page title uses `displayName`, such as "MacBook Pro".
   - Subtitle uses `Operating system · Architecture · Connection status · Connection method`, such as "macOS · arm64 · Online · Same network".
   - First section is **Projects**, with a card per project showing name, abbreviated path, and recent activity.
   - Second section is **Recent Conversations**, showing the latest 10 in time order, with title, Provider, project, and status per row.
   - Third section is **AI Tools**, with detailed Codex and Claude Code states, installation location, version, sign-in state, and capabilities.
   - Fourth section is **Connection**, with method, last online time, and Relay status.
   - Bottom actions include the following.
     - Add Project, for local computers or remote computers with file access.
     - Pair New Device, local only.

4. **Project selector in New Conversation (`/conversations/new`)**
   - Group projects by computer using `<optgroup>` or a custom dropdown.
   - Group headings use `displayName (Operating system)`, such as "MacBook Pro (macOS)" or "Windows WSL (Linux)".
   - Special-case the local group as "This computer (Operating system)".
   - List each computer's projects beneath its heading.
   - Offline computers and projects are gray and unselectable, with supporting text explaining why.

5. **Conversation lists and search**
   - The device field in conversation rows displays the computer name, without “Machine.”
   - Search-result device groups also use computer names.

6. **Terminology mapping throughout the UI**
   - Preserve the code's `Machine` type. Do not change the backend.
   - Frontend display text follows these rules.
     - Do not show “Machine.”
     - Show displayName directly as the computer name.
     - Map platform to an operating-system name ("windows" → "Windows", "darwin" → "macOS", "linux" → "Linux").
     - Show architecture as its architecture name, such as "x64" or "arm64".
     - Map connectionState to connection status ("local"/"online" → "Online", "offline" → "Offline", "connecting" → "Connecting").
     - Do not show “Node.”

---

### Part Two — Basic Composer Rebuild (I3.1, Excluding Model Switching)

7. **Enhanced multiline input**
   - Replace the existing single-line field with `<textarea>`.
   - Initial height is two lines, approximately 48px.
   - Grow automatically beyond two lines, up to 40% of the viewport.
   - Beyond that height, scroll internally with `overflow-y: auto`.
   - Placeholders depend on Provider.
     - Codex uses “Tell Codex what to do…”
     - Claude uses “Ask Claude a question…”
     - Default uses “Enter a message…”

8. **Shortcuts**
   - Enter sends. Settings can change this to Ctrl+Enter sending and Enter inserting a newline.
   - Shift+Enter always inserts a newline.
   - Ctrl+Up copies the previous turn's input into the field.
   - Esc clears the input.
   - Save the shortcut setting in `localStorage` using key `composer-send-shortcut` and value `"enter"` or `"ctrl-enter"`.

9. **Automatic draft saving**
   - Save to `localStorage` 500ms after each input change.
   - Use key `composer-draft-${conversationId}`.
   - Restore drafts when switching conversations.
   - Clear the draft after a successful send.

10. **Provider information bar** (placeholder, without model switching yet)
    - Display one Provider information row above the field.
      - Left shows Provider icon and name, such as "Codex" or "Claude Opus 5.5".
      - Center shows the “Remaining context” placeholder. Defer its progress indicator until the protocol extension is complete.
      - Right shows a disabled Model placeholder button explaining that model switching is in development.
    - Use a light-gray background, 32px height, and 8px corners.

11. **Action bar**
    - Display an action row below the field.
      - Left contains attachment and voice placeholder buttons, hidden or disabled with a “Coming soon” explanation.
      - Center displays the current character count, updated immediately.
      - Right contains Send.
    - Send behaves as follows.
      - Disable for empty or whitespace-only input.
      - Also disable when the conversation cannot send, including running, awaiting approval, or offline states, with a reason shown.

12. **Layout**
    ```
    ┌─────────────────────────────────────────────────────────────────────┐
    │ [Provider icon] Codex · GPT-4  Remaining context  [Model▼]          │  ← Provider information bar (32px)
    ├─────────────────────────────────────────────────────────────────────┤
    │                                                                     │
    │ [Multiline field, at least 2 lines, up to 40% of the viewport]       │
    │                                                                     │
    ├─────────────────────────────────────────────────────────────────────┤
    │ [📎][🎤]               Characters 125                  [Send]       │  ← Action bar (40px)
    └─────────────────────────────────────────────────────────────────────┘
    ```

---

### Part Three — Shortcut Configuration in Settings

13. **Settings › Editor** (new section)
    - Title is “Editor and Input.”
    - Options include the following.
      - A Send Shortcut segmented control with these choices.
        - “Enter sends, Shift+Enter inserts a newline.”
        - “Ctrl+Enter sends, Enter inserts a newline.”
      - Default is “Enter sends.”
    - Save to `localStorage`, and have Composer read the setting.

---

## Known Facts

- `Machine` and `Computer` types are already defined in `packages/client`.
- The current Devices page uses the Machine list and displays “Machine.”
- New Conversation has a simple ungrouped project dropdown.
- Composer is a single-line field and send button fixed to the bottom.
- Draft saving is not implemented.
- Provider information such as model, reasoning effort, and remaining context is not displayed.

## Boundaries

- **Decide independently**
  - Computer card layout and styling, referring to the `packages/ui` design system.
  - Order and styling of the four device-detail sections.
  - Composer implementation, including shadcn/ui Textarea or a custom field.
  - Automatic field growth through CSS `field-sizing: content` or JavaScript sizing.
  - Placeholder styling and explanatory text.
- **Ask the user first**
  - Backend or protocol changes.
  - Changes to shared `packages/ui` components, which are allowed after confirmation.
  - Computer naming rules that differ from user expectations.
- **Do not do**
  - Model switching, pending completion of protocol extensions.
  - Attachment uploads or voice input (X1).
  - Returning to a specific turn or branching conversations.
  - Timeline styling changes (D2.5).

## Report

Write the completed report to `~/agenthub-archive/d2-frontend.md`, including the following.

- Changed files grouped by parts one, two, and three.
- How computer naming is implemented, including determining the number of Machines under one `computerId`.
- Devices screenshots covering local Windows, a paired Mac, and WSL if available.
- New Conversation's computer-grouped project selector screenshot.
- Composer screenshots before and after expansion and showing the Provider information placeholder.
- Shortcut tests for Enter sending, Shift+Enter newlines, Ctrl+Up copying, and Esc clearing.
- Draft test, entering a draft → Switching conversations → Returning to the preserved draft.
- Passing TypeScript checks and build.
- Commit hash and pushed remote branch.

Use branch `feat/d2-frontend-flatten-composer`, push to `origin`, and do not merge into `main`.

**Note** — Model switching remains outside this round. The Provider bar's Model button is a placeholder. After `feat/d2-model-switching` merges, implement D2.1b integration of model switching.
