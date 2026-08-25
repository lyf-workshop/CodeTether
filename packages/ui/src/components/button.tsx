/* eslint-disable react-refresh/only-export-components -- CVA variants are part of the public component API. */
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '@codetether/ui/lib/cn'

const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm border border-transparent font-medium',
    'transition-colors duration-150 motion-reduce:transition-none',
    'outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40',
    'aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/30',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
  ],
  {
    variants: {
      variant: {
        default:
          'bg-primary-action text-primary-foreground hover:bg-primary-hover active:bg-primary',
        secondary:
          'border-border-strong bg-surface-muted text-text-primary hover:bg-surface-elevated active:bg-surface',
        outline:
          'border-border-strong bg-transparent text-text-primary hover:bg-surface-muted active:bg-surface-elevated',
        ghost:
          'bg-transparent text-text-secondary hover:bg-surface-muted hover:text-text-primary active:bg-surface-elevated',
        danger:
          'border-danger/40 bg-danger-muted text-danger hover:border-danger hover:bg-danger hover:text-text-inverse active:bg-danger/80',
        destructive:
          'border-danger/40 bg-danger-muted text-danger hover:border-danger hover:bg-danger hover:text-text-inverse active:bg-danger/80',
        link: 'h-auto rounded-xs border-0 p-0 text-primary hover:text-primary-hover hover:underline active:text-primary',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        default: 'h-10 px-4 text-base',
        lg: 'h-12 px-5 text-base',
        icon: 'size-10 p-0',
        'icon-sm': 'size-8 p-0',
        'icon-lg': 'size-12 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

interface ButtonProps
  extends
    React.ComponentPropsWithoutRef<'button'>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      asChild = false,
      className,
      size = 'default',
      type,
      variant = 'default',
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot.Root : 'button'

    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? 'button')}
        data-slot="button"
        data-size={size}
        data-variant={variant}
        className={cn(buttonVariants({ size, variant }), className)}
        {...props}
      />
    )
  },
)

Button.displayName = 'Button'

export { Button, buttonVariants, type ButtonProps }
