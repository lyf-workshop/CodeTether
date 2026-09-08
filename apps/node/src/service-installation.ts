import { execFileSync, spawnSync } from 'node:child_process'
import { constants } from 'node:fs'
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { isSea } from 'node:sea'
import { resolveNodeDataDirectory } from './data-directory.js'
import { dirname, isAbsolute, join, parse } from 'node:path'

export type ServicePlatform = 'linux' | 'darwin'
const label = 'com.codetether.node'
const unit = 'codetether-node.service'
const marker = 'CodeTether owned user service; durable state is retained'

function safePath(value: string): string {
  if (
    !isAbsolute(value) ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new Error('Expected a safe absolute path')
  return value
}

export function servicePaths(platform: ServicePlatform, home: string) {
  safePath(home)
  const application =
    platform === 'darwin'
      ? join(home, 'Library', 'Application Support', 'CodeTether', 'Node')
      : join(home, '.local', 'share', 'codetether-node')
  return {
    executable: join(application, 'bin', 'codetether-node'),
    data: join(application, 'state'),
    log: join(application, 'logs', 'service.log'),
    registration:
      platform === 'darwin'
        ? join(home, 'Library', 'LaunchAgents', `${label}.plist`)
        : join(home, '.config', 'systemd', 'user', unit),
  }
}

function xml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function systemd(value: string) {
  return `"${safePath(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('%', '%%')
    .replaceAll('$', () => '$$')}"`
}

export function generateService(
  platform: ServicePlatform,
  paths: ReturnType<typeof servicePaths>,
): string {
  Object.values(paths).forEach(safePath)
  // No shell, environment import, credentials, pairing code, or public bind.
  if (platform === 'linux')
    return `# ${marker}\n[Unit]\nDescription=CodeTether Node\nStartLimitIntervalSec=60\nStartLimitBurst=5\n[Service]\nType=simple\nExecStart=${systemd(paths.executable)} --data-dir ${systemd(paths.data)} --bind 127.0.0.1 --port 0\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=30\nKillMode=control-group\nUMask=0077\nEnvironment=PATH=/usr/local/bin:/usr/bin:/bin\n[Install]\nWantedBy=default.target\n`
  const args = [
    paths.executable,
    '--data-dir',
    paths.data,
    '--bind',
    '127.0.0.1',
    '--port',
    '0',
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Comment</key><string>${marker}</string>\n<key>Label</key><string>${label}</string>\n<key>ProgramArguments</key><array>${args.map((value) => `<string>${xml(value)}</string>`).join('')}</array>\n<key>RunAtLoad</key><true/>\n<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>\n<key>ThrottleInterval</key><integer>5</integer>\n<key>ExitTimeOut</key><integer>30</integer>\n<key>Umask</key><integer>63</integer>\n<key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>\n<key>StandardOutPath</key><string>${xml(paths.log)}</string>\n<key>StandardErrorPath</key><string>${xml(paths.log)}</string>\n</dict></plist>\n`
}

// Check every existing ancestor before product-owned writes. Never follow a
// symlink/reparse target when writing a binary, unit, or private state.
export async function checkNoSymlinks(path: string): Promise<void> {
  safePath(path)
  const root = parse(path).root
  for (let current = path; current !== root; current = dirname(current)) {
    const metadata = await lstat(current).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      },
    )
    if (metadata?.isSymbolicLink())
      throw new Error('Service path must not contain symlinks')
  }
}

async function privateDirectory(path: string) {
  await checkNoSymlinks(path)
  await mkdir(path, { recursive: true, mode: 0o700 })
  await chmod(path, 0o700)
}

export async function runServiceCommand(
  arguments_: readonly string[],
): Promise<void> {
  if (process.platform !== 'linux' && process.platform !== 'darwin')
    throw new Error('User services require Linux or macOS')
  if (process.getuid?.() === 0)
    throw new Error(
      'Install and run CodeTether Node as the intended non-root user',
    )
  const [action, ...extra] = arguments_
  if (
    extra.length !== 0 ||
    !['install', 'start', 'stop', 'restart', 'status', 'uninstall'].includes(
      action ?? '',
    )
  ) {
    throw new Error(
      'Usage: codetether-node service install|start|stop|restart|status|uninstall',
    )
  }
  const platform = process.platform
  const paths = servicePaths(platform, homedir())
  // Existing Alpha state is authoritative: an installer never silently creates
  // a replacement identity at a new default location.
  paths.data = resolveNodeDataDirectory()
  await Promise.all(Object.values(paths).map(checkNoSymlinks))
  const existing = await readFile(paths.registration, 'utf8').catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    },
  )
  if (existing !== undefined && !existing.includes(marker))
    throw new Error('Refusing to replace a service not owned by CodeTether')
  const env = {
    HOME: homedir(),
    PATH: '/usr/bin:/bin:/usr/local/bin',
    ...(process.env.XDG_RUNTIME_DIR
      ? { XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR }
      : {}),
    ...(process.env.DBUS_SESSION_BUS_ADDRESS
      ? { DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS }
      : {}),
  }
  const run = (command: string, args: string[]) =>
    execFileSync(command, args, {
      shell: false,
      timeout: 35_000,
      stdio: 'inherit',
      env,
    })
  const domain = `gui/${String(process.getuid?.())}`
  const loaded = () => {
    const result = spawnSync(
      '/bin/launchctl',
      ['print', `${domain}/${label}`],
      {
        shell: false,
        timeout: 5000,
        maxBuffer: 128 * 1024,
        env,
        stdio: 'pipe',
      },
    )
    if (result.error)
      throw new Error('User service status could not be observed')
    if (result.status === 0) return true
    if (result.status === 113) return false
    throw new Error('User service status could not be observed')
  }
  const control = (operation: string) => {
    if (operation === 'status') {
      if (platform === 'darwin') {
        // launchctl print can include service-manager environment values. Never
        // forward it to logs, evidence or the user-facing status command.
        process.stdout.write(
          `CodeTether Node service: ${loaded() ? 'loaded' : 'not loaded'}\n`,
        )
      } else {
        const result = spawnSync(
          '/usr/bin/systemctl',
          ['--user', 'is-active', unit],
          {
            shell: false,
            timeout: 5000,
            maxBuffer: 16 * 1024,
            env,
            stdio: 'pipe',
          },
        )
        if (result.error || ![0, 3].includes(result.status ?? -1))
          throw new Error('User service status could not be observed')
        process.stdout.write(
          `CodeTether Node service: ${result.status === 0 ? 'active' : 'inactive'}\n`,
        )
      }
      return
    }
    if (platform === 'linux')
      run('/usr/bin/systemctl', ['--user', operation, unit])
    else {
      const present = loaded()
      if (operation === 'stop' && present)
        run('/bin/launchctl', ['bootout', `${domain}/${label}`])
      else if (operation !== 'stop' && !present)
        run('/bin/launchctl', ['bootstrap', domain, paths.registration])
      else if (operation === 'restart')
        run('/bin/launchctl', ['kickstart', '-k', `${domain}/${label}`])
    }
  }
  if (action === 'install') {
    if (!isSea())
      throw new Error(
        'Service installation requires the packaged Node executable',
      )
    if (existing !== undefined) control('stop')
    await privateDirectory(dirname(paths.executable))
    await privateDirectory(paths.data)
    await privateDirectory(dirname(paths.log))
    await mkdir(dirname(paths.registration), { recursive: true, mode: 0o700 })
    // Exclusive staging: a pre-existing staging file fails closed.
    const staged = `${paths.executable}.installing`
    await copyFile(process.execPath, staged, constants.COPYFILE_EXCL)
    await chmod(staged, 0o700)
    await rename(staged, paths.executable)
    const stagedUnit = `${paths.registration}.installing`
    await writeFile(stagedUnit, generateService(platform, paths), {
      flag: 'wx',
      mode: 0o600,
    })
    await rename(stagedUnit, paths.registration)
    if (platform === 'linux') {
      run('/usr/bin/systemctl', ['--user', 'daemon-reload'])
      run('/usr/bin/systemctl', ['--user', 'enable', unit])
    }
    control('start')
  } else if (action === 'uninstall') {
    if (existing === undefined)
      throw new Error('CodeTether user service is not installed')
    control('stop')
    if (platform === 'linux')
      run('/usr/bin/systemctl', ['--user', 'disable', unit])
    await unlink(paths.registration)
    await unlink(paths.executable)
    if (platform === 'linux')
      run('/usr/bin/systemctl', ['--user', 'daemon-reload'])
    process.stdout.write(
      'CodeTether Node service removed. Durable identity and state retained.\n',
    )
  } else {
    if (existing === undefined)
      throw new Error('Install the CodeTether user service first')
    control(action!)
  }
}
