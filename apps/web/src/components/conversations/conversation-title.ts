import { formatLocalDateTime } from '../../presentation/date-time.js'

const CODEX_FALLBACK_TITLE = 'Codex 会话'
const OLD_CODEX_FALLBACK =
  /^Codex 会话 · (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)$/u

/** A presentation-only title; imported and adopted records keep their stored text. */
export function displayConversationTitle(
  title: string,
  createdAt?: string,
): string {
  const oldTimestamp = OLD_CODEX_FALLBACK.exec(title)?.[1]
  if (title !== CODEX_FALLBACK_TITLE && oldTimestamp === undefined) return title
  const date = oldTimestamp ?? createdAt
  const formatted = date === undefined ? undefined : formatLocalDateTime(date)
  return formatted === undefined
    ? CODEX_FALLBACK_TITLE
    : `${CODEX_FALLBACK_TITLE} · ${formatted}`
}
