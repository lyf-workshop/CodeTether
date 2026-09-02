import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process'
import { Socket } from 'node:net'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Readable, Writable } from 'node:stream'

export const INTERNAL_PROVIDER_GUARDIAN_ARGUMENT =
  '--codetether-internal-provider-guardian' as const

const MAXIMUM_GUARDIAN_CONFIGURATION_BYTES = 1024 * 1024
const MAXIMUM_GUARDIAN_CONTROL_BYTES = 128
const GUARDIAN_CLOSE_GRACE_MS = 2_000
const GUARDIAN_OWNERSHIP_TIMEOUT_MS = 8_000

export interface NodeProviderProcessSpecification {
  readonly provider: 'codex' | 'claude-code'
  readonly executable: string
  readonly arguments: readonly string[]
  readonly environment: NodeJS.ProcessEnv
  readonly cwd?: string
}

export interface NodeProviderProcessController {
  readonly child: ChildProcessWithoutNullStreams
  /** Resolves after the guardian reports the exact Provider process-group ID. */
  readonly ownershipEstablished: Promise<void>
  close(graceMs?: number): Promise<void>
}

export interface NodeProviderGuardianLaunchOptions {
  /** Internal test seam for exercising the production SEA guardian entry. */
  readonly executable: string
  readonly arguments: readonly string[]
}

/**
 * Starts the private Node-owned guardian. Provider configuration crosses a
 * dedicated inherited pipe, never argv or the Machine protocol. A separate
 * control pipe remains open for the lifetime of the owning Node process, so a
 * hard parent death is observable as EOF by the guardian.
 */
