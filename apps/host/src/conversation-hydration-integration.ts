import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

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
} from '@codetether/protocol'

import {
  startLocalCodexHostWithRuntime,
  type RunningLocalCodexHost,
} from './api/local-codex-host.js'
import type { AgentHostRuntime } from './api/agent-runtime.js'
import { CodexHostRuntime } from './api/codex-host-runtime.js'
import { WorkspacePolicy } from './api/workspace-policy.js'
import { ConversationStore } from './persistence/index.js'
import { prepareIsolatedWorkspace } from './spike-workspace.js'

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const maximumHydratedConversations = 8
const totalConversations = 12
const terminalEventTypes = new Set([
  'turn.completed',
  'turn.failed',
  'turn.interrupted',
])

interface TerminalObservation {
  readonly events: readonly HostEventEnvelope[]
  readonly terminal: HostEventEnvelope
}

interface ProviderCallTiming {
  readonly startedAt: number
  readonly durationMs: number
}

interface RuntimeTimings {
  readonly resumeConversation: ProviderCallTiming[]
  readonly startTurn: ProviderCallTiming[]
}

interface InstrumentedHost {
  readonly host: RunningLocalCodexHost
  readonly timings: RuntimeTimings
}

async function run(): Promise<void> {
  const hostVersion = await readHostVersion()
  const executable = process.env.CODETETHER_CODEX_PATH ?? 'codex'
  const workspace = await prepareIsolatedWorkspace(
    repositoryRoot,
    'codetether-codex-semantics-conversation-hydration',
  )
  const dataDirectory = await mkdtemp(
    join(tmpdir(), 'codetether-conversation-hydration-'),
  )
  const databasePath = resolve(dataDirectory, 'codetether.sqlite3')
  const marker = `COLD-CONTEXT-${randomUUID()
    .replaceAll('-', '')
    .slice(0, 12)
    .toUpperCase()}`
  await assertMarkerIsNotInWorkspace(workspace.root, marker)

  let host: RunningLocalCodexHost | undefined
  try {
    const firstLaunch = await launchHost({
      workspace: workspace.root,
      databasePath,
      hostVersion,
      executable,
    })
    host = firstLaunch.host
    const firstEpoch = host.epoch
    let client = await requireLiveClient(host)

    const project = await client.createProject({
      actionId: actionId('project'),
      path: workspace.root,
      name: 'Conversation Hydration Integration',
    })
    const projectId = project.data.project.projectId
    const markerConversation = await client.createConversation({
      actionId: actionId('marker-conversation'),
      provider: 'codex',
      projectId,
    })
    const markerConversationId =
      markerConversation.data.conversation.conversationId

    const seedStream = await client.connectEvents()
    const seedTerminalPromise = waitForTerminal(
      seedStream,
      markerConversationId,
    )
    const seedTurn = await client.startTurn(markerConversationId, {
      actionId: actionId('marker-turn'),
      input: {
        type: 'text',
        text: [
          `Remember the exact marker ${marker} for a later turn after the Host process restarts.`,
          'The marker exists only in this prompt; do not write it to a file.',
          'Do not inspect or change files, run commands, access the network, or access parent directories.',
          'Reply with the marker and confirm that you will remember it.',
        ].join(' '),
      },
    })
    const seedObservation = await seedTerminalPromise
    requireCompletedTurn(seedObservation.terminal, seedTurn.data.turn.turnId)
    const seedDetail = await client.getConversation(markerConversationId)
    assert.match(conversationText(seedDetail), new RegExp(marker, 'u'))

    // Ensure the marker Conversation activity is strictly older than every
    // empty Conversation created below, so it deterministically becomes cold.
    await delay(25)
    for (let index = 1; index < totalConversations; index += 1) {
      await client.createConversation({
        actionId: actionId(`filler-${String(index)}`),
        provider: 'codex',
        projectId,
      })
    }

    const beforeRestartList = await listAllConversations(client, projectId)
    assert.equal(beforeRestartList.length, totalConversations)
    assert.ok(
      (await client.snapshot()).conversations.length <=
        maximumHydratedConversations,
    )

    await host.close()
    host = undefined

    const restartedLaunch = await launchHost({
      workspace: workspace.root,
      databasePath,
      hostVersion,
      executable,
    })
    host = restartedLaunch.host
    assert.notEqual(host.epoch, firstEpoch)
    client = await requireLiveClient(host)

    const durableAfterRestart = await listAllConversations(client, projectId)
    const startupSnapshot = await client.snapshot()
    const startupHydratedIds = hydratedIds(startupSnapshot)
    assert.equal(durableAfterRestart.length, totalConversations)
    assert.ok(
      startupHydratedIds.length <= maximumHydratedConversations,
      'Startup exceeded the bounded hydrated working set',
    )
    assert.equal(startupSnapshot.activeTurns.length, 0)
    assert.equal(
      startupHydratedIds.includes(markerConversationId),
      false,
      'The old marker Conversation must start cold',
    )

    const coldReadStartedAt = performance.now()
    const coldDetail = await client.getConversation(markerConversationId)
    const coldReadMs = performance.now() - coldReadStartedAt
    const afterColdReadSnapshot = await client.snapshot()
    const afterColdReadIds = hydratedIds(afterColdReadSnapshot)
    assert.deepEqual(afterColdReadIds, startupHydratedIds)
    assert.equal(afterColdReadIds.includes(markerConversationId), false)
    assert.equal(coldDetail.history.totalTurnCount, 1)
    assert.equal(coldDetail.history.retainedTurnCount, 1)
    assert.match(conversationText(coldDetail), new RegExp(marker, 'u'))

    const resumedStream = await client.connectEvents()
    const resumedTerminalPromise = waitForTerminal(
      resumedStream,
      markerConversationId,
    )
    const hydrateStartedAt = performance.now()
    const resumedTurn = await client.startTurn(markerConversationId, {
      actionId: actionId('resume-marker-turn'),
      input: {
        type: 'text',
        text: [
          'What exact marker did I ask you to remember in the first turn of this conversation?',
          'Do not inspect files, run commands, access the network, or change the workspace.',
          'Reply with only the marker and one short sentence explaining that it came from our earlier conversation.',
        ].join(' '),
      },
    })
    const hydrateResumeStartMs = performance.now() - hydrateStartedAt
    const resumeTiming = restartedLaunch.timings.resumeConversation.at(-1)
    const providerTurnTiming = restartedLaunch.timings.startTurn.at(-1)
    assert.ok(resumeTiming !== undefined, 'Cold control did not resume Codex')
    assert.ok(
      providerTurnTiming !== undefined,
      'Cold control did not start a Provider Turn',
    )
    const runtimeHydrationBeforeResumeMs =
      resumeTiming.startedAt - hydrateStartedAt
    const afterStartSnapshot = await client.snapshot()
    assert.ok(
      hydratedIds(afterStartSnapshot).includes(markerConversationId),
      'Starting a cold Turn must hydrate its Conversation',
    )
    assert.ok(
      afterStartSnapshot.conversations.length <= maximumHydratedConversations,
    )

    const terminalStartedAt = performance.now()
    const resumedObservation = await resumedTerminalPromise
    const terminalMs = performance.now() - terminalStartedAt
    requireCompletedTurn(
      resumedObservation.terminal,
      resumedTurn.data.turn.turnId,
    )

    const finalDetail = await client.getConversation(markerConversationId)
    const finalSnapshot = await client.snapshot()
    const finalDurable = await listAllConversations(client, projectId)
    const resumedRuntimeTurn = finalDetail.runtime.turns.find(
      (turn) => turn.turnId === resumedTurn.data.turn.turnId,
    )
    assert.equal(finalDetail.history.totalTurnCount, 2)
    assert.ok(
      resumedRuntimeTurn?.finalMessage?.includes(marker) === true,
      'The resumed provider Thread did not recall the pre-restart marker',
    )
    assert.equal(finalSnapshot.activeTurns.length, 0)
    assert.ok(
      finalSnapshot.conversations.length <= maximumHydratedConversations,
    )
    assert.equal(finalDurable.length, totalConversations)
    await assertMarkerIsNotInWorkspace(workspace.root, marker)

    process.stdout.write(
      `${JSON.stringify(
        {
          integration: 'passed',
          scenario: 'durable-cold-conversation-hydration',
          marker,
          conversationId: markerConversationId,
          projectId,
          firstEpoch,
          restartedEpoch: host.epoch,
          workspace: workspace.root,
          temporaryDatabase: databasePath,
          counts: {
            durable: finalDurable.length,
            hydrated: finalSnapshot.conversations.length,
            active: finalSnapshot.activeTurns.length,
          },
          stages: {
            startup: {
              durable: durableAfterRestart.length,
              hydrated: startupSnapshot.conversations.length,
              active: startupSnapshot.activeTurns.length,
            },
            coldRead: {
              retainedTurns: coldDetail.history.retainedTurnCount,
              totalTurns: coldDetail.history.totalTurnCount,
              remainedCold: true,
            },
            afterHydrateAndStart: {
              hydrated: afterStartSnapshot.conversations.length,
              active: afterStartSnapshot.activeTurns.length,
            },
            terminal: {
              type: resumedObservation.terminal.type,
              contextMarkerRetained:
                resumedRuntimeTurn.finalMessage?.includes(marker) === true,
              totalTurns: finalDetail.history.totalTurnCount,
            },
          },
          timingsMs: {
            coldRead: milliseconds(coldReadMs),
            runtimeHydrationBeforeProviderResume: milliseconds(
              runtimeHydrationBeforeResumeMs,
            ),
            providerLazyResume: milliseconds(resumeTiming.durationMs),
            providerTurnStart: milliseconds(providerTurnTiming.durationMs),
            hydrateResumeAndStartTotal: milliseconds(hydrateResumeStartMs),
            terminal: milliseconds(terminalMs),
          },
        },
        null,
        2,
      )}\n`,
    )
  } finally {
    await host?.close().catch(() => undefined)
    await rm(dataDirectory, { recursive: true, force: true })
  }
}

