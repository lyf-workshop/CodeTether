import type { ComponentPropsWithoutRef } from 'react'

import { Badge } from '../badge'
import { cn } from '../../lib/cn'

export type DiffLineKind = 'context' | 'addition' | 'deletion'

export interface DiffLine {
  kind: DiffLineKind
  content: string
  oldLineNumber?: number
  newLineNumber?: number
}

export interface DiffCardProps extends Omit<
  ComponentPropsWithoutRef<'section'>,
  'children'
> {
  fileName: string
  lines: readonly DiffLine[]
}

const diffLineDefinitions = {
  context: {
    prefix: ' ',
    ariaLabel: '上下文',
    rowClassName: 'text-text-secondary',
    prefixClassName: 'text-text-muted',
  },
  addition: {
    prefix: '+',
    ariaLabel: '新增',
    rowClassName: 'bg-success-muted/15 text-text-secondary',
    prefixClassName: 'text-success',
  },
  deletion: {
    prefix: '-',
    ariaLabel: '删除',
    rowClassName: 'bg-danger-muted/15 text-text-secondary',
    prefixClassName: 'text-danger',
  },
} satisfies Record<
  DiffLineKind,
  {
    prefix: string
    ariaLabel: string
    rowClassName: string
    prefixClassName: string
  }
>

/** Read-only file diff based on Figma node 14:175. */
export function DiffCard({
  fileName,
  lines,
  className,
  ...props
}: DiffCardProps) {
  return (
    <section
      aria-label={`${fileName} 的 Diff`}
      data-slot="diff-card"
      className={cn(
        'w-full min-w-0 overflow-hidden rounded-xs border border-border/70 bg-surface-code/80',
        className,
      )}
      {...props}
    >
      <header className="flex min-h-10 min-w-0 items-center justify-between gap-3 border-b border-border/70 px-3">
        <code className="min-w-0 truncate font-sans text-xs font-medium text-text-secondary">
          {fileName}
        </code>
        <Badge
          variant="info"
          className="h-7 shrink-0 rounded-sm border-info/20 bg-info-muted/30 px-2"
        >
          Diff
        </Badge>
      </header>
      <pre
        tabIndex={0}
        aria-label={`${fileName} 的变更`}
        className="w-full min-w-0 overflow-x-auto py-3 font-sans text-xs font-regular focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <code className="block min-w-max font-sans">
          {lines.map((line, index) => {
            const definition = diffLineDefinitions[line.kind]

            return (
              <span
                key={`${line.oldLineNumber ?? ''}:${line.newLineNumber ?? ''}:${index}`}
                data-kind={line.kind}
                className={cn(
                  'flex min-h-4 min-w-full w-max items-start pr-4',
                  definition.rowClassName,
                )}
              >
                <span className="sr-only">{definition.ariaLabel}: </span>
                <span
                  aria-hidden="true"
                  className="w-8 shrink-0 select-none text-right text-text-muted tabular-nums"
                >
                  {line.oldLineNumber ?? ''}
                </span>
                <span
                  aria-hidden="true"
                  className="w-8 shrink-0 select-none text-right text-text-muted tabular-nums"
                >
                  {line.newLineNumber ?? ''}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'w-6 shrink-0 select-none text-center font-medium',
                    definition.prefixClassName,
                  )}
                >
                  {definition.prefix}
                </span>
                <span>{line.content || '\u00a0'}</span>
              </span>
            )
          })}
        </code>
      </pre>
    </section>
  )
}
