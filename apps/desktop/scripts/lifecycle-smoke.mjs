import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const HOST = '127.0.0.1'
const PORT = 4317
const PROCESS_TIMEOUT_MS = 25_000
const SECOND_INSTANCE_TIMEOUT_MS = 5_000
const READY_TIMEOUT_MS = 15_000
const RELEASE_TIMEOUT_MS = 12_000
const WINDOW_CLOSE_TIMEOUT_MS = 15_000
const WINDOW_STATE_TIMEOUT_MS = 8_000
const SMOKE_EXPLICIT_QUIT_DELAY_MS = 20_000
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
  report.results.altF4 = await testAltF4(join(dataRoot, 'alt-f4'))
  report.results.windowsLifecycleRecovery = await testWindowsLifecycleRecovery(
    join(dataRoot, 'windows-lifecycle-recovery'),
  )
  report.results.sessionEnd = await testSessionEnd(
    join(dataRoot, 'session-end'),
  )
  report.results.crashRecovery = await testCrashRecovery(
    join(dataRoot, 'crash-recovery'),
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

await writePhase4g2Evidence(report)
process.stdout.write(`${JSON.stringify(report)}\n`)

async function testWindowClose(dataDirectory) {
  await mkdir(dataDirectory, { recursive: true })
  await assertPortFree('WM_CLOSE test')
  const startedAt = performance.now()
  const desktop = spawnTracked(
    'Desktop WM_CLOSE instance',
    desktopExecutable,
    [
      `--desktop-smoke-exit-after-ready-ms=${String(SMOKE_EXPLICIT_QUIT_DELAY_MS)}`,
    ],
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

    const initialWindow = await waitForExactWindowVisibility(
      desktopPid,
      true,
      WINDOW_STATE_TIMEOUT_MS,
      undefined,
      desktop,
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

    ensure(
      closeResult.hwnd === initialWindow.hwnd,
      'WM_CLOSE targeted a different Desktop window',
    )
    const hiddenWindow = await waitForExactWindowVisibility(
      desktopPid,
      false,
      WINDOW_STATE_TIMEOUT_MS,
      closeResult.hwnd,
      desktop,
    )
    const hideMs = elapsed(closeStartedAt)
    ensure(
      isRunning(desktop),
      'WM_CLOSE exited the Desktop instead of hiding it',
    )
    const hiddenBootstrap = await readBootstrap()
    ensure(
      sameHost(bootstrap, hiddenBootstrap),
      'WM_CLOSE replaced the owned Host or changed its epoch',
    )
    const hiddenTree = await readDesktopProcessTree(desktopPid)
    const hiddenDescendants = Array.isArray(hiddenTree.descendants)
      ? hiddenTree.descendants
      : [hiddenTree.descendants]
    const initialHost = descendants.find(isHostProcess)
    const hiddenHost = hiddenDescendants.find(isHostProcess)
    ensure(
      initialHost !== undefined &&
        hiddenHost !== undefined &&
        initialHost.pid === hiddenHost.pid,
      'WM_CLOSE did not preserve the exact owned Host process',
    )

    const scheduledQuitWaitStartedAt = performance.now()
    const desktopExit = await waitForExit(desktop, PROCESS_TIMEOUT_MS)
    ensureCleanExit(desktop, desktopExit)
    ensure(
      !/shutdown timed out|did not confirm a clean shutdown/u.test(
        desktop.diagnostics(),
      ),
      `Explicit smoke quit did not complete graceful Host shutdown${diagnosticSuffix(desktop)}`,
    )
    const hiddenUntilScheduledQuitMs = elapsed(scheduledQuitWaitStartedAt)
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
      windowHidden: hiddenWindow.visible === false,
      hideMs,
      hostPidPreserved: hiddenHost.pid,
      hostEpochPreserved: hiddenBootstrap.epoch,
      descendantProcesses: descendants,
      hiddenUntilScheduledQuitMs,
      desktopExitCode: desktopExit.code,
      explicitQuitConfirmed: true,
      portReleased: true,
      processTreeReleased: true,
      releaseMs,
    }
  } finally {
    if (!passed) killIfRunning(desktop)
  }
}

async function testAltF4(dataDirectory) {
  await mkdir(dataDirectory, { recursive: true })
  await assertPortFree('Alt+F4 test')
  const startedAt = performance.now()
  const desktop = spawnTracked(
    'Desktop Alt+F4 instance',
    desktopExecutable,
    [
      `--desktop-smoke-exit-after-ready-ms=${String(SMOKE_EXPLICIT_QUIT_DELAY_MS)}`,
    ],
    desktopEnvironment(dataDirectory),
  )
  let passed = false

  try {
    const bootstrap = await waitForBootstrap(READY_TIMEOUT_MS, desktop)
    const readyMs = elapsed(startedAt)
    const desktopPid = desktop.child.pid
    ensure(
      Number.isSafeInteger(desktopPid) && desktopPid > 0,
      'Desktop Alt+F4 instance has no process ID',
    )
    const initialWindow = await waitForExactWindowVisibility(
      desktopPid,
      true,
      WINDOW_STATE_TIMEOUT_MS,
      undefined,
      desktop,
    )
    const initialTree = await readDesktopProcessTree(desktopPid)
    const initialDescendants = Array.isArray(initialTree.descendants)
      ? initialTree.descendants
      : [initialTree.descendants]
    const initialHost = initialDescendants.find(isHostProcess)
    ensure(initialHost !== undefined, 'Alt+F4 Desktop does not own a Host')
    const ownedProcessIds = [
      desktopPid,
      ...initialDescendants.map((process_) => process_.pid),
    ]

    const hideStartedAt = performance.now()
    const altF4Result = await sendAltF4(desktopPid)
    ensure(
      altF4Result.hwnd === initialWindow.hwnd,
      'Alt+F4 targeted a different Desktop window',
    )
    const hiddenWindow = await waitForExactWindowVisibility(
      desktopPid,
      false,
      WINDOW_STATE_TIMEOUT_MS,
      initialWindow.hwnd,
      desktop,
    )
    const hideMs = elapsed(hideStartedAt)
    ensure(isRunning(desktop), 'Alt+F4 exited the Desktop instead of hiding it')
    const hiddenBootstrap = await readBootstrap()
    ensure(
      sameHost(bootstrap, hiddenBootstrap),
      'Alt+F4 replaced the owned Host or changed its epoch',
    )
    const hiddenTree = await readDesktopProcessTree(desktopPid)
    const hiddenDescendants = Array.isArray(hiddenTree.descendants)
      ? hiddenTree.descendants
      : [hiddenTree.descendants]
    const hiddenHost = hiddenDescendants.find(isHostProcess)
    ensure(
      hiddenHost !== undefined && hiddenHost.pid === initialHost.pid,
      'Alt+F4 did not preserve the exact owned Host process',
    )

    const scheduledQuitWaitStartedAt = performance.now()
    const desktopExit = await waitForExit(desktop, PROCESS_TIMEOUT_MS)
    ensureCleanExit(desktop, desktopExit)
    ensure(
      !/shutdown timed out|did not confirm a clean shutdown/u.test(
        desktop.diagnostics(),
      ),
      `Alt+F4 explicit smoke quit did not complete graceful Host shutdown${diagnosticSuffix(desktop)}`,
    )
    const hiddenUntilScheduledQuitMs = elapsed(scheduledQuitWaitStartedAt)
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
      hwnd: altF4Result.hwnd,
      title: altF4Result.title,
      systemKeyTargeted: altF4Result.systemKeyTargeted,
      windowHidden: hiddenWindow.visible === false,
      hideMs,
      hostPidPreserved: hiddenHost.pid,
      hostEpochPreserved: hiddenBootstrap.epoch,
      hiddenUntilScheduledQuitMs,
      desktopExitCode: desktopExit.code,
      explicitQuitConfirmed: true,
      portReleased: true,
      processTreeReleased: true,
      releaseMs,
    }
  } finally {
    if (!passed) killIfRunning(desktop)
  }
}

