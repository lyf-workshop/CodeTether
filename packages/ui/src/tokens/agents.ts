export const agentDefinitions = {
  codex: {
    name: 'Codex',
    shortName: 'Codex',
    icon: 'C',
    accent: 'codex',
    accentClassName: 'border-agent-codex bg-agent-codex text-text-inverse',
  },
  claude: {
    name: 'Claude Code',
    shortName: 'Claude',
    icon: 'C',
    accent: 'claude',
    accentClassName: 'border-agent-claude bg-agent-claude text-text-inverse',
  },
  opencode: {
    name: 'OpenCode',
    shortName: 'OpenCode',
    icon: 'O',
    accent: 'opencode',
    accentClassName:
      'border-agent-opencode bg-agent-opencode text-text-inverse',
  },
} as const

export type AgentId = keyof typeof agentDefinitions

export type AgentDefinition = (typeof agentDefinitions)[AgentId]
