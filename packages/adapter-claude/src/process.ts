import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process'
import { isAbsolute } from 'node:path'

import type { AgentEvent } from '@codetether/agent-core'

import { restrictClaudeCodeProcessEnvironment } from './configuration.js'
import {
  asClaudeCodeError,
  ClaudeCodeError,
  ClaudeCodeOwnedProcessCleanupError,
  ClaudeCodeProcessExitError,
  ClaudeCodeProtocolError,
  ClaudeCodeSessionLostError,
  ClaudeCodeStartError,
  ClaudeCodeTurnInterruptedError,
} from './errors.js'
import { ClaudeJsonLineDecoder, parseClaudeJsonLine } from './jsonl.js'
import { ClaudeStreamNormalizer } from './normalizer.js'
import {
  CLAUDE_CODE_EFFORT_LEVELS,
  type ClaudeCodeEffort,
  type ClaudeCodeLauncher,
  type ClaudeCodeTurnResult,
} from './types.js'

export const MAX_CLAUDE_PROMPT_BYTES = 1024 * 1024
const DEFAULT_CLOSE_GRACE_MS = 2000
const OWNERSHIP_ESTABLISHMENT_TIMEOUT_MS = 8_000
const EVENT_BATCH_HIGH_WATER = 4
const EVENT_BATCH_LOW_WATER = 1
const EVENT_BATCH_HARD_LIMIT = 64
const MAXIMUM_EVENTS_PER_DISPATCH_BATCH = 16
const PARENT_CLAUDE_CONTROL_VARIABLES = new Set([
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_PARENT_SESSION_ID',
  'CLAUDE_CODE_REMOTE',
  'CLAUDE_CODE_REMOTE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ACCESS_TOKEN',
  'CLAUDE_CODE_AGENT',
  'CLAUDE_CODE_AGENT_ID',
  'CLAUDE_CODE_AGENT_NAME',
  'CLAUDE_CODE_TEAM_NAME',
  'CLAUDE_CODE_TEAMMATE_COMMAND',
])
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface ClaudeCodeTurnProcessOptions {
  readonly launcher: ClaudeCodeLauncher
  readonly sessionId: string
  readonly turnId: string
  readonly cwd: string
  readonly prompt: string
  readonly resume: boolean
  readonly effort?: ClaudeCodeEffort
  readonly environment?: NodeJS.ProcessEnv
  readonly testedVersion?: string
  /** Node-only opt-in. Local Claude keeps direct-child ownership. */
  readonly processOwnership?: ClaudeCodeProcessOwnership
  /** Node-private ownership seam. It is never populated from wire input. */
  readonly processFactory?: ClaudeCodeProcessFactory
  readonly onEvent: (event: AgentEvent) => void | Promise<void>
}

export type ClaudeCodeProcessOwnership = 'direct-child' | 'posix-process-group'

export interface ClaudeCodeProcessSpecification {
  readonly executable: string
  readonly arguments: readonly string[]
  readonly cwd: string
  readonly environment: NodeJS.ProcessEnv
}

export interface ClaudeCodeProcessController {
  readonly child: ChildProcessWithoutNullStreams
  readonly ownershipEstablished?: Promise<void>
  close(graceMs?: number): Promise<void>
}

export type ClaudeCodeProcessFactory = (
  specification: ClaudeCodeProcessSpecification,
) => ClaudeCodeProcessController

export interface ClaudeCodeTurnProcessHandle {
  readonly child: ChildProcessWithoutNullStreams
  /** Resolves only after spawn and bounded Prompt-stdin acceptance. */
  readonly ownershipEstablished: Promise<void>
  readonly completion: Promise<ClaudeCodeTurnResult>
  close(): Promise<void>
}

export function buildClaudeCodeArguments(options: {
  readonly sessionId: string
  readonly resume: boolean
  readonly effort?: ClaudeCodeEffort
}): string[] {
  validateSessionId(options.sessionId)
  validateEffort(options.effort)
  return [
    '--print',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    options.resume ? '--resume' : '--session-id',
    options.sessionId,
    '--restricted',
    '--strict-mcp-config',
    '--tools',
    'Read,Glob,Grep',
    '--allowedTools',
    'Read,Glob,Grep',
    '--permission-mode',
    'dontAsk',
    ...(options.effort === undefined ? [] : ['--effort', options.effort]),
    '--no-chrome',
    '--disable-slash-commands',
  ]
}

