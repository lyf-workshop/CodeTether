import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'
import type { Writable } from 'node:stream'

/** Private packaged-Desktop POSIX lifetime seam, not installation selection. */
export function spawnCodexCompatibilityProcess(options: {
  executable: string
  arguments: readonly string[]
  environment: NodeJS.ProcessEnv
  timeoutMs: number
}) {
  const guardian =
    process.platform !== 'win32' &&
    process.env.CODETETHER_DESKTOP_MANAGED === '1'
      ? process.env.CODETETHER_POSIX_GUARDIAN
      : undefined
  if (guardian !== undefined) {
    if (!isAbsolute(guardian)) throw new Error('Invalid private probe guardian')
    const configuration = JSON.stringify({
      executable: options.executable,
      arguments: options.arguments,
      timeout_ms: Math.min(options.timeoutMs, 30_000),
    })
    if (Buffer.byteLength(configuration) > 65_536)
      throw new Error('Probe configuration exceeds bound')
    const child = spawn(guardian, ['--codetether-private-probe-guardian'], {
      env: options.environment,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    })
    // Spawn failure may leave no inherited pipes. Consume the asynchronous
    // error before validating them so a missing bundle cannot crash the Host.
    child.on('error', () => undefined)
    const configurationPipe = child.stdio[3] as Writable
    if (
      configurationPipe === null ||
      configurationPipe === undefined ||
      child.stdin === null
    ) {
      child.kill('SIGTERM')
      throw new Error('Private probe guardian could not start')
    }
    configurationPipe.on('error', () => undefined)
    child.stdin.on('error', () => undefined)
    configurationPipe.end(configuration)
    return { child, processGroupOwned: false }
  }
  const processGroupOwned = process.platform !== 'win32'
  const child = spawn(options.executable, [...options.arguments], {
    env: options.environment,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: processGroupOwned,
  })
  return { child, processGroupOwned }
}
