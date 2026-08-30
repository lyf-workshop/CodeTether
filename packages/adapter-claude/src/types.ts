export const CLAUDE_CODE_PROVIDER = 'claude-code' as const
export const CLAUDE_CODE_TESTED_VERSION = '2.1.251' as const
export const CLAUDE_CODE_TESTED_VERSIONS = ['2.1.250', '2.1.251'] as const
export const CLAUDE_CODE_EFFORT_LEVELS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const
export type ClaudeCodeEffort = (typeof CLAUDE_CODE_EFFORT_LEVELS)[number]

export function isClaudeCodeTestedVersion(version: string): boolean {
  return (CLAUDE_CODE_TESTED_VERSIONS as readonly string[]).includes(version)
}

export interface ClaudeCodeCapabilities {
  readonly streaming: boolean
  readonly resume: boolean
  readonly interrupt: boolean
  readonly approvals: boolean
  readonly fileRead: boolean
  readonly fileEdit: boolean
  readonly shell: boolean
  readonly search: boolean
  readonly diff: boolean
  readonly toolEvents: boolean
  readonly modelSelection: boolean
  readonly reasoningControl: boolean
}

export const CLAUDE_CODE_CAPABILITIES: ClaudeCodeCapabilities = Object.freeze({
  streaming: true,
  resume: true,
  interrupt: false,
  approvals: false,
  fileRead: true,
  fileEdit: false,
  shell: false,
  search: true,
  diff: false,
  toolEvents: true,
  modelSelection: false,
  reasoningControl: true,
})

export type ClaudeCodeDetectionStatus =
  'available' | 'unsupportedVersion' | 'notInstalled' | 'misconfigured'

export interface ClaudeCodeLauncher {
  readonly kind: 'native' | 'npm'
  /** Absolute executable passed directly to child_process.spawn. */
  readonly executable: string
  /** Trusted adapter-owned argv placed before Claude's argv. */
  readonly prefixArguments: readonly string[]
  /** Resolved claude.exe or verified npm claude.cmd used for display only. */
  readonly sourcePath: string
}

interface ClaudeCodeDetectionBase {
  readonly provider: typeof CLAUDE_CODE_PROVIDER
  readonly status: ClaudeCodeDetectionStatus
  readonly capabilities: ClaudeCodeCapabilities
  readonly durationMs: number
}

export interface ClaudeCodeAvailableDetection extends ClaudeCodeDetectionBase {
  readonly status: 'available'
  readonly version: string
  readonly executablePath: string
  readonly launcher: ClaudeCodeLauncher
}

export interface ClaudeCodeUnsupportedDetection extends ClaudeCodeDetectionBase {
  readonly status: 'unsupportedVersion'
  readonly version: string
  readonly executablePath: string
  readonly launcher: ClaudeCodeLauncher
}

export interface ClaudeCodeUnavailableDetection extends ClaudeCodeDetectionBase {
  readonly status: 'notInstalled' | 'misconfigured'
  readonly diagnosticCode: string
}

export type ClaudeCodeDetection =
  | ClaudeCodeAvailableDetection
  | ClaudeCodeUnsupportedDetection
  | ClaudeCodeUnavailableDetection

export type CanonicalClaudeToolName =
  'Read' | 'Edit' | 'Shell' | 'Search' | 'Generic Tool'

export interface ClaudeCodeTurnResult {
  readonly sessionId: string
  readonly turnId: string
  readonly finalMessage?: string
}

export interface ClaudeCodeFailure {
  readonly sessionId: string
  readonly turnId: string
  readonly code: string
  readonly message: string
}