export function encodeClaudeUserMessage(prompt: string): string {
  const promptBytes = Buffer.byteLength(prompt, 'utf8')
  if (promptBytes === 0 || promptBytes > MAX_CLAUDE_PROMPT_BYTES) {
    throw new RangeError(
      `prompt must contain between 1 and ${String(MAX_CLAUDE_PROMPT_BYTES)} UTF-8 bytes`,
    )
  }
  return `${JSON.stringify({
    type: 'user',
    message: { role: 'user', content: prompt },
    parent_tool_use_id: null,
  })}\n`
}

export function sanitizeClaudeChildEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const restricted = restrictClaudeCodeProcessEnvironment(environment)
  return Object.fromEntries(
    Object.entries(restricted).filter(
      ([name]) => !PARENT_CLAUDE_CONTROL_VARIABLES.has(name.toUpperCase()),
    ),
  )
}

export function startClaudeCodeTurnProcess(
  options: ClaudeCodeTurnProcessOptions,
): ClaudeCodeTurnProcessHandle {
  validateTurnOptions(options)
  const processOwnership = options.processOwnership ?? 'direct-child'
  const arguments_ = [
    ...options.launcher.prefixArguments,
    ...buildClaudeCodeArguments(options),
  ]
  const environment = sanitizeClaudeChildEnvironment(
    options.environment ?? process.env,
  )
  const controller = options.processFactory?.({
    executable: options.launcher.executable,
    arguments: arguments_,
    cwd: options.cwd,
    environment,
  })
  const child =
    controller?.child ??
    spawn(options.launcher.executable, arguments_, {
      cwd: options.cwd,
      env: environment,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: processOwnership === 'posix-process-group',
    })
  // Observe a controller rejection immediately. Some guardians can reject
  // before the stdin completion callback is reached; leaving that original
  // Promise temporarily unhandled could leak private controller diagnostics
  // through the process-wide unhandled-rejection path.
  const providerOwnershipOutcome = (
    controller?.ownershipEstablished ?? Promise.resolve()
  ).then(
    () => ({ status: 'fulfilled' }) as const,
    (error: unknown) => ({ status: 'rejected', error }) as const,
  )
  const decoder = new ClaudeJsonLineDecoder()
  const normalizer = new ClaudeStreamNormalizer({
    sessionId: options.sessionId,
    turnId: options.turnId,
    cwd: options.cwd,
    ...(options.testedVersion === undefined
      ? {}
      : { testedVersion: options.testedVersion }),
  })
  let processingError: unknown
  let closeRequested = false
  let eventQueue = Promise.resolve()
  let pendingEventBatches = 0
  let stdoutPaused = false
  let ownershipSettled = false
  let ownershipEstablishedSuccessfully = false
  let promptDeliveryStarted = false
  let resolveOwnership!: () => void
  let rejectOwnership!: (error: unknown) => void
  const ownershipEstablished = new Promise<void>((resolve, reject) => {
    resolveOwnership = resolve
    rejectOwnership = reject
  })
  // Local callers historically await completion only. Retain that contract
  // while exposing a separate Node-only startup acknowledgement.
  void ownershipEstablished.catch(() => undefined)
  const ownershipTimer = setTimeout(() => {
    rememberError(ownershipFailure())
  }, OWNERSHIP_ESTABLISHMENT_TIMEOUT_MS)

  const settleOwnership = (error?: unknown) => {
    if (ownershipSettled) return
    ownershipSettled = true
    clearTimeout(ownershipTimer)
    if (error === undefined) {
      ownershipEstablishedSuccessfully = true
      resolveOwnership()
    } else rejectOwnership(error)
  }

  const rememberError = (error: unknown) => {
    processingError ??= error
    settleOwnership(classifyProcessingFailure(error))
    if (child.exitCode === null && child.signalCode === null) {
      if (controller === undefined) {
        signalOwnedClaudeProcess(child, 'SIGTERM', processOwnership)
      } else {
        void controller.close(DEFAULT_CLOSE_GRACE_MS).catch((cleanupError) => {
          processingError ??= cleanupError
        })
      }
    }
  }

  const ownershipFailure = (cause?: unknown): ClaudeCodeStartError =>
    new ClaudeCodeStartError({
      ...(cause instanceof Error ? { cause } : {}),
      failureReason: promptDeliveryStarted
        ? 'execution_ownership_uncertain'
        : 'provider_start_failed',
    })

  const classifyProcessingFailure = (error: unknown): ClaudeCodeError => {
    // Structured adapter errors retain their precise safe classification.
    // Once stdin delivery has begun, however, an unclassified callback,
    // controller, or cleanup failure cannot prove that Claude did not act.
    // It must never collapse back to the replay-safe startup category.
    if (promptDeliveryStarted && !(error instanceof ClaudeCodeError)) {
      return ownershipFailure(error)
    }
    return asClaudeCodeError(error)
  }

  const publish = (events: readonly AgentEvent[]) => {
    if (events.length === 0) return
    if (pendingEventBatches >= EVENT_BATCH_HARD_LIMIT) {
      rememberError(
        new ClaudeCodeProtocolError({
          failureReason: 'output_limit_exceeded',
        }),
      )
      return
    }
    pendingEventBatches += 1
    if (
      pendingEventBatches >= EVENT_BATCH_HIGH_WATER &&
      !stdoutPaused &&
      !child.stdout.destroyed
    ) {
      child.stdout.pause()
      stdoutPaused = true
    }
    eventQueue = eventQueue
      .then(async () => {
        for (const event of events) await options.onEvent(event)
      })
      .catch(rememberError)
      .finally(() => {
        pendingEventBatches = Math.max(0, pendingEventBatches - 1)
        if (
          stdoutPaused &&
          pendingEventBatches <= EVENT_BATCH_LOW_WATER &&
          processingError === undefined &&
          !child.stdout.destroyed
        ) {
          stdoutPaused = false
          child.stdout.resume()
        }
      })
  }

  const consumeLines = (lines: readonly string[]) => {
    if (processingError !== undefined) return
    try {
      let events: AgentEvent[] = []
      for (const line of lines) {
        for (const event of normalizer.consume(parseClaudeJsonLine(line))) {
          events.push(event)
          if (events.length >= MAXIMUM_EVENTS_PER_DISPATCH_BATCH) {
            publish(events)
            events = []
          }
        }
      }
      publish(events)
    } catch (error) {
      rememberError(error)
    }
  }

  child.stdout.on('data', (chunk: Buffer) => {
    if (processingError !== undefined) return
    try {
      consumeLines(decoder.push(chunk))
    } catch (error) {
      rememberError(error)
    }
  })
  // stderr is deliberately drained but never retained, logged, or surfaced.
  child.stderr.on('data', () => undefined)
  child.stdin.on('error', (error) => rememberError(ownershipFailure(error)))
  child.once('error', (error) => rememberError(ownershipFailure(error)))
  child.once('spawn', () => {
    try {
      promptDeliveryStarted = true
      child.stdin.end(encodeClaudeUserMessage(options.prompt), () => {
        void providerOwnershipOutcome.then((outcome) => {
          if (outcome.status === 'fulfilled') settleOwnership()
          else rememberError(ownershipFailure(outcome.error))
        })
      })
    } catch (error) {
      rememberError(ownershipFailure(error))
    }
  })

  const completion = new Promise<ClaudeCodeTurnResult>((resolve, reject) => {
    child.once('close', () => {
      void (async () => {
        if (!ownershipSettled) {
          settleOwnership(processingError ?? ownershipFailure())
        }
        if (processingError === undefined) {
          try {
            consumeLines(decoder.end())
          } catch (error) {
            processingError = error
          }
        }
        await eventQueue
        if (
          controller !== undefined ||
          processOwnership === 'posix-process-group'
        ) {
          try {
            if (controller === undefined) {
              await closeOwnedClaudeProcess(
                child,
                DEFAULT_CLOSE_GRACE_MS,
                processOwnership,
              )
            } else await controller.close(DEFAULT_CLOSE_GRACE_MS)
          } catch (error) {
            processingError ??= error
          }
        }

        let failure: ClaudeCodeError | undefined
        if (processingError !== undefined) {
          failure = classifyProcessingFailure(processingError)
        } else if (normalizer.failure !== undefined) {
          failure = normalizer.failure
        } else if (!normalizer.terminal || normalizer.result === undefined) {
          if (closeRequested) {
            publish(normalizer.interrupt())
            await eventQueue
            reject(new ClaudeCodeTurnInterruptedError())
            return
          }
          failure = !ownershipEstablishedSuccessfully
            ? ownershipFailure()
            : options.resume && !normalizer.initialized
              ? new ClaudeCodeSessionLostError()
              : new ClaudeCodeProcessExitError()
        }

        if (failure !== undefined) {
          publish(normalizer.fail(failure))
          await eventQueue
          reject(failure)
          return
        }
        const result = normalizer.result
        if (result === undefined) {
          const error = new ClaudeCodeProtocolError()
          publish(normalizer.fail(error))
          await eventQueue
          reject(error)
          return
        }
        resolve(result)
      })().catch((error: unknown) => reject(classifyProcessingFailure(error)))
    })
  })

  return {
    child,
    ownershipEstablished,
    completion,
    async close() {
      closeRequested = true
      if (controller === undefined) {
        await closeOwnedClaudeProcess(
          child,
          DEFAULT_CLOSE_GRACE_MS,
          processOwnership,
        )
      } else await controller.close(DEFAULT_CLOSE_GRACE_MS)
    },
  }
}

