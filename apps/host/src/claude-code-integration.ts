import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import {
  CLAUDE_CODE_TESTED_VERSION,
  detectClaudeCode,
} from '@codetether/adapter-claude'
import {
  CodeTetherClient,
  type CodeTetherEventStream,
} from '@codetether/client'
import {
  ActionIdSchema,
  type ConversationId,
  type GetConversationResponse,
  type HostEventEnvelope,
} from '@codetether/protocol'

import {
  startLocalCodexHost,
  type RunningLocalCodexHost,
} from './api/local-codex-host.js'

const execFileAsync = promisify(execFile)
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const temporaryPrefix = 'codetether-claude-real-integration-'
const outputEnvironmentName = 'CODETETHER_CLAUDE_INTEGRATION_OUTPUT'
const evidencePhase = process.env.CODETETHER_INTEGRATION_PHASE ?? '5A'
const turnTimeoutMs = 300_000

type Stage =
  | 'preflight'
  | 'detection'
  | 'first_host'
  | 'codex_turn'
  | 'exact_turn'
  | 'tool_turn'
  | 'seed_turn'
  | 'first_shutdown'
  | 'restart'
  | 'cold_organization'
  | 'resume_turn'
  | 'cleanup'

interface TurnObservation {
  readonly finalMessage: string
  readonly eventCounts: Record<string, number>
  readonly startedToolKinds: readonly string[]
  readonly completedToolKinds: readonly string[]
  readonly timingsMs: {
    readonly startAccepted: number
    readonly firstToken: number
    readonly complete: number
  }
}

interface ProcessSnapshot {
  readonly claude: ReadonlySet<number>
  readonly codex: ReadonlySet<number>
}

class IntegrationFailure extends Error {
  constructor(readonly safeCode: string) {
    super('Real Claude Code integration failed.')
  }
}

