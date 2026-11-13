# Development Process

Date — 2026-10-19. Applies to all future CodeTether features, fixes, and releases. You provide requirements and perform acceptance testing. Claude Code organizes requirements, designs the solution, writes task prompts, and reviews the work. The coding agent implements it.

## 1. From Idea to Release

| Step | Owner | Deliverable | Requirement for the Next Step |
| ------------ | -------------------------- | --------------------------------------------------------------------------------------------------- | ---------------- |
| 1 Requirements | You propose ideas and Claude Code organizes them | Requirements describing the problem, scope, exclusions, and acceptance criteria | Your confirmation |
| 2 Design | Claude Code | UI prototypes, screenshots, and handoff documentation, or backend interface and data specifications | Your confirmation |
| 3 Task | Claude Code | A task prompt with the starting commit, branch, steps, invariants, validation requirements, and report format | — |
| 4 Implementation | Coding agent | Small commits on a task branch, with quality checks at each step | All checks pass |
| 5 Review | Claude Code | Findings divided into required and suggested changes, plus a fix prompt. After at most two unsuccessful rounds, ask you | No required changes remain |
| 6 Acceptance and Release | You | Acceptance testing on real devices, findings in the acceptance record, then merge into `main`, tag a version, package and install, and update ROADMAP | Your acceptance |

## 2. Four Levels of Completion

Code complete (checks passed) → Review approved → Acceptance passed → Released.

Every report must state the current level instead of simply saying the work is complete.

## 3. Branches and Workspaces

- `main` always represents the latest accepted version and matches `main` on GitHub. An installed version must have a corresponding tag on `main`.
- Use one branch per task, starting from `main`, named `feat/<stage>-<description>` or `fix/<description>`, such as `feat/b1-remote-control`. Keep the existing names `ux/design` and `ux/v4-device-first`.
- Do not open PRs. Reviews happen locally and are recorded in the repository (see §5). After acceptance, merge locally into `main`, then push `main`. Every push to `main` requires your approval.
- Delete the task branch and workspace after merging. Generally keep at most two tasks in progress at once.
- Put all workspaces under `D:/Projects/Software/agenthub-work/<branch-name>`, rather than the repository's `.tmp` directory.
- Temporary debugging and evidence-collection code must stay out of the branch that will be merged. Keep evidence files such as `PHASE8D-*.json` in an uncommitted directory. Store evidence that needs long-term retention outside the repository under `D:/Projects/Software/agenthub-archive/`.
- Do not rewrite pushed history or force-push.

## 4. Task Size

A task should be small enough to review in one sitting, roughly one implementation step such as the Devices page, rather than a complete interface. Split a delivery before it exceeds approximately 30 files or 3,000 lines, excluding generated files and test snapshots.

## 5. Documentation

- PRODUCT.md defines product behavior, ARCHITECTURE.md defines architecture, and ROADMAP.md defines stages and status.
- `docs/ux-redesign` holds requirements (04), planning (03), prototypes, and stage designs (05 onward). It is the source of truth for UI design. Figma has no longer been used since 2026-11-02. The stage table at the top of ROADMAP.md records status, while 03 defines each stage's scope. Update both together.
- Keep one review and acceptance record per task at `docs/reviews/<branch-name>.md`, including review rounds, required and suggested changes, and acceptance results.

## 6. What a Coding-Agent Task Prompt Must Include

- Starting commit, branch name, and workspace path.
- References to requirement IDs (04), prototype pages, or stage design documents.
- Goals and broad steps. The agent decides implementation details, commit breakdown, and whether to push, deploy, or install, according to the task.
- Product rules to preserve, including the invariants in 03 §6, showing only real capabilities, keeping the product UI Chinese-only, and preventing demo data from calling real interfaces.
- Operational considerations, expressed as explanations rather than blanket prohibitions.
  - Do not print credentials or keys (`.secrets/`, private keys, connection strings) or write them to the repository or reports.
  - Before deployment or replacement of an installed version, make a backup and know how to roll back.
  - Confirm with you before deleting data or performing operations that affect other projects on a server.
  - Preserve untracked evidence files at the repository root.
- Validation must include `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and focused checks relevant to the task.
- Report what changed, check results with failures quoted verbatim, unfinished work and reasons, and the current completion level.

### Authorization Boundaries (2026-11-06)

Prompts state goals, known facts, acceptance criteria, and the following three kinds of boundaries. They do not prescribe command-level steps. The agent decides how to proceed. A prompt does not dictate the agent's sequence or list the commands it must type. Describe known pitfalls through their causes and symptoms, rather than prescribing a single solution.

- **Decide independently** — implementation and commands, build-environment issues (installing tools inside the workspace or `~/agenthub-work`, using environment variables limited to the current invocation, or choosing tool versions with verified checksums), diagnosing and retrying failures, and splitting commits within the task. Investigate and resolve problems independently first. Stop only when the cause cannot be determined.
- **Ask the user first** — actions requiring the user personally (verification codes, device trust and system prompts, physical connections), code changes for a task that originally excluded code, deleting or overwriting user data or replacing an installed version without a backup, production-service configuration changes (Control Plane, Relay, or server, including through SSH), terminating processes the agent did not start, pushing `main`, and tagging.
- **Do not do** — read or print credentials, force-push or rewrite pushed history, or touch services and data unrelated to the task.

## 7. Release

- Windows uses an NSIS installer. Mac uses a signed app. On Android, install a debug APK for personal testing first.
- Tag every release as `v0.x.y` and record the changes in `CHANGELOG.md`.
- Replace an installed version only after your acceptance. Preserve the previous installer and a data backup before replacement. Delete them only after acceptance of the new version.