export async function closeOwnedClaudeProcess(
  child: ChildProcess,
  graceMs = DEFAULT_CLOSE_GRACE_MS,
  ownership: ClaudeCodeProcessOwnership = 'direct-child',
): Promise<void> {
  if (!Number.isSafeInteger(graceMs) || graceMs < 0) {
    throw new RangeError('graceMs must be a non-negative safe integer')
  }
  validateProcessOwnership(ownership)
  if (
    ownership === 'direct-child' &&
    (child.exitCode !== null || child.signalCode !== null)
  ) {
    return
  }

  child.stdin?.end()
  if (await waitForOwnedExit(child, graceMs, ownership)) return
  signalOwnedClaudeProcess(child, 'SIGTERM', ownership)
  if (await waitForOwnedExit(child, graceMs, ownership)) return
  signalOwnedClaudeProcess(child, 'SIGKILL', ownership)
  if (await waitForOwnedExit(child, graceMs, ownership)) return
  throw new ClaudeCodeOwnedProcessCleanupError()
}

function validateTurnOptions(options: ClaudeCodeTurnProcessOptions): void {
  validateSessionId(options.sessionId)
  validateEffort(options.effort)
  if (!isAbsolute(options.cwd)) throw new TypeError('cwd must be absolute')
  if (options.turnId.length === 0 || options.turnId.length > 128) {
    throw new RangeError('turnId must contain between 1 and 128 characters')
  }
  encodeClaudeUserMessage(options.prompt)
  validateProcessOwnership(options.processOwnership ?? 'direct-child')
}

