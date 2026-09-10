import { spawn } from 'node:child_process'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { request } from 'node:http'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { productVersion } from '../../distribution/src/identity.mjs'

const HOST = '127.0.0.1'
const PORT = 4317
const PRODUCT_NAME = 'CodeTether'
const DESKTOP_EXECUTABLE_NAME = 'codetether-desktop.exe'
const HOST_EXECUTABLE_NAME = 'codetether-host.exe'
const UNINSTALL_EXECUTABLE_NAME = 'uninstall.exe'
const TEMPORARY_ROOT_PREFIX = 'codetether-installed-smoke-'
const STATE_FILE_NAME = 'codetether-installer-smoke-active.json'
const STATE_SCHEMA_VERSION = 1
const READY_TIMEOUT_MS = 20_000
const PROCESS_TIMEOUT_MS = 45_000
const RELEASE_TIMEOUT_MS = 15_000
const TRAY_UI_TIMEOUT_MS = 10_000
const TRAY_QUIT_LABEL = '退出 CodeTether'
const MAX_DIAGNOSTIC_BYTES = 64 * 1024

export class InstallerSmokeCleanupUnsafeError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'InstallerSmokeCleanupUnsafeError'
  }
}

const desktopDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))
const tauriConfigurationPath = join(
  desktopDirectory,
  'src-tauri',
  'tauri.conf.json',
)
const defaultStatePath = join(tmpdir(), STATE_FILE_NAME)

export function parseInstallerSmokeMode(arguments_) {
  if (arguments_.length === 0) return 'run'
  if (
    arguments_.length === 1 &&
    ['run', 'hold', 'cleanup'].includes(arguments_[0])
  ) {
    return arguments_[0]
  }
  throw new Error('Usage: installer-smoke.mjs [run|hold|cleanup]')
}

export function normalizeRegistryPath(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return win32.resolve(trimmed.slice(1, -1))
  }
  return win32.resolve(trimmed)
}

export function installerArguments(installRoot) {
  return ['/S', `/D=${installRoot}`]
}

export function assertInstalledShortcuts(shortcuts, expectedExecutable) {
  ensure(
    Array.isArray(shortcuts) && shortcuts.length > 0,
    'NSIS installer did not create a CodeTether shortcut',
  )
  for (const shortcut of shortcuts) {
    ensure(
      shortcut !== null &&
        typeof shortcut === 'object' &&
        typeof shortcut.path === 'string' &&
        win32.basename(shortcut.path).toLocaleLowerCase('en-US') ===
          `${PRODUCT_NAME}.lnk`.toLocaleLowerCase('en-US') &&
        typeof shortcut.target === 'string' &&
        sameWindowsPath(shortcut.target, expectedExecutable),
      `Installer registered an unexpected shortcut: ${JSON.stringify(shortcut)}`,
    )
  }
  return shortcuts
}

export function assertTrayQuitResult(result, expectedDesktopPid) {
  ensure(
    result !== null &&
      typeof result === 'object' &&
      result.quitRequested === true &&
      result.desktopPid === expectedDesktopPid &&
      result.trayTooltip === PRODUCT_NAME &&
      result.menuItem === TRAY_QUIT_LABEL &&
      result.selectionMethod === 'uia-owned-popup-exact-label' &&
      Array.isArray(result.processIds) &&
      result.processIds.includes(expectedDesktopPid) &&
      result.processIds.every(
        (processId) => Number.isSafeInteger(processId) && processId > 0,
      ),
    'Tray quit helper returned an invalid owned process identity',
  )
  return result
}

export function assertOwnedTemporaryRoot(
  directory,
  temporaryDirectory = tmpdir(),
) {
  const resolved = win32.resolve(directory)
  if (
    win32.dirname(resolved) !== win32.resolve(temporaryDirectory) ||
    !win32.basename(resolved).startsWith(TEMPORARY_ROOT_PREFIX)
  ) {
    throw new Error(
      `Refusing to use unexpected installer-smoke root: ${resolved}`,
    )
  }
  return resolved
}

export function validateInstallerSmokeSession(
  value,
  temporaryDirectory = tmpdir(),
) {
  ensure(
    value !== null && typeof value === 'object',
    'Smoke state is not an object',
  )
  ensure(
    value.schemaVersion === STATE_SCHEMA_VERSION,
    'Smoke state schema is incompatible',
  )
  ensure(
    value.productName === PRODUCT_NAME,
    'Smoke state product identity is invalid',
  )
  const root = assertOwnedTemporaryRoot(value.root, temporaryDirectory)
  const expectedPaths = {
    dataDirectory: win32.join(root, 'data'),
    desktopExecutable: win32.join(root, 'app', DESKTOP_EXECUTABLE_NAME),
    hostExecutable: win32.join(root, 'app', HOST_EXECUTABLE_NAME),
    installRoot: win32.join(root, 'app'),
    projectDirectory: win32.join(root, 'workspace', '项目测试 (Folder Picker)'),
    uninstallExecutable: win32.join(root, 'app', UNINSTALL_EXECUTABLE_NAME),
    webViewDataDirectory: win32.join(root, 'webview'),
  }
  for (const [key, expected] of Object.entries(expectedPaths)) {
    ensure(
      typeof value[key] === 'string' && sameWindowsPath(value[key], expected),
      `Smoke state ${key} is outside its owned root`,
    )
  }
  ensure(
    value.desktopPid === null ||
      (Number.isSafeInteger(value.desktopPid) && value.desktopPid > 0),
    'Smoke state Desktop PID is invalid',
  )
  return { ...value, root, ...expectedPaths }
}

