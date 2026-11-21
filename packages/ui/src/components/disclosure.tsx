import { useId, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

import { cn } from '../lib/cn'

export function Disclosure({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const contentId = useId()
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        className="inline-flex max-w-full items-center gap-1 rounded-xs text-left font-medium text-text-secondary outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setExpanded((current) => !current)}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn('size-4 shrink-0', expanded && 'rotate-90')}
        />
        {label}
      </button>
      <div id={contentId} hidden={!expanded}>
        {children}
      </div>
    </div>
  )
}
