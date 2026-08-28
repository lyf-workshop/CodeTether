import { readFile } from 'node:fs/promises'

const BROWSER_DEVELOPMENT_ORIGINS = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
] as const

declare const __CODETETHER_HOST_VERSION__: string | undefined

export interface ServeArguments {
  readonly workspaces: readonly string[]
  readonly origins: readonly string[]
  readonly port: number
}

export interface HostVersionOptions {
  readonly env?: NodeJS.ProcessEnv
  readonly packageJsonUrl?: URL
  readonly injectedVersion?: string
}

export function isDesktopManaged(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.CODETETHER_DESKTOP_MANAGED === '1'
}

export function parseServeArguments(
  arguments_: readonly string[],
  options: { readonly desktopManaged: boolean },
): ServeArguments {
  const workspaces: string[] = []
  const origins: string[] = options.desktopManaged
    ? []
    : [...BROWSER_DEVELOPMENT_ORIGINS]
  let port = 4317
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--workspace') {
      workspaces.push(requireValue(arguments_, ++index, '--workspace'))
      continue
    }
    if (argument === '--origin') {
      origins.push(requireValue(arguments_, ++index, '--origin'))
      continue
    }
    if (argument === '--port') {
      port = Number(requireValue(arguments_, ++index, '--port'))
      continue
    }
    throw new Error(`Unknown Host argument: ${argument ?? ''}`)
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('--port must be an integer from 0 to 65535')
  }
  return { workspaces, origins: [...new Set(origins)], port }
}

/**
 * Production bundling replaces __CODETETHER_HOST_VERSION__ with the repository
 * coupled version/revision. CODETETHER_HOST_VERSION keeps the same entry useful
 * to development/package smoke harnesses; ordinary Browser serve falls back to
 * apps/host/package.json.
 */
export async function resolveHostVersion(
  options: HostVersionOptions = {},
): Promise<string> {
  const env = options.env ?? process.env
  const compileTimeVersion =
    typeof __CODETETHER_HOST_VERSION__ === 'string'
      ? __CODETETHER_HOST_VERSION__
      : undefined
  const configuredVersion =
    options.injectedVersion ?? compileTimeVersion ?? env.CODETETHER_HOST_VERSION
  if (configuredVersion !== undefined && configuredVersion.trim().length > 0) {
    return validateHostVersion(configuredVersion)
  }

  const text = await readFile(
    options.packageJsonUrl ?? new URL('../package.json', import.meta.url),
    'utf8',
  )
  const value = JSON.parse(text) as unknown
  if (
    typeof value !== 'object' ||
    value === null ||
    !('version' in value) ||
    typeof value.version !== 'string'
  ) {
    throw new Error('Host package version is invalid')
  }
  return validateHostVersion(value.version)
}

function validateHostVersion(value: string): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > 120) {
    throw new Error('Host version must contain 1 to 120 characters')
  }
  return normalized
}

function requireValue(
  arguments_: readonly string[],
  index: number,
  flag: string,
): string {
  const value = arguments_[index]
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}
