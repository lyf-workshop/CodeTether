import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { constants } from 'node:fs'
import { access, lstat, readFile, realpath, stat } from 'node:fs/promises'
import {
  delimiter,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  resolve,
} from 'node:path'

import {
  consumeCodexInstallationStream,
  createCodexInstallationIoDeadline,
  type CodexInstallationIoDeadline,
} from './bounded-io.js'

const DEFAULT_MAXIMUM_PATH_ENTRIES = 64
const DEFAULT_MAXIMUM_INSTALLATIONS = 32
const DEFAULT_DISCOVERY_TIMEOUT_MS = 10_000
const DEFAULT_CANDIDATE_TIMEOUT_MS = 1_000
const DEFAULT_FINGERPRINT_TIMEOUT_MS = 30_000
const MAXIMUM_REVISION_FILE_BYTES = 512 * 1024 * 1024
const MAXIMUM_NPM_METADATA_BYTES = 32 * 1024
const MAXIMUM_NPM_SHIM_BYTES = 16 * 1024

export type CodexLauncherKind =
  'native' | 'symlink' | 'hardlink' | 'wrapper' | 'npm_shim' | 'unknown'

export type CodexInstallMethod =
  | 'native_installer'
  | 'npm'
  | 'homebrew'
  | 'package_manager'
  | 'manual'
  | 'unknown'

export interface CodexInstallationCandidate {
  /** Private Machine-local logical launcher. Never place this on public DTOs. */
  readonly launcherPath: string
  /** Private canonical executable passed directly to child_process.spawn. */
  readonly executable: string
  /** Canonical artifact reached directly by the launcher at discovery time. */
  readonly launcherResolutionPath?: string
  /** Private identity used only for Machine-local candidate deduplication. */
  readonly fileIdentity: string
  readonly launcherKind: CodexLauncherKind
  readonly installMethod: CodexInstallMethod
  /**
   * False means the launcher was observed but cannot be executed through
   * CodeTether's mandatory shell-free process boundary. It must never be
   * treated as a runnable installation merely because it prints a version.
   */
  readonly shellFreeLaunch?: boolean
}

export interface CodexInstallationDiscovery {
  readonly installations: readonly CodexInstallationCandidate[]
  readonly pathsInspected: number
  readonly truncated: boolean
}

