import { spawn, type ChildProcess } from 'node:child_process'
import { tmpdir } from 'node:os'
import { TextDecoder } from 'node:util'

import {
  ClaudeCodeOwnedProcessCleanupError,
  prepareClaudeCode,
} from '@codetether/adapter-claude'
import {
  machineTransportLimits,
  type RemoteProviderCapabilities,
  type RemoteProviderDescriptor,
  type RemoteProviderDiscovery,
} from '@codetether/machine-transport'

const NO_REMOTE_EXECUTION_CAPABILITIES: RemoteProviderCapabilities =
  Object.freeze({
    streaming: false,
    resume: false,
    interrupt: false,
    approvals: false,
    fileRead: false,
    fileEdit: false,
    shell: false,
    search: false,
    diff: false,
    toolEvents: false,
    modelSelection: false,
    reasoningControl: false,
  })

const REMOTE_CODEX_TEXT_CAPABILITIES: RemoteProviderCapabilities =
  Object.freeze({
    ...NO_REMOTE_EXECUTION_CAPABILITIES,
    streaming: true,
    resume: true,
  })

const REMOTE_CLAUDE_CAPABILITIES: RemoteProviderCapabilities = Object.freeze({
  ...NO_REMOTE_EXECUTION_CAPABILITIES,
  streaming: true,
  resume: true,
  fileRead: true,
  search: true,
  toolEvents: true,
  reasoningControl: true,
})

const REMOTE_CLAUDE_REASONING = Object.freeze({
  reasoningLabel: '思考强度',
  reasoningOptions: Object.freeze([
    { id: 'low' as const, label: 'Low' },
    { id: 'medium' as const, label: 'Medium' },
    { id: 'high' as const, label: 'High' },
    { id: 'xhigh' as const, label: 'XHigh' },
    { id: 'max' as const, label: 'Max' },
  ]),
})

const REMOTE_CODEX_EXECUTION_TESTED_VERSIONS = new Set(['0.149.1'])
const CLAUDE_CODE_TESTED_VERSIONS = new Set(['2.1.250', '2.1.251'])
const SEMANTIC_VERSION = String.raw`\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?`
const CODEX_VERSION_PATTERN = new RegExp(
  String.raw`^(?:codex-cli|codex)\s+(${SEMANTIC_VERSION})$`,
  'u',
)
const CLAUDE_VERSION_PATTERN = new RegExp(
  String.raw`^(${SEMANTIC_VERSION})\s+\(Claude Code\)$`,
  'u',
)

type RemoteProviderId = RemoteProviderDescriptor['provider']

export interface ProviderProbeDefinition {
  readonly provider: RemoteProviderId
  readonly displayName: string
  readonly executable: string
  readonly arguments: readonly string[]
  readonly parseVersion: (output: string) => string | undefined
  readonly isSupportedVersion: (version: string) => boolean
}

export interface RemoteProviderDetectorOptions {
  /** Internal test seam. Network requests can never supply probe definitions. */
  readonly probes?: readonly ProviderProbeDefinition[]
  readonly environment?: NodeJS.ProcessEnv
  readonly timeoutMs?: number
  readonly maximumOutputBytes?: number
  readonly now?: () => Date
  /** Internal test seam; remote callers cannot select the Node platform. */
  readonly platform?: NodeJS.Platform
  /** Internal test seam; remote callers cannot influence authentication. */
  readonly claudeExecutionProbe?: RemoteClaudeExecutionProbe
}

export interface RemoteClaudeExecutionProbeResult {
  readonly available: boolean
  readonly version?: string
}

export type RemoteClaudeExecutionProbe = (
  signal: AbortSignal,
) => Promise<RemoteClaudeExecutionProbeResult>

const DEFAULT_PROBES: readonly ProviderProbeDefinition[] = Object.freeze([
  {
    provider: 'codex',
    displayName: 'Codex',
    executable: 'codex',
    arguments: ['--version'],
    parseVersion: (output) => CODEX_VERSION_PATTERN.exec(output)?.[1],
    // The remote text execution profile is a narrower boundary than local
    // Codex. Only versions exercised against that exact profile may advertise
    // streaming/resume; other real installations remain visible by version but
    // fail closed as unsupported.
    isSupportedVersion: isRemoteCodexExecutionVersion,
  },
  {
    provider: 'claude-code',
    displayName: 'Claude Code',
    executable: 'claude',
    arguments: ['--version'],
    parseVersion: (output) => CLAUDE_VERSION_PATTERN.exec(output)?.[1],
    isSupportedVersion: (version) => CLAUDE_CODE_TESTED_VERSIONS.has(version),
  },
])

export function isRemoteCodexExecutionVersion(version: string): boolean {
  return REMOTE_CODEX_EXECUTION_TESTED_VERSIONS.has(version)
}

export function supportsRemoteCodexExecutionPlatform(
  platform: NodeJS.Platform = process.platform,
): boolean {
  // POSIX detached process groups permit exact remote-only descendant cleanup.
  // Windows remains discovery-only until the Node owns an equivalent Job
  // Object boundary; an installed CLI alone is not execution capability.
  return platform !== 'win32'
}

