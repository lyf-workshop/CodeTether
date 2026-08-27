export const DEFAULT_CONVERSATION_TITLE = '新会话'
export const MAX_CONVERSATION_TITLE_GRAPHEMES = 48
const MAX_CONVERSATION_TITLE_CODE_UNITS = 240

const graphemeSegmenter = new Intl.Segmenter('und', {
  granularity: 'grapheme',
})

/**
 * Produces the stable V1 product title from the first canonical User input.
 * This is intentionally deterministic and local; it never calls a Provider.
 */
export function generateConversationTitle(input: string): string {
  const normalized = normalizeTitleInput(input)
  if (normalized.length === 0) return DEFAULT_CONVERSATION_TITLE

  const sentence = takeBefore(normalized, /[.!?。！？；;\r\n]/u)
  const withoutRequestPrefix = stripRequestPrefix(sentence)
  const clause = takeBefore(withoutRequestPrefix, /[,，]/u)
  const candidate = stripTrailingPunctuation(clause).trim()
  const fallback = stripTrailingPunctuation(sentence).trim() || normalized

  return truncateConversationTitle(candidate || fallback)
}

export function truncateConversationTitle(value: string): string {
  const graphemes = [...graphemeSegmenter.segment(value)].map(
    (segment) => segment.segment,
  )
  if (
    graphemes.length <= MAX_CONVERSATION_TITLE_GRAPHEMES &&
    value.length <= MAX_CONVERSATION_TITLE_CODE_UNITS
  ) {
    return value
  }

  const retained = graphemes.slice(0, MAX_CONVERSATION_TITLE_GRAPHEMES - 1)
  while (
    retained.length > 0 &&
    `${retained.join('')}…`.length > MAX_CONVERSATION_TITLE_CODE_UNITS
  ) {
    retained.pop()
  }

  return `${retained.join('')}…`
}

function normalizeTitleInput(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim()
}

function takeBefore(value: string, boundary: RegExp): string {
  const index = value.search(boundary)
  return index <= 0 ? value : value.slice(0, index)
}

function stripRequestPrefix(value: string): string {
  const withoutListMarker = value.replace(/^(?:[-*#>]|•)+\s*/u, '')
  const stripped = withoutListMarker.replace(
    /^(?:(?:麻烦帮我|麻烦你|请协助我|可以帮我|请帮我|请你|帮我|麻烦|请|能否)[：:,，\s]*)+/u,
    '',
  )
  return stripped.trim() || withoutListMarker.trim()
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.!?。！？；;,，：:]+$/gu, '')
}