export interface DiscoverCodexInstallationsOptions {
  readonly environment?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  readonly architecture?: NodeJS.Architecture
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

/** Bounded discovery over configured, previous, PATH, and known locations. */
export async function discoverCodexInstallations(
  options: DiscoverCodexInstallationsOptions = {},
): Promise<CodexInstallationDiscovery> {
  const discoveryIo = createCodexInstallationIoDeadline(
    options.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS,
    options.signal,
  )
  try {
    const environment = options.environment ?? process.env
    const platform = options.platform ?? process.platform
    const architecture = options.architecture ?? process.arch
    const maximumPathEntries = positiveBound(
      options.maximumPathEntries ?? DEFAULT_MAXIMUM_PATH_ENTRIES,
      'maximumPathEntries',
    )
    const maximumInstallations = positiveBound(
      options.maximumInstallations ?? DEFAULT_MAXIMUM_INSTALLATIONS,
      'maximumInstallations',
    )
    const candidates = boundedCandidatePaths({
      environment,
      platform,
      configuredPaths: options.configuredPaths ?? [],
      previouslyKnownPaths: options.previouslyKnownPaths ?? [],
      knownPaths: options.knownPaths ?? [],
      maximumPathEntries,
      maximumInstallations,
    })
    const installations: CodexInstallationCandidate[] = []
    const identities = new Set<string>()
    let pathsInspected = 0
    let truncated = candidates.truncated
    for (const candidatePath of candidates.paths) {
      discoveryIo.throwIfAborted()
      if (installations.length >= maximumInstallations) {
        truncated = true
        break
      }
      pathsInspected += 1
      const candidateIo = createCodexInstallationIoDeadline(
        options.candidateTimeoutMs ?? DEFAULT_CANDIDATE_TIMEOUT_MS,
        discoveryIo.signal,
      )
      try {
        if (!(await isCandidateFile(candidatePath, platform, candidateIo)))
          continue
        const resolved = await resolveCodexLauncher(
          candidatePath,
          platform,
          architecture,
          candidateIo,
        )
        const executable = resolved.executable
        const identity = await fileIdentity(executable, platform, candidateIo)
        if (identities.has(identity)) continue
        identities.add(identity)
        installations.push({
          launcherPath: candidatePath,
          executable,
          launcherResolutionPath: resolved.launcherResolutionPath,
          fileIdentity: identity,
          launcherKind: resolved.launcherKind,
          installMethod: inferInstallMethod(candidatePath, executable),
          shellFreeLaunch: resolved.shellFreeLaunch,
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

/** Streams the selected executable into a bounded SHA-256 revision. */
export async function fingerprintCodexInstallation(
  installation: CodexInstallationCandidate,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_FINGERPRINT_TIMEOUT_MS,
): Promise<string> {
  const io = createCodexInstallationIoDeadline(timeoutMs, signal)
  try {
    io.throwIfAborted()
    if (installation.launcherResolutionPath !== undefined) {
      const currentLauncherResolution = await io.run(() =>
        realpath(installation.launcherPath),
      )
      if (
        normalize(currentLauncherResolution) !==
        normalize(installation.launcherResolutionPath)
      ) {
        throw new Error('Codex launcher target changed during observation')
      }
    }
    const metadata = await io.run(() => stat(installation.executable))
    if (!metadata.isFile() || metadata.size > MAXIMUM_REVISION_FILE_BYTES) {
      throw new Error('Codex installation revision input is invalid')
    }
    const hash = createHash('sha256')
    hash.update('codetether-codex-installation-v1\0')
    hash.update(
      normalize(
        installation.launcherResolutionPath ?? installation.launcherPath,
      ),
    )
    hash.update('\0')
    // The selected revision is the exact executable identity, not only its
    // bytes. A launcher retargeted to a different same-content binary must be
    // revalidated before the next Turn.
    hash.update(normalize(installation.executable))
    hash.update('\0')
    hash.update(String(metadata.size))
    hash.update('\0')
    let consumed = 0
    const stream = createReadStream(installation.executable, {
      signal: io.signal,
    })
    await consumeCodexInstallationStream(stream, io, (chunk) => {
      consumed += chunk.byteLength
      if (consumed > MAXIMUM_REVISION_FILE_BYTES) {
        throw new Error('Codex installation revision input exceeded its bound')
      }
      hash.update(chunk)
    })
    return hash.digest('hex')
  } finally {
    io.dispose()
  }
}

function boundedCandidatePaths(options: {
  readonly environment: NodeJS.ProcessEnv
  readonly platform: NodeJS.Platform
  readonly configuredPaths: readonly string[]
  readonly previouslyKnownPaths: readonly string[]
  readonly knownPaths: readonly string[]
  readonly maximumPathEntries: number
  readonly maximumInstallations: number
}): { readonly paths: readonly string[]; readonly truncated: boolean } {
  const paths: string[] = []
  let truncated = false
  // `maximumPathEntries` bounds directories, while Windows contributes two
  // fixed executable names per directory. Keep separate bounded headroom for
  // configured/previous/known locations so those sources cannot cause the
  // PATH scan to stop after only half (or less) of its declared entry bound.
  const candidatesPerPathEntry = options.platform === 'win32' ? 2 : 1
  const maximumPaths = Math.max(
    options.maximumPathEntries * candidatesPerPathEntry +
      options.maximumInstallations * 4,
    16,
  )
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
  const pathEntries = (environmentValue(options.environment, 'PATH') ?? '')
    .split(delimiter)
    .filter((entry) => entry.trim().length > 0)
  if (pathEntries.length > options.maximumPathEntries) truncated = true
  for (const entry of pathEntries.slice(0, options.maximumPathEntries)) {
    const absoluteEntry = isAbsolute(entry) ? entry : resolve(entry)
    if (options.platform === 'win32') {
      // Native installers normally provide codex.exe. npm provides codex.cmd;
      // it is inspected as a bounded, known shim and never executed via a
      // shell. PATHEXT normally ranks .exe before .cmd, which this preserves.
      add(join(absoluteEntry, 'codex.exe'))
      add(join(absoluteEntry, 'codex.cmd'))
    } else {
      add(join(absoluteEntry, 'codex'))
    }
  }
  for (const path of defaultKnownPaths(options.environment, options.platform)) {
    add(path)
  }
  for (const path of options.knownPaths) add(path)
  return { paths, truncated }
}

export function defaultKnownPaths(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): readonly string[] {
  const home =
    environmentValue(environment, 'HOME') ??
    environmentValue(environment, 'USERPROFILE')
  const system =
    platform === 'darwin'
      ? ['/opt/homebrew/bin/codex', '/usr/local/bin/codex']
      : []
  if (home === undefined || !isAbsolute(home)) return system
  return platform === 'win32'
    ? [join(home, '.local', 'bin', 'codex.exe')]
    : [
        ...system,
        join(home, '.local', 'bin', 'codex'),
        join(home, '.codex', 'bin', 'codex'),
      ]
}

async function resolveCodexLauncher(
  launcherPath: string,
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
  io: CodexInstallationIoDeadline,
): Promise<{
  readonly executable: string
  readonly launcherResolutionPath: string
  readonly launcherKind: CodexLauncherKind
  readonly shellFreeLaunch: boolean
}> {
  try {
    const linkMetadata = await io.run(() => lstat(launcherPath))
    const canonicalLauncher = await io.run(() => realpath(launcherPath))
    const npmExecutable = await resolveOfficialNpmExecutable(
      launcherPath,
      canonicalLauncher,
      platform,
      architecture,
      io,
    )
    if (npmExecutable !== undefined) {
      return {
        executable: npmExecutable,
        launcherResolutionPath: canonicalLauncher,
        launcherKind: 'npm_shim',
        shellFreeLaunch: true,
      }
    }

    // Windows command/PowerShell shims require a shell. Unknown scripts are
    // retained as observations but fail closed instead of weakening the
    // shell:false execution invariant.
    const extension = extname(launcherPath).toLowerCase()
    if (
      platform === 'win32' &&
      (extension === '.cmd' || extension === '.bat' || extension === '.ps1')
    ) {
      return {
        executable: canonicalLauncher,
        launcherResolutionPath: canonicalLauncher,
        launcherKind: extension === '.cmd' ? 'npm_shim' : 'wrapper',
        shellFreeLaunch: false,
      }
    }

    const firstBytes = await readPrefix(canonicalLauncher, 128, io)
    const opaqueScript = firstBytes.startsWith('#!')
    if (linkMetadata.isSymbolicLink()) {
      return {
        executable: canonicalLauncher,
        launcherResolutionPath: canonicalLauncher,
        launcherKind: 'symlink',
        // A POSIX shebang target is itself an exact executable artifact under
        // shell:false. Its opaque downstream behavior is not presented as a
        // separately resolved binary, and its own bytes remain revisioned.
        shellFreeLaunch: platform !== 'win32' || !opaqueScript,
      }
    }
    const targetMetadata = await io.run(() => stat(canonicalLauncher))
    if (opaqueScript) {
      return {
        executable: canonicalLauncher,
        launcherResolutionPath: canonicalLauncher,
        launcherKind: 'wrapper',
        // POSIX shebang launchers can be invoked with shell:false, but an
        // opaque wrapper does not expose any downstream dynamic target. The
        // resolved artifact is truthfully the wrapper itself and its bytes
        // are revisioned; no downstream identity is invented.
        shellFreeLaunch: platform !== 'win32',
      }
    }
    if (targetMetadata.nlink > 1) {
      return {
        executable: canonicalLauncher,
        launcherResolutionPath: canonicalLauncher,
        launcherKind: 'hardlink',
        shellFreeLaunch: true,
      }
    }
    return {
      executable: canonicalLauncher,
      launcherResolutionPath: canonicalLauncher,
      launcherKind: 'native',
      shellFreeLaunch: true,
    }
  } catch {
    return {
      executable: launcherPath,
      launcherResolutionPath: launcherPath,
      launcherKind: 'unknown',
      shellFreeLaunch: false,
    }
  }
}

function inferInstallMethod(
  launcherPath: string,
  executable: string,
): CodexInstallMethod {
  const normalized = `${launcherPath}\n${executable}`
    .replaceAll('\\', '/')
    .toLowerCase()
  if (
    normalized.includes('/node_modules/') ||
    normalized.endsWith('/npm/codex')
  ) {
    return 'npm'
  }
  if (normalized.includes('/homebrew/') || normalized.includes('/cellar/')) {
    return 'homebrew'
  }
  return 'unknown'
}

async function isCandidateFile(
  path: string,
  platform: NodeJS.Platform,
  io: CodexInstallationIoDeadline,
): Promise<boolean> {
  try {
    const metadata = await io.run(() => stat(path))
    if (!metadata.isFile()) return false
    if (platform !== 'win32') {
      await io.run(() => access(path, constants.X_OK))
    }
    return true
  } catch {
    return false
  }
}

/**
 * Resolves only the two bounded layouts shipped by the official
 * `@openai/codex` npm package. The JavaScript/cmd shim itself is never parsed
 * as executable authority and is never run through a shell.
 */
async function resolveOfficialNpmExecutable(
  launcherPath: string,
  canonicalLauncher: string,
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
  io: CodexInstallationIoDeadline,
): Promise<string | undefined> {
  const packageRoot = await officialNpmPackageRoot(
    launcherPath,
    canonicalLauncher,
    platform,
    io,
  )
  if (packageRoot === undefined) return undefined
  const manifest = await readBoundedJson(join(packageRoot, 'package.json'), io)
  if (
    manifest === undefined ||
    manifest.name !== '@openai/codex' ||
    !isOfficialCodexBin(manifest.bin)
  ) {
    return undefined
  }
  const target = npmPlatformTarget(platform, architecture)
  if (target === undefined) return undefined
  const binaryName = platform === 'win32' ? 'codex.exe' : 'codex'
  const packageScope = dirname(packageRoot)
  const candidates = [
    join(packageRoot, 'vendor', target.triple, 'codex', binaryName),
  ]
  const platformPackageRoots = [
    join(packageScope, target.packageName),
    join(packageRoot, 'node_modules', '@openai', target.packageName),
  ]
  for (const platformPackageRoot of platformPackageRoots) {
    const platformManifest = await readBoundedJson(
      join(platformPackageRoot, 'package.json'),
      io,
    )
    if (platformManifest?.name === `@openai/${target.packageName}`) {
      candidates.push(
        join(platformPackageRoot, 'vendor', target.triple, 'codex', binaryName),
      )
    }
    if (
      await isOfficialAliasedPlatformPackage(
        manifest,
        platformManifest,
        platformPackageRoot,
        target,
        binaryName,
        io,
      )
    ) {
      candidates.push(
        join(platformPackageRoot, 'vendor', target.triple, 'bin', binaryName),
      )
    }
  }
  for (const candidate of candidates) {
    if (!(await isExecutableFile(candidate, platform, io))) continue
    return await io.run(() => realpath(candidate))
  }
  return undefined
}

async function isOfficialAliasedPlatformPackage(
  rootManifest: Record<string, unknown>,
  platformManifest: Record<string, unknown> | undefined,
  platformPackageRoot: string,
  target: { readonly packageName: string; readonly triple: string },
  binaryName: string,
  io: CodexInstallationIoDeadline,
): Promise<boolean> {
  const version = rootManifest.version
  const optionalDependencies = rootManifest.optionalDependencies
  if (
    typeof version !== 'string' ||
    !isJsonRecord(optionalDependencies) ||
    platformManifest?.name !== '@openai/codex'
  ) {
    return false
  }
  const platformTag = target.packageName.slice('codex-'.length)
  const platformVersion = `${version}-${platformTag}`
  if (
    optionalDependencies[`@openai/${target.packageName}`] !==
      `npm:@openai/codex@${platformVersion}` ||
    platformManifest.version !== platformVersion
  ) {
    return false
  }
  const packageDescription = await readBoundedJson(
    join(platformPackageRoot, 'vendor', target.triple, 'codex-package.json'),
    io,
  )
  return (
    packageDescription?.layoutVersion === 1 &&
    packageDescription.version === version &&
    packageDescription.target === target.triple &&
    packageDescription.variant === 'codex' &&
    packageDescription.entrypoint === `bin/${binaryName}`
  )
}

async function officialNpmPackageRoot(
  launcherPath: string,
  canonicalLauncher: string,
  platform: NodeJS.Platform,
  io: CodexInstallationIoDeadline,
): Promise<string | undefined> {
  const normalizedCanonical = canonicalLauncher.replaceAll('\\', '/')
  const canonicalSuffix = '/node_modules/@openai/codex/bin/codex.js'
  if (normalizedCanonical.toLowerCase().endsWith(canonicalSuffix)) {
    return canonicalLauncher.slice(0, -'bin/codex.js'.length)
  }
  if (platform !== 'win32' || extname(launcherPath).toLowerCase() !== '.cmd') {
    return undefined
  }
  const shim = await readBoundedUtf8(launcherPath, MAXIMUM_NPM_SHIM_BYTES, io)
  const normalizedShim = shim.replaceAll('\\', '/').toLowerCase()
  if (
    !normalizedShim.includes('%~dp0') ||
    !normalizedShim.includes('%*') ||
    !normalizedShim.includes('node_modules/@openai/codex/bin/codex.js')
  ) {
    return undefined
  }
  return join(dirname(launcherPath), 'node_modules', '@openai', 'codex')
}

function npmPlatformTarget(
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
): { readonly packageName: string; readonly triple: string } | undefined {
  if (platform === 'linux' && architecture === 'x64') {
    return {
      packageName: 'codex-linux-x64',
      triple: 'x86_64-unknown-linux-musl',
    }
  }
  if (platform === 'linux' && architecture === 'arm64') {
    return {
      packageName: 'codex-linux-arm64',
      triple: 'aarch64-unknown-linux-musl',
    }
  }
  if (platform === 'darwin' && architecture === 'x64') {
    return { packageName: 'codex-darwin-x64', triple: 'x86_64-apple-darwin' }
  }
  if (platform === 'darwin' && architecture === 'arm64') {
    return { packageName: 'codex-darwin-arm64', triple: 'aarch64-apple-darwin' }
  }
  if (platform === 'win32' && architecture === 'x64') {
    return { packageName: 'codex-win32-x64', triple: 'x86_64-pc-windows-msvc' }
  }
  if (platform === 'win32' && architecture === 'arm64') {
    return {
      packageName: 'codex-win32-arm64',
      triple: 'aarch64-pc-windows-msvc',
    }
  }
  return undefined
}

async function readBoundedJson(
  path: string,
  io: CodexInstallationIoDeadline,
): Promise<Record<string, unknown> | undefined> {
  try {
    const source = await readBoundedUtf8(path, MAXIMUM_NPM_METADATA_BYTES, io)
    const value: unknown = JSON.parse(source)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

async function readBoundedUtf8(
  path: string,
  maximumBytes: number,
  io: CodexInstallationIoDeadline,
): Promise<string> {
  const metadata = await io.run(() => lstat(path))
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size > maximumBytes
  ) {
    throw new Error('Codex launcher metadata is invalid')
  }
  const source = await io.run((signal) => readFile(path, { signal }))
  if (source.byteLength > maximumBytes) {
    throw new Error('Codex launcher metadata exceeded its bound')
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(source)
}

function isOfficialCodexBin(value: unknown): boolean {
  if (typeof value === 'string')
    return value.replaceAll('\\', '/') === 'bin/codex.js'
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).codex === 'bin/codex.js'
  )
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function isExecutableFile(
  path: string,
  platform: NodeJS.Platform,
  io: CodexInstallationIoDeadline,
): Promise<boolean> {
  try {
    const metadata = await io.run(() => stat(path))
    if (!metadata.isFile()) return false
    if (platform !== 'win32') {
      await io.run(() => access(path, constants.X_OK))
    }
    return true
  } catch {
    return false
  }
}

async function fileIdentity(
  path: string,
  platform: NodeJS.Platform,
  io: CodexInstallationIoDeadline,
): Promise<string> {
  const metadata = await io.run(() => stat(path))
  if (!metadata.isFile()) throw new Error('Codex installation is not a file')
  if (metadata.dev !== 0 || metadata.ino !== 0) {
    return `file:${String(metadata.dev)}:${String(metadata.ino)}`
  }
  const canonical = await io.run(() => realpath(path))
  return `path:${platform === 'win32' ? canonical.toLowerCase() : canonical}`
}

async function readPrefix(
  path: string,
  maximumBytes: number,
  io: CodexInstallationIoDeadline,
): Promise<string> {
  const stream = createReadStream(path, {
    start: 0,
    end: maximumBytes - 1,
    signal: io.signal,
  })
  const chunks: Buffer[] = []
  await consumeCodexInstallationStream(stream, io, (chunk) => {
    chunks.push(chunk)
  })
  return Buffer.concat(chunks).toString('utf8')
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
