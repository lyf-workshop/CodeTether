const dateTimeThisYear = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const dateTimeOtherYear = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const dateThisYear = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
})
const dateOtherYear = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})
const time = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const timeWithSeconds = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

function validDate(value: string | Date): Date | undefined {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** Dates shown to people use local time and one Chinese month/day family. */
export function formatLocalDateTime(
  value: string | Date,
  now: Date = new Date(),
): string | undefined {
  const date = validDate(value)
  if (!date) return undefined
  return (
    date.getFullYear() === now.getFullYear()
      ? dateTimeThisYear
      : dateTimeOtherYear
  ).format(date)
}

export function formatLocalDate(
  value: string | Date,
  now: Date = new Date(),
): string | undefined {
  const date = validDate(value)
  if (!date) return undefined
  return (
    date.getFullYear() === now.getFullYear() ? dateThisYear : dateOtherYear
  ).format(date)
}

export function formatLocalTime(
  value: string | Date,
  includeSeconds = false,
): string | undefined {
  const date = validDate(value)
  if (!date) return undefined
  return (includeSeconds ? timeWithSeconds : time).format(date)
}