async function testWindowsLifecycleRecovery(dataDirectory) {
  await mkdir(dataDirectory, { recursive: true })
  await assertPortFree('Windows lifecycle recovery test')
  const desktop = spawnTracked(
    'Desktop Windows lifecycle recovery instance',
    desktopExecutable,
    [
      `--desktop-smoke-exit-after-ready-ms=${String(SMOKE_EXPLICIT_QUIT_DELAY_MS)}`,
    ],
    desktopEnvironment(dataDirectory),
  )
  let passed = false

  try {
    const bootstrap = await waitForBootstrap(READY_TIMEOUT_MS, desktop)
    const desktopPid = desktop.child.pid
    ensure(
      Number.isSafeInteger(desktopPid) && desktopPid > 0,
      'Windows lifecycle recovery Desktop has no process ID',
    )
    const initialWindow = await waitForExactWindowVisibility(
      desktopPid,
      true,
      WINDOW_STATE_TIMEOUT_MS,
      undefined,
      desktop,
    )
    const initialTree = await readDesktopProcessTree(desktopPid)
    const initialDescendants = Array.isArray(initialTree.descendants)
      ? initialTree.descendants
      : [initialTree.descendants]
    const initialHost = initialDescendants.find(isHostProcess)
    ensure(initialHost !== undefined, 'Lifecycle recovery Desktop owns no Host')
    const ownedProcessIds = [
      desktopPid,
      ...initialDescendants.map((process_) => process_.pid),
    ]

    const messages = await sendWindowsLifecycleMessages(desktopPid, 'recovery')
    ensure(messages.queryResult === 1, 'WM_QUERYENDSESSION was not allowed')
    ensure(
      messages.queryNativeMs < 500,
      `WM_QUERYENDSESSION was not prompt (${String(messages.queryNativeMs)} ms)`,
    )
    await waitForLifecycleEventCount(desktop, 'system_resumed', 5, 8_000)
    await waitForLifecycleEventCount(
      desktop,
      'system_resume_duplicate',
      5,
      8_000,
    )
    await waitForLifecycleEventCount(desktop, 'session_unlocked', 5, 8_000)

    const recoveredBootstrap = await readBootstrap()
    ensure(
      sameHost(bootstrap, recoveredBootstrap),
      'Power/session messages replaced the exact owned Host identity',
    )
    const recoveredTree = await readDesktopProcessTree(desktopPid)
    const recoveredDescendants = Array.isArray(recoveredTree.descendants)
      ? recoveredTree.descendants
      : [recoveredTree.descendants]
    const recoveredHost = recoveredDescendants.find(isHostProcess)
    ensure(
      recoveredHost?.pid === initialHost.pid,
      'Power/session messages changed the owned Host PID',
    )
    const recoveredWindow = await readExactWindowState(
      desktopPid,
      initialWindow.hwnd,
    )
    ensure(
      recoveredWindow.visible && !recoveredWindow.minimized,
      'Synthetic recovery changed the visible Window state',
    )

    await postWindowClose(desktopPid)
    await waitForExactWindowVisibility(
      desktopPid,
      false,
      WINDOW_STATE_TIMEOUT_MS,
      initialWindow.hwnd,
      desktop,
    )
    const hiddenBootstrap = await readBootstrap()
    ensure(
      sameHost(bootstrap, hiddenBootstrap),
      'Cancelled session end prevented normal hide or changed Host identity',
    )

    const desktopExit = await waitForExit(desktop, PROCESS_TIMEOUT_MS)
    ensureCleanExit(desktop, desktopExit)
    await Promise.all([
      waitUntilNotListening(RELEASE_TIMEOUT_MS),
      waitUntilProcessesExit(ownedProcessIds, RELEASE_TIMEOUT_MS),
    ])
    const events = parseLifecycleEvents(desktop)
    passed = true
    return {
      passed: true,
      evidence: 'SIMULATED',
      desktopPid,
      hostPidPreserved: recoveredHost.pid,
      hostEpochPreserved: recoveredBootstrap.epoch,
      queryNativeMs: messages.queryNativeMs,
      suspendCycles: messages.suspendCycles,
      lockCycles: messages.lockCycles,
      resumedEvents: countLifecycleEvents(events, 'system_resumed'),
      duplicateResumeEvents: countLifecycleEvents(
        events,
        'system_resume_duplicate',
      ),
      lockEvents: countLifecycleEvents(events, 'session_locked'),
      unlockEvents: countLifecycleEvents(events, 'session_unlocked'),
      cancelledSessionEnd: countLifecycleEvents(
        events,
        'session_end_cancelled',
      ),
      windowHiddenAfterCancel: true,
      processTreeReleased: true,
      portReleased: true,
      lifecycleEvents: events,
    }
  } finally {
    if (!passed) killIfRunning(desktop)
  }
}

