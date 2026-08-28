import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { request } from 'node:http'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

const HOST = '127.0.0.1'
const PORT = 4317
const PROCESS_TIMEOUT_MS = 25_000
const SECOND_INSTANCE_TIMEOUT_MS = 5_000
const READY_TIMEOUT_MS = 15_000
const RELEASE_TIMEOUT_MS = 12_000
const WINDOW_CLOSE_TIMEOUT_MS = 15_000
const WINDOW_TITLE = 'CodeTether'
const MAX_DIAGNOSTIC_BYTES = 64 * 1024

const desktopDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseDirectory = join(
  desktopDirectory,
  'src-tauri',
  'target',
  'release',
)
const desktopExecutable = join(releaseDirectory, 'codetether-desktop.exe')
const hostExecutable = join(releaseDirectory, 'codetether-host.exe')
const powershellExecutable = join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
)
const trackedChildren = new Set()
const report = {
  ok: false,
  platform: process.platform,
  executables: { desktop: desktopExecutable, host: hostExecutable },
  timings: {},
  results: {},
}
const suiteStartedAt = performance.now()
let dataRoot

try {
  ensure(process.platform === 'win32', 'Lifecycle smoke is Windows-only')
  await Promise.all([stat(desktopExecutable), stat(hostExecutable)])
  await assertPortFree('suite startup')

  dataRoot = await mkdtemp(join(tmpdir(), 'codetether-lifecycle-smoke-'))
  report.dataRoot = dataRoot

  report.results.windowClose = await testWindowClose(
    join(dataRoot, 'window-close'),
  )
  report.results.unexpectedHostExit = await testUnexpectedHostExit(
    join(dataRoot, 'unexpected-host-exit'),
  )
  report.results.singleInstance = await testSingleInstance(
    join(dataRoot, 'single-instance'),
  )
  report.results.unknownListener = await testUnknownListener(
    join(dataRoot, 'unknown-listener'),
  )
  report.results.externalHost = await testExternalHost(
    join(dataRoot, 'external-host'),
    join(dataRoot, 'external-host-desktop'),
  )
  report.ok = true
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error)
  process.exitCode = 1
} finally {
  if (!report.ok) await killTrackedChildren()
  if (report.ok && dataRoot !== undefined) {
    await removeOwnedTemporaryDirectory(dataRoot)
    report.dataRootCleaned = true
  }
  report.timings.totalMs = elapsed(suiteStartedAt)
}

process.stdout.write(`${JSON.stringify(report)}\n`)

async function testWindowClose(dataDirectory) {
  await mkdir(dataDirectory, { recursive: true })
  await assertPortFree('WM_CLOSE test')
  const startedAt = performance.now()
  const desktop = spawnTracked(
    'Desktop WM_CLOSE instance',
    desktopExecutable,
    [],
    desktopEnvironmentWithoutSuppressedDialogs(dataDirectory),
  )
  let passed = false

  try {
    const bootstrap = await waitForBootstrap(READY_TIMEOUT_MS, desktop)
    const readyMs = elapsed(startedAt)
    const desktopPid = desktop.child.pid
    ensure(
      Number.isSafeInteger(desktopPid) && desktopPid > 0,
      'Desktop WM_CLOSE instance has no process ID',
    )

    const closeStartedAt = performance.now()
    const closeResult = await postWindowClose(desktopPid)
    const descendants = Array.isArray(closeResult.descendants)
      ? closeResult.descendants
      : [closeResult.descendants]
    ensure(
      descendants.some(
        (process_) =>
          process_ !== null &&
          typeof process_ === 'object' &&
          typeof process_.name === 'string' &&
          process_.name.toLowerCase() === 'codetether-host.exe',
      ),
      'Desktop process tree did not contain its owned Host before WM_CLOSE',
    )
    const ownedProcessIds = [
      desktopPid,
      ...descendants.map((process_) => process_.pid),
    ]
    ensure(
      ownedProcessIds.every(
        (processId) => Number.isSafeInteger(processId) && processId > 0,
      ),
      'Desktop process tree contained an invalid process ID',
    )

    const desktopExit = await waitForExit(desktop, WINDOW_CLOSE_TIMEOUT_MS)
    ensureCleanExit(desktop, desktopExit)
    ensure(
      !/shutdown timed out|did not confirm a clean shutdown/u.test(
        desktop.diagnostics(),
      ),
      `WM_CLOSE did not complete graceful Host shutdown${diagnosticSuffix(desktop)}`,
    )
    const desktopExitMs = elapsed(closeStartedAt)
    const releaseStartedAt = performance.now()
    await Promise.all([
      waitUntilNotListening(RELEASE_TIMEOUT_MS),
      waitUntilProcessesExit(ownedProcessIds, RELEASE_TIMEOUT_MS),
    ])
    const releaseMs = elapsed(releaseStartedAt)
    passed = true

    return {
      passed: true,
      readyMs,
      bootstrapHostVersion: bootstrap.hostVersion,
      desktopPid,
      hwnd: closeResult.hwnd,
      title: closeResult.title,
      descendantProcesses: descendants,
      desktopExitMs,
      desktopExitCode: desktopExit.code,
      portReleased: true,
      processTreeReleased: true,
      releaseMs,
    }
  } finally {
    if (!passed) killIfRunning(desktop)
  }
}

