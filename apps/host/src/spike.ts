import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'

import type { AgentEvent } from '@codetether/agent-core'
import {
  CodexAppServerClient,
  CodexProcessError,
  inspectCodexInstallation,
  spawnCodexAppServer,
} from '@codetether/adapter-codex'

import {
  prepareSpikeWorkspace,
  readWorkspaceExample,
} from './spike-workspace.js'

const SAFE_PROMPT = [
  'Inspect this small test workspace and explain its structure.',
  'Then add one short, useful comment to src/example.ts and summarize what changed.',
  'Do not install dependencies, access the network, delete files, or modify anything outside this workspace.',
].join(' ')

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const executable = process.env.CODETETHER_CODEX_PATH ?? 'codex'
const turnTimeoutMs = parseTimeout(process.env.CODETETHER_CODEX_TURN_TIMEOUT_MS)

async function run(): Promise<void> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stderr,
  })
  const eventCounts = new Map<string, number>()
  const changedFiles = new Set<string>()
  let client: CodexAppServerClient | undefined
  let shutdownPromise: Promise<void> | undefined
  let receivedSignal: NodeJS.Signals | undefined

  const shutdownRuntime = (): Promise<void> => {
    shutdownPromise ??= (async () => {
      readline.close()
      const activeClient = client
      client = undefined
      if (activeClient !== undefined) {
        await activeClient.shutdown()
        process.stderr.write('[codex:spike] runtime closed\n')
      }
    })()
    return shutdownPromise
  }
  const handleSignal = (signal: NodeJS.Signals): void => {
    if (receivedSignal !== undefined) return
    receivedSignal = signal
    process.exitCode = signal === 'SIGINT' ? 130 : 143
    process.stderr.write(`[codex:spike] received ${signal}; shutting down\n`)
    void shutdownRuntime().catch((error: unknown) => {
      process.stderr.write(
        `[codex:spike] shutdown failed: ${safeErrorName(error)}\n`,
      )
    })
  }
  const throwIfInterrupted = (): void => {
    if (receivedSignal !== undefined) {
      throw new CodexProcessError(`Spike interrupted by ${receivedSignal}`)
    }
  }

  process.once('SIGINT', handleSignal)
  process.once('SIGTERM', handleSignal)

  try {
    const workspace = await prepareSpikeWorkspace(repositoryRoot)
    const before = await readWorkspaceExample(workspace)
    const packageVersion = await readPackageVersion(repositoryRoot)
    const installation = await inspectCodexInstallation(executable)
    throwIfInterrupted()
    process.stderr.write(`[codex:spike] ${installation.version}\n`)
    if (installation.stderr.length > 0) {
      process.stderr.write('[codex:probe] diagnostic suppressed\n')
    }

    const child = spawnCodexAppServer(executable)
    client = new CodexAppServerClient(child, {
      requestTimeoutMs: 30_000,
      onStderr: (text) => {
        if (text.length > 0) {
          process.stderr.write('[codex:stderr] diagnostic suppressed\n')
        }
      },
      onUnknownNotification: () => {
        process.stderr.write('[codex:unknown-notification] suppressed\n')
      },
      onUnknownServerRequest: () => {
        process.stderr.write('[codex:unknown-request] suppressed\n')
      },
      onUnknownResponse: () => {
        process.stderr.write('[codex:unknown-response] suppressed\n')
      },
      onError: (error) => {
        process.stderr.write(`[codex:error] ${safeErrorName(error)}\n`)
      },
      onEvent: (event) =>
        printAndCollectEvent(event, eventCounts, changedFiles),
      approvalHandler: async () => await requestApproval(readline),
    })

    await client.initialize({
      name: 'codetether',
      title: 'CodeTether',
      version: packageVersion,
    })
    throwIfInterrupted()
    process.stderr.write('[codex:spike] initialized\n')

    const thread = await client.startThread({
      cwd: workspace.root,
      ephemeral: true,
    })
    const turn = await client.startTurn({
      threadId: thread.thread.id,
      prompt: SAFE_PROMPT,
    })

    const terminal = await client.waitForTurn(
      thread.thread.id,
      turn.turn.id,
      turnTimeoutMs,
    )
    if (terminal.turn.status !== 'completed') {
      throw new CodexProcessError('Codex spike turn did not complete')
    }

    const example = await readWorkspaceExample(workspace)
    process.stdout.write(
      `${JSON.stringify(
        {
          summary: {
            status: terminal.turn.status,
            finalMessageObserved: (terminal.finalMessage?.length ?? 0) > 0,
            changedFileCount: changedFiles.size,
            eventSummary: Object.fromEntries(eventCounts),
            requestedFixtureChanged: before !== example,
          },
        },
        null,
        2,
      )}\n`,
    )
  } finally {
    process.off('SIGINT', handleSignal)
    process.off('SIGTERM', handleSignal)
    await shutdownRuntime()
  }
}

function printAndCollectEvent(
  event: AgentEvent,
  eventCounts: Map<string, number>,
  changedFiles: Set<string>,
): void {
  eventCounts.set(event.type, (eventCounts.get(event.type) ?? 0) + 1)
  if (event.type === 'file.changed') changedFiles.add(event.path)
  process.stdout.write(`${JSON.stringify({ event: { type: event.type } })}\n`)
}

async function requestApproval(
  readline: ReturnType<typeof createInterface>,
): Promise<'allow' | 'deny'> {
  process.stderr.write('[codex:approval] request received\n')
  const answer = await readline.question('Allow once? [y/N] ')
  return answer.trim().toLowerCase() === 'y' ? 'allow' : 'deny'
}

async function readPackageVersion(root: string): Promise<string> {
  const packageJson = JSON.parse(
    await readFile(resolve(root, 'package.json'), 'utf8'),
  ) as { version?: unknown }
  if (typeof packageJson.version !== 'string') {
    throw new Error('Root package.json has no version')
  }
  return packageJson.version
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined) return 300_000
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(
      'CODETETHER_CODEX_TURN_TIMEOUT_MS must be a positive integer',
    )
  }
  return parsed
}

function safeErrorName(value: unknown): string {
  return value instanceof Error &&
    /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(value.name)
    ? value.name
    : 'Error'
}

void run().catch((error: unknown) => {
  process.stderr.write(`[codex:spike] failed: ${safeErrorName(error)}\n`)
  process.exitCode = 1
})