async function testSessionEnd(dataDirectory) {
  await mkdir(dataDirectory, { recursive: true })
  await assertPortFree('session-end test')
  const desktop = spawnTracked(
    'Desktop simulated session-end instance',
    desktopExecutable,
    [],
    desktopEnvironment(dataDirectory),
  )
  let passed = false

  try {
    await waitForBootstrap(READY_TIMEOUT_MS, desktop)
    const desktopPid = desktop.child.pid
    ensure(
      Number.isSafeInteger(desktopPid) && desktopPid > 0,
      'Session-end Desktop has no process ID',
    )
    await waitForExactWindowVisibility(
      desktopPid,
      true,
      WINDOW_STATE_TIMEOUT_MS,
      undefined,
      desktop,
    )
    const initialTree = await readDesktopProcessTree(desktopPid)
    const descendants = Array.isArray(initialTree.descendants)
      ? initialTree.descendants
      : [initialTree.descendants]
    const ownedProcessIds = [
      desktopPid,
      ...descendants.map((process_) => process_.pid),
    ]

    const messages = await sendWindowsLifecycleMessages(desktopPid, 'end')
    ensure(messages.queryResult === 1, 'Session-end query was not allowed')
    ensure(
      messages.queryNativeMs < 500,
      `Session-end query was not prompt (${String(messages.queryNativeMs)} ms)`,
    )
    const desktopExit = await waitForExit(desktop, 8_000)
    ensureCleanExit(desktop, desktopExit)
    await Promise.all([
      waitUntilNotListening(RELEASE_TIMEOUT_MS),
      waitUntilProcessesExit(ownedProcessIds, RELEASE_TIMEOUT_MS),
    ])
    const events = parseLifecycleEvents(desktop)
    const completed = events.find(
      (event) => event.event === 'session_end_shutdown_finished',
    )
    ensure(
      completed !== undefined,
      'Session-end drain emitted no completion record',
    )
    passed = true
    return {
      passed: true,
      evidence: 'SIMULATED',
      desktopPid,
      queryNativeMs: messages.queryNativeMs,
      endMessageNativeMs: messages.endNativeMs,
      shutdownBudgetMs: completed.details?.budgetMs,
      shutdownNativeMs: completed.details?.elapsedMs,
      shutdownOutcome: completed.details?.outcome,
      desktopExitCode: desktopExit.code,
      processTreeReleased: true,
      portReleased: true,
      lifecycleEvents: events,
    }
  } finally {
    if (!passed) killIfRunning(desktop)
  }
}

