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
import { freemem, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import {
  CLAUDE_CODE_EFFORT_LEVELS,
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
  type ProjectId,
  type ProviderCapabilities,
  type ProviderDescriptor,
} from '@codetether/protocol'

import {
  startLocalCodexHost,
  type RunningLocalCodexHost,
} from './api/local-codex-host.js'

const execFileAsync = promisify(execFile)
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const temporaryPrefix = 'codetether-claude-capability-integration-'
const outputEnvironmentName = 'CODETETHER_CLAUDE_CAPABILITY_OUTPUT'
const turnTimeoutMs = 300_000
const fourWayMinimumFreeBytes = 8 * 1024 * 1024 * 1024

interface ProcessEntry {
  readonly name: 'claude' | 'codex'
  readonly pid: number
  readonly parentPid: number
}

interface ProcessSnapshot {
  readonly claude: ReadonlyMap<number, ProcessEntry>
  readonly codex: ReadonlyMap<number, ProcessEntry>
}

interface ToolObservation {
  readonly itemId: string
  readonly kind: string
  readonly name: string
  readonly command?: string
}

interface TurnObservation {
  readonly finalMessage: string
  readonly events: readonly HostEventEnvelope[]
  readonly eventCounts: Record<string, number>
  readonly startedTools: readonly ToolObservation[]
  readonly completedTools: readonly ToolObservation[]
  readonly timingsMs: {
    readonly startAccepted: number
    readonly firstToken: number
    readonly complete: number
  }
}

interface ConcurrentConversation {
  readonly conversationId: ConversationId
  readonly expectedReply: string
  readonly fixtureName: string
  readonly prompt: string
}

interface ConcurrencyResult {
  readonly classification: 'REAL'
  readonly attempted: true
  readonly requested: number
  readonly completed: number
  readonly passed: boolean
  readonly eventIsolation: boolean
  readonly stableToolIdentity: boolean
  readonly maxNewClaudeProcessCount: number
  readonly directlyOwnedClaudeObserved: boolean
  readonly providerReleasedAfterCompletion: boolean
  readonly safeErrorCodes: readonly string[]
}

class IntegrationFailure extends Error {
  constructor(readonly safeCode: string) {
    super('Real Claude Code capability integration failed.')
  }
}

async function run(): Promise<void> {
  const integrationStartedAt = performance.now()
  const testedAt = new Date().toISOString()
  let stage = 'preflight'
  let failedStage: string | undefined
  let failureCode: string | undefined
  let temporaryRoot: string | undefined
  let host: RunningLocalCodexHost | undefined
  const usedPorts = new Set<number>()
  let baselineProcesses: ProcessSnapshot = emptyProcessSnapshot()
  let result: Record<string, unknown> | undefined
  let providerEvidence: Record<string, unknown> = {
    classification: 'NOT OBSERVED',
    testedVersion: CLAUDE_CODE_TESTED_VERSION,
  }

  try {
    ensure(process.platform === 'win32', 'windows_required')
    requireOutputPath()
    baselineProcesses = await readProviderProcesses()
    const buildIdentity = await readBuildIdentity()

    stage = 'claude_detection'
    const detectionStartedAt = performance.now()
    const detection = await detectClaudeCode()
    providerEvidence = {
      classification: 'REAL',
      status: detection.status,
      testedVersion: CLAUDE_CODE_TESTED_VERSION,
      ...('version' in detection ? { version: detection.version } : {}),
      timingsMs: {
        wall: milliseconds(performance.now() - detectionStartedAt),
        probe: detection.durationMs,
      },
    }
    ensure(detection.status === 'available', `detection_${detection.status}`)

    temporaryRoot = await createTemporaryFixture()
    const workspace = join(temporaryRoot, 'workspace')
    const databasePath = join(temporaryRoot, 'data', 'codetether.sqlite3')
    const hostVersion = await readHostVersion()
    const toolMarker = publicMarker('TOOL')
    const grepMarker = publicMarker('GREP')
    const memoryMarker = publicMarker('RESUME')
    const globFileName = `phase5b-glob-${randomUUID().slice(0, 8)}.txt`
    const grepFileName = `phase5b-grep-${randomUUID().slice(0, 8)}.txt`
    await writeFile(
      join(workspace, 'phase5b-read-search-fixture.txt'),
      `Disposable provider capability evidence.\n${toolMarker}\n`,
      'utf8',
    )
    await writeFile(
      join(workspace, globFileName),
      'Disposable Glob evidence.\n',
      'utf8',
    )
    await writeFile(
      join(workspace, grepFileName),
      `Disposable Grep evidence.\n${grepMarker}\n`,
      'utf8',
    )

    stage = 'initial_host'
    host = await launchHost(workspace, databasePath, hostVersion)
    usedPorts.add(portOf(host))
    let client = new CodeTetherClient({ baseUrl: host.baseUrl })
    let providerDescriptors = await requireCapabilities(client)
    const initialEpoch = host.epoch

    const project = await client.createProject({
      actionId: actionId('project'),
      path: workspace,
      name: 'Phase 5B Claude Capability Integration',
    })
    const projectId = project.data.project.projectId

    stage = 'effort_matrix'
    const effortResults: Record<string, unknown>[] = []
    let completedTurnCount = 0
    for (const effort of CLAUDE_CODE_EFFORT_LEVELS) {
      const expectedReply = `PHASE5B_EFFORT_${effort.toUpperCase()}_OK`
      const conversation = await client.createConversation({
        actionId: actionId(`effort-${effort}`),
        provider: 'claude-code',
        projectId,
        reasoning: effort,
      })
      ensure(
        conversation.data.conversation.reasoning === effort,
        `effort_${effort}_not_persisted`,
      )
      const observation = await runObservedTurn(
        client,
        conversation.data.conversation.conversationId,
        `Do not use tools. Reply exactly: ${expectedReply}`,
      )
      ensure(
        observation.finalMessage.trim() === expectedReply,
        `effort_${effort}_reply_mismatch`,
      )
      completedTurnCount += 1
      effortResults.push({
        classification: 'REAL',
        effort,
        passed: true,
        streamingObserved: (observation.eventCounts['message.delta'] ?? 0) > 0,
        timingsMs: observation.timingsMs,
      })
      await waitForNoNewClaudeProcesses(baselineProcesses.claude)
    }

    stage = 'tool_identity'
    const globConversation = await client.createConversation({
      actionId: actionId('glob-conversation'),
      provider: 'claude-code',
      projectId,
      reasoning: 'low',
    })
    const grepConversation = await client.createConversation({
      actionId: actionId('grep-conversation'),
      provider: 'claude-code',
      projectId,
      reasoning: 'low',
    })
    const toolConversation = await client.createConversation({
      actionId: actionId('read-conversation'),
      provider: 'claude-code',
      projectId,
      reasoning: 'low',
    })
    const globObservation = await runObservedTurn(
      client,
      globConversation.data.conversation.conversationId,
      [
        'Use only the Glob tool to find the exact filename matching phase5b-glob-*.txt.',
        'Do not use Read or Grep.',
        'Reply with only the exact filename returned by Glob.',
      ].join(' '),
    )
    ensure(
      globObservation.finalMessage.trim() === globFileName,
      'glob_result_mismatch',
    )
    const grepObservation = await runObservedTurn(
      client,
      grepConversation.data.conversation.conversationId,
      [
        `Use only the Grep tool to find which file contains ${grepMarker}.`,
        'Do not use Read or Glob.',
        'Reply with only the matching filename.',
      ].join(' '),
    )
    ensure(
      grepObservation.finalMessage.trim() === grepFileName,
      'grep_result_mismatch',
    )
    const readObservation = await runObservedTurn(
      client,
      toolConversation.data.conversation.conversationId,
      [
        'Use only the Read tool to read phase5b-read-search-fixture.txt.',
        'Do not use Glob or Grep.',
        'Reply with only the marker from that file.',
      ].join(' '),
    )
    ensure(
      readObservation.finalMessage.trim() === toolMarker,
      'read_result_mismatch',
    )
    const toolObservations = [globObservation, grepObservation, readObservation]
    const toolIdentity = assertToolIdentity(toolObservations)
    completedTurnCount += toolObservations.length
    await waitForNoNewClaudeProcesses(baselineProcesses.claude)

    stage = 'mixed_provider'
    const codexDescriptor = providerDescriptors.find(
      (entry) => entry.provider === 'codex',
    )
    ensure(codexDescriptor?.availability === 'available', 'codex_unavailable')
    const codexConversation = await client.createConversation({
      actionId: actionId('codex-conversation'),
      provider: 'codex',
      projectId,
    })
    const claudeMemoryConversation = await client.createConversation({
      actionId: actionId('memory-conversation'),
      provider: 'claude-code',
      projectId,
      reasoning: 'low',
    })
    await assertMixedProviderReads(
      client,
      projectId,
      codexConversation.data.conversation.conversationId,
      claudeMemoryConversation.data.conversation.conversationId,
    )
    const codexObservation = await runObservedTurn(
      client,
      codexConversation.data.conversation.conversationId,
      'Reply exactly: PHASE5B_CODEX_REGRESSION_OK',
    )
    ensure(
      codexObservation.finalMessage.trim() === 'PHASE5B_CODEX_REGRESSION_OK',
      'codex_reply_mismatch',
    )
    completedTurnCount += 1

    stage = 'resume_seed'
    const memoryConversationId =
      claudeMemoryConversation.data.conversation.conversationId
    const seedObservation = await runObservedTurn(
      client,
      memoryConversationId,
      [
        `Remember marker: ${memoryMarker}`,
        'Keep it only in the native Conversation context and do not write it to a file.',
        'Do not use tools. Reply exactly: MARKER_STORED',
      ].join(' '),
    )
    ensure(
      seedObservation.finalMessage.trim() === 'MARKER_STORED',
      'resume_seed_mismatch',
    )
    completedTurnCount += 1
    await waitForNoNewClaudeProcesses(baselineProcesses.claude)

    stage = 'native_resume_cycles'
    const resumeResults: Record<string, unknown>[] = []
    let previousEpoch = initialEpoch
    let coldOrganizationEvidence: Record<string, unknown> | undefined
    let toolTurnResumeEvidence: Record<string, unknown> | undefined
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      const closingPort = portOf(host)
      await closeHost(host, closingPort)
      host = undefined
      await waitForNoNewProviderProcesses(baselineProcesses)

      const restartStartedAt = performance.now()
      host = await launchHost(workspace, databasePath, hostVersion)
      usedPorts.add(portOf(host))
      ensure(host.epoch !== previousEpoch, 'host_epoch_not_changed')
      previousEpoch = host.epoch
      client = new CodeTetherClient({ baseUrl: host.baseUrl })
      providerDescriptors = await requireCapabilities(client)
      const hostRestartMs = milliseconds(performance.now() - restartStartedAt)

      if (cycle === 1) {
        coldOrganizationEvidence = await verifyColdOrganization(
          client,
          projectId,
          memoryConversationId,
          memoryMarker,
        )
        const toolResumeObservation = await runObservedTurn(
          client,
          toolConversation.data.conversation.conversationId,
          [
            'Return the exact marker you found with tools in the previous Turn.',
            'Do not use tools. Reply with only that marker.',
          ].join(' '),
        )
        ensure(
          toolResumeObservation.finalMessage.trim() === toolMarker,
          'tool_turn_resume_marker_mismatch',
        )
        completedTurnCount += 1
        toolTurnResumeEvidence = {
          classification: 'REAL',
          fullHostCloseAndRelaunch: true,
          nativeContextRetained: true,
          markerRetained: true,
          streamingObserved:
            (toolResumeObservation.eventCounts['message.delta'] ?? 0) > 0,
          turnTimingsMs: toolResumeObservation.timingsMs,
        }
        await waitForNoNewClaudeProcesses(baselineProcesses.claude)
      }

      const observation = await runObservedTurn(
        client,
        memoryConversationId,
        [
          'Return the marker I asked you to remember in this Conversation.',
          'Do not use tools. Reply with only that marker.',
        ].join(' '),
      )
      ensure(
        observation.finalMessage.trim() === memoryMarker,
        `resume_cycle_${cycle}_marker_mismatch`,
      )
      completedTurnCount += 1
      resumeResults.push({
        classification: 'REAL',
        cycle,
        fullHostCloseAndRelaunch: true,
        hostEpochChanged: true,
        markerRetained: true,
        streamingObserved: (observation.eventCounts['message.delta'] ?? 0) > 0,
        hostRestartMs,
        turnTimingsMs: observation.timingsMs,
      })
      await waitForNoNewClaudeProcesses(baselineProcesses.claude)
    }

    stage = 'concurrency_two'
    const twoConversations = await createConcurrentConversations(
      client,
      projectId,
      workspace,
      2,
      'two',
    )
    const concurrencyTwo = await runConcurrentBatch(
      client,
      twoConversations,
      baselineProcesses,
    )
    ensure(concurrencyTwo.passed, 'concurrency_two_failed')
    completedTurnCount += concurrencyTwo.completed

    stage = 'concurrency_four'
    const freeMemoryBytes = freemem()
    let concurrencyFour:
      | ConcurrencyResult
      | {
          readonly classification: 'NOT OBSERVED'
          readonly attempted: false
          readonly reason: string
        }
    if (freeMemoryBytes >= fourWayMinimumFreeBytes) {
      const fourConversations = await createConcurrentConversations(
        client,
        projectId,
        workspace,
        4,
        'four',
      )
      concurrencyFour = await runConcurrentBatch(
        client,
        fourConversations,
        baselineProcesses,
      )
      ensure(concurrencyFour.eventIsolation, 'concurrency_four_routing_failed')
      ensure(
        concurrencyFour.providerReleasedAfterCompletion,
        'concurrency_four_cleanup_failed',
      )
      ensure(
        concurrencyFour.directlyOwnedClaudeObserved,
        'concurrency_four_ownership_not_observed',
      )
      completedTurnCount += concurrencyFour.completed
    } else {
      concurrencyFour = {
        classification: 'NOT OBSERVED',
        attempted: false,
        reason: 'bounded_resource_guard',
      }
    }

    stage = 'durable_attention'
    const attention = await client.listAttention({
      projectId,
      type: 'completed_review',
      status: 'open',
      limit: 100,
    })
    ensure(
      attention.items.length === completedTurnCount,
      'completed_attention_count_mismatch',
    )
    ensure(
      new Set(attention.items.map((item) => item.attentionId)).size ===
        attention.items.length,
      'duplicate_completed_attention',
    )

    const mixedList = await client.listProjectConversations(projectId, {
      archived: 'all',
      limit: 100,
    })
    ensure(
      mixedList.conversations.some((item) => item.provider === 'codex') &&
        mixedList.conversations.some((item) => item.provider === 'claude-code'),
      'mixed_provider_list_failed',
    )

    result = {
      status: 'passed',
      buildIdentity,
      capabilities: capabilityEvidence(
        requireClaudeDescriptor(providerDescriptors),
      ),
      effortControl: {
        classification: 'REAL',
        allDocumentedLevelsPassed: true,
        results: effortResults,
      },
      toolNormalization: {
        classification: 'REAL',
        passed: true,
        observedKinds: toolIdentity.kinds,
        observedNames: toolIdentity.names,
        stableStartedCompletedIdentity: true,
        structuredCommandPresentation: true,
        outputObserved: toolObservations.some(
          (observation) => (observation.eventCounts['tool.output'] ?? 0) > 0,
        ),
      },
      nativeResume: {
        classification: 'REAL',
        repetitions: resumeResults,
        toolTurnAfterRestart: toolTurnResumeEvidence,
      },
      coldConversation: coldOrganizationEvidence,
      concurrency: {
        two: concurrencyTwo,
        four: concurrencyFour,
        supportedFloor:
          concurrencyFour.classification === 'REAL' && concurrencyFour.passed
            ? 4
            : 2,
        freeMemoryMiBAtDecision: Math.floor(freeMemoryBytes / (1024 * 1024)),
      },
      mixedProvider: {
        classification: 'REAL',
        sameProject: true,
        codexTurnPassed: true,
        claudeTurnPassed: true,
        codexStreamingObserved:
          (codexObservation.eventCounts['message.delta'] ?? 0) > 0,
      },
      attention: {
        classification: 'REAL',
        completedAttentionCount: attention.items.length,
        uniqueIdentities: true,
      },
    }
  } catch (error) {
    failedStage = stage
    failureCode = safeFailureCode(error)
  }

  stage = 'cleanup'
  let hostClosed = true
  let portsReleased = true
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
    portsReleased = false
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

  const finalProcesses = await readProviderProcesses().catch(
    () => baselineProcesses,
  )
  const cleanupPassed =
    hostClosed &&
    portsReleased &&
    providerProcessesReleased &&
    temporaryFixtureRemoved
  const evidence = {
    schemaVersion: 1,
    phase: '5B',
    integration: 'real-claude-code-capability-expansion',
    testedAt,
    realProvider: true,
    provider: providerEvidence,
    ...(failureCode === undefined && cleanupPassed
      ? result
      : {
          status: 'failed',
          failedStage: failedStage ?? stage,
          errorCode: failureCode ?? 'cleanup_failed',
        }),
    unsupportedCapabilities: {
      edit: {
        classification: 'UNSUPPORTED',
        reason: 'restricted_product_profile',
      },
      shell: {
        classification: 'UNSUPPORTED',
        reason: 'restricted_product_profile',
      },
      diff: {
        classification: 'UNSUPPORTED',
        reason: 'no_reliable_canonical_diff_primitive',
      },
      interrupt: {
        classification: 'UNSUPPORTED',
        reason: 'exact_process_interrupt_left_descendant_and_reissued_work',
      },
      approval: {
        classification: 'UNSUPPORTED',
        reason: 'no_proven_reliable_identity_bound_stdio_callback',
      },
      modelSelection: {
        classification: 'UNSUPPORTED',
        reason: 'no_stable_machine_readable_model_catalogue',
      },
    },
    cleanup: {
      passed: cleanupPassed,
      hostClosed,
      portsReleased,
      providerProcessesReleased,
      temporaryFixtureRemoved,
      providerProcessesBefore: processCount(baselineProcesses),
      providerProcessesAfter: processCount(finalProcesses),
      newProviderProcessCount: newProcessCount(
        baselineProcesses,
        finalProcesses,
      ),
      testedPortCount: usedPorts.size,
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

async function requireCapabilities(
  client: CodeTetherClient,
): Promise<readonly ProviderDescriptor[]> {
  const bootstrap = await client.bootstrap()
  const providers = bootstrap.providers ?? []
  const claude = requireClaudeDescriptor(providers)
  ensure(claude.availability === 'available', 'claude_unavailable')
  const expected: ProviderCapabilities = {
    streaming: true,
    resume: true,
    interrupt: false,
    approvals: false,
    fileRead: true,
    fileEdit: false,
    shell: false,
    search: true,
    diff: false,
    toolEvents: true,
    modelSelection: false,
    reasoningControl: true,
  }
  for (const [capability, value] of Object.entries(expected)) {
    ensure(
      claude.capabilities[capability as keyof ProviderCapabilities] === value,
      `claude_capability_${capability}_mismatch`,
    )
  }
  ensure(claude.models === undefined, 'claude_model_catalogue_unexpected')
  ensure(
    claude.reasoningOptions?.map((option) => option.id).join(',') ===
      CLAUDE_CODE_EFFORT_LEVELS.join(','),
    'claude_effort_options_mismatch',
  )
  return providers
}

function requireClaudeDescriptor(
  providers: readonly ProviderDescriptor[],
): ProviderDescriptor {
  const descriptor = providers.find(
    (provider) => provider.provider === 'claude-code',
  )
  ensure(descriptor !== undefined, 'claude_descriptor_missing')
  return descriptor
}

function capabilityEvidence(descriptor: ProviderDescriptor): unknown {
  return {
    classification: 'REAL',
    availability: descriptor.availability,
    version: descriptor.version,
    capabilities: descriptor.capabilities,
    reasoningLabelPresent: descriptor.reasoningLabel !== undefined,
    reasoningOptions: descriptor.reasoningOptions?.map((option) => option.id),
  }
}

async function assertMixedProviderReads(
  client: CodeTetherClient,
  projectId: ProjectId,
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
    'mixed_provider_list_failed',
  )
}

async function verifyColdOrganization(
  client: CodeTetherClient,
  projectId: ProjectId,
  conversationId: ConversationId,
  inputMarker: string,
): Promise<Record<string, unknown>> {
  const before = await readClaudeProcessIds()
  const title = `Phase 5B Cold Resume ${randomUUID()
    .replaceAll('-', '')
    .slice(0, 8)}`
  const renamed = await client.renameConversation(conversationId, {
    actionId: actionId('cold-rename'),
    title,
  })
  ensure(
    renamed.data.conversation.titleSource === 'manual',
    'cold_rename_failed',
  )
  const pinned = await client.pinConversation(conversationId, {
    actionId: actionId('cold-pin'),
  })
  ensure(pinned.data.conversation.pinnedAt !== undefined, 'cold_pin_failed')
  const archived = await client.archiveConversation(conversationId, {
    actionId: actionId('cold-archive'),
  })
  ensure(
    archived.data.conversation.archivedAt !== undefined &&
      archived.data.conversation.pinnedAt === undefined,
    'cold_archive_failed',
  )
  const [titleSearch, inputSearch, detail] = await Promise.all([
    client.searchProjectConversations(projectId, {
      query: title,
      archive: 'all',
      provider: 'claude-code',
    }),
    client.searchProjectConversations(projectId, {
      query: inputMarker,
      archive: 'all',
      provider: 'claude-code',
    }),
    client.getConversation(conversationId),
  ])
  ensure(
    titleSearch.results.some(
      (result) =>
        result.conversation.conversationId === conversationId &&
        result.matchedField === 'title',
    ),
    'cold_title_search_failed',
  )
  ensure(
    inputSearch.results.some(
      (result) =>
        result.conversation.conversationId === conversationId &&
        result.matchedField === 'user_input',
    ),
    'cold_input_search_failed',
  )
  ensure(detail.conversation.provider === 'claude-code', 'cold_detail_failed')
  const unarchived = await client.unarchiveConversation(conversationId, {
    actionId: actionId('cold-unarchive'),
  })
  ensure(
    unarchived.data.conversation.archivedAt === undefined,
    'cold_unarchive_failed',
  )
  const after = await readClaudeProcessIds()
  ensure(sameProcessIds(before, after), 'cold_operation_started_claude')
  return {
    classification: 'REAL',
    rename: true,
    pin: true,
    archive: true,
    unarchive: true,
    titleSearch: true,
    userInputSearch: true,
    detailRead: true,
    noClaudeProcessStarted: true,
  }
}

async function createConcurrentConversations(
  client: CodeTetherClient,
  projectId: ProjectId,
  workspace: string,
  count: number,
  label: string,
): Promise<readonly ConcurrentConversation[]> {
  const values: ConcurrentConversation[] = []
  for (let index = 0; index < count; index += 1) {
    const expectedReply = `PHASE5B_CONCURRENT_${label.toUpperCase()}_${index}_OK`
    const fileName = `concurrency-${label}-${index}.txt`
    await writeFile(join(workspace, fileName), `${expectedReply}\n`, 'utf8')
    const created = await client.createConversation({
      actionId: actionId(`concurrency-${label}-${index}`),
      provider: 'claude-code',
      projectId,
      reasoning: 'low',
    })
    values.push({
      conversationId: created.data.conversation.conversationId,
      expectedReply,
      fixtureName: fileName,
      prompt: [
        `Use Read to read ${fileName} in the current workspace.`,
        'Do not use any other tool.',
        'Reply with only the exact line from the file.',
      ].join(' '),
    })
  }
  return values
}

async function runConcurrentBatch(
  client: CodeTetherClient,
  conversations: readonly ConcurrentConversation[],
  integrationBaseline: ProcessSnapshot,
): Promise<ConcurrencyResult> {
  const batchBaseline = await readProviderProcesses()
  const routeStream = await client.connectEvents()
  const routeObservationPromise = collectConcurrentEvents(
    routeStream,
    new Set(conversations.map((conversation) => conversation.conversationId)),
  )
  let monitoring = true
  let maxNewClaudeProcessCount = 0
  let directlyOwnedClaudeObserved = false
  const monitor = (async () => {
    while (monitoring) {
      const snapshot = await readProviderProcesses().catch(() => batchBaseline)
      const newClaude = newProcessEntries(
        integrationBaseline.claude,
        snapshot.claude,
      )
      maxNewClaudeProcessCount = Math.max(
        maxNewClaudeProcessCount,
        newClaude.length,
      )
      if (newClaude.some((entry) => entry.parentPid === process.pid)) {
        directlyOwnedClaudeObserved = true
      }
      await delay(25)
    }
  })()
  let settled: readonly PromiseSettledResult<TurnObservation>[]
  try {
    settled = await Promise.allSettled(
      conversations.map(async (conversation) => {
        const observation = await runObservedTurn(
          client,
          conversation.conversationId,
          conversation.prompt,
        )
        ensure(
          observation.finalMessage.trim() === conversation.expectedReply,
          'concurrency_reply_mismatch',
        )
        assertReadToolIdentity(observation)
        return observation
      }),
    )
  } finally {
    await delay(50)
    await routeStream.close().catch(() => undefined)
  }
  const routedEvents = await routeObservationPromise
  monitoring = false
  await monitor

  const errors = settled
    .filter(
      (entry): entry is PromiseRejectedResult => entry.status === 'rejected',
    )
    .map((entry) => safeFailureCode(entry.reason))
  const successful = settled.filter(
    (entry): entry is PromiseFulfilledResult<TurnObservation> =>
      entry.status === 'fulfilled',
  )
  let providerReleasedAfterCompletion = true
  try {
    await waitForNoNewClaudeProcesses(batchBaseline.claude)
  } catch {
    providerReleasedAfterCompletion = false
  }
  const eventIsolation = verifyConcurrentEventIsolation(
    routedEvents,
    conversations,
  )
  const stableToolIdentity =
    successful.length === conversations.length &&
    errors.length === 0 &&
    successful.every((entry) => {
      try {
        assertReadToolIdentity(entry.value)
        return true
      } catch {
        return false
      }
    })
  return {
    classification: 'REAL',
    attempted: true,
    requested: conversations.length,
    completed: successful.length,
    passed:
      successful.length === conversations.length &&
      errors.length === 0 &&
      maxNewClaudeProcessCount > 0 &&
      directlyOwnedClaudeObserved &&
      providerReleasedAfterCompletion &&
      eventIsolation &&
      stableToolIdentity,
    eventIsolation,
    stableToolIdentity,
    maxNewClaudeProcessCount,
    directlyOwnedClaudeObserved,
    providerReleasedAfterCompletion,
    safeErrorCodes: [...new Set(errors)].sort(),
  }
}

async function collectConcurrentEvents(
  stream: CodeTetherEventStream,
  conversationIds: ReadonlySet<ConversationId>,
): Promise<ReadonlyMap<ConversationId, readonly HostEventEnvelope[]>> {
  const events = new Map<ConversationId, HostEventEnvelope[]>()
  for (const conversationId of conversationIds) events.set(conversationId, [])
  for await (const event of stream) {
    if (
      event.conversationId === null ||
      !conversationIds.has(event.conversationId)
    ) {
      continue
    }
    events.get(event.conversationId)?.push(event)
  }
  return events
}

function verifyConcurrentEventIsolation(
  events: ReadonlyMap<ConversationId, readonly HostEventEnvelope[]>,
  conversations: readonly ConcurrentConversation[],
): boolean {
  if (events.size !== conversations.length) return false
  for (const conversation of conversations) {
    const routed = events.get(conversation.conversationId) ?? []
    if (
      routed.length === 0 ||
      routed.some(
        (event) => event.conversationId !== conversation.conversationId,
      ) ||
      routed.filter((event) => event.type === 'turn.started').length !== 1 ||
      routed.filter((event) => event.type === 'turn.completed').length !== 1
    ) {
      return false
    }
    const started = routed.filter((event) => event.type === 'tool.started')
    if (
      started.length === 0 ||
      !started.some(
        (event) =>
          event.payload.kind === 'read' &&
          typeof event.payload.command === 'string' &&
          event.payload.command.includes(conversation.fixtureName),
      )
    ) {
      return false
    }
    const otherFixtures = conversations
      .filter((candidate) => candidate !== conversation)
      .map((candidate) => candidate.fixtureName)
    if (
      started.some((event) =>
        otherFixtures.some(
          (fixture) =>
            typeof event.payload.command === 'string' &&
            event.payload.command.includes(fixture),
        ),
      )
    ) {
      return false
    }
  }
  return true
}

function assertToolIdentity(observations: readonly TurnObservation[]): {
  readonly kinds: readonly string[]
  readonly names: readonly string[]
} {
  const startedById = new Map(
    observations
      .flatMap((observation) => observation.startedTools)
      .map((tool) => [tool.itemId, tool]),
  )
  const completedById = new Map(
    observations
      .flatMap((observation) => observation.completedTools)
      .map((tool) => [tool.itemId, tool]),
  )
  ensure(
    startedById.size ===
      observations.reduce(
        (count, observation) => count + observation.startedTools.length,
        0,
      ),
    'tool_start_duplicate',
  )
  ensure(
    completedById.size ===
      observations.reduce(
        (count, observation) => count + observation.completedTools.length,
        0,
      ),
    'tool_complete_duplicate',
  )
  const outputIds = new Set(
    observations
      .flatMap((observation) => observation.events)
      .filter((event) => event.type === 'tool.output')
      .map((event) => String(event.itemId)),
  )
  ensure(startedById.size >= 3, 'tool_events_missing')
  ensure(outputIds.size >= 1, 'tool_output_missing')
  for (const [itemId, started] of startedById) {
    const completed = completedById.get(itemId)
    ensure(completed !== undefined, 'tool_completion_identity_missing')
    ensure(
      completed.kind === started.kind && completed.name === started.name,
      'tool_identity_changed',
    )
    ensure(started.command !== undefined, 'tool_structured_command_missing')
  }
  for (const itemId of outputIds) {
    ensure(
      startedById.has(itemId) && completedById.has(itemId),
      'tool_output_identity_mismatch',
    )
  }
  const startedTools = observations.flatMap(
    (observation) => observation.startedTools,
  )
  const kinds = [...new Set(startedTools.map((tool) => tool.kind))]
  const names = [...new Set(startedTools.map((tool) => tool.name))]
  ensure(
    kinds.includes('read') && kinds.includes('search'),
    'tool_kind_missing',
  )
  ensure(
    names.length === 1 && names[0] === 'command',
    'tool_name_not_canonical',
  )
  const commands = startedTools.flatMap((tool) =>
    tool.command === undefined ? [] : [tool.command],
  )
  ensure(
    commands.some((command) => command.startsWith('Read ')) &&
      commands.some((command) => command.startsWith('Glob ')) &&
      commands.some((command) => command.startsWith('Grep ')),
    'tool_command_clue_missing',
  )
  return { kinds: kinds.sort(), names: names.sort() }
}

function assertReadToolIdentity(observation: TurnObservation): void {
  const started = observation.startedTools.filter(
    (tool) => tool.kind === 'read',
  )
  const completed = observation.completedTools.filter(
    (tool) => tool.kind === 'read',
  )
  ensure(started.length >= 1 && completed.length >= 1, 'read_tool_missing')
  const completedIds = new Set(completed.map((tool) => tool.itemId))
  ensure(
    started.every(
      (tool) => tool.command !== undefined && completedIds.has(tool.itemId),
    ),
    'read_tool_identity_mismatch',
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
    return {
      finalMessage: finalMessageForTurn(detail, response.data.turn.turnId),
      events: observation.events,
      eventCounts: eventSummary(observation.events),
      startedTools: toolObservations(observation.events, 'tool.started'),
      completedTools: toolObservations(observation.events, 'tool.completed'),
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

function toolObservations(
  events: readonly HostEventEnvelope[],
  type: 'tool.started' | 'tool.completed',
): readonly ToolObservation[] {
  const values: ToolObservation[] = []
  for (const event of events) {
    if (event.type !== type) continue
    values.push({
      itemId: String(event.itemId),
      kind: event.payload.kind ?? 'generic',
      name: event.payload.name,
      ...(typeof event.payload.command === 'string' &&
      event.payload.command.length > 0
        ? { command: event.payload.command }
        : {}),
    })
  }
  return values
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
        [
          '# Phase 5B Real Integration',
          '',
          '- Work only inside this disposable directory.',
          '- Use only the explicitly requested tools.',
          '- Never access parent directories.',
          '',
        ].join('\n'),
        'utf8',
      ),
      writeFile(
        join(root, 'workspace', 'README.md'),
        '# Disposable Claude Code capability workspace\n',
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
$processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -in @('claude.exe', 'codex.exe')
} | ForEach-Object {
  [pscustomobject]@{
    name = [string]($_.Name -replace '\.exe$', '').ToLowerInvariant()
    pid = [int]$_.ProcessId
    parentPid = [int]$_.ParentProcessId
  }
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
      readonly parentPid?: unknown
    }[]
  }
  const claude = new Map<number, ProcessEntry>()
  const codex = new Map<number, ProcessEntry>()
  for (const value of parsed.processes ?? []) {
    if (
      (value.name !== 'claude' && value.name !== 'codex') ||
      !Number.isSafeInteger(value.pid) ||
      !Number.isSafeInteger(value.parentPid)
    ) {
      continue
    }
    const entry: ProcessEntry = {
      name: value.name,
      pid: value.pid as number,
      parentPid: value.parentPid as number,
    }
    if (entry.name === 'claude') claude.set(entry.pid, entry)
    else codex.set(entry.pid, entry)
  }
  return { claude, codex }
}

async function readClaudeProcessIds(): Promise<
  ReadonlyMap<number, ProcessEntry>
> {
  return (await readProviderProcesses()).claude
}

async function waitForNoNewClaudeProcesses(
  baseline: ReadonlyMap<number, ProcessEntry>,
): Promise<void> {
  const deadline = performance.now() + 15_000
  while (performance.now() < deadline) {
    const current = await readClaudeProcessIds()
    if (newProcessEntries(baseline, current).length === 0) return
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

function newProcessEntries(
  baseline: ReadonlyMap<number, ProcessEntry>,
  current: ReadonlyMap<number, ProcessEntry>,
): readonly ProcessEntry[] {
  return [...current.values()].filter((entry) => !baseline.has(entry.pid))
}

function sameProcessIds(
  left: ReadonlyMap<number, ProcessEntry>,
  right: ReadonlyMap<number, ProcessEntry>,
): boolean {
  return (
    left.size === right.size && [...left.keys()].every((pid) => right.has(pid))
  )
}

function processCount(snapshot: ProcessSnapshot): number {
  return snapshot.claude.size + snapshot.codex.size
}

function newProcessCount(
  baseline: ProcessSnapshot,
  current: ProcessSnapshot,
): number {
  return (
    newProcessEntries(baseline.claude, current.claude).length +
    newProcessEntries(baseline.codex, current.codex).length
  )
}

function emptyProcessSnapshot(): ProcessSnapshot {
  return { claude: new Map(), codex: new Map() }
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

function publicMarker(label: string): string {
  return `PHASE5B_${label}_${randomUUID()
    .replaceAll('-', '')
    .slice(0, 16)
    .toUpperCase()}`
}

function actionId(label: string): ReturnType<typeof ActionIdSchema.parse> {
  return ActionIdSchema.parse(
    `act_claude_cap_${label}_${randomUUID().replaceAll('-', '')}`,
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

async function readBuildIdentity(): Promise<string> {
  const [head, status] = await Promise.all([
    execFileAsync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      windowsHide: true,
    }),
    execFileAsync('git', ['status', '--porcelain'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      windowsHide: true,
    }),
  ])
  const revision = head.stdout.trim()
  ensure(/^[0-9a-f]{12}$/u.test(revision), 'git_identity_invalid')
  return `git-${revision}${status.stdout.trim() === '' ? '' : '-dirty'}`
}

function requireOutputPath(): string {
  const configured = process.env[outputEnvironmentName]
  const outputRoot = resolve(repositoryRoot, 'output')
  const target =
    configured === undefined || configured.length === 0
      ? join(
          outputRoot,
          'playwright',
          'phase5b',
          'phase5b-capability-integration.json',
        )
      : resolve(configured)
  ensure(
    configured === undefined ||
      configured.length === 0 ||
      isAbsolute(configured),
    'output_path_invalid',
  )
  const relation = relative(outputRoot, target)
  ensure(
    relation !== '..' &&
      !relation.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
      !isAbsolute(relation),
    'output_path_outside_evidence_root',
  )
  return target
}

async function writeEvidence(evidence: unknown): Promise<void> {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`
  const outputPath = requireOutputPath()
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, serialized, 'utf8')
  process.stdout.write(serialized)
}

function safeFailureCode(error: unknown): string {
  if (error instanceof IntegrationFailure) return error.safeCode
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[a-z][a-z0-9_]+$/u.test(error.code)
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

await run().catch((error: unknown) => {
  const evidence = {
    schemaVersion: 1,
    phase: '5B',
    integration: 'real-claude-code-capability-expansion',
    status: 'failed',
    failedStage: 'evidence',
    errorCode: safeFailureCode(error),
  }
  process.stderr.write(`${JSON.stringify(evidence)}\n`)
  process.exitCode = 1
})
