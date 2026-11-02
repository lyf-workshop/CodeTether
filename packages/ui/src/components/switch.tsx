import * as React from 'react'
import { Switch as RadixSwitch } from 'radix-ui'

import { cn } from '../lib/cn'

export const Switch = React.forwardRef<
  React.ComponentRef<typeof RadixSwitch.Root>,
  React.ComponentPropsWithoutRef<typeof RadixSwitch.Root>
>(({ className, ...props }, ref) => (
  <RadixSwitch.Root
    ref={ref}
    data-slot="switch"
    className={cn(
      'inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-border-strong p-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-45 data-[state=checked]:bg-primary-action motion-reduce:transition-none',
      className,
    )}
    {...props}
  >
    <RadixSwitch.Thumb className="pointer-events-none block size-4 rounded-full bg-surface shadow-subtle transition-transform data-[state=checked]:translate-x-4 motion-reduce:transition-none" />
  </RadixSwitch.Root>
))
Switch.displayName = 'Switch'
