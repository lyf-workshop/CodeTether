import type {
  ApprovalDecision,
  ApprovalWireResponse,
  CodexTurnStatus,
  TurnTerminalResult,
} from '@codetether/adapter-codex'

import {
  prepareApprovalWorkspace,
  prepareIsolatedWorkspace,
  readWorkspaceExample,
  type SpikeWorkspace,
} from './spike-workspace.js'
import { DevelopmentCodexRuntime } from './runtime/development-codex-runtime.js'

export type SemanticsScenario =
  'approval' | 'multiturn' | 'multithread' | 'resume' | 'interrupt' | 'failure'

export interface SemanticsScenarioContext {
  readonly repositoryRoot: string
  readonly launchRuntime: () => Promise<DevelopmentCodexRuntime>
  readonly consumeApprovalResolutions: () => readonly SemanticsApprovalResolution[]
}

export interface SemanticsApprovalResolution {
  readonly method: string
  readonly requestId: string | number
  readonly identity: {
    readonly threadId: string
    readonly turnId: string
    readonly itemId: string | null
    readonly approvalId: string
  }
  readonly paramsShape?: readonly string[]
  readonly decision: ApprovalDecision
  readonly response: ApprovalWireResponse
}

export async function runSemanticsScenario(
  scenario: SemanticsScenario,
  context: SemanticsScenarioContext,
): Promise<unknown> {
  switch (scenario) {
    case 'approval':
      return await runApproval(context)
    case 'multiturn':
      return await runMultipleTurns(context)
    case 'multithread':
      return await runMultipleThreads(context)
    case 'resume':
      return await runResume(context)
    case 'interrupt':
      return await runInterrupt(context)
    case 'failure':
      return await runFailure(context)
  }
}

async function runApproval(
  context: SemanticsScenarioContext,
): Promise<unknown> {
  const workspace = await prepareApprovalWorkspace(context.repositoryRoot)
  const before = await readWorkspaceExample(workspace)
  const runtime = await context.launchRuntime()
  let terminal: TurnTerminalResult | undefined
  let threadId: string
  let turnId: string
  try {
    const thread = await runtime.client.startThread({
      cwd: workspace.root,
      ephemeral: true,
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
    })
    threadId = thread.thread.id
    const turn = await runtime.client.startTurn({
      threadId,
      prompt: [
        'This is an approval-protocol probe in an isolated disposable workspace.',
        'Do not inspect or send commentary first. Your first and only tool action must call exec_command with cmd set to "git status --short", workdir set to the current workspace, sandbox_permissions set to "require_escalated", and a short approval justification.',
        'Do not execute the command without approval. If approval is denied or unavailable, stop without retrying or running another command.',
        'Do not change files, use the network, install anything, delete files, or access any path except this isolated Git worktree and its linked metadata.',
      ].join(' '),
    })
    turnId = turn.turn.id
    terminal = await runtime.client.waitForTurn(threadId, turnId)
  } finally {
    await runtime.close()
  }
  runtime.assertHealthy()
  const approval = requireBoundCommandApprovalResolution(
    context.consumeApprovalResolutions(),
    { threadId, turnId },
  )
  const after = await readWorkspaceExample(workspace)
  return {
    workspace: workspace.root,
    approval,
    terminal: terminalSummary(terminal),
    fileChanged: before !== after,
    fixtureIntact: before === after,
    runtime: runtime.snapshot(),
  }
}

async function runMultipleTurns(
  context: SemanticsScenarioContext,
): Promise<unknown> {
  const marker = 'CTX-ORBIT-27'
  const workspace = await workspaceFor(context, 'multiturn')
  const runtime = await context.launchRuntime()
  let threadId: string
  let first: TurnTerminalResult | undefined
  let second: TurnTerminalResult | undefined
  try {
    const thread = await runtime.client.startThread({
      cwd: workspace.root,
      ephemeral: true,
    })
    threadId = thread.thread.id
    const turnOne = await runtime.client.startTurn({
      threadId,
      prompt: `Inspect this workspace without changing files. Remember the exact marker ${marker} for the next turn and repeat it in your final response.`,
    })
    first = await runtime.client.waitForTurn(threadId, turnOne.turn.id)
    requireStatus(first, 'completed', 'multi-turn turn 1')

    const turnTwo = await runtime.client.startTurn({
      threadId,
      prompt: `Using the marker from our previous turn, add the comment // Context marker: ${marker} above greet in src/example.ts, then repeat the marker and summarize the edit.`,
    })
    second = await runtime.client.waitForTurn(threadId, turnTwo.turn.id)
    requireStatus(second, 'completed', 'multi-turn turn 2')
  } finally {
    await runtime.close()
  }
  runtime.assertHealthy()
  const content = await readWorkspaceExample(workspace)
  return {
    workspace: workspace.root,
    threadId,
    turnOne: terminalSummary(first),
    turnTwo: terminalSummary(second),
    contextRetained:
      (second?.finalMessage?.includes(marker) ?? false) &&
      content.includes(marker),
    runtime: runtime.snapshot(),
  }
}

