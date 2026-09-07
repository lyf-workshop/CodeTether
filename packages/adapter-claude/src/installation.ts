import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, opendir, realpath, stat } from 'node:fs/promises'
import { delimiter, isAbsolute, join, normalize, resolve } from 'node:path'

import {
  consumeClaudeInstallationStream,
  createClaudeInstallationIoDeadline,
  type ClaudeInstallationIoDeadline,
} from './bounded-io.js'
import { resolveClaudeCodeLauncher } from './resolution.js'
import type { ClaudeCodeLauncher } from './types.js'

const DEFAULT_MAXIMUM_PATH_ENTRIES = 64
const DEFAULT_MAXIMUM_INSTALLATIONS = 32
const DEFAULT_DISCOVERY_TIMEOUT_MS = 10_000
const DEFAULT_CANDIDATE_TIMEOUT_MS = 1_000
const DEFAULT_FINGERPRINT_TIMEOUT_MS = 30_000
const MAXIMUM_REVISION_FILE_BYTES = 512 * 1024 * 1024

export type ClaudeCodeLauncherKind =
  'native' | 'symlink' | 'hardlink' | 'wrapper' | 'npm_shim' | 'unknown'

export type ClaudeCodeInstallMethod =
  | 'native_installer'
  | 'npm'
  | 'homebrew'
  | 'package_manager'
  | 'manual'
  | 'unknown'

export interface ClaudeCodeInstallationCandidate {
  /** Private Machine-local logical launcher. Never place this on public DTOs. */
  readonly launcherPath: string
  /** Private exact process specification retained for observation and execution. */
  readonly launcher: ClaudeCodeLauncher
  /** Private identity used only to deduplicate candidates on the owning Machine. */
  readonly fileIdentity: string
  readonly launcherKind: ClaudeCodeLauncherKind
  readonly installMethod: ClaudeCodeInstallMethod
}

export interface ClaudeCodeInstallationDiscovery {
  readonly installations: readonly ClaudeCodeInstallationCandidate[]
  readonly pathsInspected: number
  readonly truncated: boolean
}

export interface DiscoverClaudeCodeInstallationsOptions {
  readonly environment?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  readonly configuredPaths?: readonly string[]
  readonly previouslyKnownPaths?: readonly string[]
  readonly knownPaths?: readonly string[]
  readonly maximumPathEntries?: number
  readonly maximumInstallations?: number
  /** Total elapsed bound for one refresh, including every filesystem call. */
  readonly timeoutMs?: number
  /** Elapsed bound that isolates one slow/broken candidate from the rest. */
  readonly candidateTimeoutMs?: number
  readonly signal?: AbortSignal
}

/**
 * Enumerates only configured, previously selected, PATH, and known official
 * Claude locations. It never crawls a home directory or invokes Claude.
 */
