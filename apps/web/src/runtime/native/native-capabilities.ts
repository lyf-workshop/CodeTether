import { TurnIdSchema } from '@codetether/protocol'

import type {
  DesktopWindowState,
  NotificationIntent,
} from '../notifications/desktop-notification-model.js'

export interface DirectoryPicker {
  readonly available: boolean
  pickDirectory(): Promise<string | null>
}

export interface DesktopNotifications {
  readonly available: boolean
  deliver(intent: NotificationIntent): Promise<void>
  ensurePermission(): Promise<boolean>
  getWindowState(): DesktopWindowState | Promise<DesktopWindowState>
  subscribeToIntents(
    listener: (intent: NotificationIntent) => void | Promise<void>,
  ): Promise<() => void>
}

export interface BackgroundRuntimeCapability {
  readonly available: boolean
}

export interface NativeCapabilities {
  readonly directoryPicker: DirectoryPicker
  readonly notifications: DesktopNotifications
  readonly backgroundRuntime: BackgroundRuntimeCapability
}

interface TauriCoreModule {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
}

type TauriCoreLoader = () => Promise<TauriCoreModule>

interface TauriEventModule {
  listen<T>(
    event: string,
    listener: (event: { readonly payload: T }) => void,
  ): Promise<() => void>
}

type TauriEventLoader = () => Promise<TauriEventModule>

interface TauriNotificationModule {
  isPermissionGranted(): Promise<boolean>
  requestPermission(): Promise<string>
}

type TauriNotificationLoader = () => Promise<TauriNotificationModule>

interface TauriWindowModule {
  getCurrentWindow(): {
    isFocused(): Promise<boolean>
    isMinimized(): Promise<boolean>
    isVisible(): Promise<boolean>
  }
}

type TauriWindowLoader = () => Promise<TauriWindowModule>

type WakeEventSubscriber = (listener: () => void) => () => void
type BackgroundExecutionLease = () => void
type BackgroundExecutionLeaseFactory = () => BackgroundExecutionLease

interface NativeCapabilitiesOptions {
  loadTauriCore?: TauriCoreLoader
  loadTauriEvent?: TauriEventLoader
  loadTauriNotification?: TauriNotificationLoader
  loadTauriWindow?: TauriWindowLoader
  acquireBackgroundExecutionLease?: BackgroundExecutionLeaseFactory
  subscribeToWakeEvents?: WakeEventSubscriber
  tauriAvailable?: boolean
}

const MAX_RECENT_CLICK_INTENT_IDS = 512

const loadTauriCore: TauriCoreLoader = async () =>
  await import('@tauri-apps/api/core')
const loadTauriEvent: TauriEventLoader = async () =>
  await import('@tauri-apps/api/event')
const loadTauriNotification: TauriNotificationLoader = async () =>
  await import('@tauri-apps/plugin-notification')
const loadTauriWindow: TauriWindowLoader = async () =>
  await import('@tauri-apps/api/window')

const unavailableDirectoryPicker: DirectoryPicker = {
  available: false,
  pickDirectory: () =>
    Promise.reject(new Error('Native directory selection is unavailable.')),
}

const unavailableDesktopNotifications: DesktopNotifications = {
  available: false,
  deliver: () =>
    Promise.reject(new Error('Desktop notifications are unavailable.')),
  ensurePermission: () => Promise.resolve(false),
  getWindowState: readDocumentWindowState,
  subscribeToIntents: () => Promise.resolve(() => undefined),
}

const unavailableBackgroundRuntime: BackgroundRuntimeCapability = {
  available: false,
}

/** Tauri v2 exposes this public marker even when `withGlobalTauri` is off. */
export function hasTauriRuntime(scope: unknown = globalThis): boolean {
  return (
    typeof scope === 'object' &&
    scope !== null &&
    'isTauri' in scope &&
    scope.isTauri === true
  )
}

