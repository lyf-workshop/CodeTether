import * as React from 'react'
import { RadioGroup } from 'radix-ui'

import { cn } from '@codetether/ui/lib/cn'

export type SegmentedControlProps = React.ComponentPropsWithoutRef<
  typeof RadioGroup.Root
>
export type SegmentedControlItemProps = React.ComponentPropsWithoutRef<
  typeof RadioGroup.Item
>

export const SegmentedControl = React.forwardRef<
  React.ComponentRef<typeof RadioGroup.Root>,
  SegmentedControlProps
>(({ className, orientation = 'horizontal', ...props }, ref) => (
  <RadioGroup.Root
    ref={ref}
    data-slot="segmented-control"
    orientation={orientation}
    className={cn(
      'inline-flex w-fit max-w-full gap-0.5 rounded-(--control-radius-lg) border border-border bg-surface-inset p-(--segmented-padding)',
      orientation === 'vertical' && 'flex-col',
      className,
    )}
    {...props}
  />
))

SegmentedControl.displayName = 'SegmentedControl'

export const SegmentedControlItem = React.forwardRef<
  React.ComponentRef<typeof RadioGroup.Item>,
  SegmentedControlItemProps
>(({ className, ...props }, ref) => (
  <RadioGroup.Item
    ref={ref}
    data-slot="segmented-control-item"
    className={cn(
      'inline-flex h-(--control-height-sm) min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-(--control-radius-sm) border border-transparent px-3 text-md font-medium text-text-secondary outline-none transition-colors duration-150 hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-45 data-[state=checked]:border-border data-[state=checked]:bg-surface data-[state=checked]:text-text-primary data-[state=checked]:shadow-subtle motion-reduce:transition-none',
      className,
    )}
    {...props}
  />
))

SegmentedControlItem.displayName = 'SegmentedControlItem'