export function spawnNodeProviderProcess(
  specification: NodeProviderProcessSpecification,
  launch?: NodeProviderGuardianLaunchOptions,
): NodeProviderProcessController {
  if (process.platform === 'win32') {
    throw new Error('The Provider process guardian requires POSIX ownership')
  }
  validateProviderSpecification(specification)
  const guardian = spawn(
    launch?.executable ?? process.execPath,
    launch === undefined ? guardianArguments() : launch.arguments,
    {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  const child = guardian as ChildProcessWithoutNullStreams
  const extraPipes = guardian.stdio as readonly (
    NodeJS.ReadableStream | NodeJS.WritableStream | null | undefined
  )[]
  const control = requiredWritable(extraPipes[3], 'control')
  const configuration = requiredWritable(extraPipes[4], 'configuration')
  const ready = requiredReadable(extraPipes[5], 'ready')
  let providerProcessGroupId: number | undefined
  let readyBytes = 0
  let readyText = ''
  let ownershipSettled = false
  let resolveOwnership!: () => void
  let rejectOwnership!: (error: Error) => void
  let closePromise: Promise<void> | undefined
  const ownershipEstablished = new Promise<void>(
    (resolveOwnershipPromise, rejectOwnershipPromise) => {
      resolveOwnership = resolveOwnershipPromise
      rejectOwnership = rejectOwnershipPromise
    },
  )
  void ownershipEstablished.catch(() => undefined)
  const ownershipTimeout = setTimeout(() => {
    settleOwnership(new Error('Provider ownership acknowledgement timed out'))
  }, GUARDIAN_OWNERSHIP_TIMEOUT_MS)
  const settleOwnership = (error?: Error) => {
    if (ownershipSettled) return
    ownershipSettled = true
    clearTimeout(ownershipTimeout)
    if (error === undefined) resolveOwnership()
    else rejectOwnership(error)
  }

  control.on('error', () => undefined)
  configuration.on('error', () => undefined)
  ready.on('error', () => undefined)
  ready.on('data', (chunk: Buffer) => {
    readyBytes += chunk.length
    if (readyBytes > MAXIMUM_GUARDIAN_CONTROL_BYTES) {
      ready.destroy()
      settleOwnership(
        new Error('Provider ownership acknowledgement was invalid'),
      )
      return
    }
    readyText += chunk.toString('utf8')
    const lineEnd = readyText.indexOf('\n')
    if (lineEnd < 0) return
    const parsed = Number(readyText.slice(0, lineEnd))
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      providerProcessGroupId = parsed
      settleOwnership()
    } else {
      settleOwnership(
        new Error('Provider ownership acknowledgement was invalid'),
      )
    }
    ready.destroy()
  })
  ready.once('end', () => {
    if (providerProcessGroupId === undefined) {
      settleOwnership(new Error('Provider ownership was not established'))
    }
  })
  guardian.once('error', () => {
    settleOwnership(new Error('Provider guardian could not start'))
  })
  guardian.once('close', () => {
    if (providerProcessGroupId === undefined) {
      settleOwnership(new Error('Provider ownership was not established'))
    }
  })
  configuration.end(JSON.stringify(specification))

  return {
    child,
    ownershipEstablished,
    async close(graceMs = GUARDIAN_CLOSE_GRACE_MS) {
      assertGraceMs(graceMs)
      closePromise ??= closeGuardian(
        guardian,
        control,
        () => providerProcessGroupId,
        graceMs,
      )
      await closePromise
    },
  }
}

export function isProviderGuardianInvocation(
  arguments_: readonly string[],
): boolean {
  return (
    arguments_.length === 1 &&
    arguments_[0] === INTERNAL_PROVIDER_GUARDIAN_ARGUMENT
  )
}

/** Runs only from the private self-spawned Node/SEA entrypoint. */
export async function runProviderProcessGuardian(): Promise<void> {
  if (process.platform === 'win32') {
    throw new Error('Provider guardian is unavailable on this platform')
  }
  const control = requiredReadableFromFileDescriptor(3, 'control')
  const configuration = requiredReadableFromFileDescriptor(4, 'configuration')
  const ready = requiredWritableFromFileDescriptor(5, 'ready')
  let controlBytes = 0
  let shuttingDown = false
  const owned: { provider?: ChildProcessWithoutNullStreams } = {}
  let cleanupPromise: Promise<void> | undefined

  const cleanup = (): Promise<void> => {
    shuttingDown = true
    cleanupPromise ??=
      owned.provider === undefined
        ? Promise.resolve()
        : stopProviderProcessGroup(owned.provider, GUARDIAN_CLOSE_GRACE_MS)
    return cleanupPromise
  }
  const requestCleanup = () => {
    void cleanup().catch(() => undefined)
  }

  control.on('data', (chunk: Buffer) => {
    controlBytes += chunk.length
    if (controlBytes > MAXIMUM_GUARDIAN_CONTROL_BYTES) {
      requestCleanup()
      return
    }
    if (chunk.length > 0) requestCleanup()
  })
  control.once('end', requestCleanup)
  control.once('close', requestCleanup)
  control.once('error', requestCleanup)
  process.once('SIGINT', requestCleanup)
  process.once('SIGTERM', requestCleanup)
  process.once('SIGHUP', requestCleanup)

  const raw = await readBounded(
    configuration,
    MAXIMUM_GUARDIAN_CONFIGURATION_BYTES,
  )
  const specification = parseProviderSpecification(raw)
  if (shuttingDown) {
    await cleanup()
    return
  }

  const provider = spawn(specification.executable, specification.arguments, {
    ...(specification.cwd === undefined ? {} : { cwd: specification.cwd }),
    env: specification.environment,
    shell: false,
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  owned.provider = provider
  const providerPid = provider.pid
  if (providerPid === undefined) {
    await cleanup()
    throw new Error('Provider ownership was not established')
  }
  ready.end(`${String(providerPid)}\n`)

  process.stdin.on('error', requestCleanup)
  process.stdout.on('error', requestCleanup)
  process.stderr.on('error', requestCleanup)
  provider.stdin.on('error', requestCleanup)
  provider.stdout.on('error', requestCleanup)
  provider.stderr.on('error', requestCleanup)
  process.stdin.pipe(provider.stdin)
  provider.stdout.pipe(process.stdout, { end: false })
  provider.stderr.pipe(process.stderr, { end: false })

  const providerClosed = new Promise<void>((resolveClosed, rejectClosed) => {
    provider?.once('error', rejectClosed)
    provider?.once('close', () => resolveClosed())
  })
  if (shuttingDown) requestCleanup()
  try {
    await providerClosed
  } finally {
    await cleanup()
  }
}

function guardianArguments(): string[] {
  const entrypoint = process.argv[1]
  if (
    entrypoint !== undefined &&
    resolve(entrypoint) === resolve(process.execPath)
  ) {
    return [INTERNAL_PROVIDER_GUARDIAN_ARGUMENT]
  }
  return [
    fileURLToPath(new URL('./main.js', import.meta.url)),
    INTERNAL_PROVIDER_GUARDIAN_ARGUMENT,
  ]
}

async function closeGuardian(
  guardian: ChildProcess,
  control: Writable,
  providerProcessGroupId: () => number | undefined,
  graceMs: number,
): Promise<void> {
  guardian.stdin?.end()
  if (!control.destroyed) control.end('shutdown\n')
  const guardianGraceMs = Math.max(graceMs, GUARDIAN_CLOSE_GRACE_MS) * 3 + 500
  if (!(await waitForChildExit(guardian, guardianGraceMs))) {
    guardian.kill('SIGTERM')
    if (!(await waitForChildExit(guardian, graceMs))) {
      guardian.kill('SIGKILL')
      await waitForChildExit(guardian, graceMs)
    }
  }

  const processGroupId = providerProcessGroupId()
  if (processGroupId !== undefined) {
    await terminateExactProcessGroup(processGroupId, graceMs)
  }
  if (guardian.exitCode === null && guardian.signalCode === null) {
    throw new Error('Provider guardian did not exit during shutdown')
  }
}

async function stopProviderProcessGroup(
  provider: ChildProcessWithoutNullStreams,
  graceMs: number,
): Promise<void> {
  provider.stdin.end()
  const processGroupId = provider.pid
  if (processGroupId === undefined) {
    throw new Error('Provider process group identity is unavailable')
  }
  await terminateExactProcessGroup(processGroupId, graceMs)
}

async function terminateExactProcessGroup(
  processGroupId: number,
  graceMs: number,
): Promise<void> {
  if (await waitForProcessGroupExit(processGroupId, graceMs)) return
  signalExactProcessGroup(processGroupId, 'SIGTERM')
  if (await waitForProcessGroupExit(processGroupId, graceMs)) return
  signalExactProcessGroup(processGroupId, 'SIGKILL')
  if (await waitForProcessGroupExit(processGroupId, graceMs)) return
  throw new Error('Provider process group cleanup could not be verified')
}

async function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true
  return await new Promise((resolveWait) => {
    const closed = () => {
      clearTimeout(timer)
      resolveWait(true)
    }
    const timer = setTimeout(() => {
      child.off('close', closed)
      resolveWait(false)
    }, timeoutMs)
    child.once('close', closed)
  })
}

async function waitForProcessGroupExit(
  processGroupId: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (processGroupExists(processGroupId)) {
    if (Date.now() >= deadline) return false
    await new Promise((resolveWait) => setTimeout(resolveWait, 20))
  }
  return true
}

function processGroupExists(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0)
    return true
  } catch (error) {
    if (isMissingProcessError(error)) return false
    return true
  }
}