async function run(): Promise<void> {
  const integrationStartedAt = performance.now()
  const testedAt = new Date().toISOString()
  let stage: Stage = 'preflight'
  let temporaryRoot: string | undefined
  let host: RunningLocalCodexHost | undefined
  const usedPorts = new Set<number>()
  let baselineProcesses: ProcessSnapshot = {
    claude: new Set(),
    codex: new Set(),
  }
  let result: Record<string, unknown> | undefined
  let failureCode: string | undefined
  let failedStage: Stage | undefined
  let detectionSummary: Record<string, unknown> = {
    status: 'not_run',
    testedVersion: CLAUDE_CODE_TESTED_VERSION,
  }

  try {
    ensure(process.platform === 'win32', 'windows_required')
    baselineProcesses = await readProviderProcesses()

    stage = 'detection'
    const detectionStartedAt = performance.now()
    const detection = await detectClaudeCode()
    const detectionWallMs = milliseconds(performance.now() - detectionStartedAt)
    detectionSummary = {
      status: detection.status,
      testedVersion: CLAUDE_CODE_TESTED_VERSION,
      ...('version' in detection ? { version: detection.version } : {}),
      timingsMs: {
        wall: detectionWallMs,
        probe: detection.durationMs,
      },
    }
    ensure(detection.status === 'available', `detection_${detection.status}`)

    temporaryRoot = await createTemporaryFixture()
    const workspace = join(temporaryRoot, 'workspace')
    const databasePath = join(temporaryRoot, 'data', 'codetether.sqlite3')
    const hostVersion = await readHostVersion()
    const marker = `CLAUDE-CONTEXT-${randomUUID()
      .replaceAll('-', '')
      .slice(0, 16)
      .toUpperCase()}`
    const toolMarker = `CLAUDE-TOOL-${randomUUID()
      .replaceAll('-', '')
      .slice(0, 16)
      .toUpperCase()}`
    await writeFile(
      join(workspace, 'phase5a-tool-fixture.txt'),
      `Phase 5A disposable tool evidence.\n${toolMarker}\n`,
      'utf8',
    )
    const organizationTitle = `Claude Resume Evidence ${randomUUID()
      .replaceAll('-', '')
      .slice(0, 8)}`

    stage = 'first_host'
    const firstHostStartedAt = performance.now()
    host = await launchHost(workspace, databasePath, hostVersion)
    const firstHostStartMs = milliseconds(
      performance.now() - firstHostStartedAt,
    )
    const firstPort = portOf(host)
    usedPorts.add(firstPort)
    const firstEpoch = host.epoch
    let client = await requireProviders(host)
    const machines = (await client.listMachines()).machines
    const localMachine = machines.find((machine) => machine.kind === 'local')
    ensure(localMachine !== undefined, 'machine_missing')
    const machineId = localMachine.machineId

    const project = await client.createProject({
      actionId: actionId('project'),
      path: workspace,
      name: 'Phase 5A Real Claude Integration',
    })
    const projectId = project.data.project.projectId
    const codexConversation = await client.createConversation({
      actionId: actionId('codex-conversation'),
      provider: 'codex',
      projectId,
      machineId,
    })
    const createClaudeStartedAt = performance.now()
    const exactConversation = await client.createConversation({
      actionId: actionId('exact-conversation'),
      provider: 'claude-code',
      projectId,
      machineId,
    })
    const claudeConversationCreateMs = milliseconds(
      performance.now() - createClaudeStartedAt,
    )
    const toolConversation = await client.createConversation({
      actionId: actionId('tool-conversation'),
      provider: 'claude-code',
      projectId,
      machineId,
    })
    const memoryConversation = await client.createConversation({
      actionId: actionId('memory-conversation'),
      provider: 'claude-code',
      projectId,
      machineId,
    })
    await assertMixedProviderReads(
      client,
      projectId,
      codexConversation.data.conversation.conversationId,
      exactConversation.data.conversation.conversationId,
    )

    stage = 'codex_turn'
    const codex = await runObservedTurn(
      client,
      codexConversation.data.conversation.conversationId,
      'Reply exactly:\nPHASE6A_CODEX_OK',
    )
    ensure(
      codex.finalMessage.trim() === 'PHASE6A_CODEX_OK',
      'codex_exact_reply_mismatch',
    )

    stage = 'exact_turn'
    const exact = await runObservedTurn(
      client,
      exactConversation.data.conversation.conversationId,
      'Reply exactly:\nPHASE5A_CLAUDE_OK',
    )
    ensure(
      exact.finalMessage.trim() === 'PHASE5A_CLAUDE_OK',
      'exact_reply_mismatch',
    )

    stage = 'tool_turn'
    const tool = await runObservedTurn(
      client,
      toolConversation.data.conversation.conversationId,
      [
        'Use Glob to find phase5a-tool-fixture.txt in the current workspace.',
        'Then use Read to read that file.',
        'Do not use any other tools.',
        'Reply with only the marker contained in the file.',
      ].join(' '),
    )
    ensure(tool.finalMessage.includes(toolMarker), 'tool_marker_mismatch')
    ensure(
      tool.startedToolKinds.includes('search') &&
        tool.startedToolKinds.includes('read') &&
        tool.completedToolKinds.includes('search') &&
        tool.completedToolKinds.includes('read'),
      'tool_normalization_missing',
    )

    stage = 'seed_turn'
    const seed = await runObservedTurn(
      client,
      memoryConversation.data.conversation.conversationId,
      [
        `Remember marker: ${marker}`,
        'Keep it only in this native conversation context and do not write it to a file.',
        'Do not use tools. Reply exactly: MARKER_STORED',
      ].join(' '),
    )
    ensure(seed.finalMessage.trim() === 'MARKER_STORED', 'seed_reply_mismatch')
    await waitForNoNewClaudeProcesses(baselineProcesses.claude)

    stage = 'first_shutdown'
    await closeHost(host, firstPort)
    host = undefined
    await waitForNoNewProviderProcesses(baselineProcesses)

    stage = 'restart'
    const restartStartedAt = performance.now()
    host = await launchHost(workspace, databasePath, hostVersion)
    const restartHostStartMs = milliseconds(
      performance.now() - restartStartedAt,
    )
    const restartedPort = portOf(host)
    usedPorts.add(restartedPort)
    ensure(host.epoch !== firstEpoch, 'host_epoch_not_restarted')
    client = await requireProviders(host)
    const restartedMachines = (await client.listMachines()).machines
    ensure(
      restartedMachines.length === 1 &&
        restartedMachines[0]?.machineId === machineId,
      'machine_identity_changed_after_restart',
    )
    await assertMixedProviderReads(
      client,
      projectId,
      codexConversation.data.conversation.conversationId,
      memoryConversation.data.conversation.conversationId,
    )

    stage = 'cold_organization'
    const coldStartedAt = performance.now()
    const providerProcessesBeforeCold = await readProviderProcesses()
    const memoryConversationId =
      memoryConversation.data.conversation.conversationId
    const machineDetail = await client.getMachine(machineId)
    ensure(
      machineDetail.machine.machineId === machineId &&
        machineDetail.projects.some(
          (entry) =>
            entry.projectId === projectId &&
            entry.locations.some(
              (location) => location.machineId === machineId,
            ),
        ) &&
        machineDetail.conversations.some(
          (entry) =>
            entry.conversationId ===
              codexConversation.data.conversation.conversationId &&
            entry.machineId === machineId,
        ) &&
        machineDetail.conversations.some(
          (entry) =>
            entry.conversationId === memoryConversationId &&
            entry.machineId === machineId,
        ),
      'machine_detail_binding_missing',
    )
    const renamed = await client.renameConversation(memoryConversationId, {
      actionId: actionId('rename'),
      title: organizationTitle,
    })
    ensure(renamed.data.conversation.titleSource === 'manual', 'rename_failed')
    const pinned = await client.pinConversation(memoryConversationId, {
      actionId: actionId('pin'),
    })
    ensure(pinned.data.conversation.pinnedAt !== undefined, 'pin_failed')
    const archived = await client.archiveConversation(memoryConversationId, {
      actionId: actionId('archive'),
    })
    ensure(
      archived.data.conversation.archivedAt !== undefined &&
        archived.data.conversation.pinnedAt === undefined,
      'archive_failed',
    )
    const [titleSearch, inputSearch] = await Promise.all([
      client.searchProjectConversations(projectId, {
        query: organizationTitle,
        archive: 'all',
        provider: 'claude-code',
      }),
      client.searchProjectConversations(projectId, {
        query: marker,
        archive: 'all',
        provider: 'claude-code',
      }),
    ])
    ensure(
      titleSearch.results.some(
        (entry) =>
          entry.conversation.conversationId === memoryConversationId &&
          entry.matchedField === 'title',
      ),
      'title_search_failed',
    )
    ensure(
      inputSearch.results.some(
        (entry) =>
          entry.conversation.conversationId === memoryConversationId &&
          entry.matchedField === 'user_input',
      ),
      'input_search_failed',
    )
    const unarchived = await client.unarchiveConversation(
      memoryConversationId,
      { actionId: actionId('unarchive') },
    )
    ensure(
      unarchived.data.conversation.archivedAt === undefined,
      'unarchive_failed',
    )
    await client.getConversation(memoryConversationId)
    const providerProcessesAfterCold = await readProviderProcesses()
    ensure(
      newProcessCount(
        providerProcessesBeforeCold,
        providerProcessesAfterCold,
      ) === 0,
      'cold_operation_started_provider',
    )
    const coldOrganizationMs = milliseconds(performance.now() - coldStartedAt)

    stage = 'resume_turn'
    const resumed = await runObservedTurn(
      client,
      memoryConversationId,
      [
        'Return the marker I asked you to remember before the Host restart.',
        'Do not use tools. Reply with only the marker.',
      ].join(' '),
    )
    ensure(resumed.finalMessage.includes(marker), 'resume_marker_mismatch')
    await waitForNoNewClaudeProcesses(baselineProcesses.claude)

    result = {
      status: 'passed',
      scenarios: {
        exactReply: {
          passed: true,
          streamingObserved: (exact.eventCounts['message.delta'] ?? 0) > 0,
          eventCounts: exact.eventCounts,
        },
        realCodexTurn: {
          passed: true,
          streamingObserved: (codex.eventCounts['message.delta'] ?? 0) > 0,
          replyWasExact: codex.finalMessage.trim() === 'PHASE6A_CODEX_OK',
          eventCounts: codex.eventCounts,
        },
        toolNormalization: {
          passed: true,
          markerRead: true,
          startedKinds: [...new Set(tool.startedToolKinds)].sort(),
          completedKinds: [...new Set(tool.completedToolKinds)].sort(),
          eventCounts: tool.eventCounts,
        },
        nativeResume: {
          passed: true,
          hostServiceClosedAndRelaunched: true,
          hostEpochChanged: true,
          markerRetained: true,
          replyWasExact: resumed.finalMessage.trim() === marker,
          eventCounts: resumed.eventCounts,
        },
        mixedProviderProject: {
          passed: true,
          codexReadable: true,
          claudeReadable: true,
          sameMachine: true,
          machineIdStableAcrossHostRestart: true,
          machineDetailReadWithoutProviderStart: true,
        },
        coldOrganization: {
          passed: true,
          renamed: true,
          pinned: true,
          archiveClearedPin: true,
          titleSearch: true,
          userInputSearch: true,
          unarchived: true,
          noClaudeProcessStarted: true,
        },
      },
      timingsMs: {
        firstHostStart: firstHostStartMs,
        codexTurn: codex.timingsMs,
        claudeConversationCreate: claudeConversationCreateMs,
        exactTurn: exact.timingsMs,
        toolTurn: tool.timingsMs,
        seedTurn: seed.timingsMs,
        restartHostStart: restartHostStartMs,
        coldOrganization: coldOrganizationMs,
        nativeResumeTurn: resumed.timingsMs,
      },
    }
  } catch (error) {
    failedStage = stage
    failureCode = safeFailureCode(error)
  }

  stage = 'cleanup'
  let hostClosed = true
  let hostPortsReleased = true
  let providerProcessesReleased = true
  let temporaryFixtureRemoved = true
  try {
    if (host !== undefined) {
      const port = portOf(host)
      usedPorts.add(port)
      await closeHost(host, port)
      host = undefined
    }
  } catch {
    hostClosed = false
  }
  try {
    for (const port of usedPorts) await waitForPortClosed(port)
  } catch {
    hostPortsReleased = false
  }
  try {
    await waitForNoNewProviderProcesses(baselineProcesses)
  } catch {
    providerProcessesReleased = false
  }
  try {
    if (temporaryRoot !== undefined) {
      await removeTemporaryFixture(temporaryRoot)
    }
  } catch {
    temporaryFixtureRemoved = false
  }

  const cleanupPassed =
    hostClosed &&
    hostPortsReleased &&
    providerProcessesReleased &&
    temporaryFixtureRemoved

  const finalProcesses = await readProviderProcesses().catch(
    () => baselineProcesses,
  )
  const evidence = {
    schemaVersion: 1,
    phase: evidencePhase,
    integration: 'real-claude-code',
    realProvider: true,
    testedAt,
    ...(failureCode === undefined && cleanupPassed
      ? result
      : {
          status: 'failed',
          failedStage: failedStage ?? stage,
          errorCode: failureCode ?? 'cleanup_failed',
        }),
    provider: detectionSummary,
    cleanup: {
      passed: cleanupPassed,
      hostClosed,
      temporaryFixtureRemoved,
      hostPortsReleased,
      providerProcessesReleased,
      providerProcessesBefore: processCount(baselineProcesses),
      providerProcessesAfter: processCount(finalProcesses),
      newProviderProcessCount: newProcessCount(
        baselineProcesses,
        finalProcesses,
      ),
    },
    totalMs: milliseconds(performance.now() - integrationStartedAt),
  }
  await writeEvidence(evidence)
  if (failureCode !== undefined || !cleanupPassed) process.exitCode = 1
}