async function testUnexpectedHostExit(dataDirectory) {
  await mkdir(dataDirectory, { recursive: true })
  await assertPortFree('unexpected Host exit test')
  const startedAt = performance.now()
  const desktop = spawnTracked(
    'Desktop unexpected Host exit instance',
    desktopExecutable,
    [],
    desktopEnvironment(dataDirectory),
  )
  let passed = false

  try {
    const bootstrap = await waitForBootstrap(READY_TIMEOUT_MS, desktop)
    const readyMs = elapsed(startedAt)
    const desktopPid = desktop.child.pid
    ensure(
      Number.isSafeInteger(desktopPid) && desktopPid > 0,
      'Desktop unexpected Host exit instance has no process ID',
    )

    const processTree = await readDesktopProcessTree(desktopPid)
    const descendants = Array.isArray(processTree.descendants)
      ? processTree.descendants
      : [processTree.descendants]
    const ownedHosts = descendants.filter(
      (process_) =>
        process_ !== null &&
        typeof process_ === 'object' &&
        typeof process_.name === 'string' &&
        process_.name.toLowerCase() === 'codetether-host.exe',
    )
    ensure(
      ownedHosts.length === 1,
      `Expected exactly one owned Host, found ${String(ownedHosts.length)}`,
    )
    const ownedHostPid = ownedHosts[0].pid
    const ownedProcessIds = [
      desktopPid,
      ...descendants.map((process_) => process_.pid),
    ]
    ensure(
      ownedProcessIds.every(
        (processId) => Number.isSafeInteger(processId) && processId > 0,
      ),
      'Unexpected Host exit process tree contained an invalid process ID',
    )

    const terminationStartedAt = performance.now()
    ensure(
      isProcessAlive(ownedHostPid),
      'Owned Host exited before the unexpected-exit action',
    )
    ensure(
      process.kill(ownedHostPid),
      `Could not terminate owned Host PID ${String(ownedHostPid)}`,
    )

    const desktopExit = await waitForExit(desktop, WINDOW_CLOSE_TIMEOUT_MS)
    ensureNonZeroExit(desktop, desktopExit)
    ensure(
      /owned Host exited unexpectedly/u.test(desktop.diagnostics()),
      `Desktop did not diagnose its owned Host exit${diagnosticSuffix(desktop)}`,
    )
    const desktopExitMs = elapsed(terminationStartedAt)
    const releaseStartedAt = performance.now()
    await Promise.all([
      waitUntilNotListening(RELEASE_TIMEOUT_MS),
      waitUntilProcessesExit(ownedProcessIds, RELEASE_TIMEOUT_MS),
    ])
    const releaseMs = elapsed(releaseStartedAt)
    passed = true

    return {
      passed: true,
      readyMs,
      bootstrapHostVersion: bootstrap.hostVersion,
      desktopPid,
      terminatedHostPid: ownedHostPid,
      descendantProcesses: descendants,
      desktopExitMs,
      desktopExitCode: desktopExit.code,
      diagnosedUnexpectedExit: true,
      portReleased: true,
      processTreeReleased: true,
      releaseMs,
    }
  } finally {
    if (!passed) killIfRunning(desktop)
  }
}