function signalExactProcessGroup(
  processGroupId: number,
  signal: NodeJS.Signals,
): void {
  try {
    process.kill(-processGroupId, signal)
  } catch (error) {
    if (!isMissingProcessError(error)) throw error
  }
}

function isMissingProcessError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ESRCH'
  )
}

async function readBounded(stream: Readable, maximumBytes: number) {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > maximumBytes) {
      throw new Error('Provider guardian configuration exceeded its bound')
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function parseProviderSpecification(
  raw: string,
): NodeProviderProcessSpecification {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Provider guardian configuration is malformed')
  }
  if (!isRecord(parsed)) {
    throw new Error('Provider guardian configuration is malformed')
  }
  const specification: NodeProviderProcessSpecification = {
    provider:
      parsed.provider === 'codex' || parsed.provider === 'claude-code'
        ? parsed.provider
        : invalidConfiguration(),
    executable:
      typeof parsed.executable === 'string'
        ? parsed.executable
        : invalidConfiguration(),
    arguments: Array.isArray(parsed.arguments)
      ? parsed.arguments.map((value) =>
          typeof value === 'string' ? value : invalidConfiguration(),
        )
      : invalidConfiguration(),
    environment: isRecord(parsed.environment)
      ? Object.fromEntries(
          Object.entries(parsed.environment).map(([name, value]) => [
            name,
            typeof value === 'string' ? value : invalidConfiguration(),
          ]),
        )
      : invalidConfiguration(),
    ...(parsed.cwd === undefined
      ? {}
      : typeof parsed.cwd === 'string'
        ? { cwd: parsed.cwd }
        : invalidConfiguration()),
  }
  validateProviderSpecification(specification)
  return specification
}