async function main() {
  const mode = parseInstallerSmokeMode(process.argv.slice(2))
  assertWindows()
  const configuration = await readDesktopConfiguration()

  if (mode === 'cleanup') {
    const session = await readSession(defaultStatePath)
    const report = await cleanupSession(session, configuration, {
      requireHide: false,
      strictUninstall: true,
    })
    process.stdout.write(`${JSON.stringify({ mode, ok: true, ...report })}\n`)
    return
  }

  await assertNoActiveState(defaultStatePath)
  const installerPath = await resolveInstallerPath(configuration)
  await assertSafePreflight(configuration)

  const root = assertOwnedTemporaryRoot(
    await mkdtemp(join(tmpdir(), TEMPORARY_ROOT_PREFIX)),
  )
  const session = validateInstallerSmokeSession({
    schemaVersion: STATE_SCHEMA_VERSION,
    productName: PRODUCT_NAME,
    version: configuration.version,
    manufacturer: configuration.manufacturer,
    root,
    installRoot: join(root, 'app'),
    dataDirectory: join(root, 'data'),
    webViewDataDirectory: join(root, 'webview'),
    projectDirectory: join(root, 'workspace', '项目测试 (Folder Picker)'),
    desktopExecutable: join(root, 'app', DESKTOP_EXECUTABLE_NAME),
    hostExecutable: join(root, 'app', HOST_EXECUTABLE_NAME),
    uninstallExecutable: join(root, 'app', UNINSTALL_EXECUTABLE_NAME),
    installerPath,
    desktopPid: null,
    bootstrap: null,
    createdAt: new Date().toISOString(),
  })

  await Promise.all([
    mkdir(session.dataDirectory, { recursive: true }),
    mkdir(session.webViewDataDirectory, { recursive: true }),
    mkdir(session.projectDirectory, { recursive: true }),
  ])
  await writeSession(defaultStatePath, session)

  const startedAt = performance.now()
  let retained = false
  try {
    await installApplication(session, configuration)
    const installedIdentity = await assertInstalledIdentity(
      session,
      configuration,
    )
    const desktop = spawn(session.desktopExecutable, [], {
      cwd: session.installRoot,
      env: desktopEnvironment(session),
      stdio: 'ignore',
      windowsHide: false,
    })
    await waitForChildSpawn(desktop, 'Installed Desktop')
    ensure(
      Number.isSafeInteger(desktop.pid) && desktop.pid > 0,
      'Installed Desktop has no process ID',
    )
    session.desktopPid = desktop.pid
    await writeSession(defaultStatePath, session)
    const bootstrap = await waitForBootstrap(
      READY_TIMEOUT_MS,
      session.desktopPid,
    )
    session.bootstrap = bootstrap
    await writeSession(defaultStatePath, session)
    const database = await waitForNonEmptyFile(
      join(session.dataDirectory, 'codetether.sqlite3'),
      READY_TIMEOUT_MS,
    )

    if (mode === 'hold') {
      desktop.unref()
      retained = true
      process.stdout.write(
        `${JSON.stringify({
          mode,
          ok: true,
          heldOpen: true,
          statePath: defaultStatePath,
          cleanupCommand: 'pnpm desktop:installer-smoke:cleanup',
          desktopPid: session.desktopPid,
          installerPath,
          installRoot: session.installRoot,
          dataDirectory: session.dataDirectory,
          webViewDataDirectory: session.webViewDataDirectory,
          projectDirectory: session.projectDirectory,
          bootstrap,
          databaseBytes: database.size,
          installedIdentity,
          elapsedMs: elapsed(startedAt),
        })}\n`,
      )
      return
    }

    const report = await cleanupSession(session, configuration, {
      requireHide: true,
      strictUninstall: true,
    })
    process.stdout.write(
      `${JSON.stringify({
        mode,
        ok: true,
        installerPath,
        installedIdentity,
        bootstrap,
        databaseBytes: database.size,
        elapsedMs: elapsed(startedAt),
        ...report,
      })}\n`,
    )
  } catch (error) {
    let cleanupError
    const cleanupSafe = !(error instanceof InstallerSmokeCleanupUnsafeError)
    if (!retained && cleanupSafe) {
      try {
        await cleanupSession(session, configuration, {
          requireHide: false,
          strictUninstall: false,
        })
      } catch (caught) {
        cleanupError = caught
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    if (cleanupError !== undefined) {
      const cleanupMessage =
        cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError)
      throw new Error(
        `${message}\nInstaller-smoke cleanup also failed: ${cleanupMessage}\nRecovery state: ${defaultStatePath}`,
        { cause: error },
      )
    }
    if (!cleanupSafe) {
      throw new Error(
        `${message}\nAutomatic cleanup was skipped because the child process exit could not be confirmed.\nRecovery state: ${defaultStatePath}`,
        { cause: error },
      )
    }
    throw error
  }
}

async function readDesktopConfiguration() {
  const config = JSON.parse(await readFile(tauriConfigurationPath, 'utf8'))
  ensure(config.productName === PRODUCT_NAME, 'Unexpected Desktop product name')
  ensure(
    typeof config.version === 'string' && config.version.length > 0,
    'Missing version',
  )
  ensure(
    typeof config.identifier === 'string' && config.identifier.length > 0,
    'Missing identifier',
  )
  ensure(
    config.bundle?.windows?.nsis?.installMode === 'currentUser',
    'Installer smoke requires currentUser NSIS mode',
  )
  const manufacturer =
    config.bundle?.publisher ??
    config.identifier.split('.')[1] ??
    config.identifier
  ensure(
    manufacturer === 'codetether',
    'Unexpected Desktop manufacturer identity',
  )
  return {
    identifier: config.identifier,
    manufacturer,
    productName: config.productName,
    version: productVersion(),
  }
}

async function resolveInstallerPath(configuration) {
  const architecture =
    process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : null
  ensure(
    architecture !== null,
    `Unsupported Windows architecture: ${process.arch}`,
  )
  const installerPath = join(
    desktopDirectory,
    'src-tauri',
    'target',
    'release',
    'bundle',
    'nsis',
    `${configuration.productName}_${configuration.version}_${architecture}-setup.exe`,
  )
  await stat(installerPath)
  return installerPath
}

async function assertSafePreflight(configuration) {
  ensure(!(await isListening()), `Port ${String(PORT)} is already occupied`)
  const preflight = await runPowerShellJson(preflightPowerShell(), {
    CODETETHER_SMOKE_MANUFACTURER: configuration.manufacturer,
    CODETETHER_SMOKE_PRODUCT: configuration.productName,
  })
  ensure(
    Array.isArray(preflight.processes) && preflight.processes.length === 0,
    `CodeTether process already exists: ${JSON.stringify(preflight.processes)}`,
  )
  ensure(
    Array.isArray(preflight.registrations) &&
      preflight.registrations.length === 0,
    `CodeTether installation already exists: ${JSON.stringify(preflight.registrations)}`,
  )
  ensure(
    preflight.manufacturerKeyExists === false,
    'CodeTether installer ownership key already exists',
  )
  ensure(
    Array.isArray(preflight.shortcuts) && preflight.shortcuts.length === 0,
    `CodeTether shortcut already exists: ${JSON.stringify(preflight.shortcuts)}`,
  )
}

async function installApplication(session, configuration) {
  await runProcess(
    session.installerPath,
    installerArguments(session.installRoot),
    PROCESS_TIMEOUT_MS,
    'NSIS installer',
  )
  await assertInstalledIdentity(session, configuration)
}

async function assertInstalledIdentity(session, configuration) {
  const [registry, shortcuts] = await Promise.all([
    readInstallerRegistry(configuration),
    readInstallerShortcuts(configuration),
  ])
  ensure(
    registry.exists === true,
    'NSIS installer did not create its registry identity',
  )
  ensure(
    sameWindowsPath(
      normalizeRegistryPath(registry.installLocation),
      session.installRoot,
    ),
    `Installer registered an unexpected location: ${String(registry.installLocation)}`,
  )
  ensure(
    registry.mainBinaryName === DESKTOP_EXECUTABLE_NAME,
    `Installer registered an unexpected main binary: ${String(registry.mainBinaryName)}`,
  )
  ensure(
    sameWindowsPath(
      normalizeRegistryPath(registry.uninstallString),
      session.uninstallExecutable,
    ),
    `Installer registered an unexpected uninstaller: ${String(registry.uninstallString)}`,
  )
  await Promise.all([
    stat(session.desktopExecutable),
    stat(session.hostExecutable),
    stat(session.uninstallExecutable),
  ])
  assertInstalledShortcuts(shortcuts, session.desktopExecutable)
  return { ...registry, shortcuts }
}

async function cleanupSession(sessionValue, configuration, options) {
  const session = validateInstallerSmokeSession(sessionValue)
  let closeReport = { desktopWasRunning: false, gracefulClose: false }
  let ownedDesktopWasRunning = false

  if (session.desktopPid !== null) {
    const identity = await readProcessIdentity(session.desktopPid)
    if (identity !== null) {
      ownedDesktopWasRunning = true
      ensure(
        sameWindowsPath(identity.executablePath, session.desktopExecutable),
        `Refusing to close reused/foreign PID ${String(session.desktopPid)}`,
      )
      const hideStartedAt = performance.now()
      let hideResult
      try {
        hideResult = await hideOwnedDesktopWindow(
          session.desktopPid,
          session.desktopExecutable,
        )
      } catch (error) {
        if (options.requireHide) throw error
        hideResult = {
          hidden: false,
          recoveryReason:
            error instanceof Error ? error.message : String(error),
        }
      }
      const hideMs = elapsed(hideStartedAt)
      const trayQuitStartedAt = performance.now()
      const quitResult = await quitOwnedDesktopFromTray(
        session.desktopPid,
        session.desktopExecutable,
      )
      await Promise.all([
        waitUntilProcessesExit(quitResult.processIds, RELEASE_TIMEOUT_MS),
        waitUntilNotListening(RELEASE_TIMEOUT_MS),
      ])
      const trayQuitMs = elapsed(trayQuitStartedAt)
      closeReport = {
        desktopWasRunning: true,
        gracefulClose: true,
        hiddenBeforeQuit: hideResult.hidden === true,
        hideRecoveryReason: hideResult.recoveryReason,
        trayQuit: true,
        trayMenuItem: quitResult.menuItem,
        traySelectionMethod: quitResult.selectionMethod,
        hideMs,
        trayQuitMs,
        closedProcessIds: quitResult.processIds,
      }
    }
  }

  // A listener that appears after an already-exited smoke Desktop is external to
  // this session. It must not block removal of the exact owned install root, and
  // it must never be stopped by this script. When we close a live owned Desktop,
  // the branch above still proves that its Host released the port.
  const externalPortOccupied = !ownedDesktopWasRunning && (await isListening())

  const registryBeforeUninstall = await readInstallerRegistry(configuration)
  const uninstallerExists = await pathExists(session.uninstallExecutable)
  if (uninstallerExists) {
    if (registryBeforeUninstall.exists) {
      assertRegistryOwnsSession(registryBeforeUninstall, session)
    } else if (options.strictUninstall) {
      throw new Error(
        'Installed uninstaller exists without its owned registry identity',
      )
    }
    await runProcess(
      session.uninstallExecutable,
      ['/S'],
      PROCESS_TIMEOUT_MS,
      'NSIS uninstaller',
    )
    await waitForUninstall(session, configuration, RELEASE_TIMEOUT_MS)
  } else if (registryBeforeUninstall.exists) {
    assertRegistryOwnsSession(registryBeforeUninstall, session)
    if (options.strictUninstall) {
      throw new Error(
        'Owned installer registration exists without uninstall.exe',
      )
    }
    await removeExactInstallerRegistration(session, configuration)
  }

  // NSIS can leave its Desktop shortcut behind briefly (notably when the
  // Desktop folder is OneDrive-backed). Cleanup is allowed to remove only the
  // two known CodeTether shortcut locations and only when their target is this
  // exact owned smoke executable.
  const removedShortcuts = await removeOwnedInstallerShortcuts(
    session,
    configuration,
  )

  const registryAfterUninstall = await readInstallerRegistry(configuration)
  ensure(
    registryAfterUninstall.exists === false,
    'NSIS uninstall registration remains',
  )
  await assertNoInstallerShortcuts(configuration)
  await cleanupExactManufacturerKey(session, configuration)
  await assertNoInstalledFiles(session)

  await removeOwnedTemporaryRoot(session.root)
  await removeState(defaultStatePath)
  return {
    ...closeReport,
    externalPortOccupied,
    removedShortcuts,
    uninstalled: true,
    rootCleaned: true,
    stateCleaned: true,
  }
}

function assertRegistryOwnsSession(registry, session) {
  ensure(
    sameWindowsPath(
      normalizeRegistryPath(registry.installLocation),
      session.installRoot,
    ),
    'Refusing to uninstall a registry identity outside the owned smoke root',
  )
  ensure(
    sameWindowsPath(
      normalizeRegistryPath(registry.uninstallString),
      session.uninstallExecutable,
    ),
    'Refusing to execute an uninstaller not owned by this smoke session',
  )
}

async function waitForUninstall(session, configuration, timeoutMs) {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    const registry = await readInstallerRegistry(configuration)
    if (
      !registry.exists &&
      !(await pathExists(session.desktopExecutable)) &&
      !(await pathExists(session.hostExecutable)) &&
      !(await pathExists(session.uninstallExecutable))
    ) {
      return
    }
    await delay(100)
  }
  throw new Error('NSIS uninstall did not release its owned files and registry')
}

