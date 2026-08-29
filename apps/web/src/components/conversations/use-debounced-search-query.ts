import { useEffect, useState } from 'react'

export const conversationSearchDebounceMs = 250

/**
 * Keeps the user's URL-backed input intact while delaying only the durable
 * Host read. Whitespace decides Browse/Search mode but normalization remains
 * owned by the Client and Host.
 */
export function useDebouncedSearchQuery(
  value: string,
  delayMs = conversationSearchDebounceMs,
): string {
  const trimmed = value.trim()
  const [debounced, setDebounced] = useState(trimmed)

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setDebounced(trimmed),
      trimmed.length === 0 ? 0 : delayMs,
    )
    return () => window.clearTimeout(timeout)
  }, [delayMs, trimmed])

  return debounced
}
