import type { ComponentPropsWithoutRef, ReactNode } from 'react'

import { cn } from '../../lib/cn'

export interface SettingsRowProps extends Omit<
  ComponentPropsWithoutRef<'div'>,
  'title'
> {
  title: ReactNode
  description?: ReactNode
  control?: ReactNode
}

export function SettingsRow({
  title,
  description,
  control,
  children,
  className,
  ...props
}: SettingsRowProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-4 border-t border-border px-5 py-4 first:border-t-0',
        className,
      )}
      {...props}
    >
      <div className="min-w-0 flex-1 basis-48">
        <div className="text-base font-medium text-text-primary">{title}</div>
        {description ? (
          <div className="mt-1 text-sm text-text-secondary">{description}</div>
        ) : null}
      </div>
      {control ? (
        <div className="flex max-w-full flex-wrap items-center gap-2">
          {control}
        </div>
      ) : null}
      {children ? <div className="w-full min-w-0">{children}</div> : null}
    </div>
  )
}
