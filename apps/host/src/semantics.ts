import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

import {
  inspectCodexInstallation,
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

  const approvalHandler = async (): Promise<'allow' | 'deny'> => {
    process.stderr.write('[codex:approval] request received\n')
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
            approvals: summarizeApprovals(resolutions),
            result: summarizeScenarioResult(scenario, result),
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

function summarizeApprovals(
  resolutions: readonly SemanticsApprovalResolution[],
): Readonly<Record<string, number>> {
  let allow = 0
  let deny = 0
  for (const resolution of resolutions) {
    if (resolution.decision === 'allow') allow += 1
    else deny += 1
  }
  return {
    count: resolutions.length,
    allow,
    deny,
  }
}

function summarizeScenarioResult(
  scenario: SemanticsScenario,
  value: unknown,
): Readonly<Record<string, unknown>> {
  const result = asRecord(value)
  const runtime = summarizeRuntime(result.runtime)
  switch (scenario) {
    case 'approval':
      return {
        terminalStatus: readTerminalStatus(result.terminal),
        fileChanged: readBoolean(result, 'fileChanged'),
        fixtureIntact: readBoolean(result, 'fixtureIntact'),
        runtime,
      }
    case 'multiturn':
      return {
        firstTurnStatus: readTerminalStatus(result.turnOne),
        secondTurnStatus: readTerminalStatus(result.turnTwo),
        contextRetained: readBoolean(result, 'contextRetained'),
        runtime,
      }
    case 'multithread':
      return {
        firstTurnStatus: readTerminalStatus(result.threadA),
        secondTurnStatus: readTerminalStatus(result.threadB),
        isolated: readBoolean(result, 'isolated'),
        runtime,
      }
    case 'resume':
      return {
        seedTurnStatus: readTerminalStatus(result.seedTurn),
        resumedTurnStatus: readTerminalStatus(result.resumedTurn),
        sameProviderThread: readBoolean(result, 'sameProviderThread'),
        contextRetained: readBoolean(result, 'contextRetained'),
        firstRuntime: summarizeRuntime(result.firstRuntime),
        secondRuntime: summarizeRuntime(result.secondRuntime),
      }
    case 'interrupt':
      return {
        interruptedTurnStatus: readTerminalStatus(result.interruptedTurn),
        followUpTurnStatus: readTerminalStatus(result.followUpTurn),
        threadContinued: readBoolean(result, 'threadContinued'),
        runtime,
      }
    case 'failure':
      return {
        terminalStatus: readTerminalStatus(result.terminal),
        commandFailureObserved: readBoolean(result, 'commandFailureObserved'),
        wholeTurnFailed: readBoolean(result, 'wholeTurnFailed'),
        runtime,
      }
  }
}

function summarizeRuntime(value: unknown): Readonly<Record<string, unknown>> {
  const runtime = asRecord(value)
  const eventCounts = Object.fromEntries(
    Object.entries(asRecord(runtime.eventCounts)).filter(
      ([name, count]) =>
        /^[a-z]+(?:\.[a-z]+)*$/u.test(name) &&
        typeof count === 'number' &&
        Number.isSafeInteger(count) &&
        count >= 0,
    ),
  )
  const aggregation = Object.fromEntries(
    Object.entries(asRecord(runtime.aggregation)).filter(
      ([name, count]) =>
        /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(name) &&
        typeof count === 'number' &&
        Number.isSafeInteger(count) &&
        count >= 0,
    ),
  )
  return {
    eventCounts,
    failedToolCount: readNonNegativeInteger(runtime, 'failedToolCount'),
    deltaTextIntegrity: readBoolean(runtime, 'deltaTextIntegrity'),
    aggregation,
  }
}

function readTerminalStatus(value: unknown): string | null {
  const status = asRecord(value).status
  return typeof status === 'string' && /^[a-z_]{1,32}$/u.test(status)
    ? status
    : null
}

function readBoolean(
  value: Record<string, unknown>,
  key: string,
): boolean | null {
  return typeof value[key] === 'boolean' ? value[key] : null
}

function readNonNegativeInteger(
  value: Record<string, unknown>,
  key: string,
): number | null {
  const candidate = value[key]
  return typeof candidate === 'number' &&
    Number.isSafeInteger(candidate) &&
    candidate >= 0
    ? candidate
    : null
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function safeErrorName(value: unknown): string {
  return value instanceof Error &&
    /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(value.name)
    ? value.name
    : 'Error'
}

void run().catch((error: unknown) => {
  process.stderr.write(`[codex:semantics] failed: ${safeErrorName(error)}\n`)
  process.exitCode = 1
})
