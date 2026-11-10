import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button, CodeTetherMark, Notice, SettingsRow } from '@codetether/ui'
import {
  useHostConnectionState,
  useHostProjection,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import { machineListQueryOptions } from '../../runtime/host/machine-query'
import {
  nativeCapabilities,
  type DesktopUpdateSnapshot,
  type DesktopUpdateStatus,
} from '../../runtime/native/native-capabilities'
import {
  countLocalActiveConversations,
  updateNotesText,
} from '../../runtime/native/desktop-update-model'
import { desktopUpdateQueryKey } from '../../runtime/native/use-desktop-update-state'
import { productVersion } from '../../runtime/product-version'

type UpdateAction = 'check' | 'download' | 'install'

export interface DesktopUpdateSettingsProps {
  readonly snapshot?: DesktopUpdateSnapshot
  readonly readFailed: boolean
  readonly refresh: () => void
}

export function DesktopUpdateSettings({
  snapshot,
  readFailed,
  refresh,
}: DesktopUpdateSettingsProps) {
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const projection = useHostProjection()
  const queryClient = useQueryClient()
  const [notesExpanded, setNotesExpanded] = useState(false)
  const [preflightActiveCount, setPreflightActiveCount] = useState<number>()
  const machinesQuery = useQuery({
    ...machineListQueryOptions(runtime),
    enabled: connectionState === 'connected',
  })
  const localMachineId = machinesQuery.data?.find(
    (machine) => machine.isLocal,
  )?.machineId
  const projectedCount = countLocalActiveConversations(
    projection === undefined
      ? undefined
      : Object.values(projection.conversations),
    localMachineId,
  )
  const activeCount =
    connectionState === 'connected'
      ? (projectedCount ?? preflightActiveCount)
      : undefined

  async function installAfterPreflight(): Promise<DesktopUpdateSnapshot> {
    if (runtime.connectionState !== 'connected') {
      throw new Error('host-unavailable')
    }
    const [hostSnapshot, machines] = await Promise.all([
      runtime.readUpdatePreflight(),
      runtime.listMachines(),
    ])
    const localId = machines.machines.find(
      (machine) => machine.isLocal,
    )?.machineId
    const count = countLocalActiveConversations(
      hostSnapshot.conversations,
      localId,
    )
    if (count === undefined || runtime.connectionState !== 'connected') {
      throw new Error('host-unavailable')
    }
    setPreflightActiveCount(count)
    if (count > 0) return await nativeCapabilities.desktopUpdater.state()
    return await nativeCapabilities.desktopUpdater.install()
  }

  const mutation = useMutation({
    mutationFn: async (action: UpdateAction) => {
      const updater = nativeCapabilities.desktopUpdater
      if (action === 'check') return await updater.check()
      if (action === 'install') return await installAfterPreflight()
      const downloaded = await updater.download((progress) => {
        queryClient.setQueryData<DesktopUpdateSnapshot>(
          desktopUpdateQueryKey,
          (current) =>
            current === undefined
              ? undefined
              : {
                  ...current,
                  status: 'downloading',
                  ...(progress.progressPercent === null
                    ? {}
                    : { progressPercent: progress.progressPercent }),
                },
        )
      })
      queryClient.setQueryData(desktopUpdateQueryKey, downloaded)
      return downloaded.status === 'downloaded'
        ? await installAfterPreflight()
        : downloaded
    },
    onSuccess: (next) => queryClient.setQueryData(desktopUpdateQueryKey, next),
  })

  const action = actionForStatus(snapshot?.status)
  const disabled =
    mutation.isPending ||
    snapshot?.status === 'checking' ||
    (action === 'install' && activeCount !== 0)
  const notes = updateNotesText(snapshot?.notes)
  const canExpandNotes = notes !== undefined && notes.length > 0
  const version = snapshot?.currentVersion ?? productVersion

  return (
    <>
      <SettingsRow
        title={
          <span className="flex items-start gap-3">
            <CodeTetherMark className="size-11 shrink-0 rounded-xl [&_svg]:size-6" />
            <span className="flex min-w-0 flex-col gap-1">
              <span>CodeTether</span>
              <span
                className="text-sm font-normal text-text-secondary"
                aria-live="polite"
              >
                {readFailed
                  ? `版本 ${version} · 暂时无法读取更新状态`
                  : statusLine(
                      snapshot,
                      version,
                      activeCount,
                      connectionState === 'connected',
                    )}
              </span>
            </span>
          </span>
        }
        description="简体中文 · 本机和配对设备的 AI 编程工作区"
        control={
          action !== undefined ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled}
              onClick={() => mutation.mutate(action)}
            >
              {actionLabel(snapshot, activeCount)}
            </Button>
          ) : readFailed ? (
            <Button variant="secondary" size="sm" onClick={refresh}>
              重试
            </Button>
          ) : null
        }
      >
        {notes !== undefined &&
        notes.length > 0 &&
        snapshot?.status === 'available' ? (
          <div className="rounded-md bg-surface-inset p-3 text-sm text-text-secondary">
            <p className="mb-1 font-medium text-text-primary">更新说明</p>
            <p
              className={
                notesExpanded
                  ? 'whitespace-pre-wrap break-words'
                  : 'line-clamp-6 whitespace-pre-wrap break-words'
              }
            >
              {notes}
            </p>
            {canExpandNotes ? (
              <button
                type="button"
                className="mt-2 text-primary-action underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                aria-expanded={notesExpanded}
                onClick={() => setNotesExpanded((expanded) => !expanded)}
              >
                {notesExpanded ? '收起' : '展开'}更新说明
              </button>
            ) : null}
          </div>
        ) : null}
        {snapshot?.status === 'downloading' ? (
          <progress
            className="w-full accent-primary-action"
            max={100}
            value={snapshot.progressPercent}
            aria-label="更新下载进度"
          />
        ) : null}
      </SettingsRow>
      {mutation.isError ? (
        <div className="border-t border-border px-5 py-4">
          <Notice tone="err" title="暂时无法完成更新操作">
            请确认本机服务已连接、会话已结束，然后重试。当前版本没有改变。
          </Notice>
        </div>
      ) : null}
    </>
  )
}