async function testCrashRecovery(dataDirectory) {
  await mkdir(dataDirectory, { recursive: true })
  const workspace = join(dataDirectory, 'workspace')
  await mkdir(workspace, { recursive: true })
  await assertPortFree('forced parent termination recovery test')
  const desktop = spawnTracked(
    'Desktop forced parent termination instance',
    desktopExecutable,
    [],
    desktopEnvironment(dataDirectory),
  )
  let restarted
  let passed = false

  try {
    const initialBootstrap = await waitForBootstrap(READY_TIMEOUT_MS, desktop)
    const desktopPid = desktop.child.pid
    ensure(
      Number.isSafeInteger(desktopPid) && desktopPid > 0,
      'Forced parent termination Desktop has no process ID',
    )
    const initialTree = await readDesktopProcessTree(desktopPid)
    const initialDescendants = Array.isArray(initialTree.descendants)
      ? initialTree.descendants
      : [initialTree.descendants]
    const initialHost = initialDescendants.find(isHostProcess)
    ensure(
      initialHost !== undefined,
      'Forced parent termination Desktop owns no Host',
    )
    const initialProcessIds = [
      desktopPid,
      ...initialDescendants.map((process_) => process_.pid),
    ]

    const createdProject = await apiJson('/api/v1/projects', {
      method: 'POST',
      body: {
        actionId: 'act_phase4g2_crash_project01',
        name: 'Phase 4G.2 crash recovery',
        path: workspace,
      },
    })
    const projectId = createdProject.data?.project?.projectId
    ensure(
      typeof projectId === 'string' && projectId.startsWith('proj_'),
      'Crash recovery Project creation returned no public identity',
    )
    const machines = await apiJson('/api/v1/machines')
    const machine = machines.machines?.[0]
    ensure(
      machines.machines?.length === 1 && typeof machine?.machineId === 'string',
      'Crash recovery requires exactly one local Machine',
    )
    const createdConversation = await apiJson('/api/v1/conversations', {
      method: 'POST',
      body: {
        actionId: 'act_phase4g2_crash_conversation01',
        provider: 'codex',
        projectId,
        machineId: machine.machineId,
      },
    })
    const conversationId =
      createdConversation.data?.conversation?.conversationId
    ensure(
      typeof conversationId === 'string' && conversationId.startsWith('conv_'),
      'Crash recovery Conversation creation returned no public identity',
    )

    const sessionQuery = await sendWindowsLifecycleMessages(desktopPid, 'query')
    ensure(
      sessionQuery.queryResult === 1 && sessionQuery.queryNativeMs < 500,
      'Crash recovery session-end query was not allowed promptly',
    )
    const terminationStartedAt = performance.now()
    ensure(
      desktop.child.kill(),
      `Could not terminate exact Desktop PID ${String(desktopPid)}`,
    )
    const forcedExit = await waitForExit(desktop, 8_000)
    await Promise.all([
      waitUntilNotListening(RELEASE_TIMEOUT_MS),
      waitUntilProcessesExit(initialProcessIds, RELEASE_TIMEOUT_MS),
    ])
    const processCleanupMs = elapsed(terminationStartedAt)
    const databasePath = join(dataDirectory, 'codetether.sqlite3')

    // The restarted Host must be the first process to reopen the database;
    // otherwise an external integrity probe could perform WAL recovery and
    // mask a product restart failure.
    restarted = spawnTracked(
      'Desktop crash recovery restart instance',
      desktopExecutable,
      ['--desktop-smoke-exit-after-ready-ms=10000'],
      desktopEnvironment(dataDirectory),
    )
    const restartedBootstrap = await waitForBootstrap(
      READY_TIMEOUT_MS,
      restarted,
    )
    ensure(
      restartedBootstrap.epoch !== initialBootstrap.epoch,
      'Crash recovery restart reused the terminated Host epoch',
    )
    const restoredProject = await apiJson(`/api/v1/projects/${projectId}`)
    ensure(
      restoredProject.project?.projectId === projectId,
      'Crash recovery restart did not restore the durable Project',
    )
    const restoredConversation = await apiJson(
      `/api/v1/conversations/${conversationId}`,
    )
    ensure(
      restoredConversation.conversation?.conversationId === conversationId &&
        restoredConversation.conversation?.projectId === projectId &&
        restoredConversation.conversation?.machineId === machine.machineId,
      'Crash recovery restart did not restore the durable Conversation',
    )
    const restartedPid = restarted.child.pid
    ensure(
      Number.isSafeInteger(restartedPid) && restartedPid > 0,
      'Crash recovery restarted Desktop has no process ID',
    )
    const restartedTree = await readDesktopProcessTree(restartedPid)
    const restartedDescendants = Array.isArray(restartedTree.descendants)
      ? restartedTree.descendants
      : [restartedTree.descendants]
    const restartedProcessIds = [
      restartedPid,
      ...restartedDescendants.map((process_) => process_.pid),
    ]
    const restartedExit = await waitForExit(restarted, PROCESS_TIMEOUT_MS)
    ensureCleanExit(restarted, restartedExit)
    await Promise.all([
      waitUntilNotListening(RELEASE_TIMEOUT_MS),
      waitUntilProcessesExit(restartedProcessIds, RELEASE_TIMEOUT_MS),
    ])
    const sqliteAfterRestart = sqliteHealth(databasePath)
    ensure(
      sqliteAfterRestart.integrity === 'ok' &&
        sqliteAfterRestart.foreignKeyViolations === 0,
      `SQLite health failed after crash recovery restart: ${JSON.stringify(sqliteAfterRestart)}`,
    )
    passed = true
    return {
      passed: true,
      evidence: 'SIMULATED_SESSION_QUERY_AND_REAL_FORCED_PARENT_TERMINATION',
      initialDesktopPid: desktopPid,
      initialHostPid: initialHost.pid,
      initialHostEpoch: initialBootstrap.epoch,
      sessionQueryNativeMs: sessionQuery.queryNativeMs,
      forcedExitCode: forcedExit.code,
      forcedExitSignal: forcedExit.signal,
      jobObjectProcessTreeReleased: true,
      processCleanupMs,
      portReleasedAfterTermination: true,
      restartedDesktopPid: restartedPid,
      restartedHostEpoch: restartedBootstrap.epoch,
      durableProjectRestored: true,
      durableConversationRestored: true,
      sqliteAfterRestart,
      cleanRestartExitCode: restartedExit.code,
      portReleasedAfterRestart: true,
    }
  } finally {
    if (!passed) {
      killIfRunning(restarted)
      killIfRunning(desktop)
    }
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

    const initialWindow = await waitForExactWindowVisibility(
      desktopPid,
      true,
      WINDOW_STATE_TIMEOUT_MS,
      undefined,
      desktop,
    )
    const closeResult = await postWindowClose(desktopPid)
    ensure(
      closeResult.hwnd === initialWindow.hwnd,
      'Unexpected Host exit test did not hide the exact main window',
    )
    const hiddenWindow = await waitForExactWindowVisibility(
      desktopPid,
      false,
      WINDOW_STATE_TIMEOUT_MS,
      initialWindow.hwnd,
      desktop,
    )
    ensure(
      isRunning(desktop),
      'Desktop exited instead of entering the hidden background state before Host failure',
    )
    const hiddenBootstrap = await readBootstrap()
    ensure(
      sameHost(bootstrap, hiddenBootstrap),
      'Hiding the window changed the Host before the unexpected-exit action',
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
      hwnd: initialWindow.hwnd,
      windowHiddenBeforeFailure: hiddenWindow.visible === false,
      hostEpochPreservedWhileHidden: hiddenBootstrap.epoch,
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
    [
      `--desktop-smoke-exit-after-ready-ms=${String(SMOKE_EXPLICIT_QUIT_DELAY_MS)}`,
    ],
    desktopEnvironment(dataDirectory),
  )
  let second
  let passed = false

  try {
    const initialBootstrap = await waitForBootstrap(READY_TIMEOUT_MS, first)
    const firstReadyMs = elapsed(startedAt)
    ensure(isRunning(first), 'First Desktop exited before the second launch')
    const firstPid = first.child.pid
    ensure(
      Number.isSafeInteger(firstPid) && firstPid > 0,
      'First Desktop has no process ID',
    )
    const initialWindow = await waitForExactWindowVisibility(
      firstPid,
      true,
      WINDOW_STATE_TIMEOUT_MS,
      undefined,
      first,
    )
    const initialTree = await readDesktopProcessTree(firstPid)
    const initialDescendants = Array.isArray(initialTree.descendants)
      ? initialTree.descendants
      : [initialTree.descendants]
    const initialHost = initialDescendants.find(isHostProcess)
    ensure(initialHost !== undefined, 'First Desktop does not own a Host')
    const ownedProcessIds = [
      firstPid,
      ...initialDescendants.map((process_) => process_.pid),
    ]
    await postWindowClose(firstPid)
    await waitForExactWindowVisibility(
      firstPid,
      false,
      WINDOW_STATE_TIMEOUT_MS,
      initialWindow.hwnd,
      first,
    )
    ensure(isRunning(first), 'Hidden first Desktop exited before second launch')

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

    const restoredWindow = await waitForExactWindowVisibility(
      firstPid,
      true,
      WINDOW_STATE_TIMEOUT_MS,
      initialWindow.hwnd,
      first,
    )
    ensure(
      restoredWindow.hwnd === initialWindow.hwnd,
      'Second launch restored a different main window',
    )

    const preservedBootstrap = await readBootstrap()
    ensure(
      sameHost(initialBootstrap, preservedBootstrap),
      'The first Desktop Host changed after the second launch',
    )
    const restoredTree = await readDesktopProcessTree(firstPid)
    const restoredDescendants = Array.isArray(restoredTree.descendants)
      ? restoredTree.descendants
      : [restoredTree.descendants]
    const restoredHost = restoredDescendants.find(isHostProcess)
    ensure(
      restoredHost !== undefined && restoredHost.pid === initialHost.pid,
      'Second launch replaced the hidden Desktop owned Host process',
    )

    const firstExit = await waitForExit(first, PROCESS_TIMEOUT_MS)
    ensureCleanExit(first, firstExit)
    ensure(
      !/shutdown timed out|did not confirm a clean shutdown/u.test(
        first.diagnostics(),
      ),
      `First Desktop did not complete graceful Host shutdown${diagnosticSuffix(first)}`,
    )
    const releaseStartedAt = performance.now()
    await Promise.all([
      waitUntilNotListening(RELEASE_TIMEOUT_MS),
      waitUntilProcessesExit(ownedProcessIds, RELEASE_TIMEOUT_MS),
    ])
    const releaseMs = elapsed(releaseStartedAt)
    passed = true

    return {
      passed: true,
      firstReadyMs,
      secondExitMs,
      secondExitCode: secondExit.code,
      hiddenWindowRestored: true,
      restoredHwnd: restoredWindow.hwnd,
      firstHostPreserved: true,
      preservedHostPid: restoredHost.pid,
      preservedHostEpoch: preservedBootstrap.epoch,
      firstExitMs: elapsed(startedAt),
      firstExitCode: firstExit.code,
      gracefulExitConfirmed: true,
      portReleased: true,
      processTreeReleased: true,
      releaseMs,
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

async function sendAltF4(desktopPid) {
  const helper = spawnTracked(
    'Alt+F4 Win32 helper',
    powershellExecutable,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      windowsAltF4Script(desktopPid),
    ],
    process.env,
  )
  const outcome = await waitForExit(helper, 15_000)
  ensureCleanExit(helper, outcome)
  const output = helper.standardOutput()
  ensure(output.length > 0, 'Alt+F4 Win32 helper returned no result')
  try {
    const result = JSON.parse(output)
    ensure(
      result !== null &&
        typeof result === 'object' &&
        result.desktopPid === desktopPid &&
        result.title === WINDOW_TITLE &&
        typeof result.hwnd === 'string' &&
        /^\d+$/u.test(result.hwnd) &&
        result.systemKeyTargeted === true,
      'Alt+F4 Win32 helper returned an invalid window identity',
    )
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Could not parse Alt+F4 helper result: ${message}\n${output}`,
      { cause: error },
    )
  }
}

async function sendWindowsLifecycleMessages(desktopPid, scenario) {
  ensure(
    scenario === 'recovery' || scenario === 'query' || scenario === 'end',
    'Unknown Windows lifecycle message scenario',
  )
  const helper = spawnTracked(
    `Windows lifecycle ${scenario} helper`,
    powershellExecutable,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      windowsLifecycleMessageScript(desktopPid, scenario),
    ],
    process.env,
  )
  const outcome = await waitForExit(helper, 20_000)
  ensureCleanExit(helper, outcome)
  const output = helper.standardOutput()
  ensure(output.length > 0, 'Windows lifecycle helper returned no result')
  try {
    const result = JSON.parse(output)
    ensure(
      result !== null &&
        typeof result === 'object' &&
        result.desktopPid === desktopPid &&
        result.scenario === scenario &&
        typeof result.hwnd === 'string' &&
        /^\d+$/u.test(result.hwnd) &&
        typeof result.queryNativeMs === 'number' &&
        Number.isFinite(result.queryNativeMs),
      'Windows lifecycle helper returned an invalid result',
    )
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Could not parse Windows lifecycle helper result: ${message}\n${output}`,
      { cause: error },
    )
  }
}

async function waitForLifecycleEventCount(owner, event, expected, timeoutMs) {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    if (!isRunning(owner)) {
      throw new Error(
        `${owner.label} exited while waiting for ${event}${diagnosticSuffix(owner)}`,
      )
    }
    if (countLifecycleEvents(parseLifecycleEvents(owner), event) >= expected) {
      return
    }
    await delay(50)
  }
  throw new Error(
    `Lifecycle event ${event} did not reach ${String(expected)} occurrences${diagnosticSuffix(owner)}`,
  )
}

function parseLifecycleEvents(owner) {
  const prefix = '[codetether:lifecycle] '
  return owner
    .diagnostics()
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(prefix))
    .flatMap((line) => {
      try {
        const value = JSON.parse(line.slice(prefix.length))
        return value !== null && typeof value === 'object' ? [value] : []
      } catch {
        return []
      }
    })
}