async function launchHost(options: {
  readonly workspace: string
  readonly databasePath: string
  readonly hostVersion: string
  readonly executable: string
}): Promise<InstrumentedHost> {
  const hostOptions = {
    allowedWorkspaceRoots: [options.workspace],
    allowedOrigins: [],
    hostVersion: options.hostVersion,
    executable: options.executable,
    databasePath: options.databasePath,
    disableHooks: true,
    ephemeralThreads: false,
    maxConversations: maximumHydratedConversations,
  } as const
  const workspacePolicy = await WorkspacePolicy.create([options.workspace])
  const persistence = ConversationStore.open({
    databasePath: options.databasePath,
  })
  let runtime: CodexHostRuntime
  try {
    runtime = await CodexHostRuntime.launch({
      version: options.hostVersion,
      executable: options.executable,
      disableHooks: true,
      ephemeralThreads: false,
    })
  } catch (error) {
    persistence.close()
    throw error
  }
  const timings: RuntimeTimings = {
    resumeConversation: [],
    startTurn: [],
  }
  const host = await startLocalCodexHostWithRuntime(
    hostOptions,
    new TimedAgentRuntime(runtime, timings),
    workspacePolicy,
    persistence,
  )
  return { host, timings }
}

class TimedAgentRuntime implements AgentHostRuntime {
  constructor(
    readonly delegate: AgentHostRuntime,
    readonly timings: RuntimeTimings,
  ) {}

