import type { ComponentPropsWithoutRef, ReactNode } from 'react'

import { cn } from '../../lib/cn'

export interface DeviceSectionProps extends Omit<
  ComponentPropsWithoutRef<'section'>,
  'title'
> {
  title: ReactNode
  icon?: ReactNode
  status?: ReactNode
  metadata?: ReactNode
  description?: ReactNode
  action?: ReactNode
}

/** A presentational device heading and its project grid; no product records. */
export function DeviceSection({
  title,
  icon,
  status,
  metadata,
  description,
  action,
  children,
  className,
  ...props
}: DeviceSectionProps) {
  return (
    <section
      data-slot="device-section"
      className={cn('min-w-0 space-y-4', className)}
      {...props}
    >
      <header className="flex min-w-0 flex-wrap items-center gap-3">
        {icon ? (
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-surface-inset text-text-secondary [&>svg]:size-5"
          >
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1 basis-40">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <h2 className="min-w-0 truncate text-lg font-semibold">{title}</h2>
            {status}
          </div>
          {metadata ? (
            <div className="mt-0.5 text-sm text-text-muted">{metadata}</div>
          ) : null}
        </div>
        {action}
      </header>
      {description ? (
        <p className="text-sm text-text-secondary">{description}</p>
      ) : null}
      {children}
    </section>
  )
}
