import { useSyncExternalStore } from 'react'
import { Check } from 'lucide-react'

import { Button, SettingsRow, cn } from '@codetether/ui'
import {
  getThemeController,
  type ThemePreference,
} from '../../runtime/theme/theme-preference'

const themeOptions = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
] as const
const subscribe = (listener: () => void) =>
  getThemeController().subscribe(listener)
const getSnapshot = () =>
  typeof document === 'undefined'
    ? 'light'
    : getThemeController().getPreference()
const getServerSnapshot = (): ThemePreference => 'light'

export function AppearanceSettings() {
  const preference = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  )
  return (
    <>
      <h2 className="mb-5 text-xl font-semibold">外观</h2>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <SettingsRow
          title="主题"
          description="默认浅色。选择“跟随系统”会随系统的深浅色设置切换。"
        >
          <div
            className="grid grid-cols-1 gap-3 min-[390px]:grid-cols-3"
            role="group"
            aria-label="主题"
          >
            {themeOptions.map((option) => (
              <Button
                key={option.value}
                variant="secondary"
                className={cn(
                  'h-auto min-w-0 flex-col items-stretch gap-3 rounded-lg p-3',
                  preference === option.value && 'border-ring ring-1 ring-ring',
                )}
                aria-pressed={preference === option.value}
                onClick={() => getThemeController().setPreference(option.value)}
              >
                <span
                  aria-hidden="true"
                  className="flex h-20 overflow-hidden rounded-sm border border-border"
                >
                  {option.value === 'system' ? (
                    <>
                      <ThemePreview theme="light" />
                      <ThemePreview theme="dark" />
                    </>
                  ) : (
                    <ThemePreview theme={option.value} />
                  )}
                </span>
                <span className="flex justify-between gap-1 text-sm">
                  {option.label}
                  {preference === option.value ? (
                    <Check aria-hidden="true" className="size-4" />
                  ) : null}
                </span>
              </Button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow
          title="语言"
          description="目前只提供简体中文。"
          control={<span className="text-sm text-text-muted">简体中文</span>}
        />
      </div>
    </>
  )
}

function ThemePreview({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <span data-theme={theme} className="flex min-w-0 flex-1 bg-(--ct-bg)">
      <span className="flex w-1/3 flex-col gap-2 bg-(--ct-side) p-2">
        <i className="h-1 rounded-full bg-(--ct-line-strong)" />
        <i className="h-1 rounded-full bg-(--ct-line-strong)" />
        <i className="h-1 rounded-full bg-(--ct-line-strong)" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <i className="h-1 rounded-full bg-(--ct-line-strong)" />
        <i className="h-2 rounded-xs bg-(--ct-ink)" />
        <i className="h-1 rounded-full bg-(--ct-line-strong)" />
      </span>
    </span>
  )
}
