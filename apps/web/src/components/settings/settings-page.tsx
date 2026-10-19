import { Link, useLocation, useSearch } from '@tanstack/react-router'
import { Bell, CircleUserRound, Info, Power, Sun } from 'lucide-react'

import { cn } from '@codetether/ui'
import { AboutSettings } from './about-settings'
import { AccountSettings } from './account-settings'
import { AppearanceSettings } from './appearance-settings'
import { BackgroundSettings } from './background-settings'
import { DesktopNotificationSettings } from './desktop-notification-settings'
import {
  parseSettingsSearch,
  settingsSectionFromPath,
  type SettingsSection,
} from './settings-model'

const sections = [
  { id: 'appearance', label: '外观', shortLabel: '外观', icon: Sun },
  { id: 'account', label: '账号', shortLabel: '账号', icon: CircleUserRound },
  { id: 'notify', label: '通知', shortLabel: '通知', icon: Bell },
  { id: 'background', label: '后台运行', shortLabel: '后台', icon: Power },
  { id: 'about', label: '关于与检查', shortLabel: '关于', icon: Info },
] as const

export function SettingsRoute() {
  const pathname = useLocation({ select: (location) => location.pathname })
  return <SettingsPage section={settingsSectionFromPath(pathname)} />
}

export function SettingsPage({
  section = 'appearance',
}: {
  section?: SettingsSection
}) {
  const search = parseSettingsSearch(useSearch({ strict: false }))
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-(--layout-settings-width) grid-cols-[var(--layout-settings-navigation-width)_minmax(0,1fr)] gap-[var(--s10)] px-8 pt-6 pb-12 max-[1000px]:grid-cols-[var(--layout-settings-navigation-compact-width)_minmax(0,1fr)] max-[1000px]:gap-6 max-[600px]:grid-cols-1 max-[600px]:px-4 max-[600px]:pt-4 max-[600px]:pb-8">
      <div>
        <h1 className="mb-5 text-page font-semibold">设置</h1>
        <nav aria-label="设置分类" className="grid gap-1 max-[600px]:hidden">
          {sections.map(({ id, label, icon: Icon }) => (
            <Link
              key={id}
              to="/settings/$section"
              params={{ section: id }}
              search={search}
              aria-current={id === section ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-sm px-3 py-2 text-base outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring',
                id === section
                  ? 'bg-surface-inset font-semibold text-text-primary'
                  : 'text-text-secondary',
              )}
            >
              <Icon aria-hidden="true" className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
        <nav
          aria-label="设置分类"
          className="grid min-w-0 grid-cols-5 gap-1 rounded-lg border border-border bg-surface-inset p-1 min-[601px]:hidden"
        >
          {sections.map(({ id, shortLabel }) => (
            <Link
              key={id}
              to="/settings/$section"
              params={{ section: id }}
              search={search}
              aria-current={id === section ? 'page' : undefined}
              className={cn(
                'min-w-0 rounded-sm px-1 py-2 text-center text-sm whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring',
                id === section
                  ? 'bg-surface font-semibold text-text-primary shadow-subtle'
                  : 'text-text-secondary',
              )}
            >
              {shortLabel}
            </Link>
          ))}
        </nav>
      </div>
      <div className="min-w-0">
        {section === 'appearance' ? (
          <AppearanceSettings />
        ) : section === 'account' ? (
          <AccountSettings />
        ) : section === 'notify' ? (
          <DesktopNotificationSettings />
        ) : section === 'background' ? (
          <BackgroundSettings />
        ) : (
          <AboutSettings />
        )}
      </div>
    </div>
  )
}
