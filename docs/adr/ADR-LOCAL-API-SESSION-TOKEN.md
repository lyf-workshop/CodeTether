# ADR: Session Token for the Local Host API

## Status

Proposed on 2026-11-13. The Owner accepts or amends it before the S1 task prompt is written (`docs/reviews/2026-11-13-assessment-and-plan.md`, AD-5).

## Context

The Host serves Protocol v1 over HTTP and SSE on `127.0.0.1:4317`. `apps/host/src/api/local-http-server.ts` (`#handle`) and `http-boundary.ts` check two things:

- **The `Host` header**, which stops DNS rebinding.
- **The `Origin` header against an allowlist**, which stops other web pages in a browser. A request with no `Origin` header passes (`authorizeOrigin` returns `undefined`).

No credential is required. That leaves three groups of callers that can use the whole API, including reading history, starting Turns and resolving Approvals:

- **Other users' processes.** Loopback is shared by everyone logged in to the machine, so another OS user's process can call it.
- **Any process of the same user.** For this group the token mostly matters for scoped or sandboxed processes, which cannot read the data directory.
- **The coding agents CodeTether supervises.** A Codex Turn with shell and network access could call `POST …/approvals/…` and approve its own pending request.

Two things are already protected and stay as they are:

- **Privileged Supervisor routes** (`/api/v1/supervisor/pairing/record`, `/devices/disable`) require signed evidence.
- **Remote devices** reach the Host only through the Supervisor transport, which uses TLS 1.3 and its own identities.

The Desktop shell already starts the Host as a managed child. The Host waits for a `start` line on its private stdin pipe before it initializes (`apps/desktop/src-tauri/src/host_supervisor.rs`).

## Decision

1. **Generation.** At each launch, the Desktop shell generates a 256-bit random session secret before it spawns the Host.
2. **Delivery to the Host.** The secret goes to the Host on the existing private stdin activation channel. It is never passed through command-line arguments, environment variables or files in managed mode.
3. **Enforcement.**
   - Every Protocol v1 request requires `Authorization: Bearer <secret>`. This includes SSE, which the web client already opens with `fetch`, so a header works.
   - The Host compares in constant time.
   - A missing or wrong token gets `401` with a fixed, bounded error that echoes nothing back.
   - The `Host` and `Origin` checks stay as they are.
4. **Unauthenticated surface.** At most one minimal route may answer without the token, so the shell can tell "another CodeTether Host" apart from "some other program" on port 4317 during conflict detection. It returns nothing beyond a fixed product marker and the protocol version.
5. **The web client.**
   - The web gets the secret from the Rust shell through one Tauri command, granted only to the `main` window capability.
   - The secret is held in memory only. It is never written to `localStorage` or `sessionStorage`, and never placed in URLs.
   - `packages/client` adds the header to every request.
6. **The shell's own calls.** The shell's own Host requests (readiness, liveness after resume) use the same header.
7. **Development and standalone Host.** When the Host runs outside the Desktop (`pnpm host:serve`):
   - It generates its own secret.
   - It writes the secret to a file in its data directory that only the current OS user can read (owner-only ACL on Windows, `0600` on POSIX), and deletes the file on shutdown.
   - The development web client receives the secret through development-only tooling. Production builds contain no such path.
8. **Provider child processes.** They never receive the secret. Their restricted environment already excludes it; a test keeps it that way.
9. **Logging.** The secret never appears in logs, diagnostics, crash reports or error messages.

## Alternatives considered

- **Named pipe or Unix socket instead of TCP.** These provide OS-level access control. However, the WebView cannot `fetch` over a pipe without a Rust proxy for every request and SSE stream, which means a second transport and a larger change.
- **A cookie.** The Tauri origin and loopback are different sites, so this runs into SameSite and third-party cookie rules for a design no stronger than a header.
- **Looking up the connecting process's owner** (for example, with the Windows TCP table). This is platform-specific, prone to races, and does not stop the same user's sandboxed processes.
- **Keep relying on the `Origin` header.** That header only constrains browsers; it does nothing against the callers listed in Context.

## Consequences

- **Integration tests.** Host integration tests and `packages/client` tests need a token helper.
- **Development workflow.** The development commands change slightly, and `docs/DEVELOPMENT.md` documents the new step.
- **Architecture docs.** The Security Boundary section of `docs/ARCHITECTURE.md` gains a short "local callers" paragraph.
- **What it does not stop.** A malicious process running as the same user that can read the data directory, or attach to the Desktop process, can still get the secret. The token raises the bar from "any local caller" to "a caller already holding the user's privileges".
- **Mobile, Relay, Node and the Control Plane** are unaffected.
