import {
  observeClaudeCodeBackendConfiguration,
  type ClaudeCodeBackendConfigurationObservation,
} from './backend.js'
import { resolveClaudeCodeRestrictedEnvironment } from './configuration.js'
import {
  probeClaudeCodeAuthStatus,
  probeClaudeCodeHelp,
  probeClaudeCodeVersion,
} from './detection.js'
import {
  fingerprintClaudeCodeInstallation,
  type ClaudeCodeInstallationCandidate,
} from './installation.js'
import {
  CLAUDE_CODE_RUNTIME_CLI_CONTRACT,
  type ClaudeCodeProcessOwnership,
} from './process.js'
import { isClaudeCodeTestedVersion } from './types.js'
import { isClaudeSessionDiscoveryVersionSupported } from './session-discovery.js'

const VERSION_PATTERN = /^(\d+\.\d+\.\d+) \(Claude Code\)$/u

export type ClaudeCodeCompatibilityState =
  | 'verified'
  | 'compatible_unverified'
  | 'limited'
  | 'incompatible'
  | 'unavailable'

export type ClaudeCodeObservedSupport =
  'supported' | 'unsupported' | 'unavailable' | 'unknown'

export interface ClaudeCodeCapabilityObservation {
  readonly observed: ClaudeCodeObservedSupport
  readonly enabled: boolean
  readonly effective: boolean
}

export interface ClaudeCodeCompatibilityObservation {
  readonly state: ClaudeCodeCompatibilityState
  readonly runtimeReadiness: 'ready' | 'limited' | 'blocked' | 'unavailable'
  readonly contractVersion: 1
  readonly capabilities: {
    readonly execution: ClaudeCodeCapabilityObservation
    readonly streaming: ClaudeCodeCapabilityObservation
    readonly nativeResume: ClaudeCodeCapabilityObservation
    readonly nativeSessionDiscovery: ClaudeCodeCapabilityObservation
    readonly fileRead: ClaudeCodeCapabilityObservation
    readonly search: ClaudeCodeCapabilityObservation
    readonly toolEvents: ClaudeCodeCapabilityObservation
    readonly reasoningControl: ClaudeCodeCapabilityObservation
  }
  readonly failureCode?:
    | 'provider_probe_failed'
    | 'provider_protocol_error'
    | 'provider_backend_auth_required'
    | 'provider_backend_misconfigured'
}

export interface ClaudeCodeBackendReadinessObservation extends ClaudeCodeBackendConfigurationObservation {
  readonly readiness:
    | 'unknown'
    | 'ready'
    | 'unavailable'
    | 'authentication_required'
    | 'misconfigured'
}

export interface ClaudeCodeInstallationObservation {
  readonly installation: ClaudeCodeInstallationCandidate
  readonly version?: string
  /** Private executable digest; derive an opaque Machine-scoped wire revision. */
  readonly privateRevision?: string
  readonly compatibility: ClaudeCodeCompatibilityObservation
  readonly backend: ClaudeCodeBackendReadinessObservation
  readonly runtimeEnvironment: () => NodeJS.ProcessEnv
}

export interface ObserveClaudeCodeInstallationOptions {
  readonly installation: ClaudeCodeInstallationCandidate
  readonly environment?: NodeJS.ProcessEnv
  readonly settingsPath?: string
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
  readonly processOwnership?: ClaudeCodeProcessOwnership
  readonly checkFirstPartyAuth?: boolean
  /** Internal deterministic-test seam; product code uses bounded probes. */
  readonly probeVersion?: () => Promise<string>
  /** Internal deterministic-test seam; product code uses bounded probes. */
  readonly probeHelp?: () => Promise<string>
  /** Internal deterministic-test seam; product code uses bounded probes. */
  readonly probeAuthStatus?: () => Promise<boolean>
  /** Internal deterministic-test seam for synthetic executable revisions. */
  readonly fingerprint?: () => Promise<string>
}

/**
 * Shared local/Node zero-inference lifecycle observation. Runtime
 * compatibility never depends on first-party auth or backend reachability.
 */
