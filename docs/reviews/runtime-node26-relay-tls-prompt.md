# Task: Node 26 LTS Pin and Relay TLS Reload

**Where it runs.** On Windows. Use WSL or another Linux environment where a Linux Relay build is needed.

**Branch and worktree.** Start from the current `origin/main` after the alpha.3 release has landed (fetch first). Create branch `chore/node26-relay-tls` in worktree `D:/Projects/Software/agenthub-work/chore-node26-relay-tls`.

**Deadline.** Code reviewed and merged by **2026-11-27**, so the Relay can be redeployed before Caddy's certificate renewal is due (see Known facts).

**References** (read with `git show origin/ux/design:<path>`):

- `docs/reviews/2026-11-13-assessment-and-plan.md` AD-3 and AD-4
- `apps/relay/README.md` (TLS modes, certificate renewal, state directory)
- the B0 renewal note and drafts in `D:/Projects/Software/agenthub-archive/b0-logs/`:
  - `relay-certificate-renewal-note-001.md`
  - `relay-certificate-sync-001.py`
  - `codetether-relay-certificate-sync-001.service`
  - `codetether-relay-certificate-sync-001.timer`

Before starting, confirm this file has 4 second-level headings and that the last one is "Report".

## Goals

**Must:**

1. **Node 26 LTS everywhere** (AD-4).
   - Move the repository to the current Node 26 LTS release. These must agree on one major version:
     - `.node-version` (create it if the hygiene task has not landed yet)
     - the root `engines` field
     - the version check in the three single-executable build scripts
   - Release builds of the Desktop Host sidecar, the Node and the Relay must refuse to build on any other major version. The error message must say which version to install.
   - The full gate (typecheck, lint, build, test) passes on Node 26 on Windows.
   - The Desktop sidecar builds and the packaged Host passes its readiness check: build an installer and start it once **without replacing the installed build**, or use the test that already covers the sidecar.
   - The Relay single-executable builds for Linux x64 on Node 26 and starts with a test configuration.
2. **Relay TLS reload without restart** (AD-3).
   - On `SIGHUP`, the Relay re-reads its configured certificate and key files and runs exactly the startup checks on them: size bounds, POSIX permissions, validity period, and certificate/key match.
   - **If they pass,** new TLS handshakes use the new pair and existing connections stay open, including Host presence and Machine and Supervisor channels.
   - **If they fail,** the current pair stays in use, the Relay keeps running, and one bounded log line gives the reason. The line holds no key material.
   - Reload does not touch the Relay identity, the state directory, enrollments or the configuration file's other fields.
   - Add `ExecReload=` to `apps/relay/deploy/codetether-relay.service` so `systemctl reload codetether-relay` sends the signal.
3. **Expiry is visible.**
   - The management health and metrics output reports the certificate's `notAfter` time and the days remaining.
   - Below 21 days the health output shows a warning state that a simple external check can detect. Follow the existing health format; do not invent a second endpoint.
   - Readiness does not fail only because of the warning.
4. **Reviewed certificate sync.**
   - Turn the B0 drafts into a reviewed sync script plus systemd service and timer under `apps/relay/deploy/`. The script:
     1. Reads the certificate and key that Caddy already manages for `relay.codetether.org`.
     2. Checks the chain, host name, validity period and key match, without printing the key.
     3. When the pair differs from the installed one, installs it atomically into `/etc/codetether-relay`: key owned by `codetether-relay:codetether-relay`, mode `0600`.
     4. Runs `systemctl reload codetether-relay`.
   - When nothing changed, it does nothing. It never restarts the Relay, never touches Caddy, the website or other services, and keeps one backup of the previous pair.
   - Document its install and rollback in `apps/relay/README.md`.
   - **Do not install it on the server**; a separate deployment prompt does that.

**Should:**

5. Hot reload removes the reason the B0 drafts were held back: a restart required all channels to be idle. Say whether any other point from the B0 static review still applies.

## Known facts

- **How builds embed Node.** `apps/desktop/scripts/build-sidecar.mjs` (`assertDirectSeaBuildAvailable`, around line 118), `apps/node/scripts/build-node.mjs` (around line 116) and `apps/relay/scripts/build-relay.mjs` (around line 102) each run `process.execPath --build-sea`. The output therefore embeds whatever Node runs the build. Today that is 25.x, which reached end of life on 2026-06-01 and gets no security fixes.
- **Current version constraints.**
  - The scripts require at least 25.5 for `--build-sea`.
  - The root `engines` field still says `>=22.13.0`.
  - `@types/node` is already `26.2.0`.
- **What must keep working on Node 26:**
  - the Host's `node:sqlite`, 25 migrations
  - `--build-sea`
  - fetch-based SSE
  - the test runner flags in package scripts

  Report any deprecation or behavior change you hit.

- **How the Relay loads certificates today.**
  - `apps/relay/src/configuration.ts` (around lines 82–120) reads and checks the pair once at startup and refuses to start outside the validity period.
  - Nothing reloads it.
  - Restarting the Relay drops every live connection. A constantly connected Host presence means there is never a guaranteed idle window, which is why the B0 drafts were not installed.
- **Production.**
  - The Relay runs at `tls://relay.codetether.org:8443` in `public_ca` mode, at `e4bdd57`, on us-vps-01.
  - Caddy owns port 443 and the ACME certificate on the same server, along with the website and other projects.
  - The current certificate expires `2027-01-01T09:35:31Z`. Caddy normally renews about 30 days before expiry, around 2026-12-02.
- **What clients pin.** Clients pin the Relay **application identity** `relayFingerprint`, not the TLS certificate key (`apps/relay/README.md`). A renewed certificate with a new key therefore does not break paired devices. The identity lives in `/var/lib/codetether-relay` and must never be replaced.
- **Platform.** `SIGHUP` does not exist on Windows. Test the reload through the function the signal handler calls; the signal wiring itself only needs a POSIX test.
- **Shared files with the hygiene task.** If `chore/repo-hygiene-ci` lands first, it created `.node-version` with 25.8.2 and CI reads it. Change only the version there. Merge `origin/main` before reporting; do not rebase.

## Boundaries

- **Decide yourself:**
  - the exact Node 26 patch version
  - how the build scripts check the major version
  - where the reload logic lives
  - the health field names, within the existing format
  - the sync script's language, as long as us-vps-01 already has it
  - how to build for Linux
  - commit splitting
- **Ask the Owner first:**
  - anything that touches us-vps-01, including SSH reads
  - replacing an installed desktop build
  - changing the Relay protocol, identity handling or state format
- **Do not:**
  - deploy the Relay
  - install the sync timer
  - restart any service
  - read or print certificate keys, the Relay identity key or other credentials
  - force-push, merge to `main`, or tag

Push `chore/node26-relay-tls` to `origin`.

## Report

Write to `D:/Projects/Software/agenthub-archive/node26-relay-tls-report.md`:

- **Node:** the Node 26 version chosen; the files changed; the refusal message on another major version.
- **Gate on Node 26:** results, with failures verbatim; any Node 26 behavior changes you hit.
- **Builds:** the Desktop sidecar and Relay Linux build results; what the Mac must install before its next build.
- **Reload:** the design, the tests, and a sample redacted log line for success and for each failure kind.
- **Health:** the fields, with a sample output.
- **Sync:** the script, service and timer; a summary of how it was reviewed against the B0 drafts; the install and rollback steps you documented.
- **Commits:** your commits and the pushed remote commit.
- **Status:** anything left undone and why, and which completion level the work reached.