  get provider(): AgentHostRuntime['provider'] {
    return this.delegate.provider
  }

  subscribeEvents(
    listener: Parameters<AgentHostRuntime['subscribeEvents']>[0],
  ): () => void {
    return this.delegate.subscribeEvents(listener)
  }

  subscribeFailures(
    listener: Parameters<AgentHostRuntime['subscribeFailures']>[0],
  ): () => void {
    return this.delegate.subscribeFailures(listener)
  }

  subscribeApprovals(
    onRequest: Parameters<AgentHostRuntime['subscribeApprovals']>[0],
    onResolved: Parameters<AgentHostRuntime['subscribeApprovals']>[1],
  ): () => void {
    return this.delegate.subscribeApprovals(onRequest, onResolved)
  }

  async startConversation(
    options: Parameters<AgentHostRuntime['startConversation']>[0],
  ): ReturnType<AgentHostRuntime['startConversation']> {
    return await this.delegate.startConversation(options)
  }

  async resumeConversation(
    options: Parameters<AgentHostRuntime['resumeConversation']>[0],
  ): ReturnType<AgentHostRuntime['resumeConversation']> {
    return await this.measure(
      this.timings.resumeConversation,
      async () => await this.delegate.resumeConversation(options),
    )
  }

  async startTurn(
    options: Parameters<AgentHostRuntime['startTurn']>[0],
  ): ReturnType<AgentHostRuntime['startTurn']> {
    return await this.measure(
      this.timings.startTurn,
      async () => await this.delegate.startTurn(options),
    )
  }

