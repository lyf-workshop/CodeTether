import { spawn } from 'node:child_process'
import { spawnCodexCompatibilityProcess } from './probe-supervision.js'
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { CodexAppServerClient } from './client.js'
import { CodexOwnedProcessCleanupError } from './errors.js'
import {
  fingerprintCodexInstallation,
  type CodexInstallationCandidate,
} from './installation.js'
import {
  observeCodexBackendConfiguration,
  unobservedCodexBackendProviderSettings,
  type CodexBackendConfigurationObservation,
  type CodexBackendProviderSettingsObservation,
} from './backend.js'
import {
  sanitizeCodexProbeEnvironment,
  type RemoteCodexProcessFactory,
} from './process.js'

const VERSION_PATTERN = /^(?:codex-cli|codex)\s+(\d+\.\d+\.\d+)$/u
const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_MAXIMUM_OUTPUT_BYTES = 64 * 1024
const MAXIMUM_CLOSE_GRACE_MS = 250
const MAXIMUM_SCHEMA_FILE_BYTES = 1024 * 1024
const MAXIMUM_SCHEMA_NODES = 100_000

export const CODEX_TESTED_VERSIONS = ['0.149.1'] as const

export type CodexCompatibilityState =
  | 'verified'
  | 'compatible_unverified'
  | 'limited'
  | 'incompatible'
  | 'unavailable'

export type CodexObservedSupport =
  'supported' | 'unsupported' | 'unavailable' | 'unknown'

export interface CodexCapabilityObservation {
  readonly observed: CodexObservedSupport
  readonly enabled: boolean
  readonly effective: boolean
}

export interface CodexCompatibilityObservation {
  readonly state: CodexCompatibilityState
  readonly runtimeReadiness: 'ready' | 'limited' | 'blocked' | 'unavailable'
  readonly contractVersion: 1
  readonly capabilities: {
    readonly execution: CodexCapabilityObservation
    readonly streaming: CodexCapabilityObservation
    readonly nativeResume: CodexCapabilityObservation
    readonly nativeSessionDiscovery: CodexCapabilityObservation
    readonly fileRead: CodexCapabilityObservation
    readonly search: CodexCapabilityObservation
    readonly toolEvents: CodexCapabilityObservation
    readonly reasoningControl: CodexCapabilityObservation
  }
  /** Private probe classification; public Protocol v1 maps it to provider_start_failed. */
  readonly failureCode?: 'provider_probe_failed' | 'provider_protocol_error'
}

export interface CodexInstallationObservation {
  readonly installation: CodexInstallationCandidate
  readonly version?: string
  /** Private executable digest; derive an opaque Machine-scoped wire revision. */
  readonly privateRevision?: string
  readonly compatibility: CodexCompatibilityObservation
  readonly backend: CodexBackendConfigurationObservation & {
    readonly readiness:
      | 'unknown'
      | 'ready'
      | 'unavailable'
      | 'authentication_required'
      | 'misconfigured'
  }
  readonly runtimeEnvironment: () => NodeJS.ProcessEnv
}

export interface CodexRuntimeContractProbeResult {
  /** Exact app-server argv and initialized stdio protocol were accepted. */
  readonly execution: boolean
  /** The shipped incremental notification envelope remains observable. */
  readonly streaming: boolean
  /**
   * False means only the executable/help/initialize surface was established;
   * the required Turn methods and streaming notifications were not available
   * from Provider-owned schema metadata. Omitted values are reserved for
   * explicit deterministic test seams that directly assert the full contract.
   */
  readonly requiredMethodsObserved?: boolean
  /** Independent, conversation-specific native continuation contract. */
  readonly nativeResume: boolean | undefined
  /** Schema half of Phase 8A list/read support; metadata access is rechecked. */
  readonly nativeSessionDiscovery: boolean | undefined
}

