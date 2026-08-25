/* eslint-disable react-refresh/only-export-components -- CVA variants are part of the public component API. */
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '@codetether/ui/lib/cn'

const badgeVariants = cva(
  [
    'inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-full border px-2 text-xs font-medium',
    'transition-colors duration-150 motion-reduce:transition-none',
    'outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    '[&_svg]:pointer-events-none [&_svg]:size-3 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        default: 'border-primary/30 bg-primary-muted text-primary',
        secondary: 'border-border-strong bg-surface-muted text-text-secondary',
        outline: 'border-border-strong bg-transparent text-text-secondary',
        success: 'border-success/30 bg-success-muted text-success',
        warning: 'border-warning/30 bg-warning-muted text-warning',
        danger: 'border-danger/30 bg-danger-muted text-danger',
        destructive: 'border-danger/30 bg-danger-muted text-danger',
        info: 'border-info/30 bg-info-muted text-info',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

interface BadgeProps
  extends
    React.ComponentPropsWithoutRef<'span'>,
    VariantProps<typeof badgeVariants> {
  asChild?: boolean
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ asChild = false, className, variant = 'default', ...props }, ref) => {
    const Comp = asChild ? Slot.Root : 'span'

    return (
      <Comp
        ref={ref}
        data-slot="badge"
        data-variant={variant}
        className={cn(badgeVariants({ variant }), className)}
        {...props}
      />
    )
  },
)

Badge.displayName = 'Badge'

export { Badge, badgeVariants, type BadgeProps }