export function supportsRemoteClaudeExecutionPlatform(
  platform: NodeJS.Platform = process.platform,
): boolean {
  // The remote Claude adapter needs an exact POSIX process-group boundary for
  // CLI descendants. Windows remains discovery-only.
  return platform !== 'win32'
}

/**
 * Node-owned, purpose-specific Provider version detector. It accepts no input
 * from the Machine protocol beyond the fixed `providers.describe` operation.
 */
export class RemoteProviderDetector {
  readonly #probes: readonly ProviderProbeDefinition[]
  readonly #environment: NodeJS.ProcessEnv
  readonly #timeoutMs: number
  readonly #maximumOutputBytes: number
  readonly #now: () => Date
  readonly #executionPlatformSupported: boolean
  readonly #claudeExecutionPlatformSupported: boolean
  readonly #claudeExecutionProbe: RemoteClaudeExecutionProbe
  readonly #lifecycleAbort = new AbortController()
  readonly #children = new Set<ChildProcess>()
  #inFlight?: Promise<RemoteProviderDiscovery>
  #cleanupFailure: ClaudeCodeOwnedProcessCleanupError | undefined
  #closed = false
  #closePromise: Promise<void> | undefined

  constructor(options: RemoteProviderDetectorOptions = {}) {
    this.#probes = validateProbeDefinitions(options.probes ?? DEFAULT_PROBES)
    this.#environment = restrictedDetectionEnvironment(
      options.environment ?? process.env,
    )
    this.#timeoutMs = positiveInteger(
      options.timeoutMs ?? machineTransportLimits.providerProbeTimeoutMs,
      'Provider probe timeout',
    )
    this.#maximumOutputBytes = positiveInteger(
      options.maximumOutputBytes ??
        machineTransportLimits.maximumProviderProbeOutputBytes,
      'Provider probe output limit',
    )
    this.#now = options.now ?? (() => new Date())
    this.#executionPlatformSupported = supportsRemoteCodexExecutionPlatform(
      options.platform,
    )
    this.#claudeExecutionPlatformSupported =
      supportsRemoteClaudeExecutionPlatform(options.platform)
    const providerEnvironment = options.environment ?? process.env
    this.#claudeExecutionProbe =
      options.claudeExecutionProbe ??
      (async (signal) => {
        const preparation = await prepareClaudeCode({
          environment: providerEnvironment,
          timeoutMs: this.#timeoutMs,
          signal,
          processOwnership: 'posix-process-group',
        })
        return preparation.detection.status === 'available'
          ? { available: true, version: preparation.detection.version }
          : { available: false }
      })
  }

  discover(): Promise<RemoteProviderDiscovery> {
    if (this.#cleanupFailure !== undefined) {
      return Promise.reject(this.#cleanupFailure)
    }
    if (this.#closed) {
      return Promise.reject(new Error('Provider detector is closed'))
    }
    this.#inFlight ??= this.#discoverOnce()
      .catch((error: unknown) => {
        if (error instanceof ClaudeCodeOwnedProcessCleanupError) {
          this.#cleanupFailure ??= error
          this.#lifecycleAbort.abort()
        }
        throw error
      })
      .finally(() => {
        this.#inFlight = undefined
      })
    return this.#inFlight
  }

  async close(): Promise<void> {
    this.#closePromise ??= this.#close()
    await this.#closePromise
  }

  async #close(): Promise<void> {
    this.#closed = true
    this.#lifecycleAbort.abort()
    for (const child of this.#children) terminateExactChild(child)
    try {
      await this.#inFlight
    } catch (error) {
      if (error instanceof ClaudeCodeOwnedProcessCleanupError) {
        this.#cleanupFailure ??= error
      } else {
        throw error
      }
    }
    if (this.#cleanupFailure !== undefined) throw this.#cleanupFailure
  }

  async #discoverOnce(): Promise<RemoteProviderDiscovery> {
    const providers = await Promise.all(
      this.#probes.map(async (probe) => await this.#probe(probe)),
    )
    return {
      providers,
      observedAt: this.#now().toISOString(),
    }
  }

  async #probe(
    probe: ProviderProbeDefinition,
  ): Promise<RemoteProviderDescriptor> {
    const outcome = await runBoundedVersionProbe({
      probe,
      environment: this.#environment,
      timeoutMs: this.#timeoutMs,
      maximumOutputBytes: this.#maximumOutputBytes,
      children: this.#children,
    })
    const base = {
      provider: probe.provider,
      displayName: probe.displayName,
      capabilities: NO_REMOTE_EXECUTION_CAPABILITIES,
    } as const
    if (outcome.kind === 'not_installed') {
      return { ...base, availability: 'not_installed' }
    }
    if (outcome.kind === 'unavailable') {
      return { ...base, availability: 'unavailable' }
    }
    if (outcome.kind === 'misconfigured') {
      return { ...base, availability: 'misconfigured' }
    }
    const version = probe.parseVersion(outcome.output)
    if (version === undefined || version.length > 120) {
      return { ...base, availability: 'misconfigured' }
    }
    const executionVersionSupported = probe.isSupportedVersion(version)
    let claudeExecutionAvailable = false
    if (
      probe.provider === 'claude-code' &&
      executionVersionSupported &&
      this.#claudeExecutionPlatformSupported
    ) {
      let execution: RemoteClaudeExecutionProbeResult
      try {
        execution = await this.#claudeExecutionProbe(
          this.#lifecycleAbort.signal,
        )
      } catch (error) {
        if (error instanceof ClaudeCodeOwnedProcessCleanupError) throw error
        execution = { available: false }
      }
      claudeExecutionAvailable =
        execution.available && execution.version === version
    }
    return {
      ...base,
      // Frozen Phase 6C.1 discovery truth describes the real installation.
      // Codex execution has a narrower version gate, but an untested valid
      // Codex binary remains installed/available rather than being relabelled.
      availability:
        probe.provider === 'codex' || executionVersionSupported
          ? 'available'
          : 'unsupported_version',
      version,
      capabilities:
        probe.provider === 'codex' &&
        executionVersionSupported &&
        this.#executionPlatformSupported
          ? REMOTE_CODEX_TEXT_CAPABILITIES
          : probe.provider === 'claude-code' && claudeExecutionAvailable
            ? REMOTE_CLAUDE_CAPABILITIES
            : NO_REMOTE_EXECUTION_CAPABILITIES,
      ...(probe.provider === 'claude-code' && claudeExecutionAvailable
        ? REMOTE_CLAUDE_REASONING
        : {}),
    }
  }
}