export interface ObserveCodexInstallationOptions {
  readonly installation: CodexInstallationCandidate
  readonly environment?: NodeJS.ProcessEnv
  readonly verifiedVersions?: readonly string[]
  readonly timeoutMs?: number
  readonly maximumOutputBytes?: number
  readonly signal?: AbortSignal
  /** Exact remote Provider state root; enables the Node-owned metadata probe. */
  readonly codexHome?: string
  /** Existing absolute directory used only as a thread/list metadata filter. */
  readonly probeWorkingDirectory?: string
  /** Node-private guardian seam; never supplied by a Machine request. */
  readonly processFactory?: RemoteCodexProcessFactory
  /** Internal deterministic-test seam; product code uses bounded probes. */
  readonly probeVersion?: () => Promise<string>
  /** Internal deterministic-test seam; product code uses bounded probes. */
  readonly probeContract?: () => Promise<
    boolean | CodexRuntimeContractProbeResult
  >
  /** Preferred granular deterministic-test seam. */
  readonly probeRuntimeContract?: () => Promise<CodexRuntimeContractProbeResult>
  /** Optional metadata-only thread list/read compatibility probe. */
  readonly probeSessionDiscoveryContract?: () => Promise<boolean | undefined>
  /** Internal deterministic-test seam for effective Provider settings. */
  readonly probeBackendConfiguration?: () => Promise<CodexBackendProviderSettingsObservation>
  /** Internal deterministic-test seam for synthetic executable revisions. */
  readonly fingerprint?: () => Promise<string>
}

/** Shared local/Node zero-inference installation and contract observation. */
export async function observeCodexInstallation(
  options: ObserveCodexInstallationOptions,
): Promise<CodexInstallationObservation> {
  const environment = { ...(options.environment ?? process.env) }
  const providerSettings = await observeCodexProviderSettings(
    options,
    environment,
  )
  const probe = (arguments_: readonly string[]): Promise<string> =>
    runBoundedCodexProbe({
      executable: options.installation.executable,
      arguments: arguments_,
      environment,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maximumOutputBytes:
        options.maximumOutputBytes ?? DEFAULT_MAXIMUM_OUTPUT_BYTES,
      signal: options.signal,
    })
  let version: string | undefined
  let privateRevision: string | undefined
  let compatibility: CodexCompatibilityObservation
  try {
    // Keep the selected logical installation observable even if its bounded
    // version/contract probe fails. The Node can then report it unavailable
    // without silently selecting a different PATH candidate.
    privateRevision = await (options.fingerprint?.() ??
      fingerprintCodexInstallation(options.installation, options.signal))
    if (options.installation.shellFreeLaunch === false) {
      // An opaque script/cmd wrapper cannot satisfy the exact shell:false
      // installation identity contract. Keep it observable, but never run it
      // merely to obtain a plausible version string.
      compatibility = incompatibleCompatibility({
        execution: false,
        streaming: false,
        nativeResume: undefined,
        nativeSessionDiscovery: undefined,
      })
    } else {
      const output = await (options.probeVersion?.() ?? probe(['--version']))
      version = VERSION_PATTERN.exec(output.trim())?.[1]
      const runtimeContract = options.probeRuntimeContract
        ? await options.probeRuntimeContract()
        : options.probeContract
          ? normalizeLegacyContract(await options.probeContract())
          : await probeCodexRuntimeContracts({
              installation: options.installation,
              environment,
              ...(options.codexHome === undefined
                ? {}
                : { codexHome: options.codexHome }),
              ...(options.processFactory === undefined
                ? {}
                : { processFactory: options.processFactory }),
              timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
              maximumOutputBytes:
                options.maximumOutputBytes ?? DEFAULT_MAXIMUM_OUTPUT_BYTES,
              ...(options.signal === undefined
                ? {}
                : { signal: options.signal }),
            })
      let discoveryContract = runtimeContract.nativeSessionDiscovery
      if (
        runtimeContract.execution &&
        runtimeContract.streaming &&
        runtimeContract.nativeSessionDiscovery !== false
      ) {
        try {
          if (options.probeSessionDiscoveryContract !== undefined) {
            discoveryContract = await raceCodexContractWithAbort(
              options.probeSessionDiscoveryContract(),
              options.signal,
            )
          } else if (runtimeContract.nativeSessionDiscovery === true) {
            discoveryContract = await probeCodexSessionDiscoveryContract({
              installation: options.installation,
              environment,
              ...(options.codexHome === undefined
                ? {}
                : { codexHome: options.codexHome }),
              ...(options.probeWorkingDirectory === undefined
                ? {}
                : { workingDirectory: options.probeWorkingDirectory }),
              ...(options.processFactory === undefined
                ? {}
                : { processFactory: options.processFactory }),
              timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
              ...(options.signal === undefined
                ? {}
                : { signal: options.signal }),
            })
          }
        } catch (error) {
          if (error instanceof CodexOwnedProcessCleanupError) throw error
          options.signal?.throwIfAborted()
          // Enumeration is optional. A failed metadata-only contract probe
          // limits Phase 8A discovery without blocking normal execution.
          discoveryContract = undefined
        }
      }
      compatibility =
        runtimeContract.execution &&
        runtimeContract.streaming &&
        (runtimeContract.requiredMethodsObserved !== false ||
          (version !== undefined &&
            (options.verifiedVersions ?? CODEX_TESTED_VERSIONS).includes(
              version,
            )))
          ? compatibleCompatibility(
              version !== undefined &&
                (options.verifiedVersions ?? CODEX_TESTED_VERSIONS).includes(
                  version,
                )
                ? 'verified'
                : 'compatible_unverified',
              runtimeContract.nativeResume,
              discoveryContract,
            )
          : incompatibleCompatibility(runtimeContract)
    }
  } catch (error) {
    if (error instanceof CodexOwnedProcessCleanupError) throw error
    options.signal?.throwIfAborted()
    compatibility = unavailableCompatibility()
  }
  const backend = observeCodexBackendConfiguration(
    environment,
    providerSettings,
  )
  return {
    installation: options.installation,
    ...(version === undefined ? {} : { version }),
    ...(privateRevision === undefined ? {} : { privateRevision }),
    compatibility,
    backend: {
      ...backend,
      readiness: backend.configurationValid ? 'unknown' : 'misconfigured',
    },
    runtimeEnvironment: () => ({ ...environment }),
  }
}

