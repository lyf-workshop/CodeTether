import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const HOST_URL = 'http://127.0.0.1:4317'
const READY_TIMEOUT_MS = 15_000
const PROCESS_EXIT_TIMEOUT_MS = 120_000
const DEFAULT_SOAK_MINUTES = 30
const DEFAULT_SAMPLE_INTERVAL_MS = 60_000
const MAX_DIAGNOSTIC_BYTES = 128 * 1024

const desktopDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(desktopDirectory, '..', '..')
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

const soakMinutes = boundedNumber(
  process.env.CODETETHER_PHASE4G2_SOAK_MINUTES,
  DEFAULT_SOAK_MINUTES,
  0.05,
  60,
  'CODETETHER_PHASE4G2_SOAK_MINUTES',
)
const sampleIntervalMs = boundedNumber(
  process.env.CODETETHER_PHASE4G2_SOAK_SAMPLE_MS,
  DEFAULT_SAMPLE_INTERVAL_MS,
  1_000,
  300_000,
  'CODETETHER_PHASE4G2_SOAK_SAMPLE_MS',
)
const realTurnCount = Math.trunc(
  boundedNumber(
    process.env.CODETETHER_PHASE4G2_SOAK_REAL_TURNS,
    1,
    0,
    3,
    'CODETETHER_PHASE4G2_SOAK_REAL_TURNS',
  ),
)
const soakDurationMs = Math.round(soakMinutes * 60_000)
const automaticQuitGraceMs = boundedNumber(
  process.env.CODETETHER_PHASE4G2_SOAK_QUIT_GRACE_MS,
  30_000,
  5_000,
  300_000,
  'CODETETHER_PHASE4G2_SOAK_QUIT_GRACE_MS',
)
// The Node and Rust monotonic clocks can account for Modern Standby gaps a
// few seconds differently. Schedule the Desktop's explicit test quit inside
// (not at the far edge of) the harness wait budget so a real Sleep/Wake cycle
// cannot turn a healthy soak into a timeout race.
const automaticQuitLeadMs = Math.max(
  30_000,
  Math.min(90_000, Math.floor(automaticQuitGraceMs / 2)),
)
const automaticQuitDelayMs = Math.min(
  3_900_000,
  soakDurationMs + automaticQuitLeadMs,
)
const evidenceDirectory = resolve(
  process.env.CODETETHER_PHASE4G2_EVIDENCE_DIR?.trim() ||
    join(repositoryRoot, 'output', 'playwright', 'phase4g2'),
)

await Promise.all([stat(desktopExecutable), stat(hostExecutable)])
if (await isListening()) {
  throw new Error('Background soak requires port 4317 to be free')
}

const dataDirectory = await mkdtemp(
  join(tmpdir(), 'codetether-background-soak-'),
)
const workspace = join(dataDirectory, 'workspace')
await mkdir(workspace, { recursive: true })