function countLifecycleEvents(events, event) {
  return events.filter((candidate) => candidate.event === event).length
}

async function waitForExactWindowVisibility(
  desktopPid,
  visible,
  timeoutMs,
  expectedHwnd,
  owner,
) {
  const deadline = performance.now() + timeoutMs
  let lastState
  let lastError
  while (performance.now() < deadline) {
    if (owner !== undefined && !isRunning(owner)) {
      throw new Error(
        `${owner.label} exited while waiting for its main window${diagnosticSuffix(owner)}`,
      )
    }
    try {
      const state = await readExactWindowState(desktopPid, expectedHwnd)
      lastState = state
      if (state.visible === visible) return state
    } catch (error) {
      lastError = error
    }
    await delay(75)
  }
  const detail =
    lastState === undefined
      ? lastError instanceof Error
        ? `: ${lastError.message}`
        : ''
      : `: last state ${JSON.stringify(lastState)}`
  throw new Error(
    `Exact Desktop window did not become ${visible ? 'visible' : 'hidden'} within ${String(timeoutMs)} ms${detail}`,
  )
}

async function readExactWindowState(desktopPid, expectedHwnd) {
  ensure(
    Number.isSafeInteger(desktopPid) && desktopPid > 0,
    'Exact window probe requires a valid Desktop PID',
  )
  ensure(
    expectedHwnd === undefined || /^\d+$/u.test(expectedHwnd),
    'Exact window probe requires a valid HWND',
  )
  const helper = spawnTracked(
    'Desktop exact window state helper',
    powershellExecutable,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      windowsWindowStateScript(desktopPid, expectedHwnd),
    ],
    process.env,
  )
  const outcome = await waitForExit(helper, 15_000)
  ensureCleanExit(helper, outcome)
  const output = helper.standardOutput()
  ensure(output.length > 0, 'Exact window state helper returned no result')
  try {
    const result = JSON.parse(output)
    ensure(
      result !== null &&
        typeof result === 'object' &&
        result.desktopPid === desktopPid &&
        result.title === WINDOW_TITLE &&
        typeof result.hwnd === 'string' &&
        /^\d+$/u.test(result.hwnd) &&
        typeof result.visible === 'boolean' &&
        typeof result.minimized === 'boolean' &&
        (expectedHwnd === undefined || result.hwnd === expectedHwnd),
      'Exact window state helper returned an invalid window identity',
    )
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Could not parse exact window state result: ${message}\n${output}`,
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

function windowsWindowStateScript(desktopPid, expectedHwnd) {
  const hwndValue = expectedHwnd ?? '0'
  return String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class CodeTetherExactWindowProbe
{
    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr state);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr state);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsIconic(IntPtr window);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLengthW(IntPtr window);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextW(IntPtr window, StringBuilder text, int capacity);

    public static string Title(IntPtr window)
    {
        int length = GetWindowTextLengthW(window);
        StringBuilder text = new StringBuilder(length + 1);
        GetWindowTextW(window, text, text.Capacity);
        return text.ToString();
    }

    public static IntPtr Find(uint expectedProcessId, string expectedTitle)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr window, IntPtr state)
        {
            uint processId;
            GetWindowThreadProcessId(window, out processId);
            if (processId == expectedProcessId && String.Equals(Title(window), expectedTitle, StringComparison.Ordinal))
            {
                found = window;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
'@

$expectedPid = [uint32]${String(desktopPid)}
$expectedTitle = '${WINDOW_TITLE}'
$window = [IntPtr]::new([int64]${hwndValue})
if ($window -eq [IntPtr]::Zero) {
  $window = [CodeTetherExactWindowProbe]::Find($expectedPid, $expectedTitle)
}
if ($window -eq [IntPtr]::Zero -or ![CodeTetherExactWindowProbe]::IsWindow($window)) {
  throw 'Exact Desktop main window was not found'
}
$windowPid = [uint32]0
[void][CodeTetherExactWindowProbe]::GetWindowThreadProcessId($window, [ref]$windowPid)
$windowTitle = [CodeTetherExactWindowProbe]::Title($window)
if ($windowPid -ne $expectedPid -or $windowTitle -cne $expectedTitle) {
  throw 'Exact Desktop main window identity does not match the expected PID and title'
}
[pscustomobject]@{
  desktopPid = [int]$expectedPid
  hwnd = [string]$window.ToInt64()
  title = $windowTitle
  visible = [CodeTetherExactWindowProbe]::IsWindowVisible($window)
  minimized = [CodeTetherExactWindowProbe]::IsIconic($window)
} | ConvertTo-Json -Compress
`
}

