import { spawn } from 'node:child_process'

import {
  ClaudeCodeError,
  ClaudeCodeNotInstalledError,
  ClaudeCodeOwnedProcessCleanupError,
} from './errors.js'
import {
  resolveClaudeCodeRestrictedEnvironment,
  restrictClaudeCodeProcessEnvironment,
} from './configuration.js'
import {
  resolveClaudeCodeLauncher,
  type ClaudeCodeResolutionOptions,
} from './resolution.js'
import {
  CLAUDE_CODE_CAPABILITIES,
  CLAUDE_CODE_PROVIDER,
  isClaudeCodeTestedVersion,
  type ClaudeCodeDetection,
  type ClaudeCodeLauncher,
} from './types.js'
import { classifyClaudeCodeDetectionFailure } from './failure-classifier.js'
import {
  closeOwnedClaudeProcess,
  type ClaudeCodeProcessOwnership,
} from './process.js'

const MAX_DETECTION_OUTPUT_BYTES = 4096
const DEFAULT_DETECTION_TIMEOUT_MS = 5000
const MAX_DETECTION_CLOSE_GRACE_MS = 250
const VERSION_PATTERN = /^(\d+\.\d+\.\d+) \(Claude Code\)$/

class ClaudeCodeDetectionProbeError extends Error {
  constructor(readonly diagnosticCode: string) {
    super('Claude Code detection probe failed.')
  }
}

export interface ClaudeCodeDetectionOptions extends ClaudeCodeResolutionOptions {
  readonly launcher?: ClaudeCodeLauncher
  readonly timeoutMs?: number
  readonly testedVersion?: string
  /** Optional lifecycle cancellation for Node-owned discovery/preparation. */
  readonly signal?: AbortSignal
  /** Node-only opt-in. Local detection keeps direct-child ownership. */
  readonly processOwnership?: ClaudeCodeProcessOwnership
}

export interface ClaudeCodePreparationOptions extends ClaudeCodeDetectionOptions {
  readonly settingsPath?: string
}

export interface ClaudeCodePreparation {
  readonly detection: ClaudeCodeDetection
  /** Controlled execution-health reason derived only from bounded detection. */
  readonly failureReason?: ReturnType<typeof classifyClaudeCodeDetectionFailure>
  /** Returns a fresh secret-bearing environment. Never serialize or log it. */
  runtimeEnvironment(): NodeJS.ProcessEnv
}

export class ClaudeCodeDetector {
  readonly #options: ClaudeCodeDetectionOptions
  #cached?: Promise<ClaudeCodeDetection>

  constructor(options: ClaudeCodeDetectionOptions = {}) {
    this.#options = options
  }

  detect(): Promise<ClaudeCodeDetection> {
    this.#cached ??= this.#detectOnce()
    return this.#cached
  }

  clearCache(): void {
    this.#cached = undefined
  }

