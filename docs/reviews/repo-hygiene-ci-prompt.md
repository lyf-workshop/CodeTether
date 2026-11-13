# Task: Repo Hygiene and CI Baseline

**Where it runs.** On the Mac. The Mac can also exercise the POSIX and macOS tests that Windows skips.

**Branch and worktree.** Start from the current `origin/main` (fetch first; it is `4801ef1` or later). Create branch `chore/repo-hygiene-ci` in worktree `~/agenthub-work/chore-repo-hygiene-ci`.

**Scope.** This task changes no product behavior. It does five things:

- makes the quality gate reproducible from a fresh clone
- wires in tests that never run
- fixes formatting and stale metadata
- brings the new AGENTS.md onto `main`
- adds a first CI workflow

**References** (read with `git show origin/ux/design:<path>`):

- `docs/reviews/2026-11-13-assessment-and-plan.md` AD-6, AD-7, AD-8, AD-9
- `docs/DEVELOPMENT-PROCESS.md` §3 and §6
- `AGENTS.md` and `docs/FROZEN-BOUNDARIES.md` (the versions on `ux/design`)

Before starting, confirm this file has 4 second-level headings and that the last one is "Report".

## Goals

**Must:**

1. **`pnpm test` works from a fresh clone.**
   - Today, in a clean worktree after `pnpm install`, `pnpm test` fails: `adapter-claude` cannot find `@codetether/agent-core/dist/index.js`.
   - After your change, `pnpm install && pnpm test` passes in a clean worktree with no prior build.
   - The full gate in the documented order (typecheck, lint, build, test) must still pass.
   - Keep the extra time small; do not make every package rebuild the whole workspace.
2. **Wire in the tests that never run.**
   - The adapter `test` scripts list their files by hand, so these never run:
     - `packages/adapter-claude/test/macos-discovery.test.mjs`
     - `packages/adapter-codex/test/macos-discovery.test.mjs`
     - `packages/adapter-codex/test/probe-supervision.test.mjs`
   - Make each adapter run every `test/*.test.mjs`, so a new test file cannot be forgotten again.
   - The three files are believed to be platform-safe: one skips itself on win32, and the macOS discovery tests are pure functions.
   - If one of them fails, report the failure verbatim. Do not change product code to fix it without asking.
3. **Keep secrets and evidence out of Git.** Without moving, opening or deleting any file:
   - Add `.secrets/` to `.gitignore`.
   - Add a pattern for the untracked evidence receipts at the repository root (`PHASE*-*.json`, `PHASE*-*-SHA256SUMS.txt`). They stay where they are.
4. **Formatting.**
   - These currently fail `pnpm format:check` on `main`. Format them:
     - `apps/host/src/api/host-presence-diagnostics.ts`
     - `apps/host/src/api/host-presence-publisher.ts`
     - `apps/host/src/api/supervisor-transport-manager.ts`
     - `apps/web/test/v4-final-copy-grid.test.mjs`
     - `apps/control-plane/README.md`, and any other README that fails
   - `docs/` comes from the docs branch and is formatted there, so exclude `docs/` from the format check (AD-8).
   - After this, `pnpm format:check` passes on the branch.
5. **AGENTS.md on `main`.**
   - Copy `AGENTS.md` and `docs/FROZEN-BOUNDARIES.md` from `origin/ux/design` byte for byte, in their own commit.
   - Agents load AGENTS.md from their `main`-based worktree, so it only takes effect there (AD-6).
   - Do not edit either file. If `origin/ux/design` does not have `docs/FROZEN-BOUNDARIES.md` yet, the Owner has not pushed the docs. Stop and ask.
