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
}

export async function resolveClaudeCodeLauncher(
  options: ClaudeCodeResolutionOptions = {},
): Promise<ClaudeCodeLauncher> {
  const platform = options.platform ?? process.platform
  const environment = options.environment ?? process.env
  const configuredPath = options.executablePath

  if (configuredPath !== undefined) {
    if (!isAbsolute(configuredPath)) throw new ClaudeCodeMisconfiguredError()
    return await resolveCandidate(configuredPath, environment, platform, true)
  }

  const pathEntries = readPathEntries(environment)
  if (platform === 'win32') {
    for (const entry of pathEntries) {
      const candidate = resolve(entry, 'claude.exe')
      if (await isFile(candidate)) return await nativeLauncher(candidate)
    }

    let foundInvalidShim = false
    for (const entry of pathEntries) {
      const candidate = resolve(entry, 'claude.cmd')
      if (!(await isFile(candidate))) continue
      try {
        return await npmLauncher(candidate, environment)
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
    if (await isExecutableFile(candidate))
      return await nativeLauncher(candidate)
  }
  throw new ClaudeCodeNotInstalledError()
}

async function resolveCandidate(
  candidate: string,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  configured: boolean,
): Promise<ClaudeCodeLauncher> {
  if (!(await isFile(candidate))) {
    throw configured
      ? new ClaudeCodeMisconfiguredError()
      : new ClaudeCodeNotInstalledError()
  }
  if (platform === 'win32' && extname(candidate).toLowerCase() === '.cmd') {
    return await npmLauncher(candidate, environment)
  }
  if (platform !== 'win32' && !(await isExecutableFile(candidate))) {
    throw new ClaudeCodeMisconfiguredError()
  }
  return await nativeLauncher(candidate)
}

async function nativeLauncher(candidate: string): Promise<ClaudeCodeLauncher> {
  const canonical = await realpath(candidate)
  return {
    kind: 'native',
    executable: canonical,
    prefixArguments: [],
    sourcePath: canonical,
  }
}

async function npmLauncher(
  shimPath: string,
  environment: NodeJS.ProcessEnv,
): Promise<ClaudeCodeLauncher> {
  const canonicalShim = await realpath(shimPath)
  const packageDirectory = resolve(
    dirname(canonicalShim),
    'node_modules',
    '@anthropic-ai',
    'claude-code',
  )
  const packageJsonPath = resolve(packageDirectory, 'package.json')
  const packageJsonStat = await safeStat(packageJsonPath)
  if (
    packageJsonStat === undefined ||
    !packageJsonStat.isFile() ||
    packageJsonStat.size > MAX_PACKAGE_JSON_BYTES
  ) {
    throw new ClaudeCodeMisconfiguredError()
  }

  let manifest: unknown
  try {
    manifest = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  } catch (error) {
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

  const canonicalPackage = await realpath(packageDirectory)
  const canonicalEntry = await realpath(resolve(packageDirectory, entry)).catch(
    (error: unknown) => {
      throw new ClaudeCodeMisconfiguredError(
        error instanceof Error ? { cause: error } : undefined,
      )
    },
  )
  if (!isContainedPath(canonicalPackage, canonicalEntry)) {
    throw new ClaudeCodeMisconfiguredError()
  }
  if (!(await isFile(canonicalEntry))) throw new ClaudeCodeMisconfiguredError()

  const adjacentNode = resolve(dirname(canonicalShim), 'node.exe')
  const nodeExecutable = (await isFile(adjacentNode))
    ? await realpath(adjacentNode)
    : await resolveNodeExecutable(environment)

  return {
    kind: 'npm',
    executable: nodeExecutable,
    prefixArguments: [canonicalEntry],
    sourcePath: canonicalShim,
  }
}

async function resolveNodeExecutable(
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  for (const entry of readPathEntries(environment)) {
    const candidate = resolve(entry, 'node.exe')
    if (await isFile(candidate)) return await realpath(candidate)
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

async function isFile(path: string): Promise<boolean> {
  return (await safeStat(path))?.isFile() === true
}

async function isExecutableFile(path: string): Promise<boolean> {
  if (!(await isFile(path))) return false
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function safeStat(path: string) {
  try {
    return await stat(path)
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
