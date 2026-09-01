import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { isAbsolute } from 'node:path'

import { CodexExecutableNotFoundError, CodexProcessError } from './errors.js'

const PARENT_CODEX_CONTROL_VARIABLES = new Set([
  'CODEX_CI',
  'CODEX_PERMISSION_PROFILE',
  'CODEX_SESSION_ID',
  'CODEX_THREAD_ID',
])

const REMOTE_CODEX_ENVIRONMENT_VARIABLES = new Set([
  'ALL_PROXY',
  'CODEX_API_KEY',
  'COMSPEC',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'LANG',
  'LC_ALL',
  'NO_COLOR',
  'NO_PROXY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_ORGANIZATION',
  'OPENAI_PROJECT',
  'PATH',
  'PATHEXT',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'SYSTEMROOT',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'WINDIR',
])

const REMOTE_CODEX_DISABLED_FEATURES = [
  'apply_patch_freeform',
  'apply_patch_preserve_line_endings',
  'apply_patch_streaming_events',
  'hooks',
  'plugins',
  'plugin_hooks',
  'plugin_sharing',
  'apps',
  'enable_mcp_apps',
  'mcp_2026_07_28',
  'non_prefixed_mcp_tool_names',
  'remote_plugin',
  'recommended_plugins',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'computer_use',
  'image_generation',
  'in_app_browser',
  'artifact',
  'view_image',
  'code_mode',
  'code_mode_host',
  'code_mode_interrupt',
  'code_mode_only',
  'js_repl',
  'js_repl_tools_only',
  'request_permissions_tool',
  'request_rule',
  'exec_permission_approvals',
  'guardian_approval',
  'guardianv2',
  'shell_tool',
  'unified_exec',
  'shell_zsh_fork',
  'unified_exec_zsh_fork',
  'shell_snapshot',
  'network_proxy',
  'multi_agent',
  'multi_agent_v2',
  'collaboration_modes',
  'goals',
  'token_budget',
  'current_time_reminder',
  'default_mode_request_user_input',
  'deferred_executor',
  'deferred_tool_world_state',
  'executor_capability_discovery',
  'external_agent_memory_import',
  'memories',
  'tool_suggest',
  'tool_search',
  'search_tool',
  'unavailable_dummy_tools',
  'skill_search',
  'skill_mcp_dependency_install',
  'tool_call_mcp_elicitation',
  'auth_elicitation',
  'psp',
  'standalone_web_search',
  'web_search_cached',
  'web_search_request',
  'workspace_dependencies',
] as const

const REMOTE_CODEX_CONFIG_OVERRIDES = [
  'web_search="disabled"',
  'tools.update_plan.enabled=false',
  'tools.experimental_request_user_input.enabled=false',
  'orchestrator.skills.enabled=false',
  'orchestrator.mcp.enabled=false',
] as const

const REMOTE_CODEX_PROCESS_GROUPS = new WeakMap<
  ChildProcessWithoutNullStreams,
  number
>()

export interface CodexInstallation {
  readonly executable: string
  readonly version: string
  readonly stderr: string
}

export async function inspectCodexInstallation(
  executable = 'codex',
  timeoutMs = 10_000,
): Promise<CodexInstallation> {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const timer = setTimeout(() => {
      child.kill()
      reject(new CodexProcessError('Timed out while checking Codex'))
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.once('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(
        error.code === 'ENOENT'
          ? new CodexExecutableNotFoundError(executable, { cause: error })
          : new CodexProcessError(`Unable to run Codex: ${error.message}`, {
              cause: error,
            }),
      )
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      const version = Buffer.concat(stdout).toString('utf8').trim()
      const diagnostic = Buffer.concat(stderr).toString('utf8').trim()
      if (code !== 0 || version.length === 0) {
        reject(
          new CodexProcessError(
            `Codex version check failed with code ${String(code)}${diagnostic.length > 0 ? `: ${diagnostic}` : ''}`,
          ),
        )
        return
      }
      resolve({ executable, version, stderr: diagnostic })
    })
  })
}