async function testSingleInstance(dataDirectory) {
  await mkdir(dataDirectory, { recursive: true })
  await assertPortFree('single-instance test')
  const startedAt = performance.now()
  const first = spawnTracked(
    'first Desktop instance',
    desktopExecutable,
    ['--desktop-smoke-exit-after-ready-ms=5000'],
    desktopEnvironment(dataDirectory),
  )
  let second
  let passed = false

  try {
    const initialBootstrap = await waitForBootstrap(READY_TIMEOUT_MS, first)
    const firstReadyMs = elapsed(startedAt)
    ensure(isRunning(first), 'First Desktop exited before the second launch')

    const secondStartedAt = performance.now()
    second = spawnTracked(
      'second Desktop instance',
      desktopExecutable,
      [],
      desktopEnvironment(dataDirectory),
    )
    const secondExit = await waitForExit(second, SECOND_INSTANCE_TIMEOUT_MS)
    const secondExitMs = elapsed(secondStartedAt)
    ensureCleanExit(second, secondExit)
    ensure(isRunning(first), 'Second launch terminated the first Desktop')

    const preservedBootstrap = await readBootstrap()
    ensure(
      sameHost(initialBootstrap, preservedBootstrap),
      'The first Desktop Host changed after the second launch',
    )

    const firstExit = await waitForExit(first, PROCESS_TIMEOUT_MS)
    ensureCleanExit(first, firstExit)
    ensure(
      !/shutdown timed out|did not confirm a clean shutdown/u.test(
        first.diagnostics(),
      ),
      `First Desktop did not complete graceful Host shutdown${diagnosticSuffix(first)}`,
    )
    const portReleaseStartedAt = performance.now()
    await waitUntilNotListening(RELEASE_TIMEOUT_MS)
    const portReleaseMs = elapsed(portReleaseStartedAt)
    passed = true

    return {
      passed: true,
      firstReadyMs,
      secondExitMs,
      secondExitCode: secondExit.code,
      firstHostPreserved: true,
      firstExitMs: elapsed(startedAt),
      firstExitCode: firstExit.code,
      gracefulExitConfirmed: true,
      portReleaseMs,
    }
  } finally {
    if (!passed) {
      killIfRunning(second)
      killIfRunning(first)
    }
  }
}

async function testUnknownListener(dataDirectory) {
  await mkdir(dataDirectory, { recursive: true })
  await assertPortFree('unknown-listener test')
  let connections = 0
  const marker = 'codetether-lifecycle-smoke-unknown'
  const sockets = new Set()
  const server = createServer((socket) => {
    connections += 1
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    socket.end(
      `HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: ${String(Buffer.byteLength(marker))}\r\n\r\n${marker}`,
    )
  })
  await listen(server)

  const startedAt = performance.now()
  const desktop = spawnTracked(
    'Desktop against unknown listener',
    desktopExecutable,
    [],
    desktopEnvironment(dataDirectory),
  )
  let passed = false
  try {
    const desktopExit = await waitForExit(desktop, PROCESS_TIMEOUT_MS)
    ensureNonZeroExit(desktop, desktopExit)
    ensure(server.listening, 'Desktop stopped the unknown listener')
    const response = await requestRaw()
    ensure(response.includes(marker), 'Unknown listener stopped responding')
    passed = true
    return {
      passed: true,
      desktopExitMs: elapsed(startedAt),
      desktopExitCode: desktopExit.code,
      listenerSurvived: true,
      observedConnections: connections,
    }
  } finally {
    if (!passed) killIfRunning(desktop)
    await closeServer(server, sockets)
    await waitUntilNotListening(RELEASE_TIMEOUT_MS)
  }
}