async function removeOwnedInstallerShortcuts(session, configuration) {
  const shortcuts = await readInstallerShortcuts(configuration)
  for (const shortcut of shortcuts) {
    if (
      shortcut === null ||
      typeof shortcut !== 'object' ||
      typeof shortcut.target !== 'string' ||
      !sameWindowsPath(shortcut.target, session.desktopExecutable)
    ) {
      throw new InstallerSmokeCleanupUnsafeError(
        `Refusing to remove a CodeTether shortcut outside the owned smoke install: ${JSON.stringify(shortcut)}`,
      )
    }
  }
  if (shortcuts.length === 0) return []

  const result = await runPowerShellJson(removeShortcutsPowerShell(), {
    CODETETHER_SMOKE_EXPECTED_EXE: session.desktopExecutable,
    CODETETHER_SMOKE_PRODUCT: configuration.productName,
  })
  ensure(
    Array.isArray(result.removed) && result.removed.length === shortcuts.length,
    'Owned installer shortcut cleanup was not confirmed',
  )
  return result.removed
}

async function assertNoInstallerShortcuts(configuration) {
  const shortcuts = await readInstallerShortcuts(configuration)
  ensure(
    shortcuts.length === 0,
    `NSIS uninstall left a CodeTether shortcut: ${JSON.stringify(shortcuts)}`,
  )
}

