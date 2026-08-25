import * as React from 'react'

import { cn } from '@codetether/ui/lib/cn'

type TextareaProps = React.ComponentPropsWithoutRef<'textarea'>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      data-slot="textarea"
      className={cn(
        'min-h-24 w-full resize-y rounded-sm border border-border-strong bg-surface-muted px-3 py-2.5 text-base text-text-primary',
        'transition-colors duration-150 motion-reduce:transition-none',
        'outline-none placeholder:text-text-muted hover:border-ring/70 hover:bg-surface-elevated',
        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40',
        'aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/30',
        className,
      )}
      {...props}
    />
  ),
)

Textarea.displayName = 'Textarea'

export { Textarea, type TextareaProps }
