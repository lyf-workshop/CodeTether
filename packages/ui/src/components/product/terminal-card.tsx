import type { AriaAttributes, ComponentPropsWithoutRef, ReactNode } from 'react'

import { cn } from '../../lib/cn'

export interface TerminalCardProps extends Omit<
  ComponentPropsWithoutRef<'section'>,
  'children' | 'title'
> {
  title?: string
  output: string | readonly string[]
  action?: ReactNode
  ariaLive?: AriaAttributes['aria-live']
}

/** Static terminal preview based on Figma node 14:270. */
export function TerminalCard({
  title = 'Terminal',
  output,
  action,
  ariaLive = 'off',
  className,
  ...props
}: TerminalCardProps) {
  const outputText = typeof output === 'string' ? output : output.join('\n')

  return (
    <section
      aria-label={title}
      data-slot="terminal-card"
      className={cn(
        'flex min-h-40 w-full min-w-0 flex-col overflow-hidden rounded-md border border-border bg-surface p-3',
        className,
      )}
      {...props}
    >
      <header className="flex min-w-0 items-center justify-between gap-3">
        <h3 className="truncate text-md font-semibold text-text-primary">
          {title}
        </h3>
        {action ? (
          <span className="shrink-0 text-2xs font-medium text-primary">
            {action}
          </span>
        ) : null}
      </header>
      <pre
        tabIndex={0}
        aria-live={ariaLive}
        className="mt-4 min-h-0 flex-1 overflow-auto whitespace-pre font-sans text-2xs font-regular text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <code className="font-sans">{outputText}</code>
      </pre>
    </section>
  )
}