async function launchHost(
  workspace: string,
  databasePath: string,
  hostVersion: string,
): Promise<RunningLocalCodexHost> {
  return await startLocalCodexHost({
    allowedWorkspaceRoots: [workspace],
    allowedOrigins: [],
    hostVersion,
    databasePath,
    executable: process.env.CODETETHER_CODEX_PATH ?? 'codex',
    disableHooks: true,
    ephemeralThreads: false,
    maxConversations: 8,
    port: 0,
  })
}

async function requireProviders(
  host: RunningLocalCodexHost,
): Promise<CodeTetherClient> {
  const client = new CodeTetherClient({ baseUrl: host.baseUrl })
  const bootstrap = await client.bootstrap()
  const providers = bootstrap.providers ?? []
  const codex = providers.find((entry) => entry.provider === 'codex')
  const claude = providers.find((entry) => entry.provider === 'claude-code')
  ensure(codex?.availability === 'available', 'codex_unavailable')
  ensure(claude?.availability === 'available', 'claude_unavailable')
  ensure(
    claude.capabilities.streaming && claude.capabilities.resume,
    'claude_capability_mismatch',
  )
  return client
}

async function assertMixedProviderReads(
  client: CodeTetherClient,
  projectId: Parameters<CodeTetherClient['listProjectConversations']>[0],
  codexConversationId: ConversationId,
  claudeConversationId: ConversationId,
): Promise<void> {
  const [list, codex, claude] = await Promise.all([
    client.listProjectConversations(projectId, {
      archived: 'all',
      limit: 100,
    }),
    client.getConversation(codexConversationId),
    client.getConversation(claudeConversationId),
  ])
  ensure(codex.conversation.provider === 'codex', 'codex_read_failed')
  ensure(claude.conversation.provider === 'claude-code', 'claude_read_failed')
  ensure(
    list.conversations.some((entry) => entry.provider === 'codex') &&
      list.conversations.some((entry) => entry.provider === 'claude-code'),
    'mixed_list_failed',
  )
}

