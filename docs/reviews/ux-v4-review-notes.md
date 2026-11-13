# v4 desktop preview issues and changes

This file records confirmed desktop-preview issues, changes, and acceptance criteria. Each entry owns its implementation/review status.

## UX-V4-001. Initial setup presents "AI service not verified" as "Tool not ready"

- Recorded 2026-10-19.
- Observed `ux/v4-device-first`, `df91601c33e791e4d923c731a104c9136e25ea07`.
- Status accepted (user confirmation 2026-11-02), released with D1 as `v0.1.0-alpha.2`. The two unchecked conditions below lack separate follow-up records and are closed under D1 installed-build acceptance.
- Previous status fixed, awaiting review. Frontend model/static rendering/isolated-browser layout regressions complete. Native preview and real first execution unverified.
- Scenario. Windows native desktop preview with separate test data and WebView profile.
- User feedback. Codex and Claude Code are installed, but setup appears not to detect them, leaving ordinary users unsure how to continue.

### Confirmed facts

Verified through running preview Host public Doctor/device-detail responses and actual window text.

| Tool | Installation/selection | Runtime | AI service |
| --- | --- | --- | --- |
| Codex 0.162.1 | Detected, selected | Available, compatible newer version not fully validated | Official service, not verified |
| Claude Code 2.1.251 | Detected, selected | Available, compatible | Custom AI service, not verified |

Both public descriptors are `availability: available` with streaming/native resume. No evidence of missed installation detection.

The isolated preview database has no historical successful-execution observations. Tool installations, authentication, and custom AI configuration were neither cleared nor modified. Diagnosis invoked no model and is not evidence of service connectivity or execution success.

### Cause and impact

1. Installation/runtime checks pass, but no authoritative AI service validation exists, keeping service `unknown`. Preserve this truthfulness boundary.
2. Doctor overall status inherits service `unknown`. Frontend shows the whole card as "Not checked" without clearly stating installed.
3. Initial setup derives buttons from strict validated-readiness counts, showing "Skip AI tool setup for now" and "Cannot run until at least one AI tool is ready".
4. Normal creation/input controls actually permit explicit first execution on available installations with unknown service. Existing text suggests missed detection, forced reinstall, or inability to continue.
5. Recheck updates installation/runtime metadata without background inference. Repeated clicks cannot replace real service validation.

State distinctions and strict readiness counts predate v4, so do not attribute this to new v4 installation scanning.

### Suggested scope, initial-setup presentation only

- Separate installation, runtime, and AI service facts. Clearly show installed and compatibility when detected/available, without presenting unknown service as unchecked installation.
- Unknown AI service shows "Not verified", explaining "AI service is verified when the first conversation starts. Setup sends no messages or model requests." Do not mark it ready.
- With installed, available runtime and unknown service, use Continue setup rather than Skip AI tools or blanket Cannot run.
- Truly missing installations retain official installation instructions and Recheck.
- Explain known login/configuration/service/runtime incompatibility separately using existing targeted actions. Unknown-state wording must not obscure them.
- Unknown custom services must not trigger forced official login, configuration switching, or reinstall.
- Preserve accurate current/last-observed hints. Continuing setup does not prove service availability.

Preserve Provider detection/selection/compatibility, authoritative Doctor state, execution gates, and protocol. Do not relax strict readiness or add active service checks/background inference.

### Historical temporary workaround

The user could choose Skip AI tool setup for now, add a project, finish setup, and Open CodeTether. Then normal creation and explicit message sending verify service through real execution.

Do not require reinstall, repeated login, environment edits, or a special test message merely to finish setup. Never resend automatically after failure.

### Acceptance criteria

- [x] With both installed and unknown service, show installation/runtime/unverified service separately and Continue setup. (Model/static rendering tests)
- [x] One installed tool permits setup without requiring both. (Static rendering)
- [x] Both absent correctly show missing/install guidance while preserving setup skip. (Static rendering)
- [x] Unknown service is neither failure nor verified ready, and known login/configuration/connectivity/compatibility issues stay visible. (Model/static rendering)
- [x] Unknown custom service does not force official login/service switching. (Static rendering)
- [x] Recheck uses existing bounded checks, with no extra inference on open/recheck. (Existing refresh/no-inference-origin assertions/bounded tests retained, no real API)
- [ ] Finishing setup requires no test message. Explicit first execution uses existing selection/permission/execution gates and never retries failures automatically. (Completion static/strict-readiness regression passed, real first execution unverified)
- [ ] Light/dark and desktop/narrow explanations, controls, keyboard, and accessibility remain consistent.

### Browser review scope this round

In a real `pnpm dev` browser with simulated HTTP matching existing protocol shapes, inspected check/completion pages in light/dark at 1440, 1100, 390 widths, 12 views total. No horizontal overflow/console errors. Unknown service still shows Continue setup, completion omits execution-ready indication. Screenshots are in ignored `output/playwright/ux-v4-review-onboarding/`.

Classified AUTOMATED BROWSER / SIMULATED API. No installed Desktop, real Host, or AI tool connection. Zero project creations/model executions. This supplies no new real installation/authentication/service-readiness evidence. Full native keyboard/screen-reader and real first execution remain unverified, so composite criteria stay unchecked.

### Implementation locations

- [Initial-setup orchestration](../../apps/web/src/components/onboarding/onboarding-page.tsx).
- [AI tool cards, buttons, hints](../../apps/web/src/components/onboarding/onboarding-provider-check.tsx).
- [Completion readiness and copy](../../apps/web/src/components/onboarding/onboarding-ready-step.tsx).
- [Strict readiness and state copy](../../apps/web/src/components/onboarding/onboarding-model.ts).
- [Normal conversation gates, reference only, outside suggested changes](../../apps/web/src/components/conversation/conversation-controls.ts).
- [Authoritative Doctor state composition, reference only, outside suggested changes](../../apps/host/src/api/host-service.ts).
