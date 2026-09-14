export interface ConversationDurationInput {
  readonly startedAt?: string
  readonly completedAt?: string
  readonly running: boolean
  readonly now?: number
}

export function formatConversationDuration({
  startedAt,
  completedAt,
  running,
  now = Date.now(),
}: ConversationDurationInput): string {
  if (startedAt === undefined) return '—'
  if (!running && completedAt === undefined) return '—'

  const start = Date.parse(startedAt)
  const end = running ? now : Date.parse(completedAt as string)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '—'

  const seconds = Math.max(0, Math.floor((end - start) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60

  return [hours, minutes, remainder]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
}