async function runObservedTurn(
  client: CodeTetherClient,
  conversationId: ConversationId,
  prompt: string,
): Promise<TurnObservation> {
  const stream = await client.connectEvents()
  const startedAt = performance.now()
  const observationPromise = waitForTurn(stream, conversationId, startedAt)
  try {
    const response = await client.startTurn(conversationId, {
      actionId: actionId('turn'),
      input: { type: 'text', text: prompt },
    })
    const startAccepted = milliseconds(performance.now() - startedAt)
    const observation = await observationPromise
    ensure(
      observation.terminal.turnId === response.data.turn.turnId,
      'turn_identity_mismatch',
    )
    const detail = await client.getConversation(conversationId)
    const finalMessage = finalMessageForTurn(detail, response.data.turn.turnId)
    return {
      finalMessage,
      eventCounts: eventSummary(observation.events),
      startedToolKinds: toolKindsFor(observation.events, 'tool.started'),
      completedToolKinds: toolKindsFor(observation.events, 'tool.completed'),
      timingsMs: {
        startAccepted,
        firstToken: observation.firstTokenMs,
        complete: observation.completeMs,
      },
    }
  } catch (error) {
    await stream.close().catch(() => undefined)
    await observationPromise.catch(() => undefined)
    throw error
  }
}