export async function discoverClaudeCodeInstallations(
  options: DiscoverClaudeCodeInstallationsOptions = {},
): Promise<ClaudeCodeInstallationDiscovery> {
  const discoveryIo = createClaudeInstallationIoDeadline(
    options.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS,
    options.signal,
  )
  try {
    const environment = options.environment ?? process.env
    const platform = options.platform ?? process.platform
    const maximumPathEntries = positiveBound(
      options.maximumPathEntries ?? DEFAULT_MAXIMUM_PATH_ENTRIES,
      'maximumPathEntries',
    )
    const maximumInstallations = positiveBound(
      options.maximumInstallations ?? DEFAULT_MAXIMUM_INSTALLATIONS,
      'maximumInstallations',
    )
    const candidatePaths = await boundedClaudeCandidatePaths({
      environment,
      platform,
      configuredPaths: options.configuredPaths ?? [],
      previouslyKnownPaths: options.previouslyKnownPaths ?? [],
      knownPaths: options.knownPaths ?? [],
      maximumPathEntries,
      maximumInstallations,
      candidateTimeoutMs:
        options.candidateTimeoutMs ?? DEFAULT_CANDIDATE_TIMEOUT_MS,
      io: discoveryIo,
    })
    const installations: ClaudeCodeInstallationCandidate[] = []
    const identities = new Set<string>()
    let pathsInspected = 0
    let truncated = candidatePaths.truncated
    for (const candidatePath of candidatePaths.paths) {
      discoveryIo.throwIfAborted()
      if (installations.length >= maximumInstallations) {
        truncated = true
        break
      }
      pathsInspected += 1
      const candidateIo = createClaudeInstallationIoDeadline(
        options.candidateTimeoutMs ?? DEFAULT_CANDIDATE_TIMEOUT_MS,
        discoveryIo.signal,
      )
      try {
        const launcher = await candidateIo.run((signal) =>
          resolveClaudeCodeLauncher({
            executablePath: candidatePath,
            environment,
            platform,
            signal,
          }),
        )
        const identityPath = providerIdentityPath(launcher)
        const identity = await fileIdentity(identityPath, platform, candidateIo)
        if (identities.has(identity)) continue
        identities.add(identity)
        const launcherKind = await classifyLauncher(launcher, candidateIo)
        candidateIo.throwIfAborted()
        installations.push({
          launcherPath: launcher.launcherPath,
          launcher,
          fileIdentity: identity,
          launcherKind,
          installMethod: inferInstallMethod(launcher),
        })
      } catch {
        discoveryIo.throwIfAborted()
        // One broken candidate cannot hide another valid installation.
      } finally {
        candidateIo.dispose()
      }
    }
    discoveryIo.throwIfAborted()
    return { installations, pathsInspected, truncated }
  } finally {
    discoveryIo.dispose()
  }
}

/** Streams exact installation artifacts into a bounded SHA-256 revision. */
export async function fingerprintClaudeCodeInstallation(
  installation: ClaudeCodeInstallationCandidate,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_FINGERPRINT_TIMEOUT_MS,
): Promise<string> {
  const io = createClaudeInstallationIoDeadline(timeoutMs, signal)
  try {
    const hash = createHash('sha256')
    hash.update('codetether-claude-installation-v1\0')
    hash.update(installation.launcher.kind)
    const paths = uniqueRevisionPaths(installation.launcher)
    for (const path of paths) {
      io.throwIfAborted()
      const metadata = await io.run(() => stat(path))
      if (!metadata.isFile() || metadata.size > MAXIMUM_REVISION_FILE_BYTES) {
        throw new Error('Claude installation revision input is invalid')
      }
      // Include the exact resolved artifact identity as well as its bytes so a
      // stable launcher retargeted to an identical binary still invalidates the
      // compatibility observation.
      hash.update('\0path\0')
      hash.update(normalize(path))
      hash.update('\0file\0')
      hash.update(String(metadata.size))
      hash.update('\0')
      let consumed = 0
      const stream = createReadStream(path, { signal: io.signal })
      await consumeClaudeInstallationStream(stream, io, (chunk) => {
        consumed += chunk.byteLength
        if (consumed > MAXIMUM_REVISION_FILE_BYTES) {
          throw new Error(
            'Claude installation revision input exceeded its bound',
          )
        }
        hash.update(chunk)
      })
    }
    return hash.digest('hex')
  } finally {
    io.dispose()
  }
}