type ProbeOutcome =
  | { readonly kind: 'success'; readonly output: string }
  | { readonly kind: 'not_installed' }
  | { readonly kind: 'misconfigured' }
  | { readonly kind: 'unavailable' }

function runBoundedVersionProbe(options: {
  readonly probe: ProviderProbeDefinition
  readonly environment: NodeJS.ProcessEnv
  readonly timeoutMs: number
  readonly maximumOutputBytes: number
  readonly children: Set<ChildProcess>
}): Promise<ProbeOutcome> {
  return new Promise((resolve) => {
    let settled = false
    let forcedFailure: ProbeOutcome | undefined
    let stdoutBytes = 0
    let stderrBytes = 0
    const stdout: Buffer[] = []
    const child = spawn(
      options.probe.executable,
      [...options.probe.arguments],
      {
        cwd: tmpdir(),
        env: options.environment,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
    options.children.add(child)

    const finish = (outcome: ProbeOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.children.delete(child)
      resolve(outcome)
    }
    const failAndTerminate = (outcome: ProbeOutcome) => {
      if (forcedFailure !== undefined || settled) return
      forcedFailure = outcome
      terminateExactChild(child)
    }
    const timer = setTimeout(
      () => failAndTerminate({ kind: 'unavailable' }),
      options.timeoutMs,
    )

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength
      if (stdoutBytes <= options.maximumOutputBytes) stdout.push(chunk)
      else failAndTerminate({ kind: 'unavailable' })
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength
      if (stderrBytes > options.maximumOutputBytes) {
        failAndTerminate({ kind: 'unavailable' })
      }
    })
    child.once('error', (error: NodeJS.ErrnoException) => {
      finish({
        kind: error.code === 'ENOENT' ? 'not_installed' : 'unavailable',
      })
    })
    child.once('close', (code) => {
      if (forcedFailure !== undefined) {
        finish(forcedFailure)
        return
      }
      if (code !== 0) {
        finish({ kind: 'misconfigured' })
        return
      }
      try {
        const output = new TextDecoder('utf-8', { fatal: true })
          .decode(Buffer.concat(stdout))
          .trim()
        finish(
          output.length === 0
            ? { kind: 'misconfigured' }
            : { kind: 'success', output },
        )
      } catch {
        finish({ kind: 'misconfigured' })
      }
    })
  })
}

function terminateExactChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGKILL')
}

function restrictedDetectionEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const allowed = new Set([
    'PATH',
    'PATHEXT',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'LANG',
    'LC_ALL',
  ])
  const result: NodeJS.ProcessEnv = {
    NO_COLOR: '1',
    TERM: 'dumb',
  }
  for (const [name, value] of Object.entries(environment)) {
    if (value !== undefined && allowed.has(name.toUpperCase())) {
      result[name] = value
    }
  }
  return result
}

function validateProbeDefinitions(
  probes: readonly ProviderProbeDefinition[],
): readonly ProviderProbeDefinition[] {
  if (probes.length !== 2) {
    throw new TypeError('Provider detector requires exactly two probes')
  }
  const identities = new Set(probes.map(({ provider }) => provider))
  if (
    identities.size !== 2 ||
    !identities.has('codex') ||
    !identities.has('claude-code')
  ) {
    throw new TypeError('Provider detector requires Codex and Claude Code')
  }
  for (const probe of probes) {
    if (
      probe.executable.trim().length === 0 ||
      probe.arguments.length === 0 ||
      probe.displayName.trim().length === 0
    ) {
      throw new TypeError('Provider probe definition is invalid')
    }
  }
  return [...probes]
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`)
  }
  return value
}