async function assertNoInstalledFiles(session) {
  for (const path of [
    session.desktopExecutable,
    session.hostExecutable,
    session.uninstallExecutable,
  ]) {
    ensure(
      !(await pathExists(path)),
      `Installed file remains after uninstall: ${path}`,
    )
  }
}

async function cleanupExactManufacturerKey(session, configuration) {
  const result = await runPowerShellJson(cleanManufacturerKeyPowerShell(), {
    CODETETHER_SMOKE_EXPECTED_ROOT: session.installRoot,
    CODETETHER_SMOKE_MANUFACTURER: configuration.manufacturer,
    CODETETHER_SMOKE_PRODUCT: configuration.productName,
  })
  ensure(
    result.cleaned === true,
    'Manufacturer registry cleanup was not confirmed',
  )
}

async function removeExactInstallerRegistration(session, configuration) {
  const result = await runPowerShellJson(cleanRegistrationPowerShell(), {
    CODETETHER_SMOKE_EXPECTED_ROOT: session.installRoot,
    CODETETHER_SMOKE_MANUFACTURER: configuration.manufacturer,
    CODETETHER_SMOKE_PRODUCT: configuration.productName,
  })
  ensure(
    result.cleaned === true,
    'Installer registry recovery cleanup was not confirmed',
  )
}

async function readInstallerRegistry(configuration) {
  return await runPowerShellJson(readRegistryPowerShell(), {
    CODETETHER_SMOKE_MANUFACTURER: configuration.manufacturer,
    CODETETHER_SMOKE_PRODUCT: configuration.productName,
  })
}

async function readInstallerShortcuts(configuration) {
  const result = await runPowerShellJson(readShortcutsPowerShell(), {
    CODETETHER_SMOKE_PRODUCT: configuration.productName,
  })
  ensure(
    Array.isArray(result.shortcuts),
    'Installer shortcut inspection returned an invalid result',
  )
  return result.shortcuts
}

async function readProcessIdentity(processId) {
  return await runPowerShellJson(processIdentityPowerShell(), {
    CODETETHER_SMOKE_PID: String(processId),
  })
}

async function hideOwnedDesktopWindow(processId, expectedExecutable) {
  const result = await runPowerShellJson(hideWindowPowerShell(), {
    CODETETHER_SMOKE_EXPECTED_EXE: expectedExecutable,
    CODETETHER_SMOKE_PID: String(processId),
  })
  ensure(
    result.hidden === true &&
      result.desktopPid === processId &&
      typeof result.hwnd === 'string' &&
      /^\d+$/u.test(result.hwnd),
    'Owned Desktop main window was not confirmed hidden',
  )
  ensure(
    Array.isArray(result.processIds),
    'Owned process tree result is invalid',
  )
  return result
}

async function quitOwnedDesktopFromTray(processId, expectedExecutable) {
  let result
  try {
    result = await runPowerShellJson(trayQuitPowerShell(), {
      CODETETHER_SMOKE_EXPECTED_EXE: expectedExecutable,
      CODETETHER_SMOKE_PID: String(processId),
      CODETETHER_SMOKE_PRODUCT: PRODUCT_NAME,
      CODETETHER_SMOKE_QUIT_LABEL: TRAY_QUIT_LABEL,
      CODETETHER_SMOKE_TRAY_TIMEOUT_MS: String(TRAY_UI_TIMEOUT_MS),
    })
  } catch (error) {
    throw new InstallerSmokeCleanupUnsafeError(
      'Could not invoke the exact CodeTether tray Quit action; installed smoke state was retained for bounded manual cleanup',
      { cause: error },
    )
  }
  return assertTrayQuitResult(result, processId)
}

async function readSession(path) {
  try {
    return validateInstallerSmokeSession(
      JSON.parse(await readFile(path, 'utf8')),
    )
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`No installer-smoke session exists at ${path}`, {
        cause: error,
      })
    }
    throw error
  }
}

async function writeSession(path, session) {
  const temporaryPath = `${path}.${String(process.pid)}.tmp`
  await writeFile(
    temporaryPath,
    `${JSON.stringify(session, null, 2)}\n`,
    'utf8',
  )
  await rename(temporaryPath, path)
}

async function assertNoActiveState(path) {
  ensure(
    !(await pathExists(path)),
    `Installer-smoke state already exists: ${path}`,
  )
}

async function removeState(path) {
  ensure(
    dirname(resolve(path)) === resolve(tmpdir()) &&
      basename(path) === STATE_FILE_NAME,
    `Refusing to remove unexpected state file: ${path}`,
  )
  await rm(path, { force: true })
}

async function removeOwnedTemporaryRoot(directory) {
  const root = assertOwnedTemporaryRoot(directory)
  if (!(await pathExists(root))) return
  const [canonicalRoot, canonicalTemporaryDirectory] = await Promise.all([
    realpath(root),
    realpath(tmpdir()),
  ])
  ensure(
    dirname(canonicalRoot) === canonicalTemporaryDirectory &&
      basename(canonicalRoot).startsWith(TEMPORARY_ROOT_PREFIX),
    `Refusing to remove a redirected installer-smoke root: ${canonicalRoot}`,
  )
  await rm(root, { recursive: true, force: true })
}

function desktopEnvironment(session) {
  const environment = {
    ...process.env,
    CODETETHER_DATA_DIR: session.dataDirectory,
    CODETETHER_DESKTOP_TEST_SUPPRESS_DIALOG: '1',
    WEBVIEW2_USER_DATA_FOLDER: session.webViewDataDirectory,
  }
  return environment
}