function windowsLifecycleMessageScript(desktopPid, scenario) {
  return String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class CodeTetherLifecycleProbe
{
    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr state);
    private const uint SMTO_ABORTIFHUNG = 0x0002;

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr state);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLengthW(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextW(IntPtr window, StringBuilder text, int capacity);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr SendMessageTimeoutW(
        IntPtr window,
        uint message,
        UIntPtr wParam,
        IntPtr lParam,
        uint flags,
        uint timeout,
        out UIntPtr result);

    public static string Title(IntPtr window)
    {
        int length = GetWindowTextLengthW(window);
        StringBuilder text = new StringBuilder(length + 1);
        GetWindowTextW(window, text, text.Capacity);
        return text.ToString();
    }

    public static IntPtr Find(uint expectedProcessId, string expectedTitle)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr window, IntPtr state)
        {
            uint processId;
            GetWindowThreadProcessId(window, out processId);
            if (processId == expectedProcessId && String.Equals(Title(window), expectedTitle, StringComparison.Ordinal))
            {
                found = window;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static long Send(IntPtr window, uint message, ulong wParam, long lParam, uint timeout)
    {
        UIntPtr result;
        IntPtr delivered = SendMessageTimeoutW(
            window,
            message,
            new UIntPtr(wParam),
            new IntPtr(lParam),
            SMTO_ABORTIFHUNG,
            timeout,
            out result);
        if (delivered == IntPtr.Zero)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "SendMessageTimeoutW failed");
        }
        return unchecked((long)result.ToUInt64());
    }
}
'@