const report = {
  ok: false,
  observation: 'REAL_PROCESS_SOAK',
  durationRequestedMs: soakDurationMs,
  sampleIntervalMs,
  realTurnCountRequested: realTurnCount,
  automaticQuitDelayMs,
  automaticQuitWaitBudgetMs: PROCESS_EXIT_TIMEOUT_MS,
  executable: desktopExecutable,
  hostExecutable,
  dataDirectory,
  workspace,
  samples: [],
  turns: [],
}
const child = spawn(
  desktopExecutable,
  [`--desktop-smoke-exit-after-ready-ms=${String(automaticQuitDelayMs)}`],
  {
    cwd: desktopDirectory,
    env: {
      ...process.env,
      CODETETHER_DATA_DIR: dataDirectory,
      CODETETHER_DESKTOP_TEST_SUPPRESS_DIALOG: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  },
)

let diagnostics = ''
const appendDiagnostics = (chunk) => {
  diagnostics = `${diagnostics}${chunk.toString()}`.slice(-MAX_DIAGNOSTIC_BYTES)
}
child.stdout.on('data', appendDiagnostics)
child.stderr.on('data', appendDiagnostics)

let succeeded = false
try {
  const bootstrap = await waitForBootstrap(READY_TIMEOUT_MS)
  report.desktopPid = child.pid
  report.bootstrap = bootstrap
  await hideMainWindow(child.pid)

  const soakStartedAt = performance.now()
  let nextSampleAt = soakStartedAt
  let nextTurn = 0
  while (performance.now() - soakStartedAt < soakDurationMs) {
    const elapsedMs = Math.round(performance.now() - soakStartedAt)
    if (
      nextTurn < realTurnCount &&
      elapsedMs >= turnThreshold(nextTurn, realTurnCount, soakDurationMs)
    ) {
      report.turns.push(
        await runRealBackgroundTurn(workspace, nextTurn + 1, bootstrap.epoch),
      )
      nextTurn += 1
    }

    if (performance.now() >= nextSampleAt) {
      const sample = await readProcessHealth(child.pid)
      validateProcessHealth(sample, bootstrap)
      report.samples.push({ elapsedMs, ...sample })
      nextSampleAt += sampleIntervalMs
    }

    const remainingMs = soakDurationMs - (performance.now() - soakStartedAt)
    if (remainingMs <= 0) break
    const waitMs = Math.max(
      50,
      Math.min(
        1_000,
        remainingMs,
        Math.max(50, nextSampleAt - performance.now()),
      ),
    )
    await delay(waitMs)
  }

  const finalSample = await readProcessHealth(child.pid)
  validateProcessHealth(finalSample, bootstrap)
  report.samples.push({
    elapsedMs: Math.round(performance.now() - soakStartedAt),
    ...finalSample,
  })
  report.durationObservedMs = Math.round(performance.now() - soakStartedAt)
  report.attention = await api('/api/v1/attention?status=open&limit=100')
  report.summary = summarizeSamples(report.samples)

  const exit = await waitForExit(child, PROCESS_EXIT_TIMEOUT_MS)
  report.exit = exit
  if (exit.code !== 0) {
    throw new Error(
      `Desktop soak exited with code ${String(exit.code)} signal ${String(exit.signal)}`,
    )
  }
  await waitUntilNotListening(15_000)
  report.sqliteIntegrity = sqliteIntegrity(
    join(dataDirectory, 'codetether.sqlite3'),
  )
  if (report.sqliteIntegrity !== 'ok') {
    throw new Error(
      `SQLite integrity check failed: ${String(report.sqliteIntegrity)}`,
    )
  }
  report.ok = true
  succeeded = true
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error)
  report.diagnostics = diagnostics
  if (child.exitCode === null && child.signalCode === null) child.kill()
  await Promise.race([waitForExit(child, 5_000), delay(5_000)])
  process.exitCode = 1
} finally {
  if (succeeded) {
    await removeOwnedTemporaryDirectory(dataDirectory)
    report.dataDirectoryCleaned = true
  }
  await mkdir(evidenceDirectory, { recursive: true })
  report.evidenceWrittenAt = new Date().toISOString()
  await writeFile(
    join(evidenceDirectory, 'phase4g2-soak-results.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  )
}

process.stdout.write(`${JSON.stringify(report)}\n`)

async function runRealBackgroundTurn(rootPath, sequence, expectedEpoch) {
  const marker = `PHASE4G2_SOAK_OK_${String(sequence)}`
  const machines = await api('/api/v1/machines')
  const machine = machines.machines?.[0]
  if (
    machines.machines?.length !== 1 ||
    typeof machine?.machineId !== 'string'
  ) {
    throw new Error('Background soak requires exactly one local Machine')
  }
  const project = await api('/api/v1/projects', {
    method: 'POST',
    body: {
      actionId: actionId(`project-${String(sequence)}`),
      name: `Phase 4G.2 Soak ${String(sequence)}`,
      path: rootPath,
    },
  })
  const conversation = await api('/api/v1/conversations', {
    method: 'POST',
    body: {
      actionId: actionId(`conversation-${String(sequence)}`),
      provider: 'codex',
      projectId: project.data.project.projectId,
      machineId: machine.machineId,
    },
  })
  const conversationId = conversation.data.conversation.conversationId
  const startedAt = performance.now()
  const turn = await api(`/api/v1/conversations/${conversationId}/turns`, {
    method: 'POST',
    body: {
      actionId: actionId(`turn-${String(sequence)}`),
      input: {
        type: 'text',
        text: [
          'This is an isolated CodeTether background-runtime soak probe.',
          'Do not use tools, read files, modify files, or access the network.',
          `Reply with exactly ${marker} and no additional text.`,
        ].join(' '),
      },
    },
  })
  const terminal = await waitForTerminalConversation(conversationId, 180_000)
  const bootstrap = await api('/api/v1/bootstrap')
  if (bootstrap.epoch !== expectedEpoch) {
    throw new Error('Real background Turn changed the owned Host epoch')
  }
  return {
    sequence,
    marker,
    projectId: project.data.project.projectId,
    machineId: machine.machineId,
    conversationId,
    turnId: turn.data.turn.turnId,
    status: terminal.conversation.status,
    elapsedMs: Math.round(performance.now() - startedAt),
    finalMessageContainsMarker: terminal.runtime.messages.some(
      (message) =>
        message.turnId === turn.data.turn.turnId &&
        message.text.includes(marker),
    ),
  }
}

async function waitForTerminalConversation(conversationId, timeoutMs) {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    const detail = await api(`/api/v1/conversations/${conversationId}`)
    if (['completed', 'failed', 'idle'].includes(detail.conversation.status)) {
      return detail
    }
    await delay(500)
  }
  throw new Error(`Real background Turn did not settle: ${conversationId}`)
}

async function waitForBootstrap(timeoutMs) {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    try {
      const bootstrap = await api('/api/v1/bootstrap')
      if (
        bootstrap.protocolVersion === 1 &&
        typeof bootstrap.epoch === 'string'
      ) {
        return bootstrap
      }
    } catch {
      // Startup readiness is bounded by the outer monotonic deadline.
    }
    await delay(100)
  }
  throw new Error('Desktop managed Host did not become ready')
}

