import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import {
  CodeTetherClient,
  type CodeTetherEventStream,
} from '@codetether/client'
import {
  ActionIdSchema,
  type ApprovalId,
  type AttentionId,
  type AttentionItem,
  type ConversationId,
  type HostEventEnvelope,
} from '@codetether/protocol'

import {
  startLocalCodexHost,
  type RunningLocalCodexHost,
} from './api/local-codex-host.js'
import {
  prepareApprovalWorkspace,
  readWorkspaceExample,
} from './spike-workspace.js'

const execFileAsync = promisify(execFile)
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const terminalEventTypes = new Set([
  'turn.completed',
  'turn.failed',
  'turn.interrupted',
])

interface FirstRunObservation {
  readonly approvalId: ApprovalId
  readonly approvalAttention: AttentionItem & { readonly type: 'approval' }
  readonly completedAttention: AttentionItem & {
    readonly type: 'completed_review'
  }
  readonly conversationId: ConversationId
  readonly events: readonly HostEventEnvelope[]
  readonly timingsMs: {
    readonly approvalAttentionRead: number
    readonly approvalResolveRequest: number
    readonly turnTerminal: number
  }
}

interface IntegrationReport {
  readonly integration: 'passed'
  readonly scenario: 'durable-attention-model'
  readonly epochs: {
    readonly initial: string
    readonly restarted: string
    readonly changed: true
  }
  readonly protocolMethods: {
    readonly http: readonly string[]
    readonly sse: Readonly<Record<string, number>>
  }
  readonly attention: {
    readonly approval: {
      readonly created: true
      readonly decision: 'accept'
      readonly persistedResolvedAfterRestart: true
    }
    readonly completedReview: {
      readonly created: true
      readonly persistedOpenAfterRestart: true
      readonly explicitlyResolved: true
    }
    readonly turnFailed: {
      readonly realCodex: 'Not Observed'
      readonly toolFailureUsedAsTurnFailure: false
    }
  }
  readonly counts: {
    readonly initialEvents: number
    readonly openBeforeRestart: number
    readonly openAfterRestart: number
    readonly openAfterReview: number
    readonly resolvedAfterReview: number
  }
  readonly timingsMs: {
    readonly total: number
    readonly firstHostLaunch: number
    readonly approvalAttentionRead: number
    readonly approvalResolveRequest: number
    readonly turnTerminal: number
    readonly restartHostLaunch: number
    readonly restartAttentionRead: number
    readonly completedReviewResolve: number
  }
  readonly persistence: {
    readonly databaseBytes: number
    readonly temporaryDataRemoved: true
  }
  readonly safety: {
    readonly isolatedWorkspaceUnchanged: true
    readonly providerIdentityPrivate: true
  }
}