  async interruptTurn(
    options: Parameters<AgentHostRuntime['interruptTurn']>[0],
  ): ReturnType<AgentHostRuntime['interruptTurn']> {
    return await this.delegate.interruptTurn(options)
  }

  async close(): Promise<void> {
    await this.delegate.close()
  }

  async measure<T>(
    destination: ProviderCallTiming[],
    operation: () => Promise<T>,
  ): Promise<T> {
    const startedAt = performance.now()
    try {
      return await operation()
    } finally {
      destination.push({
        startedAt,
        durationMs: performance.now() - startedAt,
      })
    }
  }
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
  assert.equal(bootstrap.capabilities.resume, true)
  return client
}

async function listAllConversations(
  client: CodeTetherClient,
  projectId: ProjectId,
) {
  return (
    await client.listProjectConversations(projectId, {
      limit: 100,
    })
  ).conversations
}

async function waitForTerminal(
  stream: CodeTetherEventStream,
  conversationId: ConversationId,
  timeoutMs = 300_000,
): Promise<TerminalObservation> {
  const events: HostEventEnvelope[] = []
  const iterator = stream[Symbol.asyncIterator]()
  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      const result = await nextBefore(iterator, deadline - Date.now())
      if (result.done) throw new Error('SSE stream ended before Turn terminal')
      const event = result.value
      if (event.conversationId !== conversationId) continue
      events.push(event)
      if (event.type === 'approval.requested') {
        throw new Error(
          'Safe context marker probe unexpectedly requested Approval',
        )
      }
      if (terminalEventTypes.has(event.type)) {
        return { events, terminal: event }
      }
    }
    throw new Error('Timed out waiting for Turn terminal')
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

function requireCompletedTurn(
  terminal: HostEventEnvelope,
  expectedTurnId: string,
): void {
  assert.equal(terminal.turnId, expectedTurnId)
  if (terminal.type !== 'turn.completed') {
    throw new Error(`Expected completed Turn, observed ${terminal.type}`)
  }
}

function conversationText(detail: GetConversationResponse): string {
  return [
    ...detail.runtime.turns.flatMap((turn) =>
      turn.finalMessage === undefined ? [] : [turn.finalMessage],
    ),
    ...detail.runtime.messages.map((message) => message.text),
  ].join('\n')
}

function hydratedIds(snapshot: {
  readonly conversations: ReadonlyArray<{
    readonly conversationId: ConversationId
  }>
}): ConversationId[] {
  return snapshot.conversations
    .map((conversation) => conversation.conversationId)
    .sort()
}

async function assertMarkerIsNotInWorkspace(
  workspaceRoot: string,
  marker: string,
): Promise<void> {
  const contents = await Promise.all(
    ['AGENTS.md', 'README.md', join('src', 'example.ts')].map(
      async (path) => await readFile(resolve(workspaceRoot, path), 'utf8'),
    ),
  )
  assert.equal(
    contents.some((content) => content.includes(marker)),
    false,
  )
}

function actionId(label: string): ReturnType<typeof ActionIdSchema.parse> {
  return ActionIdSchema.parse(
    `act_${label}_${randomUUID().replaceAll('-', '')}`,
  )
}

function milliseconds(value: number): number {
  return Number(value.toFixed(3))
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds)
  })
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
  process.stderr.write(
    `[codetether:conversation-hydration-integration] ${message}\n`,
  )
  process.exitCode = 1
})