async function testExternalHost(hostDataDirectory, desktopDataDirectory) {
  await Promise.all([
    mkdir(hostDataDirectory, { recursive: true }),
    mkdir(desktopDataDirectory, { recursive: true }),
  ])
  await assertPortFree('external-Host test')
  const startedAt = performance.now()
  const externalHost = spawnTracked(
    'external CodeTether Host',
    hostExecutable,
    ['--port', String(PORT), '--origin', 'http://tauri.localhost'],
    {
      ...process.env,
      CODETETHER_DATA_DIR: hostDataDirectory,
      CODETETHER_DESKTOP_MANAGED: '1',
    },
    'pipe',
  )
  let desktop
  let shutdownSent = false
  let passed = false

  try {
    await writeLifecycleLine(externalHost, 'start')
    const initialBootstrap = await waitForBootstrap(
      READY_TIMEOUT_MS,
      externalHost,
    )
    const hostReadyMs = elapsed(startedAt)

    const desktopStartedAt = performance.now()
    desktop = spawnTracked(
      'Desktop against external CodeTether Host',
      desktopExecutable,
      [],
      desktopEnvironment(desktopDataDirectory),
    )
    const desktopExit = await waitForExit(desktop, PROCESS_TIMEOUT_MS)
    ensureNonZeroExit(desktop, desktopExit)
    ensure(isRunning(externalHost), 'Desktop terminated the external Host')
    const survivingBootstrap = await readBootstrap()
    ensure(
      sameHost(initialBootstrap, survivingBootstrap),
      'External Host was not the same bootstrap service after Desktop exited',
    )

    const shutdownStartedAt = performance.now()
    await writeLifecycleLine(externalHost, 'shutdown')
    shutdownSent = true
    const hostExit = await waitForExit(externalHost, PROCESS_TIMEOUT_MS)
    ensureCleanExit(externalHost, hostExit)
    await waitUntilNotListening(RELEASE_TIMEOUT_MS)
    passed = true

    return {
      passed: true,
      hostReadyMs,
      desktopExitMs: elapsed(desktopStartedAt),
      desktopExitCode: desktopExit.code,
      externalHostSurvived: true,
      bootstrapProtocolVersion: survivingBootstrap.protocolVersion,
      bootstrapHostVersion: survivingBootstrap.hostVersion,
      shutdownExitCode: hostExit.code,
      shutdownMs: elapsed(shutdownStartedAt),
    }
  } finally {
    if (!passed) {
      killIfRunning(desktop)
      if (isRunning(externalHost) && !shutdownSent) {
        try {
          await writeLifecycleLine(externalHost, 'shutdown')
          shutdownSent = true
          await waitForExit(externalHost, PROCESS_TIMEOUT_MS)
        } catch {
          killIfRunning(externalHost)
        }
      } else {
        killIfRunning(externalHost)
      }
    }
  }
}

function desktopEnvironment(dataDirectory) {
  return {
    ...process.env,
    CODETETHER_DATA_DIR: dataDirectory,
    CODETETHER_DESKTOP_TEST_SUPPRESS_DIALOG: '1',
  }
}

function desktopEnvironmentWithoutSuppressedDialogs(dataDirectory) {
  const environment = {
    ...process.env,
    CODETETHER_DATA_DIR: dataDirectory,
  }
  for (const name of Object.keys(environment)) {
    if (name.toUpperCase() === 'CODETETHER_DESKTOP_TEST_SUPPRESS_DIALOG') {
      delete environment[name]
    }
  }
  return environment
}

function spawnTracked(label, executable, arguments_, env, stdin = 'ignore') {
  const child = spawn(executable, arguments_, {
    cwd: desktopDirectory,
    env,
    stdio: [stdin, 'pipe', 'pipe'],
    windowsHide: true,
  })
  let diagnostics = ''
  let standardOutput = ''
  const capture = (chunk) => {
    diagnostics += chunk.toString()
    if (Buffer.byteLength(diagnostics) > MAX_DIAGNOSTIC_BYTES) {
      diagnostics = diagnostics.slice(-MAX_DIAGNOSTIC_BYTES)
    }
  }
  child.stdout.on('data', (chunk) => {
    standardOutput += chunk.toString()
    capture(chunk)
  })
  child.stderr.on('data', capture)
  const exited = new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolveExit({ code, signal }))
  })
  const tracked = {
    child,
    diagnostics: () => diagnostics.trim(),
    exited,
    label,
    standardOutput: () => standardOutput.trim(),
  }
  trackedChildren.add(tracked)
  void exited.finally(() => trackedChildren.delete(tracked)).catch(() => {})
  return tracked
}

