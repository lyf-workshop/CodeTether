// Leave space in the 16 KiB frame for the response envelope, cursors, and summaries.
export const supervisorRowsByteBudget = 12 * 1024

export function supervisorJsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

export function boundedSupervisorRows<T>(
  rows: readonly T[],
  maximumBytes = supervisorRowsByteBudget,
): T[] {
  const bounded: T[] = []
  let remaining = maximumBytes - 2
  for (const row of rows) {
    remaining -= supervisorJsonBytes(row) + (bounded.length === 0 ? 0 : 1)
    if (remaining < 0) break
    bounded.push(row)
  }
  return bounded
}

export function truncateSupervisorText(
  text: string,
  maximumBytes: number,
): string {
  if (supervisorJsonBytes(text) <= maximumBytes) return text
  // A JSON string cannot have more UTF-16 units than its UTF-8 byte budget.
  // Bound the search even for multi-megabyte events.
  const characters = Array.from(text.slice(0, maximumBytes))
  let low = 0
  let high = characters.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    const prefix = characters.slice(0, middle).join('')
    if (supervisorJsonBytes(`${prefix}…`) <= maximumBytes) low = middle
    else high = middle - 1
  }
  return `${characters.slice(0, low).join('')}…`
}