async function observeCodexProviderSettings(
  options: ObserveCodexInstallationOptions,
  environment: NodeJS.ProcessEnv,
): Promise<CodexBackendProviderSettingsObservation> {
  if (options.probeBackendConfiguration !== undefined) {
    return await options.probeBackendConfiguration()
  }
  if (
    options.probeVersion !== undefined ||
    options.probeContract !== undefined ||
    options.probeRuntimeContract !== undefined
  ) {
    return unobservedCodexBackendProviderSettings()
  }
  const codexHome = effectiveCodexHome(environment, options.codexHome)
  let client: CodexAppServerClient | undefined
  try {
    client = await CodexAppServerClient.launchConfigurationProbe({
      executable: options.installation.executable,
      codexHome,
      environment,
      ...(options.processFactory === undefined
        ? {}
        : { processFactory: options.processFactory }),
      requestTimeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })
    return await client.readBackendConfiguration(environment)
  } catch (error) {
    if (error instanceof CodexOwnedProcessCleanupError) throw error
    options.signal?.throwIfAborted()
    return unobservedCodexBackendProviderSettings()
  } finally {
    if (client !== undefined) await shutdownCodexCompatibilityClient(client)
  }
}

function effectiveCodexHome(
  environment: NodeJS.ProcessEnv,
  configured: string | undefined,
): string {
  if (configured !== undefined && isAbsolute(configured)) return configured
  const fromEnvironment = environment.CODEX_HOME
  if (fromEnvironment !== undefined && isAbsolute(fromEnvironment)) {
    return fromEnvironment
  }
  const home = environment.HOME?.trim() || environment.USERPROFILE?.trim()
  return join(
    home === undefined || home.length === 0 ? homedir() : home,
    '.codex',
  )
}

/**
 * Proves Codex's official thread/list surface through an initialized App
 * Server without creating a thread or Turn. The exact client is always closed.
 */