async function waitForBootstrap(timeoutMs, desktopPid) {
  const deadline = performance.now() + timeoutMs
  let lastError
  while (performance.now() < deadline) {
    if ((await readProcessIdentity(desktopPid)) === null) {
      throw new Error('Installed Desktop exited before Host readiness')
    }
    try {
      const response = await httpRequest('/api/v1/bootstrap')
      ensure(
        response.statusCode === 200,
        `Bootstrap returned ${String(response.statusCode)}`,
      )
      const bootstrap = JSON.parse(response.body)
      ensure(
        bootstrap !== null &&
          typeof bootstrap === 'object' &&
          bootstrap.protocolVersion === 1 &&
          typeof bootstrap.hostVersion === 'string' &&
          bootstrap.hostVersion.length > 0 &&
          typeof bootstrap.epoch === 'string' &&
          bootstrap.epoch.length > 0,
        'Bootstrap identity is invalid',
      )
      return bootstrap
    } catch (error) {
      lastError = error
    }
    await delay(100)
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : ''
  throw new Error(`Installed Host readiness timed out${detail}`)
}

async function waitForNonEmptyFile(path, timeoutMs) {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    try {
      const value = await stat(path)
      if (value.size > 0) return value
    } catch (error) {
      if (!(
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      )) {
        throw error
      }
    }
    await delay(100)
  }
  throw new Error(`Expected a non-empty durable database: ${path}`)
}

async function waitUntilNotListening(timeoutMs) {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    if (!(await isListening())) return
    await delay(100)
  }
  throw new Error(`Port ${String(PORT)} remained occupied after Desktop close`)
}

async function waitUntilProcessesExit(processIds, timeoutMs) {
  const uniqueProcessIds = [...new Set(processIds)]
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    const identities = await Promise.all(
      uniqueProcessIds.map(readProcessIdentity),
    )
    if (identities.every((identity) => identity === null)) return
    await delay(100)
  }
  throw new Error(
    `Owned process tree remained after Desktop close: ${uniqueProcessIds.join(', ')}`,
  )
}

async function isListening() {
  return await new Promise((resolveListening) => {
    const socket = createConnection({ host: HOST, port: PORT })
    let settled = false
    const settle = (value) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolveListening(value)
    }
    socket.setTimeout(300)
    socket.once('connect', () => settle(true))
    socket.once('timeout', () => settle(false))
    socket.once('error', () => settle(false))
  })
}

async function httpRequest(path) {
  return await new Promise((resolveRequest, reject) => {
    const outgoing = request(
      { host: HOST, port: PORT, path, method: 'GET', timeout: 1_000 },
      (incoming) => {
        const chunks = []
        incoming.on('data', (chunk) => chunks.push(chunk))
        incoming.once('error', reject)
        incoming.once('end', () => {
          resolveRequest({
            body: Buffer.concat(chunks).toString('utf8'),
            statusCode: incoming.statusCode,
          })
        })
      },
    )
    outgoing.once('timeout', () => outgoing.destroy(new Error('HTTP timeout')))
    outgoing.once('error', reject)
    outgoing.end()
  })
}

async function runProcess(executable, arguments_, timeoutMs, label) {
  const child = spawn(executable, arguments_, {
    cwd: dirname(executable),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let diagnostics = ''
  const capture = (chunk) => {
    diagnostics += chunk.toString()
    if (Buffer.byteLength(diagnostics) > MAX_DIAGNOSTIC_BYTES) {
      diagnostics = diagnostics.slice(-MAX_DIAGNOSTIC_BYTES)
    }
  }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  const outcome = await waitForChildProcessExit(child, {
    label,
    terminationTimeoutMs: RELEASE_TIMEOUT_MS,
    timeoutMs,
  })
  ensure(
    outcome.code === 0 && outcome.signal === null,
    `${label} failed (code=${String(outcome.code)}, signal=${String(outcome.signal)})${diagnostics.length > 0 ? `\n${diagnostics.trim()}` : ''}`,
  )
}

export async function waitForChildSpawn(child, label) {
  await new Promise((resolveSpawn, reject) => {
    const onSpawn = () => {
      child.removeListener('error', onError)
      resolveSpawn()
    }
    const onError = (error) => {
      child.removeListener('spawn', onSpawn)
      reject(
        new Error(`${label} spawn failed: ${error.message}`, { cause: error }),
      )
    }
    child.once('spawn', onSpawn)
    child.once('error', onError)
  })
}

export async function waitForChildProcessExit(
  child,
  { label, terminationTimeoutMs, timeoutMs },
) {
  const completion = new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolveExit({ code, signal }))
  })
  let operationTimeout
  const firstOutcome = await Promise.race([
    completion.then((outcome) => ({ kind: 'exit', outcome })),
    new Promise((resolveTimeout) => {
      operationTimeout = setTimeout(
        () => resolveTimeout({ kind: 'timeout' }),
        timeoutMs,
      )
    }),
  ]).finally(() => clearTimeout(operationTimeout))

  if (firstOutcome.kind === 'exit') return firstOutcome.outcome

  let terminationRequestError
  try {
    if (!child.kill()) {
      terminationRequestError = new Error(
        `${label} did not accept the termination request`,
      )
    }
  } catch (error) {
    terminationRequestError = error
  }

  let terminationTimeout
  const terminationOutcome = await Promise.race([
    completion.then(
      (outcome) => ({ kind: 'exit', outcome }),
      (error) => ({ error, kind: 'error' }),
    ),
    new Promise((resolveTimeout) => {
      terminationTimeout = setTimeout(
        () => resolveTimeout({ kind: 'timeout' }),
        terminationTimeoutMs,
      )
    }),
  ]).finally(() => clearTimeout(terminationTimeout))

  if (terminationOutcome.kind === 'exit') {
    throw new Error(`${label} timed out after ${String(timeoutMs)} ms`)
  }

  const detail =
    terminationOutcome.kind === 'error'
      ? terminationOutcome.error
      : terminationRequestError
  throw new InstallerSmokeCleanupUnsafeError(
    `${label} timed out after ${String(timeoutMs)} ms and its exit could not be confirmed`,
    detail === undefined ? undefined : { cause: detail },
  )
}