function actionForStatus(
  status: DesktopUpdateStatus | undefined,
): UpdateAction | undefined {
  switch (status) {
    case 'latest':
    case 'checking':
    case 'checkFailed':
      return 'check'
    case 'available':
    case 'downloadFailed':
    case 'signatureFailed':
      return 'download'
    case 'downloaded':
    case 'installFailed':
      return 'install'
    default:
      return undefined
  }
}

function actionLabel(
  snapshot: DesktopUpdateSnapshot | undefined,
  activeCount: number | undefined,
): string {
  if (snapshot?.status === 'available') {
    return `更新到 ${snapshot.availableVersion ?? '新版本'}`
  }
  if (snapshot?.status === 'downloaded') {
    return activeCount === undefined ? '正在确认本机会话' : '重新启动并更新'
  }
  if (snapshot?.status === 'latest' || snapshot?.status === 'checking') {
    return '检查更新'
  }
  return '重试'
}

function statusLine(
  snapshot: DesktopUpdateSnapshot | undefined,
  currentVersion: string,
  activeCount: number | undefined,
  hostConnected: boolean,
): string {
  const version = snapshot?.availableVersion ?? '新版本'
  switch (snapshot?.status) {
    case 'unconfigured':
      return `版本 ${currentVersion} · 这个版本没有配置自动更新`
    case 'latest':
      return snapshot.updatedTo === currentVersion
        ? `版本 ${currentVersion} · 已更新到 ${currentVersion}`
        : snapshot.lastCheckedAt === undefined
          ? `版本 ${currentVersion} · 尚未检查更新`
          : `版本 ${currentVersion} · 已是最新版本${lastCheckedText(snapshot.lastCheckedAt)}`
    case 'checking':
      return `版本 ${currentVersion} · 正在检查更新…`
    case 'available':
      return `有新版本 ${version}（当前 ${currentVersion}）`
    case 'downloading':
      return `正在下载 ${version}${snapshot.progressPercent === undefined ? '' : ` · ${Math.round(snapshot.progressPercent)}%`}`
    case 'downloaded':
      return activeCount === undefined
        ? `已下载 ${version}。正在确认本机会话。`
        : activeCount > 0
          ? `已下载 ${version}。有 ${activeCount} 个会话正在运行或等待批准，结束后才能更新，不会打断它们。`
          : `已下载 ${version}。更新时 CodeTether 会关闭几秒再自动打开。`
    case 'installing':
      return `正在关闭本地服务并安装 ${version}…`
    case 'checkFailed':
      return '暂时无法检查更新，请稍后再试'
    case 'downloadFailed':
      return `下载 ${version} 没有完成，请重试`
    case 'signatureFailed':
      return '下载的文件没有通过校验，没有安装。请稍后再试，多次失败请联系我们。'
    case 'installFailed':
      return hostConnected
        ? '没有完成更新，当前版本继续可用'
        : '没有完成更新，本机服务尚未恢复。请重新启动 CodeTether。'
    default:
      return `版本 ${currentVersion} · 正在读取更新状态…`
  }
}

function lastCheckedText(timestamp: number | undefined): string {
  if (timestamp === undefined) return ''
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return ' · 上次检查刚刚'
  if (minutes < 60) return ` · 上次检查 ${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return ` · 上次检查 ${hours} 小时前`
  return ` · 上次检查 ${Math.floor(hours / 24)} 天前`
}