export async function probeCodexSessionDiscoveryContract(options: {
  readonly installation: CodexInstallationCandidate
  readonly environment?: NodeJS.ProcessEnv
  readonly codexHome?: string
  readonly workingDirectory?: string
  readonly processFactory?: RemoteCodexProcessFactory
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
  /** Internal deterministic-test seam; product code launches the exact client. */
  readonly clientFactory?: () => Promise<{
    listStoredThreads(options: {
      readonly cwd: string
      readonly limit: number
    }): Promise<unknown>
    shutdown(): Promise<void>
  }>
}): Promise<boolean> {
  const workingDirectory = options.workingDirectory ?? process.cwd()
  if (!isAbsolute(workingDirectory)) {
    throw new TypeError('Codex metadata probe directory must be absolute')
  }
  options.signal?.throwIfAborted()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const clientPromise =
    options.clientFactory?.() ??
    (options.codexHome === undefined
      ? CodexAppServerClient.launch({
          executable: options.installation.executable,
          ...(options.environment === undefined
            ? {}
            : { environment: options.environment }),
          requestTimeoutMs: timeoutMs,
          clientInfo: CODEX_COMPATIBILITY_CLIENT_INFO,
        })
      : CodexAppServerClient.launchRemote({
          executable: options.installation.executable,
          codexHome: options.codexHome,
          ...(options.environment === undefined
            ? {}
            : { environment: options.environment }),
          ...(options.processFactory === undefined
            ? {}
            : { processFactory: options.processFactory }),
          requestTimeoutMs: timeoutMs,
          clientInfo: CODEX_COMPATIBILITY_CLIENT_INFO,
        }))
  let client: Awaited<typeof clientPromise>
  try {
    client = await raceCodexContractWithAbort(clientPromise, options.signal)
  } catch (error) {
    if (options.signal?.aborted === true) {
      try {
        const lateClient = await clientPromise
        await shutdownCodexCompatibilityClient(lateClient)
      } catch (lateError) {
        if (lateError instanceof CodexOwnedProcessCleanupError) throw lateError
      }
    }
    throw error
  }
  try {
    await raceCodexContractWithAbort(
      client.listStoredThreads({ cwd: workingDirectory, limit: 1 }),
      options.signal,
    )
    return true
  } finally {
    await shutdownCodexCompatibilityClient(client)
  }
}