async function run(): Promise<void> {
  const integrationStartedAt = performance.now()
  const hostVersion = await readHostVersion()
  const executable = process.env.CODETETHER_CODEX_PATH ?? 'codex'
  const workspace = await prepareApprovalWorkspace(repositoryRoot)
  const beforeExample = await readWorkspaceExample(workspace)
  const beforeStatus = await gitStatus(workspace.root)
  assert.equal(beforeStatus, '', 'Approval fixture must start clean')

  const dataDirectory = await mkdtemp(
    join(tmpdir(), 'codetether-attention-integration-'),
  )
  const databasePath = resolve(dataDirectory, 'codetether.sqlite3')
  assertOutsideRepository(dataDirectory)
  const previousDataDirectory = process.env.CODETETHER_DATA_DIR
  process.env.CODETETHER_DATA_DIR = dataDirectory

  let host: RunningLocalCodexHost | undefined
  let reportWithoutCleanup:
    | (Omit<IntegrationReport, 'persistence'> & {
        readonly persistence: Omit<
          IntegrationReport['persistence'],
          'temporaryDataRemoved'
        >
      })
    | undefined

  try {
    const firstLaunchStartedAt = performance.now()
    host = await launchHost({
      workspace: workspace.root,
      databasePath,
      hostVersion,
      executable,
    })
    const firstHostLaunchMs = performance.now() - firstLaunchStartedAt
    const initialEpoch = host.epoch
    const client = await requireLiveClient(host)
    const machines = (await client.listMachines()).machines
    assert.equal(machines.length, 1)
    const localMachine = machines[0]
    assert.ok(localMachine !== undefined)

    const project = await client.createProject({
      actionId: actionId('project'),
      path: workspace.root,
      name: 'Durable Attention Integration',
    })
    const conversation = await client.createConversation({
      actionId: actionId('conversation'),
      provider: 'codex',
      projectId: project.data.project.projectId,
      machineId: localMachine.machineId,
    })
    const conversationId = conversation.data.conversation.conversationId
    const stream = await client.connectEvents()
    const observationPromise = observeApprovalAndCompletion(
      stream,
      client,
      conversationId,
    )
    await client.startTurn(conversationId, {
      actionId: actionId('turn'),
      input: {
        type: 'text',
        text: [
          'This is a safe durable Attention approval probe in an isolated disposable workspace.',
          'Do not inspect or send commentary first.',
          'Your first and only tool action must call exec_command with cmd set to "git status --short", workdir set to the current workspace, sandbox_permissions set to "require_escalated", and a short approval justification.',
          'Do not change files, access the network, install anything, delete anything, or access paths outside this isolated worktree.',
          'After the command succeeds, give one short final answer.',
        ].join(' '),
      },
    })
    const firstRun = await observationPromise

    const openBeforeRestart = await client.listAttention({ status: 'open' })
    const resolvedBeforeRestart = await client.listAttention({
      status: 'resolved',
    })
    assert.equal(openBeforeRestart.summary.totalOpen, 1)
    assert.equal(openBeforeRestart.summary.completedReviewOpen, 1)
    assert.equal(openBeforeRestart.summary.approvalOpen, 0)
    assert.deepEqual(
      openBeforeRestart.items.map((item) => item.attentionId),
      [firstRun.completedAttention.attentionId],
    )
    assertResolvedApproval(
      resolvedBeforeRestart.items,
      firstRun.approvalAttention.attentionId,
      firstRun.approvalId,
    )
    assertProviderIdentityIsPrivate({
      events: firstRun.events,
      openBeforeRestart,
      resolvedBeforeRestart,
    })

    await host.close()
    host = undefined

    const restartStartedAt = performance.now()
    host = await launchHost({
      workspace: workspace.root,
      databasePath,
      hostVersion,
      executable,
    })
    const restartHostLaunchMs = performance.now() - restartStartedAt
    assert.notEqual(host.epoch, initialEpoch)
    const restartedEpoch = host.epoch
    const restartedClient = await requireLiveClient(host)

    const restartReadStartedAt = performance.now()
    const [openAfterRestart, resolvedAfterRestart] = await Promise.all([
      restartedClient.listAttention({ status: 'open' }),
      restartedClient.listAttention({ status: 'resolved' }),
    ])
    const restartAttentionReadMs = performance.now() - restartReadStartedAt
    assert.deepEqual(
      openAfterRestart.items.map((item) => item.attentionId),
      [firstRun.completedAttention.attentionId],
    )
    assertResolvedApproval(
      resolvedAfterRestart.items,
      firstRun.approvalAttention.attentionId,
      firstRun.approvalId,
    )

    const resolutionStream = await restartedClient.connectEvents()
    const resolvedEventPromise = waitForAttentionResolution(
      resolutionStream,
      firstRun.completedAttention.attentionId,
    )
    const reviewResolveStartedAt = performance.now()
    const reviewResolution = await restartedClient.resolveAttention(
      firstRun.completedAttention.attentionId,
      actionId('mark-reviewed'),
    )
    const completedReviewResolveMs = performance.now() - reviewResolveStartedAt
    const resolvedEvent = await resolvedEventPromise
    assert.equal(reviewResolution.status, 'completed')
    assert.equal(reviewResolution.data.attention.status, 'resolved')
    assert.equal(reviewResolution.data.attention.type, 'completed_review')
    assert.equal(
      resolvedEvent.payload.attention.attentionId,
      firstRun.completedAttention.attentionId,
    )

    const [openAfterReview, resolvedAfterReview] = await Promise.all([
      restartedClient.listAttention({ status: 'open' }),
      restartedClient.listAttention({ status: 'resolved' }),
    ])
    assert.equal(openAfterReview.items.length, 0)
    assert.equal(openAfterReview.summary.totalOpen, 0)
    assert.equal(resolvedAfterReview.items.length, 2)
    assert.ok(
      resolvedAfterReview.items.some(
        (item) =>
          item.attentionId === firstRun.completedAttention.attentionId &&
          item.type === 'completed_review' &&
          item.status === 'resolved',
      ),
    )
    assertProviderIdentityIsPrivate({
      openAfterRestart,
      resolvedAfterRestart,
      reviewResolution,
      resolvedEvent,
      openAfterReview,
      resolvedAfterReview,
    })

    const afterExample = await readWorkspaceExample(workspace)
    const afterStatus = await gitStatus(workspace.root)
    assert.equal(afterExample, beforeExample)
    assert.equal(afterStatus, '')

    await host.close()
    host = undefined
    const databaseBytes = (await stat(databasePath)).size
    assert.ok(databaseBytes > 0)

    reportWithoutCleanup = {
      integration: 'passed',
      scenario: 'durable-attention-model',
      epochs: {
        initial: initialEpoch,
        restarted: restartedEpoch,
        changed: true,
      },
      protocolMethods: {
        http: [
          'GET /api/v1/attention',
          'POST /api/v1/approvals/:approvalId/resolve',
          'POST /api/v1/attention/:attentionId/resolve',
        ],
        sse: eventSummary([...firstRun.events, resolvedEvent]),
      },
      attention: {
        approval: {
          created: true,
          decision: 'accept',
          persistedResolvedAfterRestart: true,
        },
        completedReview: {
          created: true,
          persistedOpenAfterRestart: true,
          explicitlyResolved: true,
        },
        turnFailed: {
          realCodex: 'Not Observed',
          toolFailureUsedAsTurnFailure: false,
        },
      },
      counts: {
        initialEvents: firstRun.events.length,
        openBeforeRestart: openBeforeRestart.items.length,
        openAfterRestart: openAfterRestart.items.length,
        openAfterReview: openAfterReview.items.length,
        resolvedAfterReview: resolvedAfterReview.items.length,
      },
      timingsMs: {
        total: milliseconds(performance.now() - integrationStartedAt),
        firstHostLaunch: milliseconds(firstHostLaunchMs),
        approvalAttentionRead: firstRun.timingsMs.approvalAttentionRead,
        approvalResolveRequest: firstRun.timingsMs.approvalResolveRequest,
        turnTerminal: firstRun.timingsMs.turnTerminal,
        restartHostLaunch: milliseconds(restartHostLaunchMs),
        restartAttentionRead: milliseconds(restartAttentionReadMs),
        completedReviewResolve: milliseconds(completedReviewResolveMs),
      },
      persistence: { databaseBytes },
      safety: {
        isolatedWorkspaceUnchanged: true,
        providerIdentityPrivate: true,
      },
    }
  } finally {
    await host?.close().catch(() => undefined)
    if (previousDataDirectory === undefined) {
      Reflect.deleteProperty(process.env, 'CODETETHER_DATA_DIR')
    } else {
      process.env.CODETETHER_DATA_DIR = previousDataDirectory
    }
    await removeTemporaryDataDirectory(dataDirectory)
  }

  assert.ok(reportWithoutCleanup !== undefined)
  const report: IntegrationReport = {
    ...reportWithoutCleanup,
    persistence: {
      ...reportWithoutCleanup.persistence,
      temporaryDataRemoved: true,
    },
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

async function observeApprovalAndCompletion(
  stream: CodeTetherEventStream,
  client: CodeTetherClient,
  conversationId: ConversationId,
  timeoutMs = 300_000,
): Promise<FirstRunObservation> {
  const events: HostEventEnvelope[] = []
  const iterator = stream[Symbol.asyncIterator]()
  const deadline = Date.now() + timeoutMs
  let approvalId: ApprovalId | undefined
  let approvalAttention:
    (AttentionItem & { readonly type: 'approval' }) | undefined
  let completedAttention:
    (AttentionItem & { readonly type: 'completed_review' }) | undefined
  let approvalAttentionReadMs: number | undefined
  let approvalResolveRequestMs: number | undefined
  let turnTerminalAt: number | undefined
  const startedAt = performance.now()

  try {
    while (Date.now() < deadline) {
      const result = await nextBefore(iterator, deadline - Date.now())
      if (result.done) throw new Error('SSE ended before Attention lifecycle')
      const event = result.value
      if (event.conversationId !== conversationId) continue
      events.push(event)

      if (event.type === 'approval.requested') {
        assert.equal(approvalId, undefined, 'Expected exactly one Approval')
        approvalId = event.payload.approval.approvalId
        const readStartedAt = performance.now()
        const openAttention = await client.listAttention({ status: 'open' })
        approvalAttentionReadMs = performance.now() - readStartedAt
        const matching = openAttention.items.find(
          (item): item is AttentionItem & { readonly type: 'approval' } =>
            item.type === 'approval' && item.payload.approvalId === approvalId,
        )
        assert.ok(matching !== undefined)
        approvalAttention = matching
        assert.equal(matching.conversationId, conversationId)
        assert.equal(matching.turnId, event.turnId)
        assert.equal(openAttention.summary.approvalOpen, 1)
        assertProviderIdentityIsPrivate(openAttention)

        const resolveStartedAt = performance.now()
        const response = await client.resolveApproval(approvalId, {
          actionId: actionId('allow-once'),
          decision: 'accept',
        })
        approvalResolveRequestMs = performance.now() - resolveStartedAt
        assert.equal(response.status, 'accepted')
      }

      if (
        event.type === 'attention.created' &&
        event.payload.attention.type === 'approval'
      ) {
        assert.equal(
          event.payload.attention.attentionId,
          approvalAttention?.attentionId,
        )
      }

      if (event.type === 'approval.resolved') {
        assert.equal(event.payload.approval.approvalId, approvalId)
        assert.equal(event.payload.approval.decision, 'accept')
      }

      if (
        event.type === 'attention.resolved' &&
        event.payload.attention.type === 'approval'
      ) {
        assert.equal(
          event.payload.attention.attentionId,
          approvalAttention?.attentionId,
        )
        assert.equal(event.payload.attention.payload.decision, 'accept')
      }

      if (terminalEventTypes.has(event.type)) {
        assert.equal(event.type, 'turn.completed')
        turnTerminalAt = performance.now()
      }

      if (
        event.type === 'attention.created' &&
        event.payload.attention.type === 'completed_review'
      ) {
        completedAttention = event.payload.attention
        assert.ok(turnTerminalAt !== undefined)
        break
      }
    }
  } finally {
    await stream.close()
  }

  assert.ok(approvalId !== undefined, 'Codex did not request Approval')
  assert.ok(
    approvalAttention !== undefined,
    'Approval Attention was not present in the durable list',
  )
  assert.ok(
    completedAttention !== undefined,
    'Completed review Attention was not published',
  )
  assert.ok(approvalAttentionReadMs !== undefined)
  assert.ok(approvalResolveRequestMs !== undefined)
  assert.ok(turnTerminalAt !== undefined)
  requireOrderedEventTypes(events, [
    'approval.requested',
    'attention.created',
    'approval.resolved',
    'attention.resolved',
    'turn.completed',
    'attention.created',
  ])
  assertProviderIdentityIsPrivate(events)

  return {
    approvalId,
    approvalAttention,
    completedAttention,
    conversationId,
    events,
    timingsMs: {
      approvalAttentionRead: milliseconds(approvalAttentionReadMs),
      approvalResolveRequest: milliseconds(approvalResolveRequestMs),
      turnTerminal: milliseconds(turnTerminalAt - startedAt),
    },
  }
}

async function waitForAttentionResolution(
  stream: CodeTetherEventStream,
  attentionId: AttentionId,
  timeoutMs = 30_000,
): Promise<Extract<HostEventEnvelope, { type: 'attention.resolved' }>> {
  const iterator = stream[Symbol.asyncIterator]()
  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      const result = await nextBefore(iterator, deadline - Date.now())
      if (result.done) throw new Error('SSE ended before Attention resolution')
      if (
        result.value.type === 'attention.resolved' &&
        result.value.payload.attention.attentionId === attentionId
      ) {
        return result.value
      }
    }
    throw new Error('Timed out waiting for Attention resolution')
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
          () => reject(new Error('Timed out reading the SSE stream')),
          Math.max(1, timeoutMs),
        )
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function launchHost(options: {
  readonly workspace: string
  readonly databasePath: string
  readonly hostVersion: string
  readonly executable: string
}): Promise<RunningLocalCodexHost> {
  return await startLocalCodexHost({
    allowedWorkspaceRoots: [options.workspace],
    allowedOrigins: [],
    hostVersion: options.hostVersion,
    executable: options.executable,
    databasePath: options.databasePath,
    disableHooks: true,
    ephemeralThreads: false,
  })
}

async function requireLiveClient(
  host: RunningLocalCodexHost,
): Promise<CodeTetherClient> {
  const client = new CodeTetherClient({ baseUrl: host.baseUrl })
  const bootstrap = await client.bootstrap()
  assert.equal(
    bootstrap.capabilities.codex,
    true,
    'Codex did not launch; set CODETETHER_CODEX_PATH if needed',
  )
  assert.equal(bootstrap.capabilities.approvals, true)
  assert.equal(bootstrap.capabilities.streaming, true)
  return client
}

function assertResolvedApproval(
  items: readonly AttentionItem[],
  attentionId: AttentionId,
  approvalId: ApprovalId,
): void {
  const item = items.find((candidate) => candidate.attentionId === attentionId)
  assert.ok(item !== undefined)
  assert.equal(item.type, 'approval')
  assert.equal(item.status, 'resolved')
  assert.equal(item.payload.approvalId, approvalId)
  assert.equal(item.payload.decision, 'accept')
}

function requireOrderedEventTypes(
  events: readonly HostEventEnvelope[],
  expected: readonly HostEventEnvelope['type'][],
): void {
  let cursor = 0
  for (const event of events) {
    if (event.type === expected[cursor]) cursor += 1
    if (cursor === expected.length) return
  }
  throw new Error(
    `Expected ordered events ${expected.join(' -> ')}, observed ${events
      .map((event) => event.type)
      .join(' -> ')}`,
  )
}

function assertProviderIdentityIsPrivate(value: unknown): void {
  const wire = JSON.stringify(value)
  assert.doesNotMatch(
    wire,
    /providerThreadId|providerTurnId|providerRequestId|source_key|sourceKey/u,
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
    `act_${label}_${randomUUID().replaceAll('-', '')}`,
  )
}

async function gitStatus(workspaceRoot: string): Promise<string> {
  const result = await execFileAsync(
    'git',
    ['-C', workspaceRoot, 'status', '--short'],
    { windowsHide: true },
  )
  return result.stdout.trim()
}

function assertOutsideRepository(path: string): void {
  const pathFromRepository = relative(repositoryRoot, path)
  if (
    !isAbsolute(path) ||
    (pathFromRepository !== '' &&
      !pathFromRepository.startsWith('..') &&
      !isAbsolute(pathFromRepository))
  ) {
    throw new Error(
      `Integration data directory must be outside repository: ${path}`,
    )
  }
}

async function removeTemporaryDataDirectory(path: string): Promise<void> {
  const canonicalTemporaryRoot = await realpath(tmpdir())
  const canonicalTarget = await realpath(path)
  const pathFromTemporaryRoot = relative(
    canonicalTemporaryRoot,
    canonicalTarget,
  )
  const metadata = await lstat(canonicalTarget)
  if (
    metadata.isSymbolicLink() ||
    pathFromTemporaryRoot === '' ||
    pathFromTemporaryRoot.startsWith('..') ||
    isAbsolute(pathFromTemporaryRoot) ||
    !/^codetether-attention-integration-[A-Za-z0-9_-]+$/u.test(
      pathFromTemporaryRoot,
    )
  ) {
    throw new Error(`Refusing to remove unsafe integration path: ${path}`)
  }
  await rm(canonicalTarget, { recursive: true, force: false })
}

function milliseconds(value: number): number {
  return Number(value.toFixed(3))
}

async function readHostVersion(): Promise<string> {
  const packageJson = JSON.parse(
    await readFile(
      resolve(repositoryRoot, 'apps', 'host', 'package.json'),
      'utf8',
    ),
  ) as { readonly version?: unknown }
  if (
    typeof packageJson.version !== 'string' ||
    packageJson.version.trim().length === 0
  ) {
    throw new Error('Host package version is invalid')
  }
  return packageJson.version
}

await run().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error)
  process.stderr.write(`[codetether:attention-integration] ${message}\n`)
  process.exitCode = 1
})