6. **CI** (AD-8), using GitHub Actions under `.github/workflows/`:
   - **Every push to any branch, on Linux:** `pnpm install --frozen-lockfile`, typecheck, lint, build, test and format check. Also `cargo test` in `packages/supervisor-mobile`, which includes the TypeScript ↔ Rust interop test.
   - **Pushes to `main` and `release/*`, tags, and manual runs:** the same Node gate on Windows and on macOS. Add `cargo test` in `apps/desktop/src-tauri` on Windows and macOS.
   - **Pushes that change `apps/android/**` or `packages/supervisor-mobile/**`, plus pushes to `main` and manual runs:** an Android job running `testDebugUnitTest lint assembleDebug`. Instrumented tests (`assembleDebugAndroidTest` running on a device) stay local.
   - **Node version.** Take it from one file in the repository. Create `.node-version` with the version Windows release builds use today (25.8.2). The Node 26 task will change only this file and the build scripts.
   - **pnpm.** Use the version from the root `packageManager` field.
   - **No secrets.** No signing, publishing or deployment in CI.
   - **Cancel superseded runs** on the same branch.
   - **Prove it.** Push the branch and get the Linux workflow green on it. Trigger the full matrix once by hand, and report the run links and durations.
     **Should:**

7. Remove the unused `zustand` dependency from `apps/web/package.json`; it is imported nowhere. Update the lockfile.
8. Update the stale installer text in `apps/desktop/src-tauri/tauri.conf.json`. It currently says "Local workspace for Codex coding agents". Use Simplified Chinese, consistent with the README tagline, for example:
   - Short: "AI 编程智能体的控制中心"
   - Long: "在一个地方管理 Codex 和 Claude Code 的项目、会话、审批和多台设备。"

## Known facts

- **How tests run today.**
  - The root `test` script is `pnpm -r --workspace-concurrency=1 --if-present test`.
  - `packages/agent-core` has `build` but no `test`.
  - `adapter-claude` and `adapter-codex` run `pnpm build && node --test …` against their own build output only, which then imports `agent-core`'s missing `dist`.
- **Platforms.** Windows skips 14 POSIX process-group tests, which only Linux and macOS exercise. The desktop Rust tests and the Android Gradle tests are outside `pnpm test`.
- **The Rust interop test.** `packages/supervisor-mobile` has no `package.json`, so `pnpm test` never runs its `cargo test`. Its `tests/interop.rs` checks that the TypeScript and Rust Supervisor encodings agree; today nobody runs it except by hand.
- **The Android build.** It includes the Rust core through UniFFI, so the Android job needs the Rust toolchain and NDK setup used locally. Find out how the Android build compiles the core (`apps/android` Gradle files) rather than guessing.
- **The repository.** It is `lyf-workshop/CodeTether` on GitHub and has no `.github/` directory yet. Repository visibility and Actions billing are the Owner's question. If Actions is disabled or out of minutes, stop and ask.
- **Other tasks.**
  - The release task (`release/v0.1.0-alpha.3`) may land on `main` while you work. Merge `origin/main` into your branch before reporting; do not rebase.
  - The Node 26 task changes `.node-version`, the root `engines` field and the build scripts. Leave `engines` and the build scripts alone here.

## Boundaries

- **Decide yourself:**
  - how to make `pnpm test` self-sufficient
  - the glob mechanism for test files
  - the workflow layout, caching and job names
  - commit splitting
- **Ask the Owner first:**
  - any product-code change needed to make a test pass
  - enabling Actions or changing repository settings
  - adding repository secrets
  - pushing `main`
- **Do not:**
  - open, move, print or delete anything in `.secrets/` or the evidence files
  - edit `AGENTS.md` or `docs/FROZEN-BOUNDARIES.md` beyond copying them
  - add signing or deployment to CI
  - force-push, merge to `main`, or tag

Push `chore/repo-hygiene-ci` to `origin`.

## Report

Write to `~/agenthub-archive/repo-hygiene-ci-report.md`:

- **Fresh clone:** how `pnpm test` now works from one; the time of `pnpm test` before and after on the Mac.
- **Wired-in tests:** the three files' results on macOS.
- **Ignore patterns:** what you added to `.gitignore` and `.prettierignore`, and `git status` at the root before and after. List file names only, never contents.
- **Formatting:** the formatted files; the `pnpm format:check` result.
- **AGENTS.md:** the copy commit, and the `git hash-object` of both files compared with `origin/ux/design`.
- **CI:** the workflow files, the jobs and their triggers, run links, durations, and any job you could not get green and why.
- **Dependency and metadata:** the dependency removal and the installer text.
- **Commits:** your commits and the pushed remote commit.
- **Gate results:** with any failures verbatim.
- **Status:** anything left undone and why, and which completion level the work reached.
