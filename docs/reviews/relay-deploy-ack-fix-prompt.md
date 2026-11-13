# Task: update production Relay to e4bdd57 (Supervisor acknowledgement race fix)

Run on Windows, using SSH for server operations. This is deployment only, without repository code changes or commits. References: fix report `D:/Projects/Software/agenthub-archive/relay-create-uncertain-report.md`, review `docs/reviews/fix-relay-create-uncertain.md` on `origin/ux/design`, and B0 report `D:/Projects/Software/agenthub-archive/b0-report.md` for existing deployment, backup, and rollback procedures.

Before starting, confirm that this file has four second-level headings and that the final section is "Report".

## Goals

Replace `codetether-relay.service` on us-vps-01 with Relay built from `e4bdd57`, preventing Relay conversation creation from remaining at "Outcome unconfirmed".

Completion criteria:

1. Service runs the new executable with build ID beginning `git-e4bdd57` and no `dirty` marker;
2. Relay identity is unchanged: public probes see the same Relay ID and fingerprint as before;
3. Windows and Mac Hosts reconnect to Relay, receive `supervisor.ready(role=host)`, and publish presence with 2xx responses;
4. PIDs of all other server services (Caddy, website, Control Plane, anju-cloud-pivot, anju-competition, cloudcli, xray) remain identical before/after;
5. Rollback is documented and prepared.

Physical-device Relay-creation retesting belongs to tablet acceptance, outside this round.

## Known facts

- **Current deployment** (B0 report, "Public Relay"): executable `/usr/local/bin/codetether-relay` (SEA), unit `codetether-relay.service`, native TLS on 8443, administration `127.0.0.1:9443`. B0 executable SHA-256 was `fe18675d58e1a3e0f6617e839537d6b76d68c3370dfd6e41f19dd24ac9a84cd3`. Verify whether it is still running.
- **Identity**: stored under `--state-dir`, with clients pinning the ID and fingerprint. Replace only the executable. Preserve state, arguments, and configuration; avoid enrollment or other identity-changing commands. Back up state without reading private keys.
- **Build**:
  - `pnpm relay:sea` (`apps/relay/scripts/build-relay.mjs`) needs Node 25.5+ and targets the current platform; Windows cannot cross-build it.
  - Server system Node is v22. Do not upgrade it.
  - Choose how to obtain Linux output matching the server architecture, such as a separate official Node in a server temporary directory, WSL, or containers.
  - Build from clean `e4bdd57` and smoke-test with `apps/relay/scripts/sea-smoke.mjs`.
- **Pre-deployment investigation**: inspect production Relay logs around vivo retest times ("fd1d905 retest" in `t1a-report.md`) for channel closure due to `flow_control_violation`. Read event types and timestamps only. Report matches to help attribute the incident.
- **Backup and rollback**: follow B0. Store old executable, unit, and state under `/var/backups/codetether/<date>-relay-ack/`, plus a local copy of the old executable. Roll back by replacing the old executable and restarting the service.
- **Restart impact**: all Relay connections disconnect briefly, including both Hosts, paired phones/tablets, and Relay-connected Node. Clients reconnect automatically; in-flight tasks are never automatically resent.
- **SSH**: previous sessions timed out during the banner stage (`t1a-report.md`). For unstable connections, prepare executable and backups first, then replace/restart in one connection to avoid partial deployment.
- Control-service origin allowlists and Control Plane need no changes.

## Boundaries

- **Decide independently**: build approach, backup/switch procedure, smoke/check methods, and retries for unstable SSH. If startup fails or identity changes, restore the old executable, verify recovery, then tell the user.
- **Ask the user first**:
  - Before restarting the service (tablet/iPad Relay acceptance may be active);
  - Before upgrading system Node or installing system packages;
  - Before changing Relay configuration, arguments, certificates, DNS, firewall, or other services;
  - Before changing repository code.
- **Do not**: read/print private keys, tokens, or certificate private keys; touch Control Plane or the database; push or tag.

## Report

Write `D:/Projects/Software/agenthub-archive/relay-deploy-e4bdd57-report.md`.

- Before/after executable SHA-256 and build ID, build environment, and smoke results;
- Whether vivo-period logs contain `flow_control_violation`;
- Backup location and rollback steps;
- Results for all five completion criteria and other-service PID comparisons;
- Whether rollback occurred and why; incomplete work and reasons.