async function runMultipleThreads(
  context: SemanticsScenarioContext,
): Promise<unknown> {
  const workspaceA = await workspaceFor(context, 'multithread-a')
  const workspaceB = await workspaceFor(context, 'multithread-b')
  const runtime = await context.launchRuntime()
  let terminalA: TurnTerminalResult | undefined
  let terminalB: TurnTerminalResult | undefined
  let expectedEventKeys: string[] = []
  try {
    const [threadA, threadB] = await Promise.all([
      runtime.client.startThread({ cwd: workspaceA.root, ephemeral: true }),
      runtime.client.startThread({ cwd: workspaceB.root, ephemeral: true }),
    ])
    const [turnA, turnB] = await Promise.all([
      runtime.client.startTurn({
        threadId: threadA.thread.id,
        prompt:
          'Inspect this workspace without changing it. Reply with the exact isolated marker THREAD-ALPHA only after a short explanation.',
      }),
      runtime.client.startTurn({
        threadId: threadB.thread.id,
        prompt:
          'Inspect this workspace without changing it. Reply with the exact isolated marker THREAD-BETA only after a short explanation.',
      }),
    ])
    expectedEventKeys = [
      eventKey(threadA.thread.id, turnA.turn.id),
      eventKey(threadB.thread.id, turnB.turn.id),
    ]
    ;[terminalA, terminalB] = await Promise.all([
      runtime.client.waitForTurn(threadA.thread.id, turnA.turn.id),
      runtime.client.waitForTurn(threadB.thread.id, turnB.turn.id),
    ])
    requireStatus(terminalA, 'completed', 'multi-thread A')
    requireStatus(terminalB, 'completed', 'multi-thread B')
  } finally {
    await runtime.close()
  }
  runtime.assertHealthy()
  const snapshot = runtime.snapshot()
  const observedEventKeys = Object.keys(snapshot.eventCountsByTurn)
  return {
    workspaces: [workspaceA.root, workspaceB.root],
    threadA: terminalSummary(terminalA),
    threadB: terminalSummary(terminalB),
    isolated:
      (terminalA?.finalMessage?.includes('THREAD-ALPHA') ?? false) &&
      !(terminalA?.finalMessage?.includes('THREAD-BETA') ?? false) &&
      (terminalB?.finalMessage?.includes('THREAD-BETA') ?? false) &&
      !(terminalB?.finalMessage?.includes('THREAD-ALPHA') ?? false) &&
      observedEventKeys.every((key) => expectedEventKeys.includes(key)),
    expectedEventKeys,
    observedEventKeys,
    runtime: snapshot,
  }
}