function validateProcessOwnership(ownership: ClaudeCodeProcessOwnership): void {
  if (ownership === 'posix-process-group' && process.platform === 'win32') {
    throw new TypeError('POSIX process-group ownership is unavailable')
  }
}

function validateEffort(effort: string | undefined): void {
  if (
    effort !== undefined &&
    !(CLAUDE_CODE_EFFORT_LEVELS as readonly string[]).includes(effort)
  ) {
    throw new TypeError('effort must be a supported Claude Code level')
  }
}

function validateSessionId(sessionId: string): void {
  if (!UUID_PATTERN.test(sessionId)) {
    throw new TypeError('sessionId must be a UUID')
  }
}

async function waitForExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true
  return await new Promise((resolve) => {
    const onClose = () => {
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

async function waitForOwnedExit(
  child: ChildProcess,
  timeoutMs: number,
  ownership: ClaudeCodeProcessOwnership,
): Promise<boolean> {
  if (ownership === 'direct-child') return await waitForExit(child, timeoutMs)
  const pid = child.pid
  if (pid === undefined || !processGroupAlive(pid)) return true
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 25))
    if (!processGroupAlive(pid)) return true
  }
  return !processGroupAlive(pid)
}

function signalOwnedClaudeProcess(
  child: ChildProcess,
  signal: NodeJS.Signals,
  ownership: ClaudeCodeProcessOwnership,
): void {
  if (ownership === 'direct-child') {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal)
    return
  }
  const pid = child.pid
  if (pid === undefined) return
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if (!isMissingProcessError(error)) throw error
  }
}

function processGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    if (isMissingProcessError(error)) return false
    return true
  }
}

function isMissingProcessError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ESRCH'
  )
}
