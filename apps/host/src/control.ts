import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { CodeTetherClient } from '@codetether/client'
import { ActionIdSchema } from '@codetether/protocol'

import { startLocalCodexHost } from './api/local-codex-host.js'
import {
  prepareApprovalWorkspace,
  prepareIsolatedWorkspace,
} from './spike-workspace.js'

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))

async function main(): Promise<void> {
  const [workspace, approvalWorkspace, hostVersion] = await Promise.all([
    prepareIsolatedWorkspace(
      repositoryRoot,
      'codetether-codex-semantics-browser-control',
    ),
    prepareApprovalWorkspace(repositoryRoot),
    readHostVersion(),
  ])
  const host = await startLocalCodexHost({
    allowedWorkspaceRoots: [workspace.root, approvalWorkspace.root],
    allowedOrigins: ['http://127.0.0.1:5173', 'http://localhost:5173'],
    hostVersion,
    executable: process.env.CODETETHER_CODEX_PATH ?? 'codex',
    disableHooks: true,
    port: 4317,
  })

  try {
    const client = new CodeTetherClient({ baseUrl: host.baseUrl })
    const machines = (await client.listMachines()).machines
    const localMachine = machines.find((machine) => machine.kind === 'local')
    if (localMachine === undefined) throw new Error('Local Machine is missing')
    const machineId = localMachine.machineId
    const [generalProject, approvalProject] = await Promise.all([
      client.createProject({
        actionId: actionId(),
        path: workspace.root,
      }),
      client.createProject({
        actionId: actionId(),
        path: approvalWorkspace.root,
      }),
    ])
    const [general, approval] = await Promise.all([
      client.createConversation({
        actionId: actionId(),
        provider: 'codex',
        projectId: generalProject.data.project.projectId,
        machineId,
      }),
      client.createConversation({
        actionId: actionId(),
        provider: 'codex',
        projectId: approvalProject.data.project.projectId,
        machineId,
      }),
    ])
    const generalId = general.data.conversation.conversationId
    const approvalId = approval.data.conversation.conversationId
    process.stdout.write(
      `${JSON.stringify({
        kind: 'browser-control.ready',
        baseUrl: host.baseUrl,
        epoch: host.epoch,
        databasePath: host.databasePath,
        generalWorkspace: workspace.root,
        approvalWorkspace: approvalWorkspace.root,
        generalConversationId: generalId,
        generalRoute: `/conversations/${generalId}`,
        approvalConversationId: approvalId,
        approvalRoute: `/conversations/${approvalId}`,
      })}\n`,
    )
    await waitForShutdownSignal()
  } finally {
    await host.close()
  }
}

async function readHostVersion(): Promise<string> {
  const text = await readFile(
    new URL('../package.json', import.meta.url),
    'utf8',
  )
  const value = JSON.parse(text) as { readonly version?: unknown }
  if (typeof value.version !== 'string' || value.version.trim().length === 0) {
    throw new Error('Host package version is invalid')
  }
  return value.version
}

function actionId(): ReturnType<typeof ActionIdSchema.parse> {
  return ActionIdSchema.parse(`act_${randomUUID().replaceAll('-', '')}`)
}

async function waitForShutdownSignal(): Promise<void> {
  await new Promise<void>((resolve) => {
    const stop = (): void => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      resolve()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[codetether:control] ${message}\n`)
  process.exitCode = 1
})
