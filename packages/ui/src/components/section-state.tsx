import type { ComponentPropsWithoutRef, ReactNode } from 'react'

import { cn } from '@codetether/ui/lib/cn'
import { Notice } from '@codetether/ui/components/notice'

export interface SectionStateProps extends Omit<
  ComponentPropsWithoutRef<'div'>,
  'title'
> {
  state: 'loading' | 'empty' | 'error'
  title?: ReactNode
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
}

export function SectionState({
  state,
  title,
  description,
  icon,
  action,
  className,
  children,
  ...props
}: SectionStateProps) {
  if (state === 'error') {
    return (
      <Notice
        tone="err"
        title={title ?? '暂时无法加载'}
        action={action}
        className={className}
        {...props}
      >
        {description ?? children}
      </Notice>
    )
  }
  if (state === 'loading') {
    return (
      <div
        role="status"
        aria-busy="true"
        data-slot="section-state"
        data-state="loading"
        className={cn('space-y-3 py-6', className)}
        {...props}
      >
        <span className="sr-only">{title ?? '正在加载'}</span>
        <div
          aria-hidden="true"
          className="h-3 w-2/3 rounded-xs bg-surface-inset motion-safe:animate-pulse"
        />
        <div
          aria-hidden="true"
          className="h-3 w-full rounded-xs bg-surface-hover motion-safe:animate-pulse"
        />
        <div
          aria-hidden="true"
          className="h-3 w-1/2 rounded-xs bg-surface-inset motion-safe:animate-pulse"
        />
      </div>
    )
  }
  return (
    <div
      data-slot="section-state"
      data-state="empty"
      className={cn(
        'flex min-w-0 flex-col items-center gap-2.5 px-6 py-12 text-center text-text-secondary',
        className,
      )}
      {...props}
    >
      {icon ? (
        <div aria-hidden="true" className="mb-1 text-text-muted">
          {icon}
        </div>
      ) : null}
      {title ? (
        <div className="text-lg font-semibold text-text-primary">{title}</div>
      ) : null}
      {description ? (
        <div className="max-w-prose text-md">{description}</div>
      ) : null}
      {children}
      {action ? (
        <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>
      ) : null}
    </div>
  )
}