async function postWindowClose(desktopPid) {
  const helper = spawnTracked(
    'WM_CLOSE Win32 helper',
    powershellExecutable,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      windowsCloseScript(desktopPid),
    ],
    process.env,
  )
  const outcome = await waitForExit(helper, 15_000)
  ensureCleanExit(helper, outcome)
  const output = helper.standardOutput()
  ensure(output.length > 0, 'WM_CLOSE Win32 helper returned no result')
  try {
    const result = JSON.parse(output)
    ensure(
      result !== null &&
        typeof result === 'object' &&
        result.desktopPid === desktopPid &&
        result.title === WINDOW_TITLE &&
        typeof result.hwnd === 'string' &&
        result.hwnd.length > 0,
      'WM_CLOSE Win32 helper returned an invalid window identity',
    )
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Could not parse WM_CLOSE helper result: ${message}\n${output}`,
      { cause: error },
    )
  }
}

async function readDesktopProcessTree(desktopPid) {
  const helper = spawnTracked(
    'Desktop process tree helper',
    powershellExecutable,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      windowsProcessTreeScript(desktopPid),
    ],
    process.env,
  )
  const outcome = await waitForExit(helper, 15_000)
  ensureCleanExit(helper, outcome)
  const output = helper.standardOutput()
  ensure(output.length > 0, 'Desktop process tree helper returned no result')
  try {
    const result = JSON.parse(output)
    ensure(
      result !== null &&
        typeof result === 'object' &&
        result.desktopPid === desktopPid &&
        typeof result.desktopName === 'string' &&
        result.desktopName.toLowerCase() === 'codetether-desktop.exe' &&
        'descendants' in result,
      'Desktop process tree helper returned an invalid root identity',
    )
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Could not parse Desktop process tree helper result: ${message}\n${output}`,
      { cause: error },
    )
  }
}

function windowsProcessTreeScript(desktopPid) {
  return String.raw`
$ErrorActionPreference = 'Stop'
$expectedPid = [uint32]${String(desktopPid)}
$desktop = @(Get-CimInstance Win32_Process -Filter "ProcessId = ${String(desktopPid)}")
if ($desktop.Count -ne 1 -or $desktop[0].Name -ine 'codetether-desktop.exe') {
  throw 'Exact Desktop root process was not found'
}

$allProcesses = @(Get-CimInstance Win32_Process)
$knownProcessIds = New-Object 'System.Collections.Generic.HashSet[uint32]'
[void]$knownProcessIds.Add($expectedPid)
$descendants = New-Object 'System.Collections.Generic.List[object]'
do {
  $added = $false
  foreach ($candidate in $allProcesses) {
    $candidateId = [uint32]$candidate.ProcessId
    $candidateParentId = [uint32]$candidate.ParentProcessId
    if (!$knownProcessIds.Contains($candidateId) -and $knownProcessIds.Contains($candidateParentId)) {
      [void]$knownProcessIds.Add($candidateId)
      [void]$descendants.Add([pscustomobject]@{
        pid = [int]$candidateId
        parentPid = [int]$candidateParentId
        name = [string]$candidate.Name
      })
      $added = $true
    }
  }
} while ($added)

$result = @{
  desktopPid = [int]$expectedPid
  desktopName = [string]$desktop[0].Name
  descendants = @($descendants.ToArray())
}
$result | ConvertTo-Json -Compress -Depth 5
`
}

