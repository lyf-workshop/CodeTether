import { stat, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { ClaudeCodeMisconfiguredError } from './errors.js'

const MAX_SETTINGS_BYTES = 128 * 1024
const MAX_ENVIRONMENT_VALUE_CODE_UNITS = 16 * 1024

/**
 * Restricted mode intentionally ignores Claude's user settings. CodeTether
 * restores only the inert authentication, Provider, and network routing values
 * required by the installed CLI. Hooks, permissions, plugins, MCP servers,
 * and arbitrary environment variables never cross this boundary.
 */
const RESTRICTED_ENVIRONMENT_KEYS = new Set([
  'ALL_PROXY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
  'ANTHROPIC_MODEL',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_VERTEX',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
])

/**
 * The Claude process receives only the operating-system context required to
 * locate its executable/configuration, create temporary files, and use the
 * user's explicitly configured network route. Host application variables and
 * unrelated credentials are deliberately absent.
 */
const RUNTIME_ENVIRONMENT_KEYS = new Set([
  'ALL_PROXY',
  'APPDATA',
  'CLAUDE_CONFIG_DIR',
  'COLORTERM',
  'COMSPEC',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOCALAPPDATA',
  'NODE_EXTRA_CA_CERTS',
  'NO_COLOR',
  'NO_PROXY',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'PATH',
  'PATHEXT',
  'PROCESSOR_ARCHITECTURE',
  'PROGRAMDATA',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'TZ',
  'USERPROFILE',
  'WINDIR',
])

const ALLOWED_PROCESS_ENVIRONMENT_KEYS = new Set([
  ...RESTRICTED_ENVIRONMENT_KEYS,
  ...RUNTIME_ENVIRONMENT_KEYS,
])

export interface ClaudeCodeRestrictedEnvironmentOptions {
  readonly environment?: NodeJS.ProcessEnv
  readonly settingsPath?: string
}

export async function resolveClaudeCodeRestrictedEnvironment(
  options: ClaudeCodeRestrictedEnvironmentOptions = {},
): Promise<NodeJS.ProcessEnv> {
  const sourceEnvironment = options.environment ?? process.env
  const settingsPath = resolveSettingsPath(
    sourceEnvironment,
    options.settingsPath,
  )
  const baseEnvironment =
    restrictClaudeCodeProcessEnvironment(sourceEnvironment)
  if (settingsPath === undefined) return baseEnvironment

  let settingsStat
  try {
    settingsStat = await stat(settingsPath)
  } catch (error) {
    if (isMissingFileError(error)) return baseEnvironment
    throw new ClaudeCodeMisconfiguredError(
      error instanceof Error ? { cause: error } : undefined,
    )
  }
  if (!settingsStat.isFile() || settingsStat.size > MAX_SETTINGS_BYTES) {
    throw new ClaudeCodeMisconfiguredError()
  }

  let parsed: unknown
  try {
    const source = await readFile(settingsPath)
    if (source.byteLength > MAX_SETTINGS_BYTES) {
      throw new ClaudeCodeMisconfiguredError()
    }
    parsed = JSON.parse(source.toString('utf8'))
  } catch (error) {
    throw new ClaudeCodeMisconfiguredError(
      error instanceof Error ? { cause: error } : undefined,
    )
  }
  if (!isRecord(parsed)) throw new ClaudeCodeMisconfiguredError()
  const configuredEnvironment = parsed.env
  if (configuredEnvironment === undefined) return baseEnvironment
  if (!isRecord(configuredEnvironment)) {
    throw new ClaudeCodeMisconfiguredError()
  }

  for (const name of RESTRICTED_ENVIRONMENT_KEYS) {
    if (hasEnvironmentKey(baseEnvironment, name)) continue
    const value = configuredEnvironment[name]
    if (value === undefined) continue
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.length > MAX_ENVIRONMENT_VALUE_CODE_UNITS ||
      value.includes('\0')
    ) {
      throw new ClaudeCodeMisconfiguredError()
    }
    baseEnvironment[name] = value
  }
  return baseEnvironment
}

export function restrictClaudeCodeProcessEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const restricted: NodeJS.ProcessEnv = {}
  const admittedNames = new Set<string>()
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) continue
    const normalizedName = name.toUpperCase()
    if (
      admittedNames.has(normalizedName) ||
      !ALLOWED_PROCESS_ENVIRONMENT_KEYS.has(normalizedName)
    ) {
      continue
    }
    if (
      value.length > MAX_ENVIRONMENT_VALUE_CODE_UNITS ||
      value.includes('\0')
    ) {
      throw new ClaudeCodeMisconfiguredError()
    }
    if (
      normalizedName === 'CLAUDE_CONFIG_DIR' &&
      value.trim().length > 0 &&
      !isAbsolute(value.trim())
    ) {
      throw new ClaudeCodeMisconfiguredError()
    }
    admittedNames.add(normalizedName)
    restricted[name] = value
  }
  return restricted
}

function resolveSettingsPath(
  environment: NodeJS.ProcessEnv,
  configuredPath: string | undefined,
): string | undefined {
  if (configuredPath !== undefined) {
    if (!isAbsolute(configuredPath)) throw new ClaudeCodeMisconfiguredError()
    return configuredPath
  }
  const configuredDirectory = environment.CLAUDE_CONFIG_DIR?.trim()
  if (configuredDirectory !== undefined && configuredDirectory.length > 0) {
    if (!isAbsolute(configuredDirectory)) {
      throw new ClaudeCodeMisconfiguredError()
    }
    return join(configuredDirectory, 'settings.json')
  }

  const home =
    environment.USERPROFILE?.trim() ||
    environment.HOME?.trim() ||
    homedir().trim()
  return home.length === 0 ? undefined : join(home, '.claude', 'settings.json')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

function hasEnvironmentKey(
  environment: NodeJS.ProcessEnv,
  expectedName: string,
): boolean {
  return Object.keys(environment).some(
    (name) => name.toUpperCase() === expectedName,
  )
}
