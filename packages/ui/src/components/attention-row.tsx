import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { cn } from '../lib/cn'

interface AttentionRowProps extends Omit<
  ComponentPropsWithoutRef<'article'>,
  'title'
> {
  readonly mark: ReactNode
  readonly title: ReactNode
  readonly description: ReactNode
  readonly context: ReactNode
  readonly time: ReactNode
  readonly actions: ReactNode
}

/** Shared flat attention-row layout; mutation and trust decisions remain in the product. */
export function AttentionRow({
  mark,
  title,
  description,
  context,
  time,
  actions,
  className,
  ...props
}: AttentionRowProps) {
  return (
    <article
      data-slot="attention-row"
      className={cn(
        'grid min-w-0 grid-cols-[var(--avatar-size-md)_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 bg-surface px-4 py-3 max-[600px]:grid-cols-[var(--avatar-size-md)_minmax(0,1fr)]',
        className,
      )}
      {...props}
    >
      <div data-slot="attention-mark" className="row-span-2 pt-0.5">
        {mark}
      </div>
      <div
        data-slot="attention-body"
        className="row-span-2 min-w-0 max-[600px]:row-span-1"
      >
        <h2 className="truncate text-base font-medium text-text-primary">
          {title}
        </h2>
        <div className="mt-0.5 min-w-0 truncate text-sm text-text-secondary">
          {description}
        </div>
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-text-muted">
          {context}
        </div>
      </div>
      <div
        data-slot="attention-time"
        className="pt-0.5 text-right text-xs text-text-muted max-[600px]:col-start-2 max-[600px]:row-start-2 max-[600px]:text-left"
      >
        {time}
      </div>
      <div
        data-slot="attention-actions"
        className="col-start-3 row-start-2 flex min-w-0 flex-wrap items-center justify-end gap-2 max-[600px]:col-start-2 max-[600px]:row-start-3 max-[600px]:justify-start"
      >
        {actions}
      </div>
    </article>
  )
}
