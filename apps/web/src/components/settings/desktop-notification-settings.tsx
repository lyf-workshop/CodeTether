import { useMemo, useState } from 'react'

import type { AttentionType } from '@codetether/protocol'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
} from '@codetether/ui'

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
    description: '智能体等待你的确认时通知。',
  },
  {
    type: 'completed_review',
    label: '工作完成',
    description: '智能体完成本轮工作时通知。',
  },
  {
    type: 'failed',
    label: '执行失败',
    description: '本轮执行失败并需要查看时通知。',
  },
] as const satisfies readonly {
  readonly type: AttentionType
  readonly label: string
  readonly description: string
}[]

export interface DesktopNotificationSettingsProps {
  readonly notificationAvailable?: boolean
  readonly backgroundRuntimeAvailable?: boolean
  readonly storage?: NotificationPreferenceStorage
}

export function DesktopNotificationSettings({
  notificationAvailable = nativeCapabilities.notifications.available,
  backgroundRuntimeAvailable = nativeCapabilities.backgroundRuntime.available,
  storage,
}: DesktopNotificationSettingsProps) {
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
    <section
      aria-labelledby="settings-heading"
      className="mx-auto w-full max-w-xl px-[var(--layout-content-inline-padding)] py-[var(--layout-content-block-padding)]"
    >
      <h1
        id="settings-heading"
        className="text-page font-semibold text-text-primary"
      >
        设置
      </h1>
      <p className="mt-1 text-sm text-text-secondary">
        管理需要在后台提醒你的事项。
      </p>

      <Card className="mt-5">
        <CardHeader className="pb-3">
          <CardTitle id="desktop-notifications-heading">桌面通知</CardTitle>
          <CardDescription>
            仅在真正需要你处理或查看工作时发送系统通知。
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {notificationAvailable && preferenceStorage !== undefined ? (
            <fieldset aria-labelledby="desktop-notifications-heading">
              <legend className="sr-only">桌面通知类型</legend>
              <div className="divide-y divide-border">
                {notificationOptions.map((option) => (
                  <label
                    key={option.type}
                    className="flex min-h-14 cursor-pointer items-center gap-4 py-2.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-medium text-text-primary">
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-sm text-text-secondary">
                        {option.description}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={preferences[option.type]}
                      className={cn(
                        'size-4 shrink-0 cursor-pointer accent-primary-action',
                        'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                      )}
                      onChange={(event) =>
                        setPreference(option.type, event.currentTarget.checked)
                      }
                    />
                  </label>
                ))}
              </div>
              {saveFailed ? (
                <p role="alert" className="mt-3 text-sm text-danger">
                  无法保存通知偏好。当前设置未更改，请重试。
                </p>
              ) : null}
            </fieldset>
          ) : (
            <div role="status" className="border-t border-border py-3">
              <p className="text-base font-medium text-text-primary">
                桌面通知需要 CodeTether Desktop
              </p>
              <p className="mt-1 text-sm text-text-secondary">
                浏览器中仍可通过收件箱查看所有待处理事项。
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {backgroundRuntimeAvailable ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle id="background-runtime-heading">后台运行</CardTitle>
            <CardDescription>
              关闭窗口后，CodeTether
              将继续在系统托盘运行，以便任务、审批和通知继续工作。
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}
    </section>
  )
}