export function createNativeCapabilities(
  options: NativeCapabilitiesOptions = {},
): NativeCapabilities {
  const tauriAvailable = options.tauriAvailable ?? hasTauriRuntime()
  if (!tauriAvailable) {
    return {
      directoryPicker: unavailableDirectoryPicker,
      notifications: unavailableDesktopNotifications,
      backgroundRuntime: unavailableBackgroundRuntime,
    }
  }

  const loadCore = options.loadTauriCore ?? loadTauriCore
  const loadEvent = options.loadTauriEvent ?? loadTauriEvent
  const loadNotification =
    options.loadTauriNotification ?? loadTauriNotification
  const loadWindow = options.loadTauriWindow ?? loadTauriWindow
  const subscribeToWakeEvents =
    options.subscribeToWakeEvents ?? subscribeToDocumentWakeEvents
  const acquireBackgroundExecutionLease =
    options.acquireBackgroundExecutionLease ??
    acquireDesktopBackgroundExecutionLease
  let inFlight: Promise<string | null> | undefined
  let permissionRequest: Promise<boolean> | undefined
  let permissionResult: boolean | undefined

  const directoryPicker: DirectoryPicker = {
    available: true,
    pickDirectory() {
      if (inFlight !== undefined) return inFlight

      const request = loadCore()
        .then(
          async ({ invoke }) =>
            await invoke<string | null>('pick_project_directory'),
        )
        .then((selected) => {
          if (selected === null || typeof selected === 'string') {
            return selected
          }
          throw new Error('Native directory picker returned an invalid value.')
        })

      const trackedRequest = request.finally(() => {
        if (inFlight === trackedRequest) inFlight = undefined
      })
      inFlight = trackedRequest
      return trackedRequest
    },
  }

  const notifications: DesktopNotifications = {
    available: true,
    async getWindowState() {
      const { getCurrentWindow } = await loadWindow()
      const currentWindow = getCurrentWindow()
      const [focused, minimized, visible] = await Promise.all([
        currentWindow.isFocused(),
        currentWindow.isMinimized(),
        currentWindow.isVisible(),
      ])
      return { focused, minimized, visible }
    },
    ensurePermission() {
      if (permissionResult !== undefined) {
        return Promise.resolve(permissionResult)
      }
      if (permissionRequest !== undefined) return permissionRequest
      const request = loadNotification().then(async (notification) => {
        const granted =
          (await notification.isPermissionGranted()) ||
          (await notification.requestPermission()) === 'granted'
        permissionResult = granted
        return granted
      })
      const trackedRequest = request.finally(() => {
        if (permissionRequest === trackedRequest) permissionRequest = undefined
      })
      permissionRequest = trackedRequest
      return trackedRequest
    },
    async deliver(intent) {
      assertNotificationIntent(intent)
      const { invoke } = await loadCore()
      await invoke<void>('deliver_attention_notification', { intent })
    },
    async subscribeToIntents(listener) {
      // WebView2 can suspend a minimized document and therefore pause its SSE
      // consumer. Holding a Web Lock keeps the accepted HostRuntime stream
      // alive without moving Attention projection or delivery policy into
      // Tauri. Wry documents this as the Windows workaround because native
      // background-throttling control is not available on WebView2.
      const releaseBackgroundExecution = acquireBackgroundExecutionLease()
      const [{ invoke }, { listen }] = await Promise.all([
        loadCore(),
        loadEvent(),
      ])
      let active = true
      let drainPromise: Promise<void> | undefined
      let drainRequested = false
      let deliveryTail = Promise.resolve()
      const recentIntentIds = new Set<string>()
      const recentIntentOrder: string[] = []

      const forward = (intent: NotificationIntent): Promise<void> => {
        if (recentIntentIds.has(intent.attentionId)) return Promise.resolve()
        recentIntentIds.add(intent.attentionId)
        recentIntentOrder.push(intent.attentionId)
        if (recentIntentOrder.length > MAX_RECENT_CLICK_INTENT_IDS) {
          const expired = recentIntentOrder.shift()
          if (expired !== undefined) recentIntentIds.delete(expired)
        }

        const request = deliveryTail.then(async () => {
          if (active) await listener(intent)
        })
        deliveryTail = request.catch(() => undefined)
        return request
      }

      const drain = (): Promise<void> => {
        drainRequested = true
        if (drainPromise !== undefined) return drainPromise
        const request = (async () => {
          while (active) {
            drainRequested = false
            while (active) {
              const value = await invoke<unknown>(
                'take_pending_notification_intent',
              )
              if (!active) return
              if (value === null) break
              const intent = parseNotificationIntent(value)
              await forward(intent)
            }
            if (!drainRequested) return
          }
        })()
        const trackedRequest = request.finally(() => {
          if (drainPromise !== trackedRequest) return
          drainPromise = undefined
          if (active && drainRequested) {
            void drain().catch(reportNotificationFailure)
          }
        })
        drainPromise = trackedRequest
        return trackedRequest
      }

      // Native focus occurs after the intent is queued. These browser lifecycle
      // wake-ups recover a click when a minimized WebView missed its Tauri
      // event while suspended; they are event driven and never poll.
      const unsubscribeWakeEvents = subscribeToWakeEvents(() => {
        void drain().catch(reportNotificationFailure)
      })
      let unlisten: (() => void) | undefined
      try {
        unlisten = await listen<unknown>(
          'codetether://notification-intent',
          ({ payload }) => {
            // A typed payload is the fast path for an awake WebView. Always
            // drain too: the native queue closes listener-registration and
            // WebView-suspension races. attentionId dedupe joins both paths.
            if (payload !== null && payload !== undefined) {
              try {
                void forward(parseNotificationIntent(payload)).catch(
                  reportNotificationFailure,
                )
              } catch {
                reportNotificationFailure()
              }
            }
            void drain().catch(reportNotificationFailure)
          },
        )
        await drain()
      } catch (error) {
        active = false
        releaseBackgroundExecution()
        unsubscribeWakeEvents()
        unlisten?.()
        throw error
      }

      return () => {
        if (!active) return
        active = false
        releaseBackgroundExecution()
        unsubscribeWakeEvents()
        unlisten?.()
      }
    },
  }

  return {
    directoryPicker,
    notifications,
    backgroundRuntime: { available: true },
  }
}

