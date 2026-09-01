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
  readonly onEvent: (event: AgentEvent) => void | Promise<void>
}

export type ClaudeCodeProcessOwnership = 'direct-child' | 'posix-process-group'

export interface ClaudeCodeTurnProcessHandle {
  readonly child: ChildProcessWithoutNullStreams
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
  const child = spawn(options.launcher.executable, arguments_, {
    cwd: options.cwd,
    env: sanitizeClaudeChildEnvironment(options.environment ?? process.env),
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    detached: processOwnership === 'posix-process-group',
  })
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

  const rememberError = (error: unknown) => {
    processingError ??= error
    if (child.exitCode === null && child.signalCode === null) {
      signalOwnedClaudeProcess(child, 'SIGTERM', processOwnership)
    }
  }

  const publish = (events: readonly AgentEvent[]) => {
    if (events.length === 0) return
    eventQueue = eventQueue
      .then(async () => {
        for (const event of events) await options.onEvent(event)
      })
      .catch(rememberError)
  }

  const consumeLine = (line: string) => {
    if (processingError !== undefined) return
    try {
      publish(normalizer.consume(parseClaudeJsonLine(line)))
    } catch (error) {
      rememberError(error)
    }
  }

  child.stdout.on('data', (chunk: Buffer) => {
    if (processingError !== undefined) return
    try {
      for (const line of decoder.push(chunk)) consumeLine(line)
    } catch (error) {
      rememberError(error)
    }
  })
  // stderr is deliberately drained but never retained, logged, or surfaced.
  child.stderr.on('data', () => undefined)
  child.stdin.on('error', rememberError)
  child.once('error', rememberError)
  child.once('spawn', () => {
    try {
      child.stdin.end(encodeClaudeUserMessage(options.prompt))
    } catch (error) {
      rememberError(error)
    }
  })

  const completion = new Promise<ClaudeCodeTurnResult>((resolve, reject) => {
    child.once('close', () => {
      void (async () => {
        if (processingError === undefined) {
          try {
            for (const line of decoder.end()) consumeLine(line)
          } catch (error) {
            processingError = error
          }
        }
        await eventQueue
        if (processOwnership === 'posix-process-group') {
          try {
            await closeOwnedClaudeProcess(
              child,
              DEFAULT_CLOSE_GRACE_MS,
              processOwnership,
            )
          } catch (error) {
            processingError ??= error
          }
        }

        let failure: ClaudeCodeError | undefined
        if (processingError !== undefined) {
          failure = asClaudeCodeError(processingError)
        } else if (normalizer.failure !== undefined) {
          failure = normalizer.failure
        } else if (!normalizer.terminal || normalizer.result === undefined) {
          if (closeRequested) {
            publish(normalizer.interrupt())
            await eventQueue
            reject(new ClaudeCodeTurnInterruptedError())
            return
          }
          failure =
            options.resume && !normalizer.initialized
              ? new ClaudeCodeSessionLostError()
              : new ClaudeCodeStartError()
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
      })().catch((error: unknown) => reject(asClaudeCodeError(error)))
    })
  })

  return {
    child,
    completion,
    async close() {
      closeRequested = true
      await closeOwnedClaudeProcess(
        child,
        DEFAULT_CLOSE_GRACE_MS,
        processOwnership,
      )
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
