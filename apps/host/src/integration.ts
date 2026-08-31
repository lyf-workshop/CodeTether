import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CodeTetherClient,
  type CodeTetherEventStream,
} from '@codetether/client'
import {
  ActionIdSchema,
  EpochIdSchema,
  formatLastEventId,
  LastEventIdSchema,
  type ApprovalId,
  type HostEventEnvelope,
} from '@codetether/protocol'

import { startLocalCodexHost } from './api/local-codex-host.js'
import {
  prepareApprovalWorkspace,
  prepareIsolatedWorkspace,
  readWorkspaceExample,
} from './spike-workspace.js'

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const terminalEventTypes = new Set([
  'turn.completed',
  'turn.failed',
  'turn.interrupted',
])

interface CollectedEvents {
  readonly events: readonly HostEventEnvelope[]
  readonly lastEventId: NonNullable<CodeTetherEventStream['lastEventId']>
}

async function run(): Promise<void> {
  const hostVersion = await readHostVersion()
  const executable = process.env.CODETETHER_CODEX_PATH ?? 'codex'
  const workspace = await prepareIsolatedWorkspace(
    repositoryRoot,
    'codetether-codex-semantics-host-api',
  )
  const approvalWorkspace = await prepareApprovalWorkspace(repositoryRoot)
  const beforeFile = await readWorkspaceExample(workspace)
  let host = await startLocalCodexHost({
    allowedWorkspaceRoots: [workspace.root, approvalWorkspace.root],
    allowedOrigins: [],
    hostVersion,
    executable,
    disableHooks: true,
    ephemeralThreads: true,
    persistence: false,
    replayMaxEvents: 64,
  })
  const firstEpoch = host.epoch

  try {
    const client = new CodeTetherClient({ baseUrl: host.baseUrl })
    const machines = (await client.listMachines()).machines
    const localMachine = machines.find((machine) => machine.kind === 'local')
    assert.ok(localMachine !== undefined)
    const machineId = localMachine.machineId
    const bootstrap = await client.bootstrap()
    const initialSnapshot = await client.snapshot()
    assert.equal(bootstrap.epoch, initialSnapshot.epoch)
    assert.equal(bootstrap.protocolVersion, 1)
    assert.deepEqual(bootstrap.capabilities, {
      codex: true,
      approvals: true,
      interrupt: true,
      resume: false,
      diff: true,
      streaming: true,
    })

    const [observerA, observerB] = await Promise.all([
      client.connectEvents(),
      client.connectEvents(),
    ])
    const primaryProject = await client.createProject({
      actionId: actionId('project-primary'),
      path: workspace.root,
    })
    const approvalProject = await client.createProject({
      actionId: actionId('project-approval'),
      path: approvalWorkspace.root,
    })
    const firstA = collectEvents(observerA, (event) => isTerminalEvent(event))
    const firstB = collectEvents(observerB, (event) => isTerminalEvent(event))
    const conversation = await client.createConversation({
      actionId: actionId('create-primary'),
      provider: 'codex',
      projectId: primaryProject.data.project.projectId,
      machineId,
    })
    const conversationId = conversation.data.conversation.conversationId
    const firstTurn = await client.startTurn(conversationId, {
      actionId: actionId('start-primary'),
      input: {
        type: 'text',
        text: [
          'Inspect only this small isolated workspace.',
          'Add the comment "// Verified through the CodeTether Host API." directly above the greet function in src/example.ts.',
          'Do not access the network, install dependencies, delete files, or access parent directories.',
          'Then summarize the file change.',
        ].join(' '),
      },
    })
    const [primaryA, primaryB] = await Promise.all([firstA, firstB])
    assert.equal(firstTurn.data.turn.conversationId, conversationId)
    assert.deepEqual(eventIds(primaryA.events), eventIds(primaryB.events))
    assertStrictSequence(primaryA.events)
    requireEventTypes(primaryA.events, [
      'conversation.started',
      'turn.started',
      'message.completed',
      'tool.started',
      'tool.completed',
      'file.changed',
      'turn.completed',
    ])
    assertProviderIdentityIsPrivate(primaryA.events)
    const afterFile = await readWorkspaceExample(workspace)
    assert.notEqual(afterFile, beforeFile)
    assert.match(afterFile, /Verified through the CodeTether Host API/u)

    const liveObserver = await client.connectEvents()
    const liveSecond = collectEvents(
      liveObserver,
      (event) =>
        event.conversationId === conversationId && isTerminalEvent(event),
    )
    const secondTurn = await client.startTurn(conversationId, {
      actionId: actionId('start-replay'),
      input: {
        type: 'text',
        text: 'Read src/example.ts and reply with the exact comment you see. Do not change files or run network commands.',
      },
    })
    const liveSecondEvents = await liveSecond
    assert.equal(
      terminalEvent(liveSecondEvents.events).turnId,
      secondTurn.data.turn.turnId,
    )

    const replayObserver = await client.connectEvents({
      lastEventId: primaryA.lastEventId,
    })
    const replayedSecond = await collectEvents(
      replayObserver,
      (event) =>
        event.turnId === secondTurn.data.turn.turnId && isTerminalEvent(event),
    )
    assert.deepEqual(
      eventIds(replayedSecond.events),
      eventIds(liveSecondEvents.events),
    )

    const approvalObserver = await client.connectEvents()
    let approvalResolved = false
    let approvalId: ApprovalId | undefined
    const approvalEventsPromise = collectEvents(
      approvalObserver,
      (event) => approvalResolved && isTerminalEvent(event),
      async (event) => {
        if (event.type === 'approval.requested') {
          approvalId = event.payload.approval.approvalId
          await client.resolveApproval(approvalId, {
            actionId: actionId('approve-once'),
            decision: 'accept',
          })
        }
        if (event.type === 'approval.resolved') {
          approvalResolved = true
        }
      },
    )
    const approvalConversation = await client.createConversation({
      actionId: actionId('create-approval'),
      provider: 'codex',
      projectId: approvalProject.data.project.projectId,
      machineId,
    })
    const approvalConversationId =
      approvalConversation.data.conversation.conversationId
    await client.startTurn(approvalConversationId, {
      actionId: actionId('start-approval'),
      input: {
        type: 'text',
        text: [
          'This is a safe approval-protocol probe in an isolated disposable workspace.',
          'Do not inspect or send commentary first.',
          'Your first and only tool action must call exec_command with cmd set to "git status --short", workdir set to the current workspace, sandbox_permissions set to "require_escalated", and a short approval justification.',
          'Do not change files, access the network, install anything, delete anything, or access paths outside this isolated worktree.',
        ].join(' '),
      },
    })
    const approvalEvents = await approvalEventsPromise
    requireEventTypes(approvalEvents.events, [
      'approval.requested',
      'approval.resolved',
      'turn.completed',
    ])
    assert.ok(approvalId !== undefined)
    assert.equal(
      approvalEvents.events.find((event) => event.type === 'approval.resolved')
        ?.payload.approval.decision,
      'accept',
    )

    const interruptObserver = await client.connectEvents()
    let interruptIssued = false
    const interruptedEventsPromise = collectEvents(
      interruptObserver,
      (event) => isTerminalEvent(event),
      async (event) => {
        if (!interruptIssued && event.type === 'tool.started') {
          interruptIssued = true
          await client.interruptTurn(event.conversationId, event.turnId, {
            actionId: actionId('interrupt'),
          })
        }
      },
    )
    const interruptConversation = await client.createConversation({
      actionId: actionId('create-interrupt'),
      provider: 'codex',
      projectId: primaryProject.data.project.projectId,
      machineId,
    })
    const interruptConversationId =
      interruptConversation.data.conversation.conversationId
    await client.startTurn(interruptConversationId, {
      actionId: actionId('start-interrupt'),
      input: {
        type: 'text',
        text: [
          'This is an interrupt test in an isolated workspace.',
          'Your first tool action must run the safe PowerShell command Start-Sleep -Seconds 20.',
          'After it finishes, say complete. Do not modify files, use the network, or access parent directories.',
        ].join(' '),
      },
    })
    const interruptedEvents = await interruptedEventsPromise
    assert.equal(interruptIssued, true)
    assert.equal(
      terminalEvent(interruptedEvents.events).type,
      'turn.interrupted',
    )

    const evictedObserver = await client.connectEvents({
      lastEventId: LastEventIdSchema.parse(
        primaryA.events[0]?.eventId ?? primaryA.lastEventId,
      ),
    })
    const evicted = await collectEvents(
      evictedObserver,
      (event) => event.type === 'stream.reset',
    )
    assert.equal(streamResetReason(evicted.events), 'history_evicted')

    const wrongEpoch = EpochIdSchema.parse(randomUUID())
    const wrongEpochObserver = await client.connectEvents({
      lastEventId: formatLastEventId({ epoch: wrongEpoch, seq: 1 }),
    })
    const epochReset = await collectEvents(
      wrongEpochObserver,
      (event) => event.type === 'stream.reset',
    )
    assert.equal(streamResetReason(epochReset.events), 'epoch_mismatch')

    const finalSnapshot = await client.snapshot()
    assert.equal(finalSnapshot.pendingApprovals.length, 0)
    assert.equal(finalSnapshot.activeTurns.length, 0)

    await host.close()
    const restarted = await startLocalCodexHost({
      allowedWorkspaceRoots: [workspace.root],
      allowedOrigins: [],
      hostVersion,
      executable,
      disableHooks: true,
      ephemeralThreads: true,
      persistence: false,
    })
    host = restarted
    const restartedBootstrap = await new CodeTetherClient({
      baseUrl: restarted.baseUrl,
    }).bootstrap()
    assert.notEqual(restartedBootstrap.epoch, firstEpoch)

    process.stdout.write(
      `${JSON.stringify(
        {
          integration: 'passed',
          protocolVersion: bootstrap.protocolVersion,
          firstEpoch,
          restartedEpoch: restartedBootstrap.epoch,
          primary: eventSummary(primaryA.events),
          replay: {
            liveEvents: liveSecondEvents.events.length,
            replayedEvents: replayedSecond.events.length,
            exactIdentityMatch: true,
            evictedReset: 'history_evicted',
            wrongEpochReset: 'epoch_mismatch',
          },
          approval: {
            approvalId,
            decision: 'accept',
          },
          interrupt: {
            issued: interruptIssued,
            terminal: terminalEvent(interruptedEvents.events).type,
          },
          workspace: {
            root: workspace.root,
            changedOnlyInFixture: beforeFile !== afterFile,
          },
        },
        null,
        2,
      )}\n`,
    )
  } finally {
    await host.close().catch(() => undefined)
  }
}