function toolKindsFor(
  events: readonly HostEventEnvelope[],
  type: 'tool.started' | 'tool.completed',
): string[] {
  const kinds: string[] = []
  for (const event of events) {
    if (event.type !== type) continue
    const kind = event.payload.kind
    if (typeof kind === 'string') kinds.push(kind)
  }
  return kinds
}

async function waitForTurn(
  stream: CodeTetherEventStream,
  conversationId: ConversationId,
  startedAt: number,
): Promise<{
  readonly events: readonly HostEventEnvelope[]
  readonly terminal: HostEventEnvelope
  readonly firstTokenMs: number
  readonly completeMs: number
}> {
  const events: HostEventEnvelope[] = []
  const iterator = stream[Symbol.asyncIterator]()
  const deadline = Date.now() + turnTimeoutMs
  let firstTokenMs: number | undefined
  try {
    while (Date.now() < deadline) {
      const result = await nextBefore(iterator, deadline - Date.now())
      ensure(!result.done, 'event_stream_ended')
      const event = result.value
      if (event.conversationId !== conversationId) continue
      events.push(event)
      if (event.type === 'message.delta' && firstTokenMs === undefined) {
        firstTokenMs = milliseconds(performance.now() - startedAt)
      }
      if (
        event.type === 'turn.completed' ||
        event.type === 'turn.failed' ||
        event.type === 'turn.interrupted'
      ) {
        if (event.type === 'turn.failed') {
          throw new IntegrationFailure(event.payload.error.code)
        }
        ensure(event.type === 'turn.completed', 'turn_interrupted')
        ensure(firstTokenMs !== undefined, 'streaming_not_observed')
        return {
          events,
          terminal: event,
          firstTokenMs,
          completeMs: milliseconds(performance.now() - startedAt),
        }
      }
    }
    throw new IntegrationFailure('turn_timeout')
  } finally {
    await stream.close()
  }
}

