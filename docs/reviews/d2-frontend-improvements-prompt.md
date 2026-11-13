# Task: D2.1 Frontend Improvements — Project Selector, Conversation Lists, Path Truncation, and Button Tooltips

Run on Windows. Continue on `feat/d2-frontend-flatten-composer` (currently `876834c`). Improve 5 UI/UX details based on code review. Commit and push to the same branch without creating another branch.

Before starting, confirm this file has 4 second-level headings and the final section is "Report".

## Goals

**Required changes**:

1. **Improve project-selector group headings** (medium priority):
   - Current: native HTML `<optgroup>` labels, which may not stand out enough.
   - Change to more prominent group headings.
   - Approach: if shadcn/ui Select supports custom group headings, use a gray background and bold text. Otherwise retain the current implementation and explain in the report.
   - Location: `apps/web/src/components/conversations/new-conversation-selection.ts` or related files.
   - Test: group headings should be clear when multiple computers are present.

2. **Long conversation lists** (medium priority):
   - Current: the device detail page displays "Recent conversations 1", while the design specifies the most recent 10.
   - Check whether the implementation supports loading more or pagination when there are more than 10 conversations.
   - Approach: if neither exists, add a "View all conversations" link or pagination controls.
   - Location: near `apps/web/src/components/machines/machine-conversations-section.tsx`.
   - Test: create 10+ conversations and verify the display.

3. **Improve truncated paths in New Conversation** (low priority):
   - Current: project paths are truncated, for example "C:\Users\Administrator\AppData\Local\Temp\codetether-d2-frontend-ev...".
   - Show the full path through the HTML `title` attribute.
   - Approach: add `title={fullPath}` to the path's DOM element.
   - Location: near `apps/web/src/components/conversations/new-conversation-fields.tsx`.
   - Test: hovering over the project path reveals the complete path.

4. **Attachment and voice button tooltips** (low priority):
   - Current: attachment and voice buttons are disabled and gray, without an explanation.
   - Add "Coming soon" tooltips.
   - Approach: wrap buttons in shadcn/ui Tooltip or use native `title` attributes.
   - Location: near `apps/web/src/components/conversation/composer.tsx` (Paperclip and Mic buttons).
   - Test: hovering over attachment and voice buttons shows "Coming soon".

5. **Project counts on cards** (low priority):
   - Current: plain text such as "1 project".
   - Consider adding a project icon. This is an optional improvement.
   - Approach: add a Folder or FolderOpen icon before the count if time permits, otherwise retain the current display.
   - Location: near `apps/web/src/components/machines/machine-summary-card.tsx`.
   - Test: assess whether the device card's project count is clearer.

## Boundaries

**Decide independently**:
- If shadcn/ui Select cannot style group headings, retain the existing version and explain in the report.
- Choose shadcn/ui tooltips or native `title` attributes for attachment and voice buttons.

**Ask the user first**:
- Changing shared `packages/ui` components or Select behavior is allowed, but discuss it first.

**Do not**:
- Change Composer placeholders such as model switching or the remaining-context progress bar, pending D2.1c.
- Add other features. Limit work to these 5 UI details.

## Report

Append an "Improvements completed" section to `~/agenthub-archive/d2-frontend.md`:

- Changes and corresponding commits for each item 1–5.
- Whether shadcn/ui Select supports custom group styles, if investigated.
- The approach for long conversation lists (pagination or loading more).
- Project-path tooltip screenshots showing the complete path on hover.
- Attachment and voice tooltip screenshots.
- Whether project icons were added to cards.
- Rerun pnpm typecheck / lint / test / build and confirm all pass.
- Commit hash and push status.

---

## Known Facts

- Current branch: `feat/d2-frontend-flatten-composer` @ `876834c`.
- Passed: typecheck, lint, 968 Web tests, and build.
- One unchanged Relay authentication test fails, without blocking this task.
- Goal: improve these 5 UI/UX details and push to the same branch.