function windowsCloseScript(desktopPid) {
  return String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class CodeTetherWindowProbe
{
    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr state);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr state);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLengthW(IntPtr window);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextW(IntPtr window, StringBuilder text, int capacity);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostMessageW(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam);

    public static IntPtr Find(uint expectedProcessId, string expectedTitle)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr window, IntPtr state)
        {
            uint processId;
            GetWindowThreadProcessId(window, out processId);
            if (processId != expectedProcessId || !IsWindowVisible(window)) return true;
            if (String.Equals(ReadTitle(window), expectedTitle, StringComparison.Ordinal))
            {
                found = window;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static uint ReadProcessId(IntPtr window)
    {
        uint processId;
        GetWindowThreadProcessId(window, out processId);
        return processId;
    }

    public static string ReadTitle(IntPtr window)
    {
        int length = GetWindowTextLengthW(window);
        StringBuilder text = new StringBuilder(length + 1);
        GetWindowTextW(window, text, text.Capacity);
        return text.ToString();
    }

    public static bool PostClose(IntPtr window)
    {
        return PostMessageW(window, 0x0010, UIntPtr.Zero, IntPtr.Zero);
    }
}
'@

$expectedPid = [uint32]${String(desktopPid)}
$expectedTitle = '${WINDOW_TITLE}'
$deadline = [DateTime]::UtcNow.AddSeconds(5)
$window = [IntPtr]::Zero
do {
  $window = [CodeTetherWindowProbe]::Find($expectedPid, $expectedTitle)
  if ($window -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 50
} while ([DateTime]::UtcNow -lt $deadline)
if ($window -eq [IntPtr]::Zero) { throw 'Exact Desktop main window was not found' }

$windowPid = [CodeTetherWindowProbe]::ReadProcessId($window)
$windowTitle = [CodeTetherWindowProbe]::ReadTitle($window)
if ($windowPid -ne $expectedPid -or $windowTitle -cne $expectedTitle) {
  throw 'Desktop main window identity changed before WM_CLOSE'
}

$allProcesses = @(Get-CimInstance Win32_Process)
$knownProcessIds = New-Object 'System.Collections.Generic.HashSet[uint32]'
[void]$knownProcessIds.Add($expectedPid)
$descendants = New-Object 'System.Collections.Generic.List[object]'
do {
  $added = $false
  foreach ($candidate in $allProcesses) {
    $candidateId = [uint32]$candidate.ProcessId
    $candidateParentId = [uint32]$candidate.ParentProcessId
    if (!$knownProcessIds.Contains($candidateId) -and $knownProcessIds.Contains($candidateParentId)) {
      [void]$knownProcessIds.Add($candidateId)
      [void]$descendants.Add([pscustomobject]@{
        pid = [int]$candidateId
        parentPid = [int]$candidateParentId
        name = [string]$candidate.Name
      })
      $added = $true
    }
  }
} while ($added)

if (@($descendants | Where-Object { $_.name -ieq 'codetether-host.exe' }).Count -lt 1) {
  throw 'Owned codetether-host.exe was not found beneath the Desktop process'
}
if (![CodeTetherWindowProbe]::PostClose($window)) {
  throw 'PostMessageW(WM_CLOSE) failed'
}

$result = @{
  desktopPid = [int]$expectedPid
  hwnd = [string]$window.ToInt64()
  title = $windowTitle
  descendants = @($descendants.ToArray())
}
$result | ConvertTo-Json -Compress -Depth 5
`
}

async function waitForExit(tracked, timeoutMs) {
  let timeout
  try {
    return await Promise.race([
      tracked.exited,
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          reject(
            new Error(
              `${tracked.label} did not exit within ${String(timeoutMs)} ms${diagnosticSuffix(tracked)}`,
            ),
          )
        }, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

async function waitForBootstrap(timeoutMs, owner) {
  const deadline = performance.now() + timeoutMs
  let lastError
  while (performance.now() < deadline) {
    if (owner !== undefined && !isRunning(owner)) {
      throw new Error(
        `${owner.label} exited before readiness${diagnosticSuffix(owner)}`,
      )
    }
    try {
      return await readBootstrap()
    } catch (error) {
      lastError = error
    }
    await delay(75)
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : ''
  throw new Error(
    `Host bootstrap did not become ready within ${String(timeoutMs)} ms${detail}`,
  )
}

async function readBootstrap() {
  const response = await httpRequest('/api/v1/bootstrap')
  ensure(
    response.statusCode === 200,
    `Bootstrap returned HTTP ${String(response.statusCode)}`,
  )
  const value = JSON.parse(response.body)
  ensure(
    value !== null &&
      typeof value === 'object' &&
      value.protocolVersion === 1 &&
      typeof value.hostVersion === 'string' &&
      value.hostVersion.length > 0,
    'Bootstrap identity is invalid',
  )
  return value
}

async function requestRaw() {
  return (await httpRequest('/unknown-listener-survival')).body
}

async function httpRequest(path) {
  return await new Promise((resolveRequest, reject) => {
    const outgoing = request(
      { host: HOST, port: PORT, path, method: 'GET', timeout: 750 },
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

function sameHost(left, right) {
  return (
    left.protocolVersion === right.protocolVersion &&
    left.hostVersion === right.hostVersion &&
    left.epoch === right.epoch
  )
}

function ensureCleanExit(tracked, outcome) {
  ensure(
    outcome.code === 0 && outcome.signal === null,
    `${tracked.label} did not exit cleanly (${formatOutcome(outcome)})${diagnosticSuffix(tracked)}`,
  )
}

function ensureNonZeroExit(tracked, outcome) {
  ensure(
    typeof outcome.code === 'number' &&
      outcome.code !== 0 &&
      outcome.signal === null,
    `${tracked.label} did not exit with a non-zero code (${formatOutcome(outcome)})${diagnosticSuffix(tracked)}`,
  )
}

async function writeLifecycleLine(tracked, line) {
  const input = tracked.child.stdin
  ensure(input !== null, `${tracked.label} has no managed stdin`)
  await new Promise((resolveWrite, reject) => {
    input.write(`${line}\n`, (error) => {
      if (error) reject(error)
      else resolveWrite()
    })
  })
}

async function assertPortFree(stage) {
  ensure(!(await isListening()), `Port ${String(PORT)} is occupied at ${stage}`)
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

async function waitUntilNotListening(timeoutMs) {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    if (!(await isListening())) return
    await delay(75)
  }
  throw new Error(`Port ${String(PORT)} remained occupied after cleanup`)
}

async function waitUntilProcessesExit(processIds, timeoutMs) {
  const uniqueProcessIds = [...new Set(processIds)]
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    const liveProcessIds = uniqueProcessIds.filter(isProcessAlive)
    if (liveProcessIds.length === 0) return
    await delay(75)
  }
  const liveProcessIds = uniqueProcessIds.filter(isProcessAlive)
  throw new Error(
    `Owned Desktop process tree still runs after lifecycle action: ${liveProcessIds.join(', ')}`,
  )
}

function isProcessAlive(processId) {
  try {
    process.kill(processId, 0)
    return true
  } catch (error) {
    return !(
      error instanceof Error &&
      'code' in error &&
      error.code === 'ESRCH'
    )
  }
}

async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(PORT, HOST, () => {
      server.off('error', reject)
      resolveListen()
    })
  })
}

async function closeServer(server, sockets) {
  if (!server.listening) {
    for (const socket of sockets) socket.destroy()
    return
  }
  let timeout
  try {
    await Promise.race([
      new Promise((resolveClose, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolveClose()
        })
        for (const socket of sockets) socket.destroy()
      }),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Unknown test listener did not close')),
          2_000,
        )
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

function isRunning(tracked) {
  return (
    tracked !== undefined &&
    tracked.child.exitCode === null &&
    tracked.child.signalCode === null
  )
}

function killIfRunning(tracked) {
  if (isRunning(tracked)) tracked.child.kill()
}

async function killTrackedChildren() {
  for (const tracked of trackedChildren) killIfRunning(tracked)
  await Promise.allSettled(
    [...trackedChildren].map((tracked) => waitForExit(tracked, 2_000)),
  )
}

function diagnosticSuffix(tracked) {
  const diagnostics = tracked.diagnostics()
  return diagnostics.length > 0 ? `\n${diagnostics}` : ''
}

function formatOutcome(outcome) {
  return `code=${String(outcome.code)}, signal=${String(outcome.signal)}`
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

async function removeOwnedTemporaryDirectory(directory) {
  const resolved = resolve(directory)
  ensure(
    dirname(resolved) === resolve(tmpdir()) &&
      basename(resolved).startsWith('codetether-lifecycle-smoke-'),
    `Refusing to remove unexpected lifecycle directory: ${resolved}`,
  )
  await rm(resolved, { recursive: true, force: true })
}