async function nextBefore<T>(
  iterator: AsyncIterator<T>,
  timeoutMs: number,
): Promise<IteratorResult<T>> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new IntegrationFailure('event_timeout')),
          Math.max(1, timeoutMs),
        )
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function finalMessageForTurn(
  detail: GetConversationResponse,
  turnId: string,
): string {
  const message = detail.runtime.turns.find(
    (turn) => turn.turnId === turnId,
  )?.finalMessage
  ensure(typeof message === 'string', 'final_message_missing')
  return message
}

async function createTemporaryFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), temporaryPrefix))
  try {
    assertOutsideRepository(root)
    await Promise.all([
      mkdir(join(root, 'data'), { recursive: true }),
      mkdir(join(root, 'workspace'), { recursive: true }),
    ])
    await Promise.all([
      writeFile(
        join(root, 'workspace', 'AGENTS.md'),
        '# Phase 5A Real Integration\n\n- Work only in this directory.\n- Do not use tools unless explicitly asked.\n',
        'utf8',
      ),
      writeFile(
        join(root, 'workspace', 'README.md'),
        '# Disposable Claude Code integration workspace\n',
        'utf8',
      ),
    ])
    return root
  } catch (error) {
    await removeTemporaryFixture(root).catch(() => undefined)
    throw error
  }
}

async function removeTemporaryFixture(path: string): Promise<void> {
  const canonicalTemporaryRoot = await realpath(tmpdir())
  const canonicalTarget = await realpath(path)
  const metadata = await lstat(canonicalTarget)
  const relation = relative(canonicalTemporaryRoot, canonicalTarget)
  ensure(
    !metadata.isSymbolicLink() &&
      !relation.includes('\\') &&
      !relation.includes('/') &&
      relation.startsWith(temporaryPrefix),
    'unsafe_cleanup_path',
  )
  await rm(canonicalTarget, {
    recursive: true,
    force: false,
    maxRetries: 10,
    retryDelay: 100,
  })
}

function assertOutsideRepository(path: string): void {
  const relation = relative(repositoryRoot, path)
  ensure(
    isAbsolute(path) &&
      relation !== '' &&
      (relation.startsWith('..') || isAbsolute(relation)),
    'fixture_inside_repository',
  )
}

async function closeHost(
  host: RunningLocalCodexHost,
  port: number,
): Promise<void> {
  await host.close()
  await waitForPortClosed(port)
}

function portOf(host: RunningLocalCodexHost): number {
  const port = Number(new URL(host.baseUrl).port)
  ensure(Number.isSafeInteger(port) && port > 0, 'host_port_invalid')
  return port
}

async function waitForPortClosed(port: number): Promise<void> {
  const deadline = performance.now() + 15_000
  while (performance.now() < deadline) {
    if (!(await isListening(port))) return
    await delay(100)
  }
  throw new IntegrationFailure('host_port_not_released')
}

async function isListening(port: number): Promise<boolean> {
  return await new Promise((resolveListening) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.setTimeout(300)
    socket.once('connect', () => {
      socket.destroy()
      resolveListening(true)
    })
    const closed = () => {
      socket.destroy()
      resolveListening(false)
    }
    socket.once('timeout', closed)
    socket.once('error', closed)
  })
}

