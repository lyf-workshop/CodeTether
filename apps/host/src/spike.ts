import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'

import type { AgentEvent } from '@codetether/agent-core'
import {
  CodexAppServerClient,
  CodexProcessError,
  createStderrProtocolLogger,
  inspectCodexInstallation,
  spawnCodexAppServer,
  type ApprovalPrompt,
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
const includeRawPayloads = process.env.CODETETHER_CODEX_RAW === '1'
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
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`[codex:spike] shutdown failed: ${message}\n`)
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
    const packageVersion = await readPackageVersion(repositoryRoot)
    const installation = await inspectCodexInstallation(executable)
    throwIfInterrupted()
    process.stderr.write(
      `[codex:spike] ${installation.version} (${installation.executable})\n`,
    )
    if (installation.stderr.length > 0) {
      process.stderr.write(
        `[codex:probe] ${redactDiagnostic(installation.stderr)}\n`,
      )
    }
    process.stderr.write(`[codex:spike] workspace=${workspace.root}\n`)

    const child = spawnCodexAppServer(executable)
    client = new CodexAppServerClient(child, {
      requestTimeoutMs: 30_000,
      protocolLogger: createStderrProtocolLogger({
        includePayload: includeRawPayloads,
      }),
      onStderr: (text) => {
        const diagnostic = redactDiagnostic(text).trimEnd()
        if (diagnostic.length > 0) {
          process.stderr.write(`[codex:stderr] ${diagnostic}\n`)
        }
      },
      onUnknownNotification: (notification) => {
        process.stderr.write(
          `[codex:unknown-notification] ${notification.method}\n`,
        )
      },
      onUnknownServerRequest: (request) => {
        process.stderr.write(`[codex:unknown-request] ${request.method}\n`)
      },
      onUnknownResponse: (id) => {
        process.stderr.write(`[codex:unknown-response] id=${String(id)}\n`)
      },
      onError: (error) => {
        process.stderr.write(`[codex:error] ${error.message}\n`)
      },
      onEvent: (event) =>
        printAndCollectEvent(event, eventCounts, changedFiles),
      approvalHandler: async (prompt) =>
        await requestApproval(readline, prompt),
    })

    const initialized = await client.initialize({
      name: 'codetether',
      title: 'CodeTether',
      version: packageVersion,
    })
    throwIfInterrupted()
    process.stderr.write(
      `[codex:spike] initialized userAgent=${initialized.userAgent} platform=${initialized.platformFamily}/${initialized.platformOs}\n`,
    )

    const thread = await client.startThread({
      cwd: workspace.root,
      ephemeral: true,
    })
    process.stderr.write(`[codex:spike] thread=${thread.thread.id}\n`)
    const turn = await client.startTurn({
      threadId: thread.thread.id,
      prompt: SAFE_PROMPT,
    })
    process.stderr.write(`[codex:spike] turn=${turn.turn.id}\n`)

    const terminal = await client.waitForTurn(
      thread.thread.id,
      turn.turn.id,
      turnTimeoutMs,
    )
    if (terminal.turn.status !== 'completed') {
      throw new CodexProcessError(
        terminal.turn.error?.message ??
          `Codex turn ended with status ${terminal.turn.status}`,
      )
    }

    const example = await readWorkspaceExample(workspace)
    process.stdout.write(
      `${JSON.stringify(
        {
          summary: {
            threadId: thread.thread.id,
            turnId: turn.turn.id,
            status: terminal.turn.status,
            finalMessage: terminal.finalMessage ?? '',
            changedFiles: [...changedFiles],
            eventSummary: Object.fromEntries(eventCounts),
            observedRawMethods: client.observedRawMethods,
            workspace: workspace.root,
            exampleFile: workspace.exampleFile,
            exampleContent: example,
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
  const safeEvent = Object.fromEntries(
    Object.entries(event).filter(([key]) => key !== 'raw'),
  )
  process.stdout.write(`${JSON.stringify({ event: safeEvent })}\n`)
}

async function requestApproval(
  readline: ReturnType<typeof createInterface>,
  prompt: ApprovalPrompt,
): Promise<'allow' | 'deny'> {
  process.stderr.write(
    `[codex:approval] ${prompt.event.kind}: ${prompt.event.summary}\n`,
  )
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

function redactDiagnostic(value: string): string {
  return value.replace(
    /(authorization|credential|password|secret|token|api.?key)(\s*[:=]\s*)\S+/gi,
    '$1$2[redacted]',
  )
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[codex:spike] failed: ${message}\n`)
  process.exitCode = 1
})