$expectedPid = [uint32]${String(desktopPid)}
$expectedTitle = '${WINDOW_TITLE}'
$scenario = '${scenario}'
$window = [CodeTetherLifecycleProbe]::Find($expectedPid, $expectedTitle)
if ($window -eq [IntPtr]::Zero) { throw 'Exact Desktop main window was not found' }
$windowPid = [uint32]0
[void][CodeTetherLifecycleProbe]::GetWindowThreadProcessId($window, [ref]$windowPid)
if ($windowPid -ne $expectedPid) { throw 'Desktop window identity changed' }

$queryWatch = [Diagnostics.Stopwatch]::StartNew()
$queryResult = [CodeTetherLifecycleProbe]::Send($window, 0x0011, 0, 0, 1000)
$queryWatch.Stop()
$endNativeMs = 0
$suspendCycles = 0
$lockCycles = 0

if ($scenario -ceq 'recovery') {
  [void][CodeTetherLifecycleProbe]::Send($window, 0x0016, 0, 0, 1000)
  for ($cycle = 0; $cycle -lt 5; $cycle += 1) {
    [void][CodeTetherLifecycleProbe]::Send($window, 0x0218, 4, 0, 1000)
    Start-Sleep -Milliseconds 75
    [void][CodeTetherLifecycleProbe]::Send($window, 0x0218, 18, 0, 1000)
    # A normal Windows wake can deliver both PBT_APMRESUMEAUTOMATIC and
    # PBT_APMRESUMESUSPEND. The second message must be a non-blocking,
    # idempotent diagnostic rather than re-entering resume reconciliation.
    [void][CodeTetherLifecycleProbe]::Send($window, 0x0218, 7, 0, 1000)
    Start-Sleep -Milliseconds 250
    $suspendCycles += 1
  }
  for ($cycle = 0; $cycle -lt 5; $cycle += 1) {
    [void][CodeTetherLifecycleProbe]::Send($window, 0x02B1, 7, 0, 1000)
    [void][CodeTetherLifecycleProbe]::Send($window, 0x02B1, 8, 0, 1000)
    $lockCycles += 1
  }
} elseif ($scenario -ceq 'end') {
  $endWatch = [Diagnostics.Stopwatch]::StartNew()
  [void][CodeTetherLifecycleProbe]::Send($window, 0x0016, 1, 0, 5000)
  $endWatch.Stop()
  $endNativeMs = [math]::Round($endWatch.Elapsed.TotalMilliseconds, 3)
}

