import * as React from 'react'
import { Checkbox as RadixCheckbox } from 'radix-ui'
import { Check, Minus } from 'lucide-react'
import { cn } from '../lib/cn'

/** Native keyboard/label semantics and controlled state, styled with shared tokens. */
export const Checkbox = React.forwardRef<
  React.ComponentRef<typeof RadixCheckbox.Root>,
  React.ComponentPropsWithoutRef<typeof RadixCheckbox.Root>
>(({ className, ...props }, ref) => (
  <RadixCheckbox.Root
    ref={ref}
    data-slot="checkbox"
    className={cn(
      'grid size-4 shrink-0 place-items-center rounded-xs border border-border-strong bg-surface text-on-ink outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-45 data-[state=checked]:border-ink data-[state=checked]:bg-ink data-[state=indeterminate]:border-ink data-[state=indeterminate]:bg-ink motion-reduce:transition-none',
      className,
    )}
    {...props}
  >
    <RadixCheckbox.Indicator className="group/checkbox grid place-items-center">
      <Check
        aria-hidden="true"
        className="size-3 group-data-[state=indeterminate]/checkbox:hidden"
      />
      <Minus
        aria-hidden="true"
        className="hidden size-3 group-data-[state=indeterminate]/checkbox:block"
      />
    </RadixCheckbox.Indicator>
  </RadixCheckbox.Root>
))
Checkbox.displayName = 'Checkbox'