export const nativeCapabilities = createNativeCapabilities()

function readDocumentWindowState(): DesktopWindowState {
  if (typeof document === 'undefined') {
    return { focused: false, minimized: false, visible: false }
  }
  const visible = document.visibilityState === 'visible'
  return {
    focused: document.hasFocus(),
    minimized: !visible,
    visible,
  }
}

function subscribeToDocumentWakeEvents(listener: () => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => undefined
  }

  const onFocus = () => listener()
  const onPageShow = () => listener()
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') listener()
  }
  window.addEventListener('focus', onFocus)
  window.addEventListener('pageshow', onPageShow)
  document.addEventListener('visibilitychange', onVisibilityChange)

  return () => {
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('pageshow', onPageShow)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

function acquireDesktopBackgroundExecutionLease(): BackgroundExecutionLease {
  const locks = globalThis.navigator?.locks
  if (locks === undefined) return () => undefined

  let released = false
  let releaseHold: (() => void) | undefined
  const hold = new Promise<void>((resolve) => {
    releaseHold = resolve
  })

  void locks
    .request(
      'codetether-desktop-attention-delivery',
      { mode: 'shared' },
      async () => {
        if (!released) await hold
      },
    )
    .catch(() => undefined)

  return () => {
    if (released) return
    released = true
    releaseHold?.()
  }
}

function parseNotificationIntent(value: unknown): NotificationIntent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Native notification intent is invalid.')
  }
  const record = value as Record<string, unknown>
  const turnId =
    record.turnId === undefined ? undefined : TurnIdSchema.parse(record.turnId)
  const intent = {
    attentionId: requiredString(record.attentionId, 160),
    type: notificationType(record.type),
    projectId: requiredString(record.projectId, 160),
    conversationId: requiredString(record.conversationId, 160),
    ...(turnId === undefined ? {} : { turnId }),
    title: requiredString(record.title, 120),
    body: requiredString(record.body, 512),
  } as NotificationIntent
  assertNotificationIntent(intent)
  return intent
}

function assertNotificationIntent(intent: NotificationIntent): void {
  requiredString(intent.attentionId, 160)
  notificationType(intent.type)
  requiredString(intent.projectId, 160)
  requiredString(intent.conversationId, 160)
  if (intent.turnId !== undefined) TurnIdSchema.parse(intent.turnId)
  requiredString(intent.title, 120)
  requiredString(intent.body, 512)
}

function requiredString(value: unknown, maxLength: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new Error('Native notification intent is invalid.')
  }
  return value
}

function notificationType(value: unknown): NotificationIntent['type'] {
  if (
    value !== 'approval' &&
    value !== 'completed_review' &&
    value !== 'failed'
  ) {
    throw new Error('Native notification intent is invalid.')
  }
  return value
}

function reportNotificationFailure(): void {
  console.warn('[CodeTether] A notification click could not be delivered.')
}