[pscustomobject]@{
  desktopPid = [int]$expectedPid
  hwnd = [string]$window.ToInt64()
  scenario = $scenario
  queryResult = [int64]$queryResult
  queryNativeMs = [math]::Round($queryWatch.Elapsed.TotalMilliseconds, 3)
  endNativeMs = $endNativeMs
  suspendCycles = $suspendCycles
  lockCycles = $lockCycles
} | ConvertTo-Json -Compress
`
}

function windowsAltF4Script(desktopPid) {
  return String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class CodeTetherAltF4Probe
{
    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr state);
    private const uint WM_SYSKEYDOWN = 0x0104;
    private const uint WM_SYSKEYUP = 0x0105;
    private const UInt32 VK_F4 = 0x73;
    private const Int64 F4_DOWN = 1L | (0x3EL << 16) | (1L << 29);
    private const Int64 F4_UP = F4_DOWN | (1L << 30) | (1L << 31);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr state);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLengthW(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextW(IntPtr window, StringBuilder text, int capacity);
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostMessageW(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam);

    public static string Title(IntPtr window)
    {
        int length = GetWindowTextLengthW(window);
        StringBuilder text = new StringBuilder(length + 1);
        GetWindowTextW(window, text, text.Capacity);
        return text.ToString();
    }

    public static IntPtr Find(uint expectedProcessId, string expectedTitle)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr window, IntPtr state)
        {
            uint processId;
            GetWindowThreadProcessId(window, out processId);
            if (processId == expectedProcessId && String.Equals(Title(window), expectedTitle, StringComparison.Ordinal))
            {
                found = window;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static bool Send(uint expectedProcessId, IntPtr window)
    {
      uint actualProcessId;
      uint targetThread = GetWindowThreadProcessId(window, out actualProcessId);
      if (actualProcessId != expectedProcessId || targetThread == 0) return false;
      bool down = PostMessageW(window, WM_SYSKEYDOWN, new UIntPtr(VK_F4), new IntPtr(F4_DOWN));
      bool up = PostMessageW(window, WM_SYSKEYUP, new UIntPtr(VK_F4), new IntPtr(F4_UP));
      return down && up;
    }
}
'@

$expectedPid = [uint32]${String(desktopPid)}
$expectedTitle = '${WINDOW_TITLE}'
$desktop = @(Get-CimInstance Win32_Process -Filter "ProcessId = ${String(desktopPid)}")
if ($desktop.Count -ne 1 -or $desktop[0].Name -ine 'codetether-desktop.exe') {
  throw 'Exact Desktop process was not found for Alt+F4'
}
$deadline = [Diagnostics.Stopwatch]::StartNew()
$window = [IntPtr]::Zero
do {
  $window = [CodeTetherAltF4Probe]::Find($expectedPid, $expectedTitle)
  if ($window -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 50
} while ($deadline.ElapsedMilliseconds -lt 5000)
if ($window -eq [IntPtr]::Zero) { throw 'Exact Desktop main window was not found for Alt+F4' }
if (![CodeTetherAltF4Probe]::Send($expectedPid, $window)) {
  throw 'Could not send Alt+F4 system-key messages to the exact Desktop main window'
}
[pscustomobject]@{
  desktopPid = [int]$expectedPid
  hwnd = [string]$window.ToInt64()
  title = [CodeTetherAltF4Probe]::Title($window)
  systemKeyTargeted = $true
} | ConvertTo-Json -Compress
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
$deadline = [Diagnostics.Stopwatch]::StartNew()
$window = [IntPtr]::Zero
do {
  $window = [CodeTetherWindowProbe]::Find($expectedPid, $expectedTitle)
  if ($window -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 50
} while ($deadline.ElapsedMilliseconds -lt 5000)
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

async function apiJson(path, options = {}) {
  const response = await httpRequest(path, {
    ...options,
    timeoutMs: options.timeoutMs ?? 5_000,
  })
  let body
  try {
    body = JSON.parse(response.body)
  } catch (error) {
    throw new Error(
      `Host request ${path} returned invalid JSON: ${response.body}`,
      { cause: error },
    )
  }
  ensure(
    response.statusCode >= 200 && response.statusCode < 300,
    `Host request ${path} returned HTTP ${String(response.statusCode)}: ${response.body}`,
  )
  return body
}

async function httpRequest(path, options = {}) {
  const requestBody =
    options.body === undefined ? undefined : JSON.stringify(options.body)
  return await new Promise((resolveRequest, reject) => {
    const outgoing = request(
      {
        host: HOST,
        port: PORT,
        path,
        method: options.method ?? 'GET',
        timeout: options.timeoutMs ?? 750,
        ...(requestBody === undefined
          ? {}
          : {
              headers: {
                'content-length': Buffer.byteLength(requestBody),
                'content-type': 'application/json',
              },
            }),
      },
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
    if (requestBody !== undefined) outgoing.write(requestBody)
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

function isHostProcess(process_) {
  return (
    process_ !== null &&
    typeof process_ === 'object' &&
    typeof process_.name === 'string' &&
    process_.name.toLowerCase() === 'codetether-host.exe'
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

function sqliteHealth(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true })
  try {
    return {
      integrity: database.prepare('PRAGMA integrity_check').get()
        ?.integrity_check,
      foreignKeyViolations: database.prepare('PRAGMA foreign_key_check').all()
        .length,
      userVersion: database.prepare('PRAGMA user_version').get()?.user_version,
    }
  } finally {
    database.close()
  }
}

async function writePhase4g2Evidence(value) {
  const configured = process.env.CODETETHER_PHASE4G2_EVIDENCE_DIR?.trim()
  if (configured === undefined || configured.length === 0) return
  const directory = resolve(configured)
  await mkdir(directory, { recursive: true })
  const lifecycleEvents = [
    ...(value.results.windowsLifecycleRecovery?.lifecycleEvents ?? []),
    ...(value.results.sessionEnd?.lifecycleEvents ?? []),
  ]
  const processHealth = {
    ok: value.ok,
    platform: value.platform,
    executables: value.executables,
    windowClose: value.results.windowClose,
    windowsLifecycleRecovery: value.results.windowsLifecycleRecovery,
    sessionEnd: value.results.sessionEnd,
    crashRecovery: value.results.crashRecovery,
    unexpectedHostExit: value.results.unexpectedHostExit,
    singleInstance: value.results.singleInstance,
  }
  await Promise.all([
    writeFile(
      join(directory, 'phase4g2-lifecycle-events.json'),
      `${JSON.stringify({ events: lifecycleEvents }, null, 2)}\n`,
      'utf8',
    ),
    writeFile(
      join(directory, 'phase4g2-process-health.json'),
      `${JSON.stringify(processHealth, null, 2)}\n`,
      'utf8',
    ),
    writeFile(
      join(directory, 'phase4g2-crash-recovery.json'),
      `${JSON.stringify(value.results.crashRecovery ?? {}, null, 2)}\n`,
      'utf8',
    ),
  ])
  value.evidenceDirectory = directory
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
