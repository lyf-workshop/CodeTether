import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

import { CodexExecutableNotFoundError, CodexProcessError } from './errors.js'

const PARENT_CODEX_CONTROL_VARIABLES = new Set([
  'CODEX_CI',
  'CODEX_PERMISSION_PROFILE',
  'CODEX_SESSION_ID',
  'CODEX_THREAD_ID',
])

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
  const arguments_ = ['app-server', '--listen', 'stdio://']
  if (options.disableHooks === true) arguments_.push('--disable', 'hooks')
  return spawn(executable, arguments_, {
    env: sanitizeCodexChildEnvironment(process.env),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
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
