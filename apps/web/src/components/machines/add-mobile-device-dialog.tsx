import { useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Notice,
} from '@codetether/ui'

import { controlPlaneBaseUrl } from '../../runtime/account/account-config.js'
import { localAuthorizedMobileDevicesKey } from '../../runtime/account/authorized-mobile-devices.js'
import { ControlPlaneClientError } from '../../runtime/account/control-plane-client.js'
import { loadPairingOwner } from '../../runtime/account/pairing-client.js'
import {
  runOwnerPairing,
  type OwnerPairingProgress,
} from '../../runtime/account/pairing-flow.js'
import { useAccountSession } from '../../runtime/account/use-account-session.js'
import {
  nativeCapabilities,
  openPairingDiagnostic,
} from '../../runtime/native/native-capabilities.js'

export function AddMobileDeviceDialog() {
  const { query, supabase } = useAccountSession()
  if (supabase === undefined || !nativeCapabilities.hostIdentity.available) {
    return <Notice tone="warn">请在已配置账号服务的桌面版中添加设备。</Notice>
  }
  if (query.data === null) {
    return (
      <Button asChild>
        <Link to="/signin">登录后添加</Link>
      </Button>
    )
  }
  if (query.isError)
    return (
      <Button variant="secondary" onClick={() => void query.refetch()}>
        重新读取账号
      </Button>
    )
  if (query.data === undefined) return <Button disabled>正在读取账号…</Button>
  return (
    <PairingDialog
      key={query.data.userId}
      userId={query.data.userId}
      supabase={supabase}
    />
  )
}

function PairingDialog({
  userId,
  supabase,
}: {
  readonly userId: string
  readonly supabase: SupabaseClient
}) {
  const queryClient = useQueryClient()
  const active = useRef<AbortController | null>(null)
  const [open, setOpen] = useState(false)
  const [progress, setProgress] = useState<OwnerPairingProgress>()
  const [error, setError] = useState<string>()
  const [seconds, setSeconds] = useState(0)
  const expiresAt =
    progress?.status === 'pending' ? progress.expiresAt : undefined

  useEffect(() => () => active.current?.abort(), [])
  useEffect(() => {
    if (expiresAt === undefined) return
    const timer = setInterval(
      () => setSeconds(remainingSeconds(expiresAt)),
      1_000,
    )
    return () => clearInterval(timer)
  }, [expiresAt])

  function close() {
    active.current?.abort()
    active.current = null
    setOpen(false)
    setProgress(undefined)
    setError(undefined)
  }

  async function start() {
    if (active.current !== null) return
    const controller = new AbortController()
    active.current = controller
    setOpen(true)
    setProgress(undefined)
    setError(undefined)
    try {
      const { data, error: authError } = await supabase.auth.getSession()
      if (authError || data.session?.user.id !== userId)
        throw new Error('pairing_sign_in_required')
      controller.signal.throwIfAborted()
      const owner = await loadPairingOwner({
        session: data.session,
        controlPlaneBaseUrl,
        deviceIdentity: nativeCapabilities.productDeviceIdentity,
        hostIdentity: nativeCapabilities.hostIdentity,
        signal: controller.signal,
        allowFirstClaim: true,
      })
      await runOwnerPairing(owner, controller.signal, (next) => {
        if (controller.signal.aborted) return
        setProgress(next)
        if (next.status === 'pending')
          setSeconds(remainingSeconds(next.expiresAt))
        if (next.status === 'paired') {
          void queryClient.invalidateQueries({
            queryKey: ['account', 'supervisor-grants-owned-hosts', userId],
          })
          void queryClient.invalidateQueries({
            queryKey: ['host', 'local-identity-for-directory'],
          })
          void queryClient.invalidateQueries({
            queryKey: localAuthorizedMobileDevicesKey(
              userId,
              owner.host.hostId,
            ),
          })
        }
      })
    } catch (failure) {
      if (controller.signal.aborted) return
      setError(
        failure instanceof ControlPlaneClientError &&
          failure.code === 'pairing_computer_unavailable'
          ? '这台电脑现在连不上，请确认它开着并且联网。'
          : '暂时无法配对，请检查登录状态和网络后重试。',
      )
    } finally {
      if (active.current === controller) active.current = null
    }
  }

  const complete = progress?.status === 'paired'
  const terminal =
    progress?.status === 'expired' ||
    progress?.status === 'cancelled' ||
    progress?.status === 'rate_limited'
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) void start()
        else close()
      }}
    >
      <DialogTrigger asChild>
        <Button>添加手机或平板</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {complete ? `已添加 · ${progress.label}` : '添加手机或平板'}
          </DialogTitle>
          <DialogDescription>
            {complete
              ? '你可以在这台设备上使用这台电脑了。'
              : '在手机上的 CodeTether 里登录同一账号，输入这个码。'}
          </DialogDescription>
        </DialogHeader>
        {error !== undefined ? <Notice tone="err">{error}</Notice> : null}
        {progress?.status === 'pending' ? (
          <div className="space-y-2 text-center">
            <p
              className="text-3xl font-semibold tracking-widest tabular-nums"
              aria-label={`配对码 ${progress.code.split('').join(' ')}`}
            >
              {progress.code}
            </p>
            <p className="text-sm text-text-secondary tabular-nums">
              剩余 {Math.floor(seconds / 60)}:
              {String(seconds % 60).padStart(2, '0')}
            </p>
          </div>
        ) : progress?.status === 'claimed' ? (
          <p role="status">正在配对…</p>
        ) : progress?.status === 'expired' ? (
          <Notice tone="warn">配对码已过期，请在电脑上重新生成。</Notice>
        ) : progress?.status === 'rate_limited' ? (
          <Notice tone="warn">配对码输错 5 次，请在电脑上重新生成。</Notice>
        ) : progress?.status === 'cancelled' ? (
          <Notice tone="warn">配对已取消。</Notice>
        ) : progress === undefined && error === undefined ? (
          <p role="status">正在生成配对码…</p>
        ) : null}
        <DialogFooter>
          {import.meta.env.DEV &&
          import.meta.env.VITE_CODETETHER_SUPERVISOR_CHECK === '1' &&
          progress?.status === 'pending' ? (
            <Button
              variant="secondary"
              onClick={() =>
                void openPairingDiagnostic().catch(() =>
                  setError('无法打开测试窗口。'),
                )
              }
            >
              打开配对测试
            </Button>
          ) : null}
          {terminal || error !== undefined ? (
            <Button variant="secondary" onClick={() => void start()}>
              重新生成
            </Button>
          ) : null}
          <Button variant={complete ? 'default' : 'secondary'} onClick={close}>
            {complete ? '完成' : '取消'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function remainingSeconds(expiresAt: string) {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1_000))
}