async function runResume(context: SemanticsScenarioContext): Promise<unknown> {
  const marker = 'RESUME-CONTEXT-41'
  const workspace = await workspaceFor(context, 'resume')
  const firstRuntime = await context.launchRuntime()
  let threadId: string
  let first: TurnTerminalResult | undefined
  try {
    const thread = await firstRuntime.client.startThread({
      cwd: workspace.root,
      ephemeral: false,
    })
    threadId = thread.thread.id
    const turn = await firstRuntime.client.startTurn({
      threadId,
      prompt: `Inspect this workspace without changing it. Remember the exact marker ${marker} for a later resumed process and repeat it in your final response.`,
    })
    first = await firstRuntime.client.waitForTurn(threadId, turn.turn.id)
    requireStatus(first, 'completed', 'resume seed turn')
  } finally {
    await firstRuntime.close()
  }
  firstRuntime.assertHealthy()

  const secondRuntime = await context.launchRuntime()
  let resumedThreadId: string
  let second: TurnTerminalResult | undefined
  try {
    const resumed = await secondRuntime.client.resumeThread({
      threadId,
      cwd: workspace.root,
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
    })
    resumedThreadId = resumed.thread.id
    const turn = await secondRuntime.client.startTurn({
      threadId: resumed.thread.id,
      prompt:
        'What exact marker did I ask you to remember before this App Server process restarted? Reply with the marker and explain why you know it.',
    })
    second = await secondRuntime.client.waitForTurn(
      resumed.thread.id,
      turn.turn.id,
    )
    requireStatus(second, 'completed', 'resumed follow-up turn')
  } finally {
    await secondRuntime.close()
  }
  secondRuntime.assertHealthy()
  return {
    workspace: workspace.root,
    threadId,
    resumedThreadId,
    sameProviderThread: threadId === resumedThreadId,
    contextRetained: second?.finalMessage?.includes(marker) ?? false,
    seedTurn: terminalSummary(first),
    resumedTurn: terminalSummary(second),
    firstRuntime: firstRuntime.snapshot(),
    secondRuntime: secondRuntime.snapshot(),
  }
}

async function runInterrupt(
  context: SemanticsScenarioContext,
): Promise<unknown> {
  const workspace = await workspaceFor(context, 'interrupt')
  const runtime = await context.launchRuntime()
  let interrupted: TurnTerminalResult | undefined
  let followUp: TurnTerminalResult | undefined
  let interruptResponse: unknown
  try {
    const thread = await runtime.client.startThread({
      cwd: workspace.root,
      ephemeral: true,
    })
    const toolStarted = runtime.waitForEvent(
      (event) =>
        event.type === 'tool.started' && event.threadId === thread.thread.id,
      60_000,
    )
    // Observe rejection immediately in case startTurn fails before this promise
    // is awaited; the original promise still carries the terminal result below.
    void toolStarted.catch(() => undefined)
    const turn = await runtime.client.startTurn({
      threadId: thread.thread.id,
      prompt: [
        'Run this single safe, bounded PowerShell command and wait for it: powershell -NoProfile -Command "Start-Sleep -Seconds 20; Write-Output bounded-wait-completed".',
        'Do not change files, access the network, or run any other command. Summarize only after it finishes.',
      ].join(' '),
    })
    const startedEvent = await toolStarted
    if (
      startedEvent.type !== 'tool.started' ||
      startedEvent.turnId !== turn.turn.id
    ) {
      throw new Error('Observed tool event belonged to an unexpected turn')
    }
    await delay(500)
    interruptResponse = await runtime.client.interruptTurn({
      threadId: thread.thread.id,
      turnId: turn.turn.id,
    })
    interrupted = await runtime.client.waitForTurn(
      thread.thread.id,
      turn.turn.id,
    )
    requireStatus(interrupted, 'interrupted', 'interrupted turn')

    const next = await runtime.client.startTurn({
      threadId: thread.thread.id,
      prompt:
        'Confirm this same thread remains usable after the interruption. Reply with exactly THREAD_CONTINUES.',
    })
    followUp = await runtime.client.waitForTurn(thread.thread.id, next.turn.id)
    requireStatus(followUp, 'completed', 'post-interrupt follow-up')
  } finally {
    await runtime.close()
  }
  runtime.assertHealthy()
  return {
    workspace: workspace.root,
    interruptResponse,
    interruptedTurn: terminalSummary(interrupted),
    followUpTurn: terminalSummary(followUp),
    threadContinued:
      followUp?.finalMessage?.includes('THREAD_CONTINUES') ?? false,
    runtime: runtime.snapshot(),
  }
}

