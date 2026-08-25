import * as React from 'react'

import { cn } from '@codetether/ui/lib/cn'

type InputProps = React.ComponentPropsWithoutRef<'input'>

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      data-slot="input"
      className={cn(
        'h-10 w-full min-w-0 rounded-sm border border-border-strong bg-surface-muted px-3 text-base text-text-primary',
        'transition-colors duration-150 motion-reduce:transition-none',
        'outline-none placeholder:text-text-muted hover:border-ring/70 hover:bg-surface-elevated',
        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40',
        'aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/30',
        'file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-text-secondary',
        className,
      )}
      {...props}
    />
  ),
)

Input.displayName = 'Input'

export { Input, type InputProps }
