import { stat, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { ClaudeCodeMisconfiguredError } from './errors.js'

const MAX_SETTINGS_BYTES = 128 * 1024
const MAX_ENVIRONMENT_VALUE_CODE_UNITS = 16 * 1024

/**
 * Restricted mode intentionally ignores Claude's user settings. CodeTether
 * restores only the inert authentication/model routing values required by the
 * installed CLI. Hooks, permissions, plugins, MCP servers, and arbitrary
 * environment variables never cross this boundary.
 */
const RESTRICTED_ENVIRONMENT_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
  'ANTHROPIC_MODEL',
])

export interface ClaudeCodeRestrictedEnvironmentOptions {
  readonly environment?: NodeJS.ProcessEnv
  readonly settingsPath?: string
}

export async function resolveClaudeCodeRestrictedEnvironment(
  options: ClaudeCodeRestrictedEnvironmentOptions = {},
): Promise<NodeJS.ProcessEnv> {
  const baseEnvironment = { ...(options.environment ?? process.env) }
  const settingsPath = resolveSettingsPath(
    baseEnvironment,
    options.settingsPath,
  )
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
    if (baseEnvironment[name] !== undefined) continue
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
