import type { AttentionId, AttentionItem } from '@codetether/protocol'

import type {
  AppliedHostEvent,
  AppliedHostEventListener,
} from '../host/host-runtime.js'
import {
  createNotificationIntent,
  defaultDesktopNotificationPreferences,
  isAttentionNotificationEnabled,
  shouldSuppressAttentionNotification,
  type AttentionNotificationMetadata,
  type AttentionPresentationSurface,
  type DesktopNotificationPreferences,
  type DesktopWindowState,
  type NotificationIntent,
  type NotificationClickIntent,
  type NotificationNavigationTarget,
} from './desktop-notification-model.js'

type MaybePromise<T> = Promise<T> | T
const MAX_SEEN_ATTENTION_IDS = 2_048

export interface AppliedHostEventSource {
  subscribeAppliedEvents(listener: AppliedHostEventListener): () => void
}

export interface DesktopNotificationAdapter {
  readonly available: boolean
  getWindowState(): MaybePromise<DesktopWindowState>
  ensurePermission(): Promise<boolean>
  deliver(intent: NotificationIntent): Promise<void>
  subscribeToIntents(
    listener: (intent: NotificationClickIntent) => void | Promise<void>,
  ): Promise<() => void>
}

/** Optional tiny persistence boundary; this is not Notification product state. */
export interface RecentNotificationIdStore {
  has(attentionId: AttentionId): Promise<boolean>
  remember(attentionId: AttentionId): Promise<void>
}

export type DesktopNotificationFailureStage =
  | 'click-listener'
  | 'delivery'
  | 'metadata'
  | 'navigation'
  | 'permission'
  | 'presentation'
  | 'preferences'
  | 'recent-id-read'
  | 'recent-id-write'
  | 'window-state'

export interface DesktopNotificationDiagnostic {
  readonly attentionId?: AttentionId
  readonly stage: DesktopNotificationFailureStage
}

export interface AttentionNotificationCoordinatorOptions {
  readonly adapter: DesktopNotificationAdapter
  readonly eventSource: AppliedHostEventSource
  readonly navigate: (
    intent: NotificationNavigationTarget,
  ) => MaybePromise<void>
  readonly readPreferences?: () => DesktopNotificationPreferences
  readonly readSurface: () => AttentionPresentationSurface
  readonly recentIds?: RecentNotificationIdStore
  readonly reportFailure?: (diagnostic: DesktopNotificationDiagnostic) => void
  readonly resolveMetadata: (
    attention: AttentionItem,
  ) => Promise<AttentionNotificationMetadata>
  readonly resolveClickTarget?: (
    attentionId: AttentionId,
    signal: AbortSignal,
  ) => Promise<NotificationNavigationTarget | undefined>
}

/**
 * Application-scoped bridge from accepted durable Attention arrivals to the
 * optional Desktop delivery adapter. It never reconstructs notifications from
 * a query, Snapshot, or lower-level Turn event.
 */
