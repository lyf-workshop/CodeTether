import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

import {
  inspectCodexInstallation,
  type ApprovalPrompt,
  type ApprovalResolution,
} from '@codetether/adapter-codex'

import { DevelopmentCodexRuntime } from './runtime/development-codex-runtime.js'
import {
  runSemanticsScenario,
  type SemanticsApprovalResolution,
  type SemanticsScenario,
} from './semantics-scenarios.js'

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const executable = process.env.CODETETHER_CODEX_PATH ?? 'codex'
const includeRawPayloads = process.env.CODETETHER_CODEX_RAW === '1'
const printEvents = process.env.CODETETHER_CODEX_EVENTS !== '0'

async function run(): Promise<void> {
  const scenario = parseScenario(process.argv.slice(2))
  const version = await readPackageVersion(repositoryRoot)
  const installation = await inspectCodexInstallation(executable)
  const readline = createInterface({
    input: process.stdin,
    output: process.stderr,
  })
  const liveRuntimes = new Set<DevelopmentCodexRuntime>()
  const resolutions: SemanticsApprovalResolution[] = []
  let resolutionCursor = 0
  process.stderr.write(
    `[codex:semantics] ${installation.version} scenario=${scenario}\n`,
  )

  const approvalHandler = async (
    prompt: ApprovalPrompt,
  ): Promise<'allow' | 'deny'> => {
    process.stderr.write(
      `[codex:approval] method=${prompt.request.method} requestId=${String(prompt.request.id)} thread=${prompt.event.threadId} turn=${prompt.event.turnId} item=${prompt.event.itemId ?? 'none'}\n`,
    )
    process.stderr.write(`[codex:approval] ${prompt.event.summary}\n`)
    const answer = await readline.question('Allow once? [y/N] ')
    return answer.trim().toLowerCase() === 'y' ? 'allow' : 'deny'
  }
  const onApprovalResolved = (resolution: ApprovalResolution): void => {
    const params = isRecord(resolution.request.params)
      ? resolution.request.params
      : {}
    resolutions.push({
      method: resolution.request.method,
      requestId: resolution.request.id,
      identity: {
        threadId: resolution.event.threadId,
        turnId: resolution.event.turnId,
        itemId:
          resolution.event.itemId ??
          readString(params, 'itemId') ??
          readString(params, 'callId') ??
          null,
        approvalId: resolution.event.approvalId,
      },
      paramsShape: Object.keys(params).sort(),
      decision: resolution.decision,
      response: resolution.response,
    })
  }
  const consumeApprovalResolutions =
    (): readonly SemanticsApprovalResolution[] => {
      const pending = resolutions.slice(resolutionCursor)
      resolutionCursor = resolutions.length
      return pending
    }

  const launchRuntime = async (): Promise<DevelopmentCodexRuntime> => {
    const runtime = await DevelopmentCodexRuntime.launch({
      executable,
      version,
      includeRawPayloads,
      printEvents,
      approvalHandler,
      onApprovalResolved,
    })
    liveRuntimes.add(runtime)
    return runtime
  }

  const closeAll = async (): Promise<void> => {
    readline.close()
    await Promise.allSettled(
      [...liveRuntimes].map(async (runtime) => runtime.close()),
    )
  }
  const onSignal = (): void => {
    process.exitCode = 130
    void closeAll()
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  try {
    const result = await runSemanticsScenario(scenario, {
      repositoryRoot,
      launchRuntime,
      consumeApprovalResolutions,
    })
    process.stdout.write(
      `${JSON.stringify(
        {
          semantics: {
            scenario,
            installedCodex: installation.version,
            approvals: resolutions,
            result,
          },
        },
        null,
        2,
      )}\n`,
    )
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    await closeAll()
  }
}

function parseScenario(arguments_: readonly string[]): SemanticsScenario {
  const scenarioIndex = arguments_.indexOf('--scenario')
  const candidate =
    scenarioIndex < 0 ? arguments_[0] : arguments_[scenarioIndex + 1]
  if (
    candidate === 'approval' ||
    candidate === 'multiturn' ||
    candidate === 'multithread' ||
    candidate === 'resume' ||
    candidate === 'interrupt' ||
    candidate === 'failure'
  ) {
    return candidate
  }
  throw new Error(
    'Use --scenario approval|multiturn|multithread|resume|interrupt|failure',
  )
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  return typeof value[key] === 'string' ? value[key] : undefined
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[codex:semantics] failed: ${message}\n`)
  process.exitCode = 1
})