async function boundedClaudeCandidatePaths(options: {
  readonly environment: NodeJS.ProcessEnv
  readonly platform: NodeJS.Platform
  readonly configuredPaths: readonly string[]
  readonly previouslyKnownPaths: readonly string[]
  readonly knownPaths: readonly string[]
  readonly maximumPathEntries: number
  readonly maximumInstallations: number
  readonly candidateTimeoutMs: number
  readonly io: ClaudeInstallationIoDeadline
}): Promise<{
  readonly paths: readonly string[]
  readonly truncated: boolean
}> {
  const paths: string[] = []
  let truncated = false
  const maximumPaths = Math.max(options.maximumInstallations * 4, 16)
  const add = (path: string | undefined): void => {
    if (path === undefined || !isAbsolute(path)) return
    if (paths.length >= maximumPaths) {
      truncated = true
      return
    }
    const normalized = normalize(path)
    const key =
      options.platform === 'win32' ? normalized.toLowerCase() : normalized
    if (
      paths.some(
        (existing) =>
          (options.platform === 'win32' ? existing.toLowerCase() : existing) ===
          key,
      )
    ) {
      return
    }
    paths.push(normalized)
  }

  for (const path of options.configuredPaths) add(path)
  for (const path of options.previouslyKnownPaths) add(path)
  const pathValue = environmentValue(options.environment, 'PATH') ?? ''
  const pathEntries = pathValue
    .split(delimiter)
    .filter((entry) => entry.trim().length > 0)
  if (pathEntries.length > options.maximumPathEntries) truncated = true
  for (const entry of pathEntries.slice(0, options.maximumPathEntries)) {
    const absoluteEntry = isAbsolute(entry) ? entry : resolve(entry)
    if (options.platform === 'win32') {
      add(join(absoluteEntry, 'claude.exe'))
      add(join(absoluteEntry, 'claude.cmd'))
    } else add(join(absoluteEntry, 'claude'))
  }
  for (const path of defaultKnownPaths(options.environment, options.platform)) {
    add(path)
  }
  for (const path of options.knownPaths) add(path)
  const installedVersions = await installedClaudeVersions(
    options.environment,
    maximumPaths,
    options.candidateTimeoutMs,
    options.io.signal,
  )
  if (installedVersions.truncated) truncated = true
  for (const path of installedVersions.paths) add(path)
  return { paths, truncated }
}

function defaultKnownPaths(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): readonly string[] {
  const home = homeDirectory(environment)
  if (home === undefined) return []
  return platform === 'win32'
    ? [join(home, '.local', 'bin', 'claude.exe')]
    : [
        join(home, '.local', 'bin', 'claude'),
        join(home, '.claude', 'local', 'claude'),
      ]
}