  async #detectOnce(): Promise<ClaudeCodeDetection> {
    const startedAt = performance.now()
    try {
      const launcher =
        this.#options.launcher ??
        (await resolveClaudeCodeLauncher(this.#options))
      const versionOutput = await probeVersion(launcher, {
        environment: this.#options.environment,
        timeoutMs: this.#options.timeoutMs,
        signal: this.#options.signal,
        processOwnership: this.#options.processOwnership,
      })
      const match = VERSION_PATTERN.exec(versionOutput)
      if (match?.[1] === undefined) {
        return unavailable('misconfigured', 'version_output_invalid', startedAt)
      }
      const version = match[1]
      const versionSupported =
        this.#options.testedVersion === undefined
          ? isClaudeCodeTestedVersion(version)
          : version === this.#options.testedVersion
      if (!versionSupported) {
        return {
          provider: CLAUDE_CODE_PROVIDER,
          status: 'unsupportedVersion',
          capabilities: CLAUDE_CODE_CAPABILITIES,
          durationMs: elapsedMilliseconds(startedAt),
          version,
          executablePath: launcher.sourcePath,
          launcher,
        }
      }
      const loggedIn = await probeAuthStatus(launcher, {
        environment: this.#options.environment,
        timeoutMs: this.#options.timeoutMs,
        signal: this.#options.signal,
        processOwnership: this.#options.processOwnership,
      })
      if (!loggedIn) {
        return unavailable('misconfigured', 'auth_not_logged_in', startedAt)
      }
      return {
        provider: CLAUDE_CODE_PROVIDER,
        status: 'available',
        capabilities: CLAUDE_CODE_CAPABILITIES,
        durationMs: elapsedMilliseconds(startedAt),
        version,
        executablePath: launcher.sourcePath,
        launcher,
      }
    } catch (error) {
      if (error instanceof ClaudeCodeOwnedProcessCleanupError) throw error
      const status =
        error instanceof ClaudeCodeNotInstalledError
          ? 'notInstalled'
          : 'misconfigured'
      const diagnosticCode =
        error instanceof ClaudeCodeDetectionProbeError
          ? error.diagnosticCode
          : error instanceof ClaudeCodeError
            ? error.code
            : 'version_probe_failed'
      return unavailable(status, diagnosticCode, startedAt)
    }
  }
}

const defaultDetector = new ClaudeCodeDetector()

export function detectClaudeCode(
  options?: ClaudeCodeDetectionOptions,
): Promise<ClaudeCodeDetection> {
  return options === undefined
    ? defaultDetector.detect()
    : new ClaudeCodeDetector(options).detect()
}

/**
 * Prepares the installed CLI once for a Host lifecycle. The returned object is
 * intentionally JSON-safe: secret configuration is retained only by the
 * runtimeEnvironment closure.
 */
export async function prepareClaudeCode(
  options: ClaudeCodePreparationOptions = {},
): Promise<ClaudeCodePreparation> {
  const startedAt = performance.now()
  try {
    const environment = await resolveClaudeCodeRestrictedEnvironment({
      environment: options.environment,
      settingsPath: options.settingsPath,
    })
    const detection = await detectClaudeCode({ ...options, environment })
    const failureReason = classifyClaudeCodeDetectionFailure(detection)
    return {
      detection,
      ...(failureReason === undefined ? {} : { failureReason }),
      runtimeEnvironment: () => ({ ...environment }),
    }
  } catch (error) {
    if (error instanceof ClaudeCodeOwnedProcessCleanupError) throw error
    const diagnosticCode =
      error instanceof ClaudeCodeError ? error.code : 'configuration_invalid'
    let fallbackEnvironment: NodeJS.ProcessEnv = {}
    try {
      fallbackEnvironment = restrictClaudeCodeProcessEnvironment(
        options.environment ?? process.env,
      )
    } catch {
      // A malformed optional environment remains unavailable and crosses no
      // values into a later child process.
    }
    const detection = unavailable('misconfigured', diagnosticCode, startedAt)
    return {
      detection,
      failureReason: classifyClaudeCodeDetectionFailure(detection),
      runtimeEnvironment: () => ({ ...fallbackEnvironment }),
    }
  }
}

interface DetectionProbeOptions {
  readonly environment?: NodeJS.ProcessEnv
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
  readonly processOwnership?: ClaudeCodeProcessOwnership
}

export async function probeClaudeCodeVersion(
  launcher: ClaudeCodeLauncher,
  options: DetectionProbeOptions = {},
): Promise<string> {
  return await probeVersion(launcher, options)
}

export async function probeClaudeCodeAuthStatus(
  launcher: ClaudeCodeLauncher,
  options: DetectionProbeOptions = {},
): Promise<boolean> {
  return await probeAuthStatus(launcher, options)
}

function probeVersion(
  launcher: ClaudeCodeLauncher,
  options: DetectionProbeOptions,
): Promise<string> {
  return probeCommand(launcher, ['--version'], options, 'version_probe')
}

async function probeAuthStatus(
  launcher: ClaudeCodeLauncher,
  options: DetectionProbeOptions,
): Promise<boolean> {
  const output = await probeCommand(
    launcher,
    ['auth', 'status', '--json'],
    options,
    'auth_status_probe',
  )
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    throw new ClaudeCodeDetectionProbeError('auth_status_invalid')
  }
  if (!isObject(parsed) || typeof parsed.loggedIn !== 'boolean') {
    throw new ClaudeCodeDetectionProbeError('auth_status_invalid')
  }
  return parsed.loggedIn
}

