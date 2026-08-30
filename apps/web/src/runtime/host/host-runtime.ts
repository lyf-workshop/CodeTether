import {
  CodeTetherClient,
  CodeTetherIncompatibleProtocolError,
} from '@codetether/client'
import {
  formatLastEventId,
  type ApprovalDecision,
  type AttentionId,
  type Bootstrap,
  type ConversationId,
  type HostEventEnvelope,
  type HostSnapshot,
  type LastEventId,
  type ProjectId,
} from '@codetether/protocol'
import type { QueryClient } from '@tanstack/react-query'

import {
  applyHostEvent,
  projectSnapshot,
  type ConversationProjection,
} from './conversation-projection.js'
import { hostBaseUrl } from './host-config.js'
import {
  hostBootstrapQueryOptions,
  hostQueryKeys,
  hostSnapshotQueryOptions,
  readHostProjection,
  replaceHostProjection,
  type HostReadClient,
} from './host-query.js'
import {
  LiveConversationActions,
  type LiveConversationMutationClient,
} from './live-conversation-actions.js'
import type { ConversationDetailReadClient } from './conversation-detail-query.js'
import {
  ConversationOrganizationActions,
  type ConversationOrganizationMutationClient,
} from './conversation-organization-actions.js'
import {
  invalidateConversationDurableQueries,
  invalidateConversationProductQueries,
} from './conversation-index-sync.js'
import type { ConversationListReadClient } from './conversation-list-query.js'
import type { ConversationSearchReadClient } from './conversation-search-query.js'
import {
  NewConversationActions,
  type NewConversationMutationClient,
} from './new-conversation-actions.js'
import {
  ProjectActions,
  type ProjectMutationClient,
} from './project-actions.js'
import type { ProjectReadClient } from './project-query.js'
import {
  AttentionActions,
  type AttentionMutationClient,
} from './attention-actions.js'
import {
  invalidateAttentionQueries,
  shouldRefreshAttention,
  type AttentionReadClient,
} from './attention-query.js'

export type HostConnectionState =
  'connecting' | 'connected' | 'reconnecting' | 'unavailable' | 'incompatible'

export interface HostEventStream extends AsyncIterable<HostEventEnvelope> {
  readonly lastEventId?: LastEventId
  close(): Promise<void>
}

export interface HostRuntimeClient
  extends
    HostReadClient,
    LiveConversationMutationClient,
    ProjectReadClient,
    ProjectMutationClient,
    ConversationDetailReadClient,
    ConversationListReadClient,
    ConversationSearchReadClient,
    ConversationOrganizationMutationClient,
    NewConversationMutationClient,
    AttentionReadClient,
    AttentionMutationClient {
  connectEvents(options?: {
    readonly lastEventId?: LastEventId
    readonly signal?: AbortSignal
  }): Promise<HostEventStream>
}

export interface HostRuntimeStats {
  readonly bootstrapRequests: number
  readonly snapshotRequests: number
  readonly snapshotReplacements: number
  readonly streamConnections: number
  readonly reconnectAttempts: number
  readonly resumeRecoveries: number
  readonly hostEvents: number
  readonly projectionUpdates: number
  readonly duplicateEvents: number
  readonly resetRecoveries: number
}

export interface HostRuntimeOptions {
  readonly queryClient: QueryClient
  readonly client?: HostRuntimeClient
  readonly baseUrl?: string
  readonly reconnectDelayMs?: number
}

type ConnectionListener = () => void
export type AppliedHostEvent = Exclude<
  HostEventEnvelope,
  { readonly type: 'stream.reset' }
>
export type AppliedHostEventListener = (event: AppliedHostEvent) => void

const runtimesByQueryClient = new WeakMap<QueryClient, HostRuntime>()
const RELEASE_GRACE_MS = 100

class OwnedDesktopHostIdentityError extends Error {}

