import * as React from 'react'

import { Button, type ButtonProps } from '@codetether/ui/components/button'
import { cn } from '@codetether/ui/lib/cn'

type IconButtonSize = 'sm' | 'default' | 'lg'

interface IconButtonProps extends Omit<
  ButtonProps,
  'aria-label' | 'asChild' | 'size'
> {
  /** Accessible name announced by assistive technology. */
  label: string
  size?: IconButtonSize
}

const iconButtonSizes: Record<
  IconButtonSize,
  NonNullable<ButtonProps['size']>
> = {
  sm: 'icon-sm',
  default: 'icon',
  lg: 'icon-lg',
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, label, size = 'default', ...props }, ref) => (
    <Button
      ref={ref}
      aria-label={label}
      data-slot="icon-button"
      size={iconButtonSizes[size]}
      className={cn('shrink-0', className)}
      {...props}
    />
  ),
)

IconButton.displayName = 'IconButton'

export { IconButton, type IconButtonProps, type IconButtonSize }
