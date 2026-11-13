# Multi-Provider Support Strategy (P1)

Date — 2026-11-02. Stage P1 follows M2 (mobile MVP). See `docs/ux-redesign/03-project-plan.md` and the stage table at the top of `docs/ROADMAP.md`. Do not integrate a third AI tool before P1 (AGENTS.md, Out of Scope).

## 1. Goal

Integrate additional command-line AI coding tools alongside Codex and Claude Code, managed through the same Projects › Conversations › Inbox interface. Show only the capabilities each tool actually supports.

## 2. Current Support

| Tool | Vendor | Capabilities Currently Supported |
| ----------- | --------- | ------------------------------------------------------------------------------------------------ |
| Codex | OpenAI | Local computer supports conversations, streaming output, approval, stop, changes, and resuming earlier conversations. Paired devices use a read-only sandbox, with no approval or stop. |
| Claude Code | Anthropic | Conversations, streaming output, and resuming earlier conversations. Tools are limited to Read, Glob, and Grep. No editing, commands, approval, or stop. |

## 3. Candidate Tools (Verify Each During Research)

The table below records only information found in public sources checked in 2026-11. Integration eligibility depends on the P1 research conclusions.

| Tool | Vendor | Public Information |
| ------------------ | --------------------- | ------------------------------------------------------------------------------------------------ |
| GitHub Copilot CLI | GitHub | Supports noninteractive programmatic invocation. [Programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference) |
| Gemini CLI | Google | Open-source command-line tool |
| Cursor CLI | Cursor | Supports headless mode with `-p` / `--print` and stream-json output. [Headless documentation](https://cursor.com/docs/cli/headless) |
| Kiro CLI | AWS | Formerly Amazon Q Developer CLI, renamed in 2025-11. CodeWhisperer was an earlier name and no longer exists as a separate product. [Migration guide](https://kiro.dev/docs/upgrade-guides/migrating-from-q/) |
| Pi | Earendil (open source, MIT) | Minimal, extensible terminal coding tool. It is not an Inflection AI product. [GitHub](https://github.com/earendil-works/pi) |
| Aider | Open source | Command-line tool integrated with Git |
| OpenCode | Open source | Command-line coding tool |
| Continue | Open source | Primarily an editor extension. Verify whether a usable command-line interface is available. |

Removed candidates include Tabnine, Windsurf, Phind, Cody, and “OpenAI Code Interpreter CLI.” None currently has a confirmed coding CLI suitable for integration. Add them again if one becomes available.

## 4. Research Required for Each Tool

1. Invocation, including executable, arguments, and support for noninteractive execution.
2. Output format, such as JSON-RPC, JSONL, stream-json, or plain text, including stability and versioning.
3. Sessions, including identity, resumption, and storage location. This determines whether earlier conversations can be discovered.
4. Authentication, such as API keys, OAuth, or local configuration. CodeTether detects readiness without reading or writing these credentials.
5. Tool calls, including representation of edits and commands, externally controllable approval or rejection, and interruption.
6. Errors, including codes and formats and mapping to existing failure classifications.
7. Versions, including supported ranges and version detection.

## 5. Integration Contract

Every adapter must provide the following.

- Installation detection and a supported version range.
- Session creation, resumption, and termination.
- Conversion of native events into normalized conversation events.
- Capability declarations for file reads, editing, commands, search, approval, stop, streaming, session resumption, and changes.
- Failure classification mapped to existing failure types.

The UI displays features according to capability declarations. Unsupported capabilities stay hidden, rather than appearing as disabled buttons. See 03 §6, “The UI shows only capabilities actually provided by the backend.”

## 6. UI Presentation

- Show each tool's name alongside a custom neutral icon. Icons use the same style as the application icon (purple double cards), without vendors' trademarks or brand colors, as you decided on 2026-11-02.
- Do not offer side-by-side tool comparisons or tool switching within an existing conversation.

## 7. Sequence

1. P1 researches every candidate according to §4, records conclusions and the integration contract, and designs neutral icons.
2. Each subsequent tool integration is a separate stage, ordered by the research conclusions.

## 8. Exclusions

- No quarterly schedule or metrics such as coverage targets.
- No adapter marketplace or certification program.
- No conversation handoff between tools (ROADMAP, “Deferred Beyond This Roadmap”).
