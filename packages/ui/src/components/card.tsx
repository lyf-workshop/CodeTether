import * as React from 'react'
import { Slot } from 'radix-ui'

import { cn } from '@codetether/ui/lib/cn'

interface CardProps extends React.ComponentPropsWithoutRef<'div'> {
  asChild?: boolean
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ asChild = false, className, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : 'div'

    return (
      <Comp
        ref={ref}
        data-slot="card"
        className={cn(
          'flex min-w-0 flex-col rounded-lg border border-border bg-surface text-text-primary',
          className,
        )}
        {...props}
      />
    )
  },
)

Card.displayName = 'Card'

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'grid grid-cols-[minmax(0,1fr)] items-start gap-1.5 p-4 has-[>[data-slot=card-action]]:grid-cols-[minmax(0,1fr)_auto]',
        className,
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return (
    <h3
      data-slot="card-title"
      className={cn('text-base font-semibold leading-snug', className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="card-description"
      className={cn('text-sm leading-normal text-text-secondary', className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        'col-start-2 row-span-2 row-start-1 self-start justify-self-end',
        className,
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-content"
      className={cn('min-w-0 px-4 pb-4', className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        'flex flex-wrap items-center gap-2 border-t border-border px-4 py-3',
        className,
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  type CardProps,
}