async function raceCodexContractWithAbort<TResult>(
  task: Promise<TResult>,
  signal?: AbortSignal,
): Promise<TResult> {
  if (signal === undefined) return await task
  signal.throwIfAborted()
  return await new Promise<TResult>((resolve, reject) => {
    const abort = (): void =>
      reject(new DOMException('Operation aborted', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    void task.then(
      (result) => {
        signal.removeEventListener('abort', abort)
        resolve(result)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

const CODEX_COMPATIBILITY_CLIENT_INFO = {
  name: 'codetether-provider-compatibility',
  title: 'CodeTether Provider Compatibility',
  version: '1',
} as const

/**
 * Performs no inference and creates no thread or Turn. It first checks the
 * documented command surface, then starts the exact local/remote App Server
 * argv used by CodeTether and completes its real initialize/initialized stdio
 * handshake. Generated Provider-owned schemas are used only as bounded local
 * metadata for method-level optional capability observations.
 */
export async function probeCodexRuntimeContracts(options: {
  readonly installation: CodexInstallationCandidate
  readonly environment: NodeJS.ProcessEnv
  readonly codexHome?: string
  readonly processFactory?: RemoteCodexProcessFactory
  readonly timeoutMs?: number
  readonly maximumOutputBytes?: number
  readonly signal?: AbortSignal
}): Promise<CodexRuntimeContractProbeResult> {
  options.signal?.throwIfAborted()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maximumOutputBytes =
    options.maximumOutputBytes ?? DEFAULT_MAXIMUM_OUTPUT_BYTES
  const probe = (arguments_: readonly string[]): Promise<string> =>
    runBoundedCodexProbe({
      executable: options.installation.executable,
      arguments: arguments_,
      environment: options.environment,
      timeoutMs,
      maximumOutputBytes,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  const rootHelp = await probe(['--help'])
  if (!containsHelpToken(rootHelp, 'app-server')) {
    return unsupportedRuntimeContracts()
  }
  const appServerHelp = await probe(['app-server', '--help'])
  if (
    !containsHelpToken(appServerHelp, '--listen') ||
    !containsHelpToken(appServerHelp, 'stdio://')
  ) {
    return unsupportedRuntimeContracts()
  }

  const client =
    options.codexHome === undefined
      ? await CodexAppServerClient.launch({
          executable: options.installation.executable,
          environment: options.environment,
          requestTimeoutMs: timeoutMs,
          clientInfo: CODEX_COMPATIBILITY_CLIENT_INFO,
        })
      : await CodexAppServerClient.launchRemote({
          executable: options.installation.executable,
          codexHome: options.codexHome,
          environment: options.environment,
          ...(options.processFactory === undefined
            ? {}
            : { processFactory: options.processFactory }),
          requestTimeoutMs: timeoutMs,
          clientInfo: CODEX_COMPATIBILITY_CLIENT_INFO,
        })
  try {
    // launch()/launchRemote() already performed and schema-validated the
    // handshake. Keeping the exact client alive until here makes shutdown
    // ownership explicit even when schema metadata is unavailable.
  } finally {
    await shutdownCodexCompatibilityClient(client)
  }
  options.signal?.throwIfAborted()

  const schema = await probeCodexProtocolSchema({
    installation: options.installation,
    environment: options.environment,
    timeoutMs,
    maximumOutputBytes,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  if (schema === undefined) {
    return {
      execution: true,
      streaming: true,
      requiredMethodsObserved: false,
      nativeResume: undefined,
      nativeSessionDiscovery: undefined,
    }
  }
  return schema
}

/** @internal Converts compatibility-client cleanup uncertainty to one type. */
export async function shutdownCodexCompatibilityClient(
  client: Pick<CodexAppServerClient, 'shutdown'>,
): Promise<void> {
  try {
    await client.shutdown()
  } catch (error) {
    if (error instanceof CodexOwnedProcessCleanupError) throw error
    throw new CodexOwnedProcessCleanupError({ cause: error })
  }
}

async function probeCodexProtocolSchema(options: {
  readonly installation: CodexInstallationCandidate
  readonly environment: NodeJS.ProcessEnv
  readonly timeoutMs: number
  readonly maximumOutputBytes: number
  readonly signal?: AbortSignal
}): Promise<CodexRuntimeContractProbeResult | undefined> {
  options.signal?.throwIfAborted()
  const directory = await mkdtemp(join(tmpdir(), 'codetether-codex-contract-'))
  try {
    try {
      await runBoundedCodexProbe({
        executable: options.installation.executable,
        arguments: ['app-server', 'generate-json-schema', '--out', directory],
        environment: options.environment,
        timeoutMs: options.timeoutMs,
        maximumOutputBytes: options.maximumOutputBytes,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
    } catch (error) {
      if (error instanceof CodexOwnedProcessCleanupError) throw error
      options.signal?.throwIfAborted()
      // Schema generation is a metadata enhancement, not an execution
      // requirement. The initialized exact runtime remains usable, while the
      // method-specific optional capabilities remain unknown.
      return undefined
    }
    const clientRequests = await readSchemaEnumValues(
      join(directory, 'ClientRequest.json'),
    )
    const serverNotifications = await readSchemaEnumValues(
      join(directory, 'ServerNotification.json'),
    )
    if (clientRequests === undefined || serverNotifications === undefined) {
      return undefined
    }
    return {
      execution:
        clientRequests.has('thread/start') && clientRequests.has('turn/start'),
      streaming:
        serverNotifications.has('turn/started') &&
        serverNotifications.has('item/agentMessage/delta') &&
        serverNotifications.has('turn/completed'),
      requiredMethodsObserved: true,
      nativeResume: clientRequests.has('thread/resume'),
      nativeSessionDiscovery:
        clientRequests.has('thread/list') && clientRequests.has('thread/read'),
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function readSchemaEnumValues(
  path: string,
): Promise<ReadonlySet<string> | undefined> {
  try {
    const metadata = await lstat(path)
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size > MAXIMUM_SCHEMA_FILE_BYTES
    ) {
      return undefined
    }
    const source = await readFile(path)
    if (source.byteLength > MAXIMUM_SCHEMA_FILE_BYTES) return undefined
    const parsed: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(source),
    )
    const values = new Set<string>()
    const pending: unknown[] = [parsed]
    let visited = 0
    while (pending.length > 0) {
      visited += 1
      if (visited > MAXIMUM_SCHEMA_NODES) return undefined
      const value = pending.pop()
      if (Array.isArray(value)) {
        for (const entry of value) pending.push(entry)
        continue
      }
      if (typeof value !== 'object' || value === null) continue
      for (const [key, entry] of Object.entries(value)) {
        if (key === 'enum' && Array.isArray(entry)) {
          for (const enumValue of entry) {
            if (typeof enumValue === 'string') values.add(enumValue)
          }
        } else {
          pending.push(entry)
        }
      }
    }
    return values
  } catch {
    return undefined
  }
}

function containsHelpToken(source: string, token: string): boolean {
  return source
    .split(/\s+/u)
    .some((candidate) => candidate.replace(/[,.()[\]{}<>]/gu, '') === token)
}

function normalizeLegacyContract(
  value: boolean | CodexRuntimeContractProbeResult,
): CodexRuntimeContractProbeResult {
  return typeof value === 'boolean'
    ? {
        execution: value,
        streaming: value,
        nativeResume: value,
        nativeSessionDiscovery: value,
      }
    : value
}

function unsupportedRuntimeContracts(): CodexRuntimeContractProbeResult {
  return {
    execution: false,
    streaming: false,
    nativeResume: undefined,
    nativeSessionDiscovery: undefined,
  }
}

export function runBoundedCodexProbe(options: {
  readonly executable: string
  readonly arguments: readonly string[]
  readonly environment: NodeJS.ProcessEnv
  readonly timeoutMs?: number
  readonly maximumOutputBytes?: number
  readonly signal?: AbortSignal
  /** Internal deterministic-test seam; production uses exact owned cleanup. */
  readonly closeOwnedProcess?: typeof closeOwnedProbeProcess
}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maximumOutputBytes =
    options.maximumOutputBytes ?? DEFAULT_MAXIMUM_OUTPUT_BYTES
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('Codex probe timeout is invalid')
  }
  if (
    !Number.isSafeInteger(maximumOutputBytes) ||
    maximumOutputBytes <= 0 ||
    maximumOutputBytes > 1024 * 1024
  ) {
    throw new RangeError('Codex probe output bound is invalid')
  }
  options.signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const { child, processGroupOwned } = spawnCodexCompatibilityProcess({
      executable: options.executable,
      arguments: options.arguments,
      environment: sanitizeCodexProbeEnvironment(options.environment),
      timeoutMs,
    })
    const stdout: Buffer[] = []
    let outputBytes = 0
    let settled = false
    let cleanupStarted = false
    let forcedFailure: Error | undefined
    const finish = (error?: Error, output?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      if (error === undefined) resolve(output ?? '')
      else reject(error)
    }
    const terminate = (error: Error): void => {
      if (settled || cleanupStarted) return
      cleanupStarted = true
      forcedFailure = error
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      void (options.closeOwnedProcess ?? closeOwnedProbeProcess)(
        child,
        Math.min(timeoutMs, MAXIMUM_CLOSE_GRACE_MS),
        processGroupOwned,
      ).then(
        () => finish(error),
        (cleanupError: unknown) =>
          finish(new CodexOwnedProcessCleanupError({ cause: cleanupError })),
      )
    }
    const abort = (): void =>
      terminate(new DOMException('Operation aborted', 'AbortError'))
    const timer = setTimeout(
      () => terminate(new Error('Codex compatibility probe timed out')),
      timeoutMs,
    )
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted === true) abort()
    const consume = (chunk: Buffer, retain: boolean): void => {
      outputBytes += chunk.byteLength
      if (outputBytes > maximumOutputBytes) {
        terminate(
          new Error('Codex compatibility probe output exceeded its bound'),
        )
      } else if (retain) stdout.push(chunk)
    }
    child.stdout.on('data', (chunk: Buffer) => consume(chunk, true))
    child.stderr.on('data', (chunk: Buffer) => consume(chunk, false))
    child.once('error', (error) => {
      if (forcedFailure !== undefined) return
      if (child.pid === undefined) finish(error)
      else terminate(error)
    })
    child.once('close', (code) => {
      if (settled || forcedFailure !== undefined) return
      const complete = (): void => {
        if (code !== 0) {
          finish(new Error('Codex compatibility probe failed'))
          return
        }
        try {
          finish(
            undefined,
            new TextDecoder('utf-8', { fatal: true })
              .decode(Buffer.concat(stdout))
              .trim(),
          )
        } catch {
          finish(new Error('Codex compatibility probe output was invalid'))
        }
      }
      if (!processGroupOwned) {
        complete()
        return
      }
      cleanupStarted = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      void (options.closeOwnedProcess ?? closeOwnedProbeProcess)(
        child,
        Math.min(timeoutMs, MAXIMUM_CLOSE_GRACE_MS),
        true,
      ).then(complete, (cleanupError: unknown) =>
        finish(new CodexOwnedProcessCleanupError({ cause: cleanupError })),
      )
    })
  })
}

async function closeOwnedProbeProcess(
  child: ReturnType<typeof spawn>,
  graceMs: number,
  processGroupOwned: boolean,
): Promise<void> {
  if (await waitForOwnedProbeExit(child, 0, processGroupOwned)) return
  signalOwnedProbeProcess(child, 'SIGTERM', processGroupOwned)
  if (await waitForOwnedProbeExit(child, graceMs, processGroupOwned)) return
  signalOwnedProbeProcess(child, 'SIGKILL', processGroupOwned)
  if (await waitForOwnedProbeExit(child, graceMs, processGroupOwned)) return
  throw new Error('Codex compatibility probe process remained alive')
}

async function waitForOwnedProbeExit(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
  processGroupOwned: boolean,
): Promise<boolean> {
  if (!processGroupOwned) {
    if (child.exitCode !== null || child.signalCode !== null) return true
    if (timeoutMs === 0) return false
    return await new Promise((resolve) => {
      const onClose = (): void => {
        clearTimeout(timer)
        resolve(true)
      }
      const timer = setTimeout(() => {
        child.off('close', onClose)
        resolve(false)
      }, timeoutMs)
      child.once('close', onClose)
    })
  }
  const processGroupId = child.pid
  if (
    processGroupId === undefined ||
    !probeProcessGroupExists(processGroupId)
  ) {
    return true
  }
  if (timeoutMs === 0) return false
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    if (!probeProcessGroupExists(processGroupId)) return true
  }
  return !probeProcessGroupExists(processGroupId)
}

function signalOwnedProbeProcess(
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
  processGroupOwned: boolean,
): void {
  if (!processGroupOwned) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal)
    return
  }
  const processGroupId = child.pid
  if (processGroupId === undefined) return
  try {
    process.kill(-processGroupId, signal)
  } catch (error) {
    if (!isMissingProcess(error)) throw error
  }
}

function probeProcessGroupExists(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0)
    return true
  } catch (error) {
    return !isMissingProcess(error)
  }
}

function isMissingProcess(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ESRCH'
  )
}

function compatibleCompatibility(
  state: 'verified' | 'compatible_unverified',
  nativeResumeSupported: boolean | undefined,
  sessionDiscoverySupported: boolean | undefined,
): CodexCompatibilityObservation {
  const supportedCapabilities = capabilitySet('supported')
  const nativeResume = observedCapability(nativeResumeSupported)
  const nativeSessionDiscovery = observedCapability(sessionDiscoverySupported)
  const limited = !nativeResume.effective || !nativeSessionDiscovery.effective
  return {
    state: limited ? 'limited' : state,
    runtimeReadiness: limited ? 'limited' : 'ready',
    contractVersion: 1,
    capabilities: {
      ...supportedCapabilities,
      nativeResume,
      nativeSessionDiscovery,
    },
  }
}

function incompatibleCompatibility(
  contract: CodexRuntimeContractProbeResult,
): CodexCompatibilityObservation {
  const capabilities = capabilitySet('unsupported', false)
  return {
    state: 'incompatible',
    runtimeReadiness: 'blocked',
    contractVersion: 1,
    failureCode: 'provider_protocol_error',
    capabilities: {
      ...capabilities,
      execution: observedCapability(contract.execution, false),
      streaming: observedCapability(contract.streaming, false),
      nativeResume: observedCapability(contract.nativeResume, false),
      nativeSessionDiscovery: observedCapability(
        contract.nativeSessionDiscovery,
        false,
      ),
    },
  }
}

function unavailableCompatibility(): CodexCompatibilityObservation {
  return {
    state: 'unavailable',
    runtimeReadiness: 'unavailable',
    contractVersion: 1,
    failureCode: 'provider_probe_failed',
    capabilities: capabilitySet('unavailable'),
  }
}

function capabilitySet(
  observed: CodexObservedSupport,
  effectiveAllowed = true,
): CodexCompatibilityObservation['capabilities'] {
  const capability = (): CodexCapabilityObservation => ({
    observed,
    // Adapter policy remains stable while observed support changes.
    enabled: true,
    effective: effectiveAllowed && observed === 'supported',
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

function observedCapability(
  supported: boolean | undefined,
  effectiveAllowed = true,
): CodexCapabilityObservation {
  return {
    observed:
      supported === undefined
        ? 'unknown'
        : supported
          ? 'supported'
          : 'unsupported',
    enabled: true,
    effective: effectiveAllowed && supported === true,
  }
}