async function collectEvents(
  stream: CodeTetherEventStream,
  until: (event: HostEventEnvelope) => boolean,
  onEvent?: (event: HostEventEnvelope) => void | Promise<void>,
  timeoutMs = 180_000,
): Promise<CollectedEvents> {
  const events: HostEventEnvelope[] = []
  const iterator = stream[Symbol.asyncIterator]()
  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      const result = await nextBefore(iterator, deadline - Date.now())
      if (result.done) throw new Error('SSE stream ended before expected event')
      events.push(result.value)
      await onEvent?.(result.value)
      if (until(result.value)) {
        const lastEventId = stream.lastEventId
        if (lastEventId === undefined) {
          throw new Error('SSE stream did not retain Last-Event-ID')
        }
        return { events, lastEventId }
      }
    }
    throw new Error('Timed out waiting for expected Host event')
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

function isTerminalEvent(event: HostEventEnvelope): boolean {
  return terminalEventTypes.has(event.type)
}

function terminalEvent(
  events: readonly HostEventEnvelope[],
): HostEventEnvelope {
  const terminal = events.findLast(isTerminalEvent)
  assert.ok(terminal, 'Expected a terminal Turn event')
  return terminal
}

function requireEventTypes(
  events: readonly HostEventEnvelope[],
  expected: readonly HostEventEnvelope['type'][],
): void {
  const observed = new Set(events.map((event) => event.type))
  for (const type of expected) {
    assert.ok(observed.has(type), `Expected Host event type ${type}`)
  }
}

