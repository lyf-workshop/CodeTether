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
    ariaLabel: 'Context',
    className: 'text-info',
  },
  addition: {
    prefix: '+',
    ariaLabel: 'Added',
    className: 'bg-success-muted/40 text-success',
  },
  deletion: {
    prefix: '-',
    ariaLabel: 'Removed',
    className: 'bg-danger-muted/40 text-danger',
  },
} satisfies Record<
  DiffLineKind,
  { prefix: string; ariaLabel: string; className: string }
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
      aria-label={`Diff for ${fileName}`}
      data-slot="diff-card"
      className={cn(
        'w-full min-w-0 overflow-hidden rounded-sm border border-border bg-surface-code',
        className,
      )}
      {...props}
    >
      <header className="flex min-h-10 min-w-0 items-center justify-between gap-3 border-b border-border px-3">
        <code className="min-w-0 truncate font-sans text-xs font-medium text-text-secondary">
          {fileName}
        </code>
        <Badge variant="info" className="h-7 shrink-0 rounded-sm px-2">
          Diff
        </Badge>
      </header>
      <pre
        tabIndex={0}
        aria-label={`Changes in ${fileName}`}
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
                  definition.className,
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
                  className="w-6 shrink-0 select-none text-center font-semibold"
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
