import { useId, useMemo, useState } from 'react'
import type { AttentionType } from '@codetether/protocol'

import { Notice, SettingsRow, Switch } from '@codetether/ui'
import { nativeCapabilities } from '../../runtime/native/native-capabilities'
import {
  persistDesktopNotificationPreferences,
  readDesktopNotificationPreferences,
  resolveNotificationPreferenceStorage,
  updateDesktopNotificationPreference,
  type NotificationPreferenceStorage,
} from '../../runtime/native/notification-preferences'

const notificationOptions = [
  {
    type: 'approval',
    label: '需要批准',
    description: 'Codex 请求批准命令或文件操作时提醒。',
  },
  {
    type: 'completed_review',
    label: '工作完成',
    description: '一轮工作完成、等你查看时提醒。',
  },
  { type: 'failed', label: '执行失败', description: '一轮工作失败时提醒。' },
] as const satisfies readonly {
  readonly type: AttentionType
  readonly label: string
  readonly description: string
}[]

export interface DesktopNotificationSettingsProps {
  readonly notificationAvailable?: boolean
  readonly storage?: NotificationPreferenceStorage
}

export function DesktopNotificationSettings({
  notificationAvailable = nativeCapabilities.notifications.available,
  storage,
}: DesktopNotificationSettingsProps) {
  const descriptionId = useId()
  const preferenceStorage = useMemo(
    () =>
      notificationAvailable
        ? (storage ?? resolveNotificationPreferenceStorage())
        : undefined,
    [notificationAvailable, storage],
  )
  const [preferences, setPreferences] = useState(() =>
    readDesktopNotificationPreferences(preferenceStorage),
  )
  const [saveFailed, setSaveFailed] = useState(false)
  function setPreference(type: AttentionType, enabled: boolean) {
    const next = updateDesktopNotificationPreference(preferences, type, enabled)
    if (!persistDesktopNotificationPreferences(preferenceStorage, next)) {
      setSaveFailed(true)
      return
    }
    setPreferences(next)
    setSaveFailed(false)
  }
  return (
    <section aria-labelledby="desktop-notifications-heading">
      <h2
        id="desktop-notifications-heading"
        className="mb-5 text-xl font-semibold"
      >
        通知
      </h2>
      {notificationAvailable && preferenceStorage !== undefined ? (
        <fieldset className="overflow-hidden rounded-lg border border-border bg-surface">
          <legend className="sr-only">桌面通知类型</legend>
          {notificationOptions.map((option) => (
            <SettingsRow
              key={option.type}
              title={option.label}
              description={option.description}
              descriptionId={`${descriptionId}-${option.type}-description`}
              control={
                <Switch
                  aria-label={option.label}
                  aria-describedby={`${descriptionId}-${option.type}-description`}
                  checked={preferences[option.type]}
                  onCheckedChange={(enabled) =>
                    setPreference(option.type, enabled)
                  }
                />
              }
            />
          ))}
        </fieldset>
      ) : (
        <Notice
          title={
            notificationAvailable
              ? '暂时无法保存通知偏好'
              : '桌面通知需要 CodeTether Desktop'
          }
        >
          {notificationAvailable
            ? '此窗口无法访问偏好存储。现有设置没有改变。'
            : '浏览器中请查看“待处理”，不会发送系统通知。'}
        </Notice>
      )}
      {saveFailed ? (
        <div className="mt-4">
          <Notice tone="err" title="无法保存通知偏好">
            当前设置未更改，请重试。
          </Notice>
        </div>
      ) : null}
      <p className="mt-4 text-sm text-text-muted">
        通知中不包含会话标题、消息或命令内容。只有桌面版 CodeTether
        提供系统通知，浏览器中请查看“待处理”。
      </p>
    </section>
  )
}