async function runPowerShellJson(script, extraEnvironment = {}) {
  const powershell = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
  const child = spawn(
    powershell,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)\n${script}`,
    ],
    {
      env: { ...process.env, ...extraEnvironment },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })
  const outcome = await new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolveExit({ code, signal }))
  })
  ensure(
    outcome.code === 0 && outcome.signal === null,
    `PowerShell helper failed (code=${String(outcome.code)}): ${stderr.trim()}`,
  )
  const output = stdout.trim()
  ensure(output.length > 0, 'PowerShell helper returned no JSON')
  try {
    return JSON.parse(output)
  } catch (error) {
    throw new Error(`Could not parse PowerShell helper output: ${output}`, {
      cause: error,
    })
  }
}

function preflightPowerShell() {
  return String.raw`
$ErrorActionPreference = 'Stop'
$product = $env:CODETETHER_SMOKE_PRODUCT
$manufacturer = $env:CODETETHER_SMOKE_MANUFACTURER
$processes = @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -ieq '${DESKTOP_EXECUTABLE_NAME}' -or $_.Name -ieq '${HOST_EXECUTABLE_NAME}'
} | ForEach-Object {
  [pscustomobject]@{ pid = [int]$_.ProcessId; name = [string]$_.Name; executablePath = [string]$_.ExecutablePath }
})
$registrations = New-Object 'System.Collections.Generic.List[object]'
$roots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
foreach ($root in $roots) {
  if (!(Test-Path -LiteralPath $root)) { continue }
  foreach ($key in @(Get-ChildItem -LiteralPath $root -ErrorAction Stop)) {
    $properties = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
    if ($key.PSChildName -ieq $product -or $properties.DisplayName -ieq $product) {
      [void]$registrations.Add([pscustomobject]@{
        key = [string]$key.Name
        displayName = [string]$properties.DisplayName
        installLocation = [string]$properties.InstallLocation
      })
    }
  }
}
$manufacturerKey = "HKCU:\Software\$manufacturer\$product"
$shortcuts = New-Object 'System.Collections.Generic.List[string]'
$shortcutPaths = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) "$product.lnk"),
  (Join-Path ([Environment]::GetFolderPath('Programs')) "$product.lnk")
)
foreach ($path in $shortcutPaths) {
  if (Test-Path -LiteralPath $path) { [void]$shortcuts.Add($path) }
}
[pscustomobject]@{
  processes = @($processes)
  registrations = @($registrations.ToArray())
  manufacturerKeyExists = [bool](Test-Path -LiteralPath $manufacturerKey)
  shortcuts = @($shortcuts.ToArray())
} | ConvertTo-Json -Compress -Depth 6
`
}

function readRegistryPowerShell() {
  return String.raw`
$ErrorActionPreference = 'Stop'
$product = $env:CODETETHER_SMOKE_PRODUCT
$keyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$product"
if (!(Test-Path -LiteralPath $keyPath)) {
  [pscustomobject]@{ exists = $false } | ConvertTo-Json -Compress
  exit 0
}
$properties = Get-ItemProperty -LiteralPath $keyPath -ErrorAction Stop
[pscustomobject]@{
  exists = $true
  key = $keyPath
  displayName = [string]$properties.DisplayName
  displayVersion = [string]$properties.DisplayVersion
  installLocation = [string]$properties.InstallLocation
  mainBinaryName = [string]$properties.MainBinaryName
  uninstallString = [string]$properties.UninstallString
} | ConvertTo-Json -Compress
`
}

function readShortcutsPowerShell() {
  return String.raw`
$ErrorActionPreference = 'Stop'
$product = $env:CODETETHER_SMOKE_PRODUCT
$shortcutPaths = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) "$product.lnk"),
  (Join-Path ([Environment]::GetFolderPath('Programs')) "$product.lnk")
)
$shell = New-Object -ComObject WScript.Shell
$shortcuts = New-Object 'System.Collections.Generic.List[object]'
foreach ($path in $shortcutPaths) {
  if (!(Test-Path -LiteralPath $path)) { continue }
  $shortcut = $shell.CreateShortcut($path)
  $target = [string]$shortcut.TargetPath
  [void]$shortcuts.Add([pscustomobject]@{
    path = [IO.Path]::GetFullPath($path)
    target = if ([string]::IsNullOrWhiteSpace($target)) {
      $target
    }
    else {
      [IO.Path]::GetFullPath($target)
    }
  })
}
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
[pscustomobject]@{ shortcuts = @($shortcuts.ToArray()) } | ConvertTo-Json -Compress -Depth 4
`
}

function removeShortcutsPowerShell() {
  return String.raw`
$ErrorActionPreference = 'Stop'
$expectedExecutable = [IO.Path]::GetFullPath($env:CODETETHER_SMOKE_EXPECTED_EXE)
$product = $env:CODETETHER_SMOKE_PRODUCT
$shortcutPaths = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) "$product.lnk"),
  (Join-Path ([Environment]::GetFolderPath('Programs')) "$product.lnk")
)
$shell = New-Object -ComObject WScript.Shell
$removed = New-Object 'System.Collections.Generic.List[string]'
foreach ($path in $shortcutPaths) {
  if (!(Test-Path -LiteralPath $path)) { continue }
  $shortcut = $shell.CreateShortcut($path)
  $target = [string]$shortcut.TargetPath
  if (
    [string]::IsNullOrWhiteSpace($target) -or
    ![string]::Equals(
      [IO.Path]::GetFullPath($target),
      $expectedExecutable,
      [StringComparison]::OrdinalIgnoreCase
    )
  ) {
    throw "Refusing to remove a shortcut that is not owned by this smoke install: $path"
  }
  Remove-Item -LiteralPath $path -Force
  [void]$removed.Add([IO.Path]::GetFullPath($path))
}
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
[pscustomobject]@{ removed = @($removed.ToArray()) } | ConvertTo-Json -Compress -Depth 4
`
}

function processIdentityPowerShell() {
  return String.raw`
