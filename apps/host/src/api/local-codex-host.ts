import { HostEventPublisher } from './host-event-publisher.js'
import { HostService, newEpoch } from './host-service.js'
import {
  LocalHttpServer,
  type LocalHttpServerOptions,
} from './local-http-server.js'
import { CodexHostRuntime } from './codex-host-runtime.js'
import { WorkspacePolicy } from './workspace-policy.js'

export interface LocalCodexHostOptions {
  readonly allowedWorkspaceRoots: readonly string[]
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
}

export interface RunningLocalCodexHost {
  readonly baseUrl: string
  readonly epoch: string
  readonly service: HostService
  close(): Promise<void>
}

export async function startLocalCodexHost(
  options: LocalCodexHostOptions,
): Promise<RunningLocalCodexHost> {
  const workspacePolicy = await WorkspacePolicy.create(
    options.allowedWorkspaceRoots,
  )
  const runtime = await CodexHostRuntime.launch({
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
  const publisher = new HostEventPublisher({
    epoch: newEpoch(),
    ...(options.replayMaxEvents === undefined
      ? {}
      : { maxEvents: options.replayMaxEvents }),
    ...(options.replayMaxBytes === undefined
      ? {}
      : { maxBytes: options.replayMaxBytes }),
  })
  const service = new HostService({
    runtime,
    workspacePolicy,
    publisher,
    hostVersion: options.hostVersion,
  })
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
  const server = new LocalHttpServer(serverOptions)
  try {
    const baseUrl = await server.start(options.port)
    return {
      baseUrl,
      epoch: publisher.epoch,
      service,
      close: async () => await server.close(),
    }
  } catch (error) {
    await server.close().catch(() => undefined)
    throw error
  }
}
