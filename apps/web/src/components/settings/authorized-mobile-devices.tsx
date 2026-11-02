import { useMemo, useSyncExternalStore } from 'react'
import {
  hashKey,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import type { LocalHostIdentityRecord } from '../../runtime/account/remote-supervisor'
import {
  localAuthorizedMobileDevicesKey,
  type AuthorizedMobileDevice,
  type AuthorizedMobileDeviceObservation,
} from '../../runtime/account/authorized-mobile-devices'

/** Observes the coordinator's existing cache. It starts no authorization request. */
export function AuthorizedMobileDevices({
  userId,
}: {
  readonly userId: string
}) {
  const queryClient = useQueryClient()
  const identityKey = useMemo(
    () => ['host', 'local-identity-for-directory'] as const,
    [],
  )
  const identity = useCachedQueryState<LocalHostIdentityRecord | null>(
    queryClient,
    identityKey,
  )
  const hostId = identity?.data?.hostId
  const grantKey = useMemo(
    () => localAuthorizedMobileDevicesKey(userId, hostId),
    [userId, hostId],
  )
  const observation = useCachedQueryState<AuthorizedMobileDeviceObservation>(
    queryClient,
    grantKey,
  )
  if (!identity?.data || !observation?.data?.devices.length) return null
  return (
    <AuthorizedMobileDevicesList
      devices={observation.data.devices}
      stale={observation.status === 'error'}
    />
  )
}

/** Subscribe to existing cache state without creating a QueryObserver or replacing its options. */
function useCachedQueryState<TData>(client: QueryClient, key: QueryKey) {
  const subscription = useMemo(() => {
    const queryHash = hashKey(key)
    const getSnapshot = () => client.getQueryState<TData>(key)
    return {
      getSnapshot,
      subscribe(listener: () => void) {
        let active = true
        let pending = false
        const unsubscribe = client.getQueryCache().subscribe((event) => {
          if (
            event.query.queryHash !== queryHash ||
            (event.type !== 'added' &&
              event.type !== 'removed' &&
              event.type !== 'updated')
          )
            return
          // Query creation may occur during another component's render.
          if (pending) return
          pending = true
          queueMicrotask(() => {
            pending = false
            if (active) listener()
          })
        })
        return () => {
          active = false
          unsubscribe()
        }
      },
    }
  }, [client, key])
  return useSyncExternalStore(
    subscription.subscribe,
    subscription.getSnapshot,
    subscription.getSnapshot,
  )
}

export function AuthorizedMobileDevicesList({
  devices,
  stale = false,
}: {
  readonly devices: readonly AuthorizedMobileDevice[]
  readonly stale?: boolean
}) {
  if (devices.length === 0) return null
  return (
    <section
      className="mt-7"
      aria-labelledby="authorized-mobile-devices-heading"
    >
      <h3
        id="authorized-mobile-devices-heading"
        className="mb-3 text-md font-semibold text-text-primary"
      >
        已允许访问的手机和平板
      </h3>
      {stale ? (
        <p role="status" className="mb-3 text-sm text-text-secondary">
          暂时无法更新，以下是上次读取的授权记录。
        </p>
      ) : null}
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {devices.map((device) => (
          <li key={device.deviceId} className="min-w-0 px-4 py-3">
            <p className="break-words text-md font-medium text-text-primary">
              {device.name}
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              {device.type === 'mobile' ? '手机' : '平板'} · 授权于{' '}
              <time dateTime={device.authorizedAt}>
                {new Intl.DateTimeFormat('zh-CN', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(device.authorizedAt))}
              </time>
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-text-muted">
        移除功能会在配对码配对上线时提供。
        <Link
          to="/roadmap"
          className="rounded-xs text-primary underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          查看后续规划
        </Link>
      </p>
    </section>
  )
}
