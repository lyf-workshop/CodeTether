import type { ComponentPropsWithoutRef } from 'react'

import { cn } from '@codetether/ui'

type MainContentProps = ComponentPropsWithoutRef<'main'>

export function MainContent({ className, ...props }: MainContentProps) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className={cn(
        'min-h-0 min-w-0 overflow-y-auto bg-background outline-none',
        className,
      )}
      {...props}
    />
  )
}
