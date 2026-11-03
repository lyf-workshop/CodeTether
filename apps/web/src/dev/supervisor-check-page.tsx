import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  Button,
  Input,
  Notice,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@codetether/ui'

import { getSupabaseAccountClient } from '../runtime/account/supabase-account.js'
import {
  nativeCapabilities,
  readNativeWindowLabel,
} from '../runtime/native/native-capabilities.js'
import {
  connectSupervisorCheck,
  loadSupervisorCheckDirectory,
  openSupervisorCheckSession,
  pairSupervisorCheckDevice,
  type SupervisorCheckPairing,
  type SupervisorCheckDirectory,
} from './supervisor-check-client.js'
import {
  checkErrorCategory,
  runSupervisorCheck,
  supervisorCheckOperations,
  type CheckError,
  type CheckMeasurement,
  type SupervisorCheckResult,
} from './supervisor-check-model.js'
import { disconnectRemoteSupervisor } from '../runtime/account/remote-supervisor.js'
import { SupervisorOperationChecks } from './supervisor-operation-checks.js'

const statusLabels = {
  pending: '未执行',
  running: '检查中',
  success: '成功',
  failed: '失败',
  skipped: '未执行',
} as const

export function SupervisorCheckPage() {
  const [session, setSession] = useState<Session | null>()
  const [directory, setDirectory] = useState<SupervisorCheckDirectory>()
  const [hostId, setHostId] = useState('')
  const [mode, setMode] = useState('auto')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<CheckError>()
  const [result, setResult] = useState<SupervisorCheckResult>()
  const [code, setCode] = useState('')
  const [pairingMessage, setPairingMessage] = useState('')
  const [allowRegistration, setAllowRegistration] = useState(false)
  const [registrationAvailable, setRegistrationAvailable] = useState(false)
  const request = useRef<AbortController | undefined>(undefined)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    let active = true
    if (nativeCapabilities.productDeviceIdentity.available) {
      void readNativeWindowLabel()
        .then((label) => {
          if (active) setRegistrationAvailable(label === 'main')
        })
        .catch(() => undefined)
    }
    const supabase = getSupabaseAccountClient()
    const resetSession = (next: Session | null) => {
      if (!active) return
      request.current?.abort()
      request.current = undefined
      setSession(next)
      setDirectory(undefined)
      setHostId('')
      setBusy(false)
      setResult(undefined)
      setError(undefined)
      setCode('')
      setPairingMessage('')
      setAllowRegistration(false)
    }
    let authObserved = false
    const subscription = supabase?.auth.onAuthStateChange((_event, next) => {
      authObserved = true
      resetSession(next)
    }).data.subscription
    void supabase?.auth
      .getSession()
      .then(({ data, error: authError }) => {
        if (!authObserved)
          resetSession(authError === null ? data.session : null)
      })
      .catch(() => {
        if (!authObserved) resetSession(null)
      })
    if (supabase === undefined) resetSession(null)
    return () => {
      active = false
      mounted.current = false
      request.current?.abort()
      request.current = undefined
      subscription?.unsubscribe()
    }
  }, [])

  const host = directory?.hosts.find((candidate) => candidate.hostId === hostId)

  async function pair() {
    if (
      session == null ||
      request.current !== undefined ||
      !/^\d{6}$/u.test(code)
    )
      return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError(undefined)
    setResult(undefined)
    setPairingMessage('正在配对…')
    setDirectory(undefined)
    setHostId('')
    setCode('')
    const current = () => mounted.current && request.current === controller
    try {
      const paired = await pairSupervisorCheckDevice({
        session,
        identity: nativeCapabilities.productDeviceIdentity,
        signal: controller.signal,
        code,
        allowRegistration: registrationAvailable && allowRegistration,
      })
      controller.signal.throwIfAborted()
      if (!current()) return
      if (paired.status !== 'paired') {
        setPairingMessage(pairingStatusLabel(paired))
        return
      }
      const pairedHost = paired.directory.hosts.find(
        (entry) => entry.hostId === paired.hostId,
      )
      if (pairedHost === undefined)
        throw new Error('remote_supervisor_response_invalid')
      setDirectory(paired.directory)
      setHostId(paired.hostId)
      setPairingMessage('已配对，正在连接…')
      const connection = await openSupervisorCheckSession({
        session,
        host: pairedHost,
        productDevice: paired.directory.productDevice,
        identity: nativeCapabilities.productDeviceIdentity,
        signal: controller.signal,
        forceRelay: mode === 'relay',
      })
      await disconnectRemoteSupervisor(connection)
      controller.signal.throwIfAborted()
      if (current()) setPairingMessage(`已连接 ${pairedHost.safeLabel}`)
    } catch (caught) {
      if (current()) {
        setPairingMessage('')
        setError(checkErrorCategory(caught))
      }
    } finally {
      if (current()) {
        request.current = undefined
        setBusy(false)
      }
    }
  }

  async function loadDirectory() {
    if (session == null || request.current !== undefined) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError(undefined)
    setResult(undefined)
    setPairingMessage('')
    setDirectory(undefined)
    setHostId('')
    try {
      const next = await loadSupervisorCheckDirectory({
        session,
        identity: nativeCapabilities.productDeviceIdentity,
        signal: controller.signal,
      })
      if (
        mounted.current &&
        request.current === controller &&
        !controller.signal.aborted
      ) {
        setDirectory(next)
      }
    } catch (caught) {
      if (mounted.current && request.current === controller)
        setError(checkErrorCategory(caught))
    } finally {
      if (mounted.current && request.current === controller) {
        request.current = undefined
        setBusy(false)
      }
    }
  }

  async function run() {
    if (
      session == null ||
      directory === undefined ||
      host === undefined ||
      request.current !== undefined
    )
      return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError(undefined)
    setResult(undefined)
    try {
      await runSupervisorCheck({
        connect: (forceRelay, signal) =>
          connectSupervisorCheck({
            session,
            host,
            productDevice: directory.productDevice,
            identity: nativeCapabilities.productDeviceIdentity,
            forceRelay,
            signal,
          }),
        forceRelay: mode === 'relay',
        signal: controller.signal,
        onProgress: (next) => {
          if (mounted.current && request.current === controller) setResult(next)
        },
      })
    } finally {
      if (mounted.current && request.current === controller) {
        request.current = undefined
        setBusy(false)
      }
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-5 bg-background p-6 text-text-primary">
      <h1 className="text-xl font-semibold">Supervisor 只读连接检查</h1>
      <p className="text-sm text-text-secondary">
        选择同账号已授权的电脑，检查自动连接或只走 Relay 的读取结果。
      </p>
      {session == null ? (
        <Notice tone="warn">
          {session === undefined
            ? '正在读取登录状态。'
            : '请先在开发版登录已有账号，再重新打开此页面。'}
          <a className="ml-2 underline" href="/signin">
            打开登录页
          </a>
        </Notice>
      ) : null}
      {!nativeCapabilities.productDeviceIdentity.available ? (
        <Notice tone="warn">需要在桌面开发版中使用已有设备身份。</Notice>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void pair()
        }}
      >
        <label className="block text-sm">
          输入配对码
          <Input
            className="mt-2 max-w-44"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={code}
            onChange={(event) =>
              setCode(event.target.value.replace(/\D/gu, ''))
            }
            disabled={busy}
          />
        </label>
        <Button
          type="submit"
          disabled={
            busy ||
            session == null ||
            code.length !== 6 ||
            !nativeCapabilities.productDeviceIdentity.available
          }
        >
          配对
        </Button>
        {registrationAvailable ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allowRegistration}
              disabled={busy}
              onChange={(event) => setAllowRegistration(event.target.checked)}
            />
            在未注册的桌面设备上建立设备身份
          </label>
        ) : null}
      </form>
      {pairingMessage === '' ? null : (
        <p role="status" className="text-sm">
          {pairingMessage}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Button
          variant="secondary"
          disabled={
            busy ||
            session == null ||
            !nativeCapabilities.productDeviceIdentity.available
          }
          onClick={() => void loadDirectory()}
        >
          读取已授权电脑
        </Button>
        <div className="min-w-52 flex-1">
          <label
            id="supervisor-check-host-label"
            className="mb-2 block text-sm"
          >
            电脑
          </label>
          <Select
            value={hostId}
            onValueChange={setHostId}
            disabled={
              busy || directory === undefined || directory.hosts.length === 0
            }
          >
            <SelectTrigger aria-labelledby="supervisor-check-host-label">
              <SelectValue placeholder="请选择电脑" />
            </SelectTrigger>
            <SelectContent>
              {directory?.hosts.map((host) => (
                <SelectItem key={host.hostId} value={host.hostId}>
                  {host.safeLabel}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-40">
          <label
            id="supervisor-check-mode-label"
            className="mb-2 block text-sm"
          >
            连接方式
          </label>
          <Select value={mode} onValueChange={setMode} disabled={busy}>
            <SelectTrigger aria-labelledby="supervisor-check-mode-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">自动</SelectItem>
              <SelectItem value="relay">只走 Relay</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          disabled={busy || hostId === '' || session == null}
          onClick={() => void run()}
        >
          开始检查
        </Button>
        <Button
          variant="secondary"
          disabled={!busy}
          onClick={() => request.current?.abort()}
        >
          取消
        </Button>
      </div>
      {directory?.hosts.length === 0 ? (
        <Notice tone="warn">没有可用的电脑。请在电脑上生成配对码。</Notice>
      ) : null}
      {error !== undefined ? (
        <Notice tone="err">错误类型：{error}</Notice>
      ) : null}
      <div
        role="status"
        aria-live="polite"
        className="text-sm text-text-secondary"
      >
        {busy
          ? '正在执行检查。'
          : result === undefined
            ? '尚未开始检查。'
            : '检查已结束，请查看各项结果。'}
      </div>
      {result === undefined ? null : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Supervisor 连接和七项只读检查结果
            </caption>
            <thead>
              <tr>
                <th className="p-2">检查</th>
                <th className="p-2">结果</th>
                <th className="p-2">连接</th>
                <th className="p-2">耗时</th>
                <th className="p-2">错误类型</th>
              </tr>
            </thead>
            <tbody>
              <MeasurementRow label="建立连接" value={result.connection} />
              {supervisorCheckOperations.map((operation, index) => (
                <MeasurementRow
                  key={operation}
                  label={operation}
                  value={result.steps[index]!}
                />
              ))}
              <MeasurementRow label="释放连接" value={result.cleanup} />
            </tbody>
          </table>
        </div>
      )}
      {session != null && directory !== undefined && host !== undefined ? (
        <SupervisorOperationChecks
          key={`${host.hostId}:${mode}:${host.authorization.authorizationId}`}
          session={session}
          host={host}
          productDevice={directory.productDevice}
          identity={nativeCapabilities.productDeviceIdentity}
          forceRelay={mode === 'relay'}
          disabled={busy}
        />
      ) : null}
    </main>
  )
}

function pairingStatusLabel(
  status: Exclude<SupervisorCheckPairing, { status: 'paired' }>,
): string {
  switch (status.status) {
    case 'invalid_code':
      return `配对码不对，还可以试 ${status.remainingAttempts ?? 0} 次。`
    case 'expired':
      return '配对码已过期，请在电脑上重新生成。'
    case 'used':
      return '配对码已使用，请在电脑上重新生成。'
    case 'cancelled':
      return '配对已取消，请在电脑上重新生成。'
    case 'rate_limited':
      return '尝试次数已达上限，请在电脑上重新生成配对码。'
  }
}

function MeasurementRow({
  label,
  value,
}: {
  readonly label: string
  readonly value: CheckMeasurement
}) {
  return (
    <tr className="border-b border-border">
      <th scope="row" className="p-2 font-medium">
        {label}
      </th>
      <td className="p-2">{statusLabels[value.status]}</td>
      <td className="p-2">{value.transport ?? '—'}</td>
      <td className="p-2">
        {value.elapsedMs === null ? '—' : `${value.elapsedMs} ms`}
      </td>
      <td className="p-2">{value.error ?? '—'}</td>
    </tr>
  )
}