$ErrorActionPreference = 'Stop'
$processId = [uint32]$env:CODETETHER_SMOKE_PID
$matches = @(Get-CimInstance Win32_Process -Filter "ProcessId = $processId")
if ($matches.Count -eq 0) { 'null'; exit 0 }
if ($matches.Count -ne 1) { throw 'Process identity is ambiguous' }
[pscustomobject]@{
  pid = [int]$matches[0].ProcessId
  parentPid = [int]$matches[0].ParentProcessId
  name = [string]$matches[0].Name
  executablePath = [string]$matches[0].ExecutablePath
} | ConvertTo-Json -Compress
`
}

function hideWindowPowerShell() {
  return String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class CodeTetherInstalledSmokeWindow {
  private delegate bool EnumWindowsCallback(IntPtr window, IntPtr state);
  [DllImport("user32.dll")][return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr state);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")][return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextLengthW(IntPtr window);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextW(IntPtr window, StringBuilder text, int capacity);
  [DllImport("user32.dll", SetLastError = true)][return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool PostMessageW(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam);
  private static string Title(IntPtr window) {
    int length = GetWindowTextLengthW(window);
    var text = new StringBuilder(length + 1);
    GetWindowTextW(window, text, text.Capacity);
    return text.ToString();
  }
  public static IntPtr Find(uint pid, string title) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr window, IntPtr state) {
      uint candidate; GetWindowThreadProcessId(window, out candidate);
      if (candidate == pid && String.Equals(Title(window), title, StringComparison.Ordinal)) {
        found = window; return false;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static bool Close(IntPtr window) { return PostMessageW(window, 0x0010, UIntPtr.Zero, IntPtr.Zero); }
}
'@
$expectedPid = [uint32]$env:CODETETHER_SMOKE_PID
$expectedExe = [IO.Path]::GetFullPath($env:CODETETHER_SMOKE_EXPECTED_EXE)
$desktop = @(Get-CimInstance Win32_Process -Filter "ProcessId = $expectedPid")
if ($desktop.Count -ne 1) { throw 'Exact installed Desktop process was not found' }
$actualExe = [IO.Path]::GetFullPath([string]$desktop[0].ExecutablePath)
if (![string]::Equals($actualExe, $expectedExe, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Installed Desktop PID does not belong to the smoke install root'
}
$all = @(Get-CimInstance Win32_Process)
$known = New-Object 'System.Collections.Generic.HashSet[uint32]'
[void]$known.Add($expectedPid)
do {
  $added = $false
  foreach ($candidate in $all) {
    $candidateId = [uint32]$candidate.ProcessId
    if (!$known.Contains($candidateId) -and $known.Contains([uint32]$candidate.ParentProcessId)) {
      [void]$known.Add($candidateId); $added = $true
    }
  }
} while ($added)
$windowDeadline = [DateTime]::UtcNow.AddSeconds(5)
$window = [IntPtr]::Zero
do {
  $window = [CodeTetherInstalledSmokeWindow]::Find($expectedPid, '${PRODUCT_NAME}')
  if ($window -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 50
} while ([DateTime]::UtcNow -lt $windowDeadline)
if ($window -eq [IntPtr]::Zero) { throw 'Exact installed Desktop main window was not found' }
$wasVisible = [CodeTetherInstalledSmokeWindow]::IsWindowVisible($window)
if ($wasVisible) {
  if (![CodeTetherInstalledSmokeWindow]::Close($window)) { throw 'WM_CLOSE failed' }
  $hideDeadline = [DateTime]::UtcNow.AddSeconds(5)
  do {
    if (![CodeTetherInstalledSmokeWindow]::IsWindowVisible($window)) { break }
    Start-Sleep -Milliseconds 50
  } while ([DateTime]::UtcNow -lt $hideDeadline)
}
if ([CodeTetherInstalledSmokeWindow]::IsWindowVisible($window)) {
  throw 'Installed Desktop did not hide after WM_CLOSE'
}
[pscustomobject]@{
  desktopPid = [int]$expectedPid
  hwnd = [string]$window.ToInt64()
  wasVisible = [bool]$wasVisible
  hidden = $true
  processIds = @($known)
} | ConvertTo-Json -Compress -Depth 4
`
}