function eventIds(events: readonly HostEventEnvelope[]): readonly string[] {
  return events.map((event) => event.eventId)
}

function assertStrictSequence(events: readonly HostEventEnvelope[]): void {
  for (let index = 1; index < events.length; index += 1) {
    assert.equal(events[index]?.seq, (events[index - 1]?.seq ?? 0) + 1)
  }
}

function assertProviderIdentityIsPrivate(
  events: readonly HostEventEnvelope[],
): void {
  const wire = JSON.stringify(events)
  assert.doesNotMatch(
    wire,
    /providerThreadId|providerTurnId|providerRequestId/u,
  )
}

function eventSummary(
  events: readonly HostEventEnvelope[],
): Record<string, number> {
  const summary: Record<string, number> = {}
  for (const event of events)
    summary[event.type] = (summary[event.type] ?? 0) + 1
  return summary
}

function streamResetReason(
  events: readonly HostEventEnvelope[],
): 'epoch_mismatch' | 'history_evicted' | 'future_cursor' {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'stream.reset') return event.payload.reason
  }
  throw new Error('Expected stream.reset event')
}

function actionId(label: string): ReturnType<typeof ActionIdSchema.parse> {
  return ActionIdSchema.parse(
    `act_${label}_${randomUUID().replaceAll('-', '')}`,
  )
}

async function readHostVersion(): Promise<string> {
  const packageJson = JSON.parse(
    await readFile(
      resolve(repositoryRoot, 'apps', 'host', 'package.json'),
      'utf8',
    ),
  ) as { version?: unknown }
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
  process.stderr.write(`[codetether:host-integration] ${message}\n`)
  process.exitCode = 1
})
