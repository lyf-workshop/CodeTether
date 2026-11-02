/* eslint-disable react-refresh/only-export-components -- CVA variants are part of the public component API. */
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '@codetether/ui/lib/cn'

const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-(--control-gap-md) whitespace-nowrap rounded-sm border border-transparent font-medium',
    'transition-colors duration-150 motion-reduce:transition-none',
    'outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45',
    'aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/30',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
  ],
  {
    variants: {
      variant: {
        default:
          'border-ink bg-ink text-on-ink shadow-subtle hover:border-ink-hover hover:bg-ink-hover active:bg-ink',
        secondary:
          'border-border-strong bg-surface text-text-primary shadow-subtle hover:bg-surface-muted active:bg-surface-selected',
        outline:
          'border-border-strong bg-transparent text-text-primary hover:bg-surface-muted active:bg-surface-selected',
        ghost:
          'bg-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary active:bg-surface-selected',
        danger:
          'border-border-strong bg-surface text-danger-text hover:border-danger hover:bg-danger-muted active:bg-danger-muted',
        destructive:
          'border-border-strong bg-surface text-danger-text hover:border-danger hover:bg-danger-muted active:bg-danger-muted',
        link: 'h-auto rounded-xs border-0 p-0 text-primary-text hover:text-primary-hover hover:underline active:text-primary-text',
      },
      size: {
        sm: 'h-(--control-height-sm) gap-(--control-gap-sm) rounded-(--control-radius-sm) px-2.5 text-sm',
        default: 'h-(--control-height-md) px-3.5 text-md',
        lg: 'h-(--control-height-lg) rounded-(--control-radius-lg) px-5 text-base',
        icon: 'size-(--control-icon-size) p-0',
        'icon-sm': 'size-(--control-height-sm) p-0',
        'icon-lg': 'size-(--control-height-lg) p-0',
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