export class AttentionNotificationCoordinator {
  readonly #adapter: DesktopNotificationAdapter
  readonly #eventSource: AppliedHostEventSource
  readonly #navigate: (
    intent: NotificationNavigationTarget,
  ) => MaybePromise<void>
  readonly #readPreferences: () => DesktopNotificationPreferences
  readonly #readSurface: () => AttentionPresentationSurface
  readonly #recentIds?: RecentNotificationIdStore
  readonly #reportFailure: (diagnostic: DesktopNotificationDiagnostic) => void
  readonly #resolveMetadata: (
    attention: AttentionItem,
  ) => Promise<AttentionNotificationMetadata>
  readonly #resolveClickTarget?: AttentionNotificationCoordinatorOptions['resolveClickTarget']
  readonly #seenAttentionIds = new Set<AttentionId>()
  readonly #seenAttentionOrder: AttentionId[] = []
  readonly #clickedAttentionIds = new Set<AttentionId>()
  readonly #clickedAttentionOrder: AttentionId[] = []
  readonly #clickResolutions = new Set<AbortController>()
  #generation = 0
  #started = false
  #unsubscribeEvents?: () => void
  #unsubscribeIntents?: () => void
  #intentSubscription?: Promise<void>

  constructor(options: AttentionNotificationCoordinatorOptions) {
    this.#adapter = options.adapter
    this.#eventSource = options.eventSource
    this.#navigate = options.navigate
    this.#readPreferences =
      options.readPreferences ?? (() => defaultDesktopNotificationPreferences)
    this.#readSurface = options.readSurface
    this.#recentIds = options.recentIds
    this.#reportFailure = options.reportFailure ?? reportSafeDiagnostic
    this.#resolveMetadata = options.resolveMetadata
    this.#resolveClickTarget = options.resolveClickTarget
  }

  start(): void {
    if (this.#started || !this.#adapter.available) return
    this.#started = true
    const generation = ++this.#generation
    this.#unsubscribeEvents = this.#eventSource.subscribeAppliedEvents(
      (event) => {
        this.#onAppliedEvent(event, generation)
      },
    )

    const registration = Promise.resolve()
      .then(
        async () =>
          await this.#adapter.subscribeToIntents(async (intent) => {
            if (!this.#isActive(generation)) return
            await this.#navigateToIntent(intent, generation)
          }),
      )
      .then((unsubscribe) => {
        if (!this.#isActive(generation)) {
          unsubscribe()
          return
        }
        this.#unsubscribeIntents = unsubscribe
      })
      .catch(() => {
        if (this.#isActive(generation)) {
          this.#report({ stage: 'click-listener' })
        }
      })
      .finally(() => {
        if (this.#intentSubscription === registration) {
          this.#intentSubscription = undefined
        }
      })
    this.#intentSubscription = registration
  }

  async stop(): Promise<void> {
    if (!this.#started && this.#intentSubscription === undefined) return
    this.#started = false
    this.#generation += 1
    for (const controller of this.#clickResolutions) controller.abort()
    this.#clickResolutions.clear()
    this.#unsubscribeEvents?.()
    this.#unsubscribeEvents = undefined
    this.#unsubscribeIntents?.()
    this.#unsubscribeIntents = undefined
    await this.#intentSubscription?.catch(() => undefined)
  }

  #onAppliedEvent(event: AppliedHostEvent, generation: number): void {
    if (event.type !== 'attention.created') return
    const attention = event.payload.attention
    if (this.#seenAttentionIds.has(attention.attentionId)) return

    // Claim synchronously before any async work. Suppressed, disabled, denied,
    // and failed attempts must not become a later replay notification.
    this.#rememberAttentionId(attention.attentionId)
    void this.#deliverAttention(attention, generation)
  }

  #rememberAttentionId(attentionId: AttentionId): void {
    this.#seenAttentionIds.add(attentionId)
    this.#seenAttentionOrder.push(attentionId)
    if (this.#seenAttentionOrder.length <= MAX_SEEN_ATTENTION_IDS) return
    const expired = this.#seenAttentionOrder.shift()
    if (expired !== undefined) this.#seenAttentionIds.delete(expired)
  }

  async #deliverAttention(
    attention: AttentionItem,
    generation: number,
  ): Promise<void> {
    if (!this.#isActive(generation)) return

    if (this.#recentIds !== undefined) {
      try {
        if (await this.#recentIds.has(attention.attentionId)) return
      } catch {
        this.#report({
          attentionId: attention.attentionId,
          stage: 'recent-id-read',
        })
      }
      if (!this.#isActive(generation)) return
    }

    let preferences: DesktopNotificationPreferences
    try {
      preferences = this.#readPreferences()
    } catch {
      this.#report({
        attentionId: attention.attentionId,
        stage: 'preferences',
      })
      preferences = defaultDesktopNotificationPreferences
    }
    if (!isAttentionNotificationEnabled(attention.type, preferences)) return

    let window: DesktopWindowState
    try {
      window = await this.#adapter.getWindowState()
    } catch {
      this.#report({
        attentionId: attention.attentionId,
        stage: 'window-state',
      })
      // Suppression is an optimization, never a delivery prerequisite. If
      // native focus state cannot be proven, treat the Attention as not
      // directly presented so an important background item is not dropped.
      window = { focused: false, minimized: false, visible: false }
    }

    let surface: AttentionPresentationSurface
    try {
      surface = this.#readSurface()
    } catch {
      this.#report({
        attentionId: attention.attentionId,
        stage: 'presentation',
      })
      return
    }
    if (shouldSuppressAttentionNotification(attention, { surface, window })) {
      return
    }

    let metadata: AttentionNotificationMetadata
    try {
      metadata = await this.#resolveMetadata(attention)
    } catch {
      this.#report({
        attentionId: attention.attentionId,
        stage: 'metadata',
      })
      return
    }
    if (!this.#isActive(generation)) return

    let permissionGranted: boolean
    try {
      // Permission is intentionally checked only for a real unsuppressed need.
      permissionGranted = await this.#adapter.ensurePermission()
    } catch {
      this.#report({
        attentionId: attention.attentionId,
        stage: 'permission',
      })
      return
    }
    if (!permissionGranted || !this.#isActive(generation)) return

    const intent = createNotificationIntent(attention, metadata)
    try {
      await this.#adapter.deliver(intent)
    } catch {
      this.#report({
        attentionId: attention.attentionId,
        stage: 'delivery',
      })
      return
    }

    if (this.#recentIds !== undefined) {
      try {
        await this.#recentIds.remember(attention.attentionId)
      } catch {
        this.#report({
          attentionId: attention.attentionId,
          stage: 'recent-id-write',
        })
      }
    }
  }

  async #navigateToIntent(
    intent: NotificationClickIntent,
    generation: number,
  ): Promise<void> {
    if (!this.#isActive(generation)) return
    if (this.#clickedAttentionIds.has(intent.attentionId)) return
    // The in-process callback and protocol-link fallback can race. Claim the
    // same public ID before either read-only resolution or navigation awaits.
    this.#clickedAttentionIds.add(intent.attentionId)
    this.#clickedAttentionOrder.push(intent.attentionId)
    if (this.#clickedAttentionOrder.length > MAX_SEEN_ATTENTION_IDS) {
      const expired = this.#clickedAttentionOrder.shift()
      if (expired !== undefined) this.#clickedAttentionIds.delete(expired)
    }
    const controller = new AbortController()
    this.#clickResolutions.add(controller)
    try {
      const target =
        'conversationId' in intent
          ? intent
          : await this.#resolveClickTarget?.(
              intent.attentionId,
              controller.signal,
            )
      if (
        !this.#isActive(generation) ||
        target === undefined ||
        target.attentionId !== intent.attentionId
      ) {
        return
      }
      await this.#navigate(target)
    } catch {
      if (this.#isActive(generation)) {
        this.#report({
          attentionId: intent.attentionId,
          stage: 'navigation',
        })
      }
    } finally {
      this.#clickResolutions.delete(controller)
    }
  }

  #isActive(generation: number): boolean {
    return this.#started && this.#generation === generation
  }

  #report(diagnostic: DesktopNotificationDiagnostic): void {
    try {
      this.#reportFailure(diagnostic)
    } catch {
      // Diagnostics are best-effort and cannot affect product state.
    }
  }
}

function reportSafeDiagnostic(diagnostic: DesktopNotificationDiagnostic): void {
  console.warn(`[CodeTether] Desktop notification ${diagnostic.stage} failed.`)
}
