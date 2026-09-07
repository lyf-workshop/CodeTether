import { constants } from 'node:fs'
import { access, readFile, realpath, stat } from 'node:fs/promises'
import {
  delimiter,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path'

import {
  ClaudeCodeMisconfiguredError,
  ClaudeCodeNotInstalledError,
} from './errors.js'
import type { ClaudeCodeLauncher } from './types.js'

const MAX_PACKAGE_JSON_BYTES = 64 * 1024

export interface ClaudeCodeResolutionOptions {
  readonly executablePath?: string
  readonly environment?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  /** Optional lifecycle-owned cancellation for bounded filesystem discovery. */
  readonly signal?: AbortSignal
}

export async function resolveClaudeCodeLauncher(
  options: ClaudeCodeResolutionOptions = {},
): Promise<ClaudeCodeLauncher> {
  const platform = options.platform ?? process.platform
  const environment = options.environment ?? process.env
  const configuredPath = options.executablePath
  const signal = options.signal
  throwIfAborted(signal)

  if (configuredPath !== undefined) {
    if (!isAbsolute(configuredPath)) throw new ClaudeCodeMisconfiguredError()
    return await resolveCandidate(
      configuredPath,
      environment,
      platform,
      true,
      signal,
    )
  }

  const pathEntries = readPathEntries(environment)
  if (platform === 'win32') {
    for (const entry of pathEntries) {
      const candidate = resolve(entry, 'claude.exe')
      if (await isFile(candidate, signal))
        return await nativeLauncher(candidate, signal)
    }

    let foundInvalidShim = false
    for (const entry of pathEntries) {
      const candidate = resolve(entry, 'claude.cmd')
      if (!(await isFile(candidate, signal))) continue
      try {
        return await npmLauncher(candidate, environment, signal)
      } catch (error) {
        if (!(error instanceof ClaudeCodeMisconfiguredError)) throw error
        foundInvalidShim = true
      }
    }
    if (foundInvalidShim) throw new ClaudeCodeMisconfiguredError()
    throw new ClaudeCodeNotInstalledError()
  }

  for (const entry of pathEntries) {
    const candidate = resolve(entry, 'claude')
    if (await isExecutableFile(candidate, signal))
      return await nativeLauncher(candidate, signal)
  }
  throw new ClaudeCodeNotInstalledError()
}

async function resolveCandidate(
  candidate: string,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  configured: boolean,
  signal?: AbortSignal,
): Promise<ClaudeCodeLauncher> {
  if (!(await isFile(candidate, signal))) {
    throw configured
      ? new ClaudeCodeMisconfiguredError()
      : new ClaudeCodeNotInstalledError()
  }
  if (platform === 'win32' && extname(candidate).toLowerCase() === '.cmd') {
    return await npmLauncher(candidate, environment, signal)
  }
  if (platform !== 'win32' && !(await isExecutableFile(candidate, signal))) {
    throw new ClaudeCodeMisconfiguredError()
  }
  return await nativeLauncher(candidate, signal)
}

async function nativeLauncher(
  candidate: string,
  signal?: AbortSignal,
): Promise<ClaudeCodeLauncher> {
  const launcherPath = resolve(candidate)
  throwIfAborted(signal)
  const canonical = await realpath(candidate)
  throwIfAborted(signal)
  return {
    kind: 'native',
    launcherPath,
    executable: canonical,
    prefixArguments: [],
    sourcePath: canonical,
  }
}

async function npmLauncher(
  shimPath: string,
  environment: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<ClaudeCodeLauncher> {
  throwIfAborted(signal)
  const canonicalShim = await realpath(shimPath)
  throwIfAborted(signal)
  const packageDirectory = resolve(
    dirname(canonicalShim),
    'node_modules',
    '@anthropic-ai',
    'claude-code',
  )
  const packageJsonPath = resolve(packageDirectory, 'package.json')
  const packageJsonStat = await safeStat(packageJsonPath, signal)
  if (
    packageJsonStat === undefined ||
    !packageJsonStat.isFile() ||
    packageJsonStat.size > MAX_PACKAGE_JSON_BYTES
  ) {
    throw new ClaudeCodeMisconfiguredError()
  }

  let manifest: unknown
  try {
    manifest = JSON.parse(
      await readFile(packageJsonPath, { encoding: 'utf8', signal }),
    )
  } catch (error) {
    throwIfAborted(signal)
    throw new ClaudeCodeMisconfiguredError(
      error instanceof Error ? { cause: error } : undefined,
    )
  }
  if (!isRecord(manifest) || manifest.name !== '@anthropic-ai/claude-code') {
    throw new ClaudeCodeMisconfiguredError()
  }
  const bin = manifest.bin
  const entry =
    typeof bin === 'string'
      ? bin
      : isRecord(bin) && typeof bin.claude === 'string'
        ? bin.claude
        : undefined
  if (entry === undefined || isAbsolute(entry)) {
    throw new ClaudeCodeMisconfiguredError()
  }

  throwIfAborted(signal)
  const canonicalPackage = await realpath(packageDirectory)
  throwIfAborted(signal)
  const canonicalEntry = await realpath(resolve(packageDirectory, entry)).catch(
    (error: unknown) => {
      throwIfAborted(signal)
      throw new ClaudeCodeMisconfiguredError(
        error instanceof Error ? { cause: error } : undefined,
      )
    },
  )
  throwIfAborted(signal)
  if (!isContainedPath(canonicalPackage, canonicalEntry)) {
    throw new ClaudeCodeMisconfiguredError()
  }
  if (!(await isFile(canonicalEntry, signal)))
    throw new ClaudeCodeMisconfiguredError()

  const adjacentNode = resolve(dirname(canonicalShim), 'node.exe')
  const nodeExecutable = (await isFile(adjacentNode, signal))
    ? await realpath(adjacentNode)
    : await resolveNodeExecutable(environment, signal)
  throwIfAborted(signal)

  return {
    kind: 'npm',
    launcherPath: canonicalShim,
    executable: nodeExecutable,
    prefixArguments: [canonicalEntry],
    sourcePath: canonicalShim,
  }
}

async function resolveNodeExecutable(
  environment: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<string> {
  for (const entry of readPathEntries(environment)) {
    const candidate = resolve(entry, 'node.exe')
    if (await isFile(candidate, signal)) {
      const canonical = await realpath(candidate)
      throwIfAborted(signal)
      return canonical
    }
  }
  throw new ClaudeCodeMisconfiguredError()
}

function readPathEntries(environment: NodeJS.ProcessEnv): string[] {
  const rawPath = Object.entries(environment).find(
    ([name]) => name.toLowerCase() === 'path',
  )?.[1]
  if (rawPath === undefined) return []
  return rawPath
    .split(delimiter)
    .map((entry) => stripPairedQuotes(entry.trim()))
    .filter((entry) => entry.length > 0 && isAbsolute(entry))
}

function stripPairedQuotes(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value
}

function isContainedPath(parent: string, child: string): boolean {
  const relation = relative(parent, child)
  return (
    relation === '' ||
    (relation !== '..' &&
      !relation.startsWith(`..${sep}`) &&
      !isAbsolute(relation))
  )
}

async function isFile(path: string, signal?: AbortSignal): Promise<boolean> {
  return (await safeStat(path, signal))?.isFile() === true
}

async function isExecutableFile(
  path: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!(await isFile(path, signal))) return false
  try {
    throwIfAborted(signal)
    await access(path, constants.X_OK)
    throwIfAborted(signal)
    return true
  } catch {
    throwIfAborted(signal)
    return false
  }
}

async function safeStat(path: string, signal?: AbortSignal) {
  try {
    throwIfAborted(signal)
    const metadata = await stat(path)
    throwIfAborted(signal)
    return metadata
  } catch {
    throwIfAborted(signal)
    return undefined
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted !== true) return
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Operation aborted', 'AbortError')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