export function spawnCodexAppServer(
  executable = 'codex',
  options: { readonly disableHooks?: boolean } = {},
): ChildProcessWithoutNullStreams {
  return spawn(executable, codexAppServerArguments(options), {
    env: sanitizeCodexChildEnvironment(process.env),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

export function codexAppServerArguments(
  options: { readonly disableHooks?: boolean } = {},
): readonly string[] {
  const arguments_ = ['app-server', '--listen', 'stdio://']
  if (options.disableHooks === true) arguments_.push('--disable', 'hooks')
  return arguments_
}

export interface SpawnRemoteCodexAppServerOptions {
  readonly executable?: string
  readonly codexHome: string
  readonly environment?: NodeJS.ProcessEnv
}

/** Starts the fixed text-only remote profile with no caller-controlled argv. */
export function spawnRemoteCodexAppServer(
  options: SpawnRemoteCodexAppServerOptions,
): ChildProcessWithoutNullStreams {
  const child = spawn(
    options.executable ?? 'codex',
    remoteCodexAppServerArguments(),
    {
      env: sanitizeRemoteCodexChildEnvironment(
        options.environment ?? process.env,
        options.codexHome,
      ),
      // A detached POSIX child becomes leader of a new process group. The
      // remote-only shutdown path targets that saved group exactly, including
      // descendants, without process-name or port searches.
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  if (process.platform !== 'win32' && child.pid !== undefined) {
    REMOTE_CODEX_PROCESS_GROUPS.set(child, child.pid)
  }
  return child
}

export function remoteCodexAppServerArguments(): readonly string[] {
  const arguments_: string[] = []
  for (const feature of REMOTE_CODEX_DISABLED_FEATURES) {
    arguments_.push('--disable', feature)
  }
  for (const override of REMOTE_CODEX_CONFIG_OVERRIDES) {
    arguments_.push('-c', override)
  }
  arguments_.push('app-server', '--listen', 'stdio://', '--strict-config')
  return arguments_
}

export function sanitizeRemoteCodexChildEnvironment(
  environment: NodeJS.ProcessEnv,
  codexHome: string,
): NodeJS.ProcessEnv {
  if (!isAbsolute(codexHome)) {
    throw new CodexProcessError('Remote Codex home must be an absolute path')
  }

  const sanitized = Object.fromEntries(
    Object.entries(environment).filter(([name]) =>
      REMOTE_CODEX_ENVIRONMENT_VARIABLES.has(name.toUpperCase()),
    ),
  )
  return { ...sanitized, CODEX_HOME: codexHome }
}

/**
 * Prevents a Host launched from another Codex session from nesting the new
 * App Server inside the parent's permission and conversation context. Auth,
 * config, PATH, and unrelated CODEX_* variables remain available.
 */
export function sanitizeCodexChildEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => !PARENT_CODEX_CONTROL_VARIABLES.has(name.toUpperCase()),
    ),
  )
}

export async function stopCodexAppServer(
  child: ChildProcessWithoutNullStreams,
  graceMs = 2_000,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return

  child.stdin.end()
  const exited = await waitForProcessExit(child, graceMs)
  if (exited) return

  child.kill('SIGTERM')
  if (await waitForProcessExit(child, graceMs)) return

  child.kill('SIGKILL')
  if (await waitForProcessExit(child, graceMs)) return

  throw new CodexProcessError('Codex App Server did not exit during shutdown')
}

export async function stopRemoteCodexAppServer(
  child: ChildProcessWithoutNullStreams,
  graceMs = 2_000,
): Promise<void> {
  const processGroupId = REMOTE_CODEX_PROCESS_GROUPS.get(child)
  if (processGroupId === undefined) {
    // Synthetic adapter tests do not own a real process group. Production
    // remote clients always come from spawnRemoteCodexAppServer on POSIX, and
    // Windows Nodes do not advertise or admit remote execution.
    await stopCodexAppServer(child, graceMs)
    return
  }

  if (child.exitCode === null && child.signalCode === null) child.stdin.end()
  if (await waitForProcessGroupExit(processGroupId, graceMs)) return

  signalExactProcessGroup(processGroupId, 'SIGTERM')
  if (await waitForProcessGroupExit(processGroupId, graceMs)) return

  signalExactProcessGroup(processGroupId, 'SIGKILL')
  if (await waitForProcessGroupExit(processGroupId, graceMs)) return

  throw new CodexProcessError(
    'Remote Codex App Server process group did not exit during shutdown',
  )
}

async function waitForProcessExit(
  child: ChildProcessWithoutNullStreams,
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

async function waitForProcessGroupExit(
  processGroupId: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (processGroupExists(processGroupId)) {
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return true
}

function processGroupExists(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0)
    return true
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error ? error.code : undefined
    if (code === 'ESRCH') return false
    if (code === 'EPERM') return true
    throw error
  }
}

function signalExactProcessGroup(
  processGroupId: number,
  signal: NodeJS.Signals,
): void {
  try {
    process.kill(-processGroupId, signal)
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error ? error.code : undefined
    if (code !== 'ESRCH') throw error
  }
}