export class HostRuntime {
  readonly #queryClient: QueryClient
  readonly #client: HostRuntimeClient
  readonly #reconnectDelayMs: number
  readonly #listeners = new Set<ConnectionListener>()
  readonly #appliedEventListeners = new Set<AppliedHostEventListener>()
  readonly #actions: LiveConversationActions
  readonly #projectActions: ProjectActions
  readonly #newConversationActions: NewConversationActions
  readonly #attentionActions: AttentionActions
  readonly #conversationOrganizationActions: ConversationOrganizationActions
  #connectionState: HostConnectionState = 'connecting'
  #lastError: unknown
  #started = false
  #generation = 0
  #abortController?: AbortController
  #runPromise?: Promise<void>
  #stream?: HostEventStream
  #streamConnectAbortController?: AbortController
  #resumeReconnectRequested = false
  #ownedDesktopHostEpoch?: Bootstrap['epoch']
  #bootstrap?: Bootstrap
  #retainers = 0
  #stopTimer?: ReturnType<typeof setTimeout>
  #stats: HostRuntimeStats = emptyStats()

  constructor(options: HostRuntimeOptions) {
    this.#queryClient = options.queryClient
    this.#client =
      options.client ??
      new CodeTetherClient({ baseUrl: options.baseUrl ?? hostBaseUrl })
    this.#actions = new LiveConversationActions(this.#client)
    this.#projectActions = new ProjectActions(this.#client)
    this.#newConversationActions = new NewConversationActions(this.#client)
    this.#attentionActions = new AttentionActions(this.#client)
    this.#conversationOrganizationActions = new ConversationOrganizationActions(
      this.#client,
      this.#queryClient,
    )
    this.#reconnectDelayMs = nonNegativeInteger(
      options.reconnectDelayMs,
      500,
      'reconnectDelayMs',
    )
  }

  get connectionState(): HostConnectionState {
    return this.#connectionState
  }

  get lastError(): unknown {
    return this.#lastError
  }

  get stats(): HostRuntimeStats {
    return { ...this.#stats }
  }

  get projection(): ConversationProjection | undefined {
    return readHostProjection(this.#queryClient)
  }

  get bootstrap(): Bootstrap | undefined {
    return this.#bootstrap
  }

  readonly subscribe = (listener: ConnectionListener): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  readonly getConnectionState = (): HostConnectionState => this.#connectionState

  /**
   * Observes only envelopes that passed epoch/sequence validation and advanced
   * the canonical projection cursor. Snapshot recovery and stream resets are
   * deliberately not application events.
   */
  readonly subscribeAppliedEvents = (
    listener: AppliedHostEventListener,
  ): (() => void) => {
    this.#appliedEventListeners.add(listener)
    return () => this.#appliedEventListeners.delete(listener)
  }

  startTurn(conversationId: string, text: string) {
    return this.#actions.startTurn(conversationId, text)
  }

  interruptTurn(conversationId: string, turnId: string) {
    return this.#actions.interruptTurn(conversationId, turnId)
  }

  resolveApproval(approvalId: string, decision: ApprovalDecision) {
    return this.#actions.resolveApproval(approvalId, decision)
  }

  listAttention(options?: Parameters<AttentionReadClient['listAttention']>[0]) {
    return this.#client.listAttention(options)
  }

  resolveAttention(attentionId: AttentionId | string) {
    return this.#attentionActions.resolveAttention(attentionId)
  }

  listProjects(options?: { readonly signal?: AbortSignal }) {
    return this.#client.listProjects(options)
  }

  getProject(
    projectId: ProjectId,
    options?: { readonly signal?: AbortSignal },
  ) {
    return this.#client.getProject(projectId, options)
  }

  listProjectConversations(
    projectId: ProjectId,
    options?: Parameters<
      ConversationListReadClient['listProjectConversations']
    >[1],
  ) {
    return this.#client.listProjectConversations(projectId, options)
  }

  searchProjectConversations(
    projectId: ProjectId,
    options: Parameters<
      ConversationSearchReadClient['searchProjectConversations']
    >[1],
  ) {
    return this.#client.searchProjectConversations(projectId, options)
  }

  getConversation(
    conversationId: ConversationId,
    options?: { readonly signal?: AbortSignal },
  ) {
    return this.#client.getConversation(conversationId, options)
  }

  renameConversation(conversationId: ConversationId | string, title: string) {
    return this.#conversationOrganizationActions.renameConversation(
      conversationId,
      title,
    )
  }

  pinConversation(conversationId: ConversationId | string) {
    return this.#conversationOrganizationActions.pinConversation(conversationId)
  }

  unpinConversation(conversationId: ConversationId | string) {
    return this.#conversationOrganizationActions.unpinConversation(
      conversationId,
    )
  }

  archiveConversation(conversationId: ConversationId | string) {
    return this.#conversationOrganizationActions.archiveConversation(
      conversationId,
    )
  }

  unarchiveConversation(conversationId: ConversationId | string) {
    return this.#conversationOrganizationActions.unarchiveConversation(
      conversationId,
    )
  }

  createConversation(projectId: ProjectId | string) {
    return this.#newConversationActions.createConversation(projectId)
  }

  createProject(path: string, name?: string) {
    return this.#projectActions.createProject(path, name)
  }

  deleteProject(projectId: ProjectId | string) {
    return this.#projectActions.deleteProject(projectId)
  }

  start(): void {
    if (this.#started) return
    this.#started = true
    const generation = ++this.#generation
    const abortController = new AbortController()
    this.#abortController = abortController
    this.#lastError = undefined
    this.#setConnectionState('connecting')
    const runPromise = this.#run(generation, abortController.signal)
    this.#runPromise = runPromise
    const finalize = (): void => {
      if (this.#runPromise === runPromise) this.#runPromise = undefined
      if (this.#abortController === abortController) {
        this.#abortController = undefined
      }
      if (this.#generation === generation) this.#started = false
    }
    void runPromise.then(finalize, finalize)
  }

  retry(): void {
    if (
      this.#started ||
      (this.#connectionState !== 'unavailable' &&
        this.#connectionState !== 'incompatible')
    ) {
      return
    }
    this.start()
  }

  /**
   * Revalidates a potentially half-open post-suspend SSE transport without
   * replacing product state or inventing a second recovery protocol. Closing
   * the one current stream makes the existing loop reconnect immediately with
   * its canonical Last-Event-ID cursor.
   */
  recoverAfterDesktopResume(intent: {
    readonly hostEpoch: Bootstrap['epoch']
  }): void {
    this.#ownedDesktopHostEpoch = intent.hostEpoch
    if (!this.#started) {
      if (this.#retainers > 0) this.start()
      return
    }
    const stream = this.#stream
    const pendingConnection = this.#streamConnectAbortController
    if (this.#resumeReconnectRequested) return
    this.#resumeReconnectRequested = true
    this.#increment('resumeRecoveries')
    if (stream !== undefined) void stream.close().catch(() => undefined)
    else pendingConnection?.abort()
  }

  retain(): () => void {
    this.#retainers += 1
    if (this.#stopTimer !== undefined) {
      clearTimeout(this.#stopTimer)
      this.#stopTimer = undefined
    }
    this.start()
    let released = false
    return () => {
      if (released) return
      released = true
      this.#retainers = Math.max(0, this.#retainers - 1)
      if (this.#retainers !== 0) return
      this.#stopTimer = setTimeout(() => {
        this.#stopTimer = undefined
        if (this.#retainers !== 0) return
        void this.stop()
      }, RELEASE_GRACE_MS)
    }
  }

  async stop(): Promise<void> {
    if (this.#stopTimer !== undefined) {
      clearTimeout(this.#stopTimer)
      this.#stopTimer = undefined
    }
    if (!this.#started && this.#runPromise === undefined) return
    this.#started = false
    this.#generation += 1
    this.#resumeReconnectRequested = false
    this.#abortController?.abort()
    this.#abortController = undefined
    this.#streamConnectAbortController?.abort()
    this.#streamConnectAbortController = undefined
    const stream = this.#stream
    this.#stream = undefined
    await stream?.close().catch(() => undefined)
    await Promise.all([
      this.#queryClient.cancelQueries({
        queryKey: hostQueryKeys.bootstrap,
        exact: true,
      }),
      this.#queryClient.cancelQueries({
        queryKey: hostQueryKeys.snapshot,
        exact: true,
      }),
    ])
    await this.#runPromise?.catch(() => undefined)
  }

  async #run(generation: number, signal: AbortSignal): Promise<void> {
    try {
      let bootstrap = await this.#fetchBootstrap()
      if (!this.#isActive(generation)) return
      let cursor = await this.#fetchAndReplaceSnapshot(
        generation,
        bootstrap.epoch,
      )
      if (!this.#isActive(generation) || cursor === undefined) return
      let snapshotRequired = false

      while (this.#isActive(generation)) {
        if (this.#resumeReconnectRequested) {
          this.#setConnectionState('reconnecting')
          try {
            bootstrap = await this.#fetchBootstrap()
            this.#resumeReconnectRequested = false
          } catch (error) {
            if (!this.#isActive(generation)) return
            if (
              error instanceof OwnedDesktopHostIdentityError ||
              error instanceof CodeTetherIncompatibleProtocolError
            ) {
              throw error
            }
            this.#lastError = error
            this.#increment('reconnectAttempts')
            await waitForDelay(this.#reconnectDelayMs, signal)
            continue
          }
        }
        if (snapshotRequired) {
          this.#setConnectionState('reconnecting')
          try {
            bootstrap = await this.#fetchBootstrap()
            const replacement = await this.#fetchAndReplaceSnapshot(
              generation,
              bootstrap.epoch,
            )
            if (!this.#isActive(generation)) return
            if (replacement === undefined) continue
            cursor = replacement
            snapshotRequired = false
          } catch (error) {
            if (!this.#isActive(generation)) return
            if (
              error instanceof OwnedDesktopHostIdentityError ||
              error instanceof CodeTetherIncompatibleProtocolError
            ) {
              throw error
            }
            this.#lastError = error
            this.#increment('reconnectAttempts')
            await waitForDelay(this.#reconnectDelayMs, signal)
            continue
          }
        }

        // A resume event can arrive after the top-of-loop validation and
        // before connectEvents installs its abort controller. Re-enter the
        // loop instead of opening an unvalidated transport in that gap.
        if (this.#resumeReconnectRequested) continue

        let stream: HostEventStream | undefined
        const streamConnectAbortController = new AbortController()
        this.#streamConnectAbortController = streamConnectAbortController
        try {
          this.#increment('streamConnections')
          stream = await this.#client.connectEvents({
            lastEventId: cursor,
            signal: AbortSignal.any([
              signal,
              streamConnectAbortController.signal,
            ]),
          })
          if (
            this.#streamConnectAbortController === streamConnectAbortController
          ) {
            this.#streamConnectAbortController = undefined
          }
          if (!this.#isActive(generation)) {
            await stream.close().catch(() => undefined)
            return
          }
          this.#stream = stream
          this.#lastError = undefined
          this.#setConnectionState('connected')

          for await (const event of stream) {
            if (!this.#isActive(generation)) return
            this.#increment('hostEvents')
            if (event.type === 'stream.reset') {
              this.#increment('resetRecoveries')
              snapshotRequired = true
              break
            }

            const projection = readHostProjection(this.#queryClient)
            if (projection === undefined) {
              this.#increment('resetRecoveries')
              snapshotRequired = true
              break
            }
            const result = applyHostEvent(projection, event)
            if (result.kind === 'duplicate') {
              this.#increment('duplicateEvents')
              continue
            }
            if (result.kind === 'reset-required') {
              this.#increment('resetRecoveries')
              snapshotRequired = true
              break
            }

            replaceHostProjection(this.#queryClient, result.projection)
            this.#publishAppliedEvent(event)
            invalidateConversationProductQueries(this.#queryClient, event)
            if (shouldRefreshAttention(event.type)) {
              void invalidateAttentionQueries(this.#queryClient)
            }
            this.#increment('projectionUpdates')
            cursor = formatLastEventId(result.projection.cursor)
          }
        } catch (error) {
          if (!this.#isActive(generation)) return
          this.#lastError = error
        } finally {
          if (
            this.#streamConnectAbortController === streamConnectAbortController
          ) {
            this.#streamConnectAbortController = undefined
          }
          if (this.#stream === stream) this.#stream = undefined
          await stream?.close().catch(() => undefined)
        }

        if (!this.#isActive(generation)) return
        if (snapshotRequired) {
          continue
        }
        if (this.#resumeReconnectRequested) {
          continue
        }
        this.#increment('reconnectAttempts')
        this.#setConnectionState('reconnecting')
        await waitForDelay(this.#reconnectDelayMs, signal)
      }
    } catch (error) {
      if (!this.#isActive(generation)) return
      this.#resumeReconnectRequested = false
      this.#lastError = error
      this.#setConnectionState(
        error instanceof CodeTetherIncompatibleProtocolError
          ? 'incompatible'
          : 'unavailable',
      )
    }
  }

  async #fetchBootstrap(): Promise<Bootstrap> {
    this.#increment('bootstrapRequests')
    const bootstrap = await this.#queryClient.fetchQuery(
      hostBootstrapQueryOptions(this.#client),
    )
    if (
      this.#ownedDesktopHostEpoch !== undefined &&
      bootstrap.epoch !== this.#ownedDesktopHostEpoch
    ) {
      throw new OwnedDesktopHostIdentityError(
        'Desktop Host epoch changed while the owned process was running',
      )
    }
    this.#bootstrap = bootstrap
    return bootstrap
  }

  async #fetchAndReplaceSnapshot(
    generation: number,
    expectedEpoch?: Bootstrap['epoch'],
  ): Promise<LastEventId | undefined> {
    this.#increment('snapshotRequests')
    const snapshot = await this.#queryClient.fetchQuery(
      hostSnapshotQueryOptions(this.#client),
    )
    if (!this.#isActive(generation)) return undefined
    if (expectedEpoch !== undefined && snapshot.epoch !== expectedEpoch) {
      throw new Error('Host snapshot epoch does not match bootstrap epoch')
    }
    replaceHostProjection(this.#queryClient, projectSnapshot(snapshot))
    this.#actions.adoptHostEpoch(snapshot.epoch)
    this.#attentionActions.adoptHostEpoch(snapshot.epoch)
    if (this.#stats.snapshotReplacements > 0) {
      void invalidateAttentionQueries(this.#queryClient)
      invalidateConversationDurableQueries(this.#queryClient)
    }
    this.#increment('snapshotReplacements')
    return snapshotCursor(snapshot)
  }

  #isActive(generation: number): boolean {
    return this.#started && this.#generation === generation
  }

  #setConnectionState(state: HostConnectionState): void {
    if (this.#connectionState === state) return
    this.#connectionState = state
    for (const listener of this.#listeners) {
      try {
        listener()
      } catch {
        // A view subscriber cannot stop the connection runtime.
      }
    }
  }

  #publishAppliedEvent(event: AppliedHostEvent): void {
    for (const listener of this.#appliedEventListeners) {
      try {
        listener(event)
      } catch {
        // A best-effort application observer cannot stop Host streaming.
      }
    }
  }

  #increment(field: keyof HostRuntimeStats): void {
    this.#stats = { ...this.#stats, [field]: this.#stats[field] + 1 }
  }
}

export function getHostRuntime(queryClient: QueryClient): HostRuntime {
  const existing = runtimesByQueryClient.get(queryClient)
  if (existing !== undefined) return existing
  const runtime = new HostRuntime({ queryClient })
  runtimesByQueryClient.set(queryClient, runtime)
  return runtime
}

function snapshotCursor(snapshot: HostSnapshot): LastEventId {
  return formatLastEventId({ epoch: snapshot.epoch, seq: snapshot.currentSeq })
}

function emptyStats(): HostRuntimeStats {
  return {
    bootstrapRequests: 0,
    snapshotRequests: 0,
    snapshotReplacements: 0,
    streamConnections: 0,
    reconnectAttempts: 0,
    resumeRecoveries: 0,
    hostEvents: 0,
    projectionUpdates: 0,
    duplicateEvents: 0,
    resetRecoveries: 0,
  }
}

async function waitForDelay(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (delayMs === 0 || signal.aborted) {
    await Promise.resolve()
    return
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(finish, delayMs)
    function finish(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    signal.addEventListener('abort', finish, { once: true })
  })
}

function nonNegativeInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
  return resolved
}