export async function observeClaudeCodeInstallation(
  options: ObserveClaudeCodeInstallationOptions,
): Promise<ClaudeCodeInstallationObservation> {
  const sourceEnvironment = options.environment ?? process.env
  const environment = await resolveClaudeCodeRestrictedEnvironment({
    environment: sourceEnvironment,
    ...(options.settingsPath === undefined
      ? {}
      : { settingsPath: options.settingsPath }),
  })
  const backendConfiguration = observeClaudeCodeBackendConfiguration({
    sourceEnvironment,
    effectiveEnvironment: environment,
  })
  const probeOptions = {
    environment,
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.processOwnership === undefined
      ? {}
      : { processOwnership: options.processOwnership }),
  }
  let version: string | undefined
  let privateRevision: string | undefined
  let compatibility: ClaudeCodeCompatibilityObservation
  try {
    // Preserve exact installation identity even when a later bounded runtime
    // probe fails, so one broken installation remains observable in a
    // multiple-installation Machine instead of disappearing.
    privateRevision = await (options.fingerprint?.() ??
      fingerprintClaudeCodeInstallation(options.installation, options.signal))
    const versionOutput = await (options.probeVersion?.() ??
      probeClaudeCodeVersion(options.installation.launcher, probeOptions))
    version = VERSION_PATTERN.exec(versionOutput)?.[1]
    // A shipped version string does not identify a binary revision. Probe the
    // exact zero-inference CLI contract on every lifecycle refresh so an
    // externally replaced same-version binary cannot inherit compatibility
    // solely from its version label.
    const help = await (options.probeHelp?.() ??
      probeClaudeCodeHelp(options.installation.launcher, probeOptions))
    compatibility = compatibilityFromHelp(
      version,
      help,
      options.installation.launcherKind !== 'wrapper' &&
        options.installation.launcherKind !== 'unknown',
    )
  } catch {
    compatibility = unavailableCompatibility()
  }

  let readiness: ClaudeCodeBackendReadinessObservation['readiness'] =
    backendConfiguration.configurationValid ? 'unknown' : 'misconfigured'
  if (
    backendConfiguration.mode === 'first_party' &&
    backendConfiguration.configurationValid &&
    options.checkFirstPartyAuth === true
  ) {
    try {
      const loggedIn = await (options.probeAuthStatus?.() ??
        probeClaudeCodeAuthStatus(options.installation.launcher, probeOptions))
      readiness = loggedIn ? 'ready' : 'authentication_required'
    } catch {
      readiness = 'unknown'
    }
  }

  return {
    installation: options.installation,
    ...(version === undefined ? {} : { version }),
    ...(privateRevision === undefined ? {} : { privateRevision }),
    compatibility,
    backend: { ...backendConfiguration, readiness },
    runtimeEnvironment: () => ({ ...environment }),
  }
}

function compatibilityFromHelp(
  version: string | undefined,
  help: string,
  sessionStoreAffinityEstablished: boolean,
): ClaudeCodeCompatibilityObservation {
  const surface = parseClaudeCodeHelp(help)
  const executionSupported =
    CLAUDE_CODE_RUNTIME_CLI_CONTRACT.executionFlags.every((flag) =>
      surface.options.has(flag),
    ) &&
    optionSupportsValue(
      surface,
      '--permission-mode',
      CLAUDE_CODE_RUNTIME_CLI_CONTRACT.permissionMode,
    )
  const streamingSupported =
    CLAUDE_CODE_RUNTIME_CLI_CONTRACT.streamingFlags.every((flag) =>
      surface.options.has(flag),
    ) &&
    optionSupportsValue(
      surface,
      '--input-format',
      CLAUDE_CODE_RUNTIME_CLI_CONTRACT.inputFormat,
    ) &&
    optionSupportsValue(
      surface,
      '--output-format',
      CLAUDE_CODE_RUNTIME_CLI_CONTRACT.outputFormat,
    )

  if (!executionSupported || !streamingSupported) {
    return incompatibleCompatibility('provider_protocol_error')
  }

  const nativeResumeSupported =
    CLAUDE_CODE_RUNTIME_CLI_CONTRACT.nativeResumeFlags.every((flag) =>
      surface.options.has(flag),
    )
  const reasoningControlSupported =
    CLAUDE_CODE_RUNTIME_CLI_CONTRACT.reasoningControlFlags.every((flag) =>
      surface.options.has(flag),
    ) &&
    CLAUDE_CODE_RUNTIME_CLI_CONTRACT.effortLevels.every((level) =>
      optionSupportsValue(surface, '--effort', level),
    )
  const sessionDiscoverySupported =
    sessionStoreAffinityEstablished &&
    version !== undefined &&
    isClaudeSessionDiscoveryVersionSupported(version)
  const shippedProtocolEvidence =
    version !== undefined && isClaudeCodeTestedVersion(version)
  const fileReadSupport = shippedProtocolEvidence
    ? 'supported'
    : optionSupportsValue(surface, '--tools', 'Read')
      ? 'supported'
      : 'unknown'
  const searchSupport = shippedProtocolEvidence
    ? 'supported'
    : optionSupportsValue(surface, '--tools', 'Glob') &&
        optionSupportsValue(surface, '--tools', 'Grep')
      ? 'supported'
      : 'unknown'
  // Tool events are an already-enabled CodeTether policy capability, not a
  // capability expansion. For an unknown revision, the exact stream-json
  // input/output contract plus the exact restricted Read/Glob/Grep tool
  // values is sufficient for an unverified execution admission; the strict
  // runtime normalizer still fails closed if the Provider later emits an
  // incompatible envelope.
  const toolEventSupport =
    shippedProtocolEvidence ||
    (fileReadSupport === 'supported' && searchSupport === 'supported')
      ? 'supported'
      : 'unknown'

  // CodeTether's frozen Claude execution profile always admits only
  // Read/Glob/Grep and normalizes their structured lifecycle. Those are
  // required runtime contracts, not optional product features. A revision
  // that cannot establish them remains safely blocked while discovery,
  // native resume, and reasoning control can degrade independently.
  if (
    fileReadSupport !== 'supported' ||
    searchSupport !== 'supported' ||
    toolEventSupport !== 'supported'
  ) {
    return incompatibleCompatibility('provider_protocol_error')
  }

  return compatibleCompatibility(
    shippedProtocolEvidence ? 'verified' : 'compatible_unverified',
    {
      nativeResume: booleanSupport(nativeResumeSupported),
      nativeSessionDiscovery: booleanSupport(sessionDiscoverySupported),
      fileRead: fileReadSupport,
      search: searchSupport,
      toolEvents: toolEventSupport,
      reasoningControl: booleanSupport(reasoningControlSupported),
    },
  )
}

