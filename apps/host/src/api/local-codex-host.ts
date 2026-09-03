import {
  CLAUDE_CODE_TESTED_VERSION,
  classifyClaudeCodeDetectionFailure,
  prepareClaudeCode,
  type ClaudeCodeDetection,
} from '@codetether/adapter-claude'
import { canonicalFailure } from '@codetether/agent-core'
import type { ProviderDescriptor } from '@codetether/protocol'

import { HostEventPublisher } from './host-event-publisher.js'
import { ConversationStore } from '../persistence/index.js'
import type { AgentHostRuntime } from './agent-runtime.js'
import { HostService, newEpoch } from './host-service.js'
import {
  LocalHttpServer,
  type LocalHttpServerOptions,
} from './local-http-server.js'
import { CodexHostRuntime } from './codex-host-runtime.js'
import {
  classifyCanonicalFailure,
  providerExecutionHealthState,
} from './canonical-failure.js'
import {
  CLAUDE_CODE_REASONING_LABEL,
  ClaudeCodeHostRuntime,
  claudeCodeReasoningOptions,
} from './claude-code-host-runtime.js'
import { UnavailableAgentRuntime } from './unavailable-agent-runtime.js'
import {
  LOCAL_CODEX_CAPABILITIES,
  UNAVAILABLE_PROVIDER_CAPABILITIES,
} from './provider-registry.js'
import { WorkspacePolicy } from './workspace-policy.js'
import { safeErrorNameForLog } from './safe-log.js'
import {
  SecureRemoteMachineCoordinator,
  type RemoteMachineCoordinator,
} from './remote-machine-coordinator.js'

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
  /** Assembly fact used only for truthful local Machine capabilities. */
  readonly desktopManaged?: boolean
  /** Explicit test-only opt-in; production remote pairing rejects loopback. */
  readonly remoteMachineLoopbackForTests?: boolean
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
  const runtimes = await Promise.all(
    (['codex', 'claude-code'] as const).map(
      async (provider) => await createLocalProviderRuntime(provider, options),
    ),
  )
  try {
    return await startLocalCodexHostWithRuntime(
      options,
      runtimes,
      workspacePolicy,
      persistence,
      async (provider) => await createLocalProviderRuntime(provider, options),
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

/** Converts a local Codex launch failure into installation and health truth. */
export function codexUnavailableDescriptor(
  error: unknown,
  observedAt: string,
): ProviderDescriptor {
  const failure = classifyCanonicalFailure(
    error,
    observedAt,
    'provider_start_failed',
  )
  const availability = codexFailureAvailability(failure.reason)
  return {
    provider: 'codex',
    displayName: 'Codex',
    availability,
    capabilities:
      availability === 'available'
        ? LOCAL_CODEX_CAPABILITIES
        : UNAVAILABLE_PROVIDER_CAPABILITIES,
    executionHealth: {
      state: providerExecutionHealthState(failure),
      freshness: 'current',
      observedAt,
      failure,
    },
  }
}

type UnavailableClaudeCodeDetection = Exclude<
  ClaudeCodeDetection,
  { readonly status: 'available' }
>

/** Converts private detection diagnostics into bounded public execution truth. */
export function claudeCodeUnavailableDescriptor(
  detection: UnavailableClaudeCodeDetection,
  observedAt: string,
): ProviderDescriptor {
  const failureReason = classifyClaudeCodeDetectionFailure(detection)
  return {
    provider: 'claude-code',
    displayName: 'Claude Code',
    // Authentication is execution health, not installation discovery. A
    // logged-out but tested CLI remains installed/available while the runtime
    // gate below stays closed by its login-required health observation.
    availability:
      failureReason === 'login_required'
        ? 'available'
        : claudeDetectionAvailability(detection.status),
    capabilities: detection.capabilities,
    testedVersion: CLAUDE_CODE_TESTED_VERSION,
    reasoningLabel: CLAUDE_CODE_REASONING_LABEL,
    reasoningOptions: claudeCodeReasoningOptions(),
    ...('version' in detection ? { version: detection.version } : {}),
    ...(failureReason === undefined
      ? {}
      : {
          executionHealth: {
            state: 'unavailable',
            freshness: 'current',
            observedAt,
            failure: canonicalFailure(failureReason, observedAt),
          },
        }),
  }
}

function claudeDetectionAvailability(
  status: 'unsupportedVersion' | 'notInstalled' | 'misconfigured',
): ProviderDescriptor['availability'] {
  switch (status) {
    case 'unsupportedVersion':
      return 'unsupported_version'
    case 'notInstalled':
      return 'not_installed'
    case 'misconfigured':
      return 'misconfigured'
  }
}

function codexFailureAvailability(
  reason: ReturnType<typeof classifyCanonicalFailure>['reason'],
): ProviderDescriptor['availability'] {
  switch (reason) {
    case 'provider_not_installed':
      return 'not_installed'
    case 'provider_unsupported_version':
      return 'unsupported_version'
    case 'provider_misconfigured':
      return 'misconfigured'
    case 'provider_start_failed':
      return 'unavailable'
    default:
      return 'available'
  }
}

/** Testable assembly boundary that owns Runtime cleanup after launch. */
export async function startLocalCodexHostWithRuntime(
  options: LocalCodexHostOptions,
  runtime: AgentHostRuntime | readonly AgentHostRuntime[],
  workspacePolicy: WorkspacePolicy,
  persistence?: ConversationStore,
  refreshUnavailableLocalProvider?: (
    provider: AgentHostRuntime['provider'],
  ) => Promise<AgentHostRuntime>,
): Promise<RunningLocalCodexHost> {
  const runtimes = Array.isArray(runtime) ? runtime : [runtime]
  let service: HostService | undefined
  let server: LocalHttpServer | undefined
  let remoteMachineCoordinator: RemoteMachineCoordinator | undefined
  try {
    if (persistence !== undefined) {
      remoteMachineCoordinator = await SecureRemoteMachineCoordinator.create({
        persistence,
        allowLoopbackForTests: options.remoteMachineLoopbackForTests === true,
      })
    }
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
      runtimes,
      workspacePolicy,
      publisher,
      hostVersion: options.hostVersion,
      desktopManaged: options.desktopManaged === true,
      ...(options.maxConversations === undefined
        ? {}
        : { maxConversations: options.maxConversations }),
      ...(persistence === undefined ? {} : { persistence }),
      ...(remoteMachineCoordinator === undefined
        ? {}
        : { remoteMachineCoordinator }),
      ...(refreshUnavailableLocalProvider === undefined
        ? {}
        : { refreshUnavailableLocalProvider }),
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
      await remoteMachineCoordinator?.close?.().catch(() => undefined)
      await Promise.allSettled(
        runtimes.map(async (providerRuntime) => await providerRuntime.close()),
      )
      try {
        persistence?.close()
      } catch {
        // Preserve the assembly failure.
      }
    }
    throw error
  }
}

async function createLocalProviderRuntime(
  provider: AgentHostRuntime['provider'],
  options: LocalCodexHostOptions,
): Promise<AgentHostRuntime> {
  if (provider === 'claude-code') {
    const preparation = await prepareClaudeCode()
    const detection = preparation.detection
    return detection.status === 'available'
      ? new ClaudeCodeHostRuntime(detection, preparation.runtimeEnvironment())
      : new UnavailableAgentRuntime(
          'claude-code',
          claudeCodeUnavailableDescriptor(detection, new Date().toISOString()),
        )
  }
  try {
    return await CodexHostRuntime.launch({
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
    process.stderr.write(
      `[codetether:runtime-unavailable] Codex launch failed (${safeErrorNameForLog(error)}); durable APIs remain read-only\n`,
    )
    return new UnavailableAgentRuntime(
      'codex',
      codexUnavailableDescriptor(error, new Date().toISOString()),
    )
  }
}