function validateProviderSpecification(
  specification: NodeProviderProcessSpecification,
): void {
  if (
    (specification.provider !== 'codex' &&
      specification.provider !== 'claude-code') ||
    specification.executable.length === 0 ||
    specification.executable.length > 16 * 1024 ||
    specification.arguments.length > 256 ||
    specification.arguments.some(
      (argument) => Buffer.byteLength(argument, 'utf8') > 32 * 1024,
    ) ||
    (specification.cwd !== undefined &&
      Buffer.byteLength(specification.cwd, 'utf8') > 16 * 1024) ||
    Object.keys(specification.environment).length > 512 ||
    Object.entries(specification.environment).some(
      ([name, value]) =>
        name.length === 0 ||
        name.length > 256 ||
        (value !== undefined && Buffer.byteLength(value, 'utf8') > 128 * 1024),
    )
  ) {
    throw new Error('Provider guardian configuration is invalid')
  }
}

function invalidConfiguration(): never {
  throw new Error('Provider guardian configuration is malformed')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredWritable(
  stream: NodeJS.ReadableStream | NodeJS.WritableStream | null | undefined,
  name: string,
): Writable {
  if (stream === null || stream === undefined || !('write' in stream)) {
    throw new Error(`Provider guardian ${name} pipe is unavailable`)
  }
  return stream as Writable
}

function requiredReadable(
  stream: NodeJS.ReadableStream | NodeJS.WritableStream | null | undefined,
  name: string,
): Readable {
  if (stream === null || stream === undefined || !('read' in stream)) {
    throw new Error(`Provider guardian ${name} pipe is unavailable`)
  }
  return stream as Readable
}

function requiredReadableFromFileDescriptor(
  fileDescriptor: number,
  name: string,
): Readable {
  const stream = new Socket({
    fd: fileDescriptor,
    readable: true,
    writable: false,
  })
  if (!stream.readable) {
    throw new Error(`Provider guardian ${name} pipe is unavailable`)
  }
  return stream
}

function requiredWritableFromFileDescriptor(
  fileDescriptor: number,
  name: string,
): Writable {
  const stream = new Socket({
    fd: fileDescriptor,
    readable: false,
    writable: true,
  })
  if (!stream.writable) {
    throw new Error(`Provider guardian ${name} pipe is unavailable`)
  }
  return stream
}

function assertGraceMs(graceMs: number): void {
  if (!Number.isSafeInteger(graceMs) || graceMs < 0) {
    throw new RangeError('graceMs must be a non-negative safe integer')
  }
}
