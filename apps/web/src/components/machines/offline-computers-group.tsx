import { useId, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@codetether/ui'

export function OfflineComputersGroup({
  count,
  surface,
  children,
}: {
  readonly count: number
  readonly surface: 'devices' | 'sidebar' | 'doctor'
  readonly children: ReactNode
}) {
  const contentId = useId()
  const preferenceKey = `ct-offline-computers-${surface}`
  const [open, setOpen] = useState(() => {
    try {
      return window.sessionStorage.getItem(preferenceKey) === 'open'
    } catch {
      return false
    }
  })
  if (count === 0) return null

  const compact = surface === 'sidebar'
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div>
      <Button
        variant={compact ? 'ghost' : 'outline'}
        size={compact ? 'sm' : 'default'}
        className={
          compact
            ? 'h-[var(--tree-device-h)] w-full justify-start gap-1.5 px-1'
            : 'w-full justify-start'
        }
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => {
          const next = !open
          setOpen(next)
          try {
            window.sessionStorage.setItem(
              preferenceKey,
              next ? 'open' : 'closed',
            )
          } catch {
            // The disclosure still works when browser storage is unavailable.
          }
        }}
      >
        <Chevron aria-hidden="true" />
        其他电脑 · {count} 台离线
      </Button>
      <div
        id={contentId}
        hidden={!open}
        className={compact ? 'mt-1 ml-5 space-y-1' : 'mt-4'}
      >
        {open ? children : null}
      </div>
    </div>
  )
}
