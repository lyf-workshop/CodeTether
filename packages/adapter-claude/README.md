# Claude Code Adapter

Bounded Phase 5A adapter for the locally installed Claude Code CLI. It owns
installation detection, safe process launch, native session identity/resume,
JSONL parsing, and normalization to `@codetether/agent-core` events. Host and
Web consumers never receive Claude-specific wire objects.

Phase 5A intentionally enables only streaming, native resume, read/search
tools, and canonical Tool events. Approval, interrupt, file editing, shell,
diff, model selection, and reasoning controls remain unsupported.

The exact Phase 5A compatibility target is Claude Code `2.1.250`. Detection is
bounded to Host startup; later CLI launch or authentication failures are mapped
to presentation-safe canonical Provider errors rather than raw diagnostics.

The execution profile retains Claude's `--restricted` workspace confinement.
Because that mode deliberately ignores ordinary user settings, Host startup
reads only the user-scope `settings.json` `env` object and privately projects an
exact allowlist of Anthropic authentication, endpoint, and model variables into
the child environment. Explicit process environment values win. Hooks,
plugins, permissions, MCP configuration, arbitrary variables, and Project/local
settings are not loaded; secrets never enter argv, public descriptors, or logs.
