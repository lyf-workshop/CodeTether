# Claude Code Adapter

Bounded Claude Code adapter for the locally installed CLI. It owns
installation detection, safe process launch, native session identity/resume,
JSONL parsing, and normalization to `@codetether/agent-core` events. Host and
Web consumers never receive Claude-specific wire objects.

The production profile intentionally enables only streaming, native resume,
read/search tools, canonical Tool events, and Claude's Provider-owned effort
control. Approval, reliable interrupt, file editing, shell, diff, and model
selection remain unsupported.

Phase 5A was accepted against Claude Code `2.1.250`; Phase 5B revalidated the
same safe execution boundary and structured Tool envelopes against `2.1.251`.
Phase 8A revalidated that frozen capability boundary against `2.1.263` while
closing a multiple-installation selection mismatch. Phase 8D revalidated the
same restricted execution, structured Read/Glob/Grep events, and read-only
native-session format against `2.1.266`. All four exact versions remain
admitted; no additional Claude capability is exposed.
Unknown versions fail closed.
Detection is bounded to Host startup; later CLI launch or authentication
failures are mapped to presentation-safe canonical Provider errors rather than
raw diagnostics.

The execution profile retains Claude's `--restricted` workspace confinement.
Host startup reads only the user-scope `settings.json` `env` object and
privately projects an exact allowlist of required operating-system/network
context plus Claude authentication, endpoint, and model variables into the
child environment. Explicit process environment values win. CodeTether does
not load or copy user hooks, plugins, permissions, MCP, or Project/local
settings; strict MCP and disabled slash commands provide additional product
boundaries. Claude's own managed-policy settings may still apply and are not
bypassed. Unrelated Host variables and credentials never enter the child;
secrets never enter argv, public descriptors, or logs.
