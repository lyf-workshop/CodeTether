import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  Button,
  Notice,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@codetether/ui'

import { getSupabaseAccountClient } from '../runtime/account/supabase-account.js'
import { nativeCapabilities } from '../runtime/native/native-capabilities.js'
import {
  connectSupervisorCheck,
  loadSupervisorCheckDirectory,
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
  const request = useRef<AbortController | undefined>(undefined)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    let active = true
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

  async function loadDirectory() {
    if (session == null || request.current !== undefined) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError(undefined)
    setResult(undefined)
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
    const host = directory?.hosts.find(
      (candidate) => candidate.hostId === hostId,
    )
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
        <Notice tone="warn">没有可用的既有只读授权；请先检查现有授权。</Notice>
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
          ? '正在执行只读检查。'
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
    </main>
  )
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
