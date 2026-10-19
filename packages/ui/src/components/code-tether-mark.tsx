import type { ComponentPropsWithoutRef } from 'react'

import { cn } from '@codetether/ui/lib/cn'

/** Approved prototype mark; no external brand asset or provider logo. */
export function CodeTetherMark({
  className,
  ...props
}: ComponentPropsWithoutRef<'span'>) {
  return (
    <span
      aria-hidden="true"
      data-slot="code-tether-mark"
      className={cn(
        'grid size-(--layout-brand-mark-size) shrink-0 place-items-center rounded-(--layout-brand-mark-radius) bg-ink text-on-ink',
        className,
      )}
      {...props}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        className="size-4"
      >
        <circle cx="7" cy="12" r="3" />
        <circle cx="17" cy="12" r="3" />
        <path d="M10 12h4" />
      </svg>
    </span>
  )
}