async function installedClaudeVersions(
  environment: NodeJS.ProcessEnv,
  maximumEntries: number,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<{ readonly paths: readonly string[]; readonly truncated: boolean }> {
  const home = homeDirectory(environment)
  if (home === undefined) return { paths: [], truncated: false }
  const root = join(home, '.local', 'share', 'claude', 'versions')
  const io = createClaudeInstallationIoDeadline(timeoutMs, signal)
  type ClaudeVersionsDirectory = Awaited<ReturnType<typeof opendir>>
  let directory: ClaudeVersionsDirectory | undefined
  try {
    const pendingOpen = opendir(root)
    void pendingOpen.then(
      async (lateDirectory) => {
        if (io.signal.aborted && directory === undefined) {
          await closeClaudeVersionsDirectory(lateDirectory)
        }
      },
      () => undefined,
    )
    directory = await io.run(() => pendingOpen)
    const paths: string[] = []
    let inspected = 0
    let truncated = false
    while (true) {
      const pendingRead = directory.read()
      const closeAfterTimedOutRead = async (): Promise<void> => {
        if (io.signal.aborted) {
          await closeClaudeVersionsDirectory(directory!)
        }
      }
      void pendingRead.then(closeAfterTimedOutRead, closeAfterTimedOutRead)
      const entry = await io.run(() => pendingRead)
      if (entry === null) break
      inspected += 1
      if (inspected > maximumEntries) {
        truncated = true
        break
      }
      if (entry.isFile() || entry.isSymbolicLink()) {
        paths.push(join(root, entry.name))
      }
    }
    return { paths: paths.sort(), truncated }
  } catch {
    return {
      paths: [],
      truncated: io.signal.aborted && !signal.aborted,
    }
  } finally {
    if (directory !== undefined) {
      await closeClaudeVersionsDirectory(directory)
    }
    io.dispose()
  }
}

async function closeClaudeVersionsDirectory(
  directory: Awaited<ReturnType<typeof opendir>>,
): Promise<void> {
  const cleanupIo = createClaudeInstallationIoDeadline(250)
  try {
    await cleanupIo.run(() => directory.close())
  } catch {
    // Cleanup has its own elapsed bound and never delays lifecycle authority.
  } finally {
    cleanupIo.dispose()
  }
}

async function classifyLauncher(
  launcher: ClaudeCodeLauncher,
  io: ClaudeInstallationIoDeadline,
): Promise<ClaudeCodeLauncherKind> {
  if (launcher.kind === 'npm') return 'npm_shim'
  try {
    const linkMetadata = await io.run(() => lstat(launcher.launcherPath))
    const targetMetadata = await io.run(() => stat(launcher.executable))
    const firstBytes = await readPrefix(launcher.executable, 128, io)
    // The resolved artifact takes precedence: symlink/hardlink transport does
    // not make an opaque script wrapper a native executable.
    if (firstBytes.startsWith('#!')) return 'wrapper'
    if (linkMetadata.isSymbolicLink()) return 'symlink'
    if (targetMetadata.nlink > 1) return 'hardlink'
    return 'native'
  } catch {
    return 'unknown'
  }
}

function inferInstallMethod(
  launcher: ClaudeCodeLauncher,
): ClaudeCodeInstallMethod {
  const normalizedPaths = [
    launcher.launcherPath,
    launcher.executable,
    launcher.sourcePath,
    ...launcher.prefixArguments,
  ].map((path) => path.replaceAll('\\', '/').toLowerCase())
  if (
    launcher.kind === 'npm' ||
    normalizedPaths.some((path) => path.includes('/node_modules/'))
  ) {
    return 'npm'
  }
  if (
    normalizedPaths.some(
      (path) => path.includes('/homebrew/') || path.includes('/cellar/'),
    )
  ) {
    return 'homebrew'
  }
  if (
    normalizedPaths.some((path) =>
      path.includes('/.local/share/claude/versions/'),
    )
  ) {
    return 'native_installer'
  }
  return 'unknown'
}

async function fileIdentity(
  path: string,
  platform: NodeJS.Platform,
  io: ClaudeInstallationIoDeadline,
): Promise<string> {
  const metadata = await io.run(() => stat(path))
  if (!metadata.isFile()) throw new Error('Claude installation is not a file')
  if (metadata.dev !== 0 || metadata.ino !== 0) {
    return `file:${String(metadata.dev)}:${String(metadata.ino)}`
  }
  const canonical = await io.run(() => realpath(path))
  return `path:${platform === 'win32' ? canonical.toLowerCase() : canonical}`
}

function providerIdentityPath(launcher: ClaudeCodeLauncher): string {
  return launcher.kind === 'npm'
    ? (launcher.prefixArguments[0] ?? launcher.executable)
    : launcher.executable
}

function uniqueRevisionPaths(launcher: ClaudeCodeLauncher): readonly string[] {
  const paths = [
    launcher.executable,
    launcher.sourcePath,
    ...launcher.prefixArguments,
  ]
  return [...new Set(paths.filter((path) => isAbsolute(path)))]
}

async function readPrefix(
  path: string,
  maximumBytes: number,
  io: ClaudeInstallationIoDeadline,
): Promise<string> {
  const stream = createReadStream(path, {
    start: 0,
    end: maximumBytes - 1,
    signal: io.signal,
  })
  const chunks: Buffer[] = []
  await consumeClaudeInstallationStream(stream, io, (chunk) => {
    chunks.push(chunk)
  })
  return Buffer.concat(chunks).toString('utf8')
}

function homeDirectory(environment: NodeJS.ProcessEnv): string | undefined {
  const home =
    environmentValue(environment, 'HOME') ??
    environmentValue(environment, 'USERPROFILE')
  return home !== undefined && isAbsolute(home) ? home : undefined
}

function environmentValue(
  environment: NodeJS.ProcessEnv,
  expectedName: string,
): string | undefined {
  return Object.entries(environment).find(
    ([name, value]) =>
      name.toUpperCase() === expectedName && value?.trim().length !== 0,
  )?.[1]
}

function positiveBound(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1024) {
    throw new RangeError(`${name} must be a bounded positive integer`)
  }
  return value
}