async function runFailure(context: SemanticsScenarioContext): Promise<unknown> {
  const workspace = await workspaceFor(context, 'failure')
  const runtime = await context.launchRuntime()
  let terminal: TurnTerminalResult | undefined
  try {
    const thread = await runtime.client.startThread({
      cwd: workspace.root,
      ephemeral: true,
    })
    const turn = await runtime.client.startTurn({
      threadId: thread.thread.id,
      prompt: [
        'Run exactly this safe command with no side effects: powershell -NoProfile -Command "exit 7".',
        'Do not retry it and do not change files. Explain the non-zero result in your final response.',
      ].join(' '),
    })
    terminal = await runtime.client.waitForTurn(thread.thread.id, turn.turn.id)
  } finally {
    await runtime.close()
  }
  runtime.assertHealthy()
  const snapshot = runtime.snapshot()
  return {
    workspace: workspace.root,
    terminal: terminalSummary(terminal),
    commandFailureObserved: snapshot.failedToolCount > 0,
    wholeTurnFailed: terminal?.turn.status === 'failed',
    runtime: snapshot,
  }
}

async function workspaceFor(
  context: SemanticsScenarioContext,
  suffix: string,
): Promise<SpikeWorkspace> {
  return await prepareIsolatedWorkspace(
    context.repositoryRoot,
    `codetether-codex-semantics-${suffix}`,
  )
}

function terminalSummary(terminal: TurnTerminalResult | undefined): unknown {
  if (terminal === undefined) return null
  return {
    threadId: terminal.threadId,
    turnId: terminal.turn.id,
    status: terminal.turn.status,
    error: terminal.turn.error ?? null,
    finalMessage: terminal.finalMessage ?? '',
  }
}

function requireStatus(
  terminal: TurnTerminalResult,
  expected: CodexTurnStatus,
  context: string,
): void {
  if (terminal.turn.status !== expected) {
    throw new Error(
      `${context} ended with ${terminal.turn.status}; expected ${expected}`,
    )
  }
}

export function requireBoundCommandApprovalResolution(
  resolutions: readonly SemanticsApprovalResolution[],
  expected: { readonly threadId: string; readonly turnId: string },
): SemanticsApprovalResolution {
  const approval = resolutions.find(
    (candidate) =>
      isCommandApprovalMethod(candidate.method) &&
      candidate.identity.threadId === expected.threadId &&
      candidate.identity.turnId === expected.turnId,
  )
  if (approval === undefined) {
    throw new Error(
      `Approval scenario observed no command approval bound to thread ${expected.threadId} turn ${expected.turnId}`,
    )
  }
  if (
    approval.identity.itemId === null ||
    approval.identity.itemId.trim().length === 0
  ) {
    throw new Error('Approval scenario observed no bound command item identity')
  }
  if (approval.identity.approvalId.trim().length === 0) {
    throw new Error('Approval scenario observed no approval identity')
  }
  if (
    typeof approval.requestId === 'string' &&
    approval.requestId.trim().length === 0
  ) {
    throw new Error('Approval scenario observed an empty request identity')
  }
  if (
    approval.paramsShape !== undefined &&
    !approval.paramsShape.includes('approvalId') &&
    approval.identity.approvalId !== String(approval.requestId)
  ) {
    throw new Error(
      'Approval scenario did not preserve JSON-RPC request identity as approval identity',
    )
  }
  assertExpectedApprovalResponse(approval)
  return approval
}

function isCommandApprovalMethod(method: string): boolean {
  return (
    method === 'item/commandExecution/requestApproval' ||
    method === 'execCommandApproval'
  )
}

function assertExpectedApprovalResponse(
  approval: SemanticsApprovalResolution,
): void {
  if (!('result' in approval.response) || !isRecord(approval.response.result)) {
    throw new Error(
      'Command approval did not receive a successful wire response',
    )
  }

  const wireDecision = approval.response.result.decision
  if (approval.method === 'item/commandExecution/requestApproval') {
    const expected = approval.decision === 'allow' ? 'accept' : 'decline'
    if (wireDecision !== expected) {
      throw new Error(
        `Command approval decision ${approval.decision} produced unexpected wire decision`,
      )
    }
    return
  }

  if (approval.decision === 'allow') {
    if (wireDecision !== 'approved') {
      throw new Error(
        'Legacy command approval allow did not produce an approved wire decision',
      )
    }
    return
  }
  if (
    !isRecord(wireDecision) ||
    !isRecord(wireDecision.denied) ||
    typeof wireDecision.denied.rejection !== 'string'
  ) {
    throw new Error(
      'Legacy command approval denial did not produce a denied wire decision',
    )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function eventKey(threadId: string, turnId: string): string {
  return `${threadId}\u0000${turnId}`
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
}
