# Task. Fix login configuration in I1 physical-device builds (round 3)

Run on Mac and continue iPad physical-device acceptance. Branch `i1/ipad-app` is currently `90cd7f5`. Change code, commit, and push to `i1/ipad-app` without pushing `main`, merging, or tagging. References are `docs/reviews/i1-ipad-acceptance-prompt.md` and `docs/reviews/i1-fix-prompt-r2.md` (read from `origin/ux/design` with `git show`).

Before starting, confirm this file has four second-level headings and the last section is "Report".

## Goals

Fix the missing login configuration in the `90cd7f5` physical-device build, then continue physical acceptance.

Symptom. Launching the build installed on iPad shows "Login service is not configured in this version". This comes from `IpadConfiguration.init` in `apps/ios/Sources/CodeTether/Configuration.swift`. It reads required `CodeTetherControlPlaneURL`, `CodeTetherSupabaseURL`, and `CodeTetherSupabasePublishableKey` from `Info.plist` (both URLs must be `https` origins), plus three Relay values that must be all present or all absent. Any invalid requirement throws `configurationMissing`.

Required outcomes follow.

1. **Root cause and fix.** Identify and fix why configuration is ineffective. Restrict changes to `apps/ios` (scripts, `project.yml`, `Config/`, source, tests).
2. **Post-build self-check.** After producing the artifact, check the final `Info.plist` inside `.app`. Fail the build if those six keys do not meet `IpadConfiguration` requirements. Output may say only "present, correctly shaped" and list the two URL hostnames. Never print key values or the Relay fingerprint.
3. **Regression test.** Cover the chain from configuration generation to final `Info.plist` values, using an appropriate method.
4. **Physical-device retest.** Rebuild, install on iPad, and confirm startup reaches login without configuration errors.
5. **Continue acceptance.** Resume the checklist in `docs/reviews/i1-ipad-acceptance-prompt.md`, replacing its `90cd7f5` with the fix commit. I will review changes while acceptance proceeds.

## Known facts

- **Primary suspect.** xcconfig treats `//` as a comment even inside quotes. `xcconfigValue` in `apps/ios/Scripts/generate-local-config.mjs` writes `SUPABASE_URL = "https://…"`, which may truncate at `//`, causing `validOrigin` failure and matching the symptom. A common escape is `/$()/`. This is only a hypothesis. Verify through `xcodebuild -showBuildSettings` and the `.app` `Info.plist`.
- **Other possibilities.**
  - Optional `#include? "Local.xcconfig"` in `Config/Base.xcconfig` silently leaves values empty if the file is absent or the path wrong.
  - `$(VAR)` names in `Config/Info.plist` do not match xcconfig names.
  - The build bypassed `Scripts/build.sh`, leaving `Local.xcconfig` stale.
- **Why emulator testing missed it.** Emulator tests used fixtures rather than real configuration reads.
- **Preserve the approach.** `90cd7f5` adopted explicit `Config/Info.plist` and `$(VAR)` substitution to include configuration in device packages. Keep this approach instead of returning to `INFOPLIST_KEY_*`.
- Reuse the previously proven build, signing, installation, and iPad developer-trust procedure from `~/agenthub-archive/i1-report.md`. Reinstallation overwrites the faulty version currently on iPad.

## Boundaries

- **Decide independently.** Diagnosis, fix, self-check, regression tests, commit breakdown, and build environment issues.
- **Ask the user first.**
  - Changes outside `apps/ios` (Rust, TypeScript, Host).
  - Personal actions including verification codes, iPad trust/dialogs, and Xcode Apple ID.
  - Production configuration changes.
  - Pushing `main` or tagging.
- **Do not do.**
  - Read or print credentials. Only the build script reads `v4-build.env`, without printing it. Build checks and reports exclude key values and Relay fingerprint values.
  - Write actual configuration values into tracked files. Keep `Config/Local.xcconfig` ignored by `.gitignore`.
  - Force-push or touch production `com.codetether.node` and its data directory.

## Report

Append an "r3 fixes" section to `~/agenthub-archive/i1-report.md`.

- Root cause and redacted evidence from build settings or final `Info.plist`.
- Change commits and remote commit after pushing.
- Redacted self-check output and regression-test results.
- Physical-device startup result, including whether login appears.
- Unfinished work and reasons.

Continue recording checklist outcomes in the same report's "Physical-device acceptance" section.