interface ClaudeCodeHelpSurface {
  readonly options: ReadonlyMap<string, string>
}

/**
 * Parses only option declaration blocks from provider-owned help. Referencing
 * a flag in prose is not sufficient evidence that the executable accepts it.
 */
function parseClaudeCodeHelp(help: string): ClaudeCodeHelpSurface {
  const options = new Map<string, string>()
  let currentFlags: readonly string[] = []
  let currentLines: string[] = []
  const flush = (): void => {
    if (currentFlags.length === 0) return
    const block = currentLines.join('\n')
    for (const flag of currentFlags) options.set(flag, block)
  }

  for (const line of help.split(/\r?\n/u)) {
    const trimmed = line.trimStart()
    const indentation = line.length - trimmed.length
    if (indentation <= 8 && trimmed.startsWith('-')) {
      const descriptionStart = trimmed.search(/\s{2,}/u)
      const declaration =
        descriptionStart < 0 ? trimmed : trimmed.slice(0, descriptionStart)
      const flags = [...declaration.matchAll(/--[A-Za-z][A-Za-z-]*/gu)].map(
        (match) => match[0],
      )
      if (flags.length > 0) {
        flush()
        currentFlags = flags
        currentLines = [line]
        continue
      }
    }
    if (currentFlags.length > 0) currentLines.push(line)
  }
  flush()
  return { options }
}

function optionSupportsValue(
  surface: ClaudeCodeHelpSurface,
  flag: string,
  value: string,
): boolean {
  const block = surface.options.get(flag)
  if (block === undefined) return false
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}([^A-Za-z0-9_-]|$)`, 'u').test(
    block,
  )
}

function compatibleCompatibility(
  state: 'verified' | 'compatible_unverified',
  optionalSupport: {
    readonly nativeResume: ClaudeCodeObservedSupport
    readonly nativeSessionDiscovery: ClaudeCodeObservedSupport
    readonly fileRead: ClaudeCodeObservedSupport
    readonly search: ClaudeCodeObservedSupport
    readonly toolEvents: ClaudeCodeObservedSupport
    readonly reasoningControl: ClaudeCodeObservedSupport
  },
): ClaudeCodeCompatibilityObservation {
  const supportedCapabilities = capabilitySet('supported')
  const limited = Object.values(optionalSupport).some(
    (support) => support !== 'supported',
  )
  return {
    state: limited ? 'limited' : state,
    runtimeReadiness: limited ? 'limited' : 'ready',
    contractVersion: 1,
    capabilities: {
      ...supportedCapabilities,
      nativeResume: optionalCapability(optionalSupport.nativeResume),
      nativeSessionDiscovery: optionalCapability(
        optionalSupport.nativeSessionDiscovery,
      ),
      fileRead: optionalCapability(optionalSupport.fileRead),
      search: optionalCapability(optionalSupport.search),
      toolEvents: optionalCapability(optionalSupport.toolEvents),
      reasoningControl: optionalCapability(optionalSupport.reasoningControl),
    },
  }
}

function optionalCapability(
  observed: ClaudeCodeObservedSupport,
): ClaudeCodeCapabilityObservation {
  return {
    observed,
    enabled: true,
    effective: observed === 'supported',
  }
}

function booleanSupport(supported: boolean): ClaudeCodeObservedSupport {
  return supported ? 'supported' : 'unsupported'
}

function incompatibleCompatibility(
  failureCode: 'provider_protocol_error',
): ClaudeCodeCompatibilityObservation {
  return {
    state: 'incompatible',
    runtimeReadiness: 'blocked',
    contractVersion: 1,
    failureCode,
    capabilities: capabilitySet('unsupported'),
  }
}

function unavailableCompatibility(): ClaudeCodeCompatibilityObservation {
  return {
    state: 'unavailable',
    runtimeReadiness: 'unavailable',
    contractVersion: 1,
    failureCode: 'provider_probe_failed',
    capabilities: capabilitySet('unavailable'),
  }
}

function capabilitySet(
  observed: ClaudeCodeObservedSupport,
): ClaudeCodeCompatibilityObservation['capabilities'] {
  const capability = (): ClaudeCodeCapabilityObservation => ({
    observed,
    // Product policy and Provider observation are independent. A temporary
    // unavailable or incompatible runtime does not rewrite the frozen policy.
    enabled: true,
    effective: observed === 'supported',
  })
  return {
    execution: capability(),
    streaming: capability(),
    nativeResume: capability(),
    nativeSessionDiscovery: capability(),
    fileRead: capability(),
    search: capability(),
    toolEvents: capability(),
    reasoningControl: capability(),
  }
}
