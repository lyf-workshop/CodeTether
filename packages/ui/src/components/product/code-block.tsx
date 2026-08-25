import type { ComponentPropsWithoutRef } from 'react'

import { cn } from '../../lib/cn'

export interface CodeBlockProps extends Omit<
  ComponentPropsWithoutRef<'pre'>,
  'children'
> {
  code: string
  language?: string
  showLineNumbers?: boolean
  startLineNumber?: number
}

/** Read-only code surface derived from Figma nodes 14:180 and 19:347. */
export function CodeBlock({
  code,
  language,
  showLineNumbers = true,
  startLineNumber = 1,
  className,
  tabIndex,
  'aria-label': ariaLabel,
  ...props
}: CodeBlockProps) {
  const lines = code.split('\n')

  return (
    <pre
      tabIndex={tabIndex ?? 0}
      aria-label={ariaLabel ?? `${language ?? 'Code'} block`}
      data-language={language}
      data-slot="code-block"
      className={cn(
        'w-full min-w-0 overflow-x-auto rounded-sm border border-border bg-background p-3 font-sans text-xs font-regular text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    >
      <code className="block min-w-max font-sans">
        {lines.map((line, index) => (
          <span key={index} className="flex min-h-4 min-w-max">
            {showLineNumbers ? (
              <span
                aria-hidden="true"
                className="w-8 shrink-0 select-none pr-2 text-right text-text-muted tabular-nums"
              >
                {startLineNumber + index}
              </span>
            ) : null}
            <span>{line || '\u00a0'}</span>
          </span>
        ))}
      </code>
    </pre>
  )
}