function probeCommand(
  launcher: ClaudeCodeLauncher,
  arguments_: readonly string[],
  options: DetectionProbeOptions,
  diagnosticPrefix: 'version_probe' | 'auth_status_probe',
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DETECTION_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('timeoutMs must be a positive safe integer')
  }
  const processOwnership = options.processOwnership ?? 'direct-child'
  validateProbeProcessOwnership(processOwnership)
  if (options.signal?.aborted === true) {
    throw new ClaudeCodeDetectionProbeError(`${diagnosticPrefix}_aborted`)
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      launcher.executable,
      [...launcher.prefixArguments, ...arguments_],
      {
        env:
          options.environment ??
          restrictClaudeCodeProcessEnvironment(process.env),
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: processOwnership === 'posix-process-group',
      },
    )
    const stdout: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let cleaningAfterClose = false
    let forcedFailure: ClaudeCodeDetectionProbeError | undefined

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      callback()
    }
    const failAndClose = (failure: ClaudeCodeDetectionProbeError) => {
      if (settled || cleaningAfterClose || forcedFailure !== undefined) return
      forcedFailure = failure
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      void closeOwnedClaudeProcess(
        child,
        Math.min(timeoutMs, MAX_DETECTION_CLOSE_GRACE_MS),
        processOwnership,
      ).then(
        () => finish(() => reject(failure)),
        (error) =>
          finish(() =>
            reject(
              error instanceof ClaudeCodeOwnedProcessCleanupError
                ? error
                : new ClaudeCodeOwnedProcessCleanupError(
                    error instanceof Error ? { cause: error } : undefined,
                  ),
            ),
          ),
      )
    }
    const abort = () =>
      failAndClose(
        new ClaudeCodeDetectionProbeError(`${diagnosticPrefix}_aborted`),
      )
    const timer = setTimeout(
      () =>
        failAndClose(
          new ClaudeCodeDetectionProbeError(`${diagnosticPrefix}_timeout`),
        ),
      timeoutMs,
    )
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted === true) abort()

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength
      if (stdoutBytes <= MAX_DETECTION_OUTPUT_BYTES) stdout.push(chunk)
      else {
        failAndClose(
          new ClaudeCodeDetectionProbeError(`${diagnosticPrefix}_failed`),
        )
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength
      if (stderrBytes > MAX_DETECTION_OUTPUT_BYTES) {
        failAndClose(
          new ClaudeCodeDetectionProbeError(`${diagnosticPrefix}_failed`),
        )
      }
    })
    child.once('error', () => {
      if (cleaningAfterClose || forcedFailure !== undefined) return
      const failure = new ClaudeCodeDetectionProbeError(
        `${diagnosticPrefix}_failed`,
      )
      if (child.pid === undefined) finish(() => reject(failure))
      else failAndClose(failure)
    })
    child.once('close', (code) => {
      if (forcedFailure !== undefined) return
      const finishAfterOwnedCleanup = () =>
        finish(() => {
          if (
            code !== 0 ||
            stdoutBytes > MAX_DETECTION_OUTPUT_BYTES ||
            stderrBytes > MAX_DETECTION_OUTPUT_BYTES
          ) {
            reject(
              new ClaudeCodeDetectionProbeError(`${diagnosticPrefix}_failed`),
            )
            return
          }
          resolve(Buffer.concat(stdout).toString('utf8').trim())
        })
      if (processOwnership === 'direct-child') {
        finishAfterOwnedCleanup()
        return
      }
      cleaningAfterClose = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      void closeOwnedClaudeProcess(
        child,
        Math.min(timeoutMs, MAX_DETECTION_CLOSE_GRACE_MS),
        processOwnership,
      ).then(finishAfterOwnedCleanup, (error) =>
        finish(() =>
          reject(
            error instanceof ClaudeCodeOwnedProcessCleanupError
              ? error
              : new ClaudeCodeOwnedProcessCleanupError(
                  error instanceof Error ? { cause: error } : undefined,
                ),
          ),
        ),
      )
    })
  })
}

function validateProbeProcessOwnership(
  ownership: ClaudeCodeProcessOwnership,
): void {
  if (ownership !== 'direct-child' && ownership !== 'posix-process-group') {
    throw new TypeError('Claude Code process ownership is invalid')
  }
  if (ownership === 'posix-process-group' && process.platform === 'win32') {
    throw new TypeError('POSIX process-group ownership is unavailable')
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unavailable(
  status: 'notInstalled' | 'misconfigured',
  diagnosticCode: string,
  startedAt: number,
): ClaudeCodeDetection {
  return {
    provider: CLAUDE_CODE_PROVIDER,
    status,
    capabilities: CLAUDE_CODE_CAPABILITIES,
    durationMs: elapsedMilliseconds(startedAt),
    diagnosticCode,
  }
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt))
}