async function api(path, options = {}) {
  const response = await fetch(`${HOST_URL}${path}`, {
    method: options.method ?? 'GET',
    headers:
      options.body === undefined
        ? undefined
        : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(10_000),
  })
  const body = await response.json()
  if (!response.ok) {
    throw new Error(
      `Host request ${path} failed with ${String(response.status)}: ${JSON.stringify(body)}`,
    )
  }
  return body
}

async function hideMainWindow(desktopPid) {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class CodeTetherSoakWindow {
  private delegate bool EnumWindowsCallback(IntPtr window, IntPtr state);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr state);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextLengthW(IntPtr window);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextW(IntPtr window, StringBuilder text, int capacity);
  [DllImport("user32.dll", SetLastError = true)] private static extern bool PostMessageW(IntPtr window, uint message, UIntPtr wparam, IntPtr lparam);
  private static string Title(IntPtr window) {
    int length = GetWindowTextLengthW(window);
    StringBuilder text = new StringBuilder(length + 1);
    GetWindowTextW(window, text, text.Capacity);
    return text.ToString();
  }
  public static bool Close(uint expectedProcessId) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr window, IntPtr state) {
      uint processId;
      GetWindowThreadProcessId(window, out processId);
      if (processId == expectedProcessId && String.Equals(Title(window), "CodeTether", StringComparison.Ordinal)) {
        found = window;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return found != IntPtr.Zero && PostMessageW(found, 0x0010, UIntPtr.Zero, IntPtr.Zero);
  }
}
'@
if (![CodeTetherSoakWindow]::Close([uint32]${String(desktopPid)})) { throw 'Could not hide exact Desktop window' }
`
  await runPowerShell(script)
  await delay(750)
}

async function readProcessHealth(desktopPid) {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$desktopPid = [uint32]${String(desktopPid)}
$all = @(Get-CimInstance Win32_Process)
$desktop = @($all | Where-Object { $_.ProcessId -eq $desktopPid -and $_.Name -ieq 'codetether-desktop.exe' })
if ($desktop.Count -ne 1) { throw 'Exact Desktop process is unavailable' }
$known = New-Object 'System.Collections.Generic.HashSet[uint32]'
[void]$known.Add($desktopPid)
$descendants = New-Object 'System.Collections.Generic.List[object]'
do {
  $added = $false
  foreach ($candidate in $all) {
    $candidateId = [uint32]$candidate.ProcessId
    $parentId = [uint32]$candidate.ParentProcessId
    if (!$known.Contains($candidateId) -and $known.Contains($parentId)) {
      [void]$known.Add($candidateId)
      [void]$descendants.Add($candidate)
      $added = $true
    }
  }
} while ($added)
function Metric([object]$process) {
  $live = Get-Process -Id ([int]$process.ProcessId) -ErrorAction Stop
  return [ordered]@{
    pid = [int]$process.ProcessId
    parentPid = [int]$process.ParentProcessId
    name = [string]$process.Name
    workingSetBytes = [int64]$live.WorkingSet64
    privateBytes = [int64]$live.PrivateMemorySize64
    handles = [int]$live.HandleCount
    threads = [int]$live.Threads.Count
  }
}
$hostProcesses = @($descendants | Where-Object { $_.Name -ieq 'codetether-host.exe' })
$codex = @($descendants | Where-Object { $_.Name -match '^codex(?:\.exe)?$' })
$webview = @($descendants | Where-Object { $_.Name -ieq 'msedgewebview2.exe' })
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort 4317 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
[ordered]@{
  observedAt = [DateTime]::UtcNow.ToString('o')
  desktop = @(Metric $desktop[0])
  host = @($hostProcesses | ForEach-Object { Metric $_ })
  codex = @($codex | ForEach-Object { Metric $_ })
  webview = @($webview | ForEach-Object { Metric $_ })
  listenerPids = @($listeners | ForEach-Object { [int]$_ })
} | ConvertTo-Json -Compress -Depth 6
`
  const output = await runPowerShell(script)
  return JSON.parse(output)
}

