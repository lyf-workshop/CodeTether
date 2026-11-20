import type { ReactNode } from 'react'

export interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  icon?: ReactNode
  headingId?: string
  level?: 1 | 2
}

export function PageHeader({
  title,
  description,
  actions,
  icon,
  headingId,
  level = 1,
}: PageHeaderProps) {
  const Heading = level === 2 ? 'h2' : 'h1'

  return (
    <header
      data-slot="page-header"
      className="mb-6 flex min-w-0 flex-wrap items-center gap-4"
    >
      <div className="flex min-w-0 flex-1 basis-64 items-center gap-4">
        {icon ? (
          <span
            aria-hidden="true"
            className="grid size-12 shrink-0 place-items-center rounded-lg border border-border bg-surface-inset text-text-muted"
          >
            {icon}
          </span>
        ) : null}
        <div className="grid min-w-0 gap-2">
          <Heading
            id={headingId}
            title={typeof title === 'string' ? title : undefined}
            className={
              level === 2
                ? 'line-clamp-2 text-xl font-semibold text-text-primary'
                : 'line-clamp-2 text-page font-semibold text-text-primary'
            }
          >
            {title}
          </Heading>
          {description ? (
            <div className="min-w-0 text-base text-text-secondary">
              {description}
            </div>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex max-w-full flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  )
}
