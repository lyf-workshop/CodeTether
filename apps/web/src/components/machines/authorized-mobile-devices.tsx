import { useMemo, useState, useSyncExternalStore } from 'react'
import {
  hashKey,
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Notice,
  StatusTag,
} from '@codetether/ui'

import { controlPlaneBaseUrl } from '../../runtime/account/account-config.js'
import {
  localAuthorizedMobileDevicesKey,
  type AuthorizedMobileDeviceObservation,
} from '../../runtime/account/authorized-mobile-devices.js'
import { ControlPlaneClientError } from '../../runtime/account/control-plane-client.js'
import {
  loadPairingOwner,
  removePairedDevice,
  type PairedDevice,
} from '../../runtime/account/pairing-client.js'
import type { LocalHostIdentityRecord } from '../../runtime/account/remote-supervisor.js'
import { getSupabaseAccountClient } from '../../runtime/account/supabase-account.js'
import { nativeCapabilities } from '../../runtime/native/native-capabilities.js'

const lastUsedFormat = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

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
  const [selected, setSelected] = useState<PairedDevice>()
  const removal = useMutation({
    mutationFn: async (device: PairedDevice) => {
      const result = await getSupabaseAccountClient()?.auth.getSession()
      if (result?.error || result?.data.session?.user.id !== userId)
        throw new Error('pairing_sign_in_required')
      const owner = await loadPairingOwner({
        session: result.data.session,
        controlPlaneBaseUrl,
        deviceIdentity: nativeCapabilities.productDeviceIdentity,
        hostIdentity: nativeCapabilities.hostIdentity,
        signal: AbortSignal.timeout(15_000),
      })
      if (owner.host.hostId !== hostId)
        throw new Error('pairing_computer_unavailable')
      await removePairedDevice(owner, device)
    },
    onSuccess: (_value, device) => {
      queryClient.setQueryData<AuthorizedMobileDeviceObservation>(
        grantKey,
        (current) =>
          current === undefined
            ? undefined
            : {
                ...current,
                devices: current.devices.filter(
                  (row) =>
                    row.deviceId !== device.deviceId ||
                    row.pairingRootAuthorizationId !==
                      device.pairingRootAuthorizationId,
                ),
              },
      )
      setSelected(undefined)
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: grantKey, exact: true }),
    retry: false,
  })
  const devices = identity?.data ? (observation?.data?.devices ?? []) : []
  return (
    <>
      <AuthorizedMobileDevicesList
        devices={devices}
        stale={observation?.status === 'error'}
        unavailable={observation?.data === undefined}
        onRemove={(device) => {
          removal.reset()
          setSelected(device)
        }}
      />
      <Dialog
        open={selected !== undefined}
        onOpenChange={(open) => {
          if (!open && !removal.isPending) setSelected(undefined)
        }}
      >
        {selected !== undefined ? (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>移除 {selected.label}</DialogTitle>
              <DialogDescription>
                移除后 {selected.label}{' '}
                会立刻断开，要再用就重新配对。电脑上正在运行的工作不受影响。
              </DialogDescription>
            </DialogHeader>
            {removal.isError ? (
              <Notice tone="err">
                {removal.error instanceof ControlPlaneClientError &&
                removal.error.code ===
                  'pairing_removal_confirmation_unavailable'
                  ? '这台设备已断开。暂时无法确认移除，请重试。'
                  : '暂时无法移除，请检查网络后重试。'}
              </Notice>
            ) : null}
            <DialogFooter>
              <Button
                variant="secondary"
                disabled={removal.isPending}
                onClick={() => setSelected(undefined)}
              >
                取消
              </Button>
              <Button
                variant="danger"
                disabled={removal.isPending}
                onClick={() => removal.mutate(selected)}
              >
                {removal.isPending ? '正在移除…' : '移除'}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
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
  unavailable = false,
  onRemove,
}: {
  readonly devices: readonly PairedDevice[]
  readonly stale?: boolean
  readonly unavailable?: boolean
  readonly onRemove?: (device: PairedDevice) => void
}) {
  return (
    <section className="mt-10" aria-labelledby="paired-mobile-devices-heading">
      <h2
        id="paired-mobile-devices-heading"
        className="mb-3 text-xl font-semibold text-text-primary"
      >
        手机和平板
      </h2>
      {stale && !unavailable ? (
        <p role="status" className="mb-3 text-sm text-text-secondary">
          暂时无法更新，以下是上次读取的设备记录。
        </p>
      ) : null}
      {devices.length === 0 ? (
        <p className="text-sm text-text-secondary">
          {unavailable ? '暂时无法读取设备。' : '还没有添加手机或平板。'}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {devices.map((device) => (
            <li
              key={device.deviceId}
              className="flex min-w-0 flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="break-words text-md font-medium text-text-primary">
                  {device.label}
                </p>
                <p className="mt-1 text-sm text-text-secondary">
                  {device.platform} ·{' '}
                  {device.lastUsedAt === null ? (
                    '还未使用'
                  ) : (
                    <>
                      上次使用{' '}
                      <time dateTime={device.lastUsedAt}>
                        {lastUsedFormat.format(new Date(device.lastUsedAt))}
                      </time>
                    </>
                  )}
                </p>
                {device.status === 'expired' ? (
                  <StatusTag tone="warn">已失效，重新配对</StatusTag>
                ) : null}
              </div>
              {onRemove === undefined ? null : (
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`移除 ${device.label}`}
                  onClick={() => onRemove(device)}
                >
                  移除
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