function validateProcessHealth(sample, bootstrap) {
  if (!Array.isArray(sample.desktop) || sample.desktop.length !== 1) {
    throw new Error('Background soak lost the exact Desktop process')
  }
  if (!Array.isArray(sample.host) || sample.host.length !== 1) {
    throw new Error('Background soak requires exactly one owned Host')
  }
  const hostPid = sample.host[0].pid
  if (
    !Array.isArray(sample.listenerPids) ||
    sample.listenerPids.length !== 1 ||
    sample.listenerPids[0] !== hostPid
  ) {
    throw new Error('Port 4317 listener is not the exact owned Host process')
  }
  if (typeof bootstrap.epoch !== 'string' || bootstrap.epoch.length === 0) {
    throw new Error('Background soak bootstrap identity is invalid')
  }
}

function summarizeSamples(samples) {
  const roles = ['desktop', 'host', 'codex', 'webview']
  return Object.fromEntries(
    roles.map((role) => {
      const rows = samples.map((sample) => aggregate(sample[role]))
      const middle = rows[Math.floor((rows.length - 1) / 2)]
      return [
        role,
        {
          first: rows[0],
          middle,
          last: rows.at(-1),
          peak: {
            workingSetBytes: Math.max(
              ...rows.map((row) => row.workingSetBytes),
            ),
            privateBytes: Math.max(...rows.map((row) => row.privateBytes)),
            handles: Math.max(...rows.map((row) => row.handles)),
            threads: Math.max(...rows.map((row) => row.threads)),
            processes: Math.max(...rows.map((row) => row.processes)),
          },
        },
      ]
    }),
  )
}

function aggregate(processes) {
  const rows = Array.isArray(processes) ? processes : []
  return rows.reduce(
    (total, process) => ({
      workingSetBytes: total.workingSetBytes + process.workingSetBytes,
      privateBytes: total.privateBytes + process.privateBytes,
      handles: total.handles + process.handles,
      threads: total.threads + process.threads,
      processes: total.processes + 1,
    }),
    {
      workingSetBytes: 0,
      privateBytes: 0,
      handles: 0,
      threads: 0,
      processes: 0,
    },
  )
}

async function runPowerShell(script) {
  const child = spawn(
    powershellExecutable,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let output = ''
  let errorOutput = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    errorOutput += chunk.toString()
  })
  const outcome = await waitForExit(child, 30_000)
  if (outcome.code !== 0) {
    throw new Error(
      `PowerShell helper failed (${String(outcome.code)}): ${errorOutput}`,
    )
  }
  return output.trim()
}

async function waitForExit(process, timeoutMs) {
  if (process.exitCode !== null || process.signalCode !== null) {
    return { code: process.exitCode, signal: process.signalCode }
  }
  return await new Promise((resolveExit, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Process ${String(process.pid)} did not exit in time`))
    }, timeoutMs)
    process.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    process.once('exit', (code, signal) => {
      clearTimeout(timeout)
      resolveExit({ code, signal })
    })
  })
}

function sqliteIntegrity(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true })
  try {
    return database.prepare('PRAGMA integrity_check').get()?.integrity_check
  } finally {
    database.close()
  }
}

function actionId(label) {
  return `act_${label}-${randomUUID()}`
}

function turnThreshold(index, count, durationMs) {
  if (count <= 1) return 0
  return Math.floor((durationMs * index) / count)
}

function boundedNumber(raw, fallback, minimum, maximum, name) {
  const value = raw === undefined ? fallback : Number(raw)
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`)
  }
  return value
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

async function isListening() {
  return await new Promise((resolveListening) => {
    const socket = createConnection({ host: '127.0.0.1', port: 4317 })
    socket.setTimeout(300)
    const resolveClosed = () => {
      socket.destroy()
      resolveListening(false)
    }
    socket.once('connect', () => {
      socket.destroy()
      resolveListening(true)
    })
    socket.once('timeout', resolveClosed)
    socket.once('error', resolveClosed)
  })
}

async function waitUntilNotListening(timeoutMs) {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    if (!(await isListening())) return
    await delay(100)
  }
  throw new Error('Owned Host still listens on port 4317 after soak exit')
}

async function removeOwnedTemporaryDirectory(directory) {
  const resolved = resolve(directory)
  if (
    dirname(resolved) !== resolve(tmpdir()) ||
    !basename(resolved).startsWith('codetether-background-soak-')
  ) {
    throw new Error(`Refusing to remove unexpected soak directory: ${resolved}`)
  }
  await rm(resolved, { recursive: true, force: true })
}