function trayQuitPowerShell() {
  return String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CodeTetherInstalledSmokeMouse {
  [DllImport("user32.dll")][return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
  public static void RightClick(int x, int y) {
    if (!SetCursorPos(x, y)) throw new InvalidOperationException("Could not position the pointer on the tray icon");
    mouse_event(0x0008, 0, 0, 0, UIntPtr.Zero);
    mouse_event(0x0010, 0, 0, 0, UIntPtr.Zero);
  }
  public static void LeftClick(int x, int y) {
    if (!SetCursorPos(x, y)) throw new InvalidOperationException("Could not position the pointer on the tray menu item");
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
  }
  [DllImport("user32.dll")]
  public static extern IntPtr GetShellWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetClassNameW(IntPtr window, System.Text.StringBuilder className, int maximumCount);
  public static uint WindowProcessId(IntPtr window) {
    uint processId;
    GetWindowThreadProcessId(window, out processId);
    return processId;
  }
  public static string WindowClass(IntPtr window) {
    var className = new System.Text.StringBuilder(256);
    return GetClassNameW(window, className, className.Capacity) > 0 ? className.ToString() : String.Empty;
  }
}
'@

$expectedPid = [uint32]$env:CODETETHER_SMOKE_PID
$expectedExe = [IO.Path]::GetFullPath($env:CODETETHER_SMOKE_EXPECTED_EXE)
$product = $env:CODETETHER_SMOKE_PRODUCT
$quitLabel = $env:CODETETHER_SMOKE_QUIT_LABEL
$timeoutMs = [int]$env:CODETETHER_SMOKE_TRAY_TIMEOUT_MS
if ($timeoutMs -lt 1000 -or $timeoutMs -gt 30000) { throw 'Tray UI timeout is outside the bounded range' }
$desktop = @(Get-CimInstance Win32_Process -Filter "ProcessId = $expectedPid")
if ($desktop.Count -ne 1) { throw 'Exact installed Desktop process was not found for tray quit' }
$actualExe = [IO.Path]::GetFullPath([string]$desktop[0].ExecutablePath)
if (![string]::Equals($actualExe, $expectedExe, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Installed Desktop PID does not belong to the smoke install root'
}
$shellWindow = [CodeTetherInstalledSmokeMouse]::GetShellWindow()
if ($shellWindow -eq [IntPtr]::Zero) { throw 'Windows shell window is unavailable' }
$shellPid = [CodeTetherInstalledSmokeMouse]::WindowProcessId($shellWindow)
if ($shellPid -eq 0) { throw 'Windows shell process identity is unavailable' }

$all = @(Get-CimInstance Win32_Process)
$known = New-Object 'System.Collections.Generic.HashSet[uint32]'
[void]$known.Add($expectedPid)
do {
  $added = $false
  foreach ($candidate in $all) {
    $candidateId = [uint32]$candidate.ProcessId
    if (!$known.Contains($candidateId) -and $known.Contains([uint32]$candidate.ParentProcessId)) {
      [void]$known.Add($candidateId); $added = $true
    }
  }
} while ($added)

function Test-NotificationAreaElement($element) {
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $current = $element
  for ($depth = 0; $depth -lt 64 -and $null -ne $current; $depth++) {
    try {
      $handle = [IntPtr]::new([long]$current.Current.NativeWindowHandle)
      if ($handle -ne [IntPtr]::Zero) {
        $className = [CodeTetherInstalledSmokeMouse]::WindowClass($handle)
        $ownerPid = [CodeTetherInstalledSmokeMouse]::WindowProcessId($handle)
        if (
          $ownerPid -eq $shellPid -and
          $className -in @('Shell_TrayWnd', 'NotifyIconOverflowWindow', 'TopLevelWindowForOverflowXamlIsland')
        ) {
          return $true
        }
      }
      $current = $walker.GetParent($current)
    } catch {
      return $false
    }
  }
  return $false
}

function Test-OwnedPopupMenuItem($element) {
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $current = $element
  for ($depth = 0; $depth -lt 32 -and $null -ne $current; $depth++) {
    try {
      $handle = [IntPtr]::new([long]$current.Current.NativeWindowHandle)
      if (
        $handle -ne [IntPtr]::Zero -and
        [CodeTetherInstalledSmokeMouse]::WindowClass($handle) -eq '#32768' -and
        [CodeTetherInstalledSmokeMouse]::WindowProcessId($handle) -eq $expectedPid
      ) {
        return $true
      }
      $current = $walker.GetParent($current)
    } catch {
      return $false
    }
  }
  return $false
}

function Find-ExactVisibleAutomationElement([string]$name, $controlType, [scriptblock]$identityCheck) {
  $nameCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty,
    $name
  )
  $elements = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    $nameCondition
  )
  $matches = New-Object 'System.Collections.Generic.List[object]'
  foreach ($element in $elements) {
    try {
      if (
        $element.Current.ControlType -eq $controlType -and
        !$element.Current.IsOffscreen -and
        $element.Current.IsEnabled -and
        (& $identityCheck $element)
      ) {
        [void]$matches.Add($element)
      }
    } catch { }
  }
  if ($matches.Count -gt 1) { throw "Automation identity is ambiguous for: $name" }
  if ($matches.Count -eq 1) { return $matches[0] }
  return $null
}

function Invoke-AutomationElement($element, [bool]$rightClick) {
  $rectangle = $element.Current.BoundingRectangle
  if ($rectangle.Width -le 0 -or $rectangle.Height -le 0) {
    throw 'Automation element has no clickable rectangle'
  }
  $x = [int]($rectangle.Left + ($rectangle.Width / 2))
  $y = [int]($rectangle.Top + ($rectangle.Height / 2))
  if ($rightClick) {
    [CodeTetherInstalledSmokeMouse]::RightClick($x, $y)
  } else {
    try {
      $pattern = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      ([System.Windows.Automation.InvokePattern]$pattern).Invoke()
    } catch {
      [CodeTetherInstalledSmokeMouse]::LeftClick($x, $y)
    }
  }
}

$deadline = [DateTime]::UtcNow.AddMilliseconds($timeoutMs)
$trayIcon = $null
do {
  $trayIcon = Find-ExactVisibleAutomationElement $product ([System.Windows.Automation.ControlType]::Button) { param($candidate) Test-NotificationAreaElement $candidate }
  if ($null -ne $trayIcon) { break }

  foreach ($chevronName in @('Show hidden icons', '显示隐藏的图标')) {
    $chevron = Find-ExactVisibleAutomationElement $chevronName ([System.Windows.Automation.ControlType]::Button) { param($candidate) Test-NotificationAreaElement $candidate }
    if ($null -ne $chevron) {
      Invoke-AutomationElement $chevron $false
      Start-Sleep -Milliseconds 150
      break
    }
  }
  Start-Sleep -Milliseconds 75
} while ([DateTime]::UtcNow -lt $deadline)
if ($null -eq $trayIcon) { throw 'Exact CodeTether tray icon was not found' }

Invoke-AutomationElement $trayIcon $true
$deadline = [DateTime]::UtcNow.AddMilliseconds($timeoutMs)
$quitItem = $null
do {
  $quitItem = Find-ExactVisibleAutomationElement $quitLabel ([System.Windows.Automation.ControlType]::MenuItem) { param($candidate) Test-OwnedPopupMenuItem $candidate }
  if ($null -ne $quitItem) { break }
  Start-Sleep -Milliseconds 50
} while ([DateTime]::UtcNow -lt $deadline)
if ($null -eq $quitItem) {
  throw 'The exact owned CodeTether tray Quit menu item was not exposed through UI Automation'
}
$selectionMethod = 'uia-owned-popup-exact-label'
Invoke-AutomationElement $quitItem $false

[pscustomobject]@{
  quitRequested = $true
  desktopPid = [int]$expectedPid
  trayTooltip = $product
  menuItem = $quitLabel
  selectionMethod = $selectionMethod
  processIds = @($known)
} | ConvertTo-Json -Compress -Depth 4
`
}

function cleanManufacturerKeyPowerShell() {
  return String.raw`
$ErrorActionPreference = 'Stop'
$product = $env:CODETETHER_SMOKE_PRODUCT
$manufacturer = $env:CODETETHER_SMOKE_MANUFACTURER
$expected = [IO.Path]::GetFullPath($env:CODETETHER_SMOKE_EXPECTED_ROOT)
$keyPath = "HKCU:\Software\$manufacturer\$product"
if (!(Test-Path -LiteralPath $keyPath)) {
  [pscustomobject]@{ cleaned = $true; existed = $false } | ConvertTo-Json -Compress
  exit 0
}
$key = Get-Item -LiteralPath $keyPath -ErrorAction Stop
$actual = [IO.Path]::GetFullPath([string]$key.GetValue(''))
if (![string]::Equals($actual, $expected, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Manufacturer key does not belong to the smoke install root'
}
$unexpectedValues = @($key.GetValueNames() | Where-Object { $_ -notin @('', 'Installer Language') })
if ($unexpectedValues.Count -gt 0 -or $key.GetSubKeyNames().Count -gt 0) {
  throw 'Manufacturer key contains values or children not owned by installer smoke'
}
Remove-Item -LiteralPath $keyPath -Recurse -Force
[pscustomobject]@{ cleaned = $true; existed = $true } | ConvertTo-Json -Compress
`
}

function cleanRegistrationPowerShell() {
  return String.raw`
$ErrorActionPreference = 'Stop'
$product = $env:CODETETHER_SMOKE_PRODUCT
$expected = [IO.Path]::GetFullPath($env:CODETETHER_SMOKE_EXPECTED_ROOT)
$keyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$product"
if (!(Test-Path -LiteralPath $keyPath)) {
  [pscustomobject]@{ cleaned = $true; existed = $false } | ConvertTo-Json -Compress
  exit 0
}
$properties = Get-ItemProperty -LiteralPath $keyPath -ErrorAction Stop
$actualText = ([string]$properties.InstallLocation).Trim()
if ($actualText.StartsWith('"') -and $actualText.EndsWith('"')) { $actualText = $actualText.Substring(1, $actualText.Length - 2) }
$actual = [IO.Path]::GetFullPath($actualText)
if (![string]::Equals($actual, $expected, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Uninstall registration does not belong to the smoke install root'
}
Remove-Item -LiteralPath $keyPath -Recurse -Force
[pscustomobject]@{ cleaned = $true; existed = $true } | ConvertTo-Json -Compress
`
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return false
    throw error
  }
}

function sameWindowsPath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  return (
    win32.resolve(left).localeCompare(win32.resolve(right), 'en', {
      sensitivity: 'accent',
    }) === 0
  )
}

function assertWindows() {
  ensure(process.platform === 'win32', 'Installed NSIS smoke is Windows-only')
}

function elapsed(startedAt) {
  return Math.round(performance.now() - startedAt)
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

function ensure(condition, message) {
  if (!condition) throw new Error(message)
}

const directEntry =
  process.argv[1] === undefined ? null : resolve(process.argv[1])
if (
  directEntry !== null &&
  directEntry === resolve(fileURLToPath(import.meta.url))
) {
  await main()
}
