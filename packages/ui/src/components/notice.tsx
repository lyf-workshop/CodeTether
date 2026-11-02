import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'

import { cn } from '@codetether/ui/lib/cn'

export interface NoticeProps extends Omit<
  ComponentPropsWithoutRef<'div'>,
  'title'
> {
  tone?: 'info' | 'warn' | 'err' | 'ok'
  title?: ReactNode
  action?: ReactNode
}

const noticeTones = {
  info: { icon: Info, className: 'bg-info-muted text-info-text' },
  warn: {
    icon: TriangleAlert,
    className: 'bg-warning-muted text-warning-text',
  },
  err: { icon: CircleAlert, className: 'bg-danger-muted text-danger-text' },
  ok: { icon: CircleCheck, className: 'bg-success-muted text-success-text' },
} as const

export function Notice({
  tone = 'info',
  title,
  action,
  children,
  className,
  role,
  ...props
}: NoticeProps) {
  const { icon: Icon, className: toneClassName } = noticeTones[tone]
  return (
    <div
      data-slot="notice"
      data-tone={tone}
      role={role ?? (tone === 'err' ? 'alert' : undefined)}
      className={cn(
        'flex min-w-0 flex-wrap items-start gap-3 rounded-lg px-3.5 py-3 text-md',
        toneClassName,
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 basis-40">
        {title ? (
          <div className="font-semibold text-text-primary">{title}</div>
        ) : null}
        {children ? (
          <div className="text-text-secondary">{children}</div>
        ) : null}
      </div>
      {action ? (
        <div className="flex max-w-full flex-wrap items-center gap-1.5 self-center">
          {action}
        </div>
      ) : null}
    </div>
  )
}
