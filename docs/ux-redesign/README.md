# CodeTether UX Redesign v4 (Design Handoff)

Status: this directory is the UI design authority (AGENTS.md, replacing Figma since 2026-11-02). Desktop v4 is implemented, accepted, and released as `v0.1.0-alpha.2`. v4 organizes information as **Account › Devices › Projects › Conversations**. Signed-in users see their devices and each device's projects, where one project is one folder on that device. Show only backend-supported capabilities, retaining v2's light-first, dark-switchable visual design. Documents 01/02 record design at baseline `bbcda690a081`. Their references to current state mean that baseline.

| File | Contents |
|---|---|
| [01-feature-inventory-and-mapping.md](01-feature-inventory-and-mapping.md) | Key facts, frontend review, F01–F68 inventory, old/new entry points, prototype screenshots, source |
| [02-dev-handoff.md](02-dev-handoff.md) | Information architecture, light/dark tokens, components, state presentation, capability gates, data dependencies, open questions, Figma-writing plan, implementation order |
| [03-project-plan.md](03-project-plan.md) | Desktop/tablet/phone stages, responsibilities, review invariants. Authoritative stage status is at the top of `docs/ROADMAP.md` |
| [04-requirements.md](04-requirements.md) | Requirements by feature ID and platform stage |
| [05-desktop-update.md](05-desktop-update.md) | U1 desktop one-click update design |
| [06-pairing-remote-control.md](06-pairing-remote-control.md) | B1 pairing and remote control design |
| [07-tablet.md](07-tablet.md) | T1 tablet design and B4 remote-management scope |
| `tablet/index.html` | Interactive tablet prototype (`?o=port` portrait, `?theme=dark` dark). Screenshots in `tablet/png/`, exported with `tablet/export-png.sh` |
| [overview.html](overview.html) | Overview of 82 screenshots (`png/00-overview.png` is the full page) |
| `prototype/index.html` | Local interactive prototype, opened directly in browser, using demo data without real API calls |
| `export-png.sh` | Regenerate `png/`, requiring Chrome and about 1 minute |

## Changes from v3 to v4

v3 attached folders on multiple computers to a project (Project › Folder › Conversation), with Other Hosts / View Only. v4 replaces that model:

- **Device first**: sidebar and initial `#/devices` page list devices, their projects, then conversations. A project belongs to exactly one device (`ProjectRecord` plus its unique `ProjectLocation` there). No Folder layer or additional location on another device appears.
- **No view-only devices**: remove Other Hosts / View Only, access requests, and Allow Other Computers to View This Computer. Two fully usable device types remain, This Computer and CodeTether Node-paired devices.
- **Recover prior conversations after choosing a folder**: immediately scan added projects for Codex/Claude Code `provider-sessions`, then select/import within the same dialog. Project pages also expose Previous Conversations and rescan. Both local and Node-paired devices support this.
- Other same-account Mac/Windows desktops and paired Windows lack complete backend control. Keep them in `#/roadmap`, outside primary flows.

## Open the Prototype

Open `prototype/index.html` directly in browser via file:// without network access. URL parameters:

- `?theme=light|dark|system`: default light, also selectable in Settings › Appearance or Ctrl K. Persisted in localStorage.
- `?os=win|mac`: titlebar controls and platform-specific copy.
- `?modal=…`: open a specific overlay.
  - `addproj`: choose device for Add Project. `addproj:m-mac` fixes a device. `addproj:m-local:found` opens Found Previous Conversations directly.
  - `new`: New Conversation. `new~p-web` preselects a project for sidebar/Ctrl N, `new:p-web` fixes a project, `new@m-mac` preselects the first available project on that device.
  - `rmproj:p-docs` removes a project or explains remaining conversations. `unpair:m-mac` unpairs or explains remaining projects. `addr:m-mac` updates an address.
  - `palette`, `rename:c3`.
- Shortcuts: Ctrl K command palette, Ctrl N New Conversation with current project preselected, Esc close overlay.

## Walkthrough (Hash Routes)

1. First launch: `#/onboarding?step=welcome` … `step=project` (choose folder) → `step=previous` (prior conversations found) → `step=ready` → `#/devices`.
2. All devices: `#/devices`, each with project cards showing conversation, running, and importable counts.
3. Add/recover: device section/sidebar + → choose folder → Added …, Found N Previous Conversations → Import Selected → project.
4. Previous conversations: `#/projects/p-web` bottom section → select → Import Selected, or rescan.
5. New conversation: sidebar project + or project New Conversation → choose AI tool → created conversation.
6. Approval: `#/inbox` → `#/c/c1` (waiting) → `#/c/c1?panel=files&tab=changes`.
7. Find conversation: `#/projects/p-api/search?q=重试` (titles and user input, project-scoped), `#/projects/p-api?view=archived`, or Ctrl K title search.
8. Add device: `#/add` → `#/add/node?step=1` … `step=4`, then add project.
9. Settings: `#/settings/appearance`, `account`, `notify`, `background`, `about`. `#/roadmap` separates planned from current features.

Demo states: `#/devices?state=loading|empty`, `#/devices/m-linux` (offline), `#/devices/m-local?proj=error` (project read failure), `#/projects/p-docs` (folder unavailable), `#/projects/p-ml` (device offline), `#/inbox?f=none`, `#/c/c4` (offline/failed), `#/c/c5` (imported), `#/settings/account?account=out`, `#/signin?step=email|code|unconfigured`.

Old routes (`#/home`, `#/sessions`, `#/search`, `#/projects`, `#/computers`, `#/computers/:id`, `#/hosts`, `#/pair`, `#/connect`, `#/add/desktop`, `#/account`, `#/doctor`) redirect to new routes.
