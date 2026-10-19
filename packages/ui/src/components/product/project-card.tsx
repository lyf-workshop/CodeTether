import * as React from 'react'
import { Folder, Plus } from 'lucide-react'

import { Button, type ButtonProps } from '../button'
import { cn } from '../../lib/cn'

export interface ProjectCardProps extends Omit<
  React.ComponentPropsWithoutRef<'article'>,
  'title'
> {
  name: string
  rootPath: string
  status?: React.ReactNode
  metrics?: React.ReactNode
  activity?: React.ReactNode
  primaryAction?: React.ReactNode
  dimmed?: boolean
  appearance?: 'card' | 'row'
}

export function ProjectCard({
  name,
  rootPath,
  status,
  metrics,
  activity,
  primaryAction,
  dimmed = false,
  appearance = 'card',
  className,
  ...props
}: ProjectCardProps) {
  return (
    <article
      data-slot="project-card"
      data-appearance={appearance}
      data-state={dimmed ? 'unavailable' : 'available'}
      className={cn(
        'relative isolate flex min-w-0 gap-1.5 rounded-lg border border-border bg-surface p-4',
        appearance === 'card'
          ? 'min-h-30 flex-col'
          : 'min-h-15 flex-col sm:flex-row sm:items-center sm:gap-3',
        primaryAction &&
          'transition-shadow duration-150 hover:border-border-strong hover:shadow-hover motion-reduce:transition-none',
        dimmed && 'bg-transparent',
        className,
      )}
      {...props}
    >
      {primaryAction}
      <div className="pointer-events-none relative z-[1] min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <Folder
            aria-hidden="true"
            className="size-4 shrink-0 text-text-muted"
          />
          <h3
            title={name}
            className={cn(
              'min-w-0 flex-1 truncate text-base font-semibold',
              dimmed ? 'text-text-secondary' : 'text-text-primary',
            )}
          >
            {name}
          </h3>
          {status}
        </div>
        <p
          title={rootPath}
          className="mt-1.5 truncate font-mono text-xs text-text-muted"
        >
          {rootPath}
        </p>
      </div>
      {metrics || activity ? (
        <div
          className={cn(
            'pointer-events-none relative z-[1] flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted',
            appearance === 'card' ? 'mt-auto pt-2.5' : 'shrink-0 pt-1 sm:pt-0',
          )}
        >
          <span className="min-w-0 flex-1">{metrics}</span>
          {activity}
        </div>
      ) : null}
    </article>
  )
}

export interface AddProjectCardProps extends Omit<ButtonProps, 'children'> {
  description?: string
}

export const AddProjectCard = React.forwardRef<
  HTMLButtonElement,
  AddProjectCardProps
>(({ description, className, ...props }, ref) => (
  <Button
    ref={ref}
    variant="outline"
    data-slot="add-project-card"
    className={cn(
      'h-auto min-h-30 w-full flex-col gap-2 whitespace-normal rounded-lg border-dashed bg-transparent p-4 text-center shadow-none hover:bg-surface',
      className,
    )}
    {...props}
  >
    <Plus aria-hidden="true" className="size-5 text-text-muted" />
    <span className="font-medium">添加项目</span>
    {description ? (
      <span className="text-sm font-normal text-text-muted">{description}</span>
    ) : null}
  </Button>
))

AddProjectCard.displayName = 'AddProjectCard'
