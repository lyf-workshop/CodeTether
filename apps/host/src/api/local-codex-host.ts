import { HostEventPublisher } from './host-event-publisher.js'
import { ConversationStore } from '../persistence/index.js'
import type { AgentHostRuntime } from './agent-runtime.js'
import { HostService, newEpoch } from './host-service.js'
import {
  LocalHttpServer,
  type LocalHttpServerOptions,
} from './local-http-server.js'
import { CodexHostRuntime } from './codex-host-runtime.js'
import { UnavailableAgentRuntime } from './unavailable-agent-runtime.js'
import { WorkspacePolicy } from './workspace-policy.js'

export interface LocalCodexHostOptions {
  readonly allowedWorkspaceRoots?: readonly string[]
  readonly allowedOrigins: readonly string[]
  readonly hostVersion: string
  readonly port?: number
  readonly executable?: string
  readonly disableHooks?: boolean
  readonly ephemeralThreads?: boolean
  readonly replayMaxEvents?: number
  readonly replayMaxBytes?: number
  readonly maxClients?: number
  readonly maxQueuedEvents?: number
  readonly maxQueuedBytes?: number
  readonly maxFrameBytes?: number
  readonly heartbeatMs?: number
  readonly bodyLimitBytes?: number
  readonly maxConversations?: number
  /** Tests and non-durable transport harnesses may explicitly opt out. */
  readonly persistence?: boolean
  readonly databasePath?: string
}

export interface RunningLocalCodexHost {
  readonly baseUrl: string
  readonly epoch: string
  readonly service: HostService
  readonly databasePath?: string
  close(): Promise<void>
}

export async function startLocalCodexHost(
  options: LocalCodexHostOptions,
): Promise<RunningLocalCodexHost> {
  const workspacePolicy = await WorkspacePolicy.create(
    options.allowedWorkspaceRoots ?? [],
  )
  const persistence =
    options.persistence === false
      ? undefined
      : ConversationStore.open({
          ...(options.databasePath === undefined
            ? {}
            : { databasePath: options.databasePath }),
        })
  let runtime: AgentHostRuntime
  try {
    runtime = await CodexHostRuntime.launch({
      version: options.hostVersion,
      ...(options.executable === undefined
        ? {}
        : { executable: options.executable }),
      ...(options.disableHooks === undefined
        ? {}
        : { disableHooks: options.disableHooks }),
      ...(options.ephemeralThreads === undefined
        ? {}
        : { ephemeralThreads: options.ephemeralThreads }),
    })
  } catch (error) {
    runtime = new UnavailableAgentRuntime()
    process.stderr.write(
      `[codetether:runtime-unavailable] Codex launch failed (${safeErrorName(error)}); durable APIs remain read-only\n`,
    )
  }
  try {
    return await startLocalCodexHostWithRuntime(
      options,
      runtime,
      workspacePolicy,
      persistence,
    )
  } catch (error) {
    try {
      persistence?.close()
    } catch {
      // Preserve the launch/assembly failure.
    }
    throw error
  }
}

function safeErrorName(error: unknown): string {
  return error instanceof Error && error.name.trim().length > 0
    ? error.name
    : 'Error'
}

/** Testable assembly boundary that owns Runtime cleanup after launch. */
export async function startLocalCodexHostWithRuntime(
  options: LocalCodexHostOptions,
  runtime: AgentHostRuntime,
  workspacePolicy: WorkspacePolicy,
  persistence?: ConversationStore,
): Promise<RunningLocalCodexHost> {
  let service: HostService | undefined
  let server: LocalHttpServer | undefined
  try {
    const publisher = new HostEventPublisher({
      epoch: newEpoch(),
      ...(options.replayMaxEvents === undefined
        ? {}
        : { maxEvents: options.replayMaxEvents }),
      ...(options.replayMaxBytes === undefined
        ? {}
        : { maxBytes: options.replayMaxBytes }),
    })
    service = new HostService({
      runtime,
      workspacePolicy,
      publisher,
      hostVersion: options.hostVersion,
      ...(options.maxConversations === undefined
        ? {}
        : { maxConversations: options.maxConversations }),
      ...(persistence === undefined ? {} : { persistence }),
    })
    await service.registerInitialProjectRoots(
      options.allowedWorkspaceRoots ?? [],
    )
    const serverOptions: LocalHttpServerOptions = {
      service,
      allowedOrigins: options.allowedOrigins,
      ...(options.maxClients === undefined
        ? {}
        : { maxClients: options.maxClients }),
      ...(options.maxQueuedEvents === undefined
        ? {}
        : { maxQueuedEvents: options.maxQueuedEvents }),
      ...(options.maxQueuedBytes === undefined
        ? {}
        : { maxQueuedBytes: options.maxQueuedBytes }),
      ...(options.maxFrameBytes === undefined
        ? {}
        : { maxFrameBytes: options.maxFrameBytes }),
      ...(options.heartbeatMs === undefined
        ? {}
        : { heartbeatMs: options.heartbeatMs }),
      ...(options.bodyLimitBytes === undefined
        ? {}
        : { bodyLimitBytes: options.bodyLimitBytes }),
    }
    const localServer = new LocalHttpServer(serverOptions)
    server = localServer
    const baseUrl = await localServer.start(options.port)
    return {
      baseUrl,
      epoch: publisher.epoch,
      service,
      ...(persistence === undefined
        ? {}
        : { databasePath: persistence.databasePath }),
      close: async () => await localServer.close(),
    }
  } catch (error) {
    if (server !== undefined) {
      await server.close().catch(() => undefined)
    } else if (service !== undefined) {
      await service.close().catch(() => undefined)
    } else {
      await runtime.close().catch(() => undefined)
      try {
        persistence?.close()
      } catch {
        // Preserve the assembly failure.
      }
    }
    throw error
  }
}