async function readProviderProcesses(): Promise<ProcessSnapshot> {
  const powershell = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
  const script = String.raw`
$processes = @(Get-Process -Name claude,codex -ErrorAction SilentlyContinue | ForEach-Object {
  [pscustomobject]@{ name = [string]$_.ProcessName; pid = [int]$_.Id }
})
[pscustomobject]@{ processes = @($processes) } | ConvertTo-Json -Compress -Depth 3
`
  const result = await execFileAsync(
    powershell,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 },
  )
  const parsed = JSON.parse(result.stdout) as {
    readonly processes?: readonly {
      readonly name?: unknown
      readonly pid?: unknown
    }[]
  }
  const claude = new Set<number>()
  const codex = new Set<number>()
  for (const entry of parsed.processes ?? []) {
    if (!Number.isSafeInteger(entry.pid)) continue
    if (entry.name === 'claude') claude.add(entry.pid as number)
    if (entry.name === 'codex') codex.add(entry.pid as number)
  }
  return { claude, codex }
}

async function readClaudeProcessIds(): Promise<ReadonlySet<number>> {
  return (await readProviderProcesses()).claude
}

async function waitForNoNewClaudeProcesses(
  baseline: ReadonlySet<number>,
): Promise<void> {
  const deadline = performance.now() + 15_000
  while (performance.now() < deadline) {
    if (differenceCount(await readClaudeProcessIds(), baseline) === 0) return
    await delay(100)
  }
  throw new IntegrationFailure('claude_process_not_released')
}

async function waitForNoNewProviderProcesses(
  baseline: ProcessSnapshot,
): Promise<void> {
  const deadline = performance.now() + 15_000
  while (performance.now() < deadline) {
    if (newProcessCount(baseline, await readProviderProcesses()) === 0) return
    await delay(100)
  }
  throw new IntegrationFailure('provider_process_not_released')
}

function differenceCount(
  current: ReadonlySet<number>,
  baseline: ReadonlySet<number>,
): number {
  return [...current].filter((value) => !baseline.has(value)).length
}

function processCount(snapshot: ProcessSnapshot): number {
  return snapshot.claude.size + snapshot.codex.size
}

function newProcessCount(
  baseline: ProcessSnapshot,
  current: ProcessSnapshot,
): number {
  return (
    differenceCount(current.claude, baseline.claude) +
    differenceCount(current.codex, baseline.codex)
  )
}

function eventSummary(
  events: readonly HostEventEnvelope[],
): Record<string, number> {
  const summary: Record<string, number> = {}
  for (const event of events) {
    summary[event.type] = (summary[event.type] ?? 0) + 1
  }
  return summary
}

function actionId(label: string): ReturnType<typeof ActionIdSchema.parse> {
  return ActionIdSchema.parse(
    `act_claude_real_${label}_${randomUUID().replaceAll('-', '')}`,
  )
}

async function readHostVersion(): Promise<string> {
  const packageJson = JSON.parse(
    await readFile(
      resolve(repositoryRoot, 'apps', 'host', 'package.json'),
      'utf8',
    ),
  ) as { readonly version?: unknown }
  ensure(
    typeof packageJson.version === 'string' && packageJson.version.length > 0,
    'host_version_invalid',
  )
  return packageJson.version
}

async function writeEvidence(evidence: unknown): Promise<void> {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`
  const configured = process.env[outputEnvironmentName]
  if (configured !== undefined) {
    ensure(
      configured.length > 0 && isAbsolute(configured),
      'output_path_invalid',
    )
    const outputPath = resolve(configured)
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, serialized, 'utf8')
  }
  process.stdout.write(serialized)
}

function safeFailureCode(error: unknown): string {
  if (error instanceof IntegrationFailure) return error.safeCode
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^provider_[a-z_]+$/u.test(error.code)
  ) {
    return error.code
  }
  return 'integration_failed'
}

function ensure(condition: unknown, safeCode: string): asserts condition {
  if (!condition) throw new IntegrationFailure(safeCode)
}

function milliseconds(value: number): number {
  return Number(value.toFixed(3))
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolveDelay) =>
    setTimeout(resolveDelay, milliseconds),
  )
}

await run().catch(async () => {
  const evidence = {
    schemaVersion: 1,
    phase: '5A',
    integration: 'real-claude-code',
    realProvider: true,
    status: 'failed',
    failedStage: 'evidence',
    errorCode: 'evidence_write_failed',
  }
  process.stderr.write(`${JSON.stringify(evidence)}\n`)
  process.exitCode = 1
})
