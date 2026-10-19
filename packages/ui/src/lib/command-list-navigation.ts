/** Presentation-only roving highlight; focus remains in the combobox input. */
export function commandListHighlight(
  ids: readonly string[],
  current: string | undefined,
  key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End',
): string | undefined {
  if (ids.length === 0) return undefined
  if (key === 'Home') return ids[0]
  if (key === 'End') return ids.at(-1)
  const index = current === undefined ? -1 : ids.indexOf(current)
  if (index === -1) return key === 'ArrowUp' ? ids.at(-1) : ids[0]
  return ids[(index + (key === 'ArrowDown' ? 1 : -1) + ids.length) % ids.length]
}
